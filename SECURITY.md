# Security Policy

Litti is a security control, so bypasses are the bugs we care about most.

## Reporting a vulnerability

**Do not open a public issue.** Report privately via
[GitHub Security Advisories](https://github.com/Abhishek764/litti/security/advisories/new).

Please include the steps to reproduce, the affected file(s), and the impact (e.g. "deploy runs without a valid token").
We aim to acknowledge within 72 hours.

## In scope

- A risky agent command that runs without a review (classifier misses, hook bypasses)
- Shipping without a valid token, or with a token for a different diff
- Forging or replaying approval tokens
- Approving as someone else, approving your own request, or counting twice
- Passing the comprehension/timing/scroll checks without the server noticing
- Editing receipts without `litti verify` detecting it

## Threat model

Litti's default setup protects against **careless or over-eager agents**: an agent that runs `git push` or `rm -rf` without asking, retries with a different spelling, or edits a config file to switch the gate off. Every such bypass that takes a simple file write or API call is in scope.

| Attack | Defense |
|---|---|
| Agent runs a risky command | Hooks for Claude Code (Bash and PowerShell), Codex and OpenCode deny it and return a review link. The classifier tokenises the command line, so chains, quotes, `sh -c`, `sudo`, `npx` and git global options are seen through |
| Hook can't run or Litti is down | Fails closed: the hook entry ends in `\|\| exit 2` / `onFailure: "block"`, and an unreachable server means deny |
| Agent edits the project's `.env` to turn the gate off | The hook and the installed server never read the project's `.env` |
| Agent labels a write as "read" to get Tier 0 | The tier comes from the diff and paths. Tier 0 can neither open the gate nor ship |
| Agent changes the code after approval | Approval bound to the diff's SHA-256; a push review also binds the outgoing commit SHAs |
| Oversized or unreadable change hides what ships | Denied, never reviewed as "command only" |
| Replaying an old approval | Tokens are single use (`/api/tokens/consume`) |
| Agent mints itself a review link | Review links always need `LITTI_ADMIN_KEY`; the hook denies `litti review`, `/review-link` and commands that read the admin key or `~/.litti/config.env` |
| Requester approving their own action / one person counted twice | Requester excluded; reviewers deduplicated on a normalised id (case, spaces, zero-width characters and Cyrillic/Greek look-alikes folded) |
| An agent naming itself after a reviewer | With `LITTI_API_KEYS` the key's label is the requester, not free text |
| Faking review time | The server measures time from a signed page-open stamp; each stamp is single use and bound to the reviewer |
| Guessing the check | Answer checked server-side; a wrong answer is a rubber-stamp: blocked, announced, reviews reset, next tier +1 |
| DNS rebinding against a local Litti | On 127.0.0.1 only loopback Host headers are served |
| Litti exposed on the network by mistake | A non-loopback `HOST` refuses to start without an agent key |
| Editing the decision log | Hash-chained receipts; any edit breaks verification |
| Leaking data through logs or health checks | Logs never contain client IPs, the machine name or query strings; `/healthz` returns only `{ok: true}` |

## Known limitations

- **An agent running as your OS user can read Litti's files.** On a solo laptop the agent and Litti share a user, so a determined agent could read `~/.litti/config.env` (the secret and admin keys) through a non-shell tool, or the SQLite file. The hook blocks the obvious shell routes; it is not a sandbox. A strict mode that asks for a passkey / Windows Hello on Tier 2+ approvals is planned. Until then, for agents you don't trust, run Litti on a separate server where the agent can't read its files.
- **Only shell commands are gated.** File edits through the agent's own edit tools are reviewed when they are committed or pushed, not when they're written.
- **Codex needs a one-time trust step.** Codex runs project hooks only after you trust them with `/hooks`, and again after upgrading Litti. Until then Codex isn't gated.
- **OpenCode 2 is not supported yet.** The plugin targets OpenCode 1.x; an OpenCode 2 plugin is planned.
- **Commands are classified by rules.** The classifier covers common git, package, deploy, infrastructure, migration and delete commands, but a custom script with an unusual name gets through unless you add it to `LITTI_GATE_PATTERNS`. A git pre-push hook and a GitHub required check are planned as a second line.
- **Litti proves engagement, not correctness, and not personhood.** It shows a reviewer spent time, scrolled and understood the change. It can't tell a person from an agent driving their logged-in browser, and it doesn't prove the change is right.
- **Receipts are hash-chained, not signed.** Someone with write access to the database could rewrite the whole chain consistently. Keep backups out of reach.
- **Shared review links.** A personal link posted in a team channel works for whoever opens it first, within 30 minutes. Use `LITTI_IDENTITY_HEADER` behind your SSO proxy for strict identity.

## Deployment checklist

- `SECRET_KEY`: 32+ random characters, never committed. Litti refuses weak keys.
- Give agents an agent key only (`LITTI_API_KEY`, or one labelled key each in `LITTI_API_KEYS`). Keep `LITTI_ADMIN_KEY` with the people who assign reviewers.
- `PUBLIC_URL`: required in team mode; serve it over **https** (review links carry signed tickets; pages send `Referrer-Policy: no-referrer`).
- `LITTI_ALLOW_SELF_ASSERTED`: leave **unset** outside the demo.
- Identity: put Litti behind your SSO proxy and set `LITTI_IDENTITY_HEADER`. Make sure only the proxy can reach the port (`docker-compose.yml` publishes it on 127.0.0.1 only).
- `LITTI_WEBHOOK_SECRET`: set a separate key for your deploy webhook, verify `x-litti-signature`, and call `/api/tokens/consume` before shipping.
- Back up the `/data` volume (receipt chain and deploy records).
- The "Break chain" demo endpoint only exists in demo mode.
