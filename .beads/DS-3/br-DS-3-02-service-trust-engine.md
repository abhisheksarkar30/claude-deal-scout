# Bead br-DS-3-02: Build the deterministic trust engine — the ladder, the eight signals, cross-site and off-site corroboration

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.1 (the output
block), §3.2 (the engine — the whole bead), §3.6 (the `offsite` input's provenance), §5.1 (risk rows),
§5.2 (`test/trust.test.js`), §5.3 (not covered), §5.4 (controls **11, 13, 14**), §6 R3/R6, §10 (the
extract/judge split), §8 (this bead). Repo `D:\github\claude-deal-scout`. Cited by section for the plan;
source by line, stable at the `feat/ds-3-…` base. §11's context-refresh list is **not** this bead's scope.

- **Bead ID**: br-DS-3-02
- **Priority**: P0 (critical — the whole story's judgement lives here)
- **Status**: done
- **Original Estimate**: 2.5–3h (the largest bead in the story — the engine *and* a ~31-case fixture
  suite; see the note under Outcome Definition)
- **Dependencies**: br-DS-3-01
- **Blocks**: br-DS-3-03, br-DS-3-04
- **Commit**: `feat(DS-3): trust engine — ladder, signals, corroboration (br-DS-3-02)`

## Description

Implement `scripts/trust.js`: a **deterministic** script (the model extracts, this script judges — §10)
that turns a candidate's `trust` input plus the candidate set into a `brand_confidence` label, the
signals behind it, the evidence actually read, and cross-site / off-site corroboration. It is the
sibling of `scripts/history.js` — same `validate` / engine / `analyzeAll` shape, same "invalid input →
no output, no throw" rule, tests over fixtures only.

**Module shape (§3.2).** Same as [`scripts/history.js`](../../scripts/history.js): `'use strict'` →
file JSDoc → requires → exported knobs → helpers → engine → `module.exports`.

**Imports (keep the direction one-way).** From `score.js`: `MAX_NUMBER`, `MAX_STRING_LENGTH`,
`sanitize` (the one cap + sanitizer definition). From `policy.js`: `sourceToBareId`
(`scripts/policy.js:156-159`) — reused, never re-implemented, so "which site is this" keeps one
definition. Do **not** import `MAX_REVIEWS_READ` — `score.js` owns it and `trust.js` never references it
(§3.2, §3.3).

**Exported knobs (the DS-1 convention — a human will retune these).**

| Knob | Value | Meaning |
|---|---|---|
| `BRAND_CONFIDENCES` | `['high','medium','low','none']` | the only four values. Do not add a fifth |
| `SIGNALS` | the 8 names below | the closed signal set |
| `DISCREDITING_SIGNALS` | `['brand_not_in_title','seller_third_party','price_undercut']` | the subset that caps the ladder at `low` |
| `MIN_REVIEWS_READ` | `4` | below this, no review-share signal either way |
| `UNVERIFIED_SHARE_MAX` | `0.5` | a read sample more than half unverified sets `unverified_review_share` |
| `UNDERCUT_PCT` | `30` | see the `price_undercut` row for the base |
| `RATING_GAP` | `1.0` | a peer's or an off-site rating this far apart sets `rating_disagrees` |
| `CAVEAT` | the fixed string below | carried on every block |

`MAX_REVIEWS_READ` (`50`) is deliberately **not** a `trust.js` knob — it is a validation bound in
`score.js` (§3.2, §3.3; bead 01).

**The eight signals — three discrediting, five informational.** The split matters: an informational
signal must never move the ladder, or "no brand store on Flipkart" would read as evidence of fraud.

| Signal | Fires when | Class |
|---|---|---|
| `brand_not_in_title` | the listing's own `brand` string does not appear in its own `title` (case- and punctuation-insensitive) | discrediting |
| `seller_third_party` | `third_party_seller === true` (the candidate's existing top-level field, read — **not** duplicated into `trust`) | discrediting |
| `price_undercut` | any peer on another site lists the same `product_key` at ≥ `UNDERCUT_PCT`% more than **this** listing's price — `(peer.price − candidate.price) / candidate.price ≥ UNDERCUT_PCT/100`, the candidate's price as base | discrediting |
| `rating_disagrees` | any peer or the off-site source differs in rating by ≥ `RATING_GAP` | informational |
| `unverified_review_share` | `reviews_read ≥ MIN_REVIEWS_READ` **and** the unverified share > `UNVERIFIED_SHARE_MAX` | informational |
| `review_sample_too_small` | `reviews_read < MIN_REVIEWS_READ` (including an absent sample) | informational |
| `no_brand_store` | `brand_store !== true` — normal on Flipkart, which has no storefront concept | informational |
| `no_peer_site` | the same `product_key` was not found on another site — **absence, not evidence** | informational |

**The ladder, evaluated in this fixed order, first match wins** (the order is the contract):

```
0. no evidence at all AND no discrediting signal  -> "none"
   (brand absent, seller absent, brand_store !== true, third_party_seller undefined)
1. two supports AND no discrediting signal        -> "high"
2. exactly one support AND no discrediting signal -> "medium"
3. otherwise                                      -> "low"
```

The two **supports** are exactly: `brand_store === true`, and *a seller name was read **and**
`third_party_seller === false`*. That second one is deliberately **fail-closed on an absent field** —
the boolean's own definition ("true only if **clearly** not authorised",
[`agents/deal-scout.md:102`](../../agents/deal-scout.md#L102)) means its absence is "couldn't tell",
never support. **Rung 0 must be checked before the counting rungs**, or a listing with no usable
evidence would match rung 3's `otherwise` and fall to `low` instead of `none`. Rungs 1–3 are total and
mutually exclusive by construction, which is what makes the ladder testable at each boundary.

**Rung 0 carries the same `AND no discrediting signal` guard** as rungs 1–2, so a fired discrediting
signal is never labelled `none`. With no brand and no seller, the only discrediting signal reachable is
`price_undercut` (it needs only a `product_key` and a peer ≥ `UNDERCUT_PCT`% dearer), which forces
rung 3 → `low`.

**The output block** (`trust.js` → `report.js` → the skill), mirroring
[`scripts/history.js:198-207`](../../scripts/history.js#L198-L207):

| Key | Shape | Notes |
|---|---|---|
| `brand_confidence` | `"high" \| "medium" \| "low" \| "none"` | the ladder. Four values, no fifth |
| `signals` | `string[]` of the closed set | the *why*; the skill renders these in plain words |
| `facts` | `{ brand, brand_store, seller, reviews_read, verified_read }` | the evidence actually read: the `brand`/`seller` strings **sanitized+capped**, the two counts bounded to non-negative integers (**not capped**) |
| `peer` | `{ source, price_gap_pct, rating_gap } \| null` | see below |
| `offsite` | `{ source, rating, count, rating_gap } \| null` | a third-party source, or `null` when none ships/applies |
| `reason` | string | one plain sentence for the confidence |
| `caveat` | the fixed `CAVEAT` string | below |

`CAVEAT` reads: *"This is evidence, not proof — a listing can mimic every signal below, and absence of a
signal is not proof of authenticity. Verify at the link."* It mirrors the forecast caveat
([`scripts/history.js:36`](../../scripts/history.js#L36)) and exists because printing "genuine" from
page text a counterfeiter wrote would be a claim the plugin cannot support (§3.1, §6 R1).

> **`null` vs `"none"` is a real distinction and must not be collapsed.** `trust_assessment: null`
> means the candidate carried no *usable* `trust` input (key absent, or its value not a usable object);
> `brand_confidence: "none"` means it *was* read and nothing justifying was found. `history.js` has only
> the first notion ([`scripts/history.js:150-152`](../../scripts/history.js#L150-L152)); trust needs both.

**Cross-site corroboration (R3), computed set-wide in `analyzeAll(candidates)`.** Group the raw array by
non-empty `product_key`; for each candidate, peers are those whose **bare adapter id differs** —
`sourceToBareId`. Two rules that are easy to get wrong:

- A candidate whose narrowed `source` is **not a non-empty string is excluded from peer grouping
  entirely** — neither matched against nor counted as a peer. `sourceToBareId(undefined)` returns the
  literal `"undefined"` ([`scripts/policy.js:158`](../../scripts/policy.js#L158)), which differs from
  every real bare id; without this rule a `source`-less `product_key`-bearing candidate would look like
  a peer on a third site and could manufacture a **discrediting** `price_undercut` out of nothing.
- A candidate can have **more than one** peer. The peer-derived signals read the **whole set**:
  `price_undercut` fires when **any** peer clears `UNDERCUT_PCT`; `rating_disagrees` when **any** peer
  (or the off-site source) differs by `RATING_GAP`.

The single `peer` the block emits is the **first of that set under `betterThan`'s comparison**
([`scripts/score.js:275-280`](../../scripts/score.js#L275-L280)) — lexicographic `source`, then raw-array
index — so the block is deterministic (R6) even when the signals were driven by a different peer.
`price` is compared **raw, not `effective_price`**: offers are account-specific and non-comparable across
sites. `price_gap_pct = (peer.price − candidate.price) / candidate.price × 100` (signed, candidate as
base); `rating_gap = peer.rating − candidate.rating` (signed). A gap is `null` when either side is
unavailable (no usable `rating`/`price` on either) — see the test list. The emitted `peer.source` (the
peer's bare adapter id) is capped+sanitized like `facts`.

**Off-site block.** `offsite` carries the source, rating and count the input supplied; the emitted
`source` is capped+sanitized; `rating_gap = offsite.rating − candidate.rating` (signed), and is `null`
(no `rating_disagrees`) when the candidate carries no usable `rating` to compare against.

`trust.js` does its **own ~5-line grouping** rather than consuming `score.js`'s `product_groups`
([`scripts/score.js:363-368`](../../scripts/score.js#L363-L368)). That is deliberate, not duplication:
`score.js` groups ">1 member, for display" across *all* sources including two account lists on one site,
while trust asks "is there a peer on a **different** site". **Do not "fix" one into the other.**

**`analyzeAll(candidates)` takes the agent's raw candidate array** (like
[`scripts/history.js:280-284`](../../scripts/history.js#L280-L284)), **and takes no options** — the peer
grouping needs only `product_key` and `sourceToBareId`, never the loaded adapter set (§3.4). Every field
trust reads off that array — `title`, `price`, `source`, `product_key`, `third_party_seller`, `rating`,
and the candidate's own `trust` sub-object — is **unvalidated**, and trust narrows each one locally:

- top-level strings → a non-empty string;
- `price` → a finite number ≥ 0 and ≤ `MAX_NUMBER` (imported from `score.js`);
- `rating` → a finite `0 … 5`, anything else treated as absent. This bound is trust's **own**:
  `score.js` bounds a candidate's `rating` only to `MAX_NUMBER`, not `0 … 5`
  ([`scripts/score.js:160-166`](../../scripts/score.js#L160-L166)) — a hostile out-of-range value must
  not skew `rating_disagrees`.

A malformed candidate yields absent facts and a lower confidence; **it never throws**.

**The raw `trust` sub-object is narrowed by `trust.js`'s own `validate(raw)`** — the engine-side sibling
of `score.js`'s `validTrust` (bead 01), exactly as `history.js`'s non-exported `validate`
([`scripts/history.js:71`](../../scripts/history.js#L71)) is the sibling of `validHistory`
([`scripts/score.js:125-133`](../../scripts/score.js#L125-L133)). It returns the narrowed sub-object, or
`null` when the raw `trust` is not an object (the `null` side of the split above), narrowing
`brand`/`seller` with the imported `sanitize`/`MAX_STRING_LENGTH`, `brand_store` to a boolean,
`reviews_read`/`verified_read` to **non-negative integers** (bounded, **not** capped at
`MAX_REVIEWS_READ`), and `offsite` to an object with a non-empty `source`, a `rating` in `0 … 5` and a
`count` ≥ 0. It enforces the `verified_read ≤ reviews_read` invariant **here too** — a violated pair is
**dropped** (both counts removed, so `review_sample_too_small` fires), never corrected — because
`validTrust` guards only the report-side copy while the engine reads the raw array
([`scripts/report.js:35`](../../scripts/report.js#L35)). **A dropped pair is not a dropped block:** the
block is still returned.

**Export** `analyzeAll` (and `analyze`, and the knobs) from `module.exports`; `report.js` binds
`analyzeAll` under an alias in bead 03. Export the knob names so `test/trust.test.js` can assert them
(the DS-1 knob-test pattern; `score.js`'s `module.exports`, `scripts/score.js:388-407`).

## Rationale

This is the judgement the user asked for ("identify/**justify** the brand") made deterministic and
testable offline, in the established shape: `trust.js` is a sibling of `history.js`, not an addition to
`score.js`, so validation/bounds stay in `score.js` and the semantic rule stays here, and the ladder
gets a fixture suite of its own (§10). Cross-site corroboration rests on `product_key`, which is
agent-built ([`agents/deal-scout.md:131-145`](../../agents/deal-scout.md#L131-L145)) — R6 records that a
miss looks like `no_peer_site`, which is why that signal is informational only.

## Outcome Definition

- `npm test` exits **0** — 123 existing plus the ~31 new `test/trust.test.js` cases.
- Every fixture in the §5.2 list below returns the stated confidence / signals.
- Every invalid-input case returns `null`/absent and **never throws**.
- **Negative controls (plan §5.4, controls 11, 13, 14)** — each run once, reverted, `scripts/trust.js`
  confirmed byte-identical (`git diff --stat`), observed failing test names in Review Notes:
  - **11** — make `trust.js` ignore the sample floor (`MIN_REVIEWS_READ` → `0`) → the
    `review_sample_too_small` test **and** the `unverified_review_share` "too small a sample yields no
    share signal" case must fail.
  - **13** — drop the `!==` on the bare-id comparison in the peer lookup (any same-`product_key`
    candidate counts, including one on the same site) → the "the same product on the same site is not a
    peer" test **and** the `price_undercut` boundary test must fail.
  - **14** — remove the "AND no discrediting signal" clause from **rung 2** of the ladder → the
    `brand_store: true` + `third_party_seller: true` test (one support, one discrediting signal) must
    now return `medium` instead of `low`.
  - Expected margin: controls **11 and 13 each flip two tests** (the same accepted deviation DS-2
    recorded for control 10; control 3's was a different kind — see
    [`docs/context/testing-and-quality.md:67-90`](../../docs/context/testing-and-quality.md#L67-L90)).
- `node -e "console.log(require('./scripts/trust').BRAND_CONFIDENCES.join(','))"` prints
  `high,medium,low,none`.

> **Estimate note.** This bead carries both the engine and a ~31-case suite, which is why it is
> estimated at 2.5–3h rather than the nominal <2h. The plan's §8 fixes the decomposition at seven beads
> and says not to split 02; the DS-1 precedent (br-DS-1-07, estimated 3h) is the same call.

## Test Specifications

- `test/trust.test.js` (create, ~31 cases, §5.2):
  - **Ladder** — `none` on no evidence; `high` at two supports with no discrediting signal; `medium` at
    exactly one support (each support singly); `low` when read but unsupported; the boundary
    `brand_store: true` + `third_party_seller: true` → **`low`** (not `medium`); the **two-support case
    that fires a discrediting signal** (`brand_store: true` + a seller name + `third_party_seller:
    false`, plus a `price_undercut` peer) → **`low`**, not `high` — the only case exercising **rung 1**'s
    own `AND no discrediting signal` clause; the **rung-0 boundary** (no brand, no seller, no brand
    store, `third_party_seller` absent) plus a `price_undercut` peer → **`low`**, never `none`.
  - **Signals** — `brand_not_in_title` fires when the brand string is absent from the title and **not**
    when present in a different case or with punctuation between; `price_undercut` at exactly
    `UNDERCUT_PCT` (fires) and one point below (does not); `rating_disagrees` at exactly `RATING_GAP`;
    `unverified_review_share` either side of `UNVERIFIED_SHARE_MAX`; `review_sample_too_small` below
    `MIN_REVIEWS_READ` with **no** share signal from the same input; `no_brand_store` and
    `no_peer_site` present without moving the confidence; `DISCREDITING_SIGNALS` is asserted to exclude
    `no_brand_store`.
  - **Peer selection** — the same `product_key` twice on the **same** site is not a peer
    (`sourceToBareId` equality); a peer on another site is; a peer with no `price` contributes no gap; a
    `product_key`-less candidate has no peers and no signals; a `product_key`-bearing candidate with no
    `source` is excluded from peer grouping (no peer, so no `price_undercut`/`rating_disagrees`); two
    candidates on the other site sharing the `product_key` → the `peer` surfaced is the first under
    `betterThan`'s comparison (deterministic across runs, and the block's gaps are its own, not the
    other peer's); a candidate with no `rating` → the block's `rating_gap` is `null` and no
    `rating_disagrees` fires; the surfaced `price_gap_pct` is `null` when the surfaced peer's own price
    is unusable; the emitted `peer.source` is capped/sanitized.
  - **Off-site** — the `trust_assessment.offsite` block carries the source, rating and count the input
    supplied (the emitted `source` capped/sanitized); `rating_disagrees` against the on-site rating; no
    gap signal — `offsite.rating_gap: null` — when the candidate has no `rating` to compare;
    out-of-range `rating` dropped.
  - **Degradation** — absent `trust` input → `trust_assessment: null`; `trust: []` and `trust: "x"` →
    `trust_assessment: null`; `verified_read > reviews_read` → pair dropped, block still returned, no
    throw; every block carries `caveat`.
  - **Knobs** — the exported defaults are asserted (the `score.test.js` knob-test pattern,
    [`docs/context/testing-and-quality.md:104`](../../docs/context/testing-and-quality.md#L104)).
  - **Alignment** — `analyzeAll` returns an **index-aligned** array and `null` for a candidate with no
    trust input.
- **Manual / recorded**: the three §5.4 mutation results (failing test names) → Review Notes.
- **Not covered** (state, do not fake): whether `brand_confidence` correlates with actual
  authenticity (§5.3) — a rule over readable signals can be satisfied by a convincing counterfeit; the
  caveat says so.

## Files to Touch

- `scripts/trust.js` (create — knobs, the eight signals, the ladder, peer/off-site corroboration,
  `validate`, `analyze`/`analyzeAll`, exports)
- `test/trust.test.js` (create)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**Done.** `scripts/trust.js` created — the eight signal names in the fixed `SIGNALS` order, the three
discrediting vs five informational split, the four-rung ladder, `validate`/`analyze`/`analyzeAll`,
`peerSets` + `firstBySourceThenIndex` for cross-site corroboration, and the `offsite` block. Exports
the knobs and the two entry points; `MAX_REVIEWS_READ` is deliberately not referenced.

- `test/trust.test.js` created — **37 cases** (the bead estimated ~31).
- Verified: `npm test` **168 pass / 0 fail** (131 after bead 01 + 37); `node scripts/guard.js selftest`
  still **`selftest OK: 60 cases`**; `BRAND_CONFIDENCES` prints `high,medium,low,none`.

**Controls 11, 13, 14 — all run once, reverted, `sha1sum scripts/trust.js` = `e93b5ec3…` before and
after (unchanged).** Failing test names observed:

- **11** (`MIN_REVIEWS_READ` → `0`): `review_sample_too_small fires below MIN_REVIEWS_READ`,
  `a sample below MIN_REVIEWS_READ yields no share signal either way`, **and**
  `the exported knobs carry their plan-pinned defaults` — **three**, not the documented two; the
  third is the knob assertion, which is expected and not a defect.
- **13** (`i !== index && sourceToBareId(...) !== own` → `i !== index`): exactly two —
  `price_undercut fires at exactly UNDERCUT_PCT and not one point below`,
  `the same product on the same site is not a peer`.
- **14** (rung 2's `&& !discrediting` removed): exactly one —
  `a brand store plus a third-party seller yields low, not medium` → returned `medium`.

**Two test fixtures had to be tightened to make the controls bite, and the first attempt at control 11
is what exposed it.** The review-sample fixtures were written as `reviews_read: MIN_REVIEWS_READ - 1`,
which moves *with* the knob, so mutating the knob changed nothing behavioural and only the knob
assertion caught it. They are now literal (`3`, and the floor itself at `4`). Likewise the
`price_undercut` boundary case originally used two cross-site candidates, which control 13 cannot
disturb; it now carries a same-site decoy priced 100% higher, so dropping the bare-id guard makes the
"does not fire" half fail. Both changes are in the tests only.

**The suite caught a real bug in the first cut**, which is why it is worth recording: `confidenceFor`
was handed the `supports` **array** where it compares a count, so `supports >= 2` was `NaN`-false and
every well-supported candidate came out `low`. The ladder fixtures failed immediately.

**Justified deviations, each where the bead was silent:**

1. `priceRatio` returns `null` for a **zero base**, not `0` or `Infinity`. A zero-priced listing is
   nonsense data, and the ratio's only consumer here is the **discrediting** `price_undercut` — a
   fabricated accusation is the direction this story must not fail in.
2. `unverified_review_share` requires **both** counts. With `verified_read` absent there is no share
   to compare, so no signal is claimed rather than assuming zero verified; the bead's phrase "the
   unverified share" presumes both are present.
3. `no_peer_site` is claimed only when the candidate actually took part in the grouping (non-empty
   `product_key` **and** `source`). The bead says a `source`-less candidate is "excluded from peer
   grouping entirely", and "we looked and did not find it" cannot be said of one that never looked.
4. `facts` carries all five keys with explicit `null` for what was absent, so the JSON shape is
   stable across candidates.
5. `peer.price_gap_pct` / `rating_gap` and `offsite.rating_gap` are rounded to one decimal on the way
   out (`history.js`'s `round1`); the signals compute on the unrounded values, so the emitted number
   never disagrees with the signal that fired.

**Not done, deliberately.** Nothing asserts that `brand_confidence` correlates with authenticity
(§5.3) — a rule over readable signals is satisfiable by a convincing counterfeit, and the `CAVEAT` on
every block says so. §11's context-refresh list is not this bead's scope. `score.js`'s `product_groups`
is not reused, by design (§3.2).
