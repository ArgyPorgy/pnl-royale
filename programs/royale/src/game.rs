//! Pure game math. No accounts, no syscalls (except hashing), so it is unit-tested on the host.
//!
//! All arithmetic is checked integer math. Prices are raw oracle integers from a single feed;
//! PnL only uses the ratio (P_now - P_entry) / P_entry, so the feed exponent cancels.

use solana_sha256_hasher::hashv;

use crate::constants::*;

pub const SIDE_FLAT: i8 = 0;
pub const SIDE_LONG: i8 = 1;
pub const SIDE_SHORT: i8 = -1;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StormKind {
    None = 0,
    /// One asset gets 2x PnL for the interval.
    Spotlight = 1,
    /// Leverage cap rises to 25x for the interval.
    Surge = 2,
    /// One side can't be opened for the first 30 s of the interval.
    Freeze = 3,
    /// Flat bleed doubles for the interval.
    ZoneShrink = 4,
}

impl StormKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => StormKind::Spotlight,
            2 => StormKind::Surge,
            3 => StormKind::Freeze,
            4 => StormKind::ZoneShrink,
            _ => StormKind::None,
        }
    }
}

/// The storm that applies to one interval.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Storm {
    pub kind: StormKind,
    pub asset: u8,
    pub side: i8,
    pub interval: u8,
}

impl Storm {
    pub const NONE: Storm = Storm {
        kind: StormKind::None,
        asset: 0,
        side: 0,
        interval: NO_STORM_INTERVAL,
    };

    /// Derive a storm from 32 bytes of VRF randomness for `interval`.
    pub fn from_randomness(randomness: &[u8; 32], interval: u8, num_assets: u8) -> Storm {
        let kind = StormKind::from_u8((randomness[0] % 4) + 1);
        let n = num_assets.max(1);
        Storm {
            kind,
            asset: randomness[1] % n,
            side: if randomness[2] % 2 == 0 { SIDE_LONG } else { SIDE_SHORT },
            interval,
        }
    }

    /// The storm effect active for an interval, or NONE if this storm belongs to another one.
    pub fn for_interval(&self, interval: u8) -> Storm {
        if self.interval == interval {
            *self
        } else {
            Storm::NONE
        }
    }

    pub fn spotlight_on(&self, asset_idx: u8) -> bool {
        self.kind == StormKind::Spotlight && self.asset == asset_idx
    }
}

/// Index of the interval containing `ts` (0..=CHECKPOINTS), clamped.
pub fn interval_of(start_ts: i64, interval_secs: u16, ts: i64) -> u8 {
    if ts <= start_ts || interval_secs == 0 {
        return 0;
    }
    let idx = (ts - start_ts) / interval_secs as i64;
    idx.min(CHECKPOINTS as i64) as u8
}

/// Unix time of checkpoint `k` (1..=FINAL_CHECKPOINT). Checkpoint FINAL is the round end.
pub fn checkpoint_ts(start_ts: i64, interval_secs: u16, k: u8) -> i64 {
    start_ts + (k as i64) * (interval_secs as i64)
}

/// Number of finalists for a room with `seats` players.
pub fn finalists_for(seats: u8) -> u8 {
    if seats >= 8 {
        3
    } else if seats >= 5 {
        2
    } else {
        1
    }
}

/// Cuts at checkpoint `k` (1..=CHECKPOINTS): ceil((alive - finalists) / checkpoints_left).
pub fn cuts_at(alive: u8, finalists: u8, k: u8) -> u8 {
    if alive <= finalists || k == 0 || k > CHECKPOINTS {
        return 0;
    }
    let left = (CHECKPOINTS - k + 1) as u32;
    let excess = (alive - finalists) as u32;
    excess.div_ceil(left) as u8
}

/// Equity after opening a position: the 5 bps spread is charged on notional.
pub fn open_cost(equity: u64, leverage: u8) -> Option<u64> {
    (equity as u128)
        .checked_mul(leverage as u128)?
        .checked_mul(FLIP_COST_BPS as u128)?
        .checked_div(BPS as u128)
        .and_then(|c| u64::try_from(c).ok())
}

