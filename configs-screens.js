/* =============================================================================
   Juspay Ops Portal — Platform Configs: the three family screens (Phase 3)
   Filter row + full-width dual-mode editor, applied three times (Part 4, and
   Part 8 of the clearing-staging brief, which removed the left list pane).
   The list survives only inside the Browse all configurations disclosure at
   the bottom of the page — the width belongs to the ruler, the two-column
   mappings and the field tables, which is what was cramped.
   window.ConfigsUI(kit) → { route, actions, api }
   ============================================================================= */
window.ConfigsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CFGDATA, X = window.CFGCORE, F = window.CFGFMT;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, tenantTag = kit.tenantTag,
    slaBadge = kit.slaBadge, immutableEntry = kit.immutableEntry, immutablePair = kit.immutablePair,
    pageHead = kit.pageHead, tableCard = kit.tableCard, opsFilterRow = kit.opsFilterRow, opsToggle = kit.opsToggle;

  /* ---- In-memory screen state (no browser storage) ----------------------- */
  S.cfg = {
    role: 'Maker',
    family: 'network-file',
    selected: { 'network-file': 'cfg_nf_001', settlement: 'hsbc_in::MPR', 'incoming-parsing': 'cfg_ip_001' },
    tab: { 'network-file': 'layout', settlement: 'content', 'incoming-parsing': 'pipeline' },
    mode: 'form',
    rawFormat: 'json',
    filters: {
      'network-file': { q: '', tenant: 'all', facet: 'all', state: 'all' },
      settlement: { q: '', tenant: 'all', facet: 'all', state: 'all' },
      'incoming-parsing': { q: '', tenant: 'all', facet: 'all', state: 'all' }
    },
    edits: {},        // configId → in-memory draft
    feeSel: {},       // selected fee config per settlement report item
    autoPack: {},
    parked: {},       // format-specific blocks stashed while another format is active
    acc: {},          // composite DE accordions (Mastercard layout)
    grpOpen: {},      // group-mapping sections (transform tab)
    schedVariant: {}, // selected schedule variant per settlement report item
    expandedRule: null,
    sampleDate: D.TODAY,
    history: { open: false, a: null, b: null, compare: false },
    drawer: null,
    showUnchanged: false,
    queue: { tab: 'pending', family: 'all', submitter: 'all', sla: 'all' },
    // Task-based landing (Part 5.1) — which task the user came in on, and the
    // Browse all configurations disclosure beneath the task cards.
    task: null, rejFrom: null, fileFrom: null, browseOpen: false, browseFam: 'network-file', unusedOpen: false, parseForm: null,
    // Layout ruler: hovered field index and the pre-filled add-field form.
    hoverField: null, gapForm: null,
    // Incoming parsing issues that have been resolved this session.
    parsedFixed: {},
    // Fee calculator inputs (Part 5.5 tab 3).
    feeCalc: { amount: 250000, network: 'Mastercard', card: 'Credit' },
    // Sample-file test output (Part 5.4).
    sampleTest: null
  };

  var SEG = { 'network-file': 'network-files', settlement: 'settlement', 'incoming-parsing': 'incoming' };
  var BY_SEG = { 'network-files': 'network-file', settlement: 'settlement', incoming: 'incoming-parsing' };
  var CHILD = { 'network-file': 'ops-cfg-network', settlement: 'ops-cfg-settlement', 'incoming-parsing': 'ops-cfg-incoming' };
  function famRoute(fam, id) { return '#/dashboard/ops/configs/' + SEG[fam] + (id ? '/' + id : ''); }

  /* ---- State pills — same vocabulary as Merchant Fees (Part 8.2) -------- */
  /* Part 5.6 — plain status vocabulary. The maker-checker states themselves are
     unchanged; only what they are called on screen is. */
  var STATE_PILL = {
    DRAFT: ['Draft', 'neutral', 'file-pen'],
    PENDING_APPROVAL: ['Waiting for approval', 'info', 'clock'],
    APPROVED: ['Approved', 'success', 'badge-check'],
    ACTIVE: ['Live', 'success', 'check-circle'],
    INACTIVE: ['Turned off', 'neutral', 'pause'],
    REJECTED: ['Not approved', 'danger', 'x-circle']
  };
  function statePill(cfg) {
    var d = STATE_PILL[cfg.state] || ['Unknown', 'neutral', 'help-circle'];
    var p = pill(d[0], d[1], d[2]);
    if (cfg.state === 'REJECTED' && cfg.rejectionReason) {
      return '<span class="tip" data-tip="Rejected by ' + esc(cfg.rejectedBy || 'checker') + ' — ' + esc(cfg.rejectionReason) + '">' + p + '</span>';
    }
    if (cfg.state === 'PENDING_APPROVAL' && cfg.submittedBy) {
      return '<span class="tip" data-tip="Submitted by ' + esc(cfg.submittedBy) + ' · ' + esc(cfg.submittedAt || '') + '">' + p + '</span>';
    }
    return p;
  }
  function famBadge(fam) {
    var f = C.familyById[fam];
    return '<span class="fam-badge fam-' + f.badge + '">' + esc(f.short) + '</span>';
  }
  function facetBadge(cfg) {
    if (cfg.family === 'network-file') {
      var n = C.netByKey[cfg.network] || { color: 'var(--text-tertiary)', label: cfg.network };
      return '<span class="net-badge"><span class="nb-dot" style="background:' + n.color + '"></span>' + esc(cfg.network) + '</span>';
    }
    if (cfg.family === 'settlement') return '<span class="sub-badge">' + esc(cfg.report) + '</span>' +
      (cfg.variant ? '<span class="sub-badge variant">' + esc(cfg.variant.replace(/_/g, ' ').toLowerCase()) + '</span>' : '');
    return '<span class="sub-badge">' + esc(cfg.source) + '</span>';
  }
  function tenantChip(key) {
    var t = C.tenantByKey[key];
    if (!t) return esc(key);
    if (t.opsId) return tenantTag(t.opsId);
    return '<span class="tenant-tag"><span class="tenant-dot" style="background:' + t.color + '"></span>' + esc(t.name) + '</span>';
  }

  /* ---- Small form helpers ------------------------------------------------ */
  function put(id, html) { var n = el(id); if (n) { n.innerHTML = html; if (window.lucide) lucide.createIcons(); } }
  function attr(o) { return Object.keys(o).map(function (k) { return o[k] == null ? '' : k + '="' + esc(o[k]) + '"'; }).join(' '); }
  function txt(path, val, o) {
    o = o || {};
    return '<input class="input' + (o.cls ? ' ' + o.cls : '') + '" type="' + (o.type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' +
      (o.list ? 'list="' + o.list + '" ' : '') + (o.ph ? 'placeholder="' + esc(o.ph) + '" ' : '') + (o.maxlength ? 'maxlength="' + o.maxlength + '" ' : '') +
      (o.disabled ? 'disabled ' : '') +
      'data-action="cfgi-set" data-path="' + esc(path) + '"' + (o.cast ? ' data-cast="' + o.cast + '"' : '') +
      (o.refresh ? ' data-refresh="' + o.refresh + '"' : '') + ' />';
  }
  function selIn(path, val, opts, o) {
    o = o || {};
    var body = opts.map(function (op) {
      var v = Array.isArray(op) ? op[0] : op, l = Array.isArray(op) ? op[1] : op;
      return '<option value="' + esc(v) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
    return '<select class="input' + (o.cls ? ' ' + o.cls : '') + '"' + (o.disabled ? ' disabled' : '') +
      ' data-action="cfgc-set" data-path="' + esc(path) + '"' + (o.cast ? ' data-cast="' + o.cast + '"' : '') +
      (o.refresh ? ' data-refresh="' + o.refresh + '"' : '') + '>' + body + '</select>';
  }
  function toggle(path, val, label, o) {
    o = o || {};
    return '<label class="cfg-toggle"><input type="checkbox"' + (val ? ' checked' : '') +
      ' data-action="cfgc-set" data-path="' + esc(path) + '" data-cast="bool"' + (o.refresh ? ' data-refresh="' + o.refresh + '"' : '') +
      ' /><span>' + esc(label) + '</span></label>';
  }
  function fld(label, input, hint) {
    return '<label class="field">' + esc(label) + input + (hint ? '<span class="fld-hint">' + esc(hint) + '</span>' : '') + '</label>';
  }
  function iconBtn(action, ic, tip, data) {
    return '<button class="icon-btn xs" data-action="' + action + '" ' + (data || '') + ' aria-label="' + esc(tip) + '" title="' + esc(tip) + '">' + icon(ic, 14) + '</button>';
  }
  function addBtn(label, action, data) {
    return '<button class="btn btn-secondary btn-sm" data-action="' + action + '" ' + (data || '') + '>' + icon('plus', 14) + esc(label) + '</button>';
  }
  function dataList(id, items) {
    return '<datalist id="' + id + '">' + items.map(function (i) { return '<option value="' + esc(i) + '"></option>'; }).join('') + '</datalist>';
  }
  // Offset stepper (T-2 … T+2) used by the settlement schedule tab.
  function offsetPicker(path, val) {
    return '<span class="offset-picker">' +
      '<button class="op-btn" data-action="cfg-offset" data-path="' + esc(path) + '" data-dir="-1" aria-label="Earlier">' + icon('minus', 13) + '</button>' +
      '<span class="op-val num">' + esc(val || 'T+0') + '</span>' +
      '<button class="op-btn" data-action="cfg-offset" data-path="' + esc(path) + '" data-dir="1" aria-label="Later">' + icon('plus', 13) + '</button>' +
      '</span>';
  }
  function tagList(path, items, ph) {
    var chips = (items || []).map(function (v, i) {
      return '<span class="tag-chip">' + esc(v) + '<button data-action="cfg-arr-del" data-path="' + esc(path) + '" data-idx="' + i + '" aria-label="Remove ' + esc(v) + '">' + icon('x', 12) + '</button></span>';
    }).join('');
    return '<div class="tag-input">' + chips +
      '<input class="tag-new" placeholder="' + esc(ph || 'Add…') + '" data-action="cfg-tag-add" data-path="' + esc(path) + '" />' +
      '</div>';
  }

  /* ---- Settlement report items (§5) --------------------------------------
     The settlement list is keyed by (entity, report) — one row per report, and
     content / schedule / fees are TABS on that one row rather than separate list
     entries. Each tab still edits its own config object, so maker-checker stays
     per-save with a clear diff; the item is the navigation unit, not the
     approval unit. */
  function stItem() {
    return C.settlementItemByKey(S.cfg.selected.settlement);
  }
  function stScheduleCfg(item) {
    if (!item || !item.schedules.length) return null;
    var want = S.cfg.schedVariant[item.key];
    var hit = item.schedules.filter(function (c) { return c.configId === want; })[0];
    return hit || item.schedules[0];
  }
  function stFeeCfg(item) {
    if (!item || !item.fees.length) return null;
    var want = S.cfg.feeSel[item.key];
    var hit = item.fees.filter(function (c) { return c.configId === want; })[0];
    return hit || item.fees[0];
  }
  function stActiveConfig() {
    var item = stItem(); if (!item) return null;
    var tab = S.cfg.tab.settlement;
    if (tab === 'content') return item.content;
    if (tab === 'fees') return stFeeCfg(item);
    return stScheduleCfg(item);
  }

  /* ---- Current config + edit session ------------------------------------ */
  function current() {
    var fam = S.cfg.family;
    if (fam === 'settlement') return stActiveConfig();
    var id = S.cfg.selected[fam];
    return C.byId[id] || null;
  }
  // One draft per config, so switching tabs inside a report item never discards
  // unsaved work on the tab you came from.
  function edit() {
    var cfg = current(); if (!cfg) return null;
    var e = S.cfg.edits[cfg.configId];
    if (!e) {
      e = S.cfg.edits[cfg.configId] = {
        configId: cfg.configId,
        body: C.clone(cfg.currentDraft ? cfg.currentDraft.body : cfg.body),
        name: cfg.name,
        raw: null, rawErr: null, dirty: false
      };
    }
    return e;
  }
  function resetEdit(id) {
    if (id) delete S.cfg.edits[id];
    else S.cfg.edits = {};
  }
  function dirtyCount() {
    return Object.keys(S.cfg.edits).filter(function (k) { return S.cfg.edits[k].dirty; }).length;
  }
  function validationOf() {
    var cfg = current(), e = edit();
    if (!cfg || !e) return { errors: [], warnings: [], all: [] };
    if (e.rawErr) {
      return { errors: [{ level: 'error', code: 'SYNTAX', msg: e.rawErr, where: 'raw ' + S.cfg.rawFormat }], warnings: [], all: [] };
    }
    return X.validate(cfg, e.body);
  }

  /* ---- Role gating (Part 3) --------------------------------------------- */
  function role() { return S.cfg.role; }
  function isSelf(cfg) { return cfg.submittedBy === C.DEMO_USER; }
  function can(cfg, act) {
    var r = role(), st = cfg.state;
    if (r === 'Viewer') return { ok: false, why: 'Viewer role is read-only. Switch the role selector to Maker or Checker.' };
    if (act === 'edit' || act === 'save' || act === 'submit') {
      if (r !== 'Maker') return { ok: false, why: 'Only a Maker can edit and submit changes. Checkers review and approve.' };
      if (st === 'PENDING_APPROVAL') return { ok: false, why: 'This config is awaiting approval — it cannot be edited until a checker approves or rejects it.' };
      return { ok: true };
    }
    if (act === 'approve' || act === 'reject') {
      if (r !== 'Checker') return { ok: false, why: 'Only a Checker can approve or reject. Switch the role selector to Checker.' };
      if (st !== 'PENDING_APPROVAL') return { ok: false, why: 'Nothing to review — this config is not awaiting approval.' };
      if (act === 'approve' && isSelf(cfg)) {
        return { ok: false, why: 'Self-approval is blocked — you (' + C.DEMO_USER + ') submitted this change. A different checker must approve it.' };
      }
      return { ok: true };
    }
    if (act === 'activate') {
      if (r !== 'Checker') return { ok: false, why: 'Only a Checker can activate a config.' };
      if (st !== 'APPROVED' && st !== 'INACTIVE') return { ok: false, why: 'Only an approved (or previously deactivated) config can be activated.' };
      return { ok: true };
    }
    if (act === 'deactivate') {
      if (r !== 'Checker') return { ok: false, why: 'Only a Checker can deactivate a config.' };
      if (st !== 'ACTIVE') return { ok: false, why: 'Only an active config can be deactivated.' };
      return { ok: true };
    }
    return { ok: true };
  }
  function gatedBtn(cfg, act, label, ic, cls, extraBlock) {
    var g = can(cfg, act);
    var blocked = !g.ok || (extraBlock && extraBlock.blocked);
    var why = !g.ok ? g.why : (extraBlock ? extraBlock.why : '');
    var btn = '<button class="btn ' + cls + '"' + (blocked ? ' disabled' : '') + ' data-action="cfg-' + act + '">' + icon(ic, 15) + esc(label) + '</button>';
    return blocked ? '<span class="tip" data-tip="' + esc(why) + '">' + btn + '</span>' : btn;
  }

  /* =======================================================================
     LIST PANE (Part 4.2)
     ======================================================================= */
  function facetOptions(fam) {
    if (fam === 'network-file') return C.NETWORKS.map(function (n) { return [n.key, n.label]; });
    // One row per report, so the facet is the base report — the JV fee-date /
    // non-fee-date variants live inside the item's Schedule tab (§5).
    if (fam === 'settlement') return C.REPORT_BASES.map(function (r) { return [r, r]; });
    return C.SOURCES.map(function (s) { return [s, s]; });
  }
  function facetOf(cfg) {
    return cfg.family === 'network-file' ? cfg.network : (cfg.family === 'settlement' ? cfg.reportBase : cfg.source);
  }
  function filtered(fam) {
    var f = S.cfg.filters[fam], q = (f.q || '').toLowerCase();
    if (fam === 'settlement') {
      return C.settlementItems().filter(function (it) {
        if (f.tenant !== 'all' && it.tenantId !== f.tenant) return false;
        if (f.facet !== 'all' && it.report !== f.facet) return false;
        if (f.state !== 'all' && !it.members.some(function (c) { return c.state === f.state; })) return false;
        if (q && it.name.toLowerCase().indexOf(q) < 0 && it.report.toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    return C.byFamily(fam).filter(function (c) {
      if (f.tenant !== 'all' && c.tenantId !== f.tenant) return false;
      if (f.facet !== 'all' && facetOf(c) !== f.facet) return false;
      if (f.state !== 'all' && c.state !== f.state) return false;
      if (q && c.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  // A report item's headline state: the most urgent thing across its tabs.
  var STATE_RANK = { REJECTED: 0, PENDING_APPROVAL: 1, DRAFT: 2, APPROVED: 3, ACTIVE: 4, INACTIVE: 5 };
  function itemState(it) {
    var best = null;
    it.members.forEach(function (c) {
      if (best === null || STATE_RANK[c.state] < STATE_RANK[best]) best = c.state;
    });
    return best || 'DRAFT';
  }
  function listPane(fam) {
    var f = S.cfg.filters[fam], list = filtered(fam), selId = S.cfg.selected[fam];
    var facetLabel = fam === 'network-file' ? 'Network' : (fam === 'settlement' ? 'Report' : 'Source');
    function who(e) { return e ? String(e).split('@')[0] : '—'; }
    var rows;
    if (fam === 'settlement') {
      // One row per (entity, report). The tab strip under the name shows what
      // the item carries, so nobody has to hunt for a report's schedule.
      rows = list.map(function (it) {
        var st = itemState(it);
        var latest = it.members.map(function (c) { return c.updatedAt || ''; }).sort().pop() || '';
        var chips = [
          ['Content', it.content ? 1 : 0, 'table-2'],
          ['Schedule', it.schedules.length, 'calendar-clock'],
          ['Fees', it.fees.length, 'percent']
        ].map(function (c) {
          return '<span class="item-chip' + (c[1] ? '' : ' empty') + '">' + icon(c[2], 11) + esc(c[0]) +
            (c[1] > 1 ? '<b class="num">' + c[1] + '</b>' : '') + '</span>';
        }).join('');
        var attention = it.members.filter(function (c) { return c.state === 'PENDING_APPROVAL' || c.state === 'REJECTED' || c.state === 'DRAFT'; }).length;
        return '<tr class="clickable' + (it.key === selId ? ' sel' : '') + '" data-action="cfg-select" data-id="' + esc(it.key) + '">' +
          '<td><div class="cell-main">' + esc(it.report) + '</div>' +
          '<div class="cell-sub">' + tenantChip(it.tenantId) + '</div>' +
          '<div class="cell-sub item-chips">' + chips + '</div></td>' +
          '<td>' + statePill({ state: st }) +
          (attention ? '<div class="cell-sub mt-4">' + attention + ' tab' + (attention === 1 ? '' : 's') + ' need attention</div>' : '') +
          '<div class="cell-sub mt-4">' + esc(latest) + '</div></td></tr>';
      }).join('');
    } else {
      rows = list.map(function (c) {
        return '<tr class="clickable' + (c.configId === selId ? ' sel' : '') + '" data-action="cfg-select" data-id="' + c.configId + '">' +
          '<td><div class="cell-main">' + esc(c.name) + '</div>' +
          '<div class="cell-sub">' + facetBadge(c) + ' ' + tenantChip(c.tenantId) + '</div>' +
          '<div class="cell-sub row-people">' + icon('user', 11) + esc(who(c.createdBy)) +
          (c.approvedBy ? icon('check', 11) + esc(who(c.approvedBy)) : '') + '</div></td>' +
          '<td>' + statePill(c) + '<div class="cell-sub mt-4">' + esc(c.updatedAt || '') + '</div></td></tr>';
      }).join('');
    }

    var table = list.length
      ? '<div class="table-wrap"><table class="data cfg-list-table"><thead><tr><th>' + (fam === 'settlement' ? 'Report' : 'Config') + '</th><th>Status · last updated</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : emptyState('search-x', 'Nothing matches', 'Clear the search or the filters to see everything in this family.');

    return '<div class="cfg-pane cfg-list" id="cfgListPane">' +
      '<div class="cfg-pane-head">' +
      '<div class="row" style="gap:8px;align-items:center;justify-content:space-between">' +
      '<div class="cfg-count">' +
      '<strong class="num">' + list.length + '</strong> of <span class="num">' +
      (fam === 'settlement' ? C.settlementItems().length : C.byFamily(fam).length) + '</span> ' +
      (fam === 'settlement' ? 'reports' : 'configs') + '</div>' +
      '<button class="btn btn-primary btn-sm" data-action="cfg-new">' + icon('plus', 14) + 'Create new</button>' +
      '</div>' +
      '<div class="chip search-chip cfg-search">' + icon('search', 15) +
      '<input class="input" placeholder="Search by name" value="' + esc(f.q) + '" data-action="cfgi-browse-q" />' +
      '</div>' +
      '<div class="cfg-filters">' +
      '<select class="input" data-action="cfgc-browse-tenant"><option value="all">All entities</option>' +
      C.TENANTS.map(function (t) { return '<option value="' + t.key + '"' + (f.tenant === t.key ? ' selected' : '') + '>' + t.key + '</option>'; }).join('') + '</select>' +
      '<select class="input" data-action="cfgc-browse-facet"><option value="all">All ' + facetLabel.toLowerCase() + 's</option>' +
      facetOptions(fam).map(function (o) { return '<option value="' + o[0] + '"' + (f.facet === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select class="input" data-action="cfgc-browse-state"><option value="all">All states</option>' +
      C.STATES.map(function (s) { return '<option value="' + s + '"' + (f.state === s ? ' selected' : '') + '>' + STATE_PILL[s][0] + '</option>'; }).join('') + '</select>' +
      '</div></div>' +
      '<div class="cfg-list-body">' + table + '</div></div>';
  }

  /* =======================================================================
     EDITOR — header, tabs, dual mode, validation (Part 4.3)
     ======================================================================= */
  function tabsFor(cfg) {
    if (cfg.family === 'network-file') return [['layout', 'Layout', 'ruler'], ['transform', 'Transform', 'shuffle']];
    // §5 — everything about ONE report lives on ONE item, reached through tabs.
    // A tab with nothing behind it is still shown (so the shape of a report is
    // always legible) but disabled, with a tooltip saying what is missing.
    if (cfg.family === 'settlement') {
      var it = stItem() || { content: null, schedules: [], fees: [] };
      return [
        ['content', 'Content', 'table-2', !it.content, 'No content config for this report yet.'],
        ['schedule', 'Schedule', 'calendar-clock', !it.schedules.length, 'No schedule config for this report yet.'],
        ['fees', 'Fees', 'percent', !it.fees.length, 'No fee rules configured for this entity.']
      ];
    }
    // Incoming configs are still stored one-aspect-per-config.
    return [
      ['pipeline', 'Incoming pipeline', 'workflow', cfg.subType !== 'pipeline'],
      ['parser', 'File parser', 'file-json', cfg.subType !== 'parser'],
      ['preprocessor', 'Preprocessor', 'filter', cfg.subType !== 'preprocessor']
    ];
  }
  function activeTab(cfg) {
    var t = S.cfg.tab[cfg.family], all = tabsFor(cfg);
    var found = all.filter(function (x) { return x[0] === t && !x[3]; })[0];
    if (found) return t;
    var first = all.filter(function (x) { return !x[3]; })[0];
    return first ? first[0] : all[0][0];
  }

  function editorHeader(cfg) {
    var e = edit(), v = validationOf();
    var canEdit = can(cfg, 'edit').ok;
    var pendingDraft = cfg.currentDraft ? '<span class="tip" data-tip="An unsubmitted draft exists — edited by ' + esc(cfg.currentDraft.editedBy) + ' on ' + esc(cfg.currentDraft.editedAt) + '">' + pill('draft pending', 'warning', 'pencil') + '</span>' : '';
    var dirty = e && e.dirty ? '<span class="cfg-dirty">' + icon('dot', 14) + 'unsaved edits</span>' : '';

    var actions = '';
    actions += '<button class="btn btn-secondary btn-sm" data-action="cfg-history">' + icon('history', 15) + 'History <span class="count num">' + cfg.versions.length + '</span></button>';
    actions += '<button class="btn btn-secondary btn-sm" data-action="cfg-validate">' + icon('shield-check', 15) + 'Validate</button>';
    actions += gatedBtn(cfg, 'save', 'Save draft', 'save', 'btn-secondary btn-sm');
    actions += gatedBtn(cfg, 'submit', 'Submit for approval', 'send', 'btn-primary btn-sm',
      v.errors.length ? { blocked: true, why: v.errors.length + ' validation error' + (v.errors.length === 1 ? '' : 's') + ' must be fixed before this config can be submitted.' } : null);
    if (cfg.state === 'PENDING_APPROVAL' || role() === 'Checker') {
      actions += gatedBtn(cfg, 'reject', 'Reject', 'x', 'btn-secondary btn-sm');
      actions += gatedBtn(cfg, 'approve', 'Approve', 'check', 'btn-primary btn-sm');
    }
    if (cfg.state === 'ACTIVE') actions += gatedBtn(cfg, 'deactivate', 'Deactivate', 'pause', 'btn-secondary btn-sm');
    else actions += gatedBtn(cfg, 'activate', 'Activate', 'play', 'btn-secondary btn-sm');

    var banner = '';
    if (cfg.state === 'REJECTED' && cfg.rejectionReason) {
      banner = '<div class="callout danger cfg-banner">' + icon('x-circle', 20) +
        '<div class="callout-body"><strong>Rejected by ' + esc(cfg.rejectedBy || 'checker') + '</strong> · ' + esc(cfg.rejectedAt || '') +
        '<div style="margin-top:4px">' + esc(cfg.rejectionReason) + '</div>' +
        '<div class="meta" style="margin-top:6px;color:inherit;opacity:.85">The proposal is preserved as an editable draft — fix it and re-submit for approval.</div></div></div>';
    } else if (cfg.state === 'PENDING_APPROVAL') {
      banner = '<div class="callout info cfg-banner">' + icon('clock', 20) +
        '<div class="callout-body"><strong>Awaiting approval</strong> — submitted by ' + esc(cfg.submittedBy) + ' on ' + esc(cfg.submittedAt) + '. ' +
        slaBadge(48 - (cfg.submittedHoursAgo || 0)) +
        (cfg.submitReason ? '<div style="margin-top:4px">“' + esc(cfg.submitReason) + '”</div>' : '') +
        '<div style="margin-top:8px"><a class="btn-ghost inline-link" data-route="#/dashboard/ops/configs/approvals/' + cfg.configId + '">Open in approval queue ' + icon('arrow-right', 13) + '</a></div></div></div>';
    } else if (cfg.state === 'APPROVED') {
      banner = '<div class="callout info cfg-banner">' + icon('badge-check', 20) +
        '<div class="callout-body"><strong>Approved, not yet live.</strong> Approved by ' + esc(cfg.approvedBy || '') + ' on ' + esc(cfg.approvedAt || '') +
        '. Click Activate to put this version into production.</div></div>';
    } else if (cfg.state === 'INACTIVE' && cfg.deactivatedNote) {
      banner = '<div class="callout cfg-banner" style="background:var(--bg-subtle);border:1px solid var(--border-default)">' + icon('pause', 20) +
        '<div class="callout-body">' + esc(cfg.deactivatedNote) + '</div></div>';
    }

    // On a settlement report item the headline is the REPORT; the editable name
    // belongs to whichever config the active tab is bound to, and the strip below
    // makes that binding explicit so a save is never ambiguous.
    var itemHead = '';
    if (cfg.family === 'settlement') {
      var it = stItem();
      if (it) {
        itemHead = '<div class="item-head">' +
          '<div class="item-title">' + icon('file-spreadsheet', 20) + '<h2>' + esc(it.report) + '</h2>' + tenantChip(it.tenantId) + '</div>' +
          '<div class="meta">One report, one item — content, every schedule variant and the entity’s fee rules are tabs below, not separate list entries.</div>' +
          '</div>';
      }
    }

    return '<div class="cfg-editor-head">' + itemHead +
      '<div class="ceh-row">' +
      (cfg.family === 'settlement' ? '<span class="editing-label">' + icon('pencil', 13) + 'editing</span>' : '') +
      '<input class="cfg-name-input" value="' + esc(e ? e.name : cfg.name) + '" ' + (canEdit ? '' : 'disabled ') +
      'data-action="cfgi-name" aria-label="Config name" />' +
      statePill(cfg) + pendingDraft + dirty +
      '</div>' +
      '<div class="ceh-meta">' + famBadge(cfg.family) + ' ' + facetBadge(cfg) + ' ' + tenantChip(cfg.tenantId) +
      ' <span class="meta">· ' + esc(cfg.configId) + ' · ' + esc(cfg.configType) + ' · created by ' + esc(cfg.createdBy) +
      (cfg.approvedBy ? ' · approved by ' + esc(cfg.approvedBy) : '') + '</span></div>' +
      '<div class="ceh-actions" id="cfgActions">' + actions + '</div>' +
      banner + '</div>';
  }

  // Per-tab attention dot on a settlement report item, so a pending or rejected
  // schedule is visible while you are standing on the Content tab.
  var TAB_DOT = { PENDING_APPROVAL: 'info', REJECTED: 'danger', DRAFT: 'warning' };
  function tabBadge(cfg, tabKey) {
    if (cfg.family !== 'settlement') return '';
    var it = stItem(); if (!it) return '';
    var members = tabKey === 'content' ? (it.content ? [it.content] : [])
      : tabKey === 'schedule' ? it.schedules : it.fees;
    var kinds = {};
    members.forEach(function (c) { if (TAB_DOT[c.state]) kinds[TAB_DOT[c.state]] = c.state; });
    var order = ['danger', 'info', 'warning'];
    var pick = order.filter(function (k) { return kinds[k]; })[0];
    var extra = members.length > 1 ? '<span class="tab-count num">' + members.length + '</span>' : '';
    return extra + (pick ? '<span class="tab-dot ' + pick + '" title="' + esc(kinds[pick].replace('_', ' ').toLowerCase()) + '"></span>' : '');
  }

  function modeBar(cfg) {
    var tabs = tabsFor(cfg), act = activeTab(cfg);
    var tabHtml = tabs.map(function (t) {
      var dis = !!t[3];
      var b = '<button class="tab' + (act === t[0] && !dis ? ' active' : '') + '"' + (dis ? ' disabled' : '') +
        ' data-action="cfg-tab" data-tab="' + t[0] + '">' + icon(t[2], 15) + esc(t[1]) + tabBadge(cfg, t[0]) + '</button>';
      var why = t[4] || ('This tab applies to ' + t[1].toLowerCase() + ' configs. The selected config is a ' + cfg.subType + ' config.');
      return dis ? '<span class="tip" data-tip="' + esc(why) + '">' + b + '</span>' : b;
    }).join('');
    return '<div class="cfg-tabbar" id="cfgTabBar">' +
      '<div class="tabs cfg-tabs">' + tabHtml + '</div>' +
      // Part 5.2 — Simple is the default and the fully usable path; Advanced is
      // the same JSON/YAML editor, and is the guarantee that nothing the Simple
      // surface does not render is unreachable.
      '<div class="mode-toggle" role="tablist" aria-label="Editor mode">' +
      '<button class="' + (S.cfg.mode === 'form' ? 'active' : '') + '" data-action="cfg-mode" data-mode="form" role="tab">' + icon('list', 14) + 'Simple</button>' +
      '<button class="' + (S.cfg.mode === 'raw' ? 'active' : '') + '" data-action="cfg-mode" data-mode="raw" role="tab">' + icon('braces', 14) + 'Advanced</button>' +
      '</div></div>' +
      (S.cfg.mode === 'raw'
        ? '<div class="meta cfg-mode-note">Editing the raw configuration. Changes here still require approval.</div>'
        : '');
  }

  /* ---- Raw mode ---------------------------------------------------------- */
  function rawBody() {
    var e = edit();
    if (e.raw == null) e.raw = X.serialize(e.body, S.cfg.rawFormat);
    var errBar = e.rawErr
      ? '<div class="raw-err">' + icon('alert-triangle', 15) + esc(e.rawErr) + '</div>'
      : '<div class="raw-ok">' + icon('check-circle', 15) + S.cfg.rawFormat.toUpperCase() + ' parses cleanly — Simple mode reflects these values.</div>';
    return '<div class="raw-wrap">' +
      '<div class="raw-head">' +
      '<div class="meta">Same config object as Simple mode. Keys Simple does not render are preserved.</div>' +
      '<div class="fmt-toggle">' +
      '<button class="' + (S.cfg.rawFormat === 'json' ? 'active' : '') + '" data-action="cfg-rawfmt" data-fmt="json">JSON</button>' +
      '<button class="' + (S.cfg.rawFormat === 'yaml' ? 'active' : '') + '" data-action="cfg-rawfmt" data-fmt="yaml">YAML</button>' +
      '</div></div>' +
      errBar +
      '<div class="raw-editor">' +
      '<pre class="raw-hl" id="cfgRawHl" aria-hidden="true">' + X.highlight(e.raw, S.cfg.rawFormat) + '</pre>' +
      '<textarea class="raw-ta" id="cfgRawTa" spellcheck="false" data-action="cfgi-raw" aria-label="Raw config editor">' + esc(e.raw) + '</textarea>' +
      '</div></div>';
  }

  /* ---- Validation panel (Part 4.3) --------------------------------------- */
  function validationPanel() {
    var v = validationOf();
    var head = '<div class="cfg-val-head">' + icon('shield-check', 16) + '<strong>Validation</strong>' +
      '<span class="val-count err' + (v.errors.length ? '' : ' zero') + '"><span class="num">' + v.errors.length + '</span> error' + (v.errors.length === 1 ? '' : 's') + '</span>' +
      '<span class="val-count wrn' + (v.warnings.length ? '' : ' zero') + '"><span class="num">' + v.warnings.length + '</span> warning' + (v.warnings.length === 1 ? '' : 's') + '</span>' +
      '</div>';
    if (!v.errors.length && !v.warnings.length) {
      return '<div class="cfg-validation ok" id="cfgValidation">' + head +
        '<div class="val-row ok">' + icon('check-circle', 15) + '<div>All validators pass — syntax, schema, layout invariants, reference integrity and rule bounds.</div></div></div>';
    }
    var rows = v.errors.concat(v.warnings).map(function (x) {
      return '<div class="val-row ' + x.level + '">' + icon(x.level === 'error' ? 'x-circle' : 'alert-triangle', 15) +
        '<div><span class="val-code">' + esc(x.code) + '</span>' + esc(x.msg) +
        (x.where ? '<span class="val-where">' + esc(x.where) + '</span>' : '') + '</div></div>';
    }).join('');
    return '<div class="cfg-validation" id="cfgValidation">' + head + rows +
      (v.errors.length ? '<div class="val-foot">' + icon('info', 14) + 'Submit for approval is disabled while errors exist. Warnings do not block submission.</div>' : '') +
      '</div>';
  }

  /* =======================================================================
     TAB BODIES — Family 1 · Network File — FORMAT AWARE (refinement §1–§3)

     One editor, three shapes. Everything below branches on the config's declared
     output_format, exactly as the engine does:
       fixed_width (Visa)  → record length, positions, byte map
       xml        (RuPay)  → xml_file_config, per-field tags, no positions
       csv        (MC)     → DE/PDS columns, record-type groups, no positions
     ======================================================================= */

  // Source-of-value cell (§1.1) — shown for every output field in every format.
  function srcCell(body, name, groupName) {
    return F.sourceBadge(F.resolveSource(body, name, groupName));
  }
  function accKey(rt, name) { return (edit() || {}).configId + ':' + rt + ':' + name; }
  function accOpen(rt, name) { return !!S.cfg.acc[accKey(rt, name)]; }
  function grpOpen(name) { return S.cfg.grpOpen[(edit() || {}).configId + ':' + name] !== false; }

  /* ---- Shared header: output format + the blocks that format actually uses -- */
  function nfHeader() {
    var e = edit(), b = e.body, fmt = F.formatOf(b), fc = F.caps(b);

    var fmtPicker =
      '<div class="fmt-aware-head">' +
      '<label class="field" style="min-width:230px">Output format' +
      selIn('output_format', fmt, F.FORMAT_KEYS.map(function (k) { return [k, F.FORMATS[k].label + '  (' + k + ')']; }), { refresh: 'format' }) +
      '<span class="fld-hint">' + esc(fc.blurb) + '</span></label>' +
      '<div class="fmt-grounding">' + icon('file-code', 14) +
      '<span>Read from <code>' + esc(fc.grounding) + '</code></span></div>' +
      '</div>';

    var specific = '';
    if (fmt === 'fixed_width') {
      specific = '<div class="cfg-grid-4">' +
        fld('Record length (characters)', txt('record_length', b.record_length, { type: 'number', cast: 'int', refresh: 'bytemap', cls: 'num' })) +
        fld('Padding character', txt('padding_char', b.padding_char, { maxlength: 1, ph: 'space', cls: 'mono' }),
          'One character · currently ' + (b.padding_char === ' ' ? 'a space' : '"' + String(b.padding_char == null ? '' : b.padding_char) + '"')) +
        fld('Character encoding', selIn('encoding', b.encoding, ['ASCII', 'EBCDIC'], { refresh: 'validation' })) +
        '</div>';
    } else if (fmt === 'xml') {
      var x = b.xml_file_config || (b.xml_file_config = {});
      specific = '<div class="cfg-grid-3">' +
        fld('XML declaration', txt('xml_file_config.declaration', x.declaration, { cls: 'mono', ph: '<?xml version="1.0" encoding="UTF-8"?>' })) +
        fld('Root element', txt('xml_file_config.root_element', x.root_element, { cls: 'mono', ph: 'File' })) +
        '<div class="field"><span>Formatting</span><div class="sf-row">' +
        toggle('xml_file_config.pretty_print', x.pretty_print, 'Pretty print', { refresh: 'validation' }) + '</div></div>' +
        '</div>';
    } else if (fmt === 'csv') {
      var cc = b.csv_config || (b.csv_config = {});
      specific = '<div class="cfg-grid-3">' +
        fld('Delimiter', txt('csv_config.delimiter', cc.delimiter, { cls: 'mono w-70', maxlength: 3 }), 'clearing.yaml → csv_config.delimiter') +
        fld('Line ending', selIn('line_ending', b.line_ending, ['CRLF', 'LF'], { refresh: 'validation' })) +
        '</div>';
    }

    // Reusable output-file / extension control (§1.2) — offered for every format
    // where an extension is meaningful, not just RuPay.
    var oc = b.output_config || (b.output_config = {});
    var extOpts = F.extensionOptions(fmt);
    var known = extOpts.indexOf(oc.output_extension) >= 0;
    var ext =
      '<div class="cfg-section-title mt-24">Output file</div>' +
      '<div class="cfg-block">' +
      '<div class="cfg-grid-3">' +
      fld('Default output file', txt('output_config.default_output_file', oc.default_output_file, { cls: 'mono', ph: 'e.g. rupay_output.xml', refresh: 'format' })) +
      fld('Extension', selIn('output_config.output_extension', known ? oc.output_extension : '__custom',
        extOpts.map(function (x2) { return [x2, x2]; }).concat([['__custom', 'Custom…']]), { refresh: 'format', cls: 'mono w-120' })) +
      (known ? '' : fld('Custom extension', txt('output_config.output_extension', oc.output_extension, { cls: 'mono w-120', ph: '.dat', refresh: 'format' }))) +
      '</div>' +
      '<div class="meta hint-row mt-16">' + icon('info', 13) +
      '<span>The generated filename is the default output file with this extension applied. Grounded in <code>output_config.default_output_file</code> — RuPay ships <code>rupay_output.xml</code>.</span></div>' +
      '</div>';

    var bits = F.formatSummary(b);
    var strip = bits.length
      ? '<div class="fmt-strip">' + icon(fc.icon, 14) + '<strong>' + esc(fc.label) + '</strong>' +
      bits.map(function (t) { return '<span class="fmt-bit mono">' + esc(t) + '</span>'; }).join('') + '</div>'
      : '';

    return fmtPicker + specific + strip + ext;
  }

  /* ---- Fixed width (Visa) -------------------------------------------------
     Part 5.3 — the ruler renders full content width ABOVE the field table and
     is the primary interface. Every technical key carries a plain-language
     label; the bound path is unchanged, so each control still writes exactly
     the config key it always did. */

  // Part 5.3 — content type as words, not codes.
  var TYPE_LABEL = [['N', 'Numbers only'], ['AN', 'Letters and numbers']];

  /* The add-field form, pre-filled from a gap in the ruler. This is the whole
     point of making the gaps clickable: the user reads the spec, sees the hole,
     clicks it, and types in what belongs there. */
  function gapForm(rtIndex) {
    var g = S.cfg.gapForm;
    if (!g || g.rt !== rtIndex) return '';
    return '<div class="gap-form">' +
      '<div class="gap-form-head">' + icon('plus-circle', 18) +
      '<strong>Add a field at characters <span class="num">' + g.start + '</span>–<span class="num">' + (g.start + g.len - 1) + '</span></strong>' +
      '<button class="icon-btn xs" data-action="cfg-gap-cancel" title="Cancel" aria-label="Cancel">' + icon('x', 14) + '</button></div>' +
      '<div class="cfg-grid-4">' +
      fld('Field name', '<input class="input" id="gapName" placeholder="e.g. Acquirer reference number" />') +
      fld('Starts at character', '<input class="input num" id="gapStart" type="number" value="' + g.start + '" />') +
      fld('Length (characters)', '<input class="input num" id="gapLen" type="number" value="' + g.len + '" />') +
      fld('Content type', '<select class="input" id="gapType">' +
        TYPE_LABEL.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>') +
      '</div>' +
      '<div class="cfg-grid-2 mt-16">' +
      fld('Notes', '<input class="input" id="gapNote" placeholder="What this field carries, per the spec" />') +
      '</div>' +
      '<div class="row mt-16" style="gap:10px;justify-content:flex-end">' +
      '<button class="btn btn-secondary" data-action="cfg-gap-cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cfg-gap-add" data-rt="' + rtIndex + '">' + icon('plus', 18) + 'Add field</button>' +
      '</div></div>';
  }

  function nfRecordsFixed() {
    var e = edit(), b = e.body;
    return (b.record_types || []).map(function (rt, i) {
      var path = 'record_types.' + i;
      var packed = !!S.cfg.autoPack[e.configId + ':' + i];
      var rows = (rt.fields || []).map(function (f, j) {
        var fp = path + '.fields.' + j;
        return '<tr draggable="true" data-dnd="' + path + '.fields" data-idx="' + j + '" data-fieldkey="' + i + '-' + j + '">' +
          '<td class="grip">' + icon('grip-vertical', 14) + '</td>' +
          '<td class="num idx">' + (j + 1) + '</td>' +
          '<td>' + txt(fp + '.name', f.name, { refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.start', f.start, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.length', f.length, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td>' + selIn(fp + '.type', f.type, TYPE_LABEL, { cls: 'w-180', refresh: 'bytemap' }) + '</td>' +
          '<td class="src-col">' + srcCell(b, f.name) + '</td>' +
          '<td>' + txt(fp + '.note', f.note, { ph: '—' }) + '</td>' +
          '<td class="row-actions">' +
          iconBtn('cfg-arr-move', 'chevron-up', 'Move up', 'data-path="' + path + '.fields" data-idx="' + j + '" data-dir="-1"') +
          iconBtn('cfg-arr-move', 'chevron-down', 'Move down', 'data-path="' + path + '.fields" data-idx="' + j + '" data-dir="1"') +
          iconBtn('cfg-arr-del', 'trash-2', 'Delete field', 'data-path="' + path + '.fields" data-idx="' + j + '"') +
          '</td></tr>';
      }).join('');

      return '<div class="cfg-block">' +
        '<div class="cfg-block-head">' +
        '<div class="row" style="gap:10px;align-items:center">' + icon('rows-3', 16) +
        '<strong>Record type</strong>' + txt(path + '.record_type', rt.record_type, { cls: 'mono w-100' }) +
        txt(path + '.label', rt.label, { cls: 'w-220', ph: 'Description' }) +
        groupChip(b, rt) +
        '</div>' +
        '<div class="row" style="gap:8px;align-items:center">' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete record type', 'data-path="record_types" data-idx="' + i + '"') +
        '</div></div>' +

        // The ruler first, full width — it is what the user reads the layout from.
        '<div class="bm-wrap" id="bmw-' + i + '">' +
        X.byteMapHtml(b.record_length, rt.fields, { interactive: true, rt: i }) + '</div>' +
        gapForm(i) +

        '<div class="table-wrap"><table class="data cfg-field-table" data-dnd-table="' + path + '.fields"><thead><tr>' +
        '<th></th><th class="num">#</th><th>Field name</th><th class="num">Starts at</th><th class="num">Length</th><th>Content type</th>' +
        '<th>' + srcHeader() + '</th><th>Notes</th><th></th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="meta" style="padding:18px">No fields yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16 row" style="gap:10px;align-items:center">' +
        addBtn('Add field', 'cfg-arr-add', 'data-path="' + path + '.fields" data-tpl="field"') +
        '<button class="btn btn-secondary btn-sm" data-action="cfg-autopack-run" data-rt="' + i + '" ' +
        'title="Recalculate every start position so the fields run back to back from character 1">' +
        icon('wand-2', 16) + 'Fix positions automatically</button>' +
        '<label class="cfg-toggle"><input type="checkbox"' + (packed ? ' checked' : '') + ' data-action="cfgc-autopack" data-rt="' + i + '" /><span>Keep positions contiguous while editing</span></label>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ---- XML (RuPay) -------------------------------------------------------- */
  function nfRecordsXml() {
    var e = edit(), b = e.body;
    return (b.record_types || []).map(function (rt, i) {
      var path = 'record_types.' + i;
      var rows = (rt.fields || []).map(function (f, j) {
        var fp = path + '.fields.' + j;
        return '<tr draggable="true" data-dnd="' + path + '.fields" data-idx="' + j + '">' +
          '<td class="grip">' + icon('grip-vertical', 14) + '</td>' +
          '<td class="num idx">' + (j + 1) + '</td>' +
          '<td>' + txt(fp + '.name', f.name, { cls: 'mono', refresh: 'validation' }) + '</td>' +
          '<td class="xml-tag">&lt;' + txt(fp + '.xml_tag', f.xml_tag, { cls: 'mono w-160', refresh: 'validation' }) + '&gt;</td>' +
          '<td class="src-col">' + srcCell(b, f.name, rt.group) + '</td>' +
          '<td>' + txt(fp + '.note', f.note, { ph: '—' }) + '</td>' +
          '<td class="row-actions">' +
          iconBtn('cfg-arr-move', 'chevron-up', 'Move up', 'data-path="' + path + '.fields" data-idx="' + j + '" data-dir="-1"') +
          iconBtn('cfg-arr-move', 'chevron-down', 'Move down', 'data-path="' + path + '.fields" data-idx="' + j + '" data-dir="1"') +
          iconBtn('cfg-arr-del', 'trash-2', 'Delete field', 'data-path="' + path + '.fields" data-idx="' + j + '"') +
          '</td></tr>';
      }).join('');
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head">' +
        '<div class="row" style="gap:10px;align-items:center">' + icon('code-2', 16) +
        '<strong>Record</strong>' + txt(path + '.record_type', rt.record_type, { cls: 'mono w-100' }) +
        '<span class="meta">element</span>' + txt(path + '.xml_element', rt.xml_element || rt.record_type, { cls: 'mono w-100', refresh: 'validation' }) +
        txt(path + '.label', rt.label, { cls: 'w-220', ph: 'Description' }) +
        groupChip(b, rt) +
        '</div>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete record', 'data-path="record_types" data-idx="' + i + '"') +
        '</div>' +
        '<div class="table-wrap"><table class="data cfg-field-table" data-dnd-table="' + path + '.fields"><thead><tr>' +
        '<th></th><th class="num">#</th><th>Field name</th><th>XML tag</th><th>' + srcHeader() + '</th><th>Note</th><th></th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="meta" style="padding:18px">No fields yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16">' + addBtn('Add field', 'cfg-arr-add', 'data-path="' + path + '.fields" data-tpl="xmlfield"') + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---- CSV / Excel (Mastercard) — DE/PDS with composite accordions --------- */
  function deRow(b, rt, path, entry, depth) {
    var f = entry.field, j = entry.index, fp = path + '.fields.' + j;
    var kids = entry.children || [];
    var open = kids.length && accOpen(rt.record_type, f.name);
    var seeded = F.describe(f.name);
    var fromRepo = F.descIsFromRepo(f.name);
    var head =
      '<tr class="de-row' + (depth ? ' de-child' : '') + (kids.length ? ' de-parent' : '') + '">' +
      '<td class="de-toggle">' +
      (kids.length
        ? '<button class="icon-btn xs" data-action="cfg-acc" data-rt="' + esc(rt.record_type) + '" data-name="' + esc(f.name) + '" title="' + (open ? 'Collapse' : 'Expand') + ' sub-fields">' +
        icon(open ? 'chevron-down' : 'chevron-right', 14) + '</button>'
        : '') + '</td>' +
      '<td class="num idx">' + (j + 1) + '</td>' +
      '<td>' + txt(fp + '.name', f.name, { cls: 'mono de-code', refresh: 'body' }) +
      (kids.length ? '<span class="de-count">' + kids.length + ' sub-field' + (kids.length === 1 ? '' : 's') + '</span>' : '') + '</td>' +
      '<td>' + selIn(fp + '.type', f.type, C.FIELD_TYPES, { cls: 'w-70', refresh: 'validation' }) + '</td>' +
      '<td class="num">' + txt(fp + '.length', f.length, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'validation' }) + '</td>' +
      '<td class="de-desc">' + txt(fp + '.note', f.note, { ph: 'Describe this DE / PDS…' }) +
      (fromRepo ? '<span class="tip desc-flag" data-tip="Seeded from this repo’s config rather than the IPM data dictionary — confirm with Ops KT.">' + icon('info', 11) + 'from repo</span>' : '') +
      (!f.note && seeded ? '<span class="desc-seed">suggested: ' + esc(seeded) + '</span>' : '') +
      (!f.note && !seeded ? '<span class="desc-missing">' + icon('circle-dashed', 11) + 'not seeded — add the IPM meaning</span>' : '') +
      '</td>' +
      '<td class="src-col">' + srcCell(b, f.name, rt.group) + '</td>' +
      '<td class="row-actions">' +
      iconBtn('cfg-arr-del', 'trash-2', 'Delete column', 'data-path="' + path + '.fields" data-idx="' + j + '"') +
      '</td></tr>';
    if (!open) return head;
    return head + kids.map(function (k) { return deRow(b, rt, path, k, (depth || 0) + 1); }).join('');
  }

  function nfRecordsCsv() {
    var e = edit(), b = e.body;
    return (b.record_types || []).map(function (rt, i) {
      var path = 'record_types.' + i;
      var model = F.groupComposites(b, rt.fields || []);
      var rows = model.map(function (entry) { return deRow(b, rt, path, entry, 0); }).join('');
      var composites = model.filter(function (m) { return m.children.length; }).length;
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head">' +
        '<div class="row" style="gap:10px;align-items:center">' + icon('table-2', 16) +
        '<strong>Record type</strong>' + txt(path + '.record_type', rt.record_type, { cls: 'mono w-100' }) +
        txt(path + '.label', rt.label, { cls: 'w-260', ph: 'Description' }) +
        groupChip(b, rt) +
        '</div>' +
        '<div class="row" style="gap:8px;align-items:center">' +
        '<span class="meta"><span class="num">' + (rt.fields || []).length + '</span> columns' +
        (composites ? ' · <span class="num">' + composites + '</span> composite' : '') + '</span>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete record type', 'data-path="record_types" data-idx="' + i + '"') +
        '</div></div>' +
        '<div class="table-wrap"><table class="data cfg-field-table de-table"><thead><tr>' +
        '<th></th><th class="num">#</th><th>DE / PDS</th><th>Type</th><th class="num">Length</th>' +
        '<th>Description</th><th>' + srcHeader() + '</th><th></th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="meta" style="padding:18px">No columns yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16">' + addBtn('Add DE / PDS column', 'cfg-arr-add', 'data-path="' + path + '.fields" data-tpl="defield"') + '</div>' +
        '</div>';
    }).join('');
  }

  // Which record-type group (header / detail / trailer) a record belongs to.
  function groupChip(b, rt) {
    var gs = F.groupsForRecordType(b, rt.record_type);
    if (!gs.length) return rt.group ? '<span class="grp-chip">' + esc(F.roleOf(rt.group).label) + '</span>' : '';
    return gs.map(function (g) {
      var role = F.roleOf(g.name);
      return '<span class="tip grp-chip" data-tip="' + esc(role.blurb || '') + '">' + icon(role.icon, 12) + esc(role.label) + '</span>';
    }).join('');
  }
  function srcHeader() {
    return '<span class="tip" data-tip="Where this field’s value comes from: a DB / input column, a JSON key, a config_lookup against a lookup table, a constant, or a derived builder.">Source ' + icon('help-circle', 12) + '</span>';
  }

  function nfLayout() {
    var e = edit(), b = e.body, fmt = F.formatOf(b);
    var records = fmt === 'xml' ? nfRecordsXml() : (fmt === 'csv' ? nfRecordsCsv() : nfRecordsFixed());
    var addLabel = fmt === 'xml' ? 'Add record' : 'Add record type';
    var tpl = fmt === 'xml' ? 'xmlrecord' : (fmt === 'csv' ? 'csvrecord' : 'recordtype');
    var title = fmt === 'csv' ? 'Record types — DE / PDS columns' : (fmt === 'xml' ? 'Records' : 'Record types');
    return taskHint() + nfHeader() +
      '<div class="cfg-section-title mt-24">' + title + '</div>' + records +
      '<div class="mt-16">' + addBtn(addLabel, 'cfg-arr-add', 'data-path="record_types" data-tpl="' + tpl + '"') + '</div>' +
      (fmt === 'csv'
        ? '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Mastercard files are CSV — columns, not character positions. Expand a composite element to edit its sub-fields.</div></div>'
        : fmt === 'xml'
          ? '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">RuPay files are XML — records are elements and every field carries a tag. Row order is element order in the output.</div></div>'
          : '') +
      dataList('dl-layout-fields', C.fieldNames(b));
  }

  /* =======================================================================
     Transform tab — structured field mapping + group mapping (§3.2)
     ======================================================================= */
  function paramsEditor(path, params) {
    var keys = Object.keys(params || {});
    if (!keys.length) return '<span class="meta">—</span>';
    return '<div class="param-list">' + keys.map(function (k) {
      var v = params[k];
      if (v !== null && typeof v === 'object') {
        return '<span class="tip param-chip complex" data-tip="Nested parameter — edit in Raw mode.">' +
          '<b>' + esc(k) + '</b><code>' + esc(JSON.stringify(v)) + '</code></span>';
      }
      var isNum = typeof v === 'number';
      return '<span class="param-chip"><b>' + esc(k) + '</b>' +
        txt(path + '.' + k, v, { cls: 'mono w-90' + (isNum ? ' num' : ''), cast: isNum ? 'number' : null, refresh: 'validation' }) +
        '</span>';
    }).join('') + '</div>';
  }

  function fmRow(b, name, cols, depth) {
    var m = (b.transform.field_mappings || {})[name] || {};
    var p = 'transform.field_mappings.' + name;
    return '<tr class="' + (depth ? 'de-child' : '') + '">' +
      '<td class="mono de-code">' + esc(name) + '</td>' +
      '<td>' + txt(p + '.source', m.source, { list: 'dl-input-cols', cls: 'mono', ph: 'input column', refresh: 'validation' }) + '</td>' +
      '<td>' + selIn(p + '.transform', m.transform || 'passthrough', F.TRANSFORMS, { cls: 'w-180', refresh: 'validation' }) + '</td>' +
      '<td>' + paramsEditor(p + '.params', m.params) + '</td>' +
      '<td class="src-col">' + srcCell(b, name) + '</td>' +
      '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Remove mapping', 'data-path="transform.field_mappings" data-key="' + esc(name) + '"') + '</td>' +
      '</tr>';
  }

  /* Part 5.3 — the data mapping tab is a two-column visual, not a JSON editor:
     the data we have on the left, the field in the file on the right, and the
     connection drawn between them. Unmapped file fields are counted and
     highlighted; unused source data is informational, not a problem.
     Every control still writes the same `field_mappings` keys as before, and
     the transform / params editors are unchanged — they sit inside the row. */
  function mapRow(b, name, depth) {
    var m = (b.transform.field_mappings || {})[name] || {};
    var p = 'transform.field_mappings.' + name;
    var src = m.source || '';
    return '<div class="map-row' + (depth ? ' child' : '') + (src ? '' : ' unmapped') + '">' +
      '<div class="map-left">' +
      txt(p + '.source', src, { list: 'dl-input-cols', cls: 'mono', ph: 'pick the source data', refresh: 'validation' }) +
      '</div>' +
      '<div class="map-arrow">' + icon('arrow-right', 18) + '</div>' +
      '<div class="map-right">' +
      '<span class="map-field mono">' + esc(name) + '</span>' +
      '<span class="map-src">' + srcCell(b, name) + '</span>' +
      '</div>' +
      '<div class="map-detail">' +
      '<label class="field inline">Transform ' + selIn(p + '.transform', m.transform || 'passthrough', F.TRANSFORMS, { cls: 'w-180', refresh: 'validation' }) + '</label>' +
      paramsEditor(p + '.params', m.params) +
      iconBtn('cfg-map-del', 'trash-2', 'Remove mapping', 'data-path="transform.field_mappings" data-key="' + esc(name) + '"') +
      '</div></div>';
  }

  function nfFieldMappings() {
    var e = edit(), b = e.body, tf = b.transform || (b.transform = {});
    var fmMap = tf.field_mappings || (tf.field_mappings = {});
    var mapped = Object.keys(fmMap);
    var allFields = [];
    (b.record_types || []).forEach(function (rt) { (rt.fields || []).forEach(function (f) { allFields.push(f); }); });
    var childOf = F.childIndex(b, allFields);
    var parents = {}, rows = '';
    mapped.forEach(function (n) { if (!childOf[n]) parents[n] = []; });
    mapped.forEach(function (n) { var p = childOf[n]; if (p && parents[p]) parents[p].push(n); else if (p && !parents[p]) parents[n] = parents[n] || []; });
    Object.keys(parents).forEach(function (n) {
      rows += mapRow(b, n, 0);
      parents[n].forEach(function (c) { rows += mapRow(b, c, 1); });
    });

    // Fields declared in the layout that nothing feeds — the thing this screen
    // exists to surface.
    var unmappedOpts = C.fieldNames(b).filter(function (n) { return mapped.indexOf(n) < 0; });
    var noSource = mapped.filter(function (n) { return !(fmMap[n] || {}).source; });
    var missing = unmappedOpts.length + noSource.length;

    var unmappedList = unmappedOpts.length
      ? '<div class="map-unmapped">' + unmappedOpts.map(function (n) {
        return '<button class="map-unmapped-chip" data-action="cfg-map-quick" data-name="' + esc(n) + '">' +
          icon('plus', 14) + '<span class="mono">' + esc(n) + '</span></button>';
      }).join('') + '</div>'
      : '';

    // Source data the file does not use. Informational, collapsed.
    var used = {};
    mapped.forEach(function (n) { if (fmMap[n] && fmMap[n].source) used[fmMap[n].source] = true; });
    var unused = C.inputColumns(b).filter(function (c) { return !used[c]; });

    return taskHint() +
      '<div class="cfg-section-title">Data mapping</div>' +
      (missing
        ? '<div class="map-warn">' + icon('alert-triangle', 18) +
        '<span><strong><span class="num">' + missing + '</span> field' + (missing === 1 ? '' : 's') +
        ' in the file ha' + (missing === 1 ? 's' : 've') + ' no data mapped.</strong> Pick one below to map it.</span></div>' + unmappedList
        : '<div class="map-ok">' + icon('check-circle', 18) + '<span>Every field in the file has data mapped to it.</span></div>') +
      '<div class="map-grid">' +
      '<div class="map-head"><span>Data we have</span><span></span><span>Field in the file</span></div>' +
      (rows || '<div class="meta" style="padding:14px">Nothing mapped yet.</div>') +
      '</div>' +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<select class="input w-260" id="fmsel">' +
      (unmappedOpts.length ? unmappedOpts.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('')
        : '<option value="">— every field in the file is already mapped —</option>') + '</select>' +
      addBtn('Map another field', 'cfg-map-add', 'data-path="transform.field_mappings" data-sel="fmsel" data-tpl="fieldmap"') +
      '</div>' +
      (unused.length
        ? '<div class="map-unused">' +
        '<button class="map-unused-head" data-action="cfg-unused" aria-expanded="' + (S.cfg.unusedOpen ? 'true' : 'false') + '">' +
        icon(S.cfg.unusedOpen ? 'chevron-down' : 'chevron-right', 16) +
        'Source data this file does not use <span class="meta"><span class="num">' + unused.length + '</span> available</span></button>' +
        (S.cfg.unusedOpen
          ? '<div class="map-unused-body">' + unused.map(function (c) { return '<span class="mono map-chip">' + esc(c) + '</span>'; }).join('') + '</div>'
          : '') + '</div>'
        : '');
  }

  function groupSection(b, g, gi) {
    var p = 'transform.groups.' + gi;
    var role = F.roleOf(g.name);
    var open = grpOpen(g.name);
    var rts = F.recordTypesOf(g);
    var gf = g.fields || {};

    var head = '<div class="grp-head" data-action="cfg-grp" data-name="' + esc(g.name) + '">' +
      icon(open ? 'chevron-down' : 'chevron-right', 15) + icon(role.icon, 16) +
      '<strong>' + esc(role.label) + '</strong><span class="mono grp-name">' + esc(g.name) + '</span>' +
      '<span class="meta">' + rts.map(function (r) { return r.type; }).join(', ') +
      (rts.some(function (r) { return (r.conditions || []).length; }) ? ' · conditional' : '') +
      ' · ' + Object.keys(gf.constants || {}).length + ' constants · ' + (gf.derived || []).length + ' derived</span>' +
      (role.blurb ? '<span class="grp-blurb">' + esc(role.blurb) + '</span>' : '') +
      '</div>';
    if (!open) return '<div class="cfg-block grp-block">' + head + '</div>';

    var rtRows = rts.map(function (r, ri) {
      var rp = p + '.record_types.' + ri;
      var conds = (r.conditions || []).map(function (c, ci) {
        var cp = rp + '.conditions.' + ci;
        return '<div class="cond-row">' +
          txt(cp + '.field', c.field, { cls: 'mono w-160', list: 'dl-input-cols' }) +
          selIn(cp + '.operator', c.operator, F.OPERATORS, { cls: 'w-100' }) +
          tagList(cp + '.values', c.values, 'value…') +
          iconBtn('cfg-arr-del', 'trash-2', 'Remove condition', 'data-path="' + rp + '.conditions" data-idx="' + ci + '"') +
          '</div>';
      }).join('');
      return '<div class="rt-row">' +
        '<div class="row" style="gap:8px;align-items:center">' +
        '<span class="meta">emits record type</span>' + txt(rp + '.type', r.type, { cls: 'mono w-100', refresh: 'validation' }) +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove record type', 'data-path="' + p + '.record_types" data-idx="' + ri + '"') +
        '</div>' +
        (conds || '<div class="meta" style="padding:6px 0">No conditions — every row in this group emits this record type.</div>') +
        '<div class="mt-16">' + addBtn('Add condition', 'cfg-arr-add', 'data-path="' + rp + '.conditions" data-tpl="grpcond"') + '</div>' +
        '</div>';
    }).join('');

    var constRows = Object.keys(gf.constants || {}).map(function (k) {
      return '<tr><td class="mono de-code">' + esc(k) + '</td>' +
        '<td>' + txt(p + '.fields.constants.' + k, gf.constants[k], { cls: 'mono', ph: '(empty string)', refresh: 'validation' }) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Remove constant', 'data-path="' + p + '.fields.constants" data-key="' + esc(k) + '"') + '</td></tr>';
    }).join('');

    var derRows = (gf.derived || []).map(function (d, di) {
      var dp = p + '.fields.derived.' + di;
      var isLookup = d.type === 'config_lookup';
      return '<tr>' +
        '<td class="mono de-code">' + txt(dp + '.name', d.name, { cls: 'mono w-160', refresh: 'validation' }) +
        ((d.aliases || []).length ? '<span class="alias-chip">writes ' + esc((d.aliases || []).join(', ')) + '</span>' : '') + '</td>' +
        '<td>' + selIn(dp + '.type', d.type, F.DERIVED_TYPES, { cls: 'w-260', refresh: 'body' }) + '</td>' +
        '<td>' + (isLookup
          ? '<div class="lookup-editor">' +
          '<div class="lk-row"><span class="lk-label">lookup_columns</span>' + tagList(dp + '.params.lookup_columns', (d.params || {}).lookup_columns, 'key column…') + '</div>' +
          '<div class="lk-row"><span class="lk-label">result_index</span>' + txt(dp + '.params.result_index', (d.params || {}).result_index, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'validation' }) + '</div>' +
          '</div>'
          : paramsEditor(dp + '.params', d.params)) + '</td>' +
        '<td class="src-col">' + F.sourceBadge(F.resolveSource(b, d.name, g.name)) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove derived field', 'data-path="' + p + '.fields.derived" data-idx="' + di + '"') + '</td>' +
        '</tr>';
    }).join('');

    var emit = g.csv_config
      ? '<div class="field"><span>CSV</span><div class="sf-row">' + toggle(p + '.csv_config.include', g.csv_config.include, 'Include in the CSV output', { refresh: 'validation' }) + '</div></div>'
      : g.xml_config
        ? '<div class="cfg-grid-2">' +
        fld('XML element', txt(p + '.xml_config.element', g.xml_config.element, { cls: 'mono w-120' })) +
        '<div class="field"><span>Wrapper</span><div class="sf-row">' + toggle(p + '.xml_config.wrapper_only', g.xml_config.wrapper_only, 'Wrapper only (no fields of its own)', { refresh: 'validation' }) + '</div></div>' +
        '</div>'
        : '';

    return '<div class="cfg-block grp-block open">' + head +
      '<div class="grp-body">' +
      '<div class="cfg-section-title sm">Record types &amp; conditions</div>' +
      (rtRows || '<div class="meta">This group emits no record type of its own' + ((g.children || []).length ? ' — it wraps ' + esc((g.children || []).join(', ')) + '.' : '.') + '</div>') +
      '<div class="mt-16">' + addBtn('Add record type', 'cfg-arr-add', 'data-path="' + p + '.record_types" data-tpl="grprt"') + '</div>' +

      '<div class="cfg-grid-2 mt-24">' +
      '<div class="field"><span class="fld-cap">key</span>' + tagList(p + '.key', g.key, 'grouping column…') + '</div>' +
      '<div class="field"><span class="fld-cap">sort_by</span>' + tagList(p + '.sort_by', g.sort_by, 'sort column…') + '</div>' +
      '</div>' + emit +

      '<div class="cfg-section-title sm mt-24">fields.source <span class="meta">— input columns this group reads</span></div>' +
      tagList(p + '.fields.source', gf.source, 'input column…') +

      '<div class="cfg-section-title sm mt-24">fields.constants <span class="meta">— literal written into every record</span></div>' +
      '<table class="data cfg-sub-table"><thead><tr><th>Output field</th><th>Value</th><th></th></tr></thead><tbody>' +
      (constRows || '<tr><td colspan="3" class="meta" style="padding:12px">No constants.</td></tr>') + '</tbody></table>' +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<input class="input w-220" id="constsel-' + gi + '" placeholder="Output field, e.g. DE24" />' +
      addBtn('Add constant', 'cfg-map-add', 'data-path="' + p + '.fields.constants" data-sel="constsel-' + gi + '"') +
      '</div>' +

      '<div class="cfg-section-title sm mt-24">fields.derived <span class="meta">— computed at generation time</span></div>' +
      '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th>Name</th><th>Type</th><th>Params</th><th>' + srcHeader() + '</th><th></th></tr></thead><tbody>' +
      (derRows || '<tr><td colspan="5" class="meta" style="padding:12px">No derived fields.</td></tr>') + '</tbody></table></div>' +
      '<div class="mt-16">' + addBtn('Add derived field', 'cfg-arr-add', 'data-path="' + p + '.fields.derived" data-tpl="derived"') + '</div>' +
      '</div></div>';
  }

  function nfGroupMappings() {
    var e = edit(), b = e.body, tf = b.transform || {};
    var groups = tf.groups || [];
    return '<div class="cfg-section-title mt-24">Group mapping <span class="meta">— from <code>groups[]</code>: which record type each group emits and how its row is built</span></div>' +
      (groups.length
        ? groups.map(function (g, gi) { return groupSection(b, g, gi); }).join('')
        : '<div class="meta mb-16">No groups defined — the generator would emit no records.</div>') +
      '<div class="mt-16">' + addBtn('Add group', 'cfg-arr-add', 'data-path="transform.groups" data-tpl="group"') + '</div>';
  }

  function nfTransform() {
    var e = edit(), b = e.body;
    var tf = b.transform || (b.transform = { json_extractions: [], field_mappings: {}, groups: [], surcharge: { enabled: false, mappings: [] }, acquirer_profile: {} });
    var names = C.fieldNames(b);
    var inputs = C.inputColumns(b);

    var groups = (tf.json_extractions || []).map(function (g, i) {
      var gp = 'transform.json_extractions.' + i;
      var rows = (g.rows || []).map(function (r, j) {
        return '<tr>' +
          '<td>' + txt(gp + '.rows.' + j + '.json_key', r.json_key, { ph: 'json_key', cls: 'mono' }) + '</td>' +
          '<td class="arrow">' + icon('arrow-right', 14) + '</td>' +
          '<td>' + txt(gp + '.rows.' + j + '.output', r.output, { ph: 'output column', cls: 'mono', refresh: 'body' }) + '</td>' +
          '<td>' + (r.transform ? '<span class="mono meta">' + esc(r.transform) + '</span>' : '<span class="meta">—</span>') + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove row', 'data-path="' + gp + '.rows" data-idx="' + j + '"') + '</td></tr>';
      }).join('');
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head">' +
        '<label class="field inline">Source column ' + txt(gp + '.source_column', g.source_column, { cls: 'mono w-220', refresh: 'body' }) + '</label>' +
        '<span class="meta"><span class="num">' + (g.rows || []).length + '</span> keys extracted</span>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove extraction group', 'data-path="transform.json_extractions" data-idx="' + i + '"') +
        '</div>' +
        '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th>json_key</th><th></th><th>output column</th><th>transform</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5" class="meta" style="padding:14px">No mappings yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16">' + addBtn('Add mapping', 'cfg-arr-add', 'data-path="' + gp + '.rows" data-tpl="extrow"') + '</div></div>';
    }).join('');

    var sur = tf.surcharge || {};
    var surRows = (sur.mappings || []).map(function (r, j) {
      return '<tr><td>' + txt('transform.surcharge.mappings.' + j + '.source', r.source, { ph: 'source key', cls: 'mono' }) + '</td>' +
        '<td class="arrow">' + icon('arrow-right', 14) + '</td>' +
        '<td>' + txt('transform.surcharge.mappings.' + j + '.output', r.output, { list: 'dl-layout-fields', ph: 'layout field name' }) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove', 'data-path="transform.surcharge.mappings" data-idx="' + j + '"') + '</td></tr>';
    }).join('');

    var ttm = tf.transaction_type_mapping;
    var ttmBlock = ttm
      ? '<div class="cfg-section-title mt-24">Transaction type mapping <span class="meta">— business application codes per transaction type</span></div>' +
      '<div class="cfg-block"><div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th>Transaction type</th><th>Codes</th><th></th></tr></thead><tbody>' +
      Object.keys(ttm).map(function (k) {
        return '<tr><td class="mono">' + esc(k) + '</td>' +
          '<td>' + tagList('transform.transaction_type_mapping.' + k, ttm[k], 'code…') + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Remove', 'data-path="transform.transaction_type_mapping" data-key="' + esc(k) + '"') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>'
      : '';

    var ap = tf.acquirer_profile || {};
    return nfFieldMappings() +
      nfGroupMappings() +

      '<div class="cfg-section-title mt-24">JSON extractions <span class="meta">— pull keys out of a JSON column into named input columns</span></div>' +
      (groups || '<div class="meta mb-16">No extraction groups yet.</div>') +
      '<div class="mt-16">' + addBtn('Add extraction group', 'cfg-arr-add', 'data-path="transform.json_extractions" data-tpl="extraction"') + '</div>' +

      ttmBlock +

      '<div class="cfg-section-title mt-24">Surcharge</div>' +
      '<div class="cfg-block">' +
      '<div class="cfg-block-head">' + toggle('transform.surcharge.enabled', sur.enabled, 'Surcharge enabled', { refresh: 'body' }) + '</div>' +
      (sur.enabled
        ? '<table class="data cfg-sub-table"><thead><tr><th>Source</th><th></th><th>Output (layout field)</th><th></th></tr></thead><tbody>' +
        (surRows || '<tr><td colspan="4" class="meta" style="padding:14px">No surcharge mappings.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16">' + addBtn('Add mapping', 'cfg-arr-add', 'data-path="transform.surcharge.mappings" data-tpl="surrow"') + '</div>'
        : '<div class="meta">Surcharge is disabled for this config. Enable it to map surcharge fields into the file.</div>') +
      '</div>' +

      '<div class="cfg-section-title mt-24">Acquirer profile</div>' +
      '<div class="cfg-grid-3">' +
      fld('file_id', txt('transform.acquirer_profile.file_id', ap.file_id, { cls: 'mono' })) +
      fld('site_id', txt('transform.acquirer_profile.site_id', ap.site_id, { cls: 'mono' })) +
      fld('company_id', txt('transform.acquirer_profile.company_id', ap.company_id, { cls: 'mono' })) +
      fld('merchant_id', txt('transform.acquirer_profile.merchant_id', ap.merchant_id, { cls: 'mono' })) +
      fld('collection_method', txt('transform.acquirer_profile.collection_method', ap.collection_method, { cls: 'mono' })) +
      '</div>' +
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Everything outside these blocks lives in <strong>Raw</strong> mode. Field mapping writes one output field each; group mapping decides which record type is emitted and supplies the constants and derived values that mapping cannot.</div></div>' +
      dataList('dl-layout-fields', names) + dataList('dl-input-cols', inputs);
  }

  /* =======================================================================
     TAB BODIES — Family 2 · Settlement
     ======================================================================= */
  /* =======================================================================
     5.5 · Settlement — Tab 1 "When does it run?"
     The offset grammar (T-1, T+0) is replaced by plain controls. Nobody has to
     reason about T±n arithmetic: they change a control and read Next 5 runs.
     The bound paths are unchanged — this is a relabelling, not a new model.
     ======================================================================= */
  function offsetOptions() {
    var out = [];
    for (var n = -5; n <= 5; n++) {
      var label = n === 0 ? 'the report date'
        : (n < 0 ? Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' before the report date'
          : n + ' day' + (n === 1 ? '' : 's') + ' after the report date');
      out.push([X.fmtOffset(n), label]);
    }
    return out;
  }
  function runOffsetOptions() {
    var out = [];
    for (var n = -5; n <= 5; n++) {
      var label = n === 0 ? 'the same day'
        : (n < 0 ? Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' earlier'
          : n + ' day' + (n === 1 ? '' : 's') + ' later');
      out.push([X.fmtOffset(n), label]);
    }
    return out;
  }

  function schedBlock(block, prefix, isRule) {
    var td = block.transaction_date || {};
    return '<div class="sched-plain">' +
      '<div class="sched-line"><span class="sched-lead">This report covers transactions from</span></div>' +
      '<div class="sched-line indent">' +
      selIn(prefix + '.transaction_date.from.offset', (td.from || {}).offset, offsetOptions(), { cls: 'w-260', refresh: 'preview' }) +
      '<span class="sched-kw">at</span>' +
      txt(prefix + '.transaction_date.from.time', (td.from || {}).time, { cls: 'mono w-120', ph: 'HH:MM:SS', refresh: 'preview' }) +
      '</div>' +
      '<div class="sched-line"><span class="sched-lead">through</span></div>' +
      '<div class="sched-line indent">' +
      selIn(prefix + '.transaction_date.to.offset', (td.to || {}).offset, offsetOptions(), { cls: 'w-260', refresh: 'preview' }) +
      '<span class="sched-kw">at</span>' +
      txt(prefix + '.transaction_date.to.time', (td.to || {}).time, { cls: 'mono w-120', ph: 'HH:MM:SS', refresh: 'preview' }) +
      '</div>' +
      '<div class="sched-line mt-16">' +
      '<span class="sched-lead">The report is generated on</span>' +
      selIn(prefix + '.report_offset', block.report_offset, runOffsetOptions(), { cls: 'w-200', refresh: 'preview' }) +
      '</div>' +
      '<div class="sched-toggles">' +
      kit.opsToggle('cfgc-set', block.saturdays_off, 'Skip Saturdays', ' data-path="' + esc(prefix + '.saturdays_off') + '" data-cast="bool" data-refresh="preview"') +
      kit.opsToggle('cfgc-set', block.sundays_off, 'Skip Sundays', ' data-path="' + esc(prefix + '.sundays_off') + '" data-cast="bool" data-refresh="preview"') +
      kit.opsToggle('cfgc-set', block.apply_general_holiday, 'Skip bank holidays', ' data-path="' + esc(prefix + '.apply_general_holiday') + '" data-cast="bool" data-refresh="preview"') +
      '</div></div>';
  }

  /* The live preview — the single most valuable element on this screen.
     It recalculates on every change, so nobody derives a run date by hand. */
  function schedulePreviewHtml() {
    var e = edit(), b = e.body, blk = (b && b['default']) || {}, tz = b ? b.timezone : null;
    var sample = S.cfg.sampleDate;
    var runs = X.nextRuns(blk, tz, sample, 8).filter(function (x) { return true; }).slice(0, 8);
    function d(v) { return v ? U.prettyDate(v) : '<span class="bad-text">check the times above</span>'; }
    // "Next 5 runs" means five that actually fire; skipped days are shown in
    // place so the reason a date is missing is never a mystery.
    var shown = 0, rows = '';
    runs.forEach(function (x) {
      if (shown >= 5 && x.fires) return;
      if (shown >= 5) return;
      if (x.fires) shown++;
      rows += '<tr class="' + (x.fires ? '' : 'skipped') + '">' +
        '<td class="nowrap num">' + U.prettyDate(x.runDate) + ' ' + esc((blk.transaction_date || {}).to && blk.report_time ? '' : '') +
        '<div class="cell-sub">' + x.dow + '</div></td>' +
        '<td class="nowrap num">' + (x.fires ? d(x.fromDate) + ' <span class="mono">' + esc(x.fromTime) + '</span>' : '—') + '</td>' +
        '<td class="nowrap num">' + (x.fires ? d(x.toDate) + ' <span class="mono">' + esc(x.toTime) + '</span>' : '—') + '</td>' +
        '<td>' + (x.fires ? pill('Runs', 'success', 'check-circle')
          : pill('Skipped', 'neutral', 'pause') + '<div class="cell-sub">' + esc(x.skipReason || '') + '</div>') + '</td></tr>';
    });

    return '<div class="sched-preview" id="cfgSchedPreview">' +
      '<div class="sp-head">' + icon('calendar-search', 18) + '<strong>Next 5 runs</strong>' +
      '<span class="meta">Recalculates on every change · ' + esc(tz || '—') +
      ' · holidays from the ' + esc(C.TZ_COUNTRY[tz] || '—') + ' calendar</span>' +
      '<label class="field inline" style="margin-left:auto">Starting from <input class="input w-160" type="date" value="' + esc(sample) + '" data-action="cfgc-sample" /></label>' +
      '</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Runs on</th><th>Covers transactions from</th><th>to</th><th></th>' +
      /* Part 1.1 — the sentence that used to sit under this table is gone.
         Where the holidays come from belongs beside the timezone in the header,
         not in a line beneath the visual. */
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>';
  }

  // Schedule variants (JV1_FEE_DATE / JV1_NON_FEE_DATE …) are variants of ONE
  // report, so they are a sub-selector inside the Schedule tab rather than extra
  // top-level list rows (§5).
  function variantBar(item) {
    if (!item || item.schedules.length < 2) {
      return item && item.schedules.length === 1 && item.schedules[0].variant
        ? '<div class="variant-bar single">' + icon('git-branch', 14) +
        '<span class="meta">Schedule variant</span><span class="variant-chip active">' + esc(item.schedules[0].variant.replace(/_/g, ' ').toLowerCase()) + '</span></div>'
        : '';
    }
    var cur = stScheduleCfg(item);
    return '<div class="variant-bar">' + icon('git-branch', 14) +
      '<span class="meta">Schedule variant</span>' +
      item.schedules.map(function (c) {
        var label = c.variant ? c.variant.replace(/_/g, ' ').toLowerCase() : 'default';
        return '<button class="variant-chip' + (c.configId === cur.configId ? ' active' : '') + '" ' +
          'data-action="cfg-variant" data-id="' + c.configId + '">' + esc(label) +
          (c.state !== 'ACTIVE' ? '<span class="tab-dot ' + (TAB_DOT[c.state] || 'info') + '"></span>' : '') + '</button>';
      }).join('') +
      '<span class="meta variant-note">Both variants are keys in <code>settlement_generator.json → report_configs</code> for this report.</span>' +
      '</div>';
  }
  function feeBar(item) {
    if (!item || item.fees.length < 2) return '';
    var cur = stFeeCfg(item);
    return '<div class="variant-bar">' + icon('layers', 14) +
      '<span class="meta">Fee group</span>' +
      item.fees.map(function (c) {
        return '<button class="variant-chip' + (c.configId === cur.configId ? ' active' : '') + '" ' +
          'data-action="cfg-feesel" data-id="' + c.configId + '">' + esc(c.name.split(' · ').pop()) + '</button>';
      }).join('') + '</div>';
  }

  function stSchedule() {
    var e = edit(), b = e.body;
    var rules = (b.rules || []).map(function (r, i) {
      var p = 'rules.' + i;
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head"><div class="row" style="gap:10px;align-items:center">' + icon('git-branch', 15) + '<strong>Exception ' + (i + 1) + '</strong></div>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete exception', 'data-path="rules" data-idx="' + i + '"') + '</div>' +
        '<div class="ifthen-row mb-16"><span class="ifthen-kw">When</span>' +
        txt(p + '.match.field', (r.match || {}).field, { ph: 'e.g. merchant_category', list: 'dl-txn-cols', cls: 'w-220' }) +
        '<span class="ifthen-kw">is</span>' +
        txt(p + '.match.value', (r.match || {}).value, { ph: 'e.g. AIRLINE', cls: 'w-160' }) +
        '<span class="ifthen-kw">use this schedule instead</span></div>' +
        schedBlock(r, p, true) + '</div>';
    }).join('');

    return taskHint() + variantBar(stItem()) +
      '<div class="cfg-grid-3">' +
      fld('Which report', selIn('report', b.report, C.REPORTS, { refresh: 'preview' })) +
      fld('Time zone', selIn('timezone', b.timezone, C.TIMEZONES, { refresh: 'preview' })) +
      '</div>' +
      '<div class="cfg-block mt-16">' + schedBlock(b['default'] || {}, 'default') + '</div>' +
      '<div class="mt-24">' + schedulePreviewHtml() + '</div>' +
      '<div class="cfg-section-title mt-24">Exceptions <span class="meta">— applied before the schedule above when they match</span></div>' +
      (rules || '<div class="meta mb-16">None. The schedule above applies to every run.</div>') +
      '<div class="mt-16">' + addBtn('Add an exception', 'cfg-arr-add', 'data-path="rules" data-tpl="schedrule"') + '</div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  /* =======================================================================
     5.5 · Settlement — Tab 2 "What's in the report?"
     A two-column mapping in the same pattern as the network-file data mapping,
     oriented to report columns, plus a sample of what the generated file would
     look like. The mapping is abstract; three rows of output are not.
     ======================================================================= */
  function sampleValueFor(col) {
    var n = String(col || '').toLowerCase();
    if (/txn_id|transaction_id|id$/.test(n)) return ['TXN90114882', 'TXN90114883', 'TXN90114884'];
    if (/arn/.test(n)) return ['74512345678901234567890', '74512345678901234567891', '74512345678901234567892'];
    if (/date|time/.test(n)) return ['2026-07-28', '2026-07-28', '2026-07-29'];
    if (/amount|gross|net|value/.test(n)) return ['12,450.00', '3,980.50', '87,200.00'];
    if (/fee|interchange|mdr|commission|charge/.test(n)) return ['205.43', '65.68', '1,438.80'];
    if (/name|merchant|legal/.test(n)) return ['Croma Retail', 'Reliance Digital', 'Tanishq'];
    if (/mid|merchant_id/.test(n)) return ['MID884120', 'MID884121', 'MID884122'];
    if (/mcc|category/.test(n)) return ['5732', '5732', '5944'];
    if (/network|scheme/.test(n)) return ['MASTERCARD', 'VISA', 'RUPAY'];
    if (/currency/.test(n)) return ['INR', 'INR', 'INR'];
    if (/status|flag|indicator/.test(n)) return ['SETTLED', 'SETTLED', 'PENDING'];
    return ['—', '—', '—'];
  }

  function sampleOutput(cols) {
    if (!cols.length) return '';
    var head = cols.map(function (c) {
      return '<th>' + esc(c.alias || c.column) + '</th>';
    }).join('');
    var body = '';
    for (var r = 0; r < 3; r++) {
      body += '<tr>' + cols.map(function (c) {
        return '<td class="mono">' + esc(sampleValueFor(c.column)[r]) + '</td>';
      }).join('') + '</tr>';
    }
    /* Part 1.1 — no line beneath the table. That these are three illustrative
       rows is said in the section title, where it belongs. */
    return '<div class="cfg-section-title mt-24">What the file would look like ' +
      '<span class="meta">— three illustrative rows</span></div>' +
      '<div class="sample-out"><div class="table-wrap"><table class="data sample-out-table"><thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }

  function stContent() {
    var e = edit(), b = e.body;
    var cols = b['select'] || (b['select'] = []);

    // Two-column mapping: the report column on the left, where it comes from on
    // the right. Drag to reorder — the order here is the column order in the file.
    var rows = cols.map(function (c, i) {
      var known = C.TXN_COLUMNS.indexOf(c.column) >= 0;
      return '<div class="map-row report" draggable="true" data-dnd="select" data-idx="' + i + '">' +
        '<span class="map-grip">' + icon('grip-vertical', 16) + '</span>' +
        '<div class="map-left">' +
        txt('select.' + i + '.alias', c.alias, { ph: c.column || 'Column name in the report' }) +
        '</div>' +
        '<div class="map-arrow">' + icon('arrow-left', 18) + '</div>' +
        '<div class="map-right">' +
        txt('select.' + i + '.column', c.column, { list: 'dl-txn-cols', cls: 'mono' + (known ? '' : ' bad') }) +
        (known ? '' : '<div class="inline-warn">' + icon('alert-triangle', 13) + 'Not a column the platform knows</div>') +
        '</div>' +
        '<div class="map-detail">' +
        iconBtn('cfg-arr-move', 'chevron-up', 'Move up', 'data-path="select" data-idx="' + i + '" data-dir="-1"') +
        iconBtn('cfg-arr-move', 'chevron-down', 'Move down', 'data-path="select" data-idx="' + i + '" data-dir="1"') +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove column', 'data-path="select" data-idx="' + i + '"') +
        '</div></div>';
    }).join('');

    // Eligibility filters as plain rows.
    var flags = (b.eligibility_flags || []).map(function (f, i) {
      return '<div class="ifthen-row"><span class="ifthen-kw">Only include transactions where</span>' +
        '<span class="ifthen-field mono">' + esc(f) + '</span>' +
        '<span class="ifthen-kw">is true</span>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove condition', 'data-path="eligibility_flags" data-idx="' + i + '"') +
        '</div>';
    }).join('');

    // JSON fetch groups stay — they are how nested source data is pulled in.
    var fetch = (b.json_fetch || []).map(function (g, i) {
      var p = 'json_fetch.' + i;
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head"><label class="field inline">Pull extra data from ' + selIn(p + '.source', g.source, C.SOURCE_COLUMNS, { cls: 'w-220' }) + '</label>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove', 'data-path="json_fetch" data-idx="' + i + '"') + '</div>' +
        '<div class="field"><span class="fld-cap">Keys to read</span>' + tagList(p + '.keys', g.keys, 'Add key…') + '</div>' +
        '</div>';
    }).join('');

    return taskHint() +
      '<div class="cfg-section-title">Columns in this report</div>' +
      '<div class="meta mb-16">Drag to change the order columns appear in the file.</div>' +
      '<div class="map-grid" data-dnd-table="select">' +
      '<div class="map-head"><span></span><span>Column in the report</span><span></span><span>Comes from</span></div>' +
      (rows || '<div class="meta" style="padding:14px">No columns yet.</div>') +
      '</div>' +
      '<div class="mt-16">' + addBtn('Add column', 'cfg-arr-add', 'data-path="select" data-tpl="selcol"') + '</div>' +
      sampleOutput(cols) +
      '<div class="cfg-section-title mt-24">Which transactions are included</div>' +
      '<div class="ifthen-list">' + (flags || '<div class="meta" style="padding:12px">Every settled transaction for this entity.</div>') + '</div>' +
      '<div class="mt-16">' + tagList('eligibility_flags', [], 'Add a condition, e.g. in_mpr') + '</div>' +
      '<div class="cfg-section-title mt-24">Extra source data</div>' +
      (fetch || '<div class="meta mb-16">None.</div>') +
      '<div class="mt-16">' + addBtn('Pull in more data', 'cfg-arr-add', 'data-path="json_fetch" data-tpl="fetch"') + '</div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  /* =======================================================================
     5.5 · Settlement — Tab 3 "Fee rules"
     Every rule is a card, not a table row: what it applies to and what it
     charges, both as plain statements. A calculator underneath makes the rules
     testable without generating a report.
     ======================================================================= */
  var COND_WORD = {
    equals: 'is', not_equals: 'is not', in: 'is one of', not_in: 'is not one of',
    greater_than: 'is more than', less_than: 'is less than',
    greater_than_equals: 'is at least', less_than_equals: 'is at most'
  };
  function condSentence(c) {
    var word = COND_WORD[c.condition] || (c.condition || 'is');
    return prettyKey(c.field) + ' ' + word + ' ' + (c.value === '' || c.value == null ? '—' : c.value);
  }
  // Config keys read as words. Falls back to the key with underscores removed,
  // so a key nobody has labelled yet still reads better than raw.
  var KEY_LABEL = {
    merchant_category: 'Merchant category', card_type: 'Card type', network: 'Network',
    txn_amount: 'Amount', amount: 'Amount', region: 'Region', txn_type: 'Transaction type',
    payment_method: 'Payment method', currency: 'Currency', mcc: 'Merchant category code',
    is_international: 'International', entry_mode: 'Entry mode'
  };
  function prettyKey(k) {
    if (!k) return '—';
    if (KEY_LABEL[k]) return KEY_LABEL[k];
    return String(k).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  var FEE_MODE_WORD = {
    DEDUCT_FROM_SETTLEMENT: 'deducted from settlement',
    PASS_THROUGH: 'passed through',
    COLLECT_FROM_CARDHOLDER: 'collected from the cardholder',
    INVOICE: 'invoiced'
  };
  // What a rule charges, as one sentence when it is flat.
  function chargeSentence(r) {
    var calc = r.calculations || {}, logic = calc.logic || [];
    if (calc.slab_based && logic.length > 1) return null;      // needs the tier table
    var l = logic[0];
    if (!l) return 'Nothing — no calculation is configured.';
    var parts = [];
    if (l.percentage != null && +l.percentage !== 0) parts.push(Number(l.percentage).toFixed(2) + '% of the ' + prettyKey(l.field || 'amount').toLowerCase());
    if (l.flat != null && +l.flat !== 0) parts.push('₹' + Number(l.flat).toFixed(2));
    if (!parts.length) parts.push('0%');
    return parts.join(' plus ');
  }
  // Overlap validation surfaced inline, in plain language.
  function tierOverlaps(logic) {
    var out = {};
    for (var i = 1; i < logic.length; i++) {
      var prev = logic[i - 1], cur = logic[i];
      var prevMax = prev.max == null ? Infinity : +prev.max;
      if (+cur.min < prevMax) {
        out[i] = 'This tier overlaps the previous one between ₹' +
          Number(cur.min).toLocaleString('en-IN') + ' and ₹' +
          (prevMax === Infinity ? '∞' : Number(prevMax).toLocaleString('en-IN')) + '.';
      }
    }
    return out;
  }

  function feeRuleCard(r, i) {
    var p = 'txn_rules.' + i;
    var calc = r.calculations || {}, logic = calc.logic || [];
    var open = S.cfg.expandedRule === i;
    var conds = (r.conditions || []);
    var charge = chargeSentence(r);
    var overlaps = tierOverlaps(logic);

    var condRows = conds.length
      ? conds.map(function (c) { return '<span class="fee-cond">' + esc(condSentence(c)) + '</span>'; }).join('')
      : '<span class="fee-cond all">Every transaction</span>';

    var tierTable = charge === null
      ? '<div class="table-wrap"><table class="data cfg-sub-table fee-tiers"><thead><tr>' +
      '<th class="num">From</th><th class="num">To</th><th class="num">Rate</th><th></th></tr></thead><tbody>' +
      logic.map(function (l, li) {
        return '<tr' + (overlaps[li] ? ' class="bad-row"' : '') + '>' +
          '<td class="num">₹' + esc(Number(l.min || 0).toLocaleString('en-IN')) + '</td>' +
          '<td class="num">' + (l.max == null ? 'no upper limit' : '₹' + esc(Number(l.max).toLocaleString('en-IN'))) + '</td>' +
          '<td class="num">' + esc(Number(l.percentage || 0).toFixed(2)) + '%</td>' +
          '<td>' + (overlaps[li] ? '<span class="inline-warn">' + icon('alert-triangle', 14) + esc(overlaps[li]) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '';

    var editor = open
      ? '<div class="fee-editor">' +
      '<div class="cfg-grid-4">' +
      fld('Rule name', txt(p + '.model', r.model)) +
      fld('How the fee is taken', selIn(p + '.fee_mode', r.fee_mode, Object.keys(FEE_MODE_WORD).map(function (k) { return [k, FEE_MODE_WORD[k].replace(/^./, function (c) { return c.toUpperCase(); })]; }))) +
      fld('Priority', txt(p + '.priority', r.priority, { type: 'number', cast: 'int', cls: 'num' }), 'Lower numbers are checked first') +
      fld('Effective from', txt(p + '.starting_date', r.starting_date, { type: 'date' })) +
      '</div>' +
      '<div class="cfg-section-title sm mt-24">When it applies</div>' +
      '<table class="data cfg-sub-table"><thead><tr><th>Field</th><th>Condition</th><th>Value</th><th></th></tr></thead><tbody>' +
      (conds.map(function (c, ci) {
        return '<tr><td>' + txt(p + '.conditions.' + ci + '.field', c.field, { list: 'dl-txn-cols' }) + '</td>' +
          '<td>' + selIn(p + '.conditions.' + ci + '.condition', c.condition, C.CONDITIONS.map(function (k) { return [k, COND_WORD[k] || k]; }), { cls: 'w-140' }) + '</td>' +
          '<td>' + txt(p + '.conditions.' + ci + '.value', c.value) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove condition', 'data-path="' + p + '.conditions" data-idx="' + ci + '"') + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="meta" style="padding:12px">No conditions — this rule matches every transaction.</td></tr>') +
      '</tbody></table>' +
      '<div class="mt-16">' + addBtn('Add condition', 'cfg-arr-add', 'data-path="' + p + '.conditions" data-tpl="cond"') + '</div>' +
      '<div class="cfg-section-title sm mt-24">What it charges</div>' +
      '<div class="row" style="gap:16px;align-items:center;margin-bottom:12px">' +
      kit.opsToggle('cfgc-set', calc.slab_based, 'Charge different rates by amount', ' data-path="' + esc(p + '.calculations.slab_based') + '" data-cast="bool" data-refresh="body"') +
      '<label class="field inline">Fee type ' + selIn(p + '.calculations.fee_type', calc.fee_type,
        [['PERCENTAGE', 'A percentage'], ['FLAT', 'A flat amount'], ['PERCENTAGE_PLUS_FLAT', 'A percentage plus a flat amount']], { cls: 'w-260' }) + '</label>' +
      '</div>' +
      '<table class="data cfg-sub-table"><thead><tr><th class="num">From amount</th><th class="num">To amount</th><th>Applied to</th><th class="num">Rate %</th><th></th></tr></thead><tbody>' +
      (logic.map(function (l, li) {
        return '<tr><td class="num">' + txt(p + '.calculations.logic.' + li + '.min', l.min, { type: 'number', cast: 'number', cls: 'num w-100' }) + '</td>' +
          '<td class="num">' + txt(p + '.calculations.logic.' + li + '.max', l.max, { type: 'number', cast: 'nullable-number', cls: 'num w-100', ph: 'no limit' }) + '</td>' +
          '<td>' + txt(p + '.calculations.logic.' + li + '.field', l.field, { list: 'dl-txn-cols' }) + '</td>' +
          '<td class="num">' + txt(p + '.calculations.logic.' + li + '.percentage', l.percentage, { type: 'number', cast: 'number', cls: 'num w-100' }) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove tier', 'data-path="' + p + '.calculations.logic" data-idx="' + li + '"') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="meta" style="padding:12px">No calculation rows.</td></tr>') +
      '</tbody></table>' +
      '<div class="mt-16">' + addBtn('Add a tier', 'cfg-arr-add', 'data-path="' + p + '.calculations.logic" data-tpl="calc"') + '</div>' +
      '</div>'
      : '';

    return '<div class="fee-card' + (open ? ' open' : '') + '">' +
      '<div class="fee-card-head">' +
      '<div class="fee-card-title">' + esc(r.model || 'Unnamed rule') + '</div>' +
      '<span class="meta">Priority <span class="num">' + (r.priority == null ? '—' : r.priority) + '</span></span>' +
      '<span class="meta">From ' + esc(r.starting_date || '—') + '</span>' +
      '<span class="fee-card-spacer"></span>' +
      '<button class="btn btn-sm btn-secondary" data-action="cfg-fee-expand" data-idx="' + i + '">' +
      icon(open ? 'chevron-up' : 'pencil', 16) + (open ? 'Done' : 'Edit') + '</button>' +
      iconBtn('cfg-arr-del', 'trash-2', 'Delete rule', 'data-path="txn_rules" data-idx="' + i + '"') +
      '</div>' +
      '<div class="fee-card-body">' +
      '<div class="fee-block"><span class="fee-block-label">When it applies</span><div class="fee-conds">' + condRows + '</div></div>' +
      '<div class="fee-block"><span class="fee-block-label">What it charges</span>' +
      (charge === null ? tierTable : '<div class="fee-charge">' + esc(charge) + '</div>') +
      '<div class="meta">' + esc((FEE_MODE_WORD[r.fee_mode] || r.fee_mode || '').replace(/^./, function (c) { return c.toUpperCase(); })) + '</div>' +
      '</div></div>' +
      editor + '</div>';
  }

  /* The fee calculator (Part 5.5) — enter an amount, pick attributes, see which
     rule matches and what it charges. Mocked against the rules on screen: it
     applies the same priority-then-conditions logic the engine does. */
  function matchRule(rules, ctx) {
    var ordered = rules.slice().sort(function (a, b) { return (a.priority == null ? 999 : a.priority) - (b.priority == null ? 999 : b.priority); });
    for (var i = 0; i < ordered.length; i++) {
      var r = ordered[i], ok = true;
      (r.conditions || []).forEach(function (c) {
        var v = ctx[c.field];
        if (v === undefined) { ok = false; return; }
        var want = String(c.value == null ? '' : c.value);
        var cond = c.condition;
        if (cond === 'equals') { if (String(v).toLowerCase() !== want.toLowerCase()) ok = false; }
        else if (cond === 'not_equals') { if (String(v).toLowerCase() === want.toLowerCase()) ok = false; }
        else if (cond === 'in' || cond === 'not_in') {
          var list = want.split(/[,|]/).map(function (x) { return x.trim().toLowerCase(); });
          var hit = list.indexOf(String(v).toLowerCase()) >= 0;
          if (cond === 'in' ? !hit : hit) ok = false;
        }
        else if (cond === 'greater_than') { if (!(+v > +want)) ok = false; }
        else if (cond === 'less_than') { if (!(+v < +want)) ok = false; }
        else if (cond === 'greater_than_equals') { if (!(+v >= +want)) ok = false; }
        else if (cond === 'less_than_equals') { if (!(+v <= +want)) ok = false; }
      });
      if (ok) return r;
    }
    return null;
  }
  function feeCalculator(rules) {
    var fc = S.cfg.feeCalc;
    var ctx = {
      txn_amount: fc.amount, amount: fc.amount, network: fc.network,
      card_type: fc.card, payment_method: fc.card, currency: 'INR'
    };
    var hit = matchRule(rules, ctx);
    var result;
    if (!hit) {
      result = '<div class="calc-result none">' + icon('help-circle', 18) +
        '<span>No rule matches these attributes — nothing would be charged.</span></div>';
    } else {
      var logic = (hit.calculations || {}).logic || [];
      var tier = logic.filter(function (l) {
        return fc.amount >= (+l.min || 0) && (l.max == null || fc.amount <= +l.max);
      })[0] || logic[0];
      var pctv = tier ? +tier.percentage || 0 : 0;
      var flat = tier && tier.flat ? +tier.flat : 0;
      var fee = (fc.amount * pctv / 100) + flat;
      result = '<div class="calc-result">' + icon('check-circle', 18) +
        '<div><div class="calc-rule">Matches <strong>' + esc(hit.model || 'rule') + '</strong>' +
        (tier && logic.length > 1 ? ' · tier ₹' + Number(tier.min || 0).toLocaleString('en-IN') +
          (tier.max == null ? ' and above' : '–₹' + Number(tier.max).toLocaleString('en-IN')) : '') + '</div>' +
        '<div class="calc-fee num">₹' + fee.toFixed(2) + '</div>' +
        '<div class="meta">' + pctv.toFixed(2) + '% of ₹' + Number(fc.amount).toLocaleString('en-IN') +
        (flat ? ' plus ₹' + flat.toFixed(2) : '') + ' · ' +
        esc(FEE_MODE_WORD[hit.fee_mode] || hit.fee_mode || '') + '</div></div></div>';
    }
    return '<div class="fee-calc">' +
      '<div class="fee-calc-head">' + icon('calculator', 18) + '<strong>Fee calculator</strong>' +
      '<span class="meta">Check what a transaction would be charged, without generating a report.</span></div>' +
      '<div class="fee-calc-row">' +
      '<label class="field inline">Amount (₹)<input class="input num w-160" type="number" value="' + fc.amount + '" data-action="cfgi-calc-amount" /></label>' +
      '<label class="field inline">Network' + selIn('__calc.network', fc.network, ['Visa', 'Mastercard', 'RuPay'], { cls: 'w-160' }).replace('data-action="cfgc-set"', 'data-action="cfgc-calc-network"') + '</label>' +
      '<label class="field inline">Card type' + selIn('__calc.card', fc.card, ['Credit', 'Debit', 'Prepaid'], { cls: 'w-160' }).replace('data-action="cfgc-set"', 'data-action="cfgc-calc-card"') + '</label>' +
      '</div>' + result + '</div>';
  }

  function stFees() {
    var e = edit(), b = e.body, rules = b.txn_rules || (b.txn_rules = []);
    var item = stItem();
    return taskHint() + feeBar(item) +
      (item ? '<div class="callout info mb-16">' + icon('info', 18) + '<div class="callout-body">These rules apply to every ' +
        esc((C.tenantByKey[item.tenantId] || {}).name || item.tenantId) + ' report, not just this one.</div></div>' : '') +
      '<div class="cfg-section-title">Fee rules</div>' +
      '<div class="fee-cards">' +
      (rules.map(feeRuleCard).join('') || '<div class="meta" style="padding:14px">No fee rules yet.</div>') +
      '</div>' +
      '<div class="mt-16">' + addBtn('Add a fee rule', 'cfg-arr-add', 'data-path="txn_rules" data-tpl="feerule"') + '</div>' +
      '<div class="mt-24">' + feeCalculator(rules) + '</div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  /* =======================================================================
     TAB BODIES — Family 3 · Incoming Parsing
     ======================================================================= */
  /* Incoming configs get the same format-awareness as outgoing ones (§4): the
     referenced layout's own "format" key decides whether positions, a record
     length and a byte map mean anything at all. */
  function fmtChip(fmt) {
    var c = F.caps(fmt);
    return '<span class="tip fmt-chip" data-tip="' + esc(c.blurb + '  —  ' + c.grounding) + '">' + icon(c.icon, 12) + esc(c.label) + '</span>';
  }

  // Show what a filename pattern resolves to today, so it can be eyeballed
  // against a real file listing.
  function expandPattern(pat) {
    var d = U.fromYmd(D.TODAY);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return String(pat)
      .replace(/%Y/g, String(d.getUTCFullYear()))
      .replace(/%m/g, p2(d.getUTCMonth() + 1))
      .replace(/%d/g, p2(d.getUTCDate()))
      .replace(/%H/g, '22').replace(/%M/g, '30');
  }

  function ipPipeline() {
    var e = edit(), b = e.body;
    var ref = b.layout_ref ? C.byId[b.layout_ref] : null;
    var refNames = ref ? C.fieldNames(ref.body) : [];
    var refFmt = ref ? F.formatOf(ref.body) : (b.source_format || 'fixed_width');
    var refCaps = F.caps(refFmt);
    var secField = (b.sectioning || {}).field;
    var secBad = ref && secField && refNames.indexOf(secField) < 0;
    var mismatch = ref && b.source_format && b.source_format !== refFmt;

    // Part 5.4 — "If [field] is [value] → treat as [record type]". A dropdown
    // per part, no JSON, and the same bound paths as before.
    var secRules = ((b.sectioning || {}).rules || []).map(function (r, i) {
      return '<div class="ifthen-row">' +
        '<span class="ifthen-kw">If</span>' +
        '<span class="ifthen-field mono">' + esc((b.sectioning || {}).field || 'the sectioning field') + '</span>' +
        '<span class="ifthen-kw">is</span>' +
        txt('sectioning.rules.' + i + '.match', r.match, { cls: 'mono w-120' }) +
        '<span class="ifthen-arrow">' + icon('arrow-right', 16) + '</span>' +
        '<span class="ifthen-kw">treat as</span>' +
        txt('sectioning.rules.' + i + '.bucket', r.bucket, { cls: 'mono w-160' }) +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove rule', 'data-path="sectioning.rules" data-idx="' + i + '"') +
        '</div>';
    }).join('');

    var agg = b.aggregation || {};
    var layoutOpts = [['', '— none —']].concat(C.layoutConfigs().map(function (c) {
      return [c.configId, c.name + '  (' + F.formatOf(c.body) + ')'];
    }));

    // Structure summary in place of the byte map for non-positional sources.
    var structure = '';
    if (ref) {
      if (refCaps.byteMap) {
        structure = '<div class="bm-mini">' + X.byteMapHtml(ref.body.record_length, (ref.body.record_types[0] || {}).fields,
          { compact: true, title: 'Referenced byte map · record type ' + esc((ref.body.record_types[0] || {}).record_type || '?') }) + '</div>';
      } else {
        structure = '<div class="struct-summary">' +
          '<div class="ss-head">' + icon(refCaps.icon, 14) + '<strong>' + esc(refCaps.label) + ' structure</strong>' +
          '<span class="meta">no byte positions — nothing to rule off</span></div>' +
          '<div class="ss-rows">' + (ref.body.record_types || []).map(function (rt) {
            return '<div class="ss-row"><span class="mono ss-rt">' + esc(rt.record_type) + '</span>' +
              (rt.xml_element ? '<span class="meta mono">&lt;' + esc(rt.xml_element) + '&gt;</span>' : '') +
              '<span class="meta">' + (rt.fields || []).length + ' field' + ((rt.fields || []).length === 1 ? '' : 's') + '</span>' +
              '<span class="ss-names mono">' + esc((rt.fields || []).slice(0, 8).map(function (f) { return f.name; }).join(', ')) +
              ((rt.fields || []).length > 8 ? ' …' : '') + '</span></div>';
          }).join('') + '</div></div>';
      }
    }

    return taskHint() + '<div class="cfg-grid-4">' +
      fld('Gateway', txt('gateway', b.gateway)) +
      fld('Network', txt('network', b.network)) +
      fld('Direction', selIn('direction', b.direction, ['INCOMING', 'OUTGOING'])) +
      fld('Pipeline kind', selIn('pipeline_kind', b.pipeline_kind, ['clearing', 'acknowledgment', 'chargeback', 'settlement', 'aggregator'])) +
      '</div>' +

      // Part 5.4 — a tag list of filename patterns, each with an example of
      // what it actually matches. A pattern nobody can read is a pattern nobody
      // can check.
      '<div class="cfg-section-title mt-24">Expected file names</div>' +
      tagList('ack_filenames', b.ack_filenames, 'Add a pattern, e.g. VISA_ACK_%Y%m%d.txt') +
      ((b.ack_filenames || []).length
        ? '<div class="fname-examples">' + (b.ack_filenames || []).map(function (pat) {
          return '<div class="fname-row"><code class="mono">' + esc(pat) + '</code>' +
            icon('arrow-right', 14) +
            '<span class="meta">matches <code class="mono">' + esc(expandPattern(pat)) + '</code></span></div>';
        }).join('') + '</div>'
        : '') +
      '<div class="meta hint-row mt-16">' + icon('info', 13) +
      '<span>%Y year · %m month · %d day · %H hour · %M minute. A pattern with no date token matches one literal name.</span></div>' +

      '<div class="cfg-section-title mt-24">Source format &amp; layout reference</div>' +
      '<div class="cfg-block">' +
      '<div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<label class="field" style="min-width:200px">Source format ' +
      selIn('source_format', b.source_format || 'fixed_width', F.ALL_FORMAT_KEYS.map(function (k) { return [k, F.FORMATS[k].label + '  (' + k + ')']; }), { refresh: 'body' }) +
      '<span class="fld-hint">' + esc(F.caps(b.source_format || 'fixed_width').blurb) + '</span></label>' +
      '<label class="field" style="flex:1;min-width:280px">Referenced layout ' + selIn('layout_ref', b.layout_ref || '', layoutOpts, { refresh: 'body' }) + '</label>' +
      (ref ? '<button class="btn btn-secondary btn-sm" data-action="cfg-drawer" data-id="' + ref.configId + '">' + icon('panel-right-open', 15) + 'View layout</button>' : '') +
      '</div>' +
      (mismatch
        ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'This config expects a "' + esc(b.source_format) + '" file but ' + esc(ref.name) + ' is "' + esc(refFmt) + '". Character positions only apply to fixed-width files.</div>'
        : '') +
      (b.layout_ref && !ref
        ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'layout_ref "' + esc(b.layout_ref) + '" does not resolve to an existing layout config.</div>'
        : ref
          ? '<div class="ref-summary">' + icon('link', 14) + 'Resolves to ' + statePill(ref) + ' <strong>' + esc(ref.name) + '</strong> ' + fmtChip(refFmt) +
          (refCaps.recordLength ? ' · record length <span class="num">' + ref.body.record_length + '</span>' : '') +
          ' · <span class="num">' + refNames.length + '</span> distinct field names across <span class="num">' + (ref.body.record_types || []).length + '</span> record type' + ((ref.body.record_types || []).length === 1 ? '' : 's') + '</div>'
          : '<div class="meta mt-16">No layout referenced — sectioning fields cannot be checked against a layout.</div>') +
      structure +
      '</div>' +

      '<div class="cfg-section-title mt-24">How records are sorted</div>' +
      '<div class="cfg-block">' +
      '<label class="field" style="max-width:420px">Which field decides the record type? ' +
      (ref
        ? selIn('sectioning.field', secField, (secBad ? [[secField, secField + '  (not in layout)']] : []).concat(refNames.map(function (n) { return [n, n]; })), { refresh: 'body' })
        : txt('sectioning.field', secField)) +
      '</label>' +
      (secBad ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'This field does not exist in ' + esc(ref.name) + ' — the pipeline would fail to section incoming records.</div>' : '') +
      '<div class="ifthen-list mt-16">' +
      (secRules || '<div class="meta" style="padding:12px">No rules — every record is treated the same way.</div>') + '</div>' +
      '<div class="mt-16">' + addBtn('Add a rule', 'cfg-arr-add', 'data-path="sectioning.rules" data-tpl="secrule"') + '</div>' +
      '</div>' +

      '<div class="cfg-section-title mt-24">Aggregation</div>' +
      '<div class="cfg-block">' +
      '<div class="cfg-block-head">' + toggle('aggregation.enabled', agg.enabled, 'Aggregation enabled', { refresh: 'body' }) + '</div>' +
      (agg.enabled ? '<div class="cfg-grid-2">' +
        '<div class="field"><span class="fld-cap">Group by</span>' + tagList('aggregation.group_by', agg.group_by, 'Add layout field…') + '</div>' +
        '<div class="field"><span class="fld-cap">Sum fields</span>' + tagList('aggregation.sum_fields', agg.sum_fields, 'Add layout field…') + '</div>' +
        fld('Count field', txt('aggregation.count_field', agg.count_field)) +
        fld('Emit', txt('aggregation.emit', agg.emit)) +
        '</div>' : '<div class="meta">Aggregation is off — records are emitted individually.</div>') +
      '</div>' +
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">The long tail of aggregation options lives in <strong>Advanced</strong> mode.</div></div>';
  }

  function ipParser() {
    var e = edit(), b = e.body, rts = b.record_types || {};
    var pfmt = b.source_format || 'delimited';
    var pcaps = F.caps(pfmt === 'delimited' ? 'csv' : pfmt);
    var positional = pfmt === 'fixed_width';
    var keys = Object.keys(rts);

    var groups = keys.map(function (k) {
      var g = rts[k] || {}, mp = g.mappings || {}, notes = g.notes || {};
      var role = g.group ? F.roleOf(g.group) : null;

      var mrows = Object.keys(mp).map(function (t) {
        var known = C.INTERNAL_FIELDS.indexOf(t) >= 0;
        var src = mp[t];
        return '<tr><td class="mono' + (known ? '' : ' bad-text') + '">' + esc(t) + (known ? '' : ' <span class="tip" data-tip="Not a known internal field name">' + icon('alert-triangle', 12) + '</span>') + '</td>' +
          '<td class="arrow">' + icon('arrow-left', 14) + '</td>' +
          '<td>' + txt('record_types.' + k + '.mappings.' + t, src, { cls: 'mono', refresh: 'body' }) + '</td>' +
          '<td class="src-col">' + F.sourceBadge({ kind: 'direct', column: src }) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Remove mapping', 'data-path="record_types.' + k + '.mappings" data-key="' + esc(t) + '"') + '</td></tr>';
      }).join('');

      // Every column this record knows about, described (§4). A column matters
      // to Ops whether or not it happens to feed an internal field — the IRD
      // columns on the Mastercard clearing detail are the obvious case.
      var cols = [];
      Object.keys(mp).forEach(function (t) { if (mp[t] && cols.indexOf(mp[t]) < 0) cols.push(mp[t]); });
      Object.keys(notes).forEach(function (n) { if (cols.indexOf(n) < 0) cols.push(n); });
      (g.fields || []).forEach(function (f) { if (f.name && cols.indexOf(f.name) < 0) cols.push(f.name); });
      var mappedTo = {};
      Object.keys(mp).forEach(function (t) { (mappedTo[mp[t]] = mappedTo[mp[t]] || []).push(t); });
      var crows = cols.map(function (col) {
        var seeded = F.isDePds(col) ? F.describe(col) : '';
        return '<tr><td class="mono de-code">' + esc(col) + '</td>' +
          '<td>' + (mappedTo[col]
            ? mappedTo[col].map(function (t) { return '<span class="alias-chip" style="margin:0">→ ' + esc(t) + '</span>'; }).join(' ')
            : '<span class="meta">not mapped</span>') + '</td>' +
          '<td class="de-desc">' + txt('record_types.' + k + '.notes.' + col, notes[col], { ph: 'Describe this column…' }) +
          (!notes[col] && seeded ? '<span class="desc-seed">suggested: ' + esc(seeded) + '</span>' : '') + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Clear description', 'data-path="record_types.' + k + '.notes" data-key="' + esc(col) + '"') + '</td></tr>';
      }).join('');
      var colsBlock = cols.length
        ? '<div class="cfg-section-title sm mt-24">Columns &amp; descriptions <span class="meta">— what each incoming column is, mapped or not</span></div>' +
        '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th>Column</th><th>Maps to</th><th>Description</th><th></th></tr></thead><tbody>' +
        crows + '</tbody></table></div>'
        : '';

      // Positional windows — only meaningful, and only shown, for fixed-width.
      var fieldsBlock = '';
      if ((g.fields || []).length) {
        if (positional) {
          var frows2 = (g.fields || []).map(function (f, i) {
            var fp = 'record_types.' + k + '.fields.' + i;
            return '<tr><td class="num idx">' + (i + 1) + '</td>' +
              '<td>' + txt(fp + '.name', f.name, { cls: 'mono' }) + '</td>' +
              '<td class="num">' + txt(fp + '.start', f.start, { type: 'number', cast: 'int', cls: 'num w-70' }) + '</td>' +
              '<td class="num">' + txt(fp + '.length', f.length, { type: 'number', cast: 'int', cls: 'num w-70' }) + '</td>' +
              '<td>' + selIn(fp + '.type', f.type, TYPE_LABEL, { cls: 'w-180' }) + '</td>' +
              '<td>' + txt(fp + '.note', f.note, { ph: '—' }) + '</td>' +
              '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove field', 'data-path="record_types.' + k + '.fields" data-idx="' + i + '"') + '</td></tr>';
          }).join('');
          fieldsBlock = '<div class="cfg-section-title sm mt-24">Where each field sits <span class="meta">— character positions inside this record</span></div>' +
            '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th class="num">#</th><th>Field</th><th class="num">Starts at</th><th class="num">Length</th><th>Content type</th><th>Notes</th><th></th></tr></thead><tbody>' +
            frows2 + '</tbody></table></div>' +
            '<div class="mt-16">' + addBtn('Add field window', 'cfg-arr-add', 'data-path="record_types.' + k + '.fields" data-tpl="ipfield"') + '</div>';
        } else {
          fieldsBlock = '<div class="inline-warn big mt-24">' + icon('alert-triangle', 14) +
            'This record declares byte positions, but the source format is "' + esc(pfmt) + '" — positions are only read for fixed_width sources.</div>';
        }
      }

      var frows = (g.filters || []).map(function (f, i) {
        return '<tr><td>' + txt('record_types.' + k + '.filters.' + i + '.field', f.field, { cls: 'mono' }) + '</td>' +
          '<td>' + selIn('record_types.' + k + '.filters.' + i + '.condition', f.condition, C.CONDITIONS, { cls: 'w-100' }) + '</td>' +
          '<td>' + txt('record_types.' + k + '.filters.' + i + '.value', f.value) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove filter', 'data-path="record_types.' + k + '.filters" data-idx="' + i + '"') + '</td></tr>';
      }).join('');

      return '<div class="cfg-block">' +
        '<div class="cfg-block-head"><div class="row" style="gap:10px;align-items:center">' + icon('file-stack', 16) +
        '<strong class="mono">' + esc(k) + '</strong>' +
        (role ? '<span class="tip grp-chip" data-tip="' + esc(role.blurb) + '">' + icon(role.icon, 12) + esc(role.label) + '</span>' : '') +
        (g.first_char ? '<span class="meta">first char <code>' + esc(g.first_char) + '</code></span>' : '') +
        (g.min_length ? '<span class="meta">min length <span class="num">' + g.min_length + '</span></span>' : '') +
        '<span class="meta"><span class="num">' + Object.keys(mp).length + '</span> mappings · <span class="num">' + (g.filters || []).length + '</span> filters</span></div>' +
        iconBtn('cfg-map-del', 'trash-2', 'Remove record type', 'data-path="record_types" data-key="' + esc(k) + '"') + '</div>' +
        (g.label ? '<div class="meta mb-16">' + esc(g.label) + '</div>' : '') +
        '<div class="cfg-section-title sm">Mappings <span class="meta">internal field ← source column</span></div>' +
        '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th>Internal field</th><th></th><th>Source column</th><th>' + srcHeader() + '</th><th></th></tr></thead><tbody>' +
        (mrows || '<tr><td colspan="5" class="meta" style="padding:12px">No mappings.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16 row" style="gap:8px;align-items:center">' +
        '<select class="input w-220" id="mapsel-' + esc(k) + '">' + C.INTERNAL_FIELDS.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join('') + '</select>' +
        addBtn('Add mapping', 'cfg-map-add', 'data-path="record_types.' + k + '.mappings" data-sel="mapsel-' + esc(k) + '"') +
        '</div>' +
        colsBlock +
        fieldsBlock +
        '<div class="cfg-section-title sm mt-24">Filters</div>' +
        '<table class="data cfg-sub-table"><thead><tr><th>Field</th><th>Condition</th><th>Value</th><th></th></tr></thead><tbody>' +
        (frows || '<tr><td colspan="4" class="meta" style="padding:12px">No filters — every record of this type is parsed.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16">' + addBtn('Add filter', 'cfg-arr-add', 'data-path="record_types.' + k + '.filters" data-tpl="filter"') + '</div>' +
        '<div class="cfg-grid-2 mt-24">' +
        '<div class="field"><span class="fld-cap">Mutations</span>' + tagList('record_types.' + k + '.mutations', g.mutations, 'Add mutation…') + '</div>' +
        '<div class="field"><span class="fld-cap">Computations</span>' +
        '<div class="comp-list">' + ((g.computations || []).length
          ? (g.computations || []).map(function (c, i) {
            return '<div class="comp-row"><span class="mono">' + esc(c.target) + '</span>' + icon('equal', 13) + '<span class="mono">' + esc(c.expr) + '</span>' +
              iconBtn('cfg-arr-del', 'trash-2', 'Remove computation', 'data-path="record_types.' + k + '.computations" data-idx="' + i + '"') + '</div>';
          }).join('')
          : '<div class="meta">None — edit in Raw mode for complex expressions.</div>') + '</div></div>' +
        '</div></div>';
    }).join('');

    var head = '<div class="fmt-aware-head">' +
      '<label class="field" style="min-width:230px">Source format' +
      selIn('source_format', pfmt, [['fixed_width', 'Fixed width  (fixed_width)'], ['delimited', 'Delimited  (delimited)'], ['csv', 'CSV  (csv)'], ['xml', 'XML  (xml)'], ['xlsx', 'Spreadsheet  (xlsx)']], { refresh: 'body' }) +
      '<span class="fld-hint">' + esc(pcaps.blurb) + '</span></label>' +
      '<div class="fmt-grounding">' + icon('file-code', 14) +
      '<span>Read from the incoming layout JSON’s <code>"format"</code> key</span></div>' +
      '</div>' +
      (positional
        ? '<div class="cfg-grid-3">' + fld('Record length', txt('record_length', b.record_length, { type: 'number', cast: 'int', cls: 'num' }), 'optional — some fixed-width sources are ragged') + '</div>'
        : (pfmt === 'delimited' || pfmt === 'csv')
          ? '<div class="cfg-grid-3">' +
          fld('Delimiter', txt('delimiter', b.delimiter, { cls: 'mono', maxlength: 3 })) +
          fld('Quote character', txt('quote_char', b.quote_char, { cls: 'mono', maxlength: 1 })) +
          '</div>'
          : '<div class="meta mb-16">' + esc(pcaps.label) + ' sources are addressed by element or column name — there is nothing positional to configure.</div>');

    var cfg = current();
    return taskHint() +
      parsingIssuesPanel(cfg) + parseAddForm(cfg) +
      head +
      '<div class="cfg-section-title mt-24">Record types</div>' +
      (groups || '<div class="meta mb-16">No record types defined.</div>') +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<input class="input w-220" id="newRtName" placeholder="New record type, e.g. detail" />' +
      addBtn('Add record type', 'cfg-map-add', 'data-path="record_types" data-sel="newRtName" data-tpl="parserrt"') +
      '</div>' +
      '<div class="cfg-section-title mt-24">Check it against a real file</div>' +
      sampleTestPanel(cfg);
  }

  /* =======================================================================
     5.4 · Incoming parsing — lead with the problem
     The most common reason someone opens this screen is that a field is not
     being read. So the screen opens with exactly that: the fields recent files
     carried that this config does not recognise, each one click from being
     added with everything the platform already knows pre-filled.
     ======================================================================= */
  function parsingIssuesPanel(cfg) {
    var issues = C.parsingIssues(cfg).filter(function (x) { return !S.cfg.parsedFixed[cfg.configId + ':' + x.field]; });
    if (!issues.length) {
      return '<div class="parse-ok">' + icon('check-circle', 18) +
        '<span>Every field in recent files is recognised by this configuration.</span></div>';
    }
    var rows = issues.map(function (x) {
      return '<div class="parse-row">' +
        icon('alert-triangle', 16) +
        '<span class="parse-field mono">' + esc(x.field) + '</span>' +
        '<span class="parse-seen meta">seen in <span class="num">' + x.files + '</span> file' + (x.files === 1 ? '' : 's') + ' since ' + esc(x.since) + '</span>' +
        '<button class="btn btn-sm btn-secondary" data-action="cfg-parse-add" data-field="' + esc(x.field) + '">' +
        'Add this field' + icon('arrow-right', 16) + '</button>' +
        '</div>';
    }).join('');
    return '<div class="parse-panel">' +
      '<div class="parse-head"><strong>Parsing issues</strong>' +
      '<span class="meta"><span class="num">' + issues.length + '</span> unrecognised field' + (issues.length === 1 ? '' : 's') + '</span></div>' +
      rows + '</div>';
  }

  // The pre-filled editor a "Add this field →" opens: the name as seen, the
  // window inferred from the file, and a suggested content type.
  function parseAddForm(cfg) {
    var g = S.cfg.parseForm;
    if (!g || g.configId !== cfg.configId) return '';
    return '<div class="gap-form">' +
      '<div class="gap-form-head">' + icon('plus-circle', 18) +
      '<strong>Add <span class="mono">' + esc(g.field) + '</span></strong>' +
      '<span class="meta">Pre-filled from what recent files carried — confirm or adjust.</span>' +
      '<button class="icon-btn xs" data-action="cfg-parse-cancel" title="Cancel" aria-label="Cancel">' + icon('x', 14) + '</button></div>' +
      '<div class="cfg-grid-4">' +
      fld('Field name as seen', '<input class="input mono" id="paName" value="' + esc(g.field) + '" />') +
      fld('Starts at character', '<input class="input num" id="paStart" type="number" value="' + g.start + '" />') +
      fld('Length (characters)', '<input class="input num" id="paLen" type="number" value="' + g.length + '" />') +
      fld('Content type', '<select class="input" id="paType">' +
        TYPE_LABEL.map(function (t) { return '<option value="' + t[0] + '"' + (g.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>') +
      '</div>' +
      '<div class="cfg-grid-2 mt-16">' +
      fld('Which record type?', '<select class="input" id="paRt">' +
        Object.keys(edit().body.record_types || {}).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('') + '</select>') +
      fld('Notes', '<input class="input" id="paNote" value="' + esc(g.note || '') + '" />') +
      '</div>' +
      '<div class="row mt-16" style="gap:10px;justify-content:flex-end">' +
      '<button class="btn btn-secondary" data-action="cfg-parse-cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cfg-parse-confirm">' + icon('plus', 18) + 'Add field</button>' +
      '</div></div>';
  }

  /* "Test with a sample file" (Part 5.4). No real parsing — the upload is
     accepted and each declared field is shown with a plausible extracted
     value, with anything that extracted nothing flagged. */
  function sampleTestPanel(cfg) {
    var t = S.cfg.sampleTest;
    var head = '<div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-secondary" data-action="cfg-sample-pick">' + icon('upload', 18) + 'Test with a sample file</button>' +
      '<input type="file" id="cfgSampleFile" class="cfg-hidden-file" data-action="cfg-sample-file" aria-label="Sample file" />' +
      (t ? '<span class="meta">Tested <span class="mono">' + esc(t.name) + '</span></span>' +
        '<button class="btn btn-sm btn-ghost" data-action="cfg-sample-clear">Clear</button>' : '') +
      '</div>';
    if (!t || t.configId !== cfg.configId) return head;
    var rows = t.rows.map(function (r) {
      return '<tr class="' + (r.value === null ? 'sample-empty' : '') + '">' +
        '<td class="mono">' + esc(r.field) + '</td>' +
        '<td class="num">' + r.start + '</td><td class="num">' + r.length + '</td>' +
        '<td>' + (r.value === null
          ? '<span class="inline-warn">' + icon('alert-triangle', 14) + 'nothing extracted</span>'
          : '<code class="mono">' + esc(r.value) + '</code>') + '</td></tr>';
    }).join('');
    var bad = t.rows.filter(function (r) { return r.value === null; }).length;
    return head +
      '<div class="sample-result mt-16">' +
      '<div class="' + (bad ? 'map-warn' : 'map-ok') + '">' + icon(bad ? 'alert-triangle' : 'check-circle', 18) +
      '<span>' + (bad
        ? '<strong><span class="num">' + bad + '</span> field' + (bad === 1 ? '' : 's') + ' extracted nothing</strong> from this file.'
        : 'Every declared field extracted a value.') + '</span></div>' +
      '<div class="table-wrap mt-16"><table class="data cfg-sub-table"><thead><tr>' +
      '<th>Field</th><th class="num">Starts at</th><th class="num">Length</th><th>Value extracted</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function ipPreprocessor() {
    var e = edit(), b = e.body;
    var steps = (b.steps || []).map(function (s, i) {
      return '<div class="step-row"><span class="num idx">' + (i + 1) + '</span><span class="mono step-op">' + esc(s.op || '?') + '</span>' +
        '<span class="meta">' + esc(Object.keys(s).filter(function (k) { return k !== 'op'; }).map(function (k) { return k + '=' + s[k]; }).join(' · ')) + '</span>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove step', 'data-path="steps" data-idx="' + i + '"') + '</div>';
    }).join('');
    return taskHint() + '<div class="cfg-grid-4">' +
      fld('Skip header rows', txt('skip_header_rows', b.skip_header_rows, { type: 'number', cast: 'int', cls: 'num' })) +
      fld('Skip trailer rows', txt('skip_trailer_rows', b.skip_trailer_rows, { type: 'number', cast: 'int', cls: 'num' })) +
      fld('Encoding', selIn('encoding', b.encoding, ['ASCII', 'EBCDIC', 'UTF-8'])) +
      fld('On error', selIn('on_error', b.on_error, ['quarantine_file', 'quarantine_record', 'fail_run'])) +
      '</div>' +
      '<div class="row mt-16">' + toggle('strip_bom', b.strip_bom, 'Strip byte-order mark') + '</div>' +
      '<div class="cfg-section-title mt-24">Steps</div>' +
      '<div class="cfg-block">' + (steps || '<div class="meta">No steps.</div>') + '</div>' +
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Preprocessor configs are mostly raw by design — the common toggles are surfaced above and everything else (step parameters, code pages, custom ops) is edited in <strong>Raw</strong> mode with schema validation.</div></div>';
  }

  /* ---- Tab dispatcher ----------------------------------------------------- */
  function tabBody(cfg) {
    if (S.cfg.mode === 'raw') return rawBody();
    var t = activeTab(cfg);
    if (cfg.family === 'network-file') return t === 'transform' ? nfTransform() : nfLayout();
    if (cfg.family === 'settlement') return t === 'fees' ? stFees() : (t === 'content' ? stContent() : stSchedule());
    if (cfg.subType === 'parser') return ipParser();
    if (cfg.subType === 'preprocessor') return ipPreprocessor();
    return ipPipeline();
  }
  function editorPane(list) {
    var cfg = current();
    /* Part 8.2 — when the filters match nothing there is nothing to open, and
       the page says so where the editor would have been. */
    if (list && !list.length) {
      return '<div class="cfg-pane cfg-editor" id="cfgEditorPane">' +
        emptyState('search-x', 'No configuration matches these filters',
          'Clear a filter to bring the list back, or start a new draft for what is missing.',
          '<div class="row" style="gap:10px;justify-content:center">' +
          '<button class="btn btn-secondary" data-action="cfg-filters-clear">' + icon('rotate-ccw', 15) + 'Clear filters</button>' +
          '<button class="btn btn-primary" data-action="cfg-new">' + icon('plus', 15) + 'New config</button></div>') +
        '</div>';
    }
    if (!cfg && S.cfg.family === 'settlement') {
      var it = stItem();
      if (it) {
        // The report item exists, but this tab has nothing behind it yet. Keep the
        // item and its tab strip on screen so the report never looks broken.
        var tabKey = S.cfg.tab.settlement;
        var label = { content: 'content', schedule: 'schedule', fees: 'fee rules' }[tabKey] || tabKey;
        return '<div class="cfg-pane cfg-editor" id="cfgEditorPane">' +
          '<div class="cfg-editor-head"><div class="item-head">' +
          '<div class="item-title">' + icon('file-spreadsheet', 20) + '<h2>' + esc(it.report) + '</h2>' + tenantChip(it.tenantId) + '</div>' +
          '<div class="meta">One report, one item — content, every schedule variant and the entity’s fee rules are tabs below.</div>' +
          '</div></div>' +
          '<div class="cfg-tabbar"><div class="tabs cfg-tabs">' +
          tabsFor({ family: 'settlement' }).map(function (t) {
            return '<button class="tab' + (t[0] === tabKey ? ' active' : '') + '" data-action="cfg-tab" data-tab="' + t[0] + '">' +
              icon(t[2], 15) + esc(t[1]) + tabBadge({ family: 'settlement' }, t[0]) + '</button>';
          }).join('') + '</div></div>' +
          '<div class="cfg-tab-body">' +
          emptyState('file-plus', 'No ' + label + ' config for ' + it.report,
            'This report has no ' + label + ' configured for ' + ((C.tenantByKey[it.tenantId] || {}).name || it.tenantId) + ' yet.',
            '<button class="btn btn-primary" data-action="cfg-new">' + icon('plus', 15) + 'Create ' + esc(label) + ' config</button>') +
          '</div></div>';
      }
    }
    if (!cfg) {
      return '<div class="cfg-pane cfg-editor" id="cfgEditorPane">' +
        emptyState('file-plus', 'No config selected', 'Use the filters above to pick one, or create a new draft.',
          '<button class="btn btn-primary" data-action="cfg-new">' + icon('plus', 15) + 'Create new</button>') + '</div>';
    }
    return '<div class="cfg-pane cfg-editor" id="cfgEditorPane">' +
      editorHeader(cfg) + modeBar(cfg) +
      '<div class="cfg-tab-body" id="cfgTabBody">' + tabBody(cfg) + '</div>' +
      validationPanel() + '</div>';
  }

  /* =======================================================================
     VERSION HISTORY (Part 4.6) — immutability pattern from the earlier build
     ======================================================================= */
  function historyPanel() {
    var cfg = current(); if (!cfg) return '';
    var h = S.cfg.history;
    var vers = cfg.versions;
    var entries = vers.slice().reverse().map(function (v) {
      var ev = {
        kind: v.kind === 'nullified' ? 'nullified' : (v.kind === 'correction' ? 'correction' : 'normal'),
        at: v.approvedAt, by: v.approvedBy,
        text: 'v' + v.version + ' — ' + v.summary,
        reason: v.reason
      };
      var picks = '<div class="ver-picks">' +
        '<label class="ver-pick"><input type="radio" name="verA" value="' + v.version + '"' + (h.a === v.version ? ' checked' : '') + ' data-action="cfgc-ver" data-side="a" /> A</label>' +
        '<label class="ver-pick"><input type="radio" name="verB" value="' + v.version + '"' + (h.b === v.version ? ' checked' : '') + ' data-action="cfgc-ver" data-side="b" /> B</label>' +
        '<button class="btn btn-secondary btn-sm" data-action="cfg-revert" data-v="' + v.version + '">' + icon('undo-2', 13) + 'Revert to v' + v.version + '</button>' +
        '</div>';
      return '<div class="ver-entry">' + immutableEntry(ev) +
        '<div class="ver-meta"><span class="meta">submitted by ' + esc(v.submittedBy) + ' · approved by ' + esc(v.approvedBy) + '</span>' + picks + '</div></div>';
    }).join('');

    var compare = '';
    if (h.compare && h.a != null && h.b != null) {
      var va = vers.filter(function (v) { return v.version === h.a; })[0];
      var vb = vers.filter(function (v) { return v.version === h.b; })[0];
      if (va && vb) compare = '<div class="mt-16">' + api.diffPanel(va.body, vb.body, 'v' + va.version + ' · ' + va.approvedAt, 'v' + vb.version + ' · ' + vb.approvedAt, cfg) + '</div>';
    }

    return '<div class="overlay" data-action="cfg-history-close">' +
      '<div class="side-panel wide" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div><div class="section-title">Version history</div><div class="meta">' + esc(cfg.name) + ' · <span class="num">' + vers.length + '</span> approved version' + (vers.length === 1 ? '' : 's') + '</div></div>' +
      '<button class="icon-btn" data-action="cfg-history-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="callout info" style="margin-bottom:16px">' + icon('shield', 18) + '<div class="callout-body">Immutable history — every approved change is appended, never overwritten. A withdrawn entry stays visible as <em>nullified</em> with its correcting entry directly below. Reverts create a new draft that goes through maker-checker; they are never silent resets.</div></div>' +
      (vers.length ? entries : '<div class="meta">No approved versions yet — this config has never been through approval.</div>') +
      (vers.length > 1 ? '<div class="row mt-16" style="justify-content:flex-end;gap:10px">' +
        '<button class="btn btn-secondary btn-sm" data-action="cfg-compare">' + icon('git-compare', 14) + 'Compare A ↔ B</button></div>' : '') +
      compare +
      '</div></div>';
  }

  /* ---- Layout drawer (embedded byte map, Part 7.2 Tab A) ----------------- */
  function drawerPanel() {
    var ref = C.byId[S.cfg.drawer]; if (!ref) return '';
    var dfmt = F.formatOf(ref.body), dcaps = F.caps(dfmt);
    var maps = dcaps.byteMap
      ? (ref.body.record_types || []).map(function (rt) {
        return '<div class="mt-16">' + X.byteMapHtml(ref.body.record_length, rt.fields, { title: 'Record type ' + esc(rt.record_type || '?') + (rt.label ? ' · ' + esc(rt.label) : '') }) + '</div>';
      }).join('')
      : '<div class="callout info mt-16">' + icon(dcaps.icon, 18) + '<div class="callout-body">' + esc(dcaps.label) +
      ' layout — fields are addressed by ' + (dfmt === 'xml' ? 'element tag' : 'column name') + ', so there are no byte positions and no byte map.</div></div>';
    var first = ref.body.record_types[0] || { fields: [] };
    var rows = first.fields.map(function (f, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td class="mono">' + esc(f.name) + '</td>' +
        (dcaps.positions ? '<td class="num">' + f.start + '</td><td class="num">' + f.length + '</td>' : '') +
        (dfmt === 'xml' ? '<td class="mono">&lt;' + esc(f.xml_tag || f.name) + '&gt;</td>' : '') +
        (dfmt === 'csv' ? '<td class="num">' + (f.length == null ? '—' : f.length) + '</td>' : '') +
        '<td>' + esc(f.type || '—') + '</td>' +
        '<td class="src-col">' + F.sourceBadge(F.resolveSource(ref.body, f.name, first.group)) + '</td>' +
        '<td class="cell-sub">' + esc(f.note || '') + '</td></tr>';
    }).join('');
    var headCols = '<th class="num">#</th><th>Field name</th>' +
      (dcaps.positions ? '<th class="num">Start</th><th class="num">Length</th>' : '') +
      (dfmt === 'xml' ? '<th>XML tag</th>' : '') +
      (dfmt === 'csv' ? '<th class="num">Length</th>' : '') +
      '<th>Type</th><th>Source</th><th>Note</th>';
    return '<div class="overlay" data-action="cfg-drawer-close">' +
      '<div class="side-panel wide" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div><div class="section-title">' + esc(ref.name) + '</div>' +
      '<div class="meta">Referenced layout · ' + fmtChip(dfmt) +
      (dcaps.recordLength ? ' · record length <span class="num">' + ref.body.record_length + '</span> · ' + esc(ref.body.encoding) : '') +
      ' · ' + statePill(ref) + '</div></div>' +
      '<button class="icon-btn" data-action="cfg-drawer-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      maps +
      '<div class="cfg-section-title mt-24">Fields · ' + esc(first.record_type || '?') + '</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' + headCols + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="row mt-24" style="justify-content:flex-end;gap:10px">' +
      '<button class="btn btn-secondary" data-action="cfg-drawer-close">Close</button>' +
      '<button class="btn btn-primary" data-action="cfg-open-ref" data-id="' + ref.configId + '">' + icon('external-link', 15) + 'Open full config</button></div>' +
      '</div></div>';
  }

  /* =======================================================================
     SCREEN RENDER
     ======================================================================= */
  function roleBar() {
    return '<div class="role-bar">' +
      '<a class="btn btn-secondary btn-sm" data-route="#/dashboard/ops/configs/approvals">' + icon('inbox', 15) + 'Approvals queue <span class="count num">' + pendingCount() + '</span></a>' +
      '<label class="role-select">Role ' +
      '<select class="input" data-action="cfgc-role">' +
      ['Maker', 'Checker', 'Viewer'].map(function (r) { return '<option' + (S.cfg.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select></label>' +
      '<span class="tip role-user" data-tip="Prototype convenience — in production the role comes from auth. Self-approval stays blocked for anything this user submitted.">' +
      icon('user', 14) + esc(C.DEMO_USER) + '</span>' +
      '</div>';
  }
  function pendingCount() { return C.configs.filter(function (c) { return c.state === 'PENDING_APPROVAL'; }).length; }

  function renderFamily(fam, id) {
    S.cfg.family = fam;
    if (fam === 'settlement') {
      // The route may carry either an item key (hsbc_in::MPR) or a bare config id
      // — a config id resolves to the item that owns it, then to its tab.
      if (id) {
        if (C.settlementItemByKey(id)) S.cfg.selected.settlement = id;
        else if (C.byId[id] && C.byId[id].family === 'settlement') {
          var owner = C.itemKeyForConfig(C.byId[id]);
          if (owner) {
            S.cfg.selected.settlement = owner;
            S.cfg.tab.settlement = C.byId[id].subType === 'content' ? 'content' : (C.byId[id].subType === 'fees' ? 'fees' : 'schedule');
            if (C.byId[id].subType === 'schedule') S.cfg.schedVariant[owner] = id;
            if (C.byId[id].subType === 'fees') S.cfg.feeSel[owner] = id;
          }
        }
      }
      if (!C.settlementItemByKey(S.cfg.selected.settlement)) {
        var firstItem = filtered('settlement')[0] || C.settlementItems()[0];
        S.cfg.selected.settlement = firstItem ? firstItem.key : null;
      }
    } else {
      if (id && C.byId[id]) S.cfg.selected[fam] = id;
      if (!C.byId[S.cfg.selected[fam]]) {
        var first = filtered(fam)[0] || C.byFamily(fam)[0];
        S.cfg.selected[fam] = first ? first.configId : null;
      }
    }
    var f = C.familyById[fam];
    var SUB = {
      'network-file': 'Field layouts and data mappings for outgoing clearing files.',
      settlement: 'What acquirer reports contain, when they run, and what they charge.',
      'incoming-parsing': 'How the files we receive from networks are read.'
    };
    var list = filtered(fam);
    setView(
      '<div class="page-head cfg-head">' +
      '<div><a class="rej-back" data-route="#/dashboard/ops/configs">' + icon('arrow-left', 15) + 'Platform Configs</a>' +
      '<h1 class="page-title">' + esc(f.label) + '</h1>' +
      '<div class="subtitle">' + esc(SUB[fam] || f.blurb) + '</div></div>' +
      '<div class="head-actions">' + roleBar() + '</div></div>' +
      // Part 8.2 — the filter row selects which config is open. There is no
      // list pane: the editor gets the whole content width.
      filterRow(fam, list) +
      chipSelector(fam, list) +
      '<div class="cfg-full" id="cfgSplit">' + editorPane(list) + '</div>' +
      browseSection() +
      (S.cfg.history.open ? historyPanel() : '') +
      (S.cfg.drawer ? drawerPanel() : '')
    );
    mount();
  }

  /* =======================================================================
     PART 8.2 · FILTER ROW + INLINE CHIP SELECTOR
     The split pane is gone. Choosing a config is a filter, not a browse: the
     four controls narrow to one record and that record is what the editor
     below holds. When they narrow to several, a row of chips picks between
     them — a row, not a pane, because the width belongs to the editor.
     ======================================================================= */
  function filterRow(fam, list) {
    var fl = S.cfg.filters[fam];
    var facetLabel = fam === 'network-file' ? 'Network' : (fam === 'settlement' ? 'Report' : 'Source');
    var total = fam === 'settlement' ? C.settlementItems().length : C.byFamily(fam).length;
    return kit.opsFilterRow({
      search: { placeholder: 'Search by name', action: 'cfgi-list-q', value: fl.q || '' },
      filters: [
        { action: 'cfgc-list-facet', value: fl.facet, label: facetLabel, options: [['all', 'All ' + facetLabel.toLowerCase() + 's']].concat(facetOptions(fam)) },
        { action: 'cfgc-list-tenant', value: fl.tenant, label: 'Entity', options: [['all', 'All entities']].concat(C.TENANTS.map(function (t) { return [t.key, t.key]; })) },
        { action: 'cfgc-list-state', value: fl.state, label: 'State', options: [['all', 'All states']].concat(C.STATES.map(function (s) { return [s, STATE_PILL[s][0]]; })) }
      ],
      refresh: 'cfg-filters-clear',
      extra: '<span class="cfg-filter-count meta"><strong class="num">' + list.length + '</strong> of <span class="num">' + total + '</span> ' +
        (fam === 'settlement' ? 'reports' : 'configs') + '</span>' +
        '<button class="btn btn-primary btn-sm cfg-filter-new" data-action="cfg-new">' + icon('plus', 14) + 'New config</button>'
    });
  }

  function chipSelector(fam, list) {
    if (list.length < 2) return '';
    var selId = S.cfg.selected[fam];
    var chips = list.slice(0, 60).map(function (x) {
      var id = fam === 'settlement' ? x.key : x.configId;
      var label = fam === 'settlement' ? x.report + ' · ' + x.tenantId : x.name;
      var st = fam === 'settlement' ? itemState(x) : x.state;
      return '<button type="button" class="cfg-pick' + (id === selId ? ' active' : '') + '" ' +
        'data-action="cfg-select" data-id="' + esc(id) + '" title="' + esc(label) + '">' +
        '<span class="cfg-pick-dot ' + esc(STATE_PILL[st][1]) + '"></span>' + esc(label) + '</button>';
    }).join('');
    return '<div class="cfg-picks">' +
      '<span class="cfg-picks-label">' + list.length + ' match' + (list.length === 1 ? '' : 'es') + '</span>' +
      '<div class="cfg-picks-row">' + chips +
      (list.length > 60 ? '<span class="meta">+' + (list.length - 60) + ' more — narrow the filters</span>' : '') +
      '</div></div>';
  }

  /* =======================================================================
     5.1 · PLATFORM CONFIGS LANDING — task-based entry points
     -----------------------------------------------------------------------
     The config list is no longer the landing view. It answers "which record am
     I looking for?", which is not the question anyone arrives with. These cards
     answer "what do you want to do?" and carry the intent into the editor. The
     full filterable list is still here, one click down, under Browse all
     configurations — nothing has been removed.
     ======================================================================= */
  var TASK_GROUPS = [
    {
      key: 'network', title: 'Network files', blurb: 'What we send to card networks', icon: 'upload',
      tasks: [
        { id: 'add-field', label: 'Add a field to a file', desc: 'Declare a new field and where it sits in the record.', fam: 'network-file', tab: 'layout' },
        { id: 'move-field', label: "Change a field's position or length", desc: 'Adjust where a field starts and how long it is.', fam: 'network-file', tab: 'layout' },
        { id: 'map-data', label: 'Change how data maps into a file', desc: 'Point a field at a different source value.', fam: 'network-file', tab: 'transform' },
        { id: 'add-tcr', label: 'Add a new record type (TCR)', desc: 'Declare a record type the file does not carry yet.', fam: 'network-file', tab: 'layout' },
        { id: 'view-layout', label: "View a file's layout", desc: 'See every field in position order.', fam: 'network-file', tab: 'layout' }
      ]
    },
    {
      key: 'incoming', title: 'Incoming files', blurb: 'What we receive from networks', icon: 'download',
      tasks: [
        { id: 'fix-parse', label: "Fix a field that isn't being read", desc: 'Add a field the files carry but the config does not recognise.', fam: 'incoming-parsing', tab: 'parser' },
        { id: 'new-incoming', label: 'Add a new file type we receive', desc: 'Set up parsing for a file the platform does not read yet.', fam: 'incoming-parsing', tab: 'pipeline' },
        { id: 'interpret', label: 'Change how a field is interpreted', desc: 'Adjust a field&rsquo;s content type or length.', fam: 'incoming-parsing', tab: 'parser' },
        { id: 'view-read', label: 'View how a file is read', desc: 'See the layout the parser expects.', fam: 'incoming-parsing', tab: 'parser' }
      ]
    },
    {
      key: 'settlement', title: 'Settlement reports', blurb: 'What we send to acquirers', icon: 'file-spreadsheet',
      tasks: [
        { id: 'report-content', label: "Change what's in a report", desc: 'Add, remove or reorder the columns.', fam: 'settlement', tab: 'content' },
        { id: 'report-when', label: 'Change when a report runs', desc: 'Adjust the window it covers and the time it is generated.', fam: 'settlement', tab: 'schedule' },
        { id: 'fee-rules', label: 'Change fee rules', desc: 'Adjust what is charged, and when each rule applies.', fam: 'settlement', tab: 'fees' },
        { id: 'view-report', label: "View a report's contents", desc: 'See the columns and a sample of the output.', fam: 'settlement', tab: 'content' }
      ]
    }
  ];
  var TASK_BY_ID = {};
  TASK_GROUPS.forEach(function (g) { g.tasks.forEach(function (t) { t.group = g.key; TASK_BY_ID[t.id] = t; }); });

  /* Part 8.5 — a card opens THAT task's flow. Nothing on this page opens the
     generic editor any more; the editor is reached from Browse all
     configurations at the bottom, and only from there. */
  function taskCard(t) {
    return '<button class="task-card" data-route="#/dashboard/ops/configs/task/' + t.id + '">' +
      '<span class="task-card-body">' +
      '<span class="task-card-title">' + t.label + '</span>' +
      '<span class="task-card-desc">' + t.desc + '</span></span>' +
      icon('chevron-right', 18) + '</button>';
  }

  function repaintHere() { if (S.opsChild) renderFamily(S.cfg.family); else renderLanding(); }

  function browseSection() {
    var fam = S.cfg.browseFam || 'network-file';
    var open = S.cfg.browseOpen;
    var tabs = [['network-file', 'Network file'], ['settlement', 'Settlement'], ['incoming-parsing', 'Incoming parsing']]
      .map(function (f) {
        return '<button class="tab' + (fam === f[0] ? ' active' : '') + '" data-action="cfg-browse-fam" data-fam="' + f[0] + '">' +
          esc(f[1]) + '<span class="count num">' + (f[0] === 'settlement' ? C.settlementItems().length : C.byFamily(f[0]).length) + '</span></button>';
      }).join('');
    return '<div class="cfg-browse">' +
      '<button class="cfg-browse-head" data-action="cfg-browse" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      icon(open ? 'chevron-down' : 'chevron-right', 18) +
      '<span>Browse all configurations</span>' +
      '<span class="meta"><span class="num">' + C.configs.length + '</span> configs across three families</span></button>' +
      (open
        ? '<div class="cfg-browse-body"><div class="tabs">' + tabs + '</div>' + listPane(fam) + '</div>'
        : '') + '</div>';
  }

  function pendingBanner() {
    var n = pendingCount();
    if (!n) return '';
    return '<div class="callout info mb-16" data-route="#/dashboard/ops/configs/approvals" style="cursor:pointer">' +
      icon('clock', 20) + '<div class="callout-body"><strong><span class="num">' + n + '</span> change' + (n === 1 ? '' : 's') +
      ' waiting for approval.</strong></div>' + icon('chevron-right', 18) + '</div>';
  }

  function renderLanding() {
    S.cfg.family = S.cfg.family || 'network-file';
    var groups = TASK_GROUPS.map(function (g) {
      return '<div class="task-group">' +
        '<div class="task-group-head">' + icon(g.icon, 18) +
        '<span class="task-group-title">' + esc(g.title) + '</span>' +
        '<span class="meta">' + esc(g.blurb) + '</span></div>' +
        '<div class="task-grid">' + g.tasks.map(taskCard).join('') + '</div>' +
        '</div>';
    }).join('');
    setView(
      pageHead('Platform Configs', 'Change how files are built, read and reported. Every change needs approval.',
        roleBar()) +
      pendingBanner() +
      '<div class="task-groups">' + groups + '</div>' +
      browseSection()
    );
  }

  /* A one-line reminder of what the user came here to do, carried from the
     task card into the editor. It never blocks anything. */
  function taskHint() {
    // Context carried in from a reject's "Open Platform Configs →" (Rejects
    // Part 5). The panel state is preserved over there — the back link returns
    // to the batch with the fix panel still open.
    var rejHint = '';
    var rj = S.cfg.rejFrom;
    if (rj) {
      var rtxn = window.REJDATA && window.REJDATA.txnById[rj.id];
      var rtext = window.REJDATA ? window.REJDATA.reasonText(rj.reason) : '';
      rejHint = '<div class="cfg-task-hint">' + kit.icon('corner-up-left', 16) +
        '<span><strong>From a reject</strong> — ' +
        (rtxn ? '<span class="mono">' + kit.esc(rtxn.arn) + '</span> · ' : '') +
        kit.esc(rtext) + ' <span class="mono">' + kit.esc(rj.reason || '') + '</span>. ' +
        'The fix panel stays open in Rejects — go back to finish it.' +
        (rj.batch ? ' <a data-route="#/dashboard/ops/rejects/' + kit.esc(rj.batch) + '">Back to the reject</a>' : '') +
        '</span>' +
        '<button class="icon-btn xs" data-action="cfg-rej-clear" title="Dismiss" aria-label="Dismiss">' + kit.icon('x', 14) + '</button>' +
        '</div>';
    }
    /* Carried in from a failure block's primary action (file-detail brief
       Part 7). It names the file and the error code that sent the operator
       here, and offers the way back to the panel they came from — a deep link
       that arrives with no idea why it arrived is half a link. */
    var runHint = '';
    var rf = S.cfg.fileFrom;
    if (rf) {
      var file = window.PFILES ? window.PFILES.byUuid(rf.uuid) : null;
      runHint = '<div class="cfg-task-hint cfg-run-hint">' + kit.icon('file-warning', 16) +
        '<span><strong>From a failed file</strong> — ' +
        (file ? '<span class="mono">' + kit.esc(file.name) + '</span>' : '<span class="mono">' + kit.esc(rf.uuid) + '</span>') +
        (rf.code ? ' stopped on <span class="mono">' + kit.esc(rf.code) + '</span>' : ' stopped here') +
        '. Fix it here, then retry the step from the file.' +
        (rf.back ? ' <a data-route="' + kit.esc(rf.back) + '">Back to the file</a>' : '') +
        '</span>' +
        '<button class="icon-btn xs" data-action="cfg-run-clear" title="Dismiss" aria-label="Dismiss">' + kit.icon('x', 14) + '</button>' +
        '</div>';
    }

    // A task card no longer lands in the editor (Part 8.2), so this only ever
    // fires for a deep link that still carries ?task=.
    var t = TASK_BY_ID[S.cfg.task];
    if (!t) return rejHint + runHint;
    var extra = {
      'add-field': 'Click an unexplained gap in the ruler to add a field there, or use Add field below.',
      'move-field': 'Edit “Starts at” and “Length” in the table, or use Fix positions automatically.',
      'map-data': 'Each file field is paired with the data it comes from. Unmapped fields are highlighted.',
      'fix-parse': 'Unrecognised fields from recent files are listed at the top — one click adds any of them.',
      'report-when': 'Change a control and read Next 5 runs — no offset arithmetic needed.',
      'fee-rules': 'Each rule states its conditions and charge in plain language. Test one with the calculator.'
    }[t.id] || '';
    return rejHint + runHint + '<div class="cfg-task-hint">' + icon('target', 16) +
      '<span><strong>' + t.label + '</strong>' + (extra ? ' — ' + extra : '') + '</span>' +
      '<button class="icon-btn xs" data-action="cfg-task-clear" title="Dismiss" aria-label="Dismiss">' + icon('x', 14) + '</button>' +
      '</div>';
  }

  /* ---- Post-render wiring (raw editor scroll sync + row drag) ------------ */
  function mount() {
    var ta = el('cfgRawTa'), hl = el('cfgRawHl');
    if (ta && hl && !ta.dataset.bound) {
      ta.dataset.bound = '1';
      ta.addEventListener('scroll', function () { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
    }
    /* Part 5.3 — two-way hover linking. A ruler segment and its table row carry
       the same data-fieldkey; hovering either lights both. */
    var hv = el('view');
    if (hv && !hv.dataset.hoverBound) {
      hv.dataset.hoverBound = '1';
      var lit = [];
      function clear() { lit.forEach(function (n) { n.classList.remove('fk-lit'); }); lit = []; }
      hv.addEventListener('mouseover', function (ev) {
        var n = ev.target.closest && ev.target.closest('[data-fieldkey]');
        if (!n) return;
        var k = n.getAttribute('data-fieldkey');
        clear();
        Array.prototype.forEach.call(hv.querySelectorAll('[data-fieldkey="' + k + '"]'), function (x) {
          x.classList.add('fk-lit'); lit.push(x);
        });
      });
      hv.addEventListener('mouseout', function (ev) {
        var n = ev.target.closest && ev.target.closest('[data-fieldkey]');
        if (n) clear();
      });
    }

    var view = el('view');
    if (view && !view.dataset.dndBound) {
      view.dataset.dndBound = '1';
      var dragIdx = null, dragPath = null;
      view.addEventListener('dragstart', function (ev) {
        var tr = ev.target.closest && ev.target.closest('[data-dnd]');
        if (!tr) return;
        dragIdx = +tr.getAttribute('data-idx');
        var host = tr.closest('[data-dnd-table]');
        dragPath = host ? host.getAttribute('data-dnd-table') : null;
        if (dragPath == null) return;
        tr.classList.add('dragging');
        if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(dragIdx)); }
      });
      view.addEventListener('dragover', function (ev) {
        var tr = ev.target.closest && ev.target.closest('[data-dnd]');
        if (tr && dragPath != null) { ev.preventDefault(); tr.classList.add('drop-target'); }
      });
      view.addEventListener('dragleave', function (ev) {
        var tr = ev.target.closest && ev.target.closest('[data-dnd]');
        if (tr) tr.classList.remove('drop-target');
      });
      view.addEventListener('drop', function (ev) {
        var tr = ev.target.closest && ev.target.closest('[data-dnd]');
        if (!tr || dragPath == null) return;
        ev.preventDefault();
        var to = +tr.getAttribute('data-idx');
        var e = edit(); if (!e) return;
        var arr = X.getPath(e.body, dragPath);
        if (Array.isArray(arr) && dragIdx !== to) {
          var item = arr.splice(dragIdx, 1)[0];
          arr.splice(to, 0, item);
          e.dirty = true; e.raw = null; e.rawErr = null;
          renderBody();
        }
        dragIdx = null; dragPath = null;
      });
      view.addEventListener('dragend', function () {
        Array.prototype.forEach.call(view.querySelectorAll('.dragging,.drop-target'), function (n) { n.classList.remove('dragging', 'drop-target'); });
      });
    }
  }

  /* ---- Targeted re-renders ---------------------------------------------- */
  function renderBody() {
    var cfg = current(); if (!cfg) return;
    put('cfgTabBody', tabBody(cfg));
    renderValidation();
    mount();
  }
  function renderValidation() {
    var cfg = current(); if (!cfg) return;
    var n = el('cfgValidation');
    if (n) n.outerHTML = validationPanel();
    put('cfgActions', headActionsHtml(cfg));
    if (window.lucide) lucide.createIcons();
  }
  function headActionsHtml(cfg) {
    var tmp = document.createElement('div');
    tmp.innerHTML = editorHeader(cfg);
    var a = tmp.querySelector('#cfgActions');
    return a ? a.innerHTML : '';
  }
  function renderByteMaps() {
    var e = edit(), cfg = current();
    if (!e || !cfg || cfg.family !== 'network-file' || S.cfg.mode !== 'form') return renderValidation();
    // Only fixed-width layouts have a byte map to redraw.
    if (!F.isFixed(e.body)) return renderValidation();
    (e.body.record_types || []).forEach(function (rt, i) {
      put('bmw-' + i, X.byteMapHtml(e.body.record_length, rt.fields, { interactive: true, rt: i }));
    });
    renderValidation();
  }
  function renderPreview() {
    var n = el('cfgSchedPreview');
    if (n) { n.outerHTML = schedulePreviewHtml(); if (window.lucide) lucide.createIcons(); }
    renderValidation();
  }
  function refresh(kind) {
    if (kind === 'bytemap') return renderByteMaps();
    if (kind === 'preview') return renderPreview();
    if (kind === 'body') return renderBody();
    // A format change reshapes the whole editor, header included.
    if (kind === 'format') return renderFamily(S.cfg.family);
    renderValidation();
  }

  /* ---- Output-format switch ----------------------------------------------
     Moving between fixed_width / xml / csv adds the blocks the new format needs
     and drops the ones it cannot use, so the body never carries a record_length
     for an XML file or an xml_file_config for a fixed-width one. Nothing is
     silently thrown away that the user typed for the format they came back to —
     the previous blocks are parked in screen state and restored on return. */
  function migrateFormat(body, fmt) {
    var id = (edit() || {}).configId || '_';
    var parked = S.cfg.parked[id] || (S.cfg.parked[id] = {});
    var prev = F.formatOf(body);
    if (prev === fmt) return;
    parked[prev] = {
      record_length: body.record_length, padding_char: body.padding_char, encoding: body.encoding,
      xml_file_config: body.xml_file_config, csv_config: body.csv_config, line_ending: body.line_ending
    };
    ['record_length', 'padding_char', 'encoding', 'xml_file_config', 'csv_config', 'line_ending'].forEach(function (k) { delete body[k]; });
    var back = parked[fmt] || {};
    if (fmt === 'fixed_width') {
      body.record_length = back.record_length != null ? back.record_length : 0;
      body.padding_char = back.padding_char != null ? back.padding_char : ' ';
      body.encoding = back.encoding || 'ASCII';
    } else if (fmt === 'xml') {
      body.xml_file_config = back.xml_file_config ||
        { declaration: '<?xml version="1.0" encoding="UTF-8"?>', root_element: 'File', pretty_print: false };
    } else if (fmt === 'csv') {
      body.csv_config = back.csv_config || { delimiter: ',' };
      body.line_ending = back.line_ending || 'CRLF';
    }
    body.output_format = fmt;
    var oc = body.output_config || (body.output_config = {});
    var opts = F.extensionOptions(fmt);
    if (opts.indexOf(oc.output_extension) < 0) oc.output_extension = F.caps(fmt).defaultExtension;
  }

  /* =======================================================================
     Lifecycle mutations (Part 4.4 / 4.5 / 9.3)
     ======================================================================= */
  function nowStamp() { return U.prettyDate(D.TODAY) + ', ' + '11:42 IST'; }
  function priorBody(cfg) {
    if (cfg.baseBody) return cfg.baseBody;
    if (cfg.versions.length) return cfg.versions[cfg.versions.length - 1].body;
    return null;
  }
  function saveDraft(cfg, silent) {
    var e = edit();
    cfg.currentDraft = { body: C.clone(e.body), editedBy: C.DEMO_USER, editedAt: nowStamp() };
    cfg.name = e.name;
    cfg.updatedAt = nowStamp();
    e.dirty = false;
    if (!silent) toast('Draft saved in memory — not yet submitted for approval');
  }
  function submitForApproval(cfg) {
    var e = edit();
    cfg.baseBody = C.clone(cfg.body);
    cfg.body = C.clone(e.body);
    cfg.name = e.name;
    cfg.state = 'PENDING_APPROVAL';
    cfg.submittedBy = C.DEMO_USER;
    cfg.submittedAt = nowStamp();
    cfg.submittedHoursAgo = 0;
    cfg.currentDraft = null;
    cfg.rejectionReason = null;
    cfg.updatedAt = nowStamp();
    e.dirty = false;
    toast('Submitted for approval — now in the config approvals queue', 'success');
  }
  function approve(cfg, comment) {
    var prior = priorBody(cfg);
    cfg.versions.push({
      version: cfg.versions.length + 1,
      body: C.clone(cfg.body),
      summary: X.diffSummary(prior, cfg.body) + (comment ? ' ' + comment : ''),
      submittedBy: cfg.submittedBy, approvedBy: C.DEMO_USER, approvedAt: nowStamp(),
      kind: 'normal', reason: null
    });
    cfg.state = 'APPROVED';
    cfg.approvedBy = C.DEMO_USER;
    cfg.approvedAt = nowStamp();
    cfg.baseBody = null;
    cfg.updatedAt = nowStamp();
    if (comment) cfg.comments.push({ by: C.DEMO_USER, at: nowStamp(), text: comment, kind: 'approval' });
  }
  function reject(cfg, comment) {
    // The proposal is preserved as an editable draft; the live body reverts to the
    // last approved version so production keeps running the signed-off config.
    cfg.currentDraft = { body: C.clone(cfg.body), editedBy: cfg.submittedBy, editedAt: nowStamp() };
    if (cfg.baseBody) { cfg.body = cfg.baseBody; cfg.baseBody = null; }
    cfg.state = 'REJECTED';
    cfg.rejectionReason = comment;
    cfg.rejectedBy = C.DEMO_USER;
    cfg.rejectedAt = nowStamp();
    cfg.updatedAt = nowStamp();
    cfg.comments.push({ by: C.DEMO_USER, at: nowStamp(), text: comment, kind: 'rejection' });
    resetEdit();
  }

  /* =======================================================================
     ACTIONS
     ======================================================================= */
  var TPL = {
    field: function (arr) {
      var last = arr[arr.length - 1];
      return { name: 'new_field', start: last ? (+last.start + +last.length) : 1, length: 1, type: 'AN', note: '' };
    },
    recordtype: function () { return { record_type: 'NEW', label: 'New record type', fields: [] }; },
    // Format-specific templates — an XML field needs a tag, a CSV column needs a
    // DE/PDS name and a description, and neither has byte positions.
    xmlfield: function () { return { name: 'nNewField', xml_tag: 'nNewField', note: '' }; },
    xmlrecord: function () { return { record_type: 'Txn', label: 'New record', group: 'transactions', xml_element: 'Txn', fields: [] }; },
    defield: function () { return { name: 'DE0', length: 1, type: 'AN', note: '' }; },
    csvrecord: function () { return { record_type: '1240', label: 'New record type', group: 'transactions', fields: [] }; },
    fieldmap: function () { return { source: '', transform: 'passthrough' }; },
    group: function (arr) {
      return {
        name: 'new_group_' + (arr.length + 1), record_types: [], key: [], sort_by: [],
        csv_config: null, xml_config: null,
        fields: { source: [], constants: {}, derived: [] }, children: []
      };
    },
    grprt: function () { return { type: '', conditions: [] }; },
    grpcond: function () { return { field: '', operator: 'in', values: [] }; },
    derived: function () { return { name: 'new_field', type: 'constant', params: { value: '' } }; },
    extraction: function () { return { source_column: C.SOURCE_COLUMNS[0], rows: [{ json_key: '', output: '' }] }; },
    extrow: function () { return { json_key: '', output: '' }; },
    surrow: function () { return { source: '', output: '' }; },
    schedrule: function () {
      return {
        match: { field: '', value: '' },
        transaction_date: { from: { offset: 'T-1', time: '00:00:00' }, to: { offset: 'T-1', time: '23:59:59' } },
        report_offset: 'T+0', sundays_off: false, saturdays_off: false, apply_general_holiday: true
      };
    },
    fetch: function () { return { source: C.SOURCE_COLUMNS[0], keys: [] }; },
    selcol: function () { return { column: '', alias: null }; },
    feerule: function (arr) {
      var maxP = arr.reduce(function (m, r) { return Math.max(m, +r.priority || 0); }, 0);
      return {
        model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: maxP + 10, starting_date: D.TODAY,
        conditions: [], calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 1.00 }] }
      };
    },
    cond: function () { return { field: '', condition: 'EQ', value: '' }; },
    calc: function (arr) {
      var last = arr[arr.length - 1];
      var min = last && last.max != null ? +last.max : 0;
      return { min: min, max: null, field: 'txn_amount', percentage: 1.00 };
    },
    secrule: function () { return { match: '', bucket: '' }; },
    filter: function () { return { field: '', condition: 'EQ', value: '' }; },
    ipfield: function (arr) {
      var last = arr[arr.length - 1];
      return { name: 'new_field', start: last ? (+last.start + +last.length) : 1, length: 1, type: 'AN', note: '' };
    },
    parserrt: function () { return { group: 'transactions', mappings: {}, fields: [], filters: [], mutations: [], computations: [], notes: {} }; }
  };

  function setField(t) {
    var e = edit(); if (!e) return;
    var path = t.getAttribute('data-path'), cast = t.getAttribute('data-cast');
    var v = (t.type === 'checkbox') ? t.checked : t.value;
    if (cast === 'int') v = (v === '' ? 0 : (parseInt(v, 10) || 0));
    else if (cast === 'number') v = (v === '' ? 0 : (parseFloat(v) || 0));
    else if (cast === 'nullable-number') v = (v === '' ? null : parseFloat(v));
    else if (cast === 'bool') v = !!v;
    if (path === 'layout_ref' && v === '') v = null;
    if (path === 'output_format') {
      migrateFormat(e.body, v);
      e.dirty = true; e.raw = null; e.rawErr = null;
      return refresh('format');
    }
    // "Custom…" in the extension picker clears the value so the free-text box appears.
    if (path === 'output_config.output_extension' && v === '__custom') v = '';
    X.setPath(e.body, path, v);
    e.dirty = true; e.raw = null; e.rawErr = null;
    // Auto-pack keeps positions contiguous while the toggle is on for that record type.
    var m = /^record_types\.(\d+)\./.exec(path);
    if (m && S.cfg.autoPack[e.configId + ':' + m[1]]) X.autoPack(e.body.record_types[+m[1]].fields);
    refresh(t.getAttribute('data-refresh'));
  }

  var ACTIONS = {
    /* --- list pane --- */
    'cfg-select': function (t) {
      var id = t.getAttribute('data-id');
      if (id === S.cfg.selected[S.cfg.family]) return;
      go(famRoute(S.cfg.family, id));
    },
    'cfgi-list-q': function (t) {
      S.cfg.filters[S.cfg.family].q = t.value;
      renderFamily(S.cfg.family);
      var i = el('view').querySelector('[data-action=cfgi-list-q]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    /* Browse-all disclosure: the same list, its own filter scope, repainting
       whichever screen it happens to be sitting on (landing or family). */
    'cfgi-browse-q': function (t) {
      S.cfg.filters[S.cfg.browseFam].q = t.value;
      repaintHere();
      var i = el('view').querySelector('[data-action=cfgi-browse-q]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'cfgc-browse-tenant': function (t) { S.cfg.filters[S.cfg.browseFam].tenant = t.value; repaintHere(); },
    'cfgc-browse-facet': function (t) { S.cfg.filters[S.cfg.browseFam].facet = t.value; repaintHere(); },
    'cfgc-browse-state': function (t) { S.cfg.filters[S.cfg.browseFam].state = t.value; repaintHere(); },
    'cfgc-list-tenant': function (t) { S.cfg.filters[S.cfg.family].tenant = t.value; renderFamily(S.cfg.family); },
    'cfgc-list-facet': function (t) { S.cfg.filters[S.cfg.family].facet = t.value; renderFamily(S.cfg.family); },
    'cfgc-list-state': function (t) { S.cfg.filters[S.cfg.family].state = t.value; renderFamily(S.cfg.family); },
    'cfg-filters-clear': function () {
      var fl = S.cfg.filters[S.cfg.family];
      fl.q = ''; fl.tenant = 'all'; fl.facet = 'all'; fl.state = 'all';
      renderFamily(S.cfg.family);
    },
    /* ---- Task-based landing (Part 5.1) ---- */
    'cfg-task': function (t) {
      var task = TASK_BY_ID[t.getAttribute('data-task')];
      if (!task) return;
      S.cfg.task = task.id;
      S.cfg.tab[task.fam] = task.tab;
      if (task.id === 'new-incoming') { S.cfg.family = task.fam; ACTIONS['cfg-new'](); return; }
      go(famRoute(task.fam) + '?task=' + task.id);
    },
    'cfg-task-clear': function () { S.cfg.task = null; renderFamily(S.cfg.family); },
    'cfg-rej-clear': function () { S.cfg.rejFrom = null; renderFamily(S.cfg.family); },
    'cfg-run-clear': function () { S.cfg.fileFrom = null; renderFamily(S.cfg.family); },
    'cfg-browse': function () {
      S.cfg.browseOpen = !S.cfg.browseOpen;
      if (S.opsChild) renderFamily(S.cfg.family); else renderLanding();
    },
    'cfg-browse-fam': function (t) {
      S.cfg.browseFam = t.getAttribute('data-fam');
      if (S.opsChild) renderFamily(S.cfg.family); else renderLanding();
    },

    /* ---- Layout ruler (Part 5.3) ----
       Clicking an unexplained gap opens the add-field form pre-filled with that
       gap's start position and length. */
    'cfg-gap': function (t) {
      S.cfg.gapForm = {
        rt: parseInt(t.getAttribute('data-rt'), 10),
        start: parseInt(t.getAttribute('data-start'), 10),
        len: parseInt(t.getAttribute('data-len'), 10)
      };
      renderBody();
      var n = el('gapName'); if (n) n.focus();
    },
    'cfg-gap-cancel': function () { S.cfg.gapForm = null; renderBody(); },
    'cfg-unused': function () { S.cfg.unusedOpen = !S.cfg.unusedOpen; renderBody(); },
    /* ---- Fee calculator (Part 5.5) ---- */
    'cfgi-calc-amount': function (t) {
      S.cfg.feeCalc.amount = parseFloat(t.value) || 0;
      renderBody();
      var i = el('view').querySelector('[data-action="cfgi-calc-amount"]');
      if (i) { i.focus(); }
    },
    'cfgc-calc-network': function (t) { S.cfg.feeCalc.network = t.value; renderBody(); },
    'cfgc-calc-card': function (t) { S.cfg.feeCalc.card = t.value; renderBody(); },

    /* ---- Parsing issues (Part 5.4) ----
       One click turns "a field isn't parsing" into a confirmation: the name as
       seen, the inferred window and a suggested content type are already in. */
    'cfg-parse-add': function (t) {
      var cfg = current(); if (!cfg) return;
      var name = t.getAttribute('data-field');
      var hit = C.parsingIssues(cfg).filter(function (x) { return x.field === name; })[0];
      if (!hit) return;
      S.cfg.parseForm = {
        configId: cfg.configId, field: hit.field, start: hit.start,
        length: hit.length, type: hit.type, note: hit.note
      };
      renderBody();
      var n = el('paName'); if (n) n.focus();
    },
    'cfg-parse-cancel': function () { S.cfg.parseForm = null; renderBody(); },
    'cfg-parse-confirm': function () {
      var e = edit(), cfg = current(); if (!e || !cfg) return;
      var v = function (id) { var n = el(id); return n ? n.value : ''; };
      var name = (v('paName') || '').trim();
      var rtKey = v('paRt');
      var rts = e.body.record_types || (e.body.record_types = {});
      var rt = rts[rtKey];
      if (!name) { toast('The field needs a name', 'info'); return; }
      if (!rt) { toast('Pick a record type to add it to', 'info'); return; }
      rt.fields = rt.fields || [];
      rt.fields.push({
        name: name, start: parseInt(v('paStart'), 10) || 1,
        length: parseInt(v('paLen'), 10) || 1, type: v('paType') || 'AN', note: v('paNote') || ''
      });
      rt.fields.sort(function (a, b) { return (+a.start || 0) - (+b.start || 0); });
      S.cfg.parsedFixed[cfg.configId + ':' + (S.cfg.parseForm || {}).field] = true;
      S.cfg.parseForm = null;
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
      toast(name + ' added — submit for approval to make it live', 'success');
    },

    /* ---- Test with a sample file (Part 5.4) — mocked, per Part 7 ---- */
    'cfg-sample-pick': function () { var n = el('cfgSampleFile'); if (n) n.click(); },
    'cfg-sample-clear': function () { S.cfg.sampleTest = null; renderBody(); },
    'cfg-sample-file': function (t) {
      var cfg = current(); var e = edit(); if (!cfg || !e) return;
      var name = (t.files && t.files[0] && t.files[0].name) || 'sample.txt';
      // Plausible extracted values, deterministic per field so a re-render is
      // stable. No real parsing happens — Part 7 says not to build it.
      var rows = [];
      Object.keys(e.body.record_types || {}).forEach(function (k) {
        ((e.body.record_types[k] || {}).fields || []).forEach(function (f) {
          var seed = 0;
          for (var i = 0; i < String(f.name).length; i++) seed = (seed * 31 + String(f.name).charCodeAt(i)) % 9973;
          var len = Math.max(1, +f.length || 1);
          var val;
          if (seed % 11 === 0) val = null;                       // extracted nothing
          else if (f.type === 'N') val = String(seed).padStart(len, '0').slice(0, len);
          else val = (String(f.name).toUpperCase().replace(/[^A-Z0-9]/g, '') + '000000').slice(0, len);
          rows.push({ field: f.name, start: f.start, length: f.length, value: val });
        });
      });
      S.cfg.sampleTest = { configId: cfg.configId, name: name, rows: rows };
      renderBody();
      toast('Parsed ' + name + ' against this configuration', 'success');
    },
    // Map a highlighted unmapped field straight from the warning row.
    'cfg-map-quick': function (t) {
      var e = edit(); if (!e) return;
      var name = t.getAttribute('data-name');
      var tf = e.body.transform || (e.body.transform = {});
      var fm = tf.field_mappings || (tf.field_mappings = {});
      if (!fm[name]) fm[name] = { source: '', transform: 'passthrough', params: {} };
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-gap-add': function (t) {
      var e = edit(); if (!e) return;
      var i = parseInt(t.getAttribute('data-rt'), 10);
      var rt = (e.body.record_types || [])[i]; if (!rt) return;
      var v = function (id) { var n = el(id); return n ? n.value : ''; };
      var name = (v('gapName') || '').trim();
      if (!name) { toast('Give the field a name first', 'info'); var n0 = el('gapName'); if (n0) n0.focus(); return; }
      var start = parseInt(v('gapStart'), 10), len = parseInt(v('gapLen'), 10);
      if (!(start > 0) || !(len > 0)) { toast('Start position and length must both be positive', 'info'); return; }
      rt.fields = rt.fields || [];
      rt.fields.push({ name: name, start: start, length: len, type: v('gapType') || 'AN', note: v('gapNote') || '' });
      // Position order is the order the record is read in, so keep the table in it.
      rt.fields.sort(function (a, b) { return (+a.start || 0) - (+b.start || 0); });
      e.dirty = true; e.raw = null; e.rawErr = null;
      S.cfg.gapForm = null;
      renderBody();
      toast('Added ' + name + ' at characters ' + start + '–' + (start + len - 1), 'success');
    },
    'cfg-autopack-run': function (t) {
      var e = edit(); if (!e) return;
      var i = parseInt(t.getAttribute('data-rt'), 10);
      var rt = (e.body.record_types || [])[i]; if (!rt) return;
      X.autoPack(rt.fields || []);
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
      toast('Start positions recalculated from the lengths', 'success');
    },
    'cfg-new': function () {
      var fam = S.cfg.family;
      var item = fam === 'settlement' ? stItem() : null;
      // Inside a report item, "create" fills the gap on the tab you are standing
      // on rather than starting an unrelated config.
      var subType = fam === 'network-file' ? 'layout'
        : (fam === 'settlement' ? (S.cfg.tab.settlement === 'content' ? 'content' : (S.cfg.tab.settlement === 'fees' ? 'fees' : 'schedule')) : 'pipeline');
      var id = C.nextId(fam);
      var tenant = item ? item.tenantId : 'hsbc_in';
      var report = item ? (subType === 'fees' ? 'FEES' : (subType === 'schedule' && C.REPORT_BASES.indexOf(item.report) >= 0 && item.report.indexOf('JV') === 0 ? item.report + '_FEE_DATE' : item.report)) : 'MPR';
      var cfgType = fam === 'network-file' ? 'CLEARING_FILE'
        : (fam === 'settlement' ? (subType === 'content' ? 'SETTLEMENT_REPORT' : (subType === 'fees' ? 'FEE_RULES' : 'SETTLEMENT_GENERATOR')) : 'INCOMING');
      var cfg = {
        configId: id,
        configType: cfgType,
        family: fam, subType: subType,
        name: item ? (tenant + ' · ' + item.report + ' · ' + subType) : ('new · ' + C.familyById[fam].short.toLowerCase() + ' · draft'),
        network: fam === 'network-file' ? 'visa' : undefined,
        report: fam === 'settlement' ? report : undefined,
        source: fam === 'incoming-parsing' ? 'visa_incoming' : undefined,
        recordSet: fam === 'network-file' ? 'clearing' : undefined,
        tenantId: tenant, paymentEntity: tenant.toUpperCase() + '_ACQ', state: 'DRAFT',
        body: C.blankBody(fam, subType),
        createdBy: C.DEMO_USER, createdAt: nowStamp(), updatedAt: nowStamp(),
        approvedBy: null, approvedAt: null, submittedBy: null, submittedAt: null,
        submittedHoursAgo: null, rejectionReason: null, versions: [], currentDraft: null, comments: []
      };
      if (fam === 'settlement') {
        var r = C.splitReport(cfg.report);
        cfg.reportBase = r.base; cfg.variant = r.variant;
        if (subType === 'schedule' && cfg.body) cfg.body.report = cfg.report;
      }
      C.configs.unshift(cfg); C.byId[id] = cfg;
      go(famRoute(fam, fam === 'settlement' ? (item ? item.key : C.itemKeyForConfig(cfg)) : id));
      toast('New draft created — fill it in, validate, then submit for approval');
    },

    /* --- editor chrome --- */
    'cfg-tab': function (t) { S.cfg.tab[S.cfg.family] = t.getAttribute('data-tab'); S.cfg.expandedRule = null; renderFamily(S.cfg.family); },
    'cfg-mode': function (t) {
      var mode = t.getAttribute('data-mode'), e = edit();
      if (mode === 'raw' && e && !e.rawErr) e.raw = X.serialize(e.body, S.cfg.rawFormat);
      S.cfg.mode = mode;
      renderFamily(S.cfg.family);
    },
    'cfg-rawfmt': function (t) {
      var e = edit(), fmt = t.getAttribute('data-fmt');
      if (fmt === S.cfg.rawFormat) return;
      S.cfg.rawFormat = fmt;
      if (e) { e.raw = X.serialize(e.body, fmt); e.rawErr = null; }
      renderFamily(S.cfg.family);
    },
    'cfgi-raw': function (t) {
      var e = edit(); if (!e) return;
      e.raw = t.value; e.dirty = true;
      try {
        var parsed = X.deserialize(t.value, S.cfg.rawFormat);
        if (!parsed || typeof parsed !== 'object') throw new Error('document root must be an object');
        e.body = parsed; e.rawErr = null;
      } catch (ex) {
        e.rawErr = (S.cfg.rawFormat === 'yaml' ? 'YAML' : 'JSON') + ' syntax error — ' + (ex.message || ex);
      }
      var hl = el('cfgRawHl');
      if (hl) hl.innerHTML = X.highlight(t.value, S.cfg.rawFormat);
      var bar = el('view').querySelector('.raw-err, .raw-ok');
      if (bar) {
        bar.className = e.rawErr ? 'raw-err' : 'raw-ok';
        bar.innerHTML = e.rawErr
          ? icon('alert-triangle', 15) + esc(e.rawErr)
          : icon('check-circle', 15) + S.cfg.rawFormat.toUpperCase() + ' parses cleanly — the form tabs reflect these values.';
        if (window.lucide) lucide.createIcons();
      }
      renderValidation();
    },
    'cfgi-name': function (t) { var e = edit(); if (e) { e.name = t.value; e.dirty = true; } },
    'cfgc-role': function (t) { S.cfg.role = t.value; renderFamily(S.cfg.family); toast('Role switched to ' + t.value); },

    /* --- generic model binding --- */
    'cfgi-set': setField,
    'cfgc-set': setField,
    'cfg-offset': function (t) {
      var e = edit(); if (!e) return;
      var path = t.getAttribute('data-path'), dir = +t.getAttribute('data-dir');
      var cur = X.parseOffset(X.getPath(e.body, path));
      if (cur === null) cur = 0;
      var next = Math.max(-9, Math.min(9, cur + dir));
      X.setPath(e.body, path, X.fmtOffset(next));
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-arr-add': function (t) {
      var e = edit(); if (!e) return;
      var path = t.getAttribute('data-path'), tpl = t.getAttribute('data-tpl');
      var arr = X.getPath(e.body, path);
      if (!Array.isArray(arr)) { arr = []; X.setPath(e.body, path, arr); }
      arr.push(TPL[tpl](arr));
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-arr-del': function (t) {
      var e = edit(); if (!e) return;
      X.delPath(e.body, t.getAttribute('data-path') + '.' + t.getAttribute('data-idx'));
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-arr-move': function (t) {
      var e = edit(); if (!e) return;
      X.movePath(e.body, t.getAttribute('data-path'), +t.getAttribute('data-idx'), +t.getAttribute('data-dir'));
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-tag-add': function (t) {
      var e = edit(); if (!e) return;
      var v = (t.value || '').trim(); if (!v) return;
      var path = t.getAttribute('data-path');
      var arr = X.getPath(e.body, path);
      if (!Array.isArray(arr)) { arr = []; X.setPath(e.body, path, arr); }
      arr.push(v);
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-map-add': function (t) {
      var e = edit(); if (!e) return;
      var path = t.getAttribute('data-path'), selId = t.getAttribute('data-sel'), tpl = t.getAttribute('data-tpl');
      var input = el(selId); if (!input) return;
      var key = (input.value || '').trim(); if (!key) { toast('Enter a name first', 'info'); return; }
      var obj = X.getPath(e.body, path);
      if (!obj || typeof obj !== 'object') { obj = {}; X.setPath(e.body, path, obj); }
      if (obj[key] !== undefined) { toast('"' + key + '" already exists', 'info'); return; }
      obj[key] = tpl ? TPL[tpl]() : '';
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    'cfg-map-del': function (t) {
      var e = edit(); if (!e) return;
      var obj = X.getPath(e.body, t.getAttribute('data-path'));
      if (obj) delete obj[t.getAttribute('data-key')];
      e.dirty = true; e.raw = null; e.rawErr = null;
      renderBody();
    },
    // Composite DE → PDS accordion (Mastercard layout, §3.1.3)
    'cfg-acc': function (t) {
      var k = (edit() || {}).configId + ':' + t.getAttribute('data-rt') + ':' + t.getAttribute('data-name');
      S.cfg.acc[k] = !S.cfg.acc[k];
      renderBody();
    },
    // Group-mapping section (transform tab, §3.2b) — open by default.
    'cfg-grp': function (t) {
      var k = (edit() || {}).configId + ':' + t.getAttribute('data-name');
      S.cfg.grpOpen[k] = (S.cfg.grpOpen[k] === false);
      renderBody();
    },
    'cfgc-autopack': function (t) {
      var e = edit(); if (!e) return;
      var i = t.getAttribute('data-rt');
      S.cfg.autoPack[e.configId + ':' + i] = t.checked;
      if (t.checked) {
        X.autoPack(e.body.record_types[+i].fields);
        e.dirty = true; e.raw = null; e.rawErr = null;
        toast('Start positions re-packed contiguously from byte 1');
      }
      renderBody();
    },
    'cfg-fee-expand': function (t) {
      var i = +t.getAttribute('data-idx');
      S.cfg.expandedRule = (S.cfg.expandedRule === i) ? null : i;
      renderBody();
    },
    'cfg-variant': function (t) {
      var it = stItem(); if (!it) return;
      S.cfg.schedVariant[it.key] = t.getAttribute('data-id');
      renderFamily('settlement');
    },
    'cfg-feesel': function (t) {
      var it = stItem(); if (!it) return;
      S.cfg.feeSel[it.key] = t.getAttribute('data-id');
      renderFamily('settlement');
    },
    'cfgc-sample': function (t) { S.cfg.sampleDate = t.value || D.TODAY; renderPreview(); },

    /* --- lifecycle --- */
    'cfg-validate': function () {
      var v = validationOf();
      renderValidation();
      if (v.errors.length) toast(v.errors.length + ' error' + (v.errors.length === 1 ? '' : 's') + ' and ' + v.warnings.length + ' warning' + (v.warnings.length === 1 ? '' : 's') + ' — see the Validation panel', 'info');
      else if (v.warnings.length) toast('No errors · ' + v.warnings.length + ' warning' + (v.warnings.length === 1 ? '' : 's') + ' to review', 'info');
      else toast('All validators pass', 'success');
      var n = el('cfgValidation'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    'cfg-save': function () { var cfg = current(); if (!cfg || !can(cfg, 'save').ok) return; saveDraft(cfg); renderFamily(S.cfg.family); },
    'cfg-submit': function () {
      var cfg = current(); if (!cfg || !can(cfg, 'submit').ok) return;
      var v = validationOf();
      if (v.errors.length) { toast('Fix the ' + v.errors.length + ' validation error' + (v.errors.length === 1 ? '' : 's') + ' first', 'info'); return; }
      submitForApproval(cfg);
      renderFamily(S.cfg.family);
    },
    'cfg-approve': function () {
      var cfg = current(); if (!cfg || !can(cfg, 'approve').ok) return;
      approve(cfg, '');
      resetEdit(); renderFamily(S.cfg.family);
      toast('Approved — click Activate to put this version live', 'success');
    },
    'cfg-reject': function () {
      var cfg = current(); if (!cfg || !can(cfg, 'reject').ok) return;
      api.openReject(cfg, function () { renderFamily(S.cfg.family); });
    },
    'cfg-activate': function () {
      var cfg = current(); if (!cfg || !can(cfg, 'activate').ok) return;
      cfg.state = 'ACTIVE'; cfg.updatedAt = nowStamp();
      renderFamily(S.cfg.family);
      toast(cfg.name + ' is now ACTIVE in production', 'success');
    },
    'cfg-deactivate': function () {
      var cfg = current(); if (!cfg || !can(cfg, 'deactivate').ok) return;
      cfg.state = 'INACTIVE'; cfg.updatedAt = nowStamp();
      cfg.deactivatedNote = 'Deactivated by ' + C.DEMO_USER + ' on ' + nowStamp() + '.';
      renderFamily(S.cfg.family);
      toast(cfg.name + ' deactivated — no longer live', 'success');
    },

    /* --- history / drawer --- */
    'cfg-history': function () {
      var cfg = current(); if (!cfg) return;
      var v = cfg.versions;
      S.cfg.history = {
        open: true, compare: false,
        a: v.length > 1 ? v[v.length - 2].version : (v.length ? v[0].version : null),
        b: v.length ? v[v.length - 1].version : null
      };
      renderFamily(S.cfg.family);
    },
    'cfg-history-close': function () { S.cfg.history.open = false; renderFamily(S.cfg.family); },
    'cfgc-ver': function (t) { S.cfg.history[t.getAttribute('data-side')] = +t.value; S.cfg.history.compare = true; renderFamily(S.cfg.family); },
    'cfg-compare': function () { S.cfg.history.compare = true; renderFamily(S.cfg.family); },
    'cfg-revert': function (t) {
      var cfg = current(); if (!cfg) return;
      var g = can(cfg, 'edit');
      if (!g.ok) { toast(g.why, 'info'); return; }
      var vn = +t.getAttribute('data-v');
      var v = cfg.versions.filter(function (x) { return x.version === vn; })[0];
      if (!v) return;
      var e = edit();
      e.body = C.clone(v.body); e.raw = null; e.rawErr = null; e.dirty = true;
      cfg.currentDraft = { body: C.clone(v.body), editedBy: C.DEMO_USER, editedAt: nowStamp(), revertOf: vn };
      if (cfg.state === 'REJECTED') cfg.state = 'DRAFT';
      S.cfg.history.open = false;
      renderFamily(S.cfg.family);
      toast('Revert draft created from v' + vn + ' — submit for approval to apply it', 'success');
    },
    'cfg-drawer': function (t) { S.cfg.drawer = t.getAttribute('data-id'); renderFamily(S.cfg.family); },
    'cfg-drawer-close': function () { S.cfg.drawer = null; renderFamily(S.cfg.family); },
    'cfg-open-ref': function (t) {
      var id = t.getAttribute('data-id');
      S.cfg.drawer = null; resetEdit();
      S.cfg.selected['network-file'] = id;
      go(famRoute('network-file', id));
    }
  };

  /* Refinement Part 8 — the guided flows submit through here, so a flow can
     never write a config by a path the editor does not use. A brand-new config
     is registered first, then submitted exactly like an edited one. */
  function submitBody(built) {
    var cfg = built.cfg;
    if (built.isNew) {
      C.configs.push(cfg);
      cfg.baseBody = null;
    } else {
      cfg.baseBody = C.clone(cfg.body);
    }
    cfg.body = C.clone(built.body);
    cfg.state = 'PENDING_APPROVAL';
    cfg.submittedBy = C.DEMO_USER;
    cfg.submittedAt = nowStamp();
    cfg.submittedHoursAgo = 0;
    cfg.currentDraft = null;
    cfg.rejectionReason = null;
    cfg.updatedAt = nowStamp();
    cfg.comments = cfg.comments || [];
    cfg.comments.push({ by: C.DEMO_USER, at: nowStamp(), text: built.summary, kind: 'submission' });
    return cfg;
  }

  /* ---- Public surface used by the queue module and app.js ---------------- */
  var api = {
    S: S, C: C, X: X, kit: kit,
    submitBody: submitBody,
    statePill: statePill, famBadge: famBadge, facetBadge: facetBadge, tenantChip: tenantChip,
    can: can, role: role, isSelf: isSelf, current: current, edit: edit, resetEdit: resetEdit,
    priorBody: priorBody, approve: approve, reject: reject, nowStamp: nowStamp,
    renderFamily: renderFamily, pendingCount: pendingCount, roleBar: roleBar,
    famRoute: famRoute, SEG: SEG, BY_SEG: BY_SEG, CHILD: CHILD, validationOf: validationOf,
    put: put, mount: mount,
    // filled in by configs-queue.js
    diffPanel: function () { return ''; }, openReject: function () { }
  };

  /* ---- Router ------------------------------------------------------------ */
  function route(rest) {
    var head = rest[0];
    if (head === 'approvals') {
      S.opsChild = null;
      kit.renderSidebar();
      return rest[1] ? api.viewApprovalDetail(rest[1]) : api.viewApprovals();
    }
    // Part 8.2 — a task card opens its own guided flow.
    if (head === 'task') {
      S.opsChild = null; S.cfg.task = null;
      kit.renderSidebar();
      return FLOWS ? FLOWS.route(rest) : renderLanding();
    }
    // Part 5.1 — the landing is the task cards, not a config list.
    if (!head) {
      S.opsChild = null; S.cfg.task = null;
      kit.renderSidebar();
      return renderLanding();
    }
    var fam = BY_SEG[head] || 'network-file';
    S.opsChild = CHILD[fam];
    // A task card carries its intent in the query string.
    if (S.query && S.query.task && TASK_BY_ID[S.query.task]) {
      S.cfg.task = S.query.task;
      S.cfg.tab[fam] = TASK_BY_ID[S.query.task].tab;
    }
    // A reject's "Open Platform Configs →" carries the transaction context
    // (Rejects Part 5), shown as a hint with a way back to the open panel.
    if (S.query && S.query.rejFrom) {
      S.cfg.rejFrom = { id: S.query.rejFrom, reason: S.query.rejReason || '', batch: S.query.rejBatch || '' };
    }
    /* A failure block's primary action carries the file it came from and the
       code it stopped on (file-detail brief Part 7), so the editor opens
       knowing what the operator came here to change rather than making them
       find it. */
    if (S.query && S.query.fileFrom) {
      S.cfg.fileFrom = {
        uuid: S.query.fileFrom, code: S.query.fileCode || '', back: S.query.fileBack || ''
      };
    }
    /* Part 7 — "arrives pre-filtered" means the list is actually filtered when
       it lands, not merely that the link carried a parameter. */
    if (S.query && (S.query.cfgTenant || S.query.cfgFacet)) {
      if (S.query.cfgTenant) S.cfg.filters[fam].tenant = S.query.cfgTenant;
      if (S.query.cfgFacet) S.cfg.filters[fam].facet = S.query.cfgFacet;
      // …and the editor opens on the first config the filter leaves, rather
      // than on whatever happened to be selected last.
      var firstHit = filtered(fam)[0];
      if (firstHit) S.cfg.selected[fam] = fam === 'settlement' ? firstHit.key : firstHit.configId;
    }
    // Where the fix lives on a specific tab, land on that tab.
    if (S.query && S.query.tab && S.cfg.tab[fam] !== undefined) S.cfg.tab[fam] = S.query.tab;
    kit.renderSidebar();
    return renderFamily(fam, rest[1]);
  }

  /* The guided-flow module, handed in by app.js after both are constructed.
     Kept as a reference rather than a global lookup so the dependency is
     visible at the wiring site. */
  var FLOWS = null;
  function setFlows(f) { FLOWS = f; f.setSubmit(submitBody); }

  return { route: route, actions: ACTIONS, api: api, setFlows: setFlows };
};
