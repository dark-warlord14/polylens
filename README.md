# PolyLens

**PolyLens** is a Chrome extension that allows you to effortlessly filter trades and events on [Polymarket.com](https://polymarket.com) based on their expiry date.

## 🚀 Features

-   **Filter by Days to Expiry**: Quickly see markets expiring in the next 1, 2, or X days. (Setting to `0` shows markets expiring today).
-   **Filter by Exact Date**: Target a specific date for your trades.
-   **Filter by Date Range**: View all markets expiring within a custom window.
-   **Intelligent Row-Level Filtering**: Works on both grid layouts and "Multi-Market" row views (like Paradex launch events).
-   **Auto-Hides Closed Bets**: Automatically dims markets that are already resolved or closed.
-   **Persistent Settings**: Your filters stay active even after you refresh the page or restart your browser.
-   **Real-Time Updates**: Automatically filters new content as you scroll down (infinite scroll support).

## 🛠️ Installation

1.  Download or clone this repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the extension folder.
5.  Pin the extension to your toolbar for easy access.

## ⚙️ How It Works

-   **Data Sync**: The extension fetches accurate metadata from the Polymarket Gamma API and the page's internal state.
-   **Privacy**: All filtering happens locally on your machine.
-   **UX**: Instead of hiding markets entirely, non-matching markets are "dimmed" and made non-clickable. This keeps the page layout intact while helping you focus on your active trades.

## 📄 License

MIT. Created by Antigravity for Polymarket enthusiasts.
