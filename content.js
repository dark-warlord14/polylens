/**
 * content.js — PolyLens Elite In-Page Filter
 *
 * Runs on all polymarket.com pages (except /portfolio).
 *
 * Responsibilities:
 *   - Receive filter settings (mode: days | date | range) from the popup via messages
 *   - Dim market cards that don't match the active filter (adds .pm-dim class)
 *   - Use MutationObserver to react to React/Next.js DOM updates dynamically
 *   - Scan __NEXT_DATA__ JSON for market expiry dates (handles snake_case end_date)
 *   - Receive market map updates from background via syncComplete message
 *   - Run a 3-second safety pulse to catch any missed DOM mutations
 *
 * Note: Does NOT run on /portfolio to avoid interfering with portfolio UI.
 * Note: __NEXT_DATA__ may use snake_case (end_date) or camelCase (endDate) — both handled.
 */


(function () {
    if (window.__polyLensActive) return;
    if (window.location.pathname.startsWith('/portfolio')) return;
    window.__polyLensActive = true;

    var marketData = {};
    var activeFilters = null;
    var debounceTimer;

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

        // 3. Periodic safety pulse
        setInterval(function () {
            if (activeFilters) {
                applyFilterLogic();
            }
        }, 3000);

        // 4. Storage Listener: Sync changes across tabs
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === "sync" && changes.polyFilters) {
                var s = changes.polyFilters.newValue;
                if (s && s.filters) {
                    activeFilters = s;
                    fetchAndApply();
                } else {
                    activeFilters = null;
                    document.querySelectorAll(".pm-dim").forEach(function (el) { el.classList.remove("pm-dim"); });
                }
            }
        });
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

                // Polymarket __NEXT_DATA__ often uses snake_case end_date/resolution_date
                var endDate = o.end_date || o.resolution_date || o.endDate || o.resolutionDate;
                var isClosed = !!(o.closed || o.resolved);

                if (o.slug && endDate) {
                    local[o.slug] = {
                        endDate: endDate,
                        closed: isClosed
                    };
                }
                Object.values(o).forEach(scan);
            };
            scan(d);
        } catch (e) { }
        return local;
    }

    function applyFilterLogic() {
        if (!activeFilters || !activeFilters.filters) {
            document.querySelectorAll(".pm-dim").forEach(function (el) { el.classList.remove("pm-dim"); });
            return;
        }

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
            var aGroup = l.closest('a.group.cursor-pointer') || l.closest('a.w-full');
            if (aGroup) return aGroup;
            var el = l;
            for (var i = 0; i < 8; i++) {
                var p = el.parentElement;
                if (!p || p === document.body) break;
                var className = (p.className && typeof p.className === "string") ? p.className : "";
                if (className.includes("rounded") && className.includes("flex-col")) return p;
                el = p;
            }
            return l.parentElement && l.parentElement.parentElement ? l.parentElement.parentElement : l;
        }

        var links = document.querySelectorAll('a[href^="/event/"], a[href^="/market/"]');
        var processedRoots = new Set();
        var visibleCount = 0;
        var totalCount = 0;

        links.forEach(function (link) {
            var card = findCardRoot(link);
            if (!card || processedRoots.has(card)) return;
            processedRoots.add(card);
            totalCount++;

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
                // If we don't have data, we might want to hide it to be safe or show it.
                // Polymarket sometimes has complex nested slugs.
                // For now, let's keep it visible if we don't know better, 
                // but if filters are active, maybe we should be stricter.
                show = !activeFilters;
            }

            if (show) {
                card.classList.remove("pm-dim");
                visibleCount++;
            } else {
                card.classList.add("pm-dim");
            }
        });

        return { visible: visibleCount, total: totalCount };
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
                marketData = Object.assign({}, marketData, msg.data, scanNextData());
                applyFilterLogic();
            }
        } else if (msg.action === "applyFilters") {
            activeFilters = { mode: msg.mode, filters: msg.filters };
            marketData = Object.assign({}, marketData, scanNextData());
            var counts = applyFilterLogic();
            sendResponse(counts);
        } else if (msg.action === "clearFilters") {
            activeFilters = null;
            document.querySelectorAll(".pm-dim").forEach(function (el) { el.classList.remove("pm-dim"); });
            sendResponse({ ok: true });
        }
    });

    init();
})();
