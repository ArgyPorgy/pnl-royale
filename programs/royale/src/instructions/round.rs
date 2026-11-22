//! Ephemeral Rollup (TEE) instructions: permissions, round clock, trading, crank, storms,
//! final commit. Logs never contain private position data: a crank transaction touches every
//! position, so anything logged there could be visible to every member.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::{Discriminator, InstructionData, ToAccountMetas};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
#[allow(deprecated)]
use ephemeral_rollups_sdk::crank::{CancelCrankCpi, ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::consts::{
    program_identity_pda, program_identity_pubkey, scoped_vrf_identity_const, IDENTITY,
};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_randomness_ix_const, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};
use solana_sha256_hasher::hashv;

use crate::constants::*;
use crate::errors::RoyaleError;
use crate::game::*;
use crate::oracle;
use crate::state::*;

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);
const PROGRAM_IDENTITY_BUMP: u8 = program_identity_pda(&crate::ID).1;
/// The VRF program signs callbacks with this scoped identity. Computed at compile time: the SDK's
/// `#[vrf_callback]` puts the same const fn inside an Anchor `address =` constraint, which then
/// runs on-chain (software SHA-256, ~200k CU) and exhausts the callback's compute budget.
pub const VRF_CALLBACK_IDENTITY: Pubkey =
    Pubkey::new_from_array(scoped_vrf_identity_const(&crate::ID).0);

pub fn is_vrf_queue(k: &Pubkey) -> bool {
    use ephemeral_rollups_sdk::vrf::consts::*;
    *k == DEFAULT_EPHEMERAL_QUEUE
        || *k == DEFAULT_QUEUE
        || *k == DEFAULT_EPHEMERAL_TEST_QUEUE
        || *k == DEFAULT_TEST_QUEUE
}

/// The SDK CPI builders want `&'info AccountInfo<'info>`; Anchor only hands out owned clones.
/// Leaking a clone onto the (never-freed) bump heap gives the right lifetime for the CPI.
fn leak<'info>(ai: AccountInfo<'info>) -> &'info AccountInfo<'info> {
    Box::leak(Box::new(ai))
}

/// Collision-resistant crank task id (task ids are validator-global on 1.x).
pub fn task_id(room: &Pubkey, salt: u8) -> i64 {
    let h = hashv(&[crate::ID.as_ref(), room.as_ref(), &[salt]]).to_bytes();
    let mut b = [0u8; 8];
    b.copy_from_slice(&h[..8]);
    i64::from_le_bytes(b) & i64::MAX
}

/// Load and validate every seat's Position from `infos` (seat order).
fn load_positions<'info>(
    room: &Room,
    room_key: &Pubkey,
    infos: &'info [AccountInfo<'info>],
) -> Result<Vec<Account<'info, Position>>> {
    let n = room.seats_filled as usize;
    require!(infos.len() >= n, RoyaleError::PositionMismatch);
    let mut out = Vec::with_capacity(n);
    for (i, info) in infos.iter().take(n).enumerate() {
        let pos = Account::<Position>::try_from(info)?;
        require_keys_eq!(pos.room, *room_key, RoyaleError::PositionMismatch);
        require_keys_eq!(pos.owner, room.players[i], RoyaleError::PositionMismatch);
        require!(pos.seat as usize == i, RoyaleError::PositionMismatch);
        out.push(pos);
    }
    Ok(out)
}

/// The room's feed accounts, in asset order, from `infos`.
fn load_feeds<'info>(room: &Room, infos: &'info [AccountInfo<'info>]) -> Result<&'info [AccountInfo<'info>]> {
    let n = room.num_assets as usize;
    require!(infos.len() >= n, RoyaleError::FeedMismatch);
    for (i, info) in infos.iter().take(n).enumerate() {
        require_keys_eq!(*info.key, room.feeds[i], RoyaleError::FeedMismatch);
    }
    Ok(&infos[..n])
}

// ------------------------------------------------------------------------------------------
// Permissions (TEE): owner-only visibility for each Position.
// ------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, room.key().as_ref(), position.owner.as_ref()],
        bump = position.bump,
        has_one = room @ RoyaleError::PositionMismatch
    )]
    pub position: Box<Account<'info, Position>>,
    /// CHECK: EphemeralPermission PDA, created by the permission program.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, position.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Anyone, idempotent: seal a Position so only its owner can read it through the TEE RPC.
