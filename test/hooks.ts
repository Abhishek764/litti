/** Agent gate tests: command classification, hook payloads, deny → review → allow once, fail closed, installers. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.SECRET_KEY = 'hooks-test-secret-'.repeat(3);
process.env.LITTI_ALLOW_SELF_ASSERTED = 'true';
process.env.LITTI_DEPLOY_DIR = join(tmpdir(), `litti-hooks-deploy-${process.pid}`);
import { initDb, getPending } from '../src/chain/db.js';
import { buildServer, setNotifier } from '../src/approval/server.js';
import { issueViewStamp } from '../src/approval/identity.js';
import { sampleAnswer } from '../src/agents/challenges.js';
import { classify, extractCommand, gate } from '../src/integrations/gate.js';
import { runHook } from '../src/integrations/hook-cli.js';
import { install, mergeHooks, hookPaths } from '../src/integrations/install.js';

const repo = mkdtempSync(join(tmpdir(), 'litti-hooks-repo-'));
const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString();
git('init', '-q'); git('config', 'user.email', 't@e.test'); git('config', 'user.name', 'T'); git('config', 'core.autocrlf', 'false');
writeFileSync(join(repo, 'app.js'), 'export const price = 1;\n');
git('add', '.'); git('commit', '-q', '-m', 'init');

initDb(':memory:');
setNotifier(null);
const app = buildServer();
await app.listen({ port: 0, host: '127.0.0.1' });
const addr = app.server.address();
const URL_ = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
const opts = { url: URL_, agent: 'claude-code' };

/** Pass every required review on an action, as distinct human reviewers. */
async function approve(id: string) {
  for (const who of ['rev-ana', 'rev-bo', 'rev-cy']) {
    const p = getPending(id)!;
    if (p.status !== 'pending') break;
    const r = (await app.inject({
      method: 'POST', url: `/approve/${id}/submit`,
      payload: { approver: who, quizAnswer: sampleAnswer(p), scrolledToBottom: true, timeSpentMs: 45000, viewStamp: issueViewStamp(id, Date.now() - 45000) },
    })).json();
    assert.equal(r.ok, true, r.message);
  }
  assert.equal(getPending(id)!.status, 'approved');
}

let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`  ✓ ${name}`); }

