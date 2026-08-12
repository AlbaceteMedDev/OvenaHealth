# Ovena Health Commerce Portal — Team Guide

A walkthrough of every tab, what the numbers mean, and how to use the portal day-to-day.

---

## What is this?

A single web dashboard for Ovena Health. **Each sales and ad channel gets its own tab, and Overview puts them together.**

| Tab | What it covers | Where the numbers come from |
|---|---|---|
| **Overview** | All channels combined | Everything below |
| **Amazon** | Sales, traffic, conversion, Sponsored Ads | Amazon Sales & Traffic + Amazon Ads |
| **Shopify** | Storefront revenue, net of refunds | Shopify Admin API |
| **Meta** | Facebook / Instagram ad spend | Meta Ads (via Catchr) |
| **Google** | Google Ads spend + Merchant Center feed health | Google Ads + Merchant Center |
| **Inventory** | FBA stock + warehouse stock | Amazon SP-API + your scans |
| **Scan** | Barcode receive / pick / count | You, with a scanner |
| **Margins** | Per-SKU profit and gross margin | Your COGS + units sold |

Everything you edit on **Inventory**, **Scan** and **Margins** saves to a shared cloud database and is instantly visible to anyone else signed in on any device. Everything else refreshes automatically.

---

## Two rules that apply everywhere

Every tab says this under its title, but it's worth stating once properly:

**1. Nothing before 19 July 2026 is included.** Anything earlier is pre-relaunch and would distort trends. Because that leaves only a few weeks of history, the time buttons are **7d / 14d / All** rather than 7/30/90 — and "14d" and "All" will often show the same number. That's expected, not a bug.

**2. Juzo sales are excluded.** The four Juzo listings ran for 16 days (6 orders, $230, 6–21 July) and were archived on 12 August. They're stripped from every channel so product mix reflects the Ovena Health line only.

---

## Gross vs net — the one thing to internalise

**Amazon** reports *ordered product sales*: what customers ordered, before refunds and before Amazon's referral and FBA fees.

**Shopify** reports *net of refunds*: money you actually kept.

These are different measures, and the Overview tab combines them, so treat its total as an **upper bound**.

Why this matters: Google Analytics also reports storefront revenue, and it is wrong in a specific way — it records a sale at checkout and never hears about the refund. In August it showed "Collagen Kit" as a $823.91 top seller. Shopify showed $441.95 gross and **$0.00 net** — every single Collagen Kit order had been refunded within days. The Shopify tab now leads with net and flags any product whose orders were entirely reversed, so that can't mislead you again.

---

## Access

**URL:** https://ovena-health.vercel.app
**Password:** ask a teammate. Don't share it in chat or email.

### First sign-in

1. Open the URL in your browser.
2. After a brief logo splash, a login card appears.
3. Type the team password → click **Sign in**.
4. The dashboard loads. Your session stays signed in on this browser until you click **Sign out**.

If you get stuck on the loading screen, hard-refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows/Linux).

---

## Reading the freshness badges

Every data-driven tab has a small badge next to its title:

- **● LIVE** (teal) — synced recently. Trust the numbers.
- **● STALE** (amber) — the last successful sync is more than 12 hours old, or the most recent attempt failed. The numbers shown are the last good ones. Tell the admin.
- **● NOT SYNCED** (grey) — this feed has never run. Tables will be empty.

Under the badge, a line tells you exactly when it last synced. **If that line looks old, don't make a decision on the number above it.**

---

## The catalog

Seven SKUs are live on Amazon.com:

| SKU | Product |
|---|---|
| `HC-ROLL5FT` | Hydrocolloid Roll 2" × 5 ft |
| `HC-ROLL16FT` | Hydrocolloid Roll 2" × 16 ft |
| `CS-KHC-S-BLK` | Compression Socks — knee high, closed toe, black, **S** |
| `CS-KHC-M-BLK` | …**M** |
| `CS-KHC-L-BLK` | …**L** |
| `CS-KHC-XL-BLK` | …**XL** |
| `SOCK-AID` | Sock Aid Device, 9.5 in |

The wound-care line — collagen dressings, collagen powder, gauze, silicone foam dressings, gloves, wound wash — is **stocked but not listed on Amazon**. Those SKUs still appear in Inventory and Margins so you can track warehouse stock and costs, tagged `unlisted`. They never appear on the Amazon tab, because there's nothing to report there.

---

## Tab: Inventory

