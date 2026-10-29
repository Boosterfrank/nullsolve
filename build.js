#!/usr/bin/env node
'use strict';

/*
 * Builds the Nullsolve bookmarklet.
 *
 *   node build.js                       plain build
 *   node build.js --key=AIza... --model=gemini-2.5-flash
 *                                       bakes defaults into dist/*.txt and
 *                                       prefills the install page
 *   node build.js --host=https://example.com/nullsolve.js
 *                                       also emits a small loader bookmarklet
 *
 * dist/index.html can bake a key in on its own, in the browser, with no rebuild.
 */

const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const SRC = path.join(__dirname, 'src', 'nullsolve.js');
const OUT = path.join(__dirname, 'dist');

/* Conservative line-based comment/indent stripper. Newlines are preserved so
   automatic semicolon insertion behaves exactly as in the original source. */
function strip(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//')) continue;
    if (!line) continue;
    out.push(line);
  }
  return out.join('\n');
}

/* encodeURIComponent, then put back the characters that are safe inside a
   javascript: URL. Mirrored byte for byte by the copy in the install page. */
const KEEP_RX = '20|22|24|26|2C|2F|3A|3B|3C|3D|3E|3F|40|5B|5D|5E|60|7B|7C|7D';
function toUrl(code) {
  const enc = encodeURIComponent(code)
    .replace(new RegExp('%(' + KEEP_RX + ')', 'g'),
      (m, h) => String.fromCharCode(parseInt(h, 16)));
  return 'javascript:' + enc + 'void 0;';
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Safe to drop inside a <script> block. */
function jsString(s) {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const raw = fs.readFileSync(SRC, 'utf8');
const stripped = strip(raw);

/* Fail loudly rather than shipping a broken bookmarklet. */
new Function(stripped);

/* One source of truth for the model list: lift it out of the app. */
const modelsMatch = /var FALLBACK_MODELS = (\[[\s\S]*?\n\s*\]);/.exec(raw);
if (!modelsMatch) throw new Error('could not find FALLBACK_MODELS in ' + SRC);
const fallbackModels = new Function('return ' + modelsMatch[1])();

const cliKey = typeof args.key === 'string' ? args.key : '';
const cliModel = typeof args.model === 'string' ? args.model : '';

const config = {};
if (cliKey) config.apiKey = cliKey;
if (cliModel) config.model = cliModel;
const prelude = Object.keys(config).length
  ? 'window.__NULLSOLVE_CONFIG__=' + JSON.stringify(config) + ';'
  : '';

const inlineUrl = toUrl(prelude + stripped);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'nullsolve.js'), stripped);
fs.writeFileSync(path.join(OUT, 'nullsolve.bookmarklet.txt'), inlineUrl);

let loaderUrl = '';
if (typeof args.host === 'string' && args.host) {
  const loader = prelude +
    "(function(){var s=document.createElement('script');" +
    "s.src=" + JSON.stringify(args.host) + "+'?t='+Date.now();" +
    "document.documentElement.appendChild(s);})();";
  loaderUrl = toUrl(loader);
  fs.writeFileSync(path.join(OUT, 'nullsolve.loader.txt'), loaderUrl);
}

const MARK = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="29" y="19" width="42" height="62" rx="21" fill="#F0EFEA"/><rect x="40.5" y="30.5" width="19" height="39" rx="9.5" fill="#000"/></svg>';

