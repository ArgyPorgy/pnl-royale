"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { ArrowRight, ChevronRight, CircleDollarSign, Dices, Lock, Plus, Timer, Trophy, Wallet } from "lucide-react";
import { ixCreateRoom, newRoomId, withPriority } from "@/lib/royale/client";
import { FEEDS, IS_DEVNET, IS_TEE, RoomStatus, STORM_COPY, StormKind, USDC_DECIMALS, feedById } from "@/lib/royale/constants";
import { readableError, requestFaucet } from "@/lib/royale/er";
import { finalistsFor, fmtPrice, fmtUsdc } from "@/lib/royale/game";
import { useRooms } from "@/hooks/useRooms";
import { useEr } from "@/hooks/useEr";
import { useMarket } from "@/hooks/useMarket";
import { HeroArt } from "@/components/HeroArt";
import { PlayInstantly } from "@/components/PlayInstantly";
import { PartnerLockup, TokenIcon, TokenStack, UsdcIcon, WALLETS } from "@/components/brand";
import { Button, Card, Pill, Segmented, cx } from "@/components/ui";

type Tab = "open" | "live" | "done";

export default function Lobby() {
  const { publicKey } = useWallet();
  const createRef = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-16 sm:space-y-20">
      <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="fade-up">
          <Pill tone="accent">
            Solana {IS_DEVNET ? "devnet" : "mainnet"} · MagicBlock {IS_TEE ? "private rollup" : "ephemeral rollup"}
          </Pill>
          <h1 className="display mt-5 text-[42px] leading-[0.96] sm:text-[64px]">
            The battle royale
            <span className="mt-1 block italic text-accent">for traders.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted">
            Four to sixteen traders stake USDC, take hidden positions on live prices, and outlast a field that gets smaller every minute. The last traders standing take the pot, paid on Solana.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {publicKey ? (
              <a href="#rooms">
                <Button variant="primary" size="lg">
                  Enter the floor <ArrowRight size={16} />
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
            <p className="mt-3 max-w-md text-xs leading-relaxed text-faint">
              No extension required on devnet. A browser wallet and test USDC are created for you. Phantom, Backpack, and Solflare work too.
            </p>
          )}
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {[
              [Lock, "Sealed positions", "Only you can read yours"],
              [Timer, "Onchain cuts", "A crank eliminates the low"],
              [Dices, "VRF storms", "Rules drawn in public"],
              [CircleDollarSign, "USDC escrow", "Settled on Solana"],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Lock;
              return (
                <div key={t as string}>
                  <I size={18} className="text-accent" strokeWidth={1.75} />
                  <dt className="mt-2 text-sm font-semibold text-fg">{t as string}</dt>
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

      <RuleMarquee />
      <PartnerBand />
      <MarketStrip />

      <section id="rooms" className="scroll-mt-24">
        <SectionHead
          kicker="The floor"
          title="Open a seat, or take one."
          body="Entry sits in a Solana escrow that never moves to the rollup. It pays the finalists, or it refunds everyone if the room never fills."
        />
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <RoomsTable />
          <div ref={createRef}>
            <CreateRoom />
          </div>
        </div>
      </section>

      <HowItWorks />
      <StormShowcase />
      <PayoutBand />
    </div>
  );
}

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <div className="kicker">{kicker}</div>
      <h2 className="display mt-2 text-3xl text-fg sm:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">{body}</p>
    </div>
  );
}

function RuleMarquee() {
  const items = ["Hidden positions", "Cuts every interval", "VRF storms", "Up to 10x, 25x in a surge", "Flat equity bleeds", "USDC pot", "One signature to join", "Gasless trades after that"];
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden rounded-full border border-border bg-surface/70 py-2.5">
      <div className="marquee-track flex w-max gap-8 px-4">
        {row.map((t, i) => (
          <span key={i} className="flex items-center gap-8 text-[12px] font-semibold tracking-[0.14em] text-faint uppercase">
            {t}
            <span className="h-1 w-1 rounded-full bg-accent" />
          </span>
        ))}
      </div>
    </div>
  );
}

