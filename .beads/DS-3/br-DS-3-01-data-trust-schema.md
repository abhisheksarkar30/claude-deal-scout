# Bead br-DS-3-01: Validate the agent's `trust` input sub-object in the candidate schema

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.1 (the
input half of the `trust` contract), §3.3 (`score.js` validates the input half), §5.1 (risk rows),
§5.2 (`test/score.test.js`), §5.4 (control 12), §4.1/§4.2 (files / not-touched), §6 R2, §10
(security-engineer note), §8 (this bead). Repo `D:\github\claude-deal-scout`. Cited by section for the
plan (a living document) and by line for source (stable at the `feat/ds-3-…` base). §11's
context-refresh list is **not** this bead's scope.

- **Bead ID**: br-DS-3-01
- **Priority**: P0 (critical — it is the contract every other bead reads, and it is the
  report-injection control for the story's first new free-text field)
- **Status**: done
- **Original Estimate**: 1h
- **Dependencies**: None
- **Blocks**: br-DS-3-02, br-DS-3-05
- **Commit**: `feat(DS-3): trust input schema and validation (br-DS-3-01)`

## Description

Add the `trust` **input** sub-object to the candidate schema and validate it — the report-side half of
the two-key `trust` contract (§3.1). This is the smallest bead and it blocks the most. **No new
export** is added (§3.3, §4.1): `validTrust` stays module-internal exactly as `validHistory` does.

**Add the field to the allowlist.** `CANDIDATE_FIELDS` (`scripts/score.js:44-58`) gains one row,
beside `history` (`scripts/score.js:55`):

```js
trust: 'object',
```

There is no unknown-fields rule to be exempt from: `validateCandidate` iterates the allowlist
(`scripts/score.js:150`), so a field not listed is simply never visited. **The type string alone is
inert** — the loop stores a value only inside its `string` / `number` / `boolean` / `offers` /
`history` branches (`scripts/score.js:150-181`), so an unhandled type stores nothing.

**Wire the branch.** The field loop gains a `trust` branch beside the `history` branch
(`scripts/score.js:177-180`) that calls `validTrust(value)` and stores the returned narrowed object, or
drops the field (pushes `'trust'` to the local `dropped` array, `scripts/score.js:148`, which becomes
the candidate's `dropped_fields` at `scripts/score.js:321`) when it fails.

**`MAX_REVIEWS_READ` is a `score.js` constant, not a `trust.js` knob** (§3.2, §3.3). Define it beside
`MAX_NUMBER` (`scripts/score.js:32`):

```js
const MAX_REVIEWS_READ = 50;
```

`score.js` owns it rather than importing it, deliberately: `trust.js` already imports `MAX_NUMBER` /
`MAX_STRING_LENGTH` / `sanitize` from `score.js` (§3.2/§10), so a reverse import would close a
`score → trust → score` require cycle and load `trust.js` against a partial `score` export, silently
dropping its numeric narrowing. `trust.js` (bead 02) never references this constant.

**`validTrust(raw)` — a sibling of `validHistory` (`scripts/score.js:125-133`).** It does **shape, type
and bound checking only** — never the semantic rule, which stays in `trust.js` (one rule, one home).
It returns the narrowed `trust` sub-object, or `null`/absent when `raw` is not a non-array object
(the `null` side of §3.1's null-vs-`"none"` split). Rules, in the order §3.3 lists them:

- `brand`, `seller` — strings, **capped at `MAX_STRING_LENGTH`** and PII-sanitized with the existing
  `sanitize` (`scripts/score.js:96-103`); a non-string is **dropped, not fatal** (the rest survives).
  Both are free text off a hostile page (§6 R2), which is why they are capped and sanitized here.
- `brand_store` — boolean, else dropped.
- `reviews_read`, `verified_read` — integers in `0 … MAX_REVIEWS_READ`; a non-integer or
  out-of-range value drops **only that field**.
- `verified_read ≤ reviews_read` — **the pair is dropped when violated, never corrected** (both counts
  removed, so `review_sample_too_small` fires downstream). The same uniform "malformed input → no
  output" outcome `history` has. A dropped pair is **not** a dropped block: the rest of `trust`
  (and the candidate) survives.
- `offsite` — an object with a **non-empty `source` string** (capped+sanitized like `brand`/`seller`),
  a `rating` in `0 … 5`, and a `count` ≥ 0. Anything failing this drops `offsite`.
- **any other key inside `trust` is dropped**, and the dropped sub-key names are recorded in the
  candidate's `dropped_fields` (`scripts/score.js:321`), so a bad agent emission is visible rather than
  silently ignored. Recording dropped **sub-keys** is new behaviour with no precedent — `validHistory`
  destructures its known keys and ignores any others without recording them
  (`scripts/score.js:125-133`). The exact plumbing is the implementer's call (e.g. have `validTrust`
  return `{ trust, dropped }`); the **requirement** is that the names reach `dropped_fields`.

**`offsite.url` is deliberately not carried** (§3.1): the `source` id names the site and no third-party
link enters the report.

**Version bump.** Bump `version` in `.claude-plugin/plugin.json` (currently `0.1.6` → `0.1.7`) — the
repo requires a bump on every change to the plugin, once per bead (`CLAUDE.md`).

## Rationale

`trust` is the first new free-text field since DS-1, so this bead is where the story's injection control
lives (§3.3, §6 R2, §10): `trust.brand` / `trust.seller` are, before this, unbounded page text, and both
the input sub-object and `trust.js`'s output `facts` carry them into the report. `score.js` owns the
**one** cap + sanitizer definition (`scripts/score.js:96-103`, `:3-10`), and both render paths apply the
same helper. Nothing else can land until the input half exists, which is why this bead blocks 02 and 05.

## Outcome Definition

- `npm test` exits **0** — the 123 existing tests still pass plus the new `test/score.test.js` cases.
  Baseline before this story: `123 pass / 0 fail across 7 files`.
- `node scripts/guard.js selftest` exits **0** and still prints `selftest OK: 60 cases` — **unchanged**
  from the baseline. `scripts/guard.js` and `hooks/hooks.json` are explicitly not touched (§4.2), so the
  matrix must be identical; this green run is the evidence that widening the validation layer left the
  enforcement layer untouched.
- `node -e "console.log(require('./scripts/score').CANDIDATE_FIELDS.trust)"` prints `object`.
- **Negative control (plan §5.4, control 12).** Remove the `verified_read ≤ reviews_read` check in
  `validTrust` → the `test/score.test.js` case **"a `verified_read` greater than `reviews_read` drops
  the pair but keeps the candidate"** must **fail** (the report-side pair is now trusted). Run once,
  revert, confirm `scripts/score.js` is byte-identical (`git diff --stat scripts/score.js` is empty),
  and record the observed failing test name in Review Notes.

## Test Specifications

- `test/score.test.js` (modify — additions only, §5.2):
  - `'a trust sub-object passes validation intact'` — the `history`-retention pattern
    (`test/score.test.js:272-281`): a candidate carrying `trust` keeps the sub-object unchanged.
  - `'an over-long trust.brand is capped at MAX_STRING_LENGTH'`.
  - `'a PII-shaped trust.seller is redacted'` — e.g. `seller: 'call 9876543210'`.
  - `'an over-long or PII-shaped trust.offsite.source is capped/redacted'`.
  - `'a verified_read greater than reviews_read drops the pair but keeps the candidate'` — asserts the
    candidate survives with `trust` present but its two counts removed, and names the drop in
    `dropped_fields`.
  - `'a non-numeric reviews_read drops only that field'`.
  - `'an unknown key inside trust is dropped and named in dropped_fields'`.
- Drive the fixtures through `score({ requirement, candidates }, ADAPTERS)` in the file's existing
  style (`test/score.test.js:26-40`).
- **Manual / recorded**: the §5.4 control-12 mutation result (the failing test name) → Review Notes.
- **Not covered, stated not faked**: no automated test asserts the *semantic* ladder — that is
  `trust.js`'s (bead 02); this bead only pins the input validation.

## Files to Touch

- `scripts/score.js` (modify — `CANDIDATE_FIELDS.trust`; the `trust` field-loop branch; `validTrust`;
  `MAX_REVIEWS_READ` constant. **No new export**.)
- `test/score.test.js` (modify — the seven cases above)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**Done.** Built the input half of the `trust` contract exactly as specified, with no new export.

- `scripts/score.js`: `MAX_REVIEWS_READ = 50` beside `MAX_NUMBER` (with the require-cycle rationale in
  its doc comment); `trust: 'object'` in `CANDIDATE_FIELDS`; a `trust` branch in the `validateCandidate`
  field loop; `validOffsite` and `validTrust` as module-internal helpers. `validTrust` returns
  `{ trust, dropped }` — the bead's own §"any other key" note left the plumbing to the implementer, and
  that shape is what lets the dropped **sub-key** names reach `dropped_fields` as required.
  `TRUST_FIELDS` names the six permitted sub-keys.
- `test/score.test.js`: the new `// trust input (§3.3)` section. `plugin.json` 0.1.6 → 0.1.7.
- Verified: `npm test` **131 pass / 0 fail** (123 baseline + 8); `node scripts/guard.js selftest` still
  prints **`selftest OK: 60 cases`**, unchanged from baseline — the evidence that widening the
  validation layer left the enforcement layer untouched; `CANDIDATE_FIELDS.trust` prints `object`.

**Justified deviation — 8 tests, not the 7 listed.** Added
`'a trust value that is not an object drops the whole field'`. The bead's own §3.3 rule pins the `null`
side of §3.1's null-vs-`"none"` split (`validTrust` returning `null` for a non-object), and `offsite`
being all-or-nothing is the same idea one level down — but the test list left both unasserted. The new
case asserts `!('trust' in result)`, `dropped_fields.includes('trust')`, and that the candidate survives
with its price intact, i.e. the "not attempted" path is distinguishable from "attempted, nothing usable"
(which bead 02 turns into `brand_confidence: "none"`). Without it, the split is a comment, not a contract.

The bead's `offsite.source` case was listed as "capped/redacted"; both halves are now asserted in the
one renamed test (`'trust.offsite.source is redacted when PII-shaped and capped when over-long'`), since
the `slice` in `validOffsite` is real code and the bead asked for the cap specifically.

**Negative control 12 — observed.** Neutralized the pair check in `validTrust`
(`trust.verified_read > trust.reviews_read` → `false`), ran
`node --test --test-name-pattern="drops the pair but keeps the candidate" test/score.test.js`:
the failing test was **`a verified_read greater than reviews_read drops the pair but keeps the candidate`**,
`fail 1`, at `test/score.test.js:369` (`assert.ok(!('reviews_read' in result.trust))`). Reverted from a
pre-mutation copy; `sha1sum scripts/score.js` is **`163c91b5…`** both before the mutation and after the
revert — byte-identical, with the full suite re-run green.

**Not done, deliberately.** No automated test asserts the semantic ladder — that is bead 02's `trust.js`
(the bead says so at §"Not covered"). §11's context-refresh list is not this bead's scope.
