/* =============================================================================
   Juspay Bank Portal — Mock Data (deterministic)
   Tenant: HSBC IN :: ap-south-1  |  Demo "today" = Friday, 21 November 2025
   All numbers are raw; formatting/grouping happens at render time in app.js.
   ============================================================================= */
window.DATA = (function () {
  'use strict';

  /* ---- Deterministic PRNG (mulberry32) ------------------------------------ */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rint(r, a, b) { return Math.floor(a + r() * (b - a + 1)); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---- Date helpers (no Date.now used for data — fixed demo timeline) ------ */
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ymd(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function fromYmd(s) { const p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { const d = fromYmd(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function dow(s) { return DOW[fromYmd(s).getUTCDay()]; }
  function prettyDate(s) { const d = fromYmd(s); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function prettyLong(s) { const d = fromYmd(s); return DOW[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

  const TODAY = '2025-11-21';

  /* ---- Tenant / user ------------------------------------------------------ */
  const tenant = { name: 'HSBC IN', region: 'ap-south-1', country: 'India', currency: 'INR', flag: '🌐' };
  const user = { name: 'Priya', fullName: 'Priya Nair', email: 'priya.nair@hsbc.co.in', role: 'Reconciliation Analyst' };

  /* ---- MCC catalogue ------------------------------------------------------ */
  const MCC = {
    '5411': 'Grocery Stores', '5812': 'Restaurants', '4511': 'Airlines',
    '5732': 'Electronics', '5999': 'Miscellaneous Retail', '7011': 'Hotels',
    '5311': 'Department Stores', '5651': 'Family Clothing', '5941': 'Sporting Goods',
    '7999': 'Entertainment'
  };

  /* ---- Networks ----------------------------------------------------------- */
  const NETWORKS = [
    { key: 'visa', name: 'Visa', short: 'Visa', color: '#2563EB', share: 0.40, ticket: 2150, ic: 0.0165, scheme: 0.0010, mdr: 0.0195 },
    { key: 'mc', name: 'Mastercard', short: 'MC', color: '#EAB308', share: 0.30, ticket: 2050, ic: 0.0165, scheme: 0.0010, mdr: 0.0190 },
    { key: 'rupay', name: 'RuPay', short: 'RuPay', color: '#22C55E', share: 0.22, ticket: 1450, ic: 0.0075, scheme: 0.0008, mdr: 0.0095 },
    { key: 'onus', name: 'HSBC ONUS', short: 'ONUS', color: '#8B5CF6', share: 0.08, ticket: 2600, ic: 0.0020, scheme: 0.0004, mdr: 0.0040 }
  ];
  const NET_BY_KEY = {}; NETWORKS.forEach(n => NET_BY_KEY[n.key] = n);

  /* ---- Merchants (exactly 25, named per Part 7.1) ------------------------- */
  const MERCHANT_SEED = [
    ['Croma - Phoenix Marketcity', '5732', 'large', 0.12, 'Tata Group'],
    ['Reliance Digital - Powai', '5732', 'large', 0.09, 'Reliance Retail'],
    ['Shoppers Stop - Palladium', '5311', 'large', 0.18, null],
    ['Titan - Inorbit Mall', '5999', 'mid', 0.15, 'Tata Group'],
    ['Westside - R City Mall', '5651', 'mid', 0.14, 'Tata Group'],
    ['FabIndia - Bandra', '5651', 'mid', 0.11, null],
    ['Blue Tokai - Colaba', '5812', 'small', 0.22, null],
    ['Barista - Nariman Point', '5812', 'small', 0.19, null],
    ['Café Coffee Day - Bandra West', '5812', 'mid', 0.24, null],
    ['Health & Glow - Powai', '5999', 'small', 0.16, null],
    ["Nature's Basket - Lower Parel", '5411', 'mid', 0.10, 'Reliance Retail'],
    ['Star Bazaar - Malad', '5411', 'mid', 0.08, 'Tata Group'],
    ['Foodhall - Palladium', '5411', 'mid', 0.13, null],
    ['Big Bazaar - Andheri', '5411', 'large', 0.07, null],
    ['Landmark - Infiniti Mall', '5999', 'mid', 0.17, 'Tata Group'],
    ['Zara - Phoenix Marketcity', '5651', 'large', 0.20, null],
    ['H&M - Palladium', '5651', 'mid', 0.21, null],
    ['Marks & Spencer - Palladium', '5311', 'mid', 0.15, null],
    ['Decathlon - Thane', '5941', 'large', 0.09, null],
    ["Lifestyle - Growel's 101", '5311', 'mid', 0.16, null],
    ['Taj Krishna - Colaba (Hotel)', '7011', 'large', 0.14, 'Tata Group'],
    ['IndiGo - BOM Terminal 2 (Airline)', '4511', 'large', 0.11, null],
    ['BookMyShow - Digital', '7999', 'large', 0.95, null],   // watchlist
    ['MakeMyTrip - Digital', '4511', 'large', 1.35, null],   // watchlist
    ['Bombay Electric - Colaba', '5651', 'small', 1.60, null] // watchlist + under review
  ];

  const TIER_DAILY = { small: [200000, 800000], mid: [1500000, 5000000], large: [10000000, 50000000] };
  const CONTACTS = ['Rahul Menon', 'Ananya Iyer', 'Vikram Shah', 'Sneha Kulkarni', 'Arjun Reddy', 'Divya Pillai', 'Karan Malhotra', 'Meera Joshi', 'Sanjay Rao', 'Nisha Verma'];
  const ENTITY_TYPES = ['Private Limited', 'Public Limited', 'LLP', 'Partnership'];

  const merchants = MERCHANT_SEED.map((m, i) => {
    const r = rng(1000 + i * 7);
    const idNum = 4471810000001 + i;
    const tier = m[2];
    const [lo, hi] = TIER_DAILY[tier];
    const daily = Math.round(lo + r() * (hi - lo));
    const mtdVolume = daily * 22 + Math.round((r() - 0.5) * daily * 6);
    const avgTicket = 900 + Math.round(r() * 2200);
    const mtdTxns = Math.round(mtdVolume / avgTicket);
    const status = (i === 24) ? 'Under Review' : (i === 8 ? 'Active' : 'Active');
    const cbHealthy = 0.05 + r() * 0.25;
    const chargebackPct = m[3] >= 0.8 ? m[3] : round2(cbHealthy);
    const onboardYear = 2019 + rint(r, 0, 6);
    const onboardMonth = rint(r, 1, 12);
    const onboardDay = rint(r, 1, 28);
    const onboarded = onboardYear + '-' + String(onboardMonth).padStart(2, '0') + '-' + String(onboardDay).padStart(2, '0');
    const enabledNets = ['visa', 'mc', 'rupay'].concat(r() > 0.55 ? ['onus'] : []);
    const legalSuffix = pick(r, ['Retail Pvt Ltd', 'India Pvt Ltd', 'Enterprises Pvt Ltd', 'Ventures Ltd', 'Commerce Pvt Ltd']);
    const nameCore = m[0].split(' - ')[0];
    return {
      id: 'm' + String(i + 1).padStart(2, '0'),
      name: m[0],
      mid: String(idNum).replace(/(\d{4})(\d{4})(\d{5})/, '$1 $2 $3'),
      midRaw: String(idNum),
      mcc: m[1],
      mccLabel: MCC[m[1]],
      tier: tier,
      status: status,
      parent: m[4],
      onboarded: onboarded,
      dailyVolume: daily,
      mtdVolume: Math.max(0, mtdVolume),
      mtdTxns: Math.max(0, mtdTxns),
      avgTicket: avgTicket,
      chargebackPct: chargebackPct,
      watchlist: chargebackPct >= 0.8,
      networks: enabledNets,
      terminals: rint(r, 2, 40),
      legalName: nameCore + ' ' + legalSuffix,
      entityType: pick(r, ENTITY_TYPES),
      taxId: 'GSTIN27' + String(rint(r, 100000000, 999999999)).slice(0, 9) + 'Z' + rint(r, 1, 9),
      address: pick(r, ['Ground Floor, ', 'Level 2, ', 'Shop ', 'Unit ']) + rint(r, 1, 220) + ', ' + m[0].split(' - ')[1].replace(' (Hotel)', '').replace(' (Airline)', '') + ', Mumbai, Maharashtra 400' + String(rint(r, 1, 99)).padStart(3, '0'),
      contact: pick(r, CONTACTS),
      contactEmail: pick(r, CONTACTS).toLowerCase().replace(' ', '.') + '@' + nameCore.toLowerCase().replace(/[^a-z]/g, '') + '.in',
      settleBank: 'HSBC India',
      settleAcct: '****' + rint(r, 1000, 9999),
      ifsc: 'HSBC0' + String(rint(r, 400001, 400099)),
      momGrowth: round2((r() - 0.4) * 24)
    };
  });
  const merchantById = {}; merchants.forEach(m => merchantById[m.id] = m);

  /* ---- Bank holidays (India) — ~15 across current + next year ------------- */
  const holidays = [
    { date: '2025-08-15', name: 'Independence Day', country: 'India', impact: 'Full holiday' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi', country: 'India', impact: 'Regional only' },
    { date: '2025-10-02', name: 'Gandhi Jayanti / Dussehra', country: 'India', impact: 'Full holiday' },
    { date: '2025-10-20', name: 'Diwali (Lakshmi Pujan)', country: 'India', impact: 'Full holiday' },
    { date: '2025-10-21', name: 'Diwali (Balipratipada)', country: 'India', impact: 'Half day' },
    { date: '2025-11-05', name: 'Guru Nanak Jayanti', country: 'India', impact: 'Full holiday' },
    { date: '2025-12-25', name: 'Christmas', country: 'India', impact: 'Full holiday' },
    { date: '2026-01-26', name: 'Republic Day', country: 'India', impact: 'Full holiday' },
    { date: '2026-03-04', name: 'Holi', country: 'India', impact: 'Full holiday' },
    { date: '2026-04-03', name: 'Good Friday', country: 'India', impact: 'Regional only' },
    { date: '2026-04-14', name: 'Ambedkar Jayanti', country: 'India', impact: 'Regional only' },
    { date: '2026-05-01', name: 'May Day', country: 'India', impact: 'Regional only' },
    { date: '2026-05-27', name: 'Eid-ul-Fitr', country: 'India', impact: 'Full holiday' },
    { date: '2026-08-15', name: 'Independence Day', country: 'India', impact: 'Full holiday' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', country: 'India', impact: 'Full holiday' }
  ];
  const holidayByDate = {}; holidays.forEach(h => { holidayByDate[h.date] = h; });

  /* ---- Rejection & dispute reason codes ----------------------------------- */
  const REJECT_CODES = [
    ['900', 'Invalid transaction date'],
    ['901', 'Invalid merchant category code'],
    ['902', 'Duplicate transaction reference'],
    ['903', 'Amount mismatch with authorization'],
    ['904', 'Missing required data element'],
    ['905', 'Invalid card number range']
  ];
  const VISA_CODES = [
    ['10.4', 'Other Fraud – Card Absent Environment'],
    ['11.3', 'No Authorization'],
    ['12.5', 'Incorrect Amount'],
    ['13.1', 'Merchandise / Services Not Received'],
    ['13.3', 'Not as Described or Defective'],
    ['13.6', 'Credit Not Processed']
  ];
  const MC_CODES = [
    ['4837', 'No Cardholder Authorization'],
    ['4853', 'Cardholder Dispute'],
    ['4855', 'Goods or Services Not Provided'],
    ['4863', 'Cardholder Does Not Recognize']
  ];
  const RUPAY_CODES = [
    ['4837', 'No Cardholder Authorization'],
    ['4855', 'Goods or Services Not Provided']
  ];

  /* ---- Settlement cycles (~46 days, per-network aggregates) ---------------- */
  // Timeline: 07 Oct 2025 → 21 Nov 2025. 21 Nov is the in-progress cycle.
  const cycleDates = [];
  for (let d = '2025-10-07'; d <= TODAY; d = addDays(d, 1)) cycleDates.push(d);

  const flags = {
    '2025-11-20': { rej: 'awaiting' },   // yesterday — rejections awaiting re-clearing
    '2025-11-19': { rej: 'recleared' },  // re-cleared, settling today
    '2025-11-18': { rej: 'settled' },    // full lifecycle complete
    '2025-11-14': { correction: true },
    '2025-11-11': { break: true },
    '2025-11-06': { correction: true }
  };

  function maskArn(r) {
    return '74' + rint(r, 100, 999) + '••••••' + rint(r, 1000, 9999);
  }

  function buildNetworkBlock(r, net, grossShareTotal, cycleDate, isToday, holidayImpact) {
    const gross = Math.round(grossShareTotal * net.share);
    const count = Math.round(gross / net.ticket);
    const interchange = round2(gross * net.ic);
    const scheme = round2(gross * net.scheme);
    const mdr = round2(gross * net.mdr);
    // baseline: no rejections
    const block = {
      key: net.key, name: net.name, color: net.color,
      count: count, gross: gross,
      rejCount: 0, rejAmount: 0,
      cleared: gross,
      interchange: interchange, scheme: scheme, mdr: mdr,
      netSettlement: round2(gross - interchange - scheme),
      actuallySettled: round2(gross - interchange - scheme),
      delta: 0,
      states: {}
    };
    // three-state timeline timestamps
    const proc = 2 + Math.floor(r() * 4); // 2-6 AM
    const inc = 3 + Math.floor(r() * 4);  // 3-7 AM
    const authTs = prettyDate(cycleDate) + ', ' + String(23).padStart(2, '0') + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST';
    const parseTs = prettyDate(addDays(cycleDate, 1)) + ', ' + String(inc).padStart(2, '0') + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST';
    const setTs = prettyDate(addDays(cycleDate, 1)) + ', ' + String(proc + 4).padStart(2, '0') + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST';
    if (isToday) {
      // mixed states across networks handled by caller; default authorized only
      block.states = {
        authorized: { done: true, ts: authTs },
        parsed: { done: false, ts: null },
        settled: { done: false, ts: null }
      };
    } else {
      block.states = {
        authorized: { done: true, ts: authTs },
        parsed: { done: true, ts: parseTs },
        settled: { done: true, ts: setTs }
      };
    }
    return block;
  }

  const cycles = cycleDates.map((date, ci) => {
    const r = rng(50000 + ci * 13);
    const wd = fromYmd(date).getUTCDay();
    const isWeekend = (wd === 0 || wd === 6);
    const isToday = date === TODAY;
    const holiday = holidayByDate[date] || null;
    const flag = flags[date] || {};

    // base daily gross across whole portfolio, weekend/holiday dampened
    let base = 38000000 + r() * 20000000; // 3.8cr - 5.8cr
    if (isWeekend) base *= 0.72;
    if (holiday && holiday.impact === 'Full holiday') base *= 0.28;
    if (holiday && holiday.impact === 'Half day') base *= 0.6;

    const nets = {};
    NETWORKS.forEach(net => { nets[net.key] = buildNetworkBlock(r, net, base, date, isToday, holiday ? holiday.impact : null); });

    // Today's mixed states (mid-cycle)
    if (isToday) {
      nets.visa.states = { authorized: { done: true, ts: prettyDate(date) + ', 23:12 IST' }, parsed: { done: true, ts: '22 Nov 2025, 04:18 IST' }, settled: { done: true, ts: '22 Nov 2025, 06:02 IST' } };
      nets.mc.states = { authorized: { done: true, ts: prettyDate(date) + ', 23:20 IST' }, parsed: { done: true, ts: '22 Nov 2025, 04:40 IST' }, settled: { done: false, ts: null } };
      nets.rupay.states = { authorized: { done: true, ts: prettyDate(date) + ', 23:31 IST' }, parsed: { done: false, ts: null }, settled: { done: false, ts: null } };
      nets.onus.states = { authorized: { done: true, ts: prettyDate(date) + ', 23:44 IST' }, parsed: { done: false, ts: null }, settled: { done: false, ts: null } };
      // settlement not yet posted for pending networks
      nets.mc.actuallySettled = 0; nets.mc.delta = round2(0 - nets.mc.netSettlement);
      nets.rupay.actuallySettled = 0; nets.rupay.delta = round2(0 - nets.rupay.netSettlement);
      nets.onus.actuallySettled = 0; nets.onus.delta = round2(0 - nets.onus.netSettlement);
    }

    // ---- Rejections lifecycle -------------------------------------------
    const rejections = [];
    if (flag.rej) {
      const stageMap = {
        awaiting: { status: 'Awaiting re-clearing', reclear: addDays(date, 1), settle: addDays(date, 2) },
        recleared: { status: 'Re-cleared', reclear: addDays(date, 1), settle: addDays(date, 2) },
        settled: { status: 'Settled', reclear: addDays(date, 1), settle: addDays(date, 2) }
      };
      const st = stageMap[flag.rej];
      const nRej = rint(r, 8, 16);
      const rejNetKeys = ['visa', 'mc', 'rupay'];
      for (let k = 0; k < nRej; k++) {
        const nk = pick(r, rejNetKeys);
        const code = pick(r, REJECT_CODES);
        const amt = round2(1200 + r() * 42000);
        rejections.push({
          network: NET_BY_KEY[nk].name,
          networkKey: nk,
          arn: maskArn(r),
          amount: amt,
          reasonCode: code[0],
          reasonDesc: code[1],
          receivedOn: date,
          reclearOn: st.reclear,
          settleOn: st.settle,
          status: st.status,
          expectedSettlement: st.settle
        });
      }
      // deduct rejected amounts from affected networks (same-day settlement holdback)
      rejections.forEach(rj => {
        const b = nets[rj.networkKey];
        b.rejCount += 1;
        b.rejAmount = round2(b.rejAmount + rj.amount);
        b.cleared = round2(b.gross - b.rejAmount);
        b.netSettlement = round2(b.cleared - b.interchange - b.scheme);
        if (flag.rej === 'settled') {
          b.actuallySettled = b.netSettlement; b.delta = 0;
        } else {
          // holdback: settled reflects cleared-only; rejected not yet paid
          b.actuallySettled = b.netSettlement; b.delta = 0;
        }
      });
    }

    // ---- Delta break -----------------------------------------------------
    if (flag.break) {
      const b = nets.mc;
      const shortfall = round2(b.netSettlement * (0.06 + r() * 0.04));
      b.actuallySettled = round2(b.netSettlement - shortfall);
      b.delta = round2(b.actuallySettled - b.netSettlement);
    }

    // ---- Corrections -----------------------------------------------------
    const corrections = [];
    if (flag.correction) {
      const b = nets.rupay;
      const wrong = round2(b.scheme * (1.4 + r() * 0.3));
      corrections.push({
        network: 'RuPay',
        field: 'Scheme Fee',
        originalValue: wrong,
        correctedValue: b.scheme,
        nullifiedAt: prettyDate(addDays(date, 1)) + ', 09:14 IST',
        correctedAt: prettyDate(addDays(date, 1)) + ', 09:22 IST',
        reason: 'Scheme fee posted with incorrect rate table (v2024.3); re-posted with correct RuPay domestic rate.',
        by: 'settlement-engine / auto-recon'
      });
    }

    // ---- Totals ----------------------------------------------------------
    const totals = { count: 0, gross: 0, rejCount: 0, rejAmount: 0, cleared: 0, interchange: 0, scheme: 0, mdr: 0, netSettlement: 0, actuallySettled: 0, delta: 0 };
    NETWORKS.forEach(net => {
      const b = nets[net.key];
      totals.count += b.count; totals.gross += b.gross; totals.rejCount += b.rejCount; totals.rejAmount += b.rejAmount;
      totals.cleared += b.cleared; totals.interchange += b.interchange; totals.scheme += b.scheme; totals.mdr += b.mdr;
      totals.netSettlement += b.netSettlement; totals.actuallySettled += b.actuallySettled; totals.delta += b.delta;
    });
    Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });

    // status
    let status = 'Settled';
    if (isToday) status = 'In Progress';
    else if (flag.break) status = 'Break';
    else if (holiday && holiday.impact === 'Full holiday') status = 'Holiday';

    // settlement files
    const genBase = addDays(date, 1);
    const files = isToday ? [] : ['MPR', 'MPF', 'JV1', 'JV2'].map((t, fi) => ({
      name: 'HSBCIN_' + t + '_' + date.replace(/-/g, '') + '.' + (t === 'MPR' ? 'csv' : t === 'MPF' ? 'txt' : 'xml'),
      type: t,
      generatedAt: prettyDate(genBase) + ', 0' + (5 + fi % 2) + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST',
      checksum: 'sha256:' + Array.from({ length: 8 }, () => '0123456789abcdef'[rint(r, 0, 15)]).join('') + '…',
      size: (0.4 + r() * 6).toFixed(1) + ' MB'
    }));

    return {
      id: 'cyc-' + date,
      date: date,
      dow: dow(date),
      holiday: holiday,
      status: status,
      isToday: isToday,
      networks: nets,
      totals: totals,
      rejections: rejections,
      corrections: corrections,
      files: files,
      hasRejections: rejections.length > 0,
      hasCorrections: corrections.length > 0,
      hasBreak: !!flag.break
    };
  });
  const cycleById = {}; cycles.forEach(c => cycleById[c.id] = c);
  const cyclesDesc = cycles.slice().reverse();

  // 7-cycle spark per network (netSettlement) for a given cycle index
  function networkSpark(cycleIndex, netKey) {
    const out = [];
    for (let i = Math.max(0, cycleIndex - 7); i <= cycleIndex; i++) out.push(cycles[i].networks[netKey].netSettlement);
    return out;
  }

  /* ---- Disputes (~40) ----------------------------------------------------- */
  const STAGES = ['First Chargeback', 'Second Presentment', 'Arbitration', 'Pre-Arb'];
  const DISPUTE_STATUS = ['Action Required', 'In Representment', 'Awaiting Network', 'Won', 'Lost'];
  const disputes = [];
  for (let i = 0; i < 40; i++) {
    const r = rng(90000 + i * 17);
    const merchant = pick(r, merchants);
    const netKey = pick(r, ['visa', 'mc', 'rupay']);
    const codes = netKey === 'visa' ? VISA_CODES : (netKey === 'mc' ? MC_CODES : RUPAY_CODES);
    const code = pick(r, codes);
    const stage = pick(r, STAGES);
    const amount = round2(800 + r() * 68000);
    const receivedOffset = rint(r, 2, 55);
    const received = addDays(TODAY, -receivedOffset);
    // deadline urgency mix: 3 within 48h
    let deadlineOffset;
    if (i < 3) deadlineOffset = rint(r, 1, 2);
    else if (i < 8) deadlineOffset = rint(r, 3, 6);
    else deadlineOffset = rint(r, 8, 60);
    const deadline = addDays(TODAY, deadlineOffset);
    let status;
    if (i < 3) status = 'Action Required';
    else if (i < 8) status = pick(r, ['Action Required', 'In Representment']);
    else status = pick(r, DISPUTE_STATUS);
    const cycleForImpact = pick(r, cycles.slice(0, cycles.length - 5));
    const bin = '4' + rint(r, 10000, 99999) + '••••••' + rint(r, 1000, 9999);
    // lifecycle timeline
    const timeline = [
      { stage: 'First Chargeback', date: received, amount: amount, done: true },
      { stage: 'Representment', date: addDays(received, rint(r, 5, 12)), amount: amount, done: stage !== 'First Chargeback' },
      { stage: 'Second Presentment', date: addDays(received, rint(r, 15, 25)), amount: amount, done: stage === 'Second Presentment' || stage === 'Arbitration' },
      { stage: 'Arbitration', date: addDays(received, rint(r, 30, 45)), amount: amount, done: stage === 'Arbitration' }
    ];
    disputes.push({
      id: 'DSP-' + String(20250 + i),
      idShort: 'DSP-' + String(20250 + i),
      arn: maskArn(r),
      merchantId: merchant.id,
      merchant: merchant.name,
      networkKey: netKey,
      network: NET_BY_KEY[netKey].name,
      stage: stage,
      reasonCode: code[0],
      reasonDesc: code[1],
      amount: amount,
      received: received,
      deadline: deadline,
      deadlineDays: deadlineOffset,
      status: status,
      txnDate: addDays(received, -rint(r, 20, 40)),
      bin: bin,
      authCode: String(rint(r, 100000, 999999)),
      cycleId: cycleForImpact.id,
      cycleDate: cycleForImpact.date,
      timeline: timeline,
      partialDefense: false,
      notes: [
        { at: prettyDate(received) + ', 10:22 IST', by: 'system', text: 'Chargeback received from ' + NET_BY_KEY[netKey].name + ' incoming file.' },
        { at: prettyDate(addDays(received, 1)) + ', 15:40 IST', by: user.fullName, text: 'Assigned for review. Requested transaction evidence from merchant.' }
      ]
    });
  }
  const disputeById = {}; disputes.forEach(d => disputeById[d.id] = d);

  /* ---- Fee configs (active rules per merchant) ---------------------------- */
  const CARD_TYPES = ['Credit', 'Debit'];
  const REGIONS = ['Domestic', 'Intra-regional', 'Cross-border'];
  const TXN_TYPES = ['Sale', 'Sale', 'Sale', 'Recurring'];
  function ruleFor(r, merchant, net, cardType, region) {
    let ic, mdr, scheme;
    if (region === 'Cross-border') { ic = 2.20 + r() * 0.6; mdr = 2.75 + r() * 0.45; scheme = 0.12; }
    else if (net.key === 'rupay') { ic = 0.60 + r() * 0.3; mdr = 0.80 + r() * 0.3; scheme = 0.08; }
    else if (net.key === 'onus') { ic = 0.20; mdr = 0.40; scheme = 0.04; }
    else if (cardType === 'Debit') { ic = 0.90; mdr = 1.00 + r() * 0.20; scheme = 0.08; }
    else { ic = 1.65; mdr = 1.80 + r() * 0.30; scheme = 0.10; }
    return {
      network: net.name, networkKey: net.key,
      cardType: cardType, region: region,
      txnType: pick(r, TXN_TYPES),
      mccBucket: merchant.mcc + ' · ' + merchant.mccLabel,
      pct: round2(mdr),
      interchange: round2(ic),
      scheme: round2(scheme),
      fixed: net.key === 'rupay' ? 0 : (cardType === 'Debit' ? 1 : 2),
      cap: region === 'Cross-border' ? 0 : (cardType === 'Debit' ? 30 : 0),
      effectiveSince: merchant.onboarded
    };
  }
  const feeConfigs = {}; // merchantId -> [rules]
  merchants.forEach((m, i) => {
    const r = rng(70000 + i * 11);
    const rules = [];
    m.networks.forEach(nk => {
      const net = NET_BY_KEY[nk];
      rules.push(ruleFor(r, m, net, 'Credit', 'Domestic'));
      rules.push(ruleFor(r, m, net, 'Debit', 'Domestic'));
      if (nk === 'visa' || nk === 'mc') rules.push(ruleFor(r, m, net, 'Credit', 'Cross-border'));
    });
    feeConfigs[m.id] = rules;
  });

  /* ---- Fee config approvals (~15, maker-checker states) ------------------- */
  const FC_STATES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected'];
  const REASONS = [
    'Aligning MDR with renegotiated merchant contract effective next quarter.',
    'Passing through Visa scheme fee revision (bulletin 2025-11).',
    'Introducing cross-border tier for the merchant’s new intl. acquiring.',
    'Correcting debit MDR that was set above regulatory cap.',
    'Volume-based discount as merchant crossed ₹50Cr quarterly GMV.'
  ];
  const feeApprovals = [];
  const stateDist = ['Under Review', 'Under Review', 'Rejected', 'Approved', 'Approved', 'Approved', 'Submitted', 'Draft', 'Draft', 'Approved', 'Under Review', 'Rejected', 'Approved', 'Submitted', 'Draft'];
  for (let i = 0; i < 15; i++) {
    const r = rng(80000 + i * 19);
    const merchant = pick(r, merchants);
    const status = stateDist[i];
    const submittedOffset = rint(r, 0, 40);
    const submittedAt = addDays(TODAY, -submittedOffset);
    const effective = addDays(TODAY, rint(r, 3, 30));
    const baseRule = feeConfigs[merchant.id][0];
    const proposed = Object.assign({}, baseRule, { pct: round2(baseRule.pct + (r() > 0.5 ? 0.15 : -0.12)) });
    feeApprovals.push({
      id: 'FC-' + String(4400 + i),
      merchantId: merchant.id,
      merchant: merchant.name,
      submittedBy: status === 'Draft' ? user.fullName : pick(r, [user.fullName, 'Rahul Menon', 'Ananya Iyer']),
      submittedAt: status === 'Draft' ? null : (prettyDate(submittedAt) + ', ' + String(rint(r, 9, 18)).padStart(2, '0') + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST'),
      submittedYmd: submittedAt,
      effective: effective,
      status: status,
      reason: pick(r, REASONS),
      rejectionReason: status === 'Rejected' ? pick(r, ['Proposed MDR exceeds board-approved ceiling for this MCC bucket. Resubmit within 1.85%.', 'Effective date conflicts with an in-flight scheme fee revision. Align dates and resubmit.']) : null,
      current: baseRule,
      proposed: proposed,
      network: baseRule.network,
      cardType: baseRule.cardType,
      changeType: proposed.pct > baseRule.pct ? 'increase' : 'decrease'
    });
  }

  /* ---- Change history per merchant (immutability pattern) ----------------- */
  const changeHistory = {};
  merchants.forEach((m, i) => {
    const r = rng(60000 + i * 23);
    const events = [];
    events.push({ type: 'status', at: prettyDate(m.onboarded) + ', 11:02 IST', by: user.fullName, text: 'Merchant onboarded — status set to Active.', kind: 'normal' });
    events.push({ type: 'profile', at: prettyDate(addDays(m.onboarded, 40)) + ', 16:20 IST', by: pick(r, CONTACTS), text: 'Updated primary contact and settlement account IFSC.', kind: 'normal' });
    events.push({ type: 'fee', at: '12 Aug 2025, 10:15 IST', by: 'Ananya Iyer', text: 'Fee config change approved — Visa Credit Domestic MDR 1.95% → 2.05%.', kind: 'normal' });
    // correction pattern on ~4 merchants (index 0,1,3,5) so it is visible
    if (i % 6 === 0 || i === 1 || i === 3) {
      const wrongAcct = '****' + rint(r, 1000, 9999);
      events.push({
        type: 'profile', kind: 'nullified',
        at: '02 Sep 2025, 14:31 IST', by: 'Rahul Menon',
        text: 'Settlement account updated to ' + wrongAcct + '.'
      });
      events.push({
        type: 'profile', kind: 'correction',
        at: '02 Sep 2025, 14:52 IST', by: 'Rahul Menon',
        text: 'Settlement account corrected to ' + m.settleAcct + ' — prior entry captured wrong account (typo during onboarding handoff).'
      });
    }
    changeHistory[m.id] = events.reverse();
  });

  /* ---- Users & Access ----------------------------------------------------- */
  const users = [
    { name: 'Priya Nair', email: 'priya.nair@hsbc.co.in', role: 'Reconciliation Analyst', lastLogin: '21 Nov 2025, 08:42 IST', status: 'Active' },
    { name: 'Rahul Menon', email: 'rahul.menon@hsbc.co.in', role: 'Merchant Ops Manager', lastLogin: '21 Nov 2025, 07:10 IST', status: 'Active' },
    { name: 'Ananya Iyer', email: 'ananya.iyer@hsbc.co.in', role: 'Program / Relationship Manager', lastLogin: '20 Nov 2025, 18:55 IST', status: 'Active' },
    { name: 'Vikram Shah', email: 'vikram.shah@hsbc.co.in', role: 'Bank Admin', lastLogin: '20 Nov 2025, 12:03 IST', status: 'Active' },
    { name: 'Sneha Kulkarni', email: 'sneha.kulkarni@hsbc.co.in', role: 'Reconciliation Analyst', lastLogin: '19 Nov 2025, 09:31 IST', status: 'Active' },
    { name: 'Arjun Reddy', email: 'arjun.reddy@hsbc.co.in', role: 'Merchant Ops Manager', lastLogin: '15 Nov 2025, 16:22 IST', status: 'Suspended' },
    { name: 'Divya Pillai', email: 'divya.pillai@hsbc.co.in', role: 'Program / Relationship Manager', lastLogin: '18 Nov 2025, 11:47 IST', status: 'Active' }
  ];
  const roleDefs = [
    { role: 'Merchant Ops Manager', can: 'Onboard merchants, edit profiles, submit fee config changes (maker).' },
    { role: 'Reconciliation Analyst', can: 'Daily reconciliation, cycle monitoring, dispute triage.' },
    { role: 'Program / Relationship Manager', can: 'Portfolio performance, merchant health, read-only fee configs.' },
    { role: 'Bank Admin', can: 'Manage users and permissions; cannot approve fee changes (checker is Juspay).' }
  ];
  const auditLog = [
    { at: '21 Nov 2025, 08:42 IST', who: 'Priya Nair', action: 'Viewed Cycle Detail 20 Nov 2025' },
    { at: '21 Nov 2025, 08:20 IST', who: 'Rahul Menon', action: 'Submitted fee config change FC-4407 for approval' },
    { at: '20 Nov 2025, 18:55 IST', who: 'Ananya Iyer', action: 'Exported Merchant Fee Report (Oct 2025)' },
    { at: '20 Nov 2025, 17:12 IST', who: 'Priya Nair', action: 'Added reconciliation note on cycle 18 Nov 2025' },
    { at: '20 Nov 2025, 12:03 IST', who: 'Vikram Shah', action: 'Suspended user arjun.reddy@hsbc.co.in' },
    { at: '19 Nov 2025, 15:40 IST', who: 'Priya Nair', action: 'Triaged dispute DSP-20251' },
    { at: '19 Nov 2025, 09:31 IST', who: 'Sneha Kulkarni', action: 'Downloaded MPR file for 18 Nov 2025' },
    { at: '18 Nov 2025, 16:00 IST', who: 'Rahul Menon', action: 'Updated merchant profile — Croma - Phoenix Marketcity' },
    { at: '18 Nov 2025, 10:11 IST', who: 'Ananya Iyer', action: 'Generated Dispute Summary report' },
    { at: '17 Nov 2025, 14:25 IST', who: 'Priya Nair', action: 'Logged in from ap-south-1' }
  ];

  /* ---- Reports library / schedules ---------------------------------------- */
  const reportTypes = ['Settlement Summary', 'Reconciliation Details', 'Fee Breakdown', 'Merchant Fee Report', 'Merchant Activity', 'Dispute Summary', 'Cycle Summary', 'Bank Holiday Calendar'];
  const reportLibrary = [];
  for (let i = 0; i < 14; i++) {
    const r = rng(30000 + i * 29);
    const type = pick(r, reportTypes);
    const fmt = pick(r, ['PDF', 'XLSX', 'CSV']);
    const gen = addDays(TODAY, -rint(r, 0, 40));
    reportLibrary.push({
      name: type + ' — ' + MON[fromYmd(gen).getUTCMonth()] + ' ' + fromYmd(gen).getUTCFullYear(),
      type: type,
      range: prettyDate(addDays(gen, -30)) + ' – ' + prettyDate(gen),
      generatedAt: prettyDate(gen) + ', ' + String(rint(r, 6, 20)).padStart(2, '0') + ':' + String(rint(r, 10, 59)).padStart(2, '0') + ' IST',
      generatedBy: pick(r, ['Priya Nair', 'Rahul Menon', 'Ananya Iyer', 'System (scheduled)']),
      format: fmt,
      size: (0.2 + r() * 8).toFixed(1) + ' MB',
      retention: pick(r, ['90 days', '1 year', '7 years'])
    });
  }
  const reportSchedules = [
    { name: 'Daily Settlement Summary', type: 'Settlement Summary', freq: 'Daily · 07:00 IST', recipients: 'recon-team@hsbc.co.in', lastRun: '21 Nov 2025, 07:00 IST', nextRun: '22 Nov 2025, 07:00 IST', status: 'Active' },
    { name: 'Weekly Fee Breakdown', type: 'Fee Breakdown', freq: 'Weekly · Mon 08:00 IST', recipients: 'finance@hsbc.co.in', lastRun: '17 Nov 2025, 08:00 IST', nextRun: '24 Nov 2025, 08:00 IST', status: 'Active' },
    { name: 'Monthly Merchant Fee Reports', type: 'Merchant Fee Report', freq: 'Monthly · 1st 06:00 IST', recipients: 'SFTP: /out/hsbcin/fees', lastRun: '01 Nov 2025, 06:00 IST', nextRun: '01 Dec 2025, 06:00 IST', status: 'Active' },
    { name: 'Dispute Deadline Digest', type: 'Dispute Summary', freq: 'Daily · 09:00 IST', recipients: 'disputes@hsbc.co.in', lastRun: '21 Nov 2025, 09:00 IST', nextRun: '22 Nov 2025, 09:00 IST', status: 'Paused' }
  ];

  /* ---- Portfolio + merchant daily series (deterministic generators) ------- */
  function portfolioDaily(days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(TODAY, -i);
      const c = cycleById['cyc-' + date];
      out.push({ date: date, value: c ? c.totals.gross : (40000000 + rng(i + 1)() * 15000000) });
    }
    return out;
  }
  function merchantDaily(mid, days, metric) {
    const m = merchantById[mid];
    const r = rng(m ? (parseInt(m.id.slice(1)) * 999 + (metric ? metric.length : 0)) : 1);
    const out = [];
    const base = m ? m.dailyVolume : 1000000;
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(TODAY, -i);
      const wd = fromYmd(date).getUTCDay();
      let v = base * (0.75 + r() * 0.5);
      if (wd === 0 || wd === 6) v *= 0.7;
      if (metric === 'txns') v = Math.round(v / (m ? m.avgTicket : 1500));
      else if (metric === 'approval') v = round2(95.5 + r() * 3.6);
      else if (metric === 'chargeback') v = round2((m ? m.chargebackPct : 0.2) * (0.6 + r() * 0.8));
      else v = Math.round(v);
      out.push({ date: date, value: v });
    }
    return out;
  }

  /* ---- Home KPIs ---------------------------------------------------------- */
  const activeMerchants = merchants.filter(m => m.status === 'Active').length;
  const mtdVolume = merchants.reduce((a, m) => a + m.mtdVolume, 0);
  const mtdTxns = merchants.reduce((a, m) => a + m.mtdTxns, 0);
  const mtdChargebackRatio = round2(merchants.reduce((a, m) => a + m.chargebackPct * m.mtdVolume, 0) / mtdVolume);

  /* ---- Public API --------------------------------------------------------- */
  return {
    TODAY: TODAY,
    tenant: tenant,
    user: user,
    MCC: MCC,
    NETWORKS: NETWORKS,
    NET_BY_KEY: NET_BY_KEY,
    merchants: merchants,
    merchantById: merchantById,
    holidays: holidays,
    holidayByDate: holidayByDate,
    cycles: cycles,
    cyclesDesc: cyclesDesc,
    cycleById: cycleById,
    networkSpark: networkSpark,
    disputes: disputes,
    disputeById: disputeById,
    feeConfigs: feeConfigs,
    feeApprovals: feeApprovals,
    changeHistory: changeHistory,
    users: users,
    roleDefs: roleDefs,
    auditLog: auditLog,
    reportTypes: reportTypes,
    reportLibrary: reportLibrary,
    reportSchedules: reportSchedules,
    REJECT_CODES: REJECT_CODES,
    VISA_CODES: VISA_CODES,
    MC_CODES: MC_CODES,
    CARD_TYPES: CARD_TYPES,
    REGIONS: REGIONS,
    portfolioDaily: portfolioDaily,
    merchantDaily: merchantDaily,
    kpis: {
      activeMerchants: activeMerchants,
      mtdVolume: mtdVolume,
      mtdTxns: mtdTxns,
      mtdChargebackRatio: mtdChargebackRatio
    },
    util: { prettyDate: prettyDate, prettyLong: prettyLong, dow: dow, addDays: addDays, fromYmd: fromYmd, ymd: ymd, MON: MON, DOW: DOW }
  };
})();
