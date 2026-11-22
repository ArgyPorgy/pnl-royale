"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  assetSymbol,
  ixBeginRound,
  ixCreateSessionV2,
  ixFinalizeRound,
  ixInitPermission,
  ixRequestStorm,
  ixSetPosition,
  ixSettle,
  ixStartRoom,
  ixTick,
  ixsJoin,
  positionPda,
  sessionTokenPda,
  configPda,
  coder,
  cuLimit,
  withPriority,
  type RoomState,
} from "@/lib/royale/client";
import { IS_DEVNET, MIN_SEATS, RoomStatus, explorerAccount } from "@/lib/royale/constants";
import { PlayInstantly } from "@/components/PlayInstantly";
import { readableError, requestFaucet, sendEr } from "@/lib/royale/er";
import { checkpointTs, fmtChips, fmtUsdc, intervalOf, liveEquity, prizeSplit, roundEndTs, short } from "@/lib/royale/game";
import { useSession } from "@/hooks/useSession";
import { useEr } from "@/hooks/useEr";
import { useNow, useRoomLive } from "@/hooks/useRoomLive";
import { AliveRing } from "@/components/AliveRing";
import { StormBanner } from "@/components/StormBanner";
import { TradePanel } from "@/components/TradePanel";
import { TxFeed, type TxItem } from "@/components/TxFeed";
import { TeeBadge } from "@/components/TeeBadge";

