// Guards against the outage of Sep 2, 2026: a module referenced a `const`
// declared sixty lines below the code that used it. That is a temporal dead
// zone — the module throws while EVALUATING, main.js's import graph fails,
// and every visitor sits on the boot screen. `node --check` passes syntax
// and cannot see it; the modules import browser-only code, so Node cannot
// evaluate them either. This is the cheap static stand-in: for every
// top-level const/let, no earlier top-level line may reference its name.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

// Top level = depth 0 in braces/parens/brackets, outside strings/comments.
function topLevelLines(src) {
  const out = [];
  let depth = 0, inStr = null, inBlock = false, inLine = false, tmplDepth = [];
  const lines = src.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const startDepth = depth;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], next = line[i + 1];
      if (inLine) break;
      if (inBlock) { if (c === "*" && next === "/") { inBlock = false; i++; } continue; }
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "/" && next === "/") { inLine = true; break; }
      if (c === "/" && next === "*") { inBlock = true; i++; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if ("({[".includes(c)) depth++;
      else if (")}]".includes(c)) depth--;
    }
    inLine = false;
    if (startDepth === 0) out.push({ n: n + 1, text: line });
  }
  return out;
}

export function tdzViolations(src) {
  const top = topLevelLines(src);
  // strings and comments stripped for identifier matching
  const strip = (s) => s.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  const decls = [];
  for (const { n, text } of top) {
    const m = strip(text).match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) decls.push({ name: m[1], line: n });
  }
  const bad = [];
  for (const d of decls) {
    const re = new RegExp(`(?<![\\w$.])${d.name}(?![\\w$])`);
    for (const { n, text } of top) {
      if (n >= d.line) break;
      if (re.test(strip(text))) bad.push({ name: d.name, declared: d.line, usedAt: n });
    }
  }
  return bad;
}

let pass = 0, fail = 0;
// 1. The exact shape that took the site down must be caught.
const repro = `const ROWS = [["x", "checked " + CHECKED]];\nconst CHECKED = "Sep 2";\n`;
const caught = tdzViolations(repro);
if (caught.length === 1 && caught[0].name === "CHECKED") pass++; else { fail++; console.log("FAIL repro not caught", caught); }
// 2. A forward reference inside a function body is fine (hoisting at call time).
const ok = `function f() { return LATER; }\nconst LATER = 1;\n`;
if (tdzViolations(ok).length === 0) pass++; else { fail++; console.log("FAIL false positive on function body"); }
// 3. Every real module.
for (const file of walk("js")) {
  const v = tdzViolations(readFileSync(file, "utf8"));
  if (v.length) { fail++; console.log(`FAIL ${file}: ${v.map((x) => `${x.name} used line ${x.usedAt}, declared ${x.declared}`).join("; ")}`); }
  else pass++;
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
