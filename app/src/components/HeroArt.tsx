// Hero banner: a candle chart with three equity lines; one breaks the cut line and is eliminated.
// Deterministic (no Math.random) so server and client render identically.

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

export function HeroArt() {
  const W = 560;
  const H = 380;
  const n = 34;
  const closes = walk(7, n, 200, 22, -0.4);
  const candles = closes.map((c, i) => {
    const o = i === 0 ? c + 6 : closes[i - 1];
    const hi = Math.max(o, c) + 6 + ((i * 37) % 9);
    const lo = Math.min(o, c) - 6 - ((i * 53) % 9);
    return { o, c, hi, lo };
  });
  const lo = Math.min(...candles.map((k) => k.lo)) - 20;
  const hi = Math.max(...candles.map((k) => k.hi)) + 20;
  const y = (v: number) => 40 + ((hi - v) / (hi - lo)) * (H - 120);
  const cw = (W - 80) / n;
  const lines = [
    { pts: walk(11, n, 150, 9, 1.3), color: "#7c6cff" },
    { pts: walk(29, n, 150, 9, 0.2), color: "#8b929d" },
    { pts: walk(41, n, 150, 9, -2.6), color: "#f6465d" },
  ];
  const ly = (v: number) => 236 + (150 - v) * 1.35;
  const cutY = 300;
  const path = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${40 + i * cw + cw / 2},${Math.min(ly(v), 352).toFixed(1)}`).join(" ");

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-border bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_0%,rgba(124,108,255,0.16),transparent_60%)]" />
      <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full" role="img" aria-label="Illustration of a trading round">
        {Array.from({ length: 7 }, (_, i) => (
          <line key={i} x1="40" x2={W - 40} y1={40 + i * 48} y2={40 + i * 48} stroke="#22262e" strokeWidth="1" />
        ))}
        {candles.map((k, i) => {
          const up = k.c >= k.o;
          const x = 40 + i * cw + cw / 2;
          const color = up ? "#0ecb81" : "#f6465d";
          return (
            <g key={i} opacity="0.32">
              <line x1={x} x2={x} y1={y(k.hi)} y2={y(k.lo)} stroke={color} strokeWidth="1" />
              <rect x={x - cw * 0.3} width={cw * 0.6} y={y(Math.max(k.o, k.c))} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} fill={color} rx="1" />
            </g>
          );
        })}
        <line x1="40" x2={W - 40} y1={cutY} y2={cutY} stroke="#f6465d" strokeDasharray="5 5" strokeWidth="1.25" opacity="0.8" />
        <rect x={W - 118} y={cutY - 11} width="78" height="22" rx="6" fill="#2a1418" stroke="#f6465d" strokeOpacity="0.4" />
        <text x={W - 79} y={cutY + 4} textAnchor="middle" fontSize="11" fill="#f6465d" fontFamily="var(--font-geist-mono)">
          CUT LINE
        </text>
        {lines.map((l, i) => (
          <path key={i} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={i === 0 ? 2.25 : 1.75} strokeLinejoin="round" opacity={i === 2 ? 0.75 : 1} />
        ))}
        {lines.map((l, i) => {
          const last = l.pts.length - 1;
          const cx = 40 + last * cw + cw / 2;
          const cy = Math.min(ly(l.pts[last]), 352);
          return <circle key={i} cx={cx} cy={cy} r="4" fill={l.color} stroke="#111318" strokeWidth="2" />;
        })}
      </svg>
      <div className="relative grid grid-cols-3 border-t border-border">
        {[
          ["Players", "4 to 16", "text-fg"],
          ["Elimination", "Every interval", "text-fg"],
          ["Storms", "VRF, each interval", "text-[#a99fff]"],
        ].map(([k, v, c]) => (
          <div key={k} className="border-r border-border px-4 py-3 last:border-r-0">
            <div className="text-[11px] text-faint">{k}</div>
            <div className={`num mt-0.5 text-sm ${c}`}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
