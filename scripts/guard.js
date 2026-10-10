#!/usr/bin/env node
'use strict';

/**
 * The guard hook: the deterministic backstop that makes "read-only" mechanical rather than
 * instructional (R4). A prompt is not a control.
 *
 *   node scripts/guard.js pre        # PreToolUse — deny a tool or URL before it runs
 *   node scripts/guard.js post       # PostToolUse — catch an off-allowlist landing
 *   node scripts/guard.js selftest   # run the policy matrix; non-zero on any miss
 *
 * Everything is scoped to `agent_type === AGENT_TYPE`, so no other agent's calls are touched. The
 * hook matchers for both events are `mcp__.*`, and *this* file is the policy: which tools may be
 * called, which must carry a `url`, and which responses are scanned for a landing all come from
 * `browsers/*.json`. The matcher cannot narrow that, which is deliberate — a matcher naming one
 * vendor's server is a matcher that silently stops applying the moment a different browser is
 * configured (R2).
 *
 * Any error at all exits 2 — exit 2 is what blocks a tool call, and every *other* non-zero exit
 * fails open, so the catch below is load-bearing, not decoration.
 */

const fs = require('node:fs');
const path = require('node:path');

const { checkTool, checkUrl, loadBrowsers, loadSites } = require('./policy');

/**
 * `DEAL_SCOUT_AGENT_TYPE` overrides the scope. Portability seam, not a knob — see Review Notes.
 * The default is the plugin-namespaced name Claude Code synthesises for this subagent.
 */
const AGENT_TYPE = process.env.DEAL_SCOUT_AGENT_TYPE || 'claude-deal-scout:deal-scout';

/** Is `bare` a tool whose `tool_input` must carry a `url`, per the loaded browsers? */
function isUrlBearing(bare, browsers) {
  return browsers.some((b) => b.url_bearing.includes(bare));
}

/**
 * Is `bare` a tool whose response must be scanned for an off-allowlist landing?
 *
 * Deliberately a separate question from the allow set, and not answered by the matcher. The
 * page-text tools are allowed but not landing-checked: their response *is* the page, and a real
 * product page is full of third-party links, so scanning them would block every read.
 */
function isLandingChecked(bare, browsers) {
  return browsers.some((b) => b.landing_check.includes(bare));
}

const EXIT_BLOCKED = 2;

/** Bounds on walking a hostile `tool_response`. */
const MAX_WALK_DEPTH = 20;
const MAX_URLS = 50;

/** `DEAL_SCOUT_SITES_DIR` overrides the adapter directory. Test seam only — see Review Notes. */
const SITES_DIR = process.env.DEAL_SCOUT_SITES_DIR || path.join(__dirname, '..', 'sites');

/** `DEAL_SCOUT_BROWSERS_DIR` overrides the browser registry. Test seam only — see Review Notes. */
const BROWSERS_DIR = process.env.DEAL_SCOUT_BROWSERS_DIR || path.join(__dirname, '..', 'browsers');

const ALLOW = { code: 0, stdout: '', stderr: '' };

function blocked(reason) {
  return { code: EXIT_BLOCKED, stdout: '', stderr: `claude-deal-scout guard: ${reason}\n` };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

function readPayload() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (err) {
    throw new Error(`could not read the hook payload from stdin: ${err.message}`);
  }
  if (String(raw).trim() === '') throw new Error('hook payload on stdin was empty');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`hook payload on stdin was not valid JSON: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function evaluatePre(payload, adapters, browsers) {
  const toolName = payload.tool_name;
  const toolCheck = checkTool(toolName, browsers);
  if (!toolCheck.ok) return blocked(toolCheck.reason);

  const bare = toolCheck.tool;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const url = input.url;

  // tabs_create_mcp is deliberately not url_bearing: it takes no parameters (H5, live-checked), so
  // it opens a blank tab and the URL is checked on the navigate that follows.
  if (isUrlBearing(bare, browsers) && (typeof url !== 'string' || url === '')) {
    return blocked(`${bare} was called without a "url" — failing closed`);
  }

  if (typeof url === 'string' && url !== '') {
    const urlCheck = checkUrl(url, adapters);
    if (!urlCheck.ok) return blocked(urlCheck.reason);
  }

  return ALLOW;
}

/** Every `http(s)://…` string anywhere in the tool response, bounded in depth and count. */
function collectUrls(value, out = [], depth = 0) {
  if (out.length >= MAX_URLS || depth > MAX_WALK_DEPTH) return out;
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>)\]}]+/g)) {
      out.push(match[0]);
      if (out.length >= MAX_URLS) break;
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out, depth + 1);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, out, depth + 1);
  }
  return out;
}