pub fn init_permission(ctx: Context<InitPermission>) -> Result<()> {
    require!(ctx.accounts.room.private, RoyaleError::WrongStatus);
    let status = ctx.accounts.room.status();
    require!(
        status == RoomStatus::Starting || status == RoomStatus::Live,
        RoyaleError::WrongStatus
    );
    if ctx.accounts.permission.lamports() > 0 {
        ctx.accounts.position.permissioned = true;
        return Ok(());
    }
    let room_key = ctx.accounts.room.key();
    let owner = ctx.accounts.position.owner;
    let viewer = ctx.accounts.position.viewer;
    let bump = [ctx.accounts.position.bump];
    let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
    let mut members = vec![Member { flags, pubkey: owner }];
    if viewer != Pubkey::default() && viewer != owner {
        members.push(Member { flags, pubkey: viewer });
    }
    let seeds: &[&[u8]] = &[POSITION_SEED, room_key.as_ref(), owner.as_ref(), &bump];
    CreateEphemeralPermissionCpi {
        payer: ctx.accounts.position.to_account_info(),
        permissioned_account: ctx.accounts.position.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs {
            is_private: true,
            members,
        },
    }
    .invoke_signed(&[seeds])?;
    ctx.accounts.position.permissioned = true;
    Ok(())
}

// ------------------------------------------------------------------------------------------
// begin_round: start the clock, schedule the referee (tick) and the storm requester.
// ------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BeginRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: VRF queue the storm requester will use (validated against SDK constants).
    #[account(constraint = is_vrf_queue(&oracle_queue.key()) @ RoyaleError::WrongQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: Magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[allow(deprecated)]
