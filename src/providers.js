/* ----------------------------------------------------------- providers
   One adapter per provider. They are pure: no DOM, no settings. Each gets
   a ctx ({ key, base, model, fetch }) and a neutral thread:

     { role: 'user',      text, images: [dataUrl] }
     { role: 'assistant', text, calls: [{ id, name, args, sig }], raw, reasoning }
     { role: 'tool',      results: [{ id, name, response }] }

   and turns it into the provider's wire format, then folds that provider's
   stream events back into a neutral accumulator:

     { text, reasoning, calls: [{ id, name, args, sig }], raw, model, stop, usage }

   `raw` keeps a provider's own assistant content blocks when they have to
   be echoed back verbatim (Claude's thinking signatures). `req.extras`
   switches optional request parameters on; streamChat() retries once
   without them when a model rejects the request outright, so a wrong
   guess about what a model supports costs one round trip, never a dead
   end. The install page reuses this file for "Load from my key". */

var ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  custom: ''
};

var ANTHROPIC_VERSION = '2026-10-21';
var ANTHROPIC_BETAS = 'server-side-fallback-2026-07-01';

function versionNum(id, rx) {
  var m = rx.exec(String(id));
  return m ? parseFloat(m[1]) : 0;
}

/* Fallback lists may pin their own recommendation (an alias that never goes
   stale); live lists are scored. */
function ensureRecommended(list, score) {
  return list.some(function (m) { return m.recommended; }) ? list : pickRecommended(list, score);
}

function pickRecommended(list, score) {
  var best = null, bestScore = 0;
  list.forEach(function (m) {
    m.recommended = false;
    var s = score(m.id);
    if (s > bestScore) { bestScore = s; best = m; }
  });
  if (!best && list.length) best = list[0];
  if (best) best.recommended = true;
  return list;
}

function describeError(provider, status, text) {
  var msg = extractError(text);
  var who = provider.short;
  if (status === 401 || status === 403 ||
      (status === 400 && /api key|api_key|invalid x-api-key|authentication|unauthori[sz]ed/i.test(msg))) {
    return 'Key rejected by ' + who + ' (' + status + '). ' + msg + ' Check the key in Settings.';
  }
  if (status === 404) {
    return (msg || 'Not found.') + ' The model id may not be available to this key: open Settings and refresh the model list.';
  }
  if (status === 429) return 'Rate limit or quota reached on ' + who + '. ' + msg;
  if (status >= 500) return who + ' is having trouble (' + status + '). ' + (msg || 'Try again in a moment.');
  if (status === 400 && /thought_signature|thoughtSignature/i.test(msg)) {
    return msg + ' Clear the chat and try again.';
  }
  if (status === 400 && /tool_use|tool_result|tool call|function|functionResponse|\brole\b/i.test(msg)) {
    return msg + ' (This came from a page-control tool exchange. Clear the chat, or turn Page control off, to keep chatting.)';
  }
  return who + ' error ' + status + '. ' + (msg || 'No details were returned.');
}

function baseAcc() {
  return { text: '', reasoning: '', calls: [], raw: null, model: '', stop: '', usage: null, blocks: [], seen: {}, byIndex: {} };
}

/* Appends a short note when a stream ended for a reason the user should
   know about and nothing else explains it. */
function finishNote(acc) {
  var s = String(acc.stop || '');
  if (!acc.text && !acc.calls.length) {
    if (/refusal/i.test(s)) acc.text = '(The model declined to answer this request.)';
    else if (/safety|prohibited|recitation|content_filter|blocklist|spii/i.test(s)) acc.text = '(The reply was blocked: ' + s + '.)';
  } else if (/max_tokens|length|MAX_TOKENS/i.test(s) && acc.text) {
    acc.text += '\n\n_(cut off at the output limit)_';
  }
}

/* Converts the JSON-Schema tool declarations into Gemini's Schema shape:
   the same tree, with upper-case type names. */
