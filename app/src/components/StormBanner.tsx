"use client";
import { ER_RPC, STORM_COPY, StormKind, VRF_EPHEMERAL_QUEUE } from "@/lib/royale/constants";
import type { RoomState } from "@/lib/royale/client";
import { assetSymbol } from "@/lib/royale/client";
import { intervalOf, stormFor } from "@/lib/royale/game";

export function StormBanner({ room, now }: { room: RoomState; now: number }) {
  if (room.status !== 2) return null;
  const interval = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, interval);
  const requested = (room.stormsRequested >> interval) & 1;
  const fulfilled = (room.stormsFulfilled >> interval) & 1;
  const copy = STORM_COPY[storm.kind];
  const active = storm.kind !== StormKind.None;
  return (
    <div key={`${interval}-${storm.kind}`} className={`card flash flex items-center justify-between gap-3 px-4 py-3 ${active ? "glow-storm" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{active ? "⚡" : requested ? "🌀" : "🌤"}</span>
        <div>
          <div className="text-sm font-bold text-storm">
            {active ? `Storm: ${copy.title}` : requested && !fulfilled ? "Rolling VRF storm…" : "Calm skies"}
          </div>
          <div className="text-xs text-dim">
            {active ? copy.blurb(assetSymbol(room, storm.asset), storm.side === 1 ? "Long" : "Short") : "A verifiable-random storm hits every minute."}
          </div>
        </div>
      </div>
      <a
        className="chip shrink-0 text-storm"
        href={`https://explorer.solana.com/address/${VRF_EPHEMERAL_QUEUE.toBase58()}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`}
        target="_blank"
        rel="noreferrer"
        title="Storms are drawn by MagicBlock VRF on the ER queue and delivered by an authenticated callback"
      >
        VRF {fulfilled ? "✓" : "…"}
      </a>
    </div>
  );
}
