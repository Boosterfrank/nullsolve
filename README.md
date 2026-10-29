# Nullsolve

A bookmarklet that drops a floating AI chat panel onto any page, like the
Gemini side panel in Chrome, except it works on whatever site you are already
on, with whichever model you prefer. Bring your own key for **Google Gemini**,
**Anthropic Claude**, **OpenAI GPT** or **DeepSeek**, or point it at any
OpenAI-compatible endpoint. It minimises to a draggable dot and can see your
screen.

**Install page:** <https://boosterfrank.github.io/nullsolve/> (published from
`main` by the Pages workflow).

```
src/            the app, split into modules that build.js concatenates
build.js        bundles src/ into one script, minifies it, writes dist/
dist/           build output: install page, bookmarklets, plain script
test/           unit tests, a mock provider server, headless-browser tests
.github/        CI (build + tests) and the GitHub Pages deployment
```

## Install

Open the install page and pick a provider. There are two buttons to drag onto
your bookmarks bar (`Cmd/Ctrl + Shift + B` shows the bar):

- **Nullsolve** carries the whole app inside the bookmark (about 83 KB). It
  works on the most sites, because it needs no network access to start.
- **Nullsolve (auto-updating)** is a 400-byte loader that fetches the newest
  `nullsolve.js` from the install page's host each time you click it, so
  updates arrive without re-installing. Sites that block external scripts need
  the full version.

The **API key** and **Model** fields are optional. Fill them in and the page
rewrites both buttons in place, baking the provider, key and model into the
bookmark itself, so the panel is ready on every site instead of asking per
domain. **Load from my key** replaces the built-in model list with the models
your key can actually use and tags the recommended one. The page holds your key
in memory only; the one request it can make is that model lookup, straight to
the provider. A baked key lives in the bookmark's URL, so anyone who can read
your bookmarks can read the key.

Click the bookmark on any normal website to open the panel. Click it again to
minimise, and again to restore.

## First run

