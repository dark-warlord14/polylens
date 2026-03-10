/**
 * deals.js — PolyLens Elite Dashboard Controller
 *
 * Responsibilities:
 *   - Load opportunities from cache on open (no API call if cache exists)
 *   - Show "stale" warning if cache is older than CACHE_TTL_MS (30 min)
 *   - Trigger auto-scan only on first launch (no cache) or manual button click
 *   - Persist/restore filter config (volume, days, prob, sort) via chrome.storage.sync
 *   - Filter pipeline: sidebar filters → category chips → sort → render
 *   - Display precise expiry countdowns (e.g. "6h 14m left") from expiryDate field
 *   - Receive syncProgress and syncComplete messages from background service worker
 *
 * Storage:
 *   chrome.storage.local  →  polylens_elite_cache      (source of truth for deals)
 *   chrome.storage.sync   →  polylens_filter_config    (user's saved filter settings)
 *
 * Categories (matches Polymarket nav):
 *   Politics · Elections · Sports · Crypto · Finance · Economy
 *   Geopolitics · Tech · Culture · Climate & Science
 */

const CACHE_KEY = "polylens_elite_cache";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — matches background alarm

let allOpportunities = [];
let currentCategory = "all";
const CORE_CATEGORIES = ["Politics", "Elections", "Sports", "Crypto", "Finance", "Economy", "Geopolitics", "Tech", "Culture", "Climate & Science"];

// ─── Init ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    setupMessageListeners();
    initDashboard();
    setupEventListeners();
});

// ─── Message Bus ───────────────────────────────────────────────────

function setupMessageListeners() {
    chrome.runtime.onMessage.addListener(msg => {
        if (msg.action === "syncProgress") {
            const el = document.getElementById("sync-status");
            if (el) el.textContent = `Scanning… ${(msg.count || 0).toLocaleString()} markets found`;
        } else if (msg.action === "syncComplete") {
            loadFromCache(); // Re-read storage — source of truth
            resetSyncButton();
        }
    });
}

// ─── Dashboard Init (Cache-First, No Auto-Sync) ────────────────────

async function initDashboard() {
    renderSkeletons();
    await loadConfig(); // Restore saved filter settings first

    const storage = await chrome.storage.local.get([CACHE_KEY]);
    const cache = storage[CACHE_KEY];

    if (cache && cache.deals && cache.deals.length > 0) {
        const ageMs = Date.now() - (cache.timestamp || 0);
        const isStale = ageMs > CACHE_TTL_MS;

        allOpportunities = cache.deals;
        updateStats(cache.count, allOpportunities.length, cache.timestamp);
        applyFilters();

        if (isStale) {
            const statusEl = document.getElementById("sync-status");
            if (statusEl) statusEl.textContent = `Last synced ${formatAge(ageMs)} ago — click Sync to refresh`;
        }
    } else {
        // No cache at all — first launch, auto sync
        const statusEl = document.getElementById("sync-status");
        if (statusEl) statusEl.textContent = "No cached data — running initial scan…";
        triggerSync();
    }
}

async function loadFromCache() {
    const storage = await chrome.storage.local.get([CACHE_KEY]);
    const cache = storage[CACHE_KEY];
    if (cache && cache.deals) {
        allOpportunities = cache.deals;
        updateStats(cache.count, allOpportunities.length, cache.timestamp);
        applyFilters();
    }
}

// ─── Event Listeners ───────────────────────────────────────────────

function setupEventListeners() {
    ["min-volume", "max-days", "min-prob", "sort-by"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", applyFilters);
    });
    document.getElementById("refresh-btn")?.addEventListener("click", manualSync);
    document.getElementById("empty-sync-btn")?.addEventListener("click", manualSync);
    document.getElementById("save-config-btn")?.addEventListener("click", saveConfig);
}

// ─── Config Persistence ────────────────────────────────────────────

const CONFIG_KEY = "polylens_filter_config";

