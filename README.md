# Ovena Health Commerce Portal

An ops dashboard for the Ovena Health Amazon store: inventory, sales,
product performance, ad spend and margins, in one sidebar-driven interface
with timezone-aware live data.

## Tabs

One tab per channel, plus an Overview that combines them.

- **Overview** — every channel together: total revenue, ad spend, TACOS, and
  a daily channel breakdown. The only tab that adds Amazon and Shopify.
- **Amazon** — ordered product sales, traffic, conversion, per-SKU
  performance and Sponsored Ads campaigns. (Catchr → Amazon Seller + Ads.)
- **Shopify** — storefront revenue **net of refunds**, per product, from the
  Shopify Admin API.
- **Meta** — Facebook/Instagram spend and campaigns. (Catchr.)
- **Google** — Google Ads spend and campaigns, plus Merchant Center feed
  health. (Catchr.)
- **Inventory** — FBA stock from Amazon SP-API alongside warehouse counts
  from barcode scans, with reorder levels, low-stock detection and CSV export.
- **Scan** — warehouse barcode receive / pick / count, append-only audit log.
- **Margins** — manual COGS entry per SKU, profit per unit, gross margin.

The old `#sales`, `#products` and `#ads` hashes redirect to `#amazon`.

## Reporting rules

Two filters apply to every tab, both defined once in
[`js/config.js`](js/config.js):

- **`DATA_START` = 2026-07-19.** Nothing before this date is reported.
  `startDateFor()` clamps every query and `denseDays()` clamps every chart,
  so a "14d" window and "All" can legitimately show the same number. Because
  the eligible history is only a few weeks, the period selector is
  7d / 14d / All rather than 7/30/90.
- **`EXCLUDED_PRODUCT_PATTERNS` = `/juzo/i`.** The four Juzo listings were a
  16-day trial (6 orders, $230, Jul 6–21) and were archived on 2026-08-12.
  Their revenue is stripped from every channel. Matched on product title, so
  a re-added Juzo SKU can't slip back in.

Every tab states both rules under its title. Change them in `config.js` and
the whole portal moves.

### Gross vs net

Amazon reports **ordered product sales** — before refunds, before referral
and FBA fees. Shopify reports **net of refunds**. These are different
measures and the Overview says so rather than implying one clean number.

This matters more than it sounds. GA4 is connected and reports ecommerce
revenue, but it fires `purchase` at checkout and never learns about refunds:
on 2026-08-12 it put "Collagen Kit" at $823.91 against a Shopify gross of
$441.95 and a **net of $0.00** — every order had been refunded within days.
That's why storefront money comes from the Shopify Admin API and not GA4.

## How the data gets in

The browser never talks to Catchr or Amazon directly — both need secrets that
can't ship to a client. Instead:

```
Catchr API ──┐
             ├─→ Vercel cron functions (/api/sync/*) ─→ Supabase ─→ browser
Amazon SP-API┘
```

Two consequences worth knowing:

- **History is retained.** Catchr serves a rolling window; Supabase keeps
  every day the sync has ever seen.
- **GitHub Pages works too.** It can't run serverless functions, but it reads
  the same Supabase tables, so both hosts show identical numbers. Only the
  Vercel deployment actually runs the syncs.

### Sync jobs

| Route | Schedule | What it writes |
|---|---|---|
| `/api/sync/catchr` | every 30 min | `amz_traffic_daily`, `ads_daily`, `ads_sku_daily`, `gmc_*` |
| `/api/sync/shopify` | every 30 min | `shop_sales_daily`, `shop_totals_daily` |
| `/api/sync/orders` | :05 and :35 | `amz_orders`, `amz_sales_daily` |
| `/api/sync/seo` | every 6h | `seo_sessions`, Search Console, GA4 |
| `/api/sync/fba` | daily 07:30 | `fba_inventory` |
| `/api/health` | on demand | env checklist (public); accounts and `?probe=1` need the secret |

