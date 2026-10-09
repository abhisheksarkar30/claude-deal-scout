'use strict';

/**
 * Price-history stats and the buy-now / wait / no-signal verdict.
 *
 * The model extracts; this script judges. Everything here is deterministic, so a change in the
 * verdict order or the confidence rule is a change in the advice the user acts on — hence the
 * fixtures in `test/history.test.js` pin behaviour rather than observing it.
 *
 * The verdict order and the four-value confidence rule were the most-revised part of the design
 * plan. Read §3.6 before changing either.
 */

const fs = require('node:fs');

/** Fewer data points than this and no pattern-dependent branch may fire. */
const MIN_POINTS = 12;

/** A `points` array longer than this fails validation (§3.6). */
const MAX_POINTS = 400;

/** A current price within this percentage of the historical low counts as "at the low". */
const BUY_WITHIN_PCT = 5;

/** A current price this far *below* the recorded low is treated as stale or corrupt data. */
const IMPLAUSIBLE_BELOW_PCT = 20;

const VERDICTS = ['buy_now', 'wait', 'no_signal'];

/** The only four confidence values. Do not add a fifth. */
const CONFIDENCES = ['high', 'medium', 'low', 'none'];

/** Confidences that mean "we can place the next dip" for the step (2b) branch. */
const DIP_PLACEABLE = ['high', 'medium', 'low'];

const CAVEAT = 'Price forecasts are estimates, not promises — "no reliable pattern" is a valid answer.';

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

/** `20260515` or `2026-05-15` -> `{ year, month, day }`. Anything else -> null. */
function parseYmd(value) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Comparable ordering for a year+month pair. */
function monthKey({ year, month }) {
  return year * 12 + month;
}

function isPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBound(value) {
  return Boolean(value) && typeof value === 'object' && isPrice(value.price) && parseYmd(value.date) !== null;
}

/**
 * Validate one `history` input. Returns the narrowed value, or null for *any* failure — §3.6 gives
 * every invalid-input case one uniform outcome (omit `history` for that candidate, no output, no
 * throw). A malformed point counts as a failure, not as a point to skip silently.
 */
