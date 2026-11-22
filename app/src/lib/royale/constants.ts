import { PublicKey } from "@solana/web3.js";
import idl from "../../idl/royale.json";

export type Cluster = "mainnet" | "devnet" | "localnet";

// Next.js only inlines literal `process.env.NEXT_PUBLIC_*` reads, so list them explicitly.
// Node scripts (relayer, smoke tests) get the same values from their runtime env.
const ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_CLUSTER: process.env.NEXT_PUBLIC_CLUSTER,
  NEXT_PUBLIC_L1_RPC: process.env.NEXT_PUBLIC_L1_RPC,
  NEXT_PUBLIC_ER_RPC: process.env.NEXT_PUBLIC_ER_RPC,
  NEXT_PUBLIC_ER_WS: process.env.NEXT_PUBLIC_ER_WS,
  NEXT_PUBLIC_ER_VALIDATOR: process.env.NEXT_PUBLIC_ER_VALIDATOR,
  NEXT_PUBLIC_USDC_MINT: process.env.NEXT_PUBLIC_USDC_MINT,
  NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID,
  NEXT_PUBLIC_PRIORITY_MICROLAMPORTS: process.env.NEXT_PUBLIC_PRIORITY_MICROLAMPORTS,
};
const env = (k: string, d: string): string => {
  const v = ENV[k];
  return v && v.length > 0 ? v : d;
};

export const CLUSTER = env("NEXT_PUBLIC_CLUSTER", "devnet") as Cluster;

const DEFAULTS: Record<Cluster, { l1: string; er: string; usdc: string; explorer: string }> = {
  mainnet: {
    l1: "https://api.mainnet-beta.solana.com",
    er: "https://mainnet-tee.magicblock.app",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    explorer: "",
  },
  devnet: {
    // MagicBlock's devnet RPC: higher limits than api.devnet and allows getProgramAccounts (lobby)
    l1: "https://rpc.magicblock.app/devnet",
    er: "https://devnet-tee.magicblock.app",
    // PnL Royale's devnet test-USDC (6 decimals); the app's /api/faucet mints it to players
    usdc: "THPHkxhRHRJE3oVWMpPqQ82F3TCWVUY5rHUxotjfQre",
    explorer: "?cluster=devnet",
  },
  localnet: {
    l1: "http://127.0.0.1:8899",
    er: "http://127.0.0.1:7799",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    explorer: "?cluster=custom",
  },
};

