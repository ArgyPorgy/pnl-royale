"use client";
import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Crosshair, ExternalLink, Gauge, Lock, Minus, Shrink, Snowflake, Trophy, type LucideIcon } from "lucide-react";
import type { PositionState, RoomState } from "@/lib/royale/client";
import { assetSymbol, priceToNumber } from "@/lib/royale/client";
import {
  BLEED_BPS_PER_MIN,
  FLIP_COST_BPS,
  FREEZE_SECS,
  LEVERAGES,
  MIN_HOLD_SECS,
  STARTING_CHIPS,
  STORM_COPY,
  StormKind,
  SURGE_LEVERAGE,
  erExplorerTx,
  explorerAccount,
  feedById,
} from "@/lib/royale/constants";
import { checkpointTs, chips, fmtChips, fmtPnl, fmtPrice, fmtUsdc, intervalOf, liveEquity, prizeSplit, short, stormFor, type Storm } from "@/lib/royale/game";
import { TVChart, type TvInterval } from "./TVChart";
import { OracleChart } from "./OracleChart";
import { useBots } from "@/hooks/useBots";
import { Identicon, TokenIcon } from "./brand";
import { Button, Card, Pill, Row, Segmented, cx } from "./ui";

export const STORM_ICON: Record<StormKind, LucideIcon> = {
  [StormKind.None]: Minus,
  [StormKind.Spotlight]: Crosshair,
  [StormKind.Surge]: Gauge,
  [StormKind.Freeze]: Snowflake,
  [StormKind.ZoneShrink]: Shrink,
};

const STORM_ANIM: Record<StormKind, string> = {
  [StormKind.None]: "",
  [StormKind.Spotlight]: "storm-spotlight",
  [StormKind.Surge]: "storm-surge",
  [StormKind.Freeze]: "storm-freeze",
  [StormKind.ZoneShrink]: "storm-shrink",
};

function stormLine(room: RoomState, storm: { kind: StormKind; asset: number; side: number }) {
  const asset = assetSymbol(room, storm.asset);
  const side = storm.side === 1 ? "longs" : "shorts";
  if (storm.kind === StormKind.Spotlight) return `${asset} pays double.`;
  if (storm.kind === StormKind.Surge) return "25x is open.";
  if (storm.kind === StormKind.Freeze) return `No new ${side}.`;
  if (storm.kind === StormKind.ZoneShrink) return "Flat bleeds faster.";
  return "Standard rules.";
}

export const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function RoundProgress({ room, now }: { room: RoomState; now: number }) {
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const nextCut = checkpointTs(room, room.nextCheckpoint);
  const final = room.nextCheckpoint > 5;
  const left = nextCut - now;
  const urgent = left < 10;
  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 px-5 py-4">
        <div>
          <div className="kicker">{final ? "Final bell" : `Cut ${room.nextCheckpoint} of 5`}</div>
          <div className={cx("balance mt-1 text-[44px] leading-none", urgent ? "cut-urgent text-down" : "text-white")}>{mmss(left)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Alive</div>
          <div className="num mt-1 text-[32px] leading-none text-fg">
            {room.aliveCount}
            <span className="text-base text-faint">/{room.seatsFilled}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Interval</div>
          <div className="num mt-1 text-[32px] leading-none text-fg">
            {cur + 1}
            <span className="text-base text-faint">/6</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1.5 border-t border-border p-3">
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
                <div className={cx("h-full rounded-full", i === cur ? "bg-accent" : "bg-faint/50")} style={{ width: `${pct}%` }} />
              </div>
              <div className={cx("mt-2 flex items-center gap-1.5 truncate text-[12px]", storm.kind !== StormKind.None ? "text-white" : "text-faint")}>
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

export function StormBanner({ room, now }: { room: RoomState; now: number }) {
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, cur);
  if (storm.kind === StormKind.None) return null;
  const Icon = STORM_ICON[storm.kind];
  return (
    <div className={cx("mesh fade-up flex items-start gap-3 overflow-hidden rounded-[24px] border border-white/10 px-4 py-3", STORM_ANIM[storm.kind])}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/30 text-white">
        <Icon size={18} />
      </span>
      <div>
        <div className="kicker">Storm live</div>
        <div className="mt-0.5 text-sm font-semibold text-fg">{STORM_COPY[storm.kind].title}</div>
        <p className="subhead text-lg text-white">{stormLine(room, storm)}</p>
      </div>
    </div>
  );
}

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
      <div className={cx("flex items-start gap-3 rounded-[20px] p-2", active && "mesh")}>
        <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", active ? "bg-white/10 text-white" : "bg-surface-2 text-faint")}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-sm font-semibold text-fg">{active ? STORM_COPY[storm.kind].title : pending ? "Drawing a storm" : "Clear interval"}</div>
          <p className="subhead mt-1 text-lg text-white">{active ? stormLine(room, storm) : pending ? "Drawing now." : "Standard rules."}</p>
        </div>
      </div>
    </Card>
  );
}

