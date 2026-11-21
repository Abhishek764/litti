# HTTP API

Everything the CLI and hooks do goes through this API. All bodies are JSON.

**Auth:** when `LITTI_API_KEY` is set, agent and pipeline calls send it as `x-litti-key`. Review links need `x-litti-admin-key` when `LITTI_ADMIN_KEY` is set.

## Agents

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/actions` | Propose an action. Returns `{id, tier, status, approvalUrl}`, or a token right away for Tier 0 |
| `GET` | `/api/actions/:id` | Status; includes `token` once approved |
| `GET` | `/api/pending` | Actions waiting for review |
| `POST` | `/api/gate` | Used by agent hooks: `{agent, action, description, diff, touchedPaths, command}` → `{decision: "allow" \| "deny", message, approvalUrl}` |

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

`action` is one of `read`, `lint`, `format`, `test`, `edit`, `migrate`, `deploy`, `delete`. Diffs are limited to 512 KB.

Poll `GET /api/actions/:id` until `status` is `approved`, then run exactly that diff with the returned token.

## Reviewers and admins

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Review inbox |
| `GET` | `/approve/:id` | Review page |
| `POST` | `/api/actions/:id/review-link` | `{reviewer}` → personal signed link (admin) |
| `POST` | `/api/actions/:id/retry` | Re-run delivery for an approved action whose deploy failed (status `deploy-failed`). Admin key in team mode; open locally. 200 delivered, 502 failed again, 409 nothing to retry |
| `GET` | `/changes` | Changes view |
| `GET` | `/integrations` | Integrations page (admins) |
| `GET` | `/dashboard.html` | Dashboard |

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
| `POST` | `/api/tokens/verify` | `{token, diff}` → is this token valid for this exact diff? |
| `GET` | `/api/receipts` | All receipts, newest first |
| `GET` | `/api/chain/verify` | Per-receipt verification |
| `GET` | `/api/stats` | Reviewer attention stats |
| `GET` | `/healthz` | Liveness |
