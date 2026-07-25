/* =============================================================================
   Juspay Ops Portal — Platform Configs: the three family screens (Phase 3)
   Split-pane list + dual-mode editor, applied three times (Part 4).
   window.ConfigsUI(kit) → { route, actions, api }
   ============================================================================= */
window.ConfigsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CFGDATA, X = window.CFGCORE;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox, emptyState = kit.emptyState,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go, tenantTag = kit.tenantTag,
    slaBadge = kit.slaBadge, immutableEntry = kit.immutableEntry, immutablePair = kit.immutablePair;

  /* ---- In-memory screen state (no browser storage) ----------------------- */
  S.cfg = {
    role: 'Maker',
    family: 'network-file',
    selected: { 'network-file': 'cfg_nf_001', settlement: 'cfg_st_001', 'incoming-parsing': 'cfg_ip_001' },
    tab: { 'network-file': 'layout', settlement: 'schedule', 'incoming-parsing': 'pipeline' },
    mode: 'form',
    rawFormat: 'json',
    listCollapsed: false,
    filters: {
      'network-file': { q: '', tenant: 'all', facet: 'all', state: 'all' },
      settlement: { q: '', tenant: 'all', facet: 'all', state: 'all' },
      'incoming-parsing': { q: '', tenant: 'all', facet: 'all', state: 'all' }
    },
    edit: null,
    autoPack: {},
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
    if (cfg.family === 'settlement') return '<span class="sub-badge">' + esc(cfg.report) + '</span>';
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

  /* ---- Current config + edit session ------------------------------------ */
  function current() {
    var fam = S.cfg.family;
    var id = S.cfg.selected[fam];
    return C.byId[id] || null;
  }
  function edit() {
    var cfg = current(); if (!cfg) return null;
    var e = S.cfg.edit;
    if (!e || e.configId !== cfg.configId) {
      e = S.cfg.edit = {
        configId: cfg.configId,
        body: C.clone(cfg.currentDraft ? cfg.currentDraft.body : cfg.body),
        name: cfg.name,
        raw: null, rawErr: null, dirty: false
      };
    }
    return e;
  }
  function resetEdit() { S.cfg.edit = null; }
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
    if (fam === 'settlement') return C.REPORTS.map(function (r) { return [r, r]; }).concat([['FEES', 'FEES']]);
    return C.SOURCES.map(function (s) { return [s, s]; });
  }
  function facetOf(cfg) {
    return cfg.family === 'network-file' ? cfg.network : (cfg.family === 'settlement' ? cfg.report : cfg.source);
  }
  function filtered(fam) {
    var f = S.cfg.filters[fam], q = (f.q || '').toLowerCase();
    return C.byFamily(fam).filter(function (c) {
      if (f.tenant !== 'all' && c.tenantId !== f.tenant) return false;
      if (f.facet !== 'all' && facetOf(c) !== f.facet) return false;
      if (f.state !== 'all' && c.state !== f.state) return false;
      if (q && c.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function listPane(fam) {
    var f = S.cfg.filters[fam], list = filtered(fam), selId = S.cfg.selected[fam];
    var facetLabel = fam === 'network-file' ? 'Network' : (fam === 'settlement' ? 'Report' : 'Source');
    function who(e) { return e ? String(e).split('@')[0] : '—'; }
    var rows = list.map(function (c) {
      return '<tr class="clickable' + (c.configId === selId ? ' sel' : '') + '" data-action="cfg-select" data-id="' + c.configId + '">' +
        '<td><div class="cell-main">' + esc(c.name) + '</div>' +
        '<div class="cell-sub">' + facetBadge(c) + ' ' + tenantChip(c.tenantId) + '</div>' +
        '<div class="cell-sub row-people">' + icon('user', 11) + esc(who(c.createdBy)) +
        (c.approvedBy ? icon('check', 11) + esc(who(c.approvedBy)) : '') + '</div></td>' +
        '<td>' + statePill(c) + '<div class="cell-sub mt-4">' + esc(c.updatedAt || '') + '</div></td></tr>';
    }).join('');

    var table = list.length
      ? '<table class="data cfg-list-table"><thead><tr><th>Config</th><th>State · last updated</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : emptyState('search-x', 'No configs match', 'Adjust the filters or search to see configs in this family.');

    return '<div class="cfg-pane cfg-list" id="cfgListPane">' +
      '<div class="cfg-pane-head">' +
      '<div class="row" style="gap:8px;align-items:center;justify-content:space-between">' +
      '<div class="cfg-count"><button class="icon-btn xs" data-action="cfg-toggle-list" title="Collapse list pane" aria-label="Collapse list pane">' + icon('chevrons-left', 14) + '</button>' +
      '<strong class="num">' + list.length + '</strong> of <span class="num">' + C.byFamily(fam).length + '</span> configs</div>' +
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
    // Settlement and incoming configs are stored one-aspect-per-config, so the tab
    // that matches the selected config's kind is the live one; the others stay
    // visible (and disabled) so the full editor structure is always legible.
    if (cfg.family === 'settlement') {
      return [
        ['schedule', 'Schedule / Generation', 'calendar-clock', cfg.subType !== 'schedule'],
        ['content', 'Report content', 'table-2', cfg.subType !== 'content'],
        ['fees', 'Fees', 'percent', cfg.subType !== 'fees']
      ];
    }
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

    return '<div class="cfg-editor-head">' +
      '<div class="ceh-row">' +
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

  function modeBar(cfg) {
    var tabs = tabsFor(cfg), act = activeTab(cfg);
    var tabHtml = tabs.map(function (t) {
      var dis = !!t[3];
      var b = '<button class="tab' + (act === t[0] && !dis ? ' active' : '') + '"' + (dis ? ' disabled' : '') +
        ' data-action="cfg-tab" data-tab="' + t[0] + '">' + icon(t[2], 15) + esc(t[1]) + '</button>';
      return dis ? '<span class="tip" data-tip="This tab applies to ' + esc(t[1].toLowerCase()) + ' configs. The selected config is a ' + esc(cfg.subType) + ' config.">' + b + '</span>' : b;
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
     TAB BODIES — Family 1 · Network File
     ======================================================================= */
  function nfLayout() {
    var e = edit(), b = e.body;
    var head = '<div class="cfg-grid-4">' +
      fld('Record length', txt('record_length', b.record_length, { type: 'number', cast: 'int', refresh: 'bytemap', cls: 'num' })) +
      fld('Format', selIn('format', b.format, [['fixed_width', 'fixed_width'], ['delimited', 'delimited']], { refresh: 'validation' })) +
      fld('Padding character', txt('padding_char', b.padding_char, { maxlength: 1, ph: 'space', cls: 'mono' }),
        'single character · currently ' + (b.padding_char === ' ' ? 'a space' : '"' + String(b.padding_char == null ? '' : b.padding_char) + '"')) +
      fld('Encoding', selIn('encoding', b.encoding, ['ASCII', 'EBCDIC'], { refresh: 'validation' })) +
      '</div>';

    var names = C.fieldNames(b);
    var rts = (b.record_types || []).map(function (rt, i) {
      var path = 'record_types.' + i;
      var packed = !!S.cfg.autoPack[e.configId + ':' + i];
      var rows = (rt.fields || []).map(function (f, j) {
        var fp = path + '.fields.' + j;
        return '<tr draggable="true" data-dnd="' + fp.replace(/\.fields\.\d+$/, '.fields') + '" data-idx="' + j + '">' +
          '<td class="grip">' + icon('grip-vertical', 14) + '</td>' +
          '<td class="num idx">' + (j + 1) + '</td>' +
          '<td>' + txt(fp + '.name', f.name, { refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.start', f.start, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td class="num">' + txt(fp + '.length', f.length, { type: 'number', cast: 'int', cls: 'num w-70', refresh: 'bytemap' }) + '</td>' +
          '<td>' + selIn(fp + '.type', f.type, C.FIELD_TYPES, { cls: 'w-70', refresh: 'bytemap' }) + '</td>' +
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
        '</div>' +
        '<div class="row" style="gap:8px;align-items:center">' +
        '<label class="cfg-toggle"><input type="checkbox"' + (packed ? ' checked' : '') + ' data-action="cfgc-autopack" data-rt="' + i + '" /><span>Auto-pack sequential positions</span></label>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Delete record type', 'data-path="record_types" data-idx="' + i + '"') +
        '</div></div>' +
        '<div class="table-wrap"><table class="data cfg-field-table" data-dnd-table="' + path + '.fields"><thead><tr>' +
        '<th></th><th class="num">#</th><th>Field name</th><th class="num">Start</th><th class="num">Length</th><th>Type</th><th>Note</th><th></th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="meta" style="padding:18px">No fields yet — add the first one.</td></tr>') + '</tbody></table></div>' +
        '<div class="mt-16">' + addBtn('Add field', 'cfg-arr-add', 'data-path="' + path + '.fields" data-tpl="field"') + '</div>' +
        '<div class="bm-wrap" id="bmw-' + i + '">' + X.byteMapHtml(b.record_length, rt.fields, { title: 'Byte map · record type ' + esc(rt.record_type || '?') }) + '</div>' +
        '</div>';
    }).join('');

    return head +
      '<div class="cfg-section-title">Record types</div>' + rts +
      '<div class="mt-16">' + addBtn('Add record type', 'cfg-arr-add', 'data-path="record_types" data-tpl="recordtype"') + '</div>' +
      dataList('dl-layout-fields', names);
  }

  function nfTransform() {
    var e = edit(), b = e.body, tf = b.transform || (b.transform = { json_extractions: [], surcharge: { enabled: false, mappings: [] }, acquirer_profile: {} });
    var names = C.fieldNames(b);
    var groups = (tf.json_extractions || []).map(function (g, i) {
      var gp = 'transform.json_extractions.' + i;
      var rows = (g.rows || []).map(function (r, j) {
        var bad = r.output && names.indexOf(r.output) < 0;
        return '<tr>' +
          '<td>' + txt(gp + '.rows.' + j + '.json_key', r.json_key, { ph: 'json_key', cls: 'mono' }) + '</td>' +
          '<td class="arrow">' + icon('arrow-right', 14) + '</td>' +
          '<td>' + txt(gp + '.rows.' + j + '.output', r.output, { list: 'dl-layout-fields', ph: 'layout field name', cls: bad ? 'bad' : '' }) +
          (bad ? '<div class="inline-warn">' + icon('alert-triangle', 12) + 'Not a field in the Layout tab' + '</div>' : '') + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove row', 'data-path="' + gp + '.rows" data-idx="' + j + '"') + '</td></tr>';
      }).join('');
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head">' +
        '<label class="field inline">Source column ' + selIn(gp + '.source_column', g.source_column, C.SOURCE_COLUMNS, { cls: 'w-220' }) + '</label>' +
        iconBtn('cfg-arr-del', 'trash-2', 'Remove extraction group', 'data-path="transform.json_extractions" data-idx="' + i + '"') +
        '</div>' +
        '<table class="data cfg-sub-table"><thead><tr><th>json_key</th><th></th><th>output (layout field)</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="meta" style="padding:14px">No mappings yet.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16">' + addBtn('Add mapping', 'cfg-arr-add', 'data-path="' + gp + '.rows" data-tpl="extrow"') + '</div></div>';
    }).join('');

    var sur = tf.surcharge || {};
    var surRows = (sur.mappings || []).map(function (r, j) {
      return '<tr><td>' + txt('transform.surcharge.mappings.' + j + '.source', r.source, { ph: 'source key', cls: 'mono' }) + '</td>' +
        '<td class="arrow">' + icon('arrow-right', 14) + '</td>' +
        '<td>' + txt('transform.surcharge.mappings.' + j + '.output', r.output, { list: 'dl-layout-fields', ph: 'layout field name' }) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove', 'data-path="transform.surcharge.mappings" data-idx="' + j + '"') + '</td></tr>';
    }).join('');

    var ap = tf.acquirer_profile || {};
    return '<div class="cfg-section-title">JSON extractions</div>' +
      (groups || '<div class="meta mb-16">No extraction groups yet.</div>') +
      '<div class="mt-16">' + addBtn('Add extraction group', 'cfg-arr-add', 'data-path="transform.json_extractions" data-tpl="extraction"') + '</div>' +

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
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Everything outside these blocks lives in <strong>Raw</strong> mode. Cross-tab validation checks every <code>output</code> against the field names defined on the Layout tab.</div></div>' +
      dataList('dl-layout-fields', names);
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

    return '<div class="cfg-grid-3">' +
      fld('Report', selIn('report', b.report, C.REPORTS, { refresh: 'preview' })) +
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

    return '<div class="cfg-section-title">Transaction fee rules</div>' +
      '<div class="table-wrap"><table class="data fee-table"><thead><tr><th></th><th>Model</th><th>Fee mode</th><th class="num">Priority</th><th>Starting date</th><th class="num"># conditions</th><th class="num"># calculations</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="meta" style="padding:18px">No fee rules defined.</td></tr>') + '</tbody></table></div>' +
      '<div class="mt-16">' + addBtn('Add fee rule', 'cfg-arr-add', 'data-path="txn_rules" data-tpl="feerule"') + '</div>' +
      '<div class="callout info mt-24">' + icon('info', 18) + '<div class="callout-body">Priorities must be unique per config, slab ranges must not overlap, and percentages must fall within 0–100. Violations appear in the Validation panel below and block submission.</div></div>' +
      dataList('dl-txn-cols', C.TXN_COLUMNS);
  }

  /* =======================================================================
     TAB BODIES — Family 3 · Incoming Parsing
     ======================================================================= */
  function ipPipeline() {
    var e = edit(), b = e.body;
    var ref = b.layout_ref ? C.byId[b.layout_ref] : null;
    var refNames = ref ? C.fieldNames(ref.body) : [];
    var secField = (b.sectioning || {}).field;
    var secBad = ref && secField && refNames.indexOf(secField) < 0;

    var secRules = ((b.sectioning || {}).rules || []).map(function (r, i) {
      return '<tr><td>' + txt('sectioning.rules.' + i + '.match', r.match, { cls: 'mono w-120' }) + '</td>' +
        '<td>' + txt('sectioning.rules.' + i + '.bucket', r.bucket, { cls: 'mono' }) + '</td>' +
        '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove rule', 'data-path="sectioning.rules" data-idx="' + i + '"') + '</td></tr>';
    }).join('');

    var agg = b.aggregation || {};
    var layoutOpts = [['', '— none —']].concat(C.layoutConfigs().map(function (c) { return [c.configId, c.name]; }));

    return '<div class="cfg-grid-4">' +
      fld('Gateway', txt('gateway', b.gateway)) +
      fld('Network', txt('network', b.network)) +
      fld('Direction', selIn('direction', b.direction, ['INCOMING', 'OUTGOING'])) +
      fld('Pipeline kind', selIn('pipeline_kind', b.pipeline_kind, ['clearing', 'acknowledgment', 'chargeback', 'settlement'])) +
      '</div>' +

      '<div class="cfg-section-title mt-24">Ack filenames</div>' +
      tagList('ack_filenames', b.ack_filenames, 'Add filename pattern, e.g. VISA_ACK_%Y%m%d.txt') +
      '<div class="meta hint-row mt-16">' + icon('info', 13) + '<span>Patterns accept the date tokens %Y, %m, %d, %H and %M. A pattern without a date token only ever matches one literal filename.</span></div>' +

      '<div class="cfg-section-title mt-24">Layout reference</div>' +
      '<div class="cfg-block">' +
      '<div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">' +
      '<label class="field" style="flex:1;min-width:280px">Fixed-width layout config ' + selIn('layout_ref', b.layout_ref || '', layoutOpts, { refresh: 'body' }) + '</label>' +
      (ref
        ? '<button class="btn btn-secondary btn-sm" data-action="cfg-drawer" data-id="' + ref.configId + '">' + icon('panel-right-open', 15) + 'View layout</button>'
        : '') +
      '</div>' +
      (b.layout_ref && !ref
        ? '<div class="inline-warn big">' + icon('x-circle', 14) + 'layout_ref "' + esc(b.layout_ref) + '" does not resolve to an existing layout config.</div>'
        : ref
          ? '<div class="ref-summary">' + icon('link', 14) + 'Resolves to ' + statePill(ref) + ' <strong>' + esc(ref.name) + '</strong> · record length <span class="num">' + ref.body.record_length + '</span> · <span class="num">' + refNames.length + '</span> distinct field names across <span class="num">' + (ref.body.record_types || []).length + '</span> record type' + ((ref.body.record_types || []).length === 1 ? '' : 's') + '</div>'
          : '<div class="meta mt-16">No layout referenced — sectioning fields cannot be checked against a layout.</div>') +
      (ref ? '<div class="bm-mini">' + X.byteMapHtml(ref.body.record_length, (ref.body.record_types[0] || {}).fields, { compact: true, title: 'Referenced byte map · record type ' + esc((ref.body.record_types[0] || {}).record_type || '?') }) + '</div>' : '') +
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
    var keys = Object.keys(rts);
    var groups = keys.map(function (k) {
      var g = rts[k] || {}, mp = g.mappings || {};
      var mrows = Object.keys(mp).map(function (t) {
        var known = C.INTERNAL_FIELDS.indexOf(t) >= 0;
        return '<tr><td class="mono' + (known ? '' : ' bad-text') + '">' + esc(t) + (known ? '' : ' <span class="tip" data-tip="Not a known internal field name">' + icon('alert-triangle', 12) + '</span>') + '</td>' +
          '<td class="arrow">' + icon('arrow-left', 14) + '</td>' +
          '<td>' + txt('record_types.' + k + '.mappings.' + t, mp[t], { cls: 'mono' }) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-map-del', 'trash-2', 'Remove mapping', 'data-path="record_types.' + k + '.mappings" data-key="' + esc(t) + '"') + '</td></tr>';
      }).join('');
      var frows = (g.filters || []).map(function (f, i) {
        return '<tr><td>' + txt('record_types.' + k + '.filters.' + i + '.field', f.field, { cls: 'mono' }) + '</td>' +
          '<td>' + selIn('record_types.' + k + '.filters.' + i + '.condition', f.condition, C.CONDITIONS, { cls: 'w-100' }) + '</td>' +
          '<td>' + txt('record_types.' + k + '.filters.' + i + '.value', f.value) + '</td>' +
          '<td class="row-actions">' + iconBtn('cfg-arr-del', 'trash-2', 'Remove filter', 'data-path="record_types.' + k + '.filters" data-idx="' + i + '"') + '</td></tr>';
      }).join('');
      return '<div class="cfg-block">' +
        '<div class="cfg-block-head"><div class="row" style="gap:10px;align-items:center">' + icon('file-stack', 16) + '<strong class="mono">' + esc(k) + '</strong>' +
        '<span class="meta"><span class="num">' + Object.keys(mp).length + '</span> mappings · <span class="num">' + (g.filters || []).length + '</span> filters</span></div>' +
        iconBtn('cfg-map-del', 'trash-2', 'Remove record type', 'data-path="record_types" data-key="' + esc(k) + '"') + '</div>' +
        '<div class="cfg-section-title sm">Mappings <span class="meta">internal field ← source column</span></div>' +
        '<table class="data cfg-sub-table"><thead><tr><th>Internal field</th><th></th><th>Source column</th><th></th></tr></thead><tbody>' +
        (mrows || '<tr><td colspan="4" class="meta" style="padding:12px">No mappings.</td></tr>') + '</tbody></table>' +
        '<div class="mt-16 row" style="gap:8px;align-items:center">' +
        '<select class="input w-220" id="mapsel-' + esc(k) + '">' + C.INTERNAL_FIELDS.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join('') + '</select>' +
        addBtn('Add mapping', 'cfg-map-add', 'data-path="record_types.' + k + '.mappings" data-sel="mapsel-' + esc(k) + '"') +
        '</div>' +
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

    return '<div class="cfg-grid-3">' +
      fld('File format', selIn('file_format', b.file_format, ['DELIMITED', 'FIXED_WIDTH', 'JSON_LINES'])) +
      fld('Delimiter', txt('delimiter', b.delimiter, { cls: 'mono', maxlength: 3 })) +
      fld('Quote character', txt('quote_char', b.quote_char, { cls: 'mono', maxlength: 1 })) +
      '</div>' +
      '<div class="cfg-section-title mt-24">Record types</div>' +
      (groups || '<div class="meta mb-16">No record types defined.</div>') +
      '<div class="mt-16 row" style="gap:8px;align-items:center">' +
      '<input class="input w-220" id="newRtName" placeholder="New record type, e.g. REFUND" />' +
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
    var maps = (ref.body.record_types || []).map(function (rt) {
      return '<div class="mt-16">' + X.byteMapHtml(ref.body.record_length, rt.fields, { title: 'Record type ' + esc(rt.record_type || '?') + (rt.label ? ' · ' + esc(rt.label) : '') }) + '</div>';
    }).join('');
    var rows = (ref.body.record_types[0] || { fields: [] }).fields.map(function (f, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(f.name) + '</td><td class="num">' + f.start + '</td><td class="num">' + f.length + '</td><td>' + esc(f.type) + '</td><td class="cell-sub">' + esc(f.note || '') + '</td></tr>';
    }).join('');
    return '<div class="overlay" data-action="cfg-drawer-close">' +
      '<div class="side-panel wide" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><div><div class="section-title">' + esc(ref.name) + '</div>' +
      '<div class="meta">Referenced layout · record length <span class="num">' + ref.body.record_length + '</span> · ' + esc(ref.body.encoding) + ' · ' + statePill(ref) + '</div></div>' +
      '<button class="icon-btn" data-action="cfg-drawer-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      maps +
      '<div class="cfg-section-title mt-24">Fields</div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th class="num">#</th><th>Field name</th><th class="num">Start</th><th class="num">Length</th><th>Type</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
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
    if (id && C.byId[id]) {
      if (S.cfg.selected[fam] !== id) resetEdit();
      S.cfg.selected[fam] = id;
    }
    if (!C.byId[S.cfg.selected[fam]]) {
      var first = filtered(fam)[0] || C.byFamily(fam)[0];
      S.cfg.selected[fam] = first ? first.configId : null;
      resetEdit();
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
    renderValidation();
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
    parserrt: function () { return { mappings: {}, filters: [], mutations: [], computations: [] }; }
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
      resetEdit();
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
      var subType = fam === 'network-file' ? 'layout' : (fam === 'settlement' ? 'schedule' : 'pipeline');
      var id = C.nextId(fam);
      var cfg = {
        configId: id,
        configType: fam === 'network-file' ? 'CLEARING_FILE' : (fam === 'settlement' ? 'SETTLEMENT_GENERATOR' : 'INCOMING'),
        family: fam, subType: subType,
        name: 'new · ' + C.familyById[fam].short.toLowerCase() + ' · draft',
        network: fam === 'network-file' ? 'visa' : undefined,
        report: fam === 'settlement' ? 'MPR' : undefined,
        source: fam === 'incoming-parsing' ? 'visa_incoming' : undefined,
        recordSet: fam === 'network-file' ? 'clearing' : undefined,
        tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'DRAFT',
        body: C.blankBody(fam, subType),
        createdBy: C.DEMO_USER, createdAt: nowStamp(), updatedAt: nowStamp(),
        approvedBy: null, approvedAt: null, submittedBy: null, submittedAt: null,
        submittedHoursAgo: null, rejectionReason: null, versions: [], currentDraft: null, comments: []
      };
      C.configs.unshift(cfg); C.byId[id] = cfg;
      resetEdit();
      go(famRoute(fam, id));
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
