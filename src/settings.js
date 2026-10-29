/* ------------------------------------------------- settings and state
   Settings live in localStorage (per origin) under a v2 key; a v1 blob from
   the Gemini-only release is migrated on first run so nobody loses a key. */

var LS_SETTINGS = 'nullsolve.settings.v2';
var LS_SETTINGS_V1 = 'nullsolve.settings.v1';
var LS_CHAT = 'nullsolve.chat.v2';
var LS_CHAT_V1 = 'nullsolve.chat.v1';

var DEFAULT_SYSTEM = 'You are Nullsolve, a concise assistant in a small floating panel on top of whatever page the user is looking at. Messages often arrive with a screenshot of the user’s screen: read it carefully and answer about what is actually visible. If the question is not about the screen, just answer it. Prefer short, direct answers, and use markdown (lists, tables, code blocks) only when it makes the answer clearer.';

/* Older default prompts are swapped for the current one on load, so prompt
   improvements reach existing installs; a prompt the user edited is kept. */
var LEGACY_SYSTEMS = [
  'You are Nullsolve, a concise assistant embedded in a floating panel on top of whatever page the user is looking at. Messages usually arrive with a screenshot of the user’s screen attached: read it carefully and answer about what is actually visible. Prefer short, direct answers. You have the ability to use markdown (including tables) when it makes the answer clearer.'
];

var DEFAULTS = {
  theme: 'default',
  provider: 'gemini',
  keys: {},
  models: {},
  baseUrls: {},
  lists: {},
  systemPrompt: DEFAULT_SYSTEM,
  control: 'off',
  autoShot: true,
  hideInShot: true,
  reasoning: 'default',
  panel: { w: 400, h: 600, x: null, y: null },
  dot: { x: null, y: null },
  minimized: false
};

PROVIDERS.forEach(function (p) { ensureRecommended(p.fallback, p.score); });

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    var val = JSON.parse(raw);
    return val && typeof val === 'object' ? val : fallback;
  } catch (e) { return fallback; }
}

function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { return false; }
}

function plainObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

function migrateV1(v1) {
  var s = {};
  ['theme', 'systemPrompt', 'control', 'autoShot', 'panel', 'dot', 'minimized'].forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(v1, k)) s[k] = v1[k];
  });
  s.provider = 'gemini';
  s.keys = { gemini: v1.apiKey || '' };
  s.models = {};
  if (v1.model) s.models.gemini = v1.model;
  s.lists = {};
  if (v1.models && v1.models.length) s.lists.gemini = { list: v1.models, at: v1.modelsFetchedAt || 0 };
  return s;
}

function normalizeSettings(saved) {
  saved = plainObject(saved) || {};
  var s = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    var d = DEFAULTS[k];
    s[k] = plainObject(d) ? Object.assign({}, d) : d;
  });
  Object.keys(saved).forEach(function (k) { s[k] = saved[k]; });
  ['keys', 'models', 'baseUrls', 'lists'].forEach(function (k) { s[k] = plainObject(s[k]) || {}; });
  s.panel = Object.assign({}, DEFAULTS.panel, plainObject(s.panel) || {});
  s.dot = Object.assign({}, DEFAULTS.dot, plainObject(s.dot) || {});
  if (providerById(s.provider).id !== s.provider) s.provider = DEFAULTS.provider;
  if (!/^(off|ask|auto)$/.test(String(s.control))) s.control = 'off';
  if (!/^(fast|default|deep)$/.test(String(s.reasoning))) s.reasoning = 'default';
  if (!/^(default|light|dark)$/.test(String(s.theme))) s.theme = 'default';
  s.autoShot = s.autoShot !== false;
  s.hideInShot = s.hideInShot !== false;
  s.minimized = !!s.minimized;
  if (typeof s.systemPrompt !== 'string' || LEGACY_SYSTEMS.indexOf(s.systemPrompt.trim()) >= 0) {
    s.systemPrompt = DEFAULT_SYSTEM;
  }

  /* Baked-in config fills gaps; anything saved in the panel wins. */
  var bakedKeys = plainObject(CFG.keys) || {};
  Object.keys(bakedKeys).forEach(function (id) {
    if (providerById(id).id === id && !s.keys[id] && typeof bakedKeys[id] === 'string') s.keys[id] = bakedKeys[id];
  });
  var baked = CFG.provider && providerById(CFG.provider).id === CFG.provider ? CFG.provider : null;
  var target = baked || s.provider;
  if (CFG.apiKey && typeof CFG.apiKey === 'string' && !s.keys[target]) s.keys[target] = CFG.apiKey;
  if (CFG.model && typeof CFG.model === 'string' && !s.models[target]) s.models[target] = CFG.model;
  if (baked && (saved.provider === undefined || (!s.keys[s.provider] && s.keys[baked]))) s.provider = baked;
  var bakedBases = plainObject(CFG.baseUrls) || {};
  Object.keys(bakedBases).forEach(function (id) {
    if (!s.baseUrls[id] && typeof bakedBases[id] === 'string') s.baseUrls[id] = bakedBases[id];
  });
  return s;
}

function loadSettings() {
  var saved = readJSON(LS_SETTINGS, null);
  if (!saved) {
    var v1 = readJSON(LS_SETTINGS_V1, null);
    saved = v1 ? migrateV1(v1) : {};
  }
  return normalizeSettings(saved);
}

var settings = loadSettings();
function saveSettings() { return writeJSON(LS_SETTINGS, settings); }

/* -------------------------------------------------- provider helpers */

function curProvider() { return providerById(settings.provider); }

function keyFor(id) { return String(settings.keys[id] || '').trim(); }

