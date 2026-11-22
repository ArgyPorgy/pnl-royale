"use client";
import { Buffer } from "buffer";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { IS_DEVNET, L1_RPC } from "@/lib/royale/constants";
import { BurnerWalletAdapter } from "@/lib/wallet/burner";

if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function Providers({ children }: { children: ReactNode }) {
  // Wallet Standard auto-detects Phantom, Backpack, Solflare, etc. On devnet we also offer a
  // one-click burner so anyone can play without an extension.
  const wallets = useMemo(() => (IS_DEVNET ? [new BurnerWalletAdapter()] : []), []);
  return (
    <ConnectionProvider endpoint={L1_RPC} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
