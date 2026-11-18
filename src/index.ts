/** Production entry point. Validates config, serves review pages, inbox, dashboard and the agent API. */
process.on('unhandledRejection', err => console.error('⚠️  Unhandled error (still running):', err));
import dotenv from 'dotenv';
import open from 'open';
// The installed `litti` command reads ~/.litti/config.env instead of the current folder's .env.
if (!process.env.LITTI_SKIP_CWD_ENV) dotenv.config();
import { initDb, closeDb } from './chain/db.js';
import { buildServer, setNotifier } from './approval/server.js';
import { multiNotifier, notifierFromEnv } from './notify/index.js';
import { liveConnectedNotifier } from './connect/notifier.js';
import { checkProductionConfig } from './config.js';

const PORT = Number(process.env.APPROVAL_SERVER_PORT) || 3847;
const HOST = process.env.HOST || '127.0.0.1';
const BASE = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.LITTI_DB_PATH || 'data/litti.db';

async function main() {
  const { errors, warnings } = checkProductionConfig();
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
  console.log('🔒 Litti starting...');

  initDb(DB_PATH);
  setNotifier(multiNotifier([notifierFromEnv(), liveConnectedNotifier()]));

  const app = buildServer({ logger: process.env.LITTI_OPEN ? false : true });
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Is Litti already running? Open ${BASE}/ or start on another port: litti start --port ${PORT + 1}`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`\n✅ Litti is running at ${BASE}/\n`);
  console.log(`   📥 Inbox & getting started     ${BASE}/`);
  console.log(`   🧩 Connect Slack/Discord/Jira  ${BASE}/integrations`);
  console.log(`   📖 Docs                        ${BASE}/docs`);
  console.log('\n   Gate Claude Code in a project:  cd your-project && litti install claude');
  console.log('   Stop with Ctrl+C.\n');
  if (process.env.LITTI_OPEN) await open(`${BASE}/`).catch(() => console.log(`   Open ${BASE}/ in your browser.`));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received — shutting down.`);
    await app.close().catch(() => {});
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
