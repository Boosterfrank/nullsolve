#!/usr/bin/env node
'use strict';

/*
 * Builds Nullsolve.
 *
 *   node build.js                          plain build
 *   node build.js --provider=anthropic --key=sk-ant-... --model=claude-opus-5-5
 *                                          bakes defaults into the bookmarklet and
 *                                          prefills the install page
 *   node build.js --host=https://example.github.io/nullsolve
 *                                          also emits a tiny loader bookmarklet
 *                                          that pulls nullsolve.js from that URL
 *   node build.js --no-minify              skip terser even when it is installed
 *   node build.js --out=some/dir           write somewhere other than dist/
 *
 * Output (dist/):
 *   nullsolve.js               the app, minified when terser is installed
 *   nullsolve.debug.js         the same code, readable
 *   nullsolve.bookmarklet.txt  javascript: URL carrying the whole app
 *   nullsolve.loader.txt       javascript: URL that loads it from --host
 *   index.html                 the install page
 *
 * The install page bakes keys in on its own, in the browser, with no rebuild.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DEFAULT_OUT = path.join(__dirname, 'dist');

/* Concatenation order; every file shares one IIFE scope. */
const SRC_FILES = ['boot', 'util', 'providers', 'settings', 'markdown', 'styles', 'panel', 'control', 'chat'];

/* The install page reuses the provider adapters for "Load from my key". */
const PAGE_FILES = ['util', 'providers'];

function read(name) {
  return fs.readFileSync(path.join(SRC_DIR, name + '.js'), 'utf8');
}

function assemble(names) {
  return names.map(n => '/* ==== src/' + n + '.js ==== */\n' + read(n)).join('\n');
}

function wrapIIFE(code) {
  return '(function () {\n\'use strict\';\n' + code + '\n})();';
}

function parseArgs(argv) {
  const args = {};
  argv.forEach(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  });
  return args;
}

/* encodeURIComponent, then put back the characters that are safe inside a
   javascript: URL. Mirrored byte for byte by the copy in the install page. */
