/* ------------------------------------------------------ icons + markdown */

var LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect x="29" y="19" width="42" height="62" rx="21" fill="#F0EFEA"/><rect x="40.5" y="30.5" width="19" height="39" rx="9.5" fill="#000"/></svg>';

function ico(inner) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
}

var I = {
  gear: ico('<circle cx="12" cy="12" r="3"/><path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  min: ico('<path d="M5 12h14"/>'),
  close: ico('<path d="M18 6 6 18M6 6l12 12"/>'),
  back: ico('<path d="M15 18l-6-6 6-6"/>'),
  plus: ico('<path d="M12 5v14M5 12h14"/>'),
  screen: ico('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  send: ico('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  stop: ico('<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>'),
  refresh: ico('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  eye: ico('<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: ico('<path d="M3 3l18 18"/><path d="M10.6 5.1A11 11 0 0 1 12 5c6.5 0 10.5 7 10.5 7a19 19 0 0 1-3.2 4.1M6.2 6.3A19 19 0 0 0 1.5 12S5.5 19 12 19a11 11 0 0 0 4.2-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  copy: ico('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  check: ico('<path d="M20 6 9 17l-5-5"/>'),
  retry: ico('<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/>'),
  chev: ico('<path d="M9 6l6 6-6 6"/>')
};

function inlineMd(src) {
  var codes = [];
  var t = esc(src);
  t = t.replace(/`([^`\n]+)`/g, function (m, c) {
    codes.push(c);
    return '@@NSCOD' + (codes.length - 1) + '@@';
  });
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  t = t.replace(/@@NSCOD(\d+)@@/g, function (m, i) { return '<code>' + codes[+i] + '</code>'; });
  return t;
}

function splitRow(line) {
  var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map(function (c) { return c.trim(); });
}

function codeBlockHtml(lang, code) {
  return '<div class="cb">' +
    '<div class="cbh">' +
      '<span class="cbl">' + esc(lang || 'code') + '</span>' +
      '<button class="ib sm" data-act="copycode" title="Copy code" aria-label="Copy code">' + I.copy + '</button>' +
    '</div>' +
    '<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>' +
  '</div>';
}

/* Small, safe markdown: everything is HTML-escaped first and only the
   constructs below produce tags. An unterminated fence (mid-stream) is
   rendered as a code block too, so streaming code never flashes as prose. */
function mdToHtml(src) {
  var blocks = [];
  var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');

  text = text.replace(/```([A-Za-z0-9+#_.-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g, function (m, lang, code) {
    blocks.push(codeBlockHtml(lang, code));
    return '\n@@NSBLK' + (blocks.length - 1) + '@@\n';
  });

  var lines = text.split('\n');
  var out = [];
  var para = [];
  var i = 0;

  function flushPara() {
    if (para.length) out.push('<p>' + inlineMd(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
    para = [];
  }

  while (i < lines.length) {
    var trimmed = lines[i].trim();

    var mBlock = /^@@NSBLK(\d+)@@$/.exec(trimmed);
    if (mBlock) { flushPara(); out.push(blocks[+mBlock[1]]); i++; continue; }
    if (!trimmed) { flushPara(); i++; continue; }

    var mH = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (mH) {
      flushPara();
      var lvl = Math.min(3, mH[1].length);
      out.push('<h' + lvl + '>' + inlineMd(mH[2].replace(/\s+#+$/, '')) + '</h' + lvl + '>');
      i++; continue;
    }

    if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(trimmed)) {
      flushPara(); out.push('<hr>'); i++; continue;
    }

    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1].trim())) {
      flushPara();
      var head = splitRow(lines[i]);
      i += 2;
      var rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
      var html = '<div class="tw"><table><thead><tr>';
      head.forEach(function (c) { html += '<th>' + inlineMd(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr>';
        for (var c = 0; c < head.length; c++) html += '<td>' + inlineMd(r[c] || '') + '</td>';
        html += '</tr>';
      });
      out.push(html + '</tbody></table></div>');
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara();
      var quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + mdToHtml(quote.join('\n')) + '</blockquote>');
      continue;
    }

    var isUl = /^[-*+]\s+/.test(trimmed);
    var isOl = /^\d+[.)]\s+/.test(trimmed);
    if (isUl || isOl) {
      flushPara();
      var tag = isUl ? 'ul' : 'ol';
      var items = [];
      while (i < lines.length) {
        var lt = lines[i].trim();
        var mi = isUl ? /^[-*+]\s+(.*)$/.exec(lt) : /^\d+[.)]\s+(.*)$/.exec(lt);
        if (!mi) {
          if (lt && items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += '\n' + lt; i++; continue; }
          break;
        }
        items.push(mi[1]); i++;
      }
      out.push('<' + tag + '>' + items.map(function (it) {
        return '<li>' + inlineMd(it).replace(/\n/g, '<br>') + '</li>';
      }).join('') + '</' + tag + '>');
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();

  return out.join('').replace(/@@NSBLK(\d+)@@/g, function (m, n) { return blocks[+n]; });
}
