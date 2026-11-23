"use client";
import { CLUSTER, ER_RPC, PROGRAM_ID, explorerAccount } from "@/lib/royale/constants";
import { LogoMark, PartnerLockup, WALLETS } from "./brand";

export function Footer() {
  return (
    <footer className="mt-8 border-t border-border pb-24 md:pb-0">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="display text-lg">
              PnL Royale
            </span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            A trading battle royale on Solana. Positions stay sealed in MagicBlock&apos;s private rollup. The pot settles in USDC on the base layer.
          </p>
          <PartnerLockup className="mt-5" />
        </div>
        <div>
          <div className="kicker">Wallets</div>
          <ul className="mt-3 space-y-2">
            {WALLETS.map((w) => (
              <li key={w.name}>
                <a href={w.href} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-sm text-muted hover:text-fg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.src} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-sm object-contain" />
                  {w.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="kicker">Onchain</div>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <a className="hover:text-fg" href={explorerAccount(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
                Program {PROGRAM_ID.toBase58().slice(0, 4)}…{PROGRAM_ID.toBase58().slice(-4)}
              </a>
            </li>
            <li>
              Rollup {new URL(ER_RPC).host}
              {CLUSTER !== "mainnet" && (
                <span className="mt-1 block text-xs text-faint">Devnet rollup link. Switch this to mainnet at deploy.</span>
              )}
            </li>
            <li>
              <a className="hover:text-fg" href="https://github.com/ArgyPorgy/pnl-royale" target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
