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
import { renderDualLine, renderSpark, renderBars, renderLine } from "./charts.js";
import { PLATFORM_LABELS } from "./data/live.js";
import { term, hint } from "./glossary.js";
import { supabase } from "./supabase.js";

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
      // Plain English beats the textbook term. "Fees" covers Amazon's
      // referral and Shopify's payment processing — small here, but omitting
      // them would make this tile disagree with the P&L table below it.
      c.revenue > 0
        ? `profit before ad spend — revenue less COGS, shipping and fees (${fmtPercent(c.pl.contribution / c.revenue)})`
        : "profit before ad spend — revenue less COGS, shipping and fees"),
  },
  {
    id: "pl-breakdown", title: "Profit & loss breakdown", group: "Headline", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const p = c.pl;
      const pct = (v) => (c.revenue > 0 ? fmtPercent(Math.abs(v) / c.revenue) : "—");
      const line = (label, value, { kind = "cost", note = "", strong = false, hintKey = null } = {}) => `
        <tr class="pl-${kind}${strong ? " pl-strong" : ""}">
          <td>${label}${hintKey ? hint(hintKey) : ""}</td>
          <td class="num">${kind === "cost" || value < 0 ? "−" : ""}${fmtCurrency(Math.abs(value))}</td>
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
              ${line("Amazon fees", p.fees, { note: "referral, measured from settlement", hintKey: "FBA" })}
              ${line("Cost of goods", p.cogs, { note: "supplier invoice, per unit sold", hintKey: "COGS" })}
              ${line("Inbound shipping", p.shipping, { note: "freight to warehouse, per unit sold" })}
              ${line("Outbound shipping", p.outbound, { note: "warehouse to customer — per shipment, both channels" })}
              ${line("Payment processing", p.payment, { note: "Shopify Payments; Amazon's is inside its referral fee" })}
              ${line("FBA storage", p.storage, { note: "monthly charge, prorated over the window", hintKey: "FBA" })}
              ${line("Contribution margin", p.contribution, { kind: "in", strong: true, hintKey: "CONTRIBUTION MARGIN" })}
              ${line("Advertising", p.adSpend, { note: c.spendByPlatform.map((x) => x.label).join(", ") || "no spend" })}
              ${line(p.net < 0 ? "Net loss" : "Net profit", p.net, { kind: p.net < 0 ? "neg" : "in", strong: true })}
            </tbody>
          </table>
        </div>
        ${p.unset?.length ? `<div class="insight" style="margin-top:12px;">
          <div class="ico">!</div>
          <div class="body"><strong>No rate on file for ${escapeHtml(p.unset.join(", "))}.</strong>
          Those lines read $0.00 because nothing has been entered, not because they are free —
          so contribution below is higher than reality. Set them on the Margins tab.</div>
        </div>` : ""}
        ${p.uncosted > 0 ? `<div class="insight" style="margin-top:12px;">
          <div class="ico">!</div>
          <div class="body"><strong>${fmtNumber(p.uncosted)} units sold have no cost on file.</strong>
          Their revenue counts here but their COGS and shipping do not, so contribution is overstated.</div>
        </div>` : ""}
        <p class="muted" style="margin:12px 0 0;font-size:12px;">
          Costs are per unit sold, on both channels. Amazon fees are the rates actually charged on
          settled orders, not a published fee schedule — nearly every order here is merchant-fulfilled,
          so it pays referral only and no FBA fulfilment. Outbound postage is a flat per-parcel estimate,
          charged once per shipment rather than per unit, until real Stamps.com figures are loaded. Amazon&rsquo;s own service fees — inbound freight to
          FBA (&minus;$505.42 net) and the monthly subscription (&minus;$79.98) — are period costs, not
          per-unit, and are not in this table; they sit in amz_transactions.
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

  {
    id: "amz-sales-vs-spend", title: "Amazon sales vs ad spend", group: "Amazon", size: "full", spans: [6, 8, 12],
    render: (c, span) => card("Amazon sales vs ad spend", `
      <svg class="chart" data-chart="amzspend"></svg>
      <div class="legend">
        <span><span class="dot ink"></span>Ad spend</span>
        <span><span class="dot accent"></span>Ordered sales</span>
      </div>`, { foot: "hover to inspect any day" }),
    draw: (el, c, span) => {
      const svg = el.querySelector('[data-chart="amzspend"]');
      if (!svg || !c.daily.length) return;
      const s = c.daily.map((d) => ({ ...d, revenue: d.amazon }));
      renderDualLine(svg, s, {
        height: chartHeight(span), primaryKey: "spend", secondaryKey: "revenue",
        axisLabels: [s[0].label, s[Math.floor(s.length / 2)].label, s[s.length - 1].label],
        scrub: { primaryName: "Ad spend", secondaryName: "Ordered sales", fmt: (v) => fmtCurrency(v) },
      });
    },
  },
  {
    id: "amz-sessions-chart", title: "Sessions over time", group: "Amazon", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => card(term("Sessions") + " over time", `
      <svg class="chart" data-chart="amzsess"></svg>`,
      { foot: `${fmtNumber(c.amzT.sessions)} total` }),
    draw: (el, c, span) => {
      const svg = el.querySelector('[data-chart="amzsess"]');
      if (!svg || !c.daily.length) return;
      renderLine(svg, c.daily.map((d) => ({ label: d.label, value: d.sessions })), {
        height: chartHeight(span),
        axisLabels: [c.daily[0].label, c.daily[Math.floor(c.daily.length / 2)].label, c.daily[c.daily.length - 1].label],
        scrub: { name: "Sessions", fmt: (v) => fmtNumber(v) },
      });
    },
  },
  {
    id: "amz-by-day", title: "By day", group: "Amazon", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = [...c.daily].reverse().slice(0, rowsFor(span)).map((d) => `<tr>
        <td class="muted">${escapeHtml(d.label)}${d.partial ? ' <span class="chip">partial</span>' : ""}</td>
        <td class="num">${fmtCurrency(d.amazon)}</td>
        <td class="num">${fmtNumber(d.units)}</td>
        <td class="num w-opt">${fmtNumber(d.sessions)}</td>
        <td class="num w-opt">${d.sessions > 0 ? fmtPercent(d.cvr) : dash}</td>
        <td class="num">${fmtCurrency(d.spend)}</td>
        <td class="num">${d.amazon > 0 ? fmtPercent(d.spend / d.amazon) : dash}</td>
      </tr>`);
      return card("By day", table(
        [{ label: "Date" }, { label: "Revenue", num: true }, { label: "Units", num: true },
         { label: "Sessions", num: true, opt: true, hint: "SESSIONS" },
         { label: "CVR", num: true, opt: true, hint: "CVR" },
         { label: "Ad spend", num: true }, { label: "TACOS", num: true, hint: "TACOS" }],
        rows, { span, empty: "No days in this window." }), { flush: true, foot: "most recent first" });
    },
  },
  {
    id: "amz-product-ads", title: "Products with ad spend", group: "Amazon", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const inv = c.invRows ? new Map(c.invRows.map((r) => [r.sku, r])) : new Map();
      const rows = [...c.bySku].sort((a, b) => b.revenue - a.revenue).slice(0, rowsFor(span)).map((s) => {
        const ad = c.adBySku?.get(s.sku) || { cost: 0, sales: 0, clicks: 0 };
        const cogs = inv.get(s.sku)?.cogs || 0;
        const contribution = s.revenue - cogs * s.units - ad.cost;
        const acos = ad.sales > 0 ? ad.cost / ad.sales : null;
        return `<tr>
          <td><span class="sku-cell">${escapeHtml(s.sku)}</span><div class="muted">${escapeHtml(s.variant || "")}</div></td>
          <td class="num">${fmtNumber(s.units)}</td>
          <td class="num">${fmtCurrency(s.revenue)}</td>
          <td class="num">${ad.cost > 0 ? fmtCurrency(ad.cost) : dash}</td>
          <td class="num w-opt">${acos == null ? dash : `<span class="mpill ${acos <= 0.3 ? "ok" : acos <= 1 ? "watch" : "low"}">${fmtPercent(acos)}</span>`}</td>
          <td class="num">${cogs > 0 ? `<strong>${fmtCurrency(contribution)}</strong>` : dash}</td>
        </tr>`;
      });
      return card("Products with ad spend", `
        ${table([{ label: "SKU" }, { label: "Units", num: true }, { label: "Revenue", num: true },
                 { label: "Ad spend", num: true }, { label: "ACOS", num: true, opt: true, hint: "ACOS" },
                 { label: "Contribution", num: true, hint: "CONTRIBUTION MARGIN" }],
                rows, { span, empty: "No sales in this window." })}
        <p class="muted" style="margin:12px;font-size:12px;">
          Contribution is revenue less COGS and ad spend for that SKU. It is blank where no cost is
          on file rather than assuming zero. Ad spend comes from Amazon's advertised-SKU report — the
          only place spend ties to a product, which is why this view exists for Amazon and nowhere else.
        </p>`, { flush: true, foot: "by revenue" });
    },
  },
  {
    id: "amz-not-selling", title: "Not selling", group: "Amazon", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const sold = new Set(c.bySku.filter((s) => s.units > 0).map((s) => s.sku));
      const idle = (c.invRows || []).filter((r) => r.retail > 0 && !sold.has(r.sku)).slice(0, rowsFor(span));
      const rows = idle.map((r) => `<tr>
        <td><span class="sku-cell">${escapeHtml(r.sku)}</span></td>
        <td class="muted">${escapeHtml(r.variant || r.product)}</td>
        <td class="num w-opt">${fmtNumber(r.total)}</td>
      </tr>`);
      return card("Not selling", table(
        [{ label: "SKU" }, { label: "Product" }, { label: "On hand", num: true, opt: true }],
        rows, { span, empty: "Every stocked SKU sold in this window." }),
        { flush: true, foot: "no orders in window" });
    },
  },
  {
    id: "shop-by-product-chart", title: "Shopify revenue by product", group: "Shopify", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => card("Revenue by product", `<svg class="chart" data-chart="shopprod"></svg>`,
      { foot: "net of refunds" }),
    draw: (el, c, span) => {
      const svg = el.querySelector('[data-chart="shopprod"]');
      const p = (c.byProduct || []).slice(0, 8);
      if (!svg || !p.length) return;
      renderBars(svg, p.map((x) => ({ label: x.product.slice(0, 18), value: x.net })), {
        height: chartHeight(span), valueFmt: (v) => fmtCurrency(v),
      });
    },
  },
  {
    id: "shop-by-day", title: "Shopify by day", group: "Shopify", size: "full", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = [...c.daily].reverse().filter((d) => d.shopify !== 0).slice(0, rowsFor(span)).map((d) => `<tr>
        <td class="muted">${escapeHtml(d.label)}</td>
        <td class="num"><strong>${fmtCurrency(d.shopify)}</strong></td>
      </tr>`);
      return card("Shopify by day", table(
        [{ label: "Date" }, { label: "Net sales", num: true, hint: "NET SALES" }],
        rows, { span, empty: "No storefront sales in this window." }), { flush: true, foot: "most recent first" });
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

  // ── SEO ───────────────────────────────────────────────────────────
  {
    id: "seo-organic", title: "Organic search sessions", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      const t = c.seo?.totals || {};
      const organic = t.search || 0;
      const all = Object.values(t).reduce((a, b) => a + b, 0);
      return kpiHtml(term("Organic sessions", "SESSIONS"), fmtNumber(organic),
        all > 0 ? `${fmtPercent(organic / all)} of ${fmtNumber(all)} sessions` : "no sessions in window");
    },
  },
  {
    id: "seo-by-source", title: "Traffic by source", group: "SEO", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const t = c.seo?.totals || {};
      const all = Object.values(t).reduce((a, b) => a + b, 0);
      const rows = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, rowsFor(span))
        .map(([src, n]) => `<tr>
          <td>${escapeHtml(src)}</td>
          <td class="num">${fmtNumber(n)}</td>
          <td class="num">${all > 0 ? fmtPercent(n / all) : dash}</td>
        </tr>`);
      return card("Traffic by source", table(
        [{ label: "Source" }, { label: "Sessions", num: true }, { label: "Share", num: true, opt: true }],
        rows, { span, empty: "No session data — run the SEO sync." }), { flush: true, foot: "storefront only" });
    },
  },

  {
    id: "seo-sessions", title: "Storefront sessions", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      const days = (c.seo?.daily || []).length;
      const all = Object.values(c.seo?.totals || {}).reduce((a, b) => a + b, 0);
      return kpiHtml(term("Storefront sessions", "SESSIONS"), fmtNumber(all),
        days ? `${fmtNumber(Math.round(all / days))} a day across ${fmtNumber(days)} days` : "no sessions in window");
    },
  },
  {
    id: "seo-direct-share", title: "Direct vs discovered", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      // Direct means the visitor already knew the address — typing it, a
      // bookmark, or a link with no referrer. It is the share that marketing
      // did NOT have to earn, which is why it sits beside organic rather
      // than being folded into a single "traffic" number.
      const t = c.seo?.totals || {};
      const all = Object.values(t).reduce((a, b) => a + b, 0);
      const direct = t.direct || 0;
      return kpiHtml("Direct traffic", all > 0 ? fmtPercent(direct / all) : dash,
        all > 0 ? `${fmtNumber(direct)} of ${fmtNumber(all)} — arrived already knowing the address` : "no sessions in window");
    },
  },
  {
    id: "seo-by-day", title: "Sessions by day", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = [...(c.seo?.daily || [])].reverse().slice(0, rowsFor(span)).map((d) => `<tr>
          <td>${escapeHtml(fmtShortDate(d.date))}</td>
          <td class="num">${fmtNumber(d.total)}</td>
          <td class="num">${fmtNumber(d.search)}</td>
          <td class="num w-opt">${d.total > 0 ? fmtPercent(d.search / d.total) : dash}</td>
        </tr>`);
      return card("Sessions by day", table(
        [{ label: "Day" }, { label: "All", num: true }, { label: "Organic", num: true },
         { label: "Organic share", num: true, opt: true }],
        rows, { span, empty: "No session data — run the SEO sync." }),
        { flush: true, foot: "most recent first" });
    },
  },

  {
    id: "seo-impressions", title: "Search impressions", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      const q = c.search?.queries || [];
      const imp = q.reduce((a, r) => a + r.impressions, 0);
      const clicks = q.reduce((a, r) => a + r.clicks, 0);
      return kpiHtml(term("Search impressions", "IMPRESSIONS"), imp ? fmtNumber(imp) : dash,
        imp > 0
          ? `${fmtNumber(clicks)} clicks · ${fmtPercent(clicks / imp)} CTR`
          : "Search Console not connected");
    },
  },
  {
    id: "seo-position", title: "Average position", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      // Impression-weighted, never a mean of the daily means — one
      // impression at rank 1 must not outweigh a thousand at rank 4.
      const q = c.search?.queries || [];
      const imp = q.reduce((a, r) => a + r.impressions, 0);
      const w = q.reduce((a, r) => a + r.position * r.impressions, 0);
      return kpiHtml(term("Average position", "POSITION"), imp > 0 ? (w / imp).toFixed(1) : dash,
        imp > 0 ? "weighted by impressions · lower is better" : "Search Console not connected");
    },
  },
  {
    id: "seo-top-queries", title: "Top search queries", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = (c.search?.queries || []).slice(0, rowsFor(span)).map((r) => `<tr>
          <td>${escapeHtml(r.query)}</td>
          <td class="num">${fmtNumber(r.clicks)}</td>
          <td class="num">${fmtNumber(r.impressions)}</td>
          <td class="num w-opt">${fmtPercent(r.ctr)}</td>
          <td class="num w-opt">${r.position ? r.position.toFixed(1) : dash}</td>
        </tr>`);
      return card("Top search queries", table(
        [{ label: "Query" }, { label: "Clicks", num: true }, { label: "Impressions", num: true },
         { label: "CTR", num: true, opt: true }, { label: "Position", num: true, opt: true }],
        rows, { span, empty: "Search Console isn't connected — no keyword data yet." }),
        { flush: true, foot: "what people actually typed" });
    },
  },
  {
    id: "seo-top-pages", title: "Top landing pages from search", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = (c.search?.pages || []).slice(0, rowsFor(span)).map((r) => `<tr>
          <td>${escapeHtml(r.page_path)}</td>
          <td class="num">${fmtNumber(r.clicks)}</td>
          <td class="num">${fmtNumber(r.impressions)}</td>
          <td class="num w-opt">${r.position ? r.position.toFixed(1) : dash}</td>
        </tr>`);
      return card("Top landing pages from search", table(
        [{ label: "Path" }, { label: "Clicks", num: true }, { label: "Impressions", num: true },
         { label: "Position", num: true, opt: true }],
        rows, { span, empty: "Search Console isn't connected — no landing page data yet." }),
        { flush: true, foot: "where Google sends people" });
    },
  },
  {
    id: "seo-missed", title: "Seen but not clicked", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      // High impressions, no clicks. These are the queries the store already
      // ranks for and is failing to win — usually a title or meta problem
      // rather than a ranking one, which makes them the cheapest fixes.
      const rows = (c.search?.queries || [])
        .filter((r) => r.impressions >= 10 && r.clicks === 0)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, rowsFor(span))
        .map((r) => `<tr>
          <td>${escapeHtml(r.query)}</td>
          <td class="num">${fmtNumber(r.impressions)}</td>
          <td class="num w-opt">${r.position ? r.position.toFixed(1) : dash}</td>
        </tr>`);
      return card("Seen but not clicked", table(
        [{ label: "Query" }, { label: "Impressions", num: true }, { label: "Position", num: true, opt: true }],
        rows, { span, empty: "Nothing with 10+ impressions and no clicks." }),
        { flush: true, foot: "ranking already — losing the click" });
    },
  },

  {
    id: "ga-organic", title: "Organic sessions (GA4)", group: "SEO", size: "kpi", spans: [3, 4, 6],
    render: (c, span) => {
      const ch = c.ga?.channels || [];
      const all = ch.reduce((a, r) => a + r.sessions, 0);
      // "Organic Search" and "Organic Shopping" are separate GA4 channels but
      // both are unpaid Google surfaces, so both count as earned here.
      const organic = ch.filter((r) => /^Organic (Search|Shopping)$/i.test(r.channel_group))
        .reduce((a, r) => a + r.sessions, 0);
      return kpiHtml(term("Organic sessions (GA4)", "SESSIONS"), all ? fmtNumber(organic) : dash,
        all > 0 ? `${fmtPercent(organic / all)} of ${fmtNumber(all)} GA4 sessions` : "GA4 not synced");
    },
  },
  {
    id: "ga-by-channel", title: "Acquisition channels (GA4)", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = (c.ga?.channels || []).slice(0, rowsFor(span)).map((r) => `<tr>
          <td>${escapeHtml(r.channel_group)}</td>
          <td class="num">${fmtNumber(r.sessions)}</td>
          <td class="num w-opt">${fmtPercent(r.engagementRate)}</td>
          <td class="num">${fmtNumber(Math.round(r.conversions))}</td>
          <td class="num">${r.revenue > 0 ? fmtCurrency(r.revenue) : dash}</td>
        </tr>`);
      return card("Acquisition channels (GA4)", table(
        [{ label: "Channel" }, { label: "Sessions", num: true },
         { label: "Engaged", num: true, opt: true },
         { label: "Conversions", num: true }, { label: "Revenue", num: true }],
        rows, { span, empty: "No GA4 data — run the SEO sync." }),
        { flush: true, foot: "GA4 counts sessions its own way; Shopify's total will differ" });
    },
  },
  {
    id: "ga-landing-pages", title: "Landing pages (GA4)", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => {
      const rows = (c.ga?.pages || []).slice(0, rowsFor(span)).map((r) => `<tr>
          <td>${escapeHtml(r.landing_page)}</td>
          <td class="num">${fmtNumber(r.sessions)}</td>
          <td class="num w-opt">${fmtPercent(r.engagementRate)}</td>
          <td class="num">${r.revenue > 0 ? fmtCurrency(r.revenue) : dash}</td>
        </tr>`);
      return card("Landing pages (GA4)", table(
        [{ label: "Page" }, { label: "Sessions", num: true },
         { label: "Engaged", num: true, opt: true }, { label: "Revenue", num: true }],
        rows, { span, empty: "No GA4 data — run the SEO sync." }),
        { flush: true, foot: "where sessions started" });
    },
  },
  {
    id: "ga-paid-vs-earned", title: "Paid vs earned traffic", group: "SEO", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      // The question ad spend actually raises: how much of the traffic did
      // money buy, and did any of it convert. Paid channels are whatever GA4
      // prefixes with "Paid"; everything else is earned or direct.
      const ch = c.ga?.channels || [];
      const paid = ch.filter((r) => /^Paid /i.test(r.channel_group));
      const earned = ch.filter((r) => !/^Paid /i.test(r.channel_group));
      const sum = (a, f) => a.reduce((n, r) => n + f(r), 0);
      const line = (label, set) => {
        const s = sum(set, (r) => r.sessions);
        const cv = sum(set, (r) => r.conversions);
        const rev = sum(set, (r) => r.revenue);
        return `<tr>
          <td>${label}</td>
          <td class="num">${fmtNumber(s)}</td>
          <td class="num">${fmtNumber(Math.round(cv))}</td>
          <td class="num">${rev > 0 ? fmtCurrency(rev) : dash}</td>
        </tr>`;
      };
      const rows = ch.length ? [line("Paid", paid), line("Earned &amp; direct", earned)] : [];
      return card("Paid vs earned traffic", table(
        [{ label: "" }, { label: "Sessions", num: true },
         { label: "Conversions", num: true }, { label: "Revenue", num: true }],
        rows, { span, empty: "No GA4 data — run the SEO sync." }),
        { flush: true, foot: "GA4 attribution, not Amazon's" });
    },
  },

  {
    id: "seo-trend", title: "Organic search over time", group: "SEO", size: "half", spans: [6, 8, 12],
    render: (c, span) => card("Organic search over time", `
      <svg class="chart" data-chart="seotrend"></svg>
      <div class="legend">
        <span><span class="dot ink"></span>All sessions</span>
        <span><span class="dot accent"></span>Organic search</span>
      </div>`, { foot: `${(c.seo?.daily || []).length} days` }),
    draw: (el, c, span) => {
      const svg = el.querySelector('[data-chart="seotrend"]');
      const d = c.seo?.daily || [];
      if (!svg || !d.length) return;
      const series = d.map((x) => ({
        key: x.date, label: fmtShortDate(x.date), tipLabel: fmtShortDate(x.date),
        spend: x.total, revenue: x.search,
      }));
      renderDualLine(svg, series, {
        height: chartHeight(span), primaryKey: "spend", secondaryKey: "revenue",
        axisLabels: [series[0].label, series[Math.floor(series.length / 2)].label, series[series.length - 1].label],
        scrub: { primaryName: "All sessions", secondaryName: "Organic", fmt: (v) => fmtNumber(v) },
      });
    },
  },

  {
    id: "cost-rates", title: "Cost rates", group: "Margins", size: "half", spans: [4, 6, 8, 12],
    render: (c, span) => {
      const sc = c.storeCosts || {};
      const outbound = (c.invRows || []).find((r) => r.shipToCustomer > 0)?.shipToCustomer || "";
      const f = (label, id, val, note, step = "0.01", prefix = "$") => `
        <tr>
          <td>${label}<div class="muted">${escapeHtml(note)}</div></td>
          <td class="num" style="white-space:nowrap;">
            <span class="muted">${prefix}</span>
            <input type="number" min="0" step="${step}" data-rate="${id}"
                   value="${val === "" ? "" : val}" placeholder="—" style="width:96px;" />
          </td>
        </tr>`;
      return card("Cost rates", `
        ${table([{ label: "Rate" }, { label: "Value", num: true }], [
          f("Outbound shipping", "outbound", outbound, "per unit, warehouse to customer — Shopify only"),
          f("Payment processing", "pct", sc.payment_fee_pct ?? "", "fraction: 0.027 = 2.7%", "0.001", ""),
          f("Payment flat fee", "flat", sc.payment_fee_flat ?? "", "per order"),
          f("FBA storage", "storage", sc.fba_storage_month ?? "", "per month, prorated over the window"),
        ], { span })}
        <div class="card-body" style="display:flex;gap:10px;align-items:center;">
          <button type="button" class="btn primary" data-rate-save>Save rates</button>
          <span class="hint" data-rate-note></span>
        </div>
        <p class="muted" style="margin:0 12px 12px;font-size:12px;">
          Payment processing was read from Shopify's own transaction records and is already correct.
          Outbound shipping is the postage actually billed — it lives in Stamps.com, not in Shopify or
          Amazon, because Shopify only records what the customer was charged. One figure here applies
          to every SKU; set it per SKU later if they diverge.
        </p>`, { flush: true });
    },
    draw: (el) => {
      const btn = el.querySelector("[data-rate-save]");
      const note = el.querySelector("[data-rate-note]");
      if (!btn || btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", async () => {
        const val = (k) => {
          const v = el.querySelector(`[data-rate="${k}"]`)?.value;
          return v === "" || v == null ? null : Number(v);
        };
        btn.disabled = true;
        note.textContent = "Saving…";
        try {
          const patch = {};
          if (val("pct") != null) patch.payment_fee_pct = val("pct");
          if (val("flat") != null) patch.payment_fee_flat = val("flat");
          if (val("storage") != null) patch.fba_storage_month = val("storage");
          if (Object.keys(patch).length) {
            const { error } = await supabase.from("store_costs").update(patch).eq("id", "default");
            if (error) throw error;
          }
          const ob = val("outbound");
          if (ob != null) {
            // One rate across every SKU. Applied here rather than per row
            // because a single parcel rate is the normal case and typing it
            // ten times invites ten different numbers.
            const { data: rows } = await supabase.from("inventory_state").select("sku");
            const { error } = await supabase.from("inventory_state")
              .upsert((rows || []).map((r) => ({ sku: r.sku, ship_to_customer: ob })), { onConflict: "sku" });
            if (error) throw error;
          }
          note.textContent = "Saved — reload to see it in the P&L";
          note.className = "hint";
        } catch (err) {
          note.textContent = `Couldn't save: ${err.message}`;
          note.className = "hint bad";
        } finally {
          btn.disabled = false;
        }
      });
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
