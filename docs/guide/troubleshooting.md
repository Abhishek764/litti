# Troubleshooting

## Installing and starting

**`npm install` fails building `better-sqlite3`.** Use Node 20.10 or newer. On Windows, install the Visual Studio Build Tools with "Desktop development with C++". On Linux, install `build-essential` and `python3`.

**`npm start` refuses to start: "SECRET_KEY must be at least 32 random characters".** Generate one and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Port 3847 is in use.** Another Litti (often a demo) is still running. Stop it, or set `APPROVAL_SERVER_PORT`.

## Reviewing

**"Please review more carefully — Tier 2 needs at least 30s."** Reviews have a minimum time, measured from when you opened the page. Read the diff, then submit.

**"This review page expired."** The page was open too long or was reopened elsewhere. Reload it and review again.

**"Rubber-stamp blocked".** The answer was wrong, or a long diff was approved too fast. Everyone reviews that action again. That's intended.

**"Reviewer identity required" or "Your review link expired".** Production mode needs a real identity: sign in through your SSO proxy, or ask an admin for a personal link with `litti review <id> --as <you>`.

## Agent hooks

**The agent says "Litti server is unreachable".** Start Litti (`npm start`), or set `LITTI_URL` where the agent runs.

**Nothing is being blocked.**
- Restart the agent after `litti install`.
- Only risky commands are gated; `npm test` is supposed to run freely. Try `git commit`.
- Codex: check that hooks are enabled for your Codex version (they may be off on Windows).

**The same approved command is blocked again.** Approval allows a command once, for the exact code that was reviewed. Running it a second time, or after any file change, needs a new review.

**Commits are too noisy.** Set `LITTI_GATE_COMMIT=false` and keep gating push, deploys and migrations.

## Integrations

**Slack: "redirect_uri did not match" or Slack won't redirect back.** The redirect URL in your Slack app must exactly match the one shown on the Integrations page, and it must be https. Locally, use the paste-a-link option.

**Jira: no projects in the list.** The account you connected needs permission to create issues in at least one project.

**Jira stopped working after a while.** Click Disconnect and Connect again. If you changed `SECRET_KEY`, every integration must be connected again.

**Nothing arrives in Slack or Discord.** Click **Send test** on the Integrations page. Only Tier 1 and higher actions send cards; Tier 0 actions are silent.

## Evidence

**`litti verify` says the chain is broken.** A receipt was edited after it was written. That is exactly what verify exists to catch. Restore the database from a backup and find out who had write access to the file.
