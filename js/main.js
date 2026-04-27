// App entry: auth gate, sidebar nav routing, live clock, per-tab mounting.

import { fmtTime, fmtDate, fmtTzAbbrev, getTimeZone } from "./format.js";
import { subscribe, getState, loadInitial, onError, resetCache } from "./state.js";
import * as auth from "./auth.js";
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

// ─── Boot ────────────────────────────────────────────────────────────
(async function boot() {
  await auth.init();
  if (auth.isAuthed()) {
    await showApp();
  } else {
    showLogin();
  }
  hideBoot();

  auth.onChange(async (session) => {
    if (session) {
      await showApp();
    } else {
      mounted.clear();
      resetCache();
      showLogin();
    }
  });
})();

function hideBoot() {
  document.getElementById("boot")?.setAttribute("hidden", "");
}

function showLogin() {
  document.getElementById("login")?.removeAttribute("hidden");
  document.getElementById("app")?.setAttribute("hidden", "");
}

async function showApp() {
  document.getElementById("login")?.setAttribute("hidden", "");
  document.getElementById("app")?.removeAttribute("hidden");
  // Pull initial data; tabs read from cache so they render immediately
  // even if Supabase is slow.
  await loadInitial();
  selectTab(location.hash.slice(1) || "inventory");
}

// ─── Login form ──────────────────────────────────────────────────────
const loginForm = document.getElementById("loginForm");
const loginPassword = document.getElementById("loginPassword");
const loginSubmit = document.getElementById("loginSubmit");
const loginError = document.getElementById("loginError");

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  loginError.textContent = "";
  loginSubmit.classList.add("loading");
  loginSubmit.disabled = true;
  const password = loginPassword.value;
  const result = await auth.signInWithPassword(password);
  loginSubmit.classList.remove("loading");
  loginSubmit.disabled = false;
  if (!result.ok) {
    loginError.textContent = result.error;
    loginError.hidden = false;
    loginPassword.select();
  } else {
    loginPassword.value = "";
  }
});

// ─── Tab routing ────────────────────────────────────────────────────
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
  document.querySelector(".main")?.scrollTo?.({ top: 0 });
  try { window.scrollTo({ top: 0 }); } catch {}
}

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  selectTab(btn.dataset.tab);
});

window.addEventListener("hashchange", () => {
  if (auth.isAuthed()) selectTab(location.hash.slice(1));
});

// ─── Logout ─────────────────────────────────────────────────────────
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await auth.signOut();
  // onChange handler swaps to login screen.
});

// ─── Live clock ─────────────────────────────────────────────────────
function tickClock() {
  const t = document.getElementById("clockTime");
  const tz = document.getElementById("clockTz");
  const d = document.getElementById("clockDate");
  if (!t || !tz || !d) return;
  const now = new Date();
  t.textContent = fmtTime(now);
  tz.textContent = fmtTzAbbrev();
  d.textContent = fmtDate(now);
}
tickClock();
setInterval(tickClock, 1000);

// ─── Saved-at indicator ─────────────────────────────────────────────
function renderSavedAt() {
  const el = document.getElementById("savedPill");
  if (!el) return;
  const { lastSavedAt } = getState();
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

// ─── Error toast ────────────────────────────────────────────────────
const toast = document.getElementById("toast");
let toastTimer = null;
onError((msg) => {
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
});
