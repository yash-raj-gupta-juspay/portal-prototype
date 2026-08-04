/* =============================================================================
   Juspay Ops Portal — File processing records (file-detail brief Parts 2, 4, 9)

   ONE STEP SHAPE, AND IT IS THE WHOLE BACKEND CONTRACT (Part 2.2):

     Step {
       name, status,                   // already exist
       started_at, finished_at,        // ADD — timestamps, finished_at null while running
       error_code, error_detail        // ADD — null on success
     }

   Nothing else is assumed. No new endpoints, no log aggregation, no error
   descriptions from the backend, no new tables. The three optional counts
   (records_in / records_out / records_rejected, Part 2.3) are set only on the
   steps that would genuinely already record them, and are simply absent
   everywhere else — a renderer that finds them missing omits the row rather
   than printing a placeholder.

   The plain-language reason a step failed lives in failure-hints.js, keyed on
   error_code. Nothing in this file describes a failure in prose except the raw
   `error_detail` line the pipeline itself produced.

   THREE PIPELINES (Part 4), and only the steps a pipeline actually reports:
     incoming    Received · [Decrypt] · Pre-Processing · Transformation
                 (↳ Global Level Check, ↳ Transaction Level Check) · Persist · Recon
     clearing    Fetch transactions · Apply layout · Apply transforms ·
                 Write file · [Encrypt] · Upload
     settlement  Resolve schedule · Fetch transactions · Apply report config ·
                 Apply fee rules · Write file · Deliver to acquirer

   Decrypt and Encrypt appear only on the networks that exchange GPG-wrapped
   files (Visa, Mastercard). RuPay and HSBC ONUS have no such step and are not
   given a fabricated one — that is the Part 4 rule, made visible.

   All state is in memory. Nothing is written to browser storage.
   ============================================================================= */
