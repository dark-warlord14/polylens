# PolyLens Elite

**PolyLens Elite** is a professional Chrome extension for Polymarket power users. It combines an in-page expiry filter with a full-spectrum **Market Discovery Dashboard** — scanning 30,000+ active markets and surfacing high-confidence opportunities in real time.

---

## Features

### Market Discovery Dashboard (`deals.html`)

A dedicated full-screen dashboard that scans the entire Polymarket ecosystem and filters opportunities to your spec.

- **Full Spectrum Scan** — fetches all active markets via the Gamma API with paginated requests (up to 30k+ markets per sync)
- **Smart Cache** — loads from `chrome.storage.local` on open (no API call). Background alarm re-syncs every 30 minutes automatically
- **Precise Expiry Countdowns** — shows `6h 14m left`, `1d 3h left`, not vague labels
- **Polymarket-matched Categories** — Politics, Elections, Sports, Crypto, Finance, Economy, Geopolitics, Tech, Culture, Climate & Science
- **Persistent Filters** — Volume floor, expiry window, probability floor, and sort order save to `chrome.storage.sync` via the **Save Config** button
- **Live Stats** — markets scanned, filtered count, last synced timestamp

### In-Page Expiry Filter (`content.js`)

Overlays directly on `polymarket.com` to dim markets that don't match your criteria.

- **Three Modes**: Days Left · Exact Date · Date Range
- **Works everywhere**: Grid, List, Event pages, Search results
- **Auto-updates** via `MutationObserver` and a 3-second safety pulse
- **Market map** pushed from background on every sync for up-to-date expiry data

### Smart Alerts

- **Background alarm** every 30 minutes keeps data fresh without battery drain
- **Push notification** triggered when a new opportunity appears with ≥ 90% probability, ≥ 5% ROI, and ≥ $50K volume

---

## Installation

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked** → select the `polylens/` folder
5. Pin the extension from the toolbar

---

## Usage

### Dashboard
- Click the extension icon → **Open Dashboard** (or navigate directly to `deals.html`)
- On first launch, a market scan runs automatically
- Subsequent opens load from cache instantly — use **Sync Markets** to force a fresh scan
- Adjust filters in the sidebar, then click **Save Config** to persist them

### In-Page Filter
- Navigate to [polymarket.com](https://polymarket.com)
- Open the extension popup and set your expiry filter
- Markets outside your window are dimmed in real time

---

## Architecture

| File | Role |
|------|------|
| `background.js` | Service worker — market fetching, processing, storage, alarms, notifications |
| `deals.js` | Dashboard controller — cache-first init, filter pipeline, render, config persistence |
| `deals.html` | Dashboard UI shell |
| `deals.css` | Dashboard styles (Polymarket dark theme) |
| `content.js` | In-page MutationObserver filter for polymarket.com |
| `popup.js` | Extension popup — filter controls and page-filter triggers |
| `manifest.json` | Extension config (MV3, unlimitedStorage) |

### Storage Keys

| Key | Store | Contents |
|-----|-------|----------|
| `polylens_elite_cache` | `local` | `{ timestamp, count, deals[] }` |
| `polylens_market_map` | `local` | `{ [slug]: { endDate, closed } }` |
| `polylens_filter_config` | `sync` | `{ minVolume, maxDays, minProb, sortBy }` |
| `polyFilters` | `sync` | In-page expiry filter settings |

### API

All data sourced from the public **Polymarket Gamma API** — no authentication required, no user data sent.

```
GET https://gamma-api.polymarket.com/markets?limit=500&offset=N&active=true&closed=false
```

Notes:
- Gamma API uses `snake_case` fields (`end_date`, `outcome_prices`) — the background engine handles both camelCase and snake_case for robustness
- Rate limiting: 100ms delay between pages

---

## Default Filter Settings

| Filter | Default | Description |
|--------|---------|-------------|
| Min Volume | $10,000 | Minimum USD traded on the market |
| Max Days | 1 day | Markets expiring within N days |
| Probability Floor | 80% | Minimum outcome probability |
| Sort | Highest ROI | Order of displayed results |

---

## Privacy

All processing is done locally on your machine. The extension only makes outbound requests to the public Polymarket Gamma API. No personal data is collected or stored remotely.

---

## License

MIT — created for the Polymarket community.
