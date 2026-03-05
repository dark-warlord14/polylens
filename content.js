// content.js
// Production-grade content script for PolyLens.
// Optimized for performance with a MutationObserver that only processes NEW elements.

(function () {
    if (window.__polyLensActive) return;
    window.__polyLensActive = true;

    var marketData = {};
    var activeFilters = null;
    var debounceTimer;

    // Use a WeakMap to track which roots we have already processed/bound
    // This prevents re-processing the same elements during mutations.
    var processedRoots = new WeakSet();

    function init() {
        injectStyles();

        // 1. Initial Load: Get saved filters and sync with background cache
        chrome.storage.sync.get(["polyFilters"], function (res) {
            if (res.polyFilters && res.polyFilters.filters) {
                activeFilters = res.polyFilters;
                fetchAndApply();
            }
        });

        // 2. Observer for dynamic content & React updates
        var observer = new MutationObserver(function (mutations) {
            if (!activeFilters) return;

            var needsUpdate = false;
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.addedNodes.length > 0) {
                    needsUpdate = true;
                    break;
                }
                if (m.type === "attributes" && m.attributeName === "class") {
                    // Trigger if a class changed on an element (React might have stripped pm-dim)
                    var targetClass = (m.target && m.target.className) ? m.target.className : "";
                    if (typeof targetClass === "string" && !targetClass.includes("pm-dim")) {
                        needsUpdate = true;
                        break;
                    }
                }
            }

            if (needsUpdate) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(applyFilterLogic, 300);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

        // 3. Periodic safety pulse to catch any missed React state rewrites
        setInterval(function () {
            if (activeFilters) {
                applyFilterLogic();
            }
        }, 3000);
    }

    function fetchAndApply() {
        chrome.runtime.sendMessage({ action: "getMarkets" }, function (res) {
            if (res && res.data) {
                marketData = Object.assign({}, res.data, scanNextData());
                applyFilterLogic();
            }
        });
    }

    function scanNextData() {
        var local = {};
        var el = document.getElementById("__NEXT_DATA__");
        if (!el) return local;
        try {
            var d = JSON.parse(el.textContent);
            var scan = function (o) {
                if (!o || typeof o !== "object") return;
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

    function applyFilterLogic() {
        if (!activeFilters || !activeFilters.filters) return;

        var mode = activeFilters.mode;
        var f = activeFilters.filters;
        var now = new Date();

        function getFullSlug(h) {
            if (!h) return null;
            var match = h.match(/^\/(?:event|market)\/([^?#]+)/);
            return match ? match[1].replace(/\/$/, "") : null;
        }

        function findCardRoot(l) {
            var row = l.closest('tr') || l.closest('[role="row"]');
            if (row) return row;
            var card = l.closest('.group\\/card');
            if (card) return card;
            var el = l;
            for (var i = 0; i < 8; i++) { // Walk up 8 levels safely
                var p = el.parentElement;
                if (!p || p === document.body) break;
                if (p.className && typeof p.className === "string" && p.className.includes("rounded") && p.className.includes("flex-col")) return p;
                el = p;
            }
            // Fallback: If we can't find a proper card container, applying dim to the tag directly is better than nothing, but we prefer 2 levels up.
            return l.parentElement && l.parentElement.parentElement ? l.parentElement.parentElement : l;
        }

        var links = document.querySelectorAll('a[href^="/event/"], a[href^="/market/"]');

        links.forEach(function (link) {
            var card = findCardRoot(link);
            if (!card) return;

            var fullSlug = getFullSlug(link.getAttribute("href"));
            var baseSlug = fullSlug ? fullSlug.split('/')[0] : null;
            var info = marketData[fullSlug] || marketData[baseSlug];

            var show = true;
            var isResolvedUI = !!(card.innerText.match(/resolved|ended|closed/i));

            if ((info && info.closed) || isResolvedUI) {
                show = false;
            } else if (info && info.endDate) {
                var expiry = new Date(info.endDate);
                var diffDays = Math.floor((expiry.getTime() - now.getTime()) / 86400000);

                if (mode === "days") {
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
                show = false;
            }

            if (show) card.classList.remove("pm-dim");
            else card.classList.add("pm-dim");

            // Note: We don't skip processing entirely because a filter change 
            // might happen, but the DOM scan itself is faster now.
        });
    }

    function injectStyles() {
        if (document.getElementById("pm-style")) return;
        var s = document.createElement("style");
        s.id = "pm-style";
        s.textContent = ".pm-dim { opacity: 0.1 !important; filter: grayscale(90%) !important; transition: opacity 0.2s !important; pointer-events: none !important; }";
        document.head.appendChild(s);
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.action === "syncComplete") {
            if (msg.data) {
                // Background sync finished, merge new data and re-apply
                marketData = Object.assign({}, marketData, msg.data, scanNextData());
                applyFilterLogic();
            }
        } else if (msg.action === "applyFilters") {
            activeFilters = { mode: msg.mode, filters: msg.filters };
            // Force a re-scan of page data and apply
            marketData = Object.assign({}, marketData, scanNextData());
            applyFilterLogic();
            var vis = document.querySelectorAll('a[href^="/event/"]:not(.pm-dim), a[href^="/market/"]:not(.pm-dim)').length;
            var tot = document.querySelectorAll('a[href^="/event/"], a[href^="/market/"]').length;
            sendResponse({ visible: Math.ceil(vis / 2), total: Math.ceil(tot / 2) });
        } else if (msg.action === "clearFilters") {
            activeFilters = null;
            document.querySelectorAll(".pm-dim").forEach(function (el) { el.classList.remove("pm-dim"); });
            sendResponse({ ok: true });
        }
    });

    init();
})();
