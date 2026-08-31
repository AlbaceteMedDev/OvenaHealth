// Parsing a carrier print-history export. Pure — no network, no DOM.
//
// Split from postage.js so it can be tested with bare node: postage.js pulls
// in the Supabase client, which loads from a CDN over https and cannot be
// imported outside a browser. The parsing is the part with the sharp edges
// (date formats, quoted cells, reweigh adjustments, duplicate labels), so it
// is the part that has to be testable.

import { splitLine } from "./csv.js";
import { isExcludedShipper } from "./config.js";

// Header names, lowercased. Kept as lists because the same export has shipped
// under both Stamps.com and ShipStation headings.
const COL = {
  tracking: ["tracking #", "tracking number", "tracking"],
  date: ["date printed", "ship date", "date"],
  amount: ["amount paid", "amount", "postage"],
  adjust: ["adjusted amount", "adjustment"],
  carrier: ["carrier"],
  service: ["service"],
  weight: ["weight"],
  recipient: ["name", "recipient name"],
  refund: ["refund status"],
};

const pick = (header, names) => {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

const money = (v) => {
  const n = Number(String(v ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// The export writes dates as MM/DD/YYYY. Parsed by hand rather than through
// `new Date()`, which reads a bare "08/26/2026" in the browser's timezone and
// would move a label to the previous day west of UTC.
function isoDate(v) {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? String(v).trim() : null;
}

// Some columns arrive as ="01234" so a spreadsheet keeps the leading zero.
const clean = (v) => String(v ?? "").replace(/^="?|"?$/g, "").trim();

export function parseLabels(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim).map((h) => h.trim().toLowerCase());

  const iTrack = pick(header, COL.tracking);
  const iDate = pick(header, COL.date);
  const iAmt = pick(header, COL.amount);
  if (iTrack < 0 || iDate < 0 || iAmt < 0) return null;

  const iAdj = pick(header, COL.adjust);
  const iCar = pick(header, COL.carrier);
  const iSvc = pick(header, COL.service);
  const iWt = pick(header, COL.weight);
  const iRcp = pick(header, COL.recipient);
  const iRef = pick(header, COL.refund);

  const out = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const c = splitLine(line, delim);
    const tracking = clean(c[iTrack]);
    const date = isoDate(clean(c[iDate]));
    if (!tracking || !date) continue;
    // A tracking number repeated inside one file is the same label listed
    // twice, not two labels.
    if (seen.has(tracking)) continue;
    seen.add(tracking);

    const recipient = iRcp >= 0 ? clean(c[iRcp]) : "";
    out.push({
      tracking,
      date,
      // A carrier reweigh adjustment is money paid for that label.
      amount: money(clean(c[iAmt])) + (iAdj >= 0 ? money(clean(c[iAdj])) : 0),
      carrier: iCar >= 0 ? clean(c[iCar]) : "",
      service: iSvc >= 0 ? clean(c[iSvc]) : "",
      weight: iWt >= 0 ? clean(c[iWt]) : "",
      recipient,
      refund: iRef >= 0 ? clean(c[iRef]) : "",
      excluded: isExcludedShipper(recipient),
    });
  }
  return out.length ? out : null;
}

