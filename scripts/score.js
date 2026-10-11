'use strict';

/**
 * The deterministic scorer and report validator.
 *
 * This script, not the model, decides the ranking (R1) — so the same answer comes out of the same
 * input every time. It is also the report-injection control (R4/R6): the agent's output is treated
 * as hostile data, every URL is re-checked against the site policy, and string fields are scrubbed.
 * Its strictness is a security property, not just hygiene.
 */

const { checkUrl } = require('./policy');

// ---------------------------------------------------------------------------
// Exported knobs — tune against reality, never inline
// ---------------------------------------------------------------------------

const W_PRICE = 0.4;
const W_RATING = 0.6;
const MIN_RATING = 3.5;
const PRIOR_MEAN = 4.0;
const PRIOR_N = 20;

/** A claimed MRP discount at or above this reads as inflated. */
const INFLATED_MRP_PCT = 60;

/** Fewer reviews than this and the rating is not yet trustworthy. */
const MIN_REVIEWS = 10;

/** Cap on a free-text field, and bound on any number, before anything is scored. */
const MAX_STRING_LENGTH = 300;
const MAX_NUMBER = 10000000;

/**
 * A `trust.reviews_read` / `trust.verified_read` count larger than this fails validation (§3.3).
 *
 * A validation bound, not a tunable: it lives here beside `MAX_NUMBER` rather than in `trust.js` so the
 * import direction stays one-way (`trust.js` requires `score.js`, never the reverse — a reverse import
 * would close a require cycle and load `trust.js` against a partial `score` export).
 */
const MAX_REVIEWS_READ = 50;

/**
 * The canonical candidate field allowlist. Anything else the agent emits is dropped.
 *
 * The design plan never enumerated this list (it said only "title, price, rating, etc."), so it is
 * defined here and br-DS-1-07 must emit exactly these fields and nothing else.
 *
 * `history`, `must_haves_met`, `must_haves_reason` and `third_party_seller` are agent-supplied
 * judgements this script cannot re-derive: the first three are validated as values, the last is a
 * page-level call about who is selling. `trust` is validated here too, as the *input* half of a
 * two-key contract — `trust.js` computes the `trust_assessment` half (§3.1).
 */
const CANDIDATE_FIELDS = {
  title: 'string',
  url: 'string',
  source: 'string',
  product_key: 'string',
  price: 'number',
  mrp: 'number',
  rating: 'number',
  review_count: 'number',
  third_party_seller: 'boolean',
  offers: 'array',
  history: 'object',
  trust: 'object',
  must_haves_met: 'boolean',
  must_haves_reason: 'string',
};

/** Free-text fields the PII sanitizer runs over. `url` is excluded — it is validated, not free text. */
const SANITIZED_FIELDS = ['title', 'source', 'product_key'];

const OFFER_KINDS = ['bank', 'coupon', 'exchange'];

const REDACTED = '[redacted]';

// ---------------------------------------------------------------------------
// PII sanitizer
// ---------------------------------------------------------------------------

const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+$/;
const EMAIL_ANYWHERE = /[^\s@]+@[^\s@]+/g;

/** `20260515` — an 8-digit compact date, which must survive the digit-run rules. */
function looksLikeCompactDate(run) {
  return run.length === 8 && /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(run);
}

function isEntirelyPii(value) {
  const trimmed = value.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;
  if (EMAIL_TOKEN.test(trimmed)) return true;
  if (/^\+?[\d\-()]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    return !looksLikeCompactDate(digits) && digits.length >= 7;
  }
  return false;
}

/**
 * Phone-shaped runs (7+ digits), order/account-number runs (10+ digits) and email tokens are
 * redacted in place; a value that is *entirely* one of those becomes `[redacted]`.
 *
 * Pattern matching is not exhaustive — the residual risk is documented in docs/SECURITY.md.
 */
function sanitize(value) {
  if (typeof value !== 'string') return value;
  if (isEntirelyPii(value)) return REDACTED;
  return value
    .replace(EMAIL_ANYWHERE, REDACTED)
    .replace(/\d{10,}/g, (run) => (looksLikeCompactDate(run) ? run : REDACTED))
    .replace(/\d{7,9}/g, (run) => (looksLikeCompactDate(run) ? run : REDACTED));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isBoundedNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_NUMBER;
}

function validOffers(offers) {
  if (!Array.isArray(offers)) return false;
  return offers.every(
    (offer) =>
      offer &&
      typeof offer === 'object' &&
      OFFER_KINDS.includes(offer.kind) &&
      isBoundedNumber(offer.amount) &&
      (offer.condition === undefined || typeof offer.condition === 'string'),
  );
}

