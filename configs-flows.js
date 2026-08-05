/* =============================================================================
   Juspay Ops Portal — Platform Configs: guided task flows (refinement Part 8)

   THE PROBLEM THIS FIXES. The task cards on the Platform Configs landing page
   said one thing and did another: every card opened the same full network
   config editor, whatever it was labelled. "Add a field to a file" dropped you
   into layouts, transforms, schedules and fees all at once — which is exactly
   the thing someone who has never worked on the backend cannot navigate.

   Every card now opens its OWN flow, doing exactly what the card says and
   nothing else. The full editor is still there, reachable from Browse all
   configurations at the bottom of the landing page, for people who want to see
   everything. Nothing on the landing page opens it any more.

   ONE FLOW SHAPE, THIRTEEN FLOWS:
     · numbered steps with a progress indicator
     · one decision per step
     · Back / Next pinned in a footer; Next disabled until the step is valid
     · the final step is always a review of exactly what will change, then
       Submit for approval

   The five `view-*` tasks are read-only: a chooser, then the thing. No steps,
   no footer, no submit — because there is nothing to submit.

   State is in memory only. Every submission goes through the same
   maker-checker path the editor uses (api.submitBody), so a flow can never
   write a config the editor would not have.

   window.ConfigFlowsUI(kit) → { route, actions, cardRoute }
   ============================================================================= */
