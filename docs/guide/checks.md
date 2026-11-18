# Comprehension checks

Clicking a box proves nothing. Litti asks one question about the diff itself, and the **kind** of question changes from one review to the next, so nobody gets used to a pattern.

## The six kinds

| Kind | The reviewer… | Example |
|---|---|---|
| **Quiz** | picks the right fact from 4 options | "Which table does this migration alter?" |
| **Spot the line** | clicks the line in the diff that does the risky thing | "Click the line that permanently deletes data." |
| **Recall** | types the answer, with no options to guess from | "Type the name of the function this change modifies." |
| **Canary** | says whether a line really is in the change | Sometimes it is; sometimes one number or word was quietly changed |
| **Count** | types how many lines the change adds or removes | Only for small diffs |
| **Explain it** | writes one sentence in their own words, naming what changed | Saved in the receipt as the reviewer's note |

Questions come from the changed lines, never from unchanged context. Wrong options never appear in the diff, so there is exactly one right answer.

## How Litti picks

- A random pick weighted by kind. The quiz comes up about 30% of the time.
- **Never the same kind twice in a row.**
- **Tier 2 and 3 never use Canary or Count**, because those can be guessed (yes/no) or are tedious rather than informative.
- If a diff has nothing to ask about for a kind (for example no function to recall), that kind is skipped.

Limit the kinds with `LITTI_CHALLENGES`, for example `LITTI_CHALLENGES=quiz,spot-line,explain`. Your list wins over the tier rule.

## Fair to humans

- **Recall** ignores case and quotes, and forgives one typo on names of 6 or more characters.
- **Explain it** needs at least 6 words and one real name from the change (a table, function, file or setting). Copying the agent's own description doesn't count.

## Other things the review page checks

- **Time:** at least 10 s (Tier 1) or 30 s (Tier 2–3), measured on the server.
- **Scrolling:** diffs longer than 20 lines must be scrolled to the end.
- **The reviewed box** must be ticked.

## Attention score

Each review gets a score from 0 to 100, shown on the dashboard:

```
score = (answer correct ? 40 : 0)
      + (scrolled to the end ? 20 : 0)
      + min(40, time spent / expected time × 40)

expected time = max(10 s, diff lines × 0.5 s)
```

## Rubber-stamp detection

A review is blocked as a rubber-stamp when:

- the answer is wrong, or
- a diff over 50 lines was approved in under 10 seconds.

Then:

1. It is recorded in the receipt chain as `rubber-stamped`.
2. **Every** review on that action is reset; everyone reviews again.
3. The next action's tier goes up by one.
4. The team is told. People who rubber-stamp three times in a row are named.
