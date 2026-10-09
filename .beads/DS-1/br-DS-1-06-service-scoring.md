# Bead br-DS-1-06: Build the deterministic scorer and report validator

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.5 (score.js, lines 101-109), §5.1 (score rows, lines 155-156), §5.2 (`score.test.js` line 165), §5.4 (controls 4 and 8, lines 181, 185). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-06
- **Priority**: P0 (critical — the ranking and the report-safety validation)
- **Status**: pending
- **Original Estimate**: 2-3h
- **Dependencies**: br-DS-1-02, br-DS-1-05
- **Blocks**: br-DS-1-07
- **Commit**: `feat(DS-1): scorer and report validator (br-DS-1-06)`

## Description

Implement `scripts/score.js`: input `{ requirement, candidates[] }`, validated strictly, ranked, and
returned as a report. Takes the agent's raw `candidates` array directly (the skill passes the same array
to `history.js` independently — neither feeds the other; §3.7 step 4).

**Validation (§3.5 lines 102-104).** Drop unknown top-level candidate fields; cap string lengths; require
numbers finite and bounded (≥ 0); re-check every `url` with `checkUrl` from br-DS-1-02 — an off-allowlist
link is **dropped** (this also stops the report being used to smuggle a phishing link). Two recognized
fields are exempt from the unknown-fields-dropped rule: a `history` sub-object (`{ current, lowest,
highest, average, points? }`, matching br-DS-1-05's input) and the pair `must_haves_met: boolean` /
`must_haves_reason: string`. **Enforce the "present only when false" invariant defensively:** if
`must_haves_reason` is present while `must_haves_met` is `true`, drop it before scoring (round-13
F13.3). Of the remaining rules: numeric finite/≥ 0 applies to `history`'s price fields; the top-level
string cap and the PII sanitizer do **not** apply to `history` (its `date`/`price` are not free text and
are validated by `history.js`). A compact date like `20260515` (8 consecutive digits) must not be
redacted by the digit-run sanitizer.

**Effective price + offers (§3.5 line 105).** `effective_price` = price − best applicable offer per kind
(bank/coupon/exchange); a conditional offer applies only if listed in `requirement.eligible_conditions`.
Offers are non-stackable across a kind. Floor-clamp `effective_price` at 0. If the combined discount
(summed across kinds) **or any single kind's discount alone** exceeds the listed price, set
`offer_implausible` and cap the combined discount at the listed price for ranking.

**Rating (§3.5 line 106).** `rating_adj` = Bayesian shrinkage `(rating·n + PRIOR_MEAN·PRIOR_N) / (n +
PRIOR_N)`. Constants are exported tunable knobs.

**Flags (line 107).** `inflated_mrp` (claimed discount ≥ 60%), `low_reviews`, `over_budget`,
`third_party_seller`, `below_min_rating` (`rating_adj` < `MIN_RATING` = 3.5), `offer_implausible`.
(`login_required` is a gaps-level signal in the agent's response, not a per-candidate flag — line 107.)

**PII sanitizer (line 108).** Before scoring, strip phone-shaped digit runs (7+ consecutive digits not in
a URL), email-shaped tokens (`@`-containing), and long digit runs like order/account numbers (10+
consecutive digits not in a URL); a field whose entire value is a PII pattern becomes `"[redacted]"`.
Residual risk is documented in `docs/SECURITY.md` (br-DS-1-08).

**Ranking (§3.5 line 109).** `best_product` = highest `W_PRICE × price_score + W_RATING × rating_score`
among candidates passing the **must-haves gate** (`must_haves_met: false` excluded — the pre-computed
field the agent sets; does **not** require budget/rating floor). `price_score = 1 − (effective_price −
price_min) / max(price_max − price_min, 1)`; `rating_score = (rating_adj − rating_min) /
max(rating_max − rating_min, 0.001)`; both min-max over the filtered set. Degenerate cases: all tie on
price ⇒ every `price_score = 1`, ranking driven by rating; all tie on rating ⇒ every `rating_score = 0`,
ranking driven by price — neither affects the untied component. `best_product` is `null` if none passes
the gate. `best_deal` = lowest `effective_price` among candidates passing budget, must-haves
(`must_haves_met: true`) and the rating floor (`rating_adj ≥ MIN_RATING`); `null` + an explicit "no
qualifying deal found" message if none. Ties on weighted score (and on `effective_price`) broken by
lexicographic `source` ascending, then original array index. Group candidates sharing `product_key` to
compare the same item across sites. Excluded candidates (`must_haves_met: false`) stay in the comparison
table with `must_haves_met` **and** `must_haves_reason` visible (round-11 F11.2) — never silently
dropped, including items from the user's own cart/wishlist/saved.

**Exported constants (§3.5 lines 106, 109):** `W_PRICE = 0.4`, `W_RATING = 0.6`, `MIN_RATING = 3.5`,
`PRIOR_MEAN`, `PRIOR_N`. Do **not** define `MIN_POINTS` here — br-DS-1-05 owns it (see that bead's
constant-ownership note); re-export by import if anything needs it from this module.

**Carried from the round-15 review:**
- Observation 4 — §3.5 words the must-haves gate for `best_product` as "`must_haves_met: false` is
  excluded" (fail-open for an absent field) but for `best_deal` as "`must_haves_met: true`" (fail-closed).
  For present booleans these are equivalent and §3.5 says "same gate", so build **one** gate helper.
  Default it to fail-closed for an absent field (§3.4 step 3 mandates the field, so absence is a contract
  violation) and note the wording choice in Review Notes.
- **Plan gap:** the candidate schema is never enumerated as a complete field list (only "title, price,
  rating, etc." in §3.4 step 3, plus the fields §3.5 names: `url`, `source`, `product_key`, `history`,
  `must_haves_met`, `must_haves_reason`, and the numeric fields). "Unknown fields dropped" therefore has
  no defined allowlist. Define the canonical field allowlist in this bead (score.js is the validator),
  keep it explicit in code, and br-DS-1-07 must produce exactly those fields. Report the gap — do not
  invent product semantics beyond the fields the plan already names.

## Rationale

Ranking by a deterministic script rather than model arithmetic (R1) makes the result reproducible and
testable; the same validator is also the report-injection control (R4/R6), so its strictness is a
security property, not just hygiene.

## Outcome Definition

- `node --test test/score.test.js` exits 0.
- Negative controls 4 and 8 (§5.4 lines 181, 185) run once and reverted: (4) skip the per-candidate
  `checkUrl` ⇒ the dropped-URL test fails; (8) remove the `must_haves_reason`-stripping ⇒ the
  spurious-reason fixture retains the field. Record observed failing test names in Review Notes.

## Test Specifications

`test/score.test.js` (§5.2 line 165):
- ranking fixture (expected ranking **derived** from the formula, not asserted by observation);
- bank-offer applies only when eligible; dropped off-allowlist URL; field/length caps; NaN/negative price
  rejected;
- exchange offer alone exceeds listed price ⇒ `effective_price` = 0, `offer_implausible` set; three
  moderate per-kind offers (bank + coupon + exchange) each below the listed price but jointly above ⇒
  `offer_implausible` set, `effective_price` = 0;
- no candidate passes budget/must-haves/rating ⇒ `best_deal: null`;
- PII pattern (phone-shaped run, email token) in a string field ⇒ `"[redacted]"`;
- `history` sub-object passes validation intact and unchanged;
- extra/unknown top-level fields **plus** `must_haves_met: false` + `must_haves_reason: "failed: 5G"` ⇒
  both survive intact (exemption proven independent of the gate-logic fixture);
- identical weighted scores → lexicographically-lower `source` wins `best_product`; identical
  `effective_price` → same tie-break for `best_deal`;
- tied on price (differ only in rating) → higher-rated wins `best_product`; tied on rating (differ only
  in price) → lower-priced wins `best_product` (both degenerate floors resolve via the untied dimension);
- `rating_adj` exactly `MIN_RATING` = 3.5 → passes `best_deal`, not `below_min_rating`; just below ⇒
  flagged and excluded from `best_deal` (budget + must-haves pass, rating the sole cause) but still
  scored for `best_product`;
- `must_haves_met: false` → excluded from both `best_product` and `best_deal` regardless of price/rating;
- `must_haves_met: true` with a spurious `must_haves_reason` present ⇒ dropped before scoring.
- **Manual / recorded**: the §5.4 control-4 and control-8 mutation results → Review Notes.

## Files to Touch

- `scripts/score.js` (create — validation, sanitizer, effective_price, rating_adj, flags, ranking,
  tie-breaks, `product_key` grouping; exports the weight/prior constants)
- `test/score.test.js` (create)

## Review Notes

