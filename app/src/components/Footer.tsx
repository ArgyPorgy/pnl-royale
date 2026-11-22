import { ER_RPC, ER_VALIDATOR, PROGRAM_ID, explorerAccount } from "@/lib/royale/constants";

export function Footer() {
  return (
    <footer className="border-t border-line/60 py-6 text-xs text-dim">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Built on Solana + MagicBlock Private Ephemeral Rollups · VRF · Cranks · Session Keys · Pyth Lazer
        </span>
        <span className="font-mono">
          program{" "}
          <a className="underline decoration-dotted" href={explorerAccount(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            {PROGRAM_ID.toBase58().slice(0, 8)}…
          </a>{" "}
          · validator {ER_VALIDATOR.toBase58().slice(0, 6)}… · {new URL(ER_RPC).host}
        </span>
      </div>
    </footer>
  );
}