Stock across Amazon FBA and the warehouse.

### What's at the top

- **Hero:** total inventory on hand, with a callout if any SKU is below its reorder level, plus how many units are inbound to Amazon.
- **Four KPI cards:** Amazon (FBA) · Inbound · Warehouse Units · Low Stock.

### The Amazon column has two modes

- **Once FBA syncing is set up**, the Amazon column shows Amazon's real fulfillable quantity and is **read-only** — Amazon owns that number, so editing it would just be a guess that looks like a fact. An **Inbound** column beside it shows units in transit to Amazon's warehouses.
- **If FBA syncing isn't set up yet**, the column stays an editable box exactly as before. The line under the tab title tells you which mode you're in.

The **Warehouse** and **Reorder** columns are always editable. Edits save the moment you tab out; the sidebar's "Saved …" indicator confirms.

### Status meanings

- **● Healthy** (green) — comfortably above the reorder level.
- **● Watch** (amber) — within 25% of the reorder level. Start thinking about reordering.
- **● Low** (red) — below the reorder level. Reorder now.

### Filters and tools

- **Search** matches SKU, **ASIN**, product, variant or category. Auto-expands matching groups.
- **Filter dropdown:** All · Listed on Amazon · Not listed · Amazon stock only · Warehouse only · Stocked on both.
- **Reset** zeroes every *manual* quantity (with confirmation). Live FBA numbers are unaffected — they come from Amazon.
- **Export CSV** downloads the filtered rows, including ASIN and whether each Amazon number is live or manual.

### When to use it

- Each morning, to spot Low / Watch SKUs.
- After a stock count.
- Before placing reorders.

---

## Tab: Scan

Barcode-driven warehouse counts. Three modes:

- **Receive** — adds units as stock arrives.
- **Pick** — subtracts units as they go out.
- **Count** — sets the shelf total directly during a stocktake.

Every scan is written to an append-only audit log, so you can always see who changed what and when. Unknown barcodes can be taught on the spot — scan, pick the SKU, and it's remembered.

---

## Tab: Overview

Everything in one place. Total revenue (Amazon + Shopify), total ad spend across all platforms, and **TACOS** — ad spend divided by total revenue.

Four channel tiles show each channel's contribution. Below them, a daily table breaks revenue down by channel with that day's TACOS.

**No blended ROAS is shown, deliberately.** Meta and Google can't see Amazon purchases, so a combined ROAS would be fiction. TACOS is the honest cross-channel number.

---

## Tab: Amazon

- **Hero:** ordered product sales, units, sessions, conversion rate.
- **KPIs:** ACOS · TACOS · average order value · refund rate.
- **Products table:** revenue, units, sessions, CVR, ad spend, ACOS, TACOS and contribution per SKU — Amazon's Sales & Traffic report joined to Sponsored Ads and your COGS.
- **Campaigns table:** spend, impressions, clicks, CTR, CPC, attributed sales, ACOS, ROAS.
- **Not selling:** listed SKUs with zero orders in the window.

Amazon is the only channel where ad spend can be tied to the product it sold, because Amazon Ads reports an advertised SKU. That's what makes per-product ACOS real here and impossible elsewhere.

**Contribution excludes Amazon's fees.** It's revenue minus product cost minus ad spend. Referral and FBA fees aren't in any feed the portal reads, so it's a ceiling on profit, not profit.

---

## Tab: Shopify

Leads with **net revenue** and shows gross beside it.

- **KPIs:** average order value · refunded · discounts · off-Amazon TACOS.
- **Products table:** net, gross, refunded, units, orders, average price — ranked by **net**, so anything fully refunded sinks to the bottom.
- A red callout names any product whose orders were all reversed.

---

## Tab: Meta

Spend, reach and campaigns for Facebook and Instagram.

Both ad accounts are connected but currently return no data — there's no active campaign. The empty state says so rather than looking broken.

---

## Tab: Google

Google Ads spend and campaigns, **preceded by Merchant Center feed health.**

That order is deliberate. As of 12 August the Merchant Center account is **suspended for Misrepresentation** and every product is disapproved, so Shopping ads cannot serve at all — while Search campaigns keep spending. The tab shows the suspension banner and per-product feed status first, so ad spend is never read in isolation.

### Why Meta and Google show $0 attributed revenue

Both attribute conversions through their own tracking. That tracking can see the **Shopify storefront** but is **blind to Amazon**. If a Google click buys on Amazon, the sale is invisible to Google.

