/* =============================================================================
   Juspay Ops Portal — Network Files (refinement Part 5)

   WHY THIS SECTION EXISTS, AND WHAT IT HONESTLY OWNS.

   Both directions run through a person logging into a remote desktop and
   running an automation script. The dashboard cannot run those scripts, cannot
   watch them and cannot stop them. What it CAN be is the place the work starts
   and the place its state lives — which is enough to make duplicate staging
   visible, because the record of "I've started" is what the next person sees
   when they open the same cycle.

   OUTGOING (clearing):
     1. system generates the clearing file
     2. ops opens RDP and runs the staging script
     3. the script pulls from the S3 network folder, decrypts, backs up
     4. the script stages to Visa / Mastercard
     5. the network returns a staging-proof file, encrypted back into S3
     6. the dashboard picks that up and confirms staging
   The RDP session has to stay logged in or the automation halts partway.

   INCOMING:
     1. files become available at MFE or the Visa portal
     2. ops runs the download script
     3. files land in the backup folder, encrypted if not already
     4. XML lands in the encrypted folder, then the network folder
     5. the system parses them
     6. records are pushed to tables
     7. reconciliation triggers

   Nothing here polls a network, and no state in this file is set by observing
   one. Every transition is either an operator's own declaration or a file
   arriving in S3.

   Deterministic, in memory only — no browser storage. Records are built once
   and cached, because the operator actions mutate them and those mutations
   have to stick for the session.
   ============================================================================= */