/// Inputs for marking one position to market.
#[derive(Clone, Copy, Debug)]
pub struct MarkInput {
    pub equity_at_open: u64,
    pub side: i8,
    pub leverage: u8,
    pub asset_idx: u8,
    pub entry_price: i64,
    pub entry_ts: i64,
}

/// Result of a mark: new equity, and whether the position is liquidated (equity <= 0).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mark {
    pub equity: u64,
    pub liquidated: bool,
}

/// Mark a position to market at `now` with price `p_now` for its asset.
/// `storm` must be the storm of the interval the position was (re-)entered in.
pub fn mark(input: &MarkInput, p_now: i64, now: i64, storm: &Storm) -> Option<Mark> {
    let eq = input.equity_at_open as i128;
    if input.side == SIDE_FLAT {
        // The zone: flat equity bleeds per minute, pro-rated by the second.
        let dt = (now - input.entry_ts).max(0) as i128;
        let mut bps = BLEED_BPS_PER_MIN as i128;
        if storm.kind == StormKind::ZoneShrink {
            bps = bps.checked_mul(2)?;
        }
        let bleed = eq
            .checked_mul(bps)?
            .checked_mul(dt)?
            .checked_div((BPS as i128).checked_mul(60)?)?;
        let equity = eq.checked_sub(bleed)?;
        return Some(clamp_equity(equity));
    }
    if input.entry_price <= 0 || p_now <= 0 {
        return None;
    }
    let mult: i128 = if storm.spotlight_on(input.asset_idx) {
        SPOTLIGHT_MULT
    } else {
        1
    };
    let delta = (p_now as i128).checked_sub(input.entry_price as i128)?;
    let pnl = eq
        .checked_mul(input.leverage as i128)?
        .checked_mul(input.side as i128)?
        .checked_mul(delta)?
        .checked_mul(mult)?
        .checked_div(input.entry_price as i128)?;
    Some(clamp_equity(eq.checked_add(pnl)?))
}

fn clamp_equity(equity: i128) -> Mark {
    if equity <= 0 {
        Mark {
            equity: 0,
            liquidated: true,
        }
    } else {
        Mark {
            equity: u64::try_from(equity).unwrap_or(u64::MAX),
            liquidated: false,
        }
    }
}

/// Is `leverage` allowed to be opened now?
pub fn leverage_allowed(leverage: u8, storm: &Storm) -> bool {
    if ALLOWED_LEVERAGE.contains(&leverage) {
        return true;
    }
    leverage == SURGE_LEVERAGE && storm.kind == StormKind::Surge
}

/// Is opening `side` blocked by a Freeze storm at `now`?
pub fn side_frozen(side: i8, storm: &Storm, interval_start: i64, now: i64) -> bool {
    storm.kind == StormKind::Freeze
        && side != SIDE_FLAT
        && storm.side == side
        && now < interval_start + FREEZE_SECS
}

/// Deterministic, unbiased tie-break key: hash(vrf_seed, checkpoint, player).
pub fn tie_key(seed: &[u8; 32], checkpoint: u8, player: &[u8; 32]) -> [u8; 32] {
    hashv(&[seed.as_ref(), &[checkpoint], player.as_ref()]).to_bytes()
}

/// One alive player at a checkpoint.
#[derive(Clone, Copy, Debug)]
pub struct Contender {
    pub seat: u8,
    pub equity: u64,
    pub liquidated: bool,
    pub tie: [u8; 32],
}

/// Order worst-first: lower equity first, then lower tie key first.
pub fn worst_first(a: &Contender, b: &Contender) -> core::cmp::Ordering {
    a.equity.cmp(&b.equity).then_with(|| a.tie.cmp(&b.tie))
}

