/**
 * background.js — PolyLens Elite Service Worker
 *
 * Responsibilities:
 *   - Fetch all active markets from Polymarket Gamma API (paginated, 500/page)
 *   - Process raw markets into opportunity objects with category, ROI, probability
 *   - Store results to chrome.storage.local (polylens_elite_cache + polylens_market_map)
 *   - Broadcast syncComplete to dashboard (deals.html) and content scripts
 *   - Run an auto-scan alarm every 30 minutes
 *   - Fire push notifications for top-tier new opportunities
 *
 * API: https://gamma-api.polymarket.com/markets (public, no auth)
 * Note: Gamma API returns snake_case fields (end_date, outcome_prices).
 *       Code handles both snake_case and camelCase for robustness.
 *
 * Storage:
 *   chrome.storage.local  →  polylens_elite_cache  (deals + count + timestamp)
 *   chrome.storage.local  →  polylens_market_map   (slug → { endDate, closed })
 */

const CACHE_KEY = "polylens_elite_cache";
const MARKET_MAP_KEY = "polylens_market_map";
const SCAN_ALARM = "polylens_scan_alarm";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

chrome.runtime.onInstalled.addListener(() => {
    console.log("PolyLens Elite: Initialized.");
    setupAlarms();
    performBackgroundScan();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SCAN_ALARM) {
        performBackgroundScan();
    }
});

function setupAlarms() {
    chrome.alarms.create(SCAN_ALARM, { periodInMinutes: 30 });
}

// ─── Core Scan ────────────────────────────────────────────────────
let isScanning = false;

async function performBackgroundScan() {
    if (isScanning) {
        console.warn("PolyLens Elite: Scan already active.");
        return;
    }
    isScanning = true;
    console.log("PolyLens Elite: Starting full-spectrum scan...");

    try {
        const markets = await fetchAllMarkets();
        if (!markets || markets.length === 0) {
            console.warn("PolyLens Elite: No markets returned from API.");
            isScanning = false;
            return;
        }

        const opportunities = processMarkets(markets);

        // Build market map for content script (expiry + closed status)
        const marketMap = {};
        markets.forEach(m => {
            if (m.slug) {
                // Gamma API uses snake_case; fall back to camelCase for safety
                marketMap[m.slug] = {
                    endDate: m.end_date || m.endDate || m.resolution_date || m.resolutionDate,
                    closed: !!(m.closed || m.resolved)
                };
            }
        });

        const existing = await chrome.storage.local.get([CACHE_KEY]);
        const oldDeals = existing[CACHE_KEY]?.deals || [];
        const oldKeys = new Set(oldDeals.map(d => d.slug + "_" + d.outcome));

        await chrome.storage.local.set({
            [CACHE_KEY]: {
                timestamp: Date.now(),
                count: markets.length,
                deals: opportunities
            },
            [MARKET_MAP_KEY]: marketMap
        });

        console.log(`PolyLens Elite: Scan complete. ${markets.length} markets → ${opportunities.length} opportunities.`);
        isScanning = false;

        // Notify dashboard (deals.html)
        chrome.runtime.sendMessage({
            action: "syncComplete",
            count: markets.length,
            opportunities: opportunities.length
        }).catch(() => { }); // Suppress "no listener" error if dashboard isn't open

        // Notify Polymarket tabs (content script)
        chrome.tabs.query({}, tabs => {
            tabs.forEach(tab => {
                if (tab.url && tab.url.includes("polymarket.com")) {
                    chrome.tabs.sendMessage(tab.id, { action: "syncComplete", data: marketMap }).catch(() => { });
                }
            });
        });

        // Alert for top-tier new opportunities
        const newAlpha = opportunities.filter(d =>
            !oldKeys.has(d.slug + "_" + d.outcome) &&
            d.roi >= 5 &&
            d.probability >= 90 &&
            d.volume >= 50000
        );
        if (newAlpha.length > 0) {
            triggerNotification(newAlpha[0]);
        }

    } catch (e) {
        console.error("PolyLens Elite: Scan error:", e);
        isScanning = false;
    }
}

