/* ------------------------------------------------------------------ dom */

var host = document.createElement('div');
host.id = HOST_ID;
[['all', 'initial'], ['position', 'fixed'], ['top', '0'], ['left', '0'],
 ['width', '0'], ['height', '0'], ['z-index', '2147483647']].forEach(function (pair) {
  host.style.setProperty(pair[0], pair[1], 'important');
});
var root = host.attachShadow({ mode: 'open' });

/* A constructed stylesheet sidesteps CSP rules against inline <style>. */
var adopted = false;
if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in Document.prototype) {
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    adopted = true;
  } catch (e) { adopted = false; }
}
if (!adopted) {
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);
}

var wrap = document.createElement('div');
wrap.className = 'ns';
wrap.innerHTML = [
  '<div class="panel" data-el="panel" role="dialog" aria-label="Nullsolve">',
    '<div class="hd" data-el="hd">',
      '<div class="mark">' + LOGO + '</div>',
      '<div class="title">Nullsolve</div>',
      '<button class="ib" data-act="settings" data-el="gearBtn" title="Settings" aria-label="Settings">' + I.gear + '</button>',
      '<button class="ib" data-act="minimize" title="Minimise" aria-label="Minimise">' + I.min + '</button>',
      '<button class="ib" data-act="close" title="Close" aria-label="Close">' + I.close + '</button>',
    '</div>',

    '<div class="view on" data-view="chat">',
      '<div class="body" data-el="body" aria-live="polite"></div>',
      '<div class="cp">',
        '<div class="chips" data-el="chips"></div>',
        '<div class="inrow" data-el="inrow">',
          '<button class="ib" data-act="attach" title="Attach an image" aria-label="Attach an image">' + I.plus + '</button>',
          '<textarea class="ta" data-el="ta" rows="1" placeholder="Ask Nullsolve" spellcheck="false" aria-label="Message"></textarea>',
          '<button class="ib" data-act="share" data-el="shareBtn" title="Capture your screen with each message" aria-label="Screen capture">' + I.screen + '</button>',
          '<button class="sendb" data-act="send" data-el="sendBtn" title="Send" aria-label="Send">' + I.send + '</button>',
        '</div>',
        '<div class="hint" data-el="hint"></div>',
      '</div>',
    '</div>',

    '<div class="view set" data-view="settings">',
      '<div class="sec">Model</div>',
      '<div class="field">',
        '<label>Provider</label>',
        '<select class="sel" data-el="provider" aria-label="Provider"></select>',
        '<div class="help">Gemini, Claude, GPT and DeepSeek are called straight from this browser with your own key. ',
          'The custom option takes any OpenAI-compatible endpoint: OpenRouter, Groq, xAI, a local server.</div>',
      '</div>',
      '<div class="field hidden" data-el="baseField">',
        '<label>Endpoint URL</label>',
        '<input class="inp" data-el="base" placeholder="https://openrouter.ai/api/v1" spellcheck="false" autocomplete="off">',
        '<div class="help">The base URL that has <b>/chat/completions</b> and <b>/models</b> under it.</div>',
      '</div>',
      '<div class="field">',
        '<label>API key</label>',
        '<div class="keyrow">',
          '<input class="inp" type="password" data-el="key" placeholder="Paste your API key" autocomplete="off" spellcheck="false" aria-label="API key">',
          '<button class="ib sm" data-act="eye" data-el="eye" title="Show key" aria-label="Show key">' + I.eye + '</button>',
        '</div>',
        '<div class="help" data-el="keyHelp"></div>',
      '</div>',
      '<div class="field">',
        '<label>Model <button class="linkb" data-act="refresh" data-el="refresh">Refresh list</button></label>',
        '<select class="sel" data-el="model" aria-label="Model"></select>',
        '<input class="inp hidden mt6" data-el="modelCustom" placeholder="Model id" spellcheck="false" autocomplete="off">',
        '<div class="help" data-el="modelHelp"></div>',
      '</div>',
      '<div class="field">',
        '<label>Speed</label>',
        '<div class="seg" data-el="reasonSeg">',
          '<button data-reason-val="fast">Fast</button>',
          '<button data-reason-val="default">Default</button>',
          '<button data-reason-val="deep">Deep</button>',
        '</div>',
        '<div class="help"><b>Fast</b> asks the model for minimal reasoning so replies start sooner; <b>Deep</b> asks for ',
          'the most. A model that takes neither setting is used as it comes.</div>',
      '</div>',

      '<div class="sec">Behaviour</div>',
      '<div class="field">',
        '<label>Page control</label>',
        '<div class="seg" data-el="ctrlSeg">',
          '<button data-ctrl-val="off">Off</button>',
          '<button data-ctrl-val="ask">Ask first</button>',
          '<button data-ctrl-val="auto">Auto</button>',
        '</div>',
        '<div class="help">Lets the model click, type, and scroll on the page it is looking at. ',
          '<b>Ask first</b> confirms every action. <b>Auto</b> runs low-risk ones on its own and still asks before ',
          'anything that submits, deletes, buys, or leaves the site. Password and payment fields are never filled. ',
          'A hostile page can try to mislead the model, so leave this off on sites you do not trust.</div>',
      '</div>',
      '<div class="field">',
        '<label>Screenshots</label>',
        '<div class="seg" data-el="shotSeg">',
          '<button data-shot-val="1">Every message</button>',
          '<button data-shot-val="0">Only when I ask</button>',
        '</div>',
        '<div class="help">Your browser asks permission once, then every message carries a fresh screenshot. ',
          'Stop any time from the screen icon in the composer or your browser’s own sharing bar.</div>',
        '<label class="chk"><input type="checkbox" data-el="hideChk"> Hide the panel while the screenshot is taken</label>',
      '</div>',
      '<div class="field">',
        '<label>System prompt</label>',
        '<textarea class="tar" data-el="sys" spellcheck="false" aria-label="System prompt"></textarea>',
      '</div>',

      '<div class="sec">Appearance</div>',
      '<div class="field">',
        '<div class="seg" data-el="themeSeg">',
          '<button data-theme-val="default">Default</button>',
          '<button data-theme-val="light">Light</button>',
          '<button data-theme-val="dark">Dark</button>',
        '</div>',
        '<div class="help">Default follows your system light or dark setting.</div>',
      '</div>',

      '<div class="foot">',
        '<button class="btn" data-act="clearChat">Clear chat</button>',
        '<button class="btn danger" data-act="reset">Reset</button>',
        '<button class="btn primary" data-act="save">Save</button>',
      '</div>',
      '<div class="note" data-el="note"></div>',
    '</div>',
    '<div class="rs" data-el="rs" title="Resize"></div>',
  '</div>',
  '<button class="dot" data-el="dot" title="Nullsolve" aria-label="Open Nullsolve"><span class="badge"></span>' + LOGO + '</button>',
  '<input type="file" accept="image/*" multiple data-el="file" class="hidden">',
  '<video class="vid" data-el="vid" muted playsinline autoplay></video>',
  '<div class="lb" data-el="lb"><img alt=""></div>'
].join('');
root.appendChild(wrap);
(document.body || document.documentElement).appendChild(host);