function baseFor(id) {
  var over = CFG.endpoints && plainObject(CFG.endpoints) ? CFG.endpoints[id] : '';
  return String(settings.baseUrls[id] || over || ENDPOINTS[id] || '').trim().replace(/\/+$/, '');
}

function listFor(id) {
  var l = settings.lists[id];
  if (l && Array.isArray(l.list) && l.list.length) return l.list;
  return providerById(id).fallback;
}

function recommendedFor(id) {
  var list = listFor(id);
  var rec = list.filter(function (m) { return m.recommended; })[0] || list[0];
  return rec ? rec.id : '';
}

function modelFor(id) { return String(settings.models[id] || recommendedFor(id) || '').trim(); }

function findModel(id, modelId) {
  var list = listFor(id);
  for (var i = 0; i < list.length; i++) if (list[i].id === modelId) return list[i];
  return null;
}

function modelLabel(id, modelId) {
  var m = findModel(id, modelId);
  return m ? m.label : (modelId || 'no model');
}

function modelVision(id, modelId) {
  var p = providerById(id);
  if (!p.vision) return false;
  var m = findModel(id, modelId);
  return !(m && m.vision === false);
}

function ctxFor(id) { return { key: keyFor(id), base: baseFor(id), model: modelFor(id) }; }

/* True when the provider has what it needs to take a request. */
function providerReady(id) {
  var p = providerById(id);
  if (p.needsBase && !baseFor(id)) return false;
  return !!keyFor(id) || !!p.keyOptional;
}

/* A fresh list replaces a model the key cannot use. Custom endpoints keep
   whatever id the user typed: their listings are often partial. */
function setModelList(id, list) {
  settings.lists[id] = { list: list, at: Date.now() };
  var keep = providerById(id).needsBase && settings.models[id];
  if (!keep && !findModel(id, settings.models[id] || '')) settings.models[id] = recommendedFor(id);
  saveSettings();
}

/* --------------------------------------------------------------- state */

var state = {
  messages: [],
  pending: [],
  stream: null,
  sharing: false,
  surface: '',
  captureOff: false,
  refs: {},
  pendingConfirm: null,
  busy: false,
  abort: null,
  view: 'chat',
  noExtras: {},
  seq: 0
};

function nextId() { return ++state.seq; }

/* Only plain text turns are kept across page loads: tool exchanges carry
   per-session signatures and ids that no provider accepts a second time. */
function restoreChat() {
  var saved = readJSON(LS_CHAT, null) || readJSON(LS_CHAT_V1, null);
  var list = saved && Array.isArray(saved.messages) ? saved.messages : [];
  state.messages = list.filter(function (m) {
    return m && typeof m.text === 'string' && m.text && !m.error;
  }).slice(-40).map(function (m) {
    return {
      id: nextId(),
      role: m.role === 'user' ? 'user' : 'assistant',
      text: m.text,
      shots: m.shots || 0,
      provider: m.provider || '',
      model: m.model || ''
    };
  });
}

function persistChat() {
  var slim = state.messages.filter(function (m) {
    return (m.role === 'user' || m.role === 'assistant') && !m.error && m.text;
  }).slice(-40).map(function (m) {
    return {
      role: m.role,
      text: m.text,
      shots: (m.images ? m.images.length : 0) + (m.shot ? 1 : 0) + (m.shots || 0),
      provider: m.provider || '',
      model: m.model || ''
    };
  });
  writeJSON(LS_CHAT, { messages: slim });
}

/* The window handed to a provider: recent turns, starting at a user turn,
   with images only on the latest user turn, tool exchanges from other
   providers reduced to their text, and consecutive user turns merged. */
function buildThread(providerId) {
  var msgs = state.messages.filter(function (m) {
    if (m.error) return false;
    if (m.role === 'tool') return !!(m.results && m.results.length);
    return !!(m.text || (m.images && m.images.length) || m.shot || (m.calls && m.calls.length));
  }).slice(-30);

  msgs = msgs.map(function (m) {
    if (m.provider && m.provider !== providerId) {
      if (m.role === 'tool') return null;
      if (m.role === 'assistant') return m.text ? { role: 'assistant', text: m.text } : null;
    }
    return m;
  }).filter(Boolean);

  var clean = [];
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var next = msgs[i + 1];
    if (m.role === 'assistant' && m.calls && m.calls.length && !(next && next.role === 'tool')) {
      if (m.text) clean.push({ role: 'assistant', text: m.text });
      continue;
    }
    if (m.role === 'tool') {
      var prev = clean[clean.length - 1];
      if (!(prev && prev.role === 'assistant' && prev.calls && prev.calls.length)) continue;
    }
    clean.push(m);
  }
  while (clean.length && clean[0].role !== 'user') clean.shift();

  var lastUser = -1;
  for (var j = clean.length - 1; j >= 0; j--) if (clean[j].role === 'user') { lastUser = j; break; }

  var out = [];
  clean.forEach(function (m, idx) {
    if (m.role === 'user') {
      var imgs = (m.shot ? [m.shot] : []).concat(m.images || []);
      if (idx === lastUser) out.push({ role: 'user', text: m.text || '', images: imgs });
      else out.push({ role: 'user', text: (imgs.length || m.shots ? '(a screenshot was attached here) ' : '') + (m.text || ''), images: [] });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', text: m.text || '', calls: m.calls || [], raw: m.raw || null, reasoning: m.reasoning || '' });
    } else {
      out.push({ role: 'tool', results: m.results });
    }
  });

  var merged = [];
  out.forEach(function (m) {
    var prev = merged[merged.length - 1];
    if (prev && prev.role === 'user' && m.role === 'user') {
      prev.text = [prev.text, m.text].filter(Boolean).join('\n\n');
      prev.images = prev.images.concat(m.images);
    } else merged.push(m);
  });
  return merged;
}
