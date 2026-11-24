/** Request logs must never contain client IPs, hostnames or query strings (review tickets). */
import assert from 'node:assert/strict';
process.env.SECRET_KEY = 'logging-test-secret-'.repeat(3);
import { initDb } from '../src/chain/db.js';
import { buildServer, listenTextResolver } from '../src/approval/server.js';

initDb(':memory:');
const lines: string[] = [];
const origWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (chunk: any, ...rest: any[]) => { lines.push(String(chunk)); return true; };
const app = buildServer({ logger: true });
try {
  await app.listen({ port: 0, host: '127.0.0.1', listenTextResolver });
  const port = (app.server.address() as { port: number }).port;
  await fetch(`http://127.0.0.1:${port}/healthz?t=SECRET-TICKET-VALUE`);
} finally {
  await app.close();
  (process.stdout as any).write = origWrite;
}
const log = lines.join('');
assert.match(log, /incoming request/, 'request logging still works');
assert.ok(!/remoteAddress|remotePort|hostname/.test(log), "no client address, machine name or host in logs");
assert.ok(!log.includes('127.0.0.1'), 'no IP addresses in logs');
assert.ok(!log.includes('SECRET-TICKET-VALUE'), 'no query strings in logs');
console.log('  ✓ request logs contain no IP, host or query string\n\nlogging: 1 passed');