export const L1_RPC = env("NEXT_PUBLIC_L1_RPC", DEFAULTS[CLUSTER].l1);
/** The Private Ephemeral Rollup (TEE). Fallback A: a public ER such as https://as.magicblock.app */
export const ER_RPC = env("NEXT_PUBLIC_ER_RPC", DEFAULTS[CLUSTER].er).replace(/\/$/, "");
export const ER_WS = env("NEXT_PUBLIC_ER_WS", ER_RPC.replace(/^http/, "ws"));
/** Validator every room and position is delegated to. All writable ER accounts must share it. */
export const ER_VALIDATOR = new PublicKey(
  env("NEXT_PUBLIC_ER_VALIDATOR", "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
);
export const IS_TEE = ER_RPC.includes("tee");
export const IS_DEVNET = CLUSTER !== "mainnet";
export const USDC_MINT = new PublicKey(env("NEXT_PUBLIC_USDC_MINT", DEFAULTS[CLUSTER].usdc));
export const USDC_DECIMALS = 6;
export const PROGRAM_ID = new PublicKey(env("NEXT_PUBLIC_PROGRAM_ID", (idl as { address: string }).address));
export const EXPLORER_SUFFIX = DEFAULTS[CLUSTER].explorer;
/** L1 priority fee (micro-lamports per CU). Mainnet only by default; ER transactions are free. */
export const PRIORITY_MICROLAMPORTS = Number(env("NEXT_PUBLIC_PRIORITY_MICROLAMPORTS", CLUSTER === "mainnet" ? "50000" : "0"));

export const SESSION_KEYS_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
export const ORACLE_PROGRAM_ID = new PublicKey("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");

export const SEEDS = {
  config: Buffer.from("cfg"),
  room: Buffer.from("room"),
  position: Buffer.from("pos"),
  vault: Buffer.from("vault"),
  rating: Buffer.from("elo"),
  identity: Buffer.from("identity"),
};

// Game constants (mirror programs/royale/src/constants.rs)
export const STARTING_CHIPS = 10_000_000_000n;
export const CHIP_DECIMALS = 6;
export const MIN_SEATS = 4;
export const MAX_SEATS = 16;
export const CHECKPOINTS = 5;
export const FINAL_CHECKPOINT = 6;
export const MIN_HOLD_SECS = 2;
export const FLIP_COST_BPS = 5;
export const BLEED_BPS_PER_MIN = 100;
export const LEVERAGES = [1, 2, 5, 10] as const;
export const SURGE_LEVERAGE = 25;
export const FREEZE_SECS = 30;
export const BEGIN_TIMEOUT_SECS = 300;

export type Feed = { id: number; symbol: string; pda: PublicKey; exponent: number; emoji: string };

/** Pinned Pyth Lazer feeds republished on the ER by MagicBlock's pricing oracle. */
export const FEEDS: Feed[] = [
  { id: 6, symbol: "SOL", pda: new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"), exponent: -8, emoji: "◎" },
  { id: 1, symbol: "BTC", pda: new PublicKey("71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr"), exponent: -8, emoji: "₿" },
  { id: 2, symbol: "ETH", pda: new PublicKey("5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG"), exponent: -8, emoji: "Ξ" },
  { id: 9, symbol: "BONK", pda: new PublicKey("4WWpu2fva3uZjmZS95fezYFfoydmYi3PU7ApnqG9cYss"), exponent: -10, emoji: "🐕" },
  { id: 10, symbol: "WIF", pda: new PublicKey("Cy6KSY9DCcJ5HiKL3H4ir6XiSC1PczCCJj7LEe9Y8A7x"), exponent: -8, emoji: "🧢" },
  { id: 182, symbol: "FARTCOIN", pda: new PublicKey("CVFcoSKcJZGMDv9xJWNERXxHjs7KcT3RYBPLCHdG2Jok"), exponent: -8, emoji: "💨" },
  { id: 130, symbol: "POPCAT", pda: new PublicKey("AuiyyRtjbTfrnoALr48n8yzXTNYN96Q2Rrh9bBirLHdc"), exponent: -8, emoji: "🐱" },
  { id: 110, symbol: "HYPE", pda: new PublicKey("CxEkVoCUwSAprvAhdWRPH63JeioQVNDtyZYEMRXuLu6x"), exponent: -8, emoji: "🌊" },
];

export const feedById = (id: number): Feed | undefined => FEEDS.find((f) => f.id === id);

export enum RoomStatus {
  Open = 0,
  Starting = 1,
  Live = 2,
  Ended = 3,
  Settled = 4,
  Cancelled = 5,
}

export enum StormKind {
  None = 0,
  Spotlight = 1,
  Surge = 2,
  Freeze = 3,
  ZoneShrink = 4,
}

export const STORM_COPY: Record<StormKind, { title: string; blurb: (asset: string, side: string) => string }> = {
  [StormKind.None]: { title: "Calm", blurb: () => "No storm this minute." },
  [StormKind.Spotlight]: { title: "Spotlight", blurb: (a) => `${a} pays 2× PnL this minute.` },
  [StormKind.Surge]: { title: "Leverage Surge", blurb: () => "25× unlocked this minute." },
  [StormKind.Freeze]: { title: "Freeze", blurb: (_a, s) => `No new ${s} positions for 30 s.` },
  [StormKind.ZoneShrink]: { title: "Zone Shrink", blurb: () => "Flat equity bleeds 2× this minute." },
};

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${EXPLORER_SUFFIX}`;
export const explorerAccount = (a: string) => `https://solscan.io/account/${a}${EXPLORER_SUFFIX}`;
/** ER transactions open in the Solana explorer pointed at the ER RPC (needs a token on the TEE). */
export const erExplorerTx = (sig: string, token?: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(
    token ? `${ER_RPC}?token=${token}` : ER_RPC,
  )}`;
