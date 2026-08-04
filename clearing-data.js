/* =============================================================================
   Juspay Ops Portal — Clearing Files (Parts 1–3)

   WHY THIS SECTION EXISTS. Clearing files are staged to Visa and Mastercard by
   a person logging into the network's own software — VEP for Visa — and running
   automation there. There is no API. This dashboard cannot trigger staging,
   cannot observe it and cannot block it. Nothing in this file may pretend
   otherwise: there is no "staging in progress", no polling, no cancel.

   What the dashboard controls is the FILE and the RECORD of what happened. If
   the only stageable file originates here, and staging must be recorded here
   before a cycle is considered complete, then the duplicate-staging incident
   becomes much harder to repeat — without any network integration.

   ONE RECORD PER tenant × network × cycle, in six states:

     not_generated → ready     (Generate file writes it to S3)
     ready         → staged    (operator stages in VEP, then records it here)
     staged        → acked | ack_rejected      (the network's ack is parsed)
     staged        → ack_overdue               (no ack inside the window)

   Settlement files are NOT here — those run on cron and involve no manual
   network software. This section is clearing only.

   Deterministic, in memory only — no browser storage. Records are built once
   and cached, because generate / mark-as-staged / regenerate / upload-ack all
   mutate them and those mutations must stick for the session.
   ============================================================================= */
