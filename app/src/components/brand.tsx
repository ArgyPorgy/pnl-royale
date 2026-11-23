"use client";
import { useId } from "react";
import type { PublicKey } from "@solana/web3.js";
import { feedById } from "@/lib/royale/constants";
import { cx } from "./ui";

/** Crown of three candles. The tallest wick keeps the jewel. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const grad = `pnl-signal-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={grad} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67E8F9" />
          <stop offset="0.45" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#10141C" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="7.25" stroke={`url(#${grad})`} strokeWidth="1.5" />
      <path d="M7.2 23.6h17.6" stroke={`url(#${grad})`} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="8" y="15.6" width="3.2" height="8" rx="0.6" fill={`url(#${grad})`} opacity="0.5" />
      <rect x="14.4" y="11" width="3.2" height="12.6" rx="0.6" fill={`url(#${grad})`} opacity="0.78" />
      <rect x="20.8" y="7" width="3.2" height="16.6" rx="0.6" fill={`url(#${grad})`} />
      <path d="M9.6 13.2v2.4M16 8.2v2.8M22.4 4.15v2.85" stroke={`url(#${grad})`} strokeWidth="1.15" strokeLinecap="round" />
      <path d="M22.4 2.35l1.2 1.35-1.2 1.35-1.2-1.35z" fill="#67E8F9" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={compact ? 26 : 30} />
      <span className="leading-none">
        <span className="display block text-[17px] text-fg">
          PnL <span className="text-accent">Royale</span>
        </span>
      </span>
    </span>
  );
}

export function TokenIcon({ id, size = 20, className }: { id: number; size?: number; className?: string }) {
  const f = feedById(id);
  if (!f) return <span className={cx("inline-block rounded-full bg-surface-3", className)} style={{ width: size, height: size }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={f.logo}
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 rounded-full bg-[#0c0e14] object-contain ring-1 ring-white/15", className)}
    />
  );
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

export function UsdcIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/tokens/usdc.svg" alt="" width={size} height={size} className={cx("shrink-0 rounded-full", className)} />
  );
}

/** Deterministic 5x5 symmetric identicon from a public key. */
export function Identicon({ pubkey, size = 24, className }: { pubkey: PublicKey | string; size?: number; className?: string }) {
  const bytes = typeof pubkey === "string" ? new TextEncoder().encode(pubkey) : pubkey.toBytes();
  const hue = ((bytes[0] << 8) | bytes[1]) % 360;
  const fg = `hsl(${hue} 62% 64%)`;
  const bg = `hsl(${hue} 22% 14%)`;
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if ((bytes[2 + y * 3 + x] ?? 0) % 2 === 0) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" className={cx("shrink-0 rounded-md ring-1 ring-white/10", className)} aria-hidden>
      <rect width="7" height="7" fill={bg} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={fg} />
      ))}
    </svg>
  );
}

const PARTNERS = [
  { name: "Solana", src: "/brand/solana.svg", href: "https://solana.com" },
  { name: "MagicBlock", src: "/brand/magicblock-wordmark.svg", href: "https://www.magicblock.xyz", wide: true },
  { name: "Pyth", src: "/brand/pyth.svg", href: "https://www.pyth.network" },
];

export function PartnerLockup({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-8 gap-y-4", className)}>
      {PARTNERS.map((p) => (
        <a key={p.name} href={p.href} target="_blank" rel="noreferrer" className="opacity-80 transition-opacity hover:opacity-100" title={p.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt={p.name} className={p.wide ? "h-6 w-auto" : "h-7 w-7 rounded-full"} />
        </a>
      ))}
    </div>
  );
}

export const WALLETS = [
  { name: "Phantom", src: "/wallets/phantom.svg", href: "https://phantom.com" },
  { name: "Backpack", src: "/wallets/backpack.png", href: "https://backpack.app" },
  { name: "Solflare", src: "/wallets/solflare.svg", href: "https://solflare.com" },
];
