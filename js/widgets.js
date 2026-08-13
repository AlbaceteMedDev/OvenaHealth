// Widget catalogue for the editable Overview.
//
// Every widget is a small, self-contained definition:
//
//   id      stable key stored in the saved layout — NEVER rename one, a
//           rename silently drops the widget from every saved dashboard
//   title   shown in the picker and as the widget heading
//   group   picker section
//   size    "kpi" (quarter), "half", or "full"
//   render  (ctx) => html
//   draw    (el, ctx) => void, optional, for anything needing real width
//           (SVG charts) after the node is in the document
//
// ctx is built once per render in tabs/overview.js and handed to every
// widget, so adding a widget costs one entry here and no extra queries.

import { fmtCurrency, fmtNumber, fmtPercent, fmtShortDate, fmtDateTime } from "./format.js";
import { escapeHtml, kpiHtml, acosTone, roasTone, fmtRatio, syncStateFor } from "./ui.js";
import { renderDualLine, renderSpark, renderBars } from "./charts.js";
import { PLATFORM_LABELS } from "./data/live.js";
import { term, hint } from "./glossary.js";

const dash = `<span class="muted">—</span>`;

function card(title, bodyHtml, { foot = "", flush = false, hintKey = null } = {}) {
  return `
    <div class="card">
      <div class="card-head">
        <h3>${title}${hintKey ? hint(hintKey) : ""}</h3>
        ${foot ? `<span class="hint">${foot}</span>` : ""}
      </div>
      <div class="card-body${flush ? " flush" : ""}">${bodyHtml}</div>
    </div>`;
}

// How many rows a table should show at a given span. A quarter-width table
// with 40 rows is a scrollbar, not a widget.
export function rowsFor(span) {
  return span <= 4 ? 5 : span <= 6 ? 8 : span <= 8 ? 14 : 40;
}

// Chart heights scale with width so a full-width chart isn't a letterbox and
// a quarter-width one isn't a square.
export function chartHeight(span) {
  return span <= 4 ? 160 : span <= 6 ? 200 : span <= 8 ? 240 : 300;
}