function evaluatePost(payload, adapters, browsers) {
  // The matcher fires on every MCP tool call, so gate here before scanning: only a landing-checked
  // tool's response is worth reading, and a tool outside the allow set is the `pre` hook's problem,
  // not this one's. Without this gate, `read_page`'s page text — full of third-party links — would
  // block every read.
  //
  // The polarity matters: skip only when the tool is *positively identified* as one that is not
  // landing-checked. A payload whose tool name does not resolve is malformed, and the fail-closed
  // direction for a scan is to scan — so an unresolvable name falls through rather than past.
  const toolCheck = checkTool(payload.tool_name, browsers);
  if (toolCheck.ok && !isLandingChecked(toolCheck.tool, browsers)) return ALLOW;

  const response = payload.tool_response !== undefined ? payload.tool_response : payload.tool_result;

  for (const url of collectUrls(response)) {
    const urlCheck = checkUrl(url, adapters);
    if (!urlCheck.ok) {
      return {
        code: 0,
        stdout: JSON.stringify({
          decision: 'block',
          reason:
            `navigation ended on ${url}, which is not on the allowlist (${urlCheck.reason}). ` +
            'Discard what this page showed and close the tab — a redirect may have taken you somewhere untrusted.',
        }),
        stderr: '',
      };
    }
  }

  return ALLOW;
}

/**
 * The whole decision, scoping included — so the selftest matrix exercises exactly what a real hook
 * call exercises. `mode` is `pre` or `post`.
 */
function evaluate(mode, payload, adapters, browsers) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('hook payload is not a JSON object');
  }
  // Scoped out: every other agent, and every non-deal-scout Chrome call, is left alone (R3).
  if (payload.agent_type !== AGENT_TYPE) return ALLOW;
  return mode === 'post' ? evaluatePost(payload, adapters, browsers) : evaluatePre(payload, adapters, browsers);
}

/** An unparseable payload, a broken adapter or any other throw must block, not pass. */
function failClosed(err) {
  process.stderr.write(`claude-deal-scout guard: ${err && err.message ? err.message : String(err)}\n`);
  return EXIT_BLOCKED;
}

// ---------------------------------------------------------------------------
// Selftest
// ---------------------------------------------------------------------------

function preCall(toolName, url, agentType = AGENT_TYPE) {
  const tool_input = url === undefined ? {} : { url };
  return { agent_type: agentType, hook_event_name: 'PreToolUse', tool_name: toolName, tool_input };
}

