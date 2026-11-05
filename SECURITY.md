# Security Policy

Litti is a security control, so bypasses are the bugs we care about most.

## Reporting a vulnerability

**Do not open a public issue.** Report privately via
[GitHub Security Advisories](https://github.com/Abhishek764/litti/security/advisories/new).

Please include the steps to reproduce, the affected file(s), and the impact (e.g. "deploy runs without a valid token").
We aim to acknowledge within 72 hours.

## In scope

- Running a deploy without a valid token, or with a token for a different diff
- Forging or replaying approval tokens
- Passing the quiz/timing/scroll gates without the server noticing
- Editing receipts without `Verify Chain` detecting it

## Threat model (what Litti defends against)

| Attack | Defense |
|---|---|
| Agent acts without approval | Executor requires a valid, unused, HMAC-signed token |
| Agent changes the diff after approval | Token bound to the diff's SHA-256; `/api/tokens/verify` fails on any byte change |
| Replaying an old approval | Tokens are single-use (stored as consumed in SQLite) |
| Approving under someone else's name | SSO header (`LITTI_IDENTITY_HEADER`) or signed per-action, per-user review links (30 min expiry) |
| Requester approving their own action / one person counted twice | Requester excluded; reviewers deduplicated |
| Faking review time in devtools | Server measures time from a signed page-open stamp; client time can only lower it |
| Guessing the quiz | Answer checked server-side; a wrong answer is a rubber-stamp: blocked, announced, reviews reset, next tier +1 |
| Editing the decision log | Hash-chained receipts; any edit breaks verification |

**Known limits.** A review link posted in a shared room can be used by anyone who opens it before
it expires, so use `LITTI_IDENTITY_HEADER` behind your SSO proxy for strict identity. Litti
proves a reviewer *engaged* with a diff (time, scroll, comprehension). It does not prove the
change is correct.

## Deployment checklist

- `SECRET_KEY`: 32+ random characters, never committed. `npm start` refuses weak keys.
- `LITTI_API_KEY`: set it, so only your agents and pipelines can call the HTTP API.
- `LITTI_ALLOW_SELF_ASSERTED`: leave **unset** in production (typed names are demo-only).
- Identity: put Litti behind your SSO proxy and set `LITTI_IDENTITY_HEADER`. Make sure only the proxy can reach the port.
- Serve `PUBLIC_URL` over **https** (review links carry signed tickets; pages send `Referrer-Policy: no-referrer`).
- `LITTI_WEBHOOK_SECRET`: set a separate key for your deploy webhook and verify `x-litti-signature`.
- Back up the `/data` volume (receipt chain + Switch agent credentials in `litti-switch.json`).
- The "Break Chain" endpoint only works under `npm run demo`; production never enables it.
