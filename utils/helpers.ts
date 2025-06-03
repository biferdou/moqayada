import { PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Moqayada } from "../types/moqayada";

export interface Coordinates {
  x: number;
  y: number;
}

export interface LandParcel {
  mint: PublicKey;
  owner: PublicKey;
  coordinates: Coordinates;
  size: ParcelSize;
  rarity: Rarity;
  metadataUri: string;
  createdAt: BN;
  isListed: boolean;
  totalTrades: number;
  lastSalePrice: BN;
}

export interface Listing {
  seller: PublicKey;
  parcelMint: PublicKey;
  price: BN;
  createdAt: BN;
  expiresAt: BN | null;
  status: ListingStatus;
  bump: number;
}

export interface Marketplace {
  authority: PublicKey;
  feePercentage: number;
  treasury: PublicKey;
  totalVolume: BN;
  activeListings: number;
  totalParcelsMinted: BN;
  bump: number;
}

export enum ParcelSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
  XLarge = "xLarge",
}

export enum Rarity {
  Common = "common",
  Uncommon = "uncommon",
  Rare = "rare",
  Epic = "epic",
  Legendary = "legendary",
}

export enum ListingStatus {
  Active = "active",
  Sold = "sold",
  Cancelled = "cancelled",
  Expired = "expired",
}

export class MoqayadaClient {
  constructor(
    private program: Program<Moqayada>,
    private provider: AnchorProvider
  ) {}

  /**
   * Get the marketplace PDA
   */
  getMarketplacePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      this.program.programId
    );
  }

  /**
   * Get all land parcels (since we're not using PDAs for individual parcels)
   */
  async getAllLandParcels(): Promise<LandParcel[]> {
    try {
      const parcels = await this.program.account.landParcel.all();
      return parcels.map((p) => p.account);
    } catch (error) {
      console.error("Error fetching all land parcels:", error);
      return [];
    }
  }

  /**
   * Get land parcel by mint address
   */
  async getLandParcelByMint(mint: PublicKey): Promise<LandParcel | null> {
    try {
      const parcels = await this.program.account.landParcel.all([
        {
          memcmp: {
            offset: 8, // Skip discriminator
            bytes: mint.toBase58(),
          },
        },
      ]);
      return parcels.length > 0 ? parcels[0].account : null;
    } catch (error) {
      console.error("Error fetching land parcel by mint:", error);
      return null;
    }
  }

  /**
   * Get the listing PDA for a given mint
   */
  getListingPDA(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), mint.toBuffer()],
      this.program.programId
    );
  }

  /**
   * Fetch marketplace data
   */
  async getMarketplace(): Promise<Marketplace | null> {
    try {
      const [marketplacePDA] = this.getMarketplacePDA();
      return await this.program.account.marketplace.fetch(marketplacePDA);
    } catch (error) {
      console.error("Error fetching marketplace:", error);
      return null;
    }
  }

  /**
   * Fetch land parcel data by coordinates
   */
  async getLandParcel(coordinates: Coordinates): Promise<LandParcel | null> {
    try {
      const allParcels = await this.getAllLandParcels();
      return (
        allParcels.find(
          (parcel) =>
            parcel.coordinates.x === coordinates.x &&
            parcel.coordinates.y === coordinates.y
        ) || null
      );
    } catch (error) {
      console.error("Error fetching land parcel:", error);
      return null;
    }
  }

  /**
   * Fetch listing data
   */
  async getListing(mint: PublicKey): Promise<Listing | null> {
    try {
      const [listingPDA] = this.getListingPDA(mint);
      return await this.program.account.listing.fetch(listingPDA);
    } catch (error) {
      console.error("Error fetching listing:", error);
      return null;
    }
  }

  /**
   * Get all land parcels owned by a user
   */
  async getUserParcels(owner: PublicKey): Promise<LandParcel[]> {
    try {
      const parcels = await this.program.account.landParcel.all([
        {
          memcmp: {
            offset: 8 + 32, // Skip discriminator + mint
            bytes: owner.toBase58(),
          },
        },
      ]);
      return parcels.map((p) => p.account);
    } catch (error) {
      console.error("Error fetching user parcels:", error);
      return [];
    }
  }

  /**
   * Get all active listings
   */
  async getActiveListings(): Promise<Listing[]> {
    try {
      const listings = await this.program.account.listing.all([
        {
          memcmp: {
            offset: 8 + 32 + 32 + 8 + 8 + 9, // Skip to status field
            bytes: Buffer.from([0]), // Active status = 0
          },
        },
      ]);
      return listings.map((l) => l.account);
    } catch (error) {
      console.error("Error fetching active listings:", error);
      return [];
    }
  }

  /**
   * Get parcels in a specific area
   */
  async getParcelsInArea(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): Promise<LandParcel[]> {
    try {
      const allParcels = await this.program.account.landParcel.all();
      return allParcels
        .map((p) => p.account)
        .filter(
          (parcel) =>
            parcel.coordinates.x >= minX &&
            parcel.coordinates.x <= maxX &&
            parcel.coordinates.y >= minY &&
            parcel.coordinates.y <= maxY
        );
    } catch (error) {
      console.error("Error fetching parcels in area:", error);
      return [];
    }
  }

  /**
   * Check if coordinates are available for minting
   */
  async isCoordinateAvailable(coordinates: Coordinates): Promise<boolean> {
    const parcel = await this.getLandParcel(coordinates);
    return parcel === null;
  }

  /**
   * Get marketplace statistics
   */
  async getMarketplaceStats(): Promise<{
    totalVolume: number;
    activeListings: number;
    totalParcels: number;
    averagePrice: number;
  } | null> {
    try {
      const marketplace = await this.getMarketplace();
      if (!marketplace) return null;

      const activeListings = await this.getActiveListings();
      const averagePrice =
        activeListings.length > 0
          ? activeListings.reduce(
              (sum, listing) => sum + listing.price.toNumber(),
              0
            ) / activeListings.length
          : 0;

      return {
        totalVolume: marketplace.totalVolume.toNumber(),
        activeListings: marketplace.activeListings,
        totalParcels: marketplace.totalParcelsMinted.toNumber(),
        averagePrice,
      };
    } catch (error) {
      console.error("Error fetching marketplace stats:", error);
      return null;
    }
  }

  /**
   * Listen to program events
   */
  onProgramEvent(callback: (event: any) => void): number {
    return this.program.addEventListener("LandParcelMinted", callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listenerId: number): void {
    this.program.removeEventListener(listenerId);
  }
}

