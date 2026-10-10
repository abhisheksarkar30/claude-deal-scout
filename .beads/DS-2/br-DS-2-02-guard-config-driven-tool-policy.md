# Bead br-DS-2-02: Make the guard's tool policy config-driven, and match all MCP in `hooks.json`

**Plan Reference**: `docs/planning/DS-2-vendor-agnostic-browser-tools.md` **v8**, §3.2 (the guard's
behaviour and the matcher), §3.3 (the scope seam), §2 R2/R3, §4.1 (Modified), §5.1 (risk rows), §5.2
(`guard.test.js`), §5.4 (first control — required), §6 R1 (the accepted cost), §6 R4 (version bump), §8
(this bead's scope after the Phase 4 re-seam). Repo `D:\github\claude-deal-scout`. Cited by section
rather than line: the plan's line numbers have already moved twice; the source-file line numbers below
are stable at `f0e9109`.

- **Bead ID**: br-DS-2-02
- **Priority**: P0 (critical — the only bead that changes runtime behaviour)
- **Status**: done
- **Original Estimate**: 2-2.5h
- **Dependencies**: br-DS-2-01
- **Blocks**: br-DS-2-03
- **Commit**: `feat(DS-2): config-driven guard tool policy + mcp__.* matchers (br-DS-2-02)`

## Description

Make the guard judge against the loaded `browsers` registry instead of the remaining hardcoded
constants, broaden both `hooks/hooks.json` matchers to `mcp__.*`, move the `agent_type` scope gate
ahead of the registry load, and extend the selftest matrix. This is §3.2 plus §3.3.

**br-DS-2-01 already did**: created `browsers/claude-in-chrome.json`, added `loadBrowsers`/
`validateBrowsers`, changed `checkTool` to `(tool, browsers)`, removed `ALLOWED_TOOLS`/`MCP_PREFIXES`,
added `BROWSERS_DIR` and `loadBrowsers` to `guard.js`, and threaded `browsers` through
`run`/`evaluate`/`evaluatePre`/`selftest`. **This bead does none of that again** — it changes what the
guard *does* with the registry. Confirm 01 is green before starting (`npm test`, then
`node scripts/guard.js selftest` → `32 cases`).

**Config-driven `url_bearing` (§3.2).** `evaluatePre` tests `URL_BEARING_TOOLS.includes(bare)` at
`guard.js:78`. Replace the `URL_BEARING_TOOLS` constant (`guard.js:24-29`) with a lookup against the
loaded adapters' `url_bearing`. **`tabs_create_mcp` must stay out of `url_bearing`** — the live finding
behind `guard.js:26-27` (it opens a blank tab and takes no parameters, so it is not URL-bearing) still
holds; the registry carries that fact now, and `test/browser.test.js` (bead 01) pins it. Delete the
constant once nothing reads it.

**The landing-check gate — load-bearing, not tidiness (§3.2).** `evaluatePost` must **first resolve the
bare tool name and return `ALLOW` unless it is in the union of the loaded adapters' `landing_check`**,
then do the URL scan as today (`guard.js:110-130`). Resolving the bare name needs the prefix strip:
reuse `checkTool`'s result, or extract the prefix-strip so both callers share it — but do **not**
deny-and-block here: a non-`landing_check` tool is *allowed*, it is only its response that is not
scanned. Without this gate, broadening the matcher to `mcp__.*` would scan every matched tool
response — and a real product page is full of third-party links, so `read_page` would be blocked every
time. See §5.1 and §5.4; this is the one row standing between a broad matcher and a plugin that blocks
every page.

**Broaden the matchers (§3.2).** `hooks/hooks.json:6` (`PreToolUse`) and `hooks/hooks.json:17`
(`PostToolUse`) both become `"mcp__.*"`. This **strengthens** the model — default-deny widens from one
vendor's server to every MCP server — at the cost of one process spawn per MCP call session-wide (§6
R1, ~40-60 ms). **Do not** narrow it back to a vendor regex to save the spawn.

**Reword the file's own description (§4.1, now required — see the plan's v8 entry).**
`hooks/hooks.json:2` currently says the scope is enforced inside the guard "so this never affects
ordinary Claude in Chrome use". Once the matcher is `mcp__.*` the guard spawns for **every** MCP call
and returns `ALLOW` for other scopes, so that sentence is false. Reword it to say what is now true —
the guard runs on all MCP tool calls and is a no-op for any `agent_type` other than the deal-scout
one — rather than leaving a false claim in the file that documents the control. This is a one-line
text edit, not a behaviour change.

**The scope gate moves ahead of the registry load (§3.2) — and `selftest` must keep working.** Today
`run()` loads `sites/` first (`guard.js:243-245`) and `evaluate` does the `agent_type` scope check
(`guard.js:141`). Reorder `run(mode)` so that:

