<!-- version=7, status=converged -->
# DS-2 — claude-deal-scout: make the browser toolset configuration so the plugin stops being vendor-locked

Issue: none (request came from the user in chat: "make this repo model/vendor agnostic. I wont have
claude pro usble all time, gets exhausted pretty soon")
Branch: `feat/ds-2-vendor-agnostic-browser-tools` (off `feat/ds-1-deal-scout-plugin` — see §7)
Beads: `.beads/DS-2/` (filled in at Phase 3)

## 1. Problem

The user wants the plugin to keep working when Claude Pro access is unavailable. Two different claims
hide inside that request, and they have very different costs:

1. **Model dependence.** Does anything here require a Claude *model*? **No — verified.** No `model:`
   key exists in any frontmatter, and `grep -i claude` over `scripts/`, `sites/` and `data/` returns
   only the *plugin name* (`claude-deal-scout`) and the *browser server name*
   (`mcp__claude-in-chrome__`). `score.js`, `history.js` and `report.js` are plain Node with zero
   dependencies and no vendor strings at all. An exhausted quota is therefore **not** currently an
   outage for the deterministic core: the same plugin runs unchanged under any model Claude Code is
   pointed at. This half of the request needs verification and documentation, not code.
2. **Vendor dependence.** Does anything here require a Claude *product*? **Yes, and it is a real,
   silent lock-in.** The plugin's only way of seeing a page is the Claude in Chrome MCP server, and
   that server's identity is hardcoded in four places, one of which fails *silently* (§2, R2).

This was not reproduced as a defect — it is a design gap found by reading the source. The silent
failure mode in R2 is written down in §5.3 as hand-verified, because it cannot be asserted by a test
in this repo.

**Scope, as decided by the user in Phase 1** (three explicit answers):
- Keep it a Claude Code plugin; make the *vendor literals* configuration-driven — the browser
  toolset, the plugin-root var, and the guard's agent scoping. **Not** a multi-harness port.
- The browser toolset becomes **pluggable, with Claude in Chrome remaining the shipped default**. No
  second browser MCP is implemented or verified in this story.
- The plugin **keeps its name** `claude-deal-scout` (§9).

## 2. Requirements and verified root causes

| # | Requirement | Root cause (verified in code) | Decision |
|---|---|---|---|
| R1 | The browser toolset — server prefixes, the allowed tool names, which tools are URL-bearing, which get a landing check — is configuration, not code. Claude in Chrome ships as the default and behaves exactly as today. | `ALLOWED_TOOLS` and `MCP_PREFIXES` are module constants in [policy.js:16-27](../../scripts/policy.js#L16-L27); `URL_BEARING_TOOLS` is a constant in [guard.js:29](../../scripts/guard.js#L29); the landing-check tool set exists only as a regex in [hooks.json:17](../../hooks/hooks.json#L17). Four hardcoded lists, one vendor. | New `browsers/*.json` registry loaded by `loadBrowsers`/`validateBrowsers` in `policy.js`, mirroring the existing `sites/*.json` idiom. `checkTool(tool, browsers)` takes the loaded set. |
| R2 | The hook matcher must not enumerate one vendor's server name, because a configured browser whose prefix the matcher omits is **never checked at all** — the allowlist silently does not apply to it. | [hooks.json:6,17](../../hooks/hooks.json#L6) match `mcp__(claude-in-chrome\|Claude_Browser)__.*`. The matcher is static JSON and cannot be templated from config. [policy.js:81-83](../../scripts/policy.js#L81-L83) denies an unknown server, but only *if the guard is invoked* — and the matcher is what invokes it. The agent's `tools:` frontmatter is the only other bound, and [guard.js:6](../../scripts/guard.js#L6) states the repo's own position: "A prompt is not a control." | Both matchers become `mcp__.*`; the guard decides everything from config + `agent_type`. This **strengthens** the model (default-deny now covers every MCP server) at the cost of one process spawn per MCP call session-wide (§6 R3). |
| R3 | The guard's agent scope is a default, not a literal — the last vendor-shaped string in runtime code. | `AGENT_TYPE = 'claude-deal-scout:deal-scout'` at [guard.js:22](../../scripts/guard.js#L22). A harness that is not Claude Code will not synthesise this `agent_type`. | `process.env.DEAL_SCOUT_AGENT_TYPE \|\| 'claude-deal-scout:deal-scout'`, mirroring the existing `DEAL_SCOUT_SITES_DIR` seam ([guard.js:38](../../scripts/guard.js#L38)). |
| R4 | Nothing depends on a Claude model, and that is stated where a reader will look for it. | Verified §1.1. | README gains a "Model and browser independence" section; no code change. |
| R5 | No script needs a harness-supplied environment variable; `${CLAUDE_PLUGIN_ROOT}` remains only where a shell command genuinely has to name the install path (the skill's commands and the two hook commands). | `report.js` resolves sites via `ROOT = path.join(__dirname, '..')` ([report.js:23](../../scripts/report.js#L23)); `guard.js` via `__dirname` ([guard.js:38](../../scripts/guard.js#L38)). Neither reads cwd. `${CLAUDE_PLUGIN_ROOT}` appears only in the skill's shell commands ([SKILL.md:17,54,70](../../skills/find-best-deal/SKILL.md#L17)) and the two hook commands ([hooks/hooks.json:10,21](../../hooks/hooks.json#L10)); no script reads it. | Verified, plus a test that runs `report.js` from an unrelated cwd. `${CLAUDE_PLUGIN_ROOT}` is documented as the one harness-supplied value. |

## 3. Design

### 3.1 R1 — the `browsers/` registry

New file `browsers/claude-in-chrome.json`, flat arrays mirroring `sites/*.json`'s `allow`/`deny` idiom:

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

`policy.js` gains, alongside `loadSites`/`validateSites`:

- `validateBrowsers(entries)` — throws on the first problem, same fail-closed contract and
  `` `browsers/${file}: <what is wrong>` `` message shape:
  - `id`, `label` non-empty strings; `id` unique across files.
  - `prefixes` — non-empty array of distinct non-empty strings, each ending in `__`, each unique
    across the whole registry (two adapters may not claim the same server).
  - `allow` — non-empty array of distinct bare names, none containing `__`.
  - `url_bearing` and `landing_check` — arrays whose every member is in `allow`.
  - no bare tool name appears in two adapters' `allow`.
- `loadBrowsers(dir)` — `readdirSync`→ filter `.json` → sort → parse → `validateBrowsers`, the shape
  of [policy.js:283-298](../../scripts/policy.js#L283-L298). Empty directory throws.
- `checkTool(tool, browsers)` — the existing prefix-strip in
  [policy.js:71-88](../../scripts/policy.js#L71-L88), with `MCP_PREFIXES` replaced by the union of the
  loaded adapters' `prefixes` and `ALLOWED_TOOLS` by the union of their `allow`. The
  `tool.includes('__')` guard at [policy.js:81](../../scripts/policy.js#L81) is **kept unchanged** —
  it is what denies `mcp__some-other-server__navigate`, which
  [policy.test.js:196](../../test/policy.test.js#L196) already pins. Only its message changes from
  `is not a Claude in Chrome MCP tool` to `is not a configured browser tool`.
- `ALLOWED_TOOLS` and `MCP_PREFIXES` are **removed**. Only `ALLOWED_TOOLS` has a test import:
  `test/policy.test.js` imports it at [policy.test.js:8](../../test/policy.test.js#L8) and iterates it
  at [:173](../../test/policy.test.js#L173); `MCP_PREFIXES` is module-private
  ([policy.js:27](../../scripts/policy.js#L27)) and appears in no test import, so there is nothing to
  re-point for it. The test instead loads the shipped registry, which keeps the test's intent (every
  read-only tool allowed, bare or prefixed) while making the *config* the thing under test.

Deliberately **not** an index/build step: with one browser adapter, `browsers` is an array of length
one and the guard does a linear `.some(...)`. A derived-set helper would be an abstraction for a set
that does not exist yet.

### 3.2 R2 — hooks match everything MCP, the guard decides

`hooks/hooks.json`:

- `PreToolUse` matcher: `mcp__.*`
- `PostToolUse` matcher: `mcp__.*`

`guard.js` changes shape accordingly:

- `run(mode)` applies the `agent_type` scope gate **before** it loads any registry: it validates the
  payload is an object (exit 2 otherwise, as today) and returns `ALLOW` (exit 0) for an out-of-scope
  `agent_type` without reading `sites/` or `browsers/` (the scope check in
  [guard.js:243-256](../../scripts/guard.js#L243-L256) moves ahead of `loadSites`). Only an in-scope
  call loads both, so a broken `browsers/` (or `sites/`) fails closed — exit 2 — for the deal-scout
  agent exactly as today, and **cannot** block an unrelated session's MCP calls. `evaluate` keeps its
  own scope check so the selftest matrix's scoping rows
  ([guard.js:162-164](../../scripts/guard.js#L162-L164)) are unchanged.
- `BROWSERS_DIR` mirrors the existing `SITES_DIR` seam:
  `process.env.DEAL_SCOUT_BROWSERS_DIR || path.join(__dirname, '..', 'browsers')`
  ([guard.js:37-38](../../scripts/guard.js#L37-L38)); it is the fixture seam §5.1/§5.2 rely on.
- `evaluatePre(payload, adapters, browsers)` — `checkTool(toolName, browsers)`, and the URL-bearing
  test at [guard.js:78](../../scripts/guard.js#L78) becomes a lookup against the loaded adapters'
  `url_bearing` instead of the `URL_BEARING_TOOLS` constant. **`tabs_create_mcp` must stay out of
  `url_bearing`** — [guard.js:26-27](../../scripts/guard.js#L26-L27) and the live finding behind it
  (it opens a blank tab and takes no parameters) still hold; the config carries that fact now.
- `evaluatePost(payload, adapters, browsers)` — **first resolve the bare tool name and bail out with
  `ALLOW` unless it is in the union of `landing_check`.** This gate is load-bearing, not tidiness:
  the existing matcher
  ([hooks.json:17](../../hooks/hooks.json#L17)) is what currently stops `read_page` output being
  scanned, and broadening it to `mcp__.*` without this gate would make every product page a page full
  of third-party links and block every read. See §5.1 and §5.4.
- `evaluate(mode, payload, adapters, browsers)`; `selftest(adapters, browsers)`.

The 32-case selftest matrix ([guard.js:160-204](../../scripts/guard.js#L160-L204)) is **extended, not
rewritten** — its existing rows are the regression guarantee that the default config reproduces
today's behaviour exactly. New rows: a second configured prefix is stripped and allowed; a
configured `landing_check` tool's off-allowlist landing blocks; a non-`landing_check` tool response
full of off-allowlist URLs is allowed; a configured allow-set tool passes under the second configured
prefix. The shipped registry is one adapter with two prefixes, so the "second" case is the
`mcp__Claude_Browser__` prefix — no second-adapter fixture is needed for these rows.

One harness line changes with them, or the new allow-row cannot fail. Today an ALLOW-expected row
**cannot detect an erroneous block**: [guard.js:221](../../scripts/guard.js#L221) hardwires
`blockedAsExpected = true` whenever `expectBlock` is falsy, and the only other check is
`outcome.code !== expectedCode` ([guard.js:223](../../scripts/guard.js#L223)) — so a `post` block, which
exits 0 ([guard.js:116-126](../../scripts/guard.js#L116-L126)), is indistinguishable from a pass. The
loop's non-`expectBlock` branch becomes `!outcome.stdout.includes('"decision":"block"')`, so a row that
omits `expectBlock` asserts the **absence** of a block. This is compatible with every existing row —
`blocked()` and `ALLOW` both set `stdout: ''` ([guard.js:40-43](../../scripts/guard.js#L40-L43)), so the
`pre`-deny rows and the `post`-allow row stay green — and it is what lets the new non-`landing_check`
`post` row (§5.4) fail when the §3.2 gate is reverted.

### 3.3 R3 — the scope seam

[guard.js:22](../../scripts/guard.js#L22):

```js
const AGENT_TYPE = process.env.DEAL_SCOUT_AGENT_TYPE || 'claude-deal-scout:deal-scout';
```

Commented as a portability seam, not a knob, in the style of
[guard.js:37-38](../../scripts/guard.js#L37-L38). The default is unchanged, so the existing scoping
rows in the selftest matrix ([guard.js:162-164](../../scripts/guard.js#L162-L164)) and
[test/guard.test.js](../../test/guard.test.js) keep passing untouched.

### 3.4 R4/R5 — what the code does not need

No script change. The README gets the section, and `test/report.test.js` gains one spawn that runs
`report.js` with `cwd` set to a directory unrelated to the repo, proving R5 rather than asserting it.

### 3.5 The places config cannot reach, stated rather than hidden

`agents/deal-scout.md:4` carries an explicit `tools:` list of `mcp__claude-in-chrome__*` names and
**cannot be templated**. Swapping browsers is therefore a three-step edit — add `browsers/<id>.json`,
rewrite the agent's `tools:` list to that server's names, reload. This is documented in the new README
section and named in the agent file itself, so the next reader does not go looking for a knob that
does not exist. Granting no `tools:` list instead would hand the agent every built-in tool including
`Bash` and `Write`, which is not an option.

## 4. Change list

### 4.1 Files

New:
- `browsers/claude-in-chrome.json`
- `test/browser.test.js`

Modified:
- `scripts/policy.js` — `loadBrowsers`/`validateBrowsers`/`checkTool(tool, browsers)`; remove
  `ALLOWED_TOOLS` and `MCP_PREFIXES`
- `scripts/guard.js` — load browsers, config-driven URL-bearing and landing checks, `AGENT_TYPE`
  seam, extended selftest matrix (incl. the harness's allow-row block assertion, §3.2)
- `hooks/hooks.json` — both matchers to `mcp__.*`
- `agents/deal-scout.md` — a pointer to `browsers/`; no change to the tool list
- `skills/find-best-deal/SKILL.md` — preflight wording: "the configured browser tools", not
  "Claude in Chrome"
- `README.md` — Requires; new "Model and browser independence" section
- `docs/SECURITY.md` — the matcher descriptions at [:60](../../docs/SECURITY.md#L60) and [:65](../../docs/SECURITY.md#L65) (R2: the `post` matcher scope and its rationale) and [:119](../../docs/SECURITY.md#L119) (R9: the `PreToolUse` matcher)
- `test/policy.test.js` — import and iterate the loaded registry
- `test/guard.test.js` — the new selftest rows and a `DEAL_SCOUT_BROWSERS_DIR` fail-closed case
- `test/report.test.js` — the foreign-cwd spawn (R5)
- `.claude-plugin/plugin.json` — `version` bump, per [CLAUDE.md](../../CLAUDE.md); once per bead

### 4.2 Explicitly not touched

- **`scripts/score.js`, `scripts/history.js`, `scripts/report.js`** — verified free of tool names and
  MCP prefixes by grep. They are the portable core; touching them would be scope creep.
- **`sites/*.json` and `loadSites`/`validateSites`** — a different registry. A browser adapter's
  `allow` is a *tool* list, a site adapter's is a *URL path regex* list; folding one into the other
  would make `validateSites`' field checks ambiguous, and
  [adapter.test.js](../../test/adapter.test.js) hardcodes the `shop`/`history` `kind` vocabulary
  ([policy.js:218](../../scripts/policy.js#L218)).
- **`.claude-plugin/marketplace.json` and the plugin name** — user decision, §9.
- **`data/sale-calendar.json`** — unrelated.
- **The 103 existing tests' assertions**, except where §3.1 requires re-pointing the `checkTool`
  imports. No existing test is deleted or weakened.

## 5. Test strategy

### 5.1 What is genuinely at risk

| Risk | Coverage |
|---|---|
| The default config stops reproducing today's 7-tool read-only set — a silent widening of what the agent may call | `test/browser.test.js` asserts the shipped registry's `allow` is exactly the 7 names; the existing deny rows in the selftest matrix and `test/policy.test.js` re-assert them behaviourally |
| A browser MCP other than the shipped one is now *allowed* by default-deny slipping | `test/policy.test.js:196`'s `mcp__some-other-server__navigate` case, kept |
| **The `read_page` false-block.** With a broad matcher, every tool response is seen by the guard; page text is full of third-party links, so scanning it would block every read | New selftest row: a response full of off-allowlist URLs under a non-`landing_check` tool must pass — asserted as the absence of `"decision":"block"` in `stdout`, which needs the §3.2 harness change |
| A broken or empty `browsers/` dir fails *open* | `test/guard.test.js` mirrors its existing `DEAL_SCOUT_SITES_DIR` cases ([:78-83](../../test/guard.test.js#L78-L83)) with `DEAL_SCOUT_BROWSERS_DIR` |
| The scope-before-load ordering regresses, so a broken registry blocks every MCP call session-wide instead of just the deal-scout agent | `test/guard.test.js` asserts a broken `DEAL_SCOUT_BROWSERS_DIR` returns exit 2 for the deal-scout agent and exit 0 for another `agent_type` |
| A malformed adapter is accepted and the run proceeds with a policy that is not what the user thinks | `validateBrowsers` throws; `test/browser.test.js` covers each rejection branch |

### 5.2 New tests

- `test/browser.test.js`
  - `'the shipped browser registry allows exactly the seven read-only tools'` — pins the default
    against the constant it replaces.
  - `'the shipped registry keeps tabs_create_mcp out of url_bearing'` — pins the live H5 finding.
  - `'a landing_check entry must also be in allow'`, `'a tool name claimed by two adapters is
    rejected'`, `'a duplicate server prefix across adapters is rejected'`, `'a bare name containing
    __ is rejected'`, `'loadBrowsers fails closed on a missing directory'`.
- `test/policy.test.js` — `checkTool` rows re-pointed at the loaded registry; one new row:
  `'checkTool strips a second configured prefix'`.
- `test/guard.test.js` — the extended selftest rows above, driven through `spawnSync` against the real
  script; a `DEAL_SCOUT_BROWSERS_DIR` case pointing at a fixture registry; and
  `'a broken registry fails closed for the deal-scout agent but leaves another agent_type untouched'`
  (exit 2 in scope, exit 0 out of scope), which pins the §3.2 load ordering.
- `test/report.test.js` — `'report.js resolves sites and the calendar from its own location, not the cwd'`.

### 5.3 Not covered by any automated test

- **The live `mcp__.*` matcher actually firing.** `hooks.json` is read by the harness, not by this
  repo, so no test in this repo can assert it. This is the same class as the controls
  [docs/SECURITY.md](../../docs/SECURITY.md) already lists as unverified, and it is verified by hand:
  call one allowlisted and one denied Chrome tool through a live session and observe exit 0 / exit 2.
- **A real second browser MCP.** No such server is configured or installed; the story provides the
  seam and proves it with fixtures, and says so rather than implying a tested integration.
- **`DEAL_SCOUT_AGENT_TYPE` under a non-Claude harness.** No such harness is available here.

### 5.4 Negative control (required)

Revert the §3.2 landing-check gate in `evaluatePost` — i.e. scan every matched tool response again —
and the new `'a non-landing_check tool response full of off-allowlist URLs is allowed'` row must
**fail**. This holds only because of the §3.2 harness change: with the gate reverted, `evaluatePost`
returns `{"decision":"block",…}` on **exit 0** ([guard.js:116-126](../../scripts/guard.js#L116-L126)),
and the unmodified harness would accept that for an allow row
([guard.js:221](../../scripts/guard.js#L221), `blockedAsExpected` hardwired `true`). The row catches it
only once the non-`expectBlock` branch asserts the absence of a block in `stdout` (§3.2). That row is
the only thing standing between a broad matcher and a plugin that blocks every product page; if it
passes with the gate removed, it is not testing the gate.

Second control: revert `validateBrowsers`' `landing_check ⊆ allow` check and
`'a landing_check entry must also be in allow'` must fail.

## 6. Risk areas

- **R1 — the broad matcher is a behaviour change for unrelated sessions.** With `mcp__.*`, the guard
  process now spawns on every MCP tool call in every session, not only Chrome ones. It returns
  `ALLOW` immediately for any other `agent_type` — and now does so **before** loading any registry
  (§3.2), so a broken `sites/` or `browsers/` cannot block an unrelated session's MCP calls. The
  spawn itself is real (~40-60 ms). Accepted, because the alternative is a silent allowlist bypass
  (R2). **Do not** narrow the matcher back to a vendor regex to save the spawn.
- **R2 — `${CLAUDE_PLUGIN_ROOT}` is harness-supplied.** Do **not** "fix" it by hardcoding a path or a
  relative one; it is correct for the harness this plugin targets and is documented as such.
- **R3 — two config files must agree.** The agent's `tools:` frontmatter and `browsers/*.json` can
  drift, and nothing mechanical reconciles them. §3.5 documents the edit; a test cannot police a
  Markdown frontmatter against a JSON file without inventing a parser. Named here so it is not
  rediscovered as a bug.
- **R4 — version bump is per bead.** [CLAUDE.md](../../CLAUDE.md) requires a bump on every change to
  the plugin; an installed cache copy goes stale otherwise, and per
  [CLAUDE.md](../../CLAUDE.md) the bump is what `claude plugin update` keys on.

## 7. Pre-flight (needs a decision before bead 01)

**The branch base.** `main` is a single `chore: initial commit`; DS-1's 22 commits are unmerged and
un-PR'd (`git rev-list --left-right --count main...HEAD` → `0 22`). Branching DS-2 off `main` would
land it on an empty repo. The plan therefore branches **off `feat/ds-1-deal-scout-plugin`**, and
Phase 6's PR targets that branch as its base until DS-1 merges. Confirm this, or say whether DS-1
should be PR'd/merged first and DS-2 rebased onto `main`.

> **Resolved at the Phase 2 checkpoint (v1, before cross-review).** The user confirmed both the plan
> as written and the stacked base: the branch is `feat/ds-2-vendor-agnostic-browser-tools`, cut from
> `feat/ds-1-deal-scout-plugin` at `f0e9109`. Phase 6 targets the DS-1 branch. No rebase is planned;
> if DS-1 merges first, this branch's PR base follows it.

## 8. Beads

| # | Bead | Priority | Depends on | Purpose |
|---|---|---|---|---|
| 01 | `config-browsers-registry-and-loader` | P0 | — | `browsers/claude-in-chrome.json`, `validateBrowsers`/`loadBrowsers`, `checkTool(tool, browsers)`, `test/browser.test.js`, re-pointed `test/policy.test.js` |
| 02 | `guard-config-driven-tool-policy` | P0 | 01 | `guard.js` loads browsers, `url_bearing`/`landing_check` replace the constants, `AGENT_TYPE` seam, `hooks/hooks.json` matchers → `mcp__.*`, extended selftest matrix, `test/guard.test.js` |
| 03 | `agent-skill-docs-and-independence` | P0 | 02 | agent/SKILL wording, README independence + "swapping the browser" section, `docs/SECURITY.md` matcher descriptions (`:60`/`:65`/`:119`), `test/report.test.js` foreign-cwd spawn, plugin version bump |

Three beads: **one configuration seam applied in three layers** (loader → enforcement → surface),
which is why it is three and not one — each layer is independently testable and 02 cannot be
verified before 01 exists. No bead is destructive; 02 is the largest and the only one that changes
runtime behaviour. The dependency graph is a straight line 01 → 02 → 03, so there is no ordering
ambiguity and no parallelism.

## 9. Alternatives considered and rejected

**Rename the plugin to `deal-scout`.** Rejected by the user. The name is the marketplace id
([marketplace.json:2](../../.claude-plugin/marketplace.json#L2)), the install command and the hook's
`agent_type` scope ([guard.js:22](../../scripts/guard.js#L22)); renaming is breaking for zero
functional gain, and R3 already provides the seam for a harness that needs a different scope.

**Keep the vendor regex in `hooks.json` and simply add the new prefixes to it.** Rejected: it is the
same static-JSON limitation that created R2, one prefix later, and it leaves the silent-bypass failure
mode in place. It also cannot be done without editing JSON to name a vendor — which is the thing being
removed.

**Fold the browser config into `sites/*.json` as a third `kind`.** Rejected — see §4.2.

**Build a real second browser adapter (e.g. Playwright MCP) now.** Rejected by the user: it needs that
server installed to verify, and the story's job is the seam, not a second integration.

**Generate the agent's `tools:` frontmatter from the registry.** Rejected as unimplementable here —
plugin frontmatter is static Markdown; §3.5 documents the by-hand step instead.

**Have `checkTool` default-load `browsers/` when no argument is passed.** Rejected: it would make an
import read the filesystem, and it hides which policy a caller is being judged against.

## 10. Self-review

**Senior engineer.** The real decision is that the *allowlist's second enforcement layer* — the hook
matcher — has to be broadened rather than configured, because plugin hook matchers are static JSON.
That inverts the file's role: `hooks.json` stops being part of the policy and becomes a dumb
"everything MCP" trigger, with the guard as the single source of truth. That is the right trade (one
policy location, no vendor literal, a stronger default-deny) but it is a genuine behaviour change and
is called out in §6 R1 rather than buried. The rejected alternative — a second vendor regex — is the
same bug one step later.

**QA engineer.** The edge case most likely to be silently untested is the `read_page` false-block
(§5.1): with the broad matcher, a *passing* test suite plus a broken landing-check gate looks
identical to a working one, because the failure only appears against a real page's link-dense text. It
gets an explicit selftest row and a named negative control (§5.4) for exactly that reason. Second is
the empty-`browsers/`-directory case, which must fail *closed* and is mirrored from the existing
`DEAL_SCOUT_SITES_DIR` tests rather than assumed.

**Security engineer.** The change is net-positive on the trust surface: default-deny widens from "one
vendor's MCP server" to "every MCP server", closing a bypass where a configured-but-unmatched browser
was never checked at all. Its one cost — a spawn on every MCP call — is bounded by scoping the
`agent_type` gate ahead of the registry load (§3.2), so a broken config fails closed for this agent
alone, not session-wide. Two new trust inputs appear and both are fail-closed: the `browsers/`
registry (validated on load, throws on ambiguity) and two env vars — `DEAL_SCOUT_BROWSERS_DIR`
(test seam, same class as the existing `DEAL_SCOUT_SITES_DIR`) and `DEAL_SCOUT_AGENT_TYPE`, which
**widens or narrows the guard's scope** and is therefore the one genuinely new capability here. It is
defaulted to today's literal, so the shipped behaviour is unchanged, and it is documented as a
portability seam rather than a configuration knob. No new network access, no credentials, no
persistence, no PII.

## 11. Context docs to refresh (running list)

Seeded from Phase 1. No pre-existing staleness was found in the slice this story touches (the Chrome
coupling is described accurately today). Everything below becomes stale **because of this change**.
Per [CLAUDE.md](../../CLAUDE.md)'s staleness-tracking rule this is a **running list consumed by the
workflow's context-refresh phase**, kept separate from the implementation beads: §4.1's Modified list
and §8 stop at `docs/SECURITY.md` (the one doc bead 03 edits) and are **not** the complete change
scope — the `docs/context/*` rows below are refreshed at the context-refresh step, not by the three
beads.

- `docs/context/INDEX.md:22` — "denies tools/URLs by default; catches off-allowlist landings" → gains
  that the matcher is now `mcp__.*` and the tool set comes from `browsers/`
- `docs/context/INDEX.md:26` — "103 tests, 6 files" → new count and 7 files
- `docs/context/INDEX.md:24` — the `sites/` row → a `browsers/` row alongside it
- `docs/context/api-surface.md:18-19` — the two hook matcher rows: `mcp__(claude-in-chrome|Claude_Browser)__.*` → `mcp__.*`
- `docs/context/api-surface.md:70` — the `policy.js` module-exports row names `ALLOWED_TOOLS` (removed) and `checkTool` (signature → `checkTool(tool, browsers)`); the export list also gains `loadBrowsers`/`validateBrowsers`
- `docs/context/workflows.md:62` — the `checkTool(tool_name)` node in the pre-flow diagram → `checkTool(toolName, browsers)`
- `docs/context/architecture.md:71-72` — the policy-layer I/O claim ("No I/O beyond reading
  `sites/*.json`") gains "and `browsers/*.json`", and the export list naming `checkTool` → the new
  signature (plus `loadBrowsers`/`validateBrowsers`)
- `docs/context/architecture.md:63-64` — the same matcher claim in **both** the `pre` row (`:63`) and
  its `post` sibling (`:64`, `...__(navigate|tabs_context_mcp)`) → `mcp__.*`
- `docs/context/architecture.md:106` — the env-seam table: add `DEAL_SCOUT_BROWSERS_DIR`, `DEAL_SCOUT_AGENT_TYPE`
- `docs/context/architecture.md:95-96` — the "### 8. Data" enumeration ("`sites/*.json` … and
  `data/sale-calendar.json` … Both are data") gains `browsers/*.json` ("Both" → three)
- `docs/context/architecture.md:152` — "Claude in Chrome MCP tools … the only way the plugin sees a page" → the configured browser tools
- `docs/context/conventions.md:49-50` — "the two documented seams" (the phrase and the count are on
  `:49`; `:50` only enumerates them) → four
- `docs/context/conventions.md:42` — "Only `loadSites`/`validateSites` throw" → add
  `loadBrowsers`/`validateBrowsers` (§3.1; "Only" makes it an exhaustive set)
- `docs/context/conventions.md:84-86` — the enumerated test-file list ("one test file per script" +
  the six paths) gains `test/browser.test.js`, and "one test file per script" needs the caveat
  (`policy.js` then has two test files: `policy.test.js` + `browser.test.js`)
- `docs/context/conventions.md:25-26` — "a new site is a new `sites/*.json`, a shifted sale window is
  an edit to `data/sale-calendar.json`" → the data-file set gains `browsers/*.json`
- `docs/context/conventions.md:96` — "The list is plan §5.4 (**8 controls**, mutation-and-revert)" →
  ten (§5.4 adds two: the §3.2 `landing_check` gate, the `landing_check ⊆ allow` check)
- `docs/context/build-and-run.md:77` — the `CLAUDE_PLUGIN_ROOT` env table → add the new vars
- `docs/context/security-and-permissions.md:25` — the allowlisted-tool-set description, citing the
  removed `ALLOWED_TOOLS` (`policy.js:16-24`) → the `browsers/` registry
- `docs/context/security-and-permissions.md:55` — the H2 row's "which is why the post hook also
  matches `tabs_context_mcp`" → the `landing_check` gate (§3.2), not the matcher
- `docs/context/testing-and-quality.md:10` — "bespoke 32-case matrix", and `:15` — "103 tests, 103
  pass, 0 fail" (both counts change with this story's new rows and files)
- `docs/context/testing-and-quality.md:20-25` — the per-file "Tests" table (12 / 20 / 10 / 24 / 32 /
  5): the counts change and the file set gains `test/browser.test.js`
- `docs/context/testing-and-quality.md:50` — "**eight** mutation-and-revert controls" → ten (§5.4
  adds two); the section (`:47-96`) also gains the two new enumerated controls and result rows
- `docs/context/testing-and-quality.md:61` — the flip-direction partition "Controls 1–5 and 8 flip
  pass → fail; 6–7 flip fail → pass" → "1–5, 8, 9 and 10" (both §5.4 controls 9–10 are pass → fail)
- `docs/context/testing-and-quality.md:63-64` — "**All eight** were executed and reverted" and its
  recorded-results table → ten
- `docs/context/glossary.md:66` — the "negative control" term's "8 specified, all 8 run" → ten
- `docs/context/build-and-run.md:14,17,59` — "103 tests across 6 files" (`:14`), `selftest OK: 32
  cases` (`:17`, `:59`) → the new counts and 7 files
- `docs/context/api-surface.md:37,38,55` — "the 32-case matrix" (`:37`) and `selftest OK: 32 cases`
  (`:38`, `:55`) → the new case count
- `docs/context/architecture.md:65` — "run the 32-case policy matrix" → the new case count
- `docs/context/workflows.md:26` — `selftest OK: 32 cases` in the sequence diagram → the new case count
- `docs/context/INDEX.md:75-76` — the refresh note's `103/103 pass` / `selftest OK: 32 cases` → the new
  counts
- `docs/context/INDEX.md:41` — the testing-and-quality row's "103 tests, 32-case selftest matrix"
  **and** "the 8 mutation controls" (all three phrases go stale with it; the last moves to ten, §5.4)
- `docs/context/workflows.md:81-82` — "the landed URL has to be read from a `tabs_context_mcp`
  listing — which is why the hook matcher covers both tools" → the reason is now the guard's
  `landing_check` gate (§3.2), not the matcher
- `docs/context/workflows.md:109-110` — "Runs at the top of **every** guard invocation" (§4, the
  adapter-load flow) → the load is now scoped, so it runs only for in-scope calls (§3.2); the §4
  flow also gains `browsers/*.json` alongside `sites/*.json`
- `docs/context/data-model.md:120` — the "Allowed tools" row cites the removed `ALLOWED_TOOLS`
  (`policy.js:16-24`) → the `browsers/claude-in-chrome.json` registry
- `docs/context/data-model.md:10` — "Four contracts:" → five (the registry gains a browser-adapter
  contract, `browsers/*.json`, alongside the site-adapter one)
- `docs/context/data-model.md:139-140` — "Artifacts that *are* version-controlled data: `sites/*.json`,
  `data/sale-calendar.json`. Both are edited by hand; neither is generated." → add `browsers/*.json`
  ("Both"/"neither" → three)
- `docs/context/architecture.md:102` — the "Enablement / gating" row cites `policy.js:16-24` (removed
  `ALLOWED_TOOLS`) and says the tool allowlist is "centralized in `policy.js`" → the `browsers/` registry
- `docs/context/api-surface.md:96` — "frontmatter `tools:` lists exactly seven … tools" cites
  `policy.js:15-24` (removed `ALLOWED_TOOLS`) → the `browsers/` registry / the agent frontmatter
- `docs/context/api-surface.md:40` — the section heading "Why `tabs_create_mcp` is not in
  `URL_BEARING_TOOLS`" names the removed `guard.js:29` constant → the config's `url_bearing`
- `docs/SECURITY.md:60` — R2's description of the `post` hook as "PostToolUse on `navigate` and
  `tabs_context_mcp`": the enumerated matcher → `mcp__.*`, the tool restriction now the guard's
  `landing_check` gate (§3.2)
- `docs/SECURITY.md:65` — R2's "the real landing URL appears in a `tabs_context_mcp` listing, which is
  why the hook now matches that tool too" → the reason is now the `landing_check` gate (§3.2), not the
  matcher
- `docs/SECURITY.md:119` — the `PreToolUse` matcher claim
- **Catch-all (class closure).** Any `docs/context/*` or `docs/SECURITY.md` line whose stated count,
  set, or enumeration is moved by this change — and that is *not* individually listed above — must
  still be reconciled by the context-refresh phase. This closes the count/enumeration class by
  construction: every such line is covered here, so no further per-line sweep is required.

## Change History

### v1 (draft)

Written against the code at `f0e9109` (DS-1 branch tip) after a Phase 1 read of `policy.js`,
`guard.js`, `report.js`, `hooks/hooks.json`, `agents/deal-scout.md`, `SKILL.md`, `adapter.test.js`,
`policy.test.js` and the `docs/context/` set, with a green baseline re-measured in the same pass
(`npm test` → 103/103; `node scripts/guard.js selftest` → 32 cases). Scope fixed by three user
answers in Phase 1: Claude Code plugin only, pluggable browser with Chrome as default, name
unchanged. Not yet cross-reviewed.

### v2 (round 1 cross-review)

Applied all five round-1 findings (F1.1–F1.5, all JUSTIFIED; none argued for a rename or a
multi-harness port, so none rejected on the scope override). F1.1: §3.2 now scopes the `agent_type`
gate (and the payload object-check) **ahead** of the registry load in `run()`, so a broken
`sites/`/`browsers/` fails closed for the deal-scout agent only and cannot block unrelated sessions;
§6 R1 corrected to match; §5.1 gains the availability risk row and §5.2 the `test/guard.test.js`
regression that pins the ordering; §10 notes the bound. F1.2: §2 R5 reworded to include the two hook
commands (`hooks/hooks.json:10,21`). F1.3: §3.1 corrected — only `ALLOWED_TOOLS` has a test import
(`policy.test.js:8`); `MCP_PREFIXES` is module-private. F1.4: §3.2/§5.2 say "second configured
prefix", not "server". F1.5: §11 gains `api-surface.md:70`, `workflows.md:62`, `architecture.md:72`
and is marked as a context-refresh running list, not bead scope. Also declared the
`DEAL_SCOUT_BROWSERS_DIR` seam in §3.2 (a carried, non-gating note). Full record:
`review/round-1/triage.md` and `review/round-1/changelog.md`.

### v3 (round 2 cross-review)

Applied both round-2 findings (F2.1, F2.2, both JUSTIFIED; neither argues for a rename or a
multi-harness port, so none rejected on the scope override). F2.1 (MAJOR, test-trace): the §5.4
negative control could not fail — the selftest harness hardwires `blockedAsExpected = true` for an
ALLOW-expected row ([guard.js:221](../../scripts/guard.js#L221)) and a `post` block exits 0
([guard.js:116-126](../../scripts/guard.js#L116-L126)), so a reverted gate left the new row passing.
§3.2 now declares the one-line harness change (the non-`expectBlock` branch asserts the **absence** of
`"decision":"block"`), verified compatible with every existing row; §5.4 rewritten to name that
dependency; §5.1's risk row and §4.1's `guard.js` line updated to match. F2.2 (MINOR, stale-xref): §11
re-pointed from the blank `testing-and-quality.md:41` to `:10`/`:15`, and a sibling row added for
`INDEX.md:41` (the line the quote actually came from). Full record: `review/round-2/triage.md` and
`review/round-2/changelog.md`.

### v4 (round 3 cross-review)

Applied all four round-3 findings (F3.1–F3.4, all MINOR `stale-xref`, all JUSTIFIED; none argues for
a rename or a multi-harness port, so none rejected on the three scope overrides), and closed the
mandated **CLASS SWEEP** for `stale-xref` by adding every omitted sibling the sweep named plus three
further genuine siblings it did not. §11 gains rows for the count-holding siblings
(`build-and-run.md:14,17,59`; `api-surface.md:37,38,55`; `architecture.md:65`; `workflows.md:26`;
`INDEX.md:75-76`; `testing-and-quality.md:20-25`); the matcher rows are corrected (`architecture.md:63`
→ `:63-64`, plus `workflows.md:81-82` and `security-and-permissions.md:55`); `data-model.md:120` is
added; `conventions.md:50` re-pointed to `:49-50`; and the sweep found `architecture.md:102`,
`api-surface.md:96` and `api-surface.md:40` carrying the same now-stale `ALLOWED_TOOLS` /
`URL_BEARING_TOOLS` cites. Nothing outside §11 and this header changed; §1–§10 are untouched. Full
record: `review/round-3/triage.md` and `review/round-3/changelog.md`.

### v5 (round 4 cross-review)

Applied both round-4 findings (F4.1, F4.2, both MINOR `stale-xref`, both JUSTIFIED; neither argues
for a rename or a multi-harness port, so none rejected on the three scope overrides). F4.1: `§11`
gains rows for the two `docs/SECURITY.md` R2 siblings the sweep had missed — `:60` (the enumerated
`post` matcher, `PostToolUse on navigate and tabs_context_mcp`) and `:65` (its "which is why the
hook now matches that tool too" rationale) — both made false by the `mcp__.*` matcher change, which
moves the tool restriction to the guard's `landing_check` gate (§3.2); §4.1's bead-03 file note and
§8's bead-03 cell are widened to name all three matcher lines (`:60`/`:65`/`:119`). F4.2: the
`docs/SECURITY.md:148` row is dropped as an over-correction — that line is the raw preflight command
and carries no count, so the change does not touch it. Also reconciled §8's bead-03 cell, which said
"matcher row" (singular). No other §11 row changed; §1–§10 are untouched. Full record:
`review/round-4/triage.md` and `review/round-4/changelog.md`.

### v6 (round 5 cross-review)

Applied the one round-5 finding (F5.1, MINOR `stale-xref`, JUSTIFIED; it argues for neither a rename
nor a multi-harness port, so none rejected on the three scope overrides). F5.1: §5.4's two new
mutation-and-revert controls move the repo-wide negative-control count the context docs state as
**eight** to **ten**, and §11 named no line for it. Added §11 rows for
`docs/context/testing-and-quality.md:50`, `:63-64`, `docs/context/glossary.md:66` and
`docs/context/conventions.md:96`, and widened the `docs/context/INDEX.md:41` row to name "the 8
mutation controls" as its third stale phrase (alongside "103 tests" and "32-case selftest matrix").
Closed the mandated **CLASS SWEEP** (`stale-xref`, confirmation pass) by enumerating every prose
count/claim axis the change touches in one pass — test totals, file count, selftest case count,
negative-control count, env-seam count, matcher count, and the "seven read-only tools" set — and
confirming every axis but the negative-control count was already fully listed; the control-count axis
is now reconciled in all five places it appears. No other §11 row changed; §1–§10 are untouched.
Full record: `review/round-5/triage.md` and `review/round-5/changelog.md`.

### v7 (round 6 cross-review)

Applied all four round-6 findings (F6.1–F6.4, all MINOR `stale-xref`, all JUSTIFIED; none argues for a
rename or a multi-harness port, so none rejected on the three scope overrides). All four are
*exhaustive-enumeration / uniqueness* lines in `docs/context/*` that this change silently falsifies:
F6.1 `conventions.md:42` ("Only `loadSites`/`validateSites` throw" → add
`loadBrowsers`/`validateBrowsers`); F6.2 `conventions.md:84-86` (the enumerated test-file list gains
`test/browser.test.js`); F6.3 `architecture.md:71` (the policy-layer I/O claim gains "and
`browsers/*.json`"; the existing `:72` row is widened to `:71-72`); F6.4 `testing-and-quality.md:61`
(the flip-direction partition → "1–5, 8, 9 and 10"). Closed the mandated **CLASS SWEEP** (`stale-xref`)
over every `docs/context/*` and `docs/SECURITY.md` line making an exhaustive/count/set/partition
claim, adding rows for the four siblings the four findings did not name: `architecture.md:95-96` and
`data-model.md:139-140` (the data-file "Both"/"neither" enumerations gain `browsers/*.json`),
`data-model.md:10` ("Four contracts" → five), `conventions.md:25-26` (the data-file set gains
`browsers/*.json`), and `workflows.md:109-110` (the adapter load now runs only for in-scope guard
calls, §3.2). Added ONE catch-all §11 note that closes the class structurally. No other §11 row
changed; §1–§10 are untouched. Full record: `review/round-6/triage.md` and
`review/round-6/changelog.md`.

**v7 (converged) — round 7 terminal review.** Round 7 returned `VERDICT: NO_FURTHER_FINDINGS`
(0 findings: no BLOCKER/MAJOR/MINOR/NIT). The `stale-xref` class, which had recurred in rounds 1–6,
is closed by the round-6 catch-all §11 note; the round-7 mandated sweep found no genuine new
instance, and no missing §11 row rose to a material defect. §1–§10 were re-verified against source
and every load-bearing cite is accurate. **The version is held at 7** — a terminal round makes no
content change, only the header status flip to `status=converged`. Full record:
`review/round-7/triage.md` and `review/round-7/changelog.md`.
