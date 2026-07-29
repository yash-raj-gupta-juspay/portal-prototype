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
    expanded: { merchants: true, reconciliation: true, 'ops-configs': true },
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
    query: {},
    ops: {
      approvalTab: 'pending', approvalsTenant: 'all', approvalsSla: 'all',
      reconTenant: null, reconCycle: null,
      filesTenant: 'hsbc-in', filesStatus: 'All',
      disputesTenant: 'all', disputesUrgency: '<7 days', disputesStage: 'all',
      onboardStep: 1, onboardFiles: [],
      holidayCountry: 'All', holidayView: 'list', holidayMonthIdx: 0
    }
  };
  var S = window.AppState;
  var O = window.OPS;
  var _charts = {};

  /* ---- Number / currency formatting (Part 6.6) ---------------------------- */
  function groupIndian(s) {
    s = String(s);
    if (s.length <= 3) return s;
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  function groupIntl(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var CUR_SYM = { INR: '₹', SGD: 'S$', HKD: 'HK$' };
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

  function pill(text, kind, ic) {
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
    { id: 'ops-approvals', label: 'Fee Config Approvals', icon: 'check-square', route: '#/dashboard/ops/approvals' },
    { id: 'ops-recon', label: 'Reconciliation', icon: 'git-compare', route: '#/dashboard/ops/reconciliation' },
    { id: 'ops-files', label: 'Settlement File Monitoring', icon: 'upload', route: '#/dashboard/ops/files' },
    { id: 'ops-ird', label: 'IRD Rejects', icon: 'shield-alert', route: '#/dashboard/ops/ird-rejects' },
    { id: 'ops-onboarding', label: 'Bank Onboarding', icon: 'building', route: '#/dashboard/ops/onboarding' },
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

  function renderSidebar() {
    var isOps = S.portal === 'ops';
    var a = S.active;
    var navList = isOps ? OPS_NAV : NAV;
    var html = '<div class="nav-scroll">';
    navList.forEach(function (item) {
      var isActiveSection = isOps ? (S.opsActive === item.id) : (a.section === item.id);
      if (!item.children) {
        html += '<div class="nav-item ' + (isActiveSection ? 'active' : '') + '" data-route="' + item.route + '" data-label="' + item.label + '" role="button" tabindex="0" aria-label="' + item.label + '">' +
          '<span class="nav-icon">' + icon(item.icon, 22) + '</span><span class="nav-label">' + item.label + '</span></div>';
      } else {
        var expanded = S.expanded[item.id];
        var activeChild = isOps ? S.opsChild : a.child;
        html += '<div class="nav-group ' + (expanded ? 'expanded' : '') + '">' +
          '<div class="nav-item ' + (isActiveSection && !activeChild ? 'active' : '') + '" data-route="' + item.route + '" data-label="' + item.label + '" role="button" tabindex="0">' +
          '<span class="nav-icon">' + icon(item.icon, 22) + '</span><span class="nav-label">' + item.label + '</span>' +
          '<span class="nav-chevron" data-action="toggle-section" data-section="' + item.id + '" aria-label="Toggle ' + item.label + '">' + icon('chevron-right', 16) + '</span></div>' +
          '<div class="nav-children">';
        item.children.forEach(function (ch) {
          var chActive = isActiveSection && activeChild === ch.id;
          html += '<div class="nav-item ' + (chActive ? 'active' : '') + (ch.noIcon ? ' no-icon' : '') + '" data-route="' + ch.route + '" data-label="' + (ch.full || ch.label) + '" title="' + (ch.full || ch.label) + '" role="button" tabindex="0">' +
            (ch.noIcon ? '' : '<span class="nav-icon">' + icon(ch.icon, 18) + '</span>') + '<span class="nav-label">' + ch.label + '</span></div>';
        });
        html += '</div></div>';
      }
    });
    html += '</div>';
    html += '<div class="sidebar-footer"><button class="collapse-btn" data-action="toggle-sidebar" aria-label="Collapse sidebar">' +
      icon(S.sidebarCollapsed ? 'panel-left-open' : 'panel-left-close', 20) + '<span class="nav-label">Collapse</span></button></div>';
    el('sidebar').innerHTML = html;
  }

  function renderTopbar() {
    var isBank = S.portal === 'bank';
    var tenantPill = isBank
      ? '<span class="tenant-pill">' + D.tenant.flag + ' <strong>HSBC IN</strong> <span class="tenant-region">:: ap-south-1</span></span>'
      : '<span class="tenant-pill">🌐 <strong>Juspay Ops</strong> <span class="tenant-region">:: All Tenants</span></span>';
    el('topbar').innerHTML =
      '<div class="logo"><span class="logo-mark">J</span> Juspay</div>' +
      '<div class="portal-toggle" role="tablist" aria-label="Portal switch">' +
      '<button class="' + (isBank ? 'active' : '') + '" data-route="#/dashboard/bank/home" role="tab">' + icon('building-2', 15) + 'Bank Portal</button>' +
      '<button class="' + (!isBank ? 'active' : '') + '" data-route="#/dashboard/ops" role="tab">' + icon('server', 15) + 'Ops Portal</button>' +
      '</div>' +
      '<div class="search"><span class="search-icon">' + icon('search', 16) + '</span>' +
      '<input id="globalSearch" type="text" placeholder="Search across dashboard (⌘+K)" aria-label="Search" /></div>' +
      '<div class="spacer"></div>' + tenantPill;
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
    // The Ops Portal is fully fluid (Part 1); the Bank Portal keeps its fixed
    // reading width. One class on the shell scopes every responsive rule.
    var appEl = el('app'); if (appEl) appEl.classList.toggle('portal-ops', S.portal === 'ops');
    renderTopbar();

    if (S.portal === 'ops') { return routeOps(seg.slice(2)); }

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

      '<div class="grid grid-4 mb-16">' + kpiHtml + '</div>' +

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
      var deltaHtml = c.isToday ? pill('In progress', 'warning') : (deltaVal === 0 ? '<span style="color:var(--chart-positive)">' + fmt(0) + '</span>' : '<span style="color:var(--chart-negative);font-weight:600">' + fmt(deltaVal) + '</span>');
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
  var _opsFiles = [];

  function tenantTag(tid) {
    var t = O.tenantById[tid] || O.onboardingById[tid]; if (!t) return tid;
    return '<span class="tenant-tag"><span class="tenant-dot" style="background:' + t.color + '"></span>' + esc(t.name) + '</span>';
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
    if (head === 'reconciliation') { S.opsActive = 'ops-recon'; renderSidebar(); return viewOpsRecon(); }
    // Cycle Snapshot — the drill-in behind every Cross-Tenant Cycle Status cell.
    // It belongs to Ops Home, so the sidebar keeps Ops Home selected.
    if (head === 'cycle-snapshot') { S.opsActive = 'ops-home'; renderSidebar(); return CYCUI.route(rest.slice(1)); }
    if (head === 'files') { S.opsActive = 'ops-files'; renderSidebar(); return viewFiles(); }
    // IRD Reject Resolver (refinement §6) — Ops resolves a wrong / missing IRD
    // and re-stages the file without escalating to Tech.
    if (head === 'ird-rejects') { S.opsActive = 'ops-ird'; renderSidebar(); return IRDUI.route(rest.slice(1)); }
    if (head === 'onboarding') {
      S.opsActive = 'ops-onboarding'; renderSidebar();
      if (rest[1] === 'new') return viewOnboardNew();
      if (rest[1]) return viewTenantDetail(rest[1]);
      return viewOnboardingList();
    }
    if (head === 'disputes') { S.opsActive = 'ops-disputes'; renderSidebar(); return rest[1] ? viewOpsDisputeDetail(rest[1]) : viewOpsDisputes(); }
    if (head === 'holidays') { S.opsActive = null; renderSidebar(); return viewOpsHolidays(); }
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

    var kpis =
      '<div class="kpi-card"><div class="kpi-label">Active Tenants</div><div class="kpi-value">' + k.activeTenants + '</div><div class="kpi-foot"><span class="meta">all provisioned</span></div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Total Transactions Processed</div><div class="kpi-value">' + num(k.totalTxnsMTD) + '</div><div class="kpi-foot"><span class="meta">MTD, all tenants</span>' + spark(k.txnSeries, 90, 30, '#2563EB') + '</div></div>' +
      '<div class="kpi-card" title="Aggregated across tenants at 1 SGD = ₹61.5, 1 HKD = ₹10.7 (rates as of prototype date)"><div class="kpi-label">Total MTD Volume <span class="meta">(INR-eq)</span></div><div class="kpi-value">' + fmtCr(k.totalMtdINR) + '</div><div class="kpi-foot"><span class="meta">' + icon('info', 12) + ' converted to INR</span></div></div>' +
      '<div class="kpi-card clickable" data-route="#/dashboard/ops/approvals?approvalTab=pending"><div class="kpi-label">Pending Fee Approvals</div><div class="kpi-value">' + k.pendingApprovals + '</div><div class="kpi-foot"><span class="kpi-link">Review queue ' + icon('arrow-right', 12) + '</span></div></div>' +
      '<div class="kpi-card clickable" data-route="#/dashboard/ops/disputes"><div class="kpi-label">Open Disputes</div><div class="kpi-value">' + k.openDisputes + '</div><div class="kpi-foot"><span class="kpi-link">Across portfolio ' + icon('arrow-right', 12) + '</span></div></div>';

    // cross-tenant cycle status grid — four legs per cell (CLR / STL / INC / JV2),
    // each cutoff aware, with its own cycle-date stepper. A cell opens the Cycle
    // Snapshot for that tenant × network. The whole section owns its own mount so
    // stepping the date never re-renders the rest of this page.
    var matrix = CYCUI.gridSection();

    // action queues
    var pend = O.feeApprovals.filter(function (a) { return a.status === 'Pending'; }).sort(function (a, b) { return (48 - b.submittedHoursAgo) - (48 - a.submittedHoursAgo); });
    var feeQueue = pend.slice(0, 5).map(function (a) {
      var left = 48 - a.submittedHoursAgo;
      return '<div class="queue-item" data-route="#/dashboard/ops/approvals/' + a.id + '"><div class="qi-body"><div class="qi-title">' + tenantTag(a.tenantId) + ' · ' + esc(a.merchant.split(' - ')[0]) + '</div><div class="qi-meta">' + a.submittedHoursAgo + 'h ago · ' + slaBadge(left) + '</div></div>' + '<span class="qi-arrow">' + icon('chevron-right', 16) + '</span></div>';
    }).join('');

    var provisioning = O.onboardingTenants.filter(function (t) { return t.status === 'Provisioning'; });
    var onbQueue = provisioning.map(function (t) {
      return '<div class="queue-item" data-route="#/dashboard/ops/onboarding/' + t.id + '"><div class="qi-body"><div class="qi-title">' + tenantTag(t.id) + '</div><div class="qi-meta">' + t.country + ' · Provisioning</div></div><span class="qi-arrow">' + icon('chevron-right', 16) + '</span></div>';
    }).join('') || '<div class="meta">No tenants provisioning.</div>';

    var issues = [];
    O.tenants.forEach(function (t) { O.filesFor(t.id, 7).forEach(function (f) { if (f.status === 'Failed' || f.status === 'Delayed') issues.push(f); }); });
    var fileQueue = issues.slice(0, 5).map(function (f) {
      return '<div class="queue-item" data-route="#/dashboard/ops/files?filesTenant=' + f.tenantId + '&filesStatus=' + f.status + '"><div class="qi-body"><div class="qi-title">' + tenantTag(f.tenantId) + ' · ' + f.type + ' ' + f.network + '</div><div class="qi-meta">' + U.prettyDate(f.date) + ' · ' + pill(f.status, f.status === 'Failed' ? 'danger' : 'warning') + '</div></div><span class="qi-arrow">' + icon('chevron-right', 16) + '</span></div>';
    }).join('') || '<div class="meta">No file issues.</div>';

    // rejections summary
    var rejBreak = O.tenants.map(function (t) {
      var rb = k.rejByTenant[t.id];
      return t.name + ' (' + (t.currency === 'INR' ? fmt(rb.amount, 0, 'INR') : fmt(rb.amount, 0, t.currency)) + ', ' + rb.count + ')';
    }).join(' · ');
    var rejCard = '<div class="callout warn" data-route="#/dashboard/ops/reconciliation" style="cursor:pointer">' + icon('alert-triangle', 20) +
      '<div class="callout-body"><strong>Unresolved rejections across platform:</strong> ' + k.rejTotalCount + ' transactions, ~' + fmtCr(k.rejTotalINR) + ' equivalent. <div class="meta" style="margin-top:4px">' + rejBreak + '</div></div>' + icon('chevron-right', 18) + '</div>';

    // holidays widget
    var upcoming = O.holidays.filter(function (h) { return h.date >= D.TODAY; }).slice(0, 5).map(function (h) {
      var flag = h.country === 'India' ? '🇮🇳' : (h.country === 'Singapore' ? '🇸🇬' : '🇭🇰');
      var d = U.fromYmd(h.date);
      return '<div class="holiday-item"><div style="display:flex;gap:12px;align-items:center"><div class="holiday-date"><span class="hd-day">' + d.getUTCDate() + '</span><span class="hd-mon">' + U.MON[d.getUTCMonth()] + '</span></div><div><div class="strong">' + flag + ' ' + h.name + '</div><div class="meta">' + h.country + ' · ' + U.DOW[d.getUTCDay()] + '</div></div></div>' + pill(h.impact, h.impact === 'Full holiday' ? 'danger' : (h.impact === 'Half day' ? 'warning' : 'neutral')) + '</div>';
    }).join('');

    setView(
      '<div class="page-head"><div><h1 class="page-title">Operations Overview</h1><div class="subtitle">' + U.prettyLong(D.TODAY) + ' · cross-tenant platform snapshot</div></div></div>' +
      '<div class="ops-status-strip">' + strip + '</div>' +
      '<div class="grid grid-5 mb-16">' + kpis + '</div>' +
      '<div class="mt-16">' + matrix + '</div>' +
      '<div class="section-title mb-16 mt-24">Action queues</div>' +
      '<div class="grid grid-3">' +
      '<div class="queue-col"><div class="qc-head">Fee Approvals <a class="btn-ghost" data-route="#/dashboard/ops/approvals">All ' + icon('arrow-right', 13) + '</a></div>' + feeQueue + '</div>' +
      '<div class="queue-col"><div class="qc-head">Bank Onboarding in Progress <a class="btn-ghost" data-route="#/dashboard/ops/onboarding">All ' + icon('arrow-right', 13) + '</a></div>' + onbQueue + '</div>' +
      '<div class="queue-col"><div class="qc-head">Settlement File Issues <a class="btn-ghost" data-route="#/dashboard/ops/files">All ' + icon('arrow-right', 13) + '</a></div>' + fileQueue + '</div>' +
      '</div>' +
      '<div class="mt-24">' + rejCard + '</div>' +
      '<div class="grid grid-2 mt-24">' +
      cardBox('Upcoming bank holidays', upcoming + '<div class="mt-16"><a class="btn-ghost" data-route="#/dashboard/ops/holidays">View calendar ' + icon('arrow-right', 14) + '</a></div>') +
      cardBox('Platform at a glance', '<dl class="def-list"><dt>Tenants live</dt><dd>4 (2 IN · 1 SG · 1 HK)</dd><dt>Networks</dt><dd>Visa · Mastercard · RuPay · HSBC ONUS</dd><dt>Pending approvals</dt><dd>' + k.pendingApprovals + '</dd><dt>Open disputes</dt><dd>' + k.openDisputes + '</dd><dt>Unresolved rejections</dt><dd>' + k.rejTotalCount + ' txns</dd><dt>Provisioning</dt><dd>' + provisioning.length + ' banks</dd></dl>') +
      '</div>'
    );
  }

  /* ---- 5.2a Fee Config Approvals queue ------------------------------------ */
  function approvalStatusKind(s) { return { Pending: 'warning', Approved: 'success', Rejected: 'danger' }[s] || 'neutral'; }
  function viewApprovals() {
    var tab = S.ops.approvalTab;
    var counts = { pending: 0, approved: 0, rejected: 0 };
    O.feeApprovals.forEach(function (a) { counts[a.status.toLowerCase()]++; });
    var tabBar = '<div class="tabs">' + [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(function (t) {
      return '<button class="tab ' + (tab === t[0] ? 'active' : '') + '" data-action="ops-approval-tab" data-tab="' + t[0] + '">' + t[1] + '<span class="count">' + counts[t[0]] + '</span></button>';
    }).join('') + '</div>';

    var list = O.feeApprovals.filter(function (a) { return a.status.toLowerCase() === tab; });
    if (S.ops.approvalsTenant !== 'all') list = list.filter(function (a) { return a.tenantId === S.ops.approvalsTenant; });
    if (S.ops.approvalsSla === 'overdue') list = list.filter(function (a) { return (48 - a.submittedHoursAgo) <= 0; });
    else if (S.ops.approvalsSla === 'approaching') list = list.filter(function (a) { var l = 48 - a.submittedHoursAgo; return l > 0 && l < 24; });

    var body;
    if (!list.length) body = '<div class="card">' + emptyState('inbox', 'Nothing in this view', 'No ' + tab + ' fee approvals match the current filters.') + '</div>';
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
          '<td><button class="btn btn-primary btn-sm" data-route="#/dashboard/ops/approvals/' + a.id + '">Review</button></td></tr>';
      }).join('');
      body = '<div class="table-wrap"><table class="data"><thead><tr><th>Tenant</th><th>Merchant</th><th>Submitted by</th><th>Submitted</th><th>' + (tab === 'pending' ? 'SLA' : 'Status') + '</th><th>Change summary</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    setView(
      '<div class="page-head"><div><h1 class="page-title">Fee Config Approvals</h1><div class="subtitle">Ops side of the maker-checker flow · all tenants</div></div></div>' + tabBar +
      '<div class="filter-row"><label class="field" style="flex-direction:row;align-items:center;gap:8px">Tenant ' + tenantSelect('ops-approval-tenant', S.ops.approvalsTenant, true) + '</label>' +
      '<div class="chip search-chip">' + icon('search', 15) + '<input class="input" placeholder="Submitted-by search" data-action="noop" /></div>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">SLA <select class="input" style="width:auto" data-action="ops-approval-sla"><option value="all"' + (S.ops.approvalsSla === 'all' ? ' selected' : '') + '>All</option><option value="approaching"' + (S.ops.approvalsSla === 'approaching' ? ' selected' : '') + '>Approaching</option><option value="overdue"' + (S.ops.approvalsSla === 'overdue' ? ' selected' : '') + '>Overdue</option></select></label></div>' +
      body
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
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/approvals">Fee Config Approvals</a><span class="sep">/</span><span>' + a.id + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">' + esc(a.merchant) + '</h1><div class="subtitle">' + tenantTag(a.tenantId) + ' · MID ' + a.mid + ' · submitted by ' + esc(a.submittedBy) + ' · ' + a.submittedHoursAgo + 'h ago ' + (a.status === 'Pending' ? slaBadge(left) : pill(a.status, approvalStatusKind(a.status))) + '</div></div></div>' +
      banner +
      '<div class="section-title mb-16">Configuration diff</div>' +
      '<div class="grid grid-2">' +
      '<div class="card pad-sm"><div class="diff-head" style="padding:0 0 10px;font-weight:600">Current active configuration</div><div class="diff-rule" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);background:none"><span>Rule</span><span>Region</span><span>Txn</span><span class="dr-num">MDR</span><span></span></div>' + diffColumn(a.current, proposedByKey, 'left') + '</div>' +
      '<div class="card pad-sm" style="border-color:var(--primary)"><div class="diff-head" style="padding:0 0 10px;font-weight:600;color:var(--primary-subtle-fg)">Proposed configuration</div><div class="diff-rule" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);background:none"><span>Rule</span><span>Region</span><span>Txn</span><span class="dr-num">MDR</span><span></span></div>' + diffColumn(a.proposed, currentByKey, 'right') + '</div>' +
      '</div>' +
      '<div class="mt-16"><span class="diff-tag added">added</span> new rule &nbsp; <span class="diff-tag modified">modified</span> rate change &nbsp; <span class="diff-tag removed">removed</span> rule dropped</div>' +

      '<div class="section-title mb-16 mt-24">P&amp;L impact</div>' +
      '<div class="impact-panel" style="margin-bottom:16px"><div class="ip-icon">' + icon('trending-up', 22) + '</div><div><div class="meta">Based on this merchant\'s last 30 days of volume</div><div class="ip-value">' + (a.pl.totalDelta >= 0 ? '+' : '') + fmt(a.pl.totalDelta, 0, a.pl.currency) + ' ' + (a.pl.totalDelta >= 0 ? 'additional revenue' : 'reduced revenue') + ' <span style="font-size:14px">(' + (a.pl.pctRel >= 0 ? '+' : '') + a.pl.pctRel.toFixed(1) + '% relative to current)</span></div></div></div>' +
      cardBox('Per-network revenue delta', '<table class="data" style="max-width:420px"><thead><tr><th>Network</th><th class="num">Δ Revenue</th></tr></thead><tbody>' + plRows + '</tbody></table>') +

      '<div class="grid grid-2 mt-24">' +
      cardBox('Bank submitter\'s reason', '<blockquote style="border-left:3px solid var(--border-strong);padding:8px 14px;color:var(--text-secondary);font-style:italic">“' + esc(a.reason) + '”</blockquote>') +
      cardBox('Reviewer notes' + (a.status === 'Pending' ? ' <span class="meta">(required to reject)</span>' : ''), '<textarea class="input" id="reviewerNotes" placeholder="Ops analyst notes…">' + esc(a.reviewerNotes || '') + '</textarea>') +
      '</div>' +

      (a.status === 'Pending' ? '<div class="row mt-24" style="justify-content:flex-end;gap:10px"><button class="btn btn-secondary" data-action="ops-reject" data-id="' + a.id + '">' + icon('x', 16) + 'Reject</button><button class="btn btn-primary" data-action="ops-approve" data-id="' + a.id + '">' + icon('check', 16) + 'Approve</button></div>' : '<div class="row mt-24" style="justify-content:flex-end"><button class="btn btn-secondary" data-route="#/dashboard/ops/approvals">Back to queue</button></div>')
    );
  }

  /* ---- 5.3 Two-way Reconciliation ----------------------------------------- */
  function viewOpsRecon() {
    var tid = S.ops.reconTenant || O.defaultRecon.tenantId;
    if (!O.tenantById[tid]) tid = O.defaultRecon.tenantId;
    S.ops.reconTenant = tid;
    var cycles = O.settledCycles(tid);
    var cid = S.ops.reconCycle;
    var cyc = cycles.find(function (c) { return c.id === cid; });
    if (!cyc) { // default: this tenant's break cycle if any, else most recent
      cyc = cycles.find(function (c) { return c.hasBreak; }) || cycles.find(function (c) { return c.hasRej; }) || cycles[0];
    }
    S.ops.reconCycle = cyc.id;
    var t = O.tenantById[tid], cur = t.currency;

    var statusKind = cyc.status === 'Break' ? 'danger' : (cyc.status === 'Under Investigation' ? 'warning' : 'success');
    var selectors = '<div class="filter-row">' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Tenant ' + tenantSelect('recon-tenant', tid, false) + '</label>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Cycle <select class="input" style="width:auto" data-action="recon-cycle">' + cycles.slice(0, 30).map(function (c) { return '<option value="' + c.id + '"' + (c.id === cyc.id ? ' selected' : '') + '>' + U.prettyDate(c.date) + (c.hasBreak ? ' · break' : (c.hasRej ? ' · rejections' : '')) + '</option>'; }).join('') + '</select></label>' +
      '<div class="chip"><span class="chip-label">Networks</span><span class="chip-value">All</span>' + icon('chevron-down', 15) + '</div></div>';

    // leg tables
    function legTable(kind) {
      var rows = O.NETWORKS.map(function (net) {
        var lg = cyc.legs[net.key];
        return '<tr><td>' + net.name + '</td><td class="num">' + (kind === 'sub' ? lg.subBatches : lg.setBatches) + '</td><td class="num">' + num(kind === 'sub' ? lg.subCount : lg.setCount) + '</td><td class="num">' + fmt(kind === 'sub' ? lg.subGross : lg.settleAmt, 2, cur) + '</td></tr>';
      }).join('');
      return '<table class="data"><thead><tr><th>Network</th><th class="num">Batches</th><th class="num">Txns</th><th class="num">' + (kind === 'sub' ? 'Gross' : 'Settlement') + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    var twoway = '<div class="twoway">' +
      '<div class="leg-card"><div class="leg-head">Leg 1 — Submitted position</div><div class="leg-src">What we submitted · from CTF/IPM/NPCI batch trailers</div>' + legTable('sub') + '<div class="row" style="justify-content:space-between;margin-top:12px;font-weight:600"><span>Total submitted</span><span class="num">' + fmt(cyc.submitted, 2, cur) + '</span></div></div>' +
      '<div class="leg-card"><div class="leg-head">Leg 2 — Settled position</div><div class="leg-src">What the network settled · from VSS TC46/TC58, GCMS, NPCI settlement reports</div>' + legTable('set') + '<div class="row" style="justify-content:space-between;margin-top:12px;font-weight:600"><span>Total settled</span><span class="num">' + fmt(cyc.settled, 2, cur) + '</span></div></div>' +
      '</div>';

    // expected delta
    var icRows = O.NETWORKS.map(function (net) { return '<tr><td>' + net.name + '</td><td class="num">' + fmt(cyc.legs[net.key].interchange, 2, cur) + '</td><td class="num">' + fmt(cyc.legs[net.key].scheme, 2, cur) + '</td></tr>'; }).join('');
    var expected = cardBox('Expected delta', '<div class="grid grid-2"><table class="data"><thead><tr><th>Network</th><th class="num">Interchange</th><th class="num">Scheme Fee</th></tr></thead><tbody>' + icRows + '</tbody></table>' +
      '<div><dl class="def-list"><dt>Total interchange</dt><dd class="num">' + fmt(cyc.interchange, 2, cur) + '</dd><dt>Total scheme fees</dt><dd class="num">' + fmt(cyc.scheme, 2, cur) + '</dd><dt>Known adjustments</dt><dd class="num">' + fmt(cyc.adjustments, 2, cur) + '</dd><dt>Rejection holdback</dt><dd class="num">' + fmt(cyc.rejectionHoldback, 2, cur) + '</dd></dl><div class="row" style="justify-content:space-between;font-weight:700;border-top:1px solid var(--border-subtle);padding-top:10px"><span>Total expected delta</span><span class="num">' + fmt(cyc.expectedDelta, 2, cur) + '</span></div></div></div>');

    // break math
    function term(lbl, val) { return '<div class="bf-term"><span class="bf-label">' + lbl + '</span><span class="bf-val">' + val + '</span></div>'; }
    var breakBlock = '<div class="break-formula">' + term('Submitted', fmt(cyc.submitted, 0, cur)) + '<span class="bf-op">−</span>' + term('Settled', fmt(cyc.settled, 0, cur)) + '<span class="bf-op">−</span>' + term('Expected Δ', fmt(cyc.expectedDelta, 0, cur)) + '<span class="bf-op">=</span>' + '<div class="bf-term"><span class="bf-label">Residual</span><span class="bf-val bf-residual ' + (cyc.residual > 0 ? 'break' : 'zero') + '">' + fmt(cyc.residual, 2, cur) + '</span></div></div>' + residualBar(cyc, cur);

    var investigation = cyc.hasBreak ? '<div class="card mt-16" style="border-color:#FECACA"><div class="card-title" style="color:var(--status-danger-fg)">' + icon('alert-octagon', 18) + ' Break Investigation</div><div class="meta mt-16">Residual of ' + fmt(cyc.residual, 2, cur) + ' beyond the expected delta. Contributing factor: <strong>Mastercard leg</strong> — settled amount is short of submitted less fees. Sample batches: MC-' + cyc.date.replace(/-/g, '') + '-03, MC-' + cyc.date.replace(/-/g, '') + '-07. No matching adjustment found in the scheme settlement report.</div><div class="mt-16"><button class="btn btn-primary btn-sm" data-action="open-investigation">' + icon('flag', 15) + 'Open investigation</button></div></div>' : '';

    // rejections
    var rejSection = '';
    if (cyc.rejections.length) {
      var allAwaiting = cyc.rejections.every(function (r) { return r.status === 'Awaiting re-clearing'; });
      var rtot = cyc.rejections.reduce(function (s, r) { return s + r.amount; }, 0);
      var rrows = cyc.rejections.map(function (rj) {
        return '<tr><td>' + tenantTag(cyc.tenantId) + '</td><td>' + rj.network + '</td><td class="mono">' + rj.arn + '</td><td class="num">' + fmt(rj.amount, 2, cur) + '</td><td><div class="cell-main">' + rj.reasonCode + '</div><div class="cell-sub" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + rj.reasonDesc + '</div></td><td class="nowrap">' + U.prettyDate(rj.receivedOn) + '</td><td>' + rejLifecycle(rj) + '</td><td class="nowrap">' + U.prettyDate(rj.expectedSettlement) + '</td></tr>';
      }).join('');
      rejSection = '<div class="card mt-24" style="border-color:#FDE68A"><div class="card-title" style="color:var(--status-warning-fg)">' + icon('alert-triangle', 18) + ' Incoming Rejections — this cycle</div>' +
        '<div class="callout warn" style="margin:12px 0"><span class="strong">' + cyc.rejections.length + ' rejections, ' + fmt(rtot, 2, cur) + ' total' + (allAwaiting ? ', all awaiting re-clearing' : '') + '</span></div>' +
        '<div class="meta mb-16">Transactions rejected by the network in this cycle\'s incoming file. They are deducted from settlement math and re-cleared in the next cycle (T+1), settling the following day (T+2).</div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Tenant</th><th>Network</th><th>ARN</th><th class="num">Amount</th><th>Reason</th><th>Received (T)</th><th>Lifecycle</th><th>Expected settle (T+2)</th></tr></thead><tbody>' + rrows + '</tbody></table></div></div>';
    }

    var corrSection = cyc.corrections.length ? cardBox('Correction history', '<div class="meta mb-16">Immutable — original entry nullified (struck-through), correcting entry directly below.</div>' + cyc.corrections.map(cycleCorrectionPair).join('')) : '';

    setView(
      '<div class="page-head"><div><h1 class="page-title">Two-Way Reconciliation</h1><div class="subtitle">Submitted position vs. network settled position · no acknowledgment leg</div></div></div>' +
      selectors +
      '<div class="amounts-panel" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:20px">' +
      amountCell('Cycle', U.prettyDate(cyc.date), '') + amountCell('Cycle ID', cyc.id.split('-').slice(-3).join('-'), '') + amountCell('Currency', cur, '') + '<div class="amount-cell"><span class="ac-label">Status</span><span>' + pill(cyc.status, statusKind) + '</span></div></div>' +
      twoway +
      '<div class="mt-24">' + expected + '</div>' +
      '<div class="section-title mb-16 mt-24">Break math</div>' + breakBlock + investigation +
      rejSection +
      (corrSection ? '<div class="mt-24">' + corrSection + '</div>' : '')
    );
  }
  function residualBar(c, cur) {
    var total = c.submitted || 1;
    function w(v) { return Math.max(0, (v / total) * 100); }
    return '<div class="residual-bar-wrap"><div class="residual-bar">' +
      '<div class="residual-seg" style="width:' + w(c.settled).toFixed(2) + '%;background:#22C55E">Settled ' + fmt(c.settled, 0, cur) + '</div>' +
      '<div class="residual-seg" style="width:' + w(c.expectedDelta).toFixed(2) + '%;background:#EAB308" title="Expected delta ' + fmt(c.expectedDelta, 0, cur) + '"></div>' +
      (c.residual > 0 ? '<div class="residual-seg" style="width:' + Math.max(w(c.residual), 6).toFixed(2) + '%;background:#EF4444" title="Residual ' + fmt(c.residual, 0, cur) + '"></div>' : '') +
      '</div><div class="wf-legend" style="margin-top:12px"><span class="lg"><span class="sw" style="background:#22C55E"></span>Settled ' + fmt(c.settled, 0, cur) + '</span><span class="lg"><span class="sw" style="background:#EAB308"></span>Expected Δ ' + fmt(c.expectedDelta, 0, cur) + '</span>' + (c.residual > 0 ? '<span class="lg"><span class="sw" style="background:#EF4444"></span>Residual ' + fmt(c.residual, 0, cur) + ' — the break</span>' : '<span class="lg">Fully reconciled — no residual</span>') + '</div></div>';
  }

  /* ---- 5.4 Settlement File Monitoring ------------------------------------- */
  function viewFiles() {
    var tid = S.ops.filesTenant;
    _opsFiles = tid === 'all' ? [].concat.apply([], O.tenants.map(function (t) { return O.filesFor(t.id, 7); })) : O.filesFor(tid, 7);
    var status = S.ops.filesStatus;
    var shown = _opsFiles.filter(function (f) { return status === 'All' ? true : f.status === status; });

    var summary = {
      expected: _opsFiles.filter(function (f) { return f.status !== 'Not expected — holiday'; }).length,
      generated: _opsFiles.filter(function (f) { return f.status === 'Generated'; }).length,
      delayed: _opsFiles.filter(function (f) { return f.status === 'Delayed'; }).length,
      failed: _opsFiles.filter(function (f) { return f.status === 'Failed'; }).length,
      pending: _opsFiles.filter(function (f) { return f.status === 'Pending'; }).length
    };
    var strip = '<div class="amounts-panel" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:20px">' +
      amountCell('Expected in range', String(summary.expected), '') +
      amountCell('Generated on time', String(summary.generated), 'good') +
      amountCell('Delayed', String(summary.delayed), summary.delayed ? 'warn' : '') +
      amountCell('Failed', String(summary.failed), summary.failed ? 'danger' : '') +
      amountCell('Pending', String(summary.pending), '') + '</div>';

    var rows = shown.map(function (f, i) {
      var idx = _opsFiles.indexOf(f);
      var stKind = { Generated: 'success', Delayed: 'warning', Failed: 'danger', Pending: 'neutral' }[f.status] || 'neutral';
      var isHoliday = f.status.indexOf('holiday') >= 0;
      var cls = f.status === 'Failed' ? 'file-failed' : (f.status === 'Delayed' ? 'file-delayed' : (isHoliday ? 'file-holiday' : ''));
      return '<tr class="clickable ' + cls + '" data-action="file-detail" data-idx="' + idx + '">' +
        '<td>' + tenantTag(f.tenantId) + '</td><td>' + f.network + '</td><td class="nowrap">' + U.prettyDate(f.date) + (f.holiday ? ' <span class="pill pill-warning" style="padding:1px 6px">🏦 Holiday</span>' : '') + '</td>' +
        '<td><span class="file-badge badge-' + f.type + '">' + f.type + '</span></td>' +
        '<td>' + (isHoliday ? '<span class="meta">Not expected — holiday</span>' : pill(f.status, stKind)) + '</td>' +
        '<td class="nowrap">' + f.cutoff + '</td><td class="nowrap cell-sub">' + (f.generatedAt || '—') + '</td><td class="nowrap cell-sub">' + (f.transmittedAt || '—') + '</td>' +
        '<td class="num">' + (f.size || '—') + '</td>' +
        '<td>' + (f.status === 'Failed' ? '<button class="btn btn-sm btn-secondary" data-action="file-retry" data-name="' + f.name + '">Retry</button>' : (isHoliday ? '' : '<button class="btn btn-sm btn-ghost" data-action="file-detail" data-idx="' + idx + '">Logs</button>')) + '</td></tr>';
    }).join('');

    setView(
      '<div class="page-head"><div><h1 class="page-title">Settlement File Monitoring</h1><div class="subtitle">MPR / MPF / JV1 / JV2 generation & transmission vs. cutoff SLAs</div></div></div>' +
      '<div class="filter-row"><label class="field" style="flex-direction:row;align-items:center;gap:8px"><strong style="color:var(--text-primary)">Tenant</strong> ' + tenantSelect('files-tenant', tid, true) + '</label>' +
      '<div class="chip"><span class="chip-label">Networks</span><span class="chip-value">All</span>' + icon('chevron-down', 15) + '</div>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Status <select class="input" style="width:auto" data-action="files-status">' + ['All', 'Generated', 'Delayed', 'Failed', 'Pending'].map(function (s) { return '<option' + (status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<div class="chip">' + icon('calendar', 15) + '<span class="chip-value">Last 7 days</span></div></div>' +
      strip +
      (shown.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Tenant</th><th>Network</th><th>Cycle</th><th>Type</th><th>Status</th><th>Cutoff</th><th>Generated</th><th>Transmitted</th><th class="num">Size</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="card">' + emptyState('file-check', 'No files match', 'Adjust the tenant or status filter.') + '</div>')
    );
  }
  function openFileDetail(f) {
    var stKind = { Generated: 'success', Delayed: 'warning', Failed: 'danger', Pending: 'neutral' }[f.status] || 'neutral';
    el('overlay-mount').innerHTML = '<div class="side-panel"><div class="modal-head"><div class="section-title">' + f.type + ' · ' + f.network + '</div><button class="icon-btn" data-action="close-overlay">' + icon('x', 16) + '</button></div>' +
      '<div class="stack"><div>' + tenantTag(f.tenantId) + ' &nbsp; ' + pill(f.status, stKind) + '</div>' +
      cardBox('Generation timeline', '<div class="file-row"><div class="file-name">Cutoff ' + f.cutoff + '<div class="file-meta">SLA target</div></div></div>' + (f.generatedAt ? '<div class="file-row"><div class="file-name">Generated<div class="file-meta">' + f.generatedAt + '</div></div></div>' : '') + (f.transmittedAt ? '<div class="file-row"><div class="file-name">Transmitted<div class="file-meta">' + f.transmittedAt + '</div></div></div>' : '')) +
      cardBox('Log entries', '<div class="meta" style="font-family:monospace;font-size:12px;line-height:1.8">[' + f.date + ' 02:00] job started for ' + f.tenantId + '/' + f.type + '<br>[' + f.date + ' 02:0' + (f.status === 'Failed' ? '3] ERROR upstream clearing feed timeout (retry pending)' : '4] wrote ' + (f.size || '—')) + '<br>[' + f.date + ' 02:05] ' + (f.status === 'Failed' ? 'job FAILED' : (f.status === 'Delayed' ? 'job completed (delayed)' : 'job completed OK')) + '</div>') +
      cardBox('File metadata', '<dl class="def-list"><dt>Checksum</dt><dd class="mono">' + f.checksum + '</dd><dt>Destination</dt><dd class="mono">' + f.dest + f.name + '</dd><dt>Size</dt><dd>' + (f.size || '—') + '</dd></dl>') +
      '</div></div>';
    if (window.lucide) lucide.createIcons();
  }

  /* ---- 5.5 Bank Onboarding ------------------------------------------------ */
  function viewOnboardingList() {
    var rows = O.onboardingTenants.map(function (t) {
      var stKind = t.status === 'Active' ? 'success' : (t.status === 'Provisioning' ? 'warning' : 'neutral');
      return '<tr class="clickable" data-route="#/dashboard/ops/onboarding/' + t.id + '">' +
        '<td>' + tenantTag(t.id) + '</td><td>' + t.flag + ' ' + t.country + '</td><td>' + t.currency + '</td><td class="nowrap">' + U.prettyDate(t.onboarded) + '</td>' +
        '<td>' + t.networks.map(function (n) { return '<span class="file-badge badge-MPR" style="margin-right:3px;background:var(--status-neutral-bg);color:var(--status-neutral-fg)">' + n + '</span>'; }).join('') + '</td>' +
        '<td>' + pill(t.status, stKind) + '</td></tr>';
    }).join('');
    setView(
      '<div class="page-head"><div><h1 class="page-title">Bank Tenants</h1><div class="subtitle">Onboard and manage bank tenants on the platform</div></div><div class="head-actions"><button class="btn btn-primary" data-route="#/dashboard/ops/onboarding/new">' + icon('plus', 16) + 'Onboard new bank</button></div></div>' +
      '<div class="filter-row"><div class="chip"><span class="chip-label">Status</span>' + icon('chevron-down', 15) + '</div><div class="chip"><span class="chip-label">Country</span>' + icon('chevron-down', 15) + '</div></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Bank</th><th>Country</th><th>Currency</th><th>Onboarded</th><th>Networks</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    );
  }
  function viewTenantDetail(tenantId) {
    var t = O.onboardingById[tenantId];
    if (!t) { setView('<div class="card">' + emptyState('search-x', 'Tenant not found', 'No such tenant.', '<button class="btn btn-secondary" data-route="#/dashboard/ops/onboarding">Back</button>') + '</div>'); return; }
    var stKind = t.status === 'Active' ? 'success' : (t.status === 'Provisioning' ? 'warning' : 'neutral');
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/onboarding">Bank Tenants</a><span class="sep">/</span><span>' + esc(t.name) + '</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">' + tenantTag(t.id) + '</h1><div class="subtitle">' + t.flag + ' ' + t.country + ' · ' + t.currency + ' · onboarded ' + U.prettyDate(t.onboarded) + ' ' + pill(t.status, stKind) + '</div></div></div>' +
      '<div class="grid grid-2">' +
      cardBox('Identity', '<dl class="def-list"><dt>Legal name</dt><dd>' + esc(t.legalName) + '</dd><dt>Primary contact</dt><dd>' + esc(t.contact) + '</dd><dt>Data region</dt><dd>' + esc(t.address) + '</dd></dl>') +
      cardBox('Currency & settlement', '<dl class="def-list"><dt>Currency</dt><dd>' + t.currency + '</dd><dt>Settlement account</dt><dd>' + t.settleAcct + '</dd></dl>') +
      cardBox('Networks & BIN ranges', '<div class="mb-16">' + t.networks.map(function (n) { return pill(n, 'primary'); }).join(' ') + '</div><dl class="def-list"><dt>BIN ranges</dt><dd class="mono">' + t.bins + '</dd></dl>') +
      cardBox('Network rule set', '<dl class="def-list"><dt>Assigned rule set</dt><dd class="mono">' + t.ruleSet + '</dd></dl><pre style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin-top:10px">{\n  "ruleSet": "' + t.ruleSet + '",\n  "networks": ' + JSON.stringify(t.networks) + ',\n  "readOnly": true\n}</pre>') +
      '</div>' +
      '<div class="mt-24">' + cardBox('Configuration history', '<div class="meta mb-16">Immutable — every configuration change is appended; corrections nullify the prior entry without deleting it.</div>' + immutableTimeline(O.configHistory[t.id])) + '</div>'
    );
  }
  var ONB_STEPS = ['Bank Identity', 'Currency & Settlement Account', 'Networks & BIN Ranges', 'Network Rule Set Assignment', 'Review & Activate'];
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
    else if (step === 4) body = '<div class="stack">' + field('Network rule set', '<select class="input"><option>RULESET-IN-STD-v3</option><option>RULESET-SG-STD-v2</option><option>RULESET-HK-STD-v2</option><option>RULESET-GLOBAL-v1</option></select>', true) + '<div class="callout info">' + icon('info', 20) + '<div class="callout-body">Rule sets define interchange/scheme fee tables and clearing windows. Cycle schedule is platform-level and not configured here.</div></div></div>';
    else body = '<div class="stack"><div class="callout info">' + icon('info', 20) + '<div class="callout-body">On activate, the tenant is created in <strong>Provisioning</strong> status and enters the platform provisioning queue.</div></div><dl class="def-list"><dt>Legal name</dt><dd>Axis Bank Ltd</dd><dt>Country</dt><dd>India</dd><dt>Currency</dt><dd>INR</dd><dt>Networks</dt><dd>Visa, Mastercard, RuPay, HSBC ONUS</dd><dt>Rule set</dt><dd>RULESET-IN-STD-v3</dd></dl></div>';
    var nav = '<div class="row" style="justify-content:space-between;margin-top:24px">' + (step > 1 ? '<button class="btn btn-secondary" data-action="ops-onboard-prev">' + icon('arrow-left', 16) + 'Back</button>' : '<span></span>') + (step < 5 ? '<button class="btn btn-primary" data-action="ops-onboard-next">Continue' + icon('arrow-right', 16) + '</button>' : '<button class="btn btn-primary" data-action="ops-onboard-activate">' + icon('check', 16) + 'Activate tenant</button>') + '</div>';
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops/onboarding">Bank Tenants</a><span class="sep">/</span><span>Onboard new bank</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">Onboard new bank</h1><div class="subtitle">Step ' + step + ' of 5</div></div></div>' +
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
          '<td>' + pill(U.prettyDate(d.deadline) + ' · ' + d.deadlineDays + 'd', urg) + '</td><td>' + pill(d.status, stKind) + '</td></tr>';
      }).join('');
      return '<div class="dispute-group-head">' + tenantTag(t.id) + '<span class="count-badge">' + ds.length + '</span></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Dispute</th><th>Merchant</th><th>Network</th><th>Stage</th><th>Reason</th><th class="num">Amount</th><th>Received</th><th>Deadline</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }).join('');

    setView(
      '<div class="page-head"><div><h1 class="page-title">Dispute Ops Support</h1><div class="subtitle">Cross-tenant disputes grouped by tenant · ops-side support</div></div></div>' +
      '<div class="filter-row"><label class="field" style="flex-direction:row;align-items:center;gap:8px">Tenant ' + tenantSelect('ops-disp-tenant', tf, true) + '</label>' +
      '<div class="chip"><span class="chip-label">Stage</span>' + icon('chevron-down', 15) + '</div>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Deadline <select class="input" style="width:auto" data-action="ops-disp-urgency"><option' + (uf === '<7 days' ? ' selected' : '') + '>&lt;7 days</option><option' + (uf === '<3 days' ? ' selected' : '') + '>&lt;3 days</option><option' + (uf === 'all' ? ' selected' : '') + ' value="all">All</option></select></label>' +
      '<div class="chip"><span class="chip-label">Reason code</span>' + icon('chevron-down', 15) + '</div></div>' +
      (groups || '<div class="card">' + emptyState('shield-check', 'No disputes match', 'Adjust the tenant or deadline filter.') + '</div>')
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
      '<div class="page-head"><div><h1 class="page-title">' + d.id + '</h1><div class="subtitle">' + tenantTag(d.tenantId) + ' · ' + esc(d.merchant) + ' · ' + d.network + ' · ' + fmt(d.amount, 2, d.currency) + ' ' + pill(d.stage, 'info') + ' ' + pill('Deadline ' + U.prettyDate(d.deadline), urg) + '</div></div></div>' +
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

  /* ---- 5.7 Bank Holiday Calendar ------------------------------------------ */
  function viewOpsHolidays() {
    var country = S.ops.holidayCountry, view = S.ops.holidayView;
    var list = O.holidays.filter(function (h) { return country === 'All' ? true : h.country === country; });
    var toggle = '<div class="chip" style="padding:2px;gap:2px"><button class="btn btn-sm ' + (view === 'list' ? 'btn-primary' : 'btn-ghost') + '" data-action="holiday-view" data-view="list">List</button><button class="btn btn-sm ' + (view === 'calendar' ? 'btn-primary' : 'btn-ghost') + '" data-action="holiday-view" data-view="calendar">Calendar</button></div>';
    var filters = '<div class="filter-row"><label class="field" style="flex-direction:row;align-items:center;gap:8px">Country <select class="input" style="width:auto" data-action="holiday-ops-country">' + ['All', 'India', 'Singapore', 'Hong Kong'].map(function (c) { return '<option' + (country === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label><div style="flex:1"></div>' + toggle + '</div>';

    var body;
    if (view === 'list') {
      var rows = list.map(function (h) {
        var d = U.fromYmd(h.date); var flag = h.country === 'India' ? '🇮🇳' : (h.country === 'Singapore' ? '🇸🇬' : '🇭🇰');
        var kind = h.impact === 'Full holiday' ? 'danger' : (h.impact === 'Half day' ? 'warning' : 'neutral');
        return '<tr><td class="nowrap">' + U.prettyDate(h.date) + '</td><td>' + U.DOW[d.getUTCDay()] + '</td><td>' + esc(h.name) + '</td><td>' + flag + ' ' + h.country + '</td><td>' + pill(h.impact, kind) + '</td></tr>';
      }).join('');
      body = '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Country</th><th>Impact</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } else {
      body = miniCalendar(list);
    }
    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops">Ops Home</a><span class="sep">/</span><span>Bank Holidays</span></div>' +
      '<div class="page-head"><div><h1 class="page-title">Bank Holiday Calendar</h1><div class="subtitle">Know when to expect no settlement files across regions</div></div></div>' + filters + body
    );
  }
  function miniCalendar(list) {
    // show a fixed illustrative month: December 2025
    var year = 2025, month = 11; // Dec (0-indexed)
    var first = new Date(Date.UTC(year, month, 1));
    var startDow = first.getUTCDay();
    var daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    var holByDay = {};
    list.forEach(function (h) { var d = U.fromYmd(h.date); if (d.getUTCFullYear() === year && d.getUTCMonth() === month) holByDay[d.getUTCDate()] = h; });
    var cells = '';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) { cells += '<div class="cal-head">' + d + '</div>'; });
    for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell muted"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var h = holByDay[day];
      cells += '<div class="cal-cell ' + (h ? 'holiday' : '') + '"><div class="cal-day">' + day + '</div>' + (h ? '<div class="cal-name">' + (h.country === 'India' ? '🇮🇳' : h.country === 'Singapore' ? '🇸🇬' : '🇭🇰') + ' ' + esc(h.name) + '</div>' : '') + '</div>';
    }
    return cardBox('December 2025', '<div class="cal-grid">' + cells + '</div><div class="meta mt-16">Illustrative month. Red cells are full holidays — no settlement files expected for that region.</div>');
  }

  /* ======================================================================== *
     HANDLERS (event delegation)
     ======================================================================== */
  var ACTIONS = {
    'toggle-sidebar': function () { S.sidebarCollapsed = !S.sidebarCollapsed; el('app').classList.toggle('collapsed', S.sidebarCollapsed); renderSidebar(); },
    'toggle-section': function (t, e) { e.stopPropagation(); var sec = t.getAttribute('data-section'); S.expanded[sec] = !S.expanded[sec]; renderSidebar(); },
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
    'ops-approval-sla': function (t) { S.ops.approvalsSla = t.value; viewApprovals(); },
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
    'recon-tenant': function (t) { S.ops.reconTenant = t.value; S.ops.reconCycle = null; viewOpsRecon(); },
    'recon-cycle': function (t) { S.ops.reconCycle = t.value; viewOpsRecon(); },
    'open-investigation': function () { toast('Investigation note created', 'success'); },
    'files-tenant': function (t) { S.ops.filesTenant = t.value; viewFiles(); },
    'files-status': function (t) { S.ops.filesStatus = t.value; viewFiles(); },
    'file-detail': function (t) { var f = _opsFiles[+t.getAttribute('data-idx')]; if (f) openFileDetail(f); },
    'file-retry': function (t) { toast('Retrying ' + t.getAttribute('data-name') + '…'); },
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
    'holiday-ops-country': function (t) { S.ops.holidayCountry = t.value; viewOpsHolidays(); },
    'holiday-view': function (t) { S.ops.holidayView = t.getAttribute('data-view'); viewOpsHolidays(); }
  };

  /* ---- Platform Configs (Phase 3) ----------------------------------------
     The configs module is a separate file; it receives the shared design-system
     helpers from this shell so every screen renders with the same primitives. */
  var CFGKIT = {
    icon: icon, esc: esc, pill: pill, cardBox: cardBox, emptyState: emptyState, errorState: errorState,
    setView: setView, toast: toast, el: el, go: go, num: num, fmt: fmt, pct: pct,
    tenantTag: tenantTag, slaBadge: slaBadge,
    immutableEntry: immutableEntry, immutablePair: immutablePair, immutableTimeline: immutableTimeline,
    renderSidebar: renderSidebar, field: field
  };
  var CFGUI = window.ConfigsUI(CFGKIT);
  var CFGQ = window.ConfigsQueue(CFGUI);
  Object.keys(CFGUI.actions).forEach(function (k) { ACTIONS[k] = CFGUI.actions[k]; });
  Object.keys(CFGQ.actions).forEach(function (k) { ACTIONS[k] = CFGQ.actions[k]; });
  // IRD Reject Resolver shares the same design-system kit.
  var IRDUI = window.IrdUI(CFGKIT);
  Object.keys(IRDUI.actions).forEach(function (k) { ACTIONS[k] = IRDUI.actions[k]; });
  // Cross-Tenant Cycle Status grid (Ops Home) + Cycle Snapshot drill-in.
  var CYCUI = window.CycleUI(CFGKIT);
  Object.keys(CYCUI.actions).forEach(function (k) { ACTIONS[k] = CYCUI.actions[k]; });

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
    // IRD resolver: the apply reason is a live-typing binding.
    if (a === 'ird-reason') { ACTIONS[a](t); return; }
    if (a === 'filter-merchants') ACTIONS[a](t);
  });
  document.addEventListener('change', function (e) {
    var t = e.target.closest('[data-action]'); if (!t) return;
    var a = t.getAttribute('data-action');
    // Configs: 'cfgc-*' actions are select / checkbox / radio bindings.
    if (a.indexOf('cfgc-') === 0) { ACTIONS[a](t); return; }
    // IRD resolver: selects, checkboxes and the candidate radios.
    if (a.indexOf('ird-') === 0 && a !== 'ird-reason' && ACTIONS[a]) { ACTIONS[a](t); return; }
    if (['filter-merchant-status', 'filter-merchant-mcc', 'fb-group', 'holiday-country', 'propose-merchant', 'report-delivery',
      'ops-approval-tenant', 'ops-approval-sla', 'recon-tenant', 'recon-cycle', 'files-tenant', 'files-status', 'ops-disp-tenant', 'ops-disp-urgency', 'holiday-ops-country'].indexOf(a) >= 0) ACTIONS[a](t);
  });
  // Tag inputs commit on Enter (Part 6.2 eligibility flags, Part 7.2 ack filenames).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target.closest('[data-action="cfg-tag-add"]');
    if (!t) return;
    e.preventDefault();
    ACTIONS['cfg-tag-add'](t);
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
