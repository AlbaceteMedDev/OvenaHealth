// All formatters honor the user's resolved IANA timezone.
// Detected once on load; can be overridden via setTimeZone().

let activeTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function getTimeZone() {
  return activeTz;
}

export function setTimeZone(tz) {
  activeTz = tz;
}

const dateFmt = () =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: activeTz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const timeFmt = () =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: activeTz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

const shortDateFmt = () =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: activeTz,
    month: "short",
    day: "numeric",
  });

const tzAbbrev = () =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: activeTz,
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value || activeTz;

export function fmtDate(input) {
  return dateFmt().format(toDate(input));
}

export function fmtShortDate(input) {
  return shortDateFmt().format(toDate(input));
}

export function fmtTime(input) {
  return timeFmt().format(toDate(input));
}

export function fmtDateTime(input) {
  const d = toDate(input);
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export function fmtTzAbbrev() {
  return tzAbbrev();
}

export function fmtCurrency(value, opts = {}) {
  const { compact = false, currency = "USD", maximumFractionDigits = 2 } = opts;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function fmtNumber(value, opts = {}) {
  const { compact = false, maximumFractionDigits = 0 } = opts;
  return new Intl.NumberFormat(undefined, {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function fmtPercent(value, opts = {}) {
  const { maximumFractionDigits = 1 } = opts;
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

// Truncate a Date to start-of-day in the active timezone, returning the
// year-month-day key. Useful for grouping timeseries by local day.
export function localDayKey(input) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: activeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(toDate(input));
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

export function todayKey() {
  return localDayKey(new Date());
}

function toDate(input) {
  if (input instanceof Date) return input;
  return new Date(input);
}
