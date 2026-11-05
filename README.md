# 🔒 LITTI

[![CI](https://github.com/Abhishek764/litti/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhishek764/litti/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Your approve button is a spring lock. Litti makes sure someone turned the key.**

> Developers approve 93% of AI coding agent permission prompts. At that rate, Allow is just a slower Continue.

Litti is a lie detector for the Approve button. It proves a human actually *read*
what they approved before an AI agent is allowed to act.

Built for the **Flip the Switch** Hackathon (Nov 4–7, 2026).

---

## What Litti does

1. **Builder agent** proposes an action with the full diff.
2. **Independent gatekeeper** tiers the risk (Tier 0–3) with deterministic rules.
3. **Humans open an approval page** — see the diff, answer a comprehension quiz.
4. **Rubber-stamp detector** catches approvals too fast or too careless to be real.
5. **Deploy only runs with a cryptographic token** bound to the exact approved diff — change one byte and the token is dead.
6. **Every decision is a hash-chained receipt** — tamper with one and the chain breaks.

---

## Architecture

```
Builder Agent ──→ ActionCard ──→ Gatekeeper (independent)
                                      │
                                 Risk Tier 0-3
                                      │
                             ┌────────┴────────┐
                        Tier 0: Auto       Tier 1-3:
                        (log + run)     Approval Page
                                                │
                                        Quiz + Timer + Scroll
                                                │
                                        ┌───────┴───────┐
                                     Pass            Fail
                                        │               │
                                Signed Token     "Read it again"
                                        │
                                Deploy Executor
                             (token must match exact diff hash)
                                        │
                                 Receipt Chain
                              (hash-linked, tamper-evident)
```

---

## How to use

### 1. Try it in 2 minutes (no setup)

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm run demo
```

Your browser opens an approval page and the dashboard. Follow [`demo/scenarios.md`](demo/scenarios.md):
approve a CSS fix, get caught rubber-stamping a migration, then break and verify the receipt chain.

### 2. Run it for your team

```bash
cp .env.example .env
# edit .env: set SECRET_KEY to a long random string (e.g. `openssl rand -hex 32`)
#            set LITTI_API_KEY so only your agents can submit actions
#            set PUBLIC_URL to the address reviewers will open
npm start
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `SECRET_KEY` | yes | Signs approval tokens (HMAC-SHA256) |
| `APPROVAL_SERVER_PORT` | no | Defaults to `3847` |
| `LITTI_API_KEY` | recommended | Agents must send it as the `x-litti-key` header |
| `PUBLIC_URL` | no | Base URL used in approval links |

Put the server behind your SSO or reverse proxy so approver names map to real people.

### 3. Connect your AI agent

Before your agent does anything risky, it proposes the action:

```bash
curl -X POST http://127.0.0.1:3847/api/actions \
  -H "content-type: application/json" \
  -H "x-litti-key: $LITTI_API_KEY" \
  -d '{
    "agent": "my-agent",
    "action": "migrate",
    "description": "Add MFA columns to users",
    "diff": "+ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN;",
    "touchedPaths": ["migrations/20261105_add_mfa.sql"],
    "reversible": true,
    "rollbackPlan": "Remove the mfa_enabled column."
  }'
```

Response:

```json
{ "ok": true, "id": "…", "tier": 2, "status": "pending", "approvalUrl": "http://…/approve/…" }
```

- Share `approvalUrl` with reviewers (chat, PR comment, ticket).
- Read-only actions (`read`, `lint`, `format`, `test`) are Tier 0 and run immediately.
- Poll until reviewers finish:

```bash
curl http://127.0.0.1:3847/api/actions/<id>
# { "status": "pending" | "approved", "approvals": 1, "requiredApprovers": 2 }
```

When enough reviewers pass the quiz, Litti issues a token bound to the exact diff and runs the
executor. If the agent changes even one byte of the diff, the token no longer matches and the
deploy is blocked.

### 4. Review and audit

- Reviewers open the link, read the diff, answer the quiz, and click **Countersign**.
- Open `/dashboard.html` to see every receipt, attention scores, per-reviewer stats, and **Verify Chain**.

### 5. Make it yours

- **Risk rules:** edit `src/rules/tiering.ts` to add your critical paths (infra, billing, payments).
- **Quiz templates:** add patterns in `src/agents/gatekeeper.ts` for your stack.
- **Real deploys:** replace the mock in `src/deploy/executor.ts` with your deploy command. It only runs after the token checks pass.
- **Chat notifications:** implement the `SwitchClient` interface in `src/types.ts` for Slack, Discord, or Teams.

### API reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/actions` | Agent proposes an action; returns tier + approval link |
| `GET` | `/api/actions/:id` | Action status (never exposes the quiz answer) |
| `GET` | `/approve/:id` | Approval page for reviewers |
| `POST` | `/approve/:id/submit` | Reviewer submission (used by the page) |
| `GET` | `/api/receipts` | All receipts, newest first |
| `GET` | `/api/chain/verify` | Verify every link of the receipt chain |
| `GET` | `/api/stats` | Per-reviewer attention and rubber-stamp stats |

See [SECURITY.md](SECURITY.md) for deployment notes.

---

## How the guarantees work

| Guarantee | Mechanism |
|-----------|-----------|
| Can't act without approval | Deploy executor refuses without a valid token |
| Can't fake comprehension | Quiz answer validated server-side; min dwell time; scroll check |
| Can't swap the diff after approval | Token's `diffHash` must equal SHA-256 of the current diff |
| Can't replay an approval | Tokens are single-use (consumed in SQLite) |
| Can't quietly edit history | Receipts are SHA-256 hash-chained; Verify Chain detects any change |
| Can't rubber-stamp | Fast/careless approvals are flagged and bump the next action's tier |

---

## Tech

Node.js + TypeScript · Fastify · better-sqlite3 · Node `crypto` (SHA-256 + HMAC) ·
plain HTML/CSS/JS (no frontend framework, no build step for the pages).

## Switch integration

The standalone demo is the priority and needs no Switch install. When connected to a
Switch room, the builder and gatekeeper agents post ActionCards, approval links, and
rubber-stamp warnings to the room via the `SwitchClient` interface
([`src/agents/switchStub.ts`](src/agents/switchStub.ts) is the drop-in local stub).

## Contributing

Issues and PRs welcome — new quiz templates, tiering rules and chat integrations are great first contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` before opening a PR.

Please report security bypasses privately (see [SECURITY.md](SECURITY.md)).

## License

[MIT](LICENSE)
