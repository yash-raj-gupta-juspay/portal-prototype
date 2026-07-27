/* =============================================================================
   Juspay Ops Portal — Cycle status / Cycle Snapshot mock data
   (Ops Home refinement: Cross-Tenant Cycle Status + Cycle Snapshot drill-in)

   Extends window.DATA / window.OPS. Deterministic, in-memory only.
   window.CYCLES is consumed by cycle-screen.js.

   ---------------------------------------------------------------------------
   THE CLOCK MODEL (read this before touching cutoffs)
   ---------------------------------------------------------------------------
   A cycle is one tenant × one network × one cycle date. The transaction cohort
   closes at the network's clearing cut-off the evening before; the cycle is then
   *processed* across the cycle date itself:

       cohort closes  →  clearing file out  →  incoming file in  →  settled
       (prev 22:00)      (~02:14)              (~04:07)             (by 22:00)

   So every leg cut-off in Part 5 is held here as a time-of-day (minutes from
   midnight) on that single processing clock, and both the grid and the snapshot
   timeline render against it. That is what lets one cell show "02:14 / 04:07 /
   by 22:00" together, and what lets the snapshot draw all three cut-offs on one
   horizontal axis.

   Times run on each tenant's own local clock (wall-clock parity: 06:35 IST for
   the Indian tenants is 06:35 SGT for HSBC SG). The grid labels everything IST
   per Part 7.3; the snapshot labels each tenant's own zone.
   ============================================================================= */
