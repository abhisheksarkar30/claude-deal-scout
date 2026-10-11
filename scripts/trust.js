'use strict';

/**
 * The brand-authenticity and review-trust engine.
 *
 * The model extracts; this script judges (DS-3 §10). Given a candidate's `trust` input and the rest
 * of the candidate set, it labels the brand claim with one of four confidences, names the signals
 * behind that label, and records the evidence it actually read. Deterministic and offline — a
 * sibling of `history.js`, not an addition to `score.js`: shape and bound validation stays in
 * `score.js`, and the semantic rule lives here, so one rule has one home.
 *
 * The label is deliberately *evidence*, never "genuine": every fact it is computed from is written
 * by the listing, which a counterfeiter controls (§6 R1). The caveat says so on every block.
 *
 * Read §3.1 and §3.2 of the DS-3 plan before changing the ladder or the signal set. Both are pinned
 * by fixtures rather than observed, because a change in either changes the label the user acts on.
 */

const { MAX_NUMBER, MAX_STRING_LENGTH, sanitize } = require('./score');
const { sourceToBareId } = require('./policy');

// ---------------------------------------------------------------------------
// Exported knobs — tune against reality, never inline
// ---------------------------------------------------------------------------

/** The only four confidence values. Do not add a fifth. */
const BRAND_CONFIDENCES = ['high', 'medium', 'low', 'none'];

/** The closed signal set, in the order a block lists them. */
const SIGNALS = [
  'brand_not_in_title',
  'seller_third_party',
  'price_undercut',
  'rating_disagrees',
  'unverified_review_share',
  'review_sample_too_small',
  'no_brand_store',
  'no_peer_site',
];

/**
 * The subset that caps the ladder at `low`. The split is the contract: an informational signal must
 * never move the confidence, or "no brand store on Flipkart" would read as evidence of fraud.
 */
const DISCREDITING_SIGNALS = ['brand_not_in_title', 'seller_third_party', 'price_undercut'];

/** Fewer reviews read than this and no share signal fires either way; the sample itself is flagged. */
const MIN_REVIEWS_READ = 4;

/** A read sample more than this fraction unverified sets `unverified_review_share`. */
const UNVERIFIED_SHARE_MAX = 0.5;

/** A peer listing this much dearer than the candidate reads as a suspiciously cheap listing (%). */
const UNDERCUT_PCT = 30;

/** A peer's or an off-site rating this far from the listing's sets `rating_disagrees`. */
const RATING_GAP = 1.0;

const CAVEAT =
  'This is evidence, not proof — a listing can mimic every signal below, and absence of a signal is not proof of authenticity. Verify at the link.';

// ---------------------------------------------------------------------------
// Local narrowing — every field trust reads off the raw array is unvalidated
// ---------------------------------------------------------------------------

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function rounded1(value) {
  return Math.round(value * 10) / 10;
}

/** The one cap + sanitizer, defined in `score.js` and applied here to the output `facts`. */
function clean(value) {
  return sanitize(value).slice(0, MAX_STRING_LENGTH);
}

function usablePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_NUMBER ? value : null;
}

/**
 * A finite `0 … 5` rating, else null. This bound is trust's own: `score.js` bounds a candidate's
 * `rating` only to `MAX_NUMBER`, so a hostile out-of-range value must not skew `rating_disagrees`.
 */
function usableRating(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}

/** A non-negative integer, else null. Not capped at `MAX_REVIEWS_READ` — that is `score.js`'s bound. */
function usableCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** All-or-nothing: a partially-populated off-site result is a different source than the id claims. */
function validOffsite(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isNonEmptyString(raw.source)) return null;
  const rating = usableRating(raw.rating);
  if (rating === null) return null;
  const count = usableCount(raw.count);
  if (count === null) return null;
  return { source: clean(raw.source), rating, count };
}

