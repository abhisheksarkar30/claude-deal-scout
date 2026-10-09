'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  analyze,
  analyzeAll,
  loadSaleCalendar,
  MIN_POINTS,
  MAX_POINTS,
  VERDICTS,
  CAVEAT,
} = require('../scripts/history');

const TODAY = '2026-03-15';

/** Deliberately does not contain month 12, so the December fixtures have no overlap. */
const CALENDAR = [
  { name: 'Great Indian Festival', months: [9, 10] },
  { name: 'Republic Day Sale', months: [1] },
];

const YEAR_END = [{ name: 'Year End Sale', months: [12] }];

const opts = (extra = {}) => ({ today: TODAY, saleCalendar: CALENDAR, ...extra });

/** 12 points across 2024-2025; December is the only cheap month in each year. */
function decemberSeries() {
  const points = [];
  for (const year of [2024, 2025]) {
    for (const month of [1, 3, 6, 9, 11, 12]) {
      points.push({ date: `${year}${String(month).padStart(2, '0')}15`, price: month === 12 ? 1000 : 2000 });
    }
  }
  return points;
}

/** One cheap December per year, but only four points in total. */
const THIN_POINTS = [
  { date: '20240115', price: 2000 },
  { date: '20241215', price: 1000 },
  { date: '20250615', price: 2000 },
  { date: '20251215', price: 1000 },
];

function history(over = {}) {
  return {
    current: 2000,
    lowest: { price: 1000, date: '20241215' },
    highest: { price: 2200, date: '20240615' },
    average: 1800,
    points: decemberSeries(),
    ...over,
  };
}

const SUMMARY_ONLY = {
  current: 2000,
  lowest: { price: 1000, date: '20241215' },
  highest: { price: 2200, date: '20240615' },
  average: 1800,
};

// ---------------------------------------------------------------------------
// typical_low_window
// ---------------------------------------------------------------------------

test('recurring December lows give a confident window and a next-dip estimate', () => {
  const result = analyze(history(), opts());
  assert.equal(result.typical_low_window.label, 'confident');
  assert.deepEqual(result.typical_low_window.months, [12]);
  assert.equal(result.next_dip_estimate.month, 12);
  assert.equal(result.next_dip_estimate.year, 2026);
  assert.equal(result.next_dip_estimate.confidence, 'medium');
});

test('a confident window overlapping a sale window is high confidence', () => {
  const result = analyze(history(), opts({ saleCalendar: YEAR_END }));
  assert.equal(result.next_dip_estimate.confidence, 'high');
  assert.equal(result.next_dip_estimate.sale_window, 'Year End Sale');
});

test('summary-only input degrades to a low-confidence window and none confidence', () => {
  const result = analyze(SUMMARY_ONLY, opts());
  assert.equal(result.typical_low_window.label, 'low_confidence');
  assert.deepEqual(result.typical_low_window.months, [12]);
  assert.equal(result.next_dip_estimate.confidence, 'none');
});

test('a 2-year dataset with only 4 points is low-confidence, not confident', () => {
  const result = analyze({ ...SUMMARY_ONLY, points: THIN_POINTS }, opts());
  assert.equal(result.typical_low_window.label, 'low_confidence');
  assert.equal(result.next_dip_estimate.confidence, 'low');
});

test('thin multi-year data is medium confidence when a sale window overlaps', () => {
  const result = analyze({ ...SUMMARY_ONLY, points: THIN_POINTS }, opts({ saleCalendar: YEAR_END }));
  assert.equal(result.next_dip_estimate.confidence, 'medium');
});

test('many points inside a single calendar year stay low-confidence with none confidence', () => {
  const points = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({
    date: `2025${String(month).padStart(2, '0')}15`,
    price: month === 12 ? 1000 : 2000,
  }));
  const result = analyze({ ...SUMMARY_ONLY, points }, opts());
  assert.equal(result.typical_low_window.label, 'low_confidence');
  assert.equal(result.next_dip_estimate.confidence, 'none');
});

// ---------------------------------------------------------------------------
// verdict — step (1), the data-quality gate
// ---------------------------------------------------------------------------

test('contradictory history is no_signal', () => {
  const result = analyze(history({ lowest: { price: 3000, date: '20241215' }, highest: { price: 1000, date: '20240615' } }), opts());
  assert.equal(result.verdict, 'no_signal');
  assert.match(result.reason, /contradictory/);
});

test('a price just below the low is buy_now, implausibly far below is no_signal', () => {
  assert.equal(analyze(history({ current: 950 }), opts()).verdict, 'buy_now');
  assert.equal(analyze(history({ current: 750 }), opts()).verdict, 'no_signal');
});

// ---------------------------------------------------------------------------
// verdict — step (2a), price proximity
// ---------------------------------------------------------------------------

test('a current price at the historical low is buy_now', () => {
  assert.equal(analyze(history({ current: 1000 }), opts()).verdict, 'buy_now');
});

test('summary-only input at the recorded low is buy_now, not no_signal', () => {
  const result = analyze({ ...SUMMARY_ONLY, current: 1000 }, opts());
  assert.equal(result.verdict, 'buy_now');
});

