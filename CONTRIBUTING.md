# Contributing to Litti

Thanks for helping make the Approve button mean something.

## Setup

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm test          # typecheck + every test suite (what CI runs)
npm run demo      # the demo in your browser, from source
npm run build     # compile to dist/ (what npm publishes)
```

Requires Node.js 22+ (CI runs 22, 24 and 26 on Windows, macOS and Linux). Nothing else: everything runs on your machine.

## Project layout

| Path | What lives there |
|------|------------------|
| `src/main.ts`, `src/cli.ts`, `src/help.ts` | The `litti` command: start, demo, install and the client commands |
| `src/index.ts`, `src/demo.ts`, `src/home.ts`, `src/config.ts` | Server and demo entry points, `~/.litti` settings, startup checks |
| `src/rules/` | Deterministic risk tiering and rubber-stamp detection |
| `src/agents/` | Action cards (`builder.ts`), quiz templates (`gatekeeper.ts`) and the six comprehension check kinds (`challenges.ts`) |
| `src/approval/` | Fastify server, review page, inbox, signed tokens, reviewer identity |
| `src/integrations/` | Agent hooks: command classifier (`classify.ts`), gate, hook entry point, `litti install` |
| `src/changes/` | Changes view: live git diff and line notes |
| `src/notify/` | Terminal, webhook, Slack, Discord and Jira notifiers |
| `src/connect/` | Integrations page and Connect buttons; encrypted connection store |
| `src/broker/` | Litti Connect, the optional stateless OAuth helper service |
| `src/chain/` | SQLite storage, hash-chained receipts, chain verification |
| `src/deploy/` | Executor: hands approved actions to your deploy webhook |
| `src/docs/` | Renders `docs/guide/*.md` at `/docs` |
| `public/` | Dashboard and static assets (plain HTML/CSS/JS) |
| `docs/guide/` | User docs (also served in the app and on the website) |
| `test/` | One file per area; `npm test` runs them all |

## Ground rules

- **No frontend frameworks.** Pages are plain HTML + inline CSS/JS. Keeps the audit surface tiny.
- **No LLM calls in the trust path.** Tiering and checks are deterministic so they can be reviewed and reproduced.
- **Ask before adding a dependency.** Open an issue first; every dependency is attack surface for a security tool.
- **Never weaken a gate silently.** Changes to tiering, the classifier, token validation, rubber-stamp rules or chain hashing need a test and an explanation in the PR.
- **No real IPs or personal paths.** Use 127.0.0.1 or the documentation ranges (192.0.2.x, 198.51.100.x, 203.0.113.x) and placeholders like `C:\Users\<you>`. `test/privacy.ts` checks every tracked file.

## Good first contributions

- New comprehension check kinds or better questions in `src/agents/challenges.ts` (quiz templates live in `src/agents/gatekeeper.ts`), e.g. for Terraform, Kubernetes manifests or package.json bumps
- Commands the gate should catch, in `src/integrations/classify.ts` (add a row to the table test in `test/hooks.ts`)
- Tiering rules for your stack in `src/rules/tiering.ts`
- New notifiers in `src/notify/` (Microsoft Teams, email)
- Deploy webhook receivers for popular CI systems (GitHub Actions, GitLab CI, Argo CD)
- Accessibility improvements on the review page and dashboard

## Pull requests

1. Fork and branch from `main`.
2. Keep PRs focused: one change per PR.
3. Run `npm test` before pushing; CI runs the same on three operating systems.
4. Fill in the PR template.

By contributing you agree your work is licensed under the MIT License and you follow our [Code of Conduct](CODE_OF_CONDUCT.md).
