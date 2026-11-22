// Verify a finished room on L1: status, placements, payouts in each player's USDC account, fee vault,
// ratings and position audit trail.  ROOM_ID=<id> npx tsx scripts/verify-room.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { coder, decodePosition, decodeRating, decodeRoom, configPda, positionPda, ratingPda, roomPda } from "../app/src/lib/royale/client";
import { L1_RPC, PROGRAM_ID, RoomStatus } from "../app/src/lib/royale/constants";
import { fmtChips, fmtUsdc } from "../app/src/lib/royale/game";

const ROOM_ID = BigInt(process.env.ROOM_ID ?? "0");
(async () => {
  const l1 = new Connection(L1_RPC, "confirmed");
  const roomKey = roomPda(ROOM_ID);
  const info = await l1.getAccountInfo(roomKey);
  if (!info) throw new Error("room not found");
  const room = decodeRoom(roomKey, info.data as Buffer);
  console.log(`room ${roomKey.toBase58()} owner=${info.owner.equals(PROGRAM_ID) ? "royale" : info.owner.toBase58()} status=${RoomStatus[room.status]} rated=${room.rated} storms=${room.stormKind.join(",")} ticks=${room.ticks}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = coder.accounts.decode("config", (await l1.getAccountInfo(configPda()))!.data as Buffer) as any;
  const fee = await l1.getTokenAccountBalance(cfg.feeVault as PublicKey);
  console.log(`fee vault ${cfg.feeVault.toBase58()} balance ${fee.value.uiAmountString}`);
  for (const [i, p] of room.players.entries()) {
    const ata = getAssociatedTokenAddressSync(room.mint, p);
    const bal = await l1.getTokenAccountBalance(ata).catch(() => null);
    const pos = await l1.getAccountInfo(positionPda(roomKey, p));
    const rat = await l1.getAccountInfo(ratingPda(p));
    const ps = pos ? decodePosition(positionPda(roomKey, p), pos.data as Buffer) : null;
    const rs = rat ? decodeRating(rat.data as Buffer) : null;
    console.log(
      `p${i} ${p.toBase58().slice(0, 8)} place #${room.placement[i]} cut@${room.elimCheckpoint[i]} final ${fmtChips(room.finalEquity[i])} chips · USDC ${bal?.value.uiAmountString ?? "?"} · trades ${ps?.actions ?? "?"} (public on L1: ${pos?.owner.equals(PROGRAM_ID) ? "yes" : "no"}) · elo ${rs?.elo ?? "?"} games ${rs?.games ?? "?"} wins ${rs?.wins ?? "?"}`,
    );
  }
  console.log(`pot ${fmtUsdc(room.entryAmount * BigInt(room.seatsFilled))} USDC`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
