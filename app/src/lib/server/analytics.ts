// Analytics for one network, read straight from chain: every Room and Rating account, the config
// and the fee vault. Nothing is tracked off chain, so the numbers are the ones anyone can verify.
// Server-only: the mainnet RPC (MAINNET_RPC_URL) may carry an API key.
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { coder, configPda, decodeRating, isOurRoom, ratingDiscriminator, roomDiscriminator, type RoomState } from "@/lib/royale/client";
import { CLUSTER, L1_RPC, PROGRAM_ID, PROGRAM_IDS, RoomStatus, StormKind, feedById } from "@/lib/royale/constants";
import { BOT_SHARE_SINCE, botShare, roomPayouts as payouts } from "@/lib/royale/game";
import { houseBots } from "@/lib/server/bots";

export type Network = "devnet" | "mainnet";

const env = (k: string) => (process.env[k] ?? "").trim();
const RPC: Record<Network, string> = {
  devnet: env("DEVNET_RPC_URL") || (CLUSTER === "devnet" ? L1_RPC : "https://rpc.magicblock.app/devnet"),
  mainnet: env("MAINNET_RPC_URL") || (CLUSTER === "mainnet" ? L1_RPC : "https://api.mainnet-beta.solana.com"),
};

/** House bots by network. They derive from pool keys, so they are listed here for the network this server doesn't run. */
const KNOWN_BOTS: Record<Network, [string, string][]> = {
  devnet: [
    ["Rider", "8zdkbUS5gsTxyQjTY7VJBC8MgrroQNo6oiZw7DpPnTV"],
    ["Fader", "ERQSZymW21sVuuybnRZCb3FBqEpJK4MvxRqd29iCgTbv"],
    ["Degen", "4CWjzbSN6kycFR4TgZWvKHCYGcmj3kVitNbnbHnKMiSc"],
    // Bots of the devnet pool used to test real transfers before mainnet.
    ["Rider", "HjagBunpNVvwFQ3cf4JhkmCfF1x8wvUWNMV4ATe1Vm8P"],
    ["Fader", "8qRArKYzJu7i9SZai6nVTbbtbRvVXWJWK4w1FnFoLJUE"],
    ["Degen", "ANLavUAfFvvpaPRhUJnzPUt8dmd7kRuAHFLbxLmuWBk7"],
  ],
  mainnet: [
    ["Rider", "2NWru39n1PM99s3TRqYqT8xcFkGfC1vvhcLqyDLFQEuE"],
    ["Fader", "Fri3wDfhESb8HFdAWoQjoZ7611P2Py1GQLxmZy1UGz2F"],
    ["Degen", "C2sXrMsshS8QjTcDk8gYM5GTKofSWMjMkkPfbo9oztwE"],
  ],
};

function botNames(net: Network): Map<string, string> {
  const m = new Map(KNOWN_BOTS[net].map(([name, address]) => [address, name]));
  if (net === CLUSTER) for (const b of houseBots()) m.set(b.kp.publicKey.toBase58(), b.name);
  return m;
}

const DAY = 86_400;
const DAYS = 14;
const STORM_NAMES: Record<number, string> = {
  [StormKind.Spotlight]: "Spotlight",
  [StormKind.Surge]: "Leverage surge",
  [StormKind.Freeze]: "Freeze",
  [StormKind.ZoneShrink]: "Zone shrink",
};
const STATUS_NAMES: Record<number, string> = {
  [RoomStatus.Open]: "Open",
  [RoomStatus.Starting]: "Starting",
  [RoomStatus.Live]: "Live",
  [RoomStatus.Ended]: "Awaiting payout",
  [RoomStatus.Settled]: "Paid out",
  [RoomStatus.Cancelled]: "Didn't fill",
};

const played = (r: RoomState) => r.status !== RoomStatus.Open && r.status !== RoomStatus.Cancelled;
const usd = (v: bigint) => v.toString();

export type Analytics = Awaited<ReturnType<typeof compute>>;

