# Litti — demo scenarios (about 4 minutes)

```bash
npm run demo
```

The terminal shows three proposed actions and their approval cards. The review page and dashboard
open in your browser. The inbox at http://127.0.0.1:3847/ lists everything waiting for review.

> Want the cards in Slack or Discord too? Set `LITTI_NOTIFY_WEBHOOK` to an incoming-webhook URL before `npm run demo`.

---

## Scenario 0: An agent asks permission (30s)

In a second terminal, do what a coding agent would do:

```bash
echo '{"agent":"coder-bot","action":"migrate","description":"Drop the legacy_tokens table","diff":"+DROP TABLE legacy_tokens;","touchedPaths":["migrations/009_drop_legacy.sql"],"reversible":false}' \
  | npm run litti -- propose -
```

Litti answers: **🔒 Tier 3 — needs 3 reviewer(s)**, with a review link, and the approval card shows
the reasons (destructive, irreversible). `npm run litti -- status <id>` says PENDING. There is no
"approve" command: approving only happens on the review page.

**Point:** the agent can't act on its own say-so.

---

## Scenario 1: Happy path (Tier 1 CSS fix, 30s)

1. Open the **css-fix** link from the terminal (or the inbox).
2. Read the 8-line diff. Quiz: "What does `border-radius` change to?" The answer is `8px`.
3. Type your name, tick **I have reviewed this change**, wait past 10s (the server times you), then **Countersign**.
4. The terminal shows `✅ Deploy executed — reviewed by you · attention 9x/100 · receipt chained.`

**Point:** one human, real comprehension, a clean approval.

---

## Scenario 2: Rubber-stamp caught (Tier 2 migration, 90s)

1. Open the **migration** link and type `sam` as the name (demo mode). Click a wrong answer and Countersign within 3 seconds.
2. Blocked: `⚠️ @sam Comprehension quiz failed. Blocked. All reviews reset, and the next action's tier is bumped +1.`
3. Now do it properly as `priya`: read it, answer `users`, wait 30s, Countersign → `✍️ priya countersigned (1/2)`.
4. Then as `sam` again, properly → `✅ Deploy executed`, reviewed by priya and sam.
5. Try countersigning as `priya` twice: `already countersigned`. Two different people are required.
6. `npm run litti -- stats` shows sam's low attention score and 1 rubber-stamp.

**Point:** fast clicks don't count, and one person can't count twice.

---

## Scenario 3: Tamper detected (30s)

1. On the dashboard, click **Verify Chain**. Every link animates to ✅.
2. Click **Break Chain (Demo)**. One stored receipt is silently edited.
3. Click **Verify Chain** again. The chain turns red ❌ exactly at the edited receipt.
4. `npm run litti -- verify` says `❌ Chain broken at receipt #N`.

**Point:** the decision log is tamper-evident. Edit one byte of history and Litti tells you.

---

## Talking points

- **Proof of review, not proof of a click.** Other approval tools record that someone pressed a button. Litti records that they understood what they approved.
- **Server-measured review time.** The page carries a signed "opened at" stamp, so editing the timer in devtools does nothing.
- **Diff-bound tokens.** The approval is an HMAC token tied to the SHA-256 of the exact diff. Change one byte after approval and `/api/tokens/verify` says `Diff changed since approval — token is dead`. Tokens are single-use.
- **No code leaves the machine.** Quizzes are deterministic; no LLM in the trust path.
- **Production-ready:** signed per-reviewer links or SSO-header identity, a signed deploy webhook for CI/CD, Slack/Discord notifications, Docker image, config validation, health check, automated tests.
