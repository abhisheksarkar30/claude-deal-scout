'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { REDACTED, MAX_STRING_LENGTH } = require('../scripts/score');
const {
  BRAND_CONFIDENCES,
  SIGNALS,
  DISCREDITING_SIGNALS,
  MIN_REVIEWS_READ,
  UNVERIFIED_SHARE_MAX,
  UNDERCUT_PCT,
  RATING_GAP,
  CAVEAT,
  analyze,
  analyzeAll,
} = require('../scripts/trust');

function candidate(over = {}) {
  return {
    title: 'Samsung Galaxy S24 128 GB',
    source: 'amazon-in',
    product_key: 's24-128',
    price: 60000,
    rating: 4.4,
    third_party_seller: false,
    trust: {
      brand: 'Samsung',
      brand_store: true,
      seller: 'Appario Retail Private Ltd',
      reviews_read: 8,
      verified_read: 7,
    },
    ...over,
  };
}

/** One candidate, assessed. */
const assess = (over = {}) => analyzeAll([candidate(over)])[0];

/** The first candidate of a set, assessed against the rest as potential peers. */
const primary = (...rest) => analyzeAll([candidate(), ...rest])[0];

const has = (block, signal) => block.signals.includes(signal);

// ---------------------------------------------------------------------------
// The ladder — §3.2's fixed order, first match wins
// ---------------------------------------------------------------------------

test('no evidence at all yields none', () => {
  const block = assess({ trust: {}, third_party_seller: undefined });
  assert.equal(block.brand_confidence, 'none');
});

test('two supports with no discrediting signal yield high', () => {
  const block = assess();
  assert.equal(block.brand_confidence, 'high');
  for (const signal of DISCREDITING_SIGNALS) assert.ok(!has(block, signal), signal);
});

test('a brand store alone is one support and yields medium', () => {
  const block = assess({ trust: { brand_store: true }, third_party_seller: undefined });
  assert.equal(block.brand_confidence, 'medium');
});

test('a first-party seller alone is one support and yields medium', () => {
  const block = assess({ trust: { seller: 'Appario Retail Private Ltd' }, third_party_seller: false });
  assert.equal(block.brand_confidence, 'medium');
});

test('evidence read with no support yields low', () => {
  const block = assess({ trust: { brand: 'Samsung', brand_store: false }, third_party_seller: undefined });
  assert.equal(block.brand_confidence, 'low');
});

test('a brand store plus a third-party seller yields low, not medium', () => {
  const block = assess({ trust: { brand_store: true }, third_party_seller: true });
  assert.ok(has(block, 'seller_third_party'));
  assert.equal(block.brand_confidence, 'low');
});

test('two supports plus a discrediting signal yield low, not high', () => {
  // Rung 1's own "and no discrediting signal" clause. Both supports are present, so only the
  // undercut can hold it down.
  const block = primary(candidate({ source: 'flipkart', price: 80000 }));
  assert.ok(has(block, 'price_undercut'));
  assert.equal(block.brand_confidence, 'low');
});

test('a discrediting signal with no evidence at all yields low, never none', () => {
  // Rung 0 must not claim "nothing was read" when something damning was.
  const block = analyzeAll([
    candidate({ trust: {}, third_party_seller: undefined }),
    candidate({ source: 'flipkart', price: 80000 }),
  ])[0];
  assert.ok(has(block, 'price_undercut'));
  assert.equal(block.brand_confidence, 'low');
});

// ---------------------------------------------------------------------------
// The eight signals — three discrediting, five informational
// ---------------------------------------------------------------------------

test('brand_not_in_title fires when the brand is absent from the listing title', () => {
  assert.ok(has(assess({ title: 'Galaxy S24 128 GB' }), 'brand_not_in_title'));
});

test('brand_not_in_title tolerates case and punctuation between the letters', () => {
  assert.ok(!has(assess({ title: 'sAMSUNG Galaxy S24' }), 'brand_not_in_title'));
  assert.ok(!has(assess({ title: 'Sam-sung Galaxy S24' }), 'brand_not_in_title'));
});

test('price_undercut fires at exactly UNDERCUT_PCT and not one point below', () => {
  const at = analyzeAll([candidate({ price: 1000 }), candidate({ source: 'flipkart', price: 1300 })])[0];
  assert.ok(has(at, 'price_undercut'));

  // The 2000 is the same product on the *same* site, so it is not a peer however dear it is: the
  // only peer is 1299 on the other site — one point below the threshold.
  const below = analyzeAll([
    candidate({ price: 1000 }),
    candidate({ price: 2000 }),
    candidate({ source: 'flipkart', price: 1299 }),
  ])[0];
  assert.ok(!has(below, 'price_undercut'));
});

test('rating_disagrees fires at exactly RATING_GAP', () => {
  const at = analyzeAll([candidate({ rating: 3.5 }), candidate({ source: 'flipkart', price: 60500, rating: 4.5 })])[0];
  assert.ok(has(at, 'rating_disagrees'));

  const below = analyzeAll([candidate({ rating: 3.5 }), candidate({ source: 'flipkart', price: 60500, rating: 4.49 })])[0];
  assert.ok(!has(below, 'rating_disagrees'));
});

