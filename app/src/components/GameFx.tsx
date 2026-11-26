"use client";
// The round's drama: a countdown into every cut, a red pulse while one is close, a hit when it lands,
// and a banner that says who is out, whether you made it, and who won. Sounds come from `sfx`.
import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { PublicKey } from "@solana/web3.js";
import { CHECKPOINTS, RoomStatus, StormKind } from "@/lib/royale/constants";
import type { RoomState } from "@/lib/royale/client";
import { checkpointTs, cutsAt, intervalOf, short, stormFor } from "@/lib/royale/game";
import { sfx, useMuted } from "@/lib/ui/sound";
import { cx } from "@/components/ui";

type Tone = "cut" | "safe" | "out" | "win" | "go";
type Banner = { id: number; tone: Tone; kicker: string; title: string; sub?: string };
const BANNER_MS = 2600;
const COUNT_FROM = 5;
const PULSE_FROM = 10;

export function SoundToggle() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      title={muted ? "Sound off" : "Sound on"}
      className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-muted transition-colors hover:bg-white/10 hover:text-fg"
    >
      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  );
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function shake() {
  if (reduced()) return;
  const el = document.querySelector("main");
  if (!el) return;
  el.classList.remove("fx-shake");
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add("fx-shake");
  setTimeout(() => el.classList.remove("fx-shake"), 500);
}

