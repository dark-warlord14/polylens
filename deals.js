/**
 * deals.js - PolyLens Elite Controller
 * Manages the institutional dashboard, real-time filtering, and order book depth.
 */

let allDeals = [];
let currentCategory = "all";

document.addEventListener("DOMContentLoaded", () => {
    initDashboard();
    setupEventListeners();
});

async function initDashboard() {
    // Show skeletons initially
    renderSkeletons();

    // Load data from storage
    const storage = await chrome.storage.local.get(["polylens_pro_cache"]);
    const cache = storage["polylens_pro_cache"];

    if (cache && cache.deals) {
        allDeals = cache.deals;
        updateStats(cache.count, allDeals.length);
        populateCategories(allDeals);
        applyFilters();
    } else {
        // First time users
        manualSync();
    }
}

function setupEventListeners() {
    // Live Filtering
    const filterInputs = ["min-volume", "max-days", "min-prob", "sort-by", "depth-toggle"];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", applyFilters);
    });

    document.getElementById("refresh-btn").addEventListener("click", manualSync);
}

function renderSkeletons() {
    const grid = document.getElementById("deals-grid");
    grid.innerHTML = '<div class="skeleton-card"></div>'.repeat(6);
}

function updateStats(scanned, found) {
    document.getElementById("stat-scanned").textContent = scanned.toLocaleString();
    document.getElementById("stat-deals").textContent = found;

    // Update title based on pipeline status
    const title = document.getElementById("results-title");
    title.textContent = found > 0 ? "Institutional Pipeline Active" : "Scanning Market Depth...";
}

function populateCategories(deals) {
    const catContainer = document.getElementById("category-filters");
    const categories = ["all", ...new Set(deals.map(d => d.category))];

    // Preserve "all" chip
    catContainer.innerHTML = '<button class="cat-chip active" data-category="all">All Markets</button>';

    categories.forEach(cat => {
        if (cat === "all") return;
        const btn = document.createElement("button");
        btn.className = "cat-chip";
        btn.dataset.category = cat;
        btn.textContent = cat;
        btn.addEventListener("click", () => {
            document.querySelectorAll(".cat-chip").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            currentCategory = cat;
            applyFilters();
        });
        catContainer.appendChild(btn);
    });
}

function applyFilters() {
    const minVol = parseFloat(document.getElementById("min-volume").value) || 0;
    const maxDays = parseFloat(document.getElementById("max-days").value) || 999;
    const minProb = parseFloat(document.getElementById("min-prob").value) || 0;
    const sortBy = document.getElementById("sort-by").value;
    const showDepth = document.getElementById("depth-toggle").checked;

    let filtered = allDeals.filter(d => {
        const catMatch = currentCategory === "all" || d.category === currentCategory;
        const volMatch = d.volume >= minVol;
        const daysMatch = d.daysLeft <= maxDays;
        const probMatch = d.probability >= minProb;
        return catMatch && volMatch && daysMatch && probMatch;
    });

    // Sorting Logic
    if (sortBy === "roi") filtered.sort((a, b) => b.roi - a.roi);
    else if (sortBy === "volume") filtered.sort((a, b) => b.volume - a.volume);
    else if (sortBy === "days") filtered.sort((a, b) => a.daysLeft - b.daysLeft);

    renderDeals(filtered, showDepth);
}

