"use client";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { assetSymbol, priceToNumber } from "@/lib/royale/client";
import { RoomStatus, feedById } from "@/lib/royale/constants";
import { checkpointTs, fmtChips, fmtPrice, fmtUsdc, short } from "@/lib/royale/game";
import { useEr } from "@/hooks/useEr";
import { useNow, useRoomLive } from "@/hooks/useRoomLive";
import { AliveRing } from "@/components/AliveRing";
import { StormBanner } from "@/components/StormBanner";
import { Sparkline } from "@/components/Sparkline";
import { TeeBadge } from "@/components/TeeBadge";

/** Spectator board: public room state only. Positions stay sealed until the round ends. */
export default function Watch() {
  const params = useParams<{ id: string }>();
  const roomId = useMemo(() => {
    try {
      return BigInt(params.id);
    } catch {
      return null;
    }
  }, [params.id]);
  const { er, erError } = useEr(null);
  const live = useRoomLive(roomId, null, er);
  const now = useNow(live.skew);
  const room = live.room;
  if (!room) return <div className="card p-6 text-dim">Loading…</div>;
  const ranked = room.players
    .map((p, i) => ({ p, i, rank: room.publicRank[i], place: room.placement[i], out: room.elimCheckpoint[i] }))
    .sort((a, b) => (a.out && b.out ? a.place - b.place : a.out ? 1 : b.out ? -1 : (a.rank || 99) - (b.rank || 99)));
  const secs = room.status === RoomStatus.Live ? Math.max(0, checkpointTs(room, room.nextCheckpoint) - now) : 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/room/${room.roomId}`} className="text-xs text-dim">← room</Link>
          <h1 className="text-2xl font-black">Spectating #{room.roomId.toString().slice(-6)}</h1>
          <div className="text-sm text-dim">pot {fmtUsdc(room.entryAmount * BigInt(room.seatsFilled))} USDC</div>
        </div>
        <TeeBadge er={er} error={erError} />
      </div>
      <StormBanner room={room} now={now} />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <AliveRing room={room} size={260} />
          {room.status === RoomStatus.Live && (
            <div className="mt-2 text-center">
              <div className="text-xs uppercase tracking-widest text-dim">next cut</div>
              <div className="tabular text-4xl font-black">{secs.toFixed(1)}s</div>
            </div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-widest text-dim">Leaderboard (ranks published at each cut)</div>
          <ol className="mt-2 space-y-1 text-sm">
            {ranked.map((r) => (
              <li key={r.p.toBase58()} className={`flex justify-between rounded-lg px-2 py-1 ${r.out ? "text-short/70" : ""}`}>
                <span className="font-mono">{short(r.p)}</span>
                <span>
                  {r.out ? `cut @${r.out} · ${fmtChips(room.finalEquity[r.i])}` : r.place ? `#${r.place} · ${fmtChips(room.finalEquity[r.i])}` : r.rank ? `rank ${r.rank}` : "alive"}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card space-y-3 p-4">
          {room.assets.map((id, i) => {
            const f = feedById(id)!;
            const p = live.prices[i];
            return (
              <div key={id}>
                <div className="flex justify-between text-sm">
                  <span>{f.emoji} {assetSymbol(room, i)}</span>
                  <span className="tabular font-bold">${p ? fmtPrice(priceToNumber(p, f.exponent)) : "—"}</span>
                </div>
                <Sparkline data={live.history[i] ?? []} height={40} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
