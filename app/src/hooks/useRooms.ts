"use client";
import { useConnection } from "@solana/wallet-adapter-react";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import { useEffect, useState } from "react";
import { decodeRoom, isOurRoom, roomDiscriminator, type RoomState } from "@/lib/royale/client";
import { PROGRAM_ID } from "@/lib/royale/constants";
import { PublicKey } from "@solana/web3.js";

const RELAYER = process.env.NEXT_PUBLIC_RELAYER_URL ?? "";

/** Rooms on L1 (owned by royale) plus rooms currently delegated (owned by the Delegation Program). */
export function useRooms() {
  const { connection } = useConnection();
  const [rooms, setRooms] = useState<(RoomState & { delegated: boolean })[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const disc = bs58.encode(roomDiscriminator());
    const load = async () => {
      const out: (RoomState & { delegated: boolean })[] = [];
      try {
        const own = await connection.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc } }] });
        for (const a of own) out.push({ ...decodeRoom(a.pubkey, a.account.data as Buffer), delegated: false });
        setError(null);
      } catch (e) {
        const m = (e as Error).message ?? String(e);
        setError(
          /403|forbidden|disabled/i.test(m)
            ? "This RPC blocks getProgramAccounts, so the lobby can't list rooms. Set NEXT_PUBLIC_L1_RPC to a Helius/Triton URL, or open a room link directly."
            : m,
        );
      }
      try {
        // A delegated room keeps its data on L1 (frozen at delegation) under the Delegation Program.
        const del = await connection.getProgramAccounts(DELEGATION_PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: disc } }],
        });
        for (const a of del) {
          const r = isOurRoom(a.pubkey, a.account.data as Buffer);
          if (r) out.push({ ...r, delegated: true });
        }
      } catch {
        /* some RPCs refuse getProgramAccounts on large programs; live rooms then show once opened */
      }
      if (out.length === 0 && RELAYER) {
        // Fallback: the relayer's public index (it uses an RPC that allows getProgramAccounts).
        try {
          const list = (await (await fetch(`${RELAYER}/rooms`)).json()) as Array<Record<string, unknown>>;
          for (const r of list) {
            out.push({
              address: new PublicKey(r.address as string),
              roomId: BigInt(r.roomId as string),
              status: r.status as number,
              delegated: r.delegated as boolean,
              seatsFilled: r.seatsFilled as number,
              maxSeats: r.maxSeats as number,
              aliveCount: r.aliveCount as number,
              entryAmount: BigInt(r.entryAmount as string),
              assets: r.assets as number[],
              intervalSecs: r.intervalSecs as number,
              private: r.private as boolean,
              createdTs: r.createdTs as number,
            } as RoomState & { delegated: boolean });
          }
          setError(null);
        } catch {
          /* relayer offline */
        }
      }
      if (!stop) setRooms(out.sort((a, b) => b.createdTs - a.createdTs));
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [connection]);
  return { rooms, error };
}
