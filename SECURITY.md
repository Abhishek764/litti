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

## Deployment notes

- Set a long random `SECRET_KEY` in `.env`. Never commit it.
- The demo's "Break Chain" endpoint is only enabled by `npm run demo`; do not enable it in production.
- Run the approval server behind authentication (SSO/reverse proxy) — the approver name field is not an identity check on its own.
