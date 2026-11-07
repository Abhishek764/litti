/** Production entry point. Validates config, serves review pages, inbox, dashboard and the agent API. */
process.on('unhandledRejection', err => console.error('⚠️  Unhandled error (still running):', err));
import 'dotenv/config';
import { initDb, closeDb } from './chain/db.js';
import { buildServer, setNotifier } from './approval/server.js';
import { notifierFromEnv } from './notify/index.js';
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
  setNotifier(notifierFromEnv());

  const app = buildServer({ logger: true });
  await app.listen({ port: PORT, host: HOST });
  console.log(`📥 Review inbox: ${BASE}/`);
  console.log(`📊 Dashboard:    ${BASE}/dashboard.html`);
  console.log(`🤖 Agent API:    POST ${BASE}/api/actions`);
  if (!process.env.LITTI_NOTIFY_WEBHOOK) console.log('💬 Tip: set LITTI_NOTIFY_WEBHOOK to post approval cards to Slack or Discord.');

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
