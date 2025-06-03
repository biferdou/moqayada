use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::token::{Mint, Token};

declare_id!("Xxf3vRZE7MbcRgGHYc7baYQuvq6sjYCNmpKzMpKCPep");

// Program constants
pub const MAX_COORDINATE: i32 = 10000;
pub const MIN_COORDINATE: i32 = -10000;
pub const MAX_URI_LENGTH: usize = 200;
pub const MAX_NAME_LENGTH: usize = 32;
pub const MARKETPLACE_FEE_BASIS_POINTS: u16 = 250; // 2.5%
pub const MIN_PRICE: u64 = 1_000_000; // 0.001 SOL minimum
pub const LISTING_DURATION_SECONDS: i64 = 30 * 24 * 60 * 60; // 30 days

#[program]
pub mod moqayada {
    use super::*;

    pub fn initialize_marketplace(
        ctx: Context<InitializeMarketplace>,
        fee_percentage: u16,
    ) -> Result<()> {
        require!(fee_percentage <= 1000, ErrorCode::FeeTooHigh); // Max 10%

        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.authority.key();
        marketplace.fee_percentage = fee_percentage;
        marketplace.treasury = ctx.accounts.treasury.key();
        marketplace.total_volume = 0;
        marketplace.active_listings = 0;
        marketplace.total_parcels_minted = 0;
        marketplace.bump = ctx.bumps.marketplace;

        emit!(MarketplaceInitialized {
            authority: marketplace.authority,
            fee_percentage,
            treasury: marketplace.treasury,
        });

        Ok(())
    }

    pub fn mint_land_parcel(
        ctx: Context<MintLandParcel>,
        coordinates: Coordinates,
        size: ParcelSize,
        rarity: Rarity,
        name: String,
        uri: String,
    ) -> Result<()> {
        // Validate inputs
        require!(
            coordinates.x >= MIN_COORDINATE && coordinates.x <= MAX_COORDINATE,
            ErrorCode::InvalidCoordinates
        );
        require!(
            coordinates.y >= MIN_COORDINATE && coordinates.y <= MAX_COORDINATE,
            ErrorCode::InvalidCoordinates
        );
        require!(name.len() <= MAX_NAME_LENGTH, ErrorCode::NameTooLong);
        require!(uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);

        // Initialize land parcel
        let land_parcel = &mut ctx.accounts.land_parcel;
        land_parcel.mint = ctx.accounts.mint.key();
        land_parcel.owner = ctx.accounts.owner.key();
        land_parcel.coordinates = coordinates;
        land_parcel.size = size;
        land_parcel.rarity = rarity;
        land_parcel.metadata_uri = uri.clone();
        land_parcel.created_at = Clock::get()?.unix_timestamp;
        land_parcel.is_listed = false;
        land_parcel.total_trades = 0;
        land_parcel.last_sale_price = 0;

        // Create NFT metadata
        let metadata_ctx = CpiContext::new(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.payer.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
        );

        let metadata_data = DataV2 {
            name,
            symbol: "LAND".to_string(),
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        create_metadata_accounts_v3(metadata_ctx, metadata_data, false, true, None)?;

        // Update marketplace stats
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.total_parcels_minted = marketplace
            .total_parcels_minted
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(LandParcelMinted {
            mint: land_parcel.mint,
            owner: land_parcel.owner,
            coordinates: land_parcel.coordinates,
            size: land_parcel.size,
            rarity: land_parcel.rarity,
        });

        Ok(())
    }

    pub fn list_parcel_for_sale(
        ctx: Context<ListParcelForSale>,
        price: u64,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(price >= MIN_PRICE, ErrorCode::PriceTooLow);

        if let Some(expiry) = expires_at {
            let current_time = Clock::get()?.unix_timestamp;
            require!(expiry > current_time, ErrorCode::InvalidExpiryTime);
            require!(
                expiry <= current_time + LISTING_DURATION_SECONDS,
                ErrorCode::ExpiryTooFar
            );
        }

        let land_parcel = &mut ctx.accounts.land_parcel;
        require!(!land_parcel.is_listed, ErrorCode::AlreadyListed);

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.parcel_mint = land_parcel.mint;
        listing.price = price;
        listing.created_at = Clock::get()?.unix_timestamp;
        listing.expires_at = expires_at;
        listing.status = ListingStatus::Active;
        listing.bump = ctx.bumps.listing;

        // Update parcel status
        land_parcel.is_listed = true;

        // Update marketplace stats
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.active_listings = marketplace
            .active_listings
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ParcelListed {
            mint: land_parcel.mint,
            seller: listing.seller,
            price,
            expires_at,
        });

        Ok(())
    }

