// Shopify — storefront sales, net of refunds.
//
// Revenue here comes from the Shopify Admin API, not GA4. GA4 fires its
// purchase event at checkout and never hears about a refund, so it reports
// money that was given back. Measured 2026-08-12 it put "Collagen Kit" at
// $823.91 against a Shopify gross of $441.95 and a net of $0.00 — every
// Collagen Kit order had been refunded within days.
//
// Consequently this tab leads with NET and shows gross beside it, and it
// calls out any product whose sales were entirely reversed.

import {
  fetchShopTotals, fetchShopSales, fetchAds, fetchSyncStatus,
  shopTotals, shopByProduct, adTotals, byDay, denseDays, daysAvailable, DATA_START,
} from "../data/live.js";
import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate } from "../format.js";
import { renderLine, renderSpark, renderBars } from "../charts.js";
import {
  escapeHtml, debounce, kpi, periodButtons, wirePeriod, periodLabel, floorNote,
  loadingBox, errorBox, emptyBox,
  syncStateFor, syncBadge, syncLine,
} from "../ui.js";

let panelEl = null;
let period = "all";
let lastRender = null;

const NO_SHOPIFY_HINT =
  "No synced rows yet. Set <code>SHOPIFY_STORE_DOMAIN</code> and <code>SHOPIFY_ADMIN_TOKEN</code> in Vercel, then run <code>/api/sync/shopify?secret=…</code>.";

