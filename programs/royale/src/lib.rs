//! PnL Royale: battle royale for traders.
//!
//! Up to 16 players stake USDC on Solana, trade live Pyth Lazer prices with hidden positions
//! inside MagicBlock's Private Ephemeral Rollup (TEE), the lowest equity is cut every interval
//! by an onchain crank, VRF storms change the rules, and the finalists split the pot on L1.

#![allow(unexpected_cfgs)]
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod game;
pub mod instructions;
pub mod oracle;
pub mod state;

use instructions::*;

declare_id!("7t2L4552mactTH9NiCcGQ3LeUgCBYi81B1qMfGTeRBJ5");

#[ephemeral]
#[program]
pub mod royale {
    use super::*;

    // ----- L1: admin -----
    pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16, min_entry: u64, max_entry: u64) -> Result<()> {
        instructions::lobby::init_config(ctx, fee_bps, min_entry, max_entry)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::lobby::update_config(ctx, args)
    }

    // ----- L1: lobby -----
    pub fn create_room(ctx: Context<CreateRoom>, args: CreateRoomArgs) -> Result<()> {
        instructions::lobby::create_room(ctx, args)
    }

    pub fn join_room(ctx: Context<JoinRoom>, viewer: Pubkey) -> Result<()> {
        instructions::lobby::join_room(ctx, viewer)
    }

    pub fn delegate_position(ctx: Context<DelegatePosition>) -> Result<()> {
        instructions::lobby::delegate_position(ctx)
    }

    pub fn start_room(ctx: Context<StartRoom>) -> Result<()> {
        instructions::lobby::start_room(ctx)
    }

    pub fn refund<'info>(ctx: Context<'info, Refund<'info>>) -> Result<()> {
        instructions::lobby::refund(ctx)
    }

    // ----- ER (TEE): round -----
    pub fn init_permission(ctx: Context<InitPermission>) -> Result<()> {
        instructions::round::init_permission(ctx)
    }

    pub fn begin_round<'info>(ctx: Context<'info, BeginRound<'info>>) -> Result<()> {
        instructions::round::begin_round(ctx)
    }

    pub fn set_position<'info>(
        ctx: Context<'info, SetPosition<'info>>,
        side: i8,
        leverage: u8,
        asset_idx: u8,
    ) -> Result<()> {
        instructions::round::set_position(ctx, side, leverage, asset_idx)
    }

    pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
        instructions::round::tick(ctx)
    }

    pub fn request_storm(ctx: Context<RequestStorm>) -> Result<()> {
        instructions::round::request_storm(ctx)
    }

    pub fn callback_storm(ctx: Context<CallbackStorm>, randomness: [u8; 32], interval: u8) -> Result<()> {
        instructions::round::callback_storm(ctx, randomness, interval)
    }

    pub fn finalize_round<'info>(ctx: Context<'info, FinalizeRound<'info>>) -> Result<()> {
        instructions::round::finalize_round(ctx)
    }

    pub fn abort_round<'info>(ctx: Context<'info, AbortRound<'info>>) -> Result<()> {
        instructions::round::abort_round(ctx)
    }

    pub fn release_position(ctx: Context<ReleasePosition>) -> Result<()> {
        instructions::round::release_position(ctx)
    }

    // ----- L1: settlement -----
    pub fn settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
        instructions::settle::settle(ctx)
    }

    pub fn rate_room<'info>(ctx: Context<'info, RateRoom<'info>>) -> Result<()> {
        instructions::settle::rate_room(ctx)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::settle::close_position(ctx)
    }

    pub fn close_room<'info>(ctx: Context<'info, CloseRoom<'info>>) -> Result<()> {
        instructions::settle::close_room(ctx)
    }
}
