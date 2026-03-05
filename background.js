// background.js — Production-grade background script for PolyLens.
// Handles API pagination and implements a 1-hour local storage cache ("Local DB").

var API_BASE = "https://gamma-api.polymarket.com";
var CACHE_KEY = "polylens_market_cache_v2";
var UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour


// Load initial cache from local storage on startup
function loadCache() {
    return new Promise(function (resolve) {
        chrome.storage.local.get([CACHE_KEY], function (res) {
            resolve(res[CACHE_KEY] || { data: {}, lastUpdate: 0 });
        });
    });
}

// Fetch a single page from the API
function fetchPage(endpoint, offset) {
    var url = API_BASE + endpoint + "?active=true&closed=false&limit=500&offset=" + offset;
    return fetch(url).then(function (r) {
        return r.ok ? r.json() : [];
    }).catch(function () {
        return [];
    });
}

// Fetch all pages for an endpoint
function fetchAllPages(endpoint) {
    var all = [];
    function loop(offset) {
        return fetchPage(endpoint, offset).then(function (data) {
            if (data && data.length > 0) {
                all = all.concat(data);
                if (data.length >= 500) {
                    return loop(offset + 500);
                }
            }
            return all;
        });
    }
    return loop(0);
}

var syncPromise = null;

// Perform a full sync of all events and markets
function performSync() {
    if (syncPromise) return syncPromise;

    console.log("PolyLens BG: Starting full production-grade sync...");

    syncPromise = Promise.all([
        fetchAllPages("/events"),
        fetchAllPages("/markets")
    ]).then(function (results) {
        var raw = {};
        results[0].forEach(function (e) { if (e.slug && (e.endDate || e.resolutionDate)) raw[e.slug] = { endDate: e.endDate || e.resolutionDate, closed: !!(e.closed || e.resolved) }; });
        results[1].forEach(function (m) { if (m.slug && (m.endDate || m.resolutionDate)) raw[m.slug] = { endDate: m.endDate || m.resolutionDate, closed: !!(m.closed || m.resolved) }; });

        var cacheObj = {
            data: raw,
            lastUpdate: Date.now()
        };

        return new Promise(function (resolve) {
            chrome.storage.local.set({ [CACHE_KEY]: cacheObj }, function () {
                syncPromise = null;
                console.log("PolyLens BG: Sync complete. Cached " + Object.keys(raw).length + " markets to local DB.");

                // Broadcast new data to all active tabs
                chrome.tabs.query({ url: ["*://*.polymarket.com/*"] }, function (tabs) {
                    tabs.forEach(function (tab) {
                        try {
                            chrome.tabs.sendMessage(tab.id, { action: "syncComplete", data: raw }).catch(function () { });
                        } catch (e) { }
                    });
                });

                resolve(cacheObj);
            });
        });
    }).catch(function (err) {
        syncPromise = null;
        console.error("PolyLens BG: Sync failed", err);
        throw err;
    });

    return syncPromise;
}

// Get data, syncing only if 1 hour has passed
function getOrSync() {
    return loadCache().then(function (cache) {
        var now = Date.now();
        if (now - cache.lastUpdate > UPDATE_INTERVAL || Object.keys(cache.data).length === 0) {
            return performSync();
        }
        return cache;
    });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === "getMarkets") {
        getOrSync().then(function (cache) {
            sendResponse({ data: cache.data });
        }).catch(function () {
            // Fallback to stale cache if sync fails
            loadCache().then(function (cache) { sendResponse({ data: cache.data }); });
        });
        return true;
    }
    if (msg.action === "getCount") {
        loadCache().then(function (cache) {
            sendResponse({ count: Object.keys(cache.data).length });
        });
        return true;
    }
});

// Pre-warm on startup
getOrSync();