// Columns flagged `opt` are dropped once the widget is too narrow to carry
// them. Marked on the header AND the cell so the two can never drift.
function table(headers, rows, { empty = "Nothing in this window.", span = 12 } = {}) {
  if (!rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  const drop = span <= 4;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h, i) =>
          `<th class="${h.num ? "num " : ""}${h.opt ? "w-opt" : ""}" data-col="${i}">${h.label}${h.hint ? hint(h.hint) : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
}

// ─── The catalogue ───────────────────────────────────────────────────

export const WIDGETS = [
  // ── Headline ──────────────────────────────────────────────────────
  {
    id: "total-revenue", title: "Total revenue", group: "Headline", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Total revenue"), fmtCurrency(c.revenue),
      `${fmtCurrency(c.amzT.revenue)} Amazon · ${fmtCurrency(c.shopT.net)} Shopify`),
  },
  {
    id: "net-profit", title: "Net profit", group: "Headline", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Net profit", fmtCurrency(c.pl.net),
      c.pl.net < 0 ? "after all costs and ad spend — a loss" : "after all costs and ad spend",
      c.pl.net < 0 ? "bad" : "good"),
  },
  {
    id: "contribution", title: "Contribution margin", group: "Headline", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Contribution", "CONTRIBUTION MARGIN"), fmtCurrency(c.pl.contribution),
      c.revenue > 0 ? `${fmtPercent(c.pl.contribution / c.revenue)} of revenue` : "—"),
  },
  {
    id: "pl-breakdown", title: "Profit & loss breakdown", group: "Headline", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const p = c.pl;
      const pct = (v) => (c.revenue > 0 ? fmtPercent(Math.abs(v) / c.revenue) : "—");
      const line = (label, value, { kind = "cost", note = "", strong = false, hintKey = null } = {}) => `
        <tr class="pl-${kind}${strong ? " pl-strong" : ""}">
          <td>${label}${hintKey ? hint(hintKey) : ""}</td>
          <td class="num">${kind === "cost" ? "−" : ""}${fmtCurrency(Math.abs(value))}</td>
          <td class="num muted">${pct(value)}</td>
          <td class="muted">${escapeHtml(note)}</td>
        </tr>`;
      return card("Where the money goes", `
        <div class="table-wrap">
          <table class="pl-table">
            <thead><tr><th>Line</th><th class="num">Amount</th><th class="num">of revenue</th><th>Basis</th></tr></thead>
            <tbody>
              ${line("Amazon ordered sales", c.amzT.revenue, { kind: "in", note: `${fmtNumber(c.amzT.units)} units`, hintKey: "ORDERED PRODUCT SALES" })}
              ${line("Shopify net sales", c.shopT.net, { kind: "in", note: `${fmtNumber(c.shopT.orders)} orders`, hintKey: "NET SALES" })}
              ${line("Total revenue", c.revenue, { kind: "in", strong: true })}
              ${line("Amazon fees", p.fees, { note: "referral + FBA, per unit sold", hintKey: "FBA" })}
              ${line("Cost of goods", p.cogs, { note: "supplier invoice, per unit sold", hintKey: "COGS" })}
              ${line("Inbound shipping", p.shipping, { note: "freight to warehouse, per unit sold" })}
              ${line("Contribution margin", p.contribution, { kind: "in", strong: true, hintKey: "CONTRIBUTION MARGIN" })}
              ${line("Advertising", p.adSpend, { note: c.spendByPlatform.map((x) => x.label).join(", ") || "no spend" })}
              ${line("Net profit", p.net, { kind: p.net < 0 ? "neg" : "in", strong: true })}
            </tbody>
          </table>
        </div>
        ${p.uncosted > 0 ? `<div class="insight" style="margin-top:12px;">
          <div class="ico">!</div>
          <div class="body"><strong>${fmtNumber(p.uncosted)} units sold have no cost on file.</strong>
          Their revenue counts here but their COGS and shipping do not, so contribution is overstated.</div>
        </div>` : ""}
        <p class="muted" style="margin:12px 0 0;font-size:12px;">
          Costs are applied per unit sold on Amazon. Shopify units are not cost-matched — its net sales
          are included in revenue but its COGS is not deducted, so treat net profit as slightly optimistic.
        </p>
      `, { flush: false });
    },
  },
  {
    id: "revenue-vs-spend", title: "Revenue vs ad spend", group: "Headline", size: "full", spans: [6, 8, 12],
    render: (c, span) => card("Revenue vs ad spend", `
      <svg class="chart" data-chart="revspend"></svg>
      <div class="legend">
        <span><span class="dot ink"></span>Ad spend</span>
        <span><span class="dot accent"></span>Revenue</span>
      </div>`, { foot: "hover to inspect any day" }),
    draw: (el, c, span) => {
      const svg = el.querySelector('[data-chart="revspend"]');
      if (!svg || !c.daily.length) return;
      renderDualLine(svg, c.daily, {
        height: chartHeight(span), primaryKey: "spend", secondaryKey: "revenue",
        axisLabels: [c.daily[0].label, c.daily[Math.floor(c.daily.length / 2)].label, c.daily[c.daily.length - 1].label],
        scrub: {
          primaryName: "Ad spend", secondaryName: "Revenue", fmt: (v) => fmtCurrency(v),
          extra: (d) => [
            { name: "Amazon", value: fmtCurrency(d.amazon) },
            { name: "Shopify", value: fmtCurrency(d.shopify) },
          ],
        },
      });
    },
  },

  // ── Amazon ────────────────────────────────────────────────────────
  {
    id: "amz-revenue", title: "Amazon revenue", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Ordered sales", "ORDERED PRODUCT SALES"), fmtCurrency(c.amzT.revenue),
      `${fmtNumber(c.amzT.units)} units`),
  },
  {
    id: "amz-units", title: "Amazon units", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Units ordered", fmtNumber(c.amzT.units), `${fmtNumber(c.amzT.orderItems)} order items`),
  },
  {
    id: "amz-sessions", title: "Sessions", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Sessions"), fmtNumber(c.amzT.sessions), `${fmtNumber(c.amzT.pageViews)} page views`),
  },
  {
    id: "amz-cvr", title: "Conversion rate", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Conversion", "CVR"),
      c.amzT.sessions > 0 ? fmtPercent(c.amzT.units / c.amzT.sessions) : dash, "units ÷ sessions"),
  },
  {
    id: "amz-aov", title: "Average order value", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("AOV"),
      c.amzT.orderItems > 0 ? fmtCurrency(c.amzT.revenue / c.amzT.orderItems) : dash,
      `${fmtNumber(c.amzT.orderItems)} order items`),
  },
  {
    id: "amz-refunds", title: "Refund rate", group: "Amazon", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Refund rate",
      c.amzT.units > 0 ? fmtPercent(c.amzT.refunds / c.amzT.units) : dash,
      `${fmtNumber(c.amzT.refunds)} units returned`),
  },
  {
    id: "amz-top-skus", title: "Top SKUs by revenue", group: "Amazon", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const rows = [...c.bySku].sort((a, b) => b.revenue - a.revenue).filter((s) => s.units > 0).slice(0, rowsFor(span))
        .map((s) => `<tr>
          <td><span class="sku-cell">${escapeHtml(s.sku)}</span><div class="muted">${escapeHtml(s.variant || s.product)}</div></td>
          <td class="num">${fmtNumber(s.units)}</td>
          <td class="num"><strong>${fmtCurrency(s.revenue)}</strong></td>
          <td class="num">${s.sessions > 0 ? fmtPercent(s.cvr) : dash}</td>
        </tr>`);
      return card("Top SKUs", table(
        [{ label: "SKU" }, { label: "Units", num: true }, { label: "Revenue", num: true }, { label: "CVR", num: true, hint: "CVR", opt: true }],
        rows, { span, empty: "No units sold in this window." }), { flush: true, foot: "by revenue" });
    },
  },
  {
    id: "amz-sales-log", title: "What sold, and when", group: "Amazon", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = c.salesLog.slice(0, rowsFor(span)).map((r) => `<tr>
        <td class="muted">${escapeHtml(fmtShortDate(r.date))}</td>
        <td><span class="sku-cell">${escapeHtml(r.sku)}</span></td>
        <td>${escapeHtml(r.product)}<div class="muted">${escapeHtml(r.variant)}</div></td>
        <td class="num">${fmtNumber(r.units)}</td>
        <td class="num">${fmtNumber(r.orderItems)}</td>
        <td class="num">${fmtCurrency(r.revenue)}</td>
        <td>${r.drivers.length
          ? r.drivers.map((d) => `<span class="chip">${escapeHtml(d.campaign)} · ${fmtCurrency(d.sales)}</span>`).join(" ")
          : `<span class="muted">no ${escapeHtml(String(r.category || "matching").toLowerCase())} campaign earned sales that day</span>`}</td>
      </tr>`);
      return card("What sold, and when", `
        ${table([{ label: "Date" }, { label: "SKU" }, { label: "Product", opt: true },
                 { label: "Units", num: true },
                 { label: "Orders", num: true, hint: "ORDER ITEMS" },
                 { label: "Revenue", num: true }, { label: "What drove it" }],
                rows, { span, empty: "No sales in this window." })}
        <p class="muted" style="margin:12px;font-size:12px;">
          <strong>Orders</strong> is order lines, not unique customers — Amazon's Sales &amp; Traffic
          report carries no customer identifier, so one person buying twice counts twice.
          It is also <strong>daily</strong>, with no order timestamps, so a date is the finest time
          resolution this data supports.<br>
          <strong>What drove it</strong> only lists campaigns targeting <em>this product's own line</em>
          that earned attributed sales that day — a hydrocolloid campaign can never appear against a
          sock. Within a line it is still same-day correlation, not per-order attribution: Amazon
          credits the campaign, and two sock campaigns running together can't be told apart here.
          Per-SKU certainty needs <code>ads_sku_daily</code>, which has no rows yet.
        </p>`, { flush: true, foot: `${c.salesLog.length} SKU-days` });
    },
  },

  // ── Shopify ───────────────────────────────────────────────────────
  {
    id: "shop-net", title: "Shopify net sales", group: "Shopify", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("Shopify net", "NET SALES"), fmtCurrency(c.shopT.net),
      `${fmtCurrency(c.shopT.gross)} gross`),
  },
  {
    id: "shop-orders", title: "Shopify orders", group: "Shopify", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Shopify orders", fmtNumber(c.shopT.orders), `${fmtNumber(c.shopT.units)} units`),
  },
  {
    id: "shop-refunds", title: "Shopify refunds", group: "Shopify", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Refunded", c.shopT.refunds > 0 ? fmtCurrency(c.shopT.refunds) : "$0.00",
      c.shopT.refunds > 0 ? "reversed after the sale" : "no refunds", c.shopT.refunds > 0 ? "bad" : ""),
  },
  {
    id: "shop-top-products", title: "Top Shopify products", group: "Shopify", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const rows = c.byProduct.slice(0, rowsFor(span)).map((p) => `<tr>
        <td>${escapeHtml(p.product)}${p.fullyRefunded ? ' <span class="chip">all refunded</span>' : ""}</td>
        <td class="num">${fmtNumber(p.orders)}</td>
        <td class="num"><strong>${fmtCurrency(p.net)}</strong></td>
      </tr>`);
      return card("Top Shopify products", table(
        [{ label: "Product" }, { label: "Orders", num: true }, { label: "Net", num: true, hint: "NET SALES" }],
        rows, { span, empty: "No storefront orders in this window." }), { flush: true, foot: "by net of refunds" });
    },
  },

  // ── Advertising ───────────────────────────────────────────────────
  {
    id: "ad-spend", title: "Ad spend", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Ad spend", fmtCurrency(c.adT.cost),
      `${fmtNumber(c.adT.clicks)} clicks · ${fmtNumber(c.adT.impressions)} impressions`),
  },
  {
    id: "ad-acos", title: "ACOS", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("ACOS"), c.adM.acos == null ? dash : fmtPercent(c.adM.acos),
      c.adM.roas == null ? "no attributed sales" : `${fmtRatio(c.adM.roas)} ROAS`, acosTone(c.adM.acos)),
  },
  {
    id: "ad-tacos", title: "TACOS", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("TACOS"),
      c.revenue > 0 ? fmtPercent(c.adT.cost / c.revenue) : dash, "ad spend ÷ total revenue"),
  },
  {
    id: "ad-roas", title: "ROAS", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("ROAS"), c.adM.roas == null ? dash : fmtRatio(c.adM.roas),
      `${fmtCurrency(c.adT.sales)} attributed`, roasTone(c.adM.roas)),
  },
  {
    id: "ad-ctr", title: "CTR", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("CTR"), fmtPercent(c.adM.ctr), `${fmtCurrency(c.adM.cpc)} CPC`),
  },
  {
    id: "ad-cpa", title: "Cost per acquisition", group: "Advertising", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("CPA"), c.adM.cpa == null ? dash : fmtCurrency(c.adM.cpa),
      `${fmtNumber(c.adT.orders)} attributed orders`),
  },
  {
    id: "ad-by-platform", title: "Spend by platform", group: "Advertising", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const rows = c.spendByPlatform.map((p) => `<tr>
        <td>${escapeHtml(p.label)}</td>
        <td class="num">${fmtCurrency(p.cost)}</td>
        <td class="num">${fmtCurrency(p.sales)}</td>
        <td class="num">${p.cost > 0 && p.sales > 0 ? fmtPercent(p.cost / p.sales) : dash}</td>
      </tr>`);
      return card("Spend by platform", table(
        [{ label: "Platform" }, { label: "Spend", num: true }, { label: "Attributed", num: true }, { label: "ACOS", num: true, hint: "ACOS" }],
        rows, { span, empty: "No ad rows synced." }), { flush: true });
    },
  },
  {
    id: "ad-attribution", title: "What campaigns drove sales", group: "Advertising", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = c.campaigns.slice(0, rowsFor(span)).map((r) => `<tr>
        <td>${escapeHtml(r.campaign)}<div class="muted">${escapeHtml(PLATFORM_LABELS[r.platform] || r.platform)}</div></td>
        <td class="num">${fmtCurrency(r.cost)}</td>
        <td class="num">${fmtCurrency(r.sales)}</td>
        <td class="num">${fmtNumber(r.orders)}</td>
        <td class="num">${r.sales > 0 ? fmtPercent(r.cost / r.sales) : dash}</td>
        <td class="num">${fmtNumber(r.clicks)}</td>
      </tr>`);
      return card("What campaigns drove sales", table(
        [{ label: "Campaign" }, { label: "Spend", num: true }, { label: "Attributed sales", num: true },
         { label: "Orders", num: true }, { label: "ACOS", num: true, hint: "ACOS" }, { label: "Clicks", num: true, opt: true }],
        rows, { span, empty: "No campaign data in this window." }), { flush: true, foot: "by spend" });
    },
  },

  // ── Inventory ─────────────────────────────────────────────────────
  {
    id: "inv-at-cost", title: "Inventory at cost", group: "Inventory", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Inventory at cost", fmtCurrency(c.invT.atCost),
      `${fmtNumber(c.invT.units)} units on hand`),
  },
  {
    id: "inv-oos", title: "Out of stock", group: "Inventory", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Out of stock", fmtNumber(c.invT.oos),
      `of ${fmtNumber(c.invT.tracked)} tracked SKUs`, c.invT.oos > 0 ? "bad" : "good"),
  },
  {
    id: "inv-fba-units", title: "Units in FBA", group: "Inventory", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml(term("FBA") + " units", fmtNumber(c.invT.fba),
      `${fmtNumber(c.invT.warehouse)} in warehouse`),
  },
  {
    id: "inv-low-stock", title: "Low stock", group: "Inventory", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const rows = c.invRows.filter((r) => r.reorderLevel > 0 && r.total <= r.reorderLevel)
        .sort((a, b) => a.total - b.total).slice(0, rowsFor(span))
        .map((r) => `<tr>
          <td><span class="sku-cell">${escapeHtml(r.sku)}</span><div class="muted">${escapeHtml(r.variant)}</div></td>
          <td class="num">${fmtNumber(r.total)}</td>
          <td class="num muted">${fmtNumber(r.reorderLevel)}</td>
          <td><span class="chip">${r.total === 0 ? "out" : "low"}</span></td>
        </tr>`);
      return card("Low stock", table(
        [{ label: "SKU" }, { label: "On hand", num: true }, { label: "Reorder at", num: true, opt: true }, { label: "" }],
        rows, { span, empty: "Nothing below its reorder level." }), { flush: true });
    },
  },

  // ── Margins ───────────────────────────────────────────────────────
  {
    id: "margin-blended", title: "Blended net margin", group: "Margins", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Blended net margin",
      c.revenue > 0 ? fmtPercent(c.pl.contribution / c.revenue) : dash,
      "after fees, COGS and shipping"),
  },
  {
    id: "margin-by-sku", title: "Margin by SKU", group: "Margins", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const rows = c.invRows.filter((r) => r.cogs > 0 && r.retail > 0)
        .map((r) => ({ ...r, net: r.retail - r.cogs - r.amazonFee - r.shipCost }))
        .sort((a, b) => b.net / b.retail - a.net / a.retail).slice(0, rowsFor(span))
        .map((r) => `<tr>
          <td><span class="sku-cell">${escapeHtml(r.sku)}</span></td>
          <td class="num">${fmtCurrency(r.retail)}</td>
          <td class="num">${fmtCurrency(r.cogs + r.shipCost + r.amazonFee)}</td>
          <td class="num"><strong>${fmtPercent(r.net / r.retail)}</strong></td>
        </tr>`);
      return card("Margin by SKU", table(
        [{ label: "SKU" }, { label: "Retail", num: true }, { label: "All-in cost", num: true }, { label: "Net", num: true }],
        rows, { span, empty: "No SKU has a cost on file." }), { flush: true, foot: "net of fees, COGS, shipping" });
    },
  },

  // ── Operations ────────────────────────────────────────────────────
  {
    id: "sync-status", title: "Sync status", group: "Operations", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const jobs = ["catchr", "shopify", "fba"];
      const rows = jobs.map((j) => {
        const s = syncStateFor(c.runs.rows, j);
        const run = (c.runs.rows || []).find((r) => r.job === j);
        return `<tr>
          <td>${escapeHtml(j)}</td>
          <td>${run ? escapeHtml(run.status) : `<span class="muted">never run</span>`}</td>
          <td class="num">${run && run.rows_written != null ? fmtNumber(run.rows_written) : dash}</td>
          <td class="muted">${run?.started_at ? escapeHtml(fmtDateTime(run.started_at)) : "—"}</td>
        </tr>`;
      });
      return card("Sync status", table(
        [{ label: "Job" }, { label: "Status" }, { label: "Rows", num: true, opt: true }, { label: "Last run", opt: true }],
        rows, { span }), { flush: true });
    },
  },
  {
    id: "data-window", title: "Data window", group: "Operations", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => kpiHtml("Days of data", fmtNumber(c.daily.length),
      c.daily.length ? `${c.daily[0].label} – ${c.daily[c.daily.length - 1].label}` : "no data"),
  },
];

export const WIDGET_MAP = new Map(WIDGETS.map((w) => [w.id, w]));

export const GROUPS = [...new Set(WIDGETS.map((w) => w.group))];

// What a brand-new dashboard shows. Deliberately close to the old fixed
// Overview so nobody loses the page they knew, plus the cost breakdown.
export const DEFAULT_LAYOUT = [
  "total-revenue", "contribution", "net-profit", "ad-tacos",
  "pl-breakdown",
  "revenue-vs-spend",
  "amz-sales-log",
  "ad-attribution",
  "amz-top-skus", "shop-top-products",
  "inv-low-stock", "sync-status",
];
