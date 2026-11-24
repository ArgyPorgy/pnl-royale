# Submission copy (build.magicblock.app → Solana Blitz v10)

Paste-ready fields. Fill the two `TODO` links after hosting the app and uploading the video.

**Project name:** PnL Royale

**Description (2–3 sentences):**
Battle royale for traders. Up to 16 players stake USDC and trade live Pyth Lazer prices with positions sealed inside MagicBlock's Private Ephemeral Rollup. An onchain crank cuts the lowest equity every interval, VRF storms change the rules, and the finalists split the pot on Solana. One wallet popup to join; every trade after that is a gasless, popup-free TEE transaction signed by a session key.

**Categories:** Games · DeFi · Social

**Project website:** TODO (Vercel URL of `app/`)

**GitHub repo:** https://github.com/ArgyPorgy/pnl-royale

**Pitch & demo video:** TODO (3 minutes, script in `docs/DEMO.md`)

**Network:** Solana devnet + MagicBlock devnet TEE (`devnet-tee.magicblock.app`, validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`), the same validator build as mainnet (`magicblock-core 1.1.1`, `8886db2`). Mainnet preflight passes (see README); the deploy is waiting on the ~3.9 SOL program-rent deposit.

**Explorer links (integration proof, devnet):**
- Program: https://solscan.io/account/7t2L4552mactTH9NiCcGQ3LeUgCBYi81B1qMfGTeRBJ5?cluster=devnet
- Join + delegate Position to the TEE + session key (one transaction): https://solscan.io/tx/A3ZdBKmGVDfzddAjLuUmdit8qirfrMDhBX6WNAMFgSXfxQv91adUfGC98DcjgHcoaJuQuiVcJZ8NWr4i1h2j4R7?cluster=devnet
- Room delegated to the TEE (`start_room`): https://solscan.io/tx/32ZWjcJSdvMtuyZ5Vw3byLmM47yw119U9c9spKwQD32S563UEAWyFDEmnVsxvnXbSbuCak7M2m5cE7MvdjgHMgoY?cluster=devnet
- USDC payouts after commit + undelegate (`settle`): https://solscan.io/tx/4rtBTxj8xDfPpecawu594GMNSjxmdY56Y84pL1q46zTF3hSQzRUkzDwahsZ4uNF33JVrt1uXnJPHXM44EJqZuMnc?cluster=devnet
- Elo update (`rate_room`): https://solscan.io/tx/2wYsXWWWsaJx6srowuFqYmQrPvCbpeut24qw45D7PjBwUcMPEQPZgve6D3s2iFSU6c7EpyRRWse2vBc4Fcb8eFDS?cluster=devnet
- TEE-side signatures (`begin_round` scheduling the crank + VRF tasks, `finalize_round`) are in `docs/devnet-runs/` (TEE transactions need an auth token to view)

**Boost addresses:**
1. Program ID: `7t2L4552mactTH9NiCcGQ3LeUgCBYi81B1qMfGTeRBJ5` (devnet today; Boost counts mainnet activity)
2. Relayer / fee payer wallet (mainnet, unfunded): `9XdTMBjgXuNYtPKX4RCmY67XUKK1UPDBbYHKGmxHBaYE`
3. Fee vault: optional (Private Payments not used)

**What's built (for the "tell us more" field):**
- Anchor 1.0.2 program on `ephemeral-rollups-sdk` 0.18: USDC escrow on L1, delegation to the TEE, owner-only `EphemeralPermission` per position (owner + session key), session-key trading (`SessionTokenV2`), Pyth Lazer prices read on the TEE, two crank tasks (referee + storm requester) with the Room PDA as task authority, scoped-identity VRF storms, commit + undelegate, L1 settle with exact payout accounting, Elo.
- Verified: 21 unit tests, 7 MagicSVM integration tests, and three live devnet-TEE rounds (crank cuts, VRF storm every interval, privacy proof, exact on-chain payouts), one of them played in the browser.
- Found and worked around an SDK 0.18.0 bug: `#[vrf_callback]` derives its identity PDA at runtime inside an Anchor constraint (~197k CU), so callbacks run out of compute. Details in the README.
- Next.js PWA with a one-click devnet burner wallet + faucet, spectator board, relayer (crank backup, orchestration, settle, room index), and a guarded mainnet deploy + preflight.
