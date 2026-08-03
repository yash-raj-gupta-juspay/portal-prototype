/* =============================================================================
   Juspay Ops Portal — Recon File Management (file-detail brief Part 6)

   The primary home of the file detail panel. It lists the files the
   reconciliation pipeline processed — incoming network files and the outgoing
   clearing files cut from them — and a row click opens the panel.

   It is a child of Reconciliation, not a section of its own. The brief is
   explicit that this build adds no new sections; the panel is one component
   with three doors, and this is the first of them. Settlement File Monitoring
   and Cycle Snapshot are the other two, and both open the same component on
   the same records.

   The list itself stays deliberately thin. It says which file, which cycle,
   what state it is in and which step it reached; everything else — the step
   timeline, the hint, the raw error line, the link to the fix — belongs to the
   panel, so there is exactly one place that explains a failure.

   window.ReconFilesUI(kit) → { route, render, actions }
   ============================================================================= */
window.ReconFilesUI = function (kit, panel) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, P = window.PFILES, C = window.CYCLES;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, setView = kit.setView,
    el = kit.el, toast = kit.toast, num = kit.num, tenantTag = kit.tenantTag,
    emptyState = kit.emptyState;

  var CYCLE_TODAY = P.CYCLE_TODAY;
  var DATES = P.cycleDates();
  var MIN_DATE = DATES[0], MAX_DATE = DATES[DATES.length - 1];

  // In memory only.
  S.reconFiles = {
    q: '', tenant: 'all', network: 'all', direction: 'all', status: 'all',
    dateMode: 'current', date: CYCLE_TODAY
  };

  function range() {
    var f = S.reconFiles;
    if (f.dateMode === 'all') return { from: MIN_DATE, to: MAX_DATE, label: 'Last ' + P.WINDOW + ' cycles' };
    if (f.dateMode === 'date') return { from: f.date, to: f.date, label: U.prettyDate(f.date) };
    return { from: CYCLE_TODAY, to: CYCLE_TODAY, label: 'Current cycle · ' + U.prettyDate(CYCLE_TODAY) };
  }
  function clampDate(d) { return d < MIN_DATE ? MIN_DATE : (d > MAX_DATE ? MAX_DATE : d); }

  /* ---- what the row says about where the file got to ---------------------- */
  var STEP_WORD = { success: 'Success', failed: 'Failed', running: 'Running', pending: 'Pending', skipped: 'Not run' };
  function reachedCell(f) {
    if (f.status === 'Failed') {
      var s = P.failedStep(f);
      if (!s) return '<span class="meta">—</span>';
      // The code is the row's whole diagnosis; the hint that explains it lives
      // in the panel, once, rather than being paraphrased in a table cell.
      return '<div class="cell-main rf-failed-step">' + esc(s.name) + '</div>' +
        (s.error_code
          ? '<div class="cell-sub mono rf-code">' + esc(s.error_code) + '</div>'
          : '<div class="cell-sub">no error code recorded</div>');
    }
    if (f.status === 'Running') {
      var r = null;
      (function walk(list) {
        (list || []).forEach(function (x) { if (x.status === 'running' && !r) r = x; if (x.children) walk(x.children); });
      })(f.steps);
      return '<div class="cell-main">' + esc(r ? r.name : 'Processing') + '</div>' +
        '<div class="cell-sub">in progress</div>';
    }
    var last = f.steps[f.steps.length - 1];
    return '<div class="cell-main">' + esc(last ? last.name : '—') + '</div>' +
      '<div class="cell-sub">completed</div>';
  }

  var STATUS_PILL = {
    Success: ['Success', 'success', 'check-circle'],
    Failed: ['Failed', 'danger', 'x-circle'],
    Running: ['Processing', 'info', 'loader'],
    Pending: ['Pending', 'neutral', 'clock']
  };
  function statusPill(f) {
    var m = STATUS_PILL[f.status] || STATUS_PILL.Pending;
    return pill(m[0], m[1], m[2]);
  }

  /* ---- overview ----------------------------------------------------------- */
  function overview(files, rg) {
    var s = P.summarise(files);
    function cell(label, value, kind, sub) {
      return '<div class="amount-cell' + (kind ? ' ' + kind : '') + '">' +
        '<span class="ac-label">' + label + '</span><span class="ac-value num">' + value + '</span>' +
        (sub ? '<span class="meta">' + sub + '</span>' : '') + '</div>';
    }
    return '<div class="amounts-panel rf-counts">' +
      cell('Files processed', String(s.total), '', esc(rg.label)) +
      cell('Failed', String(s.failed), s.failed ? 'danger' : '', s.failed ? 'a step did not complete' : 'nothing failed') +
      cell('Still processing', String(s.running), s.running ? 'warn' : '', s.running ? 'a step is running' : 'nothing in flight') +
      cell('Completed', String(s.success), s.success ? 'good' : '', 'all steps succeeded') +
      '</div>';
  }

  /* ---- filters ------------------------------------------------------------ */
  function filters() {
    var f = S.reconFiles;
    var tenantOpts = [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; }));
    var netOpts = [['all', 'All networks']].concat(O.NETWORKS.map(function (n) { return [n.key, n.name]; }));
    var dirOpts = [['all', 'All directions'], ['incoming', P.DIR_LABEL.incoming], ['clearing', P.DIR_LABEL.clearing]];
    var stOpts = [['all', 'All states'], ['Failed', 'Failed'], ['Running', 'Processing'], ['Success', 'Success']];
    var onDate = f.dateMode === 'date';
    return kit.opsFilterRow({
      search: { placeholder: 'Search file name or UUID', action: 'rf-q', value: f.q || '' },
      filters: [
        { action: 'rf-tenant', value: f.tenant, label: 'Tenant', options: tenantOpts },
        { action: 'rf-network', value: f.network, label: 'Network', options: netOpts },
        { action: 'rf-direction', value: f.direction, label: 'Direction', options: dirOpts },
        { action: 'rf-status', value: f.status, label: 'State', options: stOpts }
      ],
      preset: {
        action: 'rf-preset', value: f.dateMode,
        options: [['current', 'Current cycle'], ['all', 'Last ' + P.WINDOW + ' cycles'], ['date', 'Specific cycle date']]
      },
      dateRange: (onDate
        ? '<input type="date" data-action="rf-date" value="' + f.date + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="Cycle date" />'
        : '<span>' + esc(range().label) + '</span>') + icon('chevron-down', 16),
      refresh: 'rf-refresh'
    }) + '<div class="mb-16"></div>';
  }

  /* ---- the table ---------------------------------------------------------- */
  function visible() {
    var f = S.reconFiles, rg = range();
    return P.list({
      tenant: f.tenant, network: f.network, direction: f.direction,
      status: f.status, q: f.q, from: rg.from, to: rg.to
    });
  }

  function table(files) {
    if (!files.length) {
      return '<div class="card">' + emptyState('file-search', 'No files in this view',
        'Widen the cycle range or clear the tenant, network, direction and state filters.',
        '<button class="btn btn-secondary" data-action="rf-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var body = files.map(function (f) {
      var cls = f.status === 'Failed' ? 'rf-row-failed' : (f.status === 'Running' ? 'rf-row-running' : '');
      return '<tr class="' + cls + '" data-action="rf-open" data-id="' + esc(f.id) + '" tabindex="0" ' +
        'title="' + esc('Open the processing detail for ' + f.name) + '">' +
        '<td class="sf-tenant-col">' + tenantTag(f.tenantId) + '</td>' +
        '<td class="nowrap"><div class="cell-main">' + U.prettyDate(f.date) + '</div>' +
        '<div class="cell-sub">' + esc(U.DOW[U.fromYmd(f.date).getUTCDay()]) + '</div></td>' +
        '<td><div class="cell-main mono rf-name">' + esc(f.name) + '</div>' +
        '<div class="cell-sub mono rf-uuid">' + esc(f.uuid) + '</div></td>' +
        '<td><div class="cell-main">' + esc(f.directionLabel) + '</div>' +
        '<div class="cell-sub">' + esc(f.networkName || '—') + '</div></td>' +
        '<td>' + statusPill(f) + '</td>' +
        '<td>' + reachedCell(f) + '</td>' +
        '<td class="nowrap cell-sub num">' + (P.clockOf(f.steps[0] && f.steps[0].started_at) || '—') + '</td>' +
        '<td class="rf-go">' + icon('chevron-right', 16) + '</td></tr>';
    }).join('');
    return '<div class="table-card"><div class="table-wrap"><table class="data rf-table"><thead><tr>' +
      '<th class="sf-tenant-col">Tenant</th><th>Cycle date</th><th>File</th><th>Direction</th>' +
      '<th>State</th><th>Step reached</th><th>Started</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function render() {
    var rg = range();
    var files = visible();
    setView(
      kit.pageHead('Recon File Management',
        'Every file the reconciliation pipeline processed. Open one to see which step it reached, and — when a step failed — what to do about it.') +
      overview(files, rg) +
      filters() +
      '<div class="sf-scope meta">Showing <strong>' + files.length + '</strong> file' + (files.length === 1 ? '' : 's') +
      ' · ' + esc(rg.label) + '</div>' +
      table(files)
    );
  }

  /* A retry inside the panel can change a file's state, so the list behind it
     repaints — but only while this screen is still the one on screen. */
  function repaint() { if (location.hash.indexOf('/reconciliation/files') >= 0) render(); }

  var ACTIONS = {
    'rf-tenant': function (t) { S.reconFiles.tenant = t.value; render(); },
    'rf-network': function (t) { S.reconFiles.network = t.value; render(); },
    'rf-direction': function (t) { S.reconFiles.direction = t.value; render(); },
    'rf-status': function (t) { S.reconFiles.status = t.value; render(); },
    'rf-preset': function (t) { S.reconFiles.dateMode = t.value; render(); },
    'rf-date': function (t) { S.reconFiles.date = clampDate(t.value || CYCLE_TODAY); S.reconFiles.dateMode = 'date'; render(); },
    'rf-refresh': function () { render(); toast('Refreshed', 'success'); },
    'rf-clear': function () {
      S.reconFiles.q = ''; S.reconFiles.tenant = 'all'; S.reconFiles.network = 'all';
      S.reconFiles.direction = 'all'; S.reconFiles.status = 'all'; S.reconFiles.dateMode = 'all';
      render();
    },
    'rf-q': function (t) {
      S.reconFiles.q = t.value; render();
      var i = el('view').querySelector('[data-action="rf-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'rf-open': function (t) {
      var f = P.byId(t.getAttribute('data-id'));
      if (!f) return;
      panel.setOnChange(repaint);
      panel.open(f);
    }
  };

  function route() {
    // A deep link can name the file to open — that is how a config screen
    // sends someone back to the file they came from.
    if (S.query && S.query.openFile) {
      var f = P.byUuid(S.query.openFile);
      if (f) {
        // Make sure the row is actually in view behind the panel.
        S.reconFiles.dateMode = 'all';
        S.reconFiles.tenant = 'all'; S.reconFiles.network = 'all';
        S.reconFiles.direction = 'all'; S.reconFiles.status = 'all'; S.reconFiles.q = '';
        render();
        panel.setOnChange(repaint);
        panel.open(f);
        return;
      }
    }
    render();
  }

  return { route: route, render: render, actions: ACTIONS };
};
