// Ads tab — Meta Marketing mock: ROAS hero, audience + angle insights.

import { mockCampaigns, totalsFor, deriveMetrics } from "../data/ads.js";
import { fmtCurrency, fmtNumber, fmtPercent, localDayKey } from "../format.js";
import { renderBars, renderDualLine, renderSpark } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountAds(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Ads <span class="mockbanner">Mock</span></h2>
        <p>Meta Business performance. <span class="muted-inline">Phase 4 wires Meta Marketing API + Conversions API attribution.</span></p>
      </div>
      <div class="segmented" role="group" aria-label="Period">
        ${[7, 30, 90].map((d) => `<button data-period="${d}" aria-pressed="${d === 30}">${d}d</button>`).join("")}
      </div>
    </div>

    <div class="hero" id="adsHero"></div>

    <div class="kpi-grid" id="adKpis"></div>

    <div class="row-2">
      <div class="card">
        <div class="card-head">
          <h3>Spend vs attributed revenue</h3>
          <span class="hint" id="spendHint">—</span>
        </div>
        <div class="card-body">
          <svg class="chart" id="spendChart"></svg>
          <div class="legend">
            <span><span class="dot ink"></span>Ad spend</span>
            <span><span class="dot accent"></span>Attributed revenue</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>ROAS by campaign</h3><span class="hint">Higher is better</span></div>
        <div class="card-body"><svg class="chart" id="roasChart"></svg></div>
      </div>
    </div>

    <div class="insight" id="topInsight"></div>

    <div class="row-2">
      <div class="card">
        <div class="card-head"><h3>Audience leaderboard</h3><span class="hint">Aggregated across campaigns</span></div>
        <div class="card-body flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Audience</th>
                  <th class="num">Spend</th>
                  <th class="num">Revenue</th>
                  <th class="num">ROAS</th>
                  <th class="num">CTR</th>
                  <th class="num">CVR</th>
                </tr>
              </thead>
              <tbody id="audBody"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Angle leaderboard</h3><span class="hint">Creative theme</span></div>
        <div class="card-body flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Angle</th>
                  <th class="num">Spend</th>
                  <th class="num">Revenue</th>
                  <th class="num">ROAS</th>
                  <th class="num">CVR</th>
                </tr>
              </thead>
              <tbody id="angBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Campaigns</h3><span class="hint" id="cmpCount">—</span></div>
      <div class="card-body flush">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Audience</th>
                <th>Angle</th>
                <th class="num">Spend</th>
                <th class="num">Impr.</th>
                <th class="num">Clicks</th>
                <th class="num">CTR</th>
                <th class="num">Conv.</th>
                <th class="num">CPA</th>
                <th class="num">ROAS</th>
              </tr>
            </thead>
            <tbody id="cmpBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  el.querySelector(".segmented").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    period = Number(btn.dataset.period);
    el.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.period === String(period) ? "true" : "false"));
    render();
  });
  render();
  window.addEventListener("resize", debounce(render, 150));
}

