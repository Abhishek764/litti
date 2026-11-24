/**
 * Builds the public website (GitHub Pages) as static files:
 *   /                 landing page from site/index.html
 *   /docs/<slug>/     every docs/guide page, rendered with src/docs/site.ts
 *   /404.html         not-found page
 * Usage: npx tsx scripts/build-site.ts [outDir]   (default _site)
 * Env:   LITTI_SITE_URL  public URL of the site (default https://abhishek764.github.io/litti/).
 *        Its path ("/litti/") becomes the base for every link.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ORDER, loadPage, renderDocsPage } from '../src/docs/site.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SITE_URL = 'https://abhishek764.github.io/litti/';

export interface BuildResult { outDir: string; base: string; files: string[] }

export function buildSite(outDir: string, siteUrl = DEFAULT_SITE_URL): BuildResult {
  const u = new URL(siteUrl.endsWith('/') ? siteUrl : siteUrl + '/');
  const base = u.pathname;
  const files: string[] = [];
  const write = (rel: string, body: string) => {
    const file = join(outDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    files.push(rel.replace(/\\/g, '/'));
  };

  // Only ever wipe a previous build: refuse the repo itself, its parents, a filesystem root,
  // or any non-empty folder that isn't one of our builds (no .nojekyll marker).
  const out = resolve(outDir);
  const toRoot = relative(out, ROOT); // '' or no '..' prefix: the repo is inside (or is) outDir
  if (out === dirname(out) || !toRoot.startsWith('..') && !isAbsolute(toRoot))
    throw new Error(`refusing to build into ${out}`);
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, '.nojekyll')))
    throw new Error(`refusing to overwrite ${out}: not empty and not a previous site build`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  write('index.html', readFileSync(join(ROOT, 'site', 'index.html'), 'utf8').replaceAll('%SITE_URL%', u.href));

  for (const p of ORDER) {
    const page = loadPage(p.slug);
    if (!page) throw new Error(`docs page missing: docs/guide/${p.slug}.md`);
    write(p.slug === 'index' ? 'docs/index.html' : `docs/${p.slug}/index.html`, renderDocsPage(page, { base }));
  }
  write('404.html', renderDocsPage({ slug: 'index', title: 'Page not found', html: `<p>That page doesn’t exist. <a href="/docs">Back to the docs</a>.</p>`, headings: [], text: '' }, { base }));

  // Static assets the pages reference.
  for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'brand', 'fonts']) {
    cpSync(join(ROOT, 'public', f), join(outDir, f), { recursive: true });
    files.push(f);
  }
  cpSync(join(ROOT, 'docs', 'brand', 'png', 'social-preview-1280x640.png'), join(outDir, 'social-preview.png'));
  write('.nojekyll', '');
  return { outDir, base, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2] ?? join(ROOT, '_site'));
  const r = buildSite(out, process.env.LITTI_SITE_URL || DEFAULT_SITE_URL);
  console.log(`Built ${r.files.length} files into ${out} (base ${r.base})`);
  if (!existsSync(join(out, 'index.html'))) process.exit(1);
}
