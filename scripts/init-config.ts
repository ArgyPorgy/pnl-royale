// Initialize the protocol config. Must be signed by the program's upgrade authority.
//
//   ADMIN_KEYPAIR=~/.config/solana/royale-admin.json NEXT_PUBLIC_CLUSTER=mainnet \
//   FEE_BPS=500 MIN_ENTRY_USDC=1 MAX_ENTRY_USDC=100 npx tsx scripts/init-config.ts
//
// The fee vault is FEE_VAULT_OWNER's USDC ATA (default: the admin), created if missing.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { configPda, ixInitConfig, withPriority } from "../app/src/lib/royale/client";
import { L1_RPC, PROGRAM_ID, USDC_MINT, explorerTx } from "../app/src/lib/royale/constants";

const ADMIN = process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/royale-admin.json`;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN, "utf8"))));
const l1 = new Connection(L1_RPC, "confirmed");

(async () => {
  if (await l1.getAccountInfo(configPda())) {
    console.log("config already initialized:", configPda().toBase58());
    return;
  }
  // Fees go to FEE_VAULT_OWNER's USDC account (e.g. your main wallet), default the admin.
  const feeOwner = process.env.FEE_VAULT_OWNER ? new PublicKey(process.env.FEE_VAULT_OWNER) : admin.publicKey;
  const feePayer = admin.publicKey;
  const feeVault = getAssociatedTokenAddressSync(USDC_MINT, feeOwner);
  const tx = new Transaction().add(...withPriority([
    createAssociatedTokenAccountIdempotentInstruction(feePayer, feeVault, feeOwner, USDC_MINT),
    await ixInitConfig(
      admin.publicKey,
      feeVault,
      Number(process.env.FEE_BPS ?? 500),
      BigInt(Math.round(Number(process.env.MIN_ENTRY_USDC ?? 1) * 1e6)),
      BigInt(Math.round(Number(process.env.MAX_ENTRY_USDC ?? 100) * 1e6)),
    ),
  ]));
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await l1.getLatestBlockhash()).blockhash;
  tx.sign(admin);
  const sig = await l1.sendRawTransaction(tx.serialize());
  await l1.confirmTransaction(sig, "confirmed");
  console.log(`config ${configPda().toBase58()} for program ${PROGRAM_ID.toBase58()}, fee vault ${feeVault.toBase58()}`);
  console.log(explorerTx(sig));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
