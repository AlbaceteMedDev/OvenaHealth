// SVG chart helpers. Use the gradient defs declared in index.html
// (#area-grad, #area-grad-alt, #spark-grad).

const NS = "http://www.w3.org/2000/svg";

export function renderLine(svg, series, opts = {}) {
  const {
    height = 200,
    yMin = 0,
    accent = false,
    fillArea = true,
    pad = { top: 14, right: 12, bottom: 22, left: 12 },
    showAxisLabels = true,
    axisLabels = null, // optional [leftLabel, midLabel, rightLabel]
  } = opts;

  const width = svg.clientWidth || svg.parentElement?.clientWidth || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.replaceChildren();
  if (!series.length) return;

  const max = Math.max(yMin + 1, ...series.map((p) => p.value));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

  const points = series.map((p, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + innerH * (1 - p.value / max);
    return [x, y];
  });

  // Faint horizontal gridlines (4 bands).
  for (let g = 0; g <= 3; g++) {
    const y = pad.top + (innerH / 3) * g;
    svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "grid" }));
  }

  const d = smoothPath(points);

  if (fillArea) {
    const last = points[points.length - 1];
    const first = points[0];
    const areaD = `${d} L${last[0]},${pad.top + innerH} L${first[0]},${pad.top + innerH} Z`;
    svg.appendChild(el("path", { d: areaD, class: `area${accent ? " alt" : ""}` }));
  }

  svg.appendChild(el("path", { d, class: `line${accent ? " alt" : ""}` }));

  if (showAxisLabels) {
    const labels = axisLabels || [series[0].label, series[Math.floor(series.length / 2)]?.label, series[series.length - 1].label];
    const positions = [pad.left, pad.left + innerW / 2, width - pad.right];
    const anchors = ["start", "middle", "end"];
    labels.forEach((lbl, i) => {
      if (!lbl) return;
      const t = el("text", { x: positions[i], y: height - 6, "text-anchor": anchors[i] });
      t.textContent = lbl;
      svg.appendChild(t);
    });
  }
}

export function renderBars(svg, series, opts = {}) {
  const {
    height = 200,
    accent = false,
    pad = { top: 14, right: 8, bottom: 36, left: 8 },
    valueFmt = (v) => String(v),
    rotateLabels = false,
  } = opts;

  const width = svg.clientWidth || svg.parentElement?.clientWidth || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.replaceChildren();
  if (!series.length) return;

  const max = Math.max(1, ...series.map((p) => p.value));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / series.length;
  const barW = Math.max(8, slot * 0.62);

  // Faint horizontal gridlines
  for (let g = 0; g <= 3; g++) {
    const y = pad.top + (innerH / 3) * g;
    svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "grid" }));
  }

  for (const [i, p] of series.entries()) {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const h = innerH * (p.value / max);
    const y = pad.top + (innerH - h);
    svg.appendChild(el("rect", {
      x, y, width: barW, height: Math.max(1, h), rx: 4, ry: 4,
      class: `bar${accent ? " alt" : ""}`,
    }));
    // Value label above bar
    if (h > 14) {
      const v = el("text", {
        x: x + barW / 2, y: y - 5, "text-anchor": "middle",
        style: "fill: var(--ink); font-weight: 600; font-size: 10.5px;",
      });
      v.textContent = valueFmt(p.value);
      svg.appendChild(v);
    }
    // Category label below
    const lbl = el("text", {
      x: x + barW / 2,
      y: height - 8,
      "text-anchor": "middle",
      transform: rotateLabels ? `rotate(-30, ${x + barW / 2}, ${height - 8})` : "",
    });
    lbl.textContent = p.label;
    svg.appendChild(lbl);
  }
}