async function compute(net: Network) {
  const l1 = new Connection(RPC[net], "confirmed");
  // Each network has its own program ID; this server's own network may override it by env.
  const pid = net === CLUSTER ? PROGRAM_ID : new PublicKey(PROGRAM_IDS[net]);
  const cfgKey = net === CLUSTER ? configPda() : PublicKey.findProgramAddressSync([Buffer.from("cfg")], pid)[0];
  const disc = bs58.encode(roomDiscriminator());
  const [own, delegated, ratingAccs, cfgAcc] = await Promise.all([
    l1.getProgramAccounts(pid, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }),
    l1.getProgramAccounts(DELEGATION_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }).catch(() => []),
    l1.getProgramAccounts(pid, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ratingDiscriminator()) } }] }),
    l1.getAccountInfo(cfgKey),
  ]);
  const rooms = [...own, ...delegated].flatMap((a) => isOurRoom(a.pubkey, a.account.data as Buffer, pid) ?? []);
  const bots = botNames(net);
  const isBot = (p: PublicKey) => bots.has(p.toBase58());

  // Fee vault: what the protocol has actually collected, as held onchain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = cfgAcc ? (coder.accounts.decode("config", cfgAcc.data as Buffer) as any) : null;
  const feeVault: PublicKey | null = cfg?.feeVault ?? null;
  const vaultBalance = feeVault
    ? await l1
        .getTokenAccountBalance(feeVault)
        .then((b) => BigInt(b.value.amount))
        .catch(() => null)
    : null;

  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: DAYS }, (_, i) => ({ day: today - (DAYS - 1 - i) * DAY, rounds: 0, human: 0n, bot: 0n }));

  let volume = 0n,
    humanVolume = 0n,
    botVolume = 0n,
    fees = 0n,
    paid = 0n,
    houseResult = 0n,
    houseAtStake = 0n,
    returned = 0n,
    escrow = 0n,
    biggest = 0n,
    seats = 0,
    capacity = 0,
    botSeats = 0;
  const wallets = new Map<string, number>();
  const recentWallets = new Set<string>();
  const markets = new Map<number, number>();
  const storms = new Map<number, number>();
  const statuses = new Map<number, number>();
  const sinceWeek = now - 7 * DAY;

  for (const r of rooms) {
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    for (const p of r.players) {
      const k = p.toBase58();
      wallets.set(k, (wallets.get(k) ?? 0) + 1);
      if (r.createdTs >= sinceWeek) recentWallets.add(k);
    }
    const pot = r.entryAmount * BigInt(r.seatsFilled);
    if (r.status === RoomStatus.Open && now < r.fillExpiry) escrow += pot;
    if (!played(r)) continue;

    const botCount = r.players.filter(isBot).length;
    const botStake = r.entryAmount * BigInt(botCount);
    volume += pot;
    botVolume += botStake;
    humanVolume += pot - botStake;
    biggest = pot > biggest ? pot : biggest;
    seats += r.seatsFilled;
    capacity += r.maxSeats;
    botSeats += botCount;
    for (const id of r.assets.slice(0, r.numAssets)) markets.set(id, (markets.get(id) ?? 0) + 1);
    for (let k = 0; k < 6; k++) if ((r.stormsFulfilled >> k) & 1 && r.stormKind[k]) storms.set(r.stormKind[k], (storms.get(r.stormKind[k]) ?? 0) + 1);

    const d = days.find((x) => r.createdTs >= x.day && r.createdTs < x.day + DAY);
    if (d) {
      d.rounds += 1;
      d.bot += botStake;
      d.human += pot - botStake;
    }

    if (r.status === RoomStatus.Settled) {
      const fee = (pot * BigInt(r.feeBps)) / 10_000n;
      fees += fee;
      paid += pot - fee;
      if (botCount) {
        // Since BOT_SHARE_SINCE the pool hands what its bots win back to the players.
        const share = botShare(r, isBot);
        const back = r.endTs >= BOT_SHARE_SINCE ? share.returned : 0n;
        returned += back;
        houseResult += share.won - back - botStake;
      }
    } else if (botCount) {
      houseAtStake += botStake;
    }
  }

  const playedRooms = rooms.filter(played);
  const ratings = ratingAccs
    .map((a) => decodeRating(a.account.data as Buffer))
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins);

  const recent = [...rooms]
    .sort((a, b) => b.createdTs - a.createdTs)
    .slice(0, 10)
    .map((r) => {
      const pay = payouts(r);
      const seat = r.finalistSeats[0];
      const winner = r.status === RoomStatus.Settled && r.finalistCount > 0 ? r.players[seat] : null;
      return {
        roomId: r.roomId.toString(),
        address: r.address.toBase58(),
        createdTs: r.createdTs,
        status: r.status === RoomStatus.Open && now >= r.fillExpiry ? "Didn't fill" : (STATUS_NAMES[r.status] ?? String(r.status)),
        markets: r.assets.slice(0, r.numAssets).map((id) => feedById(id)?.symbol ?? String(id)),
        seats: r.seatsFilled,
        maxSeats: r.maxSeats,
        entry: usd(r.entryAmount),
        pot: usd(r.entryAmount * BigInt(r.seatsFilled)),
        bots: r.players.filter(isBot).length,
        winner: winner ? { address: winner.toBase58(), bot: bots.get(winner.toBase58()) ?? null, payout: usd(pay.get(seat) ?? 0n) } : null,
      };
    });

  return {
    network: net,
    at: now,
    program: pid.toBase58(),
    config: cfg
      ? {
          feeBps: cfg.feeBps as number,
          minEntry: String(cfg.minEntry),
          maxEntry: String(cfg.maxEntry),
          paused: cfg.paused as boolean,
          feeVault: feeVault?.toBase58() ?? null,
          vaultBalance: vaultBalance === null ? null : usd(vaultBalance),
        }
      : null,
    totals: {
      volume: usd(volume),
      humanVolume: usd(humanVolume),
      botVolume: usd(botVolume),
      fees: usd(fees),
      paid: usd(paid),
      escrow: usd(escrow),
      biggestPot: usd(biggest),
      averagePot: usd(playedRooms.length ? volume / BigInt(playedRooms.length) : 0n),
      houseResult: usd(houseResult),
      houseAtStake: usd(houseAtStake),
      returned: usd(returned),
    },
    rooms: {
      created: rooms.length,
      played: playedRooms.length,
      paidOut: statuses.get(RoomStatus.Settled) ?? 0,
      live: (statuses.get(RoomStatus.Starting) ?? 0) + (statuses.get(RoomStatus.Live) ?? 0),
      awaitingPayout: statuses.get(RoomStatus.Ended) ?? 0,
      open: rooms.filter((r) => r.status === RoomStatus.Open && now < r.fillExpiry).length,
      cancelled: (statuses.get(RoomStatus.Cancelled) ?? 0) + rooms.filter((r) => r.status === RoomStatus.Open && now >= r.fillExpiry).length,
      averagePlayers: playedRooms.length ? seats / playedRooms.length : 0,
      fillRate: capacity ? seats / capacity : 0,
      botSeatShare: seats ? botSeats / seats : 0,
      lastCreated: rooms.reduce((m, r) => Math.max(m, r.createdTs), 0),
    },
    players: {
      unique: wallets.size,
      returning: [...wallets.values()].filter((n) => n >= 2).length,
      lastWeek: recentWallets.size,
      rated: ratings.length,
    },
    daily: days.map((d) => ({ day: d.day, rounds: d.rounds, human: usd(d.human), bot: usd(d.bot) })),
    markets: [...markets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, rooms]) => ({ symbol: feedById(id)?.symbol ?? String(id), rooms })),
    storms: [StormKind.Spotlight, StormKind.Surge, StormKind.Freeze, StormKind.ZoneShrink].map((k) => ({ name: STORM_NAMES[k], fired: storms.get(k) ?? 0 })),
    statuses: [
      { name: "Paid out", rooms: statuses.get(RoomStatus.Settled) ?? 0 },
      { name: "Live", rooms: (statuses.get(RoomStatus.Starting) ?? 0) + (statuses.get(RoomStatus.Live) ?? 0) },
      { name: "Awaiting payout", rooms: statuses.get(RoomStatus.Ended) ?? 0 },
      { name: "Open", rooms: rooms.filter((r) => r.status === RoomStatus.Open && now < r.fillExpiry).length },
      // Never filled: entries go back through `refund`.
      { name: "Didn't fill", rooms: (statuses.get(RoomStatus.Cancelled) ?? 0) + rooms.filter((r) => r.status === RoomStatus.Open && now >= r.fillExpiry).length },
    ],
    leaders: ratings.slice(0, 10).map((r) => ({ player: r.player.toBase58(), elo: r.elo, games: r.games, wins: r.wins, top3: r.top3 })),
    recent,
  };
}

const cache = new Map<Network, { at: number; run: Promise<Analytics> }>();
/** One network's analytics, cached for a minute so a busy page costs one scan. */
export function analytics(net: Network): Promise<Analytics> {
  const hit = cache.get(net);
  if (hit && Date.now() - hit.at < 60_000) return hit.run;
  const run = compute(net);
  run.catch(() => cache.delete(net));
  cache.set(net, { at: Date.now(), run });
  return run;
}
