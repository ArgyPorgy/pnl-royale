"use client";
import { Keypair } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { connectEr, type ErLink } from "@/lib/royale/er";

/** One ER link per signer. Without a session key we use a throwaway key: public reads only. */
export function useEr(signer: Keypair | null) {
  const [link, setLink] = useState<ErLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anon = useRef<Keypair | null>(null);
  const id = signer?.publicKey.toBase58() ?? "anon";
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kp = signer ?? (anon.current ??= Keypair.generate());
    const go = async () => {
      try {
        const l = await connectEr(kp);
        if (cancelled) return;
        setLink(l);
        setError(null);
        // refresh the token a minute before it expires
        if (Number.isFinite(l.expiresAt)) {
          const ms = Math.max(30_000, (l.expiresAt - Date.now() / 1000 - 60) * 1000);
          timer = setTimeout(go, ms);
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message ?? String(e));
        timer = setTimeout(go, 5_000);
      }
    };
    go();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return { er: link, erError: error };
}
