[← INDEX](INDEX.md)

# Data Model

**There is no database, no ORM, and no persistence.** The "data model" here is the set of JSON
contracts passed between the components in one run — and, because nothing is schema-declared, the
**source of truth is the validators in code**. Change a shape there and every other file in this
document is wrong.

Six contracts:

| Contract | Producer → consumer | Source of truth |
|---|---|---|
| Agent output envelope (`candidates` / `gaps` / `blocked`) | subagent → skill → `report.js` stdin | [agents/deal-scout.md](../../agents/deal-scout.md) step 6; [report.js:35-46](../../scripts/report.js#L35-L46) |
| Candidate object | subagent → `score.js` | [`CANDIDATE_FIELDS`, score.js:54-69](../../scripts/score.js#L54-L69) |
| `history` sub-object | subagent → `history.js` | [`validate()`, history.js:71-87](../../scripts/history.js#L71-L87) |
| `trust` sub-object | subagent → `score.js` (**input**) and `trust.js` (**output**) | [`validTrust`, score.js:185-230](../../scripts/score.js#L185-L230), [`validate`, trust.js:123-150](../../scripts/trust.js#L123-L150) |
| Site adapter (`sites/*.json`) | author → `loadSites` | [`validateSites`, policy.js:206-288](../../scripts/policy.js#L206-L288) → see [site-adapters.md](site-adapters.md) |
| Browser registry (`browsers/*.json`) | author (and the guard) → `loadBrowsers` | fields `id`, `label`, `prefixes[]`, `allow[]`, `url_bearing[]`, `landing_check[]`, `notes[]` (`url_bearing` and `landing_check` must be subsets of `allow`); [`validateBrowsers`, policy.js:336-392](../../scripts/policy.js#L336-L392) |

## Candidate catalogue

Allowlist from [score.js:54-69](../../scripts/score.js#L54-L69). **Any field not in this table is
dropped** — emitting it is wasted effort (the agent prompt says so explicitly).

| Field | Type | Validated how | Notes |
|---|---|---|---|
| `title` | string | capped at `MAX_STRING_LENGTH` 300 **and PII-sanitized** | free text |
| `url` | string | must pass `checkUrl`; on failure set to `null` and recorded in `dropped_fields` | **the candidate is kept** — a bad link must not delete real data that came from an allowlisted page |
| `source` | string | capped, PII-sanitized | in practice: `"amazon-in"` \| `"flipkart"` \| `"<id>/cart"` \| `"<id>/wishlist"` \| `"<id>/saved"` |
| `product_key` | string | capped, PII-sanitized | sorted-token normalisation of brand+model+variant; equal keys == the same item across sites |
| `price` | number | finite, `0 ≤ price ≤ MAX_NUMBER` (10 000 000) | **required** — no usable `price` drops the whole candidate |
| `mrp` | number | bounded; out-of-range → dropped field | feeds `inflated_mrp` |
| `rating` | number | bounded; non-numeric → dropped field | |
| `review_count` | number | bounded; non-numeric → dropped field | feeds `low_reviews` and `rating_adj` |
| `third_party_seller` | boolean | must be boolean | agent's page-level judgement |
| `offers` | array of offer objects | see below; invalid → `[]` + recorded in `dropped_fields` | |
| `history` | object | see below; invalid → dropped field | the *raw* input shape, passed through untouched for `history.js` |
| `trust` | object | see below; invalid → dropped field, invalid **sub-keys** → dropped *and named* in `dropped_fields` | the *raw* input shape, passed through untouched for `trust.js` |
| `must_haves_met` | boolean | must be boolean | agent's judgement; **the sole must-haves gate input** |
| `must_haves_reason` | string | capped | deleted by `score.js` when `must_haves_met` is `true` |

Derived fields added by `score.js`, present on every surviving candidate: `index` (position in the
raw array), `effective_price`, `rating_adj`, `flags`, `dropped_fields`, and `score` (`null` for
candidates that failed the must-haves gate). The report also merges `price_history`
([report.js:49-53](../../scripts/report.js#L49-L53)) and `trust_assessment`
([report.js:52](../../scripts/report.js#L52)) onto each candidate.

### `offers[]`

`{ kind: "bank" | "coupon" | "exchange", amount: number, condition?: string }`
([score.js:124-134](../../scripts/score.js#L124-L134)). `OFFER_KINDS` is fixed at those three.
`condition` is only meaningful against `requirement.eligible_conditions`.

Semantics ([applyOffers, score.js:322-338](../../scripts/score.js#L322-L338)):
- **Non-stackable within a kind** — only the best offer of each kind counts.
- **Additive across kinds** — bank + coupon + exchange discounts sum.
- A conditional offer applies only if the user listed that condition.
- `effective_price = max(0, price − Σ best-per-kind)`, rounded to 2dp.
- `offer_implausible` when the combined discount exceeds the price **or** any single kind's alone
  does; the discount is then capped at the price.

### `history` (input shape)

`{ current: number, lowest: {price, date}, highest: {price, date}, average: number, points?: [{date, price}] }`
([history.js:71-87](../../scripts/history.js#L71-L87)).

- All four of `current`, `lowest`, `highest`, `average` are **required** — a partial result counts
  as no data (§3.4 step 4), so the agent omits `history` entirely rather than sending three fields.
- `date` accepts `YYYY-MM-DD` or `YYYYMMDD` ([parseYmd, history.js:43-51](../../scripts/history.js#L43-L51)).
- `points` is optional; if present it must be `≤ MAX_POINTS` (400) with every point well-formed —
  **one malformed point invalidates the whole array** and the candidate's `history` is skipped.
- Any validation failure has **one uniform outcome**: omit `history` for that candidate, produce no
  output, do not throw.
- No sanitizer and no string cap apply here — these are not free text, and an 8-digit compact date
  must survive the digit-run PII rules ([score.js:70-114](../../scripts/score.js#L70-L114)).

> ⚠️ **ASSUMPTION (from evidence, not code):** real history pages often expose a *30-day* average
> rather than an all-time average — `pricehistoryapp.com` does. The field name `average` does not
> encode which. If an adapter ships, decide the mapping deliberately
> ([evidence-04.txt](../../.beads/DS-1/evidence-04.txt)).

### `trust` (input shape)

`{ brand?: string, seller?: string, brand_store?: boolean, reviews_read?: number, verified_read?:
number, offsite?: { source: string, rating: number, count: number } }`
([validTrust, score.js:185-230](../../scripts/score.js#L185-L230)).

- **The object is the unit of "was this attempted".** An absent `trust`, or one that is not a plain
  object (`[]`, `"x"`), yields `trust_assessment: null` — *not attempted*. An object that survives
  validation but carries no usable fact (`{}`) reaches the engine and yields
  `brand_confidence: "none"` — *attempted, nothing justifying read*. The two are deliberately
  distinguishable; do not collapse them.
- Six permitted sub-keys (`TRUST_FIELDS`); any other key is dropped **and named** in
  `dropped_fields`, unlike `validHistory`, which silently ignores unknown keys.
- `brand` / `seller` are capped at `MAX_STRING_LENGTH` 300 **and PII-sanitized** — the first new
  free-text fields since DS-1, and the same scrubber applies to the engine's output `facts`.
- `reviews_read` / `verified_read` are non-negative integers `≤ MAX_REVIEWS_READ` (50). That bound
  lives in `score.js` beside `MAX_NUMBER` because the import direction is one-way.
- `verified_read > reviews_read` drops **the pair**, never corrects it — and drops nothing else. The
  engine enforces the same invariant on its own copy (`trust.js` reads the *raw* array, not
  `score.js`'s output), which is why the rule exists in both places.
- `offsite` is all-or-nothing: `source`, `rating` (`0…5`) and `count` must all be present and valid,
  or the whole sub-object is dropped. A partial off-site result is not weaker evidence, it is a
  different source than the id claims.
- `third_party_seller` is deliberately **not** duplicated inside `trust` — it stays the single
  top-level candidate field.

### `requirement` (skill-supplied, never agent-supplied)

`{ budget?: number, eligible_conditions?: string[], deadline?: "YYYY-MM-DD" }`
([score.js:397-404](../../scripts/score.js#L397-L404), [history.js:154-156](../../scripts/history.js#L154-L156)).
Arrives as `--requirement <json>`; **not** part of the agent's output. Absent keys are simply
absent — `{}` is valid and means "no budget, no conditions, no deadline".

## Report output shape

[`score()`](../../scripts/score.js#L477-L487) merged with history and trust by
[`buildReport()`](../../scripts/report.js#L35-L57):

| Key | Shape | Notes |
|---|---|---|
| `candidates` | candidate objects, **including must-haves-excluded ones** | each carries `price_history` (the `history.js` output, or `null`) and `trust_assessment` (the `trust.js` output, or `null`) |
| `best_product` | candidate \| `null` | must-haves gate only; ranked by score |
| `best_deal` | candidate \| `null` | must pass must-haves **and** `rating_adj ≥ MIN_RATING` **and** budget |
| `best_deal_message` | `"no qualifying deal found"` \| `null` | the reason for a null `best_deal` |
| `product_groups` | `[{ product_key, candidates: [index…] }]` | only groups with >1 member |
| `requirement` | `{ budget, eligible_conditions }` | echoed back for the reader; **`deadline` is not echoed** |
| `gaps` | string[] | ≤ 5 lines by prompt contract; not machine-capped |
| `blocked` | array | one entry per CAPTCHA/interstitial page |

## `history.js` output shape

[`analyze()`, history.js:198-207](../../scripts/history.js#L198-L207):

| Key | Values |
|---|---|
| `vs_average`, `vs_lowest` | percentages, 1dp |
| `typical_low_window` | `{ label: "confident" \| "low_confidence", months: number[] }` |
| `next_dip_estimate` | `{ month, year, confidence, sale_window, reason }` \| `null` |
| `verdict` | `"buy_now" \| "wait" \| "no_signal"` ([`VERDICTS`](../../scripts/history.js#L28)) |
| `reason` | plain-language string |
| `caveat` | the fixed `CAVEAT` string — estimates, not promises |

## `trust.js` output shape

[`analyze()`, trust.js:333-397](../../scripts/trust.js#L333-L397) — landed on the candidate as
`trust_assessment`, or `null`:

| Key | Values |
|---|---|
| `brand_confidence` | `"high" \| "medium" \| "low" \| "none"` ([`BRAND_CONFIDENCES`](../../scripts/trust.js#L27)) |
| `signals` | the fired subset of `SIGNALS`, in that fixed order, as **identifiers** |
| `facts` | `{ brand, seller, brand_store, reviews_read, verified_read }`, each `null` when not read |
| `peer` | `{ source, price_gap_pct, rating_gap }` for the compared listing on the other marketplace, or `null` |
| `offsite` | `{ source, rating, count, rating_gap }`, or `null` — always `null` today, since no review adapter ships |
| `reason` | plain-language string naming the supports or the discrediting signals |
| `caveat` | the fixed `CAVEAT` string — evidence, not proof |

`peer.source` is the **bare adapter id** (`sourceToBareId`), not the compound account-list form: a
wishlist item corroborated from the other marketplace still reports the marketplace, not the list it
came from. `facts` is the only path by which `trust.brand` / `trust.seller` reach the user, and it is
capped and sanitized on the way out ([trust.js:74-77](../../scripts/trust.js#L74-L77)) even though
it was already capped on the way in.

**No `trust.js` value ever moves a rank.** `trust_assessment` is computed from the raw array and
merged *after* `score()` has fixed `best_product` / `best_deal` / `product_groups`, which is what
keeps `W_PRICE` / `W_RATING` the only things that order the report.

## Enums & status lifecycles

| Enum | Values | Source |
|---|---|---|
| Adapter `kind` | `shop`, `history`, `review` | [policy.js:219-221](../../scripts/policy.js#L219-L221) |
| Allowed tools (per adapter) | `claude-in-chrome`: `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `read_page`, `get_page_text`, `find` — `chrome-devtools`: `list_pages`, `select_page`, `new_page`, `navigate_page`, `close_page`, `take_snapshot`, `wait_for` | [browsers/](../../browsers) (`allow` in each adapter) |
| `deny` vocabulary | `add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order` | [policy.js:29](../../scripts/policy.js#L29) |
| Offer kinds | `bank`, `coupon`, `exchange` | [score.js:74](../../scripts/score.js#L74) |
| Flags | `inflated_mrp`, `low_reviews`, `over_budget`, `third_party_seller`, `below_min_rating`, `offer_implausible` | [flagsFor, score.js:347-361](../../scripts/score.js#L347-L361) |
| Verdicts | `buy_now`, `wait`, `no_signal` | [history.js:28](../../scripts/history.js#L28) |
| Confidences | `high`, `medium`, `low`, `none` — "Do not add a fifth" | [history.js:31](../../scripts/history.js#L31) |
| `brand_confidence` | the same four values, but a **separate** enum with its own rules — see [trust.js:26-27](../../scripts/trust.js#L26-L27) | [BRAND_CONFIDENCES](../../scripts/trust.js#L27) |
| Signals | `brand_not_in_title`, `seller_third_party`, `price_undercut` (**discrediting**: cap the label at `low`) + `rating_disagrees`, `unverified_review_share`, `review_sample_too_small`, `no_brand_store`, `no_peer_site` (**informational**: never move it) | [SIGNALS, trust.js:30-39](../../scripts/trust.js#L30-L39), [DISCREDITING_SIGNALS, trust.js:45](../../scripts/trust.js#L45) |
| Gap types | free text, aggregable by type: `login_required`, `content-requires-click`, `no price history found`, … | [deal-scout.md](../../agents/deal-scout.md) step 6 |

`typical_low_window` is a two-state lifecycle (`low_confidence` → `confident`) requiring
**both** ≥ 2 distinct calendar years **and** ≥ `MIN_POINTS` (12) data points. Confidence on
`next_dip_estimate` is a four-state value derived from that label plus whether a sale window
overlaps ([confidenceFor, history.js:130-134](../../scripts/history.js#L130-L134)); the derivation
is pinned by tests rather than observed.

`brand_confidence` is a **four-rung ladder evaluated in a fixed order, and the order is the
contract** ([confidenceFor, trust.js:297-304](../../scripts/trust.js#L297-L304)): no evidence AND no
discrediting signal → `none`; then ≥ 2 supports → `high`; then exactly 1 support → `medium`;
otherwise `low`. Rung 0 is checked first on purpose — without it a listing carrying nothing usable
would match the final `low` and a *not-found* label would read as a *found-something-bad* one. Every
rung but the last carries an "and no discrediting signal" clause, so a fired `price_undercut` (or
either other discrediting signal) caps the result at `low` from anywhere.

## Persistence rules

- **Nothing is persisted.** No files, no local storage, no cache. The report exists only in the
  chat transcript. The skill does write the agent's stdout to a temporary file to pipe it into
  `report.js` — that is the only disk write in the flow, and it is transient.
- Artifacts that *are* version-controlled data: `sites/*.json`, `browsers/*.json`,
  `data/sale-calendar.json`. All three are edited by hand; none is generated.
- No soft delete, no audit columns, no optimistic locking — there is no store to have them.