var el = {};
Array.prototype.forEach.call(root.querySelectorAll('[data-el]'), function (n) {
  el[n.getAttribute('data-el')] = n;
});

function $$(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

/* --------------------------------------------------------- theme + size */

function applySeg(attr, value) {
  $$('[' + attr + ']').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute(attr) === String(value));
  });
}

function applySegs() {
  applySeg('data-theme-val', settings.theme);
  applySeg('data-ctrl-val', settings.control || 'off');
  applySeg('data-shot-val', settings.autoShot ? '1' : '0');
  applySeg('data-reason-val', settings.reasoning || 'default');
}

function applyTheme() {
  wrap.setAttribute('data-theme', settings.theme === 'default' ? 'auto' : settings.theme);
  applySeg('data-theme-val', settings.theme);
}

function viewport() {
  return { w: Math.max(240, window.innerWidth || 0), h: Math.max(240, window.innerHeight || 0) };
}

/* Renders the stored box, clamped to the viewport as it is right now. Never
   writes the clamped values back: a transient small window must not shrink
   the panel permanently. Only commitPanelBox stores a new box. */
function applyPanelBox() {
  var p = settings.panel || {};
  var v = viewport();
  var w = clamp(p.w || 400, 320, Math.max(320, v.w - 16));
  var h = clamp(p.h || 600, 340, Math.max(340, v.h - 16));
  var x = p.x == null ? v.w - w - 24 : p.x;
  var y = p.y == null ? v.h - h - 24 : p.y;
  el.panel.style.width = w + 'px';
  el.panel.style.height = h + 'px';
  el.panel.style.left = clamp(x, 60 - w, v.w - 60) + 'px';
  el.panel.style.top = clamp(y, 4, Math.max(4, v.h - 44)) + 'px';
}

