// background.js — Handles the heavy API work to bypass Polymarket CORS restrictions.

var API_EVENTS = "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=1500";
var API_MARKETS = "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1500";

var marketCache = {};
var lastUpdate = 0;
var UPDATE_TIME = 120000; // 2 minutes

function fetchAll() {
    if (Date.now() - lastUpdate < UPDATE_TIME && Object.keys(marketCache).length > 0) {
        return Promise.resolve(marketCache);
    }

    console.log("PolyLens BG: Updating caches...");
    return Promise.all([
        fetch(API_EVENTS).then(function (r) { return r.ok ? r.json() : []; }),
        fetch(API_MARKETS).then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (results) {
        var raw = {};
        results[0].forEach(function (e) { if (e.slug && e.endDate) raw[e.slug] = e.endDate; });
        results[1].forEach(function (m) { if (m.slug && m.endDate) raw[m.slug] = m.endDate; });

        marketCache = raw;
        lastUpdate = Date.now();
        console.log("PolyLens BG: Cached " + Object.keys(marketCache).length + " markets.");
        return marketCache;
    }).catch(function (e) {
        console.warn("PolyLens BG: Fetch error.", e);
        return marketCache; // Return stale cache if fetch fails
    });
}

// Ensure cache at startup
fetchAll();

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === "getMarkets") {
        fetchAll().then(function (data) { sendResponse({ data: data }); });
        return true;
    }
    if (msg.action === "getCount") {
        fetchAll().then(function (data) { sendResponse({ count: Object.keys(marketCache).length }); });
        return true;
    }
});
