<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Abhishek764/litti/main/docs/brand/logo/litti-horizontal-dark.svg">
  <img alt="Litti" src="https://raw.githubusercontent.com/Abhishek764/litti/main/docs/brand/logo/litti-horizontal-light.svg" width="360">
</picture>

### Proof that a human actually read what their AI agent is about to ship.

[![CI](https://github.com/Abhishek764/litti/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhishek764/litti/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/litti-cli)](https://www.npmjs.com/package/litti-cli)
[![tests: 161 passing](https://img.shields.io/badge/tests-161%20passing-brightgreen.svg)](#litti-by-the-numbers)
[![Node 22+](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Website & docs](https://abhishek764.github.io/litti/) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Use it with your agent](#use-it-with-your-coding-agent) · [Known limitations](#known-limitations)

</div>

---

**Your approve button is a spring lock. Litti makes sure someone turned the key.**

Your coding agent can commit, push, migrate and deploy. Litti blocks those commands until a human reads the diff and answers one question about it. Every approval is bound to the exact change and written to a tamper-evident receipt.

Other approval tools prove someone clicked. Litti proves they read it.

<table>
<tr>
<td width="33%" valign="top">

**🛑 Stops risky commands**<br>
Tests, builds and edits run freely. Commits, pushes, deploys, migrations and deletes wait for a review.

</td>
<td width="33%" valign="top">

**🧠 Checks comprehension**<br>
Each review asks a question built from the diff itself, usually a different kind each time.

</td>
<td width="33%" valign="top">

**🔏 Leaves evidence**<br>
Approvals are bound to the exact diff, used once, and chained into receipts anyone can verify.

</td>
</tr>
</table>

---

## Quick start

You need **Node.js 22+** and Git.

```bash
npm install -g litti-cli
litti demo                          # see it work: sample reviews, try answering wrong
cd your-project && litti install claude   # gate your agent (also: codex, opencode, all)
```

Then run `litti` (keep that terminal open), restart your agent and ask it to commit something. Settings and data live in `~/.litti/`; keys are created for you on first run.

Full guide: **[abhishek764.github.io/litti](https://abhishek764.github.io/litti/)**

---

## How it works

1. Your agent tries `git push`.
2. Litti gives it a risk tier (0–3) and builds a question from what would ship.
3. The command is blocked; you get a review link (terminal, Slack, Discord or Jira).
4. You read the diff, answer, and countersign.
5. Litti checks for rubber-stamping and signs an approval bound to the diff.
6. The agent runs the same command again. It goes through once, and a receipt is chained.

| Risk tier | Example | Reviewers |
|---|---|---|
| 0 | Read files, run tests | none, runs instantly |
| 1 | A normal commit | 1 |
| 2 | Touches `migrations/`, `auth/`, `.env`; diffs over 200 lines; can't be undone | 2 |
| 3 | `DROP TABLE`, `rm -rf`, force-push, deletes | 3 |

Each review asks one of six kinds of question, chosen at random and usually a different kind each time:

| | The reviewer… |
|---|---|
| **Quiz** | picks the right fact from 4 options |
| **Spot the line** | clicks the line that does the risky thing |
| **Recall** | types the table, function or value from memory |
| **Canary** | spots whether a line was quietly altered |
| **Count** | says how many lines were added or removed |
| **Explain it** | writes one sentence in their own words, saved in the receipt |

Approve too fast, or answer wrong, and Litti calls it a **rubber-stamp**: blocked, announced, every review on that action reset, and the next action gets a stricter tier.

### Why not just…

- **…read the permission prompt?** You approve dozens a day. Litti only stops the risky ones, and makes those count.
- **…review the PR?** Agents push, migrate and deploy before a PR exists. Litti sits at the command.
- **…use a sandbox?** Use both. A sandbox limits what the agent can do; Litti makes a human own what it ships.
- **…ask an LLM to review it?** Then nobody read it. Litti keeps a person accountable, with no model in the trust path.

---

## Use it with your coding agent

Inside the project your agent works on:

```bash
cd my-project
litti install claude      # Claude Code   (also: codex, opencode, all)
```

Restart the agent. Now ask it to change something and commit:

1. It edits files and runs tests. **Nothing is blocked.**
2. It tries `git commit` and is **blocked with a review link**.
3. You open the link, read the change, answer the question and **Countersign**. On your own machine you're signed in as your OS user: nothing to type.
4. You tell the agent "approved". It runs the same commit again and **it goes through, once**.

A `git push` review shows the commits that would be sent. If the code changes after approval, that's a new review. If Litti isn't running, risky commands stay blocked: a gate that fails open isn't a gate.

| Agent | What `litti install` writes |
|---|---|
| Claude Code | `.claude/settings.json`: a `PreToolUse` hook on Bash and PowerShell that blocks if the hook itself can't run |
| Codex | `.codex/hooks.json`: a `PreToolUse` hook on Bash. Open Codex and run `/hooks` once to trust it (again after upgrading Litti) |
| OpenCode | `.opencode/plugin/litti.ts`: blocks in `tool.execute.before` (OpenCode 1.x) |

> 💡 Give your agent the rules in [docs/agent-instructions.md](docs/agent-instructions.md) (paste into `CLAUDE.md` / `AGENTS.md`) so it waits for review instead of looking for workarounds.

Any other agent or pipeline can use the [`litti` CLI](docs/guide/cli.md) or the [HTTP API](docs/guide/api.md).

---

## Tell your team

Open **http://127.0.0.1:3847/integrations**:

| | Paste a webhook (works everywhere) | One click (if Litti Connect is set up) |
|---|---|---|
| **Slack** | Paste an incoming-webhook link | Connect → pick a channel → Allow |
| **Discord** | Paste a channel webhook link | Connect → pick a server and channel → Authorize |
| **Jira** | Use your own Atlassian app | Connect → sign in → pick your site and project |

Every risky action posts a card with a **Review** button. Jira gets an issue per Tier 2+ action (configurable), a comment per review step, and is closed on approval. Nobody can approve from chat: the button always opens the review page.

**What leaves your machine:** the description, the command, file names, risk reasons and the diff's hash. **Diffs never do.** Integration tokens are stored encrypted. **Privacy:** request logs never contain client IPs, your machine's name or query strings, and `/healthz` says only `{ok: true}`.

---

## Watch and discuss changes

Open **http://127.0.0.1:3847/changes** while your agent works. You see its changes live, and you can comment on any line:

> *"Why multiply by 100 here? Callers already pass cents."*

The agent answers in the same thread (`litti notes`, `litti reply`), and **Request review** turns the whole change into a Litti review.

---

## Everyday commands

```bash
litti                        # start and open the inbox
litti demo                   # sample reviews to try
litti install claude         # gate an agent in this project
litti pending                # what's waiting for review
litti status <id>            # approved yet?
litti review <id> --as ana   # a personal review link (teams; needs the admin key)
litti notes                  # reviewer comments on the agent's changes
litti verify                 # check the receipt chain for tampering
litti stats                  # reviewer attention scores
```

---

## What Litti enforces

| Rule | How |
|---|---|
| Risky commands wait for a review | Agent hooks deny at once and fail closed; shell chains, quotes and wrappers like `sh -c`, `sudo`, `npx` are seen through |
| You review what actually ships | `commit` shows the staged (or `-a` tracked) changes, `push` the outgoing commits; oversized or unreadable changes are denied |
| You can't approve your own request | The requester is excluded; each reviewer counts once, however they spell their name |
| Agents can't approve | Review links need the admin key; the hook refuses commands that create them or read that key |
| You can't fake reading | Time measured by the server, scroll check, a check built from the diff |
| You can't swap the code after approval | The approval is bound to the SHA-256 of the exact diff |
| You can't replay an approval | Approvals are single use (`/api/tokens/consume`) |
| You can't quietly edit history | Hash-chained receipts; `litti verify` points at the first broken link |
| Rubber-stamping has a cost | Blocked, announced, reviews reset, next action stricter |
| No AI in the trust path | Tiers and questions come from rules, not a model |

### Known limitations

- **Same-user agents.** On a laptop, the agent runs as your OS user and could read `~/.litti/` through its own file tools. The default protects against careless and over-eager agents, not one actively attacking Litti. A strict mode (passkey / Windows Hello for Tier 2+) is planned.
- **Codex needs a one-time trust step:** run `/hooks` in Codex after installing or upgrading, or Codex skips the hook.
- **OpenCode 2** isn't supported yet; the plugin targets OpenCode 1.x.
- **Rules, not a parser of intent.** A custom deploy script with an unusual name gets through unless you add it to `LITTI_GATE_PATTERNS`. A git pre-push hook and a GitHub required check are planned.
- **Proves engagement, not correctness, and not personhood.** Litti can't tell a person from an agent driving their logged-in browser.
- **Receipts are hash-chained, not signed.** Someone with write access to the database could rewrite the whole chain.
- **It isn't a sandbox.** Use it alongside one.

Threat model and deployment checklist: [SECURITY.md](SECURITY.md).

---

## Run it for a team

```bash
cp .env.example .env    # SECRET_KEY, LITTI_API_KEY, LITTI_ADMIN_KEY, PUBLIC_URL
docker compose up -d
```

The container publishes its port on 127.0.0.1 only: put your https reverse proxy or SSO proxy in front, set `LITTI_IDENTITY_HEADER`, and reviewers' names come from their login. Give each agent its own labelled key (`LITTI_API_KEYS`) so reviews show who asked. Approved actions can be handed to your CI/CD through a signed webhook. Step by step: [Run Litti for your team](docs/guide/team-setup.md).

---

## Litti by the numbers

Measured on this repository, not estimated.

| | |
|---|---|
| Automated checks | **161** in 15 test suites, plus a full TypeScript typecheck (`npm test`) |
| CI | 9 jobs on every push: Windows, macOS and Linux × Node 22, 24 and 26, each with build, `npm audit`, pack and an install smoke test |
| Agent command classifier | 100+ real shell commands in its table test (gated and not gated) |
| Hook overhead | ~140 ms per agent shell command (compiled, Windows 11, Node 22; Node's own startup is ~80 ms of that). Safe commands never contact the server |
| Runtime dependencies | 5 direct (`fastify`, `@fastify/static`, `better-sqlite3`, `dotenv`, `open`), 119 packages installed in total, `npm audit`: 0 known vulnerabilities |
| npm package | 190 kB packed, 486 kB unpacked, 81 files (includes the Albert Sans font, 30 kB) |
| Code | 6,304 lines of TypeScript in 44 files under `src/`, 2,806 lines of tests |
| Comprehension check kinds | 6 |
| Risk tiers | 4 (0–3) |
| Frontend frameworks | 0: plain HTML, CSS and JS |

---

## Documentation

**Website and docs: [abhishek764.github.io/litti](https://abhishek764.github.io/litti/)**. Litti also serves them at **http://127.0.0.1:3847/docs**, or read them here:

| Learn | Understand | Look up |
|---|---|---|
| [Install](docs/guide/install.md) | [How Litti works](docs/guide/how-it-works.md) | [CLI](docs/guide/cli.md) |
| [Lesson 1: your first review](docs/guide/first-review.md) | [Risk tiers](docs/guide/risk-tiers.md) | [HTTP API](docs/guide/api.md) |
| [Lesson 2: gate your coding agent](docs/guide/connect-agent.md) | [Comprehension checks](docs/guide/checks.md) | [Configuration](docs/guide/config.md) |
| [Lesson 3: talk it through](docs/guide/changes.md) | [Tokens and receipts](docs/guide/receipts.md) | [Troubleshooting](docs/guide/troubleshooting.md) |
| [Lesson 4: Slack, Discord, Jira](docs/guide/connect-team.md) | [Architecture roadmap](docs/architecture.md) | [Run Litti for your team](docs/guide/team-setup.md) |

---

## Development

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm run demo     # run from source
npm test         # typecheck + every test suite
npm run build    # compile to dist/ (what npm publishes)
```

Node.js + TypeScript · Fastify · SQLite (better-sqlite3) · Node `crypto` · plain HTML/CSS/JS, no frontend framework.

## Contributing

Issues and PRs are welcome. New comprehension checks, commands the gate should catch, tiering rules and agent integrations make great first contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and report security bypasses privately via [SECURITY.md](SECURITY.md). Logo and colours: [docs/brand](docs/brand/README.md).

## License

[MIT](LICENSE)
