//! Base-layer settlement: USDC payouts from the escrow, Elo, rent reclaim.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::RoyaleError;
use crate::game::{elo_deltas, fee_of, prize_split};
use crate::state::*;

#[derive(Accounts)]
pub struct Settle<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// Must be back on Solana (owned by this program again): Anchor's owner check enforces it.
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut, seeds = [VAULT_SEED, room.key().as_ref()], bump = room.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        address = config.fee_vault @ RoyaleError::PayoutAccountMismatch,
        token::mint = room.mint
    )]
    pub fee_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = room.mint @ RoyaleError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: receives the emptied vault's rent.
    #[account(mut, address = room.creator @ RoyaleError::Unauthorized)]
    pub creator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Anyone, once: pay the finalists (remaining accounts = their USDC token accounts, best-first)
/// and send the fee plus any dust to the fee vault. Payouts + fee == vault balance, exactly.
pub fn settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
    let room = &ctx.accounts.room;
    require!(room.status() != RoomStatus::Settled, RoyaleError::AlreadySettled);
    require!(room.status() == RoomStatus::Ended, RoyaleError::WrongStatus);
    let f = room.finalist_count as usize;
    require!((1..=3).contains(&f), RoyaleError::WrongStatus);
    require!(ctx.remaining_accounts.len() == f, RoyaleError::PayoutAccountMismatch);

    let pot = room.pot().ok_or(error!(RoyaleError::MathOverflow))?;
    let balance = ctx.accounts.vault.amount;
    require!(balance >= pot, RoyaleError::VaultShort);
    let fee = fee_of(pot, room.fee_bps).ok_or(error!(RoyaleError::MathOverflow))?;
    let prize = pot.checked_sub(fee).ok_or(error!(RoyaleError::MathOverflow))?;
    let equities: Vec<u64> = (0..f)
        .map(|i| room.final_equity[room.finalist_seats[i] as usize])
        .collect();
    let split = prize_split(prize, &equities).ok_or(error!(RoyaleError::MathOverflow))?;
    let paid: u64 = split.iter().try_fold(0u64, |a, x| a.checked_add(*x)).ok_or(error!(RoyaleError::MathOverflow))?;
    require!(paid <= prize, RoyaleError::MathOverflow);
    // Fee + rounding dust + anything sent to the vault by mistake.
    let to_fee_vault = balance.checked_sub(paid).ok_or(error!(RoyaleError::MathOverflow))?;

    let id_bytes = room.room_id.to_le_bytes();
    let bump = [room.bump];
    let seeds: &[&[u8]] = &[ROOM_SEED, &id_bytes, &bump];
    let decimals = ctx.accounts.mint.decimals;
    let mint = room.mint;
    let winners: Vec<Pubkey> = (0..f).map(|i| room.players[room.finalist_seats[i] as usize]).collect();

    for (i, info) in ctx.remaining_accounts.iter().enumerate() {
        let ta = Account::<TokenAccount>::try_from(info)?;
        require_keys_eq!(ta.owner, winners[i], RoyaleError::PayoutAccountMismatch);
        require_keys_eq!(ta.mint, mint, RoyaleError::PayoutAccountMismatch);
        if split[i] == 0 {
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
            split[i],
            decimals,
        )?;
        msg!("paid place {} {}", i + 1, split[i]);
    }
    if to_fee_vault > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: ctx.accounts.room.to_account_info(),
                },
                &[seeds],
            ),
            to_fee_vault,
            decimals,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.room.to_account_info(),
        },
        &[seeds],
    ))?;
    ctx.accounts.room.set_status(RoomStatus::Settled);
    msg!("settled: pot {} fee+dust {}", pot, to_fee_vault);
    Ok(())
}

#[derive(Accounts)]
pub struct RateRoom<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
}

/// Anyone, once: pairwise Elo update vs the field. Remaining = Rating accounts in seat order.
pub fn rate_room<'info>(ctx: Context<'info, RateRoom<'info>>) -> Result<()> {
    let room = &ctx.accounts.room;
    let st = room.status();
    require!(st == RoomStatus::Ended || st == RoomStatus::Settled, RoyaleError::WrongStatus);
    require!(!room.rated, RoyaleError::AlreadyRated);
    let n = room.seats_filled as usize;
    require!(ctx.remaining_accounts.len() == n, RoyaleError::RatingMismatch);

    let mut ratings = Vec::with_capacity(n);
    for (i, info) in ctx.remaining_accounts.iter().enumerate() {
        let r = Account::<Rating>::try_from(info)?;
        require_keys_eq!(r.player, room.players[i], RoyaleError::RatingMismatch);
        require!(room.placement[i] > 0, RoyaleError::WrongStatus);
        ratings.push(r);
    }
    let elos: Vec<i32> = ratings.iter().map(|r| r.elo).collect();
    let places: Vec<u8> = room.placement[..n].to_vec();
    let deltas = elo_deltas(&elos, &places);
    for (i, r) in ratings.iter_mut().enumerate() {
        r.elo = (r.elo + deltas[i]).max(ELO_FLOOR);
        r.games = r.games.saturating_add(1);
        if places[i] == 1 {
            r.wins = r.wins.saturating_add(1);
        }
        if places[i] <= 3 {
            r.top3 = r.top3.saturating_add(1);
        }
        r.best_equity = r.best_equity.max(room.final_equity[i]);
        r.last_room = room.room_id;
        r.exit(&crate::ID)?;
    }
    ctx.accounts.room.rated = true;
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [ROOM_SEED, &room.room_id.to_le_bytes()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(
        mut,
        close = owner,
        seeds = [POSITION_SEED, room.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ RoyaleError::Unauthorized,
        has_one = room @ RoyaleError::PositionMismatch
    )]
    pub position: Box<Account<'info, Position>>,
}

/// Owner: reclaim the Position's rent after the room is settled or cancelled.
pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
    let st = ctx.accounts.room.status();
    require!(
        st == RoomStatus::Settled || st == RoomStatus::Cancelled,
        RoyaleError::PositionInUse
    );
    Ok(())
}