test('summary-only input within 5% of the low is buy_now despite zero points', () => {
  assert.equal(analyze({ ...SUMMARY_ONLY, current: 1050 }, opts()).verdict, 'buy_now');
});

// ---------------------------------------------------------------------------
// verdict — steps (3) and (4), and the deadline-dependent branches
// ---------------------------------------------------------------------------

test('the point-count gate blocks wait on sparse data', () => {
  const result = analyze({ ...SUMMARY_ONLY, current: 1200, points: THIN_POINTS }, opts({ deadline: '2026-12-31' }));
  assert.equal(result.verdict, 'no_signal');
  assert.match(result.reason, /data point/);
});

test('a recurring pattern inside the deadline horizon is wait; inside 5% of the low is buy_now', () => {
  const deadline = '2026-12-31';
  const waited = analyze(history({ current: 1060 }), opts({ deadline }));
  assert.equal(waited.verdict, 'wait');
  assert.match(waited.reason, /dip in month 12/);

  assert.equal(analyze(history({ current: 1040 }), opts({ deadline })).verdict, 'buy_now');
});

test('buy_now via the firm-no-dip branch when the dip falls after the deadline', () => {
  const result = analyze(history({ current: 1060 }), opts({ deadline: '2026-06-30' }));
  assert.equal(result.verdict, 'buy_now');
  assert.match(result.reason, /after your deadline/);
});

test('confidence none does not satisfy the no-dip branch', () => {
  // The dip (Dec 2026) falls after this deadline, so a placeable confidence would have returned
  // buy_now. `none` must fall through to the point-count gate instead.
  const result = analyze({ ...SUMMARY_ONLY, current: 1200 }, opts({ deadline: '2026-06-30' }));
  assert.equal(result.verdict, 'no_signal');
  assert.match(result.reason, /data point/);
});

test('single-year data reaches no_signal by the same path', () => {
  const points = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({
    date: `2025${String(month).padStart(2, '0')}15`,
    price: month === 12 ? 1000 : 2000,
  }));
  const result = analyze(
    { current: 1200, lowest: { price: 1000, date: '20251215' }, highest: { price: 2000, date: '20250615' }, average: 1800, points },
    opts({ deadline: '2026-06-30' }),
  );
  assert.equal(result.verdict, 'no_signal');
});

test('with no deadline the deadline-dependent branches are omitted, and (2a) is unaffected', () => {
  const above = analyze(history({ current: 1200 }), opts());
  assert.equal(above.verdict, 'no_signal');
  assert.match(above.reason, /no reliable pattern/);

  assert.equal(analyze(history({ current: 1000 }), opts()).verdict, 'buy_now');
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

test('every result carries the three verdicts enum, the caveat and both comparisons', () => {
  const result = analyze(history({ current: 1060 }), opts({ deadline: '2026-12-31' }));
  assert.ok(VERDICTS.includes(result.verdict));
  assert.equal(result.caveat, CAVEAT);
  assert.equal(result.vs_lowest, 6);
  assert.equal(result.vs_average, -41.1);
  assert.equal(MIN_POINTS, 12);
});

// ---------------------------------------------------------------------------
// Graceful skip — §3.6's uniform rule
// ---------------------------------------------------------------------------

test('a candidate with no history key produces no output and does not throw', () => {
  assert.equal(analyze(undefined, opts()), null);
  assert.equal(analyze(null, opts()), null);
  assert.equal(analyze({}, opts()), null);
});

test('a history object missing any required summary field is skipped', () => {
  for (const missing of ['current', 'average', 'lowest', 'highest']) {
    const broken = history();
    delete broken[missing];
    assert.equal(analyze(broken, opts()), null, `missing ${missing}`);
  }
});

test('a points array over the 400-point cap is skipped, at the cap it is not', () => {
  const atCap = Array.from({ length: MAX_POINTS }, (_, i) => ({ date: '20260115', price: 1000 + i }));
  assert.notEqual(analyze(history({ points: atCap }), opts()), null);

  const overCap = Array.from({ length: MAX_POINTS + 1 }, (_, i) => ({ date: '20260115', price: 1000 + i }));
  assert.equal(analyze(history({ points: overCap }), opts()), null);
});

test('malformed points fail validation rather than being silently dropped', () => {
  assert.equal(analyze(history({ points: [{ date: '20260115', price: 1000 }, { date: 'nonsense', price: 900 }] }), opts()), null);
  assert.equal(analyze(history({ points: [{ date: '20260115', price: 'cheap' }] }), opts()), null);
  assert.equal(analyze(history({ points: 'not an array' }), opts()), null);
});

// ---------------------------------------------------------------------------
// analyzeAll / loadSaleCalendar
// ---------------------------------------------------------------------------

test('analyzeAll aligns results with the input array and never throws', () => {
  const results = analyzeAll([{ history: history({ current: 1000 }) }, {}, { history: { current: 1 } }], opts());
  assert.equal(results.length, 3);
  assert.equal(results[0].verdict, 'buy_now');
  assert.equal(results[1], null);
  assert.equal(results[2], null);
  assert.deepEqual(analyzeAll(null, opts()), []);
});

test('loadSaleCalendar tolerates a missing file', () => {
  assert.deepEqual(loadSaleCalendar(path.join(__dirname, 'no-such-calendar.json')), []);
});