function geminiSchema(node) {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  var out = {};
  Object.keys(node).forEach(function (k) {
    if (k === 'type' && typeof node[k] === 'string') out[k] = node[k].toUpperCase();
    else if (k === 'additionalProperties') return;
    else out[k] = geminiSchema(node[k]);
  });
  return out;
}

/* ------------------------------------------------------------- gemini */

var GEMINI = {
  id: 'gemini',
  label: 'Google Gemini',
  short: 'Gemini',
  vision: true,
  tools: true,
  keyUrl: 'https://aistudio.google.com/apikey',
  keyLabel: 'aistudio.google.com/apikey',
  keyPlaceholder: 'AIza…',
  fallback: [
    { id: 'gemini-flash-latest', label: 'Gemini Flash — latest', recommended: true },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite — latest' },
    { id: 'gemini-pro-latest', label: 'Gemini Pro — latest' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }
  ],
  /* The newest plain Flash model is the sweet spot for a side panel. */
  score: function (id) {
    if (!/flash/.test(id)) return -1;
    if (/(lite|image|audio|tts|live|embedding|vision|thinking|8b|native|robotics)/.test(id)) return -1;
    var s = versionNum(id, /gemini-(\d+(?:\.\d+)?)/) * 100;
    if (/-latest$/.test(id)) s += 40;
    if (/(preview|exp)/.test(id)) s -= 8;
    if (/\d{3,}/.test(id.replace(/gemini-\d+(?:\.\d+)?/, ''))) s -= 4;
    return s;
  },
  headers: function (ctx) {
    return { 'content-type': 'application/json', 'x-goog-api-key': ctx.key };
  },
  errorMessage: function (status, text) { return describeError(GEMINI, status, text); },
  listModels: async function (ctx) {
    var data = await getJson(ctx, ctx.base + '/models?pageSize=200', GEMINI.headers(ctx), GEMINI.errorMessage);
    var list = (data.models || []).filter(function (m) {
      var methods = m.supportedGenerationMethods || m.supportedActions || [];
      return methods.indexOf('generateContent') >= 0 &&
        !/embedding|aqa|imagen|veo|tts|audio|live|robotics|computer-use/.test(m.name || '');
    }).map(function (m) {
      var id = String(m.name || '').replace(/^models\//, '');
      return { id: id, label: m.displayName || prettyModelName(id) };
    });
    if (!list.length) throw new Error('That key returned no usable models.');
    list.sort(function (a, b) {
      return versionNum(b.id, /gemini-(\d+(?:\.\d+)?)/) - versionNum(a.id, /gemini-(\d+(?:\.\d+)?)/) ||
        a.id.localeCompare(b.id);
    });
    return pickRecommended(list, GEMINI.score);
  },
  thinking: function (model, reasoning) {
    if (reasoning !== 'fast' && reasoning !== 'deep') return null;
    var v = versionNum(model, /gemini-(\d+(?:\.\d+)?)/);
    if (v && v < 3) {
      /* 2.x models take a numeric budget; Pro cannot switch thinking off. */
      if (reasoning === 'fast') return { thinkingBudget: /pro/.test(model) ? 128 : 0 };
      return { thinkingBudget: 24576 };
    }
    return { thinkingLevel: reasoning === 'fast' ? 'low' : 'high' };
  },
  build: function (ctx, req) {
    var contents = [];
    req.thread.forEach(function (m) {
      if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: m.results.map(function (r) {
            var fr = { name: r.name, response: toolResultObject(r.response) };
            if (r.id) fr.id = r.id;
            return { functionResponse: fr };
          })
        });
        return;
      }
      var parts = [];
      if (m.role === 'user') {
        (m.images || []).forEach(function (src) {
          var pp = dataUrlParts(src);
          if (pp) parts.push({ inline_data: { mime_type: pp.mime, data: pp.data } });
        });
        if (m.text) parts.push({ text: m.text });
        if (!parts.length) parts.push({ text: ' ' });
        contents.push({ role: 'user', parts: parts });
        return;
      }
      if (m.text) parts.push({ text: m.text });
      (m.calls || []).forEach(function (c) {
        var fc = { name: c.name, args: c.args || {} };
        if (c.id) fc.id = c.id;
        var part = { functionCall: fc };
        if (c.sig) part.thoughtSignature = c.sig;
        parts.push(part);
      });
      if (parts.length) contents.push({ role: 'model', parts: parts });
    });

    var body = { contents: contents, generationConfig: { maxOutputTokens: 8192 } };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    if (req.tools && req.tools.length) {
      body.tools = [{
        functionDeclarations: req.tools.map(function (t) {
          return { name: t.name, description: t.description, parameters: geminiSchema(t.parameters) };
        })
      }];
    }
    var hasExtras = false;
    if (req.extras) {
      var th = GEMINI.thinking(ctx.model, req.reasoning);
      if (th) { body.generationConfig.thinkingConfig = th; hasExtras = true; }
    }
    return {
      url: ctx.base + '/models/' + encodeURIComponent(ctx.model) + ':streamGenerateContent?alt=sse',
      headers: GEMINI.headers(ctx),
      body: body,
      hasExtras: hasExtras
    };
  },
  newAcc: baseAcc,
  onEvent: function (acc, ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.error) throw new Error(d.error.message || 'Stream error');
    if (d.promptFeedback && d.promptFeedback.blockReason) {
      throw new Error('Request blocked: ' + d.promptFeedback.blockReason);
    }
    if (d.usageMetadata) acc.usage = d.usageMetadata;
    if (d.modelVersion) acc.model = d.modelVersion;
    var cand = d.candidates && d.candidates[0];
    if (!cand) return;
    if (cand.finishReason) acc.stop = cand.finishReason;
    ((cand.content && cand.content.parts) || []).forEach(function (pt) {
      if (typeof pt.text === 'string') {
        if (pt.thought) acc.reasoning += pt.text;
        else acc.text += pt.text;
      }
      if (pt.functionCall) {
        /* Thinking models attach an opaque thoughtSignature to the part; it
           must be echoed back verbatim or the next turn is rejected. */
        var sig = pt.thoughtSignature || pt.thought_signature || null;
        var fc = { name: pt.functionCall.name, args: pt.functionCall.args || {}, sig: sig };
        if (pt.functionCall.id) fc.id = pt.functionCall.id;
        var key = fc.id || (fc.name + '|' + JSON.stringify(fc.args));
        if (!acc.seen[key]) { acc.seen[key] = fc; acc.calls.push(fc); }
        else if (sig && !acc.seen[key].sig) acc.seen[key].sig = sig;
      }
    });
  },
  finish: function (acc) { finishNote(acc); }
};

