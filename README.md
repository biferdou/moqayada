# Moqayada - Virtual Land NFT Marketplace

A decentralized virtual land marketplace built on Solana, enabling users to mint, trade, and manage land parcel NFTs with coordinate-based positioning and rarity systems.

## 🌟 Features

- **Coordinate-Based Land System**: Virtual land parcels with precise X,Y coordinates ranging from -10,000 to +10,000
- **Multiple Parcel Sizes**: Small (1x1), Medium (2x2), Large (4x4), and XLarge (8x8) parcels
- **Rarity System**: Five rarity tiers - Common, Uncommon, Rare, Epic, and Legendary
- **NFT Integration**: Full Metaplex NFT metadata support with custom URIs
- **Decentralized Marketplace**: Built-in marketplace with configurable fees (max 10%)
- **Listing Management**: Flexible listing system with optional expiry dates
- **Real-time Events**: Comprehensive event system for tracking all marketplace activities
- **Security Features**: Built-in validations, overflow protection, and access controls

## 🏗️ Architecture

### Smart Contract (Rust/Anchor)

The core program is built using the Anchor framework and includes:

- **Marketplace Management**: Global marketplace configuration and statistics
- **Land Parcel Minting**: Create unique NFT land parcels with metadata
- **Listing System**: List parcels for sale with price and expiry settings
- **Trading Engine**: Secure purchase mechanism with fee distribution
- **Administrative Controls**: Marketplace fee updates and authority management

### Client SDK (TypeScript)

A comprehensive TypeScript SDK providing:

- **MoqayadaClient**: High-level client for interacting with the program
- **Utility Functions**: Formatting, validation, and helper functions
- **Type Definitions**: Full TypeScript support for all program types
- **Event Handling**: Real-time event listening capabilities

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [Rust](https://rustup.rs/) (latest stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.14+)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (v0.31+)
- [Yarn](https://yarnpkg.com/) package manager

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
git clone <repository-url>
cd moqayada

# Install dependencies
yarn install

# Build the program
anchor build
```

### 2. Configure Solana

```bash
# Set to localnet for development
solana config set --url localhost

# Create a new keypair (if needed)
solana-keygen new

# Start local validator (in a separate terminal)
solana-test-validator
```

### 3. Deploy

```bash
# Deploy to localnet
anchor deploy

# Run tests
anchor test
```

### Running Tests

```bash
# Run all tests
anchor test

# Run specific test file
anchor test --skip-local-validator tests/moqayada.ts

# Run with custom timeout
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

### Code Quality

```bash
# Format TypeScript code
yarn lint:fix

# Check formatting
yarn lint
```

## 🔐 Security Features

- **Coordinate Validation**: Enforces coordinate boundaries to prevent invalid land positions
- **Price Validation**: Minimum price requirements and overflow protection
- **Access Controls**: Owner-only operations and authority-based administrative functions
- **Expiry Validation**: Automatic expiry checking for time-bounded listings
- **Math Safety**: Comprehensive overflow/underflow protection using checked arithmetic
- **PDA Security**: Proper Program Derived Address validation for all accounts

## 📚 API Reference

### Core Instructions

| Instruction | Description | Access |
|-------------|-------------|---------|
| `initialize_marketplace` | Create marketplace with fee configuration | Authority only |
| `mint_land_parcel` | Create new land parcel NFT | Anyone |
| `list_parcel_for_sale` | List parcel on marketplace | Owner only |
| `purchase_parcel` | Buy listed parcel | Anyone |
| `cancel_listing` | Remove listing from marketplace | Seller only |
| `update_marketplace_fee` | Modify marketplace fee percentage | Authority only |

### Events

- `MarketplaceInitialized`: Marketplace creation
- `LandParcelMinted`: New parcel creation
- `ParcelListed`: Parcel listing events
- `ParcelSold`: Successful sales
- `ListingCancelled`: Listing cancellations
- `MarketplaceFeeUpdated`: Fee modifications

## 🚨 Error Handling

The program includes comprehensive error handling for:

- Invalid coordinates outside permitted range
- String length violations (names/URIs too long)
- Fee percentages exceeding maximum (10%)
- Prices below minimum threshold
- Expired or invalid listings
- Unauthorized access attempts
- Mathematical overflows

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow Rust best practices and use `cargo clippy`
- Ensure all tests pass before submitting
- Add tests for new functionality
- Update documentation for API changes
- Use semantic commit messages

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🔗 Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [Metaplex Documentation](https://docs.metaplex.com/)
- [SPL Token Documentation](https://spl.solana.com/token)

## 💡 Future Enhancements

- [ ] Batch operations for multiple parcels
- [ ] Dutch auction listing mechanism
- [ ] Parcel adjacency and clustering features
- [ ] Advanced filtering and search capabilities
- [ ] Integration with external NFT marketplaces
- [ ] Land development and building systems
- [ ] Governance token for marketplace decisions

---
