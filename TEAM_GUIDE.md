# Ovena Health Commerce Portal — Team Guide

A walkthrough of every tab, what the numbers mean, and how to use the portal day-to-day.

---

## What is this?

A single web dashboard for Ovena Health's commerce operations. It pulls together five views:

| Tab | What it covers | Status |
|---|---|---|
| **Inventory** | Stock on hand across Amazon and Shopify | ✅ Live |
| **Sales** | Revenue, orders, channel performance | 🟡 Sample data — Shopify integration coming |
| **Products** | Top sellers, category mix, sock variant analysis | 🟡 Sample data — same |
| **Ads** | Meta ad spend, ROAS, audience and angle insights | 🟡 Sample data — Meta integration later |
| **Margins** | Per-SKU profit and gross margin | ✅ Live (you enter cost data) |

Everything you edit on **Inventory** and **Margins** saves to a shared cloud database (Supabase) and is instantly visible to anyone else signed in on any device.

---

## Access

**URL:** https://ovena-health.vercel.app
**Password:** ask a teammate. Don't share it in chat or email.

### First sign-in

1. Open the URL in your browser.
2. After a brief logo splash, a login card appears.
3. Type the team password → click **Sign in**.
4. The dashboard loads. Your session stays signed in on this browser until you click **Sign out**.

If you ever get stuck on the loading screen, hard-refresh the page: **Cmd+Shift+R** on Mac, **Ctrl+Shift+R** on Windows/Linux.

---

## The sidebar (always visible)

- **Logo + "Commerce Portal"** at the top.
- **Five tabs:** Inventory · Sales · Products · Ads · Margins.
- **Live clock + date** in your local timezone (auto-detected).
- **Saved indicator** — a green dot with the time of your last save.
- **Sign out** button at the bottom — clears your session and returns to the login screen.

The clock and dates throughout the portal automatically convert UTC timestamps into whatever timezone you're in. So a teammate in California and one in New York both see the right local time without any setting.

---

## Tab 1 — Inventory ✅ Live

Where you track and edit stock across both sales channels.

### What's at the top

- **Hero number:** Total inventory on hand across every SKU and channel. Includes a callout if any SKUs are below their reorder level.
- **Four KPI cards:** Amazon Units · Shopify Units · Low Stock · On Watch.

### The catalog table

Multi-variant products are grouped to keep the table compact:

- **▸ Collagen Wound Dressing** (4 variants — 2×2, 4×4, 7×7, Powder)
- **Gauze Rolls** (single SKU)
- **▸ Silicone Foam Dressing** (3 variants — 4×4, 6×6, 8×8)
- **Disposable Gloves** (single SKU)
- **Wound Wash** (single SKU)
- **▸ Compression Socks** (40 variants)

Each grouped row shows a **breakdown summary** so you can see quantities at a glance even when collapsed:
- For dressings: `2×2 50 · 4×4 30 · 7×7 12 · Powder 18`
- For socks: `KHC 320 · KHO 280 · THC 200 · THO 180`

Click the chevron (▸) to expand a group. **Expand all / Collapse all** is in the toolbar.

### Editing

For every SKU, three columns are editable:
- **Amazon** — quantity currently on Amazon's marketplace.
- **Shopify** — quantity in your Shopify store.
- **Reorder** — the threshold for "low stock". When `Total < Reorder`, the row goes red.

Edits save automatically the moment you tab out of the field. The "Saved …" indicator in the sidebar updates to confirm.

### Status meanings

- **● Healthy** (green) — Total is comfortably above the reorder level.
- **● Watch** (amber) — Total is within 25% of the reorder level. Time to think about reordering.
- **● Low** (red) — Total is below the reorder level. Reorder now.

### Filters and tools

- **Search** matches SKU, product, variant, or category. Auto-expands groups whose children match.
- **Channel dropdown** filters to Amazon-only, Shopify-only, or both-stocked SKUs.
- **Reset** zeroes every Amazon and Shopify quantity (with confirmation). Reorder levels and COGS are preserved.
- **Export CSV** downloads the currently-filtered rows.

### When to use this tab

- Each morning to spot Low / Watch SKUs.
- After a stock count to update on-hand quantities.
- Before placing reorders.
- To export a snapshot for accounting / 3PL.

---

## Tab 2 — Sales 🟡 Sample data

What you'll see once Shopify and Amazon SP-API are wired in (next phase). Right now it shows a deterministic 90-day sample so you can preview the layout. Numbers will be replaced with real ones — the structure won't change.