// Utility functions for frontend
export const formatPrice = (lamports: number): string => {
  return (lamports / 1e9).toFixed(4) + " SOL";
};

export const formatCoordinates = (coords: Coordinates): string => {
  return `(${coords.x}, ${coords.y})`;
};

export const getSizeDisplayName = (size: ParcelSize): string => {
  const sizeMap = {
    [ParcelSize.Small]: "1x1",
    [ParcelSize.Medium]: "2x2",
    [ParcelSize.Large]: "4x4",
    [ParcelSize.XLarge]: "8x8",
  };
  return sizeMap[size] || "Unknown";
};

export const getRarityColor = (rarity: Rarity): string => {
  const colorMap = {
    [Rarity.Common]: "#9CA3AF", // Gray
    [Rarity.Uncommon]: "#10B981", // Green
    [Rarity.Rare]: "#3B82F6", // Blue
    [Rarity.Epic]: "#8B5CF6", // Purple
    [Rarity.Legendary]: "#F59E0B", // Orange/Gold
  };
  return colorMap[rarity] || "#9CA3AF";
};

export const isListingExpired = (listing: Listing): boolean => {
  if (!listing.expiresAt) return false;
  return Date.now() / 1000 > listing.expiresAt.toNumber();
};

export const getTimeUntilExpiry = (listing: Listing): string => {
  if (!listing.expiresAt) return "No expiry";

  const now = Date.now() / 1000;
  const expiry = listing.expiresAt.toNumber();
  const diff = expiry - now;

  if (diff <= 0) return "Expired";

  const days = Math.floor(diff / (24 * 60 * 60));
  const hours = Math.floor((diff % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((diff % (60 * 60)) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// Constants for frontend use
export const PROGRAM_ID = new PublicKey(
  "Xxf3vRZE7MbcRgGHYc7baYQuvq6sjYCNmpKzMpKCPep"
);
export const COORDINATE_BOUNDS = {
  MIN: -10000,
  MAX: 10000,
};
export const PARCEL_SIZES = Object.values(ParcelSize);
export const RARITIES = Object.values(Rarity);
export const MIN_PRICE_SOL = 0.001;
export const MAX_LISTING_DURATION_DAYS = 30;