function commitPanelBox() {
  settings.panel = {
    w: el.panel.offsetWidth,
    h: el.panel.offsetHeight,
    x: parseFloat(el.panel.style.left) || 0,
    y: parseFloat(el.panel.style.top) || 0
  };
  applyPanelBox();
  saveSettings();
}

function applyDotBox() {
  var d = settings.dot || {};
  var v = viewport();
  var x = d.x == null ? v.w - 54 - 24 : d.x;
  var y = d.y == null ? v.h - 54 - 24 : d.y;
  el.dot.style.left = clamp(x, 4, Math.max(4, v.w - 58)) + 'px';
  el.dot.style.top = clamp(y, 4, Math.max(4, v.h - 58)) + 'px';
}

function commitDotBox() {
  settings.dot = { x: parseFloat(el.dot.style.left) || 0, y: parseFloat(el.dot.style.top) || 0 };
  applyDotBox();
  saveSettings();
}

function setMinimized(min) {
  settings.minimized = !!min;
  el.panel.hidden = !!min;
  el.dot.classList.toggle('on', !!min);
  if (!min) { applyPanelBox(); setTimeout(function () { try { el.ta.focus(); } catch (e) { } }, 30); }
  else applyDotBox();
  saveSettings();
}

function setView(v) {
  state.view = v;
  $$('[data-view]').forEach(function (n) { n.classList.toggle('on', n.getAttribute('data-view') === v); });
  el.gearBtn.innerHTML = v === 'settings' ? I.back : I.gear;
  el.gearBtn.title = v === 'settings' ? 'Back to chat' : 'Settings';
  if (v === 'settings') fillSettings();
  else scrollBottom(true);
}

/* ------------------------------------------------------------ rendering */

function scrollBottom(force) {
  var b = el.body;
  if (!force && b.scrollHeight - b.scrollTop - b.clientHeight > 140) return;
  b.scrollTop = b.scrollHeight;
}

var STARTERS = ['What is on my screen?', 'Summarise this page', 'Explain this error'];

function renderEmpty() {
  var p = curProvider();
  var ready = providerReady(p.id);
  var vision = ready && modelVision(p.id, modelFor(p.id));
  var needBase = p.needsBase && !baseFor(p.id);
  var title = ready ? 'Ask me anything' : (needBase ? 'Add an endpoint to start' : 'Add an API key to start');
  var text = ready
    ? (vision ? 'Every message can carry a screenshot, so I can see exactly what you see.'
              : esc(p.short) + ' models cannot see images, so screenshots stay off here.')
    : (needBase ? 'Open Settings and enter the URL of your OpenAI-compatible endpoint.'
                : 'Open Settings and paste ' + (/^[aeiou]/i.test(p.short) ? 'an ' : 'a ') + esc(p.short) + ' API key. It stays in this browser.');
  return '<div class="empty">' +
    '<div class="bigmark">' + LOGO + '</div>' +
    '<h3>' + title + '</h3>' +
    '<p>' + text + '</p>' +
    (ready
      ? '<div class="starters">' + STARTERS.map(function (s) {
          return '<button class="starter" data-starter="' + esc(s) + '">' + esc(s) + '</button>';
        }).join('') + '</div>'
      : '<div class="starters"><button class="starter" data-act="settings">Open settings</button></div>') +
    '</div>';
}

var nodes = {};

function isBotMsg(m) { return m && m.role === 'assistant' && !m.error; }

