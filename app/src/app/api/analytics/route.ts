// GET /api/analytics?network=mainnet|devnet: one network's numbers, read from chain.
import { NextResponse } from "next/server";
import { readableError } from "@/lib/royale/er";
import { analytics, type Network } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const net = new URL(req.url).searchParams.get("network");
  if (net !== "mainnet" && net !== "devnet") return NextResponse.json({ error: "network must be mainnet or devnet" }, { status: 400 });
  try {
    return NextResponse.json(await analytics(net as Network), { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    return NextResponse.json({ error: readableError(e) }, { status: 502 });
  }
}