function validHistory(history) {
  if (!history || typeof history !== 'object' || Array.isArray(history)) return false;
  const { current, lowest, highest, average, points } = history;
  if (!isBoundedNumber(current) || !isBoundedNumber(average)) return false;
  if (!lowest || !isBoundedNumber(lowest.price) || typeof lowest.date !== 'string') return false;
  if (!highest || !isBoundedNumber(highest.price) || typeof highest.date !== 'string') return false;
  if (points !== undefined && !Array.isArray(points)) return false;
  return true;
}

/**
 * The optional off-site half of a `trust` input: `{ source, rating, count }`, all three required.
 *
 * All-or-nothing, unlike the top-level `trust` fields: a partially-populated off-site result is not a
 * weaker evidence, it is a different source than the id claims (§3.3).
 */
function validOffsite(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.source !== 'string' || raw.source === '') return null;
  if (typeof raw.rating !== 'number' || !Number.isFinite(raw.rating) || raw.rating < 0 || raw.rating > 5) {
    return null;
  }
  if (!isBoundedNumber(raw.count)) return null;
  return {
    source: sanitize(raw.source).slice(0, MAX_STRING_LENGTH),
    rating: raw.rating,
    count: raw.count,
  };
}

/** The sub-keys a `trust` input may carry. Anything else it emits is dropped and named (§3.3). */
const TRUST_FIELDS = ['brand', 'seller', 'brand_store', 'reviews_read', 'verified_read', 'offsite'];

/**
 * Validate one `trust` input. Shape, type and bound checking only — the semantic rule (the confidence
 * ladder, the signals) lives in `trust.js`, so one rule has one home.
 *
 * Returns `{ trust, dropped }`, or `null` when `raw` is not a plain object. That `null` is the "not
 * attempted" side of §3.1's null-vs-`"none"` split, which `trust.js` mirrors: an object that survives
 * here but carries no usable fact still reaches the engine and yields `brand_confidence: "none"`.
 *
 * Unlike `validHistory`, which destructures its known keys and silently ignores any others, the names
 * of sub-keys that failed are reported so a bad agent emission shows up in the candidate's
 * `dropped_fields` instead of vanishing.
 *
 * `verified_read <= reviews_read` is enforced by **dropping the pair, never correcting it** — the same
 * uniform "malformed input → no output" outcome `history` has. A dropped pair is not a dropped block:
 * the rest of `trust`, and the candidate itself, survive.
 */
function validTrust(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const trust = {};
  const dropped = [];

  for (const field of ['brand', 'seller']) {
    if (!(field in raw)) continue;
    if (typeof raw[field] !== 'string') dropped.push(field);
    else trust[field] = sanitize(raw[field]).slice(0, MAX_STRING_LENGTH);
  }

  if ('brand_store' in raw) {
    if (typeof raw.brand_store === 'boolean') trust.brand_store = raw.brand_store;
    else dropped.push('brand_store');
  }

  for (const field of ['reviews_read', 'verified_read']) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (!Number.isInteger(value) || value < 0 || value > MAX_REVIEWS_READ) dropped.push(field);
    else trust[field] = value;
  }

  if (
    trust.reviews_read !== undefined &&
    trust.verified_read !== undefined &&
    trust.verified_read > trust.reviews_read
  ) {
    delete trust.reviews_read;
    delete trust.verified_read;
    dropped.push('reviews_read', 'verified_read');
  }

  if ('offsite' in raw) {
    const offsite = validOffsite(raw.offsite);
    if (offsite) trust.offsite = offsite;
    else dropped.push('offsite');
  }

  for (const key of Object.keys(raw)) {
    if (!TRUST_FIELDS.includes(key)) dropped.push(key);
  }

  return { trust, dropped };
}

/**
 * Validate one raw candidate: drop unknown fields, cap strings, bound numbers, re-check the URL,
 * scrub PII, and enforce the `must_haves_reason` "present only when false" invariant.
 *
 * Returns null if the candidate is unusable at all (no usable price). A candidate whose `url`
 * fails `checkUrl` is kept — its data came from an allowlisted page — but the link is dropped, so
 * the report can never carry a phishing link.
 */
