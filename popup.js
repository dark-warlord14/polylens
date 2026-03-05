// popup.js
// Simplifies communication with the content script.
// Logic moved to content.js for better persistence and reliability.

document.addEventListener("DOMContentLoaded", function () {
    restoreState();
    refreshBadge();
    setupTabs();
    document.getElementById("btn-apply").addEventListener("click", applyFilter);
    document.getElementById("btn-clear").addEventListener("click", clearFilter);
});

var currentMode = "days";

function setupTabs() {
    document.querySelectorAll(".tab").forEach(function (tab) {
        tab.addEventListener("click", function () {
            document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
            tab.classList.add("active");
            currentMode = tab.getAttribute("data-mode");
            document.querySelectorAll(".filter-section").forEach(function (s) { s.classList.remove("visible"); });
            var section = document.getElementById("section-" + currentMode);
            if (section) section.classList.add("visible");
        });
    });
}

function refreshBadge() {
    chrome.runtime.sendMessage({ action: "getCount" }, function (res) {
        if (chrome.runtime.lastError || !res) return;
        var b = document.getElementById("api-badge");
        var t = document.getElementById("api-badge-text");
        if (res.count > 0) {
            b.className = "badge badge-ok";
            t.textContent = res.count + " markets synced";
        }
    });
}

function applyFilter() {
    var filters = buildFilters();
    if (!filters) return;

    // Save to sync storage for persistence across reloads
    var payload = { mode: currentMode, filters: filters };
    chrome.storage.sync.set({ polyFilters: payload }, function () {
        console.log("Filters saved to storage.");
    });

    // Message content script to apply
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "applyFilters",
            mode: currentMode,
            filters: filters
        }, function (response) {
            if (chrome.runtime.lastError) {
                showStatus("Refresh page to activate filter", "error");
                return;
            }
            if (response) {
                showStatus(response.visible + " / " + response.total + " matches", "ok");
            }
        });
    });
}

function clearFilter() {
    ["input-days", "input-date", "input-start", "input-end"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = "";
    });
    chrome.storage.sync.remove("polyFilters");
    hideStatus();

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "clearFilters" });
    });
}

function buildFilters() {
    if (currentMode === "days") {
        var d = document.getElementById("input-days").value;
        if (d === "") return null;
        return { daysToExpiry: parseInt(d, 10) };
    }
    if (currentMode === "date") {
        var dt = document.getElementById("input-date").value;
        if (!dt) return null;
        return { exactDate: dt };
    }
    if (currentMode === "range") {
        var s = document.getElementById("input-start").value;
        var e = document.getElementById("input-end").value;
        if (!s || !e) return null;
        return { rangeStart: s, rangeEnd: e };
    }
    return null;
}

function showStatus(text, type) {
    var b = document.getElementById("status-bar");
    var labels = document.getElementById("status-text");
    var c = document.getElementById("status-counts");
    b.classList.remove("hidden");
    if (type === "error") {
        b.style.background = "#fff1f2";
        b.style.color = "#9f1239";
        labels.textContent = text;
        c.textContent = "";
    } else {
        b.style.background = "#f0fdf4";
        b.style.color = "#166534";
        labels.textContent = "Filter Active: ";
        c.textContent = text;
    }
}

function hideStatus() {
    document.getElementById("status-bar").classList.add("hidden");
}

function restoreState() {
    chrome.storage.sync.get(["polyFilters"], function (res) {
        if (!res.polyFilters) return;
        var s = res.polyFilters;
        currentMode = s.mode || "days";
        document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
        var t = document.querySelector('.tab[data-mode="' + currentMode + '"]');
        if (t) t.classList.add("active");
        document.querySelectorAll(".filter-section").forEach(function (sec) { sec.classList.remove("visible"); });
        var sec = document.getElementById("section-" + currentMode);
        if (sec) sec.classList.add("visible");
        if (s.filters) {
            if (s.filters.daysToExpiry !== undefined) document.getElementById("input-days").value = s.filters.daysToExpiry;
            if (s.filters.exactDate) document.getElementById("input-date").value = s.filters.exactDate;
            if (s.filters.rangeStart) document.getElementById("input-start").value = s.filters.rangeStart;
            if (s.filters.rangeEnd) document.getElementById("input-end").value = s.filters.rangeEnd;
        }
    });
}