export function mountShopify(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Shopify <span id="shopBadge"></span></h2>
        <p>Storefront revenue, net of refunds, straight from the Shopify Admin API.</p>
        ${floorNote(DATA_START)}
        <div id="shopSync"></div>
      </div>
      <div class="segmented" role="group" aria-label="Period">${periodButtons(period)}</div>
    </div>
    <div id="shopBody">${loadingBox()}</div>
  `;

  wirePeriod(el, () => period, (v) => { period = v; }, render);
  render();
  window.addEventListener("resize", debounce(() => redraw(), 150));
}

async function render() {
  const body = panelEl.querySelector("#shopBody");
  body.innerHTML = loadingBox();

  const [totalsRes, salesRes, ads, runs] = await Promise.all([
    fetchShopTotals(period),
    fetchShopSales(period),
    fetchAds(period),
    fetchSyncStatus(),
  ]);

  const sync = syncStateFor(runs.rows, "shopify");
  panelEl.querySelector("#shopBadge").innerHTML = sync.state === "off" ? "" : syncBadge(sync);
  panelEl.querySelector("#shopSync").innerHTML =
    sync.state === "off"
      ? `<div class="syncline">Shopify sync has never run.</div>`
      : syncLine(sync, "Shopify sync");

  if (totalsRes.error) {
    body.innerHTML = errorBox(totalsRes.error, "Check that migration 0005 has been run in Supabase.");
    return;
  }
  if (!totalsRes.rows.length) {
    body.innerHTML = emptyBox("No Shopify sales in this window.", NO_SHOPIFY_HINT);
    return;
  }

  const available = daysAvailable();
  const t = shopTotals(totalsRes.rows);
  const products = shopByProduct(salesRes.rows);

  // Off-Amazon ad spend is what drives this storefront, so pair it here.
  const offAmazonSpend = adTotals(ads.rows.filter((r) => r.platform !== "amazon-ads")).cost;
  const tacos = t.net > 0 ? offAmazonSpend / t.net : null;

  const aov = t.orders > 0 ? t.net / t.orders : 0;
  const refundRate = t.gross > 0 ? t.refunds / t.gross : 0;

  const daily = denseDays(
    period,
    byDay(totalsRes.rows, (r) => ({
      net: Number(r.net_sales) || 0,
      gross: Number(r.gross_sales) || 0,
      orders: r.orders || 0,
    })),
    ["net", "gross", "orders"],
  );

  const reversed = products.filter((p) => p.fullyRefunded);

  body.innerHTML = `
    <div class="hero" id="shopHero"></div>
    <div class="kpi-grid" id="shopKpis"></div>

    ${reversed.length ? `
      <div class="insight">
        <div class="ico">!</div>
        <div class="body">
          <strong>${reversed.length} product${reversed.length === 1 ? "" : "s"} had every order refunded</strong>
          in this window — ${reversed.map((p) => escapeHtml(p.product)).join(", ")}.
          They contributed ${fmtCurrency(reversed.reduce((s, p) => s + p.gross, 0))} gross and
          <strong>$0.00 net</strong>. Ranking below is by net, so they sit at the bottom where they belong.
        </div>
      </div>` : ""}

    <div class="row-2">
      <div class="card">
        <div class="card-head">
          <h3>Net revenue</h3>
          <span class="hint">${daily.length ? `${fmtShortDate(daily[0].label)} – ${fmtShortDate(daily[daily.length - 1].label)}` : "—"}</span>
        </div>
        <div class="card-body">
          <svg class="chart" id="shopChart"></svg>
          <div class="legend"><span><span class="dot accent"></span>Daily net revenue</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Revenue by product</h3><span class="hint">Net</span></div>
        <div class="card-body"><svg class="chart" id="shopProdChart"></svg></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Products</h3>
        <span class="hint">${products.length} sold · gross shown for contrast</span>
      </div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th class="num">Net</th>
                <th class="num">Gross</th>
                <th class="num">Refunded</th>
                <th class="num">Units</th>
                <th class="num">Orders</th>
                <th class="num">Avg price</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((p) => `
                <tr>
                  <td class="ink">${escapeHtml(p.product)}${p.variantCount > 1 ? ` <span class="muted">· ${p.variantCount} variants</span>` : ""}</td>
                  <td class="num"><strong class="${p.fullyRefunded ? "val-bad" : ""}">${fmtCurrency(p.net)}</strong></td>
                  <td class="num muted">${fmtCurrency(p.gross)}</td>
                  <td class="num ${p.refunded > 0 ? "val-warn" : ""}">${p.refunded > 0 ? fmtCurrency(p.refunded) : "—"}</td>
                  <td class="num">${fmtNumber(p.netQuantity)}</td>
                  <td class="num">${fmtNumber(p.orders)}</td>
                  <td class="num">${p.netQuantity > 0 ? fmtCurrency(p.net / p.netQuantity) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Daily</h3><span class="hint">Most recent first</span></div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th class="num">Net</th><th class="num">Gross</th><th class="num">Orders</th><th class="num">AOV</th></tr>
            </thead>
            <tbody>
              ${[...daily].reverse().map((d) => `
                <tr>
                  <td class="muted">${fmtShortDate(d.label)}</td>
                  <td class="num"><strong>${fmtCurrency(d.net)}</strong></td>
                  <td class="num muted">${fmtCurrency(d.gross)}</td>
                  <td class="num">${fmtNumber(d.orders)}</td>
                  <td class="num">${d.orders > 0 ? fmtCurrency(d.net / d.orders) : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  panelEl.querySelector("#shopHero").innerHTML = `
    <div class="eyebrow">Net revenue · ${escapeHtml(periodLabel(period, available))}</div>
    <div class="figure">
      <div class="number">${fmtCurrency(t.net)}</div>
      <span class="delta">${fmtCurrency(t.gross)} gross</span>
    </div>
    <div class="sub">${fmtNumber(t.orders)} orders · ${fmtNumber(t.units)} units · ${fmtCurrency(aov)} AOV</div>
    <div class="spark-wrap"><svg class="spark" id="shopSpark"></svg></div>
  `;

  panelEl.querySelector("#shopKpis").innerHTML = [
    kpi("Avg order value", fmtCurrency(aov)),
    kpi("Refunded", fmtCurrency(t.refunds), `${fmtPercent(refundRate)} of gross`, t.refunds > 0 ? "val-warn" : ""),
    kpi("Discounts", fmtCurrency(t.discounts)),
    kpi("Off-Amazon TACOS", tacos == null ? "—" : fmtPercent(tacos), `${fmtCurrency(offAmazonSpend)} Meta + Google spend`),
  ].join("");

  lastRender = { daily, products };
  redraw();
}

function redraw() {
  if (!lastRender || !panelEl?.querySelector("#shopChart")) return;
  const { daily, products } = lastRender;
  if (!daily.length) return;

  renderSpark(panelEl.querySelector("#shopSpark"), daily.map((d) => d.net));
  renderLine(panelEl.querySelector("#shopChart"), daily.map((d) => ({ label: d.label, value: d.net })), {
    height: 220,
    accent: true,
    axisLabels: [
      fmtShortDate(daily[0].label),
      fmtShortDate(daily[Math.floor(daily.length / 2)].label),
      fmtShortDate(daily[daily.length - 1].label),
    ],
  });
  renderBars(
    panelEl.querySelector("#shopProdChart"),
    products.slice(0, 8).map((p) => ({ label: shortName(p.product), value: +p.net.toFixed(2) })),
    { height: 220, accent: true, valueFmt: (v) => fmtCurrency(v, { compact: true }), rotateLabels: true },
  );
}

function shortName(name) {
  return String(name)
    .replace("Medical-Grade ", "")
    .replace("Compression Socks, 20-30 mmHg", "Socks")
    .replace("Hydrocolloid Roll, Cut-to-Size", "Roll")
    .replace("pH-Balanced Compression Garment Cleanser", "Cleanser")
    .replace("Collagen Wound Dressing, FDA 510(k) Cleared", "Dressing")
    .slice(0, 22);
}
