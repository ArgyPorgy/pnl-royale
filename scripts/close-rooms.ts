// List rooms whose rent close_room can pay to the fixed recipient, and optionally send the closes.
//
//   npx tsx scripts/close-rooms.ts --cluster mainnet
//   npx tsx scripts/close-rooms.ts --cluster devnet --keypair ~/.config/solana/royale-mainnet-admin.json --send
//
// Dry-run unless --send. The keypair is a path you pass in; this script never reads a key from the repo.
import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import {
  configPda,
  decodeRoom,
  isOurRoom,
  ixCloseRoom,
  positionPda,
  roomDiscriminator,
  vaultPda,
  withPriority,
  coder,
} from "../app/src/lib/royale/client";
import { PROGRAM_ID, RENT_RECIPIENT, RoomStatus } from "../app/src/lib/royale/constants";

const LAMPORTS_PER_SOL = 1_000_000_000;
const RPC: Record<string, string> = {
  mainnet: process.env.MAINNET_RPC_URL || process.env.NEXT_PUBLIC_L1_RPC || "https://api.mainnet-beta.solana.com",
  devnet: process.env.DEVNET_RPC_URL || "https://rpc.magicblock.app/devnet",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

type Row = {
  room: ReturnType<typeof decodeRoom>;
  roomLamports: number;
  vaultLamports: number;
  reason: string | null;
};

(async () => {
  const cluster = arg("cluster") ?? "devnet";
  const rpc = arg("rpc") ?? RPC[cluster];
  if (!rpc) throw new Error(`unknown cluster ${cluster} (use mainnet or devnet, or pass --rpc)`);
  const send = process.argv.includes("--send");
  const keyPath = arg("keypair");
  if (send && !keyPath) throw new Error("--send needs --keypair <path>");
  const signer = keyPath ? loadKeypair(keyPath) : null;

  const l1 = new Connection(rpc, "confirmed");
  const disc = bs58.encode(roomDiscriminator());
  const own = await l1.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc } }] });
  const cfgInfo = await l1.getAccountInfo(configPda());
  const admin = cfgInfo ? ((coder.accounts.decode("config", cfgInfo.data as Buffer) as { admin: PublicKey }).admin) : null;

  const rows: Row[] = [];
  for (const a of own) {
    const room = isOurRoom(a.pubkey, a.account.data as Buffer);
    if (!room) continue;
    if (room.status !== RoomStatus.Settled && room.status !== RoomStatus.Cancelled) continue;
    if (!a.account.owner.equals(PROGRAM_ID)) continue;

    const vaultKey = vaultPda(room.address);
    const vault = await l1.getAccountInfo(vaultKey);
    let vaultLamports = 0;
    let reason: string | null = null;
    if (vault && vault.owner.equals(TOKEN_PROGRAM_ID) && vault.data.length >= 72) {
      const amount = vault.data.readBigUInt64LE(64);
      if (amount > 0n) reason = `vault holds ${amount.toString()} token units`;
      else vaultLamports = vault.lamports;
    }
    const positions = await l1.getMultipleAccountsInfo(room.players.map((p) => positionPda(room.address, p)));
    const open = positions.filter((p) => p && (p.owner.equals(PROGRAM_ID) || p.owner.equals(DELEGATION_PROGRAM_ID)));
    if (open.length > 0) reason = reason ?? `${open.length} position account${open.length === 1 ? "" : "s"} still open`;

    rows.push({ room, roomLamports: a.account.lamports, vaultLamports, reason });
  }

  const ready = rows.filter((r) => r.reason === null);
  const blocked = rows.filter((r) => r.reason !== null);
  const total = ready.reduce((s, r) => s + r.roomLamports + r.vaultLamports, 0);
  console.log(`${cluster}  rpc ${rpc}`);
  console.log(`recipient ${RENT_RECIPIENT.toBase58()}`);
  console.log(`closable ${ready.length}    reclaimable ${sol(total)} SOL (${total} lamports)`);
  for (const r of ready) {
    const who = signer && (signer.publicKey.equals(r.room.creator) || (admin && signer.publicKey.equals(admin))) ? "signer ok" : "needs creator or admin";
    console.log(
      `  ${r.room.roomId.toString()}  ${RoomStatus[r.room.status]}  ${r.room.address.toBase58()}  room ${r.roomLamports}  vault ${r.vaultLamports}  ${who}`,
    );
  }
  if (blocked.length > 0) {
    console.log(`not yet closable ${blocked.length}`);
    for (const r of blocked) console.log(`  ${r.room.roomId.toString()}  ${r.room.address.toBase58()}  ${r.reason}`);
  }
  if (!send) return;
  if (!signer) return;

  let sent = 0;
  for (const r of ready) {
    if (!signer.publicKey.equals(r.room.creator) && !(admin && signer.publicKey.equals(admin))) {
      console.log(`skip ${r.room.roomId.toString()}: signer is not the creator or admin`);
      continue;
    }
    const ix = await ixCloseRoom(signer.publicKey, r.room);
    const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...withPriority([ix], 200_000));
    const sig = await l1.sendTransaction(tx, [signer], { skipPreflight: false });
    await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log(`closed ${r.room.roomId.toString()}  ${sig}`);
    sent += 1;
  }
  console.log(`sent ${sent}`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
