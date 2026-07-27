/* =============================================================================
   Juspay Ops Portal — Platform Configs: the three family screens (Phase 3)
   Split-pane list + dual-mode editor, applied three times (Part 4).
   window.ConfigsUI(kit) → { route, actions, api }
   ============================================================================= */
window.ConfigsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CFGDATA, X = window.CFGCORE, F = window.CFGFMT;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, tenantTag = kit.tenantTag,
    slaBadge = kit.slaBadge, immutableEntry = kit.immutableEntry, immutablePair = kit.immutablePair;

  /* ---- In-memory screen state (no browser storage) ----------------------- */
  S.cfg = {
    role: 'Maker',
    family: 'network-file',
    selected: { 'network-file': 'cfg_nf_001', settlement: 'hsbc_in::MPR', 'incoming-parsing': 'cfg_ip_001' },
    tab: { 'network-file': 'layout', settlement: 'content', 'incoming-parsing': 'pipeline' },
    mode: 'form',
    rawFormat: 'json',
    listCollapsed: false,
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
    queue: { tab: 'pending', family: 'all', submitter: 'all', sla: 'all' }
  };

  var SEG = { 'network-file': 'network-files', settlement: 'settlement', 'incoming-parsing': 'incoming' };
  var BY_SEG = { 'network-files': 'network-file', settlement: 'settlement', incoming: 'incoming-parsing' };
  var CHILD = { 'network-file': 'ops-cfg-network', settlement: 'ops-cfg-settlement', 'incoming-parsing': 'ops-cfg-incoming' };
  function famRoute(fam, id) { return '#/dashboard/ops/configs/' + SEG[fam] + (id ? '/' + id : ''); }

  /* ---- State pills — same vocabulary as Fee Config Approvals (Part 8.2) -- */
  var STATE_PILL = {
    DRAFT: ['Draft', 'neutral', 'file-pen'],
    PENDING_APPROVAL: ['Pending Approval', 'info', 'clock'],
    APPROVED: ['Approved', 'success', 'badge-check'],
    ACTIVE: ['Active', 'success', 'check'],
    INACTIVE: ['Inactive', 'neutral', 'pause'],
    REJECTED: ['Rejected', 'danger', 'x-circle']
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
      var v = (op instanceof Array) ? op[0] : op, l = (op instanceof Array) ? op[1] : op;
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
      ? '<table class="data cfg-list-table"><thead><tr><th>' + (fam === 'settlement' ? 'Report' : 'Config') + '</th><th>State · last updated</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : emptyState('search-x', 'No configs match', 'Adjust the filters or search to see configs in this family.');

    return '<div class="cfg-pane cfg-list" id="cfgListPane">' +
      '<div class="cfg-pane-head">' +
      '<div class="row" style="gap:8px;align-items:center;justify-content:space-between">' +
      '<div class="cfg-count"><button class="icon-btn xs" data-action="cfg-toggle-list" title="Collapse list pane" aria-label="Collapse list pane">' + icon('chevrons-left', 14) + '</button>' +
      '<strong class="num">' + list.length + '</strong> of <span class="num">' +
      (fam === 'settlement' ? C.settlementItems().length : C.byFamily(fam).length) + '</span> ' +
      (fam === 'settlement' ? 'reports' : 'configs') + '</div>' +
      '<button class="btn btn-primary btn-sm" data-action="cfg-new">' + icon('plus', 14) + 'Create new</button>' +
      '</div>' +
      '<div class="chip search-chip cfg-search">' + icon('search', 15) +
      '<input class="input" placeholder="Search config name" value="' + esc(f.q) + '" data-action="cfgi-list-q" />' +
      '</div>' +
      '<div class="cfg-filters">' +
      '<select class="input" data-action="cfgc-list-tenant"><option value="all">All entities</option>' +
      C.TENANTS.map(function (t) { return '<option value="' + t.key + '"' + (f.tenant === t.key ? ' selected' : '') + '>' + t.key + '</option>'; }).join('') + '</select>' +
      '<select class="input" data-action="cfgc-list-facet"><option value="all">All ' + facetLabel.toLowerCase() + 's</option>' +
      facetOptions(fam).map(function (o) { return '<option value="' + o[0] + '"' + (f.facet === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select class="input" data-action="cfgc-list-state"><option value="all">All states</option>' +
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
      '<div class="mode-toggle" role="tablist" aria-label="Editor mode">' +
      '<button class="' + (S.cfg.mode === 'form' ? 'active' : '') + '" data-action="cfg-mode" data-mode="form" role="tab">' + icon('list', 14) + 'Form</button>' +
      '<button class="' + (S.cfg.mode === 'raw' ? 'active' : '') + '" data-action="cfg-mode" data-mode="raw" role="tab">' + icon('braces', 14) + 'Raw</button>' +
      '</div></div>';
  }

  /* ---- Raw mode ---------------------------------------------------------- */
  function rawBody() {
    var e = edit();
    if (e.raw == null) e.raw = X.serialize(e.body, S.cfg.rawFormat);
    var errBar = e.rawErr
      ? '<div class="raw-err">' + icon('alert-triangle', 15) + esc(e.rawErr) + '</div>'
      : '<div class="raw-ok">' + icon('check-circle', 15) + S.cfg.rawFormat.toUpperCase() + ' parses cleanly — the form tabs reflect these values.</div>';
    return '<div class="raw-wrap">' +
      '<div class="raw-head">' +
      '<div class="meta">Edits here update the same in-memory config object the form tabs bind to. Keys the form does not render are preserved.</div>' +
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
        fld('Record length', txt('record_length', b.record_length, { type: 'number', cast: 'int', refresh: 'bytemap', cls: 'num' })) +
        fld('Padding character', txt('padding_char', b.padding_char, { maxlength: 1, ph: 'space', cls: 'mono' }),
          'single character · currently ' + (b.padding_char === ' ' ? 'a space' : '"' + String(b.padding_char == null ? '' : b.padding_char) + '"')) +
        fld('Encoding', selIn('encoding', b.encoding, ['ASCII', 'EBCDIC'], { refresh: 'validation' })) +
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

  /* ---- Fixed width (Visa) ------------------------------------------------- */
  function nfRecordsFixed() {
    var e = edit(), b = e.body;
    return (b.record_types || []).map(function (rt, i) {
      var path = 'record_types.' + i;
      var packed = !!S.cfg.autoPack[e.configId + ':' + i];
      var rows = (rt.fields || []).map(function (f, j) {
        var fp = path + '.fields.' + j;
        return '<tr draggable="true" data-dnd="' + path + '.fields" data-idx="' + j + '">' +
          '<td class="grip">' + icon('grip-vertical', 14) + '</td>' +
          '<td class="num idx">' + (j + 1) + '</td>' +
          '<td>' + txt(fp + '.name', f.name, { refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.start', f.start, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.length', f.length, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td>' + selIn(fp + '.type', f.type, C.FIELD_TYPES, { cls: 'w-70', refresh: 'bytemap' }) + '</td>' +
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
        '<label class="cfg-toggle"><input type="checkbox"' + (packed ? ' checked' : '') + ' data-action="cfgc-autopack" data-rt="' + i + '" /><span>Auto-pack sequential positions</span></label>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete record type', 'data-path="record_types" data-idx="' + i + '"') +
        '</div></div>' +
        '<div class="table-wrap"><table class="data cfg-field-table" data-dnd-table="' + path + '.fields"><thead><tr>' +
        '<th></th><th class="num">#</th><th>Field name</th><th class="num">Start</th><th class="num">Length</th><th>Type</th>' +
        '<th>' + srcHeader() + '</th><th>Note</th><th></th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="meta" style="padding:18px">No fields yet — add the first one.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16">' + addBtn('Add field', 'cfg-arr-add', 'data-path="' + path + '.fields" data-tpl="field"') + '</div>' +
        '<div class="bm-wrap" id="bmw-' + i + '">' + X.byteMapHtml(b.record_length, rt.fields, { title: 'Byte map · record type ' + esc(rt.record_type || '?') }) + '</div>' +
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
    return nfHeader() +
      '<div class="cfg-section-title mt-24">' + title + '</div>' + records +
      '<div class="mt-16">' + addBtn(addLabel, 'cfg-arr-add', 'data-path="record_types" data-tpl="' + tpl + '"') + '</div>' +
      (fmt === 'csv'
        ? '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Mastercard is CSV, not TCR — there is no record length, no byte positions and no byte map. Composite elements (DE43 → name / suburb / postcode, DE48 → its PDS elements) collapse into an accordion; expand a parent to edit its sub-fields.</div></div>'
        : fmt === 'xml'
          ? '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">RuPay is XML — records are elements and every field carries a tag, so there is no record length, no start / length and no byte map. Record order here is element order in the output.</div></div>'
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

  function nfFieldMappings() {
    var e = edit(), b = e.body, tf = b.transform || (b.transform = {});
    var fmMap = tf.field_mappings || (tf.field_mappings = {});
    var mapped = Object.keys(fmMap);
    // Composite children nest under their parent, mirroring the Layout accordion.
    var allFields = [];
    (b.record_types || []).forEach(function (rt) { (rt.fields || []).forEach(function (f) { allFields.push(f); }); });
    var childOf = F.childIndex(b, allFields);
    var parents = {}, rows = '';
    mapped.forEach(function (n) { if (!childOf[n]) parents[n] = []; });
    mapped.forEach(function (n) { var p = childOf[n]; if (p && parents[p]) parents[p].push(n); else if (p && !parents[p]) parents[n] = parents[n] || []; });
    Object.keys(parents).forEach(function (n) {
      rows += fmRow(b, n, null, 0);
      parents[n].forEach(function (c) { rows += fmRow(b, c, null, 1); });
    });

    var unmappedOpts = C.fieldNames(b).filter(function (n) { return mapped.indexOf(n) < 0; });
    return '<div class="cfg-section-title">Field mapping <span class="meta">— one entry per output field, from <code>field_mappings</code></span></div>' +
      '<div class="cfg-block">' +
      '<div class="table-wrap"><table class="data cfg-sub-table fm-table"><thead><tr>' +
      '<th>Output field</th><th>Source</th><th>Transform</th><th>Params</th><th>' + srcHeader() + '</th><th></th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="meta" style="padding:14px">No field mappings yet.</td></tr>') + '</tbody></table></div>' +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<select class="input w-260" id="fmsel">' +
      (unmappedOpts.length ? unmappedOpts.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('')
        : '<option value="">— every layout field is already mapped —</option>') + '</select>' +
      addBtn('Add field mapping', 'cfg-map-add', 'data-path="transform.field_mappings" data-sel="fmsel" data-tpl="fieldmap"') +
      '</div></div>';
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
  function schedBlock(block, prefix, isRule) {
    var td = block.transaction_date || {};
    return '<div class="cfg-grid-2">' +
      '<div class="sched-field"><span class="sf-label">Transaction date — from</span>' +
      '<div class="sf-row">' + offsetPicker(prefix + '.transaction_date.from.offset', (td.from || {}).offset) +
      txt(prefix + '.transaction_date.from.time', (td.from || {}).time, { cls: 'mono w-120', ph: 'HH:MM:SS', refresh: 'preview' }) + '</div></div>' +
      '<div class="sched-field"><span class="sf-label">Transaction date — to</span>' +
      '<div class="sf-row">' + offsetPicker(prefix + '.transaction_date.to.offset', (td.to || {}).offset) +
      txt(prefix + '.transaction_date.to.time', (td.to || {}).time, { cls: 'mono w-120', ph: 'HH:MM:SS', refresh: 'preview' }) + '</div></div>' +
      '<div class="sched-field"><span class="sf-label">Report offset</span><div class="sf-row">' + offsetPicker(prefix + '.report_offset', block.report_offset) + '</div></div>' +
      '<div class="sched-field"><span class="sf-label">Calendar</span><div class="sf-row wrap">' +
      toggle(prefix + '.sundays_off', block.sundays_off, 'Sundays off', { refresh: 'preview' }) +
      toggle(prefix + '.saturdays_off', block.saturdays_off, 'Saturdays off', { refresh: 'preview' }) +
      toggle(prefix + '.apply_general_holiday', block.apply_general_holiday, 'Apply general holiday', { refresh: 'preview' }) +
      '</div></div></div>';
  }

  function schedulePreviewHtml() {
    var e = edit(), b = e.body, blk = (b && b['default']) || {}, tz = b ? b.timezone : null;
    var sample = S.cfg.sampleDate;
    var r = X.resolveRun(blk, tz, sample);
    var runs = X.nextRuns(blk, tz, sample, 5);
    // Offsets can be mid-edit and unparseable — never let the preview throw.
    function d(v) { return v ? U.prettyDate(v) : '<span class="bad-text">invalid offset</span>'; }
    var rows = runs.map(function (x) {
      return '<tr class="' + (x.fires ? '' : 'skipped') + '">' +
        '<td class="nowrap">' + U.prettyDate(x.runDate) + '<div class="cell-sub">' + x.dow + '</div></td>' +
        '<td class="nowrap mono">' + (x.fires ? d(x.fromDate) + ' ' + esc(x.fromTime) : '—') + '</td>' +
        '<td class="nowrap mono">' + (x.fires ? d(x.toDate) + ' ' + esc(x.toTime) : '—') + '</td>' +
        '<td class="nowrap">' + (x.fires ? d(x.reportDate) : '—') + '</td>' +
        '<td>' + (x.fires ? pill('will run', 'success', 'check') : '<span class="tip" data-tip="' + esc(x.skipReason) + '">' + pill('skipped', 'neutral', 'pause') + '</span>') + '</td>' +
        '<td class="cell-sub">' + esc(x.skipReason || '') + '</td></tr>';
    }).join('');

    return '<div class="sched-preview" id="cfgSchedPreview">' +
      '<div class="sp-head">' + icon('calendar-search', 16) + '<strong>Schedule preview</strong>' +
      '<span class="meta">Recalculates on every field change · timezone ' + esc(tz || '—') + '</span>' +
      '<label class="field inline" style="margin-left:auto">Sample run date <input class="input w-160" type="date" value="' + esc(sample) + '" data-action="cfgc-sample" /></label>' +
      '</div>' +
      '<div class="sp-resolved">' +
      '<div class="sp-cell"><span class="spc-label">Run date</span><span class="spc-val">' + U.prettyDate(sample) + '</span><span class="spc-sub">' + r.dow + '</span></div>' +
      '<div class="sp-cell"><span class="spc-label">Resolved from</span><span class="spc-val mono">' + (r.fromDate ? U.prettyDate(r.fromDate) : 'invalid') + '</span><span class="spc-sub mono">' + esc(r.fromTime) + '</span></div>' +
      '<div class="sp-cell"><span class="spc-label">Resolved to</span><span class="spc-val mono">' + (r.toDate ? U.prettyDate(r.toDate) : 'invalid') + '</span><span class="spc-sub mono">' + esc(r.toTime) + '</span></div>' +
      '<div class="sp-cell"><span class="spc-label">Report date</span><span class="spc-val">' + (r.reportDate ? U.prettyDate(r.reportDate) : 'invalid') + '</span><span class="spc-sub">' + esc(b.report || '') + '</span></div>' +
      '<div class="sp-cell"><span class="spc-label">Fires on this date?</span><span class="spc-val">' + (r.fires ? pill('Yes', 'success', 'check') : pill('No', 'warning', 'pause')) + '</span><span class="spc-sub">' + esc(r.skipReason || 'no calendar exclusion') + '</span></div>' +
      '</div>' +
      '<div class="table-wrap mt-16"><table class="data"><thead><tr><th>Run date</th><th>Window from</th><th>Window to</th><th>Report date</th><th>Outcome</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="meta hint-row mt-16">' + icon('info', 13) + '<span>The next five calendar days from the sample date, resolved through the default block. Holidays come from the platform holiday calendar for ' + esc(C.TZ_COUNTRY[tz] || '—') + '.</span></div>' +
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
        '<div class="cfg-block-head"><div class="row" style="gap:10px;align-items:center">' + icon('git-branch', 15) + '<strong>Override rule ' + (i + 1) + '</strong></div>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete rule', 'data-path="rules" data-idx="' + i + '"') + '</div>' +
        '<div class="cfg-grid-2 mb-16">' +
        fld('Match field', txt(p + '.match.field', (r.match || {}).field, { ph: 'e.g. merchant_category', list: 'dl-txn-cols' })) +
        fld('Match value', txt(p + '.match.value', (r.match || {}).value, { ph: 'e.g. AIRLINE' })) +
        '</div>' + schedBlock(r, p, true) + '</div>';
    }).join('');

    return variantBar(stItem()) +
      '<div class="cfg-grid-3">' +
      fld('report_configs key', selIn('report', b.report, C.REPORTS, { refresh: 'preview' }),
        'the key this schedule is stored under in settlement_generator.json') +
      fld('Timezone', selIn('timezone', b.timezone, C.TIMEZONES, { refresh: 'preview' })) +
      '</div>' +
      '<div class="cfg-section-title mt-24">Default block</div>' +
      '<div class="cfg-block">' + schedBlock(b['default'] || {}, 'default') + '</div>' +
      '<div class="cfg-section-title mt-24">Rules <span class="meta">— overrides evaluated in order before the default block</span></div>' +
      (rules || '<div class="meta mb-16">No override rules. The default block applies to every run.</div>') +
      '<div class="mt-16">' + addBtn('Add override rule', 'cfg-arr-add', 'data-path="rules" data-tpl="schedrule"') + '</div>' +
      '<div class="mt-24">' + schedulePreviewHtml() + '</div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  function stContent() {
    var e = edit(), b = e.body;
    var fetch = (b.json_fetch || []).map(function (g, i) {
      var p = 'json_fetch.' + i;
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head"><label class="field inline">Source ' + selIn(p + '.source', g.source, C.SOURCE_COLUMNS, { cls: 'w-220' }) + '</label>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove fetch group', 'data-path="json_fetch" data-idx="' + i + '"') + '</div>' +
        '<div class="field"><span style="font-size:13px;color:var(--text-secondary);font-weight:500">Keys</span>' + tagList(p + '.keys', g.keys, 'Add key…') + '</div>' +
        '</div>';
    }).join('');

    var cols = (b['select'] || []).map(function (c, i) {
      var known = C.TXN_COLUMNS.indexOf(c.column) >= 0;
      return '<tr draggable="true" data-dnd="select" data-idx="' + i + '">' +
        '<td class="grip">' + icon('grip-vertical', 14) + '</td>' +
        '<td class="num idx">' + (i + 1) + '</td>' +
        '<td>' + txt('select.' + i + '.column', c.column, { list: 'dl-txn-cols', cls: known ? '' : 'bad' }) +
        (known ? '' : '<div class="inline-warn">' + icon('alert-triangle', 12) + 'Unknown transaction column</div>') + '</td>' +
        '<td>' + txt('select.' + i + '.alias', c.alias, { ph: '— same as column —' }) + '</td>' +
        '<td class="row-actions">' +
        iconBtn('cfg-arr-move', 'chevron-up', 'Move up', 'data-path="select" data-idx="' + i + '" data-dir="-1"') +
        iconBtn('cfg-arr-move', 'chevron-down', 'Move down', 'data-path="select" data-idx="' + i + '" data-dir="1"') +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove column', 'data-path="select" data-idx="' + i + '"') +
        '</td></tr>';
    }).join('');

    return '<div class="cfg-section-title">Eligibility flags</div>' +
      tagList('eligibility_flags', b.eligibility_flags, 'Add flag, e.g. in_mpr') +
      '<div class="cfg-section-title mt-24">JSON fetch</div>' +
      (fetch || '<div class="meta mb-16">No JSON fetch groups.</div>') +
      '<div class="mt-16">' + addBtn('Add fetch group', 'cfg-arr-add', 'data-path="json_fetch" data-tpl="fetch"') + '</div>' +
      '<div class="cfg-section-title mt-24">Select — output columns <span class="meta">— row order defines the column order in the report</span></div>' +
      '<div class="table-wrap"><table class="data cfg-field-table" data-dnd-table="select"><thead><tr><th></th><th class="num">#</th><th>Column</th><th>Alias</th><th></th></tr></thead><tbody>' +
      (cols || '<tr><td colspan="5" class="meta" style="padding:18px">No output columns defined.</td></tr>') + '</tbody></table></div>' +
      '<div class="mt-16">' + addBtn('Add column', 'cfg-arr-add', 'data-path="select" data-tpl="selcol"') + '</div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  function stFees() {
    var e = edit(), b = e.body, rules = b.txn_rules || [];
    var expanded = S.cfg.expandedRule;
    var rows = rules.map(function (r, i) {
      var calc = r.calculations || {}, logic = calc.logic || [];
      var open = expanded === i;
      var head = '<tr class="clickable' + (open ? ' open' : '') + '" data-action="cfg-fee-expand" data-idx="' + i + '">' +
        '<td>' + icon(open ? 'chevron-down' : 'chevron-right', 14) + '</td>' +
        '<td class="cell-main">' + esc(r.model || '—') + '</td>' +
        '<td>' + esc(r.fee_mode || '—') + '</td>' +
        '<td class="num">' + (r.priority == null ? '—' : r.priority) + '</td>' +
        '<td class="nowrap">' + esc(r.starting_date || '—') + '</td>' +
        '<td class="num">' + (r.conditions || []).length + '</td>' +
        '<td class="num">' + logic.length + (calc.slab_based ? ' <span class="meta">slabs</span>' : ' <span class="meta">flat</span>') + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Delete rule', 'data-path="txn_rules" data-idx="' + i + '"') + '</td></tr>';
      if (!open) return head;

      var p = 'txn_rules.' + i;
      var conds = (r.conditions || []).map(function (c, ci) {
        return '<tr><td>' + txt(p + '.conditions.' + ci + '.field', c.field, { list: 'dl-txn-cols' }) + '</td>' +
          '<td>' + selIn(p + '.conditions.' + ci + '.condition', c.condition, C.CONDITIONS, { cls: 'w-100' }) + '</td>' +
          '<td>' + txt(p + '.conditions.' + ci + '.value', c.value) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove condition', 'data-path="' + p + '.conditions" data-idx="' + ci + '"') + '</td></tr>';
      }).join('');
      var calcs = logic.map(function (l, li) {
        return '<tr><td class="num">' + txt(p + '.calculations.logic.' + li + '.min', l.min, { type: 'number', cast: 'number', cls: 'num w-100' }) + '</td>' +
          '<td class="num">' + txt(p + '.calculations.logic.' + li + '.max', l.max, { type: 'number', cast: 'nullable-number', cls: 'num w-100', ph: '∞' }) + '</td>' +
          '<td>' + txt(p + '.calculations.logic.' + li + '.field', l.field, { list: 'dl-txn-cols' }) + '</td>' +
          '<td class="num">' + txt(p + '.calculations.logic.' + li + '.percentage', l.percentage, { type: 'number', cast: 'number', cls: 'num w-100' }) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove slab', 'data-path="' + p + '.calculations.logic" data-idx="' + li + '"') + '</td></tr>';
      }).join('');

      return head + '<tr class="fee-expand"><td colspan="8"><div class="fee-detail">' +
        '<div class="cfg-grid-4">' +
        fld('Model', txt(p + '.model', r.model)) +
        fld('Fee mode', selIn(p + '.fee_mode', r.fee_mode, ['DEDUCT_FROM_SETTLEMENT', 'PASS_THROUGH', 'COLLECT_FROM_CARDHOLDER', 'INVOICE'])) +
        fld('Priority', txt(p + '.priority', r.priority, { type: 'number', cast: 'int', cls: 'num' })) +
        fld('Starting date', txt(p + '.starting_date', r.starting_date, { type: 'date' })) +
        '</div>' +
        '<div class="cfg-section-title sm">Conditions</div>' +
        '<table class="data cfg-sub-table"><thead><tr><th>Field</th><th>Condition</th><th>Value</th><th></th></tr></thead><tbody>' +
        (conds || '<tr><td colspan="4" class="meta" style="padding:12px">No conditions — this rule matches every transaction.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16">' + addBtn('Add condition', 'cfg-arr-add', 'data-path="' + p + '.conditions" data-tpl="cond"') + '</div>' +
        '<div class="cfg-section-title sm mt-24">Calculations</div>' +
        '<div class="row" style="gap:16px;align-items:center;margin-bottom:12px">' +
        toggle(p + '.calculations.slab_based', calc.slab_based, 'Slab-based', { refresh: 'body' }) +
        '<label class="field inline">Fee type ' + selIn(p + '.calculations.fee_type', calc.fee_type, ['PERCENTAGE', 'FLAT', 'PERCENTAGE_PLUS_FLAT'], { cls: 'w-220' }) + '</label>' +
        '</div>' +
        '<table class="data cfg-sub-table"><thead><tr><th class="num">Min</th><th class="num">Max</th><th>Field</th><th class="num">Percentage</th><th></th></tr></thead><tbody>' +
        (calcs || '<tr><td colspan="5" class="meta" style="padding:12px">No calculation rows.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16">' + addBtn('Add slab', 'cfg-arr-add', 'data-path="' + p + '.calculations.logic" data-tpl="calc"') + '</div>' +
        '</div></td></tr>';
    }).join('');

    var item = stItem();
    return feeBar(item) +
      (item ? '<div class="callout info mb-16">' + icon('info', 18) + '<div class="callout-body">Fee rules are configured per <strong>entity</strong> in <code>fee_configs/fees.json</code>, not per report — this same set applies to every ' + esc((C.tenantByKey[item.tenantId] || {}).name || item.tenantId) + ' report. Editing here changes it for all of them.</div></div>' : '') +
      '<div class="cfg-section-title">Transaction fee rules</div>' +
      '<div class="table-wrap"><table class="data fee-table"><thead><tr><th></th><th>Model</th><th>Fee mode</th><th class="num">Priority</th><th>Starting date</th><th class="num"># conditions</th><th class="num"># calculations</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="meta" style="padding:18px">No fee rules defined.</td></tr>') + '</tbody></table></div>' +
      '<div class="mt-16">' + addBtn('Add fee rule', 'cfg-arr-add', 'data-path="txn_rules" data-tpl="feerule"') + '</div>' +
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Priorities must be unique per config, slab ranges must not overlap, and percentages must fall within 0–100. Violations appear in the Validation panel below and block submission.</div></div>' +
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

  function ipPipeline() {
    var e = edit(), b = e.body;
    var ref = b.layout_ref ? C.byId[b.layout_ref] : null;
    var refNames = ref ? C.fieldNames(ref.body) : [];
    var refFmt = ref ? F.formatOf(ref.body) : (b.source_format || 'fixed_width');
    var refCaps = F.caps(refFmt);
    var secField = (b.sectioning || {}).field;
    var secBad = ref && secField && refNames.indexOf(secField) < 0;
    var mismatch = ref && b.source_format && b.source_format !== refFmt;

    var secRules = ((b.sectioning || {}).rules || []).map(function (r, i) {
      return '<tr><td>' + txt('sectioning.rules.' + i + '.match', r.match, { cls: 'mono w-120' }) + '</td>' +
        '<td>' + txt('sectioning.rules.' + i + '.bucket', r.bucket, { cls: 'mono' }) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove rule', 'data-path="sectioning.rules" data-idx="' + i + '"') + '</td></tr>';
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

    return '<div class="cfg-grid-4">' +
      fld('Gateway', txt('gateway', b.gateway)) +
      fld('Network', txt('network', b.network)) +
      fld('Direction', selIn('direction', b.direction, ['INCOMING', 'OUTGOING'])) +
      fld('Pipeline kind', selIn('pipeline_kind', b.pipeline_kind, ['clearing', 'acknowledgment', 'chargeback', 'settlement', 'aggregator'])) +
      '</div>' +

      '<div class="cfg-section-title mt-24">Ack filenames</div>' +
      tagList('ack_filenames', b.ack_filenames, 'Add filename pattern, e.g. VISA_ACK_%Y%m%d.txt') +
      '<div class="meta hint-row mt-16">' + icon('info', 13) + '<span>Patterns accept the date tokens %Y, %m, %d, %H and %M. A pattern without a date token only ever matches one literal filename.</span></div>' +

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
        ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'source_format is "' + esc(b.source_format) + '" but ' + esc(ref.name) + ' is "' + esc(refFmt) + '". Positions, record length and the byte map only apply to fixed_width sources.</div>'
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

      '<div class="cfg-section-title mt-24">Sectioning</div>' +
      '<div class="cfg-block">' +
      '<label class="field" style="max-width:420px">Sectioning field ' +
      (ref
        ? selIn('sectioning.field', secField, (secBad ? [[secField, secField + '  (not in layout)']] : []).concat(refNames.map(function (n) { return [n, n]; })), { refresh: 'body' })
        : txt('sectioning.field', secField)) +
      '</label>' +
      (secBad ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'This field does not exist in ' + esc(ref.name) + ' — the pipeline would fail to section incoming records.</div>' : '') +
      '<table class="data cfg-sub-table mt-16"><thead><tr><th>Match</th><th>Bucket</th><th></th></tr></thead><tbody>' +
      (secRules || '<tr><td colspan="3" class="meta" style="padding:12px">No sectioning rules.</td></tr>') + '</tbody></table>' +
      '<div class="mt-16">' + addBtn('Add sectioning rule', 'cfg-arr-add', 'data-path="sectioning.rules" data-tpl="secrule"') + '</div>' +
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
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">The long tail of aggregation options lives in <strong>Raw</strong> mode; the fields above are the ones ops changes routinely.</div></div>';
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
              '<td>' + txt(fp + '.type', f.type, { cls: 'w-90' }) + '</td>' +
              '<td>' + txt(fp + '.note', f.note, { ph: '—' }) + '</td>' +
              '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove field', 'data-path="record_types.' + k + '.fields" data-idx="' + i + '"') + '</td></tr>';
          }).join('');
          fieldsBlock = '<div class="cfg-section-title sm mt-24">Field windows <span class="meta">— byte positions inside this record</span></div>' +
            '<div class="table-wrap"><table class="data cfg-sub-table"><thead><tr><th class="num">#</th><th>Field</th><th class="num">Start</th><th class="num">Length</th><th>Type</th><th>Note</th><th></th></tr></thead><tbody>' +
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

    return head +
      '<div class="cfg-section-title mt-24">Record types</div>' +
      (groups || '<div class="meta mb-16">No record types defined.</div>') +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<input class="input w-220" id="newRtName" placeholder="New record type, e.g. detail" />' +
      addBtn('Add record type', 'cfg-map-add', 'data-path="record_types" data-sel="newRtName" data-tpl="parserrt"') +
      '</div>';
  }

  function ipPreprocessor() {
    var e = edit(), b = e.body;
    var steps = (b.steps || []).map(function (s, i) {
      return '<div class="step-row"><span class="num idx">' + (i + 1) + '</span><span class="mono step-op">' + esc(s.op || '?') + '</span>' +
        '<span class="meta">' + esc(Object.keys(s).filter(function (k) { return k !== 'op'; }).map(function (k) { return k + '=' + s[k]; }).join(' · ')) + '</span>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove step', 'data-path="steps" data-idx="' + i + '"') + '</div>';
    }).join('');
    return '<div class="cfg-grid-4">' +
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
  function editorPane() {
    var cfg = current();
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
        emptyState('file-plus', 'No config selected', 'Pick a config from the list on the left, or create a new draft.',
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
    setView(
      '<div class="page-head cfg-head">' +
      '<div><h1 class="page-title">' + esc(f.label) + '</h1><div class="subtitle">' + esc(f.blurb) + '</div></div>' +
      roleBar() + '</div>' +
      '<div class="cfg-split' + (S.cfg.listCollapsed ? ' collapsed' : '') + '" id="cfgSplit">' +
      (S.cfg.listCollapsed
        ? '<div class="cfg-rail"><button class="icon-btn" data-action="cfg-toggle-list" title="Expand list" aria-label="Expand config list">' + icon('chevrons-right', 16) + '</button><span class="rail-label">' + esc(f.short) + ' configs</span></div>'
        : listPane(fam)) +
      editorPane() +
      '</div>' +
      '<button class="cfg-collapse-btn" data-action="cfg-toggle-list" title="' + (S.cfg.listCollapsed ? 'Expand' : 'Collapse') + ' list pane">' +
      icon(S.cfg.listCollapsed ? 'chevrons-right' : 'chevrons-left', 15) + (S.cfg.listCollapsed ? 'Show list' : 'Collapse list') + '</button>' +
      (S.cfg.history.open ? historyPanel() : '') +
      (S.cfg.drawer ? drawerPanel() : '')
    );
    mount();
  }

  /* ---- Post-render wiring (raw editor scroll sync + row drag) ------------ */
  function mount() {
    var ta = el('cfgRawTa'), hl = el('cfgRawHl');
    if (ta && hl && !ta.dataset.bound) {
      ta.dataset.bound = '1';
      ta.addEventListener('scroll', function () { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
    }
    var view = el('view');
    if (view && !view.dataset.dndBound) {
      view.dataset.dndBound = '1';
      var dragIdx = null, dragPath = null;
      view.addEventListener('dragstart', function (ev) {
        var tr = ev.target.closest && ev.target.closest('tr[data-dnd]');
        if (!tr) return;
        dragIdx = +tr.getAttribute('data-idx');
        dragPath = tr.closest('table').getAttribute('data-dnd-table');
        tr.classList.add('dragging');
        if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(dragIdx)); }
      });
      view.addEventListener('dragover', function (ev) {
        var tr = ev.target.closest && ev.target.closest('tr[data-dnd]');
        if (tr && dragPath != null) { ev.preventDefault(); tr.classList.add('drop-target'); }
      });
      view.addEventListener('dragleave', function (ev) {
        var tr = ev.target.closest && ev.target.closest('tr[data-dnd]');
        if (tr) tr.classList.remove('drop-target');
      });
      view.addEventListener('drop', function (ev) {
        var tr = ev.target.closest && ev.target.closest('tr[data-dnd]');
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
      put('bmw-' + i, X.byteMapHtml(e.body.record_length, rt.fields, { title: 'Byte map · record type ' + esc(rt.record_type || '?') }));
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
      var n = el('cfgListPane');
      if (n) { n.outerHTML = listPane(S.cfg.family); if (window.lucide) lucide.createIcons(); }
      var i = el('view').querySelector('[data-action=cfgi-list-q]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'cfgc-list-tenant': function (t) { S.cfg.filters[S.cfg.family].tenant = t.value; renderFamily(S.cfg.family); },
    'cfgc-list-facet': function (t) { S.cfg.filters[S.cfg.family].facet = t.value; renderFamily(S.cfg.family); },
    'cfgc-list-state': function (t) { S.cfg.filters[S.cfg.family].state = t.value; renderFamily(S.cfg.family); },
    'cfg-toggle-list': function () { S.cfg.listCollapsed = !S.cfg.listCollapsed; renderFamily(S.cfg.family); },
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

  /* ---- Public surface used by the queue module and app.js ---------------- */
  var api = {
    S: S, C: C, X: X, kit: kit,
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
    var fam = BY_SEG[head] || 'network-file';
    S.opsChild = CHILD[fam];
    kit.renderSidebar();
    return renderFamily(fam, rest[1]);
  }

  return { route: route, actions: ACTIONS, api: api };
};
