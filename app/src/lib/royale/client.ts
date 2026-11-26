// Shared PnL Royale client: PDAs, account decoding, instruction builders.
// Used by the web app, the relayer and the scripts (no browser-only imports here).
import { AnchorProvider, BN, BorshCoder, Program, type Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idlJson from "../../idl/royale.json";
import type { Royale } from "../../idl/royale";
import {
  ER_VALIDATOR,
  PRIORITY_MICROLAMPORTS,
  PROGRAM_ID,
  SEEDS,
  SESSION_KEYS_PROGRAM_ID,
  SLOT_HASHES,
  USDC_MINT,
  VRF_EPHEMERAL_QUEUE,
  VRF_PROGRAM_ID,
  feedById,
  RoomStatus,
} from "./constants";

const idl = { ...(idlJson as Idl), address: PROGRAM_ID.toBase58() } as Royale;

/** A Program used only to build instructions (never signs or sends). */
const readonlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T,>(t: T) => t,
  signAllTransactions: async <T,>(t: T[]) => t,
};
let _program: Program<Royale> | null = null;
export function program(connection?: Connection): Program<Royale> {
  if (!_program || connection) {
    const provider = new AnchorProvider(
      connection ?? new Connection("http://127.0.0.1:8899"),
      readonlyWallet as never,
      { commitment: "confirmed" },
    );
    _program = new Program<Royale>(idl, provider);
  }
  return _program;
}

/**
 * The Program's coder works on the camelCased IDL: account names are lowercase ("room") and
 * decoded fields are camelCase (roomId). A BorshCoder over the raw JSON IDL would give
 * snake_case fields instead.
 */
export const coder = program().coder;
/** Raw (snake_case) coder, for decoding instruction data by its on-chain name. */
export const rawCoder = new BorshCoder(idl as unknown as Idl);

// ---------------------------------------------------------------- PDAs

const u64le = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const configPda = () => PublicKey.findProgramAddressSync([SEEDS.config], PROGRAM_ID)[0];
export const roomPda = (roomId: bigint | number) =>
  PublicKey.findProgramAddressSync([SEEDS.room, u64le(roomId)], PROGRAM_ID)[0];
export const vaultPda = (room: PublicKey) =>
  PublicKey.findProgramAddressSync([SEEDS.vault, room.toBuffer()], PROGRAM_ID)[0];
export const positionPda = (room: PublicKey, player: PublicKey) =>
  PublicKey.findProgramAddressSync([SEEDS.position, room.toBuffer(), player.toBuffer()], PROGRAM_ID)[0];
export const ratingPda = (player: PublicKey) =>
  PublicKey.findProgramAddressSync([SEEDS.rating, player.toBuffer()], PROGRAM_ID)[0];
export const programIdentityPda = () =>
  PublicKey.findProgramAddressSync([SEEDS.identity], PROGRAM_ID)[0];
export const sessionTokenPda = (sessionSigner: PublicKey, authority: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("session_token_v2"), PROGRAM_ID.toBuffer(), sessionSigner.toBuffer(), authority.toBuffer()],
    SESSION_KEYS_PROGRAM_ID,
  )[0];
export const permissionPda = (account: PublicKey) => permissionPdaFromAccount(account);

// ---------------------------------------------------------------- Decoded state

export type RoomState = {
  address: PublicKey;
  roomId: bigint;
  creator: PublicKey;
  mint: PublicKey;
  entryAmount: bigint;
  feeBps: number;
  status: RoomStatus;
  maxSeats: number;
  seatsFilled: number;
  aliveCount: number;
  finalistsTarget: number;
  nextCheckpoint: number;
  numAssets: number;
  intervalSecs: number;
  assets: number[];
  feeds: PublicKey[];
  exponents: number[];
  createdTs: number;
  fillExpiry: number;
  startedTs: number;
  startTs: number;
  endTs: number;
  players: PublicKey[];
  elimCheckpoint: number[];
  placement: number[];
  publicRank: number[];
  finalEquity: bigint[];
  lastPrice: bigint[];
  finalistCount: number;
  finalistSeats: number[];
  stormKind: number[];
  stormAsset: number[];
  stormSide: number[];
  stormsRequested: number;
  stormsFulfilled: number;
  stormsSeen: number;
  seedSet: boolean;
  taskId: bigint;
  ticks: number;
  private: boolean;
  rated: boolean;
  refunded: number;
};