/* ---------------------------------------------------------- anthropic */

var ANTHROPIC = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  short: 'Claude',
  vision: true,
  tools: true,
  keyUrl: 'https://platform.claude.com/settings/keys',
  keyLabel: 'platform.claude.com',
  keyPlaceholder: 'sk-ant-…',
  fallback: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  score: function (id) {
    if (id === 'claude-opus-5-5') return 1e6;
    var m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
    if (!m) return -1;
    var v = parseFloat(m[2] + '.' + (m[3] || '0'));
    var s = v * 100 + (m[1] === 'opus' ? 3 : m[1] === 'sonnet' ? 2 : 1);
    if (/\d{8}$/.test(id)) s -= 1;
    return s;
  },
  headers: function (ctx, extras) {
    var h = {
      'content-type': 'application/json',
      'x-api-key': ctx.key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (extras) h['anthropic-beta'] = ANTHROPIC_BETAS;
    return h;
  },
  errorMessage: function (status, text) { return describeError(ANTHROPIC, status, text); },
  listModels: async function (ctx) {
    var data = await getJson(ctx, ctx.base + '/models?limit=1000', ANTHROPIC.headers(ctx, false), ANTHROPIC.errorMessage);
    var list = (data.data || []).filter(function (m) {
      return m && m.id && (!m.type || m.type === 'model');
    }).map(function (m) {
      var item = { id: m.id, label: m.display_name || prettyModelName(m.id) };
      var caps = m.capabilities || {};
      if (caps.image_input && caps.image_input.supported === false) item.vision = false;
      if (m.created_at) item.created = Date.parse(m.created_at) || 0;
      return item;
    });
    if (!list.length) throw new Error('That key returned no usable models.');
    list.sort(function (a, b) {
      return ANTHROPIC.score(b.id) - ANTHROPIC.score(a.id) || (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id);
    });
    list.forEach(function (m) { delete m.created; });
    return pickRecommended(list, ANTHROPIC.score);
  },
  /* Assistant turns are replayed from the provider's own content blocks so
     thinking blocks and their signatures go back untouched. Messages that
     came from another provider are rebuilt from text and calls. */
  assistantBlocks: function (m) {
    if (m.raw && m.raw.length) return m.raw;
    var blocks = [];
    if (m.text) blocks.push({ type: 'text', text: m.text });
    (m.calls || []).forEach(function (c) {
      blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
    });
    return blocks;
  },
  build: function (ctx, req) {
    var messages = [];
    req.thread.forEach(function (m) {
      if (m.role === 'tool') {
        messages.push({
          role: 'user',
          content: m.results.map(function (r) {
            var block = { type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(toolResultObject(r.response)) };
            if (r.response && r.response.error) block.is_error = true;
            return block;
          })
        });
        return;
      }
      if (m.role === 'user') {
        var content = [];
        (m.images || []).forEach(function (src) {
          var pp = dataUrlParts(src);
          if (pp) content.push({ type: 'image', source: { type: 'base64', media_type: pp.mime, data: pp.data } });
        });
        if (m.text) content.push({ type: 'text', text: m.text });
        if (!content.length) content.push({ type: 'text', text: '(empty message)' });
        messages.push({ role: 'user', content: content });
        return;
      }
      var blocks = ANTHROPIC.assistantBlocks(m).filter(function (b) {
        return !(b.type === 'text' && !b.text);
      });
      if (blocks.length) messages.push({ role: 'assistant', content: blocks });
    });

    var body = { model: ctx.model, max_tokens: 16384, stream: true, messages: messages };
    if (req.system) body.system = req.system;
    if (req.tools && req.tools.length) {
      body.tools = req.tools.map(function (t) {
        return { name: t.name, description: t.description, input_schema: t.parameters };
      });
    }
    var hasExtras = false;
    if (req.extras) {
      /* Effort is the one knob current models expose; thinking itself stays on
         the model's adaptive default. The fallbacks beta reroutes a safety
         refusal to another model instead of returning an empty turn. */
      if (req.reasoning === 'fast') body.output_config = { effort: 'low' };
      else if (req.reasoning === 'deep') body.output_config = { effort: 'xhigh' };
      body.fallbacks = 'default';
      hasExtras = true;
    }
    return { url: ctx.base + '/messages', headers: ANTHROPIC.headers(ctx, hasExtras), body: body, hasExtras: hasExtras };
  },
  newAcc: baseAcc,
  onEvent: function (acc, ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    var t = d.type, b;
    if (t === 'message_start') {
      if (d.message) { acc.model = d.message.model || acc.model; acc.usage = d.message.usage || null; }
      return;
    }
    if (t === 'content_block_start') {
      b = Object.assign({ partial: '' }, d.content_block || {});
      if (b.type === 'text') b.text = b.text || '';
      if (b.type === 'thinking') { b.thinking = b.thinking || ''; b.signature = b.signature || ''; }
      acc.blocks[d.index] = b;
      return;
    }
    if (t === 'content_block_delta') {
      b = acc.blocks[d.index];
      if (!b) return;
      var dl = d.delta || {};
      if (dl.type === 'text_delta') { b.text += dl.text || ''; acc.text += dl.text || ''; }
      else if (dl.type === 'input_json_delta') b.partial += dl.partial_json || '';
      else if (dl.type === 'thinking_delta') { b.thinking += dl.thinking || ''; acc.reasoning += dl.thinking || ''; }
      else if (dl.type === 'signature_delta') b.signature += dl.signature || '';
      return;
    }
    if (t === 'content_block_stop') {
      b = acc.blocks[d.index];
      if (b && b.type === 'tool_use') {
        b.input = parseArgs(b.partial, b.input);
        acc.calls.push({ id: b.id, name: b.name, args: b.input });
      }
      return;
    }
    if (t === 'message_delta') {
      if (d.delta && d.delta.stop_reason) acc.stop = d.delta.stop_reason;
      if (d.usage) acc.usage = Object.assign(acc.usage || {}, d.usage);
      return;
    }
    if (t === 'error') throw new Error((d.error && d.error.message) || 'Stream error');
  },
  finish: function (acc) {
    acc.raw = acc.blocks.filter(Boolean).map(function (b) {
      if (b.type === 'text') return { type: 'text', text: b.text || '' };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking || '', signature: b.signature || '' };
      if (b.type === 'redacted_thinking') return { type: 'redacted_thinking', data: b.data };
      var copy = Object.assign({}, b);
      delete copy.partial;
      return copy;
    });
    finishNote(acc);
  }
};

