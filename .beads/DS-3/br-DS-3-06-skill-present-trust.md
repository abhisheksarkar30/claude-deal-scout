# Bead br-DS-3-06: Present the trust assessment in the skill and document it in the README

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.7 (presenting
it), §3.1 (the `trust_assessment` block to render), §2 R1/R2/R3/R4, §6 R1 (the caveat is the honesty
control), §5.2 (no test for prose), §4.1/§4.2, §8 (this bead). Repo `D:\github\claude-deal-scout`. Cited
by section for the plan; source by line, stable at the `feat/ds-3-…` base. §11's context-refresh list is
**not** this bead's scope.

- **Bead ID**: br-DS-3-06
- **Priority**: P0 (critical — this is where the user actually sees the justification they asked for)
- **Status**: pending
- **Original Estimate**: 1–1.5h
- **Dependencies**: br-DS-3-03, br-DS-3-04
- **Blocks**: br-DS-3-07
- **Commit**: `feat(DS-3): present trust in the skill and README (br-DS-3-06)`

## Description

The surface layer: make the new assessment visible to the user in the skill's presentation and state
what the check can and cannot see in the README. **No runtime code changes here.**

**`skills/find-best-deal/SKILL.md` step 5's presentation list**
([`skills/find-best-deal/SKILL.md:92-117`](../../skills/find-best-deal/SKILL.md#L92-L117)) gains an
**Authenticity** entry, in the same style as its flags entry
([`skills/find-best-deal/SKILL.md:106-107`](../../skills/find-best-deal/SKILL.md#L106-L107)). Report, from
the merged `trust_assessment` block:

- the **brand confidence in plain words** (`high`/`medium`/`low`/`none`);
- **each signal in plain words** — not identifiers (`no_brand_store`, `price_undercut`, …);
- **the evidence actually read** — the `facts`: brand, seller, review sample size;
- **the cross-site peer** when there is one (`trust_assessment.peer`);
- **the off-site source with its rating and count** when there is one
  (`trust_assessment.offsite`) — the "beyond the site" evidence R3 asks for;
- **the caveat verbatim** — it already carries the sentence *absence of a signal is not proof of
  authenticity*, and **the skill must not paraphrase it away** (§6 R1).

**`README.md` gains a short "Is it genuine?" section** next to its existing history-source rule
([`README.md:126-130`](../../README.md#L126-L130)), stating what the check **can** and **cannot** see —
it is a rule over page facts a counterfeiter controls, so a listing can satisfy every signal and still be
fake; the label says "evidence", never "genuine".

**Honesty rule (§6 R1, §10).** The word used in the report is *evidence*, never *authentic*, and the
`caveat` travels with every block. Do **not** rename `brand_confidence` to anything that sounds like a
guarantee, and do not present one control as two.

## Rationale

R1 requires the report to say *how well justified* the brand is, with the evidence behind it — which
only exists if the skill renders it. R4's honesty stance (the label is evidence, not a verdict) is only
true if the caveat reaches the user unparaphrased. Both claims are documentation, so the tests leave
them to a read-through; this bead needs both 03 (the merged block) and 04 (the extraction) because it
documents behaviour the user sees end to end (§8).

## Outcome Definition

- `skills/find-best-deal/SKILL.md` step 5 has an Authenticity entry covering the confidence, the signals
  in plain words, the evidence read, the cross-site peer, the off-site source with its rating and count,
  and the **caveat verbatim**.
- `README.md` has an "Is it genuine?" section stating what the check can and cannot see.
- No claim presents `brand_confidence` as a guarantee, and the caveat is not paraphrased.
- **Manual / recorded**: a read-through that the caveat string is quoted **verbatim** (matching
  `CAVEAT` from bead 02) and that no signal is rendered as a bare identifier.

## Test Specifications

- **No automated test for the prose** — do not add a test that merely asserts a file contains a string
  (the DS-1 and DS-2 docs beads took the same position, `docs/context/testing-and-quality.md:28-42`).
- **Manual / recorded**: the read-through above (caveat verbatim; signals in plain words; the
  evidence/not-verdict wording).

## Files to Touch

- `skills/find-best-deal/SKILL.md` (modify — the Authenticity presentation entry in step 5)
- `README.md` (modify — the "Is it genuine?" section)
- `.claude-plugin/plugin.json` (modify — `version` bump)

## Review Notes

*(Append-only. The implementer records here, when the bead is done: what was built, any justified
deviation from the bead or the plan, and anything deliberately left undone. Not written at beadify
time.)*
