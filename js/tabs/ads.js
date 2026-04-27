// Ads tab — Meta Marketing mock: spend, ROAS, audience + angle insights.

import { mockCampaigns, totalsFor, deriveMetrics } from "../data/ads.js";
import { fmtCurrency, fmtNumber, fmtPercent, localDayKey, todayKey } from "../format.js";
import { renderLine, renderBars } from "../charts.js";

let panelEl = null;
let period = 30;

export function mountAds(el) {
  panelEl = el;
  el.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>Ads</h2>
        <p>Meta Business performance, spend, and which audiences and angles convert.
        <span class="muted">Mock data — Phase 4 wires Meta Marketing API + Conversions API attribution.</span></p>
      </div>
      <div class="controls" style="margin:0;">
        <select id="adsPeriod" aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>
    </div>

    <div class="kpi-grid" id="adKpis"></div>

    <div class="row-2">
      <div class="chart-card">
        <div class="section-head"><div><h4>Spend vs revenue</h4></div><span class="hint" id="spendHint">—</span></div>
        <svg class="chart" id="spendChart"></svg>
        <div class="legend">
          <span><span class="dot ink"></span>Ad spend</span>
          <span><span class="dot accent"></span>Attributed revenue</span>
        </div>
      </div>
      <div class="chart-card">
        <div class="section-head"><h4>ROAS by campaign</h4><span class="hint">Higher is better</span></div>
        <svg class="chart" id="roasChart"></svg>
      </div>
    </div>

    <div class="insight" id="topInsight" style="margin-bottom: 18px;"></div>

    <div class="row-2">
      <div class="card card-pad">
        <div class="section-head"><h3>Audience leaderboard</h3><span class="hint">Aggregated across campaigns</span></div>
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
                <th class="num">CPA</th>
              </tr>
            </thead>
            <tbody id="audBody"></tbody>
          </table>
        </div>
      </div>
      <div class="card card-pad">
        <div class="section-head"><h3>Angle leaderboard</h3><span class="hint">Creative theme</span></div>
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

    <div class="card card-pad">
      <div class="section-head"><h3>Campaigns</h3><span class="hint" id="cmpCount">—</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Audience</th>
              <th>Angle</th>
              <th>Objective</th>
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
  `;

  el.querySelector("#adsPeriod").addEventListener("change", (e) => {
    period = Number(e.target.value);
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
      acc.spend += t.spend;
      acc.revenue += t.revenue;
      acc.impressions += t.impressions;
      acc.clicks += t.clicks;
      acc.conversions += t.conversions;
      return acc;
    },
    { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 },
  );
  const metrics = deriveMetrics(totals);

  panelEl.querySelector("#adKpis").innerHTML = [
    kpi("Ad spend", fmtCurrency(totals.spend)),
    kpi("Attributed revenue", fmtCurrency(totals.revenue)),
    kpi("Blended ROAS", `${metrics.roas.toFixed(2)}×`, totals.spend > 0 ? `${fmtCurrency(totals.spend)} → ${fmtCurrency(totals.revenue)}` : ""),
    kpi("CTR · CVR", `${fmtPercent(metrics.ctr)} · ${fmtPercent(metrics.cvr)}`),
  ].join("");

  // Spend vs revenue trend (combined two-line chart)
  drawSpendVsRevenue(panelEl.querySelector("#spendChart"), campaigns);
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
    { height: 180, accent: true, valueFmt: (v) => `${v.toFixed(1)}×` },
  );

  // Top insight
  const best = sortedRoas[0];
  const worst = sortedRoas[sortedRoas.length - 1];
  if (best && best.spend > 0) {
    panelEl.querySelector("#topInsight").innerHTML = `
      <div class="ico">i</div>
      <div class="body">
        <strong>${escapeHtml(best.name)}</strong> is your strongest campaign at <strong>${best.roas.toFixed(2)}× ROAS</strong>
        — driven by the <strong>${escapeHtml(best.audience)}</strong> audience with a <strong>${escapeHtml(best.angle)}</strong> angle.
        ${worst && worst.id !== best.id && worst.roas < 1.5 ? `Consider reallocating budget away from <strong>${escapeHtml(worst.name)}</strong> (${worst.roas.toFixed(2)}× ROAS).` : ""}
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
          <td>${escapeHtml(a.key)}</td>
          <td class="num">${fmtCurrency(a.spend)}</td>
          <td class="num">${fmtCurrency(a.revenue)}</td>
          <td class="num">${a.roas.toFixed(2)}×</td>
          <td class="num">${fmtPercent(a.ctr)}</td>
          <td class="num">${fmtPercent(a.cvr)}</td>
          <td class="num">${fmtCurrency(a.cpa)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="7"><div class="empty">No data.</div></td></tr>`;

  // Angle leaderboard
  const angAgg = aggregateBy(cmpRows, "angle");
  panelEl.querySelector("#angBody").innerHTML = angAgg.length
    ? angAgg
        .map(
          (a) => `
        <tr>
          <td>${escapeHtml(a.key)}</td>
          <td class="num">${fmtCurrency(a.spend)}</td>
          <td class="num">${fmtCurrency(a.revenue)}</td>
          <td class="num">${a.roas.toFixed(2)}×</td>
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
        <td>${escapeHtml(c.name)}</td>
        <td class="muted">${escapeHtml(c.audience)}</td>
        <td class="muted">${escapeHtml(c.angle)}</td>
        <td><span class="chip">${escapeHtml(c.objective)}</span></td>
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
    slot.spend += r.spend;
    slot.revenue += r.revenue;
    slot.impressions += r.impressions;
    slot.clicks += r.clicks;
    slot.conversions += r.conversions;
  }
  return [...map.values()]
    .map((s) => ({ ...s, ...deriveMetrics(s) }))
    .sort((a, b) => b.roas - a.roas);
}

