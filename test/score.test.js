'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadSites } = require('../scripts/policy');
const {
  score,
  sanitize,
  applyOffers,
  adjustedRating,
  MIN_RATING,
  W_PRICE,
  W_RATING,
  PRIOR_MEAN,
  PRIOR_N,
  MAX_STRING_LENGTH,
  REDACTED,
} = require('../scripts/score');

const ADAPTERS = loadSites(path.join(__dirname, '..', 'sites'));

const AMAZON_URL = 'https://www.amazon.in/dp/B0XXXXXXXX';
const FLIPKART_URL = 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm1234abcd';

function candidate(over = {}) {
  return {
    title: 'Test Phone 128 GB',
    url: AMAZON_URL,
    source: 'amazon-in',
    product_key: 'testphone128',
    price: 20000,
    rating: 4.5,
    review_count: 100,
    must_haves_met: true,
    ...over,
  };
}

const report = (candidates, requirement = {}) => score({ requirement, candidates }, ADAPTERS);
const found = (rep, source) => rep.candidates.find((c) => c.source === source);

// ---------------------------------------------------------------------------
// Ranking — expected values derived from the §3.5 formula, not observed
// ---------------------------------------------------------------------------

test('best_product ranks by W_PRICE x price_score + W_RATING x rating_score', () => {
  const rep = report([
    candidate({ source: 'amazon-in', url: AMAZON_URL, price: 10000, rating: 4.0, review_count: 100 }),
    candidate({ source: 'flipkart', url: FLIPKART_URL, price: 20000, rating: 5.0, review_count: 100 }),
  ]);

  // rating_adj: (4.0*100 + 4.0*20)/120 = 4.0 ; (5.0*100 + 4.0*20)/120 = 4.833
  // price_score: 1 and 0 ; rating_score: 0 and 1
  assert.equal(found(rep, 'amazon-in').score, W_PRICE * 1 + W_RATING * 0);
  assert.equal(found(rep, 'flipkart').score, W_PRICE * 0 + W_RATING * 1);
  assert.equal(rep.best_product.source, 'flipkart');
});

test('candidates tied on price are ranked by rating', () => {
  const rep = report([
    candidate({ source: 'amazon-in', url: AMAZON_URL, price: 15000, rating: 4.0, review_count: 100 }),
    candidate({ source: 'flipkart', url: FLIPKART_URL, price: 15000, rating: 4.8, review_count: 100 }),
  ]);
  assert.equal(rep.best_product.source, 'flipkart');
});

test('candidates tied on rating are ranked by price', () => {
  const rep = report([
    candidate({ source: 'amazon-in', url: AMAZON_URL, price: 15000, rating: 4.5, review_count: 100 }),
    candidate({ source: 'flipkart', url: FLIPKART_URL, price: 12000, rating: 4.5, review_count: 100 }),
  ]);
  assert.equal(rep.best_product.source, 'flipkart');
});

test('identical weighted scores break by lexicographic source, then array index', () => {
  const rep = report([
    candidate({ source: 'flipkart', url: FLIPKART_URL }),
    candidate({ source: 'amazon-in', url: AMAZON_URL }),
  ]);
  assert.equal(rep.best_product.source, 'amazon-in');
  assert.equal(rep.best_deal.source, 'amazon-in');
});

// ---------------------------------------------------------------------------
// Offers and effective_price
// ---------------------------------------------------------------------------

test('a conditional offer applies only when the user lists the condition', () => {
  const offer = { kind: 'bank', amount: 2000, condition: 'ICICI' };
  const plain = report([candidate({ offers: [offer] })]);
  assert.equal(found(plain, 'amazon-in').effective_price, 20000);
  assert.ok(!found(plain, 'amazon-in').flags.includes('offer_implausible'));

  const eligible = report([candidate({ offers: [offer] })], { eligible_conditions: ['ICICI'] });
  assert.equal(found(eligible, 'amazon-in').effective_price, 18000);
});

test('offers are non-stackable within a kind: the best one wins', () => {
  const rep = report([candidate({ offers: [{ kind: 'bank', amount: 1000 }, { kind: 'bank', amount: 3000 }] })]);
  assert.equal(found(rep, 'amazon-in').effective_price, 17000);
});

test('a single kind exceeding the price sets offer_implausible and floors effective_price', () => {
  const rep = report([candidate({ price: 10000, offers: [{ kind: 'exchange', amount: 15000 }] })]);
  const only = found(rep, 'amazon-in');
  assert.equal(only.effective_price, 0);
  assert.ok(only.flags.includes('offer_implausible'));
});