export type PositionState = {
  address: PublicKey;
  room: PublicKey;
  owner: PublicKey;
  seat: number;
  side: number;
  leverage: number;
  assetIdx: number;
  alive: boolean;
  liquidated: boolean;
  permissioned: boolean;
  entryPrice: bigint;
  entryTs: number;
  equityAtOpen: bigint;
  equity: bigint;
  lastActionTs: number;
  actions: number;
  viewer: PublicKey;
};

export type RatingState = {
  player: PublicKey;
  elo: number;
  games: number;
  wins: number;
  top3: number;
  bestEquity: bigint;
  lastRoom: bigint;
};

const big = (x: BN | number) => BigInt(x.toString());
const num = (x: BN | number) => Number(x.toString());

export function decodeRoom(address: PublicKey, data: Buffer): RoomState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = coder.accounts.decode("room", data);
  const seats = r.seatsFilled as number;
  return {
    address,
    roomId: big(r.roomId),
    creator: r.creator,
    mint: r.mint,
    entryAmount: big(r.entryAmount),
    feeBps: r.feeBps,
    status: r.status as RoomStatus,
    maxSeats: r.maxSeats,
    seatsFilled: seats,
    aliveCount: r.aliveCount,
    finalistsTarget: r.finalistsTarget,
    nextCheckpoint: r.nextCheckpoint,
    numAssets: r.numAssets,
    intervalSecs: r.intervalSecs,
    assets: (r.assets as number[]).slice(0, r.numAssets),
    feeds: (r.feeds as PublicKey[]).slice(0, r.numAssets),
    exponents: (r.exponents as number[]).slice(0, r.numAssets),
    createdTs: num(r.createdTs),
    fillExpiry: num(r.fillExpiry),
    startedTs: num(r.startedTs),
    startTs: num(r.startTs),
    endTs: num(r.endTs),
    players: (r.players as PublicKey[]).slice(0, seats),
    elimCheckpoint: (r.elimCheckpoint as number[]).slice(0, seats),
    placement: (r.placement as number[]).slice(0, seats),
    publicRank: (r.publicRank as number[]).slice(0, seats),
    finalEquity: (r.finalEquity as BN[]).slice(0, seats).map(big),
    lastPrice: (r.lastPrice as BN[]).map(big),
    finalistCount: r.finalistCount,
    finalistSeats: (r.finalistSeats as number[]).slice(0, r.finalistCount),
    stormKind: r.stormKind,
    stormAsset: r.stormAsset,
    stormSide: r.stormSide,
    stormsRequested: r.stormsRequested,
    stormsFulfilled: r.stormsFulfilled,
    stormsSeen: r.stormsSeen,
    seedSet: r.seedSet,
    taskId: big(r.taskId),
    ticks: r.ticks,
    private: r.private,
    rated: r.rated,
    refunded: r.refunded,
  };
}

export function decodePosition(address: PublicKey, data: Buffer): PositionState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = coder.accounts.decode("position", data);
  return {
    address,
    room: p.room,
    owner: p.owner,
    seat: p.seat,
    side: p.side,
    leverage: p.leverage,
    assetIdx: p.assetIdx,
    alive: p.alive,
    liquidated: p.liquidated,
    permissioned: p.permissioned,
    entryPrice: big(p.entryPrice),
    entryTs: num(p.entryTs),
    equityAtOpen: big(p.equityAtOpen),
    equity: big(p.equity),
    lastActionTs: num(p.lastActionTs),
    actions: p.actions,
    viewer: p.viewer,
  };
}

export function decodeRating(data: Buffer): RatingState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = coder.accounts.decode("rating", data);
  return {
    player: r.player,
    elo: r.elo,
    games: r.games,
    wins: r.wins,
    top3: r.top3,
    bestEquity: big(r.bestEquity),
    lastRoom: big(r.lastRoom),
  };
}

