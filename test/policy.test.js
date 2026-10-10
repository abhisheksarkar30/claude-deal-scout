'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DENY_VOCABULARY,
  ADVERSARIAL_PATHS,
  MAX_URL_LENGTH,
  checkTool,
  checkUrl,
  loadBrowsers,
  loadSites,
  validateSites,
  sourceToBareId,
} = require('../scripts/policy');

const ADAPTERS = loadSites(path.join(__dirname, '..', 'sites'));
const BROWSERS = loadBrowsers(path.join(__dirname, '..', 'browsers'));

const ok = (url) => checkUrl(url, ADAPTERS).ok;
const why = (url) => checkUrl(url, ADAPTERS).reason;

// ---------------------------------------------------------------------------
// checkUrl — host
// ---------------------------------------------------------------------------

test('checkUrl denies hosts that are not exactly an adapter host', () => {
  const hostile = [
    'https://amazon.in.evil.com/dp/B0XXXXXXXX',
    'https://www.amazon.in.evil.com/dp/B0XXXXXXXX',
    'https://evilamazon.in/dp/B0XXXXXXXX',
    'https://amazon.in@evil.com/dp/B0XXXXXXXX',
    'https://amazon.in:8443/dp/B0XXXXXXXX',
    'https://amazon.in./dp/B0XXXXXXXX',
    'https://аmazon.in/dp/B0XXXXXXXX',
    'https://127.0.0.1/dp/B0XXXXXXXX',
    'https://www.amazon.in.attacker.test/dp/B0XXXXXXXX',
  ];
  for (const url of hostile) {
    assert.equal(ok(url), false, `expected deny for ${url}`);
    assert.ok(why(url), `expected a reason for ${url}`);
  }
});

test('checkUrl allows the bare and www host forms', () => {
  assert.equal(ok('https://amazon.in/dp/B0XXXXXXXX'), true);
  assert.equal(ok('https://www.amazon.in/dp/B0XXXXXXXX'), true);
  assert.equal(ok('https://flipkart.com/search?q=phone'), true);
  assert.equal(ok('https://www.flipkart.com/search?q=phone'), true);
});

// ---------------------------------------------------------------------------
// checkUrl — scheme, credentials, encoding
// ---------------------------------------------------------------------------

test('checkUrl denies every non-https scheme', () => {
  for (const url of [
    'http://www.amazon.in/dp/B0XXXXXXXX',
    'ftp://www.amazon.in/dp/B0XXXXXXXX',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
  ]) {
    assert.equal(ok(url), false, `expected deny for ${url}`);
  }
});

test('checkUrl denies whitespace, control characters and backslashes', () => {
  for (const url of [
    'https://www.amazon.in/dp/B0XXXXXXXX ',
    ' https://www.amazon.in/dp/B0XXXXXXXX',
    'https://www.amazon.in/dp/B0XXXXXXXX\n',
    'https://www.amazon.in/dp/B0XXXXXXXX\t',
    'https://www.amazon.in/dp/B0XXXXXXXX\u0000',
    'https://www.amazon.in\\@evil.com/dp/B0XXXXXXXX',
    'https://www.amazon.in/dp/B0XXXX\\XXXX',
  ]) {
    assert.equal(ok(url), false, `expected deny for ${JSON.stringify(url)}`);
  }
});

test('checkUrl enforces the length cap on an otherwise-allowed URL', () => {
  const long = `https://www.amazon.in/s?k=${'a'.repeat(MAX_URL_LENGTH)}`;
  assert.ok(long.length > MAX_URL_LENGTH);
  assert.equal(ok(long), false);
  assert.match(why(long), /longer than/);
});

// ---------------------------------------------------------------------------
// checkUrl — path
// ---------------------------------------------------------------------------

test('checkUrl allows the read-only paths the agent uses', () => {
  for (const url of [
    'https://www.amazon.in/dp/B0XXXXXXXX',
    'https://www.amazon.in/s?k=phone',
    'https://www.amazon.in/gp/cart/view.html',
    'https://www.amazon.in/hz/wishlist/ls',
    'https://www.amazon.in/hz/wishlist/ls/ABC123',
    'https://www.flipkart.com/search?q=phone',
    'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm1234abcd',
    'https://www.flipkart.com/viewcart',
    'https://www.flipkart.com/wishlist',
  ]) {
    assert.equal(ok(url), true, `expected allow for ${url}: ${why(url)}`);
  }
});

