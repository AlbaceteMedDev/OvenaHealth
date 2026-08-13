// Small presentational helpers shared by the tab modules.

import { fmtDateTime } from "./format.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function kpi(label, value, foot, tone = "") {
  return kpiHtml(escapeHtml(label), value, foot, tone);
}

// Same tile, but the label is inserted as-is. Needed because a label can
// carry a glossary "?" button, and escaping that renders the markup as
// visible text rather than a tooltip.
//
// The label is TRUSTED HTML. Only ever pass literals and glossary output —
// never a product title, SKU, or anything else that came from the database.
export function kpiHtml(labelHtml, value, foot, tone = "") {
  return `
    <div class="kpi">
      <span class="label">${labelHtml}</span>
      <span class="value">${value}</span>
      ${foot ? `<span class="foot ${tone}">${foot}</span>` : ""}
    </div>`;
}

// Windows are short by design: the reporting floor (DATA_START) means there
// is only a few weeks of eligible history, so 30d/90d buttons would be
// three ways of showing the same number. "All" means everything since the
// floor.
export function periodButtons(active, periods = [7, 14, "all"]) {
  return periods
    .map((d) => {
      const label = d === "all" ? "All" : `${d}d`;
      return `<button data-period="${d}" aria-pressed="${d === active}">${label}</button>`;
    })
    .join("");
}

export function wirePeriod(el, get, set, onChange) {
  el.querySelector(".segmented")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    const raw = btn.dataset.period;
    set(raw === "all" ? "all" : Number(raw));
    el.querySelectorAll(".segmented button").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.period === String(get()) ? "true" : "false"),
    );
    onChange();
  });
}

// ─── Granularity ─────────────────────────────────────────────────────
// Day / Week / Month / Year. Options coarser than the available history
// are disabled rather than hidden, so it's obvious why they're unavailable.
export function grainButtons(active, availableDays) {
  const minDays = { day: 0, week: 7, month: 28, year: 365 };
  return `<div class="grain" role="group" aria-label="Granularity">${GRAIN_ORDER.map((g) => {
    const enabled = availableDays >= minDays[g];
    return `<button data-grain="${g}" aria-pressed="${g === active}"${enabled ? "" : " disabled title=\"Not enough history yet\""}>${GRAIN_TEXT[g]}</button>`;
  }).join("")}</div>`;
}

const GRAIN_ORDER = ["day", "week", "month", "year"];
const GRAIN_TEXT = { day: "Day", week: "Week", month: "Month", year: "Year" };

export function wireGrain(el, get, set, onChange) {
  el.querySelector(".grain")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-grain]");
    if (!btn || btn.disabled) return;
    set(btn.dataset.grain);
    el.querySelectorAll(".grain button").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.grain === get() ? "true" : "false"),
    );
    onChange();
  });
}

export function periodLabel(period, available) {
  if (period === "all") return `all ${available} days since relaunch`;
  return period >= available ? `all ${available} days since relaunch` : `last ${period} days`;
}

// Shown once per tab so nobody reads a total as all-time.
export function floorNote(dataStart) {
  return `<span class="floor-note">Excludes everything before ${dataStart} and all Juzo lines.</span>`;
}

export function loadingBox(message = "Loading…") {
  return `<div class="statebox"><span class="spin"></span><span>${escapeHtml(message)}</span></div>`;
}

export function errorBox(message, hint) {
  return `
    <div class="statebox error">
      <strong>Couldn't load data</strong>
      <span class="hint2">${escapeHtml(message)}</span>
      ${hint ? `<span class="hint2">${hint}</span>` : ""}
    </div>`;
}

export function emptyBox(message, hint) {
  return `
    <div class="statebox">
      <strong>${escapeHtml(message)}</strong>
      ${hint ? `<span class="hint2">${hint}</span>` : ""}
    </div>`;
}

// Hint shown when a table is empty because the sync has never run.
export const NO_SYNC_HINT =
  "No synced rows yet. Run <code>/api/sync/catchr?days=90&amp;secret=…</code> once, or wait for the next cron.";

// ─── Sync freshness ──────────────────────────────────────────────────
// A tab is "live" if its job finished cleanly recently, "stale" if the last
// good run is old, "off" if it has never run.

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export function syncStateFor(runs, job) {
  const last = runs.find((r) => r.job === job && r.finished_at);
  if (!last) return { state: "off", label: "Not synced", detail: null };
  const age = Date.now() - Date.parse(last.finished_at);
  if (last.status === "error") {
    return { state: "stale", label: "Sync failing", detail: last, age };
  }
  if (age > STALE_AFTER_MS) {
    return { state: "stale", label: "Stale", detail: last, age };
  }
  return { state: "live", label: "Live", detail: last, age };
}

export function syncBadge(sync) {
  const cls = sync.state === "live" ? "livebadge" : `livebadge ${sync.state}`;
  return `<span class="${cls}">${escapeHtml(sync.label)}</span>`;
}

export function syncLine(sync, jobLabel) {
  if (sync.state === "off") {
    return `<div class="syncline"><span class="warn">${escapeHtml(jobLabel)} has never run.</span> Numbers below will be empty until it does.</div>`;
  }
  const when = fmtDateTime(sync.detail.finished_at);
  if (sync.detail.status === "error") {
    return `<div class="syncline"><span class="warn">Last ${escapeHtml(jobLabel)} run failed</span> at ${when}. Showing the most recent good data.</div>`;
  }
  return `<div class="syncline">${escapeHtml(jobLabel)} last synced ${when}${sync.state === "stale" ? " <span class=\"warn\">(stale)</span>" : ""}.</div>`;
}

// ─── Value tone ──────────────────────────────────────────────────────
// ACOS: lower is better. Thresholds are deliberately conservative for a
// physical product — above 40% you are usually buying unprofitable volume.
export function acosTone(acos) {
  if (acos == null) return "";
  if (acos <= 0.25) return "val-good";
  if (acos <= 0.4) return "val-warn";
  return "val-bad";
}

export function roasTone(roas) {
  if (roas == null) return "";
  if (roas >= 4) return "val-good";
  if (roas >= 2.5) return "val-warn";
  return "val-bad";
}

export function fmtRatio(v, suffix = "×") {
  return v == null ? "—" : `${v.toFixed(2)}${suffix}`;
}