try {
  await step('classify: risky commands gated, everyday ones free', () => {
    for (const c of ['git push origin main', 'git commit -m "x"', 'rm -rf build', 'npm publish', 'terraform apply -auto-approve',
      'kubectl delete pod x', 'vercel deploy --prod', 'npx prisma migrate deploy', 'psql -c "DROP TABLE users"', 'git reset --hard HEAD~3', 'docker push img']) {
      assert.equal(classify(c).risky, true, c);
    }
    for (const c of ['npm test', 'ls -la', 'git status', 'git diff', 'cat README.md', 'npm run build', 'rm notes.txt', 'git log --oneline']) {
      assert.equal(classify(c).risky, false, c);
    }
    assert.equal(classify('git commit -m x', { LITTI_GATE_COMMIT: 'false' }).risky, false);
    assert.equal(classify('make release', { LITTI_GATE_PATTERNS: '^make release' }).risky, true);
  });

  await step('extractCommand: Claude Code, Codex (argv) and OpenCode payloads', () => {
    assert.equal(extractCommand({ tool_name: 'Bash', tool_input: { command: 'git push' } }), 'git push');
    assert.equal(extractCommand({ tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'npm publish'] } }), 'npm publish');
    assert.equal(extractCommand({ tool_name: 'exec_command', tool_input: { cmd: 'git push' } }), 'git push');
    assert.equal(extractCommand({ tool: 'bash', args: { command: 'rm -rf x' } }), 'rm -rf x');
    assert.equal(extractCommand({ tool_name: 'Write', tool_input: { file_path: 'a' } }), null);
  });

  await step('harmless command: allowed without calling Litti', async () => {
    const d = await gate('npm test', repo, { ...opts, fetchImpl: () => { throw new Error('should not call'); } });
    assert.equal(d.decision, 'allow');
  });

  let firstId = '';
  await step('risky command: denied at once with a review link; retry before review stays denied', async () => {
    writeFileSync(join(repo, 'app.js'), 'export const price = 100;\n');
    const d = await gate('git push origin main', repo, opts);
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, /\/approve\//);
    assert.match(d.reason, /Do NOT retry/);
    firstId = d.actionId!;
    const p = getPending(firstId)!;
    assert.equal(p.actionCard.agent, 'claude-code');
    assert.ok(p.actionCard.diff.includes('+git push origin main'), 'command is part of what is reviewed');
    assert.ok(p.actionCard.diff.includes('price = 100'), 'working-tree diff is part of what is reviewed');
    const again = await gate('git push origin main', repo, opts);
    assert.equal(again.decision, 'deny');
    assert.equal(again.actionId, firstId, 'no duplicate review request');
    assert.match(again.reason, /still waiting/);
  });

  await step('after approval: the same command runs exactly once', async () => {
    await approve(firstId);
    const ok = await gate('git push origin main', repo, opts);
    assert.equal(ok.decision, 'allow', ok.reason);
    const twice = await gate('git push origin main', repo, opts);
    assert.equal(twice.decision, 'deny', 'approval is single use');
    assert.notEqual(twice.actionId, firstId);
  });

  await step('changing the diff after approval needs a new review', async () => {
    writeFileSync(join(repo, 'app.js'), 'export const price = 7;\n');
    const d = await gate('npm publish', repo, opts);
    await approve(d.actionId!);
    writeFileSync(join(repo, 'app.js'), 'export const price = 8;\n'); // sneaky edit after approval
    const after = await gate('npm publish', repo, opts);
    assert.equal(after.decision, 'deny');
    assert.notEqual(after.actionId, d.actionId);
  });

  await step('fail closed when Litti is down; LITTI_HOOK_FAIL_OPEN opts out', async () => {
    const down = await gate('git push', repo, { url: 'http://127.0.0.1:9', agent: 'x' });
    assert.equal(down.decision, 'deny');
    assert.match(down.reason, /unreachable/);
    assert.equal((await gate('git push', repo, { url: 'http://127.0.0.1:9', agent: 'x', failOpen: true })).decision, 'allow');
  });

  await step('API key: gate refuses agents without it', async () => {
    process.env.LITTI_API_KEY = 'k';
    try {
      const d = await gate('git push', repo, { ...opts, apiKey: '' });
      assert.equal(d.decision, 'deny');
      const ok = await gate('git push', repo, { ...opts, apiKey: 'k' });
      assert.equal(ok.decision, 'deny');
      assert.ok(ok.actionId, 'with the key it reaches review');
    } finally { delete process.env.LITTI_API_KEY; }
  });

  await step('hook output: Claude/Codex deny JSON, silent allow; OpenCode decision JSON', async () => {
    process.env.LITTI_URL = 'http://127.0.0.1:9';
    try {
      const deny = JSON.parse(await runHook('claude', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: repo })));
      assert.equal(deny.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
      assert.equal(await runHook('codex', JSON.stringify({ tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'npm test'] } })), '');
      assert.equal(await runHook('claude', 'not json'), '');
      const oc = JSON.parse(await runHook('opencode', JSON.stringify({ tool: 'bash', args: { command: 'git push' }, cwd: repo })));
      assert.equal(oc.decision, 'deny');
    } finally { delete process.env.LITTI_URL; }
  });

  await step('hook CLI runs as a real subprocess (what the agent executes)', () => {
    const { tsx, hook } = hookPaths();
    const run = (cmd: string) => spawnSync(process.execPath, [tsx, hook, 'claude'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: repo }),
      encoding: 'utf8', env: { ...process.env, LITTI_URL: 'http://127.0.0.1:9' }, timeout: 60000,
    });
    const free = run('npm test');
    assert.equal(free.status, 0);
    assert.equal(free.stdout.trim(), '');
    const blocked = run('git push');
    assert.equal(blocked.status, 0);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });

  await step('install: merges into existing config, never duplicates, writes all three', () => {
    const proj = mkdtempSync(join(tmpdir(), 'litti-install-'));
    try {
      mkdirSync(join(proj, '.claude'));
      writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ model: 'x', hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'lint.sh' }] }], Stop: [] } }));
      install('claude', proj);
      install('claude', proj);
      const s = JSON.parse(readFileSync(join(proj, '.claude', 'settings.json'), 'utf8'));
      assert.equal(s.model, 'x', 'other settings kept');
      assert.deepEqual(s.hooks.Stop, []);
      assert.equal(s.hooks.PreToolUse.length, 2, 'own hook kept, Litti added once');
      const litti = s.hooks.PreToolUse.find((g: any) => g.matcher === 'Bash');
      assert.match(litti.hooks[0].command, /hook-cli\.ts" claude$/);

      install('codex', proj);
      const c = JSON.parse(readFileSync(join(proj, '.codex', 'hooks.json'), 'utf8'));
      assert.equal(c.hooks.PreToolUse.length, 1);
      assert.match(c.hooks.PreToolUse[0].hooks[0].command, /codex$/);

      install('opencode', proj);
      const plugin = readFileSync(join(proj, '.opencode', 'plugin', 'litti.ts'), 'utf8');
      assert.match(plugin, /tool\.execute\.before/);
      assert.match(plugin, /throw new Error/);
      assert.ok(existsSync(hookPaths().tsx), 'tsx path in the hook exists');

      writeFileSync(join(proj, '.claude', 'settings.json'), '{ broken');
      assert.throws(() => install('claude', proj), /not valid JSON/);
      assert.deepEqual(mergeHooks(null, 'c', 'Bash').hooks.PreToolUse.length, 1);
    } finally { rmSync(proj, { recursive: true, force: true }); }
  });
} finally {
  await app.close();
  rmSync(repo, { recursive: true, force: true });
}

console.log(`\nhooks: ${passed} passed`);
