'use strict';

/* Unit tests for the DOM-free parts of the app: the provider adapters, the
   SSE reader, markdown, settings migration and the thread window. The source
   files are evaluated in a sandbox exactly as build.js concatenates them.
   Run with `npm test` (node --test). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble } = require('../build.js');

const CORE = ['boot', 'util', 'providers', 'settings', 'markdown'];
const EXPORTS = [
  'esc', 'jsonSafe', 'toolResultObject', 'parseArgs', 'extractError', 'readSSE', 'prettyModelName',
  'ENDPOINTS', 'GEMINI', 'ANTHROPIC', 'OPENAI', 'DEEPSEEK', 'CUSTOM', 'PROVIDERS', 'providerById', 'streamChat',
  'pickRecommended', 'ensureRecommended', 'labelOpenAI', 'geminiSchema', 'describeError',
  'settings', 'state', 'loadSettings', 'normalizeSettings', 'migrateV1', 'buildThread', 'restoreChat', 'persistChat',
  'nextId', 'DEFAULT_SYSTEM', 'LEGACY_SYSTEMS', 'modelFor', 'recommendedFor', 'providerReady', 'baseFor', 'keyFor',
  'setModelList', 'modelVision', 'modelLabel', 'LS_SETTINGS', 'LS_CHAT', 'LS_CHAT_V1',
  'mdToHtml', 'inlineMd'
];

function sandbox(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const window = { __NULLSOLVE_CONFIG__: opts.cfg || {} };
  const document = { getElementById: () => null };
  const code = "'use strict';\n" + assemble(CORE) + '\nreturn { ' + EXPORTS.join(', ') + ' };';
  const fn = new Function('window', 'document', 'localStorage', 'navigator', 'fetch', code);
  const api = fn(window, document, localStorage, {}, opts.fetch || (() => { throw new Error('fetch not stubbed'); }));
  api.store = store;
  return api;
}

function sseResponse(text, status) {
  return new Response(text, { status: status || 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function sampleThread() {
  return [
    { role: 'user', text: 'first', images: [] },
    { role: 'assistant', text: 'ok', calls: [], raw: null, reasoning: '' },
    { role: 'user', text: 'click apply', images: [IMG] },
    { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'list_elements', args: { query: 'apply' }, sig: 'sigX' }], raw: null, reasoning: 'r' },
    { role: 'tool', results: [{ id: 'c1', name: 'list_elements', response: { elements: [], count: 0 } }] }
  ];
}

const TOOLS = [{
  name: 'click', description: 'Click', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] }
}];

/* ------------------------------------------------------------------ util */

test('jsonSafe flattens awkward values', () => {
  const { jsonSafe, toolResultObject, parseArgs, extractError } = sandbox();
  assert.deepEqual(jsonSafe({ a: NaN, b: undefined, c: () => 1, d: [1, 'x', null] }), { a: 'NaN', d: [1, 'x', null] });
  assert.equal(jsonSafe('x'.repeat(5000)).length, 4001);
  assert.deepEqual(toolResultObject('plain'), { result: 'plain' });
  assert.deepEqual(toolResultObject({ ok: true }), { ok: true });
  assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(parseArgs('{"a":', { b: 2 }), { b: 2 });
  assert.equal(extractError('{"error":{"message":"bad key"}}'), 'bad key');
  assert.equal(extractError('{"type":"error","error":{"type":"x","message":"nope"}}'), 'nope');
  assert.equal(extractError('[{"error":{"message":"gemini style"}}]'), 'gemini style');
  assert.equal(extractError('<html><body>Gateway   timeout</body></html>'), 'Gateway timeout');
});

test('readSSE handles split chunks, event names, CRLF and [DONE]', async () => {
  const { readSSE } = sandbox();
  const enc = new TextEncoder();
  const parts = ['event: content_block_delta\ndata: {"a":1}\n\nda', 'ta: {"b":', '2}\r\n\r\n: comment\ndata: [DONE]\n\n', 'data: {"tail":true}'];
  const stream = new ReadableStream({
    start(c) { parts.forEach(p => c.enqueue(enc.encode(p))); c.close(); }
  });
  const got = [];
  await readSSE(new Response(stream), ev => got.push(ev));
  assert.deepEqual(got, [
    { event: 'content_block_delta', data: { a: 1 } },
    { event: '', data: { b: 2 } },
    { event: '', data: '[DONE]' },
    { event: '', data: { tail: true } }
  ]);
});

