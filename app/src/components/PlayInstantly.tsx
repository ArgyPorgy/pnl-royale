"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { IS_DEVNET } from "@/lib/royale/constants";
import { BurnerWalletName } from "@/lib/wallet/burner";

/** Devnet only: one click to a funded burner wallet (no extension needed). */
export function PlayInstantly({ className = "" }: { className?: string }) {
  const { publicKey, select, connect, wallet } = useWallet();
  if (!IS_DEVNET || publicKey) return null;
  return (
    <button
      className={`btn bg-gold px-3 py-2 text-sm text-ink ${className}`}
      title="Creates a devnet burner wallet in this browser. The faucet funds it with devnet SOL and test USDC when you join."
      onClick={async () => {
        if (wallet?.adapter.name !== BurnerWalletName) select(BurnerWalletName);
        else await connect().catch(() => undefined);
      }}
    >
      ⚡ Play instantly
    </button>
  );
}