/* --------------------------------------------- openai-style (3 flavours) */

function labelOpenAI(id) {
  var parts = String(id).split('-');
  var head = { gpt: 'GPT', chatgpt: 'ChatGPT' }[parts[0]] || parts[0];
  var out = head;
  for (var i = 1; i < parts.length; i++) {
    var p = parts[i];
    if (/^\d/.test(p)) out += (i === 1 ? '-' : ' ') + p;
    else out += ' ' + p.charAt(0).toUpperCase() + p.slice(1);
  }
  return out;
}

function makeOpenAIStyle(spec) {
  var P = {
    id: spec.id,
    label: spec.label,
    short: spec.short,
    vision: spec.vision !== false,
    tools: true,
    needsBase: !!spec.needsBase,
    keyOptional: !!spec.keyOptional,
    keyUrl: spec.keyUrl || '',
    keyLabel: spec.keyLabel || '',
    keyPlaceholder: spec.keyPlaceholder || '',
    fallback: spec.fallback || [],
    score: spec.score || function () { return 0; },
    headers: function (ctx) {
      var h = { 'content-type': 'application/json' };
      if (ctx.key) h.authorization = 'Bearer ' + ctx.key;
      return h;
    },
    errorMessage: function (status, text) { return describeError(P, status, text); },
    listModels: async function (ctx) {
      var data = await getJson(ctx, ctx.base.replace(/\/$/, '') + '/models', P.headers(ctx), P.errorMessage);
      var rows = Array.isArray(data) ? data : (data.data || data.models || []);
      var list = rows.map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || ''); })
        .filter(function (id) { return id && (!spec.keep || spec.keep(id)); })
        .map(function (id) { return { id: id, label: (spec.labelFor || labelOpenAI)(id) }; });
      if (!list.length) throw new Error('That key returned no usable models.');
      list.sort(function (a, b) {
        return P.score(b.id) - P.score(a.id) || a.id.localeCompare(b.id);
      });
      return pickRecommended(list, P.score);
    },
    build: function (ctx, req) {
      var messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      req.thread.forEach(function (m) {
        if (m.role === 'tool') {
          m.results.forEach(function (r) {
            messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(toolResultObject(r.response)) });
          });
          return;
        }
        if (m.role === 'user') {
          var images = m.images || [];
          if (images.length) {
            var content = [{ type: 'text', text: m.text || ' ' }];
            images.forEach(function (src) {
              content.push({ type: 'image_url', image_url: { url: src, detail: 'auto' } });
            });
            messages.push({ role: 'user', content: content });
          } else {
            messages.push({ role: 'user', content: m.text || ' ' });
          }
          return;
        }
        var msg = { role: 'assistant', content: m.text || null };
        if (m.calls && m.calls.length) {
          msg.tool_calls = m.calls.map(function (c) {
            return { id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } };
          });
        }
        /* DeepSeek's thinking mode insists on seeing its own reasoning again
           whenever tools are in play, and ignores it otherwise. */
        if (spec.flavor === 'deepseek' && m.reasoning) msg.reasoning_content = m.reasoning;
        if (msg.content || msg.tool_calls) messages.push(msg);
      });

      var body = { model: ctx.model, messages: messages, stream: true };
      if (spec.flavor !== 'custom') body.stream_options = { include_usage: true };
      if (spec.flavor === 'openai') body.max_completion_tokens = 16384;
      if (spec.flavor === 'deepseek') body.max_tokens = 8192;
      if (req.tools && req.tools.length) {
        body.tools = req.tools.map(function (t) {
          return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
        });
      }
      var hasExtras = false;
      if (req.extras && spec.extras) hasExtras = !!spec.extras(body, req.reasoning, ctx.model);
      return {
        url: ctx.base.replace(/\/$/, '') + '/chat/completions',
        headers: P.headers(ctx),
        body: body,
        hasExtras: hasExtras
      };
    },
    newAcc: baseAcc,
    onEvent: function (acc, ev) {
      var d = ev.data;
      if (d === '[DONE]' || !d || typeof d !== 'object') return;
      if (d.error) throw new Error(d.error.message || d.error.type || 'Stream error');
      if (d.usage) acc.usage = d.usage;
      if (d.model) acc.model = d.model;
      var ch = d.choices && d.choices[0];
      if (!ch) return;
      var dl = ch.delta || ch.message || {};
      if (typeof dl.content === 'string') acc.text += dl.content;
      var rc = dl.reasoning_content != null ? dl.reasoning_content : dl.reasoning;
      if (typeof rc === 'string') acc.reasoning += rc;
      (dl.tool_calls || []).forEach(function (tc) {
        var i = tc.index == null ? acc.calls.length : tc.index;
        var c = acc.byIndex[i];
        if (!c) {
          c = acc.byIndex[i] = { id: '', name: '', partial: '' };
          acc.calls.push(c);
        }
        if (tc.id) c.id = tc.id;
        if (tc.function) {
          if (tc.function.name && !c.name) c.name = tc.function.name;
          if (tc.function.arguments) c.partial += tc.function.arguments;
        }
      });
      if (ch.finish_reason) acc.stop = ch.finish_reason;
    },
    finish: function (acc) {
      acc.calls.forEach(function (c) {
        c.args = parseArgs(c.partial, {});
        delete c.partial;
        if (!c.id) c.id = randomId('call_');
      });
      finishNote(acc);
    }
  };
  return P;
}

