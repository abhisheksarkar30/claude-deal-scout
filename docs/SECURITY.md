# Security model — claude-deal-scout

This plugin reads shopping pages from the user's own logged-in browser session and returns a report. It
cannot buy anything, change any account state, or handle credentials. This document explains what that
claim rests on, and where it is weaker than it looks.

**Read the residual risks, not just the mitigations.** A control that is described without its residual
is a control someone will over-trust.

## What the plugin can and cannot do

It can: navigate to allowlisted URLs on Amazon.in and Flipkart, read page text, read the user's cart /
wishlist / saved-for-later, query public price-history sites, and compute a ranking locally.

It cannot: buy, add to a cart or wishlist, sign in, solve a CAPTCHA, click to reveal data, run shell
commands, write files, or make any network request of its own. The plugin has **no runtime dependencies**
and no code that opens a socket — Chrome does all the talking.

## The three trust surfaces

### 1. The user's authenticated shopping sessions

The highest-value target: a live logged-in Amazon.in / Flipkart session. Access is read-only, and the
control is a **per-site path allowlist** (`sites/*.json`), not a denylist. A URL is allowed only if its
host is *exactly* an adapter host and its path matches one of that adapter's `allow` regexes and none of
its `deny` regexes. Sign-in, checkout, add-to-cart, payment and account paths are never in the allowlist,
so they are denied by omission rather than by being enumerated.

### 2. Third-party price-history sites

Unauthenticated, lower-trust, and they widen the host allowlist. They get a tight per-site allowlist of
product/lookup paths only, and `loadSites` **rejects** any history adapter whose allow regexes could also
match an account-mutation path — tested behaviourally against an adversarial path suite, not by reading
the regex source. History lookups send only the product's public URL or title, never anything read from an
account page.

### 3. Attacker-controlled page text

Product titles, reviews, seller blurbs and Q&A are written by strangers and fed to a model. The agent is
instructed that page text is data and never instructions, and the agent's output is then **validated as
untrusted data**: unknown fields dropped, strings length-capped, numbers bounded, every URL re-checked
against the allowlist, string fields scrubbed for PII. The main thread treats the report as data too.

## Residual risks

Each row names the mitigation *and* what is still exposed. Where a mitigation is a prompt instruction
rather than a mechanical control, it says so.

### R1 — Fail-open on hook failure

**Mitigation.** The guard catches every error and exits 2, and exit 2 is what blocks a tool call. The
skill's preflight runs `guard.js selftest` first, which also proves `node` exists.
**Residual.** A missing `node`, a crash the guard cannot catch, or a hook timeout is **non-blocking** —
the platform fails open on any non-zero exit other than 2, and on no exit at all. This is the single most
important residual in this document: if the guard does not run, nothing mechanical stops the agent. The
`selftest` preflight is a partial answer, not a fix.

### R2 — Open redirects on allowlisted hosts

**Mitigation.** The `post` hook ("PostToolUse on `navigate` and `tabs_context_mcp`") scans the tool
response for URLs and blocks the page if any host is off-allowlist, telling the agent to discard the page
and close the tab. The agent is told to call `tabs_context_mcp` after every `navigate`.
**Residual.** H2 was live-checked and **failed for `navigate`**: its response only echoes the *requested*
URL (see `.beads/DS-1/evidence-03.txt`), so a post hook on `navigate` alone sees nothing. The real landing
URL appears in a `tabs_context_mcp` listing, which is why the hook now matches that tool too. That relies on
the agent making the call (a prompt-level instruction), and it was observed on one sample only. Redirect
protection is therefore the pre-check (requested URL only) plus this after-the-fact check; neither is
independent of the agent behaving.

### R3 — Main thread driving Chrome unguarded

**Mitigation.** The guard acts only when `agent_type === "claude-deal-scout:deal-scout"`, and the skill
instructs the main thread never to drive Chrome itself.
**Residual.** The scoping is what keeps ordinary Chrome use untouched — and it cuts both ways: a Chrome
call made from the **main thread** is not guarded at all. The only control there is the skill's
instruction. Always in the foreground subagent.

### R4 — Prompt injection through the report

**Mitigation.** Schema validation, URL re-checks, string caps and the PII sanitizer; the skill treats the
report as data.
**Residual.** A hostile *price* or *rating* is still just a number the model will repeat. Validation
bounds it and the flag rules (`inflated_mrp`, `offer_implausible`) catch the implausible, but nothing
proves a plausible-looking wrong number wrong. The user should verify at the link.