function validateCandidate(raw, adapters) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isBoundedNumber(raw.price)) return null;

  const candidate = {};
  const dropped = [];

  for (const [field, type] of Object.entries(CANDIDATE_FIELDS)) {
    if (!(field in raw)) continue;
    const value = raw[field];

    if (type === 'string') {
      if (typeof value !== 'string') {
        dropped.push(field);
        continue;
      }
      candidate[field] = (SANITIZED_FIELDS.includes(field) ? sanitize(value) : value).slice(0, MAX_STRING_LENGTH);
    } else if (type === 'number') {
      if (!isBoundedNumber(value)) {
        if (field === 'price') return null;
        dropped.push(field);
        continue;
      }
      candidate[field] = value;
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') {
        dropped.push(field);
        continue;
      }
      candidate[field] = value;
    } else if (field === 'offers') {
      const offersOk = validOffers(value);
      candidate.offers = offersOk ? value.map((o) => ({ ...o })) : [];
      if (!offersOk) dropped.push(field);
    } else if (field === 'history') {
      if (validHistory(value)) candidate.history = value;
      else dropped.push(field);
    } else if (field === 'trust') {
      const validated = validTrust(value);
      if (validated) {
        candidate.trust = validated.trust;
        dropped.push(...validated.dropped);
      } else {
        dropped.push(field);
      }
    }
  }

  if (typeof candidate.url === 'string') {
    if (!checkUrl(candidate.url, adapters).ok) {
      candidate.url = null;
      dropped.push('url');
    }
  }

  // "present only when false": the agent must not send a reason alongside a pass. Enforce it here
  // rather than trusting the contract.
  if (candidate.must_haves_met === true && 'must_haves_reason' in candidate) {
    delete candidate.must_haves_reason;
    dropped.push('must_haves_reason');
  }

  candidate._dropped = dropped;
  return candidate;
}

/** The one must-haves gate, shared by `best_product` and `best_deal`. Fail-closed on an absent field. */
function passesMustHaves(candidate) {
  return candidate.must_haves_met === true;
}

// ---------------------------------------------------------------------------
// Pricing, rating, flags
// ---------------------------------------------------------------------------

/**
 * Best offer per kind (offers are non-stackable within a kind), summed across kinds.
 * A conditional offer applies only when the user holds that condition.
 *
 * `offer_implausible` is set when the combined discount — or any single kind's discount alone —
 * exceeds the listed price; the discount is then capped at the price so ranking stays sane.
 */
function applyOffers(price, offers, eligibleConditions) {
  const eligible = new Set(eligibleConditions);
  const best = new Map();

  for (const offer of offers || []) {
    if (offer.condition !== undefined && !eligible.has(offer.condition)) continue;
    const current = best.get(offer.kind) || 0;
    if (offer.amount > current) best.set(offer.kind, offer.amount);
  }

  const perKind = [...best.values()];
  const combined = perKind.reduce((sum, amount) => sum + amount, 0);
  const implausible = combined > price || perKind.some((amount) => amount > price);
  const discount = Math.min(combined, price);

  return { effectivePrice: Math.max(0, price - discount), implausible };
}

/** Bayesian shrinkage: a thin review count is pulled toward the prior mean. */
function adjustedRating(candidate) {
  const n = typeof candidate.review_count === 'number' ? candidate.review_count : 0;
  const rating = typeof candidate.rating === 'number' ? candidate.rating : PRIOR_MEAN;
  return (rating * n + PRIOR_MEAN * PRIOR_N) / (n + PRIOR_N);
}

