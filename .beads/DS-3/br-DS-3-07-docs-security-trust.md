# Bead br-DS-3-07: Document the new trust surface and its residual in `docs/SECURITY.md`

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §6 R1 (the
residual this bead writes down), §10 (the security-engineer note), §3.3 (the single cap+sanitizer
applied on both render paths), §3.6 (the widened surface), §4.1/§4.2, §8 (this bead). Repo
`D:\github\claude-deal-scout`. Cited by section for the plan. §11's context-refresh list is **not** this
bead's scope: it names `docs/context/security-and-permissions.md` (the agent-facing summary of the
threat model), **not** this file — the refresh phase writes only under `docs/context/`, so the
`docs/SECURITY.md` edits below are this bead's alone.

- **Bead ID**: br-DS-3-07
- **Priority**: P1 (high — the story's residual must be written down rather than left implied)
- **Status**: done
- **Original Estimate**: 45m–1h
- **Dependencies**: br-DS-3-06
- **Blocks**: None
- **Commit**: `docs(DS-3): trust surface and residual in SECURITY (br-DS-3-07)`

## Description

Add the story's trust surface and, crucially, its **new residual** to `docs/SECURITY.md`, following the
document's existing row pattern — **each row names the mitigation *and* the residual, and says where a
mitigation is a prompt instruction rather than a mechanical control** (§6 R1, §10).

**One new trust surface — free text from a hostile page.** `trust.brand` and `trust.seller` are the
first new free-text fields since DS-1, entering the report through a new field. The mitigation: the
existing cap + sanitizer, **defined once in `score.js`** ([`scripts/score.js:96-103`](../../scripts/score.js#L96-L103)),
applied by `validTrust` to the validated **input** (bead 01) and by `trust.js` to the output **`facts`**
(bead 02) — the same helper on both render paths (§3.3). Never printed raw elsewhere. It belongs beside
the existing §3 "attacker-controlled page text" surface
([`docs/SECURITY.md:37-42`](../../docs/SECURITY.md#L37-L42)).

**One widened surface, conditionally.** A `review` adapter (bead 05) adds a third-party host — the same
residual class as R5 ([`docs/SECURITY.md:94-99`](../../docs/SECURITY.md#L94-L99)). The mitigation is
inherited unchanged: `covers` + adversarial-suite rejection, survey-gated, and the plugin's own "do not
add a site that needs login or account data" rule (§3.6). State plainly that this host is added **only
if the survey ships an adapter**, and that the enforcement layer (`guard.js`/`hooks.json` code) is
untouched.

**One new residual — the honesty control.** *The authenticity verdict is a rule over page facts that a
counterfeiter controls, so a listing can satisfy every signal and still be fake; the label says
"evidence", never "genuine", and the caveat says so in the report.* This must be **written into
`docs/SECURITY.md` rather than left implied** (§6 R1, §10). Give it its own row in the residual-risks
section, in the R1–R11 style.

**What is not added — state it.** No credential, no auth, no network, no persistence: the plugin still
opens no socket of its own and writes nothing (§10).

## Rationale

§6 R1 names the story's one real risk: a confidence label reads as a verdict, and "high" printed next to
a counterfeit is worse than no label. The mitigation (the word *evidence*, the caveat, the written
residual) is only a mitigation if the residual is in the threat model; §10 requires it there rather than
implied. The widened `review`-adapter surface is the story's R5-analogue and belongs in the same
document.

## Outcome Definition

- `docs/SECURITY.md` gains the new trust surface (with its mitigation and residual), the conditional
  `review`-adapter surface (with its mitigation and residual), and the **new authenticity-verdict
  residual** as its own row.
- Every added row carries **both** a mitigation and a residual; no claim presents one layer as two.
- **Manual / recorded**: a read-through that the authenticity row states the *can-still-be-fake* residual
  and that the `review`-adapter row is written as conditional (present only if an adapter ships).

## Test Specifications

- **No automated test** — prose. Do not add a test that merely asserts the file contains a string.
- **Manual / recorded**: the read-through above.

## Files to Touch

- `docs/SECURITY.md` (modify — the new trust surface row, the conditional `review`-adapter surface row,
  the new authenticity-verdict residual row)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

**Done.** Prose only, following the document's existing row pattern — every added row carries a
**Mitigation** *and* a **Residual**, and the one mitigation that is a prompt instruction says so.

- **The new trust surface.** `## The three trust surfaces` is now `## The four trust surfaces`, and §4
  — **"Free text in the trust assessment"** — sits beside §3 as the bead asks. It names `trust.brand` and
  `trust.seller` as the first new free-text fields since DS-1, gives the mitigation (one cap + sanitizer
  defined in `score.js`, applied on **both** paths — `validTrust` on the validated input, `trust.js` on
  the output `facts` — so there are not two scrubbers that can drift), and an honest residual: it is the
  same pattern-based scrubber as R10 and inherits R10's limits, and the risk here is manipulation rather
  than disclosure, since a brand string is rarely private but is text a hostile page chose. It closes
  with the bead's "what is not added": no credential, auth, network or persistence.
- **The widened surface, written as conditional.** R5 is retitled **"Third-party history and review
  sites"** and now states that `review` adapters pass the identical `allow`/`covers` checks, that the
  kind exists, that **no review adapter ships** and why (`evidence-05.txt`), and that one added later
  inherits the guarantees unchanged. §2 also gained one clause so its "price-history" framing is not
  quietly wrong about the review kind.
- **The new residual.** **R12 — "The authenticity label is a rule over facts the listing controls"**, in
  the R1–R11 style, with the *can-still-be-fake* residual stated flatly: a convincing counterfeit
  satisfies every signal, because every one is text the seller controls. It also records that H6 could
  not be live-checked, so the extraction's central assumption is untested rather than verified.

**Read-through, the bead's stated manual check.** Both required points verified by reading the file back
rather than by memory: **R12 states the can-still-be-fake residual** (`**A convincing counterfeit
satisfies every signal.**`), and **R5 is written as conditional** (`no review adapter ships` /
`If one is added later…`). Also confirmed that no added row presents one layer as two, and that the
in-document framing line "Each row names the mitigation *and* what is still exposed" still holds for
every new row.

**Two additions beyond the bead's three, both small and both for accuracy:**

1. **Checklist step 8** now asks the reader to check the trust half by hand — brand, "Sold by" seller and
   review sample read only where the page showed them, and a field the page did not show **left out
   rather than guessed** (`reviews_read` must never equal `review_count`). This is where H6/H7 get
   settled, and the checklist is the only place the doc tells a human what to verify by hand, so leaving
   the new surface out of it would have made the checklist quietly incomplete.
2. **§2's closing sentence** notes the `review` kind is the same class of surface and that none ships,
   so nothing in the document implies the price-history surface is the only third-party one.

**Deliberately not touched.** `.beads/DS-1/br-DS-1-08-docs-security-and-readme.md` still says SECURITY.md
"lists all three trust surfaces" — it is a frozen work order describing DS-1's state at the time, the
same reason the DS-1 beads still cite plan v15, so it is left as written rather than retro-edited. §11's
context-refresh list is not this bead's scope (`docs/context/security-and-permissions.md` is the
agent-facing summary and belongs to Phase 5.6).

**No test, deliberately** — a test asserting the file contains a string is the fake this bead forbids.
`npm test` is 175 pass / 0 fail, unchanged by a prose-only edit.
