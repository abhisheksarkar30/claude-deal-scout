# Bead br-DS-1-03: Build the guard hook (pre / post / selftest) and wire it

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.2 (guard, lines 68-75), §3.8 (hook wiring, lines 128-130), §5.1 (guard rows, lines 152-158), §5.2 (`guard.test.js` line 164), §5.4 (control 2, line 179), §6 (R1/R2/R9, lines 189-197). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-03
- **Priority**: P0 (critical — the only real enforcement layer; largest and most security-critical bead)
- **Status**: pending
- **Original Estimate**: 2-3h
- **Dependencies**: br-DS-1-02
- **Blocks**: br-DS-1-07
- **Commit**: `feat(DS-1): guard hook pre/post/selftest + wiring (br-DS-1-03)`

## Description

Implement `scripts/guard.js` and `hooks/hooks.json`, plus `test/guard.test.js`. The guard is a plugin-level
hook (a subagent's own `hooks:` frontmatter is ignored by the platform — §2 line 35 — so this is the only
place enforcement can live).

**Entry + scoping (§3.2 lines 69-75).** `node scripts/guard.js <pre|post|selftest>` reads a JSON hook
payload on stdin. It acts **only** when `payload.agent_type === "claude-deal-scout:deal-scout"`; for any
other `agent_type`, a missing `agent_type`, or an unrelated payload it exits `0` (leaves all other Chrome
use untouched — R3). `agent_type` is `<plugin>:<agent>` for a plugin subagent (§2 line 36).

- `pre`: run `checkTool` then `checkUrl` from br-DS-1-02. Deny ⇒ exit 2 with a reason on stderr (exit 2
  blocks the tool call; JSON `permissionDecision: "deny"` is an accepted alternative).
- `post` (matcher `navigate` only): scan the tool response for URLs; if any has a non-allowlisted host,
  return `{"decision":"block","reason":…}` telling the agent to discard the page and close the tab — this
  catches an open redirect that landed off-allowlist (§3.2 line 74; R2).
- `selftest`: run the policy against a built-in matrix and exit non-zero on any miss. The skill runs it
  first (§3.7 step 0), which also proves `node` exists — the one failure the hook itself cannot cover,
  because a missing `node` is a non-blocking (fail-open) error (§3.2 line 75).

**Fail closed (§3.2 line 73).** Unparseable stdin, adapter load/validation errors, or any thrown error ⇒
exit 2 with a reason on stderr. A **URL-bearing** gated call (`navigate`, `tabs_create_mcp`) whose
`tool_input` contains no string value under a `url` key ⇒ exit 2 (fail closed). The five non-URL tools
(`tabs_context_mcp`, `tabs_close_mcp`, `read_page`, `get_page_text`, `find`) must exit 0 when processed
without a `url` key. Wrap the whole entry in `try/catch → exit 2` — any other non-zero exit does **not**
block (fails open), so the catch is load-bearing (§2 line 37; R1).

**Wiring (§3.8 lines 128-130).** `hooks/hooks.json`:
- `PreToolUse`, matcher `mcp__(claude-in-chrome|Claude_Browser)__.*` → `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.js" pre`
- `PostToolUse`, matcher `mcp__(claude-in-chrome|Claude_Browser)__navigate` → `… post`

Use `${CLAUDE_PLUGIN_ROOT}` so the path resolves wherever the plugin is installed.

**Live hypotheses this bead must check (§2 lines 44-45; §7 line 202).** These require the user's real
Chrome — **ask the user before touching their browser** (§7 line 202). Record results to
`.beads/DS-1/evidence-03.txt`:

- **H2** — *`navigate`'s tool response contains the final URL.* Observe one `navigate` and inspect its
  response shape. **If false:** the `post` redirect check is inert; record that the layer is a no-op and
  that redirect protection then rests solely on the pre-check + the agent's discard rule (R2 residual).
- **H4** — *all tools the guard must deny are exposed under `mcp__Claude_Browser__*` or
  `mcp__claude-in-chrome__*`, not as native names.* Enumerate every tool name Claude in Chrome exposes
  and confirm none of the denied tools (`computer`, `form_input`, `javascript_tool`, `file_upload`,
  `upload_image`, `gif_creator`, `read_console_messages`, `read_network_requests`) appear outside the
  MCP namespace. **If any does:** add a second hook entry / widen the matcher to cover that name before
  this bead closes (R9 — a non-matching matcher is a silent gap, distinct from fail-open).
- **H5** — *every URL-bearing `tool_input` field on the seven allowed tools is named `url`.* Inspect the
  actual input schema of each allowed tool. **Independently of the outcome**, a URL-bearing gated call
  (`navigate`, `tabs_create_mcp`) with no string under a `url` key is fail-closed (exit 2), so a future
  schema rename breaks the selftest loudly instead of silently disabling the URL check.

**Carried from the round-15 review (observation 3).** §5.4 has no mutation control for the `post`
redirect block or for the "URL-bearing gated tool with no `url` key → exit 2" rule. Both have positive
tests here, so the mutation is implicit; do not invent new controls, but note in Review Notes if you
found either hard to pin. (`loadSites` controls 6/7 belong to br-DS-1-02, not here — the §8 bead line
that listed "controls 1–3" under bead 03 was a mis-map; controls 1 and 3 also mutated `policy.js` and
now live in br-DS-1-02. This bead owns control 2 only.)

## Rationale

A prompt is not a control (§9). The guard is the deterministic backstop that makes read-only mechanical
rather than instructional, and it must be scoped so it never interferes with the user's ordinary Chrome
use. Getting fail-closed and scoping wrong is the difference between a block and no block at all.

## Outcome Definition

- `node --test test/guard.test.js` exits 0 (spawns the real `scripts/guard.js` via
  `child_process.spawnSync` and asserts exit codes).
- `node scripts/guard.js selftest` exits 0; ablating any single check in the matrix makes it exit
  non-zero.
- Negative control 2 (§5.4 line 179) runs once and is reverted: remove the `try/catch → exit 2` ⇒ the
  garbage-stdin test fails (exit ≠ 2). Record the observed failing test name in Review Notes.
- `evidence-03.txt` records H2, H4, H5 observations and the action taken on each false hypothesis.

## Test Specifications

- `test/guard.test.js` (§5.2 line 164): exit codes for the §5.2 guard cases via `spawnSync`; garbage
  stdin ⇒ exit 2; a bad adapter ⇒ exit 2; another `agent_type` and missing `agent_type` ⇒ exit 0; the
  full Chrome tool list ⇒ default-deny test (dangerous tools blocked); `post` blocks an off-allowlist
  final URL; the five non-URL-bearing allowed tools called with no `url` key ⇒ exit 0; a URL-bearing
  gated tool (`navigate`, `tabs_create_mcp`) with no `url` key ⇒ exit 2.
- **Manual / recorded** (`.beads/DS-1/evidence-03.txt`): H2 (`navigate` response shape), H4 (enumerated
  Chrome tool names), H5 (allowed-tool input schemas) — with the user's go-ahead before touching their
  browser.

## Files to Touch

- `scripts/guard.js` (create — `pre` / `post` / `selftest`, stdin JSON → policy → exit code)
- `hooks/hooks.json` (create — PreToolUse + PostToolUse matchers)
- `test/guard.test.js` (create)
- `.beads/DS-1/evidence-03.txt` (create — H2/H4/H5 observations)

## Review Notes

