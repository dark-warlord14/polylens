# PolyLens Elite

**PolyLens Elite** is a professional-grade Chrome extension for Polymarket power users. It provides advanced expiry filtering directly on the Polymarket UI and a dedicated "Alpha Discovery" dashboard for institutional-grade arbitrage and yield hunting.

## 🚀 Key Features

### 1. In-Page Expiry Filtering
- **Dynamic Content Injection**: Automatically dims markets on Polymarket.com that don't match your criteria.
- **Three Filtering Modes**:
    - **Days Left**: Show markets expiring within X days.
    - **Exact Date**: Target specific resolution dates (e.g., today, end of month).
    - **Date Range**: Filter for custom windows (e.g., Q4 2024).
- **Intelligent Detection**: Works across all Polymarket layouts (Grid, List, and Event pages).
- **Auto-Sync**: Automatically keeps market data fresh via background synchronization.

### 2. Alpha Discovery Dashboard (Elite Mode)
- **Deep Market Scan**: Background engine crawls up to 50,000+ active markets across the entire Polymarket ecosystem.
- **Institutional ROI Filters**: Find high-probability deals (70%+) with professional liquidity floors.
- **Order Book Depth Analysis**: Real-time integration with the Polymarket CLOB to calculate:
    - **Effective ROI**: Adjusted for slippage on a standard $1,000 trade.
    - **Liquidity Depth**: Instant verification of sell-side depth before you click.
- **Categorization**: Automated tagging for Politics, Crypto, Sports, and more.

### 3. Alpha Alerts
- **Background Scanning**: Periodic market analysis every 15 minutes.
- **Push Notifications**: Get notified instantly when a "Truly New" institutional-grade opportunity (3%+ ROI, 85%+ Probability, $25k+ Volume) is detected.

## 🛠️ Installation

1.  Download or clone this repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the extension folder.
5.  Pin the extension to your toolbar for easy access.

## ⚙️ Technical Architecture

- **Background Engine**: A robust service worker (`background.js`) handles pagination-aware API polling (100-market pages) and persistent storage in `chrome.storage.local`.
- **Content Script**: Optimized `MutationObserver` (`content.js`) ensures zero performance lag while filtering thousands of DOM elements.
- **CLOB Integration**: Direct WebSocket/REST communication with `clob.polymarket.com` for real-time order book snapshots.
- **Privacy**: All calculations and filtering happen locally on your machine.

## 📄 License

MIT. Created for Polymarket power users.
