// Landing transactions on Solana. Validators drop transactions silently, and a single send then waits
// out the whole blockhash, so resend the same signed bytes until it lands or can no longer land.
import { PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

/** Whether `ixs` fit in one legacy transaction signed by `signers` keys (1232 bytes on the wire). */
export function fitsOneTx(ixs: TransactionInstruction[], payer: PublicKey, signers: number): boolean {
  try {
    const tx = new Transaction({ feePayer: payer, blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 }).add(...ixs);
    return tx.serializeMessage().length + 1 + 64 * signers <= 1232;
  } catch {
    return false;
  }
}

const POLL_MS = 600;
/** Resend every this many polls. The signature is the same, so it can only execute once. */
const RESEND_EVERY = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a fully signed transaction and wait for `confirmed`. Throws if it fails or expires. */
export async function sendAndConfirm(connection: Connection, signed: Transaction, lastValidBlockHeight: number): Promise<string> {
  const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw);
  const landed = async () => {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
    return st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
  };
  const seen = () =>
    landed().catch((e: Error) => {
      if (e.message.startsWith("Transaction failed")) throw e;
      return false; // RPC hiccup: ask again
    });
  for (let i = 1; ; i++) {
    await sleep(POLL_MS);
    if (await seen()) return sig;
    if (i % RESEND_EVERY) continue;
    const height = await connection.getBlockHeight("confirmed").catch(() => 0);
    if (height > lastValidBlockHeight) {
      if (await seen()) return sig;
      throw new Error("The network dropped this transaction. Nothing was charged; please try again.");
    }
    connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
}
