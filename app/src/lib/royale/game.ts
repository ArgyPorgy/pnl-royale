// Client-side mirror of the program's game math, for display only (the chain is the referee).
import { BLEED_BPS_PER_MIN, CHECKPOINTS, FINAL_CHECKPOINT, StormKind } from "./constants";
import type { PositionState, RoomState } from "./client";

export const intervalOf = (startTs: number, intervalSecs: number, ts: number) =>
  ts <= startTs || intervalSecs === 0 ? 0 : Math.min(Math.floor((ts - startTs) / intervalSecs), CHECKPOINTS);

export const checkpointTs = (room: Pick<RoomState, "startTs" | "intervalSecs">, k: number) =>
  room.startTs + k * room.intervalSecs;

export const roundEndTs = (room: Pick<RoomState, "startTs" | "intervalSecs">) => checkpointTs(room, FINAL_CHECKPOINT);

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

export const fmtPrice = (x: number) => {
  if (!x) return "—";
  if (x >= 1000) return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x >= 1) return x.toFixed(x >= 100 ? 2 : 3);
  if (x >= 0.01) return x.toFixed(5);
  if (x >= 0.0001) return x.toFixed(6);
  // DEX-style subscript zeros: 0.0000020711 -> 0.0₅20711
  const zeros = Math.floor(-Math.log10(x)); // leading zeros after the decimal point
  const digits = Math.round(x * 10 ** (zeros + 4)).toString();
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
