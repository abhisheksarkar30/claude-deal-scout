# claude-deal-scout

Claude Code plugin for read-only shopping research (Amazon.in, Flipkart, price history).

**Resuming work?** Read the converged plan `docs/planning/DS-1-deal-scout-plugin.md` (v15, `status=converged`),
then the approved beads in `.beads/DS-1/`.

## Conventions

- **Node, zero dependencies.** No `npm install`, ever — no `dependencies`, no `devDependencies`.
  `package.json` is `private` and exists only to host the test command.
- **Tests**: `npm test` (i.e. `node --test`), plain `node:test` + `node:assert`. Test files live in
  `test/*.test.js`. No test framework.
- **Commits**: conventional commits; one commit per bead, message referencing `br-DS-1-<nn>`
  (e.g. `feat(DS-1): history stats and verdict engine (br-DS-1-05)`).
- **Branch**: `feat/ds-1-deal-scout-plugin` off `main`.

## Layout

- `.claude-plugin/` — plugin + marketplace manifests. Bump `version` on **every** change to this
  plugin, or an installed cache copy will go stale.
- `agents/deal-scout.md` — the research subagent (read-only Chrome tools only).
- `skills/find-best-deal/SKILL.md` — the user-facing entry point.
- `hooks/hooks.json` — `PreToolUse` + `PostToolUse` wiring for the guard.
- `scripts/` — `policy.js`, `guard.js`, `score.js`, `history.js` (no runtime deps).
- `sites/*.json` — site adapters; `data/sale-calendar.json` — Indian sale windows.
