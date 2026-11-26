"use client";
// Small SVG charts for the analytics page. Thin marks, 4px rounded data ends square at the
// baseline, 2px surface gaps, hairline grid, a legend for two or more series, hover tooltips.
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Categorical slots, dark steps (validated against the card surface #16151c). */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;
const SURFACE = "#16151c";
const GRID = "rgba(255,255,255,0.08)";
const AXIS_TEXT = "#6f6d7a";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A clean axis maximum and its ticks. Counts get whole-number steps. */
function niceScale(max: number, ticks = 4, integer = false) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = Math.max(max / ticks, integer ? 1 : 0);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = steps.map((m) => m * mag).find((s) => s >= raw && (!integer || Number.isInteger(s))) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** Rect with only the top corners rounded (the data end); the baseline end stays square. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export type Column = { label: string; full: string; values: number[] };

/** Columns over time, stacked when there are several series. */
export function Columns({
  data,
  series,
  format,
  height = 220,
  empty = "Nothing yet.",
  integer = false,
}: {
  data: Column[];
  series: { name: string; color: string }[];
  format: (v: number) => string;
  height?: number;
  empty?: string;
  /** Counts: whole-number axis ticks. */
  integer?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const { top, ticks } = niceScale(Math.max(0, ...totals), 4, integer);
  const left = 52;
  const right = 8;
  const pad = { top: 10, bottom: 26 };
  const plotW = Math.max(0, width - left - right);
  const plotH = height - pad.top - pad.bottom;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const allZero = totals.every((t) => t === 0);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(" and ")} by day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS_TEXT} className="num">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = left + band * i + band / 2;
            let base = y(0);
            const segs = d.values.map((v, s) => ({ v, s })).filter((x) => x.v > 0);
            return (
              <g key={d.full}>
                {segs.map(({ v, s }, k) => {
                  const h = Math.max(1, y(0) - y(v));
                  const isTop = k === segs.length - 1;
                  // 2px surface gap between stacked segments.
                  const gap = k > 0 ? 2 : 0;
                  const yTop = base - h;
                  const path = isTop
                    ? topRounded(cx - barW / 2, yTop, barW, h - gap, 4)
                    : `M${cx - barW / 2},${base - gap}V${yTop}H${cx + barW / 2}V${base - gap}Z`;
                  base = yTop;
                  return <path key={s} d={path} fill={series[s].color} opacity={hover === null || hover === i ? 1 : 0.55} />;
                })}
                {/* Every nth day, counted back from the latest so today always has a label. */}
                {(data.length - 1 - i) % Math.ceil(data.length / Math.max(2, Math.min(7, Math.floor(plotW / 64)))) === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {d.label}
                  </text>
                )}
                <rect
                  x={left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
        </svg>
      )}
      {allZero && <div className="absolute inset-0 grid place-items-center text-sm text-muted">{empty}</div>}
      {hover !== null && !allZero && (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(0, left + band * hover + band / 2 - 75), Math.max(0, width - 160)),
            top: 0,
          }}
        >
          <div className="mb-1 font-semibold text-fg">{data[hover].full}</div>
          {series.map((s, k) => (
            <div key={s.name} className="flex items-center justify-between gap-3 text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="num text-fg">{format(data[hover].values[k])}</span>
            </div>
          ))}
          {series.length > 1 && (
            <div className="mt-1 flex justify-between border-t border-border pt-1 text-muted">
              Total <span className="num text-fg">{format(totals[hover])}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with the value at the tip. One series, so no legend. */
export function Bars({ rows, color = SERIES[0], format = String, empty = "Nothing yet." }: { rows: { label: ReactNode; key: string; value: number }[]; color?: string; format?: (v: number) => string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (max === 0) return <div className="py-8 text-center text-sm text-muted">{empty}</div>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 text-xs" title={`${r.key}: ${format(r.value)}`}>
          <span className="truncate text-muted">{r.label}</span>
          <span className="flex items-center gap-2">
            {r.value > 0 && <span className="h-3.5 rounded-r-[4px]" style={{ width: `calc(${(r.value / max) * 100}% - 40px)`, minWidth: 2, background: color }} />}
            <span className="num text-fg">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** White or near-black, whichever reads better on `hex`. */
function inkOn(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (1.05) / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#ffffff" : "#0b0a10";
}

/** One whole split into parts: a tall segmented bar with counts inside where they fit. */
export function Segments({ parts }: { parts: { name: string; value: number; color: string }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = parts.reduce((a, p) => a + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const gaps = Math.max(0, shown.length - 1) * 2;
  const fits = (p: { value: number }) => ((width - gaps) * p.value) / total >= String(p.value).length * 8 + 16;
  return (
    <div>
      <div ref={ref} className="flex h-7 w-full gap-[2px]" role="img" aria-label={parts.map((p) => `${p.name} ${p.value}`).join(", ")}>
        {total === 0 ? (
          <div className="h-full w-full rounded-[4px] bg-surface-3" />
        ) : (
          shown.map((p) => (
            <div
              key={p.name}
              className="flex h-full items-center rounded-[4px] px-2 text-xs font-semibold"
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color, color: inkOn(p.color) }}
              title={`${p.name}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}
            >
              {width > 0 && fits(p) ? p.value : null}
            </div>
          ))
        )}
      </div>
      <div className="mt-3">
        <Legend items={parts.map((p) => ({ name: width > 0 && p.value > 0 && fits(p) ? p.name : `${p.name} ${p.value}`, color: p.color }))} />
      </div>
    </div>
  );
}
