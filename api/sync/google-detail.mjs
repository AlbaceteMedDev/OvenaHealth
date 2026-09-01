// Google Ads detail: bid keywords and landing pages.
//
//   GET /api/sync/google-detail            last 30 days
//   GET /api/sync/google-detail?days=60
//   GET /api/sync/google-detail?dry=1      fetch and report, write nothing
//
// WHY THIS IS NOT PART OF THE SEARCH-TERM SYNC
// Google's API splits search terms, keywords and landing pages into separate
// report VIEWS. Catchr rejects a request outright with "invalid mapping" when
// fields from different views are combined, so each of these has to be its
// own request. Amazon needs nothing equivalent: its search-term report
// already carries keyword, match type and campaign on every row, so the
// Amazon side of the ads tabs is built from ads_search_terms directly.
//
// WHY THERE IS A FALLBACK LADDER
// Which dimension combinations Catchr accepts inside a single view is not
// documented, and the connector answers a bad set with one opaque error
// rather than naming the offending field. Rather than guess once and ship a
// sync that silently returns nothing, each report tries the richest shape
// first and steps down until one is accepted. Whatever succeeds is recorded
// in sync_runs.detail as `shape`, so the working combination is discoverable
// from a run instead of by trial and error against the live API.

import { query as catchrQuery, toIsoDate, num } from "../_lib/catchr.mjs";
import { upsert, deleteWhere, startRun, finishRun } from "../_lib/db.mjs";
import { GOOGLE_ADS_ACCOUNTS } from "../_lib/accounts.mjs";
import { DATA_START } from "../../js/config.js";
import { authorized, UNAUTHORIZED } from "../_lib/auth.mjs";

const DATE = "_NORMALIZED_DATE_FIELD_YEAR_MONTH_DAY";
const METRICS = ["Impressions", "Clicks", "Cost", "Conversions", "ConversionValue"];

function rangeFor(days) {
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - (Math.max(1, days) - 1));
  const startIso = start.toISOString().slice(0, 10);
  return {
    start_date: startIso < DATA_START ? DATA_START : startIso,
    end_date: end.toISOString().slice(0, 10),
  };
}

// Richest first. Each entry is a dimension list; the first one Catchr accepts
// wins and its name is reported.
const KEYWORD_SHAPES = [
  { name: "keyword+match+campaign+adgroup", dims: [DATE, "Keyword", "KeywordMatchType", "CampaignName", "AdGroupName"] },
  { name: "keyword+match+campaign", dims: [DATE, "Keyword", "KeywordMatchType", "CampaignName"] },
  { name: "keyword+match", dims: [DATE, "Keyword", "KeywordMatchType"] },
  { name: "keyword", dims: [DATE, "Keyword"] },
];

const LANDING_SHAPES = [
  { name: "landingpage+campaign", dims: [DATE, "UnexpandedFinalUrlString", "CampaignName"] },
  { name: "landingpage", dims: [DATE, "UnexpandedFinalUrlString"] },
  { name: "expanded-landingpage", dims: [DATE, "ExpandedFinalUrlString"] },
];

async function tryShapes(account, range, shapes) {
  const attempts = [];
  for (const shape of shapes) {
    try {
      const rows = await catchrQuery("google-ads", {
        accounts: [{ id: account.id, authorization_id: account.authorization_id }],
        date: "CUSTOM",
        ...range,
        dimensions: shape.dims,
        metrics: METRICS,
        max_rows: 50000,
      });
      return { shape: shape.name, dims: shape.dims, rows, attempts };
    } catch (err) {
      attempts.push(`${shape.name}: ${String(err.message).slice(0, 140)}`);
    }
  }
  const e = new Error(`no accepted dimension shape. Tried ${attempts.join(" | ")}`);
  e.attempts = attempts;
  throw e;
}

// Catchr returns the same key more than once across accounts, and a fallback
// shape collapses dimensions so distinct source rows land on one key.
// Postgres rejects the whole batch when a payload repeats a primary key.
function fold(rows, keyOf) {
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const slot = by.get(k);
    if (!slot) { by.set(k, { ...r }); continue; }
    slot.impressions += r.impressions;
    slot.clicks += r.clicks;
    slot.cost += r.cost;
    slot.conversions += r.conversions;
    slot.conversion_value += r.conversion_value;
  }
  return [...by.values()];
}

const txt = (v) => String(v ?? "").trim();

