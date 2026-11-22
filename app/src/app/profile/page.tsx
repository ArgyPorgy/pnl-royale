"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { decodeRating, ratingPda, type RatingState } from "@/lib/royale/client";
import { fmtChips } from "@/lib/royale/game";

export default function Profile() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [rating, setRating] = useState<RatingState | null | undefined>(undefined);
  useEffect(() => {
    if (!publicKey) return;
    connection.getAccountInfo(ratingPda(publicKey)).then((a) => setRating(a ? decodeRating(a.data as Buffer) : null));
  }, [publicKey, connection]);
  if (!publicKey) return <div className="card p-6 text-dim">Connect a wallet to see your rating.</div>;
  if (rating === undefined) return <div className="card p-6 text-dim">Loading…</div>;
  if (rating === null) return <div className="card p-6 text-dim">No games yet. Every player starts at 1200 Elo.</div>;
  const stats: [string, string][] = [
    ["Elo", String(rating.elo)],
    ["Games", String(rating.games)],
    ["Wins", String(rating.wins)],
    ["Top 3", String(rating.top3)],
    ["Best run", `${fmtChips(rating.bestEquity)} chips`],
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Your rating</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-xs uppercase tracking-widest text-dim">{k}</div>
            <div className="tabular mt-1 text-2xl font-black">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-dim">
        Ratings update on Solana after every settled room: pairwise Elo against the whole field (K=24), scored by placement percentile.
      </p>
    </div>
  );
}
