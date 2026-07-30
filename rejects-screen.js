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
    // Part 3.5 — which fields have been blurred (validation paints on blur),
    // Part 7.2 — read-back mode, Part 2.2 — one-shot reveal transition.
    touched: {}, readback: false, pathAnim: false,
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
        // Part 6.3 — a fixed transaction's action reads View, reopening the
        // panel in its read-back state.
        '<button class="rej-fix-link" data-action="rej-edit" data-id="' + t.id + '">' +
        (['corrected', 'regenerated', 'resubmitted', 'cleared', 'wont_fix'].indexOf(t.status) >= 0 ? 'View' : 'Fix') +
        icon('arrow-right', 15) + '</button>' +
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
        ? (corrected ? pill('Fixed in place', 'success', 'check') : pill(d.label, d.kind, d.icon))
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
        (kind === 'replacement' ? '<div class="cell-sub num">' + (g.corrected || 0) + ' fixed</div>' : '') + '</td>' +
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
      /* Part 6.4 — the generate action carries a live count chip and is
         disabled while zero transactions are fixed. Awaiting config fix and
         won't fix never count. */
      '<button class="btn btn-primary" data-action="rej-gen-open"' + (corrected.length ? '' : ' disabled') +
      ' title="' + (corrected.length
        ? (model.key === 'replacement'
          ? 'Generate a complete replacement file — all ' + num(b.fileTxns) + ' transactions, with ' + corrected.length + ' fix(es) applied in place'
          : 'Generate a supplementary file containing the ' + corrected.length + ' fixed reject(s)')
        : 'Fix at least one transaction first') + '">' +
      icon('file-plus', 18) + esc(model.action) +
      (corrected.length ? ' <span class="rej-count-chip num">' + corrected.length + ' fixed</span>' : '') + '</button>');

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
  function draftVal(t, key) {
    return F.draft && F.draft[key] != null ? String(F.draft[key]) : (t.fields[key] == null ? '' : String(t.fields[key]));
  }
  function draftChanges(t) {
    if (!F.draft) return [];
    return Object.keys(F.draft).filter(function (k) {
      if ((R.FIELDS[k] || {}).readOnly) return false;
      return String(F.draft[k]) !== String(t.fields[k] == null ? '' : t.fields[k]);
    }).map(function (k) {
      return { field: k, from: t.fields[k] == null ? '' : String(t.fields[k]), to: String(F.draft[k]) };
    });
  }

  /* Part 3.5 — validation. Runs on blur and on save attempt; errors gate the
     save whether or not they are painted yet. */
  function fieldError(t, key) {
    var def = R.FIELDS[key] || {};
    if (def.readOnly) return null;
    return R.validateField(key, draftVal(t, key));
  }
  function editorErrors(t) {
    var out = {};
    R.fieldsForTxn(t).forEach(function (k) {
      var e = fieldError(t, k);
      if (e) out[k] = e;
    });
    return out;
  }

  /* Part 3 — one field row. The Changed chip and primary left border are
     driven by the .changed class so live typing can toggle them without a
     re-render; the error line fills on blur or on a save attempt. */
  function fieldInput(t, key) {
    var def = R.FIELDS[key] || { label: key };
    var val = draftVal(t, key);
    var cls = 'input' + (def.mono ? ' mono' : '') + (def.num ? ' num' : '');
    if (def.readOnly) {
      return '<input class="' + cls + '" type="text" value="' + esc(val) + '" disabled aria-label="' + esc(def.label) + '" />';
    }
    if (def.type === 'select') {
      return '<select class="' + cls + '" data-action="rej-c-field" data-field="' + key + '" aria-label="' + esc(def.label) + '">' +
        def.options.map(function (o) {
          var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(v) + '"' + (val === v ? ' selected' : '') + '>' + esc(l) + '</option>';
        }).join('') + '</select>';
    }
    return '<input class="' + cls + '" type="text" value="' + esc(val) + '" ' +
      'data-action="rej-i-field" data-field="' + key + '" aria-label="' + esc(def.label) + '" />';
  }
  function fieldRow(t, key, inFlag) {
    var def = R.FIELDS[key] || { label: key };
    var cur = t.fields[key] == null ? '' : String(t.fields[key]);
    var val = draftVal(t, key);
    var changed = !def.readOnly && val !== cur;
    var err = F.touched[key] ? fieldError(t, key) : null;
    var help = inFlag ? (def.flagHelp || def.help || '') : (def.help || '');
    return '<div class="rjf' + (changed ? ' changed' : '') + (err ? ' invalid' : '') + (inFlag ? ' rjf-flag' : '') + '" data-fieldwrap="' + key + '">' +
      '<div class="rjf-label">' + esc(def.label) +
      '<span class="rjf-chip">Changed</span>' +
      (def.readOnly ? '<span class="rjf-ro">' + icon('lock', 11) + 'Read-only</span>' : '') + '</div>' +
      fieldInput(t, key) +
      (help ? '<div class="rjf-help">' + esc(help) + '</div>' : '') +
      '<div class="rjf-err" data-errfor="' + key + '">' + (err ? esc(err) : '') + '</div>' +
      '</div>';
  }

  /* Part 3.1 — the flagged field leads, lifted out of its group into its own
     warning-tinted block so the user sees immediately what the network
     objected to. When the IRD chooser is on, the IRD's plain input is replaced
     by a read-only row reflecting what the chooser has staged. */
  function irdFlagRow(t) {
    var def = R.FIELDS.ird;
    var cur = String(t.fields.ird || '');
    var val = draftVal(t, 'ird');
    var changed = val !== cur;
    return '<div class="rjf rjf-flag' + (changed ? ' changed' : '') + '">' +
      '<div class="rjf-label">' + esc(def.label) + '<span class="rjf-chip">Changed</span></div>' +
      '<div class="rjf-ird-stage mono num">' + (changed
        ? '<span class="rjf-ird-old">' + esc(cur) + '</span>' + icon('arrow-right', 14) + '<span class="rjf-ird-new">' + esc(val) + '</span>'
        : esc(cur)) + '</div>' +
      '<div class="rjf-help">' + (changed
        ? 'Staged from the chooser above. Nothing is saved until you click Save fix.'
        : 'Pick a replacement from the chooser above — it fills this field.') + '</div>' +
      '</div>';
  }
  function flaggedBlock(t, flagged, chooserOn) {
    if (!flagged.length) return '';
    return '<div class="rej-flag-block">' +
      '<div class="rej-flag-eyebrow"><span class="rej-flag-dot" aria-hidden="true"></span>Flagged by the reject</div>' +
      flagged.map(function (k) {
        if (k === 'ird' && chooserOn) return irdFlagRow(t);
        return fieldRow(t, k, true);
      }).join('') + '</div>';
  }

  // Part 3.3 — collapsed by default; a group holding a flagged field starts
  // expanded (its flagged field itself already lifted above).
  function groupOpen(name, flagged) {
    if (F.fgroups[name] != null) return F.fgroups[name];
    return flagged.some(function (k) { return (R.FIELDS[k] || {}).group === name; });
  }

  function fieldEditor(t) {
    var flagged = R.flaggedFields(t);
    var chooserOn = ladderOn(t);
    var present = R.fieldsForTxn(t);
    var out = flaggedBlock(t, flagged, chooserOn);
    out += R.groupedFields().map(function (g) {
      var keys = g.fields.filter(function (k) { return flagged.indexOf(k) < 0 && present.indexOf(k) >= 0; });
      if (!keys.length) return '';
      var open = groupOpen(g.group, flagged);
      return '<div class="rej-fgroup' + (open ? ' open' : '') + '">' +
        '<button class="rej-fgroup-head" data-action="rej-fgroup" data-group="' + esc(g.group) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        icon(open ? 'chevron-down' : 'chevron-right', 15) +
        '<span class="rej-fgroup-name">' + esc(g.group) + '</span>' +
        '<span class="rej-fgroup-count num">(' + keys.length + ')</span></button>' +
        (open ? '<div class="rej-fgroup-body">' + keys.map(function (k) { return fieldRow(t, k, false); }).join('') + '</div>' : '') +
        '</div>';
    }).join('');
    return '<div class="rej-field-groups">' + out + '</div>';
  }

  /* ---- Part 5 · Path B — config handoff ----------------------------------
     One required question, an optional destination, and a link that carries
     the reject's context to Platform Configs. The panel state survives the
     round trip: navigating away does not close the editor, so returning to
     this batch reopens it exactly as left. Saving is the footer's job — the
     primary button relabels to "Mark as waiting on config". */
  function cfgContextRoute(t) {
    var fam = R.configFamily(F.cfgFamily || (t.configRequest && t.configRequest.family));
    var base = fam ? fam.route : '#/dashboard/ops/configs';
    return base + '?rejFrom=' + t.id + '&rejReason=' + t.reasonCode + '&rejBatch=' + t.batchId;
  }
  function configPathPanel(t) {
    // A transaction already parked on a config fix reads back: the saved note
    // shown read-only, with re-derive waiting in the footer (Part 5).
    if (t.status === 'awaiting_config' && t.configRequest) {
      return '<div class="rej-cfg-panel">' +
        '<div class="rej-awaiting-box">' + icon('clock', 18) +
        '<div class="rej-awaiting-body">' +
        '<strong>Waiting on a config fix' + (t.configRequest.familyLabel ? ' · ' + esc(t.configRequest.familyLabel) : '') + '</strong>' +
        '<div class="rej-awaiting-note">' + esc(t.configRequest.note) + '</div>' +
        '<div class="meta">Raised by ' + esc(t.configRequest.by) + ' on <span class="num">' + esc(t.configRequest.at) + '</span>.</div>' +
        '</div></div>' +
        '<div class="rej-cfg-row">' +
        '<span class="meta">Once the config change has landed, re-derive this transaction from it below.</span>' +
        '<a class="rej-cfg-link" data-route="' + cfgContextRoute(t) + '">Open Platform Configs' + icon('arrow-right', 15) + '</a>' +
        '</div></div>';
    }
    var famOpts = [['network', 'Network files'], ['incoming', 'Incoming files'], ['settlement', 'Settlement reports'], ['', 'Not sure']];
    return '<div class="rej-cfg-panel">' +
      '<label class="field rej-cfg-note">What needs to change? <span class="req">required</span>' +
      '<textarea class="input" rows="3" data-action="rej-i-cfg-note" ' +
      'placeholder="e.g. The MCC mapping for this acquirer BIN still points at the 2024 ISO 18245 table — 5732 is being emitted as 9732.">' +
      esc(F.cfgNote) + '</textarea></label>' +
      '<div class="rej-cfg-row">' +
      '<label class="field inline">Where does the fix belong? <span class="meta">optional</span>' +
      '<select class="input w-260" data-action="rej-c-cfg-family">' +
      famOpts.map(function (o) {
        return '<option value="' + o[0] + '"' + (F.cfgFamily === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') +
      '</select></label>' +
      '<a class="rej-cfg-link" data-route="' + cfgContextRoute(t) + '">Open Platform Configs' + icon('arrow-right', 15) + '</a>' +
      '</div></div>';
  }

  /* Part 2 — what kind of fix is this? A real radio group: the whole card is
     the hit target, exactly one selected, arrow keys move between options.
     In read-back the chosen path stays visible but locked. */
  function pathCards(t, locked) {
    var cards = ['data', 'config'].map(function (k) {
      var p = R.PATHS[k];
      var on = F.path === k;
      return '<button class="rej-path-card' + (on ? ' on' : '') + (locked ? ' locked' : '') + '"' +
        (locked ? ' disabled' : ' data-action="rej-path" data-path="' + k + '"') +
        ' role="radio" aria-checked="' + (on ? 'true' : 'false') + '"' +
        (on || (k === 'data' && !F.path) ? '' : ' tabindex="-1"') + '>' +
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

  /* Part 3.4 — the Changes summary. Sits directly above the footer, sticks to
     the bottom of the scroll area, and disappears entirely when clean. */
  function changesBlock(t) {
    var changes = draftChanges(t);
    if (!changes.length) return '';
    return '<div class="rej-changes">' +
      '<div class="rej-changes-head"><strong>Changes (<span class="num">' + changes.length + '</span>)</strong>' +
      '<button class="rej-reset-link" data-action="rej-reset-changes">Reset all changes</button></div>' +
      diffBlock(t) + '</div>';
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
  // Why a card cannot be used here, in one line and in plain language (4.4).
  function unavailableLine(s) {
    if (s.n === 1) return 'Not available — the reject file didn’t include a corrected product ID';
    if (s.n === 2) return 'Not available — this card range has only one product ID';
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

  /* ---- The four option cards (Part 4.2–4.4) -------------------------------
     All four render simultaneously, selectable by radio. No accordion, no
     progressive reveal, no ladder. Unavailable and already-tried cards still
     render — greyed, disabled, each with a one-line reason. Never hide a card.
     The already-rejected exclusion was applied globally in resolveIrd, after
     all four strategies computed, so a burned IRD is unpickable on every card
     no matter which derivation produced it. */
  function irdOptionCard(t, s, res, anchor) {
    var cur = t.currency;
    var staged = stagedIrd(t);
    var c = res.ctx;

    // What this card offers: the untried option if there is one, otherwise the
    // one that was tried, so an exhausted strategy still shows its value.
    var o = s.next || s.options[0] || null;
    var disabled = false, tried = false, reason = '';
    if (!s.available) { disabled = true; reason = unavailableLine(s); o = null; }
    else if (!s.next) {
      disabled = true; tried = true;
      var att = o ? triedOnAttempt(res, o.ird) : null;
      reason = 'Already tried — rejected' + (att ? ' on attempt ' + att : '');
    }

    var selected = !disabled && o && staged === o.ird;
    var cls = 'ird-card' + (disabled ? ' disabled' : '') + (tried ? ' tried' : '') +
      (selected ? ' selected' : '') + (s.n === 4 ? ' fallback' : '');

    // Value row: the IRD is the largest element; rate and fee right-aligned.
    var head = '<span class="ird-radio">' + icon(selected ? 'circle-dot' : 'circle', 20) + '</span>' +
      '<span class="ird-value mono">' + esc(o ? o.ird : '—') + '</span>' +
      '<span class="ird-nums">' +
      (o ? '<span class="num ird-rate">' + Number(o.rate).toFixed(2) + '%</span>' +
        '<span class="num ird-fee">' + esc(R.money(o.fee, cur)) + '</span>' : '') +
      '</span>';

    var lines = '';
    if (disabled && !tried) {
      lines += '<div class="ird-why muted">' + esc(reason) + '</div>';
    } else if (tried) {
      lines += '<div class="ird-why muted">' + esc(reason) + '</div>';
    } else {
      lines += '<div class="ird-why">' + esc(optionLine(s, o)) + '</div>';
      // Detail line: matched attributes on card 1, product ID on card 2, the
      // filter set's provenance on card 3 (Part 4.2).
      if (s.n === 1) {
        var attrs = c.filters.slice();
        lines += '<div class="ird-matches">Matches: ' + esc(attrs.join(' · ')) + '</div>';
      } else if (s.n === 2 && o.gcms) {
        lines += '<div class="ird-matches">Product ID ' + esc(o.gcms) + ' · account range ' + esc(c.panRange) + '</div>';
      } else if (s.n === 3) {
        lines += '<div class="ird-matches">Same filter set as the rejected derivation</div>';
      }
      // Marker line: ✓ Recommended on card 1 when it is usable (Part 4.2).
      if (s.n === 1) {
        lines += '<div class="ird-rec">' + icon('check', 14) + 'Recommended</div>';
      }
    }

    // Fee delta on cards 2–4, against the anchor (card 1 when usable,
    // otherwise the best precise candidate).
    if (!disabled && o && anchor && s.n !== 1 && o.ird !== anchor.ird) {
      var delta = o.fee - anchor.fee;
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
      icon(open ? 'chevron-down' : 'chevron-right', 15) + '<strong>' + esc(title) + '</strong>' +
      (sub ? '<span class="meta">' + esc(sub) + '</span>' : '') + '</div>' +
      (open ? '<div class="rej-res-fold-body">' + body + '</div>' : '') + '</div>';
  }

  /* ---- Part 4 · the IRD chooser -------------------------------------------
     Sits at the top of the Path A editor, above the flagged-field block, and
     replaces the plain IRD input. Four cards, all visible; manual entry and
     previous attempts collapsed beneath. */
  function irdResolutionPanel(t) {
    var res = R.resolveIrd(t);
    if (!res) return '';
    var c = res.ctx;
    var submitted = c.rejected[c.rejected.length - 1];
    // Deltas anchor on card 1 when it is usable — that is the card carrying
    // the Recommended marker — falling back to the best precise candidate.
    var s1 = res.strategies[0];
    var anchor = (s1.available && s1.next) ? s1.next : res.bestPrecise;

    var head = '<div class="ird-head">' +
      '<div class="sp-section-head">Choose a replacement IRD</div>' +
      '<div class="meta">Rejected value: <span class="mono">' + esc(submitted) + '</span>. Four ways to derive a replacement.</div>' +
      '</div>';

    var cards = '<div class="ird-cards" role="radiogroup" aria-label="Replacement IRD">' +
      res.strategies.map(function (s) { return irdOptionCard(t, s, res, anchor); }).join('') +
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
      '<label class="field" style="flex:1">How did you derive this? <span class="req">required</span>' +
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
        ? fold('rej-res-history', 'rej-res-history', F.irdHistory, 'Previous attempts (' + c.log.length + ')', '', attemptHistory(t, res))
        : '') +
      '</div>';
  }

  /* Part 2/6/7 — the fix panel. Eyebrow header, scrolling body, pinned footer.
     Step 1 is the path choice; everything below it depends on the answer,
     because the answer decides what "below" is. Three shapes:
       edit       — the working panel (Part 2–5)
       awaiting   — Path B locked read-back with re-derive in the footer
       read-back  — an already-fixed transaction, changes shown, Reopen only */
  function editorPanel() {
    var t = editingTxn();
    if (!t) return '';
    var b = currentBatch();
    var list = editableList();
    var idx = editIndex();
    var changes = draftChanges(t);
    var raw = R.rawMessage(t);
    var awaiting = t.status === 'awaiting_config';

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

    /* Part 2.2 — selection reveals the matching workflow directly beneath the
       cards. The reveal wrapper carries a one-shot slide-and-fade; it replays
       only when the selection itself changes, not on every re-render. */
    var anim = F.pathAnim ? ' anim' : '';
    var workspace = '';
    if (F.readback) {
      workspace = '<div class="rej-reveal">' + readBackBlock(t) + '</div>';
    } else if (F.path === 'data') {
      workspace = '<div class="rej-reveal' + anim + '">' +
        (ladderOn(t) ? irdResolutionPanel(t) : '') +
        '<div class="sp-section-head">Transaction record</div>' +
        fieldEditor(t) + '</div>';
    } else if (F.path === 'config') {
      workspace = '<div class="rej-reveal' + anim + '">' + configPathPanel(t) + '</div>';
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

    /* Part 6.1 — the footer. Save fix and Save and next are one gate: nothing
       is enabled until a fix type is chosen, and each path then supplies its
       own condition and its own tooltip. */
    var st = saveState(t);
    var foot;
    if (F.readback) {
      foot = '<span style="flex:1"></span>' +
        '<button class="btn btn-primary" data-action="rej-reopen">' + icon('pencil', 16) + 'Reopen for editing</button>';
    } else if (awaiting) {
      foot = '<button class="btn btn-secondary btn-sm" data-action="rej-wontfix-open">' + icon('ban', 16) + "Mark as won't fix" + '</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary" data-action="rej-cancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="rej-rederive" data-id="' + t.id + '" ' +
        'title="Recompute this transaction from the corrected config">' +
        icon('refresh-cw', 16) + 'Config updated — re-derive</button>';
    } else {
      foot = '<button class="btn btn-secondary btn-sm" data-action="rej-wontfix-open">' + icon('ban', 16) + "Mark as won't fix" + '</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary" data-action="rej-cancel">Cancel</button>' +
        '<button class="btn btn-secondary" id="rej-save-next" data-action="rej-save-next"' + (st.canSave && st.next ? '' : ' disabled') +
        ' title="' + esc(st.nextTitle) + '">Save and next' + icon('arrow-right', 16) + '</button>' +
        '<button class="btn btn-primary" id="rej-save" data-action="rej-save"' + (st.canSave ? '' : ' disabled') +
        ' title="' + esc(st.saveTitle) + '">' + icon(F.path === 'config' ? 'settings' : 'save', 16) + esc(st.saveLabel) + '</button>';
    }

    return sidePanel({
      wide: true, cls: 'rej-panel', close: 'rej-cancel',
      eyebrow: F.readback ? 'View fix' : 'Fix reject',
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
        attemptBlock + ctx + pathCards(t, F.readback || awaiting) + workspace + historyBlock +
        (!F.readback && !awaiting && F.path === 'data'
          ? '<div id="rej-diff" class="rej-changes-mount">' + changesBlock(t) + '</div>' : ''),
      foot: foot
    });
  }

  /* What the footer's save buttons may do right now, and why not (Part 2.2,
     3.5, 5, 6.1) — one computation shared by the render and the live refresh. */
  function saveState(t) {
    var next = nextUncorrected();
    var out = { next: next };
    if (F.readback || t.status === 'awaiting_config') {
      out.canSave = false; out.saveLabel = 'Save fix'; out.saveTitle = ''; out.nextTitle = '';
      return out;
    }
    if (!F.path) {
      out.canSave = false; out.saveLabel = 'Save fix';
      out.saveTitle = 'Choose a fix type first';
      out.nextTitle = 'Choose a fix type first';
      return out;
    }
    if (F.path === 'data') {
      var changes = draftChanges(t);
      var errCount = Object.keys(editorErrors(t)).length;
      out.canSave = changes.length > 0 && !errCount;
      out.saveLabel = 'Save fix';
      out.saveTitle = !changes.length ? 'Change at least one value to save'
        : (errCount ? 'Fix the errors above to save' : 'Save the fix and mark this transaction Fixed');
    } else {
      out.canSave = !!F.cfgNote.trim();
      out.saveLabel = 'Mark as waiting on config';
      out.saveTitle = out.canSave
        ? 'Record the request and move this transaction to Awaiting config fix'
        : 'Describe what needs to change first';
    }
    out.nextTitle = !next ? 'No more transactions to fix'
      : (out.canSave ? 'Save, then load the next unfixed transaction without closing the panel' : out.saveTitle);
    return out;
  }

  /* Part 7.2 — read-back for an already-fixed transaction: the changed fields
     with old and new values, the correction note, and who saved it when. */
  function readBackBlock(t) {
    var h = null;
    for (var i = t.history.length - 1; i >= 0; i--) {
      if (['correction', 'rederive', 'wont_fix', 'config_request'].indexOf(t.history[i].kind) >= 0) { h = t.history[i]; break; }
    }
    if (!h) return '<div class="meta">No recorded correction on this transaction.</div>';
    var rows = (h.changes || []).map(function (c) {
      var def = R.FIELDS[c.field] || { label: c.field };
      return '<div class="rej-diff-row"><span class="rej-diff-field">' + esc(def.label) + '</span>' +
        '<span class="rej-diff-old mono">' + (c.from === '' ? 'empty' : esc(c.from)) + '</span>' +
        icon('arrow-right', 13) +
        '<span class="rej-diff-new mono">' + (c.to === '' ? 'empty' : esc(c.to)) + '</span></div>';
    }).join('');
    return '<div class="sp-section-head">What was changed</div>' +
      '<div class="rej-readback">' +
      (rows ? '<div class="rej-diff">' + rows + '</div>'
        : '<div class="meta">' + (t.status === 'wont_fix'
          ? 'Marked as won’t fix — no field was changed.'
          : 'No field values changed.') + '</div>') +
      (h.note ? '<div class="rej-history-note">' + esc(h.note) + '</div>' : '') +
      '<div class="meta mt-8">Saved by ' + esc(h.by) + ' on <span class="num">' + esc(h.at) + '</span>.</div>' +
      '</div>';
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
    else if (m.kind === 'discard') body = discardModal();
    else if (m.kind === 'navsave') body = navSaveModal();
    if (!body) return '';
    // No stopPropagation on the modal — the delegated click listener needs
    // inner clicks to bubble; it refuses to resolve them to the backdrop.
    var dismissable = m.kind !== 'gen-running';
    return '<div class="overlay on-top"' + (dismissable ? ' data-action="rej-modal-close"' : '') + '>' +
      '<div class="modal rej-modal">' + body + '</div></div>';
  }

  /* Part 4.3 — the card 4 confirmation. The cost is stated in rupees on this
     transaction before anything is populated — a rate percentage alone does
     not read as money. */
  function fallbackConfirmModal() {
    var t = editingTxn(); if (!t) return '';
    var res = R.resolveIrd(t); if (!res || !res.s4.next) return '';
    var s4 = res.s4, o = s4.next, bp = s4.bestPrecise, cur = t.currency;
    return '<div class="modal-head"><div class="section-title">This IRD has a higher rate</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="meta mb-16"><span class="mono">' + esc(o.ird) + '</span> charges <span class="num">' + Number(o.rate).toFixed(2) +
      '%</span> instead of <span class="num">' + Number(bp.rate).toFixed(2) + '%</span> — <strong class="num">' +
      esc(R.money(s4.delta, cur)) + '</strong> more on this transaction. It’s more likely to be accepted because it matches on fewer conditions.</div>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="rej-res-apply-fallback">Use this IRD</button></div>';
  }

  /* Part 6.1 — Cancel with unsaved changes. */
  function discardModal() {
    var t = editingTxn(); if (!t) return '';
    var n = F.path === 'data' ? draftChanges(t).length : 0;
    return '<div class="modal-head"><div class="section-title">Discard your changes?</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="meta mb-16">' + (n
        ? '<span class="num">' + n + '</span> field' + (n === 1 ? '' : 's') + ' ' + (n === 1 ? 'has' : 'have') + ' been edited but not saved.'
        : 'Your note has not been saved.') + ' Closing now throws that away.</div>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:16px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Keep editing</button>' +
      '<button class="btn btn-danger" data-action="rej-discard">Discard</button></div>';
  }

  /* Part 7.1 — prev/next with unsaved changes. */
  function navSaveModal() {
    var t = editingTxn(); if (!t) return '';
    var st = saveState(t);
    return '<div class="modal-head"><div class="section-title">Save your changes before moving on?</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="meta mb-16">This transaction has unsaved changes. Moving to another transaction without saving discards them.</div>' +
      (!st.canSave && F.path === 'data'
        ? '<div class="callout warn">' + icon('alert-triangle', 16) + '<div class="callout-body">' + esc(st.saveTitle) + '</div></div>'
        : '') +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:16px">' +
      '<button class="btn btn-secondary" data-action="rej-nav-discard">Discard</button>' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="rej-nav-save"' + (st.canSave ? '' : ' disabled') + '>Save and continue</button></div>';
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
      '<div class="rej-gen-line"><span>Fixed transactions</span><span class="num">' + plan.corrected + '</span></div>' +
      '<div class="rej-gen-line"><span>Unchanged transactions</span><span class="num">' + num(plan.unchanged) + '</span></div>' +
      '<div class="rej-gen-line total"><span>Total value</span><span class="num">' + fmt(plan.value, 2, b.currency) + '</span></div>' +
      '</div>'
      : '<div class="rej-gen-ledger">' +
      '<div class="rej-gen-line"><span>Fixed transactions to include</span><span class="num">' + plan.corrected + '</span></div>' +
      '<div class="rej-gen-line"><span>Still unfixed (excluded)</span><span class="num">' + plan.uncorrected + '</span></div>' +
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
        ' unfixed and will not be corrected in this file. ' + (replacement
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
        ? '<span>Fixed in place</span><span class="num">' + (g.corrected || 0) + '</span>' +
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
        ' for this transaction. It has moved to <strong>Fixed</strong> and now counts towards the next clearing file.'
        : 'The corrected configuration produces the same values for this transaction — nothing on the record changed. ' +
        'It has moved to <strong>Fixed</strong> so it is no longer blocked.') + '</div>' +
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

  // Which states open as read-back rather than as an editable fix (Part 7.2).
  var READBACK_STATES = ['corrected', 'regenerated', 'resubmitted', 'cleared', 'wont_fix'];
  // The path the last recorded fix took — what read-back pre-selects.
  function savedPath(t) {
    for (var i = t.history.length - 1; i >= 0; i--) {
      if (t.history[i].path) return t.history[i].path;
      if (t.history[i].kind === 'correction') return 'data';
    }
    return null;
  }

  function openEditor(id, keepOrder) {
    var t = R.txnById[id]; if (!t) return;
    var b = currentBatch();
    if (!keepOrder || !F.navOrder) {
      F.navOrder = b ? visibleTxns(b).map(function (x) { return x.id; }) : [id];
    }
    F.editing = id;
    F.editFrom = t.status;
    F.draft = {};
    F.touched = {};
    F.fgroups = {};
    R.ALL_FIELDS.forEach(function (k) { F.draft[k] = t.fields[k] == null ? '' : String(t.fields[k]); });
    // The path is declared per transaction, never carried over from the last
    // one. A transaction parked on a config change reopens on Path B with its
    // note read-only; an already-fixed one opens read-back on its saved path.
    F.readback = READBACK_STATES.indexOf(t.status) >= 0;
    if (t.status === 'awaiting_config' && t.configRequest) {
      F.path = 'config';
      F.cfgNote = t.configRequest.note || '';
      F.cfgFamily = t.configRequest.family || '';
    } else if (F.readback) {
      F.path = savedPath(t);
      F.cfgNote = ''; F.cfgFamily = '';
    } else {
      F.path = null; F.cfgNote = ''; F.cfgFamily = '';
    }
    F.irdManual = ''; F.irdNote = '';
    F.irdCards = {}; F.irdHistory = false; F.irdManualOpen = false; F.irdApplied = null;
    // NEW ──edit──▶ UNDER CORRECTION. A re-reject keeps its attempt count, so it
    // still sorts to the top while someone is working it. A transaction awaiting
    // a config fix — or opened read-back — keeps its state.
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
    F.touched = {}; F.readback = false; F.pathAnim = false;
    if (!keepOrder) F.navOrder = null;
  }

  // Unsaved work the prompts protect (Part 6.1, 7.1).
  function hasUnsaved() {
    var t = editingTxn(); if (!t || F.readback) return false;
    if (F.path === 'data') return draftChanges(t).length > 0;
    if (F.path === 'config') return t.status !== 'awaiting_config' && !!F.cfgNote.trim();
    return false;
  }

  /* Part 6.2 — what saving does, per path. Returns true when the save
     committed; the caller decides whether the panel closes or advances. */
  function doSave() {
    var t = editingTxn(); if (!t) return false;
    if (F.path === 'config') {
      if (!F.cfgNote.trim()) { toast('Describe what needs to change — the note is what the config owner works from', 'info'); return false; }
      R.markAwaitingConfig(t, F.cfgNote.trim(), F.cfgFamily || null, WHO);
      if (!t.assignee) t.assignee = WHO;
      return true;
    }
    if (F.path !== 'data') { toast('Choose a fix type first', 'info'); return false; }
    var changes = draftChanges(t);
    if (!changes.length) { toast('Change at least one value to save', 'info'); return false; }
    var errs = editorErrors(t);
    if (Object.keys(errs).length) {
      // Save attempt paints every error, not just the blurred ones (Part 3.5).
      Object.keys(errs).forEach(function (k) { F.touched[k] = true; });
      viewBatch();
      toast('Fix the errors above to save', 'info');
      return false;
    }
    // A chooser application carries its own generated derivation note (Part
    // 4.7); it only counts if the draft still holds the IRD it staged.
    var applied = F.irdApplied && F.draft && String(F.draft.ird) === F.irdApplied.ird ? F.irdApplied : null;
    var note = applied ? applied.note
      : (F.irdNote.trim() ? 'Manual IRD derivation — ' + F.irdNote.trim() : null);
    var at = R.nowStamp();
    var irdChanged = changes.filter(function (c) { return c.field === 'ird'; })[0];
    R.saveCorrection(t, changes, note, WHO, at, 'data');
    // Every committed IRD change on a chooser transaction becomes a row. An
    // analyst who bypassed the chooser and typed into the field directly is
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
  function saveToast(t) {
    return F.path === 'config'
      ? t.arn + ' moved to Awaiting config fix — excluded from the generate count'
      : 'Fix saved — ' + t.arn + ' is now Fixed';
  }

  // Prev/next through the batch in table order (Part 7.1).
  function navGo(dir) {
    var list = editableList(), i = editIndex();
    var j = dir === 'prev' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    closeEditor(true, true);
    openEditor(list[j].id, true);
  }

  /* ---- Part 4.7 · selecting a chooser card --------------------------------
     Populates the IRD field below, marks it Changed, and attaches the
     derivation note. Nothing is saved until Save fix. */
  function applyStrategy(n) {
    var t = editingTxn(); if (!t || !F.draft) return;
    var res = R.resolveIrd(t); if (!res) return;
    var s = res.strategies[n - 1];
    if (!s || !s.next) { toast('That option has nothing left to offer', 'info'); return; }
    F.draft.ird = s.next.ird;
    F.irdApplied = { strategy: n, ird: s.next.ird, note: R.irdApplyNote(t, n, s.next), manual: false };
    F.irdManual = ''; F.irdNote = '';
    toast('IRD ' + s.next.ird + ' staged — Save fix to commit it', 'success');
    viewBatch();
  }
  // Live typing must not re-render the panel (it would drop focus), so only
  // the Changes summary and the footer buttons refresh.
  function refreshDiff() {
    var t = editingTxn(); if (!t) return;
    remount('rej-diff', changesBlock(t));
    var st = saveState(t);
    var s = el('rej-save'); if (s) { s.disabled = !st.canSave; s.title = st.saveTitle; }
    var sn = el('rej-save-next'); if (sn) { sn.disabled = !st.canSave || !st.next; sn.title = st.nextTitle; }
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
      var txn = editingTxn(); if (!txn) return;
      F.fgroups[g] = !groupOpen(g, R.flaggedFields(txn));
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
    'rej-cancel': function () {
      // Part 6.1 — Cancel discards, but never silently.
      if (hasUnsaved()) { F.modal = { kind: 'discard' }; viewBatch(); return; }
      closeEditor(true); viewBatch();
    },
    'rej-discard': function () { F.modal = null; closeEditor(true); viewBatch(); },
    'rej-prev': function () {
      var i = editIndex();
      if (i <= 0) return;
      if (hasUnsaved()) { F.modal = { kind: 'navsave', dir: 'prev' }; viewBatch(); return; }
      navGo('prev');
    },
    'rej-next': function () {
      var list = editableList(), i = editIndex();
      if (i < 0 || i >= list.length - 1) return;
      if (hasUnsaved()) { F.modal = { kind: 'navsave', dir: 'next' }; viewBatch(); return; }
      navGo('next');
    },
    // Part 7.1 — the three-way prompt on prev/next with unsaved changes.
    'rej-nav-discard': function () {
      var dir = F.modal && F.modal.dir; F.modal = null;
      if (dir) navGo(dir); else viewBatch();
    },
    'rej-nav-save': function () {
      var dir = F.modal && F.modal.dir; F.modal = null;
      var t = editingTxn();
      if (!doSave()) { viewBatch(); return; }
      toast(saveToast(t), 'success');
      if (dir) navGo(dir); else viewBatch();
    },
    // Part 7.2 — read-back's single action: restore the editable state.
    'rej-reopen': function () {
      var t = editingTxn(); if (!t) return;
      F.readback = false;
      F.touched = {};
      if (t.status === 'wont_fix' || !F.path) F.path = F.path || 'data';
      viewBatch();
    },
    /* ---- Part 2 · the fix-type radio group ---- */
    'rej-path': function (t) {
      if (F.readback) return;
      var txn = editingTxn();
      if (txn && txn.status === 'awaiting_config') return;
      var p = t.getAttribute('data-path');
      if (F.path === p) return;                     // radio: reselecting is a no-op
      F.path = p;
      F.pathAnim = true;                            // one-shot reveal transition
      viewBatch();
      F.pathAnim = false;
      // Part 3.1 — the flagged input is pre-focused when the section opens.
      var focus = p === 'data'
        ? document.querySelector('.rej-flag-block .input:not([disabled])')
        : document.querySelector('.rej-cfg-note textarea');
      if (focus) focus.focus();
    },
    'rej-i-cfg-note': function (t) {
      F.cfgNote = t.value;
      var txn = editingTxn(); if (!txn) return;
      var st = saveState(txn);
      var s = el('rej-save'); if (s) { s.disabled = !st.canSave; s.title = st.saveTitle; }
      var sn = el('rej-save-next'); if (sn) { sn.disabled = !st.canSave || !st.next; sn.title = st.nextTitle; }
    },
    'rej-c-cfg-family': function (t) { F.cfgFamily = t.value; viewBatch(); },
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
          toast(txn.arn + ' re-derived — now Fixed', 'success');
        }
        viewBatch();
      }, 150);
    },
    /* ---- Part 3 · live editing ------------------------------------------
       Typing updates the draft and the Changed chip / left border in place —
       a full re-render would drop focus mid-keystroke. Validation paints on
       blur (rej-blur-field, wired through the focusout delegate). */
    'rej-i-field': function (t) {
      var key = t.getAttribute('data-field');
      F.draft[key] = t.value;
      var txn = editingTxn(); if (!txn) return;
      var wrap = document.querySelector('[data-fieldwrap="' + key + '"]');
      if (wrap) {
        var cur = txn.fields[key] == null ? '' : String(txn.fields[key]);
        wrap.classList.toggle('changed', t.value !== cur);
        // A field being retyped sheds its painted error until the next blur.
        if (F.touched[key] && !fieldError(txn, key)) {
          wrap.classList.remove('invalid');
          var e = wrap.querySelector('[data-errfor]'); if (e) e.textContent = '';
        }
      }
      refreshDiff();
    },
    'rej-blur-field': function (t) {
      var key = t.getAttribute('data-field');
      var txn = editingTxn(); if (!txn || F.readback) return;
      F.touched[key] = true;
      var err = fieldError(txn, key);
      var wrap = document.querySelector('[data-fieldwrap="' + key + '"]');
      if (wrap) {
        wrap.classList.toggle('invalid', !!err);
        var e = wrap.querySelector('[data-errfor]'); if (e) e.textContent = err || '';
      }
      refreshDiff();
    },
    'rej-c-field': function (t) {
      F.draft[t.getAttribute('data-field')] = t.value;
      F.touched[t.getAttribute('data-field')] = true;
      viewBatch();
    },
    'rej-reset-changes': function () {
      var t = editingTxn(); if (!t) return;
      R.ALL_FIELDS.forEach(function (k) { F.draft[k] = t.fields[k] == null ? '' : String(t.fields[k]); });
      F.touched = {};
      F.irdApplied = null; F.irdManual = ''; F.irdNote = '';
      viewBatch();
    },
    /* ---- Part 6 · save ---- */
    'rej-save': function () {
      var t = editingTxn(); if (!t) return;
      if (!doSave()) return;
      var msg = saveToast(t);
      closeEditor(false);
      toast(msg, 'success');
      viewBatch();
    },
    'rej-save-next': function () {
      var t = editingTxn(); if (!t) return;
      var nxt = nextUncorrected();
      if (!doSave()) return;
      var msg = saveToast(t);
      closeEditor(false, !!nxt);
      if (nxt) { openEditor(nxt.id, true); toast(msg + ' — next unfixed transaction loaded', 'success'); }
      else { toast(msg + ' — nothing left to fix in this batch', 'success'); viewBatch(); }
    },

    /* ---- Part 4 · the IRD chooser ---- */
    'rej-res-manual': function () { F.irdManualOpen = !F.irdManualOpen; viewBatch(); },
    'rej-res-history': function () { F.irdHistory = !F.irdHistory; viewBatch(); },
    'rej-res-apply': function (t) {
      var n = parseInt(t.getAttribute('data-n'), 10);
      var res = R.resolveIrd(editingTxn());
      var s = res && res.strategies[n - 1];
      if (!s || !s.next) { toast('That option has nothing left to offer', 'info'); return; }
      // Card 4 trades money for acceptance, so it is never one click away (4.3).
      if (n === 4) { F.modal = { kind: 'ird-fallback' }; viewBatch(); return; }
      applyStrategy(n);
    },
    'rej-res-apply-fallback': function () { F.modal = null; applyStrategy(4); },
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
          note: 'IRD ' + v + ' — manual entry: ' + F.irdNote.trim()
        };
      }
      F.draft.ird = v;
      toast('Manual IRD ' + v + ' staged — Save fix to record it with your note', 'success');
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
      // Part 6.1 — mark, close the modal, and advance to the next transaction
      // still to fix; the panel closes only when nothing is left.
      var wasEditing = F.editing === t.id;
      var nxt = wasEditing ? nextUncorrected() : null;
      R.markWontFix(t, F.modal.note.trim(), WHO);
      F.modal = null;
      closeEditor(false, !!nxt);
      toast(t.arn + " marked as won't fix — excluded from the generate count", 'success');
      if (nxt) openEditor(nxt.id, true); else viewBatch();
    },
    'rej-history': function (t) { F.modal = { kind: 'history', txnId: t.getAttribute('data-id') }; viewBatch(); },
    'rej-modal-close': function () { F.modal = null; viewBatch(); },

    /* ---- generate corrected clearing file ---- */
    'rej-gen-open': function () {
      var b = currentBatch(); if (!b) return;
      if (!R.correctedTxns(b).length) { toast('Fix at least one transaction first', 'info'); return; }
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