function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const { current, lowest, highest, average, points } = raw;
  if (!isPrice(current) || !isPrice(average)) return null;
  if (!isBound(lowest) || !isBound(highest)) return null;

  if (points !== undefined) {
    if (!Array.isArray(points) || points.length > MAX_POINTS) return null;
    for (const point of points) {
      if (!point || typeof point !== 'object') return null;
      if (!isPrice(point.price) || parseYmd(point.date) === null) return null;
    }
  }

  return { current, lowest, highest, average, points: points === undefined ? null : points.slice() };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function percentOf(value, base) {
  return base === 0 ? 0 : ((value - base) / base) * 100;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function uniqueMonths(months) {
  return [...new Set(months)].sort((a, b) => a - b);
}

/** The months holding the cheapest decile of the series (at least one point's worth). */
function lowestDecileMonths(points) {
  const byPrice = [...points].sort((a, b) => a.price - b.price);
  const take = Math.max(1, Math.ceil(byPrice.length / 10));
  return uniqueMonths(byPrice.slice(0, take).map((point) => point.date.month));
}

/** The next calendar month, on or after `from`, that appears in `months`. */
function nextOccurrence(months, from) {
  let best = null;
  for (const month of months) {
    const year = month < from.month ? from.year + 1 : from.year;
    const candidate = { year, month };
    if (best === null || monthKey(candidate) < monthKey(best)) best = candidate;
  }
  return best;
}

/**
 * §3.6's confidence rule. Every `low_confidence` sub-case maps to exactly one value, and no value
 * is reachable from two sub-cases:
 *   confident window            -> high (calendar overlap) | medium (no overlap)
 *   thin multi-year (<MIN_POINTS, >=2 years) -> medium (overlap) | low (no overlap)
 *   single calendar year, or summary-only    -> none
 */
function confidenceFor({ confident, distinctYears, overlapsCalendar }) {
  if (confident) return overlapsCalendar ? 'high' : 'medium';
  if (distinctYears >= 2) return overlapsCalendar ? 'medium' : 'low';
  return 'none';
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Analyze one candidate's `history` input.
 *
 * @param {object} rawHistory  the candidate's `history` value (may be absent/invalid)
 * @param {object} [options]
 * @param {string} [options.deadline]      `YYYY-MM-DD`; omit to drop both deadline-dependent branches
 * @param {string} [options.today]         `YYYY-MM-DD`; injected so tests never read the clock
 * @param {Array}  [options.saleCalendar]  `[{ name, months:number[] }]` from `data/sale-calendar.json`
 * @returns {object|null} null when the input fails validation (skip this candidate, do not throw)
 */
function analyze(rawHistory, options = {}) {
  const input = validate(rawHistory);
  if (!input) return null;

  const saleCalendar = Array.isArray(options.saleCalendar) ? options.saleCalendar : [];
  const deadline = options.deadline ? parseYmd(options.deadline) : null;
  const today = parseYmd(options.today) || parseYmd(new Date().toISOString().slice(0, 10));

  const { current, lowest, highest, average } = input;
  const points = input.points === null ? null : input.points.map((p) => ({ date: parseYmd(p.date), price: p.price }));

  const distinctYears = points ? new Set(points.map((p) => p.date.year)).size : 0;
  const confident = points !== null && points.length >= MIN_POINTS && distinctYears >= 2;

  const months = confident ? lowestDecileMonths(points) : [parseYmd(lowest.date).month];
  const typicalLowWindow = { label: confident ? 'confident' : 'low_confidence', months };

  const dip = today ? nextOccurrence(months, today) : null;
  const saleWindow = dip ? saleCalendar.find((w) => Array.isArray(w && w.months) && w.months.includes(dip.month)) : null;
  const confidence = confidenceFor({ confident, distinctYears, overlapsCalendar: Boolean(saleWindow) });

  const aboveLowPct = percentOf(current, lowest.price);
  const belowLowPct = -aboveLowPct;
  const pointCount = points ? points.length : 0;

  const nextDipEstimate = dip
    ? {
        month: dip.month,
        year: dip.year,
        confidence,
        sale_window: saleWindow ? saleWindow.name : null,
        reason: describeDip({ confidence, months, saleWindow, pointCount, distinctYears }),
      }
    : null;

  const decision = decide({
    current,
    lowest,
    highest,
    aboveLowPct,
    belowLowPct,
    pointCount,
    distinctYears,
    confidence,
    dip,
    deadline,
  });

  return {
    vs_average: round1(percentOf(current, average)),
    vs_lowest: round1(aboveLowPct),
    typical_low_window: typicalLowWindow,
    next_dip_estimate: nextDipEstimate,
    verdict: decision.verdict,
    reason: decision.reason,
    caveat: CAVEAT,
  };
}

function describeDip({ confidence, months, saleWindow, pointCount, distinctYears }) {
  const monthNames = months.join(', ');
  switch (confidence) {
    case 'high':
      return `lows recur in month(s) ${monthNames} across ${distinctYears} years and overlap the ${saleWindow.name} sale window`;
    case 'medium':
      if (saleWindow) return `only ${pointCount} data points, but the low month(s) ${monthNames} overlap the ${saleWindow.name} sale window`;
      return `lows recur in month(s) ${monthNames} across ${distinctYears} years, with no sale window overlapping`;
    case 'low':
      return `only ${pointCount} data points across ${distinctYears} years, and no sale window overlaps month(s) ${monthNames}`;
    default:
      return pointCount === 0
        ? 'summary statistics only — no per-month data to find a pattern in'
        : 'all data falls in a single calendar year, which cannot show a recurring pattern';
  }
}

/**
 * §3.6's fixed verdict order. The order is the contract: (2a) must be reachable on summary-only
 * input, and the point-count gate must never be able to block it.
 */
function decide({ lowest, highest, aboveLowPct, belowLowPct, pointCount, distinctYears, confidence, dip, deadline }) {
  // (1) Data-quality gate — fires regardless of how many points are present.
  if (lowest.price > highest.price) {
    return {
      verdict: 'no_signal',
      reason: 'contradictory history: the lowest recorded price is above the highest recorded price',
    };
  }

  if (belowLowPct > IMPLAUSIBLE_BELOW_PCT) {
    return {
      verdict: 'no_signal',
      reason: `current price is ${round1(belowLowPct)}% below the recorded lowest — stale or corrupt data`,
    };
  }

  // (2a) Price proximity. Needs only `lowest.price`, so it works on summary-only input.
  if (aboveLowPct <= BUY_WITHIN_PCT) {
    const where = aboveLowPct < 0 ? 'below the recorded all-time low' : 'within 5% of the historical low';
    return { verdict: 'buy_now', reason: `current price is ${where}` };
  }

  // (2b) Firm no-dip-before-deadline. `none` falls through: thin data means the dip is unknown,
  // not that no dip is expected.
  if (deadline && dip && DIP_PLACEABLE.includes(confidence) && monthKey(dip) > monthKey(deadline)) {
    return {
      verdict: 'buy_now',
      reason: `the next expected dip (${dip.month}/${dip.year}) falls after your deadline`,
    };
  }

  // (3) Point-count gate — pattern-dependent branches only; (2a) has already resolved above.
  if (pointCount < MIN_POINTS) {
    return {
      verdict: 'no_signal',
      reason: `only ${pointCount} data point(s); ${MIN_POINTS} are needed before a pattern can be claimed`,
    };
  }

  // (4) Pattern check. Deadline-dependent, so it is skipped entirely when no deadline was given.
  if (deadline && distinctYears >= 2 && dip && monthKey(dip) <= monthKey(deadline) && aboveLowPct > BUY_WITHIN_PCT) {
    return {
      verdict: 'wait',
      reason: `prices dip in month ${dip.month} across ${distinctYears} years, which is within your deadline`,
    };
  }

  return { verdict: 'no_signal', reason: 'no reliable pattern in the available data' };
}

/** Analyze a whole `candidates` array. Returns an array aligned by index; null where skipped. */
function analyzeAll(candidates, options = {}) {
  if (!Array.isArray(candidates)) return [];
  return candidates.map((candidate) => analyze(candidate && candidate.history, options));
}

/** Load `data/sale-calendar.json`. A missing file is not an error — it just means no overlap. */
function loadSaleCalendar(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  MIN_POINTS,
  MAX_POINTS,
  BUY_WITHIN_PCT,
  IMPLAUSIBLE_BELOW_PCT,
  VERDICTS,
  CONFIDENCES,
  CAVEAT,
  analyze,
  analyzeAll,
  loadSaleCalendar,
};
