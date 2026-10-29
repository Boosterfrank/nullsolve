# Nullsolve

A bookmarklet that drops a floating AI chat panel onto any page — like the Gemini
side panel in Chrome, but it works on whatever site you are already on, minimises
to a draggable dot, and can see your screen.

```
src/nullsolve.js    the app (one IIFE, no dependencies)
build.js            turns it into a javascript: URL
dist/               build output — bookmarklet, install page, plain script
test/               local host page for trying it out
```

## Install

```bash
node build.js
```

Then open `dist/index.html`. It has an **API key** field and a **Model** dropdown
at the top: fill them in and the page rewrites the drag button in place, baking
those values into the bookmarklet itself. Leave them blank for a plain build you
configure from inside the panel.

Drag the **Nullsolve** button onto your bookmarks bar (`Cmd/Ctrl + Shift + B`
shows the bar). Or copy the raw URL from the textarea lower down the page — it
tracks the same fields.

**Load from my key** next to the dropdown calls the Gemini API with whatever key
you typed and replaces the built-in list with the models that key can actually
use, tagging the newest plain Flash model `(recommended)`. Always prefer this
over the built-in list, which is a snapshot and goes stale as Google ships new
models.

The default is `gemini-flash-latest`, an alias Google repoints at the current
best Flash model, so it cannot go stale the way a pinned id can.

Click the bookmark on any normal website to open the panel. Click it again to
minimise, and again to restore.

The page holds your key in memory only — it is not stored, and the sole request
it makes is the optional model lookup, straight to Google. Note that a baked key
lives in the bookmark's URL, so anyone who can read your bookmarks can read the
key.

## First run

1. Click the gear icon.
2. Provider is **Google Gemini** (the others are listed but disabled for now).
3. Paste a key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
4. **Save**. The model list refreshes from your key automatically, and the newest
   plain Flash model gets tagged `(recommended)` and becomes the default.

## What it does

- **Chat** with streaming responses, markdown and tables. Every fenced code
  block gets its own header bar with a copy button, and whole replies have one too.
- **A screenshot with every message.** Send your first message and the browser
  shows its screen-picker once — choose a tab, a window, or the whole screen.
  From then on every message you send silently carries a fresh JPEG frame
  (downscaled to 1280px wide), with no prompt and no toggling. Stop from the
  chip's ×, the composer's screen icon, or your browser's own "Stop sharing"
  bar; stopping also suppresses the re-prompt, so it stays off until you turn it
  back on. Switch it off entirely under **Settings → Behaviour → Screenshots**.

  The one-time picker is a hard browser rule: a web page cannot read the screen
  without an explicit grant, and no bookmarklet can skip it. What it *can* do is
  ask once and then reuse the stream, which is what this does.
- **Images** — the `+` button attaches files, and you can paste screenshots
  straight into the composer.
- **Minimise to a dot** — a 54px black circle with the white `0` mark. Drag it
  anywhere; click it to reopen. The panel itself drags by its header and resizes
  from its top-left corner.
- **Themes** — Default (follows your system), Light, Dark.
- **System prompt** is editable in settings.
- **Page control** — see below.

## Page control

Off by default. Under **Settings → Behaviour → Page control**:

| Mode | Behaviour |
|---|---|
| **Off** | No tools are sent to the model at all. |
| **Ask first** | Every action that changes the page shows an inline Allow / Skip card. |
| **Auto** | Low-risk actions run unattended; risky ones still ask. |

The model gets six tools: `list_elements`, `read_text`, `click`, `fill`,
`select_option`, and `scroll`. This has been run end to end against the live
Gemini API, including parallel tool calls. Elements are handed over as refs with their
accessible labels, and every call is logged as a row in the chat with a green,
red, or pulsing dot, so you can see exactly what it did.

### What "risky" means

Even in Auto, a confirmation is forced for anything that submits a form, or whose
label matches delete / send / buy / pay / checkout / confirm / publish / transfer
/ sign out and similar, or any link that leaves the current origin.

