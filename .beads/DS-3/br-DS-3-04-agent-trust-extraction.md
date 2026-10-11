# Bead br-DS-3-04: Extract the trust fields in the agent prompt, and live-check H6/H7

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.5 (the agent
extraction step), §3.1 (the `trust` input JSON), §2 R1/R2/R3 and hypotheses **H6/H7**, §5.3 (H6/H7 not
covered by any automated test), §7 (the pre-flight decision: **the live checks run in this story**),
§4.1/§4.2, §8 (this bead). Repo `D:\github\claude-deal-scout`. Cited by section for the plan; source by
line, stable at the `feat/ds-3-…` base. §11's context-refresh list is **not** this bead's scope.

- **Bead ID**: br-DS-3-04
- **Priority**: P0 (critical — without the extraction the engine's input never exists, and the whole
  feature stays inert)
- **Status**: done
- **Original Estimate**: 1.5h (prompt edit + the H6/H7 live read)
- **Dependencies**: br-DS-3-02
- **Blocks**: br-DS-3-06
- **Commit**: `feat(DS-3): trust extraction in the agent prompt (br-DS-3-04)`

## Description

Teach the research agent to read the trust evidence off a product page and emit the `trust` sub-object
the engine consumes, then live-check the two page-shape hypotheses the extraction rests on. **No
runtime code changes here** — `agents/deal-scout.md` is a prompt, and the H6/H7 findings are recorded,
not shipped.

