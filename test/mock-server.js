'use strict';

/*
 * A stand-in for the four provider APIs, speaking each one's real wire
 * format (SSE framing, tool-call shapes, model listings), plus a static
 * server for the repo. Used by the end-to-end tests; also handy by hand:
 *
 *   node test/mock-server.js            http://127.0.0.1:8731/test/
 *
 * then point the panel at it with
 *   window.__NULLSOLVE_CONFIG__ = { endpoints: { gemini: 'http://127.0.0.1:8731/mock/gemini', ... } }
 *
 * Replies are scripted from the last user message:
 *   "apply filters"   -> list_elements, then click the "Apply filters" button, then "Clicked it."
 *   "slow"            -> a long, slow stream (for testing Stop)
 *   anything else     -> a markdown reply that mentions how many images arrived
 *
 * POST /mock/_scenario with { rejectExtrasOnce: true } makes the next request
 * that carries optional parameters fail with HTTP 400, like a model that does
 * not take them; { status: 500 } fails every request; { recordOnly: true }
 * returns an empty reply. GET /mock/_requests returns everything received.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const mock = { requests: [], scenario: {} };

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}

function sendJson(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
  });
}

function words(text) {
  return text.split(/(\s+)/).filter(Boolean);
}

const SAMPLE_MD = [
  'Here is a **sample** reply with markdown.',
  '',
  '```js',
  'console.log("hi");',
  '```',
  '',
  '| Col A | Col B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '- one',
  '- two'
].join('\n');

/* Pull the neutral bits out of a provider-shaped request body. */
function inspect(provider, body) {
  const info = { text: '', images: 0, system: '', toolResults: [], tools: 0, extras: [] };
  if (provider === 'gemini') {
    info.system = body.systemInstruction ? body.systemInstruction.parts.map(p => p.text).join('') : '';
    info.tools = body.tools ? body.tools[0].functionDeclarations.length : 0;
    const tc = body.generationConfig && body.generationConfig.thinkingConfig;
    if (tc) info.extras.push('thinkingConfig');
    const last = body.contents[body.contents.length - 1];
    if (last && last.role === 'user') {
      last.parts.forEach(p => {
        if (p.text) info.text += p.text;
        if (p.inline_data || p.inlineData) info.images++;
        if (p.functionResponse) info.toolResults.push({ id: p.functionResponse.id, name: p.functionResponse.name, response: p.functionResponse.response });
      });
    }
  } else if (provider === 'anthropic') {
    info.system = body.system || '';
    info.tools = body.tools ? body.tools.length : 0;
    if (body.output_config) info.extras.push('output_config');
    if (body.fallbacks) info.extras.push('fallbacks');
    const last = body.messages[body.messages.length - 1];
    if (last && last.role === 'user') {
      const content = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
      content.forEach(b => {
        if (b.type === 'text') info.text += b.text;
        if (b.type === 'image') info.images++;
        if (b.type === 'tool_result') info.toolResults.push({ id: b.tool_use_id, response: JSON.parse(b.content) });
      });
    }
  } else {
    const sys = body.messages.filter(m => m.role === 'system' || m.role === 'developer')[0];
    info.system = sys ? sys.content : '';
    info.tools = body.tools ? body.tools.length : 0;
    if (body.reasoning_effort) info.extras.push('reasoning_effort');
    if (body.thinking) info.extras.push('thinking');
    const msgs = body.messages;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role === 'tool') {
      info.toolResults.unshift({ id: msgs[i].tool_call_id, response: JSON.parse(msgs[i].content) });
      i--;
    }
    if (!info.toolResults.length) {
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'user') {
        if (typeof last.content === 'string') info.text = last.content;
        else last.content.forEach(p => {
          if (p.type === 'text') info.text += p.text;
          if (p.type === 'image_url') info.images++;
        });
      }
    }
  }
  return info;
}

/* Decide what the "model" does for this request. */
function plan(provider, body, info) {
  if (mock.scenario.recordOnly) return { kind: 'text', text: '' };
  if (info.toolResults.length) {
    const r = info.toolResults[0].response || {};
    if (r.elements) {
      const hit = r.elements.filter(e => /apply/i.test(e.name))[0];
      if (hit) return { kind: 'tool', name: 'click', args: { ref: hit.ref, reason: 'You asked me to apply the filters.' }, id: 'call_click_1' };
      return { kind: 'text', text: 'I could not find an Apply button.' };
    }
    if (r.clicked || r.ok) return { kind: 'text', text: 'Clicked it.' };
    if (r.error) return { kind: 'text', text: 'The tool reported: ' + r.error };
    return { kind: 'text', text: 'Done: ' + JSON.stringify(r).slice(0, 80) };
  }
  if (/apply filters/i.test(info.text) && info.tools) {
    return { kind: 'tool', name: 'list_elements', args: { query: 'apply' }, id: 'call_list_1' };
  }
  if (/\bslow\b/i.test(info.text)) {
    return { kind: 'text', text: Array.from({ length: 60 }, (_, i) => 'slow word ' + i).join(' '), delay: 80 };
  }
  const seen = info.images ? ' I can see ' + info.images + ' image' + (info.images > 1 ? 's' : '') + '.' : ' I see no images.';
  return { kind: 'text', text: 'Hello from ' + provider + '! You said: ' + info.text.trim() + '.' + seen + '\n\n' + SAMPLE_MD, delay: 4 };
}

