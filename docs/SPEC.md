# PnL Royale: Build Spec (PRD + Tech Design), Solana mainnet

**Target:** MagicBlock Solana Blitz v10 hackathon submission (ship as soon as possible).
**Network:** Solana **mainnet-beta** plus the MagicBlock **mainnet Private Ephemeral Rollup (TEE)**. The fallback is the mainnet public ER.
**Status:** v1. Every external fact carries a doc URL or a read-only RPC check.
**Doc base:** https://docs.magicblock.gg (all `/pages/...` links below are relative to it).

---

## 0. Mainnet readiness (verified with read-only RPC, no transactions)

Every check below was made with plain JSON-RPC reads.

| Check | Result | Evidence |
|---|---|---|
| **Mainnet TEE (Private ER) endpoint** | **LIVE.** `https://mainnet-tee.magicblock.app` returned `getHealth` = `ok` and `getVersion` = magicblock-core 1.1.1 (git 8886db2, solana-core 4.0.0). `getSlot` returned 452518997 and `getIdentity` returned `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`. | RPC; the docs list the same identity as "TEE (mainnet-tee.magicblock.app)" under **Mainnet** validators in `/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart.md` |
| Magic Router mainnet route table | `https://router.magicblock.app` `getRoutes` lists 6 mainnet validators, all with baseFee 0: **sa** (ARG, 10 ms), **as-tyo** (JPN, 10 ms), **as** (SGP, 10 ms), **eu** (DEU, 10 ms), **us** (USA, 10 ms), and **mainnet-tee** (SGP, **50 ms block time**). | RPC `getRoutes` |
| Public mainnet ERs | as / eu / us / sa `.magicblock.app` all report healthy on v1.1.1. Identities: as `MAS1Dt9q…zk57`, eu `MEUGGrYP…MS8e`, us `MUS3hc9T…HNd`, sa `MSARyz2y…DtDh`, as-tyo `MSHuBweM…jix8`. | RPC; `/pages/ephemeral-rollups-ers/how-to-guide/quickstart.md` |
| Delegation Program `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | Executable on Solana mainnet L1, the TEE and the as ER | RPC `getAccountInfo` |
| **Permission Program** `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` | **Executable on Solana mainnet L1, the mainnet TEE and the as ER.** The access-control page still shows a "Permission Program (Coming soon)" card, but the program is deployed, and the quickstart's `CreateEphemeralPermissionCpi` flow uses it. | RPC; `/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart.md`, `/how-to-guide/access-control.md` |
| Session Keys `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5` | Executable on mainnet L1, the TEE and the as ER | RPC |
| VRF program `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` | Executable on mainnet L1, the TEE and the as ER | RPC |
| **VRF ER queue** `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` | **Live on the mainnet TEE:** recent successful transactions on the queue. Also active on the as, eu and us ERs. This shows ER-side VRF requests are being fulfilled on the mainnet TEE. | RPC `getSignaturesForAddress` |
| Pricing oracle `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd` | **The feeds update live on the mainnet TEE.** SOL/USD read 70.27350 then 70.26852 2 s apart. BTC, ETH, BONK, WIF, FARTCOIN, POPCAT and HYPE all changed within 1 s (see §5.6). | RPC |
| Ephemeral SPL Token `SPLxh1LV…agv2` | Executable on mainnet L1, the TEE and the ER | RPC |
| **Cranks on the public mainnet ER** | **Supported per the docs:** "This guide describes the scheduler in validator 1.1.1, which the mainnet ERs … run." | `/pages/tools/crank/implementation.md` |
| **Cranks on the mainnet TEE** | **Not explicitly documented.** The TEE runs the same validator version (1.1.1, verified), so it's likely but **unverified**. Settled by smoke test T1 (§11). | inference only |
| **VRF callbacks on the TEE** | The queue activity above shows they run. Our own callback must use `#[vrf_callback]` (the scoped program identity). | RPC; `/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart.md` |
| TEE auth | Clients must call `verifyTeeRpcIntegrity(url)` and then `getAuthToken(url, pubkey, signMessage)` from `@magicblock-labs/ephemeral-rollups-sdk` before private reads and writes. My unauthenticated read of a *public* account (a price feed) on mainnet-tee worked. | `/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart.md` (step 4) |
| TEE ingress | The docs say the PER does node-level IP geofencing and Range AML screening at ingress, and they don't publish the blocked list. **Engineering check:** run `getAuthToken` from the team's own network and the server region (smoke test T4). | `/pages/private-ephemeral-rollups-pers/introduction/compliance-framework.md` |
| SDK pin | Use **`ephemeral-rollups-sdk` 0.18.x** with features `anchor`, `access-control` and `vrf`. The 0.20 line is validator 2.0 only (devnet-us), and all mainnet endpoints are 1.1.1. Anchor 1.0.2, Solana 3.1.9, Rust 1.89. | PER quickstart, VRF quickstart |

**Verdict:** the Private ER is on mainnet and healthy. The delegation, permission, session-key, VRF and oracle programs are all deployed there and active. **We go mainnet.** The one real unknown is cranks inside the TEE, which we smoke-test first, with a permissionless time-gated fallback (§6.4).

---

## 1. Product overview

