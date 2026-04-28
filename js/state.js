// State store backed by Supabase, with an in-memory cache so tab modules can
// read synchronously. Mutations apply optimistically to the cache, fire
// subscribers, then write to Supabase in the background.

import { seedInventory } from "./data/inventory.js";
import { supabase } from "./supabase.js";

// In-memory cache mirroring the inventory_state Supabase table.
const initial = {
  inventory: Object.fromEntries(
    seedInventory.map((row) => [
      row.sku,
      { amazon: 0, shopify: 0, reorderLevel: row.reorderLevel, cogs: 0 },
    ]),
  ),
  lastSavedAt: null,
};

let state = clone(initial);
let booted = false;

const listeners = new Set();
const errorListeners = new Set();

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

export function getState() { return state; }
export function getRow(sku) { return state.inventory[sku]; }
export function isBooted() { return booted; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

function notify() { for (const fn of listeners) fn(state); }
function notifyError(msg) { for (const fn of errorListeners) fn(msg); }

// Pull the entire catalog from Supabase into the cache. Anything missing
// in Supabase falls back to the seed defaults already present.
export async function loadInitial() {
  const { data, error } = await supabase
    .from("inventory_state")
    .select("sku, amazon_qty, shopify_qty, reorder_level, cogs, updated_at");
  if (error) {
    notifyError(`Couldn't load inventory: ${error.message}`);
    booted = true;
    notify();
    return;
  }
  let mostRecent = null;
  for (const row of data || []) {
    if (state.inventory[row.sku]) {
      state.inventory[row.sku] = {
        amazon: row.amazon_qty ?? 0,
        shopify: row.shopify_qty ?? 0,
        reorderLevel: row.reorder_level ?? state.inventory[row.sku].reorderLevel,
        cogs: Number(row.cogs ?? 0),
      };
    }
    if (row.updated_at && (!mostRecent || row.updated_at > mostRecent)) {
      mostRecent = row.updated_at;
    }
  }
  state.lastSavedAt = mostRecent;
  booted = true;
  notify();
}

// Optimistic update: patch cache, notify, then upsert in background.
// On error, we revert the cell and surface the error.
export function updateRow(sku, patch) {
  const current = state.inventory[sku];
  if (!current) return;
  const previous = { ...current };
  state.inventory[sku] = { ...current, ...sanitizePatch(patch) };
  state.lastSavedAt = new Date().toISOString();
  notify();

  void persistRow(sku, state.inventory[sku]).catch((err) => {
    // Revert on failure.
    state.inventory[sku] = previous;
    notifyError(`Save failed: ${err.message}`);
    notify();
  });
}

export function resetQuantities() {
  const previous = clone(state.inventory);
  for (const sku of Object.keys(state.inventory)) {
    state.inventory[sku].amazon = 0;
    state.inventory[sku].shopify = 0;
  }
  state.lastSavedAt = new Date().toISOString();
  notify();

  void persistMany(
    Object.entries(state.inventory).map(([sku, row]) => ({ sku, ...row })),
  ).catch((err) => {
    state.inventory = previous;
    notifyError(`Reset failed: ${err.message}`);
    notify();
  });
}

async function persistRow(sku, row) {
  const { error } = await supabase
    .from("inventory_state")
    .upsert(
      [
        {
          sku,
          amazon_qty: row.amazon,
          shopify_qty: row.shopify,
          reorder_level: row.reorderLevel,
          cogs: row.cogs,
        },
      ],
      { onConflict: "sku" },
    );
  if (error) throw error;
}

async function persistMany(rows) {
  const { error } = await supabase
    .from("inventory_state")
    .upsert(
      rows.map((r) => ({
        sku: r.sku,
        amazon_qty: r.amazon,
        shopify_qty: r.shopify,
        reorder_level: r.reorderLevel,
        cogs: r.cogs,
      })),
      { onConflict: "sku" },
    );
  if (error) throw error;
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

// Reset the cache to seed defaults — used on logout to clear stale data.
export function resetCache() {
  state = clone(initial);
  booted = false;
  notify();
}
