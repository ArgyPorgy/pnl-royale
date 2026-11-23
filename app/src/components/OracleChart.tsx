"use client";

/** Candle chart drawn from an oracle price series. Deterministic layout, no external widget. */
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
  const group = Math.max(2, Math.floor(n / 42));
  const candles: { o: number; c: number; hi: number; lo: number }[] = [];
  for (let i = 0; i < n; i += group) {
    const slice = points.slice(i, Math.min(n, i + group));
    candles.push({ o: slice[0], c: slice[slice.length - 1], hi: Math.max(...slice), lo: Math.min(...slice) });
  }
  const cw = (W - left - right) / candles.length;
  const last = points[n - 1];
  const first = points[0];
  const up = last >= first;
  const color = up ? accent : "#ff4d6d";
  const ticks = 4;
  const grid = Array.from({ length: ticks }, (_, i) => {
    const v = max + pad - ((max - min + pad * 2) * i) / (ticks - 1);
    return { v, y: y(v) };
  });
  const line = points.map((v, i) => `${i ? "L" : "M"}${left + (i / (n - 1)) * (W - left - right)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${left + (W - left - right)},${H - bot} L${left},${H - bot} Z`;

  const fmt = (v: number) => {
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.01) return v.toFixed(4);
    return v.toPrecision(3);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img" aria-label="Oracle price chart">
      <defs>
        <linearGradient id="oracle-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g.y}>
          <line x1={left} x2={W - right} y1={g.y} y2={g.y} stroke="#2a3346" strokeWidth="1" />
          <text x={W - right + 8} y={g.y + 4} fill="#6e778a" fontSize="11" fontFamily="var(--font-jetbrains), ui-monospace, monospace">
            {fmt(g.v)}
          </text>
        </g>
      ))}
      {candles.map((k, i) => {
        const rising = k.c >= k.o;
        const c = rising ? "#1edb8a" : "#ff4d6d";
        const x = left + i * cw + cw / 2;
        return (
          <g key={i} opacity="0.55">
            <line x1={x} x2={x} y1={y(k.hi)} y2={y(k.lo)} stroke={c} strokeWidth="1" />
            <rect x={x - cw * 0.28} width={Math.max(1.5, cw * 0.56)} y={y(Math.max(k.o, k.c))} height={Math.max(1.4, Math.abs(y(k.o) - y(k.c)))} fill={c} rx="1" />
          </g>
        );
      })}
      <path d={area} fill="url(#oracle-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={left + (W - left - right)} cy={y(last)} r="4.5" fill={color} stroke="#10141c" strokeWidth="2" />
      <rect x={W - right + 4} y={y(last) - 11} width={right - 10} height="22" rx="6" fill={color} />
      <text x={W - right + 10} y={y(last) + 4} fill="#04140c" fontSize="11" fontFamily="var(--font-jetbrains), ui-monospace, monospace" fontWeight="700">
        {fmt(last)}
      </text>
    </svg>
  );
}
