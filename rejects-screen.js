/* =============================================================================
   Juspay Ops Portal — Rejects

   Three views, related by drill-down:

     A · Rejects Overview        #/dashboard/ops/rejects
     B · Reject Batch Detail     #/dashboard/ops/rejects/:batchId
     C · Correction Editor       side panel over B (never its own page — the
                                 point is to keep batch context while working
                                 twenty rejects in a row)

   The reject lifecycle is the thread between them: editing moves a transaction
   to Under correction, saving moves it to Corrected, which is what unlocks
   "Generate corrected clearing file" on the batch; generating moves the
   included set to Regenerated, and delivering the file moves them to
   Resubmitted. Re-rejected rows keep their attempt count and sort to the top
   everywhere, because attempt 3 is a different problem from attempt 1.

   There is no "Resolve IRD" action. The recommendation engine derives the same
   answer whether it is asked once or twice, so a second button would only
   restate the panel. What the panel gives instead is ranked alternatives, each
   saying what would have to be different about the transaction for that IRD to
   be the right one.

   window.RejectsUI(kit) → { route, actions }
   ============================================================================= */
window.RejectsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, R = window.REJDATA;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, num = kit.num, fmt = kit.fmt,
    pct = kit.pct, tenantTag = kit.tenantTag,
    pageHead = kit.pageHead, kpiCard = kit.kpiCard, tableCard = kit.tableCard,
    opsFilterRow = kit.opsFilterRow, sidePanel = kit.sidePanel;

  var ROUTE = '#/dashboard/ops/rejects';
  var WHO = R.CURRENT_USER;

  S.rej = {
    // --- overview filters ---
    tenants: {},                  // tid → true; empty object means "all"
    bq: '',                       // overview search (batch id / tenant / file name)
    network: 'all', family: 'all', reason: 'all',
    dateMode: 'all', dateOn: '', dateFrom: '', dateTo: '',
    sort: { key: 'default', dir: 'desc' },
    // --- batch detail ---
    batchId: null, q: '', sel: {}, txnSort: { key: 'status', dir: 'asc' },
    // Staging rejects carry a second, read-only view of the whole file, because
    // the replacement file will contain all of it (§C.5). Incoming rejects have
    // no such tab — the rest of that cycle already cleared.
    tab: 'rejects', detailsOpen: false, fgroups: {},
    // --- correction editor ---
    editing: null, editFrom: null, draft: null, navOrder: null,
    // §C.6 — the declared correction path. Null until the analyst chooses.
    path: null, cfgNote: '', cfgFamily: '',
    irdManual: '', irdNote: '',
    // --- IRD Resolution panel (Mastercard staging IRD rejects) ---
    // irdCards holds per-strategy expand overrides; absent means "follow the
    // recommendation". irdApplied records which strategy staged the current
    // draft IRD, so Save can attach the reasoning note it generated.
    irdCards: {}, irdHistory: false, irdManualOpen: false, irdApplied: null,
    // --- overlays ---
    modal: null
  };
  var F = S.rej;

  /* =======================================================================
     Shared primitives
     ======================================================================= */
  function lc(status) { return R.LIFECYCLE[status] || R.LIFECYCLE.new; }
  function statusPill(t, withAttempt) {
    var d = lc(t.status);
    return pill(d.label, d.kind, d.icon) +
      (withAttempt !== false && t.attempts > 1
        ? '<span class="rej-attempt" title="Rejected ' + t.attempts + ' times — each resubmission came back">' +
        icon('rotate-ccw', 11) + 'Attempt <span class="num">' + t.attempts + '</span></span>' : '');
  }
  var NET_CLASS = { Visa: 'visa', Mastercard: 'mc', RuPay: 'rupay' };
  function netBadge(net) {
    return '<span class="rej-net ' + (NET_CLASS[net] || 'mc') + '">' + esc(net) + '</span>';
  }
  function familyPill(fam) {
    return fam === 'staging'
      ? pill('Staging', 'warning', 'file-x')
      : pill('Incoming', 'neutral', 'download');
  }
  function irdTag() { return '<span class="rej-ird-tag" title="Mastercard IRD reject">IRD</span>'; }
  function manualTag(tag) {
    if (!tag) return '';
    return '<span class="rej-manual-tag" title="Recorded by hand by ' + esc(tag.by) + ' on ' + esc(tag.at) + '">' +
      icon('hand', 11) + esc(tag.label) + '</span>';
  }
  /* Part 4.3 — the human-readable reason leads; the code is muted subtext
     beneath it. Someone reading a network spec knows what "Invalid IRD for this
     transaction type" means before they know what 0221 means. */
  function reasonCell(t) {
    return '<div class="reason-cell"><div class="reason-text">' + esc(R.reasonText(t.reasonCode)) +
      (R.isIrd(t.reasonCode) ? irdTag() : '') + '</div>' +
      '<div class="reason-code mono">' + esc(t.reasonCode) + '</div></div>';
  }
  function arnCell(arn) { return '<span class="rej-arn mono">' + esc(arn) + '</span>'; }
  function moneyOf(t) { return fmt(t.amount, 2, t.currency); }

  /* The batch progress section is gone (§C.3). The lifecycle distribution it
     drew is already carried by the status column, the summary strip and the
     Status cell on the overview row — a fourth restatement of the same counts
     was the least useful thing on the page. */

  function downloadText(name, body) {
    // Real download where the browser allows it; a toast is the honest fallback
    // in environments without Blob/URL (the prototype has no backend either way).
    try {
      if (window.Blob && window.URL && window.URL.createObjectURL && document.body) {
        var url = window.URL.createObjectURL(new window.Blob([body], { type: 'text/plain' }));
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
        toast('Downloaded ' + name, 'success');
        return;
      }
    } catch (e) { /* fall through to the toast */ }
    toast('Download started — ' + name, 'success');
  }
  // Re-render one region without disturbing focus in a live text input.
  function remount(id, html) {
    var m = el(id); if (!m) return;
    m.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  }

  /* =======================================================================
     A · Rejects Overview
     ======================================================================= */
  function tenantFilterActive() { return Object.keys(F.tenants).length > 0; }
  function dateInRange(d) {
    if (F.dateMode === 'all') return true;
    if (F.dateMode === 'on') return !F.dateOn || d === F.dateOn;
    if (F.dateMode === 'range') {
      if (F.dateFrom && d < F.dateFrom) return false;
      if (F.dateTo && d > F.dateTo) return false;
      return true;
    }
    var days = parseInt(F.dateMode, 10);
    if (isNaN(days)) return true;
    return d >= U.addDays(D.TODAY, -(days - 1));
  }
  // A batch survives the filters when at least one of its transactions does —
  // reason code and status are transaction-level, the rest are batch-level.
  function filteredBatches() {
    return R.batches.filter(function (b) {
      if (tenantFilterActive() && !F.tenants[b.tenantId]) return false;
      if (F.network !== 'all' && b.network !== F.network) return false;
      if (F.family !== 'all' && b.family !== F.family) return false;
      if (!dateInRange(b.cycleDate)) return false;
      if (F.reason !== 'all' && !b.txns.some(function (t) { return t.reasonCode === F.reason; })) return false;
      if (F.bq) {
        var q = F.bq.toLowerCase();
        var hay = (b.id + ' ' + b.tenantName + ' ' + b.rejectFile + ' ' + b.clearingFile).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedBatches(list) {
    var k = F.sort.key, dir = F.sort.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      // Default: staging above incoming (a refused file blocks a whole cycle),
      // then newest cycle first.
      if (k === 'default') {
        if (a.family !== b.family) return a.family === 'staging' ? -1 : 1;
        return a.cycleDate < b.cycleDate ? 1 : (a.cycleDate > b.cycleDate ? -1 : 0);
      }
      var va, vb;
      if (k === 'tenant') { va = a.tenantName; vb = b.tenantName; }
      else if (k === 'network') { va = a.network; vb = b.network; }
      else if (k === 'family') { va = a.family; vb = b.family; }
      else if (k === 'cycle') { va = a.cycleDate; vb = b.cycleDate; }
      else if (k === 'received') { va = a.receivedAt; vb = b.receivedAt; }
      else if (k === 'filetxns') { va = a.fileTxns; vb = b.fileTxns; }
      else if (k === 'rejects') { va = a.txns.length; vb = b.txns.length; }
      else if (k === 'value') { va = O.toINR(R.batchValue(a), a.currency); vb = O.toINR(R.batchValue(b), b.currency); }
      else if (k === 'status') { va = R.batchOpen(a); vb = R.batchOpen(b); }
      else { va = 0; vb = 0; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function sortTh(label, key, cls) {
    var on = F.sort.key === key;
    return '<th class="' + (cls || '') + ' sortable' + (on ? ' sorted' : '') + '" data-action="rej-sort" data-key="' + key + '">' +
      esc(label) + icon(on ? (F.sort.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down', 13) + '</th>';
  }

  /* Part 4.2 — four KPI cards with accent icon tiles. IRD rejects have no card
     of their own; they stay legible as a tag on the rows that carry them. */
  function summaryStrip(list) {
    var s = R.summary(list);
    return '<div class="kpi-row mb-16">' +
      kpiCard({
        tile: 'orange', icon: 'file-warning', label: 'Open rejects', value: num(s.open),
        sub: 'Across ' + list.length + ' batch' + (list.length === 1 ? '' : 'es')
      }) +
      kpiCard({
        tile: 'red', icon: 'file-x', label: 'Staging', value: num(s.staging),
        sub: s.stagingBlocking
          ? '<strong class="rej-warn-text"><span class="num">' + s.stagingBlocking + '</span> blocking an unsubmitted file</strong>'
          : 'No file currently blocked'
      }) +
      kpiCard({
        tile: 'blue', icon: 'download', label: 'Incoming', value: num(s.incoming),
        sub: 'File staged, rejected later'
      }) +
      kpiCard({
        tile: 'purple', icon: 'rotate-ccw', label: 'Re-rejected', value: num(s.reRejected),
        sub: s.reRejected ? 'Came back after resubmission — work these first' : 'Nothing has come back twice'
      }) +
      '</div>';
  }

  /* Part 3.3 — one filter-row shape: search, then four categorical filters,
     then the preset, then the resolved date range, then refresh. Anything set
     shows as a removable chip beneath. */
  function activeChips() {
    var out = [];
    Object.keys(F.tenants).forEach(function (tid) {
      out.push({ label: 'Tenant: ' + ((O.tenantById[tid] || {}).name || tid), action: 'rej-tenant', data: ' data-id="' + tid + '"' });
    });
    if (F.network !== 'all') out.push({ label: 'Network: ' + F.network, action: 'rej-clear-network' });
    if (F.family !== 'all') out.push({ label: 'Type: ' + (F.family === 'staging' ? 'Staging' : 'Incoming'), action: 'rej-clear-family' });
    if (F.reason !== 'all') out.push({ label: 'Reason: ' + R.reasonText(F.reason), action: 'rej-clear-reason' });
    if (F.dateMode !== 'all') out.push({ label: 'Cycle date: ' + dateLabel(), action: 'rej-clear-date' });
    return out;
  }
  function dateLabel() {
    if (F.dateMode === 'on') return F.dateOn ? U.prettyDate(F.dateOn) : 'a specific date';
    if (F.dateMode === 'range') return (F.dateFrom ? U.prettyDate(F.dateFrom) : '…') + ' – ' + (F.dateTo ? U.prettyDate(F.dateTo) : '…');
    if (F.dateMode === 'all') return 'Any cycle date';
    if (F.dateMode === '1') return U.prettyDate(D.TODAY);
    return U.prettyDate(U.addDays(D.TODAY, -(parseInt(F.dateMode, 10) - 1))) + ' – ' + U.prettyDate(D.TODAY);
  }
  function filterRow() {
    var tenantVal = Object.keys(F.tenants)[0] || 'all';
    var reasonOpts = [['all', 'All reasons']].concat(R.reasonCodesPresent().map(function (c) {
      return [c, R.reasonText(c) + ' (' + c + ')'];
    }));
    var dateBox;
    if (F.dateMode === 'on') {
      dateBox = '<input type="date" value="' + esc(F.dateOn) + '" data-action="rej-c-date-on" aria-label="Cycle date" />';
    } else if (F.dateMode === 'range') {
      dateBox = '<input type="date" value="' + esc(F.dateFrom) + '" data-action="rej-c-date-from" aria-label="From" />' +
        '<span class="meta">–</span>' +
        '<input type="date" value="' + esc(F.dateTo) + '" data-action="rej-c-date-to" aria-label="To" />';
    } else {
      dateBox = '<span>' + esc(dateLabel()) + '</span>';
    }
    return opsFilterRow({
      search: { placeholder: 'Search batch, tenant or file name', action: 'rej-i-bq', value: F.bq || '' },
      filters: [
        { action: 'rej-c-tenant-one', value: tenantVal, label: 'Tenant', options: [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; })) },
        { action: 'rej-c-network', value: F.network, label: 'Network', options: [['all', 'All networks'], 'Visa', 'Mastercard', 'RuPay'] },
        { action: 'rej-c-family', value: F.family, label: 'Type', options: [['all', 'Staging and incoming'], ['staging', 'Staging'], ['incoming', 'Incoming']] },
        { action: 'rej-c-reason', value: F.reason, label: 'Reason code', options: reasonOpts }
      ],
      preset: {
        action: 'rej-c-preset', value: F.dateMode,
        options: [['all', 'All dates'], ['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['on', 'Specific date'], ['range', 'Custom range']]
      },
      dateRange: dateBox + icon('chevron-down', 16),
      refresh: 'rej-refresh',
      chips: activeChips()
    });
  }

  /* Part 4.2 — Tenant · Network · Type · Cycle date · Rejects · Value ·
     Received. Every column here is something a batch is chosen by. */
  function batchTable(list) {
    if (!list.length) {
      return '<div class="card">' + emptyState('check-circle', 'No reject batches match these filters',
        'Widen the date range or clear the tenant, network and reason filters.',
        '<button class="btn btn-secondary" data-action="rej-reset">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var rows = sortedBatches(list).map(function (b) {
      var c = R.batchCounts(b);
      return '<tr class="clickable' + (R.isBlocking(b) ? ' rej-row-blocking' : '') + '" data-route="' + ROUTE + '/' + b.id + '">' +
        '<td>' + tenantTag(b.tenantId) + '</td>' +
        '<td>' + netBadge(b.network) + '</td>' +
        '<td>' + familyPill(b.family) + (R.isBlocking(b) ? '<div class="cell-sub rej-warn-text">Blocks the cycle</div>' : '') + '</td>' +
        '<td class="nowrap"><div class="cell-main num">' + U.prettyDate(b.cycleDate) + '</div>' +
        '<div class="cell-sub">' + esc(b.cycleDow) + '</div></td>' +
        '<td class="num"><div class="cell-main">' + num(b.txns.length) + '</div>' +
        '<div class="cell-sub num">' + (c.re_rejected ? c.re_rejected + ' re-rejected · ' : '') + R.batchOpen(b) + ' open</div></td>' +
        '<td class="num nowrap">' + fmt(R.batchValue(b), 2, b.currency) + '</td>' +
        '<td class="nowrap cell-sub num">' + esc(b.receivedAt) + '</td>' +
        '<td class="nowrap"><span class="rej-open-link">Open' + icon('arrow-right', 14) + '</span></td>' +
        '</tr>';
    }).join('');

    return tableCard('<table class="data rej-batches"><thead><tr>' +
      sortTh('Tenant', 'tenant') + sortTh('Network', 'network') + sortTh('Type', 'family') +
      sortTh('Cycle date', 'cycle') + sortTh('Rejects', 'rejects', 'num') +
      sortTh('Value', 'value', 'num') + sortTh('Received', 'received') +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table>');
  }

  function viewOverview() {
    var list = filteredBatches();
    setView(
      pageHead('Rejects', 'Transactions the card networks refused. Fix them, then regenerate the file.') +
      summaryStrip(list) +
      filterRow() +
      '<div class="mt-16">' + batchTable(list) + '</div>'
    );
  }

  /* =======================================================================
     B · Reject Batch Detail
     ======================================================================= */
  function currentBatch() { return R.batchById[F.batchId]; }

  // Default order: anything with a failed attempt behind it first (attempt 3 is
  // an escalation, not a queue position), then lifecycle order, then ARN.
  function txnPriority(t) { return (t.attempts > 1 ? -10 : 0) + lc(t.status).order; }
  /* §C.4 — an incoming reject's table exists to say what still needs correcting
     and staging next cycle. Transactions that already cleared are not part of
     that work, so they are out of the table entirely. A staging reject keeps
     everything: nothing in that file cleared, so nothing there is noise. */
  function inTable(b, t) { return b.family === 'staging' || t.status !== 'cleared'; }
  function clearedHidden(b) {
    return b.family === 'staging' ? 0 : b.txns.filter(function (t) { return t.status === 'cleared'; }).length;
  }
  function visibleTxns(b) {
    var q = F.q.trim();
    var list = b.txns.filter(function (t) { return inTable(b, t) && (!q || t.arn.indexOf(q) >= 0); });
    var k = F.txnSort.key, dir = F.txnSort.dir === 'asc' ? 1 : -1;
    return list.sort(function (a, c) {
      var va, vb;
      if (k === 'status') { va = txnPriority(a); vb = txnPriority(c); }
      else if (k === 'arn') { va = a.arn; vb = c.arn; }
      else if (k === 'merchant') { va = a.merchant; vb = c.merchant; }
      else if (k === 'amount') { va = a.amount; vb = c.amount; }
      else if (k === 'date') { va = a.txnDate + a.txnTime; vb = c.txnDate + c.txnTime; }
      else if (k === 'reason') { va = a.reasonCode; vb = c.reasonCode; }
      else if (k === 'assignee') { va = a.assignee || '~'; vb = c.assignee || '~'; }
      else { va = 0; vb = 0; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.arn < c.arn ? -1 : 1;
    });
  }
  function selectedTxns(b) { return b.txns.filter(function (t) { return F.sel[t.id]; }); }

  function txnSortTh(label, key, cls) {
    var on = F.txnSort.key === key;
    return '<th class="' + (cls || '') + ' sortable' + (on ? ' sorted' : '') + '" data-action="rej-txn-sort" data-key="' + key + '">' +
      esc(label) + icon(on ? (F.txnSort.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down', 13) + '</th>';
  }

  /* Part 4.3 — ARN · Merchant · Amount · Reason · Status · Fix →.
     Transaction date rides with the ARN and the assignee with the status, so
     neither is lost and neither costs a column. */
  function txnTable(b) {
    var list = visibleTxns(b);
    if (!list.length) {
      return '<div class="card">' + emptyState('search-x', 'No transactions match',
        F.q ? 'No ARN in this batch contains “' + esc(F.q) + '”. Clear the search to see all ' + openTxnCount(b) + '.'
          : (b.family === 'incoming' && clearedHidden(b)
            ? 'Every reject in this batch has cleared.'
            : 'This batch has no rejected transactions.'),
        F.q ? '<button class="btn btn-secondary" data-action="rej-clear-q">' + icon('rotate-ccw', 18) + 'Clear search</button>' : '') + '</div>';
    }
    var allSel = list.every(function (t) { return F.sel[t.id]; });
    var rows = list.map(function (t) {
      return '<tr class="' + (t.status === 're_rejected' ? 'rej-row-rerejected' : '') +
        (t.status === 'wont_fix' ? ' rej-row-terminal' : '') +
        (t.status === 'awaiting_config' ? ' rej-row-awaiting' : '') + '">' +
        '<td class="pick-cell sticky-pick" onclick="event.stopPropagation()">' +
        '<input type="checkbox"' + (F.sel[t.id] ? ' checked' : '') + ' data-action="rej-c-pick" data-id="' + t.id + '" aria-label="Select ' + esc(t.arn) + '" /></td>' +
        '<td class="sticky-arn">' + arnCell(t.arn) +
        '<div class="cell-sub num">' + U.prettyDate(t.txnDate) + ' · ' + esc(t.txnTime) + ' IST</div></td>' +
        '<td><div class="cell-main">' + esc(t.merchant) + '</div><div class="cell-sub mono">' + esc(t.mid) + '</div></td>' +
        '<td class="num nowrap">' + moneyOf(t) + '</td>' +
        '<td>' + reasonCell(t) + '</td>' +
        '<td>' + statusPill(t) + manualTag(t.manualTag) +
        (t.status === 'awaiting_config' && t.configRequest
          ? '<div class="cell-sub rej-cfg-line">' + icon('settings', 12) +
          esc(t.configRequest.familyLabel || 'Config or code change') + '</div>' : '') +
        '<div class="cell-sub">' + (t.assignee ? 'Assigned to ' + esc(t.assignee) : 'Unassigned') + '</div></td>' +
        '<td class="nowrap rej-row-actions">' +
        // A transaction blocked on a config change has one action worth taking
        // from the table: the re-derive that unblocks it once the config lands.
        (t.status === 'awaiting_config'
          ? '<button class="btn btn-sm btn-secondary" data-action="rej-rederive" data-id="' + t.id + '" ' +
          'title="Recompute this transaction from the corrected config">' + icon('refresh-cw', 16) + 'Re-derive</button>'
          : '') +
        '<button class="rej-fix-link" data-action="rej-edit" data-id="' + t.id + '">Fix' + icon('arrow-right', 15) + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="rej-history" data-id="' + t.id + '" title="Correction history">' + icon('history', 16) + '</button>' +
        '</td></tr>';
    }).join('');

    return '<div class="table-card"><div class="table-wrap rej-txn-wrap"><table class="data rej-txns"><thead><tr>' +
      '<th class="pick-cell sticky-pick"><input type="checkbox"' + (allSel ? ' checked' : '') + ' data-action="rej-c-pick-all" aria-label="Select all" /></th>' +
      txnSortTh('ARN', 'arn', 'sticky-arn') + txnSortTh('Merchant', 'merchant') + txnSortTh('Amount', 'amount', 'num') +
      txnSortTh('Reason', 'reason') + txnSortTh('Status', 'status') + '<th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  // How many rows this batch's working table holds — the rejects, minus the
  // cleared ones an incoming batch no longer lists.
  function openTxnCount(b) { return b.txns.filter(function (t) { return inTable(b, t); }).length; }

  /* ---- Staging only: all transactions in the file (§C.5) -----------------
     Read-only. The replacement file carries the entire original file, so this
     is what the analyst is about to resubmit — the corrections applied in
     place, and every untouched transaction alongside them. */
  function fileTable(b) {
    var s = R.fileTxnSample(b, 40);
    var rows = s.rows.map(function (row) {
      var corrected = row.rejected && ['corrected', 'regenerated', 'resubmitted', 'cleared'].indexOf(row.status) >= 0;
      var d = lc(row.status);
      var stateCell = row.rejected
        ? (corrected ? pill('Corrected in place', 'success', 'check') : pill(d.label, d.kind, d.icon))
        : '<span class="rej-file-unchanged">' + icon('minus', 12) + 'Unchanged</span>';
      return '<tr class="' + (row.rejected ? 'rej-file-row-rejected' : '') + '">' +
        '<td class="sticky-arn">' + arnCell(row.arn) + '</td>' +
        '<td><div class="cell-main">' + esc(row.merchant) + '</div><div class="cell-sub mono">' + esc(row.mid) + '</div></td>' +
        '<td class="num nowrap">' + fmt(row.amount, 2, row.currency) + '</td>' +
        '<td class="nowrap"><div class="num">' + U.prettyDate(row.txnDate) + '</div><div class="cell-sub num">' + esc(row.txnTime) + ' IST</div></td>' +
        '<td>' + (row.reasonCode ? '<span class="mono reason-code">' + esc(row.reasonCode) + '</span>' : '<span class="meta">—</span>') + '</td>' +
        '<td>' + stateCell + '</td></tr>';
    }).join('');

    return '<div class="rej-file-note">' + icon('info', 15) +
      '<span>Read-only · showing <span class="num">' + s.shown + '</span> of <span class="num">' + num(s.total) +
      '</span>. The replacement file carries all <span class="num">' + num(s.total) + '</span>.</span></div>' +
      '<div class="table-card"><div class="table-wrap rej-txn-wrap"><table class="data rej-txns"><thead><tr>' +
      '<th class="sticky-arn">ARN</th><th>Merchant</th><th class="num">Amount</th>' +
      '<th>Transaction date</th><th>Reason</th><th>In replacement file</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  /* Part 4.3 — a compact stat row, not KPI cards: this is secondary
     information. Four inline stats separated by vertical rules. */
  function statRow(b) {
    var corrected = R.correctedTxns(b).length;
    var still = R.batchOpen(b);
    function cell(label, value, cls) {
      return '<div class="rej-stat"><span class="rej-stat-label">' + esc(label) + '</span>' +
        '<span class="rej-stat-value num ' + (cls || '') + '">' + value + '</span></div>';
    }
    return '<div class="rej-statrow">' +
      cell('Transactions in file', num(b.fileTxns)) +
      cell('Rejected', num(b.txns.length), 'rej-danger-text') +
      cell('Fixed', num(corrected), corrected ? 'rej-good-text' : '') +
      cell('Still to fix', num(still), still ? 'rej-warn-text' : 'rej-good-text') +
      '</div>';
  }

  /* Everything the old cycle-context card carried that the stat row does not,
     kept behind one disclosure so no detail is lost (Part 6). */
  function cycleDetails(b) {
    var rejCount = b.txns.length, rejValue = R.batchValue(b);
    var accCount = b.family === 'staging' ? 0 : b.fileTxns - rejCount;
    var accValue = b.family === 'staging' ? 0 : Math.round((b.fileValue - rejValue) * 100) / 100;
    function row(label, value, sub) {
      return '<div class="ctx-cell"><span class="ctx-label">' + esc(label) + '</span>' +
        '<span class="ctx-value num">' + value + '</span>' +
        (sub ? '<span class="ctx-sub num">' + sub + '</span>' : '') + '</div>';
    }
    var open = F.detailsOpen;
    return '<div class="rej-details">' +
      '<button class="rej-details-head" data-action="rej-details" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      icon(open ? 'chevron-down' : 'chevron-right', 16) + 'Cycle and file details</button>' +
      (open
        ? '<div class="rej-details-body"><div class="ctx-grid">' +
        row('Transaction cohort', U.prettyDate(b.cohortFrom) + ' → ' + U.prettyDate(b.cohortTo), U.dow(b.cycleDate) + ' cycle') +
        row('Total value in file', fmt(b.fileValue, 2, b.currency), '') +
        row('Rejected value', fmt(rejValue, 2, b.currency), pct(R.batchRate(b), 3) + ' of file') +
        row('Accepted', num(accCount), b.family === 'staging' ? 'nothing cleared — file refused' : fmt(accValue, 2, b.currency)) +
        '</div>' +
        '<div class="rej-file-line">' + icon('file-text', 16) +
        '<span>Original clearing file</span><code class="mono">' + esc(b.clearingFile) + '</code>' +
        '<span class="meta num">' + esc(b.clearingFileSize) + '</span>' +
        '<button class="btn btn-sm btn-secondary" data-action="rej-dl-clearing">' + icon('download', 16) + 'Download</button></div>' +
        '<div class="rej-file-line">' + icon('file-warning', 16) +
        '<span>Reject file</span><code class="mono">' + esc(b.rejectFile) + '</code>' +
        '<span class="meta num">' + esc(b.rejectFileSize) + ' · received ' + esc(b.receivedAt) + '</span>' +
        '<button class="btn btn-sm btn-secondary" data-action="rej-dl-reject">' + icon('download', 16) + 'Download</button></div>' +
        '</div>'
        : '') + '</div>';
  }

  function generatedHistory(b) {
    var model = R.regenModel(b);
    if (!b.generated.length) {
      return cardBox('Generated files',
        '<div class="meta">None yet. Fix at least one transaction, then use <strong>' + esc(model.action) + '</strong> above.</div>');
    }
    var rows = b.generated.map(function (g, i) {
      var outKind = g.outcome === 'Accepted' ? 'success' : (g.outcome === 'Re-rejected' ? 'danger' : 'neutral');
      var delKind = g.delivery === 'Not yet delivered' ? 'warning' : 'neutral';
      var kind = g.kind || model.key;
      return '<tr>' +
        '<td class="mono nowrap sticky-arn">' + esc(g.name) + '<div class="cell-sub mono">' + esc(g.checksum) + '</div></td>' +
        // Round 3 §C.5 — a replacement and a supplement are different artefacts
        // with different submission rules; the history has to say which is which.
        '<td>' + pill(kind === 'replacement' ? 'Replacement' : 'Supplementary',
          kind === 'replacement' ? 'danger' : 'info', kind === 'replacement' ? 'files' : 'file-plus') +
        (kind === 'replacement'
          ? '<div class="cell-sub">supersedes the original file</div>'
          : '<div class="cell-sub">corrected rejects only</div>') + '</td>' +
        '<td class="nowrap cell-sub num">' + esc(g.at) + '</td>' +
        '<td class="cell-sub">' + esc(g.by) + '</td>' +
        '<td class="num">' + num(g.count) +
        (kind === 'replacement' ? '<div class="cell-sub num">' + (g.corrected || 0) + ' corrected</div>' : '') + '</td>' +
        '<td class="num nowrap">' + fmt(g.value, 2, g.currency) + '</td>' +
        '<td>' + pill(g.delivery, delKind) + (g.manual ? manualTag({ label: 'manually marked', by: g.markedBy || g.by, at: g.markedAt || g.at }) : '') +
        (g.s3Path ? '<div class="cell-sub mono">' + esc(g.s3Path) + '</div>' : '') +
        (g.note ? '<div class="cell-sub">' + esc(g.note) + '</div>' : '') + '</td>' +
        '<td>' + pill(g.outcome, outKind) + '</td>' +
        '<td><button class="btn btn-sm btn-ghost" data-action="rej-dl-generated" data-idx="' + i + '">' + icon('download', 14) + 'Download</button></td>' +
        '</tr>';
    }).join('');
    return cardBox('Generated files',
      '<div class="meta mb-16">Append-only — every file generated for this batch stays on the record.</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th class="sticky-arn">File name</th><th>Type</th><th>Generated at</th><th>Generated by</th><th class="num">Transactions</th>' +
      '<th class="num">Value</th><th>Delivery</th><th>Outcome</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  function bulkBar(b) {
    var sel = selectedTxns(b);
    if (!sel.length) return '';
    return '<div class="batch-bar">' + icon('layers', 16) +
      '<strong><span class="num">' + sel.length + '</span> selected</strong>' +
      '<button class="btn btn-primary btn-sm" data-action="rej-assign-me">' + icon('user-check', 15) + 'Assign to me</button>' +
      '<button class="btn btn-secondary btn-sm" data-action="rej-clear-sel">Clear selection</button>' +
      '</div>';
  }

  function viewBatch() {
    var b = currentBatch();
    if (!b) {
      setView(pageHead('Rejects', 'Transactions the card networks refused.') +
        '<div class="card">' + emptyState('file-warning', 'Reject batch not found',
          'That batch id is not in the last 30 days of reject files.',
          '<button class="btn btn-secondary" data-route="' + ROUTE + '">Back to Rejects</button>') + '</div>');
      return;
    }
    var corrected = R.correctedTxns(b);
    var model = R.regenModel(b);
    var awaiting = R.awaitingConfigTxns(b);
    var reconCycleId = 'ops-cyc-' + b.tenantId + '-' + b.cycleDate;

    /* Part 4.1 — one line, not a paragraph. The distinction between full
       replacement and supplementary regeneration is carried by this sentence
       plus the action button label; no banner needs to explain it. */
    var statusLine = b.family === 'staging'
      ? '<div class="rej-statusline danger">' + icon('alert-triangle', 18) +
      '<span>File rejected — nothing cleared. Fix the flagged transactions and resubmit the whole file.</span></div>'
      : '<div class="rej-statusline info">' + icon('info', 18) +
      '<span>Rest of the file cleared. Fix these transactions and resubmit just them.</span>' +
      '<a class="rej-statusline-link" data-route="#/dashboard/ops/reconciliation?reconTenant=' + b.tenantId + '&reconCycle=' + reconCycleId + '">' +
      'View this cycle&rsquo;s reconciliation' + icon('arrow-right', 14) + '</a></div>';

    var head = pageHead(
      tenantTag(b.tenantId) + ' <span class="rej-title-sep">·</span> ' + netBadge(b.network) +
      ' <span class="rej-title-sep">·</span> <span class="num">' + U.prettyDate(b.cycleDate) + '</span>',
      '<a class="rej-back" data-route="' + ROUTE + '">' + icon('arrow-left', 15) + 'All rejects</a>' +
      '<span class="rej-head-id mono">' + esc(b.id) + '</span>' + familyPill(b.family),
      // One primary action: the file this batch exists to produce.
      '<button class="btn btn-secondary" data-action="rej-export">' + icon('table', 18) + 'Export rejects</button>' +
      '<button class="btn btn-primary" data-action="rej-gen-open"' + (corrected.length ? '' : ' disabled') +
      ' title="' + (corrected.length
        ? (model.key === 'replacement'
          ? 'Generate a complete replacement file — all ' + num(b.fileTxns) + ' transactions, with ' + corrected.length + ' correction(s) applied in place'
          : 'Generate a supplementary file containing the ' + corrected.length + ' corrected reject(s)')
        : 'Fix at least one transaction first') + '">' +
      icon('file-plus', 18) + esc(model.action) + (corrected.length ? ' <span class="num">(' + corrected.length + ')</span>' : '') + '</button>');

    var awaitingLine = awaiting.length
      ? '<div class="rej-statusline warn">' + icon('settings', 18) +
      '<span><span class="num">' + awaiting.length + '</span> transaction' + (awaiting.length === 1 ? '' : 's') +
      ' waiting on a config fix — not counted as ready to regenerate.</span></div>'
      : '';

    var hidden = clearedHidden(b);
    var toolbar = '<div class="rej-toolbar">' +
      '<label class="ops-search">' + icon('search', 18) +
      '<input class="input" type="text" placeholder="Search by ARN" value="' + esc(F.q) + '" data-action="rej-i-q" aria-label="Search by ARN" />' +
      '</label>' +
      (hidden ? '<span class="meta"><span class="num">' + hidden + '</span> cleared transaction' + (hidden === 1 ? '' : 's') + ' not listed</span>' : '') +
      '</div>';

    // §C.5 — a staging reject keeps its second, read-only view of the whole
    // file. An incoming reject does not: the rest of that cycle already cleared.
    var tabbed = b.family === 'staging';
    var tab = tabbed ? (F.tab === 'file' ? 'file' : 'rejects') : 'rejects';
    var tabs = tabbed
      ? '<div class="tabs rej-tabs">' +
      '<button class="tab' + (tab === 'rejects' ? ' active' : '') + '" data-action="rej-tab" data-tab="rejects">' +
      'Rejected transactions <span class="count num">' + openTxnCount(b) + '</span></button>' +
      '<button class="tab' + (tab === 'file' ? ' active' : '') + '" data-action="rej-tab" data-tab="file">' +
      'All transactions in file <span class="count num">' + num(b.fileTxns) + '</span></button>' +
      '</div>'
      : '';

    var body = tab === 'file'
      ? '<div class="mt-24">' + tabs + fileTable(b) + '</div>'
      : '<div class="mt-24">' + tabs + toolbar + bulkBar(b) +
      '<div id="rej-txn-mount">' + txnTable(b) + '</div></div>';

    setView(
      head + statusLine + awaitingLine +
      statRow(b) + cycleDetails(b) +
      body +
      '<div class="mt-24">' + generatedHistory(b) + '</div>' +
      (F.editing ? editorPanel() : '') +
      (F.modal ? modalLayer(b) : '')
    );
  }

  /* =======================================================================
     C · Transaction Correction Editor (side panel)
     ======================================================================= */
  function editingTxn() { return F.editing ? R.txnById[F.editing] : null; }
  // The panel's working order is frozen when it opens. Correcting a transaction
  // changes its status, which would otherwise re-sort the table underneath the
  // user — "3 of 18" must not jump around while they are working through it.
  function editableList() {
    var b = currentBatch(); if (!b) return [];
    if (!F.navOrder) return visibleTxns(b);
    return F.navOrder.map(function (id) { return R.txnById[id]; })
      .filter(function (t) { return t && t.batchId === b.id; });
  }
  function editIndex() {
    var list = editableList();
    for (var i = 0; i < list.length; i++) if (list[i].id === F.editing) return i;
    return -1;
  }
  function draftChanges(t) {
    if (!F.draft) return [];
    return Object.keys(F.draft).filter(function (k) {
      return String(F.draft[k]) !== String(t.fields[k] == null ? '' : t.fields[k]);
    }).map(function (k) {
      return { field: k, from: t.fields[k] == null ? '' : String(t.fields[k]), to: String(F.draft[k]) };
    });
  }

  /* Part 4.4 — the flagged field is pulled to the top of the list and marked;
     every other field follows, grouped under collapsible headings. The reason
     code is still a hint, not a gate: everything stays editable. */
  function fieldRow(t, key, hinted) {
    var def = R.FIELDS[key] || { label: key };
    var cur = t.fields[key] == null ? '' : String(t.fields[key]);
    var val = F.draft && F.draft[key] != null ? String(F.draft[key]) : cur;
    var changed = val !== cur;
    var input;
    if (def.type === 'select') {
      input = '<select class="input' + (def.mono ? ' mono' : '') + '" data-action="rej-c-field" data-field="' + key + '">' +
        def.options.map(function (o) { return '<option value="' + esc(o) + '"' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select>';
    } else {
      input = '<input class="input' + (def.mono ? ' mono' : '') + '" type="text" value="' + esc(val) + '" ' +
        'data-action="rej-i-field" data-field="' + key + '" aria-label="' + esc(def.label) + '" />';
    }
    return '<div class="rej-field' + (changed ? ' changed' : '') + (hinted ? ' hinted' : '') + '">' +
      '<div class="rej-field-label">' +
      (hinted ? '<span class="rej-flag-dot" aria-hidden="true"></span>' : '') + esc(def.label) +
      (hinted ? '<span class="rej-flag-suffix">(flagged by the reject reason)</span>' : '') +
      (changed ? '<span class="rej-changed-dot" title="Edited">' + icon('circle', 10) + 'edited</span>' : '') + '</div>' +
      '<div class="rej-field-current"><span class="rej-field-key">current</span>' +
      '<span class="' + (def.mono ? 'mono ' : '') + 'num">' + (cur === '' ? '<em class="rej-empty">empty</em>' : esc(cur)) + '</span></div>' +
      '<div class="rej-field-input">' + input + '</div>' +
      (def.help ? '<div class="rej-field-help">' + esc(def.help) + '</div>' : '') +
      '</div>';
  }

  function groupOpen(name) { return F.fgroups[name] !== false; }

  function fieldEditor(t) {
    var rel = R.relevantFields(t.reasonCode);
    var out = '';
    if (rel.length) {
      out += '<div class="rej-fgroup flagged"><div class="rej-fgroup-head">' +
        '<span class="rej-fgroup-name">' + (rel.length === 1 ? 'Flagged field' : 'Flagged fields') + '</span></div>' +
        rel.map(function (k) { return fieldRow(t, k, true); }).join('') + '</div>';
    }
    out += R.groupedFields().map(function (g) {
      var keys = g.fields.filter(function (k) { return rel.indexOf(k) < 0; });
      if (!keys.length) return '';
      var open = groupOpen(g.group);
      return '<div class="rej-fgroup' + (open ? ' open' : '') + '">' +
        '<button class="rej-fgroup-head" data-action="rej-fgroup" data-group="' + esc(g.group) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        icon(open ? 'chevron-down' : 'chevron-right', 15) +
        '<span class="rej-fgroup-name">' + esc(g.group) + '</span>' +
        '<span class="meta"><span class="num">' + keys.length + '</span> field' + (keys.length === 1 ? '' : 's') + '</span></button>' +
        (open ? keys.map(function (k) { return fieldRow(t, k, false); }).join('') : '') +
        '</div>';
    }).join('');
    return '<div class="rej-field-groups">' + out + '</div>';
  }

  /* ---- Step 2b · the rule fix (Part 4.4) ---------------------------------
     One question, an optional destination, a way to get there, and the action
     that parks the reject in the state that says so. Nothing here edits the
     transaction, because the transaction is not what is wrong. */
  function configPathPanel(t) {
    var famOpts = R.CONFIG_FAMILIES.map(function (f) {
      return '<option value="' + f.key + '"' + (F.cfgFamily === f.key ? ' selected' : '') + '>' + esc(f.label) + '</option>';
    }).join('');
    var fam = R.configFamily(F.cfgFamily);
    var route = fam ? fam.route : '#/dashboard/ops/configs';
    var already = t.status === 'awaiting_config' && t.configRequest;

    return '<div class="rej-cfg-panel">' +
      (already
        ? '<div class="rej-cfg-existing">' + icon('clock', 16) +
        '<div><strong>Already waiting on a config fix</strong> — raised by ' + esc(t.configRequest.by) +
        ' on <span class="num">' + esc(t.configRequest.at) + '</span>' +
        (t.configRequest.familyLabel ? ' · ' + esc(t.configRequest.familyLabel) : '') +
        '<div class="rej-cfg-existing-note">' + esc(t.configRequest.note) + '</div></div></div>'
        : '') +

      '<label class="field rej-cfg-note">What needs to change? <span class="req">required</span>' +
      '<textarea class="input" rows="3" data-action="rej-i-cfg-note" ' +
      'placeholder="e.g. The MCC mapping for this acquirer BIN still points at the 2024 ISO 18245 table — 5732 is being emitted as 9732.">' +
      esc(F.cfgNote) + '</textarea></label>' +

      '<div class="rej-cfg-row">' +
      '<label class="field inline">Which configuration? <span class="meta">optional</span>' +
      '<select class="input w-260" data-action="rej-c-cfg-family">' +
      '<option value=""' + (F.cfgFamily ? '' : ' selected') + '>Not sure yet</option>' + famOpts +
      '<option value="code"' + (F.cfgFamily === 'code' ? ' selected' : '') + '>A code change — not a config</option>' +
      '</select></label>' +
      (F.cfgFamily === 'code'
        ? '<span class="meta rej-cfg-code">' + icon('git-branch', 14) + 'Raise with platform engineering — there is no config surface for it.</span>'
        : '<a class="rej-cfg-link" data-route="' + route + '">Open Platform Configs' + icon('arrow-right', 15) + '</a>') +
      '</div>' +

      '<div class="rej-cfg-foot">' +
      '<button class="btn btn-primary" id="rej-cfg-mark" data-action="rej-mark-config"' + (F.cfgNote.trim() ? '' : ' disabled') + '>' +
      icon('settings', 16) + 'Mark as waiting on config</button>' +
      '</div></div>';
  }

  /* Step 1 of the fix panel: what kind of fix is this? Two cards, two lines
     each. Selecting one reveals its content below. */
  function pathCards(t) {
    var cards = ['data', 'config'].map(function (k) {
      var p = R.PATHS[k];
      var on = F.path === k;
      return '<button class="rej-path-card' + (on ? ' on' : '') + '" data-action="rej-path" data-path="' + k + '" ' +
        'role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
        '<span class="rej-path-radio">' + icon(on ? 'circle-dot' : 'circle', 20) + '</span>' +
        '<span class="rej-path-body">' +
        '<span class="rej-path-title">' + esc(p.label) + '</span>' +
        '<span class="rej-path-blurb">' + esc(p.blurb) + '</span></span>' +
        '</button>';
    }).join('');
    return '<div class="sp-section-head">What kind of fix is this?</div>' +
      '<div class="rej-path-cards" role="radiogroup" aria-label="Kind of fix">' + cards + '</div>';
  }

  function diffBlock(t) {
    var changes = draftChanges(t);
    if (!changes.length) {
      return '<div class="meta">Nothing changed yet — a fix needs at least one edited field.</div>';
    }
    return '<div class="rej-diff">' + changes.map(function (c) {
      var def = R.FIELDS[c.field] || { label: c.field };
      return '<div class="rej-diff-row"><span class="rej-diff-field">' + esc(def.label) + '</span>' +
        '<span class="rej-diff-old mono">' + (c.from === '' ? 'empty' : esc(c.from)) + '</span>' +
        icon('arrow-right', 13) +
        '<span class="rej-diff-new mono">' + (c.to === '' ? 'empty' : esc(c.to)) + '</span></div>';
    }).join('') + '</div>';
  }

  /* =======================================================================
     C1 · IRD Resolution panel — Mastercard staging IRD rejects only
     -----------------------------------------------------------------------
     Renders between the reject context section and the editable fields, and
     only when the network is Mastercard, the family is staging and the reason
     code is IRD-related. Visa rejects, incoming rejects and non-IRD Mastercard
     rejects fall through to the standard editor untouched.

     Where this panel renders it stands in for the single-answer recommendation
     panel below it: two Apply surfaces and two manual-entry fields inside one
     editor is a worse tool, not a richer one. Incoming Mastercard IRD rejects
     keep that panel exactly as it was.

     The ladder is an escalation, not a menu. Strategy 1 carries the network's
     own correction and is cheap to trust; Strategy 4 will almost certainly
     clear and costs the bank real money every time it is used. The panel is
     built so that difference is impossible to miss.
     ======================================================================= */
  function ladderOn(t) { return R.hasIrdLadder(t); }

  function rateSpan(rate) { return '<span class="num">' + Number(rate).toFixed(2) + '%</span>'; }
  function feeSpan(paise, cur) { return '<span class="num">' + esc(R.money(paise, cur)) + '</span>'; }
  function deltaSpan(paise, cur) {
    if (paise === 0) return '<span class="num rej-res-delta flat">—</span>';
    var cls = paise > 0 ? 'up' : 'down';
    return '<span class="num rej-res-delta ' + cls + '">' + (paise > 0 ? '+' : '') + esc(R.money(paise, cur)) + '</span>';
  }
  function irdBig(code, cls) { return '<span class="ird-code mono' + (cls ? ' ' + cls : '') + '">' + esc(code) + '</span>'; }
  function resKey(s) { return '<span class="rej-res-k">' + esc(s) + '</span>'; }
  function chips(list, cls) {
    return list.map(function (x) { return '<span class="rej-ird-chip' + (cls ? ' ' + cls : '') + '">' + esc(x) + '</span>'; }).join('');
  }

  // The IRD staged in the draft right now — an option matching it reads as
  // Applied rather than as something still to choose.
  function stagedIrd(t) {
    return F.draft && F.draft.ird != null ? String(F.draft.ird) : String(t.fields.ird);
  }

  /* ---- Plain-language explanation per strategy (Part 4.5) -----------------
     One line each, no strategy jargon. The user is choosing between four ways
     of deriving a replacement, not reading about a ladder. */
  function optionLine(s, o) {
    if (s.n === 1) return 'From the corrected product ID in the reject file';
    if (s.n === 2) return 'Next product ID for this card range (priority ' + o.priority + ' of ' + s.options.length + ')';
    if (s.n === 3) return 'Next matching IRD for the same details (' + o.rank + ' of ' + s.options.length + ')';
    return 'Broader IRD — fewer conditions, more likely accepted';
  }
  // Why a strategy cannot be used here, in one line and in plain language.
  function unavailableLine(s) {
    if (s.n === 1) return 'Not available — the reject file didn’t include a corrected product ID';
    if (s.n === 2) return 'Not available — this card range maps to a single product ID';
    if (s.n === 3) return 'Not available — only one IRD matches these details';
    return 'Not available for this transaction';
  }
  // Which attempt burned a given IRD, so an already-tried card can say so.
  function triedOnAttempt(res, ird) {
    var hit = (res.ctx.log || []).filter(function (r) { return r.ird === ird; })[0];
    if (hit) return hit.attempt;
    var idx = res.ctx.rejected.indexOf(ird);
    return idx >= 0 ? idx + 1 : null;
  }

  /* ---- The four option cards (Part 4.5) -----------------------------------
     All four render at once, selectable by radio. No accordion, no ladder, no
     "next strategy" progression that hides the others: the analyst chooses,
     and the cost of each choice is visible without expanding anything. */
  function irdOptionCard(t, s, res, anchorFee) {
    var cur = t.currency;
    var staged = stagedIrd(t);

    // What this card offers: the untried option if there is one, otherwise the
    // one that was tried, so an exhausted strategy still shows its value.
    var o = s.next || s.options[0] || null;
    var disabled = false, reason = '';
    if (!s.available) { disabled = true; reason = unavailableLine(s); o = null; }
    else if (!s.next) {
      disabled = true;
      var att = o ? triedOnAttempt(res, o.ird) : null;
      reason = 'Already tried — rejected' + (att ? ' on attempt ' + att : '') + '';
    }

    var selected = !disabled && o && staged === o.ird;
    var cls = 'ird-card' + (disabled ? ' disabled' : '') + (selected ? ' selected' : '') +
      (s.recommended ? ' recommended' : '') + (s.n === 4 ? ' fallback' : '');

    var head = '<span class="ird-radio">' + icon(selected ? 'circle-dot' : 'circle', 20) + '</span>' +
      '<span class="ird-value mono">' + esc(o ? o.ird : '—') + '</span>' +
      '<span class="ird-nums">' +
      (o ? '<span class="num ird-rate">' + Number(o.rate).toFixed(2) + '%</span>' +
        '<span class="num ird-fee">' + esc(R.money(o.fee, cur)) + '</span>' : '') +
      '</span>';

    var lines = '';
    if (disabled) {
      lines += '<div class="ird-why muted">' + esc(reason) + '</div>';
    } else {
      lines += '<div class="ird-why">' + esc(optionLine(s, o)) + '</div>';
      // The recommended card carries the attributes the derivation matched on.
      // This line is why the separate attributes card is gone, so it has to
      // carry everything that card did: the filter set, the account range and
      // the product ID the network corrected (Part 4.5 + Part 6).
      if (s.recommended) {
        var c = res.ctx;
        var attrs = c.filters.slice();
        attrs.push('Card range ' + c.panRange);
        attrs.push(c.correctedGcms
          ? 'Product ID ' + c.submittedGcms + ' corrected to ' + c.correctedGcms
          : 'Product ID ' + c.submittedGcms + ' (no correction supplied)');
        lines += '<div class="ird-matches">Matches: ' + esc(attrs.join(' · ')) + '</div>';
        lines += '<div class="ird-rec">' + icon('check', 14) + 'Recommended</div>';
      }
    }

    // Fee delta against the recommended option, on every card but that one.
    if (!disabled && o && anchorFee != null && !s.recommended) {
      var delta = o.fee - anchorFee;
      if (s.n === 4) {
        lines += '<div class="ird-delta warn">' + icon('alert-triangle', 14) +
          '<span>' + (delta > 0 ? '+' : '') + esc(R.money(delta, cur)) + ' vs recommended · higher rate</span></div>';
      } else if (delta > 0) {
        lines += '<div class="ird-delta">+' + esc(R.money(delta, cur)) + ' vs recommended</div>';
      } else if (delta < 0) {
        lines += '<div class="ird-delta cheaper">' + esc(R.money(delta, cur)) + ' vs recommended · cheaper</div>';
      } else {
        lines += '<div class="ird-delta">Same fee as recommended</div>';
      }
    }

    return '<div class="' + cls + '"' +
      (disabled ? '' : ' data-action="rej-res-apply" data-n="' + s.n + '" role="radio" tabindex="0" aria-checked="' + (selected ? 'true' : 'false') + '"') +
      (disabled ? ' aria-disabled="true"' : '') + '>' +
      '<div class="ird-card-head">' + head + '</div>' + lines + '</div>';
  }

  /* ---- Attempt history (Part 4) — append-only ---------------------------- */
  function attemptHistory(t, res) {
    var c = res.ctx;
    var staged = F.irdApplied && stagedIrd(t) === F.irdApplied.ird ? F.irdApplied : null;
    var rows = c.log.map(function (r) {
      return '<tr><td class="num">' + r.attempt + '</td>' +
        '<td><span class="mono num rej-opt-ird">' + esc(r.ird) + '</span></td>' +
        '<td>' + esc(r.strategyLabel) + '</td><td>' + esc(r.by) + '</td>' +
        '<td class="num">' + esc(r.at) + '</td>' +
        '<td>' + (r.outcome === 'Rejected' ? pill('Rejected', 'danger', 'x-circle') : pill('Pending', 'warning', 'clock')) + '</td></tr>';
    }).join('');
    if (staged) {
      rows += '<tr class="staged"><td class="num">' + (c.log.length + 1) + '</td>' +
        '<td><span class="mono num rej-opt-ird">' + esc(staged.ird) + '</span></td>' +
        '<td>' + esc(staged.strategy ? R.STRATEGY_NAME[staged.strategy] : 'Manual entry') + '</td>' +
        '<td>' + esc(WHO) + '</td><td class="num">—</td>' +
        '<td>' + pill('Not saved yet', 'neutral', 'edit-3') + '</td></tr>';
    }
    if (!rows) {
      return '<div class="meta">No correction attempt yet. The original submission carried IRD <code class="mono">' +
        esc(c.rejected[0]) + '</code> and was rejected.</div>';
    }
    return '<table class="data rej-attempt-table"><thead><tr>' +
      '<th>Attempt</th><th>IRD applied</th><th>Derived by</th><th>Applied by</th><th>Applied at</th><th>Outcome</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="meta mt-8">Append-only — a correction adds a row, it never rewrites one.</div>';
  }

  function fold(id, action, open, title, sub, body) {
    return '<div class="rej-res-fold' + (open ? ' open' : '') + '">' +
      '<div class="rej-res-fold-head" data-action="' + action + '" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      icon(open ? 'chevron-up' : 'chevron-down', 15) + '<strong>' + esc(title) + '</strong>' +
      (sub ? '<span class="meta">' + esc(sub) + '</span>' : '') + '</div>' +
      (open ? '<div class="rej-res-fold-body">' + body + '</div>' : '') + '</div>';
  }

  /* ---- IRD resolution (Part 4.5) -----------------------------------------
     Four strategies, four cards, one list. The ladder position indicator, the
     separate fee comparison table and the transaction-attributes card are all
     gone: the cards carry rate, fee, delta and the matched attributes inline,
     which is what those three surfaces existed to say. */
  function irdResolutionPanel(t) {
    var res = R.resolveIrd(t);
    if (!res) return '';
    var c = res.ctx;
    var submitted = c.rejected[c.rejected.length - 1];
    var anchorFee = res.recommended && res.recommended.next ? res.recommended.next.fee : null;

    var head = '<div class="ird-head">' +
      '<div class="sp-section-head">Choose a replacement IRD</div>' +
      '<div class="meta">Rejected value: <span class="mono">' + esc(submitted) + '</span>. Four ways to derive a replacement.</div>' +
      '</div>';

    var cards = '<div class="ird-cards" role="radiogroup" aria-label="Replacement IRD">' +
      res.strategies.map(function (s) { return irdOptionCard(t, s, res, anchorFee); }).join('') +
      '</div>';

    var dead = res.dead
      ? '<div class="callout warn">' + icon('alert-triangle', 18) +
      '<div class="callout-body">Every derivation is exhausted or does not apply. Enter the IRD by hand below.</div></div>'
      : '';

    var burnedList = c.rejected.join(', ');
    var manualBody =
      '<div class="rej-ird-manual-row">' +
      '<label class="field">IRD value<input class="input mono w-100" type="text" placeholder="e.g. YB" maxlength="3" ' +
      'value="' + esc(F.irdManual) + '" data-action="rej-i-ird-manual" /></label>' +
      '<label class="field" style="flex:1">Why this value? <span class="req">required</span>' +
      '<input class="input" type="text" placeholder="e.g. Merchant is in the petrol programme, which the account range does not carry — MC interchange manual 2025-Q4 §4.3." ' +
      'value="' + esc(F.irdNote) + '" data-action="rej-i-ird-note" /></label>' +
      '<button class="btn btn-secondary" id="rej-ird-manual-btn" data-action="rej-ird-manual"' +
      (F.irdManual.trim() && F.irdNote.trim() ? '' : ' disabled') + '>' + icon('pencil', 16) + 'Use this IRD</button>' +
      '</div>' +
      '<div class="meta mt-8">Tagged as manually entered, with the note kept in the correction history. ' +
      '<code class="mono">' + esc(burnedList) + '</code> ' + (c.rejected.length > 1 ? 'have' : 'has') +
      ' already been rejected here and cannot be re-entered.</div>';

    return '<div class="rej-res-panel">' + head + dead + cards +
      fold('rej-res-manual', 'rej-res-manual', F.irdManualOpen, 'Enter a different IRD', '', manualBody) +
      (t.attempts > 1
        ? fold('rej-res-history', 'rej-res-history', F.irdHistory, 'Previous attempts', '', attemptHistory(t, res))
        : '') +
      '</div>';
  }

  /* ---- IRD recommendation panel (Part 4) -------------------------------- */
  function irdPanel(t) {
    var rec = R.recommend(t);
    var current = t.fields.ird;
    var confKind = rec.confidence === 'High' ? 'success' : (rec.confidence === 'Medium' ? 'warning' : 'danger');
    var draftIrd = F.draft && F.draft.ird != null ? String(F.draft.ird) : current;

    var attemptedBlock = rec.attempted.length
      ? '<div class="rej-ird-attempted"><span class="rej-ird-sub">Previously attempted</span>' +
      rec.attempted.map(function (code) {
        return '<span class="rej-ird-dead mono" title="Submitted and rejected on an earlier attempt — excluded from the recommendations">' +
          esc(code) + icon('x', 12) + '</span>';
      }).join('') +
      '<span class="meta">Excluded from the ranking below. The engine will not recommend an IRD this transaction has already burned.</span></div>'
      : '';

    var demoted = rec.demoted
      ? '<div class="rej-ird-demoted">' + icon('info', 14) +
      '<span>The engine’s first-choice IRD for these attributes was <code class="mono">' + esc(rec.excluded[0].code) +
      '</code> — already attempted and re-rejected, so it is excluded and the next candidate is promoted below.</span></div>'
      : '';

    var top = rec.top
      ? '<div class="rej-ird-rec">' +
      '<div class="rej-ird-rec-head">' +
      '<span class="rej-ird-label">Recommended</span>' +
      '<span class="ird-code mono">' + esc(rec.top.code) + '</span>' +
      pill(rec.confidence + ' confidence', confKind, rec.confidence === 'High' ? 'check-circle' : 'help-circle') +
      '<button class="btn btn-primary btn-sm" style="margin-left:auto" data-action="rej-ird-apply" data-code="' + esc(rec.top.code) + '"' +
      (draftIrd === rec.top.code ? ' disabled' : '') + '>' +
      icon('check', 14) + (draftIrd === rec.top.code ? 'Applied' : 'Apply') + '</button>' +
      '</div>' +
      '<div class="rej-ird-desc">' + esc(rec.top.desc) + '</div>' +
      (rec.top.why ? '<div class="rej-ird-why">' + icon('corner-down-right', 13) + esc('Ranked here ' + rec.top.why) + '</div>' : '') +
      '<div class="rej-ird-matched"><span class="rej-ird-sub">Matched on</span>' +
      rec.matched.map(function (m) {
        var unknown = m.indexOf('unknown') >= 0;
        return '<span class="rej-ird-chip' + (unknown ? ' unknown' : '') + '">' + esc(m) + '</span>';
      }).join('') + '</div>' +
      (rec.missing.length
        ? '<div class="rej-ird-conf">' + icon('alert-triangle', 13) + '<span>Confidence is ' + rec.confidence.toLowerCase() + ' because ' +
        rec.missing.length + ' attribute' + (rec.missing.length > 1 ? 's are' : ' is') + ' unresolved for this transaction (' +
        esc(rec.missing.join(', ')) + '). Fill the field in above and the ranking sharpens.</span></div>'
        : '') +
      '</div>'
      : '<div class="callout warn">' + icon('alert-triangle', 18) +
      '<div class="callout-body">Every candidate for these attributes has already been attempted and rejected. Derive the IRD by hand against the Mastercard interchange manual and enter it below with a note.</div></div>';

    var alts = rec.alternatives.length
      ? '<div class="rej-ird-alts">' +
      '<div class="rej-ird-sub">Alternatives — what would have to be different</div>' +
      rec.alternatives.map(function (c) {
        return '<div class="rej-ird-alt">' +
          '<span class="ird-code mono">' + esc(c.code) + '</span>' +
          '<div class="rej-ird-alt-body"><div class="rej-ird-alt-why">' + esc(c.why) + '</div>' +
          '<div class="rej-ird-alt-desc">' + esc(c.desc) + '</div></div>' +
          '<button class="btn btn-sm btn-secondary" data-action="rej-ird-apply" data-code="' + esc(c.code) + '"' +
          (draftIrd === c.code ? ' disabled' : '') + '>' + (draftIrd === c.code ? 'Applied' : 'Apply') + '</button>' +
          '</div>';
      }).join('') + '</div>'
      : '';

    var manual = '<div class="rej-ird-manual">' +
      '<div class="rej-ird-sub">Manual entry <span class="meta">— last resort, when every candidate above is wrong</span></div>' +
      '<div class="rej-ird-manual-row">' +
      '<label class="field">IRD value<input class="input mono w-100" type="text" placeholder="e.g. 34" value="' + esc(F.irdManual) + '" data-action="rej-i-ird-manual" /></label>' +
      '<label class="field" style="flex:1">Derivation note <span class="req">required</span>' +
      '<input class="input" type="text" placeholder="e.g. Manual derivation against MC interchange manual 2025-Q4 §4.3 — merchant is in the petrol programme, which the account range does not carry." ' +
      'value="' + esc(F.irdNote) + '" data-action="rej-i-ird-note" /></label>' +
      '<button class="btn btn-secondary" id="rej-ird-manual-btn" data-action="rej-ird-manual"' +
      (F.irdManual.trim() && F.irdNote.trim() ? '' : ' disabled') + '>' + icon('pencil', 15) + 'Use this IRD</button>' +
      '</div></div>';

    return '<div class="rej-ird-panel">' +
      '<div class="rej-ird-head">' + icon('sparkles', 16) + '<strong>IRD recommendation</strong>' +
      '<span class="meta">Derived from this transaction’s attributes. Deterministic — the same transaction always ranks the same way.</span></div>' +
      '<div class="rej-ird-current"><span class="rej-ird-sub">Submitted and rejected</span>' +
      '<span class="ird-code mono rej-ird-bad">' + esc(current) + '</span>' +
      '<span class="meta">' + esc(R.reasonText(t.reasonCode)) + '</span></div>' +
      attemptedBlock + demoted + top + alts + manual +
      '</div>';
  }

  /* Part 4.4 — the fix panel. Eyebrow header, scrolling body, pinned footer
     (Part 2.4). Step 1 is the path choice; everything below it depends on the
     answer, because the answer decides what "below" is. */
  function editorPanel() {
    var t = editingTxn();
    if (!t) return '';
    var b = currentBatch();
    var list = editableList();
    var idx = editIndex();
    var changes = draftChanges(t);
    var raw = R.rawMessage(t);

    /* A transaction already parked on a config change opens straight onto the
       action that unblocks it: "nobody has looked at this" and "this is waiting
       on someone else" are different problems and must not look alike. */
    var awaitingBlock = t.status === 'awaiting_config' && t.configRequest
      ? '<div class="rej-awaiting-box">' + icon('settings', 18) +
      '<div class="rej-awaiting-body">' +
      '<strong>Waiting on a config fix' + (t.configRequest.familyLabel ? ' · ' + esc(t.configRequest.familyLabel) : '') + '</strong>' +
      '<div class="rej-awaiting-note">' + esc(t.configRequest.note) + '</div>' +
      '<div class="meta">Raised by ' + esc(t.configRequest.by) + ' on <span class="num">' + esc(t.configRequest.at) + '</span>.</div></div>' +
      '<div class="rej-awaiting-actions">' +
      '<a class="rej-cfg-link" data-route="' + esc((R.configFamily(t.configRequest.family) || {}).route || '#/dashboard/ops/configs') + '">' +
      'Open Platform Configs' + icon('arrow-right', 15) + '</a>' +
      '<button class="btn btn-primary btn-sm" data-action="rej-rederive" data-id="' + t.id + '">' +
      icon('refresh-cw', 16) + 'Config updated — re-derive</button>' +
      '</div></div>'
      : '';

    var attemptBlock = t.attempts > 1
      ? '<div class="rej-attempt-box">' + icon('rotate-ccw', 16) +
      '<div><strong>Attempt <span class="num">' + t.attempts + '</span></strong> — fixed once already, and rejected again.' +
      '<div class="rej-attempt-log">' + t.attemptLog.map(function (a) {
        return '<div class="rej-attempt-line">Attempt <span class="num">' + a.attempt + '</span> · ' +
          (a.ird ? 'IRD <code class="mono">' + esc(a.ird) + '</code> · ' : '') +
          'fixed <span class="num">' + esc(a.correctedAt) + '</span> by ' + esc(a.by) +
          ' · rejected again <span class="num">' + esc(a.rejectedAt) + '</span></div>';
      }).join('') + '</div></div></div>'
      : '';

    var ctx = '<div class="rej-ctx-grid">' +
      '<div class="ctx-cell"><span class="ctx-label">ARN</span><span class="ctx-value">' + arnCell(t.arn) + '</span></div>' +
      '<div class="ctx-cell"><span class="ctx-label">Merchant</span><span class="ctx-value">' + esc(t.merchant) + '</span><span class="ctx-sub mono">' + esc(t.mid) + '</span></div>' +
      '<div class="ctx-cell"><span class="ctx-label">Amount</span><span class="ctx-value num">' + moneyOf(t) + '</span></div>' +
      '<div class="ctx-cell"><span class="ctx-label">Transaction date</span><span class="ctx-value num">' + U.prettyDate(t.txnDate) + '</span><span class="ctx-sub num">' + esc(t.txnTime) + ' IST</span></div>' +
      '</div>' +
      '<div class="rej-reason-box">' +
      '<strong>' + esc(R.reasonText(t.reasonCode)) + '</strong>' +
      '<span class="mono reason-code">' + esc(t.reasonCode) + '</span>' +
      (R.isIrd(t.reasonCode) ? irdTag() : '') +
      '</div>' +
      (raw ? '<div class="rej-raw"><span class="rej-ird-sub">Network reject message</span><code class="mono">' + esc(raw) + '</code></div>' : '');

    /* The IRD cards and the recommendation panel live inside the data path,
       because applying an IRD is a transaction-data fix. When the fix is to the
       derivation logic itself both are hidden — recommending a value for a
       field you have just said is derived wrongly is the wrong tool. */
    var workspace = '';
    if (F.path === 'data') {
      workspace =
        (ladderOn(t) ? irdResolutionPanel(t) : '') +
        (R.isIrd(t.reasonCode) && !ladderOn(t) ? irdPanel(t) : '') +
        '<div class="sp-section-head">Transaction record</div>' +
        fieldEditor(t) +
        '<div class="sp-section-head">Change summary</div>' +
        '<div id="rej-diff">' + diffBlock(t) + '</div>';
    } else if (F.path === 'config') {
      workspace = configPathPanel(t);
    }

    var historyBlock = t.history.length
      ? '<div class="sp-section-head">Correction history <span class="meta">— append-only</span></div>' +
      '<div class="rej-history">' + t.history.map(function (h) {
        return '<div class="rej-history-entry">' +
          '<div class="rej-history-head"><span class="num">' + esc(h.at) + '</span> · ' + esc(h.by) +
          (h.path ? '<span class="rej-path-tag">' + icon(R.PATHS[h.path] ? R.PATHS[h.path].icon : 'pencil', 11) +
            esc(R.pathLabel(h.path) || h.path) + '</span>' : '') +
          (h.kind === 'config_request' ? pill('waiting on config', 'warning', 'settings') : '') +
          (h.kind === 'rederive' ? pill('re-derived', 'info', 'refresh-cw') : '') +
          (h.kind === 'wont_fix' ? pill("won't fix", 'neutral', 'ban') : '') + '</div>' +
          (h.configFamily ? '<div class="rej-history-fam">' + icon('settings', 11) + esc(h.configFamily) + '</div>' : '') +
          (h.changes && h.changes.length
            ? '<div class="rej-history-changes">' + h.changes.map(function (c) {
              var def = R.FIELDS[c.field] || { label: c.field };
              return '<span>' + esc(def.label) + ': <code class="mono">' + esc(c.from || 'empty') + '</code> → <code class="mono">' + esc(c.to) + '</code></span>';
            }).join('') + '</div>' : '') +
          (h.note ? '<div class="rej-history-note">' + esc(h.note) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>'
      : '';

    var canSave = F.path === 'data' && changes.length > 0;
    var nextTarget = nextUncorrected();

    return sidePanel({
      wide: true, cls: 'rej-panel', close: 'rej-cancel',
      eyebrow: 'Fix reject',
      name: arnCell(t.arn) + '<span class="sp-name-meta">' + esc(t.merchant) + '</span>',
      headExtra: '<div class="rej-panel-nav">' +
        '<span class="meta num">' + (idx + 1) + ' of ' + list.length + '</span>' +
        '<button class="icon-btn" data-action="rej-prev"' + (idx <= 0 ? ' disabled' : '') + ' aria-label="Previous transaction" title="Previous transaction">' + icon('chevron-left', 18) + '</button>' +
        '<button class="icon-btn" data-action="rej-next"' + (idx < 0 || idx >= list.length - 1 ? ' disabled' : '') + ' aria-label="Next transaction" title="Next transaction">' + icon('chevron-right', 18) + '</button>' +
        '</div>',
      body:
        '<div class="rej-panel-status">' + statusPill(t) + manualTag(t.manualTag) +
        '<span class="meta">' + esc(lc(t.status).note) + '</span>' +
        '<span class="meta" style="margin-left:auto">Assigned to ' + (t.assignee ? esc(t.assignee) : '—') + '</span></div>' +
        attemptBlock + ctx + awaitingBlock + pathCards(t) + workspace + historyBlock,
      foot:
        '<button class="btn btn-secondary btn-sm" data-action="rej-wontfix-open">' + icon('ban', 16) + "Mark as won't fix" + '</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary" data-action="rej-cancel">Cancel</button>' +
        (F.path === 'config' ? '' :
          '<button class="btn btn-secondary" id="rej-save-next" data-action="rej-save-next"' + (canSave && nextTarget ? '' : ' disabled') +
          ' title="' + (nextTarget ? 'Save and open the next transaction still to fix' : 'Nothing left to fix in this batch') + '">' +
          'Save and next' + icon('arrow-right', 16) + '</button>' +
          '<button class="btn btn-primary" id="rej-save" data-action="rej-save"' + (canSave ? '' : ' disabled') +
          ' title="' + (F.path ? 'Save the edited fields and mark this transaction fixed' : 'Choose what kind of fix this is first') + '">' +
          icon('save', 16) + 'Save fix</button>')
    });
  }

  function nextUncorrected() {
    var list = editableList(), start = editIndex();
    var openStates = ['new', 'under_correction', 're_rejected'];
    for (var i = start + 1; i < list.length; i++) {
      if (openStates.indexOf(list[i].status) >= 0 && list[i].id !== F.editing) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (j === start) continue;
      if (openStates.indexOf(list[j].status) >= 0 && list[j].id !== F.editing) return list[j];
    }
    return null;
  }

  /* =======================================================================
     Overlays — generation flow, manual overrides, history
     ======================================================================= */
  function modalLayer(b) {
    var m = F.modal;
    if (!m) return '';
    var body = '';
    if (m.kind === 'gen-confirm') body = genConfirmModal(b);
    else if (m.kind === 'gen-running') body = genRunningModal(b);
    else if (m.kind === 'rederive') body = rederiveModal();
    else if (m.kind === 'gen-result') body = genResultModal(b);
    else if (m.kind === 'mark-submitted') body = markSubmittedModal(b);
    else if (m.kind === 'wont-fix') body = wontFixModal();
    else if (m.kind === 'history') body = historyModal();
    else if (m.kind === 'ird-fallback') body = fallbackConfirmModal();
    if (!body) return '';
    var dismissable = m.kind !== 'gen-running';
    return '<div class="overlay on-top"' + (dismissable ? ' data-action="rej-modal-close"' : '') + '>' +
      '<div class="modal rej-modal" onclick="event.stopPropagation()">' + body + '</div></div>';
  }

  /* Strategy 4 confirmation (Part 3.5). The cost is stated in rupees on this
     transaction before anything is populated — a rate percentage alone does not
     read as money. */
  function fallbackConfirmModal() {
    var t = editingTxn(); if (!t) return '';
    var res = R.resolveIrd(t); if (!res || !res.s4.next) return '';
    var s4 = res.s4, o = s4.next, bp = s4.bestPrecise, cur = t.currency;
    return '<div class="modal-head"><div class="section-title">Apply the broader IRD?</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-fallback-warn">' + icon('alert-triangle', 20) +
      '<div><strong>This IRD carries a higher interchange rate — <span class="num">' + esc(R.money(s4.delta, cur)) +
      '</span> more than the best precise candidate on this transaction. Continue?</strong>' +
      '<div class="rr-grid">' +
      '<span>Broader IRD</span><span class="mono num">' + esc(o.ird) + ' · ' + Number(o.rate).toFixed(2) + '% · ' + esc(R.money(o.fee, cur)) + '</span>' +
      '<span>Best precise candidate</span><span class="mono num">' + esc(bp.ird) + ' · ' + Number(bp.rate).toFixed(2) + '% · ' + esc(R.money(bp.fee, cur)) + '</span>' +
      '<span>Difference</span><span class="num rej-res-delta up">+' + esc(R.money(s4.delta, cur)) + '</span>' +
      '<span>Drops filters</span><span>' + esc(res.ctx.broadDropped.join(', ')) + '</span>' +
      '</div></div></div>' +
      '<div class="meta mt-16">Applying still only stages the value — the correction is not committed until you click ' +
      '<strong>Save correction</strong>.</div>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary rej-btn-warn" data-action="rej-res-apply-fallback">' +
      icon('alert-triangle', 15) + 'Apply ' + esc(o.ird) + ' anyway</button></div>';
  }

  /* §C.5 — the confirmation states what the file will contain, in the terms of
     the model that applies. The two are not variations on a theme: one
     supersedes the original file, the other tops it up, and the numbers on
     this screen are the only place that difference is legible before the file
     exists. */
  function genConfirmModal(b) {
    var plan = R.genPlan(b);
    var excluded = R.excludedTxns(b);
    var byReason = {};
    excluded.forEach(function (t) {
      var k = lc(t.status).label;
      byReason[k] = (byReason[k] || 0) + 1;
    });
    var replacement = plan.model.key === 'replacement';

    var ledger = replacement
      ? '<div class="rej-gen-ledger">' +
      '<div class="rej-gen-line"><span>Total transactions in file</span><span class="num">' + num(plan.total) + '</span></div>' +
      '<div class="rej-gen-line"><span>Corrected transactions</span><span class="num">' + plan.corrected + '</span></div>' +
      '<div class="rej-gen-line"><span>Unchanged transactions</span><span class="num">' + num(plan.unchanged) + '</span></div>' +
      '<div class="rej-gen-line total"><span>Total value</span><span class="num">' + fmt(plan.value, 2, b.currency) + '</span></div>' +
      '</div>'
      : '<div class="rej-gen-ledger">' +
      '<div class="rej-gen-line"><span>Corrected transactions to include</span><span class="num">' + plan.corrected + '</span></div>' +
      '<div class="rej-gen-line"><span>Still uncorrected (excluded)</span><span class="num">' + plan.uncorrected + '</span></div>' +
      '<div class="rej-gen-line total"><span>Total value</span><span class="num">' + fmt(plan.value, 2, b.currency) + '</span></div>' +
      '</div>';

    return '<div class="modal-head"><div class="section-title">' + esc(plan.model.action) + '</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-gen-target">' + tenantTag(b.tenantId) + netBadge(b.network) +
      '<span class="meta num">Cycle ' + U.prettyDate(b.cycleDate) + '</span>' +
      '<span class="meta mono">' + esc(R.generatedName(b)) + '</span></div>' +

      '<div class="rej-gen-model rej-model-' + plan.model.key + '">' +
      icon(replacement ? 'files' : 'file-plus', 18) +
      '<div><strong>' + (replacement
        ? 'This will produce a complete replacement clearing file.'
        : 'This will produce a supplementary clearing file containing only corrected rejects.') + '</strong></div>' +
      '<span class="rej-model-tag">' + esc(plan.model.tag) + '</span></div>' +

      ledger +

      '<div class="rej-gen-consequence">' + icon(replacement ? 'alert-triangle' : 'info', 16) +
      '<span>' + (replacement
        ? 'The original file <code class="mono">' + esc(b.clearingFile) + '</code> is superseded. Submit this file in place of the original — do not send both.'
        : 'Transactions that already cleared are not included. This file is submitted alongside the original cycle, not instead of it.') +
      '</span></div>' +

      (excluded.length
        ? '<div class="rej-gen-excluded"><span class="rej-ird-sub">Not in this file</span>' +
        Object.keys(byReason).map(function (k) {
          return '<span class="rej-gen-exc"><span class="num">' + byReason[k] + '</span> ' + esc(k.toLowerCase()) + '</span>';
        }).join('') + '</div>'
        : '') +

      (plan.awaitingConfig
        ? '<div class="callout warn mt-16">' + icon('settings', 18) +
        '<div class="callout-body"><span class="num">' + plan.awaitingConfig + '</span> transaction' +
        (plan.awaitingConfig > 1 ? 's are' : ' is') + ' awaiting a config fix and cannot be included — ' +
        'their values are still wrong at source. Re-derive them once the config lands.</div></div>'
        : '') +
      (plan.uncorrected
        ? '<div class="callout warn mt-16">' + icon('alert-triangle', 18) +
        '<div class="callout-body"><span class="num">' + plan.uncorrected + '</span> transaction' + (plan.uncorrected > 1 ? 's remain' : ' remains') +
        ' uncorrected and will not be corrected in this file. ' + (replacement
          ? 'They go out unchanged and will be refused again.'
          : 'They stay in this batch and can go out in a later retry.') + '</div></div>'
        : '') +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="rej-gen-run"' + (plan.corrected ? '' : ' disabled') + '>' +
      icon('file-plus', 16) + esc(plan.model.action) + '</button></div>';
  }

  function genRunningModal(b) {
    var p = F.modal.pct || 0;
    var replacement = b && R.regenModel(b).key === 'replacement';
    var step = p < 34
      ? (replacement ? 'Reading the original file…' : 'Collecting corrected transactions…')
      : (p < 67
        ? (replacement ? 'Applying corrections in place…' : 'Building clearing records…')
        : 'Writing file and computing checksum…');
    return '<div class="modal-head"><div class="section-title">Generating ' +
      (replacement ? 'replacement' : 'supplementary') + ' clearing file…</div></div>' +
      '<div class="rej-progress-run"><div class="rej-run-bar"><span style="width:' + p + '%"></span></div>' +
      '<div class="meta">' + esc(step) + ' <span class="num">' + p + '%</span></div></div>';
  }

  function genResultModal(b) {
    var g = F.modal.entry;
    var s3 = F.modal.s3 || 'idle';
    var s3Block = s3 === 'running'
      ? '<div class="rej-s3"><div class="rej-run-bar sm"><span style="width:' + (F.modal.s3pct || 0) + '%"></span></div>' +
      '<div class="meta">Uploading to ' + esc(b.s3Prefix) + ' <span class="num">' + (F.modal.s3pct || 0) + '%</span></div></div>'
      : (s3 === 'done'
        ? '<div class="rej-s3 done">' + icon('check-circle', 16) +
        '<div><strong>Pushed to S3.</strong><div class="mono">' + esc(g.s3Path) + '</div>' +
        '<div class="meta">Included transactions moved to Resubmitted — awaiting the network’s next cycle confirmation.</div></div></div>'
        : '');

    var replacement = g.kind === 'replacement';
    return '<div class="modal-head"><div class="section-title">' +
      (replacement ? 'Replacement clearing file generated' : 'Supplementary clearing file generated') + '</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-result">' + icon('check-circle', 20) +
      '<div style="flex:1"><div class="rej-result-name mono">' + esc(g.name) + '</div>' +
      '<div class="rr-grid">' +
      '<span>File type</span><span>' + pill(g.kind === 'replacement' ? 'Replacement' : 'Supplementary',
        g.kind === 'replacement' ? 'danger' : 'info', g.kind === 'replacement' ? 'files' : 'file-plus') + '</span>' +
      '<span>Transactions in file</span><span class="num">' + num(g.count) + '</span>' +
      (replacement
        ? '<span>Corrected in place</span><span class="num">' + (g.corrected || 0) + '</span>' +
        '<span>Unchanged</span><span class="num">' + num(g.unchanged || 0) + '</span>'
        : '') +
      '<span>Total value</span><span class="num">' + fmt(g.value, 2, g.currency) + '</span>' +
      '<span>Generated at</span><span class="num">' + esc(g.at) + '</span>' +
      '<span>Generated by</span><span>' + esc(g.by) + '</span>' +
      '<span>Checksum</span><span class="mono">' + esc(g.checksum) + '</span>' +
      '<span>Retry</span><span class="mono">' + esc((g.name.match(/_(R\d+)(_SUPP)?\.txt$/) || [, '—'])[1]) + '</span>' +
      (g.supersedes ? '<span>Supersedes</span><span class="mono">' + esc(g.supersedes) + '</span>' : '') +
      '</div></div></div>' +
      (replacement
        ? '<div class="rej-gen-consequence mt-16">' + icon('alert-triangle', 16) +
        '<span>This file replaces <code class="mono">' + esc(g.supersedes || b.clearingFile) +
        '</code> in full. Submit it in place of the original — sending both would double-present the cycle.</span></div>'
        : '<div class="rej-gen-consequence mt-16">' + icon('info', 16) +
        '<span>This file carries only the corrected rejects. The rest of the cycle already cleared and is not in it.</span></div>') +
      s3Block +
      '<div class="rej-result-actions">' +
      '<button class="btn btn-secondary" data-action="rej-dl-generated" data-idx="' + (b.generated.length - 1) + '">' + icon('download', 16) + 'Download</button>' +
      '<button class="btn btn-primary" data-action="rej-s3-push"' + (s3 !== 'idle' ? ' disabled' : '') + '>' +
      icon('upload-cloud', 16) + (s3 === 'done' ? 'Pushed to S3' : 'Push to S3') + '</button>' +
      '<button class="btn btn-secondary" data-action="rej-mark-submitted-open"' + (s3 === 'done' ? ' disabled' : '') + '>' +
      icon('hand', 16) + 'Mark as submitted</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-ghost" data-action="rej-modal-close">Done</button>' +
      '</div>' +
      '<div class="meta rej-result-hint">' + icon('info', 13) +
      '<span>Download for manual sharing with the network team; push to S3 for automated pickup. Either way, record the outcome — ' +
      '“Mark as submitted” is the manual path and carries a note plus a <em>manually marked</em> tag on the file history.</span></div>';
  }

  /* Re-derivation is a backend recompute against the activated config version;
     here it is simulated, and then it reports exactly which fields moved — an
     invisible recompute is indistinguishable from one that did nothing. */
  function rederiveModal() {
    var m = F.modal;
    var t = R.txnById[m.txnId];
    if (!t) return '';
    if (m.phase === 'running') {
      var p = m.pct || 0;
      var step = p < 40 ? 'Reading the activated config version…' : (p < 75 ? 'Re-deriving values for this transaction…' : 'Writing the correction…');
      return '<div class="modal-head"><div class="section-title">Re-deriving from the updated config…</div></div>' +
        '<div class="rej-progress-run"><div class="rej-run-bar"><span style="width:' + p + '%"></span></div>' +
        '<div class="meta">' + esc(step) + ' <span class="num">' + p + '%</span></div></div>';
    }
    var changes = m.changes || [];
    return '<div class="modal-head"><div class="section-title">Re-derived</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-reason-box">' + arnCell(t.arn) + '<span class="mono reason-code">' + esc(t.reasonCode) + '</span>' +
      esc(R.reasonText(t.reasonCode)) + statusPill(t, false) + '</div>' +
      '<div class="meta mt-16 mb-16">' + (changes.length
        ? 'The corrected configuration produced ' + changes.length + ' new value' + (changes.length > 1 ? 's' : '') +
        ' for this transaction. It has moved to <strong>Corrected</strong> and now counts towards the next clearing file.'
        : 'The corrected configuration produces the same values for this transaction — nothing on the record changed. ' +
        'It has moved to <strong>Corrected</strong> so it is no longer blocked.') + '</div>' +
      (changes.length
        ? '<div class="rej-diff">' + changes.map(function (c) {
          var def = R.FIELDS[c.field] || { label: c.field };
          return '<div class="rej-diff-row"><span class="rej-diff-field">' + esc(def.label) + '</span>' +
            '<span class="rej-diff-old mono">' + (c.from === '' ? 'empty' : esc(c.from)) + '</span>' + icon('arrow-right', 13) +
            '<span class="rej-diff-new mono">' + esc(c.to) + '</span></div>';
        }).join('') + '</div>'
        : '') +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn btn-primary" data-action="rej-modal-close">Done</button></div>';
  }

  function markSubmittedModal() {
    var note = F.modal.note || '';
    return '<div class="modal-head"><div class="section-title">Mark as submitted</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="meta mb-16">Records that this file was shared with the network out-of-band. The included transactions move to ' +
      '<strong>Resubmitted</strong> and the file history carries a <em>manually marked</em> tag against your name — same pattern as a manual override in Settlement File Monitoring.</div>' +
      '<label class="field">Note <span class="req">required</span>' +
      '<textarea class="input" rows="3" placeholder="e.g. Shared with the Mastercard clearing team over the incident bridge at 14:05 — automated S3 pickup is down for this cycle." ' +
      'data-action="rej-i-ms-note">' + esc(note) + '</textarea></label>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:16px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary" id="rej-ms-confirm" data-action="rej-mark-submitted"' + (note.trim() ? '' : ' disabled') + '>' +
      icon('hand', 16) + 'Mark as submitted</button></div>';
  }

  function wontFixModal() {
    var t = R.txnById[F.modal.txnId];
    var note = F.modal.note || '';
    if (!t) return '';
    return '<div class="modal-head"><div class="section-title">Mark as won’t fix</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-reason-box">' + arnCell(t.arn) + '<span class="mono reason-code">' + esc(t.reasonCode) + '</span>' +
      esc(R.reasonText(t.reasonCode)) + '<span class="meta num">' + moneyOf(t) + '</span></div>' +
      '<div class="meta mt-16 mb-16">For transactions that genuinely cannot be corrected. Moves to a terminal state, drops out of the open count, ' +
      'and carries a <em>manually marked</em> tag against your name. The note is part of the permanent record.</div>' +
      '<label class="field">Why this cannot be corrected <span class="req">required</span>' +
      '<textarea class="input" rows="3" placeholder="e.g. Duplicate presentment — the original cleared in the 18 Nov cycle. Written off against the rejection holdback." ' +
      'data-action="rej-i-wf-note">' + esc(note) + '</textarea></label>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:16px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-danger" id="rej-wf-confirm" data-action="rej-wontfix"' + (note.trim() ? '' : ' disabled') + '>' +
      icon('ban', 16) + "Mark as won't fix" + '</button></div>';
  }

  function historyModal() {
    var t = R.txnById[F.modal.txnId];
    if (!t) return '';
    var entries = t.history.length
      ? t.history.map(function (h) {
        return '<div class="rej-history-entry">' +
          '<div class="rej-history-head"><span class="num">' + esc(h.at) + '</span> · ' + esc(h.by) + '</div>' +
          (h.changes && h.changes.length ? '<div class="rej-history-changes">' + h.changes.map(function (c) {
            var def = R.FIELDS[c.field] || { label: c.field };
            return '<span>' + esc(def.label) + ': <code class="mono">' + esc(c.from || 'empty') + '</code> → <code class="mono">' + esc(c.to) + '</code></span>';
          }).join('') + '</div>' : '') +
          (h.note ? '<div class="rej-history-note">' + esc(h.note) + '</div>' : '') + '</div>';
      }).join('')
      : '<div class="meta">No corrections recorded against this transaction yet.</div>';
    return '<div class="modal-head"><div class="section-title">Correction history</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-reason-box">' + arnCell(t.arn) + esc(t.merchant) + statusPill(t) + '</div>' +
      '<div class="meta mt-16 mb-16">Append-only — every correction records who, when, which fields, and both values.</div>' +
      '<div class="rej-history">' + entries + '</div>';
  }

  /* =======================================================================
     Actions
     ======================================================================= */
  function rerender() { return F.batchId ? viewBatch() : viewOverview(); }

  function openEditor(id, keepOrder) {
    var t = R.txnById[id]; if (!t) return;
    var b = currentBatch();
    if (!keepOrder || !F.navOrder) {
      F.navOrder = b ? visibleTxns(b).map(function (x) { return x.id; }) : [id];
    }
    F.editing = id;
    F.editFrom = t.status;
    F.draft = {};
    R.ALL_FIELDS.forEach(function (k) { F.draft[k] = t.fields[k] == null ? '' : String(t.fields[k]); });
    // §C.6 — the path is declared per transaction, never carried over from the
    // last one. A transaction already parked on a config change reopens on that
    // path with its note intact, because that is the conversation in progress.
    if (t.status === 'awaiting_config' && t.configRequest) {
      F.path = 'config';
      F.cfgNote = t.configRequest.note || '';
      F.cfgFamily = t.configRequest.family || '';
    } else {
      F.path = null; F.cfgNote = ''; F.cfgFamily = '';
    }
    F.irdManual = ''; F.irdNote = '';
    F.irdCards = {}; F.irdHistory = false; F.irdManualOpen = false; F.irdApplied = null;
    // NEW ──edit──▶ UNDER CORRECTION. A re-reject keeps its attempt count, so it
    // still sorts to the top while someone is working it. A transaction awaiting
    // a config fix keeps its state — opening it is not working it.
    if (t.status === 'new' || t.status === 're_rejected') t.status = 'under_correction';
    viewBatch();
  }
  function closeEditor(revert, keepOrder) {
    var t = editingTxn();
    if (t && revert && t.status === 'under_correction' && F.editFrom) t.status = F.editFrom;
    F.editing = null; F.editFrom = null; F.draft = null;
    F.path = null; F.cfgNote = ''; F.cfgFamily = '';
    F.irdManual = ''; F.irdNote = '';
    F.irdCards = {}; F.irdHistory = false; F.irdManualOpen = false; F.irdApplied = null;
    if (!keepOrder) F.navOrder = null;
  }
  function doSave() {
    var t = editingTxn(); if (!t) return false;
    if (F.path !== 'data') { toast('Choose “Update transaction data” to edit fields here', 'info'); return false; }
    var changes = draftChanges(t);
    if (!changes.length) { toast('Change at least one field before saving', 'info'); return false; }
    // A ladder application carries its own generated reasoning note (Part 3.5);
    // it only counts if the draft still holds the IRD that application staged.
    var applied = F.irdApplied && F.draft && String(F.draft.ird) === F.irdApplied.ird ? F.irdApplied : null;
    var note = applied ? applied.note
      : (F.irdNote.trim() ? 'Manual IRD derivation — ' + F.irdNote.trim() : null);
    var at = R.nowStamp();
    var irdChanged = changes.filter(function (c) { return c.field === 'ird'; })[0];
    R.saveCorrection(t, changes, note, WHO, at, 'data');
    // Every committed IRD change on a ladder transaction becomes a row. An
    // analyst who bypassed the ladder and typed into the field directly is
    // still on attempt N — leaving that out would make the history a record of
    // the panel rather than of the transaction.
    if (ladderOn(t) && irdChanged) {
      if (applied) {
        R.logIrdAttempt(t.irdCtx, applied.ird, applied.strategy, WHO, at);
        if (applied.manual) t.manualTag = { label: 'manually entered IRD', by: WHO, at: at };
      } else {
        var row = R.logIrdAttempt(t.irdCtx, irdChanged.to, null, WHO, at);
        row.strategyLabel = 'Direct field edit';
      }
    }
    if (!t.assignee) t.assignee = WHO;
    return true;
  }

  /* ---- Applying a ladder candidate (Part 3.5) ----------------------------
     Applying populates the IRD field below and records the reasoning. It does
     not commit anything — Save correction still has to be clicked. */
  function applyStrategy(n) {
    var t = editingTxn(); if (!t || !F.draft) return;
    var res = R.resolveIrd(t); if (!res) return;
    var s = res.strategies[n - 1];
    if (!s || !s.next) { toast('Strategy ' + n + ' has nothing left to apply', 'info'); return; }
    F.draft.ird = s.next.ird;
    F.irdApplied = { strategy: n, ird: s.next.ird, note: R.irdApplyNote(t, n, s.next), manual: false };
    F.irdManual = ''; F.irdNote = '';
    F.irdCards[n] = true;
    toast('IRD ' + s.next.ird + ' applied via strategy ' + n + ' — Save correction to commit it', 'success');
    viewBatch();
  }
  // Live typing must not re-render the panel (it would drop focus), so only the
  // diff block and the save buttons refresh.
  function refreshDiff() {
    var t = editingTxn(); if (!t) return;
    remount('rej-diff', diffBlock(t));
    var can = draftChanges(t).length > 0;
    var s = el('rej-save'); if (s) s.disabled = !can;
    var sn = el('rej-save-next'); if (sn) sn.disabled = !can || !nextUncorrected();
  }

  function exportCsv(b) {
    var head = ['arn', 'merchant', 'mid', 'amount', 'currency', 'txn_date', 'txn_time', 'reason_code', 'reason', 'ird', 'status', 'attempts', 'assigned_to'];
    var lines = [head.join(',')];
    b.txns.forEach(function (t) {
      lines.push([t.arn, '"' + String(t.merchant).replace(/"/g, '""') + '"', t.mid.replace(/\s/g, ''),
        t.amount.toFixed(2), t.currency, t.txnDate, t.txnTime, t.reasonCode,
      '"' + R.reasonText(t.reasonCode) + '"', t.fields.ird, lc(t.status).label, t.attempts, t.assignee || ''].join(','));
    });
    downloadText(b.id + '_rejects.csv', lines.join('\n'));
  }
  function fileBody(b, g) {
    return '# ' + g.name + '\n# generated ' + g.at + ' by ' + g.by + '\n# checksum ' + g.checksum +
      '\n# ' + b.network + ' · ' + b.tenantName + ' · cycle ' + b.cycleDate + '\n# ' + g.count + ' transaction(s)\n';
  }

  var ACTIONS = {
    /* ---- overview filters ---- */
    'rej-tenant': function (t) {
      var id = t.getAttribute('data-id');
      if (F.tenants[id]) delete F.tenants[id]; else F.tenants[id] = true;
      viewOverview();
    },
    'rej-tenant-all': function () { F.tenants = {}; viewOverview(); },
    'rej-details': function () { F.detailsOpen = !F.detailsOpen; viewBatch(); },
    'rej-clear-q': function () { F.q = ''; viewBatch(); },
    'rej-fgroup': function (t) {
      var g = t.getAttribute('data-group');
      F.fgroups[g] = F.fgroups[g] === false;
      viewBatch();
    },
    'rej-c-network': function (t) { F.network = t.value; viewOverview(); },
    'rej-c-family': function (t) { F.family = t.value; viewOverview(); },
    'rej-c-reason': function (t) { F.reason = t.value; viewOverview(); },
    'rej-date-preset': function (t) { F.dateMode = t.getAttribute('data-mode'); viewOverview(); },
    // The standard filter row drives single-select controls; the multi-tenant
    // chip set is still reachable through the removable chips beneath it.
    'rej-c-tenant-one': function (t) {
      F.tenants = {};
      if (t.value !== 'all') F.tenants[t.value] = true;
      viewOverview();
    },
    'rej-c-preset': function (t) { F.dateMode = t.value; viewOverview(); },
    'rej-clear-network': function () { F.network = 'all'; viewOverview(); },
    'rej-clear-family': function () { F.family = 'all'; viewOverview(); },
    'rej-clear-reason': function () { F.reason = 'all'; viewOverview(); },
    'rej-clear-date': function () { F.dateMode = 'all'; F.dateOn = ''; F.dateFrom = ''; F.dateTo = ''; viewOverview(); },
    'rej-refresh': function () { viewOverview(); toast('Refreshed', 'success'); },
    'rej-i-bq': function (t) {
      F.bq = t.value; viewOverview();
      var i = el('view').querySelector('[data-action="rej-i-bq"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'rej-c-date-on': function (t) { F.dateOn = t.value; viewOverview(); },
    'rej-c-date-from': function (t) { F.dateFrom = t.value; viewOverview(); },
    'rej-c-date-to': function (t) { F.dateTo = t.value; viewOverview(); },
    'rej-reset': function () {
      F.tenants = {}; F.bq = ''; F.network = 'all'; F.family = 'all'; F.reason = 'all';
      F.dateMode = 'all'; F.dateOn = ''; F.dateFrom = ''; F.dateTo = '';
      F.sort = { key: 'default', dir: 'desc' };
      viewOverview();
    },
    'rej-sort': function (t) {
      var k = t.getAttribute('data-key');
      if (F.sort.key === k) F.sort.dir = F.sort.dir === 'asc' ? 'desc' : 'asc';
      else F.sort = { key: k, dir: k === 'cycle' || k === 'received' || k === 'rejects' || k === 'value' || k === 'filetxns' ? 'desc' : 'asc' };
      viewOverview();
    },

    /* ---- batch detail ---- */
    // §C.5 — staging only; the tab does not exist on an incoming batch.
    'rej-tab': function (t) { F.tab = t.getAttribute('data-tab') || 'rejects'; viewBatch(); },
    'rej-txn-sort': function (t) {
      var k = t.getAttribute('data-key');
      if (F.txnSort.key === k) F.txnSort.dir = F.txnSort.dir === 'asc' ? 'desc' : 'asc';
      else F.txnSort = { key: k, dir: k === 'amount' || k === 'date' ? 'desc' : 'asc' };
      viewBatch();
    },
    'rej-i-q': function (t) {
      F.q = t.value;
      var b = currentBatch(); if (b) remount('rej-txn-mount', txnTable(b));
    },
    'rej-c-pick': function (t) {
      var id = t.getAttribute('data-id');
      if (t.checked) F.sel[id] = true; else delete F.sel[id];
      viewBatch();
    },
    'rej-c-pick-all': function (t) {
      var b = currentBatch(); if (!b) return;
      visibleTxns(b).forEach(function (x) { if (t.checked) F.sel[x.id] = true; else delete F.sel[x.id]; });
      viewBatch();
    },
    'rej-clear-sel': function () { F.sel = {}; viewBatch(); },
    'rej-assign-me': function () {
      var b = currentBatch(); if (!b) return;
      var sel = selectedTxns(b);
      sel.forEach(function (t) { t.assignee = WHO; });
      F.sel = {};
      toast(sel.length + ' reject' + (sel.length === 1 ? '' : 's') + ' assigned to you', 'success');
      viewBatch();
    },
    'rej-dl-reject': function () {
      var b = currentBatch(); if (!b) return;
      downloadText(b.rejectFile, '# ' + b.rejectFile + '\n# ' + b.network + ' reject summary · received ' + b.receivedAt +
        '\n# ' + b.txns.length + ' rejected transaction(s)\n');
    },
    'rej-dl-clearing': function () {
      var b = currentBatch(); if (!b) return;
      downloadText(b.clearingFile, '# ' + b.clearingFile + '\n# original clearing file · ' + b.fileTxns + ' transaction(s)\n');
    },
    'rej-dl-generated': function (t) {
      var b = currentBatch(); if (!b) return;
      var g = b.generated[parseInt(t.getAttribute('data-idx'), 10)];
      if (!g) return;
      R.markDownloaded(g);
      downloadText(g.name, fileBody(b, g));
      rerender();
    },
    'rej-export': function () { var b = currentBatch(); if (b) exportCsv(b); },

    /* ---- correction editor ---- */
    'rej-edit': function (t) { openEditor(t.getAttribute('data-id')); },
    'rej-cancel': function () { closeEditor(true); viewBatch(); },
    'rej-prev': function () {
      var list = editableList(), i = editIndex();
      if (i > 0) { closeEditor(true, true); openEditor(list[i - 1].id, true); }
    },
    'rej-next': function () {
      var list = editableList(), i = editIndex();
      if (i >= 0 && i < list.length - 1) { closeEditor(true, true); openEditor(list[i + 1].id, true); }
    },
    /* ---- correction path (§C.6) ---- */
    'rej-path': function (t) {
      var p = t.getAttribute('data-path');
      F.path = (F.path === p) ? null : p;
      viewBatch();
    },
    'rej-i-cfg-note': function (t) {
      F.cfgNote = t.value;
      var b = el('rej-cfg-mark'); if (b) b.disabled = !t.value.trim();
    },
    'rej-c-cfg-family': function (t) { F.cfgFamily = t.value; viewBatch(); },
    'rej-mark-config': function () {
      var t = editingTxn(); if (!t) return;
      if (!F.cfgNote.trim()) { toast('Describe what needs to change — the note is what the config owner works from', 'info'); return; }
      R.markAwaitingConfig(t, F.cfgNote.trim(), F.cfgFamily === 'code' ? null : F.cfgFamily, WHO);
      if (!t.assignee) t.assignee = WHO;
      var arn = t.arn;
      closeEditor(false);
      toast(arn + ' moved to Awaiting config fix — excluded from the regenerate count', 'success');
      viewBatch();
    },
    // Mocked recompute against the corrected config (§C.6). Real re-derivation
    // is a backend job; the progress and the resulting diff are what an analyst
    // needs to see either way.
    'rej-rederive': function (t) {
      var id = t.getAttribute('data-id') || F.editing;
      var txn = R.txnById[id];
      if (!txn) return;
      if (txn.status !== 'awaiting_config') { toast('This transaction is not awaiting a config fix', 'info'); return; }
      if (F.editing) closeEditor(false);
      F.modal = { kind: 'rederive', txnId: id, phase: 'running', pct: 0 };
      viewBatch();
      var ticks = 0;
      var timer = setInterval(function () {
        if (!F.modal || F.modal.kind !== 'rederive' || F.modal.phase !== 'running') { clearInterval(timer); return; }
        ticks++;
        F.modal.pct = Math.min(100, ticks * 10);
        if (F.modal.pct >= 100) {
          clearInterval(timer);
          var changes = R.rederive(txn, WHO);
          F.modal = { kind: 'rederive', txnId: id, phase: 'done', changes: changes };
          toast(txn.arn + ' re-derived — now Corrected', 'success');
        }
        viewBatch();
      }, 150);
    },
    'rej-i-field': function (t) {
      F.draft[t.getAttribute('data-field')] = t.value;
      refreshDiff();
    },
    'rej-c-field': function (t) {
      F.draft[t.getAttribute('data-field')] = t.value;
      viewBatch();
    },
    'rej-save': function () {
      if (!doSave()) return;
      var arn = editingTxn().arn;
      closeEditor(false);
      toast('Correction saved — ' + arn + ' is now Corrected', 'success');
      viewBatch();
    },
    'rej-save-next': function () {
      var nxt = nextUncorrected();
      if (!doSave()) return;
      closeEditor(false, !!nxt);
      if (nxt) { openEditor(nxt.id, true); toast('Saved — next uncorrected transaction loaded', 'success'); }
      else { toast('Saved — no uncorrected transaction left in this batch', 'success'); viewBatch(); }
    },

    /* ---- IRD Resolution ladder ---- */
    'rej-res-manual': function () { F.irdManualOpen = !F.irdManualOpen; viewBatch(); },
    'rej-res-history': function () { F.irdHistory = !F.irdHistory; viewBatch(); },
    'rej-res-apply': function (t) {
      var n = parseInt(t.getAttribute('data-n'), 10);
      var res = R.resolveIrd(editingTxn());
      var s = res && res.strategies[n - 1];
      if (!s || !s.next) { toast('Strategy ' + n + ' has nothing left to apply', 'info'); return; }
      // Strategy 4 trades money for acceptance, so it is never one click away.
      if (n === 4) { F.modal = { kind: 'ird-fallback' }; viewBatch(); return; }
      applyStrategy(n);
    },
    'rej-res-apply-fallback': function () { F.modal = null; applyStrategy(4); },

    /* ---- IRD recommendation panel ---- */
    'rej-ird-apply': function (t) {
      if (!F.draft) return;
      F.draft.ird = t.getAttribute('data-code');
      viewBatch();
    },
    'rej-i-ird-manual': function (t) {
      F.irdManual = t.value;
      var b = el('rej-ird-manual-btn'); if (b) b.disabled = !(F.irdManual.trim() && F.irdNote.trim());
    },
    'rej-i-ird-note': function (t) {
      F.irdNote = t.value;
      var b = el('rej-ird-manual-btn'); if (b) b.disabled = !(F.irdManual.trim() && F.irdNote.trim());
    },
    'rej-ird-manual': function () {
      if (!F.irdManual.trim()) { toast('Enter the IRD value first', 'info'); return; }
      if (!F.irdNote.trim()) { toast('A manual IRD needs a derivation note — it goes into the correction history', 'info'); return; }
      var t = editingTxn();
      var v = F.irdManual.trim();
      if (t && ladderOn(t)) {
        v = v.toUpperCase();
        // The hard rule is about the transaction, not about the ladder: the
        // network already refused this IRD here, so hand-entering it again is a
        // guaranteed re-reject rather than an override worth honouring.
        if (t.irdCtx.rejected.indexOf(v) >= 0) {
          toast(v + ' was already submitted and rejected for this transaction — pick a different IRD', 'info');
          return;
        }
        F.irdApplied = {
          strategy: null, ird: v, manual: true,
          note: 'Manually entered IRD ' + v + ' — ' + F.irdNote.trim()
        };
      }
      F.draft.ird = v;
      toast('Manual IRD ' + v + ' staged — save to record it with your note', 'success');
      viewBatch();
    },

    /* ---- manual overrides ---- */
    'rej-wontfix-open': function () { F.modal = { kind: 'wont-fix', txnId: F.editing, note: '' }; viewBatch(); },
    'rej-i-wf-note': function (t) {
      F.modal.note = t.value;
      var b = el('rej-wf-confirm'); if (b) b.disabled = !t.value.trim();
    },
    'rej-wontfix': function () {
      var t = R.txnById[F.modal.txnId];
      if (!t || !(F.modal.note || '').trim()) { toast('A note is required', 'info'); return; }
      R.markWontFix(t, F.modal.note.trim(), WHO);
      F.modal = null; closeEditor(false);
      toast(t.arn + " marked as won't fix", 'success');
      viewBatch();
    },
    'rej-history': function (t) { F.modal = { kind: 'history', txnId: t.getAttribute('data-id') }; viewBatch(); },
    'rej-modal-close': function () { F.modal = null; viewBatch(); },

    /* ---- generate corrected clearing file ---- */
    'rej-gen-open': function () {
      var b = currentBatch(); if (!b) return;
      if (!R.correctedTxns(b).length) { toast('Correct at least one transaction first', 'info'); return; }
      closeEditor(true);
      F.modal = { kind: 'gen-confirm' };
      viewBatch();
    },
    'rej-gen-run': function () {
      var b = currentBatch(); if (!b) return;
      F.modal = { kind: 'gen-running', pct: 0 };
      viewBatch();
      // 2-3 seconds of simulated work — real generation is a backend job.
      var ticks = 0;
      var timer = setInterval(function () {
        if (!F.modal || F.modal.kind !== 'gen-running') { clearInterval(timer); return; }
        ticks++;
        F.modal.pct = Math.min(100, ticks * 8);
        if (F.modal.pct >= 100) {
          clearInterval(timer);
          var entry = R.generateFile(b, WHO);
          F.modal = { kind: 'gen-result', entry: entry, s3: 'idle' };
        }
        viewBatch();
      }, 200);
    },
    'rej-s3-push': function () {
      var b = currentBatch(); if (!b || !F.modal || F.modal.kind !== 'gen-result') return;
      F.modal.s3 = 'running'; F.modal.s3pct = 0;
      viewBatch();
      var ticks = 0;
      var timer = setInterval(function () {
        if (!F.modal || F.modal.kind !== 'gen-result' || F.modal.s3 !== 'running') { clearInterval(timer); return; }
        ticks++;
        F.modal.s3pct = Math.min(100, ticks * 12);
        if (F.modal.s3pct >= 100) {
          clearInterval(timer);
          R.markDelivered(b, F.modal.entry, 's3');
          F.modal.s3 = 'done';
          toast('Pushed to S3 — transactions moved to Resubmitted', 'success');
        }
        viewBatch();
      }, 150);
    },
    'rej-mark-submitted-open': function () {
      if (!F.modal || F.modal.kind !== 'gen-result') return;
      F.modal = { kind: 'mark-submitted', entry: F.modal.entry, note: '' };
      viewBatch();
    },
    'rej-i-ms-note': function (t) {
      F.modal.note = t.value;
      var b = el('rej-ms-confirm'); if (b) b.disabled = !t.value.trim();
    },
    'rej-mark-submitted': function () {
      var b = currentBatch(); if (!b || !F.modal) return;
      if (!(F.modal.note || '').trim()) { toast('A note is required for a manual submission', 'info'); return; }
      R.markDelivered(b, F.modal.entry, 'manual', F.modal.note.trim(), WHO);
      F.modal = null;
      toast('Marked as submitted — transactions moved to Resubmitted', 'success');
      viewBatch();
    }
  };

  /* =======================================================================
     Route
     ======================================================================= */
  /* Deep links into Rejects carry their filters in the hash — Reconciliation's
     "View rejections →" arrives pre-filtered to one tenant, one cycle date and
     the incoming family (§B.1). Applied before the first render so the analyst
     never sees the unfiltered list flash past. */
  function applyQuery(q) {
    if (!q) return;
    if (q.rejTenant) {
      F.tenants = {};
      String(q.rejTenant).split(',').forEach(function (id) { if (id) F.tenants[id] = true; });
    }
    if (q.rejFamily) F.family = q.rejFamily;
    if (q.rejNetwork) F.network = q.rejNetwork;
    if (q.rejReason) F.reason = q.rejReason;
    if (q.rejDate) { F.dateMode = 'on'; F.dateOn = q.rejDate; }
  }

  function route(rest) {
    F.modal = null;
    var id = (rest && rest.length) ? rest[0] : null;
    if (id !== F.batchId) { closeEditor(false); F.sel = {}; F.q = ''; F.tab = 'rejects'; F.txnSort = { key: 'status', dir: 'asc' }; }
    F.batchId = id;
    applyQuery(S.query);
    return id ? viewBatch() : viewOverview();
  }

  return { route: route, actions: ACTIONS, ROUTE: ROUTE };
};
