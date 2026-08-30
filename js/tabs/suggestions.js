// Suggestions tab — the Aug 30, 2026 seller audit read against this portal's
// numbers: what to stop, what to protect, and the order to do it in. Static
// by design: it is a decision record, not a live feed, so it can never break
// a data tab. Refresh it by re-running the audit and replacing this file.

import { kpi } from "../ui.js";

const AS_OF = "Aug 30, 2026";

const ECON = [
  // sku, price, cogs, contrib, beAcos, beCpc  (real COGS from Margins; fees at
  // standard referral 15% (8% under $10) + FBA $4.66 socks documented,
  // $4.16–4.99 estimated elsewhere)
  ["Compression Socks (M/L/XL)", "$22.49", "$2.70", "$11.76", "52%", "$0.94 at 8% CVR"],
  ["Sock Aid", "$14.99", "$1.70", "$6.05", "40%", "$0.73 at 12% CVR"],
  ["Hydro Roll 5 ft", "$8.99", "$1.48", "$2.63", "29%", "$0.21 at 8% CVR"],
  ["Hydro Roll 16 ft", "$14.39", "$3.20", "$4.87", "34%", "$0.39 at 8% CVR"],
  ["Collagen 2x2", "$29.99", "$10.00", "$11.33", "38%", "$0.91 at 8% CVR"],
  ["Collagen 4x4", "$49.99", "$20.25", "$18.08", "36%", "$1.45 at 8% CVR"],
];

const HARVEST = [
  ["compression socks for nurses", "1 order, $134.94 from one click (6 units)", "Exact, bid $1.30–1.50"],
  ["knee high compression socks", "3 orders, 12% ACOS", "Exact, bid $1.50"],
  ["compression socks for women / for men", "7 orders combined, 31–52% ACOS", "Exact, bid $1.35–1.40"],
  ["20-30 mmHg phrasing family", "converts across variants", "Exact set, bid $1.50"],
  ["circaid / therafirm / jobst / dynaven / truform", "medical-brand conquest, 24–27% ACOS where it ran", "Exact + product targets, bid $1.60"],
  ["sock aid / compression sock aid", "28+ orders, best CPC in the account", "Exacts at $0.90–1.00"],
  ["wound collagen / puracol plus collagen wound dressing", "3 orders, 15–33% ACOS", "Exact, bid $1.70–1.80"],
];

const NEGATE = [
  ["Google: Generic | Wound Care + Generic | Compression + Competitor", "$1,601 spend, $38.98 sales since Jul 19", "Pause the campaigns"],
  ["hydrocolloid roll · hydrocolloid bandages (on the 5 ft)", "$123 spend, 1 order", "Negative on 5 ft; retest only on the 16 ft"],
  ["compression socks (bare, in Auto)", "$54, 0 orders", "Negative exact in Auto"],
  ["mens compression socks", "$31, 0 orders", "Negative exact"],
  ["pimple patches (patch intent, not roll)", "$24, 0 orders", "Negative exact in both Hydro campaigns"],
  ["Mighty Patch + FITFEL product targets", "$63, 0 orders", "Pause targets"],
  ["collagen wound dressing (inside Auto only)", "$21 in Auto, 0 orders there", "Negative phrase in Auto; keep the Discovery phrase, it converts"],
  ["juven · medias de compresión · sock donner", "$44 combined, 0 orders", "Negative phrase"],
];

const EXPERIMENTS = [
  ["Vine reviews lift conversion 25%+ on zero-review ASINs", "unit-session rate", "n/a (free NSP credits)"],
  ["16 ft roll converts 2x the 5 ft on roll queries", "ad CVR, ACOS", "stop if ACOS >150% at 60 clicks"],
  ["Top-of-search boost on Sock Aid holds ACOS ≤75%", "orders/day at ACOS", "revert after 5 days >100%"],
  ["Exact-harvest campaign beats source CPA by 30%", "CPA", "$15/term with no order"],
  ["2-pair sock pack halves effective CPC pressure", "CPA, AOV", "stop at CVR <3% after 80 clicks"],
  ["FBA-priority Buy Box lifts conversion", "fast-badge share, USP", "revert if Buy Box share drops >5 pts"],
  ["Medical-brand conquest beats lifestyle conquest 2x", "ACOS", "$30/target per 2 weeks"],
  ["Collagen restock doubles collagen conversion", "USP, Buy Box %", "n/a (restock is required anyway)"],
];

const RULES = [
  "Price the click before buying it: sustainable CPC = (price − referral − FBA − COGS) × CVR. Never let a $2 click near an $8.99 product.",
  "Judge ads by family TACoS, not campaign ACOS. Attributed sales credit sibling sizes.",
  "Placement mix is a P&L line. Product-page ACOS at 2x search ACOS means cut auto substitute and complement bids, not the campaign.",
  "Harvest weekly at 2+ orders and ≤1.5x break-even. Negate at $12–15 spend with zero orders, never on three clicks.",
  "Reviews before reach. Under ~10 reviews, paid traffic is expensive proofless traffic. Vine first, scale second.",
  "Fight only where the query's clicked-price median matches the offer, or change the offer (2-pack).",
  "Amazon's budget recommendations optimize Amazon's revenue. Check them against break-even before applying.",
  "If MFN holds the Buy Box while FBA is stocked, the Prime badge the category converts on is silently lost.",
  "Attribution lag here is minutes, not days. Three-day-old data is decision-grade.",
  "Reconcile Business Report, month summary, and orders monthly. This month they matched to the cent.",
];

