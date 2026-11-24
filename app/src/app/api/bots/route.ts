// Devnet house bots. GET lists them (so the UI can label them); POST { room } seats them, trades for
// them or wraps up, whichever the room's onchain state calls for. Never on mainnet.
import { NextResponse } from "next/server";
import { CLUSTER } from "@/lib/royale/constants";
import { readableError } from "@/lib/royale/er";
import { driveBots, houseBots } from "@/lib/server/bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_GAP_MS = 2_000;
const last = new Map<string, number>();

export async function GET() {
  return NextResponse.json({ bots: houseBots().map((b) => ({ address: b.kp.publicKey.toBase58(), name: b.name })) });
}

export async function POST(req: Request) {
  if (CLUSTER === "mainnet") return NextResponse.json({ error: "bots are devnet-only" }, { status: 403 });
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
