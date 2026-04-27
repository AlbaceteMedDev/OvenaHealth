// App entry: sidebar nav routing, live clock, per-tab mounting.
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
    const btn = document.querySelector(`.nav-item[data-tab="${t}"]`);
    const panel = document.getElementById(`panel-${t}`);
    const active = t === name;
    btn?.setAttribute("aria-selected", active ? "true" : "false");
    panel?.classList.toggle("active", active);
  }
  if (!mounted.has(name)) {
    mounts[name](document.getElementById(`panel-${name}`));
    mounted.add(name);
  }
  const desired = `#${name}`;
  if (location.hash !== desired) history.replaceState(null, "", desired);
  // Scroll main back to top on tab change for clarity.
  document.querySelector(".main")?.scrollTo?.({ top: 0 });
  try { window.scrollTo({ top: 0 }); } catch {}
}

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  selectTab(btn.dataset.tab);
});

window.addEventListener("hashchange", () => selectTab(location.hash.slice(1)));

selectTab(location.hash.slice(1) || "inventory");

// Live clock — updates every second in the user's resolved TZ.
function tickClock() {
  const now = new Date();
  document.getElementById("clockTime").textContent = fmtTime(now);
  document.getElementById("clockTz").textContent = fmtTzAbbrev();
  document.getElementById("clockDate").textContent = fmtDate(now);
}
tickClock();
setInterval(tickClock, 1000);

// Saved-at indicator.
function renderSavedAt() {
  const { lastSavedAt } = getState();
  const el = document.getElementById("savedPill");
  if (!lastSavedAt) {
    el.textContent = "Not saved yet";
    el.style.opacity = "0.6";
    return;
  }
  el.textContent = `Saved ${fmtTime(lastSavedAt)}`;
  el.style.opacity = "1";
}
renderSavedAt();
subscribe(renderSavedAt);
