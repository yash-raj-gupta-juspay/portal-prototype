/* =============================================================================
   Juspay Ops Portal — File detail panel (file-detail brief Part 3)

   ONE COMPONENT, THREE ENTRY POINTS (Part 6). Recon File Management is its
   home; Settlement File Monitoring opens it on a row click; Cycle Snapshot
   opens it from a failed leg's "See what failed →". There is no second
   implementation and no look-alike anywhere.

   The panel keeps everything the existing panel had — the header with the file
   name and UUID beneath it, the File Details / Validation Details tabs, the
   nested treatment for Global Level Check and Transaction Level Check with
   their arrow links, and the Uploaded By / Uploaded On footer rows — and adds
   three things to the step timeline (Part 3.3):

     1. a meta line of status · start time · duration, omitted piece by piece
        when the backend did not send the timestamps;
     2. more granular steps, rendered only where the pipeline reports them;
     3. a failed step expanded by default, showing a plain-language hint, the
        raw error_detail line clamped to two lines, and up to two actions.

   The hint never comes from the backend. It is looked up in failure-hints.js
   on error_code, and when the code is not in that table — or is null — the
   panel says so in as many words instead of inventing a cause (Part 5.3).

   window.FileDetailPanel(kit) → { open, close, paint, actions }
   ============================================================================= */
