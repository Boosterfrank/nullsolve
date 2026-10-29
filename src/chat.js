/* ------------------------------------------------------------- chat run */

function setBusy(busy) {
  state.busy = busy;
  el.dot.classList.toggle('busy', busy);
  el.sendBtn.innerHTML = busy ? I.stop : I.send;
  el.sendBtn.title = busy ? 'Stop' : 'Send';
}

function autoGrow() {
  el.ta.style.height = 'auto';
  var h = Math.min(132, Math.max(32, el.ta.scrollHeight));
  el.ta.style.height = h + 'px';
  el.inrow.classList.toggle('multi', h > 36);
}

function systemPrompt() {
  var sys = (settings.systemPrompt || '').trim();
  if (controlOn() && curProvider().tools) sys = (sys ? sys + '\n\n' : '') + CONTROL_PROMPT;
  return sys;
}

function newBot(p, model) {
  return { id: nextId(), role: 'assistant', text: '', reasoning: '', provider: p.id, model: model, live: true };
}

function removeMessage(m) {
  var i = state.messages.indexOf(m);
  if (i >= 0) state.messages.splice(i, 1);
  dropMessageNode(m);
}

/* After a failure, trailing half-exchanges (a tool call with no result, an
   empty reply) are removed so the next request starts from solid ground. */
function truncateDangling() {
  while (state.messages.length) {
    var last = state.messages[state.messages.length - 1];
    if (last.role === 'tool') { removeMessage(last); continue; }
    if (last.role === 'assistant' && !last.error) {
      if (last.calls && last.calls.length) { removeMessage(last); continue; }
      if (!last.text && !last.reasoning) { removeMessage(last); continue; }
    }
    break;
  }
  if (!state.messages.length) renderMessages();
}

function describeFailure(p, e) {
  if (e && e.name === 'ApiError') return e.message;
  var msg = errText(e);
  if ((e && e.name === 'TypeError') || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    var hostName = '';
    try { hostName = new URL(baseFor(p.id)).host; } catch (err) { hostName = baseFor(p.id); }
    return 'Could not reach ' + p.short + (hostName ? ' at ' + hostName : '') + '. Either the endpoint is wrong, ' +
      'or this site’s Content-Security-Policy blocks requests to it from the page; the panel works on other sites.';
  }
  return msg;
}

