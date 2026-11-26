"use client";
// Analytics for mainnet and devnet, read from chain by /api/analytics.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { Analytics, Network } from "@/lib/server/analytics";
import { CLUSTER } from "@/lib/royale/constants";
import { short } from "@/lib/royale/game";
import { Identicon } from "@/components/brand";
import { Bars, Columns, SERIES, Segments } from "@/components/charts";
import { Card, Empty, Pill, Row, Segmented, cx } from "@/components/ui";

const usdc = (v: string | number) => Number(v) / 1e6;
const money = (v: number) =>
  Math.abs(v) >= 10_000
    ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const axisMoney = (v: number) => (v >= 1000 ? `$${new Intl.NumberFormat("en-US", { notation: "compact" }).format(v)}` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (ts: number, long = false) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(long ? { year: "numeric" } : {}) });
const solscan = (net: Network, kind: "account" | "tx", id: string) => `https://solscan.io/${kind}/${id}${net === "devnet" ? "?cluster=devnet" : ""}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">{value}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [net, setNet] = useState<Network>(CLUSTER === "mainnet" ? "mainnet" : "devnet");
  const [data, setData] = useState<Partial<Record<Network, Analytics>>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("network");
    if (q === "mainnet" || q === "devnet") setNet(q);
  }, []);

  useEffect(() => {
    let stop = false;
    setError(null);
    fetch(`/api/analytics?network=${net}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `error ${r.status}`);
        if (!stop) setData((d) => ({ ...d, [net]: j as Analytics }));
      })
      .catch((e) => !stop && setError((e as Error).message));
    const t = setTimeout(() => setTick((x) => x + 1), 60_000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [net, tick]);

  const pick = (n: Network) => {
    setNet(n);
    window.history.replaceState(null, "", `/analytics?network=${n}`);
  };
  const a = data[net];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] text-white sm:text-5xl">Analytics</h1>
          <p className="subhead mt-3 text-lg text-white sm:text-xl">Live from Solana.</p>
        </div>
        <Segmented<Network>
          value={net}
          onChange={pick}
          options={[
            { value: "mainnet", label: "Mainnet" },
            { value: "devnet", label: "Devnet" },
          ]}
        />
      </div>

      {!a ? (
        error ? (
          <Empty title="Couldn't read the chain" body={error} />
        ) : (
          <Empty loading title={`Reading ${net}`} />
        )
      ) : (
        <Dashboard a={a} net={net} stale={!!error} />
      )}
    </div>
  );
}