test('checkUrl denies mutating and account paths', () => {
  for (const url of [
    'https://www.amazon.in/gp/cart/add.html',
    'https://www.amazon.in/gp/buy/now.html',
    'https://www.amazon.in/checkout/entry',
    'https://www.amazon.in/ap/signin',
    'https://www.amazon.in/gp/css/order-history',
    'https://www.flipkart.com/account/login',
    'https://www.flipkart.com/checkout/p/itm1234abcd',
  ]) {
    assert.equal(ok(url), false, `expected deny for ${url}`);
  }
});

// ---------------------------------------------------------------------------
// deny vocabulary boundaries
// ---------------------------------------------------------------------------

const SYNTHETIC_SHOP = {
  file: 'shop-x.json',
  data: {
    id: 'shop-x',
    kind: 'shop',
    label: 'Shop X',
    hosts: ['shop.example'],
    allow: ['^/product/[a-z-]+$'],
    deny: DENY_VOCABULARY,
    urls: {
      search: 'https://shop.example/s?k={q}',
      cart: 'https://shop.example/cart',
      wishlist: 'https://shop.example/wishlist',
    },
  },
};

test('deny tokens match at a word boundary, not as a bare substring', () => {
  const adapters = validateSites([SYNTHETIC_SHOP]);

  // "address" must not fire on "address-guide", "order" must not fire on "orders-report".
  assert.equal(checkUrl('https://shop.example/product/address-guide', adapters).ok, true);
  assert.equal(checkUrl('https://shop.example/product/orders-report', adapters).ok, true);

  // ...but the real mutating words must still fire.
  assert.equal(checkUrl('https://shop.example/product/add', adapters).ok, false);
  assert.equal(checkUrl('https://shop.example/product/address', adapters).ok, false);
  assert.equal(checkUrl('https://shop.example/product/order', adapters).ok, false);
});

test('the adversarial path suite exercises every deny-vocabulary token', () => {
  for (const token of DENY_VOCABULARY) {
    const adapters = validateSites([
      { ...SYNTHETIC_SHOP, data: { ...SYNTHETIC_SHOP.data, allow: ['^/.*$'], deny: [token] } },
    ]);
    const caught = ADVERSARIAL_PATHS.some((p) => checkUrl(`https://shop.example${p}`, adapters).ok === false);
    assert.ok(caught, `no path in the adversarial suite is caught by deny token "${token}"`);
  }
});

// ---------------------------------------------------------------------------
// checkTool
// ---------------------------------------------------------------------------

test('checkTool allows the read-only set, bare or server-prefixed', () => {
  // Driven off the loaded registry rather than a constant: the config is what is under test, so a
  // tool added to browsers/*.json without a thought for this test still gets exercised here.
  for (const browser of BROWSERS) {
    for (const tool of browser.allow) {
      assert.equal(checkTool(tool, BROWSERS).ok, true, tool);
      for (const prefix of browser.prefixes) {
        assert.equal(checkTool(`${prefix}${tool}`, BROWSERS).ok, true, `${prefix}${tool}`);
      }
    }
  }
});

test('checkTool strips a second configured prefix', () => {
  assert.deepEqual(checkTool('mcp__Claude_Browser__navigate', BROWSERS), { ok: true, tool: 'navigate' });
});

test('checkTool denies every tool outside the read-only set', () => {
  const denied = [
    'computer',
    'form_input',
    'javascript_tool',
    'file_upload',
    'upload_image',
    'gif_creator',
    'read_console_messages',
    'read_network_requests',
  ];
  for (const tool of denied) {
    assert.equal(checkTool(tool, BROWSERS).ok, false, tool);
    assert.equal(checkTool(`mcp__claude-in-chrome__${tool}`, BROWSERS).ok, false, tool);
    assert.equal(checkTool(`mcp__Claude_Browser__${tool}`, BROWSERS).ok, false, tool);
  }
  assert.equal(checkTool('mcp__some-other-server__navigate', BROWSERS).ok, false);
  assert.equal(checkTool('', BROWSERS).ok, false);
  assert.equal(checkTool(undefined, BROWSERS).ok, false);
});

// ---------------------------------------------------------------------------
// sourceToBareId
// ---------------------------------------------------------------------------

test('sourceToBareId strips the account-list suffix', () => {
  assert.equal(sourceToBareId('amazon-in/cart'), 'amazon-in');
  assert.equal(sourceToBareId('amazon-in/wishlist'), 'amazon-in');
  assert.equal(sourceToBareId('amazon-in/saved'), 'amazon-in');
  assert.equal(sourceToBareId('amazon-in'), 'amazon-in');
  assert.equal(sourceToBareId('flipkart/cart'), 'flipkart');
});
