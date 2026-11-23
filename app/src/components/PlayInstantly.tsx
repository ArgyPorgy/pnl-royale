"use client";
import { Zap } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { IS_DEVNET } from "@/lib/royale/constants";
import { BurnerWalletName } from "@/lib/wallet/burner";
import { Button, cx } from "./ui";

/** Devnet only: one click to a burner wallet (the faucet funds it on create/join). */
export function PlayInstantly({ className, size = "md", label = "Play instantly" }: { className?: string; size?: "sm" | "md" | "lg"; label?: string }) {
  const { publicKey, select, connect, wallet } = useWallet();
  if (!IS_DEVNET || publicKey) return null;
  return (
    <Button
      variant="primary"
      size={size}
      className={cx(className)}
      aria-label={label}
      title="Creates a devnet wallet in this browser. The faucet funds it with devnet SOL and test USDC."
      onClick={async () => {
        if (wallet?.adapter.name !== BurnerWalletName) select(BurnerWalletName);
        else await connect().catch(() => undefined);
      }}
    >
      <Zap size={size === "sm" ? 14 : 16} strokeWidth={2.25} />
      {label}
    </Button>
  );
}
