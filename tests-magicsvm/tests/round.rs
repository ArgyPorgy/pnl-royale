//! End-to-end: L1 escrow -> TEE delegation + permissions -> crank-driven round with VRF storms
//! -> commit/undelegate -> L1 settle + Elo. Also: privacy, auth, timing and refund paths.

use anchor_lang::{prelude::Pubkey, system_program, Id};
use ephemeral_rollups_sdk::anchor::{DelegationProgram, MagicProgram};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::pda::{
    delegate_buffer_pda_from_delegated_account_and_owner_program,
    delegation_metadata_pda_from_delegated_account, delegation_record_pda_from_delegated_account,
};
use ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE;
use magicsvm::{MagicSVM, TransactionTarget::{Base, Ephemeral}};
use royale::constants::*;
use royale::game::{SIDE_FLAT, SIDE_LONG, SIDE_SHORT};
use royale::state::RoomStatus;
use royale::{accounts, instruction};
use royale_magicsvm_tests::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const SOL: usize = 0;
const BONK: usize = 1;
const ENTRY: u64 = 1_000_000; // $1 USDC
const ROOM_ID: u64 = 42;

struct World {
    svm: MagicSVM,
    admin: Keypair,
    players: Vec<Keypair>,
    mint: Pubkey,
    fee_vault: Pubkey,
    room: Pubkey,
    feeds: [Pubkey; 2],
    prices: [i64; 2],
}

impl World {
    fn token_of(&self, i: usize) -> Pubkey {
        Pubkey::find_program_address(&[b"usdc", self.players[i].pubkey().as_ref()], &Pubkey::default()).0
    }
    fn pos(&self, i: usize) -> Pubkey {
        position_pda(&self.room, &pk(&self.players[i].pubkey()))
    }
    fn positions(&self) -> Vec<Pubkey> {
        (0..self.players.len()).map(|i| self.pos(i)).collect()
    }
    fn refresh_feeds(&mut self) {
        let t = now(&self.svm);
        for a in 0..2 {
            set_feed(&mut self.svm, &self.feeds[a], self.prices[a], t);
        }
    }
    fn validator(&self) -> Pubkey {
        pk(&self.svm.validator_identity())
    }
}

fn setup(n_players: usize, private: bool) -> World {
    let admin = Keypair::new();
    let mut svm = boot(&admin);
    set_unix(&mut svm, 1_800_000_000);
    let mint = Pubkey::new_unique();
    create_mint(&mut svm, &mint, &pk(&admin.pubkey()), 6);
    let fee_vault = Pubkey::new_unique();
    create_token_account(&mut svm, &fee_vault, &mint, &pk(&admin.pubkey()), 0);
    let players: Vec<Keypair> = (0..n_players).map(|_| Keypair::new()).collect();
    for p in &players {
        svm.airdrop(&p.pubkey(), 5_000_000_000).unwrap();
    }
    let feeds = [FEEDS[0].1, FEEDS[3].1]; // SOL/USD, BONK/USD
    let mut w = World {
        svm,
        admin,
        players,
        mint,
        fee_vault,
        room: room_pda(ROOM_ID),
        feeds,
        prices: [7_022_000_000, 20_885], // $70.22 (e-8), $0.0000020885 (e-10)
    };
    for i in 0..n_players {
        let ta = w.token_of(i);
        let owner = pk(&w.players[i].pubkey());
        create_token_account(&mut w.svm, &ta, &mint, &owner, 10 * ENTRY);
    }

    let admin_pk = pk(&w.admin.pubkey());
    send(
        &mut w.svm,
        Base,
        &[&w.admin],
        &[ix(
            instruction::InitConfig { fee_bps: 500, min_entry: ENTRY, max_entry: 100 * ENTRY },
            accounts::InitConfig {
                admin: admin_pk,
                config: config_pda(),
                usdc_mint: mint,
                fee_vault,
                program: program_id(),
                program_data: programdata_address(),
                system_program: system_program::ID,
            },
        )],
        "init_config",
    );
    send(
        &mut w.svm,
        Base,
        &[&w.admin],
        &[ix(
            instruction::CreateRoom {
                args: royale::instructions::CreateRoomArgs {
                    room_id: ROOM_ID,
                    entry_amount: ENTRY,
                    max_seats: n_players as u8,
                    assets: vec![6, 9],
                    fill_secs: 600,
                    interval_secs: 60,
                    private,
                },
            },
            accounts::CreateRoom {
                creator: admin_pk,
                config: config_pda(),
                room: w.room,
                vault: vault_pda(&w.room),
                mint,
                token_program: SPL_TOKEN,
                system_program: system_program::ID,
            },
        )],
        "create_room",
    );
    w
}