test('unverified_review_share sits either side of UNVERIFIED_SHARE_MAX', () => {
  const over = assess({ trust: { brand: 'Samsung', reviews_read: 10, verified_read: 4 } });
  assert.ok(has(over, 'unverified_review_share'));

  const at = assess({ trust: { brand: 'Samsung', reviews_read: 10, verified_read: 5 } });
  assert.ok(!has(at, 'unverified_review_share'));
});

test('review_sample_too_small fires below MIN_REVIEWS_READ', () => {
  const thin = assess({ trust: { brand: 'Samsung', reviews_read: 3, verified_read: 0 } });
  assert.ok(has(thin, 'review_sample_too_small'));

  // At the floor exactly (4), the sample counts as read.
  const at = assess({ trust: { brand: 'Samsung', reviews_read: 4, verified_read: 0 } });
  assert.ok(!has(at, 'review_sample_too_small'));

  // ...and an absent sample is the same answer, not a missing one.
  assert.ok(has(assess({ trust: { brand: 'Samsung' } }), 'review_sample_too_small'));
});

test('a sample below MIN_REVIEWS_READ yields no share signal either way', () => {
  // 3 of 3 unverified would clear UNVERIFIED_SHARE_MAX, but the sample is too thin to say anything.
  const thin = assess({ trust: { brand: 'Samsung', reviews_read: 3, verified_read: 0 } });
  assert.ok(!has(thin, 'unverified_review_share'));
});

test('no_brand_store and no_peer_site are present without moving the confidence', () => {
  const block = assess({
    trust: { brand: 'Samsung', brand_store: false, seller: 'Appario Retail Private Ltd' },
    third_party_seller: false,
  });
  assert.ok(has(block, 'no_brand_store'));
  assert.ok(has(block, 'no_peer_site'));
  // One support (the seller) and no discrediting signal — informational signals changed nothing.
  assert.equal(block.brand_confidence, 'medium');
});

test('DISCREDITING_SIGNALS is a subset of SIGNALS and excludes no_brand_store', () => {
  assert.ok(!DISCREDITING_SIGNALS.includes('no_brand_store'));
  for (const signal of DISCREDITING_SIGNALS) assert.ok(SIGNALS.includes(signal), signal);
});

// ---------------------------------------------------------------------------
// Cross-site peer selection
// ---------------------------------------------------------------------------

test('the same product on the same site is not a peer', () => {
  const block = analyzeAll([candidate({ price: 1000 }), candidate({ price: 2000 })])[0];
  assert.equal(block.peer, null);
  assert.ok(has(block, 'no_peer_site'));
  assert.ok(!has(block, 'price_undercut'));
});

test('a peer on another site is matched and its gap surfaced', () => {
  const block = primary(candidate({ source: 'flipkart', price: 66000 }));
  assert.equal(block.peer.source, 'flipkart');
  assert.equal(block.peer.price_gap_pct, 10);
  assert.ok(!has(block, 'no_peer_site'));
});

test('a peer with no usable price contributes no gap and no undercut', () => {
  const block = primary(candidate({ source: 'flipkart', price: undefined }));
  assert.equal(block.peer.price_gap_pct, null);
  assert.ok(!has(block, 'price_undercut'));
});

test('a product_key-less candidate has no peers and no peer signals', () => {
  const block = assess({ product_key: undefined });
  assert.deepEqual(block.signals, []);
  assert.equal(block.peer, null);
});

test('a product_key-bearing candidate with no source is excluded from peer grouping', () => {
  // sourceToBareId(undefined) is the literal "undefined", which differs from every real id — so
  // without the exclusion rule this source-less candidate would look like a peer on a third site.
  const [bare, named] = analyzeAll([
    candidate({ source: undefined, price: 1000 }),
    candidate({ source: 'amazon-in', price: 1000 }),
  ]);
  assert.equal(named.peer, null);
  assert.ok(has(named, 'no_peer_site'));
  assert.ok(!has(bare, 'no_peer_site'));
});

test('two peers on the other site surface the first by source, then array index', () => {
  const block = analyzeAll([
    candidate({ price: 1000 }),
    candidate({ source: 'flipkart', price: 1500 }),
    candidate({ source: 'flipkart', price: 2000 }),
  ])[0];
  assert.equal(block.peer.source, 'flipkart');
  // The surfaced peer's own gap — not the other peer's 100.
  assert.equal(block.peer.price_gap_pct, 50);
});

test('a signal driven by a peer other than the surfaced one still fires', () => {
  const block = analyzeAll([
    candidate({ price: 1000, rating: 4.0 }),
    candidate({ source: 'flipkart', price: 1100, rating: 4.0 }),
    candidate({ source: 'flipkart', price: 2000, rating: 4.0 }),
  ])[0];
  // The surfaced peer is the 10%-dearer one; the 100% gap is what fires the signal.
  assert.equal(block.peer.price_gap_pct, 10);
  assert.ok(has(block, 'price_undercut'));
});

