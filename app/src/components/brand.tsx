"use client";
import type { PublicKey } from "@solana/web3.js";
import { feedById } from "@/lib/royale/constants";
import { cx } from "./ui";

/** Logo mark: three ascending candles inside a rounded square; the tallest one survives. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#7c6cff" />
      <rect x="7" y="17" width="4" height="8" rx="1.2" fill="#fff" opacity="0.45" />
      <rect x="14" y="12" width="4" height="13" rx="1.2" fill="#fff" opacity="0.7" />
      <rect x="21" y="7" width="4" height="18" rx="1.2" fill="#fff" />
      <rect x="22.5" y="4.5" width="1" height="3" rx="0.5" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">PnL Royale</span>
    </span>
  );
}

/** Token logo from /public/tokens (by Pyth Lazer feed id). */
export function TokenIcon({ id, size = 20, className }: { id: number; size?: number; className?: string }) {
  const f = feedById(id);
  if (!f) return <span className={cx("inline-block rounded-full bg-surface-3", className)} style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={f.logo} alt={f.symbol} width={size} height={size} className={cx("shrink-0 rounded-full ring-1 ring-white/10", className)} />;
}

export function TokenStack({ ids, size = 20 }: { ids: number[]; size?: number }) {
  return (
    <span className="flex items-center">
      {ids.map((id, i) => (
        <span key={id} className="rounded-full ring-2 ring-surface" style={{ marginLeft: i === 0 ? 0 : -size / 3 }}>
          <TokenIcon id={id} size={size} />
        </span>
      ))}
    </span>
  );
}

/** Deterministic 5x5 symmetric identicon from a public key: one muted hue, no randomness. */
export function Identicon({ pubkey, size = 24, className }: { pubkey: PublicKey | string; size?: number; className?: string }) {
  const bytes = typeof pubkey === "string" ? new TextEncoder().encode(pubkey) : pubkey.toBytes();
  const hue = ((bytes[0] << 8) | bytes[1]) % 360;
  const fg = `hsl(${hue} 55% 62%)`;
  const bg = `hsl(${hue} 30% 16%)`;
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if ((bytes[2 + y * 3 + x] ?? 0) % 2 === 0) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" className={cx("shrink-0 rounded-md", className)} aria-hidden>
      <rect width="7" height="7" fill={bg} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={fg} />
      ))}
    </svg>
  );
}
