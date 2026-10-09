# claude-deal-scout

Claude Code plugin for read-only shopping research (Amazon.in, Flipkart, price history).

**Resuming work?** Read the converged plan `docs/planning/DS-1-deal-scout-plugin.md` (v17, `status=converged`),
then the approved beads in `.beads/DS-1/`. (The beads still cite plan v15 with v15 line numbers —
historical work orders, left as written.)

`docs/context/INDEX.md` is this repo's map to the code for an agent starting cold: architecture, the
interface and data contracts, workflows, conventions, and the security model, each cited to the file
and symbol that proves it. The design source of truth is still the plan above — the context docs
describe what the code does today and say so where the two differ.

This file mirrors the generic, repo-agnostic sections of the user's global `~/.claude/CLAUDE.md` —
they apply to work in this repo the same way they apply everywhere else, and a plugin's own
CLAUDE.md is never auto-loaded from an installed copy, which is why they are duplicated here.
**Keep the two files in sync, in both directions**: any edit to the Context docs / Migrations /
Compact Instructions / AI attribution sections here must be mirrored to the global
`~/.claude/CLAUDE.md` (`C:\Users\abhis\.claude\CLAUDE.md`), and any edit there must be mirrored
here.

## Context docs

Before touching code in a repo that has `docs/context/INDEX.md` (or an equivalent generated
"map to the code" doc set) — including a one-off ad hoc request, not just a scripted workflow
like `develop-story` — read the index first, then the specific module doc(s) covering the area
you're about to change. Treat what it says about the slice you're changing as a hypothesis, not
fact, until you check it against the real source; the code wins wherever they disagree.

Track staleness, don't stop to fix it mid-change. Whether it turns up mid-read (a doc claim that
no longer matches the code) or your own change just created it (a new, renamed, or removed
entity, endpoint, permission, flow, module, or convention), add the specific `docs/context/*.md`
file:line claim to a running list as you go rather than patching it inline:
- **Ad hoc edit** — at the end of the task, surface that list to the user as a suggestion (name
  the file:line and what's now stale) and offer to update it — don't fix it unprompted.
- **Under a scripted multi-phase workflow** (e.g. `develop-story`) — append it to that workflow's
  own running tracking list; its context-refresh phase consumes the list as a floor on top of its
  normal diff-based scoping, not a replacement for it.

Skip only when the change is purely internal to the code (nothing a context doc would claim), and
say so rather than skipping silently.

## Migrations

Any change that runs a schema/database migration — whether Claude executes it directly or a
plan/step only states it for the user to run manually — is preceded by backing up the live
database file(s) to a separate path first. This applies regardless of file size: a backup is
cheap, a bad migration against the only copy of real data is not recoverable. State the backup
path when it's made.

## Compact Instructions

When compacting, always preserve the working state for continuation:

- Keep the current high-level goal and acceptance criteria.
- Keep the exact list of files modified during this session.
- Do not preserve verbose terminal outputs or tool logs.

## AI attribution

Commit trailers and PR footers are required, but the identity inside them is never hardcoded —
in a repo or in this file.

- **The format is fixed.** Every commit ends with a
  `Co-Authored-By: <agentic tool> (<model>) <noreply@vendor>` trailer naming both the tool that
  produced the change and the model behind it; every PR body ends with a
  `🤖 Generated with [<agentic tool>](<tool url>) using <model>` footer.
- **The values are not.** Read the tool name (Claude Code / Cursor / GitHub Copilot / Cline / …)
  and the model name from the active session's own instructions, every time. Never copy a literal
  in from another repo, a doc, or an earlier session.
- **Add the GitHub username of the tool/model.** Use the account if the session names it;
  otherwise look it up from the tool/model name or the vendor noreply email (e.g. `gh api
  users/<candidate>`, `gh api search/users -f q=<name>`, or web search) and accept only a match
  you can verify (a Bot account, or an owner/profile that ties to the vendor). Put it in the
  trailer as the `<id>+<username>@users.noreply.github.com` email so GitHub credits the co-author,
  and in the PR footer as `(@<username>)` after the tool link. No verified match → leave the
  format as is; never use an unverified guess.
- **A hardcoded literal goes stale silently.** Claude's trailer has already moved from
  `Co-Authored-By: Claude <noreply@anthropic.com>` to
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`, and a repo in this family was still
  publishing the old one.
- If the session names neither, omit the trailer and say so rather than inventing one. If the
  harness appends it itself, don't duplicate it — just make sure nothing in the repo contradicts it.
- A repo may layer its own AI-disclosure policy on top (a required `## AI attribution` section, a
  label, an `AI-Contribution:` trailer). Apply that **in addition**, and only where real evidence
  for it exists; never fabricate such a section in a repo that has none.

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
