/* =============================================================================
   Juspay Ops Portal — Error Catalog (Observability & RCA brief, Part 5)

   A lookup from error signature to plain-language explanation and remediation.
   This is a DATA file: it holds no markup and knows nothing about rendering.
   runs-rca.js turns an entry plus a run into the RCA card.

   Every entry carries:
     code           the signature a failed stage reports
     stage          the named stage the failure is attributed to (Part 3.2)
     kind           'failure' (red x-circle) | 'guard' (amber shield-alert)
     title          PLAIN LANGUAGE. Never an error code — this is what the
                    operator reads first and it must say what didn't happen.
     what           1–2 sentences, with counts that locate the problem
     why            the cause, with the run's own values interpolated
     action.text    one sentence of instruction
     action.primary the deep link to WHERE THE FIX HAPPENS, with the context
                    keys that must travel with it so the destination arrives
                    pre-filtered (Part 10.2)
     action.secondary  usually the retry; omitted where a retry is meaningless
     evidenceLines  how many log lines this failure needs. Capped at 6 by the
                    renderer regardless of what is written here (Part 4.2).

   Templates interpolate {token} from the run's err.values merged with values
   derived from the run itself (tenant, network, cycle, file names).

   window.RUN_ERRORS is consumed by runs-rca.js and runs-data.js.
   ============================================================================= */
