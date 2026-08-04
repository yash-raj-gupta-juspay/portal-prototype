/* =============================================================================
   Juspay Ops Portal — Acquirer Reports data (refinement round 2 §C)

   THE ROW KEY IS tenant × cycle date × file type. There is no network here.
   Settlement files are acquirer artifacts: HSBC IN produces one MPR for the
   cycle, not one MPR per network. Anything that reintroduces a network
   dimension on this screen is wrong.

   Two orthogonal statuses per row (§C.3):
     delivery   — Pending | Shared | Failed      (does the acquirer have it?)
     validation — Validated | Mismatch | Not run | Running
                                                 (does it match the source DB?)
   They never collapse into one field: "Shared + Mismatch" is the single most
   operationally interesting state and merging would hide it.

   Rows are built once per date and cached, because the five row actions mutate
   them (mark as shared, upload, run validation) and those mutations must stick
   for the session. In memory only — no storage.
   ============================================================================= */
window.SFILES = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS;

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

  var TODAY = D.TODAY;                       // 2025-11-21

  /* =========================================================================
     §C.2 — PER-ACQUIRER FILE TYPE REGISTRY
     The one place that knows which files an acquirer produces. Every filter,
     every count and every generated row reads from here; nothing hardcodes
     "MPR / MPF / JV1 / JV2" anywhere else.
     ========================================================================= */
  var FILE_TYPES_BY_TENANT = {
    'yesbank': ['GEFU1', 'GEFU2'],
    'hsbc-in': ['MPR', 'MPF', 'JV1', 'JV2'],
    'hsbc-sg': ['MPR', 'MPF', 'JV1', 'JV2'],
    'hsbc-hk': ['MPR', 'MPF', 'JV1', 'JV2']
  };
  function typesFor(tenantId) { return FILE_TYPES_BY_TENANT[tenantId] || []; }
  /* Union of the types the given tenants produce, registry order preserved. */
  function typesForFilter(tenantId) {
    if (tenantId && tenantId !== 'all') return typesFor(tenantId).slice();
    var seen = {}, out = [];
    O.tenants.forEach(function (t) {
      typesFor(t.id).forEach(function (ft) { if (!seen[ft]) { seen[ft] = 1; out.push(ft); } });
    });
    return out;
  }

  var TYPE_META = {
    MPR: { ext: 'csv', desc: 'Merchant Payout Report' },
    MPF: { ext: 'txt', desc: 'Merchant Payout File' },
    JV1: { ext: 'xml', desc: 'Journal Voucher — settlement' },
    JV2: { ext: 'xml', desc: 'Journal Voucher — next-cycle adjustments' },
    GEFU1: { ext: 'dat', desc: 'GEFU payout extract — settlement' },
    GEFU2: { ext: 'dat', desc: 'GEFU payout extract — adjustments' }
  };
  function typeMeta(ft) { return TYPE_META[ft] || { ext: 'dat', desc: 'Settlement file' }; }

  /* Generation slot per file type — the generator runs them in sequence in the
     early hours of the cycle date, which is why JV2 always lands last. */
  var SLOT = { MPR: 0, GEFU1: 0, MPF: 1, GEFU2: 1, JV1: 2, JV2: 3 };

  /* =========================================================================
     PART 6.2 — THE DELIVERY CUTOFF
     Each report has a contractual time by which the acquirer must have it,
     held as minutes from midnight on the cycle date. The margin — cutoff minus
     the delivery time — is the one number on this screen that predicts a
     future breach, and it is the only thing the chart plots.
     ========================================================================= */
  var CUTOFF_MIN = { MPR: 6 * 60, GEFU1: 6 * 60, MPF: 7 * 60, GEFU2: 7 * 60, JV1: 8 * 60, JV2: 9 * 60 };
  function cutoffOf(type) { return CUTOFF_MIN[type] == null ? 6 * 60 : CUTOFF_MIN[type]; }

  /* Authored drift (Part 9.3). HSBC IN's MPF has been delivered later every
     week for a month and has already crossed the cutoff twice. Nothing else on
     this screen shows that — a single late delivery looks identical to a
     delivery that is late every cycle. The share time is derived FROM the
     margin, so the chart and the "Shared at" column can never disagree. */
  var DRIFT = {
    'hsbc-in|MPF': function (dayIdx) {
      if (dayIdx === 4) return -12;     // cutoff missed
      if (dayIdx === 11) return -25;    // cutoff missed
      return Math.round(120 - (29 - dayIdx) * 3.6);
    }
  };

  /* ---- status vocabularies (§C.3) ---------------------------------------- */
  var DELIVERY = {
    Pending: { label: 'Pending', kind: 'neutral', icon: 'clock' },
    Shared: { label: 'Shared with acquirer', kind: 'success', icon: 'check-circle' },
    Failed: { label: 'Failed', kind: 'danger', icon: 'x-circle' }
  };
  var VALIDATION = {
    'Validated': { label: 'Validated', kind: 'success', icon: 'shield-check' },
    'Mismatch': { label: 'Mismatch', kind: 'danger', icon: 'alert-octagon' },
    'Not run': { label: 'Not run', kind: 'neutral', icon: 'circle-dashed' },
    'Running': { label: 'Running', kind: 'info', icon: 'loader' }
  };
  var DELIVERY_KEYS = ['Pending', 'Shared', 'Failed'];
  var VALIDATION_KEYS = ['Validated', 'Mismatch', 'Not run', 'Running'];

  /* =========================================================================
     §C.9 — AUTHORED STATE FOR THE CURRENT DATE
     The distribution is authored rather than random so the workflow is
     demonstrable: most rows clean, one ready-to-share, one delivered-but-wrong,
     one hard delivery failure, one asserted by a human rather than the system.
     ========================================================================= */
  var TODAY_STATES = {
    'yesbank|GEFU1': { delivery: 'Shared', validation: 'Validated' },
    'yesbank|GEFU2': { delivery: 'Shared', validation: 'Validated', manual: true },
    'hsbc-in|MPR': { delivery: 'Shared', validation: 'Validated' },
    'hsbc-in|MPF': { delivery: 'Shared', validation: 'Mismatch' },
    'hsbc-in|JV1': { delivery: 'Shared', validation: 'Validated' },
    // Generation stopped at the fee rules, so no file exists to validate —
    // "Pending + Validated" would have claimed a validation of nothing.
    'hsbc-in|JV2': { delivery: 'Pending', validation: 'Not run' },
    'hsbc-sg|MPR': { delivery: 'Shared', validation: 'Validated' },
    'hsbc-sg|MPF': { delivery: 'Shared', validation: 'Validated' },
    'hsbc-sg|JV1': { delivery: 'Failed', validation: 'Not run' },
    'hsbc-sg|JV2': { delivery: 'Shared', validation: 'Validated' },
    // The file is written and the transfer is still running at the observer's
    // 09:00 — the in-progress case the file detail panel has to render.
    'hsbc-hk|JV2': { delivery: 'Pending', validation: 'Not run' }
    // HSBC HK MPR / MPF / JV1 — Shared + Validated (falls through to the default)
  };

  /* Prior dates: clean by default, with a handful of authored exceptions so
     stepping back through the date filter shows the full state vocabulary. */
  var PAST_STATES = {
    '3|hsbc-in|MPF': { delivery: 'Shared', validation: 'Mismatch' },
    // The schedule excluded the day, so nothing was due and nothing was made.
    '4|hsbc-hk|JV2': { delivery: 'Pending', validation: 'Not run' },
    '5|yesbank|GEFU1': { delivery: 'Failed', validation: 'Not run' },
    '6|hsbc-sg|MPR': { delivery: 'Shared', validation: 'Validated', manual: true },
    '9|hsbc-in|JV2': { delivery: 'Failed', validation: 'Validated' },
    '12|hsbc-sg|MPF': { delivery: 'Shared', validation: 'Mismatch' }
  };

  var FAIL_REASONS = [
    'SFTP handshake to the acquirer endpoint timed out after 3 attempts — host key rotated on their side.',
    'Acquirer endpoint rejected the transfer — destination directory quota exceeded.',
    'Transfer aborted mid-stream; the acquirer holds a partial file and it must not be treated as delivered.'
  ];

  function tenantSlug(tenantId) { return (O.tenantById[tenantId] || { name: tenantId }).name.replace(/\s/g, ''); }
  function fileName(tenantId, type, date) {
    return type + '_' + tenantSlug(tenantId) + '_' + date.replace(/-/g, '') + '.' + typeMeta(type).ext;
  }
  function stamp(date, h, m) { return U.prettyDate(date) + ', ' + pad2(h) + ':' + pad2(m) + ' IST'; }

  /* ---- holidays ----------------------------------------------------------- */
  function holidayFor(tenantId, date) {
    var t = O.tenantById[tenantId];
    if (!t) return null;
    return O.holidays.find(function (h) { return h.date === date && h.country === t.country; }) || null;
  }

  /* =========================================================================
     VALIDATION REPORT (§C.4)
     File-side vs source-side counts and sums. A validated file reconciles
     exactly; a mismatch carries the specific records that differ so the
     analyst knows what to correct before re-uploading.
     ========================================================================= */
  function buildReport(row, outcome, ranAt) {
    var r = rng(seedOf('rep|' + row.id));
    var t = O.tenantById[row.tenantId];
    var srcCount = rint(r, 18000, 74000);
    var unit = t.currency === 'INR' ? rint(r, 900, 2600) : rint(r, 30, 95);
    var srcSum = round2(srcCount * unit + rint(r, 0, 99) / 100);
    if (outcome === 'Validated') {
      return {
        outcome: 'Validated', ranAt: ranAt, currency: t.currency,
        fileRecords: srcCount, sourceRecords: srcCount,
        fileSum: srcSum, sourceSum: srcSum, rows: []
      };
    }
    /* Two value discrepancies plus one record the file never carried. */
    var rows = [];
    var d1 = round2(rint(r, 120, 900) + r());
    var d2 = round2(rint(r, 40, 460) + r());
    var v1 = round2(unit * 4 + rint(r, 100, 900));
    var v2 = round2(unit * 2 + rint(r, 100, 900));
    var missing = round2(unit * 3 + rint(r, 50, 700));
    rows.push({ id: 'ARN 74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999), field: 'Settlement amount', fileValue: v1, sourceValue: round2(v1 + d1), delta: d1 });
    rows.push({ id: 'ARN 74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999), field: 'Settlement amount', fileValue: v2, sourceValue: round2(v2 + d2), delta: d2 });
    rows.push({ id: 'ARN 74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999), field: 'Record present', fileValue: null, sourceValue: missing, delta: missing });
    var totalDelta = round2(d1 + d2 + missing);
    return {
      outcome: 'Mismatch', ranAt: ranAt, currency: t.currency,
      fileRecords: srcCount - 1, sourceRecords: srcCount,
      fileSum: round2(srcSum - totalDelta), sourceSum: srcSum,
      rows: rows
    };
  }

  /* =========================================================================
     ROW CONSTRUCTION
     ========================================================================= */
  function buildRow(tenantId, type, date, dayIdx) {
    var r = rng(seedOf('sf|' + tenantId + '|' + type + '|' + date));
    var key = tenantId + '|' + type;
    var authored = dayIdx === 0
      ? TODAY_STATES[key]
      : PAST_STATES[dayIdx + '|' + key];
    var st = authored || { delivery: 'Shared', validation: 'Validated' };

    var slot = SLOT[type] == null ? 0 : SLOT[type];
    var genH = 2 + Math.floor(slot / 2), genM = rint(r, 4, 52) + (slot % 2) * 30;
    if (genM > 59) { genH += 1; genM -= 60; }

    /* Delivery time is derived from the margin against the cutoff, not the
       other way round, so the chart and this row always tell one story. */
    var cutoff = cutoffOf(type);
    var drift = DRIFT[key];
    var margin = drift
      ? drift(dayIdx)
      : cutoff - (genH * 60 + genM + rint(r, 18, 46));
    var shareAbs = cutoff - margin;
    var shareH = Math.floor(shareAbs / 60), shareMin = shareAbs % 60;

    var generatedAt = stamp(date, genH, genM);
    var shared = st.delivery === 'Shared';
    var row = {
      id: tenantId + '|' + date + '|' + type,
      tenantId: tenantId, date: date, dow: U.DOW[U.fromYmd(date).getUTCDay()],
      type: type, typeDesc: typeMeta(type).desc,
      name: fileName(tenantId, type, date),
      delivery: st.delivery,
      validation: st.validation,
      generatedAt: generatedAt,
      sharedAt: shared ? stamp(date, shareH, shareMin) : null,
      // Minutes before the cutoff at delivery — negative means the cutoff was
      // missed. Null when the file was never delivered: "not delivered" is not
      // a timing of zero.
      cutoffMin: cutoff, deliveredMin: shared ? shareAbs : null,
      marginMin: shared ? margin : null,
      size: (0.4 + r() * 7.2).toFixed(1) + ' MB',
      checksum: 'sha256:' + Array.from({ length: 8 }, function () { return '0123456789abcdef'[rint(r, 0, 15)]; }).join('') + '…',
      dest: '/out/' + tenantId + '/' + type.toLowerCase() + '/',
      holiday: holidayFor(tenantId, date),
      failReason: st.delivery === 'Failed' ? FAIL_REASONS[seedOf(key) % FAIL_REASONS.length] : null,
      manual: null,
      corrected: false,
      report: null,
      events: []
    };

    row.events.push({ at: generatedAt, by: 'settlement-generator', kind: 'normal', text: 'File generated — ' + row.size + ' · ' + row.checksum });
    if (shared) row.events.push({ at: row.sharedAt, by: 'file-transfer', kind: 'normal', text: 'Delivered to the acquirer endpoint ' + row.dest });
    if (st.delivery === 'Failed') row.events.push({ at: stamp(date, shareH, shareMin), by: 'file-transfer', kind: 'nullified', text: 'Delivery attempt failed — ' + row.failReason });

    /* The manually-marked row (§C.9): the system never saw the delivery; a
       human asserted it. Green like any other shared row, but tagged. */
    if (st.manual) {
      row.manual = {
        by: 'juspay-ops', at: stamp(date, shareH + 1, Math.min(59, shareMin + 12)),
        note: 'Acquirer confirmed receipt over the ops bridge call — the transfer log never registered the ACK.'
      };
      row.sharedAt = row.manual.at;
      row.events.push({ at: row.manual.at, by: row.manual.by, kind: 'correction', text: 'Marked as shared with the acquirer manually.', note: row.manual.note });
    }

    if (st.validation === 'Validated' || st.validation === 'Mismatch') {
      var vH = shareH + 1, vM = rint(r, 5, 55);
      row.report = buildReport(row, st.validation, stamp(date, vH > 23 ? 23 : vH, vM));
      row.events.push({
        at: row.report.ranAt, by: 'validation-service', kind: st.validation === 'Mismatch' ? 'nullified' : 'normal',
        text: st.validation === 'Mismatch'
          ? 'Validation against the base DB source found ' + row.report.rows.length + ' discrepant records.'
          : 'Validation against the base DB source passed — counts and sums reconcile.'
      });
    }
    return row;
  }

  /* Rows are cached per date so row actions persist for the session. */
  var CACHE = {};
  function rowsForDate(date) {
    if (CACHE[date]) return CACHE[date];
    var dayIdx = Math.round((U.fromYmd(TODAY) - U.fromYmd(date)) / 86400000);
    var out = [];
    O.tenants.forEach(function (t) {
      var hol = holidayFor(t.id, date);
      // A full bank holiday produces no settlement files at all — the honest
      // representation is no rows, not rows in a fabricated status.
      if (hol && hol.impact === 'Full holiday') return;
      typesFor(t.id).forEach(function (ft) { out.push(buildRow(t.id, ft, date, dayIdx)); });
    });
    CACHE[date] = out;
    return out;
  }
  function rowsForRange(from, to) {
    var out = [];
    for (var d = from; d <= to; d = U.addDays(d, 1)) out = out.concat(rowsForDate(d));
    return out;
  }
  function rowById(id) {
    var date = id.split('|')[1];
    return rowsForDate(date).find(function (r) { return r.id === id; }) || null;
  }

  /* =========================================================================
     PART 6.2 — DELIVERY TIMING AGAINST CUTOFF, LAST 30 CYCLES
     One series per report type. A point is the margin in minutes; null where
     nothing was delivered that cycle, so the line breaks rather than dropping
     to a zero that never happened.

     With every tenant in scope the point is the TIGHTEST margin across the
     acquirers that produce that report — averaging would hide the breach,
     which is the one thing this chart exists to show.
     ========================================================================= */
  function deliveryTiming(tenantId, days) {
    var n = days || 30;
    var dates = [];
    for (var i = n - 1; i >= 0; i--) dates.push(U.addDays(TODAY, -i));
    var types = typesForFilter(tenantId);
    var series = types.map(function (ft) {
      var points = dates.map(function (d) {
        var rows = rowsForDate(d).filter(function (r) {
          return r.type === ft && (tenantId === 'all' || r.tenantId === tenantId) && r.marginMin != null;
        });
        if (!rows.length) return null;
        return rows.reduce(function (m, r) { return Math.min(m, r.marginMin); }, Infinity);
      });
      return { type: ft, cutoff: cutoffOf(ft), points: points };
    }).filter(function (s) { return s.points.some(function (p) { return p != null; }); });
    return { dates: dates, series: series };
  }
  /* Tenants with no rows on this date because their country is on holiday. */
  function holidayTenants(from, to) {
    var out = [];
    O.tenants.forEach(function (t) {
      for (var d = from; d <= to; d = U.addDays(d, 1)) {
        var h = holidayFor(t.id, d);
        if (h && h.impact === 'Full holiday' && typesFor(t.id).length) { out.push({ tenant: t, holiday: h, date: d }); break; }
      }
    });
    return out;
  }

  /* =========================================================================
     MUTATIONS — all appended as events, never overwrites (cross-cutting §3)
     ========================================================================= */
  var OPS_USER = 'juspay-ops';
  /* The ops user is standing at 09:00 IST on the processing day. Each recorded
     action advances a minute so an event log reads in order. */
  var actionSeq = 0;
  function nowStamp() { actionSeq++; return U.prettyDate(TODAY) + ', 09:' + pad2(Math.min(59, 9 + actionSeq)) + ' IST'; }

  function markShared(row, note) {
    row.delivery = 'Shared';
    row.manual = { by: OPS_USER, at: nowStamp(), note: note };
    row.sharedAt = row.manual.at;
    row.failReason = null;
    row.events.push({ at: row.manual.at, by: OPS_USER, kind: 'correction', text: 'Marked as shared with the acquirer manually.', note: note });
    return row;
  }

  function replaceFile(row, name) {
    var r = rng(seedOf('up|' + row.id + '|' + name));
    row.name = name;
    row.size = (0.4 + r() * 7.2).toFixed(1) + ' MB';
    row.checksum = 'sha256:' + Array.from({ length: 8 }, function () { return '0123456789abcdef'[rint(r, 0, 15)]; }).join('') + '…';
    row.generatedAt = nowStamp();
    row.validation = 'Not run';
    row.report = null;
    row.corrected = true;              // a corrected file validates clean on the next run
    row.events.push({ at: row.generatedAt, by: OPS_USER, kind: 'correction', text: 'Corrected file uploaded — ' + name + ' · ' + row.size + ' · ' + row.checksum + '. Validation reset to Not run.' });
    return row;
  }

  /* Deterministic per row: the same file always validates the same way, and a
     corrected upload is what changes the outcome — never chance. */
  function validationOutcome(row) {
    if (row.corrected) return 'Validated';
    var authored = TODAY_STATES[row.tenantId + '|' + row.type];
    var dayIdx = Math.round((U.fromYmd(TODAY) - U.fromYmd(row.date)) / 86400000);
    if (dayIdx > 0) authored = PAST_STATES[dayIdx + '|' + row.tenantId + '|' + row.type];
    return (authored && authored.validation === 'Mismatch') ? 'Mismatch' : 'Validated';
  }
  /* 2–3s, deterministic per row so a demo repeats identically. */
  function validationDurationMs(row) { return 2000 + (seedOf(row.id) % 1000); }

  function finishValidation(row) {
    var outcome = validationOutcome(row);
    var at = nowStamp();
    row.validation = outcome;
    row.report = buildReport(row, outcome, at);
    row.events.push({
      at: at, by: OPS_USER, kind: outcome === 'Mismatch' ? 'nullified' : 'normal',
      text: outcome === 'Mismatch'
        ? 'Validation re-run against the base DB source — ' + row.report.rows.length + ' discrepant records remain.'
        : 'Validation re-run against the base DB source — counts and sums reconcile.'
    });
    return outcome;
  }

  /* =========================================================================
     AGGREGATES — the cross-acquirer overview strip (§C.7)
     Always spans every acquirer regardless of the tenant filter below it.
     ========================================================================= */
  function summarise(rows) {
    var s = { expected: rows.length, shared: 0, pending: 0, failed: 0, mismatch: 0, notRun: 0, manual: 0 };
    rows.forEach(function (f) {
      if (f.delivery === 'Shared') s.shared++;
      else if (f.delivery === 'Pending') s.pending++;
      else if (f.delivery === 'Failed') s.failed++;
      if (f.validation === 'Mismatch') s.mismatch++;
      if (f.validation === 'Not run') s.notRun++;
      if (f.manual) s.manual++;
    });
    s.sharedPct = s.expected ? Math.round((s.shared / s.expected) * 100) : 0;
    return s;
  }
  function overview(from, to) {
    var all = rowsForRange(from, to);
    var per = O.tenants.map(function (t) {
      var rows = all.filter(function (f) { return f.tenantId === t.id; });
      return { tenant: t, rows: rows, summary: summarise(rows) };
    });
    return { from: from, to: to, all: all, summary: summarise(all), perTenant: per, holidayTenants: holidayTenants(from, to) };
  }

  /* Rows needing attention — the Ops Home "Acquirer Report Issues" queue. */
  function issues(days) {
    var to = TODAY, from = U.addDays(TODAY, -(days || 7) + 1);
    return rowsForRange(from, to).filter(function (f) {
      return f.delivery === 'Failed' || f.validation === 'Mismatch' || (f.delivery === 'Pending' && f.date < TODAY);
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  return {
    TODAY: TODAY,
    FILE_TYPES_BY_TENANT: FILE_TYPES_BY_TENANT, typesFor: typesFor, typesForFilter: typesForFilter,
    typeMeta: typeMeta,
    DELIVERY: DELIVERY, VALIDATION: VALIDATION, DELIVERY_KEYS: DELIVERY_KEYS, VALIDATION_KEYS: VALIDATION_KEYS,
    rowsForDate: rowsForDate, rowsForRange: rowsForRange, rowById: rowById,
    holidayTenants: holidayTenants, holidayFor: holidayFor,
    markShared: markShared, replaceFile: replaceFile,
    validationOutcome: validationOutcome, validationDurationMs: validationDurationMs, finishValidation: finishValidation,
    summarise: summarise, overview: overview, issues: issues,
    cutoffOf: cutoffOf, deliveryTiming: deliveryTiming,
    fileName: fileName, nowStamp: nowStamp
  };
})();