fn viewer_of(i: usize) -> Keypair {
    // deterministic per-seat browser key for the tests
    let mut seed = [7u8; 32];
    seed[0] = i as u8;
    Keypair::new_from_array(seed)
}

fn join_ixs(w: &World, i: usize) -> Vec<solana_instruction::Instruction> {
    let player = pk(&w.players[i].pubkey());
    let pos = w.pos(i);
    vec![
        ix(
            instruction::JoinRoom { viewer: pk(&viewer_of(i).pubkey()) },
            accounts::JoinRoom {
                player,
                config: config_pda(),
                room: w.room,
                position: pos,
                rating: rating_pda(&player),
                player_token: w.token_of(i),
                vault: vault_pda(&w.room),
                mint: w.mint,
                token_program: SPL_TOKEN,
                system_program: system_program::ID,
            },
        ),
        ix_with(
            instruction::DelegatePosition {},
            accounts::DelegatePosition {
                payer: player,
                room: w.room,
                buffer_position: delegate_buffer_pda_from_delegated_account_and_owner_program(&pos, &program_id()),
                delegation_record_position: delegation_record_pda_from_delegated_account(&pos),
                delegation_metadata_position: delegation_metadata_pda_from_delegated_account(&pos),
                position: pos,
                owner_program: program_id(),
                delegation_program: DelegationProgram::id(),
                system_program: system_program::ID,
            },
            vec![r(w.validator())],
        ),
    ]
}

fn start_ix(w: &World) -> solana_instruction::Instruction {
    ix_with(
        instruction::StartRoom {},
        accounts::StartRoom {
            payer: pk(&w.admin.pubkey()),
            buffer_room: delegate_buffer_pda_from_delegated_account_and_owner_program(&w.room, &program_id()),
            delegation_record_room: delegation_record_pda_from_delegated_account(&w.room),
            delegation_metadata_room: delegation_metadata_pda_from_delegated_account(&w.room),
            room: w.room,
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
        vec![r(w.validator())],
    )
}

fn permission_ix(w: &World, i: usize) -> solana_instruction::Instruction {
    let pos = w.pos(i);
    ix(
        instruction::InitPermission {},
        accounts::InitPermission {
            payer: pk(&w.admin.pubkey()),
            room: w.room,
            position: pos,
            permission: permission_pda(&pos),
            permission_program: PERMISSION_PROGRAM_ID,
            ephemeral_vault: EPHEMERAL_VAULT_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    )
}

fn begin_ix(w: &World) -> solana_instruction::Instruction {
    let mut extra: Vec<_> = w.positions().into_iter().map(w_meta).collect();
    extra.extend(w.feeds.iter().map(|f| r(*f)));
    ix_with(
        instruction::BeginRound {},
        accounts::BeginRound {
            payer: pk(&w.admin.pubkey()),
            room: w.room,
            oracle_queue: DEFAULT_EPHEMERAL_QUEUE,
            magic_program: MAGIC_PROGRAM_ID,
        },
        extra,
    )
}

fn w_meta(p: Pubkey) -> anchor_lang::solana_program::instruction::AccountMeta {
    royale_magicsvm_tests::w(p)
}

fn trade_ix(w: &World, i: usize, side: i8, lev: u8, asset: u8) -> solana_instruction::Instruction {
    ix_with(
        instruction::SetPosition { side, leverage: lev, asset_idx: asset },
        accounts::SetPosition {
            signer: pk(&w.players[i].pubkey()),
            room: w.room,
            position: w.pos(i),
            session_token: None,
        },
        w.feeds.iter().map(|f| r(*f)).collect(),
    )
}

fn trade(w: &mut World, i: usize, side: i8, lev: u8, asset: u8) {
    let ixx = trade_ix(w, i, side, lev, asset);
    let p = w.players[i].insecure_clone();
    send(&mut w.svm, Ephemeral, &[&p], &[ixx], &format!("set_position p{i}"));
}

fn tick_ix(w: &World) -> solana_instruction::Instruction {
    let mut extra: Vec<_> = w.positions().into_iter().map(w_meta).collect();
    extra.extend(w.feeds.iter().map(|f| r(*f)));
    ix_with(instruction::Tick {}, accounts::Tick { room: w.room }, extra)
}

fn finalize_ix(w: &World) -> solana_instruction::Instruction {
    ix_with(
        instruction::FinalizeRound {},
        accounts::FinalizeRound {
            payer: pk(&w.admin.pubkey()),
            room: w.room,
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
        w.positions().into_iter().map(w_meta).collect(),
    )
}

/// Join everyone, start, permission, begin. Returns the round start unix time.
fn start_round(w: &mut World) -> i64 {
    for i in 0..w.players.len() {
        let ixs = join_ixs(w, i);
        let p = w.players[i].insecure_clone();
        send(&mut w.svm, Base, &[&p], &ixs, &format!("join+delegate p{i}"));
    }
    let ixx = start_ix(w);
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, Base, &[&admin], &[ixx], "start_room");
    assert_eq!(owner_of(&w.svm, Base, &w.room), pk(&ephemeral_rollups_sdk::id()), "room delegated");
    w.refresh_feeds();
    let room = read_room(&w.svm, Ephemeral, &w.room);
    if room.private {
        for i in 0..w.players.len() {
            let ixx = permission_ix(w, i);
            send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "init_permission");
        }
    }
    let ixx = begin_ix(w);
    send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "begin_round");
    let room = read_room(&w.svm, Ephemeral, &w.room);
    assert_eq!(room.status, RoomStatus::Live as u8);
    room.start_ts
}

