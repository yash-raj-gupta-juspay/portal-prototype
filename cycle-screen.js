/* =============================================================================
   Juspay Ops Portal — Cross-Tenant Cycle Status grid + Cycle Snapshot drill-in

   Two things live here and nothing else:
     1. gridHtml()  — the refactored Cross-Tenant Cycle Status component that
                      Ops Home renders in place of the old three-dot matrix.
                      Each cell is one tenant × network × today's cycle, carrying
                      three legs (CLR / INC / STL) with their own state, icon and
                      timestamp, tinted by the cell's overall state.
     2. route()     — #/dashboard/ops/cycle-snapshot/:tenantId/:network/:cycleDate
                      The operational picture for one cycle: three-leg timeline
                      against the cut-offs, then clearing / incoming / settlement
                      detail, then a compact reconciliation callout.

   Reconciliation stays one click away (header button) but is no longer where a
   cell click lands — the first question an ops user has is operational.

   window.CycleUI(kit) → { gridHtml, route, actions }
   ============================================================================= */
window.CycleUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go,
    num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag;

  var ROUTE = '#/dashboard/ops/cycle-snapshot';

  // In-memory only (Part 9.5) — no storage, no timers.
  S.cycle = { rejOpen: false };

  function snapRoute(tenantId, netKey, date) { return ROUTE + '/' + tenantId + '/' + netKey + '/' + date; }

  /* =======================================================================
     PART 3 — THE CELL
     ======================================================================= */
  function segment(leg) {
    var m = leg.meta;
    var phrase = leg.state === 'complete' ? 'completed ' + C.hhmm(leg.actual)
      : leg.state === 'inprogress' ? 'running since ' + C.hhmm(leg.started)
        : leg.state === 'pending' ? 'not started yet'
          : leg.state === 'delayed' ? (leg.actual != null
            ? 'completed ' + C.hhmm(leg.actual) + ', ' + C.dur(leg.overrunMin) + ' past cut-off'
            : 'awaiting — ' + C.dur(leg.overrunMin) + ' past cut-off')
            : 'failed — requires intervention';
    var tip = leg.label + ' — ' + m.label + ' · ' + phrase + ' · cut-off ' + leg.cutoffLabel + ' IST';
    return '<span class="cyc-seg st-' + leg.state + '" title="' + esc(tip) + '">' +
      '<span class="cyc-seg-label">' + leg.short + '</span>' +
      '<span class="cyc-seg-icon" aria-hidden="true">' + icon(m.icon, 15) + '</span>' +
      '<span class="cyc-seg-ts">' + leg.cellTime + '</span>' +
      (leg.overrunMin > 0 && (leg.state === 'delayed' || leg.state === 'failed')
        ? '<span class="cyc-overrun">+' + C.dur(leg.overrunMin) + '</span>'
        : '<span class="cyc-overrun-spacer"></span>') +
      '<span class="sr-only">' + leg.label + ' ' + m.label + '</span>' +
      '</span>';
  }

  var TINT = { complete: 'tint-ok', delayed: 'tint-warn', failed: 'tint-fail' };

  function cell(tenantId, netKey, date) {
    var c = C.legsFor(tenantId, netKey, date);
    var summary = C.cellSummary(tenantId, netKey, date);
    var inner;
    if (c.holiday && c.holiday.impact === 'Full holiday') {
      inner = '<span class="cyc-flat">' + icon('calendar-x', 15) + '<span>Bank holiday</span></span>';
    } else if (!c.legs.length) {
      inner = '<span class="cyc-flat">' + icon('circle-dashed', 15) + '<span>Not started</span></span>';
    } else {
      inner = '<span class="cyc-legs">' + c.legs.map(segment).join('') + '</span>';
    }
    return '<td class="cyc-td"><button type="button" class="cyc-cell ' + (TINT[c.overall] || '') + '" ' +
      'data-route="' + snapRoute(tenantId, netKey, date) + '" ' +
      'title="' + esc(summary) + '" aria-label="' + esc(summary) + ' — open cycle snapshot">' +
      inner + '</button></td>';
  }

  /* The component Ops Home drops in place of the old matrix. */
  function gridHtml() {
    var date = C.TODAY;
    var head = '<tr><th class="cyc-th cyc-th-tenant">Tenant</th>' + O.NETWORKS.map(function (n) {
      return '<th class="cyc-th"><span class="cyc-net"><span class="cyc-net-dot" style="background:' + n.color + '"></span>' + n.short + '</span></th>';
    }).join('') + '</tr>';
    var rows = O.tenants.map(function (t) {
      return '<tr><th scope="row" class="cyc-tenant">' + tenantTag(t.id) + '</th>' +
        O.NETWORKS.map(function (n) { return cell(t.id, n.key, date); }).join('') + '</tr>';
    }).join('');

    var legendStates = ['complete', 'inprogress', 'pending', 'delayed', 'failed'].map(function (k) {
      var m = C.STATE_META[k];
      return '<span class="cyc-lg-item st-' + k + '">' + icon(m.icon, 14) + m.label + '</span>';
    }).join('');

    var demo = C.failedDemos[0];
    return '<div class="cyc-grid-wrap"><table class="cyc-grid"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="cyc-legend">' +
      '<div class="cyc-lg-row"><span class="cyc-lg-key">CLR</span> clearing · <span class="cyc-lg-key">INC</span> incoming · <span class="cyc-lg-key">STL</span> settled</div>' +
      '<div class="cyc-lg-row">' + legendStates + '</div>' +
      '<div class="cyc-lg-row meta">Timestamps are the actual completion time, or the expected cut-off when the leg has not landed. Times in IST · cycle ' + U.prettyDate(date) + '. Click any cell to open the cycle snapshot for that tenant × network.</div>' +
      '<div class="cyc-lg-row meta">Prior cycles open from the snapshot — e.g. <a class="cyc-lg-link" data-route="' + snapRoute(demo.tenantId, demo.networkKey, demo.date) + '">HSBC SG · Visa · ' + U.prettyDate(demo.date) + '</a> failed its settlement leg.</div>' +
      '</div>';
  }

  /* =======================================================================
     PART 4.2 — THE THREE-LEG TIMELINE
     Horizontal axis on the cycle's processing clock; one lane per leg, each
     carrying its cut-off marker, its actual event marker and a delta.
     ======================================================================= */
  var VERB = { clearing: 'Submitted', incoming: 'Received', settled: 'Settled' };

  function deltaText(leg) {
    var v = VERB[leg.key];
    if (leg.state === 'complete') return v + ' ' + C.dur(-leg.deltaMin) + ' before cut-off';
    if (leg.state === 'delayed' && leg.actual != null) return v + ' ' + C.dur(leg.overrunMin) + ' past cut-off';
    if (leg.state === 'delayed') return 'Awaiting — ' + C.dur(leg.overrunMin) + ' past the ' + leg.cutoffLabel + ' cut-off';
    if (leg.state === 'inprogress') return 'Running since ' + C.hhmm(leg.started) + ' · ' + C.dur(leg.cutoff - C.NOW_MIN) + ' to cut-off';
    if (leg.state === 'pending') return 'Expected by ' + leg.cutoffLabel + ' · ' + C.dur(leg.cutoff - C.NOW_MIN) + ' to go';
    return 'Failed · cut-off ' + leg.cutoffLabel + (leg.actual != null ? ' · last event ' + C.hhmm(leg.actual) : '');
  }

  function timeline(snap) {
    var start = 0;
    var maxMin = C.NOW_MIN;
    snap.legs.forEach(function (l) {
      maxMin = Math.max(maxMin, l.cutoff, l.actual != null ? l.actual : 0, l.started != null ? l.started : 0);
    });
    var end = Math.min(1440, Math.ceil((maxMin + 55) / 60) * 60);
    function p(min) { return Math.max(0, Math.min(100, ((min - start) / (end - start)) * 100)); }
    function px(min) { return p(min).toFixed(2) + '%'; }

    var ticks = '';
    for (var m = start; m <= end; m += 120) {
      ticks += '<span class="tl-tick' + (p(m) > 94 ? ' at-end' : '') + '" style="left:' + px(m) + '">' + C.hhmm(m) + '</span>';
    }

    var lanes = snap.legs.map(function (leg) {
      var evMin = leg.actual != null ? leg.actual : (leg.started != null ? leg.started : null);
      // The bar runs to the event when there is one; an in-flight leg runs to now;
      // a breached leg stops at its cut-off and the hatch carries the overrun.
      var fillTo = leg.actual != null ? leg.actual
        : leg.state === 'inprogress' ? C.NOW_MIN
          : (leg.state === 'delayed' || leg.state === 'failed') ? leg.cutoff
            : start;
      var overrun = (leg.state === 'delayed' || leg.state === 'failed') && leg.overrunMin > 0
        ? '<div class="tl-overrun st-' + leg.state + '" style="left:' + px(leg.cutoff) + ';width:' + Math.max(0.4, p((leg.actual != null ? leg.actual : C.NOW_MIN)) - p(leg.cutoff)).toFixed(2) + '%" title="' + esc(C.dur(leg.overrunMin) + ' past the ' + leg.cutoffLabel + ' cut-off') + '"></div>'
        : '';
      var ev = '';
      if (evMin != null) {
        ev = '<div class="tl-ev st-' + leg.state + (p(evMin) > 88 ? ' at-end' : '') + '" style="left:' + px(evMin) + '">' +
          '<span class="tl-ev-dot"></span><span class="tl-ev-time">' + C.hhmm(evMin) + '</span></div>';
      } else if (leg.state === 'delayed' || leg.state === 'failed') {
        ev = '<div class="tl-ev st-' + leg.state + '" style="left:' + px(C.NOW_MIN) + '">' +
          '<span class="tl-ev-dot hollow"></span><span class="tl-ev-time">' + (leg.state === 'failed' ? 'failed' : 'awaiting') + '</span></div>';
      }
      var cutClass = 'tl-cut st-' + leg.state + (p(leg.cutoff) > 86 ? ' at-end' : '');
      return '<div class="tl-row">' +
        '<div class="tl-head">' +
        '<div class="tl-title">' + leg.label + ' ' + pill(leg.meta.label, leg.meta.kind, leg.meta.icon) + '</div>' +
        '<div class="tl-sub">' + leg.sub + '</div>' +
        '<div class="tl-delta st-' + leg.state + '">' + deltaText(leg) + '</div>' +
        '</div>' +
        '<div class="tl-track">' +
        '<div class="tl-rail"></div>' +
        '<div class="tl-fill st-' + leg.state + '" style="width:' + px(fillTo) + '"></div>' +
        overrun +
        '<div class="tl-now" style="left:' + px(C.NOW_MIN) + '"></div>' +
        '<div class="' + cutClass + '" style="left:' + px(leg.cutoff) + '" title="' + esc('Expected cut-off ' + leg.cutoffLabel + ' ' + snap.tz.code) + '">' +
        '<span class="tl-cut-flag">cut-off ' + leg.cutoffLabel + (snap.cutoffs.negotiated[leg.key] ? ' · negotiated' : '') + '</span></div>' +
        ev +
        '</div></div>';
    }).join('');

    return '<div class="tl">' +
      '<div class="tl-row tl-axisrow"><div class="tl-head"><div class="tl-axis-label">' + U.prettyDate(snap.date) + ' · ' + snap.tz.code + '</div></div>' +
      '<div class="tl-track tl-axis">' + ticks +
      '<span class="tl-nowflag" style="left:' + px(C.NOW_MIN) + '">now ' + C.hhmm(C.NOW_MIN) + '</span></div></div>' +
      lanes +
      '<div class="tl-key">' +
      '<span class="tl-key-item"><span class="tl-key-cut"></span>expected cut-off</span>' +
      '<span class="tl-key-item"><span class="tl-key-dot"></span>actual event</span>' +
      '<span class="tl-key-item"><span class="tl-key-hatch"></span>overrun past cut-off</span>' +
      '<span class="tl-key-item"><span class="tl-key-now"></span>now</span>' +
      '<span class="tl-key-item meta">Left of a cut-off line is healthy · right of it is delayed.</span>' +
      '</div></div>';
  }

  /* =======================================================================
     PART 4.3 / 4.4 / 4.5 — DETAIL SECTIONS
     ======================================================================= */
  function kv(rows) {
    return '<dl class="cyc-kv">' + rows.map(function (r) {
      if (!r) return '';
      return '<dt>' + r[0] + (r[2] ? ' <span class="cyc-tip" title="' + esc(r[2]) + '">' + icon('info', 12) + '</span>' : '') + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
  }
  function fileRow(f, sub) {
    return '<div class="cyc-file"><span class="cyc-file-ic">' + icon('file-text', 16) + '</span>' +
      '<div class="cyc-file-body"><div class="cyc-file-name">' + esc(f.name) + '</div>' +
      '<div class="cyc-file-meta">' + sub + '</div></div>' +
      '<button class="btn btn-secondary btn-sm" data-action="cyc-download" data-name="' + esc(f.name) + '">' + icon('download', 14) + 'Download</button></div>';
  }
  function legStamp(leg, stamp, fallback) {
    if (stamp) return '<span class="cyc-stamp st-' + leg.state + '">' + esc(stamp) + '</span>';
    return '<span class="cyc-stamp st-' + leg.state + '">' + fallback + '</span>';
  }
  function cutoffCell(snap, key) {
    var c = snap.cutoffs;
    return C.hhmm(c[key]) + ' ' + snap.tz.code +
      (c.negotiated[key] ? ' <span class="cyc-neg">negotiated · platform default ' + C.hhmm(c.platform[key]) + '</span>' : '');
  }

  function clearingCard(snap) {
    var cur = snap.currency, cl = snap.clearing, leg = cl.leg;
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Transaction cohort', 'Transactions from ' + cl.cohortFrom + ' to ' + cl.cohortTo + ' ' + snap.tz.code],
        ['Clearing submitted at', legStamp(leg, cl.submittedAt, leg.state === 'failed' ? 'Submission failed' : 'Not submitted')],
        ['Expected cut-off', cutoffCell(snap, 'clearing')],
        ['Against cut-off', '<span class="st-' + leg.state + ' cyc-strong">' + deltaText(leg) + '</span>']
      ]) +
      kv([
        ['Gross amount cleared', '<span class="num">' + fmt(cl.gross, 2, cur) + '</span>'],
        ['Transaction count', '<span class="num">' + num(cl.count) + '</span>'],
        ['Batches submitted', '<span class="num">' + cl.batches + '</span>'],
        ['Batches held back', cl.heldBack
          ? '<span class="num">' + cl.heldBack.count + '</span> · ' + fmt(cl.heldBack.amount, 2, cur) + '<div class="meta">' + esc(cl.heldBack.reason) + '</div>'
          : 'None']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout danger mt-16">' + icon('x-circle', 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title">Outgoing clearing file</div>' +
      fileRow(cl.file, cl.file.size + ' · ' + cl.file.checksum + ' · ' + cl.file.dest);
    return cardBox('Clearing — outgoing to network' + statusChip(leg), body);
  }

  function incomingCard(snap) {
    var cur = snap.currency, inc = snap.incoming, leg = inc.leg;
    var rej = inc.rejections;
    var rejRows = rej.rows.map(function (r) {
      return '<tr><td class="mono">' + r.arn + '</td><td class="num">' + fmt(r.amount, 2, cur) + '</td>' +
        '<td><div class="cell-main">' + r.reasonCode + '</div><div class="cell-sub">' + esc(r.reasonDesc) + '</div></td>' +
        '<td class="nowrap">' + U.prettyDate(r.expectedSettlement) + '</td></tr>';
    }).join('');
    var rejBlock = rej.count
      ? '<div class="cyc-rej">' +
      '<button class="btn-ghost" data-action="cyc-rej-toggle">' + icon(S.cycle.rejOpen ? 'chevron-down' : 'chevron-right', 14) +
      (S.cycle.rejOpen ? 'Hide rejection details' : 'View rejection details') + '</button>' +
      (S.cycle.rejOpen
        ? '<div class="table-wrap mt-16"><table class="data"><thead><tr><th>ARN</th><th class="num">Amount</th><th>Reason</th><th>Expected settlement (T+2)</th></tr></thead><tbody>' + rejRows + '</tbody></table></div>' +
        '<div class="meta mt-16">Rejected records are deducted from this cycle\'s settlement, re-cleared on T+1 and settle on T+2.</div>'
        : '') + '</div>'
      : '<div class="meta">No rejections in this cycle\'s incoming file.</div>';

    var tip = 'Reported directly in the network\'s incoming file';
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Incoming file received at', legStamp(leg, inc.receivedAt, leg.state === 'failed' ? 'No file — clearing was rejected' : 'Awaiting')],
        ['Expected cut-off', cutoffCell(snap, 'incoming')],
        ['Against cut-off', '<span class="st-' + leg.state + ' cyc-strong">' + deltaText(leg) + '</span>'],
        ['Gross amount received', inc.receivedAt ? '<span class="num">' + fmt(inc.gross, 2, cur) + '</span>' : '—'],
        ['Transactions confirmed', inc.receivedAt ? '<span class="num">' + num(inc.count) + '</span>' : '—']
      ]) +
      kv([
        ['Interchange fee', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.interchange, 2, cur) + '</span>' : '—', tip],
        ['Scheme fee', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.scheme, 2, cur) + '</span>' : '—', tip],
        ['Other adjustments', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.other, 2, cur) + '</span>' : '—', tip],
        ['Total network-reported fees', inc.receivedAt ? '<span class="num cyc-strong">' + fmt(inc.fees.total, 2, cur) + '</span>' : '—', tip],
        ['Incoming rejections', rej.count ? '<span class="num">' + rej.count + '</span> · ' + fmt(rej.amount, 2, cur) : 'None']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout ' + (leg.state === 'failed' ? 'danger' : 'warn') + ' mt-16">' + icon(leg.meta.icon, 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title">Rejections</div>' + rejBlock +
      '<div class="cyc-sub-title">Incoming file</div>' +
      (inc.file ? fileRow(inc.file, inc.file.size + ' · ' + inc.file.checksum)
        : '<div class="meta">' + (leg.state === 'failed' ? 'No incoming file was produced for this cycle.' : 'Not received yet — expected by ' + C.hhmm(snap.cutoffs.incoming) + ' ' + snap.tz.code + '.') + '</div>');
    return cardBox('Incoming — response from network' + statusChip(leg), body);
  }

  function settledCard(snap) {
    var cur = snap.currency, st = snap.settled, leg = st.leg;
    function mrow(label, val, cls) {
      return '<div class="cyc-math-row ' + (cls || '') + '"><span>' + label + '</span><span class="num">' + val + '</span></div>';
    }
    var math =
      mrow('Gross cleared', fmt(st.grossCleared, 2, cur)) +
      mrow('Less: fees reported by network', '− ' + fmt(st.fees, 2, cur)) +
      mrow('Less: rejections deducted', '− ' + fmt(st.rejectionsDeducted, 2, cur)) +
      mrow('Net settlement expected', fmt(st.netExpected, 2, cur), 'total') +
      mrow('Actually settled to nostro', st.actual != null ? fmt(st.actual, 2, cur) : '—') +
      mrow('Delta', st.delta != null ? fmt(st.delta, 2, cur) : '—', st.delta ? 'bad' : 'good');

    var files = st.files.map(function (f) {
      return fileRow(f, f.desc + ' · ' + f.size + ' · ' + (f.generatedAt ? 'generated ' + f.generatedAt : 'not generated yet'));
    }).join('');

    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Settled at', legStamp(leg, st.settledAt, leg.state === 'failed' ? 'Settlement failed' : 'Expected by ' + C.hhmm(snap.cutoffs.settled) + ' ' + snap.tz.code)],
        ['Expected cut-off', cutoffCell(snap, 'settled')],
        ['Against cut-off', '<span class="st-' + leg.state + ' cyc-strong">' + deltaText(leg) + '</span>'],
        ['Merchant fees this cycle (MDR)', '<span class="num">' + fmt(st.mdr, 2, cur) + '</span>', 'Merchant Discount Rate charged to merchants — the bank\'s revenue side']
      ]) +
      '<div class="cyc-math">' + math + '</div>' +
      '</div>' +
      (leg.note ? '<div class="callout danger mt-16">' + icon('x-circle', 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title" id="snap-files">Settlement files for this cycle</div>' + files;
    return cardBox('Settled — funds to acquirer nostro' + statusChip(leg), body);
  }

  function statusChip(leg) {
    return ' <span class="cyc-head-chip st-' + leg.state + '">' + icon(leg.meta.icon, 13) + leg.meta.label + '</span>';
  }

  /* Part 4.6 — compact reconciliation callout */
  function reconCallout(snap) {
    var r = snap.recon, cur = snap.currency;
    var link = '#/dashboard/ops/reconciliation?reconTenant=' + snap.tenant.id + (r.cycleId ? '&reconCycle=' + r.cycleId : '');
    return '<div class="cyc-recon ' + r.kind + '">' +
      '<div class="cyc-recon-body">' +
      '<div class="cyc-recon-head">Reconciliation ' + pill(r.status, r.kind, r.kind === 'success' ? 'check' : (r.kind === 'danger' ? 'alert-octagon' : 'clock')) + '</div>' +
      '<div class="meta">' + esc(r.note) + (r.residual ? ' Residual <span class="num cyc-strong">' + fmt(r.residual, 2, cur) + '</span>.' : '') + '</div>' +
      '</div>' +
      '<button class="btn btn-secondary" data-route="' + link + '">' + icon('git-compare', 15) + 'View reconciliation</button>' +
      '</div>';
  }

  /* =======================================================================
     PART 4.1 — THE SNAPSHOT SCREEN
     ======================================================================= */
  function header(snap) {
    var t = snap.tenant, net = snap.network;
    var idx = C.cycleDates.indexOf(snap.date);
    var prev = idx > 0 ? C.cycleDates[idx - 1] : null;
    var next = idx >= 0 && idx < C.cycleDates.length - 1 ? C.cycleDates[idx + 1] : null;
    var hol = snap.holiday;

    var nav = '<div class="cyc-cycle-nav">' +
      '<button class="btn btn-secondary btn-sm" ' + (prev ? 'data-route="' + snapRoute(t.id, net.key, prev) + '"' : 'disabled') + '>' + icon('chevron-left', 14) + 'Previous cycle</button>' +
      '<button class="btn btn-secondary btn-sm" ' + (next ? 'data-route="' + snapRoute(t.id, net.key, next) + '"' : 'disabled') + '>Next cycle' + icon('chevron-right', 14) + '</button>' +
      '</div>';

    return '<div class="breadcrumb"><a data-route="#/dashboard/ops">Ops Home</a><span class="sep">/</span><span>Cycle Snapshot</span></div>' +
      '<div class="page-head cyc-head">' +
      '<div>' +
      '<h1 class="page-title cyc-title">' + tenantTag(t.id) +
      '<span class="cyc-net-badge" style="background:' + net.color + '1A;color:' + net.color + ';border-color:' + net.color + '40">' + net.name + '</span></h1>' +
      '<div class="subtitle">Cycle ' + U.prettyDate(snap.date) + ' · ' + snap.dow + ' · ' + snap.tz.code + ' (' + snap.tz.offset + ')' +
      (hol ? ' · ' + pill(hol.name, hol.impact === 'Full holiday' ? 'danger' : 'warning', 'calendar-x') : '') + '</div>' +
      '</div>' +
      '<div class="cyc-head-right">' +
      (snap.status ? '<div class="cyc-status"><div class="cyc-status-pill">' + pill(snap.status.text, snap.status.kind, snap.status.icon) + '</div><div class="meta cyc-status-line">' + esc(snap.status.line) + '</div></div>' : '') +
      '<div class="head-actions">' +
      '<button class="btn btn-secondary" data-action="cyc-back">' + icon('arrow-left', 15) + 'Back to Ops Home</button>' +
      '<button class="btn btn-secondary" data-action="cyc-refresh">' + icon('refresh-cw', 15) + 'Refresh</button>' +
      '<button class="btn btn-secondary" data-action="cyc-files">' + icon('folder', 15) + 'View settlement files</button>' +
      '<button class="btn btn-secondary" data-route="#/dashboard/ops/reconciliation?reconTenant=' + t.id + (snap.recon && snap.recon.cycleId ? '&reconCycle=' + snap.recon.cycleId : '') + '">' + icon('git-compare', 15) + 'View reconciliation</button>' +
      '</div>' + nav +
      '</div></div>';
  }

  /* Part 4.7 — empty / not-started states */
  function scheduleCard(snap) {
    var rows = C.LEG_DEFS.map(function (def) {
      return '<tr><td>' + def.label + '</td><td class="cell-sub">' + def.sub + '</td><td class="num">' +
        C.hhmm(snap.cutoffs[def.key]) + ' ' + snap.tz.code + '</td>' +
        '<td class="cell-sub">' + (snap.cutoffs.negotiated[def.key] ? 'negotiated for ' + snap.tenant.name + ' · platform default ' + C.hhmm(snap.cutoffs.platform[def.key]) : 'platform default for ' + snap.network.name) + '</td></tr>';
    }).join('');
    return cardBox('Expected schedule', '<table class="data"><thead><tr><th>Leg</th><th>What happens</th><th class="num">Expected cut-off</th><th>Source</th></tr></thead><tbody>' + rows + '</tbody></table>');
  }

  function viewSnapshot(tenantId, netKey, date) {
    var snap = C.snapshot(tenantId, netKey, date);
    if (!snap) { go('#/dashboard/ops'); return; }

    if (snap.holiday && snap.holiday.impact === 'Full holiday') {
      setView(header(snap) +
        '<div class="card">' + kit.emptyState('calendar-x', 'This is a bank holiday — no files expected',
          snap.holiday.name + ' · ' + snap.tenant.country + '. No clearing, incoming or settlement activity is scheduled for ' + snap.network.name + ' on this cycle.') + '</div>' +
        '<div class="mt-24">' + scheduleCard(snap) + '</div>');
      return;
    }
    if (!snap.legs.length) {
      setView(header(snap) +
        '<div class="card">' + kit.emptyState('circle-dashed', 'Cycle has not started',
          'The ' + U.prettyDate(snap.date) + ' cycle for ' + snap.tenant.name + ' · ' + snap.network.name + ' opens at 00:00 ' + snap.tz.code + '. Expected cut-offs below.') + '</div>' +
        '<div class="mt-24">' + scheduleCard(snap) + '</div>');
      return;
    }

    setView(
      header(snap) +
      '<div class="section-title mb-16">Three-leg timeline</div>' +
      cardBox('', timeline(snap)) +
      '<div class="section-title mb-16 mt-24">Cycle detail</div>' +
      '<div class="cyc-sections">' +
      clearingCard(snap) +
      incomingCard(snap) +
      settledCard(snap) +
      '</div>' +
      '<div class="mt-24">' + reconCallout(snap) + '</div>'
    );
  }

  /* =======================================================================
     ROUTING + ACTIONS
     ======================================================================= */
  function route(rest) {
    var tenantId = rest[0], netKey = rest[1], date = rest[2] || C.TODAY;
    if (!O.tenantById[tenantId] || !D.NET_BY_KEY[netKey]) { go('#/dashboard/ops'); return; }
    // A different cycle starts with the rejection table collapsed again.
    if (S.cycle.tenantId !== tenantId || S.cycle.networkKey !== netKey || S.cycle.date !== date) S.cycle.rejOpen = false;
    S.cycle.tenantId = tenantId; S.cycle.networkKey = netKey; S.cycle.date = date;
    return viewSnapshot(tenantId, netKey, date);
  }

  var ACTIONS = {
    'cyc-back': function () { go('#/dashboard/ops'); },
    'cyc-refresh': function () {
      viewSnapshot(S.cycle.tenantId, S.cycle.networkKey, S.cycle.date);
      toast('Cycle status refreshed · as of ' + C.hhmm(C.NOW_MIN) + ' ' + C.tzOf(S.cycle.tenantId).code);
    },
    'cyc-files': function () {
      var target = el('snap-files');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'cyc-rej-toggle': function () {
      S.cycle.rejOpen = !S.cycle.rejOpen;
      viewSnapshot(S.cycle.tenantId, S.cycle.networkKey, S.cycle.date);
    },
    'cyc-download': function (t) { toast('Downloading ' + t.getAttribute('data-name')); }
  };

  return { gridHtml: gridHtml, route: route, actions: ACTIONS, ROUTE: ROUTE };
};
