"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Award, Gamepad2, Medal, TrendingUp, Trophy, Wallet } from "lucide-react";
import { decodeRating, ratingPda, type RatingState } from "@/lib/royale/client";
import { explorerAccount } from "@/lib/royale/constants";
import { fmtChips, short } from "@/lib/royale/game";
import { Identicon } from "@/components/brand";
import { Button, Card } from "@/components/ui";

export default function Profile() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const [rating, setRating] = useState<RatingState | null | undefined>(undefined);
  useEffect(() => {
    if (!publicKey) return;
    connection.getAccountInfo(ratingPda(publicKey)).then((a) => setRating(a ? decodeRating(a.data as Buffer) : null));
  }, [publicKey, connection]);

  if (!publicKey)
    return (
      <Card>
        <div className="flex flex-col items-center py-14 text-center">
          <Wallet size={22} className="text-faint" strokeWidth={1.5} />
          <div className="mt-3 text-sm text-fg">Connect a wallet to see your rating</div>
          <Button variant="primary" className="mt-4" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        </div>
      </Card>
    );

  const stats: [typeof Trophy, string, string][] = rating
    ? [
        [TrendingUp, "Rating", String(rating.elo)],
        [Gamepad2, "Rounds played", String(rating.games)],
        [Trophy, "Wins", String(rating.wins)],
        [Medal, "Top 3 finishes", String(rating.top3)],
        [Award, "Best final equity", fmtChips(rating.bestEquity)],
      ]
    : [];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Identicon pubkey={publicKey} size={52} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
          <a href={explorerAccount(publicKey.toBase58())} target="_blank" rel="noreferrer" className="num text-[13px] text-muted hover:text-fg">
            {short(publicKey)}
          </a>
        </div>
      </div>
      {rating === undefined ? (
        <Card><div className="py-8 text-center text-sm text-muted">Loading rating…</div></Card>
      ) : rating === null ? (
        <Card>
          <div className="flex flex-col items-center py-12 text-center">
            <Trophy size={22} className="text-faint" strokeWidth={1.5} />
            <div className="mt-3 text-sm text-fg">No rounds yet</div>
            <div className="mt-1 text-[13px] text-muted">Every player starts at a 1200 rating.</div>
            <Link href="/" className="mt-4">
              <Button variant="primary">Find a room</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {stats.map(([Icon, k, v]) => (
              <Card key={k}>
                <Icon size={16} className="text-[#a99fff]" strokeWidth={1.75} />
                <div className="mt-3 text-xs text-muted">{k}</div>
                <div className="num mt-1 text-2xl text-fg">{v}</div>
              </Card>
            ))}
          </div>
          <p className="text-[13px] text-muted">
            Ratings are stored on Solana and update after every settled round: a pairwise Elo against the whole field, scored by placement.
          </p>
        </>
      )}
    </div>
  );
}