const TV_SOURCE: Record<string, string> = { COINBASE: "Coinbase", CRYPTO: "TradingView index", BYBIT: "Bybit", BINANCE: "Binance" };

export function ChartPanel({
  room,
  prices,
  asset,
  onAsset,
  history,
}: {
  room: RoomState;
  prices: (bigint | null)[];
  asset: number;
  onAsset: (i: number) => void;
  history?: number[][];
}) {
  const [tf, setTf] = useState<TvInterval>("1");
  // The reference chart opens first; the oracle line is one tap away.
  const [mode, setMode] = useState<"oracle" | "reference">("reference");
  const feed = feedById(room.assets[asset]);
  const series = (history?.[asset] ?? []).map((raw) => (feed ? priceToNumber(BigInt(Math.round(raw)), feed.exponent) : Number(raw)));
  const hasSeries = series.length > 8;
  const mark = prices[asset] && feed ? priceToNumber(prices[asset]!, feed.exponent) : series.at(-1);
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
                className={cx("flex items-center gap-2.5 rounded-full px-3 py-1.5 text-left transition-colors", i === asset ? "bg-white/10 text-white" : "hover:bg-white/5")}
              >
                <TokenIcon id={id} size={22} />
                <span>
                  <span className="block text-xs font-semibold text-fg">{f?.symbol}/USD</span>
                  <span className="num block text-xs text-muted">{p && f ? `$${fmtPrice(priceToNumber(p, f.exponent))}` : "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segmented<"oracle" | "reference">
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "reference", label: "Reference" },
              { value: "oracle", label: "Oracle" },
            ]}
          />
          {mode === "reference" && (
            <Segmented<TvInterval>
              size="sm"
              value={tf}
              onChange={setTf}
              options={[
                { value: "1", label: "1m" },
                { value: "5", label: "5m" },
                { value: "15", label: "15m" },
              ]}
            />
          )}
        </div>
      </div>
      <div className="relative h-[320px] bg-[#0c1018] sm:h-[420px] xl:h-[480px]">
        {mode === "oracle" && hasSeries ? (
          <OracleChart points={series} accent={series[series.length - 1] >= series[0] ? "#1edb8a" : "#ff4d6d"} />
        ) : mode === "oracle" ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <div className="kicker">Oracle</div>
              <div className="num mt-2 text-4xl text-fg">{mark ? `$${fmtPrice(mark)}` : "—"}</div>
              <p className="subhead mt-2 text-xl text-white">Waiting on the oracle.</p>
            </div>
          </div>
        ) : (
          feed && <TVChart symbol={feed.tv} interval={tf} />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-faint">
        <span>{mode === "reference" && feed ? `${TV_SOURCE[feed.tv.split(":")[0]] ?? "Market"} price. Trades fill at the oracle price.` : "Oracle price."}</span>
        {mode === "reference" && (
          <a href={`https://www.tradingview.com/symbols/${feed?.tv.replace(":", "-")}/`} target="_blank" rel="noreferrer" className="hover:text-muted">
            Chart by TradingView
          </a>
        )}
      </div>
    </section>
  );
}

/** Percent of equity lost per minute while flat. */
const flatPct = (storm: Storm) => (BLEED_BPS_PER_MIN / 100) * (storm.kind === StormKind.ZoneShrink ? 2 : 1);
const holdLeftOf = (p: PositionState | null, now: number) => (p ? Math.max(0, p.lastActionTs + MIN_HOLD_SECS - now) : 0);
const tradeName = (room: RoomState, p: PositionState) => `${p.side > 0 ? "Long" : "Short"} ${assetSymbol(room, p.assetIdx)} ${p.leverage}x`;
const pnlTone = (v: bigint) => (v > 0n ? "text-up" : v < 0n ? "text-down" : undefined);