**One line:** *Battle royale for traders.* Up to 16 players stake USDC, trade live prices with **hidden positions**, the lowest equity is cut every minute, and the last traders standing split the pot. Everything is onchain, with a gasless, popup-free UX.

**Who it's for:**
- Crypto-native degens and traders who want short, skill-based PvP.
- Streamers and communities running private rooms.
- Token projects sponsoring tournaments on their asset.

**Why MagicBlock:**
- Each tap is a free ER transaction.
- Positions stay sealed inside the TEE.
- Storms come from VRF and are provably fair.
- The referee is an onchain crank.
- Money settles on Solana L1.

**Theme fit:** "Entertainment Finance" (trade, compete, win assets you own). Trading competitions and social trading are listed as still open in https://www.magicblock.xyz/blog/entertainment-finance-on-magicblock.

**Judging fit:** the criteria are creativity, technical depth, and showcasing what's possible on Solana. We hit them by stacking PER, VRF, cranks, session keys, the oracle and L1 settlement on mainnet.

### Success criteria for the hackathon
1. A full mainnet round with at least 4 real wallets and $1 USDC entries, start to finish, with the L1 payout visible on Solscan.
2. Positions are provably hidden during the round: a rival's TEE read is denied. They're revealed after the round.
3. At least one VRF storm and at least 3 crank eliminations visible onchain in the demo.
4. A 3-minute video, a public repo, a live site, and Boost addresses submitted.

---

## 2. Game rules (v1)

### 2.1 Rooms
- **Seats:** a minimum of 4 and a maximum of 16. The creator sets `entry_amount` (USDC, 6 decimals), `max_seats`, `assets` (1–3 oracle feeds), and `fill_expiry` (the default is 10 minutes after creation).
- **Entry:** players `join_room`, which transfers `entry_amount` USDC into the room's L1 escrow vault. One seat per wallet.
- **Start:**
  - Anyone can call `start_room` once `seats_filled >= min_seats` and either the room is full or `now >= fill_expiry`.
  - If `seats_filled < min_seats` at `fill_expiry`, anyone can call `cancel_room`, which refunds every entry in full.

### 2.2 Chips and positions
- Every player starts with **10,000.000000 chips** (u64, 6 decimals). Chips are a score, not money.
- **Actions** (`set_position`, via session key):
  - `side ∈ {Flat, Long, Short}`
  - `leverage ∈ {1, 2, 5, 10}` (a storm can raise the cap, §2.5)
  - `asset_idx ∈ room.assets`
- **One open position per player.** Changing side, asset or leverage closes the current position at the oracle price and opens the new one.
- **Flip cost:** each open charges a **5 bps spread on notional** in chips. This is anti-spam, and it blunts latency arbitrage against the 50–200 ms feed.
- **Minimum hold:** 2 s before the next change, enforced with `last_action_ts`.
- **Mark to market:**
  - `pnl = equity_at_open × leverage × side × (P_now − P_entry) / P_entry`
  - `equity = equity_at_open + pnl`
  - Equity at or below 0 means **liquidated**: the player is eliminated at the next check.

### 2.3 The zone (anti-camping)
- Being flat is not safe. **Flat equity bleeds 1% per minute** (pro-rated at each check), and storms can double the bleed.
- Without this, an AFK player would survive while everyone else takes risk.

### 2.4 Eliminations
- **Round length:** `T = 6 min`. The elimination checkpoints are at minutes 1, 2, 3, 4 and 5, and the round ends at the 6-minute mark.
- **Cuts per checkpoint:** `cuts = ceil((alive − finalists) / checkpoints_left)`.
  - `finalists` is 3 when there are at least 8 seats, 2 for 5–7 seats, and 1 for 4 seats.
  - Example with 16 players: 3, 3, 3, 2, 2 cuts, leaving 3 finalists for the last minute.
- At each checkpoint `eliminate` marks all alive players to market with **fresh oracle prices**, sorts by equity ascending, and cuts the lowest `cuts` players plus anyone liquidated.
- **Ties at a cut line** are broken with a deterministic hash of `(round_vrf_seed, checkpoint, player)`. That's provably fair with no seat bias.
- An eliminated player's position is force-closed and frozen.

### 2.5 VRF storms
- One storm is requested at start and after each checkpoint, and it applies for the next minute.
- `kind = rand % 4`:
  1. **Spotlight:** one random room asset gets **2× PnL** for 60 s.
  2. **Leverage Surge:** the leverage cap rises to 25× for 60 s.
  3. **Freeze:** one random side (Long or Short) can't be *opened* for 30 s.
  4. **Zone Shrink:** flat bleed doubles for 60 s.
- Storms change rules for the coming interval and never touch existing positions retroactively.
- The UI shows the VRF transaction link and the proof.

### 2.6 End and payouts
- At the 6-minute mark, `end_round` does a final mark to market. Finalists are ranked by equity, then by the tie hash.
- `pot = entries × entry_amount`. `fee = pot × fee_bps / 10_000` (the default is 500, which is 5%) and goes to the fee vault.
- **Prize split of `pot − fee`:**
  - 3 finalists: 60% / 30% / 10%
  - 2 finalists: 70% / 30%
  - 1 finalist: 100%
  - **Ties among finalists:** the tied ranks pool their shares and split equally. The last lamport of dust goes to the fee vault.