function drawSpendVsRevenue(svg, campaigns) {
  // Aggregate by local day across all campaigns.
  const dayMap = new Map();
  for (const c of campaigns) {
    for (const d of c.days) {
      const key = localDayKey(d.date);
      if (!dayMap.has(key)) dayMap.set(key, { spend: 0, revenue: 0 });
      const slot = dayMap.get(key);
      slot.spend += d.spend;
      slot.revenue += d.revenue;
    }
  }
  const keys = [...dayMap.keys()].sort();
  if (!keys.length) {
    svg.replaceChildren();
    return;
  }
  const series = keys.map((k) => dayMap.get(k));

  // Custom dual-line render — share scale with normalized max.
  const NS = "http://www.w3.org/2000/svg";
  const width = svg.clientWidth || svg.parentElement.clientWidth || 600;
  const height = 160;
  const pad = { top: 10, right: 8, bottom: 18, left: 8 };
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const max = Math.max(1, ...series.map((s) => Math.max(s.spend, s.revenue)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
  const yFor = (v) => pad.top + innerH * (1 - v / max);

  for (let g = 0; g < 4; g++) {
    const y = pad.top + (innerH / 3) * g;
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", pad.left); ln.setAttribute("x2", width - pad.right);
    ln.setAttribute("y1", y); ln.setAttribute("y2", y);
    ln.setAttribute("class", "grid");
    svg.appendChild(ln);
  }

  const path = (key, cls) => {
    const pts = series.map((s, i) => [pad.left + i * stepX, yFor(s[key])]);
    const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
    const node = document.createElementNS(NS, "path");
    node.setAttribute("d", d);
    node.setAttribute("class", cls);
    svg.appendChild(node);
  };
  path("revenue", "line alt");
  path("spend", "line");
}

function shortName(name) {
  return name
    .replace(/^Wound Care — /, "")
    .replace(/^Compression — /, "")
    .replace(/^Diabetic Wellness — /, "Diabetic ")
    .replace(/^Lookalike — /, "")
    .replace(/^Retention — /, "Retention ")
    .replace(" Customers", "")
    .replace("Existing", "Exist.");
}

function kpi(label, value, foot) {
  return `<div class="kpi"><span class="label">${label}</span><span class="value">${value}</span>${foot ? `<span class="delta">${foot}</span>` : ""}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