export function PositionCard({
  room,
  position,
  prices,
  now,
  rank,
  busy,
  onClose,
}: {
  room: RoomState;
  position: PositionState | null;
  prices: (bigint | null)[];
  now: number;
  rank: number;
  busy: boolean;
  /** Missing while trading is not enabled. */
  onClose?: () => void;
}) {
  if (!position)
    return (
      <Card title="Your position">
        <div className="space-y-2">
          <div className="skeleton h-8 w-32" />
          <div className="subhead text-lg text-white">Reading your position.</div>
        </div>
      </Card>
    );
  const eq = liveEquity(room, position, prices, now);
  const total = (Number(eq) / Number(STARTING_CHIPS) - 1) * 100;
  // Every close, opening cost and cut folds into equityAtOpen; the rest is still open.
  const locked = position.equityAtOpen - STARTING_CHIPS;
  const open = eq - position.equityAtOpen;
  const f = feedById(room.assets[position.assetIdx]);
  const entry = f && position.side !== 0 ? priceToNumber(position.entryPrice, f.exponent) : 0;
  const mark = f && prices[position.assetIdx] ? priceToNumber(prices[position.assetIdx]!, f.exponent) : 0;
  const storm = stormFor(room, intervalOf(room.startTs, room.intervalSecs, position.entryTs));
  const mult = storm.kind === StormKind.Spotlight && storm.asset === position.assetIdx ? 2 : 1;
  const liq = entry ? entry * (1 - position.side / (position.leverage * mult)) : 0;
  const dead = !position.alive || position.liquidated;
  const inTrade = position.side !== 0 && !dead;
  const rebased = inTrade && position.entryTs > position.lastActionTs;
  const holdLeft = holdLeftOf(position, now);
  return (
    <Card
      title="Your position"
      action={
        <span className="flex items-center gap-1.5 text-[11px] text-faint" title="Sealed by an owner-only permission inside the TEE">
          <Lock size={12} /> Sealed
        </span>
      }
    >
      <div className="mesh -mx-4 -mt-4 mb-4 flex items-end justify-between rounded-t-[20px] px-4 pb-4 pt-5">
        <div>
          <div className="text-xs text-white/70">Equity</div>
          <div className={cx("balance mt-1 text-[40px] leading-none", dead ? "text-white/40" : "text-white")}>{fmtChips(eq)}</div>
        </div>
        <div className="text-right">
          <div className={cx("num rounded-full bg-black/60 px-2.5 py-1 text-sm font-semibold", total >= 0 ? "text-up" : "text-down")}>
            {total >= 0 ? "+" : ""}
            {total.toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-2">
        <Row
          label="Position"
          value={
            dead ? (
              <span className="text-down">Eliminated</span>
            ) : position.side === 0 ? (
              <span className="text-muted">Flat · bleeding {flatPct(storm)}%/min</span>
            ) : (
              <span className={position.side > 0 ? "text-up" : "text-down"}>{tradeName(room, position)}</span>
            )
          }
        />
        {inTrade && (
          <>
            <Row label={rebased ? "Entry (last cut)" : "Entry"} value={`$${fmtPrice(entry)}`} />
            <Row label="Mark (oracle)" value={`$${fmtPrice(mark)}`} />
            <Row label="Liquidation" value={`$${fmtPrice(liq)}`} valueClass="text-warn" />
          </>
        )}
        {!dead && (
          <>
            <Row label={inTrade ? "Open PnL" : "Flat cost"} value={fmtPnl(open)} valueClass={pnlTone(open)} />
            <Row label="Locked-in PnL" value={fmtPnl(locked)} valueClass={pnlTone(locked)} />
          </>
        )}
        <Row label="Rank at last cut" value={rank > 0 ? `#${rank} of ${room.aliveCount}` : "—"} />
      </div>
      {inTrade && onClose && (
        <div className="mt-3">
          <Button variant="primary" size="lg" className="w-full" disabled={busy || holdLeft > 0} onClick={onClose}>
            {busy ? "Submitting…" : holdLeft > 0 ? `Hold ${holdLeft.toFixed(1)}s` : `Close · lock in ${fmtPnl(open)}`}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">
            Closes at the oracle price, free. Flat then costs {flatPct(stormFor(room, intervalOf(room.startTs, room.intervalSecs, now)))}% a minute.
          </p>
        </div>
      )}
    </Card>
  );
}

export function OrderTicket({
  room,
  position,
  prices,
  asset,
  now,
  busy,
  onTrade,
}: {
  room: RoomState;
  position: PositionState | null;
  prices: (bigint | null)[];
  asset: number;
  now: number;
  busy: boolean;
  onTrade: (side: -1 | 0 | 1, lev: number, asset: number) => void;
}) {
  const [side, setSide] = useState<1 | -1 | 0>(1);
  const [lev, setLev] = useState(5);
  const cur = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, cur);
  const surge = storm.kind === StormKind.Surge;
  const levels = surge ? [...LEVERAGES, SURGE_LEVERAGE] : [...LEVERAGES];
  useEffect(() => {
    if (!surge && lev === SURGE_LEVERAGE) setLev(10);
  }, [surge, lev]);
  const frozen = storm.kind === StormKind.Freeze && now < checkpointTs(room, cur) + FREEZE_SECS ? storm.side : 0;
  const holdLeft = holdLeftOf(position, now);
  const dead = !!position && (!position.alive || position.liquidated);
  const inTrade = !!position && position.side !== 0 && !dead;
  const eq = position ? liveEquity(room, position, prices, now) : 0n;
  const open = position ? eq - position.equityAtOpen : 0n;
  const symbol = assetSymbol(room, asset);
  const same = side === 0 ? position?.side === 0 : position && position.side === side && position.leverage === lev && position.assetIdx === asset;
  const size = chips(eq) * lev;
  const fee = (size * FLIP_COST_BPS) / 10_000;
  const blocked = busy || dead || holdLeft > 0 || !!same || (side !== 0 && frozen === side);
  const sides: { value: 1 | -1 | 0; label: string }[] = [
    { value: 1, label: "Long" },
    { value: 0, label: inTrade ? "Close" : "Flat" },
    { value: -1, label: "Short" },
  ];
  return (
    <Card title="Trade">
      <div className="grid grid-cols-3 gap-1.5">
        {sides.map((s) => {
          const on = side === s.value;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setSide(s.value)}
              className={cx(
                "h-11 rounded-xl border text-sm font-semibold transition-colors",
                on && s.value === 1 && "border-up/50 bg-up/15 text-up",
                on && s.value === -1 && "border-down/50 bg-down/15 text-down",
                on && s.value === 0 && "border-border-strong bg-surface-3 text-fg",
                !on && "border-border text-muted hover:text-fg",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <div className={cx("mt-4", side === 0 && "opacity-40")}>
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted">Leverage</span>
          {surge && <span className="font-medium text-white">Surge · 25x open</span>}
        </div>
        <Segmented<number> className="w-full" value={lev} onChange={setLev} options={levels.map((l) => ({ value: l, label: `${l}x`, disabled: side === 0 }))} />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-bg px-3 py-1.5">
        {side === 0 ? (
          <>
            {inTrade && (
              <>
                <Row label="Closes" value={tradeName(room, position)} />
                <Row label="Locks in" value={fmtPnl(open)} valueClass={pnlTone(open)} />
                <Row label="Closing cost" value="None" />
              </>
            )}
            <Row label="While flat" value={`-${flatPct(storm)}% a minute`} />
          </>
        ) : (
          <>
            {inTrade && !same && <Row label="Closes first" value={`${tradeName(room, position)} · ${fmtPnl(open)}`} />}
            <Row label="Market" value={`${symbol}/USD`} />
            <Row label="Notional" value={position ? `${size.toLocaleString(undefined, { maximumFractionDigits: 0 })} chips` : "—"} />
            <Row label={`Spread (${FLIP_COST_BPS} bps)`} value={position ? `${fee.toFixed(2)} chips` : "—"} />
          </>
        )}
      </div>
      <Button
        variant={side === 1 ? "up" : side === -1 ? "down" : "secondary"}
        size="lg"
        className="mt-4 w-full"
        disabled={blocked}
        onClick={() => onTrade(side, side === 0 ? 1 : lev, side === 0 ? (position?.assetIdx ?? asset) : asset)}
      >
        {dead
          ? "Eliminated"
          : side !== 0 && frozen === side
            ? `${side === 1 ? "Longs" : "Shorts"} frozen`
            : holdLeft > 0
              ? `Hold ${holdLeft.toFixed(1)}s`
              : busy
                ? "Submitting…"
                : same
                  ? side === 0
                    ? "Already flat"
                    : "Position open"
                  : side === 0
                    ? `Close · lock in ${fmtPnl(open)}`
                    : `${side === 1 ? "Long" : "Short"} ${symbol} ${lev}x`}
      </Button>
    </Card>
  );
}

const COLS = "grid-cols-[28px_minmax(0,1fr)_auto] sm:grid-cols-[36px_minmax(0,1fr)_92px_88px]";
const COLS_PAY = "grid-cols-[28px_minmax(0,1fr)_auto_auto] sm:grid-cols-[36px_minmax(0,1fr)_92px_88px_72px]";

export function PlayersTable({ room, me, payouts = false }: { room: RoomState; me: PublicKey | null; payouts?: boolean }) {
  const pot = room.entryAmount * BigInt(room.seatsFilled);
  const prize = pot - (pot * BigInt(room.feeBps)) / 10_000n;
  const split = prizeSplit(room.finalistCount);
  const ended = room.status >= 3 && room.finalistCount > 0;
  const bots = useBots();
  const rows = room.players
    .map((p, i) => ({ p, i, out: room.elimCheckpoint[i], rank: room.publicRank[i], place: room.placement[i] }))
    .sort((a, b) => {
      if (ended || (a.out && b.out)) return (a.place || 99) - (b.place || 99);
      if (a.out) return 1;
      if (b.out) return -1;
      return (a.rank || 99) - (b.rank || 99) || a.i - b.i;
    });
  return (
    <Card title={ended ? "Final standings" : `Leaderboard · ${room.status >= 2 ? `${room.aliveCount} alive` : `${room.seatsFilled} joined`}`} bodyClassName="p-0">
      <div className={cx("grid gap-3 border-b border-border px-4 py-2 text-[13px] font-medium text-faint", payouts ? COLS_PAY : COLS)}>
        <span>#</span>
        <span>Player</span>
        <span className="hidden sm:block">Status</span>
        <span className="text-right">Equity</span>
        {payouts && <span className="text-right">Payout</span>}
      </div>
      <ul>
        {rows.map(({ p, i, out, rank, place }) => {
          const mine = !!me && p.equals(me);
          const bot = bots.get(p.toBase58());
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
          const shown = ended || out ? place || "—" : rank || "—";
          return (
            <li key={p.toBase58()} className={cx("grid items-center gap-3 border-b border-border px-4 py-2.5 text-[13px] last:border-b-0", payouts ? COLS_PAY : COLS, mine && "bg-white/[0.04]")}>
              <span className={cx("num", place === 1 ? "text-white" : finalist ? "text-fg" : "text-faint")}>{shown}</span>
              <a href={explorerAccount(p.toBase58())} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 hover:text-fg">
                <Identicon pubkey={p} size={22} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className={cx("truncate text-fg", !bot && "num")}>{bot ?? short(p)}</span>
                    {mine && <Pill tone="accent">You</Pill>}
                    {bot && <Pill>Bot</Pill>}
                  </span>
                  <span className="mt-1 block sm:hidden">{statusPill}</span>
                </span>
              </a>
              <span className="hidden sm:block">{statusPill}</span>
              <span className="num text-right text-muted">
                {out || ended ? (
                  fmtChips(room.finalEquity[i])
                ) : room.status >= 2 ? (
                  <span className="inline-flex items-center justify-end gap-1 text-faint">
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

export type TxItem = { sig: string; label: string; ms: number; ok: boolean; at: number };

export function Activity({ items, token }: { items: TxItem[]; token: string | null }) {
  const ok = items.filter((i) => i.ok);
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : 0;
  return (
    <Card title="Your activity" action={<span className="num text-[11px] text-faint">{ok.length} onchain{avg ? ` · ${avg} ms avg` : ""}</span>} bodyClassName="p-0">
      {items.length === 0 ? (
        <div className="subhead px-4 py-5 text-lg text-white">Trades land here.</div>
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
