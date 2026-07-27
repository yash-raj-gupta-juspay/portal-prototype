/* =============================================================================
   Juspay Ops Portal — Platform Configs: FORMAT AWARENESS (Refinement round 2)

   Network file configs are NOT one format. The editor branches on the config's
   declared `output_format`, exactly as the engine does:

     Visa       config/visa/tc05.yaml          → output_format: "fixed_width"
     RuPay      config/rupay/sample.yaml       → output_config.output_format: "xml"
     Mastercard config/mastercard/clearing.yaml→ output_config.output_format: "csv"

   Incoming layouts carry the same discriminator at the top of the layout JSON:
     config/visa_incoming/visa_vss_layout.json          → "format": "fixed_width"
     config/mastercard_incoming/..._layout.json         → "format": "xml"
     config/rupay_incoming/rupay_incoming_layout.json   → "format": "xlsx"

   This module is pure data + derivation. Rendering lives in configs-screens.js.
   Loaded FIRST so configs-data.js can seed bodies from the catalogues here.
   ============================================================================= */
window.CFGFMT = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function icon(name, size) {
    size = size || 14;
    return '<i data-lucide="' + name + '" style="width:' + size + 'px;height:' + size + 'px"></i>';
  }

  /* =========================================================================
     1 · Output formats and what the editor may show for each
     ========================================================================= */
  var FORMATS = {
    fixed_width: {
      key: 'fixed_width', label: 'Fixed width', short: 'Fixed', icon: 'ruler',
      blurb: 'Positional records — every field has a start position and a length.',
      grounding: 'config/visa/tc05.yaml → output_format: "fixed_width", fixed_width_config.record_length',
      recordLength: true, positions: true, byteMap: true, padding: true, encoding: true,
      xmlSettings: false, csvSettings: false, dePds: false, groupSections: false,
      extension: true, defaultExtension: '.txt'
    },
    xml: {
      key: 'xml', label: 'XML', short: 'XML', icon: 'code-2',
      blurb: 'One element per field inside a record element — no byte positions.',
      grounding: 'config/rupay/sample.yaml → output_config.output_format: "xml", xml_file_config',
      recordLength: false, positions: false, byteMap: false, padding: false, encoding: false,
      xmlSettings: true, csvSettings: false, dePds: false, groupSections: true,
      extension: true, defaultExtension: '.xml'
    },
    csv: {
      key: 'csv', label: 'CSV / Excel', short: 'CSV', icon: 'table-2',
      blurb: 'Delimited DE/PDS columns grouped by record type — no byte positions.',
      grounding: 'config/mastercard/clearing.yaml → output_config.output_format: "csv", csv_config.delimiter',
      recordLength: false, positions: false, byteMap: false, padding: false, encoding: false,
      xmlSettings: false, csvSettings: true, dePds: true, groupSections: true,
      extension: true, defaultExtension: '.csv'
    },
    xlsx: {
      key: 'xlsx', label: 'Spreadsheet (xlsx)', short: 'XLSX', icon: 'sheet',
      blurb: 'Spreadsheet columns addressed by header name — no byte positions.',
      grounding: 'config/rupay_incoming/rupay_incoming_layout.json → "format": "xlsx"',
      recordLength: false, positions: false, byteMap: false, padding: false, encoding: false,
      xmlSettings: false, csvSettings: false, dePds: false, groupSections: false,
      extension: true, defaultExtension: '.xlsx'
    }
  };
  var FORMAT_KEYS = ['fixed_width', 'xml', 'csv'];
  var ALL_FORMAT_KEYS = ['fixed_width', 'xml', 'csv', 'xlsx'];

  function formatOf(body) {
    if (!body) return 'fixed_width';
    return body.output_format || body.format || 'fixed_width';
  }
  function caps(bodyOrKey) {
    var k = typeof bodyOrKey === 'string' ? bodyOrKey : formatOf(bodyOrKey);
    return FORMATS[k] || FORMATS.fixed_width;
  }
  function isFixed(b) { return formatOf(b) === 'fixed_width'; }
  function isXml(b) { return formatOf(b) === 'xml'; }
  function isCsv(b) { return formatOf(b) === 'csv'; }

  // Common output extensions offered by the reusable extension picker (§1.2).
  var EXTENSIONS = {
    fixed_width: ['.txt', '.dat', '.001', '.ipm'],
    xml: ['.xml', '.txt'],
    csv: ['.csv', '.txt', '.xlsx'],
    xlsx: ['.xlsx', '.csv']
  };
  function extensionOptions(fmt) {
    return (EXTENSIONS[fmt] || EXTENSIONS.fixed_width).slice();
  }

  /* =========================================================================
     2 · Mastercard DE / PDS catalogue
     Descriptions seeded from the Mastercard IPM data dictionary for the data
     elements. PDS entries are only seeded where this repo tells us what they
     are — the rest are deliberately BLANK and editable rather than invented
     (refinement spec §7: "if something isn't found, don't invent").
     ========================================================================= */
  var DE_DESC = {
    MTI: 'Message Type Indicator — 1240 first presentment, 1644 file header / trailer.',
    DE2: 'Primary Account Number (PAN).',
    DE3: 'Processing Code — SF1 carries the transaction type used for IRD matching.',
    DE4: 'Amount, Transaction — the cardholder-billed amount in minor units.',
    DE12: 'Date and Time, Local Transaction.',
    DE14: 'Date, Expiration — card expiry.',
    DE22: 'Point of Service (POS) Data Code.',
    DE23: 'Card Sequence Number.',
    DE24: 'Function Code — 200 first presentment, 697 file header, 695 file trailer.',
    DE25: 'Message Reason Code.',
    DE26: 'Card Acceptor Business Code (MCC).',
    DE30: 'Amounts, Original.',
    DE31: 'Acquirer Reference Data (ARD).',
    DE33: 'Forwarding Institution ID Code.',
    DE37: 'Retrieval Reference Number (RRN).',
    DE38: 'Approval Code — the authorisation code.',
    DE40: 'Service Code.',
    DE41: 'Card Acceptor Terminal ID.',
    DE42: 'Card Acceptor ID Code.',
    DE43: 'Card Acceptor Name / Location — composite, emitted as the sub-fields below.',
    DE43_NAME: 'Card acceptor name portion of DE43.',
    DE43_SUBURB: 'Card acceptor city / suburb portion of DE43.',
    DE43_POSTCODE: 'Card acceptor country / postcode portion of DE43.',
    DE48: 'Additional Data — Private Use. Carries the PDS elements listed underneath.',
    DE49: 'Currency Code, Transaction.',
    DE54: 'Additional Amounts — used here for the surcharge breakdown.',
    DE55: 'Integrated Circuit Card (ICC) System-Related Data.',
    DE63: 'Transaction Life Cycle ID.',
    DE71: 'Message Number.',
    DE72: 'Data Record.',
    DE94: 'Transaction Originator Institution ID Code.',
    DE95: 'Card Issuer Reference Data.',
    DE105: 'Large Private Use field.',
    PDS0023: 'Terminal Type.',
    // Repo-grounded rather than spec-quoted — flagged as such in the UI.
    PDS0105: 'File ID — processor ID + file sequence. Validated by p0105_validation in mastercard_incoming.yaml.',
    PDS0301: 'Total transaction amount for the file — derived by sum_column over txn_amount in clearing.yaml.',
    PDS0306: 'Record count for the file — derived by row_count in clearing.yaml.',
    ICC_DATA: 'Not an IPM data element — an output column this config pads to 286 characters.'
  };
  // Descriptions that come from this repo's config/code rather than the IPM
  // data dictionary. The UI badges them so nobody mistakes them for spec text.
  var DESC_FROM_REPO = { PDS0105: true, PDS0301: true, PDS0306: true, ICC_DATA: true };

  function describe(name) { return DE_DESC[name] || ''; }
  function descIsFromRepo(name) { return !!DESC_FROM_REPO[name]; }
  function isDePds(name) { return /^(DE\d+|PDS\d+|MTI)/.test(String(name || '')); }

  /* =========================================================================
     3 · Composite DE → PDS / sub-field accordion (§3.1.3)
     Children are taken from the config body when declared (body.composites, so
     it stays editable data) and otherwise inferred from the `DE43_*` prefix
     convention that clearing_layout.json actually uses.
     ========================================================================= */
  function compositesOf(body) {
    var declared = (body && body.composites) || {};
    var out = {};
    Object.keys(declared).forEach(function (k) { out[k] = (declared[k] || []).slice(); });
    return out;
  }
  // name → parent DE, for every field that is a child of a composite.
  function childIndex(body, fields) {
    var comp = compositesOf(body), idx = {};
    Object.keys(comp).forEach(function (parent) {
      comp[parent].forEach(function (child) { idx[child] = parent; });
    });
    // Prefix convention: DE43_NAME / DE43_SUBURB / DE43_POSTCODE belong to DE43.
    var names = (fields || []).map(function (f) { return f.name; });
    names.forEach(function (n) {
      if (idx[n]) return;
      var m = /^(DE\d+)_/.exec(String(n || ''));
      if (m && names.indexOf(m[1]) >= 0) idx[n] = m[1];
    });
    return idx;
  }
  // Ordered render model: [{ field, index, children: [{field,index}] }]
  function groupComposites(body, fields) {
    var idx = childIndex(body, fields || []);
    var rows = [], byName = {};
    (fields || []).forEach(function (f, i) {
      var parent = idx[f.name];
      if (parent && byName[parent]) { byName[parent].children.push({ field: f, index: i }); return; }
      var row = { field: f, index: i, children: [] };
      byName[f.name] = row;
      rows.push(row);
    });
    // A child whose parent row never appeared stays a top-level row (already handled).
    return rows;
  }

  /* =========================================================================
     4 · Record-type groups (§3.1.2 / §3.2b)
     clearing.yaml groups: file_header ["1644"], transactions ["1240"],
     file_trailer ["1644"]. sample.yaml (RuPay) uses the same `groups` shape
     with xml_config instead of csv_config.
     ========================================================================= */
  var GROUP_ROLES = [
    { key: 'file_header', label: 'Header', icon: 'panel-top', blurb: 'File header record — emitted once, before any transaction.' },
    { key: 'txn_block', label: 'Transaction block', icon: 'box', blurb: 'Wrapper element around the transaction records (XML only).' },
    { key: 'transactions', label: 'Detail / Transactions', icon: 'rows-3', blurb: 'One record per eligible transaction row.' },
    { key: 'file_trailer', label: 'Trailer / Footer', icon: 'panel-bottom', blurb: 'File trailer record — counts and totals, emitted once at the end.' },
    { key: 'file_root', label: 'File root', icon: 'file', blurb: 'Root element that wraps the whole file (XML only).' }
  ];
  var roleByKey = {}; GROUP_ROLES.forEach(function (r) { roleByKey[r.key] = r; });
  function roleOf(groupName) {
    return roleByKey[groupName] || { key: groupName, label: groupName, icon: 'layers', blurb: '' };
  }
  function groupsOf(body) {
    var tf = (body && body.transform) || {};
    return tf.groups || [];
  }
  // record_types entries are either a plain string ("1644") or
  // { type: "1240", conditions: [...] } — normalise both.
  function recordTypesOf(group) {
    return (group.record_types || []).map(function (rt) {
      if (typeof rt === 'string') return { type: rt, conditions: [] };
      return { type: rt.type, conditions: rt.conditions || [] };
    });
  }
  // Which group emits a given layout record type ("1644" → file_header first).
  function groupsForRecordType(body, rtKey) {
    return groupsOf(body).filter(function (g) {
      return recordTypesOf(g).some(function (rt) { return String(rt.type) === String(rtKey); });
    });
  }

  var DERIVED_TYPES = [
    ['constant', 'constant — literal value'],
    ['row_count', 'row_count — number of rows emitted'],
    ['sum_column', 'sum_column — total of a column'],
    ['config_lookup', 'config_lookup — value resolved from a DB / config lookup'],
    ['passthrough', 'passthrough — value carried through unchanged'],
    ['gst_split', 'gst_split — split gross into fee + GST'],
    ['DE48', 'DE48 — builder that assembles DE48 from its PDS elements'],
    ['PDS0105', 'PDS0105 — builder that assembles the file-ID PDS']
  ];
  var TRANSFORMS = [
    'passthrough', 'substring', 'pad_value', 'pad_clearing_amount', 'format_date', 'switch',
    'rupay_amount', 'mastercard_de54_surcharge', 'split_dot_left', 'split_dot_right'
  ];
  var OPERATORS = ['in', 'not_in', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'];

  /* =========================================================================
     5 · "DB / lookup source" resolution (§1.1)
     For any output field, say where its value comes from — mirroring the order
     the engine resolves it in: group constants → group derived → field_mappings
     → json_extractions.
     Kinds: constant | lookup | derived | json | direct | none
     ========================================================================= */
  function jsonOriginOf(body, columnName) {
    var tf = (body && body.transform) || {};
    var hit = null;
    (tf.json_extractions || []).forEach(function (g) {
      (g.rows || []).forEach(function (r) {
        if (!hit && r.output === columnName) {
          hit = { source_column: g.source_column, json_key: r.json_key, transform: r.transform || null, params: r.params || null };
        }
      });
    });
    return hit;
  }

  function resolveSource(body, fieldName, groupName) {
    var tf = (body && body.transform) || {};
    var groups = groupsOf(body);
    var scoped = groupName ? groups.filter(function (g) { return g.name === groupName; }) : groups;

    for (var i = 0; i < scoped.length; i++) {
      var g = scoped[i], f = g.fields || {};
      var consts = f.constants || {};
      if (Object.prototype.hasOwnProperty.call(consts, fieldName)) {
        return { kind: 'constant', group: g.name, value: consts[fieldName] };
      }
      var derived = f.derived || [];
      for (var j = 0; j < derived.length; j++) {
        var d = derived[j];
        var hitsName = d.name === fieldName || (d.aliases || []).indexOf(fieldName) >= 0;
        if (!hitsName) continue;
        if (d.type === 'config_lookup') {
          return {
            kind: 'lookup', group: g.name, derivedName: d.name,
            lookupColumns: ((d.params || {}).lookup_columns) || [],
            resultIndex: (d.params || {}).result_index
          };
        }
        if (d.type === 'constant') {
          return { kind: 'constant', group: g.name, value: (d.params || {}).value, viaDerived: d.name };
        }
        return { kind: 'derived', group: g.name, dtype: d.type, derivedName: d.name, params: d.params || {}, aliases: d.aliases || [] };
      }
    }

    var fm = (tf.field_mappings || {})[fieldName];
    if (fm && fm.source) {
      var origin = jsonOriginOf(body, fm.source);
      if (origin) {
        return {
          kind: 'json', column: fm.source, sourceColumn: origin.source_column, jsonKey: origin.json_key,
          transform: fm.transform || null, params: fm.params || null
        };
      }
      return { kind: 'direct', column: fm.source, transform: fm.transform || null, params: fm.params || null };
    }

    // A field the layout declares but nothing populates — worth surfacing.
    return { kind: 'none' };
  }

  var SOURCE_META = {
    direct: { label: 'Direct', icon: 'database', cls: 'src-direct', tip: 'Read straight from an input / DB column on the transaction row.' },
    json: { label: 'JSON extract', icon: 'braces', cls: 'src-json', tip: 'Extracted from a JSON column by key, then mapped into this field.' },
    lookup: { label: 'Lookup / DB source', icon: 'table-2', cls: 'src-lookup', tip: 'Resolved by a config_lookup — the engine keys a lookup table on the columns shown.' },
    constant: { label: 'Constant', icon: 'lock', cls: 'src-const', tip: 'A literal written into every record.' },
    derived: { label: 'Derived', icon: 'function-square', cls: 'src-derived', tip: 'Computed by a named builder at file-generation time.' },
    none: { label: 'Unmapped', icon: 'circle-dashed', cls: 'src-none', tip: 'No mapping, constant or derived entry writes this field — it will be emitted empty / padded.' }
  };

  // Short human detail line for a resolved source.
  function sourceDetail(s) {
    if (!s) return '';
    if (s.kind === 'direct') return s.column + (s.transform && s.transform !== 'passthrough' ? ' · ' + s.transform : '');
    if (s.kind === 'json') return s.sourceColumn + '.' + s.jsonKey;
    if (s.kind === 'lookup') {
      return 'keys: ' + (s.lookupColumns || []).join(' + ') +
        (s.resultIndex == null ? '' : ' · result_index ' + s.resultIndex);
    }
    if (s.kind === 'constant') return s.value === '' ? '""' : String(s.value);
    if (s.kind === 'derived') return s.dtype + (s.derivedName && s.derivedName !== s.dtype ? ' (' + s.derivedName + ')' : '');
    return '';
  }

  function sourceBadge(s) {
    var m = SOURCE_META[(s && s.kind) || 'none'];
    var detail = sourceDetail(s);
    var tip = m.tip;
    if (s && s.kind === 'lookup') {
      tip = 'config_lookup — the engine keys its lookup table on ' + (s.lookupColumns || []).join(' + ') +
        (s.resultIndex == null ? '' : ' and takes result_index ' + s.resultIndex) +
        '. The lookup table itself is resolved by the engine\'s config-lookup registry, not named in this config.';
    }
    if (s && s.kind === 'json') tip = 'Extracted from ' + s.sourceColumn + ' by JSON key "' + s.jsonKey + '" into the column ' + s.column + '.';
    if (s && s.kind === 'derived') tip = 'Derived by the "' + s.dtype + '" builder' + (s.group ? ' in group ' + s.group : '') + '.';
    return '<span class="src-cell">' +
      '<span class="tip src-badge ' + m.cls + '" data-tip="' + esc(tip) + '">' + icon(m.icon, 12) + esc(m.label) + '</span>' +
      (detail ? '<span class="src-detail mono">' + esc(detail) + '</span>' : '') +
      (s && s.group ? '<span class="src-group">' + esc(s.group) + '</span>' : '') +
      '</span>';
  }

  /* =========================================================================
     6 · Format summary strip shown at the top of the Layout tab
     ========================================================================= */
  function formatSummary(body) {
    var c = caps(body);
    var bits = [];
    if (c.recordLength) bits.push('record length ' + (body.record_length || 0));
    if (c.xmlSettings) {
      var x = body.xml_file_config || {};
      bits.push('root <' + (x.root_element || '?') + '>');
      bits.push(x.pretty_print ? 'pretty printed' : 'single line');
    }
    if (c.csvSettings) {
      var cc = body.csv_config || {};
      bits.push('delimiter "' + (cc.delimiter || ',') + '"');
      if (cc.line_ending) bits.push(cc.line_ending);
    }
    var oc = body.output_config || {};
    if (oc.default_output_file) bits.push(oc.default_output_file);
    return bits;
  }

  return {
    esc: esc, icon: icon,
    FORMATS: FORMATS, FORMAT_KEYS: FORMAT_KEYS, ALL_FORMAT_KEYS: ALL_FORMAT_KEYS,
    formatOf: formatOf, caps: caps, isFixed: isFixed, isXml: isXml, isCsv: isCsv,
    extensionOptions: extensionOptions,
    DE_DESC: DE_DESC, describe: describe, descIsFromRepo: descIsFromRepo, isDePds: isDePds,
    compositesOf: compositesOf, childIndex: childIndex, groupComposites: groupComposites,
    GROUP_ROLES: GROUP_ROLES, roleOf: roleOf, groupsOf: groupsOf,
    recordTypesOf: recordTypesOf, groupsForRecordType: groupsForRecordType,
    DERIVED_TYPES: DERIVED_TYPES, TRANSFORMS: TRANSFORMS, OPERATORS: OPERATORS,
    resolveSource: resolveSource, sourceBadge: sourceBadge, sourceDetail: sourceDetail,
    SOURCE_META: SOURCE_META, jsonOriginOf: jsonOriginOf,
    formatSummary: formatSummary
  };
})();