function sseStart(res) {
  cors(res);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
}

async function streamGemini(res, p, model) {
  sseStart(res);
  const send = obj => res.write('data: ' + JSON.stringify(obj) + '\r\n\r\n');
  if (p.kind === 'tool') {
    send({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: p.name, args: p.args, id: p.id }, thoughtSignature: 'sig_' + p.id }] }, index: 0 }], modelVersion: model });
    send({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  } else {
    for (const w of words(p.text)) {
      send({ candidates: [{ content: { role: 'model', parts: [{ text: w }] }, index: 0 }], modelVersion: model });
      if (p.delay) await sleep(p.delay);
    }
    send({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, modelVersion: model });
  }
  res.end();
}

async function streamAnthropic(res, p, model) {
  sseStart(res);
  const ev = (name, obj) => res.write('event: ' + name + '\ndata: ' + JSON.stringify(Object.assign({ type: name }, obj)) + '\n\n');
  ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  let idx = 0;
  /* Current models think by default; the text is omitted but the block, and
     its signature, still has to be replayed. */
  ev('content_block_start', { index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } });
  ev('content_block_delta', { index: idx, delta: { type: 'thinking_delta', thinking: 'Considering the request. ' } });
  ev('content_block_delta', { index: idx, delta: { type: 'signature_delta', signature: 'sigAAAA' + idx } });
  ev('content_block_stop', { index: idx });
  idx++;
  if (p.kind === 'tool') {
    ev('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: idx, delta: { type: 'text_delta', text: 'Let me look.' } });
    ev('content_block_stop', { index: idx });
    idx++;
    ev('content_block_start', { index: idx, content_block: { type: 'tool_use', id: 'toolu_' + p.id, name: p.name, input: {} } });
    const json = JSON.stringify(p.args);
    const cut = Math.floor(json.length / 2);
    ev('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: json.slice(0, cut) } });
    ev('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: json.slice(cut) } });
    ev('content_block_stop', { index: idx });
    ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 12 } });
  } else {
    ev('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
    for (const w of words(p.text)) {
      ev('content_block_delta', { index: idx, delta: { type: 'text_delta', text: w } });
      if (p.delay) await sleep(p.delay);
    }
    ev('content_block_stop', { index: idx });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  }
  ev('message_stop', {});
  res.end();
}

