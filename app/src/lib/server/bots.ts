// House bots. When a human takes a seat, three bots join so the room reaches the four-seat minimum;
// they then trade on the TEE until the round ends. Server-only.
//
// A pool wallet funds them: each bot gets its entry (and a little SOL) in the same transaction that
// seats it, and after the payout its USDC goes back to the pool. Mainnet needs BOT_POOL_SECRET_KEY;
// devnet uses the faucet key unless a pool is set. Limits in `LIMITS` keep a pool from being drained.
//
// Everything here is stateless and idempotent: bot keys are derived from the pool key, and what a bot
// does next is read from chain state, so any server instance can handle any call. The players'
// browsers nudge `driveBots` while a room is open in a tab, and any visitor's browser nudges it for a
// round its players have left: the late cuts, the commit and the payout are permissionless.
import { createHmac } from "node:crypto";
import bs58 from "bs58";
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
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
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
  isOurRoom,
  positionPda,
  roomDiscriminator,
  roomPda,
  withPriority,
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
import { checkpointTs, cutOverdue, intervalOf, prizeSplit, roundEndTs, stormFor } from "@/lib/royale/game";

type Style = "rider" | "fader" | "degen";
type Bot = { name: string; style: Style; kp: Keypair };
const ROSTER: { name: string; style: Style }[] = [
  { name: "Rider", style: "rider" },
  { name: "Fader", style: "fader" },
  { name: "Degen", style: "degen" },
];

const MAINNET = CLUSTER === "mainnet";
const env = (k: string) => (process.env[k] ?? "").trim();
const USDC_UNIT = 10 ** USDC_DECIMALS;
const units = (usdc: number) => BigInt(Math.round(usdc * USDC_UNIT));

/** A seat locks about 0.006 SOL until the round ends, and all but about 0.003 comes back. */
const SOL_LOW = 0.01 * LAMPORTS_PER_SOL;
const SOL_TARGET = 0.015 * LAMPORTS_PER_SOL;
/** Spare SOL above the target goes back to the pool, but not dust a transfer would cost more than. */
const SOL_SWEEP_MIN = 0.005 * LAMPORTS_PER_SOL;
/** Kept in the pool for fees. The devnet faucet keeps more, since it also funds players. */
const POOL_RESERVE = (env("BOT_POOL_SECRET_KEY") ? 0.02 : 0.05) * LAMPORTS_PER_SOL;

/** A USDC limit from the environment; "off" or unset on devnet means none. Mainnet has defaults. */
function limit(name: string, mainnetDefault: number): number | null {
  const v = env(name);
  if (v === "off") return null;
  const n = v ? Number(v) : MAINNET ? mainnetDefault : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export const LIMITS = {
  /** Bots sit only in rooms with an entry up to this, in USDC. */
  maxEntry: limit("BOT_MAX_ENTRY_USDC", 1),
  /** Bots stop joining for the day (UTC) once the pool is down this much today, in USDC. */
  dailyLoss: limit("BOT_DAILY_LOSS_USDC", 10),
  /** Bots join at most this many rooms a day with any one player. */
  perPlayer: limit("BOT_ROOMS_PER_PLAYER_DAY", 10),
};
/** A bot makes at most one decision per bucket, so calling more often changes nothing. */
const BUCKET_SECS = 10;
/** A finished room takes a few seconds to come back from the rollup. */
const RETURN_POLLS = 15;
const RETURN_POLL_MS = 1_500;

const l1 = new Connection(L1_RPC, "confirmed");

let poolCache: Keypair | null | undefined;
/** The wallet that funds the bots and takes their winnings back. Null when bots are off. */
function poolKey(): Keypair | null {
  if (poolCache !== undefined) return poolCache;
  // Mainnet never falls back to the faucet key: real money needs a pool set on purpose.
  const raw = env("BOT_POOL_SECRET_KEY") || (MAINNET ? "" : env("FAUCET_SECRET_KEY"));
  try {
    poolCache = raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
  } catch {
    poolCache = null;
  }
  return poolCache;
}

const hmac = (pool: Keypair, label: string) => createHmac("sha256", pool.secretKey).update(label).digest();

let cached: Bot[] | null = null;
export function houseBots(): Bot[] {
  const pool = poolKey();
  if (!pool) return [];
  return (cached ??= ROSTER.slice(0, BOT_COUNT).map((r, i) => ({
    ...r,
    kp: Keypair.fromSeed(hmac(pool, `pnl-royale:bot:v1:${i}`)),
  })));
}

async function sendL1(ixs: TransactionInstruction[], signers: Keypair[], cu = 300_000) {
  const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...withPriority(ixs, cu));
  tx.sign(...signers);
  return sendAndConfirm(l1, tx, lastValidBlockHeight);
}

