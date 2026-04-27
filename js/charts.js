// Tiny SVG chart helpers. No deps, scale to container width.

const NS = "http://www.w3.org/2000/svg";

export function renderLine(svg, series, opts = {}) {
  const {
    height = 160,
    yMin = 0,
    smooth = true,
    accent = false,
    fillArea = true,
    pad = { top: 10, right: 8, bottom: 18, left: 8 },
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

  const d = smooth
    ? smoothPath(points)
    : points.map((pt, i) => (i === 0 ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)).join(" ");

  // Faint baseline grid
  for (let g = 0; g < 4; g++) {
    const y = pad.top + (innerH / 3) * g;
    const ln = el("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "grid" });
    svg.appendChild(ln);
  }

  if (fillArea) {
    const last = points[points.length - 1];
    const first = points[0];
    const areaD = `${d} L${last[0]},${pad.top + innerH} L${first[0]},${pad.top + innerH} Z`;
    const area = el("path", { d: areaD, class: "area" });
    svg.appendChild(area);
  }

  const line = el("path", { d, class: `line${accent ? " alt" : ""}` });
  svg.appendChild(line);
}

export function renderBars(svg, series, opts = {}) {
  const {
    height = 180,
    accent = false,
    pad = { top: 12, right: 8, bottom: 28, left: 8 },
    showLabels = true,
    valueFmt = (v) => String(v),
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
  const barW = Math.max(6, slot * 0.62);

  for (const [i, p] of series.entries()) {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const h = innerH * (p.value / max);
    const y = pad.top + (innerH - h);
    svg.appendChild(el("rect", {
      x, y, width: barW, height: Math.max(1, h),
      rx: 4, ry: 4,
      class: `bar${accent ? " alt" : ""}`,
    }));
    if (showLabels) {
      const lbl = el("text", {
        x: x + barW / 2,
        y: height - 8,
        "text-anchor": "middle",
      });
      lbl.textContent = p.label;
      svg.appendChild(lbl);
    }
    if (showLabels) {
      const v = el("text", {
        x: x + barW / 2,
        y: y - 4,
        "text-anchor": "middle",
        style: "fill: var(--ink-2); font-weight: 600;",
      });
      v.textContent = valueFmt(p.value);
      svg.appendChild(v);
    }
  }
}

export function renderSpark(svg, values, accent = false) {
  const width = svg.clientWidth || svg.parentElement?.clientWidth || 200;
  const height = 56;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.replaceChildren();
  if (!values.length) return;

  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const stepX = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const norm = (v) => {
    const range = max - min || 1;
    return 4 + (height - 8) * (1 - (v - min) / range);
  };

  const points = values.map((v, i) => [2 + i * stepX, norm(v)]);
  const d = points.map((pt, i) => (i === 0 ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const areaD = `${d} L${last[0]},${height} L${first[0]},${height} Z`;

  svg.appendChild(el("path", { d: areaD, class: "area" }));
  svg.appendChild(el("path", { d, class: `line${accent ? " alt" : ""}` }));
}

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Catmull-Rom -> cubic bezier path for soft smoothing.
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