1. `selftest` is handled first and unchanged in effect: it loads **both** registries (the matrix needs
   `adapters` and `browsers`) and calls `selftest(adapters, browsers)`; it reads no payload.
2. For `pre`/`post`: read the payload, validate it is an object (exit 2 otherwise, as today —
   `guard.js:137-139`, pinned by `test/guard.test.js:64-68` and it must survive the move), then apply
   the `agent_type` scope gate and return `ALLOW` (exit 0) for an out-of-scope `agent_type` —
   **before loading any registry**, so a broken `sites/` or `browsers/` cannot block an unrelated
   session's MCP calls.
3. Only an in-scope call loads `loadSites(SITES_DIR)` and `loadBrowsers(BROWSERS_DIR)`, so a broken
   registry still fails closed (exit 2) for the deal-scout agent exactly as today.

`evaluate` **keeps its own** object-check and scope check (`guard.js:137-141`) so the selftest matrix's
scoping rows (`guard.js:162-164`, which pass an out-of-scope `agent_type` and expect a *decision*) stay
unchanged. A reorder that breaks `selftest` is wrong — verify with `node scripts/guard.js selftest`
(must exit 0) immediately after the reorder, before doing anything else. The `run()` catch-all must
also keep turning any throw into exit 2 (`guard.js:145-149`); only the *ordering* changes, never the
fail-closed behaviour.

**`AGENT_TYPE` seam (§3.3).** `guard.js:22` becomes:

```js
const AGENT_TYPE = process.env.DEAL_SCOUT_AGENT_TYPE || 'claude-deal-scout:deal-scout';
```

Commented as a portability seam, not a configuration knob, in the style of `guard.js:37-38`. The
default is unchanged, so the existing scoping rows (`guard.js:162-164`) and the existing
`test/guard.test.js` scoping cases keep passing untouched. Note what this seam is: per §10 it is **the
one genuinely new capability in this story**, because it decides which agent's tool calls the guard
judges at all. It is therefore tested, not merely defaulted (see Test Specifications).

**Extend the selftest matrix — extend, never rewrite (§3.2).** `SELFTEST_CASES` (`guard.js:160-204`)
keeps **every** existing row — they are the regression guarantee that the default registry reproduces
today's behaviour exactly — and gains four:

- a second configured prefix is stripped and allowed (the `mcp__Claude_Browser__` prefix; the shipped
  registry is one adapter with two prefixes, so no second-adapter fixture is needed);
- a configured `landing_check` tool's off-allowlist landing blocks;
- a **non-`landing_check`** tool response full of off-allowlist URLs is **allowed** (the `read_page`
  false-block guard, §5.1);
- a configured allow-set tool passes under the second configured prefix.

`selftest(adapters, browsers)` keeps its signature from bead 01; `evaluate(mode, payload, adapters,
browsers)` likewise.

**The harness change — one line, and the new allow-row cannot fail without it (§3.2).** `guard.js:221`
hardwires `blockedAsExpected = true` whenever `expectBlock` is falsy, and the only other check is
`outcome.code !== expectedCode` (`guard.js:223`); a `post` block exits 0 (`guard.js:116-126`), so a
`post` block is indistinguishable from a pass. Change the loop's non-`expectBlock` branch to assert the
**absence** of a block:

```js
const blockedAsExpected = expectBlock
  ? outcome.stdout.includes('"decision":"block"')
  : !outcome.stdout.includes('"decision":"block"');
```

This is a **test-harness change, not a test addition.** It is compatible with every existing row —
`blocked()` and `ALLOW` both set `stdout: ''` (`guard.js:40-43`), so the `pre`-deny rows and the
`post`-allow row stay green — and the plan's §3.2 verified it against all 103 existing tests. It is
what lets the new non-`landing_check` `post` row fail when the landing-check gate is reverted (§5.4).
Without it, §5.4's first control passes with and without the gate and tests nothing.

**Version bump (§6 R4).** Bump `version` in `.claude-plugin/plugin.json` — once per bead.

## Rationale

The hook matcher is static JSON and cannot be templated, so a configured browser whose prefix the
matcher omits is never checked at all — the allowlist silently does not apply to it. That is R2, the
plan's silent lock-in, and it is the reason this story exists. `hooks/hooks.json` therefore stops being
part of the policy and becomes a dumb "everything MCP" trigger, with the guard as the single source of
truth. The `agent_type` gate moves ahead of the loads so that widening the matcher cannot let a broken
registry block unrelated sessions — the regression the plan's round-1 review caught.

