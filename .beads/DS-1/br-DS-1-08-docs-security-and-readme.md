# Bead br-DS-1-08: Write the security threat model and complete the README

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §4.1 (README, line 136), §3.7 step 0 (install guidance, line 121), §5.3 (manual E2E checklist lives in `docs/SECURITY.md`, line 170), §6 (R1-R9 residual risks, lines 189-197), §10 (three trust surfaces, line 236). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-08
- **Priority**: P1 (high — required for the security story and for the plugin to be usable/adoptable)
- **Status**: done
- **Original Estimate**: 1.5h
- **Dependencies**: br-DS-1-07
- **Blocks**: None
- **Commit**: `docs(DS-1): security threat model and README (br-DS-1-08)`

## Description

**`docs/SECURITY.md`** — the threat model and residual risks:
- The three trust surfaces (§10 line 236): (1) the user's authenticated shopping sessions, read-only via
  the path allowlist; (2) third-party history sites, unauthenticated, tight allowlist, public data out
  only; (3) attacker-controlled page text feeding the model and the report, handled by schema validation
  and URL re-checks.
- Residual risks R1-R9 (§6), stated plainly and without over-claiming: fail-open on a crash / missing
  `node` (R1), open redirects that depend on the `navigate` response shape (R2), main-thread browsing
  unguarded (R3), report injection via price/rating (R4), third-party history-site trust (R5), forecast
  overconfidence (R6), site terms / bot detection (R7), stale sale calendar (R8), a hook matcher that
  misses native-named tools (R9). For each, name the mitigation **and** the residual — do not present a
  single layer as two.
- The PII-sanitizer residual risk (pattern-based scrubbing is not exhaustive; §3.5 line 108).
- The **manual end-to-end checklist** referenced by §5.3 line 170 — the by-hand checks a human runs
  against the live Chrome session (install, log in, run `/claude-deal-scout:find-best-deal`, confirm
  nothing was bought or changed, confirm a blocked/off-allowlist page is discarded), run only with the
  user's go-ahead before the agent touches their browser.

**`README.md`** — complete the skeleton br-DS-1-01 left (that bead owns only the stub; **this bead owns
the full content**, §4.1 line 136):
- Install/use guide: add this repo as a local `directory` marketplace and install the plugin; the entry
  point `/claude-deal-scout:find-best-deal`; the requirement, the login step, and the read-only promise.
- **Adapter-authoring section**: how to add a site — copy a `sites/*.json`, set `id`/`kind`/`hosts`/
  `allow`/`deny`/`urls` (and `covers`/`urls.lookup` for a `history` adapter); note that adding a site is
  "add a file", no code change (R7); note the `loadSites` validation rules a new adapter must satisfy
  (allow-regexes must not permit account paths; `covers` must name loaded shop ids).
- A pointer to `docs/SECURITY.md`.

Installing the plugin edits the user's config, so it is offered and done only if the user says yes
(§4.2 line 139) — the README documents the steps but this bead does not run them.

## Rationale

The whole design is a safety argument, and the plan requires the residual risks to be written down
rather than implied (§10 Security-engineer note). The README is the only place a user learns how to
install the plugin and how to extend it without reading the plan.

## Outcome Definition

- `docs/SECURITY.md` exists, lists all three trust surfaces and all of R1-R9 with mitigation + residual,
  and contains the manual E2E checklist.
- `README.md` contains an install/use guide and an adapter-authoring section, and links to
  `docs/SECURITY.md`.
- No claim in either file presents one control layer as two, or presents a forecast as a promise.

## Test Specifications

- **No automated test** — prose. (Do not add a test that merely asserts the files exist.)
- **Manual / recorded**: a read-through that every R1-R9 row has both a mitigation and a residual, and
  that the adapter-authoring steps match the actual `loadSites` rules from br-DS-1-02.

## Files to Touch

- `docs/SECURITY.md` (create)
- `README.md` (modify — complete the install/use guide and add the adapter-authoring section; the
  skeleton was created by br-DS-1-01)

## Review Notes

Implemented 2026-10-09.

**Outcome Definition, verified by read-through against the source rather than by assertion.**
- `docs/SECURITY.md` lists all three trust surfaces, and **every** risk row carries both a *Mitigation*
  and a *Residual*. There are eleven rows, not nine — see below.
- `README.md` carries the install/use guide, the adapter-authoring section, and links to
  `docs/SECURITY.md`.
- No claim presents one layer as two: where a control is a prompt instruction rather than a mechanism,
  the text says so; and the two unverified hypotheses (H1, H2, plus H4) are named as unverified in their
  own rows rather than folded into a mitigation.
- The adapter-authoring steps were checked line by line against `loadSites` in `scripts/policy.js`: the
  required `urls` keys for each `kind`, the adversarial-suite rejection of a history adapter's `allow`,
  the `covers`-must-be-loaded rule, and the word-boundary behaviour of `deny` all match the code.

**Two risks added beyond the plan's R1-R9.** The bead asked for R1-R9; these two are real and were already
recorded in the beads, so writing a threat model that omitted them would have been the dishonest choice:

- **R10 — the PII sanitizer is pattern-based.** The plan mentions this residual (§3.5) but does not list
  it among R1-R9. Stated plainly: pattern matching is not exhaustive, and the stronger control — the agent
  instruction never to record personal data — is *also* only an instruction.
- **R11 — the `tools:` allowlist is unverified.** This is H1, and it is security-relevant, not just a
  platform detail: if the frontmatter list is not honoured, the guard is the **sole** control and any
  "two independent layers" framing is false. Given R1 (the guard can fail open) this is arguably the most
  important row in the document, so it is written as an explicit risk rather than left as a footnote.

**Honesty note — the document deliberately under-claims.** Because the live checks are deferred, R2
(redirect protection), R9 (matcher coverage) and R11 are all marked **unverified** with pointers to
`.beads/DS-1/evidence-03.txt` and `evidence-07.txt`. That is the accurate state of the world right now: the
code exists and is tested, but three of the safety claims rest on platform behaviour nobody has observed
yet. A threat model that read as if they were confirmed would be worse than no threat model.

**No automated test**, per this bead's Test Specification — prose. Nothing was added that merely asserts
the files exist.

**Not done here, deliberately:** the plugin was **not** installed. `claude plugin marketplace add ./` edits
the user's Claude Code configuration, and §4.2 requires that to be offered and done only on the user's
say-so. The README documents the steps instead.