pub fn begin_round<'info>(ctx: Context<'info, BeginRound<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room_key = ctx.accounts.room.key();
    require!(ctx.accounts.room.status() == RoomStatus::Starting, RoyaleError::WrongStatus);

    let n = ctx.accounts.room.seats_filled as usize;
    let (pos_infos, rest) = ctx.remaining_accounts.split_at(n.min(ctx.remaining_accounts.len()));
    let mut positions = load_positions(&ctx.accounts.room, &room_key, pos_infos)?;
    let feeds = load_feeds(&ctx.accounts.room, rest)?;

    for pos in positions.iter_mut() {
        if ctx.accounts.room.private {
            require!(pos.permissioned, RoyaleError::NotPermissioned);
        }
        pos.side = SIDE_FLAT;
        pos.leverage = 1;
        pos.entry_price = 0;
        pos.entry_ts = now;
        pos.equity_at_open = STARTING_CHIPS;
        pos.equity = STARTING_CHIPS;
        pos.last_action_ts = 0;
        pos.alive = true;
        pos.liquidated = false;
        pos.exit(&crate::ID)?;
    }

    let interval_ms = ctx.accounts.room.interval_secs as i64 * 1_000;
    let iterations = (FINAL_CHECKPOINT as i64 * interval_ms) / TICK_INTERVAL_MS + TICK_GRACE;
    let tick_id = task_id(&room_key, 0);
    let storm_id = task_id(&room_key, 1);
    {
        let room = &mut ctx.accounts.room;
        room.start_ts = now;
        room.next_checkpoint = 1;
        room.alive_count = room.seats_filled;
        room.task_id = tick_id;
        room.set_status(RoomStatus::Live);
    }

    // The referee: tick() is permissionless, time-gated and idempotent.
    let mut tick_metas = crate::accounts::Tick { room: room_key }.to_account_metas(None);
    for p in pos_infos.iter().take(n) {
        tick_metas.push(AccountMeta::new(*p.key, false));
    }
    for f in feeds.iter() {
        tick_metas.push(AccountMeta::new_readonly(*f.key, false));
    }
    let tick_ix = Instruction {
        program_id: crate::ID,
        accounts: tick_metas,
        data: crate::instruction::Tick {}.data(),
    };

    // The storm requester: request_storm() asks VRF for the current interval's storm once.
    let storm_metas = crate::accounts::RequestStorm {
        room: room_key,
        oracle_queue: ctx.accounts.oracle_queue.key(),
        program_identity: PROGRAM_IDENTITY,
        vrf_program: ephemeral_rollups_sdk::vrf::consts::VRF_PROGRAM_ID,
        slot_hashes: ephemeral_rollups_sdk::vrf::compat::slot_hashes::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);
    let storm_ix = Instruction {
        program_id: crate::ID,
        accounts: storm_metas,
        data: crate::instruction::RequestStorm {}.data(),
    };

    let id_bytes = ctx.accounts.room.room_id.to_le_bytes();
    let bump = [ctx.accounts.room.bump];
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &id_bytes, &bump];
    let room_info = leak(ctx.accounts.room.to_account_info());
    let magic_info = leak(ctx.accounts.magic_program.to_account_info());
    for (id, ix) in [(tick_id, tick_ix), (storm_id, storm_ix)] {
        ScheduleCrankCpi {
            payer: room_info,
            magic_program: magic_info,
            instruction_accounts: &[],
            args: ScheduleTaskArgs {
                task_id: id,
                execution_interval_millis: TICK_INTERVAL_MS,
                iterations,
                instructions: vec![ix],
            },
        }
        .invoke_signed(&[room_seeds])?;
    }
    msg!(
        "round live: room {} seats {} interval {}s tasks {} {}",
        ctx.accounts.room.room_id,
        n,
        ctx.accounts.room.interval_secs,
        tick_id,
        storm_id
    );
    Ok(())
}

// ------------------------------------------------------------------------------------------
// set_position: the trading action. Session key or owner. Popup-free, free ER transaction.
// ------------------------------------------------------------------------------------------