This is one bead because every part of it lives in `scripts/guard.js` plus its one-line matcher, and
they are mutually dependent: the matcher change requires the landing-check gate, and the gate requires
the registry's `landing_check`. You cannot land half of it and have a working guard.

## Outcome Definition

- `node --test test/guard.test.js` exits **0**.
- `node scripts/guard.js selftest` exits **0** and prints a case count **larger than 32** (baseline
  `selftest OK: 32 cases`; the four new rows grow it).
- `npm test` exits **0** (green before this bead too — bead 01 was already green).
- **Negative control (plan §5.4, first — required).** Revert the landing-check gate in `evaluatePost`
  (scan every matched tool response again) and `'a non-landing_check tool response full of off-allowlist
  URLs is allowed'` must **fail**. This holds only because of the harness change above: with the gate
  reverted, `evaluatePost` returns `{"decision":"block",…}` on **exit 0** (`guard.js:116-126`) and an
  unmodified harness accepts that for an allow row. Run once, revert, confirm `scripts/guard.js` is
  byte-identical, record the observed failing test name in Review Notes.
- **Manual / recorded** (plan §5.3): the live `mcp__.*` matcher actually firing cannot be asserted by
  any test in this repo — `hooks.json` is read by the harness, not by this repo. Verify by hand (call
  one allowlisted and one denied Chrome tool through a live session, observe exit 0 / exit 2), record
  the result in Review Notes or `.beads/DS-2/evidence-02.txt`, and state plainly if the live check was
  not performed. This is the same class as the controls `docs/SECURITY.md` already lists as unverified.

## Test Specifications

- `test/guard.test.js` (modify — the helpers at `:14-37` spawn the real script and are the pattern):
  - the four extended selftest rows above, driven through `spawnSync` against the real
    `scripts/guard.js`;
  - a `DEAL_SCOUT_BROWSERS_DIR` case pointing at a fixture registry, mirroring the existing
    `DEAL_SCOUT_SITES_DIR` cases (`:74-87`) — a broken/empty browsers dir must fail **closed**;
  - `'a broken registry fails closed for the deal-scout agent but leaves another agent_type untouched'`
    — with `DEAL_SCOUT_BROWSERS_DIR` pointing at a broken fixture: exit 2 for the deal-scout
    `agent_type`, exit 0 for another `agent_type`. This pins the load ordering;
  - `'DEAL_SCOUT_AGENT_TYPE moves the guard's scope, and the default is unchanged when it is unset'` —
    with `DEAL_SCOUT_AGENT_TYPE` set to an alternative name, a payload carrying that `agent_type` and a
    denied tool must exit 2; with the variable unset, the same payload must exit 0. Pins §3.3, which
    §5.1 now lists as a risk because the seam decides what the guard judges at all;
  - **keep every existing case** (`:43-227`) — scoping, default-deny, URL policy, `post` — unchanged.
    They are the regression guarantee and must not be weakened. If one fails, the behaviour changed
    when it should not have.
- **Manual / recorded**: the §5.4 first control and the live-matcher check, in Review Notes.

## Files to Touch

- `scripts/guard.js` (modify — config-driven `url_bearing` and the `landing_check` gate, `AGENT_TYPE`
  env seam, the `run()` scope-before-load reorder preserving `selftest`, the extended selftest matrix,
  the one-line harness change at `:221`)
- `hooks/hooks.json` (modify — both matchers → `mcp__.*`; the `:2` description reworded)
- `test/guard.test.js` (modify — extended rows, `DEAL_SCOUT_BROWSERS_DIR` fail-closed case,
  scope-ordering case, `DEAL_SCOUT_AGENT_TYPE` case)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**What was built.** `URL_BEARING_TOOLS` is gone, replaced by `isUrlBearing(bare, browsers)`; a new
`isLandingChecked(bare, browsers)` gates `evaluatePost`, which now takes `browsers` and returns
`ALLOW` unless the tool is in the registry's `landing_check`. `AGENT_TYPE` reads
`DEAL_SCOUT_AGENT_TYPE` with the old literal as its default. `run()` handles `selftest` first (it
still loads both registries and reads no payload), then for `pre`/`post` reads the payload, checks it
is an object, and returns 0 for an out-of-scope `agent_type` **before** either registry is loaded —
so a broken `sites/` or `browsers/` cannot block an unrelated session's MCP calls now that the
matcher fires on all of them. The header JSDoc was rewritten: it had described `post` as matching
`navigate, tabs_context_mcp` and claimed ordinary Chrome use is never touched, both of which this
bead falsifies. Both `hooks.json` matchers are `mcp__.*` and the file's `description` now says what
is actually true, rather than that the guard never affects ordinary Claude in Chrome use.

