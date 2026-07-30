/* =============================================================================
   Juspay Ops Portal — Platform Configs: shared diff component + approvals queue
   The diff is designed once here and reused in three places (Part 8.3):
   approval detail · version compare · revert preview.
   window.ConfigsQueue(ui) → { actions }   (views are attached onto ui.api)
   ============================================================================= */
window.ConfigsQueue = function (ui) {
  'use strict';
  var api = ui.api, kit = api.kit, S = api.S, C = api.C, X = api.X, F = window.CFGFMT;
  var D = window.DATA, U = D.util;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, slaBadge = kit.slaBadge;

  /* ---- Date helpers over the display timestamps -------------------------- */
  var MONS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  function p2(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function tsToYmd(s) {
    var m = /^(\d{1,2}) (\w{3}) (\d{4})/.exec(s || '');
    if (!m || MONS[m[2]] === undefined) return null;
    return m[3] + '-' + p2(MONS[m[2]] + 1) + '-' + p2(m[1]);
  }
  function daysAgo(stamp) {
    var y = tsToYmd(stamp); if (!y) return 9999;
    return Math.round((U.fromYmd(D.TODAY).getTime() - U.fromYmd(y).getTime()) / 86400000);
  }
  function decidedAt(cfg) {
    if (!cfg.versions.length) return cfg.approvedAt || null;
    return cfg.versions[cfg.versions.length - 1].approvedAt;
  }

  /* =======================================================================
     SHARED DIFF COMPONENT (Part 8.3)
     ======================================================================= */
  function valCell(v, kind, side) {
    if (v === undefined) return '<span class="dv-empty">—</span>';
    var s = X.showVal(v);
    return '<span class="dv-val ' + (kind === 'removed' && side === 'left' ? 'strike' : '') + '">' + esc(s) + '</span>';
  }
  // Only fixed-width layouts have a byte map; an XML or CSV layout is compared by
  // its record / field structure instead (§1).
  function layoutMaps(body, label) {
    if (!body || !body.record_types || !body.record_types.length) return '';
    if (!F.isFixed(body)) {
      return '<div class="struct-summary"><div class="ss-head">' + icon(F.caps(body).icon, 14) +
        '<strong>' + esc(label) + '</strong><span class="meta">' + esc(F.caps(body).label) + ' — no byte positions</span></div>' +
        '<div class="ss-rows">' + body.record_types.map(function (rt) {
          return '<div class="ss-row"><span class="mono ss-rt">' + esc(rt.record_type || '?') + '</span>' +
            '<span class="meta">' + (rt.fields || []).length + ' field' + ((rt.fields || []).length === 1 ? '' : 's') + '</span>' +
            '<span class="ss-names mono">' + esc((rt.fields || []).slice(0, 10).map(function (f) { return f.name; }).join(', ')) +
            ((rt.fields || []).length > 10 ? ' …' : '') + '</span></div>';
        }).join('') + '</div></div>';
    }
    return body.record_types.map(function (rt) {
      return X.byteMapHtml(body.record_length, rt.fields, { compact: true, title: label + ' · record type ' + esc(rt.record_type || '?') });
    }).join('');
  }
  /* Part 5.6 — a config path reads as the label the editor uses, never as a raw
     key. The path is kept beside it in muted mono, because a checker sometimes
     does need to know exactly which key moved. */
  var PATH_LABEL = {
    record_length: 'Record length (characters)',
    padding_char: 'Padding character',
    encoding: 'Character encoding',
    start: 'Starts at character',
    length: 'Length (characters)',
    type: 'Content type',
    name: 'Field name',
    note: 'Notes',
    record_type: 'Record type',
    record_types: 'Record types',
    json_extractions: 'Where the data comes from',
    field_mappings: 'Data mapping',
    output: 'Field in the file',
    transaction_date: 'Transaction window',
    report_offset: 'Generated on',
    sundays_off: 'Skip Sundays',
    saturdays_off: 'Skip Saturdays',
    apply_general_holiday: 'Skip bank holidays',
    timezone: 'Time zone',
    'select': 'Columns in this report',
    eligibility_flags: 'Which transactions are included',
    txn_rules: 'Fee rules',
    priority: 'Priority',
    starting_date: 'Effective from',
    fee_mode: 'How the fee is taken',
    conditions: 'When it applies',
    calculations: 'What it charges',
    percentage: 'Rate %',
    min: 'From amount',
    max: 'To amount',
    sectioning: 'How records are sorted',
    source_format: 'File format',
    layout_ref: 'Referenced layout',
    mappings: 'Mappings',
    filters: 'Filters'
  };
  function plainPath(path) {
    return String(path).split('.').map(function (seg) {
      var m = /^(.*?)(\[\d+\])?$/.exec(seg);
      var key = m[1], idx = m[2] || '';
      var label = PATH_LABEL[key];
      if (!label) label = key.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
      return label + (idx ? ' ' + idx : '');
    }).join(' › ');
  }
  // One sentence above the detail: how many changes, and of what kind.
  function diffChangeSummary(st) {
    var bits = [];
    if (st.added) bits.push(st.added + ' field' + (st.added === 1 ? '' : 's') + ' added');
    if (st.modified) bits.push(st.modified + ' value' + (st.modified === 1 ? '' : 's') + ' changed');
    if (st.removed) bits.push(st.removed + ' field' + (st.removed === 1 ? '' : 's') + ' removed');
    var total = st.added + st.modified + st.removed;
    if (!total) return 'No changes between these two versions.';
    return total + ' change' + (total === 1 ? '' : 's') + ': ' + bits.join(', ') + '.';
  }

  // leftBody may be null → "New config"
  function diffPanel(leftBody, rightBody, leftLabel, rightLabel, cfg) {
    var rows = X.diffRows(leftBody, rightBody);
    var st = X.diffStats(rows);
    var show = S.cfg.showUnchanged;
    var shown = show ? rows : rows.filter(function (r) { return r.kind !== 'same'; });
    var hidden = rows.length - shown.length;

    var body = shown.map(function (r) {
      return '<div class="dv-row ' + r.kind + '">' +
        '<div class="dv-path"><span class="dv-plain">' + esc(plainPath(r.path)) + '</span>' +
        '<span class="dv-raw mono">' + esc(r.path) + '</span></div>' +
        '<div class="dv-side left">' + valCell(r.left, r.kind, 'left') + '</div>' +
        '<div class="dv-side right">' + valCell(r.right, r.kind, 'right') +
        (r.kind !== 'same' ? '<span class="diff-tag ' + r.kind + '">' + r.kind + '</span>' : '') + '</div>' +
        '</div>';
    }).join('');

    if (!shown.length) body = '<div class="dv-none">' + icon('equal', 16) + 'No differences between these two versions.</div>';

    var maps = '';
    var hasLayout = (leftBody && leftBody.record_types) || (rightBody && rightBody.record_types);
    if (hasLayout) {
      maps = '<div class="dv-maps">' +
        '<div class="dv-maps-head">' + icon('ruler', 15) + '<strong>Layout comparison</strong><span class="meta">Both versions, stacked</span></div>' +
        (leftBody ? layoutMaps(leftBody, leftLabel) : '<div class="meta">No previous layout — this is a new config.</div>') +
        layoutMaps(rightBody, rightLabel) +
        '</div>';
    }

    return '<div class="diff-view">' +
      '<div class="dv-summary">' + icon('git-compare', 18) + '<strong>' + esc(diffChangeSummary(st)) + '</strong></div>' +
      '<div class="dv-head">' +
      '<div class="dv-path meta">What changed</div>' +
      '<div class="dv-side left"><strong>' + esc(leftLabel) + '</strong></div>' +
      '<div class="dv-side right"><strong>' + esc(rightLabel) + '</strong></div>' +
      '</div>' +
      '<div class="dv-body">' + body + '</div>' +
      '<div class="dv-foot">' +
      '<span class="diff-tag added">added</span> <span class="num">' + st.added + '</span>' +
      '<span class="diff-tag modified">modified</span> <span class="num">' + st.modified + '</span>' +
      '<span class="diff-tag removed">removed</span> <span class="num">' + st.removed + '</span>' +
      '<span class="meta"><span class="num">' + st.same + '</span> unchanged</span>' +
      '<label class="cfg-toggle" style="margin-left:auto"><input type="checkbox"' + (show ? ' checked' : '') + ' data-action="cfgc-show-unchanged" /><span>Show unchanged lines' + (hidden && !show ? ' (' + hidden + ' hidden)' : '') + '</span></label>' +
      '</div>' + maps + '</div>';
  }

  /* =======================================================================
     APPROVALS QUEUE (Part 4.7)
     ======================================================================= */
  function queueList(tab) {
    var all = C.configs;
    if (tab === 'pending') return all.filter(function (c) { return c.state === 'PENDING_APPROVAL'; });
    if (tab === 'approved') {
      return all.filter(function (c) {
        return (c.state === 'APPROVED' || c.state === 'ACTIVE' || c.state === 'INACTIVE') && c.versions.length && daysAgo(decidedAt(c)) <= 30;
      });
    }
    return all.filter(function (c) { return c.state === 'REJECTED' && daysAgo(c.rejectedAt) <= 30; });
  }
  function applyQueueFilters(list) {
    var q = S.cfg.queue;
    return list.filter(function (c) {
      if (q.family !== 'all' && c.family !== q.family) return false;
      if (q.submitter !== 'all' && (c.submittedBy || c.createdBy) !== q.submitter) return false;
      if (q.sla !== 'all' && c.state === 'PENDING_APPROVAL') {
        var left = 48 - (c.submittedHoursAgo || 0);
        if (q.sla === 'overdue' && left > 0) return false;
        if (q.sla === 'approaching' && !(left > 0 && left < 24)) return false;
        if (q.sla === 'ok' && left < 24) return false;
      }
      return true;
    });
  }

  function viewApprovals() {
    var tab = S.cfg.queue.tab;
    var counts = { pending: queueList('pending').length, approved: queueList('approved').length, rejected: queueList('rejected').length };
    var list = applyQueueFilters(queueList(tab)).slice().sort(function (a, b) {
      return (a.submittedHoursAgo == null ? 0 : b.submittedHoursAgo - a.submittedHoursAgo);
    });

    var submitters = [];
    C.configs.forEach(function (c) {
      var s = c.submittedBy || c.createdBy;
      if (s && submitters.indexOf(s) < 0) submitters.push(s);
    });

    var tabBar = '<div class="tabs">' +
      [['pending', 'Waiting for approval'], ['approved', 'Approved <span class="meta">(last 30 days)</span>'], ['rejected', 'Not approved <span class="meta">(last 30 days)</span>']]
        .map(function (t) {
          return '<button class="tab ' + (tab === t[0] ? 'active' : '') + '" data-action="cfg-q-tab" data-tab="' + t[0] + '">' + t[1] +
            '<span class="count num">' + counts[t[0]] + '</span></button>';
        }).join('') + '</div>';

    var body;
    if (!list.length) {
      body = '<div class="card">' + emptyState('inbox', 'Nothing in this view',
        tab === 'pending' ? 'No platform config changes are awaiting approval under the current filters.'
          : 'No ' + tab + ' config changes in the last 30 days under the current filters.') + '</div>';
    } else {
      var rows = list.map(function (c) {
        var left = 48 - (c.submittedHoursAgo || 0);
        var when = c.state === 'PENDING_APPROVAL' ? c.submittedAt : (c.state === 'REJECTED' ? c.rejectedAt : decidedAt(c));
        var selfBlock = api.isSelf(c);
        var actionCell;
        if (c.state === 'PENDING_APPROVAL') {
          var g = api.can(c, 'approve');
          actionCell = g.ok
            ? '<button class="btn btn-primary btn-sm" data-route="#/dashboard/ops/configs/approvals/' + c.configId + '">Review</button>'
            : '<span class="tip" data-tip="' + esc(g.why) + '"><button class="btn btn-secondary btn-sm" data-route="#/dashboard/ops/configs/approvals/' + c.configId + '">Review</button></span>';
        } else {
          actionCell = '<button class="btn btn-secondary btn-sm" data-route="#/dashboard/ops/configs/approvals/' + c.configId + '">View</button>';
        }
        return '<tr class="clickable" data-route="#/dashboard/ops/configs/approvals/' + c.configId + '">' +
          '<td>' + api.famBadge(c.family) + '</td>' +
          '<td><div class="cell-main">' + esc(c.name) + '</div><div class="cell-sub">' + api.facetBadge(c) + ' ' + api.tenantChip(c.tenantId) + ' · ' + esc(c.configId) + '</div></td>' +
          '<td class="cell-sub">' + esc(c.submittedBy || c.createdBy) + (selfBlock && c.state === 'PENDING_APPROVAL' ? ' <span class="tip" data-tip="You submitted this — self-approval is blocked">' + icon('shield-alert', 13) + '</span>' : '') + '</td>' +
          '<td class="cell-sub nowrap">' + esc(when || '—') + '</td>' +
          '<td>' + (c.state === 'PENDING_APPROVAL' ? slaBadge(left) : api.statePill(c)) + '</td>' +
          '<td class="cell-sub">' + esc(changeSummary(c)) + '</td>' +
          '<td>' + actionCell + '</td></tr>';
      }).join('');
      body = '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Family</th><th>Config</th><th>Submitted by</th><th>' + (tab === 'pending' ? 'Submitted at' : 'Decided at') + '</th>' +
        '<th>' + (tab === 'pending' ? 'SLA' : 'State') + '</th><th>Change summary</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="table-foot"><span><span class="num">' + list.length + '</span> config change' + (list.length === 1 ? '' : 's') + '</span>' +
        '<span>SLA target: 48h from submission</span></div></div>';
    }

    setView(
      '<div class="page-head cfg-head">' +
      '<div><h1 class="page-title">Config Approvals</h1>' +
      '<div class="subtitle">Maker-checker queue for platform configs across all three families · separate from the bank-proposed Fee Config Approvals queue</div></div>' +
      api.roleBar() + '</div>' +
      tabBar +
      '<div class="filter-row">' +
      '<label class="field inline">Family <select class="input" style="width:auto" data-action="cfgc-q-family">' +
      [['all', 'All families']].concat(C.FAMILIES.map(function (f) { return [f.id, f.label]; })).map(function (o) {
        return '<option value="' + o[0] + '"' + (S.cfg.queue.family === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field inline">Submitter <select class="input" style="width:auto" data-action="cfgc-q-submitter">' +
      ['all'].concat(submitters).map(function (s) {
        return '<option value="' + esc(s) + '"' + (S.cfg.queue.submitter === s ? ' selected' : '') + '>' + (s === 'all' ? 'All submitters' : esc(s)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field inline">SLA <select class="input" style="width:auto" data-action="cfgc-q-sla">' +
      [['all', 'All'], ['ok', 'Within SLA'], ['approaching', 'Approaching (&lt; 24h)'], ['overdue', 'Overdue']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.cfg.queue.sla === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<div style="flex:1"></div>' +
      '<a class="btn-ghost inline-link" data-route="#/dashboard/ops/configs/network-files">Back to configs ' + icon('arrow-right', 13) + '</a>' +
      '</div>' + body
    );
  }

  function changeSummary(cfg) {
    if (cfg.state === 'PENDING_APPROVAL') return X.diffSummary(api.priorBody(cfg), cfg.body);
    if (cfg.state === 'REJECTED') return cfg.rejectionReason || '';
    var v = cfg.versions[cfg.versions.length - 1];
    return v ? v.summary : '';
  }

  /* =======================================================================
     APPROVAL DETAIL — side-by-side diff (same pattern as Fee Config Approvals)
     ======================================================================= */
  function viewApprovalDetail(id) {
    var cfg = C.byId[id];
    if (!cfg) {
      setView('<div class="card">' + emptyState('search-x', 'Config not found', 'This approval ticket does not exist.',
        '<button class="btn btn-secondary" data-route="#/dashboard/ops/configs/approvals">Back to queue</button>') + '</div>');
      return;
    }
    var prior = api.priorBody(cfg);
    var isPending = cfg.state === 'PENDING_APPROVAL';
    var left = 48 - (cfg.submittedHoursAgo || 0);
    var gApprove = api.can(cfg, 'approve'), gReject = api.can(cfg, 'reject');

    var banner = '';
    if (cfg.state === 'REJECTED') {
      banner = '<div class="callout danger cfg-banner">' + icon('x-circle', 20) +
        '<div class="callout-body"><strong>Not approved</strong> — returned by ' + esc(cfg.rejectedBy || 'checker') + ' · ' + esc(cfg.rejectedAt || '') +
        '<div style="margin-top:4px">' + esc(cfg.rejectionReason || '') + '</div></div></div>';
    } else if (cfg.state === 'APPROVED' || cfg.state === 'ACTIVE' || cfg.state === 'INACTIVE') {
      var lastV = cfg.versions[cfg.versions.length - 1];
      banner = '<div class="callout cfg-banner" style="background:var(--status-success-bg);color:var(--status-success-fg);border:1px solid #BBF7D0">' + icon('check-circle', 20) +
        '<div class="callout-body"><strong>Approved</strong>' + (lastV ? ' as v' + lastV.version + ' by ' + esc(lastV.approvedBy) + ' on ' + esc(lastV.approvedAt) : '') +
        '. Current state: ' + api.statePill(cfg) + '</div></div>';
    } else if (isPending) {
      banner = '<div class="callout info cfg-banner">' + icon('clock', 20) +
        '<div class="callout-body"><strong>Awaiting a second pair of eyes.</strong> Submitted by ' + esc(cfg.submittedBy) + ' on ' + esc(cfg.submittedAt) + ' · ' + slaBadge(left) + '</div></div>';
    }

    var selfNotice = (isPending && api.isSelf(cfg))
      ? '<div class="callout warn cfg-banner">' + icon('shield-alert', 20) +
      '<div class="callout-body"><strong>Self-approval blocked.</strong> This change was submitted by ' + esc(C.DEMO_USER) +
      ' — the same user signed in here. The Approve button stays disabled in every role, including Checker. A different checker must sign this off.</div></div>'
      : '';

    var v = X.validate(cfg, cfg.body);
    var valSummary = '<div class="row" style="gap:10px;flex-wrap:wrap">' +
      (v.errors.length ? pill(v.errors.length + ' validation error' + (v.errors.length === 1 ? '' : 's'), 'danger', 'x-circle') : pill('Validators pass', 'success', 'check')) +
      (v.warnings.length ? pill(v.warnings.length + ' warning' + (v.warnings.length === 1 ? '' : 's'), 'warning', 'alert-triangle') : '') +
      '</div>' +
      (v.all.length ? '<div class="mt-16">' + v.all.map(function (x) {
        return '<div class="val-row ' + x.level + '">' + icon(x.level === 'error' ? 'x-circle' : 'alert-triangle', 15) +
          '<div><span class="val-code">' + esc(x.code) + '</span>' + esc(x.msg) + (x.where ? '<span class="val-where">' + esc(x.where) + '</span>' : '') + '</div></div>';
      }).join('') + '</div>' : '');

    var actions = '';
    if (isPending) {
      var rejBtn = '<button class="btn btn-secondary"' + (gReject.ok ? '' : ' disabled') + ' data-action="cfg-q-reject" data-id="' + cfg.configId + '">' + icon('x', 16) + 'Reject</button>';
      var appBtn = '<button class="btn btn-primary"' + (gApprove.ok ? '' : ' disabled') + ' data-action="cfg-q-approve" data-id="' + cfg.configId + '">' + icon('check', 16) + 'Approve</button>';
      actions = '<div class="row mt-24" style="justify-content:flex-end;gap:10px">' +
        (gReject.ok ? rejBtn : '<span class="tip" data-tip="' + esc(gReject.why) + '">' + rejBtn + '</span>') +
        (gApprove.ok ? appBtn : '<span class="tip" data-tip="' + esc(gApprove.why) + '">' + appBtn + '</span>') +
        '</div>';
    } else {
      actions = '<div class="row mt-24" style="justify-content:flex-end;gap:10px">' +
        '<button class="btn btn-secondary" data-route="#/dashboard/ops/configs/approvals">Back to queue</button></div>';
    }

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/configs/approvals">Config Approvals</a><span class="sep">/</span><span>' + esc(cfg.configId) + '</span></div>' +
      '<div class="page-head cfg-head"><div>' +
      '<h1 class="page-title">' + esc(cfg.name) + '</h1>' +
      '<div class="subtitle">' + api.famBadge(cfg.family) + ' ' + api.facetBadge(cfg) + ' ' + api.tenantChip(cfg.tenantId) +
      ' · ' + esc(cfg.configType) + ' · ' + api.statePill(cfg) + '</div></div>' +
      api.roleBar() + '</div>' +
      banner + selfNotice +
      '<div class="section-title mb-16">Configuration diff</div>' +
      '<div id="cfgDiffMount">' + diffPanel(prior, cfg.body, prior ? 'Previous approved version' : 'New config — no previous version', 'Proposed change', cfg) + '</div>' +
      '<div class="grid grid-2 mt-24">' +
      cardBox('Submitter\'s reason', '<blockquote style="border-left:3px solid var(--border-strong);padding:8px 14px;color:var(--text-secondary);font-style:italic">“' +
        esc(cfg.submitReason || 'No reason recorded.') + '”</blockquote>' +
        '<div class="meta mt-16">Submitted by ' + esc(cfg.submittedBy || cfg.createdBy) + (cfg.submittedAt ? ' · ' + esc(cfg.submittedAt) : '') + '</div>') +
      cardBox('Validation report' + (isPending ? ' <span class="meta">(run against the proposed body)</span>' : ''), valSummary) +
      '</div>' +
      (isPending
        ? '<div class="mt-24">' + cardBox('Checker comment' + ' <span class="meta">(optional to approve · required to reject)</span>',
          '<textarea class="input" id="cfgCheckerNote" placeholder="Reviewer notes…"></textarea>') + '</div>'
        : (cfg.comments.length
          ? '<div class="mt-24">' + cardBox('Checker comments', cfg.comments.map(function (c) {
            return '<div class="file-row"><div class="file-name">' + esc(c.text) + '<div class="file-meta">' + esc(c.at) + ' · ' + esc(c.by) + ' · ' + esc(c.kind) + '</div></div></div>';
          }).join('')) + '</div>'
          : '')) +
      actions +
      '<div class="row mt-16" style="justify-content:flex-end">' +
      '<a class="btn-ghost inline-link" data-action="cfg-q-open" data-id="' + cfg.configId + '">Open in the config editor ' + icon('arrow-right', 13) + '</a></div>'
    );
  }

  /* ---- Reject modal (mandatory comment) ---------------------------------- */
  var _rejectCb = null, _rejectCfg = null;
  function openReject(cfg, cb) {
    _rejectCfg = cfg; _rejectCb = cb;
    el('overlay-mount').innerHTML =
      '<div class="overlay" data-action="cfg-reject-cancel"><div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div class="section-title">Reject change</div>' +
      '<button class="icon-btn" data-action="cfg-reject-cancel" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="meta mb-16">' + esc(cfg.name) + ' · submitted by ' + esc(cfg.submittedBy || cfg.createdBy) + '</div>' +
      '<label class="field">Reason <span class="req">*</span>' +
      '<textarea class="input" id="cfgRejectReason" placeholder="Explain what must change before this can be approved…"></textarea>' +
      '<span class="fld-hint">The maker sees this on the config. The proposal is kept as an editable draft — nothing is lost.</span></label>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:18px">' +
      '<button class="btn btn-secondary" data-action="cfg-reject-cancel">Cancel</button>' +
      '<button class="btn btn-danger" data-action="cfg-reject-confirm">' + icon('x', 15) + 'Reject change</button></div>' +
      '</div></div>';
    if (window.lucide) lucide.createIcons();
    var ta = el('cfgRejectReason'); if (ta) ta.focus();
  }
  function closeReject() { el('overlay-mount').innerHTML = ''; _rejectCb = null; _rejectCfg = null; }

  /* =======================================================================
     ACTIONS
     ======================================================================= */
  var ACTIONS = {
    'cfg-q-tab': function (t) { S.cfg.queue.tab = t.getAttribute('data-tab'); viewApprovals(); },
    'cfgc-q-family': function (t) { S.cfg.queue.family = t.value; viewApprovals(); },
    'cfgc-q-submitter': function (t) { S.cfg.queue.submitter = t.value; viewApprovals(); },
    'cfgc-q-sla': function (t) { S.cfg.queue.sla = t.value; viewApprovals(); },
    'cfgc-show-unchanged': function (t) {
      S.cfg.showUnchanged = t.checked;
      if (el('cfgDiffMount')) {
        var cfg = C.byId[(location.hash.split('/').pop() || '').trim()] || api.current();
        if (cfg) api.put('cfgDiffMount', diffPanel(api.priorBody(cfg), cfg.body,
          api.priorBody(cfg) ? 'Previous approved version' : 'New config — no previous version', 'Proposed change', cfg));
      } else {
        api.renderFamily(S.cfg.family);
      }
    },
    'cfg-q-approve': function (t) {
      var cfg = C.byId[t.getAttribute('data-id')];
      if (!cfg) return;
      var g = api.can(cfg, 'approve');
      if (!g.ok) { toast(g.why, 'info'); return; }
      var note = (el('cfgCheckerNote') || {}).value || '';
      api.approve(cfg, note.trim());
      toast('Approved ' + cfg.name + ' — activate it to go live', 'success');
      S.cfg.queue.tab = 'approved';
      go('#/dashboard/ops/configs/approvals');
    },
    'cfg-q-reject': function (t) {
      var cfg = C.byId[t.getAttribute('data-id')];
      if (!cfg) return;
      var g = api.can(cfg, 'reject');
      if (!g.ok) { toast(g.why, 'info'); return; }
      var note = (el('cfgCheckerNote') || {}).value || '';
      if (note.trim().length >= 10) {
        api.reject(cfg, note.trim());
        toast('Rejected — returned to the maker with your comment', 'success');
        S.cfg.queue.tab = 'rejected';
        go('#/dashboard/ops/configs/approvals');
        return;
      }
      openReject(cfg, function () { S.cfg.queue.tab = 'rejected'; go('#/dashboard/ops/configs/approvals'); });
    },
    'cfg-reject-cancel': function () { closeReject(); },
    'cfg-reject-confirm': function () {
      var reason = (el('cfgRejectReason') || {}).value || '';
      if (reason.trim().length < 10) { toast('A rejection reason of at least 10 characters is required', 'info'); return; }
      var cfg = _rejectCfg, cb = _rejectCb;
      api.reject(cfg, reason.trim());
      closeReject();
      toast('Rejected — returned to the maker with your comment', 'success');
      if (cb) cb();
    },
    'cfg-q-open': function (t) {
      var cfg = C.byId[t.getAttribute('data-id')];
      if (!cfg) return;
      // A settlement config opens on its report ITEM, on the right tab (§5).
      var target = cfg.family === 'settlement' ? (C.itemKeyForConfig(cfg) || cfg.configId) : cfg.configId;
      go(api.famRoute(cfg.family, target));
    }
  };

  /* ---- Attach onto the shared api so screens can reuse the diff ---------- */
  api.diffPanel = diffPanel;
  api.openReject = openReject;
  api.viewApprovals = viewApprovals;
  api.viewApprovalDetail = viewApprovalDetail;

  return { actions: ACTIONS };
};