window.RUN_ERRORS = (function () {
  'use strict';

  /* Targets a primary/secondary action can point at. runs-rca.js resolves each
     of these to a route or an in-page action — they are named here rather than
     hardcoded as URLs so the catalog stays free of routing knowledge.

       configs/incoming        Incoming Parsing Configs, pre-filled
       configs/network-files   Network File Configs, pre-filled
       configs/settlement      Settlement Configs (tab carried in context)
       files                   Settlement File Monitoring, pre-filtered
       validation              Settlement File Monitoring with the report open
       rejects                 Rejects, pre-filtered by tenant + cycle + family
       cycle                   Cycle Snapshot for this run's tenant/network/cycle
       run                     This run's detail page
       originalRun             The earlier run this one collides with
       launcher                Run launcher, pre-selected
       launcherDate            Run launcher, pre-selected on the FILE's date
       runIncoming             Run launcher, pre-selected on incoming parse
       rerun                   Re-run this run (mocked)
       copy                    Copy the failure details for engineering
       override                Open the override request form (Part 7.4)
  */

  var CATALOG = [

    /* ===================================================================== *
       INCOMING
       ===================================================================== */
    {
      code: 'INCOMING_FILE_MISSING',
      stage: 'Locate file at source',
      kind: 'failure',
      title: 'Incoming file never arrived',
      what: 'The {networkName} incoming file for cycle {cycleShort} was not at the source when the fetch ran. Nothing was downloaded and nothing was parsed.',
      why: 'The platform polled {sourcePath} every {pollInterval} between {firstPoll} and {lastPoll} IST and found nothing matching {expectedName}. {networkName} has not delivered the file, or has delivered it under a name the pattern does not match.',
      action: {
        text: 'Check whether the file has landed since, then re-run the fetch. If it is still missing past the cutoff, raise it with {networkName}.',
        primary: { label: 'Open file monitoring →', target: 'files', context: ['tenant'] },
        secondary: { label: 'Re-run fetch', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'INCOMING_DECRYPT_FAILED',
      stage: 'Decrypt',
      kind: 'failure',
      title: "File couldn't be decrypted",
      what: 'The file arrived intact at {sizeLabel} but could not be decrypted, so none of it could be read.',
      why: 'The payload is encrypted to key {keyId}, which is not in the platform keyring for {tenantName} · {networkName}. The keyring holds {knownKeyId}. {networkName} appears to have rotated its signing key without the new public key being loaded.',
      action: {
        text: 'The keyring is not editable from the dashboard — this needs an engineer. Send them the details below.',
        primary: { label: 'Copy details for engineering', target: 'copy' },
        secondary: { label: 'Re-run fetch', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'PARSE_FIELD_UNMAPPED',
      stage: 'Map fields',
      kind: 'failure',
      title: "Incoming file couldn't be parsed",
      what: "A field in the file doesn't match the parsing configuration. Parsing stopped at record {record} of {totalRecords}.",
      why: "The file contains a field named {fieldName} at characters {start}–{end}. The current configuration doesn't define anything at that position, so the parser had nothing to map it to.",
      action: {
        text: 'Add the {fieldName} field to the {networkName} incoming parsing configuration, then re-run this parse.',
        primary: {
          label: 'Add this field →', target: 'configs/incoming',
          context: ['network', 'fieldName', 'start', 'length']
        },
        secondary: { label: 'Re-run parse', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'PARSE_LAYOUT_MISMATCH',
      stage: 'Detect layout',
      kind: 'failure',
      title: "File layout doesn't match configuration",
      what: 'Layout detection rejected the file at its header. No records were read.',
      why: 'The configured {networkName} incoming layout expects records of {expectedWidth} characters; every record in this file is {actualWidth}. Either {networkName} changed its layout, or this file is from a different feed.',
      action: {
        text: 'Compare the file against the {networkName} incoming layout and correct the record width, then re-run.',
        primary: { label: 'Open the incoming layout →', target: 'configs/incoming', context: ['network'] },
        secondary: { label: 'Re-run parse', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'PARSE_RECORD_COUNT_MISMATCH',
      stage: 'Reconcile counts',
      kind: 'failure',
      title: "Record count doesn't match the file trailer",
      what: 'Every record parsed, but the count check failed. {parsedRecords} records were read; the file trailer declares {declaredRecords}.',
      why: '{skippedRecords} records were skipped during parsing because they failed record-level validation. The trailer count is authoritative, so the parse was not committed — a partial load would understate the cycle.',
      action: {
        text: 'Open the run to see which records were skipped, then decide whether to re-parse or ask {networkName} to resend.',
        primary: { label: 'View the skipped records →', target: 'run' },
        secondary: { label: 'Re-run parse', target: 'rerun' }
      },
      evidenceLines: 5
    },
    {
      code: 'PARSE_UNKNOWN_RECORD_TYPE',
      stage: 'Parse records',
      kind: 'failure',
      title: "File contains a record type we don't recognise",
      what: 'Parsing stopped at record {record} of {totalRecords} on a record type the configuration has no definition for.',
      why: 'Record type {recordType} is not defined in the {networkName} incoming parsing configuration. {occurrences} records in this file carry it. The parser will not guess at a layout it was not given.',
      action: {
        text: 'Add record type {recordType} to the {networkName} incoming parsing configuration, then re-run this parse.',
        primary: { label: 'Add this record type →', target: 'configs/incoming', context: ['network', 'recordType'] },
        secondary: { label: 'Re-run parse', target: 'rerun' }
      },
      evidenceLines: 4
    },

    /* ===================================================================== *
       CLEARING
       ===================================================================== */
    {
      code: 'CLEARING_TXN_FETCH_EMPTY',
      stage: 'Fetch transactions',
      kind: 'failure',
      title: 'No transactions found for this cycle',
      what: 'The clearing run found nothing to send, so no file was written.',
      why: 'The transaction query for {tenantName} · {networkName} · cycle {cycleShort} returned 0 rows. Either the cycle genuinely has no {networkName} activity, or the authorisation feed for it has not landed yet.',
      action: {
        text: 'Check the cycle snapshot to see whether authorisations landed for this cycle before re-running.',
        primary: { label: 'Open the cycle snapshot →', target: 'cycle' },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'CLEARING_LAYOUT_INVALID',
      stage: 'Apply layout',
      kind: 'failure',
      title: 'File layout configuration is invalid',
      what: 'The clearing file could not be built. Layout validation failed before a single record was written.',
      why: 'The active {networkName} clearing layout has overlapping fields: {fieldA} occupies characters {aStart}–{aEnd} and {fieldB} occupies {bStart}–{bEnd}. Two fields cannot share a position.',
      action: {
        text: 'Fix the overlap in the {networkName} clearing layout, get it approved, then re-run.',
        primary: { label: 'Open the layout →', target: 'configs/network-files', context: ['network', 'fieldA'] },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 5
    },
    {
      code: 'CLEARING_FIELD_OVERFLOW',
      stage: 'Apply transforms',
      kind: 'failure',
      title: 'A value is too long for its field',
      what: 'Writing stopped at record {record} of {totalRecords}. No file was produced.',
      why: 'The field {fieldName} is {fieldLength} characters wide in the {networkName} clearing layout. Record {record} carries a {valueLength}-character value ({sampleValue}), which cannot be written without silently truncating data.',
      action: {
        text: 'Widen {fieldName} in the {networkName} clearing layout, or add a transform that truncates it deliberately, then re-run.',
        primary: {
          label: 'Open this field →', target: 'configs/network-files',
          context: ['network', 'fieldName', 'fieldLength']
        },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'CLEARING_TRANSFORM_MISSING',
      stage: 'Apply transforms',
      kind: 'failure',
      title: 'A required field has no data mapped',
      what: 'The clearing file could not be built — a mandatory field has no source behind it.',
      why: 'The {networkName} clearing layout marks {fieldName} as mandatory, but nothing on the mapping tab supplies a value for it. All {totalRecords} records would have been written blank.',
      action: {
        text: 'Map a source column to {fieldName} on the {networkName} layout mapping tab, then re-run.',
        primary: {
          label: 'Open the mapping →', target: 'configs/network-files',
          context: ['network', 'fieldName', 'tab']
        },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'CLEARING_STAGE_REJECTED',
      stage: 'Await acknowledgment',
      kind: 'failure',
      title: 'The network rejected the file',
      what: 'The file transmitted successfully, then {networkName} refused it. {rejectedCount} of {totalRecords} records were rejected, so nothing cleared.',
      why: '{networkName} returned reason code {reasonCode} — {reasonText}. The whole file is rejected: the affected records have to be corrected and the file resubmitted.',
      action: {
        text: 'Correct the rejected records, then generate a replacement file and stage it again.',
        primary: { label: 'Open these rejects →', target: 'rejects', context: ['tenant', 'cycleDate', 'family'] },
        secondary: { label: 'Re-run stage', target: 'rerun' }
      },
      evidenceLines: 5
    },
    {
      code: 'CLEARING_STAGE_TIMEOUT',
      stage: 'Await acknowledgment',
      kind: 'failure',
      title: "The network didn't respond in time",
      what: 'The file transmitted in full — {sizeLabel} confirmed — but no acknowledgment came back within {timeoutLabel}.',
      why: 'The {networkName} endpoint {endpoint} accepted the connection and the whole payload, then went quiet. The file may or may not have been accepted; only {networkName} can say. Re-staging blind risks a duplicate.',
      action: {
        text: 'Confirm with {networkName} whether the file was received before re-staging — a blind retry is how duplicates happen.',
        primary: { label: 'Re-run stage', target: 'rerun' },
        secondary: { label: 'Copy details for engineering', target: 'copy' }
      },
      evidenceLines: 4
    },

    /* ===================================================================== *
       SETTLEMENT
       ===================================================================== */
    {
      code: 'SETTLEMENT_SCHEDULE_SKIPPED',
      stage: 'Resolve schedule',
      kind: 'failure',
      title: "Report didn't run — schedule excluded this day",
      what: 'No {reportName} was generated for {cycleShort}. The run stopped at schedule resolution, before touching any data.',
      why: 'The schedule for {reportName} runs {scheduleDays}. {cycleShort} is a {dow}{holidayClause}, which that schedule excludes, so there was nothing to generate.',
      action: {
        text: 'If {reportName} should run on this day, change its schedule; if not, this run is working as configured and needs nothing.',
        primary: { label: 'Open the schedule →', target: 'configs/settlement', context: ['tenant', 'tab', 'reportName'] }
      },
      evidenceLines: 3
    },
    {
      code: 'SETTLEMENT_SOURCE_EMPTY',
      stage: 'Fetch transactions',
      kind: 'failure',
      title: "No data matched the report's filters",
      what: '{reportName} produced 0 rows for {cycleShort}, so no file was written.',
      why: "The report's content filters ({filterSummary}) matched none of the {sourceRows} settled transactions in this cycle. The filters are narrower than the data.",
      action: {
        text: 'Widen or correct the content filters on {reportName}, then re-run.',
        primary: { label: 'Open the report content →', target: 'configs/settlement', context: ['tenant', 'tab', 'reportName'] },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 4
    },
    {
      code: 'SETTLEMENT_FEE_RULE_MISSING',
      stage: 'Apply fee rules',
      kind: 'failure',
      title: 'No fee rule matched some transactions',
      what: 'Fee application stopped with {unmatched} of {totalRecords} transactions left unpriced.',
      why: 'No fee rule covers {unmatchedKey}. The generator will not emit a report with blank fee columns, because a blank fee reads downstream as a zero fee.',
      action: {
        text: 'Add a fee rule covering {unmatchedKey}, get it approved, then re-run.',
        primary: { label: 'Open the fee rules →', target: 'configs/settlement', context: ['tenant', 'tab'] },
        secondary: { label: 'Re-run generate', target: 'rerun' }
      },
      evidenceLines: 5
    },
    {
      code: 'SETTLEMENT_DELIVERY_FAILED',
      stage: 'Deliver to acquirer',
      kind: 'failure',
      title: "Report generated but couldn't be delivered",
      what: 'The file {fileName} was written correctly but never reached {tenantName}. {attempts} delivery attempts were made over {attemptWindow}.',
      why: 'The endpoint {endpoint} refused every connection: {transportError}. The file itself is intact in S3 and can be delivered as soon as the endpoint answers.',
      action: {
        text: 'Check the endpoint, then re-deliver. The file does not need regenerating.',
        primary: { label: 'Open file monitoring →', target: 'files', context: ['tenant'] },
        secondary: { label: 'Re-run delivery', target: 'rerun' }
      },
      evidenceLines: 5
    },
    {
      code: 'SETTLEMENT_VALIDATION_MISMATCH',
      stage: 'Compare sums',
      kind: 'failure',
      title: "Report doesn't match the source data",
      what: 'Validation compared {fileName} against the base source and found {mismatchCount} discrepancies.',
      why: 'The file totals {fileSum} across {fileRecords} records; the source totals {sourceSum} across {sourceRecords}. The difference is {deltaLabel}, concentrated in {mismatchField}.',
      action: {
        text: 'Open the validation report to see the differing records, correct the source, then re-validate.',
        primary: { label: 'Open the validation report →', target: 'validation', context: ['tenant', 'fileId'] },
        secondary: { label: 'Re-run validation', target: 'rerun' }
      },
      evidenceLines: 5
    },

    /* ===================================================================== *
       GUARDS (Part 7) — same card, amber shield header, override instead of
       retry. A blocked run never executed: its What happened says so plainly.
       ===================================================================== */
    {
      code: 'GUARD_CYCLE_ALREADY_STAGED',
      stage: 'Pre-flight checks',
      kind: 'guard',
      title: 'This cycle has already been staged',
      what: 'This {directionWord} run was stopped before it did anything.',
      why: 'Clearing for {tenantName} · {networkName} · {cycleShort} was already staged successfully at {originalTime}{incomingClause}. Staging again would send a duplicate file to {networkName}.',
      action: {
        text: 'If you meant to run incoming for this cycle, start that instead. If you genuinely need to re-stage, an override needs a reason and a second approver.',
        primary: { label: 'Run incoming instead →', target: 'runIncoming' },
        secondary: { label: 'Request override', target: 'override' }
      },
      evidenceLines: 4
    },
    {
      code: 'GUARD_FILE_DATE_MISMATCH',
      stage: 'Pre-flight checks',
      kind: 'guard',
      title: "File date doesn't match the cycle",
      what: 'This run was stopped before the file was sent.',
      why: 'The file {fileName} carries an internal date of {fileDatePretty}, but this run targets cycle {cycleShort}. Sending it would file {fileDatePretty} activity against the wrong cycle, and the difference would surface later as an unexplained reconciliation residual.',
      action: {
        text: 'Start this run against {fileDatePretty} instead, or get the file re-cut for {cycleShort}.',
        primary: { label: 'Start a run for {fileDatePretty} →', target: 'launcherDate' },
        secondary: { label: 'Request override', target: 'override' }
      },
      evidenceLines: 4
    },
    {
      code: 'GUARD_DUPLICATE_FILE',
      stage: 'Pre-flight checks',
      kind: 'guard',
      title: 'This exact file has been processed before',
      what: 'This run was stopped before the file was read.',
      why: 'The file {fileName} has checksum {checksum}, which matches the file already processed on {originalDatePretty} in run {originalRunId}. Byte for byte, this is the same file.',
      action: {
        text: 'Check the original run before doing anything else — processing this file twice would double-count every record in it.',
        primary: { label: 'View the original run →', target: 'originalRun' },
        secondary: { label: 'Request override', target: 'override' }
      },
      evidenceLines: 4
    },
    {
      code: 'GUARD_SOURCE_MISMATCH',
      stage: 'Pre-flight checks',
      kind: 'guard',
      title: 'File came from an unexpected source',
      what: 'This run was stopped before the file was sent.',
      why: 'This file came from {actualSource}. {tenantName} · {networkName} is configured to take clearing files from {expectedSource}. A file from a different source may cover a different set of transactions, even when the counts look identical.',
      action: {
        text: 'Confirm which source is correct for this cycle before continuing.',
        primary: { label: 'Open the cycle snapshot →', target: 'cycle' },
        secondary: { label: 'Request override', target: 'override' }
      },
      evidenceLines: 4
    },
    {
      code: 'GUARD_CUTOFF_PASSED',
      stage: 'Pre-flight checks',
      kind: 'guard',
      /* Part 7.3 — this check WARNS, it does not block. It never produces a
         blocked run; it appears as an amber pre-flight line and, where a run
         proceeded past its cutoff, as this card on the run itself. */
      warnOnly: true,
      title: 'The cutoff for this leg has already passed',
      what: 'This run started after its cutoff. It was allowed to proceed — this is a warning, not a block.',
      why: 'The cutoff for {legLabel} on {tenantName} · {networkName} · {cycleShort} was {cutoffLabel} IST. This run started {overdueLabel} after it. Legs downstream of this one may already have run without its output.',
      action: {
        text: 'Check what has already run for this cycle before relying on this output.',
        primary: { label: 'Open the cycle snapshot →', target: 'cycle' }
      },
      evidenceLines: 3
    }
  ];

  var byCode = {};
  CATALOG.forEach(function (e) { byCode[e.code] = e; });

  function has(code) { return !!byCode[code]; }
  function get(code) { return byCode[code] || null; }

  /* Interpolation. An unresolved token is left visible as {token} rather than
     silently blanked — a card that quietly drops a value is worse than one that
     shows it is missing a value. */
  function interp(tpl, vals) {
    if (!tpl) return '';
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return (vals && vals[k] != null && vals[k] !== '') ? String(vals[k]) : m;
    });
  }

  /* Codes grouped the way Part 5.2 lists them — used by the catalog reference
     block on the Run Console so every entry is reachable and demonstrable. */
  var GROUPS = [
    { key: 'incoming', label: 'Incoming', codes: ['INCOMING_FILE_MISSING', 'INCOMING_DECRYPT_FAILED', 'PARSE_FIELD_UNMAPPED', 'PARSE_LAYOUT_MISMATCH', 'PARSE_RECORD_COUNT_MISMATCH', 'PARSE_UNKNOWN_RECORD_TYPE'] },
    { key: 'clearing', label: 'Clearing', codes: ['CLEARING_TXN_FETCH_EMPTY', 'CLEARING_LAYOUT_INVALID', 'CLEARING_FIELD_OVERFLOW', 'CLEARING_TRANSFORM_MISSING', 'CLEARING_STAGE_REJECTED', 'CLEARING_STAGE_TIMEOUT'] },
    { key: 'settlement', label: 'Settlement', codes: ['SETTLEMENT_SCHEDULE_SKIPPED', 'SETTLEMENT_SOURCE_EMPTY', 'SETTLEMENT_FEE_RULE_MISSING', 'SETTLEMENT_DELIVERY_FAILED', 'SETTLEMENT_VALIDATION_MISMATCH'] },
    { key: 'guard', label: 'Guards', codes: ['GUARD_CYCLE_ALREADY_STAGED', 'GUARD_FILE_DATE_MISMATCH', 'GUARD_DUPLICATE_FILE', 'GUARD_SOURCE_MISMATCH', 'GUARD_CUTOFF_PASSED'] }
  ];

  return {
    CATALOG: CATALOG, byCode: byCode, GROUPS: GROUPS,
    has: has, get: get, interp: interp
  };
})();
