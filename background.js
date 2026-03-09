/**
 * background.js - PolyLens Professional Background Engine
 * Handles persistent cache (chrome.storage.local), background scanning (alarms),
 * and Alpha Alerts (notifications).
 */

const CACHE_KEY = "polylens_pro_cache";
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
 * Syncs the results to storage.local for dashboard use.
 */
async function performBackgroundScan() {
    try {
        const markets = await fetchAllMarkets();
        const now = Date.now();

        // Load existing cache to detect NEW alpha deals
        const existing = await chrome.storage.local.get([CACHE_KEY]);
        const oldDeals = existing[CACHE_KEY]?.deals || [];
        const oldIds = new Set(oldDeals.map(d => d.slug + d.outcome));

        // Process found deals
        const result = processMarketsIntoDeals(markets);

        // Cache the latest results
        await chrome.storage.local.set({
            [CACHE_KEY]: {
                timestamp: now,
                count: markets.length,
                deals: result.deals
            }
        });

        console.log(`PolyLens Pro: Sync Complete. ${result.deals.length} active alpha deals cached.`);

        // Trigger notifications for TRULY new institutional grade deals
        const newAlpha = result.deals.filter(d =>
            !oldIds.has(d.slug + d.outcome) &&
            d.roi >= 3 &&
            d.probability >= 85 &&
            d.volume >= 25000 // Professional floor for alerts
        );

        if (newAlpha.length > 0) {
            triggerAlphaAlert(newAlpha[0]); // Notify only the top one to avoid spam
        }

    } catch (e) {
        console.error("PolyLens Pro: Background Scan Failed", e);
    }
}

async function fetchAllMarkets() {
    const pageSize = 500;
    let offset = 0;
    let all = [];
    let hasMore = true;

    while (hasMore) {
        const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${pageSize}&offset=${offset}&order=volume&dir=desc`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.length > 0) {
            all = all.concat(data);
            offset += data.length;
            if (data.length < pageSize) hasMore = false;
        } else {
            hasMore = false;
        }
        await new Promise(r => setTimeout(r, 200));
    }
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

        if (diffDays <= 0 || diffDays > 7) return; // Background focus on short-term alpha

        let prices = m.outcomePrices;
        let outcomes = m.outcomes;
        if (typeof prices === "string") { try { prices = JSON.parse(prices); } catch (e) { return; } }
        if (typeof outcomes === "string") { try { outcomes = JSON.parse(outcomes); } catch (e) { return; } }

        if (!Array.isArray(prices) || !Array.isArray(outcomes)) return;

        prices.forEach((p, idx) => {
            const prob = parseFloat(p);
            // Institutional floor is 70% reliability for background tracking
            if (!isNaN(prob) && prob >= 0.70 && prob < 0.999) {
                const roi = ((1 - prob) / prob) * 100;
                deals.push({
                    title: m.question,
                    outcome: outcomes[idx],
                    probability: (prob * 100).toFixed(1),
                    roi: parseFloat(roi.toFixed(2)),
                    daysLeft: diffDays.toFixed(1),
                    volume: volume,
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

// Open Dashboard when notification is clicked
chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith(NOTIF_PREFIX)) {
        chrome.tabs.create({ url: 'deals.html' });
    }
});

// Listener for manual sync requests from UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "manualSync") {
        performBackgroundScan().then(() => sendResponse({ ok: true }));
        return true;
    }
});
