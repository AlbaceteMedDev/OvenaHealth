# Ovena Health Commerce Portal

A multi-tab e-commerce ops dashboard for Ovena Health: inventory, sales, product
analytics, ad performance, and profit margins, all in one luxe, timezone-aware
interface.

## Tabs

- **Inventory** — Amazon and Shopify stock with editable quantities, reorder
  levels, low-stock detection, search/filter, and CSV export.
- **Sales** — revenue trend, channel split (Amazon vs Shopify), AOV, and a
  recent-orders feed. *Mock data; Phase 2 wires Shopify Admin API and Amazon
  SP-API.*
- **Products** — top sellers, category mix, and compression-sock variant
  analysis (best version, size, color). *Mock data; goes live with Phase 2.*
- **Ads** — Meta Business performance: spend vs attributed revenue, blended
  ROAS, audience and angle leaderboards, per-campaign metrics. *Mock data;
  Phase 4 wires Meta Marketing API.*
- **Margins** — manual COGS entry per SKU, live profit-per-unit and gross
  margin %, blended margin across the active period.

## Highlights

- **Timezone-aware**: clock and all date/time displays render in the viewer's
  local timezone (auto-detected via `Intl.DateTimeFormat`).
- **Restrained, luxury-medical aesthetic**: hairline borders, generous
  whitespace, tabular numerics, soft warm neutrals with a deep-teal accent.
- **Local persistence**: inventory edits and COGS entries save to
  `localStorage` so reloads keep your state. Phase 2 swaps this for a real
  backend (Vercel + Supabase).
- **Deterministic mock data**: 90 days of seeded sales (~1,800 orders) and
  6 Meta campaigns so analytics tabs feel real before integrations land.

## Catalog

- Collagen Wound Dressing — 2"x2", 4"x4", 7"x7"
- Gauze Rolls
- Silicone Foam Dressing — 4"x4", 6"x6", 8"x8"
- Disposable Gloves
- Wound Wash
- Compression Socks (40 variants)
  - Versions: KHC, KHO, THC, THO (knee/thigh high × closed/open toe)
  - Sizes: 1–5
  - Colors: Black, Beige

## Run locally

Static site, ES modules — needs to be served over HTTP, not opened from disk:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or deployed via the included GitHub Pages workflow.

## Roadmap

- **Phase 1** *(this build)* — multi-tab UI, timezone, COGS/margins, mock data
  for sales/products/ads.
- **Phase 2** — move to Vercel + Supabase, wire Shopify Admin API for live
  orders + inventory, add login.
- **Phase 3** — Amazon SP-API integration.
- **Phase 4** — Meta Marketing API (spend, ROAS) plus UTM-based attribution.
