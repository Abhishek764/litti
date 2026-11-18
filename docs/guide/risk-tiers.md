# Risk tiers

Every action gets a tier from 0 to 3. The tier decides how many **different** people must review it and how long they must spend at minimum.

| Tier | Reviewers | Minimum time | Typical cause |
|---|---|---|---|
| 0 | none (auto-approved) | — | `read`, `lint`, `format` or `test` that touches nothing risky |
| 1 | 1 | 10 s | Any write |
| 2 | 2 | 30 s | Critical path, diff over 200 lines, or a Tier 1 action that can't be undone |
| 3 | 3 | 30 s | Destructive content, a `delete` action, or a Tier 2 action that can't be undone |

## How the tier is computed

The rules run in this order, and a later rule can only raise the tier:

1. **Read-only?** Actions declared as `read`, `lint`, `format` or `test` are Tier 0, unless they touch a critical path or contain destructive content.
2. **Any write** starts at Tier 1.
3. **Critical paths** raise it to 2: a touched path containing `migration`, `auth`, `security`, `prod`, `.env`, `secret`, `password` or `credential`.
4. **Large diffs** (over 200 lines) raise it to 2.
5. **Destructive content** sets Tier 3: `DROP`, `TRUNCATE`, `DELETE FROM`, `rm -rf`, `rmdir`, `push --force`, `chmod -R 777`, or the action `delete`.
6. **Irreversible** (`reversible: false`) adds one, up to 3.
7. **Rubber-stamp penalty:** if the previous review was blocked as a rubber-stamp, the next action gets +1.

The review page lists the reasons, so reviewers see *why* something is Tier 3.

## Separation of duties

- The agent (or person) that asked can't approve its own action.
- The same reviewer can't count twice, however they spell their name.

## Changing the rules

Edit `src/rules/tiering.ts` to add your own critical paths, such as `billing/` or `infra/`. Agent hooks have their own list of risky commands; add more with `LITTI_GATE_PATTERNS` (see [Lesson 2](connect-agent)).
