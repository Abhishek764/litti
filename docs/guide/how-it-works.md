# How Litti works

This page explains Litti's architecture: the parts, how a request flows through them, and why each piece exists.

## The flow

```
  coding agent ──► hook / CLI / HTTP API
                        │  propose(action, diff)
                        ▼
                 ┌──────────────┐
                 │  Gatekeeper  │  risk tier 0–3 + comprehension check from the diff
                 └──────┬───────┘
          tier 0        │        tier 1–3
       ┌────────────────┴────────────────┐
       ▼                                 ▼
  auto-approve                     review page  ◄── Slack / Discord / Jira link
                                         │  read · scroll · answer · countersign
                                         ▼
                                ┌──────────────────┐
                                │ rubber-stamp     │  too fast / wrong → blocked, reset, tier +1
                                │ detector         │
                                └────────┬─────────┘
                                         │  enough reviewers passed
                                         ▼
                                signed token (bound to SHA-256 of the diff)
                                         │
                                         ▼
                                executor ──► your CI/CD webhook (or a deploy record)
                                         │
                                         ▼
                                receipt chain (hash-linked, verifiable)
```

## The parts

| Part | Where | Job |
|---|---|---|
| Action card | `src/agents/builder.ts` | What the agent wants to do: action, description, diff, paths, reversible?, rollback plan, diff hash |
| Tiering | `src/rules/tiering.ts` | Deterministic risk tier, no AI, no randomness. See [Risk tiers](risk-tiers) |
| Comprehension checks | `src/agents/challenges.ts` | Six kinds of check built from the diff. See [Comprehension checks](checks) |
| Review page | `src/approval/page.ts` | Shows the diff and the check; measures time and scrolling |
| Identity | `src/approval/identity.ts` | Who is reviewing: SSO header, signed personal link, your OS user on your own machine, or a typed name in the demo |
| Rubber-stamp detector | `src/rules/rubberstamp.ts` | Blocks fast or wrong approvals and raises the next tier |
| Tokens | `src/approval/token.ts` | HMAC-signed approval bound to the diff hash; single use |
| Executor | `src/deploy/executor.ts` | Checks the token, burns it, hands the action to your pipeline |
| Receipts | `src/chain/` | Hash-chained log of every decision; `verify` detects edits |
| Notifiers | `src/notify/`, `src/connect/` | Terminal, webhooks, Slack, Discord, Jira; Connect buttons |
| Changes | `src/changes/` | Live working-tree diff with line notes |
| Agent hooks | `src/integrations/` | Claude Code / Codex / OpenCode gate and installer |
| Server | `src/approval/server.ts` | Fastify routes for all of the above |
| Storage | `src/chain/db.ts` | One SQLite file |

## Design decisions

### No AI in the trust path
Tiers and checks are computed with rules and string matching. The same diff and review history always get the same tier (a rubber-stamp makes the next action one tier stricter), nothing is sent to a model, and an agent can't talk its way into a lower tier: the tier comes from the diff and paths, not from the action's label.

### Deny now, never wait
Agent hooks answer immediately. If a review is needed, the command is **denied** with a link, and the agent retries after approval. A hook that waits for a human would time out, and most agents treat a timed-out hook as "allowed".

### Fail closed
If Litti can't be reached, risky commands are blocked.

### The server measures time
The review page gets a signed "opened at" stamp. Review time is computed on the server from that stamp, so a script can't claim it spent 60 seconds reading.

### Approval is bound to bytes
The token covers the SHA-256 of the diff. Your pipeline calls `POST /api/tokens/consume {token, diff}` right before shipping, which also uses the token up. One changed byte and it's invalid. For `git push`, the review covers the commits that would be sent, so a new commit means a new review.

### Evidence you can check yourself
Each receipt's hash covers the previous receipt's hash. Change any old receipt and every hash after it stops matching.

### Diffs stay home
Notifications carry the description, the command, file names, risk reasons and the diff's hash. Diffs are never sent. Integration tokens are encrypted with your `SECRET_KEY`. Request logs never contain client IPs, the machine name or query strings.

### Solo by default, teams by config
On your own machine (Litti on 127.0.0.1, no agent key) you're signed in as your OS user and there's nothing to set up. An agent key, an SSO header and personal review links turn on team mode. Review links always need the admin key, and the agent hook refuses commands that create them or read that key.

## Scaling up

Litti runs today as one process with SQLite. The plan for high availability, a hybrid mode where the data stays in your network, and multiple regions is in [docs/architecture.md](https://github.com/Abhishek764/litti/blob/main/docs/architecture.md).