function rows(list, cells) {
  return list.map((r) => `<tr>${cells(r)}</tr>`).join("");
}

export function mountSuggestions(el) {
  el.innerHTML = `
    <div class="tab-header">
      <div class="titles">
        <h2>Suggestions</h2>
        <p>The ${AS_OF} seller audit read against this portal's measured costs: what to stop, what to protect, and the order to do it in.
        <span class="muted-inline">Static decision record, not a live feed. Amazon figures cover Jul 30 to Aug 28 (SP, 7-day attribution);
        money lines use this portal's P&amp;L since Jul 19. Costs are real: supplier-invoice COGS from the Margins tab plus standard
        referral and FBA rates going forward.</span></p>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpi("Net profit, measured", "−$4,296.46", "all channels since Jul 19", "down")}
      ${kpi("Break-even TACoS", "≈45%", "at real COGS + full Amazon fees")}
      ${kpi("Amazon TACoS, last 7 days", "81%", "from 158% two weeks ago", "up")}
      ${kpi("Cost per new customer", "≈$27", "98% of ad purchases are new to brand")}
    </div>

    <div class="insight">
      <span class="ico">◆</span>
      <div class="body">
        <strong>The verdict:</strong> the account is one pruning cycle from a defensible launch curve. Revenue is compounding
        (record days Aug 27–28) and conversion doubled in two weeks, but three pockets of spend can never pay back at current
        prices: Google generic search, the 5 ft Hydro Roll on $2 clicks, and product-page placements nobody has adjusted.
        Cutting those funds the conversion fixes (reviews, restock, Buy Box) that move every remaining dollar.
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Stop or reduce</h3><span class="hint">≈ $3,400–4,400/mo of spend, minimal revenue at risk</span></div>
      <div class="card-body flush"><div class="table-wrap">
        <table>
          <thead><tr><th>Move</th><th>Evidence</th><th class="num">Monthly effect</th></tr></thead>
          <tbody>
            <tr><td class="ink">Pause Google generic + competitor campaigns; rebuild Shopping lean or pause</td>
                <td class="muted">$2,171 spend returned $277 since Jul 19 (Wound Care ACOS 5,720%, Compression 2,819%)</td>
                <td class="num val-good">+$1,500–2,000</td></tr>
            <tr><td class="ink">Restructure Hydro Roll: budgets to $25–35/day, hero ASIN to the 16 ft, 5 ft off category terms</td>
                <td class="muted">$1,800 spend for $672 sales; 5 ft break-even CPC is ≈$0.21 vs ≈$2.00 paid</td>
                <td class="num val-good">+$1,300–1,700</td></tr>
            <tr><td class="ink">Pause dead auto groups (Collagen substitutes + complements, Socks complements); bid down CS close-match</td>
                <td class="muted">product pages: $933 spend, $216 sales, 433% ACOS; placement modifiers are all unset</td>
                <td class="num val-good">+$300–400</td></tr>
            <tr><td class="ink">Bulk negative list (below)</td>
                <td class="muted">proven dead terms with real spend</td>
                <td class="num val-good">+$250–350</td></tr>
          </tbody>
        </table>
      </div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Protect or scale</h3><span class="hint">do not shock total spend down more than ~30% in one step</span></div>
      <div class="card-body">
        <ul class="plain-list">
          <li><strong>Sock Aid, both campaigns.</strong> ACOS 73% and 54% against a 40% hurdle, best CPC in the account ($1.15), and it hit its budget cap in week one. Scale after Vine reviews land.</li>
          <li><strong>Compression Socks Auto, substitutes target.</strong> 45 orders at 98% ACOS. It is the family's engine and feeds size-switch sales to L and XL. Trim the bid, keep the target.</li>
          <li><strong>The converting sock phrases.</strong> for women, for men, 20-30 mmHg set, nurses. Move them to exact and fund them first.</li>
          <li><strong>Brand defense.</strong> 8% ACOS at $0.58 CPC. Raise top-of-search share toward 60%+.</li>
        </ul>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Fix conversion before scaling anything</h3><span class="hint">6 reviews across the whole catalog</span></div>
      <div class="card-body">
        <ul class="plain-list">
          <li><strong>Vine now</strong> for Sock Aid, Collagen 4x4, and the 16 ft roll. The New Selection Program enrollment includes Vine credits that are going unused.</li>
          <li><strong>Restock collagen FBA.</strong> All three collagen SKUs show zero FBA units; the powder's FBA offer is inactive and its Buy Box sits at 74.6%.</li>
          <li><strong>Socks L rating.</strong> 3.66 stars raw with ~11% refunds. Put calf-width and firmness guidance high on the page and fix the fit story.</li>
          <li><strong>Hold the Buy Box with FBA.</strong> MFN won about half of order lines at equal price, which drops the Prime badge. Price MFN $0.50–1.00 above FBA while FBA is stocked.</li>
          <li><strong>Check powder pricing.</strong> At the $30 selling price seen on Amazon with $22.60 COGS on file, each unit loses ≈$1.26 before ads. Verify the COGS entry, then reprice or stop promoting it.</li>
        </ul>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Unit economics at real COGS</h3><span class="hint">break-even ACOS = pre-ad contribution ÷ price</span></div>
      <div class="card-body flush"><div class="table-wrap">
        <table>
          <thead><tr><th>Product</th><th class="num">Price</th><th class="num">COGS</th><th class="num">Contribution/unit</th><th class="num">Break-even ACOS</th><th class="num">Break-even CPC</th></tr></thead>
          <tbody>
            ${rows(ECON, (r) => `<td class="ink">${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num"><b>${r[3]}</b></td><td class="num"><b>${r[4]}</b></td><td class="num muted">${r[5]}</td>`)}
            <tr><td class="ink">Collagen Powder</td><td class="num">$39.99 list</td><td class="num">$22.60</td>
                <td class="num"><b>$7.23</b> at list · <span class="val-bad">−$1.26 at $30 ASP</span></td>
                <td class="num"><b>18%</b></td><td class="num muted">do not advertise until repriced</td></tr>
          </tbody>
        </table>
      </div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Harvest into exact match</h3><span class="hint">bids from contribution × conversion, not from suggestions</span></div>
      <div class="card-body flush"><div class="table-wrap">
        <table>
          <thead><tr><th>Term / theme</th><th>Why</th><th>Action</th></tr></thead>
          <tbody>${rows(HARVEST, (r) => `<td class="ink">${r[0]}</td><td class="muted">${r[1]}</td><td>${r[2]}</td>`)}</tbody>
        </table>
      </div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Negate or pause</h3><span class="hint">threshold: ≈$12–15 spend with zero orders, never three clicks</span></div>
      <div class="card-body flush"><div class="table-wrap">
        <table>
          <thead><tr><th>Target</th><th>Evidence</th><th>Action</th></tr></thead>
          <tbody>${rows(NEGATE, (r) => `<td class="ink">${r[0]}</td><td class="muted">${r[1]}</td><td>${r[2]}</td>`)}</tbody>
        </table>
      </div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>The order of operations</h3><span class="hint">ranked by profit impact ÷ effort</span></div>
      <div class="card-body">
        <div class="roadmap-cols">
          <div>
            <h4>Next 7 days</h4>
            <ol class="plain-ol">
              <li>Pause Google generics + competitor</li>
              <li>Hydro Roll restructure (16 ft hero)</li>
              <li>Pause dead auto groups</li>
              <li>Bulk negatives</li>
              <li>Launch Winners Exact campaigns</li>
              <li>Vine: Sock Aid, 4x4, 16 ft</li>
              <li>Collagen FBA shipment + powder FBA</li>
            </ol>
          </div>
          <div>
            <h4>Days 8–30</h4>
            <ol class="plain-ol">
              <li>Bid glide-path toward break-even CPCs</li>
              <li>MFN pricing policy (FBA holds Buy Box)</li>
              <li>Socks L fit story + sizing imagery</li>
              <li>2-pair sock pack ASIN for generic queries</li>
              <li>Medical-brand conquest ad group</li>
              <li>Reallocate budget to Sock Aid + Collagen</li>
            </ol>
          </div>
          <div>
            <h4>Days 31–90</h4>
            <ol class="plain-ol">
              <li>Scale 3-week winners, kill two-time losers</li>
              <li>Recovery Kit bundle test (socks + sock aid)</li>
              <li>Subscribe &amp; Save on collagen + 16 ft</li>
              <li>Sponsored Brands once 15+ reviews on two heroes</li>
              <li>7x7 collagen B2B decision</li>
              <li>5 ft roll price test ($9.99–10.99)</li>
            </ol>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Experiment backlog</h3><span class="hint">every test carries a stop-loss</span></div>
      <div class="card-body flush"><div class="table-wrap">
        <table>
          <thead><tr><th>Hypothesis</th><th>Primary KPI</th><th>Stop-loss</th></tr></thead>
          <tbody>${rows(EXPERIMENTS, (r) => `<td class="ink">${r[0]}</td><td>${r[1]}</td><td class="muted">${r[2]}</td>`)}</tbody>
        </table>
      </div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Decision rules to keep</h3><span class="hint">the repeatable part of the audit</span></div>
      <div class="card-body">
        <ol class="plain-ol rules">${RULES.map((r) => `<li>${r}</li>`).join("")}</ol>
      </div>
    </div>

    <p class="floor-note">Compiled ${AS_OF} from the Seller Central report archives (targeting, search term, placement, budget,
    business reports, Brand Analytics week 34, orders and listings snapshots) plus this portal's measured revenue, fees, COGS and
    all-channel ad spend. Fee caveats carried through: settlements lag, the FBA storage rate is unset, and 5 units lack COGS.</p>
  `;
}