    pub fn purchase_parcel(ctx: Context<PurchaseParcel>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        let land_parcel = &mut ctx.accounts.land_parcel;

        require!(
            listing.status == ListingStatus::Active,
            ErrorCode::ListingNotActive
        );

        // Check if listing has expired
        if let Some(expiry) = listing.expires_at {
            require!(
                Clock::get()?.unix_timestamp <= expiry,
                ErrorCode::ListingExpired
            );
        }

        let price = listing.price;
        let marketplace = &ctx.accounts.marketplace;

        // Calculate marketplace fee
        let fee_amount = price
            .checked_mul(marketplace.fee_percentage as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        let seller_amount = price
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        // Transfer SOL to seller
        let transfer_to_seller = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.seller.to_account_info(),
        };
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                transfer_to_seller,
            ),
            seller_amount,
        )?;

        // Transfer fee to treasury
        if fee_amount > 0 {
            let transfer_to_treasury = anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            };
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    transfer_to_treasury,
                ),
                fee_amount,
            )?;
        }

        // Update parcel ownership
        land_parcel.owner = ctx.accounts.buyer.key();
        land_parcel.is_listed = false;
        land_parcel.total_trades = land_parcel
            .total_trades
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;
        land_parcel.last_sale_price = price;

        // Update listing status
        listing.status = ListingStatus::Sold;

        // Update marketplace stats
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.active_listings = marketplace
            .active_listings
            .checked_sub(1)
            .ok_or(ErrorCode::MathOverflow)?;
        marketplace.total_volume = marketplace
            .total_volume
            .checked_add(price)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ParcelSold {
            mint: land_parcel.mint,
            seller: listing.seller,
            buyer: land_parcel.owner,
            price,
            fee_amount,
        });

        Ok(())
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        let land_parcel = &mut ctx.accounts.land_parcel;

        require!(
            listing.status == ListingStatus::Active,
            ErrorCode::ListingNotActive
        );

        // Update listing status
        listing.status = ListingStatus::Cancelled;

        // Update parcel status
        land_parcel.is_listed = false;

        // Update marketplace stats
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.active_listings = marketplace
            .active_listings
            .checked_sub(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ListingCancelled {
            mint: land_parcel.mint,
            seller: listing.seller,
        });

        Ok(())
    }

    pub fn update_marketplace_fee(
        ctx: Context<UpdateMarketplaceFee>,
        new_fee_percentage: u16,
    ) -> Result<()> {
        require!(new_fee_percentage <= 1000, ErrorCode::FeeTooHigh); // Max 10%

        let marketplace = &mut ctx.accounts.marketplace;
        let old_fee = marketplace.fee_percentage;
        marketplace.fee_percentage = new_fee_percentage;

        emit!(MarketplaceFeeUpdated {
            old_fee,
            new_fee: new_fee_percentage,
        });

        Ok(())
    }
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct Marketplace {
    pub authority: Pubkey,         // 32 bytes
    pub fee_percentage: u16,       // 2 bytes (basis points)
    pub treasury: Pubkey,          // 32 bytes
    pub total_volume: u64,         // 8 bytes
    pub active_listings: u32,      // 4 bytes
    pub total_parcels_minted: u64, // 8 bytes
    pub bump: u8,                  // 1 byte
                                   // Total: 87 bytes + 8 (discriminator) = 95 bytes
}

#[account]
pub struct LandParcel {
    pub mint: Pubkey,             // 32 bytes
    pub owner: Pubkey,            // 32 bytes
    pub coordinates: Coordinates, // 8 bytes
    pub size: ParcelSize,         // 1 byte
    pub rarity: Rarity,           // 1 byte
    pub metadata_uri: String,     // 4 + MAX_URI_LENGTH (204 bytes)
    pub created_at: i64,          // 8 bytes
    pub is_listed: bool,          // 1 byte
    pub total_trades: u32,        // 4 bytes
    pub last_sale_price: u64,     // 8 bytes
                                  // Total: ~299 bytes + 8 (discriminator) = ~307 bytes
}

