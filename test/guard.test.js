'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'guard.js');
const AGENT = 'claude-deal-scout:deal-scout';

/** Spawn the real guard the way the platform would, and report what it did. */
function run(mode, payload, { raw, env } = {}) {
  const result = spawnSync(process.execPath, [GUARD, mode], {
    input: raw !== undefined ? raw : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function pre(toolName, url, agentType = AGENT) {
  return {
    hook_event_name: 'PreToolUse',
    agent_type: agentType,
    tool_name: toolName,
    tool_input: url === undefined ? {} : { url },
  };
}

const post = (response, agentType = AGENT) => ({
  hook_event_name: 'PostToolUse',
  agent_type: agentType,
  tool_name: 'mcp__claude-in-chrome__navigate',
  tool_response: response,
});

// ---------------------------------------------------------------------------
// Selftest
// ---------------------------------------------------------------------------

test('selftest exits 0', () => {
  const result = run('selftest', undefined, { raw: '' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /selftest OK/);
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test('unparseable stdin exits 2', () => {
  const result = run('pre', undefined, { raw: 'this is not json {{{' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /not valid JSON/);
});

test('empty stdin exits 2', () => {
  assert.equal(run('pre', undefined, { raw: '' }).code, 2);
  assert.equal(run('pre', undefined, { raw: '   \n ' }).code, 2);
});

test('a JSON payload that is not an object exits 2', () => {
  for (const raw of ['"a string"', '42', 'null', '[1,2,3]']) {
    assert.equal(run('pre', undefined, { raw }).code, 2, raw);
  }
});

test('an unknown mode exits 2', () => {
  assert.equal(run('destroy', pre('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX')).code, 2);
});

test('a broken adapter directory fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-guard-'));
  try {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ not json at all');
    assert.equal(run('pre', pre('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX'), { env: { DEAL_SCOUT_SITES_DIR: dir } }).code, 2);

    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ id: 'x', kind: 'shop' }));
    assert.equal(run('pre', pre('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX'), { env: { DEAL_SCOUT_SITES_DIR: dir } }).code, 2);

    assert.equal(run('pre', pre('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX'), { env: { DEAL_SCOUT_SITES_DIR: path.join(dir, 'nope') } }).code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scoping — ordinary Chrome use is untouched
// ---------------------------------------------------------------------------

test('another agent type is left alone, even for a denied tool or URL', () => {
  assert.equal(run('pre', pre('computer', undefined, 'other-plugin:other')).code, 0);
  assert.equal(run('pre', pre('javascript_tool', undefined, 'other-plugin:other')).code, 0);
  assert.equal(run('pre', pre('navigate', 'https://evil.example.com/x', 'other-plugin:other')).code, 0);
  assert.equal(run('post', post({ url: 'https://evil.example.com/x' }, 'other-plugin:other')).code, 0);
});

test('a missing agent_type is left alone', () => {
  const result = run('pre', { hook_event_name: 'PreToolUse', tool_name: 'computer', tool_input: {} });
  assert.equal(result.code, 0);
});

// ---------------------------------------------------------------------------
// pre — tool policy (default deny)
// ---------------------------------------------------------------------------

test('the read-only tools are allowed', () => {
  for (const tool of ['navigate', 'read_page', 'get_page_text', 'find', 'tabs_context_mcp', 'tabs_close_mcp']) {
    const url = tool === 'navigate' ? 'https://www.amazon.in/dp/B0XXXXXXXX' : undefined;
    const result = run('pre', pre(tool, url));
    assert.equal(result.code, 0, `${tool}: ${result.stderr}`);
  }
  assert.equal(run('pre', pre('tabs_create_mcp', 'https://www.amazon.in/s?k=phone')).code, 0);
});

test('every dangerous Chrome tool is denied, bare or MCP-prefixed', () => {
  const dangerous = [
    'computer',
    'form_input',
    'javascript_tool',
    'file_upload',
    'upload_image',
    'gif_creator',
    'read_console_messages',
    'read_network_requests',
  ];
  for (const tool of dangerous) {
    for (const name of [tool, `mcp__claude-in-chrome__${tool}`, `mcp__Claude_Browser__${tool}`]) {
      const result = run('pre', pre(name));
      assert.equal(result.code, 2, `expected deny for ${name}`);
      assert.match(result.stderr, /guard:/);
    }
  }
});

// ---------------------------------------------------------------------------
// pre — URL policy
// ---------------------------------------------------------------------------

test('an allowlisted URL on an allowed tool passes', () => {
  const result = run('pre', pre('navigate', 'https://www.amazon.in/dp/B0XXXXXXXX'));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('an off-allowlist URL is denied with a reason on stderr', () => {
  for (const url of [
    'http://www.amazon.in/dp/B0XXXXXXXX',
    'https://evilamazon.in/dp/B0XXXXXXXX',
    'https://amazon.in.evil.com/dp/B0XXXXXXXX',
    'https://www.amazon.in/gp/cart/add.html',
    'https://www.amazon.in/ap/signin',
    'https://www.flipkart.com/account/login',
    'https://127.0.0.1/dp/B0XXXXXXXX',
    'javascript:alert(1)',
  ]) {
    const result = run('pre', pre('navigate', url));
    assert.equal(result.code, 2, `expected deny for ${url}`);
    assert.ok(result.stderr.trim().length > 0, `expected a reason for ${url}`);
  }
});

test('a URL is checked even on a tool that does not normally carry one', () => {
  assert.equal(run('pre', pre('read_page', 'https://evil.example.com/x')).code, 2);
  assert.equal(run('pre', pre('read_page', 'https://www.amazon.in/dp/B0XXXXXXXX')).code, 0);
});

// ---------------------------------------------------------------------------
// pre — fail closed on a missing url for a URL-bearing tool
// ---------------------------------------------------------------------------

test('the five non-url tools are allowed with no url key', () => {
  for (const tool of ['tabs_context_mcp', 'tabs_close_mcp', 'read_page', 'get_page_text', 'find']) {
    const result = run('pre', pre(tool));
    assert.equal(result.code, 0, `${tool}: ${result.stderr}`);
  }
});

test('a URL-bearing tool with no url key is denied', () => {
  for (const tool of ['navigate', 'tabs_create_mcp']) {
    const result = run('pre', pre(tool));
    assert.equal(result.code, 2, tool);
    assert.match(result.stderr, /without a "url"/);
  }
  // ...and an empty string is no better than a missing key.
  assert.equal(run('pre', pre('navigate', '')).code, 2);
});

// ---------------------------------------------------------------------------
// post — open-redirect catch
// ---------------------------------------------------------------------------

test('post allows a landing on an allowlisted host', () => {
  const result = run('post', post({ url: 'https://www.amazon.in/dp/B0XXXXXXXX' }));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('post blocks a landing off the allowlist, telling the agent to discard the page', () => {
  const result = run('post', post({ url: 'https://ad.example.com/promo', title: 'Redirecting' }));
  assert.equal(result.code, 0);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /Discard/);
  assert.match(decision.reason, /ad\.example\.com/);
});

test('post finds a URL nested anywhere in the response', () => {
  const nested = run('post', post({ content: [{ text: 'landed at https://tracker.example.com/x?y=1 ok' }] }));
  assert.equal(JSON.parse(nested.stdout).decision, 'block');
});

test('post allows a response that carries no URL at all', () => {
  const result = run('post', post({ ok: true, title: 'Amazon.in' }));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});
