/* =============================================================================
   Juspay Bank Portal — Application (routing, views, charts, handlers)
   Vanilla JS. State in memory only (no browser storage — Part 8.4).
   ============================================================================= */
(function () {
  'use strict';
  var D = window.DATA;
  var U = D.util;

  /* ---- In-memory state ---------------------------------------------------- */
  window.AppState = {
    portal: 'bank',
    sidebarCollapsed: false,
    expanded: { merchants: true, reconciliation: true, 'ops-configs': true, 'ops-netfiles': true },
    active: { section: 'home', child: null },
    tabs: { feeConfigs: 'current', feeBreakdown: 'query', reports: 'library', profile: 'overview', merchantPerf: 'portfolio', disputes: 'All' },
    filters: {
      merchants: { q: '', status: 'all', mcc: 'all' },
      cyclesGroup: 'date', holidayCountry: 'India', feeBreakdownGroup: 'network', perfRange: '30d'
    },
    addStep: 1, addFiles: [], proposeMid: null,
    reportError: false, reportGenerating: false, reportDelivery: 'Download',
    loading: {},
    // ---- Ops Portal (Phase 2) ----
    opsActive: 'ops-home',
    opsChild: null,          // active nested sub-item (Phase 3: Platform Configs)
    // Shell (design overhaul Part 2.1) — rail overflow menu, nav context
    // popover and the account popover. Both portals run this shell now.
    // All transient, all in memory.
    railMenu: false, navContext: false, navUserMenu: false,
    query: {},
    ops: {
      approvalTab: 'pending', approvalsTenant: 'all', approvalsSla: 'all', approvalsQuery: '',
      reconTenant: null, reconCycle: null,
      // Deep-link targets: a failure block's action, or an Ops Home queue row,
      // can land on this screen already filtered to one cycle date, with the
      // validation report for that row open.
      filesTenant: 'hsbc-in', filesDate: null, filesOpenValidation: null,
      disputesTenant: 'all', disputesUrgency: '<7 days', disputesStage: 'all',
      onboardStep: 1, onboardFiles: [],
      // Part 7.2 — the holiday calendar is a tab of Acquirer Onboarding now.
      onboardTab: 'acquirers',
      holidayCountry: 'All', holidayView: 'list', holidayEdit: null
    }
  };
  var S = window.AppState;
  var O = window.OPS;
  var _charts = {};
  var _apprDebounce = null;

  /* ---- Number / currency formatting (Part 6.6) ---------------------------- */
  function groupIndian(s) {
    s = String(s);
    if (s.length <= 3) return s;
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  function groupIntl(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var CUR_SYM = { INR: '₹', SGD: 'S$', HKD: 'HK$', AUD: 'A$', MYR: 'RM' };
  function fmt(n, dec, cur) {
    cur = cur || D.tenant.currency; dec = (dec == null) ? 2 : dec;
    var neg = n < 0; n = Math.abs(n);
    var fixed = n.toFixed(dec), parts = fixed.split('.');
    var ip = (cur === 'INR') ? groupIndian(parts[0]) : groupIntl(parts[0]);
    return (neg ? '-' : '') + (CUR_SYM[cur] || '') + ip + (parts[1] ? '.' + parts[1] : '');
  }
  function fmtT(n, dec) { return n === 0 ? '—' : fmt(n, dec); }        // zero-in-table → em dash
  function fmtCr(n) {                                                   // compact for KPIs / big numbers
    var neg = n < 0; n = Math.abs(n);
    if (n >= 10000000) return (neg ? '-' : '') + '₹' + (n / 10000000).toFixed(2) + ' Cr';
    if (n >= 100000) return (neg ? '-' : '') + '₹' + (n / 100000).toFixed(2) + ' L';
    return fmt(n);
  }
  function num(n) { return groupIndian(Math.round(n)); }               // counts, Indian grouping
  function pct(n, dec) { return (n).toFixed(dec == null ? 2 : dec) + '%'; }

  /* ---- Tiny DOM helpers --------------------------------------------------- */
  function icon(name, size) { size = size || 16; return '<i data-lucide="' + name + '" style="width:' + size + 'px;height:' + size + 'px"></i>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function setView(html) { el('view').innerHTML = html; if (window.lucide) lucide.createIcons(); }

  /* Ops status pills always carry a 14px icon (Part 2.4). Callers that pass one
     keep it; the rest fall back to the icon for their status. Bank Portal pills
     are unchanged — an icon-less pill there still renders icon-less. */
  var PILL_ICON = {
    success: 'check-circle', warning: 'alert-triangle', danger: 'x-circle',
    info: 'file-text', neutral: 'circle', primary: 'file-text',
    nullified: 'ban', correction: 'corner-down-right'
  };
  function pill(text, kind, ic) {
    if (!ic && S.portal === 'ops') ic = PILL_ICON[kind] || 'circle';
    return '<span class="pill pill-' + kind + '">' + (ic ? icon(ic, 14) : '') + text + '</span>';
  }
  function delta(v, invert) {
    var up = v > 0, down = v < 0;
    var good = invert ? down : up;
    var cls = v === 0 ? 'flat' : (good ? 'up' : 'down');
    var ic = v === 0 ? 'minus' : (up ? 'arrow-up-right' : 'arrow-down-right');
    return '<span class="delta ' + cls + '">' + icon(ic, 14) + Math.abs(v).toFixed(2) + '%</span>';
  }

  function spark(values, w, h, color) {
    if (!values || values.length < 2) return '';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), range = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = h - ((v - min) / range) * (h - 4) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline points="0,' + h + ' ' + pts + ' ' + w + ',' + h + '" fill="' + color + '" fill-opacity="0.10" stroke="none"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // Three-state pill row: Authorized · Incoming Parsed · Cleared/Settled (Part 2.6 #3)
  function triState(states, showTs) {
    // <wbr> lets "Cleared/Settled" break after the slash in narrow columns (no space to wrap on otherwise)
    var defs = [['authorized', 'Authorized'], ['parsed', 'Incoming Parsed'], ['settled', 'Cleared/<wbr>Settled']];
    var prevDone = true, out = '<div class="tri-state">';
    defs.forEach(function (d, i) {
      var st = states[d[0]] || { done: false };
      var kind, ic;
      if (st.done) { kind = 'success'; ic = 'check'; }
      else if (prevDone) { kind = 'warning'; ic = 'clock'; }
      else { kind = 'neutral'; ic = 'circle'; }
      out += '<div class="tri-pill">' + pill(d[1], kind, ic) +
        (showTs ? '<span class="tri-ts">' + (st.ts || 'pending') + '</span>' : '') + '</div>';
      if (i < 2) out += '<div class="tri-connector">' + icon('chevron-right', 14) + '</div>';
      prevDone = st.done;
    });
    return out + '</div>';
  }

  function netStripMini(cycle) {
    var out = '<div class="net-strip">';
    D.NETWORKS.forEach(function (net) {
      var st = cycle.networks[net.key].states, prevDone = true;
      var dots = '';
      ['authorized', 'parsed', 'settled'].forEach(function (k) {
        var s = st[k] || { done: false }, cls;
        if (s.done) cls = 'dot-done'; else if (prevDone) cls = 'dot-progress'; else cls = 'dot-pending';
        dots += '<span class="net-dot ' + cls + '"></span>';
        prevDone = s.done;
      });
      out += '<div class="net-mini"><span class="net-mini-label">' + net.short + '</span><span class="net-dots">' + dots + '</span></div>';
    });
    return out + '</div>';
  }

  /* ---- Immutability component (Part 2.6 #2) — identical in all 3 places --- */
  function immutableEntry(e) {
    var pillHtml = e.kind === 'nullified' ? pill('nullified', 'nullified', 'ban')
      : e.kind === 'correction' ? pill('correction', 'correction', 'corner-down-right') : '';
    return '<div class="immutable-entry ' + e.kind + '">' +
      '<div class="ie-head">' + pillHtml + '<span class="ie-meta">' + esc(e.at) + ' · ' + esc(e.by) + '</span></div>' +
      '<div class="ie-text">' + esc(e.text) + '</div>' +
      (e.reason ? '<div class="ie-meta">Reason: ' + esc(e.reason) + '</div>' : '') + '</div>';
  }
  function immutablePair(nullified, correction) {
    return '<div class="immutable-pair">' + immutableEntry(nullified) + immutableEntry(correction) + '</div>';
  }
  // Render a change-history list, grouping adjacent nullified+correction into a pair
  function immutableTimeline(events) {
    var out = '', i = 0;
    while (i < events.length) {
      var e = events[i], n = events[i + 1];
      // Always render the nullified original on top with its correction directly below,
      // grouped as a pair — identical everywhere, regardless of source ordering.
      if (e.kind === 'nullified' && n && n.kind === 'correction') { out += immutablePair(e, n); i += 2; }
      else if (e.kind === 'correction' && n && n.kind === 'nullified') { out += immutablePair(n, e); i += 2; }
      else { out += immutableEntry(e); i++; }
    }
    return out;
  }
  // Convert a cycle correction record into the canonical nullified/correction pair
  function cycleCorrectionPair(c) {
    return immutablePair(
      { kind: 'nullified', at: c.nullifiedAt, by: c.by, text: c.network + ' · ' + c.field + ': ' + fmt(c.originalValue) },
      { kind: 'correction', at: c.correctedAt, by: c.by, text: c.network + ' · ' + c.field + ': ' + fmt(c.correctedValue), reason: c.reason }
    );
  }
  // Fee-config change history with a visible correction pair (per merchant, deterministic)
  function feeHistoryFor(m) {
    return [
      { kind: 'normal', at: '12 Aug 2025, 10:15 IST', by: 'Ananya Iyer', text: 'Visa Credit Domestic MDR 1.95% → 2.05% (approved by Juspay).' },
      { kind: 'nullified', at: '30 Sep 2025, 12:04 IST', by: 'Rahul Menon', text: 'Mastercard Debit Domestic MDR set to 1.42% (above regulatory cap).' },
      { kind: 'correction', at: '30 Sep 2025, 12:21 IST', by: 'Rahul Menon', text: 'Mastercard Debit Domestic MDR corrected to 1.15% — prior entry exceeded the debit MDR ceiling.', reason: 'RBI debit MDR cap breach caught by policy validation; re-posted at compliant rate.' },
      { kind: 'normal', at: '05 Nov 2025, 09:30 IST', by: 'System', text: 'RuPay scheme fee aligned to rate table v2025.11.' }
    ];
  }

  function cardBox(title, body, headActions, cls) {
    return '<div class="card ' + (cls || '') + '">' +
      (title ? '<div class="card-head"><div class="card-title">' + title + '</div>' + (headActions || '') + '</div>' : '') +
      body + '</div>';
  }
  function emptyState(ic, title, msg, action) {
    return '<div class="empty-state"><div class="es-icon">' + icon(ic, 26) + '</div><h3>' + title + '</h3><p>' + msg + '</p>' + (action || '') + '</div>';
  }
  function errorState(msg, retryAction) {
    return '<div class="error-state"><div class="es-icon">' + icon('alert-triangle', 26) + '</div><h3>Something went wrong</h3><p>' + msg + '</p>' +
      '<button class="btn btn-secondary" data-action="' + retryAction + '">' + icon('refresh-cw', 16) + 'Retry</button></div>';
  }
  function skeletonRows(n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="skeleton skel-row"></div>';
    return '<div>' + out + '</div>';
  }
  /* ======================================================================== *
     OPS COMPONENT LIBRARY (overhaul Part 2.4 / 3.1 / 3.3)
     Built once here and shared with every Ops module through CFGKIT, so no
     screen re-implements a header, a KPI card, a filter row or a side panel.
     ======================================================================== */

  /* Part 5.2 — one way to print a cycle, everywhere it is referenced: the
     identifier in monospace with the human date beneath it in muted text. A
     date on its own is not an identifier — it cannot tell two cycles on the
     same day apart, which is exactly what multi-cycle clearing and multi-cycle
     incoming produce. */
  function cycleIdCell(id, date, cls) {
    return '<div class="cycle-id' + (cls ? ' ' + cls : '') + '">' +
      '<span class="cycle-id-code mono">' + esc(id) + '</span>' +
      (date ? '<span class="cycle-id-date">' + esc(U.prettyDate(date)) + '</span>' : '') + '</div>';
  }

  // Part 3.1 — every screen opens the same way: title, one line of subtitle,
  // and at most one primary action on the right.
  function pageHead(title, subtitle, actions) {
    return '<div class="page-head"><div>' +
      '<h1 class="page-title">' + title + '</h1>' +
      (subtitle ? '<div class="subtitle">' + subtitle + '</div>' : '') +
      '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  }

  // KPI card with the optional 44px accent icon tile.
  function kpiCard(o) {
    return '<div class="kpi-card' + (o.tile ? ' tiled' : '') + (o.route ? ' clickable' : '') + '"' +
      (o.route ? ' data-route="' + o.route + '"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' +
      (o.tile ? '<div class="kpi-tile ' + o.tile + '">' + icon(o.icon || 'activity', 22) + '</div>' : '') +
      '<div class="kpi-label">' + o.label + '</div>' +
      '<div class="kpi-value num">' + o.value + '</div>' +
      (o.sub ? '<div class="kpi-foot">' + o.sub + '</div>' : '') + '</div>';
  }

  // A table inside its own card shell (Part 2.4) — the shell owns the radius
  // and the border, the wrapper owns the horizontal scroll.
  function tableCard(inner, cls) {
    return '<div class="table-card ' + (cls || '') + '"><div class="table-wrap">' + inner + '</div></div>';
  }

  function opsSelect(action, value, options, aria) {
    return '<span class="ops-select"><select data-action="' + action + '" aria-label="' + esc(aria || action) + '">' +
      options.map(function (o) {
        // Array.isArray, not `instanceof Array` — the latter is false for an
        // array created in another realm, which silently renders every option
        // as its own comma-joined source.
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>' + icon('chevron-down', 16) + '</span>';
  }

  /* Part 3.3 — one filter-row shape everywhere: search, then categorical
     filters (4 visible at most), then the preset, then the date range, then
     refresh. Active filters render as removable chips underneath. */
  function opsFilterRow(o) {
    var html = '<div class="ops-filters">';
    if (o.search) {
      html += '<label class="ops-search">' + icon('search', 18) +
        '<input class="input" type="text" placeholder="' + esc(o.search.placeholder || 'Search…') + '" ' +
        'value="' + esc(o.search.value || '') + '" data-action="' + o.search.action + '" aria-label="' + esc(o.search.placeholder || 'Search') + '" /></label>';
    }
    (o.filters || []).forEach(function (f) { html += opsSelect(f.action, f.value, f.options, f.label); });
    if (o.preset) html += opsSelect(o.preset.action, o.preset.value, o.preset.options, 'Date preset');
    if (o.dateRange) html += '<span class="ops-daterange">' + icon('calendar', 18) + o.dateRange + '</span>';
    if (o.refresh) {
      html += '<button class="icon-btn ops-refresh" data-action="' + o.refresh + '" title="Refresh" aria-label="Refresh">' +
        icon('refresh-cw', 18) + '</button>';
    }
    if (o.extra) html += o.extra;
    html += '</div>';
    if (o.chips && o.chips.length) {
      html += '<div class="ops-chips">' + o.chips.map(function (c) {
        return '<span class="ops-chip">' + esc(c.label) +
          '<button data-action="' + c.action + '"' + (c.data || '') + ' aria-label="Remove ' + esc(c.label) + '">' + icon('x', 14) + '</button></span>';
      }).join('') + '</div>';
    }
    return html;
  }

  // Track-and-knob toggle (Part 2.4), label on the right.
  function opsToggle(action, on, label, data) {
    return '<label class="ops-toggle"><input type="checkbox"' + (on ? ' checked' : '') +
      ' data-action="' + action + '"' + (data || '') + ' /><span class="ops-track"></span>' +
      '<span class="ops-toggle-label">' + esc(label) + '</span></label>';
  }

  // Right-hand side panel: eyebrow + name header, scrolling body, pinned footer.
  function sidePanel(o) {
    // No stopPropagation on the panel: every control inside relies on the
    // document-level delegated click listener, and stopping propagation here
    // swallows those clicks before they reach it (the panel goes inert). The
    // delegate itself refuses to resolve an inside-the-panel click to the
    // overlay backdrop's close action.
    return '<div class="overlay" data-action="' + (o.close || 'close-overlay') + '">' +
      '<div class="side-panel' + (o.wide ? ' wide' : '') + ' ' + (o.cls || '') + '">' +
      '<div class="sp-head"><div style="flex:1;min-width:0">' +
      '<div class="sp-eyebrow">' + esc(o.eyebrow || '') + '</div>' +
      '<div class="sp-name">' + (o.name || '') + '</div></div>' +
      (o.headExtra || '') +
      '<button class="icon-btn" data-action="' + (o.close || 'close-overlay') + '" aria-label="Close">' + icon('x', 18) + '</button></div>' +
      '<div class="sp-body">' + o.body + '</div>' +
      (o.foot ? '<div class="sp-foot">' + o.foot + '</div>' : '') +
      '</div></div>';
  }

  // Vertical step timeline (Part 2.4) — success / failure / pending.
  function opsTimeline(steps) {
    return '<div class="ops-timeline">' + steps.map(function (s) {
      var ic = s.state === 'done' ? 'check-circle' : (s.state === 'failed' ? 'x-circle' : 'circle');
      return '<div class="ops-step ' + s.state + '">' +
        '<span class="ops-step-icon">' + icon(ic, 20) + '</span>' +
        '<div><div class="ops-step-label">' + esc(s.label) + '</div>' +
        (s.status ? '<div class="ops-step-status">' + esc(s.status) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function toast(msg, kind) {
    var wrap = el('toasts'); var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'success');
    t.innerHTML = (kind === 'success' || !kind ? icon('check-circle', 18) : icon('info', 18)) + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(t); if (window.lucide) lucide.createIcons();
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 250); }, 2600);
  }

  /* ---- Chart helpers ------------------------------------------------------ */
  function chart(id, config) {
    var cv = el(id); if (!cv || !window.Chart) return;
    if (_charts[id]) { _charts[id].destroy(); }
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#64748B';
    _charts[id] = new Chart(cv.getContext('2d'), config);
  }
  function destroyCharts() { Object.keys(_charts).forEach(function (k) { _charts[k].destroy(); delete _charts[k]; }); }
  var GRID = '#F1F5F9';

  /* ======================================================================== *
     SHELL — sidebar + top bar (persist across Bank / Ops routes)
     ======================================================================== */
  var NAV = [
    { id: 'home', label: 'Home', icon: 'home', route: '#/dashboard/bank/home' },
    {
      id: 'merchants', label: 'Merchants', icon: 'store', route: '#/dashboard/bank/merchants', children: [
        { id: 'merchants-list', label: 'Merchants', icon: 'store', route: '#/dashboard/bank/merchants' },
        { id: 'merchants-performance', label: 'Merchant Performance', icon: 'bar-chart-2', route: '#/dashboard/bank/merchants/performance' },
        { id: 'merchants-fee-configs', label: 'Fee Configs', icon: 'percent', route: '#/dashboard/bank/merchants/fee-configs' }
      ]
    },
    {
      id: 'reconciliation', label: 'Reconciliation', icon: 'list-checks', route: '#/dashboard/bank/reconciliation', children: [
        { id: 'recon-home', label: 'Reconciliation Home', icon: 'list-checks', route: '#/dashboard/bank/reconciliation' },
        { id: 'recon-fee-breakdown', label: 'Fee Breakdown', icon: 'dollar-sign', route: '#/dashboard/bank/reconciliation/fee-breakdown' },
        { id: 'recon-cycles', label: 'Settlement Cycles', icon: 'calendar', route: '#/dashboard/bank/reconciliation/cycles' }
      ]
    },
    { id: 'disputes', label: 'Disputes', icon: 'alert-circle', route: '#/dashboard/bank/disputes' },
    { id: 'reports', label: 'Reports', icon: 'file-text', route: '#/dashboard/bank/reports' },
    { id: 'users', label: 'Users & Access', icon: 'users', route: '#/dashboard/bank/users' }
  ];

  // Ops Portal sidebar — 7 sections. Platform Configs (Phase 3) is the only
  // nested parent, matching the Bank Portal's Merchants / Reconciliation pattern.
  var OPS_NAV = [
    { id: 'ops-home', label: 'Ops Home', icon: 'home', route: '#/dashboard/ops' },
    { id: 'ops-approvals', label: 'Merchant Fees', full: 'Merchant Fees', icon: 'check-square', route: '#/dashboard/ops/approvals' },
    /* Refinement Part 4.3 — Recon Files is gone as a destination. Its content
       folds into Reconciliation, which is now one screen: the recon history
       table with a side panel of progress steps and figures. */
    { id: 'ops-recon', label: 'Reconciliation', icon: 'git-compare', route: '#/dashboard/ops/reconciliation' },
    /* Refinement Part 5 — Clearing Files becomes Network Files with two
       children. Outgoing and Incoming are genuinely different workflows with
       different states and different scripts, so they get their own screens
       rather than a direction filter on one. */
    {
      id: 'ops-netfiles', label: 'Network Files', full: 'Network Files', icon: 'arrow-left-right',
      route: '#/dashboard/ops/network-files/outgoing', children: [
        { id: 'ops-nf-out', label: 'Outgoing', full: 'Network Files — Outgoing', noIcon: true, route: '#/dashboard/ops/network-files/outgoing' },
        { id: 'ops-nf-in', label: 'Incoming', full: 'Network Files — Incoming', noIcon: true, route: '#/dashboard/ops/network-files/incoming' }
      ]
    },
    { id: 'ops-files', label: 'Acquirer Reports', full: 'Acquirer Reports', icon: 'upload', route: '#/dashboard/ops/files' },
    { id: 'ops-rejects', label: 'Rejects', icon: 'file-warning', route: '#/dashboard/ops/rejects' },
    { id: 'ops-onboarding', label: 'Acquirer Onboarding', icon: 'building', route: '#/dashboard/ops/onboarding' },
    {
      // Sub-items inherit the parent's icon style — no separate icons (Part 2.1),
      // which is what leaves room for the labels at the nested indent.
      id: 'ops-configs', label: 'Platform Configs', icon: 'settings-2', route: '#/dashboard/ops/configs', children: [
        { id: 'ops-cfg-network', label: 'Network File', full: 'Network File Configs', noIcon: true, route: '#/dashboard/ops/configs/network-files' },
        { id: 'ops-cfg-settlement', label: 'Settlement', full: 'Settlement Configs', noIcon: true, route: '#/dashboard/ops/configs/settlement' },
        { id: 'ops-cfg-incoming', label: 'Incoming Parsing', full: 'Incoming Parsing Configs', noIcon: true, route: '#/dashboard/ops/configs/incoming' }
      ]
    },
    { id: 'ops-disputes', label: 'Dispute Ops Support', icon: 'life-buoy', route: '#/dashboard/ops/disputes' }
  ];

  /* ---- Shell (Part 2.1) — icon rail + light nav panel ----------------------
     Three panels, all light: a 72px icon rail, a 230px nav panel and the
     content area. The dark top bar is gone — the portal switcher moved into
     the rail and search moved to the top of the content area. Both portals
     render this shell; only its contents differ (see navConfig). */
  var OPS_USER = 'ops.analyst@juspay.in';

  function renderRail() {
    var isOps = S.portal === 'ops';
    var portals = [
      { key: 'bank', initials: 'BP', label: 'Bank Portal', route: '#/dashboard/bank/home' },
      { key: 'ops', initials: 'OP', label: 'Ops Portal', route: '#/dashboard/ops' }
    ];
    var avatars = portals.map(function (p) {
      var on = (p.key === 'ops') === isOps;
      return '<button class="rail-avatar' + (on ? ' active' : '') + '" data-route="' + p.route + '" ' +
        'title="' + p.label + '" aria-label="' + p.label + '" aria-current="' + (on ? 'true' : 'false') + '">' +
        p.initials + '</button>';
    }).join('');
    el('rail').innerHTML =
      '<button class="rail-home" data-route="' + (isOps ? '#/dashboard/ops' : '#/dashboard/bank/home') + '" ' +
      'title="Home" aria-label="Home">' + icon('home', 20) + '</button>' +
      '<div class="rail-divider"></div>' +
      '<div class="rail-stack">' + avatars + '</div>' +
      '<div class="rail-spacer"></div>' +
      '<button class="rail-more" data-action="rail-more" title="More" aria-label="More">' + icon('more-horizontal', 20) + '</button>' +
      (S.railMenu
        ? '<div class="rail-menu"><div class="rail-menu-label">Go to</div>' +
        '<button data-route="#/dashboard/bank/home">' + icon('building-2', 16) + 'Bank Portal</button>' +
        '<button data-route="#/dashboard/ops">' + icon('server', 16) + 'Ops Portal</button>' +
        '<div class="rail-menu-sep"></div>' +
        '<button data-route="' + (isOps ? '#/dashboard/ops/onboarding' : '#/dashboard/bank/reports/holidays') + '">' +
        icon('calendar-days', 16) + 'Holiday calendar</button>' +
        '</div>'
        : '');
    if (window.lucide) lucide.createIcons();
  }

  // Search sits at the top of the content area, not in a top bar (Part 2.1).
  function renderSearchRow() {
    el('opsSearch').innerHTML =
      '<span class="ops-search-icon">' + icon('search', 18) + '</span>' +
      '<input id="globalSearch" type="text" placeholder="Search (⌘+K)" aria-label="Search" />';
    if (window.lucide) lucide.createIcons();
  }

  /* The two portals differ only in what fills the nav panel: which sections,
     which scope sits in the context popover, and who is signed in. Everything
     structural is shared, which is what keeps the two design languages one. */
  function navConfig() {
    if (S.portal === 'ops') {
      return {
        items: OPS_NAV,
        context: 'juspay_ops',
        contextMenu: '<div class="ncm-label">Tenants in scope</div>' +
          O.tenants.map(function (t) {
            return '<div class="ncm-row"><span class="tenant-dot" style="background:' + t.color + '"></span>' +
              esc(t.name) + '<span class="ncm-meta">' + esc(t.country) + '</span></div>';
          }).join(''),
        activeId: S.opsActive,
        activeChild: S.opsChild,
        user: OPS_USER,
        userNote: 'Role is set per config screen — Maker or Checker.',
        holidayRoute: '#/dashboard/ops/onboarding'
      };
    }
    var t = D.tenant;
    return {
      items: NAV,
      context: t.name,
      contextMenu: '<div class="ncm-label">Tenant in scope</div>' +
        '<div class="ncm-row strong"><span class="tenant-dot" style="background:var(--tenant-hsbc-in)"></span>' +
        esc(t.name) + '<span class="ncm-meta">' + esc(t.region) + '</span></div>' +
        '<div class="ncm-row"><span class="ncm-meta">' + esc(t.country) + ' · settles in ' + esc(t.currency) + '</span></div>',
      activeId: S.active.section,
      activeChild: S.active.child,
      user: D.user.email,
      userNote: D.user.fullName + ' — ' + D.user.role,
      holidayRoute: '#/dashboard/bank/reports/holidays'
    };
  }

  /* The nav panel. Section rows carry a hexagon outline that fills when active
     (Part 2.1); the section's own icon is kept for the icons-only collapsed
     state, where identical hexagons would be unreadable. */
  function renderSidebar() {
    var cfg = navConfig();
    var html = '<div class="nav-context">' +
      '<button class="nav-context-btn" data-action="nav-context" aria-expanded="' + (S.navContext ? 'true' : 'false') + '">' +
      '<span>' + esc(cfg.context) + '</span>' + icon('chevron-down', 16) + '</button>' +
      '<button class="nav-collapse" data-action="toggle-sidebar" title="Collapse panel" aria-label="Collapse navigation panel">' +
      icon('panel-left', 18) + '</button>' +
      (S.navContext ? '<div class="nav-context-menu">' + cfg.contextMenu + '</div>' : '') +
      '</div>';

    html += '<div class="nav-scroll">';
    cfg.items.forEach(function (item) {
      var isActiveSection = cfg.activeId === item.id;
      function row(it, active, nested) {
        return '<div class="nav-item' + (active ? ' active' : '') + (nested ? ' nested' : '') + '" ' +
          'data-route="' + it.route + '" data-label="' + esc(it.full || it.label) + '" ' +
          'title="' + esc(it.full || it.label) + '" role="button" tabindex="0">' +
          '<span class="nav-icon">' + icon('hexagon', 18) + '</span>' +
          '<span class="nav-icon-solo">' + icon(it.icon || item.icon, 20) + '</span>' +
          '<span class="nav-label">' + esc(it.label) + '</span></div>';
      }
      if (!item.children) { html += row(item, isActiveSection, false); return; }
      var expanded = S.expanded[item.id];
      html += '<div class="nav-group ' + (expanded ? 'expanded' : '') + '">' +
        '<div class="nav-item' + (isActiveSection && !cfg.activeChild ? ' active' : '') + '" data-route="' + item.route + '" ' +
        'data-label="' + esc(item.label) + '" title="' + esc(item.label) + '" role="button" tabindex="0">' +
        '<span class="nav-icon">' + icon('hexagon', 18) + '</span>' +
        '<span class="nav-icon-solo">' + icon(item.icon, 20) + '</span>' +
        '<span class="nav-label">' + esc(item.label) + '</span>' +
        '<span class="nav-chevron" data-action="toggle-section" data-section="' + item.id + '" aria-label="Toggle ' + esc(item.label) + '">' +
        icon('chevron-right', 15) + '</span></div>' +
        '<div class="nav-children">' +
        item.children.map(function (ch) {
          return row(ch, isActiveSection && cfg.activeChild === ch.id, true);
        }).join('') +
        '</div></div>';
    });
    html += '</div>';

    html += '<div class="nav-user">' +
      (S.navUserMenu
        ? '<div class="nav-user-menu">' +
        '<div class="ncm-label">Signed in as</div>' +
        '<div class="ncm-row strong">' + esc(cfg.user) + '</div>' +
        '<div class="ncm-row"><span class="ncm-meta">' + esc(cfg.userNote) + '</span></div>' +
        '<div class="rail-menu-sep"></div>' +
        '<button data-route="' + cfg.holidayRoute + '">' + icon('calendar-days', 16) + 'Holiday calendar</button>' +
        '</div>'
        : '') +
      '<button class="nav-user-row" data-action="nav-user" aria-label="Account" aria-expanded="' + (S.navUserMenu ? 'true' : 'false') + '">' +
      '<span class="nav-avatar">' + esc(cfg.user.charAt(0).toUpperCase()) + '</span>' +
      '<span class="nav-user-mail">' + esc(cfg.user) + '</span>' +
      icon('chevron-down', 15) + '</button></div>';

    el('sidebar').innerHTML = html;
    if (window.lucide) lucide.createIcons();
  }

  /* ======================================================================== *
     ROUTER
     ======================================================================== */
  function setActive(section, child) { S.active = { section: section, child: child || null }; }

  function route() {
    destroyCharts();
    var raw = location.hash.replace(/^#\/?/, '');
    // parse ?query params (used by clickable ops counts) into S.query
    var qi = raw.indexOf('?'); S.query = {};
    if (qi >= 0) { raw.substring(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); S.query[p[0]] = decodeURIComponent(p[1] || ''); }); raw = raw.substring(0, qi); }
    var seg = raw.split('/').filter(Boolean);
    if (seg[0] !== 'dashboard') { location.hash = '#/dashboard/bank/home'; return; }
    S.portal = (seg[1] === 'ops') ? 'ops' : 'bank';
    // Both portals are fully fluid and both render design language v2: the
    // Part 2.2 tokens, the three-panel shell and every component treatment are
    // declared under `.dl2`, which the router stamps on the shell whatever the
    // route. `.dl2-scope` does the same for the two mounts that live outside
    // .app — without it a toast or a side panel would fall back to the v1
    // palette at the top of styles.css.
    var isOps = S.portal === 'ops';
    var appEl = el('app'); if (appEl) appEl.classList.add('dl2');
    var om = el('overlay-mount'); if (om) om.className = 'dl2-scope';
    var tw = el('toasts'); if (tw) tw.className = 'toast-wrap dl2-scope';

    // No dark top bar (Part 2.1): the portal switcher lives in the rail and
    // search sits at the top of the content area. Same shell on both portals.
    el('topbar').innerHTML = '';
    renderRail(); renderSearchRow();

    if (isOps) return routeOps(seg.slice(2));

    var rest = seg.slice(2); // after dashboard/bank
    var head = rest[0] || 'home';

    if (head === 'home' || rest.length === 0) { setActive('home'); renderSidebar(); return viewHome(); }

    if (head === 'merchants') {
      if (rest[1] === 'add') { setActive('merchants', 'merchants-list'); renderSidebar(); return viewAddMerchant(); }
      if (rest[1] === 'performance') { setActive('merchants', 'merchants-performance'); renderSidebar(); return rest[2] ? viewPerfSingle(rest[2]) : viewPerfPortfolio(); }
      if (rest[1] === 'fee-configs') {
        setActive('merchants', 'merchants-fee-configs'); renderSidebar();
        if (rest[2] === 'propose') { S.tabs.feeConfigs = 'propose'; S.proposeMid = rest[3] || S.proposeMid; }
        else if (rest[2] === 'pending') { S.tabs.feeConfigs = 'pending'; }
        return viewFeeConfigs();
      }
      if (rest[1]) { setActive('merchants', 'merchants-list'); renderSidebar(); return viewMerchantProfile(rest[1]); }
      setActive('merchants', 'merchants-list'); renderSidebar(); return viewMerchants();
    }

    if (head === 'reconciliation') {
      if (rest[1] === 'fee-breakdown') { setActive('reconciliation', 'recon-fee-breakdown'); renderSidebar(); return viewFeeBreakdown(); }
      if (rest[1] === 'cycles') { setActive('reconciliation', 'recon-cycles'); renderSidebar(); return rest[2] ? viewCycleDetail(rest[2]) : viewCyclesList(); }
      setActive('reconciliation', 'recon-home'); renderSidebar(); return viewReconHome();
    }

    if (head === 'disputes') { setActive('disputes'); renderSidebar(); return rest[1] ? viewDisputeDetail(rest[1]) : viewDisputes(); }
    if (head === 'reports') { setActive('reports'); renderSidebar(); return rest[1] === 'holidays' ? viewHolidays() : viewReports(); }
    if (head === 'users') { setActive('users'); renderSidebar(); return viewUsers(); }

    location.hash = '#/dashboard/bank/home';
  }
  function go(r) { location.hash = r; }

  /* ======================================================================== *
     5.1 HOME
     ======================================================================== */
  function viewHome() {
    var k = D.kpis;
    var openDisputes = D.disputes.filter(function (d) { return d.status !== 'Won' && d.status !== 'Lost'; }).length;
    var need = D.disputes.filter(function (d) { return d.status === 'Action Required' && d.deadlineDays <= 2; }).length;
    var kpiCards = [
      { label: 'Active Merchants', value: num(k.activeMerchants), delta: 4.2, spark: D.merchants.map(function (m) { return m.mtdVolume; }).slice(0, 12) },
      { label: 'MTD Volume', value: fmtCr(k.mtdVolume), delta: 8.6, spark: D.portfolioDaily(14).map(function (p) { return p.value; }) },
      { label: 'MTD Transactions', value: num(k.mtdTxns), delta: 5.1, spark: D.portfolioDaily(14).map(function (p) { return p.value * 0.9; }) },
      { label: 'MTD Chargeback Ratio', value: pct(k.mtdChargebackRatio), delta: -0.03, spark: D.portfolioDaily(14).map(function (p, i) { return 100 - (i % 5); }), invert: true }
    ];
    var kpiHtml = kpiCards.map(function (c) {
      return '<div class="kpi-card"><div class="kpi-label">' + c.label + '</div>' +
        '<div class="kpi-value">' + c.value + '</div>' +
        '<div class="kpi-foot">' + delta(c.delta, c.invert) + spark(c.spark, 90, 30, c.invert ? '#22C55E' : '#2563EB') + '</div></div>';
    }).join('');

    var na = [
      { ic: 'clock', kind: 'warning', title: '2 fee config changes pending Juspay approval', route: '#/dashboard/bank/merchants/fee-configs/pending' },
      { ic: 'user-plus', kind: 'info', title: '1 merchant awaiting onboarding review', route: '#/dashboard/bank/merchants' },
      { ic: 'alert-triangle', kind: 'danger', title: '3 disputes approaching deadline in next 48h', route: '#/dashboard/bank/disputes' }
    ].map(function (n) {
      return '<div class="needs-attention-item" data-route="' + n.route + '" style="cursor:pointer">' +
        '<div class="na-icon" style="background:var(--status-' + n.kind + '-bg);color:var(--status-' + n.kind + '-fg)">' + icon(n.ic, 19) + '</div>' +
        '<div class="na-body"><div class="na-title">' + n.title + '</div></div>' + icon('chevron-right', 16) + '</div>';
    }).join('');

    var upcoming = upcomingHolidays(4).map(holidayRow).join('');

    var recent = [
      { ic: 'store', name: 'Croma - Phoenix Marketcity', ts: '12 min ago', route: '#/dashboard/bank/merchants/m01' },
      { ic: 'calendar', name: 'Cycle Detail · 20 Nov 2025', ts: '38 min ago', route: '#/dashboard/bank/reconciliation/cycles/cyc-2025-11-20' },
      { ic: 'file-text', name: 'Merchant Fee Report · Oct 2025', ts: '2 hours ago', route: '#/dashboard/bank/reports' },
      { ic: 'alert-circle', name: 'Dispute DSP-20250', ts: 'Yesterday', route: '#/dashboard/bank/disputes/DSP-20250' }
    ].map(function (r) {
      return '<div class="recent-card" data-route="' + r.route + '"><div class="rc-icon">' + icon(r.ic, 20) + '</div>' +
        '<div><div class="strong">' + r.name + '</div><div class="meta">' + r.ts + '</div></div></div>';
    }).join('');

    setView(
      '<div class="page-head"><div>' +
      '<div class="greeting"><h1 class="page-title">Good morning, ' + D.user.name + '</h1></div>' +
      '<div class="subtitle">' + U.prettyLong(D.TODAY) + '</div></div></div>' +

      '<div class="status-strip">' +
      pill('API · All Good', 'success', 'check-circle') +
      pill('Clearing · All Good', 'success', 'check-circle') +
      pill('Settlement · All Good', 'success', 'check-circle') +
      '<span data-route="#/dashboard/bank/disputes" class="clickable">' + pill('Disputes · ' + need + ' need action', 'warning', 'alert-circle') + '</span>' +
      '</div>' +

      // .kpi-row, not .grid-4: the shell is 82px wider than the old one, and a
      // hard four-up row leaves a KPI value too narrow to print at 1280. The
      // auto-fit row drops to three across on its own instead of clipping.
      '<div class="kpi-row mb-16">' + kpiHtml + '</div>' +

      '<div class="grid" style="grid-template-columns:2fr 1fr;margin-top:6px">' +
      cardBox('Needs attention', na) +
      cardBox('Upcoming bank holidays', upcoming + '<div class="mt-16"><a class="btn-ghost" data-route="#/dashboard/bank/reports/holidays">View full calendar ' + icon('arrow-right', 14) + '</a></div>') +
      '</div>' +

      '<div class="mt-24"><div class="section-title mb-16">Recently viewed</div><div class="grid grid-4">' + recent + '</div></div>'
    );
  }

  function upcomingHolidays(n) {
    return D.holidays.filter(function (h) { return h.date >= D.TODAY; }).slice(0, n);
  }
  function holidayRow(h) {
    var d = U.fromYmd(h.date);
    var kind = h.impact === 'Full holiday' ? 'danger' : (h.impact === 'Half day' ? 'warning' : 'neutral');
    return '<div class="holiday-item"><div style="display:flex;gap:12px;align-items:center">' +
      '<div class="holiday-date"><span class="hd-day">' + d.getUTCDate() + '</span><span class="hd-mon">' + U.MON[d.getUTCMonth()] + '</span></div>' +
      '<div><div class="strong">' + h.name + '</div><div class="meta">' + U.DOW[d.getUTCDay()] + '</div></div></div>' +
      pill(h.impact, kind) + '</div>';
  }

  /* ======================================================================== *
     5.2 MERCHANTS LIST  (+ loading + empty state patterns)
     ======================================================================== */
  function viewMerchants() {
    // demonstrate loading skeleton on first entry
    if (!S.loading.merchants) {
      S.loading.merchants = true;
      setView(merchantsHead() + '<div class="table-wrap" style="padding:16px">' + skeletonRows(8) + '</div>');
      setTimeout(function () { if (S.active.child === 'merchants-list') renderMerchantsTable(); }, 350);
      return;
    }
    renderMerchantsTable();
  }
  function merchantsHead() {
    var f = S.filters.merchants;
    var mccOpts = ['<option value="all">MCC ▾</option>'].concat(Object.keys(D.MCC).map(function (c) {
      return '<option value="' + c + '"' + (f.mcc === c ? ' selected' : '') + '>' + c + ' · ' + D.MCC[c] + '</option>';
    })).join('');
    return '<div class="page-head"><div><h1 class="page-title">Merchants</h1>' +
      '<div class="subtitle">HSBC IN · ' + D.merchants.length + ' merchants in portfolio</div></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-action="toast" data-msg="Exporting merchant list as CSV…">' + icon('download', 16) + 'Export</button>' +
      '<button class="btn btn-primary" data-route="#/dashboard/bank/merchants/add">' + icon('plus', 16) + 'Add merchant</button></div></div>' +
      '<div class="filter-row">' +
      '<div class="chip"><span class="chip-label">All</span>' + icon('chevron-down', 15) + '</div>' +
      '<div class="chip search-chip">' + icon('search', 15) + '<input class="input" data-action="filter-merchants" placeholder="Search merchants" value="' + esc(f.q) + '" /></div>' +
      '<select class="input" style="width:auto" data-action="filter-merchant-status"><option value="all">Status ▾</option>' +
      ['Active', 'Under Review', 'Suspended'].map(function (s) { return '<option ' + (f.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<select class="input" style="width:auto" data-action="filter-merchant-mcc">' + mccOpts + '</select>' +
      '<div class="chip">' + icon('calendar', 15) + '<span class="chip-value">Last 30 days</span>' + icon('chevron-down', 15) + '</div>' +
      '</div>';
  }
  function filteredMerchants() {
    var f = S.filters.merchants;
    return D.merchants.filter(function (m) {
      if (f.q && m.name.toLowerCase().indexOf(f.q.toLowerCase()) < 0 && m.midRaw.indexOf(f.q) < 0) return false;
      if (f.status !== 'all' && m.status !== f.status) return false;
      if (f.mcc !== 'all' && m.mcc !== f.mcc) return false;
      return true;
    });
  }
  function renderMerchantsTable() {
    var list = filteredMerchants();
    var body;
    if (!list.length) {
      body = '<div class="card">' + emptyState('search-x', 'No merchants match your filters', 'Try adjusting the search term, status or MCC filter.',
        '<button class="btn btn-secondary" data-action="clear-merchant-filters">Clear filters</button>') + '</div>';
    } else {
      var rows = list.map(function (m) {
        var st = m.status === 'Active' ? 'success' : (m.status === 'Under Review' ? 'warning' : 'neutral');
        return '<tr class="clickable" data-route="#/dashboard/bank/merchants/' + m.id + '">' +
          '<td><div class="cell-main">' + esc(m.name) + '</div><div class="cell-sub">MID ' + m.mid + '</div></td>' +
          '<td>' + m.mcc + ' · ' + m.mccLabel + '</td>' +
          '<td>' + pill(m.status, st) + '</td>' +
          '<td>' + (m.parent ? esc(m.parent) : '—') + '</td>' +
          '<td>' + U.prettyDate(m.onboarded) + '</td>' +
          '<td class="num">' + fmtCr(m.mtdVolume) + '</td>' +
          '<td class="num">' + num(m.mtdTxns) + '</td>' +
          '<td class="num" style="' + (m.watchlist ? 'color:var(--status-warning-fg);font-weight:600' : '') + '">' + pct(m.chargebackPct) + '</td>' +
          '</tr>';
      }).join('');
      body = '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Merchant</th><th>MCC</th><th>Status</th><th>Parent</th><th>Onboarded</th>' +
        '<th class="num">MTD Volume</th><th class="num">MTD Txns</th><th class="num">Chargeback %</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div class="table-foot"><span>Showing ' + list.length + ' of ' + D.merchants.length + ' merchants</span>' +
        '<div class="pagination"><button>Prev</button><button class="active">1</button><button>2</button><button>Next</button></div></div></div>';
    }
    setView(merchantsHead() + body);
  }

  /* ======================================================================== *
     5.3 ADD NEW MERCHANT (multi-step)
     ======================================================================== */
  var ADD_STEPS = ['Legal Entity', 'Business Details', 'Hierarchy', 'Networks & Terminals', 'Settlement Account', 'KYC / KYB Docs', 'Initial Fee Config', 'Review & Submit'];
  function viewAddMerchant() {
    var step = S.addStep;
    var stepsHtml = ADD_STEPS.map(function (s, i) {
      var cls = (i + 1 === step) ? 'active' : (i + 1 < step ? 'done' : '');
      return '<div class="step ' + cls + '"><div class="step-line"></div><div class="step-num">' + (i + 1 < step ? '✓' : (i + 1)) + '</div><div class="step-label">' + s + '</div></div>';
    }).join('');
    var body = addStepBody(step);
    var nav = '<div class="row" style="justify-content:space-between;margin-top:24px">' +
      (step > 1 ? '<button class="btn btn-secondary" data-action="add-prev">' + icon('arrow-left', 16) + 'Back</button>' : '<span></span>') +
      (step < 8 ? '<button class="btn btn-primary" data-action="add-next">Continue' + icon('arrow-right', 16) + '</button>'
        : '<button class="btn btn-primary" data-action="add-submit">' + icon('check', 16) + 'Submit for review</button>') + '</div>';
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/merchants">Merchants</a><span class="sep">/</span><span>Add merchant</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">Add new merchant</h1><div class="subtitle">Step ' + step + ' of 8 · onboarding into HSBC IN</div></div></div>' +
      '<div class="steps">' + stepsHtml + '</div>' +
      '<div class="card">' + body + nav + '</div>'
    );
  }
  function field(label, input, req) { return '<label class="field">' + label + (req ? ' <span class="req">*</span>' : '') + input + '</label>'; }
  function addStepBody(step) {
    if (step === 1) return '<div class="grid grid-2">' +
      field('Legal name', '<input class="input" placeholder="e.g. Acme Retail Pvt Ltd" />', true) +
      field('Entity type', '<select class="input"><option>Private Limited</option><option>Public Limited</option><option>LLP</option><option>Partnership</option></select>', true) +
      field('Tax ID (GSTIN / PAN)', '<input class="input" placeholder="GSTIN27XXXXXXXXXXZ0" />', true) +
      field('Registered address', '<input class="input" placeholder="Street, City, State, PIN" />', true) + '</div>';
    if (step === 2) return '<div class="grid grid-2">' +
      field('Trading name', '<input class="input" placeholder="Brand / DBA name" />', true) +
      field('Primary MCC', '<select class="input">' + Object.keys(D.MCC).map(function (c) { return '<option value="' + c + '">' + c + ' · ' + D.MCC[c] + '</option>'; }).join('') + '</select>', true) +
      field('Secondary MCCs', '<input class="input" placeholder="Comma-separated" />') +
      field('Website', '<input class="input" placeholder="https://" />') + '</div>';
    if (step === 3) return '<div class="stack">' +
      field('Hierarchy type', '<select class="input"><option>Standalone merchant</option><option>Parent (has child outlets)</option><option>Child under existing parent</option></select>', true) +
      field('Parent merchant (if child)', '<select class="input"><option>— none —</option>' + D.merchants.slice(0, 8).map(function (m) { return '<option>' + esc(m.name) + '</option>'; }).join('') + '</select>') + '</div>';
    if (step === 4) return '<div class="stack">' +
      '<div class="field">Enabled networks <span class="req">*</span>' +
      '<div class="row" style="gap:20px;margin-top:8px">' +
      ['Visa', 'Mastercard', 'RuPay', 'HSBC ONUS'].map(function (n) { return '<label style="display:flex;gap:8px;align-items:center;font-weight:500;color:var(--text-primary)"><input type="checkbox" checked /> ' + n + '</label>'; }).join('') + '</div></div>' +
      field('Terminal count', '<input class="input" type="number" value="4" style="max-width:160px" />', true) + '</div>';
    if (step === 5) return '<div class="grid grid-2">' +
      field('Settlement bank', '<input class="input" value="HSBC India" />', true) +
      field('Account number', '<input class="input" placeholder="Account number" />', true) +
      field('IFSC', '<input class="input" placeholder="HSBC0400001" />', true) +
      field('Account type', '<select class="input"><option>Current</option><option>Nostro</option></select>') + '</div>';
    if (step === 6) return '<div class="stack">' +
      '<div class="upload-zone" data-action="add-file">' + icon('upload-cloud', 28) + '<div class="strong">Drag & drop KYC / KYB documents</div><div class="meta">Certificate of Incorporation, GST certificate, PAN, board resolution — any file accepted (mockup)</div></div>' +
      '<div id="addFileList">' + (S.addFiles.length ? S.addFiles.map(function (f) { return '<div class="file-list-item">' + icon('file', 15) + f + pill('uploaded', 'success') + '</div>'; }).join('') : '<div class="meta">No documents added yet.</div>') + '</div></div>';
    if (step === 7) {
      // reuse fee-config editor pattern
      var sample = D.feeConfigs['m01'].slice(0, 4);
      return '<div class="stack"><div class="meta">Set the initial MDR rules for this merchant. This reuses the fee config editor (see Fee Configs → Propose).</div>' +
        feeRulesTable(sample, true) + '</div>';
    }
    // step 8 review
    return '<div class="stack">' +
      '<div class="callout info">' + icon('info', 20) + '<div class="callout-body">Review the details below. On submit the merchant is created in <strong>Under Review</strong> status and enters the Juspay onboarding queue.</div></div>' +
      '<dl class="def-list"><dt>Legal name</dt><dd>Acme Retail Pvt Ltd</dd><dt>Trading name</dt><dd>Acme</dd><dt>Primary MCC</dt><dd>5411 · Grocery Stores</dd><dt>Hierarchy</dt><dd>Standalone merchant</dd><dt>Networks</dt><dd>Visa, Mastercard, RuPay, HSBC ONUS</dd><dt>Terminals</dt><dd>4</dd><dt>Settlement account</dt><dd>HSBC India · ****new</dd><dt>Documents</dt><dd>' + (S.addFiles.length || 0) + ' uploaded</dd></dl>';
  }

  /* ======================================================================== *
     5.4 MERCHANT PROFILE (tabbed)
     ======================================================================== */
  function viewMerchantProfile(mid) {
    var m = D.merchantById[mid];
    if (!m) { setView('<div class="card">' + emptyState('search-x', 'Merchant not found', 'This merchant does not exist in HSBC IN.', '<button class="btn btn-secondary" data-route="#/dashboard/bank/merchants">Back to merchants</button>') + '</div>'); return; }
    var tab = S.tabs.profile;
    var tabs = ['overview', 'hierarchy', 'networks', 'fees', 'activity', 'history'];
    var labels = { overview: 'Overview', hierarchy: 'Hierarchy', networks: 'Networks & Terminals', fees: 'Fee Configuration', activity: 'Recent Activity', history: 'Change History' };
    var st = m.status === 'Active' ? 'success' : (m.status === 'Under Review' ? 'warning' : 'neutral');
    var tabBar = '<div class="tabs">' + tabs.map(function (t) {
      return '<button class="tab ' + (tab === t ? 'active' : '') + '" data-action="tab" data-tab-group="profile" data-tab="' + t + '">' + labels[t] + '</button>';
    }).join('') + '</div>';

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/merchants">Merchants</a><span class="sep">/</span><span>' + esc(m.name) + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">' + esc(m.name) + '</h1>' +
      '<div class="subtitle">MID ' + m.mid + ' · ' + m.mcc + ' · ' + m.mccLabel + ' &nbsp; ' + pill(m.status, st) + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-route="#/dashboard/bank/merchants/performance/' + m.id + '">' + icon('bar-chart-2', 16) + 'View performance</button>' +
      '<button class="btn btn-primary" data-route="#/dashboard/bank/merchants/fee-configs/propose/' + m.id + '">' + icon('percent', 16) + 'Propose fee change</button></div></div>' +
      tabBar + '<div id="profileTab">' + profileTab(m, tab) + '</div>'
    );
    if (tab === 'activity') buildActivityCharts(m);
  }
  function profileTab(m, tab) {
    if (tab === 'overview') return '<div class="grid grid-2"><div class="card"><div class="card-title mb-16">Merchant details</div>' +
      '<dl class="def-list"><dt>Legal entity</dt><dd>' + esc(m.legalName) + '</dd><dt>Entity type</dt><dd>' + m.entityType + '</dd>' +
      '<dt>Tax ID</dt><dd>' + m.taxId + '</dd><dt>MCC</dt><dd>' + m.mcc + ' · ' + m.mccLabel + '</dd>' +
      '<dt>Onboarded</dt><dd>' + U.prettyDate(m.onboarded) + '</dd><dt>Registered address</dt><dd>' + esc(m.address) + '</dd></dl></div>' +
      '<div class="card"><div class="card-title mb-16">Contact & settlement</div>' +
      '<dl class="def-list"><dt>Primary contact</dt><dd>' + m.contact + '</dd><dt>Email</dt><dd>' + esc(m.contactEmail) + '</dd>' +
      '<dt>Settlement bank</dt><dd>' + m.settleBank + '</dd><dt>Account (masked)</dt><dd>' + m.settleAcct + '</dd><dt>IFSC</dt><dd>' + m.ifsc + '</dd>' +
      '<dt>Parent</dt><dd>' + (m.parent || '— standalone —') + '</dd></dl></div></div>';

    if (tab === 'hierarchy') {
      var children = D.merchants.filter(function (x) { return x.parent === (m.parent || m.name); });
      var parentName = m.parent || m.name;
      var siblings = m.parent ? D.merchants.filter(function (x) { return x.parent === m.parent; }) : [m];
      return '<div class="card"><div class="card-title mb-16">Ownership hierarchy</div>' +
        '<div class="tree-item" style="font-weight:600">' + icon('git-branch', 16) + esc(parentName) + (m.parent ? ' <span class="meta">(holding group)</span>' : ' <span class="meta">(this merchant)</span>') + '</div>' +
        '<div class="tree-children">' + siblings.map(function (s) {
          return '<div class="tree-item ' + (s.id === m.id ? '' : '') + '" ' + (s.id !== m.id ? 'data-route="#/dashboard/bank/merchants/' + s.id + '" style="cursor:pointer"' : 'style="border-color:var(--primary)"') + '>' + icon('store', 16) + esc(s.name) + (s.id === m.id ? ' ' + pill('current', 'primary') : '') + ' <span class="meta">MID ' + s.mid + '</span></div>';
        }).join('') + '</div></div>';
    }

    if (tab === 'networks') return '<div class="card"><div class="card-title mb-16">Enabled networks & terminals</div>' +
      '<div class="grid grid-4">' + D.NETWORKS.map(function (net) {
        var on = m.networks.indexOf(net.key) >= 0;
        return '<div class="card pad-sm" style="border-top:3px solid ' + net.color + '"><div class="strong">' + net.name + '</div>' +
          '<div class="mt-16">' + (on ? pill('Enabled', 'success', 'check') : pill('Not enabled', 'neutral')) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="def-list mt-24"><dt>Terminal count</dt><dd>' + m.terminals + ' POS / VPA terminals</dd><dt>Restrictions</dt><dd>' + (m.watchlist ? 'Chargeback watchlist — enhanced monitoring' : 'None') + '</dd></div></div>';

    if (tab === 'fees') return '<div class="stack">' +
      '<div class="card"><div class="card-head"><div class="card-title">Active MDR rules (read-only)</div>' +
      '<button class="btn btn-primary btn-sm" data-route="#/dashboard/bank/merchants/fee-configs/propose/' + m.id + '">' + icon('edit-3', 15) + 'Propose fee change</button></div>' +
      feeRulesTable(D.feeConfigs[m.id], false) + '</div>' +
      '<div class="card"><div class="card-title mb-16">Fee change history</div><div class="meta mb-16">Every fee change is appended, never overwritten. Nullified entries remain visible with their correcting entry directly below.</div>' +
      immutableTimeline(feeHistoryFor(m)) + '</div></div>';

    if (tab === 'activity') return '<div class="card"><div class="card-title mb-16">Last 30 days</div>' +
      '<div class="grid grid-4">' +
      '<div><div class="meta">Volume</div><div style="height:90px;position:relative"><canvas id="pa-vol"></canvas></div></div>' +
      '<div><div class="meta">Transactions</div><div style="height:90px;position:relative"><canvas id="pa-txn"></canvas></div></div>' +
      '<div><div class="meta">Approval rate</div><div style="height:90px;position:relative"><canvas id="pa-appr"></canvas></div></div>' +
      '<div><div class="meta">Chargebacks</div><div style="height:90px;position:relative"><canvas id="pa-cb"></canvas></div></div>' +
      '</div></div>';

    // history
    return '<div class="card"><div class="card-title mb-16">Change history</div>' +
      '<div class="meta mb-16">Immutable audit trail — profile edits, fee changes and status changes are appended in order. Corrections nullify the prior entry without deleting it.</div>' +
      immutableTimeline(D.changeHistory[m.id]) + '</div>';
  }
  function feeRulesTable(rules, editable) {
    var rows = rules.map(function (r, i) {
      return '<tr><td>' + r.network + '</td><td>' + r.cardType + '</td><td>' + r.region + '</td><td>' + r.txnType + '</td><td>' + r.mccBucket + '</td>' +
        '<td class="num">' + (editable ? '<input class="input" style="width:78px;text-align:right" value="' + r.pct.toFixed(2) + '" />' : r.pct.toFixed(2) + '%') + '</td>' +
        '<td class="num">' + fmtT(r.fixed) + '</td><td class="num">' + (r.cap ? fmt(r.cap) : '—') + '</td><td>' + U.prettyDate(r.effectiveSince) + '</td>' +
        (editable ? '<td><button class="icon-btn" data-action="noop" aria-label="Remove rule">' + icon('trash-2', 15) + '</button></td>' : '') + '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Network</th><th>Card Type</th><th>Region</th><th>Txn Type</th><th>MCC Bucket</th><th class="num">MDR %</th><th class="num">Fixed Fee</th><th class="num">Cap</th><th>Effective Since</th>' + (editable ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function buildActivityCharts(m) {
    function line(id, series, color, isPct) {
      chart(id, {
        type: 'line',
        data: { labels: series.map(function () { return ''; }), datasets: [{ data: series.map(function (p) { return p.value; }), borderColor: color, backgroundColor: color + '1A', borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, maintainAspectRatio: false }
      });
    }
    line('pa-vol', D.merchantDaily(m.id, 30, 'vol'), '#2563EB');
    line('pa-txn', D.merchantDaily(m.id, 30, 'txns'), '#8B5CF6');
    line('pa-appr', D.merchantDaily(m.id, 30, 'approval'), '#22C55E', true);
    line('pa-cb', D.merchantDaily(m.id, 30, 'chargeback'), '#EF4444', true);
  }

  /* ======================================================================== *
     5.5 MERCHANT PERFORMANCE
     ======================================================================== */
  function rangeSelector() {
    var r = S.filters.perfRange;
    return '<div class="chip" style="padding:2px;gap:2px">' + ['7d', '30d', 'MTD', 'Custom'].map(function (x) {
      return '<button class="btn btn-sm ' + (r === x ? 'btn-primary' : 'btn-ghost') + '" data-action="perf-range" data-range="' + x + '">' + x + '</button>';
    }).join('') + '</div>';
  }
  function viewPerfPortfolio() {
    var mtdVol = D.kpis.mtdVolume, mtdTxn = D.kpis.mtdTxns;
    var kpis = [
      ['Total Volume', fmtCr(mtdVol), 8.6, false],
      ['Total Transactions', num(mtdTxn), 5.1, false],
      ['Avg Ticket Size', fmt(Math.round(mtdVol / mtdTxn)), 2.3, false],
      ['Approval Rate', pct(97.42), 0.4, false],
      ['Refund Rate', pct(1.85), -0.2, true],
      ['Chargeback Ratio', pct(D.kpis.mtdChargebackRatio), -0.03, true]
    ];
    var kpiHtml = kpis.map(function (k) {
      return '<div class="kpi-card"><div class="kpi-label">' + k[0] + '</div><div class="kpi-value" style="font-size:26px">' + k[1] + '</div><div class="kpi-foot">' + delta(k[2], k[3]) + '</div></div>';
    }).join('');
    var league = D.merchants.slice().sort(function (a, b) { return b.mtdVolume - a.mtdVolume; }).map(function (m, i) {
      return '<tr class="clickable" data-route="#/dashboard/bank/merchants/performance/' + m.id + '">' +
        '<td class="num">' + (i + 1) + '</td><td class="cell-main">' + esc(m.name) + '</td><td>' + m.mcc + '</td>' +
        '<td class="num">' + fmtCr(m.mtdVolume) + '</td><td class="num">' + num(m.mtdTxns) + '</td>' +
        '<td class="num">' + pct(96 + (m.id.charCodeAt(2) % 4)) + '</td>' +
        '<td class="num" style="' + (m.chargebackPct > 1 ? 'color:var(--status-warning-fg);font-weight:600' : '') + '">' + pct(m.chargebackPct) + '</td>' +
        '<td class="num">' + (m.momGrowth >= 0 ? '+' : '') + m.momGrowth.toFixed(1) + '%</td></tr>';
    }).join('');

    setView(
      '<div class="page-head"><div><h1 class="page-title">Merchant Performance</h1><div class="subtitle">Portfolio view · HSBC IN</div></div>' +
      '<div class="head-actions">' + rangeSelector() + '</div></div>' +
      '<div class="grid grid-3 mb-16">' + kpiHtml + '</div>' +
      '<div class="grid grid-2" style="margin:6px 0 18px">' +
      cardBox('Daily volume trend', '<div style="height:260px;position:relative"><canvas id="perf-line"></canvas></div>') +
      cardBox('Volume distribution by MCC', '<div style="position:relative;height:220px"><canvas id="perf-donut"></canvas></div>') +
      '</div>' +
      cardBox('Merchant league table', '<div class="table-wrap"><table class="data"><thead><tr><th class="num">Rank</th><th>Merchant</th><th>MCC</th><th class="num">Volume</th><th class="num">Transactions</th><th class="num">Approval %</th><th class="num">Chargeback %</th><th class="num">MoM Growth %</th></tr></thead><tbody>' + league + '</tbody></table></div>')
    );
    buildPerfPortfolioCharts();
  }
  function buildPerfPortfolioCharts() {
    var series = D.portfolioDaily(30);
    chart('perf-line', {
      type: 'line',
      data: { labels: series.map(function (p) { return U.prettyDate(p.date).replace(' 2025', ''); }), datasets: [{ label: 'Gross Volume', data: series.map(function (p) { return p.value; }), borderColor: '#2563EB', backgroundColor: '#2563EB1A', borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: GRID }, ticks: { callback: function (v) { return '₹' + (v / 10000000).toFixed(1) + 'Cr'; } } } }, maintainAspectRatio: false }
    });
    // top 5 MCC by volume
    var byMcc = {};
    D.merchants.forEach(function (m) { byMcc[m.mccLabel] = (byMcc[m.mccLabel] || 0) + m.mtdVolume; });
    var sorted = Object.keys(byMcc).map(function (k) { return [k, byMcc[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var top = sorted.slice(0, 5), other = sorted.slice(5).reduce(function (a, x) { return a + x[1]; }, 0);
    var labels = top.map(function (x) { return x[0]; }).concat(other ? ['Other'] : []);
    var data = top.map(function (x) { return x[1]; }).concat(other ? [other] : []);
    chart('perf-donut', {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: ['#2563EB', '#EAB308', '#22C55E', '#8B5CF6', '#64748B', '#CBD5E1'], borderWidth: 0 }] },
      options: { cutout: '66%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } } }, maintainAspectRatio: false }
    });
  }
  function viewPerfSingle(mid) {
    var m = D.merchantById[mid];
    if (!m) { go('#/dashboard/bank/merchants/performance'); return; }
    var st = m.status === 'Active' ? 'success' : 'warning';
    var kpis = [
      ['Total Volume', fmtCr(m.mtdVolume), 6.2, false],
      ['Total Transactions', num(m.mtdTxns), 4.0, false],
      ['Avg Ticket', fmt(m.avgTicket), 1.1, false],
      ['Approval Rate', pct(96 + (m.id.charCodeAt(2) % 4)), 0.3, false],
      ['Refund Rate', pct(1.4), -0.1, true],
      ['Chargeback Ratio', pct(m.chargebackPct), -0.02, true]
    ].map(function (k) { return '<div class="kpi-card"><div class="kpi-label">' + k[0] + '</div><div class="kpi-value" style="font-size:24px">' + k[1] + '</div><div class="kpi-foot">' + delta(k[2], k[3]) + '</div></div>'; }).join('');
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/merchants/performance">Merchant Performance</a><span class="sep">/</span><span>' + esc(m.name) + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">' + esc(m.name) + '</h1><div class="subtitle">MID ' + m.mid + ' · ' + m.mccLabel + ' &nbsp;' + pill(m.status, st) + '</div></div><div class="head-actions">' + rangeSelector() + '</div></div>' +
      '<div class="grid grid-3 mb-16">' + kpis + '</div>' +
      '<div class="grid grid-2" style="margin:6px 0 18px">' +
      cardBox('Volume over time', '<div style="height:200px;position:relative"><canvas id="sm-vol"></canvas></div>') +
      cardBox('Transactions over time', '<div style="height:200px;position:relative"><canvas id="sm-txn"></canvas></div>') +
      cardBox('Approval rate over time', '<div style="height:200px;position:relative"><canvas id="sm-appr"></canvas></div>') +
      cardBox('Chargeback ratio over time', '<div style="height:200px;position:relative"><canvas id="sm-cb"></canvas></div>') +
      '</div>' +
      '<div class="grid grid-3">' +
      cardBox('Network mix', '<div style="position:relative;height:190px"><canvas id="sm-net"></canvas></div>') +
      cardBox('Card type mix', '<div style="position:relative;height:190px"><canvas id="sm-card"></canvas></div>') +
      cardBox('Region mix', '<div style="height:190px;position:relative"><canvas id="sm-region"></canvas></div>') +
      '</div>' +
      '<div class="mt-24">' + cardBox('Recent activity', activityFeed(m)) + '</div>'
    );
    buildSingleCharts(m);
  }
  function activityFeed(m) {
    var out = '';
    for (var i = 0; i < 12; i++) {
      var d = U.addDays(D.TODAY, -i);
      out += '<div class="file-row"><div class="file-name">Settlement cleared · ' + U.prettyDate(d) + '</div><div class="file-meta num">' + fmtCr(Math.round(m.dailyVolume * (0.8 + (i % 5) * 0.06))) + ' · ' + num(Math.round(m.dailyVolume / m.avgTicket)) + ' txns</div></div>';
    }
    return out;
  }
  function buildSingleCharts(m) {
    function ln(id, metric, color) {
      var s = D.merchantDaily(m.id, 30, metric);
      chart(id, { type: 'line', data: { labels: s.map(function () { return ''; }), datasets: [{ data: s.map(function (p) { return p.value; }), borderColor: color, backgroundColor: color + '1A', borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: GRID } } }, maintainAspectRatio: false } });
    }
    ln('sm-vol', 'vol', '#2563EB'); ln('sm-txn', 'txns', '#8B5CF6'); ln('sm-appr', 'approval', '#22C55E'); ln('sm-cb', 'chargeback', '#EF4444');
    chart('sm-net', { type: 'doughnut', data: { labels: ['Visa', 'Mastercard', 'RuPay', 'HSBC ONUS'], datasets: [{ data: [40, 30, 22, 8], backgroundColor: ['#2563EB', '#EAB308', '#22C55E', '#8B5CF6'], borderWidth: 0 }] }, options: { cutout: '64%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false } });
    chart('sm-card', { type: 'doughnut', data: { labels: ['Credit', 'Debit', 'Prepaid'], datasets: [{ data: [58, 36, 6], backgroundColor: ['#2563EB', '#22C55E', '#94A3B8'], borderWidth: 0 }] }, options: { cutout: '64%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false } });
    chart('sm-region', { type: 'bar', data: { labels: ['Domestic', 'Intra-regional', 'Cross-border'], datasets: [{ data: [82, 11, 7], backgroundColor: ['#2563EB', '#8B5CF6', '#EAB308'], borderRadius: 4 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: GRID } } }, maintainAspectRatio: false } });
  }

  /* ======================================================================== *
     5.6 FEE CONFIGS (3 tabs, maker-checker)
     ======================================================================== */
  function viewFeeConfigs() {
    var tab = S.tabs.feeConfigs;
    var pendingCount = D.feeApprovals.filter(function (a) { return a.status === 'Under Review' || a.status === 'Submitted'; }).length;
    var tabBar = '<div class="tabs">' +
      '<button class="tab ' + (tab === 'current' ? 'active' : '') + '" data-action="tab" data-tab-group="feeConfigs" data-tab="current">Current Configs</button>' +
      '<button class="tab ' + (tab === 'propose' ? 'active' : '') + '" data-action="tab" data-tab-group="feeConfigs" data-tab="propose">Propose Fee Change</button>' +
      '<button class="tab ' + (tab === 'pending' ? 'active' : '') + '" data-action="tab" data-tab-group="feeConfigs" data-tab="pending">Pending Approvals<span class="count">' + pendingCount + '</span></button>' +
      '</div>';
    setView('<div class="page-head"><div><h1 class="page-title">Fee Configs</h1><div class="subtitle">Manage MDR rules and review the Juspay approval queue</div></div></div>' + tabBar + '<div id="fcTab">' + feeConfigsTab(tab) + '</div>');
  }
  function feeConfigsTab(tab) {
    if (tab === 'current') {
      var rows = [];
      D.merchants.forEach(function (m) {
        D.feeConfigs[m.id].forEach(function (r) {
          rows.push('<tr class="clickable" data-route="#/dashboard/bank/merchants/' + m.id + '"><td class="cell-main">' + esc(m.name) + '</td><td>' + r.network + '</td><td>' + r.cardType + '</td><td>' + r.region + '</td><td>' + r.txnType + '</td><td>' + r.mccBucket + '</td><td class="num">' + r.pct.toFixed(2) + '%</td><td class="num">' + fmtT(r.fixed) + '</td><td class="num">' + (r.cap ? fmt(r.cap) : '—') + '</td><td>' + U.prettyDate(r.effectiveSince) + '</td></tr>');
        });
      });
      return '<div class="filter-row"><div class="chip search-chip">' + icon('search', 15) + '<input class="input" placeholder="Filter by merchant" data-action="noop" /></div>' +
        '<div class="chip"><span class="chip-label">Network</span>' + icon('chevron-down', 15) + '</div><div class="chip"><span class="chip-label">Card type</span>' + icon('chevron-down', 15) + '</div></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Merchant</th><th>Network</th><th>Card Type</th><th>Region</th><th>Txn Type</th><th>MCC Bucket</th><th class="num">%</th><th class="num">Fixed Fee</th><th class="num">Cap</th><th>Effective Since</th></tr></thead><tbody>' + rows.slice(0, 60).join('') + '</tbody></table><div class="table-foot"><span>Showing 60 of ' + rows.length + ' active rules</span></div></div>';
    }
    if (tab === 'propose') return proposeFeeChange();
    return pendingApprovals();
  }
  function proposeFeeChange() {
    var mid = S.proposeMid || 'm01';
    var m = D.merchantById[mid];
    var current = D.feeConfigs[mid];
    var draft = current.map(function (r, i) { return i === 0 ? Object.assign({}, r, { pct: Math.round((r.pct + 0.15) * 100) / 100 }) : r; });
    var monthlyVol = m.mtdVolume;
    var impact = Math.round(monthlyVol * 0.0015);
    return '<div class="stack">' +
      '<div class="row" style="align-items:center;gap:14px"><div style="font-weight:500">Merchant:</div>' +
      '<select class="input" style="width:auto" data-action="propose-merchant">' + D.merchants.map(function (x) { return '<option value="' + x.id + '"' + (x.id === mid ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<div style="flex:1"></div><label class="field" style="flex-direction:row;align-items:center;gap:8px">Effective date <input class="input" type="date" value="2025-12-01" style="width:auto" /></label></div>' +

      '<div class="diff-grid">' +
      '<div class="diff-col current"><div class="diff-head">Current config</div>' + miniFeeTable(current, false) + '</div>' +
      '<div class="diff-arrow">' + icon('arrow-right', 20) + '</div>' +
      '<div class="diff-col draft"><div class="diff-head">Draft config (editable)</div>' + miniFeeTable(draft, true) + '</div>' +
      '</div>' +

      '<div class="impact-panel"><div class="ip-icon">' + icon('trending-up', 22) + '</div><div><div class="meta">Impact preview · based on last month\'s volume</div>' +
      '<div class="ip-value">+' + fmt(impact) + ' additional revenue <span style="font-size:14px">(+' + pct(2.4) + ')</span></div></div></div>' +

      field('Reason / comment (required, min 30 chars)', '<textarea class="input" id="proposeReason" placeholder="Explain the rationale for this fee change…"></textarea>', true) +

      '<div class="row" style="justify-content:flex-end;gap:10px"><button class="btn btn-secondary" data-action="fee-draft" data-mid="' + mid + '">Save as draft</button>' +
      '<button class="btn btn-primary" data-action="fee-submit" data-mid="' + mid + '">' + icon('send', 16) + 'Submit for approval</button></div></div>';
  }
  function miniFeeTable(rules, editable) {
    var rows = rules.slice(0, 5).map(function (r) {
      return '<tr><td>' + r.network + ' ' + r.cardType + '</td><td>' + r.region + '</td><td class="num">' + (editable ? '<input class="input" style="width:70px;text-align:right" value="' + r.pct.toFixed(2) + '"/>' : r.pct.toFixed(2) + '%') + '</td></tr>';
    }).join('');
    return '<table class="data" style="font-size:13.5px"><thead><tr><th>Rule</th><th>Region</th><th class="num">MDR %</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function pendingApprovals() {
    if (!D.feeApprovals.length) return '<div class="card">' + emptyState('inbox', 'No pending approvals', 'Fee changes you submit will appear here for Juspay review.') + '</div>';
    var rows = D.feeApprovals.map(function (a) {
      var kinds = { Draft: 'neutral', Submitted: 'info', 'Under Review': 'info', Approved: 'success', Rejected: 'danger' };
      var ic = { Draft: 'file', Submitted: 'send', 'Under Review': 'clock', Approved: 'check-circle', Rejected: 'x-circle' };
      var statusPill = pill(a.status, kinds[a.status], ic[a.status]);
      return '<tr class="clickable" data-action="toggle-approval" data-fc="' + a.id + '">' +
        '<td class="cell-main">' + esc(a.merchant) + '<div class="cell-sub">' + a.id + '</div></td>' +
        '<td>' + a.submittedBy + '</td><td>' + (a.submittedAt || '—') + '</td><td>' + U.prettyDate(a.effective) + '</td>' +
        '<td>' + statusPill + '</td>' +
        '<td>' + (a.rejectionReason ? '<span class="meta" style="color:var(--status-danger-fg)">' + esc(a.rejectionReason.slice(0, 46)) + '…</span>' : '—') + '</td>' +
        '<td>' + (a.status === 'Under Review' || a.status === 'Submitted' ? '<button class="btn btn-sm btn-primary" data-action="fee-approve" data-fc="' + a.id + '">Mock-approve</button>' : '') + '</td>' +
        '</tr>' +
        '<tr id="exp-' + a.id + '" style="display:none"><td colspan="7" style="background:var(--bg-subtle)">' + approvalDiff(a) + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Merchant</th><th>Submitted by</th><th>Submitted at</th><th>Effective</th><th>Status</th><th>Rejection reason</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function approvalDiff(a) {
    return '<div style="padding:10px 4px"><div class="meta mb-16">Reason: ' + esc(a.reason) + (a.rejectionReason ? ' &nbsp;·&nbsp; <strong style="color:var(--status-danger-fg)">Rejected:</strong> ' + esc(a.rejectionReason) : '') + '</div>' +
      '<div class="diff-grid"><div class="diff-col current"><div class="diff-head">Current</div>' + miniFeeTable([a.current], false) + '</div>' +
      '<div class="diff-arrow">' + icon('arrow-right', 20) + '</div>' +
      '<div class="diff-col draft"><div class="diff-head">Proposed (' + a.changeType + ')</div>' + miniFeeTable([a.proposed], false) + '</div></div></div>';
  }

  /* ======================================================================== *
     5.7 RECONCILIATION HOME
     ======================================================================== */
  function viewReconHome() {
    var cyc = D.cycleById['cyc-' + D.TODAY];
    var yst = D.cycleById['cyc-2025-11-20'];
    // cycle status grid — 4 network columns, three-state each
    var grid = D.NETWORKS.map(function (net) {
      var b = cyc.networks[net.key];
      return '<div class="recon-net-col"><div class="rnc-head"><span class="net-accent" style="background:' + net.color + '"></span>' + net.name + '</div>' +
        triState(b.states, true) + '</div>';
    }).join('');

    var t = cyc.totals;
    // settled-so-far: only networks that have reached the settled state (mid-cycle)
    var settledSoFar = 0, settledExpected = 0;
    D.NETWORKS.forEach(function (net) { var b = cyc.networks[net.key]; if (b.states.settled.done) { settledSoFar += b.actuallySettled; settledExpected += b.netSettlement; } });
    var reconDelta = Math.round(settledSoFar - settledExpected);
    var amounts = '<div class="amounts-panel">' +
      amountCell('Gross Authorized', fmt(t.gross), '') +
      amountCell('Gross Cleared', fmt(t.cleared), '') +
      amountCell('Incoming Rejections', num(yst.totals.rejCount) + ' · ' + fmt(yst.totals.rejAmount), yst.totals.rejCount > 0 ? 'warn' : '') +
      amountCell('Net Settlement Expected', fmt(t.netSettlement), '') +
      amountCell('Actually Settled (Nostro)', fmt(settledSoFar) + ' <span class="meta" style="font-size:11px">so far</span>', '') +
      amountCell('Delta (settled legs)', fmt(reconDelta), reconDelta === 0 ? 'good' : 'danger') +
      '</div>';

    var rejCallout = yst.totals.rejCount > 0 ? '<div class="callout warn">' + icon('alert-triangle', 20) +
      '<div class="callout-body">You have <strong>' + yst.totals.rejCount + ' rejected transactions</strong> from yesterday\'s cycle (20 Nov) awaiting re-clearing. These will be re-submitted in today\'s cycle. <a data-route="#/dashboard/bank/reconciliation/cycles/cyc-2025-11-20">View rejections →</a></div></div>' : '';

    var files = yst.files.map(fileRow).join('');

    var openDisp = D.disputes.filter(function (d) { return d.status !== 'Won' && d.status !== 'Lost'; });
    var needAction = openDisp.filter(function (d) { return d.status === 'Action Required'; }).length;
    var nearDeadline = openDisp.filter(function (d) { return d.deadlineDays <= 7; }).length;

    // recent corrections (last 7 days)
    var corrections = [];
    D.cycles.forEach(function (c) { if (c.hasCorrections && c.date >= U.addDays(D.TODAY, -10)) c.corrections.forEach(function (cc) { corrections.push(cycleCorrectionPair(cc)); }); });

    setView(
      '<div class="page-head"><div><h1 class="page-title">Reconciliation Home</h1>' +
      '<div class="subtitle">' + U.prettyLong(D.TODAY) + ' · Reconciling cycle: <strong>21 Nov 2025</strong> ' + pill('In Progress', 'warning', 'clock') + '</div></div></div>' +

      rejCallout +

      '<div class="section-title mb-16 mt-16">Cycle status</div><div class="recon-grid mb-16">' + grid + '</div>' +

      '<div class="section-title mb-16 mt-24">Cycle amounts</div>' + amounts +

      '<div class="grid grid-2 mt-24">' +
      cardBox('Recent settlement files', files) +
      cardBox('Open disputes', '<div class="grid grid-3">' +
        miniStat('Total open', num(openDisp.length)) + miniStat('Need action', num(needAction), 'warn') + miniStat('Near deadline', num(nearDeadline), 'danger') +
        '</div><div class="mt-16"><a class="btn-ghost" data-route="#/dashboard/bank/disputes">Go to disputes ' + icon('arrow-right', 14) + '</a></div>') +
      '</div>' +

      '<div class="grid grid-2 mt-24">' +
      cardBox('Recent corrections (last 7 days)', corrections.length ? corrections.join('') : '<div class="meta">No corrections in the last 7 days.</div>') +
      cardBox('Upcoming bank holidays', upcomingHolidays(3).map(holidayRow).join('') + '<div class="mt-16"><a class="btn-ghost" data-route="#/dashboard/bank/reports/holidays">Full calendar ' + icon('arrow-right', 14) + '</a></div>') +
      '</div>'
    );
  }
  function amountCell(label, val, cls) { return '<div class="amount-cell ' + cls + '"><span class="ac-label">' + label + '</span><span class="ac-value">' + val + '</span></div>'; }
  function miniStat(label, val, cls) { return '<div><div class="meta">' + label + '</div><div style="font-size:24px;font-weight:700;' + (cls === 'warn' ? 'color:var(--status-warning-fg)' : cls === 'danger' ? 'color:var(--chart-negative)' : '') + '">' + val + '</div></div>'; }
  function fileRow(f) {
    return '<div class="file-row"><span class="file-badge badge-' + f.type + '">' + f.type + '</span>' +
      '<div class="file-name">' + f.name + '<div class="file-meta">' + f.generatedAt + ' · ' + f.size + ' · ' + f.checksum + '</div></div>' +
      '<button class="icon-btn" data-action="toast" data-msg="Downloading ' + f.name + '" aria-label="Download">' + icon('download', 16) + '</button></div>';
  }

  /* ======================================================================== *
     5.8 FEE BREAKDOWN (2 tabs)
     ======================================================================== */
  function viewFeeBreakdown() {
    var tab = S.tabs.feeBreakdown;
    var tabBar = '<div class="tabs">' +
      '<button class="tab ' + (tab === 'query' ? 'active' : '') + '" data-action="tab" data-tab-group="feeBreakdown" data-tab="query">Query</button>' +
      '<button class="tab ' + (tab === 'reports' ? 'active' : '') + '" data-action="tab" data-tab-group="feeBreakdown" data-tab="reports">Merchant Fee Reports</button></div>';
    setView('<div class="page-head"><div><h1 class="page-title">Fee Breakdown</h1><div class="subtitle">Queryable fee analysis and merchant-level fee reports</div></div></div>' + tabBar + '<div>' + (tab === 'query' ? feeQuery() : merchantFeeReports()) + '</div>');
  }
  function feeQuery() {
    var group = S.filters.feeBreakdownGroup;
    var groups;
    if (group === 'network') groups = D.NETWORKS.map(function (n) { return n.name; });
    else if (group === 'mcc') groups = Object.keys(D.MCC).map(function (c) { return c + ' · ' + D.MCC[c]; });
    else if (group === 'card') groups = ['Credit', 'Debit', 'Prepaid'];
    else if (group === 'merchant') groups = D.merchants.slice(0, 10).map(function (m) { return m.name; });
    else groups = ['Domestic', 'Intra-regional', 'Cross-border'];

    var rows = groups.map(function (g, i) {
      var seed = (g.length * 7 + i * 31);
      var ic = 400000 + (seed % 9) * 120000;
      var scheme = 90000 + (seed % 7) * 22000;
      var mdr = ic + scheme + 260000 + (seed % 5) * 60000;
      var prev = mdr * (0.94 + (seed % 6) * 0.02);
      var dlt = mdr - prev;
      var eff = (mdr / (mdr * 55)) * 100;
      return '<tr><td class="cell-main">' + g + '</td><td class="num">' + fmt(ic) + '</td><td class="num">' + fmt(scheme) + '</td><td class="num">' + fmt(mdr) + '</td>' +
        '<td class="num">' + eff.toFixed(4) + '%</td><td class="num">' + fmt(prev) + '</td><td class="num" style="color:' + (dlt >= 0 ? 'var(--chart-positive)' : 'var(--chart-negative)') + '">' + (dlt >= 0 ? '+' : '') + fmt(dlt) + '</td><td class="num">' + (dlt / prev * 100).toFixed(2) + '%</td></tr>';
    }).join('');
    return '<div class="filter-row">' +
      '<div class="chip">' + icon('calendar', 15) + '<span class="chip-value">Last 30 days</span></div>' +
      '<div class="chip"><span class="chip-label">Merchant</span>' + icon('chevron-down', 15) + '</div>' +
      '<div class="chip"><span class="chip-label">MCC</span>' + icon('chevron-down', 15) + '</div>' +
      '<div class="chip"><span class="chip-label">Network</span>' + icon('chevron-down', 15) + '</div>' +
      '<div class="chip"><span class="chip-label">Card type</span>' + icon('chevron-down', 15) + '</div>' +
      '<div style="flex:1"></div>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Group by <select class="input" style="width:auto" data-action="fb-group">' +
      [['network', 'Network'], ['mcc', 'MCC'], ['card', 'Card Type'], ['merchant', 'Merchant'], ['region', 'Region']].map(function (o) { return '<option value="' + o[0] + '"' + (group === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Compare <select class="input" style="width:auto"><option>Previous period</option><option>Same period last month</option><option>Same period last quarter</option></select></label>' +
      '</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>' + ({ network: 'Network', mcc: 'MCC', card: 'Card Type', merchant: 'Merchant', region: 'Region' })[group] + '</th><th class="num">Interchange</th><th class="num">Scheme Fee</th><th class="num">MDR</th><th class="num">Effective Rate %</th><th class="num">Previous Period</th><th class="num">Delta</th><th class="num">% Change</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function merchantFeeReports() {
    var rows = D.merchants.map(function (m) {
      var gross = m.mtdVolume;
      var refund = Math.round(gross * 0.018), refundCt = Math.round(m.mtdTxns * 0.02);
      var cb = Math.round(gross * m.chargebackPct / 100);
      var ic = Math.round(gross * 0.014), scheme = Math.round(gross * 0.001);
      var mdr = Math.round(gross * 0.019);
      var net = gross - refund - cb - mdr;
      var effMdr = (mdr / gross * 100);
      return '<tr class="clickable" data-route="#/dashboard/bank/merchants/' + m.id + '">' +
        '<td class="cell-main">' + esc(m.name) + '<div class="cell-sub">MID ' + m.mid + '</div></td>' +
        '<td class="num">' + fmt(gross) + '</td><td class="num">' + num(m.mtdTxns) + '</td>' +
        '<td class="num">' + fmt(refund) + '</td><td class="num">' + num(refundCt) + '</td>' +
        '<td class="num">' + fmtT(cb) + '</td><td class="num">' + fmt(ic) + '</td><td class="num">' + fmt(scheme) + '</td><td class="num">' + fmt(mdr) + '</td>' +
        '<td class="num">' + fmt(net) + '</td><td class="num">' + effMdr.toFixed(4) + '%</td>' +
        '<td><button class="icon-btn" data-action="toast" data-msg="Generating PDF for ' + esc(m.name) + '" aria-label="PDF">' + icon('file-text', 15) + '</button></td></tr>';
    }).join('');
    return '<div class="filter-row"><div class="chip">' + icon('calendar', 15) + '<span class="chip-value">Oct 2025 (last complete month)</span></div>' +
      '<div class="chip"><span class="chip-label">Merchants</span><span class="chip-value">All (25)</span>' + icon('chevron-down', 15) + '</div>' +
      '<div style="flex:1"></div><button class="btn btn-secondary" data-action="toast" data-msg="Exporting ZIP of per-merchant PDFs…">' + icon('folder-archive', 16) + 'Export all as ZIP</button></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Merchant</th><th class="num">Gross Volume</th><th class="num">Txn Count</th><th class="num">Refund Amt</th><th class="num">Refund Ct</th><th class="num">Chargeback</th><th class="num">Interchange</th><th class="num">Scheme</th><th class="num">MDR</th><th class="num">Net Settlement</th><th class="num">Eff. MDR %</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ======================================================================== *
     5.9a SETTLEMENT CYCLES LIST
     ======================================================================== */
  function viewCyclesList() {
    var rows = D.cyclesDesc.map(function (c) {
      var t = c.totals;
      var deltaVal = Math.round(t.delta);
      // The zero delta is status text, not a chart series: --chart-positive is
      // tuned to sit as a filled mark and reads at 2.2:1 as text on the cream
      // holiday-row background. --status-success-fg is the token for this.
      var deltaHtml = c.isToday ? pill('In progress', 'warning') : (deltaVal === 0 ? '<span style="color:var(--status-success-fg)">' + fmt(0) + '</span>' : '<span style="color:var(--chart-negative);font-weight:600">' + fmt(deltaVal) + '</span>');
      var fileBadges = c.files.length ? c.files.map(function (f) { return '<span class="file-badge badge-' + f.type + '" style="margin-right:3px">' + f.type + '</span>'; }).join('') : '<span class="meta">pending</span>';
      var rejCell = t.rejCount > 0 ? '<span style="color:var(--status-warning-fg);font-weight:600">' + num(t.rejCount) + ' · ' + fmtCr(t.rejAmount) + '</span>' : '—';
      return '<tr class="clickable ' + (c.holiday ? 'holiday-tint' : '') + '" data-route="#/dashboard/bank/reconciliation/cycles/' + c.id + '">' +
        '<td><div class="cell-main">' + U.prettyDate(c.date) + '</div><div class="cell-sub">' + c.dow + (c.holiday ? ' · <span class="pill pill-warning" style="padding:1px 8px">🏦 Holiday</span>' : '') + '</div></td>' +
        '<td>' + netStripMini(c) + '</td>' +
        '<td class="num">' + fmtCr(t.gross) + '</td>' +
        '<td class="num">' + rejCell + '</td>' +
        '<td class="num">' + fmtCr(t.cleared) + '</td>' +
        '<td class="num">' + fmtCr(t.interchange + t.scheme) + '</td>' +
        '<td class="num">' + fmtCr(t.netSettlement) + '</td>' +
        '<td class="num">' + (c.isToday ? '<span class="meta">—</span>' : fmtCr(t.actuallySettled)) + '</td>' +
        '<td class="num">' + deltaHtml + '</td>' +
        '<td>' + fileBadges + '</td></tr>';
    }).join('');
    setView(
      '<div class="page-head"><div><h1 class="page-title">Settlement Cycles</h1><div class="subtitle">Network-level settlement aggregates · last ' + D.cycles.length + ' cycles</div></div></div>' +
      '<div class="filter-row"><div class="chip">' + icon('calendar', 15) + '<span class="chip-value">Last 45 days</span></div>' +
      '<div class="chip"><span class="chip-label">Networks</span><span class="chip-value">All</span>' + icon('chevron-down', 15) + '</div>' +
      '<div class="chip"><span class="chip-label">Status</span>' + icon('chevron-down', 15) + '</div>' +
      '<div style="flex:1"></div>' +
      '<div class="chip" style="padding:2px;gap:2px"><button class="btn btn-sm ' + (S.filters.cyclesGroup === 'date' ? 'btn-primary' : 'btn-ghost') + '" data-action="cycles-group" data-group="date">By Date</button><button class="btn btn-sm ' + (S.filters.cyclesGroup === 'network' ? 'btn-primary' : 'btn-ghost') + '" data-action="cycles-group" data-group="network">By Network</button></div>' +
      '</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Cycle Date</th><th>Network Status</th><th class="num">Gross Auth</th><th class="num">Rejections</th><th class="num">Cleared</th><th class="num">Fees</th><th class="num">Net Settlement</th><th class="num">Actually Settled</th><th class="num">Delta</th><th>Files</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    );
  }

  /* ======================================================================== *
     5.9b CYCLE DETAIL — the showpiece
     ======================================================================== */
  function viewCycleDetail(cycleId) {
    var c = D.cycleById[cycleId];
    if (!c) { setView('<div class="card">' + emptyState('search-x', 'Cycle not found', 'This settlement cycle does not exist.', '<button class="btn btn-secondary" data-route="#/dashboard/bank/reconciliation/cycles">Back to cycles</button>') + '</div>'); return; }
    var idx = D.cycles.findIndex(function (x) { return x.id === c.id; });
    var t = c.totals;
    var statusKind = c.status === 'Settled' ? 'success' : (c.status === 'In Progress' ? 'warning' : (c.status === 'Break' ? 'danger' : 'neutral'));

    // summary strip — compact figures so all 7 fit one clean row (full precision lives in the network cards below)
    var summary = '<div class="amounts-panel" style="grid-template-columns:repeat(7,minmax(0,1fr))">' +
      amountCell('Gross Authorized', fmtCr(t.gross), '') +
      amountCell('Rejections', t.rejAmount > 0 ? fmtCr(t.rejAmount) : '—', t.rejAmount > 0 ? 'warn' : '') +
      amountCell('Cleared', fmtCr(t.cleared), '') +
      amountCell('Fees (IC+Scheme)', fmtCr(t.interchange + t.scheme), '') +
      amountCell('Net Settlement', fmtCr(t.netSettlement), '') +
      amountCell('Actually Settled', c.isToday ? '—' : fmtCr(t.actuallySettled), '') +
      amountCell('Delta', c.isToday ? '—' : (Math.round(t.delta) === 0 ? '₹0.00' : fmtCr(Math.round(t.delta))), c.isToday ? '' : (Math.round(t.delta) === 0 ? 'good' : 'danger')) +
      '</div>';

    // per-network cards
    var netCards = D.NETWORKS.map(function (net) {
      var b = c.networks[net.key];
      var sparkVals = D.networkSpark(idx, net.key);
      return '<div class="net-card" style="--net-color:' + net.color + '">' +
        '<div class="nc-head"><div class="nc-title"><span class="net-accent" style="background:' + net.color + '"></span>' + net.name + '</div>' + spark(sparkVals, 84, 26, net.color) + '</div>' +
        triState(b.states, false) +
        '<div class="nc-metrics">' +
        ncRow('Transactions', num(b.count)) +
        ncRow('Gross Authorized', fmt(b.gross)) +
        ncRow('Incoming Rejections', b.rejCount > 0 ? (num(b.rejCount) + ' · ' + fmt(b.rejAmount)) : '—', b.rejCount > 0 ? 'warn' : '') +
        ncRow('Cleared', fmt(b.cleared)) +
        '<div class="nc-divider"></div>' +
        ncRow('Interchange Fee', fmt(b.interchange)) +
        ncRow('Scheme Fee', fmt(b.scheme)) +
        ncRow('MDR (bank revenue)', fmt(b.mdr)) +
        '<div class="nc-divider"></div>' +
        ncRow('Net Settlement', fmt(b.netSettlement)) +
        ncRow('Actually Settled', c.isToday && !b.states.settled.done ? '—' : fmt(b.actuallySettled)) +
        ncRow('Delta', (c.isToday && !b.states.settled.done) ? '—' : fmt(Math.round(b.delta)), (c.isToday && !b.states.settled.done) ? '' : (Math.round(b.delta) === 0 ? 'pos' : 'neg')) +
        '</div></div>';
    }).join('');

    // waterfall
    var wf = waterfall(t);

    // rejections section
    var rejSection = '';
    if (c.rejections.length) {
      var rrows = c.rejections.map(function (rj) {
        return '<tr><td>' + rj.network + '</td><td class="mono">' + rj.arn + '</td><td class="num">' + fmt(rj.amount) + '</td>' +
          '<td><strong>' + rj.reasonCode + '</strong> ' + rj.reasonDesc + '</td><td>' + U.prettyDate(rj.receivedOn) + '</td>' +
          '<td>' + rejLifecycle(rj) + '</td><td>' + U.prettyDate(rj.expectedSettlement) + '</td></tr>';
      }).join('');
      rejSection = '<div class="card mt-24" style="border-color:#FDE68A"><div class="card-head"><div class="card-title" style="color:var(--status-warning-fg)">' + icon('alert-triangle', 18) + ' Incoming Rejections for this cycle</div></div>' +
        '<div class="callout warn" style="margin-bottom:16px">' + icon('info', 20) + '<div class="callout-body">These transactions were submitted but rejected by the network. They are re-cleared in the next cycle (T+1) and settle the following day (T+2). Each row below shows its position in that lifecycle.</div></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Network</th><th>ARN (masked)</th><th class="num">Original Amount</th><th>Rejection Reason</th><th>Received (T)</th><th>Lifecycle</th><th>Expected Settlement (T+2)</th></tr></thead><tbody>' + rrows + '</tbody></table></div></div>';
    }

    // comparison to previous cycle
    var prev = idx > 0 ? D.cycles[idx - 1] : null;
    var compare = prev ? cardBox('Comparison to previous cycle (' + U.prettyDate(prev.date) + ')', '<div class="grid grid-4">' +
      compareStat('Gross', t.gross, prev.totals.gross) +
      compareStat('Net Settlement', t.netSettlement, prev.totals.netSettlement) +
      compareStat('Fees', t.interchange + t.scheme, prev.totals.interchange + prev.totals.scheme) +
      compareStat('Rejections', t.rejAmount, prev.totals.rejAmount) +
      '</div>') : '';

    // corrections
    var corrSection = c.corrections.length ? cardBox('Correction history', '<div class="meta mb-16">Immutable record — the original entry is nullified (struck-through) and the correcting entry appears directly below.</div>' + c.corrections.map(cycleCorrectionPair).join('')) : '';

    // files
    var filesSection = c.files.length ? cardBox('Related settlement files', c.files.map(fileRow).join('')) : cardBox('Related settlement files', '<div class="meta">Files are generated after the cycle settles.</div>');

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/reconciliation/cycles">Settlement Cycles</a><span class="sep">/</span><span>' + U.prettyDate(c.date) + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">Cycle · ' + U.prettyDate(c.date) + '</h1>' +
      '<div class="subtitle">' + c.id.toUpperCase() + ' · ' + c.dow + ' ' + pill(c.status, statusKind) + (c.holiday ? ' ' + pill('🏦 ' + c.holiday.name, 'warning') : '') + '</div></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-action="toast" data-msg="Exporting cycle report…">' + icon('download', 16) + 'Export cycle</button></div></div>' +

      (c.hasBreak ? '<div class="callout danger" style="margin-bottom:18px">' + icon('alert-octagon', 20) + '<div class="callout-body"><strong>Delta break under investigation.</strong> Actually settled to nostro is ' + fmt(Math.abs(t.delta)) + ' short of expected net settlement. Recon team notified; JV2 adjustment pending.</div></div>' : '') +

      '<div class="section-title mb-16">Cycle summary</div>' + summary +

      '<div class="section-title mb-16 mt-24">Settlement waterfall</div>' + cardBox('', wf) +

      '<div class="section-title mb-16 mt-24">Per-network breakdown</div><div class="net-grid">' + netCards + '</div>' +

      rejSection +

      '<div class="grid grid-2 mt-24">' + compare + filesSection + '</div>' +

      (corrSection ? '<div class="mt-24">' + corrSection + '</div>' : '') +

      '<div class="mt-24">' + cardBox('Reconciliation notes', '<textarea class="input" placeholder="Add a reconciliation note for this cycle (mockup)…">' + (c.hasBreak ? 'Investigating ' + fmt(Math.abs(t.delta)) + ' shortfall on Mastercard leg — awaiting network confirmation file.' : '') + '</textarea><div class="mt-16"><button class="btn btn-primary btn-sm" data-action="toast" data-msg="Reconciliation note saved">Save note</button></div>') + '</div>'
    );
  }
  function ncRow(label, val, cls) { return '<div class="m-label">' + label + '</div><div class="m-value ' + (cls || '') + '">' + val + '</div>'; }
  function compareStat(label, cur, prev) {
    var d = prev ? ((cur - prev) / prev * 100) : 0;
    return '<div><div class="meta">' + label + '</div><div class="strong" style="font-size:16px">' + fmtCr(cur) + '</div>' + delta(Math.round(d * 100) / 100, label === 'Rejections') + '</div>';
  }
  function rejLifecycle(rj) {
    var stages = [['Rejected', 'rejected'], ['Re-cleared', 'recleared'], ['Settled', 'settled']];
    var stateIdx = rj.status === 'Awaiting re-clearing' ? 0 : (rj.status === 'Re-cleared' ? 1 : 2);
    var out = '<div class="rej-life">';
    stages.forEach(function (s, i) {
      var cls = i < stateIdx ? 'done' : (i === stateIdx ? (rj.status === 'Settled' ? 'done' : 'active') : 'pending');
      var ic = i < stateIdx || (i === stateIdx && rj.status === 'Settled') ? 'check' : (i === stateIdx ? 'clock' : 'circle');
      out += '<span class="rl-step ' + cls + '">' + icon(ic, 12) + s[0] + '</span>';
      if (i < 2) out += icon('chevron-right', 12);
    });
    return out + '</div>';
  }
  // Bespoke SVG waterfall (Part 2.5 / 5.9b): Gross → −Rej → −IC → −Scheme = Net.
  // Dashed step-connectors link each running total to the next so the descending
  // flow stays legible even though fees are only a small % of gross.
  function waterfall(t) {
    var gross = t.gross, rej = t.rejAmount, ic = t.interchange, scheme = t.scheme, net = t.netSettlement;
    var W = 1000, top = 16, bh = 200, base = top + bh, max = gross || 1;
    function y(v) { return top + (1 - v / max) * bh; }
    var tops = [gross, gross, gross - rej, gross - rej - ic, net];
    var bots = [0, gross - rej, gross - rej - ic, net, 0];
    var defs = [
      { cat: 'Gross Authorized', amt: gross, color: '#64748B', neg: false },
      { cat: '− Incoming Rejections', amt: rej, color: '#EF4444', neg: true },
      { cat: '− Interchange Fee', amt: ic, color: '#EAB308', neg: true },
      { cat: '− Scheme Fee', amt: scheme, color: '#8B5CF6', neg: true },
      { cat: '= Net Settlement', amt: net, color: '#22C55E', neg: false }
    ];
    var cw = W / 5, bw = cw * 0.5, bars = '', conns = '', labels = '';
    for (var i = 0; i < 5; i++) {
      var cx = cw * i + cw / 2, x = cx - bw / 2;
      var yTop = y(tops[i]), hgt = Math.max(5, y(bots[i]) - yTop);
      bars += '<rect x="' + x.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="3" fill="' + defs[i].color + '"/>';
      if (i < 4) {
        var yc = y(tops[i + 1]).toFixed(1);
        conns += '<line x1="' + (x + bw).toFixed(1) + '" y1="' + yc + '" x2="' + (cw * (i + 1) + cw / 2 - bw / 2).toFixed(1) + '" y2="' + yc + '" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="4 4"/>';
      }
      var amtStr = (defs[i].amt > 0 || i === 0 || i === 4) ? ((defs[i].neg ? '−' : '') + fmtCr(defs[i].amt)) : '—';
      labels += '<text x="' + cx.toFixed(1) + '" y="' + (base + 28) + '" text-anchor="middle" font-size="13" fill="#64748B">' + defs[i].cat + '</text>';
      labels += '<text x="' + cx.toFixed(1) + '" y="' + (base + 50) + '" text-anchor="middle" font-size="16" font-weight="700" fill="' + (defs[i].neg ? '#EF4444' : '#0F172A') + '">' + amtStr + '</text>';
    }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + (base + 62) + '" width="100%" style="height:auto" font-family="Inter, sans-serif">' +
      '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="#E2E8F0" stroke-width="1"/>' + conns + bars + labels + '</svg>';
    var legend = '<div class="wf-legend">' +
      '<span class="lg"><span class="sw" style="background:#64748B"></span>Gross authorized</span>' +
      '<span class="lg"><span class="sw" style="background:#EF4444"></span>Rejections (held back)</span>' +
      '<span class="lg"><span class="sw" style="background:#EAB308"></span>Interchange (to issuer)</span>' +
      '<span class="lg"><span class="sw" style="background:#8B5CF6"></span>Scheme fee (to network)</span>' +
      '<span class="lg"><span class="sw" style="background:#22C55E"></span>Net settlement to nostro</span></div>';
    return '<div class="waterfall">' + svg + legend + '</div>';
  }

  /* ======================================================================== *
     5.10 DISPUTES
     ======================================================================== */
  var DISPUTE_TABS = ['All', 'Action Required', 'Approaching Deadline', 'In Representment', 'Awaiting Network', 'Won', 'Lost'];
  function viewDisputes() {
    var active = S.tabs.disputes;
    var tabBar = '<div class="tabs">' + DISPUTE_TABS.map(function (t) {
      var count = filterDisputes(t).length;
      return '<button class="tab ' + (active === t ? 'active' : '') + '" data-action="tab" data-tab-group="disputes" data-tab="' + t + '">' + t + '<span class="count">' + count + '</span></button>';
    }).join('') + '</div>';
    var list = filterDisputes(active);
    var body;
    if (!list.length) body = '<div class="card">' + emptyState('shield-check', 'No disputes in this view', 'Nothing needs attention under “' + active + '”.') + '</div>';
    else {
      var rows = list.map(function (d) {
        var urg = d.deadlineDays < 3 ? 'danger' : (d.deadlineDays < 7 ? 'warning' : 'neutral');
        var stKind = { 'Action Required': 'warning', 'In Representment': 'info', 'Awaiting Network': 'info', 'Won': 'success', 'Lost': 'danger' }[d.status] || 'neutral';
        return '<tr class="clickable" data-route="#/dashboard/bank/disputes/' + d.id + '">' +
          '<td><div class="cell-main nowrap">' + d.idShort + '</div><div class="cell-sub mono">' + d.arn.replace(/•+/, '••') + '</div></td>' +
          '<td>' + esc(d.merchant) + '</td><td>' + d.network + '</td><td class="nowrap">' + d.stage + '</td>' +
          '<td><div class="cell-main">' + d.reasonCode + '</div><div class="cell-sub" style="max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.reasonDesc) + '</div></td>' +
          '<td class="num">' + fmt(d.amount) + '</td><td class="nowrap">' + U.prettyDate(d.received) + '</td>' +
          '<td>' + pill(U.prettyDate(d.deadline) + ' · ' + d.deadlineDays + 'd', urg) + '</td>' +
          '<td>' + pill(d.status, stKind) + '</td></tr>';
      }).join('');
      body = '<div class="table-wrap"><table class="data"><thead><tr><th>Dispute</th><th>Merchant</th><th>Network</th><th>Stage</th><th>Reason Code</th><th class="num">Amount</th><th>Received</th><th>Deadline</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table><div class="table-foot"><span>' + list.length + ' disputes</span></div></div>';
    }
    setView('<div class="page-head"><div><h1 class="page-title">Disputes</h1><div class="subtitle">Chargeback & representment management</div></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-action="toast" data-msg="Exporting disputes…">' + icon('download', 16) + 'Export</button></div></div>' +
      tabBar + body);
  }
  function filterDisputes(tab) {
    return D.disputes.filter(function (d) {
      if (tab === 'All') return true;
      if (tab === 'Action Required') return d.status === 'Action Required';
      if (tab === 'Approaching Deadline') return d.deadlineDays < 7 && d.status !== 'Won' && d.status !== 'Lost';
      if (tab === 'In Representment') return d.status === 'In Representment';
      if (tab === 'Awaiting Network') return d.status === 'Awaiting Network';
      if (tab === 'Won') return d.status === 'Won';
      if (tab === 'Lost') return d.status === 'Lost';
      return true;
    });
  }
  function viewDisputeDetail(id) {
    var d = D.disputeById[id];
    if (!d) { setView('<div class="card">' + emptyState('search-x', 'Dispute not found', 'This dispute does not exist.', '<button class="btn btn-secondary" data-route="#/dashboard/bank/disputes">Back to disputes</button>') + '</div>'); return; }
    var urg = d.deadlineDays < 3 ? 'danger' : (d.deadlineDays < 7 ? 'warning' : 'neutral');
    var tl = '<div class="timeline">' + d.timeline.map(function (s, i) {
      var cls = s.done ? 'done' : (i === d.timeline.findIndex(function (x) { return !x.done; }) ? 'current' : '');
      return '<div class="tl-step ' + cls + '"><div class="tl-line"></div><div class="tl-node">' + icon(s.done ? 'check' : 'circle', 15) + '</div>' +
        '<div class="tl-label">' + s.stage + '</div><div class="tl-date">' + U.prettyDate(s.date) + '</div><div class="tl-amt">' + fmt(s.amount) + '</div></div>';
    }).join('') + '</div>';
    var evidence = 'Cardholder disputes the transaction citing ' + d.reasonDesc.toLowerCase() + '. Typically requires: signed receipt or delivery confirmation, proof of authorization (auth code ' + d.authCode + '), and any prior communication with the cardholder.';

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/disputes">Disputes</a><span class="sep">/</span><span>' + d.idShort + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">' + d.idShort + '</h1><div class="subtitle">' + esc(d.merchant) + ' · ' + d.network + ' · ' + fmt(d.amount) + ' &nbsp;' + pill(d.stage, 'info') + ' ' + pill('Deadline ' + U.prettyDate(d.deadline), urg) + '</div></div></div>' +

      cardBox('Lifecycle', tl) +

      '<div class="grid grid-2 mt-24">' +
      cardBox('Original transaction', '<dl class="def-list"><dt>Transaction date</dt><dd>' + U.prettyDate(d.txnDate) + '</dd><dt>Amount</dt><dd>' + fmt(d.amount) + '</dd><dt>Card BIN (masked)</dt><dd class="mono">' + d.bin + '</dd><dt>Auth code</dt><dd>' + d.authCode + '</dd><dt>ARN</dt><dd class="mono">' + d.arn + '</dd></dl>') +
      cardBox('Reason code & financial impact', '<div class="strong" style="font-size:16px">' + d.reasonCode + ' · ' + d.reasonDesc + '</div><div class="meta mt-16">' + evidence + '</div><hr class="hr"/>' +
        '<dl class="def-list"><dt>Debited from settlement</dt><dd>' + fmt(d.amount) + '</dd><dt>In cycle</dt><dd><a class="btn-ghost" data-route="#/dashboard/bank/reconciliation/cycles/' + d.cycleId + '">' + U.prettyDate(d.cycleDate) + ' →</a></dd></dl>') +
      '</div>' +

      '<div class="mt-24">' + cardBox('Evidence & defense', '<div class="upload-zone" data-action="add-file">' + icon('upload-cloud', 28) + '<div class="strong">Drag & drop evidence</div><div class="meta">Receipts, delivery proof, comms — any file (mockup)</div></div>' +
        '<div class="mt-16">' + field('Draft representment narrative', '<textarea class="input" placeholder="Describe the evidence and why the chargeback should be reversed…"></textarea>') + '</div>' +
        '<div class="row mt-16" style="align-items:center;gap:14px"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" data-action="noop"/> Partial defense</label><input class="input" placeholder="Defended amount" style="max-width:200px"/></div>' +
        '<div class="row mt-16" style="justify-content:flex-end"><button class="btn btn-primary" data-action="toast" data-msg="Representment submitted for ' + d.idShort + '">' + icon('send', 16) + 'Submit representment</button></div>') + '</div>' +

      '<div class="mt-24">' + cardBox('Communication log', d.notes.map(function (n) { return '<div class="file-row"><div class="file-name">' + esc(n.text) + '<div class="file-meta">' + n.at + ' · ' + n.by + '</div></div></div>'; }).join('')) + '</div>'
    );
  }

  /* ======================================================================== *
     5.11 REPORTS (4 tabs incl. holidays)
     ======================================================================== */
  function viewReports() {
    var tab = S.tabs.reports;
    var tabBar = '<div class="tabs">' +
      ['library', 'generate', 'schedules'].map(function (t) {
        var lbl = { library: 'Library', generate: 'Generate', schedules: 'Schedules' }[t];
        return '<button class="tab ' + (tab === t ? 'active' : '') + '" data-action="tab" data-tab-group="reports" data-tab="' + t + '">' + lbl + '</button>';
      }).join('') +
      '<button class="tab" data-route="#/dashboard/bank/reports/holidays">Bank Holidays</button></div>';
    var firstLoad = (tab === 'library' && !S.loading.reports);
    var initial = firstLoad ? '<div class="table-wrap" style="padding:16px">' + skeletonRows(6) + '</div>' : reportsTab(tab);
    setView('<div class="page-head"><div><h1 class="page-title">Reports</h1><div class="subtitle">Generate, schedule and download settlement & fee reports</div></div></div>' + tabBar + '<div id="reportsTab">' + initial + '</div>');
    if (firstLoad) {
      S.loading.reports = true;
      setTimeout(function () { var n = el('reportsTab'); if (n) { n.innerHTML = reportsLibrary(); if (window.lucide) lucide.createIcons(); } }, 320);
    }
  }
  function reportsTab(tab) {
    if (tab === 'library') return reportsLibrary();
    if (tab === 'generate') return reportsGenerate();
    return reportsSchedules();
  }
  function reportsLibrary() {
    var rows = D.reportLibrary.map(function (r) {
      var fmtKind = { PDF: 'danger', XLSX: 'success', CSV: 'info' }[r.format];
      return '<tr><td class="cell-main">' + r.name + '</td><td>' + r.type + '</td><td>' + r.range + '</td><td>' + r.generatedAt + '</td><td>' + r.generatedBy + '</td><td>' + pill(r.format, fmtKind) + '</td><td class="num">' + r.size + '</td><td><span class="meta">' + r.retention + '</span></td><td><button class="icon-btn" data-action="toast" data-msg="Downloading ' + esc(r.name) + '">' + icon('download', 15) + '</button></td></tr>';
    }).join('');
    return '<div class="filter-row"><div class="chip"><span class="chip-label">Type</span>' + icon('chevron-down', 15) + '</div><div class="chip">' + icon('calendar', 15) + '<span class="chip-value">All dates</span></div><div class="chip"><span class="chip-label">Generated by</span>' + icon('chevron-down', 15) + '</div></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Type</th><th>Date range</th><th>Generated at</th><th>Generated by</th><th>Format</th><th class="num">Size</th><th>Retention</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function reportsGenerate() {
    if (S.reportError) return '<div class="card">' + errorState('SFTP endpoint (sftp://out.hsbc.co.in) is unreachable. The report was generated but could not be delivered.', 'retry-generate') + '</div>';
    return '<div class="card" style="max-width:640px"><div class="stack">' +
      field('Report type', '<select class="input" id="repType">' + D.reportTypes.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>', true) +
      field('Date range', '<input class="input" type="text" value="01 Nov 2025 – 21 Nov 2025" />', true) +
      field('Type-specific filters', '<select class="input"><option>All merchants</option><option>All networks</option><option>Domestic only</option></select>') +
      '<div class="field">Output format<div class="row" style="gap:20px;margin-top:8px">' + ['PDF', 'XLSX', 'CSV'].map(function (f, i) { return '<label style="display:flex;gap:8px;align-items:center;font-weight:500;color:var(--text-primary)"><input type="radio" name="fmt" ' + (i === 0 ? 'checked' : '') + '/> ' + f + '</label>'; }).join('') + '</div></div>' +
      '<div class="field">Delivery<div class="row" style="gap:20px;margin-top:8px">' + ['Download', 'Email', 'SFTP'].map(function (dv, i) { return '<label style="display:flex;gap:8px;align-items:center;font-weight:500;color:var(--text-primary)"><input type="radio" name="delivery" ' + (i === 0 ? 'checked' : '') + ' data-action="report-delivery" data-delivery="' + dv + '"/> ' + dv + '</label>'; }).join('') + '</div></div>' +
      '<div id="genProgress"></div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn btn-primary" data-action="generate-report">' + icon('play', 16) + 'Generate report</button></div>' +
      '</div></div>';
  }
  function reportsSchedules() {
    var rows = D.reportSchedules.map(function (s, i) {
      return '<tr><td class="cell-main">' + s.name + '</td><td>' + s.type + '</td><td>' + s.freq + '</td><td>' + s.recipients + '</td><td>' + s.lastRun + '</td><td>' + s.nextRun + '</td><td>' + pill(s.status, s.status === 'Active' ? 'success' : 'neutral') + '</td>' +
        '<td><button class="icon-btn" data-action="toast" data-msg="Edit schedule">' + icon('edit-3', 15) + '</button> <button class="icon-btn" data-action="toast" data-msg="' + (s.status === 'Active' ? 'Paused' : 'Resumed') + ' ' + s.name + '">' + icon(s.status === 'Active' ? 'pause' : 'play', 15) + '</button> <button class="icon-btn" data-action="toast" data-msg="Deleted schedule">' + icon('trash-2', 15) + '</button></td></tr>';
    }).join('');
    return '<div class="row" style="justify-content:flex-end;margin-bottom:16px"><button class="btn btn-primary" data-action="toast" data-msg="Opening create-schedule form…">' + icon('plus', 16) + 'Create schedule</button></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Type</th><th>Frequency</th><th>Recipients</th><th>Last run</th><th>Next run</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---- 5.11d Bank Holidays ------------------------------------------------ */
  function viewHolidays() {
    var country = S.filters.holidayCountry;
    var list = D.holidays.filter(function (h) { return h.country === country; });
    var rows = list.map(function (h) {
      var d = U.fromYmd(h.date);
      var kind = h.impact === 'Full holiday' ? 'danger' : (h.impact === 'Half day' ? 'warning' : 'neutral');
      return '<tr class="' + (h.date >= '2025-10-07' && h.date <= D.TODAY ? 'holiday-tint' : '') + '"><td class="cell-main">' + U.prettyDate(h.date) + '</td><td>' + U.DOW[d.getUTCDay()] + '</td><td>' + h.name + '</td><td>' + h.country + '</td><td>' + pill(h.impact, kind) + '</td></tr>';
    }).join('');
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/bank/reports">Reports</a><span class="sep">/</span><span>Bank Holidays</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">Bank Holiday Calendar</h1><div class="subtitle">2025 – 2026 · affects settlement processing</div></div>' +
      '<div class="head-actions"><select class="input" style="width:auto" data-action="holiday-country"><option ' + (country === 'India' ? 'selected' : '') + '>India</option><option ' + (country === 'Singapore' ? 'selected' : '') + '>Singapore</option><option ' + (country === 'Hong Kong' ? 'selected' : '') + '>Hong Kong</option></select>' +
      '<button class="btn btn-secondary" data-action="toast" data-msg="Downloading holiday calendar report…">' + icon('download', 16) + 'Download</button></div></div>' +
      (list.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Country</th><th>Settlement impact</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="card">' + emptyState('calendar-x', 'No holidays configured', 'No bank holidays are on file for ' + country + ' yet.') + '</div>')
    );
  }

  /* ======================================================================== *
     5.12 USERS & ACCESS
     ======================================================================== */
  function viewUsers() {
    var rows = D.users.map(function (u) {
      return '<tr><td class="cell-main">' + u.name + '</td><td>' + esc(u.email) + '</td><td>' + u.role + '</td><td>' + u.lastLogin + '</td><td>' + pill(u.status, u.status === 'Active' ? 'success' : 'neutral') + '</td></tr>';
    }).join('');
    var roles = D.roleDefs.map(function (r) { return '<div class="file-row"><div class="file-name">' + r.role + '<div class="file-meta">' + r.can + '</div></div></div>'; }).join('');
    var audit = D.auditLog.map(function (a) { return '<div class="file-row"><div class="file-name">' + esc(a.action) + '<div class="file-meta">' + a.at + ' · ' + a.who + '</div></div></div>'; }).join('');
    setView(
      '<div class="page-head"><div><h1 class="page-title">Users & Access</h1><div class="subtitle">Bank users, roles and audit trail · HSBC IN</div></div>' +
      '<div class="head-actions"><button class="btn btn-primary" data-action="open-add-user">' + icon('user-plus', 16) + 'Add user</button></div></div>' +
      cardBox('Users', '<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>') +
      '<div class="grid grid-2 mt-24">' + cardBox('Role definitions', roles) + cardBox('Audit log (last 10 actions)', audit) + '</div>'
    );
  }

  /* ======================================================================== *
     OPS PORTAL (Phase 2)
     ======================================================================== */
  /* Part 10.1 asks that a tenant name link to that tenant's onboarding detail.
     It is opt-in rather than automatic: most tenant tags sit inside a row that
     already carries its own data-route, and the innermost route wins in the
     delegate — an automatic link would quietly hijack every table row and queue
     item in the portal. Callers turn it on where the name stands alone. */
  function tenantTag(tid, link) {
    var t = O.tenantById[tid] || O.onboardingById[tid]; if (!t) return tid;
    var inner = '<span class="tenant-dot" style="background:' + t.color + '"></span>' + esc(t.name);
    if (!link || !O.onboardingById[tid]) return '<span class="tenant-tag">' + inner + '</span>';
    return '<span class="tenant-tag linked" data-route="#/dashboard/ops/onboarding/' + esc(tid) + '" ' +
      'role="link" tabindex="0" title="' + esc('Open ' + t.name + '’s onboarding detail') + '">' + inner + '</span>';
  }
  function tenantSelect(action, value, includeAll) {
    var opts = includeAll ? '<option value="all"' + (value === 'all' ? ' selected' : '') + '>All tenants</option>' : '';
    opts += O.tenants.map(function (t) { return '<option value="' + t.id + '"' + (value === t.id ? ' selected' : '') + '>' + t.name + '</option>'; }).join('');
    return '<select class="input" style="width:auto" data-action="' + action + '">' + opts + '</select>';
  }
  function slaBadge(hoursLeft) {
    var cls = hoursLeft <= 0 ? 'red' : (hoursLeft < 4 ? 'red' : (hoursLeft < 24 ? 'amber' : 'green'));
    var txt = hoursLeft <= 0 ? 'Overdue ' + Math.abs(hoursLeft) + 'h' : hoursLeft + 'h left';
    return '<span class="sla ' + cls + '">' + icon(hoursLeft <= 0 ? 'alert-circle' : 'clock', 13) + txt + '</span>';
  }
  function routeOps(rest) {
    // apply any ?query presets onto S.ops (used by clickable counts)
    Object.keys(S.query).forEach(function (k) { if (S.ops.hasOwnProperty(k)) S.ops[k] = S.query[k]; });
    var head = rest[0] || 'home';
    if (head !== 'configs') S.opsChild = null;
    if (head === 'configs') {
      // Platform Configs (Phase 3) — the module sets S.opsChild then re-renders the sidebar.
      S.opsActive = 'ops-configs';
      return CFGUI.route(rest.slice(1));
    }
    if (!rest.length || head === 'home') { S.opsActive = 'ops-home'; renderSidebar(); return viewOpsHome(); }
    if (head === 'approvals') { S.opsActive = 'ops-approvals'; renderSidebar(); return rest[1] ? viewApprovalDetail(rest[1]) : viewApprovals(); }
    if (head === 'reconciliation') {
      // One screen (Part 4.3): the recon history plus its side panel. The old
      // /reconciliation/files child is gone, and any surviving link to it lands
      // here rather than nowhere.
      S.opsActive = 'ops-recon'; renderSidebar();
      return viewOpsRecon();
    }
    // Cycle Snapshot — the drill-in behind every Cross-Tenant Cycle Status cell.
    // It belongs to Ops Home, so the sidebar keeps Ops Home selected.
    if (head === 'cycle-snapshot') { S.opsActive = 'ops-home'; renderSidebar(); return CYCUI.route(rest.slice(1)); }
    /* Network Files — one record per tenant × network × cycle in each
       direction, and the :cycleId drill-in where the instruction block and the
       already-started guard live. */
    if (head === 'network-files') {
      S.opsActive = 'ops-netfiles';
      S.opsChild = rest[1] === 'incoming' ? 'ops-nf-in' : 'ops-nf-out';
      renderSidebar();
      return NFUI.route(rest.slice(1));
    }
    if (head === 'files') { S.opsActive = 'ops-files'; renderSidebar(); return SFUI.route(); }
    // Rejects — staging + incoming rejects across Visa and Mastercard. One
    // branch covers the overview and the :batchId drill-in; the correction
    // editor is a side panel over the batch, not a route of its own.
    if (head === 'rejects') { S.opsActive = 'ops-rejects'; renderSidebar(); return REJUI.route(rest.slice(1)); }
    if (head === 'onboarding') {
      S.opsActive = 'ops-onboarding'; renderSidebar();
      if (rest[1] === 'new') return viewOnboardNew();
      if (rest[1]) return viewTenantDetail(rest[1]);
      return viewOnboardingList();
    }
    if (head === 'disputes') { S.opsActive = 'ops-disputes'; renderSidebar(); return rest[1] ? viewOpsDisputeDetail(rest[1]) : viewOpsDisputes(); }
    /* Part 7.2 — the holiday calendar lives inside Acquirer Onboarding now.
       The old top-level route still resolves, straight onto that tab. */
    if (head === 'holidays') {
      S.opsActive = 'ops-onboarding'; S.ops.onboardTab = 'holidays'; renderSidebar();
      return viewOnboardHolidays();
    }
    S.opsActive = 'ops-home'; renderSidebar(); return viewOpsHome();
  }

  /* ---- 5.1 Ops Home ------------------------------------------------------- */
  function viewOpsHome() {
    var k = O.kpis;
    // cross-tenant status strip
    var strip = O.tenants.map(function (t) {
      var h = O.tenantHealth(t);
      return '<div class="ops-tenant-pill ' + h.kind + '" data-route="' + h.goto + '?' + h.set.replace(/;/g, '&').replace(/:/g, '=') + '">' +
        '<span class="st-dot" style="background:' + t.color + '"></span><span class="st-name">' + t.name + '</span> · <span class="st-status">' + h.text + '</span></div>';
    }).join('');

    /* Round 3 §A.1 / §A.2 — four cards. Active Tenants is gone: a number that
       changes twice a year carries no operational signal. The Total
       Transactions sparkline is gone too — the card is a count, and the trend
       behind it belongs to the cross-tenant grid below. */
    var kpis =
      kpiCard({ tile: 'blue', icon: 'activity', label: 'Transactions processed', value: num(k.totalTxnsMTD), sub: 'Month to date, all tenants' }) +
      kpiCard({
        tile: 'green', icon: 'indian-rupee', label: 'Volume (INR-equivalent)', value: fmtCr(k.totalMtdINR),
        sub: 'Month to date · converted at 1 SGD = ₹61.5, 1 HKD = ₹10.7, 1 AUD = ₹55.2, 1 MYR = ₹19.6',
        title: 'Aggregated across tenants at 1 SGD = ₹61.5, 1 HKD = ₹10.7, 1 AUD = ₹55.2, 1 MYR = ₹19.6 (rates as of prototype date)'
      }) +
      kpiCard({ tile: 'orange', icon: 'check-square', label: 'Merchant fee approvals', value: k.pendingApprovals, sub: 'Review queue ' + icon('arrow-right', 12), route: '#/dashboard/ops/approvals?approvalTab=pending' }) +
      kpiCard({ tile: 'purple', icon: 'life-buoy', label: 'Open disputes', value: k.openDisputes, sub: 'Across the portfolio ' + icon('arrow-right', 12), route: '#/dashboard/ops/disputes' });

    /* Cross-tenant cycle status grid — four legs per cell (CLR / STL / INC /
       JV2), each cutoff aware, with its own cycle-date stepper. It now caps at
       four tenants and promotes any tenant with a problem into that set
       (Part 2.1); the rule lives in CycleUI because that is where the leg
       states are. The section owns its own mount, so stepping the date never
       re-renders the rest of this page. */
    var matrix = CYCUI.gridSection();

    /* ---- Action queues (Part 2.3) -----------------------------------------
       Ordered by operational priority: merchant fees, then outgoing files,
       then incoming files, then acquirer onboarding — and onboarding renders
       ONLY when the first three are empty. It is genuinely last: it occupies
       space only when nothing more urgent exists.

       Every row goes to the specific item, pre-filtered, never to a generic
       list. */
    var pend = O.feeApprovals.filter(function (a) { return a.status === 'Pending'; })
      .sort(function (a, b) { return (48 - a.submittedHoursAgo) - (48 - b.submittedHoursAgo); });
    var feeRows = pend.slice(0, 5).map(function (a) {
      var left = 48 - a.submittedHoursAgo;
      return queueItem('#/dashboard/ops/approvals/' + a.id,
        tenantTag(a.tenantId) + ' · ' + esc(a.merchant.split(' - ')[0]),
        a.submittedHoursAgo + 'h ago · ' + slaBadge(left));
    });
    var rejectedFees = O.feeApprovals.filter(function (a) { return a.status === 'Rejected'; }).slice(0, 2).map(function (a) {
      return queueItem('#/dashboard/ops/approvals/' + a.id,
        tenantTag(a.tenantId) + ' · ' + esc(a.merchant.split(' - ')[0]),
        'Rejected · awaiting resubmission');
    });
    var feeQueue = feeRows.concat(rejectedFees);

    /* Outgoing: clearing files awaiting staging, staging proof overdue and
       generation failures — the three states Part 2.3 names. */
    var outRows = window.NETFILES.outgoingIssues(3).slice(0, 5).map(function (rec) {
      var st = window.NETFILES.OUT_STATES[rec.state];
      return queueItem('#/dashboard/ops/network-files/outgoing/' + esc(rec.id),
        tenantTag(rec.tenantId) + ' · ' + esc(rec.networkName) + ' clearing',
        '<span class="mono qi-cycle">' + esc(rec.id) + '</span> · ' + pill(st.label, st.kind, st.icon));
    });
    /* Acquirer report delivery problems belong to the same outgoing queue —
       both are files that should have left and did not. */
    var reportRows = window.SFILES.issues(7).slice(0, 3).map(function (f) {
      var bad = f.delivery === 'Failed';
      var what = bad ? pill('Delivery failed', 'danger') : (f.validation === 'Mismatch' ? pill('Validation mismatch', 'danger') : pill('Not shared', 'warning'));
      return queueItem('#/dashboard/ops/files?filesTenant=' + f.tenantId + '&filesDate=' + f.date,
        tenantTag(f.tenantId) + ' · ' + f.type, U.prettyDate(f.date) + ' · ' + what);
    });
    var outQueue = outRows.concat(reportRows);

    /* Incoming: files awaiting fetch, parse failures, records not yet pushed
       to tables. */
    var inQueue = window.NETFILES.incomingIssues(3).slice(0, 5).map(function (rec) {
      var st = window.NETFILES.IN_STATES[rec.state];
      return queueItem('#/dashboard/ops/network-files/incoming/' + esc(rec.id),
        tenantTag(rec.tenantId) + ' · ' + esc(rec.networkName) + ' incoming',
        '<span class="mono qi-cycle">' + esc(rec.id) + '</span> · ' + pill(st.label, st.kind, st.icon));
    });

    var provisioning = O.onboardingTenants.filter(function (t) { return t.status === 'Provisioning'; });
    var onbQueue = provisioning.map(function (t) {
      return queueItem('#/dashboard/ops/onboarding/' + t.id, tenantTag(t.id), t.country + ' · Provisioning');
    });

    var cols = [];
    cols.push(queueCol('Merchant fee issues', '#/dashboard/ops/approvals', feeQueue, 'No merchant fee issues.'));
    cols.push(queueCol('Outgoing file issues', '#/dashboard/ops/network-files/outgoing', outQueue, 'No outgoing file issues.'));
    cols.push(queueCol('Incoming file issues', '#/dashboard/ops/network-files/incoming', inQueue, 'No incoming file issues.'));
    // Queue 4 only exists when 1–3 are all empty.
    var urgent = feeQueue.length + outQueue.length + inQueue.length;
    if (!urgent) cols.push(queueCol('Acquirer onboarding', '#/dashboard/ops/onboarding', onbQueue, 'No tenants provisioning.'));

    // rejections summary
    var rejBreak = O.tenants.map(function (t) {
      var rb = k.rejByTenant[t.id];
      return t.name + ' (' + fmt(rb.amount, 0, t.currency) + ', ' + rb.count + ')';
    }).join(' · ');
    var rejCard = '<div class="callout warn clickable-callout" data-route="#/dashboard/ops/rejects">' + icon('alert-triangle', 20) +
      '<div class="callout-body"><strong>' + k.rejTotalCount + ' rejections unresolved · ~' + fmtCr(k.rejTotalINR) + '</strong>' +
      '<div class="meta" style="margin-top:4px">' + rejBreak + '</div></div>' + icon('chevron-right', 18) + '</div>';

    setView(
      pageHead('Operations Overview', 'Platform status across all ' + O.tenants.length + ' tenants for ' + U.prettyLong(D.TODAY) + '.') +
      '<div class="ops-status-strip">' + strip + '</div>' +
      // Round 3 §A.3 — KPI rows wrap on their own rather than overflowing:
      // repeat(auto-fit, minmax(240px, 1fr)) via .kpi-row.
      '<div class="kpi-row mb-16">' + kpis + '</div>' +
      '<div class="mt-16">' + matrix + '</div>' +
      '<div class="section-title mb-16 mt-24">Action queues</div>' +
      '<div class="grid grid-' + cols.length + ' queue-grid">' + cols.join('') + '</div>' +
      '<div class="mt-24">' + rejCard + '</div>'
    );
  }
  function queueItem(route, title, meta) {
    return '<div class="queue-item" data-route="' + route + '">' +
      '<div class="qi-body"><div class="qi-title">' + title + '</div>' +
      '<div class="qi-meta">' + meta + '</div></div>' +
      '<span class="qi-arrow">' + icon('chevron-right', 16) + '</span></div>';
  }
  function queueCol(title, allRoute, items, empty) {
    return '<div class="queue-col"><div class="qc-head">' + esc(title) +
      '<a class="btn-ghost" data-route="' + allRoute + '">All ' + icon('arrow-right', 13) + '</a></div>' +
      (items.length ? items.join('') : '<div class="meta">' + esc(empty) + '</div>') + '</div>';
  }

  /* ---- 5.2a Merchant Fees queue ------------------------------------------- */
  function approvalStatusKind(s) { return { Pending: 'warning', Approved: 'success', Rejected: 'danger' }[s] || 'neutral'; }

  /* Part 3.2 — the four fields the brief names, case-insensitive and partial.
     The MID is matched with its spaces stripped as well as with them, because
     nobody types "4021 8817 40219" and everybody types "40218817". */
  function approvalMatches(a, q) {
    var tenant = (O.tenantById[a.tenantId] || {}).name || a.tenantId;
    var mid = String(a.mid || '');
    var hay = [a.merchant, mid, mid.replace(/\s+/g, ''), a.submittedBy, tenant].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  /* §A.2 — tenant summary tiles.
     The queue table alone made the analyst scan rows to work out where the
     work is. The tiles put the per-tenant load up front so approvals can be
     batched by tenant, and carry the SLA signal for that tenant's worst case.
     A tenant with nothing pending is still shown — its absence would read as a
     missing tenant rather than an empty queue — but recessive and inert. */
  function approvalTiles() {
    var pending = O.feeApprovals.filter(function (a) { return a.status === 'Pending'; });
    var sel = S.ops.approvalsTenant;
    function tile(id, name, count, sub, worstLeft) {
      var zero = count === 0;
      var active = sel === id;
      var sla = '';
      if (!zero && worstLeft != null) {
        if (worstLeft <= 4) sla = '<span class="appr-sla red" title="' + esc('Closest approval is ' + (worstLeft <= 0 ? Math.abs(worstLeft) + 'h past its 48h SLA' : worstLeft + 'h from its 48h SLA breach')) + '">' + icon('alert-circle', 12) + (worstLeft <= 0 ? 'overdue' : worstLeft + 'h left') + '</span>';
        else if (worstLeft <= 12) sla = '<span class="appr-sla amber" title="' + esc('Closest approval is ' + worstLeft + 'h from its 48h SLA breach') + '">' + icon('clock', 12) + worstLeft + 'h left</span>';
      }
      return '<button type="button" class="appr-tile' + (active ? ' active' : '') + (zero ? ' muted' : '') + '" ' +
        (zero ? 'disabled' : 'data-action="ops-approval-tile" data-tenant="' + id + '"') +
        ' title="' + esc(zero ? name + ' has no pending merchant fee changes' : 'Filter the queue to ' + name) + '">' +
        '<span class="appr-tile-head">' + (id === 'all'
          ? '<span class="tenant-tag"><span class="tenant-dot" style="background:var(--text-tertiary)"></span>' + name + '</span>'
          : tenantTag(id)) + sla + '</span>' +
        '<span class="appr-tile-count num">' + count + '</span>' +
        '<span class="appr-tile-sub">' + esc(sub) + '</span></button>';
    }
    var allWorst = pending.length ? Math.min.apply(null, pending.map(function (a) { return 48 - a.submittedHoursAgo; })) : null;
    var tiles = tile('all', 'All tenants', pending.length, 'pending across the platform', allWorst);
    tiles += O.tenants.map(function (t) {
      var mine = pending.filter(function (a) { return a.tenantId === t.id; });
      var worst = mine.length ? Math.min.apply(null, mine.map(function (a) { return 48 - a.submittedHoursAgo; })) : null;
      return tile(t.id, t.name, mine.length, t.country, worst);
    }).join('');
    /* Part 3.1 — the row wraps on its own (auto-fit, minmax(180px, 1fr)) rather
       than assuming four tenants. Past eight, region subtext is dropped and the
       tiles compress to name and count: at that width the subtext is the first
       thing that stops being readable and the last thing anyone reads. */
    return '<div class="appr-tiles' + (O.tenants.length > 8 ? ' dense' : '') + '">' + tiles + '</div>';
  }

  function viewApprovals() {
    var tab = S.ops.approvalTab;
    var counts = { pending: 0, approved: 0, rejected: 0 };
    O.feeApprovals.forEach(function (a) { counts[a.status.toLowerCase()]++; });
    var tabBar = '<div class="tabs">' + [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(function (t) {
      return '<button class="tab ' + (tab === t[0] ? 'active' : '') + '" data-action="ops-approval-tab" data-tab="' + t[0] + '">' + t[1] + '<span class="count">' + counts[t[0]] + '</span></button>';
    }).join('') + '</div>';

    /* PART 3.2 — the search box used to be inert (action 'noop'). It filters
       now, and it filters IN ADDITION to the tile and the SLA chip rather than
       replacing them: a tenant tile plus a merchant name is a perfectly normal
       thing to want, and a search that silently cleared the tile would be
       answering a question nobody asked. */
    var q = (S.ops.approvalsQuery || '').trim().toLowerCase();
    var list = O.feeApprovals.filter(function (a) { return a.status.toLowerCase() === tab; });
    if (S.ops.approvalsTenant !== 'all') list = list.filter(function (a) { return a.tenantId === S.ops.approvalsTenant; });
    if (S.ops.approvalsSla === 'overdue') list = list.filter(function (a) { return (48 - a.submittedHoursAgo) <= 0; });
    else if (S.ops.approvalsSla === 'approaching') list = list.filter(function (a) { var l = 48 - a.submittedHoursAgo; return l > 0 && l < 24; });
    if (q) list = list.filter(function (a) { return approvalMatches(a, q); });

    var body;
    if (!list.length) body = '<div class="card">' + emptyState('inbox', 'No ' + tab + ' approvals',
      q ? 'Nothing matches “' + esc(S.ops.approvalsQuery.trim()) + '” with the current filters.'
        : 'Nothing matches the current filters. Clear them to see the whole queue.',
      '<button class="btn btn-secondary" data-action="ops-approval-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    else {
      var rows = list.map(function (a) {
        var left = 48 - a.submittedHoursAgo;
        return '<tr class="clickable" data-route="#/dashboard/ops/approvals/' + a.id + '">' +
          '<td>' + tenantTag(a.tenantId) + '</td>' +
          '<td><div class="cell-main">' + esc(a.merchant) + '</div><div class="cell-sub">MID ' + a.mid + '</div></td>' +
          '<td class="cell-sub">' + esc(a.submittedBy) + '</td>' +
          '<td class="nowrap">' + a.submittedHoursAgo + 'h ago</td>' +
          '<td>' + (a.status === 'Pending' ? slaBadge(left) : pill(a.status, approvalStatusKind(a.status))) + '</td>' +
          '<td class="cell-sub">' + esc(a.changeSummary) + '</td>' +
          '<td><button class="btn btn-primary btn-sm" data-route="#/dashboard/ops/approvals/' + a.id + '">Review</button></td>' +
          // Part 1.2 — the row navigates, so it grows a chevron on hover.
          '<td class="row-go">' + icon('chevron-right', 16) + '</td></tr>';
      }).join('');
      body = tableCard('<table class="data"><thead><tr><th>Tenant</th><th>Merchant</th><th>Submitted by</th><th>Submitted</th><th>' + (tab === 'pending' ? 'SLA' : 'Status') + '</th><th>Change summary</th><th></th><th></th></tr></thead><tbody>' + rows + '</tbody></table>');
    }

    // Part 3.3 — the standard filter row: search, then categorical filters,
    // then refresh. Active filters show as removable chips beneath.
    var chips = [];
    if (S.ops.approvalsTenant !== 'all') {
      var tn = (O.tenantById[S.ops.approvalsTenant] || {}).name || S.ops.approvalsTenant;
      chips.push({ label: 'Tenant: ' + tn, action: 'ops-approval-tile', data: ' data-tenant="all"' });
    }
    if (S.ops.approvalsSla !== 'all') chips.push({ label: 'SLA: ' + S.ops.approvalsSla, action: 'ops-approval-sla-clear' });
    // The search shows as a removable chip like every other active filter, so
    // an empty queue is never a mystery.
    if (q) chips.push({ label: 'Search: ' + S.ops.approvalsQuery.trim(), action: 'ops-approval-search-clear' });

    setView(
      pageHead('Merchant Fees',
        'Approve or reject merchant fee changes submitted by bank users.') +
      approvalTiles() + tabBar +
      opsFilterRow({
        search: { placeholder: 'Search merchant, MID, submitter or tenant', action: 'ops-approval-search', value: S.ops.approvalsQuery || '' },
        filters: [
          { action: 'ops-approval-tenant', value: S.ops.approvalsTenant, label: 'Tenant', options: [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; })) },
          { action: 'ops-approval-sla', value: S.ops.approvalsSla, label: 'SLA', options: [['all', 'Any SLA'], ['approaching', 'Approaching breach'], ['overdue', 'Overdue']] }
        ],
        refresh: 'ops-refresh',
        chips: chips
      }) +
      '<div class="mt-16">' + body + '</div>'
    );
  }

  /* ---- 5.2b Approval detail (diff + P&L) ---------------------------------- */
  function diffColumn(rules, otherByKey, side) {
    return rules.map(function (r) {
      var other = otherByKey[O.ruleKey(r)], cls = 'unchanged', tag = '';
      if (!other) { cls = side === 'left' ? 'removed' : 'added'; tag = cls; }
      else if (other.pct !== r.pct) { cls = 'modified'; tag = 'modified'; }
      return '<div class="diff-rule ' + cls + '"><span class="dr-text">' + r.network + ' ' + r.cardType + '</span><span class="dr-text">' + r.region + '</span><span class="dr-text">' + r.txnType + '</span><span class="dr-num">' + r.pct.toFixed(2) + '%</span><span>' + (tag ? '<span class="diff-tag ' + tag + '">' + tag + '</span>' : '') + '</span></div>';
    }).join('');
  }
  function viewApprovalDetail(id) {
    var a = O.feeApprovals.find(function (x) { return x.id === id; });
    if (!a) { setView('<div class="card">' + emptyState('search-x', 'Approval not found', 'This request does not exist.', '<button class="btn btn-secondary" data-route="#/dashboard/ops/approvals">Back to queue</button>') + '</div>'); return; }
    var t = O.tenantById[a.tenantId];
    var left = 48 - a.submittedHoursAgo;
    var currentByKey = {}, proposedByKey = {};
    a.current.forEach(function (r) { currentByKey[O.ruleKey(r)] = r; });
    a.proposed.forEach(function (r) { proposedByKey[O.ruleKey(r)] = r; });

    var banner = '';
    if (a.status === 'Approved') banner = '<div class="callout" style="background:var(--status-success-bg);color:var(--status-success-fg);border:1px solid #BBF7D0;margin-bottom:18px">' + icon('check-circle', 20) + '<div class="callout-body"><strong>Approved.</strong> Effective ' + U.prettyDate(a.effective) + '.</div></div>';
    if (a.status === 'Rejected') banner = '<div class="callout danger" style="margin-bottom:18px">' + icon('x-circle', 20) + '<div class="callout-body"><strong>Rejected.</strong> ' + esc(a.rejectionReason || '') + '</div></div>';

    var plRows = a.pl.perNet.map(function (p) { return '<tr><td>' + p.network + '</td><td class="num" style="color:' + (p.delta >= 0 ? 'var(--chart-positive)' : 'var(--chart-negative)') + '">' + (p.delta >= 0 ? '+' : '') + fmt(p.delta, 0, a.pl.currency) + '</td></tr>'; }).join('');

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/approvals">Merchant Fees</a><span class="sep">/</span><span>' + a.id + '</span></div>' +
      pageHead(esc(a.merchant),
        tenantTag(a.tenantId, true) + ' · MID ' + a.mid + ' · submitted by ' + esc(a.submittedBy) + ' ' + a.submittedHoursAgo + 'h ago ' +
        (a.status === 'Pending' ? slaBadge(left) : pill(a.status, approvalStatusKind(a.status)))) +
      banner +
      '<div class="section-title mb-16">Configuration diff</div>' +
      '<div class="grid grid-2">' +
      '<div class="card pad-sm"><div class="diff-head" style="padding:0 0 10px;font-weight:600">Current active configuration</div><div class="diff-rule" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);background:none"><span>Rule</span><span>Region</span><span>Txn</span><span class="dr-num">MDR</span><span></span></div>' + diffColumn(a.current, proposedByKey, 'left') + '</div>' +
      '<div class="card pad-sm" style="border-color:var(--primary)"><div class="diff-head" style="padding:0 0 10px;font-weight:600;color:var(--primary-subtle-fg)">Proposed configuration</div><div class="diff-rule" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);background:none"><span>Rule</span><span>Region</span><span>Txn</span><span class="dr-num">MDR</span><span></span></div>' + diffColumn(a.proposed, currentByKey, 'right') + '</div>' +
      '</div>' +
      '<div class="mt-16"><span class="diff-tag added">added</span> new rule &nbsp; <span class="diff-tag modified">modified</span> rate change &nbsp; <span class="diff-tag removed">removed</span> rule dropped</div>' +

      '<div class="section-title mb-16 mt-24">P&amp;L impact</div>' +
      '<div class="impact-panel" style="margin-bottom:16px"><div class="ip-icon">' + icon('trending-up', 22) + '</div><div><div class="meta">Based on this merchant\'s last 30 days of volume</div><div class="ip-value">' + (a.pl.totalDelta >= 0 ? '+' : '') + fmt(a.pl.totalDelta, 0, a.pl.currency) + ' ' + (a.pl.totalDelta >= 0 ? 'additional revenue' : 'reduced revenue') + ' <span style="font-size:14px">(' + (a.pl.pctRel >= 0 ? '+' : '') + a.pl.pctRel.toFixed(1) + '% relative to current)</span></div></div></div>' +
      cardBox('Per-network revenue delta', '<div class="table-wrap" style="max-width:420px"><table class="data"><thead><tr><th>Network</th><th class="num">Δ Revenue</th></tr></thead><tbody>' + plRows + '</tbody></table></div>') +

      '<div class="grid grid-2 mt-24">' +
      cardBox('Bank submitter\'s reason', '<blockquote style="border-left:3px solid var(--border-strong);padding:8px 14px;color:var(--text-secondary);font-style:italic">“' + esc(a.reason) + '”</blockquote>') +
      cardBox('Reviewer notes' + (a.status === 'Pending' ? ' <span class="meta">(required to reject)</span>' : ''), '<textarea class="input" id="reviewerNotes" placeholder="Ops analyst notes…">' + esc(a.reviewerNotes || '') + '</textarea>') +
      '</div>' +

      (a.status === 'Pending' ? '<div class="row mt-24" style="justify-content:flex-end;gap:10px"><button class="btn btn-secondary" data-action="ops-reject" data-id="' + a.id + '">' + icon('x', 16) + 'Reject</button><button class="btn btn-primary" data-action="ops-approve" data-id="' + a.id + '">' + icon('check', 16) + 'Approve</button></div>' : '<div class="row mt-24" style="justify-content:flex-end"><button class="btn btn-secondary" data-route="#/dashboard/ops/approvals">Back to queue</button></div>')
    );
  }

  /* ======================================================================== *
     5.3 RECONCILIATION (refinement Part 4 — rebuilt)

     THE MODEL, AND WHY THE OLD ONE WAS WRONG.

     What reconciles is the GROSS SALE AMOUNT. We submit ₹100 gross and the
     network reports ₹100 gross back:

         Submitted  −  Received  =  Difference        (expected: zero)

     Fees do not reduce that figure. They arrive as separate columns in the
     incoming file, often as negative values, and are reported alongside the
     gross rather than deducted from it. The previous screen subtracted an
     "expected fees" figure to produce a residual, which meant a healthy cycle
     showed a large non-zero number that somebody had to talk themselves out
     of every day. Both concepts are gone: any non-zero difference here is a
     genuine break.

     ONE SCREEN, NOT TWO (Part 4.3). Recon Files is merged in — this is the
     recon history table plus a side panel carrying the progress steps and the
     figures for the selected cycle.
     ======================================================================== */
  S.recon = { q: '', tenant: 'all', network: 'all', preset: '7', from: null, to: null, open: null };

  function reconRange() {
    var f = S.recon;
    if (f.preset === 'range' && f.from && f.to) return { from: f.from, to: f.to, label: U.prettyDate(f.from) + ' – ' + U.prettyDate(f.to) };
    if (f.preset === '1') return { from: O.CYCLE_TODAY, to: O.CYCLE_TODAY, label: 'Current cycle · ' + U.prettyDate(O.CYCLE_TODAY) };
    var days = parseInt(f.preset, 10) || 7;
    return { from: U.addDays(O.CYCLE_TODAY, -(days - 1)), to: O.CYCLE_TODAY, label: 'Last ' + days + ' cycles' };
  }

  var RECON_PILL = {
    'Reconciled': ['Reconciled', 'success', 'check-circle'],
    'Difference found': ['Difference found', 'danger', 'alert-octagon'],
    'Awaiting incoming': ['Awaiting incoming', 'neutral', 'clock'],
    'Running': ['Running', 'info', 'loader']
  };
  function reconPill(status) {
    var m = RECON_PILL[status] || RECON_PILL['Awaiting incoming'];
    return pill(m[0], m[1], m[2]);
  }
  var RECON_NET_CLASS = { visa: 'visa', mc: 'mc', rupay: 'rupay' };
  /* The short code, not the full name. Ten columns compete for the row and
     Status — the one that says whether this cycle is a problem — has to stay on
     screen; the badge's colour already carries the network identity, so the
     extra characters buy nothing. Same vocabulary as the cycle grid. */
  function reconNetBadge(row) {
    var net = O.NET_BY_KEY[row.networkKey] || { short: row.networkName };
    return '<span class="rej-net ' + (RECON_NET_CLASS[row.networkKey] || 'mc') + '" ' +
      'title="' + esc(row.networkName) + '">' + esc(net.short || row.networkName) + '</span>';
  }
  /* A difference of zero is the expected outcome, so it reads green; anything
     else reads red. An awaiting cycle has no difference at all — computing one
     against a file that has not arrived would invent a break. */
  function differenceCell(row, cur) {
    if (row.difference == null) return '<span class="recon-empty">—</span>';
    return '<span class="num recon-diff ' + (row.difference === 0 ? 'zero' : 'break') + '">' + fmt(row.difference, 2, cur) + '</span>';
  }
  function shortAt(at) {
    if (!at) return '';
    var p = String(at).split(', ');
    return p[0].replace(/ \d{4}$/, '') + ' ' + (p[1] || '').replace(' IST', '');
  }

  function reconVisible() {
    var f = S.recon, rg = reconRange(), q = (f.q || '').toLowerCase();
    return O.reconRows.filter(function (row) {
      if (row.date < rg.from || row.date > rg.to) return false;
      if (f.tenant !== 'all' && row.tenantId !== f.tenant) return false;
      if (f.network !== 'all' && row.networkKey !== f.network) return false;
      if (q && (row.id + ' ' + row.tenantName).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function reconTable(rows) {
    if (!rows.length) {
      return '<div class="card">' + emptyState('git-compare', 'No cycles in this view',
        'Widen the cycle range, or clear the tenant and network filters.',
        '<button class="btn btn-secondary" data-action="rc-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var body = rows.map(function (row) {
      var cur = row.currency;
      var open = S.recon.open === row.id;
      return '<tr class="clickable' + (open ? ' recon-row-open' : '') +
        (row.status === 'Difference found' ? ' recon-row-break' : '') + '" ' +
        'data-action="rc-open" data-id="' + esc(row.id) + '" tabindex="0">' +
        '<td>' + cycleIdCell(row.id, row.date) + '</td>' +
        '<td>' + tenantTag(row.tenantId) + '</td>' +
        '<td>' + reconNetBadge(row) + '</td>' +
        /* The gross figures run to eight digits, where the paisa is noise; the
           DIFFERENCE is the number that has to be exact, so it alone keeps its
           decimals. That is also what makes a non-zero difference visually
           distinct from the two columns it came from. */
        '<td class="num">' + fmt(row.submitted, 0, cur) + '</td>' +
        '<td class="num">' + (row.received == null ? '<span class="recon-empty">—</span>' : fmt(row.received, 0, cur)) + '</td>' +
        '<td class="num">' + differenceCell(row, cur) + '</td>' +
        '<td class="num">' + (row.received == null ? '<span class="recon-empty">—</span>' : num(row.matched)) + '</td>' +
        '<td class="num">' + (row.received == null
          ? '<span class="recon-empty">—</span>'
          : (row.unmatched ? '<span class="recon-unmatched">' + num(row.unmatched) + '</span>' : '0')) + '</td>' +
        '<td>' + reconPill(row.status) + '</td>' +
        '<td class="recon-go">' + icon('chevron-right', 16) + '</td></tr>';
    }).join('');
    return '<div class="table-card"><div class="table-wrap"><table class="data recon-table"><thead><tr>' +
      '<th>Cycle</th><th>Tenant</th><th>Network</th>' +
      '<th class="num">Submitted</th><th class="num">Received</th><th class="num">Difference</th>' +
      '<th class="num">Matched</th><th class="num">Unmatched</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  /* ---- the side panel (Part 4.3) ------------------------------------------
     Progress steps, then the three figures, then the fees as their own block.
     Nothing in the arithmetic touches the fees, and the one permitted line of
     explanatory text says so — it prevents a genuine misreading rather than
     narrating the interface. */
  function reconSteps(row) {
    return '<div class="recon-steps">' + row.steps.map(function (s) {
      var ic = s.state === 'done' ? 'check-circle' : (s.state === 'failed' ? 'alert-octagon' : (s.state === 'active' ? 'circle-dot' : 'circle'));
      return '<div class="recon-step ' + s.state + '">' +
        '<span class="recon-step-ic">' + icon(ic, 17) + '</span>' +
        '<span class="recon-step-name">' + esc(s.name) + '</span>' +
        '<span class="recon-step-at num">' + (s.at ? esc(shortAt(s.at)) : '') + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }
  function reconFigures(row) {
    var cur = row.currency;
    function line(label, value, cls) {
      return '<div class="recon-fig ' + (cls || '') + '"><span class="recon-fig-label">' + esc(label) + '</span>' +
        '<span class="recon-fig-val num">' + value + '</span></div>';
    }
    var verdict = row.difference == null
      ? '<span class="recon-verdict await">' + icon('clock', 14) + 'Awaiting incoming</span>'
      : (row.difference === 0
        ? '<span class="recon-verdict ok">' + icon('check', 14) + 'Reconciled</span>'
        : '<span class="recon-verdict bad">' + icon('alert-octagon', 14) + 'Difference found</span>');
    return '<div class="recon-figures">' +
      line('Submitted', fmt(row.submitted, 2, cur)) +
      line('Received', row.received == null ? '<span class="recon-empty">—</span>' : fmt(row.received, 2, cur)) +
      '<div class="recon-fig total ' + (row.difference === 0 ? 'zero' : (row.difference == null ? 'await' : 'break')) + '">' +
      '<span class="recon-fig-label">Difference</span>' +
      '<span class="recon-fig-val num">' + (row.difference == null ? '<span class="recon-empty">—</span>' : fmt(row.difference, 2, cur)) + '</span>' +
      verdict + '</div>' +
      '</div>';
  }
  function reconFees(row) {
    var cur = row.currency;
    return '<div class="recon-fees">' +
      '<div class="recon-fees-head">Fees reported in the incoming file</div>' +
      '<div class="recon-fees-note">Reported alongside the gross amount. Not part of the reconciliation.</div>' +
      '<div class="recon-fee-row"><span>Interchange</span><span class="num">' + fmt(row.fees.interchange, 0, cur) + '</span></div>' +
      '<div class="recon-fee-row"><span>Scheme fees</span><span class="num">' + fmt(row.fees.scheme, 0, cur) + '</span></div>' +
      '<div class="recon-fee-row total"><span>Total</span><span class="num">' + fmt(row.fees.total, 0, cur) + '</span></div>' +
      '</div>';
  }
  /* PART 4.5 — only the cycles that actually received data. Usually that is
     one row. It is never six placeholders, because six placeholders say the
     platform is waiting on five things it may never be waiting on. */
  function reconIncoming(row) {
    if (!row.incomingCycles.length) {
      return '<div class="recon-sub"><div class="recon-sub-head">Incoming cycles</div>' +
        '<div class="meta">Nothing received yet for this cycle.</div></div>';
    }
    var rows = row.incomingCycles.map(function (ic) {
      return '<tr><td class="nowrap">Cycle ' + ic.n + '</td>' +
        '<td class="num">' + num(ic.count) + ' txns</td>' +
        '<td class="num">' + fmt(ic.amount, 2, row.currency) + '</td>' +
        '<td class="nowrap cell-sub num">' + esc(shortAt(ic.receivedAt)) + '</td>' +
        '<td class="recon-got">' + icon('check', 14) + '</td></tr>';
    }).join('');
    return '<div class="recon-sub"><div class="recon-sub-head">Incoming cycles received</div>' +
      '<table class="data recon-cyc"><tbody>' + rows + '</tbody></table>' +
      (row.moreExpected ? '<div class="recon-more">Further cycles may still arrive.</div>' : '') +
      '</div>';
  }
  function reconClearing(row) {
    /* The same rule on the clearing leg: the cycles actually staged, nothing
       more. A cycle that was never cut has no row here. */
    var cyc = (O.cyclesByTenant[row.tenantId] || []).filter(function (c) { return c.date === row.date; })[0];
    var staged = cyc ? cyc.clearingCycles.filter(function (cc) { return cc.networkKey === row.networkKey; }) : [];
    if (!staged.length) {
      return '<div class="recon-sub"><div class="recon-sub-head">Clearing cycles staged</div>' +
        '<div class="meta">Nothing staged for this cycle yet.</div></div>';
    }
    var rows = staged.map(function (cc) {
      return '<tr><td class="nowrap">Cycle ' + cc.seq + '</td>' +
        '<td class="num">' + num(cc.count) + ' txns</td>' +
        '<td class="num">' + fmt(cc.amount, 2, row.currency) + '</td>' +
        '<td class="nowrap cell-sub num">' + esc(shortAt(cc.stagedAt)) + '</td>' +
        '<td class="recon-got">' + icon('check', 14) + '</td></tr>';
    }).join('');
    return '<div class="recon-sub"><div class="recon-sub-head">Clearing cycles staged</div>' +
      '<table class="data recon-cyc"><tbody>' + rows + '</tbody></table></div>';
  }
  function reconLinks(row) {
    var links = [
      '<a data-route="#/dashboard/ops/network-files/outgoing/' + esc(row.id) + '">' + icon('upload', 14) +
      'Outgoing file for this cycle' + icon('arrow-right', 13) + '</a>',
      '<a data-route="#/dashboard/ops/network-files/incoming/' + esc(row.id) + '">' + icon('download', 14) +
      'Incoming file for this cycle' + icon('arrow-right', 13) + '</a>'
    ];
    if (row.rejections) {
      links.push('<a data-route="#/dashboard/ops/rejects?rejTenant=' + esc(row.tenantId) +
        '&rejDate=' + esc(row.date) + '&rejFamily=incoming">' + icon('file-warning', 14) +
        num(row.rejections.count) + ' rejections in this cycle' + icon('arrow-right', 13) + '</a>');
    }
    return '<div class="recon-links">' + links.join('') + '</div>';
  }
  function reconPanel(row) {
    var t = O.tenantById[row.tenantId];
    /* PART 4.4 — recon fires automatically off push-to-tables. Re-run exists
       only for the case the brief names: a re-parse has happened and the
       figures need reading again. */
    var foot = '<div class="row" style="justify-content:space-between;align-items:center;gap:10px">' +
      '<span class="meta">' + (row.rerunAt
        ? 'Re-run ' + esc(row.rerunAt) + ' by ' + esc(row.rerunBy)
        : 'Runs automatically once the incoming file is pushed to tables.') + '</span>' +
      '<button class="btn btn-secondary btn-sm" data-action="rc-rerun" data-id="' + esc(row.id) + '">' +
      icon('refresh-cw', 15) + 'Re-run</button></div>';
    return sidePanel({
      eyebrow: t.name + ' · ' + row.networkName + ' · ' + U.prettyDate(row.date),
      name: '<span class="mono recon-panel-id">' + esc(row.id) + '</span>',
      body: reconSteps(row) + reconFigures(row) + reconFees(row) +
        reconClearing(row) + reconIncoming(row) + reconLinks(row),
      foot: foot, close: 'rc-close', cls: 'recon-panel'
    });
  }
  function paintReconPanel() {
    var mount = el('overlay-mount');
    if (!mount) return;
    var row = S.recon.open ? O.reconRow(S.recon.open) : null;
    mount.innerHTML = row ? reconPanel(row) : '';
    if (window.lucide) lucide.createIcons();
  }

  function viewOpsRecon() {
    /* Deep links arrive from the Cycle Snapshot and the incoming file record
       carrying a tenant and sometimes a cycle. */
    if (S.ops.reconTenant && O.tenantById[S.ops.reconTenant]) S.recon.tenant = S.ops.reconTenant;
    if (S.ops.reconCycle && O.reconRow(S.ops.reconCycle)) {
      S.recon.open = S.ops.reconCycle;
      S.recon.preset = 'all';
      S.ops.reconCycle = null;
    }
    var rows = reconVisible();
    var rg = reconRange();
    var netKeys = {};
    O.tenants.forEach(function (t) { O.netsFor(t.id).forEach(function (n) { netKeys[n.key] = n.name; }); });

    var filters = opsFilterRow({
      search: { placeholder: 'Search cycle or tenant', action: 'rc-i-q', value: S.recon.q || '' },
      filters: [
        { action: 'rc-tenant', value: S.recon.tenant, label: 'Tenant', options: [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; })) },
        { action: 'rc-network', value: S.recon.network, label: 'Network', options: [['all', 'All networks']].concat(Object.keys(netKeys).map(function (k) { return [k, netKeys[k]]; })) }
      ],
      preset: {
        action: 'rc-preset', value: S.recon.preset,
        options: [['1', 'Current cycle'], ['7', 'Last 7 cycles'], ['30', 'Last 30 cycles'], ['range', 'Custom range']]
      },
      /* The preset names the span; this resolves it to actual dates. Repeating
         the preset's own label here would be two controls saying one thing. */
      dateRange: (S.recon.preset === 'range'
        ? '<input type="date" data-action="rc-from" value="' + (S.recon.from || rg.from) + '" aria-label="From" />' +
        '<span class="meta">–</span>' +
        '<input type="date" data-action="rc-to" value="' + (S.recon.to || rg.to) + '" aria-label="To" />'
        : '<span>' + esc(U.prettyDate(rg.from) + (rg.from === rg.to ? '' : ' – ' + U.prettyDate(rg.to))) + '</span>') + icon('chevron-down', 16),
      refresh: 'rc-refresh'
    });

    var breaks = rows.filter(function (r) { return r.status === 'Difference found'; }).length;
    setView(
      pageHead('Reconciliation', 'Gross amounts submitted to the network against gross amounts received back.') +
      filters +
      '<div class="sf-scope meta">Showing <strong>' + rows.length + '</strong> cycle' + (rows.length === 1 ? '' : 's') +
      ' · ' + esc(rg.label) +
      (breaks ? ' · <strong class="recon-scope-break">' + breaks + ' with a difference</strong>' : '') + '</div>' +
      reconTable(rows)
    );
    paintReconPanel();
  }
  function repaintRecon() { if (location.hash.indexOf('/ops/reconciliation') >= 0) viewOpsRecon(); }

  /* ---- 5.4 Acquirer Reports -----------------------------------------------
     Rebuilt as its own module (files-data.js + files-screen.js) in refinement
     round 2 §C: the network dimension is gone, the row key is
     tenant × cycle date × file type, and each row carries two independent
     statuses plus five actions. Routed above via SFUI.route(). */

  /* ======================================================================== *
     5.5 ACQUIRER ONBOARDING (refinement Part 7)

     Renamed from Bank Onboarding — "acquirer" is what these tenants are called
     everywhere else in the portal, and two names for one thing is one too many.

     The holiday calendar moved here from Ops Home (Part 7.2). It belongs with
     the acquirers because that is what a holiday is about: a region where an
     acquirer operates, on a day nothing settles. Its country filter is built
     from the countries of onboarded acquirers, so a new region appears in it
     the moment that acquirer is onboarded rather than when somebody remembers
     to edit a list.
     ======================================================================== */
  function onbTabs(tab) {
    return '<div class="tabs">' +
      [['acquirers', 'Acquirers', O.onboardingTenants.length], ['holidays', 'Holiday calendar', O.holidays.length]]
        .map(function (t) {
          return '<button class="tab ' + (tab === t[0] ? 'active' : '') + '" data-action="onb-tab" data-tab="' + t[0] + '">' +
            t[1] + '<span class="count num">' + t[2] + '</span></button>';
        }).join('') + '</div>';
  }

  function viewOnboardingList() {
    var tab = S.ops.onboardTab || 'acquirers';
    if (tab === 'holidays') return viewOnboardHolidays();
    var rows = O.onboardingTenants.map(function (t) {
      var stKind = t.status === 'Active' ? 'success' : (t.status === 'Provisioning' ? 'warning' : 'neutral');
      return '<tr class="clickable" data-route="#/dashboard/ops/onboarding/' + t.id + '">' +
        '<td>' + tenantTag(t.id) + '</td><td>' + t.flag + ' ' + t.country + '</td><td>' + t.currency + '</td><td class="nowrap">' + U.prettyDate(t.onboarded) + '</td>' +
        '<td>' + t.networks.map(function (n) { return '<span class="file-badge badge-MPR" style="margin-right:3px;background:var(--status-neutral-bg);color:var(--status-neutral-fg)">' + n + '</span>'; }).join('') + '</td>' +
        '<td>' + pill(t.status, stKind) + '</td>' +
        '<td class="row-go">' + icon('chevron-right', 16) + '</td></tr>';
    }).join('');
    setView(
      pageHead('Acquirer Onboarding', 'Every acquirer live on the platform, and the ones still being provisioned.',
        '<button class="btn btn-primary" data-route="#/dashboard/ops/onboarding/new">' + icon('plus', 18) + 'Onboard new acquirer</button>') +
      onbTabs('acquirers') +
      tableCard('<table class="data"><thead><tr><th>Acquirer</th><th>Country</th><th>Currency</th><th>Onboarded</th><th>Networks</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>')
    );
  }

  /* ---- 5.5b Holiday calendar (Part 7.2) ----------------------------------- */
  function holidayFlag(country) {
    return { India: '🇮🇳', Singapore: '🇸🇬', 'Hong Kong': '🇭🇰', Australia: '🇦🇺', Malaysia: '🇲🇾' }[country] || '🏳️';
  }
  function holidayImpactKind(impact) {
    return impact === 'Full holiday' ? 'danger' : (impact === 'Half day' ? 'warning' : 'neutral');
  }
  function holidayList() {
    var country = S.ops.holidayCountry;
    return O.holidays.filter(function (h) { return country === 'All' ? true : h.country === country; });
  }
  function viewOnboardHolidays() {
    var view = S.ops.holidayView;
    /* Part 7.2 — the country list is derived, never hardcoded. Onboard an
       acquirer in a new region and its country is in this filter immediately. */
    var countries = ['All'].concat(O.onboardedCountries());
    var list = holidayList();

    var toggle = '<div class="sf-group" role="radiogroup" aria-label="View">' +
      [['list', 'List'], ['calendar', 'Calendar']].map(function (o) {
        var on = view === o[0];
        return '<button type="button" class="sf-group-btn' + (on ? ' active' : '') + '" ' +
          'data-action="holiday-view" data-view="' + o[0] + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
          o[1] + '</button>';
      }).join('') + '</div>';

    var filters = opsFilterRow({
      filters: [{ action: 'holiday-ops-country', value: S.ops.holidayCountry, label: 'Country', options: countries }],
      refresh: 'ops-refresh',
      extra: '<div style="flex:1"></div>' + toggle +
        '<button class="btn btn-primary" data-action="hol-add-open">' + icon('plus', 16) + 'Add holiday</button>'
    }) + '<div class="mb-16"></div>';

    var body;
    if (view === 'list') {
      var rows = list.map(function (h, i) {
        var d = U.fromYmd(h.date);
        return '<tr><td class="nowrap">' + U.prettyDate(h.date) + '</td><td>' + U.DOW[d.getUTCDay()] + '</td>' +
          '<td>' + esc(h.name) + '</td><td>' + holidayFlag(h.country) + ' ' + esc(h.country) + '</td>' +
          '<td>' + pill(h.impact, holidayImpactKind(h.impact)) + '</td>' +
          '<td class="hol-edit"><button class="icon-btn xs" data-action="hol-edit-open" data-date="' + esc(h.date) +
          '" data-name="' + esc(h.name) + '" data-country="' + esc(h.country) + '" ' +
          'title="Edit ' + esc(h.name) + '" aria-label="Edit ' + esc(h.name) + '">' + icon('pencil', 15) + '</button></td></tr>';
      }).join('');
      body = rows
        ? tableCard('<table class="data hol-table"><thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Country</th><th>Impact</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>')
        : '<div class="card">' + emptyState('calendar-x', 'No holidays for this region yet',
          'A newly onboarded acquirer starts with an empty calendar. Add its holidays so cycles are not expected on days nothing settles.',
          '<button class="btn btn-primary" data-action="hol-add-open">' + icon('plus', 18) + 'Add holiday</button>') + '</div>';
    } else {
      body = holidayCalendar(list);
    }

    setView(
      pageHead('Acquirer Onboarding', 'Every acquirer live on the platform, and the ones still being provisioned.',
        '<button class="btn btn-primary" data-route="#/dashboard/ops/onboarding/new">' + icon('plus', 18) + 'Onboard new acquirer</button>') +
      onbTabs('holidays') + filters + body
    );
    paintHolidayEditor();
  }

  /* A month grid per region-month that actually has holidays, rather than one
     fixed illustrative month — a calendar that always shows December is not a
     calendar. */
  function holidayCalendar(list) {
    var months = {}, order = [];
    list.forEach(function (h) {
      var d = U.fromYmd(h.date);
      var key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!months[key]) { months[key] = []; order.push(key); }
      months[key].push(h);
    });
    order.sort();
    if (!order.length) {
      return '<div class="card">' + emptyState('calendar-x', 'No holidays for this region yet',
        'Add the region’s holidays and they appear here.',
        '<button class="btn btn-primary" data-action="hol-add-open">' + icon('plus', 18) + 'Add holiday</button>') + '</div>';
    }
    return '<div class="hol-months">' + order.slice(0, 6).map(function (key) {
      var year = +key.split('-')[0], month = +key.split('-')[1] - 1;
      var first = new Date(Date.UTC(year, month, 1));
      var startDow = first.getUTCDay();
      var daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      var byDay = {};
      months[key].forEach(function (h) { (byDay[U.fromYmd(h.date).getUTCDate()] = byDay[U.fromYmd(h.date).getUTCDate()] || []).push(h); });
      var cells = '';
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) { cells += '<div class="cal-head">' + d + '</div>'; });
      for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell muted"></div>';
      for (var day = 1; day <= daysInMonth; day++) {
        var hs = byDay[day];
        var full = hs && hs.some(function (h) { return h.impact === 'Full holiday'; });
        cells += '<div class="cal-cell ' + (hs ? (full ? 'holiday' : 'halfday') : '') + '">' +
          '<div class="cal-day">' + day + '</div>' +
          (hs ? hs.map(function (h) {
            return '<div class="cal-name" title="' + esc(h.name + ' · ' + h.country + ' · ' + h.impact) + '">' +
              holidayFlag(h.country) + ' ' + esc(h.name) + '</div>';
          }).join('') : '') + '</div>';
      }
      return cardBox(U.MON[month] + ' ' + year, '<div class="cal-grid">' + cells + '</div>');
    }).join('') + '</div>' +
      '<div class="hol-legend"><span class="hol-lg full"></span>full holiday' +
      '<span class="hol-lg half"></span>half day</div>';
  }

  /* Add / edit, because a new region needs its calendar populated and a wrong
     date needs correcting. In memory only. */
  function paintHolidayEditor() {
    var mount = el('overlay-mount');
    if (!mount) return;
    var e = S.ops.holidayEdit;
    if (!e) { mount.innerHTML = ''; return; }
    var countries = O.onboardedCountries();
    var valid = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && (e.name || '').trim().length > 1;
    mount.innerHTML = '<div class="overlay" data-action="hol-cancel"><div class="modal hol-modal">' +
      '<div class="modal-head"><div class="section-title">' + (e.editing ? 'Edit holiday' : 'Add holiday') + '</div>' +
      '<button class="icon-btn" data-action="hol-cancel" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="stack">' +
      field('Date', '<input class="input" type="date" data-action="hol-c-date" value="' + esc(e.date || '') + '" />', true) +
      field('Holiday name', '<input class="input" data-action="hol-i-name" value="' + esc(e.name || '') + '" placeholder="e.g. Anzac Day" />', true) +
      field('Country', '<select class="input" data-action="hol-c-country">' + countries.map(function (c) {
        return '<option value="' + esc(c) + '"' + (e.country === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select>', true) +
      field('Impact', '<select class="input" data-action="hol-c-impact">' + ['Full holiday', 'Half day', 'Clearing only'].map(function (o) {
        return '<option value="' + o + '"' + (e.impact === o ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>', true) +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px">' +
      '<button class="btn btn-secondary" data-action="hol-cancel">Cancel</button>' +
      '<button class="btn btn-primary"' + (valid ? '' : ' disabled') + ' data-action="hol-save">' +
      icon('check', 16) + (e.editing ? 'Save changes' : 'Add holiday') + '</button></div>' +
      '</div></div></div>';
    if (window.lucide) lucide.createIcons();
  }

  function viewTenantDetail(tenantId) {
    var t = O.onboardingById[tenantId];
    if (!t) { setView('<div class="card">' + emptyState('search-x', 'Tenant not found', 'No such tenant.', '<button class="btn btn-secondary" data-route="#/dashboard/ops/onboarding">Back</button>') + '</div>'); return; }
    var stKind = t.status === 'Active' ? 'success' : (t.status === 'Provisioning' ? 'warning' : 'neutral');
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/onboarding">Acquirer Onboarding</a><span class="sep">/</span><span>' + esc(t.name) + '</span></div>' +
      pageHead(tenantTag(t.id), t.flag + ' ' + t.country + ' · ' + t.currency + ' · onboarded ' + U.prettyDate(t.onboarded) + ' ' + pill(t.status, stKind)) +
      '<div class="grid grid-2">' +
      cardBox('Identity', '<dl class="def-list"><dt>Legal name</dt><dd>' + esc(t.legalName) + '</dd><dt>Primary contact</dt><dd>' + esc(t.contact) + '</dd><dt>Data region</dt><dd>' + esc(t.address) + '</dd></dl>') +
      cardBox('Currency & settlement', '<dl class="def-list"><dt>Currency</dt><dd>' + t.currency + '</dd><dt>Settlement account</dt><dd>' + t.settleAcct + '</dd></dl>') +
      cardBox('Networks & BIN ranges', '<div class="mb-16">' + t.networks.map(function (n) { return pill(n, 'primary'); }).join(' ') + '</div><dl class="def-list"><dt>BIN ranges</dt><dd class="mono">' + t.bins + '</dd></dl>') +
      cardBox('Network rule set', '<dl class="def-list"><dt>Assigned rule set</dt><dd class="mono">' + t.ruleSet + '</dd></dl><pre style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin-top:10px">{\n  "ruleSet": "' + t.ruleSet + '",\n  "networks": ' + JSON.stringify(t.networks) + ',\n  "readOnly": true\n}</pre>') +
      '</div>' +
      '<div class="mt-24">' + cardBox('Configuration history', '<div class="meta mb-16">Append-only — a correction nullifies the prior entry, it never deletes it.</div>' + immutableTimeline(O.configHistory[t.id])) + '</div>'
    );
  }
  var ONB_STEPS = ['Acquirer Identity', 'Currency & Settlement Account', 'Networks & BIN Ranges', 'Network Rule Set Assignment', 'Review & Activate'];
  function viewOnboardNew() {
    var step = S.ops.onboardStep;
    var stepsHtml = ONB_STEPS.map(function (s, i) {
      var cls = (i + 1 === step) ? 'active' : (i + 1 < step ? 'done' : '');
      return '<div class="step ' + cls + '"><div class="step-line"></div><div class="step-num">' + (i + 1 < step ? '✓' : (i + 1)) + '</div><div class="step-label">' + s + '</div></div>';
    }).join('');
    var body;
    if (step === 1) body = '<div class="grid grid-2">' + field('Legal name', '<input class="input" id="obName" placeholder="e.g. Axis Bank Ltd" />', true) + field('Country', '<select class="input"><option>India</option><option>Singapore</option><option>Hong Kong</option></select>', true) + field('Primary contact', '<input class="input" placeholder="onboarding@bank.com" />', true) + field('Registered address', '<input class="input" placeholder="City, data region" />', true) + '</div>';
    else if (step === 2) body = '<div class="grid grid-2">' + field('Settlement currency', '<select class="input"><option>INR</option><option>SGD</option><option>HKD</option></select>', true) + field('Settlement bank account', '<input class="input" placeholder="Account number" />', true) + field('SWIFT / IFSC', '<input class="input" placeholder="Routing code" />', true) + field('Nostro account', '<input class="input" placeholder="Nostro reference" />') + '</div>';
    else if (step === 3) body = '<div class="stack"><div class="field">Enable networks <span class="req">*</span><div class="row" style="gap:20px;margin-top:8px">' + ['Visa', 'Mastercard', 'RuPay', 'HSBC ONUS'].map(function (n) { return '<label style="display:flex;gap:8px;align-items:center;font-weight:500;color:var(--text-primary)"><input type="checkbox" checked /> ' + n + '</label>'; }).join('') + '</div></div>' + field('BIN ranges (per network)', '<input class="input" placeholder="e.g. 4571xx, 5412xx" />') + '</div>';
    else if (step === 4) body = '<div class="stack">' + field('Network rule set', '<select class="input"><option>RULESET-IN-STD-v3</option><option>RULESET-SG-STD-v2</option><option>RULESET-HK-STD-v2</option><option>RULESET-GLOBAL-v1</option></select>', true) + '<div class="callout info">' + icon('info', 20) + '<div class="callout-body">Rule sets carry the interchange and scheme fee tables. Cycle timing is platform-level.</div></div></div>';
    else body = '<div class="stack"><div class="callout info">' + icon('info', 20) + '<div class="callout-body">Activating creates the tenant in <strong>Provisioning</strong>.</div></div><dl class="def-list"><dt>Legal name</dt><dd>Axis Bank Ltd</dd><dt>Country</dt><dd>India</dd><dt>Currency</dt><dd>INR</dd><dt>Networks</dt><dd>Visa, Mastercard, RuPay, HSBC ONUS</dd><dt>Rule set</dt><dd>RULESET-IN-STD-v3</dd></dl></div>';
    var nav = '<div class="row" style="justify-content:space-between;margin-top:24px">' + (step > 1 ? '<button class="btn btn-secondary" data-action="ops-onboard-prev">' + icon('arrow-left', 16) + 'Back</button>' : '<span></span>') + (step < 5 ? '<button class="btn btn-primary" data-action="ops-onboard-next">Continue' + icon('arrow-right', 16) + '</button>' : '<button class="btn btn-primary" data-action="ops-onboard-activate">' + icon('check', 16) + 'Activate tenant</button>') + '</div>';
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/onboarding">Acquirer Onboarding</a><span class="sep">/</span><span>Onboard new acquirer</span></div>' +
      pageHead('Onboard new acquirer', 'Step ' + step + ' of 5 — ' + ONB_STEPS[step - 1] + '.') +
      '<div class="steps">' + stepsHtml + '</div><div class="card">' + body + nav + '</div>'
    );
  }

  /* ---- 5.6 Dispute Ops Support -------------------------------------------- */
  function viewOpsDisputes() {
    var tf = S.ops.disputesTenant, uf = S.ops.disputesUrgency;
    var list = O.disputes.filter(function (d) {
      if (tf !== 'all' && d.tenantId !== tf) return false;
      if (uf === '<7 days' && !(d.deadlineDays < 7 && d.status !== 'Won' && d.status !== 'Lost')) return false;
      if (uf === '<3 days' && !(d.deadlineDays < 3 && d.status !== 'Won' && d.status !== 'Lost')) return false;
      // The stage chip used to be inert; it filters now (Part 3.3).
      if (S.ops.disputesStage !== 'all' && d.stage !== S.ops.disputesStage) return false;
      return true;
    });
    var byTenant = {};
    list.forEach(function (d) { (byTenant[d.tenantId] = byTenant[d.tenantId] || []).push(d); });
    var groups = O.tenants.filter(function (t) { return byTenant[t.id]; }).map(function (t) {
      var ds = byTenant[t.id];
      var rows = ds.map(function (d) {
        var urg = d.deadlineDays < 3 ? 'danger' : (d.deadlineDays < 7 ? 'warning' : 'neutral');
        var stKind = { 'Action Required': 'warning', 'In Representment': 'info', 'Awaiting Network': 'info', 'Won': 'success', 'Lost': 'danger' }[d.status] || 'neutral';
        return '<tr class="clickable" data-route="#/dashboard/ops/disputes/' + d.id + '">' +
          '<td><div class="cell-main nowrap">' + d.id + '</div><div class="cell-sub mono">' + d.arn.replace(/•+/, '••') + '</div></td>' +
          '<td>' + esc(d.merchant) + '</td><td>' + d.network + '</td><td class="nowrap">' + d.stage + '</td>' +
          '<td><div class="cell-main">' + d.reasonCode + '</div><div class="cell-sub" style="max-width:128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.reasonDesc) + '</div></td>' +
          '<td class="num">' + fmt(d.amount, 2, d.currency) + '</td><td class="nowrap">' + U.prettyDate(d.received) + '</td>' +
          '<td>' + pill(U.prettyDate(d.deadline) + ' · ' + d.deadlineDays + 'd', urg) + '</td><td>' + pill(d.status, stKind) + '</td>' +
          '<td class="row-go">' + icon('chevron-right', 16) + '</td></tr>';
      }).join('');
      return '<div class="dispute-group-head">' + tenantTag(t.id) + '<span class="count-badge">' + ds.length + '</span></div>' +
        tableCard('<table class="data"><thead><tr><th>Dispute</th><th>Merchant</th><th>Network</th><th>Stage</th><th>Reason</th><th class="num">Amount</th><th>Received</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>');
    }).join('');

    setView(
      pageHead('Dispute Ops Support', 'Disputes across every tenant, with the ones closest to their deadline first.') +
      opsFilterRow({
        search: { placeholder: 'Search dispute ID, merchant or ARN', action: 'noop', value: '' },
        filters: [
          { action: 'ops-disp-tenant', value: tf, label: 'Tenant', options: [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; })) },
          { action: 'ops-disp-stage', value: S.ops.disputesStage, label: 'Stage', options: [['all', 'All stages'], 'First Chargeback', 'Second Presentment', 'Arbitration', 'Pre-Arb'] },
          { action: 'ops-disp-urgency', value: uf, label: 'Deadline', options: [['<7 days', 'Due in under 7 days'], ['<3 days', 'Due in under 3 days'], ['all', 'Any deadline']] }
        ],
        refresh: 'ops-refresh'
      }) +
      '<div class="mt-16">' + (groups || '<div class="card">' + emptyState('shield-check', 'No disputes match these filters',
        'Widen the deadline filter or clear the tenant filter to see the full list.',
        '<button class="btn btn-secondary" data-action="ops-disp-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>') + '</div>'
    );
  }
  function viewOpsDisputeDetail(id) {
    var d = O.disputeById[id];
    if (!d) { setView('<div class="card">' + emptyState('search-x', 'Dispute not found', 'No such dispute.', '<button class="btn btn-secondary" data-route="#/dashboard/ops/disputes">Back</button>') + '</div>'); return; }
    var urg = d.deadlineDays < 3 ? 'danger' : (d.deadlineDays < 7 ? 'warning' : 'neutral');
    var tl = '<div class="timeline">' + d.timeline.map(function (s, i) {
      var cls = s.done ? 'done' : (i === d.timeline.findIndex(function (x) { return !x.done; }) ? 'current' : '');
      return '<div class="tl-step ' + cls + '"><div class="tl-line"></div><div class="tl-node">' + icon(s.done ? 'check' : 'circle', 15) + '</div><div class="tl-label">' + s.stage + '</div><div class="tl-date">' + U.prettyDate(s.date) + '</div><div class="tl-amt">' + fmt(s.amount, 2, d.currency) + '</div></div>';
    }).join('') + '</div>';
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/disputes">Dispute Ops Support</a><span class="sep">/</span><span>' + d.id + '</span></div>' +
      pageHead(d.id, tenantTag(d.tenantId) + ' · ' + esc(d.merchant) + ' · ' + d.network + ' · ' + fmt(d.amount, 2, d.currency) + ' ' +
        pill(d.stage, 'info') + ' ' + pill('Deadline ' + U.prettyDate(d.deadline), urg, 'clock')) +
      cardBox('Lifecycle', tl) +
      '<div class="grid grid-2 mt-24">' +
      cardBox('Original transaction', '<dl class="def-list"><dt>Transaction date</dt><dd>' + U.prettyDate(d.txnDate) + '</dd><dt>Amount</dt><dd>' + fmt(d.amount, 2, d.currency) + '</dd><dt>Card BIN</dt><dd class="mono">' + d.bin + '</dd><dt>Auth code</dt><dd>' + d.authCode + '</dd><dt>ARN</dt><dd class="mono">' + d.arn + '</dd></dl>') +
      cardBox('Reason code', '<div class="strong" style="font-size:16px">' + d.reasonCode + ' · ' + d.reasonDesc + '</div><div class="meta mt-16">Financial impact: ' + fmt(d.amount, 2, d.currency) + ' debited from ' + O.tenantById[d.tenantId].name + ' settlement.</div>') +
      '</div>' +
      '<div class="grid grid-2 mt-24">' +
      cardBox('Bank-facing notes', d.bankNotes.map(function (n) { return '<div class="file-row"><div class="file-name">' + esc(n.text) + '<div class="file-meta">' + n.at + ' · ' + n.by + '</div></div></div>'; }).join('')) +
      cardBox('Juspay-internal notes <span class="pill pill-primary" style="margin-left:6px">ops only</span>', d.opsNotes.map(function (n) { return '<div class="file-row"><div class="file-name">' + esc(n.text) + '<div class="file-meta">' + n.at + ' · ' + n.by + '</div></div></div>'; }).join('') + '<div class="mt-16">' + field('Add internal note', '<textarea class="input" placeholder="Ops-only note (not visible to the bank)…"></textarea>') + '<div class="row mt-16" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" data-action="toast" data-msg="Internal note added">Add note</button></div></div>') +
      '</div>'
    );
  }

  /* ======================================================================== *
     HANDLERS (event delegation)
     ======================================================================== */
  var ACTIONS = {
    'toggle-sidebar': function () { S.sidebarCollapsed = !S.sidebarCollapsed; el('app').classList.toggle('collapsed', S.sidebarCollapsed); renderSidebar(); },
    'toggle-section': function (t, e) { e.stopPropagation(); var sec = t.getAttribute('data-section'); S.expanded[sec] = !S.expanded[sec]; renderSidebar(); },
    // Shell popovers (Part 2.1). Each closes the others — only one at a time.
    'rail-more': function () { S.railMenu = !S.railMenu; S.navContext = false; S.navUserMenu = false; renderRail(); renderSidebar(); },
    'nav-context': function () { S.navContext = !S.navContext; S.railMenu = false; S.navUserMenu = false; renderRail(); renderSidebar(); },
    'nav-user': function () { S.navUserMenu = !S.navUserMenu; S.railMenu = false; S.navContext = false; renderRail(); renderSidebar(); },
    'tab': function (t) { var g = t.getAttribute('data-tab-group'), tb = t.getAttribute('data-tab'); S.tabs[g] = tb; route(); },
    'toast': function (t) { toast(t.getAttribute('data-msg')); },
    'noop': function () { },
    'perf-range': function (t) { S.filters.perfRange = t.getAttribute('data-range'); route(); },
    'cycles-group': function (t) { S.filters.cyclesGroup = t.getAttribute('data-group'); route(); },
    'fb-group': function (t) { S.filters.feeBreakdownGroup = t.value; viewFeeBreakdown(); },
    'holiday-country': function (t) { S.filters.holidayCountry = t.value; viewHolidays(); },
    'filter-merchants': function (t) { S.filters.merchants.q = t.value; renderMerchantsTable(); var i = el('view').querySelector('[data-action=filter-merchants]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
    'filter-merchant-status': function (t) { S.filters.merchants.status = t.value; renderMerchantsTable(); },
    'filter-merchant-mcc': function (t) { S.filters.merchants.mcc = t.value; renderMerchantsTable(); },
    'clear-merchant-filters': function () { S.filters.merchants = { q: '', status: 'all', mcc: 'all' }; renderMerchantsTable(); },
    'add-next': function () { if (S.addStep < 8) { S.addStep++; viewAddMerchant(); } },
    'add-prev': function () { if (S.addStep > 1) { S.addStep--; viewAddMerchant(); } },
    'add-file': function () { S.addFiles.push('document_' + (S.addFiles.length + 1) + '.pdf'); toast('File added'); if (S.active.section === 'merchants' && S.addStep === 6) viewAddMerchant(); },
    'add-submit': function () { S.addStep = 1; toast('Merchant submitted — status: Under Review', 'success'); go('#/dashboard/bank/merchants'); },
    'propose-merchant': function (t) { S.proposeMid = t.value; S.tabs.feeConfigs = 'propose'; viewFeeConfigs(); },
    'fee-draft': function () { toast('Saved as draft'); },
    'fee-submit': function (t) {
      var reason = (el('view').querySelector('#proposeReason') || {}).value || '';
      if (reason.trim().length < 30) { toast('Reason must be at least 30 characters', 'info'); return; }
      var mid = t.getAttribute('data-mid'); var m = D.merchantById[mid]; var base = D.feeConfigs[mid][0];
      D.feeApprovals.unshift({
        id: 'FC-' + (4415 + D.feeApprovals.length), merchantId: mid, merchant: m.name,
        submittedBy: D.user.fullName, submittedAt: U.prettyDate(D.TODAY) + ', ' + '11:20 IST', submittedYmd: D.TODAY,
        effective: '2025-12-01', status: 'Under Review', reason: reason,
        rejectionReason: null, current: base, proposed: Object.assign({}, base, { pct: Math.round((base.pct + 0.15) * 100) / 100 }), network: base.network, cardType: base.cardType, changeType: 'increase'
      });
      toast('Submitted for approval — now in Pending Approvals', 'success');
      S.tabs.feeConfigs = 'pending'; viewFeeConfigs();
    },
    'fee-approve': function (t) {
      var id = t.getAttribute('data-fc'); var a = D.feeApprovals.find(function (x) { return x.id === id; });
      if (a) { a.status = 'Approved'; toast('Approved ' + id + ' — effective ' + U.prettyDate(a.effective), 'success'); }
      viewFeeConfigs();
    },
    'toggle-approval': function (t) { var id = t.getAttribute('data-fc'); var row = el('exp-' + id); if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none'; },
    'dispute-filter': function (t) { S.tabs.disputes = t.getAttribute('data-tab'); viewDisputes(); },
    'report-delivery': function (t) { S.reportDelivery = t.getAttribute('data-delivery'); },
    'generate-report': function () {
      var box = el('view').querySelector('#genProgress');
      if (box) {
        box.innerHTML = '<div class="meta mb-16">Generating…</div><div style="height:8px;background:var(--border-subtle);border-radius:999px;overflow:hidden"><div id="genBar" style="height:100%;width:0;background:var(--primary);transition:width .2s"></div></div>';
        var w = 0; var iv = setInterval(function () {
          w += 20; var bar = el('genBar'); if (bar) bar.style.width = w + '%';
          if (w >= 100) {
            clearInterval(iv);
            if (S.reportDelivery === 'SFTP') { S.reportError = true; viewReports(); }
            else { toast('Report generated — added to Library', 'success'); S.tabs.reports = 'library'; S.loading.reports = false; viewReports(); }
          }
        }, 200);
      }
    },
    'retry-generate': function () { S.reportError = false; toast('Retrying delivery…'); S.tabs.reports = 'library'; S.loading.reports = false; viewReports(); },
    'open-add-user': function () { openAddUser(); },
    'close-overlay': function () { closeOverlay(); },
    'save-user': function () { toast('User invited', 'success'); closeOverlay(); },

    /* ---- Ops Portal handlers ---- */
    'ops-approval-tab': function (t) { S.ops.approvalTab = t.getAttribute('data-tab'); viewApprovals(); },
    'ops-approval-tenant': function (t) { S.ops.approvalsTenant = t.value; viewApprovals(); },
    'ops-approval-tile': function (t) { S.ops.approvalsTenant = t.getAttribute('data-tenant'); viewApprovals(); },
    'ops-approval-sla': function (t) { S.ops.approvalsSla = t.value; viewApprovals(); },
    'ops-approval-sla-clear': function () { S.ops.approvalsSla = 'all'; viewApprovals(); },
    'ops-approval-clear': function () { S.ops.approvalsTenant = 'all'; S.ops.approvalsSla = 'all'; S.ops.approvalsQuery = ''; viewApprovals(); },
    /* Debounced ~200ms: re-rendering the whole queue on every keystroke made
       the input lose its own caret on long lists. The timer is cleared on each
       keystroke so only the pause re-renders. */
    'ops-approval-search': function (t) {
      S.ops.approvalsQuery = t.value;
      if (_apprDebounce) clearTimeout(_apprDebounce);
      _apprDebounce = setTimeout(function () {
        _apprDebounce = null;
        viewApprovals();
        var i = el('view').querySelector('[data-action="ops-approval-search"]');
        if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { } }
      }, 200);
    },
    'ops-approval-search-clear': function () { S.ops.approvalsQuery = ''; viewApprovals(); },
    // Every standard filter row carries a refresh button (Part 3.3). There is
    // no backend to re-query, so it re-renders the current view.
    'ops-refresh': function () { route(); toast('Refreshed', 'success'); },
    'ops-approve': function (t) {
      var id = t.getAttribute('data-id'); var a = O.feeApprovals.find(function (x) { return x.id === id; });
      if (a) { a.status = 'Approved'; toast('Approved ' + id + ' — moved to Approved tab', 'success'); }
      S.ops.approvalTab = 'approved'; go('#/dashboard/ops/approvals');
    },
    'ops-reject': function (t) {
      var id = t.getAttribute('data-id'); var notes = (el('view').querySelector('#reviewerNotes') || {}).value || '';
      if (notes.trim().length < 5) { toast('Reviewer notes are required to reject', 'info'); return; }
      var a = O.feeApprovals.find(function (x) { return x.id === id; });
      if (a) { a.status = 'Rejected'; a.rejectionReason = notes; a.reviewerNotes = notes; toast('Rejected ' + id + ' — moved to Rejected tab', 'success'); }
      S.ops.approvalTab = 'rejected'; go('#/dashboard/ops/approvals');
    },
    /* ---- Reconciliation (Part 4) ---- */
    'rc-tenant': function (t) { S.recon.tenant = t.value; S.ops.reconTenant = t.value === 'all' ? null : t.value; viewOpsRecon(); },
    'rc-network': function (t) { S.recon.network = t.value; viewOpsRecon(); },
    'rc-preset': function (t) { S.recon.preset = t.value; viewOpsRecon(); },
    'rc-from': function (t) { S.recon.from = t.value; S.recon.preset = 'range'; viewOpsRecon(); },
    'rc-to': function (t) { S.recon.to = t.value; S.recon.preset = 'range'; viewOpsRecon(); },
    'rc-refresh': function () { viewOpsRecon(); toast('Refreshed', 'success'); },
    'rc-clear': function () {
      S.recon.q = ''; S.recon.tenant = 'all'; S.recon.network = 'all'; S.recon.preset = '30';
      S.ops.reconTenant = null; viewOpsRecon();
    },
    'rc-i-q': function (t) {
      S.recon.q = t.value; viewOpsRecon();
      var i = el('view').querySelector('[data-action="rc-i-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'rc-open': function (t) { S.recon.open = t.getAttribute('data-id'); viewOpsRecon(); },
    'rc-close': function () { S.recon.open = null; viewOpsRecon(); },
    /* The manual re-run (Part 4.4). It re-reads the same figures — a cycle that
       reconciled still reconciles — so it never invents a different answer. */
    'rc-rerun': function (t) {
      var row = O.reconRow(t.getAttribute('data-id')); if (!row) return;
      O.rerunRecon(row, OPS_USER);
      toast('Reconciliation re-run for ' + row.id, 'success');
      repaintRecon();
    },
    'ops-onboard-next': function () { if (S.ops.onboardStep < 5) { S.ops.onboardStep++; viewOnboardNew(); } },
    'ops-onboard-prev': function () { if (S.ops.onboardStep > 1) { S.ops.onboardStep--; viewOnboardNew(); } },
    'ops-onboard-activate': function () {
      var nm = (el('view').querySelector('#obName') || {}).value || 'New Bank Ltd';
      var id = 'prov-' + (O.onboardingTenants.length + 1);
      var t = { id: id, name: nm.replace(/ (Ltd|Limited)$/i, ''), country: 'India', currency: 'INR', color: '#0EA5E9', flag: '🇮🇳', status: 'Provisioning', onboarded: D.TODAY, networks: ['Visa', 'Mastercard', 'RuPay', 'HSBC ONUS'], legalName: nm, contact: 'onboarding@bank.com', address: 'ap-south-1 data region', settleAcct: '****0000', ruleSet: 'RULESET-IN-STD-v3', bins: '4571xx' };
      O.onboardingTenants.push(t); O.onboardingById[id] = t;
      O.configHistory[id] = [{ kind: 'normal', at: U.prettyDate(D.TODAY) + ', now', by: 'juspay-ops', text: 'Tenant provisioned — data region ap-south-1.' }];
      S.ops.onboardStep = 1; toast('Tenant activated — status: Provisioning', 'success'); go('#/dashboard/ops/onboarding');
    },
    'ops-disp-tenant': function (t) { S.ops.disputesTenant = t.value; viewOpsDisputes(); },
    'ops-disp-urgency': function (t) { S.ops.disputesUrgency = t.value; viewOpsDisputes(); },
    'ops-disp-stage': function (t) { S.ops.disputesStage = t.value; viewOpsDisputes(); },
    'ops-disp-clear': function () { S.ops.disputesTenant = 'all'; S.ops.disputesUrgency = 'all'; S.ops.disputesStage = 'all'; viewOpsDisputes(); },
    /* ---- Acquirer Onboarding + its holiday calendar (Part 7) ---- */
    'onb-tab': function (t) { S.ops.onboardTab = t.getAttribute('data-tab'); viewOnboardingList(); },
    'holiday-ops-country': function (t) { S.ops.holidayCountry = t.value; viewOnboardHolidays(); },
    'holiday-view': function (t) { S.ops.holidayView = t.getAttribute('data-view'); viewOnboardHolidays(); },
    'hol-add-open': function () {
      S.ops.holidayEdit = {
        editing: false, date: D.TODAY, name: '',
        country: O.onboardedCountries()[0] || 'India', impact: 'Full holiday'
      };
      paintHolidayEditor();
    },
    'hol-edit-open': function (t) {
      var date = t.getAttribute('data-date'), name = t.getAttribute('data-name'), country = t.getAttribute('data-country');
      var target = O.holidays.filter(function (h) { return h.date === date && h.name === name && h.country === country; })[0];
      if (!target) return;
      S.ops.holidayEdit = {
        editing: true, target: target,
        date: target.date, name: target.name, country: target.country, impact: target.impact
      };
      paintHolidayEditor();
    },
    'hol-cancel': function () { S.ops.holidayEdit = null; paintHolidayEditor(); },
    'hol-c-date': function (t) { if (S.ops.holidayEdit) { S.ops.holidayEdit.date = t.value; paintHolidayEditor(); } },
    'hol-i-name': function (t) {
      if (!S.ops.holidayEdit) return;
      S.ops.holidayEdit.name = t.value;
      paintHolidayEditor();
      var i = el('overlay-mount').querySelector('[data-action="hol-i-name"]');
      if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { } }
    },
    'hol-c-country': function (t) { if (S.ops.holidayEdit) { S.ops.holidayEdit.country = t.value; paintHolidayEditor(); } },
    'hol-c-impact': function (t) { if (S.ops.holidayEdit) { S.ops.holidayEdit.impact = t.value; paintHolidayEditor(); } },
    'hol-save': function () {
      var e = S.ops.holidayEdit; if (!e) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || (e.name || '').trim().length < 2) {
        toast('A date and a name are required', 'info'); return;
      }
      if (e.editing) {
        O.updateHoliday(e.target, { date: e.date, name: e.name.trim(), country: e.country, impact: e.impact });
        toast('Updated ' + e.name.trim(), 'success');
      } else {
        O.addHoliday({ date: e.date, name: e.name.trim(), country: e.country, impact: e.impact });
        toast('Added ' + e.name.trim() + ' — ' + e.country, 'success');
      }
      S.ops.holidayEdit = null;
      viewOnboardHolidays();
    }
  };

  /* ---- Platform Configs (Phase 3) ----------------------------------------
     The configs module is a separate file; it receives the shared design-system
     helpers from this shell so every screen renders with the same primitives. */
  var CFGKIT = {
    icon: icon, esc: esc, pill: pill, cardBox: cardBox, emptyState: emptyState, errorState: errorState,
    setView: setView, toast: toast, el: el, go: go, num: num, fmt: fmt, pct: pct,
    tenantTag: tenantTag, slaBadge: slaBadge,
    immutableEntry: immutableEntry, immutablePair: immutablePair, immutableTimeline: immutableTimeline,
    renderSidebar: renderSidebar, field: field,
    // Ops component library (overhaul Part 2.4 / 3.1 / 3.3) — one implementation,
    // reused by every Ops module.
    pageHead: pageHead, kpiCard: kpiCard, tableCard: tableCard, opsSelect: opsSelect,
    cycleIdCell: cycleIdCell, chart: chart,
    opsFilterRow: opsFilterRow, opsToggle: opsToggle, sidePanel: sidePanel, opsTimeline: opsTimeline,
    skeletonRows: skeletonRows, fmtCr: fmtCr
  };
  /* The file detail panel (file-detail brief Part 3) is built once and handed
     to every module that opens it through the same kit. That is what makes one
     component render identically in Acquirer Reports and the Cycle Snapshot —
     there is no second implementation. Network Files renders the same step
     pattern inline on its detail view (refinement Part 6.2). */
  var FDPANEL = window.FileDetailPanel(CFGKIT);
  CFGKIT.filePanel = FDPANEL;
  Object.keys(FDPANEL.actions).forEach(function (k) { ACTIONS[k] = FDPANEL.actions[k]; });

  var CFGUI = window.ConfigsUI(CFGKIT);
  var CFGQ = window.ConfigsQueue(CFGUI);
  Object.keys(CFGUI.actions).forEach(function (k) { ACTIONS[k] = CFGUI.actions[k]; });
  Object.keys(CFGQ.actions).forEach(function (k) { ACTIONS[k] = CFGQ.actions[k]; });
  // Rejects shares the same design-system kit.
  var REJUI = window.RejectsUI(CFGKIT);
  Object.keys(REJUI.actions).forEach(function (k) { ACTIONS[k] = REJUI.actions[k]; });
  // Cross-Tenant Cycle Status grid (Ops Home) + Cycle Snapshot drill-in.
  var CYCUI = window.CycleUI(CFGKIT);
  Object.keys(CYCUI.actions).forEach(function (k) { ACTIONS[k] = CYCUI.actions[k]; });
  // Acquirer Reports (refinement round 2 §C) — its own module now
  // that the screen carries two status dimensions and five row actions.
  var SFUI = window.FilesUI(CFGKIT);
  Object.keys(SFUI.actions).forEach(function (k) { ACTIONS[k] = SFUI.actions[k]; });
  // Network Files — the dashboard's record of work it cannot observe, in both
  // directions.
  var NFUI = window.NetFilesUI(CFGKIT);
  Object.keys(NFUI.actions).forEach(function (k) { ACTIONS[k] = NFUI.actions[k]; });
  // Platform Configs guided flows (Part 8) — one focused flow per task card.
  var CFGFLOW = window.ConfigFlowsUI(CFGKIT);
  Object.keys(CFGFLOW.actions).forEach(function (k) { ACTIONS[k] = CFGFLOW.actions[k]; });
  CFGUI.setFlows(CFGFLOW);

  function openAddUser() {
    el('overlay-mount').innerHTML = '<div class="overlay" data-action="close-overlay"><div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div class="section-title">Add user</div><button class="icon-btn" data-action="close-overlay">' + icon('x', 16) + '</button></div>' +
      '<div class="stack">' + field('Full name', '<input class="input" placeholder="e.g. Aarti Desai"/>', true) +
      field('Email', '<input class="input" placeholder="name@hsbc.co.in"/>', true) +
      field('Role', '<select class="input">' + D.roleDefs.map(function (r) { return '<option>' + r.role + '</option>'; }).join('') + '</select>', true) +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px"><button class="btn btn-secondary" data-action="close-overlay">Cancel</button><button class="btn btn-primary" data-action="save-user">Send invite</button></div></div></div></div>';
    if (window.lucide) lucide.createIcons();
  }
  function closeOverlay() { el('overlay-mount').innerHTML = ''; }

  /* ---- Delegated events --------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    // A click inside a side panel or modal must not walk up to the overlay
    // backdrop's own action (close) — but real actions inside it delegate
    // normally. This replaces the old inline stopPropagation on the panel,
    // which silenced every inner control.
    if (actionEl && actionEl.classList && actionEl.classList.contains('overlay') &&
      e.target.closest && e.target.closest('.side-panel, .modal')) {
      actionEl = null;
    }
    if (actionEl && ACTIONS[actionEl.getAttribute('data-action')]) {
      // Native form controls (<select>, text inputs, radios / checkboxes, <textarea>)
      // are driven by the 'change' / 'input' listeners below — never by click. Running
      // the action on click would preventDefault() and re-render the view (setView),
      // destroying the control the moment it is clicked — so a <select> dropdown could
      // never open and a radio could never check. Let those fall through to change/input.
      var tag = actionEl.tagName;
      if (tag === 'SELECT' || tag === 'OPTION' || tag === 'TEXTAREA' || tag === 'INPUT') return;
      e.preventDefault();
      ACTIONS[actionEl.getAttribute('data-action')](actionEl, e);
      return;
    }
    var routeEl = e.target.closest('[data-route]');
    if (routeEl) { e.preventDefault(); go(routeEl.getAttribute('data-route')); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target.closest('[data-action]'); if (!t) return;
    var a = t.getAttribute('data-action');
    // Configs: 'cfgi-*' actions are live-typing bindings (model update + targeted re-render).
    if (a.indexOf('cfgi-') === 0) { ACTIONS[a](t); return; }
    // Rejects: 'rej-i-*' actions are live-typing bindings — they update the
    // model and re-render only the affected region, so the input keeps focus.
    if (a.indexOf('rej-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Acquirer Reports: 'sf-i-*' are live-typing bindings too.
    if (a.indexOf('sf-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Network Files: 'nf-i-*' are live-typing bindings — the list search box
    // and the override reason, whose character count updates as you type.
    if (a.indexOf('nf-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Reconciliation: 'rc-i-*' — the recon history search box.
    if (a.indexOf('rc-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Platform Configs guided flows: 'cff-i-*' are live-typing bindings on the
    // step forms, which is what keeps Next's enabled state honest as you type.
    if (a.indexOf('cff-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Acquirer Onboarding holiday editor: 'hol-i-*'.
    if (a.indexOf('hol-i-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    if (a === 'filter-merchants') ACTIONS[a](t);
    // Merchant Fees search (Part 3.2) — debounced, and it filters rather than
    // replacing the tile selection.
    if (a === 'ops-approval-search') ACTIONS[a](t);
  });
  document.addEventListener('change', function (e) {
    var t = e.target.closest('[data-action]'); if (!t) return;
    var a = t.getAttribute('data-action');
    // Configs: 'cfgc-*' actions are select / checkbox / radio bindings.
    if (a.indexOf('cfgc-') === 0) { ACTIONS[a](t); return; }
    // Rejects: 'rej-c-*' actions are select / checkbox / date bindings.
    if (a.indexOf('rej-c-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Acquirer Reports: selects, date inputs and the upload file picker.
    if (a.indexOf('sf-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Network Files: selects, date inputs and the proof file picker.
    if (a.indexOf('nf-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Reconciliation: 'rc-*' selects and date inputs.
    if (a.indexOf('rc-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Platform Configs guided flows: 'cff-c-*' selects, radios and checkboxes.
    if (a.indexOf('cff-c-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    // Acquirer Onboarding holiday editor: 'hol-c-*'.
    if (a.indexOf('hol-c-') === 0 && ACTIONS[a]) { ACTIONS[a](t); return; }
    if (['filter-merchant-status', 'filter-merchant-mcc', 'fb-group', 'holiday-country', 'propose-merchant', 'report-delivery',
      'ops-approval-tenant', 'ops-approval-sla', 'ops-disp-tenant', 'ops-disp-urgency',
      'ops-disp-stage', 'holiday-ops-country'].indexOf(a) >= 0) ACTIONS[a](t);
  });
  // Tag inputs commit on Enter (Part 6.2 eligibility flags, Part 7.2 ack filenames).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target.closest('[data-action="cfg-tag-add"]');
    if (!t) return;
    e.preventDefault();
    ACTIONS['cfg-tag-add'](t);
  });
  // Rejects fix panel: validation runs on blur (focusout bubbles; blur does not).
  document.addEventListener('focusout', function (e) {
    if (!e.target || !e.target.closest) return;
    var t = e.target.closest('[data-action="rej-i-field"], [data-action="rej-c-field"]');
    if (t && ACTIONS['rej-blur-field']) ACTIONS['rej-blur-field'](t);
  });
  // Rejects fix panel: radio groups (fix-type cards, IRD chooser cards) follow
  // the standard pattern — arrows move and select, Space/Enter select. Buttons
  // get Space/Enter natively; the div-based IRD cards need it wired.
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest && e.target.closest('.rej-panel [role="radio"]');
    if (!t) return;
    var group = t.closest('[role="radiogroup"]');
    if (!group) return;
    var radios = [].slice.call(group.querySelectorAll('[role="radio"]'))
      .filter(function (x) { return !x.disabled && x.getAttribute('aria-disabled') !== 'true'; });
    var i = radios.indexOf(t);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      var n = radios[(i + 1) % radios.length];
      n.focus(); n.click();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      var p = radios[(i - 1 + radios.length) % radios.length];
      p.focus(); p.click();
    } else if ((e.key === ' ' || e.key === 'Enter') && t.tagName !== 'BUTTON') {
      e.preventDefault();
      t.click();
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); var s = el('globalSearch'); if (s) s.focus(); }
  });

  /* ---- Boot --------------------------------------------------------------- */
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', function () {
    if (!location.hash) location.hash = '#/dashboard/bank/home';
    else route();
  });
  // in case DOMContentLoaded already fired
  if (document.readyState !== 'loading') { if (!location.hash) location.hash = '#/dashboard/bank/home'; else route(); }
})();
