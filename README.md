# claude-deal-scout

A Claude Code plugin that researches shopping sites (Amazon.in, Flipkart) to find the best deal and best
product for a given requirement — comparing it against your wishlist, cart, and saved-for-later items on
sites you're already logged into, plus price history: when the price was usually lowest and when the next
dip can be expected.

**Read-only.** It cannot buy anything, change your account, or handle your credentials. Nothing is ever
added to a cart or wishlist, and no order or payment page is opened.

India only for v1 (`amazon.in`, `flipkart.com`), with a data-driven adapter design so adding a site means
adding a file — no code change.

## Install

This is a Claude Code plugin, installed from this repo as a local `directory` marketplace:

```bash
# from the repo root
claude plugin marketplace add ./
claude plugin install claude-deal-scout@claude-deal-scout
```

Then restart, or run `/reload-plugins`, so the hooks load.

Installing edits your Claude Code configuration, so do it deliberately — nothing here does it for you.

**Requires:** `node` on your PATH (any recent version; there are no dependencies to install) and a
browser the plugin is configured for — by default the Claude in Chrome extension, connected. The browser
is configuration, not a hard dependency: see [Swapping the browser](#swapping-the-browser).

## Use

```
/claude-deal-scout:find-best-deal
```

1. **Say what you're looking for.** Budget, must-haves, brands to avoid, any cards or offers you actually
   hold, and — if you're buying by a certain date — a deadline. The deadline is what makes a
   buy-now-or-wait answer possible rather than a vague one.
2. **Log in yourself**, in the Chrome window Claude is connected to, if you want the cart / wishlist /
   saved-for-later comparison. The plugin never asks for credentials and never signs in for you. Skip this
   and the run still works, using public results only.
3. **Read the report.** Best product and best deal (they can differ), a comparison table including
   anything excluded by your must-haves *with the reason shown*, what's in your own lists, a price-history
   buy-now-or-wait verdict with a confidence level, flags, and anything that couldn't be read.

Price forecasts are **estimates, not promises**, and "no reliable pattern" is a real answer — not a
failure. The plugin is deterministic about ranking and honest about what it doesn't know.

### What it will refuse to do

Buy, add to a cart or wishlist, sign in, solve a CAPTCHA, or click to reveal data. Those aren't
limitations to work around; they're the design, and there's a hook enforcing them.

## Adding a site

Adding a site is **adding a file**. Drop a JSON adapter in `sites/` and it is picked up at load — no code
change anywhere. Copy `sites/amazon-in.json` as a starting point.

### A shop adapter

```json
{
  "id": "amazon-in",
  "kind": "shop",
  "label": "Amazon India",
  "hosts": ["www.amazon.in", "amazon.in"],
  "allow": ["^/s$", "^/dp/[A-Z0-9]{10}$", "^/gp/cart/view\\.html$", "^/hz/wishlist/ls(/.*)?$"],
  "deny": ["add", "buy", "checkout", "signin", "/ap/", "/gp/css/", "payment", "address", "order"],
  "urls": {
    "search": "https://www.amazon.in/s?k={q}",
    "cart": "https://www.amazon.in/gp/cart/view.html",
    "wishlist": "https://www.amazon.in/hz/wishlist/ls",
    "saved": "https://www.amazon.in/gp/cart/view.html"
  },
  "notes": ["Saved-for-later renders on the cart page below the cart items."]
}
```

- `hosts` — bare lowercase hostnames, no scheme, port or path. A URL's host must match one of these
  **exactly**; suffix and substring matching are never used, which is what defeats `evilamazon.in` and
  `amazon.in.evil.com`.
- `allow` — regexes matched against the URL **pathname** (not the query). This is the real control: an
  unknown path is denied by default. Keep it as tight as you can stand.
- `deny` — the account- and mutation-vocabulary tokens. Matched at a word boundary, so `add` catches
  `/gp/cart/add.html` but not `/product/address-guide`. Deny is defence-in-depth; `allow` is the control.
- `urls` — the templates the agent navigates to. `search` uses `{q}`; `cart`, `wishlist` and `saved` are
  plain URLs. A shop adapter needs at least `search`, `cart` and `wishlist`.
- `notes` — anything a future reader should know about this site.

### A history adapter

Price-history sites are a second kind, and need `"kind": "history"` plus:

```json
{
  "id": "example-history",
  "kind": "history",
  "label": "Example Price History",
  "hosts": ["example-history.com"],
  "allow": ["^/price/[^/]+$"],
  "urls": { "lookup": "https://example-history.com/price/{id}" },
  "covers": ["amazon-in", "flipkart"]
}
```

- `covers` — the shop-adapter `id`s this site can look up. **Must name adapters that are actually
  loaded**, or the adapter is rejected.
- `urls.lookup` — built from the product's public, query-stripped URL or title. Never from account data.

### Two rules `loadSites` enforces, so you find out at load rather than at runtime

1. **A history adapter may not reach account or mutation paths.** Every `allow` regex is tested against a
   fixed adversarial path suite; if any of them matches, say, `/buy/confirm` or `/payment/result`, the
   adapter is rejected. This is checked by *running* your regex, not by reading it, so an innocent pattern
   is not rejected for merely containing a word like `address`.
2. **`covers` must name loaded shop adapters.** A typo is a load error, not a silently dead lookup.

A bad adapter makes the guard **fail closed**: the run stops rather than proceeding with a policy that
isn't what you think it is. If the plugin suddenly refuses everything after you edit `sites/`, check the
adapter first.

### Before you trust a new history site

Add one only after confirming, by hand, that its pages expose **all four** of `current`, `lowest`,
`highest` and `average` as readable text. The agent cannot click, so a site that renders its chart and
hides the numbers is useless here no matter how good its data is. A partial result counts as no data.

## Model and browser independence

**No model dependency.** Nothing here requires a Claude model. There is no `model:` key in any
frontmatter, and nothing in `scripts/`, `sites/` or `data/` names one. The deterministic core —
`score.js`, `history.js`, `report.js` — is plain Node with zero dependencies, so the plugin runs
unchanged under whichever model your session is using.

**The browser is configuration.** Which browser tools the research subagent may call, which must carry a
URL, and which get a landing check are all one `browsers/*.json` file, not code. The guard enforces that
registry on every MCP tool call. Claude in Chrome is the shipped default.

**One harness-supplied value.** `${CLAUDE_PLUGIN_ROOT}` appears only in the skill's shell commands and
the two hook commands; no script reads it. `report.js` and `guard.js` resolve `sites/`, `browsers/` and
`data/` from their own location, so both work from any working directory.

## Swapping the browser

Adding a browser is adding a file — but unlike adding a site it is **not only** a file, because the
subagent's tool grant is fixed Markdown. Three steps:

1. **Add `browsers/<id>.json`**, by copying `browsers/claude-in-chrome.json` and replacing its arrays:

   - `prefixes` — the MCP server names its tools arrive under, each ending in `__`. A tool under any
     prefix not listed here is denied, so a browser whose server name nobody wrote down is a browser
     nothing may call.
   - `allow` — the bare tool names the agent may call; everything else is default-denied. This is the
     read-only guarantee, so keep it as tight as you can stand.
   - `url_bearing` — the tools whose call must carry a `url`. A missing one fails closed.
   - `landing_check` — the tools whose *response* is scanned for an off-allowlist landing. Deliberately
     **not** the same as `allow`: a tool that returns page text must stay out of it, or its third-party
     links will block every read.

   A malformed adapter makes the guard **fail closed** — the run stops rather than proceeding with a
   policy that isn't what you think it is. Two adapters may not claim the same server prefix or the same
   tool name: that would make "which policy applies" depend on load order, so it is a load error instead.

2. **Rewrite the subagent's `tools:` list** in `agents/deal-scout.md` to that server's names. This is
   the step that cannot be generated, and the one people forget: if the two lists disagree, the agent
   either holds a tool the guard denies or has no policy for the tool it was granted.

3. **Reload.** Bump `version` in `.claude-plugin/plugin.json`, then
   `claude plugin update claude-deal-scout@claude-deal-scout` and restart (or `/reload-plugins`). Hook
   definitions are read from the installed copy, so a cache that was not updated keeps enforcing the old
   policy.

Then `node scripts/guard.js selftest` must exit 0.

> **If you replaced `browsers/claude-in-chrome.json` rather than adding your file next to it**, that
> command will report failures on a perfectly good swap — and it is telling you something real, so do not
> ignore it. The selftest matrix and `test/browser.test.js` both exercise the *shipped* adapter by name
> (`mcp__claude-in-chrome__*`), because a plugin should test the configuration it ships. Update those
> names to your adapter's, or keep the shipped file and add yours alongside. Adding alongside is the
> cheaper path: two adapters coexist, and the guard takes the union of their prefixes and tools.

## Security

The safety model, the residual risks, and the manual end-to-end checklist live in
[docs/SECURITY.md](docs/SECURITY.md). Read it before trusting any of the above — in particular, several
controls are **unverified** on this build, and that document says which.

## Design

The full design plan is in `docs/planning/`. The short version: the model extracts, deterministic scripts
judge (`scripts/score.js`, `scripts/history.js`), and a hook (`scripts/guard.js`, wired in
`hooks/hooks.json`) enforces two allowlists on the research subagent — a per-site path allowlist
(`sites/*.json`) and a per-browser tool allowlist (`browsers/*.json`).

```bash
npm test    # node --test, zero dependencies
```

MIT licensed — see [LICENSE](LICENSE).
