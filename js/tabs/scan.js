// Scan tab — warehouse barcode scanning.
//
// Works with any keyboard-emulating (HID) barcode scanner: the scanner
// "types" the code and presses Enter, so a focused text input is the whole
// integration. Four modes:
//
//   receive  each scan adds units-per-scan to the warehouse count
//   pick     each scan subtracts units-per-scan
//   count    scan, then type the counted shelf total to overwrite
//   learn    pick a SKU, then scan to save that barcode → SKU mapping
//
// Barcode → SKU mappings live in the Supabase `barcodes` table; every
// applied scan is appended to `scan_events`.

import { seedInventory, skuMap } from "../data/inventory.js";
import { getRow, applyScan, subscribe } from "../state.js";
import { supabase } from "../supabase.js";
import { fmtNumber, fmtTime } from "../format.js";

let panelEl = null;
let mode = "receive";
let unitsPerScan = 1;
let barcodeMap = new Map(); // barcode → sku
let barcodesLoaded = false;
let barcodesError = null;
let learnSku = null; // SKU selected as the learn-mode target
let pendingBarcode = null; // unknown barcode awaiting a SKU assignment
let pendingCount = null; // { sku, barcode } awaiting a counted total
let sessionLog = []; // newest first, this browser session only
let refocusTimer = null;

const MODES = [
  { id: "receive", label: "Receive", hint: "+ adds stock" },
  { id: "pick", label: "Pick / Ship", hint: "− removes stock" },
  { id: "count", label: "Count", hint: "sets the shelf total" },
  { id: "learn", label: "Learn barcodes", hint: "map barcode → SKU" },
];

