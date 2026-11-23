// Dev-only fixture so the room, spectator, and results screens can render without a live round.
// Production builds never read the query string that selects these.
import { Keypair, PublicKey } from "@solana/web3.js";
import type { PositionState, RoomState } from "@/lib/royale/client";
import { FEEDS, RoomStatus, USDC_MINT } from "@/lib/royale/constants";

export type PreviewBundle = {
  room: RoomState;
  position: PositionState | null;
  prices: (bigint | null)[];
  history: number[][];
  me: PublicKey | null;
  delegated: boolean;
};

const pk = (n: number) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => (n * 17 + 3) % 255 || 1)).publicKey;

function walk(seed: number, n: number, start: number, vol: number, drift = 0) {
  let x = seed;
  const rnd = () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v = Math.max(v * 0.2, v + (rnd() - 0.48) * vol + drift);
    out.push(v);
  }
  return out;
}

const raw = (price: number, exp: number) => BigInt(Math.round(price * 10 ** -exp));

function shell(partial: Partial<RoomState> & Pick<RoomState, "status" | "players" | "seatsFilled" | "maxSeats">): RoomState {
  const now = Math.floor(Date.now() / 1000);
  const assets = partial.assets ?? [6, 1, 9];
  const feeds = assets.map((id) => FEEDS.find((f) => f.id === id)!);
  const seats = partial.seatsFilled;
  return {
    address: pk(40),
    roomId: 482910n,
    creator: partial.players[0],
    mint: USDC_MINT,
    entryAmount: 5_000_000n,
    feeBps: 500,
    aliveCount: seats,
    finalistsTarget: seats >= 8 ? 3 : seats >= 5 ? 2 : 1,
    nextCheckpoint: 0,
    numAssets: assets.length,
    intervalSecs: 60,
    assets,
    feeds: feeds.map((f) => f.pda),
    exponents: feeds.map((f) => f.exponent),
    createdTs: now - 900,
    fillExpiry: now + 420,
    startedTs: 0,
    startTs: 0,
    endTs: 0,
    elimCheckpoint: Array(seats).fill(0),
    placement: Array(seats).fill(0),
    publicRank: Array(seats).fill(0),
    finalEquity: Array(seats).fill(10_000_000_000n),
    lastPrice: [],
    finalistCount: 0,
    finalistSeats: [],
    stormKind: [0, 0, 0, 0, 0, 0],
    stormAsset: [0, 0, 0, 0, 0, 0],
    stormSide: [0, 0, 0, 0, 0, 0],
    stormsRequested: 0,
    stormsFulfilled: 0,
    stormsSeen: 0,
    seedSet: false,
    taskId: 1n,
    ticks: 0,
    private: true,
    rated: false,
    refunded: 0,
    ...partial,
  };
}

const solSeries = walk(4, 96, 136.4, 0.42, 0.03);
const btcSeries = walk(9, 96, 97420, 220, -12);
const bonkSeries = walk(2, 96, 0.0000214, 0.00000035, 0.000000008);

function rawHistory(): number[][] {
  return [
    solSeries.map((p) => Math.round(p * 1e8)),
    btcSeries.map((p) => Math.round(p * 1e8)),
    bonkSeries.map((p) => Math.round(p * 1e10)),
  ];
}

function pricesOf(): (bigint | null)[] {
  return [raw(solSeries.at(-1)!, -8), raw(btcSeries.at(-1)!, -8), raw(bonkSeries.at(-1)!, -10)];
}

export function buildPreview(key: string | null): PreviewBundle | null {
  if (!key || process.env.NODE_ENV === "production") return null;
  const now = Math.floor(Date.now() / 1000);
  if (key === "open") {
    const players = [0, 1, 2, 3, 4].map(pk);
    return {
      room: shell({ status: RoomStatus.Open, players, seatsFilled: 5, maxSeats: 8, aliveCount: 5 }),
      position: null,
      prices: pricesOf(),
      history: rawHistory(),
      me: null,
      delegated: false,
    };
  }
  if (key === "live" || key === "spectate") {
    const players = Array.from({ length: 8 }, (_, i) => pk(i));
    const room = shell({
      status: RoomStatus.Live,
      players,
      seatsFilled: 8,
      maxSeats: 8,
      aliveCount: 6,
      nextCheckpoint: 2,
      startedTs: now - 100,
      startTs: now - 95,
      endTs: now - 95 + 360,
      elimCheckpoint: [0, 0, 1, 0, 0, 2, 0, 0],
      placement: [0, 0, 8, 0, 0, 7, 0, 0],
      publicRank: [1, 3, 0, 2, 4, 0, 5, 6],
      finalEquity: [12_400_000_000n, 11_200_000_000n, 4_180_000_000n, 10_860_000_000n, 9_940_000_000n, 6_050_000_000n, 9_410_000_000n, 8_770_000_000n],
      stormKind: [1, 2, 0, 0, 0, 0],
      stormAsset: [0, 0, 0, 0, 0, 0],
      stormSide: [0, 0, 0, 0, 0, 0],
      stormsRequested: 0b11,
      stormsFulfilled: 0b11,
      stormsSeen: 2,
      seedSet: true,
      ticks: 2,
    });
    const me = key === "spectate" ? null : players[0];
    const entry = raw(131.2, -8);
    const position: PositionState | null = me
      ? {
          address: pk(50),
          room: room.address,
          owner: me,
          seat: 0,
          side: 1,
          leverage: 2,
          assetIdx: 0,
          alive: true,
          liquidated: false,
          permissioned: true,
          entryPrice: entry,
          entryTs: now - 40,
          equityAtOpen: 10_400_000_000n,
          equity: 10_400_000_000n,
          lastActionTs: now - 20,
          actions: 3,
          viewer: pk(51),
        }
      : null;
    return { room, position, prices: pricesOf(), history: rawHistory(), me, delegated: true };
  }
  if (key === "results") {
    const players = Array.from({ length: 8 }, (_, i) => pk(i));
    const equities = [18_420_000_000n, 14_110_000_000n, 6_200_000_000n, 11_040_000_000n, 4_400_000_000n, 8_050_000_000n, 2_100_000_000n, 900_000_000n];
    const room = shell({
      status: RoomStatus.Settled,
      players,
      seatsFilled: 8,
      maxSeats: 8,
      aliveCount: 3,
      nextCheckpoint: 6,
      startedTs: now - 500,
      startTs: now - 480,
      endTs: now - 120,
      elimCheckpoint: [6, 6, 2, 6, 3, 4, 1, 5],
      placement: [1, 2, 6, 3, 7, 4, 8, 5],
      publicRank: [1, 2, 6, 3, 7, 4, 8, 5],
      finalEquity: equities,
      finalistCount: 3,
      finalistSeats: [0, 1, 3],
      stormKind: [1, 2, 4, 3, 2, 1],
      stormAsset: [0, 0, 0, 1, 0, 2],
      stormSide: [0, 0, 0, -1, 0, 0],
      stormsRequested: 0b111111,
      stormsFulfilled: 0b111111,
      stormsSeen: 6,
      seedSet: true,
      ticks: 6,
      rated: true,
    });
    return {
      room,
      position: null,
      prices: pricesOf(),
      history: rawHistory(),
      me: players[0],
      delegated: false,
    };
  }
  return null;
}

export const PREVIEW_RATING = {
  elo: 1384,
  games: 11,
  wins: 3,
  top3: 6,
  bestEquity: 18_420_000_000n,
};