var OPENAI = makeOpenAIStyle({
  id: 'openai',
  label: 'OpenAI GPT',
  short: 'OpenAI',
  flavor: 'openai',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyLabel: 'platform.openai.com/api-keys',
  keyPlaceholder: 'sk-…',
  fallback: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'gpt-5.1', label: 'GPT-5.1' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' }
  ],
  keep: function (id) {
    if (!/^(gpt-|o\d|chatgpt-)/.test(id)) return false;
    return !/(embedding|tts|whisper|transcrib|audio|realtime|image|dall-e|moderation|search|instruct|codex|computer-use|davinci|babbage|deep-research|sora|-pro\b|-pro$|\d{4}-\d{2}-\d{2}$)/.test(id);
  },
  /* Newest mainline GPT first; mini and nano trail it, aliases trail those. */
  score: function (id) {
    var m = /^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|chat-latest))?$/.exec(id);
    if (!m) return /^(gpt|o\d|chatgpt)/.test(id) ? 1 : -1;
    var tier = m[2] === 'mini' ? 6 : m[2] === 'chat-latest' ? 4 : m[2] === 'nano' ? 2 : 8;
    return parseFloat(m[1]) * 100 + tier;
  },
  extras: function (body, reasoning) {
    if (reasoning === 'fast') body.reasoning_effort = 'low';
    else if (reasoning === 'deep') body.reasoning_effort = 'high';
    else return false;
    return true;
  }
});

