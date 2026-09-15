# Cost basis — where every number in `inventory_state` comes from

Last verified **2026-09-15** against the supplier documents in the Ovena
SharePoint (`sites/Ovena/Shared Documents/Ovena/`). This file records
provenance only; it deliberately contains no attachments.

Two columns are costed per retail unit sold:

| column | meaning |
|---|---|
| `cogs` | supplier price for one retail unit |
| `ship_cost` | inbound freight to the warehouse, per retail unit |

`ship_cost` is charged **only where the supplier invoice does not already
include delivery**. Getting that distinction wrong is the most likely way to
corrupt this table — see Hydrocolloid below.

## Verified against supplier invoices

| SKU | cogs | ship_cost | document |
|---|---|---|---|
| CWD-2X2 | 10.00 | 0.527 est. | Foryou PI FY-PIUS00900-0001A |
| CWD-4X4 | 20.25 | 1.058 est. | Foryou PI FY-PIUS00900-0001A |
| CWD-PWD | 22.60 | 1.109 est. | Foryou PI FY-PIUS00900-0001A |
| HC-ROLL5FT | 1.48 | **0** | Nantong YOJO, DDP |
| HC-ROLL16FT | 3.20 | **0** | Nantong YOJO, DDP |
| SOCK-AID | 1.70 | 0.2375 | Gaixie PI CGXUSA0602 |
| SALINE-WASH | 0.99 | 1.0167 | Wenzhou Shengkai PI YXJ05162026 |
| CS-KHC-* | 2.55 | 0.09 | **no invoice — see below** |

### Collagen — Huizhou Foryou, PI FY-PIUS00900-0001A (2026-01-05)
6,000 units, $56,020.00, **FOB Shenzhen**. Per piece $2.00 (2x2), $4.05
(4x4), $4.52 (particles); every collagen listing is a 5-count, so cogs is
5x the per-piece price. The 178x178mm line ($20.70/pc, 2,000 pc, $41,400 =
73.9% of the invoice) is excluded — that size is discontinued.

Freight terms are confirmed twice: the PI states FOB Shenzhen, and signed
Supply Agreement **FYUS00905-01** (Ovena Health LLC / Huizhou Foryou,
effective 2023-07-01, valid to 2029-04-22) says at V.2 *"SUPPLIER shall
deliver the Products [FOB Shenzhen] according to the Incoterms 2010"*.

So the freight is real, is Ovena's to pay, and is **not** on the invoice.
**No freight-forwarder invoice exists in the SharePoint export**, so the
`ship_cost` figures above are still the first-order workbook's estimates.
They are at least coherent: against the shipped weights in
`Product Details.xlsx` (35 g / 75 g / 85 g) they work out to $0.0151,
$0.0141 and $0.0131 per gram — weight-proportional within 15%, i.e. an
allocation rather than a guess. **This is the largest undocumented number
left in the catalog.** To close it, find the forwarder/customs invoice for
the January 2026 collagen shipment.

### Hydrocolloid — Nantong City YOJO
$1.4800 and $3.2000 per piece, 1,000 each, **total $4,680.00**, Incoterms
**DDP**. 1,480 + 3,200 = 4,680 exactly: there is no separate freight line
because delivery is already inside the unit price. `ship_cost` is therefore
0 for both. It previously carried the workbook's 0.321 / 0.589, which
double-charged freight; corrected 2026-09-15 ($68.39 of cost removed).

### Sock Aid — Guangxi Gaixie Plastic, PI CGXUSA0602 (2026-06-03)
$1.70/pc x 2,000 = $3,400, with **freight billed separately at $475** →
$0.2375/unit. Freight is charged here precisely because this invoice lists
it as its own line. Paid through Alibaba.

### Saline — Wenzhou Shengkai, PI YXJ05162026 (2026-05-16)
3,000 **boxes** @ $0.99 EXW = $2,970, plus a separate "DDP SHIPPING" line of
$3,050 → $1.0167/box. Retail unit is a 20-count box of 15 mL ampoules
(ASIN B0HHMXT8TX, $15.99). The 3,000 are boxes, not ampoules: 20 x $0.99
would be $19.80 against a $15.99 retail, i.e. a loss, and the workbook names
the box explicitly at the same $0.99 / $1.017.

Note this invoice is *also* DDP but lists shipping separately, unlike YOJO
where it was baked into the unit price. Charging freight here is correct.

## Not invoice-backed

### Compression socks — CS-KHC-M / L / XL / S
`cogs` 2.55, `ship_cost` 0.09. **No purchase invoice has been located.**
Searched: the full SharePoint export, Gabe's Outlook cache (5,413
attachments back to 2025-12) and Teams — zero hits for any sock supplier.
The ProMed QuickBooks file holds no Ovena purchases at all (94 vendors, no
overseas manufacturers); the China orders were paid through Alibaba and
never booked as vendor bills.

Source is the first-order workbook, which listed $2.704. That figure
included a bundled garment cleanser at $0.154; the cleanser was dropped
("removed due to high MOQ"), confirmed by Gabe on 2026-09-15, so cogs is
2.704 - 0.154 = **2.55**. `cogs` is `numeric(10,2)` and could never have
stored 2.704 exactly in any case.

Treat this as the least reliable cost in the table. The same workbook was
wrong by roughly 10% on both the sock aid ($1.80 vs $1.70 invoiced) and the
5 ft roll ($1.65 vs $1.48), in opposite directions.

**Supplier identified but not yet contacted:** `Product Details.xlsx` names
the sock manufacturer as **Zheijiang Compports Sports Socks**, manufacturer
number **H3416**. That is the lead for obtaining the invoice.

## Where supplier documents live

`sites/Ovena/Shared Documents/Ovena/Manufacturer Purchase Agreements/` and
`.../ALL PRODUCTS/Manufacturing Cost/`, plus `.../Ovena Manufacturing Docs/`
for the signed supply agreement. Invoices are billed to **Harold Gaines /
ProMed Health Plus**, and the SharePoint tenant is `promedhealthplus.com`,
so supplier correspondence sits in Harold's or Katy's mailbox rather than
Gabe's.

## Still uncosted

FBA storage has no rate on file, which is why the P&L headline can read
"Partial result" rather than "Net profit".
