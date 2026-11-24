/**
 * Demo runner. `litti demo` starts Litti with three sample actions, a fresh
 * database and typed reviewer names allowed. Notifications print to the
 * terminal (and go to LITTI_NOTIFY_WEBHOOK if set).
 */
process.on('unhandledRejection', err => console.error('⚠️  Unhandled error (still running):', err));
import dotenv from 'dotenv';
if (!process.env.LITTI_SKIP_CWD_ENV) dotenv.config();
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import open from 'open';
import { initDb, enableDemoTamper } from './chain/db.js';
import { buildServer, setNotifier, registerPending, listenTextResolver } from './approval/server.js';
import { multiNotifier, notifierFromEnv } from './notify/index.js';
import { liveConnectedNotifier } from './connect/notifier.js';
import { buildActionCard } from './agents/builder.js';
import type { ActionKind } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIFFS = join(__dirname, '..', 'demo', 'sample-diffs');

// Ephemeral per-run key so the standalone demo signs tokens without setup.
if (!process.env.SECRET_KEY) process.env.SECRET_KEY = randomBytes(32).toString('hex');
// Demo: reviewers can type a name (Sam, Priya) or use `litti review <id> --as <name>` links.
process.env.LITTI_ALLOW_SELF_ASSERTED ??= 'true';
process.env.LITTI_DEPLOY_DIR ??= 'deployments';
const PORT = Number(process.env.APPROVAL_SERVER_PORT) || 3847;
const BASE = `http://127.0.0.1:${PORT}`;

function portBusy(): never {
  console.error(`❌ Port ${PORT} is already in use. Is Litti already running? Open ${BASE}/ or try the demo on another port: litti demo --port ${PORT === 65535 ? PORT - 1 : PORT + 1}`);
  process.exit(1);
}

/** Check the port before wiping the demo database, so a second `litti demo` can't wipe a running one's data. */
function checkPortFree(): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' ? portBusy() : reject(err)));
    probe.listen(PORT, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

function diff(name: string): string { return readFileSync(join(DIFFS, name), 'utf8'); }

async function main() {
  console.log('🔒 Litti starting...');
  await checkPortFree();

  // Fresh database each demo run.
  const demoDb = process.env.LITTI_DEMO_DB || 'litti-demo.db';
  for (const f of [demoDb, `${demoDb}-wal`, `${demoDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  initDb(demoDb);
  enableDemoTamper();

  setNotifier(multiNotifier([notifierFromEnv(), liveConnectedNotifier()]));

  const app = buildServer();
  try {
    await app.listen({ port: PORT, host: '127.0.0.1', listenTextResolver });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') portBusy();
    throw err;
  }
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

  console.log(`\n📥 Inbox:     ${BASE}/`);
  console.log(`📊 Dashboard: ${BASE}/dashboard.html`);
  console.log('\n👉 Open an approval link, read the diff, pass the check, Countersign.');
  console.log('   Approved actions deploy and appear on the dashboard.');
  console.log('   In another terminal, try: litti pending\n');
  if (!process.argv.includes("--no-open")) {
    await open(urls[0]).catch(() => console.log(`Open ${urls[0]} in your browser.`));
    await open(`${BASE}/dashboard.html`).catch(() => console.log(`Dashboard: ${BASE}/dashboard.html`));
  }
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