// ---------------------------------------------------------------- Pool

const usdcOf = (owner: PublicKey) =>
  l1.getTokenAccountBalance(getAssociatedTokenAddressSync(USDC_MINT, owner)).then((b) => BigInt(b.value.amount)).catch(() => null);

let minter: Promise<boolean> | null = null;
/** Devnet: when the pool is the test-USDC mint authority it can mint what it lacks. */
function poolMints(pool: Keypair): Promise<boolean> {
  if (MAINNET) return Promise.resolve(false);
  return (minter ??= getMint(l1, USDC_MINT)
    .then((m) => !!m.mintAuthority?.equals(pool.publicKey))
    .catch(() => {
      minter = null;
      return false;
    }));
}

/** What the pool must hold before bots take seats: SOL for fees and seats, USDC for the largest room. */
function poolNeeds(mints: boolean) {
  const sol = POOL_RESERVE + BOT_COUNT * SOL_TARGET;
  const usdc = mints || LIMITS.maxEntry === null ? 0n : BigInt(BOT_COUNT) * units(LIMITS.maxEntry);
  return { sol, usdc };
}

/** Winnings and spare SOL go back to the pool, so it can fund the next room. */
async function sweep(bots: Bot[], pool: Keypair): Promise<{ usdc: bigint; sol: number }> {
  const poolAta = getAssociatedTokenAddressSync(USDC_MINT, pool.publicKey);
  const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(pool.publicKey, poolAta, pool.publicKey, USDC_MINT)];
  const signers = [pool];
  const moved = { usdc: 0n, sol: 0 };
  const held = await Promise.all(bots.map((b) => Promise.all([l1.getBalance(b.kp.publicKey), usdcOf(b.kp.publicKey)])));
  bots.forEach((b, i) => {
    const [lamports, usdc] = held[i];
    const spare = lamports - SOL_TARGET;
    let signs = false;
    if (usdc && usdc > 0n) {
      ixs.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(USDC_MINT, b.kp.publicKey), USDC_MINT, poolAta, b.kp.publicKey, usdc, USDC_DECIMALS));
      moved.usdc += usdc;
      signs = true;
    }
    if (spare >= SOL_SWEEP_MIN) {
      ixs.push(SystemProgram.transfer({ fromPubkey: b.kp.publicKey, toPubkey: pool.publicKey, lamports: spare }));
      moved.sol += spare;
      signs = true;
    }
    if (signs) signers.push(b.kp);
  });
  if (signers.length > 1) await sendL1(ixs, signers);
  return moved;
}

// ---------------------------------------------------------------- Today's ledger

const startOfDay = () => Math.floor(Date.now() / 86_400_000) * 86_400;
let ledgerCache: { at: number; rooms: Promise<RoomState[]> } | null = null;

/** Every room created today (UTC), live or not. Read from chain and cached briefly. */
function todaysRooms(): Promise<RoomState[]> {
  if (ledgerCache && Date.now() - ledgerCache.at < 15_000) return ledgerCache.rooms;
  const disc = bs58.encode(roomDiscriminator());
  const since = startOfDay();
  const rooms = Promise.all(
    [PROGRAM_ID, DELEGATION_PROGRAM_ID].map((owner) => l1.getProgramAccounts(owner, { filters: [{ memcmp: { offset: 0, bytes: disc } }] })),
  ).then((lists) => lists.flat().flatMap((a) => isOurRoom(a.pubkey, a.account.data as Buffer) ?? []).filter((r) => r.createdTs >= since));
  rooms.catch(() => (ledgerCache = null));
  ledgerCache = { at: Date.now(), rooms };
  return rooms;
}

