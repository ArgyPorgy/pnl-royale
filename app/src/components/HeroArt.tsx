"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

// Illustrated round. The first frame is deterministic so server and client match; after that the
// chart moves on its own. Frames are painted straight onto the SVG, not through React.

const CUTS = 7;
const START_ALIVE = 8;
const ROUND_SECS = 12;
/** Alive at cuts 1 through 7. Drops every cut and is 1 on the last. */
const ALIVE_AT = [8, 7, 6, 5, 4, 2, 1];

const W = 640;
const H = 420;
const N = 36;
const CW = (W - 72) / N;
const X0 = 36 + CW / 2;
const XR = X0 + (N - 1) * CW;
const CUT_Y = 318;
/** One new candle and one new point per line. */
const STEP_MS = 700;
/** The last seat fades out at a cut, then a new one fades in. */
const FADE_MS = 700;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Rnd = () => number;
function seeded(seed: number): Rnd {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** Arrays hold N settled values plus the one still forming. Lines are in pixels: lower is higher. */
type Scene = { k: number; closes: number[]; wicks: [number, number][]; you: number[]; mid: number[]; low: number[] };

const nextClose = (v: number, r: Rnd) => clamp(v + (210 - v) * 0.07 + (r() - 0.5) * 30, 162, 258);
const nextWick = (r: Rnd): [number, number] => [2 + r() * 8, 2 + r() * 8];
const nextYou = (v: number, k: number, r: Rnd) => clamp(v + (118 + 34 * Math.sin(k / 8) - v) * 0.16 + (r() - 0.5) * 34, 52, 190);
const nextMid = (v: number, k: number, r: Rnd) => clamp(v + (206 + 30 * Math.sin(k / 6 + 2) - v) * 0.16 + (r() - 0.5) * 34, 120, 284);
/** The last seat sinks through the cut line as the clock runs out. */
const nextLow = (v: number, left: number, r: Rnd) => clamp(v + (352 - left * 6 - v) * 0.2 + (r() - 0.5) * 26, 226, H - 34);

function freshLow(r: Rnd) {
  const out = [262];
  while (out.length <= N) out.push(nextLow(out[out.length - 1], ROUND_SECS, r));
  return out;
}

function firstScene(): Scene {
  const r = seeded(7);
  const s: Scene = { k: 0, closes: [204], wicks: [nextWick(r)], you: [232], mid: [212], low: freshLow(r) };
  for (let i = 1; i <= N; i++) {
    s.closes.push(nextClose(s.closes[i - 1], r));
    s.wicks.push(nextWick(r));
    s.you.push(nextYou(s.you[i - 1], i, r));
    s.mid.push(nextMid(s.mid[i - 1], i, r));
  }
  s.k = N;
  return s;
}

function advance(s: Scene, left: number, r: Rnd) {
  s.k += 1;
  const roll = <T,>(a: T[], v: T) => {
    a.push(v);
    a.shift();
  };
  roll(s.closes, nextClose(s.closes[N], r));
  roll(s.wicks, nextWick(r));
  roll(s.you, nextYou(s.you[N], s.k, r));
  roll(s.mid, nextMid(s.mid[N], s.k, r));
  roll(s.low, nextLow(s.low[N], left, r));
}

/** Smooth path through the settled points, ending on a tip that slides toward the forming value. */
function curve(ys: number[], t: number) {
  const p = ys.slice(0, N).map((y, i) => [X0 + (i - t) * CW, y] as const);
  const tip = [XR, lerp(ys[N - 1], ys[N], t)] as const;
  p.push(tip);
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[i];
    const c = p[i + 1];
    const e = p[Math.min(p.length - 1, i + 2)];
    const f = (v: number) => v.toFixed(1);
    d += `C${f(b[0] + (c[0] - a[0]) / 6)},${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)},${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])},${f(c[1])}`;
  }
  return { d, tip: tip[1] };
}

const candleY = (v: number) => 36 + ((272 - v) / 124) * (H - 150);

function candles(s: Scene, t: number) {
  let up = "";
  let down = "";
  const w = CW * 0.56;
  for (let i = 0; i <= N; i++) {
    const x = X0 + (i - t) * CW;
    const open = i === 0 ? s.closes[0] - 4 : s.closes[i - 1];
    const grow = i === N ? t : 1;
    const close = lerp(open, s.closes[i], grow);
    const hi = candleY(Math.max(open, close) + s.wicks[i][0] * grow);
    const lo = candleY(Math.min(open, close) - s.wicks[i][1] * grow);
    const top = candleY(Math.max(open, close));
    const h = Math.max(1.5, candleY(Math.min(open, close)) - top);
    const d = `M${x.toFixed(1)},${hi.toFixed(1)}V${lo.toFixed(1)}M${(x - w / 2).toFixed(1)},${top.toFixed(1)}h${w.toFixed(1)}v${h.toFixed(1)}h${(-w).toFixed(1)}z`;
    if (close >= open) up += d;
    else down += d;
  }
  return { up, down };
}

const equityOf = (y: number) => Math.round(10_000 + (CUT_Y - y) * 14);

function geometry(s: Scene, t: number) {
  const you = curve(s.you, t);
  return {
    ...candles(s, t),
    you,
    mid: curve(s.mid, t),
    low: curve(s.low, t),
    area: `${you.d}L${XR},${CUT_Y}L${(X0 - t * CW).toFixed(1)},${CUT_Y}Z`,
  };
}

const FIRST = geometry(firstScene(), 0);
const FIRST_EQUITY = equityOf(FIRST.you.tip);

