use anchor_lang::prelude::*;

use crate::constants::*;
use crate::game::{Storm, StormKind};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// USDC token account that receives fees and dust.
    pub fee_vault: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub min_entry: u64,
    pub max_entry: u64,
    pub paused: bool,
    pub bump: u8,
    pub rooms_created: u64,
    pub reserved: [u8; 32],
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomStatus {
    /// Accepting joins on L1.
    Open = 0,
    /// Delegated to the TEE, waiting for permissions + begin_round.
    Starting = 1,
    /// Round running on the TEE.
    Live = 2,
    /// Final ranking written; waiting for commit + undelegate, then settle on L1.
    Ended = 3,
    /// Paid out on L1.
    Settled = 4,
    /// Refund path.
    Cancelled = 5,
}

#[account]
#[derive(InitSpace)]
pub struct Room {
    pub room_id: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub entry_amount: u64,
    pub fee_bps: u16,
    pub status: u8,
    pub max_seats: u8,
    pub seats_filled: u8,
    pub alive_count: u8,
    pub finalists_target: u8,
    /// Next checkpoint to process (1..=FINAL_CHECKPOINT).
    pub next_checkpoint: u8,
    pub num_assets: u8,
    pub interval_secs: u16,
    pub assets: [u16; MAX_ASSETS],
    pub feeds: [Pubkey; MAX_ASSETS],
    pub exponents: [i8; MAX_ASSETS],
    pub created_ts: i64,
    pub fill_expiry: i64,
    /// When start_room delegated the room.
    pub started_ts: i64,
    /// Round clock origin (begin_round).
    pub start_ts: i64,
    pub end_ts: i64,
    pub players: [Pubkey; MAX_SEATS],
    /// 0 = alive; k = cut at checkpoint k.
    pub elim_checkpoint: [u8; MAX_SEATS],
    /// Final placement, 1 = winner. 0 = still alive.
    pub placement: [u8; MAX_SEATS],
    /// Rank among the alive at the last checkpoint (1 = leader). 0 = eliminated / not yet ranked.
    pub public_rank: [u8; MAX_SEATS],
    /// Equity at elimination or at the end. Never written while a player is alive.
    pub final_equity: [u64; MAX_SEATS],
    /// Oracle prices used at the last checkpoint (public input, for the UI).
    pub last_price: [i64; MAX_ASSETS],
    /// Number of finalists at the end (1..=3), seats in `finalist_seats` best-first.
    pub finalist_count: u8,
    pub finalist_seats: [u8; 3],
    /// One storm slot per interval (0..=CHECKPOINTS). Kind 0 = no storm.
    pub storm_kind: [u8; ROUND_INTERVALS],
    pub storm_asset: [u8; ROUND_INTERVALS],
    pub storm_side: [i8; ROUND_INTERVALS],
    /// Bitmask of intervals whose storm was requested / fulfilled.
    pub storms_requested: u8,
    pub storms_fulfilled: u8,
    pub storms_seen: u8,
    pub vrf_seed: [u8; 32],
    pub seed_set: bool,
    pub task_id: i64,
    pub ticks: u32,
    /// TEE privacy on: begin_round requires every position to have an owner-only permission.
    pub private: bool,
    pub rated: bool,
    /// Bitmask of seats refunded on the cancel path.
    pub refunded: u16,
    pub bump: u8,
    pub vault_bump: u8,
    pub reserved: [u8; 64],
}

impl Room {
    pub fn status(&self) -> RoomStatus {
        match self.status {
            0 => RoomStatus::Open,
            1 => RoomStatus::Starting,
            2 => RoomStatus::Live,
            3 => RoomStatus::Ended,
            4 => RoomStatus::Settled,
            _ => RoomStatus::Cancelled,
        }
    }

    pub fn set_status(&mut self, s: RoomStatus) {
        self.status = s as u8;
    }

    /// The storm for `interval`, or NONE.
    pub fn storm_for(&self, interval: u8) -> Storm {
        let i = interval as usize;
        if i >= ROUND_INTERVALS {
            return Storm::NONE;
        }
        let kind = StormKind::from_u8(self.storm_kind[i]);
        if kind == StormKind::None {
            return Storm::NONE;
        }
        Storm {
            kind,
            asset: self.storm_asset[i],
            side: self.storm_side[i],
            interval,
        }
    }

    pub fn set_storm(&mut self, s: &Storm) {
        let i = s.interval as usize;
        if i < ROUND_INTERVALS {
            self.storm_kind[i] = s.kind as u8;
            self.storm_asset[i] = s.asset;
            self.storm_side[i] = s.side;
        }
    }

    pub fn seat_of(&self, player: &Pubkey) -> Option<usize> {
        self.players[..self.seats_filled as usize]
            .iter()
            .position(|p| p == player)
    }

    pub fn signer_seeds_bytes(&self) -> [u8; 8] {
        self.room_id.to_le_bytes()
    }

    pub fn pot(&self) -> Option<u64> {
        self.entry_amount.checked_mul(self.seats_filled as u64)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub room: Pubkey,
    pub owner: Pubkey,
    pub seat: u8,
    pub bump: u8,
    /// -1 short, 0 flat, 1 long.
    pub side: i8,
    pub leverage: u8,
    pub asset_idx: u8,
    pub alive: bool,
    pub liquidated: bool,
    pub permissioned: bool,
    pub entry_price: i64,
    /// When the current position was opened or last re-marked at a checkpoint.
    pub entry_ts: i64,
    pub equity_at_open: u64,
    /// Equity at the last mark (private while the round runs).
    pub equity: u64,
    pub last_action_ts: i64,
    pub actions: u32,
    /// The player's browser session key: a second permission member, so the app can read the
    /// sealed position through the TEE without another wallet popup. Default = none.
    pub viewer: Pubkey,
    pub reserved: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Rating {
    pub player: Pubkey,
    pub elo: i32,
    pub games: u32,
    pub wins: u32,
    pub top3: u32,
    pub best_equity: u64,
    pub last_room: u64,
    pub bump: u8,
    pub reserved: [u8; 16],
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Delegated accounts must stay under the validators' 10,240-byte commit limit.
    #[test]
    fn account_sizes_fit_commit_limit() {
        let room = 8 + Room::INIT_SPACE;
        let pos = 8 + Position::INIT_SPACE;
        println!("Config {} · Room {} · Position {} · Rating {}", 8 + Config::INIT_SPACE, room, pos, 8 + Rating::INIT_SPACE);
        assert!(room < 10_240 && pos < 10_240);
    }
}
