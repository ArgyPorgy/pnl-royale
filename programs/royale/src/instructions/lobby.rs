//! Base-layer (Solana L1) instructions: config, rooms, USDC escrow, delegation, refunds.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::*;
use crate::errors::RoyaleError;
use crate::game::{finalists_for, SIDE_FLAT};
use crate::state::*;

// ------------------------------------------------------------------------------------------
// Config
// ------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, Config>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(token::mint = usdc_mint)]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    /// Only the program's upgrade authority can create the config (no front-running on deploy).
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ RoyaleError::Unauthorized)]
    pub program: Program<'info, crate::program::Royale>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ RoyaleError::Unauthorized)]
    pub program_data: Box<Account<'info, ProgramData>>,
    pub system_program: Program<'info, System>,
}

pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16, min_entry: u64, max_entry: u64) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, RoyaleError::InvalidFee);
    require!(min_entry > 0 && min_entry <= max_entry, RoyaleError::InvalidEntry);
    let cfg = &mut ctx.accounts.config;
    cfg.admin = ctx.accounts.admin.key();
    cfg.fee_vault = ctx.accounts.fee_vault.key();
    cfg.usdc_mint = ctx.accounts.usdc_mint.key();
    cfg.fee_bps = fee_bps;
    cfg.min_entry = min_entry;
    cfg.max_entry = max_entry;
    cfg.paused = false;
    cfg.bump = ctx.bumps.config;
    cfg.rooms_created = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RoyaleError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    /// Optional new fee vault (must hold the configured mint).
    #[account(token::mint = config.usdc_mint)]
    pub fee_vault: Option<Box<Account<'info, TokenAccount>>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateConfigArgs {
    pub fee_bps: Option<u16>,
    pub min_entry: Option<u64>,
    pub max_entry: Option<u64>,
    pub paused: Option<bool>,
    pub new_admin: Option<Pubkey>,
}

/// Pause only blocks new rooms and joins. It never blocks refunds, rounds in flight or settle.
pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    if let Some(f) = args.fee_bps {
        require!(f <= MAX_FEE_BPS, RoyaleError::InvalidFee);
        cfg.fee_bps = f;
    }
    if let Some(v) = args.min_entry {
        cfg.min_entry = v;
    }
    if let Some(v) = args.max_entry {
        cfg.max_entry = v;
    }
    require!(cfg.min_entry > 0 && cfg.min_entry <= cfg.max_entry, RoyaleError::InvalidEntry);
    if let Some(p) = args.paused {
        cfg.paused = p;
    }
    if let Some(a) = args.new_admin {
        cfg.admin = a;
    }
    if let Some(v) = &ctx.accounts.fee_vault {
        cfg.fee_vault = v.key();
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------
// Rooms
// ------------------------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateRoomArgs {
    pub room_id: u64,
    pub entry_amount: u64,
    pub max_seats: u8,
    /// Pyth Lazer ids from the pinned whitelist, 1 to 3, distinct.
    pub assets: Vec<u16>,
    /// Seconds until the room may start short-handed or be cancelled. 0 = default (10 min).
    pub fill_secs: i64,
    /// Seconds per interval (6 intervals per round). 0 = default (60 s).
    pub interval_secs: u16,
    /// Seal positions inside the TEE with owner-only permissions.
    pub private: bool,
}

