"use client";
import { fmtPrice } from "@/lib/royale/game";

/** Axis label with just enough decimals to tell neighbouring grid lines apart. */
function tickLabel(v: number, step: number) {
  const need = Math.ceil(-Math.log10(step || 1));
  if (v < 0.0001) return fmtPrice(v, Math.min(6, Math.max(4, need - Math.floor(-Math.log10(v)))));
  const dp = Math.min(8, Math.max(v >= 1000 ? 0 : 2, need));
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Line chart drawn from an oracle price series. Deterministic layout, no external widget. */
export function OracleChart({ points, accent = "#1edb8a" }: { points: number[]; accent?: string }) {
  const W = 800;
  const H = 360;
  const n = points.length;
  if (n < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const pad = (max - min) * 0.18 || Math.abs(max) * 0.002 || 1;
  const top = 28;
  const bot = 36;
  const left = 16;
  const right = 78;
  const y = (v: number) => top + ((max + pad - v) / (max - min + pad * 2)) * (H - top - bot);
  const last = points[n - 1];
  const up = last >= points[0];
  const color = up ? accent : "#ff4d6d";
  const ticks = 4;
  const step = (max - min + pad * 2) / (ticks - 1);
  const grid = Array.from({ length: ticks }, (_, i) => {
    const v = max + pad - step * i;
    return { v, y: y(v) };
  });
  const line = points.map((v, i) => `${i ? "L" : "M"}${(left + (i / (n - 1)) * (W - left - right)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W - right},${H - bot} L${left},${H - bot} Z`;
  const mono = "var(--font-jetbrains), ui-monospace, monospace";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img" aria-label="Oracle price line chart">
      <defs>
        <linearGradient id="oracle-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g.y}>
          <line x1={left} x2={W - right} y1={g.y} y2={g.y} stroke="#2a3346" strokeWidth="1" />
          <text x={W - right + 8} y={g.y + 4} fill="#6e778a" fontSize="11" fontFamily={mono}>
            {tickLabel(g.v, step)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#oracle-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={left} x2={W - right} y1={y(last)} y2={y(last)} stroke={color} strokeOpacity="0.35" strokeDasharray="3 5" strokeWidth="1" />
      <circle cx={W - right} cy={y(last)} r="4.5" fill={color} stroke="#10141c" strokeWidth="2" />
      <rect x={W - right + 4} y={y(last) - 11} width={right - 6} height="22" rx="6" fill={color} />
      <text x={W - right + 10} y={y(last) + 4} fill="#04140c" fontSize="11" fontFamily={mono} fontWeight="700">
        {tickLabel(last, step / 4)}
      </text>
    </svg>
  );
}
