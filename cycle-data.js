/* =============================================================================
   Juspay Ops Portal — Cycle status / Cycle Snapshot mock data
   (Ops Home refinement — four-leg cycle model)

   Extends window.DATA / window.OPS. Deterministic, in-memory only.
   window.CYCLES is consumed by cycle-screen.js.

   ---------------------------------------------------------------------------
   THE CLOCK MODEL (read this before touching any time in this file)
   ---------------------------------------------------------------------------
   A cycle is one tenant × one network × one *transaction* date T. Everything
   after that is processing, and it does not all happen on T — which is exactly
   what the old three-leg model hid. So every time in this file is held as
   **absolute minutes from midnight IST on the cycle date T**:

       0      = T   00:00 IST
       1440   = T+1 00:00 IST
       2880   = T+2 00:00 IST

   That single number is what lets a JV2 leg due at T+2 02:30 (= 3030) sit on
   the same axis as a clearing leg that fired at T 22:00 (= 1320), and it is why
   the snapshot timeline can draw day dividers without any date arithmetic.
   Render with hhmm() for the clock face and dayTag() for the T+n suffix.

   Two schedule profiles (Part 5). The asymmetry is real and deliberate:
   SGT/HKT is 2.5h ahead of IST, so the SG/HK cycle fires on the *same* IST
   calendar day as the transaction date, while the Indian cycle fires the next.

   All leg times are IST — processing runs out of India for every tenant. Only
   the transaction cohort window is stated in the tenant's own zone, because
   that is the one thing that genuinely happened on local time.
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

  /* =========================================================================
     WHERE THE OPS USER IS STANDING (Part 7.1)
     09:00 IST on 21 Nov 2025, looking at the cycle for transaction date
     20 Nov 2025. D.TODAY is the processing day; the cycle is the day before.
     ========================================================================= */
  var TODAY = D.TODAY;                       // 2025-11-21 — processing day
  var CYCLE_TODAY = U.addDays(TODAY, -1);    // 2025-11-20 — current cycle date
  var NOW_ABS = 1440 + 9 * 60;               // T+1 09:00 IST

  /* ---- time helpers ------------------------------------------------------- */
  function hhmm(abs) {
    var m = ((Math.round(abs) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function dayOf(abs) { return Math.floor(abs / 1440); }
  function dayTag(abs) { var d = dayOf(abs); return d === 0 ? 'T' : 'T+' + d; }
  function dateAt(cycleDate, abs) { return U.addDays(cycleDate, dayOf(abs)); }
  function stamp(cycleDate, abs) { return U.prettyDate(dateAt(cycleDate, abs)) + ', ' + hhmm(abs) + ' IST'; }
  function shortStamp(cycleDate, abs) {
    var d = U.fromYmd(dateAt(cycleDate, abs));
    return d.getUTCDate() + ' ' + U.MON[d.getUTCMonth()] + ' ' + hhmm(abs) + ' IST';
  }
  function dur(mins) {
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return m + 'm';
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }

  /* ---- timezones — cohort windows only ------------------------------------ */
  var TZ = {
    yesbank: { code: 'IST', offset: 'UTC+5:30' },
    'hsbc-in': { code: 'IST', offset: 'UTC+5:30' },
    'hsbc-sg': { code: 'SGT', offset: 'UTC+8' },
    'hsbc-hk': { code: 'HKT', offset: 'UTC+8' },
    'hsbc-au': { code: 'AEDT', offset: 'UTC+11' },
    'hsbc-my': { code: 'MYT', offset: 'UTC+8' }
  };
  function tzOf(tenantId) { return TZ[tenantId] || TZ['hsbc-in']; }

  /* =========================================================================
     PART 3.1 — NETWORK AVAILABILITY MATRIX
     The single source of truth for which cells render at all. Six of the
     sixteen combinations do not exist and must never render as a status.

     It now lives in ops-data.js, because the Reconciliation legs need it too
     and ops-data.js loads first — a second copy here would be a second truth.
     Re-exported below so every existing reader is unchanged.
     ========================================================================= */
  var AVAILABILITY = O.AVAILABILITY;
  var enabled = O.netEnabled;
  var networksFor = O.netsFor;

  /* =========================================================================
     PART 4.2 — THE FOUR LEGS
     Temporal order, not file order: CLR and STL fire together, INC lands hours
     later, JV2 a full cycle later. `band` drives the snapshot's visual grouping.
     ========================================================================= */
  var LEG_DEFS = [
    { key: 'clearing', short: 'CLR', label: 'Clearing', sub: 'outgoing to network', band: 'outgoing', verb: 'Submitted' },
    { key: 'settlement', short: 'STL', label: 'Settlement files', sub: 'MPR · MPF · JV1 to acquirer', band: 'outgoing', verb: 'Generated' },
    { key: 'incoming', short: 'INC', label: 'Incoming', sub: 'response from network', band: 'incoming', verb: 'Received' },
    { key: 'jv2', short: 'JV2', label: 'JV2', sub: 'next-cycle file to acquirer', band: 'next', verb: 'Generated' }
  ];
  var LEG_KEYS = LEG_DEFS.map(function (l) { return l.key; });
  /* PART D.2 — where each leg sits in the tenant's OWN cycle.
     Every tenant runs the same T+1 / T+1 / T+1 / T+2 rhythm in local terms;
     only the IST clock differs, because SGT/HKT is 2.5h ahead and those legs
     land on the transaction date in IST while the Indian ones land the next
     day. Printing the local cycle offset is what removes the timezone
     arithmetic from the reader's head — the timestamp says when it happened in
     IST, this tag says where it sits in the cycle. */
  var CYCLE_DAY = { clearing: 'T+1', settlement: 'T+1', incoming: 'T+1', jv2: 'T+2' };
  var BANDS = [
    { key: 'outgoing', label: 'Outgoing', sub: 'to network + acquirer', legs: ['clearing', 'settlement'] },
    { key: 'incoming', label: 'Incoming', sub: 'from network', legs: ['incoming'] },
    { key: 'next', label: 'Next-cycle outgoing', sub: 'to acquirer', legs: ['jv2'] }
  ];
  var STATE_META = {
    complete: { label: 'Complete', icon: 'check', kind: 'success' },
    inprogress: { label: 'In Progress', icon: 'loader', kind: 'info' },
    pending: { label: 'Pending', icon: 'clock', kind: 'neutral' },
    delayed: { label: 'Delayed', icon: 'alert-triangle', kind: 'warning' },
    failed: { label: 'Failed', icon: 'x-circle', kind: 'danger' }
  };

  /* =========================================================================
     PART 5 — THE SCHEDULE MODEL
     Two profiles. Every `expected` is absolute minutes from T 00:00 IST.
     Cutoff is expected + 2h, everywhere, with no exceptions (Part 5 preamble).

     ON-TIME TOLERANCE. Part 5.1 states the incoming leg as a *window*,
     07:00–08:00 with 07:30 nominal — i.e. the leg is still on time up to 30
     minutes past its nominal expected time. That 30 minutes is the platform's
     on-time tolerance and is applied to every leg: a leg turns amber when it
     misses expected + 30m, and is a hard breach once it passes the cutoff.
     The overrun badge always counts from the nominal expected time.
     ========================================================================= */
  var GRACE_MIN = 30;
  var CUTOFF_LAG = 120;

  function legSched(expected, note) {
    return { expected: expected, grace: expected + GRACE_MIN, cutoff: expected + CUTOFF_LAG, note: note || null };
  }

  var PROFILES = {
    indian: {
      id: 'indian',
      label: 'Indian schedule',
      tenants: 'YES BANK · HSBC IN',
      dayNote: 'Processing runs on T+1 IST — the day after the transaction date.',
      legs: {
        clearing: legSched(1440 + 30, 'Clearing file to Visa / Mastercard / RuPay'),
        settlement: legSched(1440 + 30, 'MPR, MPF and JV1 delivered to the acquirer'),
        incoming: legSched(1440 + 7 * 60 + 30, 'Incoming from network — window 07:00–08:00, 07:30 nominal'),
        jv2: legSched(2880 + 30, 'JV2 delivered to the acquirer, a full cycle later')
      }
    },
    apac: {
      id: 'apac',
      label: 'Asia-Pacific schedule',
      tenants: 'HSBC SG · HSBC HK · HSBC MY · HSBC AU',
      dayNote: 'SGT / HKT / MYT runs 2.5h ahead of IST and AEDT 5.5h ahead, so clearing and settlement fire on the transaction date itself in IST.',
      legs: {
        clearing: legSched(22 * 60, 'Clearing file to network'),
        settlement: legSched(22 * 60 + 30, 'MPR, MPF and JV1 delivered to the acquirer'),
        incoming: legSched(1440 + 3 * 60, 'Incoming from network'),
        jv2: legSched(1440 + 22 * 60 + 30, 'JV2 delivered to the acquirer, a full cycle later')
      }
    }
  };
  var PROFILE_OF = {
    yesbank: 'indian', 'hsbc-in': 'indian',
    'hsbc-sg': 'apac', 'hsbc-hk': 'apac', 'hsbc-au': 'apac', 'hsbc-my': 'apac'
  };
  function profileFor(tenantId) { return PROFILES[PROFILE_OF[tenantId] || 'indian']; }
  function scheduleFor(tenantId) { return profileFor(tenantId).legs; }

  /* =========================================================================
     AUTHORED CYCLE PLANS
     `at` = actual completion (absolute minutes), `started` = in-flight start,
     `failed` = hard failure. Anything not authored is generated clean.
     ========================================================================= */
  function P(clr, stl, inc, jv2) { return { clearing: clr, settlement: stl, incoming: inc, jv2: jv2 || {} }; }
  function IN_(h, m) { return 1440 + h * 60 + m; }     // T+1 hh:mm IST
  function T_(h, m) { return h * 60 + m; }             // T   hh:mm IST

  /* Part 7.1 — the current cycle (20 Nov transactions), seen at T+1 09:00. */
  var TODAY_PLAN = {
    yesbank: {
      visa: P({ at: IN_(0, 28) }, { at: IN_(0, 34) }, { at: IN_(7, 22) }),
      mc: P({ at: IN_(0, 31) }, { at: IN_(0, 36) }, { at: IN_(7, 48) }),
      // The amber row. Incoming landed 08:22 — 52m past the 07:30 nominal, so
      // outside the on-time window, but still inside the 09:30 cutoff.
      rupay: P({ at: IN_(0, 33) }, { at: IN_(0, 39) }, { at: IN_(8, 22) })
    },
    'hsbc-in': {
      visa: P({ at: IN_(0, 27) }, { at: IN_(0, 32) }, { at: IN_(7, 14) }),
      mc: P({ at: IN_(0, 29) }, { at: IN_(0, 35) }, { at: IN_(7, 36) }),
      rupay: P({ at: IN_(0, 34) }, { at: IN_(0, 41) }, { at: IN_(7, 58) })
    },
    'hsbc-sg': {
      visa: P({ at: T_(21, 58) }, { at: T_(22, 26) }, { at: IN_(2, 47) }),
      mc: P({ at: T_(22, 4) }, { at: T_(22, 31) }, { at: IN_(3, 12) })
    },
    'hsbc-hk': {
      visa: P({ at: T_(22, 1) }, { at: T_(22, 29) }, { at: IN_(2, 52) }),
      mc: P({ at: T_(22, 6) }, { at: T_(22, 34) }, { at: IN_(3, 8) }),
      onus: P({ at: T_(21, 52) }, { at: T_(22, 18) }, { at: IN_(2, 34) })
    },
    'hsbc-au': {
      visa: P({ at: T_(21, 49) }, { at: T_(22, 21) }, { at: IN_(2, 44) }),
      mc: P({ at: T_(21, 56) }, { at: T_(22, 27) }, { at: IN_(3, 1) })
    },
    /* Part 10 — HSBC MY is the tenant the Ops Home promotion rule exists for.
       It sits outside the visible four on volume, and its incoming has not
       landed: Visa is 2h 12m past its 05:00 cutoff and Mastercard has never
       arrived at all. A tenant in that state is never hidden behind a
       "show more" affordance. */
    'hsbc-my': {
      visa: P({ at: T_(22, 8) }, { at: T_(22, 37) }, { at: IN_(7, 12) }),
      mc: P({ at: T_(22, 14) }, { at: T_(22, 41) }, {})
    }
  };

  /* Part 7.2 — prior cycles. Failures and delays live here so stepping the
     date control shows the full state vocabulary, not just green. */
  var AUTHORED = {};

  /* Failed settlement generation — HSBC SG · Visa · 18 Nov. JV2 cannot follow. */
  AUTHORED['hsbc-sg|visa|2025-11-18'] = {
    clearing: { at: T_(21, 54) },
    incoming: { at: IN_(2, 51) },
    settlement: {
      failed: true, at: null,
      note: 'MPR/MPF/JV1 generation aborted — the merchant payout run hit 214 records with an unmapped MCC (6012) and the generator refused to emit a partial file. Re-run blocked pending a fee-config correction.'
    },
    jv2: {
      failed: true, at: null,
      note: 'JV2 not generated — it posts against the JV1 journal, which was never produced for this cycle.'
    },
    recon: { status: 'Reconciliation break', residualPctOfNet: 100 }
  };

  /* Failed clearing — YES BANK · Mastercard · 12 Nov. Everything downstream falls. */
  AUTHORED['yesbank|mc|2025-11-12'] = {
    clearing: {
      failed: true, at: IN_(2, 10),
      note: 'Outgoing IPM rejected by GCMS at 02:10 — Message Reason Code 4808 on 214 records (missing interchange rate designator). File re-cut and carried into the 13 Nov cycle.'
    },
    settlement: { failed: true, at: null, note: 'No settlement files raised — the cohort never cleared.' },
    incoming: { failed: true, at: null, note: 'No T140 raw file. The network never accepted the clearing batch, so no response was generated.' },
    jv2: { failed: true, at: null, note: 'No JV2 — nothing settled to post adjustments against.' },
    recon: { status: 'Reconciliation break', residualPctOfNet: 100 }
  };

  /* Delayed incoming legs — amber, three different shapes. */
  AUTHORED['yesbank|rupay|2025-11-17'] = { incoming: { at: IN_(11, 18) } };   // 1h 48m past cutoff
  AUTHORED['hsbc-hk|mc|2025-11-14'] = { incoming: { at: IN_(5, 42) } };       // 42m past cutoff
  AUTHORED['hsbc-in|visa|2025-11-11'] = { incoming: { at: IN_(9, 6) } };      // late, still inside cutoff

  /* Cycle dates the date stepper can reach — 30 days back from the current cycle. */
  var cycleDates = [];
  for (var dd = -29; dd <= 0; dd++) cycleDates.push(U.addDays(CYCLE_TODAY, dd));

  /* ---- holidays ----------------------------------------------------------- */
  function holidayFor(tenantId, date) {
    var t = O.tenantById[tenantId];
    if (!t) return null;
    return O.holidays.find(function (h) { return h.date === date && h.country === t.country; }) || null;
  }
  /* Every tenant holiday landing on this cycle date — drives the stepper tag. */
  function holidaysOn(date) {
    var seen = {}, out = [];
    O.tenants.forEach(function (t) {
      var h = holidayFor(t.id, date);
      if (h && !seen[h.name + h.country]) { seen[h.name + h.country] = 1; out.push({ holiday: h, tenant: t }); }
    });
    return out;
  }

  /* ---- plan resolution ---------------------------------------------------- */
  function autoPlan(tenantId, netKey, date, sched) {
    var r = rng(seedOf('plan|' + tenantId + '|' + netKey + '|' + date));
    var p = {};
    LEG_KEYS.forEach(function (k) {
      // Land inside the on-time window: never earlier than 22m before expected,
      // never later than expected + 26m (the window closes at +30m).
      p[k] = { at: sched[k].expected - rint(r, 0, 22) + rint(r, 0, 26) };
    });
    return p;
  }

  function planFor(tenantId, netKey, date, sched) {
    if (date > CYCLE_TODAY) return null;                 // future cycle — nothing has run
    var base = (date === CYCLE_TODAY)
      ? ((TODAY_PLAN[tenantId] || {})[netKey] || null)
      : autoPlan(tenantId, netKey, date, sched);
    if (!base) return null;
    var authored = AUTHORED[tenantId + '|' + netKey + '|' + date];
    if (!authored) return base;
    var merged = { recon: authored.recon || base.recon || null };
    LEG_KEYS.forEach(function (k) { merged[k] = authored[k] || base[k] || {}; });
    return merged;
  }

  /* The observer's clock, expressed on the selected cycle's own axis. Only the
     current cycle has a live "now" inside its span — a cycle from last week is
     closed, and drawing a now-line across it would be a lie. */
  function nowFor(date) {
    if (date === CYCLE_TODAY) return NOW_ABS;
    if (date < CYCLE_TODAY) return 4 * 1440;      // closed — every leg is long due
    return -1;                                    // future — nothing is due yet
  }
  function isLive(date) { return date === CYCLE_TODAY; }

  /* =========================================================================
     PART D.6 — MANUAL "MARK AS SENT"
     A settlement or JV2 file that went out of band leaves its leg Pending on
     the grid forever. Ops can assert it landed — but the assertion is recorded
     as its own thing, never as a system-confirmed completion: the leg goes
     green and carries `manual`, which every renderer must surface as a tag.
     In memory only, keyed tenant|network|date|leg.
     ========================================================================= */
  var MANUAL = {};
  var MANUAL_LEGS = { settlement: true, jv2: true };
  function manualKey(tenantId, netKey, date, legKey) { return tenantId + '|' + netKey + '|' + date + '|' + legKey; }
  function manualFor(tenantId, netKey, date, legKey) { return MANUAL[manualKey(tenantId, netKey, date, legKey)] || null; }
  /* The observer's clock expressed on this cycle's own axis — marking a leg on
     a cycle from three days ago records the event at T+3 09:00, not at T+1. */
  function nowAbsFor(date) {
    return Math.round((U.fromYmd(TODAY) - U.fromYmd(date)) / 86400000) * 1440 + 9 * 60;
  }
  function canMarkSent(leg) {
    if (!leg || !MANUAL_LEGS[leg.key] || leg.manual) return false;
    return leg.state === 'failed' || leg.state === 'pending' || (leg.state === 'delayed' && leg.actual == null);
  }
  function markSent(tenantId, netKey, date, legKey, note, by) {
    var atAbs = nowAbsFor(date);
    var rec = {
      by: by || 'juspay-ops', note: note, atAbs: atAbs,
      at: stamp(date, atAbs), dayTag: dayTag(atAbs)
    };
    MANUAL[manualKey(tenantId, netKey, date, legKey)] = rec;
    return rec;
  }

  /* ---- leg construction --------------------------------------------------- */
  function buildLeg(def, p, sched, now, live, manual) {
    p = p || {};
    var leg = {
      key: def.key, short: def.short, label: def.label, sub: def.sub, band: def.band, verb: def.verb,
      expected: sched.expected, grace: sched.grace, cutoff: sched.cutoff,
      expectedLabel: hhmm(sched.expected), cutoffLabel: hhmm(sched.cutoff),
      expectedDay: dayTag(sched.expected), cutoffDay: dayTag(sched.cutoff),
      cycleDay: CYCLE_DAY[def.key] || dayTag(sched.expected),
      actual: null, started: null, state: 'pending', overrunMin: 0, breached: false,
      live: live, note: p.note || null, manual: null
    };
    // The moment we measure lateness against: the event itself once there is
    // one, otherwise the live clock. A leg that never produced an event on a
    // closed cycle has nothing to be late by — it simply failed.
    var ref = null;
    if (p.failed) {
      leg.state = 'failed';
      leg.actual = (p.at != null) ? p.at : null;
      ref = p.at;
    } else if (p.at != null) {
      leg.actual = p.at;
      leg.state = (p.at <= sched.grace) ? 'complete' : 'delayed';
      ref = p.at;
    } else if (p.started != null) {
      leg.started = p.started;
      leg.state = (now > sched.grace) ? 'delayed' : 'inprogress';
      ref = live ? now : null;
    } else {
      leg.state = (now > sched.grace) ? 'delayed' : 'pending';
      ref = live ? now : null;
    }
    if (ref != null) {
      leg.overrunMin = Math.max(0, ref - sched.expected);
      leg.breached = ref > sched.cutoff;
    }
    /* A human assertion overrides the machine record (Part D.6). The leg reads
       Complete — but it keeps `manual`, and no renderer is allowed to drop it:
       a manual override that looked identical to a system-confirmed completion
       would quietly erode trust in every green cell on the grid. */
    if (manual) {
      leg.manual = manual;
      leg.state = 'complete';
      leg.actual = manual.atAbs;
      leg.started = null;
      leg.overrunMin = 0;
      leg.breached = false;
      leg.note = null;
    }
    leg.toCutoffMin = live ? sched.cutoff - now : null;
    leg.meta = STATE_META[leg.state];

    /* What the cell prints under the icon (Part D.1): the actual completion
       time and nothing else. A leg that has not landed prints no time at all —
       its cutoff moved to the hover tooltip, because four legs × "by HH:MM"
       was more text than a grid cell can carry. */
    if (leg.actual != null) leg.cellTime = hhmm(leg.actual);
    else if (leg.started != null) leg.cellTime = hhmm(leg.started);
    else leg.cellTime = null;
    leg.cellDay = dayTag(leg.actual != null ? leg.actual : (leg.started != null ? leg.started : sched.cutoff));
    return leg;
  }

  /* legsFor → the cell / snapshot leg set for one tenant × network × date */
  function legsFor(tenantId, netKey, date) {
    var prof = profileFor(tenantId);
    var sched = prof.legs;
    var out = {
      tenantId: tenantId, networkKey: netKey, date: date,
      profile: prof, sched: sched,
      enabled: enabled(tenantId, netKey),
      holiday: holidayFor(tenantId, date),
      future: date > CYCLE_TODAY, live: isLive(date),
      legs: [], byKey: {}, overall: 'pending', recon: null
    };
    if (!out.enabled) { out.overall = 'unavailable'; return out; }

    var plan = planFor(tenantId, netKey, date, sched);
    if (out.holiday && out.holiday.impact === 'Full holiday') { out.overall = 'holiday'; return out; }
    if (!plan) { out.overall = 'notstarted'; return out; }

    var now = nowFor(date), live = out.live;
    LEG_DEFS.forEach(function (def) {
      var leg = buildLeg(def, plan[def.key], sched[def.key], now, live, manualFor(tenantId, netKey, date, def.key));
      out.legs.push(leg); out.byKey[def.key] = leg;
    });
    var states = out.legs.map(function (l) { return l.state; });
    if (states.indexOf('failed') >= 0) out.overall = 'failed';
    else if (states.indexOf('delayed') >= 0) out.overall = 'delayed';
    else if (states.every(function (s) { return s === 'complete'; })) out.overall = 'complete';
    else if (states.indexOf('inprogress') >= 0) out.overall = 'inprogress';
    // Nothing late and nothing failed, but a later leg is not due yet — the
    // cycle is on track, and the cell should read green, not neutral.
    else out.overall = (states.indexOf('complete') >= 0) ? 'ontrack' : 'pending';
    out.recon = plan.recon || null;
    return out;
  }

  /* =========================================================================
     SNAPSHOT DETAIL (Part 6.2)
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

  function rejectionsFor(tenantId, netKey, date) {
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
        // Both dates are columns on the snapshot's rejection table now, so the
        // sentence that used to explain the T+1 / T+2 rhythm beneath it is gone
        // (Part 1.1) and the row carries the facts itself.
        receivedOn: date, reclearOn: U.addDays(date, 1),
        expectedSettlement: U.addDays(date, 2)
      });
    }
    var total = round2(rows.reduce(function (s, x) { return s + x.amount; }, 0));
    return { count: n, amount: total, rows: rows };
  }

  var CLR_EXT = { visa: 'ctf', mc: 'ipm', rupay: 'npci', onus: 'csv' };
  var INC_NAME = { visa: 'VSS_TC46', mc: 'GCMS_T140', rupay: 'NPCI_RAW', onus: 'ONUS_RESP' };
  var INC_EXT = { visa: 'dat', mc: 'ipm', rupay: 'txt', onus: 'csv' };
  var STL_FILES = [
    { type: 'MPR', ext: 'csv', desc: 'Merchant Payout Report' },
    { type: 'MPF', ext: 'txt', desc: 'Merchant Payout File' },
    { type: 'JV1', ext: 'xml', desc: 'Journal Voucher — settlement' }
  ];
  function tenantSlug(tenantId) { return (O.tenantById[tenantId] || { name: tenantId }).name.replace(/\s/g, ''); }
  function checksum(r) {
    var s = ''; for (var i = 0; i < 8; i++) s += '0123456789abcdef'[rint(r, 0, 15)];
    return 'sha256:' + s + '…';
  }
  function landed(leg) { return leg.actual != null && leg.state !== 'failed'; }

  function snapshot(tenantId, netKey, date) {
    var t = O.tenantById[tenantId];
    var net = D.NET_BY_KEY[netKey];
    if (!t || !net) return null;

    var base = legsFor(tenantId, netKey, date);
    var tz = tzOf(tenantId);
    var snap = {
      tenant: t, network: net, date: date,
      // Part 5.2 — a cycle is identified, not dated. One snapshot is one
      // tenant × network × cycle, which is exactly what the ID encodes.
      cycleId: O.cycleId(tenantId, netKey, date, 1),
      dow: U.DOW[U.fromYmd(date).getUTCDay()],
      tz: tz, currency: t.currency,
      profile: base.profile, sched: base.sched,
      enabled: base.enabled, holiday: base.holiday, future: base.future, live: base.live,
      legs: base.legs, byKey: base.byKey, overall: base.overall,
      // The observer's clock is absolute; only the current cycle carries it
      // inside its own span, so only that cycle draws a "now" marker.
      nowAbs: base.live ? NOW_ABS : null, nowLabel: stamp(CYCLE_TODAY, NOW_ABS),
      // Transaction cohort — the one window stated in the tenant's own zone.
      cohort: {
        label: 'Txns ' + U.prettyDate(date) + ' 00:00–23:59 ' + tz.code,
        from: U.prettyDate(date) + ' 00:00 ' + tz.code,
        to: U.prettyDate(date) + ' 23:59 ' + tz.code,
        fromAbs: 0, toAbs: 1439
      }
    };
    if (!base.enabled || !base.legs.length) return snap;

    var a = amountsFor(tenantId, netKey, date);
    var r = a.r;
    var clr = base.byKey.clearing, stl = base.byKey.settlement,
      inc = base.byKey.incoming, jv2 = base.byKey.jv2;

    /* ---- Card 1 · Clearing (outgoing to network) -------------------------- */
    var heldBack = (rint(r, 0, 5) === 0)
      ? { count: 1, amount: round2(a.gross * 0.004), reason: 'One batch held back — MCC 6012 records missing the mandated payment-facilitator identifier.' }
      : null;
    var grossCleared = round2(a.gross - (heldBack ? heldBack.amount : 0));
    snap.clearing = {
      leg: clr,
      submittedAt: landed(clr) ? stamp(date, clr.actual) : null,
      gross: grossCleared, count: a.count, batches: a.batches, heldBack: heldBack,
      file: {
        name: tenantSlug(tenantId) + '_' + net.short.toUpperCase() + '_CLEARING_' + date.replace(/-/g, '') + '.' + CLR_EXT[netKey],
        size: (0.8 + r() * 7).toFixed(1) + ' MB', checksum: checksum(r),
        dest: '/out/' + tenantId + '/clearing/'
      }
    };

    /* ---- Card 3 · Incoming (from network) --------------------------------- */
    var rej = rejectionsFor(tenantId, netKey, date);
    if (inc.state === 'failed') rej = { count: 0, amount: 0, rows: [] };
    var interchange = round2(grossCleared * net.ic);
    var scheme = round2(grossCleared * net.scheme);
    var otherAdj = round2(grossCleared * (netKey === 'visa' ? 0.0002 : 0.0001));
    snap.incoming = {
      leg: inc,
      receivedAt: landed(inc) ? stamp(date, inc.actual) : null,
      gross: round2(grossCleared - rej.amount), count: a.count - rej.count,
      rejections: rej,
      fees: { interchange: interchange, scheme: scheme, other: otherAdj, total: round2(interchange + scheme + otherAdj) },
      file: landed(inc) ? {
        name: INC_NAME[netKey] + '_' + tenantSlug(tenantId) + '_' + date.replace(/-/g, '') + '.' + INC_EXT[netKey],
        size: (0.4 + r() * 4).toFixed(1) + ' MB', checksum: checksum(r)
      } : null
    };

    /* ---- Card 2 · Settlement files (outgoing to acquirer) ----------------- */
    var mdr = round2(grossCleared * net.mdr);
    var netSettlement = round2(grossCleared - snap.incoming.fees.total - rej.amount);
    var setR = rng(seedOf('files|' + tenantId + '|' + netKey + '|' + date));
    snap.settlement = {
      leg: stl,
      generatedAt: landed(stl) ? stamp(date, stl.actual) : null,
      grossSettlement: grossCleared,
      mdr: mdr,
      netSettlement: netSettlement,
      files: STL_FILES.map(function (f, i) {
        var genMin = (stl.actual != null ? stl.actual : stl.cutoff) + 4 + i * 7;
        return {
          type: f.type, desc: f.desc,
          name: tenantSlug(tenantId) + '_' + f.type + '_' + date.replace(/-/g, '') + '.' + f.ext,
          size: (0.3 + setR() * 5).toFixed(1) + ' MB',
          generatedAt: landed(stl) ? stamp(date, genMin) : null
        };
      })
    };

    /* ---- Card 4 · JV2 (next-cycle outgoing to acquirer) ------------------- */
    var reversals = round2(rej.amount);
    snap.jv2 = {
      leg: jv2,
      generatedAt: landed(jv2) ? stamp(date, jv2.actual) : null,
      countdownMin: (snap.live && jv2.actual == null && jv2.state !== 'failed') ? Math.max(0, jv2.expected - NOW_ABS) : null,
      feesPosted: snap.incoming.fees.total,
      rejectionReversals: reversals,
      netAdjustment: round2(snap.incoming.fees.total + reversals),
      file: {
        name: tenantSlug(tenantId) + '_JV2_' + date.replace(/-/g, '') + '.xml',
        size: (0.2 + setR() * 1.6).toFixed(1) + ' MB',
        dest: '/out/' + tenantId + '/journals/'
      }
    };

    /* ---- Reconciliation callout ------------------------------------------ */
    var reconPlan = base.recon;
    var difference = reconPlan ? round2(netSettlement * (reconPlan.residualPctOfNet / 100)) : 0;
    /* The recon row is per tenant × network × cycle now (Part 4.3), so the
       snapshot links to its own network's row rather than to the day. */
    var reconCycle = { id: O.cycleId(tenantId, netKey, date, 1) };
    if (reconPlan) {
      /* Refinement Part 4.1 — the reconciliation is gross submitted against
         gross received. There is no fee subtraction and no residual, so a
         difference here is a genuine break with nothing to explain it away. */
      snap.recon = { status: 'Difference found', kind: 'danger', difference: difference, note: 'Gross received does not match gross submitted. Investigation open with the settlement desk.', cycleId: reconCycle ? reconCycle.id : null };
    } else if (snap.incoming.leg.state !== 'complete') {
      snap.recon = { status: 'Awaiting incoming', kind: 'neutral', difference: 0, note: 'Reconciliation runs automatically once the incoming file is parsed and pushed to tables.', cycleId: reconCycle ? reconCycle.id : null };
    } else {
      snap.recon = { status: 'Reconciled', kind: 'success', difference: 0, note: 'Gross received matches gross submitted exactly.', cycleId: reconCycle ? reconCycle.id : null };
    }

    snap.status = overallStatus(snap);
    return snap;
  }

  /* ---- overall status pill + one-line summary ----------------------------- */
  function overallStatus(snap) {
    var st = baseStatus(snap);
    var manual = snap.legs.filter(function (l) { return l.manual; });
    st.manualCount = manual.length;
    if (manual.length) {
      st.line += ' ' + manual.map(function (l) { return l.short; }).join(' and ') +
        ' manually marked as sent by ' + manual[0].manual.by + ' — asserted, not system-confirmed.';
    }
    return st;
  }
  function baseStatus(snap) {
    var legs = snap.legs;
    var bad = legs.filter(function (l) { return l.state === 'failed'; });
    var late = legs.filter(function (l) { return l.state === 'delayed'; });
    if (bad.length) {
      return {
        text: 'Failed', kind: 'danger', icon: 'x-circle',
        line: (bad.length > 1
          ? bad.map(function (l) { return l.short; }).join(', ') + ' legs failed'
          : bad[0].label + ' leg failed') + ' — intervention required.'
      };
    }
    if (late.length) {
      return {
        text: 'Delayed', kind: 'warning', icon: 'alert-triangle',
        line: late.map(function (l) {
          if (!l.overrunMin) return l.label + ' missed its ' + l.cutoffLabel + ' cutoff';
          return l.label + ' ' + dur(l.overrunMin) + ' past its ' + l.expectedLabel + ' expected time' +
            (l.breached ? ' — cutoff ' + l.cutoffLabel + ' breached' : ', inside the ' + l.cutoffLabel + ' cutoff');
        }).join(' · ') + '.'
      };
    }
    if (legs.every(function (l) { return l.state === 'complete'; })) {
      return {
        text: 'Clean', kind: 'success', icon: 'check-circle',
        line: legs.some(function (l) { return l.manual; })
          ? 'All four legs complete.'
          : 'All four legs complete inside their expected windows.'
      };
    }
    var running = legs.filter(function (l) { return l.state === 'inprogress'; });
    if (running.length) {
      return { text: 'In Progress', kind: 'info', icon: 'loader', line: running[0].label + ' is processing — started ' + hhmm(running[0].started) + ', cutoff ' + running[0].cutoffLabel + ' ' + running[0].cutoffDay + '.' };
    }
    var next = legs.filter(function (l) { return l.state === 'pending'; })[0];
    return {
      text: 'On track', kind: 'success', icon: 'check-circle',
      line: next
        ? (next.label + ' not due yet — expected ' + next.expectedLabel + ' ' + next.expectedDay + ', ' + dur(next.expected - NOW_ABS) + ' from now.')
        : 'Cycle in flight.'
    };
  }

  /* ---- one-line cell tooltip ---------------------------------------------- */
  function cellSummary(tenantId, netKey, date) {
    var t = O.tenantById[tenantId], net = D.NET_BY_KEY[netKey];
    var c = legsFor(tenantId, netKey, date);
    if (!c.enabled) return net.name + ' is not enabled for ' + t.name;
    if (c.overall === 'holiday') return t.name + ' · ' + net.name + ' · bank holiday (' + c.holiday.name + ') — no files expected';
    if (!c.legs.length) return t.name + ' · ' + net.name + ' · cycle has not started';
    return t.name + ' · ' + net.name + ' · ' + c.legs.map(function (l) {
      if (l.manual) return l.short + ' manually marked sent ' + hhmm(l.actual);
      if (l.state === 'complete') return l.short + ' ' + hhmm(l.actual) + ' ' + l.cellDay;
      if (l.state === 'inprogress') return l.short + ' running since ' + hhmm(l.started);
      if (l.state === 'pending') return l.short + ' due by ' + l.cutoffLabel + ' ' + l.cutoffDay;
      if (l.state === 'delayed') return l.overrunMin
        ? l.short + ' ' + dur(l.overrunMin) + ' late' + (l.breached ? ' (cutoff breached)' : '')
        : l.short + ' missed its ' + l.cutoffLabel + ' cutoff';
      return l.short + ' failed';
    }).join(' · ');
  }

  return {
    TODAY: TODAY, CYCLE_TODAY: CYCLE_TODAY, NOW_ABS: NOW_ABS, cycleDates: cycleDates,
    LEG_DEFS: LEG_DEFS, LEG_KEYS: LEG_KEYS, BANDS: BANDS, STATE_META: STATE_META, CYCLE_DAY: CYCLE_DAY,
    markSent: markSent, manualFor: manualFor, canMarkSent: canMarkSent,
    PROFILES: PROFILES, GRACE_MIN: GRACE_MIN, CUTOFF_LAG: CUTOFF_LAG,
    AVAILABILITY: AVAILABILITY, enabled: enabled, networksFor: networksFor,
    hhmm: hhmm, dur: dur, dayTag: dayTag, dayOf: dayOf, dateAt: dateAt, stamp: stamp, shortStamp: shortStamp,
    tzOf: tzOf, profileFor: profileFor, scheduleFor: scheduleFor,
    legsFor: legsFor, snapshot: snapshot, cellSummary: cellSummary,
    holidayFor: holidayFor, holidaysOn: holidaysOn,
    // pointers the grid uses to make the failed / delayed states reachable
    failedDemos: [
      { tenantId: 'hsbc-sg', networkKey: 'visa', date: '2025-11-18', what: 'settlement generation failed' },
      { tenantId: 'yesbank', networkKey: 'mc', date: '2025-11-12', what: 'clearing rejected by GCMS' }
    ]
  };
})();
