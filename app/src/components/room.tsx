"use client";
import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  Crosshair,
  ExternalLink,
  Gauge,
  Lock,
  Minus,
  Shrink,
  Snowflake,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { PositionState, RoomState } from "@/lib/royale/client";
import { assetSymbol, priceToNumber } from "@/lib/royale/client";
import {
  FREEZE_SECS,
  LEVERAGES,
  MIN_HOLD_SECS,
  STORM_COPY,
  StormKind,
  SURGE_LEVERAGE,
  erExplorerTx,
  explorerAccount,
  feedById,
} from "@/lib/royale/constants";
import { checkpointTs, fmtChips, fmtPrice, fmtUsdc, intervalOf, liveEquity, prizeSplit, short, stormFor } from "@/lib/royale/game";
import { TVChart, type TvInterval } from "./TVChart";
import { Identicon, TokenIcon } from "./brand";
import { Button, Card, Pill, Row, Segmented, cx } from "./ui";

export const STORM_ICON: Record<StormKind, LucideIcon> = {
  [StormKind.None]: Minus,
  [StormKind.Spotlight]: Crosshair,
  [StormKind.Surge]: Gauge,
  [StormKind.Freeze]: Snowflake,
  [StormKind.ZoneShrink]: Shrink,
};

export const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ Round progress */