export function GameFx({ room, now, me }: { room: RoomState; now: number; me: PublicKey | null }) {
  const seat = me ? room.players.findIndex((p) => p.equals(me)) : -1;
  const name = (i: number) => (i === seat ? "You" : short(room.players[i]));
  const [banner, setBanner] = useState<Banner | null>(null);
  const [flash, setFlash] = useState<{ id: number; tone: Tone } | null>(null);
  const [confetti, setConfetti] = useState(0);
  const prev = useRef<{ status: number; next: number; storm: number } | null>(null);
  const seq = useRef(0);

  const show = (b: Omit<Banner, "id">, hit = true) => {
    const id = ++seq.current;
    setBanner({ ...b, id });
    if (hit && !reduced()) {
      setFlash({ id, tone: b.tone });
      setTimeout(() => setFlash((x) => (x?.id === id ? null : x)), 600);
    }
    setTimeout(() => setBanner((x) => (x?.id === id ? null : x)), BANNER_MS);
  };

  const live = room.status === RoomStatus.Live;
  const interval = live ? intervalOf(room.startTs, room.intervalSecs, now) : -1;
  const stormKind = live ? stormFor(room, interval).kind : StormKind.None;

  // Events: compare each new room state with the last one seen. The first render only takes a reading.
  useEffect(() => {
    const was = prev.current;
    prev.current = { status: room.status, next: room.nextCheckpoint, storm: stormKind === StormKind.None ? -1 : interval };
    if (!was) return;
    const alive = seat >= 0 && room.elimCheckpoint[seat] === 0;

    if (was.status !== RoomStatus.Live && room.status === RoomStatus.Live) {
      sfx("start");
      show({ tone: "go", kicker: "Round live", title: "Go", sub: `First cut in ${Math.max(0, Math.round(checkpointTs(room, 1) - Date.now() / 1000))}s` });
      return;
    }

    const ended = room.status === RoomStatus.Ended || room.status === RoomStatus.Settled;
    for (let k = was.next; k < room.nextCheckpoint && k <= CHECKPOINTS; k++) {
      const out = room.players.map((_, i) => i).filter((i) => room.elimCheckpoint[i] === k);
      if (out.length === 0) continue;
      const mine = seat >= 0 && room.elimCheckpoint[seat] === k;
      shake();
      if (mine) {
        sfx("out");
        show({ tone: "out", kicker: `Cut ${k}`, title: "Eliminated", sub: `You finish #${room.placement[seat] || room.aliveCount + out.length}` });
      } else if (alive) {
        sfx("cut");
        setTimeout(() => sfx("survive"), 380);
        show({ tone: "safe", kicker: `Cut ${k} · ${out.map(name).join(", ")} out`, title: "Survived", sub: `${room.aliveCount} left` });
      } else {
        sfx("cut");
        show({ tone: "cut", kicker: `Cut ${k}`, title: `${out.map(name).join(", ")} out`, sub: `${room.aliveCount} left` });
      }
    }

    if (!(was.status === RoomStatus.Ended || was.status === RoomStatus.Settled) && ended && was.status === RoomStatus.Live) {
      const place = seat >= 0 ? room.placement[seat] : 0;
      const winner = room.finalistCount > 0 ? room.finalistSeats[0] : -1;
      setTimeout(() => {
        if (place > 0 && place <= room.finalistCount) {
          sfx("win");
          setConfetti((n) => n + 1);
          show({ tone: "win", kicker: "Final bell", title: place === 1 ? "Winner" : `#${place} · In the money` });
        } else if (winner >= 0) {
          sfx("cut");
          show({ tone: "cut", kicker: "Final bell", title: `${name(winner)} ${winner === seat ? "win" : "wins"}` });
        }
      }, 600);
    }

    // A new storm interval: a rumble (the storm banner on the page says what it is).
    if (live && stormKind !== StormKind.None && was.storm !== interval) sfx("storm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status, room.nextCheckpoint, stormKind, interval]);

  // The countdown into each cut.
  const due = live ? checkpointTs(room, room.nextCheckpoint) : 0;
  const left = due - now;
  const cutting = live && room.nextCheckpoint <= CHECKPOINTS + 1;
  const count = cutting && left > 0 && left <= COUNT_FROM ? Math.ceil(left) : null;
  const waiting = cutting && left <= 0 && left > -15;
  const lastTick = useRef<string>("");
  useEffect(() => {
    if (count === null) return;
    const key = `${room.nextCheckpoint}:${count}`;
    if (lastTick.current === key) return;
    lastTick.current = key;
    sfx(count <= 3 ? "tickHigh" : "tick");
  }, [count, room.nextCheckpoint]);

  const alive = seat >= 0 && room.elimCheckpoint[seat] === 0;
  const final = room.nextCheckpoint > CHECKPOINTS;
  const outNext = final ? 0 : cutsAt(room.aliveCount, room.finalistsTarget, room.nextCheckpoint);
  const rank = seat >= 0 ? room.publicRank[seat] : 0;
  // Ranks come from the last cut; positions are sealed, so this is where you stood then.
  const inZone = alive && outNext > 0 && rank > 0 && rank > room.aliveCount - outNext;
  const pulse = cutting && alive && left > 0 && left <= PULSE_FROM ? 1 - left / PULSE_FROM : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
      {pulse > 0 && (
        <div
          className="fx-vignette absolute inset-0"
          style={{ opacity: 0.25 + pulse * (inZone ? 0.75 : 0.45), animationDuration: `${Math.max(0.35, 1 - pulse * 0.6)}s` }}
        />
      )}
      {flash && <div key={`flash-${flash.id}`} className={cx("fx-flash absolute inset-0", flash.tone === "out" ? "bg-down/40" : flash.tone === "win" ? "bg-accent/30" : "bg-white/25")} />}

      {(count !== null || waiting) && !banner && (
        <div className="absolute inset-x-0 top-[22%] flex flex-col items-center">
          <div className={cx("kicker mb-1 rounded-full bg-black/50 px-3 py-1 backdrop-blur", inZone ? "text-down" : "text-white")}>
            {final ? "Final bell" : `Cut ${room.nextCheckpoint}${outNext ? ` · ${outNext} out` : ""}`}
          </div>
          {count !== null ? (
            <div key={count} className={cx("fx-count display text-[120px] leading-none sm:text-[168px]", inZone || count <= 3 ? "text-down" : "text-white")}>
              {count}
            </div>
          ) : (
            <div className="fx-pending display text-[64px] leading-none text-white sm:text-[88px]">{final ? "Bell" : "Cut"}</div>
          )}
          {inZone && count !== null && <div className="mt-2 rounded-full bg-down/90 px-3 py-1 text-xs font-semibold text-white">You were in the cut zone last time. Climb.</div>}
        </div>
      )}

      {banner && (
        <div key={`banner-${banner.id}`} className="fx-band absolute inset-x-0 top-[26%] flex justify-center px-4">
          <div
            className={cx(
              "fx-result flex flex-col items-center justify-center overflow-hidden rounded-[28px] border px-3 text-center shadow-2xl backdrop-blur-md sm:px-6",
              banner.tone === "out" && "border-down/50 bg-[#2a0d15]/90",
              banner.tone === "safe" && "border-up/40 bg-[#0c2117]/90",
              banner.tone === "win" && "border-accent/50 bg-[#22260c]/90",
              (banner.tone === "cut" || banner.tone === "go") && "border-white/15 bg-black/80",
            )}
          >
            <div className="kicker w-full text-balance text-muted">{banner.kicker}</div>
            <div
              className={cx(
                "display mt-1 w-full",
                banner.tone === "out" ? "text-down" : banner.tone === "safe" ? "text-up" : banner.tone === "win" ? "text-accent" : "text-white",
              )}
            >
              {banner.title}
            </div>
            {banner.sub && <div className="subhead mt-1 w-full text-sm text-white sm:text-base">{banner.sub}</div>}
          </div>
        </div>
      )}

      {confetti > 0 && <Confetti key={`confetti-${confetti}`} />}
    </div>
  );
}

const CONFETTI_COLORS = ["#e6f77a", "#4ade80", "#ffffff", "#c98a7e", "#7b6aa8"];

function Confetti() {
  const [on, setOn] = useState(true);
  const bits = useMemo(
    () =>
      Array.from({ length: reduced() ? 0 : 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 2.2 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 220,
        spin: (Math.random() - 0.5) * 1080,
        w: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [],
  );
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 4500);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="fx-confetti absolute top-0 block rounded-[2px]"
          style={
            {
              left: `${b.left}%`,
              width: b.w,
              height: b.w * 0.45,
              background: b.color,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.dur}s`,
              "--drift": `${b.drift}px`,
              "--spin": `${b.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