/**
 * True if `address` is this program's Room PDA for the decoded room id. Needed when scanning the
 * Delegation Program: every Anchor program with a `Room` account shares the discriminator.
 */
export function isOurRoom(address: PublicKey, data: Buffer): RoomState | null {
  try {
    const r = decodeRoom(address, data);
    return roomPda(r.roomId).equals(address) ? r : null;
  } catch {
    return null;
  }
}

/** Discriminator filter for getProgramAccounts. */
export const roomDiscriminator = (): Buffer =>
  Buffer.from(((idlJson as Idl).accounts?.find((a) => a.name === "Room")?.discriminator ?? []) as number[]);
export const ratingDiscriminator = (): Buffer =>
  Buffer.from(((idlJson as Idl).accounts?.find((a) => a.name === "Rating")?.discriminator ?? []) as number[]);

// ---------------------------------------------------------------- Oracle

/** Decode a pricing-oracle feed (PriceUpdateV3 body = Pyth PriceUpdateV2 layout). */
export function decodeFeed(data: Buffer): { price: bigint; publishTime: number; postedSlot: bigint } | null {
  try {
    let o = 8 + 32; // discriminator + write_authority
    const level = data.readUInt8(o);
    o += level === 0 ? 2 : 1; // Partial { num_signatures } | Full
    o += 32; // feed_id
    const price = data.readBigInt64LE(o);
    o += 8 + 8 + 4; // price, conf, exponent (ignored: stored +8 is wrong)
    const publishTime = Number(data.readBigInt64LE(o));
    o += 8 + 8 + 8 + 8; // publish_time, prev_publish_time, ema_price, ema_conf
    const postedSlot = data.readBigUInt64LE(o);
    return { price, publishTime, postedSlot };
  } catch {
    return null;
  }
}

/** Raw oracle integer -> float USD using the pinned feed-list exponent. */
export const priceToNumber = (raw: bigint, exponent: number) => Number(raw) * Math.pow(10, exponent);

// ---------------------------------------------------------------- Instructions

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });

export const feedMetas = (room: Pick<RoomState, "feeds">) => room.feeds.map(ro);
export const positionMetas = (room: Pick<RoomState, "address" | "players">) =>
  room.players.map((p) => rw(positionPda(room.address, p)));