export function mountScan(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Scan</h2>
        <p>Point the warehouse scanner at any product barcode. Scans apply instantly to the Warehouse column.</p>
      </div>
    </div>

    <div class="scan-modes" id="scanModes" role="tablist" aria-label="Scan mode">
      ${MODES.map(
        (m) => `
        <button class="mode-pill${m.id === mode ? " active" : ""}" data-mode="${m.id}" role="tab">
          <span class="mode-label">${m.label}</span>
          <span class="mode-hint">${m.hint}</span>
        </button>`,
      ).join("")}
    </div>

    <div class="scan-grid">
      <div class="card scan-main">
        <div class="card-body">
          <div class="scan-row">
            <input
              type="text"
              id="scanInput"
              class="scan-input"
              placeholder="Waiting for scan…"
              autocomplete="off"
              spellcheck="false"
            />
            <div class="scan-units" id="scanUnits">
              <span class="scan-units-label">Units per scan</span>
              <div class="scan-units-controls">
                <button class="btn ghost" id="unitsMinus" type="button" aria-label="Fewer units per scan">−</button>
                <span class="scan-units-value" id="unitsValue">1</span>
                <button class="btn ghost" id="unitsPlus" type="button" aria-label="More units per scan">+</button>
              </div>
            </div>
          </div>
          <div id="learnPicker" class="learn-picker" hidden>
            <p class="learn-title">1&hairsp;·&hairsp;Choose the SKU, 2&hairsp;·&hairsp;scan its barcode.</p>
            <input type="search" id="learnSearch" placeholder="Search SKU, product, variant…" />
            <div class="learn-list" id="learnList"></div>
          </div>
          <div id="scanFeedback" class="scan-feedback">
            <div class="scan-idle">Ready. The scan box stays focused — just scan.</div>
          </div>
        </div>
      </div>

      <div class="card scan-side">
        <div class="card-head">
          <h3>This session</h3>
          <span class="hint" id="scanLogCount">0 scans</span>
        </div>
        <div class="scan-log" id="scanLog">
          <div class="empty">No scans yet.</div>
        </div>
      </div>
    </div>
  `;

  el.querySelector("#scanModes").addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-pill");
    if (!btn) return;
    setMode(btn.dataset.mode);
  });

  el.querySelector("#unitsMinus").addEventListener("click", () => setUnits(unitsPerScan - 1));
  el.querySelector("#unitsPlus").addEventListener("click", () => setUnits(unitsPerScan + 1));

  const scanInput = el.querySelector("#scanInput");
  scanInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scanInput.value.trim();
    scanInput.value = "";
    if (code) handleCode(code);
  });

  el.querySelector("#learnSearch").addEventListener("input", renderLearnList);

  // HID scanners need the input focused. Whenever focus falls back to the
  // page body while this tab is visible, reclaim it — but never steal focus
  // from another field the user is typing in. (Tab mounts again after
  // sign-out/sign-in, so clear any previous interval first.)
  clearInterval(refocusTimer);
  refocusTimer = setInterval(() => {
    if (!panelEl?.classList.contains("active")) return;
    const active = document.activeElement;
    if (!active || active === document.body) scanInput.focus();
  }, 400);
  el.addEventListener("click", (e) => {
    if (e.target.closest("input, button, select, a")) return;
    scanInput.focus();
  });
  scanInput.focus();

  void loadBarcodes();
  subscribe(() => {
    // Keep the feedback card's quantities fresh if another device edits.
    if (panelEl && sessionLog.length) renderLog();
  });
}

async function loadBarcodes() {
  const { data, error } = await supabase.from("barcodes").select("barcode, sku");
  if (error) {
    barcodesError = error.message;
    showFeedback(
      "error",
      "Barcode table unavailable",
      `Supabase said: “${error.message}”. If this is a fresh setup, run supabase/migrations/0003_warehouse_scanning.sql in the SQL Editor.`,
    );
    return;
  }
  barcodeMap = new Map((data || []).map((r) => [r.barcode, r.sku]));
  barcodesLoaded = true;
  barcodesError = null;
}

// ─── Mode / units ───────────────────────────────────────────────────

function setMode(next) {
  mode = next;
  pendingBarcode = null;
  pendingCount = null;
  panelEl.querySelectorAll(".mode-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  panelEl.querySelector("#scanUnits").style.visibility =
    mode === "receive" || mode === "pick" ? "visible" : "hidden";
  const picker = panelEl.querySelector("#learnPicker");
  picker.hidden = mode !== "learn";
  if (mode === "learn") renderLearnList();
  clearFeedback();
  panelEl.querySelector("#scanInput").focus();
}

function setUnits(n) {
  unitsPerScan = Math.min(999, Math.max(1, n));
  panelEl.querySelector("#unitsValue").textContent = String(unitsPerScan);
  panelEl.querySelector("#scanInput").focus();
}

// ─── Scan handling ──────────────────────────────────────────────────

function handleCode(code) {
  // A counted total can be typed straight into the scan box while a
  // count is pending.
  if (pendingCount && /^\d{1,6}$/.test(code)) {
    commitCount(Number.parseInt(code, 10));
    return;
  }

  if (!barcodesLoaded) {
    if (barcodesError) {
      showFeedback("error", "Barcode table unavailable", "Run migration 0003 in Supabase, then reload.");
    } else {
      showFeedback("warn", "One moment", "Still loading the barcode table — scan again in a second.");
    }
    return;
  }

  if (mode === "learn") {
    if (!learnSku) {
      showFeedback("warn", "Pick a SKU first", "Choose the product below, then scan its barcode.");
      beep(false);
      return;
    }
    void saveMapping(code, learnSku, { announce: true });
    return;
  }

  // Direct SKU entry works too (typed or from a SKU-barcode label).
  const sku = barcodeMap.get(code) || (skuMap.has(code) ? code : null);
  if (!sku) {
    pendingBarcode = code;
    showUnknownBarcode(code);
    beep(false);
    return;
  }

  if (mode === "count") {
    pendingCount = { sku, barcode: code };
    showCountPrompt(sku);
    beep(true);
    return;
  }

  const result = applyScan(sku, mode, unitsPerScan, code);
  if (!result) return;
  logScan(sku, code, mode, result);
  showApplied(sku, mode, result);
  beep(true);
}

function commitCount(counted) {
  const { sku, barcode } = pendingCount;
  pendingCount = null;
  const result = applyScan(sku, "count", counted, barcode);
  if (!result) return;
  logScan(sku, barcode, "count", result);
  showApplied(sku, "count", result);
  beep(true);
}

async function saveMapping(barcode, sku, { announce = false, thenApply = null } = {}) {
  const { error } = await supabase
    .from("barcodes")
    .upsert([{ barcode, sku }], { onConflict: "barcode" });
  if (error) {
    showFeedback("error", "Couldn't save mapping", error.message);
    beep(false);
    return;
  }
  barcodeMap.set(barcode, sku);
  if (announce) {
    const meta = skuMap.get(sku);
    showFeedback(
      "ok",
      "Barcode learned",
      `<b>${esc(barcode)}</b> → ${esc(meta.product)} · ${esc(meta.variant)} <span class="sku-cell">${esc(sku)}</span>. Scan the next product, or pick another SKU.`,
    );
    beep(true);
  }
  if (thenApply) handleCode(barcode);
}

// ─── Feedback rendering ─────────────────────────────────────────────

function showApplied(sku, appliedMode, { before, after, delta }) {
  const meta = skuMap.get(sku);
  const row = getRow(sku);
  const tone = appliedMode === "pick" ? "warn" : "ok";
  const verb =
    appliedMode === "receive" ? "Received" : appliedMode === "pick" ? "Picked" : "Counted";
  const deltaText =
    appliedMode === "count"
      ? `set to ${fmtNumber(after)}`
      : `${delta >= 0 ? "+" : ""}${fmtNumber(delta)}`;
  const lowNote =
    row && after < row.reorderLevel
      ? `<span class="status low" style="margin-left:8px;">Low — below reorder (${fmtNumber(row.reorderLevel)})</span>`
      : "";
  showFeedback(
    tone,
    `${verb} · ${esc(meta.product)}`,
    `${esc(meta.variant)} <span class="sku-cell">${esc(sku)}</span>
     <div class="scan-qty">${fmtNumber(before)} → <b>${fmtNumber(after)}</b> <span class="muted">warehouse units</span> <span class="delta-chip">${deltaText}</span>${lowNote}</div>`,
  );
}

function showCountPrompt(sku) {
  const meta = skuMap.get(sku);
  const row = getRow(sku);
  showFeedback(
    "info",
    `Counting · ${esc(meta.product)}`,
    `${esc(meta.variant)} <span class="sku-cell">${esc(sku)}</span> — currently ${fmtNumber(row.warehouse)}.
     <div class="scan-count-row">
       <input type="number" id="countValue" min="0" placeholder="Counted total" />
       <button class="btn primary" id="countCommit" type="button">Set count</button>
       <button class="btn ghost" id="countCancel" type="button">Cancel</button>
     </div>
     <p class="hint">Type the shelf total and press Enter — in the box above or right here.</p>`,
  );
  const input = panelEl.querySelector("#countValue");
  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value !== "") commitCount(Number.parseInt(input.value, 10));
  });
  panelEl.querySelector("#countCommit").addEventListener("click", () => {
    if (input.value !== "") commitCount(Number.parseInt(input.value, 10));
  });
  panelEl.querySelector("#countCancel").addEventListener("click", () => {
    pendingCount = null;
    clearFeedback();
    panelEl.querySelector("#scanInput").focus();
  });
}

function showUnknownBarcode(code) {
  showFeedback(
    "error",
    "Unknown barcode",
    `<b>${esc(code)}</b> isn't mapped to a SKU yet. Pick the product it belongs to:
     <input type="search" id="assignSearch" placeholder="Search SKU, product, variant…" style="margin-top:10px;" />
     <div class="learn-list" id="assignList"></div>`,
  );
  const search = panelEl.querySelector("#assignSearch");
  const list = panelEl.querySelector("#assignList");
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = skuChoices(q)
      .map(
        (r) => `
        <button class="learn-item" type="button" data-sku="${r.sku}">
          <span class="sku-cell">${r.sku}</span>
          <span class="ink">${esc(r.product)}</span>
          <span class="muted">${esc(r.variant)}</span>
        </button>`,
      )
      .join("") || `<div class="empty">No SKUs match.</div>`;
  };
  search.addEventListener("input", render);
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".learn-item");
    if (!btn) return;
    const code2 = pendingBarcode;
    pendingBarcode = null;
    // Save, then run the original scan so the receive/pick/count applies.
    void saveMapping(code2, btn.dataset.sku, { thenApply: true });
  });
  render();
  search.focus();
}

function showFeedback(tone, title, bodyHtml) {
  const el = panelEl.querySelector("#scanFeedback");
  el.innerHTML = `
    <div class="scan-result ${tone}">
      <div class="scan-result-title">${title}</div>
      <div class="scan-result-body">${bodyHtml}</div>
    </div>`;
  el.classList.remove("flash");
  void el.offsetWidth; // restart the flash animation
  el.classList.add("flash");
}

function clearFeedback() {
  panelEl.querySelector("#scanFeedback").innerHTML =
    `<div class="scan-idle">Ready. The scan box stays focused — just scan.</div>`;
}

// ─── Learn-mode SKU picker ──────────────────────────────────────────

function skuChoices(q) {
  return seedInventory
    .filter(
      (r) =>
        !q ||
        r.sku.toLowerCase().includes(q) ||
        r.product.toLowerCase().includes(q) ||
        r.variant.toLowerCase().includes(q),
    )
    .slice(0, 12);
}

function renderLearnList() {
  const q = panelEl.querySelector("#learnSearch").value.trim().toLowerCase();
  const list = panelEl.querySelector("#learnList");
  list.innerHTML = skuChoices(q)
    .map(
      (r) => `
      <button class="learn-item${r.sku === learnSku ? " selected" : ""}" type="button" data-sku="${r.sku}">
        <span class="sku-cell">${r.sku}</span>
        <span class="ink">${esc(r.product)}</span>
        <span class="muted">${esc(r.variant)}</span>
      </button>`,
    )
    .join("") || `<div class="empty">No SKUs match.</div>`;
  list.querySelectorAll(".learn-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      learnSku = btn.dataset.sku;
      renderLearnList();
      const meta = skuMap.get(learnSku);
      showFeedback(
        "info",
        `Learning · ${esc(meta.product)}`,
        `${esc(meta.variant)} <span class="sku-cell">${esc(learnSku)}</span> — now scan its barcode.`,
      );
      panelEl.querySelector("#scanInput").focus();
    });
  });
}

// ─── Session log ────────────────────────────────────────────────────

function logScan(sku, barcode, appliedMode, result) {
  sessionLog.unshift({
    at: new Date().toISOString(),
    sku,
    barcode,
    mode: appliedMode,
    delta: result.delta,
    after: result.after,
  });
  sessionLog = sessionLog.slice(0, 30);
  renderLog();
}

function renderLog() {
  const el = panelEl.querySelector("#scanLog");
  panelEl.querySelector("#scanLogCount").textContent =
    `${sessionLog.length} scan${sessionLog.length === 1 ? "" : "s"}`;
  if (!sessionLog.length) {
    el.innerHTML = `<div class="empty">No scans yet.</div>`;
    return;
  }
  el.innerHTML = sessionLog
    .map((s) => {
      const meta = skuMap.get(s.sku);
      const deltaText =
        s.mode === "count" ? `= ${fmtNumber(s.after)}` : `${s.delta >= 0 ? "+" : ""}${fmtNumber(s.delta)}`;
      return `
      <div class="scan-log-row">
        <span class="scan-log-time">${fmtTime(s.at)}</span>
        <span class="mode-chip ${s.mode}">${s.mode}</span>
        <span class="scan-log-main">
          <span class="ink">${esc(meta?.product ?? s.sku)}</span>
          <span class="muted">${esc(meta?.variant ?? "")}</span>
        </span>
        <span class="scan-log-delta">${deltaText}</span>
      </div>`;
    })
    .join("");
}

// ─── Beep ───────────────────────────────────────────────────────────
// Audible confirm/deny so warehouse staff don't need to watch the screen.

let audioCtx = null;
function beep(ok) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (ok ? 0.12 : 0.3));
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.12 : 0.3));
  } catch {
    // Audio is a nicety; never let it break scanning.
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
