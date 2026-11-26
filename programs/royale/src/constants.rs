use anchor_lang::prelude::*;

// ---------- PDA seeds (kept short: delegation deposits grow with seed size) ----------
pub const CONFIG_SEED: &[u8] = b"cfg";
pub const ROOM_SEED: &[u8] = b"room";
pub const POSITION_SEED: &[u8] = b"pos";
pub const VAULT_SEED: &[u8] = b"vault";
pub const RATING_SEED: &[u8] = b"elo";

/// Rent from closed room and vault accounts is paid here. Not the upgrade authority.
pub const RENT_RECIPIENT: Pubkey = pubkey!("DpGpgVgUyZMCq2HX4mnACi8tXALhE7U1HSQqgUSk3cTh");
/// Delegation program. A room or position it still owns is not closable on L1.
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// ---------- Room shape ----------
pub const MAX_SEATS: usize = 16;
pub const MIN_SEATS: u8 = 4;
pub const MAX_ASSETS: usize = 3;
/// Elimination checkpoints per round. The round has CHECKPOINTS + 1 intervals.
pub const CHECKPOINTS: u8 = 5;
/// Interval index used for the final mark (end of round).
pub const FINAL_CHECKPOINT: u8 = CHECKPOINTS + 1;
pub const ROUND_INTERVALS: usize = (CHECKPOINTS + 1) as usize;

pub const DEFAULT_INTERVAL_SECS: u16 = 60;
pub const MIN_INTERVAL_SECS: u16 = 15;
pub const MAX_INTERVAL_SECS: u16 = 300;
pub const DEFAULT_FILL_SECS: i64 = 600;
pub const MIN_FILL_SECS: i64 = 60;
pub const MAX_FILL_SECS: i64 = 86_400;
/// If `begin_round` has not run this long after `start_room`, anyone may abort and refund.
pub const BEGIN_TIMEOUT_SECS: i64 = 300;

/// Permission members per position: the owner wallet + an optional session-key viewer.
pub const MAX_PERMISSION_MEMBERS: usize = 2;

// ---------- Chips and trading ----------
/// 10,000.000000 chips (6 decimals). Chips are a score, not money.
pub const STARTING_CHIPS: u64 = 10_000_000_000;
pub const BPS: u64 = 10_000;
/// Spread charged on notional for each open (anti-spam, blunts latency arbitrage).
pub const FLIP_COST_BPS: u64 = 5;
pub const MIN_HOLD_SECS: i64 = 2;
/// Flat equity bleeds 1% per minute (the zone).
pub const BLEED_BPS_PER_MIN: u64 = 100;
pub const ALLOWED_LEVERAGE: [u8; 4] = [1, 2, 5, 10];
pub const SURGE_LEVERAGE: u8 = 25;
/// Spotlight storm multiplies PnL on one asset.
pub const SPOTLIGHT_MULT: i128 = 2;
/// Freeze storm blocks opening one side for this long after the interval starts.
pub const FREEZE_SECS: i64 = 30;

// ---------- Oracle ----------
pub const ORACLE_PROGRAM_ID: Pubkey = pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
/// Max upstream age for prices used by actions and checkpoints.
pub const MAX_PRICE_AGE_SECS: i64 = 3;
/// A checkpoint waits up to this long for a fresh price, then uses the last published one.
pub const STALE_DEFER_SECS: i64 = 10;
/// Even the fallback price must be at most this old.
pub const MAX_FALLBACK_AGE_SECS: i64 = 120;