function render() {
  const cutoff = Date.now() - period * 86400000;
  const campaigns = mockCampaigns.map((c) => ({
    ...c,
    days: c.days.filter((d) => Date.parse(d.date) >= cutoff),
  }));

  const totals = campaigns.reduce(
    (acc, c) => {
      const t = totalsFor(c);
      acc.spend += t.spend; acc.revenue += t.revenue;
      acc.impressions += t.impressions; acc.clicks += t.clicks; acc.conversions += t.conversions;
      return acc;
    },
    { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 },
  );
  const metrics = deriveMetrics(totals);

  // Hero — blended ROAS with daily ROAS sparkline
  const dayMap = new Map();
  for (const c of campaigns) {
    for (const d of c.days) {
      const k = localDayKey(d.date);
      if (!dayMap.has(k)) dayMap.set(k, { spend: 0, revenue: 0 });
      const slot = dayMap.get(k);
      slot.spend += d.spend; slot.revenue += d.revenue;
    }
  }
  const sortedKeys = [...dayMap.keys()].sort();
  const sparkValues = sortedKeys.map((k) => {
    const v = dayMap.get(k);
    return v.spend > 0 ? v.revenue / v.spend : 0;
  });

  panelEl.querySelector("#adsHero").innerHTML = `
    <div class="eyebrow">Blended ROAS · last ${period} days</div>
    <div class="figure">
      <div class="number">${metrics.roas.toFixed(2)}<span class="muted" style="font-size: 0.55em; margin-left: 4px;">×</span></div>
      <span class="delta">${fmtCurrency(totals.spend)} spent → ${fmtCurrency(totals.revenue)} revenue</span>
    </div>
    <div class="sub">${fmtNumber(totals.conversions)} conversions · ${fmtPercent(metrics.cvr)} CVR · ${fmtPercent(metrics.ctr)} CTR</div>
    <div class="spark-wrap"><svg class="spark" id="adSpark"></svg></div>
  `;
  renderSpark(panelEl.querySelector("#adSpark"), sparkValues);

  // KPI strip
  panelEl.querySelector("#adKpis").innerHTML = [
    kpi("Ad spend", fmtCurrency(totals.spend)),
    kpi("Attributed revenue", fmtCurrency(totals.revenue)),
    kpi("Cost per acquisition", fmtCurrency(metrics.cpa)),
    kpi("Cost per click", fmtCurrency(metrics.cpc)),
  ].join("");

  // Spend vs revenue dual line
  const series = sortedKeys.map((k) => ({ label: k, ...dayMap.get(k) }));
  renderDualLine(panelEl.querySelector("#spendChart"), series, {
    height: 220,
    primaryKey: "spend",
    secondaryKey: "revenue",
  });
  panelEl.querySelector("#spendHint").textContent =
    `${fmtCurrency(totals.spend)} spent · ${fmtCurrency(totals.revenue)} returned`;

  // ROAS by campaign
  const cmpRows = campaigns.map((c) => {
    const t = totalsFor(c);
    const m = deriveMetrics(t);
    return { ...c, ...t, ...m };
  });
  const sortedRoas = [...cmpRows].sort((a, b) => b.roas - a.roas);
  renderBars(
    panelEl.querySelector("#roasChart"),
    sortedRoas.map((c) => ({ label: shortName(c.name), value: +c.roas.toFixed(2) })),
    { height: 220, accent: true, valueFmt: (v) => `${v.toFixed(1)}×`, rotateLabels: true },
  );

  // Insight
  const best = sortedRoas[0];
  const worst = sortedRoas[sortedRoas.length - 1];
  if (best && best.spend > 0) {
    panelEl.querySelector("#topInsight").innerHTML = `
      <div class="ico">★</div>
      <div class="body">
        <strong>${escapeHtml(best.name)}</strong> is your strongest campaign at <strong>${best.roas.toFixed(2)}× ROAS</strong>
        — the <strong>${escapeHtml(best.audience)}</strong> audience with a <strong>${escapeHtml(best.angle)}</strong> angle.
        ${worst && worst.id !== best.id && worst.roas < 1.5
          ? ` Consider reallocating budget away from <strong>${escapeHtml(worst.name)}</strong> (${worst.roas.toFixed(2)}× ROAS).`
          : ""}
      </div>`;
  } else {
    panelEl.querySelector("#topInsight").innerHTML = `<div class="ico">i</div><div class="body">No spend in this window.</div>`;
  }

  // Audience leaderboard
  const audAgg = aggregateBy(cmpRows, "audience");
  panelEl.querySelector("#audBody").innerHTML = audAgg.length
    ? audAgg
        .map(
          (a) => `
        <tr>
          <td class="ink">${escapeHtml(a.key)}</td>
          <td class="num">${fmtCurrency(a.spend)}</td>
          <td class="num">${fmtCurrency(a.revenue)}</td>
          <td class="num"><strong>${a.roas.toFixed(2)}×</strong></td>
          <td class="num">${fmtPercent(a.ctr)}</td>
          <td class="num">${fmtPercent(a.cvr)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="6"><div class="empty">No data.</div></td></tr>`;

  // Angle leaderboard
  const angAgg = aggregateBy(cmpRows, "angle");
  panelEl.querySelector("#angBody").innerHTML = angAgg.length
    ? angAgg
        .map(
          (a) => `
        <tr>
          <td class="ink">${escapeHtml(a.key)}</td>
          <td class="num">${fmtCurrency(a.spend)}</td>
          <td class="num">${fmtCurrency(a.revenue)}</td>
          <td class="num"><strong>${a.roas.toFixed(2)}×</strong></td>
          <td class="num">${fmtPercent(a.cvr)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="5"><div class="empty">No data.</div></td></tr>`;

  // Campaign rows
  panelEl.querySelector("#cmpCount").textContent = `${cmpRows.length} active`;
  panelEl.querySelector("#cmpBody").innerHTML = cmpRows
    .map(
      (c) => `
      <tr>
        <td class="ink">${escapeHtml(c.name)}</td>
        <td class="muted">${escapeHtml(c.audience)}</td>
        <td class="muted">${escapeHtml(c.angle)}</td>
        <td class="num">${fmtCurrency(c.spend)}</td>
        <td class="num">${fmtNumber(c.impressions)}</td>
        <td class="num">${fmtNumber(c.clicks)}</td>
        <td class="num">${fmtPercent(c.ctr)}</td>
        <td class="num">${fmtNumber(c.conversions)}</td>
        <td class="num">${fmtCurrency(c.cpa)}</td>
        <td class="num"><strong>${c.roas.toFixed(2)}×</strong></td>
      </tr>`,
    )
    .join("");
}

function aggregateBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[key])) {
      map.set(r[key], { key: r[key], spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 });
    }
    const slot = map.get(r[key]);
    slot.spend += r.spend; slot.revenue += r.revenue;
    slot.impressions += r.impressions; slot.clicks += r.clicks; slot.conversions += r.conversions;
  }
  return [...map.values()]
    .map((s) => ({ ...s, ...deriveMetrics(s) }))
    .sort((a, b) => b.roas - a.roas);
}

function shortName(name) {
  return name
    .replace(/^Wound Care — /, "")
    .replace(/^Compression — /, "")
    .replace(/^Diabetic Wellness — /, "Diabetic ")
    .replace(/^Lookalike — /, "")
    .replace(/^Retention — /, "Retention ")
    .replace(" Customers", "")
    .replace("Existing", "Existing");
}

function kpi(label, value, foot) {
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="foot">${foot}</span>` : ""}</div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