/// Advance the world `secs` seconds with a deterministic price path. Panics on crank failure.
fn run_seconds(w: &mut World, secs: i64, sol_drift_bps: i64) -> Vec<String> {
    let mut logs = vec![];
    for _ in 0..secs {
        w.prices[SOL] += w.prices[SOL] * sol_drift_bps / 10_000;
        w.prices[BONK] -= w.prices[BONK] * sol_drift_bps / 20_000;
        // feeds must be fresh at the unix time the cranks will see
        let t = now(&w.svm) + 1;
        for a in 0..2 {
            set_feed(&mut w.svm, &w.feeds[a], w.prices[a], t);
        }
        for res in step_second(&mut w.svm) {
            if !res.ok {
                panic!("crank/vrf failed: {}\n{:#?}", res.err, res.logs);
            }
            logs.extend(res.logs);
        }
    }
    logs
}

#[test]
fn full_private_round_pays_out_on_l1() {
    let mut w = setup(8, true);
    let start = start_round(&mut w);

    // --- Privacy: a rival can't read A's sealed position through the TEE; A can. ---
    let a = pk(&w.players[0].pubkey());
    let b = pk(&w.players[1].pubkey());
    w.svm.set_authorized_user(Some(ad(&b)));
    assert!(read_position(&w.svm, Ephemeral, &w.pos(0)).is_none(), "B must not see A's position");
    w.svm.set_authorized_user(Some(ad(&a)));
    assert!(read_position(&w.svm, Ephemeral, &w.pos(0)).is_some(), "A sees own position");
    w.svm.set_authorized_user(Some(viewer_of(0).pubkey()));
    assert!(read_position(&w.svm, Ephemeral, &w.pos(0)).is_some(), "A's browser session key sees it too (no popup)");
    w.svm.set_authorized_user(Some(viewer_of(1).pubkey()));
    assert!(read_position(&w.svm, Ephemeral, &w.pos(0)).is_none(), "B's session key can't");
    w.svm.set_authorized_user(None);
    assert!(read_position(&w.svm, Ephemeral, &w.pos(0)).is_none(), "anonymous sees nothing");
    // The room itself is public.
    assert!(w.svm.get_account_for(Ephemeral, &ad(&w.room)).is_some());
    w.svm.set_authorized_user(Some(ad(&a)));

    // --- Trading: popup-free ER transactions. ---
    trade(&mut w, 0, SIDE_LONG, 10, SOL as u8); // aggressive long
    trade(&mut w, 1, SIDE_SHORT, 10, SOL as u8); // aggressive short (will lose)
    trade(&mut w, 2, SIDE_LONG, 2, SOL as u8);
    trade(&mut w, 3, SIDE_SHORT, 2, BONK as u8);
    trade(&mut w, 4, SIDE_LONG, 1, SOL as u8);
    trade(&mut w, 5, SIDE_SHORT, 5, BONK as u8);
    // 6 stays flat (bleeds), 7 longs BONK (loses)
    trade(&mut w, 7, SIDE_LONG, 5, BONK as u8);

    // Hold time: an immediate flip is rejected.
    let ixx = trade_ix(&w, 0, SIDE_SHORT, 10, SOL as u8);
    let p0 = w.players[0].insecure_clone();
    let err = try_send(&mut w.svm, Ephemeral, &[&p0], &[ixx]).unwrap_err();
    assert!(err.1.iter().any(|l| l.contains("HoldTime")), "hold time enforced: {err:?}");

    // Someone else can't trade A's position.
    let mut bad = trade_ix(&w, 0, SIDE_FLAT, 1, 0);
    bad.accounts[0].pubkey = w.players[1].pubkey();
    let p1 = w.players[1].insecure_clone();
    assert!(try_send(&mut w.svm, Ephemeral, &[&p1], &[bad]).is_err(), "unauthorized trade rejected");

    // An early tick is a no-op (time-gated).
    let ixx = tick_ix(&w);
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "early tick");
    assert_eq!(read_room(&w.svm, Ephemeral, &w.room).next_checkpoint, 1);

    // --- Minute 1: SOL drifts up 2 bps/s (~ +12%). The crank fires checkpoint 1. ---
    let logs = run_seconds(&mut w, 62, 2);
    let room = read_room(&w.svm, Ephemeral, &w.room);
    println!("after cp1: alive {} next_cp {} ticks {} storms req {:#b} ful {:#b}", room.alive_count, room.next_checkpoint, room.ticks, room.storms_requested, room.storms_fulfilled);
    assert_eq!(room.next_checkpoint, 2, "crank processed checkpoint 1");
    assert_eq!(room.alive_count, 7, "8 seats -> 1 cut at checkpoint 1");
    assert!(room.storms_requested & 0b11 == 0b11, "storms requested for intervals 0 and 1");
    assert!(room.storms_fulfilled & 0b1 == 1, "VRF callback landed for interval 0");
    assert!(room.seed_set);
    let cut: Vec<usize> = (0..8).filter(|&i| room.elim_checkpoint[i] == 1).collect();
    assert_eq!(cut.len(), 1);
    assert_eq!(room.placement[cut[0]], 8);
    // The 10x short on a rising SOL is liquidated -> first out.
    assert_eq!(cut[0], 1, "10x short on +12% SOL is liquidated and cut");
    assert!(logs.iter().any(|l| l.contains("checkpoint 1")), "crank-executed tick logged");
    // Logs never leak private position data.
    assert!(!logs.iter().any(|l| l.contains("equity")), "no equity in crank logs");

    // A dead player can't trade.
    let ixx = trade_ix(&w, 1, SIDE_LONG, 1, 0);
    let p1 = w.players[1].insecure_clone();
    assert!(try_send(&mut w.svm, Ephemeral, &[&p1], &[ixx]).is_err(), "eliminated can't trade");

    // Mid-round trades (players adapt).
    trade(&mut w, 6, SIDE_LONG, 1, SOL as u8);
    trade(&mut w, 3, SIDE_FLAT, 1, 0);

    // --- Run to the end. ---
    run_seconds(&mut w, 300, 1);
    let room = read_room(&w.svm, Ephemeral, &w.room);
    println!(
        "end: status {} alive {} finalists {} seats {:?} placements {:?} storms {:?} ticks {}",
        room.status, room.alive_count, room.finalist_count, room.finalist_seats, room.placement, room.storm_kind, room.ticks
    );
    assert_eq!(room.status, RoomStatus::Ended as u8);
    assert_eq!(room.finalist_count, 3);
    assert!(room.end_ts >= start + 360);
    let mut places: Vec<u8> = room.placement[..8].to_vec();
    places.sort();
    assert_eq!(places, (1..=8).collect::<Vec<u8>>(), "every seat has a distinct placement");
    assert!(room.storms_seen >= 3, "storms landed: {}", room.storms_seen);

    // --- Commit + undelegate everything back to Solana. ---
    let ixx = finalize_ix(&w);
    send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "finalize_round");
    let mut all = w.positions();
    all.push(w.room);
    finish_undelegation(&mut w.svm, &all);
    assert_eq!(owner_of(&w.svm, Base, &w.room), program_id(), "room back on L1");
    for p in w.positions() {
        assert_eq!(owner_of(&w.svm, Base, &p), program_id(), "position back on L1");
    }
    let room_l1 = read_room(&w.svm, Base, &w.room);
    assert_eq!(room_l1.status, RoomStatus::Ended as u8);
    // Positions are public on L1 after the round: anyone can audit.
    let p0 = read_position(&w.svm, Base, &w.pos(0)).unwrap();
    assert!(p0.actions >= 1);

    // --- Settle on L1. ---
    let winners: Vec<usize> = (0..3).map(|i| room_l1.finalist_seats[i] as usize).collect();
    let before: Vec<u64> = winners.iter().map(|&i| token_amount(&w.svm, &w.token_of(i))).collect();
    let settle = ix_with(
        instruction::Settle {},
        accounts::Settle {
            payer: pk(&w.admin.pubkey()),
            config: config_pda(),
            room: w.room,
            vault: vault_pda(&w.room),
            fee_vault: w.fee_vault,
            mint: w.mint,
            creator: pk(&w.admin.pubkey()),
            token_program: SPL_TOKEN,
        },
        winners.iter().map(|&i| w_meta(w.token_of(i))).collect(),
    );
    send(&mut w.svm, Base, &[&admin], &[settle.clone()], "settle");
    println!("owner after settle: {}", owner_of(&w.svm, Base, &w.room));
    let pot = 8 * ENTRY;
    let prize = pot - pot * 5 / 100;
    let got: Vec<u64> = winners
        .iter()
        .enumerate()
        .map(|(k, &i)| token_amount(&w.svm, &w.token_of(i)) - before[k])
        .collect();
    println!("payouts {:?} fee vault {}", got, token_amount(&w.svm, &w.fee_vault));
    assert_eq!(got.iter().sum::<u64>() + token_amount(&w.svm, &w.fee_vault), pot, "payouts + fee == pot");
    assert_eq!(got, vec![prize * 60 / 100, prize * 30 / 100, prize * 10 / 100]);
    assert!(w.svm.get_account(&ad(&vault_pda(&w.room))).map(|a| a.lamports == 0).unwrap_or(true), "vault closed");
    // Settle is once-only.
    let e = try_send(&mut w.svm, Base, &[&admin], &[settle]);
    println!("double settle: {:?}", e.as_ref().err().map(|x| &x.0));
    println!("owner after double settle: {}", owner_of(&w.svm, Base, &w.room));
    assert!(e.is_err(), "double settle rejected");

    // --- Elo ---
    let rate = ix_with(
        instruction::RateRoom {},
        accounts::RateRoom { room: w.room },
        (0..8).map(|i| w_meta(rating_pda(&pk(&w.players[i].pubkey())))).collect(),
    );
    send(&mut w.svm, Base, &[&admin], &[rate], "rate_room");
    let win_rating = {
        let a = w.svm.get_account(&ad(&rating_pda(&pk(&w.players[winners[0]].pubkey())))).unwrap();
        <royale::state::Rating as anchor_lang::AccountDeserialize>::try_deserialize(&mut &a.data[..]).unwrap()
    };
    assert!(win_rating.elo > ELO_START && win_rating.wins == 1 && win_rating.games == 1);

    // --- Rent reclaim ---
    let p = w.players[2].insecure_clone();
    let close = ix(
        instruction::ClosePosition {},
        accounts::ClosePosition { owner: pk(&p.pubkey()), room: w.room, position: w.pos(2) },
    );
    send(&mut w.svm, Base, &[&p], &[close], "close_position");
    assert!(w.svm.get_account(&ad(&w.pos(2))).map(|a| a.lamports == 0).unwrap_or(true));
}

