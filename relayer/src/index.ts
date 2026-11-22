// PnL Royale relayer: crank backup + round orchestrator + settle caller + room index.
// Holds no custody and no user keys. Every instruction it sends is permissionless and
// time-gated/idempotent on-chain, so it can never change an outcome, only keep rounds moving.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import {
  configPda,
  coder,
  cuLimit,
  withPriority,
  decodeRoom,
  isOurRoom,
  ixAbortRound,
  ixBeginRound,
  ixFinalizeRound,
  ixInitPermission,
  ixRateRoom,
  ixRefund,
  ixReleasePosition,
  ixRequestStorm,
  ixSettle,
  ixStartRoom,
  ixTick,
  positionPda,
  roomDiscriminator,
  roomPda,
  type RoomState,
} from "../../app/src/lib/royale/client";
import { BEGIN_TIMEOUT_SECS, ER_RPC, L1_RPC, MIN_SEATS, PROGRAM_ID, RoomStatus } from "../../app/src/lib/royale/constants";
import { connectEr, sendEr, readableError, type ErLink } from "../../app/src/lib/royale/er";
import { checkpointTs, intervalOf, roundEndTs } from "../../app/src/lib/royale/game";

const KEYPAIR = process.env.RELAYER_KEYPAIR ?? `${process.env.HOME}/.config/solana/royale-relayer.json`;
const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = Number(process.env.POLL_MS ?? 1500);
const WATCH = (process.env.WATCH_ROOMS ?? "").split(",").filter(Boolean).map((x) => BigInt(x));
/** L1 actions cost SOL (start_room deposit, ATA rent, fees). Disable with L1_ACTIONS=0. */
const L1_ACTIONS = process.env.L1_ACTIONS !== "0";

const relayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
const l1 = new Connection(L1_RPC, "confirmed");
let er: ErLink | null = null;
const rooms = new Map<string, RoomState & { delegated: boolean }>();
const lastAction = new Map<string, number>();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function sendL1(ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(...withPriority(ixs));
  tx.feePayer = relayer.publicKey;
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(relayer);
  const sig = await l1.sendRawTransaction(tx.serialize());
  await l1.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function ensureEr() {
  if (!er || (Number.isFinite(er.expiresAt) && er.expiresAt - Date.now() / 1000 < 120)) {
    er = await connectEr(relayer);
    log(`ER connected ${ER_RPC} attested=${er.attested}`);
  }
  return er;
}

/** Rate-limit per (room, action) so concurrent clients and the relayer don't spam. */
function once(room: RoomState, action: string, everyMs = 4000) {
  const k = `${room.address.toBase58()}:${action}`;
  const t = Date.now();
  if (t - (lastAction.get(k) ?? 0) < everyMs) return false;
  lastAction.set(k, t);
  return true;
}

async function act(room: RoomState, action: string, fn: () => Promise<string>) {
  try {
    const sig = await fn();
    log(`room ${room.roomId} ${action}: ${sig}`);
  } catch (e) {
    log(`room ${room.roomId} ${action} failed: ${readableError(e)}`);
  }
}

async function discover() {
  const disc = bs58.encode(roomDiscriminator());
  const found = new Map<string, RoomState & { delegated: boolean }>();
  try {
    for (const a of await l1.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }))
      found.set(a.pubkey.toBase58(), { ...decodeRoom(a.pubkey, a.account.data as Buffer), delegated: false });
  } catch (e) {
    if (rooms.size === 0) log("getProgramAccounts(royale) unavailable on this RPC:", (e as Error).message);
  }
  try {
    for (const a of await l1.getProgramAccounts(DELEGATION_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc } }] })) {
      // other Anchor programs' delegated `Room` accounts share our discriminator: require our PDA
      const r = isOurRoom(a.pubkey, a.account.data as Buffer);
      if (r) found.set(a.pubkey.toBase58(), { ...r, delegated: true });
    }
  } catch {
    /* large program; fall back to WATCH_ROOMS + previously seen rooms */
  }
  const extra = [...WATCH.map((id) => roomPda(id)), ...[...rooms.values()].map((r) => r.address)].filter(
    (k) => !found.has(k.toBase58()),
  );
  if (extra.length) {
    const infos = await l1.getMultipleAccountsInfo(extra);
    infos.forEach((info, i) => {
      if (!info) return;
      const delegated = info.owner.equals(DELEGATION_PROGRAM_ID);
      if (delegated || info.owner.equals(PROGRAM_ID)) found.set(extra[i].toBase58(), { ...decodeRoom(extra[i], info.data as Buffer), delegated });
    });
  }
  // Live state of delegated rooms comes from the ER (room accounts are public).
  const delegated = [...found.values()].filter((r) => r.delegated);
  if (delegated.length) {
    const link = await ensureEr();
    const infos = await link.connection.getMultipleAccountsInfo(delegated.map((r) => r.address));
    infos.forEach((info, i) => {
      if (info && info.owner.equals(PROGRAM_ID)) found.set(delegated[i].address.toBase58(), { ...decodeRoom(delegated[i].address, info.data as Buffer), delegated: true });
    });
  }
  rooms.clear();
  for (const [k, v] of found) rooms.set(k, v);
}

async function feeVault(): Promise<PublicKey> {
  const cfg = await l1.getAccountInfo(configPda());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (coder.accounts.decode("config", cfg!.data as Buffer) as any).feeVault as PublicKey;
}

