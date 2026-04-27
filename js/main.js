// App entry point: tab routing, live clock, and per-tab mounting.
import { fmtTime, fmtDate, fmtTzAbbrev, getTimeZone } from "./format.js";
import { subscribe, getState } from "./state.js";
import { mountInventory } from "./tabs/inventory.js";
import { mountSales } from "./tabs/sales.js";
import { mountProducts } from "./tabs/products.js";
import { mountAds } from "./tabs/ads.js";
import { mountMargins } from "./tabs/margins.js";

const tabs = ["inventory", "sales", "products", "ads", "margins"];
const mounts = {
  inventory: mountInventory,
  sales: mountSales,
  products: mountProducts,
  ads: mountAds,
  margins: mountMargins,
};
const mounted = new Set();

function selectTab(name) {
  if (!tabs.includes(name)) name = "inventory";
  for (const t of tabs) {
    const btn = document.querySelector(`.tab[data-tab="${t}"]`);
    const panel = document.getElementById(`panel-${t}`);
    const active = t === name;
    btn?.setAttribute("aria-selected", active ? "true" : "false");
    panel?.classList.toggle("active", active);
  }
  if (!mounted.has(name)) {
    mounts[name](document.getElementById(`panel-${name}`));
    mounted.add(name);
  }
  // Hash for shareability + reload-stickiness.
  const desired = `#${name}`;
  if (location.hash !== desired) history.replaceState(null, "", desired);
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  selectTab(btn.dataset.tab);
});

window.addEventListener("hashchange", () => {
  selectTab(location.hash.slice(1));
});

// Boot
const initial = location.hash.slice(1) || "inventory";
selectTab(initial);

// Live clock — updates every second in the user's resolved TZ.
function tickClock() {
  const now = new Date();
  document.getElementById("clockTime").textContent = fmtTime(now);
  document.getElementById("clockMeta").textContent =
    `${fmtDate(now)} · ${fmtTzAbbrev()} (${getTimeZone()})`;
}
tickClock();
setInterval(tickClock, 1000);

// Saved-at indicator.
function renderSavedAt() {
  const { lastSavedAt } = getState();
  const el = document.getElementById("savedPill");
  if (!lastSavedAt) {
    el.textContent = "Not saved yet";
    return;
  }
  el.textContent = `Saved ${fmtTime(lastSavedAt)}`;
}
renderSavedAt();
subscribe(renderSavedAt);
