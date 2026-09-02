// Evaluates every browser module for real, with its imports stubbed.
//
// Why: on Sep 2, 2026 a module read a const declared sixty lines below its
// first use — a temporal dead zone. It throws while EVALUATING, so main.js's
// import graph failed and every visitor sat on the boot screen. node --check
// passes syntax and cannot see that class of error; only evaluation can.
// The modules import browser-only code (supabase over a CDN, the DOM), so
// each import is replaced by a stub whose every export is a callable Proxy,
// and the DOM globals are Proxies too. Anything that throws at load is real.
//
// Run: node --experimental-vm-modules test/modules.test.mjs
import vm from "node:vm";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

// A value that survives any use: call it, construct it, read any property.
function anything() {
  const fn = function () { return anything(); };
  return new Proxy(fn, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : anything()),
    apply: () => anything(),
    construct: () => anything(),
    has: () => true,
  });
}

// Which names does `src` import from `spec`? Needed because a SyntheticModule
// must declare its export names up front.
function importedNames(src, spec) {
  const names = new Set(["default"]);
  const re = new RegExp(`import\\s+([^;]*?)\\s+from\\s+["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g");
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) for (const part of braces[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.add(n);
    }
    const star = clause.match(/\*\s+as\s+(\w+)/);
    if (star) names.add("*");
  }
  return names;
}

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
  Intl, Date, Math, JSON, Map, Set, Promise, Number, String, Array, Object, RegExp, Error,
  window: anything(), document: anything(), localStorage: anything(), sessionStorage: anything(),
  navigator: anything(), location: anything(), fetch: anything(), requestAnimationFrame: anything(),
  matchMedia: anything(), crypto: anything(), performance: anything(), AbortSignal: anything(),
  confirm: anything(), alert: anything(), CustomEvent: anything(), Blob: anything(), history: anything(),
});
ctx.globalThis = ctx; ctx.self = ctx;

export async function evaluateModule(file, src) {
  const mod = new vm.SourceTextModule(src, { identifier: file, context: ctx });
  await mod.link(async (spec) => {
    const names = [...importedNames(src, spec)].filter((n) => n !== "*");
    const stub = new vm.SyntheticModule(names, function () {
      for (const n of names) this.setExport(n, anything());
    }, { context: ctx, identifier: `stub:${spec}` });
    return stub;
  });
  await mod.evaluate();
}

let pass = 0, fail = 0;
// The exact shape that took the site down must throw.
try {
  await evaluateModule("repro", `const ROWS = [["x", "checked " + CHECKED]];\nconst CHECKED = "Sep 2";\nexport default ROWS;`);
  fail++; console.log("FAIL repro did not throw");
} catch { pass++; }
for (const file of walk("js")) {
  const src = readFileSync(file, "utf8");
  try { await evaluateModule(file, src); pass++; }
  catch (err) { fail++; console.log(`FAIL ${file}: ${String(err.message || err).slice(0, 160)}`); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
