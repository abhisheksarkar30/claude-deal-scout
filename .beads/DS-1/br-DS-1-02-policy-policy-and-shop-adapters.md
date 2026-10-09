# Bead br-DS-1-02: Build the policy layer, adapter schema, and shop adapters

**Plan Reference**: `docs/planning/DS-1-deal-scout-plugin.md` v15, §3.2 (guard tool/URL policy, lines 68-75), §3.3 (adapter schema, lines 77-89), §5.1 (risk table, lines 146-159), §5.2 (`policy.test.js` line 163, `adapter.test.js` line 167), §5.4 (controls 1, 3, 6, 7 — lines 178, 180, 183, 184). Repo `D:\github\claude-deal-scout`.

- **Bead ID**: br-DS-1-02
- **Priority**: P0 (critical — this is the security core the guard and the score validator both call)
- **Status**: pending
- **Original Estimate**: 2h
- **Dependencies**: br-DS-1-01
- **Blocks**: br-DS-1-03, br-DS-1-04, br-DS-1-06
- **Commit**: `feat(DS-1): policy layer, adapter schema, shop adapters (br-DS-1-02)`

## Description

Implement `scripts/policy.js` — pure functions `checkUrl`, `checkTool`, `loadSites`, no I/O besides
loading adapter files (§3.1 line 55) — plus the two v1 shop adapters, and their tests. This bead owns
the **whole** adapter schema (shop **and** `history` kind) and the URL/tool policy; the guard
(br-DS-1-03) and the score validator (br-DS-1-06) both call into it.

**`checkTool` (default-deny tool policy, §3.2 lines 71-73).** Allowed set only:
`tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `read_page`, `get_page_text`,
`find`. Everything else matched by the hook is denied, including `computer`, `form_input`,
`javascript_tool`, `file_upload`, `upload_image`, `gif_creator`, `read_console_messages`,
`read_network_requests`, and any `mcp__Claude_Browser__*` / `mcp__claude-in-chrome__*` name outside the
allowed set. `read_network_requests` is excluded deliberately — request data can carry session headers.

**`checkUrl` (§3.2 line 72).** Every string under a `url` key in `tool_input` must satisfy: length ≤
2048; no whitespace, control chars or backslashes in the raw string; parses as an absolute URL;
protocol exactly `https:`; no username/password; port empty or `443`; hostname (lowercased, no trailing
dot) **exactly equal** to a host in some loaded adapter — never suffix/substring matching, so
`amazon.in.evil.com`, `evilamazon.in`, `amazon.in@evil.com`, `amazon.in:8443`, `http://amazon.in`,
`https://127.0.0.1`, Cyrillic look-alikes (which normalise to `xn--…`), IDN and IP literals all fail;
and the pathname matches one of that adapter's `allow` regexes and **none** of its `deny` regexes.

**`loadSites` (§3.3 lines 77-89).** Load and validate every `sites/*.json`. Shared fields: `id`,
`kind` (`shop` | `history`), `label`, `hosts`, `allow`, `deny` (shop), `urls`, `notes`. A `history`
adapter additionally has `urls.lookup` and a non-empty `covers` array of shop-adapter `id`s. `loadSites`
must:

- reject any `history` adapter whose `covers` names a shop-adapter `id` that is not loaded (covers-id
  validation, §3.3 line 88);
- reject any `history` adapter whose `allow` regexes would permit a path matching the shop deny
  vocabulary. Test each allow-regex against a **fixed adversarial-path suite** — *not* by inspecting the
  regex source string — that includes at least one path per token in the deny vocabulary: `add`, `buy`,
  `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`, `order`. `/add`, `/ap/signin`,
  `/gp/css/order` are three examples, a subset only (§3.3 line 88). An overbroad regex like `^/.*$`
  (matches `/buy/confirm`) must be rejected; an innocent path sharing characters (`address-guide`) must
  not be falsely rejected;
- fail closed on any invalid adapter (the caller, br-DS-1-03, turns a thrown load error into exit 2).

**Shop adapters** (§3.3 lines 79-84, and the `urls` object): `sites/amazon-in.json` and
`sites/flipkart.json`, `kind: "shop"`. Amazon hosts `["www.amazon.in", "amazon.in"]`, allow e.g.
`^/s$`, `^/dp/[A-Z0-9]{10}$`, `^/gp/cart/view\.html$`, `^/hz/wishlist/ls(/.*)?$`; deny the mutating /
account vocabulary (`add`, `buy`, `checkout`, `signin`, `/ap/`, `/gp/css/`, `payment`, `address`,
`order`). Flipkart mirrors this for its real hosts and search/product/cart/wishlist URL shapes. Include
the account URL templates (`cart`, `wishlist`, `urls.search`) the agent uses. Keep it **data-driven**:
adding a site must remain "add a file", no code change (R7; §3.3 line 89).

## Rationale

The guard's only real control is the path allowlist, and the score validator re-checks every URL with
`checkUrl`; both need this layer to exist and to be correct. The `history`-adapter validation lives here
(not in the history bead) because it is schema/loader logic, and its adversarial-suite + covers-id
checks are the ones the risk table and negative controls pin.

## Outcome Definition

- `node --test test/policy.test.js test/adapter.test.js` exits 0.
- Every shipped `sites/*.json` passes `loadSites` and none of its `urls.*` templates violates its own
  policy (§5.2 line 167).
- The adversarial-suite and covers-id negative fixtures both make `loadSites` throw (docs: these are the
  §5.1 rows "overbroad `allow` regex silently passes" and "`covers`-id validation regression").
- Negative controls 1, 3, 6, 7 from §5.4 run once each and reverted; the observed failing/loading test
  names go in Review Notes (control 1: host match → `endsWith` ⇒ `evilamazon.in` / `amazon.in.evil.com`
  cases fail; control 3: allow-regex check replaced by deny-only ⇒ `/gp/cart/add.html` fails; controls
  6/7: disabling the two `loadSites` checks makes the two synthetic history-adapter fixtures load).

## Test Specifications

- `test/policy.test.js` (§5.2 line 163): deny `amazon.in.evil.com`, `evilamazon.in`,
  `amazon.in@evil.com`, `amazon.in:8443`, `http://amazon.in`, `https://127.0.0.1`, Cyrillic
  `аmazon.in`, trailing-dot host, backslash and whitespace tricks, `javascript:`/`data:`/`file:`; allow
  `https://www.amazon.in/dp/B0XXXXXXXX`, flipkart product/search/cart/wishlist; deny
  `/gp/cart/add.html`, `/gp/buy/…`, checkout, `/ap/signin`, `/account/login`; source-to-bare-id
  extraction: `"amazon-in/cart"` → `"amazon-in"`, `"amazon-in/wishlist"` → `"amazon-in"`,
  `"amazon-in/saved"` → `"amazon-in"`, `"amazon-in"` → `"amazon-in"`.
- `test/adapter.test.js` (§5.2 line 167): every shipped `sites/*.json` passes schema validation and its
  `urls.*` templates satisfy its own policy; synthetic `history`-kind fixture with `allow: ["^/.*$"]`
  must fail `loadSites`; synthetic `history` adapter whose `covers` names an unknown shop-adapter id
  must fail `loadSites`.
- **Manual / recorded**: the four mutation controls above; record the observed failing/loading test
  names in Review Notes (§5.4 line 186).

## Files to Touch

- `scripts/policy.js` (create — `checkUrl`, `checkTool`, `loadSites`; export the deny vocabulary)
- `sites/amazon-in.json` (create)
- `sites/flipkart.json` (create)
- `test/policy.test.js` (create)
- `test/adapter.test.js` (create)

## Review Notes

