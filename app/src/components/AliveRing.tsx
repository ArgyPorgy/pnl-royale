"use client";
import type { PublicKey } from "@solana/web3.js";
import type { RoomState } from "@/lib/royale/client";
import { short } from "@/lib/royale/game";

/** Seats around a ring: green = alive (with public rank), red = cut (with checkpoint), gold = finalist. */
export function AliveRing({ room, me, size = 220 }: { room: RoomState; me?: PublicKey | null; size?: number }) {
  const n = Math.max(room.seatsFilled, 1);
  const r = size / 2 - 18;
  const ended = room.status >= 3 && room.finalistCount > 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="tabular text-4xl font-black">{room.status >= 2 ? room.aliveCount : room.seatsFilled}</div>
          <div className="text-xs uppercase tracking-widest text-dim">{room.status >= 2 ? "alive" : `of ${room.maxSeats} seats`}</div>
        </div>
      </div>
      {room.players.map((p, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = size / 2 + r * Math.cos(a);
        const y = size / 2 + r * Math.sin(a);
        const out = room.elimCheckpoint[i] > 0;
        const place = room.placement[i];
        const finalist = ended && place > 0 && place <= room.finalistCount;
        const mine = me && p.equals(me);
        const color = finalist ? "bg-gold text-ink" : out ? "bg-short/25 text-short line-through" : "bg-long/20 text-long";
        return (
          <div
            key={p.toBase58()}
            title={`${short(p)}${out ? ` · cut at ${room.elimCheckpoint[i]}` : ""}${place ? ` · #${place}` : ""}`}
            className={`absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[10px] font-bold ${color} ${mine ? "ring-2 ring-white" : ""}`}
            style={{ left: x, top: y }}
          >
            {finalist ? `#${place}` : out ? `✕` : room.publicRank[i] > 0 ? room.publicRank[i] : i + 1}
          </div>
        );
      })}
    </div>
  );
}
