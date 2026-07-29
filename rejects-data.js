/* =============================================================================
   Juspay Ops Portal — Rejects: mock store

   Replaces the old IRD-only reject store. Two reject families, both networks:

     staging   — the network refused the clearing file at submission. Nothing
                 from that cycle cleared.
     incoming  — the file staged fine; individual transactions were rejected
                 when the network processed them in a later cycle.

   IRD rejects (Mastercard reason 0221 / 0225) are a subtype of the incoming
   family — they get the recommendation panel, not a separate screen.

   Everything here is deterministic: a seeded RNG drives every generated value,
   so the same demo renders identically on every reload. No browser storage —
   the module owns its state in memory and mutates it in place.

   Shapes this mirrors in the real platform:
     reject flow      src_crates/rest_api/src/reject_clearing/{model,service}.rs
     reject reasons   src_crates/rest_api/config/reject_reasons.json
     IRD matcher      src_crates/file_processor/.../mastercard/ird/
   The reason codes below are the network-published Visa / Mastercard codes the
   brief specifies; the IRD recommendation engine is a deterministic mock, not a
   port of the matcher.
   ============================================================================= */
window.REJDATA = (function () {
  'use strict';
  var D = window.DATA, U = D.util, O = window.OPS;
  var TODAY = D.TODAY;                                   // 2025-11-21
  function ago(n) { return U.addDays(TODAY, -n); }

  /* ---- Deterministic RNG (same shape as ops-data.js) --------------------- */
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
  function pad(n, w) { return ('0000000000' + n).slice(-w); }

  /* =======================================================================
     1 · Lifecycle (Part 2)
     ======================================================================= */
  var LIFECYCLE = {
    new: { label: 'New', kind: 'danger', icon: 'alert-circle', order: 1, open: true, note: 'Reject received, not yet worked' },
    under_correction: { label: 'Under correction', kind: 'info', icon: 'pencil', order: 2, open: true, note: 'Someone is editing the transaction' },
    corrected: { label: 'Corrected', kind: 'warning', icon: 'check', order: 3, open: true, note: 'Fields updated, clearing file not yet regenerated' },
    regenerated: { label: 'Regenerated', kind: 'info', icon: 'file-plus', order: 4, open: true, note: 'New clearing file produced, not yet submitted' },
    resubmitted: { label: 'Resubmitted', kind: 'neutral', icon: 'send', order: 5, open: true, note: 'File sent to network, awaiting confirmation' },
    cleared: { label: 'Cleared', kind: 'success', icon: 'check-circle', order: 6, open: false, note: 'Confirmed accepted in a subsequent cycle' },
    re_rejected: { label: 'Re-rejected', kind: 'danger', icon: 'rotate-ccw', order: 0, open: true, note: 'Rejected again after resubmission' },
    wont_fix: { label: "Won't fix", kind: 'neutral', icon: 'ban', order: 7, open: false, note: 'Cannot be corrected — written off' }
  };
  // Display order for the progress bar and the status filter.
  var LIFECYCLE_ORDER = ['re_rejected', 'new', 'under_correction', 'corrected', 'regenerated', 'resubmitted', 'cleared', 'wont_fix'];
  function isOpen(t) { return !!(LIFECYCLE[t.status] || {}).open; }

  /* =======================================================================
     2 · Reason codes (Part 7.2)
     ======================================================================= */
  var REASONS = {
    // Mastercard
    '0221': { network: 'Mastercard', text: 'Invalid IRD for transaction type', ird: true },
    '0225': { network: 'Mastercard', text: 'IRD not valid for merchant category', ird: true },
    '0104': { network: 'Mastercard', text: 'Invalid merchant category code' },
    '0117': { network: 'Mastercard', text: 'Invalid transaction amount' },
    '0142': { network: 'Mastercard', text: 'Invalid acquirer reference number' },
    '0208': { network: 'Mastercard', text: 'Missing required data element' },
    '0311': { network: 'Mastercard', text: 'Invalid card product code' },
    // Visa
    '0501': { network: 'Visa', text: 'Invalid transaction date' },
    '0512': { network: 'Visa', text: 'Amount mismatch with authorization' },
    '0523': { network: 'Visa', text: 'Invalid merchant category code' },
    '0541': { network: 'Visa', text: 'Missing required field' },
    '0567': { network: 'Visa', text: 'Invalid acquirer BIN' },
    '0588': { network: 'Visa', text: 'Duplicate transaction reference' }
  };
  function reasonText(code) { return (REASONS[code] || {}).text || 'Unknown reject reason'; }
  function isIrd(code) { return !!(REASONS[code] || {}).ird; }

  // The raw line the network's reject file carries, where it carries one. Kept
  // verbatim-looking because Ops cross-reads it against the network's report.
  var RAW = {
    '0221': 'DE060 SF2 IRD "{ird}" NOT VALID FOR MTI 1240 / PROC CODE 00 — GCMS EDIT 0221',
    '0225': 'DE060 SF2 IRD "{ird}" NOT PERMITTED FOR CARD ACCEPTOR BUSINESS CODE {mcc} — GCMS EDIT 0225',
    '0104': 'DE026 CARD ACCEPTOR BUSINESS CODE {mcc} NOT IN ISO 18245 TABLE — GCMS EDIT 0104',
    '0117': 'DE004 TRANSACTION AMOUNT FAILS RANGE EDIT FOR DE049 {currency} — GCMS EDIT 0117',
    '0142': 'DE031 ACQUIRER REFERENCE DATA CHECK DIGIT INVALID — GCMS EDIT 0142',
    '0208': 'DE043 CARD ACCEPTOR NAME/LOCATION INCOMPLETE — MANDATORY SUBFIELD ABSENT — GCMS EDIT 0208',
    '0311': 'DE063 CARD PRODUCT CODE "{cardProduct}" NOT DEFINED FOR ISSUER ACCOUNT RANGE — GCMS EDIT 0311',
    '0501': 'TCR0 PURCHASE DATE {txnDate} OUTSIDE PERMITTED PRESENTMENT WINDOW — V.I.P. EDIT 0501',
    '0512': 'TCR0 TRANSACTION AMOUNT DOES NOT MATCH AUTHORIZED AMOUNT {authAmount} — V.I.P. EDIT 0512',
    '0523': 'TCR0 MERCHANT CATEGORY CODE {mcc} INVALID FOR ACQUIRER BIN {acquirerBin} — V.I.P. EDIT 0523',
    '0541': 'TCR1 REQUIRED FIELD MERCHANT NAME/CITY NOT PRESENT — V.I.P. EDIT 0541',
    '0567': 'TCR0 ACQUIRING INSTITUTION ID {acquirerBin} NOT REGISTERED FOR THIS BIN RANGE — V.I.P. EDIT 0567',
    '0588': 'TCR0 TRANSACTION IDENTIFIER {txnRef} ALREADY PRESENTED IN CYCLE — V.I.P. EDIT 0588'
  };
  function rawMessage(txn) {
    var tpl = RAW[txn.reasonCode];
    if (!tpl) return null;
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return String(txn.fields[k] == null ? '—' : txn.fields[k]); });
  }

  /* =======================================================================
     3 · Editable field catalogue + reason-code → field lookup (Part 3.3)
     ======================================================================= */
  var FIELDS = {
    ird: { label: 'Interchange Rate Designator', group: 'Interchange', mono: true, help: '2 characters. Mastercard IRD from the current interchange manual.' },
    posEntryMode: { label: 'POS entry mode', group: 'Terminal', mono: true, help: '2 digits — 01 key-entered · 05 chip · 07 contactless · 81 e-commerce' },
    contactless: { label: 'Contactless', group: 'Terminal', type: 'select', options: ['Yes', 'No'], help: 'Derived from POS entry mode 07 on the original presentment.' },
    mcc: { label: 'Merchant category code', group: 'Merchant', mono: true, help: '4 digits, ISO 18245.' },
    merchantName: { label: 'Card acceptor name', group: 'Merchant', help: 'Max 22 characters as presented to the network.' },
    merchantId: { label: 'Merchant ID (MID)', group: 'Merchant', mono: true, help: '15 digits, acquirer-assigned.' },
    terminalId: { label: 'Terminal ID (TID)', group: 'Terminal', mono: true, help: '8 characters, acquirer-assigned.' },
    acquirerBin: { label: 'Acquirer BIN', group: 'Acquirer', mono: true, help: '6 digits. Must be registered for this network and region.' },
    acceptorName: { label: 'Acceptor name (DE43 SF1)', group: 'Acceptor address', help: 'Mandatory. Max 25 characters.' },
    acceptorCity: { label: 'Acceptor city (DE43 SF3)', group: 'Acceptor address', help: 'Mandatory. Max 13 characters.' },
    acceptorPostcode: { label: 'Acceptor postcode (DE43 SF4)', group: 'Acceptor address', mono: true, help: 'Mandatory for domestic presentments.' },
    amount: { label: 'Transaction amount', group: 'Amounts', mono: true, help: 'Major units, 2 decimals. Must equal the cleared amount.' },
    authAmount: { label: 'Authorized amount', group: 'Amounts', mono: true, help: 'Major units, 2 decimals, as returned on the authorization.' },
    currency: { label: 'Currency code', group: 'Amounts', mono: true, help: '3-digit ISO 4217 numeric — 356 INR · 702 SGD · 344 HKD.' },
    conversionRate: { label: 'Conversion rate', group: 'Amounts', mono: true, help: '6 decimals. 1.000000 when settlement and transaction currency match.' },
    pan: { label: 'Primary account number', group: 'Card', mono: true, help: 'Masked at rest. Only the BIN and last 4 are editable.' },
    expiry: { label: 'Card expiry', group: 'Card', mono: true, help: 'MM/YY.' },
    cardProduct: { label: 'Card product code', group: 'Card', mono: true, help: '3 characters — e.g. MCC consumer credit, DMC debit, MCW world.' },
    arn: { label: 'Acquirer reference number', group: 'References', mono: true, help: '16 digits. Check digit is the last position.' },
    txnRef: { label: 'Transaction reference', group: 'References', mono: true, help: '15 characters. Must be unique within the cycle.' },
    txnDate: { label: 'Transaction date', group: 'Dates', mono: true, help: 'YYYY-MM-DD. Must fall inside the presentment window.' },
    processingDate: { label: 'Processing date', group: 'Dates', mono: true, help: 'YYYY-MM-DD. The date the file was built.' },
    settlementDate: { label: 'Settlement date', group: 'Dates', mono: true, help: 'YYYY-MM-DD. The network settlement cycle date.' }
  };
  // Every field, in the order "Show all fields" reveals them.
  var ALL_FIELDS = ['ird', 'posEntryMode', 'contactless', 'mcc', 'merchantName', 'merchantId', 'terminalId',
    'acquirerBin', 'acceptorName', 'acceptorCity', 'acceptorPostcode', 'amount', 'authAmount', 'currency',
    'conversionRate', 'pan', 'expiry', 'cardProduct', 'arn', 'txnRef', 'txnDate', 'processingDate', 'settlementDate'];

  // Part 3.3 — which fields a reject's reason code makes relevant. Surfaced
  // first; everything else stays behind "Show all fields".
  var REASON_FIELDS = {
    '0221': ['ird', 'posEntryMode', 'contactless', 'mcc'],
    '0225': ['ird', 'mcc', 'cardProduct'],
    '0104': ['mcc', 'merchantName'],
    '0117': ['amount', 'currency', 'conversionRate'],
    '0142': ['arn', 'acquirerBin', 'txnRef'],
    '0208': ['acceptorName', 'acceptorCity', 'acceptorPostcode', 'terminalId'],
    '0311': ['cardProduct', 'pan', 'expiry'],
    '0501': ['txnDate', 'processingDate', 'settlementDate'],
    '0512': ['amount', 'authAmount', 'currency', 'conversionRate'],
    '0523': ['mcc', 'merchantName'],
    '0541': ['acceptorName', 'acceptorCity', 'terminalId'],
    '0567': ['acquirerBin', 'merchantId', 'terminalId'],
    '0588': ['txnRef', 'arn', 'txnDate']
  };
  function relevantFields(code) { return REASON_FIELDS[code] || []; }
  function otherFields(code) {
    var rel = relevantFields(code);
    return ALL_FIELDS.filter(function (f) { return rel.indexOf(f) < 0; });
  }

  /* =======================================================================
     4 · IRD recommendation engine (Part 4.3) — deterministic mock
     -----------------------------------------------------------------------
     An IRD is derived from five attributes. The mock composes the code from
     them arithmetically, which gives two things the panel needs: the same
     transaction always yields the same answer, and varying exactly one
     attribute yields a different code that can be explained as "what would
     have to be different for this one to be right".
     ======================================================================= */
  var REGION_BASE = { 'Domestic': 20, 'Intra-regional': 18, 'Inter-regional': 12 };
  var CARD_OFF = { 'Credit': 1, 'Debit': 5 };
  var MCC_OFF = {
    '5411': 0, '5311': 0, '5812': 2, '5814': 2, '5651': 3, '5732': 3,
    '5941': 4, '5999': 4, '7999': 5, '4511': 6, '7011': 7
  };
  var ENTRY = {
    '01': { label: 'key-entered', off: 2 },
    '05': { label: 'chip-read', off: 0 },
    '07': { label: 'contactless', off: 1 },
    '81': { label: 'e-commerce', off: 3 }
  };
  var REGIONS = ['Domestic', 'Intra-regional', 'Inter-regional'];
  var MCC_ALT = {
    '5411': ['5812', '5999'], '5311': ['5411', '5651'], '5812': ['5411', '5814'],
    '5814': ['5812', '5411'], '5651': ['5311', '5999'], '5732': ['5999', '5411'],
    '5941': ['5999', '5651'], '5999': ['5411', '5732'], '7999': ['7011', '5999'],
    '4511': ['7011', '5999'], '7011': ['4511', '5812']
  };
  function mccLabel(m) { return D.MCC[m] || 'Merchant category ' + m; }
  function mccOff(m) { return MCC_OFF[m] != null ? MCC_OFF[m] : 3; }
  function entryOff(e) { return ENTRY[e] ? ENTRY[e].off : 0; }
  function entryLabel(e) { return ENTRY[e] ? ENTRY[e].label : 'entry mode ' + e; }

  function irdCode(a) {
    var base = REGION_BASE[a.region] != null ? REGION_BASE[a.region] : REGION_BASE.Domestic;
    return String(base + (CARD_OFF[a.card] != null ? CARD_OFF[a.card] : 1) + mccOff(a.mcc) + entryOff(a.entry));
  }
  function irdDesc(a) {
    return a.region + ' · consumer ' + String(a.card || 'credit').toLowerCase() + ' · ' +
      mccLabel(a.mcc).toLowerCase() + ' · ' + entryLabel(a.entry);
  }
  function cloneAttrs(a, k, v) {
    var o = { mcc: a.mcc, region: a.region, card: a.card, entry: a.entry };
    o[k] = v; o.contactless = o.entry === '07' ? 'Yes' : 'No';
    return o;
  }
  function regionPhrase(r) {
    return { 'Domestic': 'domestic', 'Intra-regional': 'intra-regional', 'Inter-regional': 'inter-regional' }[r] || String(r).toLowerCase();
  }

  // Candidates that differ from the transaction on exactly one attribute, each
  // carrying the sentence that says which assumption would have to change.
  //
  // The four axes are round-robined rather than concatenated: an ops user gets
  // no diagnostic value from three entry-mode variants in a row, because they
  // all rest on the same question. One candidate per axis first — "was it
  // contactless?", "is the MCC right?", "is this really domestic?" — then a
  // second pass for depth.
  var AXES = ['entry', 'mcc', 'region', 'card'];
  var ENTRY_ORDER = ['07', '05', '01', '81'];
  // `unknown` marks axes the platform could not resolve. Where an axis is
  // unknown the engine still has to assume something to rank at all, but the
  // explanation must not state the assumption as fact — "rather than 5411" is
  // a lie when nobody knows what the MCC is.
  function candidates(attrs, unknown) {
    unknown = unknown || {};
    var byAxis = { entry: [], mcc: [], region: [], card: [] };
    function cand(axis, alt, why) {
      byAxis[axis].push({ code: irdCode(alt), why: why, axis: axis, desc: irdDesc(alt) });
    }
    ENTRY_ORDER.forEach(function (e) {
      if (e === attrs.entry) return;
      cand('entry', cloneAttrs(attrs, 'entry', e),
        'if the transaction was ' + entryLabel(e) + ' (entry mode ' + e + ')' +
        (unknown.entry ? ' — the entry mode on this transaction is unresolved' : ''));
    });
    (MCC_ALT[attrs.mcc] || ['5411', '5812']).forEach(function (m) {
      if (m === attrs.mcc) return;
      cand('mcc', cloneAttrs(attrs, 'mcc', m),
        'if the merchant category were ' + m +
        (unknown.mcc ? ' — the MCC on this transaction is unresolved' : ' rather than ' + attrs.mcc));
    });
    REGIONS.forEach(function (rg) {
      if (rg === attrs.region) return;
      cand('region', cloneAttrs(attrs, 'region', rg),
        'if this were ' + regionPhrase(rg) +
        (unknown.region ? ' — the geography on this transaction is unresolved' : ' rather than ' + regionPhrase(attrs.region)));
    });
    ['Credit', 'Debit'].forEach(function (c) {
      if (c === attrs.card) return;
      cand('card', cloneAttrs(attrs, 'card', c),
        'if the card were ' + c.toLowerCase() +
        (unknown.card ? ' — the card type on this transaction is unresolved' : ' rather than ' + String(attrs.card).toLowerCase()));
    });

    var out = [], seen = {}, depth = 0, more = true;
    seen[irdCode(attrs)] = true;                 // never re-offer the top match
    while (more && depth < 4) {
      more = false;
      AXES.forEach(function (ax) {
        var c = byAxis[ax][depth];
        if (!c) return;
        more = true;
        if (seen[c.code]) return;                // two axes can land on one code
        seen[c.code] = true;
        out.push(c);
      });
      depth++;
    }
    return out;
  }

  var ATTR_KEYS = ['mcc', 'region', 'card', 'entry'];
  function recommend(txn) {
    var a = txn.attrs || {};
    var missing = ATTR_KEYS.filter(function (k) { return !a[k]; });
    var confidence = missing.length === 0 ? 'High' : (missing.length === 1 ? 'Medium' : 'Low');
    // Unknown attributes still have to resolve to something — the engine falls
    // back to the commonest value and says so through the lowered confidence.
    var filled = {
      mcc: a.mcc || '5411', region: a.region || 'Domestic',
      card: a.card || 'Credit', entry: a.entry || '05'
    };
    filled.contactless = filled.entry === '07' ? 'Yes' : 'No';
    var unknown = {};
    missing.forEach(function (k) { unknown[k] = true; });

    var attempted = (txn.attemptedIrds || []).slice();
    var ranked = [{ code: irdCode(filled), why: null, axis: 'match', desc: irdDesc(filled) }]
      .concat(candidates(filled, unknown));
    var excluded = ranked.filter(function (c) { return attempted.indexOf(c.code) >= 0; });
    var available = ranked.filter(function (c) { return attempted.indexOf(c.code) < 0; });

    var matched = [
      a.mcc ? 'MCC ' + a.mcc : 'MCC: unknown',
      a.region || 'Region: unknown',
      a.card || 'Card type: unknown',
      a.entry ? 'POS entry mode ' + a.entry : 'POS entry mode: unknown',
      'Contactless: ' + (a.entry ? (a.entry === '07' ? 'Yes' : 'No') : 'unknown')
    ];

    return {
      top: available[0] || null,
      alternatives: available.slice(1, 5),
      confidence: confidence,
      missing: missing,
      matched: matched,
      attempted: attempted,
      excluded: excluded,
      // True when the engine's first-choice code was knocked out by a prior
      // failed attempt — the panel says so rather than silently re-ranking.
      demoted: excluded.length > 0 && excluded[0].axis === 'match'
    };
  }

  /* =======================================================================
     5 · Batches + transactions (Part 7.1)
     ======================================================================= */
  var USERS = ['ops.analyst@juspay.in', 'priya.nair@juspay.in', 'ravi.kulkarni@juspay.in', 'meera.das@juspay.in'];
  var CURRENT_USER = 'ops.analyst@juspay.in';

  var ISO_CUR = { INR: '356', SGD: '702', HKD: '344' };
  var TENANT_TOKEN = { 'hsbc-in': 'HSBCIN', 'hsbc-sg': 'HSBCSG', 'hsbc-hk': 'HSBCHK', yesbank: 'YESBANK' };
  var NET_TOKEN = { Mastercard: 'MC', Visa: 'VISA' };
  var REGION_OF = { 'hsbc-in': 'Domestic', yesbank: 'Domestic', 'hsbc-sg': 'Intra-regional', 'hsbc-hk': 'Intra-regional' };

  // Reason-code rotation per network. Mastercard's rotation is 5 IRD codes in
  // 12 (~42%), comfortably over the 25% floor the brief sets.
  var MC_CYCLE = ['0221', '0104', '0225', '0117', '0221', '0142', '0208', '0221', '0311', '0225', '0117', '0142'];
  var VISA_CYCLE = ['0501', '0512', '0523', '0541', '0567', '0588', '0512', '0501', '0541', '0523'];

  var CITY = { 'hsbc-in': 'MUMBAI', yesbank: 'BENGALURU', 'hsbc-sg': 'SINGAPORE', 'hsbc-hk': 'HONG KONG' };
  var POSTCODE = { 'hsbc-in': '400051', yesbank: '560034', 'hsbc-sg': '238801', 'hsbc-hk': '999077' };

  function hhmm(r) { return pad(rint(r, 0, 23), 2) + ':' + pad(rint(r, 0, 59), 2); }
  function stamp(date, time) { return U.prettyDate(date) + ', ' + time + ' IST'; }
  function checksum(seed) {
    var r = rng(seed), out = '';
    for (var i = 0; i < 8; i++) out += '0123456789abcdef'[rint(r, 0, 15)];
    return 'sha256:' + out + '…' + '0123456789abcdef'[rint(r, 0, 15)] + '0123456789abcdef'[rint(r, 0, 15)];
  }

  // 16-digit ARN. Real ARNs are longer; the platform stores the 16-digit form
  // Ops scans against the network report, which is what this column is for.
  function makeArn(r) {
    var s = '74' + pad(rint(r, 100000, 999999), 6) + pad(rint(r, 10000000, 99999999), 8);
    return s.slice(0, 16);
  }

  var batches = [];
  var batchById = {};
  var txnById = {};
  var _seq = 0;

  function buildTxn(batch, i, recipeStatus, attemptCount, seed) {
    var r = rng(seed);
    var t = O.tenantById[batch.tenantId];
    var ms = O.merchantsByTenant[batch.tenantId] || [];
    var m = ms[(i * 5 + seed) % Math.max(1, ms.length)] || { name: 'Unknown Merchant', mid: '0000 0000 00000', mcc: '5999' };
    var cyc = MC_CYCLE, code;
    if (batch.network === 'Visa') cyc = VISA_CYCLE;
    code = cyc[i % cyc.length];

    var amount = Math.round((t.currency === 'INR' ? rint(r, 45000, 9800000) : rint(r, 900, 240000))) / 100;
    var txnDate = U.addDays(batch.cycleDate, -rint(r, 0, 2));
    var arn = makeArn(r);
    var entry = pick(r, ['05', '05', '07', '81', '01']);
    var region = REGION_OF[batch.tenantId] || 'Domestic';
    // A handful of inter-regional transactions per portfolio — the geography
    // that makes an IRD recommendation genuinely non-obvious.
    if (r() < 0.18) region = 'Inter-regional';
    var card = r() < 0.62 ? 'Credit' : 'Debit';

    var id = 'RJT-' + pad(++_seq, 5);
    var bin = batch.network === 'Mastercard' ? String(rint(r, 510000, 559999)) : String(rint(r, 400000, 499999));
    var last4 = pad(rint(r, 0, 9999), 4);

    var txn = {
      id: id,
      batchId: batch.id,
      arn: arn,
      merchant: m.name,
      mid: m.mid,
      amount: amount,
      currency: t.currency,
      txnDate: txnDate,
      txnTime: hhmm(r),
      reasonCode: code,
      status: recipeStatus,
      attempts: attemptCount || 1,
      assignee: recipeStatus === 'new' ? (r() < 0.35 ? pick(r, USERS) : null) : pick(r, USERS),
      attemptedIrds: [],
      attemptLog: [],
      history: [],
      wontFixNote: null,
      manualTag: null,
      attrs: {
        mcc: m.mcc, region: region, card: card,
        entry: entry, contactless: entry === '07' ? 'Yes' : 'No'
      },
      fields: {}
    };

    // The IRD actually staged and rejected. Deliberately one axis away from the
    // engine's answer, so the recommendation panel has something to say.
    var wrongAxis = cloneAttrs(txn.attrs, 'entry', entry === '05' ? '81' : '05');
    txn.fields = {
      ird: batch.network === 'Mastercard' ? irdCode(wrongAxis) : '—',
      posEntryMode: entry,
      contactless: txn.attrs.contactless,
      mcc: m.mcc,
      merchantName: String(m.name).toUpperCase().slice(0, 22),
      merchantId: String(m.mid).replace(/\s/g, ''),
      terminalId: 'T' + pad(rint(r, 0, 9999999), 7),
      acquirerBin: bin,
      acceptorName: String(m.name).toUpperCase().slice(0, 25),
      acceptorCity: CITY[batch.tenantId] || 'MUMBAI',
      acceptorPostcode: POSTCODE[batch.tenantId] || '400051',
      amount: amount.toFixed(2),
      authAmount: amount.toFixed(2),
      currency: ISO_CUR[t.currency] || '356',
      conversionRate: '1.000000',
      pan: bin.slice(0, 6) + ' ' + bin.slice(4, 6) + '** **** ' + last4,
      expiry: pad(rint(r, 1, 12), 2) + '/' + rint(r, 26, 30),
      cardProduct: batch.network === 'Mastercard' ? (card === 'Credit' ? 'MCC' : 'DMC') : (card === 'Credit' ? 'VCC' : 'VDB'),
      arn: arn,
      txnRef: 'TXR' + pad(rint(r, 0, 999999999999), 12),
      txnDate: txnDate,
      processingDate: batch.cycleDate,
      settlementDate: U.addDays(batch.cycleDate, 1)
    };

    // Reject-specific damage: the field the reason code points at is the one
    // that is actually wrong, so the surfaced field is worth editing.
    if (code === '0104' || code === '0523') txn.fields.mcc = '9' + m.mcc.slice(1);
    if (code === '0142') txn.fields.arn = arn.slice(0, 15) + '0';
    if (code === '0208' || code === '0541') { txn.fields.acceptorPostcode = ''; if (code === '0541') txn.fields.acceptorCity = ''; }
    if (code === '0311') txn.fields.cardProduct = 'XX' + (card === 'Credit' ? 'C' : 'D');
    if (code === '0512') txn.fields.authAmount = (amount - Math.round(amount * 0.07 * 100) / 100).toFixed(2);
    if (code === '0501') txn.fields.txnDate = U.addDays(batch.cycleDate, -34);
    if (code === '0567') txn.fields.acquirerBin = bin.slice(0, 5) + '9';
    if (code === '0117') txn.fields.currency = '999';

    // A few transactions arrive with attributes the platform could not resolve —
    // that is what drives Medium / Low confidence in the recommendation panel.
    if (isIrd(code) && seed % 7 === 0) txn.attrs.region = null;
    if (isIrd(code) && seed % 11 === 0) { txn.attrs.mcc = null; txn.attrs.card = null; }

    // Re-rejects carry their attempt history, and the IRDs already burned.
    if (txn.attempts > 1) {
      var prevIrd = txn.fields.ird;
      for (var k = 1; k < txn.attempts; k++) {
        var corrAt = stamp(U.addDays(batch.cycleDate, k), pad(rint(r, 9, 18), 2) + ':' + pad(rint(r, 0, 59), 2));
        var rejAt = stamp(U.addDays(batch.cycleDate, k + 1), '0' + rint(r, 3, 8) + ':' + pad(rint(r, 0, 59), 2));
        txn.attemptLog.push({ attempt: k, ird: prevIrd, correctedAt: corrAt, by: pick(r, USERS), rejectedAt: rejAt });
        if (batch.network === 'Mastercard' && isIrd(code)) txn.attemptedIrds.push(prevIrd);
        txn.history.push({
          at: corrAt, by: txn.attemptLog[k - 1].by, kind: 'correction',
          changes: [{ field: isIrd(code) ? 'ird' : relevantFields(code)[0], from: prevIrd, to: prevIrd }],
          note: 'Attempt ' + k + ' correction — re-rejected ' + rejAt + '.'
        });
        // Each failed attempt burned a different candidate.
        var burned = candidates(txn.attrs.region ? txn.attrs : { mcc: '5411', region: 'Domestic', card: 'Credit', entry: '05' });
        prevIrd = (burned[k - 1] || burned[0] || { code: prevIrd }).code;
      }
      if (batch.network === 'Mastercard' && isIrd(code)) txn.fields.ird = prevIrd;
    }

    // Transactions past Corrected already carry a recorded correction.
    var past = ['corrected', 'regenerated', 'resubmitted', 'cleared'];
    if (past.indexOf(recipeStatus) >= 0) {
      var f0 = relevantFields(code)[0] || 'mcc';
      var oldV = txn.fields[f0];
      var newV = correctedValue(f0, txn, m, r);
      txn.fields[f0] = newV;
      txn.history.push({
        at: stamp(U.addDays(batch.cycleDate, 1), pad(rint(r, 9, 17), 2) + ':' + pad(rint(r, 0, 59), 2)),
        by: txn.assignee || pick(r, USERS), kind: 'correction',
        changes: [{ field: f0, from: oldV, to: newV }],
        note: null
      });
    }
    if (recipeStatus === 'wont_fix') {
      txn.wontFixNote = pick(r, [
        'Duplicate presentment — the original cleared in the prior cycle. Written off against the rejection holdback.',
        'Merchant terminated; no valid acceptor data available to correct against. Written off.',
        'Authorization reversed by the issuer before clearing — nothing to resubmit.'
      ]);
      txn.manualTag = { label: 'manually marked', by: CURRENT_USER, at: stamp(U.addDays(batch.cycleDate, 2), '11:0' + rint(r, 0, 9)) };
    }
    return txn;
  }

  // What a corrected value plausibly becomes, per field.
  function correctedValue(field, txn, m, r) {
    if (field === 'ird') {
      var rec = recommend(txn);
      return rec.top ? rec.top.code : txn.fields.ird;
    }
    if (field === 'mcc') return m.mcc;
    if (field === 'arn') return txn.arn;
    if (field === 'acceptorName') return String(m.name).toUpperCase().slice(0, 25);
    if (field === 'acceptorCity') return CITY[txn.batchId] || 'MUMBAI';
    if (field === 'acceptorPostcode') return '400051';
    if (field === 'cardProduct') return txn.attrs.card === 'Credit' ? 'MCC' : 'DMC';
    if (field === 'amount') return txn.amount.toFixed(2);
    if (field === 'txnDate') return txn.txnDate;
    if (field === 'txnRef') return 'TXR' + pad(rint(r, 0, 999999999999), 12);
    if (field === 'acquirerBin') return txn.fields.acquirerBin.slice(0, 5) + '1';
    if (field === 'currency') return ISO_CUR[txn.currency] || '356';
    return txn.fields[field];
  }

  /* ---- Batch specs ------------------------------------------------------
     Staging counts and statuses come verbatim from Part 7.1; incoming batches
     spread the Part 7.4 lifecycle distribution across tenants and networks.
     Every reject count sits between 0.02% and 0.15% of the file. */
  var SPECS = [
    // --- 3 staging rejects (Part 7.1) ---
    { tenant: 'hsbc-in', network: 'Mastercard', family: 'staging', date: ago(1), fileTxns: 18420, recipe: { corrected: 4, new: 2 } },
    { tenant: 'yesbank', network: 'Visa', family: 'staging', date: ago(3), fileTxns: 12880, recipe: { cleared: 3 } },
    { tenant: 'hsbc-sg', network: 'Mastercard', family: 'staging', date: ago(6), fileTxns: 9240, recipe: { corrected: 8, re_rejected: 3 }, attempt3: 2 },
    // --- 12 incoming rejects ---
    { tenant: 'hsbc-in', network: 'Mastercard', family: 'incoming', date: ago(2), fileTxns: 21400, recipe: { cleared: 6, new: 5, under_correction: 1, corrected: 3, regenerated: 4, resubmitted: 3, re_rejected: 1, wont_fix: 1 }, attempt3: 1 },
    { tenant: 'hsbc-sg', network: 'Visa', family: 'incoming', date: ago(2), fileTxns: 14600, recipe: { cleared: 8, new: 3, corrected: 2, regenerated: 2, resubmitted: 2, re_rejected: 1 } },
    { tenant: 'hsbc-hk', network: 'Mastercard', family: 'incoming', date: ago(3), fileTxns: 11200, recipe: { cleared: 6, new: 3, corrected: 1, regenerated: 1, resubmitted: 2, wont_fix: 1 } },
    { tenant: 'yesbank', network: 'Mastercard', family: 'incoming', date: ago(4), fileTxns: 16800, recipe: { cleared: 5, new: 2, corrected: 2, regenerated: 2, re_rejected: 1 } },
    { tenant: 'hsbc-in', network: 'Visa', family: 'incoming', date: ago(5), fileTxns: 19900, recipe: { cleared: 5, new: 1, under_correction: 1, corrected: 1, regenerated: 1, resubmitted: 2 } },
    { tenant: 'hsbc-sg', network: 'Mastercard', family: 'incoming', date: ago(7), fileTxns: 9800, recipe: { cleared: 4, new: 2, corrected: 1, resubmitted: 1, re_rejected: 1 } },
    { tenant: 'hsbc-hk', network: 'Visa', family: 'incoming', date: ago(8), fileTxns: 8400, recipe: { cleared: 4, new: 2, regenerated: 1, wont_fix: 1 } },
    { tenant: 'yesbank', network: 'Visa', family: 'incoming', date: ago(9), fileTxns: 13100, recipe: { cleared: 4, new: 1, corrected: 1, resubmitted: 1 } },
    { tenant: 'hsbc-in', network: 'Mastercard', family: 'incoming', date: ago(11), fileTxns: 20100, recipe: { cleared: 2, new: 1, corrected: 1, re_rejected: 1 } },
    { tenant: 'hsbc-sg', network: 'Visa', family: 'incoming', date: ago(13), fileTxns: 12300, recipe: { cleared: 2, regenerated: 1, resubmitted: 1 } },
    { tenant: 'hsbc-hk', network: 'Mastercard', family: 'incoming', date: ago(16), fileTxns: 7900, recipe: { cleared: 2, wont_fix: 1 } },
    { tenant: 'yesbank', network: 'Mastercard', family: 'incoming', date: ago(19), fileTxns: 9600, recipe: { cleared: 1, new: 1 } }
  ];

  SPECS.forEach(function (spec, bi) {
    var seed = 90000 + bi * 137;
    var r = rng(seed);
    var t = O.tenantById[spec.tenant];
    var id = 'RJB-' + pad(1040 + bi, 4);
    var netTok = NET_TOKEN[spec.network], tenTok = TENANT_TOKEN[spec.tenant];
    var compact = spec.date.replace(/-/g, '');
    var avgTicket = t.currency === 'INR' ? 2050 : 62;

    var batch = {
      id: id,
      tenantId: spec.tenant,
      tenantName: t.name,
      currency: t.currency,
      network: spec.network,
      family: spec.family,
      cycleDate: spec.date,
      cycleDow: U.dow(spec.date),
      receivedAt: stamp(U.addDays(spec.date, 1), '0' + rint(r, 2, 6) + ':' + pad(rint(r, 0, 59), 2)),
      fileTxns: spec.fileTxns,
      fileValue: Math.round(spec.fileTxns * avgTicket * (0.85 + r() * 0.3) * 100) / 100,
      rejectFile: netTok + '_REJECT_' + tenTok + '_' + compact + (spec.family === 'staging' ? '_STG' : '_INC') + '.rpt',
      rejectFileSize: rint(r, 3, 48) + ' KB',
      clearingFile: netTok + '_CLEARING_' + tenTok + '_' + compact + '_R1.txt',
      clearingFileSize: (spec.fileTxns * 0.00042).toFixed(1) + ' MB',
      cohortFrom: U.addDays(spec.date, -2),
      cohortTo: spec.date,
      checksum: checksum(seed + 3),
      s3Prefix: 's3://juspay-clearing-out/' + spec.tenant + '/' + spec.network.toLowerCase() + '/outgoing/',
      txns: [],
      generated: []
    };

    // Expand the recipe into one status per transaction, re-rejects first so
    // they take the low indices and read first in the default sort.
    var statuses = [];
    LIFECYCLE_ORDER.forEach(function (st) {
      var n = spec.recipe[st] || 0;
      for (var i = 0; i < n; i++) statuses.push(st);
    });

    var attempt3Left = spec.attempt3 || 0;
    statuses.forEach(function (st, i) {
      var attempts = 1;
      if (st === 're_rejected') {
        if (attempt3Left > 0) { attempts = 3; attempt3Left--; } else { attempts = 2; }
      }
      var txn = buildTxn(batch, i, st, attempts, seed + i * 17 + 3);
      batch.txns.push(txn);
      txnById[txn.id] = txn;
    });

    // A batch whose corrections already went out carries the file that carried
    // them — the history table is append-only, so the seed rows are real rows.
    var already = batch.txns.filter(function (x) { return ['regenerated', 'resubmitted', 'cleared'].indexOf(x.status) >= 0; });
    if (already.length) {
      batch.generated.push({
        name: netTok + '_CLEARING_' + tenTok + '_' + compact + '_R2.txt',
        at: stamp(U.addDays(spec.date, 1), pad(rint(r, 12, 19), 2) + ':' + pad(rint(r, 0, 59), 2)),
        by: pick(r, USERS),
        count: already.length,
        value: Math.round(already.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100,
        currency: t.currency,
        delivery: r() < 0.5 ? 'Pushed to S3' : 'Downloaded',
        outcome: already.every(function (x) { return x.status === 'cleared'; }) ? 'Accepted'
          : (already.some(function (x) { return x.status === 'regenerated'; }) ? 'Pending' : 'Pending'),
        checksum: checksum(seed + 11),
        s3Path: batch.s3Prefix + netTok + '_CLEARING_' + tenTok + '_' + compact + '_R2.txt',
        manual: false
      });
    }
    // Batches carrying re-rejects show the file that came back rejected.
    if (batch.txns.some(function (x) { return x.status === 're_rejected'; })) {
      var rej = batch.txns.filter(function (x) { return x.status === 're_rejected'; });
      batch.generated.push({
        name: netTok + '_CLEARING_' + tenTok + '_' + compact + '_R' + (batch.generated.length + 2) + '.txt',
        at: stamp(U.addDays(spec.date, 2), pad(rint(r, 10, 16), 2) + ':' + pad(rint(r, 0, 59), 2)),
        by: pick(r, USERS),
        count: rej.length,
        value: Math.round(rej.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100,
        currency: t.currency,
        delivery: 'Manually marked as submitted',
        outcome: 'Re-rejected',
        checksum: checksum(seed + 19),
        s3Path: null,
        manual: true,
        note: 'Shared with the network team over the incident bridge — automated pickup was down for this cycle.'
      });
    }

    batches.push(batch);
    batchById[id] = batch;
  });

  /* =======================================================================
     6 · Derived views
     ======================================================================= */
  function allTxns() {
    var out = [];
    batches.forEach(function (b) { b.txns.forEach(function (t) { out.push(t); }); });
    return out;
  }
  function batchCounts(b) {
    var c = {};
    LIFECYCLE_ORDER.forEach(function (k) { c[k] = 0; });
    b.txns.forEach(function (t) { c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }
  function batchOpen(b) { return b.txns.filter(isOpen).length; }
  function batchValue(b) {
    return Math.round(b.txns.reduce(function (s, t) { return s + t.amount; }, 0) * 100) / 100;
  }
  function batchRate(b) { return (b.txns.length / b.fileTxns) * 100; }
  // "12 of 18 corrected" — corrected counts everything that has moved past New.
  function batchProgressText(b) {
    var worked = b.txns.filter(function (t) {
      return ['corrected', 'regenerated', 'resubmitted', 'cleared'].indexOf(t.status) >= 0;
    }).length;
    if (worked === b.txns.length) return 'all ' + b.txns.length + ' worked';
    return worked + ' of ' + b.txns.length + ' corrected';
  }
  // A staging reject with anything still open is blocking an unsubmitted file.
  function isBlocking(b) { return b.family === 'staging' && batchOpen(b) > 0; }

  function summary(list) {
    var txns = [];
    list.forEach(function (b) { b.txns.forEach(function (t) { txns.push(t); }); });
    var openTxns = txns.filter(isOpen);
    return {
      open: openTxns.length,
      staging: txns.filter(function (t) { return batchById[t.batchId].family === 'staging'; }).length,
      stagingBlocking: list.filter(isBlocking).length,
      incoming: txns.filter(function (t) { return batchById[t.batchId].family === 'incoming'; }).length,
      ird: txns.filter(function (t) { return isIrd(t.reasonCode); }).length,
      reRejected: txns.filter(function (t) { return t.status === 're_rejected'; }).length,
      total: txns.length
    };
  }
  function reasonCodesPresent() {
    var seen = {};
    allTxns().forEach(function (t) { seen[t.reasonCode] = true; });
    return Object.keys(seen).sort();
  }

  /* =======================================================================
     7 · Mutations — every one appends, none overwrite (Part 8 immutability)
     ======================================================================= */
  function nowStamp() { return U.prettyDate(TODAY) + ', 14:0' + (new Date().getSeconds() % 10) + ' IST'; }

  function saveCorrection(txn, changes, note, who, at) {
    if (!changes.length) return false;
    changes.forEach(function (c) { txn.fields[c.field] = c.to; });
    // Amount edits move the row's numeric value too, so batch sums stay honest.
    var amt = changes.filter(function (c) { return c.field === 'amount'; })[0];
    if (amt && !isNaN(parseFloat(amt.to))) txn.amount = parseFloat(amt.to);
    txn.history.push({ at: at || nowStamp(), by: who, kind: 'correction', changes: changes, note: note || null });
    txn.status = 'corrected';
    return true;
  }
  function markWontFix(txn, note, who) {
    txn.status = 'wont_fix';
    txn.wontFixNote = note;
    txn.manualTag = { label: 'manually marked', by: who, at: nowStamp() };
    txn.history.push({ at: nowStamp(), by: who, kind: 'wont_fix', changes: [], note: note });
  }
  function retrySuffix(b) { return 'R' + (b.generated.length + 2); }
  function generatedName(b) {
    return NET_TOKEN[b.network] + '_CLEARING_' + TENANT_TOKEN[b.tenantId] + '_' +
      b.cycleDate.replace(/-/g, '') + '_' + retrySuffix(b) + '.txt';
  }
  function correctedTxns(b) { return b.txns.filter(function (t) { return t.status === 'corrected'; }); }
  function excludedTxns(b) {
    return b.txns.filter(function (t) { return ['new', 'under_correction', 'wont_fix', 're_rejected'].indexOf(t.status) >= 0; });
  }
  function generateFile(b, who) {
    var included = correctedTxns(b);
    var entry = {
      name: generatedName(b),
      at: nowStamp(),
      by: who,
      count: included.length,
      value: Math.round(included.reduce(function (s, t) { return s + t.amount; }, 0) * 100) / 100,
      currency: b.currency,
      delivery: 'Not yet delivered',
      outcome: 'Pending',
      checksum: checksum(b.fileTxns + b.generated.length * 7 + 5),
      s3Path: null,
      manual: false,
      txnIds: included.map(function (t) { return t.id; })
    };
    included.forEach(function (t) { t.status = 'regenerated'; });
    b.generated.push(entry);                 // append-only
    return entry;
  }
  function markDelivered(b, entry, mode, note, who) {
    entry.delivery = mode === 's3' ? 'Pushed to S3' : 'Manually marked as submitted';
    if (mode === 's3') entry.s3Path = b.s3Prefix + entry.name;
    else { entry.manual = true; entry.note = note; entry.markedBy = who; entry.markedAt = nowStamp(); }
    (entry.txnIds || []).forEach(function (id) {
      var t = txnById[id];
      if (t && t.status === 'regenerated') t.status = 'resubmitted';
    });
    return entry;
  }
  function markDownloaded(entry) {
    if (entry.delivery === 'Not yet delivered') entry.delivery = 'Downloaded';
    return entry;
  }

  return {
    LIFECYCLE: LIFECYCLE, LIFECYCLE_ORDER: LIFECYCLE_ORDER, isOpen: isOpen,
    REASONS: REASONS, reasonText: reasonText, isIrd: isIrd, rawMessage: rawMessage,
    FIELDS: FIELDS, ALL_FIELDS: ALL_FIELDS, relevantFields: relevantFields, otherFields: otherFields,
    recommend: recommend, irdCode: irdCode, irdDesc: irdDesc, mccLabel: mccLabel, entryLabel: entryLabel,
    batches: batches, batchById: batchById, txnById: txnById, allTxns: allTxns,
    batchCounts: batchCounts, batchOpen: batchOpen, batchValue: batchValue, batchRate: batchRate,
    batchProgressText: batchProgressText, isBlocking: isBlocking,
    summary: summary, reasonCodesPresent: reasonCodesPresent,
    USERS: USERS, CURRENT_USER: CURRENT_USER, nowStamp: nowStamp,
    saveCorrection: saveCorrection, markWontFix: markWontFix,
    generatedName: generatedName, retrySuffix: retrySuffix,
    correctedTxns: correctedTxns, excludedTxns: excludedTxns,
    generateFile: generateFile, markDelivered: markDelivered, markDownloaded: markDownloaded
  };
})();
