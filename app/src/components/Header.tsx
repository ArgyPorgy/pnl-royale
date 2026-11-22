"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CLUSTER, IS_TEE } from "@/lib/royale/constants";
import { PlayInstantly } from "./PlayInstantly";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden>
            <rect width="64" height="64" rx="14" fill="#161627" />
            <path d="M14 44 L26 30 L34 37 L50 18" stroke="#22e58a" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="50" cy="18" r="5" fill="#ffc940" />
          </svg>
          <span className="text-lg font-black tracking-tight">
            PnL <span className="text-gold">Royale</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/profile" className="hidden rounded-lg px-3 py-2 text-dim hover:text-white sm:block">
            Profile
          </Link>
          <span className={`chip hidden sm:inline ${CLUSTER === "mainnet" ? "text-long" : "text-gold"}`}>
            {CLUSTER}
            {IS_TEE ? " · TEE" : " · ER"}
          </span>
          <PlayInstantly className="hidden sm:block" />
          <WalletMultiButton />
        </nav>
      </div>
    </header>
  );
}
