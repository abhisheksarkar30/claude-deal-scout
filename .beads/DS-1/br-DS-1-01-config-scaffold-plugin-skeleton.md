# Bead br-DS-1-01: Scaffold the installable plugin skeleton

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.1 (layout, lines 50-64), §4.1 (files, lines 134-136), §7 (pre-flight, lines 199-202). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-01
- **Priority**: P0 (critical — nothing else can land without manifests and a test runner)
- **Status**: pending
- **Original Estimate**: 1h
- **Dependencies**: None
- **Blocks**: br-DS-1-02, br-DS-1-05
- **Commit**: `chore(DS-1): scaffold plugin skeleton (br-DS-1-01)`

## Description

Create the on-disk skeleton an installable Claude Code plugin needs, so every later bead has a repo,
a test runner and a commit convention to land in. This is a **local `directory` marketplace plugin**,
not a published npm package (R8; §3.1 line 51).

Deliverables:

1. `.claude-plugin/plugin.json` — the plugin manifest. `name` = `claude-deal-scout`, a semver
   `version` (start `0.1.0` — the user's global notes require a version bump on every later change to
   this plugin's cache), a short `description` naming India-only read-only shopping research, and
   `author`.
2. `.claude-plugin/marketplace.json` — a single-plugin marketplace entry whose plugin `source` is this
   repo (`"./"`), so `claude plugin marketplace add <repo>` + `install` works (§3.7 step 0; §4.2 line 139).
3. `package.json` — `"private": true`, `"type": "commonjs"` (the scripts are plain Node CommonJS;
   keep whatever the scripts actually use), `"scripts": { "test": "node --test" }`, and **no
   dependencies** (zero runtime deps — CLAUDE.md; §3.1 lines 65-66).
4. `CLAUDE.md` — **modify/extend the existing file, do not create it.** The file already exists and its
   own text says "bead 01 will extend this file" (CLAUDE.md:7). §4.1 line 135 mis-files it under "New";
   the round-15 critique (observation 1) records the correction. Replace the "bead 01 will extend this
   file" placeholder with the settled conventions: Node, zero dependencies, `node --test`, conventional
   commits, one commit per bead referencing `br-DS-1-<nn>`, feature branch
   `feat/ds-1-deal-scout-plugin`, and a one-line pointer to `.claude-plugin/` + `agents/` + `skills/` +
   `hooks/` + `scripts/` + `sites/`.
5. `LICENSE` — MIT. **See the gap note below: the license is an unconfirmed live decision (§7 line 201).**
6. `README.md` — modify the existing 7-line stub into a short skeleton: what the plugin is, the
   install/use section headers, and a pointer to `docs/planning/`. **Final README content (install/use
   guide + adapter-authoring section) is owned by br-DS-1-08** — keep this version a skeleton and say
   so in a comment-free one-liner, so the two beads do not fight over the file.
7. `.gitignore` — add `review/` to the existing entries (`node_modules/`, `.DS_Store`, `*.log`)
   (§4.1 line 136).

The runtime is Node, already present on this machine and used by the sibling plugins (`python3` on this
PATH is the Windows Store shim — §3.1 lines 65-66).

**Plan gap to carry, not resolve:** §7 line 201 states the License defaults to MIT but has not been
formally confirmed by the human. Write the MIT LICENSE as directed, but if the human later picks a
different license, this file is the only affected artifact. Do not block on it; note it in Review Notes.

## Rationale

Every subsequent bead adds files to this repo and runs `node --test`; without the manifests the plugin
is not installable and without `package.json` the test command has no home. The `.gitignore` `review/`
entry keeps the 15-round cross-review artifacts (currently untracked) out of commits.

## Outcome Definition

- `node --test` runs from the repo root and exits 0 with 0 tests.
- `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))"` and the same
  for `marketplace.json` both exit 0 (valid JSON).
- `git check-ignore docs/planning/review/` prints the path (the new ignore rule is active).
- `git status` shows `.claude-plugin/`, `package.json`, `LICENSE` as new tracked-worthy files and
  `docs/planning/review/` as ignored.

## Test Specifications

- **No automated unit test** — configuration only (YAGNI).
- **Manual / recorded**: run `node --test` (expect exit 0, zero tests); parse both manifests as JSON;
  `git check-ignore` the review dir. No `evidence-*.txt` required for this bead.

## Files to Touch

- `.claude-plugin/plugin.json` (create)
- `.claude-plugin/marketplace.json` (create)
- `package.json` (create)
- `CLAUDE.md` (modify — extend with the settled conventions; file already exists)
- `LICENSE` (create — MIT)
- `README.md` (modify — replace the 7-line stub with a skeleton; final content in br-DS-1-08)
- `.gitignore` (modify — add `review/`)

## Review Notes

