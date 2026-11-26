"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, type Keypair, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ArrowLeft, Bot, Check, Copy, Eye, ExternalLink, Info, Play, Trophy, Users, Wallet } from "lucide-react";
import {
  assetSymbol,
  ixBeginRound,
  ixCreateSessionV2,
  ixFinalizeRound,
  ixInitPermission,
  ixRequestStorm,
  ixSetPosition,
  ixStartRoom,
  ixClosePosition,
  finishedPositions,
  ixTick,
  ixsJoin,
  positionPda,
  sessionTokenPda,
  cuLimit,
  withPriority,
  type RoomState,
} from "@/lib/royale/client";
import { IS_DEVNET, MIN_SEATS, RoomStatus, explorerAccount, feedById } from "@/lib/royale/constants";
import { readableError, requestFaucet, sendEr } from "@/lib/royale/er";
import { fitsOneTx, sendAndConfirm } from "@/lib/royale/l1";
import { BOT_SHARE_SINCE, botShare, checkpointTs, finalistsFor, fmtUsdc, intervalOf, prizeSplit, roomPayouts, roundEndTs } from "@/lib/royale/game";
import { useSession } from "@/hooks/useSession";
import { useEr } from "@/hooks/useEr";
import { useNow, useRoomLive } from "@/hooks/useRoomLive";
import { botsPending, useBotDriver, useBotMaxEntry, useBots } from "@/hooks/useBots";
import { TeeBadge } from "@/components/TeeBadge";
import { GameFx, SoundToggle } from "@/components/GameFx";
import { sfx } from "@/lib/ui/sound";
import { PlayInstantly } from "@/components/PlayInstantly";
import { Identicon, TokenStack } from "@/components/brand";
import { Activity, ChartPanel, OrderTicket, PlayersTable, PositionCard, RoundProgress, StormBanner, StormCard, mmss, type TxItem } from "@/components/room";
import { Button, Card, Empty, Pill, cx } from "@/components/ui";
import { LogoMark } from "@/components/brand";
import { buildPreview } from "@/lib/ui/preview";