/// Pick who is cut. Returns (eliminated worst-first, survivors best-first).
/// The lowest `cuts` are cut, plus anyone liquidated, but at least one player always survives.
pub fn select_cuts(mut alive: Vec<Contender>, cuts: u8) -> (Vec<Contender>, Vec<Contender>) {
    alive.sort_by(worst_first);
    let n = alive.len();
    let mut cut = vec![false; n];
    for (i, c) in alive.iter().enumerate() {
        if i < cuts as usize || c.liquidated {
            cut[i] = true;
        }
    }
    if n > 0 && cut.iter().all(|&x| x) {
        // Never cut everyone: the best of the remaining field survives.
        cut[n - 1] = false;
    }
    let mut eliminated = Vec::with_capacity(n);
    let mut survivors = Vec::with_capacity(n);
    for (i, c) in alive.into_iter().enumerate() {
        if cut[i] {
            eliminated.push(c);
        } else {
            survivors.push(c);
        }
    }
    survivors.reverse();
    (eliminated, survivors)
}

/// Split `prize` among finalists given best-first equities.
/// Finalists with equal equity pool their shares and split equally (floor).
/// Returns per-finalist amounts in the same order. The caller sends the dust to the fee vault.
pub fn prize_split(prize: u64, equities_best_first: &[u64]) -> Option<Vec<u64>> {
    let split: &[u64] = match equities_best_first.len() {
        0 => return Some(vec![]),
        1 => &SPLIT_1,
        2 => &SPLIT_2,
        3 => &SPLIT_3,
        _ => return None,
    };
    let n = split.len();
    let mut out = vec![0u64; n];
    let mut i = 0;
    while i < n {
        let mut j = i + 1;
        while j < n && equities_best_first[j] == equities_best_first[i] {
            j += 1;
        }
        let pooled_bps: u64 = split[i..j].iter().sum();
        let group_total = (prize as u128)
            .checked_mul(pooled_bps as u128)?
            .checked_div(BPS as u128)?;
        let each = group_total.checked_div((j - i) as u128)?;
        let each = u64::try_from(each).ok()?;
        for slot in out.iter_mut().take(j).skip(i) {
            *slot = each;
        }
        i = j;
    }
    Some(out)
}

/// Fee on the pot, floor.
pub fn fee_of(pot: u64, fee_bps: u16) -> Option<u64> {
    let f = (pot as u128)
        .checked_mul(fee_bps as u128)?
        .checked_div(BPS as u128)?;
    u64::try_from(f).ok()
}

/// Expected score (bps) for rating difference `d = r_self - r_other`, logistic Elo curve,
/// tabulated every 50 points and linearly interpolated, clamped at +-800.
pub fn elo_expected_bps(d: i32) -> i64 {
    const TABLE: [i64; 17] = [
        5000, 5715, 6401, 7034, 7597, 8083, 8490, 8823, 9091, 9302, 9468, 9595, 9693, 9768, 9825,
        9868, 9901,
    ];
    let neg = d < 0;
    let a = (d.unsigned_abs().min(800)) as i64;
    let idx = (a / 50) as usize;
    let rem = a % 50;
    let v = if idx >= 16 {
        TABLE[16]
    } else {
        TABLE[idx] + (TABLE[idx + 1] - TABLE[idx]) * rem / 50
    };
    if neg {
        10_000 - v
    } else {
        v
    }
}

