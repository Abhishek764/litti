/**
 * Demo runner. `npm run demo` posts into your Switch room when Switch is set up,
 * and falls back to an offline console stub otherwise (or with --offline).
 */
process.on('unhandledRejection', err => console.error('⚠️  Unhandled error (still running):', err));
import 'dotenv/config';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import open from 'open';
import { initDb, enableDemoTamper } from './chain/db.js';
import { buildServer, setSwitchClient, registerPending } from './approval/server.js';
import { createSwitchStub } from './agents/switchStub.js';
import { connectSwitch, type LiveSwitch } from './switch/client.js';
import { createCommandHandler } from './switch/commands.js';
import { buildActionCard } from './agents/builder.js';
import type { ActionKind } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIFFS = join(__dirname, '..', 'demo', 'sample-diffs');

// Ephemeral per-run key so the standalone demo signs tokens without setup.
if (!process.env.SECRET_KEY) process.env.SECRET_KEY = randomBytes(32).toString('hex');
// Demo: reviewers can type a name (Sam, Priya) or use `@litti review <id>` links from Switch.
process.env.LITTI_ALLOW_SELF_ASSERTED ??= 'true';
process.env.LITTI_DEPLOY_DIR ??= 'deployments';
const PORT = Number(process.env.APPROVAL_SERVER_PORT) || 3847;
const BASE = `http://127.0.0.1:${PORT}`;

function diff(name: string): string { return readFileSync(join(DIFFS, name), 'utf8'); }

async function main() {
  console.log('🔒 Litti starting...');

  // Fresh database each demo run.
  for (const f of ['litti-demo.db', 'litti-demo.db-wal', 'litti-demo.db-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  initDb('litti-demo.db');
  enableDemoTamper();

  let sw: LiveSwitch | null = null;
  if (!process.argv.includes('--offline')) {
    try { sw = await connectSwitch(); }
    catch (err) { console.warn(`⚠️  ${(err as Error).message}
   Running offline: room messages print here instead.`); }
  }
  setSwitchClient(sw ?? createSwitchStub());

  const app = buildServer();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`🔑 Approval server on ${BASE}`);

  const cards = [
    buildActionCard({
      action: 'edit' as ActionKind,
      description: 'Round the primary button corners (4px → 8px).',
      diff: diff('css-fix.diff'),
      touchedPaths: ['src/styles/button.css'],
      reversible: true,
      rollbackPlan: 'Revert the CSS commit.',
    }),
    buildActionCard({
      action: 'migrate' as ActionKind,
      description: 'Add MFA columns to the users table.',
      diff: diff('migration.diff'),
      touchedPaths: ['migrations/20261105_add_mfa_to_users.sql'],
      reversible: true,
      rollbackPlan: 'ALTER TABLE users DROP COLUMN mfa_enabled, DROP COLUMN mfa_secret, DROP COLUMN mfa_backup_codes, DROP COLUMN mfa_last_verified;',
    }),
    buildActionCard({
      action: 'deploy' as ActionKind,
      description: 'Purge session data, drop legacy token table, delete archived uploads.',
      diff: diff('destructive.diff'),
      touchedPaths: ['scripts/cleanup.sh'],
      reversible: false,
      rollbackPlan: 'None — this is destructive and irreversible.',
    }),
  ];

  console.log('\n📋 Proposed actions:');
  const urls: string[] = [];
  for (const card of cards) {
    const { url, tier } = registerPending(card, BASE);
    urls.push(url);
    console.log(`  • Tier ${tier}  ${card.action.padEnd(8)} ${card.description}`);
    console.log(`           ${url}`);
  }

  console.log(`\n📊 Dashboard: ${BASE}/dashboard.html`);
  console.log('\n👉 Open an approval link, read the diff, pass the quiz, Countersign.');
  console.log('   Approved actions deploy and appear on the dashboard.\n');

  if (sw) {
    void sw.listen(createCommandHandler(BASE));
    console.log('💬 Approval cards are in your Switch room. Try: @litti pending');
  }
  if (!process.argv.includes("--no-open")) {
    await open(urls[0]).catch(() => console.log(`Open ${urls[0]} in your browser.`));
    await open(`${BASE}/dashboard.html`).catch(() => console.log(`Dashboard: ${BASE}/dashboard.html`));
  }
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