var DEEPSEEK = makeOpenAIStyle({
  id: 'deepseek',
  label: 'DeepSeek',
  short: 'DeepSeek',
  flavor: 'deepseek',
  vision: false,
  keyUrl: 'https://platform.deepseek.com/api_keys',
  keyLabel: 'platform.deepseek.com/api_keys',
  keyPlaceholder: 'sk-…',
  fallback: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
  ],
  labelFor: function (id) {
    return String(id).split('-').map(function (p) {
      if (p === 'deepseek') return 'DeepSeek';
      return /^v\d/.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  },
  score: function (id) {
    if (/^deepseek-(v4-)?flash$/.test(id)) return 100;
    if (/^deepseek-(v4-)?pro$/.test(id)) return 90;
    if (/flash/.test(id)) return 80;
    if (id === 'deepseek-chat') return 50;
    if (id === 'deepseek-reasoner') return 40;
    return 10;
  },
  extras: function (body, reasoning) {
    if (reasoning === 'fast') body.thinking = { type: 'disabled' };
    else if (reasoning === 'deep') { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'high'; }
    else return false;
    return true;
  }
});

var CUSTOM = makeOpenAIStyle({
  id: 'custom',
  label: 'OpenAI-compatible (custom URL)',
  short: 'Custom endpoint',
  flavor: 'custom',
  needsBase: true,
  keyOptional: true,
  keyPlaceholder: 'API key, if the endpoint needs one',
  labelFor: function (id) { return id; },
  fallback: []
});

var PROVIDERS = [GEMINI, ANTHROPIC, OPENAI, DEEPSEEK, CUSTOM];

function providerById(id) {
  for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
  return GEMINI;
}

function ApiError(message, status, requestBody) {
  var e = new Error(message);
  e.name = 'ApiError';
  e.status = status;
  e.requestBody = requestBody;
  return e;
}

/* Runs one streamed turn. hooks: { onDelta(acc), onExtrasRejected(msg) }.
   A 400 with optional parameters in play is retried once without them. */
async function streamChat(provider, ctx, req, hooks) {
  hooks = hooks || {};
  var extras = req.extras !== false;
  for (var attempt = 0; attempt < 2; attempt++) {
    var r = provider.build(ctx, Object.assign({}, req, { extras: extras }));
    var res = await (ctx.fetch || fetch)(r.url, {
      method: 'POST',
      headers: r.headers,
      body: JSON.stringify(r.body),
      signal: req.signal
    });
    if (!res.ok) {
      var txt = await res.text();
      if (res.status === 400 && r.hasExtras && attempt === 0) {
        extras = false;
        if (hooks.onExtrasRejected) hooks.onExtrasRejected(extractError(txt));
        continue;
      }
      throw ApiError(provider.errorMessage(res.status, txt), res.status, r.body);
    }
    var acc = provider.newAcc();
    await readSSE(res, function (ev) {
      provider.onEvent(acc, ev);
      if (hooks.onDelta) hooks.onDelta(acc);
    });
    provider.finish(acc);
    acc.extrasUsed = r.hasExtras;
    return acc;
  }
  throw new Error('Request failed.');
}
