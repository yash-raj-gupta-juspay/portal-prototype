/* =============================================================================
   Juspay Ops Portal — Failure hint lookup (file-detail brief Part 5)

   THIS FILE IS THE WHOLE "WHY DID IT FAIL" LAYER, AND IT COSTS THE BACKEND
   NOTHING.

   The backend contract (brief Part 2) gives a step exactly four new fields:
   started_at, finished_at, error_code and error_detail. `error_code` is a short
   stable string — PARSE_FIELD_UNMAPPED — with no description, no category and
   no remediation text attached. Everything a human needs to read is here, in
   the frontend, keyed on that code.

   That is deliberate. Adding a new hint is a one-object edit to this file and a
   deploy of static assets; it never waits on a backend release, a migration or
   a new endpoint. As real codes appear in production the catalogue grows here.

   THE RULE THAT MATTERS MOST: never invent a cause. A code that is not in this
   table renders as "not catalogued yet" and a null code renders as "no further
   detail was recorded" (Part 5.3). A confident guess about why a settlement
   file failed is worse than an honest gap — the gap at least tells you which
   code to add next.

   Shape (Part 5.1):
     CODE: {
       hint:      one or two sentences of plain language
       action:    { label, route, context: [...] }   // omit when there is no
                                                     // useful destination
       retryable: whether a Retry button is offered
     }
   `action.context` names which fields of the file record travel to the
   destination so it arrives pre-filtered (Part 7). Nothing here is read by the
   backend and nothing here is sent to it.
   ============================================================================= */
