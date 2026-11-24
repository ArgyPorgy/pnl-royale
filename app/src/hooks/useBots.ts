"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import type { RoomState } from "@/lib/royale/client";
import { BOT_COUNT, IS_DEVNET, RoomStatus } from "@/lib/royale/constants";

type Names = ReadonlyMap<string, string>;
const NONE: Names = new Map();
let roster: Promise<Names> | null = null;

function loadRoster(): Promise<Names> {
  return (roster ??= fetch("/api/bots")
    .then((r) => r.json())
    .then((j: { bots?: { address: string; name: string }[] }) => new Map((j.bots ?? []).map((b) => [b.address, b.name])))
    .catch(() => {
      roster = null;
      return NONE;
    }));
}

/** House bots by address. Empty on mainnet, or when the server has no bot key. */
export function useBots(): Names {
  const [bots, setBots] = useState<Names>(NONE);
  useEffect(() => {
    if (!IS_DEVNET) return;
    let stop = false;
    loadRoster().then((b) => !stop && setBots(b));
    return () => {
      stop = true;
    };
  }, []);
  return bots;
}

/** Bots still expected in an open room (three per room, never past the last seat). */
export function botsPending(room: RoomState, bots: Names): number {
  if (room.status !== RoomStatus.Open || bots.size === 0) return 0;
  const seated = room.players.filter((p) => bots.has(p.toBase58())).length;
  return Math.max(0, Math.min(BOT_COUNT - seated, room.maxSeats - room.seatsFilled));
}

const EVERY_MS = { seat: 4_000, trade: 5_000, wrapUp: 8_000 };
/** Stop asking once the room is wrapped up, or after this many tries at it. */
const WRAP_UP_TRIES = 6;

/**
 * While a seated player has the room open, ask the server to run its bots: take seats, trade, and
 * settle. The server decides what is due from chain state, so extra calls are harmless.
 */
export function useBotDriver(room: RoomState | null, delegated: boolean, me: PublicKey | null, bots: Names): string | null {
  const [error, setError] = useState<string | null>(null);
  const state = useRef({ room, delegated });
  state.current = { room, delegated };
  const id = room?.roomId.toString() ?? null;
  const seated = !!room && !!me && room.players.some((p) => p.equals(me));
  const on = IS_DEVNET && seated && bots.size > 0 && id !== null;

  useEffect(() => {
    if (!on) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let wrapUps = 0;
    const next = () => {
      const { room: r, delegated: d } = state.current;
      if (!r) return null;
      if (r.status === RoomStatus.Open && !d) return botsPending(r, bots) > 0 ? EVERY_MS.seat : 0;
      if (r.status === RoomStatus.Live) return EVERY_MS.trade;
      const wrap = !d && (r.status === RoomStatus.Ended || r.status === RoomStatus.Settled);
      return wrap && wrapUps < WRAP_UP_TRIES ? EVERY_MS.wrapUp : 0;
    };
    const tick = async () => {
      const gap = next();
      if (gap) {
        const status = state.current.room?.status ?? 0;
        if (status >= RoomStatus.Ended) wrapUps += 1;
        try {
          const res = await fetch("/api/bots", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ room: id }),
          });
          const j = (await res.json()) as { error?: string; errors?: string[]; rated?: boolean; reclaimed?: number };
          if (stop) return;
          // Trading errors are routine (hold time, a frozen side); a bot that can't sit down is not.
          setError(status === RoomStatus.Open ? (j.error ?? j.errors?.[0] ?? null) : null);
          if (status === RoomStatus.Settled && !j.errors?.length && !j.error) wrapUps = WRAP_UP_TRIES;
        } catch {
          /* offline: try again on the next tick */
        }
      }
      if (!stop) timer = setTimeout(tick, gap || 1_500);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [on, id, bots]);
  return error;
}