const SELFTEST_CASES = [
  // Scoping — the guard must be invisible to everything that is not this agent.
  ['scoped out: another agent gets an otherwise-denied tool', 'pre', preCall('computer', undefined, 'other-plugin:other-agent'), 0],
  ['scoped out: a denied URL is untouched for another agent', 'pre', preCall('navigate', 'https://evil.example.com/x', 'other-plugin:other-agent'), 0],
  ['scoped out: a missing agent_type is untouched', 'pre', { hook_event_name: 'PreToolUse', tool_name: 'computer', tool_input: {} }, 0],

  // Allowed reads.
  ['allow: product page', 'pre', preCall('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX'), 0],
  ['allow: search page', 'pre', preCall('navigate', 'https://www.flipkart.com/search?q=phone'), 0],
  ['allow: cart page', 'pre', preCall('navigate', 'https://www.flipkart.com/viewcart'), 0],
  ['allow: wishlist page', 'pre', preCall('navigate', 'https://www.amazon.in/hz/wishlist/ls'), 0],
  ['allow: read_page carries no url', 'pre', preCall('read_page'), 0],
  ['allow: get_page_text carries no url', 'pre', preCall('get_page_text'), 0],
  ['allow: find carries no url', 'pre', preCall('find'), 0],
  ['allow: tabs_context_mcp carries no url', 'pre', preCall('tabs_context_mcp'), 0],
  ['allow: tabs_close_mcp carries no url', 'pre', preCall('tabs_close_mcp'), 0],

  // Denied tools.
  ['deny: computer', 'pre', preCall('computer'), EXIT_BLOCKED],
  ['deny: form_input', 'pre', preCall('form_input'), EXIT_BLOCKED],
  ['deny: javascript_tool', 'pre', preCall('javascript_tool'), EXIT_BLOCKED],
  ['deny: file_upload', 'pre', preCall('file_upload'), EXIT_BLOCKED],
  ['deny: upload_image', 'pre', preCall('upload_image'), EXIT_BLOCKED],
  ['deny: gif_creator', 'pre', preCall('gif_creator'), EXIT_BLOCKED],
  ['deny: read_console_messages', 'pre', preCall('read_console_messages'), EXIT_BLOCKED],
  ['deny: read_network_requests (session headers)', 'pre', preCall('read_network_requests'), EXIT_BLOCKED],
  ['deny: MCP-prefixed javascript_tool', 'pre', preCall('mcp__claude-in-chrome__javascript_tool'), EXIT_BLOCKED],

  // Denied URLs on an allowed tool.
  ['deny: http scheme', 'pre', preCall('navigate', 'http://www.amazon.in/dp/B0XXXXXXXX'), EXIT_BLOCKED],
  ['deny: look-alike host', 'pre', preCall('navigate', 'https://evilamazon.in/dp/B0XXXXXXXX'), EXIT_BLOCKED],
  ['deny: suffix host', 'pre', preCall('navigate', 'https://amazon.in.evil.com/dp/B0XXXXXXXX'), EXIT_BLOCKED],
  ['deny: add-to-cart path', 'pre', preCall('navigate', 'https://www.amazon.in/gp/cart/add.html'), EXIT_BLOCKED],
  ['deny: sign-in path', 'pre', preCall('navigate', 'https://www.amazon.in/ap/signin'), EXIT_BLOCKED],
  ['deny: checkout path', 'pre', preCall('navigate', 'https://www.flipkart.com/checkout/entry'), EXIT_BLOCKED],

  // Fail-closed on a missing url for a URL-bearing tool.
  ['deny: navigate without a url', 'pre', preCall('navigate'), EXIT_BLOCKED],
  ['allow: tabs_create_mcp takes no url (blank tab)', 'pre', preCall('tabs_create_mcp'), 0],

  // Post-navigation.
  ['allow: post on an allowlisted landing', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__claude-in-chrome__navigate', tool_response: { url: 'https://www.amazon.in/dp/B0XXXXXXXX' } }, 0],
  ['deny: post on an off-allowlist landing', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__claude-in-chrome__navigate', tool_response: { url: 'https://ad.example.com/promo' } }, 0, true],
  ['deny: post on a tab listing that shows an off-allowlist tab', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: { availableTabs: [{ tabId: 1, url: 'https://ad.example.com/promo' }] } }, 0, true],

  // The second configured prefix, on both the allow path and the deny path.
  ['allow: a read_page under the second configured prefix is stripped and allowed', 'pre', preCall('mcp__Claude_Browser__read_page'), 0],
  ['deny: a non-allow-set tool under the second configured prefix', 'pre', preCall('mcp__Claude_Browser__javascript_tool'), EXIT_BLOCKED],
  ['deny: post landing under the second configured prefix', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__Claude_Browser__navigate', tool_response: { url: 'https://ad.example.com/promo' } }, 0, true],

  // The landing-check gate (browsers/*.json `landing_check`). This row is the whole reason the gate
  // exists: read_page's response is the page itself, so a link-dense page must pass unscanned.
  ['allow: a page-text tool response full of off-allowlist URLs is not scanned', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__claude-in-chrome__read_page', tool_response: 'Reviews mention https://ad.example.com/promo and https://tracker.example.net/x' }, 0],
  // ...but the gate skips only a tool it can positively identify. An unresolvable name is a malformed
  // payload, and a scan's fail-closed direction is to scan, so these two must still block.
  ['deny: post whose tool name does not resolve is still scanned', 'post', { agent_type: AGENT_TYPE, tool_name: 'mcp__unconfigured__read_page', tool_response: { url: 'https://ad.example.com/promo' } }, 0, true],
  ['deny: post carrying no tool name at all is still scanned', 'post', { agent_type: AGENT_TYPE, tool_response: { url: 'https://ad.example.com/promo' } }, 0, true],
];

function selftest(adapters, browsers) {
  let misses = 0;
  let count = 0;

  for (const [name, mode, payload, expectedCode, expectBlock] of SELFTEST_CASES) {
    count += 1;
    let outcome;
    try {
      outcome = evaluate(mode, payload, adapters, browsers);
    } catch (err) {
      process.stderr.write(`selftest MISS: ${name} — threw: ${err.message}\n`);
      misses += 1;
      continue;
    }

    // A row that does not ask for a block asserts the *absence* of one. Without that, an
    // allow-expected `post` row cannot fail: `evaluatePost` reports a block as `{"decision":"block"}`
    // on exit 0, which is the same exit code as a pass, so only stdout can tell them apart.
    const blockedAsExpected = expectBlock
      ? outcome.stdout.includes('"decision":"block"')
      : !outcome.stdout.includes('"decision":"block"');

    if (outcome.code !== expectedCode || !blockedAsExpected) {
      process.stderr.write(
        `selftest MISS: ${name} — expected exit ${expectedCode}${expectBlock ? ' with a block' : ''}, got exit ${outcome.code}\n`,
      );
      misses += 1;
    }
  }

  if (misses > 0) {
    process.stderr.write(`selftest FAILED: ${misses} of ${count} cases missed\n`);
    return 1;
  }
  process.stdout.write(`selftest OK: ${count} cases\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function run(mode) {
  if (mode === 'selftest') {
    // Loads both registries unconditionally and reads no payload: a broken adapter must surface
    // here rather than being masked by the scope gate below.
    return selftest(loadSites(SITES_DIR), loadBrowsers(BROWSERS_DIR));
  }
  if (mode !== 'pre' && mode !== 'post') {
    throw new Error(`unknown mode "${mode}" (expected pre, post or selftest)`);
  }

  const payload = readPayload();
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('hook payload is not a JSON object');
  }

  // Scoped out *before* either registry is read. The matcher now fires on every MCP tool call in
  // the session, so a broken sites/ or browsers/ file must not be able to block a call that has
  // nothing to do with this agent. `evaluate` keeps its own scope check for the selftest matrix,
  // whose scoping rows expect a decision rather than an early return.
  if (payload.agent_type !== AGENT_TYPE) return 0;

  const outcome = evaluate(mode, payload, loadSites(SITES_DIR), loadBrowsers(BROWSERS_DIR));
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  return outcome.code;
}

function main() {
  let code;
  try {
    code = run(process.argv[2]);
  } catch (err) {
    code = failClosed(err);
  }
  process.exit(code);
}

main();
