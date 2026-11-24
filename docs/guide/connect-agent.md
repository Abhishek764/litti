# Lesson 2: put your coding agent behind Litti

Now make a real agent ask before it does anything risky. Litti installs a small **hook** into Claude Code, Codex or OpenCode. The hook looks at every shell command the agent wants to run.

## 1. Keep Litti running

In one terminal:

```bash
litti
```

## 2. Install the hook into your project

In a second terminal, go to the project your agent works in and install the hook (or pass `--dir <project>` from anywhere):

```bash
cd ~/code/my-app
litti install claude      # or: codex, opencode, all
```

| Agent | What gets written |
|---|---|
| Claude Code | `.claude/settings.json`: a `PreToolUse` hook on the Bash and PowerShell tools (matcher `Bash\|PowerShell`); if the hook itself can't run, the command is blocked |
| Codex | `.codex/hooks.json`: a `PreToolUse` hook on shell commands (matcher `^Bash$`) |
| OpenCode | `.opencode/plugin/litti.ts`: a plugin that blocks in `tool.execute.before` (OpenCode 1.x; an OpenCode 2 plugin is planned) |

Your other settings are kept. Running `install` again replaces Litti's entry; it never adds a second one.

Restart the agent afterwards so it loads the hook.

> **Codex:** Codex only runs project hooks you have trusted. Open Codex in the project and run `/hooks` to trust the Litti hook, and do it again after upgrading or moving Litti: Codex skips a changed hook without a warning. See the [Codex hooks docs](https://learn.chatgpt.com/docs/hooks).

## 3. Watch it work

Ask your agent to change something and then commit it. Here's what happens:

1. **Everyday commands run instantly**: tests, builds, `git status`, editing files. The hook doesn't even contact Litti for these.
2. **A risky command is stopped at once.** `git commit`, `git push`, deploys, `npm publish`, migrations, `rm -rf`, `DROP TABLE`, `terraform apply` and `kubectl delete` are some examples. The agent gets a message with a review link and is told to wait.
3. **You review it.** Open the link (or the inbox at http://127.0.0.1:3847). On your own machine you're signed in as your OS user, so there's no name to type and no link to request. Read the change, answer the question and click **Countersign**.
4. **The agent runs the same command again** and this time it goes through, **once**. If the code changed in between, that's a new review.

What the review shows depends on the command:

| Command | You review |
|---|---|
| `git commit` | The staged changes (what a plain commit commits) |
| `git commit -a` / `-am` / with paths | The tracked changes |
| `git push` | The commits ahead of the upstream (or not on any remote), with their SHAs and subjects. A new commit means a new review |
| anything else risky | The command and everything that differs from `HEAD` |

A change over 512 KB, a diff git can't read, or a git command outside a repository is **denied**, never reviewed as "command only". Split big changes into smaller commits.

The hook reads the whole command line, not just its first word: chains (`&&`, `;`, `|`), quotes, `sh -c`, `sudo`, `npx`, `env`, `pwsh -Command` and git's global options (`git -C dir push`) are seen through.

Some commands are always denied for agents, whatever the tier and even when Litti is down: creating review links (`litti review`, `/review-link`) and reading Litti's admin key or `~/.litti/config.env`. Approving is a person's job.

You and the agent can't share a name: if the agent is called like your OS user, Litti refuses its requests and tells you to set `LITTI_AGENT_NAME` (or `LITTI_LOCAL_REVIEWER`).

If Litti isn't running, risky commands are blocked. That's deliberate: a safety gate that fails open isn't a gate.

## 4. Tell your agent how to behave

Add the rules from [docs/agent-instructions.md](https://github.com/Abhishek764/litti/blob/main/docs/agent-instructions.md) to your agent's instructions file (`CLAUDE.md`, `AGENTS.md`…). In short: when Litti blocks a command, share the link, don't work around it, don't edit files while waiting, and retry the same command after approval.

## Tuning

Set these in `~/.litti/config.env` or in the environment the agent runs in. The hook never reads the project's `.env`, so a repository (or the agent) can't switch the gate off by editing it.

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
