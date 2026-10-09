[← INDEX](INDEX.md)

# Security & Permissions

The authoritative document is **[docs/SECURITY.md](../../docs/SECURITY.md)** — read it, not this
page, before trusting or changing anything security-related. This page exists so an agent can find
*which control lives in which file*, and *which invariants must not be broken*, without re-reading
the whole threat model.

## Trust surfaces

| # | Surface | Control | Enforced by |
|---|---|---|---|
| 1 | The user's **authenticated Amazon.in / Flipkart session** (highest value) | per-site path **allowlist** — account/mutation paths are absent from `allow`, so they are denied by omission rather than enumerated | [policy.js `checkUrl`](../../scripts/policy.js#L124-L154), invoked by the hook **and** by the scorer |
| 2 | **Third-party price-history sites** (unauthenticated, lower trust) | tight lookup-only allowlist; `history` adapters rejected if any `allow` regex can reach an account path; lookups carry only public product URL/title | [policy.js:247-260](../../scripts/policy.js#L247-L260) |
| 3 | **Attacker-controlled page text** fed to a model | agent prompt says page text is data, never instructions; the output is then validated as untrusted data — allowlisted fields, capped strings, bounded numbers, every URL re-checked, PII scrubbed | [deal-scout.md](../../agents/deal-scout.md) "Non-negotiable rules"; [score.js](../../scripts/score.js#L143-L199) |

## The auth / permission model, in code

There is **no authentication** — no login, no token, no session, no user account. The plugin borrows
the user's existing Chrome session and never handles credentials. "Permissions" here means two
allowlists:

### Tool allowlist (default deny)
[`ALLOWED_TOOLS`, policy.js:16-24](../../scripts/policy.js#L16-L24) — exactly seven read-only tools.
Anything else the hook matcher catches is denied, including `computer`, `form_input`,
`javascript_tool`, `file_upload`, `upload_image`, `gif_creator`, `read_console_messages`, and
`read_network_requests`. `read_network_requests` is excluded specifically because request data can
carry session headers. Each is denied bare **and** MCP-prefixed.

### Path allowlist (per site, control not denylist)
`checkUrl` requires: https only, no userinfo, no port other than 443/empty, no trailing-dot host,
host **exactly** equal to an adapter host, pathname matching an `allow` regex and no `deny` token.
See [site-adapters.md](site-adapters.md#how-a-url-is-checked) for the full rule set and why
look-alike hosts fail.

### Consent / disclosure

There is no consent screen and no permission prompt. The one user-facing disclosure is the README
and the skill telling the user, in plain words, to log in **themselves** and that the plugin never
asks for credentials and never signs in for them
([SKILL.md](../../skills/find-best-deal/SKILL.md) step 2, [README.md](../../README.md) step 2).

## Verification status of each control

Some controls are verified, some are not. Do not describe an unverified one as verified.

| Control | Verified? | Evidence |
|---|---|---|
| Host match is exact (look-alikes fail) | ✅ unit-tested, and the negative control (swap to `endsWith`) is specified | [test/policy.test.js](../../test/policy.test.js), plan §5.4 control 1 |
| Guard fails closed (bad stdin/adapter → exit 2) | ✅ spawns the real script | [test/guard.test.js](../../test/guard.test.js) |
| Guard leaves other agents' Chrome use alone | ✅ | [test/guard.test.js](../../test/guard.test.js) |
| `history` adapter overbroad-allow rejection | ✅ | [test/adapter.test.js:78-99](../../test/adapter.test.js#L78-L99) |
| Subagent `tools:` allowlist is honoured (H1) | ✅ **live-checked, passed** — the subagent had exactly the seven tools; `javascript_tool` / `read_network_requests` did not exist for it. One run on one build; **re-check after a Claude Code upgrade** | [evidence-07.txt](../../.beads/DS-1/evidence-07.txt), SECURITY.md R11 |
| `navigate`'s response contains the final URL (H2) | ❌ **live-checked, FAILED** — it echoes only the *requested* URL, which is why the post hook also matches `tabs_context_mcp` | [evidence-03.txt](../../.beads/DS-1/evidence-03.txt), SECURITY.md R2 |
| No dangerous tool is exposed under a non-MCP name (H4) | ❓ **UNVERIFIED** — if one is, the hook matcher never fires for it: a *silent* gap, worse than a fail-open | SECURITY.md R9 |
| Live end-to-end behaviour on real pages | ❌ not covered by any automated test; manual checklist only | [SECURITY.md](../../docs/SECURITY.md) "Manual end-to-end checklist" |

## Residual risks (summary; full text in SECURITY.md)

| Id | Risk | One-line residual |
|---|---|---|
| R1 | Fail-open on hook failure | a missing `node`, an uncatchable crash or a hook timeout is **non-blocking**. The single most important residual. `selftest` preflight is a partial answer, not a fix |
| R2 | Open redirects on allowlisted hosts | post-check is after-the-fact and depends on the agent calling `tabs_context_mcp` |
| R3 | Main thread driving Chrome | unguardable by design — the guard's scope is what keeps ordinary Chrome use untouched; the only control is the skill's instruction |
| R4 | Prompt injection through the report | a *plausible-looking wrong number* is still just a number; validation bounds it, the flag rules catch the implausible, nothing proves it false |
| R5 | Third-party history sites | unknown provenance; the host allowlist widens with each one added. Never add a history site that needs login or account data |
| R6 | Forecast overconfidence | the next-dip estimate is a heuristic validated on synthetic series — it says nothing about prediction accuracy |
| R7 | Site terms and bot detection | automated reading may conflict with a site's terms and be detected; the plugin does not attempt evasion and degrades to a blocked-page notice |
| R8 | Stale sale calendar | windows are approximations that shift yearly; a wrong one changes only *confidence*, never ranking |
| R9 | Hook matcher misses native-named tools | silent gap if a denied tool appears outside the MCP namespace |
| R10 | PII sanitizer is pattern-based | not exhaustive — a number written as words, split across a line, or in an uncovered shape passes through |
| R11 | The `tools:` allowlist is unverified | verified once, on one build — re-check after a Claude Code upgrade |

> ⚠️ **R-numbers are overloaded across files.** `R1`–`R10` in plan **§2** are *requirements*;
> `R1`–`R9` in plan **§6** and `R1`–`R11` in SECURITY.md are *residual risks*. A code comment
> referencing "(R4)" means the residual-risk numbering.

## PII handling

There is no PII store — the plugin persists nothing. The relevant code is the **sanitizer**
([score.js:71-103](../../scripts/score.js#L71-L103)), which runs over `SANITIZED_FIELDS` =
`title`, `source`, `product_key`:

- phone-shaped digit runs (7–9 digits) and long runs (10+) → `[redacted]`
- email-shaped tokens → `[redacted]`
- a value that is *entirely* one of those → the whole value becomes `[redacted]`
- an 8-digit compact date (`20260515`) is deliberately preserved

The stronger control is the agent instruction never to record personal data in the first place —
also only an instruction (R10). The agent is explicitly forbidden from putting addresses, phone
numbers, emails, payment methods, order numbers or order history into the JSON **or** into any gap
note.

## Invariants — do not break these

1. **The guard must keep failing closed.** Any new code path in `guard.js` that can throw without
   being caught turns a block into a pass. Exit 2 is the only blocking code.
2. **The path allowlist is the control; the denylist is depth.** Never widen `allow` for
   convenience — the shipped Amazon adapter's own note says so: "every added path is unreviewed
   attack surface."
3. **The main thread must never drive Chrome.** A Chrome call outside the subagent bypasses the only
   mechanical enforcement layer.
4. **Never send account data to a history site.** Only the public, query-stripped product URL or
   title.
5. **Never add a `click`/`form_input`-style capability.** A hook sees only coordinates or a ref, not
   what is under it — that is why v1 forbids clicks entirely rather than inspecting targets.
6. **Agent output stays untrusted.** Never bypass `score.js`'s validation, and never hand-edit
   malformed agent JSON into shape.
7. **Do not pass a history site's own verdict through.** Third-party "Deal Score" / "Buy signal"
   widgets are page text from an untrusted source.

## Manual end-to-end checklist

Nine steps, including "confirm nothing was bought or changed" and "confirm the read-only denial by
asking the agent to add something to the cart — it must refuse": see
[docs/SECURITY.md](../../docs/SECURITY.md) "Manual end-to-end checklist". Run it only with the
user's explicit go-ahead, since it touches their browser.