function Dashboard({ a, net, stale }: { a: Analytics; net: Network; stale: boolean }) {
  const t = a.totals;
  const volume = usdc(t.volume);
  const daily = a.daily.map((d) => ({ label: day(d.day), full: day(d.day, true), values: [usdc(d.human) + usdc(d.bot)] }));
  const rounds = a.daily.map((d) => ({ label: day(d.day), full: day(d.day, true), values: [d.rounds] }));
  const here = net === CLUSTER;
  const nothing = a.rooms.created === 0;

  return (
    <div className="space-y-6">
      {nothing && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-sm text-muted">
          No rooms on {net} yet. The program and config are live; numbers appear here after the first room.
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <div className="mesh flex flex-col justify-between rounded-[var(--radius-card)] border border-white/10 px-5 py-5">
          <div className="text-sm text-white/80">Total volume</div>
          <div className="mt-3 text-5xl font-semibold tracking-tight text-white sm:text-6xl">{money(volume)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Revenue (fees)" value={money(usdc(t.fees))} sub={a.config ? `${a.config.feeBps / 100}% of each paid-out pot` : undefined} />
          <Tile label="Paid to winners" value={money(usdc(t.paid))} />
          <Tile label="Rounds played" value={a.rooms.played.toLocaleString()} sub={`${a.rooms.paidOut} paid out`} />
          <Tile label="Players" value={a.players.unique.toLocaleString()} sub={`${a.players.returning} came back · ${a.players.lastWeek} this week`} />
          <Tile label="Average pot" value={money(usdc(t.averagePot))} sub={`Biggest ${money(usdc(t.biggestPot))}`} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Live now" value={a.rooms.live.toLocaleString()} />
        <Tile label="Open now" value={a.rooms.open.toLocaleString()} sub={usdc(t.escrow) > 0 ? `${money(usdc(t.escrow))} in escrow` : undefined} />
        <Tile label="Average players" value={a.rooms.averagePlayers.toFixed(1)} sub={`${pct(a.rooms.fillRate)} of seats filled`} />
      </section>

      <Card title="Volume by day">
        <Columns data={daily} series={[{ name: "Volume", color: SERIES[0] }]} format={axisMoney} empty={`No volume on ${net} in the last 14 days.`} />
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer select-none">Table</summary>
          <table className="mt-2 w-full">
            <thead className="text-faint">
              <tr>
                <th className="py-1 text-left font-medium">Day</th>
                <th className="py-1 text-right font-medium">Rounds</th>
                <th className="py-1 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody className="num">
              {a.daily.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{day(d.day, true)}</td>
                  <td className="py-1 text-right">{d.rounds}</td>
                  <td className="py-1 text-right">{money(usdc(d.human) + usdc(d.bot))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Rounds by day">
          <Columns data={rounds} series={[{ name: "Rounds", color: SERIES[0] }]} format={(v) => String(v)} integer height={180} empty={`No rounds on ${net} in the last 14 days.`} />
        </Card>
        <Card title="Room outcomes">
          <Segments parts={a.statuses.map((s, i) => ({ name: s.name, value: s.rooms, color: SERIES[i] }))} />
          <div className="mt-4 border-t border-border pt-2">
            <Row label="Rooms created" value={a.rooms.created} />
            <Row label="Last room" value={a.rooms.lastCreated ? day(a.rooms.lastCreated, true) : "None yet"} />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Markets traded (rounds that included each)">
          <Bars rows={a.markets.slice(0, 8).map((m) => ({ key: m.symbol, label: m.symbol, value: m.rooms }))} empty="No rounds yet." />
        </Card>
        <Card title="Storms fired (from MagicBlock VRF)">
          <Bars rows={a.storms.map((s) => ({ key: s.name, label: s.name, value: s.fired }))} empty="No storms yet." />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Leaderboard" bodyClassName="p-0">
          {a.leaders.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">No rated players yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-faint">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">Player</th>
                  <th className="py-2 text-right font-medium">Elo</th>
                  <th className="py-2 text-right font-medium">Games</th>
                  <th className="px-4 py-2 text-right font-medium">Wins</th>
                </tr>
              </thead>
              <tbody>
                {a.leaders.map((l, i) => (
                  <tr key={l.player} className="border-b border-border last:border-b-0">
                    <td className="num px-4 py-2 text-muted">{i + 1}</td>
                    <td className="py-2">
                      <a href={solscan(net, "account", l.player)} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-white">
                        <Identicon pubkey={l.player} size={18} />
                        <span className="num text-fg">{short(l.player)}</span>
                      </a>
                    </td>
                    <td className="num py-2 text-right text-fg">{l.elo}</td>
                    <td className="num py-2 text-right text-muted">{l.games}</td>
                    <td className="num px-4 py-2 text-right text-muted">{l.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Protocol" bodyClassName="pt-2">
          <Row
            label="Program"
            value={
              <a href={solscan(net, "account", a.program)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                {short(a.program)} <ExternalLink size={12} />
              </a>
            }
          />
          {a.config ? (
            <>
              <Row label="Fee" value={`${a.config.feeBps / 100}%`} />
              <Row label="Entries" value={`$${usdc(a.config.minEntry)}–$${usdc(a.config.maxEntry)}`} />
              <Row label="Status" value={a.config.paused ? "Paused" : "Running"} valueClass={a.config.paused ? "text-warn" : "text-up"} />
              {net === "mainnet" && a.config.feeVault && (
                <Row
                  label="Fee vault"
                  value={
                    <a href={solscan(net, "account", a.config.feeVault)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                      {a.config.vaultBalance !== null ? money(usdc(a.config.vaultBalance)) : short(a.config.feeVault)} <ExternalLink size={12} />
                    </a>
                  }
                />
              )}
            </>
          ) : (
            <Row label="Config" value="Not set up" />
          )}
        </Card>
      </div>

      <Card title="Recent rooms" bodyClassName="p-0">
        {a.recent.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No rooms yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-faint">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">Room</th>
                  <th className="py-2 text-left font-medium">Markets</th>
                  <th className="py-2 text-right font-medium">Players</th>
                  <th className="py-2 text-right font-medium">Pot</th>
                  <th className="py-2 text-left font-medium pl-6">Winner</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {a.recent.map((r) => (
                  <tr key={r.roomId} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      {here ? (
                        <Link href={`/room/${r.roomId}`} className="font-semibold text-fg hover:underline">
                          {r.roomId.slice(-6)}
                        </Link>
                      ) : (
                        <a href={solscan(net, "account", r.address)} target="_blank" rel="noreferrer" className="font-semibold text-fg hover:underline">
                          {r.roomId.slice(-6)}
                        </a>
                      )}
                      <div className="text-xs text-faint">{day(r.createdTs)}</div>
                    </td>
                    <td className="py-2 text-xs text-muted">{r.markets.join(" · ")}</td>
                    <td className="num py-2 text-right text-muted">
                      {r.seats}/{r.maxSeats}
                    </td>
                    <td className="num py-2 text-right text-fg">{money(usdc(r.pot))}</td>
                    <td className="py-2 pl-6 text-xs">
                      {r.winner ? (
                        <span className="text-muted">
                          <span className="num">{short(r.winner.address)}</span> · <span className="num text-fg">{money(usdc(r.winner.payout))}</span>
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Pill tone={r.status === "Paid out" ? "neutral" : r.status === "Live" || r.status === "Starting" ? "accent" : r.status === "Open" ? "up" : "warn"}>
                        {r.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className={cx("flex items-center justify-center gap-1.5 text-xs", stale ? "text-warn" : "text-faint")}>
        <RefreshCw size={12} /> {stale ? "Couldn't refresh; showing the last read" : `Read from ${net} at ${new Date(a.at * 1000).toLocaleTimeString()} · refreshes every minute`}
      </p>
    </div>
  );
}
