# DS-1 handoff — resume here (rewritten 2026-10-09, after plan convergence)

Flywheel position: **Phase 3 complete (beads approved). Next: Phase 5, implement bead by bead.**
No code exists yet — `.beads/DS-1/` and the converged plan are the only artifacts.

## What the project is
`claude-deal-scout`: a Claude Code plugin. Read-only research on Amazon.in and Flipkart (India only for v1,
extensible via `sites/*.json` adapters), using the user's own logged-in Chrome (Claude in Chrome), including
wishlist / cart / saved-for-later, plus price-history sites (typical low window, next-dip estimate, buy/wait
verdict). Safety = path-allowlist guard hook scoped to `agent_type == claude-deal-scout:deal-scout`, a
read-only tool set for the agent, schema-validated hand-off. Full design: `DS-1-deal-scout-plugin.md`.

## Decisions already made by the user
- Browser: Claude in Chrome. Safety approach "B" (instructions + deterministic hook guard).
- Extensible site adapters; India only (`amazon.in`, `flipkart.com`) for v1.
- Price history is IN scope (R10).
- Node (zero-dep, `node --test`), not Python (`python3` on this machine is the Store shim).
- **License: MIT** (confirmed 2026-10-09; §7's default is now settled). Bead 01 writes the `LICENSE`.
- Repo `github.com/abhisheksarkar30/claude-deal-scout` (public), remote `origin` is wired.

## State on disk
- Branch `feat/ds-1-deal-scout-plugin`, in sync with `origin` as of the beadify commit.
- **Plan: CONVERGED at v15** (`docs/planning/DS-1-deal-scout-plugin.md`, header `status=converged`).
  15 review rounds, 59 findings, 59 JUSTIFIED / 0 rejected / 0 escalated. Round 15 = `NO_FURTHER_FINDINGS`.
  Round artifacts in `docs/planning/review/` are **gitignored** (not committed; local only).
- **Beads: `.beads/DS-1/` — 8 beads, approved, committed.** Graph: `01 → 02 → {03, 04, 06}`;
  `05 → 06`; `{03,04,05,06} → 07 → 08`. Bead 04/05 split §8's single bead 04 into a live site survey
  (04) and the pure `history.js` engine (05); §8's bead numbers therefore shift (old 05→06, 06→07, 07→08).
- **No code yet.** `src/`, `tests/`, `package.json` do not exist; bead 01 creates them.

## Next steps
1. Phase 5: implement bead by bead, **one commit + push per bead**, commit message referencing
   `br-DS-1-<nn>`. Beads 01, 02, 05 can start immediately; 03/04 need 02; 06 needs 02+05; 07 needs all.
2. Bead 03/04/07 involve **live checks** and `evidence-0N.txt` artifacts — bead 04 surveys public
   price-history sites, bead 03/07 enumerate the Claude-in-Chrome tool surface.
   **Ask the user before touching their real logged-in Chrome** (see gotchas).
3. Each bead that owns a §5.4 negative control must actually run the mutation and record the observed
   failing test names in its `## Review Notes`.
4. Phase 5.5: `autonomous-loop:impl-conductor` over the code diff vs plan + beads.
5. Phase 6: `agentic-ai-artifacts:create-pr`.
6. At the end, offer (do not do unprompted) installing as a local `directory` marketplace; bump
   `plugin.json` version on any later change.

## Carried-to-implementation notes (in the beads, deliberately NOT in the plan)
Surfaced by `docs/planning/review/round-15/critique.md` and beadification; the plan was left at v15 and
these live in the bead bodies instead. Do not "fix" the plan for them without asking:
- **Candidate schema has no enumerated field allowlist.** §3.4 step 3 says "structured fields (title,
  price, rating, etc.)", so §3.5's unknown-fields-dropped rule has no allowlist to drop against.
  Bead 06 defines the canonical allowlist; bead 07 must emit exactly it. Real under-specification.
- **`MIN_POINTS` ownership** — §3.5 lists it among score.js's constants but §3.6 uses it in `history.js`.
  Assigned to bead 05 to avoid a 05↔06 import cycle; bead 06 must not redefine it.
- **`product_key`** — §3.5 says §3.4 step 3 "must produce this field"; step 3 never names it, and no
  §5.2 fixture covers cross-site grouping. Bead 07 carries it as the agent prompt's worked example.
- §4.1 lists `CLAUDE.md` as "New" though it exists (bead 01 = extend). §8 bead numbers are stale vs the
  actual 8-bead set. §5.4 has no mutation control for the `post` redirect block or the fail-closed
  no-`url`-key exit (positive tests exist; do not invent new controls).
- Plan-internal §7 "Beads 03 and 06" refers to live-browser checks that are now beads 03 and 07.

## Environment gotchas seen
- `WebFetch` and the `claude-code-guide` agent failed (helper model `deepseek-flash` not found). Read docs
  with the built-in browser (`mcp__Claude_Browser__navigate` + `javascript_tool`) instead.
- Auto-mode classifier blocked `gh repo create` earlier; `git push` to the existing remote works fine.
  Expect some outward-facing `gh` actions may need the user to run them.
- Hypotheses unverified (each has a checking bead with a stated false-branch): H1 subagent `tools:`
  accepts `mcp__claude-in-chrome__*` names (bead 07); H2 `navigate` response contains the final URL
  (bead 03); H3 which price-history sites work without clicks (bead 04); H4 denied tools are all
  MCP-prefixed (bead 03); H5 every URL-bearing allowed tool keys on `url` (bead 03).