function renderDeals(deals, showDepth) {
    const grid = document.getElementById("deals-grid");
    const empty = document.getElementById("empty-state");

    grid.innerHTML = "";
    document.getElementById("stat-deals").textContent = deals.length;

    if (deals.length === 0) {
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");

    deals.forEach(deal => {
        const card = document.createElement("div");
        card.className = "deal-card";

        // Liquidity Class
        let liqClass = "low";
        if (deal.volume >= 500000) liqClass = "high";
        else if (deal.volume >= 100000) liqClass = "mid";

        const shortVol = deal.volume >= 1e6 ? (deal.volume / 1e6).toFixed(1) + "M" : (deal.volume / 1e3).toFixed(1) + "K";

        card.innerHTML = `
            <div class="deal-header">
                <div>
                    <span class="category-tag">${deal.category.toUpperCase()}</span>
                    <span class="liquidity-badge ${liqClass}">${liqClass.toUpperCase()} LIQ</span>
                </div>
                <span class="expiry-tag">${deal.daysLeft}d to expiry</span>
            </div>
            <h3 class="deal-question">${deal.title}</h3>
            <div class="deal-metrics">
                <div class="metric-box">
                    <span class="metric-label">Projected Yield</span>
                    <span class="metric-value roi">+${deal.roi}%</span>
                </div>
                <div class="metric-box">
                    <span class="metric-label">Reliability</span>
                    <span class="metric-value">${deal.probability}%</span>
                </div>
            </div>
            <div class="outcome-row">
                <span class="outcome-name">${deal.outcome}</span>
                <span class="outcome-vol">$${shortVol} Volume</span>
            </div>
            ${showDepth ? `<div id="depth-${deal.slug}" class="depth-info">Analyzing Order Book Depth...</div>` : ""}
            <a href="https://polymarket.com/market/${deal.slug}" target="_blank" class="deal-link-btn">Lock in Alpha →</a>
        `;
        grid.appendChild(card);

        if (showDepth) fetchDepth(deal.slug, deal.outcomeIdx);
    });
}

/**
 * Institutional Depth Analysis Integration
 */
async function fetchDepth(slug, outcomeIdx) {
    const tradeSize = 1000; // Fixed standard size
    const depthEl = document.getElementById(`depth-${slug}`);
    if (!depthEl) return;

    try {
        const mRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
        const mData = await mRes.json();
        if (!mData || !mData[0] || !mData[0].clobTokenIds) return;

        const tokenIds = JSON.parse(mData[0].clobTokenIds);
        const tokenId = tokenIds[outcomeIdx];

        const bRes = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
        const book = await bRes.json();

        if (!book || !book.asks || book.asks.length === 0) {
            depthEl.innerHTML = '<span style="color:#EF4444">No Sell Liquidity Available</span>';
            return;
        }

        let cost = 0, shares = 0, fulfilled = false;
        for (const ask of book.asks) {
            const price = parseFloat(ask.price);
            const size = parseFloat(ask.size);
            const remaining = tradeSize - cost;
            const take = Math.min(size * price, remaining);
            cost += take;
            shares += take / price;
            if (cost >= tradeSize) { fulfilled = true; break; }
        }

        if (fulfilled) {
            const avgPrice = cost / shares;
            const effectiveRoi = ((1 - avgPrice) / avgPrice) * 100;
            const slippage = (avgPrice - parseFloat(book.asks[0].price)) / parseFloat(book.asks[0].price) * 100;
            depthEl.innerHTML = `Adj. ROI ($${tradeSize}): <b style="color:#10B981">+${effectiveRoi.toFixed(2)}%</b> | Slippage: <b style="color:${slippage > 1 ? '#EF4444' : '#7B8996'}">${slippage.toFixed(2)}%</b>`;
        } else {
            depthEl.innerHTML = `<span style="color:#f59e0b">Insufficient Depth: Max $${cost.toFixed(0)} available</span>`;
        }
    } catch (e) {
        depthEl.textContent = "Book analysis timed out";
    }
}

async function manualSync() {
    const btn = document.getElementById("refresh-btn");
    const status = document.getElementById("sync-status");

    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Executing Deep Scan...';
    status.textContent = "Crawling 4,000+ Markets. Please wait...";

    chrome.runtime.sendMessage({ action: "manualSync" }, (res) => {
        setTimeout(initDashboard, 500); // Small grace for storage write
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> Run Full Spectrum Scan';
        status.textContent = "Pipeline Synchronized.";
    });
}
