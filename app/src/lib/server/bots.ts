// Devnet house bots. When a human takes a seat, three bots join so the room reaches the four-seat
// minimum; they then trade on the TEE until the round ends. Server-only.
//
// Everything here is stateless and idempotent: bot keys are derived from FAUCET_SECRET_KEY, and what a
// bot does next is read from chain state, so any server instance can handle any call. The players'
// browsers nudge `driveBots` while a room is open in a tab, and any visitor's browser nudges it for a
// round its players have left: the late cuts, the commit and the payout are permissionless.
import { createHmac } from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  coder,
  configPda,
  cuLimit,
  decodeFeed,
  decodePosition,
  decodeRoom,
  ixClosePosition,
  ixFinalizeRound,
  ixRateRoom,
  ixSetPosition,
  ixSettle,
  ixTick,
  ixsJoin,
  positionPda,
  roomPda,
  type PositionState,
  type RoomState,
} from "@/lib/royale/client";
import {
  BOT_COUNT,
  CLUSTER,
  FREEZE_SECS,
  L1_RPC,
  PROGRAM_ID,
  RoomStatus,
  StormKind,
  SURGE_LEVERAGE,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/royale/constants";
import { connectEr, readableError, sendEr, type ErLink } from "@/lib/royale/er";
import { sendAndConfirm } from "@/lib/royale/l1";
import { checkpointTs, cutOverdue, intervalOf, roundEndTs, stormFor } from "@/lib/royale/game";

type Style = "rider" | "fader" | "degen";
type Bot = { name: string; style: Style; kp: Keypair };
const ROSTER: { name: string; style: Style }[] = [
  { name: "Rider", style: "rider" },
  { name: "Fader", style: "fader" },
  { name: "Degen", style: "degen" },
];

const SOL_LOW = 0.015 * LAMPORTS_PER_SOL; // one join costs well under this, and most of it comes back
const SOL_TOP_UP = 0.02 * LAMPORTS_PER_SOL;
const FAUCET_RESERVE = 0.05 * LAMPORTS_PER_SOL;
const USDC_FLOAT = 100n * 10n ** BigInt(USDC_DECIMALS);
/** A bot makes at most one decision per bucket, so calling more often changes nothing. */
const BUCKET_SECS = 10;
/** A finished room takes a few seconds to come back from the rollup. */
const RETURN_POLLS = 15;
const RETURN_POLL_MS = 1_500;

const l1 = new Connection(L1_RPC, "confirmed");

function faucetKey(): Keypair | null {
  if (CLUSTER === "mainnet") return null; // bots never play for real money
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.FAUCET_SECRET_KEY ?? "")));
  } catch {
    return null;
  }
}

const hmac = (faucet: Keypair, label: string) => createHmac("sha256", faucet.secretKey).update(label).digest();

let cached: Bot[] | null = null;
export function houseBots(): Bot[] {
  const faucet = faucetKey();
  if (!faucet) return [];
  return (cached ??= ROSTER.slice(0, BOT_COUNT).map((r, i) => ({
    ...r,
    kp: Keypair.fromSeed(hmac(faucet, `pnl-royale:bot:v1:${i}`)),
  })));
}

async function sendL1(ixs: TransactionInstruction[], signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  return sendAndConfirm(l1, tx, lastValidBlockHeight);
}

// ---------------------------------------------------------------- Seats

/** Bots still to seat: three per room, only behind a human, never past the last seat. */
function missingBots(room: RoomState, bots: Bot[]): Bot[] {
  const seated = new Set(room.players.map((p) => p.toBase58()));
  const absent = bots.filter((b) => !seated.has(b.kp.publicKey.toBase58()));
  const humans = room.players.length - (bots.length - absent.length);
  if (humans === 0) return [];
  return absent.slice(0, room.maxSeats - room.seatsFilled);
}