/// Pinned Pyth Lazer feeds republished by the MagicBlock pricing oracle.
/// (pyth_lazer_id, feed PDA, exponent from pyth_lazer_list.json). The account's own
/// exponent field is wrong (+8), so the exponent here is only used for display; the
/// program's PnL math uses price ratios, where the exponent cancels.
pub const FEEDS: [(u16, Pubkey, i8); 24] = [
    (6, pubkey!("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"), -8), // SOL/USD
    (1, pubkey!("71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr"), -8), // BTC/USD
    (2, pubkey!("5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG"), -8), // ETH/USD
    (9, pubkey!("4WWpu2fva3uZjmZS95fezYFfoydmYi3PU7ApnqG9cYss"), -10), // BONK/USD
    (10, pubkey!("Cy6KSY9DCcJ5HiKL3H4ir6XiSC1PczCCJj7LEe9Y8A7x"), -8), // WIF/USD
    (182, pubkey!("CVFcoSKcJZGMDv9xJWNERXxHjs7KcT3RYBPLCHdG2Jok"), -8), // FARTCOIN/USD
    (130, pubkey!("AuiyyRtjbTfrnoALr48n8yzXTNYN96Q2Rrh9bBirLHdc"), -8), // POPCAT/USD
    (110, pubkey!("CxEkVoCUwSAprvAhdWRPH63JeioQVNDtyZYEMRXuLu6x"), -8), // HYPE/USD
    (14, pubkey!("6ghNHfjf5YP1aKtpAfdHK1KrtKEm5Ww6SaDffDTxf5xX"), -8), // XRP/USD
    (13, pubkey!("Gi5NTTpv9bzBQTgjKyqczJPtSbH1ojebLFgRrP3JKZYZ"), -8), // DOGE/USD
    (15, pubkey!("BYcDWZKZcGo8y3252xkK9ZrLoRoeMFaixWD6SoeW12fs"), -8), // BNB/USD
    (11, pubkey!("5WLZBMYdJ9PyNLEVxUumz9XZ11446L6dEPHGkPGehJ2j"), -8), // SUI/USD
    (18, pubkey!("HVJYkTTj3cK5SBGyfMi6GfuUKWK1zmVSs23nVcRwFhfS"), -8), // AVAX/USD
    (19, pubkey!("7PSQntC3hQvRPxQLgQTMtMM8U6JDFttmzBow3fT57tQT"), -8), // LINK/USD
    (4, pubkey!("4vNPKfsD743Qixa993s4woso36m69H3uuqcnj6GMdH7x"), -10), // PEPE/USD
    (20, pubkey!("DVtXxmCXY8YMqrfpiDNRbxmTw8BR6EvMsrrTJ4frLdJ6"), -10), // SHIB/USD
    (92, pubkey!("G2kZYbT2e2qig54RH8FY6G5ihq1QsxTZsNVuAZMV7AW2"), -8), // JUP/USD
    (97, pubkey!("4guYu7di8tSfFgt7hWntxr2v4ZJLf6yp4X8Dq7ECEbqW"), -8), // PENGU/USD
    (54, pubkey!("uXugBZDXUvFnBYF5Yizrf8TqfxsgnKBXWEEDZRC3ZtY"), -8), // RAY/USD
    (91, pubkey!("G27CrnbG37qfRH15eaXbPtNQ48VagMttoJQBarpRK5nc"), -8), // JTO/USD
    (34, pubkey!("HZFAA9ddj39Wicd1fY3TFy5fQSQvLy5867UVVLZg8CC4"), -8), // RENDER/USD
    (66, pubkey!("6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg"), -8), // ZEC/USD
    (36, pubkey!("2MtF3H7Wzkp3xM6G9gdqJp55Aht1QrQdTagCKmHqJUJj"), -8), // TAO/USD
    (27, pubkey!("9Uz4aJ2LKfc6Dt4zByG6qRDVtGbHC2ZBHissoc9x343P"), -8), // NEAR/USD
];

// ---------- Crank ----------
/// The crank ticks often and `tick` is a no-op until a checkpoint is due, so a late or
/// early scheduler run never changes the outcome.
pub const TICK_INTERVAL_MS: i64 = 2_000;
/// Extra ticks after the scheduled end, to absorb scheduler lateness.
pub const TICK_GRACE: i64 = 30;

// ---------- Economics ----------
pub const MAX_FEE_BPS: u16 = 2_000;
/// Prize split (bps of pot - fee) by number of finalists.
pub const SPLIT_1: [u64; 1] = [10_000];
pub const SPLIT_2: [u64; 2] = [7_000, 3_000];
pub const SPLIT_3: [u64; 3] = [6_000, 3_000, 1_000];

// ---------- Rating ----------
pub const ELO_START: i32 = 1_200;
pub const ELO_K: i64 = 24;
pub const ELO_FLOOR: i32 = 100;

// ---------- Sentinel values ----------
pub const NO_STORM_INTERVAL: u8 = u8::MAX;

#[cfg(test)]
mod tests {
    use super::*;

    /// Every pinned feed is the oracle's PDA for its Lazer id, and no id or account repeats.
    #[test]
    fn feeds_are_the_oracle_pdas_for_their_ids() {
        for (i, (id, key, _)) in FEEDS.iter().enumerate() {
            let (pda, _) = Pubkey::find_program_address(
                &[b"price_feed", b"pyth-lazer", id.to_string().as_bytes()],
                &ORACLE_PROGRAM_ID,
            );
            assert_eq!(pda, *key, "feed {id}");
            assert!(FEEDS[..i].iter().all(|(other, k, _)| other != id && k != key), "duplicate feed {id}");
        }
    }
}