async function saveConfig() {
    const config = {
        minVolume: document.getElementById("min-volume")?.value || "10000",
        maxDays: document.getElementById("max-days")?.value || "1",
        minProb: document.getElementById("min-prob")?.value || "80",
        sortBy: document.getElementById("sort-by")?.value || "roi"
    };
    await chrome.storage.sync.set({ [CONFIG_KEY]: config });

    // Brief visual confirmation
    const btn = document.getElementById("save-config-btn");
    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Saved!</span>`;
        btn.style.background = "var(--green)";
        btn.style.borderColor = "var(--green)";
        btn.style.color = "#fff";
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.background = "";
            btn.style.borderColor = "";
            btn.style.color = "";
        }, 1800);
    }
}

async function loadConfig() {
    const storage = await chrome.storage.sync.get([CONFIG_KEY]);
    const config = storage[CONFIG_KEY];
    if (!config) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
    };
    set("min-volume", config.minVolume);
    set("max-days", config.maxDays);
    set("min-prob", config.minProb);
    set("sort-by", config.sortBy);
}


async function manualSync() {
    const btn = document.getElementById("refresh-btn");
    const statusEl = document.getElementById("sync-status");

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <span>Scanning…</span>
        `;
    }
    if (statusEl) statusEl.textContent = "Connecting to Polymarket API…";

    triggerSync();
}

function triggerSync() {
    chrome.runtime.sendMessage({ action: "manualSync" }, () => {
        // Response handled via syncComplete message listener
        if (chrome.runtime.lastError) {
            resetSyncButton();
        }
    });
}

