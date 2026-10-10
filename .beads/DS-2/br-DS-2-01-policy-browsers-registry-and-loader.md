# Bead br-DS-2-01: Make the browser tool policy configuration — the `browsers/` registry and its loader

**Plan Reference**: `docs/planning/DS-2-vendor-agnostic-browser-tools.md` **v8**, §3.1 (the registry and
`checkTool`), §2 R1, §4.1 (New/Modified), §4.2 (not touched), §5.1 (risk table), §5.2 (new tests), §5.4
(second control), §6 R4 (version bump), §8 (this bead's scope after the Phase 4 re-seam), §11
(context-refresh running list — **not** this bead's scope). Repo `D:\github\claude-deal-scout`.
Cited by section rather than line: the plan is a living document and its line numbers have already
moved twice; the source-file line numbers below are stable at `f0e9109` and are the ones to trust.

- **Bead ID**: br-DS-2-01
- **Priority**: P0 (critical — it creates the registry every later bead reads, and it is the bead that
  takes the tool policy away from hardcoded constants)
- **Status**: done
- **Original Estimate**: 2-2.5h
- **Dependencies**: None
- **Blocks**: br-DS-2-02
- **Commit**: `feat(DS-2): browsers/ registry and config-driven tool policy (br-DS-2-01)`

## Description

Move the tool policy's **source** from module constants into a `browsers/*.json` registry, and switch
`checkTool` and its one caller onto it. This is the whole contract change: `policy.js` **and** the
single call site that consumes the changed signature. **It is behaviour-preserving** — after this bead
the guard decides exactly what it decides today; it just reads the decision from a file.

**The registry file (§3.1).** New file `browsers/claude-in-chrome.json`, flat arrays mirroring the
`sites/*.json` `allow`/`deny` idiom (`sites/amazon-in.json` is the model):

```json
{
  "id": "claude-in-chrome",
  "label": "Claude in Chrome",
  "prefixes": ["mcp__claude-in-chrome__", "mcp__Claude_Browser__"],
  "allow": ["tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp", "navigate",
            "read_page", "get_page_text", "find"],
  "url_bearing": ["navigate"],
  "landing_check": ["navigate", "tabs_context_mcp"],
  "notes": ["…"]
}
```

No array here is invented — each is the exact set currently hardcoded, which is what makes the bead
verifiable by inspection:

- `prefixes` = the constant `MCP_PREFIXES` at `scripts/policy.js:27`.
- `allow` = the constant `ALLOWED_TOOLS` at `scripts/policy.js:16-24` (seven names).
- `url_bearing` = the constant `URL_BEARING_TOOLS` at `scripts/guard.js:29` (`['navigate']`).
- `landing_check` = the tool set currently spelled only as the regex at `hooks/hooks.json:17`
  (`navigate|tabs_context_mcp`).

`url_bearing` and `landing_check` are **recorded here but not consumed until br-DS-2-02**, which is
deliberate: the registry has to exist in one shape, and validating all five arrays at load is what
makes br-DS-2-02 a pure wiring change. Adding the file without reading two of its keys is not
scaffolding — `test/browser.test.js` asserts them, and br-DS-2-02 consumes them in the same story.

**`validateBrowsers(entries)` (§3.1).** Add it to `scripts/policy.js` alongside `validateSites`
(`policy.js:205-280`). It takes already-shaped `{ file, data }` entries, throws on the first problem via
the existing `fail(where, message)` helper (`policy.js:165-167`), same
`` `browsers/${file}: <what is wrong>` `` message shape. **Reuse the existing helpers**
`isNonEmptyString` (`policy.js:169-171`) and `isStringList` (`policy.js:173-175`) — do not add parallel
validators. Checks, in the order §3.1 lists them:

- `id`, `label` non-empty strings; `id` unique across files (the `seenIds` pattern at
  `policy.js:216-217`).
- `prefixes` — non-empty array of distinct non-empty strings, **each ending in `__`**, each unique
  across the whole registry (two adapters may not claim the same server).
- `allow` — non-empty array of distinct bare names, **none containing `__`**.
- `url_bearing` and `landing_check` — arrays whose every member is in `allow`.
- no bare tool name appears in two adapters' `allow`.

**`loadBrowsers(dir)` (§3.1).** Mirror `loadSites` (`policy.js:282-298`): `fs.readdirSync` → filter
`.json` → sort → `JSON.parse` each → `validateBrowsers`. An empty directory throws (mirror
`policy.js:285`). A parse error throws
`` `browsers/${file}: not valid JSON — <err.message>` `` (mirror `policy.js:291-293`).

**`checkTool(tool, browsers)` (§3.1).** Change the existing prefix strip at `policy.js:71-88`:
- iterate the **union** of the loaded adapters' `prefixes` in place of the `MCP_PREFIXES` constant
  (`policy.js:75`);
- test membership against the **union** of their `allow` in place of `ALLOWED_TOOLS` (`policy.js:84`);
- **keep the `bare === tool && tool.includes('__')` guard at `policy.js:81` unchanged** — that is what
  denies `mcp__some-other-server__navigate`, which `test/policy.test.js:196` already pins. Only its
  message changes, from `is not a Claude in Chrome MCP tool` to `is not a configured browser tool`.

Union across adapters, not a lookup into "the one adapter": with a single shipped adapter this is the
same set, and it is what lets a second `browsers/*.json` be added without a selection rule. Do **not**
add an index/derived-set helper — with one adapter, a linear scan is the honest implementation.

**Remove the constants.** Delete `ALLOWED_TOOLS` (`policy.js:15-24`) and `MCP_PREFIXES`
(`policy.js:26-27`), and drop `ALLOWED_TOOLS` from `module.exports` (`policy.js:301`). Add
`loadBrowsers` and `validateBrowsers` to `module.exports` (near `policy.js:305-309`). `MCP_PREFIXES` is
module-private and appears in no import, so nothing re-points to it; `checkTool` keeps its export, now
with the two-argument signature. Also update the file's own JSDoc at `policy.js:3-10`, which names
`sites/*.json` as its only I/O and describes the allowlist as constants — both statements become false
here.

**The one caller — this is what makes the bead self-contained.** `checkTool`'s **only** caller is
`scripts/guard.js:71` (`checkTool(toolName)`, one argument; verified by `grep -n 'checkTool' scripts/`).
Change it, in this bead:

- `guard.js:20` imports `{ checkTool, checkUrl, loadSites }`; add `loadBrowsers`.
- Add a `BROWSERS_DIR` beside the existing `SITES_DIR` seam at `guard.js:37-38`:
  ```js
  const BROWSERS_DIR = process.env.DEAL_SCOUT_BROWSERS_DIR || path.join(__dirname, '..', 'browsers');
  ```
- `run()` (`guard.js:243-256`) loads both registries and threads `browsers` through:
  `evaluate(mode, payload, adapters, browsers)` → `evaluatePre(payload, adapters, browsers)` →
  `checkTool(toolName, browsers)`; `selftest(adapters, browsers)` stays a valid call, unchanged in
  behaviour.
- **Nothing else in `guard.js` changes.** `URL_BEARING_TOOLS` (`guard.js:24-29`), `evaluatePost`
  (`guard.js:110-130`), the `URL_BEARING_TOOLS.includes(bare)` test at `guard.js:78`, `AGENT_TYPE`
  (`guard.js:22`), the `run()` ordering and the selftest matrix all stay **exactly as they are** —
  they are br-DS-2-02's. After this bead the guard's behaviour is byte-for-byte identical to today's,
  reading its tool policy from the registry instead of from constants.

**Re-point the one test import (§3.1).** `test/policy.test.js:8` imports `ALLOWED_TOOLS`, and the loop
at `:172-178` iterates it. Remove the import and iterate the **loaded registry's** `allow` union
instead — load it once at the top of the file via
`loadBrowsers(path.join(__dirname, '..', 'browsers'))`, the way `ADAPTERS` is loaded at
`test/policy.test.js:19`, and add `loadBrowsers` to the destructure at `:7-17`. The test's *intent*
(every read-only tool allowed, bare or prefixed) is unchanged; the **config** becomes the thing under
test. The other `checkTool` calls in that file (`:192-198`) gain the `browsers` argument.

**Version bump (§6 R4).** Bump `version` in `.claude-plugin/plugin.json` (currently `0.1.2`) — the repo
requires a bump on every change to the plugin, once per bead.

## Rationale

Four hardcoded lists in three files encode one vendor's browser: `ALLOWED_TOOLS`/`MCP_PREFIXES` in
`policy.js`, `URL_BEARING_TOOLS` in `guard.js`, and the landing-check regex in `hooks.json`. R1 makes
them configuration. This bead is the first of the three layers — the registry, its loader, and the
policy source switch — because br-DS-2-02 cannot judge against data that does not exist yet.

**Why this bead also carries the one-line `guard.js` change (Phase 4 re-seam).** The v7 plan put the
signature change here and its only call site in br-DS-2-02, which left this bead's commit unable to
pass `npm test` — `guard.js:71` would call `checkTool` with one argument, throw inside `evaluate`, be
caught by `run()`'s caller as fail-closed, and turn `test/guard.test.js:43-47` (`selftest exits 0`)
red. A bead whose commit cannot be verified is not a bead under this workflow's per-bead rule, so the
call site moved here. Do **not** work around that by making `checkTool` default-load `browsers/` when
the argument is absent — §9 rejects it (it would make an import read the filesystem and hide which
policy a caller is judged against).

## Outcome Definition

- `npm test` exits **0** — 103 existing tests still pass plus the new `test/browser.test.js` cases.
  Baseline before this story: `103 pass / 0 fail across 6 files`.
- `node scripts/guard.js selftest` exits **0** and prints `selftest OK: 32 cases` — **unchanged** from
  the baseline. This is the load-bearing check that the bead is behaviour-preserving: the matrix is
  untouched, so the same 32 cases must still pass against the registry-driven policy.
- `node -e "console.log(require('./scripts/policy').loadBrowsers('./browsers').length)"` prints `1`.
- **Negative control (plan §5.4, second).** Revert the `landing_check ⊆ allow` check inside
  `validateBrowsers` (make it `if (false)`) and `'a landing_check entry must also be in allow'` must
  **fail**. Run once, revert, confirm `scripts/policy.js` is byte-identical (`git diff --stat` shows
  nothing), and record the observed failing test name in Review Notes.

## Test Specifications

- `test/browser.test.js` (create; §5.2):
  - `'the shipped browser registry allows exactly the seven read-only tools'` — pins the default's
    `allow` against the seven names it replaces.
  - `'the shipped registry keeps tabs_create_mcp out of url_bearing'` — pins the live finding behind
    `guard.js:26-27` and `hooks/hooks.json:17`.
  - `'a landing_check entry must also be in allow'` — `validateBrowsers` throws.
  - `'a tool name claimed by two adapters is rejected'`.
  - `'a duplicate server prefix across adapters is rejected'`.
  - `'a bare name containing __ is rejected'`.
  - `'a prefix not ending in __ is rejected'`.
  - `'loadBrowsers fails closed on a missing directory'` — mirrors `test/adapter.test.js:142-144`.
  - Drive `validateBrowsers` with synthetic `{ file, data }` entries, in the style of
    `test/adapter.test.js`'s `shopEntry`/`historyEntry` fixtures (`:38-72`).
- `test/policy.test.js` (modify): drop the `ALLOWED_TOOLS` import (`:8`) and add `loadBrowsers`; load
  the shipped registry once at the top; re-point the loop at `:172-178` to the loaded allow union; pass
  `browsers` to every `checkTool` call (`:192-198`); add one new row `'checkTool strips a second
  configured prefix'` (a `mcp__Claude_Browser__…` name resolves to its bare allow-set tool).
- **Not covered, state rather than fake**: a real second browser MCP — no such server is configured or
  installed. This bead builds the seam and proves it with the shipped one-adapter/two-prefix registry.
- **Manual / recorded**: the §5.4 second negative control above, in Review Notes.

## Files to Touch

- `browsers/claude-in-chrome.json` (create)
- `scripts/policy.js` (modify — add `validateBrowsers`/`loadBrowsers`/`checkTool(tool, browsers)`;
  remove `ALLOWED_TOOLS`/`MCP_PREFIXES`; update `module.exports` and the file JSDoc)
- `scripts/guard.js` (modify — import `loadBrowsers`, add `BROWSERS_DIR`, thread `browsers` through
  `run`/`evaluate`/`evaluatePre`/`selftest`, pass it to `checkTool`. **No behaviour change.**)
- `test/browser.test.js` (create)
- `test/policy.test.js` (modify — re-point the registry import and loop; add the second-prefix row)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**What was built.** `browsers/claude-in-chrome.json` with the four sets (prefixes, allow,
`url_bearing`, `landing_check`) transcribed from the constants and the `PostToolUse` regex, each
array carrying a note saying why it holds what it holds — including why `landing_check` is *not*
`allow` (the page-text tools return link-dense text and are deliberately not scanned).
`validateBrowsers` + `loadBrowsers` in `scripts/policy.js`, reusing `fail`/`isNonEmptyString`/
`isStringList` rather than adding parallel validators. `checkTool(tool, browsers)` now takes the
union of the loaded adapters' prefixes and `allow`. `ALLOWED_TOOLS`/`MCP_PREFIXES` are gone from the
file and from `module.exports`; the file JSDoc and the constant-block comment were updated, since
both had claimed the allowlist lived here. `guard.js` gained `BROWSERS_DIR`, `loadBrowsers` in the
import, and `browsers` threaded through `run`/`evaluate`/`evaluatePre`/`selftest` — no behaviour
change anywhere else: `URL_BEARING_TOOLS`, `evaluatePost`, `AGENT_TYPE`, the `run()` ordering and the
selftest matrix are untouched, exactly as the bead specifies.

**Deviation from the plan.** One, and it is the Phase 4 re-seam already recorded in the plan's v8
entry and in §8's prose: this bead also carries the single `guard.js` call-site change, because
`checkTool`'s only production caller is `guard.js:71` and splitting them left this commit unable to
pass `npm test`. Nothing else deviates.

**Verification observed.**
- `npm test` → `tests 116 / pass 116 / fail 0` (baseline 103 across 6 files; 13 new — 12 in
  `test/browser.test.js`, 1 in `test/policy.test.js`).
- `node scripts/guard.js selftest` → `selftest OK: 32 cases`, **exit 0, count unchanged**. This is
  the behaviour-preservation evidence the bead asks for: the matrix is untouched, so the same 32
  cases passing against registry-driven policy is the proof that nothing about the guard's decisions
  moved.
- `node -e "…loadBrowsers('./browsers').length"` → `1`.

**Negative control (plan §5.4, second) — run, and it failed as required.** Reverted the subset check
in `validateBrowsers` by making its condition `if (false)`. Result: **two** tests failed, not one —
`a landing_check entry must also be in allow` *and* `a url_bearing entry must also be in allow`,
because the reverted check is the single loop that covers both keys. That is a stronger control than
the bead asked for (it proves both subset bounds are live), and the named one is among the failures.
Restored the line, re-ran: `116/116` and `selftest OK: 32 cases`. `grep -n "if (false)" scripts/`
returns nothing.

**Tests added beyond the bead's list**, because each covers a real branch the bead's Outcome
depends on: `'the shipped registry landing-checks the navigation tools only'` (pins the
`landing_check` set the guard's §3.2 gate will read), `'url_bearing and landing_check may be empty
arrays'` (a browser with no navigable tool is legal, so the empty case must not be rejected),
`'duplicate adapter ids are rejected'`, `'a browser adapter must be a JSON object carrying an id and
a label'`, and the empty-directory half of `'loadBrowsers fails closed on a missing or empty browsers
directory'` (plan §5.1 lists "a broken or empty `browsers/` dir fails open" as a risk, so both
fail-closed branches are exercised, not just the missing one). The allow loop in
`test/policy.test.js` is also stronger than the constant loop it replaces: it now iterates each
registry adapter's own prefixes rather than assuming both prefixes apply to every tool.

**Deliberately not done here.** `url_bearing` and `landing_check` are recorded and validated by this
bead but consumed by none — that is br-DS-2-02's job, and the registry had to exist in its final
shape first. No `docs/context/*` file was touched; that is the workflow's context-refresh phase, per
the plan's §11.
