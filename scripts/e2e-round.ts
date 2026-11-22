// Full PnL Royale round on a live cluster (devnet or mainnet) with throwaway player wallets.
//
//   ADMIN_KEYPAIR=~/.config/solana/royale-admin.json NEXT_PUBLIC_CLUSTER=devnet \
//   PLAYERS=4 ENTRY_USDC=1 INTERVAL=20 npx tsx scripts/e2e-round.ts
//
// The admin wallet funds each player with SOL (rent + fees) and USDC (entry), so the round uses
// N distinct wallets. Prints every signature. Spends real funds on mainnet: read before running.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  configPda,
  coder,
  cuLimit,
  withPriority,
  decodePosition,
  decodeRoom,
  ixBeginRound,
  ixCreateRoom,
  ixCreateSessionV2,
  ixFinalizeRound,
  ixInitPermission,
  ixRateRoom,
  ixSetPosition,
  ixSettle,
  ixStartRoom,
  ixsJoin,
  newRoomId,
  positionPda,
  roomPda,
  sessionTokenPda,
  type RoomState,
} from "../app/src/lib/royale/client";
import { CLUSTER, ER_RPC, L1_RPC, PROGRAM_ID, USDC_MINT, explorerTx, RoomStatus } from "../app/src/lib/royale/constants";
import { connectEr, readableError, sendEr } from "../app/src/lib/royale/er";
import { checkpointTs, fmtChips } from "../app/src/lib/royale/game";

