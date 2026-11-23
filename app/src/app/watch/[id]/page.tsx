"use client";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { RoomStatus, feedById } from "@/lib/royale/constants";
import { fmtUsdc } from "@/lib/royale/game";
import { useEr } from "@/hooks/useEr";
import { useNow, useRoomLive } from "@/hooks/useRoomLive";
import { TokenStack } from "@/components/brand";
import { ChartPanel, PlayersTable, RoundProgress, StormCard } from "@/components/room";
import { TeeBadge } from "@/components/TeeBadge";
import { Button, Card, Pill } from "@/components/ui";

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
  const [asset, setAsset] = useState(0);
  const room = live.room;
  if (!room) return <Card><div className="py-10 text-center text-sm text-muted">Loading room…</div></Card>;
  const isLive = room.status === RoomStatus.Live;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/room/${room.roomId}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
            <ArrowLeft size={14} /> Back to room
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <TokenStack ids={room.assets} size={26} />
            <h1 className="text-2xl font-semibold tracking-tight">Spectating room {room.roomId.toString().slice(-6)}</h1>
            <Pill tone={isLive ? "down" : "neutral"} dot={isLive}>
              <Eye size={12} /> {isLive ? "Live" : "Replay"}
            </Pill>
          </div>
          <div className="mt-1.5 text-[13px] text-muted">
            Pot <span className="num text-fg">${fmtUsdc(room.entryAmount * BigInt(room.seatsFilled))}</span> ·{" "}
            {room.assets.map((id) => feedById(id)?.symbol).join(" · ")}
          </div>
        </div>
        <TeeBadge er={er} error={erError} />
      </div>
      {isLive && <RoundProgress room={room} now={now} />}
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <ChartPanel room={room} prices={live.prices} asset={asset} onAsset={setAsset} />
        <div className="space-y-5">
          <PlayersTable room={room} me={null} payouts={room.status >= RoomStatus.Ended} />
          {isLive && <StormCard room={room} now={now} />}
          <Link href={`/room/${room.roomId}`}>
            <Button className="w-full">Open the room</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