async function send(opts) {
  if (state.busy) {
    state.stopRequested = true;
    if (state.pendingConfirm) state.pendingConfirm();
    if (state.abort) state.abort.abort();
    return;
  }

  var p = curProvider();
  var text = opts && typeof opts.text === 'string' ? opts.text : el.ta.value.trim();
  var images = opts && opts.images ? opts.images.slice() : state.pending.slice();
  if (!text && !images.length) return;

  if (!providerReady(p.id)) {
    var needBase = p.needsBase && !baseFor(p.id);
    setView('settings');
    el.note.textContent = needBase ? 'Enter the endpoint URL to start chatting.' : 'Paste an API key to start chatting.';
    try { (needBase ? el.base : el.key).focus(); } catch (e) { }
    return;
  }

  var ctx = ctxFor(p.id);
  var vision = modelVision(p.id, ctx.model);

  /* getDisplayMedia needs transient user activation, so the request has to be
     issued here in the click/Enter task, before anything else is awaited. */
  var capturing = null;
  if (settings.autoShot && vision && !state.sharing && !state.captureOff) capturing = startCapture();

  var dropped = 0;
  if (!vision && images.length) { dropped = images.length; images = []; }

  var user = { id: nextId(), role: 'user', text: text, images: images, shot: null, provider: p.id };
  state.messages.push(user);
  if (!opts) { state.pending = []; el.ta.value = ''; autoGrow(); renderChips(); }
  appendMessage(user);

  var bot = newBot(p, ctx.model);
  state.messages.push(bot);
  appendMessage(bot);
  setBusy(true);
  renderHint(dropped
    ? esc(p.short) + ' models cannot see images, so ' + dropped + ' attachment' + (dropped > 1 ? 's were' : ' was') + ' left out.'
    : '<b>' + esc(modelLabel(p.id, ctx.model)) + '</b> is thinking&hellip;');

  try {
    if (capturing) await capturing;
    if (settings.autoShot && vision && state.sharing) {
      user.shot = await grabFrame(1280);
      if (user.shot) patchMessage(user);
    }
    if (state.stopRequested) { var early = new Error('Stopped'); early.name = 'AbortError'; throw early; }

    var steps = 0;
    while (true) {
      var extrasKey = p.id + '/' + ctx.model;
      state.abort = new AbortController();
      var t0 = Date.now();
      var acc = await streamChat(p, ctx, {
        system: systemPrompt(),
        thread: buildThread(p.id),
        tools: controlOn() && p.tools ? TOOL_SCHEMAS : null,
        reasoning: settings.reasoning,
        extras: !state.noExtras[extrasKey],
        signal: state.abort.signal
      }, {
        onDelta: function (a) { bot.text = a.text; bot.reasoning = a.reasoning; schedulePaint(bot); },
        onExtrasRejected: function (msg) {
          state.noExtras[extrasKey] = true;
          if (window.console && console.info) console.info('[nullsolve] ' + ctx.model + ' rejected optional parameters, retrying without them:', msg);
        }
      });

      bot.text = acc.text;
      bot.reasoning = acc.reasoning;
      bot.raw = acc.raw;
      bot.model = acc.model || ctx.model;
      bot.ms = Date.now() - t0;
      bot.calls = acc.calls.length ? acc.calls : null;

      if (!bot.calls) {
        if (!bot.text) bot.text = '(empty response)';
        bot.live = false;
        patchMessage(bot);
        break;
      }

      bot.calls.forEach(function (c) { c.desc = describeCall(c); });
      patchMessage(bot);

      var results = [];
      for (var ci = 0; ci < bot.calls.length; ci++) {
        var call = bot.calls[ci];
        var out;
        try { out = await runTool(call); }
        catch (err) { out = { error: errText(err) }; }
        if (state.stopRequested) { var stop = new Error('Stopped'); stop.name = 'AbortError'; throw stop; }
        call.result = out;
        results.push({ id: call.id, name: call.name, response: out });
        patchMessage(bot);
      }
      bot.live = false;
      patchMessage(bot);
      state.messages.push({ id: nextId(), role: 'tool', results: results, provider: p.id });

      if (++steps >= 10) {
        var lim = { id: nextId(), role: 'assistant', error: true, text: 'Stopped after 10 automated steps. Say carry on if that was not enough.' };
        state.messages.push(lim);
        appendMessage(lim);
        break;
      }

      bot = newBot(p, ctx.model);
      state.messages.push(bot);
      appendMessage(bot);
    }
  } catch (e) {
    var aborted = (e && e.name === 'AbortError') || state.stopRequested;
    if (aborted && (bot.text || bot.reasoning)) {
      bot.text = (bot.text || '') + '\n\n_Stopped._';
      bot.calls = null;
      bot.live = false;
      patchMessage(bot);
    } else {
      removeMessage(bot);
      if (!aborted) {
        if (e && e.requestBody && window.console && console.warn) console.warn('[nullsolve] request failed', e.status, e.requestBody);
        var errMsg = { id: nextId(), role: 'assistant', error: true, text: describeFailure(p, e), retry: true };
        state.messages.push(errMsg);
        appendMessage(errMsg);
      }
    }
    truncateDangling();
  } finally {
    state.abort = null;
    state.stopRequested = false;
    setBusy(false);
    renderHint();
    persistChat();
    scrollBottom(false);
  }
}

/* Re-sends the last user turn after an error, with a fresh screenshot. */
function resend() {
  if (state.busy) return;
  var i = state.messages.length - 1;
  while (i >= 0 && state.messages[i].role !== 'user') i--;
  if (i < 0) return;
  var user = state.messages[i];
  state.messages.splice(i).forEach(dropMessageNode);
  if (!state.messages.length) renderMessages();
  send({ text: user.text, images: user.images || [] });
}

/* ------------------------------------------------------------- settings */

function fillProviderSelect() {
  el.provider.innerHTML = PROVIDERS.map(function (p) {
    return '<option value="' + p.id + '"' + (p.id === settings.provider ? ' selected' : '') + '>' +
      esc(p.label) + (providerReady(p.id) ? ' ✓' : '') + '</option>';
  }).join('');
}

