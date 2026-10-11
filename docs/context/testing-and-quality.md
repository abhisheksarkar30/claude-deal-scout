[← INDEX](INDEX.md)

# Testing & Quality

## Test frameworks in use

| Layer | Framework | Location | Evidence |
|---|---|---|---|
| unit + integration | `node:test` + `node:assert` (no framework, no mocks, no fixtures library) | `test/*.test.js` | [package.json](../../package.json) `"test": "node --test"` |
| policy matrix (in-product) | bespoke 60-case matrix inside the shipping script | `node scripts/guard.js selftest` | [SELFTEST_CASES, guard.js:195-291](../../scripts/guard.js#L195-L291) |
| live browser E2E | **none automated** — manual checklist. The guard *has* been driven live against a real MCP server (`chrome-devtools`) in both directions; a full `find-best-deal` run has not | [docs/SECURITY.md](../../docs/SECURITY.md) | plan §5.3 |

## Coverage

`npm test` → **176 tests, 176 pass, 0 fail**. Verified 2026-10-11 on
`feat/ds-3-brand-authenticity-and-review-trust`.

| File | Tests | Covers |
|---|---|---|
| [test/policy.test.js](../../test/policy.test.js) | 13 | the URL matrix (look-alike hosts, schemes, whitespace/control/backslash, length cap, allow + deny path sets, word-boundary deny semantics, adversarial-suite completeness), `checkTool` both directions (driven off the loaded registry, iterating each adapter's own prefixes), `sourceToBareId` |
| [test/browser.test.js](../../test/browser.test.js) | 13 | `browsers/*.json`, asserted **per adapter** rather than over the union: each shipped adapter's `allow` set, its `url_bearing` (where the two deliberately disagree), its `landing_check` (and that no page-reading tool is ever in it); a test that the subagent's `tools:` grant names exactly one shipped adapter's allow set; plus `url_bearing`/`landing_check ⊆ allow`, cross-file prefix and tool-name uniqueness, duplicate ids, prefix/bare-name shapes, and fail-closed on a missing or empty `browsers/` dir |
| [test/guard.test.js](../../test/guard.test.js) | 25 | spawns the **real script** via `child_process.spawnSync`: exit codes for garbage/empty/non-object stdin, unknown mode, broken `sites/` and `browsers/` dirs, scoping to other agents (plus the `DEAL_SCOUT_AGENT_TYPE` seam and the scope-before-load ordering), every dangerous tool bare and MCP-prefixed, URL checks, `navigate` without `url`, the `landing_check` gate, and every `post` behaviour |
| [test/adapter.test.js](../../test/adapter.test.js) | 15 | every shipped adapter loads; each `urls.*` template satisfies its own policy; overbroad-`allow` history adapter **rejected**; innocent history adapter **not** falsely rejected; unknown `covers` id rejected; empty `covers` rejected; the same four rules again for a synthetic `kind: "review"` adapter (loads; overbroad `allow` rejected; unknown `covers` id rejected; missing `urls.lookup` and empty `covers` rejected); duplicate ids, hostname shape, missing url templates, empty/malformed dir |
| [test/history.test.js](../../test/history.test.js) | 24 | every rung of the verdict ladder and its boundaries (4% vs 6% above the low, 5%-below and 25%-below cases), the confidence derivation, summary-only and single-year degradation, sparse-data gate, contradictory data, all three invalid-input skips, `analyzeAll` alignment, missing sale-calendar tolerance |
| [test/trust.test.js](../../test/trust.test.js) | 38 | every rung of the four-rung brand ladder and its boundaries (the `brand_store: true` + `third_party_seller: true` case that must be `low`, not `medium`; the rung-0 case that must be `low`, not `none`); each of the eight signals firing and not firing at its threshold; `DISCREDITING_SIGNALS` asserted to exclude `no_brand_store`; peer selection on bare adapter ids (a same-site duplicate is not a peer, a `source`-less candidate is excluded from grouping entirely); the `offsite` block; degradation (`trust` absent / `[]` / `"x"` → `null`, `verified_read > reviews_read` → pair dropped but the block returned); the exported knobs' defaults; `analyzeAll` index alignment |
| [test/score.test.js](../../test/score.test.js) | 40 | ranking formula and both degenerate dimensions, tie-breaks, offer eligibility/non-stacking/implausibility, budget gate agreeing with the rounded `effective_price`, `MIN_RATING` boundaries, must-haves gate fail-closed, field/cap/PII rules, `history` / `trust` / `must_haves_*` retention, the `trust` input's own validation (unknown sub-keys named in `dropped_fields`, the `verified_read ≤ reviews_read` invariant, `offsite` all-or-nothing, the non-object drop), and that the exported knobs still carry their plan-pinned defaults |
| [test/report.test.js](../../test/report.test.js) | 8 | the merged pipeline end to end without a browser: join on `index`, alignment when validation drops a candidate, `--requirement` reaching **both** scorers, a loud non-zero exit on malformed input, R5 — `report.js` resolves `sites/` and the calendar from its own location, not the cwd — and the DS-3 addition: a `trust_assessment` on every candidate **without moving the ranking** |

### Known gaps (explicit, not accidental)

- **Live browser E2E** — real DOM extraction, redirect discard, CAPTCHA stop, and "nothing was
  bought". Manual checklist only (plan §5.3). The `chrome-devtools` grant in particular has never
  been exercised this way: it needs a one-time sign-in in the profile that server launches.
- **Extraction quality** against the real Amazon.in / Flipkart / history-site DOM. These change
  without notice; the agent is designed to report a gap rather than guess.
- **Whether the subagent `tools:` allowlist honours MCP names** — checked live once (H1, passed),
  not covered by an automated test; the hook's default-deny is the backstop.
- **Dip-forecast accuracy** — the tests pin *behaviour on synthetic series*; they say nothing about
  whether a prediction is right (residual R6).
- **`MAX_SHORTLIST` = 5 products per site** — an LLM prompt instruction. No script reads it, no hook
  counts calls, no test can assert it. Deliberate soft cap; the residual is extra latency/cost.
- **`reviews_read` is a count the model produced.** No test can assert the agent counted *rendered*
  reviews rather than the listing's own claimed `review_count` — the same class of gap as
  `MAX_SHORTLIST`, and the one way the trust signals go wrong quietly. The prompt states the rule
  twice (`agents/deal-scout.md` step 3), `MIN_REVIEWS_READ` bounds the damage, and the signals are
  informational, so a wrong count cannot re-rank anything. It is not mechanically enforced.
- **Whether `brand_confidence` correlates with authenticity** — a rule over readable signals can be
  satisfied by a convincing counterfeit. Residual R12 in [docs/SECURITY.md](../../docs/SECURITY.md);
  not a testable property of this code.
- **H6, the extraction's central assumption** — whether an amazon.in product page exposes the brand
  attribute, a brand-storefront link, a "Sold by" seller and an inline review list **without a click**
  — **could not be live-checked** in the DS-3 story (the browser profile was unavailable; the recorded
  attempt is [.beads/DS-3/evidence-05.txt](../../.beads/DS-3/evidence-05.txt)). The code is correct
  either way and degrades to `none` when a field is absent, but the feature is partially inert until
  a human settles it on step 8 of the manual checklist.
- **No coverage tool, no lint, no format check, no type check, and no CI** — there is no `.github/`
  directory. Everything runs locally on demand.

## CI gates

**None.** There is no CI configuration in the repo, so nothing blocks a merge mechanically. The
de-facto gate before committing is `npm test` + `node scripts/guard.js selftest`.

## Negative controls (mutation testing)

Security tests are only meaningful if they fail when the defence is removed. Plan §5.4 specifies
**fourteen** mutation-and-revert controls (eight in the DS-1 plan, two more from DS-2, four more from
DS-3):

1. exact host match → `endsWith` — the `evilamazon.in` / `amazon.in.evil.com` cases must fail
2. remove the try/catch → exit 2 — the garbage-stdin test must fail
3. allow-regex check → deny-only — `/gp/cart/add.html` must fail
4. skip the per-candidate `checkUrl` in score.js — the dropped-URL test must fail
5. make `history.js` ignore `MIN_POINTS` — the sparse-data test must fail
6. disable the adversarial-suite check — the overbroad history adapter must now **load**
7. disable the `covers`-id check — the unknown-id adapter must now **load**
8. remove the `must_haves_reason` strip — the spurious-reason fixture must retain the field
9. revert the `landing_check` gate in `evaluatePost` (scan every matched `post` response again) — the `read_page` selftest row must fail
10. revert `validateBrowsers`' `landing_check ⊆ allow` check — `a landing_check entry must also be in allow` must fail
11. make `trust.js` ignore the sample floor (`MIN_REVIEWS_READ` → `0`) — the `review_sample_too_small` test and the "too small a sample yields no share signal" case must fail
12. remove the `verified_read ≤ reviews_read` check in `score.js`'s `validTrust` — the score-test's "drops the pair but keeps the candidate" case must fail
13. drop the bare-id `!==` in `trust.js`'s peer lookup (any same-`product_key` candidate counts, including one on the same site) — the "same site is not a peer" test and the `price_undercut` boundary test must fail
14. remove the "AND no discrediting signal" clause from rung 2 of the ladder — the `brand_store: true` + `third_party_seller: true` case must return `medium` instead of `low`

Controls 1–5, 8–14 flip pass → fail; 6–7 flip fail → pass.

**All fourteen were executed and reverted**, each flipping the test(s) named below, with `cmp` /
`git diff --stat` / `sha1sum` confirming the mutated file byte-identical afterwards. Two controls
deviate from the one-test-each pattern for the same structural reason — a single revert loop covers
two assertions: control 10 (`url_bearing` **and** `landing_check`) and control 11 (the signal test
**and** the knob-defaults test, whose failure is expected rather than a defect). The recorded
results:

| Control | Mutation | Test that failed | Record |
|---|---|---|---|
| 1 | host `===` → `endsWith` | `checkUrl denies hosts that are not exactly an adapter host` | [bead 02](../../.beads/DS-1/br-DS-1-02-policy-policy-and-shop-adapters.md) |
| 2 | `failClosed` → `return 0` | 5 fail-closed tests | [bead 03](../../.beads/DS-1/br-DS-1-03-guard-guard-hook.md) |
| 3 | allow check → `true` | `checkUrl denies mutating and account paths` (**on `/account/login`, not the plan's `/gp/cart/add.html`** — see below) | [bead 02](../../.beads/DS-1/br-DS-1-02-policy-policy-and-shop-adapters.md) |
| 4 | skip per-candidate `checkUrl` | `an off-allowlist url is dropped but the candidate is kept` | [bead 06](../../.beads/DS-1/br-DS-1-06-service-scoring.md) |
| 5 | `MIN_POINTS` 12 → 0 | the sparse-data gate test | [bead 05](../../.beads/DS-1/br-DS-1-05-service-history-verdict-engine.md) |
| 6 | disable adversarial-suite check | `a history adapter with an overbroad allow regex is rejected at load` | [bead 02](../../.beads/DS-1/br-DS-1-02-policy-policy-and-shop-adapters.md) |
| 7 | disable `covers`-id check | `a history adapter covering an unknown shop adapter id is rejected at load` | [bead 02](../../.beads/DS-1/br-DS-1-02-policy-policy-and-shop-adapters.md) |
| 8 | remove `must_haves_reason` strip | `a spurious must_haves_reason is stripped when must_haves_met is true` | [bead 06](../../.beads/DS-1/br-DS-1-06-service-scoring.md) |
| 9 | revert the `landing_check` gate in `evaluatePost` | `allow: a page-text tool response full of off-allowlist URLs is not scanned` (selftest row) | [bead 02](../../.beads/DS-2/br-DS-2-02-guard-config-driven-tool-policy.md) |
| 10 | revert `validateBrowsers`' `landing_check ⊆ allow` check | `a landing_check entry must also be in allow` **and** `a url_bearing entry must also be in allow` | [bead 01](../../.beads/DS-2/br-DS-2-01-policy-browsers-registry-and-loader.md) |
| 11 | `MIN_REVIEWS_READ` 4 → 0 | `review_sample_too_small fires below MIN_REVIEWS_READ`, `a sample below MIN_REVIEWS_READ yields no share signal either way`, **and** `the exported knobs carry their plan-pinned defaults` | [bead 02](../../.beads/DS-3/br-DS-3-02-service-trust-engine.md) |
| 12 | neutralize the pair check in `validTrust` | `a verified_read greater than reviews_read drops the pair but keeps the candidate` | [bead 01](../../.beads/DS-3/br-DS-3-01-data-trust-schema.md) |
| 13 | drop the bare-id guard in the peer lookup | `price_undercut fires at exactly UNDERCUT_PCT and not one point below`, `the same product on the same site is not a peer` | [bead 02](../../.beads/DS-3/br-DS-3-02-service-trust-engine.md) |
| 14 | remove rung 2's `&& !discrediting` | `a brand store plus a third-party seller yields low, not medium` | [bead 02](../../.beads/DS-3/br-DS-3-02-service-trust-engine.md) |

**Control 3's deviation is a finding, not a failure.** The plan expected a deny-only policy to let
`/gp/cart/add.html` through. It does not — deny tokens match at a word boundary, so `add` alone
already catches `add.html`. The defence is therefore *stronger* than §5.4 assumed, and the control
had to flip on `/account/login`, a path **only** the allowlist denies. Read this before "simplifying"
`allow` on the strength of the deny list.

**Controls 11 and 13 are a second finding of the same class — the fixture, not the defence.** The
review-sample fixtures were first written as `reviews_read: MIN_REVIEWS_READ - 1`, which moves *with*
the knob, so mutating the knob changed nothing behavioural and only the knob assertion caught it; they
are now literal (`3`, and the floor itself at `4`). The `price_undercut` boundary case originally used
two cross-site candidates, which control 13 cannot disturb, so it was given a same-site decoy. **A
control that only fails on the knob assertion is not testing the rule** — the bead's Review Notes
record both tightenings. This is the same lesson as control 3: an executed control tells you about the
test as much as about the defence.

Two rules have positive tests but **no** mutation control: the `post` redirect block, and
"URL-bearing tool with no `url` ⇒ exit 2" ([bead 03](../../.beads/DS-1/br-DS-1-03-guard-guard-hook.md)
observation 3). Neither was reported as hard to pin; the gap is deliberate rather than an oversight.

## Quality conventions that the tests encode

- Test names are behavioural sentences including the negative case — see
  [conventions.md](conventions.md#testing-conventions).
- Assertions are on **exact values derived from the documented formula/spec**, not on observed
  behaviour — e.g. the ranking fixture computes the expected score from
  `W_PRICE × price_score + W_RATING × rating_score` rather than recording what the code happened to
  produce.
- `test/score.test.js` pins the **exported knobs' default values** so a silent retune is caught —
  and `test/trust.test.js` does the same for `trust.js`'s knobs.
- `test/adapter.test.js` iterates `sites/`, so a new adapter is covered without a new test.
