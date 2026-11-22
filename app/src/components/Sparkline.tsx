"use client";
export function Sparkline({ data, width = 280, height = 56, entry }: { data: number[]; width?: number; height?: number; entry?: number }) {
  if (data.length < 2) return <div style={{ height }} className="grid place-items-center text-xs text-dim">waiting for ticks…</div>;
  const lo = Math.min(...data, entry ?? Infinity);
  const hi = Math.max(...data, entry ?? -Infinity);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - lo) / span) * (height - 6) - 3}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const ey = entry !== undefined ? height - ((entry - lo) / span) * (height - 6) - 3 : null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {ey !== null && <line x1="0" x2={width} y1={ey} y2={ey} stroke="#ffc940" strokeDasharray="4 4" strokeWidth="1" />}
      <polyline points={pts} fill="none" stroke={up ? "#22e58a" : "#ff3b6b"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