export function renderSpark(svg, values, accent = true) {
  const width = svg.clientWidth || svg.parentElement?.clientWidth || 200;
  const height = 56;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.replaceChildren();
  if (!values.length) return;

  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const stepX = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const range = max - min || 1;
  const norm = (v) => 4 + (height - 8) * (1 - (v - min) / range);

  const points = values.map((v, i) => [2 + i * stepX, norm(v)]);
  const d = smoothPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  const areaD = `${d} L${last[0]},${height} L${first[0]},${height} Z`;

  svg.appendChild(el("path", { d: areaD, class: "area" }));
  svg.appendChild(el("path", { d, class: `line${accent ? " alt" : ""}` }));
  // Endpoint dot
  svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 3, class: `dot${accent ? " alt" : ""}` }));
}

// Stacked column chart for two series (eg shopify + amazon revenue per day).
export function renderStackedBars(svg, daily, opts = {}) {
  const {
    height = 200,
    pad = { top: 14, right: 8, bottom: 22, left: 8 },
    primaryKey = "a",
    secondaryKey = "b",
  } = opts;

  const width = svg.clientWidth || svg.parentElement?.clientWidth || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  if (!daily.length) return;

  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / daily.length;
  const barW = Math.max(2, slot * 0.78);
  const max = Math.max(1, ...daily.map((d) => (d[primaryKey] || 0) + (d[secondaryKey] || 0)));

  for (let g = 0; g <= 3; g++) {
    const y = pad.top + (innerH / 3) * g;
    svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "grid" }));
  }

  daily.forEach((d, i) => {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const a = d[primaryKey] || 0;
    const b = d[secondaryKey] || 0;
    const aH = innerH * (a / max);
    const bH = innerH * (b / max);
    const yA = pad.top + (innerH - aH);
    const yB = pad.top + (innerH - aH - bH);
    if (aH > 0.5) svg.appendChild(el("rect", { x, y: yA, width: barW, height: Math.max(0.5, aH), rx: 1.5, class: "bar" }));
    if (bH > 0.5) svg.appendChild(el("rect", { x, y: yB, width: barW, height: Math.max(0.5, bH), rx: 1.5, class: "bar alt" }));
  });
}

// Two overlaid lines (eg spend vs revenue), shared scale.
export function renderDualLine(svg, series, opts = {}) {
  const {
    height = 200,
    pad = { top: 14, right: 12, bottom: 22, left: 12 },
    primaryKey,
    secondaryKey,
    axisLabels = null,
  } = opts;
  const width = svg.clientWidth || svg.parentElement?.clientWidth || 600;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  if (!series.length) return;

  const max = Math.max(1, ...series.map((s) => Math.max(s[primaryKey] || 0, s[secondaryKey] || 0)));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
  const yFor = (v) => pad.top + innerH * (1 - v / max);

  for (let g = 0; g <= 3; g++) {
    const y = pad.top + (innerH / 3) * g;
    svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "grid" }));
  }

  function path(key, alt) {
    const pts = series.map((s, i) => [pad.left + i * stepX, yFor(s[key] || 0)]);
    const d = smoothPath(pts);
    if (alt) {
      const last = pts[pts.length - 1];
      const first = pts[0];
      svg.appendChild(el("path", {
        d: `${d} L${last[0]},${pad.top + innerH} L${first[0]},${pad.top + innerH} Z`,
        class: "area alt",
      }));
    }
    svg.appendChild(el("path", { d, class: `line${alt ? " alt" : ""}` }));
  }
  path(secondaryKey, true);  // accent (revenue) underneath
  path(primaryKey, false);   // ink (spend) on top

  if (axisLabels) {
    const positions = [pad.left, pad.left + innerW / 2, width - pad.right];
    const anchors = ["start", "middle", "end"];
    axisLabels.forEach((lbl, i) => {
      if (!lbl) return;
      const t = el("text", { x: positions[i], y: height - 6, "text-anchor": anchors[i] });
      t.textContent = lbl;
      svg.appendChild(t);
    });
  }
}

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== "" && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

// Catmull-Rom -> cubic Bezier path for soft smoothing.
function smoothPath(points) {
  if (points.length < 2) return "";
  const d = [`M${points[0][0]},${points[0][1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
  }
  return d.join(" ");
}
