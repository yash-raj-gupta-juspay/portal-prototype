/* =============================================================================
   Juspay Ops Portal — Run Console, run launcher and duplicate remediation
   (Observability & RCA brief, Parts 6, 7 and 8.3)

   Four surfaces in one module, because they share one model:

     1. Runs list          every automated and manual operation, filterable
     2. Run detail         RCA first when it failed, then the stage timeline
     3. The run launcher   the replacement for hand-editing scripts (Part 7.1)
     4. Duplicate remediation   the focused view behind the Ops Home banner

   The launcher is the highest-value thing here. It exists because the incident
   in Part 2 happened when someone edited a script meaning to run incoming and
   ran outgoing. Two properties of this panel make that specific mistake — and
   its whole class — structurally hard:

     · the user picks a NAMED OPERATION, never a direction flag, so "outgoing"
       is not a thing you can accidentally select; and
     · the current-state block is mandatory and always visible, so before
       anything can start you can see that this cycle was already staged.

   window.RunsUI(kit) → { route, actions, render, openOverride, launcherFor }
   ============================================================================= */
window.RunsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES, R = window.RUNS, E = window.RUN_ERRORS;
  var S = window.AppState;
  var RCA = kit.rca;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go,
    num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag, emptyState = kit.emptyState;

  var ROUTE = '#/dashboard/ops/runs';
  var TODAY = R.TODAY;
  var MIN_DATE = R.MIN_DATE;

  /* In memory only — no browser storage anywhere in this brief. */
  S.runs = {
    q: '', tenant: 'all', network: 'all', type: 'all', status: 'all', cycleDate: null,
    dateMode: '7', from: U.addDays(TODAY, -6), to: TODAY, date: TODAY,
    logOpen: false, checksOpen: true,
    launcher: null,          // the run launcher's own state while it is open
    override: null,          // the override request form while it is open
    panelRunId: null,        // a run whose RCA is open in a side panel
    role: 'Maker',           // maker-checker, same vocabulary as the config screens
    modal: null
  };

  function paintIcons() { if (window.lucide) window.lucide.createIcons(); }
  function clampDate(d) { return d < MIN_DATE ? MIN_DATE : (d > TODAY ? TODAY : d); }
  function actingUser() { return S.runs.role === 'Checker' ? R.CHECKER_USER : R.OPS_USER; }

  /* =======================================================================
     SHARED BITS
     ======================================================================= */
  function statusPill(run) {
    var m = R.STATUS_META[run.status];
    return pill(m.label, m.kind, m.icon);
  }
  /* The network's own colour identifies it as a dot, not as the label's text
     colour: Mastercard's yellow on its own 10% tint reads at 1.9:1, which is
     unreadable, and this badge repeats on every row. Dot for identity, token
     colour for text — the same trade tenantTag already makes. */
  function netBadge(key) {
    if (!key) return '<span class="run-net-none" title="Settlement and reconciliation runs are acquirer-level — they have no network dimension">—</span>';
    var n = D.NET_BY_KEY[key];
    return '<span class="run-net"><span class="run-net-dot" style="background:' + n.color + '"></span>' + esc(n.name) + '</span>';
  }
  function triggerCell(run) {
    if (run.trigger === 'scheduled') return 'Scheduled';
    if (run.trigger === 'retry') return 'Retry by ' + run.triggeredBy.split('@')[0];
    return 'Manual by ' + run.triggeredBy.split('@')[0];
  }
  function tagChips(run) {
    if (!run.tags.length) return '';
    return '<span class="run-tags">' + run.tags.map(function (t) {
      var tip = t === 'Duplicate' ? 'This cycle was staged more than once — open the run to compare'
        : t === 'Overridden' ? 'A guard blocked this run and a second approver overrode it'
          : t === 'Voided' ? 'Recorded as void — excluded from settlement expectations' : t;
      return '<span class="run-tag ' + t.toLowerCase() + '" title="' + esc(tip) + '">' + esc(t) + '</span>';
    }).join('') + '</span>';
  }
  function runRoute(id) { return ROUTE + '/' + id; }

  function range() {
    var f = S.runs, m = f.dateMode;
    if (m === 'today') return { from: TODAY, to: TODAY, label: 'Today · ' + U.prettyDate(TODAY) };
    if (m === '7') return { from: U.addDays(TODAY, -6), to: TODAY, label: 'Last 7 days' };
    if (m === '30') return { from: MIN_DATE, to: TODAY, label: 'Last 30 days' };
    if (m === 'date') return { from: f.date, to: f.date, label: U.prettyDate(f.date) };
    var a = f.from <= f.to ? f.from : f.to, b = f.from <= f.to ? f.to : f.from;
    return { from: a, to: b, label: U.prettyDate(a) + ' → ' + U.prettyDate(b) };
  }

  /* =======================================================================
     6.1 · RUNS LIST
     ======================================================================= */
  function healthStrip(list) {
    var c = R.counts(list);
    function tile(key, label, value, tone, ic, clickable, sub) {
      var on = S.runs.status === key;
      return '<div class="kpi-card tiled run-kpi ' + tone + (clickable ? ' clickable' : '') + (on ? ' active' : '') + '"' +
        (clickable ? ' data-action="run-kpi" data-status="' + key + '" role="button" tabindex="0"' : '') +
        ' title="' + esc(clickable ? (on ? 'Clear this filter' : 'Filter to ' + label.toLowerCase() + ' runs') : label) + '">' +
        '<div class="kpi-tile ' + tone + '">' + icon(ic, 22) + '</div>' +
        '<div class="kpi-label">' + label + '</div>' +
        '<div class="kpi-value num">' + num(value) + '</div>' +
        '<div class="kpi-foot">' + esc(sub) + '</div></div>';
    }
    return '<div class="kpi-row mb-16 run-health">' +
      tile('succeeded', 'Succeeded', c.succeeded, 'green', 'check-circle', false, list.length ? Math.round(c.succeeded / list.length * 100) + '% of this range' : 'nothing in range') +
      tile('failed', 'Failed', c.failed, 'red', 'x-circle', true, c.failed ? 'each has a root-cause card' : 'no failures in range') +
      tile('blocked', 'Blocked', c.blocked, 'orange', 'shield-alert', true, c.blocked ? 'stopped by a guard rail' : 'no guard blocks in range') +
      tile('running', 'Running now', c.running, 'blue', 'loader', true, c.running ? 'in flight' : 'nothing in flight') +
      '</div>';
  }

  function filters() {
    var f = S.runs;
    var tenantOpts = [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; }));
    var netOpts = [['all', 'All networks']].concat(D.NETWORKS.map(function (n) { return [n.key, n.name]; }))
      .concat([['-', 'Acquirer-level (no network)']]);
    var typeOpts = [['all', 'All run types']].concat(R.TYPES.map(function (t) { return [t.id, t.label]; }));
    var statusOpts = [['all', 'Any status']].concat(['succeeded', 'failed', 'blocked', 'running']
      .map(function (k) { return [k, R.STATUS_META[k].label]; }));

    var onDate = f.dateMode === 'date', onRange = f.dateMode === 'range';
    var chips = [];
    if (f.tenant !== 'all') chips.push({ label: 'Tenant: ' + O.tenantById[f.tenant].name, action: 'run-chip', data: ' data-chip="tenant"' });
    if (f.network !== 'all') chips.push({ label: 'Network: ' + (f.network === '-' ? 'Acquirer-level' : R.netName(f.network)), action: 'run-chip', data: ' data-chip="network"' });
    if (f.type !== 'all') chips.push({ label: 'Type: ' + R.typeById[f.type].label, action: 'run-chip', data: ' data-chip="type"' });
    if (f.status !== 'all') chips.push({ label: 'Status: ' + R.STATUS_META[f.status].label, action: 'run-chip', data: ' data-chip="status"' });
    if (f.q) chips.push({ label: 'Search: ' + f.q, action: 'run-chip', data: ' data-chip="q"' });
    if (f.cycleDate) chips.push({ label: 'Cycle: ' + U.prettyDate(f.cycleDate), action: 'run-chip', data: ' data-chip="cycleDate"' });

    return kit.opsFilterRow({
      search: { placeholder: 'Search run ID or file name', action: 'run-i-q', value: f.q },
      filters: [
        { action: 'run-c-tenant', value: f.tenant, label: 'Tenant', options: tenantOpts },
        { action: 'run-c-network', value: f.network, label: 'Network', options: netOpts },
        { action: 'run-c-type', value: f.type, label: 'Run type', options: typeOpts },
        { action: 'run-c-status', value: f.status, label: 'Status', options: statusOpts }
      ],
      preset: {
        action: 'run-c-preset', value: f.dateMode,
        options: [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['date', 'Specific date'], ['range', 'Custom range']]
      },
      dateRange: (onDate
        ? '<input type="date" data-action="run-c-date" value="' + f.date + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="Run date" />'
        : (onRange
          ? '<input type="date" data-action="run-c-from" value="' + f.from + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="From" />' +
          '<span class="meta">–</span>' +
          '<input type="date" data-action="run-c-to" value="' + f.to + '" min="' + MIN_DATE + '" max="' + TODAY + '" aria-label="To" />'
          : '<span>' + esc(range().label) + '</span>')) + icon('chevron-down', 16),
      refresh: 'run-refresh',
      chips: chips
    });
  }

  function runsTable(list) {
    if (!list.length) {
      return '<div class="card">' + emptyState('activity', 'No runs in this view',
        'Widen the date range or clear the tenant, network, type and status filters.',
        '<button class="btn btn-secondary" data-action="run-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    var rows = list.slice(0, 300).map(function (r) {
      var cls = r.status === 'failed' ? 'run-row-failed' : (r.status === 'blocked' ? 'run-row-blocked' : (r.status === 'running' ? 'run-row-running' : ''));
      return '<tr class="' + cls + (r.voided ? ' run-row-void' : '') + '">' +
        '<td><div class="cell-main mono run-id">' + esc(r.runId) + '</div>' +
        '<div class="cell-sub">' + esc(r.typeLabel) + tagChips(r) + '</div></td>' +
        '<td class="nowrap">' + tenantTag(r.tenantId) + '</td>' +
        '<td class="nowrap">' + netBadge(r.networkKey) + '</td>' +
        '<td class="nowrap num">' + U.prettyDate(r.cycleDate) + '</td>' +
        '<td class="nowrap cell-sub">' + esc(triggerCell(r)) + '</td>' +
        '<td class="nowrap cell-sub num">' + esc(r.startedAt.replace(' IST', '')) + '</td>' +
        '<td class="num nowrap">' + esc(R.durLabel(r.durationSec)) + '</td>' +
        '<td>' + statusPill(r) + '</td>' +
        '<td class="nowrap"><a class="btn-ghost" data-route="' + runRoute(r.runId) + '">View ' + icon('arrow-right', 13) + '</a></td>' +
        '</tr>';
    }).join('');
    var more = list.length > 300
      ? '<div class="meta run-more">Showing the 300 most recent of <span class="num">' + num(list.length) + '</span> runs in this range — narrow the filters to see the rest.</div>'
      : '';
    return '<div class="table-card"><div class="table-wrap"><table class="data run-table"><thead><tr>' +
      '<th>Run</th><th>Tenant</th><th>Network</th><th class="num">Cycle</th><th>Trigger</th>' +
      '<th class="num">Started</th><th class="num">Duration</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>' + more;
  }

  /* Part 8.2 · surface 3 — the anomaly is visible in the Run Console too, not
     only on Ops Home, and both runs link to each other from here. */
  function anomalyStrip() {
    var list = R.anomalies();
    if (!list.length) return '';
    return list.map(function (a) {
      return '<div class="run-anom" data-route="' + ROUTE + '/duplicate/' + a.tenantId + '/' + a.networkKey + '/' + a.cycleDate + '">' +
        icon('copy', 18) +
        '<div class="run-anom-body">' +
        '<strong>' + esc(a.tenantName) + ' · ' + esc(a.networkName) + ' · ' + U.prettyDate(a.cycleDate) + ' was staged twice</strong>' +
        '<div class="meta">' + esc(a.runIds.join(' and ')) + ' — both tagged Duplicate and linked to each other.</div>' +
        '</div>' +
        '<span class="btn btn-secondary btn-sm">Investigate ' + icon('arrow-right', 14) + '</span>' +
        '</div>';
    }).join('');
  }

  /* Part 7.4 — override requests sit in a queue alongside the other approvals. */
  function overrideQueue() {
    var pending = R.pendingOverrides();
    var decided = R.overrides.filter(function (o) { return o.status !== 'pending'; });
    if (!pending.length && !decided.length) return '';
    var me = actingUser();
    var rows = pending.map(function (ov) {
      var run = R.byId[ov.runId];
      var self = ov.requestedBy === me;
      return '<div class="ovr-row">' +
        '<div class="ovr-main">' +
        '<div class="ovr-head"><span class="mono">' + esc(ov.id) + '</span> · ' +
        '<a data-route="' + runRoute(ov.runId) + '" class="mono">' + esc(ov.runId) + '</a> · ' +
        esc(run ? run.typeLabel : '') + '</div>' +
        '<div class="ovr-consequence">' + icon('alert-triangle', 15) + esc(ov.consequence) + '</div>' +
        '<div class="meta">Requested by ' + esc(ov.requestedBy) + ' · ' + esc(ov.requestedAt) + '</div>' +
        '<div class="ovr-reason">“' + esc(ov.reason) + '”</div>' +
        '</div>' +
        '<div class="ovr-actions">' +
        (self
          ? '<span class="ovr-selfnote" title="Maker-checker: the same rule the config screens use">' + icon('lock', 14) +
          'You raised this — it needs a second approver</span>'
          : '<button class="btn btn-secondary btn-sm" data-action="run-ovr-reject" data-id="' + esc(ov.id) + '">' + icon('x', 15) + 'Reject</button>' +
          '<button class="btn btn-primary btn-sm" data-action="run-ovr-approve" data-id="' + esc(ov.id) + '">' + icon('check', 15) + 'Approve</button>') +
        '</div></div>';
    }).join('');
    var history = decided.map(function (ov) {
      return '<div class="ovr-row decided">' +
        '<div class="ovr-main"><div class="ovr-head"><span class="mono">' + esc(ov.id) + '</span> · ' +
        '<a data-route="' + runRoute(ov.runId) + '" class="mono">' + esc(ov.runId) + '</a> ' +
        pill(ov.status === 'approved' ? 'Approved' : 'Rejected', ov.status === 'approved' ? 'success' : 'danger') + '</div>' +
        '<div class="meta">' + esc(ov.requestedBy) + ' → ' + esc(ov.decidedBy || '') + ' · ' + esc(ov.decidedAt || '') + '</div>' +
        '<div class="ovr-reason">“' + esc(ov.reason) + '”</div></div></div>';
    }).join('');

    var roleBar = '<div class="role-bar"><label class="role-select">Acting as ' +
      '<select class="input" data-action="run-c-role">' +
      ['Maker', 'Checker'].map(function (r) { return '<option' + (S.runs.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select></label>' +
      '<span class="tip role-user" data-tip="Prototype convenience — in production the role comes from auth. Self-approval stays blocked whichever role is selected.">' +
      icon('user', 14) + esc(me) + '</span></div>';

    return cardBox('Override requests' + (pending.length ? ' <span class="count num">' + pending.length + '</span>' : ''),
      '<div class="meta mb-16">A guard block can be overridden, but never quietly: the request states its consequence, needs a reason of at least 40 characters, and a second person has to approve it. Approved overrides stay tagged on the run permanently.</div>' +
      (pending.length ? '<div class="ovr-list">' + rows + '</div>' : '<div class="meta">No override requests waiting.</div>') +
      (history ? '<div class="cyc-sub-title">Decided</div><div class="ovr-list">' + history + '</div>' : ''),
      roleBar, 'run-ovr-card');
  }

  function viewList() {
    var rg = range();
    var f = S.runs;
    var list = R.query({
      from: rg.from, to: rg.to, tenant: f.tenant, network: f.network,
      type: f.type, status: f.status, q: f.q, cycleDate: f.cycleDate
    });
    var h = R.health();
    setView(
      kit.pageHead('Runs', 'Every automated and manual operation across the platform.',
        '<button class="btn btn-primary" data-action="run-launch-open">' + icon('play', 18) + 'Start a run</button>') +
      anomalyStrip() +
      healthStrip(list) +
      filters() +
      '<div class="run-scope meta">Showing <strong class="num">' + num(list.length) + '</strong> run' + (list.length === 1 ? '' : 's') +
      ' · ' + esc(rg.label) + ' · <span class="num">' + h.successPct + '%</span> of all ' + num(h.total) + ' runs in the last 30 days succeeded</div>' +
      runsTable(list) +
      '<div class="mt-24">' + overrideQueue() + '</div>'
    );
    if (S.runs.launcher && S.runs.launcher.open) paintLauncher();
    else if (S.runs.override) paintOverrideForm();
  }

  /* =======================================================================
     6.2 · RUN DETAIL
     ======================================================================= */
  var STAGE_ICON = { succeeded: 'check-circle', failed: 'x-circle', blocked: 'shield-alert', running: 'loader', notrun: 'circle' };

  function checkList(checks) {
    if (!checks || !checks.length) return '';
    var ICON = { pass: 'check', warn: 'alert-triangle', block: 'shield-alert', skip: 'minus' };
    var passed = checks.filter(function (c) { return c.status === 'pass'; }).length;
    return '<div class="run-checks">' +
      '<button class="btn-ghost run-checks-toggle" data-action="run-checks-toggle">' +
      icon(S.runs.checksOpen ? 'chevron-down' : 'chevron-right', 14) +
      '<span class="num">' + passed + '</span> of <span class="num">' + checks.length + '</span> pre-flight checks passed' +
      '</button>' +
      (S.runs.checksOpen
        ? '<ul class="run-check-list">' + checks.map(function (c) {
          return '<li class="rc-' + c.status + '">' + icon(ICON[c.status] || 'circle', 15) +
            '<span class="rc-label">' + esc(c.label) + '</span>' +
            '<span class="rc-msg">' + esc(c.message) + '</span></li>';
        }).join('') + '</ul>'
        : '') +
      '</div>';
  }

  function stageTimeline(run) {
    return '<ol class="run-timeline">' + run.stages.map(function (s) {
      var st = s.status;
      var detail = '';
      if (s.name === 'Pre-flight checks' && s.checks) detail = checkList(s.checks);
      if ((st === 'failed' || st === 'blocked') && run.rca) {
        var entry = run.rca.known ? E.get(run.rca.code) : null;
        detail += '<div class="run-stage-detail">' +
          '<div class="rsd-code mono">' + esc(s.errorCode || 'UNKNOWN') + '</div>' +
          '<div class="rsd-text">' + esc(entry ? E.interp(entry.what, run.rca.values) : 'The stage aborted. The raw failure is in the card above and the technical log below.') + '</div>' +
          '</div>';
      }
      return '<li class="run-step rs-' + st + '">' +
        '<span class="rs-icon">' + icon(STAGE_ICON[st], 18) + '</span>' +
        '<div class="rs-body">' +
        '<div class="rs-head"><span class="rs-name">' + esc(s.name) + '</span>' +
        '<span class="rs-dur num">' + (st === 'notrun' ? 'Not run' : (st === 'running' ? 'running…' : R.durLabel(s.durationSec))) + '</span></div>' +
        detail + '</div></li>';
    }).join('') + '</ol>';
  }

  function kvBlock(rows) {
    return '<dl class="run-kv">' + rows.filter(Boolean).map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
  }

  function fileBlock(label, f, withPath) {
    if (!f) return '';
    return '<div class="run-file"><div class="run-file-label">' + esc(label) + '</div>' +
      kvBlock([
        ['Name', '<span class="mono">' + esc(f.name) + '</span>'],
        f.source ? ['Source', esc(f.source)] : null,
        ['Checksum', '<span class="mono">' + esc(f.checksum) + '</span>'],
        ['Size', '<span class="num">' + esc(R.bytes(f.sizeBytes)) + '</span>'],
        f.fileDate ? ['File date', '<span class="num">' + U.prettyDate(f.fileDate) + '</span>'] : null,
        (withPath && f.s3Path) ? ['S3 path', '<span class="mono run-s3">' + esc(f.s3Path) + '</span>' +
          '<button class="icon-btn xs" data-action="run-copy-path" data-path="' + esc(f.s3Path) + '" title="Copy S3 path" aria-label="Copy S3 path">' + icon('copy', 14) + '</button>'] : null
      ]) + '</div>';
  }

  /* Part 6.2 — related links, and only the ones that have somewhere to go.
     A link with no target is omitted, never rendered disabled (Part 10.2). */
  function relatedLinks(run) {
    var out = [];
    out.push(['View this cycle', '#/dashboard/ops/cycle-snapshot/' + run.tenantId + '/' + (run.networkKey || R.primaryNetwork(run.tenantId)) + '/' + run.cycleDate, 'calendar-clock']);

    // Only when a reject batch actually exists behind it — Part 10.2 omits a
    // link whose destination has nothing to show, rather than disabling it.
    if (run.recordCounts && run.recordCounts.rejected > 0 && rejectBatchFor(run)) {
      out.push(['View rejects from this run',
        '#/dashboard/ops/rejects?rejTenant=' + run.tenantId + '&rejDate=' + run.cycleDate +
        '&rejFamily=' + (run.type === 'CLEARING_STAGE' ? 'staging' : 'incoming'), 'file-warning']);
    }
    if (run.outputFile || run.type === 'SETTLEMENT_GENERATE' || run.type === 'SETTLEMENT_DELIVER' || run.type === 'FILE_VALIDATE') {
      out.push(['View the settlement file', '#/dashboard/ops/files?filesTenant=' + run.tenantId + '&filesDate=' + run.cycleDate, 'file-spreadsheet']);
    }
    var cfg = configForRun(run);
    if (cfg) out.push(['View the configuration used', configRoute(cfg), 'settings-2']);
    if (run.previousRunId) out.push(['View previous run for this cycle', runRoute(run.previousRunId), 'history']);
    if (run.duplicateOf) out.push(['View the duplicate of this run', runRoute(run.duplicateOf), 'copy']);
    if (run.relatedRunId && run.relatedRunId !== run.previousRunId) out.push(['View the run this retried', runRoute(run.relatedRunId), 'rotate-ccw']);
    out.push(['View the reconciliation for this cycle', '#/dashboard/ops/reconciliation?reconTenant=' + run.tenantId + '&reconCycle=ops-cyc-' + run.tenantId + '-' + run.cycleDate, 'git-compare']);

    return '<div class="run-related">' + out.map(function (l) {
      return '<a class="run-rel" data-route="' + esc(l[1]) + '">' + icon(l[2], 16) + '<span>' + esc(l[0]) + '</span>' + icon('arrow-right', 14) + '</a>';
    }).join('') + '</div>';
  }

  var NET_NAME_OF = { visa: 'Visa', mc: 'Mastercard', rupay: 'RuPay', onus: 'HSBC ONUS' };
  function rejectBatchFor(run) {
    var RD = window.REJDATA;
    if (!RD || !RD.batches || !run.networkKey) return null;
    var fam = run.type === 'CLEARING_STAGE' ? 'staging' : 'incoming';
    return RD.batches.filter(function (b) {
      return b.tenantId === run.tenantId && b.cycleDate === run.cycleDate &&
        b.family === fam && b.network === NET_NAME_OF[run.networkKey];
    })[0] || null;
  }

  /* The config version that was active when the run ran. */
  function configForRun(run) {
    var CD = window.CFGDATA;
    if (!CD || !CD.configs) return null;
    var fam = (run.type === 'INCOMING_PARSE' || run.type === 'INCOMING_FETCH') ? 'incoming-parsing'
      : (run.type === 'SETTLEMENT_GENERATE' || run.type === 'SETTLEMENT_DELIVER' || run.type === 'FILE_VALIDATE') ? 'settlement'
        : (run.type === 'RECONCILIATION' ? null : 'network-file');
    if (!fam) return null;
    var tk = String(run.tenantId).replace(/-/g, '_');
    return CD.configs.filter(function (c) {
      if (c.family !== fam || c.tenantId !== tk) return false;
      if (fam === 'network-file' && run.networkKey && c.network && c.network !== run.networkKey) return false;
      return true;
    })[0] || null;
  }
  function configRoute(cfg) {
    var seg = cfg.family === 'incoming-parsing' ? 'incoming' : (cfg.family === 'settlement' ? 'settlement' : 'network-files');
    return '#/dashboard/ops/configs/' + seg + '/' + cfg.configId;
  }

  function technicalLog(run) {
    if (!run.rca || !run.rca.log) return '';
    return '<div class="card run-log">' +
      '<button class="run-log-head" data-action="run-log-toggle">' +
      icon(S.runs.logOpen ? 'chevron-down' : 'chevron-right', 16) +
      '<span class="card-title">Technical log</span>' +
      '<span class="meta">60 lines around the failure — the one long log in the product</span>' +
      '</button>' +
      (S.runs.logOpen
        ? '<div class="run-log-body"><pre class="mono">' + run.rca.log.map(esc).join('\n') + '</pre>' +
        '<div class="run-log-foot"><button class="btn btn-secondary btn-sm" data-action="rca-copy-eng" data-rca-run="' + esc(run.runId) + '">' +
        icon('copy', 15) + 'Copy log</button></div></div>'
        : '') + '</div>';
  }

  function viewDetail(runId) {
    var run = R.byId[runId];
    if (!run) {
      setView(kit.pageHead('Runs', 'Every automated and manual operation across the platform.') +
        '<div class="card">' + emptyState('activity', 'Run not found',
          'That run ID is not in the last 30 days of runs.',
          '<button class="btn btn-secondary" data-route="' + ROUTE + '">Back to Runs</button>') + '</div>');
      return;
    }
    var anom = run.networkKey ? R.anomalyFor(run.tenantId, run.networkKey, run.cycleDate) : null;
    var head =
      '<div class="breadcrumb"><a data-route="#/dashboard/ops">Ops Home</a><span class="sep">/</span>' +
      '<a data-route="' + ROUTE + '">Runs</a><span class="sep">/</span><span>' + esc(run.runId) + '</span></div>' +
      '<div class="page-head run-head"><div>' +
      '<h1 class="page-title run-title"><span class="mono">' + esc(run.runId) + '</span>' + tagChips(run) + '</h1>' +
      '<div class="subtitle">' + esc(run.typeLabel) + ' · ' + tenantTag(run.tenantId, true) + ' · ' + netBadge(run.networkKey) +
      ' · cycle <span class="num">' + U.prettyDate(run.cycleDate) + '</span></div>' +
      '</div><div class="head-actions">' +
      (run.status === 'failed' || run.status === 'blocked'
        ? '<button class="btn btn-secondary" data-action="rca-rerun" data-rca-run="' + esc(run.runId) + '">' + icon('rotate-ccw', 18) + 'Re-run</button>'
        : '') +
      statusPill(run) +
      '</div></div>';

    // Failed or blocked: the RCA card renders FIRST, full width. It is the
    // reason this page was opened.
    var rca = (run.status === 'failed' || run.status === 'blocked')
      ? '<div class="mb-24">' + RCA.card(run, { variant: 'full', showViewRun: false }) + '</div>'
      : '';

    var dupCallout = anom && anom.runIds.indexOf(run.runId) >= 0
      ? '<div class="callout danger mb-24" data-route="' + ROUTE + '/duplicate/' + anom.tenantId + '/' + anom.networkKey + '/' + anom.cycleDate + '" style="cursor:pointer">' +
      icon('copy', 20) + '<div class="callout-body"><strong>This cycle was staged twice.</strong> ' +
      esc(anom.runIds.join(' and ')) + ' both staged a clearing file for ' + U.prettyDate(anom.cycleDate) + '.</div>' + icon('chevron-right', 18) + '</div>'
      : '';

    var voidNote = run.voided
      ? '<div class="callout warn mb-24">' + icon('ban', 20) + '<div class="callout-body"><strong>This run is recorded as void.</strong> ' +
      esc(run.voidNote || '') + ' It is excluded from settlement expectations.</div></div>'
      : '';

    var counts = run.recordCounts;
    var details = cardBox('Run details',
      '<div class="run-details">' +
      kvBlock([
        ['Trigger', esc(triggerCell(run))],
        ['Triggered by', '<span class="mono">' + esc(run.triggeredBy) + '</span>'],
        ['Started', '<span class="num">' + esc(run.startedAt) + '</span>'],
        ['Finished', run.finishedAt ? '<span class="num">' + esc(run.finishedAt) + '</span>' : '<span class="meta">still running</span>'],
        ['Duration', '<span class="num">' + esc(R.durLabel(run.durationSec)) + '</span>'],
        ['Direction', run.direction ? esc(run.direction) : '<span class="meta">not directional</span>'],
        ['Failed stage', run.failedStage ? '<span class="run-failstage">' + esc(run.failedStage) + '</span>' : '<span class="meta">—</span>']
      ]) +
      '<div>' +
      fileBlock('Input file', run.inputFile, false) +
      fileBlock('Output file', run.outputFile, true) +
      '<div class="run-file"><div class="run-file-label">Record counts</div>' +
      kvBlock([
        ['Read', '<span class="num">' + num(counts.read) + '</span>'],
        ['Accepted', '<span class="num">' + num(counts.accepted) + '</span>'],
        ['Rejected', '<span class="num' + (counts.rejected ? ' run-bad' : '') + '">' + num(counts.rejected) + '</span>'],
        ['Written', '<span class="num">' + num(counts.written) + '</span>']
      ]) + '</div>' +
      '</div></div>');

    setView(
      head + dupCallout + voidNote + rca +
      '<div class="grid run-detail-grid">' +
      cardBox('Stages', '<div class="meta mb-16">A run is a sequence of named stages. A failure belongs to exactly one of them.</div>' + stageTimeline(run), '', 'run-stages-card') +
      details +
      '</div>' +
      '<div class="mt-24">' + cardBox('Related', relatedLinks(run)) + '</div>' +
      '<div class="mt-24">' + technicalLog(run) + '</div>'
    );
    if (S.runs.override) paintOverrideForm();
  }

  /* =======================================================================
     8.3 · DUPLICATE REMEDIATION
     A focused comparison, not a generic run list.
     ======================================================================= */
  function money(n, cur) { return fmt(n, 2, cur); }

  function viewDuplicate(tenantId, netKey, cycleDate) {
    var anom = R.anomalyFor(tenantId, netKey, cycleDate);
    if (!anom || anom.runs.length < 2) { go(ROUTE); return; }
    var a = anom.runs[0], b = anom.runs[anom.runs.length - 1];
    var cur = a.currency;

    function row(label, va, vb, differs, sub) {
      return '<tr' + (differs ? ' class="dup-differs"' : '') + '>' +
        '<th scope="row">' + esc(label) + '</th>' +
        '<td>' + va + (sub && sub[0] ? '<div class="meta">' + sub[0] + '</div>' : '') + '</td>' +
        '<td>' + vb + (sub && sub[1] ? '<div class="meta">' + sub[1] + '</div>' : '') + '</td>' +
        '</tr>';
    }
    function inr(n) {
      if (cur === 'INR') return '';
      return '≈ ' + kit.fmtCr(O.toINR(n, cur));
    }
    var aInc = anom.incomingRuns.filter(function (r) { return r.startAbs > a.endAbs; })[0];

    var comparison = '<div class="table-wrap"><table class="data dup-table"><thead><tr>' +
      '<th></th><th>First stage</th><th>Second stage</th></tr></thead><tbody>' +
      row('Run', '<a class="mono" data-route="' + runRoute(a.runId) + '">' + esc(a.runId) + '</a>',
        '<a class="mono" data-route="' + runRoute(b.runId) + '">' + esc(b.runId) + '</a>', true) +
      row('Staged at', '<span class="num">' + esc(a.finishedAt) + '</span>', '<span class="num">' + esc(b.finishedAt) + '</span>', true) +
      row('Triggered by', esc(triggerCell(a)), esc(triggerCell(b)), a.trigger !== b.trigger) +
      row('Source', esc(a.inputFile.source), esc(b.inputFile.source), a.inputFile.source !== b.inputFile.source) +
      row('File date', '<span class="num">' + U.prettyDate(a.inputFile.fileDate) + '</span>',
        '<span class="num">' + U.prettyDate(b.inputFile.fileDate) + '</span>', a.inputFile.fileDate !== b.inputFile.fileDate) +
      row('Transactions', '<span class="num">' + num(a.recordCounts.read) + '</span>',
        '<span class="num">' + num(b.recordCounts.read) + '</span>', a.recordCounts.read !== b.recordCounts.read) +
      row('Value', '<span class="num">' + money(a.gross, cur) + '</span>', '<span class="num">' + money(b.gross, cur) + '</span>',
        Math.abs(a.gross - b.gross) > 0.01, [inr(a.gross), inr(b.gross)]) +
      row('Checksum', '<span class="mono">' + esc(a.inputFile.checksum) + '</span>',
        '<span class="mono">' + esc(b.inputFile.checksum) + '</span>', a.inputFile.checksum !== b.inputFile.checksum) +
      row('Incoming received',
        aInc ? '<span class="dup-yes">' + icon('check', 14) + esc(C.shortStamp(aInc.cycleDate, aInc.endAbs)) + '</span>' : '<span class="dup-no">' + icon('x', 14) + 'none</span>',
        '<span class="dup-no">' + icon('x', 14) + 'none</span>', true) +
      '</tbody></table></div>';

    var nextSteps = '<ul class="dup-steps">' +
      '<li>' + icon('mail', 18) + '<div><strong>Contact the network to void the duplicate</strong>' +
      '<div class="meta">Opens a note pre-filled with both run IDs, both timestamps and both file identifiers.</div></div>' +
      '<button class="btn btn-secondary btn-sm" data-action="run-dup-contact" data-key="' + esc(anom.key) + '">Open the note</button></li>' +
      (b.voided
        ? '<li class="done">' + icon('check-circle', 18) + '<div><strong>The second run is marked void</strong>' +
        '<div class="meta">' + esc(b.voidNote || '') + '</div></div></li>'
        : '<li>' + icon('ban', 18) + '<div><strong>Mark the second run as void</strong>' +
        '<div class="meta">Records the decision with a required note, tags the run <em>Voided</em> and excludes it from settlement expectations.</div></div>' +
        '<button class="btn btn-secondary btn-sm" data-action="run-dup-void" data-id="' + esc(b.runId) + '">Mark void</button></li>') +
      '<li>' + icon('git-compare', 18) + '<div><strong>View reconciliation impact</strong>' +
      '<div class="meta">A duplicate stage shows up as a residual on this cycle’s reconciliation.</div></div>' +
      '<a class="btn btn-secondary btn-sm" data-route="#/dashboard/ops/reconciliation?reconTenant=' + esc(tenantId) +
      '&reconCycle=ops-cyc-' + esc(tenantId) + '-' + esc(cycleDate) + '">Open reconciliation ' + icon('arrow-right', 14) + '</a></li>' +
      '</ul>';

    setView(
      '<div class="breadcrumb"><a data-route="#/dashboard/ops">Ops Home</a><span class="sep">/</span>' +
      '<a data-route="' + ROUTE + '">Runs</a><span class="sep">/</span><span>Duplicate staging</span></div>' +
      kit.pageHead('Duplicate staging — ' + esc(anom.tenantName) + ' · ' + esc(anom.networkName) + ' · ' + U.prettyDate(cycleDate),
        'Two clearing files were staged for one cycle. This is what differs between them.') +
      '<div class="dup-reasons">' + anom.reasons.map(function (r) {
        return '<div class="dup-reason">' + icon('alert-octagon', 16) + esc(r) + '</div>';
      }).join('') + '</div>' +
      '<div class="grid dup-grid">' +
      cardBox('Side by side', comparison) +
      cardBox('Assessment', '<p class="dup-assessment">' + esc(R.assessment(anom)) + '</p>' +
        '<div class="meta">Derived from the comparison on the left — not a written-in note.</div>') +
      '</div>' +
      '<div class="mt-24">' + cardBox('Next steps', nextSteps) + '</div>' +
      '<div class="dup-prevention">' + icon('shield-check', 18) +
      '<span>The cycle leg lock now blocks a second staging run for the same cycle. ' +
      '<a data-route="' + ROUTE + '/' + esc(R.INCIDENT.blockedRunId) + '">See the attempt it blocked ' + icon('arrow-right', 13) + '</a></span></div>'
    );
    if (S.runs.modal) paintModal();
  }

  /* =======================================================================
     7.1 · THE RUN LAUNCHER
     This replaces hand-editing scripts. Four selections, a mandatory
     current-state block, and live guard results.
     ======================================================================= */
  function launcherState() {
    var L = S.runs.launcher;
    if (!L) return null;
    var def = R.typeById[L.op] || R.TYPES[0];
    if (!L.tenant) L.tenant = O.tenants[0].id;
    // Keep the network legal for the tenant — a combination that does not
    // exist would produce a run nothing could ever match.
    var nets = C.networksFor(L.tenant);
    if (def.networked) {
      if (!L.network || !nets.filter(function (n) { return n.key === L.network; }).length) L.network = nets.length ? nets[0].key : null;
    }
    if (!L.cycle) L.cycle = R.CYCLE_TODAY;
    return L;
  }

  function launcherBody() {
    var L = launcherState();
    var def = R.typeById[L.op];
    var nets = C.networksFor(L.tenant);
    var netKey = def.networked ? L.network : null;

    /* ---- 1 · What do you want to run? -------------------------------------
       Named operations only. There is no direction control anywhere on this
       panel — that is the point. */
    var ops = '<div class="rl-ops" role="radiogroup" aria-label="What do you want to run?">' +
      R.TYPES.map(function (t) {
        var on = t.id === L.op;
        return '<label class="rl-op' + (on ? ' active' : '') + '">' +
          '<input type="radio" name="rl-op" value="' + t.id + '"' + (on ? ' checked' : '') + ' data-action="run-c-op" />' +
          '<span class="rl-op-body"><span class="rl-op-label">' + icon(t.icon, 16) + esc(t.opLabel) + '</span>' +
          '<span class="rl-op-blurb">' + esc(t.opBlurb) + '</span></span></label>';
      }).join('') + '</div>';

    /* ---- 2 · The three remaining selections. Nothing else. ---------------- */
    var tenantSel = '<label class="rl-field"><span>Tenant</span>' +
      '<select class="input" data-action="run-c-ltenant">' +
      O.tenants.map(function (t) { return '<option value="' + t.id + '"' + (t.id === L.tenant ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') +
      '</select></label>';

    var networkSel = '<label class="rl-field' + (def.networked ? '' : ' rl-na') + '"><span>Network</span>' +
      (def.networked
        ? '<select class="input" data-action="run-c-lnetwork">' +
        nets.map(function (n) { return '<option value="' + n.key + '"' + (n.key === L.network ? ' selected' : '') + '>' + esc(n.name) + '</option>'; }).join('') + '</select>'
        : '<span class="rl-na-note" title="Settlement and reconciliation runs are acquirer-level artifacts — they have no network dimension">Not applicable — this is an acquirer-level operation</span>') +
      '</label>';

    var cycleSel = '<label class="rl-field"><span>Cycle date</span>' +
      '<input type="date" class="input" data-action="run-c-lcycle" value="' + L.cycle + '" min="' + MIN_DATE + '" max="' + R.CYCLE_TODAY + '" /></label>';

    /* ---- 3 · CURRENT STATE — mandatory, always visible ---------------------
       The single most important element on the panel. Before anything can be
       started, this says what has already happened for this exact
       tenant × network × cycle. */
    var state = R.currentState(L.tenant, netKey, L.cycle);
    var ICON = { done: 'check', duplicate: 'copy', running: 'loader', failed: 'x', none: 'circle' };
    var stateBlock = '<div class="rl-state">' +
      '<div class="rl-state-head">Current state for this selection' +
      '<span class="rl-state-scope">' + esc((O.tenantById[L.tenant] || {}).name) +
      (netKey ? ' · ' + esc(R.netName(netKey)) : '') + ' · ' + U.prettyDate(L.cycle) + '</span></div>' +
      '<ul class="rl-state-list">' + state.map(function (s) {
        var showNet = s.networked ? '' : '<span class="rl-state-acq" title="Acquirer-level — no network dimension">acquirer</span>';
        return '<li class="rls-' + s.status + '">' + icon(ICON[s.status] || 'circle', 15) +
          '<span class="rls-label">' + esc(s.label) + showNet + '</span>' +
          '<span class="rls-at num">' + esc(s.at) + '</span>' +
          (s.runId ? '<a class="rls-link" data-route="' + runRoute(s.runId) + '" title="Open ' + esc(s.runId) + '">' + icon('arrow-right', 13) + '</a>' : '') +
          (s.note ? '<span class="rls-note">' + esc(s.note) + '</span>' : '') +
          '</li>';
      }).join('') + '</ul></div>';

    /* ---- 4 · Live guard results ------------------------------------------ */
    var checks = R.preflight(L.op, L.tenant, netKey, L.cycle);
    var blocks = R.blockingChecks(checks);
    var warns = R.warnChecks(checks);
    var passed = checks.filter(function (c) { return c.status === 'pass'; }).length;

    var guardBlock = '<div class="rl-guards' + (blocks.length ? ' blocking' : '') + '">' +
      (blocks.length
        ? blocks.map(function (c) {
          return '<div class="rl-guard block">' + icon('shield-alert', 18) +
            '<div><strong>' + esc(c.label) + '</strong><div>' + esc(c.message) + '</div>' +
            (c.key === 'leglock' && (L.op === 'CLEARING_STAGE' || L.op === 'CLEARING_GENERATE')
              ? '<div class="rl-guard-extra">Running it again would send a duplicate file to ' + esc(R.netName(netKey) || 'the network') + '.</div>' : '') +
            '</div></div>';
        }).join('')
        : '<div class="rl-guard ok">' + icon('shield-check', 18) +
        '<div><strong>All checks passed</strong><div><span class="num">' + passed + '</span> of <span class="num">' + checks.length + '</span> pre-flight checks passed — nothing is blocking this run.</div></div></div>') +
      warns.map(function (c) {
        return '<div class="rl-guard warn">' + icon('alert-triangle', 18) +
          '<div><strong>' + esc(c.label) + '</strong><div>' + esc(c.message) + ' This is a warning — it does not block the run.</div></div></div>';
      }).join('') +
      '<details class="rl-allchecks"><summary>All ' + checks.length + ' pre-flight checks</summary>' +
      '<ul class="run-check-list">' + checks.map(function (c) {
        var ic = { pass: 'check', warn: 'alert-triangle', block: 'shield-alert', skip: 'minus' }[c.status] || 'circle';
        return '<li class="rc-' + c.status + '">' + icon(ic, 15) +
          '<span class="rc-label">' + esc(c.label) + '</span><span class="rc-msg">' + esc(c.message) + '</span></li>';
      }).join('') + '</ul></details>' +
      '</div>';

    return {
      html: '<div class="rl-body">' +
        '<div class="rl-sec-label">What do you want to run?</div>' + ops +
        '<div class="rl-fields">' + tenantSel + networkSel + cycleSel + '</div>' +
        stateBlock + guardBlock +
        '</div>',
      blocked: blocks.length > 0,
      blockReason: blocks.length ? blocks[0].message : null
    };
  }

  function paintLauncher() {
    var L = launcherState();
    if (!L) return;
    var body = launcherBody();
    var foot = '<div class="rl-foot">' +
      (body.blocked ? '<div class="rl-foot-reason">' + icon('shield-alert', 15) + esc(body.blockReason) + '</div>' : '') +
      '<div class="rl-foot-btns">' +
      '<button class="btn btn-secondary" data-action="run-launch-close">Cancel</button>' +
      '<button class="btn btn-primary" data-action="run-launch-start"' + (body.blocked ? ' disabled title="' + esc(body.blockReason) + '"' : '') + '>' +
      icon('play', 16) + 'Start run</button>' +
      (body.blocked ? '<button class="btn btn-secondary" data-action="run-launch-blocked">Record the attempt anyway</button>' : '') +
      '</div></div>';

    el('overlay-mount').innerHTML = kit.sidePanel({
      eyebrow: 'Run launcher',
      name: 'Start a run',
      body: '<div class="meta rl-intro">Four choices, no script. Pick the operation by name — there is no direction flag to get wrong — and check the current state before you start.</div>' + body.html,
      foot: foot,
      close: 'run-launch-close',
      cls: 'rl-panel',
      wide: true
    });
    paintIcons();
  }

  /* =======================================================================
     7.4 · OVERRIDE REQUEST FORM
     ======================================================================= */
  var MIN_REASON = 40;
  function paintOverrideForm() {
    var ov = S.runs.override;
    if (!ov) return;
    var run = R.byId[ov.runId];
    if (!run) { S.runs.override = null; return; }
    var len = (ov.reason || '').trim().length;
    var ok = len >= MIN_REASON;
    el('overlay-mount').innerHTML =
      '<div class="overlay" data-action="run-ovr-cancel"><div class="modal run-ovr-modal">' +
      '<div class="modal-head"><div class="section-title">Request an override</div>' +
      '<button class="icon-btn" data-action="run-ovr-cancel" aria-label="Close">' + icon('x', 16) + '</button></div>' +
      '<div class="stack">' +
      '<div class="callout danger">' + icon('alert-octagon', 20) +
      '<div class="callout-body"><strong>What will happen if this is approved</strong>' +
      '<div style="margin-top:4px">' + esc(R.consequenceOf(run)) + '</div></div></div>' +
      '<dl class="def-list">' +
      '<dt>Run</dt><dd class="mono">' + esc(run.runId) + '</dd>' +
      '<dt>Blocked by</dt><dd>' + esc(
        (run.rca && run.rca.known) ? E.get(run.rca.code).title
          : ((run.rca && run.rca.values.blockLabel) || 'A pre-flight check')) + '</dd>' +
      '<dt>Requested by</dt><dd class="mono">' + esc(actingUser()) + '</dd>' +
      '</dl>' +
      '<label class="field">Why does this need to run anyway? <span class="req">*</span>' +
      '<textarea class="input" data-action="run-i-ovr" placeholder="Explain what makes this safe, who you confirmed it with, and what happens if it does not run.">' + esc(ov.reason || '') + '</textarea>' +
      '<span class="rl-counter' + (ok ? ' ok' : '') + '"><span class="num">' + len + '</span> / ' + MIN_REASON + ' characters minimum</span></label>' +
      (ov.error ? '<div class="callout warn">' + icon('alert-triangle', 18) + '<div class="callout-body">' + esc(ov.error) + '</div></div>' : '') +
      '<div class="callout info">' + icon('users', 18) + '<div class="callout-body">A second person has to approve this. You cannot approve your own request.</div></div>' +
      '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px">' +
      '<button class="btn btn-secondary" data-action="run-ovr-cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="run-ovr-submit"' + (ok ? '' : ' disabled') + '>' + icon('send', 16) + 'Send for approval</button>' +
      '</div></div></div></div>';
    paintIcons();
  }

  /* ---- the "contact the network" note template (Part 8.3) ------------------ */
  function contactTemplate(anom) {
    var a = anom.runs[0], b = anom.runs[anom.runs.length - 1];
    return [
      'Subject: Duplicate clearing file — ' + anom.tenantName + ' · ' + anom.networkName + ' · cycle ' + U.prettyDate(anom.cycleDate),
      '',
      'Two clearing files were staged for the same cycle. Please void the second.',
      '',
      'Cycle:        ' + U.prettyDate(anom.cycleDate),
      'Acquirer:     ' + anom.tenantName,
      'Network:      ' + anom.networkName,
      '',
      'KEEP — first file',
      '  Run:        ' + a.runId,
      '  Staged:     ' + a.finishedAt,
      '  File:       ' + a.inputFile.name,
      '  Checksum:   ' + a.inputFile.checksum,
      '  Source:     ' + a.inputFile.source,
      '  Records:    ' + R.nfmt(a.recordCounts.read),
      '',
      'VOID — second file',
      '  Run:        ' + b.runId,
      '  Staged:     ' + b.finishedAt,
      '  File:       ' + b.inputFile.name,
      '  Checksum:   ' + b.inputFile.checksum,
      '  Source:     ' + b.inputFile.source,
      '  Records:    ' + R.nfmt(b.recordCounts.read),
      '',
      R.assessment(anom),
      '',
      'Raised from the Juspay Ops Portal by ' + actingUser() + '.'
    ].join('\n');
  }

  function paintModal() {
    var m = S.runs.modal;
    if (!m) { el('overlay-mount').innerHTML = ''; return; }
    if (m.kind === 'contact') {
      var anom = R.anomalyByKey(m.key);
      if (!anom) { S.runs.modal = null; return; }
      var text = contactTemplate(anom);
      el('overlay-mount').innerHTML =
        '<div class="overlay" data-action="run-modal-close"><div class="modal wide run-note-modal">' +
        '<div class="modal-head"><div class="section-title">Note to ' + esc(anom.networkName) + '</div>' +
        '<button class="icon-btn" data-action="run-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
        '<div class="stack">' +
        '<div class="meta">Pre-filled with both run IDs, both timestamps and both file identifiers. Copy it into the channel you normally use — the dashboard does not send mail.</div>' +
        '<pre class="mono run-note">' + esc(text) + '</pre>' +
        '<div class="row" style="justify-content:flex-end;gap:10px">' +
        '<button class="btn btn-secondary" data-action="run-modal-close">Close</button>' +
        '<button class="btn btn-primary" data-action="run-note-copy" data-key="' + esc(m.key) + '">' + icon('copy', 16) + 'Copy the note</button>' +
        '</div></div></div></div>';
    } else if (m.kind === 'void') {
      var run = R.byId[m.runId];
      if (!run) { S.runs.modal = null; return; }
      var len = (m.note || '').trim().length;
      el('overlay-mount').innerHTML =
        '<div class="overlay" data-action="run-modal-close"><div class="modal">' +
        '<div class="modal-head"><div class="section-title">Mark ' + esc(run.runId) + ' as void</div>' +
        '<button class="icon-btn" data-action="run-modal-close" aria-label="Close">' + icon('x', 16) + '</button></div>' +
        '<div class="stack">' +
        '<div class="callout warn">' + icon('ban', 20) + '<div class="callout-body">The run stays in the audit trail permanently. It is tagged <strong>Voided</strong> and excluded from settlement expectations.</div></div>' +
        '<dl class="def-list"><dt>Run</dt><dd class="mono">' + esc(run.runId) + '</dd>' +
        '<dt>Staged</dt><dd class="num">' + esc(run.finishedAt) + '</dd>' +
        '<dt>File</dt><dd class="mono">' + esc(run.inputFile.name) + '</dd></dl>' +
        '<label class="field">Why is this being voided? <span class="req">*</span>' +
        '<textarea class="input" data-action="run-i-void" placeholder="e.g. Visa confirmed the second file was rejected downstream and will not settle; keeping the 22:04 file only.">' + esc(m.note || '') + '</textarea></label>' +
        '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px">' +
        '<button class="btn btn-secondary" data-action="run-modal-close">Cancel</button>' +
        '<button class="btn btn-primary" data-action="run-void-confirm" data-id="' + esc(run.runId) + '"' + (len >= 10 ? '' : ' disabled') + '>' + icon('check', 16) + 'Mark void</button>' +
        '</div></div></div></div>';
    }
    paintIcons();
  }

  /* =======================================================================
     ROUTING
     ======================================================================= */
  function render() {
    var seg = (location.hash.split('?')[0] || '').replace(/^#\/?/, '').split('/').filter(Boolean).slice(3);
    if (!seg.length) return viewList();
    if (seg[0] === 'duplicate') return viewDuplicate(seg[1], seg[2], seg[3]);
    return viewDetail(seg[0]);
  }

  function route(rest) {
    // Deep links: ?runStatus=failed, ?runTenant=…, ?runCycle=…
    var qy = S.query || {};
    if (qy.runStatus) S.runs.status = qy.runStatus;
    if (qy.runTenant) S.runs.tenant = qy.runTenant;
    if (qy.runType) S.runs.type = qy.runType;
    if (qy.runNetwork) S.runs.network = qy.runNetwork;
    if (qy.runRange) S.runs.dateMode = qy.runRange;
    if (qy.runCycle) { S.runs.dateMode = '30'; S.runs.cycleDate = qy.runCycle; }
    if (!rest.length) return viewList();
    if (rest[0] === 'duplicate') return viewDuplicate(rest[1], rest[2], rest[3]);
    return viewDetail(rest[0]);
  }

  function closeOverlay() { el('overlay-mount').innerHTML = ''; }

  function openOverride(runId) {
    S.runs.override = { runId: runId, reason: '', error: null };
    paintOverrideForm();
  }
  /* The Cycle Snapshot's "Run this leg" opens the same launcher, pre-selected. */
  function launcherFor(op, tenantId, netKey, cycleDate) {
    S.runs.launcher = { open: true, op: op, tenant: tenantId, network: netKey, cycle: cycleDate, returnTo: location.hash };
    paintLauncher();
  }

  /* =======================================================================
     ACTIONS
     ======================================================================= */
  var ACTIONS = {
    /* ---- list filters ---------------------------------------------------- */
    'run-c-tenant': function (t) { S.runs.tenant = t.value; viewList(); },
    'run-c-network': function (t) { S.runs.network = t.value; viewList(); },
    'run-c-type': function (t) { S.runs.type = t.value; viewList(); },
    'run-c-status': function (t) { S.runs.status = t.value; viewList(); },
    'run-c-preset': function (t) { S.runs.dateMode = t.value; viewList(); },
    'run-c-date': function (t) { S.runs.date = clampDate(t.value || TODAY); S.runs.dateMode = 'date'; viewList(); },
    'run-c-from': function (t) { S.runs.from = clampDate(t.value || S.runs.from); S.runs.dateMode = 'range'; viewList(); },
    'run-c-to': function (t) { S.runs.to = clampDate(t.value || S.runs.to); S.runs.dateMode = 'range'; viewList(); },
    'run-c-role': function (t) { S.runs.role = t.value; viewList(); },
    'run-i-q': function (t) {
      S.runs.q = t.value; viewList();
      var i = el('view').querySelector('[data-action="run-i-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'run-kpi': function (t) {
      var s = t.getAttribute('data-status');
      S.runs.status = (S.runs.status === s) ? 'all' : s;
      viewList();
    },
    'run-chip': function (t) {
      var k = t.getAttribute('data-chip');
      if (k === 'q') S.runs.q = '';
      else if (k === 'cycleDate') S.runs.cycleDate = null;
      else S.runs[k] = 'all';
      viewList();
    },
    'run-clear': function () {
      S.runs.q = ''; S.runs.tenant = 'all'; S.runs.network = 'all';
      S.runs.type = 'all'; S.runs.status = 'all'; S.runs.cycleDate = null; S.runs.dateMode = '30';
      viewList();
    },
    'run-refresh': function () { viewList(); toast('Refreshed', 'success'); },

    /* ---- run detail ------------------------------------------------------ */
    'run-log-toggle': function () { S.runs.logOpen = !S.runs.logOpen; render(); },
    'run-checks-toggle': function () { S.runs.checksOpen = !S.runs.checksOpen; render(); },
    'run-copy-path': function (t) {
      var p = t.getAttribute('data-path');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () { toast('S3 path copied', 'success'); }, function () { toast('Could not reach the clipboard', 'info'); });
          return;
        }
      } catch (e) { /* fall through */ }
      toast('Could not reach the clipboard', 'info');
    },

    /* ---- the launcher ---------------------------------------------------- */
    'run-launch-open': function () {
      S.runs.launcher = { open: true, op: 'CLEARING_STAGE', tenant: O.tenants[0].id, network: null, cycle: R.CYCLE_TODAY, returnTo: location.hash };
      paintLauncher();
    },
    'run-launch-close': function () { S.runs.launcher = null; closeOverlay(); },
    'run-c-op': function (t) { S.runs.launcher.op = t.value; paintLauncher(); },
    'run-c-ltenant': function (t) { S.runs.launcher.tenant = t.value; S.runs.launcher.network = null; paintLauncher(); },
    'run-c-lnetwork': function (t) { S.runs.launcher.network = t.value; paintLauncher(); },
    'run-c-lcycle': function (t) {
      var v = t.value || R.CYCLE_TODAY;
      S.runs.launcher.cycle = v < MIN_DATE ? MIN_DATE : (v > R.CYCLE_TODAY ? R.CYCLE_TODAY : v);
      paintLauncher();
    },
    'run-launch-start': function () {
      var L = launcherState();
      var def = R.typeById[L.op];
      var run = R.startRun(L.op, L.tenant, def.networked ? L.network : null, L.cycle, actingUser());
      S.runs.launcher = null; closeOverlay();
      if (!run) return;
      if (run.status === 'blocked') toast('A guard blocked this run — the attempt is recorded as ' + run.runId, 'info');
      else toast(def.opLabel + ' started — ' + run.runId + ' succeeded', 'success');
      go(runRoute(run.runId));
    },
    /* A blocked attempt is still a signal worth keeping (Part 7.2), so the
       operator can record it deliberately rather than the panel swallowing it. */
    'run-launch-blocked': function () {
      var L = launcherState();
      var def = R.typeById[L.op];
      var run = R.startRun(L.op, L.tenant, def.networked ? L.network : null, L.cycle, actingUser());
      S.runs.launcher = null; closeOverlay();
      if (!run) return;
      toast('Attempt recorded as blocked — ' + run.runId, 'info');
      go(runRoute(run.runId));
    },

    /* ---- overrides ------------------------------------------------------- */
    'run-i-ovr': function (t) {
      if (!S.runs.override) return;
      S.runs.override.reason = t.value;
      // Re-render only the counter and the submit button so the textarea keeps
      // focus and the caret stays where the user left it. If either node cannot
      // be reached, fall back to a full repaint — a stale "disabled" submit
      // button on a valid reason is a dead end, and losing the caret is the
      // lesser failure.
      var mount = el('overlay-mount');
      var c = mount.querySelector('.rl-counter');
      var btn = mount.querySelector('[data-action="run-ovr-submit"]');
      var len = String(t.value || '').trim().length;
      if (!c || !btn) { paintOverrideForm(); return; }
      c.className = 'rl-counter' + (len >= MIN_REASON ? ' ok' : '');
      c.innerHTML = '<span class="num">' + len + '</span> / ' + MIN_REASON + ' characters minimum';
      if (len >= MIN_REASON) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', 'disabled');
    },
    'run-ovr-cancel': function () { S.runs.override = null; closeOverlay(); },
    'run-ovr-submit': function () {
      var ov = S.runs.override;
      if (!ov) return;
      var reason = String(ov.reason || '').trim();
      if (reason.length < MIN_REASON) { ov.error = 'A reason of at least ' + MIN_REASON + ' characters is required.'; paintOverrideForm(); return; }
      var made = R.requestOverride(ov.runId, reason, actingUser());
      S.runs.override = null; closeOverlay();
      toast('Override ' + made.id + ' sent for approval — it needs a second approver', 'success');
      render();
    },
    'run-ovr-approve': function (t) {
      var res = R.approveOverride(t.getAttribute('data-id'), actingUser());
      if (res && res.error) { toast(res.error, 'info'); return; }
      toast('Override approved — the run is tagged Overridden permanently', 'success');
      render();
    },
    'run-ovr-reject': function (t) {
      var res = R.rejectOverride(t.getAttribute('data-id'), actingUser());
      if (res && res.error) { toast(res.error, 'info'); return; }
      toast('Override rejected', 'success');
      render();
    },

    /* ---- duplicate remediation ------------------------------------------- */
    'run-dup-contact': function (t) { S.runs.modal = { kind: 'contact', key: t.getAttribute('data-key') }; paintModal(); },
    'run-note-copy': function (t) {
      var anom = R.anomalyByKey(t.getAttribute('data-key'));
      if (!anom) return;
      var text = contactTemplate(anom);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('Note copied', 'success'); }, function () { toast('Could not reach the clipboard — select the text above instead.', 'info'); });
          return;
        }
      } catch (e) { /* fall through */ }
      toast('Could not reach the clipboard — select the text above instead.', 'info');
    },
    'run-dup-void': function (t) { S.runs.modal = { kind: 'void', runId: t.getAttribute('data-id'), note: '' }; paintModal(); },
    'run-i-void': function (t) {
      if (!S.runs.modal) return;
      S.runs.modal.note = t.value;
      var btn = el('overlay-mount').querySelector('[data-action="run-void-confirm"]');
      if (!btn) { paintModal(); return; }
      if (String(t.value || '').trim().length >= 10) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', 'disabled');
    },
    'run-void-confirm': function (t) {
      var m = S.runs.modal;
      var note = m && String(m.note || '').trim();
      if (!note || note.length < 10) { toast('A note is required to void a run', 'info'); return; }
      R.voidRun(t.getAttribute('data-id'), note);
      S.runs.modal = null; closeOverlay();
      toast('Run marked void — tagged Voided and excluded from settlement expectations', 'success');
      render();
    },
    'run-modal-close': function () { S.runs.modal = null; closeOverlay(); }
  };

  var api = { route: route, render: render, actions: ACTIONS, openOverride: openOverride, launcherFor: launcherFor, ROUTE: ROUTE };
  window.RUNSUI = api;
  return api;
};