const KEEP_RX = '20|22|24|26|2C|2F|3A|3B|3C|3D|3E|3F|40|5B|5D|5E|60|7B|7C|7D';
function toUrl(code) {
  const enc = encodeURIComponent(code)
    .replace(new RegExp('%(' + KEEP_RX + ')', 'g'), (m, h) => String.fromCharCode(parseInt(h, 16)));
  return 'javascript:' + enc + 'void 0;';
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Safe to drop inside a <script> block. */
function jsString(s) {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function loaderSource(host) {
  const src = host.replace(/\/+$/, '') + '/nullsolve.js';
  return "(function(){var s=document.createElement('script');s.src=" + JSON.stringify(src) + "+'?t='+Date.now();" +
    "s.onerror=function(){alert('Nullsolve could not load from " + src.replace(/'/g, '') +
    ". This site may block external scripts; use the full bookmarklet there.')};" +
    '(document.head||document.documentElement).appendChild(s);})();';
}

async function minify(code) {
  let terser;
  try { terser = require('terser'); } catch (e) { return null; }
  const out = await terser.minify(code, {
    ecma: 2017,
    compress: { passes: 2, pure_getters: false, unsafe: false },
    mangle: true,
    format: { comments: false, ascii_only: true }
  });
  if (out.error) throw out.error;
  return out.code;
}

function bakedConfig(args) {
  const cfg = {};
  if (typeof args.provider === 'string' && args.provider) cfg.provider = args.provider;
  if (typeof args.key === 'string' && args.key) cfg.apiKey = args.key;
  if (typeof args.model === 'string' && args.model) cfg.model = args.model;
  if (typeof args.base === 'string' && args.base) cfg.baseUrls = { custom: args.base };
  return cfg;
}

function prelude(cfg) {
  return Object.keys(cfg).length ? 'window.__NULLSOLVE_CONFIG__=' + JSON.stringify(cfg) + ';' : '';
}

async function build(args) {
  args = args || {};
  const debug = wrapIIFE(assemble(SRC_FILES));
  new Function(debug); // fail loudly rather than ship a broken bookmarklet

  let app = null;
  if (!args['no-minify']) app = await minify(debug);
  const minified = !!app;
  if (!app) app = debug;
  new Function(app);

  const cfg = bakedConfig(args);
  const pre = prelude(cfg);
  const inlineUrl = toUrl(pre + app);

  const host = typeof args.host === 'string' && args.host ? args.host.replace(/\/+$/, '') : '';
  const loaderUrl = host ? toUrl(pre + loaderSource(host)) : '';

  const pageLib = assemble(PAGE_FILES);
  const page = installPage({
    payload: app,
    pageLib: pageLib,
    host: host,
    cli: { provider: cfg.provider || '', key: cfg.apiKey || '', model: cfg.model || '' }
  });
  new Function(/<script>([\s\S]*)<\/script>/.exec(page)[1]);

  const outDir = typeof args.out === 'string' && args.out ? path.resolve(args.out) : DEFAULT_OUT;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'nullsolve.js'), app + '\n');
  fs.writeFileSync(path.join(outDir, 'nullsolve.debug.js'), debug + '\n');
  fs.writeFileSync(path.join(outDir, 'nullsolve.bookmarklet.txt'), inlineUrl);
  if (loaderUrl) fs.writeFileSync(path.join(outDir, 'nullsolve.loader.txt'), loaderUrl);
  else { try { fs.unlinkSync(path.join(outDir, 'nullsolve.loader.txt')); } catch (e) { } }
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  return { debug, app, minified, inlineUrl, loaderUrl, page, cfg, outDir };
}

function installPage(o) {
  const MARK = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="29" y="19" width="42" height="62" rx="21" fill="#F0EFEA"/><rect x="40.5" y="30.5" width="19" height="39" rx="9.5" fill="#000"/></svg>';
  const hostNote = o.host ? escAttr(o.host.replace(/^https?:\/\//, '')) : '';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nullsolve — install</title>
<meta name="description" content="A floating AI chat panel for any page, as a bookmarklet. Bring your own Gemini, Claude, GPT or DeepSeek key.">
<style>
  :root { color-scheme: light dark;
    --bg:#fff; --fg:#16181c; --mut:#62666d; --bd:#e3e5e9; --sf:#f5f6f8; --acc:#0b0c0e;
    --acc-fg:#fff; --warn:#8a5a00; --warn-bg:#fff6e5; --warn-bd:#f0dcb0; --ok:#1a7f4b; }
  @media (prefers-color-scheme: dark) { :root {
    --bg:#111317; --fg:#e8eaee; --mut:#9ba1a9; --bd:#2d3138; --sf:#1a1d22; --acc:#f0efea;
    --acc-fg:#0b0c0e; --warn:#e8b465; --warn-bg:#241d10; --warn-bd:#4a3a1c; --ok:#5fd39a; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 20px 90px; background:var(--bg); color:var(--fg);
         font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:680px; margin:0 auto; }
  .logo { width:64px; height:64px; border-radius:18px; background:#000; padding:11px; margin-bottom:22px; }
  .logo svg { width:100%; height:100%; display:block; }
  h1 { font-size:30px; letter-spacing:-.5px; margin:0 0 8px; }
  .lead { color:var(--mut); margin:0 0 32px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:var(--mut); margin:36px 0 12px; font-weight:650; }
  .card { border:1px solid var(--bd); background:var(--sf); border-radius:14px; padding:18px 18px 20px; }
  .card h2 { margin-top:0; }
  label { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; font-weight:650; margin:0 0 6px; }
  .row { margin-bottom:15px; }
  .row:last-child { margin-bottom:0; }
  input, select { width:100%; font:14px/1.4 inherit; color:var(--fg); background:var(--bg);
                  border:1px solid var(--bd); border-radius:9px; padding:9px 11px; outline:0; }
  input:focus, select:focus { border-color:var(--mut); }
  .keyrow { display:flex; gap:7px; }
  .mini { flex:0 0 auto; width:auto; font-size:12.5px; font-weight:600; padding:0 12px; background:var(--bg);
          border:1px solid var(--bd); border-radius:9px; cursor:pointer; color:var(--fg); }
  .mini:hover { border-color:var(--mut); }
  .mini:disabled { opacity:.5; cursor:default; }
  .linkb { font:12px/1 inherit; font-weight:600; color:var(--mut); background:none; border:0; cursor:pointer; text-decoration:underline; padding:0; }
  .linkb:hover { color:var(--fg); }
  .linkb:disabled { opacity:.5; cursor:default; text-decoration:none; }
  .help { font-size:12.5px; color:var(--mut); margin-top:6px; }
  .status { font-size:12.5px; margin-top:14px; padding:10px 12px; border-radius:9px; border:1px solid var(--bd); background:var(--bg); }
  .status.baked { border-color:var(--warn-bd); background:var(--warn-bg); color:var(--warn); }
  .status b { font-weight:650; }
  .drags { display:flex; flex-wrap:wrap; gap:14px 26px; margin:26px 0 4px; align-items:flex-start; }
  .dragwrap { flex:1 1 260px; }
  .drag { display:inline-flex; align-items:center; gap:10px; background:#000; color:#f0efea; padding:13px 22px;
          border-radius:12px; text-decoration:none; font-weight:650; cursor:grab; }
  .drag.alt { background:var(--sf); color:var(--fg); border:1px solid var(--bd); }
  .drag .mk { width:22px; height:22px; border-radius:6px; background:#000; padding:3px; display:inline-flex; flex:0 0 auto; }
  .drag .mk svg { width:100%; height:100%; display:block; }
  .dragnote { font-size:12.5px; color:var(--mut); margin-top:10px; }
  ol { padding-left:20px; } li { margin:7px 0; }
  code { background:var(--sf); border:1px solid var(--bd); border-radius:5px; padding:1px 6px; font-size:13px; }
  textarea { width:100%; height:120px; margin-top:10px; background:var(--sf); color:var(--fg); border:1px solid var(--bd);
             border-radius:10px; padding:12px; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; resize:vertical; }
  .note { color:var(--mut); font-size:13.5px; }
  .hidden { display:none; }
  footer { margin-top:48px; font-size:12.5px; color:var(--mut); }
  footer a { color:inherit; }
</style>
<main>
  <div class="logo">${MARK}</div>
  <h1>Nullsolve</h1>
  <p class="lead">A floating AI panel for any page, with your own Gemini, Claude, GPT or DeepSeek key.
     Drag a button onto your bookmarks bar.</p>

  <div class="card">
    <h2>Choose a provider and bake in your key (optional)</h2>
    <p class="note" style="margin:0 0 16px">Fill these in and the bookmarklet carries them, so the panel is ready on
       every site instead of asking per domain. Leave the key blank for a plain build you configure inside the panel.</p>

    <div class="row">
      <label for="prov">Provider</label>
      <select id="prov"></select>
    </div>

    <div class="row hidden" id="baseRow">
      <label for="base">Endpoint URL</label>
      <input id="base" placeholder="https://openrouter.ai/api/v1" spellcheck="false" autocomplete="off">
      <div class="help">Any OpenAI-compatible base URL with <code>/chat/completions</code> and <code>/models</code> under it.</div>
    </div>

    <div class="row">
      <label for="key">API key</label>
      <div class="keyrow">
        <input id="key" type="password" placeholder="Paste your API key" autocomplete="off" spellcheck="false">
        <button class="mini" id="eye" type="button">Show</button>
      </div>
      <div class="help" id="keyHelp"></div>
    </div>

    <div class="row">
      <label for="model">Model <button class="linkb" id="load" type="button">Load from my key</button></label>
      <select id="model"></select>
      <div class="help" id="modelHelp">Built-in list. Load from your key to see exactly what it can use.</div>
    </div>

    <div class="status" id="status"></div>
  </div>

  <div class="drags">
    <div class="dragwrap">
      <a class="drag" id="drag" href="#" onclick="alert('Drag this button to your bookmarks bar instead of clicking it.');return false;"><span class="mk">${MARK}</span> Nullsolve</a>
      <div class="dragnote" id="dragnote"></div>
    </div>
    ${o.host ? `<div class="dragwrap">
      <a class="drag alt" id="dragLoader" href="#" onclick="alert('Drag this button to your bookmarks bar instead of clicking it.');return false;"><span class="mk">${MARK}</span> Nullsolve (auto-updating)</a>
      <div class="dragnote" id="dragnoteLoader"></div>
    </div>` : ''}
  </div>

  <h2>Setup</h2>
  <ol>
    <li>Show your bookmarks bar (<code>Cmd/Ctrl + Shift + B</code>) and drag a button onto it.</li>
    <li>Open any normal website and click the bookmark.</li>
    <li>Type a message. Your browser asks to share the screen once, then every message carries a fresh screenshot.</li>
  </ol>
  <p class="note">If you did not bake a key in, open the gear and paste one there. Keys entered in the panel are stored
     per site, so a baked-in key saves repeating that on every domain. Requests go straight from your browser to the
     provider you picked; this page talks to no server of its own.</p>

  <h2>Copy the raw bookmarklet</h2>
  <textarea id="raw" readonly onclick="this.select()"></textarea>
  ${o.host ? `<h2>Auto-updating version</h2>
  <p class="note">A ~1 KB bookmarklet that pulls the latest <code>nullsolve.js</code> from <code>${hostNote}</code> each
     time you click it, so updates arrive without re-installing. Sites that block external scripts need the full
     version above.</p>
  <textarea id="rawLoader" readonly onclick="this.select()"></textarea>` : ''}

  <footer>Source and docs on <a href="https://github.com/Boosterfrank/nullsolve">GitHub</a>.</footer>
</main>
<script>
(function () {
  'use strict';
${o.pageLib}

  var PAYLOAD = ${jsString(o.payload)};
  var LOADER = ${jsString(o.host ? loaderSource(o.host) : '')};
  var CLI = ${jsString(JSON.stringify(o.cli))};
  CLI = JSON.parse(CLI);
  var OVERRIDES = window.__NULLSOLVE_ENDPOINTS__ || {};

  PROVIDERS.forEach(function (p) { ensureRecommended(p.fallback, p.score); });

  var $ = function (id) { return document.getElementById(id); };
  var provEl = $('prov'), keyEl = $('key'), baseRow = $('baseRow'), baseEl = $('base'), modelEl = $('model');
  var loadEl = $('load'), helpEl = $('modelHelp'), keyHelpEl = $('keyHelp'), statusEl = $('status');
  var dragEl = $('drag'), noteEl = $('dragnote'), rawEl = $('raw');
  var dragLoaderEl = $('dragLoader'), noteLoaderEl = $('dragnoteLoader'), rawLoaderEl = $('rawLoader');

  var lists = {};
  var typedKeys = {};
  var chosen = {};
  var baseUrl = '';
  var shownProvider = null;

  function cur() { return providerById(provEl.value); }
  function listOf(p) { return lists[p.id] || p.fallback; }

  /* Must match toUrl() in build.js exactly. */
  function toUrl(code) {
    return 'javascript:' + encodeURIComponent(code)
      .replace(/%(${KEEP_RX})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }) + 'void 0;';
  }

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function fillProviders() {
    provEl.innerHTML = PROVIDERS.map(function (p) {
      return option(p.id, p.label, p.id === (CLI.provider || 'gemini'));
    }).join('');
  }

  function fillModels(p) {
    var list = listOf(p);
    var want = chosen[p.id] !== undefined ? chosen[p.id]
      : (CLI.provider === p.id && CLI.model ? CLI.model
      : ((list.filter(function (m) { return m.recommended; })[0] || {}).id || ''));
    var html = option('', 'Use the app default', !want);
    html += list.map(function (m) {
      return option(m.id, m.label + (m.recommended ? ' (recommended)' : ''), m.id === want);
    }).join('');
    if (want && !list.some(function (m) { return m.id === want; })) html += option(want, want, true);
    modelEl.innerHTML = html;
    modelEl.value = want;
  }

  function config() {
    var p = cur();
    var cfg = {};
    if (p.id !== 'gemini') cfg.provider = p.id;
    var key = keyEl.value.trim();
    if (key) { cfg.apiKey = key; cfg.provider = p.id; }
    if (modelEl.value) { cfg.model = modelEl.value; cfg.provider = p.id; }
    if (p.needsBase && baseEl.value.trim()) {
      cfg.baseUrls = { custom: baseEl.value.trim().replace(/\\/+$/, '') };
      cfg.provider = p.id;
    }
    return cfg;
  }

  function update() {
    var p = cur();
    var cfg = config();
    var pre = Object.keys(cfg).length ? 'window.__NULLSOLVE_CONFIG__=' + JSON.stringify(cfg) + ';' : '';
    var url = toUrl(pre + PAYLOAD);
    dragEl.href = url;
    rawEl.value = url;
    var kb = Math.round(url.length / 1024) + ' KB';
    if (LOADER && dragLoaderEl) {
      var lurl = toUrl(pre + LOADER);
      dragLoaderEl.href = lurl;
      rawLoaderEl.value = lurl;
      noteLoaderEl.textContent = 'Loads the newest build each click (' + Math.round(lurl.length / 100) / 10 + ' KB).';
    }
    var key = !!cfg.apiKey, model = cfg.model;
    if (key && model) {
      statusEl.className = 'status baked';
      statusEl.innerHTML = '<b>' + esc(p.short) + ' key and model baked in.</b> This bookmark carries your key in its URL, ' +
        'so anyone who can read your bookmarks can read the key. Do not share it.';
      noteEl.textContent = 'Ready on any site \\u2014 ' + p.short + ' key and ' + model + ' baked in (' + kb + ').';
    } else if (key) {
      statusEl.className = 'status baked';
      statusEl.innerHTML = '<b>' + esc(p.short) + ' key baked in</b>, model left to the app default. Anyone who can read ' +
        'your bookmarks can read the key. Do not share it.';
      noteEl.textContent = p.short + ' key baked in, default model (' + kb + ').';
    } else {
      statusEl.className = 'status';
      statusEl.innerHTML = model
        ? 'Provider <b>' + esc(p.label) + '</b>, model <b>' + esc(model) + '</b>. Add a key above to bake that in too.'
        : (cfg.provider ? 'Provider <b>' + esc(p.label) + '</b> preselected. No key baked in \\u2014 you will paste one into the panel\\u2019s settings, per site.'
                        : 'No key baked in \\u2014 you will paste one into the panel\\u2019s settings, per site.');
      noteEl.textContent = 'Plain build (' + kb + ').';
    }
  }

  function showProvider() {
    var p = cur();
    if (shownProvider && shownProvider !== p) typedKeys[shownProvider.id] = keyEl.value;
    shownProvider = p;
    keyEl.value = typedKeys[p.id] !== undefined ? typedKeys[p.id] : (CLI.provider === p.id ? CLI.key : '');
    keyEl.placeholder = p.keyPlaceholder || 'Paste your API key';
    baseRow.classList.toggle('hidden', !p.needsBase);
    keyHelpEl.innerHTML = p.keyUrl
      ? 'Create one at <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noreferrer">' + esc(p.keyLabel) + '</a>. ' +
        'This page keeps it in memory only; the one request it can make is the model lookup, straight to ' + esc(p.short) + '.'
      : 'Optional. Sent as a Bearer token to the endpoint above.';
    helpEl.textContent = lists[p.id]
      ? lists[p.id].length + ' models available to this key.'
      : (p.fallback.length ? 'Built-in list. Load from your key to see exactly what it can use.' : 'Load the list from the endpoint, or leave the app default.');
    fillModels(p);
    update();
  }

  loadEl.addEventListener('click', function () {
    var p = cur();
    var key = keyEl.value.trim();
    var base = (OVERRIDES[p.id] || (p.needsBase ? baseEl.value.trim() : ENDPOINTS[p.id]) || '').replace(/\\/+$/, '');
    if (p.needsBase && !base) { helpEl.textContent = 'Enter the endpoint URL first.'; baseEl.focus(); return; }
    if (!key && !p.keyOptional) { helpEl.textContent = 'Enter a key first.'; keyEl.focus(); return; }
    loadEl.disabled = true;
    loadEl.textContent = 'Loading\\u2026';
    p.listModels({ key: key, base: base }).then(function (list) {
      lists[p.id] = list;
      if (chosen[p.id] && !list.some(function (m) { return m.id === chosen[p.id]; })) delete chosen[p.id];
      fillModels(p);
      helpEl.textContent = list.length + ' models available to this key.';
      update();
    }).catch(function (e) {
      helpEl.textContent = (e && e.message) ? e.message : String(e);
    }).then(function () {
      loadEl.disabled = false;
      loadEl.textContent = 'Load from my key';
    });
  });

  $('eye').addEventListener('click', function () {
    var shown = keyEl.type === 'text';
    keyEl.type = shown ? 'password' : 'text';
    this.textContent = shown ? 'Show' : 'Hide';
  });

  provEl.addEventListener('change', showProvider);
  keyEl.addEventListener('input', update);
  baseEl.addEventListener('input', update);
  modelEl.addEventListener('change', function () { chosen[cur().id] = modelEl.value; update(); });

  fillProviders();
  showProvider();
})();
</script>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = await build(args);
  const kb = n => (n / 1024).toFixed(1) + ' KB';
  console.log('app (readable) ' + kb(r.debug.length));
  console.log('app (shipped)  ' + kb(r.app.length) + (r.minified ? '  minified with terser' : '  NOT minified: run `npm install` to get terser'));
  console.log('bookmarklet    ' + kb(r.inlineUrl.length) + (Object.keys(r.cfg).length ? '  (baked via CLI)' : ''));
  if (r.loaderUrl) console.log('loader         ' + r.loaderUrl.length + ' bytes');
  console.log('install page   ' + kb(r.page.length));
  const rel = path.relative(process.cwd(), r.outDir) || '.';
  console.log('\nwrote ' + rel + '/{index.html, nullsolve.js, nullsolve.debug.js, nullsolve.bookmarklet.txt' + (r.loaderUrl ? ', nullsolve.loader.txt' : '') + '}');
}

module.exports = { SRC_FILES, PAGE_FILES, read, assemble, wrapIIFE, toUrl, loaderSource, build };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
