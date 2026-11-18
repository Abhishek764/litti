# Lesson 2: put your coding agent behind Litti

Now make a real agent ask before it does anything risky. Litti installs a small **hook** into Claude Code, Codex or OpenCode. The hook looks at every shell command the agent wants to run.

## 1. Keep Litti running

In one terminal, in the Litti folder:

```bash
npm start
```

## 2. Install the hook into your project

Still in the Litti folder, point `--dir` at the project your agent works in:

```bash
npm run litti -- install claude   --dir ~/code/my-app
npm run litti -- install codex    --dir ~/code/my-app
npm run litti -- install opencode --dir ~/code/my-app
npm run litti -- install all      --dir ~/code/my-app
```

| Agent | What gets written |
|---|---|
| Claude Code | `.claude/settings.json`: a `PreToolUse` hook on the Bash tool |
| Codex | `.codex/hooks.json`: a `PreToolUse` hook |
| OpenCode | `.opencode/plugin/litti.ts`: a plugin that blocks in `tool.execute.before` |

Your other settings are kept. Running `install` again replaces Litti's entry; it never adds a second one.

Restart the agent afterwards so it loads the hook.

> **Codex:** hooks may need to be switched on in your Codex config, and some Codex versions don't run hooks on Windows. Check the [Codex hooks docs](https://developers.openai.com/codex/hooks) for your version.

## 3. Watch it work

Ask your agent to change something and then commit it. Here's what happens:

1. **Everyday commands run instantly**: tests, builds, `git status`, editing files. The hook doesn't even contact Litti for these.
2. **A risky command is stopped at once.** `git commit`, `git push`, deploys, `npm publish`, migrations, `rm -rf`, `DROP TABLE`, `terraform apply` and `kubectl delete` are some examples. The agent gets a message with a review link and is told to wait.
3. **You review it.** The review shows the command *and* the code it would ship.
4. **The agent runs the same command again** and this time it goes through, **once**. If the code changed in between, that's a new review.

If Litti isn't running, risky commands are blocked. That's deliberate: a safety gate that fails open isn't a gate.

## 4. Tell your agent how to behave

Add the rules from [docs/agent-instructions.md](https://github.com/Abhishek764/litti/blob/main/docs/agent-instructions.md) to your agent's instructions file (`CLAUDE.md`, `AGENTS.md`…). In short: when Litti blocks a command, share the link, don't work around it, don't edit files while waiting, and retry the same command after approval.

## Tuning

Set these in the environment the agent runs in (or in the project's `.env`):

| Setting | Effect |
|---|---|
| `LITTI_GATE_COMMIT=false` | Don't gate `git commit`; push, deploys, publish and migrations stay gated |
| `LITTI_GATE_PATTERNS` | Extra commands to gate, as regexes separated by `;;`, e.g. `^make release;;^./deploy.sh` |
| `LITTI_URL` | Where Litti runs, if not `http://127.0.0.1:3847` |
| `LITTI_API_KEY` | Needed if your Litti server requires a key |
| `LITTI_AGENT_NAME` | Name shown on review requests |
| `LITTI_HOOK_FAIL_OPEN=true` | Let commands through when Litti is down. For experiments only |

## Other agents

Anything that can run a command or make an HTTP request can use Litti. See [CLI](cli) and [HTTP API](api).

## Next

[Lesson 3](changes): read the agent's changes as they happen and talk them through.
