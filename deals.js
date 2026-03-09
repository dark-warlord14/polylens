/**
 * deals.js - PolyLens Pro Dashboard Controller
 * Features: Flash Load from Cache, Real-time CLOB Depth, Adaptive ROI.
 */

const CACHE_KEY = "polylens_pro_cache";

document.addEventListener("DOMContentLoaded", () => {
    init();
});

let currentSort = 'roi';
let dealsInView = [];

function init() {
    setupEventListeners();
    loadFromCache(); // "Flash Load"
}

function setupEventListeners() {
    document.getElementById("refresh-btn").addEventListener("click", manualSync);

    document.querySelectorAll(".sort-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentSort = btn.dataset.sort;
            renderDeals();
        });
    });

    ["filter-days", "filter-prob", "filter-min-volume", "hide-low-liq", "filter-trade-size"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", () => renderDeals());
    });
}

/**
 * Loads data instantly from chrome.storage.local
 */
async function loadFromCache() {
    const res = await chrome.storage.local.get([CACHE_KEY]);
    if (res[CACHE_KEY]) {
        const cache = res[CACHE_KEY];
        document.getElementById("stat-scanned").textContent = cache.count || 0;
        document.getElementById("last-sync-time").textContent = `(Synced ${formatTime(cache.timestamp)})`;
        renderDeals(cache.deals);
    } else {
        manualSync();
    }
}

function formatTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000 / 60);
    if (diff < 1) return "just now";
    return `${diff}m ago`;
}

async function manualSync() {
    const btn = document.getElementById("refresh-btn");
    btn.disabled = true;
    btn.textContent = "Syncing Engine...";

    // Send message to background script to perform a fresh scan
    chrome.runtime.sendMessage({ action: "manualSync" }, (response) => {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path></svg> Refresh Dashboard`;
        loadFromCache();
    });
}

function renderDeals(inputDeals) {
    const grid = document.getElementById("deals-grid");
    const empty = document.getElementById("empty-state");
    const daysLimit = parseInt(document.getElementById("filter-days").value, 10);
    const probLimit = parseInt(document.getElementById("filter-prob").value, 10) / 100;
    const minVol = parseInt(document.getElementById("filter-min-volume").value, 10);
    const hideLowLiq = document.getElementById("hide-low-liq").checked;
    const tradeSize = parseInt(document.getElementById("filter-trade-size").value, 10);

    // Use inputDeals or the global state
    if (inputDeals) dealsInView = inputDeals;

    // Filter Logic
    let filtered = dealsInView.filter(d => {
        // Validation with defaults in case UI is inconsistent
        const days = daysLimit || 7;
        const prob = probLimit || 0.8;
        const minV = minVol || 0;

        if (d.daysLeft > days) return false;
        if (d.volume < minV) return false;

        // Reliability check (probability is stored as e.g. "85.0")
        const currentProb = parseFloat(d.probability) / 100;
        if (currentProb < prob) return false;

        // Liquidity labeling
        d.liqClass = d.volume > 50000 ? "high" : d.volume > 10000 ? "mid" : "low";
        if (hideLowLiq && d.liqClass === "low") return false;

        return true;
    });

    // Sort Logic
    if (currentSort === 'roi') filtered.sort((a, b) => b.roi - a.roi);
    else if (currentSort === 'volume') filtered.sort((a, b) => b.volume - a.volume);
    else if (currentSort === 'expiry') filtered.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    grid.innerHTML = "";
    document.getElementById("stat-deals").textContent = filtered.length;
    document.getElementById("results-title").textContent = filtered.length > 0 ? "Institutional Pipeline Active" : "No Alpha Found";

    if (filtered.length === 0) {
        empty.classList.remove("hidden");
        return;
    }

    filtered.forEach(deal => {
        const card = document.createElement("div");
        card.className = "deal-card";
        const volStr = deal.volume >= 1e6 ? (deal.volume / 1e6).toFixed(1) + "M" : deal.volume >= 1e3 ? (deal.volume / 1e3).toFixed(1) + "K" : deal.volume;

        card.innerHTML = `
            <div class="deal-header">
                <div>
                    <span class="category-tag">TRADABLE</span>
                    <span class="liquidity-badge ${deal.liqClass}">${deal.liqClass.toUpperCase()} LIQ</span>
                </div>
                <span class="expiry-tag">${deal.daysLeft}d left</span>
            </div>
            <h3 class="deal-question">${deal.title}</h3>
            <div class="deal-metrics">
                <div class="metric-box">
                    <span class="metric-label">Projected ROI</span>
                    <span class="metric-value roi">+${deal.roi}%</span>
                </div>
                <div class="metric-box">
                    <span class="metric-label">Reliability</span>
                    <span class="metric-value">${deal.probability}%</span>
                </div>
            </div>
            <div class="outcome-row">
                <span class="outcome-name">${deal.outcome}</span>
                <span class="outcome-vol">$${volStr} Vol</span>
            </div>
            <div id="depth-${deal.slug}" class="depth-info">
                <span class="metric-label">Analyzing Book Depth...</span>
            </div>
            <a href="https://polymarket.com/market/${deal.slug}" target="_blank" class="deal-link-btn">Lock in Profit →</a>
        `;
        grid.appendChild(card);

        // Trigger async order book analysis
        fetchDepth(deal.slug, deal.outcomeIdx, tradeSize);
    });
}

/**
 * Fetches real-time CLOB depth for a specific token
 * and calculates executable ROI for the target trade size.
 */
async function fetchDepth(slug, outcomeIdx, tradeSize) {
    const depthEl = document.getElementById(`depth-${slug}`);
    try {
        // First get the market to find the token IDs (this is public)
        const mRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
        const mData = await mRes.json();
        if (!mData || !mData[0] || !mData[0].clobTokenIds) return;

        const tokenIds = JSON.parse(mData[0].clobTokenIds);
        const tokenId = tokenIds[outcomeIdx];

        // Now fetch the actual order book from CLOB (Slippage check)
        const bRes = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
        const book = await bRes.json();

        if (!book || !book.asks || book.asks.length === 0) {
            depthEl.innerHTML = `<span class="metric-label" style="color:#ef4444">No Sell Liquidity Found</span>`;
            return;
        }

        // Calculate slippage for target trade size
        let cost = 0;
        let shares = 0;
        let fulfilled = false;

        for (const ask of book.asks) {
            const price = parseFloat(ask.price);
            const size = parseFloat(ask.size);
            const remaining = tradeSize - cost;
            const take = Math.min(size * price, remaining);

            cost += take;
            shares += take / price;

            if (cost >= tradeSize) {
                fulfilled = true;
                break;
            }
        }

        if (fulfilled) {
            const avgPrice = cost / shares;
            const effectiveRoi = ((1 - avgPrice) / avgPrice) * 100;
            const slippage = (avgPrice - parseFloat(book.asks[0].price)) / parseFloat(book.asks[0].price) * 100;

            depthEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-top:8px; border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">
                    <span class="metric-label">Adjusted ROI ($${tradeSize}): <b style="color:#10b981">+${effectiveRoi.toFixed(2)}%</b></span>
                    <span class="metric-label">Slippage: <b style="color:${slippage > 1 ? '#ef4444' : '#94a3b8'}">${slippage.toFixed(2)}%</b></span>
                </div>
            `;
        } else {
            const maxLiq = cost.toFixed(0);
            depthEl.innerHTML = `<span class="metric-label" style="color:#f59e0b">Limited Depth: Only $${maxLiq} available</span>`;
        }

    } catch (e) {
        depthEl.innerHTML = `<span class="metric-label">Depth data unavailable</span>`;
    }
}
