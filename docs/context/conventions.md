[← INDEX](INDEX.md)

# Conventions

Observed in the code, not aspirational. Where a rule also lives in
[CLAUDE.md](../../CLAUDE.md), that file is the authority and this one only adds the detail visible
in source.

## Naming & layout

- One file per concern under `scripts/`, each CommonJS, each a thin layer: `policy` (pure
  decisions) → `guard` (hook I/O) / `score` / `history` → `report` (merge). No script reaches into
  another's internals; only the documented exports are used.
- **Zero dependencies, permanently.** No `dependencies`, no `devDependencies`, no `npm install`.
  Only `node:`-prefixed builtins. [CLAUDE.md](../../CLAUDE.md) states this as a project rule.
- Module shape, in this order: `'use strict';` → file-level JSDoc block → `require`s → exported
  tunable constants → helpers → entry point → `module.exports` at the bottom
  ([policy.js](../../scripts/policy.js), [score.js](../../scripts/score.js), [history.js](../../scripts/history.js)).
- Constants that a human will retune are **exported and named**, never inlined:
  `W_PRICE`, `W_RATING`, `MIN_RATING`, `PRIOR_MEAN`, `PRIOR_N`, `INFLATED_MRP_PCT`, `MIN_REVIEWS`,
  `MAX_STRING_LENGTH`, `MAX_NUMBER` ([score.js:18-32](../../scripts/score.js#L18-L32));
  `MIN_POINTS`, `MAX_POINTS`, `BUY_WITHIN_PCT`, `IMPLAUSIBLE_BELOW_PCT`
  ([history.js:17-26](../../scripts/history.js#L17-L26)). `test/score.test.js` asserts the
  plan-pinned defaults of these knobs — changing one is a deliberate act with a test to update.
- Data files are data, not code: a new site is a new `sites/*.json`, a shifted sale window is an
  edit to `data/sale-calendar.json`.
- Naming follows the codebase's own vocabulary — `adapter`, `covers`, `allow`/`deny`, `candidate`,
  `effective_price`, `rating_adj`, `verdict`, `gap`, `blocked`. See [glossary.md](glossary.md).
  Use these exact identifiers when grepping.

## Error handling

- **Fail closed, loudly, with a located message.** A bad adapter throws
  `` `sites/${file}: <what is wrong>` `` ([policy.js:165-167](../../scripts/policy.js#L165-L167)).
  `report.js` prints `deal-scout report: <message>` to stderr and returns 2 rather than emitting a
  partial report ([report.js:86-89](../../scripts/report.js#L86-L89)).
- **The hook's catch is load-bearing, not decoration.** Exit 2 is what blocks a tool call; every
  other non-zero exit fails open. So `guard.js` wraps everything and converts any error to exit 2
  ([guard.js:145-149](../../scripts/guard.js#L145-L149), comment at [:12-14](../../scripts/guard.js#L12-L14)).
- Validators return **null / a deny object**, never throw, when the caller needs to turn a failure
  into a report field or a block reason (`checkUrl`, `validateCandidate`, `history.validate`).
  Only `loadSites`/`validateSites` throw, because a bad adapter must stop the run.
- Malformed input degrades to *no output* rather than a guess: a candidate with no usable `price`
  is dropped; a candidate with an invalid `history` is kept with `history` omitted.

## Dependency injection / composition

There is no DI container and no framework. Composition is: pass `adapters` in as an argument
(`score(input, adapters)`), and read environment only at the two documented seams
(`CLAUDE_PLUGIN_ROOT` for the skill's shell paths, `DEAL_SCOUT_SITES_DIR` for tests). Anything
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

> ⚠️ **R-numbers are overloaded.** In [docs/planning/DS-1-deal-scout-plugin.md](../../docs/planning/DS-1-deal-scout-plugin.md),
> `R1`–`R10` in **§2** are *requirements*, while `R1`–`R9` in **§6** are *residual risks*.
> [docs/SECURITY.md](../../docs/SECURITY.md) uses `R1`–`R11` for residual risks and never for
> requirements. A bare "(R4)" in a code comment means the residual-risk numbering, matching
> SECURITY.md.

## Logging & observability

No logging library, and no `console.*` anywhere in `scripts/`. Deliberate streams:

| Stream | Carries |
|---|---|
| stdout | the report JSON ([report.js:84](../../scripts/report.js#L84)); the selftest OK line ([guard.js:235](../../scripts/guard.js#L235)); the PostToolUse `{"decision":"block",…}` JSON ([guard.js:118-124](../../scripts/guard.js#L118-L124)) |
| stderr | every block reason, prefixed `claude-deal-scout guard: ` ([guard.js:43](../../scripts/guard.js#L43)); `report.js` errors; selftest MISS lines |
| exit code | `0` = allow / success, `2` = blocked (the only blocking code) |

## Testing conventions

- **`node:test` + `node:assert`, one test file per script**: `test/policy.test.js`,
  `test/guard.test.js`, `test/score.test.js`, `test/history.test.js`, `test/report.test.js`,
  `test/adapter.test.js`. No framework, no fixtures library, no mocks.
- Test names are **full behavioural sentences**, including the negative case:
  `'a single kind exceeding the price sets offer_implausible and floors effective_price'`,
  `'checkUrl denies hosts that are not exactly an adapter host'`.
- Guard tests **spawn the real script** with `child_process.spawnSync` and assert the exit code —
  the fail-closed behaviour cannot be unit-tested by calling a function
  ([test/guard.test.js](../../test/guard.test.js)).
- `test/adapter.test.js` covers any adapter file automatically by reading `sites/` — adding an
  adapter needs no new test.
- Every guard test is expected to have a **negative control**: remove the defence and the test must
  fail. The list is plan §5.4 (8 controls, mutation-and-revert).
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
  `feat(DS-1): history stats and verdict engine (br-DS-1-05)`, `docs(DS-1): … (br-DS-1-04)`.
  See `git log` on `feat/ds-1-deal-scout-plugin`.
- Branch: `feat/ds-1-deal-scout-plugin` off `main`.
- **Bump `version` in [.claude-plugin/plugin.json](../../.claude-plugin/plugin.json) on every
  change to this plugin** — an installed cache copy goes stale otherwise
  ([CLAUDE.md](../../CLAUDE.md)). Note the two manifests version independently:
  `plugin.json` is at `0.1.2`, `package.json` at `0.1.0` and never deployed.

## Documentation conventions

- `docs/planning/DS-1-deal-scout-plugin.md` is the **source of truth for design** and carries a
  `<!-- version=N, status=converged -->` header plus a Change History of triage rounds. Code
  comments point into it by section.
- Raw findings go to `.beads/DS-1/evidence-*.txt`; transient review rounds live under
  `docs/planning/review/` and `docs/planning/impl-review/` (gitignored directory names
  `review/`, `impl-review/`).