#[test]
fn four_player_room_ends_early_with_single_winner() {
    let mut w = setup(4, false);
    start_round(&mut w);
    trade(&mut w, 0, SIDE_LONG, 5, SOL as u8);
    trade(&mut w, 1, SIDE_SHORT, 5, SOL as u8);
    trade(&mut w, 2, SIDE_LONG, 1, BONK as u8);
    run_seconds(&mut w, 200, 1);
    let room = read_room(&w.svm, Ephemeral, &w.room);
    assert_eq!(room.status, RoomStatus::Ended as u8, "4 seats: 1 finalist after 3 cuts, round ends early");
    assert_eq!(room.finalist_count, 1);
    assert_eq!(room.placement[room.finalist_seats[0] as usize], 1);
    let admin = w.admin.insecure_clone();
    let ixx = finalize_ix(&w);
    send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "finalize_round");
    let mut all = w.positions();
    all.push(w.room);
    finish_undelegation(&mut w.svm, &all);
    let winner = room.finalist_seats[0] as usize;
    let before = token_amount(&w.svm, &w.token_of(winner));
    let settle = ix_with(
        instruction::Settle {},
        accounts::Settle {
            payer: pk(&admin.pubkey()),
            config: config_pda(),
            room: w.room,
            vault: vault_pda(&w.room),
            fee_vault: w.fee_vault,
            mint: w.mint,
            creator: pk(&admin.pubkey()),
            token_program: SPL_TOKEN,
        },
        vec![w_meta(w.token_of(winner))],
    );
    // Wrong payout account (a loser's) is rejected.
    let mut bad = settle.clone();
    let loser = (0..4).find(|&i| i != winner).unwrap();
    let last = bad.accounts.len() - 1;
    bad.accounts[last].pubkey = ad(&w.token_of(loser));
    assert!(try_send(&mut w.svm, Base, &[&admin], &[bad]).is_err(), "payout to wrong ATA rejected");
    send(&mut w.svm, Base, &[&admin], &[settle], "settle");
    assert_eq!(token_amount(&w.svm, &w.token_of(winner)) - before, 3_800_000, "winner takes 95% of $4");
    assert_eq!(token_amount(&w.svm, &w.fee_vault), 200_000);
}