- `end_round` sets every position **public** (`set_privacy(false)`), so after the round anyone can audit every trade. Then it does `commit_and_undelegate` on the room and positions.
- On L1, `settle` (permissionless, once only) pays winners and the fee from the escrow and updates ratings.

### 2.7 Disconnects and griefing
- **Disconnect:** the position stays as it was, keeps marking to market, and the zone bleeds it if flat. Reconnecting re-subscribes. The session key is valid for 1 hour, which covers a round.
- **Non-starter after join:** treated as an AFK player. No refund once the round has started.
- **Room never fills:** `cancel_room` refunds everyone.
- **Stuck round:** if `end_round` hasn't run by `end_ts + 120 s`, anyone can call it on the ER, since it's time-gated. If the room is still delegated at `end_ts + 24 h`, see §8 (escrow safety) for the admin-free path limits.

---

## 3. Mainnet architecture

```
                 Solana mainnet-beta (L1)                                 MagicBlock mainnet TEE  (MTEW…xzo, 50 ms blocks)
 ┌───────────────────────────────────────────────┐            ┌─────────────────────────────────────────────────────────┐
 │ royale program (Anchor 1.0.2, ER SDK 0.18)    │  delegate  │ Room  (public)          Position[i] (PRIVATE: owner)    │
 │  Config  Room(pre-start)  Vault(USDC ATA)     │ ─────────► │  clock, alive, ranks     side/lev/entry/equity         │
 │  Position(init)  Rating[player]               │            │  storm, seed             EphemeralPermission[i]        │
 │  settle(): pays winners + fee, updates Elo    │ ◄───────── │ Crank: eliminate() @60s  VRF ER queue → callback_storm │
 └───────────────────────────────────────────────┘  commit +  │ Oracle feeds (Pyth Lazer) PriCems5… read every action   │
            ▲                                     undelegate  └─────────────────────────────────────────────────────────┘
            │ USDC in/out                                                ▲  session-key signed set_position (no popup)
     Players' wallets (Privy embedded / Phantom)  ── Next.js PWA ────────┘  (TEE auth token per user)
                                                     Indexer/relayer (spectator feed, crank backup, settle caller)
```

