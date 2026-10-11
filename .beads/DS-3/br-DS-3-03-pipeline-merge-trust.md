# Bead br-DS-3-03: Merge `trust_assessment` into the report and pin that the ranking is unchanged

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.4 (report.js
merges, ranking untouched), §2 R5, §5.1 (the ranking-risk row), §5.2 (`test/report.test.js`), §5.4
(none — this bead has no assigned control), §4.1/§4.2, §8 (this bead). Repo
`D:\github\claude-deal-scout`. Cited by section for the plan; source by line, stable at the
`feat/ds-3-…` base. §11's context-refresh list is **not** this bead's scope.

- **Bead ID**: br-DS-3-03
- **Priority**: P0 (critical — this is the wiring that makes the engine's output reach the user, and the
  test that pins the flag-only guarantee)
- **Status**: pending
- **Original Estimate**: 1–1.5h
- **Dependencies**: br-DS-3-02
- **Blocks**: br-DS-3-06
- **Commit**: `feat(DS-3): merge trust_assessment into the report (br-DS-3-03)`

## Description

Wire `trust.js` into the pipeline as one more sibling of the existing history join, and pin the
"flag-only" guarantee with a test rather than a comment (§3.4, R5). **`score()` runs first and is
unchanged, so the ranking is identical with and without trust input.**

**`scripts/report.js` — one new join in `buildReport` ([`scripts/report.js:34-50`](../../scripts/report.js#L34-L50)).**
`trust.js`'s `analyzeAll` is imported **under an alias** — `history.js` already exports that name and
`report.js` already binds it at [`scripts/report.js:21`](../../scripts/report.js#L21) — and, unlike
`history.js`'s, **takes no options** (the peer grouping needs only `product_key` and `sourceToBareId`,
never the loaded adapter set):

```js
const { analyzeAll: analyzeTrust } = require('./trust');
…
const trusts = analyzeTrust(candidates);
…
candidates: scored.candidates.map((c) => ({
  ...c,
  price_history: histories[c.index] || null,
  trust_assessment: trusts[c.index] || null,
})),
```

`...c` still carries the validated `trust` **input** (added by `score.js`, bead 01), and the computed
block lands on the distinct **`trust_assessment`** key — the same shape as `...c` carrying `history`
while `price_history` is added. The output does **not** overwrite the input: the report carries both,
each separately sanitized (§3.1, §3.3).

**The guarantee, stated precisely.** `product_groups`, `flags`, every per-candidate `score`, and the
winning `best_product.index`/`score` and `best_deal.index`/`effective_price` are the same with and
without `trust` input. The winning candidate objects themselves **do** carry the extra validated `trust`
key (exactly as they already carry `history`), so the guarantee is on the ranking-relevant values,
**not** on byte-identical objects — a byte-identical-object assertion would be false (§3.4).

## Rationale

Trust is a whole new judgement layer; the thing that keeps it from re-ranking the user's options on
evidence they have not seen is that it is *added after ranking*, like `price_history`. This bead is the
structural expression of the user's "flag only" decision, and §5.2 pins it with a test rather than a
comment (§5.1). It blocks the skill bead (06), which documents behaviour the user sees end to end.

## Outcome Definition

- `npm test` exits **0** — 123 existing (plus bead 01's and 02's new cases) plus the new
  `test/report.test.js` cases.
- The identical-ranking test passes: the same fixture run twice — once with `trust` input, once without
  — yields identical `best_product.index` + `score`, identical `best_deal.index` + `effective_price`,
  and identical per-candidate `score`.
- `buildReport` returns `trust_assessment` on every surviving candidate (`null` where absent) **and**
  the validated `trust` input intact beside it.

## Test Specifications

- `test/report.test.js` (modify — additions only, §5.2), driving the existing `buildReport` fixture
  style ([`test/report.test.js:39-101`](../../test/report.test.js#L39-L101)) and the `candidate()`
  helper ([`test/report.test.js:18-30`](../../test/report.test.js#L18-L30)):
  - `'the merged report carries trust_assessment on every candidate'` — a candidate with trust input
    gets a non-`null` `trust_assessment`; one without gets `null`; and the validated `trust` input is
    still present beside it (not overwritten).
  - `'trust input does not change the ranking'` — build the report twice, once with a `trust` input on
    the candidates and once without, and assert identical `best_product.index` + `score`, identical
    `best_deal.index` + `effective_price`, and identical per-candidate `score` across the two runs (the
    added `trust`/`trust_assessment` keys aside).
- **Not covered** (state, do not fake): no test asserts the *content* of `trust_assessment` here — that
  is `test/trust.test.js`'s (bead 02); this bead pins the merge and the ranking invariant.

## Files to Touch

- `scripts/report.js` (modify — import `analyzeAll` as `analyzeTrust`; call it; add the
  `trust_assessment` key to the candidate map. `score()` and everything else unchanged.)
- `test/report.test.js` (modify — the two cases above)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

*(Append-only. The implementer records here, when the bead is done: what was built, any justified
deviation from the bead or the plan, and anything deliberately left undone. Not written at beadify
time.)*