#[test]
fn unfilled_room_refunds_everyone() {
    // A 5-seat room that only fills 3 seats (below the 4-seat minimum).
    let mut w = {
        let admin = Keypair::new();
        let mut svm = boot(&admin);
        set_unix(&mut svm, 1_800_000_000);
        let mint = Pubkey::new_unique();
        create_mint(&mut svm, &mint, &pk(&admin.pubkey()), 6);
        let fee_vault = Pubkey::new_unique();
        create_token_account(&mut svm, &fee_vault, &mint, &pk(&admin.pubkey()), 0);
        let players: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
        for p in &players {
            svm.airdrop(&p.pubkey(), 5_000_000_000).unwrap();
        }
        let mut w = World { svm, admin, players, mint, fee_vault, room: room_pda(7), feeds: [FEEDS[0].1, FEEDS[3].1], prices: [1, 1] };
        for i in 0..3 {
            let ta = w.token_of(i);
            let owner = pk(&w.players[i].pubkey());
            create_token_account(&mut w.svm, &ta, &mint, &owner, 10 * ENTRY);
        }
        let admin_pk = pk(&w.admin.pubkey());
        let a = w.admin.insecure_clone();
        send(&mut w.svm, Base, &[&a], &[ix(
            instruction::InitConfig { fee_bps: 500, min_entry: ENTRY, max_entry: 100 * ENTRY },
            accounts::InitConfig { admin: admin_pk, config: config_pda(), usdc_mint: mint, fee_vault, program: program_id(), program_data: programdata_address(), system_program: system_program::ID },
        )], "init_config");
        send(&mut w.svm, Base, &[&a], &[ix(
            instruction::CreateRoom { args: royale::instructions::CreateRoomArgs { room_id: 7, entry_amount: ENTRY, max_seats: 5, assets: vec![6], fill_secs: 60, interval_secs: 60, private: true } },
            accounts::CreateRoom { creator: admin_pk, config: config_pda(), room: w.room, vault: vault_pda(&w.room), mint, token_program: SPL_TOKEN, system_program: system_program::ID },
        )], "create_room");
        w
    };
    for i in 0..3 {
        let ixs = join_ixs(&w, i);
        let p = w.players[i].insecure_clone();
        send(&mut w.svm, Base, &[&p], &ixs, "join");
    }
    let admin = w.admin.insecure_clone();
    // Can't start short-handed.
    let s = start_ix(&w);
    assert!(try_send(&mut w.svm, Base, &[&admin], &[s]).is_err(), "3 < 4 seats can't start");
    // Refund before expiry is rejected.
    let refund = ix_with(
        instruction::Refund {},
        accounts::Refund { room: w.room, vault: vault_pda(&w.room), mint: w.mint, token_program: SPL_TOKEN },
        (0..3).map(|i| w_meta(w.token_of(i))).collect(),
    );
    assert!(try_send(&mut w.svm, Base, &[&admin], &[refund.clone()]).is_err(), "no refund before expiry");
    let t = now(&w.svm) + 61;
    set_unix(&mut w.svm, t);
    send(&mut w.svm, Base, &[&admin], &[refund.clone()], "refund");
    for i in 0..3 {
        assert_eq!(token_amount(&w.svm, &w.token_of(i)), 10 * ENTRY, "player {i} made whole");
    }
    // Idempotent: a second refund pays nothing more.
    send(&mut w.svm, Base, &[&admin], &[refund], "refund again");
    assert_eq!(token_amount(&w.svm, &vault_pda(&w.room)), 0);
    // Delegated positions can be released from the ER, then closed on L1.
    let p = w.players[0].insecure_clone();
    let rel = ix(
        instruction::ReleasePosition {},
        accounts::ReleasePosition { payer: pk(&p.pubkey()), room: w.room, position: w.pos(0), magic_program: MagicProgram::id(), magic_context: MAGIC_CONTEXT_ID },
    );
    send(&mut w.svm, Ephemeral, &[&p], &[rel], "release_position");
    let p0 = w.pos(0);
    finish_undelegation(&mut w.svm, &[p0]);
    assert_eq!(owner_of(&w.svm, Base, &w.pos(0)), program_id());
    let close = ix(instruction::ClosePosition {}, accounts::ClosePosition { owner: pk(&p.pubkey()), room: w.room, position: w.pos(0) });
    send(&mut w.svm, Base, &[&p], &[close], "close_position");
}

