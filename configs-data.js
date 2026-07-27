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
     Layout helpers
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
  // placedFields([[name, start, length, type, note?], ...]) — positions taken
  // verbatim from the real layout JSON rather than recomputed.
  function placedFields(defs) {
    return defs.map(function (d) {
      return { name: d[0], start: d[1], length: d[2], type: d[3], note: d[4] || '' };
    });
  }
  // xmlFields([[field_name, xml_tag, length?, type?], ...]) — RuPay layout.json
  // records carry a tag per field and no positions at all.
  function xmlFields(defs) {
    return defs.map(function (d) {
      var f = { name: d[0], xml_tag: d[1] || d[0], note: '' };
      if (d[2]) { f.length = d[2]; f.type = d[3] || 'AN'; }
      return f;
    });
  }
  // deFields([[field_name, length, type], ...]) — Mastercard clearing_layout.json
  // columns. Descriptions are seeded from the DE/PDS catalogue and stay editable.
  function deFields(defs) {
    var F = window.CFGFMT;
    return defs.map(function (d) {
      return { name: d[0], length: d[1] || null, type: d[2] || 'AN', note: F.describe(d[0]) };
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
  // Every input column the transform can read: json_extraction outputs plus the
  // columns any group declares in fields.source[]. Feeds the source pickers.
  function inputColumns(body) {
    var out = [], tf = (body && body.transform) || {};
    function push(v) { if (v && out.indexOf(v) < 0) out.push(v); }
    (tf.json_extractions || []).forEach(function (g) {
      (g.rows || []).forEach(function (r) { push(r.output); });
    });
    (tf.groups || []).forEach(function (g) {
      (((g.fields || {}).source) || []).forEach(push);
    });
    return out.sort();
  }

  /* =========================================================================
     VISA — fixed width. Field names and positions mirror
     config/visa/tc05_layout.json ("format": "fixed_width", record_length 168).
     ========================================================================= */
  /* ---- 9040 file header --------------------------------------------------- */
  var TC05_9040 = placedFields([
    ['Record type', 1, 2, 'AN', 'TC90 file header'],
    ['center_information_block', 3, 6, 'AN', ''],
    ['file_datetime_tz', 9, 5, 'N', '%y%j'],
    ['filler_1', 14, 16, 'AN', 'declared filler'],
    ['test_option', 30, 4, 'AN', ''],
    ['filler_2', 34, 29, 'AN', 'declared filler'],
    ['security_code', 63, 8, 'AN', ''],
    ['filler_3', 71, 6, 'AN', 'declared filler'],
    ['outgoing_file_id', 77, 3, 'N', ''],
    ['filler_4', 80, 89, 'AN', 'declared filler']
  ]);
  /* ---- 9100 batch trailer ------------------------------------------------- */
  var TC05_9100 = placedFields([
    ['Record type', 1, 4, 'AN', 'TC91 batch trailer'],
    ['center_information_block', 5, 6, 'N', ''],
    ['processing_date', 11, 5, 'N', ''],
    ['destination_amount', 16, 15, 'N', ''],
    ['no_of_monetary_transactions', 31, 12, 'N', ''],
    ['batch_number', 43, 6, 'N', ''],
    ['number_of_tcrs', 49, 12, 'N', ''],
    ['filler_1', 61, 6, 'N', 'declared filler'],
    ['central_batch_id', 67, 8, 'AN', ''],
    ['number_of_transactions', 75, 9, 'N', ''],
    ['filler_2', 84, 18, 'N', 'declared filler'],
    ['source_amount', 102, 15, 'N', ''],
    ['filler_3', 117, 15, 'N', 'declared filler'],
    ['filler_4', 132, 15, 'N', 'declared filler'],
    ['filler_5', 147, 15, 'N', 'declared filler'],
    ['filler_6', 162, 7, 'AN', 'declared filler']
  ]);
  /* ---- 0500 TCR0 base record --------------------------------------------- */
  var TC05_0500 = placedFields([
    ['Record type', 1, 4, 'AN', 'TC05 TCR0'],
    ['account_number', 5, 16, 'N', 'PAN'],
    ['account_number_extension', 21, 3, 'N', ''],
    ['floor_limit_indicator', 24, 1, 'AN', ''],
    ['crb_exception_file_indicator', 25, 1, 'AN', ''],
    ['filler_1', 26, 1, 'AN', 'declared filler'],
    ['acquirer_reference_number', 27, 23, 'N', 'ARN'],
    ['acquirers_business_id', 50, 8, 'N', 'BID'],
    ['purchase_date', 58, 4, 'N', 'MMDD'],
    ['destination_amount', 62, 12, 'N', ''],
    ['destination_currency_code', 74, 3, 'AN', 'ISO 4217'],
    ['source_amount', 77, 12, 'N', ''],
    ['source_currency_code', 89, 3, 'N', 'ISO 4217'],
    ['merchant_name', 92, 25, 'AN', ''],
    ['merchant_city', 117, 13, 'AN', ''],
    ['merchant_country_code', 130, 3, 'AN', ''],
    ['merchant_category_code', 133, 4, 'N', 'MCC'],
    ['merchant_zip_code', 137, 5, 'N', ''],
    ['merchant_province_code', 142, 3, 'AN', ''],
    ['requested_payment_service', 145, 1, 'AN', ''],
    ['number_of_payment_forms', 146, 1, 'AN', ''],
    ['usage_code', 147, 1, 'N', ''],
    ['reason_code', 148, 2, 'N', ''],
    ['settlement_flag', 150, 1, 'N', ''],
    ['authorization_characteristics_indicator', 151, 1, 'AN', ''],
    ['authorization_code', 152, 6, 'AN', ''],
    ['pos_terminal_capability', 158, 1, 'AN', ''],
    ['filler_2', 159, 1, 'AN', 'declared filler'],
    ['card_holder_id_method', 160, 1, 'AN', ''],
    ['collection_only_flag', 161, 1, 'AN', ''],
    ['pos_entry_mode', 162, 2, 'AN', ''],
    ['central_processing_date', 164, 4, 'N', ''],
    ['reimbursement_attribute', 168, 1, 'AN', '']
  ]);
  /* ---- 0501 TCR1 addendum ------------------------------------------------- */
  var TC05_0501 = placedFields([
    ['Record type', 1, 4, 'AN', 'TC05 TCR1'],
    ['business_format_code', 5, 1, 'AN', ''],
    ['token_assurance_method', 6, 2, 'AN', ''],
    ['rate_table_id', 8, 5, 'AN', ''],
    ['filler_1', 13, 4, 'AN', 'declared filler'],
    ['filler_2', 17, 6, 'N', 'declared filler'],
    ['documentation_indicator', 23, 1, 'AN', ''],
    ['member_message_text', 24, 50, 'AN', ''],
    ['special_condition_indicators', 74, 2, 'AN', ''],
    ['fee_program_indicator', 76, 3, 'AN', ''],
    ['issuer_charge', 79, 1, 'AN', ''],
    ['persistent_fx_applied_indicator', 80, 1, 'AN', ''],
    ['card_acceptor_id', 81, 15, 'AN', ''],
    ['terminal_id', 96, 8, 'AN', ''],
    ['national_reimbursement_fee', 104, 12, 'N', ''],
    ['mpe_com_payment_indicator', 116, 1, 'AN', ''],
    ['special_chargeback_indicator', 117, 1, 'AN', ''],
    ['conversion_date', 118, 4, 'AN', ''],
    ['additional_token_response_information', 122, 1, 'AN', ''],
    ['filler_3', 123, 1, 'N', 'declared filler'],
    ['acceptance_terminal_indicator', 124, 1, 'AN', ''],
    ['prepaid_card_indicator', 125, 1, 'AN', ''],
    ['service_development_field', 126, 1, 'AN', ''],
    ['avs_response_code', 127, 1, 'AN', ''],
    ['authorization_source_code', 128, 1, 'AN', ''],
    ['purchase_identifier_format', 129, 1, 'AN', ''],
    ['account_selection', 130, 1, 'AN', ''],
    ['installment_payment_count', 131, 2, 'AN', ''],
    ['purchase_identifier', 133, 25, 'AN', ''],
    ['cashback', 158, 9, 'N', ''],
    ['chip_condition_code', 167, 1, 'AN', ''],
    ['pos_environment', 168, 1, 'AN', '']
  ]);
  /* ---- 0600 TC06 chargeback ---------------------------------------------- */
  var TC06_0600 = placedFields([
    ['Record type', 1, 4, 'AN', 'TC06'],
    ['account_number', 5, 16, 'N', ''],
    ['account_number_extension', 21, 3, 'N', ''],
    ['floor_limit_indicator', 24, 1, 'AN', ''],
    ['crb_exception_file_indicator', 25, 1, 'AN', ''],
    ['filler_1', 26, 1, 'AN', 'declared filler'],
    ['acquirer_reference_number', 27, 23, 'N', ''],
    ['acquirers_business_id', 50, 8, 'N', ''],
    ['purchase_date', 58, 4, 'N', ''],
    ['destination_amount', 62, 12, 'N', ''],
    ['destination_currency_code', 74, 3, 'AN', ''],
    ['source_amount', 77, 12, 'N', ''],
    ['source_currency_code', 89, 3, 'N', ''],
    ['merchant_name', 92, 25, 'AN', ''],
    ['merchant_city', 117, 13, 'AN', ''],
    ['merchant_country_code', 130, 3, 'AN', ''],
    ['merchant_category_code', 133, 4, 'N', ''],
    ['merchant_zip_code', 137, 5, 'N', ''],
    ['merchant_province_code', 142, 3, 'AN', ''],
    ['requested_payment_service', 145, 1, 'AN', ''],
    ['number_of_payment_forms', 146, 1, 'AN', ''],
    ['usage_code', 147, 1, 'N', ''],
    ['reason_code', 148, 2, 'N', ''],
    ['settlement_flag', 150, 1, 'N', ''],
    ['authorization_characteristics_indicator', 151, 1, 'AN', ''],
    ['authorization_code', 152, 6, 'AN', ''],
    ['pos_terminal_capability', 158, 1, 'AN', ''],
    ['filler_2', 159, 1, 'AN', 'declared filler'],
    ['card_holder_id_method', 160, 1, 'AN', ''],
    ['collection_only_flag', 161, 1, 'AN', ''],
    ['pos_entry_mode', 162, 2, 'AN', ''],
    ['central_processing_date', 164, 4, 'N', ''],
    ['reimbursement_attribute', 168, 1, 'AN', '']
  ]);

  /* =========================================================================
     MASTERCARD — CSV / "Excel" with DE + PDS columns.
     Mirrors config/mastercard/clearing_layout.json ("Mastercard IPM CSV Layout")
     and clearing.yaml (output_config.output_format: "csv"). No record length,
     no positions, no byte map.
     ========================================================================= */
  var MC_DETAIL_COLS = [
    ['MTI', 4, 'N'], ['DE2', 16, 'N'], ['DE3', 6, 'N'], ['DE4', 12, 'N'], ['DE54', 20, 'AN'],
    ['DE12', 19, 'AN'], ['DE14', 4, 'N'], ['DE22', 12, 'N'], ['DE24', 3, 'N'], ['DE25', 4, 'N'],
    ['DE26', 4, 'N'], ['DE30', 24, 'N'], ['DE31', 23, 'N'], ['DE33', 11, 'N'], ['DE37', 12, 'AN'],
    ['DE38', 6, 'AN'], ['DE40', 3, 'N'], ['DE41', 8, 'AN'], ['DE42', 15, 'AN'], ['DE43', 99, 'AN'],
    ['DE43_NAME', 25, 'AN'], ['DE43_SUBURB', 13, 'AN'], ['DE43_POSTCODE', 2, 'AN'],
    ['DE48', 80, 'AN'],
    ['PDS0023', 3, 'AN'], ['PDS0043', 3, 'AN'], ['PDS0052', 3, 'N'], ['PDS0105', 25, 'N'],
    ['PDS0122', 1, 'AN'], ['PDS0148', 4, 'AN'], ['PDS0149', 1, 'N'], ['PDS0158', 12, 'AN'],
    ['PDS0165', 1, 'AN'], ['PDS0170', 57, 'AN'], ['PDS0175', 255, 'AN'], ['PDS0185', 32, 'AN'],
    ['PDS0207', 3, 'AN'], ['PDS0262', 1, 'N'],
    ['DE49', 3, 'N'], ['DE63', 16, 'AN'], ['DE71', 8, 'N'], ['DE72', 1, 'AN'], ['DE94', 11, 'N'],
    ['DE95', 1, 'N'], ['DE105', 1, 'AN'], ['ICC_DATA', 286, 'N']
  ];
  var MC_CONTROL_COLS = [
    ['MTI', 4, 'N'], ['DE24', 3, 'N'], ['DE48', 80, 'AN'], ['DE71', 8, 'N'],
    ['PDS0105', 25, 'N'], ['PDS0122', 1, 'AN'], ['PDS0301', 16, 'N'], ['PDS0306', 8, 'N']
  ];
  // DE43 explodes into the three sub-fields the layout declares; DE48 carries the
  // PDS elements the DE48 builder assembles (clearing.yaml groups[].fields.derived
  // → { name: "DE48", type: "DE48" }). Stored on the body so it stays editable.
  var MC_COMPOSITES = {
    DE43: ['DE43_NAME', 'DE43_SUBURB', 'DE43_POSTCODE'],
    DE48: ['PDS0023', 'PDS0043', 'PDS0052', 'PDS0105', 'PDS0122', 'PDS0148', 'PDS0149',
      'PDS0158', 'PDS0165', 'PDS0170', 'PDS0175', 'PDS0185', 'PDS0207', 'PDS0262']
  };

  /* =========================================================================
     RUPAY — XML. Mirrors config/rupay/layout.json (Hdr / Txn / Trl, every field
     carries an xml_tag, no record_length anywhere) and sample.yaml's
     xml_file_config. No positions, no byte map.
     ========================================================================= */
  var RUPAY_HDR = xmlFields([
    ['nMTI', 'nMTI'], ['nFunCd', 'nFunCd'], ['nRecNum', 'nRecNum'], ['nDtTmFlGen', 'nDtTmFlGen'],
    ['nMemInstCd', 'nMemInstCd'], ['nUnFlNm', 'nUnFlNm'], ['nProdCd', 'nProdCd'],
    ['nSetBIN', 'nSetBIN'], ['nFlCatg', 'nFlCatg'], ['nVerNum', 'nVerNum']
  ]);
  var RUPAY_TXN = xmlFields([
    ['nMTI', 'nMTI'], ['nFunCd', 'nFunCd'], ['nRecNum', 'nRecNum'], ['nDtTmLcTxn', 'nDtTmLcTxn'],
    ['nPAN', 'nPAN'], ['nARD', 'nARD'], ['nAcqInstCd', 'nAcqInstCd'], ['nApprvlCd', 'nApprvlCd'],
    ['nCrdAcptTrmId', 'nCrdAcptTrmId'], ['nAmtTxn', 'nAmtTxn'], ['nCcyCdTxn', 'nCcyCdTxn'],
    ['nTxnOrgInstCd', 'nTxnOrgInstCd']
  ]);
  var RUPAY_TRL = xmlFields([
    ['nMTI', 'nMTI'], ['nFunCd', 'nFunCd'], ['nRecNum', 'nRecNum'], ['nUnFlNm', 'nUnFlNm'],
    ['nTxnCnt', 'nTxnCnt', 8, 'N'], ['nRnTtlAmt', 'nRnTtlAmt', 12, 'N']
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
  // The one place the editor's format branch is decided. `output_format` is the
  // same discriminator the engine reads (fixed_width / xml / csv); only the
  // blocks that format actually uses are written into the body.
  function networkFileBody(opts) {
    var fmt = opts.outputFormat || 'fixed_width';
    var b = { output_format: fmt };
    if (fmt === 'fixed_width') {
      b.record_length = opts.recordLength;
      b.padding_char = opts.padding || ' ';
      b.encoding = opts.encoding || 'ASCII';
    }
    if (fmt === 'xml') {
      b.xml_file_config = opts.xml || {
        declaration: '<?xml version="1.0" encoding="UTF-8"?>',
        root_element: 'File',
        pretty_print: false
      };
    }
    if (fmt === 'csv') {
      b.csv_config = opts.csv || { delimiter: ',' };
      if (opts.lineEnding !== null) b.line_ending = opts.lineEnding || 'CRLF';
    }
    b.output_config = opts.output || {
      default_output_file: '',
      output_extension: (window.CFGFMT.caps(fmt).defaultExtension)
    };
    b.record_types = opts.recordTypes;
    if (opts.composites) b.composites = clone(opts.composites);
    b.transform = opts.transform;
    return b;
  }
  function transformBody(opts) {
    var t = {
      json_extractions: opts.extractions || [],
      field_mappings: opts.mappings || {},
      groups: opts.groups || [],
      surcharge: opts.surcharge || { enabled: false, mappings: [] },
      acquirer_profile: opts.profile
    };
    if (opts.txnTypeMapping) t.transaction_type_mapping = opts.txnTypeMapping;
    return t;
  }
  // Shorthands that keep the group literals below readable.
  function fm(source, transform, params) {
    var o = { source: source, transform: transform || 'passthrough' };
    if (params) o.params = params;
    return o;
  }
  function grp(o) {
    return {
      name: o.name,
      record_types: o.recordTypes || [],
      key: o.key || [],
      sort_by: o.sortBy || [],
      csv_config: o.csv || null,
      xml_config: o.xml || null,
      fields: {
        source: o.source || [],
        constants: o.constants || {},
        derived: o.derived || []
      },
      children: o.children || []
    };
  }
  function lookup(name, cols, resultIndex) {
    return { name: name, type: 'config_lookup', params: { lookup_columns: cols, result_index: resultIndex == null ? 0 : resultIndex } };
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
  // A settlement config's report key is either a plain report (MPR / MPF) or a
  // report with a schedule variant (JV1_FEE_DATE → base JV1, variant FEE_DATE),
  // matching settlement_generator.json's report_configs keys. Fee rules are
  // acquirer-level, so they carry no base and surface on every report's Fees tab.
  function splitReport(key) {
    if (!key || key === 'FEES') return { base: null, variant: null };
    var m = /^(JV\d)_(FEE_DATE|NON_FEE_DATE)$/.exec(key);
    if (m) return { base: m[1], variant: m[2] };
    return { base: key, variant: null };
  }
  function add(c) {
    if (c.family === 'settlement') {
      var r = splitReport(c.report);
      c.reportBase = r.base;
      c.variant = r.variant;
    }
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

  /* Visa transform — mirrors config/visa/tc05.yaml. json_extractions feed the
     iso_* columns; field_mappings point each layout field at one of them (or at
     a plain DB column); the transaction group carries the config_lookup that
     resolves business_application_id for AFT. Those three shapes are exactly
     what the Layout tab's Source column reads. */
  var VISA_EXTRACTIONS = [
    {
      source_column: 'udf15', rows: [
        { json_key: 'mcc', output: 'iso_merchant_category_code' },
        { json_key: 'merchant_name', output: 'iso_merchant_name' },
        { json_key: 'merchant_city', output: 'iso_merchant_city' },
        { json_key: 'merchant_country_code_alpha_2', output: 'iso_merchant_country_code_alpha_2' },
        { json_key: 'merchant_zip', output: 'iso_merchant_zip' },
        { json_key: 'merchant_tid', output: 'iso_merchant_tid' },
        { json_key: 'merchant_network_mid', output: 'iso_merchant_network_mid' },
        { json_key: '22', output: 'iso_pos_entry_mode' },
        { json_key: '32', output: 'iso_acquirer_id' },
        { json_key: '38', output: 'iso_auth_code_raw' },
        { json_key: 'acquirer_bin', output: 'iso_acquirer_bin' },
        { json_key: 'iso_outgoing_file_id', output: 'iso_outgoing_file_id' },
        { json_key: 'purchase_date', output: 'iso_purchase_date_localized' },
        { json_key: '126.13', output: 'iso_pos_environment' }
      ]
    },
    {
      source_column: 'amount_details', rows: [
        { json_key: 'baseAmount', output: 'amount_details_base_amount' },
        { json_key: 'surchargeAmount', output: 'amount_details_surcharge_amount' }
      ]
    }
  ];
  var VISA_MAPPINGS = {
    center_information_block: fm('iso_acquirer_bin'),
    security_code: fm('acquirer', 'switch', { cases: { yes_bank: 'YBLYRA22', hsbc_sg: 'HSBCSG25', hsbc_in: 'HSBCIN25', hsbc_hk: 'HSLYRA24' }, 'default': 'XXXXXXXX' }),
    file_datetime_tz: fm('date_udf1', 'format_date', { date_format: '%y%j' }),
    outgoing_file_id: fm('iso_outgoing_file_id'),
    account_number: fm('card_number'),
    acquirer_reference_number: fm('arn'),
    acquirers_business_id: fm('iso_acquirer_id'),
    source_amount: fm('txn_amount', 'split_dot_left'),
    source_currency_code: fm('txn_currency'),
    merchant_name: fm('iso_merchant_name'),
    merchant_city: fm('iso_merchant_city'),
    // The "merchant country code" ask — resolved from a DB-extracted column, so
    // the Layout tab shows it as a Direct / DB source, not a passthrough guess.
    merchant_country_code: fm('iso_merchant_country_code_alpha_2'),
    merchant_category_code: fm('iso_merchant_category_code'),
    merchant_zip_code: fm('iso_merchant_zip'),
    authorization_code: fm('iso_auth_code_raw'),
    pos_entry_mode: fm('iso_pos_entry_mode'),
    purchase_date: fm('iso_purchase_date_localized', 'date_format', { input_format: 'TIMESTAMP', output_format: 'MMDD' }),
    card_acceptor_id: fm('iso_merchant_network_mid', 'pad_value', { length: 15, pad_with: '0', align: 'right' }),
    terminal_id: fm('iso_merchant_tid', 'pad_value', { length: 8, pad_with: '0', align: 'right' }),
    pos_environment: fm('iso_pos_environment')
  };
  var VISA_GROUPS = [
    grp({
      name: 'file_header', recordTypes: ['9040'],
      source: ['udf15', 'iso_acquirer_bin', 'iso_security_code', 'iso_outgoing_file_id', 'acquirer', 'file_datetime_tz'],
      constants: { outgoing_file_id: '000' },
      children: ['transaction', 'batch_trailer']
    }),
    grp({
      name: 'transaction',
      recordTypes: [
        { type: '0500', condition_logic: 'and', conditions: [{ field: 'txn_type', operator: 'equals', values: ['ORDER'] }, { field: 'udf6', operator: 'not_equals', values: ['AFT'] }] },
        { type: '0501', condition_logic: 'and', conditions: [{ field: 'txn_type', operator: 'equals', values: ['ORDER'] }, { field: 'udf6', operator: 'not_equals', values: ['AFT'] }] }
      ],
      key: ['id'], sortBy: ['id'],
      source: ['card_number', 'arn', 'txn_amount', 'txn_currency', 'udf6', 'udf7', 'iso_acquirer_id',
        'iso_merchant_name', 'iso_merchant_city', 'iso_merchant_country_code_alpha_2',
        'iso_merchant_category_code', 'iso_merchant_zip', 'iso_merchant_tid',
        'iso_merchant_network_mid', 'iso_auth_code_raw', 'iso_pos_entry_mode',
        'iso_purchase_date_localized', 'iso_pos_environment'],
      constants: {
        aft_business_format_code: 'CR', source_of_funds: '3', account_number_extension: '000',
        floor_limit_indicator: ' ', crb_exception_file_indicator: ' ', merchant_province_code: '   ',
        requested_payment_service: ' ', number_of_payment_forms: ' ', usage_code: '1', reason_code: '00',
        settlement_flag: '9', pos_terminal_capability: '0', card_holder_id_method: '4',
        collection_only_flag: ' ', reimbursement_attribute: 'B', conversion_date: '0000'
      },
      // AFT business application id — the one config_lookup in tc05.yaml.
      derived: [lookup('business_application_id', ['udf7'], 0)]
    }),
    grp({
      name: 'batch_trailer', recordTypes: ['9100'],
      derived: [
        { name: 'batch_total_1', type: 'monetary_row_count', params: { scope: 'batch' }, aliases: ['no_of_monetary_transactions'] },
        { name: 'batch_sequence', type: 'constant', params: { value: '0' }, aliases: ['batch_number'] },
        { name: 'batch_record_count', type: 'batch_record_count', params: { include_self: true }, aliases: ['number_of_tcrs'] },
        { name: 'batch_count_2', type: 'monetary_row_count', params: { scope: 'batch', include_self: true }, aliases: ['number_of_transactions'] },
        { name: 'settlement_total', type: 'sum_column', params: { column: 'txn_amount', filter_column: 'txn_type', filter_values: ['ORDER', 'REFUND'] }, aliases: ['source_amount'] }
      ],
      constants: { filler_1: '      ', filler_2: '                  ', filler_3: '               ' }
    })
  ];

  function visaBody(o) {
    return networkFileBody({
      outputFormat: 'fixed_width',
      recordLength: 168, padding: ' ', encoding: o.encoding || 'ASCII',
      output: { default_output_file: o.file || 'visa_tc05_out.txt', output_extension: '.txt' },
      recordTypes: o.recordTypes,
      transform: transformBody({
        extractions: clone(o.extractions || VISA_EXTRACTIONS),
        mappings: clone(o.mappings || VISA_MAPPINGS),
        groups: clone(o.groups || VISA_GROUPS),
        profile: clone(o.profile)
      })
    });
  }

  // 1 · visa · tc05 · hsbc_in — ACTIVE, 4 prior versions incl. a nullified/correction pair
  function tc05Records(zipLen, withReimbursement) {
    var f = clone(TC05_0500);
    if (zipLen) f.forEach(function (x) { if (x.name === 'merchant_zip_code') x.length = zipLen; });
    if (withReimbursement === false) {
      f = f.filter(function (x) { return x.name !== 'reimbursement_attribute'; });
    }
    return [
      { record_type: '9040', label: 'TC90 — file header', fields: clone(TC05_9040) },
      { record_type: '0500', label: 'TCR0 — base record', fields: f },
      { record_type: '0501', label: 'TCR1 — addendum', fields: clone(TC05_0501) },
      { record_type: '9100', label: 'TC91 — batch trailer', fields: clone(TC05_9100) }
    ];
  }
  var tc05_body_v1 = visaBody({ profile: VISA_PROFILE_IN, recordTypes: tc05Records(null, false) });
  var tc05_body_v2 = visaBody({ profile: VISA_PROFILE_IN, recordTypes: tc05Records(6, false) });   // the bad version
  var tc05_body_v3 = visaBody({ profile: VISA_PROFILE_IN, recordTypes: tc05Records(null, false) });
  var tc05_body_v4 = visaBody({ profile: VISA_PROFILE_IN, recordTypes: tc05Records(null, true) });

  add({
    configId: 'cfg_nf_001', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc05 · hsbc_in', network: 'visa', recordSet: 'tc05', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: clone(tc05_body_v4),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-03-14', '10:05'),
    approvedBy: CHECKERS[0], approvedAt: ts(ago(24), '11:20'), updatedAt: ts(ago(24), '11:20'),
    versions: [
      version(1, clone(tc05_body_v1), { summary: 'Initial TC05 layout for HSBC IN — 168 bytes across 9040 / 0500 / 0501 / 9100.', by: 'ananya.iyer@juspay.in', date: '2025-03-14' }),
      version(2, clone(tc05_body_v2), { summary: 'merchant_zip_code widened to 6 bytes for postal-code expansion.', by: 'ananya.iyer@juspay.in', date: '2025-06-02', kind: 'nullified', reason: 'Breaches the Visa TC05 spec — merchant_zip_code is a fixed 5-byte field. Sum of lengths exceeded record_length by 1 byte.' }),
      version(3, clone(tc05_body_v3), { summary: 'merchant_zip_code corrected to 5 bytes; downstream positions re-checked.', by: 'ananya.iyer@juspay.in', date: '2025-06-02', time: '16:40', kind: 'correction', reason: 'Re-posted at the spec-compliant width after layout validation flagged the overflow.' }),
      version(4, clone(tc05_body_v4), { summary: 'Added reimbursement_attribute at byte 168. Added the amount_details JSON extraction.', by: 'rahul.menon@juspay.in', date: ago(24) })
    ]
  });

  // 2 · visa · tc06 · hsbc_in — ACTIVE
  add({
    configId: 'cfg_nf_002', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc06 · hsbc_in', network: 'visa', recordSet: 'tc06', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: visaBody({
      profile: VISA_PROFILE_IN, file: 'visa_tc06_out.txt',
      recordTypes: [
        { record_type: '9040', label: 'TC90 — file header', fields: clone(TC05_9040) },
        { record_type: '0600', label: 'TC06 — chargeback', fields: clone(TC06_0600) }
      ],
      groups: [
        VISA_GROUPS[0],
        grp({
          name: 'transaction',
          recordTypes: [{ type: '0600', condition_logic: 'and', conditions: [{ field: 'txn_type', operator: 'equals', values: ['CHARGEBACK'] }] }],
          key: ['id'], sortBy: ['id'],
          source: ['card_number', 'arn', 'txn_amount', 'txn_currency', 'iso_acquirer_id', 'iso_merchant_name', 'iso_merchant_city'],
          constants: { account_number_extension: '000', usage_code: '1', reason_code: '00', settlement_flag: '9' },
          derived: []
        })
      ]
    }),
    createdBy: 'ananya.iyer@juspay.in', createdAt: ts('2025-03-14', '10:40'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-15', '09:10'), updatedAt: ts(ago(61), '15:02'),
    versions: [version(1, null, { summary: 'Initial TC06 chargeback layout — 168 bytes.', by: 'ananya.iyer@juspay.in', date: '2025-03-14' })]
  });

  // 3 · visa · tc05 · yes_bank — ACTIVE
  add({
    configId: 'cfg_nf_003', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'visa · tc05 · yes_bank', network: 'visa', recordSet: 'tc05', subType: 'layout',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: visaBody({
      profile: { file_id: 'YESB0001', site_id: '0007', company_id: 'JUSPAY', merchant_id: '401200098765', collection_method: '2' },
      groups: [
        VISA_GROUPS[0],
        grp({
          name: 'transaction',
          recordTypes: [{ type: '0500', condition_logic: 'and', conditions: [{ field: 'txn_type', operator: 'equals', values: ['ORDER'] }, { field: 'udf6', operator: 'not_equals', values: ['AFT'] }] }],
          key: ['id'], sortBy: ['id'],
          source: VISA_GROUPS[1].fields.source,
          constants: VISA_GROUPS[1].fields.constants,
          derived: [lookup('business_application_id', ['udf7'], 0)]
        })
      ],
      recordTypes: [
        { record_type: '9040', label: 'TC90 — file header', fields: clone(TC05_9040) },
        { record_type: '0500', label: 'TCR0 — base record', fields: clone(TC05_0500) }
      ]
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-05-02', '12:15'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-03', '10:02'), updatedAt: ts('2025-05-03', '10:02'),
    versions: [version(1, null, { summary: 'Initial TC05 layout for YES BANK acquiring.', by: 'kiran.rao@juspay.in', date: '2025-05-02' })]
  });

  /* ---- Mastercard bodies — CSV / DE + PDS -------------------------------- */
  var MC_EXTRACTIONS = [
    {
      source_column: 'udf15', rows: [
        { json_key: '4', output: 'udf15_txn_amount' },
        { json_key: '18', output: 'udf15_mcc' },
        { json_key: 'merchant_network_mid', output: 'udf15_merchant_network_mid' },
        { json_key: 'rrn', output: 'udf15_rrn' },
        { json_key: 'acquirer_ica', output: 'udf15_acquirer_ica' },
        { json_key: 'country_code_2_alpha', output: 'udf15_country_code_2_alpha' },
        { json_key: 'merchant_name', output: 'udf15_merchant_name' },
        { json_key: 'merchant_city', output: 'udf15_merchant_city' },
        { json_key: 'DE22', output: 'udf15_DE22' },
        { json_key: 'DE43', output: 'udf15_DE43' },
        { json_key: 'DE48', output: 'udf15_DE48' },
        { json_key: 'DE63', output: 'udf15_DE63' },
        { json_key: 'DE12', output: 'udf15_DE12' },
        { json_key: 'DE3', output: 'udf15_DE3' },
        { json_key: 'PDS0023', output: 'udf15_PDS0023' },
        { json_key: 'PDS0052', output: 'udf15_PDS0052' },
        { json_key: 'PDS0148', output: 'udf15_PDS0148' },
        { json_key: 'PDS0149', output: 'udf15_PDS0149' },
        { json_key: 'PDS0158', output: 'udf15_PDS0158' },
        { json_key: 'PDS0165', output: 'udf15_PDS0165' },
        { json_key: 'PDS0170', output: 'udf15_PDS0170' },
        { json_key: 'PDS0175', output: 'udf15_PDS0175' },
        { json_key: 'PDS0185', output: 'udf15_PDS0185' },
        { json_key: 'PDS0262', output: 'udf15_PDS0262' }
      ]
    },
    {
      source_column: 'amount_details', rows: [
        { json_key: 'baseAmount', output: 'amount_details_base_amount' },
        { json_key: 'surchargeAmount', output: 'amount_details_surcharge_amount' },
        { json_key: 'taxAmount', output: 'amount_details_tax_amount' }
      ]
    }
  ];
  var MC_MAPPINGS = {
    DE2: fm('card_number'),
    DE3: fm('udf15_DE3', 'pad_value', { length: 6, pad_with: '0', align: 'right' }),
    DE4: fm('txn_amount', 'pad_clearing_amount', { length: 12 }),
    DE12: fm('udf15_DE12', 'format_date', { date_format: '%Y-%m-%dT%H:%M:%S' }),
    DE14: fm('card_exp'),
    DE22: fm('udf15_DE22'),
    DE26: fm('udf15_mcc'),
    DE31: fm('arn'),
    DE33: fm('udf15_acquirer_ica', 'pad_value', { length: 11, pad_with: '0', align: 'right' }),
    DE37: fm('udf15_rrn'),
    DE38: fm('auth_code'),
    DE41: fm('udf15_merchant_network_mid', 'substring', { start: 0, length: 8 }),
    DE42: fm('udf15_merchant_network_mid', 'pad_value', { length: 15, pad_with: '0', align: 'right' }),
    DE43: fm('udf15_DE43'),
    DE43_NAME: fm('udf15_merchant_name', 'pad_value', { length: 25, pad_with: ' ', align: 'left' }),
    DE43_SUBURB: fm('udf15_merchant_city', 'pad_value', { length: 13, pad_with: ' ', align: 'left' }),
    DE43_POSTCODE: fm('udf15_country_code_2_alpha'),
    DE48: fm('udf15_DE48'),
    DE49: fm('txn_currency'),
    DE54: fm('amount_details', 'mastercard_de54_surcharge'),
    DE63: fm('udf15_DE63'),
    DE94: fm('udf15_acquirer_ica', 'pad_value', { length: 11, pad_with: '0', align: 'right' }),
    PDS0023: fm('udf15_PDS0023'),
    PDS0052: fm('udf15_PDS0052'),
    PDS0148: fm('udf15_PDS0148'),
    PDS0149: fm('udf15_PDS0149'),
    PDS0158: fm('udf15_PDS0158'),
    PDS0165: fm('udf15_PDS0165'),
    PDS0170: fm('udf15_PDS0170'),
    PDS0175: fm('udf15_PDS0175'),
    PDS0185: fm('udf15_PDS0185'),
    PDS0262: fm('udf15_PDS0262'),
    ICC_DATA: fm('txn_currency', 'pad_value', { length: 286, pad_with: '0', align: 'right' })
  };
  var MC_GROUPS = [
    grp({
      name: 'file_header', recordTypes: ['1644'], csv: { include: true },
      derived: [
        { name: 'MTI', type: 'constant', params: { value: '1644' } },
        { name: 'DE24', type: 'constant', params: { value: '697' } },
        { name: 'PDS0122', type: 'constant', params: { value: 'P' } },
        { name: 'batch_sequence', type: 'row_count', aliases: ['DE71'], params: { padding: 8 } },
        { name: 'PDS0105', type: 'PDS0105' },
        { name: 'DE48', type: 'DE48' }
      ]
    }),
    grp({
      name: 'transactions',
      recordTypes: [{ type: '1240', conditions: [{ field: 'txn_type', operator: 'in', values: ['ORDER', 'REFUND'] }] }],
      key: ['id'], sortBy: ['id'], csv: { include: true },
      source: ['udf15_txn_amount', 'udf15_mcc', 'arn', 'udf15_merchant_network_mid', 'udf15_acquirer_ica',
        'txn_currency', 'auth_code', 'udf15_rrn', 'udf15_DE12', 'txn_date', 'udf15_merchant_name',
        'udf15_country_code_2_alpha', 'udf15_DE22', 'udf15_DE43', 'udf15_DE48', 'udf15_DE63',
        'udf15_PDS0023', 'udf15_PDS0052', 'udf15_PDS0148', 'udf15_PDS0149', 'udf15_PDS0158',
        'udf15_PDS0165', 'udf15_PDS0170', 'udf15_PDS0175', 'udf15_PDS0185', 'udf15_PDS0262',
        'udf15_DE3', 'udf15', 'txn_type', 'udf6', 'udf7', 'txn_amount', 'amount_details',
        'card_number', 'card_exp'],
      constants: { DE40: '000', DE24: '200', DE95: '', DE72: '', DE30: '', DE25: '1401', DE105: '' },
      derived: [
        { name: 'MTI', type: 'constant', params: { value: '1240' } },
        { name: 'batch_sequence', type: 'row_count', aliases: ['DE71'], params: { padding: 8 } },
        lookup('PDS0043', ['udf6', 'udf7'], 0),
        lookup('PDS0207', ['udf6'], 0)
      ]
    }),
    grp({
      name: 'file_trailer', recordTypes: ['1644'], csv: { include: true },
      derived: [
        { name: 'MTI', type: 'constant', params: { value: '1644' } },
        { name: 'DE24', type: 'constant', params: { value: '695' } },
        { name: 'batch_sequence', type: 'row_count', aliases: ['DE71'], params: { padding: 8 } },
        { name: 'batch_sequence', type: 'row_count', aliases: ['PDS0306'], params: { padding: 8 } },
        { name: 'PDS0105', type: 'PDS0105' },
        { name: 'PDS0301', type: 'sum_column', params: { column: 'txn_amount', length: 16 }, aliases: ['PDS0301'] },
        { name: 'DE48', type: 'DE48' }
      ]
    })
  ];
  var MC_TXN_TYPE_MAPPING = {
    AFT: ['C22'],
    'AFT:GENERAL_PP_TRANSFER': ['F07'],
    'AFT:PP_CARD_ACCOUNT_TRANSFER': ['F08'],
    'AFT:STAGED_DIGITAL_WALLET_TRANSFER': ['F52'],
    'AFT:CREDIT_CARD_BILL_PAYMENT': ['F54'],
    'AFT:BUSINESS_DISBURSEMENT': ['F55'],
    'AFT:DEBIT_ACCOUNT_TRANSFER': ['F64'],
    'AFT:B2B_TRANSFER': ['F65']
  };
  function mcRecordTypes() {
    return [
      { record_type: 'HEADER', label: 'CSV column header row', group: 'file_header', fields: deFields(MC_DETAIL_COLS) },
      { record_type: '1644', label: 'File header / trailer record', group: 'file_header', fields: deFields(MC_CONTROL_COLS) },
      { record_type: '1240', label: 'First presentment — one row per transaction', group: 'transactions', fields: deFields(MC_DETAIL_COLS) }
    ];
  }
  function mcBody(o) {
    return networkFileBody({
      outputFormat: 'csv',
      csv: { delimiter: ',' }, lineEnding: 'CRLF',
      output: { default_output_file: o.file || 'mastercard_clearing.csv', output_extension: '.csv' },
      recordTypes: o.recordTypes || mcRecordTypes(),
      composites: MC_COMPOSITES,
      transform: transformBody({
        extractions: clone(MC_EXTRACTIONS),
        mappings: clone(o.mappings || MC_MAPPINGS),
        groups: clone(o.groups || MC_GROUPS),
        txnTypeMapping: clone(MC_TXN_TYPE_MAPPING),
        surcharge: { enabled: true, mappings: [{ source: 'amount_details.surchargeAmount', output: 'DE54' }] },
        profile: clone(o.profile)
      })
    });
  }

  // 4 · mastercard · clearing · hsbc_in — ACTIVE
  add({
    configId: 'cfg_nf_004', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'mastercard · clearing · hsbc_in', network: 'mastercard', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: mcBody({ profile: { file_id: 'HSBCIN_MC', site_id: '0001', company_id: 'JUSPAY', merchant_id: '541100022110', collection_method: '1' } }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-20', '09:30'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-21', '11:45'), updatedAt: ts(ago(40), '14:10'),
    versions: [
      version(1, null, { summary: 'Initial IPM CSV layout — DE/PDS columns for 1644 and 1240.', by: 'rahul.menon@juspay.in', date: '2025-03-20' }),
      version(2, null, { summary: 'DE42 padded to 15 characters; PDS0207 added as a config_lookup on udf6.', by: 'rahul.menon@juspay.in', date: ago(40) })
    ]
  });

  // 5 · mastercard · clearing · hsbc_sg — PENDING_APPROVAL, submitted by the demo user
  //     → Approve is blocked for the demo user even in Checker role (Part 3).
  var mcSgPrev = mcBody({
    file: 'mastercard_clearing_sg.csv',
    profile: { file_id: 'HSBCSG_MC', site_id: '0002', company_id: 'JUSPAY', merchant_id: '541100033220', collection_method: '1' }
  });
  var mcSgProposed = (function () {
    var b = clone(mcSgPrev);
    // DE41 widened 8 → 10 characters, and PDS0043 newly resolved by lookup.
    b.transform.field_mappings.DE41 = fm('udf15_merchant_network_mid', 'substring', { start: 0, length: 10 });
    b.record_types.forEach(function (rt) {
      (rt.fields || []).forEach(function (f) { if (f.name === 'DE41') f.length = 10; });
    });
    b.csv_config.delimiter = '|';
    return b;
  })();
  add({
    configId: 'cfg_nf_005', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'mastercard · clearing · hsbc_sg', network: 'mastercard', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'PENDING_APPROVAL',
    body: mcSgProposed,
    createdBy: DEMO_USER, createdAt: ts('2025-04-11', '10:00'),
    submittedBy: DEMO_USER, submittedAt: ts(ago(1), '15:40'), submittedHoursAgo: 19,
    submitReason: 'Mastercard SG mandate 2025-Q4: DE41 terminal IDs move to 10 characters from the December clearing window, and SG ingestion wants a pipe-delimited file.',
    approvedBy: null, approvedAt: null, updatedAt: ts(ago(1), '15:40'),
    versions: [version(1, mcSgPrev, { summary: 'Initial IPM CSV layout for HSBC SG.', by: DEMO_USER, date: '2025-04-11' })]
  });

  /* ---- RuPay body — XML -------------------------------------------------- */
  var RUPAY_EXTRACTIONS = [{
    source_column: 'udf15', rows: [
      { json_key: 'rrn', output: 'rrn' },
      { json_key: 'merchant_bank_mid', output: 'card_terminal_id' },
      { json_key: 'acquirer_bin', output: 'acq_inst_cd' },
      { json_key: 'acquirer_name', output: 'mem_inst_cd', transform: 'switch', params: { cases: { YES_BANK: 'YESB5320104', HSBC_IN: 'HSBC0390002' }, 'default': '' } },
      { json_key: 'acquirer_name', output: 'set_bin', transform: 'switch', params: { cases: { YES_BANK: 'YESBA4', HSBC_IN: 'HSBC02' }, 'default': '' } }
    ]
  }];
  var RUPAY_MAPPINGS = {
    nRecNum: fm('Data record sequence number'),
    nMemInstCd: fm('mem_inst_cd'),
    nSetBIN: fm('set_bin'),
    nAcqInstCd: fm('acq_inst_cd'),
    nFunCd: fm('txn_type', 'switch', { cases: { ORDER: '200', REFUND: '262' }, 'default': '200' }),
    nDtTmLcTxn: fm('txn_datetime'),
    nPAN: fm('card_number'),
    nARD: fm('arn'),
    nApprvlCd: fm('auth_code'),
    nCrdAcptTrmId: fm('card_terminal_id', 'substring', { start: 0, length: 8 }),
    nAmtTxn: fm('txn_amount', 'rupay_amount'),
    nCcyCdTxn: fm('txn_currency'),
    nTxnOrgInstCd: fm('mem_inst_cd'),
    nTxnCnt: fm('_trl_txn_count', 'pad_value', { align: 'right' }),
    nRnTtlAmt: fm('_trl_sum_amount', 'pad_value', { align: 'right' })
  };
  var RUPAY_GROUPS = [
    grp({ name: 'file_root', xml: { element: 'File', wrapper_only: true }, children: ['file_header', 'txn_block', 'file_trailer'] }),
    grp({
      name: 'file_header', recordTypes: ['Hdr'], xml: { element: 'Hdr', wrapper_only: false },
      source: ['udf15'],
      constants: { nMTI: '1644', nFunCd: '670', nProdCd: 'POS01', nFlCatg: 'P', nVerNum: '01.00' },
      derived: [{ name: 'nDtTmFlGen', type: 'passthrough' }]
    }),
    grp({ name: 'txn_block', xml: { element: 'TxnBlock', wrapper_only: true }, children: ['transactions'] }),
    grp({
      name: 'transactions', recordTypes: ['Txn'], xml: { element: 'Txn', wrapper_only: false },
      key: ['rrn'], sortBy: ['created_at', 'source_id'],
      source: ['rrn', 'txn_type', 'arn', 'auth_code', 'card_terminal_id', 'txn_amount', 'txn_currency',
        'created_at', 'source_id', 'udf15', 'txn_date', 'card_number'],
      constants: { nMTI: '1240' },
      derived: [{ name: 'txn_datetime', type: 'passthrough' }, { name: 'card_number', type: 'passthrough' }]
    }),
    grp({
      name: 'file_trailer', recordTypes: ['Trl'], xml: { element: 'Trl', wrapper_only: false },
      source: ['udf15'],
      constants: { nMTI: '1644', nFunCd: '671' },
      derived: [
        { name: '_trl_txn_count', type: 'row_count' },
        { name: '_trl_sum_amount', type: 'sum_column', params: { column: 'txn_amount' } }
      ]
    })
  ];
  function rupayBody(o) {
    return networkFileBody({
      outputFormat: 'xml',
      xml: { declaration: '<?xml version="1.0" encoding="UTF-8"?>', root_element: 'File', pretty_print: false },
      output: { default_output_file: o.file || 'rupay_output.xml', output_extension: '.xml' },
      recordTypes: [
        { record_type: 'Hdr', label: 'File header', group: 'file_header', xml_element: 'Hdr', fields: clone(RUPAY_HDR) },
        { record_type: 'Txn', label: 'Transaction', group: 'transactions', xml_element: 'Txn', fields: clone(RUPAY_TXN) },
        { record_type: 'Trl', label: 'File trailer', group: 'file_trailer', xml_element: 'Trl', fields: clone(RUPAY_TRL) }
      ],
      transform: transformBody({
        extractions: clone(RUPAY_EXTRACTIONS),
        mappings: clone(RUPAY_MAPPINGS),
        groups: clone(RUPAY_GROUPS),
        profile: clone(o.profile)
      })
    });
  }

  // 6 · rupay · clearing · yes_bank — ACTIVE
  add({
    configId: 'cfg_nf_006', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'rupay · clearing · yes_bank', network: 'rupay', recordSet: 'clearing', subType: 'layout',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: rupayBody({ profile: { file_id: 'YESB_RUPAY', site_id: '0007', company_id: 'JUSPAY', merchant_id: '607500011223', collection_method: '3' } }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-05-06', '11:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-07', '10:20'), updatedAt: ts(ago(30), '12:35'),
    versions: [version(1, null, { summary: 'Initial RuPay XML clearing layout — Hdr / Txn / Trl.', by: 'kiran.rao@juspay.in', date: '2025-05-06' })]
  });

  // 7 · hsbc_onus · clearing · hsbc_in — ACTIVE
  var ONUS_MAPPINGS = {
    'Account Number': fm('card_number'),
    'Transaction Reference': fm('arn'),
    'Transaction Amount': fm('txn_amount', 'pad_value', { length: 12, pad_with: '0', align: 'right' }),
    'Currency Code': fm('txn_currency'),
    'Merchant Number': fm('iso_merchant_network_mid'),
    'Authorization Code': fm('iso_auth_code_raw')
  };
  var ONUS_GROUPS = [grp({
    name: 'transaction', recordTypes: ['ON01'], key: ['id'], sortBy: ['id'],
    source: ['card_number', 'arn', 'txn_amount', 'txn_currency', 'iso_merchant_network_mid', 'iso_auth_code_raw'],
    constants: { 'Onus Indicator': 'Y' },
    derived: []
  })];
  function onusBody(profile, file) {
    return networkFileBody({
      outputFormat: 'fixed_width', recordLength: 150, padding: ' ', encoding: 'ASCII',
      output: { default_output_file: file, output_extension: '.txt' },
      recordTypes: [{ record_type: 'ON01', label: 'ONUS posting record', fields: clone(ONUS_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'udf15', rows: [{ json_key: '38', output: 'iso_auth_code_raw' }, { json_key: 'merchant_network_mid', output: 'iso_merchant_network_mid' }] }],
        mappings: clone(ONUS_MAPPINGS), groups: clone(ONUS_GROUPS), profile: profile
      })
    });
  }
  add({
    configId: 'cfg_nf_007', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'hsbc_onus · clearing · hsbc_in', network: 'hsbc_onus', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ONUS', state: 'ACTIVE',
    body: onusBody({ file_id: 'HSBCIN_ONUS', site_id: '0001', company_id: 'HSBC', merchant_id: '000000000001', collection_method: '0' }, 'hsbc_in_onus.txt'),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-04-02', '09:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-03', '10:15'), updatedAt: ts('2025-04-03', '10:15'),
    versions: [version(1, null, { summary: 'Initial HSBC ONUS posting layout — 150 bytes.', by: 'rahul.menon@juspay.in', date: '2025-04-02' })]
  });

  // 8 · hsbc_onus · clearing · hsbc_sg — ACTIVE
  add({
    configId: 'cfg_nf_008', configType: 'CLEARING_FILE', family: 'network-file',
    name: 'hsbc_onus · clearing · hsbc_sg', network: 'hsbc_onus', recordSet: 'clearing', subType: 'layout',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ONUS', state: 'ACTIVE',
    body: onusBody({ file_id: 'HSBCSG_ONUS', site_id: '0002', company_id: 'HSBC', merchant_id: '000000000002', collection_method: '0' }, 'hsbc_sg_onus.txt'),
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
      outputFormat: 'fixed_width', recordLength: 160, padding: ' ', encoding: 'ASCII',
      output: { default_output_file: 'worldpay_clearing.txt', output_extension: '.txt' },
      recordTypes: [{ record_type: 'WP01', label: 'Worldpay clearing record', fields: clone(WORLDPAY_CLR) }],
      transform: transformBody({
        extractions: [{ source_column: 'udf15', rows: [{ json_key: '38', output: 'iso_auth_code_raw' }, { json_key: 'cardholder_name', output: 'iso_cardholder_name' }] }],
        mappings: {
          'Authorization Code': fm('iso_auth_code_raw'),
          'Cardholder Name': fm('iso_cardholder_name'),
          'Transaction Amount': fm('txn_amount', 'pad_value', { length: 12, pad_with: '0', align: 'right' })
        },
        groups: [grp({ name: 'transaction', recordTypes: ['WP01'], key: ['id'], source: ['txn_amount', 'iso_auth_code_raw', 'iso_cardholder_name'] })],
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
    body: visaBody({
      profile: { file_id: 'HSBCHK01', site_id: '0003', company_id: 'JUSPAY', merchant_id: '452200011111', collection_method: '2' },
      groups: [
        VISA_GROUPS[0],
        grp({
          name: 'transaction',
          recordTypes: [{ type: '0500', condition_logic: 'and', conditions: [{ field: 'txn_type', operator: 'equals', values: ['ORDER'] }, { field: 'udf6', operator: 'not_equals', values: ['AFT'] }] }],
          key: ['id'], sortBy: ['id'],
          source: VISA_GROUPS[1].fields.source,
          constants: VISA_GROUPS[1].fields.constants,
          derived: [lookup('business_application_id', ['udf7'], 0)]
        })
      ],
      recordTypes: [
        { record_type: '9040', label: 'TC90 — file header', fields: clone(TC05_9040) },
        { record_type: '0500', label: 'TCR0 — base record', fields: clone(TC05_0500) }
      ]
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

  /* ---- Schedule variants + JV content ------------------------------------
     settlement_generator.json for hsbc_in declares six report_configs keys:
     MPF, MPR, JV1_FEE_DATE, JV2_FEE_DATE, JV1_NON_FEE_DATE, JV2_NON_FEE_DATE.
     The JV pairs are two schedule VARIANTS of one report, so they belong inside
     the JV1 / JV2 item's Schedule tab rather than as separate list rows (§5). */

  // 25 · hsbc_in · JV1_NON_FEE_DATE · schedule — ACTIVE
  add({
    configId: 'cfg_st_015', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · JV1_NON_FEE_DATE · schedule', report: 'JV1_NON_FEE_DATE', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'JV1_NON_FEE_DATE', timezone: 'Asia/Kolkata', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', holiday: false }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-02-04', '15:05'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-05', '10:20'), updatedAt: ts('2025-02-05', '10:20'),
    versions: [version(1, null, { summary: 'Initial JV1 non-fee-date journal schedule — T-1 window, report T+0.', by: 'kiran.rao@juspay.in', date: '2025-02-04' })]
  });

  // 26 · hsbc_in · JV2_NON_FEE_DATE · schedule — ACTIVE
  add({
    configId: 'cfg_st_016', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_in · JV2_NON_FEE_DATE · schedule', report: 'JV2_NON_FEE_DATE', subType: 'schedule',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'JV2_NON_FEE_DATE', timezone: 'Asia/Kolkata', fromOffset: 'T+0', toOffset: 'T+0', reportOffset: 'T+1', holiday: false }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-02-04', '15:20'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-05', '10:35'), updatedAt: ts('2025-02-05', '10:35'),
    versions: [version(1, null, { summary: 'Initial JV2 non-fee-date journal schedule — T+0 window, report T+1.', by: 'kiran.rao@juspay.in', date: '2025-02-04' })]
  });

  // 27 · hsbc_in · JV1 · content — ACTIVE (reports/config/hsbc_in/jv1.yaml)
  var JV1_SELECT = [
    col('card_network'), col('txn_type'), col('txn_amount'), col('txn_currency', 'CURRENCY'), col('txn_date'),
    col('surchargeAmount'), col('taxAmount'), col('baseAmount'),
    col('convenience_fees', 'gpf_amount'), col('udf11', 'cpf_amount'), col('additional_charges', 'ofs_amount'),
    col('mdr_amount', 'mf_amount'), col('platform_fees', 'rpf_amount'), col('fee', 'tpf_amount'),
    col('merchant_fees', 'cr_amount'), col('date_udf2')
  ];
  add({
    configId: 'cfg_st_017', configType: 'SETTLEMENT_REPORT', family: 'settlement',
    name: 'hsbc_in · JV1 · content', report: 'JV1', subType: 'content',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: contentBody({
      flags: ['in_jv1_non_fee'],
      fetch: [{ source: 'amount_details', keys: ['surchargeAmount', 'taxAmount', 'baseAmount'] }],
      select: clone(JV1_SELECT)
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-02-06', '10:10'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-02-07', '09:30'), updatedAt: ts('2025-02-07', '09:30'),
    versions: [version(1, null, { summary: 'Initial JV1 journal column set from jv1.yaml.', by: 'kiran.rao@juspay.in', date: '2025-02-06' })]
  });

  // 28 · hsbc_in · JV2 · content — DRAFT (an unsubmitted edit sitting on a report item)
  add({
    configId: 'cfg_st_018', configType: 'SETTLEMENT_REPORT', family: 'settlement',
    name: 'hsbc_in · JV2 · content', report: 'JV2', subType: 'content',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'DRAFT',
    body: contentBody({
      flags: ['in_jv2_fee'],
      fetch: [{ source: 'amount_details', keys: ['surchargeAmount', 'taxAmount', 'baseAmount'] }],
      select: clone(JV1_SELECT).slice(0, 10)
    }),
    createdBy: DEMO_USER, createdAt: ts(ago(2), '11:15'), updatedAt: ts(ago(1), '09:40'),
    versions: []
  });

  // 29 · hsbc_in · MPF · content already exists; add hsbc_sg MPF so the SG item
  //      has both tabs populated.
  add({
    configId: 'cfg_st_019', configType: 'SETTLEMENT_GENERATOR', family: 'settlement',
    name: 'hsbc_sg · MPF · schedule', report: 'MPF', subType: 'schedule',
    tenantId: 'hsbc_sg', paymentEntity: 'HSBC_SG_ACQ', state: 'ACTIVE',
    body: scheduleBody({ report: 'MPF', timezone: 'Asia/Singapore', fromOffset: 'T-1', toOffset: 'T-1', reportOffset: 'T+0', saturdaysOff: true, sundaysOff: true, holiday: true }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-04-14', '11:30'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-04-15', '09:20'), updatedAt: ts('2025-04-15', '09:20'),
    versions: [version(1, null, { summary: 'Initial SG MPF schedule.', by: 'kiran.rao@juspay.in', date: '2025-04-14' })]
  });

  /* ---- Family 3 · Incoming Parsing Configs (10) -------------------------- */
  function pipelineBody(o) {
    return {
      gateway: o.gateway, network: o.network, direction: 'INCOMING', pipeline_kind: o.kind,
      ack_filenames: o.acks,
      layout_ref: o.layoutRef,
      // The incoming layout JSONs carry their own discriminator at the top:
      //   visa_vss_layout.json          → "format": "fixed_width"
      //   mastercard_incoming_layout... → "format": "xml"
      //   rupay_incoming_layout.json    → "format": "xlsx"
      // The editor only offers positions / record length / byte map when this
      // says fixed_width (§4).
      source_format: o.sourceFormat || 'fixed_width',
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
      gateway: 'HSBC', network: 'VISA', kind: 'clearing', sourceFormat: 'fixed_width',
      acks: ['VISA_ACK_%Y%m%d.txt', 'VSS_ACK_%Y%m%d_01.txt'],
      layoutRef: 'cfg_nf_001',
      sectionField: 'Record type',
      sectionRules: [{ match: '05', bucket: 'clearing' }, { match: '06', bucket: 'chargeback' }, { match: '46', bucket: 'vss_settlement' }],
      groupBy: ['acquirers_business_id', 'purchase_date'],
      sumFields: ['destination_amount', 'source_amount']
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
      gateway: 'HSBC', network: 'VISA', kind: 'clearing', sourceFormat: 'fixed_width',
      acks: ['VISA_SG_ACK_%Y%m%d.txt'],
      layoutRef: 'cfg_nf_003',
      sectionField: 'transaction_code_indicator',      // not present in the referenced layout
      sectionRules: [{ match: '05', bucket: 'clearing' }],
      groupBy: ['acquirer_reference_number'],
      sumFields: ['source_amount']
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
      gateway: 'HSBC', network: 'MASTERCARD', kind: 'clearing', sourceFormat: 'csv',
      acks: ['IPM_ACK_%Y%m%d.txt', 'GCMS_ACK_%Y%m%d.txt'],
      layoutRef: 'cfg_nf_004',
      sectionField: 'DE24',
      sectionRules: [{ match: '200', bucket: 'first_presentment' }, { match: '450', bucket: 'chargeback' }, { match: '700', bucket: 'fee_collection' }],
      groupBy: ['DE42', 'DE12'],
      sumFields: ['DE4', 'DE54']
    }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-03-22', '11:40'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-03-23', '10:00'), updatedAt: ts(ago(37), '10:45'),
    versions: [version(1, null, { summary: 'Initial Mastercard IPM incoming pipeline.', by: 'rahul.menon@juspay.in', date: '2025-03-22' })]
  });

  // 28 · rupay_incoming · yes_bank · pipeline — PENDING_APPROVAL (C11)
  var rupayPrev = pipelineBody({
    gateway: 'YESBANK', network: 'RUPAY', kind: 'clearing', sourceFormat: 'xml',
    acks: ['NPCI_ACK_%Y%m%d.txt'],
    layoutRef: 'cfg_nf_006',
    sectionField: 'nFunCd',
    sectionRules: [{ match: '200', bucket: 'clearing' }],
    groupBy: ['nAcqInstCd'],
    sumFields: ['nAmtTxn']
  });
  var rupayProposed = (function () {
    var b = clone(rupayPrev);
    b.ack_filenames = ['NPCI_ACK_%Y%m%d.txt', 'NPCI_RAW_ACK_%Y%m%d_%H%M.txt', 'NFS_ACK_%Y%m%d.txt'];
    b.sectioning.rules.push({ match: '262', bucket: 'refund' });
    b.aggregation.sum_fields.push('nRnTtlAmt');
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
      gateway: 'HSBC', network: 'ALL', kind: 'acknowledgment', sourceFormat: 'fixed_width',
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

  // 30 · rupay_incoming · DSR summary · pipeline — ACTIVE, spreadsheet source
  //      rupay_incoming.yaml → handlers.dsr_aggregator; the layout it reads is
  //      rupay_incoming_layout.json, declared "format": "xlsx". No layout_ref to
  //      an outgoing config: a spreadsheet has columns, not record types.
  add({
    configId: 'cfg_ip_013', configType: 'INCOMING', family: 'incoming-parsing',
    name: 'rupay_incoming · DSR summary · pipeline', source: 'rupay_incoming', subType: 'pipeline',
    tenantId: 'yes_bank', paymentEntity: 'YESB_ACQ', state: 'ACTIVE',
    body: pipelineBody({
      gateway: 'YESBANK', network: 'RUPAY', kind: 'aggregator', sourceFormat: 'xlsx',
      acks: [],
      layoutRef: null,
      sectionField: 'settlement_service_id',
      sectionRules: [{ match: 'INWARD', bucket: 'domestic' }, { match: '*', bucket: 'domestic' }],
      groupBy: ['Settlement Date', 'Acq ID / ISS Bin'],
      sumFields: ['Txn Amt DR', 'Txn Amt Cr'],
      emit: 'settlement_metadata'
    }),
    createdBy: 'kiran.rao@juspay.in', createdAt: ts('2025-05-20', '10:00'),
    approvedBy: CHECKERS[1], approvedAt: ts('2025-05-21', '09:15'), updatedAt: ts('2025-05-21', '09:15'),
    versions: [version(1, null, { summary: 'Initial RuPay DSR Summary aggregator — spreadsheet columns, no positions.', by: 'kiran.rao@juspay.in', date: '2025-05-20' })]
  });

  // Parser bodies -----------------------------------------------------------
  // o.format mirrors the incoming layout JSON's "format" key so the parser tab
  // can hide positions / byte maps for non-fixed-width sources (§4).
  function parserBody(recordTypes, o) {
    o = o || {};
    var b = { source_format: o.format || 'delimited', file_format: o.fileFormat || 'DELIMITED' };
    if (b.source_format === 'delimited' || b.source_format === 'csv') {
      b.delimiter = o.delimiter || ',';
      b.quote_char = o.quote || '"';
    }
    if (b.source_format === 'fixed_width' && o.recordLength) b.record_length = o.recordLength;
    b.record_types = recordTypes;
    return b;
  }

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

  // 35 · mastercard_incoming · t057 · parser — ACTIVE, fixed width
  //      Mirrors mastercard_incoming.yaml → layouts.t057: header/detail/trailer
  //      keyed by first_char, each field with a real start / length / type.
  add({
    configId: 'cfg_ip_011', configType: 'FILE_PARSER', family: 'incoming-parsing',
    name: 'mastercard_incoming · t057 · parser', source: 'mastercard_incoming', subType: 'parser',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: parserBody({
      header: {
        group: 'file_header', first_char: 'H', min_length: 16,
        mappings: { txn_date: 'processing_date' },
        fields: [
          { name: 'processing_date', start: 2, length: 8, type: 'date', note: 'format %Y%m%d' },
          { name: 'generation_time', start: 10, length: 6, type: 'time', note: 'format %H%M%S' },
          { name: 'version', start: 16, length: 1, type: 'AN', note: '' }
        ],
        filters: [], mutations: [], computations: []
      },
      detail: {
        group: 'transactions', first_char: 'D', min_length: 70,
        mappings: { currency: 'from_currency' },
        fields: [
          { name: 'from_currency', start: 2, length: 3, type: 'AN', note: '' },
          { name: 'to_currency', start: 5, length: 3, type: 'AN', note: '' },
          { name: 'exponent', start: 8, length: 1, type: 'N', note: 'rate_scaling.implied_decimals = 9' },
          { name: 'rate_indicator', start: 9, length: 2, type: 'AN', note: '' },
          { name: 'rate_low_raw', start: 11, length: 15, type: 'AN', note: '' },
          { name: 'rate_mid_raw', start: 26, length: 15, type: 'AN', note: '' },
          { name: 'rate_high_raw', start: 41, length: 15, type: 'AN', note: '' }
        ],
        filters: [], mutations: [], computations: []
      },
      trailer: {
        group: 'file_trailer', first_char: 'T', min_length: 24,
        mappings: {},
        fields: [
          { name: 'record_count', start: 2, length: 6, type: 'N', note: '' },
          { name: 'hash_total', start: 8, length: 17, type: 'AN', note: '' }
        ],
        filters: [], mutations: [], computations: []
      }
    }, { format: 'fixed_width', fileFormat: 'FIXED_WIDTH' }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-04-08', '10:15'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-09', '09:30'), updatedAt: ts('2025-04-09', '09:30'),
    versions: [version(1, null, { summary: 'Initial T057 currency-rate parser — H/D/T records keyed by first character.', by: 'rahul.menon@juspay.in', date: '2025-04-08' })]
  });

  // 36 · mastercard_incoming · clearing detail · parser — ACTIVE
  //      handlers.incoming_txn (IP755120 TN70/TN72). Columns are the semantic
  //      names from output_config.flat_columns, not DE codes — the description
  //      column and record-type grouping still apply (§4).
  add({
    configId: 'cfg_ip_012', configType: 'FILE_PARSER', family: 'incoming-parsing',
    name: 'mastercard_incoming · clearing detail · parser', source: 'mastercard_incoming', subType: 'parser',
    tenantId: 'hsbc_in', paymentEntity: 'HSBC_IN_ACQ', state: 'ACTIVE',
    body: parserBody({
      detail: {
        group: 'transactions',
        label: 'IP755120 clearing detail — report IP755120, business_mode 1',
        mappings: {
          arn: 'acquirer_reference_data',
          txn_id: 'trace_id',
          amount: 'amount_transaction',
          currency: 'transaction_currency_code',
          txn_date: 'central_site_business_date',
          auth_code: 'approval_code',
          rrn: 'trace_id',
          fee_amount: 'amount_fee_reconciliation',
          net_amount: 'reconciliation_amount'
        },
        // The columns Ops looks at when an IRD reject lands (see the IRD
        // Reject Resolver): the designator itself plus the inputs that decide it.
        notes: {
          interchange_rate_designator: 'IRD applied by Mastercard to this transaction.',
          ird: 'IRD as staged by us — a mismatch here is what produces reject 2569.',
          global_clearing_management_system_product_identifier: 'GCMS product ID, from the card account range.',
          card_program_identifier: 'Card program, from the card account range.',
          function_code: 'DE24 function code — 200 for a first presentment.',
          message_type_indicator: 'MTI — 1240 for a first presentment.',
          processing_code: 'DE3 processing code; SF1 feeds IRD matching.'
        },
        filters: [{ field: 'business_mode', condition: 'EQ', value: '1' }],
        mutations: ['trim_whitespace'], computations: []
      }
    }, { format: 'fixed_width', fileFormat: 'FIXED_WIDTH' }),
    createdBy: 'rahul.menon@juspay.in', createdAt: ts('2025-04-08', '11:00'),
    approvedBy: CHECKERS[0], approvedAt: ts('2025-04-09', '09:45'), updatedAt: ts(ago(12), '15:20'),
    versions: [version(1, null, { summary: 'Initial IP755120 clearing detail parser.', by: 'rahul.menon@juspay.in', date: '2025-04-08' })]
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
      var rt = b.record_types && b.record_types[b.record_types.length - 1];
      if (rt && rt.fields.length) {
        // Only fixed-width layouts have positions to nudge; XML and CSV layouts
        // differ by dropping the last column instead.
        if (window.CFGFMT.isFixed(b)) {
          var last = rt.fields[rt.fields.length - 1];
          var prev = rt.fields[rt.fields.length - 2];
          if (prev && last) { prev.length = Math.max(1, prev.length - 1); last.start = last.start - 1; last.length = last.length + 1; }
        } else if (rt.fields.length > 1) {
          rt.fields = rt.fields.slice(0, rt.fields.length - 1);
        }
      }
      if (b.transform && (b.transform.json_extractions || []).length > 1) b.transform.json_extractions.pop();
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

  /* ---- Settlement report items (§5) ---------------------------------------
     One list row per (acquirer/entity, report). Everything that belongs to that
     report — content, every schedule variant, and the acquirer's fee rules —
     hangs off the single item and is reached through tabs, never through
     separate list entries. */
  var REPORT_BASES = ['MPR', 'MPF', 'JV1', 'JV2'];
  function settlementItems() {
    var byKey = {}, order = [];
    byFamily('settlement').forEach(function (c) {
      if (!c.reportBase) return;                                  // fee configs attach below
      var key = c.tenantId + '::' + c.reportBase;
      if (!byKey[key]) {
        byKey[key] = {
          key: key, tenantId: c.tenantId, report: c.reportBase,
          name: (tenantByKey[c.tenantId] || { name: c.tenantId }).name + ' · ' + c.reportBase,
          schedules: [], content: null, fees: []
        };
        order.push(key);
      }
      var it = byKey[key];
      if (c.subType === 'schedule') it.schedules.push(c);
      else if (c.subType === 'content') it.content = c;
    });
    // Fee rules are acquirer-level in fee_configs/fees.json, so every report
    // item for that acquirer sees the same set on its Fees tab.
    var feesByTenant = {};
    byFamily('settlement').forEach(function (c) {
      if (c.subType !== 'fees') return;
      (feesByTenant[c.tenantId] = feesByTenant[c.tenantId] || []).push(c);
    });
    order.forEach(function (k) {
      var it = byKey[k];
      it.fees = (feesByTenant[it.tenantId] || []).slice();
      it.schedules.sort(function (a, b) { return String(a.variant || '').localeCompare(String(b.variant || '')); });
      it.members = it.schedules.concat(it.content ? [it.content] : []).concat(it.fees);
    });
    return order.map(function (k) { return byKey[k]; });
  }
  function settlementItemByKey(key) {
    var all = settlementItems();
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }
  // The item a given settlement config belongs to (fee configs belong to all of
  // their acquirer's items — the first one is a good enough anchor for routing).
  function itemKeyForConfig(c) {
    if (!c || c.family !== 'settlement') return null;
    if (c.reportBase) return c.tenantId + '::' + c.reportBase;
    var mine = settlementItems().filter(function (it) { return it.tenantId === c.tenantId; });
    return mine.length ? mine[0].key : null;
  }

  /* ---- Ids for new configs (in-memory only) ------------------------------ */
  var _seq = 100;
  function nextId(fam) {
    _seq += 1;
    return 'cfg_' + ({ 'network-file': 'nf', settlement: 'st', 'incoming-parsing': 'ip' }[fam]) + '_' + _seq;
  }

  /* ---- Empty bodies for "Create new" ------------------------------------- */
  function blankBody(fam, subType, outputFormat) {
    if (fam === 'network-file') {
      var fmt = outputFormat || 'fixed_width';
      var rt = fmt === 'csv'
        ? [{ record_type: '1240', label: 'New record type', group: 'transactions', fields: [] }]
        : fmt === 'xml'
          ? [{ record_type: 'Txn', label: 'New record', group: 'transactions', xml_element: 'Txn', fields: [] }]
          : [{ record_type: '0500', label: 'New record type', fields: [] }];
      return networkFileBody({
        outputFormat: fmt,
        recordLength: 0, padding: ' ', encoding: 'ASCII',
        recordTypes: rt,
        composites: fmt === 'csv' ? {} : null,
        transform: transformBody({ extractions: [], mappings: {}, groups: [], profile: { file_id: '', site_id: '', company_id: '', merchant_id: '', collection_method: '' } })
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
    REPORTS: REPORTS, REPORT_BASES: REPORT_BASES, SOURCES: SOURCES, TIMEZONES: TIMEZONES, TZ_COUNTRY: TZ_COUNTRY,
    SOURCE_COLUMNS: SOURCE_COLUMNS, TXN_COLUMNS: TXN_COLUMNS, INTERNAL_FIELDS: INTERNAL_FIELDS,
    CONDITIONS: CONDITIONS, FIELD_TYPES: FIELD_TYPES, STATES: STATES,
    DEMO_USER: DEMO_USER, MAKERS: MAKERS, CHECKERS: CHECKERS,
    // store
    configs: configs, byId: byId, byFamily: byFamily, layoutConfigs: layoutConfigs,
    settlementItems: settlementItems, settlementItemByKey: settlementItemByKey,
    itemKeyForConfig: itemKeyForConfig, splitReport: splitReport,
    // helpers
    clone: clone, ts: ts, packFields: packFields, placedFields: placedFields,
    isFiller: isFiller, fieldNames: fieldNames, inputColumns: inputColumns,
    blankBody: blankBody, nextId: nextId, holidayOn: holidayOn, TODAY: TODAY
  };
})();
