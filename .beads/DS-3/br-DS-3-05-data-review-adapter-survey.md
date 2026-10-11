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
- **Status**: pending
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
[:136-141](../../docs/context/site-adapters.md#L136-L141)). Live-browser work needs the user's go-ahead;
if the pane is unavailable, defer with the procedure written down — the br-DS-1-04 precedent and the
same call the user made for H3
([`.beads/DS-1/evidence-04.txt`](../DS-1/evidence-04.txt)). A shipped `review` adapter must match the
`history`-adjacent schema `validateSites` enforces: real `hosts`, `label`, `notes`, a tight `allow`
(product/lookup paths only), a `urls.lookup` built from the product's public query-stripped URL or title
(**never** account data, R5), and a non-empty `covers` naming loaded shop ids.

**§2 H8 — the three outcomes, stated as acceptable (§8).** H8 asks whether *some* third-party review
source passes all three of: an addressable lookup built from a product URL or title, a rating/count
readable as text without a click, and a `robots.txt` that permits it. This bead may legitimately end
with:

- **ship one adapter** (a source qualified — author `sites/<review-site>.json`), **or**
- **ship none and record why** (no source qualified), **or**
- **defer with the procedure written down** (live work not run this sitting).

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

*(Append-only. The implementer records here, when the bead is done: what was built, any justified
deviation from the bead or the plan, the H8 survey outcome — including "none qualified" or "deferred" —
and anything deliberately left undone. Not written at beadify time.)*