/* The previous visible message: tool turns render nothing, so they are
   skipped when deciding whether a reply continues the one above it. */
function prevMessage(m) {
  var i = state.messages.indexOf(m) - 1;
  while (i >= 0 && state.messages[i].role === 'tool') i--;
  return i >= 0 ? state.messages[i] : null;
}

function thumbsHtml(m) {
  var list = (m.shot ? [m.shot] : []).concat(m.images || []);
  if (list.length) {
    return '<div class="shots">' + list.map(function (src) {
      return '<img src="' + esc(src) + '" alt="attachment" data-zoom="' + esc(src) + '">';
    }).join('') + '</div>';
  }
  if (m.shots) {
    return '<div class="shots"><span class="chip">' + m.shots + ' image' + (m.shots > 1 ? 's' : '') + '</span></div>';
  }
  return '';
}

function callsHtml(calls) {
  if (!calls || !calls.length) return '';
  return calls.map(function (c) {
    var r = c.result;
    var cls = !r ? 'run' : (r.error ? 'bad' : 'ok');
    var note = !r ? 'running' : (r.error ? r.error : 'done');
    return '<div class="arow ' + cls + '"><span class="adot"></span>' +
      '<span class="atxt">' + esc(c.desc || c.name) + '</span>' +
      '<span class="anote">' + esc(String(note).slice(0, 90)) + '</span></div>';
  }).join('');
}

function thinkHtml(m) {
  if (!m.reasoning) return '';
  var open = m.live && !m.text;
  return '<details class="think" data-think' + (open ? ' open' : '') + '>' +
    '<summary>' + I.chev + (m.live && !m.text ? 'Thinking…' : 'Thought process') + '</summary>' +
    '<div class="thinkbody" data-thinkbody>' + esc(m.reasoning) + '</div></details>';
}

function metaText(m) {
  var bits = [];
  if (m.model) bits.push(m.model);
  if (m.ms) bits.push((m.ms / 1000).toFixed(1) + 's');
  return bits.join(' · ');
}

function bodyHtml(m) {
  if (m.text) return mdToHtml(m.text);
  if (m.live && !m.reasoning && !(m.calls && m.calls.length)) return '<span class="dots"><i></i><i></i><i></i></span>';
  return '';
}

function msgNode(m) {
  var d = document.createElement('div');
  d.setAttribute('data-id', String(m.id));
  if (m.role === 'tool') { d.hidden = true; return d; }

  if (m.error) {
    d.className = 'msg err';
    d.innerHTML = '<div class="errrow"><div class="errtxt">' + esc(m.text) + '</div>' +
      (m.retry ? '<button class="btn sm" data-act="retry">Retry</button>' : '') + '</div>';
    return d;
  }

  if (m.role === 'user') {
    d.className = 'msg user';
    d.innerHTML = thumbsHtml(m) + '<div class="md">' + mdToHtml(m.text) + '</div>';
    return d;
  }

  d.className = 'msg bot' + (isBotMsg(prevMessage(m)) ? ' cont' : '');
  d.innerHTML = '<div class="botrow">' +
    '<div class="botmark">' + LOGO + '</div>' +
    '<div class="botbody">' +
      thinkHtml(m) +
      '<div class="md" data-md>' + bodyHtml(m) + '</div>' +
      '<div class="alog' + (m.calls && m.calls.length ? '' : ' hidden') + '" data-log>' + callsHtml(m.calls) + '</div>' +
      '<div class="acts"><button class="ib sm" data-act="copy" title="Copy" aria-label="Copy reply">' + I.copy + '</button>' +
      '<span class="meta" data-meta>' + esc(metaText(m)) + '</span></div>' +
    '</div>' +
  '</div>';
  return d;
}

function renderMessages() {
  el.body.innerHTML = '';
  nodes = {};
  if (!state.messages.length) { el.body.innerHTML = renderEmpty(); return; }
  state.messages.forEach(function (m) {
    var n = msgNode(m);
    nodes[m.id] = n;
    el.body.appendChild(n);
  });
  scrollBottom(true);
}

function appendMessage(m) {
  if (el.body.querySelector('.empty')) el.body.innerHTML = '';
  var n = msgNode(m);
  nodes[m.id] = n;
  el.body.appendChild(n);
  scrollBottom(true);
}