function fillModelSelect() {
  var pid = settings.provider;
  var cur = modelFor(pid);
  var known = false;
  var opts = listFor(pid).map(function (m) {
    if (m.id === cur) known = true;
    return '<option value="' + esc(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' +
      esc(m.label) + (m.recommended ? ' (recommended)' : '') + '</option>';
  });
  if (!known && cur) opts.unshift('<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>');
  opts.push('<option value="__custom__">Custom model id…</option>');
  el.model.innerHTML = opts.join('');
  el.modelCustom.classList.add('hidden');
  el.modelCustom.value = '';
}

function fillSettings() {
  applySegs();
  fillProviderSelect();
  fillModelSelect();
  var p = curProvider();
  el.key.value = keyFor(p.id);
  el.key.placeholder = p.keyPlaceholder || 'Paste your API key';
  el.baseField.classList.toggle('hidden', !p.needsBase);
  el.base.value = settings.baseUrls[p.id] || '';
  el.keyHelp.innerHTML = p.keyUrl
    ? 'Create one at <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noreferrer noopener">' + esc(p.keyLabel) + '</a>. ' +
      'It is saved in this site’s localStorage only, and sent straight to ' + esc(p.short) + '.'
    : 'Optional. Sent as a Bearer token to the endpoint above, and saved in this site’s localStorage only.';
  el.sys.value = settings.systemPrompt || '';
  el.hideChk.checked = settings.hideInShot !== false;
  var l = settings.lists[p.id];
  el.modelHelp.textContent = l && l.at
    ? 'List loaded from your key on ' + new Date(l.at).toLocaleString() + '.'
    : (p.fallback.length
        ? 'Built-in list. Hit Refresh to load the exact models your key can use.'
        : 'Hit Refresh to load the models this endpoint offers, or type a model id.');
  el.note.textContent = '';
}

/* Key and endpoint fields belong to the provider the form is showing. */
function commitKeyFields() {
  var p = curProvider();
  settings.keys[p.id] = el.key.value.trim();
  if (p.needsBase) settings.baseUrls[p.id] = el.base.value.trim().replace(/\/+$/, '');
}

async function refreshModels(manual) {
  var p = curProvider();
  if (manual) commitKeyFields();
  if (!providerReady(p.id)) {
    if (manual) el.modelHelp.textContent = p.needsBase && !baseFor(p.id) ? 'Enter the endpoint URL first.' : 'Add an API key first.';
    return;
  }
  el.refresh.disabled = true;
  el.refresh.textContent = 'Loading…';
  try {
    var list = await p.listModels(ctxFor(p.id));
    setModelList(p.id, list);
    if (settings.provider === p.id) fillModelSelect();
    el.modelHelp.textContent = list.length + ' models available to this key.';
    renderHint();
  } catch (e) {
    el.modelHelp.textContent = describeFailure(p, e);
  } finally {
    el.refresh.disabled = false;
    el.refresh.textContent = 'Refresh list';
  }
}

function saveFromForm() {
  var p = curProvider();
  var prevKey = keyFor(p.id), prevBase = baseFor(p.id);
  commitKeyFields();
  settings.systemPrompt = el.sys.value;
  var chosen = el.model.value;
  if (chosen === '__custom__') {
    var custom = el.modelCustom.value.trim();
    if (custom) settings.models[p.id] = custom;
  } else if (chosen) {
    settings.models[p.id] = chosen;
  }
  var ok = saveSettings();
  el.note.textContent = ok
    ? 'Saved.'
    : 'Could not write to localStorage on this site — settings apply for this session only.';
  fillProviderSelect();
  renderHint();
  if (!state.messages.length) renderMessages();
  if (providerReady(p.id) && (keyFor(p.id) !== prevKey || baseFor(p.id) !== prevBase)) refreshModels(false);
}

function resetAll() {
  stopCapture();
  state.captureOff = false;
  state.noExtras = {};
  try {
    [LS_SETTINGS, LS_SETTINGS_V1, LS_CHAT, LS_CHAT_V1].forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) { }
  settings = loadSettings();
  state.messages = [];
  state.pending = [];
  applyTheme();
  applyPanelBox();
  fillSettings();
  renderChips();
  renderMessages();
  renderHint();
  el.note.textContent = 'Everything reset.';
}

/* ----------------------------------------------------------- drag/resize */

function draggable(handle, onMove, onStart, onEnd) {
  handle.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('button') && handle !== e.target.closest('button')) return;
    var startX = e.clientX, startY = e.clientY, moved = false;
    if (onStart) onStart(e);
    try { handle.setPointerCapture(e.pointerId); } catch (err) { }

    function move(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      onMove(dx, dy, ev);
      ev.preventDefault();
    }
    function up(ev) {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      try { handle.releasePointerCapture(ev.pointerId); } catch (err) { }
      if (onEnd) onEnd(moved, ev);
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

(function wireDrag() {
  var origin = null;
  draggable(el.hd, function (dx, dy) {
    el.panel.style.left = (origin.x + dx) + 'px';
    el.panel.style.top = (origin.y + dy) + 'px';
  }, function () {
    origin = { x: parseFloat(el.panel.style.left) || 0, y: parseFloat(el.panel.style.top) || 0 };
    el.hd.classList.add('dragging');
  }, function () {
    el.hd.classList.remove('dragging');
    commitPanelBox();
  });

  var box = null;
  draggable(el.rs, function (dx, dy) {
    var w = clamp(box.w - dx, 320, window.innerWidth - 16);
    var h = clamp(box.h - dy, 340, window.innerHeight - 16);
    el.panel.style.width = w + 'px';
    el.panel.style.height = h + 'px';
    el.panel.style.left = (box.x + (box.w - w)) + 'px';
    el.panel.style.top = (box.y + (box.h - h)) + 'px';
  }, function () {
    box = {
      w: el.panel.offsetWidth, h: el.panel.offsetHeight,
      x: parseFloat(el.panel.style.left) || 0, y: parseFloat(el.panel.style.top) || 0
    };
  }, function () {
    commitPanelBox();
  });

  var dotOrigin = null;
  draggable(el.dot, function (dx, dy) {
    el.dot.style.left = (dotOrigin.x + dx) + 'px';
    el.dot.style.top = (dotOrigin.y + dy) + 'px';
    el.dot.classList.add('dragging');
  }, function () {
    dotOrigin = { x: parseFloat(el.dot.style.left) || 0, y: parseFloat(el.dot.style.top) || 0 };
  }, function (moved) {
    el.dot.classList.remove('dragging');
    if (moved) commitDotBox();
    else setMinimized(false);
  });
})();

/* --------------------------------------------------------------- events */

function copyText(text, btn) {
  var done = function () {
    btn.innerHTML = I.check;
    setTimeout(function () { btn.innerHTML = I.copy; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else done();
}

function messageOf(node) {
  var wrapNode = node.closest('[data-id]');
  var id = wrapNode && parseInt(wrapNode.getAttribute('data-id'), 10);
  for (var i = 0; i < state.messages.length; i++) if (state.messages[i].id === id) return state.messages[i];
  return null;
}

var ACTIONS = {
  settings: function () { setView(state.view === 'settings' ? 'chat' : 'settings'); },
  minimize: function () { setMinimized(true); },
  close: function () { destroy(); },
  attach: function () { el.file.click(); },
  share: function () { toggleCapture(); },
  send: function () { send(); },
  save: function () { saveFromForm(); },
  reset: function () { resetAll(); },
  refresh: function () { refreshModels(true); },
  retry: function () { resend(); },
  clearChat: function () {
    state.messages = [];
    persistChat();
    renderMessages();
    el.note.textContent = 'Conversation cleared.';
  },
  eye: function () {
    var shown = el.key.type === 'text';
    el.key.type = shown ? 'password' : 'text';
    el.eye.innerHTML = shown ? I.eye : I.eyeOff;
    el.eye.title = shown ? 'Show key' : 'Hide key';
  },
  copy: function (btn) {
    var m = messageOf(btn);
    copyText(m ? m.text : '', btn);
  },
  copycode: function (btn) {
    var block = btn.closest('.cb');
    var code = block && block.querySelector('code');
    copyText(code ? code.textContent : '', btn);
  }
};

wrap.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.closest) return;
  var zoom = t.closest('[data-zoom]');
  if (zoom) {
    el.lb.querySelector('img').src = zoom.getAttribute('data-zoom');
    el.lb.classList.add('on');
    return;
  }
  var drop = t.closest('[data-drop]');
  if (drop) {
    state.pending.splice(parseInt(drop.getAttribute('data-drop'), 10), 1);
    renderChips();
    return;
  }
  var starter = t.closest('[data-starter]');
  if (starter) {
    el.ta.value = starter.getAttribute('data-starter');
    autoGrow();
    el.ta.focus();
    return;
  }
  var act = t.closest('[data-act]');
  if (act && ACTIONS[act.getAttribute('data-act')]) {
    e.preventDefault();
    ACTIONS[act.getAttribute('data-act')](act);
  }
});

el.lb.addEventListener('click', function () { el.lb.classList.remove('on'); });

function segHandler(attr, apply) {
  return function (e) {
    var b = e.target.closest('[' + attr + ']');
    if (!b) return;
    apply(b.getAttribute(attr));
    saveSettings();
    applySegs();
    renderHint();
  };
}

el.themeSeg.addEventListener('click', segHandler('data-theme-val', function (v) { settings.theme = v; applyTheme(); }));
el.ctrlSeg.addEventListener('click', segHandler('data-ctrl-val', function (v) { settings.control = v; }));
el.reasonSeg.addEventListener('click', segHandler('data-reason-val', function (v) { settings.reasoning = v; }));
el.shotSeg.addEventListener('click', segHandler('data-shot-val', function (v) {
  settings.autoShot = v === '1';
  if (settings.autoShot) state.captureOff = false;
  else if (state.sharing) stopCapture();
}));
el.hideChk.addEventListener('change', function () {
  settings.hideInShot = !!el.hideChk.checked;
  saveSettings();
});

el.model.addEventListener('change', function () {
  var custom = el.model.value === '__custom__';
  el.modelCustom.classList.toggle('hidden', !custom);
  if (custom) el.modelCustom.focus();
});

el.provider.addEventListener('change', function () {
  commitKeyFields();
  settings.provider = providerById(el.provider.value).id;
  saveSettings();
  fillSettings();
  renderHint();
  if (!state.messages.length) renderMessages();
});

el.file.addEventListener('change', function () {
  addFiles(el.file.files);
  el.file.value = '';
});

el.ta.addEventListener('input', autoGrow);
el.ta.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    /* Enter never cancels a reply in progress; the stop button does that. */
    if (!state.busy) send();
  }
  if (e.key === 'Escape') { e.preventDefault(); setMinimized(true); }
});
el.ta.addEventListener('paste', function (e) {
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  var files = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
      var f = items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) { e.preventDefault(); addFiles(files); }
});

