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

Requires Node.js 20.10+. For the full flow, install [Switch Console](https://docs.switchagents.ai/switch-rooms/getting-started); `npm run demo:offline` works without it.

## Project layout

| Path | What lives there |
|------|------------------|
| `src/rules/` | Deterministic risk tiering and rubber-stamp detection |
| `src/agents/` | Builder (proposes ActionCards) and gatekeeper (tiers + quiz) |
| `src/approval/` | Fastify server, review page HTML, signed tokens, reviewer identity |
| `src/switch/` | Switch agent client (register, post, listen) and `@litti` chat commands |
| `src/chain/` | SQLite storage, hash-chained receipts, chain verification |
| `src/deploy/` | Token-gated executor |
| `public/` | Dashboard (plain HTML/CSS/JS) |
| `test/` | Core flow, production hardening, and Switch client (mock bridge) tests |

## Ground rules

- **No frontend frameworks.** Pages are plain HTML + inline CSS/JS. Keeps the audit surface tiny.
- **No LLM calls in the trust path.** Tiering and quizzes are deterministic so they can be reviewed and reproduced.
- **Ask before adding a dependency.** Open an issue first; every dependency is attack surface for a security tool.
- **Never weaken a gate silently.** Changes to tiering, token validation, rubber-stamp rules or chain hashing need a test and an explanation in the PR.

## Good first contributions

- New quiz templates in `src/agents/gatekeeper.ts` (e.g. Terraform, Kubernetes manifests, package.json bumps)
- New tiering rules for your stack in `src/rules/tiering.ts`
- More `@litti` room commands in `src/switch/commands.ts` (e.g. `reject`, `explain`)
- Deploy webhook receivers for popular CI systems (GitHub Actions, GitLab CI, Argo CD)
- Accessibility improvements on the approval page and dashboard

## Pull requests

1. Fork and branch from `main`.
2. Keep PRs focused — one change per PR.
3. Run `npm test` before pushing; CI runs the same.
4. Fill in the PR template.

By contributing you agree your work is licensed under the MIT License and you follow our [Code of Conduct](CODE_OF_CONDUCT.md).