async function streamOpenAI(res, p, model, flavor) {
  sseStart(res);
  const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  const chunk = (delta, finish) => ({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: model,
    choices: [{ index: 0, delta: delta, finish_reason: finish || null }] });
  send(chunk({ role: 'assistant', content: '' }));
  if (flavor === 'deepseek') {
    send(chunk({ content: null, reasoning_content: 'Thinking about it. ' }));
    send(chunk({ content: null, reasoning_content: 'Decided.' }));
  }
  if (p.kind === 'tool') {
    const json = JSON.stringify(p.args);
    const cut = Math.floor(json.length / 2);
    send(chunk({ tool_calls: [{ index: 0, id: p.id, type: 'function', function: { name: p.name, arguments: '' } }] }));
    send(chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(0, cut) } }] }));
    send(chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(cut) } }] }));
    send(chunk({}, 'tool_calls'));
  } else {
    for (const w of words(p.text)) {
      send(chunk({ content: w }));
      if (p.delay) await sleep(p.delay);
    }
    send(chunk({}, 'stop'));
  }
  send({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  res.write('data: [DONE]\n\n');
  res.end();
}

const MODEL_LISTS = {
  gemini: { models: [
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }
  ] },
  anthropic: { data: [
    { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', type: 'model', created_at: '2026-07-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-06-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', type: 'model', created_at: '2026-06-15T00:00:00Z', capabilities: { image_input: { supported: true } } }
  ], has_more: false },
  openai: { object: 'list', data: [
    { id: 'gpt-5.4-mini', object: 'model' }, { id: 'gpt-5.4', object: 'model' }, { id: 'text-embedding-3-small', object: 'model' },
    { id: 'gpt-4o-2024-08-06', object: 'model' }, { id: 'gpt-5.4-nano', object: 'model' }, { id: 'whisper-1', object: 'model' }
  ] },
  deepseek: { object: 'list', data: [{ id: 'deepseek-v4-pro', object: 'model' }, { id: 'deepseek-v4-flash', object: 'model' }] }
};

function errorBody(provider, status, message) {
  if (provider === 'gemini') return { error: { code: status, message: message, status: 'INVALID_ARGUMENT' } };
  if (provider === 'anthropic') return { type: 'error', error: { type: 'invalid_request_error', message: message } };
  return { error: { message: message, type: 'invalid_request_error', code: null } };
}

async function handleMock(req, res, url) {
  const m = /^\/mock\/(gemini|anthropic|openai|deepseek|_[a-z]+)(\/.*)?$/.exec(url.pathname);
  if (!m) { sendJson(res, 404, { error: 'no such mock' }); return; }
  const provider = m[1];
  const rest = m[2] || '';

  if (provider === '_requests') { sendJson(res, 200, mock.requests); return; }
  if (provider === '_reset') { mock.requests = []; mock.scenario = {}; sendJson(res, 200, { ok: true }); return; }
  if (provider === '_scenario') {
    const body = await readBody(req);
    Object.assign(mock.scenario, body ? JSON.parse(body) : {});
    sendJson(res, 200, mock.scenario);
    return;
  }

  if (req.method === 'GET' && /\/models(\?|$)/.test(rest)) {
    mock.requests.push({ provider, kind: 'models', headers: req.headers });
    if (provider === 'anthropic' && !req.headers['anthropic-dangerous-direct-browser-access']) {
      sendJson(res, 401, errorBody(provider, 401, 'CORS requests must set anthropic-dangerous-direct-browser-access header'));
      return;
    }
    sendJson(res, 200, MODEL_LISTS[provider]);
    return;
  }

  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  const raw = await readBody(req);
  let body;
  try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, errorBody(provider, 400, 'bad json')); return; }

  let model = body.model || '';
  if (provider === 'gemini') {
    const mm = /\/models\/([^:]+):streamGenerateContent/.exec(decodeURIComponent(rest));
    model = mm ? mm[1] : '';
  }
  const info = inspect(provider, body);
  mock.requests.push({ provider, kind: 'chat', model, headers: req.headers, body, info });

  if (mock.scenario.status) { sendJson(res, mock.scenario.status, errorBody(provider, mock.scenario.status, 'Scripted failure ' + mock.scenario.status)); return; }
  if (mock.scenario.rejectExtrasOnce && info.extras.length) {
    mock.scenario.rejectExtrasOnce = false;
    sendJson(res, 400, errorBody(provider, 400, 'Unsupported parameter: ' + info.extras[0]));
    return;
  }
  if (provider === 'anthropic' && !req.headers['anthropic-dangerous-direct-browser-access']) {
    sendJson(res, 401, errorBody(provider, 401, 'CORS requests must set anthropic-dangerous-direct-browser-access header'));
    return;
  }

  const p = plan(provider, body, info);
  if (provider === 'gemini') await streamGemini(res, p, model);
  else if (provider === 'anthropic') await streamAnthropic(res, p, model);
  else await streamOpenAI(res, p, model, provider);
}

/* /dist/ can be pointed at a scratch build so tests never touch the real one. */
let distDir = path.join(ROOT, 'dist');

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file;
  if (rel === '/dist' || rel.startsWith('/dist/')) file = path.normalize(path.join(distDir, rel.slice(5)));
  else file = path.normalize(path.join(ROOT, rel));
  const allowed = file.startsWith(ROOT) || file.startsWith(distDir);
  if (!allowed || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + rel);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
    if (url.pathname.startsWith('/mock/')) {
      handleMock(req, res, url).catch(e => { try { sendJson(res, 500, { error: String(e) }); } catch (err) { } });
      return;
    }
    serveStatic(req, res, url);
  });
}

function start(port, opts) {
  if (opts && opts.distDir) distDir = path.resolve(opts.distDir);
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port || 0, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, port: p, url: 'http://127.0.0.1:' + p, mock });
    });
  });
}

module.exports = { start, createServer, mock, MODEL_LISTS };

if (require.main === module) {
  const port = parseInt(process.argv[2] || process.env.PORT || '8731', 10);
  start(port).then(s => {
    console.log('mock provider + static server on ' + s.url + '/test/');
  }).catch(e => { console.error(e); process.exit(1); });
}
