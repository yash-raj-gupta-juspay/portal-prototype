/* =============================================================================
   Juspay Ops Portal — Acquirer Reports screen (refinement round 2 §C)

   The screen answers two questions in this order:
     1. "Is anything wrong anywhere today?"  — the cross-acquirer overview strip,
        which always spans every acquirer even though the table below defaults
        to one tenant. That is the whole point of it.
     2. "What do I do about this row?"       — two independent status columns
        and five row actions that form the correction loop:
           Mismatch → download → correct → upload → re-validate → share.

   window.FilesUI(kit) → { route, actions }
   ============================================================================= */
window.FilesUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, F = window.SFILES;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox,
    setView = kit.setView, toast = kit.toast, el = kit.el,
    num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag, emptyState = kit.emptyState;

  var TODAY = F.TODAY;
  var MIN_DATE = U.addDays(TODAY, -29);

  // In-memory only. The tenant filter lives on S.ops.filesTenant because the
  // Ops Home queues deep-link into this screen with ?filesTenant=…
  S.files = {
    q: '', type: 'all', delivery: 'all', validation: 'all',
    dateMode: 'today', date: TODAY, from: U.addDays(TODAY, -6), to: TODAY,
    openReport: null,
    // Part 6.3 — By delivery date is the default because it answers the
    // question the ops team actually asks each morning.
    group: 'delivery'
  };

  /* ---- date selection (§C.6) ---------------------------------------------- */
  function clampDate(d) { return d < MIN_DATE ? MIN_DATE : (d > TODAY ? TODAY : d); }
  function range() {
    var f = S.files, m = f.dateMode;
    if (m === '7') return { from: U.addDays(TODAY, -6), to: TODAY, label: 'Last 7 days' };
    if (m === '30') return { from: U.addDays(TODAY, -29), to: TODAY, label: 'Last 30 days' };
    if (m === 'date') return { from: f.date, to: f.date, label: U.prettyDate(f.date) };
    if (m === 'range') {
      var a = f.from <= f.to ? f.from : f.to, b = f.from <= f.to ? f.to : f.from;
      return { from: a, to: b, label: U.prettyDate(a) + ' → ' + U.prettyDate(b) };
    }
    return { from: TODAY, to: TODAY, label: 'Today · ' + U.prettyDate(TODAY) };
  }

  /* ---- pills -------------------------------------------------------------- */
  function deliveryPill(row) {
    var m = F.DELIVERY[row.delivery];
    var tag = row.manual
      ? '<span class="sf-manual" title="' + esc('Manually marked by ' + row.manual.by + ' · ' + row.manual.at + ' — ' + row.manual.note) + '">' +
      icon('hand', 11) + 'manually marked</span>'
      : '';
    return '<div class="sf-status">' + pill(m.label, m.kind, m.icon) + tag + whyLink(row, 'delivery') + '</div>';
  }
  function validationPill(row) {
    var m = F.VALIDATION[row.validation];
    var hint = row.validation === 'Mismatch'
      ? '<div class="sf-hint" title="' + esc('The correction loop: pull the file, fix it outside the platform, upload the corrected copy (validation resets), then re-run validation.') + '">' +
      'Download → correct → upload → re-validate</div>'
      : '';
    return '<div class="sf-status">' + pill(m.label, m.kind, m.icon) + hint + '</div>';
  }

  /* =======================================================================
     FILE-DETAIL BRIEF PART 6 — THE SAME PANEL, SECOND ENTRY POINT
     A Failed delivery is explained here rather than on a screen of its own:
     the row opens the file detail panel, whose Deliver to acquirer step
     carries the hint and the link. One component, one visual language.
     ======================================================================= */
  function fileFor(row) { return window.PFILES ? window.PFILES.forSettlementRow(row) : null; }
  function openPanel(row) {
    var f = fileFor(row);
    if (!f || !kit.filePanel) return;
    kit.filePanel.setOnChange(repaint);
    kit.filePanel.open(f);
  }
  /* Omitted entirely when the pipeline reports nothing failed — a link that
     promises an explanation it cannot give is worse than no link (Part 7). */
  function whyLink(row, which) {
    if (which !== 'delivery' || row.delivery !== 'Failed') return '';
    var f = fileFor(row);
    if (!f || !window.PFILES.failedStep(f)) return '';
    return '<button class="sf-why" data-action="sf-detail" data-id="' + esc(row.id) + '" ' +
      'title="' + esc('Open the processing detail for ' + row.name) + '">' +
      icon('help-circle', 13) + 'What failed?' + icon('arrow-right', 12) + '</button>';
  }

  /* PART 6.1 — the delivery-timing chart is gone, with no replacement. It has
     not proven useful: the table already carries delivery status and the shared
     time per file, and a trend line nobody acts on costs attention and returns
     nothing. There is no chart on this screen. */

  /* ---- filter row --------------------------------------------------------- */
  function select(action, value, opts) {
    return '<select class="input" style="width:auto" data-action="' + action + '">' +
      opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }
  function filters() {
    var tid = S.ops.filesTenant;
    var tenantOpts = [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; }));
    // §C.2 — file types come from the registry for the selected tenant, never a
    // hardcoded list. Switching tenant re-populates this control.
    var typeOpts = [['all', 'All files']].concat(F.typesForFilter(tid).map(function (ft) { return [ft, ft]; }));
    var delOpts = [['all', 'All']].concat(F.DELIVERY_KEYS.map(function (k) { return [k, F.DELIVERY[k].label]; }));
    var valOpts = [['all', 'All']].concat(F.VALIDATION_KEYS.map(function (k) { return [k, F.VALIDATION[k].label]; }));

    var presets = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(function (p) {
      return '<button type="button" class="chip sf-chip' + (S.files.dateMode === p[0] ? ' active' : '') +
        '" data-action="sf-datemode" data-mode="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
    var onDate = S.files.dateMode === 'date';
    var onRange = S.files.dateMode === 'range';
    var dateBox = '<label class="chip sf-chip' + (onDate ? ' active' : '') + '" title="Pick a single cycle date">' +
      icon('calendar', 15) + '<input type="date" class="sf-dateinput" data-action="sf-date" value="' + S.files.date +
      '" min="' + MIN_DATE + '" max="' + TODAY + '" /></label>';
    var rangeBox = '<div class="chip sf-chip' + (onRange ? ' active' : '') + '" title="Custom date range">' +
      icon('calendar-range', 15) + '<input type="date" class="sf-dateinput" data-action="sf-from" value="' + S.files.from +
      '" min="' + MIN_DATE + '" max="' + TODAY + '" /><span class="meta">→</span>' +
      '<input type="date" class="sf-dateinput" data-action="sf-to" value="' + S.files.to +
      '" min="' + MIN_DATE + '" max="' + TODAY + '" /></div>';

    // Part 3.3 — search, then four categorical filters, then the preset, then
    // the resolved date range, then refresh.
    return kit.opsFilterRow({
      search: { placeholder: 'Search file name', action: 'sf-i-q', value: S.files.q || '' },
      filters: [
        { action: 'sf-tenant', value: tid, label: 'Tenant', options: tenantOpts },
        { action: 'sf-type', value: S.files.type, label: 'File', options: typeOpts },
        { action: 'sf-delivery', value: S.files.delivery, label: 'Delivery', options: delOpts },
        { action: 'sf-validation', value: S.files.validation, label: 'Validation', options: valOpts }
      ],
      preset: {
        action: 'sf-preset', value: S.files.dateMode,
        options: [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['date', 'Specific date'], ['range', 'Custom range']]
      },
      dateRange: (onDate
        ? '<input type="date" data-action="sf-date" value="' + S.files.date + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="Cycle date" />'
        : (onRange
          ? '<input type="date" data-action="sf-from" value="' + S.files.from + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="From" />' +
          '<span class="meta">–</span>' +
          '<input type="date" data-action="sf-to" value="' + S.files.to + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="To" />'
          : '<span>' + esc(range().label) + '</span>')) + kit.icon('chevron-down', 16),
      refresh: 'sf-refresh',
      extra: groupToggle()
    }) + '<div class="mb-16"></div>';
  }

  /* =========================================================================
     PART 6.3 — TODAY'S DELIVERIES SPAN TWO CYCLES

     On any given day the platform delivers MPR, MPF and JV1 for the T-1 cycle
     alongside JV2 for the T-2 cycle: JV2 posts adjustments that only exist once
     the following cycle's incoming has been read, so it is always a full cycle
     behind its siblings.

     "Did today's files go out" is the operational question and it cannot be
     answered inside one cycle. So the default grouping is by DELIVERY DATE,
     with every row stating which cycle it belongs to; By cycle is there for the
     opposite question — what did this cycle produce.
     ========================================================================= */
  function groupToggle() {
    return '<div class="sf-group" role="radiogroup" aria-label="Grouping">' +
      [['delivery', 'By delivery date'], ['cycle', 'By cycle']].map(function (o) {
        var on = S.files.group === o[0];
        return '<button type="button" class="sf-group-btn' + (on ? ' active' : '') + '" ' +
          'data-action="sf-group" data-group="' + o[0] + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
          esc(o[1]) + '</button>';
      }).join('') + '</div>';
  }

  /* ---- row actions (§C.4) ------------------------------------------------- */
  function actionBtn(action, id, ic, label, enabled, extra) {
    return '<button type="button" class="sf-act" ' + (enabled ? 'data-action="' + action + '" data-id="' + esc(id) + '"' : 'disabled') +
      ' title="' + esc(enabled ? label : label + ' — not available in this state') + '" aria-label="' + esc(label) + '">' +
      icon(ic, 15) + (extra || '') + '</button>';
  }
  function rowActions(row) {
    var canShare = row.delivery === 'Pending' || row.delivery === 'Failed';
    var canValidate = row.validation === 'Not run' || row.validation === 'Mismatch';
    var canReport = row.validation === 'Validated' || row.validation === 'Mismatch';
    return '<div class="sf-actions">' +
      actionBtn('sf-download', row.id, 'download', 'Download ' + row.name, true) +
      actionBtn('sf-detail', row.id, 'list-checks', 'Processing detail — every step this file went through', true) +
      actionBtn('sf-mark', row.id, 'hand', 'Mark as shared with the acquirer', canShare) +
      actionBtn('sf-upload', row.id, 'upload', 'Upload corrected file', true) +
      actionBtn('sf-validate', row.id, 'shield-check', 'Run validation against the base DB source', canValidate) +
      actionBtn('sf-report', row.id, 'file-search', 'View validation report', canReport) +
      '</div>';
  }

  /* ---- validation report expansion (§C.4) --------------------------------- */
  function reportBlock(row) {
    var rep = row.report;
    if (!rep) return '<div class="meta">No validation has been run for this file yet.</div>';
    var cur = rep.currency;
    var countOk = rep.fileRecords === rep.sourceRecords;
    var sumOk = rep.fileSum === rep.sourceSum;
    function cmp(label, a, b, ok, isMoney) {
      return '<tr><td>' + label + '</td>' +
        '<td class="num">' + (isMoney ? fmt(a, 2, cur) : num(a)) + '</td>' +
        '<td class="num">' + (isMoney ? fmt(b, 2, cur) : num(b)) + '</td>' +
        '<td class="num ' + (ok ? 'sf-ok' : 'sf-bad') + '">' + (ok ? '0' : (isMoney ? fmt(b - a, 2, cur) : num(b - a))) + '</td>' +
        '<td>' + (ok ? pill('Match', 'success', 'check') : pill('Differs', 'danger', 'alert-triangle')) + '</td></tr>';
    }
    var recRows = rep.rows.map(function (m) {
      return '<tr><td class="mono">' + esc(m.id) + '</td><td>' + esc(m.field) + '</td>' +
        '<td class="num">' + (m.fileValue == null ? '<span class="sf-bad">absent</span>' : fmt(m.fileValue, 2, cur)) + '</td>' +
        '<td class="num">' + fmt(m.sourceValue, 2, cur) + '</td>' +
        '<td class="num sf-bad">' + fmt(m.delta, 2, cur) + '</td></tr>';
    }).join('');
    return '<div class="sf-report">' +
      '<div class="sf-report-head"><span class="sf-report-title">Validation report · ' + esc(row.name) + '</span>' +
      '<span class="meta">Run ' + esc(rep.ranAt) + ' · file contents vs. base DB source</span></div>' +
      relatedRunLinks(row) +
      '<div class="table-wrap"><table class="data sf-report-table"><thead><tr><th>Check</th><th class="num">In file</th><th class="num">In source</th><th class="num">Delta</th><th>Result</th></tr></thead><tbody>' +
      cmp('Record count', rep.fileRecords, rep.sourceRecords, countOk, false) +
      cmp('Sum of amounts', rep.fileSum, rep.sourceSum, sumOk, true) +
      '</tbody></table></div>' +
      (rep.rows.length
        ? '<div class="cyc-sub-title">Mismatched records</div>' +
        '<div class="table-wrap"><table class="data sf-report-table"><thead><tr><th>Record</th><th>Field</th><th class="num">File value</th><th class="num">Source value</th><th class="num">Delta</th></tr></thead><tbody>' + recRows + '</tbody></table></div>' +
        /* Part 1.1 — the correction loop is described by the row's own
           actions and by the validation pill's hint, not by a line under the
           table restating it. */
        ''
        : '') +
      '<div class="cyc-sub-title">File history</div>' +
      '<div class="sf-events">' + kit.immutableTimeline(row.events.slice().reverse()) + '</div>' +
      '</div>';
  }

  /* An acquirer report row links to its own processing detail and to the cycle
     it belongs to. Each link is omitted when it has no destination. */
  function relatedRunLinks(row) {
    var links = [];
    if (fileFor(row)) {
      links.push('<a data-action="sf-detail" data-id="' + esc(row.id) + '">' + icon('list-checks', 14) +
        'How this file was produced' + icon('arrow-right', 13) + '</a>');
    }
    var net = (window.CYCLES && window.CYCLES.networksFor(row.tenantId)[0]) || null;
    if (net) {
      links.push('<a data-route="#/dashboard/ops/cycle-snapshot/' + esc(row.tenantId) + '/' +
        esc(net.key) + '/' + esc(row.date) + '">' + icon('calendar-clock', 14) +
        'This cycle’s snapshot' + icon('arrow-right', 13) + '</a>');
    }
    /* Recon Files merged into Reconciliation (Part 4.3), so this goes to the
       reconciliation itself rather than to a screen that no longer exists. */
    links.push('<a data-route="#/dashboard/ops/reconciliation?reconTenant=' + esc(row.tenantId) + '">' +
      icon('git-compare', 14) + 'Reconciliation for this acquirer' + icon('arrow-right', 13) + '</a>');
    return '<div class="sf-related">' + links.join('') + '</div>';
  }

  /* ---- the table (§C.8) --------------------------------------------------- */
  var TYPE_ORDER = ['MPR', 'GEFU1', 'MPF', 'GEFU2', 'JV1', 'JV2'];
  function visibleRows(rg) {
    var tid = S.ops.filesTenant, f = S.files;
    return F.rowsForRange(rg.from, rg.to).filter(function (r) {
      if (tid !== 'all' && r.tenantId !== tid) return false;
      if (f.type !== 'all' && r.type !== f.type) return false;
      if (f.delivery !== 'all' && r.delivery !== f.delivery) return false;
      if (f.validation !== 'all' && r.validation !== f.validation) return false;
      if (f.q && r.name.toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    }).sort(function (a, b) {
      /* Grouping decides the outer order; within a group the rows read tenant,
         then generation order, which puts JV2 last — where it belongs, since it
         is the one file reporting on the earlier cycle. */
      var ka = S.files.group === 'cycle' ? a.cycleDate : a.deliveryDate;
      var kb = S.files.group === 'cycle' ? b.cycleDate : b.deliveryDate;
      if (ka !== kb) return ka < kb ? 1 : -1;
      if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
      return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    });
  }

  function rowHtml(r, colspan) {
    var cls = r.delivery === 'Failed' ? 'sf-row-failed' : (r.validation === 'Mismatch' ? 'sf-row-mismatch' : '');
    var open = S.files.openReport === r.id;
    // Part 6.2 — clicking the row opens the file detail panel, unchanged. The
    // row actions carry their own data-action and the delegate resolves the
    // innermost one, so the buttons keep working exactly as before.
    var main = '<tr class="' + cls + (open ? ' sf-row-open' : '') + ' sf-row-clickable" ' +
      'data-action="sf-detail" data-id="' + esc(r.id) + '" tabindex="0" ' +
      'title="' + esc('Open the processing detail for ' + r.name) + '">' +
      '<td class="sf-tenant-col">' + tenantTag(r.tenantId) + '</td>' +
      '<td><div class="cell-main"><span class="file-badge sf-type">' + r.type + '</span></div>' +
      '<div class="cell-sub sf-filename" title="' + esc(r.dest + r.name + ' · ' + r.checksum) + '">' + esc(r.name) + '</div></td>' +
      /* Part 6.3 — every row states which cycle it belongs to, whichever way the
         list is grouped. Settlement files have no network dimension, so the
         cycle is named by its date: a network-bearing cycle identifier here
         would reintroduce a key this screen deliberately does not carry. */
      '<td class="nowrap sf-cycle-col"><div class="cell-main">' + U.prettyDate(r.cycleDate) + '</div>' +
      '<div class="cell-sub">cycle ' + (r.cycleOffset === -2 ? 'T-2' : 'T-1') + '</div></td>' +
      '<td class="nowrap"><div class="cell-main">' + U.prettyDate(r.deliveryDate) + '</div>' +
      '<div class="cell-sub">' + r.dow +
      (r.holiday ? ' · <span class="sf-holiday">' + icon('calendar-x', 11) + esc(r.holiday.name) + '</span>' : '') + '</div></td>' +
      '<td>' + deliveryPill(r) + (r.failReason ? '<div class="sf-hint danger" title="' + esc(r.failReason) + '">delivery failed — see history</div>' : '') + '</td>' +
      '<td>' + validationPill(r) + '</td>' +
      '<td class="nowrap cell-sub">' + esc(r.generatedAt) + '</td>' +
      '<td class="nowrap cell-sub">' + (r.sharedAt ? esc(r.sharedAt) : '—') + '</td>' +
      '<td class="num">' + r.size + '</td>' +
      '<td>' + rowActions(r) + '</td></tr>';
    var exp = open ? '<tr class="sf-expand"><td colspan="' + colspan + '">' + reportBlock(r) + '</td></tr>' : '';
    return main + exp;
  }

  var SF_COLS = 10;
  function tableShell(body) {
    return '<div class="table-card"><div class="table-wrap sf-table-wrap"><table class="data sf-table"><thead><tr>' +
      '<th class="sf-tenant-col">Tenant</th><th>File</th><th class="sf-cycle-col">Cycle</th><th>Delivered on</th>' +
      '<th>Delivery status</th><th>Validation status</th><th>Generated at</th><th>Shared at</th>' +
      '<th class="num">Size</th><th>Actions</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  /* Part 6.3 — grouped rendering. Under By delivery date one heading gathers
     the MPR / MPF / JV1 of the T-1 cycle and the JV2 of the T-2 cycle, which is
     exactly the set that had to leave that day. Under By cycle the heading is
     the cycle, and its JV2 sits with it — a full day after its siblings went. */
  function groupRows(rows) {
    var byKey = {}, order = [];
    var byCycle = S.files.group === 'cycle';
    rows.forEach(function (r) {
      var key = byCycle ? r.cycleDate : r.deliveryDate;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(r);
    });
    order.sort(function (a, b) { return a < b ? 1 : -1; });
    return order.map(function (key) {
      var group = byKey[key];
      var cycles = {};
      group.forEach(function (r) { cycles[r.cycleDate] = 1; });
      var n = Object.keys(cycles).length;
      var sub = group.length + ' file' + (group.length === 1 ? '' : 's') +
        (!byCycle && n > 1 ? ' · <strong>' + n + ' cycles</strong>' : '');
      return { key: key, sub: sub, rows: group };
    });
  }

  function table(rows) {
    if (!rows.length) {
      return '<div class="card">' + emptyState('file-check', 'No acquirer reports in this view',
        'Widen the date range or clear the tenant, file and status filters.',
        '<button class="btn btn-secondary" data-action="sf-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var byCycle = S.files.group === 'cycle';
    return groupRows(rows).map(function (g) {
      return '<div class="sf-group-head">' +
        '<span class="sf-group-date">' + esc(U.prettyDate(g.key)) + '</span>' +
        '<span class="sf-group-kind">' + (byCycle ? 'cycle' : 'delivered') + '</span>' +
        '<span class="meta">' + g.sub + '</span></div>' +
        tableShell(g.rows.map(function (r) { return rowHtml(r, SF_COLS); }).join(''));
    }).join('');
  }

  /* ---- screen ------------------------------------------------------------- */
  function render() {
    var rg = range();
    var rows = visibleRows(rg);
    var tid = S.ops.filesTenant;
    var scope = tid === 'all' ? 'all acquirers' : O.tenantById[tid].name;
    setView(
      kit.pageHead('Acquirer Reports',
        'Whether each report reached the acquirer, and whether its contents match the source.') +
      filters() +
      '<div class="sf-scope meta">Showing <strong>' + rows.length + '</strong> file' + (rows.length === 1 ? '' : 's') +
      ' · ' + esc(scope) + ' · ' + esc(rg.label) + '</div>' +
      table(rows)
    );
  }

  /* Re-render only if this screen is still mounted — a validation run that
     resolves after the analyst has navigated away must not repaint the view. */
  function repaint() { if (location.hash.indexOf('/ops/files') >= 0) render(); }

  /* =======================================================================
     ROW ACTIONS
     ======================================================================= */
  function closeOverlay() { el('overlay-mount').innerHTML = ''; }
  function paintOverlay(html) {
    el('overlay-mount').innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

  function markModal(row) {
    paintOverlay('<div class="overlay" data-action="sf-close"><div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div class="section-title">Mark as shared with the acquirer</div>' +
      '<button class="icon-btn" data-action="sf-close">' + icon('x', 16) + '</button></div>' +
      '<div class="stack">' +
      '<div class="callout warn">' + icon('hand', 20) + '<div class="callout-body">A manual assertion, not a confirmed delivery. The row stays tagged <strong>manually marked</strong>.</div></div>' +
      '<dl class="def-list"><dt>File</dt><dd class="mono">' + esc(row.name) + '</dd>' +
      '<dt>Tenant</dt><dd>' + tenantTag(row.tenantId) + '</dd>' +
      '<dt>Cycle date</dt><dd>' + U.prettyDate(row.date) + '</dd>' +
      '<dt>Current status</dt><dd>' + pill(F.DELIVERY[row.delivery].label, F.DELIVERY[row.delivery].kind) + '</dd></dl>' +
      '<label class="field">Why are you marking this manually? <span class="req">*</span>' +
      '<textarea class="input" id="sf-note" placeholder="e.g. Acquirer confirmed receipt by email at 08:40 — transfer log never registered the ACK."></textarea></label>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px">' +
      '<button class="btn btn-secondary" data-action="sf-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="sf-mark-confirm" data-id="' + esc(row.id) + '">' + icon('check', 16) + 'Mark as shared</button>' +
      '</div></div></div></div>');
  }

  function uploadModal(row) {
    paintOverlay('<div class="overlay" data-action="sf-close"><div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div class="section-title">Upload corrected file</div>' +
      '<button class="icon-btn" data-action="sf-close">' + icon('x', 16) + '</button></div>' +
      '<div class="stack" id="sf-upload-body">' +
      '<dl class="def-list"><dt>Replacing</dt><dd class="mono">' + esc(row.name) + '</dd>' +
      '<dt>Current size</dt><dd class="num">' + row.size + '</dd>' +
      '<dt>Validation</dt><dd>' + pill(F.VALIDATION[row.validation].label, F.VALIDATION[row.validation].kind) + '</dd></dl>' +
      '<div class="callout info">' + icon('info', 20) + '<div class="callout-body">This becomes the active file for the row and <strong>validation resets to Not run</strong>.</div></div>' +
      '<label class="field">Choose the corrected file' +
      '<input type="file" class="input sf-file" data-action="sf-upload-file" data-id="' + esc(row.id) + '" /></label>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px">' +
      '<button class="btn btn-secondary" data-action="sf-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="sf-upload-sim" data-id="' + esc(row.id) + '">' + icon('upload', 16) + 'Use corrected copy of this file</button>' +
      '</div></div></div></div>');
  }

  /* Simulated S3 write — a progress indicator, then the row is replaced. */
  function runUpload(row, name) {
    var body = el('sf-upload-body');
    if (body) {
      body.innerHTML = '<div class="meta mb-16">Uploading <span class="mono">' + esc(name) + '</span> …</div>' +
        '<div class="sf-progress"><div class="sf-progress-bar" id="sf-bar"></div></div>' +
        '<div class="meta mt-16" id="sf-pct">0%</div>';
    }
    var w = 0;
    var iv = setInterval(function () {
      w += 20;
      var bar = el('sf-bar'), pc = el('sf-pct');
      if (bar) bar.style.width = w + '%';
      if (pc) pc.textContent = w + '%';
      if (w >= 100) {
        clearInterval(iv);
        F.replaceFile(row, name);
        closeOverlay();
        toast('Uploaded ' + name + ' — validation reset to Not run', 'success');
        repaint();
      }
    }, 220);
  }

  function runValidation(row) {
    row.validation = 'Running';
    repaint();
    setTimeout(function () {
      var outcome = F.finishValidation(row);
      if (outcome === 'Mismatch') S.files.openReport = row.id;
      toast('Validation ' + (outcome === 'Mismatch' ? 'found a mismatch in ' : 'passed for ') + row.name,
        outcome === 'Mismatch' ? 'info' : 'success');
      repaint();
    }, F.validationDurationMs(row));
  }

  function withRow(t, fn) {
    var row = F.rowById(t.getAttribute('data-id'));
    if (row) fn(row);
  }

  var ACTIONS = {
    'sf-tenant': function (t) {
      S.ops.filesTenant = t.value;
      // The file filter is registry-driven; a type the new tenant does not
      // produce would silently empty the table, so reset it.
      if (S.files.type !== 'all' && F.typesForFilter(t.value).indexOf(S.files.type) < 0) S.files.type = 'all';
      S.files.openReport = null; render();
    },
    'sf-type': function (t) { S.files.type = t.value; render(); },
    'sf-delivery': function (t) { S.files.delivery = t.value; render(); },
    'sf-validation': function (t) { S.files.validation = t.value; render(); },
    'sf-datemode': function (t) { S.files.dateMode = t.getAttribute('data-mode'); S.files.openReport = null; render(); },
    'sf-preset': function (t) { S.files.dateMode = t.value; S.files.openReport = null; render(); },
    'sf-i-q': function (t) {
      S.files.q = t.value; S.files.openReport = null; render();
      var i = el('view').querySelector('[data-action="sf-i-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'sf-clear': function () {
      S.ops.filesTenant = 'all';
      S.files.q = ''; S.files.type = 'all'; S.files.delivery = 'all'; S.files.validation = 'all';
      S.files.dateMode = '30'; S.files.openReport = null; render();
    },
    'sf-refresh': function () { S.files.openReport = null; render(); toast('Refreshed', 'success'); },
    // Part 6.3 — the grouping toggle. It changes how rows are gathered, never
    // which rows are in scope, so every other filter survives the switch.
    'sf-group': function (t) { S.files.group = t.getAttribute('data-group') || 'delivery'; render(); },
    'sf-date': function (t) { S.files.date = clampDate(t.value || TODAY); S.files.dateMode = 'date'; S.files.openReport = null; render(); },
    'sf-from': function (t) { S.files.from = clampDate(t.value || S.files.from); S.files.dateMode = 'range'; S.files.openReport = null; render(); },
    'sf-to': function (t) { S.files.to = clampDate(t.value || S.files.to); S.files.dateMode = 'range'; S.files.openReport = null; render(); },
    'sf-pick-tenant': function (t) {
      S.ops.filesTenant = t.getAttribute('data-tenant');
      if (S.files.type !== 'all' && F.typesForFilter(S.ops.filesTenant).indexOf(S.files.type) < 0) S.files.type = 'all';
      S.files.openReport = null; render();
    },
    'sf-download': function (t) { withRow(t, function (row) { toast('Downloading ' + row.name); }); },
    'sf-mark': function (t) { withRow(t, markModal); },
    'sf-mark-confirm': function (t) {
      withRow(t, function (row) {
        var box = el('sf-note');
        var note = box ? String(box.value || '').trim() : '';
        if (note.length < 5) { toast('A reason is required to mark a file as shared', 'info'); return; }
        F.markShared(row, note);
        closeOverlay();
        toast('Marked as shared — tagged “manually marked”', 'success');
        repaint();
      });
    },
    'sf-upload': function (t) { withRow(t, uploadModal); },
    'sf-upload-file': function (t) {
      withRow(t, function (row) {
        var name = (t.files && t.files[0]) ? t.files[0].name : ('corrected_' + row.name);
        runUpload(row, name);
      });
    },
    'sf-upload-sim': function (t) { withRow(t, function (row) { runUpload(row, 'corrected_' + row.name); }); },
    'sf-validate': function (t) { withRow(t, runValidation); },
    'sf-report': function (t) {
      withRow(t, function (row) {
        S.files.openReport = S.files.openReport === row.id ? null : row.id;
        render();
      });
    },
    'sf-close': function () { closeOverlay(); },
    /* The panel opens over the table rather than navigating away, so the row
       the analyst was working stays on screen behind it. */
    'sf-detail': function (t) { withRow(t, openPanel); }
  };

  function route() {
    // Deep links land on S.ops.* via routeOps: filesTenant scopes the table,
    // filesDate narrows to one cycle, filesOpenValidation opens that row's
    // validation report so the link arrives at the report itself.
    if (S.files.type !== 'all' && F.typesForFilter(S.ops.filesTenant).indexOf(S.files.type) < 0) S.files.type = 'all';
    if (S.ops.filesDate) {
      S.files.dateMode = 'date';
      S.files.date = clampDate(S.ops.filesDate);
      S.ops.filesDate = null;
    }
    if (S.ops.filesOpenValidation) {
      var hit = visibleRows(range()).filter(function (r) { return r.validation === 'Mismatch' || r.delivery === 'Failed'; })[0];
      if (hit) S.files.openReport = hit.id;
      S.ops.filesOpenValidation = null;
    }
    render();
  }

  return { route: route, render: render, actions: ACTIONS };
};
