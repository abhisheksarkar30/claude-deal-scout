[← INDEX](INDEX.md)

# Site Adapters & Sale Calendar

This module exists because the catalog had no slot for a **config-driven adapter registry**, and it
is the plugin's main extension point: **adding a site is adding a file, never a code change.** The
prose version for a human author is [README.md § Adding a site](../../README.md); this is the
agent-facing, code-accurate version.

Source of truth: [`loadSites` / `validateSites`, policy.js:206-306](../../scripts/policy.js#L206-L306).
A `sites/*.json` file that fails any rule makes the guard **fail closed** — the run stops rather
than proceeding with a policy that is not what you think it is.

## The registry

| Aspect | Behaviour | Evidence |
|---|---|---|
| Location | `sites/*.json`, read by `loadSites(dir)`; only files ending `.json` are read | [policy.js:292](../../scripts/policy.js#L292) |
| Order | filenames sorted before load (deterministic) | [policy.js:292](../../scripts/policy.js#L292) |
| Directory override | `DEAL_SCOUT_SITES_DIR` — **test seam only** | [guard.js:57](../../scripts/guard.js#L57) |
| Empty/malformed dir | throws → guard exits 2 | [policy.js:293](../../scripts/policy.js#L293), [test/adapter.test.js](../../test/adapter.test.js) |
| Duplicate `id` | rejected, naming both files | [policy.js:218](../../scripts/policy.js#L218) |
| Host claimed by 2 adapters | first matching adapter in load order wins | [policy.js:154](../../scripts/policy.js#L154) |
| Consumed by | `guard.js pre`/`post` (enforcement) **and** `score.js` (re-validates every URL in the report) | [guard.js:317](../../scripts/guard.js#L317), [score.js:289](../../scripts/score.js#L289) |

## Adapter schema

Three `kind`s share most fields. Full validator: [policy.js:212-275](../../scripts/policy.js#L212-L275).

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | ✅ | non-empty, unique across all files; the value `covers` and `source` refer to |
| `kind` | `"shop"` \| `"history"` \| `"review"` | ✅ | anything else rejected |
| `label` | string | ✅ | display name |
| `hosts` | string[] | ✅ | **bare lowercase hostnames** — no scheme, port, path, whitespace or uppercase (`^[a-z0-9]…(\.[a-z0-9]…)+$`); no duplicates |
| `allow` | string[] | ✅ | non-empty, every entry must compile as a RegExp; matched against the **pathname only** |
| `deny` | string[] | — | tokens matched at a **word boundary** against the pathname |
| `urls` | object | ✅ | every value a non-empty string; required keys depend on `kind` (below) |
| `notes` | string[] | — | free text for the next reader |
| `covers` | string[] | ✅ for `history` and `review` | non-empty; each entry must be a **loaded shop adapter `id`** |

Required `urls` keys: [`REQUIRED_URLS`](../../scripts/policy.js#L196)

| `kind` | Required keys |
|---|---|
| `shop` | `search`, `cart`, `wishlist` |
| `history` | `lookup` |
| `review` | `lookup` |

Extra `urls` keys are allowed (that is how `saved` is expressed). Optional `urls` keys are not
otherwise validated beyond being non-empty strings — so `saved` on both shipped shop adapters is
effectively a *documented convention*, not a schema requirement.

### How a URL is checked

[`checkUrl`, policy.js:125-155](../../scripts/policy.js#L125-L155). All of these must hold:

1. ≤ `MAX_URL_LENGTH` (2048) characters.
2. No whitespace, ASCII control chars or backslash **in the raw string**.
3. Parses as an absolute URL; protocol is exactly `https:`.
4. No username/password; port empty or `443`.
5. No trailing dot on the host.
6. Host matches an adapter host **exactly** (lowercased). Never suffix, never substring — which is
   what defeats `evilamazon.in`, `amazon.in.evil.com`, `amazon.in@evil.com`, IDN look-alikes
   (they normalise to `xn--…`) and IP literals alike.
7. Pathname matches **some** `allow` regex on a host-matching adapter, and **no** `deny` token on
   that adapter.

So: `allow` is the control; `deny` is defence in depth. An unknown path is denied by omission.

### `deny` semantics

- Tokens are matched against the **pathname** at a word boundary `(?![A-Za-z0-9_-])`, so `add`
  catches `/gp/cart/add.html` but not `/product/address-guide`. A token ending in `/` (e.g. `/ap/`)
  carries its own boundary and is matched verbatim ([denyPattern, policy.js:104-107](../../scripts/policy.js#L104-L107)).
- The canonical vocabulary is [`DENY_VOCABULARY`](../../scripts/policy.js#L29):
  `add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order`.
- A token **not** in the vocabulary is still accepted — a boundary-anchored regex is compiled on
  the fly for it. The vocabulary list exists to drive the adversarial suite, not to restrict authors.

### The two load-time rejections for non-shop adapters

[policy.js:253-266](../../scripts/policy.js#L253-L266). Both apply to **every** non-shop kind
(`history` and `review`) through one `if (kind !== 'shop')` block, so adding a kind adds no guarantee
the codebase does not already enforce.

1. **No account or mutation paths.** Every `allow` regex is **run against**
   [`ADVERSARIAL_PATHS`](../../scripts/policy.js#L38-L48) (`/add`, `/buy/confirm`, `/checkout`,
   `/signin`, `/ap/signin`, `/gp/css/order`, `/payment/result`, `/address/select`,
   `/order/details`). If any matches, the adapter is rejected. This is behavioural, not
   source inspection — an innocent pattern is not rejected merely for containing a word like
   `address`. `test/adapter.test.js` pins both directions for `history`
   ([test/adapter.test.js:94-116](../../test/adapter.test.js#L94-L116)) and the rejection again for a
   synthetic `review` adapter ([:143-146](../../test/adapter.test.js#L143-L146)).
2. **`covers` must name loaded shop adapters.** A typo is a load error, not a silently dead lookup.
   The gate that is easy to miss is at [policy.js:277-285](../../scripts/policy.js#L277-L285): a
   `continue` for `shop` keeps the check from running for a kind the loader did not put in its shops
   list.

## Shipped adapters (2 files, both `shop`)

`loadSites` reads `sites/`, and `sites/` holds two files — both `shop`. The `history` and `review`
kinds are implemented and tested, but no adapter of either kind ships (below).

| File | id | hosts | `allow` |
|---|---|---|---|
| [sites/amazon-in.json](../../sites/amazon-in.json) | `amazon-in` | `www.amazon.in`, `amazon.in` | `^/s$`, `^/dp/[A-Z0-9]{10}$`, `^/gp/cart/view\.html$`, `^/hz/wishlist/ls(/.*)?$` |
| [sites/flipkart.json](../../sites/flipkart.json) | `flipkart` | `www.flipkart.com`, `flipkart.com` | `^/search$`, `^/[^/]+/p/[a-zA-Z0-9]+$`, `^/viewcart$`, `^/wishlist$` |

Both carry the full nine-token `deny` list, and both point `urls.saved` at their cart URL
(saved-for-later renders on / below the cart).

**Documented unknowns in the shipped adapters** (from their own `notes`):

- Flipkart `saved` is a **guess** — where saved-for-later lives was never verified, because the test
  cart was empty. Flipkart's `/viewcart` and `/wishlist` *were* verified against a logged-in
  session on 2026-10-09, and the cart page rendered no text to `read_page`/`get_page_text` for
  several seconds (client-rendered), so extraction there is unproven
  ([sites/flipkart.json](../../sites/flipkart.json) `notes`;
  the session record lives in bead [br-DS-1-02/03](../../.beads/DS-1/br-DS-1-02-policy-policy-and-shop-adapters.md)
  and [evidence-03.txt](../../.beads/DS-1/evidence-03.txt)).
- Amazon.in `saved` is legitimately the cart URL — not an unknown.

> ❓ **UNVERIFIED:** the source-to-bare-id rule the agent uses to match `covers`
> (`"amazon-in/cart"` → `"amazon-in"`, [sourceToBareId](../../scripts/policy.js#L158-L160)) is unit
> tested but has never been exercised against a real history or review adapter, because none ships.

## The `review` kind (landed, unused)

DS-3 added a third `kind` so an off-site review source is a **file, not a code change** — the same
promise the other two kinds make. It is fully wired: `REQUIRED_URLS`, the schema table above, the
adversarial-suite rejection and the `covers`-id check all handle it, and the agent's step 5 walks it
exactly as step 4 walks history. What it is *not* is shipped.

| Aspect | Behaviour |
|---|---|
| Lookup | `urls.lookup`, built from the product's public, query-stripped URL or title — same rule as history |
| What the agent reads | the source's **rating and review count, as text, without a click**; it lands in `trust.offsite` as `{ source, rating, count }` |
| If unusable | `offsite` is omitted, and **no gap note is added** — a product having no off-site review source is normal, not a gap |
| If none ships | the block is simply absent everywhere and the assessment degrades to the page plus the cross-marketplace peer |

Every `urls.lookup` on such an adapter is expressed as an id or title, never as anything read from an
account page — the same rule the history kind carries, and the reason the adapter may not reach
account paths at all.

## No history or review adapter ships today

`loadSites` returns the two shop adapters and nothing else, which makes **R10 (price history) inert
end to end** — see [architecture.md](architecture.md#known-structural-gaps) and
[workflows.md](workflows.md#6-price-history-verdict).

The survey and its reasoning live in [.beads/DS-1/evidence-04.txt](../../.beads/DS-1/evidence-04.txt).
Compressed:

| Site | State |
|---|---|
| `pricehistoryapp.com` | **Data passes** (all four values as readable text, no click needed, robots permits product pages) but **lookup fails** — the product page is `/product/<site-internal-slug>` and the only search form is client-side JS. No template can be built from an amazon.in URL or a title. |
| `pricebefore.com` | Excluded — has a GET `/search/`, but `robots.txt` disallows `/search/`. Respecting bot signals is R7. |
| `smartprix.com` | Excluded — plain GET returns 403 (bot protection). |
| `buyhatke.com` | Best remaining candidate — robots permits, `/search?q=` returns 200, but the response is an SPA shell; whether the **rendered** page exposes the four values is unverified. |
| `keepa.com` | Addressable by ASIN (`#!product/10-<ASIN>`) but is a JS app and the useful data is login/paid. Likely fails the four-value text rule. `amazon.in` only. |
| `pricee.com` | Not examined — no robots.txt, no history evidence found. |

**The rule for trusting any new history site (README + evidence-04):** its page must expose **all
four** of `current`, `lowest`, `highest` and `average` as readable **text**, by hand, before an
adapter is written. The agent cannot click, so a site that draws a chart and hides the numbers is
useless no matter how good its data is. A partial result counts as no data. Also: third-party
verdicts printed on such a page ("Deal Score 96%", "Buy signal") are the site's opinion — they must
never be passed through as this plugin's verdict.

**Blocked on a human decision** (evidence-04): (a) accept `pricehistoryapp.com` via listing-page
discovery, which needs a new adapter field and a plan change; (b) survey the remaining candidates
for a robots-permitted addressable lookup; or (c) ship with R10 inert.

### And none for `review` either

The DS-3 survey asked the same question of review sources and got the same answer for the same
reason — the rule is **robots-permitted + addressable from a product URL or title + readable as text
without a click**, and no source met all three. The full record is
[.beads/DS-3/evidence-05.txt](../../.beads/DS-3/evidence-05.txt). This is the *expected* outcome, not
a gap left open: the kind, its validation and the agent's step 5 all landed so that adding one later
is a data change.

The difference from the history half is what a missing adapter costs. History's absence is loud — a
gap note and a `no_signal` verdict. The off-site review half's absence is **silent by design**: no
key, no note, and an assessment computed from the page and the other marketplace alone. Nothing in
the report claims an off-site source was consulted.

## Sale calendar

[`data/sale-calendar.json`](../../data/sale-calendar.json) — an array of
`{ name, months: number[], note }`; only `name` and `months` are read
([history.js:287-294](../../scripts/history.js#L287-L294), overlap test at
[history.js:168](../../scripts/history.js#L168)).

Eight approximate windows: Republic Day (1), Holi (3), Summer (4–5), Prime Day (7, Amazon only),
Independence Day (8), Great Indian Festival / Big Billion Days (9–10), Diwali / Dhanteras (10–11),
Year End (12). Every entry's `note` says it is approximate and shifts yearly — the report labels
them "typical", never "announced". A **missing or malformed file is not an error**: `loadSaleCalendar`
returns `[]` and the only effect is that no window overlaps, which lowers confidence
([history.js:287](../../scripts/history.js#L287)). Data, not code, precisely so a shifted window is
fixed without a release (residual risk R8 in [docs/SECURITY.md](../../docs/SECURITY.md)).

## Authoring checklist

1. Copy an existing adapter as the starting shape; keep `allow` as tight as you can stand.
2. For a shop adapter: confirm every URL in `urls` against a real logged-in session; honestly record
   anything you could not verify in `notes` (the two shipped adapters show the house style for this).
3. For a history or review adapter: verify the page's text by hand first — four values for history,
   a click-free rating and count for review — add `covers`, and expect `loadSites` to reject an
   overbroad `allow`.
4. `node --test test/adapter.test.js` — the shipped-adapter assertions cover the new file
   automatically; a bad adapter fails the run, not just the test.
5. No code change is needed anywhere. If you believe you need one, that is a design change worth
   discussing, not a shortcut.
