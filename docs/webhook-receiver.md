# Receiving approved actions in your pipeline

Set `LITTI_DEPLOY_WEBHOOK` and Litti POSTs every approved action to it:

```http
POST /your/deploy/hook
content-type: application/json
x-litti-signature: sha256=<hex HMAC-SHA256 of the raw body>
x-litti-action-id: <action id>

{ "event": "action.approved", "action": { …ActionCard, including diff… }, "token": { …ApprovalToken… } }
```

The HMAC key is `LITTI_WEBHOOK_SECRET` (or `SECRET_KEY` if unset). Return any 2xx to accept.
A non-2xx response or a timeout releases the token so an operator can retry.

## Minimal receiver (Node.js)

```js
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.LITTI_WEBHOOK_SECRET;

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const expected = Buffer.from('sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex'));
    const given = Buffer.from(String(req.headers['x-litti-signature'] ?? ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401).end('bad signature');
      return;
    }
    const { action, token } = JSON.parse(raw);

    // Optional belt-and-braces: ask Litti whether this exact diff is still approved.
    const check = await fetch(`${process.env.LITTI_URL}/api/tokens/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-litti-key': process.env.LITTI_API_KEY },
      body: JSON.stringify({ token, diff: action.diff }),
    }).then((r) => r.json());
    if (!check.valid) {
      res.writeHead(409).end(check.reason);
      return;
    }

    // ✅ Deploy exactly action.diff here (apply patch, run migration, trigger CI job...).
    res.writeHead(200).end('ok');
  });
}).listen(8080);
```

## Verifying before you ship (no webhook)

If your agent or pipeline deploys by itself, fetch the token and verify it against the diff you
are about to apply:

```bash
TOKEN=$(curl -s -H "x-litti-key: $LITTI_API_KEY" "$LITTI_URL/api/actions/$ID" | jq .token)
curl -s -X POST "$LITTI_URL/api/tokens/verify" \
  -H "content-type: application/json" -H "x-litti-key: $LITTI_API_KEY" \
  -d "{\"token\": $TOKEN, \"diff\": $(jq -Rs . < change.diff)}"
# → { "valid": true, "reason": "Valid" }   or   { "valid": false, "reason": "Diff changed since approval — token is dead" }
```
