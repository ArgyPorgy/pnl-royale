// Smoke test T4 (+ part of T5): reach the TEE, verify attestation, get an auth token with a
// throwaway key, and read live oracle feeds through the authenticated connection. Read-only.
import { Keypair } from "@solana/web3.js";
import { connectEr } from "../app/src/lib/royale/er";
import { decodeFeed, priceToNumber } from "../app/src/lib/royale/client";
import { ER_RPC, FEEDS } from "../app/src/lib/royale/constants";

const main = async () => {
  const kp = Keypair.generate();
  const t0 = Date.now();
  const link = await connectEr(kp);
  console.log(`ER ${ER_RPC}: attested=${link.attested} token=${link.token ? link.token.slice(0, 12) + "…" : "n/a"} expiresAt=${new Date(link.expiresAt * 1000).toISOString()} (${Date.now() - t0} ms)`);
  const infos = await link.connection.getMultipleAccountsInfo(FEEDS.map((f) => f.pda));
  const now = Date.now() / 1000;
  for (const [i, f] of FEEDS.entries()) {
    const d = infos[i] ? decodeFeed(infos[i]!.data as Buffer) : null;
    console.log(`${f.symbol.padEnd(9)} ${d ? priceToNumber(d.price, f.exponent).toPrecision(8).padStart(14) : "missing".padStart(14)}  age ${d ? (now - d.publishTime).toFixed(1) : "-"}s  owner ${infos[i]?.owner.toBase58().slice(0, 8)}`);
  }
  const slot = await link.connection.getSlot();
  console.log("ER slot", slot);
};
main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
