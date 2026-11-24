"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

// Illustrated round. The chart is deterministic. The footer clock is client-only.

function walk(seed: number, n: number, start: number, vol: number, drift = 0) {
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v += (rnd() - 0.5) * vol + drift;
    out.push(v);
  }
  return out;
}

const CUTS = 7;
const START_ALIVE = 8;
const ROUND_SECS = 12;
/** Alive at cuts 1 through 7. Drops every cut and is 1 on the last. */
const ALIVE_AT = [8, 7, 6, 5, 4, 2, 1];

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function HeroArt() {
  const [cut, setCut] = useState(1);
  const [left, setLeft] = useState(ROUND_SECS);
  const [book, setBook] = useState<{ equity: number; dir: -1 | 0 | 1 }>({ equity: 12480, dir: 0 });
  const [reduce, setReduce] = useState(false);
  const cutRef = useRef(1);
  const leftRef = useRef(ROUND_SECS);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      if (leftRef.current <= 0) {
        const next = cutRef.current >= CUTS ? 1 : cutRef.current + 1;
        cutRef.current = next;
        leftRef.current = ROUND_SECS;
        setCut(next);
        setLeft(ROUND_SECS);
      } else {
        leftRef.current -= 1;
        setLeft(leftRef.current);
      }
      setBook((cur) => {
        const delta = Math.round((Math.random() - 0.48) * 80);
        const equity = Math.min(15999, Math.max(10000, cur.equity + delta));
        const dir = equity > cur.equity ? 1 : equity < cur.equity ? -1 : 0;
        return { equity, dir };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [reduce]);

  const alive = ALIVE_AT[cut - 1] ?? START_ALIVE;
  const W = 640;
  const H = 420;
  const n = 36;
  const closes = walk(7, n, 210, 18, 0.15);
  const candles = closes.map((c, i) => {
    const o = i === 0 ? c - 4 : closes[i - 1];
    const hi = Math.max(o, c) + 5 + ((i * 37) % 8);
    const lo = Math.min(o, c) - 5 - ((i * 53) % 8);
    return { o, c, hi, lo };
  });
  const lo = Math.min(...candles.map((k) => k.lo)) - 16;
  const hi = Math.max(...candles.map((k) => k.hi)) + 24;
  const y = (v: number) => 36 + ((hi - v) / (hi - lo)) * (H - 150);
  const cw = (W - 72) / n;
  const lines = [
    { pts: walk(11, n, 148, 8, 1.15), color: "#e6f77a", name: "You" },
    { pts: walk(29, n, 146, 8, 0.15), color: "#f4f1ea", name: "Seat 4" },
    { pts: walk(41, n, 150, 8, -2.4), color: "#ff4d6d", name: "Seat 7" },
  ];
  const ly = (v: number) => 250 + (150 - v) * 1.15;
  const cutY = 318;
  const path = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${36 + i * cw + cw / 2},${Math.min(ly(v), H - 28).toFixed(1)}`).join(" ");

  return (
    <div className="glass relative overflow-hidden rounded-[24px]">
      <div className="relative flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-down" />
          <span className="kicker">Illustrated round</span>
        </div>
        <div className="num text-xs text-faint">
          Cut <span className="inline-block w-[1ch] text-center">{cut}</span>
          <span className="px-1">·</span>
          <span className="inline-block w-[5ch] text-left">{clock(left)}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full" role="img" aria-label="Illustration of a trading round with a cut line">
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1="28" x2={W - 28} y1={48 + i * 52} y2={48 + i * 52} stroke="#222a3a" strokeWidth="1" />
        ))}
        {candles.map((k, i) => {
          const up = k.c >= k.o;
          const x = 36 + i * cw + cw / 2;
          const color = up ? "#1edb8a" : "#ff4d6d";
          return (
            <g key={i} opacity="0.38">
              <line x1={x} x2={x} y1={y(k.hi)} y2={y(k.lo)} stroke={color} strokeWidth="1" />
              <rect x={x - cw * 0.28} width={cw * 0.56} y={y(Math.max(k.o, k.c))} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} fill={color} rx="1" />
            </g>
          );
        })}
        <line x1="28" x2={W - 28} y1={cutY} y2={cutY} stroke="#ff4d6d" strokeDasharray="5 5" strokeWidth="1.25" />
        <rect x={W - 132} y={cutY - 12} width="92" height="24" rx="12" fill="#2a1218" stroke="#ff4d6d" strokeOpacity="0.5" />
        <text x={W - 86} y={cutY + 4} textAnchor="middle" fontSize="11" fill="#ff4d6d" fontFamily="var(--font-jetbrains), ui-monospace, monospace">
          CUT LINE
        </text>
        {lines.map((l, i) => (
          <path key={i} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={i === 0 ? 2.4 : 1.7} strokeLinejoin="round" />
        ))}
        {lines.map((l, i) => {
          const last = l.pts.length - 1;
          const cx = 36 + last * cw + cw / 2;
          const cy = Math.min(ly(l.pts[last]), H - 28);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r="5" fill={l.color} stroke="#0c1018" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
      <div className="relative grid grid-cols-3 border-t border-border">
        {[
          ["Alive", `${alive} of ${START_ALIVE}`, "text-white"],
          ["Your equity", book.equity.toLocaleString("en-US"), book.dir > 0 ? "text-up" : book.dir < 0 ? "text-down" : "text-white"],
          ["Next cut", clock(left), "text-white"],
        ].map(([k, v, c]) => (
          <div key={k} className="border-r border-border px-4 py-3 last:border-r-0">
            <div className="text-[11px] text-faint">{k}</div>
            <div className={cx("num mt-0.5 inline-block min-w-[6.5ch] text-left text-sm tabular-nums transition-colors", c)}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
