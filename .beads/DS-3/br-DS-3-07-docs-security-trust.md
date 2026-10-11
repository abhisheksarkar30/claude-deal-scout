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
- **Status**: pending
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

*(Append-only. The implementer records here, when the bead is done: what was built, any justified
deviation from the bead or the plan, and anything deliberately left undone. Not written at beadify
time.)*
