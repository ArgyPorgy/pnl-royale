import { ER_RPC, PROGRAM_ID, explorerAccount } from "@/lib/royale/constants";
import { LogoMark } from "./brand";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-8 text-xs text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <LogoMark size={20} />
          <span>Built on Solana and MagicBlock Private Ephemeral Rollups</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a className="hover:text-muted" href={explorerAccount(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            Program {PROGRAM_ID.toBase58().slice(0, 4)}…{PROGRAM_ID.toBase58().slice(-4)}
          </a>
          <span>ER {new URL(ER_RPC).host}</span>
          <a className="hover:text-muted" href="https://github.com/ArgyPorgy/pnl-royale" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