/**
 * Validate one raw `trust` input — the engine-side sibling of `score.js`'s `validTrust`, exactly as
 * `history.js`'s non-exported `validate` is the engine-side sibling of `score.js`'s `validHistory`.
 *
 * Returns the narrowed sub-object, or `null` when `raw` is not an object. That `null` is the "not
 * attempted" side of §3.1's null-vs-`"none"` split: an object carrying no usable fact still returns
 * `{}` and reaches the ladder, which labels it `none` — read, and nothing justifying found.
 *
 * `verified_read <= reviews_read` is enforced here too, by **dropping the pair** and never
 * correcting it. `score.js`'s `validTrust` guards only the report-side copy while this engine reads
 * the agent's raw array, so both sides need the rule. A dropped pair is not a dropped block.
 */
function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const trust = {};

  if (isNonEmptyString(raw.brand)) trust.brand = clean(raw.brand);
  if (isNonEmptyString(raw.seller)) trust.seller = clean(raw.seller);
  if (typeof raw.brand_store === 'boolean') trust.brand_store = raw.brand_store;

  const reviewsRead = usableCount(raw.reviews_read);
  const verifiedRead = usableCount(raw.verified_read);
  if (reviewsRead !== null) trust.reviews_read = reviewsRead;
  if (verifiedRead !== null) trust.verified_read = verifiedRead;

  if (
    trust.reviews_read !== undefined &&
    trust.verified_read !== undefined &&
    trust.verified_read > trust.reviews_read
  ) {
    delete trust.reviews_read;
    delete trust.verified_read;
  }

  const offsite = validOffsite(raw.offsite);
  if (offsite) trust.offsite = offsite;

  return trust;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Case- and punctuation-insensitive, so `Sam-sung` still matches `sAMSUNG`. */
