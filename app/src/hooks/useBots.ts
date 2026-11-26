"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import type { RoomState } from "@/lib/royale/client";
import { BOT_COUNT, RoomStatus, USDC_DECIMALS } from "@/lib/royale/constants";
import { unfinished } from "@/lib/royale/game";

type Names = ReadonlyMap<string, string>;
type Roster = { names: Names; maxEntry: bigint | null };
const NONE: Roster = { names: new Map(), maxEntry: null };
let roster: Promise<Roster> | null = null;

function loadRoster(): Promise<Roster> {
  return (roster ??= fetch("/api/bots")
    .then((r) => r.json())
    .then((j: { bots?: { address: string; name: string }[]; limits?: { maxEntry?: number | null } }) => ({
      names: new Map((j.bots ?? []).map((b) => [b.address, b.name])),
      maxEntry: typeof j.limits?.maxEntry === "number" ? BigInt(Math.round(j.limits.maxEntry * 10 ** USDC_DECIMALS)) : null,
    }))
    .catch(() => {
      roster = null;
      return NONE;
    }));
}

function useRoster(): Roster {
  const [r, setR] = useState<Roster>(NONE);
  useEffect(() => {
    let stop = false;
    loadRoster().then((x) => !stop && setR(x));
    return () => {
      stop = true;
    };
  }, []);
  return r;
}

/** House bots by address. Empty when the server has no bot pool. */
export const useBots = (): Names => useRoster().names;

/** The largest entry, in USDC base units, of a room the bots will join. Null when there is no cap. */
export const useBotMaxEntry = (): bigint | null => useRoster().maxEntry;

/** Bots still expected in an open room (three per room, never past the last seat or the entry cap). */
export function botsPending(room: RoomState, bots: Names, maxEntry: bigint | null = null): number {
  if (room.status !== RoomStatus.Open || bots.size === 0) return 0;
  if (maxEntry !== null && room.entryAmount > maxEntry) return 0;
  const seated = room.players.filter((p) => bots.has(p.toBase58())).length;
  return Math.max(0, Math.min(BOT_COUNT - seated, room.maxSeats - room.seatsFilled));
}

const EVERY_MS = { seat: 4_000, held: 15_000, trade: 5_000, finish: 8_000, lobby: 6_000 };
/** Stop asking once the room is wrapped up, or after this many tries at the same step. */
const FINISH_TRIES = 6;
/** Rooms the lobby nudges at a time. */
const LOBBY_ROOMS = 3;
/** The route's time limit: no answer comes after this. */
const NUDGE_LIMIT_MS = 60_000;

type Reply = { error?: string; errors?: string[]; skipped?: boolean; paused?: string };
async function nudge(id: string): Promise<Reply> {
  const res = await fetch("/api/bots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: id }),
    signal: AbortSignal.timeout(NUDGE_LIMIT_MS),
  });
  return (await res.json()) as Reply;
}

/**
 * While a seated player has the room open, ask the server to run its bots: take seats, trade, and
 * settle. Anyone else with the room open asks only for what is left undone: an overdue cut, the commit
 * or the payout. The server decides what is due from chain state, so extra calls are harmless.
 */
export function useBotDriver(room: RoomState | null, delegated: boolean, me: PublicKey | null, bots: Names): string | null {
  const [error, setError] = useState<string | null>(null);
  const seated = !!room && !!me && room.players.some((p) => p.equals(me));
  const state = useRef({ room, delegated, seated });
  state.current = { room, delegated, seated };
  const id = room?.roomId.toString() ?? null;
  const on = bots.size > 0;

  useEffect(() => {
    if (!on || id === null) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    let step = "";
    // When the server holds the bots back (a limit, an empty pool), ask less often.
    let held = false;
    const next = (): { gap: number; finishing: boolean } => {
      const { room: r, delegated: d, seated: mine } = state.current;
      if (!r) return { gap: 0, finishing: false };
      if (mine && r.status === RoomStatus.Open && !d) return { gap: botsPending(r, bots) > 0 ? (held ? EVERY_MS.held : EVERY_MS.seat) : 0, finishing: false };
      if (mine && r.status === RoomStatus.Live) return { gap: EVERY_MS.trade, finishing: false };
      // Each cut and each status is a step of its own with a fresh set of tries.
      const at = `${r.status}:${r.nextCheckpoint}:${d}`;
      if (at !== step) {
        step = at;
        tries = 0;
      }
      const due = unfinished(r, d, Date.now() / 1000) || (r.status === RoomStatus.Settled && (mine || !r.rated));
      return { gap: due && tries < FINISH_TRIES ? EVERY_MS.finish : 0, finishing: true };
    };
    const tick = async () => {
      const { gap, finishing } = next();
      if (gap) {
        const status = state.current.room?.status ?? 0;
        if (finishing) tries += 1;
        try {
          const j = await nudge(id);
          if (stop) return;
          // Trading errors are routine (hold time, a frozen side); a bot that can't sit down is not.
          held = !!j.paused;
          const failed = j.error ?? j.errors?.[0];
          setError(status === RoomStatus.Open ? (j.paused ?? (failed ? `Bots can't join yet: ${failed}` : null)) : null);
          if (status === RoomStatus.Settled && !j.skipped && !j.errors?.length && !j.error) tries = FINISH_TRIES;
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

/** Lobby: finish the rounds whose players have all left, a few at a time. */
export function useFinishRooms(rooms: (RoomState & { delegated: boolean })[]) {
  const bots = useBots();
  const asked = useRef(new Map<string, { tries: number; at: number }>());
  useEffect(() => {
    if (bots.size === 0) return;
    const now = Date.now();
    const due = rooms.filter((r) => {
      const a = asked.current.get(r.roomId.toString());
      return unfinished(r, r.delegated, now / 1000) && (!a || (a.tries < FINISH_TRIES && now - a.at >= EVERY_MS.lobby));
    });
    for (const r of due.slice(0, LOBBY_ROOMS)) {
      const id = r.roomId.toString();
      asked.current.set(id, { tries: (asked.current.get(id)?.tries ?? 0) + 1, at: now });
      nudge(id).catch(() => undefined); // offline: the next refresh asks again
    }
  }, [rooms, bots]);
}
