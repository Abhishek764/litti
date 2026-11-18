/** Docs site tests: every page renders, links resolve, scripts parse, markdown is escaped. */
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'docs-test-secret-'.repeat(3);
import { initDb } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { ORDER } from '../src/docs/site.js';
import { render } from '../src/docs/markdown.js';

initDb(':memory:');
setNotifier(null);
const app = buildServer();
let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

try {
  const bodies = new Map<string, string>();
  await step('every page in the sidebar renders with title, sidebar and prev/next', async () => {
    for (const p of ORDER) {
      const r = await app.inject({ method: 'GET', url: p.slug === 'index' ? '/docs' : `/docs/${p.slug}` });
      assert.equal(r.statusCode, 200, p.slug);
      assert.match(r.body, /<h1>/);
      assert.match(r.body, /aria-current="page"/);
      bodies.set(p.slug, r.body);
    }
  });

  await step('page scripts parse (template-string escaping)', () => {
    for (const [slug, html] of bodies) for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), slug);
  });

  await step('internal links point at real pages and real headings', async () => {
    const slugs = new Set(ORDER.map(p => p.slug));
    for (const [slug, html] of bodies) {
      const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
      for (const m of main.matchAll(/href="\/docs\/([a-z0-9-]+)(?:#([a-z0-9-]+))?"/g)) {
        assert.ok(slugs.has(m[1]), `${slug} links to missing page ${m[1]}`);
        if (m[2]) assert.ok(bodies.get(m[1])!.includes(`id="${m[2]}"`), `${slug} links to missing heading ${m[1]}#${m[2]}`);
      }
      for (const m of main.matchAll(/href="#([a-z0-9-]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${slug}: missing anchor #${m[1]}`);
    }
  });

  await step('unknown or traversal slugs are 404', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/docs/nope' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/docs/..%2F..%2Fpackage' })).statusCode, 404);
  });

  await step('markdown: HTML escaped, unsafe links dropped, tables/lists/code render', () => {
    const r = render('# T\n\nHi <script>x</script> [<img src=x onerror=alert(1)>](https://a.test) [bad](javascript:alert(1))\n\n| a | b |\n|---|---|\n| `x\\|y` | **z** |\n\n1. one\n2. two\n\n```bash\necho "<b>"\n```');
    assert.equal(r.title, 'T');
    assert.ok(!r.html.includes('<script>') && !r.html.includes('<img'), 'html escaped, incl. link labels');
    assert.ok(!r.html.includes('javascript:'), 'unsafe link dropped');
    assert.match(r.html, /<table>.*<code>x\|y<\/code>.*<strong>z<\/strong>/s);
    assert.match(r.html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
    assert.match(r.html, /&lt;b&gt;/);
  });

  await step('search index is embedded and safe inside <script>', () => {
    const html = bodies.get('index')!;
    const js = html.slice(html.lastIndexOf('<script>'));
    assert.match(js, /const IDX=\[/);
    assert.ok(!/<\/(?!script>)/.test(js.slice(8, js.lastIndexOf('</script>'))), 'no </ inside the script');
  });
} finally { await app.close(); }
console.log(`\ndocs: ${passed} passed`);
