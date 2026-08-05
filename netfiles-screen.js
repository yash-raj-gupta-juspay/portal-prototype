/* =============================================================================
   Juspay Ops Portal — Network Files: Outgoing + Incoming (refinement Part 5)

   Two sub-sections, one language. They share the table shape, the file block,
   the instruction block and — most importantly — the step list, which is the
   same pattern Acquirer Reports already uses for its file detail. Three
   sections, one way of describing what happened to a file.

   NO KPI CARDS (Part 5.6). A row of counts above a list of the same rows is
   redundant; the table is the information.

   NOTHING HERE RUNS OR WATCHES A SCRIPT (Part 5.6). The action buttons record
   an operator's own declaration that they have started, which is what makes a
   duplicate visible to the next person — not an instruction to a machine.

   window.NetFilesUI(kit) → { route, actions }
   ============================================================================= */
window.NetFilesUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, K = window.NETFILES, FH = window.FailureHints;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, setView = kit.setView, el = kit.el,
    go = kit.go, toast = kit.toast, num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag,
    emptyState = kit.emptyState, cardBox = kit.cardBox, cycleIdCell = kit.cycleIdCell,
    immutableTimeline = kit.immutableTimeline;

  var BASE = '#/dashboard/ops/network-files';
  var ROUTE = { outgoing: BASE + '/outgoing', incoming: BASE + '/incoming' };
  var TITLE = { outgoing: 'Outgoing', incoming: 'Incoming' };
  var MIN_DATE = K.DATES[0], MAX_DATE = K.DATES[K.DATES.length - 1];

  /* In memory only. Default state filter is "anything still open" — the
     operator's working set is what needs something from somebody. */
  S.netfiles = {
    outgoing: { q: '', tenant: 'all', network: 'all', state: 'open', dateMode: '7', date: K.CYCLE_TODAY, from: U.addDays(K.CYCLE_TODAY, -6), to: K.CYCLE_TODAY },
    incoming: { q: '', tenant: 'all', network: 'all', state: 'open', dateMode: '7', date: K.CYCLE_TODAY, from: U.addDays(K.CYCLE_TODAY, -6), to: K.CYCLE_TODAY },
    dir: 'outgoing',
    override: null,     // { reason } while the stage-again / download-again form is open
    proofUpload: false, proofName: null
  };
  function F(dir) { return S.netfiles[dir]; }
  function STATES(dir) { return dir === 'incoming' ? K.IN_STATES : K.OUT_STATES; }
  function KEYS(dir) { return dir === 'incoming' ? K.IN_KEYS : K.OUT_KEYS; }

  function range(dir) {
    var f = F(dir);
    if (f.dateMode === 'date') return { from: f.date, to: f.date, label: U.prettyDate(f.date) };
    if (f.dateMode === 'range') return { from: f.from, to: f.to, label: U.prettyDate(f.from) + ' – ' + U.prettyDate(f.to) };
    if (f.dateMode === 'all') return { from: MIN_DATE, to: MAX_DATE, label: 'Last ' + K.WINDOW + ' cycles' };
    var days = parseInt(f.dateMode, 10) || 7;
    return { from: U.addDays(K.CYCLE_TODAY, -(days - 1)), to: K.CYCLE_TODAY, label: 'Last ' + days + ' cycles' };
  }
  function clampDate(d) { return d < MIN_DATE ? MIN_DATE : (d > MAX_DATE ? MAX_DATE : d); }

  function statePill(rec) {
    var s = STATES(rec.dir)[rec.state];
    return pill(s.label, s.kind, s.icon);
  }
  /* The network badge reuses the Rejects vocabulary rather than tinting with
     the raw network colour — Mastercard yellow on white is 1.9:1 and unreadable
     as text. */
  var NET_CLASS = { visa: 'visa', mc: 'mc', rupay: 'rupay' };
  function netBadge(rec) {
    var net = O.NET_BY_KEY[rec.networkKey];
    return '<span class="rej-net ' + (NET_CLASS[rec.networkKey] || 'mc') + '">' + esc(net.name) + '</span>';
  }
  function initials(email) {
    var n = String(email || '').split('@')[0].split(/[._-]/).filter(Boolean);
    return (n.map(function (p) { return p[0]; }).join('').slice(0, 3) || '—').toUpperCase();
  }
  function dash() { return '<span class="nf-empty">—</span>'; }
  /* The list carries three timestamps per row. In full ("20 Nov 2025, 21:46
     IST") they push the table into a horizontal scroll and the operator loses
     the right-hand column. The year and the zone are constant across every row,
     so they are dropped here and kept in full on the detail view. */
  function shortStamp(at) {
    if (!at) return dash();
    var p = String(at).split(', ');
    return esc(p[0].replace(/ \d{4}$/, '') + ' ' + (p[1] || '').replace(' IST', ''));
  }

  /* =======================================================================
     LIST VIEW
     ======================================================================= */
  function filters(dir) {
    var f = F(dir);
    var tenantOpts = [['all', 'All tenants']].concat(O.tenants.map(function (t) { return [t.id, t.name]; }));
    var netKeys = {};
    O.tenants.forEach(function (t) { K.netsFor(t.id).forEach(function (n) { netKeys[n.key] = n.name; }); });
    var netOpts = [['all', 'All networks']].concat(Object.keys(netKeys).map(function (k) { return [k, netKeys[k]]; }));
    var ST = STATES(dir);
    var stateOpts = [['open', 'Needs attention'], ['all', 'Any state']]
      .concat(KEYS(dir).map(function (k) { return [k, ST[k].label]; }));
    var onDate = f.dateMode === 'date', onRange = f.dateMode === 'range';
    return kit.opsFilterRow({
      search: { placeholder: 'Search cycle or file name', action: 'nf-i-q', value: f.q || '' },
      filters: [
        { action: 'nf-tenant', value: f.tenant, label: 'Tenant', options: tenantOpts },
        { action: 'nf-network', value: f.network, label: 'Network', options: netOpts },
        { action: 'nf-state', value: f.state, label: 'State', options: stateOpts }
      ],
      preset: {
        action: 'nf-preset', value: f.dateMode,
        options: [['1', 'Current cycle'], ['7', 'Last 7 cycles'], ['30', 'Last 30 cycles'], ['date', 'Specific cycle date'], ['range', 'Custom range']]
      },
      dateRange: (onDate
        ? '<input type="date" data-action="nf-date" value="' + f.date + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="Cycle date" />'
        : (onRange
          ? '<input type="date" data-action="nf-from" value="' + f.from + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="From" />' +
          '<span class="meta">–</span>' +
          '<input type="date" data-action="nf-to" value="' + f.to + '" min="' + MIN_DATE + '" max="' + MAX_DATE + '" aria-label="To" />'
          : '<span>' + esc(U.prettyDate(range(dir).from) + ' – ' + U.prettyDate(range(dir).to)) + '</span>')) + icon('chevron-down', 16),
      refresh: 'nf-refresh'
    });
  }

  function visible(dir) {
    var f = F(dir), rg = range(dir), q = (f.q || '').toLowerCase();
    var ST = STATES(dir);
    return K.rowsForRange(dir, rg.from, rg.to).filter(function (rec) {
      if (f.tenant !== 'all' && rec.tenantId !== f.tenant) return false;
      if (f.network !== 'all' && rec.networkKey !== f.network) return false;
      if (f.state === 'open') { if (!ST[rec.state].open) return false; }
      else if (f.state !== 'all' && rec.state !== f.state) return false;
      if (q) {
        var hay = (rec.id + ' ' + (rec.file ? rec.file.name : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // Anything wrong first, then anything waiting on a person, then the rest.
      return rank(a) - rank(b) ||
        (a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : (a.networkKey < b.networkKey ? -1 : 1));
    });
    function rank(rec) { return K.isAttention(rec) ? 0 : (K.needsOperator(rec) ? 1 : 2); }
  }

  function rowClass(rec) {
    if (K.isAttention(rec)) return 'nf-row-bad';
    if (K.needsOperator(rec)) return 'nf-row-act';
    return '';
  }

  function outTable(rows) {
    var body = rows.map(function (rec) {
      return '<tr class="clickable ' + rowClass(rec) + '" data-route="' + ROUTE.outgoing + '/' + esc(rec.id) + '">' +
        '<td>' + cycleIdCell(rec.id, rec.date) + '</td>' +
        '<td class="nf-who-col">' + tenantTag(rec.tenantId) + '<div class="cell-sub">' + netBadge(rec) + '</div></td>' +
        '<td class="nf-file-col">' + (rec.file
          ? '<span class="mono nf-filename" title="' + esc(rec.file.name) + '">' + esc(rec.file.name) + '</span>' +
          (rec.regenerated ? '<div class="cell-sub">' + regenTag() + '</div>' : '') +
          (rec.overrideReason ? '<div class="cell-sub">' + dupTag() + '</div>' : '')
          : dash()) + '</td>' +
        '<td>' + statePill(rec) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.file ? rec.file.generatedAt : '') + '">' +
        (rec.file ? shortStamp(rec.file.generatedAt) : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.stagedAt ? rec.stagedAt + ' · ' + rec.startedBy : (rec.startedAt ? 'started ' + rec.startedAt + ' · ' + rec.startedBy : '')) + '">' +
        (rec.stagedAt || rec.startedAt
          ? shortStamp(rec.stagedAt || rec.startedAt) + ' <span class="nf-by">' + esc(initials(rec.startedBy)) + '</span>'
          : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.proofAt || '') + '">' + (rec.proofAt ? shortStamp(rec.proofAt) : dash()) + '</td>' +
        '<td class="nf-go">' + icon('chevron-right', 16) + '</td></tr>';
    }).join('');
    return '<div class="table-card"><div class="table-wrap"><table class="data nf-table"><thead><tr>' +
      '<th>Cycle</th><th class="nf-who-col">Tenant / Network</th><th>File</th><th>State</th>' +
      '<th>Generated</th><th>Staged</th><th>Proof received</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function inTable(rows) {
    var body = rows.map(function (rec) {
      return '<tr class="clickable ' + rowClass(rec) + '" data-route="' + ROUTE.incoming + '/' + esc(rec.id) + '">' +
        '<td>' + cycleIdCell(rec.id, rec.date) + '</td>' +
        '<td class="nf-who-col">' + tenantTag(rec.tenantId) + '<div class="cell-sub">' + netBadge(rec) + '</div></td>' +
        '<td class="nf-file-col">' + (rec.file
          ? '<span class="mono nf-filename" title="' + esc(rec.file.name) + '">' + esc(rec.file.name) + '</span>' +
          (rec.cycles > 1 ? '<div class="cell-sub"><span class="num">' + rec.cycles + '</span> incoming cycles</div>' : '') +
          (rec.overrideReason ? '<div class="cell-sub">' + dupTag() + '</div>' : '')
          : dash()) + '</td>' +
        '<td>' + statePill(rec) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.startedAt ? rec.startedAt + ' · ' + rec.startedBy : '') + '">' +
        (rec.downloadedAt || rec.startedAt
          ? shortStamp(rec.downloadedAt || rec.startedAt) + ' <span class="nf-by">' + esc(initials(rec.startedBy)) + '</span>'
          : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.parsedAt || '') + '">' + (rec.parsedAt ? shortStamp(rec.parsedAt) : dash()) + '</td>' +
        '<td class="nowrap cell-sub num" title="' + esc(rec.reconciledAt || '') + '">' + (rec.reconciledAt ? shortStamp(rec.reconciledAt) : dash()) + '</td>' +
        '<td class="nf-go">' + icon('chevron-right', 16) + '</td></tr>';
    }).join('');
    return '<div class="table-card"><div class="table-wrap"><table class="data nf-table"><thead><tr>' +
      '<th>Cycle</th><th class="nf-who-col">Tenant / Network</th><th>File</th><th>State</th>' +
      '<th>Downloaded</th><th>Parsed</th><th>Reconciled</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function table(dir, rows) {
    if (!rows.length) {
      return '<div class="card">' + emptyState('arrow-left-right', 'No ' + TITLE[dir].toLowerCase() + ' cycles in this view',
        'Widen the cycle range, or clear the tenant, network and state filters.',
        '<button class="btn btn-secondary" data-action="nf-clear">' + icon('rotate-ccw', 18) + 'Clear filters</button>') + '</div>';
    }
    return dir === 'incoming' ? inTable(rows) : outTable(rows);
  }

  function regenTag() {
    return '<span class="nf-tag" title="This cycle was regenerated. The tag is permanent.">' +
      icon('rotate-ccw', 11) + 'Regenerated</span>';
  }
  function dupTag() {
    return '<span class="nf-tag danger" title="This cycle was run a second time while already underway. The tag is permanent.">' +
      icon('copy', 11) + 'Run twice</span>';
  }

  /* Sub-section switch. Outgoing and Incoming are genuinely different
     workflows, so they are two screens — this is how you move between them
     without going back to the nav. */
  function dirTabs(dir) {
    return '<div class="tabs nf-tabs">' +
      ['outgoing', 'incoming'].map(function (d) {
        var open = K.rowsForRange(d, U.addDays(K.CYCLE_TODAY, -6), K.CYCLE_TODAY)
          .filter(function (rec) { return STATES(d)[rec.state].open; }).length;
        return '<button class="tab' + (dir === d ? ' active' : '') + '" data-route="' + ROUTE[d] + '">' +
          icon(d === 'outgoing' ? 'upload' : 'download', 15) + TITLE[d] +
          '<span class="count num">' + open + '</span></button>';
      }).join('') + '</div>';
  }

  var SUB = {
    outgoing: 'Clearing files staged to card networks. The file is generated here; the staging script runs in RDP.',
    incoming: 'Files fetched from card networks. The download script runs in RDP; parsing and reconciliation follow here.'
  };

  function renderList(dir) {
    S.netfiles.dir = dir;
    var rows = visible(dir);
    var rg = range(dir);
    setView(
      kit.pageHead('Network Files · ' + TITLE[dir], SUB[dir]) +
      dirTabs(dir) +
      filters(dir) +
      '<div class="sf-scope meta">Showing <strong>' + rows.length + '</strong> cycle' + (rows.length === 1 ? '' : 's') +
      ' · ' + esc(rg.label) +
      (F(dir).state === 'open' ? ' · settled cycles hidden' : '') + '</div>' +
      table(dir, rows)
    );
  }

  /* =======================================================================
     THE STEP LIST (Part 5.3 / 5.5)
     The same pattern Acquirer Reports uses: icon, name, a meta line of
     status · time · duration, record counts where the pipeline reports them,
     and a failed step expanded inline with its hint, its raw error line and
     wherever the fix lives.
     ======================================================================= */
  var STEP_ICON = { done: 'check-circle', failed: 'x-circle', active: 'circle-dot', todo: 'circle' };
  var STEP_WORD = { done: 'Done', failed: 'Failed', active: 'In progress', todo: 'Not run' };

  function stepMeta(s) {
    var bits = [STEP_WORD[s.state] || s.state];
    if (s.at) bits.push(String(s.at).split(', ')[1] || s.at);
    var dur = K.durLabel(s.seconds);
    if (dur) bits.push(dur);
    return '<div class="fd-step-meta">' + bits.map(function (b, i) {
      return i ? '<span class="num">' + esc(b) + '</span>' : esc(b);
    }).join(' · ') + '</div>';
  }
  function stepCounts(s) {
    if (s.records == null) return '';
    return '<div class="fd-step-counts"><span class="num">' + num(s.records) + '</span> records</div>';
  }
  /* The failure block, identical in shape to the one in the file detail panel:
     a plain-language hint looked up on the code, the raw line the pipeline
     produced, and at most two actions. The hint is never invented — an
     uncatalogued code says so. */
  function failBlock(rec, s) {
    var res = FH.resolve(s.error_code, {
      tenantId: rec.tenantId, networkKey: rec.networkKey, date: rec.date, uuid: rec.id
    });
    var hint = '<div class="fd-fail-hint">' + esc(res.hint) + '</div>';
    var code = (res.state === 'uncatalogued' && s.error_code)
      ? '<div class="fd-fail-code mono">' + esc(s.error_code) + '</div>' : '';
    var detail = s.error_detail
      ? '<div class="fd-fail-detail mono" title="' + esc(s.error_detail) + '">' + esc(s.error_detail) + '</div>' : '';
    var btns = [];
    if (res.action) {
      btns.push('<button type="button" class="btn btn-primary btn-sm" data-route="' + esc(res.action.href) + '">' +
        esc(res.action.label) + '</button>');
    } else if (s.error_code || s.error_detail) {
      btns.push('<button type="button" class="btn btn-secondary btn-sm" data-action="nf-copy-fail" ' +
        'data-id="' + esc(rec.id) + '" data-dir="' + rec.dir + '" data-step="' + esc(s.name) + '">' +
        icon('copy', 15) + 'Copy details</button>');
    }
    return '<div class="fd-fail">' + hint + code + detail +
      (btns.length ? '<div class="fd-fail-actions">' + btns.join('') + '</div>' : '') + '</div>';
  }
  function stepList(rec) {
    return '<div class="fd-timeline nf-steps">' + rec.steps.map(function (s) {
      return '<div class="fd-step ' + esc(s.state) + '">' +
        '<span class="fd-step-icon">' + icon(STEP_ICON[s.state] || 'circle', 18) + '</span>' +
        '<div class="fd-step-body">' +
        '<div class="fd-step-name">' + esc(s.name) + '</div>' +
        stepMeta(s) + stepCounts(s) +
        (s.note ? '<div class="nf-step-note">' + esc(s.note) + '</div>' : '') +
        (s.state === 'failed' ? failBlock(rec, s) : '') +
        '</div></div>';
    }).join('') + '</div>';
  }

  /* =======================================================================
     THE FILE BLOCK
     ======================================================================= */
  function kv(label, value, cls) {
    return '<div class="nf-kv' + (cls ? ' ' + cls : '') + '"><span class="nf-kv-label">' + esc(label) +
      '</span><span class="nf-kv-value">' + value + '</span></div>';
  }
  function fileBlock(rec) {
    var f = rec.file;
    if (!f) {
      return '<div class="card nf-file-block empty">' +
        emptyState(rec.dir === 'incoming' ? 'file-clock' : 'file-plus',
          rec.dir === 'incoming' ? 'Nothing available for this cycle yet' : 'No file for this cycle yet',
          rec.dir === 'incoming'
            ? 'The cycle window is open. When ' + esc(K.inFileName(rec.tenantId, rec.networkKey, rec.date, 1)) +
            ' appears at ' + esc(rec.source) + ', this record moves to Available at network.'
            : 'Generation writes ' + esc(K.outFileName(rec.tenantId, rec.networkKey, rec.date, 1)) +
            ' to the S3 network folder. That file is the only one that should ever be staged for this cycle.') +
        '</div>';
    }
    return '<div class="card nf-file-block">' +
      '<div class="nf-file-name mono">' + esc(f.name) +
      (rec.regenerated ? ' ' + regenTag() : '') + (rec.overrideReason ? ' ' + dupTag() : '') + '</div>' +
      '<div class="nf-file-grid">' +
      kv('Transactions', '<span class="num">' + num(rec.count) + '</span>') +
      kv(rec.dir === 'incoming' ? 'Gross received' : 'Gross value', '<span class="num">' + fmt(rec.value, 2, rec.currency) + '</span>') +
      kv('Size', '<span class="num">' + esc(f.size) + '</span>') +
      kv(rec.dir === 'incoming' ? 'Source' : 'Generated', rec.dir === 'incoming'
        ? esc(rec.source)
        : '<span class="num">' + esc(f.generatedAt) + '</span>') +
      // Checksum and the S3 path get the full width: both are strings the
      // operator compares character by character, and a mid-string wrap in a
      // half-width cell reads as a typo in the value itself.
      kv('Checksum', '<span class="mono">' + esc(f.checksum) + '</span>', 'wide') +
      kv('S3 path', '<span class="mono nf-s3">' + esc(f.path + f.name) + '</span>', 'wide') +
      '</div>' +
      '<div class="nf-file-actions">' +
      '<button class="btn btn-secondary" data-action="nf-download" data-id="' + esc(rec.id) + '" data-dir="' + rec.dir + '">' + icon('download', 16) + 'Download</button>' +
      '<button class="btn btn-secondary" data-action="nf-copy-path" data-id="' + esc(rec.id) + '" data-dir="' + rec.dir + '">' + icon('copy', 16) + 'Copy S3 path</button>' +
      '</div></div>';
  }

  /* =======================================================================
     PART 5.3 / 5.5 — THE INSTRUCTION BLOCK

     The dashboard cannot run the script. What it can do is be the place the
     work starts: the exact path, one click to copy it, and a button that
     records that somebody has begun. That record is the whole mechanism —
     it is what the next person sees.
     ======================================================================= */
  function actionBlock(rec) {
    if (rec.dir === 'outgoing' && rec.state === 'ready') {
      return '<div class="nf-act">' +
        '<div class="nf-act-head">' + icon('file-check', 18) + '<span>Ready to stage</span></div>' +
        '<div class="nf-act-line">The file is in the S3 network folder. Open RDP, run the staging script against ' +
        esc(K.stageTool(rec.networkKey)) + ', and keep the session open until it finishes — the automation halts partway if the session drops.</div>' +
        pathRows(rec, rec.file ? rec.file.name : null, rec.networkPath) +
        '<div class="nf-act-foot">' +
        '<button class="btn btn-primary" data-action="nf-start-stage" data-id="' + esc(rec.id) + '">' +
        'I’ve started staging' + icon('arrow-right', 16) + '</button></div>' +
        '</div>';
    }
    if (rec.dir === 'incoming' && rec.state === 'available') {
      return '<div class="nf-act">' +
        '<div class="nf-act-head">' + icon('download', 18) + '<span>Available at ' + esc(rec.source) + '</span></div>' +
        '<div class="nf-act-line">Open RDP and run the download script. It writes to the backup folder, encrypts if the file is not already encrypted, then places the XML in the network folder — keep the session open until it finishes.</div>' +
        pathRows(rec, rec.file ? rec.file.name : null, rec.backupPath) +
        '<div class="nf-act-foot">' +
        '<button class="btn btn-primary" data-action="nf-start-download" data-id="' + esc(rec.id) + '">' +
        'I’ve started the download' + icon('arrow-right', 16) + '</button></div>' +
        '</div>';
    }
    return startedGuard(rec);
  }
  function pathRows(rec, name, path) {
    return '<div class="nf-act-paths">' +
      (name ? '<div class="nf-act-row"><span class="nf-act-key">File</span>' +
        '<span class="mono nf-act-val">' + esc(name) + '</span><span></span></div>' : '') +
      '<div class="nf-act-row"><span class="nf-act-key">Path</span>' +
      '<span class="mono nf-act-val nf-s3">' + esc(path) + '</span>' +
      '<button class="btn btn-secondary btn-sm" data-action="nf-copy-folder" data-path="' + esc(path) + '">' +
      icon('copy', 14) + 'Copy</button></div>' +
      '</div>';
  }

  /* PART 5.3 — the already-started guard. It REPLACES the instruction block:
     anyone who opens this cycle after somebody began sees that first, before
     they can repeat the work. Running the script again is still possible —
     sometimes it is correct — but it costs a 40-character reason and tags the
     cycle permanently. */
  function startedGuard(rec) {
    var out = rec.dir === 'outgoing';
    var started = out ? !!K.STAGING_STARTED[rec.state] : ['downloading', 'downloaded', 'encrypted', 'in_folder', 'parsed', 'pushed', 'reconciled', 'parse_failed'].indexOf(rec.state) >= 0;
    if (!started || !rec.startedAt) return '';
    var open = !!S.netfiles.override;
    var reason = (S.netfiles.override && S.netfiles.override.reason) || '';
    var ok = reason.trim().length >= 40;
    var verb = out ? 'staged' : 'downloaded';
    return '<div class="callout danger nf-already">' + icon('alert-triangle', 20) +
      '<div class="callout-body">' +
      '<strong>Already being ' + verb + '</strong>' +
      '<div class="nf-already-line">Started ' + esc(rec.startedAt) + ' by ' + esc(rec.startedBy) + '.<br>' +
      'Running the script again would ' + (out ? 'stage a duplicate file to ' + esc(rec.networkName) : 'download this cycle a second time') + '.</div>' +
      (rec.overrideReason
        ? '<div class="nf-already-prev">' + icon('copy', 14) + '<span>Already run a second time on ' + esc(rec.overrideAt) +
        ' by ' + esc(rec.overrideBy) + ' — “' + esc(rec.overrideReason) + '”</span></div>'
        : '') +
      (open
        ? '<div class="nf-override-form">' +
        '<label class="field">Why does this cycle need running again? <span class="req">*</span>' +
        '<textarea class="input" data-action="nf-i-override" placeholder="e.g. The RDP session dropped mid-run and the network confirms nothing was received; re-running with the network desk informed.">' + esc(reason) + '</textarea></label>' +
        '<div class="nf-override-foot">' +
        '<span class="nf-count' + (ok ? ' ok' : '') + '"><span class="num">' + reason.trim().length + '</span> / 40 characters</span>' +
        '<span class="nf-override-btns">' +
        '<button class="btn btn-secondary btn-sm" data-action="nf-override-cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm"' + (ok ? '' : ' disabled') + ' data-action="nf-override-confirm" data-id="' + esc(rec.id) + '" data-dir="' + rec.dir + '">' +
        icon('alert-triangle', 15) + (out ? 'Stage again anyway' : 'Download again anyway') + '</button></span></div>' +
        '<div class="meta nf-override-note">The cycle is tagged <strong>Run twice</strong> permanently, and this reason stays in its history.</div>' +
        '</div>'
        : '<div class="nf-already-act"><button class="btn btn-secondary btn-sm" data-action="nf-override-open">' +
        (out ? 'Stage again anyway' : 'Download again anyway') + '</button></div>') +
      '</div></div>';
  }

  /* The proof block — only ever about a file that did or did not arrive. */
  function proofBlock(rec) {
    if (rec.dir !== 'outgoing') return '';
    if (rec.state === 'proof_overdue') {
      var up = S.netfiles.proofUpload;
      return '<div class="card nf-proof overdue">' +
        '<div class="nf-proof-head">' + icon('alert-triangle', 20) +
        '<span>No staging proof from ' + esc(rec.networkName) + '</span></div>' +
        '<div class="nf-proof-line">Staged ' + esc(rec.stagedAt) + '. A proof file was expected within ' +
        K.PROOF_WINDOW_HOURS + ' hours and none has landed in the network folder. The staging may well have succeeded — ' +
        'nothing here can see ' + esc(K.stageTool(rec.networkKey)) + ', so this says only that no proof file arrived.</div>' +
        (up
          ? '<div class="nf-proof-upload">' +
          '<label class="field">Staging proof file' +
          '<input type="file" class="input" data-action="nf-proof-file" data-id="' + esc(rec.id) + '" /></label>' +
          '<div class="row" style="gap:10px;justify-content:flex-end">' +
          '<button class="btn btn-secondary btn-sm" data-action="nf-proof-cancel">Cancel</button>' +
          '<button class="btn btn-primary btn-sm" data-action="nf-proof-apply" data-id="' + esc(rec.id) + '">' +
          icon('upload', 15) + 'Match this proof</button></div>' +
          '<div class="meta">Matched exactly the same way as an automatically collected proof file.</div></div>'
          : '<div class="nf-proof-act"><button class="btn btn-primary btn-sm" data-action="nf-proof-open">' +
          icon('upload', 15) + 'Upload proof file</button></div>') +
        '</div>';
    }
    if (!rec.proof) return '';
    return '<div class="card nf-proof ok">' +
      '<div class="nf-proof-head">' + icon('check-circle', 20) + '<span>Staging confirmed by ' + esc(rec.networkName) +
      (rec.proof.manual ? ' <span class="nf-manual-tag" title="A human supplied this proof file; the platform did not collect it.">' + icon('hand', 11) + 'proof uploaded manually</span>' : '') + '</span></div>' +
      '<div class="nf-file-grid">' +
      kv('Proof file', '<span class="mono">' + esc(rec.proof.file) + '</span>') +
      kv('Received', '<span class="num">' + esc(rec.proof.receivedAt) + '</span>') +
      kv('Accepted', '<span class="num">' + num(rec.proof.acceptedCount) + ' transactions</span>') +
      '</div></div>';
  }

  /* Incoming closes into Reconciliation — that is where the gross figures are
     compared, and there is no second account of them here. */
  function reconLink(rec) {
    if (rec.dir !== 'incoming') return '';
    if (['pushed', 'reconciled'].indexOf(rec.state) < 0) return '';
    return '<a class="nf-inline-link" data-route="#/dashboard/ops/reconciliation?reconTenant=' + esc(rec.tenantId) +
      '&reconCycle=' + esc(rec.id) + '">' + icon('git-compare', 15) +
      'Reconciliation for this cycle' + icon('arrow-right', 14) + '</a>';
  }

  function historyBlock(rec) {
    if (!rec.events.length) {
      return cardBox('History', '<div class="meta">Nothing has happened to this cycle yet. Every event is appended here — what, when, by whom, and the reason where one was required.</div>');
    }
    return cardBox('History',
      '<div class="meta mb-16">Append-only — what, when, by whom, and the reason where one was required.</div>' +
      immutableTimeline(rec.events.slice().reverse()));
  }

  function renderDetail(dir, id) {
    S.netfiles.dir = dir;
    var rec = K.resolve(dir, id);
    if (!rec) {
      setView('<div class="breadcrumb"><a data-route="' + ROUTE[dir] + '">Network Files · ' + TITLE[dir] + '</a><span class="sep">/</span><span>' + esc(id) + '</span></div>' +
        '<div class="card">' + emptyState('search-x', 'No such cycle',
          'The cycle ' + esc(id) + ' does not exist for any tenant and network in the last ' + K.WINDOW + ' cycles.',
          '<button class="btn btn-secondary" data-route="' + ROUTE[dir] + '">Back to ' + TITLE[dir] + '</button>') + '</div>');
      return;
    }
    var st = STATES(dir)[rec.state];
    setView(
      '<div class="breadcrumb"><a data-route="' + BASE + '">Network Files</a><span class="sep">/</span>' +
      '<a data-route="' + ROUTE[dir] + '">' + TITLE[dir] + '</a><span class="sep">/</span>' +
      '<span class="mono">' + esc(rec.id) + '</span></div>' +
      '<div class="page-head nf-head"><div>' +
      cycleIdCell(rec.id, rec.date, 'lg') +
      '<div class="subtitle nf-sub">' + tenantTag(rec.tenantId) + ' · ' + netBadge(rec) + ' · ' + esc(rec.dow) + '</div>' +
      '</div><div class="head-actions">' + statePill(rec) + '</div></div>' +

      actionBlock(rec) +
      '<div class="nf-detail-grid">' +
      '<div class="card nf-steps-card"><div class="card-title">' +
      (dir === 'incoming' ? 'What happened to this file' : 'What happened to this cycle') + '</div>' +
      stepList(rec) +
      '<div class="nf-doing">' + icon('info', 14) + '<span>' + esc(st.doing || 'Nothing — this cycle is moving on its own.') + '</span></div>' +
      reconLink(rec) +
      '</div>' +
      '<div class="nf-side">' + fileBlock(rec) + proofBlock(rec) + '</div>' +
      '</div>' +
      '<div class="mt-24">' + historyBlock(rec) + '</div>'
    );
  }

  function repaint() {
    var h = location.hash;
    if (h.indexOf('/network-files/outgoing/') >= 0) return renderDetail('outgoing', decodeURIComponent(h.split('/network-files/outgoing/')[1].split('?')[0]));
    if (h.indexOf('/network-files/incoming/') >= 0) return renderDetail('incoming', decodeURIComponent(h.split('/network-files/incoming/')[1].split('?')[0]));
    if (h.indexOf('/network-files/incoming') >= 0) return renderList('incoming');
    if (h.indexOf('/network-files') >= 0) return renderList('outgoing');
  }
  function dirOf() { return S.netfiles.dir || 'outgoing'; }
  function recOf(t) {
    return K.resolve(t.getAttribute('data-dir') || dirOf(), t.getAttribute('data-id'));
  }

  /* =======================================================================
     ACTIONS
     ======================================================================= */
  function copy(text, what) {
    // Clipboard access is not guaranteed in every context; the toast reports
    // what actually happened rather than asserting success.
    var okd = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); okd = true; }
      else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        okd = document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { okd = false; }
    toast(okd ? what + ' copied' : 'Could not copy — select the text and copy it manually', okd ? 'success' : 'info');
  }

  var ACTIONS = {
    /* ---- list filters ---- */
    'nf-tenant': function (t) { F(dirOf()).tenant = t.value; renderList(dirOf()); },
    'nf-network': function (t) { F(dirOf()).network = t.value; renderList(dirOf()); },
    'nf-state': function (t) { F(dirOf()).state = t.value; renderList(dirOf()); },
    'nf-preset': function (t) { F(dirOf()).dateMode = t.value; renderList(dirOf()); },
    'nf-date': function (t) { var f = F(dirOf()); f.date = clampDate(t.value || K.CYCLE_TODAY); f.dateMode = 'date'; renderList(dirOf()); },
    'nf-from': function (t) { var f = F(dirOf()); f.from = clampDate(t.value || MIN_DATE); f.dateMode = 'range'; renderList(dirOf()); },
    'nf-to': function (t) { var f = F(dirOf()); f.to = clampDate(t.value || MAX_DATE); f.dateMode = 'range'; renderList(dirOf()); },
    'nf-refresh': function () { renderList(dirOf()); toast('Refreshed', 'success'); },
    'nf-clear': function () {
      var f = F(dirOf());
      f.q = ''; f.tenant = 'all'; f.network = 'all'; f.state = 'all'; f.dateMode = '30';
      renderList(dirOf());
    },
    'nf-i-q': function (t) {
      F(dirOf()).q = t.value; renderList(dirOf());
      var i = el('view').querySelector('[data-action="nf-i-q"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },

    /* ---- file ---- */
    'nf-download': function (t) {
      var rec = recOf(t); if (!rec || !rec.file) return;
      toast('Downloading ' + rec.file.name, 'success');
    },
    'nf-copy-path': function (t) {
      var rec = recOf(t); if (!rec || !rec.file) return;
      copy(rec.file.path + rec.file.name, 'S3 path');
    },
    'nf-copy-folder': function (t) { copy(t.getAttribute('data-path') || '', 'S3 path'); },
    'nf-copy-fail': function (t) {
      var rec = recOf(t); if (!rec) return;
      var name = t.getAttribute('data-step');
      var s = rec.steps.filter(function (x) { return x.name === name; })[0] || K.failedStep(rec);
      if (!s) return;
      var lines = [rec.id, rec.file ? rec.file.name : '(no file)', 'Step: ' + s.name];
      if (s.error_code) lines.push('Code: ' + s.error_code);
      if (s.error_detail) lines.push(s.error_detail);
      copy(lines.join('\n'), 'Failure details');
    },

    /* ---- the two declarations that make duplicate work visible ---- */
    'nf-start-stage': function (t) {
      var rec = K.resolve('outgoing', t.getAttribute('data-id')); if (!rec) return;
      K.startStaging(rec);
      toast('Recorded as staging started by ' + rec.startedBy, 'success');
      repaint();
    },
    'nf-start-download': function (t) {
      var rec = K.resolve('incoming', t.getAttribute('data-id')); if (!rec) return;
      K.startDownload(rec);
      toast('Recorded as download started by ' + rec.startedBy, 'success');
      repaint();
    },

    /* ---- running it again: 40 characters of reason, a permanent tag ---- */
    'nf-override-open': function () { S.netfiles.override = { reason: '' }; repaint(); },
    'nf-override-cancel': function () { S.netfiles.override = null; repaint(); },
    'nf-i-override': function (t) {
      S.netfiles.override = S.netfiles.override || { reason: '' };
      S.netfiles.override.reason = t.value;
      repaint();
      var i = el('view').querySelector('[data-action="nf-i-override"]');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    },
    'nf-override-confirm': function (t) {
      var dir = t.getAttribute('data-dir') || 'outgoing';
      var rec = K.resolve(dir, t.getAttribute('data-id')); if (!rec) return;
      var reason = (S.netfiles.override && S.netfiles.override.reason || '').trim();
      if (reason.length < 40) { toast('A reason of at least 40 characters is required', 'info'); return; }
      if (dir === 'incoming') K.downloadAgain(rec, reason); else K.stageAgain(rec, reason);
      S.netfiles.override = null;
      toast('Recorded — this cycle is tagged Run twice permanently', 'success');
      repaint();
    },

    /* ---- manual proof upload, when automated pickup missed it ---- */
    'nf-proof-open': function () { S.netfiles.proofUpload = true; repaint(); },
    'nf-proof-cancel': function () { S.netfiles.proofUpload = false; repaint(); },
    'nf-proof-file': function (t) {
      var f = t.files && t.files[0];
      if (f) S.netfiles.proofName = f.name;
    },
    'nf-proof-apply': function (t) {
      var rec = K.resolve('outgoing', t.getAttribute('data-id')); if (!rec) return;
      var name = S.netfiles.proofName || K.proofFileName(rec.networkKey, rec.date);
      K.applyProof(rec, name);
      S.netfiles.proofUpload = false; S.netfiles.proofName = null;
      toast('Matched ' + name + ' — staging confirmed', 'success');
      repaint();
    }
  };

  /* rest[0] is the sub-section, rest[1] the cycle ID. `#/…/network-files`
     with no child lands on Outgoing — the direction a cycle starts in. */
  function route(rest) {
    S.netfiles.override = null;
    S.netfiles.proofUpload = false;
    var dir = (rest && rest[0] === 'incoming') ? 'incoming' : 'outgoing';
    /* Deep links from Ops Home and the Cycle Snapshot arrive pre-filtered
       (Part 2.4) — the filter is applied, then the list renders through it. */
    if (S.query) {
      var f = F(dir);
      if (S.query.nfTenant) f.tenant = S.query.nfTenant;
      if (S.query.nfNetwork) f.network = S.query.nfNetwork;
      if (S.query.nfDate) { f.date = S.query.nfDate; f.dateMode = 'date'; }
      if (S.query.nfState) f.state = S.query.nfState;
    }
    if (rest && rest[1]) return renderDetail(dir, decodeURIComponent(rest[1]));
    renderList(dir);
  }

  return { route: route, renderList: renderList, renderDetail: renderDetail, actions: ACTIONS };
};
