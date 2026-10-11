# Bead br-DS-3-05: Add the `review` adapter kind, then survey for a third-party review source (and ship one only if one verifies)

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.6 (the
`review` kind and its survey, bead 05), §2 R3 and hypothesis **H8**, §5.1 (the `review`-adapter risk
row), §5.2 (`test/adapter.test.js`), §5.3 (H8 not covered by any automated test), §6 R5, §7 (the
pre-flight decision: the live check runs in this story), §4.1/§4.2, §8 (this bead). Repo
`D:\github\claude-deal-scout`. Cited by section for the plan; source by line, stable at the
`feat/ds-3-…` base. §11's context-refresh list is **not** this bead's scope.

- **Bead ID**: br-DS-3-05
- **Priority**: P1 (high — off-site reach is R3's "beyond the site" half; the kind is in scope, the
  shipped host is survey-gated)
- **Status**: done
- **Original Estimate**: 1.5–2h (the four policy edits + tests, then the survey)
- **Dependencies**: br-DS-3-01
- **Blocks**: None
- **Commit**: `feat(DS-3): review adapter kind and survey (br-DS-3-05)`

## Description

Add a third adapter `kind`, `"review"`, that reuses every existing guarantee so a survey-gated
third-party review source can be added as data — then run the survey, and **ship an adapter only if one
actually verifies**. This is **the one bead that can legitimately end with no shipped artifact.**

**`scripts/policy.js` gains the kind — exactly four edit sites, no new guarantee (§3.6, R5).**

