//! Shared harness for the MagicSVM integration tests (base ledger + ephemeral ledger in-process).

use anchor_lang::{prelude::Pubkey, AccountDeserialize, AnchorSerialize, InstructionData, ToAccountMetas};
use magicsvm::{MagicSVM, TransactionTarget};
use royale::constants::*;
use royale::oracle::{OraclePriceUpdate, PriceFeedMessage, VerificationLevel};
use royale::state::{Position, Room};
use solana_account::Account as StockAccount;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

pub use magicsvm;

pub const SPL_TOKEN: Pubkey = anchor_spl::token::ID;
pub const SLOT_MS: i64 = 50;

pub fn pk(a: &Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}
pub fn ad(p: &Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}

pub fn program_id() -> Pubkey {
    royale::ID
}

pub fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    ix_with(data, accounts, vec![])
}

pub fn ix_with(data: impl InstructionData, accounts: impl ToAccountMetas, extra: Vec<anchor_lang::solana_program::instruction::AccountMeta>) -> Instruction {
    let mut metas: Vec<AccountMeta> = accounts
        .to_account_metas(None)
        .into_iter()
        .chain(extra)
        .map(|m| AccountMeta {
            pubkey: ad(&m.pubkey),
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect();
    metas.shrink_to_fit();
    Instruction {
        program_id: ad(&program_id()),
        accounts: metas,
        data: data.data(),
    }
}

pub fn w(p: Pubkey) -> anchor_lang::solana_program::instruction::AccountMeta {
    anchor_lang::solana_program::instruction::AccountMeta::new(p, false)
}
pub fn r(p: Pubkey) -> anchor_lang::solana_program::instruction::AccountMeta {
    anchor_lang::solana_program::instruction::AccountMeta::new_readonly(p, false)
}

/// Send and return Err(logs) on failure.
pub fn try_send(svm: &mut MagicSVM, target: TransactionTarget, signers: &[&Keypair], ixs: &[Instruction]) -> Result<Vec<String>, (String, Vec<String>)> {
    let msg = Message::new(ixs, Some(&signers[0].pubkey()));
    let tx = Transaction::new(signers, msg, svm.latest_blockhash_for(target));
    let res = svm.send_transaction_to(target, tx);
    svm.expire_blockhash_for(target);
    match res {
        Ok(meta) => Ok(meta.logs),
        Err(failed) => Err((format!("{:?}", failed.err), failed.meta.logs)),
    }
}

pub fn send(svm: &mut MagicSVM, target: TransactionTarget, signers: &[&Keypair], ixs: &[Instruction], label: &str) -> Vec<String> {
    match try_send(svm, target, signers, ixs) {
        Ok(logs) => logs,
        Err((err, logs)) => panic!("{label} failed on {target:?}: {err}\nlogs: {logs:#?}"),
    }
}

pub fn deploy_so() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/royale.so")
}

/// Boot MagicSVM with royale loaded and `admin` as its upgrade authority.
pub fn boot(admin: &Keypair) -> MagicSVM {
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(ad(&program_id()), deploy_so()).expect("load royale.so");
    // LiteSVM creates the programdata account with no upgrade authority; set ours.
    let pd = programdata_address();
    let mut acc = svm.get_account(&ad(&pd)).expect("programdata");
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(&admin.pubkey().to_bytes());
    svm.set_account(ad(&pd), acc).unwrap();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    svm
}

pub fn programdata_address() -> Pubkey {
    Pubkey::find_program_address(
        &[program_id().as_ref()],
        &anchor_lang::solana_program::bpf_loader_upgradeable::ID,
    )
    .0
}

// ---------------- SPL token fixtures (packed by hand) ----------------

pub fn create_mint(svm: &mut MagicSVM, mint: &Pubkey, authority: &Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(authority.as_ref());
    data[36..44].copy_from_slice(&0u64.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    svm.set_account(
        ad(mint),
        StockAccount { lamports: 1_461_600, data, owner: ad(&SPL_TOKEN), executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

pub fn create_token_account(svm: &mut MagicSVM, address: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // initialized
    svm.set_account(
        ad(address),
        StockAccount { lamports: 2_039_280, data, owner: ad(&SPL_TOKEN), executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

pub fn token_amount(svm: &MagicSVM, address: &Pubkey) -> u64 {
    match svm.get_account(&ad(address)) {
        Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
        _ => 0,
    }
}

// ---------------- Oracle fixtures (ER-side PriceUpdateV3 layout) ----------------

pub fn feed_bytes(feed: &Pubkey, price: i64, publish_time: i64, posted_slot: u64) -> Vec<u8> {
    let update = OraclePriceUpdate {
        write_authority: Pubkey::new_unique(),
        verification_level: VerificationLevel::Full,
        price_message: PriceFeedMessage {
            feed_id: feed.to_bytes(),
            price,
            conf: 0,
            exponent: 8, // the live account stores a wrong +8; the program must ignore it
            publish_time,
            prev_publish_time: publish_time - 1,
            ema_price: price,
            ema_conf: 0,
        },
        posted_slot,
    };
    let mut data = vec![0x56, 0x33, 0x50, 0x55, 0x01, 0x02, 0x03, 0x04]; // arbitrary discriminator
    update.serialize(&mut data).unwrap();
    if data.len() < 134 {
        data.resize(134, 0);
    }
    data
}

pub fn set_feed(svm: &mut MagicSVM, feed: &Pubkey, price: i64, publish_time: i64) {
    let slot = svm.ephemeral().get_sysvar::<Clock>().slot.max(1);
    let acc = magicblock_account_shim(feed_bytes(feed, price, publish_time, slot), ORACLE_PROGRAM_ID);
    svm.ephemeral_mut().set_account(ad(feed), acc).unwrap();
}

fn magicblock_account_shim(data: Vec<u8>, owner: Pubkey) -> magicblock_account::Account {
    magicblock_account::Account {
        lamports: 10_000_000,
        data,
        owner: ad(&owner),
        executable: false,
        rent_epoch: 0,
    }
}

// ---------------- Clock ----------------

pub fn now(svm: &MagicSVM) -> i64 {
    svm.ephemeral().get_sysvar::<Clock>().unix_timestamp
}

pub fn slot(svm: &MagicSVM) -> u64 {
    svm.ephemeral().get_sysvar::<Clock>().slot
}

/// Move both ledgers' unix time to `unix` (slot unchanged).
pub fn set_unix(svm: &mut MagicSVM, unix: i64) {
    let mut c = svm.ephemeral().get_sysvar::<Clock>();
    c.unix_timestamp = unix;
    svm.set_sysvar(&c);
}

/// Advance one second: unix + 1, then run every crank / VRF job due in the next 20 slots.
/// Returns crank+VRF results.
pub fn step_second(svm: &mut MagicSVM) -> Vec<magicsvm_result::Res> {
    let t = now(svm) + 1;
    set_unix(svm, t);
    let target = slot(svm) + (1000 / SLOT_MS) as u64;
    let res = svm.warp_to_slot(target);
    // warp keeps unix_timestamp; re-assert it in case a ledger was behind
    set_unix(svm, t);
    res.into_iter()
        .map(|r| match r {
            Ok(m) => magicsvm_result::Res { ok: true, err: String::new(), logs: m.logs },
            Err(f) => magicsvm_result::Res { ok: false, err: format!("{:?}", f.err), logs: f.meta.logs },
        })
        .collect()
}

pub mod magicsvm_result {
    #[derive(Debug, Clone)]
    pub struct Res {
        pub ok: bool,
        pub err: String,
        pub logs: Vec<String>,
    }
}

// ---------------- Account readers ----------------

pub fn read_room(svm: &MagicSVM, target: TransactionTarget, room: &Pubkey) -> Room {
    let a = svm.get_account_for(target, &ad(room)).expect("room");
    Room::try_deserialize(&mut &a.data[..]).expect("decode room")
}

pub fn read_position(svm: &MagicSVM, target: TransactionTarget, pos: &Pubkey) -> Option<Position> {
    let a = svm.get_account_for(target, &ad(pos))?;
    Position::try_deserialize(&mut &a.data[..]).ok()
}

pub fn owner_of(svm: &MagicSVM, target: TransactionTarget, p: &Pubkey) -> Pubkey {
    pk(&svm.get_account_for(target, &ad(p)).expect("account").owner)
}

// ---------------- PDAs ----------------

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &program_id()).0
}
pub fn room_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[ROOM_SEED, &id.to_le_bytes()], &program_id()).0
}
pub fn vault_pda(room: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, room.as_ref()], &program_id()).0
}
pub fn position_pda(room: &Pubkey, player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[POSITION_SEED, room.as_ref(), player.as_ref()], &program_id()).0
}
pub fn rating_pda(player: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[RATING_SEED, player.as_ref()], &program_id()).0
}
pub fn permission_pda(acc: &Pubkey) -> Pubkey {
    ephemeral_rollups_sdk::access_control::structs::EphemeralPermission::find_pda(acc).0
}

/// MagicSVM 0.3.0's undelegation copies the account back to base but leaves the Delegation
/// Program's record + metadata PDAs in place (the real DLP `Undelegate` closes them). Its post-tx
/// hook then treats any later base write to that account as a fresh delegation. Close them here to
/// mirror mainnet behaviour after the committor finalizes the undelegation.
pub fn finish_undelegation(svm: &mut MagicSVM, accounts: &[Pubkey]) {
    use ephemeral_rollups_sdk::pda::{delegation_metadata_pda_from_delegated_account, delegation_record_pda_from_delegated_account};
    for a in accounts {
        for pda in [delegation_record_pda_from_delegated_account(a), delegation_metadata_pda_from_delegated_account(a)] {
            let _ = svm.set_account(ad(&pda), StockAccount { lamports: 0, data: vec![], owner: ad(&Pubkey::default()), executable: false, rent_epoch: 0 });
        }
    }
}
