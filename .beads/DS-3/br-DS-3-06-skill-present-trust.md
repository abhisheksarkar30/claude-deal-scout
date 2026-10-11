# Bead br-DS-3-06: Present the trust assessment in the skill and document it in the README

**Plan Reference**: `docs/planning/DS-3-brand-authenticity-and-review-trust.md` **v7**, §3.7 (presenting
it), §3.1 (the `trust_assessment` block to render), §2 R1/R2/R3/R4, §6 R1 (the caveat is the honesty
control), §5.2 (no test for prose), §4.1/§4.2, §8 (this bead). Repo `D:\github\claude-deal-scout`. Cited
by section for the plan; source by line, stable at the `feat/ds-3-…` base. §11's context-refresh list is
**not** this bead's scope.

- **Bead ID**: br-DS-3-06
- **Priority**: P0 (critical — this is where the user actually sees the justification they asked for)
- **Status**: done
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

**Done.** Prose only — no runtime code, as the bead requires.

- `skills/find-best-deal/SKILL.md` step 5 gains an **Authenticity** entry, between *Price history* and
  *Flags*, covering all six things the bead lists: the confidence in plain words; each signal in plain
  words with three worked examples ("no brand storefront on the page", …); the evidence actually read
  (brand, seller, review-sample size); the cross-site peer with its price / rating gap; the off-site
  source with its rating and count as the beyond-the-site evidence; and the `caveat` verbatim. It also
  says what to do when `trust_assessment` is `null` — say nothing carried an assessment, **rather than
  letting its absence read as a pass**, which is the same null-vs-`"none"` distinction the engine makes.
- `README.md` gains **"Is it genuine?"** right after "Before you trust a new history site": the four
  confidence values with plain-word definitions, the discrediting/informational split and *why* it is
  split, and a **"What it cannot see"** paragraph saying the facts are written by the listing and a
  counterfeiter controls them — so a listing can satisfy every signal and still be fake. It closes with
  the cross-marketplace half and the empty `review` slot.

**Read-through, as the bead requires.** Both checks verified rather than eyeballed:

- **The caveat is verbatim.** Rather than copy the sentence into `SKILL.md`, the entry instructs the
  skill to quote the `caveat` field and forbids paraphrasing — because the report already carries the
  string on every block and a literal duplicated into a prompt is a second copy that drifts silently,
  the exact failure the repo's attribution rule warns about. The verbatim-ness is therefore checkable
  and was checked: a report built through `buildReport` emits a `caveat` that is `===` `CAVEAT` from
  `trust.js`, and that string reads "This is evidence, not proof — a listing can mimic every signal
  below, and absence of a signal is not proof of authenticity. Verify at the link." Bead 03's
  `test/report.test.js` case already pins this identity, so it cannot regress unnoticed. **Recorded as a
  justified deviation from the literal reading of "quoted verbatim".**
- **No signal is a bare identifier.** The entry names no signal id at all; it gives plain-word
  renderings and says "in plain words, never as identifiers". (The *Flags* entry below it keeps its
  existing shape — ids listed, then "in plain words, not as a bare list of identifiers" — and the
  Authenticity entry follows that same convention rather than inventing a new one.)

**No guarantee language anywhere.** The section uses *evidence* throughout; `brand_confidence` keeps its
name; the README says outright that the wording never becomes "genuine" or "authentic"; and neither file
presents one control as two.

**Not done, deliberately.** No automated test — the bead forbids a test that merely asserts a file
contains a string, and the same position is recorded at `docs/context/testing-and-quality.md`. §11's
context-refresh list is not this bead's scope.
