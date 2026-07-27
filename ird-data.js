/* =============================================================================
   Juspay Ops Portal — IRD Reject Resolver: mock store (refinement §6)

   Every shape here mirrors code that already exists — the resolver wraps it, it
   does not reinvent it:

     IrdTransaction   src_crates/file_processor/.../mastercard/ird/transaction.rs
     IrdMatch         .../mastercard/ird/mod.rs  (ird_id, geography, ird_code,
                      variant, description, source_version, effective_from,
                      effective_to, score, reasons)
     RuleResult       .../mastercard/ird/evaluator.rs  (reasons are "OK: …" /
                      "REJECT: …" lines; each satisfied rule adds to score)
     sql_narrow       .../mastercard/ird/sql_narrow.rs  (candidates come from
                      {schema}.irds JOIN {schema}.ird_scope)
     IrdError         .../mastercard/ird/error.rs
     lookup_*         .../mastercard/ird/db_lookups.rs
     reject flow      src_crates/rest_api/src/reject_clearing/{model,service}.rs
     reason text      src_crates/rest_api/config/reject_reasons.json

   The IRD ROWS themselves (ird_code / description / score / reasons) are
   illustrative sample data standing in for the `irds` table — the table is real,
   these particular rows are demo values.
   ============================================================================= */
window.IRDDATA = (function () {
  'use strict';
  var D = window.DATA, U = D.util;
  var TODAY = D.TODAY;
  function ago(n) { return U.addDays(TODAY, -n); }

  /* ---- Statuses (reject_clearing/model.rs) ------------------------------- */
  var REJECTED_STATUSES = ['staging_reject', 'incoming_reject'];
  var RESOLVED_REJECT_STATUS = 'resolved_reject';
  var CYCLE_DECISIONS = ['EXISTING_CURRENT_CYCLE', 'NEW_NEXT_AVAILABLE_CYCLE', 'NO_ACQUIRER_LINK_NEW_FILE', 'WAITING_FOR_NEXT_CYCLE'];

  /* ---- Reject reasons — verbatim from rest_api/config/reject_reasons.json - */
  var REJECT_REASONS = {
    '0001': 'Invalid record format',
    '0011': 'DE2 PRIMARY ACCOUNT NUMBER (PAN) ACCOUNT RANGE INVALID',
    '0150': 'Invalid merchant/acceptor ID',
    '0301': 'Duplicate transaction - ARN already presented',
    '0420': 'Invalid or unsupported currency code',
    '0521': 'Transaction amount exceeds clearing limit',
    '0630': 'Invalid ARN check digit',
    '2001': 'Late presentment - outside clearing window',
    '2569': 'Invalid IRD for transaction type',
    '2660': 'Invalid settlement indicator',
    '30': 'Format error'
  };
  // The codes an Ops user should treat as "the IRD is wrong or missing".
  var IRD_REASON_CODES = ['2569', '0011'];
  function isIrdReason(code) { return IRD_REASON_CODES.indexOf(String(code)) >= 0; }

  /* ---- IrdError variants (error.rs) — with the plain-language version Ops
         needs and the action that actually unblocks them. ------------------- */
  var IRD_ERRORS = {
    AccountRangeNotFound: {
      title: 'Card account range not found',
      plain: 'We could not find this card’s account range in the Mastercard account range table, so the GCMS Product ID and Card Program are unknown. Those two decide most of the IRD rules.',
      technical: 'account range lookup: no match for card (mastercard_account_range)',
      action: 'Pick an IRD manually from the filtered list below, or wait for the next TT067 account-range file and retry.'
    },
    AbProgramsNotFound: {
      title: 'No AB programs for this MCC',
      plain: 'The merchant category code on this transaction is not mapped to any Mastercard acceptance-business programme, so the matcher cannot narrow the candidates by programme.',
      technical: 'AB programs lookup: no match for mcc',
      action: 'Confirm the MCC is right. If it is, choose the IRD by geography and card program from the list below.'
    },
    AcquirerRegionNotFound: {
      title: 'Acquirer region not found',
      plain: 'The acquirer’s country code does not map to a Mastercard region, so we cannot tell whether this is a domestic, intra-regional or inter-regional transaction.',
      technical: 'acquirer region lookup: no row for acquirer_country_numeric',
      action: 'Escalate — this is reference data, not a per-transaction problem.'
    },
    IssuerRegionNotFound: {
      title: 'Issuer region not found',
      plain: 'The issuing bank’s country does not map to a Mastercard region, so the geography for this transaction is undecidable.',
      technical: 'issuer region lookup: no row for issuer_country_numeric',
      action: 'Escalate — this is reference data, not a per-transaction problem.'
    },
    NoIrdMatch: {
      title: 'No IRD matched',
      plain: 'Every candidate IRD was rejected by at least one rule. The reasons on each candidate below say which rule failed.',
      technical: 'matcher returned zero matches',
      action: 'Read the REJECT lines below. If one candidate is only failing on data we know is wrong, pick it and note why.'
    },
    MatcherFailed: {
      title: 'Matcher failed',
      plain: 'The IRD matcher errored before it could rank candidates.',
      technical: 'matcher error',
      action: 'Escalate to Tech with the transaction reference.'
    }
  };

  /* ---- Inline KT (§6.5) — seeded from the module docs, refined with Ops --- */
  var GLOSSARY = [
    {
      term: 'IRD', full: 'Interchange Rate Designator',
      short: 'The 2-character code that tells Mastercard which interchange rate applies to a transaction.',
      long: 'Mastercard prices every cleared transaction against an interchange programme. The IRD is the code that names that programme on the clearing record. If we stage the wrong IRD — or none — Mastercard rejects the transaction before it is ever accepted for clearing, with reject reason 2569.',
      source: 'ird/mod.rs — find_matching_irds'
    },
    {
      term: 'Account Range', full: 'Mastercard account range table',
      short: 'The table that maps a card’s BIN / PAN range to its product and issuing country.',
      long: 'Mastercard publishes account ranges in the TT067 file. Looking a card up in this table is how we learn its GCMS Product ID, Card Program Identifier, issuing region and country. If the lookup misses, most IRD rules cannot be evaluated at all.',
      source: 'ird/db_lookups.rs — lookup_account_range'
    },
    {
      term: 'GCMS Product ID', full: 'Global Clearing Management System product identifier',
      short: 'A 3-character Mastercard product code derived from the card’s account range — e.g. MCC, DMC.',
      long: 'It says what kind of card this is (consumer credit, debit, commercial and so on). IRD rules are scoped by product, so a consumer-credit IRD will never match a debit card.',
      source: 'ird/db_lookups.rs — lookup_account_range → gcms_product_id'
    },
    {
      term: 'Card Program', full: 'Card program identifier',
      short: 'The Mastercard programme the card belongs to, also read from the account range.',
      long: 'Narrower than the product ID — it distinguishes programmes within a product family. The matcher requires the candidate IRD to list this card program in its scope.',
      source: 'ird/db_lookups.rs — lookup_account_range → card_program_identifier'
    },
    {
      term: 'Geography', full: 'IRD geography',
      short: 'Whether the transaction is domestic, intra-regional or inter-regional.',
      long: 'One of IND, SGP, HKG (intracountry and B2B), APAC (Asia/Pacific intraregional) or INTER_REGION. It is decided by comparing the acquirer’s country / region with the issuer’s. Every IRD belongs to exactly one geography, so getting this wrong makes every candidate wrong.',
      source: 'ird/transaction.rs — IrdGeography'
    },
    {
      term: 'AB programs', full: 'Acceptance business programs',
      short: 'Programmes a merchant category code participates in.',
      long: 'Derived from the MCC. Some IRDs only apply to merchants in particular programmes (for example specific supermarket or petrol programmes); those IRDs list the programme codes and the matcher requires an overlap.',
      source: 'ird/db_lookups.rs — lookup_ab_programs_for_txn'
    },
    {
      term: 'Score & reasons', full: 'How the matcher ranks candidates',
      short: 'Each rule a candidate satisfies adds to its score; the reasons list says exactly which rules passed or failed.',
      long: 'Step A narrows candidates in SQL by geography, MTI, processing code, function code, AB programs, card program, GCMS product and the effective-date window. Step B evaluates the harder rules in Rust — country conditionals, amount thresholds, restrictions, PER — and records an OK or REJECT line for each. Highest score wins; ties break on ird_code.',
      source: 'ird/evaluator.rs — RuleResult'
    }
  ];
  var glossaryByTerm = {}; GLOSSARY.forEach(function (g) { glossaryByTerm[g.term] = g; });

  /* ---- Sample IRD candidates ---------------------------------------------
     Standing in for rows of {schema}.irds joined to {schema}.ird_scope. */
  function cand(o) {
    return {
      ird_id: o.id, geography: o.geo, ird_code: o.code, variant: o.variant || null,
      description: o.desc, source_version: o.version || '2025-Q4',
      effective_from: o.from || '2025-04-12', effective_to: o.to || null,
      card_program_ids: o.programs || [], gcms_product_ids: o.products || [],
      score: o.score, reasons: o.reasons
    };
  }

  /* ---- Reject queue ------------------------------------------------------
     Rows the ops user sees: entity_transactions in a REJECTED_STATUSES state. */
  var rejects = [];
  function add(r) {
    r.resolution = null;          // filled in once an IRD is applied
    r.status = r.status || 'staging_reject';
    rejects.push(r);
    return r;
  }

  add({
    id: 'txn_9f21a04c',
    arn: '74537815324000123456789',
    merchant: 'Cleartrip Travel',
    merchantId: 'cleartrip_in',
    amountMinor: 1849900, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000042',
    reasonCode: '2569',
    stagedIrd: '35',
    hoursAgo: 7,
    context: {
      pan_masked: '5432 12** **** 8891', card_bin: '543212',
      mcc: '4722', mcc_desc: 'Travel agencies and tour operators',
      geography: 'IND', geography_region: 'IND',
      acquirer_country_alpha3: 'IND', acquirer_region: 'C', issuer_region: 'C',
      card_program_id: 'MCC', gcms_product_id: 'MCC',
      account_range: '5432120000000000 – 5432129999999999',
      ab_programs: ['F001', 'T014'],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 1849900,
      has_acceptor_field: { name: true, city: true, postcode: true }
    },
    error: null,
    candidates: [
      cand({
        id: 40118, geo: 'IND', code: '38', desc: 'India intracountry — consumer credit, travel & entertainment',
        programs: ['MCC'], products: ['MCC'], score: 7,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: processing_code 0 in candidate processing_codes',
          'OK: function_code 200 in candidate function_codes',
          'OK: ab_program F001 overlaps candidate ab_programs',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope'
        ]
      }),
      cand({
        id: 40126, geo: 'IND', code: '38', variant: 'E', desc: 'India intracountry — consumer credit, travel & entertainment (electronic presentment)',
        programs: ['MCC'], products: ['MCC'], score: 6,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope',
          'OK: acceptor name/city/postcode present',
          'REJECT: electronic presentment requires pos_entry_mode in [05, 07]; found 01'
        ]
      }),
      cand({
        id: 40203, geo: 'IND', code: '35', desc: 'India intracountry — consumer credit, standard',
        programs: ['MCC'], products: ['MCC'], score: 4,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope',
          'REJECT: ab_programs [F001, T014] do not overlap candidate ab_programs [F900]'
        ]
      })
    ]
  });

  add({
    id: 'txn_3ab77e10',
    arn: '74537815324000987654321',
    merchant: 'BigBasket',
    merchantId: 'bigbasket_in',
    amountMinor: 234500, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000042',
    reasonCode: '2569',
    stagedIrd: null,
    hoursAgo: 7,
    context: {
      pan_masked: '5311 09** **** 4402', card_bin: '531109',
      mcc: '5411', mcc_desc: 'Grocery stores and supermarkets',
      geography: 'IND', geography_region: 'IND',
      acquirer_country_alpha3: 'IND', acquirer_region: 'C', issuer_region: 'C',
      card_program_id: 'MSI', gcms_product_id: 'DMC',
      account_range: '5311090000000000 – 5311099999999999',
      ab_programs: ['F900'],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 234500,
      has_acceptor_field: { name: true, city: true, postcode: true }
    },
    error: null,
    candidates: [
      cand({
        id: 40551, geo: 'IND', code: '52', desc: 'India intracountry — debit, supermarket programme',
        programs: ['MSI'], products: ['DMC'], score: 8,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: processing_code 0 in candidate processing_codes',
          'OK: function_code 200 in candidate function_codes',
          'OK: ab_program F900 overlaps candidate ab_programs',
          'OK: card_program_id MSI in scope',
          'OK: gcms_product_id DMC in scope',
          'OK: amount 2,345.00 INR below threshold 200,000.00'
        ]
      }),
      cand({
        id: 40552, geo: 'IND', code: '54', desc: 'India intracountry — debit, standard',
        programs: ['MSI'], products: ['DMC'], score: 6,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MSI in scope',
          'OK: gcms_product_id DMC in scope',
          'OK: function_code 200 in candidate function_codes',
          'OK: processing_code 0 in candidate processing_codes'
        ]
      })
    ]
  });

  add({
    id: 'txn_c7710b93',
    arn: '74537815324000555512345',
    merchant: 'Nykaa',
    merchantId: 'nykaa_in',
    amountMinor: 899000, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000042',
    reasonCode: '0011',
    stagedIrd: null,
    hoursAgo: 7,
    context: {
      pan_masked: '5299 44** **** 1130', card_bin: '529944',
      mcc: '5977', mcc_desc: 'Cosmetic stores',
      geography: null, geography_region: null,
      acquirer_country_alpha3: 'IND', acquirer_region: 'C', issuer_region: null,
      card_program_id: null, gcms_product_id: null,
      account_range: null,
      ab_programs: [],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 899000,
      has_acceptor_field: { name: true, city: true, postcode: true }
    },
    error: 'AccountRangeNotFound',
    candidates: [
      cand({
        id: 40203, geo: 'IND', code: '35', desc: 'India intracountry — consumer credit, standard',
        programs: ['MCC'], products: ['MCC'], score: 3,
        reasons: [
          'OK: geography IND assumed from acquirer country IND',
          'OK: mti 1240 in candidate mtis',
          'OK: function_code 200 in candidate function_codes',
          'REJECT: card_program_id unknown — account range lookup returned no row',
          'REJECT: gcms_product_id unknown — account range lookup returned no row'
        ]
      }),
      cand({
        id: 40551, geo: 'IND', code: '52', desc: 'India intracountry — debit, supermarket programme',
        programs: ['MSI'], products: ['DMC'], score: 2,
        reasons: [
          'OK: geography IND assumed from acquirer country IND',
          'OK: mti 1240 in candidate mtis',
          'REJECT: ab_programs [] do not overlap candidate ab_programs [F900]',
          'REJECT: card_program_id unknown — account range lookup returned no row'
        ]
      })
    ]
  });

  add({
    id: 'txn_51de8802',
    arn: '74537815324000778899001',
    merchant: 'Zomato',
    merchantId: 'zomato_in',
    amountMinor: 62500, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000043',
    reasonCode: '2569',
    stagedIrd: '38',
    hoursAgo: 6,
    context: {
      pan_masked: '5432 12** **** 7741', card_bin: '543212',
      mcc: '5814', mcc_desc: 'Fast food restaurants',
      geography: 'IND', geography_region: 'IND',
      acquirer_country_alpha3: 'IND', acquirer_region: 'C', issuer_region: 'C',
      card_program_id: 'MCC', gcms_product_id: 'MCC',
      account_range: '5432120000000000 – 5432129999999999',
      ab_programs: [],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 62500,
      has_acceptor_field: { name: true, city: true, postcode: false }
    },
    error: 'AbProgramsNotFound',
    candidates: [
      cand({
        id: 40203, geo: 'IND', code: '35', desc: 'India intracountry — consumer credit, standard',
        programs: ['MCC'], products: ['MCC'], score: 6,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: processing_code 0 in candidate processing_codes',
          'OK: function_code 200 in candidate function_codes',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope'
        ]
      }),
      cand({
        id: 40118, geo: 'IND', code: '38', desc: 'India intracountry — consumer credit, travel & entertainment',
        programs: ['MCC'], products: ['MCC'], score: 4,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope',
          'REJECT: ab_programs [] do not overlap candidate ab_programs [F001, T014]'
        ]
      })
    ]
  });

  add({
    id: 'txn_8e04fa27',
    arn: '74537815324000112233445',
    merchant: 'Singapore Airlines',
    merchantId: 'sq_sg',
    amountMinor: 128000, currency: 'SGD',
    txnDate: ago(1), authDate: ago(2),
    entity: 'HSBC_SG', tenantId: 'hsbc_sg', gateway: 'MASTERCARD',
    file: 'TN72T2.' + ago(1), batch: '00000011',
    reasonCode: '2569',
    stagedIrd: '21',
    hoursAgo: 9,
    context: {
      pan_masked: '5425 23** **** 0006', card_bin: '542523',
      mcc: '3000', mcc_desc: 'Airlines',
      geography: 'INTER_REGION', geography_region: 'INTER_REGION',
      acquirer_country_alpha3: 'SGP', acquirer_region: 'C', issuer_region: 'A',
      card_program_id: 'MCC', gcms_product_id: 'MCC',
      account_range: '5425230000000000 – 5425239999999999',
      ab_programs: ['T014'],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 128000,
      has_acceptor_field: { name: true, city: true, postcode: true }
    },
    error: null,
    // Deliberate tie — mod.rs warns on this and breaks the tie on ird_code.
    candidates: [
      cand({
        id: 41001, geo: 'INTER_REGION', code: '17', desc: 'Interregional — consumer credit, airline',
        programs: ['MCC'], products: ['MCC'], score: 6,
        reasons: [
          'OK: geography INTER_REGION matches',
          'OK: issuer_region A in scope',
          'OK: acquirer_region C in scope',
          'OK: mti 1240 in candidate mtis',
          'OK: ab_program T014 overlaps candidate ab_programs',
          'OK: card_program_id MCC in scope'
        ]
      }),
      cand({
        id: 41014, geo: 'INTER_REGION', code: '19', desc: 'Interregional — consumer credit, standard',
        programs: ['MCC'], products: ['MCC'], score: 6,
        reasons: [
          'OK: geography INTER_REGION matches',
          'OK: issuer_region A in scope',
          'OK: acquirer_region C in scope',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MCC in scope',
          'OK: gcms_product_id MCC in scope'
        ]
      })
    ]
  });

  add({
    id: 'txn_2b90cc55',
    arn: '74537815324000664422880',
    merchant: 'Reliance Retail',
    merchantId: 'reliance_in',
    amountMinor: 4520000, currency: 'INR',
    txnDate: ago(2), authDate: ago(2),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(2), batch: '00000039',
    reasonCode: '2569',
    stagedIrd: '52',
    hoursAgo: 31,
    context: {
      pan_masked: '5311 09** **** 2218', card_bin: '531109',
      mcc: '5411', mcc_desc: 'Grocery stores and supermarkets',
      geography: 'IND', geography_region: 'IND',
      acquirer_country_alpha3: 'IND', acquirer_region: 'C', issuer_region: 'C',
      card_program_id: 'MSI', gcms_product_id: 'DMC',
      account_range: '5311090000000000 – 5311099999999999',
      ab_programs: ['F900'],
      processing_code: 0, mti: '1240', function_code: 200,
      amount_minor_units: 4520000,
      has_acceptor_field: { name: true, city: true, postcode: true }
    },
    error: null,
    candidates: [
      cand({
        id: 40553, geo: 'IND', code: '56', desc: 'India intracountry — debit, high value',
        programs: ['MSI'], products: ['DMC'], score: 8,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: processing_code 0 in candidate processing_codes',
          'OK: function_code 200 in candidate function_codes',
          'OK: card_program_id MSI in scope',
          'OK: gcms_product_id DMC in scope',
          'OK: ab_program F900 overlaps candidate ab_programs',
          'OK: amount 45,200.00 INR at or above threshold 20,000.00'
        ]
      }),
      cand({
        id: 40551, geo: 'IND', code: '52', desc: 'India intracountry — debit, supermarket programme',
        programs: ['MSI'], products: ['DMC'], score: 5,
        reasons: [
          'OK: geography IND matches',
          'OK: mti 1240 in candidate mtis',
          'OK: card_program_id MSI in scope',
          'OK: gcms_product_id DMC in scope',
          'REJECT: amount 45,200.00 INR exceeds candidate threshold 20,000.00'
        ]
      })
    ]
  });

  // Not an IRD reject — proves the queue is the whole reject queue, filterable
  // down to the IRD ones, rather than an IRD-only screen.
  add({
    id: 'txn_44a1de60',
    arn: '74537815324000333344445',
    merchant: 'Swiggy',
    merchantId: 'swiggy_in',
    amountMinor: 41200, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000043',
    reasonCode: '0301',
    stagedIrd: '35', hoursAgo: 6,
    status: 'incoming_reject',
    context: null, error: null, candidates: []
  });

  add({
    id: 'txn_77cc1204',
    arn: '74537815324000999900001',
    merchant: 'MakeMyTrip',
    merchantId: 'mmt_in',
    amountMinor: 7650000, currency: 'INR',
    txnDate: ago(1), authDate: ago(1),
    entity: 'HSBC_IN', tenantId: 'hsbc_in', gateway: 'MASTERCARD',
    file: 'TN70T1.' + ago(1), batch: '00000043',
    reasonCode: '2001',
    stagedIrd: '38', hoursAgo: 6,
    status: 'incoming_reject',
    context: null, error: null, candidates: []
  });

  var byId = {}; rejects.forEach(function (r) { byId[r.id] = r; });

  /* ---- Audit trail (§6.4) — every apply is recorded, whatever the approval
         policy turns out to be. ------------------------------------------- */
  var audit = [];

  /* ---- Helpers ----------------------------------------------------------- */
  function reasonText(code) { return REJECT_REASONS[String(code)] || 'Unknown reject reason ' + code; }
  // Ranking is mod.rs's: score desc, then ird_code asc, then variant asc, then id.
  function ranked(r) {
    return (r.candidates || []).slice().sort(function (a, b) {
      return (b.score - a.score) ||
        String(a.ird_code).localeCompare(String(b.ird_code)) ||
        String(a.variant || '').localeCompare(String(b.variant || '')) ||
        (a.ird_id - b.ird_id);
    });
  }
  function recommended(r) {
    var list = ranked(r).filter(function (c) { return !c.reasons.some(isReject); });
    return list.length ? list[0] : null;
  }
  function isReject(line) { return String(line).indexOf('REJECT:') === 0; }
  // mod.rs warns when the top two matches share a score — Ops should see that.
  function hasTie(r) {
    var m = ranked(r).filter(function (c) { return !c.reasons.some(isReject); });
    return m.length >= 2 && m[0].score === m[1].score;
  }
  function irdStatus(r) {
    if (r.resolution) return 'resolved';
    if (!isIrdReason(r.reasonCode)) return 'not_ird';
    if (r.error) return 'blocked';
    if (!r.stagedIrd) return 'missing';
    var rec = recommended(r);
    if (rec && rec.ird_code !== r.stagedIrd) return 'wrong';
    return 'unresolved';
  }
  function open() {
    return rejects.filter(function (r) { return !r.resolution; });
  }
  function irdOpen() {
    return open().filter(function (r) { return isIrdReason(r.reasonCode); });
  }
  function money(minor, ccy) {
    var v = (minor || 0) / 100;
    return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (ccy || '');
  }

  /* ---- Apply + recreate (wraps the existing reject-clearing trigger) ------
     TriggerRejectClearingRequest { tenant_id, gateway, entity } →
     TriggerRejectClearingResponse { status, rows_found, file_uuid,
     cycle_decision, clearing_triggered, ... }  (reject_clearing/service.rs) */
  var _uuidSeq = 0;
  function fakeUuid() {
    _uuidSeq += 1;
    var n = ('0000' + _uuidSeq).slice(-4);
    return 'f1e2d3c4-' + n + '-4a7b-9c8d-5e6f70a1b2c3';
  }
  function applyIrd(rows, pick, reason, who, stamp) {
    // pick: { mode: 'single', ird } or { mode: 'per_row' } using row.chosenIrd
    var uuid = fakeUuid();
    var decision = rows.length > 3 ? 'NEW_NEXT_AVAILABLE_CYCLE' : 'EXISTING_CURRENT_CYCLE';
    rows.forEach(function (r) {
      var chosen = pick.mode === 'single' ? pick.ird : r.chosenIrd;
      var c = (r.candidates || []).filter(function (x) { return x.ird_code === chosen; })[0];
      r.resolution = {
        previousIrd: r.stagedIrd, ird: chosen, irdId: c ? c.ird_id : null,
        reason: reason, by: who, at: stamp,
        status: RESOLVED_REJECT_STATUS,
        fileUuid: uuid, cycleDecision: decision, clearingTriggered: decision !== 'WAITING_FOR_NEXT_CYCLE'
      };
      audit.unshift({
        at: stamp, by: who, txnId: r.id, arn: r.arn, entity: r.entity,
        previousIrd: r.stagedIrd, ird: chosen, reason: reason,
        candidatesShown: (r.candidates || []).map(function (x) { return x.ird_code + ' (score ' + x.score + ')'; }),
        fileUuid: uuid, cycleDecision: decision
      });
    });
    return {
      status: true, rows_found: rows.length, file_uuid: uuid,
      cycle_decision: decision, clearing_triggered: decision !== 'WAITING_FOR_NEXT_CYCLE',
      tenant_id: rows[0] ? rows[0].tenantId : '', gateway: 'MASTERCARD'
    };
  }

  return {
    REJECTED_STATUSES: REJECTED_STATUSES, RESOLVED_REJECT_STATUS: RESOLVED_REJECT_STATUS,
    CYCLE_DECISIONS: CYCLE_DECISIONS,
    REJECT_REASONS: REJECT_REASONS, IRD_REASON_CODES: IRD_REASON_CODES, isIrdReason: isIrdReason,
    IRD_ERRORS: IRD_ERRORS, GLOSSARY: GLOSSARY, glossaryByTerm: glossaryByTerm,
    rejects: rejects, byId: byId, audit: audit,
    reasonText: reasonText, ranked: ranked, recommended: recommended, isReject: isReject,
    hasTie: hasTie, irdStatus: irdStatus, open: open, irdOpen: irdOpen, money: money,
    applyIrd: applyIrd
  };
})();
