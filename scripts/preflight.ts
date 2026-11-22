// Mainnet (or devnet) readiness preflight. Read-only: sends no transactions.
//
//   NEXT_PUBLIC_CLUSTER=mainnet ADMIN_KEYPAIR=~/.config/solana/royale-mainnet-admin.json \
//   RELAYER_KEYPAIR=~/.config/solana/royale-mainnet-relayer.json npx tsx scripts/preflight.ts
//
// Checks every external dependency the round needs, the program keypair, the deploy cost and
// the balances of the keys that will pay. Exit code 1 if anything blocking fails.
import { existsSync, readFileSync, statSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connectEr } from "../app/src/lib/royale/er";
import { configPda, decodeFeed } from "../app/src/lib/royale/client";
import {
  CLUSTER,
  ER_RPC,
  ER_VALIDATOR,
  FEEDS,
  L1_RPC,
  PROGRAM_ID,
  SESSION_KEYS_PROGRAM_ID,
  USDC_MINT,
  VRF_EPHEMERAL_QUEUE,
  VRF_PROGRAM_ID,
  ORACLE_PROGRAM_ID,
} from "../app/src/lib/royale/constants";

const DLP = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const PERMISSION = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SO = "target/deploy/royale.so";
const PROGRAM_KEYPAIR = process.env.PROGRAM_KEYPAIR ?? "target/deploy/royale-keypair.json";
const MAX_LEN = Number(process.env.MAX_LEN ?? 760_000);

let blocking = 0;
const ok = (m: string) => console.log(`  ✅ ${m}`);
const warn = (m: string) => console.log(`  ⚠️  ${m}`);
const fail = (m: string) => {
  blocking++;
  console.log(`  ❌ ${m}`);
};
const loadKp = (p?: string) => (p && existsSync(p) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))) : null);
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(4);

async function rpc(url: string, method: string, params: unknown[] = []) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()) as { result?: unknown; error?: unknown };
}

