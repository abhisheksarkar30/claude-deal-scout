#!/usr/bin/env node
'use strict';

/**
 * The skill's single deterministic entry point.
 *
 * Reads the research agent's JSON on stdin, takes the skill's requirement (budget / eligible
 * conditions / deadline) as `--requirement <json>`, validates and scores the candidates with
 * `score.js`, runs `history.js` over the same raw candidate array, and prints one merged report on
 * stdout.
 *
 * It exists so the skill invokes one command instead of pasting Node into a prompt, and so the whole
 * pipeline — validate, rank, history, merge — is testable end to end without a browser.
 */

const fs = require('node:fs');
const path = require('node:path');

const { loadSites } = require('./policy');
const { score } = require('./score');
const { analyzeAll, loadSaleCalendar } = require('./history');

const ROOT = path.join(__dirname, '..');

/**
 * Both `score.js` and `history.js` receive the agent's raw candidates directly — neither feeds the
 * other (§3.7 step 4). They are joined here, on `candidate.index`, because validation may drop
 * candidates and so the two output arrays are not positionally aligned.
 *
 * `input.requirement` is NOT part of the agent's JSON (the agent emits exactly `candidates`, `gaps`
 * and `blocked` — §3.4 step 5). The skill, which collected it at intake (§3.7 step 1), supplies it
 * separately and `main()` merges it into `input` before this call.
 */
function buildReport(input, adapters, saleCalendar) {
  const candidates = Array.isArray(input && input.candidates) ? input.candidates : [];
  const requirement = (input && input.requirement) || {};

  const scored = score({ requirement, candidates }, adapters);
  const histories = analyzeAll(candidates, { deadline: requirement.deadline, saleCalendar });

  return {
    ...scored,
    candidates: scored.candidates.map((candidate) => ({
      ...candidate,
      price_history: histories[candidate.index] || null,
    })),
    gaps: Array.isArray(input && input.gaps) ? input.gaps : [],
    blocked: Array.isArray(input && input.blocked) ? input.blocked : [],
  };
}

/**
 * The requirement (budget, `eligible_conditions`, deadline) as a `--requirement <json>` argument.
 *
 * Without it, `requirement` is `{}` — and silently so: `budget`/`eligible_conditions`/`deadline` are
 * all absent, so the `over_budget` flag and `best_deal`'s budget gate never fire and both
 * deadline-dependent verdict branches are omitted. That is why the skill must pass it (§3.7 step 4)
 * and why a malformed value fails loudly rather than defaulting to `{}`.
 *
 * @returns {object|undefined} the parsed requirement, or undefined when the flag is absent
 */
function requirementFromArgv(argv) {
  const flag = argv.indexOf('--requirement');
  if (flag === -1) return undefined;
  const raw = argv[flag + 1];
  if (raw === undefined) throw new Error('--requirement needs a JSON argument');
  return JSON.parse(raw);
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    process.stderr.write(`deal-scout report: could not read the agent's JSON from stdin — ${err.message}\n`);
    return 2;
  }

  try {
    const requirement = requirementFromArgv(process.argv.slice(2));
    const merged = requirement === undefined ? input : { ...input, requirement };
    const adapters = loadSites(path.join(ROOT, 'sites'));
    const saleCalendar = loadSaleCalendar(path.join(ROOT, 'data', 'sale-calendar.json'));
    process.stdout.write(`${JSON.stringify(buildReport(merged, adapters, saleCalendar), null, 2)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`deal-scout report: ${err.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exit(main());

module.exports = { buildReport };
