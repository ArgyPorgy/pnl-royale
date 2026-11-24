// Devnet faucet: tops a player up with devnet SOL (rent + fees) and PnL Royale test-USDC so they
// can join a room. Server-only key (FAUCET_SECRET_KEY = test-USDC mint authority). Never on mainnet.
import { NextResponse } from "next/server";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { CLUSTER, L1_RPC, USDC_MINT } from "@/lib/royale/constants";
import { sendAndConfirm } from "@/lib/royale/l1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOL_TARGET = 0.03 * LAMPORTS_PER_SOL; // enough to create/join/start rooms a few times
const USDC_GRANT = 10_000_000n; // 10 test-USDC
const USDC_MIN = 5_000_000n;
const COOLDOWN_MS = 10 * 60_000;
const recent = new Map<string, number>();

function faucetKey(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (CLUSTER === "mainnet") return NextResponse.json({ error: "faucet is devnet-only" }, { status: 403 });
  const faucet = faucetKey();
  if (!faucet) return NextResponse.json({ error: "faucet not configured (FAUCET_SECRET_KEY)" }, { status: 503 });
  let wallet: PublicKey;
  try {
    const body = (await req.json()) as { wallet?: string };
    wallet = new PublicKey(String(body.wallet));
  } catch {
    return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  for (const k of [wallet.toBase58(), `ip:${ip}`]) {
    if (now - (recent.get(k) ?? 0) < COOLDOWN_MS && !(k.startsWith("ip:") && ip === "local")) {
      return NextResponse.json({ error: "faucet cooldown: try again in a few minutes" }, { status: 429 });
    }
  }

  const l1 = new Connection(L1_RPC, "confirmed");
  const ata = getAssociatedTokenAddressSync(USDC_MINT, wallet);
  const [lamports, bal] = await Promise.all([
    l1.getBalance(wallet),
    l1.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n),
  ]);
  const tx = new Transaction();
  if (lamports < SOL_TARGET) tx.add(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: wallet, lamports: SOL_TARGET - lamports }));
  if (bal < USDC_MIN) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, wallet, USDC_MINT));
    tx.add(createMintToCheckedInstruction(USDC_MINT, ata, faucet.publicKey, USDC_GRANT, 6));
  }
  if (tx.instructions.length === 0) return NextResponse.json({ ok: true, note: "already funded" });
  try {
    const { blockhash, lastValidBlockHeight } = await l1.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = faucet.publicKey;
    tx.sign(faucet);
    const sig = await sendAndConfirm(l1, tx, lastValidBlockHeight);
    recent.set(wallet.toBase58(), now);
    recent.set(`ip:${ip}`, now);
    return NextResponse.json({ ok: true, sig });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.slice(0, 200) ?? "faucet tx failed" }, { status: 500 });
  }
}