window.ConfigFlowsUI = function (kit) {
  'use strict';
  var D = window.DATA, U = D.util, C = window.CFGDATA, X = window.CFGCORE, F = window.CFGFMT;
  var S = window.AppState;
  var icon = kit.icon, esc = kit.esc, pill = kit.pill, setView = kit.setView, el = kit.el,
    go = kit.go, toast = kit.toast, num = kit.num, emptyState = kit.emptyState, field = kit.field;

  var BASE = '#/dashboard/ops/configs';
  function flowRoute(id) { return BASE + '/task/' + id; }

  /* In memory only. `d` is the flow's own working data — never a config body
     until the review step builds one. */
  S.cff = { task: null, step: 1, d: {} };

  /* =========================================================================
     SHARED PICKERS
     Every flow starts by naming what it is going to change, and there are only
     three ways to do that: a network-file config, an incoming-parsing config,
     or a settlement report. So there are three pickers, not thirteen.
     ========================================================================= */
  function tenantsWithConfigs(fam) {
    var seen = {}, out = [];
    C.byFamily(fam).forEach(function (c) { if (!seen[c.tenantId]) { seen[c.tenantId] = 1; out.push(c.tenantId); } });
    return out;
  }
  function tenantName(key) { return (C.tenantByKey[key] || { name: key }).name; }
  function netLabel(key) { return (C.netByKey[key] || { label: key }).label; }

  /* A choice grid: one card per option, the selected one carrying its state
     visibly rather than through a dot in a radio. */
  function chooser(action, options, selected, extra) {
    if (!options.length) {
      return '<div class="cff-empty">' + emptyState('search-x', 'Nothing to choose from',
        'No configuration of this kind exists yet.') + '</div>';
    }
    return '<div class="cff-choices' + (extra && extra.dense ? ' dense' : '') + '">' + options.map(function (o) {
      var on = String(selected) === String(o.value);
      return '<button type="button" class="cff-choice' + (on ? ' active' : '') + '" ' +
        'data-action="' + action + '" data-value="' + esc(o.value) + '" ' +
        'role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
        '<span class="cff-choice-main">' + esc(o.label) + '</span>' +
        (o.sub ? '<span class="cff-choice-sub">' + esc(o.sub) + '</span>' : '') +
        (on ? '<span class="cff-choice-tick">' + icon('check', 15) + '</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  /* The layout ruler, live. Clicking a gap pre-fills position and length —
     that is the whole reason this step exists rather than a pair of number
     inputs the operator has to derive by hand. */
  function ruler(recordLength, fields, opts) {
    return X.byteMapHtml(recordLength, fields, opts || {});
  }

  function nfConfigs() { return C.byFamily('network-file').filter(function (c) { return bodyRecordTypes(c).length; }); }
  function ipConfigs() { return C.byFamily('incoming-parsing'); }
  function ipParserConfigs() { return ipConfigs().filter(function (c) { return c.subType === 'parser'; }); }
  function bodyOf(cfg) { return C.clone(cfg.currentDraft ? cfg.currentDraft.body : cfg.body); }
  function bodyRecordTypes(cfg) {
    var b = cfg.currentDraft ? cfg.currentDraft.body : cfg.body;
    return (b && b.record_types) || [];
  }
  function cfgOptions(list) {
    return list.map(function (c) {
      return { value: c.configId, label: c.name, sub: tenantName(c.tenantId) + ' · ' + c.state.toLowerCase().replace(/_/g, ' ') };
    });
  }
  function cfgById(id) { return C.byId[id] || null; }

  /* Fields of the chosen record set, with their index so the ruler and the
     table can point at the same thing. */
  function rtOf(d) {
    var cfg = cfgById(d.configId); if (!cfg) return null;
    var rts = bodyRecordTypes(cfg);
    return rts[d.rt == null ? 0 : d.rt] || rts[0] || null;
  }
  function fieldsOf(d) { var rt = rtOf(d); return (rt && rt.fields) || []; }
  function recordLengthOf(d) {
    var cfg = cfgById(d.configId); if (!cfg) return 0;
    var b = cfg.currentDraft ? cfg.currentDraft.body : cfg.body;
    return b.record_length || 0;
  }
  function isFixedWidth(cfg) {
    var b = cfg && (cfg.currentDraft ? cfg.currentDraft.body : cfg.body);
    return !!(b && (b.output_format === 'fixed_width' || b.record_length));
  }

  /* =========================================================================
     REVIEW — every flow ends here, and it shows exactly what will change.
     ========================================================================= */
  function reviewRows(rows) {
    return '<dl class="def-list cff-review">' + rows.filter(Boolean).map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>';
    }).join('') + '</dl>';
  }
  function reviewTarget(cfg) {
    return '<div class="cff-target">' + icon('file-code', 16) +
      '<span><strong>' + esc(cfg.name) + '</strong> · ' + esc(tenantName(cfg.tenantId)) + '</span></div>';
  }
  function approvalNote() {
    return '<div class="callout info cff-approval">' + icon('shield-check', 20) +
      '<div class="callout-body">Submitting sends this to the config approvals queue. ' +
      'Nothing reaches production until a checker approves it, and you cannot approve your own change.</div></div>';
  }

  /* =========================================================================
     THE FLOWS
     Each is { title, blurb, fam, readOnly?, steps: [{ key, label, render,
     valid, }], build(d) → { cfg, body, summary } }
     ========================================================================= */
  var FLOWS = {};

  /* ---- 1 · Add a field to a file ---------------------------------------- */
  FLOWS['add-field'] = {
    title: 'Add a field to a file', fam: 'network-file',
    blurb: 'Declare a new field and where it sits in the record.',
    steps: [
      {
        key: 'choose', label: 'Choose',
        render: function (d) {
          var list = nfConfigs();
          return stepHead('Which file are you adding a field to?',
            'Pick the network, tenant and record set. Everything after this step is about that one record.') +
            chooser('cff-c-config', cfgOptions(list), d.configId) +
            (d.configId ? recordSetPicker(d) : '');
        },
        valid: function (d) { return !!d.configId && d.rt != null; }
      },
      {
        key: 'where', label: 'Where',
        render: function (d) {
          var fields = fieldsOf(d), rl = recordLengthOf(d);
          /* The ruler is the control, not an illustration: an undeclared span
             is a button, and using it fills in the position and length below.
             That is why this step is a ruler rather than two number inputs the
             operator has to derive by counting characters. */
          return stepHead('Where does it sit in the record?', '') +
            ruler(rl, fields, { interactive: true, rt: d.rt, id: 'cffRuler', gapAction: 'cfg-gap-flow' }) +
            '<div class="cff-pos">' +
            field('Starts at character', '<input class="input num" type="number" min="1" data-action="cff-i-start" value="' + (d.start || '') + '" />', true) +
            field('Length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || '') + '" />', true) +
            '</div>' +
            overlapWarning(d, fields);
        },
        valid: function (d) { return d.start > 0 && d.length > 0; }
      },
      {
        key: 'details', label: 'Details',
        render: function (d) {
          return stepHead('What is the field?', 'The name is what appears in the layout and in every error that mentions it.') +
            '<div class="cff-form">' +
            field('Field name', '<input class="input" data-action="cff-i-name" value="' + esc(d.name || '') + '" placeholder="e.g. Merchant category code" />', true) +
            field('Content type', typeSelect(d.type)) +
            field('Notes', '<textarea class="input" data-action="cff-i-note" placeholder="What this field carries, and where the value comes from.">' + esc(d.note || '') + '</textarea>') +
            '</div>';
        },
        valid: function (d) { return !!(d.name || '').trim(); }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = cfgById(d.configId);
      var body = bodyOf(cfg);
      var rt = body.record_types[d.rt];
      rt.fields = rt.fields.concat([{ name: d.name.trim(), start: +d.start, length: +d.length, type: d.type || 'AN', note: d.note || '' }]);
      rt.fields.sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      return {
        cfg: cfg, body: body,
        summary: 'Added field “' + d.name.trim() + '” at characters ' + d.start + '–' + (+d.start + +d.length - 1) + ' of ' + (rt.label || rt.record_type) + '.',
        rows: [
          ['Record set', esc(rtLabel(rt))],
          ['Field name', '<strong>' + esc(d.name) + '</strong>'],
          ['Position', '<span class="num">' + d.start + '</span> – <span class="num">' + (+d.start + +d.length - 1) + '</span>'],
          ['Length', '<span class="num">' + d.length + '</span>'],
          ['Content type', esc(typeName(d.type))],
          d.note ? ['Notes', esc(d.note)] : null
        ]
      };
    }
  };

  /* ---- 2 · Change a field's position or length --------------------------- */
  FLOWS['move-field'] = {
    title: "Change a field's position or length", fam: 'network-file',
    blurb: 'Adjust where a field starts and how long it is.',
    steps: [
      {
        key: 'config', label: 'Config',
        render: function (d) {
          return stepHead('Which file layout are you changing?', '') +
            chooser('cff-c-config', cfgOptions(nfConfigs()), d.configId) +
            (d.configId ? recordSetPicker(d) : '');
        },
        valid: function (d) { return !!d.configId && d.rt != null; }
      },
      {
        key: 'field', label: 'Field',
        render: function (d) {
          var fields = fieldsOf(d);
          return stepHead('Which field?', '') +
            '<label class="ops-search cff-search">' + icon('search', 18) +
            '<input class="input" data-action="cff-i-q" value="' + esc(d.q || '') + '" placeholder="Search fields" aria-label="Search fields" /></label>' +
            fieldList(d, fields) +
            (d.fi != null ? ruler(recordLengthOf(d), fields, { rt: d.rt }) : '');
        },
        valid: function (d) { return d.fi != null && fieldsOf(d)[d.fi]; }
      },
      {
        key: 'new', label: 'New position',
        render: function (d) {
          var fields = fieldsOf(d), f = fields[d.fi];
          // The ruler previews the change live, against the same record, so an
          // overlap is visible before it is submitted rather than after.
          var preview = fields.map(function (x, i) {
            return i === d.fi
              ? { name: x.name, start: +(d.start || x.start), length: +(d.length || x.length), type: x.type, note: x.note }
              : x;
          });
          return stepHead('Where should it sit now?', '') +
            '<div class="cff-was">Currently characters <span class="num">' + f.start + '</span>–<span class="num">' + (f.start + f.length - 1) + '</span>, length <span class="num">' + f.length + '</span>.</div>' +
            '<div class="cff-pos">' +
            field('Starts at character', '<input class="input num" type="number" min="1" data-action="cff-i-start" value="' + (d.start || f.start) + '" />', true) +
            field('Length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || f.length) + '" />', true) +
            '</div>' +
            ruler(recordLengthOf(d), preview, { rt: d.rt, title: 'With this change applied' }) +
            overlapWarning({ start: d.start || f.start, length: d.length || f.length }, fields.filter(function (x, i) { return i !== d.fi; }));
        },
        valid: function (d) {
          var f = fieldsOf(d)[d.fi]; if (!f) return false;
          var s = +(d.start || f.start), l = +(d.length || f.length);
          return s > 0 && l > 0 && (s !== f.start || l !== f.length);
        }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = cfgById(d.configId), body = bodyOf(cfg);
      var rt = body.record_types[d.rt];
      var f = rt.fields[d.fi];
      var was = { start: f.start, length: f.length };
      f.start = +(d.start || f.start); f.length = +(d.length || f.length);
      rt.fields.sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      return {
        cfg: cfg, body: body,
        summary: '“' + f.name + '” moved from ' + was.start + '–' + (was.start + was.length - 1) + ' to ' + f.start + '–' + (f.start + f.length - 1) + '.',
        rows: [
          ['Record set', esc(rtLabel(rt))],
          ['Field', '<strong>' + esc(f.name) + '</strong>'],
          ['Was', '<span class="num">' + was.start + '</span> – <span class="num">' + (was.start + was.length - 1) + '</span> · length <span class="num">' + was.length + '</span>'],
          ['Becomes', '<span class="num">' + f.start + '</span> – <span class="num">' + (f.start + f.length - 1) + '</span> · length <span class="num">' + f.length + '</span>']
        ]
      };
    }
  };

  /* ---- 3 · Change how data maps into a file ------------------------------ */
  FLOWS['map-data'] = {
    title: 'Change how data maps into a file', fam: 'network-file',
    blurb: 'Point a field at a different source value.',
    steps: [
      {
        key: 'config', label: 'Config',
        render: function (d) {
          return stepHead('Which file are you re-mapping?', '') +
            chooser('cff-c-config', cfgOptions(nfConfigs()), d.configId) +
            (d.configId ? recordSetPicker(d) : '');
        },
        valid: function (d) { return !!d.configId && d.rt != null; }
      },
      {
        key: 'field', label: 'File field',
        render: function (d) {
          return stepHead('Which field in the file?', '') +
            '<label class="ops-search cff-search">' + icon('search', 18) +
            '<input class="input" data-action="cff-i-q" value="' + esc(d.q || '') + '" placeholder="Search fields" aria-label="Search fields" /></label>' +
            fieldList(d, fieldsOf(d));
        },
        valid: function (d) { return d.fi != null && fieldsOf(d)[d.fi]; }
      },
      {
        key: 'source', label: 'Source',
        render: function (d) {
          var cfg = cfgById(d.configId);
          var cols = C.inputColumns(cfg.currentDraft ? cfg.currentDraft.body : cfg.body);
          var all = cols.concat(C.TXN_COLUMNS.filter(function (c) { return cols.indexOf(c) < 0; }));
          var q = (d.sq || '').toLowerCase();
          var hits = all.filter(function (c) { return !q || c.toLowerCase().indexOf(q) >= 0; });
          return stepHead('Where does its value come from?', '') +
            '<label class="ops-search cff-search">' + icon('search', 18) +
            '<input class="input" data-action="cff-i-sq" value="' + esc(d.sq || '') + '" placeholder="Search source columns" aria-label="Search source columns" /></label>' +
            chooser('cff-c-source', hits.slice(0, 40).map(function (c) {
              return { value: c, label: c, sub: cols.indexOf(c) >= 0 ? 'already extracted for this file' : 'transaction column' };
            }), d.source, { dense: true });
        },
        valid: function (d) { return !!d.source; }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = cfgById(d.configId), body = bodyOf(cfg);
      var rt = body.record_types[d.rt];
      var f = rt.fields[d.fi];
      var was = f.source || '(unmapped)';
      f.source = d.source;
      return {
        cfg: cfg, body: body,
        summary: '“' + f.name + '” now maps from ' + d.source + ' (was ' + was + ').',
        rows: [
          ['Record set', esc(rtLabel(rt))],
          ['File field', '<strong>' + esc(f.name) + '</strong>'],
          ['Was', '<span class="mono">' + esc(was) + '</span>'],
          ['Becomes', '<span class="mono">' + esc(d.source) + '</span>']
        ]
      };
    }
  };

  /* ---- 4 · Add a new record type (TCR) ----------------------------------- */
  FLOWS['add-tcr'] = {
    title: 'Add a new record type (TCR)', fam: 'network-file',
    blurb: 'Declare a record type the file does not carry yet.',
    steps: [
      {
        key: 'where', label: 'Config',
        render: function (d) {
          return stepHead('Which network file gains the record type?',
            'A TCR belongs to one network and one tenant — the file it will appear in.') +
            chooser('cff-c-config', cfgOptions(nfConfigs()), d.configId);
        },
        valid: function (d) { return !!d.configId; }
      },
      {
        key: 'identity', label: 'Identity',
        render: function (d) {
          return stepHead('What is the record type?', '') +
            '<div class="cff-form">' +
            field('Record type code', '<input class="input mono" data-action="cff-i-code" value="' + esc(d.code || '') + '" placeholder="e.g. 0700" />', true) +
            field('Name', '<input class="input" data-action="cff-i-name" value="' + esc(d.name || '') + '" placeholder="e.g. Fee collection detail" />', true) +
            field('Record length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || '') + '" placeholder="characters" />', true) +
            '</div>';
        },
        valid: function (d) { return !!(d.code || '').trim() && !!(d.name || '').trim() && d.length > 0; }
      },
      {
        key: 'fields', label: 'Fields',
        render: function (d) {
          var fields = d.fields || [];
          return stepHead('Which fields does it carry?',
            'Fields are added in position order; the ruler shows what is still undeclared.') +
            ruler(+d.length, fields, { rt: 0 }) +
            newFieldTable(fields) +
            '<div class="cff-addrow">' +
            '<input class="input" data-action="cff-i-nfname" value="' + esc(d.nfname || '') + '" placeholder="Field name" aria-label="Field name" />' +
            '<input class="input num" type="number" min="1" data-action="cff-i-nfstart" value="' + (d.nfstart || nextStart(fields)) + '" aria-label="Starts at" />' +
            '<input class="input num" type="number" min="1" data-action="cff-i-nflen" value="' + (d.nflen || '') + '" placeholder="Length" aria-label="Length" />' +
            typeSelect(d.nftype, 'cff-c-nftype') +
            '<button class="btn btn-secondary" data-action="cff-add-field"' + ((d.nfname || '').trim() && d.nflen > 0 ? '' : ' disabled') + '>' +
            icon('plus', 16) + 'Add</button>' +
            '</div>';
        },
        valid: function (d) { return (d.fields || []).length > 0; }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = cfgById(d.configId), body = bodyOf(cfg);
      var rt = { record_type: d.code.trim(), label: d.name.trim(), fields: (d.fields || []).slice() };
      body.record_types = body.record_types.concat([rt]);
      return {
        cfg: cfg, body: body,
        summary: 'Added record type ' + d.code.trim() + ' (' + d.name.trim() + ') with ' + rt.fields.length + ' field' + (rt.fields.length === 1 ? '' : 's') + '.',
        rows: [
          ['Record type code', '<span class="mono">' + esc(d.code) + '</span>'],
          ['Name', '<strong>' + esc(d.name) + '</strong>'],
          ['Record length', '<span class="num">' + d.length + '</span>'],
          ['Fields', '<span class="num">' + rt.fields.length + '</span> declared · ' +
            '<span class="num">' + declaredChars(rt.fields) + '</span> of <span class="num">' + d.length + '</span> characters accounted for']
        ]
      };
    }
  };

  /* ---- 5 · View a file's layout (read-only) ------------------------------ */
  FLOWS['view-layout'] = {
    title: "View a file's layout", fam: 'network-file', readOnly: true,
    blurb: 'See every field in position order.',
    choose: function (d) { return chooser('cff-c-config', cfgOptions(nfConfigs()), d.configId); },
    view: function (d) {
      var cfg = cfgById(d.configId);
      var rts = bodyRecordTypes(cfg);
      var rl = recordLengthOf(d);
      return recordSetPicker(d) +
        rts.filter(function (rt, i) { return i === (d.rt == null ? 0 : d.rt); }).map(function (rt) {
          return ruler(rl, rt.fields || [], { rt: 0, title: esc(rtLabel(rt)) }) + fieldTable(rt.fields || []);
        }).join('');
    }
  };

  /* ---- 6 · Fix a field that isn't being read ----------------------------- */
  FLOWS['fix-parse'] = {
    title: "Fix a field that isn't being read", fam: 'incoming-parsing',
    blurb: 'Add a field the files carry but the config does not recognise.',
    steps: [
      {
        key: 'issue', label: 'Issue',
        render: function (d) {
          var opts = [];
          ipParserConfigs().forEach(function (c) {
            C.parsingIssues(c).forEach(function (iss, i) {
              opts.push({
                value: c.configId + '::' + i,
                label: iss.name || ('Unrecognised field at ' + iss.start),
                sub: c.name + ' · characters ' + iss.start + '–' + (iss.start + iss.length - 1) + ' · seen ' + (iss.seen || 'in recent files')
              });
            });
          });
          return stepHead('Which field is not being read?',
            'These are the spans recent files carried that the parsing config has no definition for.') +
            (opts.length
              ? chooser('cff-c-issue', opts, d.issue)
              : '<div class="cff-empty">' + emptyState('shield-check', 'No unrecognised fields',
                'Every field in recent files matched a definition in the parsing config.') + '</div>');
        },
        valid: function (d) { return !!d.issue; }
      },
      {
        key: 'position', label: 'Position',
        render: function (d) {
          var iss = issueOf(d);
          return stepHead('Confirm the position and length',
            'Both are pre-filled from what the files actually contained.') +
            '<div class="cff-pos">' +
            field('Starts at character', '<input class="input num" type="number" min="1" data-action="cff-i-start" value="' + (d.start || iss.start) + '" />', true) +
            field('Length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || iss.length) + '" />', true) +
            '</div>' +
            (iss.sample ? '<div class="cff-sample"><span class="cff-sample-label">Sample value from a recent file</span>' +
              '<span class="mono">' + esc(iss.sample) + '</span></div>' : '');
        },
        valid: function (d) { var i = issueOf(d); return (d.start || i.start) > 0 && (d.length || i.length) > 0; }
      },
      {
        key: 'details', label: 'Details',
        render: function (d) {
          var iss = issueOf(d);
          return stepHead('What should it be called?', '') +
            '<div class="cff-form">' +
            field('Field name', '<input class="input" data-action="cff-i-name" value="' + esc(d.name == null ? (iss.name || '') : d.name) + '" />', true) +
            field('Content type', typeSelect(d.type)) +
            field('Notes', '<textarea class="input" data-action="cff-i-note">' + esc(d.note || '') + '</textarea>') +
            '</div>';
        },
        valid: function (d) { var iss = issueOf(d); return !!((d.name == null ? iss.name : d.name) || '').trim(); }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var iss = issueOf(d), cfg = cfgById(d.issue.split('::')[0]);
      var body = bodyOf(cfg);
      var name = ((d.name == null ? iss.name : d.name) || '').trim();
      var start = +(d.start || iss.start), length = +(d.length || iss.length);
      var target = (body.record_types && body.record_types[0]) || (body.layout = body.layout || { fields: [] });
      var list = target.fields = target.fields || [];
      list.push({ name: name, start: start, length: length, type: d.type || 'AN', note: d.note || '' });
      list.sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      return {
        cfg: cfg, body: body,
        summary: 'Defined “' + name + '” at characters ' + start + '–' + (start + length - 1) + ' so the parser stops skipping it.',
        rows: [
          ['Field name', '<strong>' + esc(name) + '</strong>'],
          ['Position', '<span class="num">' + start + '</span> – <span class="num">' + (start + length - 1) + '</span>'],
          ['Content type', esc(typeName(d.type))],
          iss.sample ? ['Sample value', '<span class="mono">' + esc(iss.sample) + '</span>'] : null
        ]
      };
    }
  };

  /* ---- 7 · Add a new file type we receive -------------------------------- */
  FLOWS['new-incoming'] = {
    title: 'Add a new file type we receive', fam: 'incoming-parsing',
    blurb: 'Set up parsing for a file the platform does not read yet.',
    steps: [
      {
        key: 'source', label: 'Source',
        render: function (d) {
          return stepHead('Where does the file come from?', '') +
            '<div class="cff-form">' +
            field('Source', selectOf('cff-c-src', C.SOURCES, d.src), true) +
            field('Tenant', selectOf('cff-c-tenant', C.TENANTS.map(function (t) { return t.key; }), d.tenant, function (k) { return tenantName(k); }), true) +
            '</div>';
        },
        valid: function (d) { return !!d.src && !!d.tenant; }
      },
      {
        key: 'names', label: 'Filenames',
        render: function (d) {
          return stepHead('What are the files called?',
            'One pattern per line. Anything matching is picked up for this config.') +
            '<div class="cff-form">' +
            field('Expected filename patterns',
              '<textarea class="input mono cff-patterns" data-action="cff-i-patterns" placeholder="VSS_TC46_*.xml&#10;VSS_TC46_*_R?.xml">' + esc(d.patterns || '') + '</textarea>', true) +
            '</div>' +
            patternPreview(d);
        },
        valid: function (d) { return (d.patterns || '').trim().split('\n').filter(nonBlank).length > 0; }
      },
      {
        key: 'layout', label: 'Layout',
        render: function (d) {
          var fields = d.fields || [];
          return stepHead('What does a record look like?', '') +
            '<div class="cff-form cff-form-row">' +
            field('Record length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || '') + '" />', true) +
            '</div>' +
            (d.length > 0 ? ruler(+d.length, fields, { rt: 0 }) : '') +
            newFieldTable(fields) +
            '<div class="cff-addrow">' +
            '<input class="input" data-action="cff-i-nfname" value="' + esc(d.nfname || '') + '" placeholder="Field name" aria-label="Field name" />' +
            '<input class="input num" type="number" min="1" data-action="cff-i-nfstart" value="' + (d.nfstart || nextStart(fields)) + '" aria-label="Starts at" />' +
            '<input class="input num" type="number" min="1" data-action="cff-i-nflen" value="' + (d.nflen || '') + '" placeholder="Length" aria-label="Length" />' +
            typeSelect(d.nftype, 'cff-c-nftype') +
            '<button class="btn btn-secondary" data-action="cff-add-field"' + ((d.nfname || '').trim() && d.nflen > 0 ? '' : ' disabled') + '>' +
            icon('plus', 16) + 'Add</button>' +
            '</div>';
        },
        valid: function (d) { return d.length > 0 && (d.fields || []).length > 0; }
      },
      {
        key: 'sections', label: 'Sections',
        render: function (d) {
          return stepHead('How are records told apart?',
            'The parser reads this span of every line to decide which record type it is.') +
            '<div class="cff-form cff-form-row">' +
            field('Record type starts at', '<input class="input num" type="number" min="1" data-action="cff-i-secstart" value="' + (d.secStart || 1) + '" />', true) +
            field('Record type length', '<input class="input num" type="number" min="1" data-action="cff-i-seclen" value="' + (d.secLen || 2) + '" />', true) +
            '</div>' +
            '<div class="cff-form">' +
            field('Header record value', '<input class="input mono" data-action="cff-i-sechdr" value="' + esc(d.secHdr || '') + '" placeholder="e.g. 90" />') +
            field('Detail record value', '<input class="input mono" data-action="cff-i-secdet" value="' + esc(d.secDet || '') + '" placeholder="e.g. 05" />', true) +
            field('Trailer record value', '<input class="input mono" data-action="cff-i-sectrl" value="' + esc(d.secTrl || '') + '" placeholder="e.g. 92" />') +
            '</div>';
        },
        valid: function (d) { return (d.secStart || 1) > 0 && (d.secLen || 2) > 0 && !!(d.secDet || '').trim(); }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var pats = (d.patterns || '').split('\n').map(trim).filter(nonBlank);
      var body = {
        source: d.src, file_patterns: pats,
        record_identifier: { start: +(d.secStart || 1), length: +(d.secLen || 2) },
        record_types: [{
          record_type: (d.secDet || '').trim(), label: 'Detail', fields: (d.fields || []).slice()
        }],
        record_length: +d.length
      };
      if ((d.secHdr || '').trim()) body.record_types.unshift({ record_type: d.secHdr.trim(), label: 'Header', fields: [] });
      if ((d.secTrl || '').trim()) body.record_types.push({ record_type: d.secTrl.trim(), label: 'Trailer', fields: [] });
      // A brand new config, created in memory, in DRAFT until it is approved.
      var cfg = {
        configId: C.nextId('incoming-parsing'), configType: 'INCOMING', family: 'incoming-parsing',
        name: d.src + ' · ' + d.tenant + ' · parser', source: d.src, subType: 'parser',
        tenantId: d.tenant, state: 'DRAFT', body: body,
        createdBy: C.DEMO_USER, createdAt: nowStamp(), updatedAt: nowStamp(),
        versions: [], currentDraft: null, comments: [], isNew: true
      };
      return {
        cfg: cfg, body: body, isNew: true,
        summary: 'New incoming file type ' + d.src + ' for ' + tenantName(d.tenant) + ' — ' + pats.length + ' filename pattern' + (pats.length === 1 ? '' : 's') + ', ' + (d.fields || []).length + ' fields.',
        rows: [
          ['Source', '<span class="mono">' + esc(d.src) + '</span>'],
          ['Tenant', esc(tenantName(d.tenant))],
          ['Filename patterns', pats.map(function (p) { return '<span class="mono">' + esc(p) + '</span>'; }).join('<br>')],
          ['Record length', '<span class="num">' + d.length + '</span>'],
          ['Fields', '<span class="num">' + (d.fields || []).length + '</span>'],
          ['Record type read at', 'characters <span class="num">' + (d.secStart || 1) + '</span> – <span class="num">' + ((+(d.secStart || 1)) + (+(d.secLen || 2)) - 1) + '</span>']
        ]
      };
    }
  };

  /* ---- 8 · Change how a field is interpreted ----------------------------- */
  FLOWS['interpret'] = {
    title: 'Change how a field is interpreted', fam: 'incoming-parsing',
    blurb: 'Adjust a field’s content type or length.',
    steps: [
      {
        key: 'config', label: 'Config',
        render: function (d) {
          return stepHead('Which parsing config?', '') +
            chooser('cff-c-config', cfgOptions(ipParserConfigs()), d.configId) +
            (d.configId ? recordSetPicker(d) : '');
        },
        valid: function (d) { return !!d.configId && d.rt != null; }
      },
      {
        key: 'field', label: 'Field',
        render: function (d) {
          return stepHead('Which field?', '') +
            '<label class="ops-search cff-search">' + icon('search', 18) +
            '<input class="input" data-action="cff-i-q" value="' + esc(d.q || '') + '" placeholder="Search fields" aria-label="Search fields" /></label>' +
            fieldList(d, fieldsOf(d));
        },
        valid: function (d) { return d.fi != null && fieldsOf(d)[d.fi]; }
      },
      {
        key: 'how', label: 'Interpretation',
        render: function (d) {
          var f = fieldsOf(d)[d.fi];
          return stepHead('How should it be read?', '') +
            '<div class="cff-was">Currently ' + esc(typeName(f.type)) + ', length <span class="num">' + (f.length || '—') + '</span>.</div>' +
            '<div class="cff-form">' +
            field('Content type', typeSelect(d.type == null ? f.type : d.type), true) +
            field('Length', '<input class="input num" type="number" min="1" data-action="cff-i-len" value="' + (d.length || f.length || '') + '" />', true) +
            '</div>';
        },
        valid: function (d) {
          var f = fieldsOf(d)[d.fi]; if (!f) return false;
          var ty = d.type == null ? f.type : d.type, len = +(d.length || f.length);
          return len > 0 && (ty !== f.type || len !== f.length);
        }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = cfgById(d.configId), body = bodyOf(cfg);
      var rt = body.record_types[d.rt];
      var f = rt.fields[d.fi];
      var was = { type: f.type, length: f.length };
      f.type = d.type == null ? f.type : d.type;
      f.length = +(d.length || f.length);
      return {
        cfg: cfg, body: body,
        summary: '“' + f.name + '” now read as ' + typeName(f.type) + ', length ' + f.length + '.',
        rows: [
          ['Field', '<strong>' + esc(f.name) + '</strong>'],
          ['Was', esc(typeName(was.type)) + ' · length <span class="num">' + (was.length || '—') + '</span>'],
          ['Becomes', esc(typeName(f.type)) + ' · length <span class="num">' + f.length + '</span>']
        ]
      };
    }
  };

  /* ---- 9 · View how a file is read (read-only) --------------------------- */
  FLOWS['view-read'] = {
    title: 'View how a file is read', fam: 'incoming-parsing', readOnly: true,
    blurb: 'See the layout the parser expects.',
    choose: function (d) { return chooser('cff-c-config', cfgOptions(ipConfigs()), d.configId); },
    view: function (d) {
      var cfg = cfgById(d.configId);
      var rts = bodyRecordTypes(cfg);
      if (!rts.length) {
        var b = cfg.currentDraft ? cfg.currentDraft.body : cfg.body;
        return '<pre class="cff-raw mono">' + esc(X.serialize(b, 'json')) + '</pre>';
      }
      return recordSetPicker(d) +
        rts.filter(function (rt, i) { return i === (d.rt == null ? 0 : d.rt); }).map(function (rt) {
          return ruler(recordLengthOf(d), rt.fields || [], { rt: 0, title: esc(rtLabel(rt)) }) + fieldTable(rt.fields || []);
        }).join('');
    }
  };

  /* ---- 10 · Change what's in a report ------------------------------------ */
  FLOWS['report-content'] = {
    title: "Change what's in a report", fam: 'settlement',
    blurb: 'Add, remove or reorder the columns.',
    steps: [
      {
        key: 'report', label: 'Report',
        render: function (d) {
          var items = C.settlementItems().filter(function (it) { return it.content; });
          return stepHead('Which report?', '') +
            chooser('cff-c-item', items.map(function (it) {
              return { value: it.key, label: it.name, sub: (it.content.body['select'] || []).length + ' columns' };
            }), d.item);
        },
        valid: function (d) { return !!d.item && !!itemOf(d) && !!itemOf(d).content; }
      },
      {
        key: 'columns', label: 'Columns',
        render: function (d) {
          var cols = colsOf(d);
          return stepHead('Which columns, in which order?', '') +
            columnEditor(d, cols);
        },
        valid: function (d) { return colsOf(d).length > 0; }
      },
      {
        key: 'preview', label: 'Preview',
        render: function (d) {
          return stepHead('What the output looks like', '') + samplePreview(colsOf(d));
        },
        valid: function () { return true; }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var it = itemOf(d), cfg = it.content, body = bodyOf(cfg);
      var before = (body['select'] || []).map(colName);
      body['select'] = colsOf(d).slice();
      var after = body['select'].map(colName);
      var added = after.filter(function (c) { return before.indexOf(c) < 0; });
      var removed = before.filter(function (c) { return after.indexOf(c) < 0; });
      return {
        cfg: cfg, body: body,
        summary: it.report + ' columns: ' + after.length + ' total' +
          (added.length ? ', added ' + added.join(', ') : '') +
          (removed.length ? ', removed ' + removed.join(', ') : '') + '.',
        rows: [
          ['Report', '<strong>' + esc(it.name) + '</strong>'],
          ['Columns', '<span class="num">' + before.length + '</span> → <span class="num">' + after.length + '</span>'],
          added.length ? ['Added', added.map(function (c) { return '<span class="mono">' + esc(c) + '</span>'; }).join(' ')] : null,
          removed.length ? ['Removed', removed.map(function (c) { return '<span class="mono">' + esc(c) + '</span>'; }).join(' ')] : null,
          ['Order', after.map(function (c) { return '<span class="mono">' + esc(c) + '</span>'; }).join(' → ')]
        ]
      };
    }
  };

  /* ---- 11 · Change when a report runs ------------------------------------ */
  FLOWS['report-when'] = {
    title: 'Change when a report runs', fam: 'settlement',
    blurb: 'Adjust the window it covers and the time it is generated.',
    steps: [
      {
        key: 'report', label: 'Report',
        render: function (d) {
          var items = C.settlementItems().filter(function (it) { return it.schedules.length; });
          return stepHead('Which report’s schedule?', '') +
            chooser('cff-c-item', items.map(function (it) {
              return { value: it.key, label: it.name, sub: it.schedules.length + ' schedule' + (it.schedules.length === 1 ? '' : 's') };
            }), d.item) +
            (d.item && itemOf(d) && itemOf(d).schedules.length > 1 ? variantPicker(d) : '');
        },
        valid: function (d) { return !!schedOf(d); }
      },
      {
        key: 'window', label: 'Window',
        render: function (d) {
          var blk = blockOf(d);
          return stepHead('What window does it cover, and when does it run?',
            'Offsets are relative to the report date: T-1 is the day before.') +
            '<div class="cff-form cff-form-row">' +
            field('Covers from', offsetSelect('cff-c-from', d.from == null ? blk.transaction_date.from.offset : d.from), true) +
            field('at', '<input class="input mono" data-action="cff-i-fromtime" value="' + esc(d.fromTime == null ? blk.transaction_date.from.time : d.fromTime) + '" />', true) +
            '</div>' +
            '<div class="cff-form cff-form-row">' +
            field('Covers to', offsetSelect('cff-c-to', d.to == null ? blk.transaction_date.to.offset : d.to), true) +
            field('at', '<input class="input mono" data-action="cff-i-totime" value="' + esc(d.toTime == null ? blk.transaction_date.to.time : d.toTime) + '" />', true) +
            '</div>' +
            '<div class="cff-form cff-form-row">' +
            field('Report generated on', offsetSelect('cff-c-rep', d.rep == null ? blk.report_offset : d.rep), true) +
            '</div>' +
            '<div class="cff-checks">' +
            checkbox('cff-c-sun', 'Skip Sundays', d.sun == null ? blk.sundays_off : d.sun) +
            checkbox('cff-c-sat', 'Skip Saturdays', d.sat == null ? blk.saturdays_off : d.sat) +
            checkbox('cff-c-hol', 'Skip general holidays', d.hol == null ? blk.apply_general_holiday : d.hol) +
            '</div>';
        },
        valid: function (d) {
          var b = draftBlock(d);
          return X.validTime(b.transaction_date.from.time) && X.validTime(b.transaction_date.to.time) &&
            X.parseOffset(b.transaction_date.from.offset) !== null &&
            X.parseOffset(b.transaction_date.to.offset) !== null &&
            X.parseOffset(b.report_offset) !== null;
        }
      },
      {
        key: 'preview', label: 'Preview',
        render: function (d) {
          var cfg = schedOf(d);
          var runs = X.nextRuns(draftBlock(d), cfg.body.timezone, D.TODAY, 5);
          return stepHead('The next five runs', '') + runsTable(runs);
        },
        valid: function () { return true; }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var cfg = schedOf(d), body = bodyOf(cfg);
      var was = body['default'];
      var blk = draftBlock(d);
      body['default'] = blk;
      return {
        cfg: cfg, body: body,
        summary: 'Window ' + blk.transaction_date.from.offset + ' ' + blk.transaction_date.from.time +
          ' → ' + blk.transaction_date.to.offset + ' ' + blk.transaction_date.to.time +
          ', report on ' + blk.report_offset + '.',
        rows: [
          ['Report', '<strong>' + esc(cfg.name) + '</strong>'],
          ['Was', '<span class="mono">' + esc(was.transaction_date.from.offset + ' ' + was.transaction_date.from.time + ' → ' + was.transaction_date.to.offset + ' ' + was.transaction_date.to.time) + '</span> · report ' + esc(was.report_offset)],
          ['Becomes', '<span class="mono">' + esc(blk.transaction_date.from.offset + ' ' + blk.transaction_date.from.time + ' → ' + blk.transaction_date.to.offset + ' ' + blk.transaction_date.to.time) + '</span> · report ' + esc(blk.report_offset)],
          ['Skips', [blk.sundays_off ? 'Sundays' : null, blk.saturdays_off ? 'Saturdays' : null, blk.apply_general_holiday ? 'general holidays' : null].filter(Boolean).join(', ') || 'nothing']
        ]
      };
    }
  };

  /* ---- 12 · Change fee rules --------------------------------------------- */
  FLOWS['fee-rules'] = {
    title: 'Change fee rules', fam: 'settlement',
    blurb: 'Adjust what is charged, and when each rule applies.',
    steps: [
      {
        key: 'tenant', label: 'Tenant',
        render: function (d) {
          var tenants = {};
          C.byFamily('settlement').forEach(function (c) { if (c.subType === 'fees') tenants[c.tenantId] = 1; });
          return stepHead('Whose fee rules?', '') +
            chooser('cff-c-fee-tenant', Object.keys(tenants).map(function (k) {
              var n = C.byFamily('settlement').filter(function (c) { return c.subType === 'fees' && c.tenantId === k; }).length;
              return { value: k, label: tenantName(k), sub: n + ' rule set' + (n === 1 ? '' : 's') };
            }), d.tenant);
        },
        valid: function (d) { return !!d.tenant; }
      },
      {
        key: 'rule', label: 'Rule',
        render: function (d) {
          var sets = feeSets(d);
          var opts = [];
          sets.forEach(function (c) {
            (c.body.txn_rules || []).forEach(function (r, i) {
              opts.push({ value: c.configId + '::' + i, label: ruleLabel(r), sub: c.name + ' · priority ' + (r.priority == null ? '—' : r.priority) });
            });
          });
          return stepHead('Which rule?', '') +
            chooser('cff-c-rule', opts.concat(sets.length ? [{ value: sets[0].configId + '::new', label: 'Add a new rule', sub: 'to ' + sets[0].name }] : []), d.rule);
        },
        valid: function (d) { return !!d.rule; }
      },
      {
        key: 'conditions', label: 'Conditions',
        render: function (d) {
          var conds = condsOf(d);
          return stepHead('When does this rule apply?',
            'Every condition has to hold for the charge to be used.') +
            condEditor(conds) +
            '<div class="cff-addrow">' +
            selectOf('cff-c-cfield', C.TXN_COLUMNS.slice(0, 24), d.cfield) +
            selectOf('cff-c-ccond', C.CONDITIONS, d.ccond) +
            '<input class="input" data-action="cff-i-cvalue" value="' + esc(d.cvalue || '') + '" placeholder="Value" aria-label="Value" />' +
            '<button class="btn btn-secondary" data-action="cff-add-cond"' + ((d.cvalue || '').trim() ? '' : ' disabled') + '>' +
            icon('plus', 16) + 'Add</button></div>';
        },
        valid: function (d) { return condsOf(d).length > 0; }
      },
      {
        key: 'charges', label: 'Charges',
        render: function (d) {
          var r = ruleOf(d);
          var calc = d.calc || (r && r.calculations) || {};
          return stepHead('What is charged?', '') +
            '<div class="cff-form cff-form-row">' +
            field('Charge type', selectOf('cff-c-feetype', ['PERCENTAGE', 'FIXED'], d.feeType || calc.fee_type || 'PERCENTAGE'), true) +
            field((d.feeType || calc.fee_type) === 'FIXED' ? 'Amount' : 'Percentage',
              '<input class="input num" type="number" step="0.01" min="0" data-action="cff-i-rate" value="' + (d.rate == null ? firstRate(calc) : d.rate) + '" />', true) +
            '</div>' +
            '<div class="cff-form cff-form-row">' +
            field('Deducted from', selectOf('cff-c-mode', ['DEDUCT_FROM_SETTLEMENT', 'BILL_SEPARATELY'], d.mode || (r && r.fee_mode) || 'DEDUCT_FROM_SETTLEMENT'), true) +
            '</div>';
        },
        valid: function (d) { var v = d.rate == null ? firstRate((d.calc || (ruleOf(d) || {}).calculations || {})) : d.rate; return v !== '' && +v >= 0; }
      },
      {
        key: 'calc', label: 'Preview',
        render: function (d) {
          return stepHead('Test it against an amount', '') + feeCalculator(d);
        },
        valid: function () { return true; }
      },
      { key: 'review', label: 'Review', review: true }
    ],
    build: function (d) {
      var parts = d.rule.split('::');
      var cfg = cfgById(parts[0]), body = bodyOf(cfg);
      body.txn_rules = body.txn_rules || [];
      var isNew = parts[1] === 'new';
      var rate = +(d.rate == null ? firstRate((ruleOf(d) || {}).calculations || {}) : d.rate);
      var feeType = d.feeType || ((ruleOf(d) || {}).calculations || {}).fee_type || 'PERCENTAGE';
      var rule = isNew ? { model: 'MDR', priority: (body.txn_rules.length + 1) * 10, starting_date: D.TODAY } : body.txn_rules[+parts[1]];
      rule.fee_mode = d.mode || rule.fee_mode || 'DEDUCT_FROM_SETTLEMENT';
      rule.conditions = condsOf(d).slice();
      rule.calculations = { slab_based: false, fee_type: feeType, logic: [feeType === 'FIXED' ? { field: 'txn_amount', amount: rate } : { field: 'txn_amount', percentage: rate }] };
      if (isNew) body.txn_rules.push(rule);
      return {
        cfg: cfg, body: body,
        summary: (isNew ? 'Added' : 'Changed') + ' fee rule — ' + ruleLabel(rule) + ' · ' + (feeType === 'FIXED' ? rate : rate + '%') + '.',
        rows: [
          ['Rule set', '<strong>' + esc(cfg.name) + '</strong>'],
          ['Rule', isNew ? 'New rule' : ruleLabel(rule)],
          ['Applies when', rule.conditions.map(function (c) { return '<span class="mono">' + esc(c.field + ' ' + c.condition + ' ' + c.value) + '</span>'; }).join('<br>')],
          ['Charge', feeType === 'FIXED' ? '<span class="num">' + rate + '</span> fixed' : '<span class="num">' + rate + '</span>%'],
          ['Deducted from', esc((rule.fee_mode || '').toLowerCase().replace(/_/g, ' '))]
        ]
      };
    }
  };

  /* ---- 13 · View a report's contents (read-only) -------------------------- */
  FLOWS['view-report'] = {
    title: "View a report's contents", fam: 'settlement', readOnly: true,
    blurb: 'See the columns and a sample of the output.',
    choose: function (d) {
      var items = C.settlementItems().filter(function (it) { return it.content; });
      return chooser('cff-c-item', items.map(function (it) {
        return { value: it.key, label: it.name, sub: (it.content.body['select'] || []).length + ' columns' };
      }), d.item);
    },
    chooseKey: 'item',
    view: function (d) {
      var it = itemOf(d);
      var cols = (it.content.body['select'] || []);
      return '<div class="cff-view-cols">' + cols.map(function (c) {
        return '<span class="cff-col-chip mono">' + esc(colName(c)) + (c.alias ? ' → ' + esc(c.alias) : '') + '</span>';
      }).join('') + '</div>' + samplePreview(cols);
    }
  };

  /* =========================================================================
     SHARED STEP FRAGMENTS
     ========================================================================= */
  function stepHead(title, sub) {
    return '<div class="cff-step-head"><h2 class="cff-step-title">' + esc(title) + '</h2>' +
      (sub ? '<p class="cff-step-sub">' + esc(sub) + '</p>' : '') + '</div>';
  }
  function rtLabel(rt) { return (rt.label || rt.record_type || 'Record') + (rt.record_type && rt.label ? ' · ' + rt.record_type : ''); }
  function recordSetPicker(d) {
    var cfg = cfgById(d.configId); if (!cfg) return '';
    var rts = bodyRecordTypes(cfg);
    if (rts.length <= 1) return '';
    return '<div class="cff-sub-pick"><div class="cff-sub-label">Record set</div>' +
      chooser('cff-c-rt', rts.map(function (rt, i) {
        return { value: String(i), label: rtLabel(rt), sub: (rt.fields || []).length + ' fields' };
      }), d.rt == null ? '' : String(d.rt), { dense: true }) + '</div>';
  }
  function typeSelect(v, action) {
    return '<span class="ops-select"><select data-action="' + (action || 'cff-c-type') + '" aria-label="Content type">' +
      [['AN', 'Letters and numbers'], ['N', 'Numbers only']].map(function (o) {
        return '<option value="' + o[0] + '"' + ((v || 'AN') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' + icon('chevron-down', 16) + '</span>';
  }
  function typeName(t) { return t === 'N' ? 'Numbers only' : 'Letters and numbers'; }
  function selectOf(action, values, selected, labeller) {
    return '<span class="ops-select"><select data-action="' + action + '" aria-label="' + esc(action) + '">' +
      values.map(function (v) {
        return '<option value="' + esc(v) + '"' + (String(selected) === String(v) ? ' selected' : '') + '>' +
          esc(labeller ? labeller(v) : v) + '</option>';
      }).join('') + '</select>' + icon('chevron-down', 16) + '</span>';
  }
  function offsetSelect(action, v) {
    var opts = ['T-5', 'T-4', 'T-3', 'T-2', 'T-1', 'T+0', 'T+1', 'T+2'];
    if (opts.indexOf(v) < 0) opts.unshift(v);
    return selectOf(action, opts, v);
  }
  function checkbox(action, label, on) {
    return '<label class="cff-check"><input type="checkbox" data-action="' + action + '"' + (on ? ' checked' : '') + ' /><span>' + esc(label) + '</span></label>';
  }
  /* A live overlap warning. This is why the position step shows the ruler and
     not two bare number inputs: an overlap is a data-corrupting change that is
     invisible in a form and obvious on a ruler. */
  function overlapWarning(d, fields) {
    if (!(d.start > 0 && d.length > 0)) return '';
    var s = +d.start, e = s + (+d.length) - 1;
    var hit = (fields || []).filter(function (f) {
      if (!f.start || !f.length) return false;
      return s <= (f.start + f.length - 1) && e >= f.start;
    });
    if (!hit.length) {
      return '<div class="cff-ok">' + icon('check-circle', 16) +
        'Characters <span class="num">' + s + '</span>–<span class="num">' + e + '</span> are undeclared.</div>';
    }
    return '<div class="callout danger cff-overlap">' + icon('alert-triangle', 20) +
      '<div class="callout-body"><strong>This overlaps ' + hit.length + ' existing field' + (hit.length === 1 ? '' : 's') + '.</strong>' +
      '<div class="meta">' + hit.map(function (f) {
        return esc(f.name) + ' · ' + f.start + '–' + (f.start + f.length - 1);
      }).join(' · ') + '</div></div></div>';
  }
  function fieldList(d, fields) {
    var q = (d.q || '').toLowerCase();
    var rows = fields.map(function (f, i) { return { f: f, i: i }; })
      .filter(function (x) { return !q || String(x.f.name).toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) return '<div class="cff-empty meta">No field matches “' + esc(d.q || '') + '”.</div>';
    return '<div class="cff-fieldlist">' + rows.map(function (x) {
      var on = d.fi === x.i;
      return '<button type="button" class="cff-fieldrow' + (on ? ' active' : '') + '" data-action="cff-c-field" data-value="' + x.i + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
        '<span class="cff-fr-name">' + esc(x.f.name) + '</span>' +
        '<span class="cff-fr-pos num">' + (x.f.start ? x.f.start + '–' + (x.f.start + x.f.length - 1) : '—') + '</span>' +
        '<span class="cff-fr-type">' + esc(x.f.type || '—') + '</span>' +
        (on ? '<span class="cff-choice-tick">' + icon('check', 15) + '</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  }
  function fieldTable(fields) {
    if (!fields.length) return '<div class="meta">This record declares no fields.</div>';
    return '<div class="table-wrap"><table class="data cff-table"><thead><tr>' +
      '<th>Field</th><th class="num">Starts</th><th class="num">Length</th><th>Type</th><th>Notes</th></tr></thead><tbody>' +
      fields.map(function (f) {
        return '<tr><td>' + esc(f.name) + '</td><td class="num">' + (f.start == null ? '—' : f.start) + '</td>' +
          '<td class="num">' + (f.length == null ? '—' : f.length) + '</td><td>' + esc(f.type || '—') + '</td>' +
          '<td class="cell-sub">' + esc(f.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function newFieldTable(fields) {
    if (!fields.length) return '<div class="meta cff-nofields">No fields declared yet.</div>';
    return '<div class="table-wrap"><table class="data cff-table"><thead><tr>' +
      '<th>Field</th><th class="num">Starts</th><th class="num">Length</th><th>Type</th><th></th></tr></thead><tbody>' +
      fields.map(function (f, i) {
        return '<tr><td>' + esc(f.name) + '</td><td class="num">' + f.start + '</td><td class="num">' + f.length + '</td>' +
          '<td>' + esc(typeName(f.type)) + '</td>' +
          '<td class="cff-rowdel"><button class="icon-btn xs" data-action="cff-del-field" data-value="' + i + '" aria-label="Remove ' + esc(f.name) + '">' + icon('x', 14) + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function nextStart(fields) {
    if (!fields.length) return 1;
    var max = 1;
    fields.forEach(function (f) { max = Math.max(max, (f.start || 0) + (f.length || 0)); });
    return max;
  }
  function declaredChars(fields) {
    return fields.reduce(function (s, f) { return s + (f.length || 0); }, 0);
  }
  function patternPreview(d) {
    var pats = (d.patterns || '').split('\n').map(trim).filter(nonBlank);
    if (!pats.length) return '';
    return '<div class="cff-patlist">' + pats.map(function (p) {
      return '<span class="cff-col-chip mono">' + esc(p) + '</span>';
    }).join('') + '</div>';
  }

  /* ---- settlement helpers ------------------------------------------------- */
  function itemOf(d) { return d.item ? C.settlementItemByKey(d.item) : null; }
  function colName(c) { return typeof c === 'string' ? c : (c.column || ''); }
  function colsOf(d) {
    if (d.cols) return d.cols;
    var it = itemOf(d);
    d.cols = it && it.content ? C.clone(it.content.body['select'] || []) : [];
    return d.cols;
  }
  function columnEditor(d, cols) {
    var chosen = {}; cols.forEach(function (c) { chosen[colName(c)] = 1; });
    var avail = C.TXN_COLUMNS.filter(function (c) { return !chosen[c]; });
    return '<div class="cff-cols">' +
      '<div class="cff-col-pane"><div class="cff-col-head">In the report · <span class="num">' + cols.length + '</span></div>' +
      cols.map(function (c, i) {
        return '<div class="cff-col-row"><span class="mono">' + esc(colName(c)) + '</span>' +
          '<span class="cff-col-btns">' +
          '<button class="icon-btn xs" data-action="cff-col-up" data-value="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">' + icon('chevron-up', 14) + '</button>' +
          '<button class="icon-btn xs" data-action="cff-col-down" data-value="' + i + '"' + (i === cols.length - 1 ? ' disabled' : '') + ' aria-label="Move down">' + icon('chevron-down', 14) + '</button>' +
          '<button class="icon-btn xs" data-action="cff-col-del" data-value="' + i + '" aria-label="Remove">' + icon('x', 14) + '</button>' +
          '</span></div>';
      }).join('') + '</div>' +
      '<div class="cff-col-pane"><div class="cff-col-head">Available</div>' +
      (avail.length ? avail.map(function (c) {
        return '<button type="button" class="cff-col-add" data-action="cff-col-add" data-value="' + esc(c) + '">' +
          icon('plus', 14) + '<span class="mono">' + esc(c) + '</span></button>';
      }).join('') : '<div class="meta">Every known column is already in the report.</div>') +
      '</div></div>';
  }
  /* Three illustrative rows with the column names this config produces — the
     point is to see the shape of the output, not real data. */
  function samplePreview(cols) {
    var names = cols.map(colName);
    var SAMPLE = {
      txn_id: 'TXN90417732', txn_uuid: 'a41f-8c02', order_id: 'ORD-55210', merchant_id: 'M0041',
      mid: '4021 8817 40219', terminal_id: 'T0091', txn_amount: '4250.00', settlement_amount: '4166.75',
      currency: 'INR', txn_date: '2025-11-20', settlement_date: '2025-11-21', auth_code: '049213',
      rrn: '533117904221', arn: '74998••••••4471', card_type: 'CREDIT', card_network: 'VISA',
      card_region: 'DOMESTIC', card_bin: '414709', card_last4: '4471', mcc: '5411', txn_type: 'SALE',
      txn_status: 'SUCCESS', interchange_fee: '61.62', scheme_fee: '4.25', mdr_amount: '83.25',
      gst_amount: '14.98', net_amount: '4166.75', batch_id: 'B-20251120-03',
      acquirer_ref_no: 'AQ88213', chargeback_flag: 'N'
    };
    var rows = [0, 1, 2].map(function (r) {
      return '<tr>' + names.map(function (n) {
        var v = SAMPLE[n] == null ? '—' : SAMPLE[n];
        if (r && /amount|fee|_at$/.test(n) && v !== '—') v = (parseFloat(v) * (r === 1 ? 0.62 : 1.41)).toFixed(2);
        return '<td class="mono">' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="table-wrap cff-sample-wrap"><table class="data cff-table"><thead><tr>' +
      names.map(function (n) { return '<th class="mono">' + esc(n) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function variantPicker(d) {
    var it = itemOf(d);
    return '<div class="cff-sub-pick"><div class="cff-sub-label">Schedule variant</div>' +
      chooser('cff-c-variant', it.schedules.map(function (c) {
        return { value: c.configId, label: c.variant || 'default', sub: c.state.toLowerCase().replace(/_/g, ' ') };
      }), d.variant, { dense: true }) + '</div>';
  }
  function schedOf(d) {
    var it = itemOf(d); if (!it || !it.schedules.length) return null;
    if (it.schedules.length === 1) return it.schedules[0];
    return d.variant ? (C.byId[d.variant] || null) : null;
  }
  function blockOf(d) { var c = schedOf(d); return c ? c.body['default'] : null; }
  function draftBlock(d) {
    var b = blockOf(d) || { transaction_date: { from: {}, to: {} } };
    return {
      transaction_date: {
        from: { offset: d.from == null ? b.transaction_date.from.offset : d.from, time: d.fromTime == null ? b.transaction_date.from.time : d.fromTime },
        to: { offset: d.to == null ? b.transaction_date.to.offset : d.to, time: d.toTime == null ? b.transaction_date.to.time : d.toTime }
      },
      report_offset: d.rep == null ? b.report_offset : d.rep,
      sundays_off: d.sun == null ? !!b.sundays_off : !!d.sun,
      saturdays_off: d.sat == null ? !!b.saturdays_off : !!d.sat,
      apply_general_holiday: d.hol == null ? !!b.apply_general_holiday : !!d.hol
    };
  }
  function runsTable(runs) {
    return '<div class="table-wrap"><table class="data cff-table"><thead><tr>' +
      '<th>Run date</th><th>Day</th><th>Covers</th><th>Report date</th><th>Outcome</th></tr></thead><tbody>' +
      runs.map(function (r) {
        return '<tr class="' + (r.fires ? '' : 'cff-skip') + '">' +
          '<td class="nowrap">' + U.prettyDate(r.runDate) + '</td><td>' + r.dow + '</td>' +
          '<td class="nowrap">' + (r.fires ? esc(U.prettyDate(r.fromDate) + ' ' + r.fromTime + ' → ' + U.prettyDate(r.toDate) + ' ' + r.toTime) : '—') + '</td>' +
          '<td class="nowrap">' + (r.fires ? U.prettyDate(r.reportDate) : '—') + '</td>' +
          '<td>' + (r.fires ? pill('Runs', 'success', 'check') : pill(r.skipReason, 'neutral', 'circle-slash')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---- fee helpers -------------------------------------------------------- */
  function feeSets(d) {
    return C.byFamily('settlement').filter(function (c) { return c.subType === 'fees' && c.tenantId === d.tenant; });
  }
  function ruleOf(d) {
    if (!d.rule) return null;
    var p = d.rule.split('::');
    if (p[1] === 'new') return null;
    var cfg = C.byId[p[0]]; if (!cfg) return null;
    return (cfg.body.txn_rules || [])[+p[1]] || null;
  }
  function ruleLabel(r) {
    if (!r) return 'New rule';
    var conds = (r.conditions || []).map(function (c) { return c.field + ' ' + c.condition + ' ' + c.value; });
    return (r.model || 'MDR') + (conds.length ? ' · ' + conds.join(', ') : '');
  }
  function condsOf(d) {
    if (d.conds) return d.conds;
    var r = ruleOf(d);
    d.conds = r ? C.clone(r.conditions || []) : [];
    return d.conds;
  }
  function condEditor(conds) {
    if (!conds.length) return '<div class="meta cff-nofields">No conditions yet — this rule would apply to every transaction.</div>';
    return '<div class="cff-conds">' + conds.map(function (c, i) {
      return '<div class="cff-cond"><span class="mono">' + esc(c.field) + '</span>' +
        '<span class="cff-cond-op">' + esc(c.condition) + '</span>' +
        '<span class="mono">' + esc(c.value) + '</span>' +
        '<button class="icon-btn xs" data-action="cff-del-cond" data-value="' + i + '" aria-label="Remove condition">' + icon('x', 14) + '</button></div>';
    }).join('') + '</div>';
  }
  function firstRate(calc) {
    var l = (calc && calc.logic && calc.logic[0]) || {};
    return l.percentage != null ? l.percentage : (l.amount != null ? l.amount : '');
  }
  /* The fee calculator: type an amount, see what this rule would charge. It is
     the only honest way to check a percentage against a slab without running a
     cycle. */
  function feeCalculator(d) {
    var amt = d.calcAmt == null ? 5000 : d.calcAmt;
    var calc = (ruleOf(d) || {}).calculations || {};
    var feeType = d.feeType || calc.fee_type || 'PERCENTAGE';
    var rate = +(d.rate == null ? firstRate(calc) : d.rate) || 0;
    var fee = feeType === 'FIXED' ? rate : (+amt * rate) / 100;
    var mode = d.mode || (ruleOf(d) || {}).fee_mode || 'DEDUCT_FROM_SETTLEMENT';
    return '<div class="cff-calc">' +
      '<label class="field cff-calc-in">Transaction amount' +
      '<input class="input num" type="number" min="0" step="1" data-action="cff-i-calcamt" value="' + amt + '" /></label>' +
      '<div class="cff-calc-out">' +
      '<div class="cff-calc-row"><span>Charge</span><span class="num">' + fee.toFixed(2) + '</span></div>' +
      '<div class="cff-calc-row"><span>' + (mode === 'DEDUCT_FROM_SETTLEMENT' ? 'Settles to merchant' : 'Billed separately, settles') + '</span>' +
      '<span class="num">' + (mode === 'DEDUCT_FROM_SETTLEMENT' ? (+amt - fee).toFixed(2) : (+amt).toFixed(2)) + '</span></div>' +
      '<div class="cff-calc-note">' + (feeType === 'FIXED' ? 'Flat charge, whatever the amount.' : rate + '% of the transaction amount.') + '</div>' +
      '</div></div>';
  }

  /* ---- issue helpers ------------------------------------------------------ */
  function issueOf(d) {
    if (!d.issue) return { start: 1, length: 1, name: '' };
    var p = d.issue.split('::');
    var cfg = C.byId[p[0]];
    return (C.parsingIssues(cfg) || [])[+p[1]] || { start: 1, length: 1, name: '' };
  }

  function trim(s) { return String(s).trim(); }
  function nonBlank(s) { return !!s; }
  function nowStamp() { return U.prettyDate(D.TODAY) + ', 11:42 IST'; }

  /* =========================================================================
     THE FLOW SHELL — one progress indicator, one footer, thirteen flows
     ========================================================================= */
  function progress(flow, step) {
    var n = flow.steps.length;
    return '<div class="cff-progress" role="list">' + flow.steps.map(function (s, i) {
      var idx = i + 1;
      var cls = idx < step ? 'done' : (idx === step ? 'current' : 'todo');
      return (i ? '<span class="cff-prog-line ' + (idx <= step ? 'lit' : '') + '"></span>' : '') +
        '<span class="cff-prog-node ' + cls + '" role="listitem">' +
        '<span class="cff-prog-dot">' + (idx < step ? icon('check', 12) : idx) + '</span>' +
        '<span class="cff-prog-label">' + esc(s.label) + '</span></span>';
    }).join('') + '</div>';
  }

  function reviewStep(flow, d) {
    var built;
    try { built = flow.build(d); } catch (e) { built = null; }
    if (!built) {
      return stepHead('Review', '') + '<div class="meta">Something in the earlier steps is incomplete — step back and finish it.</div>';
    }
    return stepHead('Review and submit', 'This is exactly what will change.') +
      reviewTarget(built.cfg) +
      reviewRows(built.rows) +
      '<div class="cff-summary">' + icon('file-diff', 16) + '<span>' + esc(built.summary) + '</span></div>' +
      approvalNote();
  }

  function renderFlow(taskId) {
    var flow = FLOWS[taskId];
    if (!flow) { go(BASE); return; }
    if (S.cff.task !== taskId) S.cff = { task: taskId, step: 1, d: {} };
    var d = S.cff.d;

    var crumb = '<div class="breadcrumb"><a data-route="' + BASE + '">Platform Configs</a>' +
      '<span class="sep">/</span><span>' + esc(flow.title) + '</span></div>';

    /* Read-only tasks have no steps and no footer — there is nothing to
       submit, so pretending otherwise would be the same lie the task cards
       used to tell. */
    if (flow.readOnly) {
      var key = flow.chooseKey || 'configId';
      setView(crumb +
        '<div class="cff-head"><h1 class="page-title">' + esc(flow.title) + '</h1>' +
        '<span class="cff-ro">' + icon('eye', 14) + 'Read-only</span></div>' +
        '<div class="cff-body">' +
        stepHead('Which one?', '') + flow.choose(d) +
        (d[key] ? '<div class="cff-view">' + flow.view(d) + '</div>' : '') +
        '</div>');
      return;
    }

    var step = S.cff.step;
    var def = flow.steps[step - 1];
    var last = step === flow.steps.length;
    var body = def.review ? reviewStep(flow, d) : def.render(d);
    var valid = def.review ? true : def.valid(d);

    setView(crumb +
      '<div class="cff-head">' +
      '<h1 class="page-title">' + esc(flow.title) + '</h1>' +
      '<span class="cff-stepcount">Step <span class="num">' + step + '</span> of <span class="num">' + flow.steps.length + '</span></span>' +
      '</div>' +
      progress(flow, step) +
      '<div class="cff-body">' + body + '</div>' +
      '<div class="cff-foot">' +
      (step > 1
        ? '<button class="btn btn-secondary" data-action="cff-back">' + icon('arrow-left', 16) + 'Back</button>'
        : '<a class="btn btn-secondary" data-route="' + BASE + '">' + icon('arrow-left', 16) + 'Cancel</a>') +
      (last
        ? '<button class="btn btn-primary" data-action="cff-submit">' + icon('send', 16) + 'Submit for approval</button>'
        : '<button class="btn btn-primary"' + (valid ? '' : ' disabled') + ' data-action="cff-next">Next' + icon('arrow-right', 16) + '</button>') +
      '</div>');
  }
  function repaint() { if (S.cff.task) renderFlow(S.cff.task); }

  /* =========================================================================
     ACTIONS
     ========================================================================= */
  function setD(k, v) { S.cff.d[k] = v; repaint(); }
  function keepFocus(action) {
    var i = el('view').querySelector('[data-action="' + action + '"]');
    if (i && i.setSelectionRange) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { } }
    else if (i) i.focus();
  }

  var ACTIONS = {
    'cff-next': function () {
      var flow = FLOWS[S.cff.task]; if (!flow) return;
      if (S.cff.step < flow.steps.length) { S.cff.step++; repaint(); }
    },
    'cff-back': function () { if (S.cff.step > 1) { S.cff.step--; repaint(); } },
    'cff-submit': function () {
      var flow = FLOWS[S.cff.task]; if (!flow) return;
      var built = flow.build(S.cff.d);
      if (!built) { toast('Something in the earlier steps is incomplete', 'info'); return; }
      FLOWAPI.submit(built);
      toast('Submitted for approval — now in the config approvals queue', 'success');
      S.cff = { task: null, step: 1, d: {} };
      go(BASE + '/approvals');
    },

    /* ---- choosers ---- */
    'cff-c-config': function (t) {
      var d = S.cff.d;
      d.configId = t.getAttribute('data-value');
      var cfg = cfgById(d.configId);
      var rts = bodyRecordTypes(cfg);
      d.rt = rts.length === 1 ? 0 : null;
      d.fi = null; d.start = null; d.length = null;
      repaint();
    },
    'cff-c-rt': function (t) { S.cff.d.rt = +t.getAttribute('data-value'); S.cff.d.fi = null; repaint(); },
    'cff-c-field': function (t) {
      var d = S.cff.d;
      d.fi = +t.getAttribute('data-value');
      var f = fieldsOf(d)[d.fi];
      if (f) { d.start = f.start; d.length = f.length; d.type = f.type; }
      repaint();
    },
    'cff-c-source': function (t) { setD('source', t.getAttribute('data-value')); },
    'cff-c-issue': function (t) {
      var d = S.cff.d;
      d.issue = t.getAttribute('data-value');
      var iss = issueOf(d);
      d.start = iss.start; d.length = iss.length; d.name = iss.name || '';
      repaint();
    },
    'cff-c-item': function (t) { var d = S.cff.d; d.item = t.getAttribute('data-value'); d.cols = null; d.variant = null; repaint(); },
    'cff-c-variant': function (t) { setD('variant', t.getAttribute('data-value')); },
    'cff-c-fee-tenant': function (t) { var d = S.cff.d; d.tenant = t.getAttribute('data-value'); d.rule = null; d.conds = null; repaint(); },
    'cff-c-rule': function (t) { var d = S.cff.d; d.rule = t.getAttribute('data-value'); d.conds = null; d.rate = null; d.feeType = null; repaint(); },

    /* ---- selects ---- */
    'cff-c-type': function (t) { setD('type', t.value); },
    'cff-c-nftype': function (t) { setD('nftype', t.value); },
    'cff-c-src': function (t) { setD('src', t.value); },
    'cff-c-tenant': function (t) { setD('tenant', t.value); },
    'cff-c-from': function (t) { setD('from', t.value); },
    'cff-c-to': function (t) { setD('to', t.value); },
    'cff-c-rep': function (t) { setD('rep', t.value); },
    'cff-c-sun': function (t) { setD('sun', !!t.checked); },
    'cff-c-sat': function (t) { setD('sat', !!t.checked); },
    'cff-c-hol': function (t) { setD('hol', !!t.checked); },
    'cff-c-feetype': function (t) { setD('feeType', t.value); },
    'cff-c-mode': function (t) { setD('mode', t.value); },
    'cff-c-cfield': function (t) { S.cff.d.cfield = t.value; },
    'cff-c-ccond': function (t) { S.cff.d.ccond = t.value; },

    /* ---- typed inputs ---- */
    'cff-i-start': function (t) { S.cff.d.start = +t.value || null; repaint(); keepFocus('cff-i-start'); },
    'cff-i-len': function (t) { S.cff.d.length = +t.value || null; repaint(); keepFocus('cff-i-len'); },
    'cff-i-name': function (t) { S.cff.d.name = t.value; repaint(); keepFocus('cff-i-name'); },
    'cff-i-code': function (t) { S.cff.d.code = t.value; repaint(); keepFocus('cff-i-code'); },
    'cff-i-note': function (t) { S.cff.d.note = t.value; },
    'cff-i-q': function (t) { S.cff.d.q = t.value; repaint(); keepFocus('cff-i-q'); },
    'cff-i-sq': function (t) { S.cff.d.sq = t.value; repaint(); keepFocus('cff-i-sq'); },
    'cff-i-patterns': function (t) { S.cff.d.patterns = t.value; repaint(); keepFocus('cff-i-patterns'); },
    'cff-i-nfname': function (t) { S.cff.d.nfname = t.value; repaint(); keepFocus('cff-i-nfname'); },
    'cff-i-nfstart': function (t) { S.cff.d.nfstart = +t.value || null; },
    'cff-i-nflen': function (t) { S.cff.d.nflen = +t.value || null; repaint(); keepFocus('cff-i-nflen'); },
    'cff-i-fromtime': function (t) { S.cff.d.fromTime = t.value; repaint(); keepFocus('cff-i-fromtime'); },
    'cff-i-totime': function (t) { S.cff.d.toTime = t.value; repaint(); keepFocus('cff-i-totime'); },
    'cff-i-secstart': function (t) { S.cff.d.secStart = +t.value || null; },
    'cff-i-seclen': function (t) { S.cff.d.secLen = +t.value || null; },
    'cff-i-sechdr': function (t) { S.cff.d.secHdr = t.value; },
    'cff-i-secdet': function (t) { S.cff.d.secDet = t.value; repaint(); keepFocus('cff-i-secdet'); },
    'cff-i-sectrl': function (t) { S.cff.d.secTrl = t.value; },
    'cff-i-rate': function (t) { S.cff.d.rate = t.value; repaint(); keepFocus('cff-i-rate'); },
    'cff-i-cvalue': function (t) { S.cff.d.cvalue = t.value; repaint(); keepFocus('cff-i-cvalue'); },
    'cff-i-calcamt': function (t) { S.cff.d.calcAmt = +t.value || 0; repaint(); keepFocus('cff-i-calcamt'); },

    /* ---- list editing ---- */
    'cff-add-field': function () {
      var d = S.cff.d;
      if (!(d.nfname || '').trim() || !(d.nflen > 0)) return;
      d.fields = (d.fields || []).concat([{
        name: d.nfname.trim(), start: +(d.nfstart || nextStart(d.fields || [])),
        length: +d.nflen, type: d.nftype || 'AN', note: ''
      }]);
      d.fields.sort(function (a, b) { return a.start - b.start; });
      d.nfname = ''; d.nflen = null; d.nfstart = null;
      repaint();
    },
    'cff-del-field': function (t) {
      var i = +t.getAttribute('data-value');
      S.cff.d.fields = (S.cff.d.fields || []).filter(function (_, j) { return j !== i; });
      repaint();
    },
    'cff-add-cond': function () {
      var d = S.cff.d;
      if (!(d.cvalue || '').trim()) return;
      condsOf(d).push({ field: d.cfield || C.TXN_COLUMNS[0], condition: d.ccond || 'EQ', value: d.cvalue.trim() });
      d.cvalue = '';
      repaint();
    },
    'cff-del-cond': function (t) {
      var i = +t.getAttribute('data-value');
      S.cff.d.conds = condsOf(S.cff.d).filter(function (_, j) { return j !== i; });
      repaint();
    },
    'cff-col-add': function (t) { colsOf(S.cff.d).push({ column: t.getAttribute('data-value'), alias: null }); repaint(); },
    'cff-col-del': function (t) {
      var i = +t.getAttribute('data-value');
      S.cff.d.cols = colsOf(S.cff.d).filter(function (_, j) { return j !== i; });
      repaint();
    },
    'cff-col-up': function (t) { swapCol(+t.getAttribute('data-value'), -1); },
    'cff-col-down': function (t) { swapCol(+t.getAttribute('data-value'), 1); },

    /* The live ruler's gap click pre-fills position and length — Part 8.3's
       "clicking a gap pre-fills position and length". */
    'cfg-gap-flow': function (t) {
      S.cff.d.start = +t.getAttribute('data-start');
      S.cff.d.length = +t.getAttribute('data-len');
      repaint();
    }
  };
  function swapCol(i, dir) {
    var cols = colsOf(S.cff.d), j = i + dir;
    if (j < 0 || j >= cols.length) return;
    var tmp = cols[i]; cols[i] = cols[j]; cols[j] = tmp;
    repaint();
  }

  /* The configs module owns submission so a flow can never write a config the
     editor would not have. Filled in by app.js via setSubmit. */
  var FLOWAPI = { submit: function () { } };
  function setSubmit(fn) { FLOWAPI.submit = fn; }

  function route(rest) {
    // rest = ['task', '<id>']
    var id = rest && rest[1];
    if (!id || !FLOWS[id]) { go(BASE); return; }
    renderFlow(id);
  }

  return {
    route: route, actions: ACTIONS, setSubmit: setSubmit,
    flowRoute: flowRoute, has: function (id) { return !!FLOWS[id]; },
    titleOf: function (id) { return FLOWS[id] ? FLOWS[id].title : id; }
  };
};