function patchMessage(m) {
  var old = nodes[m.id];
  var n = msgNode(m);
  nodes[m.id] = n;
  if (old && old.parentNode) old.parentNode.replaceChild(n, old);
  else appendMessage(m);
  scrollBottom(false);
}

function dropMessageNode(m) {
  var n = nodes[m.id];
  if (n && n.parentNode) n.parentNode.removeChild(n);
  delete nodes[m.id];
}

/* Streaming updates are coalesced to one DOM write per animation frame. */
var paintQueued = null;
function schedulePaint(m) {
  if (paintQueued) return;
  paintQueued = m;
  var raf = window.requestAnimationFrame || function (f) { setTimeout(f, 16); };
  raf(function () {
    var target = paintQueued;
    paintQueued = null;
    if (target) paintStream(target);
  });
}

function paintStream(m) {
  var n = nodes[m.id];
  if (!n) return;
  if (m.reasoning && !n.querySelector('[data-think]')) { patchMessage(m); return; }
  var tb = n.querySelector('[data-thinkbody]');
  if (tb) {
    tb.textContent = m.reasoning;
    var det = n.querySelector('[data-think]');
    var sum = det.querySelector('summary');
    if (m.text && det.open && !m.thinkClosed) { det.open = false; m.thinkClosed = true; }
    sum.innerHTML = I.chev + (m.live && !m.text ? 'Thinking…' : 'Thought process');
    if (det.open) tb.scrollTop = tb.scrollHeight;
  }
  var md = n.querySelector('[data-md]');
  if (md) md.innerHTML = bodyHtml(m);
  scrollBottom(false);
}

function renderChips() {
  var html = '';
  if (state.sharing) {
    var what = { browser: 'this tab', window: 'a window', monitor: 'the screen' }[state.surface] || 'the screen';
    html += '<span class="chip live"><span class="pulse"></span><b>Screenshot</b> of ' + what + ' each message' +
      ' <span class="x" data-act="share" title="Stop capturing">&#10005;</span></span>';
  }
  state.pending.forEach(function (src, i) {
    html += '<span class="chip"><img src="' + esc(src) + '" alt="">Image ' + (i + 1) +
      ' <span class="x" data-drop="' + i + '" title="Remove">&#10005;</span></span>';
  });
  el.chips.innerHTML = html;
}

function renderHint(msg) {
  if (msg) { el.hint.innerHTML = msg; return; }
  var p = curProvider();
  if (!providerReady(p.id)) {
    el.hint.innerHTML = (p.needsBase && !baseFor(p.id) ? 'No endpoint yet' : 'No API key yet') +
      ' &middot; <a data-act="settings">open settings</a>';
    return;
  }
  var model = modelFor(p.id);
  var suffix = '';
  if (controlOn()) suffix += ' &middot; can act on this page';
  if (!modelVision(p.id, model)) suffix += ' &middot; no images';
  else if (state.sharing) suffix += ' &middot; screenshots on';
  else if (settings.autoShot && !state.captureOff) suffix += ' &middot; screenshot on send';
  else if (settings.autoShot) suffix += ' &middot; screenshots off';
  if (settings.reasoning === 'fast') suffix += ' &middot; fast';
  else if (settings.reasoning === 'deep') suffix += ' &middot; deep';
  el.hint.innerHTML = '<b>' + esc(modelLabel(p.id, model)) + '</b> &middot; ' + esc(p.short) + suffix;
}

/* --------------------------------------------------------- screen share */

function waitForFrame(timeoutMs) {
  return new Promise(function (resolve) {
    var started = Date.now();
    (function poll() {
      if (el.vid.videoWidth && el.vid.readyState >= 2) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(poll, 40);
    })();
  });
}

/* Resolves once the capture has produced a frame painted after now: one
   fresh frame plus a short grace, or two frames, whichever comes first. A
   tab capture only emits frames when the tab changes, which hiding the
   panel guarantees; the timeout covers everything else. */
