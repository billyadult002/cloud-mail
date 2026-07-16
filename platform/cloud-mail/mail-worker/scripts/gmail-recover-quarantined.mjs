#!/usr/bin/env node
// One-time recovery: unstick Gmail accounts absorbed into 'error'/'sync_failed'.
// PRECONDITION: run only AFTER the RC-1 recoverable state machine is deployed, or the
// accounts will simply be re-quarantined on the next failure.
//
// Usage:
//   node gmail-recover-quarantined.mjs            # DRY RUN — counts only, no writes
//   node gmail-recover-quarantined.mjs --apply    # perform the UPDATE
//
// Execution is via `wrangler d1 execute cloud-mail --remote --command "<SQL>"`; this
// script prints the SQL and (in --apply) is intended to be run by the operator with D1
// access. It performs NO network/db access on its own — it is a guarded command emitter,
// so it is safe to run anywhere. Nothing here connects to production.

const APPLY = process.argv.includes('--apply');

const CENSUS_SQL =
	"SELECT sync_status, COUNT(*) AS n FROM account " +
	"WHERE is_del=0 AND provider IN ('gmail','google_workspace') " +
	"GROUP BY sync_status;";

const RECOVER_SQL =
	"UPDATE account SET sync_status='sync_required', next_attempt_at=datetime('now'), " +
	"sync_attempts=0, sync_error=NULL " +
	"WHERE is_del=0 AND provider IN ('gmail','google_workspace') " +
	"AND LOWER(COALESCE(sync_status,'')) IN ('error','sync_failed');";

function emit(label, sql) {
	console.log(`\n# ${label}`);
	console.log(`wrangler d1 execute cloud-mail --remote --command "${sql.replace(/"/g, '\\"')}"`);
}

console.log('gmail-recover-quarantined — ' + (APPLY ? 'APPLY mode' : 'DRY RUN (no writes)'));
emit('1) Census BEFORE (record baseline)', CENSUS_SQL);
if (APPLY) {
	emit('2) Recover quarantined accounts', RECOVER_SQL);
	emit('3) Census AFTER (expect error/sync_failed = 0)', CENSUS_SQL);
} else {
	console.log('\n# DRY RUN: recovery UPDATE not emitted. Re-run with --apply after RC-1 is deployed.');
}