#[derive(Accounts, Session)]
pub struct SetPosition<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, room.key().as_ref(), position.owner.as_ref()],
        bump = position.bump,
        has_one = room @ RoyaleError::PositionMismatch
    )]
    pub position: Box<Account<'info, Position>>,
    #[session(signer = signer, authority = position.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[session_auth_or(
    ctx.accounts.position.owner == ctx.accounts.signer.key(),
    RoyaleError::Unauthorized
)]
pub fn set_position(
    ctx: Context<SetPosition>,
    side: i8,
    leverage: u8,
    asset_idx: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room = &ctx.accounts.room;
    require!(room.status() == RoomStatus::Live, RoyaleError::RoundNotLive);
    let end_ts = checkpoint_ts(room.start_ts, room.interval_secs, FINAL_CHECKPOINT);
    require!(now < end_ts, RoyaleError::RoundNotLive);
    let feeds = load_feeds(room, ctx.remaining_accounts)?;

    let pos = &mut ctx.accounts.position;
    require!(pos.alive && !pos.liquidated, RoyaleError::Eliminated);
    require!(now - pos.last_action_ts >= MIN_HOLD_SECS, RoyaleError::HoldTime);
    require!(
        side == SIDE_FLAT || side == SIDE_LONG || side == SIDE_SHORT,
        RoyaleError::InvalidSide
    );
    let (leverage, asset_idx) = if side == SIDE_FLAT {
        (1u8, pos.asset_idx)
    } else {
        require!(asset_idx < room.num_assets, RoyaleError::InvalidAsset);
        (leverage, asset_idx)
    };
    require!(
        side != pos.side || leverage != pos.leverage || asset_idx != pos.asset_idx,
        RoyaleError::NoChange
    );

    let cur_interval = interval_of(room.start_ts, room.interval_secs, now);
    let storm_now = room.storm_for(cur_interval);
    if side != SIDE_FLAT {
        require!(leverage_allowed(leverage, &storm_now), RoyaleError::InvalidLeverage);
        let interval_start = checkpoint_ts(room.start_ts, room.interval_secs, cur_interval);
        require!(
            !side_frozen(side, &storm_now, interval_start, now),
            RoyaleError::SideFrozen
        );
    }

    // Close the current position at the oracle price (or settle the zone bleed if flat).
    let entry_interval = interval_of(room.start_ts, room.interval_secs, pos.entry_ts);
    let storm_entry = room.storm_for(entry_interval);
    let p_close = if pos.side == SIDE_FLAT {
        0
    } else {
        oracle::read_from(feeds, &room.feeds[pos.asset_idx as usize], now, MAX_PRICE_AGE_SECS)?
    };
    let closed = mark(
        &MarkInput {
            equity_at_open: pos.equity_at_open,
            side: pos.side,
            leverage: pos.leverage,
            asset_idx: pos.asset_idx,
            entry_price: pos.entry_price,
            entry_ts: pos.entry_ts,
        },
        p_close,
        now,
        &storm_entry,
    )
    .ok_or(error!(RoyaleError::MathOverflow))?;

    pos.actions = pos.actions.saturating_add(1);
    pos.last_action_ts = now;
    if closed.liquidated {
        pos.liquidated = true;
        pos.side = SIDE_FLAT;
        pos.leverage = 1;
        pos.entry_price = 0;
        pos.entry_ts = now;
        pos.equity_at_open = 0;
        pos.equity = 0;
        return Ok(());
    }

    // Open the new one, paying the spread on notional.
    let mut equity = closed.equity;
    let mut entry_price = 0i64;
    if side != SIDE_FLAT {
        let cost = open_cost(equity, leverage).ok_or(error!(RoyaleError::MathOverflow))?;
        equity = equity.saturating_sub(cost);
        entry_price =
            oracle::read_from(feeds, &room.feeds[asset_idx as usize], now, MAX_PRICE_AGE_SECS)?;
    }
    pos.side = side;
    pos.leverage = leverage;
    pos.asset_idx = asset_idx;
    pos.entry_price = entry_price;
    pos.entry_ts = now;
    pos.equity_at_open = equity;
    pos.equity = equity;
    if equity == 0 {
        pos.liquidated = true;
        pos.side = SIDE_FLAT;
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------
// tick: the referee. Permissionless, time-gated, idempotent (crank + relayer + any client).
// ------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
}

/// Resolve the price of every room asset for a checkpoint. `None` = defer the checkpoint.
fn checkpoint_prices(room: &Room, feeds: &[AccountInfo], now: i64, due: i64) -> Result<Option<[i64; MAX_ASSETS]>> {
    let mut out = [0i64; MAX_ASSETS];
    for a in 0..room.num_assets as usize {
        match oracle::read_fresh(&feeds[a], &room.feeds[a], now, MAX_PRICE_AGE_SECS) {
            Ok(p) => out[a] = p,
            Err(_) => {
                if now < due + STALE_DEFER_SECS {
                    return Ok(None);
                }
                // After the defer window: last published price if recent enough,
                // else the previous checkpoint's price, else 0 (= no PnL on this asset).
                out[a] = match oracle::decode_feed(&feeds[a], &room.feeds[a]) {
                    Ok(p) if now - p.publish_time <= MAX_FALLBACK_AGE_SECS => p.price,
                    _ => room.last_price[a],
                };
            }
        }
    }
    Ok(Some(out))
}

pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room_key = ctx.accounts.room.key();
    if ctx.accounts.room.status() != RoomStatus::Live {
        return Ok(());
    }
    let k = ctx.accounts.room.next_checkpoint;
    let due = checkpoint_ts(ctx.accounts.room.start_ts, ctx.accounts.room.interval_secs, k);
    if now < due {
        return Ok(());
    }

    let n = ctx.accounts.room.seats_filled as usize;
    let (pos_infos, rest) = ctx.remaining_accounts.split_at(n.min(ctx.remaining_accounts.len()));
    let mut positions = load_positions(&ctx.accounts.room, &room_key, pos_infos)?;
    let feeds = load_feeds(&ctx.accounts.room, rest)?;
    let prices = match checkpoint_prices(&ctx.accounts.room, feeds, now, due)? {
        Some(p) => p,
        None => return Ok(()), // wait for a fresh price (bounded by STALE_DEFER_SECS)
    };

    let room = &mut ctx.accounts.room;
    room.ticks = room.ticks.saturating_add(1);
    let seed = if room.seed_set {
        room.vrf_seed
    } else {
        hashv(&[room_key.as_ref(), &room.start_ts.to_le_bytes()]).to_bytes()
    };

    // Mark every alive position and re-base it at this checkpoint, so storms never apply
    // across interval boundaries.
    let mut contenders = Vec::with_capacity(n);
    for pos in positions.iter_mut() {
        if !pos.alive {
            continue;
        }
        let entry_interval = interval_of(room.start_ts, room.interval_secs, pos.entry_ts);
        let storm = room.storm_for(entry_interval);
        let p_now = if pos.side == SIDE_FLAT {
            0
        } else {
            let p = prices[pos.asset_idx as usize];
            if p > 0 { p } else { pos.entry_price }
        };
        let m = if pos.liquidated {
            Mark { equity: 0, liquidated: true }
        } else {
            mark(
                &MarkInput {
                    equity_at_open: pos.equity_at_open,
                    side: pos.side,
                    leverage: pos.leverage,
                    asset_idx: pos.asset_idx,
                    entry_price: pos.entry_price,
                    entry_ts: pos.entry_ts,
                },
                p_now,
                now,
                &storm,
            )
            .ok_or(error!(RoyaleError::MathOverflow))?
        };
        pos.equity = m.equity;
        pos.equity_at_open = m.equity;
        pos.liquidated = m.liquidated;
        pos.entry_ts = now;
        if pos.side != SIDE_FLAT {
            pos.entry_price = p_now;
        }
        contenders.push(Contender {
            seat: pos.seat,
            equity: m.equity,
            liquidated: m.liquidated,
            tie: tie_key(&seed, k, &pos.owner.to_bytes()),
        });
    }

    let alive_before = contenders.len() as u8;
    let cuts = if k >= FINAL_CHECKPOINT {
        0
    } else {
        cuts_at(alive_before, room.finalists_target, k)
    };
    let (eliminated, survivors) = select_cuts(contenders, cuts);

    for (i, c) in eliminated.iter().enumerate() {
        let seat = c.seat as usize;
        room.elim_checkpoint[seat] = k;
        room.placement[seat] = alive_before - i as u8;
        room.public_rank[seat] = 0;
        room.final_equity[seat] = c.equity;
        let pos = &mut positions[seat];
        pos.alive = false;
        pos.side = SIDE_FLAT;
        pos.leverage = 1;
        pos.entry_price = 0;
    }
    for (i, c) in survivors.iter().enumerate() {
        room.public_rank[c.seat as usize] = i as u8 + 1;
    }
    room.alive_count = survivors.len() as u8;
    for a in 0..room.num_assets as usize {
        if prices[a] > 0 {
            room.last_price[a] = prices[a];
        }
    }

    let ended = k >= FINAL_CHECKPOINT || survivors.len() <= 1;
    if ended {
        room.finalist_count = survivors.len().min(3) as u8;
        for (i, c) in survivors.iter().enumerate() {
            let seat = c.seat as usize;
            room.placement[seat] = i as u8 + 1;
            room.final_equity[seat] = c.equity;
            if i < 3 {
                room.finalist_seats[i] = c.seat;
            }
        }
        room.end_ts = now;
        room.set_status(RoomStatus::Ended);
        msg!("checkpoint {}: round ended, {} finalists", k, room.finalist_count);
    } else {
        room.next_checkpoint = k + 1;
        msg!(
            "checkpoint {}: cut {} of {}, {} alive",
            k,
            eliminated.len(),
            alive_before,
            room.alive_count
        );
    }

    for pos in positions.iter() {
        pos.exit(&crate::ID)?;
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------
// Storms (VRF). The room PDA pays (the ER queue is fee-exempt) and signs the request with the
// program's scoped VRF identity; the callback is authenticated by #[vrf_callback].
// ------------------------------------------------------------------------------------------

#[vrf]
#[derive(Accounts)]
pub struct RequestStorm<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: this program's VRF requester identity PDA (const address, no runtime derivation)
    #[account(address = PROGRAM_IDENTITY)]
    pub program_identity: UncheckedAccount<'info>,
    /// CHECK: VRF oracle queue (validated against SDK constants; owner checked by VRF program)
    #[account(mut, constraint = is_vrf_queue(&oracle_queue.key()) @ RoyaleError::WrongQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Permissionless, idempotent: request the current interval's storm if not yet requested.
pub fn request_storm(ctx: Context<RequestStorm>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room_key = ctx.accounts.room.key();
    let room = &ctx.accounts.room;
    if room.status() != RoomStatus::Live {
        return Ok(());
    }
    if now >= checkpoint_ts(room.start_ts, room.interval_secs, FINAL_CHECKPOINT) {
        return Ok(());
    }
    let interval = interval_of(room.start_ts, room.interval_secs, now);
    let bit = 1u8 << interval;
    if room.storms_requested & bit != 0 {
        return Ok(());
    }

    let params = RequestRandomnessParams {
        payer: room_key,
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackStorm::DISCRIMINATOR.to_vec(),
        caller_seed: hashv(&[room_key.as_ref(), &[interval], &now.to_le_bytes()]).to_bytes(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: room_key,
            is_signer: false,
            is_writable: true,
        }]),
        callback_args: Some(vec![interval]),
    };
    let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
    let id_bytes = room.room_id.to_le_bytes();
    let bump = [room.bump];
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &id_bytes, &bump];
    let identity_seeds: &[&[u8]] = &[IDENTITY, &[PROGRAM_IDENTITY_BUMP]];
    invoke_signed(
        &ix,
        &[
            ctx.accounts.room.to_account_info(),
            ctx.accounts.program_identity.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.slot_hashes.to_account_info(),
        ],
        &[identity_seeds, room_seeds],
    )?;
    ctx.accounts.room.storms_requested |= bit;
    msg!("storm requested for interval {}", interval);
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackStorm<'info> {
    /// Scoped VRF identity: its signature proves the VRF program issued this callback for us.
    #[account(address = VRF_CALLBACK_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
}

