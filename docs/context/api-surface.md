[← INDEX](INDEX.md)

# Interfaces & Entry Points

There is **no HTTP API, no MCP server, no queue, no cron, and no network client**. The interfaces in
this plugin are: the Claude Code **hook protocol**, three **CLI entry points**, the **module
exports** other scripts call, and the **agent↔skill JSON contract**. (`cli-and-tooling.md` was not
generated separately — this file is its content.)

## Hook protocol

Wired in [hooks/hooks.json](../../hooks/hooks.json); implemented in
[scripts/guard.js](../../scripts/guard.js). The guard is a **command hook**: Claude Code writes a
JSON payload to the process's **stdin** and reads the **exit code** (and stdout, for `post`).

| Hook | Matcher | Command | On block |
|---|---|---|---|
| `PreToolUse` | `mcp__(claude-in-chrome\|Claude_Browser)__.*` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.js" pre` | **exit 2** (+ reason on stderr) |
| `PostToolUse` | `mcp__(claude-in-chrome\|Claude_Browser)__(navigate\|tabs_context_mcp)` | `… guard.js post` | exit 0 + stdout `{"decision":"block","reason":"…"}` |

### Payload fields the guard reads

| Field | Used by | Notes |
|---|---|---|
| `agent_type` | both | **scope gate.** Anything other than `"claude-deal-scout:deal-scout"` → allow, unconditionally ([guard.js:141](../../scripts/guard.js#L141)) |
| `tool_name` | `pre` | bare or MCP-prefixed; `checkTool` strips a known prefix |
| `tool_input.url` | `pre` | checked with `checkUrl` when present, **and required** for `navigate` (missing → exit 2, fail closed) |
| `tool_response` (fallback `tool_result`) | `post` | walked for `http(s)://…` strings, depth ≤ 20, first 50 only |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | allow |
| `2` | **block.** This is the only blocking code — every other non-zero exit fails **open**, which is why every error path is converted to 2 ([guard.js:145-149](../../scripts/guard.js#L145-L149)) |

`selftest` is not a hook mode; it is the 32-case matrix run by hand and by the skill's preflight,
printing `selftest OK: 32 cases` and exiting 0.

### Why `tabs_create_mcp` is not in `URL_BEARING_TOOLS`

It takes no parameters, so it opens a blank tab and the URL is checked on the `navigate` that
follows. `navigate` **without** a `url` is a contract violation and blocks
([guard.js:24-31](../../scripts/guard.js#L24-L31)).

## CLI entry points

All three run under plain `node`, with no arguments beyond those below, no subcommand framework,
and no `--help`.

| Command | stdin | stdout | Exit |
|---|---|---|---|
| `node scripts/guard.js pre` | hook payload JSON | — (reason on stderr when blocking) | 0 / 2 |
| `node scripts/guard.js post` | hook payload JSON | `{"decision":"block","reason":…}` when blocking, else nothing | 0 |
| `node scripts/guard.js selftest` | — | `selftest OK: 32 cases` | 0 ok / 1 on any miss / 2 on a load or payload error |
| `node scripts/report.js [--requirement <json>]` | agent JSON | merged report JSON (2-space indented) | 0 / 2 |

- `report.js --requirement` takes **one JSON object as the next argv element**
  ([requirementFromArgv, report.js:62-68](../../scripts/report.js#L62-L68)). Absent flag →
  `requirement` is simply undefined and left out; present but unparseable → throws → exit 2.
- Both write human-readable errors to stderr prefixed with the script name
  (`deal-scout report: …`, `claude-deal-scout guard: …`).
- `report.js` is also importable: `require('./report').buildReport(input, adapters, saleCalendar)`
  ([report.js:94](../../scripts/report.js#L94)).

## Module exports (programmatic surface)

| Module | Exports | Consumed by |
|---|---|---|
| [policy.js](../../scripts/policy.js#L300-L310) | `ALLOWED_TOOLS`, `DENY_VOCABULARY`, `ADVERSARIAL_PATHS`, `MAX_URL_LENGTH`, `checkTool`, `checkUrl`, `loadSites`, `validateSites`, `sourceToBareId` | `guard.js`, `score.js`, `report.js`, tests |
| [score.js](../../scripts/score.js#L388-L407) | the tunable knobs (`W_PRICE`, `W_RATING`, `MIN_RATING`, `PRIOR_MEAN`, `PRIOR_N`, `INFLATED_MRP_PCT`, `MIN_REVIEWS`, `MAX_STRING_LENGTH`, `MAX_NUMBER`), `CANDIDATE_FIELDS`, `OFFER_KINDS`, `REDACTED`, `score`, `sanitize`, `applyOffers`, `adjustedRating`, `passesMustHaves`, `validateCandidate` | `report.js`, tests |
| [history.js](../../scripts/history.js#L296-L307) | `MIN_POINTS`, `MAX_POINTS`, `BUY_WITHIN_PCT`, `IMPLAUSIBLE_BELOW_PCT`, `VERDICTS`, `CONFIDENCES`, `CAVEAT`, `analyze`, `analyzeAll`, `loadSaleCalendar` | `report.js`, tests |
| [report.js](../../scripts/report.js#L94) | `buildReport` | tests |

`guard.js` exports nothing and runs on import — it is a script, not a module
([guard.js:268](../../scripts/guard.js#L268)). `report.js` guards its own entry with
`require.main === module`, so importing it does not execute.

## Agent ↔ skill contract

The subagent returns **one fenced JSON block** with exactly three top-level keys
([deal-scout.md](../../agents/deal-scout.md) step 5):

| Key | Shape | Contract |
|---|---|---|
| `candidates` | candidate objects (see [data-model.md](data-model.md)) | the only field list the scorer accepts |
| `gaps` | string[] | **≤ 5 lines**; `login_required` entries first, then one aggregated line per gap *type* with an accurate count |
| `blocked` | array, one entry per CAPTCHA/interstitial page | outside `gaps`, so it never competes for the 5-line budget |

The `requirement` is **not** in that JSON — the skill holds it and passes it to `report.js` via
`--requirement`. This is the single most common way to silently break the pipeline
([§3.7 step 4](../../docs/planning/DS-1-deal-scout-plugin.md)).

The subagent's own tool surface is a contract too: frontmatter `tools:` lists exactly seven
read-only Chrome tools, and `read_network_requests` is deliberately excluded because request data
can carry session headers ([policy.js:15-24](../../scripts/policy.js#L15-L24)).

## Scheduled / async triggers

None. Nothing runs on a timer, nothing consumes or produces a message, and no background job exists.
Every interface above fires only as part of a single interactive `/claude-deal-scout:find-best-deal`
run.