// ─── Fetching ──────────────────────────────────────────────────────
async function fetchAllMarkets() {
    const pageSize = 500;
    let offset = 0;
    let all = [];
    let hasMore = true;
    let consecutiveErrors = 0;

    while (hasMore) {
        const url = `https://gamma-api.polymarket.com/markets?limit=${pageSize}&offset=${offset}&active=true&closed=false`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data && Array.isArray(data) && data.length > 0) {
                all = all.concat(data);
                offset += data.length;
                consecutiveErrors = 0;
                chrome.runtime.sendMessage({ action: "syncProgress", count: all.length }).catch(() => { });
                if (data.length < pageSize) hasMore = false;
            } else {
                hasMore = false;
            }
        } catch (e) {
            consecutiveErrors++;
            console.warn(`PolyLens Elite: Fetch error at offset ${offset}:`, e.message);
            if (consecutiveErrors > 2) hasMore = false;
            else offset += pageSize;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    // Deduplicate
    const seen = new Set();
    return all.filter(m => {
        const id = m.id || m.slug;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

// ─── Processing ────────────────────────────────────────────────────
function processMarkets(markets) {
    const opportunities = [];
    const now = new Date();

    markets.forEach(m => {
        // Gamma API sends snake_case; fall back to camelCase for robustness
        const endDate = m.end_date || m.endDate || m.resolution_date || m.resolutionDate;
        const rawPrices = m.outcome_prices || m.outcomePrices;
        const rawOutcomes = m.outcomes;

        if (!endDate || !rawPrices || !rawOutcomes) return;

        const volume = parseFloat(m.volume || 0);
        const expiry = new Date(endDate);
        const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
        if (diffDays <= 0) return;

        let prices = rawPrices;
        let outcomes = rawOutcomes;
        try {
            if (typeof prices === "string") prices = JSON.parse(prices);
            if (typeof outcomes === "string") outcomes = JSON.parse(outcomes);
        } catch (e) { return; }

        if (!Array.isArray(prices) || !Array.isArray(outcomes)) return;

        // Category mapping — mirrors Polymarket's official navigation categories:
        // Politics · Elections · Sports · Crypto · Finance · Economy · Geopolitics · Tech · Culture · Climate & Science
        const apiCat = (m.category || "").toLowerCase();
        const titleLower = (m.question || m.description || "").toLowerCase();
        let category = "Other";

        if (apiCat.includes("election") || titleLower.includes("election") || titleLower.includes("vote") || titleLower.includes("ballot") || titleLower.includes("midterm")) {
            category = "Elections";
        } else if (apiCat.includes("politic") || titleLower.includes("president") || titleLower.includes("congress") || titleLower.includes("senate") || titleLower.includes("white house") || titleLower.includes("trump") || titleLower.includes("biden") || titleLower.includes("democrat") || titleLower.includes("republican")) {
            category = "Politics";
        } else if (apiCat.includes("geopolit") || titleLower.includes("iran") || titleLower.includes("russia") || titleLower.includes("ukraine") || titleLower.includes("china") || titleLower.includes("nato") || titleLower.includes("war") || titleLower.includes("military") || titleLower.includes("sanctions") || titleLower.includes("ceasefire") || titleLower.includes("nuclear")) {
            category = "Geopolitics";
        } else if (apiCat.includes("crypto") || titleLower.includes("bitcoin") || titleLower.includes("ethereum") || titleLower.includes(" btc") || titleLower.includes(" eth ") || titleLower.includes("solana") || titleLower.includes("defi") || titleLower.includes("nft") || titleLower.includes("altcoin") || titleLower.includes("crypto")) {
            category = "Crypto";
        } else if (apiCat.includes("finance") || titleLower.includes("s&p") || titleLower.includes("nasdaq") || titleLower.includes("stock") || titleLower.includes("fed ") || titleLower.includes("federal reserve") || titleLower.includes("interest rate") || titleLower.includes("crude oil") || titleLower.includes("oil price") || titleLower.includes("cpi") || titleLower.includes("inflation") || titleLower.includes("tariff") || titleLower.includes("trade war") || titleLower.includes("ipo")) {
            category = "Finance";
        } else if (apiCat.includes("economy") || titleLower.includes("gdp") || titleLower.includes("recession") || titleLower.includes("unemployment") || titleLower.includes("jobs report") || titleLower.includes("economic")) {
            category = "Economy";
        } else if (apiCat.includes("tech") || titleLower.includes("chatgpt") || titleLower.includes("openai") || titleLower.includes("artificial intelligence") || titleLower.includes("llm") || titleLower.includes("apple") || titleLower.includes("google") || titleLower.includes("microsoft") || titleLower.includes("meta ") || titleLower.includes("tesla") || titleLower.includes("elon") || titleLower.includes("spacex")) {
            category = "Tech";
        } else if (apiCat.includes("sport") || titleLower.includes(" nba ") || titleLower.includes(" nfl ") || titleLower.includes(" mlb ") || titleLower.includes("fifa") || titleLower.includes(" epl ") || titleLower.includes("premier league") || titleLower.includes("champion") || titleLower.includes("super bowl") || titleLower.includes("world cup") || titleLower.includes(" vs ") || titleLower.includes("basketball") || titleLower.includes("football") || titleLower.includes("soccer")) {
            category = "Sports";
        } else if (apiCat.includes("climate") || apiCat.includes("science") || titleLower.includes("climate") || titleLower.includes("nasa") || titleLower.includes("space") || titleLower.includes("weather") || titleLower.includes("earthquake") || titleLower.includes("hurricane")) {
            category = "Climate & Science";
        } else if (apiCat.includes("culture") || apiCat.includes("entertainment") || apiCat.includes("pop") || titleLower.includes("oscar") || titleLower.includes("grammy") || titleLower.includes("emmy") || titleLower.includes("eurovision") || titleLower.includes("movie") || titleLower.includes("album") || titleLower.includes("award")) {
            category = "Culture";
        } else if (m.category) {
            const first = m.category.split(",")[0].trim();
            if (first.length > 2 && !/^[0-9↑↓.%+\-]+$/.test(first)) {
                category = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
            }
        }

        const marketTitle = m.question || m.description || m.groupItemTitle || "Untitled Market";

        prices.forEach((p, idx) => {
            const prob = parseFloat(p);
            if (!isNaN(prob) && prob >= 0.01 && prob <= 0.99) {
                opportunities.push({
                    title: marketTitle,
                    outcome: outcomes[idx] || "Yes",
                    probability: parseFloat((prob * 100).toFixed(1)),
                    roi: parseFloat((((1 - prob) / prob) * 100).toFixed(2)),
                    daysLeft: parseFloat(Math.max(0, diffDays).toFixed(1)),
                    volume: volume,
                    category: category,
                    slug: m.slug,
                    outcomeIdx: idx,
                    expiryDate: endDate
                });
            }
        });
    });

    return opportunities;
}

// ─── Notifications ─────────────────────────────────────────────────
function triggerNotification(opportunity) {
    chrome.notifications.create(`polylens_${opportunity.slug}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "⚡ New High-Confidence Opportunity",
        message: `${opportunity.probability}% — ${opportunity.title}\n+${opportunity.roi}% potential ROI`,
        priority: 2
    });
}

chrome.notifications.onClicked.addListener(id => {
    if (id.startsWith("polylens_")) chrome.tabs.create({ url: "deals.html" });
});

// ─── Message Routing ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "manualSync") {
        performBackgroundScan().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (msg.action === "getMarkets") {
        chrome.storage.local.get([MARKET_MAP_KEY], res => sendResponse({ data: res[MARKET_MAP_KEY] || {} }));
        return true;
    }
    if (msg.action === "getCount") {
        chrome.storage.local.get([CACHE_KEY], res => sendResponse({
            count: res[CACHE_KEY]?.count || 0,
            timestamp: res[CACHE_KEY]?.timestamp || null
        }));
        return true;
    }
});