const STATUS_LABEL: Record<number, string> = {
  [RoomStatus.Open]: "Open",
  [RoomStatus.Starting]: "Starting",
  [RoomStatus.Live]: "LIVE",
  [RoomStatus.Ended]: "Ended",
  [RoomStatus.Settled]: "Paid",
  [RoomStatus.Cancelled]: "Cancelled",
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
  const now = useNow(live.skew);
  const room = live.room;
  const seat = room && me ? room.players.findIndex((p) => p.equals(me)) : -1;
  const seated = seat >= 0;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const pushTx = (t: TxItem) => setTxs((x) => [t, ...x].slice(0, 50));

  // ---------------- L1 wallet transactions (join / start / settle) ----------------
  const sendL1 = useCallback(
    async (ixs: TransactionInstruction[], extraSigners: import("@solana/web3.js").Keypair[] = []) => {
      if (!wallet.publicKey || !wallet.signTransaction) throw new Error("connect a wallet");
      const tx = new Transaction().add(...withPriority(ixs));
      tx.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      const signed = await wallet.signTransaction(tx); // wallet signs first (Phantom guidance)
      if (extraSigners.length) signed.partialSign(...extraSigners);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      return sig;
    },
    [wallet, connection],
  );

  const join = async () => {
    if (!me) return setVisible(true);
    if (!room) return;
    setBusy(true);
    setMsg(null);
    try {
      const ata = getAssociatedTokenAddressSync(room.mint, me);
      let bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      const lamports = await connection.getBalance(me);
      if (IS_DEVNET && (!bal || BigInt(bal.value.amount) < room.entryAmount || lamports < 12_000_000)) {
        setMsg("Topping up your wallet with devnet SOL + test USDC…");
        await requestFaucet(me).catch((e) => setMsg(readableError(e))); // cooldown is fine if balances suffice
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
      const sig = await sendL1(ixs, needSession ? [kp] : []);
      if (needSession) commit(kp, validUntil);
      setMsg(`Joined. Entry escrowed on Solana, seat delegated to the TEE. ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  const enableSession = async () => {
    if (!me) return;
    setBusy(true);
    try {
      const kp = fresh();
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      await sendL1([ixCreateSessionV2(me, kp.publicKey, validUntil, 0)], [kp]);
      commit(kp, validUntil);
      setMsg("1-tap trading enabled for this device (equity view needs the key you joined with).");
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!me) return setVisible(true);
    if (!room) return;
    setBusy(true);
    try {
      const sig = await sendL1([await ixStartRoom(me, room.address)]);
      setMsg(`Room delegated to the TEE: ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!me || !room) return setVisible(true);
    setBusy(true);
    try {
      const cfg = await connection.getAccountInfo(configPda());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feeVault = (coder.accounts.decode("config", cfg!.data as Buffer) as any).feeVault;
      const sig = await sendL1([await ixSettle(me, room, feeVault)]);
      setMsg(`Paid out on Solana: ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------------- ER transactions (session key, gasless, popup-free) ----------------
  const er_ = useCallback(
    async (label: string, ixs: TransactionInstruction[]) => {
      if (!er || !session) throw new Error("no ER session");
      const t0 = performance.now();
      try {
        const sig = await sendEr(er.connection, ixs, [session.kp]);
        pushTx({ sig, label, ms: Math.round(performance.now() - t0), ok: true, at: Date.now() });
        return sig;
      } catch (e) {
        pushTx({ sig: "", label: `${label}: ${readableError(e)}`, ms: 0, ok: false, at: Date.now() });
        throw e;
      }
    },
    [er, session],
  );

  const trade = async (side: -1 | 0 | 1, lev: number, asset: number) => {
    if (!room || !me || !session) return;
    setBusy(true);
    try {
      const ix = await ixSetPosition(session.kp.publicKey, room, me, sessionTokenPda(session.kp.publicKey, me), side, lev, asset);
      await er_(side === 0 ? "flat" : `${side > 0 ? "long" : "short"} ${assetSymbol(room, asset)} ${lev}×`, [ix]);
    } catch (e) {
      setMsg(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------------- Any client keeps the game moving (the program is time-gated + idempotent) ----------------
  const auto = useRef(0);
  useEffect(() => {
    if (!room || !er || !session || !seated) return;
    const t = Date.now();
    if (t - auto.current < 3000) return;
    const go = async (label: string, ixs: TransactionInstruction[]) => {
      auto.current = Date.now();
      await er_(label, ixs).catch(() => undefined);
    };
    if (live.delegated && room.status === RoomStatus.Starting) {
      (async () => {
        auto.current = Date.now();
        if (room.private) {
          for (let i = 0; i < room.players.length; i += 4) {
            const batch = await Promise.all(
              room.players.slice(i, i + 4).map((p) => ixInitPermission(session.kp.publicKey, room.address, positionPda(room.address, p))),
            );
            await er_("seal positions", batch).catch(() => undefined);
          }
        }
        await go("begin round", [cuLimit(400_000), await ixBeginRound(session.kp.publicKey, room)]);
      })();
    } else if (room.status === RoomStatus.Live) {
      const due = checkpointTs(room, room.nextCheckpoint);
      const interval = intervalOf(room.startTs, room.intervalSecs, now);
      if (now > due + 3) {
        ixTick(room).then((ix) => go(`tick (crank backup) #${room.nextCheckpoint}`, [ix]));
      } else if (!((room.stormsRequested >> interval) & 1) && now > checkpointTs(room, interval) + 5 && now < roundEndTs(room)) {
        ixRequestStorm(room.address).then((ix) => go("request storm", [ix]));
      }
    } else if (live.delegated && room.status === RoomStatus.Ended) {
      ixFinalizeRound(session.kp.publicKey, room).then((ix) => go("commit + undelegate", [cuLimit(400_000), ix]));
    }
  }, [room, er, session, seated, live.delegated, now, er_]);

  if (roomId === null) return <div className="card p-6">Bad room id.</div>;
  if (live.missing) return <div className="card p-6">Room not found on this network.</div>;
  if (!room) return <div className="card p-6 text-dim">Loading room…</div>;

  const pot = room.entryAmount * BigInt(room.seatsFilled);
  const prize = pot - (pot * BigInt(room.feeBps)) / 10_000n;
  const position = live.position;
  const myEquity = position ? liveEquity(room, position, live.prices, now) : null;
  const pnlPct = myEquity !== null ? (Number(myEquity) / 10_000_000_000 - 1) * 100 : 0;
  const nextCut = room.status === RoomStatus.Live ? checkpointTs(room, room.nextCheckpoint) : 0;
  const secsToCut = Math.max(0, nextCut - now);
  const startable =
    room.status === RoomStatus.Open &&
    room.seatsFilled >= MIN_SEATS &&
    (room.seatsFilled === room.maxSeats || now >= room.fillExpiry);
  const myPlace = seated ? room.placement[seat] : 0;
  const ended = room.status === RoomStatus.Ended || room.status === RoomStatus.Settled;
  const split = prizeSplit(room.finalistCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/" className="text-xs text-dim">← lobby</Link>
          <h1 className="text-2xl font-black">
            Room #{room.roomId.toString().slice(-6)}{" "}
            <span className={`chip align-middle ${room.status === RoomStatus.Live ? "text-short" : "text-dim"}`}>
              {STATUS_LABEL[room.status]}
            </span>
          </h1>
          <div className="text-sm text-dim">
            {fmtUsdc(room.entryAmount)} USDC entry · pot {fmtUsdc(pot)} · {room.assets.map((_, i) => assetSymbol(room, i)).join(" / ")} ·{" "}
            {room.intervalSecs}s cuts
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TeeBadge er={er} error={erError} />
          <Link className="chip" href={`/watch/${room.roomId}`}>spectate</Link>
          <a className="chip" href={explorerAccount(room.address.toBase58())} target="_blank" rel="noreferrer">room on Solscan</a>
        </div>
      </div>

      {msg && <div className="card rise border-gold/40 px-4 py-3 text-sm">{msg}</div>}

      {room.status === RoomStatus.Live && <StormBanner room={room} now={now} />}

      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="card p-4">
            <AliveRing room={room} me={me} />
            {room.status === RoomStatus.Live && (
              <div className={`mt-3 rounded-xl p-3 text-center ${secsToCut < 10 ? "pulse-danger bg-short/10" : "bg-panel2"}`}>
                <div className="text-xs uppercase tracking-widest text-dim">
                  {room.nextCheckpoint <= 5 ? `Cut #${room.nextCheckpoint} in` : "Final bell in"}
                </div>
                <div className="tabular text-4xl font-black">{secsToCut.toFixed(1)}s</div>
                <div className="text-xs text-dim">lowest equity is eliminated by an onchain crank</div>
              </div>
            )}
            {room.status === RoomStatus.Open && (
              <div className="mt-3 space-y-2 text-center">
                <div className="text-sm text-dim">
                  {room.seatsFilled}/{room.maxSeats} seats · starts when full or at{" "}
                  {new Date(room.fillExpiry * 1000).toLocaleTimeString()} with {MIN_SEATS}+
                </div>
                {!seated && !me && IS_DEVNET && <PlayInstantly className="w-full py-4 text-lg" />}
                {!seated && (
                  <button disabled={busy} onClick={join} className={`btn w-full py-4 text-lg ${me ? "bg-gold text-ink" : "border border-line text-dim"}`}>
                    {me ? `Join for ${fmtUsdc(room.entryAmount)} ${IS_DEVNET ? "test " : ""}USDC` : "Connect a wallet to join"}
                  </button>
                )}
                {seated && <div className="text-long">You're in. Seat #{seat + 1}.</div>}
                {startable && (
                  <button disabled={busy} onClick={start} className="btn w-full border border-gold py-3 text-gold">
                    Start the royale
                  </button>
                )}
              </div>
            )}
            {room.status === RoomStatus.Starting && (
              <div className="mt-3 text-center text-sm text-dim">Sealing positions inside the TEE and starting the clock…</div>
            )}
          </div>
          {seated && <TxFeed items={txs} token={er?.token ?? null} />}
        </div>

        <div className="space-y-4">
          {seated && room.status === RoomStatus.Live && (
            <>
              <div className="card p-4">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs uppercase tracking-widest text-dim">Your equity (sealed in the TEE)</div>
                  {room.publicRank[seat] > 0 && <div className="chip">rank #{room.publicRank[seat]} at last cut</div>}
                </div>
                {myEquity !== null ? (
                  <>
                    <div className={`tabular text-5xl font-black ${pnlPct >= 0 ? "text-long" : "text-short"}`}>{fmtChips(myEquity)}</div>
                    <div className="text-sm text-dim">
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}% ·{" "}
                      {position!.side === 0 ? "flat" : `${position!.side > 0 ? "LONG" : "SHORT"} ${assetSymbol(room, position!.assetIdx)} ${position!.leverage}×`}
                      {" · "}rivals can't see this
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-dim">
                    {live.positionHidden ? "Your position is private and this device's key can't read it." : "Reading your position from the TEE…"}
                  </div>
                )}
              </div>
              {valid ? (
                <TradePanel room={room} position={position} prices={live.prices} history={live.history} now={now} busy={busy} onTrade={trade} />
              ) : (
                <button disabled={busy} onClick={enableSession} className="btn w-full bg-gold py-4 text-ink">
                  Enable 1-tap trading on this device
                </button>
              )}
            </>
          )}

          {!seated && room.status === RoomStatus.Live && (
            <div className="card p-6 text-center text-dim">This royale is live. Positions are sealed in the TEE; watch the cuts land.</div>
          )}

          {ended && (
            <div className="card rise p-6 text-center">
              {seated && myPlace > 0 && myPlace <= room.finalistCount ? (
                <>
                  <div className="text-6xl">🏆</div>
                  <div className="mt-2 text-3xl font-black text-gold">#{myPlace} of {room.seatsFilled}</div>
                  <div className="mt-1 text-dim">
                    ≈ {fmtUsdc((prize * BigInt(split[myPlace - 1] ?? 0)) / 100n)} USDC{" "}
                    {room.status === RoomStatus.Settled ? "paid to your wallet" : "once settled on Solana"}
                  </div>
                </>
              ) : seated ? (
                <>
                  <div className="text-6xl">💀</div>
                  <div className="mt-2 text-3xl font-black text-short">Eliminated · #{myPlace}</div>
                  <div className="mt-1 text-dim">cut at checkpoint {room.elimCheckpoint[seat]} with {fmtChips(room.finalEquity[seat])} chips</div>
                </>
              ) : (
                <div className="text-2xl font-black">Round over</div>
              )}
              <Results room={room} me={me} />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {room.status === RoomStatus.Ended && !live.delegated && (
                  <button disabled={busy} onClick={settle} className="btn bg-gold px-5 py-3 text-ink">Pay out on Solana</button>
                )}
                {room.status === RoomStatus.Ended && live.delegated && (
                  <span className="chip text-dim">committing results to Solana…</span>
                )}
                {seated && (
                  <a
                    className="btn border border-line px-5 py-3"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                      myPlace > 0 && myPlace <= room.finalistCount
                        ? `Survived a ${room.seatsFilled}-trader PnL Royale and finished #${myPlace} 🏆 Hidden positions in a TEE, cuts by an onchain crank, storms by VRF, paid in USDC on Solana.`
                        : `Got cut in PnL Royale (#${myPlace} of ${room.seatsFilled}) 💀 Run it back.`,
                    )}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
                  >
                    Share on X
                  </a>
                )}
              </div>
            </div>
          )}

          {room.status === RoomStatus.Cancelled && (
            <div className="card p-6 text-center text-dim">Cancelled. Every entry is refundable in full (the relayer sends refunds automatically).</div>
          )}

          <Rules room={room} />
        </div>
      </div>
    </div>
  );
}