#[test]
fn sixteen_seats_cut_schedule_and_compute_budget() {
    let mut w = setup(16, true);
    start_round(&mut w);
    for i in 0..16 {
        let side = match i % 3 { 0 => SIDE_LONG, 1 => SIDE_SHORT, _ => SIDE_FLAT };
        if side != SIDE_FLAT {
            trade(&mut w, i, side, [1u8, 2, 5, 10][i % 4], (i % 2) as u8);
        }
    }
    run_seconds(&mut w, 3, 0); // sample just after each checkpoint (the crank ticks every 2 s)
    let mut alive_after = vec![];
    let mut max_tick_cu = 0u64;
    for _cp in 1..=6 {
        let logs = run_seconds(&mut w, 60, if _cp % 2 == 0 { 1 } else { -1 });
        for l in &logs {
            // "Program <royale> consumed N of M compute units" for crank-executed ticks
            if l.contains(&royale::ID.to_string()) && l.contains("consumed") {
                let n: u64 = l.split_whitespace().nth(3).and_then(|x| x.parse().ok()).unwrap_or(0);
                max_tick_cu = max_tick_cu.max(n);
            }
        }
        alive_after.push(read_room(&w.svm, Ephemeral, &w.room).alive_count);
    }
    let room = read_room(&w.svm, Ephemeral, &w.room);
    println!("alive after each minute: {alive_after:?}; max royale CU in a crank tx: {max_tick_cu}");
    assert_eq!(&alive_after[..5], &[13, 10, 7, 5, 3], "spec cut schedule 3,3,3,2,2 (liquidations can only cut more)");
    assert_eq!(room.status, RoomStatus::Ended as u8);
    assert_eq!(room.finalist_count, 3);
    assert!(max_tick_cu < 200_000, "tick fits the default 200k CU budget: {max_tick_cu}");
    let admin = w.admin.insecure_clone();
    let ixx = finalize_ix(&w);
    let logs = send(&mut w.svm, Ephemeral, &[&admin], &[ixx], "finalize 16");
    let cu = logs.iter().find(|l| l.contains(&royale::ID.to_string()) && l.contains("consumed")).cloned();
    println!("finalize_round: {cu:?}");
}