const ADMIN = process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/royale-admin.json`;
const PLAYERS = Number(process.env.PLAYERS ?? 4);
const ENTRY = BigInt(Math.round(Number(process.env.ENTRY_USDC ?? 1) * 1e6));
const INTERVAL = Number(process.env.INTERVAL ?? 30);
const ASSETS = (process.env.ASSETS ?? "6,9").split(",").map(Number);
const SOL_PER_PLAYER = Number(process.env.SOL_PER_PLAYER ?? 0.015);
const SESSION_TOPUP = Number(process.env.SESSION_TOPUP_LAMPORTS ?? 0);
const ROOM_ID = process.env.ROOM_ID ? BigInt(process.env.ROOM_ID) : newRoomId();

const l1 = new Connection(L1_RPC, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN, "utf8"))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function sendL1(ixs: TransactionInstruction[], signers: Keypair[], label: string) {
  const tx = new Transaction().add(...withPriority(ixs));
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await l1.sendRawTransaction(tx.serialize());
  await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  log(`L1 ${label}: ${explorerTx(sig)}`);
  return sig;
}

async function main() {
  log(`cluster ${CLUSTER} · L1 ${L1_RPC} · ER ${ER_RPC} · program ${PROGRAM_ID.toBase58()}`);
  const cfgInfo = await l1.getAccountInfo(configPda());
  if (!cfgInfo) throw new Error("config not initialized: run scripts/init-config.ts first");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = coder.accounts.decode("config", cfgInfo.data as Buffer) as any;
  const mint: PublicKey = cfg.usdcMint;
  if (!mint.equals(USDC_MINT)) log(`note: config mint ${mint.toBase58()} differs from NEXT_PUBLIC_USDC_MINT`);
  const adminAta = getAssociatedTokenAddressSync(mint, admin.publicKey);

  // --- players: fresh keypairs funded by admin (saved so funds are never stranded) ---
  mkdirSync("target/e2e", { recursive: true });
  const players = Array.from({ length: PLAYERS }, () => Keypair.generate());
  writeFileSync(`target/e2e/players-${ROOM_ID}.json`, JSON.stringify(players.map((p) => Array.from(p.secretKey))));
  log(`players saved to target/e2e/players-${ROOM_ID}.json`);
  for (let i = 0; i < players.length; i += 3) {
    const ixs: TransactionInstruction[] = [];
    for (const p of players.slice(i, i + 3)) {
      const ata = getAssociatedTokenAddressSync(mint, p.publicKey);
      ixs.push(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: Math.round(SOL_PER_PLAYER * LAMPORTS_PER_SOL) }));
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, p.publicKey, mint));
      ixs.push(createTransferCheckedInstruction(adminAta, mint, ata, admin.publicKey, ENTRY, 6));
    }
    await sendL1(ixs, [admin], `fund players ${i}..${i + ixs.length / 3 - 1}`);
  }

  // --- room ---
  const room = roomPda(ROOM_ID);
  await sendL1(
    [await ixCreateRoom(admin.publicKey, { roomId: ROOM_ID, entryAmount: ENTRY, maxSeats: PLAYERS, assets: ASSETS, fillSecs: 600, intervalSecs: INTERVAL, private: true }, mint)],
    [admin],
    `create_room ${ROOM_ID}`,
  );

  // --- join + delegate + session (one tx, one signature per player) ---
  const sessions: Keypair[] = [];
  for (const [i, p] of players.entries()) {
    const s = Keypair.generate();
    sessions.push(s);
    const ixs = await ixsJoin(p.publicKey, room, { viewer: s.publicKey, mint });
    ixs.push(ixCreateSessionV2(p.publicKey, s.publicKey, Math.floor(Date.now() / 1000) + 3600, SESSION_TOPUP));
    await sendL1(ixs, [p, s], `join+delegate+session p${i}`);
  }
  await sendL1([await ixStartRoom(admin.publicKey, room)], [admin], "start_room (delegate room to TEE)");

  // --- ER: wait for the room to appear, seal positions, begin ---
  const link = await connectEr(admin);
  log(`TEE attested=${link.attested}`);
  const readRoom = async (): Promise<RoomState> => {
    for (let k = 0; k < 60; k++) {
      const info = await link.connection.getAccountInfo(room);
      if (info && info.owner.equals(PROGRAM_ID)) return decodeRoom(room, info.data as Buffer);
      await sleep(1000);
    }
    throw new Error("room never appeared on the ER");
  };
  let state = await readRoom();
  for (let i = 0; i < players.length; i += 4) {
    const batch = await Promise.all(players.slice(i, i + 4).map((p) => ixInitPermission(admin.publicKey, room, positionPda(room, p.publicKey))));
    const sig = await sendEr(link.connection, batch, [admin]);
    log(`ER init_permission ${i}..: ${sig}`);
  }
  const beginSig = await sendEr(link.connection, [cuLimit(400_000), await ixBeginRound(admin.publicKey, state)], [admin]);
  log(`ER begin_round (crank + storm tasks scheduled): ${beginSig}`);
  state = await readRoom();

  // --- privacy proof: B's session token can't read A's position; A's can ---
  const linkA = await connectEr(sessions[0]);
  const linkB = await connectEr(sessions[1]);
  const posA = positionPda(room, players[0].publicKey);
  const asA = await linkA.connection.getAccountInfo(posA);
  const asB = await linkB.connection.getAccountInfo(posA);
  log(`PRIVACY: A reads own position -> ${asA ? "visible ✓" : "hidden ✗"} · B reads A's position -> ${asB ? "VISIBLE ✗" : "hidden ✓"}`);

  // --- trade with session keys until the round ends ---
  const sessionLinks = await Promise.all(sessions.map((s) => connectEr(s)));
  const sides: (-1 | 0 | 1)[] = [1, -1, 1, -1, 0, 1, -1, 1];
  let trades = 0;
  const end = checkpointTs(state, 6);
  let lastCp = 0;
  while (Date.now() / 1000 < end + 20) {
    state = await readRoom();
    if (state.nextCheckpoint !== lastCp) {
      lastCp = state.nextCheckpoint;
      log(`round: next checkpoint ${state.nextCheckpoint} · alive ${state.aliveCount} · storms ${state.stormKind.join(",")} · ticks ${state.ticks}`);
    }
    if (state.status !== RoomStatus.Live) break;
    for (const [i, p] of players.entries()) {
      if (state.elimCheckpoint[i] > 0 || Math.random() > 0.3) continue;
      const side = sides[(i + trades) % sides.length];
      const lev = [1, 2, 5, 10][(i + trades) % 4];
      const asset = (i + trades) % state.numAssets;
      try {
        const ix = await ixSetPosition(sessions[i].publicKey, state, p.publicKey, sessionTokenPda(sessions[i].publicKey, p.publicKey), side, lev, asset);
        const t0 = Date.now();
        const sig = await sendEr(sessionLinks[i].connection, [ix], [sessions[i]]);
        trades++;
        log(`ER p${i} set_position ${side} ${lev}x asset${asset} in ${Date.now() - t0} ms: ${sig.slice(0, 16)}…`);
      } catch (e) {
        log(`p${i} trade rejected: ${readableError(e)}`);
      }
    }
    await sleep(2500);
  }
  state = await readRoom();
  log(`round over: status ${state.status} finalists ${state.finalistSeats.join(",")} placements ${state.placement.join(",")}`);
  for (const [i] of players.entries()) log(`  p${i} placement #${state.placement[i]} equity ${fmtChips(state.finalEquity[i])}`);

  // --- commit + undelegate, then settle on L1 ---
  const finSig = await sendEr(link.connection, [cuLimit(400_000), await ixFinalizeRound(admin.publicKey, state)], [admin]);
  log(`ER finalize_round (commit + undelegate): ${finSig}`);
  for (let k = 0; k < 90; k++) {
    const info = await l1.getAccountInfo(room);
    if (info && info.owner.equals(PROGRAM_ID)) break;
    if (k % 10 === 0) log(`waiting for undelegation on L1 (owner ${info?.owner.equals(DELEGATION_PROGRAM_ID) ? "delegation program" : info?.owner.toBase58()})`);
    await sleep(2000);
  }
  const l1Room = decodeRoom(room, (await l1.getAccountInfo(room))!.data as Buffer);
  const pos0 = await l1.getAccountInfo(posA);
  if (pos0) log(`L1 position p0 now public: actions ${decodePosition(posA, pos0.data as Buffer).actions}`);
  await sendL1([await ixSettle(admin.publicKey, l1Room, cfg.feeVault)], [admin], "settle (USDC payouts + fee)");
  await sendL1([cuLimit(400_000), await ixRateRoom(l1Room)], [admin], "rate_room (Elo)");
  log(`DONE. ${trades} session-key trades. Room ${room.toBase58()}`);
}

main().catch((e) => {
  console.error("E2E FAILED:", readableError(e), e);
  process.exit(1);
});