test('a candidate with no rating has a null rating_gap and no rating_disagrees', () => {
  const block = analyzeAll([
    candidate({ rating: undefined }),
    candidate({ source: 'flipkart', price: 66000, rating: 5 }),
  ])[0];
  assert.equal(block.peer.rating_gap, null);
  assert.ok(!has(block, 'rating_disagrees'));
});

test('the emitted peer.source is sanitized and capped', () => {
  const pii = primary(candidate({ source: '9876543210', price: 66000 }));
  assert.equal(pii.peer.source, REDACTED);

  const long = primary(candidate({ source: 'z'.repeat(400), price: 66000 }));
  assert.equal(long.peer.source.length, MAX_STRING_LENGTH);
});

test('the emitted peer.source is the bare adapter id, not the narrowed source', () => {
  // A peer on an account list (`flipkart/wishlist`) surfaces as `flipkart`, per §3.1/§3.2 — the same
  // bare id `sourceToBareId` matches the peer by, capped+sanitized like `facts`.
  const block = primary(candidate({ source: 'flipkart/wishlist', price: 66000 }));
  assert.equal(block.peer.source, 'flipkart');
});

// ---------------------------------------------------------------------------
// Off-site evidence
// ---------------------------------------------------------------------------

test('the offsite block carries the source, rating, count and the signed gap', () => {
  const block = assess({
    trust: { brand: 'Samsung', offsite: { source: 'example-reviews', rating: 4.1, count: 2211 } },
  });
  assert.deepEqual(block.offsite, {
    source: 'example-reviews',
    rating: 4.1,
    count: 2211,
    rating_gap: -0.3,
  });
});

test('rating_disagrees fires against the off-site rating', () => {
  const block = assess({ rating: 4.0, trust: { brand: 'Samsung', offsite: { source: 'example-reviews', rating: 5, count: 900 } } });
  assert.ok(has(block, 'rating_disagrees'));
  assert.equal(block.offsite.rating_gap, 1);
});

test('no off-site gap when the candidate has no rating to compare against', () => {
  const block = assess({ rating: undefined, trust: { brand: 'Samsung', offsite: { source: 'example-reviews', rating: 5, count: 900 } } });
  assert.equal(block.offsite.rating_gap, null);
  assert.ok(!has(block, 'rating_disagrees'));
});

test('an out-of-range off-site rating drops the whole offsite block', () => {
  const block = assess({ trust: { brand: 'Samsung', offsite: { source: 'example-reviews', rating: 7, count: 900 } } });
  assert.equal(block.offsite, null);
});

// ---------------------------------------------------------------------------
// Degradation — malformed input yields no output, never a throw
// ---------------------------------------------------------------------------

test('an absent trust input yields a null assessment', () => {
  assert.equal(assess({ trust: undefined }), null);
});

test('a non-object trust input yields a null assessment', () => {
  assert.equal(assess({ trust: [] }), null);
  assert.equal(assess({ trust: 'genuine' }), null);
});

test('verified_read greater than reviews_read drops the pair but returns the block', () => {
  const block = assess({ trust: { brand: 'Samsung', reviews_read: 3, verified_read: 5 } });
  assert.equal(block.facts.brand, 'Samsung');
  assert.equal(block.facts.reviews_read, null);
  assert.equal(block.facts.verified_read, null);
  assert.ok(has(block, 'review_sample_too_small'));
});

test('every block carries the caveat', () => {
  for (const block of [assess(), assess({ trust: {} }), primary(candidate({ source: 'flipkart', price: 80000 }))]) {
    assert.equal(block.caveat, CAVEAT);
  }
});

// ---------------------------------------------------------------------------
// Knobs and alignment
// ---------------------------------------------------------------------------

test('the exported knobs carry their plan-pinned defaults', () => {
  assert.deepEqual(BRAND_CONFIDENCES, ['high', 'medium', 'low', 'none']);
  assert.equal(SIGNALS.length, 8);
  assert.deepEqual(DISCREDITING_SIGNALS, ['brand_not_in_title', 'seller_third_party', 'price_undercut']);
  assert.equal(MIN_REVIEWS_READ, 4);
  assert.equal(UNVERIFIED_SHARE_MAX, 0.5);
  assert.equal(UNDERCUT_PCT, 30);
  assert.equal(RATING_GAP, 1.0);
  assert.match(CAVEAT, /evidence, not proof/);
});

test('analyzeAll is index-aligned and null where a candidate has no trust input', () => {
  const blocks = analyzeAll([candidate(), candidate({ trust: undefined }), candidate()]);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1], null);
  assert.notEqual(blocks[0], null);
  assert.notEqual(blocks[2], null);
  assert.deepEqual(analyzeAll('not an array'), []);
});

test('analyze takes a single candidate without a peer context', () => {
  assert.equal(analyze(candidate()).brand_confidence, 'high');
  assert.equal(analyze(candidate({ trust: undefined })), null);
});
