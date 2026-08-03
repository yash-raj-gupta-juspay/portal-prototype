/* =============================================================================
   Juspay Ops Portal — The Run model (Observability & RCA brief, Part 3)

   Everything in the observability brief rests on this file. Every automated or
   manual operation the platform performs is a Run: clearing generate, clearing
   stage, incoming fetch, incoming parse, settlement generate, settlement
   deliver, reconciliation and file validation. A Run is a sequence of named
   stages, and a failure is attributed to EXACTLY ONE stage — that is what lets
   the RCA card be specific rather than generic.

   Runs are generated deterministically from the cycle timing model already in
   the build (window.CYCLES) rather than alongside it. A clearing generate
   finishes 14 minutes before the CLR leg lands and a clearing stage 3 minutes
   after it, which is precisely what reproduces the incident's 21:47 / 22:04 /
   02:52 timestamps out of data the prototype already had.

   Nothing here talks to a backend. Guard evaluation, duplicate detection and
   run execution are all mocked — but they are mocked as functions over the run
   history rather than as hardcoded answers, so the launcher's live guards and
   the Run Console's blocked runs genuinely agree with one another.

   Per Part 3.1 a run carries `rca` only when it is failed or blocked. That
   block — interpolation values, the evidence excerpt and the technical log —
   is built here; runs-rca.js only renders it.

   window.RUNS is consumed by runs-rca.js, runs-screen.js and every screen that
   surfaces an RCA card.
   ============================================================================= */
