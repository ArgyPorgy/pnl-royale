"use client";
// Live oracle prices for every whitelisted feed, read from the ER (public accounts).
import { useEffect, useState } from "react";
import { decodeFeed, priceToNumber } from "@/lib/royale/client";
import { FEEDS } from "@/lib/royale/constants";
import type { ErLink } from "@/lib/royale/er";

export type Quote = { id: number; price: number; prev: number; publishTime: number };

export function useMarket(er: ErLink | null, everyMs = 1500) {
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  useEffect(() => {
    if (!er) return;
    let stop = false;
    const poll = async () => {
      try {
        const infos = await er.connection.getMultipleAccountsInfo(FEEDS.map((f) => f.pda), "processed");
        if (stop) return;
        setQuotes((old) => {
          const next: Record<number, Quote> = { ...old };
          FEEDS.forEach((f, i) => {
            const d = infos[i] ? decodeFeed(infos[i]!.data as Buffer) : null;
            if (!d) return;
            const price = priceToNumber(d.price, f.exponent);
            next[f.id] = { id: f.id, price, prev: old[f.id]?.price ?? price, publishTime: d.publishTime };
          });
          return next;
        });
      } catch {
        /* transient ER hiccup: keep last quotes */
      }
    };
    poll();
    const t = setInterval(poll, everyMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [er, everyMs]);
  return quotes;
}
