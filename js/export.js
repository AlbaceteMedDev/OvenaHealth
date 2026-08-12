// CSV export. Every tab hands this an array of objects plus a column spec,
// so what you download is exactly what the table or chart is showing —
// same rows, same granularity, same filters.

function cell(v) {
  if (v == null) return "";
  const s = String(v);
  // Quote anything that could break a CSV parser, and double embedded quotes.
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// columns: [{ key, label }] or ["key", ...]
export function toCsv(rows, columns) {
  const cols = columns.map((c) => (typeof c === "string" ? { key: c, label: c } : c));
  const head = cols.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c.key])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

export function download(content, filename, type = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Filenames carry the tab, granularity and date so a folder of exports
// stays self-describing.
export function exportCsv(rows, columns, { name, grain = "day" } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  download(toCsv(rows, columns), `ovena_${name}_${grain}_${stamp}.csv`);
}

// Renders the button markup; call wireExport() to attach the handler.
export function exportButton(id, label = "Export CSV") {
  return `<button class="btn ghost export-btn" id="${id}" type="button">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>${label}</button>`;
}

export function wireExport(root, id, getData) {
  const btn = root.querySelector(`#${id}`);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const d = getData();
    if (!d || !d.rows || !d.rows.length) return;
    exportCsv(d.rows, d.columns, { name: d.name, grain: d.grain });
  });
}
