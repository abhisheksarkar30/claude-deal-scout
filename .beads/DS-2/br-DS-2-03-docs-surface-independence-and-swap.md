# Bead br-DS-2-03: Document the browser registry and independence, and prove R5 with a test

**Plan Reference**: `docs/planning/DS-2-vendor-agnostic-browser-tools.md` **v8**, §3.4, §3.5, §2 R4/R5,
§4.1 (Modified), §5.2 (`report.test.js`), §6 R2/R3, §9 (the name is unchanged), §6 R4 (version bump), §11
(context-refresh running list — **not** this bead's scope). Repo `D:\github\claude-deal-scout`. Cited by
section rather than line: the plan is a living document and its line numbers have already moved twice; the
source-file line numbers below are stable at `f0e9109`.

- **Bead ID**: br-DS-2-03
- **Priority**: P0 (high — without it the registry is invisible and the independence claim is unstated,
  which is the whole point of the story)
- **Status**: done
- **Original Estimate**: 1-1.5h
- **Dependencies**: br-DS-2-02
- **Blocks**: None
- **Commit**: `docs(DS-2): browser registry, independence and swap docs (br-DS-2-03)`

## Description

The surface layer: make the new configuration visible, state the model/browser-independence facts where a
reader will look, and pin the one factual claim (R5) with a test. No runtime code changes here.

**`agents/deal-scout.md` (§3.5 lines 165-172).** `agents/deal-scout.md:4` carries an explicit `tools:` list
of `mcp__claude-in-chrome__*` names and **cannot be templated**. Add a pointer (in the body prose, since the
frontmatter is machine-read) to `browsers/`, and state the **three-step swap**: add `browsers/<id>.json`,
rewrite the agent's `tools:` list to that server's names, reload — so the next reader does not go looking
for a knob that does not exist. **Do not change the `tools:` list itself** (per §4.1, "no change to the
tool list"); the shipped default is Claude in Chrome. Note plainly that granting no `tools:` list instead
would hand the agent every built-in tool including `Bash` and `Write`, which is not an option (§3.5).

**`skills/find-best-deal/SKILL.md` (§4.1 line 190).** The preflight at `SKILL.md:22-24` says "confirm the
Claude in Chrome tools are available in this session". Reword to "the configured browser tools" — the
vendor-agnostic phrasing. Keep the preflight command at `SKILL.md:17`
(`node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.js" selftest`) unchanged; it is still the one harness-supplied
path (§6 R2 — do not "fix" it). Also reword `SKILL.md:58` — "It has only the seven read-only browsing
tools" — to "the configured read-only browser tools": the count is now a property of
`browsers/*.json`, not of the prompt, and restating a number here is the same drift the registry exists
to remove. Do not change the subagent's tool grant in this bead.

**`README.md` (§3.4 lines 160-162, §3.5 lines 165-172).**
- Update **Requires** (`README.md:28-29`): keep `node` on PATH; replace the bare "and the Claude in Chrome
  extension, connected" with a line saying the browser is configured in `browsers/*.json`, with Claude in
  Chrome shipped as the default.
- New **"Model and browser independence"** section (R4/R5): state that nothing here requires a Claude
  *model* — no `model:` key exists in any frontmatter, and `grep -i claude` over `scripts/`, `sites/` and
  `data/` returns only the plugin name and the browser server name — so the plugin runs unchanged under any
  model Claude Code is pointed at. State that the *browser* is configuration. State that the one
  harness-supplied value is `${CLAUDE_PLUGIN_ROOT}`, used only in the skill's commands and the two hook
  commands; no script reads it.
- New **"Swapping the browser"** section (§3.5): the three-step edit above, and why the agent's `tools:`
  frontmatter cannot be templated.

**`docs/SECURITY.md` (§4.1 line 192).** Three matcher descriptions go stale with the `mcp__.*` change (R2),
and both must now attribute the tool restriction to the guard's `landing_check` gate (§3.2) rather than to
the matcher:
- `:60` — R2's "PostToolUse on `navigate` and `tabs_context_mcp`": the `post` hook now matches `mcp__.*`.
- `:65` — R2's "the real landing URL appears in a `tabs_context_mcp` listing, which is why the hook now
  matches that tool too": the reason is now the guard's `landing_check` gate, not the matcher.
- `:119` — R9's "`PreToolUse` matches `mcp__(claude-in-chrome|Claude_Browser)__.*`" → `mcp__.*`.

**This bead owns those three lines — do not leave them to the context-refresh step.** §11 also lists
`docs/SECURITY.md:60/:65/:119`, which can read as dual ownership; it is not. §11 is the running floor for
the workflow's context-refresh phase, and that phase's skill writes only under `docs/context/`.
`docs/SECURITY.md` is outside it, so a change here that skipped these lines would leave the security
document's description of its own control false — the one kind of staleness this repo does not tolerate
silently.

**`test/report.test.js` — prove R5, do not assert it (§3.4 line 162, §5.2 line 240).** Add
`'report.js resolves sites and the calendar from its own location, not the cwd'`: spawn `report.js` (as the
existing cases do at `test/report.test.js:102-119`) with `cwd` set to a directory unrelated to the repo
(e.g. `os.tmpdir()`), feed a valid agent JSON on stdin, and assert `status` 0 and a parsed report. This
proves `ROOT = path.join(__dirname, '..')` (`scripts/report.js:23`, used at `:82-83`) rather than asserting
it. `scripts/report.js` is **not modified** (§4.2) — the test is the deliverable.

**Version bump (§6 R4).** Bump `version` in `.claude-plugin/plugin.json` — once per bead per the repo
convention.

## Rationale

Two claims in the plan are documentation, not code: R4 (nothing needs a Claude model) and R5 (no script
needs a harness-supplied env var). Both are facts a reader will look for, and §3.5 documents the one place
configuration cannot reach (the agent frontmatter) so the next reader does not search for a knob that does
not exist. Without this bead the registry is invisible and the independence claim is unstated — the reader
would still conclude the plugin is vendor-locked. The R5 test is the proof of the R5 claim the README
makes; a claim and its proof belong in the same bead (the repo's tests-live-in-the-bead rule).

## Outcome Definition

- `node --test test/report.test.js` exits 0, including the new foreign-cwd test.
- `README.md` contains the "Model and browser independence" and "Swapping the browser" sections and an
  updated Requires line.
- `docs/SECURITY.md`'s R2/R9 matcher lines (`:60`, `:65`, `:119`) describe `mcp__.*` and the `landing_check`
  gate rather than a vendor regex.
- `agents/deal-scout.md` still lists **exactly** the seven `mcp__claude-in-chrome__*` tools (unchanged) and
  now points at `browsers/`; `skills/find-best-deal/SKILL.md`'s preflight says "the configured browser
  tools".
- **Manual / recorded**: a read-through that no claim presents one control layer as two (the honesty rule
  §10 relies on), and that the swap steps match the actual loader from br-DS-2-01.

## Test Specifications

- `test/report.test.js` (modify): `'report.js resolves sites and the calendar from its own location, not
  the cwd'` — `spawnSync(process.execPath, [REPORT], { input, encoding: 'utf8', cwd: os.tmpdir() })`, then
  assert `status` 0 and the parsed report's `best_deal`. Add the `require('node:os')` import (as
  `test/guard.test.js:7` has it).
- **No automated test for the prose** — do not add a test that merely asserts a file exists or contains a
  string (the DS-1 docs bead left a comment to the same effect).
- **Manual / recorded**: the read-through above.

## Files to Touch

- `agents/deal-scout.md` (modify — a pointer to `browsers/` and the three-step swap; tool list unchanged)
- `skills/find-best-deal/SKILL.md` (modify — preflight wording: "the configured browser tools")
- `README.md` (modify — Requires; "Model and browser independence"; "Swapping the browser")
- `docs/SECURITY.md` (modify — the `:60` / `:65` / `:119` matcher descriptions)
- `test/report.test.js` (modify — the foreign-cwd spawn)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**What was built.** `agents/deal-scout.md` gained a maintainer-facing note stating where the tool grant
comes from, the three-step swap and why granting no `tools:` list is not an option; the `tools:`
frontmatter itself is unchanged. `SKILL.md`'s preflight says "the configured browser tools" and names
`browsers/claude-in-chrome.json` as the default, with an explicit "do not substitute a different browser
tool"; `:58`'s hard-coded "seven" is gone. `README.md` gained **Model and browser independence** and
**Swapping the browser**, its **Requires** line now says the browser is configuration, and the **Design**
summary names both allowlists rather than one. `docs/SECURITY.md` R2, R3 and R9 were updated.

**Beyond the bead's `:60`/`:65`/`:119` list — two substantive edits, both because the story makes the
old text *wrong* rather than merely imprecise:**

- **R9 is rewritten, not find-and-replaced.** It said the matcher was
  `mcp__(claude-in-chrome|Claude_Browser)__.*` and that if hypothesis H4 failed, "this must be fixed by
  widening the matcher before the plugin is trusted". This story *is* that widening, so R9 now records
  that the matcher is maximal within the MCP namespace, that H4 was live-checked and passed, and — the
  part worth keeping — that the residual is **not** closed: a tool exposed under a non-MCP name still
  never matches, and no pattern can match one generically. Treating a widened matcher as a fixed gap
  would have been the dishonest version of this edit.
- **R3 gained a clause** noting the scope is now `DEAL_SCOUT_AGENT_TYPE`-overridable, because R3's whole
  argument is that the scope is what leaves ordinary use untouched, and that is now a default rather than
  a constant.

**The R5 test was proven, not asserted.** Added
`'report.js resolves sites and the calendar from its own location, not the cwd'`, which spawns `report.js`
with `cwd: os.tmpdir()`. Mutation-checked: changing `ROOT` in `scripts/report.js` from
`path.join(__dirname, '..')` to `process.cwd()` made it fail (`tests 1 / pass 0 / fail 1`); reverting
restored `122/122`, and `git diff --stat scripts/report.js` is empty, so §4.2's "report.js is not
modified" holds literally.

**Verification observed.** `npm test` → `tests 122 / pass 122 / fail 0` (121 after br-DS-2-02; 1 new).
`node scripts/guard.js selftest` → `selftest OK: 36 cases`, exit 0.

**Manual read-through (the bead's second Outcome item) — done.** No claim now presents one control layer
as two: SECURITY.md R2 and R9 both say the *matcher* is a trigger and the *guard* is the control, which is
the distinction the change creates. The swap steps were checked line by line against
`validateBrowsers`/`loadBrowsers` from br-DS-2-01 — one gap was found and fixed in the same edit: the
README did not mention that `validateBrowsers` rejects two adapters claiming the same server prefix or the
same tool name, which a user adding a second browser could hit. It now does, with the reason (otherwise
"which policy applies" depends on load order).

**Not covered by any automated test** (stated, not faked): all of this bead's prose. There is deliberately
no test asserting a README contains a string or a file exists — the DS-1 docs bead took the same position,
and such a test constrains wording rather than behaviour. `docs/context/*` is untouched: that is the
workflow's context-refresh phase, per the plan's §11.

### Cross-review (Phase 5.5) — one gap found and fixed

The "Swapping the browser" step 3 told the reader that `node scripts/guard.js selftest` must exit 0, full
stop. That is wrong for the section's stated action. Simulated by pointing `DEAL_SCOUT_BROWSERS_DIR` at a
renamed copy of the shipped adapter: a user who **replaces** `browsers/claude-in-chrome.json` gets
**4 of 36** cases failing (`read_page` under the second prefix → exit 2; three `post` block rows → no
block) on a swap that is otherwise entirely correct, because the selftest matrix and
`test/browser.test.js` exercise the *shipped* adapter by name. Only *adding* a second adapter alongside
the default keeps step 3 green.

The instruction now says so, and says what to do about it — which is not "ignore the failures", since they
are telling the truth about the config. Fixing the test matrix to be adapter-agnostic was rejected: a
plugin *should* test the configuration it ships, and a selftest that passes against any registry proves
less, not more. Adding a browser alongside the default is documented as the cheaper path, because the
guard takes the union of prefixes and tools.

An independent fresh-context reviewer (the delegated conductor could not run — see br-DS-2-02) confirmed
this by reproducing it, and found nothing else in this bead's files.
