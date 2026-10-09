'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildReport } = require('../scripts/report');
const { loadSites } = require('../scripts/policy');

const REPORT = path.join(__dirname, '..', 'scripts', 'report.js');
const ADAPTERS = loadSites(path.join(__dirname, '..', 'sites'));
const CALENDAR = [{ name: 'Year End Sale', months: [12] }];

const TODAY = '2026-03-15';

function candidate(over = {}) {
  return {
    title: 'Test Phone 128 GB',
    url: 'https://www.amazon.in/dp/B0XXXXXXXX',
    source: 'amazon-in',
    product_key: 'testphone128',
    price: 20000,
    rating: 4.5,
    review_count: 100,
    must_haves_met: true,
    ...over,
  };
}

const DECEMBER_POINTS = [];
for (const year of [2024, 2025]) {
  for (const month of [1, 3, 6, 9, 11, 12]) {
    DECEMBER_POINTS.push({ date: `${year}${String(month).padStart(2, '0')}15`, price: month === 12 ? 1000 : 2000 });
  }
}

test('the pipeline joins scoring and history on the raw candidate array', () => {
  const report = buildReport(
    {
      // The deadline is deliberately in the past relative to any run: the prediction is always in the
      // future, so the "next dip falls after your deadline" branch fires deterministically and this
      // test never depends on the wall clock.
      requirement: { budget: 25000, deadline: '2026-06-30' },
      candidates: [
        candidate({ price: 1000, history: undefined }),
        candidate({
          source: 'flipkart',
          url: 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm1234abcd',
          price: 20000,
          history: {
            current: 1060,
            lowest: { price: 1000, date: '20241215' },
            highest: { price: 2200, date: '20240615' },
            average: 1800,
            points: DECEMBER_POINTS,
          },
        }),
      ],
      gaps: ['login_required: flipkart'],
      blocked: ['https://www.flipkart.com/search?q=phone was a CAPTCHA'],
    },
    ADAPTERS,
    CALENDAR,
  );

  assert.equal(report.candidates.length, 2);
  assert.equal(report.candidates[0].price_history, null);
  assert.equal(report.candidates[1].price_history.verdict, 'buy_now');
  assert.equal(report.candidates[1].price_history.next_dip_estimate.confidence, 'high');
  assert.deepEqual(report.gaps, ['login_required: flipkart']);
  assert.equal(report.blocked.length, 1);
});

test('history stays aligned when validation drops a candidate in between', () => {
  const report = buildReport(
    {
      requirement: {},
      candidates: [
        candidate({ price: 10000 }),
        candidate({ price: Number.NaN }), // dropped by validation
        candidate({
          source: 'flipkart',
          url: 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm1234abcd',
          price: 20000,
          history: { current: 1000, lowest: { price: 1000, date: '20241215' }, highest: { price: 2200, date: '20240615' }, average: 1800 },
        }),
      ],
    },
    ADAPTERS,
    CALENDAR,
  );

  assert.equal(report.candidates.length, 2);
  // The survivor from input index 2 must not inherit index 1's (nonexistent) history.
  const flipkart = report.candidates.find((c) => c.source === 'flipkart');
  assert.equal(flipkart.index, 2);
  assert.equal(flipkart.price_history.verdict, 'buy_now');
  assert.equal(report.candidates.find((c) => c.source === 'amazon-in').price_history, null);
});

test('the report CLI reads the agent JSON on stdin and takes the requirement via --requirement', () => {
  // Agent-shaped payload: exactly the three top-level keys §3.4 step 5 mandates — no `requirement`.
  const input = JSON.stringify({
    candidates: [candidate({ price: 1000 })],
    gaps: [],
    blocked: [],
  });

  const result = spawnSync(process.execPath, [REPORT, '--requirement', JSON.stringify({ budget: 25000 })], {
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.best_deal.source, 'amazon-in');
  assert.deepEqual(parsed.blocked, []);
});

test('the requirement reaches score.js and history.js through --requirement', () => {
  const agentOutput = {
    candidates: [
      candidate({ source: 'amazon-in', price: 20000 }),
      candidate({
        source: 'flipkart',
        url: 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm1234abcd',
        price: 30000,
        history: {
          current: 1060,
          lowest: { price: 1000, date: '20241215' },
          highest: { price: 2200, date: '20240615' },
          average: 1800,
          points: DECEMBER_POINTS,
        },
      }),
    ],
    gaps: [],
    blocked: [],
  };
  const requirement = { budget: 5000, deadline: '2026-06-30' };

  // Control: with no --requirement the agent's JSON carries none, so `requirement` is {} and no
  // requirement-driven behaviour fires — the silent gap this flag closes.
  const without = spawnSync(process.execPath, [REPORT], { input: JSON.stringify(agentOutput), encoding: 'utf8' });
  assert.equal(without.status, 0, without.stderr);
  const withoutReport = JSON.parse(without.stdout);
  assert.equal(withoutReport.requirement.budget, null);
  assert.deepEqual(
    withoutReport.candidates.map((c) => c.flags.includes('over_budget')),
    [false, false],
  );
  assert.equal(withoutReport.candidates[1].price_history.verdict, 'no_signal');

  // With --requirement: the budget reaches score.js (flag + gate) and the deadline reaches history.js.
  const withReq = spawnSync(
    process.execPath,
    [REPORT, '--requirement', JSON.stringify(requirement)],
    { input: JSON.stringify(agentOutput), encoding: 'utf8' },
  );
  assert.equal(withReq.status, 0, withReq.stderr);
  const report = JSON.parse(withReq.stdout);
  assert.equal(report.requirement.budget, 5000);
  assert.deepEqual(
    report.candidates.map((c) => c.flags.includes('over_budget')),
    [true, true],
  );
  assert.equal(report.best_deal, null); // both candidates are over budget
  assert.equal(report.best_deal_message, 'no qualifying deal found');
  // Same history as the control: the deadline alone flipped the verdict from no_signal to buy_now.
  assert.equal(report.candidates[1].price_history.verdict, 'buy_now');
  assert.match(report.candidates[1].price_history.reason, /after your deadline/);
});

test('the report CLI fails loudly on malformed input rather than printing a partial report', () => {
  const result = spawnSync(process.execPath, [REPORT], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /could not read/);
});
