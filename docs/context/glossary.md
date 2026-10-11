[← INDEX](INDEX.md)

# Glossary

Terms as **this codebase** uses them. Identifier spellings are exact — grep them.

## Domain

| Term | Meaning | First seen in |
|---|---|---|
| **candidate** | one product under consideration, from the search or from the user's own lists. The unit that `score.js` validates and ranks | [score.js:54](../../scripts/score.js#L54) |
| **product_key** | sorted-token normalisation of brand + model + capacity/variant, lowercased and punctuation-stripped (`128gb-15-apple-blue-iphone`). Equal keys across sites == the same item | [deal-scout.md](../../agents/deal-scout.md) "worked example" |
| **source** | where a candidate came from: the bare adapter id (`"amazon-in"`) or the compound account-list form (`"amazon-in/cart"`, `"/wishlist"`, `"/saved"`) | [deal-scout.md](../../agents/deal-scout.md) step 1 |
| **bare id** | the part of `source` before the first `/`; what `covers` is matched against, and what a `trust` peer is keyed by | [sourceToBareId, policy.js:158](../../scripts/policy.js#L158) |
| **must-haves gate** | the single filter that excludes a candidate from `best_product` and `best_deal` when `must_haves_met !== true`. Fail-closed on an absent field | [passesMustHaves, score.js:307](../../scripts/score.js#L307) |
| **must_haves_reason** | the exclusion reason, present **only** when `must_haves_met` is `false`. Three forms: `failed: <x>`, `brand: <x>`, `unconfirmed: <x>`, joined by `"; "` in that priority order when several apply | [score.js:297](../../scripts/score.js#L297) |
| **effective_price** | `price` minus the best applicable offer per kind, floored at 0, rounded to 2dp. Drives the budget gate **and** the `over_budget` flag so the two can never disagree | [applyOffers, score.js:322](../../scripts/score.js#L322) |
| **rating_adj** | Bayesian-shrunk rating `(rating·n + PRIOR_MEAN·PRIOR_N) / (n + PRIOR_N)`; a thin review count is pulled toward the prior mean | [score.js:341](../../scripts/score.js#L341) |
| **flag** | one of `inflated_mrp`, `low_reviews`, `over_budget`, `third_party_seller`, `below_min_rating`, `offer_implausible` | [flagsFor, score.js:347](../../scripts/score.js#L347) |
| **best_product** | highest weighted score among candidates that pass the must-haves gate only | [score.js:452](../../scripts/score.js#L452) |
| **best_deal** | lowest `effective_price` among candidates passing must-haves **and** the rating floor **and** budget. May differ from `best_product` | [score.js:466](../../scripts/score.js#L466) |
| **offer condition** | the bank/card a conditional offer requires; unlocks only if the user listed it in `eligible_conditions` | [score.js:327](../../scripts/score.js#L327) |
| **offer_implausible** | the combined (or any single kind's) discount exceeds the price; discount is capped at the price | [score.js:334](../../scripts/score.js#L334) |

## Price history

| Term | Meaning | First seen in |
|---|---|---|
| **verdict** | one of `buy_now`, `wait`, `no_signal` — the advice the user acts on | [VERDICTS, history.js:28](../../scripts/history.js#L28) |
| **confidence** | one of `high`, `medium`, `low`, `none`. "Do not add a fifth" | [history.js:31](../../scripts/history.js#L31) |
| **typical_low_window** | months in which lows recur; label `confident` (≥2 distinct calendar years **and** ≥ `MIN_POINTS`) or `low_confidence` | [history.js:165](../../scripts/history.js#L165) |
| **lowest decile** | the cheapest 10% of data points, whose months form the confident window | [history.js:106](../../scripts/history.js#L106) |
| **next_dip_estimate** | the next occurrence of a typical-low month, plus the sale window overlapping it, or `null` | [history.js:176](../../scripts/history.js#L176) |
| **sale window** | an approximate Indian sale period from `data/sale-calendar.json`; overlapping one raises confidence | [history.js:168](../../scripts/history.js#L168) |
| **no_signal** | a **valid answer**, not a failure — thin, contradictory or single-year data. The point of R6 | [history.js:277](../../scripts/history.js#L277) |
| **caveat** | the fixed string every result carries: forecasts are estimates, not promises | [history.js:36](../../scripts/history.js#L36) |
| **MIN_POINTS** | 12 — below this, no pattern-dependent branch may fire (price-proximity still can) | [history.js:17](../../scripts/history.js#L17) |
| **BUY_WITHIN_PCT / IMPLAUSIBLE_BELOW_PCT** | 5% above the low counts as "at the low"; more than 20% *below* it reads as stale/corrupt | [history.js:23-26](../../scripts/history.js#L23-L26) |

## Brand authenticity

Two keys, deliberately not one. `trust` is what the **agent** read off the page; `trust_assessment`
is what `trust.js` **computed** from it. The two live side by side on a candidate so the computed
block never overwrites the evidence it was computed from.

| Term | Meaning | First seen in |
|---|---|---|
| **`trust`** | the **input** sub-object the agent emits: `brand`, `seller`, `brand_store`, `reviews_read`, `verified_read`, `offsite`. Validated by `score.js`, read raw by `trust.js` | [validTrust, score.js:185](../../scripts/score.js#L185) |
| **`trust_assessment`** | the **output** block `trust.js` computes, merged onto the candidate by `report.js` after ranking | [trust.js:383](../../scripts/trust.js#L383), [report.js:52](../../scripts/report.js#L52) |
| **`brand_confidence`** | one of `high`, `medium`, `low`, `none`. **Evidence, never a verdict** — the word "genuine" appears nowhere in the output, and the caveat says so | [BRAND_CONFIDENCES, trust.js:27](../../scripts/trust.js#L27) |
| **signal** | one of eight named observations, in a fixed order. Identifiers, never prose: the report renders them in words | [SIGNALS, trust.js:30](../../scripts/trust.js#L30) |
| **discrediting signal** | one of three — `brand_not_in_title`, `seller_third_party`, `price_undercut` — that **caps** the label at `low`. The other five are **informational** and never move it | [DISCREDITING_SIGNALS, trust.js:45](../../scripts/trust.js#L45) |
| **support** | one of two facts that justify the brand claim: `brand_store === true`, or a printed `seller` with `third_party_seller === false`. Both → `high`, exactly one → `medium`. Absence is "couldn't tell", never a support | [supportsFor, trust.js:225](../../scripts/trust.js#L225) |
| **peer** | a listing for the same `product_key` on a **different** site (bare adapter ids differ). The source of the cross-marketplace half of the check | [peerSets, trust.js:250](../../scripts/trust.js#L250) |
| **`facts`** | the block recording what was actually read (`brand`, `seller`, `brand_store`, `reviews_read`, `verified_read`), each `null` when not read. The only path by which the page's own text reaches the user | [trust.js:338-344](../../scripts/trust.js#L338-L344) |
| **`offsite`** | the third-party review source's `{ source, rating, count }`. Always `null` today — the `kind: "review"` adapter exists, none ships | [validOffsite, score.js:152](../../scripts/score.js#L152) |
| **`MIN_REVIEWS_READ`** | 4 — below this the sample itself is flagged (`review_sample_too_small`) and **no** share signal is computed either way | [trust.js:48](../../scripts/trust.js#L48) |
| **`UNDERCUT_PCT` / `RATING_GAP` / `UNVERIFIED_SHARE_MAX`** | 30% dearer on a peer reads as a suspiciously cheap listing; a 1.0-star gap on a peer or off-site source fires `rating_disagrees`; over half the read sample unverified fires `unverified_review_share` | [trust.js:51-57](../../scripts/trust.js#L51-L57) |
| **`CAVEAT` (trust)** | the fixed string every block carries: evidence, not proof — a listing can mimic every signal, and absence of a signal proves nothing | [trust.js:59](../../scripts/trust.js#L59) |
| **the null-vs-`none` split** | no `trust` input → `trust_assessment: null` (*not attempted*); an empty object → `brand_confidence: "none"` (*attempted, nothing justifying read*). The two must stay distinguishable | [trust.js:111-121](../../scripts/trust.js#L111-L121) |

## Security & policy

| Term | Meaning | First seen in |
|---|---|---|
| **guard** | `scripts/guard.js`, the hook that makes read-only mechanical | [guard.js](../../scripts/guard.js) |
| **agent_type scoping** | the guard acts only when `agent_type === AGENT_TYPE` (default `"claude-deal-scout:deal-scout"`); everything else is untouched, and the scope is checked *before* either registry loads | [guard.js:32](../../scripts/guard.js#L32), [:176](../../scripts/guard.js#L176) |
| **fail closed** | on any error, exit **2** — the only blocking exit code | [guard.js:181](../../scripts/guard.js#L181) |
| **adapter** | a `sites/*.json` file; `kind` is `shop`, `history` or `review` | [policy.js:219](../../scripts/policy.js#L219) |
| **browser registry** | one `browsers/*.json` file per browser: its tool `allow` set, plus which tools are `url_bearing` and which are landing-checked, keyed by that browser server's `prefixes`. **Two ship** — `claude-in-chrome` and `chrome-devtools` — and the guard allows the union | [validateBrowsers, policy.js:336](../../scripts/policy.js#L336), [browsers/](../../browsers) |
| **grant vs union** | the `tools:` frontmatter grant picks which browser the subagent *has*; the guard's allow set is the union of every loaded adapter, so it is the more permissive of the two | [security-and-permissions.md](security-and-permissions.md), [test/browser.test.js](../../test/browser.test.js) |
| **allow / deny** | `allow` = pathname regexes (the control); `deny` = word-boundary tokens (defence in depth) | [site-adapters.md](site-adapters.md) |
| **covers** | a **non-shop** adapter's (`history`, `review`) list of shop-adapter ids it can look up; unknown ids are a load error | [policy.js:254](../../scripts/policy.js#L254) |
| **adversarial path suite** | the 9 mutating paths a non-shop adapter's `allow` regexes are *run against* at load | [ADVERSARIAL_PATHS, policy.js:38](../../scripts/policy.js#L38) |
| **deny vocabulary** | the canonical 9 tokens (`add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order`) | [policy.js:29](../../scripts/policy.js#L29) |
| **gap** | something the agent could not read; capped at 5 lines, aggregated by type. Includes `login_required` and `content-requires-click`. **A missing `offsite` is not a gap** — a product with no off-site review source is normal | [deal-scout.md](../../agents/deal-scout.md) step 6 |
| **blocked** | one entry per CAPTCHA/interstitial page — a separate list from `gaps`, so it never competes for the 5-line budget | [deal-scout.md](../../agents/deal-scout.md) step 7 |
| **sanitizer** | the pattern-based PII scrubber over `title`, `source`, `product_key` — and over `trust.brand` / `trust.seller`, on both the input and the output path | [score.js:107](../../scripts/score.js#L107) |
| **R-number** | ⚠️ **overloaded**: `R1`–`R10` in the DS-1 plan §2 are *requirements*; `R1`–`R9` in that plan's §6 and `R1`–`R12` in SECURITY.md are *residual risks* | [conventions.md](conventions.md#comments) |
| **H-number** | a *hypothesis* the plan wrote down to be checked live. H1 (tools allowlist) passed, **for the `claude-in-chrome` grant only**. H2 (the navigate response carries the final URL) **failed for Claude in Chrome and holds for chrome-devtools** — its `navigate_page` and `list_pages` both embed the landed URL. H4 (no native-named tools) unverified. **H6/H7/H8 (the DS-3 live read of a product page and of review sites) were not settled** — the browser profile was unavailable, so the HTTP-level fallback was used and the limitation recorded | DS-1 plan §2, [DS-3 plan §7](../../docs/planning/DS-3-brand-authenticity-and-review-trust.md); [docs/SECURITY.md](../../docs/SECURITY.md) |

## Process

| Term | Meaning | First seen in |
|---|---|---|
| **DS-1 / DS-2 / DS-3** | this project's ticket ids, one per story; each is used in its branch name, commit scope, and docs. DS-1 built the plugin, DS-2 the browser registry, DS-3 the authenticity check | [CLAUDE.md](../../CLAUDE.md) |
| **bead** | one atomic unit of work with its own file under `.beads/{ticket-id}/br-{ticket-id}-<nn>-*.md`, one commit each | [CLAUDE.md](../../CLAUDE.md) |
| **br-DS-1-nn** | a bead id; referenced in commit messages | `git log` |
| **converged plan** | `docs/planning/DS-1-deal-scout-plugin.md` (the core design), plus `DS-2-*` and `DS-3-*` for their stories — each with a `status=converged` header. The source of truth for design | [docs/planning/](../../docs/planning/) |
| **negative control** | mutate a defence, confirm the test fails, revert. 14 specified, all 14 run | [DS-1 plan §5.4](../../docs/planning/DS-1-deal-scout-plugin.md), [DS-2 plan §5.4](../../docs/planning/DS-2-vendor-agnostic-browser-tools.md) and [DS-3 plan §5.4](../../docs/planning/DS-3-brand-authenticity-and-review-trust.md); [testing-and-quality.md](testing-and-quality.md#negative-controls-mutation-testing) |
| **evidence-NN.txt** | raw findings from a live check, under `.beads/{ticket-id}/` | [.beads/DS-1/evidence-04.txt](../../.beads/DS-1/evidence-04.txt), [.beads/DS-3/evidence-05.txt](../../.beads/DS-3/evidence-05.txt) |
