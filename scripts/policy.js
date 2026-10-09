'use strict';

/**
 * Read-only policy for claude-deal-scout: which Claude in Chrome tools the research subagent may
 * call, and which URLs it may visit.
 *
 * Pure functions and no I/O beyond reading `sites/*.json`. Both `guard.js` (the hook that enforces
 * this) and `score.js` (which re-checks every URL in the agent's report) call in here, so a mistake
 * in this file is a mistake in every layer.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Tool names the agent may call. Anything else the hook matches is denied (default-deny). */
const ALLOWED_TOOLS = [
  'tabs_context_mcp',
  'tabs_create_mcp',
  'tabs_close_mcp',
  'navigate',
  'read_page',
  'get_page_text',
  'find',
];

/** Server prefixes Claude in Chrome may expose those tools under. */
const MCP_PREFIXES = ['mcp__claude-in-chrome__', 'mcp__Claude_Browser__'];

/**
 * Path vocabulary marking an account- or mutation-bearing URL. `deny` entries in an adapter are
 * drawn from this list; the same list drives the adversarial suite `loadSites` tests history
 * adapters against.
 */
const DENY_VOCABULARY = ['add', 'buy', 'checkout', 'signin', '/ap/', '/gp/css/', 'payment', 'address', 'order'];

/**
 * One genuinely mutating path per `DENY_VOCABULARY` entry (the plan's `/add`, `/ap/signin` and
 * `/gp/css/order` are a subset of this). A `history` adapter whose `allow` regexes match any of
 * these is rejected at load — tested behaviourally against these paths, never by inspecting the
 * regex source, so an innocent pattern is not rejected for merely containing a vocabulary word.
 */
const ADVERSARIAL_PATHS = [
  '/add',
  '/buy/confirm',
  '/checkout',
  '/signin',
  '/ap/signin',
  '/gp/css/order',
  '/payment/result',
  '/address/select',
  '/order/details',
];

const MAX_URL_LENGTH = 2048;

/** Whitespace, ASCII control characters, or a backslash — none may appear in a raw URL. */
const FORBIDDEN_IN_URL = /[\s\u0000-\u001f\u007f\\]/;

function deny(reason) {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Tool policy
// ---------------------------------------------------------------------------

/**
 * Is `tool` in the read-only allow set? Accepts either the bare name (`navigate`) or an
 * MCP-prefixed one (`mcp__claude-in-chrome__navigate`).
 */
function checkTool(tool) {
  if (typeof tool !== 'string' || tool === '') return deny('tool call carries no tool name');

  let bare = tool;
  for (const prefix of MCP_PREFIXES) {
    if (tool.startsWith(prefix)) {
      bare = tool.slice(prefix.length);
      break;
    }
  }
  if (bare === tool && tool.includes('__')) {
    return deny(`"${tool}" is not a Claude in Chrome MCP tool`);
  }
  if (!ALLOWED_TOOLS.includes(bare)) {
    return deny(`tool "${bare}" is not in the read-only allow set`);
  }
  return { ok: true, tool: bare };
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

function normalizeHost(host) {
  return String(host).toLowerCase().replace(/\.$/, '');
}

/**
 * Compile one `deny` token. Tokens are matched against the pathname at a word boundary
 * (`(?![A-Za-z0-9_-])`) so that `add` denies `/gp/cart/add.html` but not `/product/address-guide`.
 * Tokens that end in `/` (e.g. `/ap/`) carry their own boundary and are matched verbatim.
 */
function denyPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped + (token.endsWith('/') ? '' : '(?![A-Za-z0-9_-])'));
}

const DENY_PATTERNS = new Map(DENY_VOCABULARY.map((t) => [t, denyPattern(t)]));

function adapterAllowsPath(adapter, pathname) {
  const allowed = adapter.allow.some((src) => new RegExp(src).test(pathname));
  if (!allowed) return false;
  return !adapter.deny.some((token) => (DENY_PATTERNS.get(token) || denyPattern(token)).test(pathname));
}

/**
 * Check one URL against the loaded adapters. Returns `{ ok: true, adapter, host, pathname }` or
 * `{ ok: false, reason }` — never throws, so callers can turn a denial into a block reason.
 *
 * The host must match an adapter host *exactly* (lowercased). Suffix or substring matching is
 * never used, which is what defeats `amazon.in.evil.com`, `evilamazon.in`, `amazon.in@evil.com`,
 * Cyrillic look-alikes (which normalise to `xn--…`) and IP literals alike.
 */
function checkUrl(raw, adapters) {
  if (typeof raw !== 'string') return deny('url is not a string');
  if (raw.length > MAX_URL_LENGTH) return deny(`url is longer than ${MAX_URL_LENGTH} characters`);
  if (FORBIDDEN_IN_URL.test(raw)) {
    return deny('url contains whitespace, a control character or a backslash');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return deny('url does not parse as an absolute URL');
  }

  if (parsed.protocol !== 'https:') return deny(`url protocol must be https:, got "${parsed.protocol}"`);
  if (parsed.username || parsed.password) return deny('url carries a username or password');
  if (parsed.port && parsed.port !== '443') return deny(`url port must be empty or 443, got "${parsed.port}"`);

  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('.')) return deny('url host has a trailing dot');

  const candidates = adapters.filter((a) => a.hosts.some((h) => normalizeHost(h) === host));
  if (candidates.length === 0) return deny(`host "${host}" is not claimed by any site adapter`);

  const pathname = parsed.pathname;
  const allowed = candidates.filter((a) => adapterAllowsPath(a, pathname));
  if (allowed.length === 0) {
    return deny(`path "${pathname}" on "${host}" is not allowed by any site adapter`);
  }
  return { ok: true, adapter: allowed[0], host, pathname };
}

