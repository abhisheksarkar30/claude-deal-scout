# claude-deal-scout — Context Docs

A dependency-free Node **Claude Code plugin** that researches shopping options for one requirement
across **Amazon.in** and **Flipkart** using the user's own already-logged-in Chrome session, compares
them against the user's cart / wishlist / saved-for-later, adds a price-history **buy-now / wait /
no-signal** verdict, and returns a deterministic ranked report. It is **read-only by design**: it
cannot buy, cannot change account state, cannot handle credentials, and a hook enforces a per-site
path allowlist on the one subagent allowed to touch the browser. India only for v1; adding a site is
adding a JSON file, never a code change. Two caveats worth knowing up front: **price history ships
inert** (no history adapter exists yet, so the verdict degrades to `no_signal`), and the *design*
source of truth is the converged plan at
[docs/planning/DS-1-deal-scout-plugin.md](../../docs/planning/DS-1-deal-scout-plugin.md), which the
code comments cross-reference by section number.

## Stack inventory

| Unit | Language / Runtime | Framework | Role | Evidence |
|---|---|---|---|---|
| `claude-deal-scout` plugin | Node.js (CommonJS), **zero dependencies** | Claude Code plugin | the whole product: manifests, agents, skill, hook | [.claude-plugin/plugin.json](../../.claude-plugin/plugin.json), [package.json](../../package.json) |
| Research subagent | Markdown + YAML frontmatter | Claude Code subagent | browses with 7 read-only Chrome MCP tools, returns JSON | [agents/deal-scout.md](../../agents/deal-scout.md) |
| Skill | Markdown | Claude Code skill | `/claude-deal-scout:find-best-deal`; orchestrates, never drives Chrome | [skills/find-best-deal/SKILL.md](../../skills/find-best-deal/SKILL.md) |
| Guard hook | Node | Claude Code `PreToolUse` + `PostToolUse` command hook | matches every MCP tool call (`mcp__.*`); denies tools/URLs by default (tool set read from `browsers/*.json`); catches off-allowlist landings | [hooks/hooks.json](../../hooks/hooks.json), [scripts/guard.js](../../scripts/guard.js), [browsers/](../../browsers) |
| Scripts | Node, `node:` builtins only | — | `policy` (pure decisions), `score` (validate+rank), `history` (verdict), `report` (merge) | [scripts/](../../scripts) |
| Site adapters | JSON | — | per-site policy + URL templates; adding a site is a new file | [sites/](../../sites) |
| Browser registry | JSON | — | per-browser tool allowlist + which tools carry a URL or get a landing check; adding a browser is a new file | [browsers/](../../browsers) |
| Sale calendar | JSON | — | 8 approximate Indian sale windows | [data/sale-calendar.json](../../data/sale-calendar.json) |
| Tests | Node | `node:test` + `node:assert` | 122 tests, 7 files, plus a 38-case in-product guard selftest | [test/](../../test), [package.json](../../package.json) |

## Modules

| File | When to open it | Why it's here |
|---|---|---|
| [architecture.md](architecture.md) | first — to understand how the pieces fit and where a change belongs | **core** |
| [build-and-run.md](build-and-run.md) | to run tests, the selftest, the report CLI, or to install/reload the plugin | **core** |
| [conventions.md](conventions.md) | before writing code — module shape, fail-closed rules, test style, commit format | **core** |
| [glossary.md](glossary.md) | when a term or identifier is unfamiliar (`covers`, `effective_price`, `R-number`, `bead`) | **core** |
| [security-and-permissions.md](security-and-permissions.md) | before touching the guard, policy, adapters, sanitizer, or the agent prompt | conditional — tool + path allowlists, hook enforcement, `docs/SECURITY.md` R1–R11, PII sanitizer |
| [site-adapters.md](site-adapters.md) | to add a site, or to understand why a URL is blocked | conditional — the `sites/*.json` config-driven registry (`loadSites`); the catalog had no slot for it, so it is named plainly |
| [data-model.md](data-model.md) | to change any JSON shape passed between components | conditional — candidate / `history` / report schemas; no DB, so the validators in code are the source of truth |
| [api-surface.md](api-surface.md) | to change a CLI script, the hook protocol, or module exports | conditional — hook stdin/exit-code protocol + 3 CLI entry points (absorbs `cli-and-tooling`, which had no separate content) |
| [workflows.md](workflows.md) | to trace a run end to end, or to change the verdict ladder | conditional — six multi-component flows; no retries and no transactions anywhere |
| [testing-and-quality.md](testing-and-quality.md) | to see what is covered, what is not, and the 10 mutation controls | conditional — `node:test`, 122 tests, 38-case selftest matrix, no CI |

**Deliberately not generated** (no trigger signal in this repo): `mobile-app`, `frontend-web`,
`data-privacy-and-compliance` (nothing is persisted; no consent screen, health, kids or location
domain), `ml-data-pipeline`, `infra-and-deploy` (no Dockerfile/IaC/CI; installing the plugin is
documented in [build-and-run.md](build-and-run.md)), `integrations-and-external-services` (zero
dependencies; the external sites *are* the adapter system, covered by
[site-adapters.md](site-adapters.md)). **No `decisions/` ADRs**: the rejected alternatives are
already written down in the in-repo plan
([§9 "Alternatives considered and rejected"](../../docs/planning/DS-1-deal-scout-plugin.md)) and
duplicating them into ADR files would put the same fact in two places.

## Grounding rules for agents

1. **Discover, don't assume.** Every claim in this doc set is cited to a real file, and usually to a
   symbol or line. Treat a statement here as a hypothesis until you check the source — the code wins.
2. **Cite when you write.** When you add or change a claim, link the file (and symbol/line) that
   proves it. File links are relative to the file you are editing.
3. **Mark what you cannot verify.** Use `> ⚠️ ASSUMPTION:` or `> ❓ UNVERIFIED:` and say what
   evidence would settle it. Do not upgrade a prompt-level instruction into a mechanical control:
   this repo distinguishes them carefully, and [docs/SECURITY.md](../../docs/SECURITY.md) is explicit
   about which controls are unverified.
4. **One fact, one file.** Update the owning module rather than repeating it; `INDEX.md` links.
5. **Prefer identifiers over prose.** The codebase has its own vocabulary
   ([glossary.md](glossary.md)); use its exact spellings so later greps work.
6. **Watch the two overloaded names.** `R1`–`R10` in the plan's §2 are *requirements*; `R1`–`R11` in
   SECURITY.md and `R1`–`R9` in the plan's §6 are *residual risks*. Always say which.
7. **Do not read the docs as the design.** `docs/planning/DS-1-deal-scout-plugin.md`
   (`status=converged`) is the design source of truth; code comments reference it by section
   (`§3.6`, `R4`).

## Last generated / refreshed

**2026-10-10** — mode: **refresh** (DS-2, vendor-agnostic browser tools: the `browsers/*.json`
registry replaces the hardcoded tool constants, the hook matchers become `mcp__.*`, and the guard
gains the `landing_check` gate). Scope: the ten existing modules, diffed against the current code.
All ten were touched, **none added or retired** — `browsers/*.json` is a second config registry,
but too small for its own module, so it is documented across the modules that already own its facts
(the INDEX row above, the data-model contract, the tool allowlist in security-and-permissions.md,
the loader in architecture.md, the exports in api-surface.md). Verified in the same pass:
`npm test` → 122/122 pass; `node scripts/guard.js selftest` → `selftest OK: 38 cases`.
