# Troubleshooting

## Installing and starting

**`npm install` fails building `better-sqlite3`.** Use Node 22 or newer: better-sqlite3 has prebuilt binaries for Node 22, 24 and 26 on Windows, macOS and Linux (x64 and arm64), so a source build should only happen on other versions or platforms. If it still builds from source: on Windows, install the Visual Studio Build Tools with "Desktop development with C++". On Linux, install `build-essential` and `python3`.

**Litti refuses to start: "SECRET_KEY must be at least 32 random characters".** `litti` creates one on first run in `~/.litti/config.env`; if you edited it, put back a long random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Port 3847 is in use.** Another Litti (often a demo) is still running. Stop it, or set `APPROVAL_SERVER_PORT` in `~/.litti/config.env` (the CLI and hooks read the port from there too).

**Litti refuses to start: "HOST=… makes Litti reachable from the network".** Listening on anything other than 127.0.0.1 needs an agent key. Set `LITTI_API_KEY` (and `PUBLIC_URL`), or go back to `HOST=127.0.0.1`.

**Litti refuses to start: "PUBLIC_URL is required".** With an agent key set, review links are built from `PUBLIC_URL`, never from the request. Set it to the address reviewers open.

## Reviewing

**"Please review more carefully — Tier 2 needs at least 30s."** Reviews have a minimum time, measured from when you opened the page. Read the diff, then submit.

**"This review page expired."** The page was open too long or was reopened elsewhere. Reload it and review again.

**"Rubber-stamp blocked".** The answer was wrong, or a long diff was approved too fast. Everyone reviews that action again. That's intended.

**"This review page was already submitted once".** Each page load allows one submit, pass or fail. Reload and review again.

**"The agent is named … which is also the reviewer Litti signs you in as".** Locally you review as your OS user, and nobody can approve their own request. Give the agent another name with `LITTI_AGENT_NAME`, or set `LITTI_LOCAL_REVIEWER` in `~/.litti/config.env`.

**"Reviewer identity required" or "Your review link expired".** On your own machine you're signed in as your OS user automatically, but only when Litti listens on 127.0.0.1, has no agent key and you open the page from the same machine. In team mode, sign in through your SSO proxy, or ask an admin for a personal link with `litti review <id> --as <you>`.

**`litti review` says review links need LITTI_ADMIN_KEY.** `litti` puts one in `~/.litti/config.env` on first run. From source or in Docker, set it yourself.

## Agent hooks

**The agent says "Litti server is unreachable".** Start Litti (`litti`), or set `LITTI_URL` in `~/.litti/config.env` or where the agent runs.

**"The change is too large" or "could not read the change".** Changes over 512 KB, or that git can't diff, are denied rather than reviewed blind. Split the work into smaller commits.

**Nothing is being blocked.**
- Restart the agent after `litti install`.
- Only risky commands are gated; `npm test` is supposed to run freely. Try `git commit`.
- Codex: open Codex in the project and run `/hooks` to trust the Litti hook (again after upgrading Litti). Codex skips untrusted or changed hooks without a warning.
- OpenCode: the plugin is for OpenCode 1.x; OpenCode 2 support is planned.

**The same approved command is blocked again.** Approval allows a command once, for the exact code that was reviewed. Running it a second time, or after any file change, needs a new review.

**Commits are too noisy.** Set `LITTI_GATE_COMMIT=false` and keep gating push, deploys and migrations.

## Integrations

**Slack: "redirect_uri did not match" or Slack won't redirect back.** The redirect URL in your Slack app must exactly match the one shown on the Integrations page, and it must be https. Locally, use the paste-a-link option.

**Jira: no projects in the list.** The account you connected needs permission to create issues in at least one project.

**Jira stopped working after a while.** Click Disconnect and Connect again. If you changed `SECRET_KEY`, every integration must be connected again.

**Nothing arrives in Slack or Discord.** Click **Send test** on the Integrations page. Only Tier 1 and higher actions send cards; Tier 0 actions are silent.

## Evidence

**`litti verify` says the chain is broken.** A receipt was edited after it was written. That is exactly what verify exists to catch. Restore the database from a backup and find out who had write access to the file.
