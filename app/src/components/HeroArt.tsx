// Illustrated round: candles, three equity traces, one elimination at the cut line.
// Deterministic so server and client render the same picture.

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
    { pts: walk(11, n, 148, 8, 1.15), color: "#e0b45a", name: "You" },
    { pts: walk(29, n, 146, 8, 0.15), color: "#c9d0dc", name: "Seat 4" },
    { pts: walk(41, n, 150, 8, -2.4), color: "#ff4d6d", name: "Seat 7" },
  ];
  const ly = (v: number) => 250 + (150 - v) * 1.15;
  const cutY = 318;
  const path = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${36 + i * cw + cw / 2},${Math.min(ly(v), H - 28).toFixed(1)}`).join(" ");

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border bg-[#0c1018] shadow-[0_30px_80px_-40px_rgba(224,180,90,0.45)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_0%,rgba(224,180,90,0.16),transparent_55%)]" />
      <div className="relative flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-down" />
          <span className="kicker">Illustrated round</span>
        </div>
        <div className="num text-xs text-faint">CUT 3 · 00:42</div>
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
          ["Alive", "8 of 8", "text-fg"],
          ["Your equity", "12,480", "text-accent"],
          ["Next cut", "00:42", "text-fg"],
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
