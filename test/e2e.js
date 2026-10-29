'use strict';

/*
 * End-to-end tests: the built bookmarklet, running in headless Chromium on
 * the test host page, against the mock provider server. Run with
 * `npm run test:e2e` (after `npm install`). Each case gets a fresh browser
 * context, so localStorage never leaks between them.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./mock-server');
const { build } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '.out', 'dist');
const HOST_URL = 'https://example.test/nullsolve';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const LEGACY_PROMPT = 'You are Nullsolve, a concise assistant embedded in a floating panel on top of whatever page the user is looking at. Messages usually arrive with a screenshot of the user’s screen attached: read it carefully and answer about what is actually visible. Prefer short, direct answers. You have the ability to use markdown (including tables) when it makes the answer clearer.';

let base, browser;
const failures = [];
let passed = 0;

async function api(p, body) {
  const r = await fetch(base + '/mock/' + p, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  return r.json();
}
async function chatRequests() { return (await api('_requests')).filter(r => r.kind === 'chat'); }

function endpoints() {
  return { gemini: base + '/mock/gemini', anthropic: base + '/mock/anthropic', openai: base + '/mock/openai', deepseek: base + '/mock/deepseek' };
}

/* Runs inside the page before any of its scripts. */
function seed(arg) {
  window.__NULLSOLVE_CONFIG__ = Object.assign({ endpoints: arg.endpoints }, arg.cfg || {});
  window.__NULLSOLVE_ENDPOINTS__ = arg.endpoints;
  if (arg.settings) localStorage.setItem('nullsolve.settings.v2', JSON.stringify(arg.settings));
  if (arg.v1) localStorage.setItem('nullsolve.settings.v1', JSON.stringify(arg.v1));
  if (arg.chat) localStorage.setItem('nullsolve.chat.v2', JSON.stringify(arg.chat));
  if (arg.stubCapture) {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getDisplayMedia = async function () {
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      const g = c.getContext('2d');
      g.fillStyle = '#334455'; g.fillRect(0, 0, 640, 360);
      const stream = c.captureStream(15);
      setInterval(function () {
        g.fillStyle = 'hsl(' + (Date.now() % 360) + ',70%,50%)';
        g.fillRect(0, 0, 80, 80);
      }, 40);
      const t = stream.getVideoTracks()[0];
      t.getSettings = function () { return { displaySurface: 'browser', width: 640, height: 360 }; };
      window.__captureCalls = (window.__captureCalls || 0) + 1;
      return stream;
    };
  }
}

function settingsFor(provider, extra) {
  const keys = {}; keys[provider] = 'test-key';
  return Object.assign({ provider: provider, keys: keys, autoShot: false, control: 'off', reasoning: 'default' }, extra || {});
}