function nextVideoFrames(v, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false, got = 0;
    var timer = setTimeout(finish, timeoutMs);
    function finish() { if (done) return; done = true; clearTimeout(timer); resolve(got); }
    if (typeof v.requestVideoFrameCallback !== 'function') { setTimeout(finish, Math.min(timeoutMs, 250)); return; }
    (function tick() {
      v.requestVideoFrameCallback(function () {
        got++;
        if (got >= 2) return finish();
        setTimeout(finish, 120);
        tick();
      });
    })();
  });
}

/* Opens a capture stream. The browser shows its picker once; after that the
   stream stays live and every send grabs a frame from it silently. */
async function startCapture() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    state.captureOff = true;
    renderHint('Screen capture is not available on this page.');
    return false;
  }
  try {
    var stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 8, max: 15 } },
      audio: false,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include'
    });
    state.stream = stream;
    state.captureOff = false;
    state.sharing = true;
    var track = stream.getVideoTracks()[0];
    try { state.surface = (track && track.getSettings && track.getSettings().displaySurface) || ''; } catch (e) { state.surface = ''; }
    el.vid.srcObject = stream;
    var playing = el.vid.play();
    if (playing && playing.catch) playing.catch(function () { });
    if (track) track.addEventListener('ended', function () { stopCapture(); });
    el.shareBtn.classList.add('on');
    el.shareBtn.title = 'Stop capturing your screen';
    renderChips();
    renderHint();
    await waitForFrame(1500);
    return true;
  } catch (e) {
    state.captureOff = true;
    renderChips();
    if (e && e.name === 'NotAllowedError') {
      renderHint('Screenshot skipped &middot; <a data-act="share">turn capture back on</a>');
    } else {
      renderHint('Could not capture the screen: ' + esc(errText(e)));
    }
    return false;
  }
}

/* Stopping is always deliberate, so it also suppresses the automatic
   re-prompt on the next send until capture is turned back on. */
function stopCapture() {
  if (state.stream) {
    state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
  }
  state.stream = null;
  state.sharing = false;
  state.surface = '';
  state.captureOff = true;
  try { el.vid.srcObject = null; } catch (e) { }
  el.shareBtn.classList.remove('on');
  el.shareBtn.title = 'Capture your screen with each message';
  renderChips();
  renderHint();
}

function toggleCapture() {
  if (state.sharing) { stopCapture(); return; }
  state.captureOff = false;
  startCapture();
}

function drawFrame(v, maxWidth) {
  var scale = Math.min(1, (maxWidth || 1280) / v.videoWidth);
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(v.videoWidth * scale));
  c.height = Math.max(1, Math.round(v.videoHeight * scale));
  try {
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch (e) { return null; }
}

/* Grabs one frame, with the panel hidden for the moment of capture so the
   model sees the page rather than its own chat. */
async function grabFrame(maxWidth) {
  var v = el.vid;
  if (!v || !v.videoWidth || !v.videoHeight) return null;
  var hide = settings.hideInShot !== false && !state.hiding;
  if (hide) {
    state.hiding = true;
    wrap.classList.add('shy');
    try { await nextVideoFrames(v, 450); } catch (e) { }
  }
  var url = drawFrame(v, maxWidth);
  if (hide) {
    wrap.classList.remove('shy');
    state.hiding = false;
  }
  return url;
}

function downscaleImage(dataUrl, maxWidth) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, maxWidth / img.width);
      if (scale >= 1 && dataUrl.length < 900000) { resolve(dataUrl); return; }
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/jpeg', 0.8)); } catch (e) { resolve(dataUrl); }
    };
    img.onerror = function () { resolve(dataUrl); };
    img.src = dataUrl;
  });
}

function addFiles(files) {
  var room = Math.max(0, 4 - state.pending.length);
  Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); }).slice(0, room).forEach(function (f) {
    var fr = new FileReader();
    fr.onload = function () {
      downscaleImage(String(fr.result), 1280).then(function (d) {
        state.pending.push(d);
        renderChips();
      });
    };
    fr.readAsDataURL(f);
  });
  if (!modelVision(settings.provider, modelFor(settings.provider))) {
    renderHint(esc(curProvider().short) + ' models cannot see images; attachments will be left out.');
  }
}