async function seatBot(room: RoomState, bot: Bot, faucet: Keypair) {
  const me = bot.kp.publicKey;
  const ata = getAssociatedTokenAddressSync(USDC_MINT, me);
  const [lamports, usdc] = await Promise.all([
    l1.getBalance(me),
    l1.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => null),
  ]);
  const ixs: TransactionInstruction[] = [];
  if (lamports < SOL_LOW) ixs.push(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: me, lamports: SOL_TOP_UP - lamports }));
  if (usdc === null) ixs.push(createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, me, USDC_MINT));
  if ((usdc ?? 0n) < room.entryAmount)
    ixs.push(createMintToCheckedInstruction(USDC_MINT, ata, faucet.publicKey, room.entryAmount + USDC_FLOAT, USDC_DECIMALS));
  ixs.push(...(await ixsJoin(me, room.address, { mint: room.mint })));
  return sendL1(ixs, [faucet, bot.kp]);
}

// ---------------------------------------------------------------- Trading

const links = new Map<string, Promise<ErLink>>();
async function botLink(bot: Bot): Promise<ErLink> {
  const k = bot.kp.publicKey.toBase58();
  const have = links.get(k);
  if (have) {
    const l = await have.catch(() => null);
    if (l && l.expiresAt - Date.now() / 1000 > 60) return l;
  }
  // Browsers verify the TEE's attestation; the bots only need a token for their own positions.
  const p = connectEr(bot.kp, { attest: false });
  links.set(k, p);
  p.catch(() => links.delete(k));
  return p;
}

type Order = { side: -1 | 0 | 1; leverage: number; asset: number };

/** What `bot` does this bucket, or null to hold. `roll` is a deterministic byte stream. */
function decide(bot: Bot, room: RoomState, pos: PositionState, prices: (bigint | null)[], now: number, roll: Buffer): Order | null {
  const r = (i: number) => roll[i] / 256;
  const interval = intervalOf(room.startTs, room.intervalSecs, now);
  const storm = stormFor(room, interval);
  const held = pos.side !== 0 ? prices[pos.assetIdx] : null;
  const ret = held && pos.entryPrice > 0n ? (Number(held - pos.entryPrice) / Number(pos.entryPrice)) * pos.side * pos.leverage : 0;

  // An open position is kept unless the bot's style says otherwise.
  if (pos.side !== 0) {
    const move = bot.style === "rider" ? ret < -0.0015 && r(0) < 0.7 : bot.style === "fader" ? ret > 0.0015 || r(0) < 0.15 : r(0) < 0.4;
    if (!move) return null;
  }

  const spot = storm.kind === StormKind.Spotlight && r(1) < 0.6;
  const asset = spot ? storm.asset : roll[2] % room.numAssets;
  const price = prices[asset];
  if (!price) return null;
  // Trend since the last cut, from public data. Before the first cut it is a coin flip.
  const last = room.lastPrice[asset] ?? 0n;
  const coin = r(3) < 0.5 ? 1 : -1;
  const trend = last > 0n && price !== last ? (price > last ? 1 : -1) : coin;
  const side = (bot.style === "rider" ? trend : bot.style === "fader" ? -trend : coin) as -1 | 1;
  if (storm.kind === StormKind.Freeze && storm.side === side && now < checkpointTs(room, interval) + FREEZE_SECS) return null;

  const levs = bot.style === "rider" ? [2, 5] : bot.style === "fader" ? [1, 2, 5] : storm.kind === StormKind.Surge ? [10, SURGE_LEVERAGE] : [5, 10];
  return { side, leverage: levs[roll[4] % levs.length], asset };
}

async function tradeBot(room: RoomState, bot: Bot, faucet: Keypair): Promise<boolean> {
  const me = bot.kp.publicKey;
  const link = await botLink(bot);
  const posKey = positionPda(room.address, me);
  const infos = await link.connection.getMultipleAccountsInfo([posKey, ...room.feeds], "processed");
  const [p, ...feeds] = infos;
  if (!p || !p.owner.equals(PROGRAM_ID)) return false;
  const pos = decodePosition(posKey, p.data as Buffer);
  if (!pos.alive || pos.liquidated) return false;
  const now = Date.now() / 1000;
  const bucket = Math.floor(now / BUCKET_SECS);
  if (pos.lastActionTs >= bucket * BUCKET_SECS || now >= roundEndTs(room) - 2) return false;
  const prices = feeds.map((f) => (f ? (decodeFeed(f.data as Buffer)?.price ?? null) : null));
  const order = decide(bot, room, pos, prices, now, hmac(faucet, `${room.roomId}:${me.toBase58()}:${bucket}`));
  if (!order || (order.side === pos.side && order.leverage === pos.leverage && order.asset === pos.assetIdx)) return false;
  await sendEr(link.connection, [await ixSetPosition(me, room, me, null, order.side, order.leverage, order.asset)], [bot.kp]);
  return true;
}