function flagsFor({ candidate, effectivePrice, ratingAdj, budget, offerImplausible }) {
  const flags = [];

  if (isBoundedNumber(candidate.mrp) && candidate.mrp > 0) {
    const claimed = (1 - candidate.price / candidate.mrp) * 100;
    if (claimed >= INFLATED_MRP_PCT) flags.push('inflated_mrp');
  }
  if ((candidate.review_count || 0) < MIN_REVIEWS) flags.push('low_reviews');
  if (budget !== null && effectivePrice > budget) flags.push('over_budget');
  if (candidate.third_party_seller === true) flags.push('third_party_seller');
  if (ratingAdj < MIN_RATING) flags.push('below_min_rating');
  if (offerImplausible) flags.push('offer_implausible');

  return flags;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function normalise(value, min, max, floor) {
  return (value - min) / Math.max(max - min, floor);
}

function priceScore(effectivePrice, min, max) {
  return 1 - normalise(effectivePrice, min, max, 1);
}

function ratingScore(ratingAdj, min, max) {
  return normalise(ratingAdj, min, max, 0.001);
}

/** Ties: lexicographic `source` ascending, then original array index. */
function betterThan(a, b) {
  const sourceA = String(a.source ?? '');
  const sourceB = String(b.source ?? '');
  if (sourceA !== sourceB) return sourceA < sourceB ? -1 : 1;
  return a.index - b.index;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Score and validate a report.
 *
 * @param {object} input      `{ requirement, candidates }` — the agent's output as data
 * @param {Array}  adapters   loaded site adapters (see `policy.loadSites`)
 */
function score(input, adapters) {
  const requirement = (input && input.requirement) || {};
  const rawCandidates = Array.isArray(input && input.candidates) ? input.candidates : [];

  const budget = isBoundedNumber(requirement.budget) ? requirement.budget : null;
  const eligibleConditions = Array.isArray(requirement.eligible_conditions)
    ? requirement.eligible_conditions.filter((c) => typeof c === 'string')
    : [];

  const valid = [];
  for (const [index, raw] of rawCandidates.entries()) {
    const validated = validateCandidate(raw, adapters);
    if (!validated) continue;

    const { effectivePrice, implausible } = applyOffers(validated.price, validated.offers, eligibleConditions);
    // The `over_budget` flag reads this same rounded value — the one the report exposes and the
    // `best_deal` budget gate compares against — so a price within a rounding step of the budget
    // cannot be flagged over budget yet still qualify as the best deal.
    const effective_price = Math.round(effectivePrice * 100) / 100;
    const ratingAdj = adjustedRating(validated);
    const dropped = validated._dropped;
    delete validated._dropped;

    valid.push({
      ...validated,
      index,
      effective_price,
      rating_adj: Math.round(ratingAdj * 1000) / 1000,
      flags: flagsFor({ candidate: validated, effectivePrice: effective_price, ratingAdj, budget, offerImplausible: implausible }),
      dropped_fields: dropped,
    });
  }

  const gatePassing = valid.filter(passesMustHaves);

  let bestProduct = null;
  if (gatePassing.length > 0) {
    const prices = gatePassing.map((c) => c.effective_price);
    const ratings = gatePassing.map((c) => c.rating_adj);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const ratingMin = Math.min(...ratings);
    const ratingMax = Math.max(...ratings);

    const scored = gatePassing.map((c) => ({
      ...c,
      score:
        Math.round(
          (W_PRICE * priceScore(c.effective_price, priceMin, priceMax) +
            W_RATING * ratingScore(c.rating_adj, ratingMin, ratingMax)) *
            1000,
        ) / 1000,
    }));

    scored.sort((a, b) => (b.score - a.score) || betterThan(a, b));
    bestProduct = scored[0];

    for (const candidate of valid) {
      const match = scored.find((s) => s.index === candidate.index);
      candidate.score = match ? match.score : null;
    }
  } else {
    for (const candidate of valid) candidate.score = null;
  }

  const dealEligible = valid
    .filter((c) => passesMustHaves(c) && c.rating_adj >= MIN_RATING && (budget === null || c.effective_price <= budget))
    .sort((a, b) => (a.effective_price - b.effective_price) || betterThan(a, b));

  const bestDeal = dealEligible.length > 0 ? dealEligible[0] : null;

  const groups = new Map();
  for (const candidate of valid) {
    if (typeof candidate.product_key !== 'string' || candidate.product_key === '') continue;
    if (!groups.has(candidate.product_key)) groups.set(candidate.product_key, []);
    groups.get(candidate.product_key).push(candidate.index);
  }

  const cleaned = valid;

  return {
    candidates: cleaned,
    best_product: strip(bestProduct),
    best_deal: strip(bestDeal),
    best_deal_message: bestDeal === null ? 'no qualifying deal found' : null,
    product_groups: [...groups.entries()]
      .filter(([, indices]) => indices.length > 1)
      .map(([product_key, indices]) => ({ product_key, candidates: indices })),
    requirement: { budget, eligible_conditions: eligibleConditions },
  };
}

function strip(candidate) {
  return candidate || null;
}

module.exports = {
  W_PRICE,
  W_RATING,
  MIN_RATING,
  PRIOR_MEAN,
  PRIOR_N,
  INFLATED_MRP_PCT,
  MIN_REVIEWS,
  MAX_STRING_LENGTH,
  MAX_NUMBER,
  CANDIDATE_FIELDS,
  OFFER_KINDS,
  REDACTED,
  score,
  sanitize,
  applyOffers,
  adjustedRating,
  passesMustHaves,
  validateCandidate,
};