export function HeroArt() {
  const [cut, setCut] = useState(1);
  const [left, setLeft] = useState(ROUND_SECS);
  const [book, setBook] = useState<{ equity: number; dir: -1 | 0 | 1 }>({ equity: FIRST_EQUITY, dir: 0 });
  const [reduce, setReduce] = useState(false);
  const cutRef = useRef(1);
  const leftRef = useRef(ROUND_SECS);
  const cutAt = useRef(-Infinity);
  const svg = useRef<SVGSVGElement>(null);

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
        cutAt.current = performance.now();
        setCut(next);
        setLeft(ROUND_SECS);
      } else {
        leftRef.current -= 1;
        setLeft(leftRef.current);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [reduce]);

  useEffect(() => {
    const root = svg.current;
    if (reduce || !root) return;
    const part = (name: string) => root.querySelector<SVGElement>(`[data-part="${name}"]`)!;
    const el = {
      up: part("up"),
      down: part("down"),
      area: part("area"),
      low: part("low"),
      lines: { you: part("you"), mid: part("mid"), low: part("low-line") },
      tips: { you: part("you-tip"), halo: part("you-halo"), mid: part("mid-tip"), low: part("low-tip") },
    };
    const scene = firstScene();
    let raf = 0;
    let stepAt = performance.now();
    let reseeded = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - stepAt >= STEP_MS) {
        advance(scene, leftRef.current, Math.random);
        // Back from a hidden tab: carry on from here instead of catching up.
        stepAt = now - stepAt > STEP_MS * 3 ? now : stepAt + STEP_MS;
        const equity = equityOf(scene.you[N - 1]);
        setBook((b) => ({ equity, dir: equity > b.equity ? 1 : equity < b.equity ? -1 : 0 }));
      }
      const since = now - cutAt.current;
      if (since >= FADE_MS && reseeded !== cutAt.current && Number.isFinite(cutAt.current)) {
        reseeded = cutAt.current;
        scene.low = freshLow(Math.random);
      }
      const g = geometry(scene, clamp((now - stepAt) / STEP_MS, 0, 1));
      el.up.setAttribute("d", g.up);
      el.down.setAttribute("d", g.down);
      el.area.setAttribute("d", g.area);
      el.lines.you.setAttribute("d", g.you.d);
      el.lines.mid.setAttribute("d", g.mid.d);
      el.lines.low.setAttribute("d", g.low.d);
      el.tips.you.setAttribute("cy", g.you.tip.toFixed(1));
      el.tips.halo.setAttribute("cy", g.you.tip.toFixed(1));
      el.tips.mid.setAttribute("cy", g.mid.tip.toFixed(1));
      el.tips.low.setAttribute("cy", g.low.tip.toFixed(1));
      el.low.setAttribute("opacity", since < FADE_MS ? (1 - since / FADE_MS).toFixed(2) : since < FADE_MS * 2 ? (since / FADE_MS - 1).toFixed(2) : "1");
    };
    // Only animate while the banner is on screen.
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(frame);
    });
    io.observe(root);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const alive = ALIVE_AT[cut - 1] ?? START_ALIVE;
  const dot = { r: 5, stroke: "#0c1018", strokeWidth: 2, cx: XR };

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
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="relative block w-full" role="img" aria-label="Illustration of a trading round with a cut line">
        <defs>
          <clipPath id="hero-plot">
            <rect x={X0 - CW / 2} y="0" width={XR - X0 + CW} height={H} />
          </clipPath>
          <linearGradient id="hero-you" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e6f77a" stopOpacity="0.2" />
            <stop offset="1" stopColor="#e6f77a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1="28" x2={W - 28} y1={48 + i * 52} y2={48 + i * 52} stroke="#222a3a" strokeWidth="1" />
        ))}
        <g clipPath="url(#hero-plot)">
          <path data-part="up" d={FIRST.up} fill="#1edb8a" stroke="#1edb8a" strokeWidth="1" opacity="0.36" />
          <path data-part="down" d={FIRST.down} fill="#ff4d6d" stroke="#ff4d6d" strokeWidth="1" opacity="0.36" />
          <path data-part="area" d={FIRST.area} fill="url(#hero-you)" />
        </g>
        <line x1="28" x2={W - 28} y1={CUT_Y} y2={CUT_Y} stroke="#ff4d6d" strokeDasharray="5 5" strokeWidth="1.25" />
        <g className={cx(left <= 3 && "cut-urgent")}>
          <rect x="40" y={CUT_Y - 12} width="92" height="24" rx="12" fill="#2a1218" stroke="#ff4d6d" strokeOpacity="0.5" />
          <text x="86" y={CUT_Y + 4} textAnchor="middle" fontSize="11" fill="#ff4d6d" fontFamily="var(--font-jetbrains), ui-monospace, monospace">
            CUT LINE
          </text>
        </g>
        <g data-part="low">
          <g clipPath="url(#hero-plot)">
            <path data-part="low-line" d={FIRST.low.d} fill="none" stroke="#ff4d6d" strokeWidth="1.8" strokeLinejoin="round" />
          </g>
          <circle data-part="low-tip" {...dot} cy={FIRST.low.tip.toFixed(1)} fill="#ff4d6d" />
        </g>
        <g clipPath="url(#hero-plot)">
          <path data-part="mid" d={FIRST.mid.d} fill="none" stroke="#f4f1ea" strokeWidth="1.8" strokeLinejoin="round" />
          <path data-part="you" d={FIRST.you.d} fill="none" stroke="#e6f77a" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
        <circle data-part="mid-tip" {...dot} cy={FIRST.mid.tip.toFixed(1)} fill="#f4f1ea" />
        <circle data-part="you-halo" cx={XR} cy={FIRST.you.tip.toFixed(1)} r="11" fill="#e6f77a" fillOpacity="0.25" className="pulse-dot" />
        <circle data-part="you-tip" {...dot} cy={FIRST.you.tip.toFixed(1)} fill="#e6f77a" />
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