// ---------------------------------------------------------------- Finishing the round

async function erRoom(link: ErLink, address: PublicKey): Promise<RoomState | null> {
  const acc = await link.connection.getAccountInfo(address, "processed");
  return acc?.owner.equals(PROGRAM_ID) ? decodeRoom(address, acc.data as Buffer) : null;
}

/** Send the cuts nobody else did, oldest first. The program gates each on its own clock, so a repeat does nothing. */
async function tickOverdue(room: RoomState, link: ErLink, payer: Keypair): Promise<number> {
  let sent = 0;
  for (let r: RoomState | null = room; r && cutOverdue(r, Date.now() / 1000); ) {
    // A limit per cut, so two ticks on one blockhash are never the same transaction.
    await sendEr(link.connection, [cuLimit(200_000 + r.nextCheckpoint), await ixTick(r)], [payer]);
    sent += 1;
    const next = await erRoom(link, r.address);
    if (next?.status === r.status && next.nextCheckpoint === r.nextCheckpoint) break; // waiting for a fresh price
    r = next;
  }
  return sent;
}

/** Commit an ended round and wait for it on Solana. Null if it is still on its way: the next call carries on. */
async function finalizeRoom(room: RoomState, link: ErLink, payer: Keypair, bots: Bot[]): Promise<RoomState | null> {
  await sendEr(link.connection, [cuLimit(400_000), await ixFinalizeRound(payer.publicKey, room)], [payer]);
  // The bots' positions come back too, so that their rent can be reclaimed.
  const keys = [room.address, ...bots.map((b) => positionPda(room.address, b.kp.publicKey))];
  let back: RoomState | null = null;
  for (let i = 0; i < RETURN_POLLS; i++) {
    await new Promise((r) => setTimeout(r, RETURN_POLL_MS));
    const infos = await l1.getMultipleAccountsInfo(keys, "confirmed").catch(() => []);
    if (infos[0]?.owner.equals(PROGRAM_ID)) back = decodeRoom(room.address, infos[0].data as Buffer);
    if (back && infos.every((a) => !a?.owner.equals(DELEGATION_PROGRAM_ID))) break;
  }
  return back;
}

// ---------------------------------------------------------------- After the round

async function settleRoom(room: RoomState, payer: Keypair) {
  const cfg = await l1.getAccountInfo(configPda());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feeVault = (coder.accounts.decode("config", cfg!.data as Buffer) as any).feeVault;
  const atas = room.finalistSeats.map((s) =>
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, getAssociatedTokenAddressSync(room.mint, room.players[s]), room.players[s], room.mint),
  );
  await sendL1([...atas, await ixSettle(payer.publicKey, room, feeVault)], [payer]);
}

/** Rent of the bots' finished positions goes back to the bots, so each round costs little SOL. */
async function reclaim(room: RoomState, bots: Bot[]) {
  const keys = bots.map((b) => positionPda(room.address, b.kp.publicKey));
  const infos = await l1.getMultipleAccountsInfo(keys);
  const open = bots.filter((_, i) => infos[i]?.owner.equals(PROGRAM_ID));
  if (open.length === 0) return 0;
  const ixs = await Promise.all(open.map((b) => ixClosePosition(b.kp.publicKey, room.address)));
  await sendL1(ixs, open.map((b) => b.kp));
  return open.length;
}

// ---------------------------------------------------------------- Entry point

