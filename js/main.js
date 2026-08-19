// App entry: auth gate, sidebar nav routing, live clock, per-tab mounting.

import { fmtTime, fmtDate, fmtTzAbbrev, getTimeZone } from "./format.js";
import { subscribe, getState, loadInitial, onError, resetCache } from "./state.js";
import * as auth from "./auth.js";
import { initTheme } from "./theme.js";
import { clearCache } from "./data/live.js";
import { mountOverview } from "./tabs/overview.js";
import { mountAmazon } from "./tabs/amazon.js";
import { mountShopify } from "./tabs/shopify.js";
import { mountSeo } from "./tabs/seo.js";
import { mountMeta } from "./tabs/meta.js";
import { mountGoogle } from "./tabs/google.js";
import { mountKeywords } from "./tabs/keywords.js";
import { mountInventory } from "./tabs/inventory.js";
import { mountScan } from "./tabs/scan.js";
import { mountMargins } from "./tabs/margins.js";

const tabs = ["overview", "amazon", "shopify", "seo", "meta", "google", "keywords", "inventory", "scan", "margins"];
const mounts = {
  overview: mountOverview,
  amazon: mountAmazon,
  shopify: mountShopify,
  seo: mountSeo,
  meta: mountMeta,
  google: mountGoogle,
  keywords: mountKeywords,
  inventory: mountInventory,
  scan: mountScan,
  margins: mountMargins,
};

// Old hash links (#sales, #products, #ads) still exist in bookmarks and in
// the team guide, so map them onto their replacements instead of silently
// dropping the user on Overview.
const legacyTabs = { sales: "amazon", products: "amazon", ads: "amazon" };
const mounted = new Set();

// ─── Boot ────────────────────────────────────────────────────────────
// Boot must always complete: if Supabase or auth are slow, we fall through
// to the login screen after a hard timeout so the UI is never stuck.
// Before boot, so a dark-mode user never sees a white flash while auth
// resolves. Reads only localStorage and a media query — nothing to await.
initTheme();

(async function boot() {
  console.info("[boot] start");
  let timedOut = false;
  const timeout = new Promise((resolve) =>
    setTimeout(() => { timedOut = true; resolve(); }, 6000),
  );
  try {
    await Promise.race([auth.init(), timeout]);
  } catch (err) {
    console.error("[boot] auth.init failed:", err);
  }
  if (timedOut) {
    console.warn("[boot] auth init timed out — falling through to login");
  }
  // No password prompt: if there is no session, mint an anonymous one. The
  // password screen stays as a fallback for when anonymous sign-ins are
  // disabled, so a Supabase setting change can never lock the team out.
  if (!auth.isAuthed()) {
    const anon = await auth.signInAnonymously();
    if (!anon.ok) console.warn("[boot] anonymous sign-in unavailable:", anon.error);
  }

  console.info("[boot] authed =", auth.isAuthed());
  if (auth.isAuthed()) {
    try {
      await showApp();
    } catch (err) {
      console.error("[boot] showApp failed:", err);
      showLogin();
    }
  } else {
    showLogin();
  }
  hideBoot();

  auth.onChange(async (session) => {
    if (session) {
      await showApp();
    } else {
      // Signed out — re-establish anonymously rather than prompting.
      mounted.clear();
      resetCache();
      const anon = await auth.signInAnonymously();
      if (anon.ok) await showApp();
      else showLogin();
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
  selectTab(location.hash.slice(1) || "overview");
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
let currentTab = null;

function selectTab(name) {
  if (legacyTabs[name]) name = legacyTabs[name];
  if (!tabs.includes(name)) name = "overview";
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
  currentTab = name;
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

// ─── Auto refresh ────────────────────────────────────────────────────
// The portal rebuilds itself every 30 minutes so a dashboard left open on a
// screen is never quietly stale. Two rules keep it honest:
//
//   1. Only while the tab is visible. Refreshing a background tab burns
//      Supabase reads for a screen nobody is looking at.
//   2. A refresh missed while hidden runs the moment the tab is looked at
//      again, so coming back to it never shows old numbers.
//
// It re-mounts the active tab rather than reloading the page, so scroll
// position and the tab you were on survive. Each tab's resize listener is
// guarded against re-registering for exactly this reason.
const REFRESH_MS = 30 * 60 * 1000;
let lastRefresh = Date.now();
let missedWhileHidden = false;

function stampRefresh() {
  const el = document.getElementById("refreshNote");
  if (!el) return;
  const t = new Date(lastRefresh).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  el.textContent = `Auto-refresh · ${t}`;
  el.title = "Rebuilds every 30 minutes while this tab is visible";
}

function refreshNow() {
  if (!currentTab || !mounts[currentTab]) return;
  clearCache();
  mounted.delete(currentTab);
  mounts[currentTab](document.getElementById(`panel-${currentTab}`));
  mounted.add(currentTab);
  lastRefresh = Date.now();
  missedWhileHidden = false;
  stampRefresh();
  console.info("[refresh]", currentTab);
}

setInterval(() => {
  if (document.visibilityState === "visible") refreshNow();
  else missedWhileHidden = true;
}, REFRESH_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (missedWhileHidden || Date.now() - lastRefresh >= REFRESH_MS) refreshNow();
});

stampRefresh();