const page = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nullsolve — install</title>
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
  main { max-width:660px; margin:0 auto; }
  .logo { width:64px; height:64px; border-radius:18px; background:#000; padding:11px; margin-bottom:22px; }
  .logo svg { width:100%; height:100%; display:block; }
  h1 { font-size:30px; letter-spacing:-.5px; margin:0 0 8px; }
  .lead { color:var(--mut); margin:0 0 32px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:var(--mut);
       margin:36px 0 12px; font-weight:650; }
  .card { border:1px solid var(--bd); background:var(--sf); border-radius:14px; padding:18px 18px 20px; }
  .card h2 { margin-top:0; }
  label { display:flex; align-items:center; justify-content:space-between; gap:10px;
          font-size:13px; font-weight:650; margin:0 0 6px; }
  .row { margin-bottom:15px; }
  .row:last-child { margin-bottom:0; }
  input, select { width:100%; font:14px/1.4 inherit; color:var(--fg); background:var(--bg);
                  border:1px solid var(--bd); border-radius:9px; padding:9px 11px; outline:0; }
  input:focus, select:focus { border-color:var(--mut); }
  .keyrow { display:flex; gap:7px; }
  .mini { flex:0 0 auto; width:auto; font-size:12.5px; font-weight:600; padding:0 12px;
          background:var(--bg); border:1px solid var(--bd); border-radius:9px; cursor:pointer; color:var(--fg); }
  .mini:hover { border-color:var(--mut); }
  .mini:disabled { opacity:.5; cursor:default; }
  .linkb { font:12px/1 inherit; font-weight:600; color:var(--mut); background:none; border:0;
           cursor:pointer; text-decoration:underline; padding:0; }
  .linkb:hover { color:var(--fg); }
  .linkb:disabled { opacity:.5; cursor:default; text-decoration:none; }
  .help { font-size:12.5px; color:var(--mut); margin-top:6px; }
  .status { font-size:12.5px; margin-top:14px; padding:10px 12px; border-radius:9px;
            border:1px solid var(--bd); background:var(--bg); }
  .status.baked { border-color:var(--warn-bd); background:var(--warn-bg); color:var(--warn); }
  .status b { font-weight:650; }
  .dragwrap { margin:26px 0 4px; }
  .drag { display:inline-flex; align-items:center; gap:10px; background:#000; color:#f0efea;
          padding:13px 22px; border-radius:12px; text-decoration:none; font-weight:650; cursor:grab; }
  .drag svg { width:20px; height:20px; }
  .dragnote { font-size:12.5px; color:var(--mut); margin-top:10px; }
  ol { padding-left:20px; } li { margin:7px 0; }
  code { background:var(--sf); border:1px solid var(--bd); border-radius:5px; padding:1px 6px; font-size:13px; }
  textarea { width:100%; height:120px; margin-top:10px; background:var(--sf); color:var(--fg);
             border:1px solid var(--bd); border-radius:10px; padding:12px;
             font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; resize:vertical; }
  .note { color:var(--mut); font-size:13.5px; }
</style>
<main>
  <div class="logo">${MARK}</div>
  <h1>Nullsolve</h1>
  <p class="lead">A floating AI panel for any page. Drag the button onto your bookmarks bar.</p>

  <div class="card">
    <h2>Bake in your key (optional)</h2>
    <p class="note" style="margin:0 0 16px">Fill these in and the bookmarklet carries them, so the
       panel is ready on every site instead of asking per domain. Leave them blank for a plain
       build you configure inside the panel.</p>

    <div class="row">
      <label for="key">Gemini API key</label>
      <div class="keyrow">
        <input id="key" type="password" placeholder="Paste your API key" autocomplete="off" spellcheck="false" value="${escAttr(cliKey)}">
        <button class="mini" id="eye" type="button">Show</button>
      </div>
      <div class="help">Create one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.</div>
    </div>

    <div class="row">
      <label for="model">Model <button class="linkb" id="load" type="button">Load from my key</button></label>
      <select id="model"></select>
      <div class="help" id="modelHelp">Built-in list. Load from your key to see exactly what it can use.</div>
    </div>

    <div class="status" id="status"></div>
  </div>

  <div class="dragwrap">
    <a class="drag" id="drag" href="#" onclick="alert('Drag this button to your bookmarks bar instead of clicking it.');return false;">
      ${MARK} Nullsolve
    </a>
    <div class="dragnote" id="dragnote"></div>
  </div>

  <h2>Setup</h2>
  <ol>
    <li>Show your bookmarks bar (<code>Cmd/Ctrl + Shift + B</code>) and drag the button onto it.</li>
    <li>Open any normal website and click the bookmark.</li>
    <li>Type a message. Your browser asks to share the screen once, then every message
        carries a fresh screenshot.</li>
  </ol>
  <p class="note">If you did not bake a key in, open the gear and paste one there. Keys entered in
     the panel are stored per site, so a baked-in key saves repeating that on every domain.
     Requests go straight from your browser to Google.</p>

  <h2>Copy the raw bookmarklet</h2>
  <textarea id="raw" readonly onclick="this.select()"></textarea>
  ${loaderUrl ? `<h2>Loader version</h2>
  <p class="note">Tiny bookmarklet that pulls the script from <code>${escAttr(String(args.host))}</code> each time.
     Built with the <code>--key</code> flag you passed, not the fields above.</p>
  <textarea readonly onclick="this.select()">${escAttr(loaderUrl)}</textarea>` : ''}
</main>
<script>
(function () {
  'use strict';

  var PAYLOAD = ${jsString(stripped)};
  var MODELS = ${jsString(JSON.stringify(fallbackModels))};
  MODELS = JSON.parse(MODELS);
  var CLI_MODEL = ${jsString(cliModel)};

  var keyEl = document.getElementById('key');
  var modelEl = document.getElementById('model');
  var dragEl = document.getElementById('drag');
  var rawEl = document.getElementById('raw');
  var statusEl = document.getElementById('status');
  var noteEl = document.getElementById('dragnote');
  var helpEl = document.getElementById('modelHelp');
  var loadEl = document.getElementById('load');

  /* Must match toUrl() in build.js exactly. */
  function toUrl(code) {
    return 'javascript:' + encodeURIComponent(code)
      .replace(/%(${KEEP_RX})/g, function (m, h) {
        return String.fromCharCode(parseInt(h, 16));
      }) + 'void 0;';
  }

  function fillModels(list, selected) {
    modelEl.innerHTML = '<option value="">Use the app default</option>' +
      list.map(function (m) {
        return '<option value="' + m.id.replace(/"/g, '&quot;') + '">' +
          m.label + (m.recommended ? ' (recommended)' : '') + '</option>';
      }).join('');
    var want = selected || CLI_MODEL ||
      (list.filter(function (m) { return m.recommended; })[0] || {}).id || '';
    modelEl.value = want;
    if (modelEl.value !== want) {
      modelEl.insertAdjacentHTML('beforeend',
        '<option value="' + want.replace(/"/g, '&quot;') + '">' + want + '</option>');
      modelEl.value = want;
    }
  }

  function update() {
    var key = keyEl.value.trim();
    var model = modelEl.value;
    var cfg = {};
    if (key) cfg.apiKey = key;
    if (model) cfg.model = model;

    var baked = Object.keys(cfg).length
      ? 'window.__NULLSOLVE_CONFIG__=' + JSON.stringify(cfg) + ';'
      : '';
    var url = toUrl(baked + PAYLOAD);
    dragEl.href = url;
    rawEl.value = url;

    var kb = Math.round(url.length / 1024) + ' KB';
    if (key && model) {
      statusEl.className = 'status baked';
      statusEl.innerHTML = '<b>Key and model baked in.</b> This bookmark carries your key in its ' +
        'URL, so anyone who can read your bookmarks can read the key. Do not share it.';
      noteEl.textContent = 'Ready to use on any site — key and ' + model + ' baked in (' + kb + ').';
    } else if (key) {
      statusEl.className = 'status baked';
      statusEl.innerHTML = '<b>Key baked in</b>, model left to the app default. Anyone who can ' +
        'read your bookmarks can read the key. Do not share it.';
      noteEl.textContent = 'Key baked in, default model (' + kb + ').';
    } else {
      statusEl.className = 'status';
      statusEl.innerHTML = model
        ? 'Model set to <b>' + model + '</b>. Add a key above to bake that in too.'
        : 'No key baked in — you will paste one into the panel\\u2019s settings, per site.';
      noteEl.textContent = 'Plain build (' + kb + ').';
    }
  }

  function versionOf(id) {
    var m = /gemini-(\\d+(?:\\.\\d+)?)/.exec(id);
    return m ? parseFloat(m[1]) : 0;
  }
  function scoreFlash(id) {
    if (!/flash/.test(id)) return -1;
    if (/(lite|image|audio|tts|live|embedding|vision|thinking|8b)/.test(id)) return -1;
    var s = versionOf(id) * 100;
    if (/-latest$/.test(id)) s += 40;
    if (/(preview|exp)/.test(id)) s -= 8;
    return s;
  }

  loadEl.addEventListener('click', function () {
    var key = keyEl.value.trim();
    if (!key) { helpEl.textContent = 'Enter a key first.'; keyEl.focus(); return; }
    loadEl.disabled = true;
    loadEl.textContent = 'Loading\\u2026';
    fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key }
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) {
          var msg = '';
          try { msg = (JSON.parse(t).error || {}).message || ''; } catch (e) {}
          throw new Error(msg || ('HTTP ' + res.status));
        }
        return JSON.parse(t);
      });
    }).then(function (data) {
      var list = (data.models || []).filter(function (m) {
        var methods = m.supportedGenerationMethods || [];
        return methods.indexOf('generateContent') >= 0 && !/embedding|aqa|imagen|veo/.test(m.name || '');
      }).map(function (m) {
        return { id: String(m.name).replace(/^models\\//, ''), label: m.displayName || String(m.name).replace(/^models\\//, '') };
      });
      if (!list.length) throw new Error('That key returned no usable models.');
      list.sort(function (a, b) { return versionOf(b.id) - versionOf(a.id) || a.id.localeCompare(b.id); });
      var best = null, bestScore = 0;
      list.forEach(function (m) {
        var sc = scoreFlash(m.id);
        if (sc > bestScore) { bestScore = sc; best = m; }
      });
      if (best) best.recommended = true;
      var keep = modelEl.value;
      fillModels(list, list.some(function (m) { return m.id === keep; }) ? keep : null);
      helpEl.textContent = list.length + ' models available to this key.';
      update();
    }).catch(function (e) {
      helpEl.textContent = e.message;
    }).then(function () {
      loadEl.disabled = false;
      loadEl.textContent = 'Load from my key';
    });
  });

  document.getElementById('eye').addEventListener('click', function () {
    var shown = keyEl.type === 'text';
    keyEl.type = shown ? 'password' : 'text';
    this.textContent = shown ? 'Show' : 'Hide';
  });

  keyEl.addEventListener('input', update);
  modelEl.addEventListener('change', update);

  fillModels(MODELS, CLI_MODEL || null);
  update();
})();
</script>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), page);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('source      ' + kb(raw.length));
console.log('stripped    ' + kb(stripped.length));
console.log('bookmarklet ' + kb(inlineUrl.length) + (prelude ? '  (baked via CLI)' : ''));
console.log('install pg  ' + kb(page.length) + '  (' + fallbackModels.length + ' built-in models)');
if (loaderUrl) console.log('loader      ' + loaderUrl.length + ' bytes');
console.log('\nwrote dist/index.html, dist/nullsolve.bookmarklet.txt, dist/nullsolve.js');
