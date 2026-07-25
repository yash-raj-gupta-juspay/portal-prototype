/* =============================================================================
   Juspay Ops Portal — Platform Configs mock store (Phase 3 extension)
   Deterministic. No storage. Extends window.DATA / window.OPS.
   Shape per Part 9.2 of the build brief.
   ============================================================================= */
window.CFGDATA = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS;
  var TODAY = D.TODAY;                                   // 2025-11-21

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ts(ymd, hhmm) { return U.prettyDate(ymd) + ', ' + hhmm + ' IST'; }
  function ago(n) { return U.addDays(TODAY, -n); }

  /* ---- People ------------------------------------------------------------- */
  // The demo user. Self-approval is blocked for anything this identity submitted,
  // even after toggling the role selector to Checker (Part 3).
  var DEMO_USER = 'ops.analyst@juspay.in';
  var MAKERS = ['ops.analyst@juspay.in', 'rahul.menon@juspay.in', 'ananya.iyer@juspay.in', 'kiran.rao@juspay.in'];
  var CHECKERS = ['ops.checker@juspay.in', 'divya.shetty@juspay.in'];

  /* ---- Families ----------------------------------------------------------- */
  var FAMILIES = [
    { id: 'network-file', label: 'Network File Configs', short: 'Network', badge: 'nf', seg: 'network-files', icon: 'file-code', blurb: 'Layout and transform rules that produce outgoing clearing files for card networks.' },
    { id: 'settlement', label: 'Settlement Configs', short: 'Settlement', badge: 'st', seg: 'settlement', icon: 'calendar-clock', blurb: 'When settlement reports run, what they contain, and the fee rules applied.' },
    { id: 'incoming-parsing', label: 'Incoming Parsing Configs', short: 'Incoming', badge: 'ip', seg: 'incoming', icon: 'file-input', blurb: 'Rules that parse incoming files received from networks and acquirers.' }
  ];
  var familyById = {}; FAMILIES.forEach(function (f) { familyById[f.id] = f; });

  /* ---- Tenants (config keys map onto the Ops Portal tenant ids) ----------- */
  var TENANTS = [
    { key: 'hsbc_in', name: 'HSBC IN', opsId: 'hsbc-in', color: '#DB2777' },
    { key: 'hsbc_sg', name: 'HSBC SG', opsId: 'hsbc-sg', color: '#0891B2' },
    { key: 'hsbc_hk', name: 'HSBC HK', opsId: 'hsbc-hk', color: '#EA580C' },
    { key: 'yes_bank', name: 'YES BANK', opsId: 'yesbank', color: '#7C3AED' },
    // Not an onboarded Ops tenant yet — reuses the existing --chart-onus token.
    { key: 'hsbc_uk', name: 'HSBC UK', opsId: null, color: '#8B5CF6' }
  ];
  var tenantByKey = {}; TENANTS.forEach(function (t) { tenantByKey[t.key] = t; });

  /* ---- Networks (brand colours are existing chart tokens) ----------------- */
  var NETWORKS = [
    { key: 'visa', label: 'visa', color: '#2563EB' },
    { key: 'mastercard', label: 'mastercard', color: '#EAB308' },
    { key: 'rupay', label: 'rupay', color: '#22C55E' },
    { key: 'hsbc_onus', label: 'hsbc_onus', color: '#8B5CF6' },
    { key: 'worldpay', label: 'worldpay', color: '#64748B' }
  ];
  var netByKey = {}; NETWORKS.forEach(function (n) { netByKey[n.key] = n; });

  var REPORTS = ['MPR', 'MPF', 'JV1_FEE_DATE', 'JV2_FEE_DATE', 'JV1_NON_FEE_DATE', 'JV2_NON_FEE_DATE'];
  var SOURCES = ['visa_incoming', 'mastercard_incoming', 'rupay_incoming', 'acks', 'chargeback', 'aq_mer', 'preprocessor'];
  var TIMEZONES = ['Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong'];
  var TZ_COUNTRY = { 'Asia/Kolkata': 'India', 'Asia/Singapore': 'Singapore', 'Asia/Hong_Kong': 'Hong Kong' };

  /* ---- Known column catalogues (autocomplete sources) --------------------- */
  var SOURCE_COLUMNS = ['txn_metadata', 'order_metadata', 'payment_gateway_response', 'card_info', 'merchant_config', 'acquirer_response'];
  var TXN_COLUMNS = [
    'txn_id', 'txn_uuid', 'order_id', 'merchant_id', 'mid', 'terminal_id', 'txn_amount', 'settlement_amount',
    'currency', 'txn_date', 'settlement_date', 'auth_code', 'rrn', 'arn', 'card_type', 'card_network',
    'card_region', 'card_bin', 'card_last4', 'mcc', 'txn_type', 'txn_status', 'interchange_fee', 'scheme_fee',
    'mdr_amount', 'gst_amount', 'net_amount', 'batch_id', 'acquirer_ref_no', 'chargeback_flag'
  ];
  var INTERNAL_FIELDS = [
    'order_id', 'txn_id', 'merchant_id', 'amount', 'currency', 'txn_date', 'status', 'card_last4',
    'auth_code', 'rrn', 'arn', 'reason_code', 'dispute_amount', 'adjustment_type', 'net_amount', 'fee_amount'
  ];
  var CONDITIONS = ['EQ', 'IN', 'GTE', 'LTE', 'GT', 'LT', 'NEQ'];
  var FIELD_TYPES = ['N', 'AN'];
  var STATES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'INACTIVE', 'REJECTED'];

  /* =========================================================================
     Fixed-width layout helpers
     ========================================================================= */
  // packFields([[name, length, type, note?], ...]) → contiguous 1-indexed fields.
  function packFields(defs) {
    var pos = 1;
    return defs.map(function (d) {
      var f = { name: d[0], start: pos, length: d[1], type: d[2], note: d[3] || '' };
      pos += d[1];
      return f;
    });
  }
  function isFiller(f) { return /filler|reserved|unused|rfu/i.test(f.name || ''); }
  function fieldNames(body) {
    var out = [];
    (body.record_types || []).forEach(function (rt) {
      (rt.fields || []).forEach(function (f) { if (out.indexOf(f.name) < 0) out.push(f.name); });
    });
    if (body.layout && body.layout.fields) body.layout.fields.forEach(function (f) { if (out.indexOf(f.name) < 0) out.push(f.name); });
    return out;
  }

  /* ---- Visa TC05 — TCR0 (0500), 168 bytes, fully contiguous -------------- */
  var TC05_0500 = packFields([
    ['Transaction Code', 2, 'N', 'TC05'],
    ['Transaction Code Qualifier', 1, 'N', ''],
    ['Transaction Component Sequence Number', 1, 'N', ''],
    ['Account Number', 16, 'N', 'PAN'],
    ['Account Number Extension', 3, 'N', ''],
    ['Floor Limit Indicator', 1, 'AN', ''],
    ['CRS Exception File Indicator', 1, 'AN', ''],
    ['Positive Cardholder Auth Service', 1, 'AN', ''],
    ['Acquirer Reference Number', 23, 'N', 'ARN'],
    ['Acquirers Business ID', 8, 'N', 'BID'],
    ['Purchase Date', 4, 'N', 'MMDD'],
    ['Destination Amount', 12, 'N', ''],
    ['Destination Currency Code', 3, 'N', 'ISO 4217'],
    ['Source Amount', 12, 'N', ''],
    ['Source Currency Code', 3, 'N', 'ISO 4217'],
    ['Merchant Name', 25, 'AN', ''],
    ['Merchant City', 13, 'AN', ''],
    ['Merchant Country Code', 3, 'AN', ''],
    ['Merchant Category Code', 4, 'N', 'MCC'],
    ['Merchant ZIP', 5, 'AN', ''],
    ['Merchant State Province Code', 3, 'AN', ''],
    ['Requested Payment Service', 1, 'AN', ''],
    ['Usage Code', 1, 'AN', ''],
    ['Reason Code', 2, 'AN', ''],
    ['Settlement Flag', 1, 'AN', ''],
    ['Authorization Characteristics Indicator', 1, 'AN', ''],
    ['Authorization Code', 6, 'AN', ''],
    ['POS Terminal Capability', 1, 'N', ''],
    ['Reserved', 1, 'AN', 'declared filler'],
    ['Reimbursement Attribute', 1, 'AN', ''],
    ['Filler', 9, 'AN', 'declared filler']
  ]);
  /* ---- Visa TC05 — TCR1 (0501) addendum, 168 bytes ----------------------- */
  var TC05_0501 = packFields([
    ['Transaction Code', 2, 'N', 'TC05'],
    ['Transaction Code Qualifier', 1, 'N', ''],
    ['Transaction Component Sequence Number', 1, 'N', 'TCR1'],
    ['Account Number', 16, 'N', ''],
    ['Business Format Code', 2, 'AN', ''],
    ['Transaction Identifier', 15, 'N', ''],
    ['Authorized Amount', 12, 'N', ''],
    ['Authorization Currency Code', 3, 'N', ''],
    ['Authorization Response Code', 2, 'AN', ''],
    ['Validation Code', 4, 'AN', ''],
    ['Excluded Transaction Identifier Reason', 1, 'AN', ''],
    ['Filler', 109, 'AN', 'declared filler']
  ]);
  /* ---- Visa TC06 — 0600, 168 bytes --------------------------------------- */
  var TC06_0600 = packFields([
    ['Transaction Code', 2, 'N', 'TC06'],
    ['Transaction Code Qualifier', 1, 'N', ''],
    ['Transaction Component Sequence Number', 1, 'N', ''],
    ['Account Number', 16, 'N', ''],
    ['Acquirer Reference Number', 23, 'N', ''],
    ['Acquirers Business ID', 8, 'N', ''],
    ['Purchase Date', 4, 'N', ''],
    ['Destination Amount', 12, 'N', ''],
    ['Destination Currency Code', 3, 'N', ''],
    ['Message Reason Code', 4, 'N', ''],
    ['Chargeback Reference Number', 9, 'AN', ''],
    ['Documentation Indicator', 1, 'AN', ''],
    ['Member Message Text', 50, 'AN', ''],
    ['Special Condition Indicator', 2, 'AN', ''],
    ['Filler', 32, 'AN', 'declared filler']
  ]);
  /* ---- Mastercard IPM 1240 clearing — 200 bytes -------------------------- */
  var MC_1240 = packFields([
    ['Message Type Identifier', 4, 'N', '1240'],
    ['Primary Account Number', 19, 'N', ''],
    ['Processing Code', 6, 'N', ''],
    ['Transaction Amount', 12, 'N', ''],
    ['Settlement Amount', 12, 'N', ''],
    ['Cardholder Billing Amount', 12, 'N', ''],
    ['Transmission Date Time', 10, 'N', 'MMDDhhmmss'],
    ['Conversion Rate Settlement', 8, 'N', ''],
    ['System Trace Audit Number', 6, 'N', 'STAN'],
    ['Local Transaction Time', 6, 'N', 'hhmmss'],
    ['Local Transaction Date', 4, 'N', 'MMDD'],
    ['Settlement Date', 4, 'N', 'MMDD'],
    ['Merchant Category Code', 4, 'N', ''],
    ['Acquiring Institution Country Code', 3, 'N', ''],
    ['Point of Service Data Code', 12, 'AN', ''],
    ['Function Code', 3, 'N', ''],
    ['Message Reason Code', 4, 'N', ''],
    ['Acquirer Reference Data', 23, 'AN', ''],
    ['Approval Code', 6, 'AN', ''],
    ['Service Code', 3, 'N', ''],
    ['Card Acceptor Terminal ID', 8, 'AN', ''],
    ['Card Acceptor ID Code', 15, 'AN', ''],
    ['Currency Code Transaction', 3, 'N', ''],
    ['Currency Code Settlement', 3, 'N', ''],
    ['Filler', 10, 'AN', 'declared filler']
  ]);
  /* ---- RuPay NFS clearing — 180 bytes ------------------------------------ */
  var RUPAY_CLR = packFields([
    ['Record Type', 2, 'N', ''],
    ['Card Number', 19, 'N', ''],
    ['Transaction Amount', 12, 'N', ''],
    ['Transaction Date', 8, 'N', 'YYYYMMDD'],
    ['Transaction Time', 6, 'N', 'hhmmss'],
    ['Retrieval Reference Number', 12, 'AN', 'RRN'],
    ['Approval Code', 6, 'AN', ''],
    ['Acquirer Institution ID', 11, 'N', ''],
    ['Issuer Institution ID', 11, 'N', ''],
    ['Terminal ID', 8, 'AN', ''],
    ['Merchant ID', 15, 'AN', ''],
    ['Merchant Category Code', 4, 'N', ''],
    ['Transaction Type', 2, 'N', ''],
    ['Interchange Fee', 12, 'N', ''],
    ['Switching Fee', 12, 'N', ''],
    ['Settlement Amount', 12, 'N', ''],
    ['Response Code', 2, 'AN', ''],
    ['Filler', 26, 'AN', 'declared filler']
  ]);
  /* ---- HSBC ONUS clearing — 150 bytes ------------------------------------ */
  var ONUS_CLR = packFields([
    ['Record Identifier', 2, 'AN', ''],
    ['Account Number', 16, 'N', ''],
    ['Transaction Reference', 20, 'AN', ''],
    ['Transaction Amount', 12, 'N', ''],
    ['Currency Code', 3, 'N', ''],
    ['Posting Date', 8, 'N', 'YYYYMMDD'],
    ['Value Date', 8, 'N', 'YYYYMMDD'],
    ['Merchant Number', 15, 'AN', ''],
    ['Terminal Number', 8, 'AN', ''],
    ['Merchant Category Code', 4, 'N', ''],
    ['Authorization Code', 6, 'AN', ''],
    ['Onus Indicator', 1, 'AN', ''],
    ['Fee Amount', 12, 'N', ''],
    ['Net Settlement Amount', 12, 'N', ''],
    ['Filler', 23, 'AN', 'declared filler']
  ]);
  /* ---- Worldpay clearing DRAFT — deliberately broken (overlap + gap) -----
     This is the layout the byte-map ruler is meant to catch before submit
     (user story C01): "Merchant Name" overlaps "Merchant City" by 5 bytes and
     bytes 121–130 are an unexplained gap. Record length says 160.           */
  var WORLDPAY_CLR = (function () {
    var f = packFields([
      ['Record Type', 2, 'AN', ''],
      ['Merchant Account Number', 16, 'N', ''],
      ['Transaction Reference', 18, 'AN', ''],
      ['Transaction Amount', 12, 'N', ''],
      ['Currency Code', 3, 'N', ''],
      ['Transaction Date', 8, 'N', 'YYYYMMDD'],
      ['Card Scheme', 4, 'AN', ''],
      ['Card Number Masked', 19, 'AN', ''],
      ['Authorization Code', 6, 'AN', ''],
      ['Merchant Name', 25, 'AN', ''],
      ['Merchant City', 13, 'AN', ''],
      ['Settlement Amount', 12, 'N', ''],
      ['Commission Amount', 12, 'N', '']
    ]);
    // Force the overlap: pull "Merchant City" back 5 bytes into "Merchant Name".
    var city = f.filter(function (x) { return x.name === 'Merchant City'; })[0];
    city.start = city.start - 5;
    // Force the gap: push settlement/commission forward, leaving bytes unmapped.
    f.filter(function (x) { return x.name === 'Settlement Amount' || x.name === 'Commission Amount'; })
      .forEach(function (x) { x.start = x.start + 5; });
    return f;
  })();

  /* =========================================================================
     Body builders
     ========================================================================= */
  function networkFileBody(opts) {
    return {
      record_length: opts.recordLength,
      format: 'fixed_width',
      padding_char: opts.padding || ' ',
      encoding: opts.encoding || 'ASCII',
      record_types: opts.recordTypes,
      transform: opts.transform
    };
  }
  function transformBody(opts) {
    return {
      json_extractions: opts.extractions || [],
      surcharge: opts.surcharge || { enabled: false, mappings: [] },
      acquirer_profile: opts.profile
    };
  }
  function scheduleBody(o) {
    return {
      report: o.report,
      timezone: o.timezone,
      'default': {
        transaction_date: {
          from: { offset: o.fromOffset, time: o.fromTime || '00:00:00' },
          to: { offset: o.toOffset, time: o.toTime || '23:59:59' }
        },
        report_offset: o.reportOffset,
        sundays_off: !!o.sundaysOff,
        saturdays_off: !!o.saturdaysOff,
        apply_general_holiday: o.holiday !== false
      },
      rules: o.rules || []
    };
  }
  function contentBody(o) {
    return {
      eligibility_flags: o.flags,
      json_fetch: o.fetch || [],
      'select': o.select
    };
  }
  function col(name, alias) { return { column: name, alias: alias || null }; }

  /* =========================================================================
     Config registry — 34 configs across three families (Parts 5.3, 6.3, 7.4)
     ========================================================================= */
  var configs = [];
  function add(c) {
    c.versions = c.versions || [];
    c.currentDraft = c.currentDraft || null;
    c.approvedBy = c.approvedBy || null;
    c.approvedAt = c.approvedAt || null;
    c.submittedBy = c.submittedBy || null;
    c.submittedAt = c.submittedAt || null;
    c.submittedHoursAgo = (c.submittedHoursAgo == null) ? null : c.submittedHoursAgo;
    c.rejectionReason = c.rejectionReason || null;
    c.comments = c.comments || [];
    configs.push(c);
    return c;
  }
  function version(n, body, o) {
    return {
      version: n, body: body, summary: o.summary,
      submittedBy: o.by, approvedBy: o.approvedBy || CHECKERS[0],
      approvedAt: ts(o.date, o.time || '11:20'),
      kind: o.kind || 'normal', reason: o.reason || null
    };
  }

  /* ---- Family 1 · Network File Configs (10) ------------------------------ */
  var VISA_PROFILE_IN = { file_id: 'HSBCIN01', site_id: '0001', company_id: 'JUSPAY', merchant_id: '428800012345', collection_method: '2' };

  // 1 · visa · tc05 · hsbc_in — ACTIVE, 4 prior versions incl. a nullified/correction pair
  var tc05_v1_0500 = (function () {
    var f = clone(TC05_0500);
    // v1 had no Reimbursement Attribute; the byte went to filler.
    var idx = -1; f.forEach(function (x, i) { if (x.name === 'Reimbursement Attribute') idx = i; });
    f.splice(idx, 1);
    f[f.length - 1].start = f[f.length - 1].start - 1;
    f[f.length - 1].length = 10;
    return f;
  })();
  var tc05_v2_0500 = (function () {          // the bad version — ZIP widened to 6
    var f = clone(tc05_v1_0500);
    f.forEach(function (x) { if (x.name === 'Merchant ZIP') x.length = 6; });
    return f;
  })();
  var tc05_body_v1 = networkFileBody({
    recordLength: 168, recordTypes: [{ record_type: '0500', label: 'TCR0 — base record', fields: tc05_v1_0500 }, { record_type: '0501', label: 'TCR1 — addendum', fields: clone(TC05_0501) }],
    transform: transformBody({
      extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }, { json_key: 'arn', output: 'Acquirer Reference Number' }] }],
      profile: clone(VISA_PROFILE_IN)
    })
  });
  var tc05_body_v2 = (function () { var b = clone(tc05_body_v1); b.record_types[0].fields = tc05_v2_0500; return b; })();
  var tc05_body_v3 = (function () { var b = clone(tc05_body_v1); return b; })();
  var tc05_body_v4 = networkFileBody({
    recordLength: 168,
    recordTypes: [{ record_type: '0500', label: 'TCR0 — base record', fields: clone(TC05_0500) }, { record_type: '0501', label: 'TCR1 — addendum', fields: clone(TC05_0501) }],
    transform: transformBody({
      extractions: [
        { source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }, { json_key: 'arn', output: 'Acquirer Reference Number' }] },
        { source_column: 'card_info', rows: [{ json_key: 'pan', output: 'Account Number' }, { json_key: 'bin_country', output: 'Merchant Country Code' }] }
      ],
      profile: clone(VISA_PROFILE_IN)
    })
  });

  add({
    configId: 'cfg_nf_001', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc05 · hsbc_in', network: 'visa', recordSet: 'tc05', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: clone(tc05_body_v4),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-03-14', '10:05'),
    approvedBy: CHECKERS[0], approvedAt: ts(ago(24), '11:20'), updatedAt: ts(ago(24), '11:20'),
    versions: [
      version(1, clone(tc05_body_v1), { summary: 'Initial TC05 layout for HSBC IN — 168 bytes, 30 fields across TCR0/TCR1.', by: 'ananya.iyer@juspay.in', date: '2025-03-14' }),
      version(2, clone(tc05_body_v2), { summary: 'Merchant ZIP widened to 6 bytes for postal-code expansion.', by: 'ananya.iyer@juspay.in', date: '2025-06-02', kind: 'nullified', reason: 'Breaches the Visa TC05 spec — Merchant ZIP is a fixed 5-byte field. Sum of lengths exceeded record_length by 1 byte.' }),
      version(3, clone(tc05_body_v3), { summary: 'Merchant ZIP corrected to 5 bytes; downstream positions re-packed.', by: 'ananya.iyer@juspay.in', date: '2025-06-02', time: '16:40', kind: 'correction', reason: 'Re-posted at the spec-compliant width after layout validation flagged the overflow.' }),
      version(4, clone(tc05_body_v4), { summary: 'Added Reimbursement Attribute at byte 159; trailing filler reduced 10 → 9. Added card_info JSON extraction.', by: 'rahul.menon@juspay.in', date: ago(24) })
    ]
  });

  // 2 · visa · tc06 · hsbc_in — ACTIVE
  add({
    configId: 'cfg_nf_002', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc06 · hsbc_in', network: 'visa', recordSet: 'tc06', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 168, recordTypes: [{ record_type: '0600', label: 'TC06 — chargeback', fields: clone(TC06_0600) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'reason_code', output: 'Message Reason Code' }, { json_key: 'cb_ref', output: 'Chargeback Reference Number' }] }],
        profile: clone(VISA_PROFILE_IN)
      })
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-03-14', '10:40'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-15', '09:10'), updatedAt: ts(ago(61), '15:02'),
    versions: [version(1, null, { summary: 'Initial TC06 chargeback layout — 168 bytes, 15 fields.', by: 'ananya.iyer@juspay.in', date: '2025-03-14' })]
  });

  // 3 · visa · tc05 · yes_bank — ACTIVE
  add({
    configId: 'cfg_nf_003', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc05 · yes_bank', network: 'visa', recordSet: 'tc05', subType: 'layout',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 168,
      recordTypes: [{ record_type: '0500', label: 'TCR0 — base record', fields: clone(TC05_0500) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }] }],
        profile: { file_id: 'YESB0001', site_id: '0007', company_id: 'JUSPAY', merchant_id: '401200098765', collection_method: '2' }
      })
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-05-02', '12:15'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-03', '10:02'), updatedAt: ts('2025-05-03', '10:02'),
    versions: [version(1, null, { summary: 'Initial TC05 layout for YES BANK acquiring.', by: 'kiran.rao@juspay.in', date: '2025-05-02' })]
  });

  // 4 · mastercard · clearing · hsbc_in — ACTIVE
  add({
    configId: 'cfg_nf_004', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'mastercard · clearing · hsbc_in', network: 'mastercard', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 200, recordTypes: [{ record_type: '1240', label: 'IPM 1240 — first presentment', fields: clone(MC_1240) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Approval Code' }, { json_key: 'stan', output: 'System Trace Audit Number' }] }],
        profile: { file_id: 'HSBCIN_MC', site_id: '0001', company_id: 'JUSPAY', merchant_id: '541100022110', collection_method: '1' }
      })
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-20', '09:30'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-21', '11:45'), updatedAt: ts(ago(40), '14:10'),
    versions: [
      version(1, null, { summary: 'Initial IPM 1240 layout — 200 bytes.', by: 'rahul.menon@juspay.in', date: '2025-03-20' }),
      version(2, null, { summary: 'Card Acceptor ID Code widened 12 → 15; trailing filler reduced.', by: 'rahul.menon@juspay.in', date: ago(40) })
    ]
  });

  // 5 · mastercard · clearing · hsbc_sg — PENDING_APPROVAL, submitted by the demo user
  //     → Approve is blocked for the demo user even in Checker role (Part 3).
  var mcSgPrev = networkFileBody({
    recordLength: 200, recordTypes: [{ record_type: '1240', label: 'IPM 1240 — first presentment', fields: clone(MC_1240) }],
    transform: transformBody({
      extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Approval Code' }] }],
      profile: { file_id: 'HSBCSG_MC', site_id: '0002', company_id: 'JUSPAY', merchant_id: '541100033220', collection_method: '1' }
    })
  });
  var mcSgProposed = (function () {
    var b = clone(mcSgPrev);
    var f = b.record_types[0].fields;
    // Widen Card Acceptor Terminal ID 8 → 10 and re-pack; shrink trailing filler 10 → 8.
    var pos = 1;
    f.forEach(function (x) {
      if (x.name === 'Card Acceptor Terminal ID') x.length = 10;
      if (x.name === 'Filler') x.length = 8;
      x.start = pos; pos += x.length;
    });
    b.transform.json_extractions[0].rows.push({ json_key: 'terminal_id', output: 'Card Acceptor Terminal ID' });
    b.encoding = 'EBCDIC';
    return b;
  })();
  add({
    configId: 'cfg_nf_005', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'mastercard · clearing · hsbc_sg', network: 'mastercard', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'PENDING_APPROVAL',
    body: mcSgProposed,
    createdBy: DEMO_USER, createdAt: ts('2025-04-11', '10:00'),
    submittedBy: DEMO_USER, submittedAt: ts(ago(1), '15:40'), submittedHoursAgo: 19,
    submitReason: 'Mastercard SG mandate 2025-Q4: terminal IDs move to 10 characters from the December clearing window. Encoding switches to EBCDIC per the SG mainframe hand-off.',
    approvedBy: null, approvedAt: null, updatedAt: ts(ago(1), '15:40'),
    versions: [version(1, mcSgPrev, { summary: 'Initial IPM 1240 layout for HSBC SG.', by: DEMO_USER, date: '2025-04-11' })]
  });

  // 6 · rupay · clearing · yes_bank — ACTIVE
  add({
    configId: 'cfg_nf_006', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'rupay · clearing · yes_bank', network: 'rupay', recordSet: 'clearing', subType: 'layout',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 180, recordTypes: [{ record_type: '0200', label: 'NFS clearing record', fields: clone(RUPAY_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'rrn', output: 'Retrieval Reference Number' }, { json_key: 'auth_code', output: 'Approval Code' }] }],
        profile: { file_id: 'YESB_RUPAY', site_id: '0007', company_id: 'JUSPAY', merchant_id: '607500011223', collection_method: '3' }
      })
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-05-06', '11:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-07', '10:20'), updatedAt: ts(ago(30), '12:35'),
    versions: [version(1, null, { summary: 'Initial RuPay NFS clearing layout — 180 bytes.', by: 'kiran.rao@juspay.in', date: '2025-05-06' })]
  });

  // 7 · hsbc_onus · clearing · hsbc_in — ACTIVE
  add({
    configId: 'cfg_nf_007', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'hsbc_onus · clearing · hsbc_in', network: 'hsbc_onus', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ONUS', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 150, recordTypes: [{ record_type: 'ON01', label: 'ONUS posting record', fields: clone(ONUS_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'acquirer_response', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }] }],
        profile: { file_id: 'HSBCIN_ONUS', site_id: '0001', company_id: 'HSBC', merchant_id: '000000000001', collection_method: '0' }
      })
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-04-02', '09:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-03', '10:15'), updatedAt: ts('2025-04-03', '10:15'),
    versions: [version(1, null, { summary: 'Initial HSBC ONUS posting layout — 150 bytes.', by: 'rahul.menon@juspay.in', date: '2025-04-02' })]
  });

  // 8 · hsbc_onus · clearing · hsbc_sg — ACTIVE
  add({
    configId: 'cfg_nf_008', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'hsbc_onus · clearing · hsbc_sg', network: 'hsbc_onus', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ONUS', state: 'ACTIVE',
    body: networkFileBody({
      recordLength: 150, recordTypes: [{ record_type: 'ON01', label: 'ONUS posting record', fields: clone(ONUS_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'acquirer_response', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }] }],
        profile: { file_id: 'HSBCSG_ONUS', site_id: '0002', company_id: 'HSBC', merchant_id: '000000000002', collection_method: '0' }
      })
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-04-02', '09:20'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-03', '10:30'), updatedAt: ts('2025-04-03', '10:30'),
    versions: [version(1, null, { summary: 'Initial HSBC SG ONUS posting layout.', by: 'rahul.menon@juspay.in', date: '2025-04-02' })]
  });

  // 9 · worldpay · clearing · hsbc_uk — DRAFT with an overlap and a gap (C01)
  add({
    configId: 'cfg_nf_009', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'worldpay · clearing · hsbc_uk', network: 'worldpay', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_uk', paymentEntity: 'HSBC_UK_ACQ', state: 'DRAFT',
    body: networkFileBody({
      recordLength: 160, recordTypes: [{ record_type: 'WP01', label: 'Worldpay clearing record', fields: clone(WORLDPAY_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }, { json_key: 'cardholder_name', output: 'Cardholder Name' }] }],
        profile: { file_id: 'HSBCUK_WP', site_id: '0004', company_id: 'JUSPAY', merchant_id: '', collection_method: '2' }
      })
    }),
    createdBy: DEMO_USER, createdAt: ts(ago(3), '16:20'), updatedAt: ts(ago(1), '11:05'),
    versions: []
  });

  // 10 · visa · tc05 · hsbc_hk — INACTIVE
  add({
    configId: 'cfg_nf_010', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc05 · hsbc_hk', network: 'visa', recordSet: 'tc05', subType: 'layout',
    tenantId: 'hsbc_hk', paymentEntity: 'HSBC_HK_ACQ', state: 'INACTIVE',
    body: networkFileBody({
      recordLength: 168, recordTypes: [{ record_type: '0500', label: 'TCR0 — base record', fields: clone(TC05_0500) }],
      transform: transformBody({
        extractions: [{ source_column: 'txn_metadata', rows: [{ json_key: 'auth_code', output: 'Authorization Code' }] }],
        profile: { file_id: 'HSBCHK01', site_id: '0003', company_id: 'JUSPAY', merchant_id: '452200011111', collection_method: '2' }
      })
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-02-10', '10:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-11', '09:40'), updatedAt: ts(ago(88), '17:30'),
    deactivatedNote: 'Deactivated when HK clearing moved to the regional Visa gateway on ' + U.prettyDate(ago(88)) + '.',
    versions: [version(1, null, { summary: 'Initial TC05 layout for HSBC HK.', by: 'ananya.iyer@juspay.in', date: '2025-02-10' })]
  });

  /* ---- Family 2 · Settlement Configs (14) -------------------------------- */
  var MPR_SELECT = [
    col('txn_id', 'transaction_id'), col('order_id'), col('merchant_id', 'mid'), col('txn_date', 'transaction_date'),
    col('settlement_date'), col('txn_amount', 'gross_amount'), col('mdr_amount'), col('gst_amount'),
    col('interchange_fee'), col('scheme_fee'), col('net_amount', 'settlement_amount'), col('card_network', 'network'),
    col('card_type'), col('auth_code'), col('rrn'), col('txn_status', 'status')
  ];
  var MPF_SELECT = [
    col('merchant_id', 'mid'), col('settlement_date'), col('batch_id'), col('txn_amount', 'gross_amount'),
    col('mdr_amount'), col('gst_amount'), col('net_amount', 'settlement_amount'), col('currency')
  ];

  // 11 · hsbc_in · MPR · schedule — ACTIVE with 4 prior versions (history showpiece)
  var mprV1 = scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', holiday: false });
  var mprV2 = scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', holiday: true });
  var mprV3 = scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', sundaysOff: true, holiday: true });
  var mprV4 = scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-2', toOffset: 'T-1', fromTime: '18:00:00', toTime: '17:59:59', reportOffset: 'T+0', sundaysOff: true, holiday: true });
  var mprV5 = (function () {
    var b = clone(mprV4);
    b.rules = [{
      match: { merchant_category: 'AIRLINE' },
      transaction_date: { from: { offset: 'T-3', time: '18:00:00' }, to: { offset: 'T-1', time: '17:59:59' } },
      report_offset: 'T+1', sundays_off: true, saturdays_off: false, apply_general_holiday: true
    }];
    return b;
  })();
  add({
    configId: 'cfg_st_001', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · MPR · schedule', report: 'MPR', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: clone(mprV5),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-01-08', '09:15'),
    approvedBy: CHECKERS[0], approvedAt: ts(ago(18), '10:40'), updatedAt: ts(ago(18), '10:40'),
    versions: [
      version(1, clone(mprV1), { summary: 'Initial MPR schedule — T-1 00:00:00 to T-1 23:59:59, report on T+0.', by: 'ananya.iyer@juspay.in', date: '2025-01-08' }),
      version(2, clone(mprV2), { summary: 'Apply general holiday calendar to MPR generation.', by: 'ananya.iyer@juspay.in', date: '2025-03-19' }),
      version(3, clone(mprV3), { summary: 'Sundays off — no MPR generated on Sundays per HSBC IN ops request.', by: 'rahul.menon@juspay.in', date: '2025-07-02' }),
      version(4, clone(mprV4), { summary: 'Transaction window moved T-1 → T-2 18:00:00 to T-1 17:59:59 to align with the network cut-off.', by: 'rahul.menon@juspay.in', date: '2025-09-16' }),
      version(5, clone(mprV5), { summary: 'Added airline-MCC override rule: T-3 window with report on T+1.', by: DEMO_USER, date: ago(18) })
    ]
  });

  // 12 · hsbc_in · MPF · schedule — ACTIVE
  add({
    configId: 'cfg_st_002', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · MPF · schedule', report: 'MPF', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'MPF', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', sundaysOff: true, holiday: true }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-01-08', '09:40'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-01-09', '10:00'), updatedAt: ts(ago(52), '11:15'),
    versions: [version(1, null, { summary: 'Initial MPF schedule.', by: 'ananya.iyer@juspay.in', date: '2025-01-08' })]
  });

  // 13 · hsbc_in · JV1_FEE_DATE · schedule — ACTIVE
  add({
    configId: 'cfg_st_003', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · JV1_FEE_DATE · schedule', report: 'JV1_FEE_DATE', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'JV1_FEE_DATE', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+1', sundaysOff: true, saturdaysOff: true, holiday: true }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-02-04', '14:20'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-05', '09:50'), updatedAt: ts('2025-02-05', '09:50'),
    versions: [version(1, null, { summary: 'Initial JV1 fee-date journal schedule.', by: 'kiran.rao@juspay.in', date: '2025-02-04' })]
  });

  // 14 · hsbc_in · JV2_FEE_DATE · schedule — ACTIVE
  add({
    configId: 'cfg_st_004', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · JV2_FEE_DATE · schedule', report: 'JV2_FEE_DATE', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'JV2_FEE_DATE', timezone: 'Asia/Kolkata', fromOffset: 'T-2', toOffset: 'T-2', reportOffset: 'T+1', sundaysOff: true, saturdaysOff: true, holiday: true }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-02-04', '14:45'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-05', '10:05'), updatedAt: ts(ago(70), '16:00'),
    versions: [version(1, null, { summary: 'Initial JV2 fee-date journal schedule.', by: 'kiran.rao@juspay.in', date: '2025-02-04' })]
  });

  // 15 · hsbc_in · MPR · content — ACTIVE
  add({
    configId: 'cfg_st_005', configType: 'SETTLEMENT_REPORT', family: 'settlement',
    name: 'hsbc_in · MPR · content', report: 'MPR', subType: 'content',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: contentBody({
      flags: ['in_mpr', 'settlement_eligible'],
      fetch: [{ source: 'txn_metadata', keys: ['auth_code', 'rrn', 'arn'] }, { source: 'card_info', keys: ['card_bin', 'card_last4'] }],
      select: clone(MPR_SELECT)
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-01-10', '11:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-01-11', '09:30'), updatedAt: ts(ago(33), '14:25'),
    versions: [
      version(1, null, { summary: 'Initial MPR column set — 14 columns.', by: 'ananya.iyer@juspay.in', date: '2025-01-10' }),
      version(2, null, { summary: 'Added interchange_fee and scheme_fee columns at the bank\'s request.', by: 'ananya.iyer@juspay.in', date: ago(33) })
    ]
  });

  // 16 · hsbc_in · MPF · content — ACTIVE
  add({
    configId: 'cfg_st_006', configType: 'SETTLEMENT_REPORT', family: 'settlement',
    name: 'hsbc_in · MPF · content', report: 'MPF', subType: 'content',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: contentBody({
      flags: ['in_mpf'],
      fetch: [{ source: 'merchant_config', keys: ['settlement_account', 'ifsc'] }],
      select: clone(MPF_SELECT)
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-01-10', '11:30'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-01-11', '09:45'), updatedAt: ts('2025-01-11', '09:45'),
    versions: [version(1, null, { summary: 'Initial MPF column set — 8 columns.', by: 'ananya.iyer@juspay.in', date: '2025-01-10' })]
  });

  // 17 · hsbc_in · fees · standard — ACTIVE
  var FEE_STD = {
    txn_rules: [
      {
        model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 10, starting_date: '2025-04-01',
        conditions: [{ field: 'card_type', condition: 'EQ', value: 'CREDIT' }, { field: 'card_region', condition: 'EQ', value: 'DOMESTIC' }],
        calculations: {
          slab_based: true, fee_type: 'PERCENTAGE', logic: [
            { min: 0, max: 2000, field: 'txn_amount', percentage: 1.85 },
            { min: 2000, max: 10000, field: 'txn_amount', percentage: 1.95 },
            { min: 10000, max: null, field: 'txn_amount', percentage: 2.05 }
          ]
        }
      },
      {
        model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 20, starting_date: '2025-04-01',
        conditions: [{ field: 'card_type', condition: 'EQ', value: 'DEBIT' }],
        calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 0.90 }] }
      },
      {
        model: 'INTERCHANGE', fee_mode: 'PASS_THROUGH', priority: 30, starting_date: '2025-04-01',
        conditions: [{ field: 'card_network', condition: 'IN', value: 'VISA,MASTERCARD' }],
        calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 1.10 }] }
      }
    ]
  };
  add({
    configId: 'cfg_st_007', configType: 'FEE_RULES', family: 'settlement',
    name: 'hsbc_in · fees · standard', report: 'FEES', subType: 'fees',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: clone(FEE_STD),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-25', '10:10'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-26', '11:00'), updatedAt: ts(ago(45), '09:20'),
    versions: [
      version(1, null, { summary: 'Initial fee rule set — credit slabs, flat debit MDR, interchange pass-through.', by: 'rahul.menon@juspay.in', date: '2025-03-25' }),
      version(2, null, { summary: 'Credit tier-3 MDR 2.00% → 2.05% effective 01 Oct 2025.', by: 'rahul.menon@juspay.in', date: ago(45) })
    ]
  });

  // 18 · hsbc_in · fees · premium_cards — PENDING_APPROVAL (slab additions, C07/C09)
  var FEE_PREM_PREV = {
    txn_rules: [{
      model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 10, starting_date: '2025-06-01',
      conditions: [{ field: 'card_type', condition: 'EQ', value: 'CREDIT' }, { field: 'card_bin', condition: 'IN', value: '414709,485932' }],
      calculations: {
        slab_based: true, fee_type: 'PERCENTAGE', logic: [
          { min: 0, max: 5000, field: 'txn_amount', percentage: 2.10 },
          { min: 5000, max: null, field: 'txn_amount', percentage: 2.25 }
        ]
      }
    }]
  };
  var FEE_PREM_PROPOSED = {
    txn_rules: [
      {
        model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 10, starting_date: '2025-12-01',
        conditions: [{ field: 'card_type', condition: 'EQ', value: 'CREDIT' }, { field: 'card_bin', condition: 'IN', value: '414709,485932,552200' }],
        calculations: {
          slab_based: true, fee_type: 'PERCENTAGE', logic: [
            { min: 0, max: 5000, field: 'txn_amount', percentage: 2.10 },
            { min: 5000, max: 25000, field: 'txn_amount', percentage: 2.25 },
            { min: 25000, max: 100000, field: 'txn_amount', percentage: 2.35 },
            { min: 100000, max: null, field: 'txn_amount', percentage: 2.40 }
          ]
        }
      },
      {
        model: 'SURCHARGE', fee_mode: 'COLLECT_FROM_CARDHOLDER', priority: 40, starting_date: '2025-12-01',
        conditions: [{ field: 'mcc', condition: 'IN', value: '5541,5542' }],
        calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 1.00 }] }
      }
    ]
  };
  add({
    configId: 'cfg_st_008', configType: 'FEE_RULES', family: 'settlement',
    name: 'hsbc_in · fees · premium_cards', report: 'FEES', subType: 'fees',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'PENDING_APPROVAL',
    body: clone(FEE_PREM_PROPOSED),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-05-28', '15:00'),
    submittedBy: 'rahul.menon@juspay.in', submittedAt: ts(ago(2), '10:12'), submittedHoursAgo: 41,
    submitReason: 'HSBC IN premium portfolio re-pricing effective 01 Dec 2025: two new upper slabs, Mastercard World BIN 552200 added, and a fuel-MCC surcharge rule.',
    approvedBy: null, approvedAt: null, updatedAt: ts(ago(2), '10:12'),
    versions: [version(1, clone(FEE_PREM_PREV), { summary: 'Initial premium-card fee rules — two slabs on Visa Infinite / Signature BINs.', by: 'rahul.menon@juspay.in', date: '2025-05-28' })]
  });

  // 19 · hsbc_sg · MPR · schedule — ACTIVE
  add({
    configId: 'cfg_st_009', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_sg · MPR · schedule', report: 'MPR', subType: 'schedule',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'MPR', timezone: 'Asia/Singapore', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', saturdaysOff: true, sundaysOff: true, holiday: true }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-04-14', '09:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-04-15', '10:10'), updatedAt: ts(ago(21), '13:40'),
    versions: [
      version(1, null, { summary: 'Initial SG MPR schedule.', by: 'kiran.rao@juspay.in', date: '2025-04-14' }),
      version(2, null, { summary: 'Weekend off — SG ops does not process Saturday settlement.', by: 'kiran.rao@juspay.in', date: ago(21) })
    ]
  });

  // 20 · hsbc_sg · MPR · content — DRAFT
  add({
    configId: 'cfg_st_010', configType: 'SETTLEMENT_REPORT', family: 'settlement',
    name: 'hsbc_sg · MPR · content', report: 'MPR', subType: 'content',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'DRAFT',
    body: contentBody({
      flags: ['in_mpr'],
      fetch: [{ source: 'txn_metadata', keys: ['auth_code', 'rrn'] }],
      select: [col('txn_id', 'transaction_id'), col('merchant_id', 'mid'), col('txn_date'), col('txn_amount', 'gross_amount'), col('mdr_amount'), col('net_amount', 'settlement_amount'), col('currency'), col('gst_rate')]
    }),
    createdBy: DEMO_USER, createdAt: ts(ago(5), '11:45'), updatedAt: ts(ago(1), '09:30'),
    versions: []
  });

  // 21 · hsbc_sg · fees — ACTIVE
  add({
    configId: 'cfg_st_011', configType: 'FEE_RULES', family: 'settlement',
    name: 'hsbc_sg · fees · standard', report: 'FEES', subType: 'fees',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'ACTIVE',
    body: {
      txn_rules: [
        {
          model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 10, starting_date: '2025-04-01',
          conditions: [{ field: 'card_region', condition: 'EQ', value: 'DOMESTIC' }],
          calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 1.60 }] }
        },
        {
          model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 20, starting_date: '2025-04-01',
          conditions: [{ field: 'card_region', condition: 'NEQ', value: 'DOMESTIC' }],
          calculations: { slab_based: false, fee_type: 'PERCENTAGE', logic: [{ min: 0, max: null, field: 'txn_amount', percentage: 2.75 }] }
        }
      ]
    },
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-04-16', '10:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-04-17', '09:30'), updatedAt: ts('2025-04-17', '09:30'),
    versions: [version(1, null, { summary: 'Initial SG fee rules — domestic vs cross-border MDR.', by: 'kiran.rao@juspay.in', date: '2025-04-16' })]
  });

  // 22 · hsbc_hk · MPR · schedule — ACTIVE
  add({
    configId: 'cfg_st_012', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_hk · MPR · schedule', report: 'MPR', subType: 'schedule',
    tenantId: 'hsbc_hk', paymentEntity: 'HSBC_HK_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'MPR', timezone: 'Asia/Hong_Kong', fromOffset: 'T-1', toOffset: 'T+0', fromTime: '17:00:00', toTime: '16:59:59', reportOffset: 'T+0', sundaysOff: true, holiday: true }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-06-03', '09:20'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-06-04', '10:00'), updatedAt: ts('2025-06-04', '10:00'),
    versions: [version(1, null, { summary: 'Initial HK MPR schedule — 17:00 HKT cut-off window.', by: 'kiran.rao@juspay.in', date: '2025-06-03' })]
  });

  // 23 · yes_bank · MPR · schedule — ACTIVE
  add({
    configId: 'cfg_st_013', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'yes_bank · MPR · schedule', report: 'MPR', subType: 'schedule',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', holiday: true }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-05-09', '11:10'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-10', '10:15'), updatedAt: ts(ago(12), '15:50'),
    versions: [version(1, null, { summary: 'Initial YES BANK MPR schedule.', by: 'ananya.iyer@juspay.in', date: '2025-05-09' })]
  });

  // 24 · yes_bank · fees — REJECTED (overlapping slab ranges in tier 2)
  add({
    configId: 'cfg_st_014', configType: 'FEE_RULES', family: 'settlement',
    name: 'yes_bank · fees · standard', report: 'FEES', subType: 'fees',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'REJECTED',
    body: {
      txn_rules: [{
        model: 'MDR', fee_mode: 'DEDUCT_FROM_SETTLEMENT', priority: 10, starting_date: '2025-12-01',
        conditions: [{ field: 'card_type', condition: 'EQ', value: 'CREDIT' }],
        calculations: {
          slab_based: true, fee_type: 'PERCENTAGE', logic: [
            { min: 0, max: 2000, field: 'txn_amount', percentage: 1.75 },
            { min: 1500, max: 10000, field: 'txn_amount', percentage: 1.90 },   // ← overlaps tier 1
            { min: 10000, max: null, field: 'txn_amount', percentage: 2.00 }
          ]
        }
      }]
    },
    createdBy: DEMO_USER, createdAt: ts(ago(9), '14:05'),
    submittedBy: DEMO_USER, submittedAt: ts(ago(8), '09:50'), submittedHoursAgo: 176,
    submitReason: 'YES BANK requested a three-tier credit MDR structure ahead of the December pricing revision.',
    rejectedBy: CHECKERS[0], rejectedAt: ts(ago(7), '16:30'),
    rejectionReason: 'Overlapping slab ranges in tier 2 — the 1,500–10,000 band starts inside the 0–2,000 band, so transactions between 1,500 and 2,000 match two slabs. Re-submit with contiguous boundaries.',
    updatedAt: ts(ago(7), '16:30'),
    versions: [version(1, null, { summary: 'Initial YES BANK fee rules — single flat credit MDR of 1.80%.', by: DEMO_USER, date: '2025-05-11' })]
  });

  /* ---- Family 3 · Incoming Parsing Configs (10) -------------------------- */
  function pipelineBody(o) {
    return {
      gateway: o.gateway, network: o.network, direction: 'INCOMING', pipeline_kind: o.kind,
      ack_filenames: o.acks,
      layout_ref: o.layoutRef,
      sectioning: { field: o.sectionField, rules: o.sectionRules },
      aggregation: {
        enabled: true,
        group_by: o.groupBy,
        sum_fields: o.sumFields,
        count_field: 'record_count',
        emit: o.emit || 'batch_summary'
      }
    };
  }

  // 25 · visa_incoming · hsbc_in · pipeline — ACTIVE
  add({
    configId: 'cfg_ip_001', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'visa_incoming · hsbc_in · pipeline', source: 'visa_incoming', subType: 'pipeline',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: pipelineBody({
      gateway: 'HSBC', network: 'VISA', kind: 'clearing',
      acks: ['VISA_ACK_%Y%m%d.txt', 'VSS_ACK_%Y%m%d_01.txt'],
      layoutRef: 'cfg_nf_001',
      sectionField: 'Transaction Code',
      sectionRules: [{ match: '05', bucket: 'clearing' }, { match: '06', bucket: 'chargeback' }, { match: '46', bucket: 'vss_settlement' }],
      groupBy: ['Acquirers Business ID', 'Purchase Date'],
      sumFields: ['Destination Amount', 'Source Amount']
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-03-16', '10:20'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-17', '09:40'), updatedAt: ts(ago(26), '11:30'),
    versions: [
      version(1, null, { summary: 'Initial Visa incoming pipeline for HSBC IN.', by: 'ananya.iyer@juspay.in', date: '2025-03-16' }),
      version(2, null, { summary: 'Added vss_settlement sectioning bucket for TC46 records.', by: 'ananya.iyer@juspay.in', date: ago(26) })
    ]
  });

  // 26 · visa_incoming · hsbc_sg · pipeline — ACTIVE (sectioning field has drifted → warning)
  add({
    configId: 'cfg_ip_002', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'visa_incoming · hsbc_sg · pipeline', source: 'visa_incoming', subType: 'pipeline',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'ACTIVE',
    body: pipelineBody({
      gateway: 'HSBC', network: 'VISA', kind: 'clearing',
      acks: ['VISA_SG_ACK_%Y%m%d.txt'],
      layoutRef: 'cfg_nf_005',
      sectionField: 'Transaction Code Indicator',       // not present in the referenced layout
      sectionRules: [{ match: '05', bucket: 'clearing' }],
      groupBy: ['Acquirer Reference Data'],
      sumFields: ['Transaction Amount']
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-04-18', '13:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-04-19', '09:20'), updatedAt: ts('2025-04-19', '09:20'),
    versions: [version(1, null, { summary: 'Initial Visa incoming pipeline for HSBC SG.', by: 'kiran.rao@juspay.in', date: '2025-04-18' })]
  });

  // 27 · mastercard_incoming · hsbc_in · pipeline — ACTIVE
  add({
    configId: 'cfg_ip_003', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'mastercard_incoming · hsbc_in · pipeline', source: 'mastercard_incoming', subType: 'pipeline',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: pipelineBody({
      gateway: 'HSBC', network: 'MASTERCARD', kind: 'clearing',
      acks: ['IPM_ACK_%Y%m%d.txt', 'GCMS_ACK_%Y%m%d.txt'],
      layoutRef: 'cfg_nf_004',
      sectionField: 'Function Code',
      sectionRules: [{ match: '200', bucket: 'first_presentment' }, { match: '450', bucket: 'chargeback' }, { match: '700', bucket: 'fee_collection' }],
      groupBy: ['Card Acceptor ID Code', 'Settlement Date'],
      sumFields: ['Transaction Amount', 'Settlement Amount']
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-22', '11:40'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-23', '10:00'), updatedAt: ts(ago(37), '10:45'),
    versions: [version(1, null, { summary: 'Initial Mastercard IPM incoming pipeline.', by: 'rahul.menon@juspay.in', date: '2025-03-22' })]
  });

  // 28 · rupay_incoming · yes_bank · pipeline — PENDING_APPROVAL (C11)
  var rupayPrev = pipelineBody({
    gateway: 'YESBANK', network: 'RUPAY', kind: 'clearing',
    acks: ['NPCI_ACK_%Y%m%d.txt'],
    layoutRef: 'cfg_nf_006',
    sectionField: 'Record Type',
    sectionRules: [{ match: '02', bucket: 'clearing' }],
    groupBy: ['Acquirer Institution ID'],
    sumFields: ['Transaction Amount']
  });
  var rupayProposed = (function () {
    var b = clone(rupayPrev);
    b.ack_filenames = ['NPCI_ACK_%Y%m%d.txt', 'NPCI_RAW_ACK_%Y%m%d_%H%M.txt', 'NFS_ACK_%Y%m%d.txt'];
    b.sectioning.rules.push({ match: '04', bucket: 'adjustment' });
    b.aggregation.sum_fields.push('Settlement Amount');
    return b;
  })();
  add({
    configId: 'cfg_ip_004', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'rupay_incoming · yes_bank · pipeline', source: 'rupay_incoming', subType: 'pipeline',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'PENDING_APPROVAL',
    body: rupayProposed,
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-05-12', '10:30'),
    submittedBy: 'ananya.iyer@juspay.in', submittedAt: ts(ago(0), '08:15'), submittedHoursAgo: 6,
    submitReason: 'NPCI introduced a second acknowledgment file (NPCI_RAW_ACK) from the November release, and adjustment records now arrive with record type 04.',
    approvedBy: null, approvedAt: null, updatedAt: ts(ago(0), '08:15'),
    versions: [version(1, rupayPrev, { summary: 'Initial RuPay incoming pipeline for YES BANK.', by: 'ananya.iyer@juspay.in', date: '2025-05-12' })]
  });

  // 29 · acks · hsbc_in · pipeline — ACTIVE
  add({
    configId: 'cfg_ip_005', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'acks · hsbc_in · pipeline', source: 'acks', subType: 'pipeline',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: pipelineBody({
      gateway: 'HSBC', network: 'ALL', kind: 'acknowledgment',
      acks: ['VISA_ACK_%Y%m%d.txt', 'IPM_ACK_%Y%m%d.txt', 'NPCI_ACK_%Y%m%d.txt'],
      layoutRef: null,
      sectionField: 'Record Type',
      sectionRules: [{ match: 'AK', bucket: 'ack' }, { match: 'RJ', bucket: 'reject' }],
      groupBy: ['File Name'],
      sumFields: ['Record Count'],
      emit: 'ack_summary'
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-28', '09:10'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-29', '09:50'), updatedAt: ts('2025-03-29', '09:50'),
    versions: [version(1, null, { summary: 'Initial acknowledgment ingestion pipeline across all networks.', by: 'rahul.menon@juspay.in', date: '2025-03-28' })]
  });

  // Parser bodies -----------------------------------------------------------
  function parserBody(recordTypes) { return { file_format: 'DELIMITED', delimiter: ',', quote_char: '"', record_types: recordTypes }; }

  // 30 · chargeback · hsbc_in · parser — ACTIVE
  add({
    configId: 'cfg_ip_006', configType: 'FILE_PARSER', family: 'incoming-parsing',
    name: 'chargeback · hsbc_in · parser', source: 'chargeback', subType: 'parser',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: parserBody({
      ORDER: {
        mappings: { order_id: 'ORDER_REF', txn_id: 'TXN_ID', merchant_id: 'MID', amount: 'TXN_AMT', currency: 'CCY', txn_date: 'TXN_DT', status: 'TXN_STATUS' },
        filters: [{ field: 'TXN_STATUS', condition: 'EQ', value: 'CAPTURED' }],
        mutations: ['trim_whitespace', 'upper_case_status'],
        computations: [{ target: 'net_amount', expr: 'TXN_AMT - FEE_AMT' }]
      },
      CHARGEBACK: {
        mappings: { arn: 'ARN', reason_code: 'REASON_CD', dispute_amount: 'CB_AMT', txn_date: 'ORIG_TXN_DT', rrn: 'RRN' },
        filters: [{ field: 'CB_STAGE', condition: 'IN', value: 'FIRST_CB,PRE_ARB' }],
        mutations: ['normalise_reason_code'],
        computations: []
      },
      ADJUSTMENT: {
        mappings: { txn_id: 'ADJ_REF', adjustment_type: 'ADJ_TYPE', amount: 'ADJ_AMT', txn_date: 'ADJ_DT' },
        filters: [],
        mutations: ['trim_whitespace'],
        computations: []
      }
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-04-05', '14:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-06', '10:20'), updatedAt: ts(ago(19), '16:10'),
    versions: [
      version(1, null, { summary: 'Initial chargeback parser — ORDER and CHARGEBACK record types.', by: 'ananya.iyer@juspay.in', date: '2025-04-05' }),
      version(2, null, { summary: 'Added ADJUSTMENT record type for network-initiated adjustments.', by: 'ananya.iyer@juspay.in', date: ago(19) })
    ]
  });

  // 31 · chargeback · hsbc_sg · parser — DRAFT (unknown mapping target → warning, C13)
  add({
    configId: 'cfg_ip_007', configType: 'FILE_PARSER', family: 'incoming-parsing',
    name: 'chargeback · hsbc_sg · parser', source: 'chargeback', subType: 'parser',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'DRAFT',
    body: parserBody({
      ORDER: {
        mappings: { order_id: 'ORDER_REF', txn_id: 'TXN_ID', amount: 'TXN_AMT', currency: 'CCY', cardholder_ref: 'CH_REF' },
        filters: [{ field: 'TXN_STATUS', condition: 'EQ', value: 'CAPTURED' }],
        mutations: ['trim_whitespace'],
        computations: []
      },
      REFUND: {
        mappings: { txn_id: 'RFND_REF', amount: 'RFND_AMT', txn_date: 'RFND_DT' },
        filters: [],
        mutations: [],
        computations: []
      }
    }),
    createdBy: DEMO_USER, createdAt: ts(ago(4), '10:40'), updatedAt: ts(ago(1), '17:20'),
    versions: []
  });

  // 32 · aq_mer · hsbc_in · parser — ACTIVE
  add({
    configId: 'cfg_ip_008', configType: 'FILE_PARSER', family: 'incoming-parsing',
    name: 'aq_mer · hsbc_in · parser', source: 'aq_mer', subType: 'parser',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: parserBody({
      MERCHANT: {
        mappings: { merchant_id: 'MID', status: 'MER_STATUS', txn_date: 'ONBOARD_DT' },
        filters: [{ field: 'MER_STATUS', condition: 'NEQ', value: 'CLOSED' }],
        mutations: ['trim_whitespace'],
        computations: []
      },
      TERMINAL: {
        mappings: { merchant_id: 'MID', txn_id: 'TID', status: 'TERM_STATUS' },
        filters: [],
        mutations: [],
        computations: []
      }
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-04-22', '11:20'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-04-23', '09:35'), updatedAt: ts('2025-04-23', '09:35'),
    versions: [version(1, null, { summary: 'Initial acquirer-merchant master parser.', by: 'kiran.rao@juspay.in', date: '2025-04-22' })]
  });

  // 33 · preprocessor · visa — ACTIVE
  add({
    configId: 'cfg_ip_009', configType: 'PREPROCESSOR', family: 'incoming-parsing',
    name: 'preprocessor · visa', source: 'preprocessor', subType: 'preprocessor',
    tenantId: 'hsbc_in', paymentEntity: 'PLATFORM', state: 'ACTIVE',
    body: {
      skip_header_rows: 1, skip_trailer_rows: 1, encoding: 'ASCII', strip_bom: true,
      steps: [
        { op: 'decompress', format: 'gzip' },
        { op: 'split_by_length', length: 168 },
        { op: 'drop_records_matching', field: 'Transaction Code', value: '90' },
        { op: 'normalise_dates', fields: ['Purchase Date'], from_format: 'MMDD', to_format: 'YYYY-MM-DD' }
      ],
      on_error: 'quarantine_file'
    },
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-30', '10:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-31', '09:15'), updatedAt: ts(ago(48), '12:00'),
    versions: [version(1, null, { summary: 'Initial Visa preprocessor — gzip, fixed-width split, date normalisation.', by: 'rahul.menon@juspay.in', date: '2025-03-30' })]
  });

  // 34 · preprocessor · mastercard — ACTIVE
  add({
    configId: 'cfg_ip_010', configType: 'PREPROCESSOR', family: 'incoming-parsing',
    name: 'preprocessor · mastercard', source: 'preprocessor', subType: 'preprocessor',
    tenantId: 'hsbc_in', paymentEntity: 'PLATFORM', state: 'ACTIVE',
    body: {
      skip_header_rows: 2, skip_trailer_rows: 1, encoding: 'EBCDIC', strip_bom: false,
      steps: [
        { op: 'ebcdic_to_ascii', code_page: 'cp037' },
        { op: 'split_by_length', length: 200 },
        { op: 'drop_records_matching', field: 'Message Type Identifier', value: '1644' }
      ],
      on_error: 'quarantine_record'
    },
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-30', '10:30'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-31', '09:30'), updatedAt: ts('2025-03-31', '09:30'),
    versions: [version(1, null, { summary: 'Initial Mastercard preprocessor — EBCDIC translation and IPM split.', by: 'rahul.menon@juspay.in', date: '2025-03-30' })]
  });

  /* ---- Back-fill: versions with a null body inherit the current body ------
     (a version entry always carries a body so the diff / revert always work) */
  configs.forEach(function (c) {
    c.versions.forEach(function (v, i) {
      if (!v.body) {
        v.body = clone(c.body);
        // Make earlier versions visibly different so diffs are never empty.
        if (i < c.versions.length - 1 || c.versions.length === 1) v.body = degrade(c, v.body, i);
      }
    });
  });
  // Produce a plausible "older" body for a synthetic version entry.
  function degrade(c, body, i) {
    var b = clone(body);
    if (c.family === 'network-file') {
      var rt = b.record_types && b.record_types[0];
      if (rt && rt.fields.length) {
        var last = rt.fields[rt.fields.length - 1];
        var prev = rt.fields[rt.fields.length - 2];
        if (prev && last) { prev.length = Math.max(1, prev.length - 1); last.start = last.start - 1; last.length = last.length + 1; }
      }
      if (b.transform && b.transform.json_extractions.length > 1) b.transform.json_extractions.pop();
    } else if (c.subType === 'schedule') {
      b['default'].apply_general_holiday = false;
      b['default'].report_offset = 'T+0';
    } else if (c.subType === 'content') {
      if (b['select'] && b['select'].length > 3) b['select'] = b['select'].slice(0, b['select'].length - 2);
    } else if (c.subType === 'fees') {
      if (b.txn_rules && b.txn_rules.length) {
        var lg = b.txn_rules[0].calculations.logic;
        if (lg && lg.length) lg[lg.length - 1].percentage = Math.round((lg[lg.length - 1].percentage - 0.05) * 100) / 100;
      }
    } else if (c.subType === 'pipeline') {
      if (b.ack_filenames && b.ack_filenames.length > 1) b.ack_filenames = b.ack_filenames.slice(0, 1);
      if (b.sectioning && b.sectioning.rules.length > 1) b.sectioning.rules = b.sectioning.rules.slice(0, b.sectioning.rules.length - 1);
    } else if (c.subType === 'parser') {
      var keys = Object.keys(b.record_types || {});
      if (keys.length > 1) delete b.record_types[keys[keys.length - 1]];
    } else if (c.subType === 'preprocessor') {
      if (b.steps && b.steps.length > 1) b.steps = b.steps.slice(0, b.steps.length - 1);
    }
    return b;
  }

  /* ---- Indexes ------------------------------------------------------------ */
  var byId = {}; configs.forEach(function (c) { byId[c.configId] = c; });
  function byFamily(fam) { return configs.filter(function (c) { return c.family === fam; }); }
  function layoutConfigs() { return byFamily('network-file'); }

  /* ---- Ids for new configs (in-memory only) ------------------------------ */
  var _seq = 100;
  function nextId(fam) {
    _seq += 1;
    return 'cfg_' + ({ 'network-file': 'nf', settlement: 'st', 'incoming-parsing': 'ip' }[fam]) + '_' + _seq;
  }

  /* ---- Empty bodies for "Create new" ------------------------------------- */
  function blankBody(fam, subType) {
    if (fam === 'network-file') {
      return networkFileBody({
        recordLength: 0, padding: ' ', encoding: 'ASCII',
        recordTypes: [{ record_type: '0500', label: 'New record type', fields: [] }],
        transform: transformBody({ extractions: [], profile: { file_id: '', site_id: '', company_id: '', merchant_id: '', collection_method: '' } })
      });
    }
    if (fam === 'settlement') {
      if (subType === 'content') return contentBody({ flags: [], fetch: [], select: [] });
      if (subType === 'fees') return { txn_rules: [] };
      return scheduleBody({ report: 'MPR', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0' });
    }
    if (subType === 'parser') return parserBody({ ORDER: { mappings: {}, filters: [], mutations: [], computations: [] } });
    if (subType === 'preprocessor') return { skip_header_rows: 0, encoding: 'ASCII', steps: [], on_error: 'quarantine_file' };
    return pipelineBody({ gateway: '', network: '', kind: 'clearing', acks: [], layoutRef: null, sectionField: '', sectionRules: [], groupBy: [], sumFields: [] });
  }

  /* ---- Holidays (schedule preview) --------------------------------------- */
  function holidayOn(ymd, timezone) {
    var country = TZ_COUNTRY[timezone] || 'India';
    var list = (O && O.holidays) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].date === ymd && list[i].country === country && list[i].impact !== 'Observance') return list[i];
    }
    return null;
  }

  return {
    // catalogues
    FAMILIES: FAMILIES, familyById: familyById,
    TENANTS: TENANTS, tenantByKey: tenantByKey,
    NETWORKS: NETWORKS, netByKey: netByKey,
    REPORTS: REPORTS, SOURCES: SOURCES, TIMEZONES: TIMEZONES, TZ_COUNTRY: TZ_COUNTRY,
    SOURCE_COLUMNS: SOURCE_COLUMNS, TXN_COLUMNS: TXN_COLUMNS, INTERNAL_FIELDS: INTERNAL_FIELDS,
    CONDITIONS: CONDITIONS, FIELD_TYPES: FIELD_TYPES, STATES: STATES,
    DEMO_USER: DEMO_USER, MAKERS: MAKERS, CHECKERS: CHECKERS,
    // store
    configs: configs, byId: byId, byFamily: byFamily, layoutConfigs: layoutConfigs,
    // helpers
    clone: clone, ts: ts, packFields: packFields, isFiller: isFiller, fieldNames: fieldNames,
    blankBody: blankBody, nextId: nextId, holidayOn: holidayOn, TODAY: TODAY
  };
})();
