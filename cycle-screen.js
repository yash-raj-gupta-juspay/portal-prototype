/* =============================================================================
   Juspay Ops Portal — Cross-Tenant Cycle Status grid + Cycle Snapshot drill-in

   Two things live here and nothing else:
     1. gridSection() — the Cross-Tenant Cycle Status component Ops Home embeds.
                        Section header with a cycle-date stepper, then one cell
                        per tenant × network carrying the four legs
                        (CLR · STL · INC · JV2), each with its own state, icon,
                        IST timestamp and T+n day tag, tinted by the cell's
                        overall state. Combinations a tenant does not process
                        render as recessive "Not enabled" placeholders.
     2. route()       — #/dashboard/ops/cycle-snapshot/:tenantId/:network/:date
                        The operational picture for one cycle: a multi-day
                        four-lane timeline against expected times and cutoffs,
                        then clearing / settlement / incoming / JV2 detail, the
                        tenant's schedule reference, and a recon callout.

   window.CycleUI(kit) → { gridSection, gridHtml, route, actions }
   ============================================================================= */
window.CycleUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS, C = window.CYCLES;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, cardBox = kit.cardBox,
    setView = kit.setView, toast = kit.toast, el = kit.el, go = kit.go,
    num = kit.num, fmt = kit.fmt, tenantTag = kit.tenantTag;

  var ROUTE = '#/dashboard/ops/cycle-snapshot';

  // In-memory only — no storage, no timers.
  S.cycle = { rejOpen: false, schedOpen: false, gridDate: C.CYCLE_TODAY };

  function snapRoute(tenantId, netKey, date) { return ROUTE + '/' + tenantId + '/' + netKey + '/' + date; }
  function paintIcons() { if (window.lucide) window.lucide.createIcons(); }

  /* =======================================================================
     PART 4.3 — THE CELL
     Four segments. CLR and STL are coupled, INC is its own phase, JV2 is next
     cycle — the separators after STL and after INC carry that grouping.
     ======================================================================= */
  function segment(leg, sepBefore) {
    var m = leg.meta;
    var phrase = leg.state === 'complete' ? 'completed ' + C.hhmm(leg.actual) + ' (' + leg.cellDay + ')'
      : leg.state === 'inprogress' ? 'running since ' + C.hhmm(leg.started)
        : leg.state === 'pending' ? 'not due yet'
          : leg.state === 'delayed' ? (leg.actual != null
            ? 'completed ' + C.hhmm(leg.actual) + ', ' + C.dur(leg.overrunMin) + ' past expected'
            : 'awaiting — ' + C.dur(leg.overrunMin) + ' past expected')
            : 'failed — requires intervention';
    var tip = leg.label + ' — ' + m.label + ' · ' + phrase +
      ' · expected ' + leg.expectedLabel + ' ' + leg.expectedDay +
      ' · cutoff ' + leg.cutoffLabel + ' ' + leg.cutoffDay + ' (IST)';
    return '<span class="cyc-seg st-' + leg.state + (sepBefore ? ' cyc-sep' : '') + '" title="' + esc(tip) + '">' +
      '<span class="cyc-seg-label">' + leg.short + '</span>' +
      '<span class="cyc-seg-icon" aria-hidden="true">' + icon(m.icon, 15) + '</span>' +
      '<span class="cyc-seg-ts">' + leg.cellTime + '</span>' +
      '<span class="cyc-seg-day">' + leg.cellDay + '</span>' +
      (leg.overrunMin > 0 && (leg.state === 'delayed' || leg.state === 'failed')
        ? '<span class="cyc-overrun' + (leg.breached ? ' breached' : '') + '">+' + C.dur(leg.overrunMin) + '</span>'
        : '<span class="cyc-overrun-spacer"></span>') +
      '<span class="sr-only">' + leg.label + ' ' + m.label + '</span>' +
      '</span>';
  }

  var TINT = { complete: 'tint-ok', ontrack: 'tint-ok', delayed: 'tint-warn', failed: 'tint-fail' };
  // Separators sit after STL (outgoing pair → incoming) and after INC (→ next cycle).
  var SEP_BEFORE = { incoming: true, jv2: true };

  function cell(tenantId, netKey, date) {
    var t = O.tenantById[tenantId], net = D.NET_BY_KEY[netKey];

    /* Part 3.2 — a combination that does not exist is a placeholder, never a
       status. No icons, no timestamps, not clickable, visually recessive. */
    if (!C.enabled(tenantId, netKey)) {
      return '<td class="cyc-td"><div class="cyc-cell cyc-na" aria-hidden="false" ' +
        'title="' + esc('This network is not enabled for ' + t.name) + '">' +
        '<span class="cyc-na-body"><span class="cyc-na-dash">—</span>' +
        '<span class="cyc-na-label">Not enabled</span></span></div></td>';
    }

    var c = C.legsFor(tenantId, netKey, date);
    var summary = C.cellSummary(tenantId, netKey, date);
    var inner;
    if (c.overall === 'holiday') {
      inner = '<span class="cyc-flat">' + icon('calendar-x', 15) + '<span>Not expected — holiday</span></span>';
    } else if (!c.legs.length) {
      inner = '<span class="cyc-flat">' + icon('circle-dashed', 15) + '<span>Not started</span></span>';
    } else {
      inner = '<span class="cyc-legs">' + c.legs.map(function (l) {
        return segment(l, !!SEP_BEFORE[l.key]);
      }).join('') + '</span>';
    }
    return '<td class="cyc-td"><button type="button" class="cyc-cell ' + (TINT[c.overall] || '') + '" ' +
      'data-route="' + snapRoute(tenantId, netKey, date) + '" ' +
      'title="' + esc(summary) + '" aria-label="' + esc(summary) + ' — open cycle snapshot">' +
      inner + '</button></td>';
  }

  /* =======================================================================
     PART 2.3 — CYCLE DATE STEPPER
     The cycle date is the *transaction* date; processing runs on later days,
     which is exactly why it needs saying out loud next to the grid.
     ======================================================================= */
  var DATE_TIP = 'Cycle date = transaction date. Processing happens on subsequent days per the schedule below.';

  function dateStepper() {
    var date = S.cycle.gridDate;
    var idx = C.cycleDates.indexOf(date);
    var prev = idx > 0 ? C.cycleDates[idx - 1] : null;
    var next = idx >= 0 && idx < C.cycleDates.length - 1 ? C.cycleDates[idx + 1] : null;
    var d = U.fromYmd(date);
    var hols = C.holidaysOn(date);
    var holTag = hols.length
      ? '<span class="cyc-date-hol" title="' + esc(hols.map(function (h) { return h.holiday.name + ' · ' + h.holiday.country + ' (' + h.holiday.impact + ')'; }).join(' · ')) + '">' +
      icon('calendar-x', 12) + hols[0].holiday.country + ' holiday' + (hols.length > 1 ? ' +' + (hols.length - 1) : '') + '</span>'
      : '';

    return '<div class="cyc-datebar">' +
      '<button class="icon-btn" data-action="cyc-date-prev" ' + (prev ? '' : 'disabled ') +
      'aria-label="Previous cycle">' + icon('chevron-left', 16) + '</button>' +
      '<div class="cyc-date-label" title="' + esc(DATE_TIP) + '">' +
      '<span class="cyc-date-key">Cycle</span>' +
      '<span class="cyc-date-value">' + U.prettyDate(date) + ' (' + U.DOW[d.getUTCDay()].slice(0, 3) + ')</span>' +
      icon('info', 12) + holTag +
      '</div>' +
      '<button class="icon-btn" data-action="cyc-date-next" ' + (next ? '' : 'disabled ') +
      'aria-label="Next cycle">' + icon('chevron-right', 16) + '</button>' +
      '<button class="btn btn-secondary btn-sm" data-action="cyc-date-today" ' + (next ? '' : 'disabled ') +
      'title="' + esc('Jump to the current cycle — transactions of ' + U.prettyDate(C.CYCLE_TODAY) + ', processing now') + '">Today</button>' +
      '</div>';
  }

  /* ---- the grid itself ---------------------------------------------------- */
  function gridTable(date) {
    var head = '<tr><th class="cyc-th cyc-th-tenant">Tenant</th>' + O.NETWORKS.map(function (n) {
      return '<th class="cyc-th"><span class="cyc-net"><span class="cyc-net-dot" style="background:' + n.color + '"></span>' + n.short + '</span></th>';
    }).join('') + '</tr>';
    var rows = O.tenants.map(function (t) {
      var prof = C.profileFor(t.id);
      return '<tr><th scope="row" class="cyc-tenant">' + tenantTag(t.id) +
        '<span class="cyc-tenant-sched" title="' + esc(prof.label + ' — ' + prof.dayNote) + '">' +
        (prof.id === 'indian' ? 'T+1 processing' : 'T processing') + '</span></th>' +
        O.NETWORKS.map(function (n) { return cell(t.id, n.key, date); }).join('') + '</tr>';
    }).join('');
    return '<div class="cyc-grid-wrap"><table class="cyc-grid"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  function legend(date) {
    var legendStates = ['complete', 'inprogress', 'pending', 'delayed', 'failed'].map(function (k) {
      var m = C.STATE_META[k];
      return '<span class="cyc-lg-item st-' + k + '">' + icon(m.icon, 14) + m.label + '</span>';
    }).join('');
    var demo = C.failedDemos[0];
    return '<div class="cyc-legend">' +
      '<div class="cyc-lg-row">' +
      '<span class="cyc-lg-key">CLR</span> clearing to network · ' +
      '<span class="cyc-lg-key">STL</span> settlement files (MPR · MPF · JV1) to acquirer · ' +
      '<span class="cyc-lg-key">INC</span> incoming from network · ' +
      '<span class="cyc-lg-key">JV2</span> next-cycle journal to acquirer' +
      '</div>' +
      '<div class="cyc-lg-row">' + legendStates + '</div>' +
      '<div class="cyc-lg-row meta">' +
      '<strong>All times IST.</strong> HSBC SG and HSBC HK cycles process on the transaction date in IST; HSBC IN and YES BANK process the following day. ' +
      'The <span class="cyc-lg-key">T+n</span> tag under each timestamp is the processing day relative to the cycle date.' +
      '</div>' +
      '<div class="cyc-lg-row meta">Timestamps are the actual completion time, or the cutoff as “by HH:MM” while a leg has not landed. Cutoff is the expected time plus two hours. Click any cell for its cycle snapshot.</div>' +
      '<div class="cyc-lg-row meta">Prior cycles hold the failure states — e.g. <a class="cyc-lg-link" data-route="' + snapRoute(demo.tenantId, demo.networkKey, demo.date) + '">HSBC SG · Visa · ' + U.prettyDate(demo.date) + '</a> failed its settlement leg.</div>' +
      '</div>';
  }

  function gridInner() {
    var date = S.cycle.gridDate;
    return '<div class="cyc-sec-head">' +
      '<div class="section-title">Cross-tenant cycle status</div>' + dateStepper() + '</div>' +
      cardBox('', gridTable(date) + legend(date));
  }

  /* The component Ops Home embeds. Stepping the date repaints this mount only,
     so the rest of Ops Home never re-renders. */
  function gridSection() { return '<div id="cyc-mount">' + gridInner() + '</div>'; }
  function repaintGrid() {
    var mount = el('cyc-mount');
    if (!mount) { go('#/dashboard/ops'); return; }
    mount.innerHTML = gridInner();
    paintIcons();
  }
  function stepGrid(n) {
    var idx = C.cycleDates.indexOf(S.cycle.gridDate);
    var next = C.cycleDates[idx + n];
    if (!next) return;
    S.cycle.gridDate = next;
    repaintGrid();
  }

  /* =======================================================================
     PART 6.1 — THE FOUR-LEG TIMELINE
     A multi-day horizontal axis, day dividers, three bands and four lanes.
     Every position is a percentage of the same absolute-minute span, so the
     axis, the cohort bracket and all four lanes share one coordinate system.
     ======================================================================= */
  function deltaText(leg) {
    if (leg.state === 'complete') {
      return leg.verb + ' ' + C.dur(leg.cutoff - leg.actual) + ' before cutoff';
    }
    if (leg.state === 'delayed' && leg.actual != null) {
      return leg.breached
        ? leg.verb + ' ' + C.dur(leg.actual - leg.cutoff) + ' past cutoff'
        : leg.verb + ' ' + C.dur(leg.overrunMin) + ' past expected · still ' + C.dur(leg.cutoff - leg.actual) + ' before cutoff';
    }
    if (leg.state === 'delayed') {
      if (!leg.live) return 'Never landed · cutoff ' + leg.cutoffLabel + ' ' + leg.cutoffDay;
      return leg.breached
        ? 'Awaiting — ' + C.dur(C.NOW_ABS - leg.cutoff) + ' past cutoff'
        : 'Awaiting — ' + C.dur(leg.overrunMin) + ' past expected, ' + C.dur(leg.cutoff - C.NOW_ABS) + ' to cutoff';
    }
    if (leg.state === 'inprogress') {
      return 'Running since ' + C.hhmm(leg.started) + ' · ' + C.dur(leg.cutoff - C.NOW_ABS) + ' to cutoff';
    }
    if (leg.state === 'pending') {
      return leg.live
        ? 'Due ' + leg.expectedLabel + ' ' + leg.expectedDay + ' · ' + C.dur(leg.expected - C.NOW_ABS) + ' from now'
        : 'Due ' + leg.expectedLabel + ' ' + leg.expectedDay;
    }
    return 'Failed · cutoff ' + leg.cutoffLabel + ' ' + leg.cutoffDay + (leg.actual != null ? ' · last event ' + C.hhmm(leg.actual) : '');
  }

  function timeline(snap) {
    // A closed cycle has no live "now" on its own axis — the marker, the flag
    // and every "awaiting" reading are suppressed rather than drawn as fiction.
    var nowAbs = snap.nowAbs;
    var start = 0, maxAbs = nowAbs != null ? nowAbs : 0;
    snap.legs.forEach(function (l) {
      maxAbs = Math.max(maxAbs, l.cutoff, l.actual != null ? l.actual : 0, l.started != null ? l.started : 0);
    });
    var end = Math.ceil((maxAbs + 90) / 360) * 360;          // round out to a 6-hour boundary
    var dayCount = Math.ceil(end / 1440);
    function p(abs) { return Math.max(0, Math.min(100, ((abs - start) / (end - start)) * 100)); }
    function px(abs) { return p(abs).toFixed(2) + '%'; }
    function w(a, b) { return Math.max(0.3, p(b) - p(a)).toFixed(2) + '%'; }

    /* Day shading + dividers, repeated behind every track so the day columns
       read as continuous vertical bands down the whole timeline. */
    var dayLayer = '';
    for (var d = 0; d < dayCount; d++) {
      var from = d * 1440, to = Math.min((d + 1) * 1440, end);
      dayLayer += '<div class="tl2-daycol' + (d % 2 ? ' odd' : '') + '" style="left:' + px(from) + ';width:' + w(from, to) + '"></div>';
      if (d > 0) dayLayer += '<div class="tl2-daydiv" style="left:' + px(from) + '"></div>';
    }

    /* Axis — day labels above, 6-hourly ticks below. */
    var dayLabels = '';
    for (var dd = 0; dd < dayCount; dd++) {
      var f = dd * 1440, tt = Math.min((dd + 1) * 1440, end);
      var dt = U.fromYmd(C.dateAt(snap.date, f));
      dayLabels += '<div class="tl2-daylabel" style="left:' + px(f) + ';width:' + w(f, tt) + '">' +
        '<span class="tl2-daylabel-date">' + dt.getUTCDate() + ' ' + U.MON[dt.getUTCMonth()] + '</span>' +
        '<span class="tl2-daylabel-tag">' + (dd === 0 ? 'T' : 'T+' + dd) + '</span></div>';
    }
    var ticks = '';
    for (var m = 0; m <= end; m += 360) {
      if (m % 1440 === 0 && m !== 0) continue;              // the divider already marks midnight
      ticks += '<span class="tl2-tick" style="left:' + px(m) + '">' + C.hhmm(m) + '</span>';
    }

    var nowMark = nowAbs != null ? '<div class="tl2-now" style="left:' + px(nowAbs) + '"></div>' : '';

    /* Lanes, grouped into the three bands. */
    var bands = C.BANDS.map(function (band) {
      var lanes = band.legs.map(function (key) {
        var leg = snap.byKey[key];
        if (!leg) return '';
        var evAbs = leg.actual != null ? leg.actual : (leg.started != null ? leg.started : null);

        // The overrun hatch runs from the cutoff to the actual event (or to now
        // while the leg is still missing) — the visual weight of being late.
        // Where a missing leg's marker sits: at the live clock while the cycle
        // is still running, at its cutoff once the cycle is closed.
        var missingAt = nowAbs != null ? nowAbs : leg.cutoff;

        var overrun = '';
        if ((leg.state === 'delayed' || leg.state === 'failed') && leg.breached) {
          var overEnd = leg.actual != null ? leg.actual : missingAt;
          overrun = '<div class="tl2-overrun st-' + leg.state + '" style="left:' + px(leg.cutoff) + ';width:' + w(leg.cutoff, overEnd) + '" ' +
            'title="' + esc(C.dur(overEnd - leg.cutoff) + ' past the ' + leg.cutoffLabel + ' cutoff') + '"></div>';
        } else if (leg.state === 'delayed' && leg.actual != null) {
          overrun = '<div class="tl2-late" style="left:' + px(leg.expected) + ';width:' + w(leg.expected, leg.actual) + '" ' +
            'title="' + esc(C.dur(leg.actual - leg.expected) + ' past the ' + leg.expectedLabel + ' expected time, inside the cutoff') + '"></div>';
        } else if (leg.state === 'delayed' && leg.live) {
          overrun = '<div class="tl2-late" style="left:' + px(leg.expected) + ';width:' + w(leg.expected, missingAt) + '" ' +
            'title="' + esc(C.dur(missingAt - leg.expected) + ' past the ' + leg.expectedLabel + ' expected time, inside the cutoff') + '"></div>';
        }

        var ev = '';
        if (evAbs != null) {
          ev = '<div class="tl2-ev st-' + leg.state + (p(evAbs) > 86 ? ' at-end' : '') + (leg.started != null && leg.actual == null ? ' running' : '') +
            '" style="left:' + px(evAbs) + '"><span class="tl2-dot"></span>' +
            '<span class="tl2-evtime">' + C.hhmm(evAbs) + '</span></div>';
        } else if (leg.state === 'delayed' || leg.state === 'failed') {
          ev = '<div class="tl2-ev st-' + leg.state + (p(missingAt) > 86 ? ' at-end' : '') + '" style="left:' + px(missingAt) + '">' +
            '<span class="tl2-dot hollow"></span><span class="tl2-evtime">' + (leg.state === 'failed' ? 'failed' : 'awaiting') + '</span></div>';
        }

        var expClass = 'tl2-exp' + (p(leg.expected) > 88 ? ' at-end' : '');
        var cutClass = 'tl2-cut st-' + leg.state + (p(leg.cutoff) > 88 ? ' at-end' : '');
        return '<div class="tl2-row tl2-lane st-' + leg.state + '">' +
          '<div class="tl2-head">' +
          '<div class="tl2-lane-title"><span class="cyc-legkey">' + leg.short + '</span>' + leg.label +
          '<span class="cyc-head-chip st-' + leg.state + '">' + icon(leg.meta.icon, 13) + leg.meta.label + '</span></div>' +
          '<div class="tl2-lane-sub">' + leg.sub + '</div>' +
          '<div class="tl2-delta st-' + leg.state + '">' + deltaText(leg) + '</div>' +
          '</div>' +
          '<div class="tl2-track">' + dayLayer +
          '<div class="tl2-rail"></div>' +
          '<div class="tl2-window" style="left:' + px(leg.expected) + ';width:' + w(leg.expected, leg.cutoff) + '" ' +
          'title="' + esc('Expected ' + leg.expectedLabel + ' ' + leg.expectedDay + ' → cutoff ' + leg.cutoffLabel + ' ' + leg.cutoffDay) + '"></div>' +
          overrun +
          '<div class="' + expClass + '" style="left:' + px(leg.expected) + '" title="' + esc('Expected ' + leg.expectedLabel + ' IST (' + leg.expectedDay + ')') + '">' +
          '<span class="tl2-flag exp">exp ' + leg.expectedLabel + '</span></div>' +
          '<div class="' + cutClass + '" style="left:' + px(leg.cutoff) + '" title="' + esc('Cutoff ' + leg.cutoffLabel + ' IST (' + leg.cutoffDay + ') — expected + 2h') + '">' +
          '<span class="tl2-flag cut">cutoff ' + leg.cutoffLabel + '</span></div>' +
          nowMark + ev +
          '</div></div>';
      }).join('');

      return '<div class="tl2-band band-' + band.key + '">' +
        '<div class="tl2-band-head"><span class="tl2-band-label">' + band.label + '</span>' +
        '<span class="tl2-band-sub">' + band.sub + '</span></div>' +
        lanes + '</div>';
    }).join('');

    return '<div class="tl2">' +
      '<div class="tl2-row tl2-axisrow">' +
      '<div class="tl2-head"><div class="tl2-axis-title">' + dayCount + '-day cycle span</div>' +
      '<div class="tl2-axis-sub">' + U.prettyDate(snap.date) + ' → ' + U.prettyDate(C.dateAt(snap.date, end - 1)) + ' · all times IST</div></div>' +
      '<div class="tl2-track tl2-axis">' + dayLayer + dayLabels + ticks +
      (nowAbs != null
        ? '<span class="tl2-nowflag" style="left:' + px(nowAbs) + '">now ' + C.hhmm(nowAbs) + ' ' + C.dayTag(nowAbs) + '</span>'
        : '<span class="tl2-closedflag">cycle closed</span>') + nowMark + '</div></div>' +
      '<div class="tl2-row tl2-cohortrow">' +
      '<div class="tl2-head"><div class="tl2-lane-title">Transaction cohort</div>' +
      '<div class="tl2-lane-sub">what this cycle covers</div></div>' +
      '<div class="tl2-track">' + dayLayer +
      '<div class="tl2-cohort" style="left:' + px(snap.cohort.fromAbs) + ';width:' + w(snap.cohort.fromAbs, snap.cohort.toAbs) + '" ' +
      'title="' + esc(snap.cohort.from + ' → ' + snap.cohort.to) + '"><span>' + esc(snap.cohort.label) + '</span></div>' +
      nowMark + '</div></div>' +
      bands +
      '<div class="tl2-key">' +
      '<span class="tl2-key-item"><span class="tl2-key-exp"></span>expected</span>' +
      '<span class="tl2-key-item"><span class="tl2-key-cut"></span>cutoff (expected + 2h)</span>' +
      '<span class="tl2-key-item"><span class="tl2-key-win"></span>on-time window</span>' +
      '<span class="tl2-key-item"><span class="tl2-key-dot"></span>actual event</span>' +
      '<span class="tl2-key-item"><span class="tl2-key-hatch"></span>past cutoff</span>' +
      (nowAbs != null ? '<span class="tl2-key-item"><span class="tl2-key-now"></span>now</span>' : '') +
      '<span class="tl2-key-item meta">Vertical dividers are IST midnights — this cycle spans ' + dayCount + ' calendar days.</span>' +
      '</div></div>';
  }

  /* =======================================================================
     PART 6.2 — THE FOUR DETAIL CARDS
     ======================================================================= */
  function kv(rows) {
    return '<dl class="cyc-kv">' + rows.map(function (r) {
      if (!r) return '';
      return '<dt>' + r[0] + (r[2] ? ' <span class="cyc-tip" title="' + esc(r[2]) + '">' + icon('info', 12) + '</span>' : '') + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
  }
  function fileRow(f, sub) {
    return '<div class="cyc-file"><span class="cyc-file-ic">' + icon('file-text', 16) + '</span>' +
      '<div class="cyc-file-body"><div class="cyc-file-name">' + esc(f.name) + '</div>' +
      '<div class="cyc-file-meta">' + sub + '</div></div>' +
      '<button class="btn btn-secondary btn-sm" data-action="cyc-download" data-name="' + esc(f.name) + '">' + icon('download', 14) + 'Download</button></div>';
  }
  function legStamp(leg, text, fallback) {
    return '<span class="cyc-stamp st-' + leg.state + '">' + (text ? esc(text) : fallback) + '</span>';
  }
  function expectedCell(snap, leg) {
    return '<span class="num">' + leg.expectedLabel + ' IST</span> <span class="cyc-daytag">' +
      leg.expectedDay + ' · ' + U.prettyDate(C.dateAt(snap.date, leg.expected)) + '</span>';
  }
  function cutoffCell(snap, leg) {
    return '<span class="num">' + leg.cutoffLabel + ' IST</span> <span class="cyc-daytag">' +
      leg.cutoffDay + ' · ' + U.prettyDate(C.dateAt(snap.date, leg.cutoff)) + '</span>' +
      '<span class="cyc-neg">expected + 2h</span>';
  }
  function statusChip(leg) {
    return ' <span class="cyc-head-chip st-' + leg.state + '">' + icon(leg.meta.icon, 13) + leg.meta.label + '</span>';
  }
  function againstRow(leg) {
    return ['Against cutoff', '<span class="st-' + leg.state + ' cyc-strong">' + deltaText(leg) + '</span>'];
  }

  function clearingCard(snap) {
    var cur = snap.currency, cl = snap.clearing, leg = cl.leg;
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Transaction cohort', esc(snap.cohort.from) + ' → ' + esc(snap.cohort.to), 'Stated in the tenant’s own zone — the transactions genuinely happened on local time. Every processing time on this screen is IST.'],
        ['Submitted at', legStamp(leg, cl.submittedAt, leg.state === 'failed' ? 'Submission failed' : 'Not submitted')],
        ['Expected at', expectedCell(snap, leg)],
        ['Cutoff', cutoffCell(snap, leg)],
        againstRow(leg)
      ]) +
      kv([
        ['Gross amount cleared', '<span class="num">' + fmt(cl.gross, 2, cur) + '</span>'],
        ['Transaction count', '<span class="num">' + num(cl.count) + '</span>'],
        ['Batches submitted', '<span class="num">' + cl.batches + '</span>'],
        ['Batches held back', cl.heldBack
          ? '<span class="num">' + cl.heldBack.count + '</span> · ' + fmt(cl.heldBack.amount, 2, cur) + '<div class="meta">' + esc(cl.heldBack.reason) + '</div>'
          : 'None']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout danger mt-16">' + icon('x-circle', 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title">Outgoing clearing file</div>' +
      fileRow(cl.file, cl.file.size + ' · ' + cl.file.checksum + ' · ' + cl.file.dest);
    return cardBox('Clearing — outgoing to network' + statusChip(leg), body);
  }

  function settlementCard(snap) {
    var cur = snap.currency, st = snap.settlement, leg = st.leg;
    var files = st.files.map(function (f) {
      return fileRow(f, f.desc + ' · ' + f.size + ' · ' + (f.generatedAt ? 'generated ' + f.generatedAt : 'not generated'));
    }).join('');
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Generated at', legStamp(leg, st.generatedAt, leg.state === 'failed' ? 'Generation failed' : 'Not generated yet')],
        ['Expected at', expectedCell(snap, leg)],
        ['Cutoff', cutoffCell(snap, leg)],
        againstRow(leg)
      ]) +
      kv([
        ['Gross settlement', '<span class="num">' + fmt(st.grossSettlement, 2, cur) + '</span>', 'As reported in the MPR / MPF / JV1 files for this cycle'],
        ['Merchant fees (MDR) total', '<span class="num">' + fmt(st.mdr, 2, cur) + '</span>', 'Merchant Discount Rate charged to merchants — the bank’s revenue side'],
        ['Net payable to merchants', '<span class="num cyc-strong">' + fmt(st.netSettlement, 2, cur) + '</span>']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout danger mt-16">' + icon('x-circle', 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title" id="snap-files">Settlement files delivered to the acquirer</div>' +
      (leg.state === 'failed'
        ? '<div class="meta">No settlement files were produced for this cycle.</div>'
        : files);
    return cardBox('Settlement files — outgoing to acquirer' + statusChip(leg), body);
  }

  function incomingCard(snap) {
    var cur = snap.currency, inc = snap.incoming, leg = inc.leg;
    var rej = inc.rejections;
    var rejRows = rej.rows.map(function (r) {
      return '<tr><td class="mono">' + r.arn + '</td><td class="num">' + fmt(r.amount, 2, cur) + '</td>' +
        '<td><div class="cell-main">' + r.reasonCode + '</div><div class="cell-sub">' + esc(r.reasonDesc) + '</div></td>' +
        '<td class="nowrap">' + U.prettyDate(r.expectedSettlement) + '</td></tr>';
    }).join('');
    var rejBlock = rej.count
      ? '<div class="cyc-rej">' +
      '<button class="btn-ghost" data-action="cyc-rej-toggle">' + icon(S.cycle.rejOpen ? 'chevron-down' : 'chevron-right', 14) +
      (S.cycle.rejOpen ? 'Hide rejection details' : 'View rejection details') + '</button>' +
      (S.cycle.rejOpen
        ? '<div class="table-wrap mt-16"><table class="data"><thead><tr><th>ARN</th><th class="num">Amount</th><th>Reason</th><th>Expected settlement (T+2)</th></tr></thead><tbody>' + rejRows + '</tbody></table></div>' +
        '<div class="meta mt-16">Rejected records are deducted from this cycle’s settlement, re-cleared on T+1 and settle on T+2.</div>'
        : '') + '</div>'
      : '<div class="meta">No rejections in this cycle’s incoming file.</div>';

    var tip = 'Reported directly in the network’s incoming file';
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Received at', legStamp(leg, inc.receivedAt, leg.state === 'failed' ? 'No file — clearing was rejected' : 'Awaiting')],
        ['Expected at', expectedCell(snap, leg)],
        ['Cutoff', cutoffCell(snap, leg)],
        againstRow(leg),
        ['Gross amount received', inc.receivedAt ? '<span class="num">' + fmt(inc.gross, 2, cur) + '</span>' : '—'],
        ['Transactions confirmed', inc.receivedAt ? '<span class="num">' + num(inc.count) + '</span>' : '—']
      ]) +
      kv([
        ['Interchange', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.interchange, 2, cur) + '</span>' : '—', tip],
        ['Scheme fee', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.scheme, 2, cur) + '</span>' : '—', tip],
        ['Other adjustments', inc.receivedAt ? '<span class="num">' + fmt(inc.fees.other, 2, cur) + '</span>' : '—', tip],
        ['Total fees reported by network', inc.receivedAt ? '<span class="num cyc-strong">' + fmt(inc.fees.total, 2, cur) + '</span>' : '—', tip],
        ['Incoming rejections', rej.count ? '<span class="num">' + rej.count + '</span> · ' + fmt(rej.amount, 2, cur) : 'None']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout ' + (leg.state === 'failed' ? 'danger' : 'warn') + ' mt-16">' + icon(leg.meta.icon, 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title">Rejections</div>' + rejBlock +
      '<div class="cyc-sub-title">Incoming file</div>' +
      (inc.file ? fileRow(inc.file, inc.file.size + ' · ' + inc.file.checksum)
        : '<div class="meta">' + (leg.state === 'failed' ? 'No incoming file was produced for this cycle.' : 'Not received yet — cutoff ' + leg.cutoffLabel + ' IST ' + leg.cutoffDay + '.') + '</div>');
    return cardBox('Incoming — response from network' + statusChip(leg), body);
  }

  function jv2Card(snap) {
    var cur = snap.currency, j = snap.jv2, leg = j.leg;
    var countdown = j.countdownMin != null
      ? '<span class="cyc-count">' + icon('clock', 13) + C.dur(j.countdownMin) + ' from now</span>'
      : '';
    var body =
      '<div class="cyc-2col">' +
      kv([
        ['Generated at', legStamp(leg, j.generatedAt, leg.state === 'failed' ? 'Generation failed' : 'Not generated yet') + ' ' + countdown],
        ['Expected at', expectedCell(snap, leg)],
        ['Cutoff', cutoffCell(snap, leg)],
        againstRow(leg),
        ['Cycle offset', '<span class="cyc-daytag">' + leg.expectedDay + ' — a full cycle after clearing</span>']
      ]) +
      kv([
        ['Fees posted', '<span class="num">' + fmt(j.feesPosted, 2, cur) + '</span>', 'Interchange, scheme and other adjustments as reported in the incoming file'],
        ['Rejection reversals', '<span class="num">' + fmt(j.rejectionReversals, 2, cur) + '</span>', 'Records the network rejected, backed out of this cycle’s settlement'],
        ['Net JV2 adjustment', '<span class="num cyc-strong">' + fmt(j.netAdjustment, 2, cur) + '</span>']
      ]) +
      '</div>' +
      (leg.note ? '<div class="callout danger mt-16">' + icon('x-circle', 20) + '<div class="callout-body">' + esc(leg.note) + '</div></div>' : '') +
      '<div class="cyc-sub-title">JV2 file</div>' +
      (leg.state === 'failed'
        ? '<div class="meta">No JV2 file was produced for this cycle.</div>'
        : leg.actual != null
          ? fileRow(j.file, j.file.size + ' · ' + j.file.dest)
          : '<div class="meta">Not generated yet — expected ' + leg.expectedLabel + ' IST on ' + U.prettyDate(C.dateAt(snap.date, leg.expected)) + ' (' + leg.expectedDay + '), cutoff ' + leg.cutoffLabel + '.</div>');
    return cardBox('JV2 — next-cycle outgoing to acquirer' + statusChip(leg), body);
  }

  /* ---- Part 6.3 — schedule reference panel -------------------------------- */
  function scheduleCard(snap) {
    var prof = snap.profile;
    var rows = C.LEG_DEFS.map(function (def) {
      var s = snap.sched[def.key];
      var leg = snap.byKey[def.key];
      return '<tr>' +
        '<td><span class="cyc-legkey">' + def.short + '</span> ' + def.label + '<div class="cell-sub">' + esc(s.note || def.sub) + '</div></td>' +
        '<td class="num nowrap">' + C.hhmm(s.expected) + ' <span class="cyc-daytag">' + C.dayTag(s.expected) + '</span></td>' +
        '<td class="num nowrap">' + C.hhmm(s.cutoff) + ' <span class="cyc-daytag">' + C.dayTag(s.cutoff) + '</span></td>' +
        '<td class="num nowrap">' + (leg && leg.actual != null ? C.hhmm(leg.actual) + ' <span class="cyc-daytag">' + C.dayTag(leg.actual) + '</span>' : '—') + '</td>' +
        '<td>' + (leg ? pill(leg.meta.label, leg.meta.kind, leg.meta.icon) : '—') + '</td>' +
        '</tr>';
    }).join('');
    var head = '<button class="cyc-sched-toggle" data-action="cyc-sched-toggle">' +
      icon(S.cycle.schedOpen ? 'chevron-down' : 'chevron-right', 15) +
      '<span>Cycle schedule for this tenant</span>' +
      '<span class="cyc-sched-tag">' + esc(prof.label) + ' · ' + esc(prof.tenants) + '</span></button>';
    var body = S.cycle.schedOpen
      ? '<div class="meta mb-16">' + esc(prof.dayNote) + ' Cutoff is the expected time plus two hours on every leg. Times IST; T is the transaction date.</div>' +
      '<table class="data"><thead><tr><th>Leg</th><th class="num">Expected</th><th class="num">Cutoff</th><th class="num">Actual</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '';
    return '<div class="card cyc-sched">' + head + body + '</div>';
  }

  /* ---- reconciliation callout --------------------------------------------- */
  function reconCallout(snap) {
    var r = snap.recon, cur = snap.currency;
    var link = '#/dashboard/ops/reconciliation?reconTenant=' + snap.tenant.id + (r.cycleId ? '&reconCycle=' + r.cycleId : '');
    return '<div class="cyc-recon ' + r.kind + '">' +
      '<div class="cyc-recon-body">' +
      '<div class="cyc-recon-head">Reconciliation ' + pill(r.status, r.kind, r.kind === 'success' ? 'check' : (r.kind === 'danger' ? 'alert-octagon' : 'clock')) + '</div>' +
      '<div class="meta">' + esc(r.note) + (r.residual ? ' Residual <span class="num cyc-strong">' + fmt(r.residual, 2, cur) + '</span>.' : '') + '</div>' +
      '</div>' +
      '<button class="btn btn-secondary" data-route="' + link + '">' + icon('git-compare', 15) + 'View reconciliation</button>' +
      '</div>';
  }

  /* =======================================================================
     THE SNAPSHOT SCREEN
     ======================================================================= */
  function header(snap) {
    var t = snap.tenant, net = snap.network;
    var idx = C.cycleDates.indexOf(snap.date);
    var prev = idx > 0 ? C.cycleDates[idx - 1] : null;
    var next = idx >= 0 && idx < C.cycleDates.length - 1 ? C.cycleDates[idx + 1] : null;
    var hol = snap.holiday;

    var nav = '<div class="cyc-cycle-nav">' +
      '<button class="btn btn-secondary btn-sm" ' + (prev ? 'data-route="' + snapRoute(t.id, net.key, prev) + '"' : 'disabled') + '>' + icon('chevron-left', 14) + 'Previous cycle</button>' +
      '<button class="btn btn-secondary btn-sm" ' + (next ? 'data-route="' + snapRoute(t.id, net.key, next) + '"' : 'disabled') + '>Next cycle' + icon('chevron-right', 14) + '</button>' +
      '</div>';

    return '<div class="breadcrumb"><a data-route="#/dashboard/ops">Ops Home</a><span class="sep">/</span><span>Cycle Snapshot</span></div>' +
      '<div class="page-head cyc-head">' +
      '<div>' +
      '<h1 class="page-title cyc-title">' + tenantTag(t.id) +
      '<span class="cyc-net-badge" style="background:' + net.color + '1A;color:' + net.color + ';border-color:' + net.color + '40">' + net.name + '</span></h1>' +
      '<div class="subtitle">Cycle ' + U.prettyDate(snap.date) + ' · ' + snap.dow +
      ' <span class="cyc-daytag" title="' + esc(DATE_TIP) + '">transaction date · cohort in ' + snap.tz.code + ' (' + snap.tz.offset + ')</span>' +
      (hol ? ' ' + pill(hol.name, hol.impact === 'Full holiday' ? 'danger' : 'warning', 'calendar-x') : '') + '</div>' +
      '<div class="meta cyc-nowline">All processing times IST · viewed ' + esc(snap.nowLabel) + '</div>' +
      '</div>' +
      '<div class="cyc-head-right">' +
      (snap.status ? '<div class="cyc-status"><div class="cyc-status-pill">' + pill(snap.status.text, snap.status.kind, snap.status.icon) + '</div><div class="meta cyc-status-line">' + esc(snap.status.line) + '</div></div>' : '') +
      '<div class="head-actions">' +
      '<button class="btn btn-secondary" data-action="cyc-back">' + icon('arrow-left', 15) + 'Back to Ops Home</button>' +
      '<button class="btn btn-secondary" data-action="cyc-refresh">' + icon('refresh-cw', 15) + 'Refresh</button>' +
      '<button class="btn btn-secondary" data-action="cyc-files">' + icon('folder', 15) + 'View settlement files</button>' +
      '<button class="btn btn-secondary" data-route="#/dashboard/ops/reconciliation?reconTenant=' + t.id + (snap.recon && snap.recon.cycleId ? '&reconCycle=' + snap.recon.cycleId : '') + '">' + icon('git-compare', 15) + 'View reconciliation</button>' +
      '</div>' + nav +
      '</div></div>';
  }

  function viewSnapshot(tenantId, netKey, date) {
    var snap = C.snapshot(tenantId, netKey, date);
    if (!snap) { go('#/dashboard/ops'); return; }

    if (!snap.enabled) {
      setView(header(snap) +
        '<div class="card">' + kit.emptyState('ban', snap.network.name + ' is not enabled for ' + snap.tenant.name,
          snap.tenant.name + ' processes ' + C.networksFor(tenantId).map(function (n) { return n.name; }).join(', ') +
          '. There is no cycle to show for this combination.',
          '<button class="btn btn-secondary mt-16" data-action="cyc-back">' + icon('arrow-left', 15) + 'Back to Ops Home</button>') + '</div>');
      return;
    }
    if (snap.holiday && snap.holiday.impact === 'Full holiday') {
      setView(header(snap) +
        '<div class="card">' + kit.emptyState('calendar-x', 'Bank holiday — no files expected',
          snap.holiday.name + ' · ' + snap.tenant.country + '. No clearing, settlement, incoming or JV2 activity is scheduled for ' + snap.network.name + ' on this cycle.') + '</div>' +
        '<div class="mt-24">' + scheduleCard(snap) + '</div>');
      return;
    }
    if (!snap.legs.length) {
      setView(header(snap) +
        '<div class="card">' + kit.emptyState('circle-dashed', 'Cycle has not started',
          'The ' + U.prettyDate(snap.date) + ' cycle for ' + snap.tenant.name + ' · ' + snap.network.name + ' has not begun processing. Expected schedule below.') + '</div>' +
        '<div class="mt-24">' + scheduleCard(snap) + '</div>');
      return;
    }

    setView(
      header(snap) +
      '<div class="section-title mb-16">Four-leg timeline</div>' +
      cardBox('', timeline(snap)) +
      '<div class="mt-24">' + scheduleCard(snap) + '</div>' +
      '<div class="section-title mb-16 mt-24">Cycle detail</div>' +
      '<div class="cyc-sections">' +
      clearingCard(snap) +
      settlementCard(snap) +
      incomingCard(snap) +
      jv2Card(snap) +
      '</div>' +
      '<div class="mt-24">' + reconCallout(snap) + '</div>'
    );
  }

  /* =======================================================================
     ROUTING + ACTIONS
     ======================================================================= */
  function route(rest) {
    var tenantId = rest[0], netKey = rest[1], date = rest[2] || C.CYCLE_TODAY;
    if (!O.tenantById[tenantId] || !D.NET_BY_KEY[netKey]) { go('#/dashboard/ops'); return; }
    // A different cycle starts with the collapsibles closed again.
    if (S.cycle.tenantId !== tenantId || S.cycle.networkKey !== netKey || S.cycle.date !== date) {
      S.cycle.rejOpen = false; S.cycle.schedOpen = false;
    }
    S.cycle.tenantId = tenantId; S.cycle.networkKey = netKey; S.cycle.date = date;
    return viewSnapshot(tenantId, netKey, date);
  }

  var ACTIONS = {
    'cyc-back': function () { go('#/dashboard/ops'); },
    'cyc-refresh': function () {
      viewSnapshot(S.cycle.tenantId, S.cycle.networkKey, S.cycle.date);
      toast('Cycle status refreshed · as of ' + C.hhmm(C.NOW_ABS) + ' IST');
    },
    'cyc-files': function () {
      var target = el('snap-files');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'cyc-rej-toggle': function () {
      S.cycle.rejOpen = !S.cycle.rejOpen;
      viewSnapshot(S.cycle.tenantId, S.cycle.networkKey, S.cycle.date);
    },
    'cyc-sched-toggle': function () {
      S.cycle.schedOpen = !S.cycle.schedOpen;
      viewSnapshot(S.cycle.tenantId, S.cycle.networkKey, S.cycle.date);
    },
    'cyc-download': function (t) { toast('Downloading ' + t.getAttribute('data-name')); },
    'cyc-date-prev': function () { stepGrid(-1); },
    'cyc-date-next': function () { stepGrid(1); },
    'cyc-date-today': function () { S.cycle.gridDate = C.CYCLE_TODAY; repaintGrid(); }
  };

  return {
    gridSection: gridSection,
    gridHtml: gridSection,          // back-compat with the previous embed point
    route: route, actions: ACTIONS, ROUTE: ROUTE
  };
};