- **Program:** one Anchor program, `royale`, with the `#[ephemeral]` and `#[delegate]` macros, `access-control` and `vrf` features, and `session-keys = "3.1.1"`. It's deployed to mainnet L1. The ER executes the same bytecode (`/pages/ephemeral-rollups-ers/how-to-guide/quickstart.md`).
- **Validator:** all delegations target `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (the TEE), passed as the first remaining account in `DelegateConfig { validator }`. **All writable accounts in an ER transaction must be delegated to the same validator,** so the room and all positions go to the TEE.
- **Custody:** real USDC (mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) sits in a **base-layer vault that's never delegated**. Game state moves at ER speed and money only moves on L1 at settle. This is the "base-layer custody + post-commit payout" model in `/pages/solutions/prediction-markets.md`. Ephemeral SPL tokens aren't needed for v1.
- **Settlement:** an explicit L1 `settle` instruction, *not* a Magic Action. Magic Actions aren't atomic with the commit (`/pages/ephemeral-rollups-ers/magic-actions/overview.md`), and an explicit call is easier to verify. A Magic Action can be added later as a convenience trigger.

---

## 4. Accounts and PDAs (all under 10,240 bytes; the commit limit is in `/pages/ephemeral-rollups-ers/introduction/runtime-limits.md`)

Sizes include the 8-byte Anchor discriminator. Keep seeds short, because delegation metadata deposits grow with seed size (`/pages/ephemeral-rollups-ers/introduction/fees-and-commit-economics.md`).

| Account | Seeds | Lives | Delegated? | Fields (bytes) | Size |
|---|---|---|---|---|---|
| `Config` | `["cfg"]` | L1 | no | admin 32, fee_bps 2, fee_vault 32, usdc_mint 32, min_entry 8, max_entry 8, paused 1, bump 1, reserved 32 | **156** |
| `Room` | `["room", room_id:u64 LE]` | L1, then TEE | **yes (public)** | room_id 8, creator 32, mint 32, entry_amount 8, max_seats 1, seats_filled 1, status 1, fee_bps 2, assets [u16;3] 6, feed_accounts [Pubkey;3] 96, created_ts 8, fill_expiry 8, start_ts 8, end_ts 8, next_checkpoint 1, checkpoint_ts [i64;5] 40, players [Pubkey;16] 512, alive u16 2, elim_checkpoint [u8;16] 16, public_rank [u8;16] 16, final_equity [u64;16] 128 (written only at end), finalists [u8;3] 3, storm_kind 1, storm_asset 1, storm_side 1, storm_until 8, vrf_seed [u8;32] 32, crank_task_id 8, settled 1, vault_bump 1, bump 1, reserved 64 | **~1,180** |
| `Position` | `["pos", room, player]` | L1 init, then TEE | **yes (PRIVATE)** | room 32, owner 32, seat 1, side i8 1, leverage 1, asset_idx 1, entry_price i64 8, equity_at_open u64 8, equity u64 8, last_action_ts 8, actions u32 4, liquidated 1, alive 1, bump 1, reserved 32 | **147** |
| `EphemeralPermission` (per Position) | created by the Permission Program on the ER | TEE | n/a | `EphemeralPermission::size_of(1)` (one member: owner) | small; rent pre-funded into the Position at init (PER quickstart) |
| `Vault` | ATA-style token account, authority `["vault", room]` PDA | L1 | **never** | SPL token account | 165 |
| `Rating` | `["elo", player]` | L1 | no | player 32, elo i32 4, games u32 4, wins u32 4, top3 u32 4, best_equity u64 8, last_room 8, bump 1, reserved 16 | **89** |
| `SessionToken` | session-keys program | L1 (readable on the ER) | no | V1 `SessionToken` | per the session-keys crate |

**Privacy note:**
- `Room` is public, and it contains **no live equity**. It only holds `alive`, `public_rank` (written at checkpoints) and `final_equity` (written at the end).
- Publishing live equity would let rivals infer side and leverage from equity changes against price.

---

## 5. Lifecycle and instruction list

### 5.1 L1 (mainnet) instructions
| Ix | Signer | Effect |
|---|---|---|
| `init_config(fee_bps, fee_vault, usdc_mint, min/max_entry)` | admin | Creates Config |
| `update_config(...)` / `set_paused(bool)` | admin | Pause blocks new rooms and joins only. It never blocks refunds or settle. |
| `create_room(room_id, entry_amount, max_seats, assets[], fill_secs)` | creator | Creates Room and the vault. Validates the feed PDAs against the pinned list (§5.6). |
| `join_room()` | player | USDC `transfer_checked` into the vault. Inits Position, pre-funded for permission rent per the PER quickstart. Inits Rating if needed. Adds the player to the seat list. |
| `delegate_position()` | player (same tx as join) | `delegate_pda` of Position to the TEE validator |
| `start_room()` | anyone (time/fill-gated) | Sets status=Starting, then `delegate_pda` of Room to the TEE |
| `cancel_room()` | anyone after `fill_expiry` with `seats < min` | Refunds all from the vault. Positions are undelegated via the ER `cancel_er` path first if they're delegated. |
| `settle()` | anyone | Requires Room owned by the program again (undelegated), status=Ended and `settled == false`. Pays the fee and prizes from the vault to the winners' USDC ATAs, updates Ratings and sets `settled=true`. |
| `close_position()` | owner, after settle | Reclaims rent |

### 5.2 ER (TEE) instructions
| Ix | Signer | Effect |
|---|---|---|
| `init_permission()` | owner or any, idempotent | `CreateEphemeralPermissionCpi` for Position, with the members list `[owner]` and flags `TX_LOGS \| TX_MESSAGE \| TX_BALANCES`, then `UpdateEphemeralPermissionCpi(is_private=true)` (PER quickstart; `/how-to-guide/access-control.md`) |
| `begin_round()` | anyone; requires all positions delegated and permissioned | Sets `start_ts` and the checkpoint times. Schedules the crank task (§6.4). Requests the first VRF storm. |
| `set_position(side, lev, asset_idx)` | **session key** or owner (`#[session_auth_or]`) | Checks: alive, round live, ≥ 2 s hold, leverage ≤ cap (storm-aware), Freeze rule, fresh oracle (§5.6). Closes the old position at P_now (realizes PnL, applies bleed), opens the new one, charges 5 bps. |
| `eliminate()` | crank / anyone after `checkpoint_ts[k]` | Idempotent on `next_checkpoint`. Reads all positions and feeds, marks to market, applies bleed and spotlight, cuts per §2.4, writes `public_rank`, requests the next storm. |
| `request_storm()` (internal CPI) | — | `create_request_randomness_ix_const` on `DEFAULT_EPHEMERAL_QUEUE` `5hBR…K5Tc`, callback `callback_storm` with the Room account (VRF quickstart) |
| `callback_storm(randomness)` | VRF program identity (`#[vrf_callback]`) | Sets the storm fields. On the first call it stores `vrf_seed` for tie-breaks. |
| `end_round()` | crank / anyone after `end_ts` | Final mark to market and ranking. Writes `final_equity` and `finalists`. Flips every position to public. Calls `commit_and_undelegate([room, positions…])` via `MagicIntentBundleBuilder` (ER quickstart). |
| `cancel_er()` | anyone, only if the round never began | Commits and undelegates for the refund path |

**Transaction size:** `eliminate` and `end_round` touch the room, up to 16 positions, 3 feeds and the clock, roughly 21 accounts. That's fine within the ER's 64 KB transaction limit (runtime-limits page). The 1.4M CU budget should be enough for a 16-element sort. Measure it and request a higher CU limit via `SetComputeUnitLimit` if needed.

### 5.3 Happy-path sequence
1. Creator: `create_room` on L1.
2. Players: `join_room` + `delegate_position` in one L1 transaction (one popup). The client then creates a session key (gum-react-sdk `useSessionKeyManager`, valid 1 h, scoped to `royale`) and fetches a TEE auth token.
3. Anyone: `start_room` on L1, which delegates the Room.
4. Client (any player): `init_permission` × N on the TEE, then `begin_round`.
5. Players: `set_position` on the TEE, signed by the session key with no popup.
6. Crank: `eliminate` at 1, 2, 3, 4 and 5 minutes, with `callback_storm` after each.
7. Crank: `end_round` at the 6-minute mark, which commits and undelegates.
8. Relayer or anyone: wait until the Room owner is `royale` again on L1, then call `settle` and verify the USDC transfers on L1.

