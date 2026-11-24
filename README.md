# PnL Royale

**Battle royale for traders.** Up to 16 players stake USDC on Solana and trade live Pyth Lazer prices with **hidden positions** sealed inside MagicBlock's Private Ephemeral Rollup (TEE). Every interval an **onchain crank** cuts the lowest equity, **VRF storms** change the rules, and the finalists split the pot in USDC on Solana L1. Players sign one wallet popup to join. After that, every trade is a gasless ER transaction signed by a browser session key.

Built for MagicBlock Solana Blitz v10 (Entertainment Finance). **Live on Solana devnet with MagicBlock's devnet TEE.** That's the same validator build as mainnet, and mainnet is prepped and waiting on the deploy deposit.

### Try it

Open the app and click **⚡ Play instantly**. A devnet burner wallet is created in your browser, and the built-in faucet tops it up with devnet SOL and test USDC when you create or join a room. Phantom and Backpack on devnet work too. When you take a seat, **three labelled house bots join automatically**, so every room reaches the four-player minimum. Invite more people with the room link, or press **Start** as the room's host at any point from four players up.

Demo script: [`docs/DEMO.md`](docs/DEMO.md) · Submission copy: [`docs/SUBMISSION.md`](docs/SUBMISSION.md)

| | |
|---|---|
| Program | `royale` (Anchor 1.0.2, `ephemeral-rollups-sdk` 0.18.0), ID `7t2L4552mactTH9NiCcGQ3LeUgCBYi81B1qMfGTeRBJ5`: **live on devnet** ([Solscan](https://solscan.io/account/7t2L4552mactTH9NiCcGQ3LeUgCBYi81B1qMfGTeRBJ5?cluster=devnet)), mainnet-ready |
| Private ER | `https://mainnet-tee.magicblock.app`, validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (devnet TEE runs the same build, `1.1.1 / 8886db2`) |
| MagicBlock features | PER permissions · delegation · commit + undelegate · cranks (`ScheduleTask`) · VRF (scoped identity) · session keys (V2) · pricing oracle on the ER |
| Money | Real USDC in an L1 escrow PDA that is never delegated; only `settle` (winners) or `refund` (cancel) can move it |

---

## What's verified

### Live on the devnet TEE (same validator build as mainnet: `magicblock-core 1.1.1`, `8886db2`)

Two full rounds ran end to end with real wallets, using `scripts/e2e-round.ts` and checked by `scripts/verify-room.ts`. Logs with every signature are in [`docs/devnet-runs/`](docs/devnet-runs/).

| Spec smoke test | Result on devnet-tee |
|---|---|
| **T1** crank inside the TEE | ✅ The crank task scheduled by `begin_round` (Room PDA as authority) fired all 5 cuts plus the final bell on the 20 s schedule (`ticks=6`), with no relayer running |
| **T2** private positions | ✅ Player B's TEE token reads A's position as **hidden**; A's session key reads it |
| **T3** VRF on the TEE | ✅ A storm callback landed for **every interval** (`storms=4,2,2,4,2,1`), the first within about 1 s of `begin_round` |
| **T4** TEE auth from our network | ✅ Attestation verified (also inside the browser) and tokens issued for the admin and every session key |
| **T5** oracle inside the program | ✅ 36 `set_position` calls priced from Pyth Lazer feeds on the TEE with the 3 s freshness gate |

| Round | Result |
|---|---|
| 4 players, room `ELY9pZc1…KnU6b` | Ended early with 1 finalist. **Winner paid 3.80 test-USDC (95% of $4), fee vault +0.20**, Elo +12/+4/−4/−12, all positions public on L1 |
| 6 players, room `68W1k9Ku…w6Qj` | Full 6 intervals, 2 finalists. **Paid 3.99 / 1.71 (70/30 of 5.70), fee vault +0.30**, 36 session-key trades at **644 ms average** round trip from our machine to the TEE |

Devnet addresses: config `46U3F8wHvwk1WdNZeVRYy64Tyw1mYKhpdXqwq3acfiAS`, test USDC mint `THPHkxhRHRJE3oVWMpPqQ82F3TCWVUY5rHUxotjfQre`, fee vault `Gw1gDLvq45wJMYCFLmTzQabXxyAqyPjUforwsrRKfdYu`, upgrade authority `G8kNpxodhUqKyV6pByF5qKXqbxsExBR86vnTd8dB8338` (a devnet-only key).

**Played in the browser:** a third round was played end to end in the app itself, as a judge would. One click on Play instantly, create a 4-seat room (the faucet funded the burner), join in one transaction, and `scripts/bots.ts` filled the other seats. The browser then sealed the positions and began the round itself, and a session-key trade landed in 600 ms with no popup. Sealed equity was readable only by the player, crank cuts landed live, and the browser committed and undelegated the results. The result: **won #1 of 4, 3.80 test-USDC paid to the burner wallet.**

The live runs caught client bugs the Rust tests couldn't:
- Anchor TS account names and casing (the client must use the Program's camelCase coder).
- Foreign `Room` accounts in the lobby: every Anchor program with a `Room` account shares the discriminator, so delegated rooms are now accepted only at our PDA.
- A crash in the live-equity estimate (a fractional clock passed to `BigInt`).

All three are fixed.

### Local test suite

Everything below runs with `npm run test:program`.

**Unit tests (21, `programs/royale/src/game.rs`, `state.rs`):** mark-to-market, liquidation, zone bleed, spotlight, spread, cut schedule for 4–16 seats (16 → 3/3/3/2/2), tie-break hash, payouts with tie pooling and dust, fee math, Elo, storm derivation, freeze/leverage rules, overflow bounds, account sizes.

**MagicSVM integration tests (7, `tests-magicsvm/tests/round.rs`):** the compiled `royale.so` runs in-process on a base ledger plus an ephemeral ledger, using the real Delegation, Magic, Permission and VRF programs:

| Test | Proves |
|---|---|
| `full_private_round_pays_out_on_l1` | 8 players: USDC escrow → delegate to ER → owner-only permissions → **a rival can't read your position, you and your session key can** → popup-free trades → hold-time and auth rejections → early tick is a no-op → **crank-executed cuts** → **VRF storms land via authenticated callback** → 3 finalists → commit + undelegate → `settle` pays **4.56 / 2.28 / 0.76 USDC + 0.40 fee = 8.00 pot exactly** → double-settle rejected → Elo → rent reclaim |
| `sixteen_seats_cut_schedule_and_compute_budget` | alive after each minute 13, 10, 7, 5, 3 (spec schedule). Worst-case crank `tick` **84k CU**, `finalize_round` 113k CU (of 200k) |
| `four_player_room_ends_early_with_single_winner` | 4 seats end when 1 remains. Winner gets 95% of $4. Payout to a loser's ATA is rejected |
| `host_starts_early_with_four_seats` | an 8-seat room with 3 players can't start; with 4, a player who isn't the host is rejected and the host succeeds. The short-handed round runs to one finalist |
| `session_key_trades_without_wallet_popups` | the real session-keys program (dumped from mainnet): a `SessionTokenV2` trades for its owner, can't touch another player, is useless without a token, and is rejected after expiry |
| `unfilled_room_refunds_everyone` | no start short-handed, no refund before expiry, full refunds after, idempotent, positions released from the ER and closed |
| `decodes_live_mainnet_tee_feed_bytes` | the oracle decoder accepts a real SOL/USD account dumped from the mainnet TEE (and rejects wrong addresses) |

**Live mainnet checks** (read-only, `npx tsx scripts/smoke-tee.ts`): TEE remote attestation verified, an auth token issued from our network (smoke test T4), and all 8 whitelisted feeds live on the TEE at about 0.4 s age.

**Not yet verified:**
- **The mainnet deploy:** it needs about 3.9 SOL, almost all a refundable rent deposit. Everything else in the mainnet preflight passes.
- **A browser extension wallet signing in the UI:** the browser round used the burner wallet, which goes through the same wallet-adapter `signTransaction` path.

---

## Architecture

```
            Solana L1 (mainnet)                                  MagicBlock Private ER (TEE, 50 ms blocks)
 ┌──────────────────────────────────────┐   delegate    ┌──────────────────────────────────────────────────┐
 │ Config · Rating[player]              │ ────────────► │ Room (public: alive, ranks, storms, results)     │
 │ Room (pre-start) · Position (init)   │               │ Position[i] (PRIVATE: owner + session key)       │
 │ Vault = USDC token PDA (never moves  │               │  set_position ◄─ session key, gasless, no popup  │
 │   to the ER)                         │               │  tick       ◄─ crank task #1 every 2 s (no-op     │
 │ settle(): USDC → finalists, fee      │ ◄──────────── │               until a checkpoint is due)         │
 │ rate_room(): Elo                     │ commit +      │  request_storm ◄─ crank task #2 → VRF → callback │
 └──────────────────────────────────────┘ undelegate    │  Pyth Lazer feeds (PriCems…) read every action   │
            ▲ USDC in/out                                └──────────────────────────────────────────────────┘
   Players' wallets ── Next.js PWA (one popup to join) ── relayer (crank backup, orchestration, settle, index)
```

### Round lifecycle

1. **`create_room`** (L1): entry, seats (4–16), 1–3 whitelisted assets, interval (15–300 s, default 60), private flag. Creates the USDC vault PDA.
2. **`join_room` + `delegate_position` + `create_session_v2`** (L1, **one transaction, one popup**): escrow the entry, init the Position (pre-funded for permission rent), delegate it to the TEE, and register a 1-hour browser session key. The session key is stored as the position's **viewer**.
3. **`start_room`** (L1): needs 4 or more seats. The room's creator may start at any time; anyone may once the room is full or the fill window has passed. Locks the roster and delegates the Room.
4. **`init_permission`** (ER, anyone, idempotent): owner-only `EphemeralPermission` with members `[owner, viewer]`.
5. **`begin_round`** (ER, anyone): starts the clock and schedules two crank tasks with the **Room PDA as task authority**: `tick` and `request_storm`.
6. **`set_position(side, lev, asset)`** (ER, session key): closes at the oracle price (realizing PnL or zone bleed), opens the new position, and charges 5 bps on notional. Enforces a 2 s hold, the leverage cap (25× during a Surge) and the Freeze side.
7. **`tick`** (ER, crank, permissionless, time-gated, idempotent): at each checkpoint it marks every alive position, re-bases it (so storms never cross interval boundaries), cuts the lowest `ceil((alive − finalists)/checkpoints_left)` plus anyone liquidated (at least one always survives), and publishes ranks. The final checkpoint writes placements and finalists.
8. **`request_storm` → `callback_storm`** (ER): the Room PDA pays the fee-exempt ER queue and signs with the program's scoped VRF identity. The first callback per interval sets that interval's storm and seeds the tie-break hash.
9. **`finalize_round`** (ER, anyone, once Ended): cancels both crank tasks, then commits and undelegates the Room and every Position. On L1, every trade is public.
10. **`settle`** (L1, anyone, once): pays the finalists from escrow. The fee plus all dust goes to the fee vault, so payouts plus fee equal the vault balance exactly. The empty vault is closed.
11. **`rate_room`** (L1, anyone, once): pairwise Elo against the field (K=24).

**Exit paths:** `refund` (L1, resumable per seat) when a room never fills; `abort_round` (ER) if `begin_round` never happens within 5 minutes of `start_room`, followed by `refund`; `release_position` (ER) for positions of rooms that never started; `close_position` (L1) to reclaim rent.

### Accounts

| Account | Seeds | Size | Delegated |
|---|---|---|---|
| Config | `["cfg"]` | 164 | no |
| Room | `["room", room_id u64 LE]` | 1,096 | yes (public) |
| Position | `["pos", room, player]` | 188 | yes (private) |
| Vault (USDC token account) | `["vault", room]`, authority = Room PDA | 165 | **never** |
| Rating | `["elo", player]` | 89 | no |

---

## Findings that changed the spec

These came from reading the SDK and validator source and from the tests. Each is reflected in the code.

1. **Oracle feeds are `PriceUpdateV3` accounts with a wrong stored exponent (+8).** We pin the address and owner, borsh-decode Pyth's `PriceUpdateV2` body after the discriminator, require `posted_slot > 0`, `Full`, `price > 0` and a 3 s upstream age, and **only use price ratios**, so the exponent cancels. The display exponent comes from `pyth_lazer_list.json`.
2. **Session keys must be `SessionTokenV2`.** Anyone can revoke an active V1 token. The browser key is also added as a permission member, so the app reads the sealed position with a token signed by the session key: **one popup for the whole game**.
3. **Crank tasks can't carry a user signer, and neither can VRF requests made from a crank.** The **Room PDA** is both the crank task authority (so anyone can `finalize_round` and cancel the tasks) and the VRF payer (the ER queue is fee-exempt; the VRF program only checks `is_signer`).
4. **The storm requester is a separate crank task from the referee.** A VRF failure can never block an elimination, and storms live in **per-interval slots**, so an early or late callback can't apply to the wrong minute.
5. **SDK bug in `#[vrf_callback]` (0.18.0):** it puts `scoped_vrf_identity_const(&crate::ID)` inside an Anchor `address =` constraint, so the "compile-time" PDA derivation runs on-chain (software SHA-256, about 197k CU) and the callback runs out of compute. We declare `vrf_program_identity` with a true `const`, and the macro then skips its injection. The same applies to `program_identity` on the request side.
6. **Positions become public on L1 at commit.** The post-round audit needs no TEE permission flip.
7. **Elo is its own instruction** (`rate_room`), so the money path (`settle`) touches only the vault, the fee vault and the winners' accounts.
8. **4-seat rooms end as soon as one player remains**, rather than idling to minute 6.
9. **Build size:** `opt-level = "s"` gives a 739 KB program (about 3.75 SOL deploy rent) with worst-case CU of 84k for `tick` and 113k for `finalize_round`.

---

## Threat model

| Threat | Mitigation |
|---|---|
| Early or manipulated cuts | `tick` takes no arguments, is hard-gated on `now ≥ start + k·interval`, and is idempotent via `next_checkpoint`. Inputs are only the clock, pinned feeds and accounts. The crank, the relayer and any client produce the same result |
| Spoofed or stale prices | Pinned feed PDAs and owner `PriCems…`, feed id = address, `posted_slot > 0`, `price > 0`, 3 s max age. A checkpoint waits up to 10 s for a fresh price, then uses the last published price (≤ 120 s old), then the previous checkpoint price |
| Latency arbitrage | 5 bps spread per open, 2 s minimum hold, execution at the onchain price only |
| Position leak | Owner and session key are the only permission members. The Room holds no live equity. Ranks are published once per interval. **Program logs never contain position data** (a crank transaction touches every position, so its logs could be visible to all members; asserted in tests) |
| Session key abuse | V2 token bound to wallet, signer, program and expiry. The program only accepts it in `set_position`. It never has token authority. Funds move only on L1 via `settle` and `refund` |
| VRF spoofing or duplicates | Scoped identity signer check (const address). Only requested, unfulfilled intervals are accepted. Stale callbacks are recorded and ignored |
| Escrow | Vault authority is the Room PDA. `settle` is once-only, requires the Room back on L1, `status == Ended`, winners' token accounts matching `players[finalist]` and the mint, and checked u64 math. Fee vault receives `balance − payouts`, so the vault always empties exactly |
| Front-run `init_config` | Only the program's upgrade authority can initialize |
| Stuck before start | `abort_round` after 5 minutes, then `refund` for every seat (resumable, so one closed ATA can't block the others) |
| Stuck mid-round (ER outage) | Funds stay in the L1 vault: safe, but locked until the room undelegates. **Known v1 limitation:** there is no admin override that can move user funds |
| Task-ID collision | Task ids derive from `hash(program_id, room, salt)` |
| Collusion / sybil hedging | Not fully preventable: one seat per wallet, a paid entry per seat, top-heavy payouts, Elo, and a post-round public replay for heuristics |

**Dependencies:** Next.js 15.5.29 and React 19.1.10 (patched for CVE-2025-66478, the React Server Components RCE), with postcss pinned to 8.5.32. `npm audit` still reports advisories in `bigint-buffer`, `@solana/buffer-layout-utils` and `@solana/spl-token` (through `@solana/web3.js` 1.x), and in `toml` (Anchor's Node tooling). None has an upstream fix on the web3.js 1.x line, and none processes attacker-controlled input in this app.

**Upgrade authority:** the deployer key (a hardware wallet is recommended). Consider freezing upgrades after the hackathon. Deploy and admin keys never live in this repo.

---

## Run it

Prerequisites: Rust 1.96 (the host toolchain is pinned in `rust-toolchain.toml`), Agave 3.1.9, Anchor CLI 1.0.2 (`avm install 1.0.2`), Node 22+.

```bash
npm install
```

```bash
npm run build:program      # SBF build + IDL (scripts/build.sh), copies IDL into app/ and relayer/
```

```bash
npm run test:program       # 21 unit + 7 MagicSVM integration tests
```

```bash
npx tsx scripts/smoke-tee.ts   # live TEE attestation + auth + oracle check (read-only)
```

```bash
cp app/.env.example app/.env.local && npm run dev   # http://localhost:3000
```

### Deploy runbook

1. **Keys** (on your machine, never in the repo): a deployer/admin keypair and a relayer keypair. `target/deploy/royale-keypair.json` **is the program address**; back it up.
2. **Devnet rehearsal** (the devnet TEE runs the same build as mainnet). Fund the deployer with about 8 devnet SOL (faucet.solana.com), then:
   ```bash
   solana program deploy target/deploy/royale.so --program-id target/deploy/royale-keypair.json -u devnet -k ~/.config/solana/royale-admin.json
   ```
   ```bash
   export NEXT_PUBLIC_CLUSTER=devnet ADMIN_KEYPAIR=~/.config/solana/royale-admin.json
   ```
   ```bash
   npx tsx scripts/devnet-mint.ts        # prints: export NEXT_PUBLIC_USDC_MINT=...
   ```
   ```bash
   npx tsx scripts/init-config.ts && PLAYERS=4 INTERVAL=20 npx tsx scripts/e2e-round.ts
   ```
   `e2e-round` settles smoke tests T1 (crank in TEE), T2 (privacy), T3 (VRF) and T5 (oracle in program) in one run and prints every signature. `ROOM_ID=<id> npx tsx scripts/verify-room.ts` checks the payouts on-chain. Deploy through `-u https://rpc.magicblock.app/devnet --use-rpc --buffer <saved keypair>`: the public devnet RPC rate-limits program writes.
3. **Mainnet.** Run the read-only preflight first, then the guarded deploy:
   ```bash
   source target/e2e-mainnet.env && npx tsx scripts/preflight.ts
   ```
   ```bash
   source target/e2e-mainnet.env && FEE_VAULT_OWNER=<your main wallet> CONFIRM=deploy ./scripts/deploy-mainnet.sh
   ```
   `deploy-mainnet.sh` refuses to run if the preflight fails or `CONFIRM=deploy` is missing. It writes through a saved buffer keypair (re-run to resume after rate limits), pays a 50k micro-lamport/CU priority fee, and finishes with `init_config`. It prints, but doesn't run, the command to move the upgrade authority to a hardware wallet.
4. **Mainnet proof rounds:**
   ```bash
   source target/e2e-mainnet.env && PLAYERS=8 ENTRY_USDC=1 INTERVAL=30 npx tsx scripts/e2e-round.ts
   ```
   ```bash
   source target/e2e-mainnet.env && ROOM_ID=<id> npx tsx scripts/verify-room.ts && ROOM_ID=<id> npx tsx scripts/sweep-players.ts
   ```
   `sweep-players` closes each throwaway player's position, returns their USDC to the admin, closes their token account, and empties their SOL exactly (validated on devnet: 0 lamports left).
5. **Relayer:** `cp relayer/.env.example relayer/.env`, then `npm run relayer`, or `docker build -f relayer/Dockerfile -t royale-relayer .` from the repo root. Its fee payer is a Boost address.
6. **Web app:** deploy `app/` to Vercel (Root Directory `app`; npm workspaces are detected). Devnet needs no `NEXT_PUBLIC_*` overrides, but needs one server secret: `FAUCET_SECRET_KEY`, the JSON byte array of the test-USDC mint authority (`~/.config/solana/royale-devnet-deployer.json`). Without it the burner still works, but players must bring their own devnet funds. On mainnet, set `NEXT_PUBLIC_CLUSTER=mainnet` and a Helius/Triton `NEXT_PUBLIC_L1_RPC`; the faucet refuses to run there.

### Mainnet readiness (preflight, read-only, run 2026-11-23)

| Check | Result |
|---|---|
| Program keypair ↔ `declare_id` | ✅ `7t2L…RBJ5`; backed up to `~/.config/solana/royale-program-keypair.json` |
| Delegation, Permission, Session Keys, VRF, Oracle programs on mainnet L1 | ✅ all executable |
| Mainnet TEE | ✅ `magicblock-core 1.1.1` (`8886db2`, the build validated on devnet), identity `MTEW…xzo`, attestation verified, all 8 feeds fresh, VRF ER queue active |
| TEE **write** ingress from the operator's network | ✅ accepted a probe transaction (spec open item T4) |
| `rpc.magicblock.app/mainnet` (MagicBlock's L1 RPC) | ⚠️ geo-restricted from the operator's network ("Access Restricted… regulatory requirements"). Not used: L1 traffic goes to Solana RPC (public or Helius/Triton) |
| Keys | mainnet admin `2YuKdKLGQupshkGX5aUQDzAJrTAgkQTQysrfWLVSheYs`, relayer `9XdTMBjgXuNYtPKX4RCmY67XUKK1UPDBbYHKGmxHBaYE` (files in `~/.config/solana`, `chmod 600`; back them up) |

**Costs:**
- **Deploy:** about 3.89 SOL. The loader refunds the 3.75 SOL write buffer into the program data, so this is not double. 3.86 SOL stays locked as program rent, and comes back if the program is ever closed.
- **Per round, net after `sweep-players`:** about 0.03–0.04 SOL for 4–6 players. Most of it is permanent rent for the room, rating and delegation records, plus fees.
- **Priority fees:** about 0.000015 SOL per L1 transaction.
- **USDC:** entries return to the admin through the sweep. The 5% fee goes to the fee vault.

### Repo map

```
programs/royale/src/   lib.rs · game.rs (pure math + tests) · oracle.rs · state.rs · instructions/{lobby,round,settle}.rs
tests-magicsvm/        in-process ER integration tests (+ fixtures: live feed bytes, session-keys program)
app/                   Next.js 15 PWA · src/lib/royale (shared TS SDK) · src/lib/wallet (devnet burner) · api/faucet · api/bots · hooks · components · pages
relayer/               crank backup, orchestrator, settle caller, /rooms index
scripts/               build.sh · e2e-round.ts · bots.ts · verify-room.ts · sweep-players.ts · preflight.ts · deploy-mainnet.sh · init-config.ts · devnet-mint.ts · smoke-tee.ts · sdk-selftest.ts
docs/                  SPEC.md · DEMO.md · SUBMISSION.md · devnet-runs/ (live round logs with signatures)
```

## Roadmap

A 5% fee per paid room; sponsored tournaments on a project's own feed; a pro tier (replays, opponent stats, private streamer rooms); squads, agent seats run by cranks, seasons, and Telegram mini-app rooms. Then MagicBlock Forge and Founders Camp.
