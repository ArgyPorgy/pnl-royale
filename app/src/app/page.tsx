"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import {
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  Dices,
  Lock,
  Plus,
  Timer,
  Trophy,
  Wallet,
} from "lucide-react";
import { ixCreateRoom, newRoomId, withPriority } from "@/lib/royale/client";
import { FEEDS, IS_DEVNET, IS_TEE, RoomStatus, USDC_DECIMALS, feedById } from "@/lib/royale/constants";
import { readableError, requestFaucet } from "@/lib/royale/er";
import { finalistsFor, fmtPrice, fmtUsdc } from "@/lib/royale/game";
import { useRooms } from "@/hooks/useRooms";
import { useEr } from "@/hooks/useEr";
import { useMarket } from "@/hooks/useMarket";
import { HeroArt } from "@/components/HeroArt";
import { PlayInstantly } from "@/components/PlayInstantly";
import { TokenIcon, TokenStack } from "@/components/brand";
import { Button, Card, Pill, Segmented, cx } from "@/components/ui";

type Tab = "open" | "live" | "done";

export default function Lobby() {
  const { publicKey } = useWallet();
  const createRef = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-14">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="fade-up">
          <Pill tone="accent">
            Live on Solana {IS_DEVNET ? "devnet" : "mainnet"} · MagicBlock {IS_TEE ? "Private Ephemeral Rollup" : "Ephemeral Rollup"}
          </Pill>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[56px]">
            The battle royale
            <br />
            for traders.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            Stake USDC, trade live markets with positions sealed inside a trusted execution environment, and outlast
            the field. An onchain crank eliminates the lowest equity every interval. The finalists split the pot.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {publicKey ? (
              <a href="#rooms">
                <Button variant="primary" size="lg">
                  Find a room <ArrowRight size={16} />
                </Button>
              </a>
            ) : (
              <PlayInstantly size="lg" label="Play now" />
            )}
            <Button variant="secondary" size="lg" onClick={() => createRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              <Plus size={16} /> Create a room
            </Button>
          </div>
          {IS_DEVNET && !publicKey && (
            <p className="mt-3 text-xs text-faint">No extension needed: a devnet wallet and test USDC are created for you. Phantom and Backpack work too.</p>
          )}
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {[
              [Lock, "Sealed positions", "Only you can read yours"],
              [Timer, "Onchain cuts", "Crank-run eliminations"],
              [Dices, "VRF storms", "Provably random rules"],
              [CircleDollarSign, "USDC payouts", "Settled on Solana"],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Lock;
              return (
                <div key={t as string}>
                  <I size={18} className="text-[#a99fff]" strokeWidth={1.75} />
                  <dt className="mt-2 text-sm font-medium text-fg">{t as string}</dt>
                  <dd className="mt-0.5 text-xs text-faint">{d as string}</dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="fade-up [animation-delay:80ms]">
          <HeroArt />
        </div>
      </section>

      <MarketStrip />

      <section id="rooms" className="grid scroll-mt-20 items-start gap-6 lg:grid-cols-[1fr_380px]">
        <RoomsTable />
        <div ref={createRef}>
          <CreateRoom />
        </div>
      </section>

      <HowItWorks />
    </div>
  );
}

function MarketStrip() {
  const { er } = useEr(null);
  const quotes = useMarket(er);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg">Markets</h2>
        <span className="text-xs text-faint">Pyth Lazer prices, read live from the MagicBlock oracle on the rollup</span>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:grid-cols-4 lg:grid-cols-8">
        {FEEDS.map((f) => {
          const q = quotes[f.id];
          const dir = q ? Math.sign(q.price - q.prev) : 0;
          return (
            <div key={f.id} className="flex items-center gap-3 bg-surface px-4 py-3">
              <TokenIcon id={f.id} size={26} />
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted">{f.symbol}</div>
                <div className={cx("num truncate text-[13px] transition-colors", dir > 0 ? "text-up" : dir < 0 ? "text-down" : "text-fg")}>
                  {q ? `$${fmtPrice(q.price)}` : <span className="text-faint">loading</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const STATUS: Record<number, { label: string; tone: "up" | "down" | "neutral" | "accent" | "warn" }> = {
  [RoomStatus.Open]: { label: "Open", tone: "up" },
  [RoomStatus.Starting]: { label: "Starting", tone: "warn" },
  [RoomStatus.Live]: { label: "Live", tone: "down" },
  [RoomStatus.Ended]: { label: "Ended", tone: "neutral" },
  [RoomStatus.Settled]: { label: "Paid", tone: "neutral" },
  [RoomStatus.Cancelled]: { label: "Cancelled", tone: "neutral" },
};

function RoomsTable() {
  const { rooms, error } = useRooms();
  const [tab, setTab] = useState<Tab>("open");
  const groups = useMemo(
    () => ({
      open: rooms.filter((r) => !r.delegated && r.status === RoomStatus.Open),
      live: rooms.filter((r) => r.delegated || r.status === RoomStatus.Live || r.status === RoomStatus.Starting),
      done: rooms.filter((r) => !r.delegated && (r.status === RoomStatus.Ended || r.status === RoomStatus.Settled)),
    }),
    [rooms],
  );
  const list = groups[tab];
  return (
    <Card
      title="Rooms"
      bodyClassName="p-0"
      action={
        <Segmented<Tab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: `Open${groups.open.length ? ` ${groups.open.length}` : ""}` },
            { value: "live", label: `Live${groups.live.length ? ` ${groups.live.length}` : ""}` },
            { value: "done", label: "Completed" },
          ]}
        />
      }
    >
      {error && <div className="border-b border-border px-4 py-3 text-xs text-warn">{error}</div>}
      <div className="hidden grid-cols-[1.4fr_1.2fr_0.8fr_1.2fr_0.7fr_0.8fr_28px] gap-3 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-faint md:grid">
        <span>Room</span>
        <span>Markets</span>
        <span>Entry</span>
        <span>Players</span>
        <span>Cuts</span>
        <span>Status</span>
        <span />
      </div>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Trophy size={22} className="text-faint" strokeWidth={1.5} />
          <div className="text-sm text-fg">{tab === "open" ? "No open rooms right now" : tab === "live" ? "No rounds in progress" : "No completed rounds yet"}</div>
          <div className="text-xs text-faint">{tab === "open" ? "Create one and share the link." : "Rooms show up here as they run."}</div>
        </div>
      ) : (
        <ul>
          {list.slice(0, 12).map((r) => {
            const s = STATUS[r.delegated && r.status === RoomStatus.Open ? RoomStatus.Starting : r.status];
            const fill = Math.round((r.seatsFilled / r.maxSeats) * 100);
            return (
              <li key={r.address.toBase58()}>
                <Link
                  href={`/room/${r.roomId}`}
                  className="grid grid-cols-2 items-center gap-3 border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-surface-2 md:grid-cols-[1.4fr_1.2fr_0.8fr_1.2fr_0.7fr_0.8fr_28px]"
                >
                  <div>
                    <div className="font-medium text-fg">Room {r.roomId.toString().slice(-6)}</div>
                    <div className="text-xs text-faint">{r.private ? "Sealed in TEE" : "Public rollup"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TokenStack ids={r.assets} size={20} />
                    <span className="truncate text-xs text-muted">{r.assets.map((id) => feedById(id)?.symbol).join(" · ")}</span>
                  </div>
                  <div className="num text-fg">${fmtUsdc(r.entryAmount)}</div>
                  <div>
                    <div className="num text-xs text-muted">
                      {r.seatsFilled}/{r.maxSeats} · top {finalistsFor(Math.max(r.seatsFilled, 4))} paid
                    </div>
                    <div className="mt-1.5 h-1 w-full max-w-[140px] overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${fill}%` }} />
                    </div>
                  </div>
                  <div className="num text-xs text-muted">{r.intervalSecs}s</div>
                  <div>
                    <Pill tone={s.tone} dot={s.label === "Live"}>
                      {s.label}
                    </Pill>
                  </div>
                  <ChevronRight size={16} className="hidden text-faint md:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
  const toggle = (id: number) => setAssets((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length < 3 ? [...a, id] : a));
  const entryNum = Math.max(0, parseFloat(entry) || 0);
  const pot = entryNum * seats;

  const create = async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return setVisible(true);
    setBusy(true);
    setMsg(null);
    try {
      if (IS_DEVNET && (await connection.getBalance(wallet.publicKey)) < 15_000_000) {
        setMsg("Funding your devnet wallet…");
        await requestFaucet(wallet.publicKey).catch(() => undefined);
        setMsg(null);
      }
      const roomId = newRoomId();
      const ix = await ixCreateRoom(wallet.publicKey, {
        roomId,
        entryAmount: BigInt(Math.round(entryNum * 10 ** USDC_DECIMALS)),
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
    <Card title="Create a room" className="lg:sticky lg:top-20">
      <div className="space-y-5">
        <label className="block">
          <span className="text-xs text-muted">Entry</span>
          <div className="mt-1.5 flex h-10 items-center rounded-[10px] border border-border bg-bg px-3 focus-within:border-border-strong">
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="num w-full bg-transparent text-sm text-fg outline-none"
            />
            <span className="whitespace-nowrap text-xs text-faint">{IS_DEVNET ? "test USDC" : "USDC"}</span>
          </div>
        </label>
        <div>
          <span className="text-xs text-muted">Seats</span>
          <Segmented<number>
            className="mt-1.5 w-full"
            value={seats}
            onChange={setSeats}
            options={[4, 6, 8, 12, 16].map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Markets</span>
            <span className="text-xs text-faint">{assets.length}/3</span>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {FEEDS.map((f) => {
              const on = assets.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggle(f.id)}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-[10px] border py-2.5 text-[11px] font-medium transition-colors",
                    on ? "border-accent/60 bg-accent/10 text-fg" : "border-border text-muted hover:border-border-strong hover:text-fg",
                  )}
                >
                  <TokenIcon id={f.id} size={22} />
                  {f.symbol}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="text-xs text-muted">Elimination every</span>
          <Segmented<number>
            className="mt-1.5 w-full"
            value={interval}
            onChange={setIntervalSecs}
            options={[30, 60, 90].map((n) => ({ value: n, label: `${n}s` }))}
          />
        </div>
        <div className="rounded-[10px] border border-border bg-bg px-3 py-2">
          <div className="flex justify-between py-1 text-xs">
            <span className="text-muted">Pot when full</span>
            <span className="num text-fg">${pot.toFixed(2)}</span>
          </div>
          <div className="flex justify-between py-1 text-xs">
            <span className="text-muted">Paid places</span>
            <span className="num text-fg">Top {finalistsFor(seats)}</span>
          </div>
          <div className="flex justify-between py-1 text-xs">
            <span className="text-muted">Round length</span>
            <span className="num text-fg">{((interval * 6) / 60).toFixed(1)} min</span>
          </div>
        </div>
        <Button variant="primary" size="lg" className="w-full" disabled={busy || assets.length === 0 || entryNum <= 0} onClick={create}>
          {wallet.publicKey ? (busy ? "Creating…" : "Create room") : (
            <>
              <Wallet size={16} /> Connect a wallet
            </>
          )}
        </Button>
        {msg && <div className="text-xs text-down">{msg}</div>}
        <p className="text-xs leading-relaxed text-faint">
          Entries are held in an escrow account on Solana that never leaves the base layer. Only payout to the
          finalists, or a refund if the room never fills, can move them.
        </p>
      </div>
    </Card>
  );
}

function HowItWorks() {
  const steps: [typeof Lock, string, string][] = [
    [Wallet, "Join with one signature", "Your entry is escrowed on Solana and your seat is delegated to MagicBlock's TEE. A session key handles every trade after that."],
    [Lock, "Trade sealed in the TEE", "Go long, short or flat at up to 10x on live Pyth prices. Each trade is a free rollup transaction that only you can read."],
    [Timer, "Survive the cut", "Every interval an onchain crank marks everyone to market and eliminates the lowest equity. Being flat bleeds, so you have to trade."],
    [Trophy, "Get paid on Solana", "Results commit back to Solana, every trade becomes public, and the finalists are paid in USDC straight from escrow."],
  ];
  return (
    <section>
      <h2 className="text-sm font-medium text-fg">How it works</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([Icon, t, d], i) => (
          <div key={t} className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent/12 text-[#a99fff]">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="num text-xs text-faint">0{i + 1}</span>
            </div>
            <div className="mt-4 text-sm font-medium text-fg">{t}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
