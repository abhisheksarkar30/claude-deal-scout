'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadBrowsers, validateBrowsers } = require('../scripts/policy');

const BROWSERS_DIR = path.join(__dirname, '..', 'browsers');

// ---------------------------------------------------------------------------
// The shipped registry
// ---------------------------------------------------------------------------

test('the shipped browser registry allows exactly the seven read-only tools', () => {
  const browsers = loadBrowsers(BROWSERS_DIR);
  assert.deepEqual(
    browsers.flatMap((b) => b.allow).sort(),
    ['find', 'get_page_text', 'navigate', 'read_page', 'tabs_close_mcp', 'tabs_context_mcp', 'tabs_create_mcp'],
  );
});

test('the shipped registry keeps tabs_create_mcp out of url_bearing', () => {
  // It takes no parameters and opens a blank tab, so there is no url to check on the call itself —
  // the url is checked on the navigate that follows. Pinned because the guard relies on it to
  // fail closed on a navigate that carries none.
  const browsers = loadBrowsers(BROWSERS_DIR);
  assert.equal(browsers.some((b) => b.url_bearing.includes('tabs_create_mcp')), false);
});

test('the shipped registry landing-checks the navigation tools only', () => {
  // Not the same set as allow: read_page and get_page_text return the page text itself, which is
  // full of third-party links, so scanning those responses would block every read.
  const browsers = loadBrowsers(BROWSERS_DIR);
  assert.deepEqual(browsers.flatMap((b) => b.landing_check).sort(), ['navigate', 'tabs_context_mcp']);
});

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

function browserEntry(id, over = {}) {
  return {
    file: `${id}.json`,
    data: {
      id,
      label: id,
      prefixes: [`mcp__${id}__`],
      allow: ['navigate', 'read_page'],
      url_bearing: ['navigate'],
      landing_check: ['navigate'],
      ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// url_bearing / landing_check must be subsets of allow
// ---------------------------------------------------------------------------

test('a landing_check entry must also be in allow', () => {
  const without = browserEntry('b', { landing_check: ['tabs_context_mcp', 'navigate'] });
  assert.throws(() => validateBrowsers([browserEntry('a'), without]), /landing_check/);
  assert.throws(() => validateBrowsers([browserEntry('a', { landing_check: ['nope'] })]), /landing_check/);
});

test('a url_bearing entry must also be in allow', () => {
  assert.throws(() => validateBrowsers([browserEntry('a', { url_bearing: ['not_allowed'] })]), /url_bearing/);
});

test('url_bearing and landing_check may be empty arrays', () => {
  const browsers = validateBrowsers([
    browserEntry('a', { url_bearing: [], landing_check: [] }),
  ]);
  assert.equal(browsers.length, 1);
});

// ---------------------------------------------------------------------------
// Cross-file uniqueness
// ---------------------------------------------------------------------------

test('a tool name claimed by two adapters is rejected', () => {
  assert.throws(
    () => validateBrowsers([browserEntry('a'), browserEntry('b', { allow: ['navigate', 'find'] })]),
    /already allowed by browsers\/a\.json/,
  );
});

test('a duplicate server prefix across adapters is rejected', () => {
  // b claims a's prefix but keeps its own tool names, so the prefix is the only thing wrong with it.
  const overlapping = browserEntry('b', {
    prefixes: ['mcp__a__'],
    allow: ['snapshot'],
    url_bearing: [],
    landing_check: [],
  });
  assert.throws(() => validateBrowsers([browserEntry('a'), overlapping]), /already claimed by browsers\/a\.json/);
});

test('duplicate adapter ids are rejected', () => {
  assert.throws(
    () => validateBrowsers([browserEntry('a'), browserEntry('a', { allow: ['find'], prefixes: ['mcp__other__'] })]),
    /duplicate adapter id/,
  );
});

// ---------------------------------------------------------------------------
// General schema validation
// ---------------------------------------------------------------------------

test('a prefix must end in __ and a bare name must not contain it', () => {
  for (const prefixes of [['mcp__x'], ['mcp__x_'], []]) {
    assert.throws(
      () => validateBrowsers([browserEntry('a', { prefixes })]),
      /prefixes/,
      `expected reject for prefixes ${JSON.stringify(prefixes)}`,
    );
  }
  for (const allow of [['already__prefixed'], []]) {
    assert.throws(
      () => validateBrowsers([browserEntry('a', { allow })]),
      /allow/,
      `expected reject for allow ${JSON.stringify(allow)}`,
    );
  }
});

test('a browser adapter must be a JSON object carrying an id and a label', () => {
  assert.throws(() => validateBrowsers([{ file: 'x.json', data: null }]), /JSON object/);
  assert.throws(() => validateBrowsers([browserEntry('a', { id: undefined })]), /"id"/);
  assert.throws(() => validateBrowsers([browserEntry('a', { label: '' })]), /"label"/);
  assert.throws(() => validateBrowsers([browserEntry('a', { notes: ['ok', 7] })]), /notes/);
});

test('loadBrowsers fails closed on a missing or empty browsers directory', () => {
  assert.throws(() => loadBrowsers(path.join(__dirname, 'does-not-exist')), /ENOENT|no such file/i);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-scout-browsers-'));
  try {
    assert.throws(() => loadBrowsers(empty), /no browser adapters found/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
