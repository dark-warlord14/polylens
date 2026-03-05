// content.js
// Final refined version: focuses on exact data matches and filters out closed bets.

(function () {
    if (window.__polyLensActive) return;
    window.__polyLensActive = true;

    var marketData = {}; // slug -> { endDate: string, closed: boolean }
    var activeFilters = null;
    var debounceTimer;

    function init() {
        injectStyles();

        // 1. Initial Load: Get saved filters and sync with background API cache
        chrome.storage.sync.get(["polyFilters"], function (res) {
            if (res.polyFilters && res.polyFilters.filters) {
                activeFilters = res.polyFilters;
                fetchAndApply();
            }
        });

        // 2. Observer for dynamic content (infinite scroll / SPA transitions)
        var observer = new MutationObserver(function () {
            if (!activeFilters) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(applyFilterLogic, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function fetchAndApply() {
        chrome.runtime.sendMessage({ action: "getMarkets" }, function (res) {
            if (res && res.data) {
                // Merge API data with the exact data found in page's __NEXT_DATA__
                marketData = Object.assign({}, res.data, scanNextData());
                applyFilterLogic();
            }
        });
    }

    // Scans the page's React/Next.js hydration state for exact market metadata
    function scanNextData() {
        var local = {};
        var el = document.getElementById("__NEXT_DATA__");
        if (!el) return local;
        try {
            var d = JSON.parse(el.textContent);
            var scan = function (o) {
                if (!o || typeof o !== "object") return;
                // Collect exact slug, endDate, and closed status
                if (o.slug && (o.endDate || o.resolutionDate)) {
                    local[o.slug] = {
                        endDate: o.endDate || o.resolutionDate,
                        closed: !!(o.closed || o.resolved)
                    };
                }
                Object.values(o).forEach(scan);
            };
            scan(d);
        } catch (e) { }
        return local;
    }

    // THE FILTER ENGINE
    function applyFilterLogic() {
        if (!activeFilters || !activeFilters.filters) return;

        var mode = activeFilters.mode;
        var f = activeFilters.filters;
        var now = new Date();

        // Helper to get slug from URL
        function getFullSlug(h) {
            if (!h) return null;
            var match = h.match(/^\/(?:event|market)\/([^?#]+)/);
            return match ? match[1].replace(/\/$/, "") : null;
        }

        // Helper to find the card or row container
        function findCardRoot(l) {
            var row = l.closest('tr') || l.closest('[role="row"]');
            if (row) return row;
            var card = l.closest('.group\\/card');
            if (card) return card;

            // Fallback walking up
            var el = l;
            for (var i = 0; i < 6; i++) {
                var p = el.parentElement;
                if (!p || p === document.body) break;
                if (p.className.includes('rounded') && p.className.includes('flex-col')) return p;
                el = p;
            }
            return el;
        }

        var links = document.querySelectorAll('a[href^="/event/"], a[href^="/market/"]');
        var processedCards = new Set();

        links.forEach(function (l) {
            var card = findCardRoot(l);
            if (!card || processedCards.has(card)) return;
            processedCards.add(card);

            var fullSlug = getFullSlug(l.getAttribute("href"));
            var baseSlug = fullSlug ? fullSlug.split('/')[0] : null;

            // Check exact data match (try full-link slug first, then base-event slug)
            var info = marketData[fullSlug] || marketData[baseSlug];
            var show = true;

            // 1. Filter out closed/resolved bets immediately
            var isResolvedUI = !!(card.innerText.match(/resolved|ended|closed/i));
            if ((info && info.closed) || isResolvedUI) {
                show = false;
            } else if (info && info.endDate) {
                // 2. Apply Date Filters purely based on exact endDate data
                var expiry = new Date(info.endDate);
                var diffDays = Math.floor((expiry.getTime() - now.getTime()) / 86400000);

                if (mode === "days") {
                    // Show today (-1 to 0) up to N days
                    show = (diffDays >= -1 && diffDays <= f.daysToExpiry);
                } else if (mode === "date") {
                    var t = new Date(f.exactDate);
                    show = (expiry.getUTCFullYear() === t.getUTCFullYear() &&
                        expiry.getUTCMonth() === t.getUTCMonth() &&
                        expiry.getUTCDate() === t.getUTCDate()) ||
                        (expiry.getFullYear() === t.getFullYear() &&
                            expiry.getMonth() === t.getMonth() &&
                            expiry.getDate() === t.getDate());
                } else if (mode === "range") {
                    var start = new Date(f.rangeStart);
                    var end = new Date(f.rangeEnd);
                    end.setHours(23, 59, 59, 999);
                    show = (expiry >= start && expiry <= end);
                }
            } else {
                // If NO EXACT DATA is found (missing from API and JSON), dim it to be safe 
                // (This removes the 'semantic' guessing that caused false positives)
                show = false;
            }

            if (show) card.classList.remove("pm-dim");
            else card.classList.add("pm-dim");
        });
    }

    function injectStyles() {
        if (document.getElementById("pm-style")) return;
        var s = document.createElement("style");
        s.id = "pm-style";
        s.textContent = ".pm-dim { opacity: 0.12 !important; filter: grayscale(90%) !important; transition: opacity 0.3s !important; pointer-events: none !important; }";
        document.head.appendChild(s);
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.action === "applyFilters") {
            activeFilters = { mode: msg.mode, filters: msg.filters };
            marketData = Object.assign({}, marketData, scanNextData());
            applyFilterLogic();
            var vis = document.querySelectorAll('a[href*="/event/"]:not(.pm-dim), a[href*="/market/"]:not(.pm-dim)').length;
            var tot = document.querySelectorAll('a[href*="/event/"], a[href*="/market/"]').length;
            sendResponse({ visible: Math.ceil(vis / 2), total: Math.ceil(tot / 2) });
        } else if (msg.action === "clearFilters") {
            activeFilters = null;
            document.querySelectorAll(".pm-dim").forEach(function (el) { el.classList.remove("pm-dim"); });
            sendResponse({ ok: true });
        }
    });

    init();
})();
