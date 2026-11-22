// Return everything from e2e throwaway player wallets to the admin after a settled round:
// close the Position (rent -> player), send USDC to the admin's ATA, close the player's ATA
// (rent -> admin), then send the remaining SOL to the admin.
//
//   ADMIN_KEYPAIR=... ROOM_ID=<id> npx tsx scripts/sweep-players.ts
// (reads target/e2e/players-<ROOM_ID>.json written by e2e-round.ts)
import { readFileSync } from "node:fs";
import { Connection, Keypair, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { configPda, coder, ixClosePosition, positionPda, roomPda, withPriority } from "../app/src/lib/royale/client";
import { L1_RPC, PROGRAM_ID } from "../app/src/lib/royale/constants";

const ADMIN = process.env.ADMIN_KEYPAIR!;
const ROOM_ID = BigInt(process.env.ROOM_ID ?? "0");
const l1 = new Connection(L1_RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN, "utf8"))));
const players = (JSON.parse(readFileSync(`target/e2e/players-${ROOM_ID}.json`, "utf8")) as number[][]).map((s) =>
  Keypair.fromSecretKey(Uint8Array.from(s)),
);

async function send(ixs: TransactionInstruction[], signer: Keypair) {
  const tx = new Transaction().add(...withPriority(ixs, 200_000));
  tx.feePayer = signer.publicKey;
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(signer);
  const sig = await l1.sendRawTransaction(tx.serialize());
  await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = coder.accounts.decode("config", (await l1.getAccountInfo(configPda()))!.data as Buffer) as any;
  const mint = cfg.usdcMint;
  const room = roomPda(ROOM_ID);
  const adminAta = getAssociatedTokenAddressSync(mint, admin.publicKey);
  let usdc = 0n;
  let sol = 0;
  for (const [i, p] of players.entries()) {
    const ixs: TransactionInstruction[] = [];
    const pos = await l1.getAccountInfo(positionPda(room, p.publicKey));
    if (pos?.owner.equals(PROGRAM_ID)) ixs.push(await ixClosePosition(p.publicKey, room));
    const ata = getAssociatedTokenAddressSync(mint, p.publicKey);
    const bal = await l1.getTokenAccountBalance(ata).catch(() => null);
    if (bal) {
      const amt = BigInt(bal.value.amount);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(p.publicKey, adminAta, admin.publicKey, mint));
      if (amt > 0n) ixs.push(createTransferCheckedInstruction(ata, mint, adminAta, p.publicKey, amt, 6));
      ixs.push(createCloseAccountInstruction(ata, admin.publicKey, p.publicKey));
      usdc += amt;
    }
    if (ixs.length) console.log(`p${i} close+usdc: ${await send(ixs, p)}`);
    // Empty the wallet exactly: a system account left below rent-exemption is rejected.
    const lamports = await l1.getBalance(p.publicKey);
    if (lamports > 0) {
      const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
      const build = (amount: number) => {
        const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: p.publicKey, toPubkey: admin.publicKey, lamports: amount }));
        t.feePayer = p.publicKey;
        t.recentBlockhash = blockhash;
        return t;
      };
      const fee = (await l1.getFeeForMessage(build(lamports).compileMessage(), "confirmed")).value ?? 5_000;
      if (lamports > fee) {
        const tx = build(lamports - fee);
        tx.sign(p);
        try {
          const sig = await l1.sendRawTransaction(tx.serialize());
          await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
          sol += lamports - fee;
          console.log(`p${i} sol: ${sig}`);
        } catch (e) {
          console.log(`p${i} sol skipped: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    }
  }
  console.log(`swept ≈ ${Number(usdc) / 1e6} USDC and ≈ ${(sol / 1e9).toFixed(4)} SOL back to ${admin.publicKey.toBase58()}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