### 5.4 Delegation, commits and costs (mainnet, from the fees page)
- **Per room:** 1 Room plus N Position delegations. Each session is 0.003 SOL, taken from a deposit of about 2.8–3.3M lamports funded at delegation.
- **Commits:** the only planned commit is the final `commit_and_undelegate`, so there are no extra 0.001 SOL commits.
- **Example:** a 16-player room costs about 17 × 0.003 = **~0.051 SOL** of MagicBlock fees.
- **Who pays:** each player funds their own Position deposit in `join_room` (about 0.003 SOL plus rent), and the room starter funds the Room deposit.
- ER transactions and ER VRF are free (pricing page).
- **Mainnet program deploy costs real SOL** for rent on the program data. Check it with `solana rent <program.so bytes>` before deploying. It is not estimated in this spec.

### 5.5 Session keys (`/pages/tools/session-keys/*`)
- Rust: `session-keys = { version = "3.1.1", features = ["no-entrypoint"] }`, with `#[derive(Session)]` on the `SetPosition` accounts struct and `#[session_auth_or(ctx.accounts.position.owner == ctx.accounts.signer.key(), ...)]`.
- The session token holds only the wallet, the target program, the signer and the expiry. **Our program enforces the scope:** the session can only call `set_position`. It has no token authority and can't call `join` or `settle`.
- Client: `@magicblock-labs/gum-react-sdk` (`SessionWalletProvider`, `useSessionKeyManager`), with a 60-minute expiry.

### 5.6 Pyth Lazer feeds on the ER (`/pages/tools/oracle/implementation.md`)
- PDA: `["price_feed","pyth-lazer", <pyth_lazer_id decimal string>]` under `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`.
- Decode with `PriceUpdateV2::try_deserialize_unchecked`, using the **exponent from the list, not from the account**. Pin both the PDA and the owner.
- Use `get_price_no_older_than(clock, MAX_AGE, feed_pda_bytes)`. Our `MAX_AGE` is **3 s** for actions and eliminations. If the price is stale, `set_position` reverts and `eliminate` defers by up to 10 s and then uses the last good price.

**Room asset whitelist v1.** These PDAs were derived and read live on **mainnet-tee**; all were updating.

| Asset | pyth_lazer_id | exponent | Feed PDA | Sample price read |
|---|---|---|---|---|
| SOL/USD | 6 | -8 | `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu` | 70.22 |
| BTC/USD | 1 | -8 | `71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr` | 60,685.76 |
| ETH/USD | 2 | -8 | `5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG` | 1,704.86 |
| BONK/USD | 9 | -10 | `4WWpu2fva3uZjmZS95fezYFfoydmYi3PU7ApnqG9cYss` | 0.0000020885 |
| WIF/USD | 10 | -8 | `Cy6KSY9DCcJ5HiKL3H4ir6XiSC1PczCCJj7LEe9Y8A7x` | 0.12045 |
| FARTCOIN/USD | 182 | -8 | `CVFcoSKcJZGMDv9xJWNERXxHjs7KcT3RYBPLCHdG2Jok` | 0.07814 |
| POPCAT/USD | 130 | -8 | `AuiyyRtjbTfrnoALr48n8yzXTNYN96Q2Rrh9bBirLHdc` | 0.02466 |
| HYPE/USD | 110 | -8 | `CxEkVoCUwSAprvAhdWRPH63JeioQVNDtyZYEMRXuLu6x` | 62.73 |

The full list has 125 feeds: https://github.com/magicblock-labs/real-time-pricing-oracle/blob/main/pyth_lazer_list.json

### 5.7 Private ER permissions for hidden positions
- Each Position gets an `EphemeralPermission` with `is_private = true` and members `[owner]`.
- Our program executes inside the TEE, so `eliminate` can read every position. Other wallets reading through the TEE RPC get nothing back.
- At `end_round` the program flips every position to `is_private = false` (`UpdateEphemeralPermissionCpi`) so the replay is auditable. The data also lands on L1 at commit.
- **Demo proof:** call `getAccountInfo(position_of_rival)` with player B's token and show it's denied or empty, then call it with A's token and show the data.

---

## 6. Crank schedule and VRF

### 6.1 Crank (`/pages/tools/crank/implementation.md`, validator 1.1.1)
- `begin_round` CPIs `MagicBlockInstruction::ScheduleTask` (crate `magicblock-magic-program-api = "0.10.1"`). The task is the `eliminate` instruction with fixed accounts (room, positions, feeds), `execution_interval_millis = 60_000` and `iterations = 6`.
  - The 6th run is `end_round`. Either make `eliminate` dispatch `end_round` when `now ≥ end_ts`, or schedule a separate task.
