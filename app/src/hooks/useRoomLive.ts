"use client";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeFeed, decodePosition, decodeRoom, positionPda, roomPda, type PositionState, type RoomState } from "@/lib/royale/client";
import { PROGRAM_ID } from "@/lib/royale/constants";
import type { ErLink } from "@/lib/royale/er";

export type Live = {
  roomAddress: PublicKey;
  room: RoomState | null;
  l1Room: RoomState | null;
  /** Room is delegated: live state is on the ER. */
  delegated: boolean;
  missing: boolean;
  prices: (bigint | null)[];
  history: number[][];
  position: PositionState | null;
  positionHidden: boolean;
  /** Seconds to add to Date.now()/1000 to match the chain clock (from oracle publish times). */
  skew: number;
  lastErUpdate: number;
};

export function useRoomLive(roomId: bigint | null, me: PublicKey | null, er: ErLink | null): Live {
  const { connection: l1 } = useConnection();
  const roomAddress = useMemo(() => (roomId !== null ? roomPda(roomId) : PublicKey.default), [roomId]);
  const [l1Room, setL1Room] = useState<RoomState | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [missing, setMissing] = useState(false);
  const [erRoom, setErRoom] = useState<RoomState | null>(null);
  const [prices, setPrices] = useState<(bigint | null)[]>([]);
  const [position, setPosition] = useState<PositionState | null>(null);
  const [positionHidden, setPositionHidden] = useState(false);
  const [skew, setSkew] = useState(0);
  const [lastErUpdate, setLastErUpdate] = useState(0);
  const history = useRef<number[][]>([]);

  // L1: room account (owner tells us whether it's delegated)
  useEffect(() => {
    if (roomId === null) return;
    let stop = false;
    const poll = async () => {
      try {
        const acc = await l1.getAccountInfo(roomAddress, "confirmed");
        if (stop) return;
        if (!acc) {
          setMissing(true);
          return;
        }
        setMissing(false);
        setDelegated(acc.owner.equals(DELEGATION_PROGRAM_ID));
        if (acc.owner.equals(PROGRAM_ID) || acc.owner.equals(DELEGATION_PROGRAM_ID)) {
          setL1Room(decodeRoom(roomAddress, acc.data as Buffer));
        }
      } catch (e) {
        console.warn("l1 poll", e);
      }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [l1, roomAddress, roomId]);

  const feeds = useMemo(() => (l1Room ? l1Room.feeds : []), [l1Room]);
  const myPos = useMemo(() => (me && l1Room ? positionPda(roomAddress, me) : null), [me, l1Room, roomAddress]);

  // ER: room (public), feeds (public), my position (private: readable by my session key)
  useEffect(() => {
    if (!er || feeds.length === 0) return;
    let stop = false;
    const keys = [roomAddress, ...feeds, ...(myPos ? [myPos] : [])];
    const poll = async () => {
      try {
        const infos = await er.connection.getMultipleAccountsInfo(keys, "processed");
        if (stop) return;
        const [r, ...rest] = infos;
        if (r && r.owner.equals(PROGRAM_ID)) setErRoom(decodeRoom(roomAddress, r.data as Buffer));
        const ps = feeds.map((_, i) => {
          const f = rest[i];
          return f ? decodeFeed(f.data as Buffer) : null;
        });
        setPrices(ps.map((p) => (p ? p.price : null)));
        const newest = Math.max(...ps.map((p) => p?.publishTime ?? 0));
        if (newest > 0) {
          const local = Date.now() / 1000;
          const d = newest - local;
          setSkew((s) => (Math.abs(d - s) > 1.5 ? d : s));
        }
        history.current = feeds.map((_, i) => {
          const h = history.current[i] ?? [];
          const p = ps[i]?.price;
          if (p !== undefined && p !== null) h.push(Number(p));
          return h.slice(-240);
        });
        if (myPos) {
          const pi = rest[feeds.length];
          if (pi && pi.owner.equals(PROGRAM_ID)) {
            setPosition(decodePosition(myPos, pi.data as Buffer));
            setPositionHidden(false);
          } else {
            setPositionHidden(true);
          }
        }
        setLastErUpdate(Date.now());
      } catch (e) {
        console.warn("er poll", e);
      }
    };
    poll();
    const t = setInterval(poll, 600);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [er, feeds, roomAddress, myPos]);

  const room = delegated ? erRoom ?? l1Room : l1Room;
  return {
    roomAddress,
    room,
    l1Room,
    delegated,
    missing,
    prices,
    history: history.current,
    position,
    positionHidden,
    skew,
    lastErUpdate,
  };
}

export function useNow(skew = 0, ms = 250) {
  const [now, setNow] = useState(() => Date.now() / 1000 + skew);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000 + skew), ms);
    return () => clearInterval(t);
  }, [skew, ms]);
  return now;
}
