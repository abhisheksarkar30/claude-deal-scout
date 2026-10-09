'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { DENY_VOCABULARY, checkUrl, loadSites, validateSites } = require('../scripts/policy');

const SITES_DIR = path.join(__dirname, '..', 'sites');

// ---------------------------------------------------------------------------
// The shipped adapters
// ---------------------------------------------------------------------------

test('every shipped adapter loads and the shop set is the v1 pair', () => {
  const sites = loadSites(SITES_DIR);
  assert.deepEqual(
    sites.filter((s) => s.kind === 'shop').map((s) => s.id).sort(),
    ['amazon-in', 'flipkart'],
  );
});

test("every shipped adapter's urls.* template satisfies its own policy", () => {
  const sites = loadSites(SITES_DIR);
  for (const adapter of sites) {
    for (const [key, template] of Object.entries(adapter.urls)) {
      const url = template.replace(/\{[^}]+\}/g, 'test-value');
      const result = checkUrl(url, sites);
      assert.equal(result.ok, true, `${adapter.id}.urls.${key} = ${url} -> ${result.reason}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

function shopEntry(id, over = {}) {
  return {
    file: `${id}.json`,
    data: {
      id,
      kind: 'shop',
      label: id,
      hosts: [`${id}.example`],
      allow: ['^/dp/[A-Z0-9]{10}$'],
      deny: DENY_VOCABULARY,
      urls: {
        search: `https://${id}.example/s?k={q}`,
        cart: `https://${id}.example/cart`,
        wishlist: `https://${id}.example/wishlist`,
      },
      ...over,
    },
  };
}

function historyEntry(over = {}) {
  return {
    file: 'hist.json',
    data: {
      id: 'hist',
      kind: 'history',
      label: 'History Site',
      hosts: ['hist.example'],
      allow: ['^/price/[^/]+$'],
      urls: { lookup: 'https://hist.example/price/{id}' },
      covers: ['shop-a'],
      ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// history adapters must not reach mutating paths
// ---------------------------------------------------------------------------

test('a history adapter with an overbroad allow regex is rejected at load', () => {
  assert.throws(
    () => validateSites([shopEntry('shop-a'), historyEntry({ allow: ['^/.*$'] })]),
    /mutating path/,
  );
  assert.throws(
    () => validateSites([shopEntry('shop-a'), historyEntry({ allow: ['^/price/[^/]+$', '^/buy/.*$'] })]),
    /mutating path/,
  );
});

test('a history adapter matching only innocent paths is not falsely rejected', () => {
  const sites = validateSites([
    shopEntry('shop-a'),
    historyEntry({ allow: ['^/product/address-guide-[0-9]+$'] }),
  ]);
  assert.equal(sites.filter((s) => s.kind === 'history').length, 1);
});

// ---------------------------------------------------------------------------
// history adapters must cover loaded shop adapters
// ---------------------------------------------------------------------------

test('a history adapter covering an unknown shop adapter id is rejected at load', () => {
  assert.throws(
    () => validateSites([shopEntry('shop-a'), historyEntry({ covers: ['shop-a', 'nope'] })]),
    /not a loaded shop adapter/,
  );
  assert.throws(() => validateSites([historyEntry({ covers: ['shop-a'] })]), /not a loaded shop adapter/);
});

test('a history adapter needs a non-empty covers array', () => {
  assert.throws(() => validateSites([shopEntry('shop-a'), historyEntry({ covers: [] })]), /covers/);
  const withoutCovers = historyEntry();
  delete withoutCovers.data.covers;
  assert.throws(() => validateSites([shopEntry('shop-a'), withoutCovers]), /covers/);
});

// ---------------------------------------------------------------------------
// general schema validation
// ---------------------------------------------------------------------------

test('duplicate adapter ids are rejected', () => {
  assert.throws(() => validateSites([shopEntry('shop-a'), shopEntry('shop-a')]), /duplicate adapter id/);
});

test('hosts must be bare lowercase hostnames', () => {
  for (const hosts of [['https://shop.example'], ['SHOP.example'], ['shop.example/path'], ['shop.example:443'], []]) {
    assert.throws(
      () => validateSites([shopEntry('shop-a', { hosts })]),
      /hosts/,
      `expected reject for hosts ${JSON.stringify(hosts)}`,
    );
  }
});

test('a shop adapter must carry its url templates and a valid allow list', () => {
  assert.throws(() => validateSites([shopEntry('shop-a', { urls: { search: 'https://x.example/s' } })]), /urls\.(cart|wishlist)/);
  assert.throws(() => validateSites([shopEntry('shop-a', { allow: [] })]), /allow/);
  assert.throws(() => validateSites([shopEntry('shop-a', { allow: ['^/dp/['] })]), /allow/);
  assert.throws(() => validateSites([shopEntry('shop-a', { kind: 'shopfront' })]), /kind/);
  assert.throws(() => validateSites([shopEntry('shop-a', { deny: ['ok', 7] })]), /deny/);
});

test('loadSites fails closed on an empty or malformed sites directory', () => {
  assert.throws(() => loadSites(path.join(__dirname, 'does-not-exist')), /ENOENT|no such file/i);
});