function resetSyncButton() {
    const btn = document.getElementById("refresh-btn");
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
            </svg>
            <span>Sync Markets</span>
        `;
    }
    const statusEl = document.getElementById("sync-status");
    if (statusEl) {
        chrome.storage.local.get([CACHE_KEY], res => {
            const ts = res[CACHE_KEY]?.timestamp;
            if (ts) {
                const ageMs = Date.now() - ts;
                statusEl.textContent = `Synced ${formatAge(ageMs)} ago · ${(res[CACHE_KEY]?.count || 0).toLocaleString()} markets`;
            }
        });
    }
}

// ─── Stats ─────────────────────────────────────────────────────────

function updateStats(totalScanned, opportunitiesFound, timestamp) {
    const scannedEl = document.getElementById("stat-scanned");
    const dealsEl = document.getElementById("stat-deals");
    const lastSyncEl = document.getElementById("last-sync");

    if (scannedEl) scannedEl.textContent = (totalScanned || 0).toLocaleString();
    if (dealsEl) dealsEl.textContent = (opportunitiesFound || 0).toLocaleString();
    if (lastSyncEl && timestamp) {
        const ageMs = Date.now() - timestamp;
        lastSyncEl.textContent = `Updated ${formatAge(ageMs)} ago`;
    }
}

function formatAge(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
}

// ─── Filter & Render Pipeline ──────────────────────────────────────

function applyFilters() {
    const minVol = parseFloat(document.getElementById("min-volume")?.value) || 0;
    const maxDays = parseFloat(document.getElementById("max-days")?.value) || 999;
    const minProb = parseFloat(document.getElementById("min-prob")?.value) || 0;
    const sortBy = document.getElementById("sort-by")?.value || "roi";

    const sidebarFiltered = allOpportunities.filter(d =>
        d.volume >= minVol && d.daysLeft <= maxDays && d.probability >= minProb
    );

    updateCategoryChips(sidebarFiltered);

    const finalFiltered = sidebarFiltered.filter(d => {
        if (currentCategory === "all") return true;
        if (currentCategory === "Other") return !CORE_CATEGORIES.includes(d.category);
        return d.category === currentCategory;
    });

    if (sortBy === "roi") finalFiltered.sort((a, b) => b.roi - a.roi);
    else if (sortBy === "volume") finalFiltered.sort((a, b) => b.volume - a.volume);
    else if (sortBy === "prob") finalFiltered.sort((a, b) => b.probability - a.probability);
    else if (sortBy === "days") finalFiltered.sort((a, b) => a.daysLeft - b.daysLeft);

    renderOpportunities(finalFiltered);
}

function updateCategoryChips(filtered) {
    const container = document.getElementById("category-filters");
    if (!container) return;

    const counts = {};
    filtered.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });

    const toShow = CORE_CATEGORIES.filter(c => (counts[c] || 0) > 0 || currentCategory === c);
    const otherCount = filtered.filter(d => !CORE_CATEGORIES.includes(d.category)).length;
    if (otherCount > 0 || currentCategory === "Other") toShow.push("Other");

    container.innerHTML = "";

    const makeChip = (label, isActive, onClick) => {
        const btn = document.createElement("button");
        btn.className = `cat-chip${isActive ? " active" : ""}`;
        btn.textContent = label;
        btn.onclick = onClick;
        container.appendChild(btn);
    };

    makeChip(`All  ${filtered.length}`, currentCategory === "all", () => {
        currentCategory = "all";
        applyFilters();
    });

    toShow.forEach(cat => {
        const count = cat === "Other" ? otherCount : (counts[cat] || 0);
        makeChip(`${cat}  ${count}`, currentCategory === cat, () => {
            currentCategory = cat;
            applyFilters();
        });
    });
}

// ─── Render ────────────────────────────────────────────────────────

function renderSkeletons() {
    const grid = document.getElementById("deals-grid");
    if (grid) grid.innerHTML = '<div class="skeleton-card"></div>'.repeat(8);
}

function renderOpportunities(deals) {
    const grid = document.getElementById("deals-grid");
    const empty = document.getElementById("empty-state");
    const dealsEl = document.getElementById("stat-deals");

    if (dealsEl) dealsEl.textContent = deals.length.toLocaleString();
    if (!grid) return;

    grid.innerHTML = "";

    if (deals.length === 0) {
        if (empty) empty.classList.remove("hidden");
        return;
    }
    if (empty) empty.classList.add("hidden");

    deals.forEach(deal => {
        const card = document.createElement("div");
        card.className = "deal-card";

        const vol = deal.volume;
        const volLabel = vol >= 1e6
            ? `$${(vol / 1e6).toFixed(1)}M`
            : vol >= 1e3
                ? `$${(vol / 1e3).toFixed(0)}K`
                : `$${vol}`;

        const volTier = vol >= 500000 ? "high" : vol >= 100000 ? "mid" : "low";
        const totalMinutes = deal.expiryDate
            ? Math.max(0, Math.floor((new Date(deal.expiryDate) - Date.now()) / 60000))
            : Math.max(0, Math.floor(deal.daysLeft * 24 * 60));

        const dd = Math.floor(totalMinutes / (60 * 24));
        const hh = Math.floor((totalMinutes % (60 * 24)) / 60);
        const mm = totalMinutes % 60;

        let daysLabel;
        if (totalMinutes <= 0) {
            daysLabel = "Closing now";
        } else if (dd === 0 && hh === 0) {
            daysLabel = `${mm}m left`;
        } else if (dd === 0) {
            daysLabel = `${hh}h ${mm}m left`;
        } else {
            daysLabel = `${dd}d ${hh}h left`;
        }

        const isUrgent = totalMinutes < 24 * 60; // < 24 hours
        const isHighProb = deal.probability >= 80;

        // Escape to prevent XSS
        const title = escapeHTML(deal.title);
        const outcome = escapeHTML(String(deal.outcome || "Yes"));

        card.innerHTML = `
            <div class="card-header">
                <span class="cat-badge">${escapeHTML(deal.category || "General")}</span>
                <span class="vol-badge vol-${volTier}">${volLabel}</span>
            </div>

            <div class="card-body">
                <p class="market-title">${title}</p>
                <div class="outcome-row">
                    <span class="outcome-pill">${outcome}</span>
                    <span class="expiry-chip${isUrgent ? " urgent" : ""}">${daysLabel}</span>
                </div>
            </div>

            <div class="card-metrics">
                <div class="metric">
                    <span class="metric-label">Probability</span>
                    <span class="metric-value${isHighProb ? " prob-high" : ""}">${deal.probability}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Implied ROI</span>
                    <span class="metric-value roi-val">+${deal.roi}%</span>
                </div>
            </div>

            <div class="card-footer">
                <a href="https://polymarket.com/market/${deal.slug}" target="_blank" class="cta-btn">
                    Trade on Polymarket
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M7 17L17 7M17 7H7M17 7v10"/>
                    </svg>
                </a>
            </div>
        `;
        grid.appendChild(card);
    });
}

function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
}