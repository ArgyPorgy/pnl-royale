// House bots. GET lists them (so the UI can label them) and their limits; GET ?pool=1 adds the pool's
// balances and what to top up. POST { room } seats them, trades for them, or finishes a round its
// players have left (late cuts, commit, payout), whichever the room's onchain state calls for.
// Off unless a pool key is set (BOT_POOL_SECRET_KEY; devnet falls back to the faucet key).
import { NextResponse } from "next/server";
import { readableError } from "@/lib/royale/er";
import { LIMITS, driveBots, houseBots, poolStatus } from "@/lib/server/bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_GAP_MS = 2_000;
const last = new Map<string, number>();

export async function GET(req: Request) {
  const bots = houseBots().map((b) => ({ address: b.kp.publicKey.toBase58(), name: b.name }));
  const body: Record<string, unknown> = { bots, limits: LIMITS };
  if (new URL(req.url).searchParams.has("pool")) {
    try {
      body.pool = await poolStatus();
    } catch (e) {
      body.poolError = readableError(e);
    }
  }
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  let id: bigint;
  try {
    const body = (await req.json()) as { room?: string };
    if (!/^\d{1,20}$/.test(String(body.room))) throw new Error();
    id = BigInt(String(body.room));
    if (id >= 1n << 64n) throw new Error();
  } catch {
    return NextResponse.json({ error: "bad room" }, { status: 400 });
  }
  const k = id.toString();
  const now = Date.now();
  if (now - (last.get(k) ?? 0) < MIN_GAP_MS) return NextResponse.json({ skipped: true });
  if (last.size > 500) last.clear();
  last.set(k, now);
  try {
    return NextResponse.json(await driveBots(id));
  } catch (e) {
    const error = readableError(e);
    return NextResponse.json({ error }, { status: error.includes("not configured") ? 503 : error === "room not found" ? 404 : 500 });
  }
}