const STATUS: Record<number, { label: string; tone: "up" | "down" | "neutral" | "accent" | "warn" }> = {
  [RoomStatus.Open]: { label: "Open", tone: "up" },
  [RoomStatus.Starting]: { label: "Starting", tone: "warn" },
  [RoomStatus.Live]: { label: "Live", tone: "accent" },
  [RoomStatus.Ended]: { label: "Ended", tone: "neutral" },
  [RoomStatus.Settled]: { label: "Paid out", tone: "neutral" },
  [RoomStatus.Cancelled]: { label: "Cancelled", tone: "neutral" },
};

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const roomId = useMemo(() => {
    try {
      return BigInt(params.id);
    } catch {
      return null;
    }
  }, [params.id]);
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const me = wallet.publicKey;
  const { session, valid, fresh, commit } = useSession(me);
  const { er, erError } = useEr(valid && session ? session.kp : null);
  const live = useRoomLive(roomId, me, er);
  const nowChain = useNow(live.skew);
  const room = live.room;
  const seat = room && me ? room.players.findIndex((p) => p.equals(me)) : -1;
  const seated = seat >= 0;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setPreviewKey(new URLSearchParams(window.location.search).get("preview"));
  }, []);
  const preview = useMemo(() => buildPreview(previewKey), [previewKey]);
  const bots = useBots();
  const botError = useBotDriver(preview ? null : room, live.delegated, me, bots);
  const view = preview?.room ?? room;
  const viewMe = preview ? preview.me : me;
  const viewSeat = view && viewMe ? view.players.findIndex((p) => p.equals(viewMe)) : -1;
  const viewDelegated = preview ? preview.delegated : live.delegated;
  const prices = preview ? preview.prices : live.prices;
  const position = preview ? preview.position : live.position;
  const history = preview ? preview.history : live.history;
  const now = preview ? Date.now() / 1000 : nowChain;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const [asset, setAsset] = useState(0);
  const pushTx = (t: TxItem) => setTxs((x) => [t, ...x].slice(0, 50));
  const info = (text: string) => setMsg({ text, tone: "info" });
  const fail = (e: unknown) => setMsg({ text: readableError(e), tone: "error" });

  useEffect(() => {
    if (position && position.side !== 0) setAsset(position.assetIdx);
    // follow the open position's market once when it loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.assetIdx, position?.side]);

  // ---------------- L1 wallet transactions (join / start). The payout needs no one's wallet. ----------------
  const sendL1 = useCallback(
    async (ixs: TransactionInstruction[], extraSigners: Keypair[] = []) => {
      if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Connect a wallet first.");
      const tx = new Transaction().add(...withPriority(ixs));
      tx.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      const signed = await wallet.signTransaction(tx); // wallet signs first (Phantom guidance)
      if (extraSigners.length) signed.partialSign(...extraSigners);
      return sendAndConfirm(connection, signed, lastValidBlockHeight);
    },
    [wallet, connection],
  );

  const previewNote = () => info("This is a local preview of the room. Create one from the lobby to play it.");

  const join = async () => {
    if (preview) return previewNote();
    if (!me) return setVisible(true);
    if (!room) return;
    setBusy(true);
    setMsg(null);
    try {
      const ata = getAssociatedTokenAddressSync(room.mint, me);
      let bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      const lamports = await connection.getBalance(me);
      if (IS_DEVNET && (!bal || BigInt(bal.value.amount) < room.entryAmount || lamports < 12_000_000)) {
        info("Funding your devnet wallet with SOL and test USDC…");
        await requestFaucet(me).catch(() => undefined); // a cooldown is fine if balances already suffice
        bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      }
      if (!bal || BigInt(bal.value.amount) < room.entryAmount) {
        throw new Error(`You need ${fmtUsdc(room.entryAmount)} USDC in your wallet to join.`);
      }
      const kp = valid && session ? session.kp : fresh();
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      const ixs = await ixsJoin(me, room.address, { viewer: kp.publicKey, mint: room.mint });
      const needSession = !(valid && session);
      if (needSession) ixs.push(ixCreateSessionV2(me, kp.publicKey, validUntil, 0));
      // Deposits from your finished rounds ride along: each closed position returns about 0.0016 SOL.
      const done = await Promise.race([
        finishedPositions(connection, me, room.address).catch(() => []),
        new Promise<PublicKey[]>((r) => setTimeout(() => r([]), 2500)),
      ]);
      for (const r of done) {
        const close = await ixClosePosition(me, r);
        if (!fitsOneTx(withPriority([...ixs, close]), me, needSession ? 2 : 1)) break;
        ixs.push(close);
      }
      await sendL1(ixs, needSession ? [kp] : []);
      if (needSession) commit(kp, validUntil);
      sfx("join");
      info("You're in. Your entry is in escrow on Solana and your seat is delegated to the TEE.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const enableSession = async () => {
    if (preview) return previewNote();
    if (!me) return;
    setBusy(true);
    try {
      const kp = fresh();
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      await sendL1([ixCreateSessionV2(me, kp.publicKey, validUntil, 0)], [kp]);
      commit(kp, validUntil);
      info("One-tap trading is enabled on this device.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (preview) return previewNote();
    if (!me) return setVisible(true);
    if (!room) return;
    setBusy(true);
    try {
      await sendL1([await ixStartRoom(me, room.address)]);
      info("Room locked and delegated to the TEE. Sealing positions…");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ---------------- ER transactions (session key, gasless, popup-free) ----------------
  // `quiet`: background housekeeping (seal, begin, overdue cut, commit). Another client or the
  // crank often wins the race and ours is rejected harmlessly, so only successes are logged.
  const er_ = useCallback(
    async (label: string, ixs: TransactionInstruction[], quiet = false) => {
      if (!er || !session) throw new Error("No rollup session yet.");
      const t0 = performance.now();
      try {
        const sig = await sendEr(er.connection, ixs, [session.kp]);
        pushTx({ sig, label, ms: Math.round(performance.now() - t0), ok: true, at: Date.now() });
        return sig;
      } catch (e) {
        if (!quiet) pushTx({ sig: "", label: `${label}: ${readableError(e)}`, ms: 0, ok: false, at: Date.now() });
        throw e;
      }
    },
    [er, session],
  );

  const trade = async (side: -1 | 0 | 1, lev: number, a: number) => {
    if (preview) return previewNote();
    if (!room || !me || !session) return;
    setBusy(true);
    try {
      const ix = await ixSetPosition(session.kp.publicKey, room, me, sessionTokenPda(session.kp.publicKey, me), side, lev, a);
      await er_(side === 0 ? "Close position" : `${side > 0 ? "Long" : "Short"} ${assetSymbol(room, a)} ${lev}x`, [ix]);
      sfx("trade");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ---------------- Any seated client keeps the game moving (time-gated + idempotent onchain) ----------------
  const auto = useRef(0);
  useEffect(() => {
    if (preview || !room || !er || !session || !seated) return;
    if (Date.now() - auto.current < 3000) return;
    const go = async (label: string, ixs: TransactionInstruction[]) => {
      auto.current = Date.now();
      await er_(label, ixs, true).catch(() => undefined);
    };
    if (live.delegated && room.status === RoomStatus.Starting) {
      (async () => {
        auto.current = Date.now();
        if (room.private) {
          for (let i = 0; i < room.players.length; i += 4) {
            const batch = await Promise.all(
              room.players.slice(i, i + 4).map((p) => ixInitPermission(session.kp.publicKey, room.address, positionPda(room.address, p))),
            );
            await er_("Seal positions in the TEE", batch, true).catch(() => undefined);
          }
        }
        await go("Begin round", [cuLimit(400_000), await ixBeginRound(session.kp.publicKey, room)]);
      })();
    } else if (room.status === RoomStatus.Live) {
      const due = checkpointTs(room, room.nextCheckpoint);
      const interval = intervalOf(room.startTs, room.intervalSecs, now);
      if (now > due + 3) {
        ixTick(room).then((ix) => go(`Trigger overdue cut ${room.nextCheckpoint}`, [ix]));
      } else if (!((room.stormsRequested >> interval) & 1) && now > checkpointTs(room, interval) + 5 && now < roundEndTs(room)) {
        ixRequestStorm(room.address).then((ix) => go("Request storm", [ix]));
      }
    } else if (live.delegated && room.status === RoomStatus.Ended) {
      ixFinalizeRound(session.kp.publicKey, room).then((ix) => go("Commit results to Solana", [cuLimit(400_000), ix]));
    }
  }, [room, er, session, seated, live.delegated, now, er_, preview]);

  if (roomId === null) return <EmptyState title="Bad link" />;
  if (!preview && live.missing) return <EmptyState title="Room not found" body="Not on this network." />;
  if (!view) return <EmptyState title="Loading" loading />;

  const status = STATUS[view.status];
  const pot = view.entryAmount * BigInt(view.seatsFilled);
  const ended = view.status === RoomStatus.Ended || view.status === RoomStatus.Settled;
  const isLive = view.status === RoomStatus.Live;
  const playing = viewSeat >= 0;

  return (
    <div className="space-y-5">
      {/* Room header */}
      <div className="mesh flex flex-wrap items-end justify-between gap-4 rounded-[28px] border border-white/10 px-5 py-5">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
            <ArrowLeft size={14} /> All rooms
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <TokenStack ids={view.assets} size={28} />
            <h1 className="display text-3xl">Room {view.roomId.toString().slice(-6)}</h1>
            <Pill tone={status.tone} dot={isLive}>
              {status.label}
            </Pill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>
              Entry <span className="num text-fg">${fmtUsdc(view.entryAmount)}</span>
            </span>
            <span>
              Pot <span className="balance text-2xl text-white">${fmtUsdc(pot)}</span>
            </span>
            <span>{view.assets.map((id) => feedById(id)?.symbol).join(" · ")}</span>
            <span>Cut every {view.intervalSecs}s</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SoundToggle />
          <TeeBadge er={er} error={erError} />
          <Link href={`/watch/${view.roomId}${preview ? "?preview=spectate" : ""}`}>
            <Button size="sm">
              <Eye size={14} /> Spectate
            </Button>
          </Link>
          <a href={explorerAccount(view.address.toBase58())} target="_blank" rel="noreferrer">
            <Button size="sm">
              <ExternalLink size={14} /> Solscan
            </Button>
          </a>
        </div>
      </div>

      {view.status !== RoomStatus.Open && view.status !== RoomStatus.Cancelled && <GameFx room={view} now={now} me={viewMe} bots={bots} />}

      {msg && (
        <div
          className={cx(
            "fade-up flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]",
            msg.tone === "error" ? "border-down/30 bg-down/5 text-down" : "border-border bg-surface text-fg",
          )}
        >
          <Info size={15} className="mt-0.5 shrink-0" />
          {msg.text}
        </div>
      )}

      {(view.status === RoomStatus.Open || view.status === RoomStatus.Starting || isLive) && (
        // One tree for pre-round and live so the chart stays mounted when the round starts.
        <>
          {isLive ? <StormBanner room={view} now={now} /> : null}
          {isLive ? <RoundProgress room={view} now={now} /> : null}
          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-5">
              <ChartPanel room={view} prices={prices} history={history} asset={asset} onAsset={setAsset} />
              {isLive ? <PlayersTable room={view} me={viewMe} /> : null}
              {isLive && playing ? <Activity items={txs} token={er?.token ?? null} /> : null}
            </div>
            <div className="space-y-5">
              {!isLive ? (
                <>
                  <SeatsCard
                    room={view}
                    me={viewMe}
                    now={now}
                    busy={busy}
                    seated={playing}
                    delegated={viewDelegated}
                    bots={bots}
                    botError={botError}
                    onJoin={join}
                    onStart={start}
                  />
                  <PrizeCard room={view} />
                </>
              ) : playing ? (
                <>
                  <PositionCard
                    room={view}
                    position={position}
                    prices={prices}
                    now={now}
                    rank={view.publicRank[viewSeat] ?? 0}
                    busy={busy}
                    onClose={position && (preview || valid) ? () => trade(0, 1, position.assetIdx) : undefined}
                  />
                  {preview || valid ? (
                    <OrderTicket room={view} position={position} prices={prices} asset={asset} now={now} busy={busy} onTrade={trade} />
                  ) : (
                    <Card title="Trade">
                      <p className="subhead text-xl text-white">Enable one-tap trading.</p>
                      <Button variant="primary" className="mt-3 w-full" disabled={busy} onClick={enableSession}>
                        Enable one-tap trading
                      </Button>
                    </Card>
                  )}
                  <StormCard room={view} now={now} />
                </>
              ) : (
                <>
                  <Card title="Spectating">
                    <p className="subhead text-xl text-white">Positions stay sealed.</p>
                    <Link href={`/watch/${view.roomId}`} className="mt-3 inline-flex">
                      <Button size="sm">Open the spectator board</Button>
                    </Link>
                  </Card>
                  <StormCard room={view} now={now} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      {ended && (
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <ResultCard room={view} seat={viewSeat} delegated={viewDelegated} bots={bots} />
          <div className="space-y-5">
            <PlayersTable room={view} me={viewMe} payouts />
            {playing && txs.length > 0 && <Activity items={txs} token={er?.token ?? null} />}
          </div>
        </div>
      )}

      {view.status === RoomStatus.Cancelled && (
        <Card title="Room cancelled">
          <p className="subhead text-xl text-white">Entries refund.</p>
        </Card>
      )}
    </div>
  );
}

function EmptyState({ title, body, loading }: { title: string; body?: string; loading?: boolean }) {
  return (
    <Empty
      loading={loading}
      icon={<LogoMark size={26} />}
      title={title}
      body={body}
      action={
        <Link href="/">
          <Button size="sm">
            <ArrowLeft size={14} /> Back to rooms
          </Button>
        </Link>
      }
    />
  );
}

function SeatsCard({
  room,
  me,
  now,
  busy,
  seated,
  delegated,
  bots,
  botError,
  onJoin,
  onStart,
}: {
  room: RoomState;
  me: import("@solana/web3.js").PublicKey | null;
  now: number;
  busy: boolean;
  seated: boolean;
  delegated: boolean;
  bots: ReadonlyMap<string, string>;
  botError: string | null;
  onJoin: () => void;
  onStart: () => void;
}) {
  const starting = room.status === RoomStatus.Starting || delegated;
  const open = room.status === RoomStatus.Open && !starting;
  const host = !!me && room.creator.equals(me);
  const enough = room.seatsFilled >= MIN_SEATS;
  const full = room.seatsFilled === room.maxSeats;
  const closed = now >= room.fillExpiry;
  // The program's rule: four seats, and then the host at any time or anyone once full or timed out.
  const startable = open && enough && (host || full || closed);
  const botMax = useBotMaxEntry();
  const joining = open && seated ? botsPending(room, bots, botMax) : 0;
  const overMax = open && bots.size > 0 && botMax !== null && room.entryAmount > botMax;
  const line = !open
    ? null
    : startable
      ? full
        ? "Every seat is taken."
        : host && !closed
          ? "Start now, or wait for more players."
          : "The join window has closed."
      : !enough
        ? joining > 0
          ? (botError ?? `${joining} bot${joining === 1 ? " is" : "s are"} taking a seat.`)
          : overMax
            ? `House bots only join rooms up to $${fmtUsdc(botMax)}. Invite friends to reach ${MIN_SEATS}.`
            : `Needs ${MIN_SEATS} players to start.`
        : `Waiting for the host. Opens to everyone in ${mmss(room.fillExpiry - now)}.`;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Users size={14} /> Seats {room.seatsFilled}/{room.maxSeats}
        </span>
      }
      action={open && !closed && !full && <span className="num text-[11px] text-faint">Joining closes in {mmss(room.fillExpiry - now)}</span>}
    >
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: room.maxSeats }, (_, i) => {
          const p = room.players[i];
          const mine = !!p && !!me && p.equals(me);
          const bot = p ? bots.get(p.toBase58()) : undefined;
          const incoming = !p && i < room.seatsFilled + joining && !botError;
          return (
            <div
              key={i}
              className={cx(
                "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px]",
                p ? (mine ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5") : "border-dashed border-white/10 text-faint",
              )}
              title={p ? (bot ? `Bot "${bot}" · ${p.toBase58()}` : p.toBase58()) : undefined}
            >
              {p ? (
                <>
                  <Identicon pubkey={p} size={20} />
                  <span className={cx("flex items-center gap-1 text-muted", !bot && "num")}>
                    {bot && <Bot size={11} />}
                    {mine ? "You" : (bot ?? p.toBase58().slice(0, 4))}
                  </span>
                </>
              ) : incoming ? (
                <span className="skeleton h-3 w-10" aria-label="Bot joining" />
              ) : (
                "Open"
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-2">
        {starting ? (
          <div className="subhead rounded-[10px] border border-border bg-bg px-3 py-3 text-xl text-white">Starting.</div>
        ) : seated ? (
          <div className="subhead rounded-[10px] border border-up/20 bg-up/5 px-3 py-3 text-xl text-up">You&apos;re in. Seat {room.players.findIndex((p) => me && p.equals(me)) + 1}.</div>
        ) : full || closed ? null : me ? (
          <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={onJoin}>
            {busy ? "Joining…" : `Join for $${fmtUsdc(room.entryAmount)}${IS_DEVNET ? " test USDC" : ""}`}
          </Button>
        ) : IS_DEVNET ? (
          <PlayInstantly size="lg" className="w-full" label="Play instantly to join" />
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={onJoin}>
            <Wallet size={16} /> Connect a wallet to join
          </Button>
        )}
        {open && me && (startable || (host && seated)) && (
          <Button
            variant={seated || full || closed ? "primary" : "secondary"}
            size="lg"
            className="w-full"
            disabled={busy || !startable}
            onClick={onStart}
          >
            <Play size={16} /> {busy && seated ? "Starting…" : `Start with ${Math.max(room.seatsFilled, MIN_SEATS)} players`}
          </Button>
        )}
        {line && <p className="text-center text-xs text-muted">{line}</p>}
        {open && !full && !closed && <InviteLink />}
      </div>
    </Card>
  );
}

function InviteLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full"
      onClick={() =>
        navigator.clipboard
          ?.writeText(window.location.href.split("?")[0])
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined)
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Link copied" : "Copy invite link"}
    </Button>
  );
}

function PrizeCard({ room }: { room: RoomState }) {
  const seats = Math.max(room.seatsFilled, MIN_SEATS);
  const f = finalistsFor(seats);
  const split = prizeSplit(f);
  const entry = Number(room.entryAmount) / 1e6;
  const pot = entry * room.seatsFilled;
  const full = entry * room.maxSeats;
  // show what each place pays now, or what it would pay when full before anyone joins
  const prize = (room.seatsFilled > 0 ? pot : full) * (1 - room.feeBps / 10_000);
  return (
    <Card title="Prize pool">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-muted">Pot so far</div>
          <div className="balance mt-1 text-5xl text-white">${pot.toFixed(2)}</div>
        </div>
        <div className="num text-right text-xs text-faint">
          Up to ${full.toFixed(2)} · {room.feeBps / 100}% fee
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {split.map((pct, i) => (
          <div key={i} className="flex items-center gap-3 text-[13px]">
            <span className="w-14 text-muted">{i === 0 ? "1st" : i === 1 ? "2nd" : "3rd"}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-white/75" style={{ width: `${pct}%` }} />
            </div>
            <span className="num w-20 text-right text-fg">${((prize * pct) / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ResultCard({
  room,
  seat,
  delegated,
  bots,
}: {
  room: RoomState;
  seat: number;
  delegated: boolean;
  bots: ReadonlyMap<string, string>;
}) {
  const place = seat >= 0 ? room.placement[seat] : 0;
  const won = place > 0 && place <= room.finalistCount;
  const payout = seat >= 0 ? (roomPayouts({ ...room, status: RoomStatus.Settled }).get(seat) ?? 0n) : 0n;
  const isBot = (p: RoomState["players"][number]) => bots.has(p.toBase58());
  // House bots hand back what they win, split evenly over every seat.
  const share = room.endTs >= BOT_SHARE_SINCE && bots.size ? botShare({ ...room, status: RoomStatus.Settled }, isBot) : null;
  const myShare = share && seat >= 0 && !isBot(room.players[seat]) ? share.each : 0n;
  const settled = room.status === RoomStatus.Settled;
  const share_ = `https://x.com/intent/tweet?text=${encodeURIComponent(
    won
      ? `Finished #${place} of ${room.seatsFilled} in PnL Royale. Hidden positions in a TEE, onchain eliminations, USDC payouts on Solana.`
      : `Made it to #${place} of ${room.seatsFilled} in PnL Royale. Running it back.`,
  )}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`;
  return (
    <Card>
      <div className="flex flex-col items-center py-4 text-center">
        <span className={cx("grid h-16 w-16 place-items-center rounded-full", won ? "bg-white text-black" : "bg-white/8 text-faint")}>
          <Trophy size={28} strokeWidth={1.6} />
        </span>
        {seat >= 0 ? (
          <>
            <div className="kicker mt-4">{won ? "You finished" : "Eliminated"}</div>
            <div className="balance mt-1 text-6xl text-white">
              #{place} <span className="text-lg font-normal text-faint">of {room.seatsFilled}</span>
            </div>
            {won ? (
              <div className="num mt-2 text-lg text-up">+${fmtUsdc(payout)}</div>
            ) : (
              <div className="subhead mt-2 text-xl text-white">Cut at {room.elimCheckpoint[seat]}.</div>
            )}
            <div className="subhead mt-2 text-lg text-white">
              {settled ? (won ? "Paid on Solana." : "Settled.") : delegated ? "Committing results." : "Paying out automatically."}
            </div>
          </>
        ) : (
          <>
            <div className="display mt-4 text-3xl">Round complete</div>
            <p className="subhead mt-2 text-xl text-white">{settled ? "Paid on Solana." : "Paying out automatically."}</p>
          </>
        )}
        {myShare > 0n && (
          <p className="mt-3 max-w-[300px] text-[13px] text-muted">
            House bots don&apos;t keep winnings. <span className="num text-up">${fmtUsdc(myShare)}</span> of their ${fmtUsdc(share!.won)}{" "}
            {settled ? "comes back to your wallet." : "will come back to your wallet after the payout."}
          </p>
        )}
      </div>
      <div className="mt-2 grid gap-2">
        {seat >= 0 && (
          <a href={share_} target="_blank" rel="noreferrer">
            <Button className="w-full">Share result</Button>
          </a>
        )}
        <Link href="/">
          <Button variant="ghost" className="w-full">
            Play another round
          </Button>
        </Link>
      </div>
    </Card>
  );
}
