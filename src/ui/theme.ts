/**
 * Litti's shared look: dark #121212 canvas, near-white ink, lime accent, cream light surfaces,
 * pill buttons, soft long shadows, quick ease transitions. Albert Sans is bundled in
 * public/fonts (SIL OFL) and served by Litti itself — no third-party font requests.
 *
 * Pages keep their own variable names; THEME_TOKENS defines the palette they map onto.
 */

/** Same-origin font faces. `base` is '' in the app, or the site's base path on GitHub Pages. */
export function fontFaces(base = ''): string {
  return [400, 500, 600].map(w =>
    `@font-face{font-family:"Albert Sans";font-style:normal;font-weight:${w};font-display:swap;src:url("${base}/fonts/albert-sans-${w}.woff2") format("woff2")}`).join('');
}

/** Design tokens. */
export const THEME_TOKENS = `
--canvas:#121212;--canvas-2:#1a1a1a;--raised:#262626;--line:#2e2e2e;--line-hover:#5c5c5c;
--ink:#fafafa;--ink-mute:#c7c7c7;--ink-faint:#a3a3a3;--ink-dim:#8c8c8c;
--accent:#63fe13;--accent-ink:#121212;--accent-soft:rgba(99,254,19,.12);
--cream:#fdfff7;--cream-line:#dfe3d5;--cream-ink:#121212;
--ok:#63fe13;--bad:#ff6b5e;--warn:#ffd65c;--hot:#ff9f43;
--r-sm:12px;--r-md:16px;--r-lg:26px;--r-pill:999px;
--shadow:0 24px 48px -28px rgba(0,0,0,.55);--shadow-card:0 30px 60px -30px rgba(38,38,38,.4);
--ease:.16s ease;
--sans:"Albert Sans",Albert,Arial,system-ui,sans-serif;
--mono:"SF Mono","Cascadia Code","Fira Code",Consolas,monospace;
`;

/**
 * Base rules every app page shares: canvas, type scale, pill buttons, focus ring, motion,
 * and reduced-motion support. Pages add their own layout on top.
 */
export const THEME_BASE = `
html{-webkit-text-size-adjust:100%}
body{background:var(--canvas);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
h1{font-weight:500;letter-spacing:-1px}h2{font-weight:600;letter-spacing:-.6px}
a{transition:color var(--ease),opacity var(--ease)}
button,.btn{font-family:var(--sans);border-radius:var(--r-pill);transition:background var(--ease),color var(--ease),border-color var(--ease),opacity var(--ease),transform var(--ease)}
button:not(:disabled):active,.btn:active{transform:translateY(1px)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
::selection{background:var(--accent);color:var(--accent-ink)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
