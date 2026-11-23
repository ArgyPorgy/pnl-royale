"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Award, Gamepad2, Medal, TrendingUp, Trophy, Wallet } from "lucide-react";
import { decodeRating, ratingPda, type RatingState } from "@/lib/royale/client";
import { explorerAccount } from "@/lib/royale/constants";
import { fmtChips, short } from "@/lib/royale/game";
import { PREVIEW_RATING } from "@/lib/ui/preview";
import { Identicon } from "@/components/brand";
import { Button, Card, Empty } from "@/components/ui";

const rankTitle = (elo: number) => (elo >= 1700 ? "Royale" : elo >= 1500 ? "Champion" : elo >= 1350 ? "Finalist" : elo >= 1200 ? "Contender" : "Floor");

export default function Profile() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const [rating, setRating] = useState<RatingState | null | undefined>(undefined);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setPreview(new URLSearchParams(window.location.search).get("preview") === "rated");
  }, []);
  useEffect(() => {
    if (!publicKey) return;
    connection.getAccountInfo(ratingPda(publicKey)).then((a) => setRating(a ? decodeRating(a.data as Buffer) : null));
  }, [publicKey, connection]);

  if (!publicKey && !preview)
    return (
      <Empty
        icon={<Wallet size={20} strokeWidth={1.6} />}
        title="Your rating lives with your wallet"
        body="Connect to read the Elo account stored on Solana. New players start at 1,200."
        action={
          <Button variant="primary" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        }
      />
    );

  const shown = rating
    ? rating
    : preview
      ? { elo: PREVIEW_RATING.elo, games: PREVIEW_RATING.games, wins: PREVIEW_RATING.wins, top3: PREVIEW_RATING.top3, bestEquity: PREVIEW_RATING.bestEquity }
      : rating;
  const stats: [typeof Trophy, string, string][] = shown
    ? [
        [TrendingUp, "Rating", String(shown.elo)],
        [Gamepad2, "Rounds", String(shown.games)],
        [Trophy, "Wins", String(shown.wins)],
        [Medal, "Top 3", String(shown.top3)],
        [Award, "Best equity", fmtChips(shown.bestEquity)],
      ]
    : [];
  const elo = shown?.elo ?? 1200;
  const ring = Math.max(0, Math.min(1, (elo - 900) / 900));
  return (
    <div className="space-y-8">
      <div className="mesh flex flex-wrap items-center gap-5 rounded-[28px] border border-white/10 px-5 py-5">
        {publicKey ? <Identicon pubkey={publicKey} size={64} /> : <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-black"><Trophy size={22} /></span>}
        <div>
          <div className="kicker">{rankTitle(elo)}</div>
          <h1 className="display mt-1 text-4xl">Rating</h1>
          {publicKey && (
            <a href={explorerAccount(publicKey.toBase58())} target="_blank" rel="noreferrer" className="num text-[13px] text-muted hover:text-fg">
              {short(publicKey)}
            </a>
          )}
        </div>
        <RatingRing elo={elo} ring={ring} />
      </div>
      {shown === undefined ? (
        <Card>
          <div className="space-y-3 py-6">
            <div className="skeleton mx-auto h-8 w-40" />
            <div className="text-center text-sm text-muted">Loading rating…</div>
          </div>
        </Card>
      ) : shown === null ? (
        <Empty
          icon={<Trophy size={20} strokeWidth={1.6} />}
          title="No rounds yet"
          body="Every player starts at 1,200. The first settled round writes your account."
          action={
            <Link href="/">
              <Button variant="primary">Find a room</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {stats.map(([Icon, k, v]) => (
              <Card key={k}>
                <Icon size={16} className="text-white/80" strokeWidth={1.75} />
                <div className="mt-3 text-xs text-muted">{k}</div>
                <div className="balance mt-1 text-3xl text-white">{v}</div>
              </Card>
            ))}
          </div>
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
            Ratings are stored on Solana and update after every settled round: a pairwise Elo against the whole field, scored by placement.
          </p>
        </>
      )}
    </div>
  );
}

function RatingRing({ elo, ring }: { elo: number; ring: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className="ml-auto grid place-items-center">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" stroke="#2a3346" strokeWidth="6" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke="#e6f77a"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * ring} ${c}`}
          transform="rotate(-90 42 42)"
        />
        <text x="42" y="46" textAnchor="middle" fill="#ffffff" fontSize="13" fontFamily="var(--font-display-face), ui-sans-serif, sans-serif">
          {elo}
        </text>
      </svg>
    </div>
  );
}
