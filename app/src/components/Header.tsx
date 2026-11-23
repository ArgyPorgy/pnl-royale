"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { CLUSTER } from "@/lib/royale/constants";
import { Logo } from "./brand";
import { PlayInstantly } from "./PlayInstantly";
import { cx } from "./ui";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const NAV = [
  { href: "/", label: "Rooms" },
  { href: "/profile", label: "Profile" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="PnL Royale home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                path === n.href ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted sm:flex">
            <span className={cx("h-1.5 w-1.5 rounded-full", CLUSTER === "mainnet" ? "bg-up" : "bg-warn")} />
            {CLUSTER === "mainnet" ? "Mainnet" : "Devnet"}
          </span>
          <PlayInstantly size="sm" className="hidden sm:inline-flex" />
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
