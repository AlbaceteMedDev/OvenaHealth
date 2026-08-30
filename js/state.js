// State store backed by Supabase, with an in-memory cache so tab modules can
// read synchronously. Mutations apply optimistically to the cache, fire
// subscribers, then write to Supabase in the background.

import { seedInventory } from "./data/inventory.js";
import { supabase } from "./supabase.js";

// In-memory cache mirroring the inventory_state Supabase table.
// `warehouse` persists to the legacy shopify_qty column — the warehouse
// fulfills Shopify, so the column was renamed in the UI only to avoid a
// breaking schema change.
const initial = {
  inventory: Object.fromEntries(
    seedInventory.map((row) => [
      row.sku,
      { amazon: 0, warehouse: 0, reorderLevel: row.reorderLevel, cogs: 0, amazonFee: 0, amazonFeeFba: 0, shipCost: 0, shipToCustomer: 0 },
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
    .select("sku, amazon_qty, shopify_qty, reorder_level, cogs, amazon_fee, amazon_fee_fba, ship_cost, ship_to_customer, updated_at");
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
        warehouse: row.shopify_qty ?? 0,
        reorderLevel: row.reorder_level ?? state.inventory[row.sku].reorderLevel,
        cogs: Number(row.cogs ?? 0),
        // Read-only here. Nothing in the UI edits it, and persistRow omits
        // it so a COGS edit can't overwrite it — PostgREST only updates the
        // columns present in the payload.
        amazonFee: Number(row.amazon_fee ?? 0),
        // The FBA rate — referral PLUS fulfilment, 4-9x the merchant rate.
        // Migration 0018 recorded it and nothing ever read it, so an FBA sale
        // was charged the merchant-fulfilled referral and the fulfilment half
        // simply vanished from the P&L. Read-only here, like amazonFee.
        amazonFeeFba: Number(row.amazon_fee_fba ?? 0),
        // Inbound freight per unit. Read-only here too, and also omitted
        // from persistRow so a COGS edit can't clear it.
        shipCost: Number(row.ship_cost ?? 0),
        // Outbound, warehouse to customer. Shopify only — FBA orders already
        // pay fulfilment inside amazonFee.
        shipToCustomer: Number(row.ship_to_customer ?? 0),
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

// Apply one warehouse scan: adjust the count and append to the scan_events
// audit log. `qty` is units-per-scan for receive/pick, or the counted shelf
// total for count mode. Returns {before, after, delta} or null for an
// unknown SKU.
export function applyScan(sku, mode, qty, barcode = null) {
  const current = state.inventory[sku];
  if (!current) return null;
  const before = current.warehouse;
  let after = before;
  if (mode === "receive") after = before + qty;
  else if (mode === "pick") after = Math.max(0, before - qty);
  else if (mode === "count") after = Math.max(0, qty);
  const delta = after - before;

  updateRow(sku, { warehouse: after });

  void supabase
    .from("scan_events")
    .insert([{ sku, barcode, mode, delta, qty_after: after }])
    .then(({ error }) => {
      if (error) notifyError(`Scan log failed: ${error.message}`);
    });

  return { before, after, delta };
}

export function resetQuantities() {
  const previous = clone(state.inventory);
  for (const sku of Object.keys(state.inventory)) {
    state.inventory[sku].amazon = 0;
    state.inventory[sku].warehouse = 0;
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
          shopify_qty: row.warehouse,
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
        shopify_qty: r.warehouse,
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
  if ("warehouse" in patch) out.warehouse = toInt(patch.warehouse);
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
