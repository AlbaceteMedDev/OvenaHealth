# Connecting Google Ads (and cleaning up Catchr)

Everything in this file has to happen in a browser under your own login —
OAuth consent can't be automated, and Catchr's connection flow needs a Google
account with access to the Ads account.

---

## 1. Delete the duplicate Amazon Ads source (do this first)

Catchr currently holds **two identical Amazon Ads authorizations**:

| Authorization | Platform | Accounts |
|---|---|---|
| `50417` | Amazon Ads | US, CA, MX, BR (8 entries) |
| `50731` | Amazon Ads | US, CA, MX, BR (identical) |

The sync job only reads `50731`, so today's numbers are correct. But if
anyone later adds `50417` to `CATCHR_AMAZON_ADS_ACCOUNTS`, every dollar of
spend gets counted twice and ACOS silently halves.

1. Catchr → **Sources**.
2. Find the two **Amazon Ads** rows.
3. Delete the one that is **not** `50731`. (Hover a source to see its id, or
   open it — the id is in the URL.)
4. If you delete the wrong one, update `CATCHR_AMAZON_ADS_ACCOUNTS` in Vercel
   to the surviving `authorization_id` instead of re-connecting.

---

## 2. Connect Google Ads to Catchr

1. Catchr → **Sources** → **Add a source**.
2. Pick **Google Ads**.
3. Sign in with the Google account that has access to the Ovena Health Ads
   account. Grant read access when prompted.
4. Back in the source list, confirm the Google Ads row shows **SUCCESS** and
   lists your account(s).

> If you manage the account through an MCC / manager account, Catchr will
> show both the manager and the child account. You want the **child**
> account id — the one that actually holds campaigns. A manager account
> returns no metrics of its own.

---

## 3. Tell the portal which Google Ads account to pull

> **Done as of 2026-08-12.** Google Ads is connected (authorization `50769`,
> account `3661776495` "Ovena Health") and verified returning data, and those
> ids are now the built-in default in `api/_lib/accounts.mjs`. No env var
> needed. The rest of this section only applies if the account changes.
>
> Also connected the same day but **not consumed by the portal**:
> Google Analytics 4 (`50770` / `properties/537744482`) and Google Merchant
> Center (`50771` / `5787103589`). There is no sync code for either — see
> "What isn't wired up" at the bottom.

If the account ever changes:

1. Get the ids. With `CRON_SECRET` set, hit:

   ```
   https://ovena-health.vercel.app/api/health?secret=YOUR_CRON_SECRET
   ```

   Or read them off the Catchr Sources screen: the **authorization id** for
   the connection and the **account id** for the Ads account.

2. Vercel → project → **Settings → Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `CATCHR_GOOGLE_ADS_ACCOUNTS` | `[{"id":"123-456-7890","authorization_id":50999,"currency":"USD","label":"Ovena Health"}]` |

   Use the account id **without dashes** if Catchr lists it that way — match
   whatever the Sources screen shows exactly.

3. Redeploy (env var changes need a new deployment to take effect).

4. Trigger a sync rather than waiting for the cron:

   ```
   https://ovena-health.vercel.app/api/sync/catchr?days=90&secret=YOUR_CRON_SECRET
   ```

5. Reload the portal → **Ads**. The Google Ads block should now list
   campaigns.

---

## 4. The attribution problem you need to know about

Google Ads and Meta both report conversions from **their own** tracking. They
cannot see an Amazon purchase. So if you run Google Ads traffic to an Amazon
listing:

- **Spend** will be accurate in the portal.
- **Attributed sales / conversions will read $0**, no matter how well the
  traffic converts.

That is not a bug in the sync — it's what the platform reports. The Ads tab
labels it rather than hiding it.

To actually measure off-Amazon traffic you need **Amazon Attribution**
(Amazon Ads console → Measurement → Attribution). It issues tagged URLs; you
point Google/Meta ads at the tagged URL instead of the plain listing, and
Amazon then reports clicks, detail page views and purchases per tag.

Two things to know before relying on it:

- Attribution tags are only available to brand-registered sellers. Ovena
  Health is brand registered (the listings run Sponsored Brands), so this
  should be available.
- Catchr's `amazon-ads` connector reports Sponsored Products / Brands /
  Display. Attribution is a **separate report type** and may not be exposed
  — check Catchr's field list for the connected Google Ads source before
  assuming the numbers will flow through automatically. If they don't, the
  Amazon Attribution console still shows them; they just won't reach the
  portal without extra work.

Until Attribution is wired up, judge off-Amazon channels on **TACOS** — total
ad spend over total Amazon revenue — which the Ads tab computes across every
platform. It's the honest number when per-platform attribution is blind.

---

## 5. What "good" looks like once it's running

`/api/health?secret=…` should report:

```json
{
  "env": { "CATCHR_API_KEY": true, "SUPABASE_SERVICE_ROLE_KEY": true },
  "accounts": { "amazonSeller": 1, "amazonAds": 1, "facebookAds": 2, "googleAds": 1 },
  "recentRuns": [{ "job": "catchr", "status": "ok", "rows_written": 1200 }]
}
```

A `status` of `partial` is not a failure — it means some platform returned
nothing, and the `detail` column on `sync_runs` says which. Google Ads with
no campaigns yet will show up exactly that way.

---

## 6. What isn't wired up

**Google Analytics 4** (`50770` / `properties/537744482`) and **Google
Merchant Center** (`50771` / `5787103589`) are connected to Catchr and
returning data, but the portal has **no sync code for either**. Connecting
them in Catchr does not make them appear in the portal.

Both are worth wiring, for different reasons:

- **GA4** is the only source that sees the DTC storefront. It reports
  ecommerce purchases and revenue that Amazon reporting knows nothing about,
  which means the portal's revenue figure is currently only part of the
  business. Useful fields: `sessions`, `activeUsers`, `ecommercePurchases`,
  `purchaseRevenue`, `itemName`, `itemRevenue`,
  `sessionDefaultChannelGroup`. Note GA4 rejects incompatible
  dimension/metric pairs — `itemName` + `addToCarts` fails, for example, so
  item-scoped and session-scoped fields have to be queried separately.
- **Merchant Center** carries feed health: `product_view.title`,
  `product_view.aggregated_destination_status`,
  `product_view.item_issues.issueType.code`, and account-level issues via
  `AccountStatusAccountLevelIssue.title`. That's what tells you whether
  Shopping ads can serve at all.

Adding either means: a new table in a migration, a new pull in
`api/sync/catchr.mjs`, a read in `js/data/live.js`, and somewhere to show it.
