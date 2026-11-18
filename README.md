<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo/litti-horizontal-dark.svg">
  <img alt="Litti" src="docs/brand/logo/litti-horizontal-light.svg" width="360">
</picture>

# litti

[![CI](https://github.com/Abhishek764/litti/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhishek764/litti/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

**Your approve button is a spring lock. Litti makes sure someone turned the key.**

> Developers approve 93% of AI coding agent permission prompts. At that rate, Allow is just a slower Continue.

Litti is **proof of review** for AI coding agents. When an agent wants to do something risky
(run a migration, deploy, delete data, touch auth), it asks Litti first. Litti works out how risky
the action is, asks the right number of teammates to review it, makes each reviewer **prove they
read the diff**, and only then lets the action run. Every decision is written to a tamper-evident
receipt chain.

Other approval tools prove someone clicked. Litti proves they understood.

- **No LLM in the trust path.** Quizzes are generated deterministically from the diff. Your code never leaves your machine.
- **Self-hosted.** One Node process and a SQLite file. Docker image included.
- **Works with any agent.** HTTP API and a `litti` CLI. Approval cards go to your terminal and to Slack or Discord via webhook.

---

## How it works

```mermaid
sequenceDiagram
    autonumber
    participant A as Coding agent
    participant L as Litti
    participant N as Slack / Discord / terminal
    participant R as Reviewer
    participant X as Executor
    participant C as CI/CD

    A->>L: POST /api/actions {action, diff, paths}
    L->>L: tier 0-3, reasons, quiz from the diff
    L->>N: 🔒 Approval needed: Tier 2 · 2 reviewers
    R->>L: open personal review link (server stamps open time)
    R->>L: read diff · pass the check · countersign
    alt too fast / wrong answer
        L->>N: ⚠️ rubber-stamp blocked, reviews reset, next tier +1
    else passed, more reviewers needed
        L->>N: ✍️ countersigned (1/2)
    else all reviewers passed
        L->>X: HMAC token bound to SHA-256(diff)
        X->>C: signed webhook (action + token)
        X->>N: ✅ deploy executed · reviewed by …
    end
    A->>L: GET /api/actions/:id
    L-->>A: approved + token: run exactly this diff
```

## What Litti checks

1. **Risk tier (0–3)** from deterministic rules: critical paths (`migration`, `auth`, `prod`, `.env`…), diff size, destructive commands (`DROP`, `DELETE FROM`, `rm -rf`, `git push --force`), irreversibility. Calling a risky action "lint" doesn't skip review.
2. **Enough distinct reviewers**: Tier 1 = 1, Tier 2 = 2, Tier 3 = 3. The requester can't review their own action, and nobody counts twice.
3. **Comprehension check that changes every time**, generated from the diff itself. The multiple-choice quiz is only one kind; Litti picks a different kind per action (never the same twice in a row) so approving never becomes muscle memory:

   | Kind | The reviewer… |
   |---|---|
   | Quiz | picks the right fact from 4 options ("Which table does this migration alter?") |
   | Spot the line | clicks the line in the diff that does the risky thing |
   | Recall | types the table / function / route / new value from memory, no options to guess from |
   | Canary check | says whether a line was really in the change; sometimes it's a subtly altered fake |
   | Count | types how many lines the change adds or removes (small diffs) |
   | Explain it | writes a one-sentence summary that names what changed; saved in the receipt as the review note |

   Tier 2+ never uses the guessable kinds (canary, count). Restrict the set with `LITTI_CHALLENGES=quiz,spot-line,...`.
4. **Real reading time**, measured by the server from a signed page-open stamp. The browser's clock is never trusted.
5. **Scrolled to the end** of long diffs.
6. **Rubber-stamp detector**: too fast on a big diff or a wrong answer is blocked and announced, every review on the action is reset, and the next action's tier goes up by one. Repeat offenders are called out.
7. **Diff-bound token**: an HMAC-signed token tied to the SHA-256 of the exact approved diff. Change one byte and it's dead. Tokens are single-use.
8. **Receipt chain**: every decision is SHA-256 hash-linked to the previous one. Editing history breaks the chain visibly.

---

## Quick start (about 2 minutes)

**Requirements:** Node.js 20.10+.

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm run demo
```

The demo starts Litti with a fresh database and three sample actions (a CSS tweak, a database
migration, a destructive cleanup). Your browser opens the first review page and the dashboard.

- **Review inbox:** http://127.0.0.1:3847/
- **Dashboard:** http://127.0.0.1:3847/dashboard.html

Try it: read the diff, pass the comprehension check, countersign. Then answer wrong or too fast on the Tier 3
action and watch the rubber-stamp detector block it. In another terminal:

```bash
npm run litti -- pending
npm run litti -- verify
```

Walk through the scenarios: [demo/scenarios.md](demo/scenarios.md).

---

## Connect your coding agent

### Enforce it with a hook (Claude Code, Codex, OpenCode)

One command makes risky agent commands impossible to run without a review:

```bash
npm run litti -- install claude   --dir ~/code/my-project   # .claude/settings.json  (PreToolUse hook)
npm run litti -- install codex    --dir ~/code/my-project   # .codex/hooks.json      (PreToolUse hook)
npm run litti -- install opencode --dir ~/code/my-project   # .opencode/plugin/litti.ts
npm run litti -- install all      --dir ~/code/my-project
```

What happens next:

1. Everyday commands (tests, builds, `git status`, edits) run instantly. The hook never calls the server for them.
2. A **risky** command (`git commit`, `git push`, deploys, `npm publish`, migrations, `rm -rf`, `DROP TABLE`,
   `terraform apply`, `kubectl delete`…) is **denied at once** with a review link. The command *and* the
   working-tree diff it would ship are what the reviewer sees and is quizzed on.
3. The agent tells you; you review. When approved, the agent runs **the same command** again and it is
   allowed **once**. If the code changed in the meantime, it's a new review.
4. If Litti is down, risky commands are blocked (fail closed). `LITTI_HOOK_FAIL_OPEN=true` turns that off for local experiments.

Tune with `LITTI_GATE_COMMIT=false` (don't gate commits) and `LITTI_GATE_PATTERNS` (extra regexes, `;;`-separated).
Set `LITTI_URL` and `LITTI_API_KEY` in the agent's environment if the server isn't local or uses a key.
Codex: hooks may need enabling in your Codex config, and some versions skip hooks on Windows; see the
[Codex hooks docs](https://developers.openai.com/codex/hooks).

### Or ask Litti from your agent's instructions

Give your agent the rule in [docs/agent-instructions.md](docs/agent-instructions.md) (system prompt,
`CLAUDE.md`, `AGENTS.md`, or similar). In short: before any migration, deploy, delete, or change to
auth/security/prod config, ask Litti and wait for **APPROVED**.

**With the CLI:**

```bash
npm run litti -- propose action.json      # or: cat action.json | npm run litti -- propose -
npm run litti -- status <id>              # proceed only when it says APPROVED
```

```json
{
  "agent": "coder-bot",
  "action": "migrate",
  "description": "Add MFA columns to users",
  "diff": "+ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;",
  "touchedPaths": ["migrations/20261105_add_mfa.sql"],
  "reversible": true,
  "rollbackPlan": "Remove the mfa_enabled column."
}
```

**With HTTP:**

```bash
curl -X POST http://127.0.0.1:3847/api/actions \
  -H "content-type: application/json" -H "x-litti-key: $LITTI_API_KEY" \
  -d @action.json
# → { "id": "…", "tier": 2, "status": "pending", "approvalUrl": "…" }

curl -H "x-litti-key: $LITTI_API_KEY" http://127.0.0.1:3847/api/actions/<id>
# → { "status": "approved", "token": { …signed, diff-bound… } }
```

## Reviewers

Reviewers open actions from the **inbox** (`/`) or from the approval card posted to your team chat.
In production each reviewer needs a verified identity, strongest first:

1. **SSO header**: put Litti behind your auth proxy and set `LITTI_IDENTITY_HEADER` (e.g. `x-forwarded-email`).
2. **Personal review link**: signed, bound to one action and one reviewer, expires in 30 min.
   ```bash
   npm run litti -- review <id> --as priya
   ```
3. **Typed name**: demo only (`LITTI_ALLOW_SELF_ASSERTED=true`).

## Changes: see what the agent changed, talk it through

Open **`/changes`** while your agent works. It shows the live working-tree diff of `LITTI_REPO_PATH`
(edits, deletions and new files against `HEAD`), refreshed every few seconds.

- **Comment on any line** (or a whole file) to ask the agent why, or tell it what to change.
- **The agent answers in the same thread.** It reads open notes and replies from the CLI:
  ```bash
  npm run litti -- notes                      # open notes, with file:line and the code they're on
  npm run litti -- reply note_ab12 "Reverted, callers already pass cents."
  npm run litti -- resolve note_ab12
  ```
- **Request review** (button, or `litti submit "what this does"`) turns the whole diff into a Litti action:
  tiered, with a comprehension check, receipts and notifications as usual. Open notes are flagged in the description.

Agents authenticate with `x-litti-key`; reviewers are allowed in the same way as the inbox (locally, or behind your SSO proxy).

## Team notifications

**Easiest: open `/integrations` and click Connect.** Slack, Discord and Jira each have a Connect button
that signs you in on their site and brings you back connected; tokens are stored encrypted with your `SECRET_KEY`.
The page walks you through the one-time app setup with copy buttons for every value (Slack gets a
pre-filled app), and Slack and Discord also accept a pasted webhook link if you just want it working in a minute.
In production only people in `LITTI_ADMINS` (identified by your SSO header) can manage integrations.
Prefer config files? The environment variables below still work.

Litti posts approval cards, countersign progress, rubber-stamp warnings and deploy results to your team.
Approving never happens in chat or in a ticket: reviewers always open the review page and pass the quiz.
Only metadata is sent (description, paths, risk reasons, line count, diff hash). The diff itself never leaves your server.

| Integration | Set | What you get |
|---|---|---|
| **Slack app** | `SLACK_BOT_TOKEN` (`xoxb-…`, scope `chat:write`) + `SLACK_CHANNEL` | Block Kit card with a *Review in Litti* button. Updates arrive as thread replies; rubber-stamps are broadcast to the channel. When the action closes, the card is edited in place. |
| **Discord** | `LITTI_DISCORD_WEBHOOK` (channel webhook URL) | Colour-coded embed linking to the review page, follow-up embeds per event, card recoloured on close. `@everyone`/role pings are always disabled. |
| **Jira** | `JIRA_BASE_URL`, `JIRA_PROJECT_KEY`, `JIRA_API_TOKEN`, plus `JIRA_EMAIL` for Jira Cloud | One issue per action at `JIRA_MIN_TIER` or higher (default 2), labelled `litti` + `litti-tier-N`. Every review event is a comment. Set `JIRA_DONE_TRANSITION` (e.g. `Done`) to move the issue on approval. Without `JIRA_EMAIL`, Litti uses a Data Center personal access token (REST v2). |
| **Any webhook** | `LITTI_NOTIFY_WEBHOOK` (comma-separate several) | Plain text `{text, content}` that Slack and Discord incoming webhooks accept. |

Incomplete settings are reported at startup and that integration stays off; a failing integration never blocks a review.

---

## Running it for your company

```bash
cp .env.example .env        # set SECRET_KEY, PUBLIC_URL, LITTI_API_KEY
docker compose up -d        # uses .env, stores data in a volume, health-checked
```

or `npm start` on any Node 20.10+ host. `npm start` validates the config and refuses to start with a weak `SECRET_KEY`.

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | **Required.** 32+ random chars. Signs approval tokens, review links, view stamps. |
| `PUBLIC_URL` | Base URL reviewers open (use https in production). |
| `LITTI_API_KEY` | Required header `x-litti-key` for the agent/pipeline/CLI API. |
| `LITTI_ADMIN_KEY` | Required header `x-litti-admin-key` to issue review links. Give it to reviewers' admins, never to agents. Without it, the API key can issue links. |
| `LITTI_NOTIFY_WEBHOOK` | Slack/Discord incoming webhook(s) for approval cards and updates. |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` | Slack app: threaded approval cards (see Team notifications). |
| `LITTI_DISCORD_WEBHOOK` | Discord embeds with a review link. |
| `JIRA_BASE_URL`, `JIRA_PROJECT_KEY`, `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_ISSUE_TYPE`, `JIRA_MIN_TIER`, `JIRA_DONE_TRANSITION` | Jira issue per risky action. |
| `LITTI_IDENTITY_HEADER` | Trust a header from your SSO proxy (e.g. `x-forwarded-email`) as reviewer identity. |
| `LITTI_DEPLOY_WEBHOOK` | Approved actions are POSTed here, signed in `x-litti-signature` (HMAC-SHA256). |
| `LITTI_WEBHOOK_SECRET` | Deploy webhook signing key (defaults to `SECRET_KEY`). |
| `LITTI_DB_PATH` | SQLite file (default `data/litti.db`). |
| `LITTI_DEPLOY_DIR` | Where deploy records are written when no deploy webhook is set (default `deployments`). |
| `LITTI_REPO_PATH` | Git repository the Changes view watches (default: the server's working directory). |
| `LITTI_AGENT_NAME` | Name shown for agent replies and on actions sent from Changes (default `agent`). |
| `LITTI_GATE_COMMIT`, `LITTI_GATE_PATTERNS`, `LITTI_HOOK_FAIL_OPEN` | Agent hook tuning (see Connect your coding agent). |
| `LITTI_ADMINS` | Comma list of SSO identities allowed to manage `/integrations` in production. |
| `SLACK_CLIENT_ID`/`_SECRET`, `DISCORD_CLIENT_ID`/`_SECRET`, `ATLASSIAN_CLIENT_ID`/`_SECRET` | Optional: Connect-button app credentials from config instead of the Integrations page. |
| `LITTI_CHALLENGES` | Comma list of allowed check kinds (`quiz,spot-line,type-in,canary,count,explain`). Default: all. |
| `LITTI_ALLOW_SELF_ASSERTED` | `true` lets reviewers type a name. Demo only. Leave unset in production. |
| `LITTI_URL` | CLI only: where the `litti` command finds the server (default `http://127.0.0.1:3847`). |
| `HOST`, `APPROVAL_SERVER_PORT`, `LOG_LEVEL`, `TRUST_PROXY` | Server settings. |

**Wiring deploys:** point `LITTI_DEPLOY_WEBHOOK` at your CI/CD. Verify the signature, then deploy
`action.diff`. Before shipping, a pipeline can double-check with
`POST /api/tokens/verify {token, diff}`. It returns `valid: false` if the diff changed even one byte.
Example receiver: [docs/webhook-receiver.md](docs/webhook-receiver.md).

**Architecture and roadmap to HA, hybrid and multi-region:** [docs/architecture.md](docs/architecture.md).

**Tuning:** add your own critical paths in [src/rules/tiering.ts](src/rules/tiering.ts) quiz templates in [src/agents/gatekeeper.ts](src/agents/gatekeeper.ts) and challenge kinds in [src/agents/challenges.ts](src/agents/challenges.ts).

### CLI

| Command | Purpose |
|---|---|
| `litti propose <file.json \| ->` | Ask for approval |
| `litti review <id> --as <name>` | Personal, signed review link for one reviewer (needs `LITTI_ADMIN_KEY`) |
| `litti status <id>` | Approved yet? Prints the token once approved |
| `litti pending` | Actions waiting for reviewers |
| `litti verify` | Check the receipt chain for tampering |
| `litti stats` | Reviewer attention scores and rubber-stamps |

Run with `npm run litti -- <command>`.

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/actions` | `x-litti-key` | Propose an action → tier + review link |
| `GET` | `/api/actions/:id` | `x-litti-key` | Status; includes the signed token once approved |
| `GET` | `/api/pending` | `x-litti-key` | Actions waiting for reviewers |
| `POST` | `/api/actions/:id/review-link` | `x-litti-admin-key` | Personal, signed review link `{reviewer}` |
| `POST` | `/api/tokens/verify` | `x-litti-key` | Check a token against the diff you're about to ship |
| `GET` | `/` | SSO header when `LITTI_API_KEY` is set | Review inbox |
| `GET` | `/approve/:id` | review link / SSO | Review page |
| `GET` | `/api/receipts` · `/api/chain/verify` · `/api/stats` | — | Dashboard data |
| `GET` | `/healthz` | — | Health check |

---

## Architecture

| Component | File | Responsibility |
|---|---|---|
| Gatekeeper | [src/agents/gatekeeper.ts](src/agents/gatekeeper.ts), [src/rules/tiering.ts](src/rules/tiering.ts) | Deterministic tier 0–3 + quiz built from the diff's changed lines |
| Review server | [src/approval/server.ts](src/approval/server.ts), [page.ts](src/approval/page.ts), [inbox.ts](src/approval/inbox.ts) | Inbox, review page, submit flow, agent + pipeline API, dashboard data |
| Identity | [src/approval/identity.ts](src/approval/identity.ts) | Signed review links, SSO header, server-measured review time |
| Rubber-stamp detector | [src/rules/rubberstamp.ts](src/rules/rubberstamp.ts) | Too fast, wrong answer, serial rubber-stamper |
| Tokens | [src/approval/token.ts](src/approval/token.ts) | HMAC-SHA256 token bound to the diff hash and approvers |
| Executor | [src/deploy/executor.ts](src/deploy/executor.ts) | Validates and burns the token, then signed webhook or deploy record |
| Notifiers | [src/notify/](src/notify/) | Terminal, webhooks, Slack app, Discord, Jira |
| CLI | [src/cli.ts](src/cli.ts) | `litti` command over the HTTP API |
| Receipt chain | [src/chain/](src/chain/) | SQLite storage, SHA-256 hash-linked receipts, verification |

**Data model**

- **ActionCard**: what the agent wants to do: action, description, diff, `diffHash`, touched paths, reversible, rollback plan.
- **PendingAction**: card + tier + required reviewers + quiz (answer kept server-side) + approvals so far + status.
- **ApprovalToken**: `{tokenId, actionId, diffHash, approvers, quizResults, signature}`, where `signature = HMAC(tokenId | diffHash | approvers)`.
- **Receipt**: `chainHash = SHA-256(id + previousHash + card + outcome + attentionScore)`, and each receipt points to the previous one.

## Guarantees

| Guarantee | Mechanism |
|---|---|
| Can't act without approval | Executor refuses without a valid, unused token |
| Can't approve as someone else | SSO header or signed, expiring, per-action review link |
| Can't approve your own request | Requester excluded; each reviewer counts once |
| Can't fake reading | Server-measured time from a signed stamp, server-side quiz check, scroll check |
| Can't swap the diff after approval | Token is bound to the diff's SHA-256 |
| Can't replay an approval | Tokens are single-use |
| Can't quietly edit history | Hash-chained receipts; `litti verify` / dashboard detect any change |
| Rubber-stamps have a cost | Blocked, announced, reviews reset, next tier +1 (persisted) |

Today an agent has to choose to ask Litti. Hooks that make it automatic (Claude Code, Cursor, git,
CI) are next on the roadmap. See [SECURITY.md](SECURITY.md) for the threat model and deployment notes.

---

## Development

```bash
npm test     # typecheck + core flow, production hardening, and CLI checks
```

Stack: Node.js + TypeScript · Fastify · SQLite (better-sqlite3) · Node `crypto` · plain HTML/CSS/JS. No frontend framework, no LLM in the trust path.

## Brand

Logo files, colours and usage rules: [docs/brand](docs/brand/README.md).

## Contributing

Issues and PRs are welcome. New quiz templates, tiering rules and integrations make good first contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report security bypasses privately ([SECURITY.md](SECURITY.md)).

## License

[MIT](LICENSE)