window.NETFILES = (function () {
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

  /* On-us transactions never leave the bank, so there is no network file in
     either direction and no script to run. Only the card networks appear. */
  var STAGEABLE = { visa: true, mc: true, rupay: true };
  function netsFor(tenantId) {
    return O.netsFor(tenantId).filter(function (n) { return STAGEABLE[n.key]; });
  }

  /* =========================================================================
     PART 5.2 — OUTGOING STATES
     `open` marks the states that still need something from somebody; the list
     view's default filter is exactly that set.
     ========================================================================= */
  var OUT_STATES = {
    generating: { key: 'generating', label: 'Generating', kind: 'neutral', icon: 'loader', doing: 'Wait — the file is still being produced.', open: true },
    ready: { key: 'ready', label: 'Ready to stage', kind: 'info', icon: 'file-check', doing: 'Run the staging script in RDP.', open: true, act: true },
    staging: { key: 'staging', label: 'Staging in progress', kind: 'warning', icon: 'upload', doing: 'Wait — keep the RDP session open until the script finishes.', open: true },
    staged: { key: 'staged', label: 'Staged — awaiting proof', kind: 'warning', icon: 'clock', doing: 'Wait for the network to return its staging-proof file.', open: true },
    confirmed: { key: 'confirmed', label: 'Confirmed', kind: 'success', icon: 'check-circle', doing: 'Nothing — the proof file matched.' },
    proof_overdue: { key: 'proof_overdue', label: 'Proof overdue', kind: 'danger', icon: 'alert-triangle', doing: 'Investigate. A proof file can be uploaded by hand.', open: true },
    failed: { key: 'failed', label: 'Failed', kind: 'danger', icon: 'x-circle', doing: 'Read the failure detail on the step that stopped.', open: true }
  };
  var OUT_KEYS = ['generating', 'ready', 'staging', 'staged', 'confirmed', 'proof_overdue', 'failed'];
  /* At or beyond this point somebody has already declared they are staging, so
     the staging block is replaced by the already-staged guard (Part 5.3). */
  var STAGING_STARTED = { staging: 1, staged: 1, confirmed: 1, proof_overdue: 1 };

  /* =========================================================================
     PART 5.4 — INCOMING STATES
     ========================================================================= */
  var IN_STATES = {
    expected: { key: 'expected', label: 'Expected', kind: 'neutral', icon: 'circle-dashed', doing: 'Wait — the cycle window is open and nothing is available yet.', open: true },
    available: { key: 'available', label: 'Available at network', kind: 'info', icon: 'download', doing: 'Run the download script.', open: true, act: true },
    downloading: { key: 'downloading', label: 'Downloading', kind: 'warning', icon: 'loader', doing: 'Wait — the script is running.', open: true },
    downloaded: { key: 'downloaded', label: 'Downloaded', kind: 'warning', icon: 'folder-down', doing: '', open: true },
    encrypted: { key: 'encrypted', label: 'Encrypted', kind: 'warning', icon: 'lock', doing: '', open: true },
    in_folder: { key: 'in_folder', label: 'In network folder', kind: 'warning', icon: 'folder-check', doing: '', open: true },
    parsed: { key: 'parsed', label: 'Parsed', kind: 'info', icon: 'file-search', doing: '', open: true },
    pushed: { key: 'pushed', label: 'Pushed to tables', kind: 'info', icon: 'database', doing: '', open: true },
    reconciled: { key: 'reconciled', label: 'Reconciled', kind: 'success', icon: 'check-circle', doing: 'Nothing — the cycle is closed.' },
    parse_failed: { key: 'parse_failed', label: 'Parse failed', kind: 'danger', icon: 'x-circle', doing: 'Read the failure detail on the step that stopped.', open: true }
  };
  var IN_KEYS = ['expected', 'available', 'downloading', 'downloaded', 'encrypted', 'in_folder', 'parsed', 'pushed', 'reconciled', 'parse_failed'];

  function isAttention(rec) {
    return rec.state === 'proof_overdue' || rec.state === 'failed' || rec.state === 'parse_failed';
  }
  function needsOperator(rec) { return rec.state === 'ready' || rec.state === 'available'; }

  var PROOF_WINDOW_HOURS = 8;   // a staging proof is expected within 8h of staging

  /* =========================================================================
     FILE NAMING IS A CONTROL, NOT A CONVENIENCE

       {TENANT}_{NETWORK}_CLEARING_{CYCLEDATE}_v{N}.txt
       HSBCHK_VISA_CLEARING_20251120_v1.txt

     The operator reads this string inside the RDP session, where nothing else
     from this dashboard is visible. Tenant, network, cycle date and version all
     have to be legible there, so a stale-dated file (…_20251119_v1.txt) is
     obvious without checking anything.
     ========================================================================= */
  function outFileName(tenantId, netKey, date, version) {
    return O.tenantSlug(tenantId) + '_' + O.netSlug(netKey) + '_CLEARING_' +
      String(date).replace(/-/g, '') + '_v' + (version || 1) + '.txt';
  }
  var IN_NAME = { visa: 'VSS_TC46', mc: 'GCMS_T140', rupay: 'NPCI_RAW' };
  var IN_EXT = { visa: 'xml', mc: 'xml', rupay: 'xml' };
  function inFileName(tenantId, netKey, date, seq) {
    return IN_NAME[netKey] + '_' + O.tenantSlug(tenantId) + '_' + String(date).replace(/-/g, '') +
      '_' + pad2(seq || 1) + '.' + IN_EXT[netKey];
  }
  function proofFileName(netKey, date) {
    return O.netSlug(netKey) + '_STAGINGPROOF_' + String(date).replace(/-/g, '') + '.txt';
  }
  /* The S3 network folder — the path the script reads from and the one the
     operator pastes. It is the same folder in both directions, which is why
     both instruction blocks show it the same way. */
  function s3Network(tenantId, netKey, date) {
    return 's3://juspay-network-files/network/' + tenantId.replace(/-/g, '_') + '/' +
      netKey + '/' + String(date).replace(/-/g, '') + '/';
  }
  function s3Backup(tenantId, netKey, date) {
    return 's3://juspay-network-files/backup/' + tenantId.replace(/-/g, '_') + '/' +
      netKey + '/' + String(date).replace(/-/g, '') + '/';
  }
  /* Where the file is downloadable from, named — because the operator has to
     leave this screen and go there, and vagueness about which portal is where
     mistakes start. */
  var SOURCE = { visa: 'the Visa portal', mc: 'MFE', rupay: 'the NPCI NFS portal' };
  function sourceName(netKey) { return SOURCE[netKey] || 'the network portal'; }
  var STAGE_TOOL = { visa: 'VEP', mc: 'Mastercard Connect', rupay: 'NPCI NFS portal' };
  function stageTool(netKey) { return STAGE_TOOL[netKey] || 'the network’s software'; }

  function stamp(date, h, m) { return U.prettyDate(date) + ', ' + pad2(h) + ':' + pad2(m) + ' IST'; }
  function nowStamp() {
    var d = new Date();
    return U.prettyDate(TODAY) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' IST';
  }
  function durLabel(sec) {
    if (sec == null) return null;
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + 'm' + (s ? ' ' + s + 's' : '');
  }

  /* =========================================================================
     THE STEP LIST (Part 5.3 / 5.5)
     Same shape both directions, and the same shape Acquirer Reports already
     uses: name, state, timestamp, optional duration, optional record count,
     and — where it failed — the code and the raw line the pipeline produced.
     `done | active | todo | failed` is the whole vocabulary.
     ========================================================================= */
  function step(name, state, at, extra) {
    var s = { name: name, state: state, at: at || null, note: null, seconds: null, records: null, error_code: null, error_detail: null };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }

  /* =========================================================================
     OUTGOING — AUTHORED STATES (Part 10)
     Every state is reachable, and the ones that feed Ops Home's queues are
     recent enough to appear there. Keyed dayIdx|tenant|network, dayIdx counting
     back from the current cycle.
     ========================================================================= */
  var OUT_AUTHORED = {
    // Today's cycle.
    '0|hsbc-in|visa': { state: 'ready' },
    '0|hsbc-in|mc': { state: 'generating' },
    '0|hsbc-hk|visa': { state: 'staging', startedH: 22, startedM: 4 },
    '0|hsbc-hk|mc': { state: 'ready' },
    '0|hsbc-sg|visa': { state: 'staged', stagedH: 22, stagedM: 12 },
    '0|hsbc-sg|mc': { state: 'proof_overdue', stagedH: 19, stagedM: 6 },
    '0|hsbc-au|visa': { state: 'ready' },
    '0|hsbc-my|visa': { state: 'ready' },
    '0|hsbc-my|mc': {
      state: 'failed', failStep: 'File generated',
      code: 'CLR_GEN_UNMAPPED_MCC',
      detail: 'clearing_generator: 214 records carry MCC 6012 with no entry in the MY interchange table; refusing to emit a partial file'
    },
    // Yesterday — the regenerated cycle keeps its permanent tag.
    '1|yesbank|mc': {
      state: 'confirmed', version: 2, regenerated: true,
      regenReason: 'First cut was staged against the wrong cycle date after a hand-edited run script; re-cut for the correct cycle and re-staged with the network desk informed.'
    }
  };

  /* =========================================================================
     INCOMING — AUTHORED STATES (Part 10)
     ========================================================================= */
  var IN_AUTHORED = {
    '0|hsbc-in|visa': { state: 'reconciled' },
    '0|hsbc-in|mc': { state: 'pushed' },
    '0|hsbc-in|rupay': { state: 'parsed' },
    '0|hsbc-hk|visa': { state: 'reconciled', cycles: 2 },
    '0|hsbc-hk|mc': { state: 'in_folder' },
    '0|hsbc-sg|visa': { state: 'downloading', startedH: 2, startedM: 40 },
    '0|hsbc-sg|mc': { state: 'encrypted' },
    '0|hsbc-au|visa': { state: 'downloaded' },
    '0|hsbc-au|mc': { state: 'available' },
    // The tenant Ops Home promotes: its incoming has not arrived at all.
    '0|hsbc-my|visa': { state: 'available' },
    '0|hsbc-my|mc': { state: 'expected' },
    '0|yesbank|visa': { state: 'reconciled' },
    '0|yesbank|mc': {
      state: 'parse_failed', failStep: 'Parsed',
      code: 'PARSE_UNKNOWN_TCR',
      detail: 'incoming_parser: record 0x1F41 declares TCR 7 at position 3; no record type 7 is defined for mastercard_incoming'
    },
    '0|yesbank|rupay': { state: 'reconciled' }
  };

  /* =========================================================================
     RECORD CONSTRUCTION — OUTGOING
     ========================================================================= */
  function amountsFor(tenantId, netKey, date) {
    var cyc = (O.cyclesByTenant[tenantId] || []).filter(function (c) { return c.date === date; })[0];
    if (cyc && cyc.legs[netKey]) {
      return { count: cyc.legs[netKey].subCount, value: cyc.legs[netKey].subGross, currency: cyc.currency };
    }
    var r = rng(seedOf('nf-amt|' + tenantId + '|' + netKey + '|' + date));
    var t = O.tenantById[tenantId];
    var value = Math.round((t.currency === 'INR' ? 8000000 : 400000) * (0.7 + r() * 0.6));
    return { count: Math.round(value / 2100), value: value, currency: t.currency };
  }

  function makeOutFile(tenantId, netKey, date, version, r, generatedAt, count) {
    var sum = '';
    for (var i = 0; i < 16; i++) sum += '0123456789abcdef'[rint(r, 0, 15)];
    return {
      name: outFileName(tenantId, netKey, date, version),
      version: version, generatedAt: generatedAt,
      size: (1.2 + r() * 6.4).toFixed(1) + ' MB',
      checksum: sum, path: s3Network(tenantId, netKey, date), records: count
    };
  }

  function buildOutgoing(tenantId, netKey, date, dayIdx) {
    var r = rng(seedOf('nfo|' + tenantId + '|' + netKey + '|' + date));
    var a = amountsFor(tenantId, netKey, date);
    var auth = OUT_AUTHORED[dayIdx + '|' + tenantId + '|' + netKey] || null;
    var state = auth ? auth.state : 'confirmed';
    var version = (auth && auth.version) || 1;

    var rec = {
      dir: 'outgoing',
      id: O.cycleId(tenantId, netKey, date, 1),
      tenantId: tenantId, networkKey: netKey, networkName: O.NET_BY_KEY[netKey].name,
      date: date, dow: U.DOW[U.fromYmd(date).getUTCDay()],
      currency: a.currency, count: a.count, value: a.value,
      state: state, version: version,
      regenerated: !!(auth && auth.regenerated), regenReason: (auth && auth.regenReason) || null,
      file: null,
      networkPath: s3Network(tenantId, netKey, date),
      backupPath: s3Backup(tenantId, netKey, date),
      startedAt: null, startedBy: null,       // "I've started staging" — who and when
      stagedAt: null, proofAt: null, proof: null,
      overrideReason: null, overrideAt: null, overrideBy: null,
      steps: [], events: []
    };

    var genH = 21, genM = rint(r, 30, 58);
    var genAt = stamp(date, genH, genM);
    var genSec = rint(r, 28, 74);

    /* ---- Generating: nothing has been produced yet ----------------------- */
    if (state === 'generating') {
      rec.steps = [
        step('File generated', 'active', genAt, { note: 'running' }),
        step('Placed in network folder', 'todo'),
        step('Ready to stage', 'todo'),
        step('Decrypted to backup folder', 'todo'),
        step('Staged to network', 'todo'),
        step('Staging proof received', 'todo')
      ];
      return rec;
    }

    /* ---- Failed generation ------------------------------------------------ */
    if (state === 'failed') {
      rec.steps = [
        step('File generated', 'failed', genAt, { seconds: genSec, error_code: auth.code, error_detail: auth.detail }),
        step('Placed in network folder', 'todo'),
        step('Ready to stage', 'todo'),
        step('Decrypted to backup folder', 'todo'),
        step('Staged to network', 'todo'),
        step('Staging proof received', 'todo')
      ];
      rec.events.push({ at: genAt, by: 'clearing-generator', kind: 'nullified', text: 'Generation failed — ' + auth.code + '.', reason: auth.detail });
      return rec;
    }

    rec.file = makeOutFile(tenantId, netKey, date, version, r, genAt, a.count);
    rec.events.push({
      at: genAt, by: 'clearing-generator', kind: 'normal',
      text: 'Generated ' + rec.file.name + ' — ' + rec.file.size + ' · ' + a.count + ' transactions · ' + rec.file.checksum
    });
    if (rec.regenerated) {
      var v1 = outFileName(tenantId, netKey, date, 1);
      rec.events.push({ at: stamp(date, genH, Math.min(59, genM + 1)), by: OPS_USER, kind: 'nullified', text: 'Superseded ' + v1 + ' — regenerated as v2.' });
      rec.events.push({ at: stamp(date, genH, Math.min(59, genM + 2)), by: OPS_USER, kind: 'correction', text: 'Regenerated as ' + rec.file.name + '.', reason: rec.regenReason });
    }

    var placedAt = stamp(date, genH, Math.min(59, genM + 1));
    var steps = [
      step('File generated', 'done', genAt, { seconds: genSec, records: a.count }),
      step('Placed in network folder', 'done', placedAt)
    ];

    if (state === 'ready') {
      steps.push(step('Ready to stage', 'active', null, { note: 'awaiting operator' }));
      steps.push(step('Decrypted to backup folder', 'todo'));
      steps.push(step('Staged to network', 'todo'));
      steps.push(step('Staging proof received', 'todo'));
      rec.steps = steps;
      return rec;
    }

    /* ---- Somebody declared they had started ------------------------------- */
    var stH = auth && auth.startedH != null ? auth.startedH : (auth && auth.stagedH != null ? auth.stagedH : 22);
    var stM = auth && auth.startedM != null ? auth.startedM : (auth && auth.stagedM != null ? auth.stagedM : rint(r, 0, 40));
    rec.startedAt = stamp(date, stH, stM);
    rec.startedBy = OPS_USER;
    steps.push(step('Ready to stage', 'done', rec.startedAt, { note: 'staging started by ' + OPS_USER }));
    rec.events.push({
      at: rec.startedAt, by: OPS_USER, kind: 'normal',
      text: 'Recorded as staging started. The script runs in RDP against ' + stageTool(netKey) + ' — this is the operator’s declaration, not an observation.'
    });

    if (state === 'staging') {
      steps.push(step('Decrypted to backup folder', 'done', stamp(date, stH, Math.min(59, stM + 2))));
      steps.push(step('Staged to network', 'active', null, { note: 'script running — keep the RDP session open' }));
      steps.push(step('Staging proof received', 'todo'));
      rec.steps = steps;
      return rec;
    }

    /* ---- Staged ----------------------------------------------------------- */
    var decAt = stamp(date, stH, Math.min(59, stM + 2));
    var stagedH = stH + (stM + 9 > 59 ? 1 : 0), stagedM = (stM + 9) % 60;
    rec.stagedAt = stamp(date, stagedH % 24, stagedM);
    steps.push(step('Decrypted to backup folder', 'done', decAt, { seconds: rint(r, 40, 130) }));
    steps.push(step('Staged to network', 'done', rec.stagedAt, { seconds: rint(r, 180, 420), records: a.count }));
    rec.events.push({ at: rec.stagedAt, by: 'staging-script', kind: 'normal', text: 'Staged ' + rec.file.name + ' to ' + rec.networkName + '.' });

    if (state === 'staged') {
      steps.push(step('Staging proof received', 'active', null, { note: 'expected within ' + PROOF_WINDOW_HOURS + 'h of staging' }));
      rec.steps = steps;
      return rec;
    }
    if (state === 'proof_overdue') {
      rec.overdueBy = PROOF_WINDOW_HOURS + 6;
      steps.push(step('Staging proof received', 'failed', null, {
        note: 'no proof file within ' + PROOF_WINDOW_HOURS + 'h of staging',
        error_code: 'PROOF_NOT_RECEIVED',
        error_detail: 'proof-watcher: no ' + proofFileName(netKey, date) + ' in ' + rec.networkPath + ' after ' + (PROOF_WINDOW_HOURS + 6) + 'h'
      }));
      rec.steps = steps;
      rec.events.push({
        at: stamp(U.addDays(date, 1), (stagedH + PROOF_WINDOW_HOURS) % 24, stagedM), by: 'proof-watcher', kind: 'nullified',
        text: 'No staging proof within ' + PROOF_WINDOW_HOURS + 'h. Cycle marked overdue.'
      });
      return rec;
    }

    /* ---- Confirmed -------------------------------------------------------- */
    var pH = rint(r, 2, 4), pM = rint(r, 2, 58);
    var pDate = U.addDays(date, 1);
    rec.proofAt = stamp(pDate, pH, pM);
    rec.proof = { file: proofFileName(netKey, date), receivedAt: rec.proofAt, acceptedCount: a.count, path: rec.networkPath };
    steps.push(step('Staging proof received', 'done', rec.proofAt, { records: a.count }));
    rec.steps = steps;
    rec.events.push({ at: rec.proofAt, by: 'proof-parser', kind: 'normal', text: 'Staging proof ' + rec.proof.file + ' parsed and matched to this cycle.' });
    return rec;
  }

  /* =========================================================================
     RECORD CONSTRUCTION — INCOMING
     ========================================================================= */
  var IN_ORDER = ['expected', 'available', 'downloading', 'downloaded', 'encrypted', 'in_folder', 'parsed', 'pushed', 'reconciled'];
  function reached(state, target) {
    if (state === 'parse_failed') return IN_ORDER.indexOf(target) <= IN_ORDER.indexOf('in_folder');
    return IN_ORDER.indexOf(state) >= IN_ORDER.indexOf(target);
  }

  function buildIncoming(tenantId, netKey, date, dayIdx) {
    var r = rng(seedOf('nfi|' + tenantId + '|' + netKey + '|' + date));
    var a = amountsFor(tenantId, netKey, date);
    var auth = IN_AUTHORED[dayIdx + '|' + tenantId + '|' + netKey] || null;
    var state = auth ? auth.state : 'reconciled';
    var cycles = (auth && auth.cycles) || 1;
    var nextDay = U.addDays(date, 1);

    var rec = {
      dir: 'incoming',
      id: O.cycleId(tenantId, netKey, date, 1),
      tenantId: tenantId, networkKey: netKey, networkName: O.NET_BY_KEY[netKey].name,
      date: date, dow: U.DOW[U.fromYmd(date).getUTCDay()],
      currency: a.currency, count: a.count, value: a.value,
      state: state, cycles: cycles,
      file: null,
      source: sourceName(netKey),
      networkPath: s3Network(tenantId, netKey, date),
      backupPath: s3Backup(tenantId, netKey, date),
      startedAt: null, startedBy: null,       // "I've started the download"
      downloadedAt: null, parsedAt: null, pushedAt: null, reconciledAt: null,
      overrideReason: null, overrideAt: null, overrideBy: null,
      steps: [], events: []
    };

    var availH = 2, availM = rint(r, 30, 48);
    var availAt = stamp(nextDay, availH, availM);

    if (state === 'expected') {
      rec.steps = [
        step('Available at network', 'active', null, { note: 'cycle window open — nothing available yet at ' + rec.source }),
        step('Downloaded', 'todo'), step('Encrypted', 'todo'), step('Placed in network folder', 'todo'),
        step('Parsed', 'todo'), step('Pushed to tables', 'todo'), step('Reconciliation run', 'todo')
      ];
      return rec;
    }

    rec.file = {
      name: inFileName(tenantId, netKey, date, 1),
      size: (0.8 + r() * 5.6).toFixed(1) + ' MB',
      checksum: (function () { var s = ''; for (var i = 0; i < 16; i++) s += '0123456789abcdef'[rint(r, 0, 15)]; return s; })(),
      path: rec.networkPath, records: a.count
    };

    var steps = [step('Available at network', 'done', availAt, { note: 'at ' + rec.source })];
    rec.events.push({ at: availAt, by: 'availability-watcher', kind: 'normal', text: rec.file.name + ' became available at ' + rec.source + '.' });

    if (state === 'available') {
      steps.push(step('Downloaded', 'active', null, { note: 'awaiting operator' }));
      steps.push(step('Encrypted', 'todo')); steps.push(step('Placed in network folder', 'todo'));
      steps.push(step('Parsed', 'todo')); steps.push(step('Pushed to tables', 'todo')); steps.push(step('Reconciliation run', 'todo'));
      rec.steps = steps;
      return rec;
    }

    var stH = auth && auth.startedH != null ? auth.startedH : availH, stM = auth && auth.startedM != null ? auth.startedM : Math.min(59, availM + 2);
    rec.startedAt = stamp(nextDay, stH, stM);
    rec.startedBy = OPS_USER;
    rec.events.push({
      at: rec.startedAt, by: OPS_USER, kind: 'normal',
      text: 'Recorded as download started. The script runs in RDP against ' + rec.source + ' — this is the operator’s declaration, not an observation.'
    });

    if (state === 'downloading') {
      steps.push(step('Downloaded', 'active', rec.startedAt, { note: 'script running — keep the RDP session open' }));
      steps.push(step('Encrypted', 'todo')); steps.push(step('Placed in network folder', 'todo'));
      steps.push(step('Parsed', 'todo')); steps.push(step('Pushed to tables', 'todo')); steps.push(step('Reconciliation run', 'todo'));
      rec.steps = steps;
      return rec;
    }

    var dlH = availH, dlM = Math.min(59, availM + 7);
    rec.downloadedAt = stamp(nextDay, dlH, dlM);
    steps.push(step('Downloaded', 'done', rec.downloadedAt, { seconds: rint(r, 120, 260), note: 'to ' + rec.backupPath }));

    if (!reached(state, 'encrypted')) { rec.steps = fill(steps, ['Encrypted', 'Placed in network folder', 'Parsed', 'Pushed to tables', 'Reconciliation run']); return rec; }
    steps.push(step('Encrypted', 'done', stamp(nextDay, dlH, Math.min(59, dlM + 1)), { seconds: rint(r, 4, 22) }));

    if (!reached(state, 'in_folder')) { rec.steps = fill(steps, ['Placed in network folder', 'Parsed', 'Pushed to tables', 'Reconciliation run']); return rec; }
    steps.push(step('Placed in network folder', 'done', stamp(nextDay, dlH, Math.min(59, dlM + 2)), { note: rec.networkPath }));

    /* ---- Parse failed ----------------------------------------------------- */
    if (state === 'parse_failed') {
      steps.push(step('Parsed', 'failed', stamp(nextDay, dlH, Math.min(59, dlM + 5)), {
        seconds: rint(r, 3, 19), error_code: auth.code, error_detail: auth.detail
      }));
      steps.push(step('Pushed to tables', 'todo'));
      steps.push(step('Reconciliation run', 'todo'));
      rec.steps = steps;
      rec.events.push({ at: stamp(nextDay, dlH, Math.min(59, dlM + 5)), by: 'incoming-parser', kind: 'nullified', text: 'Parse failed — ' + auth.code + '.', reason: auth.detail });
      return rec;
    }

    if (!reached(state, 'parsed')) { rec.steps = fill(steps, ['Parsed', 'Pushed to tables', 'Reconciliation run']); return rec; }
    rec.parsedAt = stamp(nextDay, dlH, Math.min(59, dlM + 5));
    steps.push(step('Parsed', 'done', rec.parsedAt, { seconds: rint(r, 8, 40), records: a.count }));

    if (!reached(state, 'pushed')) { rec.steps = fill(steps, ['Pushed to tables', 'Reconciliation run']); return rec; }
    rec.pushedAt = stamp(nextDay, dlH, Math.min(59, dlM + 6));
    steps.push(step('Pushed to tables', 'done', rec.pushedAt, { records: a.count }));
    rec.events.push({ at: rec.pushedAt, by: 'incoming-parser', kind: 'normal', text: a.count + ' records pushed to tables. Reconciliation triggers off this step.' });

    if (!reached(state, 'reconciled')) { rec.steps = fill(steps, ['Reconciliation run']); return rec; }
    rec.reconciledAt = stamp(nextDay, dlH + (dlM + 11 > 59 ? 1 : 0), (dlM + 11) % 60);
    steps.push(step('Reconciliation run', 'done', rec.reconciledAt));
    rec.steps = steps;
    return rec;
  }
  /* Everything after the step that stopped is `todo` — never a fabricated
     timestamp and never a state it did not reach. */
  function fill(steps, names) {
    var out = steps.slice();
    var first = true;
    names.forEach(function (n) { out.push(step(n, first ? 'active' : 'todo')); first = false; });
    return out;
  }

  /* =========================================================================
     THE CACHE — records are mutated by the operator actions, so built once.
     ========================================================================= */
  var outByDate = {}, inByDate = {};
  function outFor(date) {
    if (outByDate[date]) return outByDate[date];
    var dayIdx = DATES.length - 1 - DATES.indexOf(date);
    var out = [];
    O.tenants.forEach(function (t) {
      netsFor(t.id).forEach(function (net) {
        var hol = C.holidayFor ? C.holidayFor(t.id, date) : null;
        if (hol && hol.impact === 'Full holiday') return;   // no clearing on a full bank holiday
        out.push(buildOutgoing(t.id, net.key, date, dayIdx));
      });
    });
    outByDate[date] = out;
    return out;
  }
  function inFor(date) {
    if (inByDate[date]) return inByDate[date];
    var dayIdx = DATES.length - 1 - DATES.indexOf(date);
    var out = [];
    O.tenants.forEach(function (t) {
      netsFor(t.id).forEach(function (net) {
        var hol = C.holidayFor ? C.holidayFor(t.id, date) : null;
        if (hol && hol.impact === 'Full holiday') return;
        out.push(buildIncoming(t.id, net.key, date, dayIdx));
      });
    });
    inByDate[date] = out;
    return out;
  }
  function rowsForRange(dir, from, to) {
    var out = [];
    DATES.forEach(function (d) {
      if (d < from || d > to) return;
      out = out.concat(dir === 'incoming' ? inFor(d) : outFor(d));
    });
    return out;
  }
  var _idx = { outgoing: null, incoming: null };
  function byId(dir, id) {
    if (!_idx[dir]) {
      _idx[dir] = {};
      rowsForRange(dir, DATES[0], DATES[DATES.length - 1]).forEach(function (rec) { _idx[dir][rec.id] = rec; });
    }
    return _idx[dir][id] || null;
  }
  /* A well-formed cycle ID with no record yet still resolves — Reconciliation
     and the Cycle Snapshot both link by ID. */
  function resolve(dir, id) {
    var hit = byId(dir, id);
    if (hit) return hit;
    var p = O.parseCycleId(id);
    if (!p || !O.netEnabled(p.tenantId, p.networkKey) || !STAGEABLE[p.networkKey]) return null;
    if (DATES.indexOf(p.date) < 0) return null;
    var dayIdx = DATES.length - 1 - DATES.indexOf(p.date);
    var extra = dir === 'incoming'
      ? buildIncoming(p.tenantId, p.networkKey, p.date, dayIdx)
      : buildOutgoing(p.tenantId, p.networkKey, p.date, dayIdx);
    extra.id = id;
    _idx[dir][id] = extra;
    return extra;
  }

  /* =========================================================================
     TRANSITIONS — every one is an operator declaration or a file landing.
     Nothing here observes an RDP session.
     ========================================================================= */
  function setStep(rec, name, state, at, extra) {
    for (var i = 0; i < rec.steps.length; i++) {
      if (rec.steps[i].name === name) {
        rec.steps[i].state = state;
        if (at !== undefined) rec.steps[i].at = at;
        if (extra) Object.keys(extra).forEach(function (k) { rec.steps[i][k] = extra[k]; });
        return rec.steps[i];
      }
    }
    return null;
  }

  /* PART 5.3 — the whole point of the section. Clicking "I've started staging"
     moves the record on and records WHO and WHEN, so anyone opening this cycle
     afterwards sees the work is already underway. */
  function startStaging(rec, by) {
    if (!rec || rec.state !== 'ready') return rec;
    rec.state = 'staging';
    rec.startedAt = nowStamp();
    rec.startedBy = by || OPS_USER;
    setStep(rec, 'Ready to stage', 'done', rec.startedAt, { note: 'staging started by ' + rec.startedBy });
    setStep(rec, 'Decrypted to backup folder', 'active', null, { note: 'script running' });
    rec.events.push({
      at: rec.startedAt, by: rec.startedBy, kind: 'normal',
      text: 'Recorded as staging started against ' + stageTool(rec.networkKey) + '. This is the operator’s declaration — the dashboard cannot see the RDP session.'
    });
    return rec;
  }
  /* Staging a second time is possible and sometimes correct, but it is never
     silent: a 40-character reason is required and the cycle is tagged
     permanently. */
  function stageAgain(rec, reason, by) {
    if (!rec) return rec;
    rec.overrideReason = reason;
    rec.overrideAt = nowStamp();
    rec.overrideBy = by || OPS_USER;
    rec.events.push({
      at: rec.overrideAt, by: rec.overrideBy, kind: 'correction',
      text: 'Staged again after this cycle was already underway. The cycle is tagged permanently.', reason: reason
    });
    return rec;
  }
  function startDownload(rec, by) {
    if (!rec || rec.state !== 'available') return rec;
    rec.state = 'downloading';
    rec.startedAt = nowStamp();
    rec.startedBy = by || OPS_USER;
    setStep(rec, 'Downloaded', 'active', rec.startedAt, { note: 'script running' });
    rec.events.push({
      at: rec.startedAt, by: rec.startedBy, kind: 'normal',
      text: 'Recorded as download started from ' + rec.source + '. This is the operator’s declaration — the dashboard cannot see the RDP session.'
    });
    return rec;
  }
  function downloadAgain(rec, reason, by) {
    if (!rec) return rec;
    rec.overrideReason = reason;
    rec.overrideAt = nowStamp();
    rec.overrideBy = by || OPS_USER;
    rec.events.push({
      at: rec.overrideAt, by: rec.overrideBy, kind: 'correction',
      text: 'Download run again after this cycle was already underway. The cycle is tagged permanently.', reason: reason
    });
    return rec;
  }
  /* The manual proof upload, for when automated pickup missed the file. */
  function applyProof(rec, name, by) {
    if (!rec) return rec;
    rec.proofAt = nowStamp();
    rec.proof = { file: name, receivedAt: rec.proofAt, acceptedCount: rec.count, path: rec.networkPath, manual: true };
    rec.state = 'confirmed';
    setStep(rec, 'Staging proof received', 'done', rec.proofAt, { records: rec.count, note: 'uploaded by ' + (by || OPS_USER), error_code: null, error_detail: null });
    rec.events.push({
      at: rec.proofAt, by: by || OPS_USER, kind: 'correction',
      text: 'Staging proof ' + name + ' uploaded manually and matched to this cycle.',
      reason: 'Automated pickup did not collect the proof file; supplied by the operator.'
    });
    return rec;
  }

  /* =========================================================================
     READS FOR OTHER SCREENS
     ========================================================================= */
  /* Ops Home's outgoing / incoming queues (Part 2.3), most recent first. */
  function outgoingIssues(days) {
    var from = U.addDays(CYCLE_TODAY, -(days || 3) + 1);
    return rowsForRange('outgoing', from, CYCLE_TODAY).filter(function (rec) {
      return rec.state === 'ready' || rec.state === 'proof_overdue' || rec.state === 'failed';
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return rank(a) - rank(b);
    });
    function rank(rec) { return rec.state === 'failed' ? 0 : (rec.state === 'proof_overdue' ? 1 : 2); }
  }
  function incomingIssues(days) {
    var from = U.addDays(CYCLE_TODAY, -(days || 3) + 1);
    return rowsForRange('incoming', from, CYCLE_TODAY).filter(function (rec) {
      return rec.state === 'available' || rec.state === 'parse_failed' || rec.state === 'parsed';
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return rank(a) - rank(b);
    });
    function rank(rec) { return rec.state === 'parse_failed' ? 0 : (rec.state === 'available' ? 1 : 2); }
  }
  function forCycle(dir, tenantId, netKey, date) { return byId(dir, O.cycleId(tenantId, netKey, date, 1)); }
  function failedStep(rec) {
    for (var i = 0; i < rec.steps.length; i++) if (rec.steps[i].state === 'failed') return rec.steps[i];
    return null;
  }

  return {
    TODAY: TODAY, CYCLE_TODAY: CYCLE_TODAY, WINDOW: WINDOW, DATES: DATES, OPS_USER: OPS_USER,
    OUT_STATES: OUT_STATES, OUT_KEYS: OUT_KEYS, IN_STATES: IN_STATES, IN_KEYS: IN_KEYS,
    STAGING_STARTED: STAGING_STARTED, PROOF_WINDOW_HOURS: PROOF_WINDOW_HOURS,
    isAttention: isAttention, needsOperator: needsOperator, netsFor: netsFor,
    outFileName: outFileName, inFileName: inFileName, proofFileName: proofFileName,
    s3Network: s3Network, s3Backup: s3Backup, sourceName: sourceName, stageTool: stageTool,
    durLabel: durLabel,
    outFor: outFor, inFor: inFor, rowsForRange: rowsForRange, byId: byId, resolve: resolve,
    startStaging: startStaging, stageAgain: stageAgain,
    startDownload: startDownload, downloadAgain: downloadAgain, applyProof: applyProof,
    outgoingIssues: outgoingIssues, incomingIssues: incomingIssues,
    forCycle: forCycle, failedStep: failedStep
  };
})();