fn create_session_ix(authority: &Keypair, session: &Keypair, valid_until: i64) -> (solana_instruction::Instruction, Pubkey) {
    use solana_instruction::{AccountMeta, Instruction};
    let keys = pk(&ad(&"KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5".parse::<Pubkey>().unwrap()));
    let token = Pubkey::find_program_address(
        &[b"session_token_v2", program_id().as_ref(), pk(&session.pubkey()).as_ref(), pk(&authority.pubkey()).as_ref()],
        &keys,
    )
    .0;
    let mut data = disc("global:create_session_v2");
    // top_up: Some(true), valid_until: Some(t), lamports: Some(0.01 SOL) for the session signer
    data.extend_from_slice(&[1, 1]);
    data.push(1);
    data.extend_from_slice(&valid_until.to_le_bytes());
    data.push(1);
    data.extend_from_slice(&10_000_000u64.to_le_bytes());
    let ix = Instruction {
        program_id: ad(&keys),
        accounts: vec![
            AccountMeta::new(ad(&token), false),
            AccountMeta::new(session.pubkey(), true),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(authority.pubkey(), true),
            AccountMeta::new_readonly(ad(&program_id()), false),
            AccountMeta::new_readonly(ad(&system_program::ID), false),
        ],
        data,
    };
    (ix, token)
}

