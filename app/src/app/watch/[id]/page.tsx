"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { RoomStatus, feedById } from "@/lib/royale/constants";
import { fmtUsdc } from "@/lib/royale/game";
import { buildPreview } from "@/lib/ui/preview";
import { useEr } from "@/hooks/useEr";
import { useNow, useRoomLive } from "@/hooks/useRoomLive";
import { useBotDriver, useBots } from "@/hooks/useBots";
import { TokenStack } from "@/components/brand";
import { ChartPanel, PlayersTable, RoundProgress, StormBanner, StormCard } from "@/components/room";
import { TeeBadge } from "@/components/TeeBadge";
import { GameFx, SoundToggle } from "@/components/GameFx";
import { Button, Empty, Pill } from "@/components/ui";

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
  const nowChain = useNow(live.skew);
  const [asset, setAsset] = useState(0);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setPreviewKey(new URLSearchParams(window.location.search).get("preview"));
  }, []);
  const preview = useMemo(() => buildPreview(previewKey === "spectate" || previewKey === "live" ? "spectate" : previewKey), [previewKey]);
  const bots = useBots();
  useBotDriver(preview ? null : live.room, live.delegated, null, bots);
  const room = preview?.room ?? live.room;
  const prices = preview ? preview.prices : live.prices;
  const history = preview ? preview.history : live.history;
  const now = preview ? Date.now() / 1000 : nowChain;
  if (roomId === null) return <Empty icon={<Eye size={18} />} title="Bad link" action={<Back />} />;
  if (!preview && live.missing) return <Empty icon={<Eye size={18} />} title="Room not found" body="Not on this network." action={<Back />} />;
  if (!room) return <Empty loading title="Loading" />;
  const isLive = room.status === RoomStatus.Live;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/room/${room.roomId}${preview ? "?preview=live" : ""}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
            <ArrowLeft size={14} /> Back to room
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <TokenStack ids={room.assets} size={28} />
            <h1 className="display text-3xl">Spectator · {room.roomId.toString().slice(-6)}</h1>
            <Pill tone={isLive ? "accent" : "neutral"} dot={isLive}>
              <Eye size={12} /> {isLive ? "Live" : "Replay"}
            </Pill>
          </div>
          <p className="subhead mt-2 text-2xl text-white">Positions stay sealed.</p>
          <div className="mt-2 text-[13px] text-muted">
            Pot <span className="num text-fg">${fmtUsdc(room.entryAmount * BigInt(room.seatsFilled))}</span> · {room.assets.map((id) => feedById(id)?.symbol).join(" · ")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <TeeBadge er={er} error={erError} />
        </div>
      </div>
      {room.status !== RoomStatus.Open && room.status !== RoomStatus.Cancelled && <GameFx room={room} now={now} me={null} bots={bots} />}
      {isLive && <StormBanner room={room} now={now} />}
      {isLive && <RoundProgress room={room} now={now} />}
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <ChartPanel room={room} prices={prices} history={history} asset={asset} onAsset={setAsset} />
        <div className="space-y-5">
          <PlayersTable room={room} me={null} payouts={room.status >= RoomStatus.Ended} />
          {isLive && <StormCard room={room} now={now} />}
          <Link href={`/room/${room.roomId}${preview ? "?preview=live" : ""}`}>
            <Button className="w-full">Open the room</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Back() {
  return (
    <Link href="/">
      <Button size="sm">
        <ArrowLeft size={14} /> All rooms
      </Button>
    </Link>
  );
}