- **Task ID:** derive it from `hash(program_id, room_id)` truncated to i64. **Never hardcode it.** On 1.1.1, task IDs are shared across programs on a validator, and a collision makes the task silently never run (crank docs warning).
- **Public callability:** scheduled instructions are ordinary instructions, so `eliminate` and `end_round` are **permissionless but time-gated and idempotent**. They take no user-supplied parameters and only read the clock, oracle and accounts. The crank docs warn about exactly this.

### 6.2 VRF (`/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart.md`)
- `request_storm` uses `RequestRandomnessParams { payer, oracle_queue: DEFAULT_EPHEMERAL_QUEUE, callback_program_id: crate::ID, callback_discriminator: CallbackStorm, caller_seed: hash(room, checkpoint), accounts_metas: [room (writable)] }` and signs with `program_identity_pubkey(&crate::ID)`.
- `#[vrf_callback]` on `callback_storm` enforces the program's scoped VRF identity. Don't check the deprecated global identity `9irBy75…vAw`.
- Validate `oracle_queue` against the SDK constants.
- ER VRF is free and targets <50 ms (pricing page). The Boost counts VRF requests **on mainnet** (build site), and we're on mainnet.

### 6.3 Ordering
- If a storm callback is late, the previous storm expires at `storm_until`, and the game continues with no storm.
- Only the first callback after a request is accepted. A `pending_request` checkpoint index is stored inside the reserved bytes.

### 6.4 Crank fallback (if TEE cranks don't fire)
- The relayer service watches the clock and calls `eliminate` and `end_round` at each checkpoint using its own fee-free ER transaction.
- Any player's client also calls it if the checkpoint is more than 3 s overdue. Because the instructions are time-gated and idempotent, the result is identical.

---

## 7. Client and services

### 7.1 Web app
- Next.js 15 + React PWA, mobile-first (reuse the Front Run UI patterns).
- **Login:** Privy (email/Google, with a Solana embedded wallet that can sign messages for the TEE auth token, as in Front Run) **or** Phantom/Backpack via `@solana/wallet-adapter`.
- **Connections:**
  - L1: a mainnet RPC (Helius or Triton). The public `api.mainnet-beta` is too rate-limited for production.
  - TEE: `https://mainnet-tee.magicblock.app?token=…` per user, after `verifyTeeRpcIntegrity`.
- **Screens:**
  - **Lobby:** open rooms, entry, seats, assets, countdown.
  - **Room:** big Long, Short and Flat buttons, a leverage chip, an asset tabs price chart (oracle account subscription on the TEE), your equity (private, read with your own token), elimination countdown, storm banner with VRF link, and an "alive" ring of 16 avatars.
  - **Eliminated / Victory:** an animated screen with a share-to-X card. The player shares it themselves.
  - **Profile:** Elo, games, wins, best run.
- **Live onchain counter:** a running count of your ER transactions with explorer links. This is the "every tap is onchain" proof.

### 7.2 Spectator board
- The Room is public, but spectators may not hold a TEE token. The **relayer** holds its own token, subscribes to the Room, and rebroadcasts `alive`, `public_rank`, storm and prices over a websocket, served at `/watch/:roomId`.
- After the round, the full position replay comes from L1 (committed, public) plus our indexer.

### 7.3 Relayer / indexer (small Node service)
- Crank backup (§6.4).
- Spectator feed.
- Calls `settle` once undelegation lands, then verifies the USDC transfers on L1 and only then marks the room "Paid" in the UI.
- Keeps no custody and holds no user keys. Its fee-payer wallet is a Boost address.

### 7.4 Skill rating (Elo)
- On L1 `settle`, each player's rating updates pairwise against the field: K = 24, expected score from the rating difference, and actual score from the final placement percentile.
- New players start at 1200. The rating is stored in `Rating["elo", player]`. It feeds the lobby ("rated rooms") and is the long-term data moat (copy-the-champion and agent seats later).

---

## 8. Security and threat model

