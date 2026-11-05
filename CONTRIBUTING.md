# Contributing to Litti

Thanks for helping make the Approve button mean something.

## Setup

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm test          # typecheck + end-to-end smoke test
npm run demo      # full standalone demo in your browser
```

Requires Node.js 20+.

## Project layout

| Path | What lives there |
|------|------------------|
| `src/rules/` | Deterministic risk tiering and rubber-stamp detection |
| `src/agents/` | Builder (proposes ActionCards) and gatekeeper (tiers + quiz) |
| `src/approval/` | Fastify server, approval page HTML, signed tokens |
| `src/chain/` | SQLite storage, hash-chained receipts, chain verification |
| `src/deploy/` | Token-gated executor |
| `public/` | Dashboard (plain HTML/CSS/JS) |
| `test/` | Smoke tests |

## Ground rules

- **No frontend frameworks.** Pages are plain HTML + inline CSS/JS. Keeps the audit surface tiny.
- **No LLM calls in the trust path.** Tiering and quizzes are deterministic so they can be reviewed and reproduced.
- **Ask before adding a dependency.** Open an issue first; every dependency is attack surface for a security tool.
- **Never weaken a gate silently.** Changes to tiering, token validation, rubber-stamp rules or chain hashing need a test and an explanation in the PR.

## Good first contributions

- New quiz templates in `src/agents/gatekeeper.ts` (e.g. Terraform, Kubernetes manifests, package.json bumps)
- New tiering rules for your stack in `src/rules/tiering.ts`
- Real chat integrations behind the `SwitchClient` interface (Slack, Discord, GitHub PR comments)
- Accessibility improvements on the approval page and dashboard

## Pull requests

1. Fork and branch from `main`.
2. Keep PRs focused — one change per PR.
3. Run `npm test` before pushing; CI runs the same.
4. Fill in the PR template.

By contributing you agree your work is licensed under the MIT License and you follow our [Code of Conduct](CODE_OF_CONDUCT.md).