window.FailureHints = (function () {
  'use strict';

  /* =========================================================================
     5.2 — THE INITIAL HINT SET
     ========================================================================= */
  var HINTS = {

    /* ---- Incoming ------------------------------------------------------- */
    DECRYPT_KEY_MISMATCH: {
      hint: 'The file couldn’t be decrypted with the configured key. The key may have rotated.',
      // No config screen owns GPG keys, so there is no useful destination and
      // no button is rendered — Copy details and Retry remain (Part 7).
      retryable: true
    },
    FILE_EMPTY: {
      hint: 'The file arrived but contains no records.',
      retryable: false
    },
    LAYOUT_NOT_DETECTED: {
      hint: 'The file’s layout doesn’t match any configured format for this network.',
      action: {
        label: 'Open incoming parsing config →',
        route: '#/dashboard/ops/configs/incoming',
        tab: 'parser',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    PARSE_FIELD_UNMAPPED: {
      hint: 'A field in the file isn’t defined in the parsing configuration, so there was nothing to map it to.',
      action: {
        label: 'Open incoming parsing config →',
        route: '#/dashboard/ops/configs/incoming',
        tab: 'parser',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    LAYOUT_LENGTH_MISMATCH: {
      hint: 'Record length in the file doesn’t match the configured layout.',
      action: {
        label: 'Open incoming parsing config →',
        route: '#/dashboard/ops/configs/incoming',
        tab: 'parser',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    UNKNOWN_RECORD_TYPE: {
      hint: 'The file contains a record type that isn’t configured.',
      action: {
        label: 'Open incoming parsing config →',
        route: '#/dashboard/ops/configs/incoming',
        tab: 'preprocessor',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    TRAILER_COUNT_MISMATCH: {
      hint: 'The record count in the file trailer doesn’t match the records parsed.',
      retryable: true
    },

    /* ---- Outgoing clearing ---------------------------------------------- */
    NO_TRANSACTIONS_FOUND: {
      hint: 'No transactions matched this cycle, so there was nothing to write.',
      action: {
        label: 'Open this cycle →',
        route: '#/dashboard/ops/cycle-snapshot',
        context: ['tenant', 'network', 'date']
      },
      retryable: false
    },
    FIELD_VALUE_OVERFLOW: {
      hint: 'A value is longer than the field allows in the layout.',
      action: {
        label: 'Open network file config →',
        route: '#/dashboard/ops/configs/network-files',
        tab: 'layout',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    TRANSFORM_SOURCE_MISSING: {
      hint: 'A field in the layout has no data mapped to it.',
      action: {
        label: 'Open network file config, mapping →',
        route: '#/dashboard/ops/configs/network-files',
        tab: 'transform',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    LAYOUT_CONFIG_INVALID: {
      hint: 'The layout configuration has an error — fields may overlap or leave gaps.',
      action: {
        label: 'Open network file config →',
        route: '#/dashboard/ops/configs/network-files',
        tab: 'layout',
        context: ['network', 'tenant']
      },
      retryable: true
    },
    UPLOAD_FAILED: {
      hint: 'The file was produced but couldn’t be uploaded.',
      retryable: true
    },

    /* ---- Settlement ------------------------------------------------------ */
    SCHEDULE_EXCLUDED_DAY: {
      hint: 'The schedule excludes this day, so no report was due.',
      action: {
        label: 'Open settlement config, schedule →',
        route: '#/dashboard/ops/configs/settlement',
        tab: 'schedule',
        context: ['tenant', 'report']
      },
      retryable: false
    },
    REPORT_SOURCE_EMPTY: {
      hint: 'No transactions matched this report’s filters.',
      action: {
        label: 'Open settlement config, content →',
        route: '#/dashboard/ops/configs/settlement',
        tab: 'content',
        context: ['tenant', 'report']
      },
      retryable: false
    },
    FEE_RULE_NO_MATCH: {
      hint: 'Some transactions didn’t match any fee rule.',
      action: {
        label: 'Open settlement config, fees →',
        route: '#/dashboard/ops/configs/settlement',
        tab: 'fees',
        context: ['tenant', 'report']
      },
      retryable: true
    },
    DELIVERY_FAILED: {
      hint: 'The report was generated but couldn’t be delivered to the acquirer.',
      action: {
        label: 'Open Acquirer Reports →',
        route: '#/dashboard/ops/files',
        context: ['tenant', 'date']
      },
      retryable: true
    }
  };

  /* =========================================================================
     CONTEXT → QUERY STRING (Part 7)
     A destination "arrives pre-filtered" only if the link actually carries the
     filter. These translate a file record's own fields into the parameter
     names each destination screen already understands.
     ========================================================================= */

  // The Platform Configs catalogue uses underscored ids; the ops tenant list
  // uses hyphenated ones. One place knows the difference.
  var CFG_TENANT = { 'yesbank': 'yes_bank', 'hsbc-in': 'hsbc_in', 'hsbc-sg': 'hsbc_sg', 'hsbc-hk': 'hsbc_hk' };
  var CFG_NETWORK = { visa: 'visa', mc: 'mastercard', rupay: 'rupay', onus: 'hsbc_onus' };
  var CFG_SOURCE = { visa: 'visa_incoming', mc: 'mastercard_incoming', rupay: 'rupay_incoming' };

  function isConfigRoute(route) { return route.indexOf('/ops/configs/') >= 0; }
  function isIncomingConfig(route) { return route.indexOf('/configs/incoming') >= 0; }
  function isSettlementConfig(route) { return route.indexOf('/configs/settlement') >= 0; }

  /* Each context key contributes zero or more query params. A key whose value
     the file record does not carry contributes nothing at all — a half-filtered
     destination is still better than an unfiltered one, and far better than a
     link that pretends to context it does not have. */
  function paramsFor(key, file, action) {
    var out = [];
    var route = action.route;
    if (key === 'tenant' && file.tenantId) {
      if (isConfigRoute(route)) {
        var ct = CFG_TENANT[file.tenantId];
        if (ct) out.push(['cfgTenant', ct]);
      } else if (route.indexOf('/ops/files') >= 0) {
        out.push(['filesTenant', file.tenantId]);
      }
    }
    if (key === 'network' && file.networkKey && isConfigRoute(route)) {
      var facet = isIncomingConfig(route) ? CFG_SOURCE[file.networkKey] : CFG_NETWORK[file.networkKey];
      if (facet) out.push(['cfgFacet', facet]);
    }
    if (key === 'report' && file.reportBase && isSettlementConfig(route)) {
      out.push(['cfgFacet', file.reportBase]);
    }
    if (key === 'date' && file.date && route.indexOf('/ops/files') >= 0) {
      out.push(['filesDate', file.date]);
    }
    return out;
  }

  /* The cycle snapshot takes its context as path segments, not a query. */
  function cycleHref(file) {
    if (!file.tenantId || !file.networkKey || !file.date) return null;
    return '#/dashboard/ops/cycle-snapshot/' + file.tenantId + '/' + file.networkKey + '/' + file.date;
  }

  function buildHref(action, file, code) {
    if (action.route.indexOf('cycle-snapshot') >= 0) return cycleHref(file);
    var pairs = [];
    (action.context || []).forEach(function (k) {
      paramsFor(k, file, action).forEach(function (p) { pairs.push(p); });
    });
    if (action.tab) pairs.push(['tab', action.tab]);
    // Provenance, so the destination can say what sent the operator there and
    // offer a way back to the file (Part 7). Never more than the file's own id.
    if (file.uuid) pairs.push(['fileFrom', file.uuid]);
    if (code) pairs.push(['fileCode', code]);
    if (!pairs.length) return action.route;
    return action.route + '?' + pairs.map(function (p) {
      return p[0] + '=' + encodeURIComponent(p[1]);
    }).join('&');
  }

  /* =========================================================================
     RESOLUTION — the only entry point a renderer needs
     Returns one of three states, and the caller renders each honestly:
       known         → the catalogued hint plus its destination
       uncatalogued  → "This error hasn’t been catalogued yet." (Part 5.3)
       none          → "The step failed. No further detail was recorded."
     ========================================================================= */
  var UNCATALOGUED_HINT = 'This error hasn’t been catalogued yet.';
  var NO_DETAIL_HINT = 'The step failed. No further detail was recorded.';

  function resolve(code, file) {
    file = file || {};
    if (!code) {
      return { state: 'none', hint: NO_DETAIL_HINT, action: null, retryable: true };
    }
    var entry = HINTS[code];
    if (!entry) {
      return { state: 'uncatalogued', hint: UNCATALOGUED_HINT, action: null, retryable: true };
    }
    var href = entry.action ? buildHref(entry.action, file, code) : null;
    return {
      state: 'known',
      hint: entry.hint,
      // A destination that cannot be built for this file (no network on a
      // settlement file, say) renders no button rather than a dead one.
      action: (entry.action && href) ? { label: entry.action.label, href: href } : null,
      retryable: !!entry.retryable
    };
  }

  return {
    HINTS: HINTS,
    has: function (code) { return !!(code && HINTS[code]); },
    get: function (code) { return (code && HINTS[code]) || null; },
    codes: function () { return Object.keys(HINTS); },
    resolve: resolve,
    CFG_TENANT: CFG_TENANT, CFG_NETWORK: CFG_NETWORK, CFG_SOURCE: CFG_SOURCE
  };
})();