function normalizeForMatch(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The listing's own brand string is absent from its own title. Needs both sides to mean anything. */
function brandNotInTitle(brand, title) {
  if (!isNonEmptyString(brand) || !isNonEmptyString(title)) return false;
  return !normalizeForMatch(title).includes(normalizeForMatch(brand));
}

/**
 * `(other − base) / base`, or null when either side is unusable. A zero base has no ratio — a
 * nonsense price must not manufacture a **discrediting** signal, which is why this is null and not 0.
 */
function priceRatio(base, other) {
  if (base === null || other === null || base === 0) return null;
  return (other - base) / base;
}

function ratingGap(base, other) {
  if (base === null || other === null) return null;
  return other - base;
}

/**
 * The whole signal set for one candidate, in `SIGNALS` order.
 *
 * Peer-derived signals read the **whole** peer set, not just the surfaced one: `price_undercut`
 * fires when any peer clears `UNDERCUT_PCT`, and `rating_disagrees` when any peer or the off-site
 * source differs by `RATING_GAP`.
 */
function signalsFor({ title, brand, reviewsRead, verifiedRead, brandStore, thirdParty, price, rating, peers, offsite, grouped }) {
  const fired = new Set();

  // Discrediting.
  if (brandNotInTitle(brand, title)) fired.add('brand_not_in_title');
  if (thirdParty === true) fired.add('seller_third_party');
  const ratios = peers.map((peer) => priceRatio(price, usablePrice(peer.candidate.price)));
  if (ratios.some((ratio) => ratio !== null && ratio >= UNDERCUT_PCT / 100)) fired.add('price_undercut');

  // Informational — none of these may move the ladder.
  const gaps = peers.map((peer) => ratingGap(rating, usableRating(peer.candidate.rating)));
  if (offsite) gaps.push(ratingGap(rating, offsite.rating));
  if (gaps.some((gap) => gap !== null && Math.abs(gap) >= RATING_GAP)) fired.add('rating_disagrees');

  if (reviewsRead === null || reviewsRead < MIN_REVIEWS_READ) fired.add('review_sample_too_small');
  if (reviewsRead !== null && verifiedRead !== null && reviewsRead >= MIN_REVIEWS_READ) {
    if ((reviewsRead - verifiedRead) / reviewsRead > UNVERIFIED_SHARE_MAX) fired.add('unverified_review_share');
  }

  if (brandStore !== true) fired.add('no_brand_store');
  // "We looked and did not find it" — claimed only when the candidate actually took part in the
  // grouping. A `product_key`-less candidate, or one with no site to be on, never looked.
  if (grouped && peers.length === 0) fired.add('no_peer_site');

  return SIGNALS.filter((signal) => fired.has(signal));
}

/** Does the listing carry any brand evidence at all? A fired discrediting signal is not evidence. */
function hasEvidence({ brand, seller, brandStore, thirdParty }) {
  return brand !== null || seller !== null || brandStore === true || thirdParty !== undefined;
}

/**
 * The two supports, as plain-word labels. Deliberately fail-closed: `third_party_seller` is defined
 * as "true only if **clearly** not authorised" (`agents/deal-scout.md`), so its *absence* is
 * "couldn't tell" and never counts as support.
 */
function supportsFor({ seller, brandStore, thirdParty }) {
  const supports = [];
  if (brandStore === true) supports.push('a brand store');
  if (seller !== null && thirdParty === false) supports.push('a first-party seller');
  return supports;
}

// ---------------------------------------------------------------------------
// Cross-site corroboration
// ---------------------------------------------------------------------------

/**
 * Peer sets for a whole raw candidate array, aligned by index.
 *
 * Two candidates are peers when they share a non-empty `product_key` and sit on **different** sites
 * (bare adapter ids differ). Deliberately not `score.js`'s `product_groups`: that groups ">1 member,
 * for display" across all sources including two account lists on one site, while trust asks "is
 * there a peer on a *different* site".
 *
 * A candidate whose `source` is not a non-empty string is excluded from the grouping **entirely** —
 * neither matched against nor counted as a peer. `sourceToBareId(undefined)` returns the literal
 * `"undefined"`, which differs from every real bare id, so without this rule a `source`-less
 * candidate could look like a peer on a third site and manufacture a discrediting `price_undercut`
 * out of nothing.
 */
function peerSets(candidates) {
  const byKey = new Map();
  const grouped = [];

  candidates.forEach((candidate, index) => {
    const key = isNonEmptyString(candidate && candidate.product_key) ? candidate.product_key : null;
    const onASite = isNonEmptyString(candidate && candidate.source);
    const participates = key !== null && onASite;
    grouped.push(participates);
    if (!participates) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(index);
  });

  return candidates.map((candidate, index) => {
    if (!grouped[index]) return { peers: [], grouped: false };
    const own = sourceToBareId(candidate.source);
    const peers = byKey
      .get(candidate.product_key)
      .filter((i) => i !== index && sourceToBareId(candidates[i].source) !== own)
      .map((i) => ({ index: i, candidate: candidates[i] }));
    return { peers, grouped: true };
  });
}

/** The `betterThan` comparison from `score.js`: lexicographic `source`, then raw-array index. */
function firstBySourceThenIndex(peers) {
  return peers.reduce((best, peer) => {
    if (best === null) return peer;
    const a = String(peer.candidate.source ?? '');
    const b = String(best.candidate.source ?? '');
    if (a !== b) return a < b ? peer : best;
    return peer.index < best.index ? peer : best;
  }, null);
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * §3.2's fixed order — first match wins, and the order is the contract.
 *
 * Rung 0 must be checked before the counting rungs, or a listing with no usable evidence would match
 * rung 3's `otherwise` and fall to `low` instead of `none`. Rung 0 carries the same "no discrediting
 * signal" guard as rungs 1–2, so a fired discrediting signal is never labelled `none`.
 */
function confidenceFor({ noEvidence, supports, discreditingSignals }) {
  const discrediting = discreditingSignals.length > 0;

  if (noEvidence && !discrediting) return 'none';
  if (supports >= 2 && !discrediting) return 'high';
  if (supports === 1 && !discrediting) return 'medium';
  return 'low';
}

function describeConfidence({ confidence, supports, discreditingSignals }) {
  if (confidence === 'none') return 'no brand or seller evidence was read from the listing';
  if (confidence === 'high') {
    return `both supports were read (${supports.join(' and ')}) and no discrediting signal fired`;
  }
  if (confidence === 'medium') {
    return `one support was read (${supports[0]}) and no discrediting signal fired`;
  }
  if (discreditingSignals.length > 0) {
    return `evidence was read, but ${discreditingSignals.join(' and ')} fired — treat the brand claim with caution`;
  }
  return 'evidence was read, but nothing corroborates the brand claim';
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Analyze one candidate's trust evidence.
 *
 * @param {object} rawCandidate  the agent's raw candidate (every field unvalidated)
 * @param {object} [context]
 * @param {Array}  [context.peers]    raw peers on other sites, from `analyzeAll`
 * @param {boolean}[context.grouped]  whether this candidate took part in peer grouping
 * @returns {object|null} null when the candidate carries no usable `trust` input
 */
function analyze(rawCandidate, { peers = [], grouped = false } = {}) {
  const candidate = rawCandidate && typeof rawCandidate === 'object' && !Array.isArray(rawCandidate) ? rawCandidate : {};
  const trust = validate(candidate.trust);
  if (trust === null) return null;

  const facts = {
    brand: trust.brand ?? null,
    seller: trust.seller ?? null,
    brand_store: trust.brand_store ?? null,
    reviews_read: trust.reviews_read ?? null,
    verified_read: trust.verified_read ?? null,
  };

  const title = isNonEmptyString(candidate.title) ? candidate.title : null;
  const price = usablePrice(candidate.price);
  const rating = usableRating(candidate.rating);
  const thirdParty = typeof candidate.third_party_seller === 'boolean' ? candidate.third_party_seller : undefined;
  const offsite = trust.offsite ?? null;

  const signals = signalsFor({
    title,
    brand: facts.brand,
    reviewsRead: facts.reviews_read,
    verifiedRead: facts.verified_read,
    brandStore: facts.brand_store,
    thirdParty,
    price,
    rating,
    peers,
    offsite,
    grouped,
  });

  const supports = supportsFor({ seller: facts.seller, brandStore: facts.brand_store, thirdParty });
  const discreditingSignals = signals.filter((signal) => DISCREDITING_SIGNALS.includes(signal));
  const noEvidence = !hasEvidence({
    brand: facts.brand,
    seller: facts.seller,
    brandStore: facts.brand_store,
    thirdParty,
  });
  const brand_confidence = confidenceFor({ noEvidence, supports: supports.length, discreditingSignals });

  const surfaced = firstBySourceThenIndex(peers);
  const peer = surfaced && {
    source: clean(sourceToBareId(surfaced.candidate.source)),
    price_gap_pct: displayPct(priceRatio(price, usablePrice(surfaced.candidate.price))),
    rating_gap: displayGap(ratingGap(rating, usableRating(surfaced.candidate.rating))),
  };

  return {
    brand_confidence,
    signals,
    facts,
    peer: peer || null,
    offsite: offsite && {
      source: offsite.source,
      rating: offsite.rating,
      count: offsite.count,
      rating_gap: displayGap(ratingGap(rating, offsite.rating)),
    },
    reason: describeConfidence({ confidence: brand_confidence, supports, discreditingSignals }),
    caveat: CAVEAT,
  };
}

function displayPct(ratio) {
  return ratio === null ? null : rounded1(ratio * 100);
}

function displayGap(gap) {
  return gap === null ? null : rounded1(gap);
}

/** Analyze a whole raw `candidates` array. Aligned by index; `null` where a candidate has no input. */
function analyzeAll(candidates) {
  if (!Array.isArray(candidates)) return [];
  const sets = peerSets(candidates);
  return candidates.map((candidate, index) => analyze(candidate, sets[index]));
}

module.exports = {
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
};
