"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { ixCreateRoom, newRoomId, withPriority } from "@/lib/royale/client";
import { FEEDS, IS_DEVNET, IS_TEE, RoomStatus, USDC_DECIMALS } from "@/lib/royale/constants";
import { PlayInstantly } from "@/components/PlayInstantly";
import { readableError, requestFaucet } from "@/lib/royale/er";
import { fmtUsdc, finalistsFor } from "@/lib/royale/game";
import { useRooms } from "@/hooks/useRooms";

export default function Lobby() {
  const { rooms, error } = useRooms();
  const open = rooms.filter((r) => r.status === RoomStatus.Open);
  const live = rooms.filter((r) => r.delegated || r.status === RoomStatus.Live || r.status === RoomStatus.Starting);
  const done = rooms.filter((r) => !r.delegated && (r.status === RoomStatus.Ended || r.status === RoomStatus.Settled)).slice(0, 8);
  return (
    <div className="space-y-8">
      <section className="rise pt-6 text-center">
        <div className="chip mx-auto inline-block text-tee">
          Solana {IS_DEVNET ? "devnet" : "mainnet"} · MagicBlock {IS_TEE ? "Private ER (TEE)" : "Ephemeral Rollup"}
        </div>
        <h1 className="mt-4 text-4xl font-black leading-tight sm:text-6xl">
          Battle royale <span className="text-gold">for traders.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-dim">
          Up to 16 players stake USDC and trade live prices with <b className="text-white">hidden positions</b>. Every minute the
          lowest equity is cut by an onchain crank. VRF storms flip the rules. The last traders standing split the pot.
          Every tap is a gasless onchain transaction, with no wallet popups.
        </p>
        {IS_DEVNET && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <PlayInstantly className="px-6 py-3 text-base" />
            <span className="text-xs text-dim">Live on devnet: free test USDC, no extension needed. Phantom/Backpack (devnet) work too.</span>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-dim">Open rooms</h2>
          {error && <div className="card p-3 text-xs text-gold">{error}</div>}
          {open.length === 0 && <div className="card p-6 text-center text-dim">No open rooms. Create one →</div>}
          {open.map((r) => (
            <RoomRow key={r.address.toBase58()} r={r} />
          ))}
          {live.length > 0 && <h2 className="pt-4 text-sm font-bold uppercase tracking-widest text-dim">Live now</h2>}
          {live.map((r) => (
            <RoomRow key={r.address.toBase58()} r={r} live />
          ))}
          {done.length > 0 && <h2 className="pt-4 text-sm font-bold uppercase tracking-widest text-dim">Recent results</h2>}
          {done.map((r) => (
            <RoomRow key={r.address.toBase58()} r={r} />
          ))}
        </section>
        <CreateRoom />
      </div>

      <HowItWorks />
    </div>
  );
}

function RoomRow({ r, live }: { r: ReturnType<typeof useRooms>["rooms"][number]; live?: boolean }) {
  const syms = r.assets.map((id) => FEEDS.find((f) => f.id === id)?.symbol).join(" · ");
  return (
    <Link href={`/room/${r.roomId}`} className="card flex items-center justify-between gap-3 p-4 transition hover:border-white/30">
      <div>
        <div className="font-bold">
          {fmtUsdc(r.entryAmount)} USDC · {syms}{" "}
          {live && <span className="chip ml-1 text-short">● LIVE</span>}
          {r.private && <span className="chip ml-1 text-tee">sealed</span>}
        </div>
        <div className="text-xs text-dim">
          #{r.roomId.toString().slice(-6)} · {r.intervalSecs}s cuts · top {finalistsFor(Math.max(r.seatsFilled, 4))} paid
        </div>
      </div>
      <div className="text-right">
        <div className="tabular text-xl font-black">
          {r.seatsFilled}/{r.maxSeats}
        </div>
        <div className="text-xs text-dim">pot {fmtUsdc(r.entryAmount * BigInt(r.seatsFilled))}</div>
      </div>
    </Link>
  );
}

function CreateRoom() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const router = useRouter();
  const [entry, setEntry] = useState("1");
  const [seats, setSeats] = useState(8);
  const [assets, setAssets] = useState<number[]>([6, 9]);
  const [interval, setIntervalSecs] = useState(60);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (id: number) =>
    setAssets((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length < 3 ? [...a, id] : a));

  const create = async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return setVisible(true);
    setBusy(true);
    setMsg(null);
    try {
      if (IS_DEVNET && (await connection.getBalance(wallet.publicKey)) < 15_000_000) {
        setMsg("Topping up your wallet with devnet SOL…");
        await requestFaucet(wallet.publicKey).catch(() => undefined);
        setMsg(null);
      }
      const roomId = newRoomId();
      const ix = await ixCreateRoom(wallet.publicKey, {
        roomId,
        entryAmount: BigInt(Math.round(parseFloat(entry) * 10 ** USDC_DECIMALS)),
        maxSeats: seats,
        assets,
        fillSecs: 600,
        intervalSecs: interval,
        private: IS_TEE,
      });
      const tx = new Transaction().add(...withPriority([ix], 100_000));
      tx.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      router.push(`/room/${roomId}`);
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card h-fit space-y-4 p-5">
      <h2 className="text-lg font-black">Create a room</h2>
      <label className="block text-sm">
        <span className="text-dim">Entry (USDC)</span>
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded-xl border border-line bg-panel2 px-3 py-2 font-mono"
        />
      </label>
      <div className="text-sm">
        <span className="text-dim">Seats: {seats}</span>
        <input type="range" min={4} max={16} value={seats} onChange={(e) => setSeats(+e.target.value)} className="w-full accent-[#ffc940]" />
      </div>
      <div className="text-sm">
        <span className="text-dim">Assets (1–3)</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {FEEDS.map((f) => (
            <button
              key={f.id}
              onClick={() => toggle(f.id)}
              className={`chip ${assets.includes(f.id) ? "border-gold text-gold" : "text-dim"}`}
            >
              {f.emoji} {f.symbol}
            </button>
          ))}
        </div>
      </div>
      <div className="text-sm">
        <span className="text-dim">Cut every</span>
        <div className="mt-1 flex gap-2">
          {[30, 60, 90].map((s) => (
            <button key={s} onClick={() => setIntervalSecs(s)} className={`chip ${interval === s ? "border-gold text-gold" : "text-dim"}`}>
              {s}s
            </button>
          ))}
        </div>
      </div>
      {!wallet.publicKey && <PlayInstantly className="w-full py-3" />}
      <button
        disabled={busy || assets.length === 0}
        onClick={create}
        className={`btn w-full py-3 ${wallet.publicKey ? "bg-gold text-ink" : "border border-line text-dim"}`}
      >
        {wallet.publicKey ? "Create room" : "Connect a wallet"}
      </button>
      {msg && <div className="text-xs text-short">{msg}</div>}
      <p className="text-xs text-dim">
        Entries sit in an L1 escrow PDA that's never delegated. Only settle (winners) or refund (room never filled) can move it.
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["Stake on Solana", "join_room escrows USDC in an L1 vault PDA and delegates your Position to MagicBlock's TEE validator, all in one popup."],
    ["Trade sealed in the TEE", "Your browser session key signs set_position: a free ER transaction priced by Pyth Lazer feeds on the ER. Positions carry an owner-only permission, so rivals' reads come back empty."],
    ["Crank referee", "begin_round schedules an onchain crank. tick() is permissionless, time-gated and idempotent: it marks every position to market and cuts the lowest equity each interval."],
    ["VRF storms", "A second crank requests MagicBlock VRF each minute; an authenticated callback sets Spotlight, Surge, Freeze or Zone Shrink, and seeds the tie-break hash."],
    ["Settle on L1", "The room and positions commit and undelegate back to Solana, where every trade becomes public. settle() pays the finalists in USDC from escrow, and rate_room() updates Elo."],
  ];
  return (
    <section className="card p-6">
      <h2 className="text-lg font-black">How it works</h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-5">
        {steps.map(([t, d], i) => (
          <li key={t} className="rounded-xl bg-panel2 p-4">
            <div className="text-xs font-bold text-gold">0{i + 1}</div>
            <div className="mt-1 font-bold">{t}</div>
            <p className="mt-1 text-xs leading-relaxed text-dim">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
