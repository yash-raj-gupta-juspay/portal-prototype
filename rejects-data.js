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
    // Round 3 §C.6 — the config path cannot be finished in this screen. A
    // transaction blocked on a config or code change is not the same as one
    // nobody has looked at, and it is not ready to regenerate either: it sits
    // here until the config lands and the analyst re-derives.
    awaiting_config: {
      label: 'Awaiting config fix', kind: 'warning', icon: 'settings', order: 3, open: true,
      note: 'Blocked on a config or code change — the fix lives in Platform Configs, not on this transaction'
    },
    corrected: { label: 'Corrected', kind: 'warning', icon: 'check', order: 4, open: true, note: 'Fields updated, clearing file not yet regenerated' },
    regenerated: { label: 'Regenerated', kind: 'info', icon: 'file-plus', order: 5, open: true, note: 'New clearing file produced, not yet submitted' },
    resubmitted: { label: 'Resubmitted', kind: 'neutral', icon: 'send', order: 6, open: true, note: 'File sent to network, awaiting confirmation' },
    cleared: { label: 'Cleared', kind: 'success', icon: 'check-circle', order: 7, open: false, note: 'Confirmed accepted in a subsequent cycle' },
    re_rejected: { label: 'Re-rejected', kind: 'danger', icon: 'rotate-ccw', order: 0, open: true, note: 'Rejected again after resubmission' },
    wont_fix: { label: "Won't fix", kind: 'neutral', icon: 'ban', order: 8, open: false, note: 'Cannot be corrected — written off' }
  };
  // Display order for the progress bar and the status filter.
  var LIFECYCLE_ORDER = ['re_rejected', 'new', 'under_correction', 'awaiting_config', 'corrected',
    'regenerated', 'resubmitted', 'cleared', 'wont_fix'];
  function isOpen(t) { return !!(LIFECYCLE[t.status] || {}).open; }

  /* Round 3 §C.6 — the two correction paths. The choice is declared before any
     field is touched and is recorded on every correction; it is what decides
     whether the fix is committed here or handed to Platform Configs. */
  /* Two lines each, no more (overhaul Part 4.4). The long-form explanations are
     gone: the choice is between fixing a value and fixing the rule that
     produced it, and two lines say that. */
  var PATHS = {
    data: {
      key: 'data', label: "This transaction's data is wrong", icon: 'pencil',
      blurb: 'Fix the values here.',
      long: ''
    },
    config: {
      key: 'config', label: 'The rule that produced it is wrong', icon: 'settings',
      blurb: 'Fix it in Platform Configs.',
      long: ''
    }
  };
  function pathLabel(k) { return (PATHS[k] || {}).label || null; }

  // Where a config fix belongs. Mirrors the three Platform Configs families so
  // "Open Platform Configs →" can carry the analyst straight there.
  var CONFIG_FAMILIES = [
    { key: 'network', label: 'Network File Configs', route: '#/dashboard/ops/configs/network-files' },
    { key: 'settlement', label: 'Settlement Configs', route: '#/dashboard/ops/configs/settlement' },
    { key: 'incoming', label: 'Incoming Parsing Configs', route: '#/dashboard/ops/configs/incoming' }
  ];
  function configFamily(k) {
    for (var i = 0; i < CONFIG_FAMILIES.length; i++) if (CONFIG_FAMILIES[i].key === k) return CONFIG_FAMILIES[i];
    return null;
  }

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
    '0588': { network: 'Visa', text: 'Duplicate transaction reference' },
    // RuPay / NPCI. Same shape as the other two networks — the correction paths
    // are network-agnostic, and RuPay is here so that is demonstrable rather
    // than merely asserted.
    'R012': { network: 'RuPay', text: 'Invalid merchant category code' },
    'R024': { network: 'RuPay', text: 'Acceptor location details incomplete' },
    'R031': { network: 'RuPay', text: 'Settlement amount mismatch' },
    'R047': { network: 'RuPay', text: 'Invalid acquirer institution ID' },
    'R053': { network: 'RuPay', text: 'Duplicate presentment in cycle' }
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
    '0588': 'TCR0 TRANSACTION IDENTIFIER {txnRef} ALREADY PRESENTED IN CYCLE — V.I.P. EDIT 0588',
    'R012': 'DE018 MERCHANT CATEGORY CODE {mcc} NOT IN NPCI ACCEPTED LIST — RUPAY EDIT R012',
    'R024': 'DE043 CARD ACCEPTOR CITY/POSTAL CODE ABSENT FOR DOMESTIC PRESENTMENT — RUPAY EDIT R024',
    'R031': 'DE005 SETTLEMENT AMOUNT DOES NOT MATCH DE004 TRANSACTION AMOUNT {amount} — RUPAY EDIT R031',
    'R047': 'DE032 ACQUIRING INSTITUTION ID {acquirerBin} NOT REGISTERED WITH NPCI — RUPAY EDIT R047',
    'R053': 'DE037 RETRIEVAL REFERENCE {txnRef} ALREADY PRESENTED IN THIS CYCLE — RUPAY EDIT R053'
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
    '0588': ['txnRef', 'arn', 'txnDate'],
    'R012': ['mcc', 'merchantName'],
    'R024': ['acceptorCity', 'acceptorPostcode', 'acceptorName'],
    'R031': ['amount', 'authAmount', 'currency'],
    'R047': ['acquirerBin', 'merchantId'],
    'R053': ['txnRef', 'arn', 'txnDate']
  };
  function relevantFields(code) { return REASON_FIELDS[code] || []; }
  function otherFields(code) {
    var rel = relevantFields(code);
    return ALL_FIELDS.filter(function (f) { return rel.indexOf(f) < 0; });
  }

  /* Round 3 §C.6 — the data path shows the whole entity record, grouped. The
     reason code no longer decides what is editable; it only marks which field
     it points at. Groups are ordered the way an analyst reads a presentment:
     what the transaction is, then who took it, then how it was taken, then the
     network-specific derivation at the end. */
  var GROUP_ORDER = ['References', 'Dates', 'Amounts', 'Merchant', 'Acceptor address',
    'Terminal', 'Acquirer', 'Card', 'Interchange'];
  var GROUP_NOTE = {
    References: 'Identifiers the network matches this presentment on.',
    Dates: 'Presentment window and settlement cycle.',
    Amounts: 'Cleared value, as authorized and as presented.',
    Merchant: 'Merchant record as carried in the clearing file.',
    'Acceptor address': 'DE43 subfields — mandatory on domestic presentments.',
    Terminal: 'How the card was read.',
    Acquirer: 'Acquiring institution registration.',
    Card: 'Card product and account range.',
    Interchange: 'Network-specific derivation.'
  };
  function groupedFields() {
    var seen = {}, out = [];
    GROUP_ORDER.forEach(function (g) { seen[g] = { group: g, note: GROUP_NOTE[g] || '', fields: [] }; out.push(seen[g]); });
    ALL_FIELDS.forEach(function (k) {
      var g = (FIELDS[k] || {}).group || 'Other';
      if (!seen[g]) { seen[g] = { group: g, note: '', fields: [] }; out.push(seen[g]); }
      seen[g].fields.push(k);
    });
    return out.filter(function (g) { return g.fields.length; });
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
     4b · Mastercard IRD resolution ladder — deterministic mock engine
     -----------------------------------------------------------------------
     Only Mastercard *staging* IRD rejects carry a ladder. The four strategies
     are the four known ways to get a different IRD out of the platform, in
     descending confidence and ascending cost:

       1  the corrected GCMS product ID the reject summary itself carries
       2  the next GCMS product ID on the account range for this PAN
       3  the next ranked IRD candidate under the same filter set
       4  a broader IRD matching on fewer filters — clears, but costs more

     This is a mock, not a port of the matcher: it invents plausible product
     IDs, candidates and rates, seeded off the ARN so a demo repeats exactly.
     What it does model faithfully is the shape the panel has to reason about —
     which rungs exist for a given transaction, which have been burned, and
     what each one costs on this specific amount.
     ======================================================================= */

  // Two-character Mastercard interchange rate designators. Two disjoint pools:
  // a precise derivation lands in the first, dropping filters lands in the
  // second — and the second is always the more expensive side of the trade.
  var IRD_PRECISE = ['YA', 'YB', 'YC', 'YD', 'YE', 'YF', 'YG', 'YH', 'YJ', 'YK', 'YL', 'YM',
    'YN', 'YP', 'YS', 'YT', 'YU', 'YV', 'YW', 'MA', 'MB', 'MD', 'ME', 'PA', 'PB', 'IA', 'IB'];
  var IRD_BROAD = ['YQ', 'YR', 'YX', 'MQ', 'PQ', 'IQ'];
  var GCMS_POOL = ['027', '032', '038', '042', '051', '063', '075', '081', '094', '106'];

  var STRATEGY_NAME = {
    1: '1 · Corrected GCMS',
    2: '2 · Next product ID',
    3: '3 · Next candidate',
    4: '4 · Broader fallback'
  };

  function round2(n) { return Math.round(n * 100) / 100; }
  // Seeded off the ARN so the same transaction resolves identically on every
  // load — Part 5.3's determinism requirement is what makes the demo repeat.
  function arnSeed(arn) {
    var s = 7;
    for (var i = 0; i < String(arn).length; i++) s = (Math.imul(s, 31) + String(arn).charCodeAt(i)) >>> 0;
    return s >>> 0;
  }
  function panRangeOf(txn) {
    var digits = String(txn.fields.pan || '').replace(/\D/g, '');
    var bin = (digits + '000000').slice(0, 6);
    return bin.slice(0, 4) + ' ' + bin.slice(4, 6) + '** **** ****';
  }

  function buildIrdCtx(txn, sc) {
    sc = sc || {};
    var r = rng(arnSeed(txn.arn));
    var a = txn.attrs;
    // The ladder's story is about product IDs and candidate ranks, not about
    // unresolved attributes — that is the other panel's subject. Fill any gaps
    // so the filter list reads cleanly.
    if (!a.mcc) a.mcc = txn.fields.mcc || '5411';
    if (!a.region) a.region = 'Domestic';
    if (!a.card) a.card = 'Credit';
    if (!a.entry) a.entry = txn.fields.posEntryMode || '05';
    a.contactless = a.entry === '07' ? 'Yes' : 'No';

    var nProd = sc.productIds != null ? sc.productIds : (r() < 0.22 ? 1 : (r() < 0.55 ? 2 : 3));
    var nCand = sc.candidates != null ? sc.candidates : (r() < 0.22 ? 1 : (r() < 0.55 ? 2 : 3));
    var hasCorrected = sc.corrected != null ? sc.corrected : r() < 0.6;
    var converge = sc.converge != null ? sc.converge : (nProd > 1 && nCand > 1 && r() < 0.45);

    var bag = IRD_PRECISE.slice();
    function drawIrd() { return bag.splice(Math.floor(r() * bag.length), 1)[0]; }
    var gbag = GCMS_POOL.slice();
    function drawGcms() { return gbag.splice(Math.floor(r() * gbag.length), 1)[0]; }

    // Priority 1 and rank 1 are the derivation the platform already ran — which
    // is precisely the IRD the network rejected. Both strategies therefore open
    // with a row that is already burned, which is what makes the ladder legible.
    var baseIrd = drawIrd();
    var products = [{ priority: 1, id: drawGcms(), ird: baseIrd }];
    for (var p = 2; p <= nProd; p++) products.push({ priority: p, id: drawGcms(), ird: drawIrd() });
    var cands = [{ rank: 1, ird: baseIrd }];
    for (var k = 2; k <= nCand; k++) cands.push({ rank: k, ird: drawIrd() });
    // Two derivation paths converging on one IRD is the exact case the global
    // exclusion exists for, so the mock produces it deliberately rather than by
    // accident: Strategy 2's priority 2 and Strategy 3's rank 2 land together.
    if (converge && products[1] && cands[1]) cands[1].ird = products[1].ird;

    var correctedGcms = hasCorrected ? drawGcms() : null;
    var s1Ird = hasCorrected ? drawIrd() : null;
    var broadIrd = IRD_BROAD[Math.floor(r() * IRD_BROAD.length)];

    // One rate per IRD, not per slot. A code two strategies both derive has to
    // price the same on both, or the comparison table contradicts itself.
    var baseRate = round2(1.45 + r() * 0.5);
    var rates = {};
    function rateFor(ird) {
      if (rates[ird] == null) rates[ird] = round2(baseRate + (r() * 0.18 - 0.06));
      return rates[ird];
    }
    products.forEach(function (x) { rateFor(x.ird); });
    cands.forEach(function (x) { rateFor(x.ird); });
    if (s1Ird) rateFor(s1Ird);
    var top = 0;
    Object.keys(rates).forEach(function (key) { if (rates[key] > top) top = rates[key]; });
    // Part 5.3 — the fallback always prices 0.40 to 0.90 points above every
    // precise candidate, so the trade-off can never be invisible.
    rates[broadIrd] = round2(top + 0.4 + r() * 0.3);

    return {
      panRange: panRangeOf(txn),
      submittedGcms: products[0].id,
      correctedGcms: correctedGcms,
      s1Ird: s1Ird,
      products: products,
      candidates: cands,
      broadIrd: broadIrd,
      rates: rates,
      filters: ['MCC ' + a.mcc, a.region, a.card, 'Entry mode ' + a.entry, 'Contactless: ' + a.contactless],
      broadMatched: [a.card, a.region],
      broadDropped: ['MCC', 'Entry mode', 'Contactless'],
      // Every IRD this transaction has submitted and had rejected, oldest
      // first. The last entry is the one on the reject in hand.
      rejected: [],
      strategies: [],
      // Append-only correction log (Part 4). Seeded with the attempts that
      // already came back rejected; Save correction appends, never rewrites.
      log: []
    };
  }

  // Ladder rungs are burned by token rather than by literal IRD, so a scenario
  // in the spec table below stays readable next to the shape it describes.
  function burnIrd(c, token) {
    if (token === 'submitted') return { ird: c.products[0].ird, strategy: null };
    if (token === 's1') return c.s1Ird ? { ird: c.s1Ird, strategy: 1 } : null;
    if (token === 'p2') return c.products[1] ? { ird: c.products[1].ird, strategy: 2 } : null;
    if (token === 'p3') return c.products[2] ? { ird: c.products[2].ird, strategy: 2 } : null;
    if (token === 'c2') return c.candidates[1] ? { ird: c.candidates[1].ird, strategy: 3 } : null;
    if (token === 'c3') return c.candidates[2] ? { ird: c.candidates[2].ird, strategy: 3 } : null;
    if (token === 'broad') return { ird: c.broadIrd, strategy: 4 };
    return null;
  }
  function defaultBurn(c, attempts) {
    var order = ['submitted', 's1', 'p2', 'p3', 'c2', 'c3'], out = [];
    for (var i = 0; i < order.length && out.length < attempts; i++) {
      if (burnIrd(c, order[i])) out.push(order[i]);
    }
    return out;
  }

  // Attaches the ladder to a Mastercard staging IRD reject and rewrites its
  // attempt trail in Y-series codes. Replaces the generic re-reject loop for
  // these transactions rather than layering on top of it.
  function attachIrdLadder(txn, batch, sc, r) {
    var c = buildIrdCtx(txn, sc);
    txn.irdCtx = c;

    var burn = (sc && sc.burn) || defaultBurn(c, txn.attempts);
    var seen = {};
    burn.forEach(function (token) {
      var b = burnIrd(c, token);
      if (!b || seen[b.ird]) return;        // convergent paths burn one IRD, not two
      seen[b.ird] = true;
      c.rejected.push(b.ird);
      c.strategies.push(b.strategy);
    });
    if (!c.rejected.length) { c.rejected.push(c.products[0].ird); c.strategies.push(null); }

    txn.attempts = c.rejected.length;
    txn.attemptedIrds = c.rejected.slice(0, -1);
    txn.fields.ird = c.rejected[c.rejected.length - 1];
    txn.attemptLog = [];
    txn.history = [];

    // Correction 1 is the first attempt *after* the original submission, which
    // is how the panel header, the ladder and the history table all agree on
    // what "Attempt 2" means.
    for (var i = 1; i < c.rejected.length; i++) {
      var corrAt = stamp(U.addDays(batch.cycleDate, i - 1), pad(9 + (i * 3) % 9, 2) + ':' + pad((i * 17 + 14) % 60, 2));
      var rejAt = stamp(U.addDays(batch.cycleDate, i), '0' + (3 + (i * 2) % 6) + ':' + pad((i * 23 + 8) % 60, 2));
      var who = USERS[(arnSeed(txn.arn) + i) % USERS.length];
      var strat = c.strategies[i];
      c.log.push({
        attempt: i, ird: c.rejected[i], strategy: strat,
        strategyLabel: strat ? STRATEGY_NAME[strat] : 'Manual entry',
        by: who, at: corrAt, outcome: 'Rejected'
      });
      txn.attemptLog.push({
        attempt: i, ird: c.rejected[i], strategy: strat,
        correctedAt: corrAt, by: who, rejectedAt: rejAt
      });
      txn.history.push({
        at: corrAt, by: who, kind: 'correction',
        changes: [{ field: 'ird', from: c.rejected[i - 1], to: c.rejected[i] }],
        note: 'Applied via Strategy ' + strat + ' (' + STRATEGY_NAME[strat] + '). Re-rejected ' + rejAt + '.'
      });
    }
    return c;
  }

  function hasIrdLadder(txn) {
    var b = batchById[txn.batchId];
    return !!(txn && txn.irdCtx && b && b.network === 'Mastercard' && b.family === 'staging' && isIrd(txn.reasonCode));
  }

  /* ---- The engine the panel calls (Part 5.2 output shape) ----------------- */
  function resolveIrd(txn) {
    var c = txn && txn.irdCtx;
    if (!c) return null;
    var paise = Math.round(txn.amount * 100);
    function opt(ird, extra) {
      var rate = c.rates[ird] == null ? 0 : c.rates[ird];
      var o = { ird: ird, rate: rate, fee: Math.round(paise * rate / 100), tried: false };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }

    var s1 = {
      n: 1, name: 'Corrected GCMS Product ID', confidence: 'High',
      // The lede describes the strategy, not this transaction. Asserting the
      // premise here would contradict the Not applicable line below it.
      lede: 'When Mastercard rejects on a product ID mismatch, the reject summary carries the corrected GCMS product ID. Re-deriving the IRD with it is the first move.',
      why: 'Highest confidence — the corrective input came from the network itself.',
      na: 'The reject summary for this transaction carries no corrected GCMS product ID, so there is nothing authoritative to re-derive from. The ladder starts at Strategy 2.',
      available: !!c.correctedGcms,
      options: c.correctedGcms ? [opt(c.s1Ird, { gcms: c.correctedGcms })] : []
    };
    var s2 = {
      n: 2, name: 'Next GCMS Product ID', confidence: 'Medium-high',
      lede: 'A PAN range can map to several GCMS product IDs, held in priority order. The platform derives from priority 1 — the next one down is the alternative.',
      why: 'Still authoritative reference data, just a different entry in the account range table.',
      na: 'The account range for this PAN maps to a single GCMS product ID, so there is no second entry to fall back to.',
      available: c.products.length > 1,
      options: c.products.map(function (p) { return opt(p.ird, { priority: p.priority, gcms: p.id }); })
    };
    var s3 = {
      n: 3, name: 'Next IRD candidate', confidence: 'Medium',
      lede: 'One filter set can return several valid IRDs. Priority logic picks rank 1 — the next ranked candidate under the same filters is the alternative.',
      why: 'Lower confidence: nothing about the input was corrected. This is an alternative the same derivation already considered valid.',
      na: 'This filter set returned a single valid IRD, so there is no second candidate under the same derivation.',
      available: c.candidates.length > 1,
      options: c.candidates.map(function (x) { return opt(x.ird, { rank: x.rank }); })
    };
    var s4 = {
      n: 4, name: 'Broader IRD, fewer filters', confidence: 'Clears — but costs more', broad: true,
      lede: 'A less specific IRD matching on fewer attributes. Broader IRDs almost always clear, because there is less to mismatch on.',
      why: 'Last resort. It will very likely be accepted, but the bank pays a higher interchange rate on this transaction.',
      na: '',
      available: true,
      options: [opt(c.broadIrd, { matched: c.broadMatched, dropped: c.broadDropped })]
    };

    var all = [s1, s2, s3, s4];

    /* Global exclusion (Part 4) — one pass, run after all four strategies have
       computed, keyed on the IRD itself rather than on the path that derived
       it. Strategy 2's priority-2 product ID and Strategy 3's rank-2 candidate
       can land on the same code; if that code has already been rejected for
       this transaction, neither strategy may offer it. Doing this per-strategy
       would let a convergent derivation slip a burned IRD back onto the ladder. */
    var burned = {};
    c.rejected.forEach(function (x) { burned[x] = true; });
    all.forEach(function (s) {
      s.options.forEach(function (o) { o.tried = !!burned[o.ird]; });
    });

    all.forEach(function (s) {
      s.untried = s.options.filter(function (o) { return !o.tried; });
      s.next = s.available ? (s.untried[0] || null) : null;
      // Exhausted and Not applicable are different facts. Not applicable means
      // this strategy never could have worked here; exhausted means it could,
      // and every option it had has now been burned.
      s.exhausted = s.available && !s.next;
      s.state = !s.available ? 'na' : (s.exhausted ? 'exhausted' : 'open');
    });

    var recommended = null;
    for (var i = 0; i < all.length; i++) if (all[i].state === 'open') { recommended = all[i]; break; }
    all.forEach(function (s) { s.recommended = (s === recommended); });

    // "vs best" anchors on the cheapest candidate an analyst can actually pick.
    var offers = all.map(function (s) { return s.next; }).filter(Boolean);
    var best = offers.slice().sort(function (x, y) { return x.fee - y.fee; })[0] || null;

    // Strategy 4's callout compares against the best *precise* candidate — that
    // difference is the money the bank gives up by taking the broad one. When
    // every precise rung is burned, the comparison falls back to the cheapest
    // precise IRD the engine knows about, tried or not: the analyst still needs
    // to see what a precise IRD would have cost.
    var precise = [s1, s2, s3].filter(function (s) { return s.available; });
    var bestPrecise = precise.map(function (s) { return s.next; }).filter(Boolean)
      .sort(function (x, y) { return x.fee - y.fee; })[0] || null;
    if (!bestPrecise) {
      var pool = [];
      precise.forEach(function (s) { s.options.forEach(function (o) { pool.push(o); }); });
      bestPrecise = pool.sort(function (x, y) { return x.fee - y.fee; })[0] || null;
    }
    if (!bestPrecise) bestPrecise = opt(c.products[0].ird, { priority: 1 });
    s4.bestPrecise = bestPrecise;
    s4.delta = s4.options[0].fee - bestPrecise.fee;

    return {
      strategies: all, s1: s1, s2: s2, s3: s3, s4: s4,
      recommended: recommended, best: best, bestPrecise: bestPrecise,
      ctx: c, rejected: c.rejected, amountPaise: paise,
      // True when nothing on the ladder is left — manual entry is the only move.
      dead: !recommended
    };
  }

  /* ---- Reasoning notes (Part 3.5) ----------------------------------------
     Applying a candidate auto-attaches the sentence that says how it was
     derived. It goes into the correction history verbatim, so it has to read
     as a record on its own months later — not as UI copy. */
  var CUR_SYM = { INR: '₹', SGD: 'S$', HKD: 'HK$' };
  // Same grouping the shell uses — lakh/crore for INR, thousands elsewhere.
  function groupIndian(s) {
    if (s.length <= 3) return s;
    return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  }
  function money(paise, currency) {
    var parts = Math.abs(paise / 100).toFixed(2).split('.');
    var ip = (currency && currency !== 'INR')
      ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : groupIndian(parts[0]);
    return (paise < 0 ? '-' : '') + (CUR_SYM[currency] || '₹') + ip + '.' + parts[1];
  }
  function rateText(rate) { return Number(rate).toFixed(2) + '%'; }

  function irdApplyNote(txn, strategyN, o) {
    var c = txn.irdCtx, cur = txn.currency;
    var tail = ' Interchange ' + rateText(o.rate) + ' — ' + money(o.fee, cur) + ' on this transaction.';
    if (strategyN === 1) {
      return 'Applied via Strategy 1 (corrected GCMS product ID ' + o.gcms + ' from the reject summary, replacing submitted ' +
        c.submittedGcms + '). Derived IRD ' + o.ird + '.' + tail;
    }
    if (strategyN === 2) {
      return 'Applied via Strategy 2 (GCMS product ID ' + o.gcms + ', priority ' + o.priority +
        ' on account range ' + c.panRange + '). Derived IRD ' + o.ird + '.' + tail;
    }
    if (strategyN === 3) {
      return 'Applied via Strategy 3 (rank ' + o.rank + ' candidate under the same filter set — ' +
        c.filters.join(', ') + '). Derived IRD ' + o.ird + '.' + tail;
    }
    if (strategyN === 4) {
      var res = resolveIrd(txn);
      return 'Applied via Strategy 4 (broader IRD matching on ' + c.broadMatched.join(', ') +
        '; drops ' + c.broadDropped.join(', ') + '). IRD ' + o.ird + ' at ' + rateText(o.rate) +
        ' against ' + rateText(res.bestPrecise.rate) + ' on the best precise candidate ' + res.bestPrecise.ird +
        ' — ' + money(res.s4.delta, cur) + ' more on this transaction. Accepted the higher interchange rate to clear the reject.';
    }
    return 'Applied IRD ' + o.ird + '.';
  }

  // The candidate the ladder would hand an analyst right now, with the note
  // that records why. Used to seed transactions that arrive already corrected.
  function nextLadderPick(txn) {
    var res = resolveIrd(txn);
    if (!res || !res.recommended || !res.recommended.next) return null;
    var s = res.recommended, o = s.next;
    return { ird: o.ird, strategy: s.n, option: o, note: irdApplyNote(txn, s.n, o) };
  }

  // Append-only (Part 7 immutability): a committed correction adds a row and
  // never edits one. Row numbers run by position, so a second correction inside
  // the same attempt is a visible second row rather than a silent rewrite.
  function logIrdAttempt(c, ird, strategyN, who, at) {
    if (!c) return null;
    var row = {
      attempt: c.log.length + 1, ird: ird, strategy: strategyN,
      strategyLabel: strategyN ? STRATEGY_NAME[strategyN] : 'Manual entry',
      by: who, at: at || nowStamp(), outcome: 'Pending'
    };
    c.log.push(row);
    return row;
  }

  /* =======================================================================
     5 · Batches + transactions (Part 7.1)
     ======================================================================= */
  var USERS = ['ops.analyst@juspay.in', 'priya.nair@juspay.in', 'ravi.kulkarni@juspay.in', 'meera.das@juspay.in'];
  var CURRENT_USER = 'ops.analyst@juspay.in';

  var ISO_CUR = { INR: '356', SGD: '702', HKD: '344' };
  var TENANT_TOKEN = { 'hsbc-in': 'HSBCIN', 'hsbc-sg': 'HSBCSG', 'hsbc-hk': 'HSBCHK', yesbank: 'YESBANK' };
  var NET_TOKEN = { Mastercard: 'MC', Visa: 'VISA', RuPay: 'RUPAY' };
  var REGION_OF = { 'hsbc-in': 'Domestic', yesbank: 'Domestic', 'hsbc-sg': 'Intra-regional', 'hsbc-hk': 'Intra-regional' };

  // Reason-code rotation per network. Mastercard's rotation is 5 IRD codes in
  // 12 (~42%), comfortably over the 25% floor the brief sets.
  var MC_CYCLE = ['0221', '0104', '0225', '0117', '0221', '0142', '0208', '0221', '0311', '0225', '0117', '0142'];
  var VISA_CYCLE = ['0501', '0512', '0523', '0541', '0567', '0588', '0512', '0501', '0541', '0523'];
  var RUPAY_CYCLE = ['R012', 'R024', 'R031', 'R047', 'R053', 'R024', 'R012', 'R031'];

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

  function buildTxn(batch, i, recipeStatus, attemptCount, seed, sc) {
    var r = rng(seed);
    var t = O.tenantById[batch.tenantId];
    var ms = O.merchantsByTenant[batch.tenantId] || [];
    var m = ms[(i * 5 + seed) % Math.max(1, ms.length)] || { name: 'Unknown Merchant', mid: '0000 0000 00000', mcc: '5999' };
    var cyc = MC_CYCLE, code;
    if (batch.network === 'Visa') cyc = VISA_CYCLE;
    else if (batch.network === 'RuPay') cyc = RUPAY_CYCLE;
    code = (sc && sc.reason) || cyc[i % cyc.length];

    var amount = Math.round((t.currency === 'INR' ? rint(r, 45000, 9800000) : rint(r, 900, 240000))) / 100;
    // Part 6 asks the ladder scenarios to sit in the ₹5,000–₹50,000 band, where
    // a 0.6-point rate difference reads as real money rather than rounding.
    if (sc && sc.amount) amount = sc.amount;
    var txnDate = U.addDays(batch.cycleDate, -rint(r, 0, 2));
    var arn = makeArn(r);
    var entry = pick(r, ['05', '05', '07', '81', '01']);
    var region = REGION_OF[batch.tenantId] || 'Domestic';
    // A handful of inter-regional transactions per portfolio — the geography
    // that makes an IRD recommendation genuinely non-obvious.
    if (r() < 0.18) region = 'Inter-regional';
    var card = r() < 0.62 ? 'Credit' : 'Debit';

    var id = 'RJT-' + pad(++_seq, 5);
    var bin = batch.network === 'Mastercard' ? String(rint(r, 510000, 559999))
      : (batch.network === 'RuPay' ? String(rint(r, 607000, 608999)) : String(rint(r, 400000, 499999)));
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
      cardProduct: batch.network === 'Mastercard' ? (card === 'Credit' ? 'MCC' : 'DMC')
        : (batch.network === 'RuPay' ? (card === 'Credit' ? 'RUC' : 'RUD') : (card === 'Credit' ? 'VCC' : 'VDB')),
      arn: arn,
      txnRef: 'TXR' + pad(rint(r, 0, 999999999999), 12),
      txnDate: txnDate,
      processingDate: batch.cycleDate,
      settlementDate: U.addDays(batch.cycleDate, 1)
    };

    // Reject-specific damage: the field the reason code points at is the one
    // that is actually wrong, so the surfaced field is worth editing.
    if (code === '0104' || code === '0523' || code === 'R012') txn.fields.mcc = '9' + m.mcc.slice(1);
    if (code === '0142') txn.fields.arn = arn.slice(0, 15) + '0';
    if (code === '0208' || code === '0541') { txn.fields.acceptorPostcode = ''; if (code === '0541') txn.fields.acceptorCity = ''; }
    if (code === 'R024') { txn.fields.acceptorPostcode = ''; txn.fields.acceptorCity = ''; }
    if (code === '0311') txn.fields.cardProduct = 'XX' + (card === 'Credit' ? 'C' : 'D');
    if (code === '0512' || code === 'R031') txn.fields.authAmount = (amount - Math.round(amount * 0.07 * 100) / 100).toFixed(2);
    if (code === '0501') txn.fields.txnDate = U.addDays(batch.cycleDate, -34);
    if (code === '0567' || code === 'R047') txn.fields.acquirerBin = bin.slice(0, 5) + '9';
    if (code === '0117') txn.fields.currency = '999';

    // A few transactions arrive with attributes the platform could not resolve —
    // that is what drives Medium / Low confidence in the recommendation panel.
    if (isIrd(code) && seed % 7 === 0) txn.attrs.region = null;
    if (isIrd(code) && seed % 11 === 0) { txn.attrs.mcc = null; txn.attrs.card = null; }

    // A Mastercard staging IRD reject resolves through the four-strategy ladder
    // instead of the single-answer recommendation engine, so it owns its own
    // attempt trail — Y-series codes, and a burn order that matches the rungs.
    var ladder = batch.family === 'staging' && batch.network === 'Mastercard' && isIrd(code);
    if (ladder) attachIrdLadder(txn, batch, sc, r);

    // Re-rejects carry their attempt history, and the IRDs already burned.
    if (!ladder && txn.attempts > 1) {
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
      var ladderPick = (ladder && f0 === 'ird') ? nextLadderPick(txn) : null;
      var newV = ladderPick ? ladderPick.ird : correctedValue(f0, txn, m, r);
      var corrBy = txn.assignee || pick(r, USERS);
      var corrAt = stamp(U.addDays(batch.cycleDate, 1), pad(rint(r, 9, 17), 2) + ':' + pad(rint(r, 0, 59), 2));
      txn.fields[f0] = newV;
      txn.history.push({
        at: corrAt, by: corrBy, kind: 'correction',
        changes: [{ field: f0, from: oldV, to: newV }],
        note: ladderPick ? ladderPick.note : null
      });
      // The staged correction is a real row in the append-only attempt log, and
      // it is Pending until the regenerated file comes back from the network.
      if (ladderPick) logIrdAttempt(txn.irdCtx, newV, ladderPick.strategy, corrBy, corrAt);
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
    // The Mastercard staging batch also carries the six IRD scenarios the
    // resolution ladder has to make legible (Part 6). They are appended rather
    // than folded into the recipe so the batch's original lifecycle counts are
    // untouched — `burn` is the trail of rungs each one has already spent.
    {
      tenant: 'hsbc-in', network: 'Mastercard', family: 'staging', date: ago(1), fileTxns: 18420,
      recipe: { corrected: 4, new: 2 },
      irdPlan: [
        // Reject summary supplies a corrected product ID → Strategy 1 recommended.
        // Convergent: priority 2 and rank 2 land on one IRD, both still untried.
        { reason: '0221', status: 'new', amount: 21900.00, corrected: true, productIds: 3, candidates: 3, converge: true, burn: ['submitted'] },
        // No corrected product ID, but the PAN range holds three → ladder opens at 2.
        { reason: '0225', status: 'new', amount: 8460.00, corrected: false, productIds: 3, candidates: 2, converge: false, burn: ['submitted'] },
        // Attempt 2 — Strategy 1 already tried and rejected, so it is Exhausted.
        { reason: '0221', status: 're_rejected', amount: 34250.00, corrected: true, productIds: 3, candidates: 3, converge: false, burn: ['submitted', 's1'] },
        // Attempt 3 — Strategies 1 and 2 exhausted. Converge is on, so Strategy
        // 3's rank 2 is the same IRD Strategy 2 already burned: the global
        // exclusion has to grey it out even though Strategy 3 never ran.
        { reason: '0221', status: 're_rejected', amount: 47180.00, corrected: true, productIds: 2, candidates: 3, converge: true, burn: ['submitted', 's1', 'p2'] },
        // Attempt 4 — every precise rung burned. Only the costly fallback left.
        { reason: '0225', status: 're_rejected', amount: 12730.00, corrected: true, productIds: 2, candidates: 2, converge: false, burn: ['submitted', 's1', 'p2', 'c2'] },
        // Single product ID, single candidate — the shortest ladder there is:
        // Strategy 1, then straight to the fallback. Worth showing because it is
        // where an analyst reaches the expensive option fastest.
        { reason: '0221', status: 'new', amount: 29640.00, corrected: true, productIds: 1, candidates: 1, converge: false, burn: ['submitted'] }
      ]
    },
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

  var irdPending = [];

  /* ---- The two regeneration models (Round 3 §C.5) ------------------------
     A staging reject means nothing cleared: the whole file was refused, so
     regeneration produces a complete replacement carrying every transaction in
     the original file with the corrections applied in place. An incoming reject
     means the file staged and the rest of the cycle already cleared, so
     regeneration produces a small supplementary file carrying only the
     corrected rejects. Generating the wrong one is an operational error, so the
     model is derived once, here, and every label, count and file name reads
     from it. */
  var MODELS = {
    replacement: {
      key: 'replacement', label: 'Replacement', tag: 'Full file replacement',
      action: 'Generate replacement clearing file',
      banner: 'Full file replacement — the entire clearing file was refused and must be resubmitted in full.',
      suffix: ''
    },
    supplementary: {
      key: 'supplementary', label: 'Supplementary', tag: 'Supplementary file',
      action: 'Generate clearing file for corrected rejects',
      banner: 'Supplementary file — only corrected rejects will be resubmitted. The rest of this cycle already cleared.',
      suffix: '_SUPP'
    }
  };
  function regenModel(b) { return b.family === 'staging' ? MODELS.replacement : MODELS.supplementary; }

  function buildBatch(spec, bi) {
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

    // The IRD ladder scenarios sit on top of the recipe, each carrying its own
    // status and attempt depth. They are built in a second pass, after every
    // batch, so the transaction id sequence for the existing rejects is not
    // shifted by six — RJT ids are quoted in tickets and must stay put.
    if (spec.irdPlan) irdPending.push({ batch: batch, spec: spec, seed: seed, base: statuses.length });

    // A batch whose corrections already went out carries the file that carried
    // them — the history table is append-only, so the seed rows are real rows.
    var model = regenModel(batch);
    var already = batch.txns.filter(function (x) { return ['regenerated', 'resubmitted', 'cleared'].indexOf(x.status) >= 0; });
    if (already.length) {
      var name2 = netTok + '_CLEARING_' + tenTok + '_' + compact + '_R2' + model.suffix + '.txt';
      var corrValue = Math.round(already.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100;
      batch.generated.push({
        name: name2,
        at: stamp(U.addDays(spec.date, 1), pad(rint(r, 12, 19), 2) + ':' + pad(rint(r, 0, 59), 2)),
        by: pick(r, USERS),
        // A replacement file carries the whole original file; a supplementary
        // file carries only the corrected rejects. `count` is what is in the
        // file, `corrected` is what changed inside it.
        kind: model.key,
        count: model.key === 'replacement' ? batch.fileTxns : already.length,
        corrected: already.length,
        unchanged: model.key === 'replacement' ? batch.fileTxns - already.length : 0,
        value: model.key === 'replacement' ? batch.fileValue : corrValue,
        currency: t.currency,
        delivery: r() < 0.5 ? 'Pushed to S3' : 'Downloaded',
        outcome: already.every(function (x) { return x.status === 'cleared'; }) ? 'Accepted'
          : (already.some(function (x) { return x.status === 'regenerated'; }) ? 'Pending' : 'Pending'),
        checksum: checksum(seed + 11),
        s3Path: batch.s3Prefix + name2,
        manual: false
      });
    }
    // Batches carrying re-rejects show the file that came back rejected.
    if (batch.txns.some(function (x) { return x.status === 're_rejected'; })) {
      var rej = batch.txns.filter(function (x) { return x.status === 're_rejected'; });
      var rejValue = Math.round(rej.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100;
      batch.generated.push({
        name: netTok + '_CLEARING_' + tenTok + '_' + compact + '_R' + (batch.generated.length + 2) + model.suffix + '.txt',
        at: stamp(U.addDays(spec.date, 2), pad(rint(r, 10, 16), 2) + ':' + pad(rint(r, 0, 59), 2)),
        by: pick(r, USERS),
        kind: model.key,
        count: model.key === 'replacement' ? batch.fileTxns : rej.length,
        corrected: rej.length,
        unchanged: model.key === 'replacement' ? batch.fileTxns - rej.length : 0,
        value: model.key === 'replacement' ? batch.fileValue : rejValue,
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
    return batch;
  }

  SPECS.forEach(buildBatch);

  /* ---- Second pass: the IRD ladder scenarios (Part 6) --------------------
     Deliberately after every batch, so the six appended transactions take ids
     at the end of the sequence instead of renumbering the 137 rejects that
     already existed. Each one draws from its own rng stream, so nothing
     upstream shifts either. */
  irdPending.forEach(function (job) {
    var batch = job.batch, r = rng(job.seed + 977);
    job.spec.irdPlan.forEach(function (sc, k) {
      var at = job.base + k;
      var txn = buildTxn(batch, at, sc.status, (sc.burn || []).length || 1, job.seed + at * 17 + 3, sc);
      batch.txns.push(txn);
      txnById[txn.id] = txn;
    });
    // Those re-rejects came back on a file, and the file is a row in the
    // append-only generation history like any other.
    var rej = batch.txns.filter(function (x) { return x.status === 're_rejected'; });
    if (!rej.length) return;
    var netTok = NET_TOKEN[batch.network], tenTok = TENANT_TOKEN[batch.tenantId];
    var compact = batch.cycleDate.replace(/-/g, '');
    var lm = regenModel(batch);
    var lname = netTok + '_CLEARING_' + tenTok + '_' + compact + '_R' + (batch.generated.length + 2) + lm.suffix + '.txt';
    batch.generated.push({
      name: lname,
      at: stamp(U.addDays(batch.cycleDate, 2), pad(rint(r, 10, 16), 2) + ':' + pad(rint(r, 0, 59), 2)),
      by: pick(r, USERS),
      kind: lm.key,
      count: lm.key === 'replacement' ? batch.fileTxns : rej.length,
      corrected: rej.length,
      unchanged: lm.key === 'replacement' ? batch.fileTxns - rej.length : 0,
      value: lm.key === 'replacement' ? batch.fileValue : Math.round(rej.reduce(function (s, x) { return s + x.amount; }, 0) * 100) / 100,
      currency: batch.currency,
      delivery: 'Pushed to S3',
      outcome: 'Re-rejected',
      checksum: checksum(job.seed + 23),
      s3Path: batch.s3Prefix + lname,
      manual: false,
      note: 'Corrected IRDs from the resolution ladder. The network refused these again — each one advanced a rung.'
    });
  });

  /* ---- Third pass: RuPay (Round 3 §C.6) ---------------------------------
     The two correction paths apply uniformly across Visa, Mastercard and
     RuPay, and to staging as well as incoming rejects. RuPay batches exist so
     that is demonstrable rather than asserted. Built last, after the ladder
     pass, so no existing RJT id shifts — those are quoted in tickets. */
  var EXTRA_SPECS = [
    { tenant: 'yesbank', network: 'RuPay', family: 'staging', date: ago(2), fileTxns: 15340, recipe: { new: 3, corrected: 2 } },
    { tenant: 'hsbc-in', network: 'RuPay', family: 'incoming', date: ago(4), fileTxns: 17250, recipe: { cleared: 4, new: 2, corrected: 1, resubmitted: 1, re_rejected: 1 } }
  ];
  EXTRA_SPECS.forEach(function (spec, i) { buildBatch(spec, SPECS.length + i); });

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

  function saveCorrection(txn, changes, note, who, at, path) {
    if (!changes.length) return false;
    changes.forEach(function (c) { txn.fields[c.field] = c.to; });
    // Amount edits move the row's numeric value too, so batch sums stay honest.
    var amt = changes.filter(function (c) { return c.field === 'amount'; })[0];
    if (amt && !isNaN(parseFloat(amt.to))) txn.amount = parseFloat(amt.to);
    // The declared path is part of the permanent record — it says whether this
    // was a value fix or the downstream half of a config fix.
    txn.history.push({
      at: at || nowStamp(), by: who, kind: 'correction',
      path: path || 'data', changes: changes, note: note || null
    });
    txn.status = 'corrected';
    return true;
  }

  /* ---- The config path (Round 3 §C.6) -----------------------------------
     Nothing about the transaction is edited: the value is a symptom, the
     config is the cause. What is recorded is the request, the family it
     belongs to, and who asked — the same mandatory-note pattern every manual
     override in the Ops Portal uses. */
  function markAwaitingConfig(txn, note, familyKey, who, at) {
    var stampAt = at || nowStamp();
    var fam = configFamily(familyKey);
    txn.status = 'awaiting_config';
    txn.configRequest = { note: note, family: familyKey || null, familyLabel: fam ? fam.label : null, by: who, at: stampAt };
    txn.manualTag = { label: 'awaiting config fix', by: who, at: stampAt };
    txn.history.push({
      at: stampAt, by: who, kind: 'config_request', path: 'config', changes: [],
      note: note, configFamily: fam ? fam.label : null
    });
    return txn;
  }
  // Mocked re-derivation: the corrected config is applied to this transaction
  // and the recomputed values are written like any other correction. Real
  // re-derivation is a backend job against the activated config version.
  function rederive(txn, who, at) {
    var stampAt = at || nowStamp();
    var fields = relevantFields(txn.reasonCode);
    var m = { name: txn.merchant, mid: txn.mid, mcc: txn.attrs.mcc || txn.fields.mcc };
    var r = rng(arnSeed(txn.arn) + 41);
    var changes = [];
    fields.forEach(function (k) {
      var from = txn.fields[k] == null ? '' : String(txn.fields[k]);
      var to = String(correctedValue(k, txn, m, r));
      if (to && to !== from) changes.push({ field: k, from: from, to: to });
    });
    if (!changes.length) {
      // Nothing moved — the config fix was upstream of a field this reject does
      // not carry. The transaction still clears the block; it just says so.
      txn.status = 'corrected';
      txn.history.push({
        at: stampAt, by: who, kind: 'rederive', path: 'config', changes: [],
        note: 'Re-derived against the updated config. No field on this transaction changed — the corrected derivation produces the same values here.'
      });
      return changes;
    }
    changes.forEach(function (c) { txn.fields[c.field] = c.to; });
    var amt = changes.filter(function (c) { return c.field === 'amount'; })[0];
    if (amt && !isNaN(parseFloat(amt.to))) txn.amount = parseFloat(amt.to);
    txn.status = 'corrected';
    txn.manualTag = null;
    txn.history.push({
      at: stampAt, by: who, kind: 'rederive', path: 'config', changes: changes,
      note: 'Re-derived from the updated ' + ((txn.configRequest && txn.configRequest.familyLabel) || 'platform') +
        ' configuration' + (txn.configRequest ? ' — ' + txn.configRequest.note : '') + '.'
    });
    return changes;
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
      b.cycleDate.replace(/-/g, '') + '_' + retrySuffix(b) + regenModel(b).suffix + '.txt';
  }
  function correctedTxns(b) { return b.txns.filter(function (t) { return t.status === 'corrected'; }); }
  // Everything that will not be in the next file. Awaiting config fix sits here
  // deliberately: it is being worked, but not by anyone who can finish it in
  // this screen, so counting it as ready to regenerate would be a lie.
  function excludedTxns(b) {
    return b.txns.filter(function (t) {
      return ['new', 'under_correction', 'awaiting_config', 'wont_fix', 're_rejected'].indexOf(t.status) >= 0;
    });
  }
  function awaitingConfigTxns(b) { return b.txns.filter(function (t) { return t.status === 'awaiting_config'; }); }

  /* What the next generated file will contain, stated in the two models'
     own terms — this is what the pre-generation confirmation reads from. */
  function genPlan(b) {
    var model = regenModel(b);
    var included = correctedTxns(b);
    var excluded = excludedTxns(b);
    var corrValue = Math.round(included.reduce(function (s, t) { return s + t.amount; }, 0) * 100) / 100;
    return {
      model: model,
      corrected: included.length,
      correctedValue: corrValue,
      excluded: excluded.length,
      uncorrected: excluded.filter(function (t) { return t.status !== 'wont_fix'; }).length,
      awaitingConfig: awaitingConfigTxns(b).length,
      // Replacement: the whole file goes again. Supplementary: only the fixes.
      total: model.key === 'replacement' ? b.fileTxns : included.length,
      unchanged: model.key === 'replacement' ? b.fileTxns - included.length : 0,
      value: model.key === 'replacement' ? b.fileValue : corrValue,
      included: included
    };
  }

  function generateFile(b, who) {
    var plan = genPlan(b);
    var included = plan.included;
    var entry = {
      name: generatedName(b),
      at: nowStamp(),
      by: who,
      kind: plan.model.key,
      count: plan.total,
      corrected: included.length,
      unchanged: plan.unchanged,
      value: plan.value,
      currency: b.currency,
      delivery: 'Not yet delivered',
      outcome: 'Pending',
      checksum: checksum(b.fileTxns + b.generated.length * 7 + 5),
      s3Path: null,
      manual: false,
      supersedes: plan.model.key === 'replacement' ? b.clearingFile : null,
      txnIds: included.map(function (t) { return t.id; })
    };
    included.forEach(function (t) { t.status = 'regenerated'; });
    b.generated.push(entry);                 // append-only
    return entry;
  }

  /* ---- "All transactions in file" (Round 3 §C.5) -------------------------
     A staging reject's replacement file carries the whole original file, so the
     analyst has to be able to see what that is. Eighteen thousand rows is not a
     table; this returns the rejects (which is what actually changes) followed
     by a deterministic sample of the untouched remainder, and reports the true
     total so the sample is never mistaken for the file. */
  function fileTxnSample(b, limit) {
    limit = limit || 40;
    var rows = b.txns.map(function (t) {
      return {
        txnId: t.id, arn: t.arn, merchant: t.merchant, mid: t.mid, amount: t.amount,
        currency: t.currency, txnDate: t.txnDate, txnTime: t.txnTime,
        reasonCode: t.reasonCode, status: t.status, rejected: true
      };
    });
    var ms = O.merchantsByTenant[b.tenantId] || [];
    var t0 = O.tenantById[b.tenantId];
    var r = rng(b.fileTxns + 7717);
    var fill = Math.max(0, Math.min(limit, b.fileTxns - b.txns.length) - rows.length);
    for (var i = 0; i < fill; i++) {
      var m = ms[i % Math.max(1, ms.length)] || { name: 'Unknown Merchant', mid: '0000 0000 00000' };
      rows.push({
        txnId: null,
        arn: makeArn(r),
        merchant: m.name,
        mid: m.mid,
        amount: Math.round((t0.currency === 'INR' ? rint(r, 45000, 4800000) : rint(r, 900, 90000))) / 100,
        currency: b.currency,
        txnDate: U.addDays(b.cycleDate, -rint(r, 0, 2)),
        txnTime: hhmm(r),
        reasonCode: null,
        status: 'unchanged',
        rejected: false
      });
    }
    return { rows: rows, shown: rows.length, total: b.fileTxns, rejects: b.txns.length };
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
    PATHS: PATHS, pathLabel: pathLabel, CONFIG_FAMILIES: CONFIG_FAMILIES, configFamily: configFamily,
    REASONS: REASONS, reasonText: reasonText, isIrd: isIrd, rawMessage: rawMessage,
    FIELDS: FIELDS, ALL_FIELDS: ALL_FIELDS, relevantFields: relevantFields, otherFields: otherFields,
    groupedFields: groupedFields,
    recommend: recommend, irdCode: irdCode, irdDesc: irdDesc, mccLabel: mccLabel, entryLabel: entryLabel,
    // --- Mastercard staging IRD resolution ladder (Part 5) ---
    hasIrdLadder: hasIrdLadder, resolveIrd: resolveIrd, irdApplyNote: irdApplyNote,
    logIrdAttempt: logIrdAttempt, STRATEGY_NAME: STRATEGY_NAME, money: money, rateText: rateText,
    batches: batches, batchById: batchById, txnById: txnById, allTxns: allTxns,
    batchCounts: batchCounts, batchOpen: batchOpen, batchValue: batchValue, batchRate: batchRate,
    batchProgressText: batchProgressText, isBlocking: isBlocking,
    summary: summary, reasonCodesPresent: reasonCodesPresent,
    USERS: USERS, CURRENT_USER: CURRENT_USER, nowStamp: nowStamp,
    saveCorrection: saveCorrection, markWontFix: markWontFix,
    markAwaitingConfig: markAwaitingConfig, rederive: rederive,
    generatedName: generatedName, retrySuffix: retrySuffix,
    MODELS: MODELS, regenModel: regenModel, genPlan: genPlan, fileTxnSample: fileTxnSample,
    correctedTxns: correctedTxns, excludedTxns: excludedTxns, awaitingConfigTxns: awaitingConfigTxns,
    generateFile: generateFile, markDelivered: markDelivered, markDownloaded: markDownloaded
  };
})();