So judge these channels on whether storefront revenue moves when you spend — not on their reported ROAS alone. Measuring off-Amazon traffic into Amazon properly requires Amazon Attribution tags.

### Glossary

- **CTR** — clicks ÷ impressions.
- **CPC** — spend ÷ clicks.
- **ACOS** — ad spend ÷ ad-attributed sales. **Lower is better.**
- **ROAS** — the inverse: attributed sales ÷ spend. **Higher is better.** 4× ROAS = 25% ACOS.
- **TACOS** — ad spend ÷ **total** revenue. The one that shows whether advertising is growing the business.

Colour coding on ACOS: green at or under 25%, amber to 40%, red above.

---

## Tab: Margins

The only tab where you enter cost-of-goods. Profit per unit and gross margin update live as you type.

- **Period selector** controls which sales window the gross profit reflects.
- **Hero:** estimated gross profit, blended margin %, revenue and COGS coverage.
- **KPI cards:** Inventory at retail · Inventory at cost · Revenue (window) · COGS coverage.
- **Per-SKU table:** Retail · **COGS (you enter)** · Margin/unit · Margin % · Units sold · Gross profit.

Margin badge colours: **green** ≥ 50%, **amber** 25–49%, **red** < 25%.

**Units sold comes from Amazon.** Unlisted SKUs will always show zero units — that's correct, they don't sell on Amazon.

**Amazon's fees are not deducted here either.** Gross profit is before Amazon's cut. For a rough sanity check, Amazon's referral fee on health products is typically 8–15%, and FBA fulfilment adds a per-unit fee on top.

### When to use it

- Once, at onboarding: enter every SKU's cost. Even rough estimates beat zero.
- Whenever wholesale costs change.
- Before pricing decisions.
- Quarterly, to confirm blended margin is hitting target.

---

## Common workflows

### Morning check (2 minutes)

1. **Inventory** — check the badge is LIVE, then scan the hero callout. Any SKUs Low?
2. If yes: order, and note the inbound column so you don't double-order next week.

### Weekly review (15 minutes)

1. **Sales**, 7 days — did revenue grow vs the prior week? Is conversion holding?
2. **Products** — did any SKU move in or out of the top group? Anything in "Not selling" that shouldn't be?
3. **Ads** — check TACOS first, then ACOS by campaign. Cut what's consistently above 40% ACOS unless you're deliberately buying launch velocity.
4. **Margins** — confirm blended margin is on target.

### Reorder decision

1. **Inventory** — find the Low / Watch SKU and check inbound quantity.
2. **Products** — confirm demand over 30 and 90 days, not just 7.
3. **Margins** — verify the SKU is profitable enough to justify the buy.

---

## Data sources and freshness

| Tab | Source | Freshness |
|---|---|---|
| Inventory (warehouse) | You / scans | Instant |
| Inventory (Amazon FBA) | Amazon SP-API | Daily |
| Margins (COGS) | You | Instant |
| Amazon | Amazon Sales & Traffic via Catchr | Every 6 hours |
| Meta, Google | Amazon Ads, Meta, Google via Catchr | Every 6 hours |
| Shopify | Shopify Admin API | Every 6 hours |

Amazon's own reporting lags: today's sales figures firm up over the following day, and the current day is usually incomplete. Don't read too much into a single day's number until it's settled.

---

## Privacy and security

- Sign-ins use a **shared team password**. Don't share it outside the team.
- Data is stored in **Supabase** (Postgres). No payment data, no customer PII — inventory counts, product costs, and aggregate sales figures only.
- **Sign out** clears your session on that device.
- Always sign out on shared computers.

If you suspect the password has been exposed, ask the admin to rotate it.

---

## Tips

- **Search is your friend.** Partial SKU, ASIN, size or product name all work.
- **Hash-based URLs.** The active tab is in the URL fragment (`/#sales`), so you can bookmark one.
- **Hard-refresh after deploys.** Cmd+Shift+R / Ctrl+Shift+R.
- **Mobile works**, but editing is fiddly — use desktop for data entry.
- **An empty table isn't always a bug.** Check the freshness line first: "not synced" means the feed hasn't run, which is a setup issue, not missing sales.

---

## Help

If something is broken or confusing, message the admin. Include:

1. Which tab you were on.
2. What the freshness badge said.
3. What you clicked or typed.
4. What you expected vs what happened.
5. A screenshot if you have one.
