// One delimited-line splitter, shared by every importer.
//
// It lives alone in its own module because both importers are worth testing
// with bare node, and anything that reaches js/supabase.js cannot be: that
// module loads the client from a CDN over https, which the ESM loader
// refuses outside a browser. Keeping the parsing free of that import is what
// makes test/postage.test.mjs possible.
//
// Handles RFC-4180 quoting: doubled quotes inside a quoted cell are a
// literal quote, and a delimiter inside quotes is not a delimiter. Both
// matter here — a carrier export puts the whole address in one quoted,
// comma-laden cell.

export function splitLine(line, delim) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