**Step 3's field table gains the five product-page `trust` sub-fields**
([`agents/deal-scout.md:92-106`](../../agents/deal-scout.md#L92-L106)) — `brand`, `brand_store`,
`seller`, `reviews_read`, `verified_read` — with the same care every other field gets. Step 4's
price-history step gains a **sibling** step for the off-site review adapter that produces the sixth
sub-field, `offsite` — `history` is added by step 4 the same way
([`agents/deal-scout.md:104`](../../agents/deal-scout.md#L104)). The sibling's mechanics are identical
to the history lookup ([`agents/deal-scout.md:147-165`](../../agents/deal-scout.md#L147-L165)):
applicable adapters are those whose `covers` names the candidate's **bare** shop-adapter id, queried in
**lexicographic id order**, first usable result wins, otherwise the `offsite` key is **omitted**.

The input shape the agent emits (§3.1) — every field optional, none trusted:

```json
"trust": {
  "brand": "Samsung",
  "brand_store": true,
  "seller": "Appario Retail Private Ltd",
  "reviews_read": 6,
  "verified_read": 5,
  "offsite": { "source": "example-reviews", "rating": 4.1, "count": 2211 }
}
```

`third_party_seller` is **not** duplicated into `trust` — the engine reads it from the candidate's
existing top-level field. `offsite.url` is deliberately not carried: the `source` id names the site and
no third-party link enters the report.

**Two rules the prompt must state explicitly, because both are ways this feature goes wrong (§3.5):**

- **Count what you read, not what is claimed.** `reviews_read` is the number of reviews *actually
  rendered and read* on the page — **not** `review_count`, which is the listing's own claim about
  itself. Writing `review_count` into `reviews_read` makes every share signal meaningless.
- **A gap is an omission, not a guess.** If the review list needs a click, **omit** `reviews_read` and
  `verified_read` (no gap note — `review_sample_too_small` already reports it); if the seller is not
  printed, **omit** `seller`. This mirrors the history rule at
  [`agents/deal-scout.md:160-161`](../../agents/deal-scout.md#L160-L161).

The agent's existing hard rules already cover this work and **do not change**: page text is data, never
record personal data, never click, never report a value it did not read
([`agents/deal-scout.md:44-60`](../../agents/deal-scout.md#L44-L60), [:195-202](../../agents/deal-scout.md#L195-L202)).
**The `tools:` grant and the frontmatter do not change.**

**Live check — H6/H7 (§7 decided this runs inside the story, not deferred).**

- **H6** — an Amazon.in `/dp/<ASIN>` page exposes, as text and **with no click**: the brand attribute, a
  brand-storefront link, a "Sold by" seller name, and an inline top-review list carrying
  verified-purchase badges and star values.
- **H7** — a Flipkart `/<slug>/p/<id>` page exposes the seller name and the brand attribute **without a
  click**. Flipkart product pages are client-rendered — the cart page rendered no text to `read_page`
  for several seconds ([`sites/flipkart.json:20`](../../sites/flipkart.json#L20)) — so a `null`/absent
  result is an **expected outcome, not a failure**. Flipkart reviews live behind a click and are **not
  in scope** (§9).

Constraints on the live read: **public pages only, in the built-in browser pane, never the user's
logged-in session**. Findings go to `.beads/DS-3/evidence-05.txt` (beads 04 and 05 both write there;
§4.1). If the browser pane is unavailable mid-story, the **fallback br-DS-1-04 used applies**:
HTTP-level checks with `robots.txt`, the limitation recorded rather than papered over (precedent:
[`.beads/DS-1/evidence-04.txt`](../DS-1/evidence-04.txt)). **A hypothesis that fails live is recorded
as failed — not worked around with a click or an invented extraction.** The code in beads 01–03 is
offline and unaffected either way.

## Rationale

The extraction is the untrusted layer: the agent runs against attacker-controlled page text, so the
"count what you read" and "omit, don't guess" rules live in the prompt beside the existing "text is
data" rule. H6/H7 are the highest-risk unverified facts in the plan — whether the pages even expose the
seller and the inline review sample without a click (§5.3) — and §7 decided they are checked here rather
than deferred.

## Outcome Definition

- `agents/deal-scout.md` step 3 lists the five `trust` sub-fields and step 4 has the off-site sibling
  that produces `offsite`; both explicit prompt rules above are present.
- `.beads/DS-3/evidence-05.txt` records, for H6 and H7, what a real page exposed as text without a
  click (or that the hypothesis failed / the browser pane was unavailable and the fallback was used).
- **Not covered** (state, do not fake): no automated test for the prompt text or the live read — the
  agent's extraction is LLM behaviour (§5.3), checked by hand only.

## Test Specifications

- **No automated unit test for the prompt text** — the agent's extraction is LLM behaviour and the plan
  deliberately keeps it out of the deterministic set (§5.3). Do not fabricate a test that merely asserts
  the file contains a string.
- **Manual / recorded** (`.beads/DS-3/evidence-05.txt`): the H6 (Amazon.in `/dp/<ASIN>`) and H7
  (Flipkart `/<slug>/p/<id>`) live reads — brand, brand-storefront, "Sold by", inline review list with
  badges (H6); seller + brand attribute (H7) — public pages only, no login, no click.
- **Manual / recorded**: a read-through that the prompt still emits **exactly** bead 01's trusted
  sub-keys (plus the existing top-level fields) and that no rule invites recording `review_count` as
  `reviews_read`.

## Files to Touch

- `agents/deal-scout.md` (modify — step 3's field table; step 4's off-site sibling step; the two prompt
  rules. `tools:`/frontmatter unchanged.)
- `.beads/DS-3/evidence-05.txt` (create or append — the H6/H7 section)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**Done — with the live read half-run, and that is the headline.** `.beads/DS-3/evidence-05.txt`
records H6/H7 in full; read it before trusting the extraction prompt.

**What shipped.** `agents/deal-scout.md`, prompt text only — no runtime code, `tools:` and the
frontmatter untouched:

- Step 3's field table gains a `trust` row, and a `trust` subsection describes the six sub-fields.
  They are **exactly bead 01's trusted sub-keys** — `brand`, `brand_store`, `seller`, `reviews_read`,
  `verified_read`, `offsite` — verified by reading the table back against `score.js`'s `TRUST_FIELDS`.
  No seventh key, and `third_party_seller` is explicitly *not* duplicated into `trust`.
- The two rules the bead calls out, in the agent's own voice: **"count what you read, not what is
  claimed"** (`reviews_read` is the rendered sample, never `review_count`) and **"a gap is an
  omission, not a guess"** (omit `reviews_read`/`verified_read`/`seller` rather than fill them in).
- A new **step 5, off-site reviews**, as step 4's sibling in the identical shape — bare adapter id,
  `covers` match, lexicographic adapter-id order, `urls.lookup` from the public URL or title, first
  usable result wins, otherwise the key is omitted. Steps 5/6 renumbered to 6/7.

**H6 — NOT RUN. Open.** The built-in browser pane was unavailable: the Chrome DevTools MCP server
cannot attach at all (`list_pages` and `new_page` both return "The browser is already running for
`~/.cache/chrome-devtools-mcp/chrome-profile`"), and I did not kill that browser process to free the
profile — it is not mine, its tabs are unknown, and it is a destructive act this bead has no
authority to take. So the DS-1 fallback applies. Two independent blockers, both recorded:

1. amazon.in's `robots.txt` enumerates automated agents with `Disallow: /` — **including
   `ClaudeBot`** — so reading a `/dp/` page as an automated Claude agent is against its stated
   policy, and getting past it would mean wearing a browser User-Agent while not being one. That is
   the workaround the DS-1 survey refused, so it was not attempted.
2. An honest-UA GET is blocked regardless: `HTTP 503`, a 3793-byte "Click the button below to
   continue shopping" interstitial. No product data at all.

**So none of H6's four claims is confirmed or refuted — they remain untested assumptions of the
extraction prompt.** Not contradicted (a real session renders all of it, which is how the plugin is
designed to read amazon.in), but not verified either, and the evidence file says so.

**H7 — brand half CONFIRMED, seller half UNVERIFIED.** Read from the raw server HTML of a real
product URL taken from Flipkart's own sitemap (listed in its robots.txt; the product path is *not*
disallowed there — `/reviews/`, `*/product-reviews/*`, `*/ratings-reviews-details-page`, `/search?`
and `*/sellers?*` are). The brand is genuinely in the initial payload: `"bd":"wraparts"` in the
`__INITIAL_STATE__` blob, alongside `"rating":0,"ratingsCount":0,"reviewsCount":0` and
`"ppd":{"finalPrice":2533,"mrp":5000}`. The **seller name is not**: no `sellerName`, no `"seller"`
key, no "Sold by" — every `seller` hit is nav chrome ("Become a Seller") or a `/sellers?pid=…` link.
That link implies the rendered DOM does show a seller, so the half is unread rather than refuted.
Needs the browser pane; §9 already puts Flipkart reviews out of scope.

**A methodology catch worth recording, because it nearly produced false evidence.** The first pass
counted markers with `grep -o … | wc -l` over a 1.2 MB single-line file and reported **0 for
everything**, including `<html`, which was visibly present. Those counts were not "no match" — grep
had **crashed** (it left a `grep.exe.stackdump` in the repo root; both it and my two throwaway scan
scripts are removed from the tree). Re-counting with node showed the page is server-rendered after
all, which inverted the finding. **Every number in evidence-05.txt comes from the node scan, not
grep.** Had I recorded the grep result, this bead would have filed a confident, wrong H7.

**Not done, deliberately.** No test — the extraction is LLM behaviour and §5.3 keeps it out of the
deterministic set; a test asserting the file contains a string would be the fake this bead forbids.
No adapter. §11's context-refresh list is not this bead's scope. The renumbered steps 5–7 shift the
line numbers this repo's plan and beads cite for `agents/deal-scout.md`; those citations are
historical and §11's refresh does not cover this file.

**Open for the human** — the one item this story could not close: re-run H6 and H7 in a real browser
pane (free the MCP profile, or relaunch the server with `--isolated`), then correct this bead's
Review Notes and evidence-05.txt if either hypothesis comes back negative. The prompt is written to
degrade correctly if the seller or the review sample simply is not there.