fn disc(name: &str) -> Vec<u8> {
    solana_sha256_hasher::hashv(&[name.as_bytes()]).to_bytes()[..8].to_vec()
}

#[test]
fn session_key_trades_without_wallet_popups() {
    let mut w = setup(4, true);
    let keys: Pubkey = "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5".parse().unwrap();
    w.svm
        .add_program_from_file(ad(&keys), std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/session_keys.so"))
        .unwrap();
    start_round(&mut w);

    // Player 0 signs once (L1) to create a 1-hour session for a browser-held key.
    let player = w.players[0].insecure_clone();
    let session = Keypair::new();
    let (cix, token) = create_session_ix(&player, &session, now(&w.svm) + 3600);
    send(&mut w.svm, Base, &[&player, &session], &[cix], "create_session_v2");

    // Trades signed only by the session key.
    let mk = |w: &World, side: i8, signer: Pubkey, pos_i: usize, token: Option<Pubkey>| {
        ix_with(
            instruction::SetPosition { side, leverage: 5, asset_idx: 0 },
            accounts::SetPosition { signer, room: w.room, position: w.pos(pos_i), session_token: token },
            w.feeds.iter().map(|f| r(*f)).collect(),
        )
    };
    let t = mk(&w, SIDE_LONG, pk(&session.pubkey()), 0, Some(token));
    send(&mut w.svm, Ephemeral, &[&session], &[t], "session trade");
    w.svm.set_authorized_user(Some(player.pubkey()));
    let p = read_position(&w.svm, Ephemeral, &w.pos(0)).unwrap();
    assert_eq!(p.side, SIDE_LONG);
    assert_eq!(p.leverage, 5);

    // The same session can't move someone else's position.
    let t = mk(&w, SIDE_SHORT, pk(&session.pubkey()), 1, Some(token));
    assert!(try_send(&mut w.svm, Ephemeral, &[&session], &[t]).is_err(), "session scoped to its authority");
    // A random key without a token is rejected.
    let rando = Keypair::new();
    w.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    let t = mk(&w, SIDE_SHORT, pk(&rando.pubkey()), 0, None);
    assert!(try_send(&mut w.svm, Ephemeral, &[&rando], &[t]).is_err(), "no token, not owner -> rejected");

    // Expired session is rejected.
    run_seconds(&mut w, 3, 0);
    let session2 = Keypair::new();
    let (cix, token2) = create_session_ix(&player, &session2, now(&w.svm) + 2);
    send(&mut w.svm, Base, &[&player, &session2], &[cix], "short session");
    run_seconds(&mut w, 4, 0);
    let t = mk(&w, SIDE_FLAT, pk(&session2.pubkey()), 0, Some(token2));
    assert!(try_send(&mut w.svm, Ephemeral, &[&session2], &[t]).is_err(), "expired session rejected");
}

/// The decoder must accept a real PriceUpdateV3 account dumped from the mainnet TEE.
#[test]
fn decodes_live_mainnet_tee_feed_bytes() {
    use base64::Engine;
    let b64 = std::fs::read_to_string(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/sol_usd_feed_tee.b64")).unwrap();
    let mut data = base64::engine::general_purpose::STANDARD.decode(b64.trim()).unwrap();
    let feed = FEEDS[0].1;
    let mut lamports = 1_000_000u64;
    let owner = ORACLE_PROGRAM_ID;
    let info = anchor_lang::prelude::AccountInfo::new(&feed, false, false, &mut lamports, &mut data, &owner, false);
    let p = royale::oracle::decode_feed(&info, &feed).expect("live feed decodes");
    println!("live SOL/USD raw {} (exp -8 => ${:.4}) publish_time {}", p.price, p.price as f64 / 1e8, p.publish_time);
    assert!(p.price > 1_000_000_000 && p.price < 100_000_000_000, "SOL between $10 and $1000");
    assert!(p.publish_time > 1_700_000_000);
    // wrong address is rejected even with valid bytes
    let other = FEEDS[1].1;
    assert!(royale::oracle::decode_feed(&info, &other).is_err());
}
