/* =============================================================================
   Juspay Ops Portal — The RCA card (Observability & RCA brief, Part 4)

   ONE component. It renders in six places — the Run Console, the Cycle
   Snapshot's failed legs, Settlement File Monitoring's side panel, a Rejects
   batch, a Reconciliation break and a Platform Config detail — and it renders
   identically in all of them. The only thing a caller may change is the
   variant, which controls width and density, never structure.

   Five sections, always in this order, never more:

       header  ·  WHAT HAPPENED  ·  WHY  ·  EVIDENCE  ·  WHAT TO DO

   The rules the card enforces rather than trusts its callers with:
     · the header title is the catalog's plain-language title, never a code
     · EVIDENCE is truncated to 6 lines. Hard cap. 12 when the cause is unknown
     · WHAT TO DO renders at most two action buttons
     · when the signature is not in the catalog the card says so, shows the raw
       failure, and offers copy-for-engineering — it never fabricates a cause

   window.RunRCA(kit) → { card, panel, actions }
   ============================================================================= */
window.RunRCA = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, R = window.RUNS, E = window.RUN_ERRORS;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, go = kit.go, toast = kit.toast, el = kit.el;

  var RUNS_ROUTE = '#/dashboard/ops/runs';

  /* =======================================================================
     TARGET RESOLUTION
     The catalog names a place ('configs/incoming'); this turns it into a route
     carrying the run's context, so the destination arrives pre-filtered and the
     user never re-selects anything they have already told us (Part 10.2).
     ======================================================================= */
  function q(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      if (obj[k] == null || obj[k] === '') return;
      parts.push(k + '=' + encodeURIComponent(obj[k]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function resolveTarget(target, run, v) {
    var t = run.tenantId, n = run.networkKey, d = run.cycleDate;
    switch (target) {
      case 'configs/incoming':
        // Every incoming parse failure is fixed on the File parser tab — the
        // pipeline tab is about where files come from, not how they are read.
        // Landing on the wrong tab is the difference between "pre-filled" and
        // "somewhere in this screen".
        return {
          route: '#/dashboard/ops/configs/incoming' + q({
            runFrom: run.runId, runCode: run.rca.code, network: n, tab: v.tab || 'parser',
            field: v.fieldName, start: v.start, length: v.length, recordType: v.recordType
          })
        };
      case 'configs/network-files':
        return {
          route: '#/dashboard/ops/configs/network-files' + q({
            runFrom: run.runId, runCode: run.rca.code, network: n,
            field: v.fieldName || v.fieldA, length: v.fieldLength, tab: v.tab
          })
        };
      case 'configs/settlement':
        return {
          route: '#/dashboard/ops/configs/settlement' + q({
            runFrom: run.runId, runCode: run.rca.code, tab: v.tab, report: v.reportName
          })
        };
      case 'files':
        return { route: '#/dashboard/ops/files' + q({ filesTenant: t, filesDate: d }) };
      case 'validation':
        return { route: '#/dashboard/ops/files' + q({ filesTenant: t, filesDate: d, filesOpenValidation: '1' }) };
      case 'rejects':
        return { route: '#/dashboard/ops/rejects' + q({ rejTenant: t, rejDate: d, rejFamily: v.family || 'staging' }) };
      case 'cycle':
        return { route: '#/dashboard/ops/cycle-snapshot/' + t + '/' + (n || R.primaryNetwork(t)) + '/' + d };
      case 'run':
        return { route: RUNS_ROUTE + '/' + run.runId };
      case 'originalRun':
        return v.originalRunId ? { route: RUNS_ROUTE + '/' + v.originalRunId } : null;
      case 'runIncoming':
        return { action: 'rca-launch', data: { op: 'INCOMING_PARSE', tenant: t, network: n, cycle: d } };
      case 'launcher':
        return { action: 'rca-launch', data: { op: run.type, tenant: t, network: n, cycle: d } };
      case 'launcherDate':
        return { action: 'rca-launch', data: { op: run.type, tenant: t, network: n, cycle: v.fileDate || d } };
      case 'rerun':
        return { action: 'rca-rerun', data: { run: run.runId } };
      case 'copy':
        return { action: 'rca-copy-eng', data: { run: run.runId } };
      case 'override':
        return { action: 'rca-override', data: { run: run.runId } };
      default:
        return null;
    }
  }

  function dataAttrs(o) {
    return Object.keys(o || {}).map(function (k) { return ' data-rca-' + k + '="' + esc(o[k]) + '"'; }).join('');
  }

  function actionButton(spec, run, v, primary) {
    if (!spec) return '';
    var resolved = resolveTarget(spec.target, run, v);
    // Part 10.2 — a link whose target has no data is omitted, never disabled.
    if (!resolved) return '';
    var label = E.interp(spec.label, v);
    var cls = 'btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-sm rca-act';
    if (resolved.route) {
      return '<button class="' + cls + '" data-route="' + esc(resolved.route) + '">' + esc(label) + '</button>';
    }
    return '<button class="' + cls + '" data-action="' + resolved.action + '"' + dataAttrs(resolved.data) + '>' + esc(label) + '</button>';
  }

  /* =======================================================================
     THE CARD
     opts.variant : 'full' (run detail) | 'inline' (embedded in a screen) |
                    'panel' (inside a side panel). Presentation only.
     opts.showViewRun : whether the Evidence footer offers "View run →". It is
                    omitted on the run detail page, where it would point at the
                    page you are already on.
     ======================================================================= */
  function card(run, opts) {
    opts = opts || {};
    if (!run || !run.rca) return '';
    var rca = run.rca, v = rca.values;
    var entry = rca.known ? E.get(rca.code) : null;
    var blocked = rca.kind === 'blocked';
    var variant = opts.variant || 'inline';

    /* ---- header ---------------------------------------------------------
       A red x-circle for a failure, an amber shield-alert for a guard block.
       The title is plain language; the context line is tenant · network ·
       cycle · when. Never an error code in either. */
    var title = entry ? E.interp(entry.title, v) : 'This run failed for a reason we don’t have a card for';
    var when = blocked
      ? 'blocked at ' + R.hhmm(run.endAbs != null ? run.endAbs : run.startAbs) + ' IST'
      : 'failed at ' + R.hhmm(run.endAbs != null ? run.endAbs : run.startAbs) + ' IST';
    var ctx = [
      run.tenantName,
      run.networkName || 'acquirer files',
      'cycle ' + U.prettyDate(run.cycleDate),
      when
    ].join(' · ');

    var head = '<div class="rca-head">' +
      '<span class="rca-ic">' + icon(blocked ? 'shield-alert' : 'x-circle', 22) + '</span>' +
      '<div class="rca-head-body">' +
      '<div class="rca-title">' + esc(blocked ? 'Run blocked — ' + lowerFirst(title) : title) + '</div>' +
      '<div class="rca-ctx">' + esc(ctx) + '</div>' +
      '</div>' +
      (run.tags.length ? '<div class="rca-tags">' + run.tags.map(function (t) {
        return '<span class="rca-tag ' + t.toLowerCase() + '">' + esc(t) + '</span>';
      }).join('') + '</div>' : '') +
      '</div>';

    /* ---- what happened --------------------------------------------------- */
    var what = entry ? E.interp(entry.what, v)
      : (blocked
        ? 'This run was stopped before it did anything.'
        : 'The run stopped during ' + (rca.stage || 'processing') + '. Nothing downstream of that stage ran.');

    /* ---- why ------------------------------------------------------------- */
    var why, unknownNote = false;
    if (entry) {
      why = E.interp(entry.why, v);
    } else if (blocked && v.blockMessage) {
      // A guard with no catalog entry still knows exactly why it fired — the
      // check's own message is a fact, not an inference, so it is safe to show.
      why = esc(v.blockLabel || 'A pre-flight check') + ' stopped this run: ' + esc(v.blockMessage);
    } else {
      why = 'This error hasn’t been seen before. The details below are the raw failure.';
      unknownNote = true;
    }

    /* ---- evidence — the hard cap lives here, not in the callers ----------- */
    var cap = rca.known ? 6 : 12;
    var lines = (rca.evidence || []).slice(0, cap);
    var truncated = (rca.evidence || []).length > cap;
    var evidenceFoot = '<div class="rca-ev-foot">' +
      '<button class="btn-ghost rca-copy" data-action="rca-copy" data-rca-run="' + esc(run.runId) + '">' + icon('copy', 14) + 'Copy</button>' +
      (opts.showViewRun === false ? '' :
        '<a class="btn-ghost" data-route="' + RUNS_ROUTE + '/' + esc(run.runId) + '">View run ' + icon('arrow-right', 13) + '</a>') +
      (blocked && v.originalRunId
        ? '<a class="btn-ghost" data-route="' + RUNS_ROUTE + '/' + esc(v.originalRunId) + '">View original run ' + icon('arrow-right', 13) + '</a>'
        : '') +
      '</div>';

    var evidence = '<pre class="rca-evidence mono">' + lines.map(esc).join('\n') + '</pre>' +
      (truncated ? '<div class="rca-trunc meta">Showing the first ' + cap + ' lines. The full log is on the run detail.</div>' : '') +
      evidenceFoot;

    /* ---- what to do — at most two actions --------------------------------- */
    var actionText, buttons = '';
    if (entry) {
      actionText = E.interp(entry.action.text, v);
      buttons = actionButton(entry.action.primary, run, v, true) +
        actionButton(entry.action.secondary, run, v, false);
    } else {
      actionText = blocked
        ? 'Check what has already happened for this cycle before overriding. An override needs a reason and a second approver.'
        : 'Nobody has written a cause for this signature yet. Send the raw failure to engineering, then retry if it looks transient.';
      buttons =
        '<button class="btn btn-primary btn-sm rca-act" data-action="rca-copy-eng" data-rca-run="' + esc(run.runId) + '">Copy details for engineering</button>' +
        (blocked
          ? '<button class="btn btn-secondary btn-sm rca-act" data-action="rca-override" data-rca-run="' + esc(run.runId) + '">Request override</button>'
          : '<button class="btn btn-secondary btn-sm rca-act" data-action="rca-rerun" data-rca-run="' + esc(run.runId) + '">Re-run</button>');
    }

    var overrideNote = '';
    var ov = R.overrideFor(run.runId);
    if (ov) {
      overrideNote = '<div class="rca-override-note ' + ov.status + '">' +
        icon(ov.status === 'approved' ? 'badge-check' : (ov.status === 'rejected' ? 'x-circle' : 'clock'), 15) +
        '<span><strong>Override ' + esc(ov.status) + '</strong> — requested by ' + esc(ov.requestedBy) + ' · ' + esc(ov.requestedAt) +
        (ov.decidedBy ? '. ' + (ov.status === 'approved' ? 'Approved' : 'Rejected') + ' by ' + esc(ov.decidedBy) + ' · ' + esc(ov.decidedAt) : '. Waiting for a second approver.') +
        '<div class="meta">“' + esc(ov.reason) + '”</div></span></div>';
    }

    return '<section class="rca-card rca-' + variant + (blocked ? ' rca-blocked' : ' rca-failed') + (unknownNote ? ' rca-unknown' : '') + '"' +
      ' aria-label="Root cause: ' + esc(title) + '">' +
      head +
      section('What happened', what) +
      section('Why', why, unknownNote ? 'rca-why-unknown' : '') +
      '<div class="rca-sec"><div class="rca-sec-label">Evidence</div>' + evidence + '</div>' +
      '<div class="rca-sec rca-todo"><div class="rca-sec-label">What to do</div>' +
      '<p class="rca-text">' + esc(actionText) + '</p>' +
      overrideNote +
      '<div class="rca-actions">' + buttons + '</div></div>' +
      '</section>';
  }

  function section(label, text, cls) {
    return '<div class="rca-sec ' + (cls || '') + '">' +
      '<div class="rca-sec-label">' + label + '</div>' +
      '<p class="rca-text">' + esc(text) + '</p></div>';
  }
  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  /* A one-line summary for places that link to an RCA rather than render it —
     the Ops Home queue rows and the Settlement File Monitoring "Why?" link. */
  function headline(run) {
    if (!run || !run.rca) return '';
    var entry = run.rca.known ? E.get(run.rca.code) : null;
    return entry ? E.interp(entry.title, run.rca.values) : 'An error we haven’t seen before';
  }

  /* The side-panel wrapper (Part 9, Settlement File Monitoring). Same card,
     same five sections — only the chrome around it differs. */
  function panel(run) {
    if (!run || !run.rca) return '';
    return kit.sidePanel({
      eyebrow: run.typeLabel + ' · ' + run.runId,
      name: esc(run.tenantName) + (run.networkName ? ' · ' + esc(run.networkName) : '') + ' · cycle ' + U.prettyDate(run.cycleDate),
      body: card(run, { variant: 'panel' }),
      close: 'rca-close'
    });
  }

  /* =======================================================================
     COPY TEXT
     ======================================================================= */
  function copyText(run, forEngineering) {
    var v = run.rca.values;
    var entry = run.rca.known ? E.get(run.rca.code) : null;
    var out = [];
    out.push('Run: ' + run.runId + ' (' + run.typeLabel + ')');
    out.push('Tenant: ' + run.tenantName + (run.networkName ? '  Network: ' + run.networkName : ''));
    out.push('Cycle: ' + U.prettyDate(run.cycleDate) + '  Status: ' + run.status);
    out.push('Failed stage: ' + (run.rca.stage || '—') + '  Code: ' + (run.rca.code || 'UNKNOWN'));
    if (entry) { out.push(''); out.push('What happened: ' + E.interp(entry.what, v)); out.push('Why: ' + E.interp(entry.why, v)); }
    else { out.push(''); out.push('This signature is not in the error catalog. Raw failure follows.'); }
    if (run.inputFile) out.push('Input: ' + run.inputFile.name + '  source=' + run.inputFile.source + '  checksum=' + run.inputFile.checksum + '  fileDate=' + run.inputFile.fileDate);
    if (run.outputFile) out.push('Output: ' + run.outputFile.name + '  ' + run.outputFile.s3Path);
    out.push('');
    out.push(forEngineering ? '--- technical log (60 lines) ---' : '--- evidence ---');
    (forEngineering ? (run.rca.log || []) : run.rca.evidence.slice(0, run.rca.known ? 6 : 12)).forEach(function (l) { out.push(l); });
    return out.join('\n');
  }

  /* Clipboard write is best-effort: the prototype has no permissions prompt to
     lean on, so a failure has to say so rather than silently claim success. */
  function copy(text, okMsg) {
    var done = function () { toast(okMsg || 'Copied to clipboard', 'success'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast('Could not reach the clipboard — the details are in the run’s technical log.', 'info'); });
        return;
      }
    } catch (e) { /* fall through */ }
    toast('Could not reach the clipboard — the details are in the run’s technical log.', 'info');
  }

  /* =======================================================================
     ACTIONS — registered once in app.js and shared by every surface, which is
     what lets the same card work inline, in a panel and full width.
     ======================================================================= */
  function runOf(t) { return R.byId[t.getAttribute('data-rca-run')]; }

  var ACTIONS = {
    'rca-copy': function (t) {
      var run = runOf(t); if (!run) return;
      copy(copyText(run, false), 'Evidence copied');
    },
    'rca-copy-eng': function (t) {
      var run = runOf(t); if (!run) return;
      copy(copyText(run, true), 'Full details copied for engineering');
    },
    'rca-rerun': function (t) {
      var run = runOf(t); if (!run) return;
      var fresh = R.rerun(run);
      if (!fresh) return;
      if (fresh.status === 'blocked') {
        toast('Re-run blocked by a guard — the attempt is recorded as ' + fresh.runId, 'info');
      } else {
        toast('Re-ran ' + run.typeLabel.toLowerCase() + ' — ' + fresh.runId + ' succeeded', 'success');
      }
      go('#/dashboard/ops/runs/' + fresh.runId);
    },
    'rca-launch': function (t) {
      // Hand off to the launcher pre-selected. The panel still evaluates its
      // own guards — arriving here is never a licence to skip them.
      S.runs.launcher = {
        open: true,
        op: t.getAttribute('data-rca-op'),
        tenant: t.getAttribute('data-rca-tenant'),
        network: t.getAttribute('data-rca-network') || null,
        cycle: t.getAttribute('data-rca-cycle'),
        returnTo: location.hash
      };
      if (location.hash.indexOf('/ops/runs') < 0) go('#/dashboard/ops/runs');
      else if (window.RUNSUI) window.RUNSUI.render();
    },
    'rca-override': function (t) {
      var run = runOf(t); if (!run) return;
      S.runs.override = { runId: run.runId, reason: '', error: null };
      if (window.RUNSUI) window.RUNSUI.openOverride(run.runId);
    },
    'rca-close': function () { el('overlay-mount').innerHTML = ''; S.runs.panelRunId = null; }
  };

  return { card: card, panel: panel, headline: headline, copyText: copyText, actions: ACTIONS, RUNS_ROUTE: RUNS_ROUTE };
};
