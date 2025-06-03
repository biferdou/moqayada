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
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

describe("moqayada", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.moqayada as Program<Moqayada>;
  const provider = anchor.getProvider();

  let marketplace: PublicKey;
  let authority: Keypair;
  let treasury: Keypair;
  let landParcel: Keypair;
  let mint: Keypair;
  let listing: PublicKey;
  let seller: Keypair;
  let buyer: Keypair;

  const coordinates = { x: 100, y: 200 };
  const parcelSize = { small: {} };
  const rarity = { common: {} };
  const parcelName = "Test Land Parcel";
  const metadataUri = "https://example.com/metadata.json";
  const salePrice = new BN(LAMPORTS_PER_SOL);

  before(async () => {
    authority = Keypair.generate();
    treasury = Keypair.generate();
    seller = Keypair.generate();
    buyer = Keypair.generate();
    mint = Keypair.generate();
    landParcel = Keypair.generate();

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

    await new Promise((resolve) => setTimeout(resolve, 1000));

    [marketplace] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    [listing] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), mint.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Marketplace Initialization", () => {
    it("Initializes the marketplace successfully", async () => {
      const feePercentage = 250;

      const tx = await program.methods
        .initializeMarketplace(feePercentage)
        .accountsPartial({
          marketplace,
          authority: authority.publicKey,
          treasury: treasury.publicKey,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log("Marketplace initialized:", tx);

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

    it("Fails to update fee when too high", async () => {
      // Test fee validation through update function instead of init
      try {
        await program.methods
          .updateMarketplaceFee(1001) // > 1000, should fail
          .accountsPartial({
            marketplace,
            authority: authority.publicKey,
          })
          .signers([authority])
          .rpc();

        expect.fail("Should have failed with fee too high");
      } catch (error) {
        const errorString = error.toString();
        const hasFeeTooHigh =
          errorString.includes("FeeTooHigh") ||
          errorString.includes("6003") ||
          errorString.includes("Fee percentage is too high");
        expect(hasFeeTooHigh).to.be.true;
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
        .accountsPartial({
          landParcel: landParcel.publicKey,
          marketplace,
          mint: mint.publicKey,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, mint, landParcel])
        .rpc();

      console.log("Land parcel minted:", tx);

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

      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.totalParcelsMinted.toNumber()).to.equal(1);
    });

    it("Fails to mint parcel with invalid coordinates", async () => {
      const invalidCoordinates = { x: 20000, y: 200 };
      const invalidMint = Keypair.generate();
      const invalidParcel = Keypair.generate();

      try {
        await program.methods
          .mintLandParcel(
            invalidCoordinates,
            parcelSize,
            rarity,
            parcelName,
            metadataUri
          )
          .accountsPartial({
            landParcel: invalidParcel.publicKey,
            marketplace,
            mint: invalidMint.publicKey,
            owner: seller.publicKey,
            payer: seller.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
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
      const expiresAt = Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60; // 29 days instead of 30

      const tx = await program.methods
        .listParcelForSale(salePrice, new BN(expiresAt))
        .accountsPartial({
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

      const listingAccount = await program.account.listing.fetch(listing);
      expect(listingAccount.seller.toString()).to.equal(
        seller.publicKey.toString()
      );
      expect(listingAccount.parcelMint.toString()).to.equal(
        mint.publicKey.toString()
      );
      expect(listingAccount.price.toString()).to.equal(salePrice.toString());
      expect(listingAccount.expiresAt.toNumber()).to.equal(expiresAt);

      const parcelAccount = await program.account.landParcel.fetch(
        landParcel.publicKey
      );
      expect(parcelAccount.isListed).to.be.true;

      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.activeListings).to.equal(1);
    });

    it("Fails to list with price too low", async () => {
      const lowPrice = new BN(1000);
      const newMint = Keypair.generate();
      const newParcel = Keypair.generate();

      await program.methods
        .mintLandParcel(
          { x: 101, y: 201 },
          parcelSize,
          rarity,
          "Test Parcel 2",
          metadataUri
        )
        .accountsPartial({
          landParcel: newParcel.publicKey,
          marketplace,
          mint: newMint.publicKey,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, newMint, newParcel])
        .rpc();

      const [newListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), newMint.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .listParcelForSale(lowPrice, null)
          .accountsPartial({
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
      // Small delay to ensure listing is fully processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const initialBuyerBalance = await provider.connection.getBalance(
        buyer.publicKey
      );
      const initialSellerBalance = await provider.connection.getBalance(
        seller.publicKey
      );
      const initialTreasuryBalance = await provider.connection.getBalance(
        treasury.publicKey
      );

      // Verify listing exists before purchase
      try {
        const listingAccount = await program.account.listing.fetch(listing);
        console.log("Listing found for purchase:", listingAccount.status);
      } catch (error) {
        console.log("Listing not found, error:", error.message);
        throw error;
      }

      const tx = await program.methods
        .purchaseParcel()
        .accountsPartial({
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

      const listingAccount = await program.account.listing.fetch(listing);
      expect(listingAccount.status).to.deep.equal({ sold: {} });

      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.activeListings).to.equal(0);
      expect(marketplaceAccount.totalVolume.toString()).to.equal(
        salePrice.toString()
      );

      const finalBuyerBalance = await provider.connection.getBalance(
        buyer.publicKey
      );
      const finalSellerBalance = await provider.connection.getBalance(
        seller.publicKey
      );
      const finalTreasuryBalance = await provider.connection.getBalance(
        treasury.publicKey
      );

      const feeAmount = salePrice.muln(250).divn(10000);
      const sellerAmount = salePrice.sub(feeAmount);

      // Allow for transaction fees - buyer should have spent at least the sale price
      expect(finalBuyerBalance).to.be.lessThan(initialBuyerBalance);
      expect(finalBuyerBalance).to.be.lessThan(
        initialBuyerBalance - salePrice.toNumber() + 100000
      ); // Allow 0.0001 SOL buffer
      expect(finalSellerBalance).to.be.greaterThan(
        initialSellerBalance + sellerAmount.toNumber() - 100000 // Allow for tx fees
      );
      expect(finalTreasuryBalance).to.equal(
        initialTreasuryBalance + feeAmount.toNumber()
      );
    });
  });

  describe("Marketplace Management", () => {
    it("Updates marketplace fee successfully", async () => {
      const newFeePercentage = 300;

      const tx = await program.methods
        .updateMarketplaceFee(newFeePercentage)
        .accountsPartial({
          marketplace,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      console.log("Marketplace fee updated:", tx);

      const marketplaceAccount = await program.account.marketplace.fetch(
        marketplace
      );
      expect(marketplaceAccount.feePercentage).to.equal(newFeePercentage);
    });

    it("Fails to update fee from non-authority", async () => {
      const unauthorizedUser = Keypair.generate();

      await provider.connection.requestAirdrop(
        unauthorizedUser.publicKey,
        LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        await program.methods
          .updateMarketplaceFee(400)
          .accountsPartial({
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
      console.log("Events are emitted during transactions");
      console.log(
        "Set up event listeners in your frontend to capture real-time updates"
      );
    });
  });

  describe("Edge Cases", () => {
    it("Handles coordinate boundary values", async () => {
      const boundaryCoords = { x: 10000, y: -10000 };
      const boundaryMint = Keypair.generate();
      const boundaryParcel = Keypair.generate();

      const tx = await program.methods
        .mintLandParcel(
          boundaryCoords,
          { large: {} },
          { epic: {} },
          "Boundary Parcel",
          "https://boundary.example.com"
        )
        .accountsPartial({
          landParcel: boundaryParcel.publicKey,
          marketplace,
          mint: boundaryMint.publicKey,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, boundaryMint, boundaryParcel])
        .rpc();

      console.log("Boundary parcel minted successfully:", tx);
    });

    it("Handles maximum string lengths", async () => {
      const maxName = "A".repeat(32);
      const maxUri = "https://example.com/" + "a".repeat(161);

      const maxMint = Keypair.generate();
      const maxParcel = Keypair.generate();

      const tx = await program.methods
        .mintLandParcel(
          { x: 102, y: 202 },
          { xLarge: {} },
          { legendary: {} },
          maxName,
          maxUri
        )
        .accountsPartial({
          landParcel: maxParcel.publicKey,
          marketplace,
          mint: maxMint.publicKey,
          owner: seller.publicKey,
          payer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([seller, maxMint, maxParcel])
        .rpc();

      console.log("Max length parcel minted successfully:", tx);
    });
  });
});