async function drive(room: RoomState & { delegated: boolean }) {
  const now = Date.now() / 1000;
  const me = relayer.publicKey;

  // ---------------- L1 ----------------
  if (!room.delegated) {
    if (room.status === RoomStatus.Open) {
      const startable = room.seatsFilled >= MIN_SEATS && (room.seatsFilled === room.maxSeats || now >= room.fillExpiry);
      const cancellable = now >= room.fillExpiry && room.seatsFilled < MIN_SEATS;
      if (startable && L1_ACTIONS && once(room, "start", 15_000)) await act(room, "start_room", async () => sendL1([await ixStartRoom(me, room.address)]));
      if (cancellable && room.seatsFilled > 0 && once(room, "refund", 15_000))
        await act(room, "refund", async () => sendL1([await ixRefund(room, room.players.map((p) => getAssociatedTokenAddressSync(room.mint, p)))]));
      return;
    }
    if (room.status === RoomStatus.Cancelled) {
      const unpaid = room.players.filter((_, i) => !((room.refunded >> i) & 1));
      if (unpaid.length && once(room, "refund", 15_000))
        await act(room, "refund", async () => sendL1([await ixRefund(room, unpaid.map((p) => getAssociatedTokenAddressSync(room.mint, p)))]));
      // positions of a room that never started may still be delegated
      if (once(room, "release", 60_000)) {
        const link = await ensureEr();
        for (const p of room.players) {
          const pos = positionPda(room.address, p);
          const info = await l1.getAccountInfo(pos);
          if (info?.owner.equals(DELEGATION_PROGRAM_ID))
            await act(room, "release_position", async () => sendEr(link.connection, [await ixReleasePosition(me, room.address, pos)], [relayer]));
        }
      }
      return;
    }
    if (room.status === RoomStatus.Ended && L1_ACTIONS && once(room, "settle", 20_000)) {
      const atas = room.finalistSeats.map((s) =>
        createAssociatedTokenAccountIdempotentInstruction(me, getAssociatedTokenAddressSync(room.mint, room.players[s]), room.players[s], room.mint),
      );
      await act(room, "settle", async () => sendL1([...atas, await ixSettle(me, room, await feeVault())]));
      return;
    }
    if ((room.status === RoomStatus.Settled || room.status === RoomStatus.Ended) && !room.rated && L1_ACTIONS && once(room, "rate", 30_000))
      await act(room, "rate_room", async () => sendL1([cuLimit(400_000), await ixRateRoom(room)]));
    return;
  }

  // ---------------- ER (gasless) ----------------
  const link = await ensureEr();
  const send = (ixs: TransactionInstruction[]) => sendEr(link.connection, ixs, [relayer]);
  if (room.status === RoomStatus.Starting) {
    if (now >= room.startedTs + BEGIN_TIMEOUT_SECS && once(room, "abort", 15_000)) {
      await act(room, "abort_round", async () => send([cuLimit(400_000), await ixAbortRound(me, room, room.players.map((p) => positionPda(room.address, p)))]));
      return;
    }
    if (once(room, "begin", 5_000)) {
      if (room.private) {
        for (let i = 0; i < room.players.length; i += 4) {
          const batch = await Promise.all(room.players.slice(i, i + 4).map((p) => ixInitPermission(me, room.address, positionPda(room.address, p))));
          await act(room, `init_permission ${i}-${i + batch.length - 1}`, () => send(batch));
        }
      }
      await act(room, "begin_round", async () => send([cuLimit(400_000), await ixBeginRound(me, room)]));
    }
    return;
  }
  if (room.status === RoomStatus.Live) {
    const due = checkpointTs(room, room.nextCheckpoint);
    if (now > due + 2 && once(room, `tick${room.nextCheckpoint}`, 2_500))
      await act(room, `tick (backup) #${room.nextCheckpoint}`, async () => send([await ixTick(room)]));
    const interval = intervalOf(room.startTs, room.intervalSecs, now);
    if (!((room.stormsRequested >> interval) & 1) && now > checkpointTs(room, interval) + 3 && now < roundEndTs(room) && once(room, `storm${interval}`, 4_000))
      await act(room, `request_storm #${interval}`, async () => send([await ixRequestStorm(room.address)]));
    return;
  }
  if (room.status === RoomStatus.Ended && once(room, "finalize", 6_000))
    await act(room, "finalize_round", async () => send([cuLimit(400_000), await ixFinalizeRound(me, room)]));
}

async function loop() {
  for (;;) {
    try {
      await discover();
      await Promise.all([...rooms.values()].map((r) => drive(r).catch((e) => log("drive", r.roomId, readableError(e)))));
    } catch (e) {
      log("loop error", readableError(e));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Public room index for the lobby (RPCs often block getProgramAccounts in browsers).
createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (req.url?.startsWith("/rooms")) {
    const out = [...rooms.values()].map((r) => ({
      address: r.address.toBase58(),
      roomId: r.roomId.toString(),
      status: r.status,
      delegated: r.delegated,
      seatsFilled: r.seatsFilled,
      maxSeats: r.maxSeats,
      aliveCount: r.aliveCount,
      entryAmount: r.entryAmount.toString(),
      assets: r.assets,
      intervalSecs: r.intervalSecs,
      private: r.private,
      createdTs: r.createdTs,
    }));
    res.end(JSON.stringify(out));
    return;
  }
  res.end(JSON.stringify({ ok: true, relayer: relayer.publicKey.toBase58(), rooms: rooms.size, l1: L1_RPC, er: ER_RPC }));
}).listen(PORT, () => log(`relayer ${relayer.publicKey.toBase58()} on :${PORT} (L1 ${L1_RPC}, ER ${ER_RPC}, L1 actions ${L1_ACTIONS ? "on" : "off"})`));

loop();
