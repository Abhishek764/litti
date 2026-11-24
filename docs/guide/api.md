# HTTP API

Everything the CLI and hooks do goes through this API. All bodies are JSON.

**Auth.** In team mode (`LITTI_API_KEY` or `LITTI_API_KEYS` set), agent and pipeline calls send their key as `x-litti-key`. With labelled keys (`LITTI_API_KEYS=label:key,…`) the key's label is the requester; the body's `agent` is kept only as `agentDetail` for display. Review links always need `x-litti-admin-key` (`LITTI_ADMIN_KEY`).

## Agents

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/actions` | Propose an action. Returns `{id, tier, status, approvalUrl}`, or a token right away for Tier 0 |
| `GET` | `/api/actions/:id` | Status (`pending`, `approved`, `rejected`, `deploy-failed`, `superseded`); includes `token` once approved |
| `GET` | `/api/pending` | Actions waiting for review |
| `POST` | `/api/gate` | Used by agent hooks: `{agent, action, description, diff, touchedPaths, command, repo?}` → `{decision: "allow" \| "deny", message, approvalUrl}` |

### Propose

```bash
curl -X POST http://127.0.0.1:3847/api/actions \
  -H 'content-type: application/json' -H "x-litti-key: $LITTI_API_KEY" \
  -d '{
    "agent": "release-bot",
    "action": "deploy",
    "description": "Ship v2.3 to production",
    "diff": "…unified diff…",
    "touchedPaths": ["deploy/prod.yaml"],
    "reversible": true,
    "rollbackPlan": "Redeploy v2.2"
  }'
```

- `action` is one of `read`, `lint`, `format`, `test`, `edit`, `migrate`, `deploy`, `delete`. A `read`/`lint`/`format`/`test` whose diff changes lines is still at least Tier 1: the tier comes from the content, not the label.
- `reversible` must be a JSON boolean (`400` otherwise).
- Diffs are limited to 512 KB (`413`).
- In local mode, an agent named like the local reviewer is refused (`400`): the requester can never approve their own action.

Poll `GET /api/actions/:id` until `status` is `approved`. Then, right before shipping, call `POST /api/tokens/consume` with the token and the exact diff (see below).

### Gate requests

A newer gate request for the same command in the same repository (and from the same key) replaces an older one that is still pending. The old one gets status `superseded`, leaves the inbox, and can no longer be approved (`409`).

## Reviewers and admins

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Review inbox (needs a signed-in user in team mode) |
| `GET` | `/approve/:id` | Review page |
| `POST` | `/approve/:id/submit` | Submit a review (the review page does this) |
| `POST` | `/api/actions/:id/review-link` | `{reviewer}` → personal signed link, valid 30 minutes. Needs `x-litti-admin-key` |
| `POST` | `/api/actions/:id/retry` | Re-run delivery for an approved action whose deploy failed (status `deploy-failed`). Admin key when one is set; refused with only an agent key; open in local mode. `200` delivered, `502` failed again, `409` nothing to retry |
| `GET` | `/changes` | Changes view |
| `GET` | `/integrations` | Integrations page (admins) |
| `GET` | `/dashboard.html` | Dashboard |

### Submit responses

| Status | Meaning |
|---|---|
| `200` | Countersigned, or approved and delivered |
| `401` | No reviewer identity, or the review link expired |
| `400` | The review page expired: reload it |
| `403` | The requester tried to approve, or the page was opened for a different reviewer |
| `404` | Unknown action |
| `409` | Not pending (approved, superseded…), already countersigned by this reviewer, or this page was already submitted once |
| `422` | Failed a check: rubber-stamp, too fast, didn't scroll, wrong answer |
| `502` | Approved, but the deploy webhook failed (`deploy-failed`; retry with the endpoint above) |

Every submit, pass or fail, uses up the page's signed "opened at" stamp. After a failed submit, reload the page and review again.

## Changes and notes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/changes` | Changed files, diffs, `version` |
| `GET` | `/api/notes?status=open` | Note threads |
| `POST` | `/api/notes` | `{file, line, snippet, body}` or `{parentId, body}` |
| `POST` | `/api/notes/:id/resolve` | Resolve (`{open: true}` reopens) |
| `POST` | `/api/changes/review` | Turn the working-tree diff into a review |

Browser writes must include `x-litti-ui: 1`. Agents use `x-litti-key`, or `x-litti-agent: 1` when no key is configured.

## Evidence and pipelines

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/tokens/consume` | `{token, diff}` → checks the token against this exact diff **and uses it up**. Call it right before shipping. `200` `{valid: true}`; `409` `{valid: false, reason}` when it's for another diff, not approved, Tier 0, or already used |
| `POST` | `/api/tokens/verify` | Same check without using the token up (a dry run) |
| `GET` | `/api/receipts` | All receipts, newest first (agent key or signed-in user) |
| `GET` | `/api/chain/verify` | Per-receipt verification (agent key or signed-in user) |
| `GET` | `/api/stats` | Reviewer attention stats (agent key or signed-in user) |
| `GET` | `/api/meta` | `{demo}`: whether this is a demo server |
| `GET` | `/healthz` | Liveness: always just `{ok: true}` |

```bash
curl -X POST http://127.0.0.1:3847/api/tokens/consume \
  -H 'content-type: application/json' -H "x-litti-key: $LITTI_API_KEY" \
  -d '{"token": {…}, "diff": "…the diff you are about to ship…"}'
```

Ship only when it answers `"valid": true`. A second call with the same token answers `409`, so an approval can't be shipped twice.
