// Amazon report importer — updates the Amazon column from a Seller Central
// export without any SP-API setup.
//
// Accepts the common inventory reports (tab-delimited .txt/.tsv or .csv):
// "Manage FBA Inventory", "FBA Manage Inventory Archived", "All Listings".
// The parser finds the seller-SKU and quantity columns by header name, so
// column order and extra columns don't matter.
//
// Amazon seller-SKUs that don't match a portal SKU can be assigned once in
// the preview; assignments persist in the amazon_sku_map Supabase table.

import { seedInventory, skuMap } from "./data/inventory.js";
import { splitLine } from "./csv.js";
import { getRow, updateRow } from "./state.js";
import { supabase } from "./supabase.js";
import { fmtNumber } from "./format.js";

const SKU_HEADERS = ["seller-sku", "sku", "seller sku", "merchant_sku", "msku", "seller_sku"];
// Priority order: fulfillable beats raw totals when both exist.
const QTY_HEADERS = [
  "afn-fulfillable-quantity",
  "afn_fulfillable_quantity",
  "quantity available",
  "quantity-available",
  "available",
  "quantity",
];

let overlay = null;
let parsed = []; // { amazonSku, qty, sku|null }
let assignments = new Map(); // amazonSku → portal sku chosen in this preview

export function openAmazonImport() {
  closeModal();
  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Import Amazon report">
      <div class="modal-head">
        <h3>Import Amazon report</h3>
        <button class="btn ghost" id="impClose" type="button">Close</button>
      </div>
      <div class="modal-body" id="impBody">
        <label class="drop-zone" id="impDrop">
          <input type="file" id="impFile" accept=".txt,.tsv,.csv" hidden />
          <b>Drop a Seller Central report here</b> or click to choose a file.
          <span class="hint">Manage FBA Inventory · All Listings · tab-delimited .txt/.tsv or .csv</span>
        </label>
        <p class="hint" style="margin-top:12px;">
          In Seller Central: Reports → Fulfillment by Amazon → Manage FBA Inventory → Download.
          The importer reads the seller-SKU and fulfillable-quantity columns and updates the
          Amazon column here — nothing is sent back to Amazon.
        </p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector("#impClose").addEventListener("click", closeModal);

  const drop = overlay.querySelector("#impDrop");
  const file = overlay.querySelector("#impFile");
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    if (file.files?.[0]) void handleFile(file.files[0]);
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer?.files?.[0]) void handleFile(e.dataTransfer.files[0]);
  });
}

function closeModal() {
  overlay?.remove();
  overlay = null;
  parsed = [];
  assignments = new Map();
}

// ─── Parsing ────────────────────────────────────────────────────────

async function handleFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    renderError(`Couldn't read the file: ${err.message}`);
    return;
  }
  const rows = parseTable(text);
  if (!rows) {
    renderError(
      "Couldn't find seller-SKU and quantity columns in that file. Expected an Amazon " +
      "inventory report (e.g. Manage FBA Inventory) with headers like “sku” and " +
      "“afn-fulfillable-quantity”.",
    );
    return;
  }

  // Merge duplicate seller-SKUs (archived + active exports can repeat rows).
  const bySku = new Map();
  for (const r of rows) bySku.set(r.amazonSku, (bySku.get(r.amazonSku) || 0) + r.qty);

  const map = await loadAmazonSkuMap();
  parsed = [...bySku.entries()].map(([amazonSku, qty]) => ({
    amazonSku,
    qty,
    sku: skuMap.has(amazonSku) ? amazonSku : map.get(amazonSku) ?? null,
  }));
  renderPreview();
}

function parseTable(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim).map((h) => h.trim().toLowerCase());
  const skuIdx = SKU_HEADERS.map((h) => header.indexOf(h)).find((i) => i >= 0);
  const qtyIdx = QTY_HEADERS.map((h) => header.indexOf(h)).find((i) => i >= 0);
  if (skuIdx === undefined || qtyIdx === undefined) return null;

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delim);
    const amazonSku = (cells[skuIdx] || "").trim();
    const qty = Number.parseInt(cells[qtyIdx], 10);
    if (!amazonSku || !Number.isFinite(qty) || qty < 0) continue;
    out.push({ amazonSku, qty });
  }
  return out.length ? out : null;
}

// Minimal delimited-line splitter with double-quote support.
async function loadAmazonSkuMap() {
  const { data, error } = await supabase.from("amazon_sku_map").select("amazon_sku, sku");
  // A missing table (migration 0003 not run yet) just means no saved
  // mappings — exact SKU matches still import fine.
  if (error) return new Map();
  return new Map((data || []).map((r) => [r.amazon_sku, r.sku]));
}

// ─── Preview / apply ────────────────────────────────────────────────

