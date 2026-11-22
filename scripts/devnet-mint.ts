// Devnet only: create a 6-decimal test "USDC" mint owned by the admin and mint 1,000 to the admin.
// Then: export NEXT_PUBLIC_USDC_MINT=<printed mint> before init-config / e2e / the app.
import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { CLUSTER, L1_RPC } from "../app/src/lib/royale/constants";

const ADMIN = process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/royale-admin.json`;
(async () => {
  if (CLUSTER === "mainnet") throw new Error("devnet-mint is for devnet/localnet only");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN, "utf8"))));
  const l1 = new Connection(L1_RPC, "confirmed");
  const mint = await createMint(l1, admin, admin.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(l1, admin, mint, admin.publicKey);
  await mintTo(l1, admin, mint, ata.address, admin, 1_000_000_000n);
  console.log(`export NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
