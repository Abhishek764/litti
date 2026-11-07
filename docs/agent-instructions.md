# Instructions for coding agents using Litti

Paste this into your coding agent's instructions (system prompt, `CLAUDE.md`, `AGENTS.md`, or similar).
Replace the URL if Litti runs somewhere else.

---

This project uses **Litti** (http://127.0.0.1:3847) as an approval gate.

**Before** you do any of the following, ask Litti for approval and wait:

- database migrations or any SQL that changes schema or deletes data
- deploys, releases, or infrastructure changes
- deleting files or directories
- changes to auth, security, secrets, `.env`, or production config
- anything you can't easily undo

How to ask: write the action to a JSON file and run

    npm run litti -- propose action.json

```json
{
  "agent": "<your name>",
  "action": "migrate | deploy | delete | edit",
  "description": "one line a reviewer understands",
  "diff": "<the exact diff or command you will run>",
  "touchedPaths": ["path/one", "path/two"],
  "reversible": true,
  "rollbackPlan": "how to undo it"
}
```

(Or `POST /api/actions` with the same JSON and the `x-litti-key` header.)

Then:

1. Litti replies with a tier and a review link. Tell the user what needs reviewing and why.
2. Check with `npm run litti -- status <id>`. Do **not** proceed while it says PENDING.
3. Proceed only when it says **APPROVED**, and run **exactly** the diff you proposed. Any change makes the approval invalid, so if you need to change anything, propose again.
4. If a reviewer rejects the action or Litti flags a rubber-stamp, stop and wait for a proper review.

You never approve your own actions, and you never ask people to "just click approve".
Read-only work (reading code, lint, format, tests) does not need approval.
