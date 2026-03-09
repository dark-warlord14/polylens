/**
 * background.js - PolyLens Professional Background Engine
 * Handles persistent cache (chrome.storage.local), background scanning (alarms),
 * and Alpha Alerts (notifications).
 */

const CACHE_KEY = "polylens_pro_cache";
const MARKET_MAP_KEY = "polylens_market_map";
const SCAN_ALARM = "polylens_scan_alarm";
const NOTIF_PREFIX = "polylens_deal_";

chrome.runtime.onInstalled.addListener(() => {
    console.log("PolyLens Pro: Engine Initialized");
    setupAlarms();
    performBackgroundScan();
});

// Alarm Listener for Background Polling (with robust context handling)
chrome.alarms.onAlarm.addListener((alarm) => {
    try {
        if (alarm.name === SCAN_ALARM) {
            console.log("PolyLens Pro: Executing scheduled background scan...");
            performBackgroundScan();
        }
    } catch (e) {
        console.error("PolyLens Pro: Context error in background listener", e);
    }
});

function setupAlarms() {
    // Schedule a scan every 15 minutes
    chrome.alarms.create(SCAN_ALARM, { periodInMinutes: 15 });
}

/**
 * Performs a full spectrum scan of all available markets.
 * Syncs the results to storage.local for dashboard and content script use.
 */
let isScanning = false;

async function performBackgroundScan() {
    if (isScanning) return;

    try {
        isScanning = true;
        const markets = await fetchAllMarkets();
        if (markets.length === 0) {
            isScanning = false;
            return;
        }

        const now = Date.now();
        
        // 1. Process for Alpha Dashboard
        const result = processMarketsIntoDeals(markets);
        
        // 2. Process for Content Script Filtering (Full Map)
        const marketMap = {};
        markets.forEach(m => {
            if (m.slug) {
                marketMap[m.slug] = {
                    endDate: m.endDate || m.resolutionDate,
                    closed: !!(m.closed || m.resolved)
                };
            }
        });

        const existing = await chrome.storage.local.get([CACHE_KEY]);
        const oldDeals = existing[CACHE_KEY]?.deals || [];
        const oldIds = new Set(oldDeals.map(d => d.slug + d.outcome));

        await chrome.storage.local.set({
            [CACHE_KEY]: {
                timestamp: now,
                count: markets.length,
                deals: result.deals
            },
            [MARKET_MAP_KEY]: marketMap
        });

        console.log(`PolyLens Pro: Sync Complete. ${markets.length} markets mapped. ${result.deals.length} alpha deals.`);
        isScanning = false;

        // Notify content scripts that sync is complete
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.url && (tab.url.includes("polymarket.com"))) {
                    chrome.tabs.sendMessage(tab.id, { action: "syncComplete", data: marketMap }).catch(() => {});
                }
            });
        });

        // Trigger notifications for TRULY new institutional grade deals
        const newAlpha = result.deals.filter(d =>
            !oldIds.has(d.slug + d.outcome) &&
            d.roi >= 3 &&
            d.probability >= 85 &&
            d.volume >= 25000 
        );

        if (newAlpha.length > 0) {
            triggerAlphaAlert(newAlpha[0]);
        }

    } catch (e) {
        console.error("PolyLens Pro: Background Scan Failed", e);
        isScanning = false;
    }
}

