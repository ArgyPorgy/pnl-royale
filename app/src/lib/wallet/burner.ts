"use client";
// Devnet-only burner wallet: a keypair kept in localStorage so judges can play with one click,
// no extension. Never offered on mainnet.
import {
  BaseMessageSignerWalletAdapter,
  WalletNotConnectedError,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Keypair, Transaction, VersionedTransaction, type PublicKey, type TransactionVersion } from "@solana/web3.js";
import nacl from "tweetnacl";

export const BurnerWalletName = "Devnet Burner" as WalletName<"Devnet Burner">;
const KEY = "royale.burner.v1";
const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa !== "undefined"
    ? btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#161627"/><path d="M32 10c6 10 14 14 14 26a14 14 0 0 1-28 0c0-6 3-10 6-13 0 6 3 9 6 9-2-8 0-15 2-22z" fill="#ffc940"/></svg>',
      )
    : "");

export class BurnerWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = BurnerWalletName;
  url = "https://github.com/solana-labs/wallet-adapter";
  icon = ICON;
  readonly supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0] as TransactionVersion[]);
  private _kp: Keypair | null = null;

  get publicKey(): PublicKey | null {
    return this._kp?.publicKey ?? null;
  }
  get connecting() {
    return false;
  }
  get readyState() {
    return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  }

  async connect(): Promise<void> {
    let kp: Keypair | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    } catch {
      /* fall through to a fresh key */
    }
    if (!kp) {
      kp = Keypair.generate();
      try {
        localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
      } catch {
        /* private mode: key lives for this tab */
      }
    }
    this._kp = kp;
    this.emit("connect", kp.publicKey);
  }

  async disconnect(): Promise<void> {
    this._kp = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const kp = this._kp;
    if (!kp) throw new WalletNotConnectedError();
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const kp = this._kp;
    if (!kp) throw new WalletNotConnectedError();
    return nacl.sign.detached(message, kp.secretKey);
  }
}
