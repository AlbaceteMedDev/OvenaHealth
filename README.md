# Ovena Health Commerce Portal

A multi-tab e-commerce ops dashboard for Ovena Health: inventory, sales,
product analytics, ad performance, and profit margins, all in one
sidebar-driven interface with timezone-aware live data.

## Tabs

- **Inventory** — Amazon and Shopify stock with editable quantities, reorder
  levels, low-stock detection, search/filter, and CSV export. **Live**
  (Supabase-backed).
- **Sales** — revenue trend, channel split (Amazon vs Shopify), AOV, and a
  recent-orders feed. *Mock data; Phase 2b wires Shopify Admin API and
  Phase 3 wires Amazon SP-API.*
- **Products** — top sellers, category mix, and compression-sock variant
  analysis (best version, size, color). *Mock data; goes live with Phase 2b.*
- **Ads** — Meta Business performance: spend vs attributed revenue, blended
  ROAS, audience and angle leaderboards, per-campaign metrics. *Mock data;
  Phase 4 wires Meta Marketing API.*
- **Margins** — manual COGS entry per SKU, live profit-per-unit, gross
  margin %, and blended margin across the active period. **Live.**

## Architecture

- **Frontend:** vanilla JS ES modules, no build step. Hosted on Vercel
  (`ovena-health.vercel.app`) and GitHub Pages
  (`albacetemeddev.github.io/OvenaHealth/`).
- **Backend:** Supabase (Postgres + Auth) for inventory & COGS persistence.
- **Auth:** single shared password. All sign-ins use a hardcoded service
  email + the team password.

## First-time setup

These steps only need to happen once per Supabase project / Vercel deployment.

### 1. Run the schema migration in Supabase

1. Open the Supabase project → **SQL Editor**.
2. Paste the contents of [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql) into a new query.
3. Run. It creates the `inventory_state` table, RLS policies, and seeds all 49 SKU rows.

The migration is idempotent — re-running it won't blow away data.

### 2. Disable email confirmation in Supabase Auth

The portal creates the team account on first sign-in. For that to work,
Supabase must not require email confirmation.

1. Supabase project → **Authentication → Providers → Email**.
2. Toggle **"Confirm email"** OFF. Save.

### 3. First sign-in

1. Visit https://ovena-health.vercel.app
2. Type the team password → **Sign in**. The first sign-in creates the
   shared `team@ovenahealth.app` account in Supabase Auth, signs you in,
   and persists the session locally.
3. Subsequent visits skip the login screen until you hit **Sign out**.

### 4. (Optional) Rotate the team password

If the team password was ever shared in an unsafe place (chat, email),
rotate it:

1. Supabase project → **Authentication → Users** → click `team@ovenahealth.app` →
   **Reset password** (or update via the dashboard).
2. Tell the team the new password out-of-band.

## Catalog

- Collagen Wound Dressing — 2"x2", 4"x4", 7"x7"
- Collagen Powder
- Gauze Rolls
- Silicone Foam Dressing — 4"x4", 6"x6", 8"x8"
- Disposable Gloves
- Wound Wash
- Compression Socks (40 variants)
  - Versions: KHC, KHO, THC, THO (knee/thigh high × closed/open toe)
  - Sizes: 1–5
  - Colors: Black (BLK), Beige (BGE)

50 total SKUs.

## Run locally

Static site, ES modules — needs to be served over HTTP, not opened from disk:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Roadmap

- **Phase 1** ✅ — multi-tab UI, timezone, COGS/margins, mock data for
  sales/products/ads.
- **Phase 1.5** ✅ — sidebar shell, hero metrics, design system overhaul.
- **Phase 2a** ✅ *(this build)* — Vercel hosting, Supabase backend, shared
  team password auth. Inventory and COGS now persist across devices.
- **Phase 2b** — Shopify Admin API integration via Vercel Functions cron.
  Sales tab and Inventory's Shopify column go live.
- **Phase 3** — Amazon SP-API integration.
- **Phase 4** — Meta Marketing API + UTM-based attribution.

## Project layout

```
.
├── index.html               # Page shell (boot splash, login, app)
├── styles.css               # Design system + components
├── js/
│   ├── main.js              # Entry: auth gate + tab routing + clock
│   ├── auth.js              # Sign-in / sign-out flow
│   ├── supabase.js          # Supabase client singleton
│   ├── config.js            # SUPABASE_URL, anon key, TEAM_EMAIL
│   ├── state.js             # In-memory cache + Supabase upserts
│   ├── format.js            # Timezone-aware formatters
│   ├── charts.js            # SVG chart helpers
│   ├── data/
│   │   ├── inventory.js     # SKU catalog seed
│   │   ├── sales.js         # Mock orders (deterministic)
│   │   └── ads.js           # Mock Meta campaigns (deterministic)
│   └── tabs/
│       ├── inventory.js
│       ├── sales.js
│       ├── products.js
│       ├── ads.js
│       └── margins.js
├── supabase/
│   └── migrations/
│       └── 0001_initial.sql # Schema + RLS + seed
└── .github/workflows/
    └── pages.yml            # GitHub Pages auto-deploy
```
