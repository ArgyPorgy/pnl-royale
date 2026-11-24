# 3-minute demo script (devnet)

## Setup before recording

1. App running (hosted URL or `npm run dev`) with `FAUCET_SECRET_KEY` set (devnet mint authority).
2. Use a fresh browser profile so "Play instantly" creates a new burner, or use Phantom on devnet.
3. Pick **4 seats, 30 s cuts** so the round ends in about 90 s (use 8 seats and 30 s for a richer, 3-minute round).

## Script

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Lobby hero | "Sixteen traders. Real prices. Hidden positions. One minute to survive. Every tap is an onchain transaction on Solana and MagicBlock." |
| 0:15–0:40 | Click **⚡ Play instantly**, set 4 seats and 30 s, **Create room**, then **Join** | "One click for a wallet, one signature to join. That transaction escrows USDC on Solana, delegates my position to MagicBlock's TEE validator, and registers a session key. No more popups after this." Open **room on Solscan** to show the escrow + delegation. |
| 0:40–0:50 | Three labelled bots take seats a few seconds after you join. Click **Start with 4 players** | "Three house bots sit down so there's always a game. As the host I can start from four players up, or wait for friends with the invite link." The tx feed shows **seal positions** and **begin round**, sent by my browser. |
| 0:50–1:25 | Trade: Long SOL 5×, flip to Short, then **Close** and watch Open PnL move to Locked-in | "Each tap is a gasless TEE transaction, about half a second, priced by Pyth Lazer feeds on the rollup. Close locks in my PnL, but sitting flat costs 1% a minute, so nobody can hide." Point at the tx counter and latency. Point at the **storm banner**: "This minute's storm came from MagicBlock VRF: Zone Shrink, flat bleeds double." |
| 1:25–1:50 | Point at **Your equity (sealed in the TEE)**, then open **spectate** in a second window | "My equity is readable only by me and my session key. The spectator board sees the alive ring and ranks, never positions. A rival's TEE token gets nothing back." Optional: show the `PRIVACY: … hidden ✓` line from `scripts/e2e-round.ts`. |
| 1:50–2:20 | The countdown hits 0 and a seat turns ✕ | "No server did that: begin_round scheduled an onchain crank inside the TEE. tick() is permissionless and time-gated, so anyone can call it and get the same result." |
| 2:20–2:45 | End screen: trophy, results table, **Paid** | "The round ends, the room and every position commit and undelegate back to Solana, and settle pays the finalists from escrow: 95% of the pot, 5% fee, to the lamport. Every trade is public on L1 now." Open the settle tx on Solscan. |
| 2:45–3:00 | README "What's verified" section | "PER, VRF, cranks, session keys, the oracle and L1 settlement, all in one game. 22 unit tests, 7 in-process rollup tests, and live TEE rounds. PnL Royale: battle royale for traders." |