async function loadKeywords(range) {
  const out = [];
  const shapes = [];
  for (const account of GOOGLE_ADS_ACCOUNTS) {
    const { shape, rows } = await tryShapes(account, range, KEYWORD_SHAPES);
    shapes.push(shape);
    for (const r of rows) {
      const date = toIsoDate(r[DATE]);
      const keyword = txt(r.Keyword);
      if (!date || !keyword) continue;
      out.push({
        date,
        keyword,
        match_type: txt(r.KeywordMatchType),
        campaign_name: txt(r.CampaignName),
        ad_group_name: txt(r.AdGroupName),
        impressions: num(r.Impressions),
        clicks: num(r.Clicks),
        cost: num(r.Cost),
        conversions: num(r.Conversions),
        conversion_value: num(r.ConversionValue),
        currency: account.currency || "USD",
      });
    }
  }
  return {
    shape: shapes.join(","),
    rows: fold(out, (r) => [r.date, r.keyword, r.match_type, r.campaign_name, r.ad_group_name].join("")),
  };
}

async function loadLandingPages(range) {
  const out = [];
  const shapes = [];
  for (const account of GOOGLE_ADS_ACCOUNTS) {
    const { shape, rows } = await tryShapes(account, range, LANDING_SHAPES);
    shapes.push(shape);
    for (const r of rows) {
      const date = toIsoDate(r[DATE]);
      const page = txt(r.UnexpandedFinalUrlString || r.ExpandedFinalUrlString);
      if (!date || !page) continue;
      out.push({
        date,
        landing_page: page,
        campaign_name: txt(r.CampaignName),
        impressions: num(r.Impressions),
        clicks: num(r.Clicks),
        cost: num(r.Cost),
        conversions: num(r.Conversions),
        conversion_value: num(r.ConversionValue),
        currency: account.currency || "USD",
      });
    }
  }
  return {
    shape: shapes.join(","),
    rows: fold(out, (r) => [r.date, r.landing_page, r.campaign_name].join("")),
  };
}

const TABLES = {
  google_keywords_daily: {
    load: loadKeywords,
    conflict: "date,keyword,match_type,campaign_name,ad_group_name",
  },
  google_landing_pages_daily: {
    load: loadLandingPages,
    conflict: "date,landing_page,campaign_name",
  },
};

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ error: UNAUTHORIZED });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const dry = url.searchParams.get("dry") === "1";
  const days = parseInt(url.searchParams.get("days"), 10) || 30;
  const range = rangeFor(days);

  const runId = dry ? null : await startRun("google-detail");
  const report = {};
  const notes = [];
  let written = 0;
  let anyFailed = false;

  // Each table is fetched and written independently. One report being
  // rejected must not blank the other's rows, and a table whose fetch threw
  // is never deleted — an empty result would otherwise read as "no keywords
  // this week" and wipe real history.
  for (const [table, cfg] of Object.entries(TABLES)) {
    try {
      const { shape, rows } = await cfg.load(range);
      const dates = [...new Set(rows.map((r) => r.date))].sort();
      report[table] = {
        shape,
        rows: rows.length,
        covered: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
        cost: Math.round(rows.reduce((t, r) => t + r.cost, 0) * 100) / 100,
        clicks: rows.reduce((t, r) => t + r.clicks, 0),
        conversions: rows.reduce((t, r) => t + r.conversions, 0),
      };

      if (!rows.length) {
        notes.push(`${table}: no rows returned, existing data left alone`);
        continue;
      }
      if (dry) continue;

      await deleteWhere(table, `date=gte.${dates[0]}&date=lte.${dates[dates.length - 1]}`);
      written += await upsert(table, rows, cfg.conflict);
    } catch (err) {
      anyFailed = true;
      report[table] = { error: err.message };
      notes.push(`${table}: ${err.message}`);
    }
  }

  notes.push(
    "Google reports keywords and landing pages a few days behind, so the newest " +
    "days are incomplete. Conversions and conversion value are Google's own tag's " +
    "figures and are not comparable with Amazon's 14-day click attribution.",
  );

  const summary = { ok: !anyFailed, dry, window: range, tables: report, written, notes };
  await finishRun(runId, {
    status: anyFailed ? "partial" : "ok",
    rowsWritten: written,
    detail: summary,
  });
  res.status(anyFailed ? 207 : 200).json(summary);
}
