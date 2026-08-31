// Shipping-label import — the postage actually bought, from a carrier
// account's print history.
//
// Outbound shipping used to be estimated as shipments × an average rate, and
// both inputs were wrong: measured over 2026-07-22..08-26 the estimate came
// to $677.60 against $1,860.02 really paid. The rate was less than half, and
// the shipment count was 27% low because one order is not one label — a
// multi-box order buys several and a reship buys another, neither of which
// anything derived from the order table can see.
//
// So postage comes from the postage. See migration 0023.
//
// The export has no Order ID, Store or Cost Code — blank on every row — so a
// label cannot be attributed to an order or split by channel. Day totals are
// the finest honest grain, which is all the P&L needs.

import { supabase } from "./supabase.js";
import { parseLabels } from "./postage-parse.js";
import { fmtCurrency, fmtNumber } from "./format.js";
import { escapeHtml } from "./ui.js";

export { parseLabels };

let overlay = null;
let parsed = [];      // { tracking, date, amount, carrier, service, weight, recipient, refund, excluded }

export function openPostageImport(onDone) {
  closeModal();
  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Import shipping labels">
      <div class="modal-head">
        <h3>Import shipping labels</h3>
        <button class="btn ghost" id="pstClose" type="button">Close</button>
      </div>
      <div class="modal-body" id="pstBody">
        <label class="drop-zone" id="pstDrop">
          <input type="file" id="pstFile" accept=".csv,.txt,.tsv" hidden />
          <b>Drop a print-history export here</b> or click to choose a file.
          <span class="hint">Stamps.com / ShipStation print history · .csv</span>
        </label>
        <p class="hint" style="margin-top:12px;">
          This replaces the estimated outbound shipping in the P&amp;L with the postage you
          actually bought. Labels are keyed on tracking number, so re-importing an
          overlapping export corrects rows rather than double-counting them.
        </p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector("#pstClose").addEventListener("click", closeModal);

  const drop = overlay.querySelector("#pstDrop");
  const file = overlay.querySelector("#pstFile");
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files?.[0]) void handleFile(file.files[0], onDone); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer?.files?.[0]) void handleFile(e.dataTransfer.files[0], onDone);
  });
}

function closeModal() {
  overlay?.remove();
  overlay = null;
  parsed = [];
}

const body = () => overlay?.querySelector("#pstBody");

function renderError(msg) {
  const b = body();
  if (b) b.innerHTML = `<div class="insight"><div class="ico">!</div><div class="body">${escapeHtml(msg)}</div></div>`;
}

async function handleFile(file, onDone) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    renderError(`Couldn't read the file: ${err.message}`);
    return;
  }
  const rows = parseLabels(text);
  if (!rows) {
    renderError(
      "Couldn't find tracking, date and amount columns in that file. Expected a carrier " +
      "print-history export with headers like “Tracking #”, “Date Printed” and “Amount Paid”.",
    );
    return;
  }
  parsed = rows;
  renderPreview(onDone);
}

function renderPreview(onDone) {
  const b = body();
  if (!b) return;

  const counted = parsed.filter((r) => !r.excluded && !/^approved$/i.test(r.refund));
  const excluded = parsed.filter((r) => r.excluded);
  const refunded = parsed.filter((r) => !r.excluded && /^approved$/i.test(r.refund));
  const total = counted.reduce((n, r) => n + r.amount, 0);
  const dates = parsed.map((r) => r.date).sort();

  const byExcluded = new Map();
  for (const r of excluded) {
    const s = byExcluded.get(r.recipient) || { n: 0, amt: 0 };
    s.n += 1; s.amt += r.amount;
    byExcluded.set(r.recipient, s);
  }

  b.innerHTML = `
    <p><strong>${fmtNumber(counted.length)} labels</strong> · ${fmtCurrency(total)}
       · ${escapeHtml(dates[0])} to ${escapeHtml(dates[dates.length - 1])}
       · ${fmtCurrency(counted.length ? total / counted.length : 0)} average</p>
    ${excluded.length ? `<p class="hint">${fmtNumber(excluded.length)} label(s) excluded as another
       business's postage: ${[...byExcluded].map(([n, s]) =>
         `${escapeHtml(n)} (${s.n}, ${fmtCurrency(s.amt)})`).join(", ")}.</p>` : ""}
    ${refunded.length ? `<p class="hint">${fmtNumber(refunded.length)} refunded label(s) not
       counted as cost.</p>` : ""}
    <p class="hint">Re-importing an overlapping export corrects these rows rather than adding them again.</p>
    <div style="margin-top:16px;display:flex;gap:8px;">
      <button class="btn primary" id="pstApply" type="button">Import ${fmtNumber(parsed.length)} labels</button>
      <button class="btn ghost" id="pstCancel" type="button">Cancel</button>
    </div>
    <div id="pstStatus" class="hint" style="margin-top:10px;"></div>`;

  b.querySelector("#pstCancel").addEventListener("click", closeModal);
  b.querySelector("#pstApply").addEventListener("click", () => void apply(onDone));
}

async function apply(onDone) {
  const btn = body()?.querySelector("#pstApply");
  const status = body()?.querySelector("#pstStatus");
  if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }

  // Excluded labels are stored too, with a zeroed amount, so the row exists
  // as a record of a label that was seen and deliberately not charged. That
  // beats dropping it, which would make a re-import look like new data.
  const rows = parsed.map((r) => ({
    tracking: r.tracking,
    date_printed: r.date,
    amount: r.excluded || /^approved$/i.test(r.refund) ? 0 : r.amount,
    carrier: r.carrier || null,
    service: r.service || null,
    weight: r.weight || null,
    recipient: r.recipient || null,
    refund_status: r.excluded ? "excluded shipper" : (r.refund || null),
  }));

  let written = 0;
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase.from("ship_labels").upsert(chunk, { onConflict: "tracking" });
      if (error) throw new Error(error.message);
      written += chunk.length;
      if (status) status.textContent = `${fmtNumber(written)} of ${fmtNumber(rows.length)}…`;
    }
  } catch (err) {
    if (status) {
      status.innerHTML = /ship_labels/.test(err.message)
        ? "The <code>ship_labels</code> table does not exist yet — run migration 0023 in Supabase."
        : escapeHtml(`Import failed: ${err.message}`);
    }
    if (btn) { btn.disabled = false; btn.textContent = "Retry"; }
    return;
  }

  closeModal();
  onDone?.(written);
}
