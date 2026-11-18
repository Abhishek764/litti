# Tokens and receipts

Two things make a Litti approval worth more than a click: a **token** that only works for the exact change that was reviewed, and a **receipt chain** that shows if anyone rewrote history.

## Approval tokens

When the last required reviewer passes, Litti issues a token:

```json
{
  "tokenId": "…",
  "actionId": "…",
  "diffHash": "sha256 of the exact diff",
  "approvers": ["ana", "ben"],
  "quizResults": [{ "approver": "ana", "correct": true, "timeMs": 41000 }],
  "issuedAt": "2026-11-18T10:00:00.000Z",
  "signature": "HMAC-SHA256(tokenId | diffHash | approvers)"
}
```

- **Bound to the diff.** The executor recomputes the diff's hash. If one byte changed, the token is refused.
- **Single use.** The token is burned when it runs. Replaying it fails.
- **Checkable by your pipeline.** Before shipping, call:

```bash
curl -X POST http://127.0.0.1:3847/api/tokens/verify \
  -H 'content-type: application/json' -H 'x-litti-key: $LITTI_API_KEY' \
  -d '{"token": {…}, "diff": "…the diff you are about to ship…"}'
```

It returns `valid: false` if the diff isn't the one that was approved.

## Running approved actions

With `LITTI_DEPLOY_WEBHOOK` set, Litti POSTs `{event, action, token}` to your CI/CD with an `x-litti-signature` header (HMAC-SHA256 with `LITTI_WEBHOOK_SECRET`). Verify the signature, then deploy. Without a webhook, Litti writes a deploy record to `deployments/`.

## The receipt chain

Every decision (`approved`, `auto-approved`, `rubber-stamped`) is appended as a receipt:

```
chainHash = SHA256(id ␟ previousHash ␟ JSON(actionCard) ␟ outcome ␟ attentionScore)
```

`␟` is the unit-separator byte (`0x1F`), so no field boundary is ambiguous.

The first receipt's `previousHash` is 64 zeros. Each receipt includes the hash of the one before it, so editing any receipt breaks every link after it.

Check the whole chain:

```bash
npm run litti -- verify
```

```
✅ Receipt chain intact — 42 receipts, every hash link verified.
```

or, after tampering:

```
❌ Chain broken at receipt #17 (…). 26 receipt(s) from there on can't be trusted.
```

The dashboard has the same check, and `GET /api/chain/verify` returns it as JSON.
