/** Static website (GitHub Pages) build: landing page, every docs page, links under the base path. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/build-site.js';
import { ORDER, loadPage, renderDocsPage } from '../src/docs/site.js';

let passed = 0;
function step(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const tmp = mkdtempSync(join(tmpdir(), 'litti-site-'));
const out = join(tmp, '_site');
try {
  const r = buildSite(out, 'https://example.github.io/litti/');
  const file = (rel: string) => join(out, rel);
  const pages = new Map<string, string>([['index.html', readFileSync(file('index.html'), 'utf8')], ['404.html', readFileSync(file('404.html'), 'utf8')]]);
  for (const p of ORDER) {
    const rel = p.slug === 'index' ? 'docs/index.html' : `docs/${p.slug}/index.html`;
    pages.set(rel, readFileSync(file(rel), 'utf8'));
  }

  step('landing page, every docs page, 404 and assets are built', () => {
    assert.equal(r.base, '/litti/');
    assert.match(pages.get('index.html')!, /npm install -g litti/);
    assert.match(pages.get('index.html')!, /litti demo/);
    assert.ok(!pages.get('index.html')!.includes('%SITE_URL%'), 'site URL substituted');
    for (const p of ORDER) assert.match(pages.get(p.slug === 'index' ? 'docs/index.html' : `docs/${p.slug}/index.html`)!, /aria-current="page"/, p.slug);
    for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'brand/litti-logo.svg', 'social-preview.png', '.nojekyll']) assert.ok(existsSync(file(f)), f);
  });

  step('no link escapes the base path; every internal link resolves to a built file', () => {
    for (const [rel, html] of pages) {
      for (const m of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
        const u = m[1];
        if (/^(https?:|mailto:|#)/.test(u)) continue;
        assert.ok(!u.startsWith('/docs') && !u.includes('/litti/litti/'), `${rel}: bad base path: ${u}`);
        if (u.startsWith('/')) assert.ok(u.startsWith('/litti/'), `${rel}: root link outside base: ${u}`);
        const path = (u.startsWith('/litti/') ? u.slice('/litti/'.length) : join(rel, '..', u).replace(/\\/g, '/')).split('#')[0];
        const target = path === '' || path === '.' || path.endsWith('/') ? join(path, 'index.html') : path;
        assert.ok(existsSync(file(target)), `${rel}: ${u} → missing ${target}`);
      }
    }
  });

  step('search index uses base-path URLs', () => {
    const m = (pages.get('docs/index.html') ?? '').match(/const IDX=(\[.*?\]);/s);
    assert.ok(m, 'search index embedded');
    const idx = JSON.parse(m[1]) as Array<{ u: string }>;
    assert.equal(idx.length, ORDER.length);
    for (const e of idx) assert.match(e.u, /^\/litti\/docs\/([a-z0-9-]+\/)?$/);
  });

  step('in-app rendering is unchanged (no base → /docs links)', () => {
    const html = renderDocsPage(loadPage('install')!);
    assert.match(html, /href="\/docs\/cli"/);
    assert.match(html, /src="\/brand\/litti-logo.svg"/);
    assert.ok(!html.includes('"/litti/'), 'no base-path links');
  });

  step('refuses to wipe a folder that is not a previous build', () => {
    assert.throws(() => buildSite(tmp + '/..', 'https://example.github.io/litti/'), /refusing/);
    assert.throws(() => buildSite(join(process.cwd(), 'src')), /refusing/);
  });
  console.log(`\nsite: ${passed} passed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
