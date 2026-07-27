/* =============================================================================
   Juspay Ops Portal — IRD Reject Resolver (refinement §6)

   The point of this screen: an IRD reject lands after midnight IST for the prior
   day's transactions. Today that means Ops calls Tech, Tech reads Mastercard's
   reject report, works out the right IRD, edits the file and re-stages it. This
   screen lets Ops do it: see which IRDs apply and why, filter down to the right
   one, and recreate / re-stage in one click.

   It wraps existing code rather than replacing it:
     - candidate list  = a dry-run of find_matching_irds (read-only preview —
       it must never emit a file)
     - recreate        = the existing reject-clearing trigger
     - reason text     = rest_api/config/reject_reasons.json

   window.IrdUI(kit) → { route, actions }
   ============================================================================= */
window.IrdUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, R = window.IRDDATA;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, tenantTag = kit.tenantTag,
    slaBadge = kit.slaBadge;

  var ROUTE = '#/dashboard/ops/ird-rejects';

  S.ird = {
    entity: 'all', reason: 'all', date: 'all', irdOnly: true,
    selected: {},            // txn id → true (batch selection)
    open: null,              // txn id being resolved
    chosen: {},              // txn id → ird_code the user picked
    filters: { geography: 'all', program: 'all', showRejected: false },
    applyReason: '',
    result: null,            // last recreate response
    kt: null,                // glossary term open in the drawer
    batchMode: 'single'      // 'single' = one IRD for all, 'per_row' = each row's own
  };

  /* =======================================================================
     Small shared bits
     ======================================================================= */
  // Inline KT: any term in the glossary becomes a hoverable, clickable chip.
  function kt(term, label) {
    var g = R.glossaryByTerm[term];
    if (!g) return esc(label || term);
    return '<button class="kt-term" data-action="ird-kt" data-term="' + esc(term) + '" ' +
      'title="' + esc(g.short) + '">' + esc(label || term) + icon('help-circle', 11) + '</button>';
  }
  function ktTip(term) {
    var g = R.glossaryByTerm[term];
    return g ? ' data-tip="' + esc(g.short) + '"' : '';
  }
  var IRD_STATUS_PILL = {
    missing: ['IRD missing', 'danger', 'circle-slash'],
    wrong: ['IRD wrong', 'warning', 'alert-triangle'],
    blocked: ['Data missing', 'warning', 'help-circle'],
    unresolved: ['Unresolved', 'info', 'clock'],
    resolved: ['Resolved', 'success', 'check'],
    not_ird: ['Not IRD', 'neutral', 'minus']
  };
  function irdPill(r) {
    var d = IRD_STATUS_PILL[R.irdStatus(r)];
    return pill(d[0], d[1], d[2]);
  }
  function agePill(hours) {
    // The whole point is the after-midnight window, so age is front and centre.
    var cls = hours >= 24 ? 'danger' : (hours >= 8 ? 'warning' : 'neutral');
    var txt = hours >= 24 ? Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h' : hours + 'h';
    return '<span class="sla ' + (cls === 'danger' ? 'red' : cls === 'warning' ? 'amber' : 'green') + '">' +
      icon('clock', 13) + txt + '</span>';
  }

  /* =======================================================================
     A · Rejects queue (§6.3 A)
     ======================================================================= */
  function queueRows() {
    var f = S.ird;
    return R.rejects.filter(function (r) {
      if (f.irdOnly && !R.isIrdReason(r.reasonCode)) return false;
      if (f.entity !== 'all' && r.entity !== f.entity) return false;
      if (f.reason !== 'all' && String(r.reasonCode) !== f.reason) return false;
      if (f.date !== 'all' && r.txnDate !== f.date) return false;
      return true;
    });
  }
  function entities() {
    var out = [];
    R.rejects.forEach(function (r) { if (out.indexOf(r.entity) < 0) out.push(r.entity); });
    return out;
  }
  function reasonsPresent() {
    var out = [];
    R.rejects.forEach(function (r) { if (out.indexOf(String(r.reasonCode)) < 0) out.push(String(r.reasonCode)); });
    return out.sort();
  }
  function datesPresent() {
    var out = [];
    R.rejects.forEach(function (r) { if (out.indexOf(r.txnDate) < 0) out.push(r.txnDate); });
    return out.sort().reverse();
  }
  function selectedRows() {
    return queueRows().filter(function (r) { return S.ird.selected[r.id] && !r.resolution; });
  }

  function queueTable() {
    var rows = queueRows();
    if (!rows.length) {
      return emptyState('check-circle', 'Nothing in the reject queue',
        'No transactions match these filters. Clear the filters to see resolved and non-IRD rejects too.');
    }
    var body = rows.map(function (r) {
      var st = R.irdStatus(r);
      var sel = !!S.ird.selected[r.id];
      var resolvable = R.isIrdReason(r.reasonCode) && !r.resolution;
      return '<tr class="clickable' + (r.resolution ? ' resolved-row' : '') + '" data-action="ird-open" data-id="' + r.id + '">' +
        '<td class="pick-cell" onclick="event.stopPropagation()">' +
        (resolvable
          ? '<input type="checkbox"' + (sel ? ' checked' : '') + ' data-action="ird-pick" data-id="' + r.id + '" aria-label="Select ' + esc(r.arn) + '" />'
          : '') + '</td>' +
        '<td><div class="cell-main mono">' + esc(r.arn) + '</div>' +
        '<div class="cell-sub">' + esc(r.merchant) + ' · ' + esc(r.entity) + '</div></td>' +
        '<td class="num nowrap">' + esc(R.money(r.amountMinor, r.currency)) + '</td>' +
        '<td class="nowrap">' + U.prettyDate(r.txnDate) + '</td>' +
        '<td><div class="reason-cell"><span class="mono reason-code">' + esc(r.reasonCode) + '</span>' +
        esc(R.reasonText(r.reasonCode)) + '</div>' +
        '<div class="cell-sub">' + esc(r.status) + '</div></td>' +
        '<td>' + irdPill(r) +
        (r.stagedIrd ? '<div class="cell-sub mono">staged ' + esc(r.stagedIrd) + '</div>' : '<div class="cell-sub">no IRD staged</div>') +
        (st === 'wrong' && R.recommended(r) ? '<div class="cell-sub good-text mono">→ ' + esc(R.recommended(r).ird_code) + '</div>' : '') +
        '</td>' +
        '<td class="nowrap"><div class="mono">' + esc(r.file) + '</div><div class="cell-sub mono">batch ' + esc(r.batch) + '</div></td>' +
        '<td>' + (r.resolution ? pill('re-staged', 'success', 'check') : agePill(r.hoursAgo)) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="data ird-queue"><thead><tr>' +
      '<th></th><th>ARN · merchant</th><th class="num">Amount</th><th>Txn date</th>' +
      '<th>Reject reason</th><th>IRD status</th><th>File · batch</th><th>Age</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function batchBar() {
    var sel = selectedRows();
    if (!sel.length) return '';
    // One corrected IRD across many rejects, or each row's own pick — §6.3.4
    // supports both, so the mode is explicit rather than assumed.
    var common = {};
    sel.forEach(function (r) {
      var rec = R.recommended(r);
      if (rec) common[rec.ird_code] = (common[rec.ird_code] || 0) + 1;
    });
    var codes = Object.keys(common);
    var allChosen = sel.every(function (r) { return S.ird.chosen[r.id]; });
    return '<div class="batch-bar">' +
      icon('layers', 16) +
      '<strong><span class="num">' + sel.length + '</span> selected</strong>' +
      '<div class="mode-toggle">' +
      '<button class="' + (S.ird.batchMode === 'single' ? 'active' : '') + '" data-action="ird-batchmode" data-mode="single">One IRD for all</button>' +
      '<button class="' + (S.ird.batchMode === 'per_row' ? 'active' : '') + '" data-action="ird-batchmode" data-mode="per_row">Per transaction</button>' +
      '</div>' +
      (S.ird.batchMode === 'single'
        ? '<label class="field inline">IRD ' +
        '<select class="input w-220 mono" data-action="ird-batch-ird">' +
        '<option value="">— choose —</option>' +
        codes.map(function (c) {
          return '<option value="' + esc(c) + '"' + (S.ird.batchIrd === c ? ' selected' : '') + '>' + esc(c) +
            '  (recommended for ' + common[c] + ' of ' + sel.length + ')</option>';
        }).join('') + '</select></label>' +
        (codes.length > 1 ? '<span class="tip batch-warn" data-tip="These transactions do not all recommend the same IRD. Applying one code to all of them will override the recommendation on some.">' + icon('alert-triangle', 14) + 'mixed recommendations</span>' : '')
        : '<span class="meta">' + (allChosen ? 'Every selected row has an IRD chosen.' : 'Open each row and choose its IRD, then recreate once.') + '</span>') +
      '<button class="btn btn-primary btn-sm" data-action="ird-batch-apply"' +
      ((S.ird.batchMode === 'single' && !S.ird.batchIrd) || (S.ird.batchMode === 'per_row' && !allChosen) ? ' disabled' : '') + '>' +
      icon('refresh-cw', 15) + 'Apply IRD &amp; recreate file' + '</button>' +
      '<button class="btn btn-secondary btn-sm" data-action="ird-clear-sel">Clear</button>' +
      '</div>';
  }

  function viewQueue() {
    var f = S.ird;
    var all = R.rejects.length, openIrd = R.irdOpen().length, overdue = R.irdOpen().filter(function (r) { return r.hoursAgo >= 24; }).length;

    var stats = '<div class="stat-row ird-stats">' +
      '<div class="stat-card"><span class="sc-label">Open IRD rejects</span><span class="sc-value num">' + openIrd + '</span>' +
      '<span class="sc-sub">reject 2569 / 0011 awaiting a decision</span></div>' +
      '<div class="stat-card' + (overdue ? ' danger' : '') + '"><span class="sc-label">Older than 24h</span><span class="sc-value num">' + overdue + '</span>' +
      '<span class="sc-sub">past the next clearing cycle</span></div>' +
      '<div class="stat-card"><span class="sc-label">All rejects in queue</span><span class="sc-value num">' + all + '</span>' +
      '<span class="sc-sub">staging_reject + incoming_reject</span></div>' +
      '<div class="stat-card"><span class="sc-label">Resolved today</span><span class="sc-value num">' + R.audit.length + '</span>' +
      '<span class="sc-sub">IRD applied and file re-staged</span></div>' +
      '</div>';

    var filters = '<div class="ird-filters">' +
      '<label class="field inline">Entity <select class="input w-160" data-action="ird-f-entity">' +
      '<option value="all">All entities</option>' +
      entities().map(function (e) { return '<option value="' + esc(e) + '"' + (f.entity === e ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field inline">Reject reason <select class="input w-320" data-action="ird-f-reason">' +
      '<option value="all">All reasons</option>' +
      reasonsPresent().map(function (c) {
        return '<option value="' + esc(c) + '"' + (f.reason === c ? ' selected' : '') + '>' + esc(c) + ' — ' + esc(R.reasonText(c)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field inline">Txn date <select class="input w-160" data-action="ird-f-date">' +
      '<option value="all">All dates</option>' +
      datesPresent().map(function (d2) { return '<option value="' + esc(d2) + '"' + (f.date === d2 ? ' selected' : '') + '>' + U.prettyDate(d2) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="cfg-toggle"><input type="checkbox"' + (f.irdOnly ? ' checked' : '') + ' data-action="ird-f-only" /><span>IRD rejects only</span></label>' +
      '<button class="btn btn-secondary btn-sm" style="margin-left:auto" data-action="ird-kt" data-term="IRD">' + icon('book-open', 15) + 'What is an IRD?</button>' +
      '</div>';

    setView(
      '<div class="page-head">' +
      '<div><h1 class="page-title">IRD Reject Resolver</h1>' +
      '<div class="subtitle">Mastercard rejects a staged transaction when the Interchange Rate Designator is wrong or missing. Pick the right one here and re-stage the file — no Tech escalation, no 12 AM call.</div></div>' +
      '</div>' +
      stats +
      '<div class="card">' + filters + batchBar() + queueTable() + '</div>' +
      (R.audit.length ? auditCard() : '') +
      (S.ird.open ? resolverPanel(S.ird.open) : '') +
      (S.ird.kt ? ktDrawer(S.ird.kt) : '')
    );
  }

  function auditCard() {
    var rows = R.audit.slice(0, 8).map(function (a) {
      return '<tr><td class="nowrap">' + esc(a.at) + '</td>' +
        '<td class="mono">' + esc(a.arn) + '</td>' +
        '<td class="mono">' + (a.previousIrd ? esc(a.previousIrd) : '<span class="meta">none</span>') + ' → <strong>' + esc(a.ird) + '</strong></td>' +
        '<td>' + esc(a.by) + '</td>' +
        '<td class="cell-sub">' + esc(a.reason || '—') + '</td>' +
        '<td class="mono cell-sub">' + esc(a.fileUuid) + '</td></tr>';
    }).join('');
    return cardBox('Audit trail',
      '<div class="meta mb-16">Every applied IRD is recorded with who applied it, what it replaced, why, and the candidate list they were shown at the time.</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>ARN</th><th>IRD</th><th>By</th><th>Reason</th><th>Recreated file</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>');
  }

  /* =======================================================================
     B · Resolver panel (§6.3 B)
     ======================================================================= */
  function ctxCell(label, value, term, sub) {
    return '<div class="ctx-cell">' +
      '<span class="ctx-label">' + (term ? kt(term, label) : esc(label)) + '</span>' +
      '<span class="ctx-value' + (value ? '' : ' unknown') + '">' + (value ? esc(value) : 'not resolved') + '</span>' +
      (sub ? '<span class="ctx-sub">' + esc(sub) + '</span>' : '') +
      '</div>';
  }

  function contextBlock(r) {
    var c = r.context;
    if (!c) {
      return '<div class="callout" style="background:var(--bg-subtle);border:1px solid var(--border-default)">' + icon('info', 18) +
        '<div class="callout-body">This reject is not IRD-related (' + esc(r.reasonCode) + ' — ' + esc(R.reasonText(r.reasonCode)) +
        '), so no IRD context was resolved for it.</div></div>';
    }
    return '<div class="ctx-grid">' +
      ctxCell('Card (masked)', c.pan_masked, null, 'BIN ' + c.card_bin) +
      ctxCell('MCC', c.mcc, null, c.mcc_desc) +
      ctxCell('Amount', R.money(c.amount_minor_units, r.currency)) +
      ctxCell('Auth date', U.prettyDate(r.authDate)) +
      ctxCell('Geography', c.geography, 'Geography',
        c.acquirer_region || c.issuer_region ? 'acquirer region ' + (c.acquirer_region || '?') + ' · issuer region ' + (c.issuer_region || '?') : null) +
      ctxCell('Acquirer country', c.acquirer_country_alpha3) +
      ctxCell('GCMS Product ID', c.gcms_product_id, 'GCMS Product ID') +
      ctxCell('Card Program', c.card_program_id, 'Card Program') +
      ctxCell('Account Range', c.account_range, 'Account Range') +
      ctxCell('AB programs', (c.ab_programs || []).join(', '), 'AB programs') +
      ctxCell('MTI', c.mti, null, 'message type') +
      ctxCell('Processing code', String(c.processing_code), null, 'DE3 SF1') +
      ctxCell('Function code', String(c.function_code), null, 'DE24') +
      '</div>';
  }

  function errorBlock(r) {
    if (!r.error) return '';
    var e = R.IRD_ERRORS[r.error] || { title: r.error, plain: '', action: '' };
    // Never dead-end: say what is missing, in plain words, and what to do next.
    return '<div class="callout warning ird-error">' + icon('alert-triangle', 20) +
      '<div class="callout-body">' +
      '<strong>' + esc(e.title) + '</strong>' +
      '<div style="margin-top:6px">' + esc(e.plain) + '</div>' +
      '<div class="ird-error-action">' + icon('arrow-right', 14) + esc(e.action) + '</div>' +
      '<div class="meta" style="margin-top:6px">Matcher error: <code>' + esc(r.error) + '</code> — ' + esc(e.technical) + '</div>' +
      '</div></div>';
  }

  function candidateFilters(r) {
    var f = S.ird.filters;
    var geos = [], progs = [];
    (r.candidates || []).forEach(function (c) {
      if (geos.indexOf(c.geography) < 0) geos.push(c.geography);
      (c.card_program_ids || []).forEach(function (p) { if (progs.indexOf(p) < 0) progs.push(p); });
    });
    return '<div class="cand-filters">' +
      '<label class="field inline">Geography <select class="input w-160" data-action="ird-cf-geo">' +
      '<option value="all">All</option>' +
      geos.map(function (g) { return '<option value="' + esc(g) + '"' + (f.geography === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field inline">Card program <select class="input w-160" data-action="ird-cf-prog">' +
      '<option value="all">All</option>' +
      progs.map(function (p) { return '<option value="' + esc(p) + '"' + (f.program === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="cfg-toggle"><input type="checkbox"' + (f.showRejected ? ' checked' : '') + ' data-action="ird-cf-rejected" /><span>Show candidates the matcher rejected</span></label>' +
      '</div>';
  }

  function candidateList(r) {
    var f = S.ird.filters;
    var rec = R.recommended(r);
    var chosen = S.ird.chosen[r.id] || (rec ? rec.ird_code : null);
    var list = R.ranked(r).filter(function (c) {
      var rejected = c.reasons.some(R.isReject);
      if (rejected && !f.showRejected) return false;
      if (f.geography !== 'all' && c.geography !== f.geography) return false;
      if (f.program !== 'all' && (c.card_program_ids || []).indexOf(f.program) < 0) return false;
      return true;
    });
    if (!list.length) {
      return emptyState('search-x', 'No candidates match these filters',
        'Widen the geography or card-program filter, or switch on "show candidates the matcher rejected" to see why each was ruled out.');
    }
    var tie = R.hasTie(r);
    return list.map(function (c) {
      var rejected = c.reasons.some(R.isReject);
      var isRec = rec && c.ird_id === rec.ird_id;
      var isChosen = chosen === c.ird_code;
      return '<div class="cand' + (isChosen ? ' chosen' : '') + (rejected ? ' rejected' : '') + '">' +
        '<label class="cand-pick">' +
        '<input type="radio" name="irdpick" value="' + esc(c.ird_code) + '"' + (isChosen ? ' checked' : '') +
        ' data-action="ird-choose" data-id="' + r.id + '" data-code="' + esc(c.ird_code) + '" />' +
        '</label>' +
        '<div class="cand-body">' +
        '<div class="cand-head">' +
        '<span class="ird-code mono">' + esc(c.ird_code) + (c.variant ? '<span class="ird-variant">' + esc(c.variant) + '</span>' : '') + '</span>' +
        '<span class="cand-desc">' + esc(c.description) + '</span>' +
        (isRec ? pill('Recommended', 'success', 'star') : '') +
        (rejected ? pill('Ruled out', 'danger', 'x-circle') : '') +
        (r.stagedIrd === c.ird_code ? pill('Currently staged', 'neutral', 'file') : '') +
        '<span class="cand-score' + (rejected ? ' zero' : '') + '">score <b class="num">' + c.score + '</b></span>' +
        '</div>' +
        '<div class="cand-meta">' +
        '<span>' + esc(c.geography) + '</span>' +
        '<span>programs ' + esc((c.card_program_ids || []).join(', ') || '—') + '</span>' +
        '<span>products ' + esc((c.gcms_product_ids || []).join(', ') || '—') + '</span>' +
        '<span>effective ' + esc(c.effective_from) + ' → ' + esc(c.effective_to || 'open') + '</span>' +
        '<span class="mono">ird_id ' + c.ird_id + ' · ' + esc(c.source_version) + '</span>' +
        '</div>' +
        '<div class="cand-reasons">' + c.reasons.map(function (line) {
          var bad = R.isReject(line);
          return '<div class="reason ' + (bad ? 'bad' : 'ok') + '">' + icon(bad ? 'x' : 'check', 12) +
            esc(line.replace(/^(OK|REJECT):\s*/, '')) + '</div>';
        }).join('') + '</div>' +
        '</div></div>';
    }).join('') +
      (tie ? '<div class="callout warning mt-16">' + icon('alert-triangle', 18) +
        '<div class="callout-body">Two candidates share the top score. The matcher breaks the tie on <code>ird_code</code> alphabetically, so the recommendation here is deterministic but not decisive — read both reason lists before accepting it.</div></div>' : '');
  }

  function resolverPanel(id) {
    var r = R.byId[id]; if (!r) return '';
    var rec = R.recommended(r);
    var chosen = S.ird.chosen[r.id] || (rec ? rec.ird_code : null);
    var res = r.resolution;

    var footer = res
      ? '<div class="resolve-result">' + icon('check-circle', 20) +
      '<div><strong>Applied and re-staged.</strong>' +
      '<div class="rr-grid">' +
      '<span>IRD</span><span class="mono">' + (res.previousIrd ? esc(res.previousIrd) : 'none') + ' → <strong>' + esc(res.ird) + '</strong></span>' +
      '<span>Status</span><span class="mono">' + esc(res.status) + '</span>' +
      '<span>New file</span><span class="mono">' + esc(res.fileUuid) + '</span>' +
      '<span>Cycle decision</span><span class="mono">' + esc(res.cycleDecision) + '</span>' +
      '<span>Clearing triggered</span><span>' + (res.clearingTriggered ? pill('yes', 'success', 'check') : pill('waiting for next cycle', 'warning', 'clock')) + '</span>' +
      '</div></div></div>'
      : '<div class="resolve-foot">' +
      '<label class="field" style="flex:1">Why this IRD? <span class="req">required</span>' +
      '<input class="input" placeholder="e.g. Supermarket programme applies — merchant is in F900 and the amount is under the 20,000 threshold" ' +
      'value="' + esc(S.ird.applyReason) + '" data-action="ird-reason" /></label>' +
      '<button class="btn btn-primary" data-action="ird-apply" data-id="' + r.id + '"' +
      (!chosen || !S.ird.applyReason.trim() ? ' disabled' : '') + '>' +
      icon('refresh-cw', 16) + 'Apply IRD ' + (chosen ? esc(chosen) + ' ' : '') + '&amp; recreate file</button>' +
      '</div>' +
      '<div class="meta hint-row">' + icon('shield', 13) +
      '<span>Recreating a live clearing file is a sensitive action. This build records a full audit entry (who, which IRD, which ARN, and the candidate list shown at the time) — wire it to maker-checker instead if policy requires an approver.</span></div>';

    return '<div class="overlay" data-action="ird-close">' +
      '<div class="side-panel wide ird-panel" onclick="event.stopPropagation()">' +
      '<div class="modal-head">' +
      '<div><div class="section-title">Resolve IRD reject</div>' +
      '<div class="meta mono">' + esc(r.arn) + ' · ' + esc(r.merchant) + ' · ' + esc(R.money(r.amountMinor, r.currency)) + '</div></div>' +
      '<button class="icon-btn" data-action="ird-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +

      '<div class="reject-summary">' +
      '<span class="mono reason-code">' + esc(r.reasonCode) + '</span>' + esc(R.reasonText(r.reasonCode)) +
      irdPill(r) + agePill(r.hoursAgo) +
      '<span class="meta mono">' + esc(r.file) + ' · batch ' + esc(r.batch) + ' · ' + esc(r.status) + '</span>' +
      '</div>' +

      errorBlock(r) +

      '<div class="cfg-section-title">Transaction context <span class="meta">— the inputs the matcher decides on. Hover a label for what it means.</span></div>' +
      contextBlock(r) +

      '<div class="cfg-section-title mt-24">Applicable IRDs ' +
      '<span class="meta">— a read-only dry run of the matcher for this transaction. Ranked by ' + kt('Score & reasons', 'score') + '; nothing is written and no file is emitted.</span></div>' +
      candidateFilters(r) +
      '<div class="cand-list">' + candidateList(r) + '</div>' +

      footer +
      '</div></div>';
  }

  /* =======================================================================
     KT drawer (§6.5)
     ======================================================================= */
  function ktDrawer(term) {
    var g = R.glossaryByTerm[term]; if (!g) return '';
    var others = R.GLOSSARY.filter(function (x) { return x.term !== term; });
    return '<div class="overlay" data-action="ird-kt-close">' +
      '<div class="side-panel ird-kt" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div><div class="section-title">' + esc(g.term) + '</div>' +
      '<div class="meta">' + esc(g.full) + '</div></div>' +
      '<button class="icon-btn" data-action="ird-kt-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<p class="kt-short">' + esc(g.short) + '</p>' +
      '<p class="kt-long">' + esc(g.long) + '</p>' +
      '<div class="kt-source">' + icon('file-code', 13) + '<code>' + esc(g.source) + '</code></div>' +
      '<div class="cfg-section-title mt-24">Related terms</div>' +
      '<div class="kt-others">' + others.map(function (o) {
        return '<button class="kt-other" data-action="ird-kt" data-term="' + esc(o.term) + '">' +
          '<strong>' + esc(o.term) + '</strong><span>' + esc(o.short) + '</span></button>';
      }).join('') + '</div>' +
      '</div></div>';
  }

  /* =======================================================================
     Actions
     ======================================================================= */
  function stamp() { return U.prettyDate(D.TODAY) + ', 00:47 IST'; }
  var WHO = 'ops.analyst@juspay.in';

  function doApply(rows, pick) {
    var reason = S.ird.applyReason.trim();
    var resp = R.applyIrd(rows, pick, reason, WHO, stamp());
    S.ird.result = resp;
    S.ird.selected = {};
    S.ird.applyReason = '';
    S.ird.batchIrd = null;
    toast(rows.length === 1
      ? 'IRD applied — file ' + resp.file_uuid.slice(0, 8) + '… recreated (' + resp.cycle_decision + ')'
      : rows.length + ' rejects resolved — one file recreated (' + resp.cycle_decision + ')', 'success');
    viewQueue();
  }

  var ACTIONS = {
    'ird-f-entity': function (t) { S.ird.entity = t.value; viewQueue(); },
    'ird-f-reason': function (t) { S.ird.reason = t.value; viewQueue(); },
    'ird-f-date': function (t) { S.ird.date = t.value; viewQueue(); },
    'ird-f-only': function (t) { S.ird.irdOnly = t.checked; viewQueue(); },
    'ird-pick': function (t) {
      var id = t.getAttribute('data-id');
      if (t.checked) S.ird.selected[id] = true; else delete S.ird.selected[id];
      viewQueue();
    },
    'ird-clear-sel': function () { S.ird.selected = {}; S.ird.batchIrd = null; viewQueue(); },
    'ird-batchmode': function (t) { S.ird.batchMode = t.getAttribute('data-mode'); viewQueue(); },
    'ird-batch-ird': function (t) { S.ird.batchIrd = t.value || null; viewQueue(); },
    'ird-batch-apply': function () {
      var rows = selectedRows();
      if (!rows.length) return;
      if (S.ird.batchMode === 'single') {
        if (!S.ird.batchIrd) { toast('Choose the IRD to apply first', 'info'); return; }
        if (!S.ird.applyReason.trim()) S.ird.applyReason = 'Batch resolution — ' + rows.length + ' rejects share the same corrected IRD.';
        doApply(rows, { mode: 'single', ird: S.ird.batchIrd });
      } else {
        var missing = rows.filter(function (r) { return !S.ird.chosen[r.id]; });
        if (missing.length) { toast(missing.length + ' selected row(s) have no IRD chosen yet', 'info'); return; }
        rows.forEach(function (r) { r.chosenIrd = S.ird.chosen[r.id]; });
        if (!S.ird.applyReason.trim()) S.ird.applyReason = 'Batch resolution — per-transaction IRDs chosen from the filtered candidates.';
        doApply(rows, { mode: 'per_row' });
      }
    },

    'ird-open': function (t) {
      S.ird.open = t.getAttribute('data-id');
      S.ird.filters = { geography: 'all', program: 'all', showRejected: false };
      S.ird.applyReason = '';
      viewQueue();
    },
    'ird-close': function () { S.ird.open = null; viewQueue(); },
    'ird-cf-geo': function (t) { S.ird.filters.geography = t.value; viewQueue(); },
    'ird-cf-prog': function (t) { S.ird.filters.program = t.value; viewQueue(); },
    'ird-cf-rejected': function (t) { S.ird.filters.showRejected = t.checked; viewQueue(); },
    'ird-choose': function (t) {
      S.ird.chosen[t.getAttribute('data-id')] = t.getAttribute('data-code');
      viewQueue();
    },
    'ird-reason': function (t) {
      S.ird.applyReason = t.value;
      // Live-typing binding — only the apply button's disabled state depends on it.
      var btn = el('view').querySelector('[data-action=ird-apply]');
      if (btn) btn.disabled = !t.value.trim();
    },
    'ird-apply': function (t) {
      var r = R.byId[t.getAttribute('data-id')]; if (!r) return;
      var rec = R.recommended(r);
      var chosen = S.ird.chosen[r.id] || (rec ? rec.ird_code : null);
      if (!chosen) { toast('Choose an IRD first', 'info'); return; }
      if (!S.ird.applyReason.trim()) { toast('Add a short reason — it goes into the audit trail', 'info'); return; }
      r.chosenIrd = chosen;
      doApply([r], { mode: 'per_row' });
    },

    'ird-kt': function (t) { S.ird.kt = t.getAttribute('data-term'); viewQueue(); },
    'ird-kt-close': function () { S.ird.kt = null; viewQueue(); }
  };

  function route() { S.ird.result = null; return viewQueue(); }

  return { route: route, actions: ACTIONS, ROUTE: ROUTE };
};
