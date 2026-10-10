[← INDEX](INDEX.md)

# Data Model

**There is no database, no ORM, and no persistence.** The "data model" here is the set of JSON
contracts passed between the components in one run — and, because nothing is schema-declared, the
**source of truth is the validators in code**. Change a shape there and every other file in this
document is wrong.

Five contracts:

| Contract | Producer → consumer | Source of truth |
|---|---|---|
| Agent output envelope (`candidates` / `gaps` / `blocked`) | subagent → skill → `report.js` stdin | [agents/deal-scout.md](../../agents/deal-scout.md) step 5; [report.js:34-49](../../scripts/report.js#L34-L49) |
| Candidate object | subagent → `score.js` | [`CANDIDATE_FIELDS`, score.js:44-58](../../scripts/score.js#L44-L58) |
| `history` sub-object | subagent → `history.js` | [`validate()`, history.js:71-87](../../scripts/history.js#L71-L87) |
| Site adapter (`sites/*.json`) | author → `loadSites` | [`validateSites`, policy.js:205-280](../../scripts/policy.js#L205-L280) → see [site-adapters.md](site-adapters.md) |
| Browser registry (`browsers/*.json`) | author (and the guard) → `loadBrowsers` | fields `id`, `label`, `prefixes[]`, `allow[]`, `url_bearing[]`, `landing_check[]`, `notes[]` (`url_bearing` and `landing_check` must be subsets of `allow`); [`validateBrowsers`, policy.js:328-384](../../scripts/policy.js#L328-L384) |

## Candidate catalogue

Allowlist from [score.js:44-58](../../scripts/score.js#L44-L58). **Any field not in this table is
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
| `must_haves_met` | boolean | must be boolean | agent's judgement; **the sole must-haves gate input** |
| `must_haves_reason` | string | capped | deleted by `score.js` when `must_haves_met` is `true` |

Derived fields added by `score.js`, present on every surviving candidate: `index` (position in the
raw array), `effective_price`, `rating_adj`, `flags`, `dropped_fields`, and `score` (`null` for
candidates that failed the must-haves gate). The report also merges `price_history` onto each
candidate ([report.js:42-46](../../scripts/report.js#L42-L46)).

### `offers[]`

`{ kind: "bank" | "coupon" | "exchange", amount: number, condition?: string }`
([score.js:113-123](../../scripts/score.js#L113-L123)). `OFFER_KINDS` is fixed at those three.
`condition` is only meaningful against `requirement.eligible_conditions`.

Semantics ([applyOffers, score.js:217-233](../../scripts/score.js#L217-L233)):
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
  must survive the digit-run PII rules ([score.js:74-103](../../scripts/score.js#L74-L103)).

> ⚠️ **ASSUMPTION (from evidence, not code):** real history pages often expose a *30-day* average
> rather than an all-time average — `pricehistoryapp.com` does. The field name `average` does not
> encode which. If an adapter ships, decide the mapping deliberately
> ([evidence-04.txt](../../.beads/DS-1/evidence-04.txt)).

### `requirement` (skill-supplied, never agent-supplied)

`{ budget?: number, eligible_conditions?: string[], deadline?: "YYYY-MM-DD" }`
([score.js:292-299](../../scripts/score.js#L292-L299), [history.js:154-156](../../scripts/history.js#L154-L156)).
Arrives as `--requirement <json>`; **not** part of the agent's output. Absent keys are simply
absent — `{}` is valid and means "no budget, no conditions, no deadline".

## Report output shape

[`score()`](../../scripts/score.js#L372-L382) merged with history by
[`buildReport()`](../../scripts/report.js#L34-L50):

| Key | Shape | Notes |
|---|---|---|
| `candidates` | candidate objects, **including must-haves-excluded ones** | each carries `price_history` (the `history.js` output, or `null`) |
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

## Enums & status lifecycles

| Enum | Values | Source |
|---|---|---|
| Adapter `kind` | `shop`, `history` | [policy.js:218](../../scripts/policy.js#L218) |
| Allowed tools | `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `read_page`, `get_page_text`, `find` | [browsers/claude-in-chrome.json](../../browsers/claude-in-chrome.json) (`allow`) |
| `deny` vocabulary | `add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order` | [policy.js:29](../../scripts/policy.js#L29) |
| Offer kinds | `bank`, `coupon`, `exchange` | [score.js:63](../../scripts/score.js#L63) |
| Flags | `inflated_mrp`, `low_reviews`, `over_budget`, `third_party_seller`, `below_min_rating`, `offer_implausible` | [flagsFor, score.js:242-256](../../scripts/score.js#L242-L256) |
| Verdicts | `buy_now`, `wait`, `no_signal` | [history.js:28](../../scripts/history.js#L28) |
| Confidences | `high`, `medium`, `low`, `none` — "Do not add a fifth" | [history.js:31](../../scripts/history.js#L31) |
| Gap types | free text, aggregable by type: `login_required`, `content-requires-click`, `no price history found`, … | [deal-scout.md](../../agents/deal-scout.md) step 5 |

`typical_low_window` is a two-state lifecycle (`low_confidence` → `confident`) requiring
**both** ≥ 2 distinct calendar years **and** ≥ `MIN_POINTS` (12) data points. Confidence on
`next_dip_estimate` is a four-state value derived from that label plus whether a sale window
overlaps ([confidenceFor, history.js:130-134](../../scripts/history.js#L130-L134)); the derivation
is pinned by tests rather than observed.

## Persistence rules

- **Nothing is persisted.** No files, no local storage, no cache. The report exists only in the
  chat transcript. The skill does write the agent's stdout to a temporary file to pipe it into
  `report.js` — that is the only disk write in the flow, and it is transient.
- Artifacts that *are* version-controlled data: `sites/*.json`, `browsers/*.json`,
  `data/sale-calendar.json`. All three are edited by hand; none is generated.
- No soft delete, no audit columns, no optimistic locking — there is no store to have them.
