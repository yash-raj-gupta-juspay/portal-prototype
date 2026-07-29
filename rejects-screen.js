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
    network: 'all', family: 'all', reason: 'all',
    dateMode: 'all', dateOn: '', dateFrom: '', dateTo: '',
    sort: { key: 'default', dir: 'desc' },
    // --- batch detail ---
    batchId: null, q: '', sel: {}, txnSort: { key: 'status', dir: 'asc' },
    // Staging rejects carry a second, read-only view of the whole file, because
    // the replacement file will contain all of it (§C.5). Incoming rejects have
    // no such tab — the rest of that cycle already cleared.
    tab: 'rejects',
    // --- correction editor ---
    editing: null, editFrom: null, draft: null, navOrder: null,
    // §C.6 — the declared correction path. Null until the analyst chooses.
    path: null, cfgNote: '', cfgFamily: '',
    irdManual: '', irdNote: '',
    // --- IRD Resolution panel (Mastercard staging IRD rejects) ---
    // irdCards holds per-strategy expand overrides; absent means "follow the
    // recommendation". irdApplied records which strategy staged the current
    // draft IRD, so Save can attach the reasoning note it generated.
    irdCards: {}, irdAttrs: false, irdHistory: false, irdApplied: null,
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

  // Four counts (§C.1). IRD rejects lost their card — they stay legible as a tag
  // on the rows that carry them, which is where the analyst acts on them.
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

    return '<div class="rej-filters">' +
      '<div class="rej-filter-line"><span class="rej-filter-key">Tenant</span>' + tenantChips + '</div>' +
      '<div class="rej-filter-line">' +
      '<label class="field inline">Network <select class="input w-160" data-action="rej-c-network">' +
      ['all', 'Visa', 'Mastercard', 'RuPay'].map(function (n) {
        return '<option value="' + n + '"' + (F.network === n ? ' selected' : '') + '>' + (n === 'all' ? 'All networks' : n) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field inline">Reject family <select class="input w-160" data-action="rej-c-family">' +
      '<option value="all"' + (F.family === 'all' ? ' selected' : '') + '>All families</option>' +
      '<option value="staging"' + (F.family === 'staging' ? ' selected' : '') + '>Staging</option>' +
      '<option value="incoming"' + (F.family === 'incoming' ? ' selected' : '') + '>Incoming</option>' +
      '</select></label>' +
      '<label class="field inline">Reason code <select class="input w-320" data-action="rej-c-reason">' +
      '<option value="all"' + (F.reason === 'all' ? ' selected' : '') + '>All reason codes</option>' + reasonOpts + '</select></label>' +
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

  function txnTable(b) {
    var list = visibleTxns(b);
    if (!list.length) {
      return emptyState('search-x', 'No transactions match',
        F.q ? 'No ARN in this batch contains “' + esc(F.q) + '”. Clear the search to see all ' + openTxnCount(b) + '.'
          : (b.family === 'incoming' && clearedHidden(b)
            ? 'Every reject in this batch has cleared. Cleared transactions are not listed here.'
            : 'This batch has no rejected transactions.'));
    }
    var allSel = list.every(function (t) { return F.sel[t.id]; });
    var rows = list.map(function (t) {
      return '<tr class="' + (t.status === 're_rejected' ? 'rej-row-rerejected' : '') +
        (t.status === 'wont_fix' ? ' rej-row-terminal' : '') +
        (t.status === 'awaiting_config' ? ' rej-row-awaiting' : '') + '">' +
        '<td class="pick-cell sticky-pick" onclick="event.stopPropagation()">' +
        '<input type="checkbox"' + (F.sel[t.id] ? ' checked' : '') + ' data-action="rej-c-pick" data-id="' + t.id + '" aria-label="Select ' + esc(t.arn) + '" /></td>' +
        '<td class="sticky-arn">' + arnCell(t.arn) + '</td>' +
        '<td><div class="cell-main">' + esc(t.merchant) + '</div><div class="cell-sub mono">' + esc(t.mid) + '</div></td>' +
        '<td class="num nowrap">' + moneyOf(t) + '</td>' +
        '<td class="nowrap"><div class="num">' + U.prettyDate(t.txnDate) + '</div><div class="cell-sub num">' + esc(t.txnTime) + ' IST</div></td>' +
        '<td>' + reasonCell(t) + '</td>' +
        '<td>' + statusPill(t) + manualTag(t.manualTag) +
        (t.status === 'awaiting_config' && t.configRequest
          ? '<div class="cell-sub rej-cfg-line">' + icon('settings', 12) +
          esc(t.configRequest.familyLabel || 'Config or code change') + '</div>' : '') + '</td>' +
        '<td class="cell-sub">' + (t.assignee ? esc(t.assignee) : '—') + '</td>' +
        '<td class="nowrap">' +
        // A transaction blocked on a config change has one action worth taking
        // from the table: the re-derive that unblocks it once the config lands.
        (t.status === 'awaiting_config'
          ? '<button class="btn btn-sm btn-secondary" data-action="rej-rederive" data-id="' + t.id + '" ' +
          'title="Recompute this transaction from the corrected config">' + icon('refresh-cw', 14) + 'Config updated — re-derive</button>' +
          '<button class="btn btn-sm btn-ghost" data-action="rej-edit" data-id="' + t.id + '">' + icon('pencil', 14) + 'Edit</button>'
          : '<button class="btn btn-sm btn-secondary" data-action="rej-edit" data-id="' + t.id + '">' + icon('pencil', 14) + 'Edit</button>') +
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
      '<span>Read-only. Showing <span class="num">' + s.shown + '</span> of <span class="num">' + num(s.total) +
      '</span> transactions — every reject in this batch (<span class="num">' + s.rejects + '</span>), then a sample of the untouched remainder. ' +
      'The replacement file carries all <span class="num">' + num(s.total) + '</span>.</span></div>' +
      '<div class="table-wrap rej-txn-wrap"><table class="data rej-txns"><thead><tr>' +
      '<th class="sticky-arn">ARN</th><th>Merchant</th><th class="num">Amount</th>' +
      '<th>Transaction date</th><th>Reason code</th><th>In replacement file</th>' +
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
    var model = R.regenModel(b);
    if (!b.generated.length) {
      return cardBox('Generated clearing files',
        '<div class="meta">No clearing file has been generated for this batch yet. ' +
        'Correct at least one transaction, then use <strong>' + esc(model.action) + '</strong> above.</div>');
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
    return cardBox('Generated clearing files',
      '<div class="meta mb-16">Append-only. Every file generated for this batch stays on the record with who produced it, how it was delivered and what the network did with it — corrections are never overwritten.</div>' +
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
      setView('<div class="page-head"><div><h1 class="page-title">Rejects</h1></div></div>' +
        '<div class="card">' + emptyState('file-warning', 'Reject batch not found',
          'That batch id is not in the last 30 days of reject files.',
          '<button class="btn btn-secondary" data-route="' + ROUTE + '">Back to Rejects</button>') + '</div>');
      return;
    }
    var corrected = R.correctedTxns(b);
    var model = R.regenModel(b);
    var awaiting = R.awaitingConfigTxns(b);
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
      // §C.5 — the action says which file it produces. The two are not
      // interchangeable, and a single generic label is how the wrong one gets
      // sent.
      '<button class="btn btn-primary" data-action="rej-gen-open"' + (corrected.length ? '' : ' disabled') +
      ' title="' + (corrected.length
        ? (model.key === 'replacement'
          ? 'Generate a complete replacement file — all ' + num(b.fileTxns) + ' transactions, with ' + corrected.length + ' correction(s) applied in place'
          : 'Generate a supplementary file containing the ' + corrected.length + ' corrected reject(s)')
        : 'Correct at least one transaction first') + '">' +
      icon('file-plus', 16) + esc(model.action) + (corrected.length ? ' <span class="num">(' + corrected.length + ')</span>' : '') + '</button>' +
      '<button class="btn btn-secondary" data-action="rej-export">' + icon('table', 16) + 'Export rejects</button>' +
      '</div></div>';

    /* §C.5 — which regeneration model applies, stated before anything else on
       the page. It sits alongside the staging blocking banner rather than
       replacing it: one says the cycle is stuck, the other says what the file
       you are about to produce will contain. */
    var modelBanner = '<div class="rej-model rej-model-' + model.key + '">' +
      icon(model.key === 'replacement' ? 'files' : 'file-plus', 20) +
      '<div class="rej-model-body"><strong>' + esc(model.banner) + '</strong>' +
      '<div class="rej-model-detail">' + (model.key === 'replacement'
        ? 'Regeneration produces one file containing all <span class="num">' + num(b.fileTxns) +
        '</span> transactions from <code class="mono">' + esc(b.clearingFile) + '</code>, with the corrections applied in place. ' +
        'It supersedes the original — it is not a delta appended to it.'
        : 'Regeneration produces a small file containing only the corrected rejects. ' +
        'The <span class="num">' + num(Math.max(0, b.fileTxns - b.txns.length)) + '</span> transactions that already cleared are not resubmitted.') +
      '</div></div>' +
      '<span class="rej-model-tag">' + esc(model.tag) + '</span></div>';

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

    var hidden = clearedHidden(b);
    var toolbar = '<div class="rej-toolbar">' +
      '<label class="rej-search">' + icon('search', 15) +
      '<input class="input" type="text" placeholder="Search by ARN" value="' + esc(F.q) + '" data-action="rej-i-q" aria-label="Search by ARN" />' +
      '</label>' +
      '<span class="meta">Sorted with re-rejected and new first. Click any column to re-sort.' +
      (hidden ? ' <span class="num">' + hidden + '</span> cleared transaction' + (hidden === 1 ? '' : 's') +
        ' are not listed — this table is what still needs work.' : '') + '</span>' +
      '</div>';

    // §C.5 — a staging reject gets a second, read-only view of the whole file.
    // An incoming reject does not: the rest of that cycle already cleared.
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

    var awaitingBanner = awaiting.length
      ? '<div class="callout warn rej-awaiting-banner">' + icon('settings', 18) +
      '<div class="callout-body"><strong><span class="num">' + awaiting.length + '</span> transaction' +
      (awaiting.length === 1 ? ' is' : 's are') + ' awaiting a config fix.</strong> ' +
      'They are being worked, but not here — the derivation that produced their values has to change first. ' +
      'They are excluded from the <span class="num">' + corrected.length + '</span> ready to regenerate until someone re-derives them.</div></div>'
      : '';

    var body = tab === 'file'
      ? '<div class="card mt-24">' +
      '<div class="card-head"><div class="card-title">All transactions in file <span class="meta num">(' + num(b.fileTxns) + ')</span></div></div>' +
      tabs + fileTable(b) + '</div>'
      : '<div class="card mt-24">' +
      '<div class="card-head"><div class="card-title">Rejected transactions <span class="meta num">(' + openTxnCount(b) + ')</span></div></div>' +
      tabs + toolbar + bulkBar(b) +
      '<div id="rej-txn-mount">' + txnTable(b) + '</div>' +
      '</div>';

    setView(
      head + modelBanner + banner + awaitingBanner +
      '<div class="mt-24">' + cycleContext(b) + '</div>' +
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

  /* §C.6 — the reason code is a hint now, not a gate. It marks the field it
     points at and says so; every field on the record stays editable, because
     the analyst has already declared that this is a transaction-data fix. */
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
      '<div class="rej-field-label">' + esc(def.label) +
      (hinted ? '<span class="rej-field-hint-dot" title="Reason code ' + esc(t.reasonCode) + ' relates to this field">' +
        icon('target', 11) + 'reason ' + esc(t.reasonCode) + '</span>' : '') +
      (changed ? '<span class="rej-changed-dot" title="Edited">' + icon('circle', 10) + 'edited</span>' : '') + '</div>' +
      '<div class="rej-field-current"><span class="rej-field-key">current</span>' +
      '<span class="' + (def.mono ? 'mono ' : '') + 'num">' + (cur === '' ? '<em class="rej-empty">empty</em>' : esc(cur)) + '</span></div>' +
      '<div class="rej-field-input">' + input + '</div>' +
      (hinted ? '<div class="rej-field-hint">' + icon('corner-down-right', 12) +
        'Reason code ' + esc(t.reasonCode) + ' relates to this field — a hint, not a restriction. Every field here is editable.</div>' : '') +
      (def.help ? '<div class="rej-field-help">' + esc(def.help) + '</div>' : '') +
      '</div>';
  }

  /* The full entity record, grouped. The reason code's fields are marked in
     place rather than lifted to the top: a wrong MCC and a wrong acceptor city
     read as one record, and pulling two fields out of it made the other
     twenty look like somewhere you should not go. */
  function fieldEditor(t) {
    var rel = R.relevantFields(t.reasonCode);
    return '<div class="rej-field-groups">' + R.groupedFields().map(function (g) {
      var marked = g.fields.filter(function (k) { return rel.indexOf(k) >= 0; }).length;
      return '<div class="rej-fgroup">' +
        '<div class="rej-fgroup-head"><span class="rej-fgroup-name">' + esc(g.group) + '</span>' +
        (marked ? '<span class="rej-fgroup-flag">' + icon('target', 11) + '<span class="num">' + marked + '</span> flagged by reason ' + esc(t.reasonCode) + '</span>' : '') +
        (g.note ? '<span class="rej-fgroup-note">' + esc(g.note) + '</span>' : '') + '</div>' +
        g.fields.map(function (k) { return fieldRow(t, k, rel.indexOf(k) >= 0); }).join('') +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---- The config-or-code path (§C.6) ------------------------------------
     Nothing here edits the transaction, because the transaction is not what is
     wrong. What it collects is the description of the change, where it belongs
     and a way to get there — then it parks the reject in a state that says
     exactly that. */
  function configPathPanel(t) {
    var famOpts = R.CONFIG_FAMILIES.map(function (f) {
      return '<option value="' + f.key + '"' + (F.cfgFamily === f.key ? ' selected' : '') + '>' + esc(f.label) + '</option>';
    }).join('');
    var fam = R.configFamily(F.cfgFamily);
    var route = fam ? fam.route : '#/dashboard/ops/configs';
    var already = t.status === 'awaiting_config' && t.configRequest;

    return '<div class="rej-cfg-panel">' +
      '<div class="rej-cfg-head">' + icon('settings', 16) + '<strong>Update config or code</strong>' +
      '<span class="meta">This fix cannot be completed here. It changes how the value is derived, so it affects more than this transaction.</span></div>' +

      (already
        ? '<div class="rej-cfg-existing">' + icon('clock', 15) +
        '<div><strong>Already marked as awaiting a config fix</strong> by ' + esc(t.configRequest.by) +
        ' on <span class="num">' + esc(t.configRequest.at) + '</span>' +
        (t.configRequest.familyLabel ? ' · ' + esc(t.configRequest.familyLabel) : '') +
        '<div class="rej-cfg-existing-note">' + esc(t.configRequest.note) + '</div></div></div>'
        : '') +

      '<label class="field rej-cfg-note">What needs to change? <span class="req">required</span>' +
      '<textarea class="input" rows="3" data-action="rej-i-cfg-note" ' +
      'placeholder="e.g. The MCC mapping for this acquirer BIN still points at the 2024 ISO 18245 table — 5732 is being emitted as 9732 for every consumer-electronics merchant on this tenant.">' +
      esc(F.cfgNote) + '</textarea></label>' +

      '<div class="rej-cfg-row">' +
      '<label class="field inline">Where does the fix belong? <span class="meta">optional</span>' +
      '<select class="input w-260" data-action="rej-c-cfg-family">' +
      '<option value=""' + (F.cfgFamily ? '' : ' selected') + '>Not sure yet</option>' + famOpts +
      '<option value="code"' + (F.cfgFamily === 'code' ? ' selected' : '') + '>A code change — not a config</option>' +
      '</select></label>' +
      (F.cfgFamily === 'code'
        ? '<span class="meta rej-cfg-code">' + icon('git-branch', 13) + 'Raise this with platform engineering — there is no config surface for it.</span>'
        : '<a class="rej-cfg-link" data-route="' + route + '">Open Platform Configs' + icon('arrow-right', 14) + '</a>') +
      '</div>' +

      '<div class="rej-cfg-foot">' +
      '<div class="meta">' + icon('info', 13) +
      '<span>Marking this moves the transaction to <strong>Awaiting config fix</strong>. It stays open, stays counted, and is excluded from ' +
      'the ready-to-regenerate set until the config lands and you re-derive it.</span></div>' +
      '<button class="btn btn-primary" id="rej-cfg-mark" data-action="rej-mark-config"' + (F.cfgNote.trim() ? '' : ' disabled') + '>' +
      icon('settings', 15) + 'Mark as awaiting config change</button>' +
      '</div></div>';
  }

  /* Step 1 of the editor: what kind of fix is this? Nothing below appears
     until it is answered, because the answer decides what "below" is. */
  function pathCards(t) {
    var cards = ['data', 'config'].map(function (k) {
      var p = R.PATHS[k];
      var on = F.path === k;
      return '<button class="rej-path-card' + (on ? ' on' : '') + '" data-action="rej-path" data-path="' + k + '" ' +
        'aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="rej-path-top">' + icon(p.icon, 16) + '<span class="rej-path-title">' + esc(p.label) + '</span>' +
        (on ? '<span class="rej-path-check">' + icon('check', 14) + '</span>' : '') + '</span>' +
        '<span class="rej-path-blurb">' + esc(p.blurb) + '</span>' +
        '</button>';
    }).join('');
    return '<div class="cfg-section-title mt-24">Choose correction path ' +
      '<span class="meta">— recorded on the correction and kept in attempt history</span></div>' +
      '<div class="rej-path-cards">' + cards + '</div>' +
      (F.path
        ? '<div class="rej-path-long">' + icon(R.PATHS[F.path].icon, 13) + esc(R.PATHS[F.path].long) + '</div>'
        : '<div class="rej-path-prompt">' + icon('help-circle', 15) +
        '<span>Pick one to continue. A value that is wrong only here is a transaction-data fix; a value that is wrong because of how it was derived is a config or code fix, and correcting it here would only mask it until the next cycle.</span></div>');
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

  var LADDER_DIGIT = ['①', '②', '③', '④'];
  var STATE_PILL = {
    open: ['Available', 'neutral', 'circle-dot'],
    exhausted: ['Exhausted', 'neutral', 'ban'],
    na: ['Not applicable', 'neutral', 'minus']
  };

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

  /* ---- Ladder position indicator (Part 3.3) ------------------------------ */
  function ladderRail(res) {
    var steps = res.strategies.map(function (s, i) {
      var cls = s.recommended ? 'current' : s.state;
      if (s.n === 4) cls += ' fallback';
      var title = s.n + ' · ' + s.name + ' — ' +
        (s.recommended ? 'the step to try next' : (s.state === 'na' ? 'not applicable to this transaction'
          : (s.state === 'exhausted' ? 'every option tried and rejected' : 'available, not needed yet')));
      return '<span class="rej-lad-step">' +
        '<span class="rej-lad-node ' + cls + '" title="' + esc(title) + '">' + LADDER_DIGIT[i] + '</span>' +
        '<span class="rej-lad-caret">' + (s.recommended ? '▲' : '') + '</span></span>';
    });
    var rail = '';
    steps.forEach(function (s, i) {
      if (i) rail += '<span class="rej-lad-link' + (res.strategies[i - 1].state === 'exhausted' ? ' spent' : '') + '"></span>';
      rail += s;
    });

    var caption;
    if (!res.recommended) {
      caption = 'Every strategy is exhausted or not applicable. Derive the IRD by hand below.';
    } else if (res.recommended.n === 4) {
      caption = 'Every precise strategy is exhausted or not applicable — only the broader fallback is left, and it costs more.';
    } else {
      // How much runway is left, and — when there is none — why. A ladder that
      // is short because two rungs never applied is a different situation from
      // one that is short because they were spent, and reads as a surprise
      // unless the caption says which.
      var below = res.strategies.filter(function (s) { return s.n > res.recommended.n && s.n < 4; });
      var left = below.filter(function (s) { return s.state === 'open'; }).length;
      var lead = 'At strategy ' + res.recommended.n + ' · ';
      if (left) {
        caption = lead + (left === 1 ? '1 more precise step' : left + ' more precise steps') + ' before the costly fallback.';
      } else if (below.length && below.every(function (s) { return s.state === 'na'; })) {
        caption = lead + 'strateg' + (below.length > 1 ? 'ies ' : 'y ') +
          below.map(function (s) { return s.n; }).join(' and ') +
          ' do' + (below.length > 1 ? '' : 'es') + ' not apply to this transaction, so the only step after this one is the costly fallback.';
      } else {
        caption = lead + 'the last precise step — everything below it is exhausted or does not apply.';
      }
    }
    return '<div class="rej-lad"><div class="rej-lad-rail">' + rail + '</div>' +
      '<div class="rej-lad-caption">' + esc(caption) + '</div></div>';
  }

  /* ---- Shared candidate readout at the foot of every strategy card ------- */
  function candidateRow(t, s, res) {
    var cur = t.currency;
    if (s.state === 'na') {
      return '<div class="rej-res-none">' + icon('minus-circle', 15) +
        '<span><strong>Not applicable.</strong> ' + esc(s.na) + '</span></div>';
    }
    if (s.state === 'exhausted') {
      return '<div class="rej-res-none">' + icon('ban', 15) +
        '<span><strong>Exhausted.</strong> Every option this strategy had has been submitted and rejected for this transaction.</span></div>';
    }
    var o = s.next;
    var applied = stagedIrd(t) === o.ird;
    var delta = res.best ? o.fee - res.best.fee : 0;
    var confKind = s.n === 1 ? 'success' : (s.n === 2 ? 'info' : (s.n === 3 ? 'neutral' : 'warning'));
    return '<div class="rej-cand' + (s.n === 4 ? ' warn' : '') + '">' +
      '<div class="rej-cand-head">' + resKey('Candidate IRD') + irdBig(o.ird) +
      pill(s.confidence, confKind, s.n === 4 ? 'alert-triangle' : 'gauge') +
      (applied ? '<span class="rej-res-applied">' + icon('check', 13) + 'Applied to the IRD field</span>' : '') +
      '</div>' +
      '<div class="rej-cand-nums">' +
      '<span>' + resKey('Rate') + rateSpan(o.rate) + '</span>' +
      '<span>' + resKey('Fee on this txn') + feeSpan(o.fee, cur) + '</span>' +
      '<span>' + resKey('vs best') + deltaSpan(delta, cur) + '</span>' +
      '</div>' +
      '<button class="btn btn-sm ' + (s.n === 4 ? 'btn-secondary rej-btn-warn' : 'btn-primary') + '" ' +
      'data-action="rej-res-apply" data-n="' + s.n + '"' + (applied ? ' disabled' : '') + '>' +
      icon(applied ? 'check' : 'corner-down-right', 14) + (applied ? 'Applied' : 'Apply this IRD') + '</button>' +
      '</div>';
  }

  // Option rows shared by strategies 2 and 3 — priority list and ranked
  // candidate list are the same table with a different first column.
  function optionTable(t, s, headLabel, keyOf) {
    var cur = t.currency, staged = stagedIrd(t);
    var nextIrd = s.next ? s.next.ird : null;
    var rows = s.options.map(function (o) {
      var isNext = !o.tried && o.ird === nextIrd;
      var cls = o.tried ? 'tried' : (isNext ? 'next' : '');
      var state = o.tried
        ? '<span class="rej-opt-state tried">' + icon('x', 12) + 'tried, rejected</span>'
        : (staged === o.ird ? '<span class="rej-opt-state applied">' + icon('check', 12) + 'applied</span>'
          : (isNext ? '<span class="rej-opt-state next">' + icon('arrow-right', 12) + 'suggested next</span>'
            : '<span class="rej-opt-state">untried</span>'));
      return '<tr class="' + cls + '">' +
        '<td class="num">' + esc(String(keyOf(o))) + '</td>' +
        (o.gcms != null ? '<td class="mono num">' + esc(o.gcms) + '</td>' : '') +
        '<td><span class="mono num rej-opt-ird">' + esc(o.ird) + '</span></td>' +
        '<td class="num">' + Number(o.rate).toFixed(2) + '%</td>' +
        '<td class="num">' + esc(R.money(o.fee, cur)) + '</td>' +
        '<td>' + state + '</td></tr>';
    }).join('');
    return '<table class="data rej-opt-table"><thead><tr>' +
      '<th>' + esc(headLabel) + '</th>' +
      (s.options[0] && s.options[0].gcms != null ? '<th>Product ID</th>' : '') +
      '<th>IRD</th><th class="num">Rate</th><th class="num">Fee</th><th>State</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function strategyBody(t, s, res) {
    var c = res.ctx, cur = t.currency, body = '';
    body += '<div class="rej-res-lede">' + esc(s.lede) + '</div>';
    body += '<div class="rej-res-why">' + icon('corner-down-right', 13) + '<span>' + esc(s.why) + '</span></div>';

    if (s.n === 1) {
      body += '<div class="rej-gcms-pair">' +
        '<div class="rej-gcms">' + resKey('Submitted') + '<span class="mono num">' + esc(c.submittedGcms) + '</span></div>' +
        '<span class="rej-gcms-arrow">' + icon('arrow-right', 16) + '</span>' +
        '<div class="rej-gcms corrected">' + resKey('Corrected by Mastercard') +
        '<span class="mono num">' + esc(c.correctedGcms || '—') + '</span></div>' +
        '</div>';
      if (s.available) {
        body += '<div class="rej-res-chips">' + resKey('Filters used in the derivation') + chips(c.filters) + '</div>';
        // Strategy 1 has a single option and no table to carry it, so an
        // exhausted card would otherwise never say what it actually tried.
        var o1 = s.options[0];
        if (o1.tried) {
          body += '<div class="rej-res-line">' + resKey('Derived IRD') +
            '<span class="mono num rej-opt-ird struck">' + esc(o1.ird) + '</span>' +
            '<span class="num">' + Number(o1.rate).toFixed(2) + '%</span>' +
            '<span class="num">' + esc(R.money(o1.fee, cur)) + '</span>' +
            '<span class="rej-opt-state tried">' + icon('x', 12) + 'tried, rejected</span></div>';
        }
      }
    } else if (s.n === 2) {
      body += '<div class="rej-res-line">' + resKey('Account range') +
        '<span class="mono">' + esc(c.panRange) + '</span></div>';
      body += optionTable(t, s, 'Priority', function (o) { return o.priority; });
    } else if (s.n === 3) {
      body += '<div class="rej-res-chips">' + resKey('Filter set in play') + chips(c.filters) + '</div>';
      body += optionTable(t, s, 'Rank', function (o) { return o.rank; });
    } else {
      var o4 = s.options[0];
      body += '<div class="rej-res-chips">' + resKey('Matches on') + chips(c.broadMatched) + '</div>';
      body += '<div class="rej-res-chips">' + resKey('Drops') + chips(c.broadDropped, 'dropped') + '</div>';
      body += '<div class="rej-cost">' + icon('alert-triangle', 18) +
        '<div><div class="rej-cost-amt num">' + esc(R.money(s.delta, cur)) + ' more on this transaction</div>' +
        '<div class="rej-cost-sub">IRD <code class="mono">' + esc(o4.ird) + '</code> at <span class="num">' + Number(o4.rate).toFixed(2) + '%</span> ' +
        'against <code class="mono">' + esc(s.bestPrecise.ird) + '</code> at <span class="num">' + Number(s.bestPrecise.rate).toFixed(2) + '%</span> — ' +
        'the best precise candidate' + (s.bestPrecise.tried ? ' this transaction has (already tried and rejected, shown for the rate comparison only)' : '') + '. ' +
        'Fee <span class="num">' + esc(R.money(o4.fee, cur)) + '</span> against <span class="num">' + esc(R.money(s.bestPrecise.fee, cur)) + '</span>.</div></div></div>';
      body += '<div class="rej-res-warnline">' + icon('info', 13) +
        '<span>Higher interchange rate. Use when precise candidates are exhausted.</span></div>';
    }
    return body + candidateRow(t, s, res);
  }

  function strategyCard(t, s, res) {
    var open = F.irdCards[s.n] != null ? F.irdCards[s.n] : !!s.recommended;
    var pillDef = s.recommended ? ['Recommended', 'success', 'target'] : STATE_PILL[s.state];
    var cls = 'rej-scard s-' + s.state + (s.recommended ? ' recommended' : '') + (s.n === 4 ? ' fallback' : '') + (open ? ' open' : '');
    var peek = s.next
      ? '<span class="rej-scard-peek mono num" title="Candidate IRD">' + esc(s.next.ird) + '</span>' +
      '<span class="rej-scard-rate num">' + Number(s.next.rate).toFixed(2) + '%</span>'
      : '<span class="rej-scard-peek muted">—</span>';
    return '<div class="' + cls + '">' +
      '<div class="rej-scard-head" data-action="rej-res-card" data-n="' + s.n + '" role="button" tabindex="0" ' +
      'aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="rej-scard-n num">' + s.n + '</span>' +
      '<span class="rej-scard-name">' + esc(s.name) + '</span>' +
      pill(pillDef[0], pillDef[1], pillDef[2]) +
      '<span class="rej-scard-spacer"></span>' + peek +
      icon(open ? 'chevron-up' : 'chevron-down', 16) +
      '</div>' +
      (open ? '<div class="rej-scard-body">' + strategyBody(t, s, res) + '</div>' : '') +
      '</div>';
  }

  /* ---- Fee comparison table (Part 3.4) -----------------------------------
     A decision surface, not a summary: every row is directly applicable, so an
     analyst who already knows what they are looking at never has to expand a
     card to act. */
  function feeTable(t, res) {
    var cur = t.currency, staged = stagedIrd(t);
    var rows = res.strategies.map(function (s) {
      var label = '<span class="num">' + s.n + '</span> · ' + esc(s.name);
      if (!s.next) {
        var why = s.state === 'na' ? 'not applicable' : 'exhausted';
        return '<tr class="out"><td>' + label + '</td>' +
          '<td class="mono">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>' +
          '<td><span class="meta">' + why + '</span></td></tr>';
      }
      var o = s.next;
      var delta = res.best ? o.fee - res.best.fee : 0;
      var applied = staged === o.ird;
      return '<tr class="' + (s.recommended ? 'rec' : '') + (s.n === 4 ? ' fallback' : '') + '">' +
        '<td>' + label + (s.recommended ? '<span class="rej-fee-rec">recommended</span>' : '') + '</td>' +
        '<td><span class="mono num rej-opt-ird">' + esc(o.ird) + '</span></td>' +
        '<td class="num">' + Number(o.rate).toFixed(2) + '%</td>' +
        '<td class="num">' + esc(R.money(o.fee, cur)) + '</td>' +
        '<td class="num">' + (delta === 0 ? '—' : (delta > 0 ? '+' : '') + esc(R.money(delta, cur))) + '</td>' +
        '<td><button class="btn btn-sm ' + (applied ? 'btn-secondary' : (s.n === 4 ? 'btn-secondary rej-btn-warn' : 'btn-primary')) + '" ' +
        'data-action="rej-res-apply" data-n="' + s.n + '"' + (applied ? ' disabled' : '') + '>' +
        (applied ? 'Applied' : 'Apply') + '</button></td></tr>';
    }).join('');
    return '<div class="rej-res-sec">' + resKey('Fee comparison') +
      '<span class="meta">— every candidate on this transaction. Apply straight from a row.</span></div>' +
      '<table class="data rej-fee-table"><thead><tr>' +
      '<th>Strategy</th><th>Candidate IRD</th><th class="num">Rate</th><th class="num">Fee on this txn</th><th class="num">vs best</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="meta mt-8">“vs best” is measured against ' +
      (res.best ? '<code class="mono">' + esc(res.best.ird) + '</code>, the cheapest candidate an analyst can pick right now.' : 'nothing — no candidate is left to pick.') +
      '</div>';
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
        '<td>' + (r.outcome === 'Rejected' ? pill('Rejected', 'danger', 'x') : pill('Pending', 'warning', 'clock')) + '</td></tr>';
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
      '<th>Attempt</th><th>IRD applied</th><th>Strategy used</th><th>Applied by</th><th>Applied at</th><th>Outcome</th>' +
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

  function irdResolutionPanel(t) {
    var res = R.resolveIrd(t);
    if (!res) return '';
    var c = res.ctx, b = currentBatch(), a = t.attrs;
    var submitted = c.rejected[c.rejected.length - 1];
    var earlier = c.rejected.slice(0, -1);

    var head = '<div class="rej-res-head">' +
      '<div class="rej-res-title">' + icon('git-merge', 17) + '<strong>IRD Resolution</strong>' +
      '<span class="rej-res-attempt">Attempt <span class="num">' + t.attempts + '</span></span></div>' +
      '<div class="meta">' + esc(b.network) + ' staging reject · <span class="mono">' + esc(t.reasonCode) + '</span> ' +
      esc(R.reasonText(t.reasonCode)) + '</div></div>';

    var strip = '<div class="rej-res-strip">' +
      '<span class="rej-res-strip-cell">' + resKey('Submitted IRD') + irdBig(submitted, 'rej-ird-bad') + '</span>' +
      '<span class="rej-res-strip-cell">' + resKey('ARN') + arnCell(t.arn) + '</span>' +
      (earlier.length
        ? '<span class="rej-res-strip-cell wide">' + resKey('Also tried and rejected') +
        earlier.map(function (code) {
          return '<span class="rej-ird-dead mono" title="Submitted on an earlier attempt and rejected — excluded from every strategy below">' +
            esc(code) + icon('x', 12) + '</span>';
        }).join('') + '</span>'
        : '') +
      '</div>' +
      (c.rejected.length > 1
        ? '<div class="rej-res-excl">' + icon('shield', 13) +
        '<span>All <span class="num">' + c.rejected.length + '</span> rejected IRDs are excluded from every strategy below, ' +
        'whichever derivation path would produce them.</span></div>'
        : '');

    var attrsBody = '<div class="rej-attr-grid">' +
      [['MCC', R.mccLabel(a.mcc) + ' · ' + a.mcc], ['Region', a.region], ['Card type', a.card],
      ['POS entry mode', a.entry + ' · ' + R.entryLabel(a.entry)], ['Contactless', a.contactless],
      ['PAN range', c.panRange], ['Submitted GCMS product ID', c.submittedGcms],
      ['Corrected GCMS product ID', c.correctedGcms || 'not supplied in the reject summary']]
        .map(function (p) {
          return '<div class="rej-attr"><span class="rej-res-k">' + esc(p[0]) + '</span>' +
            '<span class="rej-attr-v mono num">' + esc(p[1]) + '</span></div>';
        }).join('') + '</div>';

    var cards = '<div class="rej-scards">' + res.strategies.map(function (s) {
      return strategyCard(t, s, res);
    }).join('') + '</div>';

    var burnedList = c.rejected.join(', ');
    var manual = '<div class="rej-res-sec">' + resKey('Manual IRD entry') +
      '<span class="meta">— last resort, when every strategy above is wrong</span></div>' +
      '<div class="rej-ird-manual-row">' +
      '<label class="field">IRD value<input class="input mono w-100" type="text" placeholder="e.g. YB" maxlength="3" ' +
      'value="' + esc(F.irdManual) + '" data-action="rej-i-ird-manual" /></label>' +
      '<label class="field" style="flex:1">Derivation note <span class="req">required</span>' +
      '<input class="input" type="text" placeholder="e.g. Derived against MC interchange manual 2025-Q4 §4.3 — merchant is in the petrol programme, which the account range does not carry." ' +
      'value="' + esc(F.irdNote) + '" data-action="rej-i-ird-note" /></label>' +
      '<button class="btn btn-secondary" id="rej-ird-manual-btn" data-action="rej-ird-manual"' +
      (F.irdManual.trim() && F.irdNote.trim() ? '' : ' disabled') + '>' + icon('pencil', 15) + 'Use this IRD</button>' +
      '</div>' +
      '<div class="meta mt-8">A manually entered IRD is tagged as such on the transaction and its note goes into the ' +
      'correction history. <code class="mono">' + esc(burnedList) + '</code> ' + (c.rejected.length > 1 ? 'have' : 'has') +
      ' already been rejected for this transaction and cannot be re-entered.</div>';

    var dead = res.dead
      ? '<div class="callout warn">' + icon('alert-triangle', 18) +
      '<div class="callout-body">Every strategy on the ladder is exhausted or not applicable for this transaction. ' +
      'Derive the IRD by hand against the Mastercard interchange manual and enter it below with a note.</div></div>'
      : '';

    return '<div class="rej-res-panel">' + head + strip +
      fold('rej-res-attrs', 'rej-res-attrs', F.irdAttrs, 'Transaction attributes',
        '— the filter inputs the derivation runs on', attrsBody) +
      ladderRail(res) + dead + cards + feeTable(t, res) + manual +
      fold('rej-res-history', 'rej-res-history', F.irdHistory, 'Attempt history',
        '— every IRD tried on this transaction', attemptHistory(t, res)) +
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

  function editorPanel() {
    var t = editingTxn();
    if (!t) return '';
    var b = currentBatch();
    var list = editableList();
    var idx = editIndex();
    var changes = draftChanges(t);
    var rel = R.relevantFields(t.reasonCode);
    var raw = R.rawMessage(t);

    /* A transaction already parked on a config change opens straight onto the
       action that unblocks it. The block is the whole reason the state exists:
       "nobody has looked at this" and "this is waiting on someone else" are
       different problems and must not look alike. */
    var awaitingBlock = t.status === 'awaiting_config' && t.configRequest
      ? '<div class="rej-awaiting-box">' + icon('settings', 18) +
      '<div class="rej-awaiting-body">' +
      '<strong>Awaiting a config fix' + (t.configRequest.familyLabel ? ' · ' + esc(t.configRequest.familyLabel) : '') + '</strong>' +
      '<div class="rej-awaiting-note">' + esc(t.configRequest.note) + '</div>' +
      '<div class="meta">Raised by ' + esc(t.configRequest.by) + ' on <span class="num">' + esc(t.configRequest.at) + '</span>. ' +
      'Excluded from the ready-to-regenerate count until it is re-derived.</div></div>' +
      '<div class="rej-awaiting-actions">' +
      '<a class="rej-cfg-link" data-route="' + esc((R.configFamily(t.configRequest.family) || {}).route || '#/dashboard/ops/configs') + '">' +
      'Open Platform Configs' + icon('arrow-right', 14) + '</a>' +
      '<button class="btn btn-primary btn-sm" data-action="rej-rederive" data-id="' + t.id + '">' +
      icon('refresh-cw', 15) + 'Config updated — re-derive</button>' +
      '</div></div>'
      : '';

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

    /* §C.6 / §C.7 — the editable half of the panel depends entirely on the
       declared path. The IRD ladder and the recommendation panel live inside
       the transaction-data path, because applying an IRD is a transaction-data
       fix; when the fix is to the derivation logic itself, both are hidden —
       recommending a value for a field you have just said is derived wrongly
       would be the wrong tool at the wrong moment. */
    var workspace = '';
    if (F.path === 'data') {
      workspace =
        (ladderOn(t) ? irdResolutionPanel(t) : '') +
        '<div class="cfg-section-title mt-24">Transaction record ' +
        '<span class="meta">— every field editable; reason ' + esc(t.reasonCode) +
        (rel.length ? ' flags ' + rel.length + ' of them' : ' flags none of them') + '</span></div>' +
        // A Mastercard staging IRD reject resolves through the ladder above; the
        // single-answer recommendation panel would be a second, weaker Apply
        // surface for the same field. Every other IRD reject keeps it.
        (R.isIrd(t.reasonCode) && !ladderOn(t) ? irdPanel(t) : '') +
        fieldEditor(t) +
        '<div class="cfg-section-title mt-24">Change summary <span class="meta">— reviewed before anything is written</span></div>' +
        '<div id="rej-diff">' + diffBlock(t) + '</div>';
    } else if (F.path === 'config') {
      workspace = configPathPanel(t);
    }

    var historyBlock = t.history.length
      ? '<div class="cfg-section-title mt-24">Correction history <span class="meta">— append-only</span></div>' +
      '<div class="rej-history">' + t.history.map(function (h) {
        return '<div class="rej-history-entry">' +
          '<div class="rej-history-head"><span class="num">' + esc(h.at) + '</span> · ' + esc(h.by) +
          (h.path ? '<span class="rej-path-tag">' + icon(R.PATHS[h.path] ? R.PATHS[h.path].icon : 'pencil', 11) +
            esc(R.pathLabel(h.path) || h.path) + '</span>' : '') +
          (h.kind === 'config_request' ? pill('awaiting config fix', 'warning', 'settings') : '') +
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

      attemptBlock + ctx + awaitingBlock + pathCards(t) + workspace + historyBlock +

      '<div class="rej-panel-foot">' +
      '<button class="btn btn-danger btn-sm" data-action="rej-wontfix-open">' + icon('ban', 15) + "Mark as won't fix" + '</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-secondary" data-action="rej-cancel">Cancel</button>' +
      (F.path === 'config' ? '' :
        '<button class="btn btn-secondary" id="rej-save-next" data-action="rej-save-next"' + (canSave && nextTarget ? '' : ' disabled') +
        ' title="' + (nextTarget ? 'Save and open the next uncorrected transaction' : 'No uncorrected transaction left in this batch') + '">' +
        icon('skip-forward', 15) + 'Save and next</button>' +
        '<button class="btn btn-primary" id="rej-save" data-action="rej-save"' + (canSave ? '' : ' disabled') +
        ' title="' + (F.path ? 'Save the edited fields and move this transaction to Corrected' : 'Choose a correction path first') + '">' +
        icon('save', 15) + 'Save correction</button>') +
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
    F.irdCards = {}; F.irdAttrs = false; F.irdHistory = false; F.irdApplied = null;
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
    F.irdCards = {}; F.irdAttrs = false; F.irdHistory = false; F.irdApplied = null;
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
    'rej-c-network': function (t) { F.network = t.value; viewOverview(); },
    'rej-c-family': function (t) { F.family = t.value; viewOverview(); },
    'rej-c-reason': function (t) { F.reason = t.value; viewOverview(); },
    'rej-date-preset': function (t) { F.dateMode = t.getAttribute('data-mode'); viewOverview(); },
    'rej-c-date-on': function (t) { F.dateOn = t.value; viewOverview(); },
    'rej-c-date-from': function (t) { F.dateFrom = t.value; viewOverview(); },
    'rej-c-date-to': function (t) { F.dateTo = t.value; viewOverview(); },
    'rej-reset': function () {
      F.tenants = {}; F.network = 'all'; F.family = 'all'; F.reason = 'all';
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
    'rej-res-card': function (t) {
      var n = parseInt(t.getAttribute('data-n'), 10);
      var res = R.resolveIrd(editingTxn());
      var was = F.irdCards[n] != null ? F.irdCards[n] : !!(res && res.recommended && res.recommended.n === n);
      F.irdCards[n] = !was;
      viewBatch();
    },
    'rej-res-attrs': function () { F.irdAttrs = !F.irdAttrs; viewBatch(); },
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