**Amazon sales come from `/api/sync/orders`, not from Catchr.** Catchr's
amazon-seller connector is accurate per day OR per SKU but never both, and
the per-day-per-SKU shape the portal used to ask for overstated revenue by
about 2x — see migration `0018_amazon_order_truth.sql`. `catchr` now writes
only per-day traffic; the order importer reads Amazon's All Orders report
and derives `amz_sales_daily` from order items, bucketed in **Pacific** time
because that is what Amazon reports in.

The order importer takes its report from SP-API when `SPAPI_*` is set, and
otherwise from a POST body, so a Seller Central export can be loaded without
credentials:

```
curl -X POST "https://…/api/sync/orders?secret=YOUR_CRON_SECRET" \
     -H 'content-type: text/plain' --data-binary @AllOrders.txt
```

`/api/sync/orders?rebuild=1` re-derives `amz_sales_daily` from the order
items already stored, without fetching anything. That is the repair path when
a sales row is wrong but the orders behind it are right.

The Shopify job always re-reads the whole window from `DATA_START` rather
than just recent days: a refund issued today changes the net revenue of an
order placed three weeks ago, and only a full re-read catches that. The order
importer rebuilds each day it covers for the same reason — a cancellation has
to be able to remove revenue, which an upsert alone cannot express.

All of them require `CRON_SECRET`, passed as `Authorization: Bearer …` (which
is what Vercel Cron sends) or `?secret=…` by hand. Manual runs accept
`?days=90` to backfill and `?dry=1` to fetch without writing.

> On a Vercel **Hobby** plan, cron expressions are accepted but only fire
> once per day. Upgrade to Pro for the 6-hourly schedule, or trigger
> `/api/sync/catchr` manually when you need fresher numbers.

## Environment variables

Set in Vercel → Settings → Environment Variables. None of these belong in
the repo.

| Name | Required | Notes |
|---|---|---|
| `CRON_SECRET` | yes | guards every `/api` route; routes refuse to run if unset |
| `CATCHR_API_KEY` | yes | Catchr API key |
| `SUPABASE_URL` | yes | same project as `js/config.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server only** — never in `js/` |
| `CATCHR_QUERY_PATH` | no | default `/query/{platform}`; see below |
| `CATCHR_AUTH_STYLE` | no | `bearer` (default) / `x-api-key` / `api-key` / `query` |
| `CATCHR_GOOGLE_ADS_ACCOUNTS` | no | JSON array; defaults to the connected account |
| `SHOPIFY_STORE_DOMAIN` | for Shopify | e.g. `c5s06e-3n.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | for Shopify | Admin API token with `read_orders` |
| `REPORT_TIMEZONE` | no | day-bucketing for Shopify orders, default `UTC` |
| `SPAPI_CLIENT_ID` / `SPAPI_CLIENT_SECRET` / `SPAPI_REFRESH_TOKEN` | for FBA | see [docs/SPAPI_SETUP.md](docs/SPAPI_SETUP.md) |

### One-time: pin the Catchr endpoint

Catchr doesn't publish its REST contract. The request *body* the sync sends
mirrors Catchr's own MCP server exactly, so it's known-good — but the
endpoint path and auth header style are educated guesses with sensible
defaults. Confirm them once:

```
GET /api/health?probe=1&secret=YOUR_CRON_SECRET
```

It tries each plausible combination and reports the one that works, along
with a `pin` object. Copy those two values into Vercel env vars and the
guessing stops. If every combination fails, ask Catchr support for the query
endpoint and set `CATCHR_API_BASE` / `CATCHR_QUERY_PATH` accordingly.

## First-time setup

### 1. Run the migrations

Supabase → **SQL Editor** → paste and run each file in
`supabase/migrations/` in order. They're idempotent.

`0004_amazon_store_and_marketing.sql` also reseeds the catalog against the
live Amazon listings. Read the note at the top of that file before running
it — the old speculative sock variants stop being displayed, and it tells you
how to check for stranded quantities first.

### 2. Disable email confirmation

Supabase → **Authentication → Providers → Email** → turn **Confirm email**
off. The portal creates the shared team account on first sign-in.

### 3. Sign in

Visit the deployment, type the team password. First sign-in creates
`team@ovenahealth.app` in Supabase Auth and persists the session locally.

### 4. Backfill

