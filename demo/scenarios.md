# Litti — demo scenarios (about 4 minutes)

**Setup:** Switch Console running, a chat app (Discord or Slack) connected to a room, and
`litti` added to that room. Then:

```bash
npm run demo
```

The terminal shows three proposed actions. Their approval cards appear **in the Switch room**,
and the review page and dashboard open in your browser.

> No Switch? `npm run demo:offline` runs the same flow, printing room messages in the terminal.

---

## Scenario 0: An agent asks permission in the room (30s)

In the room, paste what a coding agent would send:

````
@litti propose
```json
{"action":"migrate","description":"Drop the legacy_tokens table","diff":"+DROP TABLE legacy_tokens;","touchedPaths":["migrations/009_drop_legacy.sql"],"reversible":false}
```
````

Litti answers in the room: **🔴 Tier 3 · 3 reviewers**, with the reasons (destructive, irreversible)
and a review link. Then try `@litti approve`. Litti refuses, because approval never happens in chat.

**Point:** the agent can't act on its own say-so, and nobody can approve with a chat reply.

---

## Scenario 1: Happy path (Tier 1 CSS fix, 30s)

1. In the room: `@litti review <css-fix id>` returns **your** signed review link (or open the link from the terminal).
2. Read the 8-line diff. Quiz: "What does `border-radius` change to?" The answer is `8px`.
3. Tick **I have reviewed this change**, wait past 10s (the server times you), then **Countersign**.
4. The room shows `✅ Deploy executed — reviewed by you · attention 9x/100 · receipt chained.`

**Point:** one human, real comprehension, a clean approval, announced in the room.

---

## Scenario 2: Rubber-stamp caught (Tier 2 migration, 90s)

1. Open the **migration** link and type `sam` as the name (demo mode). Click a wrong answer and Countersign within 3 seconds.
2. Blocked. The room gets
   `⚠️ @sam Comprehension quiz failed. Blocked. All reviews reset, and the next action's tier is bumped +1.`
3. Now do it properly as `priya`: read it, answer `users`, wait 30s, Countersign. The room shows `✍️ priya countersigned (1/2)`.
4. Then as `sam` again, properly. The room shows `✅ Deploy executed`, reviewed by priya and sam.
5. Try countersigning as `priya` twice: `already countersigned`. Two different people are required.
6. In the room: `@litti stats` shows sam's low attention score and 1 rubber-stamp.

**Point:** fast clicks don't count, one person can't count twice, and the team sees all of it in chat.

---

## Scenario 3: Tamper detected (30s)

1. On the dashboard, click **Verify Chain**. Every link animates to ✅.
2. Click **Break Chain (Demo)**. One stored receipt is silently edited.
3. Click **Verify Chain** again. The chain turns red ❌ exactly at the edited receipt.
4. In the room, `@litti verify` says `❌ Chain broken at receipt #N`.

**Point:** the decision log is tamper-evident. Edit one byte of history and Litti tells the room.

---

## Talking points

- **Switch is the workflow.** Requests, review links, progress, warnings and results all live in the room where the team already talks.
- **Server-measured review time.** The page carries a signed "opened at" stamp, so editing the timer in devtools does nothing.
- **Diff-bound tokens.** The approval is an HMAC token tied to the SHA-256 of the exact diff. Change one byte after approval and `/api/tokens/verify` says `Diff changed since approval — token is dead`. Tokens are single-use.
- **Production-ready:** signed per-user review links or SSO-header identity, a signed deploy webhook for CI/CD, Docker image, config validation, health check, 27 automated checks.
