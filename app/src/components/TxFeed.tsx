"use client";
import { erExplorerTx } from "@/lib/royale/constants";

export type TxItem = { sig: string; label: string; ms: number; ok: boolean; at: number };

export function TxFeed({ items, token }: { items: TxItem[]; token: string | null }) {
  const ok = items.filter((i) => i.ok);
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : 0;
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-widest text-dim">Your onchain txs</div>
        <div className="text-xs text-dim">{avg ? `avg ${avg} ms · gasless` : "gasless"}</div>
      </div>
      <div className="tabular mt-1 text-3xl font-black">{ok.length}</div>
      <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono text-[11px]">
        {items.slice(0, 12).map((t) => (
          <li key={t.sig + t.at} className="flex justify-between gap-2">
            <span className={t.ok ? "text-dim" : "text-short"}>{t.label}</span>
            {t.sig ? (
              <button
                className="truncate text-left underline decoration-dotted"
                title="Opens the TEE transaction in the Solana explorer using your session token (only you can read it)"
                onClick={() => window.open(erExplorerTx(t.sig, token ?? undefined), "_blank")}
              >
                {t.sig.slice(0, 10)}… {t.ms}ms
              </button>
            ) : (
              <span className="text-short">failed</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