```
/api/sync/catchr?days=90&secret=YOUR_CRON_SECRET
/api/sync/fba?secret=YOUR_CRON_SECRET
```

## Catalog

Live on Amazon.com — 7 SKUs:

| SKU | ASIN | Product |
|---|---|---|
| `HC-ROLL5FT` | B0H8ZH3J9R | Hydrocolloid Roll 2" × 5 ft |
| `HC-ROLL16FT` | B0H949P7JW | Hydrocolloid Roll 2" × 16 ft |
| `CS-KHC-S-BLK` | B0H8ZT6Y7B | Compression Socks, knee high closed toe, black, S |
| `CS-KHC-M-BLK` | B0H8ZVQPPB | …M |
| `CS-KHC-L-BLK` | B0H8ZJPGL8 | …L |
| `CS-KHC-XL-BLK` | B0H8ZQQB4F | …XL |
| `SOCK-AID` | B0HC5X78B1 | Sock Aid Device, 9.5 in |

`CS-KHC-L-BLK-FBA` is a second seller SKU on the L sock's ASIN; it's folded
into `CS-KHC-L-BLK` via the `amazon_sku_map` table.

Stocked but **not listed on Amazon** — the wound-care line (collagen
dressings 2×2 / 4×4 / 7×7, collagen powder, gauze rolls, silicone foam
dressings, gloves, wound wash). These keep inventory and COGS rows so
warehouse counts and margin math work; they never appear in Amazon reporting.

## Numbers the portal does *not* know

Worth stating plainly, because it changes how you read the Margins tab:

- **Amazon referral fees and FBA fulfilment fees are not deducted.** They're
  not in any feed the portal reads. Gross profit and contribution are both
  *before* Amazon's cut — treat them as ceilings.
- **Meta and Google attributed revenue will read $0** against an Amazon
  store. Their pixels can't see an Amazon purchase. See
  [docs/CATCHR_GOOGLE_ADS.md](docs/CATCHR_GOOGLE_ADS.md).
- **Only Amazon.com is synced.** CA / MX / BR are authorized in Catchr but
  have no sales; enabling them needs currency conversion first.

## Run locally

Static site, ES modules — needs to be served over HTTP:

```sh
python3 -m http.server 8000
```

The `/api` routes need the Vercel CLI (`vercel dev`) and Node 20+.

## Project layout

```
.
├── index.html
├── styles.css
├── package.json             # type:module only — no deps, no build step
├── vercel.json              # cron schedules + function config
├── api/
│   ├── health.mjs           # diagnostics + Catchr contract probe
│   ├── _lib/
│   │   ├── catchr.mjs       # Catchr client, field maps, probe
│   │   ├── shopify.mjs      # Admin API orders → net-of-refund rows
│   │   ├── spapi.mjs        # LWA auth + FBA Inventory
│   │   ├── db.mjs           # Supabase writes over PostgREST
│   │   └── accounts.mjs     # which Catchr sources to pull
│   └── sync/
│       ├── catchr.mjs       # Amazon sales + all ads + Merchant Center
│       ├── shopify.mjs      # storefront sales → Supabase
│       └── fba.mjs          # FBA stock → Supabase
├── js/
│   ├── main.js  auth.js  supabase.js  state.js
│   ├── config.js            # Supabase keys, DATA_START, excluded products
│   ├── format.js  charts.js  ui.js  importer.js
│   ├── data/
│   │   ├── inventory.js     # catalog: SKUs, ASINs, aliases
│   │   └── live.js          # Supabase read layer + shaping helpers
│   └── tabs/
│       ├── overview.js      # all channels combined
│       ├── amazon.js  shopify.js
│       ├── adchannel.js     # shared Meta/Google renderer
│       ├── meta.js  google.js
│       └── inventory.js  scan.js  margins.js
├── docs/
│   ├── CATCHR_GOOGLE_ADS.md
│   └── SPAPI_SETUP.md
└── supabase/migrations/
    ├── 0001_initial.sql
    ├── 0002_add_collagen_powder.sql
    ├── 0003_warehouse_scanning.sql
    ├── 0004_amazon_store_and_marketing.sql
    └── 0005_shopify_and_merchant_center.sql
```
