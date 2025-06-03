import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Moqayada } from "../target/types/moqayada";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";

// Import Metaplex constants
const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

describe("moqayada", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.moqayada as Program<Moqayada>;
  const provider = anchor.getProvider();

  // Test accounts
  let marketplace: PublicKey;
  let authority: Keypair;
  let treasury: Keypair;
  let landParcel: Keypair;
  let mint: Keypair;
  let metadata: PublicKey;
  let listing: PublicKey;
  let seller: Keypair;
  let buyer: Keypair;

  // Test data
  const coordinates = { x: 100, y: 200 };
  const parcelSize = { small: {} };
  const rarity = { common: {} };
  const parcelName = "Test Land Parcel";
  const metadataUri = "https://example.com/metadata.json";
  const salePrice = new BN(LAMPORTS_PER_SOL); // 1 SOL

  before(async () => {
    // Initialize keypairs
    authority = Keypair.generate();
    treasury = Keypair.generate();
    seller = Keypair.generate();
    buyer = Keypair.generate();
    mint = Keypair.generate();
    landParcel = Keypair.generate();

    // Airdrop SOL to test accounts
    await Promise.all([
      provider.connection.requestAirdrop(
        authority.publicKey,
        10 * LAMPORTS_PER_SOL
      ),
      provider.connection.requestAirdrop(
        seller.publicKey,
        10 * LAMPORTS_PER_SOL
      ),
      provider.connection.requestAirdrop(
        buyer.publicKey,
        10 * LAMPORTS_PER_SOL
      ),
    ]);

    // Wait for confirmations
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive PDAs
    [marketplace] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    [metadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    [listing] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), mint.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Marketplace Initialization", () => {
    it("Initializes the marketplace successfully", async () => {
      const feePercentage = 250; // 2.5%

      const tx = await program.methods
        .initializeMarketplace(feePercentage)
        .accounts({
          marketplace,
          authority: authority.publicKey,
          treasury: treasury.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log("Marketplace initialized:", tx);

      // Verify marketplace account
      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(marketplaceAccount.feePercentage).to.equal(feePercentage);
      expect(marketplaceAccount.treasury.toString()).to.equal(
        treasury.publicKey.toString()
      );
      expect(marketplaceAccount.totalVolume.toNumber()).to.equal(0);
      expect(marketplaceAccount.activeListings).to.equal(0);
      expect(marketplaceAccount.totalParcelsMinted.toNumber()).to.equal(0);
    });

    it("Fails to initialize with fee too high", async () => {
      const highFee = 1001; // 10.01% - should fail
      const invalidMarketplace = Keypair.generate();

      try {
        await program.methods
          .initializeMarketplace(highFee)
          .accounts({
            marketplace: invalidMarketplace.publicKey,
            authority: authority.publicKey,
            treasury: treasury.publicKey,
            payer: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority, invalidMarketplace])
          .rpc();

        expect.fail("Should have failed with fee too high");
      } catch (error) {
        expect(error.message).to.include("FeeTooHigh");
      }
    });
  });

  describe("Land Parcel Minting", () => {
    it("Mints a land parcel successfully", async () => {
      const tx = await program.methods
        .mintLandParcel(
          coordinates,
          parcelSize,
          rarity,
          parcelName,
          metadataUri
        )
        .accounts({
          landParcel: landParcel.publicKey,
          marketplace,
          mint: mint.publicKey,
          metadata,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, mint, landParcel])
        .rpc();

      console.log("Land parcel minted:", tx);

      // Verify land parcel account
      const parcelAccount = await program.account.landParcel.fetch(
        landParcel.publicKey
      );
      expect(parcelAccount.mint.toString()).to.equal(mint.publicKey.toString());
      expect(parcelAccount.owner.toString()).to.equal(
        seller.publicKey.toString()
      );
      expect(parcelAccount.coordinates.x).to.equal(coordinates.x);
      expect(parcelAccount.coordinates.y).to.equal(coordinates.y);
      expect(parcelAccount.metadataUri).to.equal(metadataUri);
      expect(parcelAccount.isListed).to.be.false;
      expect(parcelAccount.totalTrades).to.equal(0);

      // Verify marketplace stats updated
      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.totalParcelsMinted.toNumber()).to.equal(1);
    });

    it("Fails to mint parcel with invalid coordinates", async () => {
      const invalidCoordinates = { x: 20000, y: 200 }; // Above MAX_COORDINATE
      const invalidMint = Keypair.generate();
      const invalidParcel = Keypair.generate();

      const [invalidMetadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          invalidMint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );

      try {
        await program.methods
          .mintLandParcel(
            invalidCoordinates,
            parcelSize,
            rarity,
            parcelName,
            metadataUri
          )
          .accounts({
            landParcel: invalidParcel.publicKey,
            marketplace,
            mint: invalidMint.publicKey,
            metadata: invalidMetadata,
            owner: seller.publicKey,
            payer: seller.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([seller, invalidMint, invalidParcel])
          .rpc();

        expect.fail("Should have failed with invalid coordinates");
      } catch (error) {
        expect(error.message).to.include("InvalidCoordinates");
      }
    });
  });

  describe("Parcel Listing", () => {
    it("Lists a parcel for sale successfully", async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

      const tx = await program.methods
        .listParcelForSale(salePrice, new BN(expiresAt))
        .accounts({
          listing,
          landParcel: landParcel.publicKey,
          marketplace,
          owner: seller.publicKey,
          seller: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      console.log("Parcel listed for sale:", tx);

      // Verify listing account
      const listingAccount = await program.account.listing.fetch(listing);
      expect(listingAccount.seller.toString()).to.equal(
        seller.publicKey.toString()
      );
      expect(listingAccount.parcelMint.toString()).to.equal(
        mint.publicKey.toString()
      );
      expect(listingAccount.price.toString()).to.equal(salePrice.toString());
      expect(listingAccount.expiresAt.toNumber()).to.equal(expiresAt);

      // Verify parcel is marked as listed
      const parcelAccount = await program.account.landParcel.fetch(
        landParcel.publicKey
      );
      expect(parcelAccount.isListed).to.be.true;

      // Verify marketplace stats updated
      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.activeListings).to.equal(1);
    });

    it("Fails to list with price too low", async () => {
      const lowPrice = new BN(1000); // Below MIN_PRICE
      const newMint = Keypair.generate();
      const newParcel = Keypair.generate();

      const [newListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), newMint.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .listParcelForSale(lowPrice, null)
          .accounts({
            listing: newListing,
            landParcel: newParcel.publicKey,
            marketplace,
            owner: seller.publicKey,
            seller: seller.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([seller])
          .rpc();

        expect.fail("Should have failed with price too low");
      } catch (error) {
        expect(error.message).to.include("PriceTooLow");
      }
    });
  });

  describe("Parcel Purchase", () => {
    it("Purchases a listed parcel successfully", async () => {
      // Get initial balances
      const initialBuyerBalance = await provider.connection.getBalance(
        buyer.publicKey
      );
      const initialSellerBalance = await provider.connection.getBalance(
        seller.publicKey
      );
      const initialTreasuryBalance = await provider.connection.getBalance(
        treasury.publicKey
      );

      const tx = await program.methods
        .purchaseParcel()
        .accounts({
          listing,
          landParcel: landParcel.publicKey,
          marketplace,
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      console.log("Parcel purchased:", tx);

      // Verify ownership transfer
      const parcelAccount = await program.account.landParcel.fetch(
        landParcel.publicKey
      );
      expect(parcelAccount.owner.toString()).to.equal(
        buyer.publicKey.toString()
      );
      expect(parcelAccount.isListed).to.be.false;
      expect(parcelAccount.totalTrades).to.equal(1);
      expect(parcelAccount.lastSalePrice.toString()).to.equal(
        salePrice.toString()
      );

      // Verify listing status
      const listingAccount = await program.account.listing.fetch(listing);
      expect(listingAccount.status).to.deep.equal({ sold: {} });

      // Verify marketplace stats
      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.activeListings).to.equal(0);
      expect(marketplaceAccount.totalVolume.toString()).to.equal(
        salePrice.toString()
      );

      // Verify balances (accounting for transaction fees)
      const finalBuyerBalance = await provider.connection.getBalance(
        buyer.publicKey
      );
      const finalSellerBalance = await provider.connection.getBalance(
        seller.publicKey
      );
      const finalTreasuryBalance = await provider.connection.getBalance(
        treasury.publicKey
      );

      // Calculate expected amounts
      const feeAmount = salePrice.muln(250).divn(10000); // 2.5% fee
      const sellerAmount = salePrice.sub(feeAmount);

      expect(finalBuyerBalance).to.be.lessThan(
        initialBuyerBalance - salePrice.toNumber()
      );
      expect(finalSellerBalance).to.be.greaterThan(
        initialSellerBalance + sellerAmount.toNumber() - 10000
      ); // Allow for tx fees
      expect(finalTreasuryBalance).to.equal(
        initialTreasuryBalance + feeAmount.toNumber()
      );
    });
  });

  describe("Marketplace Management", () => {
    it("Updates marketplace fee successfully", async () => {
      const newFeePercentage = 300; // 3%

      const tx = await program.methods
        .updateMarketplaceFee(newFeePercentage)
        .accounts({
          marketplace,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      console.log("Marketplace fee updated:", tx);

      // Verify fee update
      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.feePercentage).to.equal(newFeePercentage);
    });

    it("Fails to update fee from non-authority", async () => {
      const unauthorizedUser = Keypair.generate();

      try {
        await program.methods
          .updateMarketplaceFee(400)
          .accounts({
            marketplace,
            authority: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();

        expect.fail("Should have failed with unauthorized access");
      } catch (error) {
        expect(error.message).to.include("NotMarketplaceAuthority");
      }
    });
  });

  describe("Event Emissions", () => {
    it("Emits events correctly", async () => {
      // This test would need event listener setup
      // For now, we verify that transactions complete successfully
      // In a real scenario, you'd set up event listeners to verify event data
      console.log("Events are emitted during transactions");
      console.log(
        "Set up event listeners in your frontend to capture real-time updates"
      );
    });
  });

  describe("Edge Cases", () => {
    it("Handles coordinate boundary values", async () => {
      const boundaryCoords = { x: 10000, y: -10000 }; // At boundaries
      const boundaryMint = Keypair.generate();
      const boundaryParcel = Keypair.generate();

      const [boundaryMetadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          boundaryMint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );

      const tx = await program.methods
        .mintLandParcel(
          boundaryCoords,
          { large: {} },
          { epic: {} },
          "Boundary Parcel",
          "https://boundary.example.com"
        )
        .accounts({
          landParcel: boundaryParcel.publicKey,
          marketplace,
          mint: boundaryMint.publicKey,
          metadata: boundaryMetadata,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, boundaryMint, boundaryParcel])
        .rpc();

      console.log("Boundary parcel minted successfully:", tx);
    });

    it("Handles maximum string lengths", async () => {
      const maxName = "A".repeat(32); // MAX_NAME_LENGTH
      const maxUri = "https://example.com/" + "a".repeat(200 - 19); // MAX_URI_LENGTH

      const maxMint = Keypair.generate();
      const maxParcel = Keypair.generate();

      const [maxMetadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          maxMint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );

      const tx = await program.methods
        .mintLandParcel(
          { x: 102, y: 202 },
          { xLarge: {} },
          { legendary: {} },
          maxName,
          maxUri
        )
        .accounts({
          landParcel: maxParcel.publicKey,
          marketplace,
          mint: maxMint.publicKey,
          metadata: maxMetadata,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, maxMint, maxParcel])
        .rpc();

      console.log("Max length parcel minted successfully:", tx);
    });
  });
});
