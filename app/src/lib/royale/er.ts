// Ephemeral Rollup (TEE) connectivity: attestation check, auth token, transaction sending.
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getAuthToken, verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { ER_RPC, ER_WS, IS_TEE } from "./constants";

export type ErLink = { connection: Connection; token: string | null; expiresAt: number; attested: boolean | null };

/** Verify the TEE's attestation report (once per page load). */
let attestation: Promise<boolean> | null = null;
export function verifyTee(): Promise<boolean> {
  if (!IS_TEE) return Promise.resolve(false);
  if (!attestation) {
    attestation = verifyTeeRpcIntegrity(ER_RPC)
      .then(() => true)
      .catch((e) => {
        console.warn("TEE attestation check failed", e);
        return false;
      });
  }
  return attestation;
}

const keypairSigner = (kp: Keypair) => async (msg: Uint8Array) => nacl.sign.detached(msg, kp.secretKey);

/**
 * Connect to the ER. On the TEE every RPC call needs a token bound to a pubkey; the token's
 * pubkey decides what private accounts the caller may read. We sign with the browser session
 * key (a permission member of the player's position) so no wallet popup is needed.
 */
export async function connectEr(
  signer: { publicKey: PublicKey; signMessage: (m: Uint8Array) => Promise<Uint8Array> } | Keypair,
): Promise<ErLink> {
  if (!IS_TEE) {
    return { connection: new Connection(ER_RPC, { wsEndpoint: ER_WS, commitment: "confirmed" }), token: null, expiresAt: Infinity, attested: null };
  }
  const s = signer instanceof Keypair ? { publicKey: signer.publicKey, signMessage: keypairSigner(signer) } : signer;
  const attested = await verifyTee();
  const auth = await getAuthToken(ER_RPC, s.publicKey, s.signMessage);
  const token = auth.token;
  // The SDK returns milliseconds; normalise to unix seconds.
  const expiresAt = auth.expiresAt > 1e12 ? Math.floor(auth.expiresAt / 1000) : auth.expiresAt;
  const connection = new Connection(`${ER_RPC}?token=${token}`, {
    wsEndpoint: `${ER_WS}?token=${token}`,
    commitment: "confirmed",
  });
  return { connection, token, expiresAt, attested };
}

/** Send instructions to the ER signed by local keypairs (session key / relayer). Gasless. */
export async function sendEr(connection: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  // Keep preflight on: on the ER, skipPreflight only hides execution errors.
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`ER tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

/** Extract a readable program error from a web3.js SendTransactionError. */
export function readableError(e: unknown): string {
  const anyE = e as { logs?: string[]; message?: string; transactionMessage?: string };
  const logs = anyE?.logs ?? [];
  const anchor = logs.find((l) => l.includes("Error Message:"));
  if (anchor) return anchor.split("Error Message:")[1].trim();
  const msg = anyE?.transactionMessage ?? anyE?.message ?? String(e);
  return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
}

/** Devnet: ask the app's faucet for devnet SOL + test USDC, then wait until the balances land. */
export async function requestFaucet(wallet: PublicKey): Promise<void> {
  const r = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58() }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? `faucet error ${r.status}`);
}
