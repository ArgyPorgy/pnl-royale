//! MagicBlock pricing-oracle reader.
//!
//! Live feeds are `PriceUpdateV3` accounts owned by `PriCems…` whose body has Pyth's
//! `PriceUpdateV2` field layout. We pin the address and owner, skip the 8-byte Anchor
//! discriminator, and borsh-decode the body (no hand-written byte offsets). Never trust the
//! stored exponent (+8 on every live feed); we only use price ratios.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RoyaleError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct OraclePriceUpdate {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct Price {
    pub price: i64,
    pub publish_time: i64,
}

/// Decode and sanity-check a feed account (address, owner, feed id, republisher write).
pub fn decode_feed(info: &AccountInfo, expected: &Pubkey) -> Result<Price> {
    require_keys_eq!(*info.key, *expected, RoyaleError::OracleWrongAccount);
    require_keys_eq!(*info.owner, ORACLE_PROGRAM_ID, RoyaleError::OracleWrongOwner);
    let data = info.try_borrow_data()?;
    require!(data.len() > 8, RoyaleError::OracleDecode);
    let mut body: &[u8] = &data[8..];
    let update =
        OraclePriceUpdate::deserialize(&mut body).map_err(|_| error!(RoyaleError::OracleDecode))?;
    // The stored feed id is the feed account's own address.
    require!(
        update.price_message.feed_id == expected.to_bytes(),
        RoyaleError::OracleWrongAccount
    );
    // Initialization writes a zero placeholder with posted_slot = 0 and level Full.
    require!(update.posted_slot > 0, RoyaleError::OracleInvalid);
    require!(
        update.verification_level == VerificationLevel::Full,
        RoyaleError::OracleInvalid
    );
    require!(update.price_message.price > 0, RoyaleError::OracleInvalid);
    Ok(Price {
        price: update.price_message.price,
        publish_time: update.price_message.publish_time,
    })
}

/// A fresh price (upstream publish time no older than `max_age`).
pub fn read_fresh(info: &AccountInfo, expected: &Pubkey, now: i64, max_age: i64) -> Result<i64> {
    let p = decode_feed(info, expected)?;
    require!(now - p.publish_time <= max_age, RoyaleError::OracleStale);
    Ok(p.price)
}

/// Find the feed account for `expected` among `feeds` and read a fresh price.
pub fn read_from(
    feeds: &[AccountInfo],
    expected: &Pubkey,
    now: i64,
    max_age: i64,
) -> Result<i64> {
    let info = feeds
        .iter()
        .find(|f| f.key == expected)
        .ok_or(error!(RoyaleError::FeedMismatch))?;
    read_fresh(info, expected, now, max_age)
}