export async function ixInitConfig(admin: PublicKey, feeVault: PublicKey, feeBps: number, minEntry: bigint, maxEntry: bigint, mint = USDC_MINT) {
  const programData = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
  return program()
    .methods.initConfig(feeBps, new BN(minEntry.toString()), new BN(maxEntry.toString()))
    .accountsStrict({
      admin,
      config: configPda(),
      usdcMint: mint,
      feeVault,
      program: PROGRAM_ID,
      programData,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export type CreateRoomParams = {
  roomId: bigint;
  entryAmount: bigint;
  maxSeats: number;
  assets: number[];
  fillSecs: number;
  intervalSecs: number;
  private: boolean;
};

export async function ixCreateRoom(creator: PublicKey, p: CreateRoomParams, mint = USDC_MINT) {
  const room = roomPda(p.roomId);
  return program()
    .methods.createRoom({
      roomId: new BN(p.roomId.toString()),
      entryAmount: new BN(p.entryAmount.toString()),
      maxSeats: p.maxSeats,
      assets: p.assets,
      fillSecs: new BN(p.fillSecs),
      intervalSecs: p.intervalSecs,
      private: p.private,
    })
    .accountsStrict({
      creator,
      config: configPda(),
      room,
      vault: vaultPda(room),
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/** join_room + delegate_position (+ optional create_session_v2): one wallet popup. */
export async function ixsJoin(
  player: PublicKey,
  room: PublicKey,
  opts: { viewer?: PublicKey; mint?: PublicKey; playerToken?: PublicKey; validator?: PublicKey } = {},
) {
  const mint = opts.mint ?? USDC_MINT;
  const position = positionPda(room, player);
  const join = await program()
    .methods.joinRoom(opts.viewer ?? PublicKey.default)
    .accountsStrict({
      player,
      config: configPda(),
      room,
      position,
      rating: ratingPda(player),
      playerToken: opts.playerToken ?? getAssociatedTokenAddressSync(mint, player),
      vault: vaultPda(room),
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const delegate = await program()
    .methods.delegatePosition()
    .accountsStrict({
      payer: player,
      room,
      bufferPosition: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(position, PROGRAM_ID),
      delegationRecordPosition: delegationRecordPdaFromDelegatedAccount(position),
      delegationMetadataPosition: delegationMetadataPdaFromDelegatedAccount(position),
      position,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([ro(opts.validator ?? ER_VALIDATOR)])
    .instruction();
  return [join, delegate];
}

/** session-keys `create_session_v2`: the browser key may sign set_position for 1 hour. */
export function ixCreateSessionV2(authority: PublicKey, sessionSigner: PublicKey, validUntil: number, topUpLamports = 0) {
  const data = Buffer.concat([
    sessionDisc(),
    Buffer.from([1, topUpLamports > 0 ? 1 : 0]), // top_up: Some(bool)
    Buffer.from([1]),
    (() => {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(validUntil));
      return b;
    })(),
    topUpLamports > 0
      ? Buffer.concat([Buffer.from([1]), u64le(topUpLamports)])
      : Buffer.from([0]),
  ]);
  return new TransactionInstruction({
    programId: SESSION_KEYS_PROGRAM_ID,
    keys: [
      rw(sessionTokenPda(sessionSigner, authority)),
      { pubkey: sessionSigner, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      ro(PROGRAM_ID),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// sha256("global:create_session_v2")[0..8], precomputed (avoids a crypto dependency).
const SESSION_V2_DISC = [0xdf, 0xe9, 0x6c, 0x07, 0x41, 0xc2, 0xeb, 0x26];
const sessionDisc = () => Buffer.from(SESSION_V2_DISC);

export async function ixStartRoom(payer: PublicKey, room: PublicKey, validator = ER_VALIDATOR) {
  return program()
    .methods.startRoom()
    .accountsStrict({
      payer,
      bufferRoom: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(room, PROGRAM_ID),
      delegationRecordRoom: delegationRecordPdaFromDelegatedAccount(room),
      delegationMetadataRoom: delegationMetadataPdaFromDelegatedAccount(room),
      room,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([ro(validator)])
    .instruction();
}

export async function ixInitPermission(payer: PublicKey, room: PublicKey, position: PublicKey) {
  return program()
    .methods.initPermission()
    .accountsStrict({
      payer,
      room,
      position,
      permission: permissionPda(position),
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
}

export async function ixBeginRound(payer: PublicKey, room: RoomState) {
  return program()
    .methods.beginRound()
    .accountsStrict({ payer, room: room.address, oracleQueue: VRF_EPHEMERAL_QUEUE, magicProgram: MAGIC_PROGRAM_ID })
    .remainingAccounts([...positionMetas(room), ...feedMetas(room)])
    .instruction();
}

export async function ixSetPosition(
  signer: PublicKey,
  room: RoomState,
  owner: PublicKey,
  sessionToken: PublicKey | null,
  side: -1 | 0 | 1,
  leverage: number,
  assetIdx: number,
) {
  return program()
    .methods.setPosition(side, leverage, assetIdx)
    .accountsStrict({
      signer,
      room: room.address,
      position: positionPda(room.address, owner),
      sessionToken,
    })
    .remainingAccounts(feedMetas(room))
    .instruction();
}

export async function ixTick(room: RoomState) {
  return program()
    .methods.tick()
    .accountsStrict({ room: room.address })
    .remainingAccounts([...positionMetas(room), ...feedMetas(room)])
    .instruction();
}

export async function ixRequestStorm(room: PublicKey) {
  return program()
    .methods.requestStorm()
    .accountsStrict({
      room,
      programIdentity: programIdentityPda(),
      oracleQueue: VRF_EPHEMERAL_QUEUE,
      vrfProgram: VRF_PROGRAM_ID,
      slotHashes: SLOT_HASHES,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function ixFinalizeRound(payer: PublicKey, room: RoomState) {
  return program()
    .methods.finalizeRound()
    .accountsStrict({ payer, room: room.address, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
    .remainingAccounts(positionMetas(room))
    .instruction();
}

export async function ixAbortRound(payer: PublicKey, room: RoomState, delegatedPositions: PublicKey[]) {
  return program()
    .methods.abortRound()
    .accountsStrict({ payer, room: room.address, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
    .remainingAccounts(delegatedPositions.map(rw))
    .instruction();
}

export async function ixReleasePosition(payer: PublicKey, room: PublicKey, position: PublicKey) {
  return program()
    .methods.releasePosition()
    .accountsStrict({ payer, room, position, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
    .instruction();
}

export async function ixRefund(room: RoomState, tokenAccounts: PublicKey[]) {
  return program()
    .methods.refund()
    .accountsStrict({ room: room.address, vault: vaultPda(room.address), mint: room.mint, tokenProgram: TOKEN_PROGRAM_ID })
    .remainingAccounts(tokenAccounts.map(rw))
    .instruction();
}

export async function ixSettle(payer: PublicKey, room: RoomState, feeVault: PublicKey) {
  const winners = room.finalistSeats.map((s) => getAssociatedTokenAddressSync(room.mint, room.players[s]));
  return program()
    .methods.settle()
    .accountsStrict({
      payer,
      config: configPda(),
      room: room.address,
      vault: vaultPda(room.address),
      feeVault,
      mint: room.mint,
      creator: room.creator,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(winners.map(rw))
    .instruction();
}

export async function ixRateRoom(room: RoomState) {
  return program()
    .methods.rateRoom()
    .accountsStrict({ room: room.address })
    .remainingAccounts(room.players.map((p) => rw(ratingPda(p))))
    .instruction();
}

export async function ixClosePosition(owner: PublicKey, room: PublicKey) {
  return program()
    .methods.closePosition()
    .accountsStrict({ owner, room, position: positionPda(room, owner) })
    .instruction();
}

const positionDiscriminator = (): Buffer =>
  Buffer.from(((idlJson as Idl).accounts?.find((a) => a.name === "Position")?.discriminator ?? []) as number[]);

/**
 * `owner`'s positions in finished rooms (paid out or cancelled), whose rent is waiting to come back.
 * A position still in play is delegated, so it never shows up here. Oldest rooms are not preferred:
 * any finished one will do.
 */
export async function finishedPositions(connection: Connection, owner: PublicKey, skip?: PublicKey): Promise<PublicKey[]> {
  const list = await connection.getProgramAccounts(PROGRAM_ID, {
    dataSlice: { offset: 8, length: 32 }, // the room
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(positionDiscriminator()) } }, { memcmp: { offset: 40, bytes: owner.toBase58() } }],
  });
  const rooms = list.map((a) => new PublicKey(a.account.data)).filter((r) => !skip?.equals(r)).slice(0, 20);
  if (rooms.length === 0) return [];
  const infos = await connection.getMultipleAccountsInfo(rooms);
  return rooms.filter((r, i) => {
    const a = infos[i];
    if (!a?.owner.equals(PROGRAM_ID)) return false;
    const st = decodeRoom(r, a.data as Buffer).status;
    return st === RoomStatus.Settled || st === RoomStatus.Cancelled;
  });
}

export const cuLimit = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

/**
 * Prefix L1 instructions with a compute-unit price (mainnet) so they land under load. Adds a CU
 * limit too unless one is already present. 300k CU at 50k micro-lamports = 15,000 lamports.
 */
export function withPriority(ixs: TransactionInstruction[], units = 300_000): TransactionInstruction[] {
  if (!PRIORITY_MICROLAMPORTS) return ixs;
  const hasLimit = ixs.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2);
  return [
    ...(hasLimit ? [] : [cuLimit(units)]),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ...ixs,
  ];
}

// ---------------------------------------------------------------- Helpers

export const newRoomId = (): bigint => {
  // time-prefixed random id: unique enough for a lobby, sorts by creation time
  const t = BigInt(Math.floor(Date.now() / 1000)) << 20n;
  return t | BigInt(Math.floor(Math.random() * (1 << 20)));
};

export const assetSymbol = (room: Pick<RoomState, "assets">, idx: number) => feedById(room.assets[idx])?.symbol ?? "?";

export const randomKeypair = () => Keypair.generate();
