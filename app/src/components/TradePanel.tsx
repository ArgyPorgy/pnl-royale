"use client";
import { useState } from "react";
import type { PositionState, RoomState } from "@/lib/royale/client";
import { assetSymbol, priceToNumber } from "@/lib/royale/client";
import { LEVERAGES, MIN_HOLD_SECS, StormKind, SURGE_LEVERAGE, FREEZE_SECS, feedById } from "@/lib/royale/constants";
import { checkpointTs, fmtPrice, intervalOf, stormFor } from "@/lib/royale/game";
import { Sparkline } from "./Sparkline";

type Props = {
  room: RoomState;
  position: PositionState | null;
  prices: (bigint | null)[];
  history: number[][];
  now: number;
  busy: boolean;
  onTrade: (side: -1 | 0 | 1, lev: number, asset: number) => void;
};

export function TradePanel({ room, position, prices, history, now, busy, onTrade }: Props) {
  const [asset, setAsset] = useState(position?.assetIdx ?? 0);
  const [lev, setLev] = useState(position && position.side !== 0 ? position.leverage : 5);
  const interval = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, interval);
  const levels = storm.kind === StormKind.Surge ? [...LEVERAGES, SURGE_LEVERAGE] : [...LEVERAGES];
  const frozenSide =
    storm.kind === StormKind.Freeze && now < checkpointTs(room, interval) + FREEZE_SECS ? storm.side : 0;
  const holdLeft = position ? Math.max(0, position.lastActionTs + MIN_HOLD_SECS - now) : 0;
  const dead = !!position && (!position.alive || position.liquidated);
  const disabled = busy || dead || holdLeft > 0 || room.status !== 2;
  const feed = feedById(room.assets[asset]);
  const p = prices[asset];
  const price = p && feed ? priceToNumber(p, feed.exponent) : 0;
  const entry =
    position && position.side !== 0 && position.assetIdx === asset && feed
      ? priceToNumber(position.entryPrice, feed.exponent)
      : undefined;
  const spot = storm.kind === StormKind.Spotlight ? storm.asset : -1;

  return (
    <div className="card p-4">
      <div className="flex gap-2">
        {room.assets.map((id, i) => (
          <button
            key={id}
            onClick={() => setAsset(i)}
            className={`btn flex-1 border px-3 py-2 text-sm ${i === asset ? "border-white/60 bg-white/10" : "border-line text-dim"}`}
          >
            {feedById(id)?.emoji} {assetSymbol(room, i)}
            {spot === i && <span className="ml-1 text-storm">2×</span>}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="tabular text-3xl font-black">${fmtPrice(price)}</div>
        <div className="text-right text-[11px] text-dim">
          Pyth Lazer via MagicBlock oracle
          <br />
          read on the TEE every action
        </div>
      </div>
      <Sparkline data={history[asset] ?? []} entry={entry ? entry / Math.pow(10, feed!.exponent) : undefined} />

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-dim">Leverage</span>
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => setLev(l)}
            className={`btn px-3 py-1.5 text-sm ${l === lev ? "bg-gold text-ink" : "border border-line text-dim"} ${l === SURGE_LEVERAGE ? "glow-storm" : ""}`}
          >
            {l}×
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          disabled={disabled || frozenSide === 1}
          onClick={() => onTrade(1, lev, asset)}
          className="btn glow-long bg-long py-5 text-xl text-ink"
        >
          LONG {frozenSide === 1 && "🧊"}
        </button>
        <button
          disabled={disabled || frozenSide === -1}
          onClick={() => onTrade(-1, lev, asset)}
          className="btn glow-short bg-short py-5 text-xl text-ink"
        >
          SHORT {frozenSide === -1 && "🧊"}
        </button>
      </div>
      <button
        disabled={disabled || position?.side === 0}
        onClick={() => onTrade(0, 1, position?.assetIdx ?? 0)}
        className="btn mt-3 w-full border border-line py-3 text-sm text-dim"
      >
        FLAT (close) · flat bleeds {storm.kind === StormKind.ZoneShrink ? "2%" : "1%"}/min
      </button>
      <div className="mt-2 h-4 text-center text-xs text-dim">
        {dead ? "You're out." : holdLeft > 0 ? `hold ${holdLeft.toFixed(1)}s` : busy ? "sending to the TEE…" : "5 bps spread on notional per open"}
      </div>
    </div>
  );
}
