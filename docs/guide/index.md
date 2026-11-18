# Proof that a human read it

Litti sits between your coding agent and anything risky it wants to do. Before a migration, a deploy, a `git push` or a big delete runs, a person has to open the change, read it, and pass a short check that proves they understood it. Every decision ends up in a tamper-evident receipt.

## The problem

Coding agents ask "Allow this command?" dozens of times a day. People click **Approve** almost every time, often without reading. An approve button tells you someone clicked. It doesn't tell you anyone looked.

## What Litti does

### Stops risky actions until someone reviews them
Small, read-only work (tests, lint, reading files) goes straight through. Writes, deploys and destructive commands get a **risk tier** from 1 to 3, and each tier needs that many different reviewers.

### Makes the reviewer prove they read it
The review page shows the diff and asks a question built from the diff itself: pick the table it drops, click the risky line, type the function it changes, spot a fake line, or explain it in your own words. The kind of check changes every time, so approving never turns into muscle memory.

### Catches rubber-stamping
Approving a big diff in a few seconds, or answering wrong, is blocked and announced. Everyone's review on that action is reset and the next action gets a stricter tier.

### Binds approval to the exact change
Approval produces a signed token tied to the SHA-256 of the diff. Change one byte and the token stops working.

### Keeps evidence
Every decision is chained into a hash-linked receipt log. `litti verify` tells you if anyone edited the history.

## What's included

- Review inbox, review page and dashboard
- **Changes** view: watch what the agent changed and comment on lines; the agent answers in the thread
- Hooks for **Claude Code**, **Codex** and **OpenCode** that block risky commands until they're reviewed
- **Connect** buttons for Slack, Discord and Jira
- A `litti` command line and an HTTP API for any other agent or pipeline
- One Node process and a SQLite file. Your code never leaves your server.

## Where to start

New here? Follow the lessons in order:

1. [Install Litti](install)
2. [Lesson 1: your first review](first-review)
3. [Lesson 2: put your coding agent behind Litti](connect-agent)
4. [Lesson 3: talk it through in Changes](changes)
5. [Lesson 4: tell your team in Slack, Discord or Jira](connect-team)

Want to know how it works inside? Read [How Litti works](how-it-works).