1. Click the gear icon.
2. Choose a **Provider**.
3. Paste a key (the link under the field goes to that provider's key page).
4. **Save**. The model list refreshes from your key and the recommended model
   becomes the default. Keys are kept per provider, so you can switch between
   them freely.

| Provider | Default model | Notes |
|---|---|---|
| Google Gemini | `gemini-flash-latest`, or the newest plain Flash from your key | The alias is repointed by Google at the current Flash model, so it cannot go stale. |
| Anthropic Claude | `claude-opus-5-5` | Called with the browser-access header Anthropic requires for client-side use. Thinking stays on the model's adaptive default; thinking blocks are echoed back verbatim so tool use keeps working. Requests also opt into Anthropic's server-side fallback (`fallbacks: "default"`, beta), which reroutes a safety refusal to another model instead of returning an empty turn; a model that does not take it is used without it. |
| OpenAI GPT | newest mainline `gpt-N.N` from your key (`gpt-5.5` built in) | Chat Completions with `max_completion_tokens`; mini and nano tiers are listed too. |
| DeepSeek | `deepseek-v4-flash` | DeepSeek models cannot see images, so screenshots and attachments are left out. Its `reasoning_content` is echoed back, which its thinking mode requires around tool calls. DeepSeek does not document browser (CORS) access; it has worked in testing, but if it is blocked, route it through the custom option and a proxy. |
| OpenAI-compatible (custom URL) | whatever you type | Any base URL with `/chat/completions` and `/models` under it: OpenRouter, Groq, xAI, a local Ollama or LM Studio server. The key is optional. Requests are kept minimal for compatibility. |

Requests go from your browser straight to the provider. Nothing is proxied,
and the install page has no backend.

## What it does

- **Chat** with streaming replies, markdown and tables. Every fenced code block
  has a copy button, and so does each reply. Replies show which model answered
  and how long it took.
- **A screenshot with every message.** Send your first message and the
  browser shows its screen picker once; choose a tab, a window, or the whole
  screen. From then on every message silently carries a fresh JPEG frame
  (downscaled to 1280px wide). The panel hides itself for the instant the frame
  is grabbed, so the model sees the page, not its own chat (switch that off
  under **Settings → Screenshots** if you prefer). Stop from the chip's ×, the
  composer's screen icon, or your browser's own "Stop sharing" bar; stopping
  also suppresses the re-prompt until you turn it back on.
- **Images**: the `+` button attaches files, you can paste screenshots into the
  composer, or drop image files onto the panel.
- **Speed**: **Fast** asks the model for minimal reasoning so replies start
  sooner, **Deep** asks for the most, **Default** leaves the model alone. Each
  provider gets its own dialect (Gemini `thinkingLevel`, Claude `effort`, OpenAI
  `reasoning_effort`, DeepSeek `thinking`). A model that rejects the setting is
  retried once without it and remembered for the session, so a wrong guess
  costs one round trip, never a dead end.
- **Thinking**: when a model streams its reasoning (DeepSeek, or Claude with
  summaries on), it shows in a collapsible block above the answer.
- **Retry**: a failed turn shows the provider's message and a Retry button.
  Network failures say so, including the usual cause on strict sites.
- **Minimise to a dot**: a 54px black circle with the white `0` mark. Drag it
  anywhere; click it to reopen. The panel itself drags by its header and
  resizes from its top-left corner. `Esc` in the composer minimises.
- **Themes**: Default (follows your system), Light, Dark.
- **System prompt** is editable in settings.
- **Page control**: see below.

## Page control

Off by default. Under **Settings → Behaviour → Page control**:

| Mode | Behaviour |
|---|---|
| **Off** | No tools are sent to the model at all. |
| **Ask first** | Every action that changes the page shows an inline Allow / Skip card. |
| **Auto** | Low-risk actions run unattended; risky ones still ask. |

The model gets six tools: `list_elements`, `read_text`, `click`, `fill`
(optionally pressing Enter afterwards), `select_option` and `scroll`. They are
declared once as JSON Schema and translated into each provider's tool format,
including parallel calls. Elements are handed over as refs with their
accessible labels, and every call is logged as a row in the chat with a green,
red, or pulsing dot, so you can see exactly what it did.

### What "risky" means

Even in Auto, a confirmation is forced for anything that submits a form
(including `fill` with Enter), or whose label matches delete / send / buy / pay
/ checkout / confirm / publish / transfer / sign out and similar, or any link
that leaves the current origin.

`fill` **refuses outright**, in every mode, on password inputs and on any
field whose name, id, autocomplete, or placeholder looks like a credential or
payment detail (card, cvv, iban, ssn, otp, api key, seed phrase). Those you
type yourself.

### The real caveat

Page content is untrusted. The system prompt tells the model that anything it
reads from the page is data and never instructions, and the confirmation gate
stands between it and anything destructive, but a hostile page will still try
to talk it into things, and prompt injection is not a solved problem. Leave
this off on sites you do not trust, and prefer **Ask first** over **Auto**
anywhere that matters. The panel never targets its own UI.

Tool exchanges are provider-specific (Gemini's thought signatures, Claude's
tool-use ids and thinking blocks, OpenAI's call ids), so they are replayed only
to the provider that produced them; switching providers mid-conversation keeps
the text and drops the tool turns. The loop stops after 10 tool steps, the
composer's stop button cancels a pending confirmation as well as the request,
and if a tool turn fails the exact request payload is logged to the browser
console with a `[nullsolve]` prefix.

Navigation ends the session: the panel is injected per page load, so a click
that loads a new URL destroys it along with the conversation.

## Settings and storage

Settings and the last 40 text turns live in `localStorage`, which is **per
origin**. Your key carries across pages on `github.com` but not from
`github.com` to `google.com`. Settings from the Gemini-only release are
migrated automatically. Two ways around the per-origin limit:

Baking a key in from the install page (above) is the easy fix. The same thing
from the command line, for scripted builds:

```bash
node build.js --provider=anthropic --key=YOUR_KEY --model=claude-opus-5-5
```

This writes the baked values into both bookmarklets and prefills the install
page's fields. `--provider` is one of `gemini`, `anthropic`, `openai`,
`deepseek`, `custom` (with `--base=https://...` for the endpoint). Or

```bash
node build.js --host=https://your-host.example/nullsolve
```

also writes `dist/nullsolve.loader.txt`, the auto-updating bookmarklet, pulling
`nullsolve.js` from that host. The Pages workflow passes the site's own URL.

A key you save inside the panel on a given site takes precedence over a
baked-in one, so if you bake a new key and an old one is still saved for that
origin, hit **Reset** in settings to clear it.

## Limits

- **Strict CSP sites block bookmarklets.** On pages with a restrictive
  `Content-Security-Policy` (many banks, GitHub, some Google properties) the
  browser refuses to run `javascript:` URLs at all. The panel styles itself
  with a constructed stylesheet rather than an inline `<style>` where possible,
  which helps on moderately strict pages, but nothing works when script
  execution itself is refused. Paste `dist/nullsolve.js` into devtools, or wrap
  it in a userscript, on those sites. A site whose CSP restricts `connect-src`
  lets the panel open but blocks its requests; the error message says so.
- Page control drives the DOM directly. It cannot see cross-origin iframes,
  and it cannot survive navigation.
- Screen capture needs a secure context (`https:` or `localhost`), and the
  grant is per page load.
- If the capture delivers no frame within 1.5s the message is sent without a
  screenshot rather than blocking; hiding the panel for the grab waits at most
  450ms.

## Development

```bash
npm install          # terser (minifier) and playwright, both dev-only
node build.js        # writes dist/
npm run serve        # mock providers + static server on http://127.0.0.1:8731/test/
```

The test page injects `dist/nullsolve.js` directly, so a rebuild plus a reload
is the whole loop. Add `?noinject` to load it without the panel, for example
to paste a bookmarklet into the console. The host element carries a handle:

```js
document.getElementById('nullsolve-host-v1').__nullsolve
// { version, toggle, open, render, destroy, state, settings }
```

`test/mock-server.js` speaks all four providers' wire formats (SSE framing,
tool calls, model listings) with scripted replies; the panel is pointed at it
with `window.__NULLSOLVE_CONFIG__ = { endpoints: { gemini: 'http://127.0.0.1:8731/mock/gemini', ... } }`.

```bash
npm test             # unit tests: adapters, SSE reader, markdown, settings migration
npm run test:e2e     # headless Chromium against the mock server; builds into test/.out
```

Without `npm install`, `node build.js` still works: it skips minification and
ships the readable bundle (about 125 KB instead of 82 KB).

## Deploying

`.github/workflows/pages.yml` builds `dist/` and publishes it to GitHub Pages
on every push to `main` (and on demand from the Actions tab). It needs
**Settings → Pages → Source** set to **GitHub Actions**; the loader bookmarklet
on the published page then points at the site's own `nullsolve.js`.
`.github/workflows/ci.yml` runs the unit and end-to-end tests on every push.
