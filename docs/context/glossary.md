[← INDEX](INDEX.md)

# Glossary

Terms as **this codebase** uses them. Identifier spellings are exact — grep them.

## Domain

| Term | Meaning | First seen in |
|---|---|---|
| **candidate** | one product under consideration, from the search or from the user's own lists. The unit that `score.js` validates and ranks | [score.js:44](../../scripts/score.js#L44) |
| **product_key** | sorted-token normalisation of brand + model + capacity/variant, lowercased and punctuation-stripped (`128gb-15-apple-blue-iphone`). Equal keys across sites == the same item | [deal-scout.md](../../agents/deal-scout.md) "worked example" |
| **source** | where a candidate came from: the bare adapter id (`"amazon-in"`) or the compound account-list form (`"amazon-in/cart"`, `"/wishlist"`, `"/saved"`) | [deal-scout.md](../../agents/deal-scout.md) step 1 |
| **bare id** | the part of `source` before the first `/`; what `covers` is matched against | [sourceToBareId, policy.js:157](../../scripts/policy.js#L157) |
| **must-haves gate** | the single filter that excludes a candidate from `best_product` and `best_deal` when `must_haves_met !== true`. Fail-closed on an absent field | [passesMustHaves, score.js:202](../../scripts/score.js#L202) |
| **must_haves_reason** | the exclusion reason, present **only** when `must_haves_met` is `false`. Three forms: `failed: <x>`, `brand: <x>`, `unconfirmed: <x>`, joined by `"; "` in that priority order when several apply | [score.js:192](../../scripts/score.js#L192) |
| **effective_price** | `price` minus the best applicable offer per kind, floored at 0, rounded to 2dp. Drives the budget gate **and** the `over_budget` flag so the two can never disagree | [applyOffers, score.js:217](../../scripts/score.js#L217) |
| **rating_adj** | Bayesian-shrunk rating `(rating·n + PRIOR_MEAN·PRIOR_N) / (n + PRIOR_N)`; a thin review count is pulled toward the prior mean | [score.js:236](../../scripts/score.js#L236) |
| **flag** | one of `inflated_mrp`, `low_reviews`, `over_budget`, `third_party_seller`, `below_min_rating`, `offer_implausible` | [flagsFor, score.js:242](../../scripts/score.js#L242) |
| **best_product** | highest weighted score among candidates that pass the must-haves gate only | [score.js:328](../../scripts/score.js#L328) |
| **best_deal** | lowest `effective_price` among candidates passing must-haves **and** the rating floor **and** budget. May differ from `best_product` | [score.js:357](../../scripts/score.js#L357) |
| **offer condition** | the bank/card a conditional offer requires; unlocks only if the user listed it in `eligible_conditions` | [score.js:222](../../scripts/score.js#L222) |
| **offer_implausible** | the combined (or any single kind's) discount exceeds the price; discount is capped at the price | [score.js:229](../../scripts/score.js#L229) |

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

## Security & policy

| Term | Meaning | First seen in |
|---|---|---|
| **guard** | `scripts/guard.js`, the hook that makes read-only mechanical | [guard.js](../../scripts/guard.js) |
| **agent_type scoping** | the guard acts only when `agent_type === AGENT_TYPE` (default `"claude-deal-scout:deal-scout"`); everything else is untouched, and the scope is checked *before* either registry loads | [guard.js:32](../../scripts/guard.js#L32), [:176](../../scripts/guard.js#L176) |
| **fail closed** | on any error, exit **2** — the only blocking exit code | [guard.js:181](../../scripts/guard.js#L181) |
| **adapter** | a `sites/*.json` file; `kind` is `shop` or `history` | [policy.js:218](../../scripts/policy.js#L218) |
| **browser registry** | a `browsers/*.json` file: the tool `allow` set, plus which tools are `url_bearing` and which are landing-checked, keyed by the browser server's `prefixes` | [validateBrowsers, policy.js:328](../../scripts/policy.js#L328) |
| **allow / deny** | `allow` = pathname regexes (the control); `deny` = word-boundary tokens (defence in depth) | [site-adapters.md](site-adapters.md) |
| **covers** | a history adapter's list of shop-adapter ids it can look up; unknown ids are a load error | [policy.js:248](../../scripts/policy.js#L248) |
| **adversarial path suite** | the 9 mutating paths a history adapter's `allow` regexes are *run against* at load | [ADVERSARIAL_PATHS, policy.js:37](../../scripts/policy.js#L37) |
| **deny vocabulary** | the canonical 9 tokens (`add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order`) | [policy.js:29](../../scripts/policy.js#L29) |
| **gap** | something the agent could not read; capped at 5 lines, aggregated by type. Includes `login_required` and `content-requires-click` | [deal-scout.md](../../agents/deal-scout.md) step 5 |
| **blocked** | one entry per CAPTCHA/interstitial page — a separate list from `gaps`, so it never competes for the 5-line budget | [deal-scout.md](../../agents/deal-scout.md) step 6 |
| **sanitizer** | the pattern-based PII scrubber over `title`, `source`, `product_key` | [score.js:96](../../scripts/score.js#L96) |
| **R-number** | ⚠️ **overloaded**: `R1`–`R10` in plan §2 are *requirements*; `R1`–`R9` in plan §6 and `R1`–`R11` in SECURITY.md are *residual risks* | [conventions.md](conventions.md#comments) |
| **H-number** | a *hypothesis* the plan wrote down to be checked live. H1 (tools allowlist) passed, H2 (navigate's response carries the final URL) **failed**, H4 (no native-named tools) unverified | plan §2; [docs/SECURITY.md](../../docs/SECURITY.md) |

## Process

| Term | Meaning | First seen in |
|---|---|---|
| **DS-1** | this project's ticket id; used in branch name, commit scope, and docs | [CLAUDE.md](../../CLAUDE.md) |
| **bead** | one atomic unit of work with its own file under `.beads/DS-1/br-DS-1-<nn>-*.md`, one commit each | [CLAUDE.md](../../CLAUDE.md) |
| **br-DS-1-nn** | a bead id; referenced in commit messages | `git log` |
| **converged plan** | `docs/planning/DS-1-deal-scout-plugin.md`, header `status=converged` — the source of truth for design | [plan](../../docs/planning/DS-1-deal-scout-plugin.md) |
| **negative control** | mutate a defence, confirm the test fails, revert. 10 specified, all 10 run | [plan §5.4](../../docs/planning/DS-1-deal-scout-plugin.md) and [DS-2 plan §5.4](../../docs/planning/DS-2-vendor-agnostic-browser-tools.md); [testing-and-quality.md](testing-and-quality.md#negative-controls-mutation-testing) |
| **evidence-NN.txt** | raw findings from a live check, under `.beads/DS-1/` | [evidence-04.txt](../../.beads/DS-1/evidence-04.txt) |