window.CYCLES = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS;

  /* ---- deterministic rng (same shape as ops-data.js) ---------------------- */
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

  var TODAY = D.TODAY;                 // 2025-11-21
  var NOW_MIN = 6 * 60 + 35;           // 06:35 — the ops user is at their desk (Part 8.1)

  /* ---- time helpers ------------------------------------------------------- */
  function hhmm(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function dur(mins) {
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return m + 'm';
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }

  /* ---- timezones (Part 7.3) ---------------------------------------------- */
  var TZ = {
    yesbank: { code: 'IST', offset: 'UTC+5:30' },
    'hsbc-in': { code: 'IST', offset: 'UTC+5:30' },
    'hsbc-sg': { code: 'SGT', offset: 'UTC+8' },
    'hsbc-hk': { code: 'HKT', offset: 'UTC+8' }
  };
  function tzOf(tenantId) { return TZ[tenantId] || TZ['hsbc-in']; }

  /* =========================================================================
     CUT-OFF MODEL (Part 5)
     Network defaults, then per-tenant negotiated overrides. Part 5 is explicit
     that cut-offs are per network × per tenant and that some tenants have
     negotiated windows — HSBC SG is the one that has.
     ========================================================================= */
  var NET_CUTOFFS = {
    visa: { clearing: 22 * 60, incoming: 6 * 60, settled: 22 * 60 },
    mc: { clearing: 21 * 60 + 30, incoming: 5 * 60 + 30, settled: 21 * 60 + 30 },
    rupay: { clearing: 22 * 60 + 30, incoming: 7 * 60, settled: 22 * 60 + 30 },
    onus: { clearing: 20 * 60, incoming: 22 * 60, settled: 20 * 60 }
  };

  /* HSBC SG runs one consolidated 06:00 SGT incoming window so every network
     feeds a single MAS settlement run; Mastercard alone is negotiated later
     (07:30) because GCMS delivers to the SG endpoint after the APAC batch. */
  var TENANT_CUTOFFS = {
    'hsbc-sg': {
      rupay: { incoming: 6 * 60 },
      onus: { incoming: 6 * 60 },
      mc: { incoming: 7 * 60 + 30 }
    }
  };

  function cutoffsFor(tenantId, netKey) {
    var base = NET_CUTOFFS[netKey] || NET_CUTOFFS.visa;
    var ov = (TENANT_CUTOFFS[tenantId] || {})[netKey] || {};
    return {
      clearing: ov.clearing != null ? ov.clearing : base.clearing,
      incoming: ov.incoming != null ? ov.incoming : base.incoming,
      settled: ov.settled != null ? ov.settled : base.settled,
      negotiated: {
        clearing: ov.clearing != null, incoming: ov.incoming != null, settled: ov.settled != null
      },
      platform: { clearing: base.clearing, incoming: base.incoming, settled: base.settled }
    };
  }

  /* =========================================================================
     LEG VOCABULARY (Part 2.1)
     ========================================================================= */
  var LEG_DEFS = [
    { key: 'clearing', short: 'CLR', label: 'Clearing', sub: 'outgoing to network' },
    { key: 'incoming', short: 'INC', label: 'Incoming', sub: 'response from network' },
    { key: 'settled', short: 'STL', label: 'Settled', sub: 'funds to acquirer nostro' }
  ];
  var STATE_META = {
    complete: { label: 'Complete', icon: 'check', kind: 'success' },
    inprogress: { label: 'In Progress', icon: 'loader', kind: 'info' },
    pending: { label: 'Pending', icon: 'clock', kind: 'neutral' },
    delayed: { label: 'Delayed', icon: 'alert-triangle', kind: 'warning' },
    failed: { label: 'Failed', icon: 'x-circle', kind: 'danger' }
  };

  /* =========================================================================
     AUTHORED CYCLE PLANS
     `at` = actual completion, `started` = in-flight start, `failed` = hard fail.
     All values are minutes from midnight on the processing clock.
     ========================================================================= */

  /* Today (Part 8.1) — ops user at ~06:35. */
  function P(clr, inc, stl) { return { clearing: clr, incoming: inc, settled: stl }; }
  var TODAY_PLAN = {
    yesbank: {
      visa: P({ at: 134 }, { at: 247 }, {}),                       // 02:14 · 04:07 · by 22:00
      mc: P({ at: 118 }, { at: 232 }, {}),                         // 01:58 · 03:52 · by 21:30
      rupay: P({ at: 152 }, { started: 314 }, {}),                 // 02:32 · running since 05:14
      onus: P({ at: 105 }, { at: 200 }, {})                        // 01:45 · 03:20 · by 20:00
    },
    'hsbc-in': {
      visa: P({ at: 124 }, { at: 238 }, {}),                       // 02:04 · 03:58
      mc: P({ at: 131 }, { at: 252 }, {}),                         // 02:11 · 04:12
      rupay: P({ at: 146 }, { at: 275 }, {}),                      // 02:26 · 04:35
      onus: P({ at: 112 }, { at: 214 }, {})                        // 01:52 · 03:34
    },
    'hsbc-sg': {
      // The delayed row. Incoming has not landed against the 06:00 SGT window.
      visa: P({ at: 129 }, {}, {}),                                // 02:09 · INC delayed +35m
      mc: P({ at: 138 }, {}, {}),                                  // 02:18 · INC pending (negotiated 07:30)
      rupay: P({ at: 161 }, {}, {}),                               // 02:41 · INC delayed +35m
      onus: P({ at: 118 }, {}, {})                                 // 01:58 · INC delayed +35m
    },
    'hsbc-hk': {
      visa: P({ at: 132 }, { at: 242 }, {}),                       // 02:12 · 04:02
      mc: P({ at: 142 }, { at: 264 }, {}),                         // 02:22 · 04:24
      rupay: P({ at: 155 }, { at: 288 }, {}),                      // 02:35 · 04:48
      onus: P({ at: 118 }, { at: 221 }, {})                        // 01:58 · 03:41
    }
  };

  /* Prior-cycle exceptions — this is where the Failed state is demonstrable.
     Reachable from any cell's snapshot via "Previous cycle". */
  var YDAY = U.addDays(TODAY, -1);        // 2025-11-20
  var DAY2 = U.addDays(TODAY, -2);        // 2025-11-19
  var AUTHORED = {};
  AUTHORED['hsbc-sg|visa|' + YDAY] = {
    clearing: { at: 126 },
    incoming: { at: 341 },
    settled: {
      failed: true, at: null,
      note: 'Settlement instruction returned by the correspondent bank — IBAN on the nostro leg did not match the standing instruction. Funds not received; re-instruction raised with treasury.'
    },
    recon: { status: 'Break under investigation', residualPctOfNet: 1 }
  };
  AUTHORED['yesbank|mc|' + DAY2] = {
    clearing: {
      failed: true, at: 1330,
      note: 'Outgoing IPM rejected by GCMS at 22:10 — Message Reason Code 4808 on 214 records (missing IRD on interchange rate designator). File re-cut and re-submitted on the next window.'
    },
    incoming: { failed: true, at: null, note: 'No T140 raw file — the network never accepted the clearing batch, so no response was generated.' },
    settled: { failed: true, at: null, note: 'No settlement raised for this cycle. The cohort rolled into the 20 Nov cycle after the file was re-cut.' },
    recon: { status: 'Break under investigation', residualPctOfNet: 100 }
  };

  /* Cycle dates that the snapshot can navigate across (prev / next). */
  var cycleDates = [];
  for (var dd = -6; dd <= 1; dd++) cycleDates.push(U.addDays(TODAY, dd));

  /* ---- plan resolution ---------------------------------------------------- */
  function planFor(tenantId, netKey, date) {
    var authored = AUTHORED[tenantId + '|' + netKey + '|' + date];
    if (authored) return authored;
    if (date === TODAY) return (TODAY_PLAN[tenantId] || TODAY_PLAN['hsbc-in'])[netKey];
    if (date > TODAY) return null;                      // future cycle — not started
    // Any other prior cycle: closed clean, deterministic times inside every window.
    var r = rng(seedOf('plan|' + tenantId + '|' + netKey + '|' + date));
    var c = cutoffsFor(tenantId, netKey);
    return {
      clearing: { at: 95 + rint(r, 0, 68) },
      incoming: { at: Math.min(c.incoming - 20 - rint(r, 0, 55), 178 + rint(r, 0, 108)) },
      settled: { at: c.settled - 18 - rint(r, 0, 84) }
    };
  }

  function holidayFor(tenantId, date) {
    var t = O.tenantById[tenantId];
    if (!t) return null;
    return O.holidays.find(function (h) { return h.date === date && h.country === t.country; }) || null;
  }

  /* ---- leg construction --------------------------------------------------- */
  function buildLeg(def, p, cut, now) {
    p = p || {};
    var leg = {
      key: def.key, short: def.short, label: def.label, sub: def.sub,
      cutoff: cut, cutoffLabel: hhmm(cut),
      actual: null, started: null, state: 'pending', deltaMin: 0, note: p.note || null
    };
    if (p.failed) {
      leg.state = 'failed';
      leg.actual = (p.at != null) ? p.at : null;
      leg.deltaMin = ((p.at != null) ? p.at : now) - cut;
    } else if (p.at != null) {
      leg.actual = p.at;
      leg.state = (p.at <= cut) ? 'complete' : 'delayed';
      leg.deltaMin = p.at - cut;
    } else if (p.started != null) {
      leg.started = p.started;
      leg.state = (now > cut) ? 'delayed' : 'inprogress';
      leg.deltaMin = now - cut;
    } else {
      leg.state = (now > cut) ? 'delayed' : 'pending';
      leg.deltaMin = now - cut;
    }
    leg.meta = STATE_META[leg.state];
    // What the cell prints under the icon (Part 3.1)
    if (leg.state === 'complete') leg.cellTime = hhmm(leg.actual);
    else if (leg.state === 'inprogress') leg.cellTime = hhmm(leg.started);
    else if (leg.state === 'pending') leg.cellTime = 'by ' + hhmm(cut);
    else leg.cellTime = hhmm(cut);                        // delayed / failed → cutoff, in state colour
    leg.overrunMin = leg.deltaMin > 0 ? leg.deltaMin : 0;
    return leg;
  }

  /* legsFor → the whole cell / snapshot leg set for one tenant × network × date */
  function legsFor(tenantId, netKey, date) {
    var c = cutoffsFor(tenantId, netKey);
    var plan = planFor(tenantId, netKey, date);
    var hol = holidayFor(tenantId, date);
    var out = {
      tenantId: tenantId, networkKey: netKey, date: date,
      cutoffs: c, holiday: hol, future: date > TODAY, notStarted: !plan,
      legs: [], byKey: {}, overall: 'pending'
    };
    if (!plan || (hol && hol.impact === 'Full holiday')) {
      out.overall = hol ? 'holiday' : 'notstarted';
      return out;
    }
    LEG_DEFS.forEach(function (def) {
      var leg = buildLeg(def, plan[def.key], c[def.key], NOW_MIN);
      out.legs.push(leg); out.byKey[def.key] = leg;
    });
    var states = out.legs.map(function (l) { return l.state; });
    if (states.indexOf('failed') >= 0) out.overall = 'failed';
    else if (states.indexOf('delayed') >= 0) out.overall = 'delayed';
    else if (states.every(function (s) { return s === 'complete'; })) out.overall = 'complete';
    else if (states.indexOf('inprogress') >= 0) out.overall = 'inprogress';
    else out.overall = 'pending';
    out.recon = plan.recon || null;
    return out;
  }

  /* =========================================================================
     SNAPSHOT DETAIL (Part 4.3 / 4.4 / 4.5 / 4.6)
     ========================================================================= */
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function amountsFor(tenantId, netKey, date) {
    var t = O.tenantById[tenantId], net = D.NET_BY_KEY[netKey];
    var r = rng(seedOf('amt|' + tenantId + '|' + netKey + '|' + date));
    var scale = 0.55 + net.share * 1.85;                 // Visa heaviest, ONUS lightest
    var gross, count;
    if (t.currency === 'INR') {
      gross = clampNum(Math.round((7 + r() * 22) * scale * 100000) * 100, 50000000, 400000000);
    } else {
      gross = clampNum(Math.round((0.7 + r() * 2.0) * scale * 10000) * 100, 500000, 3000000);
    }
    count = clampNum(Math.round((16000 + r() * 58000) * (0.62 + net.share)), 15000, 80000);
    return { gross: gross, count: count, batches: rint(r, 3, 9), currency: t.currency, r: r };
  }

  function rejectionsFor(tenantId, netKey, date, count, ticketBase) {
    var r = rng(seedOf('rej|' + tenantId + '|' + netKey + '|' + date));
    var t = O.tenantById[tenantId];
    var n = rint(r, 5, 25);
    var rows = [];
    for (var i = 0; i < n; i++) {
      var code = D.REJECT_CODES[rint(r, 0, D.REJECT_CODES.length - 1)];
      var amt = round2(t.currency === 'INR' ? 1400 + r() * 38000 : 55 + r() * 1450);
      rows.push({
        arn: '74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999),
        amount: amt, reasonCode: code[0], reasonDesc: code[1],
        expectedSettlement: U.addDays(date, 2)
      });
    }
    var total = round2(rows.reduce(function (s, x) { return s + x.amount; }, 0));
    return { count: n, amount: total, rows: rows };
  }

  var CLR_EXT = { visa: 'ctf', mc: 'ipm', rupay: 'npci', onus: 'csv' };
  var INC_NAME = {
    visa: 'VSS_TC46', mc: 'GCMS_T140', rupay: 'NPCI_RAW', onus: 'ONUS_RESP'
  };
  var INC_EXT = { visa: 'dat', mc: 'ipm', rupay: 'txt', onus: 'csv' };
  var SET_FILES = [
    { type: 'MPR', ext: 'csv', desc: 'Merchant Payout Report' },
    { type: 'MPF', ext: 'txt', desc: 'Merchant Payout File' },
    { type: 'JV1', ext: 'xml', desc: 'Journal Voucher — settlement' },
    { type: 'JV2', ext: 'xml', desc: 'Journal Voucher — fees' }
  ];
  function tenantSlug(tenantId) { return (O.tenantById[tenantId] || { name: tenantId }).name.replace(/\s/g, ''); }
  function checksum(r) {
    var s = ''; for (var i = 0; i < 8; i++) s += '0123456789abcdef'[rint(r, 0, 15)];
    return 'sha256:' + s + '…';
  }

  function snapshot(tenantId, netKey, date) {
    var t = O.tenantById[tenantId];
    var net = D.NET_BY_KEY[netKey];
    if (!t || !net) return null;

    var base = legsFor(tenantId, netKey, date);
    var tz = tzOf(tenantId);
    var snap = {
      tenant: t, network: net, date: date,
      dow: U.DOW[U.fromYmd(date).getUTCDay()],
      tz: tz, currency: t.currency,
      cutoffs: base.cutoffs, holiday: base.holiday,
      future: base.future, notStarted: base.notStarted,
      legs: base.legs, byKey: base.byKey, overall: base.overall,
      nowLabel: hhmm(NOW_MIN) + ' ' + tz.code
    };
    if (!base.legs.length) return snap;                  // holiday / future — nothing more to compute

    var a = amountsFor(tenantId, netKey, date);
    var r = a.r;
    var clr = base.byKey.clearing, inc = base.byKey.incoming, stl = base.byKey.settled;

    /* ---- Clearing (Part 4.3) --------------------------------------------- */
    var cohortEnd = hhmm(base.cutoffs.clearing);
    var heldBack = (rint(r, 0, 5) === 0)
      ? { count: 1, amount: round2(a.gross * 0.004), reason: 'One batch held back — MCC 6012 records missing the mandated payment-facilitator identifier.' }
      : null;
    var grossCleared = round2(a.gross - (heldBack ? heldBack.amount : 0));
    snap.clearing = {
      leg: clr,
      cohortFrom: U.prettyDate(U.addDays(date, -2)) + ' ' + hhmm(base.cutoffs.clearing + 1),
      cohortTo: U.prettyDate(U.addDays(date, -1)) + ' ' + cohortEnd,
      submittedAt: clr.actual != null ? (U.prettyDate(date) + ', ' + hhmm(clr.actual) + ' ' + tz.code) : null,
      gross: grossCleared, count: a.count, batches: a.batches, heldBack: heldBack,
      file: {
        name: tenantSlug(tenantId) + '_' + net.short.toUpperCase() + '_CLEARING_' + date.replace(/-/g, '') + '.' + CLR_EXT[netKey],
        size: (0.8 + r() * 7).toFixed(1) + ' MB', checksum: checksum(r),
        dest: '/out/' + tenantId + '/clearing/'
      }
    };

    /* ---- Incoming (Part 4.4) --------------------------------------------- */
    var rej = rejectionsFor(tenantId, netKey, date, a.count);
    if (inc.state === 'failed') { rej = { count: 0, amount: 0, rows: [] }; }
    var interchange = round2(grossCleared * net.ic);
    var scheme = round2(grossCleared * net.scheme);
    var otherAdj = round2(grossCleared * (netKey === 'visa' ? 0.0002 : 0.0001));
    var incomingReceived = (inc.state === 'complete' || inc.state === 'delayed') && inc.actual != null;
    snap.incoming = {
      leg: inc,
      receivedAt: incomingReceived ? (U.prettyDate(date) + ', ' + hhmm(inc.actual) + ' ' + tz.code) : null,
      gross: round2(grossCleared - rej.amount), count: a.count - rej.count,
      rejections: rej,
      fees: { interchange: interchange, scheme: scheme, other: otherAdj, total: round2(interchange + scheme + otherAdj) },
      file: incomingReceived ? {
        name: INC_NAME[netKey] + '_' + tenantSlug(tenantId) + '_' + date.replace(/-/g, '') + '.' + INC_EXT[netKey],
        size: (0.4 + r() * 4).toFixed(1) + ' MB', checksum: checksum(r)
      } : null
    };

    /* ---- Settlement (Part 4.5) ------------------------------------------- */
    var netExpected = round2(grossCleared - snap.incoming.fees.total - rej.amount);
    var reconPlan = base.recon || null;
    var residual = reconPlan ? round2(netExpected * (reconPlan.residualPctOfNet / 100)) : 0;
    var settledActual = (stl.state === 'complete' || stl.state === 'delayed') && stl.actual != null
      ? round2(netExpected - residual) : null;
    var mdr = round2(grossCleared * net.mdr);
    var setR = rng(seedOf('files|' + tenantId + '|' + netKey + '|' + date));
    snap.settled = {
      leg: stl,
      settledAt: settledActual != null ? (U.prettyDate(date) + ', ' + hhmm(stl.actual) + ' ' + tz.code) : null,
      grossCleared: grossCleared,
      fees: snap.incoming.fees.total,
      rejectionsDeducted: rej.amount,
      netExpected: netExpected,
      actual: settledActual,
      delta: settledActual != null ? round2(settledActual - netExpected) : null,
      mdr: mdr,
      files: SET_FILES.map(function (f, i) {
        var genMin = (stl.actual != null ? stl.actual : base.cutoffs.settled) + 8 + i * 11;
        return {
          type: f.type, desc: f.desc,
          name: tenantSlug(tenantId) + '_' + f.type + '_' + date.replace(/-/g, '') + '.' + f.ext,
          size: (0.3 + setR() * 5).toFixed(1) + ' MB',
          generatedAt: settledActual != null ? (U.prettyDate(date) + ', ' + hhmm(genMin) + ' ' + tz.code) : null
        };
      })
    };

    /* ---- Reconciliation callout (Part 4.6) ------------------------------- */
    var reconCycle = O.cyclesByTenant[tenantId] ? O.cyclesByTenant[tenantId].find(function (c) { return c.date === date; }) : null;
    if (date === TODAY) {
      snap.recon = { status: 'Not yet run', kind: 'neutral', residual: 0, note: 'Two-way reconciliation runs once the settlement leg closes for this cycle.', cycleId: null };
    } else if (reconPlan) {
      snap.recon = { status: reconPlan.status, kind: 'danger', residual: residual, note: 'Residual beyond the expected delta. Investigation open with the settlement desk.', cycleId: reconCycle ? reconCycle.id : null };
    } else {
      snap.recon = { status: 'Clean', kind: 'success', residual: 0, note: 'Submitted position less the expected delta matches the settled position. No residual.', cycleId: reconCycle ? reconCycle.id : null };
    }

    /* ---- Overall status pill + one-line summary (Part 4.1) --------------- */
    snap.status = overallStatus(snap);
    return snap;
  }

  function overallStatus(snap) {
    var legs = snap.legs;
    var late = legs.filter(function (l) { return l.state === 'delayed'; });
    var bad = legs.filter(function (l) { return l.state === 'failed'; });
    if (bad.length) {
      return {
        text: 'Failed', kind: 'danger', icon: 'x-circle',
        line: (bad.length > 1
          ? bad.map(function (l) { return l.label; }).join(', ') + ' legs failed'
          : bad[0].label + ' leg failed') + ' — intervention required.'
      };
    }
    if (late.length) {
      return {
        text: 'Delayed', kind: 'warning', icon: 'alert-triangle',
        line: late.map(function (l) { return l.label + ' ' + dur(l.overrunMin) + ' past its ' + l.cutoffLabel + ' cut-off'; }).join(' · ') + '.'
      };
    }
    if (legs.every(function (l) { return l.state === 'complete'; })) {
      return { text: 'Clean', kind: 'success', icon: 'check-circle', line: 'All three legs complete by expected cut-offs.' };
    }
    var running = legs.filter(function (l) { return l.state === 'inprogress'; });
    if (running.length) {
      return { text: 'In Progress', kind: 'info', icon: 'loader', line: running[0].label + ' is processing — started ' + hhmm(running[0].started) + ', due by ' + running[0].cutoffLabel + '.' };
    }
    var next = legs.filter(function (l) { return l.state === 'pending'; })[0];
    return { text: 'In Progress', kind: 'info', icon: 'clock', line: next ? (next.label + ' pending — expected by ' + next.cutoffLabel + ', ' + dur(next.cutoff - NOW_MIN) + ' to go.') : 'Cycle in flight.' };
  }

  /* ---- one-line cell tooltip (Part 3.1) ---------------------------------- */
  function cellSummary(tenantId, netKey, date) {
    var t = O.tenantById[tenantId], net = D.NET_BY_KEY[netKey];
    var c = legsFor(tenantId, netKey, date);
    if (c.holiday) return t.name + ' · ' + net.name + ' · bank holiday (' + c.holiday.name + ') — no files expected';
    if (!c.legs.length) return t.name + ' · ' + net.name + ' · cycle has not started';
    return t.name + ' · ' + net.name + ' · ' + c.legs.map(function (l) {
      if (l.state === 'complete') return l.short + ' complete ' + hhmm(l.actual);
      if (l.state === 'inprogress') return l.short + ' in progress since ' + hhmm(l.started);
      if (l.state === 'pending') return l.short + ' pending by ' + l.cutoffLabel;
      if (l.state === 'delayed') return l.short + ' delayed ' + dur(l.overrunMin) + ' past ' + l.cutoffLabel;
      return l.short + ' failed (cut-off ' + l.cutoffLabel + ')';
    }).join(' · ');
  }

  return {
    TODAY: TODAY, NOW_MIN: NOW_MIN, cycleDates: cycleDates,
    LEG_DEFS: LEG_DEFS, STATE_META: STATE_META,
    hhmm: hhmm, dur: dur, tzOf: tzOf,
    cutoffsFor: cutoffsFor, legsFor: legsFor, snapshot: snapshot,
    cellSummary: cellSummary, holidayFor: holidayFor,
    // exposed so the screen can point users at the demonstrable failed cycles
    failedDemos: [
      { tenantId: 'hsbc-sg', networkKey: 'visa', date: YDAY, what: 'settlement returned' },
      { tenantId: 'yesbank', networkKey: 'mc', date: DAY2, what: 'clearing rejected by GCMS' }
    ]
  };
})();
