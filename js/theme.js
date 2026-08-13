// Light / dark / auto, stamped on <html data-theme>.
//
// "auto" is resolved here in JS rather than with a prefers-color-scheme
// media query in CSS. A media query would mean writing the whole dark
// palette twice — once for the query, once for the explicit toggle — and
// two copies of a palette drift. Resolving here keeps exactly one
// [data-theme="dark"] block in the stylesheet.
//
// Per-browser on purpose: unlike the dashboard layout, which is shared
// because the team must be looking at the same numbers, a theme is a
// preference of the person and the room they're sitting in.

const KEY = "ovena.theme";
const MODES = ["auto", "light", "dark"];

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getMode() {
  const v = localStorage.getItem(KEY);
  return MODES.includes(v) ? v : "auto";
}

export function resolved(mode = getMode()) {
  return mode === "auto" ? (media.matches ? "dark" : "light") : mode;
}

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  localStorage.setItem(KEY, mode);
  apply();
}

function apply() {
  document.documentElement.dataset.theme = resolved();
  document.querySelectorAll("[data-theme-btn]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.themeBtn === getMode() ? "true" : "false");
  });
}

export function initTheme() {
  apply();
  // Follow the OS only while the user hasn't chosen a side.
  media.addEventListener("change", () => { if (getMode() === "auto") apply(); });

  document.querySelectorAll("[data-theme-btn]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.themeBtn)));
}