### What's at the top

- **Period selector:** 7 days / 30 days / 90 days (default 30).
- **Hero:** Revenue for the period, with a **vs prior period** percentage delta and a **sparkline** showing daily trend.
- **Four KPI cards:** Orders · Avg order value · Shopify revenue · Amazon revenue.

### Charts

- **Revenue trend** — daily revenue line with date labels along the X axis.
- **Channel split** — stacked daily bars: Shopify (dark) at the bottom, Amazon (teal) on top.

### Recent orders table

Up to the most recent 50 orders in the window: timestamp (your timezone), order ID, channel, SKU, product, quantity, unit price, revenue.

### When to use this tab

- Watch revenue trend after promotions, ad pushes, or restocks.
- Compare Amazon vs Shopify performance.
- Spot a sudden dip or spike to investigate.

---

## Tab 3 — Products 🟡 Sample data

Identifies which SKUs are pulling weight and which compression-sock variants are most popular.

### What's at the top

- **Period selector** (same as Sales).
- **Hero:** Total **units sold** + the leading SKU + an at-a-glance sparkline.
- **Four KPI cards:** Revenue · Orders · SKUs sold (out of total) · Avg units per order.

### Top sellers table

Ranked 1-12 by units sold. Columns: rank, SKU, product, variant, units, orders, revenue, % of revenue.

### Category mix

Horizontal progress bars showing each category's share of revenue (Wound Care · Compression · Supplies).

### Compression sock breakdown

Three side-by-side bar charts:
- **By version** — KHC vs KHO vs THC vs THO popularity.
- **By size** — 1 through 5.
- **By color** — Black vs Beige.

This is how you'd quickly answer "are open-toe styles outselling closed-toe?" or "which sizes do we need to keep deeper stock on?"

### When to use this tab

- Quarterly product mix review.
- Deciding which SKUs to push in ad creative.
- Reorder prioritization (focus restocking budget on top sellers).

---

## Tab 4 — Ads 🟡 Sample data

Meta (Facebook/Instagram) ad performance, including which audiences and creative angles drive the most return.

### What's at the top

- **Period selector**.
- **Hero:** **Blended ROAS** (Return on Ad Spend) — total revenue divided by total spend across all campaigns. A 4× ROAS means $1 in ads earned $4 in revenue.
- **Four KPI cards:** Ad spend · Attributed revenue · Cost per acquisition (CPA) · Cost per click (CPC).

### Spend vs revenue chart

A two-line chart over time: spend (dark) and attributed revenue (teal). The bigger the gap (revenue above spend), the better.

### ROAS by campaign

Bar chart ranking each active campaign by ROAS. Higher bars = better return.

### Insight callout

A short auto-generated note like:
> **Wound Care — Clinical Authority** is your strongest campaign at **5.34× ROAS** — the **Wound Care Pros** audience with a **Clinical Authority** angle. Consider reallocating budget away from **Lookalike — Nurses LAL** (1.21× ROAS).

### Audience leaderboard

Aggregates spend, revenue, ROAS, CTR, CVR by **audience** across every campaign that targets it. Shows which target market is responding best.

### Angle leaderboard

Same idea, but grouped by **creative angle** (Clinical Authority, Athletic Recovery, Caregiver Reassurance, etc.). Tells you which message is converting.

### Per-campaign table

The full list of campaigns with all metrics — name, audience, angle, spend, impressions, clicks, CTR, conversions, CPA, ROAS.

### Glossary (so the table makes sense)

- **Impressions** — how many times the ad was shown.
- **Clicks** — how many people clicked through.
- **CTR (click-through rate)** — clicks / impressions. Higher = more compelling ad.
- **Conversions** — sales attributed to the ad.
- **CVR (conversion rate)** — conversions / clicks. Higher = the landing page closes the sale.
- **CPC (cost per click)** — spend / clicks.
- **CPA (cost per acquisition)** — spend / conversions. The cost to acquire one new customer.
- **ROAS** — revenue / spend. The multiplier.

### When to use this tab

- Weekly: which campaigns deserve more budget, which to cut.
- Before launching a new campaign: copy the audience + angle of your top performer.
- When ROAS dips: drill down to see which audience or angle is dragging.

---

## Tab 5 — Margins ✅ Live (you enter cost data)

The only tab where you enter cost-of-goods. Profit per unit and gross margin update live as you type.