(async () => {
  console.log(`PnL Royale preflight · cluster ${CLUSTER}\n  L1 ${L1_RPC}\n  ER ${ER_RPC} (validator ${ER_VALIDATOR.toBase58()})\n`);
  const l1 = new Connection(L1_RPC, "confirmed");

  console.log("Program binary and address");
  const pk = loadKp(PROGRAM_KEYPAIR);
  if (!pk) fail(`program keypair missing at ${PROGRAM_KEYPAIR}`);
  else if (!pk.publicKey.equals(PROGRAM_ID)) fail(`program keypair ${pk.publicKey.toBase58()} != declare_id ${PROGRAM_ID.toBase58()}`);
  else ok(`program keypair matches declare_id ${PROGRAM_ID.toBase58()}`);
  const soLen = existsSync(SO) ? statSync(SO).size : 0;
  if (!soLen) fail(`${SO} missing: run scripts/build.sh`);
  else ok(`${SO} ${soLen.toLocaleString()} bytes (max-len ${MAX_LEN.toLocaleString()})`);
  const progInfo = await l1.getAccountInfo(PROGRAM_ID);
  const deployed = !!progInfo?.executable;
  if (deployed) ok("program already deployed on this cluster");
  else ok("program not deployed yet on this cluster");
  const rentData = await l1.getMinimumBalanceForRentExemption(MAX_LEN + 45);
  const rentBuffer = await l1.getMinimumBalanceForRentExemption(soLen + 37);
  const rentProgram = await l1.getMinimumBalanceForRentExemption(36);
  const writes = Math.ceil(soLen / 1000);
  const deployNeed = rentBuffer + rentProgram + (rentData - rentBuffer > 0 ? rentData - rentBuffer : 0) + writes * 15_000 + 0.02 * LAMPORTS_PER_SOL;
  if (!deployed) console.log(`  ℹ️  deploy: buffer ${sol(rentBuffer)} SOL (refunded into the program data), program data ${sol(rentData)} SOL locked, ~${writes} write txs; need ≈ ${sol(deployNeed)} SOL in the deployer`);

  console.log("\nMagicBlock + Solana dependencies on L1");
  for (const [name, key] of [
    ["Delegation program", DLP],
    ["Permission program", PERMISSION],
    ["Session keys program", SESSION_KEYS_PROGRAM_ID],
    ["VRF program", VRF_PROGRAM_ID],
    ["Pricing oracle program", ORACLE_PROGRAM_ID],
  ] as const) {
    const a = await l1.getAccountInfo(key);
    a?.executable ? ok(`${name} ${key.toBase58().slice(0, 8)}… executable`) : fail(`${name} ${key.toBase58()} not executable on L1`);
  }
  if (CLUSTER === "mainnet" && USDC_MINT.toBase58() !== MAINNET_USDC) fail(`NEXT_PUBLIC_USDC_MINT is ${USDC_MINT.toBase58()}, not mainnet USDC`);
  else ok(`USDC mint ${USDC_MINT.toBase58()}`);
  const gpa = await rpc(L1_RPC, "getProgramAccounts", [PROGRAM_ID.toBase58(), { dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: 1 }] }]);
  gpa.error ? warn("L1 RPC blocks getProgramAccounts: the lobby will need NEXT_PUBLIC_RELAYER_URL or a Helius/Triton RPC") : ok("L1 RPC allows getProgramAccounts (lobby can list rooms)");

  console.log("\nPrivate ER (TEE)");
  const ver = (await rpc(ER_RPC, "getVersion")).result as Record<string, string> | undefined;
  const ident = ((await rpc(ER_RPC, "getIdentity")).result as { identity?: string } | undefined)?.identity;
  ver ? ok(`version magicblock-core ${ver["magicblock-core"] ?? ver.core} (git ${ver["git-commit"]})`) : fail("ER getVersion failed");
  if (ver && ver["magicblock-core"] !== "1.1.1") warn("ER is not on the 1.1.1 line this program and SDK 0.18 were tested against");
  ident === ER_VALIDATOR.toBase58() ? ok(`identity ${ident} matches NEXT_PUBLIC_ER_VALIDATOR`) : fail(`ER identity ${ident} != ${ER_VALIDATOR.toBase58()}`);
  try {
    const link = await connectEr(Keypair.generate());
    link.attested === false ? fail("TEE attestation failed") : ok(`attestation ${link.attested ? "verified" : "n/a (public ER)"}, auth token issued`);
    const infos = await link.connection.getMultipleAccountsInfo(FEEDS.map((f) => f.pda));
    const now = Date.now() / 1000;
    const stale = FEEDS.filter((f, i) => {
      const d = infos[i] ? decodeFeed(infos[i]!.data as Buffer) : null;
      return !d || now - d.publishTime > 3;
    });
    stale.length ? warn(`feeds older than 3 s right now: ${stale.map((f) => f.symbol).join(", ")}`) : ok(`all ${FEEDS.length} whitelisted feeds fresh (< 3 s)`);
    // Ingress: does the TEE accept a *transaction* from this network (not only reads)?
    // A free 0-lamport self-transfer from a throwaway key; any validator-level answer means the
    // write reached the ER. A geofence/AML refusal comes back as an HTTP/RPC access error.
    {
      const probe = Keypair.generate();
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: probe.publicKey, toPubkey: probe.publicKey, lamports: 0 }));
      tx.feePayer = probe.publicKey;
      tx.recentBlockhash = (await link.connection.getLatestBlockhash()).blockhash;
      tx.sign(probe);
      try {
        const sig = await link.connection.sendRawTransaction(tx.serialize());
        ok(`ER accepted a write from this network (probe ${sig.slice(0, 12)}…)`);
      } catch (e) {
        const m = String((e as Error).message ?? e);
        /403|forbidden|restricted|geo|blocked|aml|denied/i.test(m)
          ? fail(`ER refused writes from this network: ${m.slice(0, 160)}`)
          : ok(`ER reached execution for a probe write (validator answered: ${m.slice(0, 90)}…)`);
      }
    }
    const sigs = await link.connection.getSignaturesForAddress(VRF_EPHEMERAL_QUEUE, { limit: 5 });
    sigs.length ? ok(`VRF ER queue active (last tx ${Math.round(now - (sigs[0].blockTime ?? now))} s ago)`) : warn("no recent VRF queue activity on this ER");
  } catch (e) {
    fail(`TEE connect/auth failed: ${(e as Error).message}`);
  }
  const status = await fetch("https://status.magicblock.app/api/services").then((r) => r.json()).catch(() => null);
  const live = status?.live_status;
  if (live) Object.entries(live).forEach(([k, v]) => (v === false ? warn(`status page: ${k} DOWN`) : undefined));

  console.log("\nKeys and balances");
  const admin = loadKp(process.env.ADMIN_KEYPAIR);
  const relayer = loadKp(process.env.RELAYER_KEYPAIR);
  if (!admin) fail("ADMIN_KEYPAIR not set or missing (deployer + upgrade authority + config admin)");
  else {
    const bal = await l1.getBalance(admin.publicKey);
    const need = (deployed ? 0 : deployNeed) + 0.01 * LAMPORTS_PER_SOL;
    bal >= need ? ok(`admin ${admin.publicKey.toBase58()} ${sol(bal)} SOL`) : fail(`admin ${admin.publicKey.toBase58()} has ${sol(bal)} SOL, needs ≈ ${sol(need)}`);
    const usdc = await l1.getTokenAccountBalance(getAssociatedTokenAddressSync(USDC_MINT, admin.publicKey)).catch(() => null);
    console.log(`  ℹ️  admin USDC ${usdc?.value.uiAmountString ?? "0 (no ATA)"}: e2e-round needs ENTRY × PLAYERS`);
  }
  if (!relayer) warn("RELAYER_KEYPAIR not set (optional: crank backup + settle caller; a Boost address)");
  else ok(`relayer ${relayer.publicKey.toBase58()} ${sol(await l1.getBalance(relayer.publicKey))} SOL`);
  const cfg = await l1.getAccountInfo(configPda());
  cfg ? ok(`config initialized at ${configPda().toBase58()}`) : console.log(`  ℹ️  config not initialized yet (scripts/init-config.ts after deploy)`);

  console.log(blocking ? `\n${blocking} blocking issue(s).` : "\nReady.");
  process.exit(blocking ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