async function openPanel(opts) {
  opts = opts || {};
  await api('_reset');
  if (opts.scenario) await api('_scenario', opts.scenario);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(seed, {
    endpoints: endpoints(), cfg: opts.cfg, settings: opts.settings, v1: opts.v1, chat: opts.chat, stubCapture: !!opts.stubCapture
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(base + (opts.url || ('/test/index.html' + (opts.noinject ? '?noinject' : ''))));
  if (!opts.noinject && !opts.url) await page.locator('.ns .panel').waitFor({ state: 'visible' });
  return { context, page, errors };
}

async function sendMessage(page, text) {
  const ta = page.locator('.ns .ta');
  await ta.fill(text);
  await ta.press('Enter');
}

async function waitForReply(page, pattern, timeout) {
  await page.waitForFunction(function (src) {
    var host = document.getElementById('nullsolve-host-v1');
    if (!host || !host.shadowRoot) return false;
    var nodes = host.shadowRoot.querySelectorAll('.msg.bot [data-md]');
    var last = nodes[nodes.length - 1];
    return !!last && new RegExp(src).test(last.innerText);
  }, pattern.source, { timeout: timeout || 15000 });
}

async function waitForHint(page, pattern, timeout) {
  await page.waitForFunction(function (src) {
    var host = document.getElementById('nullsolve-host-v1');
    return !!(host && host.shadowRoot) && new RegExp(src).test(host.shadowRoot.querySelector('.hint').innerText);
  }, pattern.source, { timeout: timeout || 15000 });
}

async function waitIdle(page) {
  await page.waitForFunction(function () {
    var host = document.getElementById('nullsolve-host-v1');
    return host && host.__nullsolve && !host.__nullsolve.state.busy;
  }, null, { timeout: 15000 });
}

function decodeBookmarklet(url) {
  assert.ok(url.startsWith('javascript:'), 'bookmarklet starts with javascript:');
  return decodeURIComponent(url.slice('javascript:'.length));
}

async function run(name, fn) {
  let ctx = null;
  try {
    ctx = await fn();
    if (ctx && ctx.errors && ctx.errors.length) throw new Error('page errors: ' + ctx.errors.join(' | '));
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push({ name, error: e });
    console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       '));
  } finally {
    if (ctx && ctx.context) await ctx.context.close().catch(() => { });
  }
}

/* ----------------------------------------------------------------- cases */

async function main() {
  console.log('building into test/.out/dist with --host ' + HOST_URL);
  const built = await build({ host: HOST_URL, out: OUT });
  console.log('  minified: ' + built.minified);
  const srv = await start(0, { distDir: OUT });
  base = srv.url;
  browser = await chromium.launch();
  console.log('mock server at ' + base);

  for (const provider of ['gemini', 'anthropic', 'openai', 'deepseek']) {
    await run('streams a markdown reply from ' + provider, async () => {
      const t = await openPanel({ settings: settingsFor(provider) });
      /* the stale-list refresh at start-up picks the live recommendation */
      const liveLabel = { gemini: 'Gemini 3.8 Flash', anthropic: 'Claude Opus 5.5', openai: 'GPT-5.4', deepseek: 'DeepSeek V4 Flash' }[provider];
      await waitForHint(t.page, new RegExp(liveLabel.replace('.', '\\.') + ' \u00b7 '));
      await sendMessage(t.page, 'hello there');
      await waitForReply(t.page, new RegExp('Hello from ' + provider + '! You said: hello there'));
      await waitIdle(t.page);
      const bot = t.page.locator('.ns .msg.bot').last();
      assert.equal(await bot.locator('.cb').count(), 1, 'code block rendered');
      assert.equal(await bot.locator('table').count(), 1, 'table rendered');
      assert.equal(await bot.locator('.dots').count(), 0, 'no spinner left behind');
      const meta = await bot.locator('[data-meta]').innerText();
      assert.match(meta, /\d\.\ds/, 'meta shows timing');
      const reqs = await chatRequests();
      assert.equal(reqs.length, 1);
      assert.match(reqs[0].info.system, /^You are Nullsolve/);
      assert.equal(reqs[0].info.tools, 0, 'no tools when page control is off');
      assert.deepEqual(reqs[0].info.extras, provider === 'anthropic' ? ['fallbacks'] : [], 'no speed params at default speed');
      if (provider === 'anthropic') {
        assert.equal(reqs[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
        assert.equal(reqs[0].headers['anthropic-version'], '2026-10-21');
        assert.equal(await bot.locator('.think').count(), 1, 'thinking block shown');
        assert.equal(reqs[0].body.model, 'claude-opus-5-5');
      }
      if (provider === 'openai') {
        assert.equal(reqs[0].headers.authorization, 'Bearer test-key');
        assert.equal(reqs[0].body.max_completion_tokens, 16384);
        assert.equal(reqs[0].body.model, 'gpt-5.4');
      }
      if (provider === 'deepseek') {
        assert.equal(reqs[0].body.max_tokens, 8192);
        assert.equal(await bot.locator('.think').count(), 1, 'reasoning block shown');
        assert.match(await bot.locator('.thinkbody').evaluate(n => n.textContent), /Thinking about it\. Decided\./);
      }
      if (provider === 'gemini') {
        assert.equal(reqs[0].headers['x-goog-api-key'], 'test-key');
        assert.equal(reqs[0].model, 'gemini-3.8-flash');
      }
      assert.match(await t.page.locator('.ns .hint').innerText(), /·/);
      return t;
    });
  }

  for (const provider of ['gemini', 'anthropic', 'openai', 'deepseek']) {
    await run('runs a page-control tool loop on ' + provider, async () => {
      const t = await openPanel({ settings: settingsFor(provider, { control: 'auto' }) });
      await t.page.locator('#q').fill('boots');
      await sendMessage(t.page, 'please apply filters');
      await waitForReply(t.page, /Clicked it\./);
      await waitIdle(t.page);
      assert.equal(await t.page.locator('#out').innerText(), 'APPLIED boots', 'the host page button was clicked');
      assert.equal(await t.page.locator('.ns .arow.ok').count(), 2, 'two tool rows marked done');
      const reqs = await chatRequests();
      assert.equal(reqs.length, 3, 'three requests: list, click, final');
      assert.equal(reqs[0].info.tools, 6);
      assert.equal(reqs[1].info.toolResults.length, 1);
      assert.ok(reqs[1].info.toolResults[0].response.elements.length > 0, 'list_elements returned refs');
      assert.equal(reqs[2].info.toolResults[0].response.clicked, 'Apply filters');
      const b = reqs[2].body;
      if (provider === 'gemini') {
        const parts = b.contents.map(c => c.parts).flat();
        const fc = parts.filter(p => p.functionCall);
        assert.equal(fc.length, 2);
        assert.equal(fc[0].thoughtSignature, 'sig_call_list_1');
        assert.equal(fc[0].functionCall.id, 'call_list_1');
        const fr = parts.filter(p => p.functionResponse);
        assert.deepEqual(fr.map(p => p.functionResponse.id), ['call_list_1', 'call_click_1']);
      } else if (provider === 'anthropic') {
        const asst = b.messages.filter(m => m.role === 'assistant');
        assert.equal(asst.length, 2);
        assert.deepEqual(asst[0].content[0], { type: 'thinking', thinking: 'Considering the request. ', signature: 'sigAAAA0' });
        assert.equal(asst[0].content[1].text, 'Let me look.');
        assert.equal(asst[0].content[2].type, 'tool_use');
        assert.equal(asst[0].content[2].id, 'toolu_call_list_1');
        assert.deepEqual(asst[0].content[2].input, { query: 'apply' });
        const results = b.messages.filter(m => m.role === 'user' && Array.isArray(m.content) && m.content[0].type === 'tool_result');
        assert.deepEqual(results.map(m => m.content[0].tool_use_id), ['toolu_call_list_1', 'toolu_call_click_1']);
      } else {
        const asst = b.messages.filter(m => m.role === 'assistant');
        assert.equal(asst[0].tool_calls[0].id, 'call_list_1');
        assert.equal(asst[0].tool_calls[0].function.name, 'list_elements');
        assert.deepEqual(JSON.parse(asst[0].tool_calls[0].function.arguments), { query: 'apply' });
        const tools = b.messages.filter(m => m.role === 'tool');
        assert.deepEqual(tools.map(m => m.tool_call_id), ['call_list_1', 'call_click_1']);
        if (provider === 'deepseek') assert.equal(asst[0].reasoning_content, 'Thinking about it. Decided.');
        else assert.equal('reasoning_content' in asst[0], false);
      }
      return t;
    });
  }

  await run('asks before acting in Ask-first mode and respects Skip', async () => {
    const t = await openPanel({ settings: settingsFor('openai', { control: 'ask' }) });
    await sendMessage(t.page, 'please apply filters');
    const card = t.page.locator('.ns .cfm');
    await card.waitFor({ state: 'visible' });
    assert.match(await card.innerText(), /Click "Apply filters"/);
    await card.locator('[data-cf="no"]').click();
    await waitForReply(t.page, /The tool reported: The user declined/);
    await waitIdle(t.page);
    assert.equal(await t.page.locator('#out').innerText(), 'nothing yet');
    assert.equal(await t.page.locator('.ns .arow.bad').count(), 1);
    return t;
  });

  await run('attachments are sent to vision models and dropped for DeepSeek', async () => {
    const t = await openPanel({ settings: settingsFor('gemini') });
    await t.page.locator('.ns input[type=file]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await t.page.locator('.ns .chip img').waitFor({ state: 'visible' });
    await sendMessage(t.page, 'what is this');
    await waitForReply(t.page, /I can see 1 image\./);
    await waitIdle(t.page);
    assert.equal(await t.page.locator('.ns .msg.user .shots img').count(), 1, 'thumbnail in the user bubble');
    assert.equal((await chatRequests())[0].info.images, 1);
    await t.context.close();

    const d = await openPanel({ settings: settingsFor('deepseek') });
    await d.page.locator('.ns input[type=file]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await d.page.locator('.ns .chip img').waitFor({ state: 'visible' });
    assert.match(await d.page.locator('.ns .hint').innerText(), /cannot see images/);
    await sendMessage(d.page, 'what is this');
    await waitForReply(d.page, /I see no images\./);
    await waitIdle(d.page);
    assert.equal((await chatRequests())[0].info.images, 0);
    return d;
  });

  await run('takes a screenshot on send and hides the panel while doing it', async () => {
    const t = await openPanel({ settings: settingsFor('openai', { autoShot: true }), stubCapture: true });
    await sendMessage(t.page, 'look at this');
    await waitForReply(t.page, /I can see 1 image\./);
    await waitIdle(t.page);
    assert.equal(await t.page.evaluate(() => window.__captureCalls), 1, 'picker shown once');
    assert.match(await t.page.locator('.ns .chip.live').innerText(), /Screenshot\s+of this tab/);
    assert.equal(await t.page.locator('.ns .msg.user .shots img').count(), 1);
    assert.equal(await t.page.locator('.ns.shy').count(), 0, 'panel visible again after the grab');
    await sendMessage(t.page, 'and again');
    await waitForReply(t.page, /You said: and again\. I can see 1 image\./);
    await waitIdle(t.page);
    assert.equal(await t.page.evaluate(() => window.__captureCalls), 1, 'stream reused, no second prompt');
    const reqs = await chatRequests();
    assert.equal(reqs[1].body.messages.filter(m => m.role === 'user')[0].content, '(a screenshot was attached here) look at this');
    return t;
  });

  await run('falls back when a model rejects optional parameters', async () => {
    const t = await openPanel({ settings: settingsFor('openai', { reasoning: 'fast' }), scenario: { rejectExtrasOnce: true } });
    await sendMessage(t.page, 'hi');
    await waitForReply(t.page, /You said: hi\./);
    await waitIdle(t.page);
    let reqs = await chatRequests();
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].body.reasoning_effort, 'low');
    assert.equal('reasoning_effort' in reqs[1].body, false);
    assert.equal(await t.page.locator('.ns .msg.err').count(), 0);
    await sendMessage(t.page, 'again');
    await waitForReply(t.page, /You said: again\./);
    await waitIdle(t.page);
    reqs = await chatRequests();
    assert.equal(reqs.length, 3, 'the rejection is remembered for the session');
    assert.equal('reasoning_effort' in reqs[2].body, false);
    t.errors = t.errors.filter(e => !/400/.test(e));
    return t;
  });

  await run('shows provider errors with Retry and recovers', async () => {
    const t = await openPanel({ settings: settingsFor('anthropic'), scenario: { status: 500 } });
    await sendMessage(t.page, 'hi');
    const err = t.page.locator('.ns .msg.err');
    await err.waitFor({ state: 'visible' });
    assert.match(await err.innerText(), /Claude is having trouble \(500\)/);
    await waitIdle(t.page);
    await api('_scenario', { status: 0 });
    await err.locator('[data-act="retry"]').click();
    await waitForReply(t.page, /You said: hi\./);
    await waitIdle(t.page);
    assert.equal(await t.page.locator('.ns .msg.err').count(), 0);
    assert.equal(await t.page.locator('.ns .msg.user').count(), 1, 'the user turn was reused, not duplicated');
    assert.equal(await t.page.locator('.ns .msg').count(), 2);
    t.errors = t.errors.filter(e => !/500/.test(e));
    return t;
  });

  await run('explains a rejected key', async () => {
    const t = await openPanel({ settings: settingsFor('gemini'), scenario: { status: 401 } });
    await sendMessage(t.page, 'hi');
    const err = t.page.locator('.ns .msg.err');
    await err.waitFor({ state: 'visible' });
    assert.match(await err.innerText(), /Key rejected by Gemini \(401\)/);
    t.errors = t.errors.filter(e => !/401/.test(e));
    return t;
  });

  await run('stop cancels a slow stream and keeps the partial text', async () => {
    const t = await openPanel({ settings: settingsFor('gemini') });
    await sendMessage(t.page, 'slow please');
    await waitForReply(t.page, /slow word 3/, 20000);
    await t.page.locator('.ns .sendb').click();
    await waitIdle(t.page);
    const text = await t.page.locator('.ns .msg.bot').last().innerText();
    assert.match(text, /slow word/);
    assert.match(text, /Stopped\./);
    assert.equal(await t.page.locator('.ns .msg.err').count(), 0);
    await sendMessage(t.page, 'hello again');
    await waitForReply(t.page, /You said: hello again\./);
    return t;
  });

  await run('history survives a reload without ghosts', async () => {
    const t = await openPanel({ settings: settingsFor('gemini', { control: 'auto' }) });
    await sendMessage(t.page, 'please apply filters');
    await waitForReply(t.page, /Clicked it\./);
    await waitIdle(t.page);
    await t.page.reload();
    await t.page.locator('.ns .panel').waitFor({ state: 'visible' });
    const msgs = t.page.locator('.ns .msg');
    assert.equal(await msgs.count(), 2, 'one user turn and the final reply');
    assert.equal(await t.page.locator('.ns .dots').count(), 0);
    assert.equal(await t.page.locator('.ns .msg.user').innerText(), 'please apply filters');
    await sendMessage(t.page, 'hello');
    await waitForReply(t.page, /You said: hello\./);
    await waitIdle(t.page);
    const all = await chatRequests();
    const req = all[all.length - 1];
    assert.equal(req.body.contents.length, 3, 'restored turns are replayed as text');
    assert.equal(req.body.contents[1].parts[0].text, 'Clicked it.');
    return t;
  });

  await run('migrates v1 settings and keeps the old key', async () => {
    const t = await openPanel({ v1: { apiKey: 'old-key', model: 'gemini-2.5-flash', control: 'off', systemPrompt: LEGACY_PROMPT } });
    assert.match(await t.page.locator('.ns .hint').innerText(), /Gemini 2.5 Flash · Gemini/);
    const v2 = await t.page.evaluate(() => JSON.parse(localStorage.getItem('nullsolve.settings.v2') || 'null'));
    assert.equal(v2 && v2.keys.gemini, 'old-key', 'migrated settings are written back at boot');
    await sendMessage(t.page, 'hi');
    await waitForReply(t.page, /You said: hi\./);
    await waitIdle(t.page);
    const saved = await t.page.evaluate(() => JSON.parse(localStorage.getItem('nullsolve.settings.v2')));
    assert.equal(saved.keys.gemini, 'old-key');
    assert.equal(saved.provider, 'gemini');
    assert.match(saved.systemPrompt, /^You are Nullsolve, a concise assistant in a small floating panel/);
    return t;
  });

  await run('settings: switch provider, load models, save', async () => {
    const t = await openPanel();
    assert.match(await t.page.locator('.ns .empty h3').innerText(), /Add an API key to start/);
    await t.page.locator('.ns [data-act="settings"]').first().click();
    await t.page.locator('.ns [data-el="provider"]').selectOption('anthropic');
    assert.match(await t.page.locator('.ns [data-el="keyHelp"]').innerText(), /platform\.claude\.com/);
    await t.page.locator('.ns [data-el="key"]').fill('sk-ant-test');
    await t.page.locator('.ns [data-act="refresh"]').click();
    await t.page.waitForFunction(function () {
      var host = document.getElementById('nullsolve-host-v1');
      return /3 models available/.test(host.shadowRoot.querySelector('[data-el="modelHelp"]').textContent);
    });
    const options = await t.page.locator('.ns [data-el="model"] option').allInnerTexts();
    assert.ok(options.includes('Claude Opus 5.5 (recommended)'), 'recommended tag: ' + options.join(','));
    assert.equal(await t.page.locator('.ns [data-el="model"]').inputValue(), 'claude-opus-5-5');
    await t.page.locator('.ns [data-el="model"]').selectOption('claude-haiku-5-5');
    await t.page.locator('.ns [data-act="save"]').click();
    assert.equal(await t.page.locator('.ns [data-el="note"]').innerText(), 'Saved.');
    await t.page.locator('.ns [data-act="settings"]').first().click();
    assert.match(await t.page.locator('.ns .hint').innerText(), /Claude Haiku 5.5 · Claude/);
    const saved = await t.page.evaluate(() => JSON.parse(localStorage.getItem('nullsolve.settings.v2')));
    assert.equal(saved.provider, 'anthropic');
    assert.equal(saved.keys.anthropic, 'sk-ant-test');
    assert.equal(saved.models.anthropic, 'claude-haiku-5-5');
    assert.equal(saved.lists.anthropic.list.length, 3);
    await sendMessage(t.page, 'hi');
    await waitForReply(t.page, /Hello from anthropic/);
    await waitIdle(t.page);
    assert.equal((await chatRequests())[0].body.model, 'claude-haiku-5-5');
    return t;
  });

  await run('custom OpenAI-compatible endpoint works without a key', async () => {
    const t = await openPanel({ settings: { provider: 'custom', keys: {}, baseUrls: { custom: base + '/mock/openai/' }, models: { custom: 'local-model' }, autoShot: false } });
    assert.match(await t.page.locator('.ns .hint').innerText(), /local-model · Custom endpoint/);
    await sendMessage(t.page, 'hi');
    await waitForReply(t.page, /You said: hi\./);
    await waitIdle(t.page);
    const req = (await chatRequests())[0];
    assert.equal('authorization' in req.headers, false);
    assert.equal('stream_options' in req.body, false);
    assert.equal(req.body.model, 'local-model');
    return t;
  });

  await run('minimises to the dot and comes back', async () => {
    const t = await openPanel({ settings: settingsFor('gemini') });
    await t.page.locator('.ns [data-act="minimize"]').click();
    await t.page.locator('.ns .dot.on').waitFor({ state: 'visible' });
    assert.equal(await t.page.locator('.ns .panel').isVisible(), false);
    await t.page.locator('.ns .dot').click();
    await t.page.locator('.ns .panel').waitFor({ state: 'visible' });
    await t.page.locator('.ns .ta').press('Escape');
    await t.page.locator('.ns .dot.on').waitFor({ state: 'visible' });
    return t;
  });

  await run('the bookmarklet URL boots the panel and toggles it', async () => {
    const t = await openPanel({ noinject: true, settings: settingsFor('gemini') });
    const code = decodeBookmarklet(fs.readFileSync(path.join(OUT, 'nullsolve.bookmarklet.txt'), 'utf8'));
    await t.page.addScriptTag({ content: code });
    await t.page.locator('.ns .panel').waitFor({ state: 'visible' });
    await t.page.addScriptTag({ content: code });
    await t.page.locator('.ns .dot.on').waitFor({ state: 'visible' });
    await t.page.addScriptTag({ content: code });
    await t.page.locator('.ns .panel').waitFor({ state: 'visible' });
    assert.equal(await t.page.locator('#nullsolve-host-v1').count(), 1, 'one host element');
    await sendMessage(t.page, 'hi');
    await waitForReply(t.page, /Hello from gemini/);
    const loader = fs.readFileSync(path.join(OUT, 'nullsolve.loader.txt'), 'utf8');
    assert.match(decodeBookmarklet(loader), new RegExp(HOST_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/nullsolve\\.js'));
    assert.ok(loader.length < 1024, 'loader stays tiny: ' + loader.length);
    return t;
  });

  await run('the install page bakes a provider, key and model into the bookmarklet', async () => {
    const t = await openPanel({ url: '/dist/index.html' });
    await t.page.locator('#prov').selectOption('openai');
    await t.page.locator('#key').fill('sk-baked');
    await t.page.locator('#load').click();
    await t.page.waitForFunction(() => /3 models available/.test(document.getElementById('modelHelp').textContent));
    const options = await t.page.locator('#model option').allInnerTexts();
    assert.ok(options.includes('GPT-5.4 (recommended)'), options.join(','));
    assert.equal(await t.page.locator('#model').inputValue(), 'gpt-5.4');
    assert.match(await t.page.locator('#status').innerText(), /OpenAI key and model baked in/);
    const href = await t.page.locator('#drag').getAttribute('href');
    const code = decodeBookmarklet(href);
    assert.match(code, /^window\.__NULLSOLVE_CONFIG__=\{"provider":"openai","apiKey":"sk-baked","model":"gpt-5\.4"\};/);
    assert.ok(await t.page.locator('#dragLoader').count() === 1, 'loader button present when built with --host');
    const loaderHref = await t.page.locator('#dragLoader').getAttribute('href');
    assert.match(decodeBookmarklet(loaderHref), /^window\.__NULLSOLVE_CONFIG__=\{"provider":"openai"/);
    await t.context.close();

    const h = await openPanel({ noinject: true });
    await h.page.addScriptTag({ content: code.replace('window.__NULLSOLVE_CONFIG__=', 'window.__NULLSOLVE_CONFIG__=Object.assign({endpoints:window.__NULLSOLVE_ENDPOINTS__},') .replace('};', '});') });
    await h.page.locator('.ns .panel').waitFor({ state: 'visible' });
    assert.match(await h.page.locator('.ns .hint').innerText(), /GPT-5.4 · OpenAI/);
    await sendMessage(h.page, 'baked hi');
    await waitForReply(h.page, /Hello from openai! You said: baked hi/);
    await waitIdle(h.page);
    assert.equal((await chatRequests())[0].headers.authorization, 'Bearer sk-baked');
    return h;
  });

  await browser.close();
  srv.server.close();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