/// VRF fulfillment. Only the first callback per requested interval counts; stale ones are
/// recorded and ignored. Never errors on a valid identity, so the oracle doesn't retry forever.
pub fn callback_storm(ctx: Context<CallbackStorm>, randomness: [u8; 32], interval: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room = &mut ctx.accounts.room;
    if interval as usize >= ROUND_INTERVALS {
        return Ok(());
    }
    let bit = 1u8 << interval;
    if room.storms_requested & bit == 0 || room.storms_fulfilled & bit != 0 {
        return Ok(());
    }
    room.storms_fulfilled |= bit;
    if !room.seed_set {
        room.vrf_seed = randomness;
        room.seed_set = true;
    }
    if room.status() != RoomStatus::Live {
        return Ok(());
    }
    let current = interval_of(room.start_ts, room.interval_secs, now);
    if interval < current {
        msg!("late storm for interval {} ignored", interval);
        return Ok(());
    }
    let storm = Storm::from_randomness(&randomness, interval, room.num_assets);
    room.set_storm(&storm);
    room.storms_seen = room.storms_seen.saturating_add(1);
    msg!(
        "storm interval {} kind {} asset {} side {}",
        interval,
        storm.kind as u8,
        storm.asset,
        storm.side
    );
    Ok(())
}

// ------------------------------------------------------------------------------------------
// Exit paths: commit + undelegate back to Solana.
// ------------------------------------------------------------------------------------------

