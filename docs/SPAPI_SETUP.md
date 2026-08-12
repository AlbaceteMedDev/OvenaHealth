# FBA inventory via Amazon SP-API

Catchr's `amazon-seller` connector exposes 106 fields across Sales, Traffic
and Orders — and **nothing about stock**. No fulfillable quantity, no
inbound, no restock limits. So FBA inventory comes straight from Amazon's
Selling Partner API instead.

The good news: SP-API dropped the AWS SigV4 / IAM signing requirement in
2023. A Login with Amazon access token is now enough, which is why
`api/_lib/spapi.mjs` needs no AWS SDK and the portal stays dependency-free.

---

## 1. Create the SP-API application

You need a **Professional** selling account and Seller Central admin access.

1. Seller Central → **Apps & Services → Develop Apps**
   (`sellercentral.amazon.com/marketplacedeveloper/applications`).
2. If prompted, register as a developer. Choose **Private seller** — you're
   building this for your own account, not for distribution. Private-seller
   registration skips the app review that public apps need.
3. **Add new app client**:
   - **App name:** `Ovena Commerce Portal`
   - **API type:** SP-API
   - **Roles:** tick **Inventory and Order Tracking**. That's the only role
     the FBA Inventory API needs — don't request more. Roles covering PII
     trigger extra review and we don't read customer data.
   - **IAM ARN:** leave blank if the form allows it. It's no longer used for
     token-based auth.
4. Save. You'll get an **LWA client identifier** (`amzn1.application-oa2-client…`)
   and **client secret**.

---

## 2. Authorize the app and get a refresh token

Self-authorization is the quick path for a private app on your own account:

1. On the **Develop Apps** page, find your app → **Edit app** dropdown →
   **Authorize**.
2. Click **Generate refresh token**.
3. Copy the token (`Atzr|…`). **It's shown once.** Store it somewhere safe
   before leaving the page.

---

## 3. Set the environment variables

Vercel → project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `SPAPI_CLIENT_ID` | `amzn1.application-oa2-client.…` |
| `SPAPI_CLIENT_SECRET` | the client secret |
| `SPAPI_REFRESH_TOKEN` | `Atzr\|…` |
| `SPAPI_REGION` | `na` |
| `SPAPI_MARKETPLACE_ID` | `ATVPDKIKX0DER` |

Redeploy so the new values are picked up.

---

## 4. Verify

Dry run first — fetches from Amazon, writes nothing:

```
https://ovena-health.vercel.app/api/sync/fba?dry=1&secret=YOUR_CRON_SECRET
```

Expect something like:

```json
{ "ok": true, "dry": true, "fetched": 8, "written": 0, "unresolvedSkus": [] }
```

Then run it for real by dropping `&dry=1`. Reload the portal → **Inventory**.
The header should show an **FBA LIVE** badge, and the Amazon column becomes
read-only with real fulfillable quantities and an Inbound column beside it.

### If `unresolvedSkus` isn't empty

Amazon returned a seller SKU the catalog doesn't recognise. Map it:

```sql
insert into public.amazon_sku_map (amazon_sku, sku)
values ('THE-SELLER-SKU', 'CS-KHC-L-BLK')
on conflict (amazon_sku) do update set sku = excluded.sku;
```

Then re-run the sync. `CS-KHC-L-BLK-FBA` is already mapped this way by
migration `0004` — it's a second listing on the same ASIN as the L sock.

---

## Gotchas worth knowing

- **Rate limits.** FBA Inventory Summaries allows ~2 requests/second. The
  client paces itself between pages, so a full catalog sync takes a few
  seconds. Don't hammer the endpoint manually.
- **Refresh tokens expire if unused.** A refresh token goes stale after
  roughly a year of no use. The daily cron keeps it alive; if you pause the
  project for months, expect to re-generate it.
- **`fulfillable` ≠ sellable.** Amazon holds back reserved units (customer
  orders in progress, FC transfers). The Inventory tab shows fulfillable in
  the Amazon column and tracks reserved separately in `fba_inventory`.
- **One marketplace at a time.** The sync pulls `SPAPI_MARKETPLACE_ID` only.
  CA/MX/BR are authorized in Catchr but have no sales; add them here when
  that changes — and add currency conversion at the same time, or revenue
  totals will silently mix dollars with pesos.
- **This is snapshot data, not history.** `fba_inventory` is replaced on
  every sync. If you want stock-over-time, that's a new table.
