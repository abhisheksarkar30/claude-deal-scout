# Bead br-DS-1-05: Build the price-history stats and buy/wait verdict engine

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.6 (history.js, lines 111-118), §5.2 (`history.test.js` line 166), §5.3 (forecast accuracy not covered, line 173), §5.4 (control 5, line 182). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-05
- **Priority**: P0 (critical — R10's verdict is the whole point of price history)
- **Status**: pending
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

