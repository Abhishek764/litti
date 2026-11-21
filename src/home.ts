/**
 * Litti's home folder (~/.litti, or LITTI_HOME) for the installed `litti` command.
 *
 *  - config.env  settings, created on first run with a fresh random SECRET_KEY and LITTI_ADMIN_KEY
 *  - litti.db    reviews, receipts, connected integrations
 *  - deployments approved-action records when no deploy webhook is set
 *
 * Settings already in the environment win over config.env. A project's own .env is
 * NOT read by the server: its HOST or SECRET_KEY must never leak into Litti.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

export function littiHome(env = process.env): string {
  return env.LITTI_HOME || join(homedir(), '.litti');
}

const TEMPLATE = (secret: string, admin: string) => `# Litti settings. Created on first run; edit and restart \`litti\` to apply.
# Full list: run \`litti\` and open http://127.0.0.1:3847/docs/config

# Signs approvals and encrypts integration tokens. Keep it secret; changing it
# means reconnecting Slack/Discord/Jira.
SECRET_KEY=${secret}

# Issues personal review links (\`litti review <id> --as <name>\`). The CLI sends it; agents must not.
LITTI_ADMIN_KEY=${admin}

# APPROVAL_SERVER_PORT=3847
# PUBLIC_URL=https://litti.yourco.com
# LITTI_API_KEY=
# Who you are when you review locally (default: your OS user name).
# LITTI_LOCAL_REVIEWER=
# LITTI_CHALLENGES=quiz,spot-line,type-in,canary,count,explain
`;

/** Create the home folder and config on first run, then load config into process.env. */
export function loadHome(env = process.env): { home: string; created: boolean; configFile: string } {
  const home = littiHome(env);
  mkdirSync(home, { recursive: true });
  const configFile = join(home, 'config.env');
  let created = false;
  if (!existsSync(configFile)) {
    writeFileSync(configFile, TEMPLATE(randomBytes(32).toString('hex'), randomBytes(24).toString('hex')), { mode: 0o600 });
    try { chmodSync(configFile, 0o600); } catch { /* Windows: ACLs instead */ }
    created = true;
  }
  let values = parse(readFileSync(configFile));
  // Configs from before the admin key existed get one, unless it is set in the environment.
  if (!values.LITTI_ADMIN_KEY && env.LITTI_ADMIN_KEY === undefined) {
    appendFileSync(configFile, `
# Issues personal review links. Added by Litti 0.4.
LITTI_ADMIN_KEY=${randomBytes(24).toString('hex')}
`);
    values = parse(readFileSync(configFile));
  }
  for (const [k, v] of Object.entries(values)) if (env[k] === undefined) env[k] = v;

  env.LITTI_DB_PATH ??= join(home, 'litti.db');
  env.LITTI_DEPLOY_DIR ??= join(home, 'deployments');
  env.LITTI_DEMO_DB ??= join(home, 'demo.db');
  env.LITTI_SKIP_CWD_ENV = '1';
  return { home, created, configFile };
}
