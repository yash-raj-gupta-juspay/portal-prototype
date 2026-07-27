/* =============================================================================
   Juspay Ops Portal — Platform Configs: shared kernel (Phase 3 extension)
   Serialisation (JSON + YAML), path access, validators (Part 4.8),
   byte-map ruler (Part 9.5), schedule preview (Part 9.6), structural diff (8.3).
   Designed once here, applied three times by configs.js (Part 4).
   ============================================================================= */
window.CFGCORE = (function () {
  'use strict';
  var D = window.DATA, U = D.util, C = window.CFGDATA, F = window.CFGFMT;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function escT(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function icon(name, size) { size = size || 16; return '<i data-lucide="' + name + '" style="width:' + size + 'px;height:' + size + 'px"></i>'; }
  function pad(n) { return new Array(n + 1).join(' '); }

  /* =========================================================================
     1 · Path access (generic form-field binding)
     ========================================================================= */
  function getPath(obj, path) {
    if (!path) return obj;
    var parts = String(path).split('.'), o = obj;
    for (var i = 0; i < parts.length; i++) {
      if (o == null) return undefined;
      o = o[parts[i]];
    }
    return o;
  }
  function setPath(obj, path, val) {
    var parts = String(path).split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
    return obj;
  }
  function delPath(obj, path) {
    var parts = String(path).split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) { if (o == null) return; o = o[parts[i]]; }
    var last = parts[parts.length - 1];
    if (Array.isArray(o)) o.splice(+last, 1); else delete o[last];
  }
  function movePath(obj, path, idx, dir) {
    var arr = getPath(obj, path); if (!Array.isArray(arr)) return;
    var to = idx + dir; if (to < 0 || to >= arr.length) return;
    var t = arr[idx]; arr[idx] = arr[to]; arr[to] = t;
  }

  /* =========================================================================
     2 · Serialisation — JSON and a YAML subset covering every config shape
     ========================================================================= */
  function yamlScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    var s = String(v);
    if (s === '' || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /:\s|\s#|^\s|\s$/.test(s) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s)) {
      return "'" + s.replace(/'/g, "''") + "'";
    }
    return s;
  }
  function yamlLines(obj, ind) {
    var p = pad(ind), out = [];
    if (Array.isArray(obj)) {
      obj.forEach(function (item) {
        if (item && typeof item === 'object') {
          var sub = yamlLines(item, ind + 2);
          if (!sub.length) { out.push(p + '- ' + (Array.isArray(item) ? '[]' : '{}')); return; }
          out.push(p + '- ' + sub[0].substring(ind + 2));
          for (var k = 1; k < sub.length; k++) out.push(sub[k]);
        } else out.push(p + '- ' + yamlScalar(item));
      });
      return out;
    }
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v && typeof v === 'object') {
        if (Array.isArray(v) && !v.length) { out.push(p + k + ': []'); return; }
        if (!Array.isArray(v) && !Object.keys(v).length) { out.push(p + k + ': {}'); return; }
        out.push(p + k + ':');
        yamlLines(v, ind + 2).forEach(function (l) { out.push(l); });
      } else out.push(p + k + ': ' + yamlScalar(v));
    });
    return out;
  }
  function toYaml(obj) { return yamlLines(obj, 0).join('\n') + '\n'; }

  function keyEnd(line) {
    var q = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) { if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') { q = ch; continue; }
      if (ch === ':' && (i === line.length - 1 || line.charAt(i + 1) === ' ')) return i;
    }
    return -1;
  }
  function yamlValue(s) {
    if (s === '' || s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === '[]') return [];
    if (s === '{}') return {};
    if (/^'([^']|'')*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^"([^"\\]|\\.)*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"');
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    return s;
  }
  function fromYaml(text) {
    var lines = [];
    text.split(/\r?\n/).forEach(function (l, i) {
      if (!l.trim() || /^\s*#/.test(l)) return;
      lines.push({ indent: l.match(/^ */)[0].length, text: l.replace(/\s+$/, '').trim(), n: i + 1 });
    });
    if (!lines.length) return {};
    var pos = 0;
    function node(ind) {
      if (pos >= lines.length) return null;
      return lines[pos].text.charAt(0) === '-' ? seq(ind) : map(ind);
    }
    function seq(ind) {
      var arr = [];
      while (pos < lines.length && lines[pos].indent === ind && lines[pos].text.charAt(0) === '-') {
        var t = lines[pos].text.substring(1).trim();
        if (t === '') {
          pos++;
          arr.push(pos < lines.length && lines[pos].indent > ind ? node(lines[pos].indent) : null);
          continue;
        }
        if (keyEnd(t) >= 0) {
          lines[pos] = { indent: ind + 2, text: t, n: lines[pos].n };
          arr.push(map(ind + 2));
        } else { arr.push(yamlValue(t)); pos++; }
      }
      return arr;
    }
    function map(ind) {
      var obj = {};
      while (pos < lines.length && lines[pos].indent === ind && lines[pos].text.charAt(0) !== '-') {
        var line = lines[pos].text, ci = keyEnd(line);
        if (ci < 0) throw new Error('line ' + lines[pos].n + ': expected "key: value"');
        var key = line.substring(0, ci).trim().replace(/^['"]|['"]$/g, '');
        var rest = line.substring(ci + 1).trim();
        pos++;
        if (rest === '') {
          var nxt = lines[pos];
          if (nxt && (nxt.indent > ind || (nxt.indent === ind && nxt.text.charAt(0) === '-'))) obj[key] = node(nxt.indent);
          else obj[key] = null;
        } else obj[key] = yamlValue(rest);
      }
      return obj;
    }
    var out = node(lines[0].indent);
    if (out === null || typeof out !== 'object') throw new Error('document root must be a mapping');
    return out;
  }

  function serialize(body, format) { return format === 'yaml' ? toYaml(body) : JSON.stringify(body, null, 2) + '\n'; }
  function deserialize(text, format) {
    if (format === 'yaml') return fromYaml(text);
    return JSON.parse(text);
  }

  /* ---- Syntax highlighting (regex-based, Part 9.1) ----------------------- */
  function hlJson(src) {
    return escT(src).replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      function (m, str, colon, kw) {
        if (str) return colon ? '<span class="tk-key">' + str + '</span>' + colon : '<span class="tk-str">' + str + '</span>';
        if (kw) return '<span class="tk-kw">' + m + '</span>';
        return '<span class="tk-num">' + m + '</span>';
      });
  }
  function hlVal(v) {
    if (v === '') return '';
    var e = escT(v);
    if (/^'.*'$/.test(v) || /^".*"$/.test(v)) return '<span class="tk-str">' + e + '</span>';
    if (/^(true|false|null|~|\[\]|\{\})$/.test(v)) return '<span class="tk-kw">' + e + '</span>';
    if (/^-?\d+(\.\d+)?$/.test(v)) return '<span class="tk-num">' + e + '</span>';
    return '<span class="tk-str">' + e + '</span>';
  }
  function hlYaml(src) {
    return src.split('\n').map(function (line) {
      var m = line.match(/^(\s*)(- )?(.*)$/);
      var p = m[1], dash = m[2] ? '<span class="tk-p">- </span>' : '', rest = m[3];
      var ci = keyEnd(rest);
      if (ci >= 0) {
        var key = rest.substring(0, ci), val = rest.substring(ci + 1);
        return p + dash + '<span class="tk-key">' + escT(key) + '</span><span class="tk-p">:</span>' +
          (val ? ' ' + hlVal(val.trim()) : '');
      }
      return p + dash + hlVal(rest);
    }).join('\n');
  }
  function highlight(src, format) { return format === 'yaml' ? hlYaml(src) : hlJson(src); }

  /* =========================================================================
     3 · Byte-map ruler (Part 5.2 Tab A / Part 9.5)
     Input : recordLength, fields [{name,start,length,type,note}]
     Output: segment model + HTML. Overlaps red, unexplained gaps grey.
     ========================================================================= */
  function byteSegments(recordLength, fields) {
    var RL = Math.max(0, +recordLength || 0);
    var fs = (fields || []).filter(function (f) { return (+f.length || 0) > 0 && (+f.start || 0) > 0; });
    var marks = { 1: true };
    fs.forEach(function (f) { marks[+f.start] = true; marks[+f.start + (+f.length)] = true; });
    if (RL > 0) marks[RL + 1] = true;
    var pts = Object.keys(marks).map(Number).sort(function (a, b) { return a - b; });
    var end = Math.max(RL, pts[pts.length - 1] - 1);
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1] - 1;
      if (b < a) continue;
      var cover = fs.filter(function (f) { return +f.start <= a && (+f.start + (+f.length)) > a; });
      var kind = cover.length === 0 ? 'gap' : (cover.length > 1 ? 'overlap' : (C.isFiller(cover[0]) ? 'filler' : 'field'));
      if (a > RL && RL > 0) kind = cover.length ? 'overflow' : 'gap';
      if (kind === 'gap' && a > end) continue;
      segs.push({ start: a, end: b, len: b - a + 1, fields: cover, kind: kind });
    }
    // Drop a trailing phantom gap beyond both the record length and all fields.
    segs = segs.filter(function (s) { return s.start <= Math.max(RL, end); });
    var stats = { mapped: 0, gap: 0, overlap: 0, overflow: 0, fields: fs.length, recordLength: RL, span: end };
    segs.forEach(function (s) {
      if (s.kind === 'gap') stats.gap += s.len;
      else if (s.kind === 'overlap') stats.overlap += s.len;
      else if (s.kind === 'overflow') stats.overflow += s.len;
      else stats.mapped += s.len;
    });
    stats.sumLengths = fs.reduce(function (t, f) { return t + (+f.length || 0); }, 0);
    return { segs: segs, stats: stats, scale: Math.max(RL, end, 1) };
  }

  function tickStep(span) {
    var cand = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (var i = 0; i < cand.length; i++) if (span / cand[i] <= 12) return cand[i];
    return 1000;
  }
  var SEG_COLORS = 6;

  // opts: { id, compact, title }
  function byteMapHtml(recordLength, fields, opts) {
    opts = opts || {};
    var m = byteSegments(recordLength, fields);
    var scale = m.scale, st = m.stats;
    var fi = 0, bars = '';
    m.segs.forEach(function (s) {
      var left = ((s.start - 1) / scale) * 100, w = (s.len / scale) * 100;
      var cls = 'bm-seg bm-' + s.kind;
      if (s.kind === 'field') { cls += ' bm-c' + (fi % SEG_COLORS); fi++; }
      var label = s.kind === 'gap' ? 'gap' : (s.kind === 'overlap' ? 'overlap' : s.fields[0].name);
      var tip;
      if (s.kind === 'overlap') {
        tip = '<strong>Overlap — ' + s.len + ' byte' + (s.len === 1 ? '' : 's') + '</strong>' +
          s.fields.map(function (f) { return '<span class="bt-row">' + esc(f.name) + ' · ' + f.start + '–' + (f.start + f.length - 1) + '</span>'; }).join('');
      } else if (s.kind === 'gap') {
        tip = '<strong>Unmapped gap</strong><span class="bt-row">bytes ' + s.start + '–' + s.end + ' · ' + s.len + ' byte' + (s.len === 1 ? '' : 's') + '</span><span class="bt-row">Declare a filler field to close it.</span>';
      } else if (s.kind === 'overflow') {
        tip = '<strong>Past record length</strong><span class="bt-row">' + esc(s.fields[0].name) + ' · bytes ' + s.start + '–' + s.end + '</span>';
      } else {
        var f = s.fields[0];
        tip = '<strong>' + esc(f.name) + '</strong><span class="bt-row">bytes ' + f.start + '–' + (f.start + f.length - 1) + ' · length ' + f.length + ' · type ' + esc(f.type || '—') + '</span>' + (f.note ? '<span class="bt-row">' + esc(f.note) + '</span>' : '');
      }
      bars += '<div class="' + cls + '" style="left:' + left.toFixed(4) + '%;width:' + w.toFixed(4) + '%">' +
        '<span class="bm-label">' + esc(label) + '</span>' +
        '<span class="bm-tip">' + tip + '</span></div>';
    });

    var step = tickStep(scale), ticks = '';
    for (var t = 1; t <= scale; t += step) {
      ticks += '<span class="bm-tick" style="left:' + (((t - 1) / scale) * 100).toFixed(4) + '%"><i></i><b>' + t + '</b></span>';
    }
    ticks += '<span class="bm-tick bm-tick-end" style="left:100%"><i></i><b>' + scale + '</b></span>';

    var legend =
      '<span class="bm-stat"><span class="bm-sw bm-c0"></span>' + st.fields + ' field' + (st.fields === 1 ? '' : 's') + '</span>' +
      '<span class="bm-stat"><span class="bm-sw bm-filler"></span>declared filler</span>' +
      '<span class="bm-stat' + (st.gap ? ' bad' : '') + '"><span class="bm-sw bm-gap"></span>' + st.gap + ' byte' + (st.gap === 1 ? '' : 's') + ' gap</span>' +
      '<span class="bm-stat' + (st.overlap ? ' bad' : '') + '"><span class="bm-sw bm-overlap"></span>' + st.overlap + ' byte' + (st.overlap === 1 ? '' : 's') + ' overlapping</span>' +
      '<span class="bm-stat">Σ lengths <b class="num">' + st.sumLengths + '</b> / record_length <b class="num">' + st.recordLength + '</b></span>';

    return '<div class="byte-map' + (opts.compact ? ' compact' : '') + '"' + (opts.id ? ' id="' + opts.id + '"' : '') + '>' +
      (opts.title ? '<div class="bm-title">' + opts.title + '</div>' : '') +
      '<div class="bm-track">' + bars + '</div>' +
      '<div class="bm-axis">' + ticks + '</div>' +
      '<div class="bm-legend">' + legend + '</div>' +
      '</div>';
  }

  // Recalculate start positions so fields are contiguous from byte 1.
  function autoPack(fields) {
    var p = 1;
    fields.forEach(function (f) { f.start = p; p += (+f.length || 0); });
    return fields;
  }

  /* =========================================================================
     4 · Schedule preview (Part 6.2 Tab A / Part 9.6)
     ========================================================================= */
  function parseOffset(s) {
    var m = /^T([+-])(\d+)$/.exec(String(s || '').trim());
    if (!m) return null;
    return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
  }
  function fmtOffset(n) { return 'T' + (n < 0 ? '-' : '+') + Math.abs(n); }
  function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(String(s || '')); }

  // block: the `default` (or a rules[] override) block; returns the resolved run.
  function resolveRun(block, timezone, runYmd) {
    var d = U.fromYmd(runYmd), dow = d.getUTCDay();
    var skip = null;
    if (block.sundays_off && dow === 0) skip = 'Sunday — generation off';
    if (!skip && block.saturdays_off && dow === 6) skip = 'Saturday — generation off';
    var hol = C.holidayOn(runYmd, timezone);
    if (!skip && block.apply_general_holiday && hol) skip = hol.name + ' — general holiday';
    var td = block.transaction_date || {};
    var fo = parseOffset((td.from || {}).offset), to = parseOffset((td.to || {}).offset), ro = parseOffset(block.report_offset);
    return {
      runDate: runYmd,
      dow: U.DOW[dow],
      fires: !skip,
      skipReason: skip,
      fromDate: fo === null ? null : U.addDays(runYmd, fo),
      fromTime: (td.from || {}).time || '',
      toDate: to === null ? null : U.addDays(runYmd, to),
      toTime: (td.to || {}).time || '',
      reportDate: ro === null ? null : U.addDays(runYmd, ro),
      holiday: hol
    };
  }
  function nextRuns(block, timezone, startYmd, count) {
    var out = [], day = startYmd;
    for (var i = 0; i < count; i++) { out.push(resolveRun(block, timezone, day)); day = U.addDays(day, 1); }
    return out;
  }

  /* =========================================================================
     5 · Structural diff (Part 8.3) — used by approval detail, version compare
        and the revert flow.
     ========================================================================= */
  function flatten(v, prefix, out) {
    out = out || [];
    if (v === null || typeof v !== 'object') { out.push({ path: prefix, value: v }); return out; }
    if (Array.isArray(v)) {
      if (!v.length) { out.push({ path: prefix, value: '[]' }); return out; }
      v.forEach(function (item, i) { flatten(item, prefix + '[' + i + ']', out); });
      return out;
    }
    var keys = Object.keys(v);
    if (!keys.length) { out.push({ path: prefix, value: '{}' }); return out; }
    keys.forEach(function (k) { flatten(v[k], prefix ? prefix + '.' + k : k, out); });
    return out;
  }
  function showVal(v) {
    if (v === null) return 'null';
    if (v === undefined) return '';
    if (typeof v === 'string') return v === '' ? '""' : v;
    return String(v);
  }
  // Aligned row model: [{path, left, right, kind}] kind ∈ same|modified|added|removed
  function diffRows(leftObj, rightObj) {
    var L = leftObj ? flatten(leftObj, '') : [];
    var R = rightObj ? flatten(rightObj, '') : [];
    var lMap = {}, rMap = {}, lIdx = {}, rIdx = {};
    L.forEach(function (e, i) { lMap[e.path] = e.value; lIdx[e.path] = i; });
    R.forEach(function (e, i) { rMap[e.path] = e.value; rIdx[e.path] = i; });
    var rows = [], i = 0, j = 0;
    while (i < L.length || j < R.length) {
      if (i < L.length && j < R.length && L[i].path === R[j].path) {
        var same = showVal(L[i].value) === showVal(R[j].value);
        rows.push({ path: L[i].path, left: L[i].value, right: R[j].value, kind: same ? 'same' : 'modified' });
        i++; j++; continue;
      }
      if (i < L.length && !(L[i].path in rMap)) { rows.push({ path: L[i].path, left: L[i].value, right: undefined, kind: 'removed' }); i++; continue; }
      if (j < R.length && !(R[j].path in lMap)) { rows.push({ path: R[j].path, left: undefined, right: R[j].value, kind: 'added' }); j++; continue; }
      if (i >= L.length) { rows.push({ path: R[j].path, left: undefined, right: R[j].value, kind: 'added' }); j++; continue; }
      if (j >= R.length) { rows.push({ path: L[i].path, left: L[i].value, right: undefined, kind: 'removed' }); i++; continue; }
      if (rIdx[L[i].path] <= lIdx[R[j].path]) { rows.push({ path: R[j].path, left: undefined, right: R[j].value, kind: 'added' }); j++; }
      else { rows.push({ path: L[i].path, left: L[i].value, right: undefined, kind: 'removed' }); i++; }
    }
    return rows;
  }
  function diffStats(rows) {
    var s = { added: 0, removed: 0, modified: 0, same: 0 };
    rows.forEach(function (r) { s[r.kind]++; });
    return s;
  }
  // Plain-English summary of a change set — used for version summaries.
  function diffSummary(leftObj, rightObj) {
    if (!leftObj) return 'New config — first version.';
    var s = diffStats(diffRows(leftObj, rightObj));
    var bits = [];
    if (s.modified) bits.push(s.modified + ' value' + (s.modified === 1 ? '' : 's') + ' changed');
    if (s.added) bits.push(s.added + ' added');
    if (s.removed) bits.push(s.removed + ' removed');
    return bits.length ? bits.join(', ') + '.' : 'No effective change.';
  }

  /* =========================================================================
     6 · Validator catalog (Part 4.8) — reusable across all three families
     ========================================================================= */
  function err(code, msg, where) { return { level: 'error', code: code, msg: msg, where: where || '' }; }
  function warn(code, msg, where) { return { level: 'warning', code: code, msg: msg, where: where || '' }; }

  // 4.8 #3 — fixed-width layout invariants, per record type.
  function validateLayout(recordLength, fields, label, out) {
    var RL = +recordLength || 0;
    if (!RL) out.push(err('LAYOUT_RECORD_LENGTH', 'Record length must be a positive number.', label));
    if (!fields || !fields.length) { out.push(err('LAYOUT_EMPTY', 'Record type has no fields defined.', label)); return; }
    var sum = 0, seen = {};
    fields.forEach(function (f, i) {
      var pos = 'field ' + (i + 1) + ' "' + (f.name || '(unnamed)') + '"';
      if (!String(f.name || '').trim()) out.push(err('FIELD_NAME', 'Field name is required.', label + ' · ' + pos));
      if (seen[f.name]) out.push(warn('FIELD_DUPLICATE', 'Duplicate field name "' + f.name + '" in this record type.', label + ' · ' + pos));
      seen[f.name] = true;
      if (!(+f.start >= 1)) out.push(err('FIELD_START', 'Start position must be 1-indexed (≥ 1).', label + ' · ' + pos));
      if (!(+f.length >= 1)) out.push(err('FIELD_LENGTH', 'Length must be at least 1 byte.', label + ' · ' + pos));
      if (C.FIELD_TYPES.indexOf(f.type) < 0) out.push(err('FIELD_TYPE', 'Type must be N or AN (found "' + (f.type || '') + '").', label + ' · ' + pos));
      sum += (+f.length || 0);
    });
    var m = byteSegments(RL, fields), st = m.stats;
    if (RL && sum !== RL) {
      out.push(err('LAYOUT_SUM', 'Sum of field lengths is ' + sum + ' but record_length is ' + RL + ' (difference of ' + Math.abs(sum - RL) + ' bytes).', label));
    }
    if (st.overlap) out.push(err('LAYOUT_OVERLAP', st.overlap + ' byte' + (st.overlap === 1 ? '' : 's') + ' covered by more than one field — overlapping spans are highlighted red on the byte map.', label));
    if (st.gap) out.push(err('LAYOUT_GAP', st.gap + ' byte' + (st.gap === 1 ? '' : 's') + ' unmapped — declare a filler field or re-pack positions (grey spans on the byte map).', label));
    if (st.overflow) out.push(err('LAYOUT_OVERFLOW', st.overflow + ' byte' + (st.overflow === 1 ? '' : 's') + ' extend past record_length.', label));
    // Contiguity is implied by "no gaps, no overlaps"; report ordering separately.
    for (var i = 1; i < fields.length; i++) {
      if (+fields[i].start < +fields[i - 1].start) {
        out.push(warn('LAYOUT_ORDER', 'Field "' + fields[i].name + '" starts before the field above it — rows are out of positional order.', label));
        break;
      }
    }
  }

  function validate(cfg, body) {
    var out = [];
    if (!body || typeof body !== 'object') { out.push(err('SYNTAX', 'Config body is not an object.', '')); return split(out); }

    if (cfg.family === 'network-file') {
      // 4.8 #2 — schema conformance, branched on the declared output format.
      // Positional invariants only mean something for fixed_width; asserting
      // record_length or byte coverage on an XML or CSV config would be noise.
      var fmt = F.formatOf(body), fc = F.caps(body);
      if (F.FORMAT_KEYS.indexOf(fmt) < 0) out.push(err('SCHEMA', 'output_format must be one of ' + F.FORMAT_KEYS.join(' / ') + '.', 'header'));
      if (!Array.isArray(body.record_types) || !body.record_types.length) out.push(err('SCHEMA', 'At least one record type is required.', 'layout'));

      if (fmt === 'fixed_width') {
        if (!body.encoding) out.push(err('SCHEMA', 'encoding is required (ASCII or EBCDIC).', 'header'));
        if (String(body.padding_char || '').length !== 1) out.push(warn('SCHEMA', 'padding_char should be exactly one character.', 'header'));
        (body.record_types || []).forEach(function (rt) {
          validateLayout(body.record_length, rt.fields, 'record type ' + (rt.record_type || '?'), out);
        });
      } else if (fmt === 'xml') {
        var xc = body.xml_file_config || {};
        if (!String(xc.root_element || '').trim()) out.push(err('SCHEMA', 'xml_file_config.root_element is required.', 'header'));
        if (!String(xc.declaration || '').trim()) out.push(warn('SCHEMA', 'xml_file_config.declaration is empty — the file will be written without an XML declaration.', 'header'));
        (body.record_types || []).forEach(function (rt) {
          var lbl = 'record ' + (rt.record_type || '?');
          if (!String(rt.xml_element || rt.record_type || '').trim()) out.push(err('SCHEMA', 'Record has no XML element name.', lbl));
          if (!(rt.fields || []).length) out.push(err('LAYOUT_EMPTY', 'Record has no fields defined.', lbl));
          (rt.fields || []).forEach(function (f, i) {
            var pos = 'field ' + (i + 1) + ' "' + (f.name || '(unnamed)') + '"';
            if (!String(f.name || '').trim()) out.push(err('FIELD_NAME', 'Field name is required.', lbl + ' · ' + pos));
            if (!String(f.xml_tag || '').trim()) out.push(err('FIELD_TAG', 'Every XML field needs a tag — the engine writes <tag>value</tag>.', lbl + ' · ' + pos));
          });
        });
      } else if (fmt === 'csv') {
        var cc = body.csv_config || {};
        if (!String(cc.delimiter || '').length) out.push(err('SCHEMA', 'csv_config.delimiter is required.', 'header'));
        (body.record_types || []).forEach(function (rt) {
          var lbl = 'record type ' + (rt.record_type || '?');
          if (!(rt.fields || []).length) out.push(err('LAYOUT_EMPTY', 'Record type has no columns defined.', lbl));
          var seenCsv = {};
          (rt.fields || []).forEach(function (f, i) {
            var pos = 'column ' + (i + 1) + ' "' + (f.name || '(unnamed)') + '"';
            if (!String(f.name || '').trim()) out.push(err('FIELD_NAME', 'Column name is required.', lbl + ' · ' + pos));
            else if (seenCsv[f.name]) out.push(err('FIELD_DUPLICATE', 'Duplicate column "' + f.name + '" — a CSV record cannot emit the same DE/PDS twice.', lbl));
            seenCsv[f.name] = true;
            if (!F.isDePds(f.name) && f.name !== 'ICC_DATA') {
              out.push(warn('FIELD_NAME', 'Column "' + f.name + '" is not a DE/PDS code — Mastercard columns are normally DE<n> or PDS<nnnn>.', lbl));
            }
          });
        });
      }

      // 4.8 #4 — reference integrity across tabs
      var names = C.fieldNames(body), tf = body.transform || {};
      (tf.json_extractions || []).forEach(function (g, gi) {
        if (!g.source_column) out.push(err('SCHEMA', 'JSON extraction ' + (gi + 1) + ' has no source column.', 'transform'));
        (g.rows || []).forEach(function (r) {
          if (!r.output) out.push(err('REF', 'Extraction "' + (r.json_key || '?') + '" has no output column.', 'transform'));
        });
      });
      // Field mappings write layout fields; a mapping for a field the layout does
      // not declare is dead config.
      Object.keys(tf.field_mappings || {}).forEach(function (k) {
        var m = tf.field_mappings[k] || {};
        if (!String(m.source || '').trim()) out.push(err('SCHEMA', 'Field mapping "' + k + '" has no source column.', 'transform'));
        if (names.indexOf(k) < 0) out.push(warn('REF', 'Field mapping "' + k + '" is not a field in any record type on the Layout tab — it will map nowhere.', 'transform'));
      });
      // Group mapping (§3.2b) — the second half of the Mastercard transform.
      var rtKeys = (body.record_types || []).map(function (rt) { return String(rt.record_type); });
      (tf.groups || []).forEach(function (g, gi) {
        var lbl = 'group ' + (g.name || gi + 1);
        if (!String(g.name || '').trim()) out.push(err('SCHEMA', 'Group ' + (gi + 1) + ' has no name.', 'transform'));
        var rts = F.recordTypesOf(g);
        var wrapper = (g.xml_config && g.xml_config.wrapper_only) || (g.children || []).length;
        if (!rts.length && !wrapper) out.push(warn('SCHEMA', 'Group emits no record type and wraps no children — it will produce nothing.', lbl));
        rts.forEach(function (rt) {
          if (!String(rt.type || '').trim()) out.push(err('SCHEMA', 'A record type entry has no type.', lbl));
          else if (rtKeys.length && rtKeys.indexOf(String(rt.type)) < 0) {
            out.push(err('REF_RECORD_TYPE', 'Group emits record type "' + rt.type + '", which the Layout tab does not define.', lbl));
          }
          (rt.conditions || []).forEach(function (c, ci) {
            if (!String(c.field || '').trim()) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' has no field.', lbl));
            if (!String(c.operator || '').trim()) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' has no operator.', lbl));
            if (!(c.values || []).length) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' has no values.', lbl));
          });
        });
        var gf = g.fields || {};
        Object.keys(gf.constants || {}).forEach(function (k) {
          if (names.length && names.indexOf(k) < 0) out.push(warn('REF', 'Constant "' + k + '" is not a field in the layout.', lbl));
        });
        (gf.derived || []).forEach(function (d, di) {
          if (!String(d.name || '').trim()) out.push(err('SCHEMA', 'Derived entry ' + (di + 1) + ' has no name.', lbl));
          if (!String(d.type || '').trim()) out.push(err('SCHEMA', 'Derived "' + (d.name || di + 1) + '" has no type.', lbl));
          if (d.type === 'config_lookup') {
            var cols = ((d.params || {}).lookup_columns) || [];
            if (!cols.length) out.push(err('LOOKUP_KEYS', 'config_lookup "' + d.name + '" declares no lookup_columns — the engine has nothing to key the lookup on.', lbl));
          }
          if (d.type === 'sum_column' && !String((d.params || {}).column || '').trim()) {
            out.push(err('SCHEMA', 'sum_column "' + d.name + '" has no column parameter.', lbl));
          }
          var writes = [d.name].concat(d.aliases || []);
          writes.forEach(function (w) {
            if (names.length && names.indexOf(w) < 0) {
              out.push(warn('REF', 'Derived "' + d.name + '" writes "' + w + '", which is not a field in the layout.', lbl));
            }
          });
        });
      });
      // Layout fields nothing writes — surfaced as a warning, since padding a
      // field to blanks is sometimes intentional.
      if ((tf.groups || []).length || Object.keys(tf.field_mappings || {}).length) {
        var unmapped = names.filter(function (n) {
          if (C.isFiller({ name: n }) || n === 'Record type') return false;
          return F.resolveSource(body, n).kind === 'none';
        });
        if (unmapped.length) {
          out.push(warn('UNMAPPED', unmapped.length + ' layout field' + (unmapped.length === 1 ? '' : 's') +
            ' have no mapping, constant or derived entry (' + unmapped.slice(0, 6).join(', ') +
            (unmapped.length > 6 ? ', …' : '') + ') — they will be emitted empty.', 'layout'));
        }
      }
      if (tf.surcharge && tf.surcharge.enabled) {
        (tf.surcharge.mappings || []).forEach(function (r) {
          if (r.output && names.indexOf(r.output) < 0) out.push(warn('REF', 'Surcharge output "' + r.output + '" does not exist in the layout.', 'transform'));
        });
      }
      var oc = body.output_config || {};
      if (fc.extension && !String(oc.output_extension || '').trim()) {
        out.push(warn('SCHEMA', 'No output file extension chosen — the generator will fall back to the format default (' + fc.defaultExtension + ').', 'header'));
      }
      var ap = tf.acquirer_profile || {};
      ['file_id', 'site_id', 'company_id', 'merchant_id', 'collection_method'].forEach(function (k) {
        if (!String(ap[k] == null ? '' : ap[k]).trim()) out.push(warn('SCHEMA', 'Acquirer profile "' + k + '" is empty.', 'transform'));
      });
    }

    if (cfg.family === 'settlement' && cfg.subType === 'schedule') {
      if (C.REPORTS.indexOf(body.report) < 0) out.push(err('SCHEMA', 'report must be one of ' + C.REPORTS.join(' / ') + '.', 'schedule'));
      if (C.TIMEZONES.indexOf(body.timezone) < 0) out.push(err('SCHEMA', 'timezone must be a supported IANA zone.', 'schedule'));
      var blocks = [{ b: body['default'], label: 'default block' }];
      (body.rules || []).forEach(function (r, i) { blocks.push({ b: r, label: 'rule ' + (i + 1) }); });
      blocks.forEach(function (x) {
        var b = x.b || {}, td = b.transaction_date || {};
        // 4.8 #5 — settlement offsets
        var fo = parseOffset((td.from || {}).offset), to = parseOffset((td.to || {}).offset), ro = parseOffset(b.report_offset);
        if (fo === null) out.push(err('OFFSET', 'transaction_date.from.offset must match the T±n grammar (e.g. T-1).', x.label));
        if (to === null) out.push(err('OFFSET', 'transaction_date.to.offset must match the T±n grammar (e.g. T+0).', x.label));
        if (ro === null) out.push(err('OFFSET', 'report_offset must match the T±n grammar.', x.label));
        if (fo !== null && to !== null && fo > to) out.push(err('OFFSET_ORDER', 'from offset ' + fmtOffset(fo) + ' is after to offset ' + fmtOffset(to) + ' — the window is inverted.', x.label));
        if (!validTime((td.from || {}).time)) out.push(err('TIME', 'from time must be HH:MM:SS.', x.label));
        if (!validTime((td.to || {}).time)) out.push(err('TIME', 'to time must be HH:MM:SS.', x.label));
        if (fo !== null && to !== null && fo === to && validTime((td.from || {}).time) && validTime((td.to || {}).time) && (td.from || {}).time >= (td.to || {}).time) {
          out.push(err('TIME_ORDER', 'Same-day window where from time is not before to time.', x.label));
        }
        if (b.sundays_off && b.saturdays_off && b.apply_general_holiday) out.push(warn('SCHEDULE', 'Weekends and holidays are all off — check the expected run frequency in the preview.', x.label));
      });
    }

    if (cfg.family === 'settlement' && cfg.subType === 'content') {
      if (!Array.isArray(body.eligibility_flags) || !body.eligibility_flags.length) out.push(warn('SCHEMA', 'No eligibility flags — every transaction will be included.', 'content'));
      if (!Array.isArray(body['select']) || !body['select'].length) out.push(err('SCHEMA', 'select[] must define at least one output column.', 'content'));
      var seenCol = {};
      (body['select'] || []).forEach(function (c, i) {
        if (!String(c.column || '').trim()) out.push(err('SCHEMA', 'Column ' + (i + 1) + ' has no name.', 'content'));
        else {
          if (C.TXN_COLUMNS.indexOf(c.column) < 0) out.push(warn('REF', 'Column "' + c.column + '" is not in the known transaction schema.', 'content'));
          var key = c.alias || c.column;
          if (seenCol[key]) out.push(err('SCHEMA', 'Duplicate output column "' + key + '".', 'content'));
          seenCol[key] = true;
        }
      });
      (body.json_fetch || []).forEach(function (g, i) {
        if (!g.source) out.push(err('SCHEMA', 'JSON fetch ' + (i + 1) + ' has no source.', 'content'));
        if (!(g.keys || []).length) out.push(warn('SCHEMA', 'JSON fetch "' + (g.source || '?') + '" has no keys.', 'content'));
      });
    }

    if (cfg.family === 'settlement' && cfg.subType === 'fees') {
      var rules = body.txn_rules || [];
      if (!rules.length) out.push(err('SCHEMA', 'txn_rules[] must define at least one rule.', 'fees'));
      var prio = {};
      rules.forEach(function (r, i) {
        var label = 'rule ' + (i + 1) + ' (' + (r.model || '?') + ')';
        // 4.8 #6 — fee rules
        if (r.priority == null || isNaN(+r.priority)) out.push(err('FEE_PRIORITY', 'Priority is required and must be numeric.', label));
        else if (prio[+r.priority]) out.push(err('FEE_PRIORITY', 'Priority ' + r.priority + ' is used by more than one rule — priorities must be unique per config.', label));
        else prio[+r.priority] = true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.starting_date || ''))) out.push(err('FEE_DATE', 'starting_date must be a valid YYYY-MM-DD date.', label));
        if (!r.model) out.push(err('SCHEMA', 'Fee model is required.', label));
        if (!r.fee_mode) out.push(err('SCHEMA', 'Fee mode is required.', label));
        (r.conditions || []).forEach(function (c, ci) {
          if (!c.field) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' has no field.', label));
          if (C.CONDITIONS.indexOf(c.condition) < 0) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' operator must be one of ' + C.CONDITIONS.join(' / ') + '.', label));
          if (c.value === '' || c.value == null) out.push(err('SCHEMA', 'Condition ' + (ci + 1) + ' has no value.', label));
        });
        var calc = r.calculations || {}, logic = calc.logic || [];
        if (!logic.length) out.push(err('SCHEMA', 'Rule has no calculation rows.', label));
        logic.forEach(function (l, li) {
          if (l.percentage == null || isNaN(+l.percentage)) out.push(err('FEE_PCT', 'Slab ' + (li + 1) + ' percentage is required.', label));
          else if (+l.percentage < 0 || +l.percentage > 100) out.push(err('FEE_PCT', 'Slab ' + (li + 1) + ' percentage ' + l.percentage + ' is outside 0–100.', label));
          if (!l.field) out.push(warn('SCHEMA', 'Slab ' + (li + 1) + ' has no amount field.', label));
        });
        if (calc.slab_based) {
          var sorted = logic.map(function (l, li) {
            return { i: li, min: +l.min || 0, max: (l.max == null || l.max === '') ? Infinity : +l.max };
          }).sort(function (a, b) { return a.min - b.min; });
          sorted.forEach(function (s, si) {
            if (s.max <= s.min) out.push(err('FEE_SLAB', 'Slab ' + (s.i + 1) + ' has max ≤ min.', label));
            var nx = sorted[si + 1];
            if (nx && nx.min < s.max) {
              out.push(err('FEE_SLAB_OVERLAP', 'Overlapping slab ranges — slab ' + (nx.i + 1) + ' starts at ' + nx.min + ' inside slab ' + (s.i + 1) + ' which runs to ' + (s.max === Infinity ? '∞' : s.max) + '.', label));
            } else if (nx && nx.min > s.max) {
              out.push(warn('FEE_SLAB_GAP', 'Gap between slab ' + (s.i + 1) + ' (ends ' + s.max + ') and slab ' + (nx.i + 1) + ' (starts ' + nx.min + ') — amounts in between match no slab.', label));
            }
          });
        }
      });
    }

    if (cfg.family === 'incoming-parsing' && cfg.subType === 'pipeline') {
      ['gateway', 'network', 'direction', 'pipeline_kind'].forEach(function (k) {
        if (!String(body[k] || '').trim()) out.push(err('SCHEMA', k + ' is required.', 'pipeline'));
      });
      if (!(body.ack_filenames || []).length) out.push(warn('SCHEMA', 'No acknowledgment filenames declared — acks from this network will not be recognised.', 'pipeline'));
      (body.ack_filenames || []).forEach(function (a) {
        // 7.3 — ack filenames match the expected pattern for the network
        if (!/%Y|%m|%d/.test(a)) out.push(warn('ACK_PATTERN', 'Ack filename "' + a + '" has no date token (%Y/%m/%d) — it will only ever match one literal file.', 'pipeline'));
      });
      var ref = body.layout_ref ? C.byId[body.layout_ref] : null;
      if (body.layout_ref && !ref) out.push(err('REF_LAYOUT', 'layout_ref "' + body.layout_ref + '" does not resolve to an existing layout config.', 'pipeline'));
      // §4 — the source format must agree with the referenced layout, otherwise
      // the editor would offer positions for a layout that has none (or vice versa).
      if (ref) {
        var refFmt = F.formatOf(ref.body);
        if (body.source_format && body.source_format !== refFmt) {
          out.push(err('FORMAT_MISMATCH', 'source_format is "' + body.source_format + '" but the referenced layout ' + ref.name +
            ' is "' + refFmt + '". Positions, record length and the byte map only apply to fixed_width sources.', 'pipeline'));
        }
      }
      var sec = body.sectioning || {};
      if (!String(sec.field || '').trim()) out.push(err('SCHEMA', 'sectioning.field is required.', 'pipeline'));
      else if (ref) {
        var refNames = C.fieldNames(ref.body);
        if (refNames.indexOf(sec.field) < 0) out.push(err('REF_SECTION', 'sectioning.field "' + sec.field + '" does not exist in the referenced layout ' + ref.name + '.', 'pipeline'));
      }
      if (!(sec.rules || []).length) out.push(warn('SCHEMA', 'No sectioning rules — every record lands in the default bucket.', 'pipeline'));
      (sec.rules || []).forEach(function (r, i) {
        if (!String(r.match || '').trim()) out.push(err('SCHEMA', 'Sectioning rule ' + (i + 1) + ' has no match value.', 'pipeline'));
        if (!String(r.bucket || '').trim()) out.push(err('SCHEMA', 'Sectioning rule ' + (i + 1) + ' has no bucket.', 'pipeline'));
      });
      var agg = body.aggregation || {};
      if (agg.enabled && ref) {
        var rn = C.fieldNames(ref.body);
        (agg.group_by || []).forEach(function (g) {
          if (rn.indexOf(g) < 0) out.push(warn('REF', 'Aggregation group_by "' + g + '" is not a field in the referenced layout.', 'pipeline'));
        });
        (agg.sum_fields || []).forEach(function (g) {
          if (rn.indexOf(g) < 0) out.push(warn('REF', 'Aggregation sum_field "' + g + '" is not a field in the referenced layout.', 'pipeline'));
        });
      }
    }

    if (cfg.family === 'incoming-parsing' && cfg.subType === 'parser') {
      var rt = body.record_types || {};
      var keys = Object.keys(rt);
      var pfmt = body.source_format || 'delimited';
      if (!keys.length) out.push(err('SCHEMA', 'At least one record type is required.', 'parser'));
      if ((pfmt === 'delimited' || pfmt === 'csv') && !String(body.delimiter || '').length) {
        out.push(err('SCHEMA', 'A delimited source needs a delimiter.', 'parser'));
      }
      keys.forEach(function (k) {
        var g = rt[k] || {}, mp = g.mappings || {};
        // A record that only declares field windows (a trailer whose counts feed
        // aggregation rather than an internal field) is legitimate.
        if (!Object.keys(mp).length && !(g.fields || []).length) {
          out.push(err('SCHEMA', 'Record type ' + k + ' has neither mappings nor field windows — it parses nothing.', k));
        } else if (!Object.keys(mp).length) {
          out.push(warn('SCHEMA', 'Record type ' + k + ' parses fields but maps none of them to an internal field.', k));
        }
        Object.keys(mp).forEach(function (t) {
          // 7.3 — mapping targets are known internal field names
          if (C.INTERNAL_FIELDS.indexOf(t) < 0) out.push(warn('REF_MAPPING', 'Mapping target "' + t + '" is not a known internal field name.', k));
          if (!String(mp[t] || '').trim()) out.push(err('SCHEMA', 'Mapping "' + t + '" has no source column.', k));
        });
        // Positional field windows only exist on a fixed-width source; on any
        // other source they would be silently ignored by the parser.
        if (pfmt === 'fixed_width') {
          (g.fields || []).forEach(function (f, i) {
            var pos = 'field ' + (i + 1) + ' "' + (f.name || '(unnamed)') + '"';
            if (!(+f.start >= 1)) out.push(err('FIELD_START', 'Start position must be 1-indexed (≥ 1).', k + ' · ' + pos));
            if (!(+f.length >= 1)) out.push(err('FIELD_LENGTH', 'Length must be at least 1 byte.', k + ' · ' + pos));
          });
          if (g.min_length != null && (g.fields || []).length) {
            var reach = (g.fields || []).reduce(function (m, f) { return Math.max(m, (+f.start || 0) + (+f.length || 0) - 1); }, 0);
            if (reach > +g.min_length) {
              out.push(warn('MIN_LENGTH', 'Fields reach byte ' + reach + ' but min_length is ' + g.min_length + ' — short records would be rejected before these fields are read.', k));
            }
          }
        } else if ((g.fields || []).length) {
          out.push(warn('POSITIONS_IGNORED', 'Record type ' + k + ' declares byte positions, but source_format is "' + pfmt + '" — positions are only read for fixed_width sources.', k));
        }
        (g.filters || []).forEach(function (f, i) {
          if (!f.field) out.push(err('SCHEMA', 'Filter ' + (i + 1) + ' has no field.', k));
          if (C.CONDITIONS.indexOf(f.condition) < 0) out.push(err('SCHEMA', 'Filter ' + (i + 1) + ' operator must be one of ' + C.CONDITIONS.join(' / ') + '.', k));
        });
      });
    }

    if (cfg.family === 'incoming-parsing' && cfg.subType === 'preprocessor') {
      if (body.skip_header_rows == null || isNaN(+body.skip_header_rows) || +body.skip_header_rows < 0) out.push(err('SCHEMA', 'skip_header_rows must be a non-negative number.', 'preprocessor'));
      if (['ASCII', 'EBCDIC', 'UTF-8'].indexOf(body.encoding) < 0) out.push(err('SCHEMA', 'encoding must be ASCII, EBCDIC or UTF-8.', 'preprocessor'));
      if (!Array.isArray(body.steps) || !body.steps.length) out.push(err('SCHEMA', 'steps[] must define at least one processing step.', 'preprocessor'));
      (body.steps || []).forEach(function (s, i) {
        if (!s || !s.op) out.push(err('SCHEMA', 'Step ' + (i + 1) + ' has no op.', 'preprocessor'));
      });
    }
    return split(out);
  }
  function split(all) {
    return {
      errors: all.filter(function (x) { return x.level === 'error'; }),
      warnings: all.filter(function (x) { return x.level === 'warning'; }),
      all: all
    };
  }

  return {
    esc: esc, escT: escT, icon: icon,
    getPath: getPath, setPath: setPath, delPath: delPath, movePath: movePath,
    toYaml: toYaml, fromYaml: fromYaml, serialize: serialize, deserialize: deserialize, highlight: highlight,
    byteSegments: byteSegments, byteMapHtml: byteMapHtml, autoPack: autoPack,
    parseOffset: parseOffset, fmtOffset: fmtOffset, validTime: validTime,
    resolveRun: resolveRun, nextRuns: nextRuns,
    flatten: flatten, diffRows: diffRows, diffStats: diffStats, diffSummary: diffSummary, showVal: showVal,
    validate: validate, validateLayout: validateLayout
  };
})();