window.CLEARING = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES;

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rint(r, a, b) { return Math.floor(a + r() * (b - a + 1)); }
  function seedOf(str) { var s = 7; for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0; return s; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function pad2(n) { return String(n).padStart(2, '0'); }

  var TODAY = D.TODAY;                       // 2025-11-21 — processing day
  var CYCLE_TODAY = U.addDays(TODAY, -1);    // 2025-11-20 — current cycle date
  var WINDOW = 30;
  var OPS_USER = 'ops.analyst@juspay.in';

  /* Cycle dates, oldest first, ending on today's cycle. */
  var DATES = (function () {
    var out = [];
    for (var i = WINDOW - 1; i >= 0; i--) out.push(U.addDays(CYCLE_TODAY, -i));
    return out;
  })();

  /* =========================================================================
     THE SIX STATES (Part 2.1)
     `terminal` marks the states where the cycle needs nothing further; the list
     view's default filter is "anything not acknowledged", which is exactly the
     operator's working set.
     ========================================================================= */
  var STATES = {
    not_generated: { key: 'not_generated', label: 'Not generated', kind: 'neutral', icon: 'circle-dashed', blurb: 'Nothing produced yet' },
    ready: { key: 'ready', label: 'Ready to stage', kind: 'info', icon: 'file-check', blurb: 'File exists in S3, not yet staged' },
    staged: { key: 'staged', label: 'Staged', kind: 'warning', icon: 'upload', blurb: 'Recorded as staged, awaiting acknowledgement' },
    acked: { key: 'acked', label: 'Acknowledged', kind: 'success', icon: 'check-circle', blurb: 'Network accepted the file', terminal: true },
    ack_rejected: { key: 'ack_rejected', label: 'Ack rejected', kind: 'danger', icon: 'x-circle', blurb: 'Network rejected the file' },
    ack_overdue: { key: 'ack_overdue', label: 'Ack overdue', kind: 'danger', icon: 'alert-triangle', blurb: 'Staged, but no ack inside the expected window' }
  };
  var STATE_KEYS = ['not_generated', 'ready', 'staged', 'acked', 'ack_rejected', 'ack_overdue'];
  // Rows in these states carry a left border in their status colour (Part 2.2).
  function isAttention(rec) { return rec.state === 'ack_rejected' || rec.state === 'ack_overdue'; }

  var ACK_WINDOW_HOURS = 8;   // ack is expected within 8h of staging

  /* =========================================================================
     FILE NAMING IS A CONTROL, NOT A CONVENIENCE (Part 2.3)

       {TENANT}_{NETWORK}_CLEARING_{CYCLEDATE}_v{N}.txt
       HSBCHK_VISA_CLEARING_20251120_v1.txt

     The operator picks this file inside VEP's own file browser, where nothing
     else on this screen is visible. Tenant, network, cycle date and version all
     have to be legible in that one string, so a stale-dated file
     (…_20251119_v1.txt) is obvious without checking anything.
     ========================================================================= */
  function fileName(tenantId, netKey, date, version) {
    return O.tenantSlug(tenantId) + '_' + O.netSlug(netKey) + '_CLEARING_' +
      String(date).replace(/-/g, '') + '_v' + (version || 1) + '.txt';
  }
  function s3Path(tenantId, netKey, date) {
    return 's3://juspay-clearing-out/clearing/' + tenantId.replace(/-/g, '_') + '/' +
      netKey + '/' + String(date).replace(/-/g, '') + '/';
  }
  /* The run parameters an operator pastes into the automation, so nobody hand
     edits a script. Plain key=value lines, in a fixed order — `direction` is
     first-class because the original incident's wrong direction crept in
     exactly there. */
  function runParams(rec) {
    return [
      'tenant=' + rec.tenantId.replace(/-/g, '_'),
      'network=' + rec.networkKey,
      'cycle=' + rec.date,
      'direction=outgoing',
      'file=' + (rec.file ? rec.file.name : fileName(rec.tenantId, rec.networkKey, rec.date, 1))
    ].join('\n');
  }

  function stamp(date, h, m) { return U.prettyDate(date) + ', ' + pad2(h) + ':' + pad2(m) + ' IST'; }
  function nowStamp() {
    var d = new Date();
    return U.prettyDate(TODAY) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' IST';
  }

  /* =========================================================================
     AUTHORED STATES (Part 9.1)
     Every state has to be reachable, and the two that feed Ops Home's action
     queues have to be recent enough to appear there. Keyed by
     dayIdx|tenant|network where dayIdx counts back from the current cycle.
     ========================================================================= */
  var AUTHORED = {
    // Today's cycle — two not yet generated, three cut and waiting, two staged.
    '0|hsbc-in|visa': { state: 'ready' },
    '0|hsbc-in|mc': { state: 'not_generated' },
    '0|hsbc-hk|visa': { state: 'ready' },
    '0|hsbc-hk|mc': { state: 'not_generated' },
    '0|hsbc-sg|visa': { state: 'ready' },
    '0|yesbank|visa': { state: 'staged' },
    '0|yesbank|mc': { state: 'staged' },

    /* Ack overdue — staged 14 hours ago, nothing back. This is the record that
       shows the warning and the manual ack upload, and it is recent enough to
       reach Ops Home's action queue. */
    '0|hsbc-sg|mc': { state: 'ack_overdue', stagedH: 19, stagedM: 6 },

    /* Ack rejected at file level — the network refused the batch. Links to
       Rejects, and also reaches Ops Home. */
    '1|yesbank|mc': {
      state: 'ack_rejected',
      rejectReason: 'File rejected at header validation — GCMS returned R0102: submitter institution ID does not match the registered ICA for this endpoint.'
    },

    /* The regenerated cycle — v2, with the reason permanently on the record and
       visible in history. Day 3, not day 2: 18 Nov is an RBI full bank holiday
       for the Indian tenants, so no clearing runs and no record exists. */
    '3|hsbc-in|visa': {
      state: 'acked', version: 2, regenerated: true,
      regenReason: 'First cut was staged against the wrong cycle date after a hand-edited run script; re-cut for the correct cycle and re-staged with the network desk informed.'
    }
  };

  /* =========================================================================
     RECORD CONSTRUCTION
     ========================================================================= */
  function amountsFor(tenantId, netKey, date) {
    var cyc = (O.cyclesByTenant[tenantId] || []).filter(function (c) { return c.date === date; })[0];
    if (cyc && cyc.legs[netKey]) {
      return { count: cyc.legs[netKey].subCount, value: cyc.legs[netKey].subGross, currency: cyc.currency };
    }
    var r = rng(seedOf('clr-amt|' + tenantId + '|' + netKey + '|' + date));
    var t = O.tenantById[tenantId];
    var value = Math.round((t.currency === 'INR' ? 8000000 : 400000) * (0.7 + r() * 0.6));
    return { count: Math.round(value / 2100), value: value, currency: t.currency };
  }

  function buildRecord(tenantId, netKey, date, dayIdx) {
    var r = rng(seedOf('clr|' + tenantId + '|' + netKey + '|' + date));
    var a = amountsFor(tenantId, netKey, date);
    var auth = AUTHORED[dayIdx + '|' + tenantId + '|' + netKey] || null;
    // Anything older than the authored window is a normal completed cycle.
    var state = auth ? auth.state : 'acked';
    var version = (auth && auth.version) || 1;

    var rec = {
      id: O.cycleId(tenantId, netKey, date, 1),
      tenantId: tenantId, networkKey: netKey, networkName: O.NET_BY_KEY[netKey].name,
      date: date, dow: U.DOW[U.fromYmd(date).getUTCDay()],
      currency: a.currency, count: a.count, value: a.value,
      state: state,
      version: version,
      regenerated: !!(auth && auth.regenerated),
      regenReason: (auth && auth.regenReason) || null,
      file: null,
      downloadedAt: null, downloadedBy: null,
      stagedAt: null, stagedBy: null,
      ack: null,
      events: []
    };

    if (state === 'not_generated') { rec.events = []; return rec; }

    /* ---- generated ------------------------------------------------------- */
    var genH = 21, genM = rint(r, 30, 58);
    rec.file = makeFile(rec, version, r, stamp(date, genH, genM));
    rec.events.push({ at: rec.file.generatedAt, by: 'clearing-generator', kind: 'normal',
      text: 'Generated ' + rec.file.name + ' — ' + rec.file.size + ' · ' + rec.count + ' transactions · ' + rec.file.checksum });

    if (rec.regenerated) {
      // The v1 cut stays in history, nullified, with the reason on the v2 entry.
      var v1 = fileName(tenantId, netKey, date, 1);
      rec.events.push({ at: stamp(date, genH, genM + 1 > 59 ? 59 : genM + 1), by: OPS_USER, kind: 'nullified',
        text: 'Superseded ' + v1 + ' — regenerated as v2.' });
      rec.events.push({ at: stamp(date, genH, genM + 2 > 59 ? 59 : genM + 2), by: OPS_USER, kind: 'correction',
        text: 'Regenerated as ' + rec.file.name + '.', reason: rec.regenReason });
    }

    if (state === 'ready') return rec;

    /* ---- downloaded (informational only, never a gate) ------------------- */
    var dlH = genH, dlM = Math.min(59, genM + rint(r, 3, 9));
    rec.downloadedAt = stamp(date, dlH, dlM);
    rec.downloadedBy = OPS_USER;
    rec.events.push({ at: rec.downloadedAt, by: OPS_USER, kind: 'normal', text: 'Downloaded ' + rec.file.name + '.' });

    /* ---- staged ---------------------------------------------------------- */
    var stH = auth && auth.stagedH != null ? auth.stagedH : 22;
    var stM = auth && auth.stagedM != null ? auth.stagedM : rint(r, 0, 40);
    rec.stagedAt = stamp(date, stH, stM);
    rec.stagedBy = OPS_USER;
    rec.events.push({ at: rec.stagedAt, by: OPS_USER, kind: 'normal',
      text: 'Marked as staged in ' + vepName(netKey) + '. Staging itself happens in the network’s software — this is the operator’s record of it.' });

    if (state === 'staged' || state === 'ack_overdue') {
      if (state === 'ack_overdue') {
        rec.overdueBy = ACK_WINDOW_HOURS + 6;   // 14h since staging, 8h window
        rec.events.push({ at: stamp(U.addDays(date, 1), (stH + ACK_WINDOW_HOURS) % 24, stM), by: 'ack-watcher', kind: 'nullified',
          text: 'No acknowledgement within ' + ACK_WINDOW_HOURS + 'h of staging. Cycle marked overdue.' });
      }
      return rec;
    }

    /* ---- acknowledged / rejected ----------------------------------------- */
    var ackH = rint(r, 2, 4), ackM = rint(r, 2, 58);
    var ackDate = U.addDays(date, 1);
    var ackFile = O.netSlug(netKey) + '_ACK_' + ackDate.replace(/-/g, '') + '_' + pad2(ackH) + pad2(ackM) + '.txt';
    if (state === 'ack_rejected') {
      rec.ack = {
        accepted: false, file: ackFile, receivedAt: stamp(ackDate, ackH, ackM),
        acceptedCount: 0, rejectedCount: rec.count,
        reason: auth.rejectReason,
        rejectFamily: 'staging'
      };
      rec.events.push({ at: rec.ack.receivedAt, by: 'ack-parser', kind: 'nullified',
        text: 'Acknowledgement ' + ackFile + ' parsed — file rejected by ' + rec.networkName + '.', reason: auth.rejectReason });
      return rec;
    }
    var rejected = rint(r, 0, 9) === 0 ? rint(r, 2, 12) : 0;
    rec.ack = {
      accepted: true, file: ackFile, receivedAt: stamp(ackDate, ackH, ackM),
      acceptedCount: rec.count - rejected, rejectedCount: rejected,
      reason: null, rejectFamily: 'incoming'
    };
    rec.events.push({ at: rec.ack.receivedAt, by: 'ack-parser', kind: 'normal',
      text: 'Acknowledgement ' + ackFile + ' parsed — accepted by ' + rec.networkName + '. ' +
        (rejected ? rejected + ' transaction' + (rejected === 1 ? '' : 's') + ' rejected within the batch.' : 'All transactions accepted.') });
    return rec;
  }

  function makeFile(rec, version, r, generatedAt) {
    var sum = '';
    for (var i = 0; i < 16; i++) sum += '0123456789abcdef'[rint(r, 0, 15)];
    return {
      name: fileName(rec.tenantId, rec.networkKey, rec.date, version),
      version: version,
      generatedAt: generatedAt,
      size: (1.2 + r() * 6.4).toFixed(1) + ' MB',
      checksum: sum,
      path: s3Path(rec.tenantId, rec.networkKey, rec.date)
    };
  }

  /* The network's own software, named — because the operator has to leave this
     screen and go there, and vagueness about which tool is where the incident
     lived. */
  var VEP = { visa: 'VEP', mc: 'Mastercard Connect', rupay: 'NPCI NFS portal', onus: 'the internal clearing console' };
  function vepName(netKey) { return VEP[netKey] || 'the network’s software'; }

  /* =========================================================================
     THE CACHE — records are mutated by the row actions, so they are built once.
     ========================================================================= */
  /* On-us transactions never leave the bank, so there is no clearing file and
     no network software to stage it in. Only the card networks appear here. */
  var STAGEABLE = { visa: true, mc: true, rupay: true };
  function clearingNetsFor(tenantId) {
    return O.netsFor(tenantId).filter(function (n) { return STAGEABLE[n.key]; });
  }

  var byDate = {};
  function recordsFor(date) {
    if (byDate[date]) return byDate[date];
    var dayIdx = DATES.length - 1 - DATES.indexOf(date);
    var out = [];
    O.tenants.forEach(function (t) {
      clearingNetsFor(t.id).forEach(function (net) {
        // Clearing does not run on a full bank holiday.
        var hol = C.holidayFor ? C.holidayFor(t.id, date) : null;
        if (hol && hol.impact === 'Full holiday') return;
        out.push(buildRecord(t.id, net.key, date, dayIdx));
      });
    });
    byDate[date] = out;
    return out;
  }
  function rowsForRange(from, to) {
    var out = [];
    DATES.forEach(function (d) { if (d >= from && d <= to) out = out.concat(recordsFor(d)); });
    return out;
  }
  var _index = null;
  function byId(id) {
    if (!_index) {
      _index = {};
      rowsForRange(DATES[0], DATES[DATES.length - 1]).forEach(function (rec) { _index[rec.id] = rec; });
    }
    return _index[id] || null;
  }
  /* A cycle ID that is well-formed but has no record yet still resolves — the
     Reconciliation legs link by ID, including to cycles that were never cut. */
  function resolve(id) {
    var hit = byId(id);
    if (hit) return hit;
    var p = O.parseCycleId(id);
    if (!p || !O.netEnabled(p.tenantId, p.networkKey) || !STAGEABLE[p.networkKey]) return null;
    if (DATES.indexOf(p.date) < 0) return null;
    var extra = buildRecord(p.tenantId, p.networkKey, p.date, DATES.length - 1 - DATES.indexOf(p.date));
    extra.id = id;
    // A second clearing cycle on the same day that was never staged.
    if (p.seq > 1) {
      extra.state = 'not_generated'; extra.file = null; extra.stagedAt = null;
      extra.stagedBy = null; extra.ack = null; extra.downloadedAt = null;
      extra.events = []; extra.count = 0; extra.value = 0;
    }
    _index[id] = extra;
    return extra;
  }

  /* =========================================================================
     TRANSITIONS — every one of them is an explicit operator action or an ack
     landing. Nothing here observes the network.
     ========================================================================= */
  function generate(rec, reason) {
    var r = rng(seedOf('clr-gen|' + rec.id + '|' + (rec.version + 1)));
    var regen = rec.state !== 'not_generated';
    var version = regen ? rec.version + 1 : 1;
    var prev = rec.file ? rec.file.name : null;
    rec.file = makeFile(rec, version, r, nowStamp());
    rec.version = version;
    if (!rec.count) {
      var a = amountsFor(rec.tenantId, rec.networkKey, rec.date);
      rec.count = a.count; rec.value = a.value; rec.currency = a.currency;
    }
    if (regen) {
      rec.regenerated = true;
      rec.regenReason = reason || rec.regenReason;
      rec.events.push({ at: nowStamp(), by: OPS_USER, kind: 'nullified',
        text: 'Superseded ' + prev + ' — regenerated as v' + version + '.' });
      rec.events.push({ at: nowStamp(), by: OPS_USER, kind: 'correction',
        text: 'Regenerated as ' + rec.file.name + '.', reason: reason });
      // The cycle is back in the operator's hands: a new file exists that has
      // not been staged. The prior staging record stays in history.
      rec.state = 'ready';
      rec.stagedAt = null; rec.stagedBy = null; rec.ack = null; rec.downloadedAt = null;
    } else {
      rec.state = 'ready';
      rec.events.push({ at: rec.file.generatedAt, by: OPS_USER, kind: 'normal',
        text: 'Generated ' + rec.file.name + ' — ' + rec.file.size + ' · ' + rec.count + ' transactions · ' + rec.file.checksum });
    }
    return rec;
  }
  function markDownloaded(rec) {
    if (!rec.file) return rec;
    rec.downloadedAt = nowStamp();
    rec.downloadedBy = OPS_USER;
    rec.events.push({ at: rec.downloadedAt, by: OPS_USER, kind: 'normal', text: 'Downloaded ' + rec.file.name + '.' });
    return rec;
  }
  function markStaged(rec, note) {
    rec.state = 'staged';
    rec.stagedAt = nowStamp();
    rec.stagedBy = OPS_USER;
    rec.events.push({ at: rec.stagedAt, by: OPS_USER, kind: 'normal',
      text: 'Marked as staged in ' + vepName(rec.networkKey) + '.', reason: note || null });
    return rec;
  }
  function applyAck(rec, name) {
    var r = rng(seedOf('clr-ack|' + rec.id));
    var rejected = rint(r, 0, 6) === 0 ? rint(r, 2, 10) : 0;
    rec.ack = {
      accepted: true, file: name, receivedAt: nowStamp(),
      acceptedCount: rec.count - rejected, rejectedCount: rejected,
      reason: null, rejectFamily: 'incoming', manual: true
    };
    rec.state = 'acked';
    rec.events.push({ at: rec.ack.receivedAt, by: OPS_USER, kind: 'correction',
      text: 'Acknowledgement ' + name + ' uploaded manually and parsed — accepted by ' + rec.networkName + '.',
      reason: 'Automated pickup did not collect the ack; supplied by the operator.' });
    return rec;
  }

  /* =========================================================================
     READS FOR OTHER SCREENS
     ========================================================================= */
  /* Ops Home's existing action queues (Part 2.4) — overdue and rejected cycles,
     most recent first. No new queue. */
  function needsAttention(days) {
    var from = U.addDays(CYCLE_TODAY, -(days || 3) + 1);
    return rowsForRange(from, CYCLE_TODAY).filter(isAttention).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.state === 'ack_rejected' ? -1 : 1;
    });
  }
  /* The Cycle Snapshot's CLR leg links here rather than describing staging
     inline — one record of a staging, in one place. */
  function forCycle(tenantId, netKey, date) { return byId(O.cycleId(tenantId, netKey, date, 1)); }

  function counts(list) {
    var out = {};
    STATE_KEYS.forEach(function (k) { out[k] = 0; });
    list.forEach(function (rec) { out[rec.state] += 1; });
    return out;
  }

  return {
    TODAY: TODAY, CYCLE_TODAY: CYCLE_TODAY, WINDOW: WINDOW, DATES: DATES, OPS_USER: OPS_USER,
    STATES: STATES, STATE_KEYS: STATE_KEYS, isAttention: isAttention, ACK_WINDOW_HOURS: ACK_WINDOW_HOURS,
    clearingNetsFor: clearingNetsFor,
    fileName: fileName, s3Path: s3Path, runParams: runParams, vepName: vepName,
    recordsFor: recordsFor, rowsForRange: rowsForRange, byId: byId, resolve: resolve,
    generate: generate, markDownloaded: markDownloaded, markStaged: markStaged, applyAck: applyAck,
    needsAttention: needsAttention, forCycle: forCycle, counts: counts
  };
})();
