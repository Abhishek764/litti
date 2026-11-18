# Lesson 1: your first review

In this lesson you review three changes the way your team will: one easy, one risky, one dangerous. It takes five minutes and needs nothing but the demo.

## 1. Start the demo

```bash
litti demo
```

Your browser opens the first review page and the dashboard. Go to the **review inbox** at `http://127.0.0.1:3847/`. It lists three actions waiting for review, each with a coloured tier:

| Tier | Meaning | Reviewers needed |
|---|---|---|
| 0 | Read-only, runs automatically | 0 |
| 1 | Normal change | 1 |
| 2 | Risky: critical path, big diff, or can't be undone | 2 |
| 3 | Destructive: drops data, deletes files, force-pushes | 3 |

## 2. Review the easy one

Open the **CSS fix** (Tier 1).

1. **Read the diff.** Long diffs have to be scrolled to the end before you can approve.
2. **Answer the check.** It's built from the diff. You might get a multiple-choice question, be asked to click a line, or type a value. Each review picks a different kind.
3. **Type your name** (the demo accepts typed names; a real setup uses your login).
4. Tick **I have reviewed this change** and click **Countersign**.

Litti waits until at least 10 seconds have passed since you opened the page. That's on purpose.

When it passes, Litti signs a token bound to this exact diff, "deploys" it (the demo writes a file to `deployments/`), and adds a receipt.

## 3. Review the risky one

Open the **migration** (Tier 2). It needs **two different people**. Countersign once as `ana`, then open it again and countersign as `ben`. The same name twice doesn't count, and neither does the agent that asked.

## 4. Try to rubber-stamp the dangerous one

Open the **destructive cleanup** (Tier 3). This time, pick a wrong answer on purpose and submit.

Litti blocks it, announces "rubber-stamp blocked", resets every review on that action, and makes the **next** action one tier stricter. Approving fast and wrong is exactly what Litti is built to catch.

## 5. Check the evidence

Open the **Dashboard** from the top menu. You'll see each reviewer's attention score and every receipt. In another terminal:

```bash
litti verify
```

`✅ Receipt chain intact` means nobody has edited the history. On the dashboard, **Break chain** (demo only) edits one receipt; run `verify` again and it points at the broken link.

## What you learned

- Risky actions wait for reviewers; how many depends on the tier.
- Reviewers prove they read the change; the check changes every time.
- Fast, wrong approvals are blocked and penalised.
- Every decision is recorded in a chain you can verify.

## Next

[Lesson 2](connect-agent): make your real coding agent ask before it does anything risky.
