"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { LayoutGrid, UserRound } from "lucide-react";
import { CLUSTER } from "@/lib/royale/constants";
import { Logo } from "./brand";
import { PlayInstantly } from "./PlayInstantly";
import { cx } from "./ui";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

const NAV = [
  { href: "/", label: "Rooms", icon: LayoutGrid },
  { href: "/profile", label: "Rating", icon: UserRound },
];

export function Header() {
  const path = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="PnL Royale home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => {
              const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    on ? "bg-accent text-black" : "text-muted hover:text-white",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted sm:flex">
              <span className={cx("h-1.5 w-1.5 rounded-full", CLUSTER === "mainnet" ? "bg-up" : "bg-warn")} />
              {CLUSTER === "mainnet" ? "Mainnet" : "Devnet"}
            </span>
            <span className="hidden md:inline-flex">
              <PlayInstantly size="sm" />
            </span>
            <WalletMultiButton />
          </div>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-2 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5">
          {NAV.map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={cx("mx-2 flex flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-medium", on ? "bg-accent text-black" : "text-faint")}>
                <Icon size={18} strokeWidth={1.75} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
