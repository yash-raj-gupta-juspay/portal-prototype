/* =============================================================================
   Juspay Ops Portal — Cross-tenant mock data (Phase 2)
   Extends window.DATA (Phase 1). Deterministic. window.OPS exposed for app.js.
   ============================================================================= */
window.OPS = (function () {
  'use strict';
  var D = window.DATA, U = D.util;

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
  function pick(r, a) { return a[Math.floor(r() * a.length)]; }
  function round2(n) { return Math.round(n * 100) / 100; }
  var TODAY = D.TODAY; // 2025-11-21

  /* ---- Tenants ------------------------------------------------------------ */
  var tenants = [
    { id: 'yesbank', name: 'YES BANK', country: 'India', currency: 'INR', region: 'ap-south-1', color: '#7C3AED', flag: '🇮🇳' },
    { id: 'hsbc-in', name: 'HSBC IN', country: 'India', currency: 'INR', region: 'ap-south-1', color: '#DB2777', flag: '🇮🇳' },
    { id: 'hsbc-sg', name: 'HSBC SG', country: 'Singapore', currency: 'SGD', region: 'ap-southeast-1', color: '#0891B2', flag: '🇸🇬' },
    { id: 'hsbc-hk', name: 'HSBC HK', country: 'Hong Kong', currency: 'HKD', region: 'ap-east-1', color: '#EA580C', flag: '🇭🇰' }
  ];
  var tenantById = {}; tenants.forEach(function (t) { tenantById[t.id] = t; });
  var rates = { INR: 1, SGD: 61.5, HKD: 10.7 };
  function toINR(amt, cur) { return amt * (rates[cur] || 1); }

  /* ---- Merchants per tenant ---------------------------------------------- */
  var NAMES = {
    yesbank: ['DMart - Vashi', 'More Supermarket - Koramangala', "Spencer's - Park Street", 'Vijay Sales - Andheri', 'Metro Cash & Carry - Yeshwanthpur', 'Pantaloons - Forum Mall', 'Max Fashion - Phoenix', 'Wildcraft - Indiranagar', 'Biba - Select Citywalk', 'Chumbak - Khan Market', "Haldiram's - Connaught Place", 'Saravana Bhavan - T Nagar', 'Third Wave Coffee - HSR', 'Chai Point - Whitefield', 'Apollo Pharmacy - Jayanagar', 'MedPlus - Ameerpet', 'Tanishq - Jubilee Hills', 'Kalyan Jewellers - RS Puram', 'Cleartrip - Digital', 'Nykaa - Digital'],
    'hsbc-sg': ['Cold Storage - Orchard', 'NTUC FairPrice - Toa Payoh', 'Uniqlo - ION Orchard', 'Din Tai Fung - Paragon', 'Kopitiam - Suntec', 'Sheng Siong - Bedok', 'Challenger - Funan', 'Charles & Keith - VivoCity', 'BreadTalk - Tampines', 'Toast Box - Raffles Place', 'Guardian - Jurong Point', 'Watsons - Bugis Junction'],
    'hsbc-hk': ['Wellcome - Central', 'PARKnSHOP - Causeway Bay', 'Café de Coral - Mong Kok', 'H&M - IFC Mall', 'Yoshinoya - TST', 'Mannings - Wan Chai', 'Fortress - Kowloon Bay', "Maxim's - Sha Tin", 'Broadway - Mong Kok', 'Sasa - Tsim Sha Tsui']
  };
  var MCCS = ['5411', '5812', '5732', '5999', '5311', '5651', '5941', '7011', '4511', '7999'];
  var mccLabelOf = D.MCC;

  function buildMerchants(tenant, names, seedBase) {
    return names.map(function (nm, i) {
      var r = rng(seedBase + i * 7);
      var tier = pick(r, ['small', 'mid', 'mid', 'large']);
      var base = tenant.currency === 'INR'
        ? { small: [300000, 900000], mid: [1500000, 6000000], large: [12000000, 45000000] }[tier]
        : { small: [4000, 14000], mid: [22000, 90000], large: [180000, 700000] }[tier];
      var daily = Math.round(base[0] + r() * (base[1] - base[0]));
      var mcc = pick(r, MCCS);
      return {
        id: tenant.id + '-m' + String(i + 1).padStart(2, '0'),
        name: nm, tenantId: tenant.id,
        mid: String(rint(r, 4000, 4999)) + ' ' + String(rint(r, 1000, 9999)) + ' ' + String(rint(r, 10000, 99999)),
        mcc: mcc, mccLabel: mccLabelOf[mcc], tier: tier,
        dailyVolume: daily, mtdVolume: daily * 22, currency: tenant.currency,
        chargebackPct: round2(0.05 + r() * 0.5)
      };
    });
  }
  var merchantsByTenant = {
    'hsbc-in': D.merchants.map(function (m) {
      return { id: m.id, name: m.name, tenantId: 'hsbc-in', mid: m.mid, mcc: m.mcc, mccLabel: m.mccLabel, tier: m.tier, dailyVolume: m.dailyVolume, mtdVolume: m.mtdVolume, currency: 'INR', chargebackPct: m.chargebackPct };
    }),
    yesbank: buildMerchants(tenantById.yesbank, NAMES.yesbank, 11000),
    'hsbc-sg': buildMerchants(tenantById['hsbc-sg'], NAMES['hsbc-sg'], 22000),
    'hsbc-hk': buildMerchants(tenantById['hsbc-hk'], NAMES['hsbc-hk'], 33000)
  };
  var allMerchants = [];
  tenants.forEach(function (t) { allMerchants = allMerchants.concat(merchantsByTenant[t.id]); });
  var merchantById = {}; allMerchants.forEach(function (m) { merchantById[m.id] = m; });

  /* ---- Networks & fee rates (reuse Phase 1 network meta) ------------------ */
  var NETWORKS = D.NETWORKS;
  var NET_BY_KEY = D.NET_BY_KEY;

  /* ---- Fee approvals (~18 across tenants, maker-checker) ------------------ */
  var CARD = ['Credit', 'Debit'], REGION = ['Domestic', 'Cross-border'];
  function ruleKey(r) { return r.network + '|' + r.cardType + '|' + r.region + '|' + r.txnType; }
  function baseRules(r, merchant) {
    var rules = [];
    ['visa', 'mc', 'rupay'].forEach(function (nk) {
      var net = NET_BY_KEY[nk];
      var creditMdr = nk === 'rupay' ? 0.85 + r() * 0.2 : 1.80 + r() * 0.3;
      rules.push({ network: net.name, networkKey: nk, cardType: 'Credit', region: 'Domestic', txnType: 'Sale', mccBucket: merchant.mcc + ' · ' + merchant.mccLabel, pct: round2(creditMdr), interchange: round2(nk === 'rupay' ? 0.7 : 1.65), scheme: round2(0.10), fixed: nk === 'rupay' ? 0 : 2 });
      rules.push({ network: net.name, networkKey: nk, cardType: 'Debit', region: 'Domestic', txnType: 'Sale', mccBucket: merchant.mcc + ' · ' + merchant.mccLabel, pct: round2(nk === 'rupay' ? 0.8 : 1.0 + r() * 0.2), interchange: round2(0.9), scheme: round2(0.08), fixed: 1 });
    });
    return rules;
  }
  var FC_EMAILS = { yesbank: '@yesbank.in', 'hsbc-in': '@hsbc.co.in', 'hsbc-sg': '@hsbc.com.sg', 'hsbc-hk': '@hsbc.com.hk' };
  var FC_REASONS = [
    'Aligning MDR with the renegotiated merchant contract effective next billing cycle.',
    'Passing through the Visa scheme fee revision per bulletin 2025-11.',
    'Introducing a cross-border tier for the merchant’s new international acquiring.',
    'Volume-based discount as the merchant crossed the quarterly GMV threshold.',
    'Correcting a debit MDR that sat above the regulatory cap.'
  ];
  var REJ_NOTES = [
    'Proposed MDR exceeds the board-approved ceiling for this MCC bucket. Resubmit within 1.85%.',
    'Effective date conflicts with an in-flight scheme fee revision. Align dates and resubmit.'
  ];
  // status distribution: pending-heavy + 2 approved + 2 rejected
  var FC_STATUS = ['Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Approved', 'Approved', 'Rejected', 'Rejected'];
  /* Tenant assignment is authored, not random (refinement round 2 §A.3): the
     queue's tenant summary tiles are only useful if the pending work is
     distributed the way the ops team actually sees it —
     YES BANK 3 · HSBC IN 6 · HSBC SG 4 · HSBC HK 1. */
  var FC_TENANT = [
    'yesbank', 'yesbank', 'yesbank',
    'hsbc-in', 'hsbc-in', 'hsbc-in', 'hsbc-in', 'hsbc-in', 'hsbc-in',
    'hsbc-sg', 'hsbc-sg', 'hsbc-sg', 'hsbc-sg',
    'hsbc-hk',
    'hsbc-in', 'hsbc-sg',      // approved
    'yesbank', 'hsbc-hk'       // rejected
  ];
  /* Hours since submission against the 48h SLA. Index 3 (HSBC IN) sits 3h from
     breach — the one tile that must show a red SLA signal. */
  var FC_AGE = [2, 11, 30, 45, 6, 20, 26, 33, 12, 9, 38, 15, 24, 28];
  var feeApprovals = FC_STATUS.map(function (status, i) {
    var r = rng(44000 + i * 13);
    var tenant = tenantById[FC_TENANT[i]] || tenants[0];
    var merchant = pick(r, merchantsByTenant[tenant.id]);
    var current = baseRules(r, merchant);
    // proposed: modify rule 0 (pct), remove one debit rule, add a cross-border credit rule
    var proposed = current.map(function (rule, idx) {
      if (idx === 0) return Object.assign({}, rule, { pct: round2(rule.pct + (r() > 0.4 ? 0.30 : -0.20)) });
      return Object.assign({}, rule);
    });
    var removedIdx = 3; // a debit rule
    var removed = current[removedIdx];
    proposed = proposed.filter(function (_, idx) { return idx !== removedIdx; });
    var added = { network: 'Visa', networkKey: 'visa', cardType: 'Credit', region: 'Cross-border', txnType: 'Sale', mccBucket: merchant.mcc + ' · ' + merchant.mccLabel, pct: round2(2.75 + r() * 0.4), interchange: 2.4, scheme: 0.12, fixed: 3 };
    proposed.push(added);
    var mainDelta = proposed[0].pct - current[0].pct;
    var monthlyVol = merchant.mtdVolume;
    var totalDelta = Math.round(monthlyVol * (mainDelta / 100) * 0.55);
    var pctRel = round2((totalDelta / (monthlyVol * 0.019)) * 100);
    var submittedHoursAgo = status === 'Pending' ? FC_AGE[i % 14] : rint(r, 60, 240);
    var perNet = ['visa', 'mc', 'rupay'].map(function (nk) {
      return { network: NET_BY_KEY[nk].name, networkKey: nk, delta: Math.round(totalDelta * (nk === 'visa' ? 0.5 : nk === 'mc' ? 0.35 : 0.15)) };
    });
    return {
      id: 'FCA-' + String(5100 + i),
      tenantId: tenant.id, merchant: merchant.name, merchantId: merchant.id, mid: merchant.mid,
      submittedBy: merchant.name.split(' - ')[0].toLowerCase().replace(/[^a-z]/g, '') + '.ops' + FC_EMAILS[tenant.id],
      submittedHoursAgo: submittedHoursAgo,
      changeSummary: (mainDelta >= 0 ? 'MDR increase ' : 'MDR decrease ') + current[0].pct.toFixed(2) + '% → ' + proposed[0].pct.toFixed(2) + '% on ' + current[0].network + ' credit domestic',
      status: status,
      current: current, proposed: proposed, removed: removed, added: added,
      pl: { totalDelta: totalDelta, pctRel: pctRel, currency: tenant.currency, perNet: perNet, monthlyVol: monthlyVol },
      reason: pick(r, FC_REASONS),
      reviewerNotes: status === 'Rejected' ? pick(r, REJ_NOTES) : '',
      rejectionReason: status === 'Rejected' ? pick(r, REJ_NOTES) : null,
      effective: U.addDays(TODAY, rint(r, 5, 30))
    };
  });

  /* ---- Two-way reconciliation cycles per tenant (~30 days) ---------------- */
  function maskArn(r) { return '74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999); }
  var REJECT_CODES = D.REJECT_CODES;

  function buildCycles(tenant) {
    // distinct per-tenant seed (all tenant ids are 7 chars, so length alone collides)
    var seedBase = 7; for (var sc = 0; sc < tenant.id.length; sc++) seedBase = (seedBase * 31 + tenant.id.charCodeAt(sc)) >>> 0;
    var dates = [];
    for (var d = U.addDays(TODAY, -30); d <= TODAY; d = U.addDays(d, 1)) dates.push(d);
    // designate special cycles (indexes from the end)
    var n = dates.length;
    var breakIdx = tenant.id === 'yesbank' ? [n - 3, n - 16] : [n - 9, n - 18]; // recent break only for yesbank
    var rejIdx = [n - 2, n - 3, n - 7, n - 14]; // rejections in various stages
    var corrIdx = [n - 5, n - 19];             // corrections

    return dates.map(function (date, ci) {
      var r = rng(seedBase + ci * 17);
      var wd = U.fromYmd(date).getUTCDay();
      var isToday = date === TODAY;
      var base = (tenant.currency === 'INR' ? (tenant.id === 'hsbc-in' ? 40000000 : 24000000) : (tenant.currency === 'SGD' ? 620000 : 3600000));
      base *= (0.8 + r() * 0.4);
      if (wd === 0 || wd === 6) base *= 0.72;

      var hasBreak = breakIdx.indexOf(ci) >= 0 && !isToday;
      var hasRej = rejIdx.indexOf(ci) >= 0 && !isToday;
      var hasCorr = corrIdx.indexOf(ci) >= 0 && !isToday;

      var legs = {}; // per network
      var subTotal = 0, setTotal = 0, icTotal = 0, schemeTotal = 0, adjTotal = 0, rejTotal = 0;
      var rejections = [];

      NETWORKS.forEach(function (net) {
        var gross = Math.round(base * net.share);
        var count = Math.round(gross / net.ticket);
        var batches = rint(r, 3, 9);
        var ic = round2(gross * net.ic);
        var scheme = round2(gross * net.scheme);
        var adj = round2(net.key === 'visa' ? gross * 0.0002 : 0); // small known adjustment
        legs[net.key] = { key: net.key, name: net.name, color: net.color, subBatches: batches, subCount: count, subGross: gross, setBatches: batches, setCount: count, interchange: ic, scheme: scheme, adj: adj, rejAmt: 0, rejCount: 0 };
        subTotal += gross; icTotal += ic; schemeTotal += scheme; adjTotal += adj;
      });

      // rejections
      if (hasRej) {
        var stage = ci === n - 2 ? 'Awaiting re-clearing' : (ci === n - 3 ? 'Re-cleared' : 'Settled');
        var nrej = rint(r, 6, 14);
        for (var k = 0; k < nrej; k++) {
          var nk = pick(r, ['visa', 'mc', 'rupay']);
          var code = pick(r, REJECT_CODES);
          var amt = round2((tenant.currency === 'INR' ? 1500 + r() * 38000 : 60 + r() * 1400));
          legs[nk].rejAmt = round2(legs[nk].rejAmt + amt); legs[nk].rejCount += 1;
          rejTotal = round2(rejTotal + amt);
          rejections.push({ tenantId: tenant.id, network: NET_BY_KEY[nk].name, networkKey: nk, arn: maskArn(r), amount: amt, reasonCode: code[0], reasonDesc: code[1], receivedOn: date, reclearOn: U.addDays(date, 1), settleOn: U.addDays(date, 2), status: stage, expectedSettlement: U.addDays(date, 2) });
        }
      }

      var expectedDelta = round2(icTotal + schemeTotal + adjTotal + rejTotal);
      var brk = hasBreak ? round2(subTotal * (0.004 + r() * 0.006)) : 0;
      // settled = submitted - expectedDelta - break
      NETWORKS.forEach(function (net) {
        var lg = legs[net.key];
        var netExpected = lg.interchange + lg.scheme + lg.adj + lg.rejAmt;
        var netBreak = hasBreak && net.key === 'mc' ? brk : 0;
        lg.settleAmt = round2(lg.subGross - netExpected - netBreak);
      });

      /* ---- The batch model (§B.2) -----------------------------------------
         Outgoing is ONE clearing batch per cycle. Incoming is not: the network
         responds across six cycles over the processing window, and the settled
         position is the aggregate of all six.

         The most recent settled cycle is deliberately left mid-flight — four of
         six have landed — because a residual computed before the last two
         arrive is not a break, it is an incomplete picture, and the screen has
         to be able to say so. */
      var provisional = (ci === n - 2);
      var INC_SHARE = [0.22, 0.19, 0.17, 0.16, 0.14, 0.12];
      var INC_AT = ['03:15', '05:40', '07:20', '09:05', '11:30', '14:10'];
      var arrived = provisional ? 4 : 6;
      var arrivedShare = 0;
      for (var ai = 0; ai < arrived; ai++) arrivedShare += INC_SHARE[ai];
      arrivedShare = Math.round(arrivedShare * 10000) / 10000;

      var fullSettle = 0, fullCount = 0;
      NETWORKS.forEach(function (net) { fullSettle += legs[net.key].settleAmt; fullCount += legs[net.key].setCount; });
      fullSettle = round2(fullSettle);

      var incomingCycles = INC_SHARE.map(function (share, k) {
        return {
          n: k + 1, share: share,
          received: k < arrived,
          receivedAt: k < arrived ? U.prettyDate(U.addDays(date, 1)) + ', ' + INC_AT[k] + ' IST' : null,
          amount: round2(fullSettle * share),
          count: Math.round(fullCount * share)
        };
      });

      // Only what has actually landed counts towards the settled position.
      if (provisional) {
        NETWORKS.forEach(function (net) { legs[net.key].settleAmt = round2(legs[net.key].settleAmt * arrivedShare); });
      }
      NETWORKS.forEach(function (net) { setTotal += legs[net.key].settleAmt; });
      setTotal = round2(setTotal);
      var residual = round2(subTotal - setTotal - expectedDelta);

      // corrections
      var corrections = [];
      if (hasCorr) {
        var wrong = round2(legs.rupay.scheme * (1.4 + r() * 0.3));
        corrections.push({ network: 'RuPay', field: 'Scheme Fee', originalValue: wrong, correctedValue: legs.rupay.scheme, nullifiedAt: U.prettyDate(U.addDays(date, 1)) + ', 09:14 IST', correctedAt: U.prettyDate(U.addDays(date, 1)) + ', 09:22 IST', reason: 'Scheme fee posted with an incorrect rate table (v2024.3); re-posted with the correct domestic rate.', by: 'settlement-engine / auto-recon' });
      }

      // three-state (for current/today cycle grid)
      var states = {};
      // per-tenant today profile → drives both the cross-tenant matrix and the health strip
      var prof = { yesbank: 'partial', 'hsbc-in': 'settled', 'hsbc-sg': 'early', 'hsbc-hk': 'settled' }[tenant.id] || 'partial';
      NETWORKS.forEach(function (net, ni) {
        if (isToday) {
          var parsedDone, settledDone;
          if (prof === 'settled') { parsedDone = true; settledDone = true; }
          else if (prof === 'early') { parsedDone = (net.key === 'visa'); settledDone = false; }
          else { parsedDone = true; settledDone = (net.key === 'visa' || net.key === 'mc'); } // partial
          states[net.key] = { authorized: { done: true, ts: U.prettyDate(date) + ', 23:1' + ni + ' IST' }, parsed: { done: parsedDone, ts: parsedDone ? '22 Nov 2025, 04:2' + ni + ' IST' : null }, settled: { done: settledDone, ts: settledDone ? '22 Nov 2025, 06:0' + ni + ' IST' : null } };
        } else {
          states[net.key] = { authorized: { done: true }, parsed: { done: true }, settled: { done: true } };
        }
      });

      var status = isToday ? 'In Progress' : (hasBreak ? 'Break' : (provisional ? 'Provisional' : (hasRej ? 'Under Investigation' : 'Clean')));

      return {
        id: 'ops-cyc-' + tenant.id + '-' + date,
        tenantId: tenant.id, date: date, dow: U.DOW[wd], currency: tenant.currency, isToday: isToday,
        status: status, legs: legs, states: states,
        // one outgoing clearing batch per cycle; incoming aggregated across six
        outgoingBatches: 1,
        incomingCycles: incomingCycles, incomingReceived: arrived, incomingTotal: 6,
        provisional: provisional, expectedFullSettlement: fullSettle,
        submitted: round2(subTotal), settled: setTotal,
        interchange: icTotal, scheme: schemeTotal, adjustments: round2(adjTotal + rejTotal), rejectionHoldback: rejTotal,
        expectedDelta: expectedDelta, residual: residual, hasBreak: hasBreak, brk: brk,
        rejections: rejections, corrections: corrections, hasRej: hasRej, hasCorr: hasCorr
      };
    });
  }
  var cyclesByTenant = {}, currentCycleByTenant = {};
  tenants.forEach(function (t) {
    var cs = buildCycles(t);
    cyclesByTenant[t.id] = cs;
    currentCycleByTenant[t.id] = cs[cs.length - 1]; // today, in progress
  });
  function settledCycles(tenantId) { return cyclesByTenant[tenantId].filter(function (c) { return !c.isToday; }).slice().reverse(); }
  // default recon: first tenant (in order) with an open break, else hsbc-in
  var defaultRecon = (function () {
    for (var i = 0; i < tenants.length; i++) {
      var brk = settledCycles(tenants[i].id).find(function (c) { return c.hasBreak; });
      if (brk) return { tenantId: tenants[i].id, cycleId: brk.id };
    }
    var c = settledCycles('hsbc-in')[0];
    return { tenantId: 'hsbc-in', cycleId: c.id };
  })();

  /* ---- Settlement files ---------------------------------------------------
     Deliberately not modelled here any more. Settlement files are acquirer
     artifacts with no network dimension (refinement round 2 §C.1), so they
     live in files-data.js (window.SFILES), keyed tenant × cycle date × file
     type and driven by a per-acquirer file type registry. */

  /* ---- Cross-tenant disputes (~40) --------------------------------------- */
  var STAGES = ['First Chargeback', 'Second Presentment', 'Arbitration', 'Pre-Arb'];
  var DSTATUS = ['Action Required', 'In Representment', 'Awaiting Network', 'Won', 'Lost'];
  var disputes = [];
  for (var di = 0; di < 40; di++) {
    var dr = rng(66000 + di * 19);
    var tenant = pick(dr, tenants);
    var merchant = pick(dr, merchantsByTenant[tenant.id]);
    var nk = pick(dr, ['visa', 'mc', 'rupay']);
    var codes = nk === 'visa' ? D.VISA_CODES : (nk === 'mc' ? D.MC_CODES : [['4837', 'No Cardholder Authorization'], ['4855', 'Goods or Services Not Provided']]);
    var code = pick(dr, codes);
    var stage = pick(dr, STAGES);
    var amt = round2(tenant.currency === 'INR' ? 800 + dr() * 66000 : 40 + dr() * 2400);
    var recOffset = rint(dr, 2, 50);
    var received = U.addDays(TODAY, -recOffset);
    var ddl = di < 6 ? rint(dr, 1, 6) : rint(dr, 8, 55);
    var deadline = U.addDays(TODAY, ddl);
    var status = di < 6 ? 'Action Required' : pick(dr, DSTATUS);
    disputes.push({
      id: 'DSP-' + String(30100 + di), arn: maskArn(dr), tenantId: tenant.id,
      merchant: merchant.name, merchantId: merchant.id, networkKey: nk, network: NET_BY_KEY[nk].name,
      stage: stage, reasonCode: code[0], reasonDesc: code[1], amount: amt, currency: tenant.currency,
      received: received, deadline: deadline, deadlineDays: ddl, status: status,
      txnDate: U.addDays(received, -rint(dr, 20, 40)), bin: '4' + rint(dr, 10000, 99999) + '••••••' + rint(dr, 1000, 9999),
      authCode: String(rint(dr, 100000, 999999)),
      timeline: [
        { stage: 'First Chargeback', date: received, amount: amt, done: true },
        { stage: 'Representment', date: U.addDays(received, rint(dr, 5, 12)), amount: amt, done: stage !== 'First Chargeback' },
        { stage: 'Second Presentment', date: U.addDays(received, rint(dr, 15, 25)), amount: amt, done: stage === 'Second Presentment' || stage === 'Arbitration' },
        { stage: 'Arbitration', date: U.addDays(received, rint(dr, 30, 45)), amount: amt, done: stage === 'Arbitration' }
      ],
      bankNotes: [
        { at: U.prettyDate(received) + ', 10:22 IST', by: 'bank ops', text: 'Chargeback received from ' + NET_BY_KEY[nk].name + ' incoming file.' }
      ],
      opsNotes: [
        { at: U.prettyDate(U.addDays(received, 1)) + ', 12:05 IST', by: 'juspay-ops', text: 'Verified ARN against clearing records — matches submitted batch. Advised tenant to gather compelling evidence.' }
      ]
    });
  }
  var disputeById = {}; disputes.forEach(function (d) { disputeById[d.id] = d; });

  /* ---- Holidays: India (reuse) + Singapore + Hong Kong ------------------- */
  var sgHolidays = [
    { date: '2025-12-25', name: 'Christmas Day', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-01-01', name: "New Year's Day", country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-02-17', name: 'Chinese New Year', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-02-18', name: 'Chinese New Year (2nd day)', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-04-03', name: 'Good Friday', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-03-21', name: 'Hari Raya Puasa', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-05-01', name: 'Labour Day', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-05-31', name: 'Vesak Day', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-05-27', name: 'Hari Raya Haji', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-08-09', name: 'National Day', country: 'Singapore', impact: 'Full holiday' },
    { date: '2026-11-08', name: 'Deepavali', country: 'Singapore', impact: 'Full holiday' }
  ];
  var hkHolidays = [
    { date: '2025-12-25', name: 'Christmas Day', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2025-12-26', name: 'Boxing Day', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-01-01', name: "New Year's Day", country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-02-17', name: 'Lunar New Year', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-02-18', name: 'Lunar New Year (2nd day)', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-02-19', name: 'Lunar New Year (3rd day)', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-04-06', name: 'Ching Ming Festival', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-04-03', name: 'Good Friday', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-05-25', name: "Buddha's Birthday", country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-07-01', name: 'HKSAR Establishment Day', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-10-01', name: 'National Day', country: 'Hong Kong', impact: 'Full holiday' },
    { date: '2026-09-26', name: 'Mid-Autumn Festival', country: 'Hong Kong', impact: 'Half day' }
  ];
  // one full holiday inside the default File-Monitoring window (18 Nov) so the
  // "Not expected — holiday" pattern is visible on the default view
  var extraHolidays = [{ date: '2025-11-18', name: 'Special Bank Holiday (RBI)', country: 'India', impact: 'Full holiday' }];
  var combinedHolidays = D.holidays.concat(sgHolidays).concat(hkHolidays).concat(extraHolidays).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  /* ---- Onboarding tenant list (core 4 + provisioning + suspended) -------- */
  var onboardingTenants = tenants.map(function (t, i) {
    return {
      id: t.id, name: t.name, country: t.country, currency: t.currency, color: t.color, flag: t.flag,
      status: 'Active', onboarded: ['2019-03-12', '2018-07-01', '2020-11-20', '2021-05-04'][i],
      networks: t.id === 'hsbc-in' || t.id === 'yesbank' ? ['Visa', 'Mastercard', 'RuPay', 'HSBC ONUS'] : ['Visa', 'Mastercard'],
      legalName: t.name + ' Limited', contact: 'ops-liaison' + FC_EMAILS[t.id], address: t.region + ' data region',
      settleAcct: '****' + (4210 + i), ruleSet: 'RULESET-' + t.country.slice(0, 2).toUpperCase() + '-STD-v3',
      bins: t.id === 'hsbc-in' ? '4571xx, 5412xx, 6073xx' : t.id === 'yesbank' ? '4098xx, 5241xx, 6521xx' : t.id === 'hsbc-sg' ? '4762xx, 5581xx' : '4033xx, 5432xx'
    };
  }).concat([
    { id: 'kotak', name: 'Kotak Mahindra Bank', country: 'India', currency: 'INR', color: '#0EA5E9', flag: '🇮🇳', status: 'Provisioning', onboarded: U.addDays(TODAY, -4), networks: ['Visa', 'Mastercard', 'RuPay'], legalName: 'Kotak Mahindra Bank Ltd', contact: 'onboarding@kotak.com', address: 'ap-south-1 data region', settleAcct: '****9921', ruleSet: 'RULESET-IN-STD-v3', bins: '4181xx, 5567xx' },
    { id: 'dbs-sg', name: 'DBS - Singapore', country: 'Singapore', currency: 'SGD', color: '#F59E0B', flag: '🇸🇬', status: 'Provisioning', onboarded: U.addDays(TODAY, -9), networks: ['Visa', 'Mastercard'], legalName: 'DBS Bank Ltd', contact: 'acquiring@dbs.com.sg', address: 'ap-southeast-1 data region', settleAcct: '****3310', ruleSet: 'RULESET-SG-STD-v2', bins: '4147xx, 5423xx' },
    { id: 'icici', name: 'ICICI Bank', country: 'India', currency: 'INR', color: '#64748B', flag: '🇮🇳', status: 'Suspended', onboarded: '2022-02-18', networks: ['Visa', 'Mastercard', 'RuPay'], legalName: 'ICICI Bank Ltd', contact: 'merchant.ops@icici.com', address: 'ap-south-1 data region', settleAcct: '****7745', ruleSet: 'RULESET-IN-STD-v2', bins: '4375xx, 5241xx' }
  ]);
  var onboardingById = {}; onboardingTenants.forEach(function (t) { onboardingById[t.id] = t; });
  // config history per tenant (immutable, with a correction pair)
  var configHistory = {};
  onboardingTenants.forEach(function (t, i) {
    var r = rng(77000 + i * 23);
    var ev = [
      { kind: 'normal', at: U.prettyDate(t.onboarded) + ', 10:00 IST', by: 'juspay-ops', text: 'Tenant provisioned — data region ' + t.address + '.' },
      { kind: 'normal', at: '14 Aug 2025, 11:20 IST', by: 'juspay-ops', text: 'Enabled networks: ' + t.networks.join(', ') + '.' },
      { kind: 'nullified', at: '02 Sep 2025, 15:31 IST', by: 'juspay-ops', text: 'Network rule set assigned: RULESET-XX-STD-v1 (deprecated).' },
      { kind: 'correction', at: '02 Sep 2025, 15:44 IST', by: 'juspay-ops', text: 'Network rule set corrected to ' + t.ruleSet + ' — prior version was end-of-life.', reason: 'Rule set v1 retired; re-pointed to the current standard rule set.' }
    ];
    configHistory[t.id] = ev.reverse();
  });

  /* ---- Cross-tenant KPIs / Ops Home aggregates --------------------------- */
  var totalMtdINR = 0;
  tenants.forEach(function (t) { merchantsByTenant[t.id].forEach(function (m) { totalMtdINR += toINR(m.mtdVolume, t.currency); }); });
  var pendingApprovals = feeApprovals.filter(function (a) { return a.status === 'Pending'; }).length;
  var openDisputes = disputes.filter(function (d) { return d.status !== 'Won' && d.status !== 'Lost'; }).length;

  // unresolved rejections per tenant (from most recent rej cycles awaiting/recleared)
  var rejByTenant = {};
  var rejTotalINR = 0, rejTotalCount = 0;
  tenants.forEach(function (t) {
    var cnt = 0, amt = 0;
    settledCycles(t.id).forEach(function (c) {
      if (c.hasRej && (c.rejections[0].status !== 'Settled')) {
        c.rejections.forEach(function (rj) { cnt += 1; amt += rj.amount; });
      }
    });
    rejByTenant[t.id] = { count: cnt, amount: round2(amt), currency: t.currency };
    rejTotalINR += toINR(amt, t.currency); rejTotalCount += cnt;
  });

  /* Month-to-date transaction count across all tenants (Part 2.2 KPI #2).
     Built from a per-day series so the card's sparkline is the same data the
     headline number totals — weekends dip, the month builds. */
  var txnSeries = (function () {
    var r = rng(211069), out = [], mtdStart = TODAY.slice(0, 8) + '01';
    for (var d = mtdStart; d <= TODAY; d = U.addDays(d, 1)) {
      var wd = U.fromYmd(d).getUTCDay();
      var weekend = (wd === 0 || wd === 6) ? 0.72 : 1;   // seeded to total 3,42,18,904 MTD (Part 7.3)
      out.push(Math.round((1560000 + r() * 340000) * weekend));
    }
    return out;
  })();
  var totalTxnsMTD = txnSeries.reduce(function (s, v) { return s + v; }, 0);

  // tenant health for status strip
  function tenantHealth(t) {
    var pend = feeApprovals.filter(function (a) { return a.status === 'Pending' && a.tenantId === t.id; }).length;
    var cur = currentCycleByTenant[t.id];
    var inProg = Object.keys(cur.states).some(function (k) { return !cur.states[k].settled.done; });
    var recentBreak = settledCycles(t.id).slice(0, 2).some(function (c) { return c.hasBreak; }); // only a break in the last 2 cycles is "active"
    if (recentBreak) return { text: 'Reconciliation break', kind: 'danger', goto: '#/dashboard/ops/reconciliation', set: 'reconTenant:' + t.id };
    if (inProg) return { text: 'Cycle in progress', kind: 'info', goto: '#/dashboard/ops/reconciliation', set: 'reconTenant:' + t.id };
    if (pend > 0) return { text: pend + ' fee approval' + (pend > 1 ? 's' : '') + ' pending', kind: 'warning', goto: '#/dashboard/ops/approvals', set: 'approvalsTenant:' + t.id + ';approvalTab:pending' };
    return { text: 'Nominal', kind: 'success', goto: '#/dashboard/ops/reconciliation', set: 'reconTenant:' + t.id };
  }

  return {
    tenants: tenants, tenantById: tenantById, rates: rates, toINR: toINR,
    merchantsByTenant: merchantsByTenant, allMerchants: allMerchants, merchantById: merchantById,
    NETWORKS: NETWORKS, NET_BY_KEY: NET_BY_KEY,
    feeApprovals: feeApprovals,
    cyclesByTenant: cyclesByTenant, currentCycleByTenant: currentCycleByTenant, settledCycles: settledCycles, defaultRecon: defaultRecon,
    disputes: disputes, disputeById: disputeById,
    holidays: combinedHolidays,
    onboardingTenants: onboardingTenants, onboardingById: onboardingById, configHistory: configHistory,
    ruleKey: ruleKey,
    kpis: { activeTenants: 4, totalMtdINR: totalMtdINR, totalTxnsMTD: totalTxnsMTD, txnSeries: txnSeries, pendingApprovals: pendingApprovals, openDisputes: openDisputes, rejTotalINR: round2(rejTotalINR), rejTotalCount: rejTotalCount, rejByTenant: rejByTenant },
    tenantHealth: tenantHealth,
    util: U
  };
})();