['dragenter', 'dragover'].forEach(function (evn) {
  el.panel.addEventListener(evn, function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    e.preventDefault();
    el.panel.classList.add('drop');
  });
});
el.panel.addEventListener('dragleave', function (e) {
  if (!el.panel.contains(e.relatedTarget)) el.panel.classList.remove('drop');
});
el.panel.addEventListener('drop', function (e) {
  el.panel.classList.remove('drop');
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

var onResize = function () {
  if (settings.minimized) applyDotBox(); else applyPanelBox();
};
window.addEventListener('resize', onResize);

/* ----------------------------------------------------------------- life */

function destroy() {
  stopCapture();
  if (state.abort) { try { state.abort.abort(); } catch (e) { } }
  window.removeEventListener('resize', onResize);
  el.panel.classList.add('closing');
  setTimeout(function () { try { host.remove(); } catch (e) { } }, 160);
}

host.__nullsolve = {
  version: APP_VERSION,
  toggle: function () { setMinimized(!settings.minimized); },
  open: function () { setMinimized(false); },
  render: function () { renderMessages(); renderChips(); renderHint(); },
  destroy: destroy,
  state: state,
  settings: function () { return settings; }
};

/* ----------------------------------------------------------------- init */

restoreChat();
applyTheme();
applyPanelBox();
applyDotBox();
setMinimized(!!settings.minimized);
setView('chat');
renderMessages();
renderChips();
renderHint();
autoGrow();
setTimeout(function () { try { el.ta.focus(); } catch (e) { } }, 60);

/* A model list older than a day is refreshed quietly in the background. */
(function refreshStaleList() {
  var pid = settings.provider;
  if (!providerReady(pid)) return;
  var l = settings.lists[pid];
  if (!l || Date.now() - (l.at || 0) > 24 * 3600 * 1000) refreshModels(false);
})();