window.FileDetailPanel = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, P = window.PFILES, FH = window.FailureHints;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, el = kit.el, toast = kit.toast,
    num = kit.num, tenantTag = kit.tenantTag;

  // In memory only — no browser storage anywhere in this build.
  S.fileDetail = { id: null, tab: 'details', menu: false, retrying: null };

  /* =========================================================================
     STATUS VOCABULARY
     `skipped` is what a step after a failure carries, and it reads "Not run"
     because that is what happened to it (Part 3.3).
     ========================================================================= */
  var STEP_WORD = {
    success: 'Success', failed: 'Failed', running: 'Running',
    pending: 'Pending', skipped: 'Not run'
  };
  var STEP_ICON = {
    success: 'check-circle', failed: 'x-circle', running: 'loader',
    pending: 'circle', skipped: 'circle-dashed'
  };
  var FILE_PILL = {
    Success: ['Success', 'success', 'check-circle'],
    Failed: ['Failed', 'danger', 'x-circle'],
    Running: ['Processing', 'info', 'loader'],
    Pending: ['Pending', 'neutral', 'clock']
  };
  function filePill(status) {
    var m = FILE_PILL[status] || FILE_PILL.Pending;
    return pill(m[0], m[1], m[2]);
  }

  /* =========================================================================
     THE STEP META LINE (Part 3.3, enhancement 1)
     "Success · 17:14:02 · 1.4s" — and when started_at / finished_at are absent,
     the status word alone. Never a placeholder, never an em dash standing in
     for a timestamp the backend did not send.
     ========================================================================= */
  function stepMeta(step) {
    var bits = [STEP_WORD[step.status] || step.status];
    var clock = P.clockOf(step.started_at);
    if (clock) bits.push(clock);
    var dur = P.durLabel(P.durationMs(step));
    if (dur) bits.push(dur);
    return '<div class="fd-step-meta">' + bits.map(function (b, i) {
      return i ? '<span class="num">' + esc(b) + '</span>' : esc(b);
    }).join(' · ') + '</div>';
  }

  /* Optional record counts (Part 2.3) — rendered only for the ones actually
     present on the step. A missing count produces no row at all. */
  function stepCounts(step) {
    var bits = [];
    if (step.records_in != null) bits.push('<span class="num">' + num(step.records_in) + '</span> in');
    if (step.records_out != null) bits.push('<span class="num">' + num(step.records_out) + '</span> out');
    if (step.records_rejected != null) bits.push('<span class="num">' + num(step.records_rejected) + '</span> rejected');
    if (!bits.length) return '';
    return '<div class="fd-step-counts">' + bits.join(' · ') + '</div>';
  }

  /* =========================================================================
     THE FAILED-STEP INLINE BLOCK (Part 3.3, enhancement 3)
     The entire point of this brief. Hint, then the raw detail line, then at
     most two actions — a primary that deep-links to where the fix happens and
     Retry where retry is supported.
     ========================================================================= */
  function failBlock(file, step) {
    var res = FH.resolve(step.error_code, file);

    // The hint. Three honest states, never a fabricated cause (Part 5.3).
    var hint = '<div class="fd-fail-hint">' + esc(res.hint) + '</div>';

    // The raw line exactly as the pipeline produced it, clamped to two lines
    // with the full text on the title attribute. Rendered only when present.
    var detail = step.error_detail
      ? '<div class="fd-fail-detail mono" title="' + esc(step.error_detail) + '">' + esc(step.error_detail) + '</div>'
      : '';

    // Where a code is present but uncatalogued, naming it is what tells the
    // next person which entry to add to the lookup.
    var code = (res.state === 'uncatalogued' && step.error_code)
      ? '<div class="fd-fail-code mono">' + esc(step.error_code) + '</div>' : '';

    var btns = [];
    if (res.action) {
      // Carry the way back, so the config screen can offer a return trip.
      var href = res.action.href + (res.action.href.indexOf('?') >= 0 ? '&' : '?') +
        'fileBack=' + encodeURIComponent(location.hash);
      btns.push('<button type="button" class="btn btn-primary btn-sm" data-route="' + esc(href) + '">' +
        esc(res.action.label) + '</button>');
    } else if (step.error_code || step.error_detail) {
      // No useful destination exists, so no button pretends there is one
      // (Part 7). Copy details stays available.
      btns.push('<button type="button" class="btn btn-secondary btn-sm" data-action="fd-copy" ' +
        'data-step="' + esc(step.name) + '">' + icon('copy', 15) + 'Copy details</button>');
    }
    var busy = S.fileDetail.retrying === file.id;
    if (res.retryable) {
      btns.push('<button type="button" class="btn btn-secondary btn-sm" data-action="fd-retry"' +
        (busy ? ' disabled' : '') + '>' + icon('refresh-cw', 15) + (busy ? 'Retrying…' : 'Retry') + '</button>');
    }
    var actions = btns.length ? '<div class="fd-fail-actions">' + btns.join('') + '</div>' : '';

    return '<div class="fd-fail">' + hint + code + detail + actions + '</div>';
  }

  /* A nested check keeps its arrow link (Part 3.4) — omitted when the check
     has no destination worth sending anyone to, and omitted for a check that
     never ran, because there is nothing at the other end of it yet. */
  function checkLink(step) {
    if (!step.link || !step.link.href) return '';
    if (step.status === 'skipped' || step.status === 'pending') return '';
    return '<a class="fd-check-link" data-route="' + esc(step.link.href) + '">' +
      esc(step.link.label) + icon('arrow-right', 13) + '</a>';
  }

  function stepRow(file, step, nested) {
    var st = step.status;
    var body =
      '<div class="fd-step-name">' + esc(step.name) + '</div>' +
      stepMeta(step) +
      stepCounts(step) +
      checkLink(step) +
      // A failed step is expanded by default. There is no toggle: the one
      // thing the operator opened this panel to read is not put behind a click.
      (st === 'failed' ? failBlock(file, step) : '');
    var kids = (step.children || []).map(function (k) { return stepRow(file, k, true); }).join('');
    return '<div class="fd-step ' + esc(st) + (nested ? ' nested' : '') + '">' +
      '<span class="fd-step-icon">' + icon(STEP_ICON[st] || 'circle', 18) + '</span>' +
      '<div class="fd-step-body">' + body + (kids ? '<div class="fd-substeps">' + kids + '</div>' : '') + '</div>' +
      '</div>';
  }

  function timeline(file) {
    if (!file.steps || !file.steps.length) {
      return '<div class="meta">This pipeline reported no steps for this file.</div>';
    }
    return '<div class="fd-timeline">' +
      file.steps.map(function (s) { return stepRow(file, s, false); }).join('') +
      '</div>';
  }

  /* =========================================================================
     TAB 1 — FILE DETAILS
     ========================================================================= */
  function defRow(label, value) {
    return value == null || value === ''
      ? ''                                   // absent field, absent row (Part 2.3)
      : '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>';
  }
  function detailsTab(file) {
    var t = O.tenantById[file.tenantId];
    var facts = '<dl class="def-list fd-facts">' +
      defRow('Status', filePill(file.status)) +
      defRow('File type', esc(file.fileType)) +
      defRow('Direction', esc(file.directionLabel)) +
      defRow('Entity', t ? tenantTag(t.id) : null) +
      defRow('Network', file.networkName ? esc(file.networkName) : null) +
      defRow('Cycle date', U.prettyDate(file.date)) +
      defRow('Total records', file.totalRecords != null ? '<span class="num">' + num(file.totalRecords) + '</span>' : null) +
      defRow('Invalid records', file.invalidRecords != null ? '<span class="num">' + num(file.invalidRecords) + '</span>' : null) +
      defRow('Size', file.size && file.size !== '—' ? '<span class="num">' + esc(file.size) + '</span>' : null) +
      defRow('Checksum', file.checksum ? '<span class="mono fd-mono-sm">' + esc(file.checksum) + '</span>' : null) +
      defRow('Location', file.source ? '<span class="mono fd-mono-sm">' + esc(file.source) + '</span>' : null) +
      '</dl>';

    /* A first attempt that failed says so, and names the file that went out in
       its place — otherwise a failed clearing file reads as a cycle that never
       cleared, which is not what happened. */
    var superseded = file.supersededBy
      ? '<div class="fd-superseded">' + icon('corner-down-right', 15) +
      '<span>Re-cut for this cycle as <span class="mono fd-mono-sm">' + esc(file.supersededBy.name) + '</span>' +
      (file.supersededBy.at ? ' · ' + esc(file.supersededBy.at) : '') + '</span></div>'
      : '';

    return facts + superseded +
      '<div class="fd-section-title">Processing steps</div>' +
      timeline(file);
  }

  /* =========================================================================
     TAB 2 — VALIDATION DETAILS
     The two nested checks, with the same enhancements the timeline gained. A
     pipeline that reports no checks says so rather than showing empty scaffolding.
     ========================================================================= */
  function checksOf(file) {
    var out = [];
    (file.steps || []).forEach(function (s) {
      (s.children || []).forEach(function (k) { out.push({ parent: s, check: k }); });
    });
    return out;
  }
  function validationTab(file) {
    var checks = checksOf(file);
    if (!checks.length) {
      return kit.emptyState('shield-off', 'No validation checks on this pipeline',
        'The ' + file.directionLabel.toLowerCase() + ' pipeline does not report file-level or record-level checks. ' +
        'Everything it did report is on the File Details tab.');
    }
    var totals = '<dl class="def-list fd-facts">' +
      defRow('Total records', file.totalRecords != null ? '<span class="num">' + num(file.totalRecords) + '</span>' : null) +
      defRow('Invalid records', file.invalidRecords != null ? '<span class="num">' + num(file.invalidRecords) + '</span>' : null) +
      '</dl>';
    var cards = checks.map(function (c) {
      var k = c.check;
      return '<div class="fd-check ' + esc(k.status) + '">' +
        '<div class="fd-check-head">' +
        '<span class="fd-step-icon">' + icon(STEP_ICON[k.status] || 'circle', 18) + '</span>' +
        '<div><div class="fd-step-name">' + esc(k.name) + '</div>' +
        '<div class="fd-check-under">under ' + esc(c.parent.name) + '</div></div>' +
        '</div>' +
        stepMeta(k) + stepCounts(k) + checkLink(k) +
        (k.status === 'failed' ? failBlock(file, k) : '') +
        '</div>';
    }).join('');
    return totals + '<div class="fd-section-title">Validation checks</div>' + '<div class="fd-checks">' + cards + '</div>';
  }

  /* =========================================================================
     THE PANEL
     ========================================================================= */
  function tabs(file) {
    var t = S.fileDetail.tab;
    function tab(id, label) {
      return '<button type="button" class="fd-tab' + (t === id ? ' active' : '') +
        '" data-action="fd-tab" data-tab="' + id + '" role="tab" aria-selected="' + (t === id ? 'true' : 'false') + '">' +
        esc(label) + '</button>';
    }
    return '<div class="fd-tabs" role="tablist">' + tab('details', 'File Details') + tab('validation', 'Validation Details') + '</div>';
  }

  function overflow() {
    var open = S.fileDetail.menu;
    return '<div class="fd-overflow">' +
      '<button class="icon-btn" data-action="fd-menu" aria-expanded="' + (open ? 'true' : 'false') + '" ' +
      'title="More" aria-label="More actions">' + icon('more-horizontal', 18) + '</button>' +
      (open ? '<div class="fd-menu">' +
        '<button data-action="fd-copy-uuid">' + icon('hash', 15) + 'Copy UUID</button>' +
        '<button data-action="fd-copy-name">' + icon('file', 15) + 'Copy file name</button>' +
        '<button data-action="fd-download">' + icon('download', 15) + 'Download file</button>' +
        '</div>' : '') +
      '</div>';
  }

  function html(file) {
    var t = O.tenantById[file.tenantId];
    var eyebrow = file.directionLabel + ' · ' + (t ? t.name : file.tenantId) +
      (file.networkName ? ' · ' + file.networkName : '') + ' · ' + U.prettyDate(file.date);
    // Header (Part 3.1) — file name, UUID beneath it, overflow menu. Unchanged.
    var name = '<span class="fd-name mono">' + esc(file.name) + '</span>' +
      '<div class="fd-uuid mono">' + esc(file.uuid) + '</div>';
    var body = tabs(file) +
      '<div class="fd-tabbody">' +
      (S.fileDetail.tab === 'validation' ? validationTab(file) : detailsTab(file)) +
      '</div>';
    // Footer (Part 3.5) — Uploaded By / Uploaded On. Unchanged.
    var foot = '<dl class="def-list fd-foot">' +
      defRow('Uploaded By', esc(file.uploadedBy)) +
      defRow('Uploaded On', file.uploadedOn ? esc(file.uploadedOn) : null) +
      '</dl>';
    return kit.sidePanel({
      eyebrow: eyebrow, name: name, body: body, foot: foot,
      wide: true, cls: 'fd-panel', close: 'fd-close',
      headExtra: overflow()
    });
  }

  function current() { return S.fileDetail.id ? P.byId(S.fileDetail.id) : null; }

  function stepByName(file, name) {
    if (!name) return null;
    var hit = null;
    (function walk(list) {
      (list || []).forEach(function (s) {
        if (s.name === name) hit = s;
        if (s.children) walk(s.children);
      });
    })(file.steps);
    return hit;
  }

  /* Screens behind the panel register here so a Retry that changes a file's
     status repaints the list underneath it. One hook, set by whichever screen
     opened the panel. */
  var onChange = null;
  function setOnChange(fn) { onChange = fn; }

  function paint() {
    var file = current();
    var mount = el('overlay-mount');
    if (!mount) return;
    if (!file) { mount.innerHTML = ''; return; }
    mount.innerHTML = html(file);
    if (window.lucide) window.lucide.createIcons();
  }

  function open(file, tab) {
    if (!file) return;
    S.fileDetail.id = file.id;
    S.fileDetail.tab = tab || 'details';
    S.fileDetail.menu = false;
    paint();
  }
  function close() {
    S.fileDetail.id = null; S.fileDetail.menu = false;
    var mount = el('overlay-mount');
    if (mount) mount.innerHTML = '';
  }

  /* Clipboard without storage: the async API where it exists, a throwaway
     textarea where it does not. Neither persists anything. */
  function copy(text, what) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      toast(what + ' copied', 'success');
    } catch (e) {
      toast('Could not copy — select the text and copy it manually', 'info');
    }
  }

  var ACTIONS = {
    'fd-close': function () { close(); },
    'fd-tab': function (t) { S.fileDetail.tab = t.getAttribute('data-tab') || 'details'; paint(); },
    'fd-menu': function () { S.fileDetail.menu = !S.fileDetail.menu; paint(); },
    'fd-copy-uuid': function () { var f = current(); if (f) copy(f.uuid, 'UUID'); S.fileDetail.menu = false; paint(); },
    'fd-copy-name': function () { var f = current(); if (f) copy(f.name, 'File name'); S.fileDetail.menu = false; paint(); },
    'fd-download': function () { var f = current(); if (f) toast('Downloading ' + f.name); S.fileDetail.menu = false; paint(); },
    /* Copy details takes the whole failure verbatim — the file, the step, the
       code and the raw line — because that is what gets pasted into a ticket. */
    'fd-copy': function (t) {
      var f = current(); if (!f) return;
      var step = stepByName(f, t.getAttribute('data-step')) || P.failedStep(f);
      if (!step) return;
      var lines = [f.name, f.uuid, 'Step: ' + step.name];
      if (step.error_code) lines.push('Code: ' + step.error_code);
      if (step.error_detail) lines.push(step.error_detail);
      copy(lines.join('\n'), 'Failure details');
    },
    /* Retry re-runs the failed step. A transient failure clears; anything
       whose cause is a configuration fails identically, which is the honest
       result and the reason the hint carries a link to that configuration. */
    'fd-retry': function () {
      var f = current(); if (!f) return;
      if (S.fileDetail.retrying) return;
      if (!P.startRetry(f)) return;
      S.fileDetail.retrying = f.id;
      paint();
      setTimeout(function () {
        var outcome = P.finishRetry(f);
        S.fileDetail.retrying = null;
        if (S.fileDetail.id === f.id) paint();
        if (outcome === 'cleared') toast('Retry succeeded — ' + f.name + ' completed', 'success');
        else if (outcome === 'recurred') toast('Retried, and the same error recurred. Fix the configuration first.', 'info');
        if (onChange) onChange(f);
      }, P.retryDurationMs(f));
    }
  };

  return {
    open: open, close: close, paint: paint, html: html,
    actions: ACTIONS, current: current, setOnChange: setOnChange
  };
};
