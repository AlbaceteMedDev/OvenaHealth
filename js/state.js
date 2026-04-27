// Lightweight pub/sub store backed by localStorage. Persists user-editable
// data (Amazon/Shopify/reorder qtys, COGS) and notifies subscribers on change.

import { seedInventory } from "./data/inventory.js";

const KEY = "ovena-portal-v3";

const initial = {
  // sku -> { amazon, shopify, reorderLevel, cogs }
  inventory: Object.fromEntries(
    seedInventory.map((row) => [
      row.sku,
      { amazon: 0, shopify: 0, reorderLevel: row.reorderLevel, cogs: 0 },
    ]),
  ),
  lastSavedAt: null,
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(initial);
    const parsed = JSON.parse(raw);
    const merged = clone(initial);
    for (const sku of Object.keys(merged.inventory)) {
      const saved = parsed.inventory?.[sku];
      if (!saved) continue;
      merged.inventory[sku] = {
        amazon: toInt(saved.amazon),
        shopify: toInt(saved.shopify),
        reorderLevel: toInt(saved.reorderLevel) || merged.inventory[sku].reorderLevel,
        cogs: toFloat(saved.cogs),
      };
    }
    merged.lastSavedAt = parsed.lastSavedAt ?? null;
    return merged;
  } catch {
    return clone(initial);
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function persist() {
  state.lastSavedAt = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(state));
  for (const fn of listeners) fn(state);
}

export function getState() {
  return state;
}

export function getRow(sku) {
  return state.inventory[sku];
}

export function updateRow(sku, patch) {
  const current = state.inventory[sku];
  if (!current) return;
  state.inventory[sku] = {
    ...current,
    ...sanitizePatch(patch),
  };
  persist();
}

export function resetQuantities() {
  for (const sku of Object.keys(state.inventory)) {
    state.inventory[sku].amazon = 0;
    state.inventory[sku].shopify = 0;
  }
  persist();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sanitizePatch(patch) {
  const out = {};
  if ("amazon" in patch) out.amazon = toInt(patch.amazon);
  if ("shopify" in patch) out.shopify = toInt(patch.shopify);
  if ("reorderLevel" in patch) out.reorderLevel = toInt(patch.reorderLevel);
  if ("cogs" in patch) out.cogs = toFloat(patch.cogs);
  return out;
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toFloat(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