#[derive(Accounts)]
#[instruction(args: CreateRoomArgs)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Room::INIT_SPACE,
        seeds = [ROOM_SEED, &args.room_id.to_le_bytes()],
        bump
    )]
    pub room: Box<Account<'info, Room>>,
    /// Escrow. Never delegated; authority is the room PDA.
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, room.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = room,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ RoyaleError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_room(ctx: Context<CreateRoom>, args: CreateRoomArgs) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    require!(!cfg.paused, RoyaleError::Paused);
    require!(
        args.entry_amount >= cfg.min_entry && args.entry_amount <= cfg.max_entry,
        RoyaleError::InvalidEntry
    );
    require!(
        args.max_seats >= MIN_SEATS && args.max_seats as usize <= MAX_SEATS,
        RoyaleError::InvalidSeats
    );
    let n = args.assets.len();
    require!(n >= 1 && n <= MAX_ASSETS, RoyaleError::InvalidAssets);
    let fill_secs = if args.fill_secs == 0 { DEFAULT_FILL_SECS } else { args.fill_secs };
    require!(
        (MIN_FILL_SECS..=MAX_FILL_SECS).contains(&fill_secs),
        RoyaleError::InvalidTiming
    );
    let interval = if args.interval_secs == 0 { DEFAULT_INTERVAL_SECS } else { args.interval_secs };
    require!(
        (MIN_INTERVAL_SECS..=MAX_INTERVAL_SECS).contains(&interval),
        RoyaleError::InvalidTiming
    );

    let now = Clock::get()?.unix_timestamp;
    let room = &mut ctx.accounts.room;
    room.room_id = args.room_id;
    room.creator = ctx.accounts.creator.key();
    room.mint = ctx.accounts.mint.key();
    room.entry_amount = args.entry_amount;
    room.fee_bps = cfg.fee_bps;
    room.set_status(RoomStatus::Open);
    room.max_seats = args.max_seats;
    room.seats_filled = 0;
    room.alive_count = 0;
    room.next_checkpoint = 1;
    room.num_assets = n as u8;
    room.interval_secs = interval;
    for (i, id) in args.assets.iter().enumerate() {
        let feed = FEEDS
            .iter()
            .find(|(fid, _, _)| fid == id)
            .ok_or(error!(RoyaleError::InvalidAssets))?;
        require!(!args.assets[..i].contains(id), RoyaleError::InvalidAssets);
        room.assets[i] = *id;
        room.feeds[i] = feed.1;
        room.exponents[i] = feed.2;
    }
    room.created_ts = now;
    room.fill_expiry = now + fill_secs;
    room.private = args.private;
    room.bump = ctx.bumps.room;
    room.vault_bump = ctx.bumps.vault;
    cfg.rooms_created = cfg.rooms_created.saturating_add(1);
    msg!("room {} created: entry {} seats {}", args.room_id, args.entry_amount, args.max_seats);
    Ok(())
}

#[derive(Accounts)]
pub struct JoinRoom<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(
        init,
        payer = player,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, room.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Rating::INIT_SPACE,
        seeds = [RATING_SEED, player.key().as_ref()],
        bump
    )]
    pub rating: Box<Account<'info, Rating>>,
    #[account(mut, token::mint = room.mint, token::authority = player)]
    pub player_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump = room.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = room.mint @ RoyaleError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn join_room(ctx: Context<JoinRoom>, viewer: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let player = ctx.accounts.player.key();
    {
        let room = &ctx.accounts.room;
        require!(!ctx.accounts.config.paused, RoyaleError::Paused);
        require!(room.status() == RoomStatus::Open, RoyaleError::RoomNotOpen);
        require!(room.seats_filled < room.max_seats, RoyaleError::RoomFull);
        require!(now < room.fill_expiry, RoyaleError::FillExpired);
        require!(room.seat_of(&player).is_none(), RoyaleError::AlreadyJoined);
    }

    // Escrow the entry on L1.
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        ctx.accounts.room.entry_amount,
        ctx.accounts.mint.decimals,
    )?;

    // Pre-fund the position with rent for its ER-local EphemeralPermission (owner only).
    if ctx.accounts.room.private {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.position.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(
                EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
            ),
        )?;
    }

    let room_key = ctx.accounts.room.key();
    let room = &mut ctx.accounts.room;
    let seat = room.seats_filled;
    room.players[seat as usize] = player;
    room.seats_filled += 1;

    let pos = &mut ctx.accounts.position;
    pos.room = room_key;
    pos.owner = player;
    pos.seat = seat;
    pos.bump = ctx.bumps.position;
    pos.side = SIDE_FLAT;
    pos.leverage = 1;
    pos.asset_idx = 0;
    pos.alive = true;
    pos.liquidated = false;
    pos.permissioned = false;
    pos.entry_price = 0;
    pos.entry_ts = now;
    pos.equity_at_open = STARTING_CHIPS;
    pos.equity = STARTING_CHIPS;
    pos.last_action_ts = 0;
    pos.actions = 0;
    pos.viewer = viewer;

    let rating = &mut ctx.accounts.rating;
    if rating.player == Pubkey::default() {
        rating.player = player;
        rating.elo = ELO_START;
        rating.bump = ctx.bumps.rating;
    }
    msg!("seat {} joined room {}", seat, room.room_id);
    Ok(())
}

/// Delegate the caller's Position to the ER validator passed as the first remaining account
/// (the mainnet TEE for private rooms). Sent in the same transaction as `join_room`.
#[delegate]
#[derive(Accounts)]
pub struct DelegatePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: the caller's position PDA; seeds checked here and by the delegation program.
    #[account(mut, del, seeds = [POSITION_SEED, room.key().as_ref(), payer.key().as_ref()], bump)]
    pub position: UncheckedAccount<'info>,
}

