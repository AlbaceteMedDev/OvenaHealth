const STORAGE_KEY = "ovena-inventory-v2";

const coreProducts = [
  { sku: "CWD-2X2", product: 'Collagen Wound Dressing 2"x2"', category: "Wound Care", variant: "Standard", reorderLevel: 80 },
  { sku: "CWD-4X4", product: 'Collagen Wound Dressing 4"x4"', category: "Wound Care", variant: "Standard", reorderLevel: 70 },
  { sku: "CWD-7X7", product: 'Collagen Wound Dressing 7"x7"', category: "Wound Care", variant: "Standard", reorderLevel: 60 },
  { sku: "GAUZE-ROLL", product: "Gauze Rolls", category: "Wound Care", variant: "Standard", reorderLevel: 100 },
  { sku: "SFD-4X4", product: '4"x4" Silicone Foam Dressing', category: "Wound Care", variant: "Standard", reorderLevel: 75 },
  { sku: "SFD-6X6", product: '6"x6" Silicone Foam Dressing', category: "Wound Care", variant: "Standard", reorderLevel: 70 },
  { sku: "SFD-8X8", product: '8"x8" Silicone Foam Dressing', category: "Wound Care", variant: "Standard", reorderLevel: 65 },
  { sku: "GLOVE-DISP", product: "Disposable Gloves", category: "Supplies", variant: "Standard", reorderLevel: 200 },
  { sku: "WOUND-WASH", product: "Wound Wash", category: "Supplies", variant: "Standard", reorderLevel: 90 },
];

const sockVersions = [
  { code: "KHC", label: "Knee High Closed Toe" },
  { code: "KHO", label: "Knee High Open Toe" },
  { code: "THC", label: "Thigh High Closed Toe" },
  { code: "THO", label: "Thigh High Open Toe" },
];

const sizes = [1, 2, 3, 4, 5];
const colors = ["Black", "Beige"];

function makeSockVariants() {
  const entries = [];
  for (const version of sockVersions) {
    for (const size of sizes) {
      for (const color of colors) {
        entries.push({
          sku: `CS-${version.code}-S${size}-${color.slice(0, 1).toUpperCase()}`,
          product: "Compression Socks",
          category: "Compression",
          variant: `${version.label} | Size ${size} | ${color}`,
          reorderLevel: 40,
        });
      }
    }
  }
  return entries;
}

const seedInventory = [...coreProducts, ...makeSockVariants()].map((item) => ({
  ...item,
  amazon: 0,
  shopify: 0,
}));

const tableBody = document.getElementById("inventoryTableBody");
const rowTemplate = document.getElementById("rowTemplate");
const searchInput = document.getElementById("searchInput");
const channelFilter = document.getElementById("channelFilter");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const summaryGrid = document.getElementById("summaryGrid");
const versionGuideList = document.getElementById("versionGuideList");
const skuCount = document.getElementById("skuCount");
const lastSaved = document.getElementById("lastSaved");

let inventory = loadInventory();

renderVersionGuide();
render();

searchInput.addEventListener("input", render);
channelFilter.addEventListener("change", render);

resetBtn.addEventListener("click", () => {
  if (!confirm("Reset all Amazon and Shopify quantities to 0?")) return;
  inventory = inventory.map((row) => ({ ...row, amazon: 0, shopify: 0 }));
  persistAndRender();
});

