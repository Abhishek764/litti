# Changelog

All notable changes to Litti are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (before 1.0, a minor version can break things).

## [Unreleased]

## [0.4.0] - 2026-11-24

The first release published to npm, as **`litti-cli`** (npm keeps the bare name `litti` from
new packages because it is close to existing ones). Install with `npm install -g litti-cli`;
the command is still `litti`.

### Breaking
- **Node.js 22 or newer is required** (`engines.node >=22`). Node 20 is end-of-life. Prebuilt
  `better-sqlite3` binaries exist for Node 22, 24 and 26 on Windows, macOS and Linux (x64 and arm64).
- **`PUBLIC_URL` is required in team mode.** If `LITTI_API_KEY` is set without `PUBLIC_URL`,
  Litti refuses to start and says why.
- **Token format:** approval tokens now sign the action id and issue time. Tokens issued by
  older versions are refused; approve the action again.
- **Receipt hash format 2:** new receipts also hash the tier, the approvals and the timestamp.
  Existing receipts keep verifying with the old format.
- On loopback (the default), requests whose `Host` header isn't `localhost`, `127.0.0.1`,
  `[::1]` or `PUBLIC_URL`'s host get 403 (DNS-rebinding protection).

### Security
- The agent hook never reads the project's `.env`; it reads only `~/.litti/config.env` and the
  real environment, so a repository can't switch the gate off.
- The hook fails closed: if it can't start, crashes, times out (20 s deadline) or can't reach
  Litti, the command is denied (Claude Code `onFailure: "block"`, `|| exit 2`, exec form on
  Windows without Git Bash).
- Claude Code's PowerShell tool is gated too (matcher `Bash|PowerShell`); Codex matcher is `^Bash$`.
- An agent-declared Tier 0 action can't open the gate or ship: the gate only matches actions it
  created, and Tier 0 tokens can't be used to deploy (SEC-1).
- A failed deploy writes a `deploy-failed` receipt, isn't shippable and keeps the gate shut; an
  admin can retry it with `POST /api/actions/:id/retry` (SEC-10).
- Receipts, stats and chain verification need the API key or a signed-in reviewer; the tamper
  demo button exists only in demo mode.
- `@fastify/static` 10 (clears `npm audit`); unused `@fastify/formbody` removed.

### Added
- Public website: a landing page and the full docs, built as static files by
  `scripts/build-site.ts` (`npm run site`) and deployed to GitHub Pages.
- Release pipeline: tagged releases publish to npm with provenance (Trusted Publishing), attach
  the tarball, `SHA256SUMS` and a CycloneDX SBOM to the GitHub release, and push a multi-arch
  image to `ghcr.io/abhishek764/litti`.
- CI runs on Windows, macOS and Linux with Node 22, 24 and 26, including `npm audit`, `npm pack`
  and a smoke test that installs the tarball and starts it. Dependabot keeps dependencies and
  pinned actions current.
- `litti help`, `--help` and `-h` print help and exit without starting a server; `--port=N`.

### Changed
- New look across the app, docs and website: Albert Sans (bundled under the SIL OFL, so no
  third-party font requests), a `#121212` canvas, a lime accent, pill buttons and soft shadows,
  from one set of shared theme tokens. The docs keep a light theme on a cream background.
- Docker image pinned to a `node:26-slim` digest, with OCI labels. `docker compose` publishes
  the port on `127.0.0.1` only; put a reverse proxy in front and set `LITTI_API_KEY` and
  `PUBLIC_URL` to share it with a team.
- Render blueprint for Litti Connect no longer deploys on every push (`autoDeploy: false`).
- Gate messages tell you to run `litti` and say "Approved" for gate commands.
- `npm run build` cleans `dist/` first, so deleted sources never ship.

### Fixed
- The Explain check's word counter counts words while you type, before the box is ticked.
- Bad or unknown CLI flags print an error instead of starting a server.
- Starting the demo on a busy port prints a friendly message and keeps the running demo's data.

## [0.3.0]

First packaged version (`npm install -g litti`, `litti` command), not published to npm.
Comprehension checks, risk tiers, diff-bound tokens, hash-chained receipts, agent hooks for
Claude Code, Codex and OpenCode, the Changes view, Slack/Discord/Jira notifications and the
built-in docs site at `/docs`.

[Unreleased]: https://github.com/Abhishek764/litti/compare/v0.4.0...main
[0.4.0]: https://github.com/Abhishek764/litti/releases/tag/v0.4.0
[0.3.0]: https://github.com/Abhishek764/litti/commits/main
