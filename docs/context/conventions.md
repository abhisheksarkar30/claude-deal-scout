[← INDEX](INDEX.md)

# Conventions

Observed in the code, not aspirational. Where a rule also lives in
[CLAUDE.md](../../CLAUDE.md), that file is the authority and this one only adds the detail visible
in source.

## Naming & layout

- One file per concern under `scripts/`, each CommonJS, each a thin layer: `policy` (pure
  decisions) → `guard` (hook I/O) / `score` / `history` / `trust` → `report` (merge). No script
  reaches into another's internals; only the documented exports are used. `trust.js` is the one
  sibling that imports another engine's public surface (`MAX_NUMBER`, `MAX_STRING_LENGTH`,
  `sanitize` from `score.js`) rather than only `policy.js` — which is why `MAX_REVIEWS_READ` lives in
  `score.js`: the direction is one-way and a reverse import would close a require cycle.
- **Zero dependencies, permanently.** No `dependencies`, no `devDependencies`, no `npm install`.
  Only `node:`-prefixed builtins. [CLAUDE.md](../../CLAUDE.md) states this as a project rule.
- Module shape, in this order: `'use strict';` → file-level JSDoc block → `require`s → exported
  tunable constants → helpers → entry point → `module.exports` at the bottom
  ([policy.js](../../scripts/policy.js), [score.js](../../scripts/score.js), [history.js](../../scripts/history.js)).