exportBtn.addEventListener("click", () => {
  const rows = [
    ["SKU", "Product", "Category", "Variant", "Amazon", "Shopify", "Total", "Reorder Level", "Status"],
    ...filteredInventory().map((row) => [
      row.sku,
      row.product,
      row.category,
      row.variant,
      row.amazon,
      row.shopify,
      row.amazon + row.shopify,
      row.reorderLevel,
      statusText(row),
    ]),
  ];

  const csv = rows.map((r) => r.map(csvSafe).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `ovena_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

function loadInventory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(seedInventory);

    const parsed = JSON.parse(saved);
    const map = new Map(parsed.map((row) => [row.sku, row]));
    return seedInventory.map((row) => {
      const savedRow = map.get(row.sku);
      if (!savedRow) return { ...row };
      return {
        ...row,
        amazon: toInt(savedRow.amazon),
        shopify: toInt(savedRow.shopify),
        reorderLevel: toInt(savedRow.reorderLevel) || row.reorderLevel,
      };
    });
  } catch {
    return structuredClone(seedInventory);
  }
}

function filteredInventory() {
  const q = searchInput.value.trim().toLowerCase();
  const channelMode = channelFilter.value;

  return inventory.filter((row) => {
    const matchesSearch =
      !q ||
      row.sku.toLowerCase().includes(q) ||
      row.product.toLowerCase().includes(q) ||
      row.category.toLowerCase().includes(q) ||
      row.variant.toLowerCase().includes(q);

    const hasAmazon = row.amazon > 0;
    const hasShopify = row.shopify > 0;

    let matchesChannel = true;
    if (channelMode === "amazon") matchesChannel = hasAmazon;
    else if (channelMode === "shopify") matchesChannel = hasShopify;
    else if (channelMode === "both") matchesChannel = hasAmazon && hasShopify;

    return matchesSearch && matchesChannel;
  });
}

function statusText(row) {
  const total = row.amazon + row.shopify;
  if (total < row.reorderLevel) return "Low";
  if (total <= row.reorderLevel * 1.25) return "Watch";
  return "Healthy";
}

function statusClass(status) {
  if (status === "Low") return "status-low";
  if (status === "Watch") return "status-watch";
  return "status-ok";
}

function render() {
  const rows = filteredInventory();
  tableBody.innerHTML = "";

  for (const row of rows) {
    const fragment = rowTemplate.content.cloneNode(true);
    const tr = fragment.querySelector("tr");

    const total = row.amazon + row.shopify;
    const status = statusText(row);

    tr.querySelector('[data-field="sku"]').textContent = row.sku;
    tr.querySelector('[data-field="product"]').textContent = row.product;
    tr.querySelector('[data-field="variant"]').textContent = row.variant;

    const amazonInput = tr.querySelector('[data-field="amazon"]');
    const shopifyInput = tr.querySelector('[data-field="shopify"]');
    const reorderInput = tr.querySelector('[data-field="reorderLevel"]');

    amazonInput.value = row.amazon;
    shopifyInput.value = row.shopify;
    reorderInput.value = row.reorderLevel;

    amazonInput.addEventListener("change", (event) => {
      row.amazon = toInt(event.target.value);
      persistAndRender();
    });

    shopifyInput.addEventListener("change", (event) => {
      row.shopify = toInt(event.target.value);
      persistAndRender();
    });

    reorderInput.addEventListener("change", (event) => {
      row.reorderLevel = toInt(event.target.value);
      persistAndRender();
    });

    tr.querySelector('[data-field="total"]').textContent = String(total);

    const statusPill = tr.querySelector('[data-field="status"]');
    statusPill.textContent = status;
    statusPill.classList.add(statusClass(status));

    if (status === "Low") tr.classList.add("low-stock");

    tableBody.appendChild(fragment);
  }

  skuCount.textContent = `${rows.length} SKUs shown`;
  renderSummary();
}

function renderSummary() {
  const totalUnits = inventory.reduce((sum, row) => sum + row.amazon + row.shopify, 0);
  const lowCount = inventory.filter((row) => statusText(row) === "Low").length;
  const watchCount = inventory.filter((row) => statusText(row) === "Watch").length;
  const amazonUnits = inventory.reduce((sum, row) => sum + row.amazon, 0);
  const shopifyUnits = inventory.reduce((sum, row) => sum + row.shopify, 0);

  summaryGrid.innerHTML = "";
  const cards = [
    { label: "Total Units", value: totalUnits.toLocaleString() },
    { label: "Low Stock SKUs", value: lowCount.toString() },
    { label: "Watch SKUs", value: watchCount.toString() },
    { label: "Amazon Units", value: amazonUnits.toLocaleString() },
    { label: "Shopify Units", value: shopifyUnits.toLocaleString() },
  ];

  for (const card of cards) {
    const div = document.createElement("div");
    div.className = "summary-card";
    div.innerHTML = `<div class="label">${card.label}</div><div class="value">${card.value}</div>`;
    summaryGrid.appendChild(div);
  }
}

function renderVersionGuide() {
  versionGuideList.innerHTML = "";
  const definitions = [
    { name: "KHC", description: "Knee High Closed Toe: below-knee with enclosed toes." },
    { name: "KHO", description: "Knee High Open Toe: below-knee with an open toe." },
    { name: "THC", description: "Thigh High Closed Toe: thigh-length with enclosed toes." },
    { name: "THO", description: "Thigh High Open Toe: thigh-length with an open toe." },
  ];

  for (const version of definitions) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${version.name}</strong> &mdash; ${version.description}`;
    versionGuideList.appendChild(li);
  }
}

function persistAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
  lastSaved.textContent = `Saved ${new Date().toLocaleString()}`;
  render();
}

function csvSafe(value) {
  const str = String(value ?? "");
  return `"${str.replaceAll('"', '""')}"`;
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