| Threat | Mitigation |
|---|---|
| **Crank manipulation / early calls** | `eliminate` and `end_round` are permissionless, but hard-gated on `now ≥ checkpoint_ts[k]` and idempotent via `next_checkpoint`. They take no arguments, and all inputs come from the clock, pinned oracle feeds and program accounts. |
| **Price staleness or spoofed feed** | Pin the feed PDA and owner (`PriCems5…`). Use `get_price_no_older_than` with 3 s. The docs warn that anyone can create a not-yet-existing feed account (it starts as `Full` with price 0), so check `price > 0` and pin addresses at `create_room`. |
| **Latency arbitrage vs the 50–200 ms feed** | 5 bps spread per open, 2 s minimum hold, and execution at the onchain price only. |
| **Position leak** | TEE permission is owner-only. Room has no live equity. Ranks are published once per minute only. The client never logs other players' data. Flip to public only at end. |
| **Collusion / sybil hedging** (two wallets on opposite sides) | Not fully preventable. Mitigations: one seat per wallet; entry cost per seat; top-heavy payouts; Elo-gated rooms; post-round reveal plus an indexer heuristic that flags pairs with mirrored positions; and private invite rooms for streamers. |
| **Griefing: empty joins / never playing** | They pay entry and get bled by the zone. `cancel_room` refunds if the room doesn't fill. `set_position` is rate-limited by the 2 s hold. |
| **Spam on the ER** | Free transactions, but the 2 s hold and the spread cap what's useful. Invalid calls just revert. |
| **Session key abuse** | Scoped to `set_position`, 1 h expiry, revocable. Never token authority. Funds only move on L1 with the owner's or the program's signature. |
| **Escrow safety** | The vault authority is a PDA. Only `settle` and `cancel_room` move funds. `settle` is once-only (`settled` flag), requires the Room to be undelegated and owned by `royale`, and `status == Ended`. Payout ATAs must match `players[i]` and the USDC mint. All math is checked u64 with explicit rounding, and dust goes to the fee vault. The sum of payouts plus fee is asserted to equal the vault balance. |
| **Magic Action non-atomicity** | Not used for payouts, so it's not applicable. |
| **Stuck delegation** (ER outage) | `end_round` is permissionless after `end_ts`. If the ER is unavailable, funds stay in the L1 vault, which is safe but locked until undelegation. **Known limitation of v1:** there's no admin override that can move user funds. We document this honestly in the README. |
| **VRF callback spoofing** | `#[vrf_callback]` with the scoped identity. Only a pending request is accepted. |
| **Task-ID collision** (crank never runs) | Derived unique ID, plus the relayer fallback. |
| **Upgrade authority** | It's a mainnet program, so state the upgrade authority in the README (the owner's hardware wallet). Consider freezing upgrades after the hackathon. |
| **Keys** | Deploy and admin keys stay on the owner's machine and hardware wallet, never on build servers or in the repo. |

**Tests:** Rust and LiteSVM unit tests for mark-to-market, liquidation, bleed, cut counts for 4–16 seats, the tie hash, the payout split with dust, settle-once, wrong ATA, stale or spoofed feed, early `eliminate`, and session scope.

---

## 9. Fallback plan

| Trigger | Fallback |
|---|---|
| **The mainnet TEE rejects our delegation or permission flow, or `getAuthToken` fails from our network (smoke tests T1, T2 or T4 fail)** | **Fallback A:** delegate to a **public mainnet ER** (`as.magicblock.app`, `MAS1Dt9q…zk57`) and drop `init_permission`. Everything else is identical. Positions are then readable onchain. The UI still hides them, and the pitch says "sealed on TEE" is the next step. Also show the TEE privacy on **devnet-tee** (verified live) as a 20-second segment of the demo. |
| TEE cranks don't fire (T1 smoke test) | Relayer and client time-gated calls (§6.4). Same outcome. |
| VRF callback is flaky on the TEE | The storm is skipped for that minute and the game continues. The demo shows a successful one, retried at the next checkpoint. |
| Mainnet deploy blocked (SOL, or a size issue) | Deploy to devnet with the same code and run the TEE on devnet. Submit with mainnet as the stated target. Note that VRF won't count in the Boost (the Boost counts VRF on mainnet only). |

---

## 10. Demo script (3 minutes)

1. **0s–15s. Hook.** "Sixteen traders. Real prices. Hidden positions. One minute to survive. All on Solana mainnet."
2. **15s–40s.** Log in with Privy, join a $1 USDC room (one popup), and show the Solscan transaction: USDC into the vault, Position delegated to MagicBlock's TEE. Create the session key and show "no more popups".
3. **40s–85s.** The round starts. Tap Long SOL, flip Short, switch to BONK. Each tap increments the onchain transaction counter on the TEE, with links. A storm hits: "Spotlight: BONK 2× PnL", shown with its VRF transaction.
4. **85s–115s.** **Privacy proof.** In a split screen, player B queries player A's position through the TEE and gets nothing. Player A sees their own.
5. **115s–145s.** The 1-minute crank fires and three players are eliminated (explorer link to the crank-executed `eliminate`). Fast-forward to the finalists.
6. **145s–165s.** End of round: positions flip to public, commit and undelegate, `settle` on L1. Show the Solscan USDC payouts to winners and the 5% to the fee vault, plus the Elo update.
7. **165s–180s.** Business (fee per room, sponsored tournaments, pro tier, rating moat) and the stack (PER, VRF, cranks, session keys, Pyth Lazer on ER, L1 custody). End with the link and the X handle.

---

## 11. Smoke tests (run first, before writing game logic)

| Test | Pass condition |
|---|---|
| **T1:** deploy the `crank-counter` example to mainnet, or devnet first, then delegate to **mainnet-tee** and schedule a 1 s × 5 task | The counter increments 5 times on the TEE |
| **T2:** `private-counter` flow on mainnet-tee (`init_permission`, `set_privacy`) with two wallets | Wallet B can't read and wallet A can |
| **T3:** VRF `roll-dice` with `DEFAULT_EPHEMERAL_QUEUE` on mainnet-tee | The callback lands in under 1 s |
| **T4:** `getAuthToken` from the owner's own network and the planned server region | A token is returned |
| **T5:** read the SOL feed inside a program on mainnet-tee with `get_price_no_older_than(3s)` | No staleness error |

Examples: https://github.com/magicblock-labs/magicblock-examples (`crank-counter`, `private-counter`, `roll-dice`, `session-keys`, `binary-prediction`, `sealed-auction`, `rock-paper-scissor`).
Install the agent skill with `npx skills add https://github.com/magicblock-labs/magicblock-dev-skill`.

