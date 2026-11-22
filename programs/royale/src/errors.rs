use anchor_lang::prelude::*;

#[error_code]
pub enum RoyaleError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Invalid fee")]
    InvalidFee,
    #[msg("Entry amount out of bounds")]
    InvalidEntry,
    #[msg("Seats must be between 4 and 16")]
    InvalidSeats,
    #[msg("Rooms need 1 to 3 distinct whitelisted assets")]
    InvalidAssets,
    #[msg("Invalid timing parameter")]
    InvalidTiming,
    #[msg("Wrong mint")]
    WrongMint,
    #[msg("Room is not open")]
    RoomNotOpen,
    #[msg("Room is full")]
    RoomFull,
    #[msg("Fill window has closed")]
    FillExpired,
    #[msg("Already joined")]
    AlreadyJoined,
    #[msg("Room can't start yet")]
    NotStartable,
    #[msg("Room can't be cancelled")]
    NotCancellable,
    #[msg("Wrong room status")]
    WrongStatus,
    #[msg("Round is not live")]
    RoundNotLive,
    #[msg("Position accounts don't match the room's seats")]
    PositionMismatch,
    #[msg("Feed accounts don't match the room's assets")]
    FeedMismatch,
    #[msg("Position is eliminated")]
    Eliminated,
    #[msg("Minimum hold time not reached")]
    HoldTime,
    #[msg("Leverage not allowed")]
    InvalidLeverage,
    #[msg("Invalid side")]
    InvalidSide,
    #[msg("Asset index out of range")]
    InvalidAsset,
    #[msg("That side is frozen by a storm")]
    SideFrozen,
    #[msg("No change in position")]
    NoChange,
    #[msg("Oracle account is not the pinned feed")]
    OracleWrongAccount,
    #[msg("Oracle account has the wrong owner")]
    OracleWrongOwner,
    #[msg("Oracle account could not be decoded")]
    OracleDecode,
    #[msg("Oracle price is stale")]
    OracleStale,
    #[msg("Oracle price is invalid")]
    OracleInvalid,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Positions are not all permissioned")]
    NotPermissioned,
    #[msg("Begin timeout has not passed")]
    TooEarly,
    #[msg("Room is still delegated")]
    StillDelegated,
    #[msg("Room already settled")]
    AlreadySettled,
    #[msg("Payout account mismatch")]
    PayoutAccountMismatch,
    #[msg("Vault balance below pot")]
    VaultShort,
    #[msg("Ratings already updated")]
    AlreadyRated,
    #[msg("Rating accounts don't match the room's seats")]
    RatingMismatch,
    #[msg("Wrong VRF oracle queue")]
    WrongQueue,
    #[msg("Position still in use")]
    PositionInUse,
}
