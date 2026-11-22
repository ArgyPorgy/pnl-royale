// Sanity checks for the TS SDK against the program IDL and a live oracle fixture.
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { ixsJoin, ixCreateSessionV2, roomPda, decodeFeed, priceToNumber, rawCoder as coder, sessionTokenPda } from "../app/src/lib/royale/client";
import { FEEDS } from "../app/src/lib/royale/constants";

const main = async () => {
  const player = Keypair.generate().publicKey;
  const session = Keypair.generate().publicKey;
  const room = roomPda(42n);
  const [join, del] = await ixsJoin(player, room, { viewer: session });
  const decoded = coder.instruction.decode(join.data);
  if (decoded?.name !== "join_room" && decoded?.name !== "joinRoom") throw new Error("join decode " + decoded?.name);
  console.log("join_room ix:", decoded.name, "accounts", join.keys.length, "viewer", (decoded.data as { viewer: PublicKey }).viewer.toBase58() === session.toBase58());
  console.log("delegate_position ix accounts", del.keys.length, "last (validator)", del.keys[del.keys.length - 1].pubkey.toBase58());
  const s = ixCreateSessionV2(player, session, 1_900_000_000, 0);
  console.log("create_session_v2 data", s.data.toString("hex"), "token", sessionTokenPda(session, player).toBase58());
  const b64 = readFileSync(new URL("../tests-magicsvm/fixtures/sol_usd_feed_tee.b64", import.meta.url), "utf8").trim();
  const f = decodeFeed(Buffer.from(b64, "base64"));
  if (!f) throw new Error("feed decode failed");
  console.log("live SOL/USD:", priceToNumber(f.price, FEEDS[0].exponent).toFixed(4), "publish", f.publishTime, "slot", f.postedSlot.toString());
};
main().catch((e) => { console.error(e); process.exit(1); });

// Size check: the one-popup join transaction must fit Solana's 1,232-byte limit with priority fees.
(async () => {
  const { Transaction } = await import("@solana/web3.js");
  const { withPriority, ixsJoin: join2, ixCreateSessionV2: sess2, roomPda: rp } = await import("../app/src/lib/royale/client");
  const player = Keypair.generate();
  const session = Keypair.generate();
  const ixs = await join2(player.publicKey, rp(1n), { viewer: session.publicKey });
  ixs.push(sess2(player.publicKey, session.publicKey, 1_900_000_000, 0));
  const tx = new Transaction().add(...withPriority(ixs));
  tx.feePayer = player.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.sign(player, session);
  const n = tx.serialize().length;
  console.log(`join+delegate+session tx with priority: ${n} bytes (limit 1232) ${n <= 1232 ? "OK" : "TOO BIG"}`);
  if (n > 1232) process.exit(1);
})();