- Constants that a human will retune are **exported and named**, never inlined:
  `W_PRICE`, `W_RATING`, `MIN_RATING`, `PRIOR_MEAN`, `PRIOR_N`, `INFLATED_MRP_PCT`, `MIN_REVIEWS`,
  `MAX_STRING_LENGTH`, `MAX_NUMBER` ([score.js:18-32](../../scripts/score.js#L18-L32));
  `MIN_POINTS`, `MAX_POINTS`, `BUY_WITHIN_PCT`, `IMPLAUSIBLE_BELOW_PCT`
  ([history.js:17-26](../../scripts/history.js#L17-L26)); `MIN_REVIEWS_READ`, `UNVERIFIED_SHARE_MAX`,
  `UNDERCUT_PCT`, `RATING_GAP`, `BRAND_CONFIDENCES`, `SIGNALS`, `DISCREDITING_SIGNALS`, `CAVEAT`
  ([trust.js:27-60](../../scripts/trust.js#L27-L60)). `test/score.test.js` and
  `test/trust.test.js` assert the plan-pinned defaults of these knobs — changing one is a deliberate
  act with a test to update. A validation **bound** rather than a knob (`MAX_REVIEWS_READ`) is
  deliberately *not* exported.
- Data files are data, not code: a new site is a new `sites/*.json`, a new browser is a new
  `browsers/*.json`, a shifted sale window is an edit to `data/sale-calendar.json`.
- Naming follows the codebase's own vocabulary — `adapter`, `covers`, `allow`/`deny`, `candidate`,
  `effective_price`, `rating_adj`, `verdict`, `gap`, `blocked`. See [glossary.md](glossary.md).
  Use these exact identifiers when grepping.

## Error handling

- **Fail closed, loudly, with a located message.** A bad adapter throws
  `` `sites/${file}: <what is wrong>` `` ([policy.js:167-169](../../scripts/policy.js#L167-L169)).
  `report.js` prints `deal-scout report: <message>` to stderr and returns 2 rather than emitting a
  partial report ([report.js:89-95](../../scripts/report.js#L89-L95)).
- **The hook's catch is load-bearing, not decoration.** Exit 2 is what blocks a tool call; every
  other non-zero exit fails open. So `guard.js` wraps everything and converts any error to exit 2
  ([guard.js:181-184](../../scripts/guard.js#L181-L184), comment at [:19-21](../../scripts/guard.js#L19-L21)).
- Validators return **null / a deny object**, never throw, when the caller needs to turn a failure
  into a report field or a block reason (`checkUrl`, `validateCandidate`, `history.validate`).
  Only `loadSites`/`validateSites` and `loadBrowsers`/`validateBrowsers` throw, because a bad
  adapter must stop the run.
- Malformed input degrades to *no output* rather than a guess: a candidate with no usable `price`
  is dropped; a candidate with an invalid `history` is kept with `history` omitted.

## Dependency injection / composition

There is no DI container and no framework. Composition is: pass `adapters` in as an argument
(`score(input, adapters)`), and read environment only at the four documented seams
(`CLAUDE_PLUGIN_ROOT` for the skill's shell paths, `DEAL_SCOUT_SITES_DIR` / `DEAL_SCOUT_BROWSERS_DIR`
for the two registries, `DEAL_SCOUT_AGENT_TYPE` for the guard's scope — the last three test/portability
seams). Anything
else that varies (the clock, the sale calendar, the deadline) is an **option object the caller
supplies** — `history.analyze(raw, { today, deadline, saleCalendar })` takes `today` precisely so
"tests never read the clock" ([history.js:143-146](../../scripts/history.js#L143-L146)).

## Comments

Comments here carry the *why* and the *provenance*, not the what. Expect three recurring forms:

- A file-level JSDoc block stating the file's role and its security consequence
  (e.g. score.js "Its strictness is a security property, not just hygiene").
- Cross-references into the design plan by section: `(§3.4 step 4)`, `(§3.6)`, `(R4)`, `(R6)`.
  These are load-bearing — the comment is the only place the requirement id and the code meet.
- Explicit notes about a deliberate trade-off, e.g. "first usable adapter" being a
  determinism/richness trade-off, or `tests seam only — see Review Notes`.

> ⚠️ **R-numbers are overloaded.** In the DS-1 plan (`docs/planning/DS-1-deal-scout-plugin.md`),
> `R1`–`R10` in **§2** are *requirements*, while `R1`–`R9` in **§6** are *residual risks*.
> [docs/SECURITY.md](../../docs/SECURITY.md) uses `R1`–`R12` for residual risks and never for
> requirements. A bare "(R4)" in a code comment means the residual-risk numbering, matching
> SECURITY.md. **DS-3's own plan reuses the same letters for its own §6 risks** (`R1`–`R6`), so a
> bare "(R1)" in `trust.js` means *the DS-3 plan's* R1, not SECURITY.md's.

## Logging & observability

No logging library, and no `console.*` anywhere in `scripts/`. Deliberate streams:

| Stream | Carries |
|---|---|
| stdout | the report JSON ([report.js:92](../../scripts/report.js#L92)); the selftest OK line ([guard.js:288](../../scripts/guard.js#L288)); the PostToolUse `{"decision":"block",…}` JSON ([guard.js:151-161](../../scripts/guard.js#L151-L161)) |
| stderr | every block reason, prefixed `claude-deal-scout guard: ` ([guard.js:65](../../scripts/guard.js#L65)); `report.js` errors; selftest MISS lines |
| exit code | `0` = allow / success, `2` = blocked (the only blocking code) |

## Testing conventions

- **`node:test` + `node:assert`, one test file per concern**: `test/policy.test.js`,
  `test/guard.test.js`, `test/score.test.js`, `test/history.test.js`, `test/trust.test.js`,
  `test/report.test.js`, `test/adapter.test.js`, `test/browser.test.js`. No framework, no fixtures
  library, no mocks.
  (`policy.js` owns two of them — `policy.test.js` for the URL policy, `browser.test.js` for the
  browser registry — because the two registries are deliberately separate concerns.)
- Test names are **full behavioural sentences**, including the negative case:
  `'a single kind exceeding the price sets offer_implausible and floors effective_price'`,
  `'checkUrl denies hosts that are not exactly an adapter host'`.
- Guard tests **spawn the real script** with `child_process.spawnSync` and assert the exit code —
  the fail-closed behaviour cannot be unit-tested by calling a function
  ([test/guard.test.js](../../test/guard.test.js)).
- `test/adapter.test.js` covers any adapter file automatically by reading `sites/` — adding an
  adapter needs no new test.
- Every guard test is expected to have a **negative control**: remove the defence and the test must
  fail. The list is plan §5.4 — now **14** controls across DS-1 (1–8), DS-2 (9–10) and DS-3 (11–14),
  all mutation-and-revert, all executed.
- Run with `npm test` (`node --test`). No coverage tool, no lint config, no formatter config
  exists in the repo.

## Formatting / lint

**There is no lint or format config** — no ESLint/Prettier/Biome/`.editorconfig`. The de facto
style, read off the source:

- 2-space indent, single quotes, semicolons, trailing commas in multiline literals.
- ~110-column soft limit; long prose and long regexes are allowed to run over rather than be split.
- Prefer early-return guard clauses (`if (!ok) return deny(...)`) over nesting.

## Commits & branches

- Conventional commits, **one commit per bead**, message naming the bead id:
  `feat(DS-1): history stats and verdict engine (br-DS-1-05)`, `docs(DS-3): … (br-DS-3-07)`.
  See `git log`.
- Branch: **one `feat/ds-<n>-<slug>` branch per story, cut from `origin/main`** — not from local
  `main`, which is stale, and not from the previous story's branch. `feat/ds-1-deal-scout-plugin`
  (now merged as PR #1), `feat/ds-2-vendor-agnostic-browser-tools` (#2) and
  `feat/ds-3-brand-authenticity-and-review-trust` were each cut that way. `CLAUDE.md`'s
  "Branch: `feat/ds-1-deal-scout-plugin` off `main`" line is the DS-1-era wording of this rule and
  is stale as a literal.
- **Bump `version` in [.claude-plugin/plugin.json](../../.claude-plugin/plugin.json) on every
  change to this plugin** — an installed cache copy goes stale otherwise
  ([CLAUDE.md](../../CLAUDE.md)). Note the two manifests version independently:
  `plugin.json` is at `0.1.14`, `package.json` at `0.1.0` and never deployed.

## Documentation conventions

- The plans under [docs/planning/](../../docs/planning/) are the **source of truth for design**; each
  carries a `<!-- version=N, status=converged -->` header plus a Change History of triage rounds.
  Code comments point into them by section, and a comment in a DS-3 file cites the DS-3 plan.
- Raw findings go to `.beads/{ticket-id}/evidence-*.txt`; transient review rounds live under
  `docs/planning/review/` and `docs/planning/impl-review/` (gitignored directory names `review/`,
  `impl-review/`).
