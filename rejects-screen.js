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
    pct = kit.pct, tenantTag = kit.tenantTag;

  var ROUTE = '#/dashboard/ops/rejects';
  var WHO = R.CURRENT_USER;

  S.rej = {
    // --- overview filters ---
    tenants: {},                  // tid → true; empty object means "all"
    network: 'all', family: 'all', reason: 'all', status: 'all',
    dateMode: 'all', dateOn: '', dateFrom: '', dateTo: '',
    sort: { key: 'default', dir: 'desc' },
    // --- batch detail ---
    batchId: null, q: '', sel: {}, txnSort: { key: 'status', dir: 'asc' },
    // --- correction editor ---
    editing: null, editFrom: null, draft: null, showAll: false, navOrder: null,
    irdManual: '', irdNote: '',
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
  function netBadge(net) {
    return '<span class="rej-net ' + (net === 'Visa' ? 'visa' : 'mc') + '">' + esc(net) + '</span>';
  }
  function familyPill(fam) {
    return fam === 'staging'
      ? pill('Staging', 'warning', 'file-x')
      : pill('Incoming', 'neutral', 'download');
  }
  function irdTag() { return '<span class="rej-ird-tag" title="Mastercard IRD reject — resolved through the recommendation panel">IRD</span>'; }
  function manualTag(tag) {
    if (!tag) return '';
    return '<span class="rej-manual-tag" title="Recorded by hand by ' + esc(tag.by) + ' on ' + esc(tag.at) + '">' +
      icon('hand', 11) + esc(tag.label) + '</span>';
  }
  function reasonCell(t) {
    return '<div class="reason-cell"><span class="mono reason-code">' + esc(t.reasonCode) + '</span>' +
      esc(R.reasonText(t.reasonCode)) + (R.isIrd(t.reasonCode) ? irdTag() : '') + '</div>';
  }
  function arnCell(arn) { return '<span class="rej-arn mono">' + esc(arn) + '</span>'; }
  function moneyOf(t) { return fmt(t.amount, 2, t.currency); }

  // Lifecycle distribution bar — one segment per populated state, in lifecycle
  // order, with the plain-language legend the brief asks for.
  function progressBar(b) {
    var c = R.batchCounts(b), total = b.txns.length || 1;
    var segs = '', legend = [];
    R.LIFECYCLE_ORDER.forEach(function (k) {
      if (!c[k]) return;
      var d = R.LIFECYCLE[k];
      segs += '<span class="rej-seg k-' + d.kind + '" style="width:' + ((c[k] / total) * 100).toFixed(2) + '%" ' +
        'title="' + esc(c[k] + ' ' + d.label.toLowerCase()) + '"></span>';
      legend.push('<span class="rej-leg k-' + d.kind + '"><i></i><span class="num">' + c[k] + '</span> ' + esc(d.label.toLowerCase()) + '</span>');
    });
    return '<div class="rej-progress"><div class="rej-bar">' + segs + '</div>' +
      '<div class="rej-legend">' + legend.join('') + '</div></div>';
  }

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
      if (F.status !== 'all' && !b.txns.some(function (t) { return t.status === F.status; })) return false;
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

  function summaryStrip(list) {
    var s = R.summary(list);
    return '<div class="stat-row rej-stats">' +
      '<div class="stat-card"><span class="sc-label">Total open rejects</span><span class="sc-value num">' + s.open + '</span>' +
      '<span class="sc-sub">everything not yet cleared, across ' + list.length + ' batch' + (list.length === 1 ? '' : 'es') + '</span></div>' +

      '<div class="stat-card"><span class="sc-label">Staging rejects</span><span class="sc-value num">' + s.staging + '</span>' +
      '<span class="sc-sub">' + (s.stagingBlocking
        ? '<strong class="rej-warn-text"><span class="num">' + s.stagingBlocking + '</span> blocking an unsubmitted file</strong>'
        : 'no file currently blocked') + '</span></div>' +

      '<div class="stat-card"><span class="sc-label">Incoming rejects</span><span class="sc-value num">' + s.incoming + '</span>' +
      '<span class="sc-sub">file staged, transactions rejected later</span></div>' +

      '<div class="stat-card"><span class="sc-label">IRD rejects</span><span class="sc-value num">' + s.ird + '</span>' +
      '<span class="sc-sub">Mastercard 0221 / 0225 — recommendation panel</span></div>' +

      '<div class="stat-card' + (s.reRejected ? ' danger' : '') + '"><span class="sc-label">Re-rejected</span>' +
      '<span class="sc-value num' + (s.reRejected ? ' rej-danger-text' : '') + '">' + s.reRejected + '</span>' +
      '<span class="sc-sub">' + (s.reRejected ? 'rejected again after resubmission — work these first' : 'nothing has come back twice') + '</span></div>' +
      '</div>';
  }

  function filterRow() {
    var tenantChips = '<div class="rej-tenant-chips">' +
      '<button class="rej-chip' + (!tenantFilterActive() ? ' on' : '') + '" data-action="rej-tenant-all">All tenants</button>' +
      O.tenants.map(function (t) {
        return '<button class="rej-chip' + (F.tenants[t.id] ? ' on' : '') + '" data-action="rej-tenant" data-id="' + t.id + '">' +
          '<span class="tenant-dot" style="background:' + t.color + '"></span>' + esc(t.name) + '</button>';
      }).join('') + '</div>';

    var presets = [['all', 'All'], ['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(function (p) {
      return '<button class="rej-chip' + (F.dateMode === p[0] ? ' on' : '') + '" data-action="rej-date-preset" data-mode="' + p[0] + '">' + p[1] + '</button>';
    }).join('') +
      '<button class="rej-chip' + (F.dateMode === 'on' ? ' on' : '') + '" data-action="rej-date-preset" data-mode="on">Specific date</button>' +
      '<button class="rej-chip' + (F.dateMode === 'range' ? ' on' : '') + '" data-action="rej-date-preset" data-mode="range">Custom range</button>';

    var dateInputs = F.dateMode === 'on'
      ? '<label class="field inline">On <input type="date" class="input w-160" value="' + esc(F.dateOn) + '" data-action="rej-c-date-on" /></label>'
      : (F.dateMode === 'range'
        ? '<label class="field inline">From <input type="date" class="input w-160" value="' + esc(F.dateFrom) + '" data-action="rej-c-date-from" /></label>' +
        '<label class="field inline">To <input type="date" class="input w-160" value="' + esc(F.dateTo) + '" data-action="rej-c-date-to" /></label>'
        : '');

    var reasonOpts = R.reasonCodesPresent().map(function (c) {
      return '<option value="' + esc(c) + '"' + (F.reason === c ? ' selected' : '') + '>' + esc(c) + ' — ' + esc(R.reasonText(c)) + '</option>';
    }).join('');
    var statusOpts = R.LIFECYCLE_ORDER.map(function (k) {
      return '<option value="' + k + '"' + (F.status === k ? ' selected' : '') + '>' + esc(R.LIFECYCLE[k].label) + '</option>';
    }).join('');

    return '<div class="rej-filters">' +
      '<div class="rej-filter-line"><span class="rej-filter-key">Tenant</span>' + tenantChips + '</div>' +
      '<div class="rej-filter-line">' +
      '<label class="field inline">Network <select class="input w-160" data-action="rej-c-network">' +
      ['all', 'Visa', 'Mastercard'].map(function (n) {
        return '<option value="' + n + '"' + (F.network === n ? ' selected' : '') + '>' + (n === 'all' ? 'All networks' : n) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field inline">Reject family <select class="input w-160" data-action="rej-c-family">' +
      '<option value="all"' + (F.family === 'all' ? ' selected' : '') + '>All families</option>' +
      '<option value="staging"' + (F.family === 'staging' ? ' selected' : '') + '>Staging</option>' +
      '<option value="incoming"' + (F.family === 'incoming' ? ' selected' : '') + '>Incoming</option>' +
      '</select></label>' +
      '<label class="field inline">Reason code <select class="input w-320" data-action="rej-c-reason">' +
      '<option value="all"' + (F.reason === 'all' ? ' selected' : '') + '>All reason codes</option>' + reasonOpts + '</select></label>' +
      '<label class="field inline">Status <select class="input w-180" data-action="rej-c-status">' +
      '<option value="all"' + (F.status === 'all' ? ' selected' : '') + '>All statuses</option>' + statusOpts + '</select></label>' +
      '</div>' +
      '<div class="rej-filter-line"><span class="rej-filter-key">Cycle date</span>' +
      '<div class="rej-tenant-chips">' + presets + '</div>' + dateInputs +
      '<button class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="rej-reset">' + icon('rotate-ccw', 14) + 'Reset filters</button>' +
      '</div>' +
      '</div>';
  }

  function batchTable(list) {
    if (!list.length) {
      return emptyState('check-circle', 'No reject batches match these filters',
        'Widen the date range or clear the tenant, network and reason-code filters to see the full 30-day window.');
    }
    var rows = sortedBatches(list).map(function (b) {
      var c = R.batchCounts(b);
      var rate = R.batchRate(b);
      return '<tr class="clickable' + (R.isBlocking(b) ? ' rej-row-blocking' : '') + '" data-route="' + ROUTE + '/' + b.id + '">' +
        '<td>' + tenantTag(b.tenantId) + '</td>' +
        '<td>' + netBadge(b.network) + '</td>' +
        '<td>' + familyPill(b.family) + (R.isBlocking(b) ? '<div class="cell-sub rej-warn-text">blocks the cycle</div>' : '') + '</td>' +
        '<td class="nowrap"><div class="cell-main num">' + U.prettyDate(b.cycleDate) + '</div>' +
        '<div class="cell-sub">' + esc(b.cycleDow) + '</div></td>' +
        '<td class="nowrap cell-sub num">' + esc(b.receivedAt) + '</td>' +
        '<td class="num">' + num(b.fileTxns) + '</td>' +
        '<td class="num"><div class="cell-main">' + b.txns.length + '</div>' +
        '<div class="cell-sub num">' + pct(rate, 3) + ' of file</div></td>' +
        '<td class="num nowrap">' + fmt(R.batchValue(b), 2, b.currency) + '</td>' +
        '<td><div class="cell-main">' + esc(R.batchProgressText(b)) + '</div>' +
        '<div class="cell-sub">' + (c.re_rejected ? '<span class="rej-danger-text"><span class="num">' + c.re_rejected + '</span> re-rejected · </span>' : '') +
        '<span class="num">' + R.batchOpen(b) + '</span> open</div></td>' +
        '<td class="nowrap"><span class="rej-open-link">Open' + icon('arrow-right', 14) + '</span></td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="data rej-batches"><thead><tr>' +
      sortTh('Tenant', 'tenant') + sortTh('Network', 'network') + sortTh('Family', 'family') +
      sortTh('Cycle date', 'cycle') + sortTh('Received at', 'received') +
      sortTh('Transactions in file', 'filetxns', 'num') + sortTh('Rejects', 'rejects', 'num') +
      sortTh('Reject value', 'value', 'num') + sortTh('Status', 'status') +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function viewOverview() {
    var list = filteredBatches();
    setView(
      '<div class="page-head">' +
      '<div><h1 class="page-title">Rejects</h1>' +
      '<div class="subtitle">Transactions rejected by card networks — at clearing file staging, or in a subsequent incoming cycle. ' +
      'Correct the underlying transaction data and regenerate the clearing file for resubmission.</div></div>' +
      '</div>' +
      summaryStrip(list) +
      '<div class="card">' + filterRow() + batchTable(list) + '</div>'
    );
  }

  /* =======================================================================
     B · Reject Batch Detail
     ======================================================================= */
  function currentBatch() { return R.batchById[F.batchId]; }

  // Default order: anything with a failed attempt behind it first (attempt 3 is
  // an escalation, not a queue position), then lifecycle order, then ARN.
  function txnPriority(t) { return (t.attempts > 1 ? -10 : 0) + lc(t.status).order; }
  function visibleTxns(b) {
    var q = F.q.trim();
    var list = b.txns.filter(function (t) { return !q || t.arn.indexOf(q) >= 0; });
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

  function txnTable(b) {
    var list = visibleTxns(b);
    if (!list.length) {
      return emptyState('search-x', 'No transactions match',
        F.q ? 'No ARN in this batch contains “' + esc(F.q) + '”. Clear the search to see all ' + b.txns.length + '.' : 'This batch has no rejected transactions.');
    }
    var allSel = list.every(function (t) { return F.sel[t.id]; });
    var rows = list.map(function (t) {
      return '<tr class="' + (t.status === 're_rejected' ? 'rej-row-rerejected' : '') +
        (t.status === 'wont_fix' ? ' rej-row-terminal' : '') + '">' +
        '<td class="pick-cell sticky-pick" onclick="event.stopPropagation()">' +
        '<input type="checkbox"' + (F.sel[t.id] ? ' checked' : '') + ' data-action="rej-c-pick" data-id="' + t.id + '" aria-label="Select ' + esc(t.arn) + '" /></td>' +
        '<td class="sticky-arn">' + arnCell(t.arn) + '</td>' +
        '<td><div class="cell-main">' + esc(t.merchant) + '</div><div class="cell-sub mono">' + esc(t.mid) + '</div></td>' +
        '<td class="num nowrap">' + moneyOf(t) + '</td>' +
        '<td class="nowrap"><div class="num">' + U.prettyDate(t.txnDate) + '</div><div class="cell-sub num">' + esc(t.txnTime) + ' IST</div></td>' +
        '<td>' + reasonCell(t) + '</td>' +
        '<td>' + statusPill(t) + manualTag(t.manualTag) + '</td>' +
        '<td class="cell-sub">' + (t.assignee ? esc(t.assignee) : '—') + '</td>' +
        '<td class="nowrap">' +
        '<button class="btn btn-sm btn-secondary" data-action="rej-edit" data-id="' + t.id + '">' + icon('pencil', 14) + 'Edit</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="rej-history" data-id="' + t.id + '">' + icon('history', 14) + 'History</button>' +
        '</td></tr>';
    }).join('');

    return '<div class="table-wrap rej-txn-wrap"><table class="data rej-txns"><thead><tr>' +
      '<th class="pick-cell sticky-pick"><input type="checkbox"' + (allSel ? ' checked' : '') + ' data-action="rej-c-pick-all" aria-label="Select all" /></th>' +
      txnSortTh('ARN', 'arn', 'sticky-arn') + txnSortTh('Merchant', 'merchant') + txnSortTh('Amount', 'amount', 'num') +
      txnSortTh('Transaction date', 'date') + txnSortTh('Reason code', 'reason') + txnSortTh('Status', 'status') +
      txnSortTh('Assigned to', 'assignee') + '<th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function cycleContext(b) {
    var rejCount = b.txns.length, rejValue = R.batchValue(b);
    var accCount = b.family === 'staging' ? 0 : b.fileTxns - rejCount;
    var accValue = b.family === 'staging' ? 0 : Math.round((b.fileValue - rejValue) * 100) / 100;
    function cell(label, value, sub, cls) {
      return '<div class="ctx-cell"><span class="ctx-label">' + esc(label) + '</span>' +
        '<span class="ctx-value num ' + (cls || '') + '">' + value + '</span>' +
        (sub ? '<span class="ctx-sub num">' + sub + '</span>' : '') + '</div>';
    }
    return cardBox('Cycle context',
      '<div class="ctx-grid">' +
      cell('Transaction cohort', U.prettyDate(b.cohortFrom) + ' → ' + U.prettyDate(b.cohortTo), U.dow(b.cycleDate) + ' cycle') +
      cell('Transactions in file', num(b.fileTxns), 'original clearing file') +
      cell('Total value in file', fmt(b.fileValue, 2, b.currency), '') +
      cell('Rejected', num(rejCount), fmt(rejValue, 2, b.currency) + ' · ' + pct(R.batchRate(b), 3), 'rej-danger-text') +
      cell('Accepted', num(accCount), b.family === 'staging' ? 'nothing cleared — file refused' : fmt(accValue, 2, b.currency),
        b.family === 'staging' ? 'rej-danger-text' : 'rej-good-text') +
      '</div>' +
      '<div class="rej-file-line">' + icon('file-text', 16) +
      '<span>Original clearing file</span><code class="mono">' + esc(b.clearingFile) + '</code>' +
      '<span class="meta num">' + esc(b.clearingFileSize) + '</span>' +
      '<button class="btn btn-sm btn-secondary" data-action="rej-dl-clearing">' + icon('download', 14) + 'Download</button></div>');
  }

  function generatedHistory(b) {
    if (!b.generated.length) {
      return cardBox('Generated clearing files',
        '<div class="meta">No corrected clearing file has been generated for this batch yet. ' +
        'Correct at least one transaction, then use <strong>Generate corrected clearing file</strong> above.</div>');
    }
    var rows = b.generated.map(function (g, i) {
      var outKind = g.outcome === 'Accepted' ? 'success' : (g.outcome === 'Re-rejected' ? 'danger' : 'neutral');
      var delKind = g.delivery === 'Not yet delivered' ? 'warning' : 'neutral';
      return '<tr>' +
        '<td class="mono nowrap">' + esc(g.name) + '<div class="cell-sub mono">' + esc(g.checksum) + '</div></td>' +
        '<td class="nowrap cell-sub num">' + esc(g.at) + '</td>' +
        '<td class="cell-sub">' + esc(g.by) + '</td>' +
        '<td class="num">' + g.count + '</td>' +
        '<td class="num nowrap">' + fmt(g.value, 2, g.currency) + '</td>' +
        '<td>' + pill(g.delivery, delKind) + (g.manual ? manualTag({ label: 'manually marked', by: g.markedBy || g.by, at: g.markedAt || g.at }) : '') +
        (g.s3Path ? '<div class="cell-sub mono">' + esc(g.s3Path) + '</div>' : '') +
        (g.note ? '<div class="cell-sub">' + esc(g.note) + '</div>' : '') + '</td>' +
        '<td>' + pill(g.outcome, outKind) + '</td>' +
        '<td><button class="btn btn-sm btn-ghost" data-action="rej-dl-generated" data-idx="' + i + '">' + icon('download', 14) + 'Download</button></td>' +
        '</tr>';
    }).join('');
    return cardBox('Generated clearing files',
      '<div class="meta mb-16">Append-only. Every file generated for this batch stays on the record with who produced it, how it was delivered and what the network did with it — corrections are never overwritten.</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>File name</th><th>Generated at</th><th>Generated by</th><th class="num">Transactions</th>' +
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
      setView('<div class="page-head"><div><h1 class="page-title">Rejects</h1></div></div>' +
        '<div class="card">' + emptyState('file-warning', 'Reject batch not found',
          'That batch id is not in the last 30 days of reject files.',
          '<button class="btn btn-secondary" data-route="' + ROUTE + '">Back to Rejects</button>') + '</div>');
      return;
    }
    var corrected = R.correctedTxns(b);
    var reconCycleId = 'ops-cyc-' + b.tenantId + '-' + b.cycleDate;

    var head =
      '<div class="page-head rej-batch-head">' +
      '<div>' +
      '<a class="rej-back" data-route="' + ROUTE + '">' + icon('arrow-left', 15) + 'All rejects</a>' +
      '<h1 class="page-title">' + esc(b.id) + ' · ' + (b.family === 'staging' ? 'Staging reject' : 'Incoming reject') + '</h1>' +
      '<div class="rej-head-meta">' + tenantTag(b.tenantId) + netBadge(b.network) + familyPill(b.family) +
      '<span class="meta num">Cycle ' + U.prettyDate(b.cycleDate) + ' · ' + esc(b.cycleDow) + '</span></div>' +
      '<div class="rej-file-line rej-file-line-head">' + icon('file-warning', 16) +
      '<span>Reject file</span><code class="mono">' + esc(b.rejectFile) + '</code>' +
      '<span class="meta num">' + esc(b.rejectFileSize) + ' · received ' + esc(b.receivedAt) + '</span>' +
      '<button class="btn btn-sm btn-secondary" data-action="rej-dl-reject">' + icon('download', 14) + 'Download</button></div>' +
      '</div>' +
      '<div class="head-actions rej-head-actions">' +
      '<button class="btn btn-primary" data-action="rej-gen-open"' + (corrected.length ? '' : ' disabled') +
      ' title="' + (corrected.length ? 'Generate a clearing file containing the ' + corrected.length + ' corrected transaction(s)' : 'Correct at least one transaction first') + '">' +
      icon('file-plus', 16) + 'Generate corrected clearing file' + (corrected.length ? ' <span class="num">(' + corrected.length + ')</span>' : '') + '</button>' +
      '<button class="btn btn-secondary" data-action="rej-export">' + icon('table', 16) + 'Export rejects</button>' +
      '</div></div>';

    var banner = b.family === 'staging'
      ? '<div class="callout danger rej-banner">' + icon('alert-octagon', 20) +
      '<div class="callout-body"><strong>Clearing file was not staged. No transactions from this cycle have cleared.</strong>' +
      '<div style="margin-top:4px">' + esc(b.network) + ' refused <code class="mono">' + esc(b.clearingFile) + '</code> at submission — ' +
      'all <span class="num">' + num(b.fileTxns) + '</span> transactions are still unsettled, not just the <span class="num">' + b.txns.length + '</span> flagged below. ' +
      'This batch blocks the whole cycle and should be worked ahead of incoming rejects.</div></div></div>'
      : '<div class="rej-xref">' + icon('git-compare', 15) +
      '<span>The file staged; only these transactions were rejected downstream. Incoming rejects move settlement math — ' +
      'the reconciliation view’s rejections section and this batch are two views of the same events.</span>' +
      '<a data-route="#/dashboard/ops/reconciliation?reconTenant=' + b.tenantId + '&reconCycle=' + reconCycleId + '">' +
      'View this cycle’s reconciliation' + icon('arrow-right', 14) + '</a></div>';

    var progress = cardBox('Batch progress',
      progressBar(b) +
      '<div class="meta mt-16">' + esc(R.batchProgressText(b)) + ' · <span class="num">' + R.batchOpen(b) + '</span> still open · ' +
      '<span class="num">' + b.txns.filter(function (t) { return R.isIrd(t.reasonCode); }).length + '</span> IRD reject(s) in this batch.</div>');

    var toolbar = '<div class="rej-toolbar">' +
      '<label class="rej-search">' + icon('search', 15) +
      '<input class="input" type="text" placeholder="Search by ARN" value="' + esc(F.q) + '" data-action="rej-i-q" aria-label="Search by ARN" />' +
      '</label>' +
      '<span class="meta">Sorted with re-rejected and new first. Click any column to re-sort.</span>' +
      '</div>';

    setView(
      head + banner +
      '<div class="grid grid-2 mt-24 rej-context-grid">' + cycleContext(b) + progress + '</div>' +
      '<div class="card mt-24">' +
      '<div class="card-head"><div class="card-title">Rejected transactions <span class="meta num">(' + b.txns.length + ')</span></div></div>' +
      toolbar + bulkBar(b) +
      '<div id="rej-txn-mount">' + txnTable(b) + '</div>' +
      '</div>' +
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

  function fieldRow(t, key) {
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
    return '<div class="rej-field' + (changed ? ' changed' : '') + '">' +
      '<div class="rej-field-label">' + esc(def.label) +
      (changed ? '<span class="rej-changed-dot" title="Edited">' + icon('circle', 10) + 'edited</span>' : '') + '</div>' +
      '<div class="rej-field-current"><span class="rej-field-key">current</span>' +
      '<span class="' + (def.mono ? 'mono ' : '') + 'num">' + (cur === '' ? '<em class="rej-empty">empty</em>' : esc(cur)) + '</span></div>' +
      '<div class="rej-field-input">' + input + '</div>' +
      (def.help ? '<div class="rej-field-help">' + esc(def.help) + '</div>' : '') +
      '</div>';
  }

  function diffBlock(t) {
    var changes = draftChanges(t);
    if (!changes.length) {
      return '<div class="meta">Nothing changed yet. A correction needs at least one edited field — nothing is saved silently.</div>';
    }
    return '<div class="rej-diff">' + changes.map(function (c) {
      var def = R.FIELDS[c.field] || { label: c.field };
      return '<div class="rej-diff-row"><span class="rej-diff-field">' + esc(def.label) + '</span>' +
        '<span class="rej-diff-old mono">' + (c.from === '' ? 'empty' : esc(c.from)) + '</span>' +
        icon('arrow-right', 13) +
        '<span class="rej-diff-new mono">' + (c.to === '' ? 'empty' : esc(c.to)) + '</span></div>';
    }).join('') + '</div>';
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

  function editorPanel() {
    var t = editingTxn();
    if (!t) return '';
    var b = currentBatch();
    var list = editableList();
    var idx = editIndex();
    var changes = draftChanges(t);
    var rel = R.relevantFields(t.reasonCode);
    var others = R.otherFields(t.reasonCode);
    var raw = R.rawMessage(t);

    var attemptBlock = t.attempts > 1
      ? '<div class="rej-attempt-box">' + icon('rotate-ccw', 16) +
      '<div><strong>Attempt <span class="num">' + t.attempts + '</span></strong> — this transaction has been corrected and rejected again.' +
      '<div class="rej-attempt-log">' + t.attemptLog.map(function (a) {
        return '<div class="rej-attempt-line">Attempt <span class="num">' + a.attempt + '</span> · ' +
          (a.ird ? 'IRD <code class="mono">' + esc(a.ird) + '</code> · ' : '') +
          'previously corrected <span class="num">' + esc(a.correctedAt) + '</span> by ' + esc(a.by) +
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
      '<span class="mono reason-code">' + esc(t.reasonCode) + '</span>' +
      '<strong>' + esc(R.reasonText(t.reasonCode)) + '</strong>' +
      (R.isIrd(t.reasonCode) ? irdTag() : '') +
      '<span class="meta">' + esc(b.network) + ' · ' + (b.family === 'staging' ? 'staging reject' : 'incoming reject') + '</span>' +
      '</div>' +
      (raw ? '<div class="rej-raw"><span class="rej-ird-sub">Network reject message</span><code class="mono">' + esc(raw) + '</code></div>' : '');

    var fields =
      '<div class="cfg-section-title mt-24">Fields for reason ' + esc(t.reasonCode) +
      '<span class="meta">— surfaced because this reason code points at them</span></div>' +
      (rel.length ? rel.map(function (k) { return fieldRow(t, k); }).join('') :
        '<div class="meta">No specific field mapping for this reason code — use “Show all fields”.</div>') +
      (R.isIrd(t.reasonCode) ? irdPanel(t) : '') +
      '<div class="rej-showall">' +
      '<button class="btn btn-secondary btn-sm" data-action="rej-showall">' +
      icon(F.showAll ? 'chevron-up' : 'chevron-down', 15) +
      (F.showAll ? 'Hide other fields' : 'Show all fields') + ' <span class="num">(' + others.length + ')</span></button>' +
      '</div>' +
      (F.showAll ? '<div class="rej-other-fields">' + others.map(function (k) { return fieldRow(t, k); }).join('') + '</div>' : '');

    var historyBlock = t.history.length
      ? '<div class="cfg-section-title mt-24">Correction history <span class="meta">— append-only</span></div>' +
      '<div class="rej-history">' + t.history.map(function (h) {
        return '<div class="rej-history-entry">' +
          '<div class="rej-history-head"><span class="num">' + esc(h.at) + '</span> · ' + esc(h.by) +
          (h.kind === 'wont_fix' ? pill("won't fix", 'neutral', 'ban') : '') + '</div>' +
          (h.changes && h.changes.length
            ? '<div class="rej-history-changes">' + h.changes.map(function (c) {
              var def = R.FIELDS[c.field] || { label: c.field };
              return '<span>' + esc(def.label) + ': <code class="mono">' + esc(c.from || 'empty') + '</code> → <code class="mono">' + esc(c.to) + '</code></span>';
            }).join('') + '</div>' : '') +
          (h.note ? '<div class="rej-history-note">' + esc(h.note) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>'
      : '';

    var canSave = changes.length > 0;
    var nextTarget = nextUncorrected();

    return '<div class="overlay" data-action="rej-cancel">' +
      '<div class="side-panel wide rej-panel" onclick="event.stopPropagation()">' +
      '<div class="modal-head rej-panel-head">' +
      '<div><div class="section-title">Correct transaction</div>' +
      '<div class="meta">' + esc(b.id) + ' · ' + esc(b.tenantName) + ' · ' + esc(b.network) + ' · transaction <span class="num">' + (idx + 1) + '</span> of <span class="num">' + list.length + '</span></div></div>' +
      '<div class="rej-panel-nav">' +
      '<button class="icon-btn" data-action="rej-prev"' + (idx <= 0 ? ' disabled' : '') + ' aria-label="Previous transaction" title="Previous transaction">' + icon('chevron-left', 16) + '</button>' +
      '<button class="icon-btn" data-action="rej-next"' + (idx < 0 || idx >= list.length - 1 ? ' disabled' : '') + ' aria-label="Next transaction" title="Next transaction">' + icon('chevron-right', 16) + '</button>' +
      '<button class="icon-btn" data-action="rej-cancel" aria-label="Close">' + icon('x', 16) + '</button>' +
      '</div></div>' +

      '<div class="rej-panel-status">' + statusPill(t) + manualTag(t.manualTag) +
      '<span class="meta">' + esc(lc(t.status).note) + '</span>' +
      '<span class="meta" style="margin-left:auto">Assigned to ' + (t.assignee ? esc(t.assignee) : '—') + '</span></div>' +

      attemptBlock + ctx + fields +

      '<div class="cfg-section-title mt-24">Change summary <span class="meta">— reviewed before anything is written</span></div>' +
      '<div id="rej-diff">' + diffBlock(t) + '</div>' +
      historyBlock +

      '<div class="rej-panel-foot">' +
      '<button class="btn btn-danger btn-sm" data-action="rej-wontfix-open">' + icon('ban', 15) + "Mark as won't fix" + '</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-secondary" data-action="rej-cancel">Cancel</button>' +
      '<button class="btn btn-secondary" id="rej-save-next" data-action="rej-save-next"' + (canSave && nextTarget ? '' : ' disabled') +
      ' title="' + (nextTarget ? 'Save and open the next uncorrected transaction' : 'No uncorrected transaction left in this batch') + '">' +
      icon('skip-forward', 15) + 'Save and next</button>' +
      '<button class="btn btn-primary" id="rej-save" data-action="rej-save"' + (canSave ? '' : ' disabled') + '>' +
      icon('save', 15) + 'Save correction</button>' +
      '</div>' +
      '</div></div>';
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
    else if (m.kind === 'gen-result') body = genResultModal(b);
    else if (m.kind === 'mark-submitted') body = markSubmittedModal(b);
    else if (m.kind === 'wont-fix') body = wontFixModal();
    else if (m.kind === 'history') body = historyModal();
    if (!body) return '';
    var dismissable = m.kind !== 'gen-running';
    return '<div class="overlay on-top"' + (dismissable ? ' data-action="rej-modal-close"' : '') + '>' +
      '<div class="modal rej-modal" onclick="event.stopPropagation()">' + body + '</div></div>';
  }

  function genConfirmModal(b) {
    var included = R.correctedTxns(b);
    var excluded = R.excludedTxns(b);
    var byReason = {};
    excluded.forEach(function (t) {
      var k = lc(t.status).label;
      byReason[k] = (byReason[k] || 0) + 1;
    });
    var uncorrected = excluded.filter(function (t) { return t.status !== 'wont_fix'; }).length;
    var value = included.reduce(function (s, t) { return s + t.amount; }, 0);

    return '<div class="modal-head"><div class="section-title">Generate corrected clearing file</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-gen-target">' + tenantTag(b.tenantId) + netBadge(b.network) +
      '<span class="meta num">Cycle ' + U.prettyDate(b.cycleDate) + '</span>' +
      '<span class="meta mono">' + esc(R.generatedName(b)) + '</span></div>' +
      '<div class="rej-gen-split">' +
      '<div class="rej-gen-col ok"><div class="rej-gen-n num">' + included.length + '</div>' +
      '<div class="rej-gen-lbl">included</div><div class="meta num">' + fmt(Math.round(value * 100) / 100, 2, b.currency) + '</div>' +
      '<div class="meta">every transaction in Corrected state</div></div>' +
      '<div class="rej-gen-col out"><div class="rej-gen-n num">' + excluded.length + '</div>' +
      '<div class="rej-gen-lbl">left out</div>' +
      '<div class="rej-gen-why">' + (excluded.length
        ? Object.keys(byReason).map(function (k) { return '<span><span class="num">' + byReason[k] + '</span> ' + esc(k.toLowerCase()) + '</span>'; }).join('')
        : '<span class="meta">nothing</span>') + '</div></div>' +
      '</div>' +
      (uncorrected
        ? '<div class="callout warn mt-16">' + icon('alert-triangle', 18) +
        '<div class="callout-body"><span class="num">' + uncorrected + '</span> transaction' + (uncorrected > 1 ? 's remain' : ' remains') +
        ' uncorrected and will not be included in this file. They stay in this batch and can go out in a later retry.</div></div>'
        : '') +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:20px">' +
      '<button class="btn btn-secondary" data-action="rej-modal-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="rej-gen-run"' + (included.length ? '' : ' disabled') + '>' +
      icon('file-plus', 16) + 'Generate file</button></div>';
  }

  function genRunningModal() {
    var p = F.modal.pct || 0;
    var step = p < 34 ? 'Collecting corrected transactions…' : (p < 67 ? 'Building clearing records…' : 'Writing file and computing checksum…');
    return '<div class="modal-head"><div class="section-title">Generating clearing file…</div></div>' +
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

    return '<div class="modal-head"><div class="section-title">Clearing file generated</div>' +
      '<button class="icon-btn" data-action="rej-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="rej-result">' + icon('check-circle', 20) +
      '<div style="flex:1"><div class="rej-result-name mono">' + esc(g.name) + '</div>' +
      '<div class="rr-grid">' +
      '<span>Transactions</span><span class="num">' + g.count + '</span>' +
      '<span>Total value</span><span class="num">' + fmt(g.value, 2, g.currency) + '</span>' +
      '<span>Generated at</span><span class="num">' + esc(g.at) + '</span>' +
      '<span>Generated by</span><span>' + esc(g.by) + '</span>' +
      '<span>Checksum</span><span class="mono">' + esc(g.checksum) + '</span>' +
      '<span>Retry</span><span class="mono">' + esc(g.name.replace(/^.*_(R\d+)\.txt$/, '$1')) + '</span>' +
      '</div></div></div>' +
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
    F.showAll = false;
    F.irdManual = ''; F.irdNote = '';
    // NEW ──edit──▶ UNDER CORRECTION. A re-reject keeps its attempt count, so it
    // still sorts to the top while someone is working it.
    if (t.status === 'new' || t.status === 're_rejected') t.status = 'under_correction';
    viewBatch();
  }
  function closeEditor(revert, keepOrder) {
    var t = editingTxn();
    if (t && revert && t.status === 'under_correction' && F.editFrom) t.status = F.editFrom;
    F.editing = null; F.editFrom = null; F.draft = null; F.showAll = false;
    F.irdManual = ''; F.irdNote = '';
    if (!keepOrder) F.navOrder = null;
  }
  function doSave() {
    var t = editingTxn(); if (!t) return false;
    var changes = draftChanges(t);
    if (!changes.length) { toast('Change at least one field before saving', 'info'); return false; }
    var note = F.irdNote.trim() ? 'Manual IRD derivation — ' + F.irdNote.trim() : null;
    R.saveCorrection(t, changes, note, WHO, R.nowStamp());
    if (!t.assignee) t.assignee = WHO;
    return true;
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
    'rej-c-network': function (t) { F.network = t.value; viewOverview(); },
    'rej-c-family': function (t) { F.family = t.value; viewOverview(); },
    'rej-c-reason': function (t) { F.reason = t.value; viewOverview(); },
    'rej-c-status': function (t) { F.status = t.value; viewOverview(); },
    'rej-date-preset': function (t) { F.dateMode = t.getAttribute('data-mode'); viewOverview(); },
    'rej-c-date-on': function (t) { F.dateOn = t.value; viewOverview(); },
    'rej-c-date-from': function (t) { F.dateFrom = t.value; viewOverview(); },
    'rej-c-date-to': function (t) { F.dateTo = t.value; viewOverview(); },
    'rej-reset': function () {
      F.tenants = {}; F.network = 'all'; F.family = 'all'; F.reason = 'all'; F.status = 'all';
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
    'rej-showall': function () { F.showAll = !F.showAll; viewBatch(); },
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
      F.draft.ird = F.irdManual.trim();
      toast('Manual IRD ' + F.irdManual.trim() + ' staged — save to record it with your note', 'success');
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
  function route(rest) {
    F.modal = null;
    var id = (rest && rest.length) ? rest[0] : null;
    if (id !== F.batchId) { closeEditor(false); F.sel = {}; F.q = ''; F.txnSort = { key: 'status', dir: 'asc' }; }
    F.batchId = id;
    return id ? viewBatch() : viewOverview();
  }

  return { route: route, actions: ACTIONS, ROUTE: ROUTE };
};
