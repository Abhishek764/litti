/** Entry point. Starts the approval server; uses the Switch stub by default. */
import 'dotenv/config';
import { initDb } from './chain/db.js';
import { buildServer, setSwitchClient } from './approval/server.js';
import { createSwitchStub } from './agents/switchStub.js';

const PORT = Number(process.env.APPROVAL_SERVER_PORT) || 3847;

async function main() {
  if (!process.env.SECRET_KEY) {
    console.error('❌ SECRET_KEY is not set. Copy .env.example to .env and set one. (Or run `npm run demo`.)');
    process.exit(1);
  }
  console.log('🔒 Litti starting...');
  initDb('litti.db');
  setSwitchClient(createSwitchStub());

  const app = buildServer();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`🔑 Approval server on http://127.0.0.1:${PORT}`);
  console.log(`📊 Dashboard: http://127.0.0.1:${PORT}/dashboard.html`);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
