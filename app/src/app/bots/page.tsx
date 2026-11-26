"use client";
// House bot pool: balances, what to top up, and today's result. Everything here is public onchain.
import { useEffect, useState } from "react";
import { Bot, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CLUSTER, explorerAccount } from "@/lib/royale/constants";
import { Identicon } from "@/components/brand";
import { Button, Card, Empty, Pill, Row, cx } from "@/components/ui";

type Limits = { maxEntry: number | null; dailyLoss: number | null; perPlayer: number | null };
type Pool = {
  address: string;
  sol: number;
  usdc: string;
  mints: boolean;
  needs: { sol: number; usdc: string };
  topUp: { sol: number; usdc: string };
  today: { rooms: number; pnl: string };
  limits: Limits;
  paused: string | null;
  bots: { name: string; address: string; sol: number; usdc: string }[];
};

const sol = (l: number) => (l / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 });
const usd = (u: string | bigint) => (Number(u) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (u: string) => `${Number(u) > 0 ? "+" : Number(u) < 0 ? "-" : ""}$${usd(String(Math.abs(Number(u))))}`;

export default function BotsPage() {
  const [pool, setPool] = useState<Pool | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const j = (await (await fetch("/api/bots?pool=1", { cache: "no-store" })).json()) as { pool?: Pool | null; poolError?: string };
        if (stop) return;
        setPool(j.pool ?? null);
        setError(j.poolError ?? null);
        setAt(Date.now());
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (pool === undefined) return <Empty loading title="Reading the pool" />;
  if (pool === null)
    return <Empty icon={<Bot size={20} strokeWidth={1.6} />} title="House bots are off" body={error ?? "No bot pool is set on this server (BOT_POOL_SECRET_KEY)."} />;

  const needSol = pool.topUp.sol > 0;
  const needUsdc = BigInt(pool.topUp.usdc) > 0n;
  const pnl = Number(pool.today.pnl);
  const lim = pool.limits;
  const copy = async () => {
    await navigator.clipboard.writeText(pool.address).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="display text-4xl text-white sm:text-5xl">House bots</h1>
        <p className="subhead mt-3 text-xl text-white">
          The pool funds every bot seat and takes the winnings back. {CLUSTER === "mainnet" ? "Real USDC on mainnet." : "Test funds on devnet."}
        </p>
      </div>

      <Card
        title="Pool"
        action={
          <Pill tone={pool.paused ? "warn" : "up"} dot={!pool.paused}>
            {pool.paused ? "Paused" : "Running"}
          </Pill>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Identicon pubkey={pool.address} size={22} />
          <span className="num min-w-0 flex-1 truncate text-sm text-fg">{pool.address}</span>
          <Button size="sm" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </Button>
          <a href={explorerAccount(pool.address)} target="_blank" rel="noreferrer">
            <Button size="sm">
              <ExternalLink size={14} /> Solscan
            </Button>
          </a>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-bg px-3 py-3">
            <div className="text-xs text-muted">SOL</div>
            <div className={cx("balance mt-1 text-2xl", needSol ? "text-warn" : "text-white")}>{sol(pool.sol)}</div>
          </div>
          <div className="rounded-xl border border-border bg-bg px-3 py-3">
            <div className="text-xs text-muted">USDC</div>
            <div className={cx("balance mt-1 text-2xl", needUsdc ? "text-warn" : "text-white")}>{pool.mints ? "Minted" : `$${usd(pool.usdc)}`}</div>
          </div>
        </div>
        <div
          className={cx(
            "mt-3 rounded-xl border px-3 py-3 text-sm",
            needSol || needUsdc ? "border-warn/30 bg-warn/5 text-warn" : pool.paused ? "border-border bg-bg text-muted" : "border-up/20 bg-up/5 text-up",
          )}
        >
          {needSol || needUsdc
            ? `Top up: send ${[needSol && `${sol(pool.topUp.sol)} SOL`, needUsdc && `$${usd(pool.topUp.usdc)} USDC`].filter(Boolean).join(" and ")} to the pool address on Solana.`
            : (pool.paused ?? `Funded. The bots need at least ${sol(pool.needs.sol)} SOL${pool.mints ? "" : ` and $${usd(pool.needs.usdc)} USDC`} to take seats.`)}
        </div>
      </Card>

      <Card title="Today (UTC)">
        <Row label="Rooms with bots" value={pool.today.rooms} />
        <Row label="Pool result" value={signed(pool.today.pnl)} valueClass={pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : undefined} />
        <Row label="Daily loss limit" value={lim.dailyLoss === null ? "None" : `$${lim.dailyLoss}`} />
        <p className="mt-2 text-xs text-muted">Rooms still in play count their bot entries as lost until they pay out.</p>
      </Card>

      <Card title="Limits">
        <Row label="Largest entry bots join" value={lim.maxEntry === null ? "Any" : `$${lim.maxEntry}`} />
        <Row label="Rooms per player per day" value={lim.perPlayer === null ? "Any" : lim.perPlayer} />
      </Card>

      <Card title="Bots" bodyClassName="p-0">
        <ul>
          {pool.bots.map((b) => (
            <li key={b.address} className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
              <Identicon pubkey={b.address} size={22} />
              <span className="flex-1">
                <span className="block font-semibold text-fg">{b.name}</span>
                <a href={explorerAccount(b.address)} target="_blank" rel="noreferrer" className="num text-xs text-faint hover:text-muted">
                  {b.address.slice(0, 4)}…{b.address.slice(-4)}
                </a>
              </span>
              <span className="num text-right text-xs text-muted">
                {sol(b.sol)} SOL
                <span className="block">${usd(b.usdc)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="flex items-center justify-center gap-1.5 text-xs text-faint">
        <RefreshCw size={12} /> Refreshes every 15 s{at ? ` · last ${new Date(at).toLocaleTimeString()}` : ""}
      </p>
    </div>
  );
}
