# Configuration

Litti reads settings from environment variables and from `~/.litti/config.env` (created on first run). Environment variables win. Restart `litti` after changing them. Running from source? Use a `.env` file in the repo instead (copy `.env.example`).

## Core

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | — **required** | 32+ random characters. Signs tokens, review links and page stamps; encrypts integration tokens |
| `APPROVAL_SERVER_PORT` | `3847` | Port |
| `HOST` | `127.0.0.1` | Interface to listen on (`0.0.0.0` in containers) |
| `PUBLIC_URL` | request host | Base URL in links. Use https in production |
| `LITTI_DB_PATH` | `data/litti.db` | SQLite file |
| `LOG_LEVEL`, `TRUST_PROXY` | | Logging; trust `X-Forwarded-*` behind a proxy |

## Access

| Variable | Purpose |
|---|---|
| `LITTI_API_KEY` | Agents, CLI and pipelines must send it as `x-litti-key`. Turns on production mode |
| `LITTI_ADMIN_KEY` | Needed to issue review links. Keep it away from agents |
| `LITTI_IDENTITY_HEADER` | Trust this header from your SSO proxy as the reviewer's identity, e.g. `x-forwarded-email` |
| `LITTI_ADMINS` | SSO identities allowed to manage `/integrations` in production |
| `LITTI_ALLOW_SELF_ASSERTED` | `true` lets reviewers type a name. Demo only |

## Review

| Variable | Purpose |
|---|---|
| `LITTI_CHALLENGES` | Allowed check kinds: `quiz,spot-line,type-in,canary,count,explain` (default: all) |

## Changes view

| Variable | Purpose |
|---|---|
| `LITTI_REPO_PATH` | Git repository to watch (default: where Litti runs) |
| `LITTI_AGENT_NAME` | Name shown for agent replies and review requests |

## Agent hooks

Set these where the **agent** runs.

| Variable | Purpose |
|---|---|
| `LITTI_URL` | Litti's address (default `http://127.0.0.1:3847`) |
| `LITTI_API_KEY` | Same key as the server, if set |
| `LITTI_GATE_COMMIT` | `false` stops gating `git commit` |
| `LITTI_GATE_PATTERNS` | Extra commands to gate: regexes separated by `;;` |
| `LITTI_HOOK_FAIL_OPEN` | `true` allows commands when Litti is down. Not for production |

## Notifications

The [Integrations page](connect-team) is the easy way. These do the same from config:

| Variable | Purpose |
|---|---|
| `LITTI_NOTIFY_WEBHOOK` | Slack or Discord incoming webhooks, comma-separated (plain text) |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` | Slack app: threaded cards |
| `LITTI_DISCORD_WEBHOOK` | Discord embeds |
| `JIRA_BASE_URL`, `JIRA_PROJECT_KEY`, `JIRA_API_TOKEN`, `JIRA_EMAIL` | Jira with an API token (`JIRA_EMAIL` only for Jira Cloud) |
| `JIRA_ISSUE_TYPE`, `JIRA_MIN_TIER`, `JIRA_DONE_TRANSITION` | Issue type (default `Task`), lowest tier that opens an issue (default 2), status to move to on approval |
| `SLACK_CLIENT_ID`/`_SECRET`, `DISCORD_CLIENT_ID`/`_SECRET`, `ATLASSIAN_CLIENT_ID`/`_SECRET` | Connect-button app credentials, instead of pasting them on the page |

## Running approved actions

| Variable | Purpose |
|---|---|
| `LITTI_DEPLOY_WEBHOOK` | Approved actions are POSTed here, signed in `x-litti-signature` |
| `LITTI_WEBHOOK_SECRET` | Signing key for that webhook (default: `SECRET_KEY`) |
| `LITTI_DEPLOY_DIR` | Where deploy records go when no webhook is set (default `deployments`) |