`fill` **refuses outright** — in every mode, with no prompt to click through — on
password inputs and on any field whose name, id, autocomplete, or placeholder
looks like a credential or payment detail (card, cvv, iban, ssn, otp, api key,
seed phrase). Those you type yourself.

### The real caveat

Page content is untrusted. The system prompt tells the model that anything it
reads from the page is data and never instructions, and the confirmation gate
stands between it and anything destructive — but a hostile page will still try to
talk it into things, and prompt injection is not a solved problem. Leave this off
on sites you do not trust, and prefer **Ask first** over **Auto** anywhere that
matters. The panel never targets its own UI, so it cannot click its own buttons.

Tool results are sent back as `role: "user"` turns carrying `functionResponse`
parts, sanitised to plain JSON first, and the history window never starts
mid-exchange.

Thinking models attach an opaque `thoughtSignature` to each `functionCall` part,
plus a call `id`. Both are captured as the call streams in — including when the
signature arrives on a later chunk than the call itself — and echoed back
verbatim on the replayed part, with the `id` mirrored onto the matching
`functionResponse` so parallel calls pair up correctly. Without the signature the
API rejects the next turn outright
([docs](https://ai.google.dev/gemini-api/docs/thought-signatures)).

On parallel calls the API only signs the *first* part; replaying the rest
unsigned is what it expects, and is accepted. Signatures on
plain text parts are not preserved, because SSE splits text across many delta
parts and there is no honest way to reassemble which signature belonged to what;
only function calls hard-fail without one. Signatures are per-session and are not
written to `localStorage`, so a reloaded conversation carries none. If a tool turn ever fails, the exact request payload is logged to
the browser console with a `[nullsolve]` prefix, and the error in the panel tells
you to switch Page control off to keep chatting.

Navigation ends the session: the panel is injected per page load, so a click that
loads a new URL destroys it along with the conversation. The loop also stops
after 10 tool steps, and the composer's stop button cancels a pending
confirmation as well as the request.

## Settings and storage

Settings and the last 40 messages live in `localStorage`, which is **per origin**.
Your key carries across pages on `github.com` but not from `github.com` to
`google.com`. Two ways around that:

Baking a key in from `dist/index.html` (above) is the easy fix. The same thing
from the command line, for scripted builds:

```bash
node build.js --key=YOUR_KEY --model=gemini-2.5-flash
```

This writes the baked values into `dist/nullsolve.bookmarklet.txt` and prefills
the install page's fields. Or

```bash
node build.js --host=https://your-host.example/nullsolve.js
```

also writes `dist/nullsolve.loader.txt`, a ~200 byte bookmarklet that pulls
`dist/nullsolve.js` from that URL each time — useful if you want to update the
script without re-installing the bookmark.

A key you save inside the panel on a given site takes precedence over a baked-in
one, so if you bake a new key and an old one is still saved for that origin, hit
**Reset** in settings to clear it.

Requests go from your browser straight to Google. Nothing is proxied.

## Limits

- **Strict CSP sites block bookmarklets.** On pages with a restrictive
  `Content-Security-Policy` (many banks, GitHub, some Google properties) the
  browser refuses to run `javascript:` URLs at all. The panel styles itself with
  a constructed stylesheet rather than an inline `<style>` where possible, which
  helps on moderately strict pages, but nothing works when script execution
  itself is refused. Paste `dist/nullsolve.js` into devtools, or wrap it in a
  userscript, on those sites.
- Page control drives the DOM directly. It cannot see cross-origin iframes, and
  it cannot survive navigation.
- Screen capture needs a secure context (`https:` or `localhost`).
- The capture grant is per page load. Reloading the page, or navigating to
  another one, means the next message asks for the screen again.
- If the stream delivers no frame within 1.5s the message is sent without a
  screenshot rather than blocking.

## Development

```bash
node build.js && python3 -m http.server 8731
```

then open `http://localhost:8731/test/`. The test page injects `dist/nullsolve.js`
directly, so a rebuild plus a reload is the whole loop. `window.__nullsolve` is
not exposed, but the host element carries the handle:

```js
document.getElementById('nullsolve-host-v1').__nullsolve
// { toggle, open, render, destroy, state }
```