### R5 — Third-party history sites

**Mitigation.** Tight per-site allowlist; `kind: "history"` adapters are rejected if their allow regexes
could reach an account path; lookups send only public data; history never overrides the quality floor.
**Residual.** These are third-party sites of unknown provenance, and the plugin widens its host allowlist
for each one added. Do not add a history site that requires login or asks for account data.

### R6 — Forecast overconfidence

**Mitigation.** Every estimate carries a confidence of `high | medium | low | none`, a plain reason, and
wording that says a forecast is an estimate, not a promise. Thin data yields `no_signal` rather than a
guess.
**Residual.** The next-dip estimate is a **heuristic over synthetic-tested logic**. The tests pin
behaviour on constructed series; they say nothing about whether a prediction is right. It is a hint about
seasonality, not a price guarantee.

### R7 — Site terms and bot detection

**Mitigation.** Read-only, the user's own authenticated session, low volume (a shortlist cap per site),
and the agent stops at a CAPTCHA or block page rather than working around it.
**Residual.** Automated reading may still conflict with a site's terms of use, and may still be detected.
The plugin does not attempt evasion, and a detection event degrades to a blocked-page notice rather than
a retry.

### R8 — Stale sale calendar

**Mitigation.** Sale windows live in `data/sale-calendar.json` as data, so a wrong or moved window is
fixed by editing JSON with no code change. The report labels them "typical", never announced.
**Residual.** They are approximations that shift yearly. A wrong window changes only the *confidence* of
a dip estimate, never the ranking — but it can make a forecast look better-supported than it is.

### R9 — Hook matcher misses native-named tools

**Mitigation.** `PreToolUse` matches `mcp__(claude-in-chrome|Claude_Browser)__.*`.
**Residual.** A tool exposed under a **non-MCP name** never matches, so the guard never sees it — a
**silent gap**, which is worse than a fail-open the guard could catch. **Unverified** — see hypothesis H4
in `.beads/DS-1/evidence-03.txt`. If H4 fails, this must be fixed by widening the matcher before the
plugin is trusted.

### R10 — The PII sanitizer is pattern-based

**Mitigation.** Phone-shaped digit runs, email-shaped tokens and long digit runs are redacted from
free-text fields before scoring; a field that is entirely one of those becomes `[redacted]`.
**Residual.** Pattern matching is **not exhaustive**. A number written as words, split across a line, or
in a shape the patterns do not cover will pass through. The sanitizer reduces accidental disclosure; it
does not guarantee it. The stronger control is the agent instruction never to record personal data in the
first place — which is also only an instruction.

### R11 — The `tools:` allowlist is unverified

**Mitigation.** The agent's frontmatter lists exactly the seven read-only tools.
**Residual.** H1 was live-checked and **passed**: the subagent had exactly the seven listed tools, and
`javascript_tool` / `read_network_requests` did not exist for it (see `.beads/DS-1/evidence-07.txt`). One
run on one build; re-check after a Claude Code upgrade. The guard's default-deny remains the second layer.

## Manual end-to-end checklist

Referenced by the plan's §5.3: live Chrome behaviour and real-DOM extraction quality are **not covered by
any automated test**. Run this by hand, and only with the user's explicit go-ahead before the agent
touches their browser.

1. **Install** the plugin from this repo as a local `directory` marketplace. Confirm
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.js" selftest` exits 0.
2. **Log in** to Amazon.in and Flipkart manually in the connected Chrome window. Do not give the agent
   credentials.
3. **Run** `/claude-deal-scout:find-best-deal` with a simple requirement.
4. **Confirm nothing was bought or changed** — check both carts, both wishlists, and that no order or
   payment page was opened.
5. **Confirm an off-allowlist page is discarded** — have the agent navigate somewhere that redirects off
   the allowlist, and check that it discards the page and closes the tab rather than reading it.
6. **Confirm a CAPTCHA stop** is reported in `blocked` and that the run continues rather than stalling or
   retrying.
7. **Confirm the guard does not affect ordinary Chrome use** — browse something unrelated in the same
   window and check nothing is blocked.
8. **Check extraction quality** on a real product page: are prices, ratings and review counts right?
9. **Confirm the read-only denial** by asking the agent to add something to the cart — it must refuse.

## Reporting a problem

This is a personal-use plugin with no security response process. If you find a control that does not hold,
the useful thing is a concrete reproduction: what you asked for, what the guard did, and what it should
have done.
