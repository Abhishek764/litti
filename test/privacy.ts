/**
 * Privacy guard: no tracked file may contain a real-looking IP address or a personal machine path.
 *
 *  - IPv4: only loopback 127.0.0.1, 0.0.0.0 and the documentation ranges 192.0.2.x, 198.51.100.x,
 *    203.0.113.x (RFC 5737) are allowed. Version-like strings (v1.2.3.4, pkg@1.2.3.4) are ignored.
 *  - Paths: C:\Users\<name>, /Users/<name> and /home/<name> are allowed only with a placeholder
 *    name such as <you>, $USER or one of the generic service-account names below.
 *
 * Fails with file:line for every hit.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP_FILES = new Set(['package-lock.json']);
const BINARY = /\.(png|ico|jpe?g|gif|webp|woff2?|ttf|otf|pdf|zip|gz|tgz|db)$/i;

const IPV4 = /(?<![\w.@-])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w-]|\.\d)/g;
const ALLOWED_IP = (o: number[]) =>
  o.join('.') === '127.0.0.1' || o.join('.') === '0.0.0.0'
  || (o[0] === 192 && o[1] === 0 && o[2] === 2)
  || (o[0] === 198 && o[1] === 51 && o[2] === 100)
  || (o[0] === 203 && o[1] === 0 && o[2] === 113);

// Windows (any number of escaping backslashes, or forward slashes), macOS and Linux home folders.
const HOME_PATH = /(?:\b[A-Za-z]:(?:\\+|\/)Users(?:\\+|\/)|(?<![\w.~-])\/Users\/|(?<![\w.~-])\/home\/)([^\\/\s<>"'`$%*{}()[\],;:|]+)/g;
const GENERIC_NAMES = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'node', 'example', 'alice', 'bob', 'ana', 'dev', 'public', 'default', 'shared', 'all users', 'deploy', 'app', 'ubuntu', 'ec2-user', 'git', 'www-data']);

/** Every problem in one text, as "line: what". */
export function scanText(text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(IPV4)) {
      const o = m.slice(1, 5).map(Number);
      if (o.some(n => n > 255)) continue;
      if (!ALLOWED_IP(o)) hits.push(`${i + 1}: IP address ${m[0]}`);
    }
    for (const m of line.matchAll(HOME_PATH)) {
      if (!GENERIC_NAMES.has(m[1].toLowerCase())) hits.push(`${i + 1}: personal path ${m[0]}`);
    }
  });
  return hits;
}

let passed = 0;
function step(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

step('the scanner catches real IPs and personal paths, and allows placeholders and doc ranges', () => {
  const bad = ['host 10.0.0.7 here', 'from 8.8.8.8.', 'C:\\Users\\jdoe\\x', 'C:\\\\Users\\\\jdoe', '/Users/jdoe/code', 'cd /home/jdoe'];
  for (const s of bad) assert.equal(scanText(s).length, 1, `should flag: ${s}`);
  const ok = ['127.0.0.1:3847', 'HOST=0.0.0.0', '192.0.2.10', '198.51.100.7', '203.0.113.5', 'v1.2.3.4', 'pkg@1.2.3.4',
    'C:\\Users\\<you>', '/Users/$USER/x', '/home/runner/work', 'C:\\Users\\you', 'version 22.19.0', '1.2.3.4.5'];
  for (const s of ok) assert.deepEqual(scanText(s), [], `should allow: ${s}`);
});

step('no tracked file contains a real-looking IP address or a personal machine path', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'git ls-files returned the repository');
  const problems: string[] = [];
  for (const f of files) {
    if (SKIP_FILES.has(f.split('/').pop()!) || BINARY.test(f)) continue;
    let buf: Buffer;
    try { buf = readFileSync(f); } catch { continue; } // deleted in the work tree
    if (buf.includes(0)) continue; // binary
    for (const h of scanText(buf.toString('utf8'))) problems.push(`${f}:${h}`);
  }
  assert.deepEqual(problems, [], `Privacy guard: replace these with 127.0.0.1, a 192.0.2.x/198.51.100.x/203.0.113.x address, or a placeholder like C:\\Users\\<you>:\n  ${problems.join('\n  ')}`);
});

console.log(`\nprivacy: ${passed} passed`);
