# Litti — Demo Scenarios

Start with `npm run demo`. It opens the first approval page and the dashboard.
Three pending actions are created (Tier 1, Tier 2, Tier 3).

---

## Scenario 1 — Happy path (Tier 1 CSS fix)

1. Open the **css-fix** approval link (Tier 1 · LOW).
2. The diff is short. Read it.
3. Quiz: "What function/symbol is being modified?" — pick the value pulled from the diff.
4. Tick **I have reviewed this change**.
5. Wait past the 10s minimum, then **Countersign**.
6. Result: `✅ Deploy executed`. A `deployed-*.txt` file is written.
7. Refresh the dashboard — a green, high-attention receipt appears. Chain grows by one.

**Point:** one human, real comprehension, clean approval.

---

## Scenario 2 — Rubber-stamp caught (Tier 2 migration)

1. Open the **migration** approval link (Tier 2 · HIGH), e.g. as `Sam`:
   `/approve/<id>?approver=Sam`
2. As Sam, try to approve instantly — pick a wrong quiz answer or submit in under 10s.
3. Result: `⚠️ Rubber-stamp blocked`. A **rubber-stamped** receipt is logged,
   a warning is posted to the Switch room, and the **next** action's tier is bumped +1.
4. Now approve properly as `Priya` and `Sam` (Tier 2 needs 2 approvers):
   read the diff, answer "Which table is being modified?" = `users`, dwell > 30s, Countersign.
5. When the 2nd approver passes, the token is issued, the diff hash is validated,
   and the deploy runs.

**Point:** fast clicks don't count. Two independent humans, both comprehending.

---

## Scenario 3 — Tamper detected

1. After at least one approved receipt exists, go to the dashboard.
2. Click **Verify Chain** → every link animates to ✅, "Chain intact".
3. Click **Break Chain (Demo)** → one receipt's hash is corrupted.
4. Click **Verify Chain** again → links tick ✅ until the broken one flashes red ❌,
   "Chain broken". Verification stops exactly where tampering occurred.

**Point:** the receipt log is tamper-evident. Change one byte, the chain tells on you.

---

## Token-binding proof (optional talking point)

The deploy only runs with a signed token whose `diffHash` equals the SHA-256 of the
*current* diff. If the builder agent changes a single byte after approval, the token
is dead and the executor refuses: `🔒 Deploy blocked — Diff changed since approval`.
Tokens are also single-use — a replayed token is rejected.