pub fn delegate_position(ctx: Context<DelegatePosition>) -> Result<()> {
    require!(ctx.accounts.room.status() == RoomStatus::Open, RoyaleError::RoomNotOpen);
    require!(
        ctx.accounts.position.owner == &crate::ID,
        RoyaleError::PositionMismatch
    );
    let room_key = ctx.accounts.room.key();
    let payer_key = ctx.accounts.payer.key();
    let validator = ctx.remaining_accounts.first().map(|a| a.key());
    ctx.accounts.delegate_position(
        &ctx.accounts.payer,
        &[POSITION_SEED, room_key.as_ref(), payer_key.as_ref()],
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Lock the roster and delegate the Room to the ER validator (first remaining account). Needs at
/// least 4 seats. The room's creator may start as soon as those are filled; anyone may start once
/// the room is full or the fill window has passed.
#[delegate]
#[derive(Accounts)]
pub struct StartRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the Room PDA. Deserialized by hand so Anchor doesn't re-serialize it after
    /// ownership moves to the delegation program.
    #[account(mut, del)]
    pub room: UncheckedAccount<'info>,
}

pub fn start_room(ctx: Context<StartRoom>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.room.owner == &crate::ID, RoyaleError::StillDelegated);
    let mut room: Room = {
        let data = ctx.accounts.room.try_borrow_data()?;
        Room::try_deserialize(&mut &data[..])?
    };
    let expected = Pubkey::create_program_address(
        &[ROOM_SEED, &room.room_id.to_le_bytes(), &[room.bump]],
        &crate::ID,
    )
    .map_err(|_| error!(RoyaleError::Unauthorized))?;
    require_keys_eq!(expected, ctx.accounts.room.key(), RoyaleError::Unauthorized);
    require!(room.status() == RoomStatus::Open, RoyaleError::RoomNotOpen);
    require!(room.seats_filled >= MIN_SEATS, RoyaleError::NotStartable);
    let host = room.creator == ctx.accounts.payer.key();
    require!(
        host || room.seats_filled == room.max_seats || now >= room.fill_expiry,
        RoyaleError::NotStartable
    );
    room.set_status(RoomStatus::Starting);
    room.started_ts = now;
    room.alive_count = room.seats_filled;
    room.finalists_target = finalists_for(room.seats_filled);
    {
        let mut data = ctx.accounts.room.try_borrow_mut_data()?;
        room.try_serialize(&mut &mut data[..])?;
    }

    let id_bytes = room.room_id.to_le_bytes();
    let validator = ctx.remaining_accounts.first().map(|a| a.key());
    ctx.accounts.delegate_room(
        &ctx.accounts.payer,
        &[ROOM_SEED, &id_bytes],
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    msg!("room {} started with {} seats", room.room_id, room.seats_filled);
    Ok(())
}

// ------------------------------------------------------------------------------------------
// Refunds (cancel path). Permissionless and resumable: pass any subset of the players'
// USDC token accounts; each seat is refunded once.
// ------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump = room.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = room.mint @ RoyaleError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn refund<'info>(ctx: Context<'info, Refund<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    match ctx.accounts.room.status() {
        RoomStatus::Open => {
            require!(
                now >= ctx.accounts.room.fill_expiry && ctx.accounts.room.seats_filled < MIN_SEATS,
                RoyaleError::NotCancellable
            );
            ctx.accounts.room.set_status(RoomStatus::Cancelled);
        }
        RoomStatus::Cancelled => {}
        _ => return err!(RoyaleError::NotCancellable),
    }

    let room_id = ctx.accounts.room.room_id.to_le_bytes();
    let bump = [ctx.accounts.room.bump];
    let seeds: &[&[u8]] = &[ROOM_SEED, &room_id, &bump];
    for info in ctx.remaining_accounts.iter() {
        let ta = Account::<TokenAccount>::try_from(info)?;
        require_keys_eq!(ta.mint, ctx.accounts.room.mint, RoyaleError::WrongMint);
        let seat = ctx
            .accounts
            .room
            .seat_of(&ta.owner)
            .ok_or(error!(RoyaleError::PayoutAccountMismatch))?;
        let bit = 1u16 << seat;
        if ctx.accounts.room.refunded & bit != 0 {
            continue;
        }
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: info.clone(),
                    authority: ctx.accounts.room.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.room.entry_amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.room.refunded |= bit;
        msg!("refunded seat {}", seat);
    }
    Ok(())
}