### What's at the top

- **Period selector** (controls which sales window the gross profit reflects).
- **Hero:** **Estimated gross profit** for the period, with the **blended margin %** delta and a context line summarizing revenue and COGS coverage.
- **Four KPI cards:** Inventory at retail · Inventory at cost · Revenue (window) · COGS coverage (% of SKUs that have a COGS entered).

### COGS nudge

A bronze callout appears when SKUs are missing cost data:
> ⚠ 49 of 50 SKUs are missing a cost. Profit and margin reflect only SKUs with COGS entered.

### The per-SKU table

| Column | What it shows |
|---|---|
| SKU | The product code |
| Product / Variant | Name + size |
| Retail | Listed price (from the catalog seed) |
| **COGS** | **You enter this.** Cost to buy/produce one unit. |
| Margin / unit | Retail − COGS |
| **Margin %** | (Retail − COGS) / Retail · color-coded badge |
| Units sold | In the active period |
| Gross profit | Margin/unit × units sold |

### Margin badge colors

- **Green** — margin ≥ 50%
- **Amber** — margin 25–49%
- **Red** — margin < 25%

### Filters

- Search across SKU, product, variant.
- Filter dropdown: All · Missing COGS · COGS entered · Active in window.

### When to use this tab

- One-time: enter every SKU's cost when you onboard. Even rough estimates beat zero.
- Whenever wholesale costs change (new vendor, new contract).
- Before pricing decisions — see what margin a price change yields.
- Quarterly: confirm blended margin is hitting target.

---

## Common workflows

### Morning operations check (2 minutes)

1. Open **Inventory** → scan the hero status callout. Any SKUs Low?
2. If yes: order. Update the Amazon/Shopify quantities once stock arrives.

### Weekly Monday review (15 minutes)

1. **Sales** — set period to 7 days. Did revenue grow vs the prior week? Which channel drove it?
2. **Products** — same period. Any SKU shift in or out of the top 5?
3. **Ads** — review ROAS by campaign. Cut anything below 1.5×; double down on anything above 4×.
4. **Margins** — confirm blended margin is on target.

### Reorder decision

1. **Inventory** — find the Low / Watch SKU.
2. **Products** — sort by units sold to confirm demand.
3. **Margins** — verify the SKU is profitable enough to justify the buy.

---

## Data sources and freshness

| Tab | Source | Freshness |
|---|---|---|
| Inventory | You edit it | Instant — saves to the shared database the moment you tab out |
| Margins (COGS) | You edit it | Same |
| Sales | *(coming)* Shopify + Amazon SP-API | Will sync every 15 min |
| Products | *(coming)* Same | Will sync every 15 min |
| Ads | *(coming)* Meta Marketing API | Will sync hourly |

Until the integrations land, the Sales / Products / Ads tabs use a **deterministic sample** so the layout and interactions are real — only the numbers will swap.

---

## Privacy and security

- Sign-ins use a **shared team password**. Don't share it outside the team.
- Data is stored in **Supabase** (Postgres). No payment data, no customer PII — only inventory counts and product cost.
- **Sign out** clears your session on that device. Sign back in any time.
- Always sign out on shared computers.

If you suspect the password has been exposed, ask the admin to rotate it (Supabase → Authentication → Users → reset).

---

## Tips

- **Search is your friend.** Type any partial SKU, size, or product to filter the table fast. Auto-expands matching groups.
- **Hash-based URLs.** The active tab is reflected in the URL fragment (`/#sales`). You can bookmark a specific tab.
- **Hard-refresh after deploys.** If something looks wrong after I push an update, hard-refresh once (Cmd+Shift+R / Ctrl+Shift+R) to bypass cached files.
- **Mobile.** It works on a phone — the sidebar collapses to a top scroller. Editing is fiddly though; desktop is better for data entry.

---

## What's coming next

- **Phase 2b — Shopify live.** Real orders + inventory sync. Sales tab and the Shopify column on Inventory go live.
- **Phase 3 — Amazon live.** SP-API integration; Amazon column on Inventory and Amazon revenue on Sales become real.
- **Phase 4 — Meta live.** Marketing API for spend and ROAS; UTM-based attribution where possible.

---

## Help

If something is broken or confusing, message the admin (or whoever set up the portal). Include:

1. Which tab you were on.
2. What you clicked or typed.
3. What you expected vs what happened.
4. A screenshot if you have one.