test('readSSE falls back to a buffered JSON body', async () => {
  const { readSSE } = sandbox();
  const got = [];
  await readSSE({ body: null, text: async () => '[{"x":1},{"x":2}]' }, ev => got.push(ev.data.x));
  assert.deepEqual(got, [1, 2]);
});

/* -------------------------------------------------------------- markdown */

test('markdown renders the supported constructs and nothing dangerous', () => {
  const { mdToHtml } = sandbox();
  const html = mdToHtml([
    '# Title',
    'Some **bold** and `code` and a [link](https://x.y/z) and [bad](javascript:alert(1)) <script>alert(1)</script>',
    '',
    '```js',
    'let a = 1;',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '> quoted',
    '',
    '---',
    'end'
  ].join('\n'));
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/x\.y\/z" target="_blank" rel="noreferrer noopener">link<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<div class="cb">.*<span class="cbl">js<\/span>.*<pre><code>let a = 1;<\/code><\/pre>/s);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('markdown shows an unterminated fence as code while streaming', () => {
  const { mdToHtml } = sandbox();
  const html = mdToHtml('Here:\n```py\nprint(1)\nprint(');
  assert.match(html, /<span class="cbl">py<\/span>/);
  assert.match(html, /print\(1\)\nprint\(/);
  assert.doesNotMatch(html, /```/);
});

/* -------------------------------------------------------- gemini adapter */

test('gemini builds contents, tools and thinking config', () => {
  const { GEMINI } = sandbox();
  const ctx = { key: 'K', base: 'https://g.test/v1beta', model: 'gemini-3.8-flash' };
  const r = GEMINI.build(ctx, { system: 'SYS', thread: sampleThread(), tools: TOOLS, reasoning: 'fast', extras: true });
  assert.equal(r.url, 'https://g.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  assert.equal(r.headers['x-goog-api-key'], 'K');
  assert.equal(r.body.systemInstruction.parts[0].text, 'SYS');
  assert.equal(r.body.contents.length, 5);
  assert.deepEqual(r.body.contents[2].parts[0], { inline_data: { mime_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } });
  assert.equal(r.body.contents[2].parts[1].text, 'click apply');
  const callPart = r.body.contents[3].parts[0];
  assert.equal(callPart.functionCall.id, 'c1');
  assert.equal(callPart.thoughtSignature, 'sigX');
  assert.equal(r.body.contents[3].role, 'model');
  assert.deepEqual(r.body.contents[4].parts[0].functionResponse, { name: 'list_elements', response: { elements: [], count: 0 }, id: 'c1' });
  const decl = r.body.tools[0].functionDeclarations[0];
  assert.equal(decl.parameters.type, 'OBJECT');
  assert.equal(decl.parameters.properties.ref.type, 'STRING');
  assert.deepEqual(r.body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(r.hasExtras, true);
  assert.equal('temperature' in r.body.generationConfig, false);

  assert.deepEqual(GEMINI.build({ key: 'K', base: 'b', model: 'gemini-2.5-flash' }, { thread: [], reasoning: 'fast', extras: true }).body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual(GEMINI.build({ key: 'K', base: 'b', model: 'gemini-2.5-pro' }, { thread: [], reasoning: 'fast', extras: true }).body.generationConfig.thinkingConfig, { thinkingBudget: 128 });
  assert.deepEqual(GEMINI.build({ key: 'K', base: 'b', model: 'gemini-flash-latest' }, { thread: [], reasoning: 'deep', extras: true }).body.generationConfig.thinkingConfig, { thinkingLevel: 'high' });
  const plain = GEMINI.build(ctx, { thread: [], reasoning: 'default', extras: true });
  assert.equal(plain.hasExtras, false);
  assert.equal('thinkingConfig' in plain.body.generationConfig, false);
});

test('gemini folds stream events, dedupes calls and keeps late signatures', () => {
  const { GEMINI } = sandbox();
  const acc = GEMINI.newAcc();
  const ev = d => GEMINI.onEvent(acc, { event: '', data: d });
  ev({ candidates: [{ content: { parts: [{ text: 'Hel' }, { text: 'lo', thought: true }] } }], modelVersion: 'gemini-3.8-flash-001' });
  ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'click', args: { ref: 'e1' }, id: 'fc1' } }] } }] });
  ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'click', args: { ref: 'e1' }, id: 'fc1' }, thoughtSignature: 'late' }] }, finishReason: 'STOP' }] });
  GEMINI.finish(acc);
  assert.equal(acc.text, 'Hel');
  assert.equal(acc.reasoning, 'lo');
  assert.equal(acc.model, 'gemini-3.8-flash-001');
  assert.equal(acc.calls.length, 1);
  assert.equal(acc.calls[0].sig, 'late');
  assert.equal(acc.stop, 'STOP');
  assert.throws(() => ev({ promptFeedback: { blockReason: 'SAFETY' } }), /Request blocked: SAFETY/);

  const cut = GEMINI.newAcc();
  GEMINI.onEvent(cut, { event: '', data: { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] } });
  GEMINI.finish(cut);
  assert.match(cut.text, /partial\n\n_\(cut off at the output limit\)_/);
});

test('gemini lists models from the key and recommends the newest plain flash', async () => {
  let seen;
  const api = sandbox({
    fetch: async (url, opts) => {
      seen = { url, opts };
      return jsonResponse({ models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash-lite', displayName: 'Lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] }
      ] });
    }
  });
  const list = await api.GEMINI.listModels({ key: 'K', base: 'https://g.test/v1beta' });
  assert.equal(seen.url, 'https://g.test/v1beta/models?pageSize=200');
  assert.equal(seen.opts.headers['x-goog-api-key'], 'K');
  assert.deepEqual(list.map(m => m.id), ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-2.5-flash']);
  assert.equal(list.filter(m => m.recommended)[0].id, 'gemini-3.8-flash');
});

/* ----------------------------------------------------- anthropic adapter */

test('anthropic builds messages with browser header, tool blocks and effort', () => {
  const { ANTHROPIC } = sandbox();
  const ctx = { key: 'sk-ant', base: 'https://a.test/v1', model: 'claude-opus-5-5' };
  const r = ANTHROPIC.build(ctx, { system: 'SYS', thread: sampleThread(), tools: TOOLS, reasoning: 'fast', extras: true });
  assert.equal(r.url, 'https://a.test/v1/messages');
  assert.equal(r.headers['x-api-key'], 'sk-ant');
  assert.equal(r.headers['anthropic-version'], '2026-10-21');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(r.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(r.body.system, 'SYS');
  assert.equal(r.body.stream, true);
  assert.equal(r.body.max_tokens, 16384);
  assert.equal('temperature' in r.body, false);
  assert.deepEqual(r.body.output_config, { effort: 'low' });
  assert.equal(r.body.fallbacks, 'default');
  const msgs = r.body.messages;
  assert.equal(msgs.length, 5);
  assert.deepEqual(msgs[2].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } });
  assert.deepEqual(msgs[2].content[1], { type: 'text', text: 'click apply' });
  assert.deepEqual(msgs[3].content, [{ type: 'tool_use', id: 'c1', name: 'list_elements', input: { query: 'apply' } }]);
  assert.deepEqual(msgs[4].content, [{ type: 'tool_result', tool_use_id: 'c1', content: '{"elements":[],"count":0}' }]);
  assert.deepEqual(r.body.tools[0], { name: 'click', description: 'Click', input_schema: TOOLS[0].parameters });

  const deep = ANTHROPIC.build(ctx, { thread: [], reasoning: 'deep', extras: true });
  assert.deepEqual(deep.body.output_config, { effort: 'xhigh' });
  const none = ANTHROPIC.build(ctx, { thread: [], reasoning: 'default', extras: false });
  assert.equal('output_config' in none.body, false);
  assert.equal('fallbacks' in none.body, false);
  assert.equal('anthropic-beta' in none.headers, false);
  assert.equal(none.hasExtras, false);
});

test('anthropic replays its own content blocks verbatim, minus empty text', () => {
  const { ANTHROPIC } = sandbox();
  const raw = [
    { type: 'thinking', thinking: '', signature: 'SIG' },
    { type: 'text', text: '' },
    { type: 'tool_use', id: 'toolu_1', name: 'click', input: { ref: 'e1' } }
  ];
  const thread = [
    { role: 'user', text: 'go', images: [] },
    { role: 'assistant', text: '', calls: [{ id: 'toolu_1', name: 'click', args: { ref: 'e1' } }], raw: raw, reasoning: '' },
    { role: 'tool', results: [{ id: 'toolu_1', name: 'click', response: { error: 'declined' } }] }
  ];
  const r = ANTHROPIC.build({ key: 'k', base: 'b', model: 'm' }, { thread, extras: false });
  assert.deepEqual(r.body.messages[1].content, [raw[0], raw[2]]);
  assert.equal(r.body.messages[2].content[0].is_error, true);
});

test('anthropic folds the event stream into text, thinking, tool calls and raw blocks', () => {
  const { ANTHROPIC } = sandbox();
  const acc = ANTHROPIC.newAcc();
  const ev = (type, d) => ANTHROPIC.onEvent(acc, { event: type, data: Object.assign({ type }, d) });
  ev('message_start', { message: { model: 'claude-opus-5-5', usage: { input_tokens: 3 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
  ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } });
  ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'SIG' } });
  ev('content_block_stop', { index: 0 });
  ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Let me ' } });
  ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'look.' } });
  ev('content_block_stop', { index: 1 });
  ev('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_9', name: 'click', input: {} } });
  ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '{"ref":' } });
  ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '"e2"}' } });
  ev('content_block_stop', { index: 2 });
  ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } });
  ev('message_stop', {});
  ANTHROPIC.finish(acc);
  assert.equal(acc.text, 'Let me look.');
  assert.equal(acc.reasoning, 'hmm');
  assert.equal(acc.model, 'claude-opus-5-5');
  assert.equal(acc.stop, 'tool_use');
  assert.deepEqual(acc.calls, [{ id: 'toolu_9', name: 'click', args: { ref: 'e2' } }]);
  assert.deepEqual(acc.raw, [
    { type: 'thinking', thinking: 'hmm', signature: 'SIG' },
    { type: 'text', text: 'Let me look.' },
    { type: 'tool_use', id: 'toolu_9', name: 'click', input: { ref: 'e2' } }
  ]);
  assert.deepEqual(acc.usage, { input_tokens: 3, output_tokens: 9 });
  assert.throws(() => ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }), /Overloaded/);

  const refused = ANTHROPIC.newAcc();
  ANTHROPIC.onEvent(refused, { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'refusal' } } });
  ANTHROPIC.finish(refused);
  assert.match(refused.text, /declined/);
});

test('anthropic lists models with the browser header and recommends Opus 5.5', async () => {
  let seen;
  const api = sandbox({
    fetch: async (url, opts) => {
      seen = { url, opts };
      return jsonResponse({ data: [
        { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', type: 'model', created_at: '2026-07-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
        { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-06-01T00:00:00Z' },
        { id: 'claude-text-only', display_name: 'Text', type: 'model', created_at: '2026-01-01T00:00:00Z', capabilities: { image_input: { supported: false } } }
      ], has_more: false });
    }
  });
  const list = await api.ANTHROPIC.listModels({ key: 'k', base: 'https://a.test/v1' });
  assert.equal(seen.url, 'https://a.test/v1/models?limit=1000');
  assert.equal(seen.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(list[0].id, 'claude-opus-5-5');
  assert.equal(list[0].recommended, true);
  assert.equal(list.filter(m => m.id === 'claude-text-only')[0].vision, false);
});

/* -------------------------------------------------- openai-style adapters */

test('openai builds chat completions with images, tool calls and reasoning effort', () => {
  const { OPENAI } = sandbox();
  const ctx = { key: 'sk', base: 'https://o.test/v1', model: 'gpt-5.4' };
  const r = OPENAI.build(ctx, { system: 'SYS', thread: sampleThread(), tools: TOOLS, reasoning: 'fast', extras: true });
  assert.equal(r.url, 'https://o.test/v1/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer sk');
  const m = r.body.messages;
  assert.deepEqual(m[0], { role: 'system', content: 'SYS' });
  assert.equal(m[1].content, 'first');
  assert.deepEqual(m[3].content, [{ type: 'text', text: 'click apply' }, { type: 'image_url', image_url: { url: IMG, detail: 'auto' } }]);
  assert.equal(m[4].content, null);
  assert.deepEqual(m[4].tool_calls, [{ id: 'c1', type: 'function', function: { name: 'list_elements', arguments: '{"query":"apply"}' } }]);
  assert.equal('reasoning_content' in m[4], false);
  assert.deepEqual(m[5], { role: 'tool', tool_call_id: 'c1', content: '{"elements":[],"count":0}' });
  assert.equal(r.body.max_completion_tokens, 16384);
  assert.equal('max_tokens' in r.body, false);
  assert.equal('temperature' in r.body, false);
  assert.deepEqual(r.body.stream_options, { include_usage: true });
  assert.deepEqual(r.body.tools[0], { type: 'function', function: { name: 'click', description: 'Click', parameters: TOOLS[0].parameters } });
  assert.equal(r.body.reasoning_effort, 'low');
  assert.equal(r.hasExtras, true);
  const plain = OPENAI.build(ctx, { thread: [], reasoning: 'default', extras: true });
  assert.equal('reasoning_effort' in plain.body, false);
  assert.equal(plain.hasExtras, false);
});

test('deepseek echoes reasoning_content and maps the speed setting to thinking', () => {
  const { DEEPSEEK } = sandbox();
  const ctx = { key: 'sk', base: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };
  const r = DEEPSEEK.build(ctx, { thread: sampleThread(), reasoning: 'deep', extras: true });
  assert.equal(r.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(r.body.max_tokens, 8192);
  assert.equal('max_completion_tokens' in r.body, false);
  assert.equal(r.body.messages[3].reasoning_content, 'r');
  assert.deepEqual(r.body.thinking, { type: 'enabled' });
  assert.equal(r.body.reasoning_effort, 'high');
  const fast = DEEPSEEK.build(ctx, { thread: [], reasoning: 'fast', extras: true });
  assert.deepEqual(fast.body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in fast.body, false);
});

test('custom endpoints get the leanest possible request', () => {
  const { CUSTOM } = sandbox();
  const r = CUSTOM.build({ key: '', base: 'http://localhost:11434/v1/', model: 'llama' }, { thread: [{ role: 'user', text: 'hi', images: [] }], reasoning: 'fast', extras: true });
  assert.equal(r.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal('authorization' in r.headers, false);
  assert.equal('stream_options' in r.body, false);
  assert.equal('max_tokens' in r.body, false);
  assert.equal('reasoning_effort' in r.body, false);
  assert.equal(r.hasExtras, false);
});

test('openai-style streams accumulate content, reasoning and split tool calls', () => {
  const { OPENAI, DEEPSEEK } = sandbox();
  const acc = DEEPSEEK.newAcc();
  const chunk = (delta, finish) => ({ event: '', data: { model: 'deepseek-v4-flash', choices: [{ index: 0, delta, finish_reason: finish || null }] } });
  DEEPSEEK.onEvent(acc, chunk({ role: 'assistant', content: '' }));
  DEEPSEEK.onEvent(acc, chunk({ content: null, reasoning_content: 'think ' }));
  DEEPSEEK.onEvent(acc, chunk({ content: 'Hi ' }));
  DEEPSEEK.onEvent(acc, chunk({ content: 'there' }));
  DEEPSEEK.onEvent(acc, chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'click', arguments: '' } }] }));
  DEEPSEEK.onEvent(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"ref"' } }] }));
  DEEPSEEK.onEvent(acc, chunk({ tool_calls: [{ index: 0, function: { arguments: ':"e1"}' } }, { index: 1, function: { name: 'scroll', arguments: '{}' } }] }));
  DEEPSEEK.onEvent(acc, chunk({}, 'tool_calls'));
  DEEPSEEK.onEvent(acc, { event: '', data: { choices: [], usage: { total_tokens: 5 } } });
  DEEPSEEK.onEvent(acc, { event: '', data: '[DONE]' });
  DEEPSEEK.finish(acc);
  assert.equal(acc.text, 'Hi there');
  assert.equal(acc.reasoning, 'think ');
  assert.equal(acc.model, 'deepseek-v4-flash');
  assert.equal(acc.stop, 'tool_calls');
  assert.deepEqual(acc.usage, { total_tokens: 5 });
  assert.equal(acc.calls.length, 2);
  assert.deepEqual(acc.calls[0], { id: 'call_1', name: 'click', args: { ref: 'e1' } });
  assert.equal(acc.calls[1].name, 'scroll');
  assert.match(acc.calls[1].id, /^call_/);
  assert.throws(() => OPENAI.onEvent(OPENAI.newAcc(), { event: '', data: { error: { message: 'boom' } } }), /boom/);
});

test('openai lists chat-capable models and labels them', async () => {
  const api = sandbox({
    fetch: async () => jsonResponse({ object: 'list', data: [
      { id: 'gpt-5.4-mini' }, { id: 'gpt-5.4' }, { id: 'whisper-1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-2024-08-06' },
      { id: 'gpt-5.4-nano' }, { id: 'o4-mini' }, { id: 'gpt-5-pro' }, { id: 'gpt-5-chat-latest' }
    ] })
  });
  const list = await api.OPENAI.listModels({ key: 'k', base: 'https://o.test/v1' });
  assert.deepEqual(list.map(m => m.id), ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-chat-latest', 'o4-mini']);
  assert.equal(list[0].recommended, true);
  assert.equal(list[1].label, 'GPT-5.4 Mini');
  assert.equal(api.labelOpenAI('chatgpt-4o-latest'), 'ChatGPT-4o Latest');
  const ds = await sandbox({ fetch: async () => jsonResponse({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] }) })
    .DEEPSEEK.listModels({ key: 'k', base: 'https://d.test' });
  assert.equal(ds[0].id, 'deepseek-v4-flash');
  assert.equal(ds[0].label, 'DeepSeek V4 Flash');
  assert.equal(ds[0].recommended, true);
});

test('model listing errors are explained', async () => {
  const api = sandbox({ fetch: async () => jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401) });
  await assert.rejects(api.OPENAI.listModels({ key: 'bad', base: 'https://o.test/v1' }), /Key rejected by OpenAI \(401\)\. Incorrect API key provided/);
});

/* ------------------------------------------------------------ streamChat */

test('streamChat retries once without optional parameters on a 400', async () => {
  const calls = [];
  const api = sandbox({
    fetch: async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, body, signal: opts.signal });
      if (body.reasoning_effort) return jsonResponse({ error: { message: 'Unsupported parameter: reasoning_effort' } }, 400);
      return sseResponse('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }
  });
  const rejected = [];
  const ac = new AbortController();
  const acc = await api.streamChat(api.OPENAI, { key: 'k', base: 'https://o.test/v1', model: 'gpt-4o' },
    { thread: [{ role: 'user', text: 'hi', images: [] }], reasoning: 'fast', extras: true, signal: ac.signal },
    { onExtrasRejected: m => rejected.push(m) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal('reasoning_effort' in calls[1].body, false);
  assert.equal(calls[1].signal, ac.signal);
  assert.equal(acc.text, 'Hi!');
  assert.equal(acc.extrasUsed, false);
  assert.deepEqual(rejected, ['Unsupported parameter: reasoning_effort']);
});

test('streamChat surfaces provider errors with status and request body', async () => {
  let n = 0;
  const api = sandbox({ fetch: async () => { n++; return jsonResponse({ error: { message: 'bad key' } }, 401); } });
  await assert.rejects(
    api.streamChat(api.GEMINI, { key: 'k', base: 'b', model: 'm' }, { thread: [], reasoning: 'default', extras: true }),
    e => e.name === 'ApiError' && e.status === 401 && /Key rejected by Gemini \(401\)\. bad key/.test(e.message) && Array.isArray(e.requestBody.contents)
  );
  assert.equal(n, 1);
  const api2 = sandbox({ fetch: async () => { n++; return jsonResponse({ error: { message: 'history broken: role' } }, 400); } });
  await assert.rejects(
    api2.streamChat(api2.OPENAI, { key: 'k', base: 'b', model: 'm' }, { thread: [], reasoning: 'default', extras: true }),
    /page-control tool exchange/
  );
  assert.equal(n, 2);
});

/* -------------------------------------------------------------- settings */

test('v1 settings migrate into v2 and the legacy prompt is replaced', () => {
  const api = sandbox({ storage: { 'nullsolve.settings.v1': JSON.stringify({
    apiKey: 'old-key', model: 'gemini-2.5-flash', models: [{ id: 'gemini-2.5-flash', label: 'G', recommended: true }],
    modelsFetchedAt: 5, control: 'ask', theme: 'dark', autoShot: false,
    systemPrompt: 'You are Nullsolve, a concise assistant embedded in a floating panel on top of whatever page the user is looking at. Messages usually arrive with a screenshot of the user’s screen attached: read it carefully and answer about what is actually visible. Prefer short, direct answers. You have the ability to use markdown (including tables) when it makes the answer clearer.'
  }) } });
  const s = api.settings;
  assert.equal(s.provider, 'gemini');
  assert.equal(s.keys.gemini, 'old-key');
  assert.equal(s.models.gemini, 'gemini-2.5-flash');
  assert.equal(s.lists.gemini.list[0].id, 'gemini-2.5-flash');
  assert.equal(s.lists.gemini.at, 5);
  assert.equal(s.control, 'ask');
  assert.equal(s.theme, 'dark');
  assert.equal(s.autoShot, false);
  assert.equal(s.systemPrompt, api.DEFAULT_SYSTEM);
  assert.equal(api.modelLabel('gemini', 'gemini-2.5-flash'), 'G');
});

test('baked config fills gaps but never overrides a saved key', () => {
  const fresh = sandbox({ cfg: { provider: 'anthropic', apiKey: 'ak', model: 'claude-x' } }).settings;
  assert.equal(fresh.provider, 'anthropic');
  assert.equal(fresh.keys.anthropic, 'ak');
  assert.equal(fresh.models.anthropic, 'claude-x');

  const saved = sandbox({ cfg: { provider: 'anthropic', apiKey: 'ak' },
    storage: { 'nullsolve.settings.v2': JSON.stringify({ provider: 'gemini', keys: { gemini: 'g', anthropic: 'mine' } }) } }).settings;
  assert.equal(saved.provider, 'gemini');
  assert.equal(saved.keys.anthropic, 'mine');

  const keyless = sandbox({ cfg: { provider: 'anthropic', apiKey: 'ak' },
    storage: { 'nullsolve.settings.v2': JSON.stringify({ provider: 'gemini', keys: {} }) } }).settings;
  assert.equal(keyless.provider, 'anthropic');
  assert.equal(keyless.keys.anthropic, 'ak');

  const odd = sandbox({ storage: { 'nullsolve.settings.v2': JSON.stringify({ provider: 'xai', reasoning: 'turbo', control: 'yolo', keys: 'nope' }) } }).settings;
  assert.equal(odd.provider, 'gemini');
  assert.equal(odd.reasoning, 'default');
  assert.equal(odd.control, 'off');
  assert.deepEqual(odd.keys, {});
});

test('provider helpers pick sensible defaults', () => {
  const api = sandbox({ cfg: { endpoints: { openai: 'http://127.0.0.1:1/mock/openai/' } } });
  assert.equal(api.modelFor('gemini'), 'gemini-flash-latest');
  assert.equal(api.modelFor('anthropic'), 'claude-opus-5-5');
  assert.equal(api.modelFor('openai'), 'gpt-5.5');
  assert.equal(api.modelFor('deepseek'), 'deepseek-v4-flash');
  assert.equal(api.baseFor('openai'), 'http://127.0.0.1:1/mock/openai');
  assert.equal(api.baseFor('gemini'), api.ENDPOINTS.gemini);
  assert.equal(api.providerReady('gemini'), false);
  api.settings.keys.gemini = ' k ';
  assert.equal(api.providerReady('gemini'), true);
  assert.equal(api.keyFor('gemini'), 'k');
  assert.equal(api.providerReady('custom'), false);
  api.settings.baseUrls.custom = 'http://localhost:11434/v1';
  assert.equal(api.providerReady('custom'), true);
  assert.equal(api.modelVision('deepseek', 'deepseek-v4-flash'), false);
  assert.equal(api.modelVision('openai', 'gpt-5.5'), true);
  api.settings.models.openai = 'gone-model';
  api.setModelList('openai', [{ id: 'gpt-9', label: 'GPT-9', recommended: true }]);
  assert.equal(api.modelFor('openai'), 'gpt-9');
  assert.equal(JSON.parse(api.store[api.LS_SETTINGS]).models.openai, 'gpt-9');
});

test('buildThread windows, strips foreign tool exchanges and merges user turns', () => {
  const api = sandbox();
  const { state, buildThread, nextId } = api;
  const m = (o) => Object.assign({ id: nextId() }, o);
  state.messages = [
    m({ role: 'assistant', text: 'orphan reply', provider: 'gemini' }),
    m({ role: 'user', text: 'a', shot: IMG, images: [], provider: 'gemini' }),
    m({ role: 'assistant', text: 'b', provider: 'gemini' }),
    m({ role: 'user', text: 'c', images: [IMG], provider: 'gemini' }),
    m({ role: 'assistant', text: '', calls: [{ id: 'c1', name: 'list_elements', args: {} }], provider: 'gemini' }),
    m({ role: 'tool', results: [{ id: 'c1', name: 'list_elements', response: { ok: true } }], provider: 'gemini' }),
    m({ role: 'assistant', text: 'd', provider: 'gemini' }),
    m({ role: 'assistant', text: 'failed', error: true }),
    m({ role: 'user', text: 'e', images: [], provider: 'gemini' }),
    m({ role: 'user', text: 'f', images: [IMG], provider: 'gemini' })
  ];
  const same = buildThread('gemini');
  assert.deepEqual(same.map(x => x.role), ['user', 'assistant', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.equal(same[0].text, '(a screenshot was attached here) a');
  assert.deepEqual(same[0].images, []);
  assert.equal(same[2].text, '(a screenshot was attached here) c');
  assert.equal(same[3].calls[0].id, 'c1');
  assert.equal(same[6].text, 'e\n\nf');
  assert.deepEqual(same[6].images, [IMG]);

  const other = buildThread('openai');
  assert.deepEqual(other.map(x => x.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(other[3].text, 'd');

  state.messages.push(m({ role: 'assistant', text: 'dangling', calls: [{ id: 'c9', name: 'click', args: {} }], provider: 'gemini' }));
  const dangling = buildThread('gemini');
  const last = dangling[dangling.length - 1];
  assert.equal(last.role, 'assistant');
  assert.equal(last.text, 'dangling');
  assert.equal(last.calls.length, 0);
});

test('chat persistence keeps only plain text turns and reads the v1 format', () => {
  const api = sandbox({ storage: { 'nullsolve.chat.v1': JSON.stringify({ messages: [
    { role: 'user', text: 'hi', shots: 1 }, { role: 'model', text: 'hello' }, { role: 'user' }, { role: 'model', text: '' }, { role: 'model', text: 'oops', error: true }
  ] }) } });
  api.restoreChat();
  assert.deepEqual(api.state.messages.map(x => [x.role, x.text, x.shots]), [['user', 'hi', 1], ['assistant', 'hello', 0]]);
  api.state.messages.push({ id: api.nextId(), role: 'assistant', text: '', calls: [{ id: 'x', name: 'click', args: {} }] });
  api.state.messages.push({ id: api.nextId(), role: 'tool', results: [{ id: 'x', name: 'click', response: {} }] });
  api.state.messages.push({ id: api.nextId(), role: 'assistant', text: 'done', model: 'm1', provider: 'gemini' });
  api.persistChat();
  const saved = JSON.parse(api.store[api.LS_CHAT]).messages;
  assert.deepEqual(saved.map(x => x.role), ['user', 'assistant', 'assistant']);
  assert.equal(saved[2].model, 'm1');
  assert.equal(saved[0].shots, 1);
});