/// Elo deltas for one room. `placements` are 1 = winner .. N = first out, all distinct.
/// Actual score is the placement percentile; expected is the mean pairwise expectation.
pub fn elo_deltas(ratings: &[i32], placements: &[u8]) -> Vec<i32> {
    let n = ratings.len();
    if n < 2 || placements.len() != n {
        return vec![0; n];
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let mut exp_sum: i64 = 0;
        for j in 0..n {
            if i != j {
                exp_sum += elo_expected_bps(ratings[i].saturating_sub(ratings[j]));
            }
        }
        let expected = exp_sum / (n as i64 - 1);
        let place = placements[i].clamp(1, n as u8) as i64;
        let actual = (n as i64 - place) * 10_000 / (n as i64 - 1);
        // round half away from zero
        let num = ELO_K * (actual - expected);
        let delta = if num >= 0 {
            (num + 5_000) / 10_000
        } else {
            (num - 5_000) / 10_000
        };
        out.push(delta as i32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: i64 = 1_000_000;

    fn input(side: i8, lev: u8, entry: i64) -> MarkInput {
        MarkInput {
            equity_at_open: STARTING_CHIPS,
            side,
            leverage: lev,
            asset_idx: 0,
            entry_price: entry,
            entry_ts: START,
        }
    }

    #[test]
    fn long_and_short_pnl() {
        // +1% move at 10x long = +10%
        let m = mark(&input(SIDE_LONG, 10, 100_000_000), 101_000_000, START + 5, &Storm::NONE).unwrap();
        assert_eq!(m.equity, 11_000_000_000);
        assert!(!m.liquidated);
        // same move short = -10%
        let m = mark(&input(SIDE_SHORT, 10, 100_000_000), 101_000_000, START + 5, &Storm::NONE).unwrap();
        assert_eq!(m.equity, 9_000_000_000);
        // 2x long, -3% = -6%
        let m = mark(&input(SIDE_LONG, 2, 100_000_000), 97_000_000, START + 5, &Storm::NONE).unwrap();
        assert_eq!(m.equity, 9_400_000_000);
    }

    #[test]
    fn exponent_cancels() {
        // Same relative move, prices with different scale -> same pnl.
        let a = mark(&input(SIDE_LONG, 5, 7_022_000_000), 7_092_220_000, START, &Storm::NONE).unwrap();
        let b = mark(&input(SIDE_LONG, 5, 70_220_000), 70_922_200, START, &Storm::NONE).unwrap();
        assert_eq!(a.equity, b.equity);
    }

    #[test]
    fn liquidation_at_zero_or_below() {
        // 10x long, -10% => exactly zero => liquidated
        let m = mark(&input(SIDE_LONG, 10, 100_000_000), 90_000_000, START, &Storm::NONE).unwrap();
        assert_eq!(m, Mark { equity: 0, liquidated: true });
        // 25x short, +5% => -125% => liquidated, clamped
        let m = mark(&input(SIDE_SHORT, 25, 100_000_000), 105_000_000, START, &Storm::NONE).unwrap();
        assert_eq!(m, Mark { equity: 0, liquidated: true });
    }

    #[test]
    fn flat_bleeds_one_percent_per_minute() {
        let m = mark(&input(SIDE_FLAT, 1, 0), 0, START + 60, &Storm::NONE).unwrap();
        assert_eq!(m.equity, 9_900_000_000);
        let m = mark(&input(SIDE_FLAT, 1, 0), 0, START + 30, &Storm::NONE).unwrap();
        assert_eq!(m.equity, 9_950_000_000);
        // zone shrink doubles it
        let storm = Storm { kind: StormKind::ZoneShrink, asset: 0, side: 0, interval: 0 };
        let m = mark(&input(SIDE_FLAT, 1, 0), 0, START + 60, &storm).unwrap();
        assert_eq!(m.equity, 9_800_000_000);
        // no negative dt
        let m = mark(&input(SIDE_FLAT, 1, 0), 0, START - 10, &Storm::NONE).unwrap();
        assert_eq!(m.equity, STARTING_CHIPS);
    }

    #[test]
    fn spotlight_doubles_only_its_asset() {
        let storm = Storm { kind: StormKind::Spotlight, asset: 0, side: 0, interval: 0 };
        let m = mark(&input(SIDE_LONG, 1, 100_000_000), 101_000_000, START, &storm).unwrap();
        assert_eq!(m.equity, 10_200_000_000);
        let storm_other = Storm { asset: 1, ..storm };
        let m = mark(&input(SIDE_LONG, 1, 100_000_000), 101_000_000, START, &storm_other).unwrap();
        assert_eq!(m.equity, 10_100_000_000);
    }

    #[test]
    fn bad_prices_rejected() {
        assert!(mark(&input(SIDE_LONG, 1, 0), 100, START, &Storm::NONE).is_none());
        assert!(mark(&input(SIDE_LONG, 1, 100), 0, START, &Storm::NONE).is_none());
        assert!(mark(&input(SIDE_LONG, 1, 100), -5, START, &Storm::NONE).is_none());
    }

    #[test]
    fn huge_prices_do_not_overflow() {
        let m = mark(&input(SIDE_LONG, 25, i64::MAX / 2), i64::MAX, START, &Storm::NONE);
        assert!(m.is_some());
    }

    #[test]
    fn spread_is_5bps_of_notional() {
        assert_eq!(open_cost(STARTING_CHIPS, 1), Some(5_000_000)); // 5 chips
        assert_eq!(open_cost(STARTING_CHIPS, 10), Some(50_000_000));
        assert_eq!(open_cost(STARTING_CHIPS, 25), Some(125_000_000));
    }

    #[test]
    fn cut_schedule_matches_spec() {
        for (seats, expected) in [
            (16u8, vec![3u8, 3, 3, 2, 2]),
            (8, vec![1, 1, 1, 1, 1]),
            (7, vec![1, 1, 1, 1, 1]),
            (5, vec![1, 1, 1, 0, 0]),
            (4, vec![1, 1, 1, 0, 0]),
            (12, vec![2, 2, 2, 2, 1]),
        ] {
            let f = finalists_for(seats);
            let mut alive = seats;
            let mut got = vec![];
            for k in 1..=CHECKPOINTS {
                let c = cuts_at(alive, f, k);
                got.push(c);
                alive -= c;
            }
            assert_eq!(got, expected, "seats {seats}");
            assert_eq!(alive, f, "seats {seats} ends at finalists");
        }
    }

    #[test]
    fn finalists_by_room_size() {
        assert_eq!(finalists_for(4), 1);
        assert_eq!(finalists_for(5), 2);
        assert_eq!(finalists_for(7), 2);
        assert_eq!(finalists_for(8), 3);
        assert_eq!(finalists_for(16), 3);
    }

    #[test]
    fn interval_math() {
        assert_eq!(interval_of(START, 60, START), 0);
        assert_eq!(interval_of(START, 60, START + 59), 0);
        assert_eq!(interval_of(START, 60, START + 60), 1);
        assert_eq!(interval_of(START, 60, START + 359), 5);
        assert_eq!(interval_of(START, 60, START + 10_000), 5);
        assert_eq!(checkpoint_ts(START, 60, 6), START + 360);
    }

    fn c(seat: u8, equity: u64, liq: bool) -> Contender {
        let mut tie = [0u8; 32];
        tie[0] = seat;
        Contender { seat, equity, liquidated: liq, tie }
    }

    #[test]
    fn cuts_lowest_plus_liquidated_never_all() {
        let alive = vec![c(0, 500, false), c(1, 100, false), c(2, 0, true), c(3, 900, false), c(4, 0, true)];
        let (out, keep) = select_cuts(alive, 1);
        let out: Vec<u8> = out.iter().map(|x| x.seat).collect();
        let keep: Vec<u8> = keep.iter().map(|x| x.seat).collect();
        // worst first: liquidated 2 and 4 (equity 0, tie by seat), cuts=1 already covered by them
        assert_eq!(out, vec![2, 4]);
        assert_eq!(keep, vec![3, 0, 1]);

        // everyone liquidated: best tie survives
        let alive = vec![c(0, 0, true), c(1, 0, true)];
        let (out, keep) = select_cuts(alive, 1);
        assert_eq!(out.len(), 1);
        assert_eq!(keep.len(), 1);
        assert_eq!(keep[0].seat, 1);
    }

    #[test]
    fn ties_at_cut_line_broken_by_hash() {
        let seed = [7u8; 32];
        let p1 = [1u8; 32];
        let p2 = [2u8; 32];
        let a = Contender { seat: 0, equity: 100, liquidated: false, tie: tie_key(&seed, 1, &p1) };
        let b = Contender { seat: 1, equity: 100, liquidated: false, tie: tie_key(&seed, 1, &p2) };
        let (out1, _) = select_cuts(vec![a, b], 1);
        let (out2, _) = select_cuts(vec![b, a], 1);
        assert_eq!(out1[0].seat, out2[0].seat, "order independent");
        // different checkpoint can flip the result -> no seat bias baked in
        assert_ne!(tie_key(&seed, 1, &p1), tie_key(&seed, 2, &p1));
    }

    #[test]
    fn payouts_and_dust() {
        let prize = 15_200_000; // 16 x $1 minus 5%
        let s = prize_split(prize, &[3, 2, 1]).unwrap();
        assert_eq!(s, vec![9_120_000, 4_560_000, 1_520_000]);
        assert_eq!(s.iter().sum::<u64>(), prize);
        let s = prize_split(1_000_001, &[5, 1]).unwrap();
        assert_eq!(s, vec![700_000, 300_000]); // 1 unit of dust left for the fee vault
        let s = prize_split(999, &[9]).unwrap();
        assert_eq!(s, vec![999]);
    }

    #[test]
    fn tied_finalists_pool_shares() {
        // 1st and 2nd tie: (60+30)/2 = 45% each
        let s = prize_split(1_000_000, &[10, 10, 3]).unwrap();
        assert_eq!(s, vec![450_000, 450_000, 100_000]);
        // all three tie: 33.33% each, dust 1
        let s = prize_split(1_000_000, &[10, 10, 10]).unwrap();
        assert_eq!(s, vec![333_333, 333_333, 333_333]);
        // 2nd and 3rd tie
        let s = prize_split(1_000_000, &[11, 10, 10]).unwrap();
        assert_eq!(s, vec![600_000, 200_000, 200_000]);
    }

    #[test]
    fn fee_math() {
        assert_eq!(fee_of(16_000_000, 500), Some(800_000));
        assert_eq!(fee_of(4_000_000, 500), Some(200_000));
        assert_eq!(fee_of(1, 500), Some(0));
    }

    #[test]
    fn storm_from_randomness() {
        let mut r = [0u8; 32];
        r[0] = 0;
        r[1] = 5;
        r[2] = 1;
        let s = Storm::from_randomness(&r, 2, 3);
        assert_eq!(s.kind, StormKind::Spotlight);
        assert_eq!(s.asset, 2);
        assert_eq!(s.side, SIDE_SHORT);
        assert_eq!(s.interval, 2);
        r[0] = 3;
        assert_eq!(Storm::from_randomness(&r, 0, 1).kind, StormKind::ZoneShrink);
        assert_eq!(Storm::from_randomness(&r, 0, 1).asset, 0);
        assert_eq!(s.for_interval(3), Storm::NONE);
        assert_eq!(s.for_interval(2), s);
    }

    #[test]
    fn freeze_and_leverage_rules() {
        let surge = Storm { kind: StormKind::Surge, asset: 0, side: 0, interval: 1 };
        assert!(leverage_allowed(10, &Storm::NONE));
        assert!(!leverage_allowed(25, &Storm::NONE));
        assert!(leverage_allowed(25, &surge));
        assert!(!leverage_allowed(3, &surge));
        let freeze = Storm { kind: StormKind::Freeze, asset: 0, side: SIDE_LONG, interval: 1 };
        assert!(side_frozen(SIDE_LONG, &freeze, START, START + 10));
        assert!(!side_frozen(SIDE_LONG, &freeze, START, START + 30));
        assert!(!side_frozen(SIDE_SHORT, &freeze, START, START + 10));
        assert!(!side_frozen(SIDE_FLAT, &freeze, START, START + 10));
    }

    #[test]
    fn elo_table_and_deltas() {
        assert_eq!(elo_expected_bps(0), 5000);
        assert_eq!(elo_expected_bps(400), 9091);
        assert_eq!(elo_expected_bps(-400), 909);
        assert_eq!(elo_expected_bps(25), 5357);
        assert_eq!(elo_expected_bps(5000), 9901);
        // equal ratings, 4 players: winner +12, last -12, middle +-4
        let d = elo_deltas(&[1200, 1200, 1200, 1200], &[1, 2, 3, 4]);
        assert_eq!(d, vec![12, 4, -4, -12]);
        assert_eq!(d.iter().sum::<i32>(), 0);
        // a big favourite winning gains little
        let d = elo_deltas(&[1800, 1200], &[1, 2]);
        assert!(d[0] >= 0 && d[0] <= 1);
        let d = elo_deltas(&[1200, 1800], &[1, 2]);
        assert!(d[0] >= 23);
    }
}