/** `"amazon-in/cart"` -> `"amazon-in"`; `"amazon-in"` -> `"amazon-in"` (the §3.4 step 4 rule). */
function sourceToBareId(source) {
  return String(source).split('/')[0];
}

// ---------------------------------------------------------------------------
// Adapter loading
// ---------------------------------------------------------------------------

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isStringList(v) {
  return Array.isArray(v) && v.every(isNonEmptyString);
}

function isRegexList(v) {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((src) => {
    if (!isNonEmptyString(src)) return false;
    try {
      new RegExp(src);
      return true;
    } catch {
      return false;
    }
  });
}

/** A bare lowercase hostname: no scheme, port, path, whitespace or uppercase. */
function isHostname(v) {
  return isNonEmptyString(v) && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v);
}

const REQUIRED_URLS = { shop: ['search', 'cart', 'wishlist'], history: ['lookup'] };

/**
 * Validate parsed adapter objects (already-shaped `{ file, data }` entries). Throws on the first
 * problem; `loadSites`' caller turns that into a fail-closed exit.
 *
 * Two checks need the whole set, so they run after every adapter is individually valid:
 * a history adapter's `covers` must name loaded shop adapters, and its `allow` regexes must not
 * match anything in the adversarial path suite.
 */
function validateSites(entries) {
  const adapters = [];
  const seenIds = new Map();
  const historyFiles = new Map();
  const shops = [];

  for (const { file, data } of entries) {
    const where = `sites/${file}`;
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(where, 'adapter must be a JSON object');

    const { id, kind, label, hosts, allow, deny, urls, notes } = data;
    if (!isNonEmptyString(id)) fail(where, 'missing string "id"');
    if (seenIds.has(id)) fail(where, `duplicate adapter id "${id}" (also in sites/${seenIds.get(id)})`);
    if (kind !== 'shop' && kind !== 'history') fail(where, `"kind" must be "shop" or "history", got ${JSON.stringify(kind)}`);
    if (!isNonEmptyString(label)) fail(where, 'missing string "label"');
    if (!Array.isArray(hosts) || hosts.length === 0) fail(where, '"hosts" must be a non-empty array');
    if (hosts.some((h) => !isHostname(h))) {
      fail(where, `"hosts" must hold bare lowercase hostnames, got ${JSON.stringify(hosts)}`);
    }
    if (new Set(hosts).size !== hosts.length) fail(where, '"hosts" contains duplicates');
    if (!isRegexList(allow)) fail(where, '"allow" must be a non-empty array of valid regex sources');
    if (deny !== undefined && !isStringList(deny)) fail(where, '"deny" must be an array of strings');
    if (!urls || typeof urls !== 'object' || Array.isArray(urls)) fail(where, 'missing object "urls"');
    for (const [key, value] of Object.entries(urls)) {
      if (!isNonEmptyString(value)) fail(where, `"urls.${key}" must be a non-empty string`);
    }
    for (const key of REQUIRED_URLS[kind]) {
      if (!isNonEmptyString(urls[key])) fail(where, `"urls.${key}" is required for a ${kind} adapter`);
    }
    if (notes !== undefined && !isStringList(notes)) fail(where, '"notes" must be an array of strings');

    const adapter = {
      id,
      kind,
      label,
      hosts: hosts.slice(),
      allow: allow.slice(),
      deny: (deny || []).slice(),
      urls: { ...urls },
      notes: (notes || []).slice(),
    };

    if (kind === 'history') {
      if (!isStringList(data.covers) || data.covers.length === 0) {
        fail(where, 'a history adapter needs a non-empty "covers" array of shop-adapter ids');
      }
      const offending = ADVERSARIAL_PATHS.filter((p) => allow.some((src) => new RegExp(src).test(p)));
      if (offending.length > 0) {
        fail(
          where,
          `"allow" would permit mutating path(s) ${offending.join(', ')} — a history adapter may not ` +
            'cover account or mutation paths',
        );
      }
      adapter.covers = data.covers.slice();
      historyFiles.set(id, file);
    } else {
      shops.push(adapter);
    }

    seenIds.set(id, file);
    adapters.push(adapter);
  }

  const shopIds = new Set(shops.map((s) => s.id));
  for (const adapter of adapters) {
    if (adapter.kind !== 'history') continue;
    for (const covered of adapter.covers) {
      if (!shopIds.has(covered)) {
        fail(`sites/${historyFiles.get(adapter.id)}`, `"covers" names "${covered}", which is not a loaded shop adapter`);
      }
    }
  }

  return adapters;
}

/** Read and validate every `sites/*.json` under `dir`. Throws if any adapter is invalid. */
function loadSites(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`no site adapters found in ${dir}`);

  const entries = files.map((file) => {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`sites/${file}: not valid JSON — ${err.message}`);
    }
    return { file, data };
  });

  return validateSites(entries);
}

module.exports = {
  ALLOWED_TOOLS,
  DENY_VOCABULARY,
  ADVERSARIAL_PATHS,
  MAX_URL_LENGTH,
  checkTool,
  checkUrl,
  loadSites,
  validateSites,
  sourceToBareId,
};