#[account]
pub struct Listing {
    pub seller: Pubkey,          // 32 bytes
    pub parcel_mint: Pubkey,     // 32 bytes
    pub price: u64,              // 8 bytes
    pub created_at: i64,         // 8 bytes
    pub expires_at: Option<i64>, // 1 + 8 bytes
    pub status: ListingStatus,   // 1 byte
    pub bump: u8,                // 1 byte
                                 // Total: 91 bytes + 8 (discriminator) = 99 bytes
}

// ============================================================================
// Custom Types and Enums
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub struct Coordinates {
    pub x: i32,
    pub y: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum ParcelSize {
    Small,  // 1x1
    Medium, // 2x2
    Large,  // 4x4
    XLarge, // 8x8
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum ListingStatus {
    Active,
    Sold,
    Cancelled,
    Expired,
}

// ============================================================================
// Context Structures
// ============================================================================

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 95,
        seeds = [b"marketplace"],
        bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Treasury account to receive fees
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(coordinates: Coordinates)]
pub struct MintLandParcel<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 307
    )]
    pub land_parcel: Account<'info, LandParcel>,

    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = payer,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metadata account
    #[account(mut)]
    pub metadata: AccountInfo<'info>,

    pub owner: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ListParcelForSale<'info> {
    #[account(
        init,
        payer = seller,
        space = 8 + 99,
        seeds = [
            b"listing",
            land_parcel.mint.as_ref()
        ],
        bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(
        mut,
        constraint = land_parcel.owner == owner.key() @ ErrorCode::NotParcelOwner
    )]
    pub land_parcel: Account<'info, LandParcel>,

    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    pub owner: Signer<'info>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PurchaseParcel<'info> {
    #[account(
        mut,
        seeds = [
            b"listing",
            land_parcel.mint.as_ref()
        ],
        bump = listing.bump,
        has_one = seller @ ErrorCode::InvalidSeller
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub land_parcel: Account<'info, LandParcel>,

    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        address = listing.seller @ ErrorCode::InvalidSeller
    )]
    pub seller: SystemAccount<'info>,

    #[account(
        mut,
        address = marketplace.treasury @ ErrorCode::InvalidTreasury
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [
            b"listing",
            land_parcel.mint.as_ref()
        ],
        bump = listing.bump,
        has_one = seller @ ErrorCode::NotListingSeller
    )]
    pub listing: Account<'info, Listing>,

    #[account(mut)]
    pub land_parcel: Account<'info, LandParcel>,

    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketplaceFee<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump,
        has_one = authority @ ErrorCode::NotMarketplaceAuthority
    )]
    pub marketplace: Account<'info, Marketplace>,

    pub authority: Signer<'info>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct MarketplaceInitialized {
    pub authority: Pubkey,
    pub fee_percentage: u16,
    pub treasury: Pubkey,
}

#[event]
pub struct LandParcelMinted {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub coordinates: Coordinates,
    pub size: ParcelSize,
    pub rarity: Rarity,
}

#[event]
pub struct ParcelListed {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub expires_at: Option<i64>,
}

#[event]
pub struct ParcelSold {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub fee_amount: u64,
}

#[event]
pub struct ListingCancelled {
    pub mint: Pubkey,
    pub seller: Pubkey,
}

#[event]
pub struct MarketplaceFeeUpdated {
    pub old_fee: u16,
    pub new_fee: u16,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid coordinates provided")]
    InvalidCoordinates,

    #[msg("Name is too long")]
    NameTooLong,

    #[msg("URI is too long")]
    UriTooLong,

    #[msg("Fee percentage is too high")]
    FeeTooHigh,

    #[msg("Price is too low")]
    PriceTooLow,

    #[msg("Invalid expiry time")]
    InvalidExpiryTime,

    #[msg("Expiry time is too far in the future")]
    ExpiryTooFar,

    #[msg("Parcel is already listed for sale")]
    AlreadyListed,

    #[msg("Listing is not active")]
    ListingNotActive,

    #[msg("Listing has expired")]
    ListingExpired,

    #[msg("Not the owner of this parcel")]
    NotParcelOwner,

    #[msg("Not the seller of this listing")]
    NotListingSeller,

    #[msg("Invalid seller")]
    InvalidSeller,

    #[msg("Invalid treasury")]
    InvalidTreasury,

    #[msg("Not the marketplace authority")]
    NotMarketplaceAuthority,

    #[msg("Math overflow")]
    MathOverflow,
}