#[commit]
#[derive(Accounts)]
pub struct FinalizeRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
}

#[allow(deprecated)]
fn cancel_tasks<'info>(
    room: &'info AccountInfo<'info>,
    magic_context: &'info AccountInfo<'info>,
    magic_program: &'info AccountInfo<'info>,
    room_seeds: &[&[u8]],
) -> Result<()> {
    let room_key = *room.key;
    for salt in [0u8, 1u8] {
        CancelCrankCpi {
            authority: room,
            task_context: magic_context,
            magic_program,
            crank_id: task_id(&room_key, salt),
        }
        .invoke_signed(&[room_seeds])?;
    }
    Ok(())
}

/// Anyone, once the round has Ended: stop the crank tasks and commit + undelegate the room and
/// every position in one intent. On Solana the full trade state becomes public.
pub fn finalize_round<'info>(ctx: Context<'info, FinalizeRound<'info>>) -> Result<()> {
    let room_key = ctx.accounts.room.key();
    require!(ctx.accounts.room.status() == RoomStatus::Ended, RoyaleError::WrongStatus);
    let n = ctx.accounts.room.seats_filled as usize;
    load_positions(&ctx.accounts.room, &room_key, ctx.remaining_accounts)?;

    let id_bytes = ctx.accounts.room.room_id.to_le_bytes();
    let bump = [ctx.accounts.room.bump];
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &id_bytes, &bump];
    cancel_tasks(
        leak(ctx.accounts.room.to_account_info()),
        leak(ctx.accounts.magic_context.to_account_info()),
        leak(ctx.accounts.magic_program.to_account_info()),
        room_seeds,
    )?;

    ctx.accounts.room.exit(&crate::ID)?;
    let mut accounts = Vec::with_capacity(n + 1);
    accounts.push(ctx.accounts.room.to_account_info());
    accounts.extend(ctx.remaining_accounts.iter().take(n).cloned());
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&accounts)
    .build_and_invoke()?;
    msg!("room {} finalized: committing {} accounts", ctx.accounts.room.room_id, n + 1);
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct AbortRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
}

