/* ---------------------------------------------------------------- boot
   Nullsolve is built by concatenating the files in src/ (see build.js) and
   wrapping them in one strict-mode IIFE. Nothing here is a module: every
   top-level `var` and `function` is shared across the files, in order:

     boot.js       this file: re-entry check and baked-in config
     util.js       tiny helpers shared with the install page
     providers.js  Gemini / Claude / OpenAI / DeepSeek / custom adapters
     settings.js   storage, settings (with migration), runtime state
     markdown.js   markdown -> safe HTML
     styles.js     the stylesheet
     panel.js      shadow DOM, layout, rendering, screen capture
     control.js    page-control tools
     chat.js       the send loop, settings form, events, init */

var HOST_ID = 'nullsolve-host-v1';
var APP_VERSION = '2.0.0';

/* Clicking the bookmark on a page that already has the panel toggles it. */
var existingHost = document.getElementById(HOST_ID);
if (existingHost && existingHost.__nullsolve) { existingHost.__nullsolve.toggle(); return; }
if (existingHost) { try { existingHost.remove(); } catch (e) { } }

/* Baked-in defaults, written by the install page or `node build.js --key=...`:
     { provider, apiKey, model, keys: { gemini, anthropic, ... }, endpoints }
   `endpoints` overrides provider base URLs and exists for the test harness. */
var CFG = (typeof window !== 'undefined' && window.__NULLSOLVE_CONFIG__) || {};
