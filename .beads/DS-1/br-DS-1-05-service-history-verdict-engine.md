# Bead br-DS-1-05: Build the price-history stats and buy/wait verdict engine

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.6 (history.js, lines 111-118), §5.2 (`history.test.js` line 166), §5.3 (forecast accuracy not covered, line 173), §5.4 (control 5, line 182). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-05
- **Priority**: P0 (critical — R10's verdict is the whole point of price history)
- **Status**: done
- **Original Estimate**: 2h
- **Dependencies**: br-DS-1-01
- **Blocks**: br-DS-1-06, br-DS-1-07
- **Commit**: `feat(DS-1): history stats and verdict engine (br-DS-1-05)`

## Description

Implement `scripts/history.js`: a **deterministic** script (the model extracts, this script judges — §10
Senior-engineer note) that turns per-candidate history input into stats plus a `buy_now` / `wait` /
`no_signal` verdict.

**Input** per candidate (§3.6 line 112): `{ current, lowest:{price,date}, highest:{price,date}, average,
points?:[{date,price}] }`. **Graceful skip (line 113).** One uniform rule for every invalid-input case —
omit `history` for that candidate, produce no output for it, do not throw. Three cases: no `history` key
at all (the lookup found nothing); a `history` object missing any of the four required summary fields
(`current`, `lowest`, `highest`, `average`); a `points` array exceeding 400 entries.

**Output (lines 114-117):**

- `vs_average` and `vs_lowest` percentages for the current price.
- `typical_low_window` (two states only): `confident` when `points` span ≥ 2 distinct calendar years
  **and** ≥ `MIN_POINTS` = 12 points total — the months holding the lowest decile of prices across all
  years; `low_confidence` otherwise (single calendar year, thin multi-year dataset, or summary-only) —
  the single `lowest.date` month.
- `next_dip_estimate`: the next occurrence of a typical-low month **and** the next overlapping sale
  window from `data/sale-calendar.json` (br-DS-1-04). Always paired with confidence
  `high | medium | low | none` — these are the only four values; add no more. Derivation (line 116):
  `high` = `confident` window + calendar overlap; `medium` = `confident` window no overlap, **or**
  thin multi-year (`≥ 2` years, `< MIN_POINTS` points) with overlap; `low` = thin multi-year with no
  overlap; `none` = single-year data or summary-only. Every `low_confidence` sub-case maps to exactly one
  of `none`/`low`/`medium`; none unclaimed, none double-mapped.
- `verdict` in this **fixed order** (line 117): **(1)** data-quality gate — contradictory history
  (`lowest.price > highest.price`, or current more than 20% below recorded `lowest.price`) ⇒
  `no_signal`, regardless of point count. **(2a)** price-proximity — current within 5% of the historical
  low (including current ≤ 20% below the low, a genuine new all-time low) ⇒ `buy_now`; needs only
  `lowest.price`, fires on summary-only input. **(2b)** firm no-dip-before-deadline — `next_dip_estimate`
  confidence is `low`/`medium`/`high` and the estimate places the dip **after** the deadline ⇒ `buy_now`;
  confidence `none` does **not** satisfy this sub-branch and falls through. **(3)** point-count gate —
  fewer than `MIN_POINTS` = 12 points ⇒ `no_signal` (blocks only the pattern branches, never (2a)).
  **(4)** pattern check — a recurring pattern in ≥ 2 years, a dip month within the deadline horizon, and
  current price more than 5% above the historical low ⇒ `wait`. **When no deadline is provided**, omit
  (4)'s `wait` and (2b)'s `buy_now`; (2a) is unaffected; fall back to `vs_average`/`vs_lowest` context
  only when neither (2a) nor a gate already produced an outcome.
- The report must say forecasts are estimates, not promises, and that "no reliable pattern" is a valid
  answer. History is supporting evidence and never overrides the quality floor (line 118).

**Constant ownership (plan ambiguity — resolve here).** `MIN_POINTS` = 12 is defined and exported by
`history.js`. §3.5 groups it "alongside" score.js's `PRIOR_MEAN`/`PRIOR_N`, but that is prose grouping,
not same-file ownership — score.js has no described logic that reads `MIN_POINTS`. If a test or doc wants
`score.js` to re-export `MIN_POINTS`, br-DS-1-06 should import it from here (one line), never redefine
it — redefining creates two sources of truth for one gate. Note whichever you do in Review Notes.

## Rationale

The confidence rule and the four-step verdict order were the most-revised part of the plan across 15
rounds (Change History v3-v7). They exist so thin data can never produce an overconfident "wait". A
wrong order here silently changes buy/wait advice, so it is pinned by fixtures, not observed behaviour.

## Outcome Definition

- `node --test test/history.test.js` exits 0.
- Negative control 5 (§5.4 line 182) runs once and is reverted: make `history.js` ignore `MIN_POINTS` ⇒
  the sparse-data test fails. Record the observed failing test name in Review Notes.
- Every fixture in the §5.2 `history.test.js` list below returns the stated verdict.

## Test Specifications

`test/history.test.js` (§5.2 line 166):
- recurring-December lows → typical-low window + next-dip estimate;
- summary-only input → `low_confidence`;
- < `MIN_POINTS` (12) points with current > 5% above low → `no_signal` (point-count gate blocks `wait`);
- 2-year dataset with only 4 points → `low_confidence` (not `confident`);
- current price at the low → `buy_now`;
- **summary-only, current at the recorded low → `buy_now`** (not `no_signal`; (2a) ignores the point gate);
- current 5% below recorded lowest → `buy_now`; current 25% below → `no_signal` (implausible);
- many points all in one calendar year → `low_confidence`;
- no deadline, current > 5% above low → (4)/(2b) omitted, (2a) unaffected (same input at the low still
  `buy_now`); verdict returns `vs_average`/`vs_lowest` context only when (2a) has not fired;
- contradictory data (`lowest.price > highest.price`) → `no_signal`;
- current 6% above low with recurring December pattern (≥ 12 points, ≥ 2 years) → `wait`; 4% above with
  the same pattern → `buy_now` (boundary);
- summary-only, > 5% above low, confidence `none`, deadline present → `no_signal` (not `buy_now`);
  single-year data with the same conditions → `none` → `no_signal` by the same path;
- **positive (2b):** confident window (≥ 2 years, ≥ 12 points), confidence `medium`, next dip **after**
  the deadline, current > 5% above low → `buy_now` via (2b);
- no `history` key → no output, no throw; `history` missing a required field → skip, no throw; `points`
  > 400 → omit `history`, no throw.
- **Manual / recorded**: the §5.4 control-5 mutation result (failing test name) → Review Notes.
- **Not covered** (state, do not fake): real-world forecast accuracy (§5.3 line 173) — the tests pin
  behaviour on synthetic series, not prediction quality.

## Files to Touch

- `scripts/history.js` (create — stats, `typical_low_window`, `next_dip_estimate`, `verdict`; exports
  `MIN_POINTS`)
- `test/history.test.js` (create)

## Review Notes

Implemented 2026-10-09.

**Outcome Definition verified.** `node --test test/history.test.js` exits 0 — 24 tests, 24 pass. Full
suite (`npm test`) is 46 pass / 0 fail. Every fixture in the §5.2 list returns its stated verdict.

**Negative control 5.** Mutation: `const MIN_POINTS = 12` → `const MIN_POINTS = 0` (the rule ignored).
Reverted afterwards; `cmp` confirms `scripts/history.js` is byte-identical to its pre-mutation state.
Five tests failed, not one:

- `the point-count gate blocks wait on sparse data` ← the "sparse-data test" §5.4 names
- `a 2-year dataset with only 4 points is low-confidence, not confident`
- `thin multi-year data is medium confidence when a sale window overlaps`
- `confidence none does not satisfy the no-dip branch`
- `every result carries the three verdicts enum, the caveat and both comparisons`

That breadth is expected, not a sign of over-coupling: `MIN_POINTS` feeds *both* the `confident`
window threshold and the point-count gate, so zeroing it logically flips the confidence tier of every
thin fixture as well as the gate.

**`MIN_POINTS` ownership — resolved as the bead directed.** Defined and exported by `history.js`.
**br-DS-1-06 must import it from here and must not redefine it** — two definitions would be two
sources of truth for one gate. §3.5's prose that lists `MIN_POINTS` "alongside" score.js's
`PRIOR_MEAN`/`PRIOR_N` is grouping by topic, not a statement of ownership, and should be read that way.

**Fourth invalid-input case, beyond the three §3.6 enumerates.** §3.6 names: no `history` key, a
missing required summary field, and `points` over 400. A `points` array containing a malformed entry
(non-numeric price, unparseable date, or a non-object) is a fourth. F14.3's rule — "one uniform outcome
for all `history`-input validation failures" — makes it omit as well, rather than silently dropping the
bad point and analysing the rest. Pinned by the `malformed points fail validation rather than being
silently dropped` test. Recorded because the plan's list of three is not exhaustive.

**Interface.**
- `analyze(historyValue, { deadline, today, saleCalendar })` → result object, or `null` when the input
  fails validation (`null` is the caller's "skip this candidate, do not throw" signal).
- `analyzeAll(candidates, opts)` → array aligned by index with `null` where skipped, so the skill
  (bead 07) can merge history results onto the raw candidate array without re-deriving indices.
- `loadSaleCalendar(file)` → `[]` when the file is missing or malformed. `data/sale-calendar.json` does
  not exist yet (br-DS-1-04 owns it); bead 07 wires the real path.
- `today` is injectable precisely so no test reads the clock; the real date is used only when the caller
  omits it. `deadline`/`today` accept `YYYYMMDD` or `YYYY-MM-DD` (the compact form §3.5 already
  accommodates). An **unparseable `deadline` is treated as absent** — it drops the deadline-dependent
  branches rather than throwing, so a bad value degrades the advice instead of blocking the report.
- Output shape (the plan names the fields but never pins the shape):
  `{ vs_average, vs_lowest, typical_low_window:{label,months}, next_dip_estimate:{month,year,confidence,sale_window,reason}, verdict, reason, caveat }`.
  `typical_low_window.months` is a list even in the `low_confidence` case (one element) so callers never
  branch on the shape. `verdict` is drawn from the exported `VERDICTS` enum; `confidence` from
  `CONFIDENCES` — both exported so bead 06/07 can validate against them instead of hardcoding strings.

**Not covered, by design (§5.3).** Real-world forecast accuracy. These tests pin behaviour on synthetic
series; they say nothing about whether the dip estimate is *right*, and should not be read as doing so.

