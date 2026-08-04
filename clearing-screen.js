/* =============================================================================
   Juspay Ops Portal — Clearing Files: list + detail (Parts 2.2–2.4)

   The dashboard is the origin point for every clearing file staged to a
   network. It cannot stage anything itself — a person does that inside VEP —
   so everything here is about the file and the record:

     · one correct file per tenant × network × cycle, unambiguously named
     · anyone who looks can see whether that cycle has already been staged
     · the acknowledgement closes the loop with evidence, not assertion

   NO KPI CARDS (Part 2.2). A row of counts above a list of the same rows is
   redundant; the list is the information.

   window.ClearingUI(kit) → { route, actions }
   ============================================================================= */
window.ClearingUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, K = window.CLEARING;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, setView = kit.setView, el = kit.el,
    go = kit.go, toast = kit.toast, num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag,
    emptyState = kit.emptyState, cardBox = kit.cardBox, cycleIdCell = kit.cycleIdCell,
    immutableTimeline = kit.immutableTimeline;

  var ROUTE = '#/dashboard/ops/clearing';
  var MIN_DATE = K.DATES[0], MAX_DATE = K.DATES[K.DATES.length - 1];

  /* In memory only. Default state filter is "anything not acknowledged" — the
     operator's working set is what still needs attention; completed cycles are
     history, one filter change away (Part 2.2). */
  S.clearing = {
    q: '', tenant: 'all', network: 'all', state: 'open',
    dateMode: '7', date: K.CYCLE_TODAY, from: U.addDays(K.CYCLE_TODAY, -6), to: K.CYCLE_TODAY,
    params: false,          // run-parameters disclosure
    regen: null,            // { reason } while the regenerate form is open
    ackUpload: false
  };

  function range() {
    var f = S.clearing;
    if (f.dateMode === 'date') return { from: f.date, to: f.date, label: U.prettyDate(f.date) };
    if (f.dateMode === 'range') return { from: f.from, to: f.to, label: U.prettyDate(f.from) + ' – ' + U.prettyDate(f.to) };
    if (f.dateMode === 'all') return { from: MIN_DATE, to: MAX_DATE, label: 'Last ' + K.WINDOW + ' cycles' };
    var days = parseInt(f.dateMode, 10) || 7;
    return { from: U.addDays(K.CYCLE_TODAY, -(days - 1)), to: K.CYCLE_TODAY, label: 'Last ' + days + ' cycles' };
  }
  function clampDate(d) { return d < MIN_DATE ? MIN_DATE : (d > MAX_DATE ? MAX_DATE : d); }

  function statePill(rec) {
    var s = K.STATES[rec.state];
    return pill(s.label, s.kind, s.icon);
  }
  /* The network badge reuses the Rejects vocabulary rather than tinting with
     the raw network colour — Mastercard yellow on white is 1.9:1 and unreadable
     as text. Same component, same three classes, one appearance. */
  var NET_CLASS = { visa: 'visa', mc: 'mc', rupay: 'rupay' };
  function netBadge(rec) {
    var net = O.NET_BY_KEY[rec.networkKey];
    return '<span class="rej-net ' + (NET_CLASS[rec.networkKey] || 'mc') + '">' + esc(net.name) + '</span>';
  }
  function initials(email) {
    var n = String(email || '').split('@')[0].split(/[._-]/).filter(Boolean);
    return (n.map(function (p) { return p[0]; }).join('').slice(0, 3) || '—').toUpperCase();
  }
  function dash() { return '<span class="clr-empty">—</span>'; }
  /* The list carries three timestamps per row. In full ("20 Nov 2025, 21:46
     IST") they push the table into a horizontal scroll and the operator loses
     the Acknowledged column — which is the one that says whether the cycle is
     closed. The year and the zone are constant across every row, so they are
     dropped here and kept in full on the detail view. */
  function shortStamp(at) {
    if (!at) return dash();
    var p = String(at).split(', ');
    return esc(p[0].replace(/ \d{4}$/, '') + ' ' + (p[1] || '').replace(' IST', ''));
  }

  /* =======================================================================
     LIST VIEW (Part 2.2)
     ======================================================================= */
  function filters() {
    var f = S.clearing;
    var tenantOpts = [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; }));
    var netKeys = {};
    O.tenants.forEach(function (t) { K.clearingNetsFor(t.id).forEach(function (n) { netKeys[n.key] = n.name; }); });
    var netOpts = [['all', 'All networks']].concat(Object.keys(netKeys).map(function (k) { return [k, netKeys[k]]; }));
    var stateOpts = [['open', 'Anything not acknowledged'], ['all', 'Any state']]
      .concat(K.STATE_KEYS.map(function (k) { return [k, K.STATES[k].label]; }));
    var onDate = f.dateMode === 'date', onRange = f.dateMode === 'range';
    return kit.opsFilterRow({
      search: { placeholder: 'Search cycle or file name', action: 'clr-i-q', value: f.q || '' },
      filters: [
        { action: 'clr-tenant', value: f.tenant, label: 'Tenant', options: tenantOpts },
        { action: 'clr-network', value: f.network, label: 'Network', options: netOpts },
        { action: 'clr-state', value: f.state, label: 'State', options: stateOpts }
      ],
      preset: {
        action: 'clr-preset', value: f.dateMode,
        options: [['1', 'Current cycle'], ['7', 'Last 7 cycles'], ['30', 'Last 30 cycles'], ['date', 'Specific cycle date'], ['range', 'Custom range']]
      },
      dateRange: (onDate
        ? '<input type="date" data-action="clr-date" value="' + f.date + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="Cycle date" />'
        : (onRange
          ? '<input type="date" data-action="clr-from" value="' + f.from + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="From" />' +
          '<span class="meta">–</span>' +
          '<input type="date" data-action="clr-to" value="' + f.to + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="To" />'
          : '<span>' + esc(U.prettyDate(range().from) + ' – ' + U.prettyDate(range().to)) + '</span>')) + icon('chevron-down', 16),
      refresh: 'clr-refresh'
    });
  }

  function visible() {
    var f = S.clearing, rg = range(), q = (f.q || '').toLowerCase();
    return K.rowsForRange(rg.from, rg.to).filter(function (rec) {
      if (f.tenant !== 'all' && rec.tenantId !== f.tenant) return false;
      if (f.network !== 'all' && rec.networkKey !== f.network) return false;
      if (f.state === 'open') { if (rec.state === 'acked') return false; }
      else if (f.state !== 'all' && rec.state !== f.state) return false;
      if (q) {
        var hay = (rec.id + ' ' + (rec.file ? rec.file.name : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // Anything needing attention first, then by tenant and network.
      var aa = K.isAttention(a) ? 0 : 1, bb = K.isAttention(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
      return a.networkKey < b.networkKey ? -1 : 1;
    });
  }

  function table(rows) {
    if (!rows.length) {
      return '<div class="card">' + emptyState('file-up', 'No clearing cycles in this view',
        'Widen the cycle range, or clear the tenant, network and state filters.',
        '<button class="btn btn-secondary" data-action="clr-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var body = rows.map(function (rec) {
      var cls = rec.state === 'ack_rejected' ? 'clr-row-rejected' : (rec.state === 'ack_overdue' ? 'clr-row-overdue' : '');
      return '<tr class="clickable ' + cls + '" data-route="' + ROUTE + '/' + esc(rec.id) + '">' +
        '<td>' + cycleIdCell(rec.id, rec.date) + '</td>' +
        '<td>' + tenantTag(rec.tenantId) + '</td>' +
        '<td>' + netBadge(rec) + '</td>' +
        '<td class="clr-file-col">' + (rec.file
          ? '<span class="mono clr-filename" title="' + esc(rec.file.name) + '">' + esc(rec.file.name) + '</span>' +
          (rec.regenerated ? '<div class="cell-sub">' + regenTag() + '</div>' : '')
          : dash()) + '</td>' +
        '<td>' + statePill(rec) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.file ? rec.file.generatedAt : '') + '">' +
        (rec.file ? shortStamp(rec.file.generatedAt) : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.stagedAt ? rec.stagedAt + ' · ' + rec.stagedBy : '') + '">' +
        (rec.stagedAt
          ? shortStamp(rec.stagedAt) + ' <span class="clr-by">' + esc(initials(rec.stagedBy)) + '</span>'
          : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.ack ? rec.ack.receivedAt : '') + '">' +
        (rec.ack ? shortStamp(rec.ack.receivedAt) : dash()) + '</td>' +
        // The whole row is the link, so this cell is an affordance, not a
        // second control — a word here costs the Acknowledged column its space.
        '<td class="clr-go">' + icon('arrow-right', 15) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="table-card"><div class="table-wrap"><table class="data clr-table"><thead><tr>' +
      '<th>Cycle</th><th>Tenant</th><th>Network</th><th>File</th><th>State</th>' +
      '<th>Generated</th><th>Staged</th><th>Acknowledged</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function regenTag() {
    return '<span class="clr-regen-tag" title="This cycle was regenerated. The tag is permanent.">' +
      icon('rotate-ccw', 11) + 'Regenerated</span>';
  }

  function renderList() {
    var rows = visible();
    var rg = range();
    setView(
      kit.pageHead('Clearing Files',
        'Files staged to card networks. Generate here, stage in the network’s software, then record it back.') +
      filters() +
      '<div class="sf-scope meta">Showing <strong>' + rows.length + '</strong> cycle' + (rows.length === 1 ? '' : 's') +
      ' · ' + esc(rg.label) +
      (S.clearing.state === 'open' ? ' · acknowledged cycles hidden' : '') + '</div>' +
      table(rows)
    );
  }

  /* =======================================================================
     DETAIL VIEW (Part 2.3)
     ======================================================================= */

  /* The five steps, horizontal. `Downloaded` is informational only — it records
     that someone fetched the file, which is useful context but not a gate. */
  function progressStrip(rec) {
    var steps = [
      { label: 'Generated', at: rec.file ? rec.file.generatedAt : null, done: !!rec.file },
      { label: 'Downloaded', at: rec.downloadedAt, done: !!rec.downloadedAt, soft: true },
      { label: 'Staged', at: rec.stagedAt, done: !!rec.stagedAt },
      {
        label: 'Awaiting ack',
        at: rec.ack ? null : (rec.stagedAt ? 'since ' + rec.stagedAt.split(', ')[1] : null),
        done: !!rec.ack, active: !!rec.stagedAt && !rec.ack,
        bad: rec.state === 'ack_overdue'
      },
      {
        label: rec.state === 'ack_rejected' ? 'Ack rejected' : 'Acknowledged',
        at: rec.ack ? rec.ack.receivedAt : null,
        done: !!rec.ack && rec.ack.accepted, bad: rec.state === 'ack_rejected'
      }
    ];
    return '<div class="clr-strip">' + steps.map(function (s, i) {
      var cls = s.bad ? 'bad' : (s.done ? 'done' : (s.active ? 'active' : 'todo'));
      var ic = s.bad ? 'x-circle' : (s.done ? 'check-circle' : (s.active ? 'clock' : 'circle'));
      return (i ? '<span class="clr-strip-line ' + (s.done || s.active || s.bad ? 'lit' : '') + '"></span>' : '') +
        '<div class="clr-step ' + cls + (s.soft ? ' soft' : '') + '">' +
        '<span class="clr-step-icon">' + icon(ic, 18) + '</span>' +
        '<span class="clr-step-label">' + esc(s.label) + '</span>' +
        '<span class="clr-step-at">' + (s.at ? esc(s.at.replace(/, /, ' ')) : '') + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function fileBlock(rec) {
    var f = rec.file;
    if (!f) {
      return '<div class="card clr-file-block empty">' +
        emptyState('file-plus', 'No file for this cycle yet',
          'Generating writes ' + esc(K.fileName(rec.tenantId, rec.networkKey, rec.date, 1)) +
          ' to S3. That file is the only one that should ever be staged for this cycle.',
          '<button class="btn btn-primary" data-action="clr-generate" data-id="' + esc(rec.id) + '">' +
          icon('play', 16) + 'Generate file</button>') + '</div>';
    }
    var canStage = rec.state === 'ready';
    return '<div class="card clr-file-block">' +
      '<div class="clr-file-name mono">' + esc(f.name) +
      (rec.regenerated ? ' ' + regenTag() : '') + '</div>' +
      '<div class="clr-file-grid">' +
      kv('Transactions', '<span class="num">' + num(rec.count) + '</span>') +
      kv('Generated', '<span class="num">' + esc(f.generatedAt) + '</span>') +
      kv('Value', '<span class="num">' + fmt(rec.value, 2, rec.currency) + '</span>') +
      kv('Size', '<span class="num">' + esc(f.size) + '</span>') +
      // Checksum and the S3 path get the full width: both are strings the
      // operator compares character by character, and a mid-string wrap in a
      // half-width cell reads as a typo in the value itself.
      kv('Checksum', '<span class="mono">' + esc(f.checksum) + '</span>', 'wide') +
      kv('S3 path', '<span class="mono clr-s3">' + esc(f.path + f.name) + '</span>', 'wide') +
      '</div>' +
      '<div class="clr-file-actions">' +
      '<button class="btn btn-secondary" data-action="clr-download" data-id="' + esc(rec.id) + '">' + icon('download', 16) + 'Download</button>' +
      '<button class="btn btn-secondary" data-action="clr-copy-path" data-id="' + esc(rec.id) + '">' + icon('copy', 16) + 'Copy S3 path</button>' +
      (canStage
        ? '<button class="btn btn-primary clr-stage-btn" data-action="clr-stage" data-id="' + esc(rec.id) + '">' +
        icon('check-square', 16) + 'Mark as staged' + icon('arrow-right', 15) + '</button>'
        : '') +
      '</div></div>';
  }
  function kv(label, value, cls) {
    return '<div class="clr-kv' + (cls ? ' ' + cls : '') + '"><span class="clr-kv-label">' + esc(label) +
      '</span><span class="clr-kv-value">' + value + '</span></div>';
  }

  /* Collapsed, copyable, plain key=value lines. This exists so nobody hand
     edits an automation script — the hand-editing step is where the original
     incident's wrong direction crept in. */
  function paramsBlock(rec) {
    var open = S.clearing.params;
    return '<div class="clr-params">' +
      '<button class="clr-params-head" data-action="clr-params" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      icon(open ? 'chevron-down' : 'chevron-right', 16) + '<span>Run parameters</span>' +
      '<span class="meta">copy, paste, run — never hand-edit the script</span></button>' +
      (open
        ? '<div class="clr-params-body"><pre class="clr-params-pre mono">' + esc(K.runParams(rec)) + '</pre>' +
        '<div class="clr-params-foot">' +
        '<button class="btn btn-secondary btn-sm" data-action="clr-copy-params" data-id="' + esc(rec.id) + '">' +
        icon('copy', 15) + 'Copy</button></div></div>'
        : '') + '</div>';
  }

  /* The already-staged warning REPLACES the generate action (Part 2.3). It is
     the whole point of the section: anyone who looks can see the work is done
     before they repeat it. */
  function stagedWarning(rec) {
    if (['staged', 'acked', 'ack_rejected', 'ack_overdue'].indexOf(rec.state) < 0) return '';
    var open = !!S.clearing.regen;
    var reason = (S.clearing.regen && S.clearing.regen.reason) || '';
    var ok = reason.trim().length >= 40;
    return '<div class="callout danger clr-already">' + icon('alert-triangle', 20) +
      '<div class="callout-body">' +
      '<strong>Already staged</strong>' +
      '<div class="clr-already-line">This cycle was staged on ' + esc(rec.stagedAt || '—') + ' by ' + esc(rec.stagedBy || '—') + '.<br>' +
      'Generating and staging again would send a duplicate file to ' + esc(rec.networkName) + '.</div>' +
      (open
        ? '<div class="clr-regen-form">' +
        '<label class="field">Why does this cycle need a new file? <span class="req">*</span>' +
        '<textarea class="input" data-action="clr-i-regen" placeholder="e.g. First cut carried the wrong cycle date after a hand-edited run script; re-cutting for the correct cycle and informing the network desk.">' + esc(reason) + '</textarea></label>' +
        '<div class="clr-regen-foot">' +
        '<span class="clr-count' + (ok ? ' ok' : '') + '"><span class="num">' + reason.trim().length + '</span> / 40 characters</span>' +
        '<span class="clr-regen-btns">' +
        '<button class="btn btn-secondary btn-sm" data-action="clr-regen-cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm"' + (ok ? '' : ' disabled') + ' data-action="clr-regen-confirm" data-id="' + esc(rec.id) + '">' +
        icon('rotate-ccw', 15) + 'Regenerate as v' + (rec.version + 1) + '</button></span></div>' +
        '<div class="meta clr-regen-note">The new file is tagged <strong>Regenerated</strong> permanently, and this reason stays in the cycle’s history.</div>' +
        '</div>'
        : '<div class="clr-already-act"><button class="btn btn-secondary btn-sm" data-action="clr-regen-open">' +
        icon('rotate-ccw', 15) + 'Regenerate anyway</button></div>') +
      '</div></div>';
  }

  function ackBlock(rec) {
    if (rec.state === 'ack_overdue') {
      var up = S.clearing.ackUpload;
      return '<div class="card clr-ack overdue">' +
        '<div class="clr-ack-head">' + icon('alert-triangle', 20) +
        '<span>No acknowledgement from ' + esc(rec.networkName) + '</span></div>' +
        '<div class="clr-ack-line">Staged ' + esc(rec.stagedAt) + '. An ack was expected within ' +
        K.ACK_WINDOW_HOURS + ' hours and none has been picked up. The file may well have been accepted — ' +
        'the dashboard cannot see ' + esc(K.vepName(rec.networkKey)) + ', so this says only that no ack file arrived.</div>' +
        (up
          ? '<div class="clr-ack-upload">' +
          '<label class="field">Acknowledgement file' +
          '<input type="file" class="input" data-action="clr-ack-file" data-id="' + esc(rec.id) + '" /></label>' +
          '<div class="row" style="gap:10px;justify-content:flex-end">' +
          '<button class="btn btn-secondary btn-sm" data-action="clr-ack-cancel">Cancel</button>' +
          '<button class="btn btn-primary btn-sm" data-action="clr-ack-sim" data-id="' + esc(rec.id) + '">' +
          icon('upload', 15) + 'Parse this ack</button></div>' +
          '<div class="meta">Parsed exactly the same way as an automatically collected ack.</div></div>'
          : '<div class="clr-ack-act"><button class="btn btn-primary btn-sm" data-action="clr-ack-open">' +
          icon('upload', 15) + 'Upload ack file</button></div>') +
        '</div>';
    }
    if (!rec.ack) return '';
    var a = rec.ack;
    if (!a.accepted) {
      return '<div class="card clr-ack rejected">' +
        '<div class="clr-ack-head">' + icon('x-circle', 20) + '<span>Rejected by ' + esc(rec.networkName) + '</span></div>' +
        '<div class="clr-file-grid">' +
        kv('Ack file', '<span class="mono">' + esc(a.file) + '</span>') +
        kv('Received', '<span class="num">' + esc(a.receivedAt) + '</span>') +
        '</div>' +
        '<div class="clr-ack-reason">' + esc(a.reason) + '</div>' +
        '<div class="clr-ack-act">' +
        '<a class="btn btn-secondary btn-sm" data-route="#/dashboard/ops/rejects?rejTenant=' + esc(rec.tenantId) +
        '&rejDate=' + esc(rec.date) + '&rejFamily=staging">' + icon('file-warning', 15) + 'View rejects' + icon('arrow-right', 14) + '</a>' +
        '</div></div>';
    }
    return '<div class="card clr-ack accepted">' +
      '<div class="clr-ack-head">' + icon('check-circle', 20) + '<span>Accepted by ' + esc(rec.networkName) +
      (a.manual ? ' <span class="clr-manual-tag">' + icon('hand', 11) + 'ack uploaded manually</span>' : '') + '</span></div>' +
      '<div class="clr-file-grid">' +
      kv('Ack file', '<span class="mono">' + esc(a.file) + '</span>') +
      kv('Received', '<span class="num">' + esc(a.receivedAt) + '</span>') +
      kv('Accepted', '<span class="num">' + num(a.acceptedCount) + ' transactions</span>') +
      kv('Rejected', a.rejectedCount
        ? '<span class="num">' + num(a.rejectedCount) + ' transactions</span>' +
        ' <a class="clr-inline-link" data-route="#/dashboard/ops/rejects?rejTenant=' + esc(rec.tenantId) +
        '&rejDate=' + esc(rec.date) + '&rejFamily=incoming">View rejects' + icon('arrow-right', 12) + '</a>'
        : '<span class="num">0</span>') +
      '</div></div>';
  }

  function historyBlock(rec) {
    if (!rec.events.length) {
      return cardBox('History', '<div class="meta">Nothing has happened to this cycle yet. Every generate, download, stage, regenerate and ack event is appended here.</div>');
    }
    return cardBox('History',
      '<div class="meta mb-16">Append-only — what, when, by whom, and the reason where one was required.</div>' +
      immutableTimeline(rec.events.slice().reverse()));
  }

  function primaryAction(rec) {
    if (rec.state === 'not_generated') {
      return '<button class="btn btn-primary" data-action="clr-generate" data-id="' + esc(rec.id) + '">' +
        icon('play', 16) + 'Generate file</button>';
    }
    if (rec.state === 'ready') {
      return '<button class="btn btn-primary" data-action="clr-stage" data-id="' + esc(rec.id) + '">' +
        icon('check-square', 16) + 'Mark as staged</button>';
    }
    return '';   // acknowledged, staged, rejected, overdue — no primary action
  }

  function renderDetail(id) {
    var rec = K.resolve(id);
    if (!rec) {
      setView('<div class="breadcrumb"><a data-route="' + ROUTE + '">Clearing Files</a><span class="sep">/</span><span>' + esc(id) + '</span></div>' +
        '<div class="card">' + emptyState('search-x', 'No such clearing cycle',
          'The cycle ' + esc(id) + ' does not exist for any tenant and network in the last ' + K.WINDOW + ' cycles.',
          '<button class="btn btn-secondary" data-route="' + ROUTE + '">Back to Clearing Files</button>') + '</div>');
      return;
    }
    var net = O.NET_BY_KEY[rec.networkKey];
    setView(
      '<div class="breadcrumb"><a data-route="' + ROUTE + '">Clearing Files</a><span class="sep">/</span><span class="mono">' + esc(rec.id) + '</span></div>' +
      '<div class="page-head clr-head"><div>' +
      cycleIdCell(rec.id, rec.date, 'lg') +
      '<div class="subtitle clr-sub">' + tenantTag(rec.tenantId) + ' · ' + netBadge(rec) + ' · ' + esc(rec.dow) + '</div>' +
      '</div><div class="head-actions">' + statePill(rec) + primaryAction(rec) + '</div></div>' +

      progressStrip(rec) +
      stagedWarning(rec) +
      fileBlock(rec) +
      (rec.file ? paramsBlock(rec) : '') +
      ackBlock(rec) +
      '<div class="mt-24">' + historyBlock(rec) + '</div>' +

      '<div class="callout info mt-24">' + icon('info', 20) +
      '<div class="callout-body">Staging happens in <strong>' + esc(K.vepName(rec.networkKey)) + '</strong>, outside this dashboard. ' +
      'Nothing here can trigger, observe or block it — <em>Mark as staged</em> is the operator’s record that it was done.</div></div>'
    );
  }

  function repaint() {
    if (location.hash.indexOf('/ops/clearing/') >= 0) {
      var id = location.hash.split('/ops/clearing/')[1].split('?')[0];
      renderDetail(decodeURIComponent(id));
    } else if (location.hash.indexOf('/ops/clearing') >= 0) {
      renderList();
    }
  }

  /* =======================================================================
     ACTIONS
     ======================================================================= */
  function copy(text, what) {
    // Clipboard access is not guaranteed in every context; the toast reports
    // what actually happened rather than asserting success.
    var okd = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); okd = true; }
      else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        okd = document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { okd = false; }
    toast(okd ? what + ' copied' : 'Could not copy — select the text and copy it manually', okd ? 'success' : 'info');
  }

  var ACTIONS = {
    /* ---- list filters ---- */
    'clr-tenant': function (t) { S.clearing.tenant = t.value; renderList(); },
    'clr-network': function (t) { S.clearing.network = t.value; renderList(); },
    'clr-state': function (t) { S.clearing.state = t.value; renderList(); },
    'clr-preset': function (t) { S.clearing.dateMode = t.value; renderList(); },
    'clr-date': function (t) { S.clearing.date = clampDate(t.value || K.CYCLE_TODAY); S.clearing.dateMode = 'date'; renderList(); },
    'clr-from': function (t) { S.clearing.from = clampDate(t.value || MIN_DATE); S.clearing.dateMode = 'range'; renderList(); },
    'clr-to': function (t) { S.clearing.to = clampDate(t.value || MAX_DATE); S.clearing.dateMode = 'range'; renderList(); },
    'clr-refresh': function () { renderList(); toast('Refreshed', 'success'); },
    'clr-clear': function () {
      var f = S.clearing;
      f.q = ''; f.tenant = 'all'; f.network = 'all'; f.state = 'all'; f.dateMode = '30';
      renderList();
    },
    'clr-i-q': function (t) {
      S.clearing.q = t.value; renderList();
      var i = el('view').querySelector('[data-action="clr-i-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },

    /* ---- the four transitions the dashboard owns ---- */
    'clr-generate': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec) return;
      K.generate(rec);
      toast('Generated ' + rec.file.name, 'success');
      repaint();
    },
    'clr-download': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec || !rec.file) return;
      K.markDownloaded(rec);
      toast('Downloading ' + rec.file.name, 'success');
      repaint();
    },
    'clr-copy-path': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec || !rec.file) return;
      copy(rec.file.path + rec.file.name, 'S3 path');
    },
    'clr-copy-params': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec) return;
      copy(K.runParams(rec), 'Run parameters');
    },
    'clr-params': function () { S.clearing.params = !S.clearing.params; repaint(); },
    'clr-stage': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec) return;
      K.markStaged(rec);
      toast('Recorded as staged — awaiting acknowledgement', 'success');
      go(ROUTE + '/' + rec.id);
      repaint();
    },

    /* ---- regenerate: 40 characters of reason, a v2 file, a permanent tag ---- */
    'clr-regen-open': function () { S.clearing.regen = { reason: '' }; repaint(); },
    'clr-regen-cancel': function () { S.clearing.regen = null; repaint(); },
    'clr-i-regen': function (t) {
      S.clearing.regen = S.clearing.regen || { reason: '' };
      S.clearing.regen.reason = t.value;
      repaint();
      var i = el('view').querySelector('[data-action="clr-i-regen"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'clr-regen-confirm': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec) return;
      var reason = (S.clearing.regen && S.clearing.regen.reason || '').trim();
      if (reason.length < 40) { toast('A reason of at least 40 characters is required', 'info'); return; }
      K.generate(rec, reason);
      S.clearing.regen = null;
      toast('Regenerated as ' + rec.file.name + ' — the cycle is tagged Regenerated', 'success');
      repaint();
    },

    /* ---- manual ack upload, when automated pickup failed ---- */
    'clr-ack-open': function () { S.clearing.ackUpload = true; repaint(); },
    'clr-ack-cancel': function () { S.clearing.ackUpload = false; repaint(); },
    'clr-ack-file': function (t) {
      var f = t.files && t.files[0];
      if (f) { S.clearing.ackName = f.name; }
    },
    'clr-ack-sim': function (t) {
      var rec = K.resolve(t.getAttribute('data-id')); if (!rec) return;
      var name = S.clearing.ackName || (O.netSlug(rec.networkKey) + '_ACK_' + rec.date.replace(/-/g, '') + '_0312.txt');
      K.applyAck(rec, name);
      S.clearing.ackUpload = false; S.clearing.ackName = null;
      toast('Parsed ' + name + ' — cycle acknowledged', 'success');
      repaint();
    }
  };

  function route(rest) {
    S.clearing.regen = null;
    S.clearing.ackUpload = false;
    if (rest && rest[0]) return renderDetail(decodeURIComponent(rest[0]));
    renderList();
  }

  return { route: route, renderList: renderList, renderDetail: renderDetail, actions: ACTIONS };
};