---

## 12. Submission checklist (build.magicblock.app/?stage=blitz#submit; Telegram login, submitted by the project owner)

- [ ] Builder profile complete (roles, proof of work, country). Confirm "Solana Blitz v10" appears under "Submitting for" (it showed "No open events" while logged out).
- [ ] First and last name, email, country, roles.
- [ ] **Wallet** to receive prizes.
- [ ] Project name **PnL Royale**. Description of 2–3 sentences. Categories: **Games, DeFi, Social** (up to 3).
- [ ] **Project website** (the live PWA URL).
- [ ] **GitHub repo**, public and accessible, with a README covering architecture, program IDs, threat model and how to run.
- [ ] **Pitch & Demo** link (the 3-minute video, YouTube or Loom).
- [ ] **Explorer link** as integration proof: a mainnet delegation transaction to the TEE plus the program address on Solscan.
- [ ] **Boost, onchain addresses:**
  - (1) the `royale` **program ID**, which counts delegations and VRF requests on mainnet
  - (2) the **relayer / fee-payer wallet**
  - (3) the **fee vault**. Only Private Payments fees count there, and we don't use Private Payments in v1, so it's optional.
  - The site scans the latest 100 transactions per address, so run real rounds close to submission time.
- [ ] Your X account, and teammates' Telegram handles.
- [ ] Submit as soon as the checklist is complete.

---

## 13. Build sequence (ordered by dependency, ship ASAP)

| # | Milestone | Depends on | Exit criteria |
|---|---|---|---|
| M0 | **Setup:** builder profile and Telegram Builders group (owner); confirm Blitz v10 appears in the submit dropdown; funded mainnet deployer wallet held on the owner's machine/hardware wallet (never in the repo). Toolchain: Solana 3.1.9, Anchor 1.0.2, Rust 1.89, `ephemeral-rollups-sdk` 0.18 (`anchor`, `access-control`, `vrf`). Clone the examples. | — | The examples build locally |
| M1 | **Smoke tests T1–T5** (§11) on mainnet-tee | M0 | All pass, or the matching fallback in §9 is selected |
| M2 | **Program core:** Config, Room, Position, Vault, Rating; `create_room`, `join_room` (USDC escrow), `delegate_position`, `start_room`, `init_permission`, `begin_round`, `set_position` with oracle reads and session keys | M1 | One wallet joins with real USDC on mainnet and trades on the TEE without popups |
| M3 | **Client shell:** Next.js PWA, Privy/Phantom login, dual connections (L1 + TEE), TEE integrity check and auth token, session key manager, room screen | M2 (IDL) | M2's flow works from the browser |
| M4 | **Round engine:** `eliminate` (cut math, tie hash, zone bleed, spotlight), crank scheduling with a derived task ID, VRF storms (`request_storm`/`callback_storm`), `end_round` with reveal and commit+undelegate | M2 | A full round runs on the TEE with crank-fired cuts and at least one storm |
| M5 | **Settlement:** L1 `settle` (payouts, fee, Elo), `cancel_room`/`cancel_er` refund path, `close_position` | M4 | A **4-wallet mainnet round pays out real USDC**, verified on Solscan |
| M6 | **Relayer/indexer:** crank backup (§6.4), spectator websocket, settle caller with L1 payout verification | M4, M5 | The round completes even with the crank disabled; `/watch/:roomId` is live |
| M7 | **Product polish:** lobby, Elo profile, storm banners with VRF links, elimination/victory screens, onchain tx counter, mobile layout | M3–M6 | A 6–8 player round feels smooth on phone and desktop |
| M8 | **Hardening:** the §8 test list, a self-audit pass, compute-unit measurements for `eliminate`/`end_round`, README with architecture, program IDs, upgrade authority and threat model | M5 | All tests green; CU within budget |
| M9 | **Deploy and prove:** production frontend and relayer; run several 8+ player mainnet rounds so Boost addresses show fresh delegations and VRF requests | M7, M8 | Live URL is stable; explorer links collected |
| M10 | **Demo and submit:** record the 3-minute demo (§10), write the submission copy, complete the §12 checklist | M9 | Submitted |

Parallelism: M3 can start once M2's IDL exists; M6 and M7 can run alongside M8.

## 14. Post-hackathon roadmap (business)
- **Revenue:** a 5% fee per paid room; sponsored tournaments where token projects pay for free-entry royales on their asset (the oracle can add arbitrary feeds per `/pages/tools/oracle/introduction.md`); a pro tier (replays, opponent stats, private streamer rooms); and spectator pools.
- **Product:** squads, agent seats (bots run by cranks), seasons with leaderboards, Telegram mini-app rooms, Seeker dApp store.
- **Path:** apply to MagicBlock **Forge** (mainnet growth, engineering hours, marketing push, intros), then **Founders Camp** (investors), as described on build.magicblock.app.

## 15. Open items
1. Cranks inside the mainnet TEE are undocumented, so smoke test T1 settles it.
2. The TEE ingress geofence list isn't published, so test T4 settles reachability.
3. Exact mainnet program deploy cost: run `solana rent` on the built `.so`.
4. The submit form logged out showed no open events, so confirm after login.