window.PFILES = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES, F = window.SFILES;
  var FH = window.FailureHints;

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
  function pad3(n) { return String(n).padStart(3, '0'); }

  var TODAY = D.TODAY;                       // 2025-11-21 — the processing day
  var CYCLE_TODAY = U.addDays(TODAY, -1);    // 2025-11-20 — the current cycle
  var WINDOW = 10;                           // cycle dates the screen can reach

  /* =========================================================================
     TIMESTAMPS
     started_at / finished_at are stored exactly as the backend would send
     them — one absolute timestamp string per field. Every clock time and every
     duration shown in the UI is derived from those two strings, so a step that
     carries neither simply shows its status and nothing else.
     ========================================================================= */
  function ts(date, ms) {
    var s = Math.floor(ms / 1000), msec = ms % 1000;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return date + 'T' + pad2(h) + ':' + pad2(m) + ':' + pad2(sec) + '.' + pad3(msec);
  }
  var TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
  function parts(v) {
    if (!v) return null;
    var m = TS_RE.exec(String(v));
    return m ? m : null;
  }
  /* 'HH:MM:SS' for the step meta line. Null in, null out — never a placeholder. */
  function clockOf(v) {
    var m = parts(v);
    return m ? m[4] + ':' + m[5] + ':' + m[6] : null;
  }
  function dateOf(v) { var m = parts(v); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; }
  function msOf(v) {
    var m = parts(v);
    if (!m) return null;
    // Day-of-year offset keeps a duration correct across a midnight boundary.
    var day = U.fromYmd(m[1] + '-' + m[2] + '-' + m[3]).getTime();
    return day + (+m[4]) * 3600000 + (+m[5]) * 60000 + (+m[6]) * 1000 + (m[7] ? +String(m[7]).padEnd(3, '0') : 0);
  }
  function durationMs(step) {
    var a = msOf(step.started_at), b = msOf(step.finished_at);
    return (a == null || b == null) ? null : Math.max(0, b - a);
  }
  /* Durations read the way an operator says them out loud. */
  function durLabel(ms) {
    if (ms == null) return null;
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + (s ? s + 's' : '00s');
  }
  /* A full, human stamp for the File Details rows — same source strings. */
  function stampOf(v) {
    var m = parts(v);
    if (!m) return null;
    return U.prettyDate(m[1] + '-' + m[2] + '-' + m[3]) + ', ' + m[4] + ':' + m[5] + ':' + m[6] + ' IST';
  }

  /* =========================================================================
     STEP CONSTRUCTION
     ========================================================================= */
  var SKIPPED = 'skipped';   // rendered "Not run" — everything after a failure

  function mkStep(name, status) {
    // Every field in the contract is present on every step, null where the
    // contract says null. A renderer never has to guess whether a key exists.
    return {
      name: name, status: status,
      started_at: null, finished_at: null,
      error_code: null, error_detail: null
    };
  }

  /* Lays a step list onto a clock. `failAt` may name a top-level step or a
     nested check; `runningAt` names the step that has started and not
     finished. Everything after a failure is SKIPPED with no timestamps at all,
     because nothing ran and there is nothing to report. */
  function buildSteps(defs, opts) {
    opts = opts || {};
    var date = opts.date, t = opts.startMs;
    var failAt = opts.failAt || null, runningAt = opts.runningAt || null;
    var err = opts.error || {};
    var stopped = false, halted = false;   // halted = failed OR still running

    function counts(step, def) {
      if (!def.counts) return;
      if (def.counts.in != null) step.records_in = def.counts.in;
      if (def.counts.out != null) step.records_out = def.counts.out;
      if (def.counts.rejected != null) step.records_rejected = def.counts.rejected;
    }

    function run(def) {
      var s = mkStep(def.name, 'success');
      // Nothing after a failure ran, so it carries no timestamps at all —
      // "Not run" is the whole truth about it. Steps after a running step are
      // still waiting, which is a different thing and reads differently.
      if (halted) { s.status = stopped ? SKIPPED : 'pending'; return s; }
      if (def.name === runningAt) {
        s.status = 'running';
        s.started_at = ts(date, t);        // finished_at stays null while running
        halted = true;
        return s;
      }
      s.started_at = ts(date, t);
      t += def.dur;
      if (def.link) s.link = def.link;

      /* The step itself failed, so anything nested under it never ran. A check
         shown as passed under a Transformation that died is a lie the panel
         must not tell. */
      if (def.name === failAt) {
        s.finished_at = ts(date, t);
        // No counts on a step that failed. It did not produce the records it
        // would have produced, and printing them would be a number the panel
        // invented — the same sin as inventing a cause.
        s.status = 'failed';
        s.error_code = err.code || null;
        s.error_detail = err.detail || null;
        stopped = true; halted = true;
        if (def.children) s.children = def.children.map(function (c) { return mkStep(c.name, SKIPPED); });
        t += 120;
        return s;
      }

      if (def.children) {
        s.children = def.children.map(function (c) { t += 60; return run(c); });
        // A check still running leaves its parent running too.
        if (halted && !stopped) { s.status = 'running'; return s; }
      }
      s.finished_at = ts(date, t);
      counts(s, def);
      // A failed check does not make its parent fail: Transformation genuinely
      // produced records, and the check under it is what stopped the file. The
      // failure block renders on the check itself (brief 3.4).
      t += 120;                            // hand-off between steps
      return s;
    }

    return defs.map(run);
  }

  /* =========================================================================
     PIPELINE DEFINITIONS (Part 4)
     ========================================================================= */
  var GPG_NETWORKS = { visa: 1, mc: 1 };     // the only two that exchange GPG-wrapped files

  function checkLinks(tenantId, netKey, date) {
    var cfgT = FH.CFG_TENANT[tenantId], src = FH.CFG_SOURCE[netKey];
    var globalHref = '#/dashboard/ops/configs/incoming?tab=preprocessor' +
      (src ? '&cfgFacet=' + src : '') + (cfgT ? '&cfgTenant=' + cfgT : '');
    // Record-level validation failures are exactly what becomes a reject, so
    // the transaction check points at the rejects for this cycle.
    var txnHref = '#/dashboard/ops/rejects?rejTenant=' + tenantId + '&rejDate=' + date + '&rejFamily=incoming';
    return {
      global: { label: 'File-level validation rules', href: globalHref },
      txn: { label: 'Records that failed validation', href: txnHref }
    };
  }

  function incomingDefs(tenantId, netKey, date, total, invalid) {
    var lk = checkLinks(tenantId, netKey, date);
    var defs = [{ name: 'Received', dur: 640 }];
    if (GPG_NETWORKS[netKey]) defs.push({ name: 'Decrypt', dur: 2380 });
    defs.push({ name: 'Pre-Processing', dur: 1420 });
    defs.push({
      name: 'Transformation', dur: 3160,
      counts: { in: total, out: total - invalid },
      children: [
        { name: 'Global Level Check', dur: 680, link: lk.global },
        { name: 'Transaction Level Check', dur: 2540, link: lk.txn, counts: { in: total, rejected: invalid } }
      ]
    });
    defs.push({ name: 'Persist', dur: 5240, counts: { in: total - invalid, out: total - invalid } });
    defs.push({ name: 'Recon', dur: 8610, counts: { in: total - invalid } });
    return defs;
  }

  function clearingDefs(netKey, total) {
    var defs = [
      { name: 'Fetch transactions', dur: 4120, counts: { out: total } },
      { name: 'Apply layout', dur: 2260 },
      { name: 'Apply transforms', dur: 3480, counts: { in: total, out: total } },
      { name: 'Write file', dur: 2940 }
    ];
    if (GPG_NETWORKS[netKey]) defs.push({ name: 'Encrypt', dur: 1810 });
    defs.push({ name: 'Upload', dur: 2630 });
    return defs;
  }

  function settlementDefs(total) {
    return [
      { name: 'Resolve schedule', dur: 380 },
      { name: 'Fetch transactions', dur: 5240, counts: { out: total } },
      { name: 'Apply report config', dur: 2110, counts: { in: total } },
      { name: 'Apply fee rules', dur: 3760, counts: { in: total } },
      { name: 'Write file', dur: 2480, counts: { out: total } },
      { name: 'Deliver to acquirer', dur: 4310 }
    ];
  }

  /* =========================================================================
     PART 9 — AUTHORED FAILURE SCENARIOS
     Every row of the Part 9 table, plus the two that matter most: an
     uncatalogued code and a null code. Keys are tenant|network|cycle-date.
     ========================================================================= */

  /* Incoming. The incoming leg on the Cycle Snapshot measures arrival by the
     cutoff; these are parse-time failures after a file has already landed, so
     nothing here contradicts a leg that shows as received. */
  var INCOMING_FAILS = {
    // Part 9 · Unmapped field → Transformation
    'hsbc-in|visa|2025-11-20': {
      at: 'Transformation', code: 'PARSE_FIELD_UNMAPPED',
      detail: 'parse.field_unmapped position=118 length=4 record_type=TCR0'
    },
    // Part 9 · Decryption failure → Decrypt
    'hsbc-sg|mc|2025-11-20': {
      at: 'Decrypt', code: 'DECRYPT_KEY_MISMATCH',
      detail: 'gpg: decryption failed: No secret key (keyid 0x9F31A2C4)'
    },
    // Part 9 · UNCATALOGUED CODE → the honest gap in Part 5.3
    'yesbank|mc|2025-11-20': {
      at: 'Transformation', code: 'PARSE_UNKNOWN_STATE_9114',
      detail: 'parse.unknown_state code=9114 stage=record_assembler'
    },
    // Part 9 · NULL CODE → the other honest gap in Part 5.3. No detail either:
    // this is the case where the pipeline recorded that it stopped and nothing
    // more, which is exactly what production will produce some of the time.
    'hsbc-in|mc|2025-11-20': {
      at: 'Persist', code: null, detail: null
    },
    // Part 9 · Layout not recognised → Pre-Processing
    'hsbc-sg|visa|2025-11-19': {
      at: 'Pre-Processing', code: 'LAYOUT_NOT_DETECTED',
      detail: 'preprocess.layout_not_detected header="0110VSS-110" candidates=0'
    },
    // Part 9 · Trailer mismatch → Transaction Level Check (a nested check)
    'hsbc-in|mc|2025-11-19': {
      at: 'Transaction Level Check', code: 'TRAILER_COUNT_MISMATCH',
      detail: 'trailer.count_mismatch trailer=48211 parsed=48198 delta=-13'
    },
    'yesbank|rupay|2025-11-19': {
      at: 'Pre-Processing', code: 'FILE_EMPTY',
      detail: 'preprocess.file_empty bytes=0 records=0'
    },
    'hsbc-hk|mc|2025-11-18': {
      at: 'Transformation', code: 'LAYOUT_LENGTH_MISMATCH',
      detail: 'layout.length_mismatch expected=1000 actual=996 record=2841'
    },
    'yesbank|visa|2025-11-18': {
      at: 'Pre-Processing', code: 'UNKNOWN_RECORD_TYPE',
      detail: 'preprocess.unknown_record_type tc=48 tcr=0 first_seen_record=17'
    }
  };

  /* Incoming files still moving at the observer's 09:00 — Part 9's in-progress
     requirement. The named step is running and everything after it is pending. */
  var INCOMING_RUNNING = {
    'hsbc-hk|onus|2025-11-20': 'Transformation',
    'yesbank|rupay|2025-11-20': 'Persist',
    'hsbc-hk|visa|2025-11-20': 'Recon'
  };

  /* Outgoing clearing. A clearing file that failed was never submitted, so the
     cycle's clearing leg could not be complete — unless the run was re-cut and
     the second attempt went out, which is what actually happens. These are
     therefore authored as first attempts, each superseded by the file the leg
     reflects. The re-cut is listed too, so the pair reads as one story. */
  var CLEARING_FAILS = {
    // Part 9 · Value too long → Apply layout
    'hsbc-in|mc|2025-11-20': {
      at: 'Apply layout', code: 'FIELD_VALUE_OVERFLOW',
      detail: 'layout.value_overflow field=merchant_name len=31 max=25 record=8842'
    },
    // Part 9 · Unmapped source → Apply transforms
    'yesbank|visa|2025-11-19': {
      at: 'Apply transforms', code: 'TRANSFORM_SOURCE_MISSING',
      detail: 'transform.source_missing field=interchange_rate_designator source=<unset>'
    },
    'hsbc-sg|mc|2025-11-19': {
      at: 'Upload', code: 'UPLOAD_FAILED',
      detail: 's3.put_object timed out after 3 attempts bucket=juspay-clearing-out'
    },
    'hsbc-hk|visa|2025-11-18': {
      at: 'Apply layout', code: 'LAYOUT_CONFIG_INVALID',
      detail: 'layout.invalid overlapping fields card_number[5-21] expiry[19-24]'
    },
    'hsbc-in|rupay|2025-11-17': {
      at: 'Fetch transactions', code: 'NO_TRANSACTIONS_FOUND',
      detail: 'select returned 0 rows for tenant=hsbc-in network=rupay cycle=2025-11-17'
    }
  };

  var CLEARING_RUNNING = {
    'hsbc-hk|onus|2025-11-20': 'Write file',
    'hsbc-sg|visa|2025-11-20': 'Upload'
  };

  /* Settlement. Keyed tenant|file-type|cycle-date — settlement files have no
     network dimension and nothing here may introduce one. These override the
     step list derived from an Acquirer Reports row. */
  var SETTLEMENT_FAILS = {
    // Part 9 · No fee rule matched → Apply fee rules
    'hsbc-in|JV2|2025-11-21': {
      at: 'Apply fee rules', code: 'FEE_RULE_NO_MATCH',
      detail: 'fee.no_match mcc=6012 records=214 rule_set=hsbc_in_std_v3'
    },
    'hsbc-hk|JV2|2025-11-17': {
      at: 'Resolve schedule', code: 'SCHEDULE_EXCLUDED_DAY',
      detail: 'schedule.excluded day=Monday calendar=hsbc_hk_settlement'
    }
  };
  var SETTLEMENT_RUNNING = {
    'hsbc-hk|JV2|2025-11-21': 'Deliver to acquirer'
  };

  /* Codes a retry can clear on its own. Everything else needs the thing the
     hint points at to change first, and retrying it unchanged fails the same
     way — which is the honest outcome and the reason the deep link exists. */
  var TRANSIENT = { UPLOAD_FAILED: 1, DELIVERY_FAILED: 1 };

  /* =========================================================================
     RECORD CONSTRUCTION
     ========================================================================= */
  function tenantSlug(tenantId) { return (O.tenantById[tenantId] || { name: tenantId }).name.replace(/\s/g, ''); }
  function uuidFor(key) {
    var r = rng(seedOf('uuid|' + key)), hex = '';
    for (var i = 0; i < 32; i++) hex += '0123456789abcdef'[rint(r, 0, 15)];
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function checksumFor(r) {
    var s = ''; for (var i = 0; i < 8; i++) s += '0123456789abcdef'[rint(r, 0, 15)];
    return 'sha256:' + s + '…';
  }

  var INC_NAME = { visa: 'VSS_TC46', mc: 'GCMS_T140', rupay: 'NPCI_RAW', onus: 'ONUS_RESP' };
  var INC_EXT = { visa: 'dat', mc: 'ipm', rupay: 'txt', onus: 'csv' };
  var CLR_EXT = { visa: 'ctf', mc: 'ipm', rupay: 'npci', onus: 'csv' };
  var INC_DESC = { visa: 'VSS TC46 settlement report', mc: 'GCMS T140 clearing response', rupay: 'NPCI raw settlement', onus: 'ONUS response file' };
  var INC_SOURCE = { visa: 'visa-vss-sftp', mc: 'mastercard-gcms-sftp', rupay: 'npci-sftp', onus: 'onus-internal' };

  var DIR_LABEL = { incoming: 'Incoming', clearing: 'Outgoing clearing', settlement: 'Settlement' };

  /* Status of the file as a whole, read off the steps rather than stored
     separately — the two can then never disagree. */
  function statusOf(steps) {
    var flat = [];
    steps.forEach(function (s) { flat.push(s); (s.children || []).forEach(function (k) { flat.push(k); }); });
    if (flat.some(function (s) { return s.status === 'failed'; })) return 'Failed';
    if (flat.some(function (s) { return s.status === 'running'; })) return 'Running';
    if (flat.some(function (s) { return s.status === 'pending'; })) return 'Running';
    return 'Success';
  }
  /* The step that stopped the file, top-level or nested. */
  function failedStep(file) {
    var hit = null;
    (file.steps || []).forEach(function (s) {
      if (s.status === 'failed' && !hit) hit = s;
      (s.children || []).forEach(function (k) { if (k.status === 'failed' && !hit) hit = k; });
    });
    return hit;
  }

  /* Records the pipeline reports at file level. Present only once the step
     that counts them has actually finished — otherwise absent, never zero. */
  function fileCounts(steps, total, invalid) {
    var tr = null;
    steps.forEach(function (s) { if (s.name === 'Transformation' && s.status === 'success') tr = s; });
    if (!tr) return { total: null, invalid: null };
    return { total: total, invalid: invalid };
  }

  function buildIncoming(tenantId, netKey, date) {
    var key = tenantId + '|' + netKey + '|' + date;
    var r = rng(seedOf('inc|' + key));
    var procDate = U.addDays(date, 1);
    var total = rint(r, 18400, 74200);
    var invalid = rint(r, 0, 46);
    var fail = INCOMING_FAILS[key] || null;
    var running = INCOMING_RUNNING[key] || null;
    var startMs = (rint(r, 2, 7) * 3600 + rint(r, 4, 58) * 60 + rint(r, 0, 59)) * 1000;
    var steps = buildSteps(incomingDefs(tenantId, netKey, date, total, invalid), {
      date: procDate, startMs: startMs,
      failAt: fail ? fail.at : null, runningAt: running,
      error: fail ? { code: fail.code, detail: fail.detail } : null
    });
    var counts = fileCounts(steps, total, invalid);
    var net = D.NET_BY_KEY[netKey];
    return {
      id: 'inc|' + key,
      uuid: uuidFor('inc|' + key),
      direction: 'incoming', directionLabel: DIR_LABEL.incoming,
      name: INC_NAME[netKey] + '_' + tenantSlug(tenantId) + '_' + date.replace(/-/g, '') + '.' + INC_EXT[netKey],
      fileType: INC_DESC[netKey],
      tenantId: tenantId, networkKey: netKey, networkName: net ? net.name : netKey,
      reportBase: null,
      date: date, procDate: procDate,
      size: (0.4 + r() * 4).toFixed(1) + ' MB',
      checksum: checksumFor(r),
      source: 's3://juspay-incoming/' + tenantId + '/' + netKey + '/',
      totalRecords: counts.total, invalidRecords: counts.invalid,
      uploadedBy: INC_SOURCE[netKey],
      uploadedOn: stampOf(steps[0].started_at),
      supersededBy: null,
      steps: steps
    };
  }

  function buildClearing(tenantId, netKey, date, variant) {
    // variant 'fail' is the first attempt; 'ok' is the file the cycle leg
    // reflects. A cycle with no authored failure only ever has the 'ok' file.
    var key = tenantId + '|' + netKey + '|' + date;
    var r = rng(seedOf('clr|' + variant + '|' + key));
    var total = rint(r, 21000, 88000);
    var fail = variant === 'fail' ? CLEARING_FAILS[key] : null;
    var running = variant === 'ok' ? (CLEARING_RUNNING[key] || null) : null;
    var baseMin = 21 * 60 + rint(r, 30, 52);
    var startMs = (variant === 'fail' ? baseMin - rint(r, 26, 48) : baseMin) * 60000 + rint(r, 0, 59) * 1000;
    var steps = buildSteps(clearingDefs(netKey, total), {
      date: date, startMs: startMs,
      failAt: fail ? fail.at : null, runningAt: running,
      error: fail ? { code: fail.code, detail: fail.detail } : null
    });
    var net = D.NET_BY_KEY[netKey];
    var name = tenantSlug(tenantId) + '_' + (net ? net.short.toUpperCase() : netKey.toUpperCase()) +
      '_CLEARING_' + date.replace(/-/g, '') + (variant === 'fail' ? '_A1' : '') + '.' + CLR_EXT[netKey];
    var okName = tenantSlug(tenantId) + '_' + (net ? net.short.toUpperCase() : netKey.toUpperCase()) +
      '_CLEARING_' + date.replace(/-/g, '') + '.' + CLR_EXT[netKey];
    var last = steps[steps.length - 1];
    return {
      id: 'clr|' + variant + '|' + key,
      uuid: uuidFor('clr|' + variant + '|' + key),
      direction: 'clearing', directionLabel: DIR_LABEL.clearing,
      name: name,
      fileType: (net ? net.name : netKey) + ' outgoing clearing',
      tenantId: tenantId, networkKey: netKey, networkName: net ? net.name : netKey,
      reportBase: null,
      date: date, procDate: date,
      size: (0.8 + r() * 7).toFixed(1) + ' MB',
      checksum: checksumFor(r),
      source: '/out/' + tenantId + '/clearing/',
      totalRecords: steps[0].finished_at ? total : null,
      invalidRecords: null,
      uploadedBy: 'clearing-generator',
      uploadedOn: stampOf(steps[0].started_at),
      // The first attempt says, in the file record itself, that a later one
      // went out — otherwise a failed clearing file would read as a cycle that
      // never cleared, which the cycle grid would flatly contradict.
      supersededBy: variant === 'fail' ? { name: okName, at: null } : null,
      steps: steps,
      _lastEnd: last ? last.finished_at : null
    };
  }

  /* Settlement records are derived from an Acquirer Reports row so the
     two screens can never disagree about a file's delivery state. */
  function buildSettlement(row) {
    var key = row.tenantId + '|' + row.type + '|' + row.date;
    var r = rng(seedOf('stl|' + key));
    var total = rint(r, 18000, 74000);
    var fail = SETTLEMENT_FAILS[key] || null;
    var running = SETTLEMENT_RUNNING[key] || null;
    // Delivery is the one step whose outcome the row already knows.
    if (!fail && row.delivery === 'Failed') {
      fail = {
        at: 'Deliver to acquirer', code: 'DELIVERY_FAILED',
        detail: row.failReason || 'transfer.failed endpoint=' + row.dest
      };
    }
    if (!fail && !running && row.delivery === 'Pending') running = 'Deliver to acquirer';
    var startMs = (2 * 3600 + rint(r, 4, 52) * 60 + rint(r, 0, 59)) * 1000;
    var steps = buildSteps(settlementDefs(total), {
      date: row.date, startMs: startMs,
      failAt: fail ? fail.at : null, runningAt: running,
      error: fail ? { code: fail.code, detail: fail.detail } : null
    });
    var write = steps.filter(function (s) { return s.name === 'Write file' && s.status === 'success'; })[0];
    return {
      id: 'stl|' + row.id,
      uuid: uuidFor('stl|' + key),
      direction: 'settlement', directionLabel: DIR_LABEL.settlement,
      name: row.name,
      fileType: row.type + ' · ' + row.typeDesc,
      tenantId: row.tenantId, networkKey: null, networkName: null,
      reportBase: row.type,
      date: row.date, procDate: row.date,
      size: row.size, checksum: row.checksum, source: row.dest,
      totalRecords: write ? total : null,
      invalidRecords: null,
      uploadedBy: 'settlement-generator',
      uploadedOn: stampOf(steps[0].started_at),
      supersededBy: null,
      steps: steps,
      rowId: row.id
    };
  }

  /* =========================================================================
     THE REGISTRY
     Built once, mutated in place by Retry, held in memory for the session.
     ========================================================================= */
  var BY_ID = {};
  var RECON_LIST = null;

  function register(f) {
    f.status = statusOf(f.steps);
    BY_ID[f.id] = f;
    return f;
  }

  function cycleDates() {
    var out = [];
    for (var i = WINDOW - 1; i >= 0; i--) out.push(U.addDays(CYCLE_TODAY, -i));
    return out;
  }

  /* Cycles where the network never produced an incoming file at all. Taken
     from the cycle model's own authored failures so the two agree. */
  var NO_INCOMING = { 'yesbank|mc|2025-11-12': 1 };

  /* Incoming and outgoing clearing files — the Recon File Management list.
     Settlement files are not duplicated here: their home is Settlement File
     Monitoring, which opens the same panel on the same records. */
  function reconFiles() {
    if (RECON_LIST) return RECON_LIST;
    var out = [];
    cycleDates().forEach(function (date) {
      O.tenants.forEach(function (t) {
        C.networksFor(t.id).forEach(function (net) {
          var key = t.id + '|' + net.key + '|' + date;
          // No incoming file exists when the network never sent one. An absent
          // file is absent — it is not a row in a fabricated status.
          if (!NO_INCOMING[key]) out.push(register(buildIncoming(t.id, net.key, date)));
          if (CLEARING_FAILS[key]) out.push(register(buildClearing(t.id, net.key, date, 'fail')));
          out.push(register(buildClearing(t.id, net.key, date, 'ok')));
        });
      });
    });
    // The re-cut names its predecessor's successor stamp now that both exist.
    out.forEach(function (f) {
      if (f.supersededBy) {
        var ok = BY_ID['clr|ok|' + f.tenantId + '|' + f.networkKey + '|' + f.date];
        if (ok) f.supersededBy.at = stampOf(ok._lastEnd);
      }
    });
    RECON_LIST = out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
      if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
      return a.name < b.name ? -1 : 1;
    });
    return RECON_LIST;
  }

  /* Settlement records are made on demand from their row and cached by row id. */
  var STL_BY_ROW = {};
  function forSettlementRow(row) {
    if (!row) return null;
    if (STL_BY_ROW[row.id]) return STL_BY_ROW[row.id];
    var f = register(buildSettlement(row));
    STL_BY_ROW[row.id] = f;
    return f;
  }

  /* =========================================================================
     CYCLE SNAPSHOT — the file behind a leg (Part 6, third entry point)
     Returns null where the leg has no file record to open. A leg whose failure
     happened outside the file pipeline — the network rejecting a batch it had
     already accepted, or a leg that never ran because the one before it
     failed — has nothing a file-detail panel could honestly show, and the
     calling screen renders no link at all rather than a dead one (Part 7).
     ========================================================================= */
  function forLeg(tenantId, netKey, date, legKey) {
    if (legKey === 'incoming') {
      var incId = 'inc|' + tenantId + '|' + netKey + '|' + date;
      reconFiles();
      return BY_ID[incId] || null;
    }
    if (legKey === 'clearing') {
      reconFiles();
      return BY_ID['clr|fail|' + tenantId + '|' + netKey + '|' + date] ||
        BY_ID['clr|ok|' + tenantId + '|' + netKey + '|' + date] || null;
    }
    if (legKey === 'settlement' || legKey === 'jv2') {
      var key = tenantId + '|' + netKey + '|' + date + '|' + legKey;
      if (LEG_STL[key]) return LEG_STL[key];
      var spec = LEG_SETTLEMENT_FAILS[key];
      if (!spec) return null;
      LEG_STL[key] = register(buildLegSettlement(tenantId, date, legKey, spec));
      return LEG_STL[key];
    }
    return null;
  }

  /* The two settlement generations the cycle model authors as failed. Each is a
     genuine step failure, so each has a file record worth opening. */
  var LEG_SETTLEMENT_FAILS = {
    'hsbc-sg|visa|2025-11-18|settlement': {
      report: 'JV1',
      at: 'Apply fee rules', code: 'FEE_RULE_NO_MATCH',
      detail: 'fee.no_match mcc=6012 records=214 rule_set=hsbc_sg_std_v2'
    },
    'yesbank|mc|2025-11-12|settlement': {
      report: 'MPR',
      at: 'Fetch transactions', code: 'REPORT_SOURCE_EMPTY',
      detail: 'report.source_empty rows=0 cycle=2025-11-12 filter=cleared_only'
    }
  };
  var LEG_STL = {};

  function buildLegSettlement(tenantId, date, legKey, spec) {
    var key = tenantId + '|' + spec.report + '|' + date + '|' + legKey;
    var r = rng(seedOf('legstl|' + key));
    var total = rint(r, 18000, 74000);
    var startMs = (2 * 3600 + rint(r, 4, 52) * 60 + rint(r, 0, 59)) * 1000;
    var steps = buildSteps(settlementDefs(total), {
      date: date, startMs: startMs, failAt: spec.at,
      error: { code: spec.code, detail: spec.detail }
    });
    return {
      id: 'leg|' + key,
      uuid: uuidFor('leg|' + key),
      direction: 'settlement', directionLabel: DIR_LABEL.settlement,
      name: tenantSlug(tenantId) + '_' + spec.report + '_' + date.replace(/-/g, '') +
        (spec.report === 'MPR' ? '.csv' : '.xml'),
      fileType: spec.report + ' · settlement generation',
      tenantId: tenantId, networkKey: null, networkName: null,
      reportBase: spec.report,
      date: date, procDate: date,
      size: '—', checksum: null,
      source: '/out/' + tenantId + '/' + (spec.report === 'JV1' ? 'journals' : 'reports') + '/',
      totalRecords: null, invalidRecords: null,
      uploadedBy: 'settlement-generator',
      uploadedOn: stampOf(steps[0].started_at),
      supersededBy: null,
      steps: steps
    };
  }

  function byId(id) {
    if (BY_ID[id]) return BY_ID[id];
    reconFiles();
    return BY_ID[id] || null;
  }
  /* A file addressed by its UUID — what a deep link carries back. */
  function byUuid(uuid) {
    reconFiles();
    var hit = null;
    Object.keys(BY_ID).forEach(function (k) { if (!hit && BY_ID[k].uuid === uuid) hit = BY_ID[k]; });
    return hit;
  }

  /* =========================================================================
     RETRY
     The failed step re-runs. A transient failure clears and the rest of the
     pipeline follows; anything else fails identically, because nothing it
     depended on has changed. That outcome is the point — it is why the hint
     carries a link to the configuration rather than just a Retry button.
     ========================================================================= */
  var retrySeq = 0;
  function retryClock(file) {
    retrySeq++;
    return (9 * 3600 + retrySeq * 37) * 1000;
  }
  function retryable(file) {
    var s = failedStep(file);
    if (!s) return false;
    var res = FH.resolve(s.error_code, file);
    return res.retryable;
  }
  function startRetry(file) {
    var s = failedStep(file);
    if (!s) return false;
    file._retry = { name: s.name, code: s.error_code, detail: s.error_detail };
    s.status = 'running';
    s.started_at = ts(file.procDate, retryClock(file));
    s.finished_at = null;
    s.error_code = null; s.error_detail = null;
    // Everything the failure had stopped is waiting again, not skipped.
    markAfter(file, s.name, 'pending');
    file.status = statusOf(file.steps);
    return true;
  }
  function markAfter(file, name, status) {
    var seen = false;
    function walk(list) {
      list.forEach(function (s) {
        if (seen && (s.status === SKIPPED || s.status === 'pending')) {
          s.status = status;
          s.started_at = null; s.finished_at = null;
        }
        if (s.name === name) seen = true;
        if (s.children) walk(s.children);
      });
    }
    walk(file.steps);
  }
  function finishRetry(file) {
    var r = file._retry;
    if (!r) return null;
    file._retry = null;
    var s = null;
    (function walk(list) {
      list.forEach(function (x) { if (x.name === r.name) s = x; if (x.children) walk(x.children); });
    })(file.steps);
    if (!s) return null;
    var startMs = msOf(s.started_at) - U.fromYmd(file.procDate).getTime();
    var cleared = !!TRANSIENT[r.code];
    s.finished_at = ts(file.procDate, startMs + 2400);
    if (cleared) {
      s.status = 'success';
      // The rest of the pipeline runs on from here.
      var t = startMs + 2600;
      (function walk(list, after) {
        list.forEach(function (x) {
          if (x.status === 'pending') {
            x.status = 'success';
            x.started_at = ts(file.procDate, t);
            t += 2200;
            x.finished_at = ts(file.procDate, t);
            t += 120;
          }
          if (x.children) walk(x.children);
        });
      })(file.steps);
    } else {
      s.status = 'failed';
      s.error_code = r.code;
      s.error_detail = r.detail;
      markAfter(file, s.name, SKIPPED);
    }
    file.status = statusOf(file.steps);
    return cleared ? 'cleared' : 'recurred';
  }
  function retryDurationMs(file) { return 1400 + (seedOf(file.id) % 700); }

  /* =========================================================================
     LIST FILTERING — the Recon File Management screen
     ========================================================================= */
  function list(opts) {
    opts = opts || {};
    return reconFiles().filter(function (f) {
      if (opts.tenant && opts.tenant !== 'all' && f.tenantId !== opts.tenant) return false;
      if (opts.network && opts.network !== 'all' && f.networkKey !== opts.network) return false;
      if (opts.direction && opts.direction !== 'all' && f.direction !== opts.direction) return false;
      if (opts.status && opts.status !== 'all' && f.status !== opts.status) return false;
      if (opts.from && f.date < opts.from) return false;
      if (opts.to && f.date > opts.to) return false;
      if (opts.q && f.name.toLowerCase().indexOf(String(opts.q).toLowerCase()) < 0 &&
        f.uuid.indexOf(String(opts.q).toLowerCase()) < 0) return false;
      return true;
    });
  }
  function summarise(files) {
    var s = { total: files.length, failed: 0, running: 0, success: 0 };
    files.forEach(function (f) {
      if (f.status === 'Failed') s.failed++;
      else if (f.status === 'Running') s.running++;
      else s.success++;
    });
    return s;
  }

  return {
    TODAY: TODAY, CYCLE_TODAY: CYCLE_TODAY, WINDOW: WINDOW,
    cycleDates: cycleDates,
    DIR_LABEL: DIR_LABEL,
    reconFiles: reconFiles, list: list, summarise: summarise,
    byId: byId, byUuid: byUuid,
    forSettlementRow: forSettlementRow, forLeg: forLeg,
    failedStep: failedStep, statusOf: statusOf,
    clockOf: clockOf, dateOf: dateOf, durationMs: durationMs, durLabel: durLabel, stampOf: stampOf,
    retryable: retryable, startRetry: startRetry, finishRetry: finishRetry, retryDurationMs: retryDurationMs
  };
})();
