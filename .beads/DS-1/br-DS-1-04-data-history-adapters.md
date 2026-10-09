# Bead br-DS-1-04: Choose and verify the price-history sites, author history adapters and the sale calendar

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §2 hypothesis H3 (line 43), §3.3 (history-adapter schema, lines 85-89), §3.6 (what history data must supply, lines 111-118), §5.2 (`adapter.test.js` line 167), §6 (R5 line 193, R8 line 196), §7 (line 202). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-04
- **Priority**: P0 (critical — R10 price history is in scope; the adapters are its data source)
- **Status**: pending
- **Original Estimate**: 2h
- **Dependencies**: br-DS-1-02
- **Blocks**: br-DS-1-07
- **Commit**: `feat(DS-1): history adapters and sale calendar (br-DS-1-04)`

## Description

**First, verify the hypothesis (§2 line 43; §7 line 202).** Read the candidate public price-history
sites that cover amazon.in and flipkart **in the built-in browser pane** (public pages only — no login
needed here; never touch the user's real Chrome for this). For each site record in
`.beads/DS-1/evidence-04.txt`: the site id, the URL shapes for a lookup, whether it covers each of
`amazon-in` / `flipkart`, and **what the page text exposes without any click** (canvas/JS charts may
expose only summary stats, or nothing). This settles H3 before any adapter is written: "Which
price-history sites cover amazon.in and flipkart, their URL shapes, and what their page text exposes
without clicks."

**If the hypothesis is false for every candidate** (nothing usable without a click, or no site covers a
shop): ship **no** history adapter and say so in `evidence-04.txt`. The pipeline degrades correctly —
§3.4 step 4 omits the `history` key and adds a gap note; §3.6 takes the summary-stats path. Do not build
a click-based workaround (§4.2 line 141 forbids clicks). A partially-overlapping result is usable only
if it can fill all four of `current`, `lowest`, `highest`, `average` (§3.4 step 4); otherwise treat it as
no data.

**Then author the adapters** (`sites/<history-site>.json`), one file per verified site, matching the
`history`-kind schema br-DS-1-02 validates (§3.3 lines 85-89):

- `"kind": "history"`, real `hosts`, `label`, `notes`;
- `urls.lookup` built from the product's canonical, query-stripped URL or title — never anything from the
  user's account (R5; §3.4 step 6);
- a **tight** `allow` list (product/lookup paths only) and a `deny` list — `loadSites` rejects any history
  adapter whose allow-regexes would permit an account path from the shop deny vocabulary, and rejects a
  `covers` id that is not a loaded shop adapter (§3.3 line 88);
- `covers`: non-empty array of shop-adapter ids this site supports (`"amazon-in"`, `"flipkart"`).

**Finally author `data/sale-calendar.json`** (§3.6 line 116; R8): approximate Indian sale windows keyed
so `history.js` can test overlap — e.g. Amazon Great Indian Festival / Flipkart Big Billion Days
(Sep–Oct), Republic Day (Jan), mid-year and summer sales. Label them approximate and user-correctable;
`history.js` calls them "typical", not announced. Windows live in data so they can be corrected without a
code change.

Adding a site is "add a file" — no code change (R7).

## Rationale

The history verdict (br-DS-1-05) is only as good as its input, and the highest-risk unverified fact in
the plan is whether any history site yields usable data without a click. Resolving that by reading the
real public sites *before* writing an adapter is what keeps the feature from inventing a pattern (§10
QA note). The sale calendar is separate data so the plan's "typical, not announced" framing stays honest.

## Outcome Definition

- `evidence-04.txt` names each verified site, whether it covers `amazon-in` / `flipkart`, the exact
  lookup URL shape, and what text the page exposes without a click.
- Every authored `sites/<history-site>.json` passes `loadSites` (run the br-DS-1-02 adapter test, which
  already asserts "every shipped `sites/*.json` passes schema validation and its `urls.*` templates
  satisfy their own policy").
- `data/sale-calendar.json` is valid JSON and its windows are consumable by `history.js`'s overlap test
  (br-DS-1-05).
- If no site qualifies, that outcome is recorded and no adapter is shipped — the degrade path is stated,
  not silently skipped.

## Test Specifications

- `test/adapter.test.js` (br-DS-1-02) must continue to pass with the new `sites/<history-site>.json`
  files present — no new test file is created here; the shipped-adapter assertions cover them.
- **Manual / recorded** (`.beads/DS-1/evidence-04.txt`): the H3 site survey — site id, coverage, URL
  shape, exposed text — written before the adapter, and the decision (ship adapter / ship none) with the
  reason.

## Files to Touch

- `sites/<history-site>.json` (create — one per verified site; names decided by the H3 survey)
- `data/sale-calendar.json` (create)
- `.beads/DS-1/evidence-04.txt` (create — H3 survey and decision)

## Review Notes

