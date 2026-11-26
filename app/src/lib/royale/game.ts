// Client-side mirror of the program's game math, for display only (the chain is the referee).
import { BLEED_BPS_PER_MIN, CHECKPOINTS, FINAL_CHECKPOINT, RoomStatus, StormKind } from "./constants";
import type { PositionState, RoomState } from "./client";

export const intervalOf = (startTs: number, intervalSecs: number, ts: number) =>
  ts <= startTs || intervalSecs === 0 ? 0 : Math.min(Math.floor((ts - startTs) / intervalSecs), CHECKPOINTS);

export const checkpointTs = (room: Pick<RoomState, "startTs" | "intervalSecs">, k: number) =>
  room.startTs + k * room.intervalSecs;

export const roundEndTs = (room: Pick<RoomState, "startTs" | "intervalSecs">) => checkpointTs(room, FINAL_CHECKPOINT);

/** The onchain crank makes every cut. One this late is overdue, so anyone may send it. */
const OVERDUE_SECS = 3;
export const cutOverdue = (room: RoomState, now: number) =>
  room.status === RoomStatus.Live && now > checkpointTs(room, room.nextCheckpoint) + OVERDUE_SECS;

/** Sealing the positions takes a few seconds between start_room and the round clock. */
const START_SLACK_SECS = 20;
/**
 * True for a round that may have nobody left to finish it: a cut is overdue, or it ended unpaid. Solana's
 * copy of a delegated room is frozen at start_room and has no round clock, so a room still `Starting` there
 * counts once a whole round has passed.
 */
export function unfinished(room: RoomState, delegated: boolean, now: number): boolean {
  if (room.status === RoomStatus.Ended) return true;
  if (room.status === RoomStatus.Live) return cutOverdue(room, now);
  if (room.status !== RoomStatus.Starting || !delegated) return false;
  return now > room.startedTs + FINAL_CHECKPOINT * room.intervalSecs + START_SLACK_SECS;
}

export type Storm = { kind: StormKind; asset: number; side: number; interval: number };

export const stormFor = (room: RoomState, interval: number): Storm => {
  const kind = (room.stormKind[interval] ?? 0) as StormKind;
  return { kind, asset: room.stormAsset[interval] ?? 0, side: room.stormSide[interval] ?? 0, interval };
};

/** Live equity estimate for the player's own position (chips, 6 decimals) from live prices. */
export function liveEquity(room: RoomState, pos: PositionState, prices: (bigint | null)[], now: number): bigint {
  if (!pos.alive || pos.liquidated) return pos.equity;
  const storm = stormFor(room, intervalOf(room.startTs, room.intervalSecs, pos.entryTs));
  const eq = pos.equityAtOpen;
  if (pos.side === 0) {
    const dt = BigInt(Math.max(0, Math.floor(now - pos.entryTs)));
    const bps = BigInt(storm.kind === StormKind.ZoneShrink ? BLEED_BPS_PER_MIN * 2 : BLEED_BPS_PER_MIN);
    const v = eq - (eq * bps * dt) / (10_000n * 60n);
    return v > 0n ? v : 0n;
  }
  const p = prices[pos.assetIdx];
  if (!p || pos.entryPrice <= 0n) return eq;
  const mult = storm.kind === StormKind.Spotlight && storm.asset === pos.assetIdx ? 2n : 1n;
  const pnl = (eq * BigInt(pos.leverage) * BigInt(pos.side) * (p - pos.entryPrice) * mult) / pos.entryPrice;
  const v = eq + pnl;
  return v > 0n ? v : 0n;
}

export const chips = (v: bigint) => Number(v) / 1e6;
export const fmtChips = (v: bigint) =>
  chips(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Signed chips: +12.30, -4.00, 0.00. */
export const fmtPnl = (v: bigint) => {
  const n = Math.round(chips(v) * 100) / 100;
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}`;
};
export const fmtUsdc = (v: bigint) =>
  (Number(v) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `sig`: significant digits for tiny prices. */
export const fmtPrice = (x: number, sig = 4) => {
  if (!x) return "—";
  if (x >= 1000) return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x >= 1) return x.toFixed(x >= 100 ? 2 : 3);
  if (x >= 0.01) return x.toFixed(5);
  if (x >= 0.0001) return x.toFixed(6);
  // DEX-style subscript zeros: 0.0000020711 -> 0.0₅20711
  const zeros = Math.floor(-Math.log10(x)); // leading zeros after the decimal point
  const digits = Math.round(x * 10 ** (zeros + sig)).toString();
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `0.0${sub}${digits}`;
};

export const short = (k: { toBase58(): string } | string) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

export const prizeSplit = (finalists: number): number[] =>
  finalists >= 3 ? [60, 30, 10] : finalists === 2 ? [70, 30] : [100];

export const finalistsFor = (seats: number) => (seats >= 8 ? 3 : seats >= 5 ? 2 : 1);

/** Players removed at cut `k` (mirror of the program's `cuts_at`): the excess spread over the cuts left. */
export function cutsAt(alive: number, finalists: number, k: number): number {
  if (alive <= finalists || k === 0 || k > CHECKPOINTS) return 0;
  return Math.ceil((alive - finalists) / (CHECKPOINTS - k + 1));
}

/** The program's payout per finalist seat: the split by place, with tied equities pooling their shares. */
export function roomPayouts(r: RoomState): Map<number, bigint> {
  const out = new Map<number, bigint>();
  if (r.status !== RoomStatus.Settled || r.finalistCount === 0) return out;
  const pot = r.entryAmount * BigInt(r.seatsFilled);
  const prize = pot - (pot * BigInt(r.feeBps)) / 10_000n;
  const split = prizeSplit(r.finalistCount).map((p) => BigInt(p * 100));
  const seats = r.finalistSeats.slice(0, r.finalistCount);
  for (let i = 0; i < seats.length; ) {
    let j = i + 1;
    while (j < seats.length && r.finalEquity[seats[j]] === r.finalEquity[seats[i]]) j++;
    const pooled = split.slice(i, j).reduce((a, b) => a + b, 0n);
    const each = (prize * pooled) / 10_000n / BigInt(j - i);
    for (let k = i; k < j; k++) out.set(seats[k], each);
    i = j;
  }
  return out;
}

/** House bots never keep what they win: rooms that end from this time on share it back. */
export const BOT_SHARE_SINCE = Date.UTC(2026, 10, 26, 13, 35) / 1000;

/**
 * What the house bots won in a settled room, split evenly over every seat. Each player gets `each`
 * back from the bot pool; the bots' own shares stay in the pool. Zero when no bot finished in the money.
 */
export function botShare(r: RoomState, isBot: (p: RoomState["players"][number]) => boolean) {
  let won = 0n;
  for (const [seat, amount] of roomPayouts(r)) if (isBot(r.players[seat])) won += amount;
  const each = r.seatsFilled ? won / BigInt(r.seatsFilled) : 0n;
  const humans = r.players.filter((p) => !isBot(p));
  return { won, each, humans, returned: each * BigInt(humans.length) };
}