test('per-kind offers each below the price but jointly above it also set offer_implausible', () => {
  const rep = report([
    candidate({
      price: 10000,
      offers: [
        { kind: 'bank', amount: 4000 },
        { kind: 'coupon', amount: 4000 },
        { kind: 'exchange', amount: 4000 },
      ],
    }),
  ]);
  const only = found(rep, 'amazon-in');
  assert.equal(only.effective_price, 0);
  assert.ok(only.flags.includes('offer_implausible'));
});

test('applyOffers is the single source of the implausibility rule', () => {
  assert.deepEqual(applyOffers(1000, [], []), { effectivePrice: 1000, implausible: false });
  assert.deepEqual(applyOffers(1000, [{ kind: 'bank', amount: 1000 }], []), { effectivePrice: 0, implausible: false });
  assert.deepEqual(applyOffers(1000, [{ kind: 'bank', amount: 1001 }], []), { effectivePrice: 0, implausible: true });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('an off-allowlist url is dropped but the candidate is kept', () => {
  const rep = report([candidate({ url: 'https://evil.example.com/dp/B0XXXXXXXX' })]);
  assert.equal(rep.candidates.length, 1);
  assert.equal(found(rep, 'amazon-in').url, null);
  assert.ok(found(rep, 'amazon-in').dropped_fields.includes('url'));
});

test('unknown top-level fields are dropped', () => {
  const rep = report([candidate({ evil: 'x', __proto__polluted: true })]);
  assert.ok(!('evil' in found(rep, 'amazon-in')));
  assert.ok(!('__proto__polluted' in found(rep, 'amazon-in')));
});

test('string fields are length-capped', () => {
  const rep = report([candidate({ title: 'x'.repeat(500) })]);
  assert.equal(found(rep, 'amazon-in').title.length, 300);
});

test('a non-finite or negative price drops the whole candidate', () => {
  for (const price of [Number.NaN, -1, Number.POSITIVE_INFINITY, 'free', undefined]) {
    assert.equal(report([candidate({ price })]).candidates.length, 0, `price ${String(price)}`);
  }
});

test('non-numeric rating and review_count are dropped, not guessed', () => {
  const rep = report([candidate({ rating: 'great', review_count: Number.NaN })]);
  const only = found(rep, 'amazon-in');
  assert.ok(!('rating' in only));
  assert.ok(!('review_count' in only));
  // Falls back to the prior mean, and is flagged for having no review evidence.
  assert.equal(only.rating_adj, PRIOR_MEAN);
  assert.ok(only.flags.includes('low_reviews'));
});

test('the must-haves gate is fail-closed on an absent field', () => {
  const bare = candidate();
  delete bare.must_haves_met;
  const rep = report([bare, candidate({ source: 'flipkart', url: FLIPKART_URL })]);
  assert.equal(rep.best_product.source, 'flipkart');
  assert.equal(rep.best_deal.source, 'flipkart');
});

// ---------------------------------------------------------------------------
// Rating floor
// ---------------------------------------------------------------------------

test('rating_adj exactly at MIN_RATING passes best_deal and is not flagged', () => {
  // rating 3.4 with 100 reviews shrinks to exactly (3.4*100 + 4.0*20)/120 = 3.5
  const rep = report([candidate({ rating: 3.4, review_count: 100 })]);
  const only = found(rep, 'amazon-in');
  assert.equal(only.rating_adj, MIN_RATING);
  assert.ok(!only.flags.includes('below_min_rating'));
  assert.equal(rep.best_deal.source, 'amazon-in');
});

test('rating_adj just below MIN_RATING is flagged and excluded from best_deal only', () => {
  const cheap = candidate({ rating: 3.3, review_count: 100, price: 10000 });
  const rep = report([cheap, candidate({ source: 'flipkart', url: FLIPKART_URL, rating: 4.8, price: 20000 })]);
  const flagged = found(rep, 'amazon-in');

  assert.ok(flagged.rating_adj < MIN_RATING);
  assert.ok(flagged.flags.includes('below_min_rating'));
  // Excluded from best_deal purely on the rating floor — budget and must-haves both pass.
  assert.equal(rep.best_deal.source, 'flipkart');
  // ...but still scored for best_product, which does not require the rating floor.
  assert.notEqual(flagged.score, null);
});

// ---------------------------------------------------------------------------
// best_deal
// ---------------------------------------------------------------------------

test('best_deal is null with an explicit message when nothing qualifies', () => {
  const rep = report([candidate({ must_haves_met: false }), candidate({ source: 'flipkart', url: FLIPKART_URL, must_haves_met: false })]);
  assert.equal(rep.best_deal, null);
  assert.equal(rep.best_product, null);
  assert.equal(rep.best_deal_message, 'no qualifying deal found');
  assert.equal(rep.candidates.length, 2);
});

test('a must_haves_met: false candidate is excluded from both picks but stays in the table', () => {
  const excluded = candidate({ source: 'flipkart', url: FLIPKART_URL, price: 1, rating: 5, must_haves_met: false, must_haves_reason: 'brand: FooBrand' });
  const rep = report([excluded, candidate({ price: 20000, rating: 4.5 })]);
  const shown = found(rep, 'flipkart');

  assert.equal(rep.best_deal.source, 'amazon-in');
  assert.equal(rep.best_product.source, 'amazon-in');
  assert.equal(rep.candidates.length, 2);
  assert.equal(shown.must_haves_met, false);
  assert.equal(shown.must_haves_reason, 'brand: FooBrand');
  assert.equal(shown.score, null);
});

test('best_deal respects the budget', () => {
  const rep = report(
    [candidate({ price: 10000 }), candidate({ source: 'flipkart', url: FLIPKART_URL, price: 8000 })],
    { budget: 9000 },
  );
  assert.equal(rep.best_deal.source, 'flipkart');
  assert.ok(found(rep, 'amazon-in').flags.includes('over_budget'));
});

test('over_budget falls on the rounded effective_price, so it agrees with the best_deal budget gate', () => {
  // 100.004 rounds to an effective_price of exactly 100. With budget 100 the candidate is within
  // budget for best_deal, so the flag must not disagree (it previously read the unrounded value).
  const rep = report([candidate({ price: 100.004 })], { budget: 100 });
  const only = found(rep, 'amazon-in');
  assert.equal(only.effective_price, 100);
  assert.ok(!only.flags.includes('over_budget'));
  assert.equal(rep.best_deal.source, 'amazon-in');
});

// ---------------------------------------------------------------------------
// must_haves_reason invariant
// ---------------------------------------------------------------------------

test('a spurious must_haves_reason is stripped when must_haves_met is true', () => {
  const rep = report([candidate({ must_haves_met: true, must_haves_reason: 'failed: 5G' })]);
  const only = found(rep, 'amazon-in');
  assert.ok(!('must_haves_reason' in only));
  assert.ok(only.dropped_fields.includes('must_haves_reason'));
});

test('must_haves_met and must_haves_reason survive validation intact', () => {
  const rep = report([candidate({ evil: 'x', must_haves_met: false, must_haves_reason: 'failed: 5G' })]);
  const only = found(rep, 'amazon-in');
  assert.equal(only.must_haves_met, false);
  assert.equal(only.must_haves_reason, 'failed: 5G');
  assert.ok(!('evil' in only));
});

// ---------------------------------------------------------------------------
// history passthrough
// ---------------------------------------------------------------------------

test('a history sub-object survives validation unchanged', () => {
  const history = {
    current: 1200,
    lowest: { price: 1000, date: '20241215' },
    highest: { price: 2200, date: '20240615' },
    average: 1800,
  };
  const rep = report([candidate({ history })]);
  assert.deepEqual(found(rep, 'amazon-in').history, history);
});

test('a malformed history is dropped without losing the candidate', () => {
  const rep = report([candidate({ history: { current: 'cheap' } })]);
  const only = found(rep, 'amazon-in');
  assert.ok(!('history' in only));
  assert.ok(only.dropped_fields.includes('history'));
});

// ---------------------------------------------------------------------------
// PII sanitizer
// ---------------------------------------------------------------------------

test('the sanitizer redacts phone runs, order numbers and emails in place', () => {
  assert.equal(sanitize('Call 9876543210 now'), `Call ${REDACTED} now`);
  assert.equal(sanitize('Order 1234567890123'), `Order ${REDACTED}`);
  assert.equal(sanitize('mail foo@bar.com today'), `mail ${REDACTED} today`);
});

test('the sanitizer replaces a value that is entirely PII', () => {
  assert.equal(sanitize('9876543210'), REDACTED);
  assert.equal(sanitize('foo@bar.com'), REDACTED);
  assert.equal(sanitize('+91 98765 43210'.replace(/\s/g, '')), REDACTED);
});

test('an 8-digit compact date survives the digit-run rules', () => {
  assert.equal(sanitize('20260515'), '20260515');
  assert.equal(sanitize('released 20260515 in India'), 'released 20260515 in India');
  // ...but a run that only looks like a date does not.
  assert.equal(sanitize('20261315'), REDACTED);
});

test('the sanitizer runs over free-text candidate fields', () => {
  const rep = report([candidate({ title: 'Seller: call 9876543210' })]);
  assert.equal(found(rep, 'amazon-in').title, `Seller: call ${REDACTED}`);
});

// ---------------------------------------------------------------------------
// product_key grouping
// ---------------------------------------------------------------------------

test('candidates sharing a product_key are grouped', () => {
  const rep = report([
    candidate({ source: 'amazon-in', url: AMAZON_URL, product_key: 'iphone15-128' }),
    candidate({ source: 'flipkart', url: FLIPKART_URL, product_key: 'iphone15-128' }),
    candidate({ source: 'amazon-in', url: AMAZON_URL, product_key: 'solo' }),
  ]);
  assert.deepEqual(rep.product_groups, [{ product_key: 'iphone15-128', candidates: [0, 1] }]);
});

// ---------------------------------------------------------------------------
// trust input (§3.3)
// ---------------------------------------------------------------------------

test('a trust sub-object passes validation intact', () => {
  const trust = {
    brand: 'Samsung',
    brand_store: true,
    seller: 'Appario Retail Private Ltd',
    reviews_read: 6,
    verified_read: 5,
    offsite: { source: 'example-reviews', rating: 4.1, count: 2211 },
  };
  const rep = report([candidate({ trust })]);
  assert.deepEqual(found(rep, 'amazon-in').trust, trust);
});

test('an over-long trust.brand is capped at MAX_STRING_LENGTH', () => {
  const rep = report([candidate({ trust: { brand: 'x'.repeat(400) } })]);
  assert.equal(found(rep, 'amazon-in').trust.brand.length, MAX_STRING_LENGTH);
});

test('a PII-shaped trust.seller is redacted', () => {
  const rep = report([candidate({ trust: { seller: 'call 9876543210' } })]);
  assert.equal(found(rep, 'amazon-in').trust.seller, `call ${REDACTED}`);
});

test('trust.offsite.source is redacted when PII-shaped and capped when over-long', () => {
  const rep = report([candidate({ trust: { offsite: { source: '9876543210', rating: 4, count: 10 } } })]);
  assert.equal(found(rep, 'amazon-in').trust.offsite.source, REDACTED);

  const long = report([candidate({ trust: { offsite: { source: 'y'.repeat(400), rating: 4, count: 10 } } })]);
  assert.equal(found(long, 'amazon-in').trust.offsite.source.length, MAX_STRING_LENGTH);
});

test('a verified_read greater than reviews_read drops the pair but keeps the candidate', () => {
  const rep = report([candidate({ trust: { brand: 'Samsung', reviews_read: 3, verified_read: 5 } })]);
  const result = found(rep, 'amazon-in');

  assert.equal(result.trust.brand, 'Samsung');
  assert.ok(!('reviews_read' in result.trust));
  assert.ok(!('verified_read' in result.trust));
  assert.ok(result.dropped_fields.includes('reviews_read'));
  assert.ok(result.dropped_fields.includes('verified_read'));
});

test('a non-numeric reviews_read drops only that field, without dropping the lone verified_read', () => {
  const rep = report([candidate({ trust: { brand: 'Samsung', reviews_read: '6', verified_read: 5 } })]);
  const trust = found(rep, 'amazon-in').trust;

  assert.equal(trust.brand, 'Samsung');
  assert.equal(trust.verified_read, 5);
  assert.ok(!('reviews_read' in trust));
});

test('an unknown key inside trust is dropped and named in dropped_fields', () => {
  const rep = report([candidate({ trust: { brand: 'Samsung', verdict: 'genuine' } })]);
  const result = found(rep, 'amazon-in');

  assert.deepEqual(result.trust, { brand: 'Samsung' });
  assert.ok(result.dropped_fields.includes('verdict'));
});

test('a trust value that is not an object drops the whole field', () => {
  const rep = report([candidate({ trust: 'genuine' })]);
  const result = found(rep, 'amazon-in');

  assert.ok(!('trust' in result));
  assert.ok(result.dropped_fields.includes('trust'));
  // ...and the candidate itself survives, exactly as a bad `history` does.
  assert.equal(result.price, 20000);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('the exported knobs carry their plan-pinned defaults', () => {
  assert.equal(W_PRICE, 0.4);
  assert.equal(W_RATING, 0.6);
  assert.equal(MIN_RATING, 3.5);
  assert.equal(PRIOR_MEAN, 4.0);
  assert.equal(PRIOR_N, 20);
  assert.equal(adjustedRating({ rating: 4.5, review_count: 100 }), (4.5 * 100 + PRIOR_MEAN * PRIOR_N) / 120);
});

test('score.js does not define MIN_POINTS — history.js owns it', () => {
  // eslint-disable-next-line global-require
  const scoreModule = require('../scripts/score');
  assert.ok(!('MIN_POINTS' in scoreModule));
});
