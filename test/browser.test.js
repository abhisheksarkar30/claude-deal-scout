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

// Asserted per adapter rather than over the union: the two shipped browsers are allowed to
// overlap in *purpose*, not in tool names (validateBrowsers forbids that), so a union assertion
// would stop being able to catch a single adapter quietly growing a tool.

test('each shipped browser adapter allows exactly its documented read-only set', () => {
  const byId = Object.fromEntries(loadBrowsers(BROWSERS_DIR).map((b) => [b.id, b.allow.slice().sort()]));
  assert.deepEqual(byId, {
    'claude-in-chrome': [
      'find', 'get_page_text', 'navigate', 'read_page',
      'tabs_close_mcp', 'tabs_context_mcp', 'tabs_create_mcp',
    ],
    'chrome-devtools': [
      'close_page', 'list_pages', 'navigate_page', 'new_page',
      'select_page', 'take_snapshot', 'wait_for',
    ],
  });
});

test('the shipped adapters disagree about url_bearing, and both are right', () => {
  const byId = Object.fromEntries(loadBrowsers(BROWSERS_DIR).map((b) => [b.id, b.url_bearing.slice().sort()]));
  // Claude in Chrome's tab opener takes no parameters and opens a blank tab, so there is no url to
  // check on the call itself. chrome-devtools' new_page takes a url and loads it, so it does.
  assert.deepEqual(byId, {
    'claude-in-chrome': ['navigate'],
    'chrome-devtools': ['navigate_page', 'new_page'],
  });
  assert.equal(loadBrowsers(BROWSERS_DIR).some((b) => b.url_bearing.includes('tabs_create_mcp')), false);
});

test('each shipped adapter landing-checks its navigation tools, never its page reads', () => {
  // Not the same set as allow: the page-reading tools return the page itself, full of third-party
  // links, so scanning those responses would block every read. On a live run chrome-devtools'
  // take_snapshot carried a `url=` attribute on nearly every link, which is exactly that hazard.
  const browsers = loadBrowsers(BROWSERS_DIR);
  const byId = Object.fromEntries(browsers.map((b) => [b.id, b.landing_check.slice().sort()]));
  assert.deepEqual(byId, {
    'claude-in-chrome': ['navigate', 'tabs_context_mcp'],
    'chrome-devtools': ['list_pages', 'navigate_page'],
  });
  for (const b of browsers) {
    for (const reader of ['read_page', 'get_page_text', 'take_snapshot']) {
      assert.equal(b.landing_check.includes(reader), false, `${b.id} must not landing-check ${reader}`);
    }
  }
});

test("the subagent's tool grant matches exactly one shipped adapter", () => {
  // The frontmatter `tools:` list cannot be generated from the registry (it is fixed Markdown), so
  // it can silently drift. This does not generate it — it makes the drift fail loudly, which is the
  // part that matters: a grant naming tools no adapter allows would have the guard deny every call
  // the agent makes, and a grant naming a *different* adapter than the intended one would silently
  // swap the browser.
  const md = fs.readFileSync(path.join(__dirname, '..', 'agents', 'deal-scout.md'), 'utf8');
  const line = md.match(/^tools:\s*(.+)$/m);
  assert.ok(line, 'agents/deal-scout.md must declare a tools: list');

  const granted = line[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(granted.length > 0, 'the tools: list must not be empty');

  const prefixes = new Set(granted.map((t) => t.slice(0, t.lastIndexOf('__') + 2)));
  assert.equal(prefixes.size, 1, `every granted tool must share one server prefix, got ${[...prefixes]}`);

  const [prefix] = [...prefixes];
  const adapter = loadBrowsers(BROWSERS_DIR).find((b) => b.prefixes.includes(prefix));
  assert.ok(adapter, `no shipped browser adapter claims prefix ${prefix}`);

  assert.deepEqual(
    granted.map((t) => t.slice(prefix.length)).sort(),
    adapter.allow.slice().sort(),
    `the grant must name exactly ${adapter.id}'s allowed tools`,
  );
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
