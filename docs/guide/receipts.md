# Tokens and receipts

Two things make a Litti approval worth more than a click: a **token** that only works for the exact change that was reviewed, and a **receipt chain** that shows if anyone rewrote history.

## Approval tokens

When the last required reviewer passes, Litti issues a token:

```json
{
  "v": 2,
  "tokenId": "…",
  "actionId": "…",
  "diffHash": "sha256 of the exact diff",
  "approvers": ["ana", "ben"],
  "quizResults": [{ "approver": "ana", "correct": true, "timeMs": 41000 }],
  "issuedAt": "2026-11-18T10:00:00.000Z",
  "signature": "HMAC-SHA256(\"v2|tokenId|actionId|diffHash|issuedAt|sorted approvers\")"
}
```

- **Bound to the diff.** The diff's SHA-256 is recomputed before shipping. If one byte changed, the token is refused.
- **Bound to the action and time.** The signature covers `actionId` and `issuedAt`, so a token can't be moved to another action or re-dated.
- **Single use.** Shipping uses the token up. Replaying it fails.
- **Tier 0 never ships.** Tier 0 actions are logged, not approved by a person, so their tokens are refused for shipping.

### Before you ship

Your pipeline calls `consume` with the token and the diff it is about to ship:

```bash
curl -X POST http://127.0.0.1:3847/api/tokens/consume \
  -H 'content-type: application/json' -H "x-litti-key: $LITTI_API_KEY" \
  -d '{"token": {…}, "diff": "…the diff you are about to ship…"}'
```

`200 {"valid": true}` means ship now. `409 {"valid": false, "reason": …}` means don't: the diff isn't the approved one, the action isn't approved, or the token was already used. `POST /api/tokens/verify` runs the same check without using the token up.

## Running approved actions

With `LITTI_DEPLOY_WEBHOOK` set, Litti POSTs `{event, action, token}` to your CI/CD with an `x-litti-signature` header (HMAC-SHA256 with `LITTI_WEBHOOK_SECRET`). Verify the signature, call `consume`, then deploy. Without a webhook, Litti writes a deploy record to `~/.litti/deployments/`.

If the webhook fails or times out, nothing shipped: the action becomes `deploy-failed`, a `deploy-failed` receipt is written, and an admin can retry with `POST /api/actions/:id/retry`. See [HTTP API](api).

## The receipt chain

Every decision (`approved`, `auto-approved`, `rubber-stamped`, `deploy-failed`) is appended as a receipt. Receipts written by Litti 0.4 and later use **format 2** (`"format": 2` on the receipt):

```
chainHash = SHA256("v2" ␟ id ␟ previousHash ␟ JSON(actionCard) ␟ outcome ␟ attentionScore
                   ␟ tier ␟ JSON(approvals) ␟ timestamp)
```

Older receipts (no `format` field) use format 1, which covers the first five fields only, and keep verifying as written:

```
chainHash = SHA256(id ␟ previousHash ␟ JSON(actionCard) ␟ outcome ␟ attentionScore)
```

`␟` is the unit-separator byte (`0x1F`), so no field boundary is ambiguous. The first receipt's `previousHash` is 64 zeros. Each receipt includes the hash of the one before it, so editing any receipt (including its tier, approvals or time) breaks every link after it.

### Check one receipt yourself

```js
import { createHash } from 'node:crypto';
const receipts = await (await fetch('http://127.0.0.1:3847/api/receipts')).json(); // newest first
for (const r of receipts.reverse()) {
  const v1 = [r.id, r.previousHash, JSON.stringify(r.actionCard), r.outcome, String(r.attentionScore)];
  const fields = r.format === 2 ? ['v2', ...v1, String(r.tier), JSON.stringify(r.approvals), r.timestamp] : v1;
  const ok = createHash('sha256').update(fields.join('\x1f')).digest('hex') === r.chainHash;
  console.log(ok ? '✅' : '❌', r.id);
}
```

(In team mode add the `x-litti-key` header.) Or check the whole chain, links included:

```bash
litti verify
```

```
✅ Receipt chain intact — 42 receipts, every hash link verified.
```

or, after tampering:

```
❌ Chain broken at receipt #17 (…). 26 receipt(s) from there on can't be trusted.
```

The dashboard has the same check, and `GET /api/chain/verify` returns it as JSON.

Receipts are hash-chained, not signed: someone who can write to the database file could rewrite the whole chain consistently. Keep backups somewhere they can't reach.