/**
 * The pool's result today, in USDC base units: bot payouts minus bot entries. A room still in play
 * counts its entries as lost until it pays out, so the brake errs on the safe side.
 */
function poolResult(rooms: RoomState[], bots: Bot[]) {
  const mine = new Set(bots.map((b) => b.kp.publicKey.toBase58()));
  let pnl = 0n;
  let played = 0;
  for (const r of rooms) {
    const seats = r.players.flatMap((p, i) => (mine.has(p.toBase58()) ? [i] : []));
    if (seats.length === 0 || r.status === RoomStatus.Cancelled) continue;
    played += 1;
    pnl -= r.entryAmount * BigInt(seats.length);
    if (r.status !== RoomStatus.Settled) continue;
    const pot = r.entryAmount * BigInt(r.seatsFilled);
    const prize = pot - (pot * BigInt(r.feeBps)) / 10_000n;
    const split = prizeSplit(r.finalistCount);
    r.finalistSeats.slice(0, r.finalistCount).forEach((seat, place) => {
      if (seats.includes(seat)) pnl += (prize * BigInt(split[place] ?? 0)) / 100n;
    });
  }
  return { pnl, played };
}

/** Why bots should not sit in `room` right now, as a sentence for the player, or null. */
async function holdBack(room: RoomState, bots: Bot[], pool: Keypair, todo: Bot[]): Promise<string | null> {
  if (LIMITS.maxEntry !== null && room.entryAmount > units(LIMITS.maxEntry))
    return `House bots only join rooms with an entry up to $${LIMITS.maxEntry}.`;
  const mints = await poolMints(pool);
  const [sol, usdc] = await Promise.all([l1.getBalance(pool.publicKey), usdcOf(pool.publicKey)]);
  const need = poolNeeds(mints);
  if (sol < need.sol || (!mints && (usdc ?? 0n) < room.entryAmount * BigInt(todo.length))) return "House bots are out of funds right now.";
  if (LIMITS.dailyLoss === null && LIMITS.perPlayer === null) return null;
  const today = await todaysRooms();
  if (LIMITS.dailyLoss !== null && poolResult(today, bots).pnl <= -units(LIMITS.dailyLoss)) return "House bots are done for today.";
  if (LIMITS.perPlayer !== null) {
    const mine = new Set(bots.map((b) => b.kp.publicKey.toBase58()));
    const humans = room.players.filter((p) => !mine.has(p.toBase58())).map((p) => p.toBase58());
    const withBots = today.filter((r) => !r.address.equals(room.address) && r.players.some((p) => mine.has(p.toBase58())));
    const most = Math.max(0, ...humans.map((h) => withBots.filter((r) => r.players.some((p) => p.toBase58() === h)).length));
    if (most >= LIMITS.perPlayer)
      return `House bots have played ${LIMITS.perPlayer} room${LIMITS.perPlayer === 1 ? "" : "s"} with you today. Invite friends to fill this one.`;
  }
  return null;
}

export type PoolStatus = {
  address: string;
  sol: number;
  usdc: string;
  mints: boolean;
  needs: { sol: number; usdc: string };
  topUp: { sol: number; usdc: string };
  today: { rooms: number; pnl: string };
  limits: typeof LIMITS;
  paused: string | null;
  bots: { name: string; address: string; sol: number; usdc: string }[];
};