/// Anyone: if begin_round never ran (e.g. a player never delegated), cancel and bring the room
/// (and any delegated positions passed in) back to Solana so `refund` can pay everyone back.
pub fn abort_round<'info>(ctx: Context<'info, AbortRound<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room_key = ctx.accounts.room.key();
    require!(ctx.accounts.room.status() == RoomStatus::Starting, RoyaleError::WrongStatus);
    require!(
        now >= ctx.accounts.room.started_ts + BEGIN_TIMEOUT_SECS,
        RoyaleError::TooEarly
    );
    let mut accounts = vec![ctx.accounts.room.to_account_info()];
    for info in ctx.remaining_accounts.iter() {
        let pos = Account::<Position>::try_from(info)?;
        require_keys_eq!(pos.room, room_key, RoyaleError::PositionMismatch);
        accounts.push(info.clone());
    }
    ctx.accounts.room.set_status(RoomStatus::Cancelled);
    ctx.accounts.room.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&accounts)
    .build_and_invoke()?;
    msg!("room {} aborted before begin", ctx.accounts.room.room_id);
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct ReleasePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Not delegated in this path: the ER reads Solana's copy.
    #[account(seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut, has_one = room @ RoyaleError::PositionMismatch)]
    pub position: Box<Account<'info, Position>>,
}

/// Anyone: undelegate a position of a room that never started, so its rent can be reclaimed.
pub fn release_position(ctx: Context<ReleasePosition>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let room = &ctx.accounts.room;
    let never_started = room.status() == RoomStatus::Open
        && now >= room.fill_expiry
        && room.seats_filled < MIN_SEATS;
    require!(
        never_started || room.status() == RoomStatus::Cancelled,
        RoyaleError::WrongStatus
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.position.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}
