//! close_room on the in-process local validator (MagicSVM). No live cluster.
//!
//! A Settled room whose vault `settle` already closed, and a Cancelled room whose vault
//! was emptied by `refund`, both pay their rent to the fixed recipient. A room that is
//! still open, still delegated, still holding USDC, or still has a position account is rejected.

use anchor_lang::{prelude::Pubkey, system_program, AccountDeserialize, AccountSerialize, Id};
use ephemeral_rollups_sdk::anchor::DelegationProgram;
use ephemeral_rollups_sdk::pda::{
    delegate_buffer_pda_from_delegated_account_and_owner_program, delegation_metadata_pda_from_delegated_account,
    delegation_record_pda_from_delegated_account,
};
use magicsvm::TransactionTarget::Base;
use royale::constants::RENT_RECIPIENT;
use royale::state::{Room, RoomStatus};
use royale::{accounts, instruction};
use royale_magicsvm_tests::*;
use solana_account::Account as StockAccount;
use solana_keypair::Keypair;
use solana_signer::Signer;

const ENTRY: u64 = 1_000_000;

struct Fixture {
    svm: magicsvm::MagicSVM,
    admin: Keypair,
    creator: Keypair,
    players: Vec<Keypair>,
    mint: Pubkey,
    room: Pubkey,
}