async function fetchAllMarkets() {
    const pageSize = 100; // API often performs better with smaller pages
    let offset = 0;
    let all = [];
    let hasMore = true;
    let consecutiveEmpty = 0;

    console.log("PolyLens Pro: Starting Deep Market Scan...");

    while (hasMore) {
        // We remove active=true and closed=false to see if it catches more, 
        // but typically gamma-api /markets endpoint needs some filters or just works with offset.
        // Let's try to be as broad as possible.
        const url = `https://gamma-api.polymarket.com/markets?limit=${pageSize}&offset=${offset}&active=true`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`PolyLens Pro: API Error ${res.status} at offset ${offset}`);
                break;
            }
            const data = await res.json();

            if (data && Array.isArray(data) && data.length > 0) {
                all = all.concat(data);
                offset += data.length;
                consecutiveEmpty = 0;
                
                if (offset % 1000 === 0) {
                    console.log(`PolyLens Pro: Scanned ${offset} markets...`);
                }

                // If we got less than we asked for, we might be at the end
                if (data.length < pageSize) {
                    hasMore = false;
                }
            } else {
                // Sometimes APIs have gaps or temporary empty returns
                consecutiveEmpty++;
                if (consecutiveEmpty > 2) {
                    hasMore = false;
                } else {
                    offset += pageSize; // Try skipping a page
                }
            }
        } catch (e) {
            console.error("PolyLens Pro: Fetch Error", e);
            hasMore = false;
        }
        
        // Adaptive delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 50));

        // Safety break for extreme cases
        if (offset > 50000) {
            console.warn("PolyLens Pro: Safety limit reached (50k markets). Stopping scan.");
            break;
        }
    }

    console.log(`PolyLens Pro: Deep Scan Complete. Total: ${all.length} markets.`);
    return all;
}

function processMarketsIntoDeals(markets) {
    const deals = [];
    const now = new Date();

    markets.forEach(m => {
        if (!m.endDate || !m.outcomePrices || !m.outcomes) return;

        const volume = parseFloat(m.volume || 0);
        const expiry = new Date(m.endDate);
        const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);

        if (diffDays <= 0) return;

        let prices = m.outcomePrices;
        let outcomes = m.outcomes;
        if (typeof prices === "string") { try { prices = JSON.parse(prices); } catch (e) { return; } }
        if (typeof outcomes === "string") { try { outcomes = JSON.parse(outcomes); } catch (e) { return; } }

        if (!Array.isArray(prices) || !Array.isArray(outcomes)) return;

        let rawCat = "General";
        const title = m.question.toLowerCase();

        if (m.category && m.category.length > 0) {
            rawCat = m.category.split(',')[0];
        } else if (title.includes("election") || title.includes("biden") || title.includes("trump") || title.includes("politics")) {
            rawCat = "Politics";
        } else if (title.includes("bitcoin") || title.includes("eth") || title.includes("crypto") || title.includes("solana")) {
            rawCat = "Crypto";
        } else if (title.includes("nfl") || title.includes("nba") || title.includes("mlb") || title.includes("sports")) {
            rawCat = "Sports";
        } else if (m.groupItemTitle) {
            rawCat = m.groupItemTitle;
        }

        const cleanCat = rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase().trim();

        prices.forEach((p, idx) => {
            const prob = parseFloat(p);
            if (!isNaN(prob) && prob >= 0.70 && prob < 0.999) {
                const roi = ((1 - prob) / prob) * 100;
                deals.push({
                    title: m.question,
                    outcome: outcomes[idx],
                    probability: parseFloat((prob * 100).toFixed(1)),
                    roi: parseFloat(roi.toFixed(2)),
                    daysLeft: parseFloat(diffDays.toFixed(1)),
                    volume: volume,
                    category: cleanCat,
                    slug: m.slug,
                    outcomeIdx: idx,
                    expiryDate: m.endDate
                });
            }
        });
    });

    return { deals };
}

function triggerAlphaAlert(deal) {
    chrome.notifications.create(NOTIF_PREFIX + deal.slug, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "🔥 Alpha Opportunity Found",
        message: `${deal.roi}% Yield found on: ${deal.title}\nOutcome: ${deal.outcome} (${deal.probability}%)`,
        priority: 2
    });
}

chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith(NOTIF_PREFIX)) {
        chrome.tabs.create({ url: 'deals.html' });
    }
});

// Message Routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "manualSync") {
        performBackgroundScan().then(() => sendResponse({ ok: true }));
        return true;
    }

    if (msg.action === "getMarkets") {
        chrome.storage.local.get([MARKET_MAP_KEY], (res) => {
            sendResponse({ data: res[MARKET_MAP_KEY] || {} });
        });
        return true;
    }

    if (msg.action === "getCount") {
        chrome.storage.local.get([CACHE_KEY], (res) => {
            sendResponse({ count: res[CACHE_KEY]?.count || 0 });
        });
        return true;
    }
});