/** Balances, today's result and what to top up, for the status page. Amounts in lamports and USDC base units. */
export async function poolStatus(): Promise<PoolStatus | null> {
  const pool = poolKey();
  if (!pool) return null;
  const bots = houseBots();
  const [sol, usdc, mints, today, held] = await Promise.all([
    l1.getBalance(pool.publicKey),
    usdcOf(pool.publicKey),
    poolMints(pool),
    todaysRooms(),
    Promise.all(bots.map((b) => Promise.all([l1.getBalance(b.kp.publicKey), usdcOf(b.kp.publicKey)]))),
  ]);
  const needs = poolNeeds(mints);
  const result = poolResult(today, bots);
  const topUp = { sol: Math.max(0, needs.sol - sol), usdc: needs.usdc > (usdc ?? 0n) ? needs.usdc - (usdc ?? 0n) : 0n };
  const paused =
    topUp.sol > 0 || topUp.usdc > 0n
      ? "Out of funds: top up the pool."
      : LIMITS.dailyLoss !== null && result.pnl <= -units(LIMITS.dailyLoss)
        ? "Done for today: the daily loss limit is reached."
        : null;
  return {
    address: pool.publicKey.toBase58(),
    sol,
    usdc: String(usdc ?? 0n),
    mints,
    needs: { sol: needs.sol, usdc: String(needs.usdc) },
    topUp: { sol: topUp.sol, usdc: String(topUp.usdc) },
    today: { rooms: result.played, pnl: String(result.pnl) },
    limits: LIMITS,
    paused,
    bots: bots.map((b, i) => ({ name: b.name, address: b.kp.publicKey.toBase58(), sol: held[i][0], usdc: String(held[i][1] ?? 0n) })),
  };
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

/** Fund `bot` from the pool and seat it, in one transaction: the entry never sits idle in a bot. */
async function seatBot(room: RoomState, bot: Bot, pool: Keypair, mints: boolean) {
  const me = bot.kp.publicKey;
  const ata = getAssociatedTokenAddressSync(USDC_MINT, me);
  const poolAta = getAssociatedTokenAddressSync(USDC_MINT, pool.publicKey);
  const [lamports, usdc, poolUsdc] = await Promise.all([l1.getBalance(me), usdcOf(me), usdcOf(pool.publicKey)]);
  const ixs: TransactionInstruction[] = [];
  if (lamports < SOL_LOW) ixs.push(SystemProgram.transfer({ fromPubkey: pool.publicKey, toPubkey: me, lamports: SOL_TARGET - lamports }));
  if (usdc === null) ixs.push(createAssociatedTokenAccountIdempotentInstruction(pool.publicKey, ata, me, USDC_MINT));
  const short = room.entryAmount - (usdc ?? 0n);
  if (short > 0n) {
    if ((poolUsdc ?? 0n) >= short) ixs.push(createTransferCheckedInstruction(poolAta, USDC_MINT, ata, pool.publicKey, short, USDC_DECIMALS));
    else if (mints) ixs.push(createMintToCheckedInstruction(USDC_MINT, ata, pool.publicKey, short, USDC_DECIMALS));
    else throw new Error("House bots are out of funds right now.");
  }
  ixs.push(...(await ixsJoin(me, room.address, { mint: room.mint })));
  return sendL1(ixs, [pool, bot.kp], 400_000);
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

async function tradeBot(room: RoomState, bot: Bot, pool: Keypair): Promise<boolean> {
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
  const order = decide(bot, room, pos, prices, now, hmac(pool, `${room.roomId}:${me.toBase58()}:${bucket}`));
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
  /** Winnings and spare SOL moved back to the pool (USDC base units, lamports). */
  swept?: { usdc: string; sol: number };
  /** Why the bots stay out of this room, as a sentence for the player. */
  paused?: string;
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
  const pool = poolKey();
  if (!pool) throw new Error("bots are not configured (BOT_POOL_SECRET_KEY)");
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
      const acted = await Promise.all(alive.map((b) => attempt(() => tradeBot(room, b, pool))));
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
    const why = await holdBack(room, bots, pool, todo);
    if (why) {
      report.paused = why;
      return report;
    }
    const mints = await poolMints(pool);
    const joined = await Promise.all(todo.map((b) => attempt(() => seatBot(room, b, pool, mints))));
    report.joined = joined.filter(Boolean).length;
    return report;
  }

  // Nobody is certain to press the payout button: a bot may have won, or the winner may have left.
  const payer = seated[0]?.kp ?? pool;
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
    const moved = seated.length ? await attempt(() => sweep(seated, pool)) : undefined;
    if (moved && (moved.usdc > 0n || moved.sol > 0)) report.swept = { usdc: String(moved.usdc), sol: moved.sol };
  }
  return report;
}