fn boot_fixture(room_id: u64, n_players: usize, max_seats: u8) -> Fixture {
    let admin = Keypair::new();
    let creator = Keypair::new();
    let mut svm = boot(&admin);
    set_unix(&mut svm, 1_800_000_000);
    svm.airdrop(&creator.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&ad(&RENT_RECIPIENT), 1_000_000).unwrap();
    let mint = Pubkey::new_unique();
    create_mint(&mut svm, &mint, &pk(&admin.pubkey()), 6);
    let fee_vault = Pubkey::new_unique();
    create_token_account(&mut svm, &fee_vault, &mint, &pk(&admin.pubkey()), 0);
    let players: Vec<Keypair> = (0..n_players).map(|_| Keypair::new()).collect();
    for p in &players {
        svm.airdrop(&p.pubkey(), 5_000_000_000).unwrap();
    }
    let room = room_pda(room_id);
    let mut fx = Fixture { svm, admin, creator, players, mint, room };
    for i in 0..n_players {
        let owner = pk(&fx.players[i].pubkey());
        let ta = token_of(&fx, i);
        create_token_account(&mut fx.svm, &ta, &mint, &owner, 10 * ENTRY);
    }
    let admin_pk = pk(&fx.admin.pubkey());
    let admin = fx.admin.insecure_clone();
    send(
        &mut fx.svm,
        Base,
        &[&admin],
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
    let creator = fx.creator.insecure_clone();
    let creator_pk = pk(&creator.pubkey());
    send(
        &mut fx.svm,
        Base,
        &[&creator],
        &[ix(
            instruction::CreateRoom {
                args: royale::instructions::CreateRoomArgs {
                    room_id,
                    entry_amount: ENTRY,
                    max_seats,
                    assets: vec![6],
                    fill_secs: 60,
                    interval_secs: 60,
                    private: false,
                },
            },
            accounts::CreateRoom {
                creator: creator_pk,
                config: config_pda(),
                room,
                vault: vault_pda(&room),
                mint,
                token_program: SPL_TOKEN,
                system_program: system_program::ID,
            },
        )],
        "create_room",
    );
    fx
}

fn token_of(fx: &Fixture, i: usize) -> Pubkey {
    Pubkey::find_program_address(&[b"usdc", fx.players[i].pubkey().as_ref()], &Pubkey::default()).0
}

fn pos(fx: &Fixture, i: usize) -> Pubkey {
    position_pda(&fx.room, &pk(&fx.players[i].pubkey()))
}

fn lamports(svm: &magicsvm::MagicSVM, p: &Pubkey) -> u64 {
    svm.get_account(&ad(p)).map(|a| a.lamports).unwrap_or(0)
}

fn set_status(svm: &mut magicsvm::MagicSVM, room: &Pubkey, status: RoomStatus) {
    let mut acc = svm.get_account(&ad(room)).expect("room");
    let mut decoded = Room::try_deserialize(&mut &acc.data[..]).expect("decode");
    decoded.set_status(status);
    decoded.try_serialize(&mut &mut acc.data[..]).expect("encode");
    svm.set_account(ad(room), acc).unwrap();
}

fn wipe(svm: &mut magicsvm::MagicSVM, address: &Pubkey) {
    svm.set_account(
        ad(address),
        StockAccount { lamports: 0, data: vec![], owner: ad(&Pubkey::default()), executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

fn close_ix(authority: Pubkey, room: Pubkey, positions: &[Pubkey]) -> solana_instruction::Instruction {
    ix_with(
        instruction::CloseRoom {},
        accounts::CloseRoom {
            authority,
            config: config_pda(),
            room,
            recipient: RENT_RECIPIENT,
            vault: vault_pda(&room),
            token_program: SPL_TOKEN,
        },
        positions.iter().copied().map(w).collect(),
    )
}

fn join_only(fx: &mut Fixture, i: usize) {
    let player = pk(&fx.players[i].pubkey());
    let p = fx.players[i].insecure_clone();
    let position = pos(fx, i);
    let token = token_of(fx, i);
    let room = fx.room;
    let mint = fx.mint;
    send(
        &mut fx.svm,
        Base,
        &[&p],
        &[ix(
            instruction::JoinRoom { viewer: Pubkey::default() },
            accounts::JoinRoom {
                player,
                config: config_pda(),
                room,
                position,
                rating: rating_pda(&player),
                player_token: token,
                vault: vault_pda(&room),
                mint,
                token_program: SPL_TOKEN,
                system_program: system_program::ID,
            },
        )],
        "join",
    );
}

fn logs_contain(err: &(String, Vec<String>), needle: &str) -> bool {
    err.1.iter().any(|l| l.contains(needle)) || err.0.contains(needle)
}

#[test]
fn settled_room_pays_rent_to_the_fixed_recipient() {
    // settle already closed the vault. The room account is what close_room returns.
    let mut fx = boot_fixture(42, 0, 4);
    set_status(&mut fx.svm, &fx.room, RoomStatus::Settled);
    wipe(&mut fx.svm, &vault_pda(&fx.room));
    let room_rent = lamports(&fx.svm, &fx.room);
    let before = lamports(&fx.svm, &RENT_RECIPIENT);
    let creator = fx.creator.insecure_clone();
    send(&mut fx.svm, Base, &[&creator], &[close_ix(pk(&creator.pubkey()), fx.room, &[])], "close settled");
    assert!(fx.svm.get_account(&ad(&fx.room)).map(|a| a.lamports == 0).unwrap_or(true), "room gone");
    assert_eq!(lamports(&fx.svm, &RENT_RECIPIENT) - before, room_rent);
}

#[test]
fn config_admin_can_close_a_room_they_did_not_create() {
    let mut fx = boot_fixture(43, 0, 4);
    set_status(&mut fx.svm, &fx.room, RoomStatus::Settled);
    wipe(&mut fx.svm, &vault_pda(&fx.room));
    let admin = fx.admin.insecure_clone();
    send(&mut fx.svm, Base, &[&admin], &[close_ix(pk(&admin.pubkey()), fx.room, &[])], "admin close");
    assert!(fx.svm.get_account(&ad(&fx.room)).map(|a| a.lamports == 0).unwrap_or(true));
}

#[test]
fn cancelled_empty_vault_is_closed_with_the_room() {
    let mut fx = boot_fixture(7, 1, 5);
    join_only(&mut fx, 0);
    let t = now(&fx.svm) + 61;
    set_unix(&mut fx.svm, t);
    let creator = fx.creator.insecure_clone();
    let player_token = token_of(&fx, 0);
    let vault = vault_pda(&fx.room);
    let room = fx.room;
    let mint = fx.mint;
    send(
        &mut fx.svm,
        Base,
        &[&creator],
        &[ix_with(
            instruction::Refund {},
            accounts::Refund { room, vault, mint, token_program: SPL_TOKEN },
            vec![w(player_token)],
        )],
        "refund",
    );
    assert_eq!(token_amount(&fx.svm, &vault), 0);
    assert_eq!(token_amount(&fx.svm, &player_token), 10 * ENTRY, "entry returned");
    let player = fx.players[0].insecure_clone();
    let position = pos(&fx, 0);
    // Position still open: closing the room would strand its rent.
    let early = close_ix(pk(&creator.pubkey()), room, &[position]);
    let err = try_send(&mut fx.svm, Base, &[&creator], &[early]).unwrap_err();
    assert!(logs_contain(&err, "PositionInUse"), "{err:?}");
    assert!(lamports(&fx.svm, &room) > 0, "room stays");
    send(
        &mut fx.svm,
        Base,
        &[&player],
        &[ix(instruction::ClosePosition {}, accounts::ClosePosition { owner: pk(&player.pubkey()), room, position })],
        "close_position",
    );
    let room_rent = lamports(&fx.svm, &room);
    let vault_rent = lamports(&fx.svm, &vault);
    let before = lamports(&fx.svm, &RENT_RECIPIENT);
    send(&mut fx.svm, Base, &[&creator], &[close_ix(pk(&creator.pubkey()), room, &[position])], "close cancelled");
    assert!(fx.svm.get_account(&ad(&room)).map(|a| a.lamports == 0).unwrap_or(true));
    assert!(fx.svm.get_account(&ad(&vault)).map(|a| a.lamports == 0).unwrap_or(true), "vault gone");
    assert_eq!(lamports(&fx.svm, &RENT_RECIPIENT) - before, room_rent + vault_rent);
    assert_eq!(token_amount(&fx.svm, &player_token), 10 * ENTRY, "player USDC untouched");
}

#[test]
fn rejects_wrong_signer_wrong_recipient_open_room_and_funded_vault() {
    let mut fx = boot_fixture(11, 1, 5);
    let creator = fx.creator.insecure_clone();
    let stranger = fx.players[0].insecure_clone();

    let open = close_ix(pk(&creator.pubkey()), fx.room, &[]);
    let err = try_send(&mut fx.svm, Base, &[&creator], &[open]).unwrap_err();
    assert!(logs_contain(&err, "WrongStatus"), "open room: {err:?}");

    let mut wrong_recipient = close_ix(pk(&creator.pubkey()), fx.room, &[]);
    // recipient is the 4th account: authority, config, room, recipient, vault, token program
    wrong_recipient.accounts[3].pubkey = creator.pubkey();
    set_status(&mut fx.svm, &fx.room, RoomStatus::Settled);
    let err = try_send(&mut fx.svm, Base, &[&creator], &[wrong_recipient]).unwrap_err();
    assert!(logs_contain(&err, "Unauthorized"), "wrong recipient: {err:?}");

    let wrong_signer = close_ix(pk(&stranger.pubkey()), fx.room, &[]);
    let err = try_send(&mut fx.svm, Base, &[&stranger], &[wrong_signer]).unwrap_err();
    assert!(logs_contain(&err, "Unauthorized"), "wrong signer: {err:?}");
    assert!(lamports(&fx.svm, &fx.room) > 0);

    // Cancelled with the entry still in the vault. Nothing may move.
    set_status(&mut fx.svm, &fx.room, RoomStatus::Open);
    join_only(&mut fx, 0);
    set_status(&mut fx.svm, &fx.room, RoomStatus::Cancelled);
    let vault = vault_pda(&fx.room);
    let position = pos(&fx, 0);
    let player_token = token_of(&fx, 0);
    let room = fx.room;
    let held = token_amount(&fx.svm, &vault);
    assert_eq!(held, ENTRY);
    let err = try_send(&mut fx.svm, Base, &[&creator], &[close_ix(pk(&creator.pubkey()), room, &[position])]).unwrap_err();
    assert!(logs_contain(&err, "VaultNotEmpty") || logs_contain(&err, "PositionInUse"), "{err:?}");
    // Position is still open, so PositionInUse fires before the vault check. Close the position
    // (it is allowed once Cancelled) and the funded vault must still block the room close.
    let player = fx.players[0].insecure_clone();
    send(
        &mut fx.svm,
        Base,
        &[&player],
        &[ix(instruction::ClosePosition {}, accounts::ClosePosition { owner: pk(&player.pubkey()), room, position })],
        "close_position",
    );
    let err = try_send(&mut fx.svm, Base, &[&creator], &[close_ix(pk(&creator.pubkey()), room, &[position])]).unwrap_err();
    assert!(logs_contain(&err, "VaultNotEmpty"), "{err:?}");
    assert_eq!(token_amount(&fx.svm, &vault), ENTRY, "USDC stays in the vault");
    assert_eq!(token_amount(&fx.svm, &player_token), 9 * ENTRY);
    assert!(lamports(&fx.svm, &room) > 0, "room stays");
}

#[test]
fn delegated_room_cannot_be_closed() {
    let mut fx = boot_fixture(99, 4, 4);
    for i in 0..4 {
        let player = pk(&fx.players[i].pubkey());
        let position = pos(&fx, i);
        let p = fx.players[i].insecure_clone();
        let join = ix(
            instruction::JoinRoom { viewer: Pubkey::default() },
            accounts::JoinRoom {
                player,
                config: config_pda(),
                room: fx.room,
                position,
                rating: rating_pda(&player),
                player_token: token_of(&fx, i),
                vault: vault_pda(&fx.room),
                mint: fx.mint,
                token_program: SPL_TOKEN,
                system_program: system_program::ID,
            },
        );
        let delegate = ix_with(
            instruction::DelegatePosition {},
            accounts::DelegatePosition {
                payer: player,
                room: fx.room,
                buffer_position: delegate_buffer_pda_from_delegated_account_and_owner_program(&position, &program_id()),
                delegation_record_position: delegation_record_pda_from_delegated_account(&position),
                delegation_metadata_position: delegation_metadata_pda_from_delegated_account(&position),
                position,
                owner_program: program_id(),
                delegation_program: DelegationProgram::id(),
                system_program: system_program::ID,
            },
            vec![r(pk(&fx.svm.validator_identity()))],
        );
        send(&mut fx.svm, Base, &[&p], &[join, delegate], "join+delegate");
    }
    let creator = fx.creator.insecure_clone();
    let start = ix_with(
        instruction::StartRoom {},
        accounts::StartRoom {
            payer: pk(&creator.pubkey()),
            buffer_room: delegate_buffer_pda_from_delegated_account_and_owner_program(&fx.room, &program_id()),
            delegation_record_room: delegation_record_pda_from_delegated_account(&fx.room),
            delegation_metadata_room: delegation_metadata_pda_from_delegated_account(&fx.room),
            room: fx.room,
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
        vec![r(pk(&fx.svm.validator_identity()))],
    );
    send(&mut fx.svm, Base, &[&creator], &[start], "start_room");
    assert_eq!(owner_of(&fx.svm, Base, &fx.room), pk(&ephemeral_rollups_sdk::id()));
    let positions: Vec<Pubkey> = (0..4).map(|i| pos(&fx, i)).collect();
    let err = try_send(&mut fx.svm, Base, &[&creator], &[close_ix(pk(&creator.pubkey()), fx.room, &positions)]).unwrap_err();
    assert!(logs_contain(&err, "StillDelegated") || logs_contain(&err, "AccountOwnedByWrongProgram"), "{err:?}");
    assert_eq!(owner_of(&fx.svm, Base, &fx.room), pk(&ephemeral_rollups_sdk::id()), "room stays delegated");
}
