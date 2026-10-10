[← INDEX](INDEX.md)

# Build & Run

One buildable unit: the plugin itself. **There is no build step** — no bundler, transpiler, or
compile phase, and no dependencies to install. "Build" here means *run the tests*.

### Plugin (`claude-deal-scout`)

| Task | Command | Source |
|---|---|---|
| Install dependencies | *none — do not run `npm install`* | [CLAUDE.md](../../CLAUDE.md), [package.json](../../package.json) (no `dependencies`) |
| Build | *none* | — |
| Test (all) | `npm test` (= `node --test`, 103 tests across 6 files) | [package.json:9](../../package.json#L9) |
| Test (single file) | `node --test test/history.test.js` | `node:test` CLI |
| Test (single case) | `node --test --test-name-pattern="point-count gate" test/history.test.js` | `node:test` CLI |
| Guard policy matrix | `node scripts/guard.js selftest` → must print `selftest OK: 32 cases` and exit 0 | [guard.js:206-237](../../scripts/guard.js#L206-L237) |
| Lint / format / type-check | *none configured* | see [conventions.md](conventions.md#formatting--lint) |
| Run the feature | install the plugin (below), then `/claude-deal-scout:find-best-deal` | [skills/find-best-deal/SKILL.md](../../skills/find-best-deal/SKILL.md) |
| Deploy | *none — the "deploy" is installing the plugin into Claude Code* | — |
| Generate a report offline | see "Report CLI" below | [report.js:70-90](../../scripts/report.js#L70-L90) |

### Install / reload the plugin

```bash
# from the repo root
claude plugin marketplace add ./
claude plugin install claude-deal-scout@claude-deal-scout
```

Then restart Claude Code or run `/reload-plugins` **so the hooks load**. Installing edits the
user's Claude Code configuration, so it is always done deliberately, never automatically.

After any change to this repo, bump `version` in
[.claude-plugin/plugin.json](../../.claude-plugin/plugin.json), then
`claude plugin update claude-deal-scout@claude-deal-scout` — the plugin is installed from the
repo as a local `directory` marketplace but Claude Code still copies it into
`~/.claude/plugins/cache/`, and the copy is only refreshed when the version changes. **Hooks run
from the cached copy**, so a hook edit is not live until this is done.

### Report CLI (offline, no browser needed)

```bash
node scripts/report.js --requirement '{"budget":50000,"eligible_conditions":["hdfc-credit-card"],"deadline":"2026-11-30"}' < agent-output.json
```

- stdin: the agent's JSON (`candidates`, `gaps`, `blocked`). Malformed input → exit 2 on stderr,
  no partial report.
- `--requirement <json>` is optional **but silently load-bearing**: without it the budget gate,
  the `over_budget` flag, conditional offers and both deadline-dependent verdict branches never
  fire. Omit the flag only when the user supplied none of budget/eligible_conditions/deadline.
- stdout: the merged report JSON. Exit 0 on success, 2 on any error.

### Guard CLI

```bash
node scripts/guard.js pre       # reads a hook payload on stdin; exit 0 allow, 2 block
node scripts/guard.js post      # reads a hook payload; prints {"decision":"block",…} to block
node scripts/guard.js selftest  # 32-case matrix
```

`pre`/`post` exit 0 and do nothing when `agent_type` is anything but
`claude-deal-scout:deal-scout` — that is what keeps ordinary Chrome use untouched. A hand-made
payload is easy:

```bash
echo '{"agent_type":"claude-deal-scout:deal-scout","tool_name":"navigate","tool_input":{"url":"https://www.amazon.in/dp/B0XXXXXXXX"}}' | node scripts/guard.js pre
```

## Environment variables / secrets

Names only — no values exist in the repo. There are no secrets, no tokens, no API keys: the plugin
has no credentials of any kind, by design.

| Name | Purpose | Required in |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | absolute path to the installed plugin, used in the skill's shell commands and in `hooks/hooks.json` command strings | Claude Code sets it for plugin hooks and skills |
| `DEAL_SCOUT_SITES_DIR` | overrides the adapter directory | **test seam only** ([guard.js:37-38](../../scripts/guard.js#L37-L38)); never set in production |

## Local dev setup

1. `node --version` — any recent version. No install step.
2. `npm test` — the whole suite should pass with 0 failures.
3. `node scripts/guard.js selftest` — must exit 0. This is also the check the skill runs at
   preflight, and it doubles as proof that `node` is on `PATH`.
4. To exercise the real feature you need the **Claude in Chrome** extension connected, and you must
   log in to Amazon.in / Flipkart yourself in the Chrome window Claude is attached to. Never give
   the agent credentials.
5. Live end-to-end behaviour (real DOM extraction, CAPTCHA handling, redirect discard) is **not
   covered by any automated test** — run the manual checklist in
   [docs/SECURITY.md](../../docs/SECURITY.md) ("Manual end-to-end checklist"), with the user's
   explicit go-ahead before the agent touches their browser.

> ⚠️ `python3` on this machine resolves to the Windows Store shim and fails. Use `node` (or
> `python`/`py` if a Python script is ever added). This is why the guard is Node.
