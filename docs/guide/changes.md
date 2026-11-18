# Lesson 3: talk it through in Changes

The **Changes** view shows what your agent has changed in the working tree, live, and lets you discuss it line by line before anything is committed.

## 1. Point Litti at your project

Changes reads a git repository. By default that's the folder Litti runs in. To watch another project, set it in Litti's `.env` and restart:

```bash
LITTI_REPO_PATH=/home/you/code/my-app
```

## 2. Open Changes

Go to `http://127.0.0.1:3847/changes`. You'll see:

- **Left:** every changed file, with `A` added, `M` modified, `D` deleted, and line counts.
- **Right:** the diff of each file. It refreshes every few seconds while the agent works.

## 3. Comment on a line

Hover a line and click **+**. Write a question or an instruction:

> Why multiply by 100 here? Callers already pass cents.

Use **💬 File note** for a comment about the whole file.

## 4. The agent answers

Your agent reads open notes and answers them from the command line:

```bash
npm run litti -- notes
```

```
💬 note_3f9a1c · src/pay.ts:2 · open
   > return amount * 100;
   🧑 reviewer: Why multiply by 100 here? Callers already pass cents.
```

```bash
npm run litti -- reply note_3f9a1c "Good catch, reverted to return amount."
npm run litti -- resolve note_3f9a1c
```

The reply appears in the thread on the page. A new reply from you reopens a resolved thread.

Tell the agent to check notes. The rules in [agent instructions](https://github.com/Abhishek764/litti/blob/main/docs/agent-instructions.md) include this.

## 5. Send it for review

When you're happy, click **Request review**. The agent can also run `npm run litti -- submit "what this does"`. The whole working-tree diff becomes a Litti review, with a tier, a comprehension check and a receipt. If any notes are still open, the review says so.

## Who can do what

| | Locally (no `LITTI_API_KEY`) | In production |
|---|---|---|
| See Changes, comment, resolve | Anyone on your machine | People signed in through your SSO proxy |
| Reply as the agent | The `litti` CLI | Requests with the `x-litti-key` header |

## Next

[Lesson 4](connect-team): tell your team when something needs review.