export function RoundProgress({ room, now }: { room: RoomState; now: number }) {
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const nextCut = checkpointTs(room, room.nextCheckpoint);
  const final = room.nextCheckpoint > 5;
  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <div className="text-xs text-muted">{final ? "Final bell in" : `Cut ${room.nextCheckpoint} of 5 in`}</div>
          <div className={cx("num mt-0.5 text-[28px] leading-none", nextCut - now < 10 ? "text-down" : "text-fg")}>{mmss(nextCut - now)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Alive</div>
          <div className="num mt-0.5 text-[28px] leading-none text-fg">
            {room.aliveCount}
            <span className="text-base text-faint">/{room.seatsFilled}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Interval</div>
          <div className="num mt-0.5 text-[28px] leading-none text-fg">
            {cur + 1}
            <span className="text-base text-faint">/6</span>
          </div>
        </div>
        <div className="ml-auto hidden text-right text-xs text-faint md:block">
          Eliminations are executed by an onchain crank
          <br />
          inside the TEE. Anyone can trigger an overdue cut.
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1 border-t border-border p-3">
        {Array.from({ length: 6 }, (_, i) => {
          const start = room.startTs + i * room.intervalSecs;
          const pct = Math.min(100, Math.max(0, ((now - start) / room.intervalSecs) * 100));
          const storm = stormFor(room, i);
          const Icon = STORM_ICON[storm.kind];
          const label =
            storm.kind === StormKind.None
              ? i <= cur
                ? (room.stormsRequested >> i) & 1
                  ? "Storm pending"
                  : "No storm"
                : "Upcoming"
              : `${STORM_COPY[storm.kind].title}${storm.kind === StormKind.Spotlight ? ` ${assetSymbol(room, storm.asset)}` : ""}`;
          return (
            <div key={i} title={label}>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className={cx("h-full rounded-full", i === cur ? "bg-accent" : "bg-faint/60")} style={{ width: `${pct}%` }} />
              </div>
              <div className={cx("mt-2 flex items-center gap-1.5 truncate text-[11px]", storm.kind !== StormKind.None ? "text-[#a99fff]" : "text-faint")}>
                <Icon size={12} strokeWidth={2} className="shrink-0" />
                <span className="hidden truncate sm:inline">{label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Storm */

export function StormCard({ room, now }: { room: RoomState; now: number }) {
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, cur);
  const Icon = STORM_ICON[storm.kind];
  const active = storm.kind !== StormKind.None;
  const pending = !active && ((room.stormsRequested >> cur) & 1) === 1;
  return (
    <Card
      title="This interval"
      action={
        <span className="text-[11px] text-faint" title="Drawn by MagicBlock VRF and delivered by an authenticated callback">
          VRF {(room.stormsFulfilled >> cur) & 1 ? "verified" : pending ? "pending" : ""}
        </span>
      }
    >
      <div className="flex items-start gap-3">
        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", active ? "bg-accent/15 text-[#a99fff]" : "bg-surface-2 text-faint")}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-sm font-medium text-fg">{active ? STORM_COPY[storm.kind].title : pending ? "Drawing a storm" : "No storm"}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            {active
              ? STORM_COPY[storm.kind].blurb(assetSymbol(room, storm.asset), storm.side === 1 ? "Long" : "Short")
              : "A random storm can change the rules each interval: 2x PnL on one market, 25x leverage, a frozen side, or a faster bleed."}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Chart */

export function ChartPanel({
  room,
  prices,
  asset,
  onAsset,
  height = 460,
}: {
  room: RoomState;
  prices: (bigint | null)[];
  asset: number;
  onAsset: (i: number) => void;
  height?: number;
}) {
  const [tf, setTf] = useState<TvInterval>("1");
  const feed = feedById(room.assets[asset]);
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {room.assets.map((id, i) => {
            const f = feedById(id);
            const p = prices[i];
            return (
              <button
                key={id}
                onClick={() => onAsset(i)}
                className={cx(
                  "flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left transition-colors",
                  i === asset ? "bg-surface-3" : "hover:bg-surface-2",
                )}
              >
                <TokenIcon id={id} size={22} />
                <span>
                  <span className="block text-xs font-medium text-fg">{f?.symbol}/USD</span>
                  <span className="num block text-xs text-muted">{p && f ? `$${fmtPrice(priceToNumber(p, f.exponent))}` : "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Segmented<TvInterval>
          size="sm"
          className="ml-auto"
          value={tf}
          onChange={setTf}
          options={[
            { value: "1", label: "1m" },
            { value: "5", label: "5m" },
            { value: "15", label: "15m" },
          ]}
        />
      </div>
      {feed && <TVChart symbol={feed.tv} interval={tf} height={height} />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-faint">
        <span>Trades execute at the onchain Pyth Lazer oracle price, read inside the TEE on every action.</span>
        <a href={`https://www.tradingview.com/symbols/${feed?.tv.replace(":", "-")}/`} target="_blank" rel="noreferrer" className="hover:text-muted">
          Chart by TradingView
        </a>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Position */

export function PositionCard({
  room,
  position,
  prices,
  now,
  rank,
}: {
  room: RoomState;
  position: PositionState | null;
  prices: (bigint | null)[];
  now: number;
  rank: number;
}) {
  if (!position)
    return (
      <Card title="Your position">
        <div className="text-[13px] text-muted">Reading your sealed position from the TEE…</div>
      </Card>
    );
  const eq = liveEquity(room, position, prices, now);
  const total = (Number(eq) / 10_000_000_000 - 1) * 100;
  const unreal = Number(eq - position.equityAtOpen) / 1e6;
  const f = feedById(room.assets[position.assetIdx]);
  const entry = f && position.side !== 0 ? priceToNumber(position.entryPrice, f.exponent) : 0;
  const mark = f && prices[position.assetIdx] ? priceToNumber(prices[position.assetIdx]!, f.exponent) : 0;
  const storm = stormFor(room, intervalOf(room.startTs, room.intervalSecs, position.entryTs));
  const mult = storm.kind === StormKind.Spotlight && storm.asset === position.assetIdx ? 2 : 1;
  const liq = entry ? entry * (1 - position.side / (position.leverage * mult)) : 0;
  const dead = !position.alive || position.liquidated;
  return (
    <Card
      title="Your position"
      action={
        <span className="flex items-center gap-1.5 text-[11px] text-faint" title="Sealed by an owner-only permission inside the TEE">
          <Lock size={12} /> Only you can see this
        </span>
      }
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-muted">Equity</div>
          <div className={cx("num mt-1 text-[30px] leading-none", dead ? "text-faint" : "text-fg")}>{fmtChips(eq)}</div>
        </div>
        <div className="text-right">
          <div className={cx("num text-sm", total >= 0 ? "text-up" : "text-down")}>
            {total >= 0 ? "+" : ""}
            {total.toFixed(2)}%
          </div>
          <div className="text-[11px] text-faint">vs 10,000 start</div>
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-2">
        <Row
          label="Position"
          value={
            dead ? (
              <span className="text-down">Eliminated</span>
            ) : position.side === 0 ? (
              <span className="text-muted">Flat · bleeding {storm.kind === StormKind.ZoneShrink ? "2" : "1"}%/min</span>
            ) : (
              <span className={position.side > 0 ? "text-up" : "text-down"}>
                {position.side > 0 ? "Long" : "Short"} {f?.symbol} {position.leverage}x
              </span>
            )
          }
        />
        {position.side !== 0 && !dead && (
          <>
            <Row label="Entry" value={`$${fmtPrice(entry)}`} />
            <Row label="Mark (oracle)" value={`$${fmtPrice(mark)}`} />
            <Row label="Liquidation" value={`$${fmtPrice(liq)}`} valueClass="text-warn" />
            <Row
              label="Unrealized"
              value={`${unreal >= 0 ? "+" : ""}${unreal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              valueClass={unreal >= 0 ? "text-up" : "text-down"}
            />
          </>
        )}
        <Row label="Rank at last cut" value={rank > 0 ? `#${rank} of ${room.aliveCount}` : "—"} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Order ticket */

export function OrderTicket({
  room,
  position,
  asset,
  now,
  busy,
  onTrade,
}: {
  room: RoomState;
  position: PositionState | null;
  asset: number;
  now: number;
  busy: boolean;
  onTrade: (side: -1 | 0 | 1, lev: number, asset: number) => void;
}) {
  const [side, setSide] = useState<1 | -1>(1);
  const [lev, setLev] = useState(5);
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, cur);
  const surge = storm.kind === StormKind.Surge;
  const levels = surge ? [...LEVERAGES, SURGE_LEVERAGE] : [...LEVERAGES];
  useEffect(() => {
    if (!surge && lev === SURGE_LEVERAGE) setLev(10);
  }, [surge, lev]);
  const frozen = storm.kind === StormKind.Freeze && now < checkpointTs(room, cur) + FREEZE_SECS ? storm.side : 0;
  const holdLeft = position ? Math.max(0, position.lastActionTs + MIN_HOLD_SECS - now) : 0;
  const dead = !!position && (!position.alive || position.liquidated);
  const symbol = assetSymbol(room, asset);
  const same = position && position.side === side && position.leverage === lev && position.assetIdx === asset;
  const fee = position ? (Number(position.equity) / 1e6) * lev * 0.0005 : 0;
  const blocked = busy || dead || holdLeft > 0 || !!same || frozen === side;
  return (
    <Card title="Trade">
      <Segmented<1 | -1>
        className="w-full"
        value={side}
        onChange={setSide}
        options={[
          { value: 1, label: <span className={side === 1 ? "text-up" : ""}>Long</span> },
          { value: -1, label: <span className={side === -1 ? "text-down" : ""}>Short</span> },
        ]}
      />
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted">Leverage</span>
          {surge && <span className="text-[#a99fff]">Surge: 25x unlocked</span>}
        </div>
        <Segmented<number> className="w-full" value={lev} onChange={setLev} options={levels.map((l) => ({ value: l, label: `${l}x` }))} />
      </div>
      <div className="mt-4 rounded-[10px] border border-border bg-bg px-3 py-1.5">
        <Row label="Market" value={`${symbol}/USD`} />
        <Row label="Notional" value={position ? `${((Number(position.equity) / 1e6) * lev).toLocaleString(undefined, { maximumFractionDigits: 0 })} chips` : "—"} />
        <Row label="Spread (5 bps)" value={position ? `${fee.toFixed(2)} chips` : "—"} />
      </div>
      <Button
        variant={side === 1 ? "up" : "down"}
        size="lg"
        className="mt-4 w-full"
        disabled={blocked}
        onClick={() => onTrade(side, lev, asset)}
      >
        {dead
          ? "Eliminated"
          : frozen === side
            ? `${side === 1 ? "Longs" : "Shorts"} frozen`
            : holdLeft > 0
              ? `Hold ${holdLeft.toFixed(1)}s`
              : busy
                ? "Submitting…"
                : same
                  ? "Position open"
                  : `${side === 1 ? "Long" : "Short"} ${symbol} ${lev}x`}
      </Button>
      <Button
        variant="secondary"
        className="mt-2 w-full"
        disabled={busy || dead || holdLeft > 0 || !position || position.side === 0}
        onClick={() => onTrade(0, 1, position?.assetIdx ?? 0)}
      >
        Close position
      </Button>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Signed by your session key and settled in the TEE: no wallet popup, no gas. Minimum hold {MIN_HOLD_SECS}s between trades.
        Flat equity bleeds 1% per minute.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ Players */

const COLS = "grid-cols-[28px_1fr_auto] sm:grid-cols-[44px_1fr_110px_110px]";
const COLS_PAY = "grid-cols-[28px_1fr_auto_auto] sm:grid-cols-[44px_1fr_110px_110px_80px]";

export function PlayersTable({ room, me, payouts = false }: { room: RoomState; me: PublicKey | null; payouts?: boolean }) {
  const pot = room.entryAmount * BigInt(room.seatsFilled);
  const prize = pot - (pot * BigInt(room.feeBps)) / 10_000n;
  const split = prizeSplit(room.finalistCount);
  const ended = room.status >= 3 && room.finalistCount > 0;
  const rows = room.players
    .map((p, i) => ({ p, i, out: room.elimCheckpoint[i], rank: room.publicRank[i], place: room.placement[i] }))
    .sort((a, b) => {
      if (ended || (a.out && b.out)) return (a.place || 99) - (b.place || 99);
      if (a.out) return 1;
      if (b.out) return -1;
      return (a.rank || 99) - (b.rank || 99) || a.i - b.i;
    });
  return (
    <Card title={ended ? "Final standings" : `Players · ${room.status >= 2 ? `${room.aliveCount} alive` : `${room.seatsFilled} joined`}`} bodyClassName="p-0">
      <div className={cx("grid gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wide text-faint", payouts ? COLS_PAY : COLS)}>
        <span>#</span>
        <span>Player</span>
        <span className="hidden sm:block">Status</span>
        <span className="text-right">Equity</span>
        {payouts && <span className="text-right">Payout</span>}
      </div>
      <ul>
        {rows.map(({ p, i, out, rank, place }) => {
          const mine = !!me && p.equals(me);
          const finalist = ended && place > 0 && place <= room.finalistCount;
          const statusPill = finalist ? (
            <Pill tone={place === 1 ? "accent" : "neutral"}>
              {place === 1 && <Trophy size={11} />}
              {place === 1 ? "Winner" : `Finalist #${place}`}
            </Pill>
          ) : out ? (
            <Pill tone="down">Out · cut {out}</Pill>
          ) : room.status >= 2 ? (
            <Pill tone="up">Alive</Pill>
          ) : (
            <Pill>Seat {i + 1}</Pill>
          );
          return (
            <li
              key={p.toBase58()}
              className={cx(
                "grid items-center gap-3 border-b border-border px-4 py-2.5 text-[13px] last:border-b-0",
                payouts ? COLS_PAY : COLS,
                mine && "bg-accent/[0.06]",
              )}
            >
              <span className={cx("num", finalist ? "text-fg" : "text-faint")}>{ended || out ? place || "—" : rank || "—"}</span>
              <a href={explorerAccount(p.toBase58())} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 hover:text-fg">
                <Identicon pubkey={p} size={22} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="num truncate text-fg">{short(p)}</span>
                    {mine && <Pill tone="accent">You</Pill>}
                  </span>
                  <span className="mt-1 block sm:hidden">{statusPill}</span>
                </span>
              </a>
              <span className="hidden sm:block">{statusPill}</span>
              <span className="num text-right text-muted">
                {out || ended ? (
                  fmtChips(room.finalEquity[i])
                ) : room.status >= 2 ? (
                  <span className="inline-flex items-center gap-1 text-faint">
                    <Lock size={11} /> Sealed
                  </span>
                ) : (
                  "10,000.00"
                )}
              </span>
              {payouts && (
                <span className={cx("num text-right", finalist ? "text-up" : "text-faint")}>
                  {finalist ? `$${fmtUsdc((prize * BigInt(split[place - 1] ?? 0)) / 100n)}` : "—"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ Activity */

export type TxItem = { sig: string; label: string; ms: number; ok: boolean; at: number };

export function Activity({ items, token }: { items: TxItem[]; token: string | null }) {
  const ok = items.filter((i) => i.ok);
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : 0;
  return (
    <Card title="Your activity" action={<span className="num text-[11px] text-faint">{ok.length} onchain{avg ? ` · ${avg} ms avg` : ""}</span>} bodyClassName="p-0">
      {items.length === 0 ? (
        <div className="px-4 py-5 text-[13px] text-faint">Every action you take is a gasless transaction on the rollup. They show up here.</div>
      ) : (
        <ul className="max-h-64 overflow-auto">
          {items.slice(0, 20).map((t) => (
            <li key={t.sig + t.at} className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-[13px] last:border-b-0">
              <span className={cx("truncate", t.ok ? "text-fg" : "text-down")}>{t.label}</span>
              {t.sig ? (
                <button
                  className="num flex shrink-0 items-center gap-1.5 text-xs text-faint hover:text-muted"
                  title="Open in the Solana explorer using your session token (only you can read it)"
                  onClick={() => window.open(erExplorerTx(t.sig, token ?? undefined), "_blank")}
                >
                  {t.ms} ms <ExternalLink size={12} />
                </button>
              ) : (
                <span className="text-xs text-down">failed</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