function PartnerBand() {
  return (
    <section className="rounded-[22px] border border-border bg-surface px-5 py-6 sm:px-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="kicker">Built with</div>
          <p className="mt-2 max-w-md text-sm text-muted">Solana holds the money. MagicBlock runs the private round. Pyth Lazer prices every fill.</p>
        </div>
        <PartnerLockup />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <span className="text-xs text-faint">Wallets</span>
        {WALLETS.map((w) => (
          <a key={w.name} href={w.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-medium text-muted hover:text-fg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.src} alt="" width={16} height={16} className="h-4 w-4 rounded-sm object-contain" />
            {w.name}
          </a>
        ))}
      </div>
    </section>
  );
}

function MarketStrip() {
  const { er } = useEr(null);
  const quotes = useMarket(er);
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="kicker">Markets</div>
          <h2 className="mt-1 text-sm font-medium text-fg">Eight feeds. The round picks up to three.</h2>
        </div>
        <span className="hidden text-xs text-faint sm:block">Pyth Lazer, read from the rollup oracle</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {FEEDS.map((f) => {
          const q = quotes[f.id];
          const dir = q ? Math.sign(q.price - q.prev) : 0;
          return (
            <div key={f.id} className="rounded-2xl border border-border bg-surface px-3 py-3">
              <div className="flex items-center gap-2">
                <TokenIcon id={f.id} size={22} />
                <span className="text-xs font-semibold text-fg">{f.symbol}</span>
              </div>
              <div className={cx("num mt-2 truncate text-[13px]", dir > 0 ? "text-up" : dir < 0 ? "text-down" : "text-fg")}>
                {q ? `$${fmtPrice(q.price)}` : <span className="skeleton inline-block h-3.5 w-16 align-middle" />}
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
      {error && <div className="border-b border-down/30 bg-down/5 px-4 py-3 text-xs text-down">{error}</div>}
      <div className="hidden grid-cols-[1.2fr_1.3fr_0.8fr_1.3fr_0.6fr_0.7fr_24px] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint md:grid">
        <span>Room</span>
        <span>Markets</span>
        <span>Entry</span>
        <span>Players</span>
        <span>Cuts</span>
        <span>Status</span>
        <span />
      </div>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <Trophy size={20} strokeWidth={1.6} />
          </span>
          <div className="display text-xl text-fg">
            {tab === "open" ? "The floor is clear" : tab === "live" ? "No round in progress" : "No settled rounds yet"}
          </div>
          <div className="max-w-xs text-xs leading-relaxed text-faint">
            {tab === "open" ? "Create a room, set the entry, and send the link. Four seats is enough to start." : "Rooms appear here as soon as they lock and again when they pay out."}
          </div>
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
                  className="grid grid-cols-2 items-center gap-3 border-b border-border px-4 py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-2 md:grid-cols-[1.2fr_1.3fr_0.8fr_1.3fr_0.6fr_0.7fr_24px]"
                >
                  <div>
                    <div className="font-semibold text-fg">Room {r.roomId.toString().slice(-6)}</div>
                    <div className="text-xs text-faint">{r.private ? "Sealed in the TEE" : "Public rollup"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TokenStack ids={r.assets} size={20} />
                    <span className="truncate text-xs text-muted">{r.assets.map((id) => feedById(id)?.symbol).join(" · ")}</span>
                  </div>
                  <div className="num flex items-center gap-1.5 text-fg">
                    <UsdcIcon size={14} />${fmtUsdc(r.entryAmount)}
                  </div>
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
    <Card title="Create a room" className="lg:sticky lg:top-24">
      <div className="space-y-5">
        <label className="block">
          <span className="text-xs font-medium text-muted">Entry</span>
          <div className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border border-border bg-bg px-3 focus-within:border-accent/60">
            <UsdcIcon size={16} />
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
          <span className="text-xs font-medium text-muted">Seats</span>
          <Segmented<number>
            className="mt-1.5 w-full"
            value={seats}
            onChange={setSeats}
            options={[4, 6, 8, 12, 16].map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Markets</span>
            <span className="num text-xs text-faint">{assets.length}/3</span>
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
                    "flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-semibold transition-colors",
                    on ? "border-accent/70 bg-accent/10 text-fg" : "border-border text-muted hover:border-border-strong hover:text-fg",
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
          <span className="text-xs font-medium text-muted">Elimination every</span>
          <Segmented<number>
            className="mt-1.5 w-full"
            value={interval}
            onChange={setIntervalSecs}
            options={[30, 60, 90].map((n) => ({ value: n, label: `${n}s` }))}
          />
        </div>
        <div className="rounded-xl border border-border bg-bg px-3 py-2">
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
          {wallet.publicKey ? (
            busy ? "Creating…" : "Create room"
          ) : (
            <>
              <Wallet size={16} /> Connect a wallet
            </>
          )}
        </Button>
        {msg && <div className="text-xs text-down">{msg}</div>}
        <p className="text-xs leading-relaxed text-faint">
          Entries are held in an escrow account on Solana that never leaves the base layer. Only a payout to the finalists, or a refund if the room never fills, can move them.
        </p>
      </div>
    </Card>
  );
}

function HowItWorks() {
  const steps: [typeof Lock, string, string][] = [
    [Wallet, "One signature", "Your entry is escrowed on Solana and your seat is delegated into the TEE. A session key signs every trade after that."],
    [Lock, "Trade in private", "Long, short, or flat, up to 10x, on live Pyth prices. Each fill is a free rollup transaction only you can read."],
    [Timer, "Survive the cut", "Every interval an onchain crank marks the field and eliminates the lowest equity. Flat positions bleed, so standing still is a choice."],
    [Trophy, "Paid on Solana", "Results commit back to the base layer, every trade becomes public, and finalists are paid in USDC from escrow."],
  ];
  return (
    <section>
      <SectionHead kicker="A round" title="Six intervals. One pot." body="The referee is an onchain crank. Storms come from VRF. Nobody in the room can see your size until the round is over." />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([Icon, t, d], i) => (
          <div key={t} className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="num text-xs text-faint">0{i + 1}</span>
            </div>
            <div className="mt-4 text-sm font-semibold text-fg">{t}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function StormShowcase() {
  const storms = [StormKind.Spotlight, StormKind.Surge, StormKind.Freeze, StormKind.ZoneShrink];
  return (
    <section className="overflow-hidden rounded-[22px] border border-border bg-[linear-gradient(180deg,#16130c_0%,#10141c_42%)]">
      <div className="px-5 py-8 sm:px-8">
        <div className="kicker">Storms</div>
        <h2 className="display mt-2 max-w-xl text-3xl sm:text-4xl">The rules change in public.</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Once an interval, MagicBlock VRF draws a storm. It applies forward only. The callback, the seed, and the proof are onchain.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {storms.map((k) => (
            <div key={k} className="rounded-2xl border border-accent/20 bg-black/25 p-4">
              <div className="text-sm font-semibold text-accent">{STORM_COPY[k].title}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{STORM_COPY[k].blurb("SOL", "Long")}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PayoutBand() {
  const rows = [
    ["1st", "60%", "w-3/5"],
    ["2nd", "30%", "w-[30%]"],
    ["3rd", "10%", "w-[10%]"],
  ];
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[22px] border border-border bg-surface p-6 sm:p-8">
        <div className="kicker">Payout</div>
        <h2 className="display mt-2 text-3xl">USDC, from escrow.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A full table pays three places, 60 / 30 / 10 after a 5% fee. Five to seven seats pay two. Four seats pay the last trader standing.
        </p>
        <div className="mt-6 space-y-3">
          {rows.map(([place, pct, w]) => (
            <div key={place} className="flex items-center gap-3 text-sm">
              <span className="w-10 text-muted">{place}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={cx("h-full rounded-full bg-accent", w)} />
              </div>
              <span className="num w-12 text-right text-fg">{pct}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[22px] border border-border bg-surface p-6 sm:p-8">
        <div className="kicker">Rating</div>
        <h2 className="display mt-2 text-3xl">Skill stays on Solana.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Every settled round rewrites a pairwise Elo against the field, scored by placement. Everyone starts at 1,200. The account is yours.
        </p>
        <Link href="/profile" className="mt-6 inline-flex">
          <Button variant="secondary">
            View your rating <ArrowRight size={15} />
          </Button>
        </Link>
      </div>
    </section>
  );
}