**The landing-check gate is the load-bearing change**, and it is the reason the `read_page`
false-block does not happen: the response of a page-text tool *is* the page. Without the gate the
matcher change would have turned every product page into a block. `isLandingChecked` is written as a
separate question from the allow set on purpose — they must not drift together.

**Deviation.** None from the bead as written. Two judgement calls worth naming: (1) `evaluatePost`
returns `ALLOW` for a tool `checkTool` rejects rather than blocking — a tool outside the allow set is
`pre`'s job, and `post` is a landing check, not a second allowlist; (2) the harness change was
applied exactly as §3.2 specifies, in the same commit as the rows that depend on it.

**Verification observed.**
- `npm test` → `tests 121 / pass 121 / fail 0` (was 116 after br-DS-2-01; 5 new guard cases).
- `node scripts/guard.js selftest` → `selftest OK: 36 cases`, exit 0 (was 32; the four new rows).
- Every pre-existing selftest row and every pre-existing `test/guard.test.js` case still passes
  untouched. That is the regression guarantee: the default registry reproduces the old behaviour.

**Negative control (plan §5.4, first) — run, and it failed as required.** Reverted the gate to
`if (!toolCheck.ok) return ALLOW;` (dropping the `landing_check` half). Result:
`selftest MISS: allow: a page-text tool response full of off-allowlist URLs is not scanned — expected
exit 0, got exit 0`, then `selftest FAILED: 1 of 36 cases missed`, exit 1. The `expected exit 0, got
exit 0` in that message is the whole point of the harness change: the failure is a `{"decision":
"block"}` on stdout with an unchanged exit code, which the old harness could not see. Restored the
gate, re-ran: `36 cases`, `121/121`.

**The live `mcp__.*` matcher check was NOT performed — stated plainly, not glossed.** This session
has no `mcp__claude-in-chrome__*` tools bound, so there was no live session to drive an allowlisted
and a denied call through. The plan's §5.3 already classes this as unverifiable by any test in this
repo; it stays unverified here, and it is the one item in this bead whose evidence is absent rather
than green.

**Operational consequence, for the PR body.** `hooks.json` is read by the harness from the
*installed* plugin copy, so these matcher changes do not take effect until
`claude plugin update claude-deal-scout@claude-deal-scout` plus a reload. The `plugin.json` version
bump in this bead (0.1.4) is what makes that update pick the change up — without it the cached copy
would keep the old vendor-scoped matchers, and the guard would silently not run for the tools this
story exists to make pluggable.

**Deliberately not done here.** No `docs/context/*` or `docs/SECURITY.md` edit — those are br-DS-2-03
and the context-refresh phase respectively. The `$CLAUDE_PLUGIN_ROOT` in the hook commands is
untouched.

### Cross-review (Phase 5.5) — one gap found and fixed

The delegated `autonomous-loop:impl-conductor` could not run: its subagent model returned HTTP 502
then 400 on three dispatches. An independent fresh-context reviewer was used instead, on a different
model, with the same brief. It re-ran the §5.4 first control, confirmed the byte-identical restore,
and raised one gap here besides the two it confirmed elsewhere.

**The `evaluatePost` gate was too permissive on a malformed payload.** It read
`if (!toolCheck.ok || !isLandingChecked(...)) return ALLOW;` — so a `post` payload whose
`tool_name` was missing or unresolvable skipped the scan entirely, where the pre-change code scanned
every response. Unreachable through the real harness (PostToolUse always carries a tool name), but it
is a fail-open in a security scan, and the direction this repo takes on ambiguity is to fail closed.
Now `if (toolCheck.ok && !isLandingChecked(...))` — the gate skips only a tool it can *positively*
identify as not landing-checked, and an unresolvable name falls through to the scan. This is a
deliberate deviation from plan §3.2's wording ("bail out with `ALLOW` unless it is in the union of
`landing_check`"), which assumes a resolvable tool; it tightens the control without changing any
reachable behaviour.

Two selftest rows pin the polarity — `deny: post whose tool name does not resolve is still scanned`
and `deny: post carrying no tool name at all is still scanned` — and both were mutation-checked:
reverting to `!toolCheck.ok ||` fails exactly those two (`2 of 38 cases missed`). Selftest is now
**38 cases**, `npm test` **122/122**.

Everything else the reviewer checked came back clean: the `landing_check` gate is load-bearing and
genuinely distinct from `allow`; the `run()` reorder preserves fail-closed on `pre`/`post` and the
`selftest` path; the harness change is compatible with every row; §4.2's files are untouched; and
removing `ALLOWED_TOOLS`/`MCP_PREFIXES` did not weaken the suite, since `test/policy.test.js` now
iterates the loaded registry per-adapter.
