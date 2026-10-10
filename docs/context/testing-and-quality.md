[← INDEX](INDEX.md)

# Testing & Quality

## Test frameworks in use

| Layer | Framework | Location | Evidence |
|---|---|---|---|
| unit + integration | `node:test` + `node:assert` (no framework, no mocks, no fixtures library) | `test/*.test.js` | [package.json](../../package.json) `"test": "node --test"` |
| policy matrix (in-product) | bespoke 60-case matrix inside the shipping script | `node scripts/guard.js selftest` | [SELFTEST_CASES, guard.js:195-291](../../scripts/guard.js#L195-L291) |
| live browser E2E | **none automated** — manual checklist. The guard *has* been driven live against a real MCP server (`chrome-devtools`) in both directions; a full `find-best-deal` run has not | [docs/SECURITY.md](../../docs/SECURITY.md) | plan §5.3 |

## Coverage

`npm test` → **123 tests, 123 pass, 0 fail**. Verified 2026-10-11 on
`feat/ds-2-vendor-agnostic-browser-tools`.

| File | Tests | Covers |
|---|---|---|
| [test/policy.test.js](../../test/policy.test.js) | 13 | the URL matrix (look-alike hosts, schemes, whitespace/control/backslash, length cap, allow + deny path sets, word-boundary deny semantics, adversarial-suite completeness), `checkTool` both directions (driven off the loaded registry, iterating each adapter's own prefixes), `sourceToBareId` |
| [test/browser.test.js](../../test/browser.test.js) | 13 | `browsers/*.json`, asserted **per adapter** rather than over the union: each shipped adapter's `allow` set, its `url_bearing` (where the two deliberately disagree), its `landing_check` (and that no page-reading tool is ever in it); a test that the subagent's `tools:` grant names exactly one shipped adapter's allow set; plus `url_bearing`/`landing_check ⊆ allow`, cross-file prefix and tool-name uniqueness, duplicate ids, prefix/bare-name shapes, and fail-closed on a missing or empty `browsers/` dir |
| [test/guard.test.js](../../test/guard.test.js) | 25 | spawns the **real script** via `child_process.spawnSync`: exit codes for garbage/empty/non-object stdin, unknown mode, broken `sites/` and `browsers/` dirs, scoping to other agents (plus the `DEAL_SCOUT_AGENT_TYPE` seam and the scope-before-load ordering), every dangerous tool bare and MCP-prefixed, URL checks, `navigate` without `url`, the `landing_check` gate, and every `post` behaviour |
| [test/adapter.test.js](../../test/adapter.test.js) | 10 | every shipped adapter loads; each `urls.*` template satisfies its own policy; overbroad-`allow` history adapter **rejected**; innocent history adapter **not** falsely rejected; unknown `covers` id rejected; empty `covers` rejected; duplicate ids, hostname shape, missing url templates, empty/malformed dir |
| [test/history.test.js](../../test/history.test.js) | 24 | every rung of the verdict ladder and its boundaries (4% vs 6% above the low, 5%-below and 25%-below cases), the confidence derivation, summary-only and single-year degradation, sparse-data gate, contradictory data, all three invalid-input skips, `analyzeAll` alignment, missing sale-calendar tolerance |
| [test/score.test.js](../../test/score.test.js) | 32 | ranking formula and both degenerate dimensions, tie-breaks, offer eligibility/non-stacking/implausibility, budget gate agreeing with the rounded `effective_price`, `MIN_RATING` boundaries, must-haves gate fail-closed, field/cap/PII rules, `history` and `must_haves_*` retention, and that the exported knobs still carry their plan-pinned defaults |
| [test/report.test.js](../../test/report.test.js) | 6 | the merged pipeline end to end without a browser: join on `index`, alignment when validation drops a candidate, `--requirement` reaching **both** scorers, a loud non-zero exit on malformed input, and R5 — `report.js` resolves `sites/` and the calendar from its own location, not the cwd |

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
- **No coverage tool, no lint, no format check, no type check, and no CI** — there is no `.github/`
  directory. Everything runs locally on demand.

## CI gates

**None.** There is no CI configuration in the repo, so nothing blocks a merge mechanically. The
de-facto gate before committing is `npm test` + `node scripts/guard.js selftest`.

## Negative controls (mutation testing)

Security tests are only meaningful if they fail when the defence is removed. Plan §5.4 specifies
**ten** mutation-and-revert controls (the first eight in the DS-1 plan, two more added by DS-2):

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

Controls 1–5, 8, 9 and 10 flip pass → fail; 6–7 flip fail → pass.

**All ten were executed and reverted**, each flipping the test(s) named below, with `cmp` /
`git diff --stat` confirming the mutated file byte-identical afterwards. Control 10 is the one
deviation from the one-test-each pattern: its revert is the single loop covering both `url_bearing`
and `landing_check`, so it flips two tests — the same kind of finding recorded under control 3. The
recorded results:

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

**Control 3's deviation is a finding, not a failure.** The plan expected a deny-only policy to let
`/gp/cart/add.html` through. It does not — deny tokens match at a word boundary, so `add` alone
already catches `add.html`. The defence is therefore *stronger* than §5.4 assumed, and the control
had to flip on `/account/login`, a path **only** the allowlist denies. Read this before "simplifying"
`allow` on the strength of the deny list.

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
- `test/score.test.js` pins the **exported knobs' default values** so a silent retune is caught.
- `test/adapter.test.js` iterates `sites/`, so a new adapter is covered without a new test.