1. `REQUIRED_URLS` ([`scripts/policy.js:195`](../../scripts/policy.js#L195)) → add `review: ['lookup']`
   (the same key `history` uses):
   ```js
   const REQUIRED_URLS = { shop: ['search', 'cart', 'wishlist'], history: ['lookup'], review: ['lookup'] };
   ```
2. the kind check at [`scripts/policy.js:218`](../../scripts/policy.js#L218) accepts `"review"`.
3. the `kind === 'history'` block at [`scripts/policy.js:247-260`](../../scripts/policy.js#L247-L260)
   becomes `kind !== 'shop'`, so a `review` adapter is captured with its `covers`
   ([`scripts/policy.js:259`](../../scripts/policy.js#L259)) and **inherits the in-block checks
   unchanged**: a non-empty `covers` array, and rejection if any `allow` regex can reach a path in the
   adversarial suite ([`scripts/policy.js:251-258`](../../scripts/policy.js#L251-L258)).
4. the whole-set validity loop at [`scripts/policy.js:270-277`](../../scripts/policy.js#L270-L277) is
   gated at [:271](../../scripts/policy.js#L271) by `if (adapter.kind !== 'history') continue;`. That
   gate becomes `if (adapter.kind === 'shop') continue;` — **the fourth edit, and the one that is easy
   to miss** — so the rule that a `covers` entry must name a *loaded shop adapter* runs for `review` as
   well as `history`. Without it, a `review` adapter whose `covers` names a typo'd or unknown shop id
   loads cleanly, silently defeating the documented load error
   ([`docs/context/site-adapters.md:91`](../../docs/context/site-adapters.md#L91)).

A new host's blast radius is bounded by checks that already exist, once `:271` lets the `review` kind
reach them. `test/adapter.test.js` iterates `sites/`
([`docs/context/testing-and-quality.md:105`](../../docs/context/testing-and-quality.md#L105)), so any
adapter the survey ships is covered **without a new test**; the kind itself gets explicit cases below.

**The survey (br-DS-1-04's shape, findings to `.beads/DS-3/evidence-05.txt`).** For each candidate
review source, in the built-in browser pane on **public pages only** (never the user's logged-in
session), record: whether it has an **addressable lookup** built from a product URL or title, what its
**rendered page exposes as text without a click** (a rating, a count), and what its **`robots.txt`**
permits. Then either author **one** `sites/<review-site>.json` or record **"none qualified"** with the
reason. **A robots-disallowed or click-gated source is a "no", not a workaround**
([`docs/context/site-adapters.md:130`](../../docs/context/site-adapters.md#L130),
[:136-141](../../docs/context/site-adapters.md#L136-L141)). **The live read runs in this story** — the
user gave the go-ahead at the Phase-2 checkpoint (§7). Only if the browser pane is unavailable does the
br-DS-1-04 fallback apply: HTTP-level checks with `robots.txt`, the limitation recorded rather than
papered over ([`.beads/DS-1/evidence-04.txt`](../DS-1/evidence-04.txt)). A shipped `review` adapter must
match the `history`-adjacent schema `validateSites` enforces: real `hosts`, `label`, `notes`, a tight
`allow` (product/lookup paths only), a `urls.lookup` built from the product's public query-stripped URL
or title (**never** account data, R5), and a non-empty `covers` naming loaded shop ids.

**§2 H8 — the three outcomes, stated as acceptable (§8).** H8 asks whether *some* third-party review
source passes all three of: an addressable lookup built from a product URL or title, a rating/count
readable as text without a click, and a `robots.txt` that permits it. This bead may legitimately end
with:

- **ship one adapter** (a source qualified — author `sites/<review-site>.json`), **or**
- **ship none and record why** (no source qualified) — the expected, acceptable result if the survey
  finds nothing and the `offsite` seam simply never fires, **or**
- **record the procedure only** (live work could not be run and the HTTP-level fallback could not
  settle it either) — the one outcome that leaves H8 open rather than answered, and the only one that
  should be avoided when the browser pane is available.

**All three are acceptable outcomes, not failures.** Shipping no `sites/<review-site>.json` is a valid
result — the `offsite` seam the engine builds (bead 02) is still correct and simply never fires, exactly
as `history.js` shipped with no data source ([`docs/context/workflows.md:196-201`](../../docs/context/workflows.md#L196-L201)).

## Rationale

R3 requires review/rating provenance "beyond the site", and the same item on the other marketplace is
already reachable via `product_key` (bead 02's cross-site half). This bead adds the *other* beyond-the-
site source as an optional, survey-gated data file, mirroring br-DS-1-04's history-adapter decision: a
new host is a data change via `sites/*.json`, and the survey decides only whether a host is added (§10,
R5). The four `policy.js` edits are the whole cost, and they add no guarantee the codebase does not
already enforce.

## Outcome Definition

- `npm test` exits **0**, including the new `test/adapter.test.js` cases; `test/adapter.test.js`'s
  shipped-adapter loop covers any `sites/<review-site>.json` that ships (§5.2,
  [`docs/context/testing-and-quality.md:105`](../../docs/context/testing-and-quality.md#L105)).
- `node scripts/guard.js selftest` exits **0** and still prints `selftest OK: 60 cases`. This is the
  load-bearing check for this bead: `scripts/policy.js` is the guard's **only** import
  ([`scripts/guard.js:26`](../../scripts/guard.js#L26)), so the four edits must leave the guard's
  decisions unchanged. **`scripts/guard.js` and `hooks/hooks.json` code is not touched** (§4.2); the
  reachable host set widens only if an adapter ships — a data change the guard already enforces (§3.8).
- `.beads/DS-3/evidence-05.txt` records the H8 survey: candidate sources, their lookup shape, what the
  rendered page exposed without a click, their `robots.txt` verdict, and the decision (**ship one** /
  **ship none** / **defer**), with the reason.
- If no source qualifies, **no** `sites/<review-site>.json` is created — and that outcome is recorded,
  not treated as a failure.

## Test Specifications

- `test/adapter.test.js` (modify — additions only, §5.2). Reuse the existing fixture style
  ([`test/adapter.test.js:38-72`](../../test/adapter.test.js#L38-L72)) with a `reviewEntry(over = {})`
  helper mirroring `historyEntry`:
  - `'a synthetic kind: "review" adapter loads'`.
  - `'a review adapter with an overbroad allow (^/.*$) is rejected at load'` — same as the history case
    ([`test/adapter.test.js:78-87`](../../test/adapter.test.js#L78-L87)).
  - `'a review adapter whose covers names an unknown shop id is rejected'` — this is the case that
    pins **edit site 4** (`policy.js:271`); without it the typo'd id would load
    ([`test/adapter.test.js:101-107`](../../test/adapter.test.js#L101-L107)).
  - `'a review adapter missing urls.lookup is rejected'`.
  - Optionally mirror `'a history adapter needs a non-empty covers array'`
    ([`test/adapter.test.js:109-114`](../../test/adapter.test.js#L109-L114)) for `review`.
- **Not covered** (state, do not fake): H8 itself — whether any review source qualifies (§5.3). Live
  read only; a `sites/<review-site>.json` that ships is covered automatically by the existing
  shipped-adapter assertions, but the *decision to ship it* is not machine-checkable.
- **Manual / recorded** (`.beads/DS-3/evidence-05.txt`): the H8 survey and the ship/ship-none/defer
  decision with its reason.

## Files to Touch

- `scripts/policy.js` (modify — the four sites: `:195`, `:218`, `:247`, `:271`. **No change to the URL
  rules, the adversarial suite, or the browser half.**)
- `test/adapter.test.js` (modify — the `review`-kind cases)
- `sites/<review-site>.json` (create — **only if the survey verifies one; may not exist**)
- `.beads/DS-3/evidence-05.txt` (create or append — the H8 section; bead 04 writes the H6/H7 section of
  the same file)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**Done — the `review` kind shipped, and the survey's answer is "none qualified". That is the bead's
expected outcome, not a failure.** `.beads/DS-3/evidence-05.txt` carries the full H8 record.

**The kind — exactly the four edit sites the bead named, all in `scripts/policy.js`:** `REQUIRED_URLS`
gains `review: ['lookup']`; the kind check accepts `"review"`; the `kind === 'history'` capture block
becomes `kind !== 'shop'`; and the whole-set gate at the old `:271` becomes
`if (adapter.kind === 'shop') continue;`. A `review` adapter therefore inherits the non-empty-`covers`
rule and the adversarial-path rejection unchanged, and — because the gate now admits it — a `covers`
entry naming a typo'd shop id is rejected instead of loading cleanly. **Completeness verified, not
assumed:** `grep` over `scripts/` for every kind string finds only these three sites plus the kind
check, and no `.kind` branch anywhere in `guard.js` (it reaches `policy.js` only through `checkUrl`,
which applies every adapter's `allow` regardless of kind — which is exactly why the reachable host set
widens only if an adapter ships, §3.8).

**One naming change beyond the four sites, behaviour-neutral:** the `historyFiles` map is now
`coveredFiles`, since it holds any non-shop adapter's file and a name saying `history` while holding a
`review` adapter is the kind of thing the next reader trusts and shouldn't. The two check messages now
interpolate `${kind}` rather than hard-coding "a history adapter", for the same reason. Both are
provably behaviour-preserving: the existing tests assert on `/covers/`, `/mutating path/` and
`/not a loaded shop adapter/`, never on the full string.

**Verified:** `npm test` **175 pass / 0 fail** (170 after bead 04 + 5 new `review` cases);
`node scripts/guard.js selftest` still prints **`selftest OK: 60 cases`** — the load-bearing check for
this bead, since `policy.js` is the guard's only import and this is the evidence that the four edits
left every guard decision unchanged.

**H8 survey — decision: ship NO `sites/<review-site>.json`.** Same browser-pane limitation as bead 04,
so the rendered-text half is unverified; but the blockers are mostly decisive on their own. Plain
`curl`, no User-Agent spoofing:

- **gsmarena.com** — robots.txt disallows `ClaudeBot`, `anthropic-ai`, `GPTBot`, `CCBot` with
  `Disallow: /`. Disqualified on policy, and fails addressability independently (site-internal `-<id>`).
- **trustpilot.com** — lists `anthropic-ai` among its disallows, and indexes businesses by domain, not
  products: no product-level lookup exists to build.
- **mouthshut.com** — connection reset (HTTP 000). Excluded as unreachable, the way DS-1 treated
  smartprix's 403.
- **91mobiles.com** — robots.txt **permits** it for a generic agent (no AI block; only `008` and
  `Baiduspider` get a blanket deny), and the URL shape looks constructible from brand+model — but all
  three constructed lookups returned **HTTP 403** bot pages. **This one is different in kind:** it is
  robots-permitted and blocks only non-browser clients, so it is *unverified*, not rejected. I did not
  ship a template for it because that would be inventing a URL shape not shown to resolve — the same
  mistake DS-1 refused with `pricehistoryapp.com/product/{slug}`, and the 403s do not even confirm the
  slug pattern.

The `offsite` seam built in beads 02/03 is correct and simply never fires; cross-marketplace
corroboration on `product_key` carries R3's "beyond the site" half with zero new hosts, so R5's
residual is unchanged. Shipping the kind rather than a host means a source that later qualifies is a
**data change** with no code edit.

**Not done, deliberately.** No `sites/<review-site>.json` (the survey found none). No test for the
survey decision — §5.3 says the ship/no-ship call is not machine-checkable, and any adapter that did
ship would be covered automatically by the existing shipped-adapter assertions, so no new test file is
needed.

**Open for the human**, alongside H6/H7: in a real browser pane, check 91mobiles' constructed lookup
for a real product — does it resolve, and does the rendered page expose a rating and count as text with
no click? Both hold → one data file ships; either fails → "none qualified" is final. Its robots.txt
already permits the read, so those two questions are all that remain.