function Results({ room, me }: { room: RoomState; me: import("@solana/web3.js").PublicKey | null }) {
  if (room.finalistCount === 0) return null;
  const pot = room.entryAmount * BigInt(room.seatsFilled);
  const prize = pot - (pot * BigInt(room.feeBps)) / 10_000n;
  const split = prizeSplit(room.finalistCount);
  const rows = room.players.map((p, i) => ({ p, i, place: room.placement[i] })).sort((a, b) => a.place - b.place);
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line text-left text-sm">
      <div className="grid grid-cols-[3rem_1fr_5rem_6rem_5rem] gap-2 bg-panel2 px-3 py-2 text-[11px] uppercase tracking-widest text-dim">
        <span>#</span>
        <span>player</span>
        <span>out at</span>
        <span className="text-right">chips</span>
        <span className="text-right">USDC</span>
      </div>
      {rows.map(({ p, i, place }) => {
        const finalist = place <= room.finalistCount;
        const mine = me && p.equals(me);
        return (
          <div
            key={p.toBase58()}
            className={`grid grid-cols-[3rem_1fr_5rem_6rem_5rem] gap-2 border-t border-line/60 px-3 py-2 ${mine ? "bg-white/5" : ""}`}
          >
            <span className={finalist ? "font-bold text-gold" : "text-dim"}>#{place}</span>
            <a className="truncate font-mono underline decoration-dotted" href={explorerAccount(p.toBase58())} target="_blank" rel="noreferrer">
              {short(p)}
              {mine ? " (you)" : ""}
            </a>
            <span className="text-dim">{finalist ? "final" : `cut ${room.elimCheckpoint[i]}`}</span>
            <span className="tabular text-right">{fmtChips(room.finalEquity[i])}</span>
            <span className={`tabular text-right ${finalist ? "text-long" : "text-dim"}`}>
              {finalist ? fmtUsdc((prize * BigInt(split[place - 1] ?? 0)) / 100n) : "—"}
            </span>
          </div>
        );
      })}
      <div className="border-t border-line/60 px-3 py-2 text-[11px] text-dim">
        Pot {fmtUsdc(pot)} · fee {room.feeBps / 100}% · ties pool their shares · every trade is public on Solana now
      </div>
    </div>
  );
}

function Rules({ room }: { room: RoomState }) {
  return (
    <details className="card p-4 text-sm text-dim">
      <summary className="cursor-pointer font-bold text-white">Rules</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Everyone starts with 10,000 chips. One position at a time: long, short or flat, 1–10× (25× in a Surge).</li>
        <li>Every {room.intervalSecs}s an onchain crank cuts the lowest equity. Liquidated (equity ≤ 0) players are cut too.</li>
        <li>Flat isn't safe: it bleeds 1%/min. Each open pays 5 bps of notional. 2 s minimum hold.</li>
        <li>Positions are sealed in MagicBlock's TEE: only you can read yours until the round ends.</li>
        <li>A VRF storm changes the rules each minute: Spotlight 2× PnL, Leverage Surge, Freeze, Zone Shrink.</li>
        <li>Finalists split the pot minus a {room.feeBps / 100}% fee: 60/30/10 (3), 70/30 (2) or 100%. Paid in USDC on Solana.</li>
      </ul>
    </details>
  );
}
