/** Production entry point. Validates config, joins Switch as @litti, serves review pages. */
import 'dotenv/config';
import { initDb, closeDb } from './chain/db.js';
import { buildServer, setSwitchClient } from './approval/server.js';
import { connectSwitch } from './switch/client.js';
import { createCommandHandler } from './switch/commands.js';
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

  // Switch is where requests, reviews and results happen. No Switch, no Litti.
  const sw = await connectSwitch();
  initDb(DB_PATH);
  setSwitchClient(sw);

  const app = buildServer({ logger: true });
  await app.listen({ port: PORT, host: HOST });
  console.log(`🔑 Review pages on ${BASE}`);
  console.log(`📊 Dashboard: ${BASE}/dashboard.html`);
  console.log(`💬 In your Switch room, try: @${process.env.SWITCH_AGENT_NAME || 'litti'} help`);

  void sw.listen(createCommandHandler(BASE));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received — shutting down.`);
    sw.stop();
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