function renderPreview() {
  const matched = parsed.filter((r) => r.sku || assignments.has(r.amazonSku));
  const unmatched = parsed.filter((r) => !r.sku && !assignments.has(r.amazonSku));
  const body = overlay.querySelector("#impBody");

  const options = seedInventory
    .map((r) => `<option value="${r.sku}">${r.sku} — ${esc(r.product)} ${esc(r.variant)}</option>`)
    .join("");

  body.innerHTML = `
    <p class="hint">
      ${fmtNumber(parsed.length)} seller-SKUs found ·
      <b>${fmtNumber(matched.length)}</b> matched ·
      ${fmtNumber(unmatched.length)} need assignment
    </p>
    ${unmatched.length ? `
      <div class="imp-section">
        <h4>Assign unmatched seller-SKUs <span class="hint">(assignments are remembered)</span></h4>
        <div class="table-wrap imp-table">
          <table>
            <thead><tr><th>Amazon seller-SKU</th><th class="num">Report qty</th><th>Portal SKU</th></tr></thead>
            <tbody>
              ${unmatched.map((r) => `
                <tr>
                  <td><span class="sku-cell">${esc(r.amazonSku)}</span></td>
                  <td class="num">${fmtNumber(r.qty)}</td>
                  <td>
                    <select data-amazon-sku="${esc(r.amazonSku)}">
                      <option value="">Skip this SKU</option>
                      ${options}
                    </select>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ""}
    <div class="imp-section">
      <h4>Will update the Amazon column</h4>
      <div class="table-wrap imp-table">
        <table>
          <thead><tr><th>SKU</th><th>Product</th><th class="num">Amazon now</th><th class="num">After import</th></tr></thead>
          <tbody id="impMatchedBody">
            ${matched.map(renderMatchedRow).join("") || `<tr><td colspan="4"><div class="empty">Nothing matched yet.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="impCancel" type="button">Cancel</button>
      <button class="btn primary" id="impApply" type="button" ${matched.length ? "" : "disabled"}>
        Apply to ${fmtNumber(matched.length)} SKU${matched.length === 1 ? "" : "s"}
      </button>
    </div>
  `;

  body.querySelectorAll("select[data-amazon-sku]").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (sel.value) assignments.set(sel.dataset.amazonSku, sel.value);
      else assignments.delete(sel.dataset.amazonSku);
      renderPreview();
    });
  });
  body.querySelector("#impCancel").addEventListener("click", closeModal);
  body.querySelector("#impApply")?.addEventListener("click", applyImport);
}

function renderMatchedRow(r) {
  const sku = r.sku ?? assignments.get(r.amazonSku);
  const meta = skuMap.get(sku);
  const current = getRow(sku)?.amazon ?? 0;
  const changed = current !== r.qty;
  return `
    <tr>
      <td><span class="sku-cell">${esc(sku)}</span></td>
      <td class="ink">${esc(meta.product)} <span class="muted">${esc(meta.variant)}</span></td>
      <td class="num muted">${fmtNumber(current)}</td>
      <td class="num ink"><strong>${fmtNumber(r.qty)}</strong>${changed ? "" : ` <span class="muted">(no change)</span>`}</td>
    </tr>`;
}

async function applyImport() {
  // Persist any new seller-SKU assignments first so next month's import
  // matches automatically.
  if (assignments.size) {
    const rows = [...assignments.entries()].map(([amazon_sku, sku]) => ({ amazon_sku, sku }));
    const { error } = await supabase
      .from("amazon_sku_map")
      .upsert(rows, { onConflict: "amazon_sku" });
    if (error) {
      renderError(`Couldn't save SKU assignments: ${error.message}`);
      return;
    }
  }

  let applied = 0;
  for (const r of parsed) {
    const sku = r.sku ?? assignments.get(r.amazonSku);
    if (!sku) continue;
    updateRow(sku, { amazon: r.qty });
    applied++;
  }

  const body = overlay.querySelector("#impBody");
  body.innerHTML = `
    <div class="imp-done">
      <div class="scan-result ok">
        <div class="scan-result-title">Import applied</div>
        <div class="scan-result-body">
          Amazon quantities updated for ${fmtNumber(applied)} SKU${applied === 1 ? "" : "s"}.
          The Inventory tab reflects the report now.
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="impDone" type="button">Done</button>
      </div>
    </div>`;
  body.querySelector("#impDone").addEventListener("click", closeModal);
}

function renderError(msg) {
  const body = overlay?.querySelector("#impBody");
  if (!body) return;
  const el = document.createElement("p");
  el.className = "login-error";
  el.style.marginTop = "12px";
  el.textContent = msg;
  body.querySelector(".login-error")?.remove();
  body.appendChild(el);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