export type BotReport = {
  status: number;
  joined: number;
  traded: number;
  ticked?: number;
  finalized?: boolean;
  settled?: boolean;
  rated?: boolean;
  reclaimed?: number;
  errors: string[];
};
/** A run past the route's time limit is stuck on a dead connection, and must not hold the room up. */
const RUN_LIMIT_MS = 60_000;
const running = new Map<string, { since: number; run: Promise<BotReport> }>();

/** Do whatever this room needs right now. Concurrent calls for a room share one run. */
export function driveBots(roomId: bigint): Promise<BotReport> {
  const k = roomId.toString();
  const now = running.get(k);
  if (now && Date.now() - now.since < RUN_LIMIT_MS) return now.run;
  const run = drive(roomId).finally(() => {
    if (running.get(k)?.run === run) running.delete(k);
  });
  running.set(k, { since: Date.now(), run });
  return run;
}

async function drive(roomId: bigint): Promise<BotReport> {
  const faucet = faucetKey();
  if (!faucet) throw new Error("bots are not configured (FAUCET_SECRET_KEY)");
  const bots = houseBots();
  const address = roomPda(roomId);
  const acc = await l1.getAccountInfo(address, "confirmed");
  const delegated = !!acc?.owner.equals(DELEGATION_PROGRAM_ID);
  if (!acc || !(delegated || acc.owner.equals(PROGRAM_ID))) throw new Error("room not found");
  let room = decodeRoom(address, acc.data as Buffer);
  const report: BotReport = { status: room.status, joined: 0, traded: 0, errors: [] };
  const attempt = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      report.errors.push(readableError(e));
      return undefined;
    }
  };
  const seated = bots.filter((b) => room.players.some((p) => p.equals(b.kp.publicKey)));

  if (delegated) {
    // Any key may tick and finalize, so a room without bots gets finished too.
    const helper = seated[0] ?? bots[0];
    const link = await botLink(helper);
    const live = await erRoom(link, address);
    if (!live) return report;
    room = live;
    if (cutOverdue(room, Date.now() / 1000)) {
      report.ticked = await attempt(() => tickOverdue(room, link, helper.kp));
      room = (await erRoom(link, address)) ?? room;
    }
    report.status = room.status;
    if (room.status === RoomStatus.Live) {
      const alive = seated.filter((b) => room.elimCheckpoint[room.players.findIndex((p) => p.equals(b.kp.publicKey))] === 0);
      const acted = await Promise.all(alive.map((b) => attempt(() => tradeBot(room, b, faucet))));
      report.traded = acted.filter(Boolean).length;
    }
    if (room.status !== RoomStatus.Ended) return report;
    const back = await attempt(() => finalizeRoom(room, link, helper.kp, seated));
    report.finalized = !!back;
    if (!back) return report;
    room = back;
  }

  if (room.status === RoomStatus.Open) {
    if (!room.mint.equals(USDC_MINT) || Date.now() / 1000 >= room.fillExpiry - 5) return report;
    const todo = missingBots(room, bots);
    if (todo.length === 0) return report;
    if ((await l1.getBalance(faucet.publicKey)) < FAUCET_RESERVE) throw new Error("the bots are out of devnet SOL");
    const joined = await Promise.all(todo.map((b) => attempt(() => seatBot(room, b, faucet))));
    report.joined = joined.filter(Boolean).length;
    return report;
  }

  // Nobody is certain to press the payout button: a bot may have won, or the winner may have left.
  const payer = seated[0]?.kp ?? faucet;
  if (room.status === RoomStatus.Ended) {
    await attempt(() => settleRoom(room, payer));
    const after = await l1.getAccountInfo(address, "confirmed");
    if (after?.owner.equals(PROGRAM_ID)) room = decodeRoom(address, after.data as Buffer);
    report.settled = room.status === RoomStatus.Settled;
    report.status = room.status;
  }
  if (room.status === RoomStatus.Settled) {
    if (!room.rated) report.rated = !!(await attempt(async () => sendL1([cuLimit(400_000), await ixRateRoom(room)], [payer])));
    report.reclaimed = await attempt(() => reclaim(room, seated));
  }
  return report;
}
