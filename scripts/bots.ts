// Devnet: fill an open room with bot traders and drive it to payout, so a human (or a judge) in
// the browser has opponents. Bots trade randomly with session keys on the TEE.
//
//   ADMIN_KEYPAIR=~/.config/solana/royale-devnet-deployer.json ROOM_ID=<id> [BOTS=3] npx tsx scripts/bots.ts
//
// ADMIN must be the test-USDC mint authority (devnet-mint.ts) and hold devnet SOL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  configPda,
  coder,
  cuLimit,
  decodeRoom,
  ixBeginRound,
  ixCreateSessionV2,
  ixFinalizeRound,
  ixInitPermission,
  ixRateRoom,
  ixSetPosition,
  ixSettle,
  ixStartRoom,
  ixsJoin,
  positionPda,
  roomPda,
  sessionTokenPda,
  withPriority,
  type RoomState,
} from "../app/src/lib/royale/client";
import { CLUSTER, L1_RPC, MIN_SEATS, PROGRAM_ID, RoomStatus } from "../app/src/lib/royale/constants";
import { connectEr, readableError, sendEr, type ErLink } from "../app/src/lib/royale/er";

if (CLUSTER === "mainnet") throw new Error("bots.ts is devnet-only");
const ROOM_ID = BigInt(process.env.ROOM_ID ?? "0");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR!, "utf8"))));
const l1 = new Connection(L1_RPC, "confirmed");
const room = roomPda(ROOM_ID);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function sendL1(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...withPriority(ixs));
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await l1.sendRawTransaction(tx.serialize());
  await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function l1Room(): Promise<{ room: RoomState; delegated: boolean }> {
  const info = await l1.getAccountInfo(room);
  if (!info) throw new Error(`room ${ROOM_ID} not found`);
  return { room: decodeRoom(room, info.data as Buffer), delegated: info.owner.equals(DELEGATION_PROGRAM_ID) };
}

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = coder.accounts.decode("config", (await l1.getAccountInfo(configPda()))!.data as Buffer) as any;
  const mint = cfg.usdcMint;
  let { room: r } = await l1Room();
  if (r.status !== RoomStatus.Open) throw new Error(`room is not open (status ${r.status})`);
  const free = r.maxSeats - r.seatsFilled;
  const n = Math.min(Number(process.env.BOTS ?? free), free);
  log(`room ${ROOM_ID}: ${r.seatsFilled}/${r.maxSeats} seats, adding ${n} bots`);

  const bots = Array.from({ length: n }, () => ({ kp: Keypair.generate(), session: Keypair.generate() }));
  mkdirSync("target/e2e", { recursive: true });
  writeFileSync(`target/e2e/players-${ROOM_ID}.json`, JSON.stringify(bots.map((b) => Array.from(b.kp.secretKey))));
  for (const [i, b] of bots.entries()) {
    const ata = getAssociatedTokenAddressSync(mint, b.kp.publicKey);
    await sendL1(
      [
        SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: b.kp.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }),
        createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, b.kp.publicKey, mint),
        createMintToCheckedInstruction(mint, ata, admin.publicKey, r.entryAmount, 6),
      ],
      [admin],
    );
    const ixs = await ixsJoin(b.kp.publicKey, room, { viewer: b.session.publicKey, mint });
    ixs.push(ixCreateSessionV2(b.kp.publicKey, b.session.publicKey, Math.floor(Date.now() / 1000) + 3600, 0));
    const sig = await sendL1(ixs, [b.kp, b.session]);
    log(`bot ${i} joined (${b.kp.publicKey.toBase58().slice(0, 6)}…): ${sig.slice(0, 16)}…`);
  }

  let er: ErLink | null = null;
  const links: ErLink[] = [];
  const sides: (-1 | 0 | 1)[] = [1, -1, 1, -1, 0];
  for (;;) {
    const s = await l1Room();
    r = s.room;
    if (!s.delegated) {
      if (r.status === RoomStatus.Open && r.seatsFilled >= MIN_SEATS && (r.seatsFilled === r.maxSeats || Date.now() / 1000 >= r.fillExpiry)) {
        await sendL1([await ixStartRoom(admin.publicKey, room)], [admin]).then((x) => log(`start_room ${x.slice(0, 16)}…`)).catch((e) => log("start:", readableError(e)));
      } else if (r.status === RoomStatus.Ended) {
        await sendL1([await ixSettle(admin.publicKey, r, cfg.feeVault)], [admin]).then((x) => log(`settle ${x.slice(0, 16)}…`)).catch((e) => log("settle:", readableError(e)));
      } else if (r.status === RoomStatus.Settled) {
        if (!r.rated) await sendL1([cuLimit(400_000), await ixRateRoom(r)], [admin]).then((x) => log(`rate_room ${x.slice(0, 16)}…`)).catch(() => undefined);
        log("room settled. Sweep bot wallets with: ROOM_ID=" + ROOM_ID + " npx tsx scripts/sweep-players.ts");
        return;
      } else if (r.status === RoomStatus.Open) {
        log(`waiting for players: ${r.seatsFilled}/${r.maxSeats}`);
      }
      await sleep(3000);
      continue;
    }
    // Delegated: live state is on the TEE.
    er ??= await connectEr(admin);
    if (links.length === 0) for (const b of bots) links.push(await connectEr(b.session));
    const info = await er.connection.getAccountInfo(room);
    if (!info || !info.owner.equals(PROGRAM_ID)) {
      await sleep(1000);
      continue;
    }
    r = decodeRoom(room, info.data as Buffer);
    if (r.status === RoomStatus.Starting) {
      if (r.private)
        for (let i = 0; i < r.players.length; i += 4) {
          const batch = await Promise.all(r.players.slice(i, i + 4).map((p) => ixInitPermission(admin.publicKey, room, positionPda(room, p))));
          await sendEr(er.connection, batch, [admin]).catch(() => undefined);
        }
      await sendEr(er.connection, [cuLimit(400_000), await ixBeginRound(admin.publicKey, r)], [admin])
        .then((x) => log(`begin_round ${x.slice(0, 16)}…`))
        .catch((e) => log("begin:", readableError(e)));
    } else if (r.status === RoomStatus.Live) {
      for (const [i, b] of bots.entries()) {
        const seat = r.players.findIndex((p) => p.equals(b.kp.publicKey));
        if (seat < 0 || r.elimCheckpoint[seat] > 0 || Math.random() > 0.35) continue;
        const side = sides[Math.floor(Math.random() * sides.length)];
        const lev = [1, 2, 5, 10][Math.floor(Math.random() * 4)];
        const asset = Math.floor(Math.random() * r.numAssets);
        try {
          const ix = await ixSetPosition(b.session.publicKey, r, b.kp.publicKey, sessionTokenPda(b.session.publicKey, b.kp.publicKey), side, lev, asset);
          await sendEr(links[i].connection, [ix], [b.session]);
          log(`bot ${i} ${side === 0 ? "flat" : `${side > 0 ? "long" : "short"} ${lev}x`} asset${asset}`);
        } catch {
          /* hold time / no change / frozen side: try again next tick */
        }
      }
      log(`live: next cut #${r.nextCheckpoint}, ${r.aliveCount} alive`);
    } else if (r.status === RoomStatus.Ended) {
      await sendEr(er.connection, [cuLimit(400_000), await ixFinalizeRound(admin.publicKey, r)], [admin])
        .then((x) => log(`finalize_round ${x.slice(0, 16)}…`))
        .catch(() => undefined);
      await sleep(3000);
    }
    await sleep(3000);
  }
})().catch((e) => {
  console.error("BOTS FAILED:", readableError(e), e);
  process.exit(1);
});
