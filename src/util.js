/* ---------------------------------------------------------------- util
   Shared by the app and the install page: keep this file free of DOM,
   settings and state. */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function errText(e) { return String(e && e.message ? e.message : e); }

function dataUrlParts(dataUrl) {
  var m = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(String(dataUrl || ''));
  return m ? { mime: m[1], data: m[2] } : null;
}

/* undefined, NaN, functions and runaway nesting all break the structured
   encodings providers expect for a tool result, so flatten to plain JSON. */
function jsonSafe(v, depth) {
  depth = depth || 0;
  if (v === null) return null;
  var t = typeof v;
  if (t === 'string') return v.length > 4000 ? v.slice(0, 4000) + '…' : v;
  if (t === 'number') return isFinite(v) ? v : String(v);
  if (t === 'boolean') return v;
  if (t !== 'object') return null;
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 80).map(function (x) { return jsonSafe(x, depth + 1); });
  var out = {};
  Object.keys(v).slice(0, 40).forEach(function (k) {
    var kt = typeof v[k];
    if (kt !== 'undefined' && kt !== 'function' && kt !== 'symbol') out[k] = jsonSafe(v[k], depth + 1);
  });
  return out;
}

/* Tool results must be JSON objects for every provider. */
function toolResultObject(resp) {
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) {
    return { result: resp === undefined ? null : jsonSafe(resp) };
  }
  return jsonSafe(resp);
}

/* Streamed tool arguments arrive as JSON text; a cut-off stream leaves it
   unparseable, in which case the fallback wins and the caller sees {} */
function parseArgs(text, fallback) {
  if (!text) return fallback || {};
  try {
    var v = JSON.parse(text);
    return v && typeof v === 'object' ? v : (fallback || {});
  } catch (e) { return fallback || {}; }
}

/* Pulls a human message out of whatever error body a provider returned. */
function extractError(text) {
  var msg = '';
  try {
    var j = JSON.parse(text);
    if (Array.isArray(j)) j = j[0] || {};
    if (j.error) msg = typeof j.error === 'string' ? j.error : (j.error.message || j.error.type || '');
    else if (j.message) msg = j.message;
    else if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
  } catch (e) { msg = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); }
  return msg;
}

function randomId(prefix) {
  return (prefix || 'id_') + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* Standard text/event-stream reader. Dispatches { event, data } per event,
   with data already JSON-parsed (or the literal '[DONE]'). Works on any
   fetch Response, and falls back to a buffered read where streaming bodies
   are unavailable. Each provider's `onEvent` does the interpreting. */
async function readSSE(res, onEvent) {
  var evName = '';
  var data = [];

  function dispatch() {
    if (data.length) {
      var raw = data.join('\n');
      if (raw === '[DONE]') onEvent({ event: evName, data: '[DONE]' });
      else {
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (parsed !== null) onEvent({ event: evName, data: parsed });
      }
    }
    evName = '';
    data = [];
  }

  function line(l) {
    if (l.charAt(l.length - 1) === '\r') l = l.slice(0, -1);
    if (!l) { dispatch(); return; }
    if (l.charAt(0) === ':') return;
    var c = l.indexOf(':');
    var field = c < 0 ? l : l.slice(0, c);
    var val = c < 0 ? '' : l.slice(c + 1).replace(/^ /, '');
    if (field === 'event') evName = val;
    else if (field === 'data') data.push(val);
  }

  function feed(text) {
    var idx;
    while ((idx = text.indexOf('\n')) >= 0) {
      line(text.slice(0, idx));
      text = text.slice(idx + 1);
    }
    return text;
  }

  if (!res.body || !res.body.getReader) {
    var whole = await res.text();
    /* A non-SSE JSON body (array or object) is treated as one event each. */
    if (/^\s*[\[{]/.test(whole)) {
      try {
        var j = JSON.parse(whole);
        (Array.isArray(j) ? j : [j]).forEach(function (d) { onEvent({ event: '', data: d }); });
        return;
      } catch (e) { }
    }
    var rest = feed(whole);
    if (rest) line(rest);
    dispatch();
    return;
  }

  var reader = res.body.getReader();
  var dec = new TextDecoder();
  var buf = '';
  while (true) {
    var r = await reader.read();
    if (r.done) break;
    buf = feed(buf + dec.decode(r.value, { stream: true }));
  }
  buf = feed(buf + dec.decode());
  if (buf) line(buf);
  dispatch();
}

/* GET JSON with a provider-shaped error. */
async function getJson(ctx, url, headers, describeErr) {
  var res = await (ctx.fetch || fetch)(url, { headers: headers });
  var txt = await res.text();
  if (!res.ok) throw new Error(describeErr(res.status, txt));
  try { return JSON.parse(txt); } catch (e) { throw new Error('Unexpected reply from ' + url); }
}

function prettyModelName(id) {
  return String(id).replace(/^models\//, '').split('-').map(function (part) {
    if (/^\d/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}
