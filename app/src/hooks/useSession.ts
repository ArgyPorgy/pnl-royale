"use client";
// Browser-held session key: signs set_position on the ER (no wallet popups) and is a
// permission member of the player's sealed position (reads it through the TEE).
import { Keypair, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";

type Stored = { secret: number[]; validUntil: number };
const key = (wallet: PublicKey) => `royale.session.v2.${wallet.toBase58()}`;

export function loadSession(wallet: PublicKey): { kp: Keypair; validUntil: number } | null {
  try {
    const raw = localStorage.getItem(key(wallet));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return { kp: Keypair.fromSecretKey(Uint8Array.from(s.secret)), validUntil: s.validUntil };
  } catch {
    return null;
  }
}

export function saveSession(wallet: PublicKey, kp: Keypair, validUntil: number) {
  try {
    localStorage.setItem(key(wallet), JSON.stringify({ secret: Array.from(kp.secretKey), validUntil } satisfies Stored));
  } catch {
    /* private mode: session lives for this tab only */
  }
}

export function useSession(wallet: PublicKey | null) {
  const [session, setSession] = useState<{ kp: Keypair; validUntil: number } | null>(null);
  useEffect(() => {
    setSession(wallet ? loadSession(wallet) : null);
  }, [wallet]);
  const valid = !!session && session.validUntil > Date.now() / 1000 + 60;
  /** A fresh key (not yet registered on-chain). Persist it once its create_session tx lands. */
  const fresh = useCallback(() => Keypair.generate(), []);
  const commit = useCallback(
    (kp: Keypair, validUntil: number) => {
      if (!wallet) return;
      saveSession(wallet, kp, validUntil);
      setSession({ kp, validUntil });
    },
    [wallet],
  );
  return { session, valid, fresh, commit };
}