window.RUNS = (function () {
  'use strict';

  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES, E = window.RUN_ERRORS;

  /* ---- deterministic helpers (same shape as every other data module) ------ */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function rint(r, a, b) { return Math.floor(a + r() * (b - a + 1)); }
  function pick(r, a) { return a[Math.floor(r() * a.length)]; }
  function seedOf(str) { var s = 7; for (var i = 0; i < String(str).length; i++) s = (s * 31 + String(str).charCodeAt(i)) >>> 0; return s; }
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function round2(n) { return Math.round(n * 100) / 100; }
  // Counts use the same Indian grouping the rest of the portal uses.
  function nfmt(n) {
    var s = String(Math.round(n));
    if (s.length <= 3) return s;
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  function bytes(n) {
    if (n == null) return '—';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  var TODAY = C.TODAY;                 // 2025-11-21 — processing day
  var CYCLE_TODAY = C.CYCLE_TODAY;     // 2025-11-20 — current cycle date
  var NOW_ABS = C.NOW_ABS;             // T+1 09:00 IST, on the current cycle's axis
  var OPS_USER = 'ops.analyst@juspay.in';
  var CHECKER_USER = 'rahul.menon@juspay.in';

  /* =========================================================================
     PART 3.1 — RUN TYPES
     `leg` ties a run type back to the cycle model's four legs, which is how the
     Cycle Snapshot finds the run behind a leg and how the leg lock knows what
     "already done" means. `legLock: true` marks the four legs that must not run
     twice (Part 7.2) — incoming parse, reconciliation and file validation are
     deliberately absent from that set, because re-running them is safe and
     often necessary.
     ========================================================================= */
  var TYPES = [
    {
      id: 'CLEARING_GENERATE', label: 'Clearing generate', opLabel: 'Generate clearing file',
      opBlurb: 'Build the outgoing clearing file from this cycle’s transactions.',
      direction: 'outgoing', leg: 'clearing', legLock: true, networked: true, icon: 'file-cog',
      stages: ['Pre-flight checks', 'Fetch transactions', 'Apply layout', 'Apply transforms', 'Write file', 'Upload to S3'],
      requires: null
    },
    {
      id: 'CLEARING_STAGE', label: 'Clearing stage', opLabel: 'Stage clearing file to network',
      opBlurb: 'Transmit the generated clearing file to the network and wait for its acknowledgment.',
      direction: 'outgoing', leg: 'clearing', legLock: true, networked: true, icon: 'upload-cloud',
      stages: ['Pre-flight checks', 'Verify file', 'Transmit to network', 'Await acknowledgment'],
      requires: 'CLEARING_GENERATE'
    },
    {
      id: 'INCOMING_FETCH', label: 'Incoming fetch', opLabel: 'Fetch incoming file only',
      opBlurb: 'Collect the network’s response file without parsing it. Safe to repeat.',
      direction: 'incoming', leg: 'incoming', legLock: false, networked: true, icon: 'download',
      stages: ['Pre-flight checks', 'Locate file at source', 'Download', 'Verify checksum'],
      requires: null
    },
    {
      id: 'INCOMING_PARSE', label: 'Incoming parse', opLabel: 'Fetch and parse incoming file',
      opBlurb: 'Collect the network’s response file and load its records. Safe to repeat.',
      direction: 'incoming', leg: 'incoming', legLock: false, networked: true, icon: 'file-input',
      stages: ['Pre-flight checks', 'Fetch file', 'Decrypt', 'Detect layout', 'Parse records', 'Map fields', 'Persist', 'Reconcile counts'],
      requires: null
    },
    /* Settlement files are acquirer artifacts, keyed tenant × cycle × file type
       with no network dimension — the rule the Settlement File Monitoring
       screen is built on. A settlement run therefore carries network: null and
       is timed off the tenant's primary network leg. */
    {
      id: 'SETTLEMENT_GENERATE', label: 'Settlement generate', opLabel: 'Generate settlement files',
      opBlurb: 'Build this acquirer’s settlement reports for the cycle. Acquirer files — no network dimension.',
      direction: 'outgoing', leg: 'settlement', legLock: true, networked: false, icon: 'file-spreadsheet',
      stages: ['Pre-flight checks', 'Resolve schedule', 'Fetch transactions', 'Apply report config', 'Apply fee rules', 'Write file'],
      requires: null
    },
    {
      id: 'SETTLEMENT_DELIVER', label: 'Settlement deliver', opLabel: 'Deliver settlement files',
      opBlurb: 'Send the generated settlement reports to the acquirer.',
      direction: 'outgoing', leg: 'settlement', legLock: true, networked: false, icon: 'send',
      stages: ['Pre-flight checks', 'Resolve generated files', 'Verify checksums', 'Deliver to acquirer', 'Await acknowledgment'],
      requires: 'SETTLEMENT_GENERATE'
    },
    {
      id: 'RECONCILIATION', label: 'Reconciliation', opLabel: 'Run reconciliation',
      opBlurb: 'Compare what we submitted against what the network settled. Idempotent.',
      direction: null, leg: null, legLock: false, networked: false, icon: 'git-compare',
      stages: ['Pre-flight checks', 'Load submitted position', 'Load settled position', 'Compute expected delta', 'Compute residual'],
      requires: null
    },
    {
      id: 'FILE_VALIDATE', label: 'File validation', opLabel: 'Validate a settlement file',
      opBlurb: 'Compare a generated file against the base source data. Idempotent.',
      direction: null, leg: null, legLock: false, networked: false, icon: 'shield-check',
      stages: ['Pre-flight checks', 'Load file', 'Load source data', 'Compare counts', 'Compare sums', 'Compare records'],
      requires: null
    }
  ];
  var typeById = {}; TYPES.forEach(function (t) { typeById[t.id] = t; });

  /* Part 7.5 — the launcher's operation list IS the run-type list. If an
     operation the platform performs were missing here, operators would keep
     hand-editing scripts for it and none of these guards would apply. */
  var OPERATIONS = TYPES.map(function (t) { return t.id; });

  var STATUS_META = {
    queued: { label: 'Queued', kind: 'neutral', icon: 'clock' },
    running: { label: 'Running', kind: 'info', icon: 'loader' },
    succeeded: { label: 'Succeeded', kind: 'success', icon: 'check-circle' },
    failed: { label: 'Failed', kind: 'danger', icon: 'x-circle' },
    blocked: { label: 'Blocked', kind: 'warning', icon: 'shield-alert' },
    cancelled: { label: 'Cancelled', kind: 'neutral', icon: 'ban' }
  };

  /* =========================================================================
     SOURCES & FILE IDENTITY
     The "expected source" registry is what the source-mismatch guard checks
     against. Every tenant × network takes its clearing file from one place; the
     incident happened because a file from somewhere else was staged.
     ========================================================================= */
  var EXPECTED_SOURCE = {};
  O.tenants.forEach(function (t) {
    D.NETWORKS.forEach(function (n) { EXPECTED_SOURCE[t.id + '|' + n.key] = 'In-house'; });
  });
  var CLR_EXT = { visa: 'ctf', mc: 'ipm', rupay: 'npci', onus: 'csv' };
  var INC_NAME = { visa: 'VSS_TC46', mc: 'GCMS_T140', rupay: 'NPCI_RAW', onus: 'ONUS_RESP' };
  var INC_EXT = { visa: 'dat', mc: 'ipm', rupay: 'txt', onus: 'csv' };
  var NET_ENDPOINT = {
    visa: 'vss-edit.visa.com:8022', mc: 'mft.mastercard.com:2200',
    rupay: 'npcinet.npci.org.in:22', onus: 'onus-internal.hsbc.net:22'
  };
  var ACQ_ENDPOINT = {
    yesbank: 'sftp.yesbank.in:2022', 'hsbc-in': 'sftp.hsbc.co.in:2022',
    'hsbc-sg': 'sftp.hsbc.com.sg:2022', 'hsbc-hk': 'sftp.hsbc.com.hk:2022'
  };
  var PRIMARY_REPORT = { yesbank: 'GEFU1 — Gross Entry File Upload' };
  function reportNameFor(tenantId) { return PRIMARY_REPORT[tenantId] || 'MPR — Merchant Payout Report'; }

  function tenantSlug(tenantId) { return (O.tenantById[tenantId] || { name: tenantId }).name.replace(/\s/g, ''); }
  function netOf(k) { return k ? D.NET_BY_KEY[k] : null; }
  function netName(k) { return k ? ((D.NET_BY_KEY[k] || {}).name || k) : null; }
  function checksumOf(seed) {
    var r = rng(seed), s = '';
    for (var i = 0; i < 8; i++) s += '0123456789abcdef'[rint(r, 0, 15)];
    return 'sha256:' + s + '…';
  }
  /* The tenant's primary enabled network — settlement, reconciliation and
     validation runs have no network of their own, so they are timed off it. */
  function primaryNetwork(tenantId) {
    var nets = C.networksFor(tenantId);
    return nets.length ? nets[0].key : 'visa';
  }
  function fileNames(type, tenantId, netKey, date) {
    var slug = tenantSlug(tenantId), compact = date.replace(/-/g, '');
    var net = netOf(netKey);
    if (type === 'CLEARING_GENERATE' || type === 'CLEARING_STAGE') {
      return {
        input: slug + '_' + (net ? net.short.toUpperCase() : 'ALL') + '_TXN_EXTRACT_' + compact + '.csv',
        output: slug + '_' + (net ? net.short.toUpperCase() : 'ALL') + '_CLEARING_' + compact + '.' + (CLR_EXT[netKey] || 'dat')
      };
    }
    if (type === 'INCOMING_FETCH' || type === 'INCOMING_PARSE') {
      return { input: (INC_NAME[netKey] || 'RESPONSE') + '_' + slug + '_' + compact + '.' + (INC_EXT[netKey] || 'dat'), output: null };
    }
    if (type === 'SETTLEMENT_GENERATE' || type === 'SETTLEMENT_DELIVER' || type === 'FILE_VALIDATE') {
      var ft = (tenantId === 'yesbank') ? 'GEFU1' : 'MPR';
      return { input: slug + '_SETTLED_TXNS_' + compact + '.csv', output: slug + '_' + ft + '_' + compact + '.csv' };
    }
    return { input: null, output: null };
  }

  /* =========================================================================
     TIME
     Runs live on the cycle model's axis: absolute minutes from the cycle date's
     00:00 IST. `dateAt` turns that back into a calendar day, which is what the
     run ID and the console's date filter use.
     ========================================================================= */
  function stampOf(cycleDate, abs) { return C.stamp(cycleDate, abs); }
  function dayOfRun(cycleDate, abs) { return C.dateAt(cycleDate, abs); }
  function clock(abs, sec) { return C.hhmm(abs) + ':' + pad(sec == null ? 0 : sec % 60); }
  function durLabel(sec) {
    if (sec == null) return '—';
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + 'm ' + pad(s) + 's';
    return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  }

  /* The store, declared before anything that reads it. */
  var runs = [];
  var byId = {};

  /* =========================================================================
     LOOKUP PRIMITIVES
     netKey semantics: `undefined` means "any network"; any other value —
     INCLUDING null — is matched exactly, because null is how an acquirer-level
     run (settlement, reconciliation, validation) records "no network".
     ========================================================================= */
  function runsFor(tenantId, netKey, cycleDate, type) {
    return runs.filter(function (r) {
      if (r.tenantId !== tenantId) return false;
      if (cycleDate && r.cycleDate !== cycleDate) return false;
      if (netKey !== undefined && (r.networkKey || null) !== (netKey || null)) return false;
      if (type && r.type !== type) return false;
      return true;
    });
  }
  function succeededRuns(tenantId, netKey, cycleDate, type) {
    return runsFor(tenantId, netKey, cycleDate, type)
      .filter(function (r) { return r.status === 'succeeded' && !r.voided; })
      .sort(function (a, b) { return a.startAbs - b.startAbs; });
  }
  function lastSucceeded(tenantId, netKey, cycleDate, type) {
    var list = succeededRuns(tenantId, netKey, cycleDate, type);
    return list.length ? list[list.length - 1] : null;
  }
  /* The leg lock cites the run that FIRST took the leg, not the most recent
     one. On a cycle that was staged twice, "already staged at 22:04 on 20 Nov"
     is the fact that matters; "09:18" would point at the duplicate. */
  function firstSucceeded(tenantId, netKey, cycleDate, type) {
    return succeededRuns(tenantId, netKey, cycleDate, type)[0] || null;
  }

  /* =========================================================================
     PART 7.2 / 7.3 — GUARDS
     Evaluated over the run history rather than hardcoded, which is what makes
     the launcher's live guard results and the Run Console's blocked runs agree.
     Defined before generation because the blocked runs carry their own results.
     ========================================================================= */
  var CHECK_DEFS = [
    { key: 'leglock', label: 'Cycle leg lock' },
    { key: 'filedate', label: 'File date matches cycle' },
    { key: 'duplicate', label: 'Duplicate file' },
    { key: 'source', label: 'Expected source' },
    { key: 'cutoff', label: 'Cutoff passed' },
    { key: 'priorleg', label: 'Prior leg complete' },
    { key: 'config', label: 'Config approved' }
  ];
  var CHECK_LABEL = {}; CHECK_DEFS.forEach(function (c) { CHECK_LABEL[c.key] = c.label; });

  var GUARD_CODE_BY_CHECK = {
    leglock: 'GUARD_CYCLE_ALREADY_STAGED', filedate: 'GUARD_FILE_DATE_MISMATCH',
    duplicate: 'GUARD_DUPLICATE_FILE', source: 'GUARD_SOURCE_MISMATCH', cutoff: 'GUARD_CUTOFF_PASSED',
    priorleg: 'GUARD_PRIOR_LEG_INCOMPLETE', config: 'GUARD_CONFIG_UNAPPROVED'
  };

  /* Launcher demo conditions — filled in below from BLOCKED_SPECS so the file
     a selection would act on is stale / duplicated / wrong-source for exactly
     the selections whose blocked runs are in the history. */
  var PENDING_ANOMALY = {};

  /* The file this run would act on. */
  function pendingFile(type, tenantId, netKey, cycleDate) {
    var def = typeById[type];
    if (!def) return null;
    var names = fileNames(type, tenantId, netKey, cycleDate);
    var name = (def.direction === 'incoming') ? names.input : (names.output || names.input);
    if (!name) return null;
    var f = {
      name: name,
      source: (def.direction === 'incoming' && netKey) ? netName(netKey) : (EXPECTED_SOURCE[tenantId + '|' + netKey] || 'In-house'),
      checksum: checksumOf(seedOf('pending|' + tenantId + '|' + netKey + '|' + cycleDate + '|' + type)),
      fileDate: cycleDate,
      sizeBytes: 1200000 + (seedOf(name) % 4200000)
    };
    var anom = PENDING_ANOMALY[tenantId + '|' + netKey + '|' + cycleDate + '|' + type];
    if (!anom) return f;
    if (anom.kind === 'filedate') f.fileDate = anom.fileDate;
    if (anom.kind === 'source') f.source = anom.source;
    if (anom.kind === 'duplicate') {
      var prior = lastSucceeded(tenantId, netKey, cycleDate, type);
      if (prior && prior.inputFile) { f.checksum = prior.inputFile.checksum; f.priorRunId = prior.runId; f.priorDay = prior.startDay; }
    }
    return f;
  }

  function cutoffInfo(tenantId, netKey, cycleDate, legKey) {
    if (!legKey) return null;
    var sched = C.scheduleFor(tenantId)[legKey];
    if (!sched) return null;
    // The observer's clock on the selected cycle's own axis: a cycle from last
    // week is long past every cutoff it ever had.
    var nowOnAxis = Math.round((U.fromYmd(TODAY) - U.fromYmd(cycleDate)) / 86400000) * 1440 + (NOW_ABS - 1440);
    return {
      cutoff: sched.cutoff, now: nowOnAxis, passed: nowOnAxis > sched.cutoff,
      overdueMin: Math.max(0, nowOnAxis - sched.cutoff), label: C.hhmm(sched.cutoff)
    };
  }

  /* Configs are keyed with underscores in the config store and hyphens here. */
  function cfgTenant(tenantId) { return String(tenantId).replace(/-/g, '_'); }
  function famForType(type) {
    if (type === 'INCOMING_PARSE' || type === 'INCOMING_FETCH') return 'incoming-parsing';
    if (type === 'SETTLEMENT_GENERATE' || type === 'SETTLEMENT_DELIVER' || type === 'FILE_VALIDATE') return 'settlement';
    return 'network-file';
  }
  function draftConfigFor(type, tenantId, netKey) {
    var CD = window.CFGDATA;
    if (!CD || !CD.configs) return null;
    var fam = famForType(type), tk = cfgTenant(tenantId);
    return CD.configs.filter(function (c) {
      if (c.family !== fam || c.tenantId !== tk) return false;
      if (fam === 'network-file' && netKey && c.network && c.network !== netKey) return false;
      return c.state === 'PENDING_APPROVAL' || c.state === 'DRAFT';
    })[0] || null;
  }

  /* preflight → all seven checks, every time, including the ones that pass.
     Seeing that seven checks passed is itself the reassurance (Part 7.3). */
  function preflightFor(type, tenantId, netKey, cycleDate, forceCode) {
    var def = typeById[type];
    if (!def) return [];
    var nk = def.networked ? netKey : null;
    var out = [];
    var file = pendingFile(type, tenantId, netKey, cycleDate);
    function add(key, status, message) { out.push({ key: key, label: CHECK_LABEL[key] || key, status: status, message: message }); }

    /* 1 · Cycle leg lock — only the four legs that must not run twice. */
    if (!def.legLock) {
      add('leglock', 'skip', def.label + ' is safe to repeat — the leg lock does not apply to it.');
    } else {
      var prior = firstSucceeded(tenantId, nk, cycleDate, type);
      if (prior) {
        var verb = type === 'CLEARING_STAGE' ? 'Clearing was already staged'
          : type === 'CLEARING_GENERATE' ? 'The clearing file was already generated'
            : type === 'SETTLEMENT_GENERATE' ? 'Settlement files were already generated'
              : 'Settlement files were already delivered';
        add('leglock', 'block', verb + ' for this cycle at ' + C.hhmm(prior.endAbs) + ' on ' + U.prettyDate(prior.startDay) + '.');
      } else {
        add('leglock', 'pass', 'This leg has not succeeded for this cycle yet.');
      }
    }

    /* 2 · File date matches cycle. */
    if (!file) add('filedate', 'skip', 'This operation does not act on a file.');
    else if (file.fileDate !== cycleDate) add('filedate', 'block', 'This file is dated ' + U.prettyDate(file.fileDate) + ' but the cycle is ' + U.prettyDate(cycleDate) + '.');
    else add('filedate', 'pass', 'The file’s internal date matches the cycle date.');

    /* 3 · Duplicate file — this exact checksum already processed. */
    if (!file) add('duplicate', 'skip', 'This operation does not act on a file.');
    else {
      var same = runs.filter(function (r) {
        return r.status === 'succeeded' && !r.voided && r.inputFile &&
          r.inputFile.checksum === file.checksum && r.tenantId === tenantId &&
          (r.networkKey || null) === (nk || null);
      })[0];
      if (same) add('duplicate', 'block', 'This exact file was already processed on ' + U.prettyDate(same.startDay) + ' in run ' + same.runId + '.');
      else add('duplicate', 'pass', 'This file’s checksum has not been seen before.');
    }

    /* 4 · Expected source — outgoing files only. */
    var expected = EXPECTED_SOURCE[tenantId + '|' + netKey];
    if (!file || !netKey || def.direction !== 'outgoing') add('source', 'skip', 'Source checking applies to outgoing files only.');
    else if (file.source !== expected) add('source', 'block', 'This file came from ' + file.source + '. ' + (O.tenantById[tenantId] || {}).name + ' ' + netName(netKey) + ' expects ' + expected + '.');
    else add('source', 'pass', 'The file came from ' + expected + ', the configured source.');

    /* 5 · Cutoff — WARNS, never blocks (Part 7.3). */
    var ci = cutoffInfo(tenantId, def.networked ? netKey : primaryNetwork(tenantId), cycleDate, def.leg);
    if (!ci) add('cutoff', 'skip', 'This operation has no scheduled cutoff.');
    else if (ci.passed) add('cutoff', 'warn', 'The cutoff for this leg passed ' + C.dur(ci.overdueMin) + ' ago.');
    else add('cutoff', 'pass', 'Inside the ' + ci.label + ' IST cutoff for this leg.');

    /* 6 · Prior leg complete. */
    if (def.requires) {
      var reqDef = typeById[def.requires];
      var req = lastSucceeded(tenantId, reqDef.networked ? netKey : null, cycleDate, def.requires);
      if (req) add('priorleg', 'pass', reqDef.label + ' succeeded for this cycle at ' + C.hhmm(req.endAbs) + '.');
      else add('priorleg', 'block', reqDef.label + ' has not succeeded for this cycle yet.');
    } else if (type === 'INCOMING_PARSE' || type === 'INCOMING_FETCH') {
      var staged = lastSucceeded(tenantId, netKey, cycleDate, 'CLEARING_STAGE');
      if (staged) add('priorleg', 'pass', 'Clearing was staged for this cycle at ' + C.hhmm(staged.endAbs) + '.');
      else add('priorleg', 'block', 'Clearing has not been staged for this cycle yet, so there is nothing for the network to respond to.');
    } else if (type === 'RECONCILIATION') {
      var inc = lastSucceeded(tenantId, primaryNetwork(tenantId), cycleDate, 'INCOMING_PARSE');
      if (inc) add('priorleg', 'pass', 'Incoming has been received for this cycle.');
      else add('priorleg', 'block', 'Incoming hasn’t been received for this cycle yet.');
    } else if (type === 'FILE_VALIDATE') {
      var gen = lastSucceeded(tenantId, null, cycleDate, 'SETTLEMENT_GENERATE');
      if (gen) add('priorleg', 'pass', 'Settlement files exist for this cycle.');
      else add('priorleg', 'block', 'No settlement files have been generated for this cycle yet.');
    } else {
      add('priorleg', 'pass', 'This operation has no prerequisite leg.');
    }

    /* 7 · Config approved. */
    var draft = draftConfigFor(type, tenantId, netKey);
    if (draft) add('config', 'block', 'The configuration for this run has unapproved changes — ' + draft.name + ' is ' + (draft.state === 'DRAFT' ? 'an unsubmitted draft' : 'waiting for approval') + '.');
    else add('config', 'pass', 'Every configuration this run would use is approved and live.');

    /* Replaying an authored blocked run: the guard it was blocked by is
       authoritative, because the run happened before the history said what it
       says now. The cutoff check is never promoted — it cannot block. */
    if (forceCode && forceCode !== 'GUARD_CUTOFF_PASSED') {
      var want = { GUARD_CYCLE_ALREADY_STAGED: 'leglock', GUARD_FILE_DATE_MISMATCH: 'filedate', GUARD_DUPLICATE_FILE: 'duplicate', GUARD_SOURCE_MISMATCH: 'source' }[forceCode];
      out.forEach(function (c) { if (c.key === want && c.status !== 'block') c.status = 'block'; });
    }
    return out;
  }
  function blockingChecks(checks) { return (checks || []).filter(function (c) { return c.status === 'block'; }); }
  function warnChecks(checks) { return (checks || []).filter(function (c) { return c.status === 'warn'; }); }

  /* =========================================================================
     PART 12 — AUTHORED SCENARIOS
     Every catalog entry needs at least one failed run behind it so its card is
     demonstrable. Most authored failures are FIRST ATTEMPTS followed by a
     successful retry: that is what keeps the Run Console's failures consistent
     with the Cycle Snapshot, which shows those legs complete. Only where the
     cycle model itself declares a failed leg does the run stay terminally
     failed — and those are exactly the legs that render the RCA inline.
     ========================================================================= */
  var AUTHORED = {};
  function authored(tenantId, netKey, date, type, spec) {
    AUTHORED[tenantId + '|' + (netKey || '-') + '|' + date + '|' + type] = spec;
  }
  function authoredFor(tenantId, netKey, date, type) {
    return AUTHORED[tenantId + '|' + (netKey || '-') + '|' + date + '|' + type] || null;
  }

  /* --- Terminal failures the cycle model already declares ------------------ */

  // YES BANK · Mastercard · 12 Nov — the cycle model's failed clearing leg.
  // Its note ("IPM rejected by GCMS … Message Reason Code 4808 on 214 records")
  // is exactly CLEARING_STAGE_REJECTED, so the run says what the Cycle Snapshot
  // has always said, now in the RCA card's language.
  authored('yesbank', 'mc', '2025-11-12', 'CLEARING_STAGE', {
    terminal: true, code: 'CLEARING_STAGE_REJECTED',
    values: { rejectedCount: '214', reasonCode: '4808', reasonText: 'missing interchange rate designator' }
  });

  // HSBC SG · 18 Nov — the cycle model's failed settlement leg: "214 records
  // with an unmapped MCC (6012)", i.e. no fee rule matched.
  authored('hsbc-sg', null, '2025-11-18', 'SETTLEMENT_GENERATE', {
    terminal: true, code: 'SETTLEMENT_FEE_RULE_MISSING',
    values: { unmatched: '214', unmatchedKey: 'MCC 6012 (payment facilitator) on Visa Credit Cross-border', tab: 'fees' }
  });

  /* --- One authored failure per remaining catalog entry -------------------- */

  authored('hsbc-sg', 'visa', '2025-11-16', 'INCOMING_PARSE', {
    code: 'PARSE_FIELD_UNMAPPED',
    values: { record: '4,182', totalRecords: '18,904', fieldName: 'mandate_type', start: '118', end: '121', length: '4', sampleValue: 'M001' }
  });
  authored('hsbc-in', 'mc', '2025-11-09', 'INCOMING_PARSE', {
    code: 'PARSE_LAYOUT_MISMATCH', values: { expectedWidth: '1,014', actualWidth: '1,036' }
  });
  authored('yesbank', 'visa', '2025-11-07', 'INCOMING_FETCH', {
    code: 'INCOMING_FILE_MISSING', values: { pollInterval: '5 minutes', firstPoll: '07:00', lastPoll: '09:30' }
  });
  authored('hsbc-hk', 'mc', '2025-11-10', 'INCOMING_PARSE', {
    code: 'INCOMING_DECRYPT_FAILED', values: { keyId: '0x7F3A21C9', knownKeyId: '0x4B18D002' }
  });
  authored('hsbc-in', 'rupay', '2025-11-14', 'INCOMING_PARSE', {
    code: 'PARSE_RECORD_COUNT_MISMATCH', values: { parsedRecords: '22,401', declaredRecords: '22,418', skippedRecords: '17' }
  });
  authored('yesbank', 'mc', '2025-11-05', 'INCOMING_PARSE', {
    code: 'PARSE_UNKNOWN_RECORD_TYPE', values: { record: '9,338', totalRecords: '31,022', recordType: '0640', occurrences: '112' }
  });

  authored('hsbc-hk', 'onus', '2025-11-08', 'CLEARING_GENERATE', { code: 'CLEARING_TXN_FETCH_EMPTY', values: {} });
  authored('hsbc-hk', 'visa', '2025-11-13', 'CLEARING_GENERATE', {
    code: 'CLEARING_LAYOUT_INVALID', configFailure: true,
    values: { fieldA: 'merchant_postal_code', aStart: '138', aEnd: '143', fieldB: 'acquirer_reference', bStart: '142', bEnd: '165' }
  });
  authored('hsbc-in', 'visa', '2025-11-15', 'CLEARING_GENERATE', {
    code: 'CLEARING_FIELD_OVERFLOW',
    values: { record: '8,914', totalRecords: '41,206', fieldName: 'merchant_name', fieldLength: '25', valueLength: '31', sampleValue: 'GLOBAL HOSPITALITY VENTURES' }
  });
  authored('yesbank', 'rupay', '2025-11-11', 'CLEARING_GENERATE', {
    code: 'CLEARING_TRANSFORM_MISSING', configFailure: true,
    values: { fieldName: 'reimbursement_attribute', totalRecords: '19,884', tab: 'mapping' }
  });
  authored('hsbc-sg', 'mc', '2025-11-06', 'CLEARING_STAGE', {
    code: 'CLEARING_STAGE_TIMEOUT', values: { timeoutLabel: '30 minutes' }
  });

  authored('hsbc-in', null, '2025-11-18', 'SETTLEMENT_GENERATE', {
    // 18 Nov is a full RBI bank holiday for the Indian tenants, so the schedule
    // genuinely excludes it. This failure has no retry, and needs none.
    code: 'SETTLEMENT_SCHEDULE_SKIPPED', noRetry: true,
    values: { scheduleDays: 'Monday to Friday, excluding bank holidays', tab: 'schedule', holidayClause: ' and a full bank holiday for HSBC IN' }
  });
  authored('yesbank', null, '2025-11-10', 'SETTLEMENT_GENERATE', {
    code: 'SETTLEMENT_SOURCE_EMPTY',
    values: { filterSummary: 'settlement_status = SETTLED and product = CREDIT', sourceRows: '28,410', tab: 'content' }
  });
  authored('hsbc-hk', null, '2025-11-17', 'SETTLEMENT_DELIVER', {
    code: 'SETTLEMENT_DELIVERY_FAILED',
    values: { attempts: '4', attemptWindow: '38 minutes', transportError: 'connection refused after 3 handshake retries' }
  });
  authored('hsbc-sg', null, '2025-11-19', 'FILE_VALIDATE', {
    code: 'SETTLEMENT_VALIDATION_MISMATCH', values: { mismatchCount: '6', mismatchField: 'merchant_net_amount' }
  });

  /* Part 12.1 — one unrecognised error, so the Part 4.3 unknown-cause path is
     walkable. The code is deliberately absent from the catalog: the card must
     say so honestly rather than reach for the nearest-looking entry. */
  authored('hsbc-in', 'visa', '2025-11-04', 'INCOMING_PARSE', {
    code: 'PARSE_SEGMENT_DECODE_PANIC', unknown: true, failStage: 'Parse records', values: {}
  });

  /* =========================================================================
     PART 12.3 — THE DUPLICATE STAGING INCIDENT
     Reproduced exactly. The timings fall out of the cycle model: HSBC HK · Visa
     lands its CLR leg at 22:01 on 20 Nov, so generate finishes 21:47 and stage
     22:04; incoming lands 21 Nov 02:52.
     ========================================================================= */
  var INCIDENT = {
    tenantId: 'hsbc-hk', networkKey: 'visa', cycleDate: '2025-11-20',
    firstRunId: 'RUN-20251120-0031',
    incomingRunId: 'RUN-20251121-0002',
    secondRunId: 'RUN-20251121-0007',
    blockedRunId: 'RUN-20251121-0014',
    txns: 24180,
    grossHKD: 17214953.27,      // ≈ ₹18.42 Cr at the platform's 1 HKD = ₹10.7
    firstChecksum: 'sha256:a3f91c47…',
    secondChecksum: 'sha256:77c2be08…',
    firstSource: 'In-house', secondSource: 'Mindeed'
  };
  authored(INCIDENT.tenantId, INCIDENT.networkKey, INCIDENT.cycleDate, 'CLEARING_STAGE', {
    pinId: INCIDENT.firstRunId, source: INCIDENT.firstSource, checksum: INCIDENT.firstChecksum,
    txns: INCIDENT.txns, gross: INCIDENT.grossHKD
  });
  // The incoming response covers the cohort the first file staged, so it reads
  // the same transaction count — the remediation view compares them directly.
  authored(INCIDENT.tenantId, INCIDENT.networkKey, INCIDENT.cycleDate, 'INCOMING_PARSE', {
    pinId: INCIDENT.incomingRunId, txns: INCIDENT.txns
  });

  /* =========================================================================
     PART 12.2 / 12.4 — BLOCKED RUNS
     One per blocking guard, so every blocked-run card and the override path are
     walkable. GUARD_CUTOFF_PASSED is absent by design: Part 7.3 makes it warn,
     not block, so it can never produce a blocked run — it appears as an amber
     pre-flight line instead.

     Note on 12.4: the brief identifies the later blocked attempt as
     RUN-20251122-0014 against cycle 21 Nov. Both sit in the future relative to
     this build's fixed clock (21 Nov 09:00 IST, current cycle 20 Nov), so it is
     placed at the latest consistent moment instead — same tenant, same
     operation, same guard, blocked six minutes after the duplicate went out.
     ========================================================================= */
  var BLOCKED_SPECS = [
    {
      runId: INCIDENT.blockedRunId, tenantId: 'hsbc-hk', networkKey: 'visa', cycleDate: '2025-11-20',
      type: 'CLEARING_STAGE', code: 'GUARD_CYCLE_ALREADY_STAGED', abs: 1440 + 9 * 60 + 24, by: OPS_USER
    },
    {
      tenantId: 'hsbc-sg', networkKey: 'mc', cycleDate: '2025-11-17',
      type: 'CLEARING_STAGE', code: 'GUARD_FILE_DATE_MISMATCH', abs: 1440 + 8 * 60 + 12, by: OPS_USER,
      anomaly: { kind: 'filedate', fileDate: '2025-11-16' }
    },
    {
      tenantId: 'yesbank', networkKey: 'rupay', cycleDate: '2025-11-16',
      type: 'INCOMING_PARSE', code: 'GUARD_DUPLICATE_FILE', abs: 1440 + 10 * 60 + 6, by: OPS_USER,
      anomaly: { kind: 'duplicate' }
    },
    {
      tenantId: 'hsbc-hk', networkKey: 'visa', cycleDate: '2025-11-19',
      type: 'CLEARING_STAGE', code: 'GUARD_SOURCE_MISMATCH', abs: 1440 + 7 * 60 + 41, by: OPS_USER,
      anomaly: { kind: 'source', source: 'Mindeed' }
    },
    {
      // The leg lock is not a clearing-only control — Part 7.2 puts it on
      // settlement generate and deliver too, and this is the proof of it. It is
      // also the one historical override, so the permanent Overridden tag is
      // demonstrable without walking the flow first.
      tenantId: 'hsbc-in', networkKey: null, cycleDate: '2025-11-13',
      type: 'SETTLEMENT_GENERATE', code: 'GUARD_CYCLE_ALREADY_STAGED', abs: 1440 + 11 * 60 + 28, by: OPS_USER,
      overrideReason: 'MPR was generated before the fee-rule correction landed, so merchant payout figures are wrong on 214 records. Regenerating with the corrected rules, confirmed with the settlement desk.'
    }
  ];
  BLOCKED_SPECS.forEach(function (b) {
    if (b.anomaly) PENDING_ANOMALY[b.tenantId + '|' + b.networkKey + '|' + b.cycleDate + '|' + b.type] = b.anomaly;
  });

  /* =========================================================================
     RUN CONSTRUCTION
     ========================================================================= */
  function makeStages(type, failStage, failCode, blocked, preflight) {
    var names = typeById[type].stages;
    var out = [], hit = false;
    names.forEach(function (n) {
      var st;
      if (blocked) st = (n === 'Pre-flight checks') ? 'blocked' : 'notrun';
      else if (hit) st = 'notrun';
      else if (failStage && n === failStage) { st = 'failed'; hit = true; }
      else st = 'succeeded';
      out.push({
        name: n, status: st,
        errorCode: (st === 'failed' || st === 'blocked') ? failCode : null,
        checks: n === 'Pre-flight checks' ? preflight : null
      });
    });
    // A failing stage the type doesn't own would silently produce an all-green
    // run — worse than a wrong stage name. Attribute it rather than lose it.
    if (failStage && !hit && !blocked) {
      out[out.length - 1].status = 'failed';
      out[out.length - 1].errorCode = failCode;
    }
    return out;
  }

  /* Distribute wall-clock across the stages deterministically. A failing stage
     gets a short slice — it stopped early, it did not run to completion. */
  function timeStages(stages, totalSec, seed) {
    var r = rng(seed);
    var weights = stages.map(function (s) {
      if (s.status === 'notrun') return 0;
      if (s.status === 'blocked') return 1;
      if (s.status === 'failed') return 0.5 + r() * 0.6;
      if (s.name === 'Pre-flight checks') return 0.25 + r() * 0.2;
      return 0.6 + r() * 1.4;
    });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var acc = 0;
    stages.forEach(function (s, i) {
      if (!weights[i]) { s.durationSec = null; s.offsetSec = null; return; }
      var sec = Math.max(1, Math.round(totalSec * weights[i] / sum));
      s.offsetSec = acc; s.durationSec = sec; acc += sec;
    });
    return acc;
  }

  function buildRun(o) {
    var def = typeById[o.type];
    var seed = seedOf(o.tenantId + '|' + (o.networkKey || '-') + '|' + o.cycleDate + '|' + o.type + '|' + (o.attempt || 1));
    var r = rng(seed);
    var t = O.tenantById[o.tenantId];
    var names = fileNames(o.type, o.tenantId, o.networkKey, o.cycleDate);

    var status = o.status || 'succeeded';
    var blocked = status === 'blocked';
    var failCode = o.errorCode || null;
    var entry = failCode ? E.get(failCode) : null;
    var failStage = failCode ? (o.failStage || (entry ? entry.stage : def.stages[def.stages.length - 1])) : null;

    var totalSec = o.durationSec != null ? o.durationSec
      : (blocked ? rint(r, 1, 3) : rint(r, o.fastRange ? 40 : 90, o.fastRange ? 260 : 900));
    if (status === 'failed') totalSec = Math.max(20, Math.round(totalSec * 0.55));

    var stages = makeStages(o.type, failStage, failCode, blocked, o.preflight || null);
    if (status === 'running') {
      var cut = Math.max(1, Math.floor(stages.length * 0.55));
      stages.forEach(function (s, i) { s.status = i < cut ? 'succeeded' : (i === cut ? 'running' : 'notrun'); s.errorCode = null; });
    }
    timeStages(stages, totalSec, seed + 17);

    var endAbs = o.endAbs != null ? o.endAbs : null;
    var startAbs;
    if (status === 'running') {
      startAbs = o.startAbs != null ? o.startAbs : (NOW_ABS - Math.ceil(totalSec / 60));
      endAbs = null;
    } else {
      startAbs = o.startAbs != null ? o.startAbs : (endAbs - Math.max(1, Math.ceil(totalSec / 60)));
    }

    var run = {
      runId: null, pinId: o.pinId || null,
      type: o.type, typeLabel: def.label, typeIcon: def.icon,
      direction: def.direction, leg: def.leg,
      tenantId: o.tenantId, tenantName: t ? t.name : o.tenantId,
      networkKey: o.networkKey || null, networkName: o.networkKey ? netName(o.networkKey) : null,
      cycleDate: o.cycleDate,
      trigger: o.trigger || 'scheduled',
      triggeredBy: o.triggeredBy || ((o.trigger === 'manual' || o.trigger === 'retry') ? OPS_USER : 'system'),
      status: status,
      startAbs: startAbs, endAbs: endAbs,
      startDay: dayOfRun(o.cycleDate, startAbs),
      startedAt: stampOf(o.cycleDate, startAbs),
      finishedAt: endAbs == null ? null : stampOf(o.cycleDate, endAbs),
      durationSec: status === 'running' ? null : totalSec,
      durationMs: status === 'running' ? null : totalSec * 1000,
      stages: stages,
      failedStage: blocked ? 'Pre-flight checks' : failStage,
      errorCode: failCode,
      inputFile: null, outputFile: null, recordCounts: null,
      currency: t ? t.currency : 'INR', gross: null,
      tags: (o.tags || []).slice(),
      authoredValues: o.values || {},
      configId: o.configId || null,
      relatedRunId: o.relatedRunId || null,
      previousRunId: null, duplicateOf: null,
      overrideId: null, voided: false, voidNote: null,
      rca: null, seed: seed
    };

    /* ---- files ----------------------------------------------------------- */
    var sizeBytes = rint(r, 380000, 8600000);
    if (names.input) {
      run.inputFile = {
        name: names.input,
        source: o.source || (def.direction === 'incoming' ? netName(o.networkKey) : (EXPECTED_SOURCE[o.tenantId + '|' + o.networkKey] || 'In-house')),
        checksum: o.checksum || checksumOf(seed + 3),
        sizeBytes: sizeBytes,
        fileDate: o.fileDate || o.cycleDate
      };
      // A stage / deliver run sends an artifact rather than reading a source
      // extract — its input IS the file the guards check.
      if ((o.type === 'CLEARING_STAGE' || o.type === 'SETTLEMENT_DELIVER') && names.output) run.inputFile.name = names.output;
    }
    if (names.output && status === 'succeeded' &&
      o.type !== 'CLEARING_STAGE' && o.type !== 'SETTLEMENT_DELIVER' && o.type !== 'FILE_VALIDATE') {
      run.outputFile = {
        name: names.output, checksum: o.outChecksum || checksumOf(seed + 9),
        sizeBytes: Math.round(sizeBytes * 0.86),
        s3Path: 's3://juspay-clearing-out/' + o.tenantId + '/' + (o.networkKey || 'acquirer') + '/' + o.cycleDate.replace(/-/g, '') + '/' + names.output
      };
    }

    /* ---- record counts --------------------------------------------------- */
    var read = o.txns != null ? o.txns : rint(r, 8200, 62000);
    var rejected = (failCode === 'CLEARING_STAGE_REJECTED')
      ? parseInt(String((o.values || {}).rejectedCount || '214').replace(/,/g, ''), 10)
      : (o.type === 'INCOMING_PARSE' && status === 'succeeded' ? rint(r, 4, 38) : 0);
    run.recordCounts = {
      read: blocked ? 0 : read,
      accepted: blocked ? 0 : read - rejected,
      rejected: blocked ? 0 : rejected,
      written: (status === 'succeeded') ? read - rejected : 0
    };
    if (o.gross != null) run.gross = o.gross;
    else {
      var ticket = (netOf(o.networkKey) || { ticket: 2050 }).ticket;
      run.gross = round2(read * ticket * (run.currency === 'INR' ? 1 : 0.09) * (0.85 + r() * 0.3));
    }
    return run;
  }

  /* =========================================================================
     GENERATION — 30 days across every tenant and network, driven by the cycle
     model's own leg outcomes so the two can never disagree.
     ========================================================================= */
  var FAIL_CODES_BY_TYPE = {
    CLEARING_GENERATE: ['CLEARING_TXN_FETCH_EMPTY', 'CLEARING_LAYOUT_INVALID', 'CLEARING_FIELD_OVERFLOW', 'CLEARING_TRANSFORM_MISSING'],
    CLEARING_STAGE: ['CLEARING_STAGE_REJECTED', 'CLEARING_STAGE_TIMEOUT'],
    INCOMING_FETCH: ['INCOMING_FILE_MISSING', 'INCOMING_DECRYPT_FAILED'],
    INCOMING_PARSE: ['PARSE_FIELD_UNMAPPED', 'PARSE_LAYOUT_MISMATCH', 'PARSE_RECORD_COUNT_MISMATCH', 'PARSE_UNKNOWN_RECORD_TYPE'],
    SETTLEMENT_GENERATE: ['SETTLEMENT_SOURCE_EMPTY', 'SETTLEMENT_FEE_RULE_MISSING'],
    SETTLEMENT_DELIVER: ['SETTLEMENT_DELIVERY_FAILED'],
    FILE_VALIDATE: ['SETTLEMENT_VALIDATION_MISMATCH'],
    RECONCILIATION: []
  };

  function emitLeg(o) {
    var spec = authoredFor(o.tenantId, o.networkKey, o.cycleDate, o.type);
    var r = rng(seedOf('fail|' + o.tenantId + '|' + (o.networkKey || '-') + '|' + o.cycleDate + '|' + o.type));
    var codes = FAIL_CODES_BY_TYPE[o.type] || [];
    var base = {
      type: o.type, tenantId: o.tenantId, networkKey: o.networkKey, cycleDate: o.cycleDate,
      fastRange: o.fastRange
    };

    if (spec && (spec.terminal || spec.noRetry)) {
      runs.push(buildRun(Object.assign({}, base, {
        endAbs: o.endAbs, status: 'failed', errorCode: spec.code, failStage: spec.failStage,
        values: spec.values, trigger: 'scheduled', attempt: 1
      })));
      return;
    }
    if (spec && !spec.pinId && spec.code) {
      // A failed first attempt, then the retry that landed on the leg's own
      // timestamp — which is why the Cycle Snapshot still shows the leg green.
      runs.push(buildRun(Object.assign({}, base, {
        endAbs: o.endAbs - rint(r, 14, 52), status: 'failed', errorCode: spec.code,
        failStage: spec.failStage, values: spec.values, trigger: 'scheduled', attempt: 1
      })));
      runs.push(buildRun(Object.assign({}, base, {
        endAbs: o.endAbs, status: 'succeeded', trigger: 'retry', triggeredBy: OPS_USER,
        attempt: 2, relatedRunId: 'prev'
      })));
      return;
    }
    if (!spec && codes.length && o.canFail !== false && r() < 0.062) {
      runs.push(buildRun(Object.assign({}, base, {
        endAbs: o.endAbs - rint(r, 12, 48), status: 'failed', errorCode: pick(r, codes),
        trigger: 'scheduled', attempt: 1
      })));
      runs.push(buildRun(Object.assign({}, base, {
        endAbs: o.endAbs, status: 'succeeded', trigger: 'retry', triggeredBy: OPS_USER,
        attempt: 2, relatedRunId: 'prev'
      })));
      return;
    }
    runs.push(buildRun(Object.assign({}, base, {
      endAbs: o.endAbs, status: 'succeeded', trigger: o.trigger || 'scheduled',
      pinId: spec ? spec.pinId : null,
      source: spec ? spec.source : null, checksum: spec ? spec.checksum : null,
      txns: spec ? spec.txns : null, gross: spec ? spec.gross : null,
      attempt: 1
    })));
  }

  (function generate() {
    C.cycleDates.forEach(function (date) {
      O.tenants.forEach(function (tenant) {

        /* ---- per tenant × network: clearing generate, stage, incoming parse -- */
        C.networksFor(tenant.id).forEach(function (net) {
          var cell = C.legsFor(tenant.id, net.key, date);
          if (!cell.enabled || cell.overall === 'holiday' || !cell.legs.length) return;
          var clr = cell.byKey.clearing, inc = cell.byKey.incoming;

          if (clr && clr.actual != null) {
            emitLeg({ type: 'CLEARING_GENERATE', tenantId: tenant.id, networkKey: net.key, cycleDate: date, endAbs: clr.actual - 14, canFail: clr.state !== 'failed' });
            emitLeg({ type: 'CLEARING_STAGE', tenantId: tenant.id, networkKey: net.key, cycleDate: date, endAbs: clr.actual + 3 });
          }
          if (inc && inc.actual != null && inc.state !== 'failed') {
            emitLeg({ type: 'INCOMING_PARSE', tenantId: tenant.id, networkKey: net.key, cycleDate: date, endAbs: inc.actual });
          }
          // Standalone fetch runs exist only where one was authored — normally
          // the fetch is the parse run's own opening stages (Part 3.2).
          if (authoredFor(tenant.id, net.key, date, 'INCOMING_FETCH')) {
            var anchor = (inc && inc.expected != null) ? inc.expected + 12 : 1440 + 462;
            emitLeg({ type: 'INCOMING_FETCH', tenantId: tenant.id, networkKey: net.key, cycleDate: date, endAbs: anchor, fastRange: true });
          }
        });

        /* ---- per tenant (acquirer-level): settlement, validation, recon ------ */
        var pk = primaryNetwork(tenant.id);
        var pcell = C.legsFor(tenant.id, pk, date);
        var live = pcell.enabled && pcell.overall !== 'holiday' && pcell.legs.length;

        if (live) {
          var stl = pcell.byKey.settlement, jv2 = pcell.byKey.jv2;
          if (stl && stl.actual != null && stl.state !== 'failed') {
            emitLeg({ type: 'SETTLEMENT_GENERATE', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: stl.actual - 6 });
            emitLeg({ type: 'SETTLEMENT_DELIVER', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: stl.actual + 4 });
          } else if (stl && stl.state === 'failed') {
            emitLeg({ type: 'SETTLEMENT_GENERATE', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: stl.expected + 18 });
          }
          /* Reconciliation closes the cycle — it runs after JV2, so the two most
             recent cycles have not reached it yet. */
          if (jv2 && jv2.actual != null && jv2.state !== 'failed') {
            emitLeg({ type: 'RECONCILIATION', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: jv2.actual + 22, canFail: false, fastRange: true });
          }
          /* File validation is a triggered check, not a daily job. */
          var vspec = authoredFor(tenant.id, null, date, 'FILE_VALIDATE');
          if ((vspec || rng(seedOf('val|' + tenant.id + '|' + date))() < 0.08) && stl && stl.actual != null) {
            emitLeg({ type: 'FILE_VALIDATE', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: stl.actual + 26, fastRange: true });
          }
        } else if (authoredFor(tenant.id, null, date, 'SETTLEMENT_GENERATE')) {
          // A holiday cycle with an authored schedule-skip: the run happened and
          // stopped at schedule resolution, which is exactly the point of it.
          emitLeg({ type: 'SETTLEMENT_GENERATE', tenantId: tenant.id, networkKey: null, cycleDate: date, endAbs: 1440 + 45, fastRange: true });
        }
      });
    });

    /* ---- every settlement-file problem gets the run that caused it ---------
       The Settlement File Monitoring registry already declares which files
       failed to deliver and which failed validation. Those states have to have
       a run behind them, or the portal would show a failure on one screen and
       claim every run succeeded on another. This pass walks the registry and
       makes sure each Failed delivery and each Mismatch validation is explained
       by a real failed run — which is also what makes the "Why? →" link on that
       screen resolve to something. */
    (function explainSettlementFiles() {
      var F = window.SFILES;
      if (!F || !F.rowsForRange) return;
      function anchor(tenantId, date, offset) {
        var cell = C.legsFor(tenantId, primaryNetwork(tenantId), date);
        var stl = cell.byKey && cell.byKey.settlement;
        var a = (stl && stl.actual != null) ? stl.actual + offset : C.scheduleFor(tenantId).settlement.expected + offset;
        // A run may never be stamped later than the observer's own clock.
        while (a >= 1440 && dayOfRun(date, a) > TODAY) a -= 1440;
        return Math.max(30, a);
      }
      function already(tenantId, date, type) {
        return runsFor(tenantId, null, date, type).filter(function (r) { return r.status === 'failed'; }).length > 0;
      }
      F.rowsForRange(C.cycleDates[0], TODAY).forEach(function (row) {
        if (row.delivery === 'Failed' && !already(row.tenantId, row.date, 'SETTLEMENT_DELIVER')) {
          runs.push(buildRun({
            type: 'SETTLEMENT_DELIVER', tenantId: row.tenantId, networkKey: null, cycleDate: row.date,
            endAbs: anchor(row.tenantId, row.date, 9), status: 'failed', errorCode: 'SETTLEMENT_DELIVERY_FAILED',
            trigger: 'scheduled', attempt: 300, fastRange: true,
            values: { fileName: row.name, transportError: row.failReason || 'connection refused after 3 handshake retries' }
          }));
        }
        if (row.validation === 'Mismatch' && !already(row.tenantId, row.date, 'FILE_VALIDATE')) {
          var rep = row.report;
          runs.push(buildRun({
            type: 'FILE_VALIDATE', tenantId: row.tenantId, networkKey: null, cycleDate: row.date,
            endAbs: anchor(row.tenantId, row.date, 28), status: 'failed', errorCode: 'SETTLEMENT_VALIDATION_MISMATCH',
            trigger: 'manual', triggeredBy: OPS_USER, attempt: 310, fastRange: true,
            values: rep ? {
              fileName: row.name,
              mismatchCount: String(rep.rows.length || 1),
              fileRecords: nfmt(rep.fileRecords), sourceRecords: nfmt(rep.sourceRecords),
              fileSum: fmtMoney(rep.fileSum, rep.currency), sourceSum: fmtMoney(rep.sourceSum, rep.currency),
              deltaLabel: fmtMoney(rep.sourceSum - rep.fileSum, rep.currency),
              mismatchField: (rep.rows[0] && rep.rows[0].field) || 'merchant_net_amount'
            } : { fileName: row.name }
          }));
        }
      });
    })();

    /* ---- the second staging: the incident's manual duplicate --------------- */
    runs.push(buildRun({
      type: 'CLEARING_STAGE', tenantId: INCIDENT.tenantId, networkKey: INCIDENT.networkKey,
      cycleDate: INCIDENT.cycleDate, endAbs: 1440 + 9 * 60 + 18,
      status: 'succeeded', trigger: 'manual', triggeredBy: OPS_USER,
      pinId: INCIDENT.secondRunId, source: INCIDENT.secondSource, checksum: INCIDENT.secondChecksum,
      txns: INCIDENT.txns, gross: INCIDENT.grossHKD, attempt: 9
    }));

    /* ---- blocked runs ------------------------------------------------------ */
    BLOCKED_SPECS.forEach(function (b, i) {
      var run = buildRun({
        type: b.type, tenantId: b.tenantId, networkKey: b.networkKey, cycleDate: b.cycleDate,
        endAbs: b.abs, status: 'blocked', errorCode: b.code, trigger: 'manual', triggeredBy: b.by,
        pinId: b.runId || null, values: b.values || {}, attempt: 50 + i,
        preflight: preflightFor(b.type, b.tenantId, b.networkKey, b.cycleDate, b.code),
        fileDate: (b.anomaly && b.anomaly.fileDate) || null,
        source: (b.anomaly && b.anomaly.source) || null
      });
      if (b.overrideReason) run._seedOverride = b.overrideReason;
      runs.push(run);
    });

    /* ---- three runs in flight, so "Running now" is a real number ----------- */
    [['hsbc-in', null, 'FILE_VALIDATE'], ['yesbank', null, 'FILE_VALIDATE'], ['hsbc-sg', 'mc', 'INCOMING_PARSE']].forEach(function (spec, i) {
      runs.push(buildRun({
        type: spec[2], tenantId: spec[0], networkKey: spec[1], cycleDate: CYCLE_TODAY,
        startAbs: NOW_ABS - (4 + i * 3), status: 'running',
        trigger: i === 2 ? 'manual' : 'scheduled', triggeredBy: i === 2 ? OPS_USER : 'system',
        attempt: 70 + i, fastRange: true
      }));
    });
  })();

  /* =========================================================================
     RUN ID ASSIGNMENT
     Sequential per calendar start date. The pinned incident IDs are then
     swapped with whichever run naturally holds them, so every ID stays unique
     and the sequence space stays intact.
     ========================================================================= */
  (function assignIds() {
    runs.sort(function (a, b) {
      if (a.startDay !== b.startDay) return a.startDay < b.startDay ? -1 : 1;
      if (a.startAbs !== b.startAbs) return a.startAbs - b.startAbs;
      if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
      if ((a.networkKey || '') !== (b.networkKey || '')) return (a.networkKey || '') < (b.networkKey || '') ? -1 : 1;
      return a.type < b.type ? -1 : 1;
    });
    var seq = {};
    runs.forEach(function (run) {
      var d = run.startDay.replace(/-/g, '');
      seq[d] = (seq[d] || 0) + 1;
      run.runId = 'RUN-' + d + '-' + pad(seq[d], 4);
    });
    var natural = {};
    runs.forEach(function (r) { natural[r.runId] = r; });
    runs.forEach(function (run) {
      if (!run.pinId || run.runId === run.pinId) return;
      var holder = natural[run.pinId], mine = run.runId;
      if (holder) { holder.runId = mine; natural[mine] = holder; }
      run.runId = run.pinId;
      natural[run.pinId] = run;
    });
    runs.forEach(function (r) { byId[r.runId] = r; });
  })();

  /* Retries point back at the attempt they followed; the two staging runs of
     the incident point at each other, because Part 8.2 wants both flagged and
     cross-linked, not one pointing at the other. */
  (function link() {
    var prevByKey = {};
    runs.slice()
      .sort(function (a, b) { return a.startDay === b.startDay ? a.startAbs - b.startAbs : (a.startDay < b.startDay ? -1 : 1); })
      .forEach(function (r) {
        var k = r.tenantId + '|' + (r.networkKey || '-') + '|' + r.cycleDate + '|' + r.type;
        if (r.relatedRunId === 'prev') r.relatedRunId = prevByKey[k] || null;
        r.previousRunId = prevByKey[k] || null;
        prevByKey[k] = r.runId;
      });
    var first = byId[INCIDENT.firstRunId], second = byId[INCIDENT.secondRunId];
    if (first && second) {
      if (first.tags.indexOf('Duplicate') < 0) first.tags.push('Duplicate');
      if (second.tags.indexOf('Duplicate') < 0) second.tags.push('Duplicate');
      first.duplicateOf = second.runId;
      second.duplicateOf = first.runId;
    }
  })();

  /* =========================================================================
     PART 4 — THE `rca` BLOCK
     Present only on failed and blocked runs, per Part 3.1. It holds the values
     the catalog interpolates, the evidence excerpt and the technical log.
     runs-rca.js renders it; it never invents any of it.
     ========================================================================= */

  function baseValues(run) {
    var def = typeById[run.type];
    var file = run.inputFile || run.outputFile;
    var sched = run.leg ? C.scheduleFor(run.tenantId)[run.leg] : null;
    var ci = run.leg ? cutoffInfo(run.tenantId, run.networkKey || primaryNetwork(run.tenantId), run.cycleDate, run.leg) : null;
    return {
      tenant: run.tenantId, tenantName: run.tenantName,
      network: run.networkKey || '', networkName: run.networkName || 'the acquirer',
      cycleDate: run.cycleDate, cycleShort: U.prettyDate(run.cycleDate),
      dow: U.DOW[U.fromYmd(run.cycleDate).getUTCDay()],
      runId: run.runId, stage: run.failedStage || '',
      fileName: file ? file.name : '—',
      checksum: file ? file.checksum : '—',
      sizeLabel: file ? bytes(file.sizeBytes) : '—',
      fileDate: file ? file.fileDate : run.cycleDate,
      fileDatePretty: U.prettyDate(file ? file.fileDate : run.cycleDate),
      totalRecords: nfmt(run.recordCounts ? run.recordCounts.read : 0),
      endpoint: run.networkKey ? NET_ENDPOINT[run.networkKey] : (ACQ_ENDPOINT[run.tenantId] || 'sftp.acquirer:22'),
      sourcePath: '/in/' + run.tenantId + '/' + (run.networkKey || 'acquirer') + '/',
      reportName: reportNameFor(run.tenantId),
      expectedSource: EXPECTED_SOURCE[run.tenantId + '|' + run.networkKey] || 'In-house',
      actualSource: run.inputFile ? run.inputFile.source : '—',
      directionWord: def.direction || 'scheduled',
      legLabel: run.leg ? ({ clearing: 'clearing', settlement: 'settlement', incoming: 'incoming', jv2: 'JV2' }[run.leg]) : def.label.toLowerCase(),
      cutoffLabel: sched ? C.hhmm(sched.cutoff) : '—',
      overdueLabel: ci && ci.passed ? C.dur(ci.overdueMin) : '—',
      holidayClause: '',
      incomingClause: '',
      family: run.type === 'CLEARING_STAGE' ? 'staging' : 'incoming',
      tab: ''
    };
  }

  /* Deterministic specifics for any failure of a given code, so a routinely
     generated failure reads as concretely as an authored one. Authored values
     are layered on top and always win. */
  function codeValues(run, v) {
    var r = rng(run.seed + 991);
    var total = run.recordCounts ? run.recordCounts.read : 20000;
    var code = run.errorCode;
    var out = {};
    switch (code) {
      case 'INCOMING_FILE_MISSING':
        out = { pollInterval: '5 minutes', firstPoll: '07:00', lastPoll: '09:30', expectedName: (INC_NAME[run.networkKey] || 'RESPONSE') + '_*_' + run.cycleDate.replace(/-/g, '') + '.*' };
        break;
      case 'INCOMING_DECRYPT_FAILED':
        out = { keyId: '0x' + pad(rint(r, 16, 255).toString(16).toUpperCase(), 2) + pad(rint(r, 16, 255).toString(16).toUpperCase(), 2) + 'A1C9', knownKeyId: '0x4B18D002' };
        break;
      case 'PARSE_FIELD_UNMAPPED':
        var st = rint(r, 96, 240), ln = pick(r, [3, 4, 6, 8]);
        // The sample value has to be exactly as wide as the field it was found
        // in — a 4-character value quoted against an 8-character field would
        // make the evidence contradict its own numbers.
        var sv = ('M' + pad(rint(r, 1, 900), 3)).slice(0, ln);
        while (sv.length < ln) sv += pad(rint(r, 0, 9), 1);
        out = {
          record: nfmt(rint(r, 400, Math.max(600, total - 10))),
          fieldName: pick(r, ['mandate_type', 'token_assurance', 'wallet_indicator', 'installment_flag']),
          start: String(st), end: String(st + ln - 1), length: String(ln), sampleValue: sv
        };
        break;
      case 'PARSE_LAYOUT_MISMATCH':
        var w = pick(r, [1014, 1080, 168, 220]);
        out = { expectedWidth: nfmt(w), actualWidth: nfmt(w + pick(r, [8, 12, 22, 34])) };
        break;
      case 'PARSE_RECORD_COUNT_MISMATCH':
        var skip = rint(r, 3, 42);
        out = { parsedRecords: nfmt(total - skip), declaredRecords: nfmt(total), skippedRecords: String(skip) };
        break;
      case 'PARSE_UNKNOWN_RECORD_TYPE':
        out = { record: nfmt(rint(r, 500, Math.max(700, total - 10))), recordType: pick(r, ['0640', '0900', '5300', '4602']), occurrences: String(rint(r, 12, 340)) };
        break;
      case 'CLEARING_TXN_FETCH_EMPTY':
        out = {};
        break;
      case 'CLEARING_LAYOUT_INVALID':
        var a0 = rint(r, 100, 180);
        out = { fieldA: 'merchant_postal_code', aStart: String(a0), aEnd: String(a0 + 5), fieldB: 'acquirer_reference', bStart: String(a0 + 4), bEnd: String(a0 + 27) };
        break;
      case 'CLEARING_FIELD_OVERFLOW':
        var fl = pick(r, [25, 22, 40]);
        out = { record: nfmt(rint(r, 500, Math.max(800, total - 10))), fieldName: pick(r, ['merchant_name', 'merchant_city', 'card_acceptor_id']), fieldLength: String(fl), valueLength: String(fl + rint(r, 2, 9)), sampleValue: pick(r, ['GLOBAL HOSPITALITY VENTURES', 'SOUTHERN RETAIL DISTRIBUTORS', 'METRO TRANSPORT SERVICES LTD']) };
        break;
      case 'CLEARING_TRANSFORM_MISSING':
        out = { fieldName: pick(r, ['reimbursement_attribute', 'interchange_rate_designator', 'settlement_flag']), tab: 'mapping' };
        break;
      case 'CLEARING_STAGE_REJECTED':
        var rc = pick(r, [['4808', 'missing interchange rate designator'], ['4834', 'duplicate transaction reference'], ['4512', 'invalid acquirer reference number']]);
        out = { rejectedCount: nfmt(rint(r, 40, 900)), reasonCode: rc[0], reasonText: rc[1], family: 'staging' };
        break;
      case 'CLEARING_STAGE_TIMEOUT':
        out = { timeoutLabel: pick(r, ['30 minutes', '45 minutes']) };
        break;
      case 'SETTLEMENT_SCHEDULE_SKIPPED':
        out = { scheduleDays: 'Monday to Friday, excluding bank holidays', tab: 'schedule' };
        break;
      case 'SETTLEMENT_SOURCE_EMPTY':
        out = { filterSummary: 'settlement_status = SETTLED and product = CREDIT', sourceRows: nfmt(total), tab: 'content' };
        break;
      case 'SETTLEMENT_FEE_RULE_MISSING':
        out = { unmatched: nfmt(rint(r, 12, 400)), unmatchedKey: 'MCC ' + pick(r, ['6012', '5967', '7995']) + ' on ' + pick(r, ['Visa Credit Cross-border', 'Mastercard Debit Domestic', 'RuPay Credit Domestic']), tab: 'fees' };
        break;
      case 'SETTLEMENT_DELIVERY_FAILED':
        out = { attempts: String(rint(r, 3, 6)), attemptWindow: rint(r, 20, 55) + ' minutes', transportError: pick(r, ['connection refused after 3 handshake retries', 'host key verification failed', 'authentication rejected by the acquirer endpoint']) };
        break;
      case 'SETTLEMENT_VALIDATION_MISMATCH':
        var fr = total, sr = total + rint(r, 1, 9);
        var fs = round2(run.gross || 100000), ss = round2((run.gross || 100000) * (1 + (rint(r, 2, 40) / 10000)));
        out = {
          mismatchCount: String(rint(r, 2, 14)), mismatchField: 'merchant_net_amount',
          fileRecords: nfmt(fr), sourceRecords: nfmt(sr),
          fileSum: fmtMoney(fs, run.currency), sourceSum: fmtMoney(ss, run.currency),
          deltaLabel: fmtMoney(round2(ss - fs), run.currency)
        };
        break;
      case 'GUARD_CYCLE_ALREADY_STAGED':
        var prior = firstSucceeded(run.tenantId, typeById[run.type].networked ? run.networkKey : null, run.cycleDate, run.type);
        var incoming = lastSucceeded(run.tenantId, run.networkKey, run.cycleDate, 'INCOMING_PARSE');
        out = {
          originalTime: prior ? (C.hhmm(prior.endAbs) + ' on ' + U.prettyDate(prior.startDay)) : 'an earlier run',
          originalRunId: prior ? prior.runId : '',
          incomingClause: incoming ? ', and incoming data for it has been received' : ''
        };
        break;
      case 'GUARD_FILE_DATE_MISMATCH':
        out = {};
        break;
      case 'GUARD_DUPLICATE_FILE':
        var pf = pendingFile(run.type, run.tenantId, run.networkKey, run.cycleDate);
        out = {
          originalRunId: (pf && pf.priorRunId) || '',
          originalDatePretty: U.prettyDate((pf && pf.priorDay) || run.cycleDate),
          checksum: (pf && pf.checksum) || (run.inputFile ? run.inputFile.checksum : '—')
        };
        break;
      case 'GUARD_SOURCE_MISMATCH':
        out = { actualSource: run.inputFile ? run.inputFile.source : 'an unexpected source' };
        break;
      default:
        out = {};
    }
    return out;
  }
  function fmtMoney(n, cur) {
    var sym = { INR: '₹', SGD: 'S$', HKD: 'HK$' }[cur] || '';
    var fixed = Math.abs(n).toFixed(2), parts = fixed.split('.');
    var ip = cur === 'INR' ? nfmt(parts[0]) : String(parts[0]).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + sym + ip + '.' + parts[1];
  }

  /* ---- evidence: the short monospace excerpt, never more than the card's
     cap. Written per code so only the lines that matter appear. ------------- */
  function evidenceFor(run, v) {
    var t0 = clock(run.endAbs != null ? run.endAbs : run.startAbs, (run.seed % 60));
    var f = v.fileName;
    var code = run.errorCode;
    switch (code) {
      case 'INCOMING_FILE_MISSING': return [
        t0 + ' ERROR incoming.file_missing',
        '  path=' + v.sourcePath + ' pattern=' + v.expectedName,
        '  polled=31 interval=' + v.pollInterval + ' matched=0',
        '  window=' + v.firstPoll + '–' + v.lastPoll + ' IST cycle=' + run.cycleDate
      ];
      case 'INCOMING_DECRYPT_FAILED': return [
        t0 + ' ERROR incoming.decrypt_failed',
        '  file=' + f + ' size=' + v.sizeLabel,
        '  encrypted_to=' + v.keyId + ' keyring_has=' + v.knownKeyId,
        '  gpg: decryption failed: No secret key'
      ];
      case 'PARSE_FIELD_UNMAPPED': return [
        t0 + ' ERROR parse.field_unmapped',
        '  position=' + v.start + ' length=' + v.length + ' value="' + v.sampleValue + '"',
        '  record=' + String(v.record).replace(/,/g, '') + ' file=' + f,
        '  config=' + (v.network || 'network') + '_incoming/' + cfgTenant(run.tenantId)
      ];
      case 'PARSE_LAYOUT_MISMATCH': return [
        t0 + ' ERROR parse.layout_mismatch',
        '  expected_record_width=' + v.expectedWidth + ' actual=' + v.actualWidth,
        '  header=' + f.slice(0, 24) + ' sampled_records=200',
        '  aborted before record 1'
      ];
      case 'PARSE_RECORD_COUNT_MISMATCH': return [
        t0 + ' ERROR parse.count_mismatch',
        '  parsed=' + v.parsedRecords + ' trailer_declares=' + v.declaredRecords,
        '  skipped=' + v.skippedRecords + ' reason=record_validation_failed',
        '  file=' + f,
        '  transaction rolled back — nothing persisted'
      ];
      case 'PARSE_UNKNOWN_RECORD_TYPE': return [
        t0 + ' ERROR parse.unknown_record_type',
        '  record_type=' + v.recordType + ' occurrences=' + v.occurrences,
        '  record=' + String(v.record).replace(/,/g, '') + ' of ' + v.totalRecords,
        '  file=' + f
      ];
      case 'CLEARING_TXN_FETCH_EMPTY': return [
        t0 + ' ERROR clearing.txn_fetch_empty',
        '  tenant=' + run.tenantId + ' network=' + (v.network || '-') + ' cycle=' + run.cycleDate,
        '  rows_returned=0 expected>0',
        '  no file written'
      ];
      case 'CLEARING_LAYOUT_INVALID': return [
        t0 + ' ERROR clearing.layout_invalid',
        '  ' + v.fieldA + ' occupies ' + v.aStart + '–' + v.aEnd,
        '  ' + v.fieldB + ' occupies ' + v.bStart + '–' + v.bEnd,
        '  overlap=' + (parseInt(v.aEnd, 10) - parseInt(v.bStart, 10) + 1) + ' chars',
        '  layout validation aborted'
      ];
      case 'CLEARING_FIELD_OVERFLOW': return [
        t0 + ' ERROR clearing.field_overflow',
        '  field=' + v.fieldName + ' declared_length=' + v.fieldLength,
        '  value_length=' + v.valueLength + ' value="' + v.sampleValue + '"',
        '  record=' + String(v.record).replace(/,/g, '') + ' of ' + v.totalRecords
      ];
      case 'CLEARING_TRANSFORM_MISSING': return [
        t0 + ' ERROR clearing.transform_missing',
        '  field=' + v.fieldName + ' mandatory=true source=<none>',
        '  records_affected=' + v.totalRecords,
        '  refusing to write blank mandatory field'
      ];
      case 'CLEARING_STAGE_REJECTED': return [
        t0 + ' ERROR clearing.stage_rejected',
        '  network=' + v.networkName + ' endpoint=' + v.endpoint,
        '  reason_code=' + v.reasonCode + ' "' + v.reasonText + '"',
        '  rejected=' + v.rejectedCount + ' of ' + v.totalRecords,
        '  file=' + f + ' ack=NEGATIVE'
      ];
      case 'CLEARING_STAGE_TIMEOUT': return [
        t0 + ' ERROR clearing.ack_timeout',
        '  endpoint=' + v.endpoint + ' bytes_sent=' + v.sizeLabel,
        '  transfer=complete ack=none after ' + v.timeoutLabel,
        '  file=' + f
      ];
      case 'SETTLEMENT_SCHEDULE_SKIPPED': return [
        t0 + ' INFO  settlement.schedule_skipped',
        '  report="' + v.reportName + '" cycle=' + run.cycleDate + ' (' + v.dow + ')',
        '  schedule=' + v.scheduleDays
      ];
      case 'SETTLEMENT_SOURCE_EMPTY': return [
        t0 + ' ERROR settlement.source_empty',
        '  report="' + v.reportName + '" rows_matched=0',
        '  filters: ' + v.filterSummary,
        '  candidate_rows=' + v.sourceRows
      ];
      case 'SETTLEMENT_FEE_RULE_MISSING': return [
        t0 + ' ERROR settlement.fee_rule_missing',
        '  unmatched=' + v.unmatched + ' of ' + v.totalRecords,
        '  key=' + v.unmatchedKey,
        '  report="' + v.reportName + '"',
        '  refusing to emit blank fee columns'
      ];
      case 'SETTLEMENT_DELIVERY_FAILED': return [
        t0 + ' ERROR settlement.delivery_failed',
        '  endpoint=' + v.endpoint + ' attempts=' + v.attempts,
        '  error="' + v.transportError + '"',
        '  file=' + f + ' size=' + v.sizeLabel,
        '  file intact in S3 — safe to re-deliver'
      ];
      case 'SETTLEMENT_VALIDATION_MISMATCH': return [
        t0 + ' ERROR validate.mismatch',
        '  file_records=' + v.fileRecords + ' source_records=' + v.sourceRecords,
        '  file_sum=' + v.fileSum + ' source_sum=' + v.sourceSum,
        '  delta=' + v.deltaLabel + ' field=' + v.mismatchField,
        '  mismatched_records=' + v.mismatchCount
      ];
      case 'GUARD_CYCLE_ALREADY_STAGED': return [
        t0 + ' BLOCK guard.cycle_leg_lock',
        '  leg=' + v.legLabel + ' tenant=' + run.tenantId + ' network=' + (v.network || '-'),
        '  cycle=' + run.cycleDate + ' prior_run=' + (v.originalRunId || 'n/a'),
        '  run created with status=blocked — nothing executed'
      ];
      case 'GUARD_FILE_DATE_MISMATCH': return [
        t0 + ' BLOCK guard.file_date_mismatch',
        '  file=' + f,
        '  file_internal_date=' + v.fileDate + ' cycle=' + run.cycleDate,
        '  run created with status=blocked — nothing executed'
      ];
      case 'GUARD_DUPLICATE_FILE': return [
        t0 + ' BLOCK guard.duplicate_file',
        '  checksum=' + v.checksum,
        '  matches run=' + (v.originalRunId || 'n/a') + ' processed=' + v.originalDatePretty,
        '  run created with status=blocked — nothing executed'
      ];
      case 'GUARD_SOURCE_MISMATCH': return [
        t0 + ' BLOCK guard.source_mismatch',
        '  file=' + f,
        '  actual_source=' + v.actualSource + ' expected_source=' + v.expectedSource,
        '  run created with status=blocked — nothing executed'
      ];
      case 'GUARD_CUTOFF_PASSED': return [
        t0 + ' WARN  guard.cutoff_passed',
        '  leg=' + v.legLabel + ' cutoff=' + v.cutoffLabel + ' IST',
        '  started ' + v.overdueLabel + ' after the cutoff — proceeding'
      ];
      default: return null;
    }
  }

  /* An unmatched signature gets 12 lines of the raw failure, not 6 — the
     operator has nothing else to go on, so the excerpt has to carry more
     (Part 4.3). No cause is inferred from it. */
  function unknownEvidence(run, v) {
    var r = rng(run.seed + 40009);
    var base = run.endAbs != null ? run.endAbs : run.startAbs;
    var t = function (o) { return clock(base, (run.seed + o * 7) % 60); };
    return [
      t(0) + ' ERROR ' + String(run.errorCode).toLowerCase(),
      '  run=' + run.runId + ' stage="' + run.failedStage + '"',
      '  tenant=' + run.tenantId + ' network=' + (run.networkKey || '-') + ' cycle=' + run.cycleDate,
      '  file=' + v.fileName,
      '  thread=worker-' + rint(r, 2, 15) + ' pid=' + rint(r, 2000, 9000),
      '  panicked at src/file_parser/segment.rs:' + rint(r, 180, 940),
      "  called `Result::unwrap()` on an `Err` value: SegmentDecode(",
      '    offset: ' + rint(r, 1000, 90000) + ', expected: 4, found: 1',
      '  )',
      '  note: run with `RUST_BACKTRACE=1` for a backtrace',
      t(3) + ' ERROR worker exited non-zero (101)',
      t(4) + ' INFO  transaction rolled back — nothing persisted'
    ];
  }

  /* The one long log in the product — 60 lines around the failure, collapsed by
     default on run detail, and nowhere else (Part 6.2, Part 11). */
  function technicalLog(run, v) {
    var lines = [];
    var r = rng(run.seed + 7717);
    var base = run.startAbs;
    function stamp(off, sec) { return clock(base + off, sec); }
    lines.push(stamp(0, 1) + ' INFO  run ' + run.runId + ' starting');
    lines.push(stamp(0, 1) + ' INFO  type=' + run.type + ' trigger=' + run.trigger + ' by=' + run.triggeredBy);
    lines.push(stamp(0, 2) + ' INFO  tenant=' + run.tenantId + ' network=' + (run.networkKey || '-') + ' cycle=' + run.cycleDate);
    run.stages.forEach(function (s) {
      var off = Math.floor((s.offsetSec || 0) / 60);
      if (s.status === 'notrun') { lines.push('       ---   stage "' + s.name + '" not run'); return; }
      lines.push(stamp(off, rint(r, 0, 59)) + ' INFO  stage "' + s.name + '" started');
      if (s.name === 'Pre-flight checks' && s.checks) {
        s.checks.forEach(function (c) {
          lines.push('       ' + (c.status === 'block' ? 'BLOCK' : c.status === 'warn' ? 'WARN ' : c.status === 'skip' ? 'SKIP ' : 'OK   ') + ' ' + c.key + ': ' + c.message);
        });
      }
      if (s.status === 'succeeded') lines.push(stamp(off, rint(r, 0, 59)) + ' INFO  stage "' + s.name + '" ok in ' + durLabel(s.durationSec));
      if (s.status === 'running') lines.push(stamp(off, rint(r, 0, 59)) + ' INFO  stage "' + s.name + '" in progress');
      if (s.status === 'failed' || s.status === 'blocked') {
        (run.rca && run.rca.evidence ? run.rca.evidence : []).forEach(function (l) { lines.push('  ' + l); });
        lines.push(stamp(off, rint(r, 0, 59)) + ' ERROR stage "' + s.name + '" ' + (s.status === 'blocked' ? 'blocked' : 'failed') + ' code=' + (s.errorCode || 'UNKNOWN'));
      }
    });
    lines.push(stamp(Math.ceil((run.durationSec || 60) / 60), 3) + ' INFO  run ' + run.runId + ' finished status=' + run.status);
    // Pad with the surrounding worker chatter a real log would carry, so the
    // 60-line window looks like a window rather than a summary.
    var i = 0;
    while (lines.length < 60) {
      lines.push(stamp(Math.floor(i / 3), rint(r, 0, 59)) + ' DEBUG worker-' + rint(r, 1, 8) + ' heartbeat queue_depth=' + rint(r, 0, 12) + ' rss=' + rint(r, 180, 940) + 'MB');
      i++;
    }
    return lines.slice(0, 60);
  }

  (function buildRca() {
    runs.forEach(function (run) {
      if (run.status !== 'failed' && run.status !== 'blocked') return;
      var v = baseValues(run);
      var derived = codeValues(run, v);
      Object.keys(derived).forEach(function (k) { if (derived[k] != null && derived[k] !== '') v[k] = derived[k]; });
      Object.keys(run.authoredValues || {}).forEach(function (k) { v[k] = run.authoredValues[k]; });
      var entry = E.get(run.errorCode);
      var known = !!entry;
      run.rca = {
        code: run.errorCode,
        known: known,
        kind: run.status === 'blocked' ? 'blocked' : 'failed',
        stage: run.failedStage,
        values: v,
        evidence: known ? (evidenceFor(run, v) || unknownEvidence(run, v)) : unknownEvidence(run, v),
        evidenceCap: known ? 6 : 12
      };
      run.rca.log = technicalLog(run, v);
    });
  })();

  /* =========================================================================
     PART 7.4 — OVERRIDES
     In memory only. A requester can never approve their own request — the same
     maker-checker rule the config screens run on.
     ========================================================================= */
  var overrides = [];
  var _ovSeq = 0;
  function consequenceOf(run) {
    var t = run.tenantName, n = run.networkName ? ' · ' + run.networkName : '';
    var cyc = U.prettyDate(run.cycleDate);
    if (run.type === 'CLEARING_STAGE') return 'This will stage a second clearing file for ' + t + n + ' · ' + cyc + '. The network will receive both files.';
    if (run.type === 'CLEARING_GENERATE') return 'This will regenerate and overwrite the clearing file for ' + t + n + ' · ' + cyc + '. Anything already staged from the previous file stays staged.';
    if (run.type === 'SETTLEMENT_GENERATE') return 'This will regenerate the settlement files for ' + t + ' · ' + cyc + ', replacing versions the acquirer may already hold.';
    if (run.type === 'SETTLEMENT_DELIVER') return 'This will deliver the settlement files for ' + t + ' · ' + cyc + ' a second time. The acquirer will receive duplicates.';
    return 'This will run ' + typeById[run.type].opLabel.toLowerCase() + ' for ' + t + n + ' · ' + cyc + ' despite the block above.';
  }
  function requestOverride(runId, reason, by) {
    var run = byId[runId];
    if (!run) return null;
    var ov = {
      id: 'OVR-' + pad(overrides.length + 1, 3), runId: runId, reason: reason,
      requestedBy: by || OPS_USER, requestedAt: stampOf(run.cycleDate, NOW_ABS + (++_ovSeq)),
      status: 'pending', decidedBy: null, decidedAt: null,
      consequence: consequenceOf(run),
      tenantId: run.tenantId, networkKey: run.networkKey, cycleDate: run.cycleDate, type: run.type
    };
    overrides.push(ov);
    run.overrideId = ov.id;
    return ov;
  }
  function decideOverride(id, approve, by) {
    var ov = overrides.filter(function (o) { return o.id === id; })[0];
    if (!ov || ov.status !== 'pending') return null;
    if (by === ov.requestedBy) return { error: 'A requester cannot decide their own override. It needs a second approver.' };
    ov.status = approve ? 'approved' : 'rejected';
    ov.decidedBy = by || CHECKER_USER;
    var run = byId[ov.runId];
    ov.decidedAt = stampOf(run ? run.cycleDate : CYCLE_TODAY, NOW_ABS + (++_ovSeq));
    if (approve && run && run.tags.indexOf('Overridden') < 0) run.tags.push('Overridden');
    return ov;
  }
  function approveOverride(id, by) { return decideOverride(id, true, by); }
  function rejectOverride(id, by) { return decideOverride(id, false, by); }
  function overrideFor(runId) { return overrides.filter(function (o) { return o.runId === runId; })[0] || null; }
  function pendingOverrides() { return overrides.filter(function (o) { return o.status === 'pending'; }); }

  // The one historical approved override, so the permanent Overridden tag is
  // demonstrable without walking the flow first.
  (function seedOverride() {
    runs.forEach(function (r) {
      if (!r._seedOverride) return;
      var ov = requestOverride(r.runId, r._seedOverride, OPS_USER);
      if (ov) {
        approveOverride(ov.id, CHECKER_USER);
        ov.requestedAt = stampOf(r.cycleDate, r.startAbs + 4);
        ov.decidedAt = stampOf(r.cycleDate, r.startAbs + 26);
      }
      delete r._seedOverride;
    });
  })();

  /* =========================================================================
     PART 7.1 — CURRENT STATE FOR A SELECTION
     The mandatory block in the launcher: everything that has already happened
     for this exact tenant × network × cycle, whether the operator asked or not.
     ========================================================================= */
  var STATE_ROWS = [
    { key: 'CLEARING_GENERATE', label: 'Clearing generated', networked: true },
    { key: 'CLEARING_STAGE', label: 'Clearing staged', networked: true },
    { key: 'INCOMING_PARSE', label: 'Incoming received', networked: true },
    { key: 'SETTLEMENT_GENERATE', label: 'Settlement files generated', networked: false },
    { key: 'SETTLEMENT_DELIVER', label: 'Settlement files delivered', networked: false },
    { key: 'RECONCILIATION', label: 'Reconciliation', networked: false }
  ];
  function currentState(tenantId, netKey, cycleDate) {
    return STATE_ROWS.map(function (row) {
      var nk = row.networked ? netKey : null;
      var all = runsFor(tenantId, nk, cycleDate, row.key)
        .filter(function (r) { return !r.voided; })
        .sort(function (a, b) { return a.startAbs - b.startAbs; });
      var ok = all.filter(function (r) { return r.status === 'succeeded'; });
      var running = all.filter(function (r) { return r.status === 'running'; })[0];
      var failed = all.filter(function (r) { return r.status === 'failed'; });
      var out = { key: row.key, label: row.label, networked: row.networked, runs: all, okCount: ok.length };
      if (ok.length) {
        var last = ok[ok.length - 1];
        out.status = ok.length > 1 ? 'duplicate' : 'done';
        out.at = C.shortStamp(cycleDate, last.endAbs);
        out.atFull = stampOf(cycleDate, last.endAbs);
        out.runId = last.runId;
        out.note = ok.length > 1 ? ok.length + ' successful runs — this leg has already run more than once' : null;
      } else if (running) {
        out.status = 'running'; out.at = 'in progress'; out.runId = running.runId;
      } else if (failed.length) {
        var lf = failed[failed.length - 1];
        out.status = 'failed'; out.at = 'failed ' + C.hhmm(lf.endAbs); out.runId = lf.runId;
      } else {
        out.status = 'none'; out.at = 'not yet run'; out.runId = null;
      }
      return out;
    });
  }

  /* =========================================================================
     PART 8.1 — DUPLICATE DETECTION
     A scan over the run history, evaluated on read. All four signals Part 8.1
     names, not just the count.
     ========================================================================= */
  function detectAnomalies() {
    var byCycle = {};
    runs.forEach(function (r) {
      if (r.type !== 'CLEARING_STAGE' || r.status !== 'succeeded' || r.voided) return;
      var k = r.tenantId + '|' + r.networkKey + '|' + r.cycleDate;
      (byCycle[k] = byCycle[k] || []).push(r);
    });
    var out = [];
    Object.keys(byCycle).forEach(function (k) {
      var list = byCycle[k].slice().sort(function (a, b) { return a.startAbs - b.startAbs; });
      var reasons = [], seen = {};
      if (list.length > 1) reasons.push(list.length + ' clearing files were staged for this cycle.');
      list.forEach(function (r) {
        var c = r.inputFile && r.inputFile.checksum;
        if (c) { if (seen[c]) reasons.push('The same file checksum was staged to this network more than once.'); seen[c] = 1; }
        if (r.inputFile && r.inputFile.fileDate && r.inputFile.fileDate !== r.cycleDate) {
          reasons.push('Run ' + r.runId + ' staged a file dated ' + U.prettyDate(r.inputFile.fileDate) + ' against cycle ' + U.prettyDate(r.cycleDate) + '.');
        }
      });
      if (!reasons.length) return;
      var p = k.split('|');
      var incoming = runsFor(p[0], p[1], p[2], 'INCOMING_PARSE').filter(function (r) { return r.status === 'succeeded'; });
      if (list.length > 1 && incoming.length) reasons.push('Incoming data was received for a cycle that has more than one staged file.');
      out.push({
        key: k, tenantId: p[0], networkKey: p[1], cycleDate: p[2],
        tenantName: (O.tenantById[p[0]] || {}).name, networkName: netName(p[1]),
        runIds: list.map(function (r) { return r.runId; }), runs: list, incomingRuns: incoming,
        reasons: reasons, severity: 'critical'
      });
    });
    return out;
  }
  var _anoms = null;
  function anomalies() { if (!_anoms) _anoms = detectAnomalies(); return _anoms; }
  function anomalyFor(tenantId, netKey, cycleDate) {
    return anomalies().filter(function (a) { return a.tenantId === tenantId && a.networkKey === netKey && a.cycleDate === cycleDate; })[0] || null;
  }
  function anomalyByKey(key) { return anomalies().filter(function (a) { return a.key === key; })[0] || null; }

  /* The plain-language assessment (Part 8.3) — derived from the comparison, not
     written by hand, so it stays true if the runs change. */
  function assessment(anom) {
    if (!anom || anom.runs.length < 2) return '';
    var a = anom.runs[0], b = anom.runs[anom.runs.length - 1];
    var bits = [];
    bits.push((a.recordCounts.read === b.recordCounts.read)
      ? 'Both files cover the same ' + nfmt(a.recordCounts.read) + ' transactions for the same cycle.'
      : 'The two files cover different transaction counts — ' + nfmt(a.recordCounts.read) + ' and ' + nfmt(b.recordCounts.read) + ' — for the same cycle.');
    bits.push(anom.incomingRuns.length
      ? 'Incoming data was received for the first file only.'
      : 'No incoming data has been received for either file.');
    var sa = a.inputFile ? a.inputFile.source : '—', sb = b.inputFile ? b.inputFile.source : '—';
    bits.push('The second file was staged ' + C.dur(Math.abs(b.startAbs - a.endAbs)) + ' later' + (sa !== sb ? ' from a different source.' : ' from the same source.'));
    return bits.join(' ');
  }

  /* =========================================================================
     LOOKUPS THE OTHER SCREENS USE (Part 9 + Part 10)
     ========================================================================= */
  var LEG_TYPES = {
    clearing: ['CLEARING_STAGE', 'CLEARING_GENERATE'],
    settlement: ['SETTLEMENT_GENERATE', 'SETTLEMENT_DELIVER'],
    incoming: ['INCOMING_PARSE', 'INCOMING_FETCH'],
    jv2: []
  };
  function runForLeg(tenantId, netKey, cycleDate, legKey) {
    var cands = [];
    (LEG_TYPES[legKey] || []).forEach(function (ty) {
      cands = cands.concat(runsFor(tenantId, typeById[ty].networked ? netKey : null, cycleDate, ty));
    });
    var bad = cands.filter(function (r) { return r.status === 'failed' || r.status === 'blocked'; });
    // A failed run wins over a succeeded one — it is the reason the leg is red.
    if (bad.length) return bad.sort(function (a, b) { return b.startAbs - a.startAbs; })[0];
    return cands.sort(function (a, b) { return b.startAbs - a.startAbs; })[0] || null;
  }
  function failedRunForLeg(tenantId, netKey, cycleDate, legKey) {
    var r = runForLeg(tenantId, netKey, cycleDate, legKey);
    return (r && (r.status === 'failed' || r.status === 'blocked')) ? r : null;
  }
  function runsForCycle(tenantId, netKey, cycleDate) {
    return runs.filter(function (r) {
      return r.tenantId === tenantId && r.cycleDate === cycleDate && (!netKey || !r.networkKey || r.networkKey === netKey);
    }).sort(function (a, b) { return a.startAbs - b.startAbs; });
  }
  function runForFileRow(row) {
    if (!row) return null;
    if (row.delivery === 'Failed') {
      var d = runsFor(row.tenantId, null, row.date, 'SETTLEMENT_DELIVER').filter(function (r) { return r.status === 'failed'; });
      if (d.length) return d[d.length - 1];
    }
    if (row.validation === 'Mismatch') {
      var v = runsFor(row.tenantId, null, row.date, 'FILE_VALIDATE').filter(function (r) { return r.status === 'failed'; });
      if (v.length) return v[v.length - 1];
      var g = runsFor(row.tenantId, null, row.date, 'SETTLEMENT_GENERATE').filter(function (r) { return r.status === 'failed'; });
      if (g.length) return g[g.length - 1];
    }
    return null;
  }
  function generatingRunForFileRow(row) {
    if (!row) return null;
    var g = runsFor(row.tenantId, null, row.date, 'SETTLEMENT_GENERATE').filter(function (r) { return r.status === 'succeeded'; });
    return g.length ? g[g.length - 1] : null;
  }
  var NET_FROM_NAME = { Visa: 'visa', Mastercard: 'mc', RuPay: 'rupay', 'HSBC ONUS': 'onus' };
  function runForRejectBatch(batch) {
    if (!batch) return null;
    var nk = NET_FROM_NAME[batch.network] || String(batch.network || '').toLowerCase();
    var type = batch.family === 'staging' ? 'CLEARING_STAGE' : 'INCOMING_PARSE';
    var list = runsFor(batch.tenantId, nk, batch.cycleDate, type);
    var bad = list.filter(function (r) { return r.status === 'failed'; });
    if (bad.length) return bad[bad.length - 1];
    return list.length ? list[list.length - 1] : null;
  }

  var _cfgFailures = null;
  function configFailures() {
    if (_cfgFailures) return _cfgFailures;
    _cfgFailures = {};
    var CD = window.CFGDATA;
    if (!CD || !CD.configs) return _cfgFailures;
    runs.forEach(function (r) {
      if (r.status !== 'failed') return;
      if (r.errorCode !== 'CLEARING_LAYOUT_INVALID' && r.errorCode !== 'CLEARING_TRANSFORM_MISSING') return;
      var tk = cfgTenant(r.tenantId);
      var hit = CD.configs.filter(function (c) {
        return c.family === 'network-file' && c.tenantId === tk && c.network === r.networkKey;
      })[0];
      if (hit && !_cfgFailures[hit.configId]) { _cfgFailures[hit.configId] = r; r.configId = hit.configId; }
    });
    return _cfgFailures;
  }
  function activationFailureFor(configId) { return configFailures()[configId] || null; }
  function runsUsingConfig(cfg) {
    if (!cfg) return [];
    var tenant = O.tenants.filter(function (t) { return cfgTenant(t.id) === cfg.tenantId; })[0];
    if (!tenant) return [];
    var famTypes = cfg.family === 'incoming-parsing' ? ['INCOMING_PARSE', 'INCOMING_FETCH']
      : cfg.family === 'settlement' ? ['SETTLEMENT_GENERATE', 'SETTLEMENT_DELIVER', 'FILE_VALIDATE']
        : ['CLEARING_GENERATE', 'CLEARING_STAGE'];
    return runs.filter(function (r) {
      if (r.tenantId !== tenant.id || famTypes.indexOf(r.type) < 0) return false;
      if (cfg.network && r.networkKey && r.networkKey !== cfg.network) return false;
      return true;
    }).sort(function (a, b) { return a.startDay === b.startDay ? b.startAbs - a.startAbs : (a.startDay < b.startDay ? 1 : -1); });
  }

  /* A break whose cause is the SYSTEM rather than the network — i.e. a cycle
     where one of this tenant's runs actually failed or was blocked. */
  function systemCauseForCycle(tenantId, cycleDate) {
    var bad = runs.filter(function (r) {
      return r.tenantId === tenantId && r.cycleDate === cycleDate && (r.status === 'failed' || r.status === 'blocked');
    });
    if (!bad.length) return null;
    return bad.sort(function (a, b) { return a.startAbs - b.startAbs; })[0];
  }

  /* =========================================================================
     ACTIONS — all mocked, all in memory (Part 13: no real run execution)
     ========================================================================= */
  var _manualSeq = 0;
  function startRun(type, tenantId, netKey, cycleDate, by) {
    var def = typeById[type];
    if (!def) return null;
    var nk = def.networked ? netKey : null;
    var checks = preflightFor(type, tenantId, netKey, cycleDate);
    var blocks = blockingChecks(checks);
    var code = blocks.length ? GUARD_CODE_BY_CHECK[blocks[0].key] : null;
    _manualSeq++;
    var run = buildRun({
      type: type, tenantId: tenantId, networkKey: nk, cycleDate: cycleDate,
      endAbs: NOW_ABS + _manualSeq, status: blocks.length ? 'blocked' : 'succeeded',
      errorCode: code, trigger: 'manual', triggeredBy: by || OPS_USER,
      preflight: checks, attempt: 900 + _manualSeq
    });
    run.runId = 'RUN-' + TODAY.replace(/-/g, '') + '-' + pad(9000 + _manualSeq, 4);
    if (blocks.length) {
      // A blocking check with no catalog entry must not borrow another entry's
      // cause — the card takes the honest unknown path instead (Part 4.3).
      run.authoredValues = { blockMessage: blocks[0].message, blockLabel: blocks[0].label };
      var v = baseValues(run);
      var derived = codeValues(run, v);
      Object.keys(derived).forEach(function (k) { if (derived[k] != null && derived[k] !== '') v[k] = derived[k]; });
      v.blockMessage = blocks[0].message; v.blockLabel = blocks[0].label;
      var known = E.has(code);
      run.rca = {
        code: code, known: known, kind: 'blocked', stage: 'Pre-flight checks', values: v,
        evidence: known ? (evidenceFor(run, v) || unknownEvidence(run, v)) : [
          C.hhmm(run.startAbs) + ':00 BLOCK ' + String(code).toLowerCase(),
          '  check=' + blocks[0].key + ' (' + blocks[0].label + ')',
          '  ' + blocks[0].message,
          '  run created with status=blocked — nothing executed'
        ],
        evidenceCap: known ? 6 : 12
      };
      run.rca.log = technicalLog(run, v);
    }
    runs.push(run); byId[run.runId] = run; _anoms = null;
    return run;
  }
  function rerun(run, by) {
    if (!run) return null;
    return startRun(run.type, run.tenantId, run.networkKey, run.cycleDate, by || OPS_USER);
  }
  function voidRun(runId, note) {
    var run = byId[runId];
    if (!run) return null;
    run.voided = true; run.voidNote = note;
    if (run.tags.indexOf('Voided') < 0) run.tags.push('Voided');
    _anoms = null;
    return run;
  }

  /* =========================================================================
     FILTERING + COUNTS for the Run Console
     ========================================================================= */
  function query(f) {
    f = f || {};
    var out = runs.filter(function (r) {
      if (f.from && r.startDay < f.from) return false;
      if (f.to && r.startDay > f.to) return false;
      if (f.tenant && f.tenant !== 'all' && r.tenantId !== f.tenant) return false;
      if (f.network && f.network !== 'all' && (r.networkKey || '-') !== f.network) return false;
      if (f.type && f.type !== 'all' && r.type !== f.type) return false;
      if (f.status && f.status !== 'all' && r.status !== f.status) return false;
      if (f.cycleDate && r.cycleDate !== f.cycleDate) return false;
      if (f.tag && r.tags.indexOf(f.tag) < 0) return false;
      if (f.q) {
        var q = String(f.q).toLowerCase();
        var hay = (r.runId + ' ' + (r.inputFile ? r.inputFile.name : '') + ' ' + (r.outputFile ? r.outputFile.name : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    return out.sort(function (a, b) {
      if (a.startDay !== b.startDay) return a.startDay < b.startDay ? 1 : -1;
      return b.startAbs - a.startAbs;
    });
  }
  function counts(list) {
    var c = { succeeded: 0, failed: 0, blocked: 0, running: 0, queued: 0, cancelled: 0, total: list.length };
    list.forEach(function (r) { if (c[r.status] != null) c[r.status]++; });
    return c;
  }
  function health() {
    var c = counts(runs);
    return {
      total: runs.length, succeeded: c.succeeded, failed: c.failed, blocked: c.blocked, running: c.running,
      successPct: runs.length ? Math.round(c.succeeded / runs.length * 1000) / 10 : 0
    };
  }

  return {
    TODAY: TODAY, CYCLE_TODAY: CYCLE_TODAY, NOW_ABS: NOW_ABS,
    MIN_DATE: C.cycleDates[0], MAX_DATE: TODAY,
    OPS_USER: OPS_USER, CHECKER_USER: CHECKER_USER,
    TYPES: TYPES, typeById: typeById, OPERATIONS: OPERATIONS,
    STATUS_META: STATUS_META, CHECK_DEFS: CHECK_DEFS, STATE_ROWS: STATE_ROWS,
    EXPECTED_SOURCE: EXPECTED_SOURCE, INCIDENT: INCIDENT,

    runs: runs, byId: byId, query: query, counts: counts, health: health,
    runsFor: runsFor, runsForCycle: runsForCycle, lastSucceeded: lastSucceeded,
    runForLeg: runForLeg, failedRunForLeg: failedRunForLeg,
    runForFileRow: runForFileRow, generatingRunForFileRow: generatingRunForFileRow,
    runForRejectBatch: runForRejectBatch,
    activationFailureFor: activationFailureFor, runsUsingConfig: runsUsingConfig,
    systemCauseForCycle: systemCauseForCycle,

    currentState: currentState, preflight: preflightFor, pendingFile: pendingFile,
    blockingChecks: blockingChecks, warnChecks: warnChecks, GUARD_CODE_BY_CHECK: GUARD_CODE_BY_CHECK,

    anomalies: anomalies, anomalyFor: anomalyFor, anomalyByKey: anomalyByKey, assessment: assessment,

    overrides: overrides, requestOverride: requestOverride, approveOverride: approveOverride,
    rejectOverride: rejectOverride, overrideFor: overrideFor, pendingOverrides: pendingOverrides,
    consequenceOf: consequenceOf,

    startRun: startRun, rerun: rerun, voidRun: voidRun,

    hhmm: C.hhmm, stampOf: stampOf, durLabel: durLabel, dayOfRun: dayOfRun,
    netName: netName, tenantSlug: tenantSlug, bytes: bytes, nfmt: nfmt, primaryNetwork: primaryNetwork
  };
})();
