import { decryptSecret, encryptSecret } from '../utils/secret-crypto.js';

const PAYLOAD_TTL_SECONDS = 120;
const stable = (value) => Array.isArray(value)
	? `[${value.map(stable).join(',')}]`
	: value && typeof value === 'object'
		? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
		: JSON.stringify(value);
async function hash(value) {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const aad = (row) => [
	'nexora-oauth-callback-intake-v1', row.id, row.authorization_session_id,
	row.callback_correlation_id, row.callback_claim_id, row.onboarding_mission_id,
	row.tenant_id, row.workspace_id, row.provider, row.payload_expires_at,
].join(':');

async function tableAvailable(c) {
	const row = await c.env.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='nexora_oauth_callback_intakes'`).first().catch(() => null);
	return Boolean(row);
}

async function sealCallback(c, consumption, payload) {
	if (!await tableAvailable(c)) throw new Error('nexora_oauth_callback_intake_schema_required');
	if (!consumption?.callbackClaim || consumption.duplicate) throw new Error('nexora_oauth_callback_intake_authority_invalid');
	const row = {
		id: `oauth-callback-intake:${await hash({ session: consumption.authorizationSessionId, correlation: consumption.correlationId })}`,
		authorization_session_id: consumption.authorizationSessionId,
		callback_correlation_id: consumption.correlationId,
		callback_claim_id: consumption.callbackClaim.id,
		onboarding_mission_id: consumption.onboardingMissionId,
		tenant_id: consumption.scope.tenantId,
		workspace_id: consumption.scope.workspaceId,
		provider: consumption.provider,
		payload_expires_at: new Date(Date.now() + PAYLOAD_TTL_SECONDS * 1000).toISOString(),
	};
	const envelope = {
		version: 1,
		intakeId: row.id,
		authorizationSessionId: row.authorization_session_id,
		correlationId: row.callback_correlation_id,
		claimId: row.callback_claim_id,
		expiresAt: row.payload_expires_at,
		code: payload.code,
		verifier: payload.verifier,
		redirectUri: payload.redirectUri,
	};
	const payloadDigest = await hash(envelope);
	const payloadCiphertext = await encryptSecret(c, JSON.stringify(envelope), { purpose: 'provider-token', aad: aad(row) });
	const jobId = `oauth-callback-job:${row.id}`;
	await c.env.db.batch([
		c.env.db.prepare(
			`INSERT INTO nexora_oauth_callback_intakes(
			 id,authorization_session_id,callback_correlation_id,callback_claim_id,onboarding_mission_id,
			 tenant_id,workspace_id,provider,payload_ciphertext,payload_digest,payload_expires_at,state
			) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'QUEUED')
			ON CONFLICT(authorization_session_id) DO NOTHING`
		).bind(row.id, row.authorization_session_id, row.callback_correlation_id, row.callback_claim_id, row.onboarding_mission_id, row.tenant_id, row.workspace_id, row.provider, payloadCiphertext, payloadDigest, row.payload_expires_at),
		c.env.db.prepare(
			`INSERT OR IGNORE INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json)
			 SELECT ?1,?2,'NEXORA_OAUTH_CALLBACK_PROCESS',?3,'QUEUED',?4
			 WHERE EXISTS(SELECT 1 FROM nexora_oauth_callback_intakes WHERE id=?5 AND state='QUEUED')`
		).bind(jobId, row.tenant_id, `oauth-callback:${row.id}`, JSON.stringify({ intake_id: row.id, tenant_id: row.tenant_id, workspace_id: row.workspace_id }), row.id),
		c.env.db.prepare(
			`UPDATE nexora_oauth_authorization_session_bindings
			 SET callback_receipt_status='RECEIVED',updated_at=CURRENT_TIMESTAMP
			 WHERE authorization_session_id=?1 AND tenant_id=?2 AND workspace_id=?3`
		).bind(row.authorization_session_id, row.tenant_id, row.workspace_id),
	]);
	const stored = await c.env.db.prepare(`SELECT * FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(row.id).first();
	if (!stored || stored.payload_digest !== payloadDigest || stored.payload_expires_at !== row.payload_expires_at) throw new Error('nexora_oauth_callback_intake_conflict');
	return stored;
}

async function openPayload(c, row) {
	const expiresAt = Date.parse(row.payload_expires_at);
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('nexora_oauth_callback_intake_expired');
	const envelope = JSON.parse(await decryptSecret(c, row.payload_ciphertext, { purpose: 'provider-token', aad: aad(row) }));
	if (await hash(envelope) !== row.payload_digest
		|| envelope.intakeId !== row.id
		|| envelope.authorizationSessionId !== row.authorization_session_id
		|| envelope.correlationId !== row.callback_correlation_id
		|| envelope.claimId !== row.callback_claim_id
		|| envelope.expiresAt !== row.payload_expires_at) throw new Error('nexora_oauth_callback_intake_integrity_denied');
	return envelope;
}

async function processIntake(c, intakeId, processor) {
	const owner = `oauth-intake-worker:${crypto.randomUUID()}`;
	const jobId = `oauth-callback-job:${intakeId}`;
	const abortOnZero = () => c.env.db.prepare(
		`INSERT INTO nexora_oauth_callback_intakes(
		 id,authorization_session_id,callback_correlation_id,callback_claim_id,onboarding_mission_id,
		 tenant_id,workspace_id,provider,payload_ciphertext,payload_digest,payload_expires_at,state
		 ) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`
	);
	const claimed = await c.env.db.prepare(
		`UPDATE nexora_oauth_callback_intakes
		 SET state='PROCESSING',lease_owner=?2,lease_expires_at=datetime('now','+60 seconds'),
		     fencing_token=fencing_token+1,attempt=attempt+1,updated_at=CURRENT_TIMESTAMP
		 WHERE id=?1 AND (
		  state='QUEUED' OR
		  (state IN ('PROCESSING','RECOVERY_REQUIRED') AND (lease_expires_at IS NULL OR lease_expires_at<CURRENT_TIMESTAMP))
		 ) AND julianday(payload_expires_at)>julianday('now')`
	).bind(intakeId, owner).run();
	if (!claimed.meta?.changes) return { processed: false, reason: 'INTAKE_NOT_CLAIMABLE' };
	const row = await c.env.db.prepare(`SELECT * FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(intakeId).first();
	try {
		await c.env.db.prepare(
			`UPDATE nexora_autonomy_jobs
			 SET state='RUNNING',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP
			 WHERE id=?1 AND job_type='NEXORA_OAUTH_CALLBACK_PROCESS'
			   AND state IN ('QUEUED','RETRYING')`
		).bind(jobId).run();
		const payload = await openPayload(c, row);
		const result = await processor(c, row, payload);
		await c.env.db.batch([
			c.env.db.prepare(
				`UPDATE nexora_oauth_callback_intakes
				 SET state='COMPLETED',payload_ciphertext='',completed_at=CURRENT_TIMESTAMP,
				     lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
				 WHERE id=?1 AND lease_owner=?2 AND fencing_token=?3 AND state='PROCESSING'`
			).bind(row.id, owner, row.fencing_token),
			abortOnZero(),
			c.env.db.prepare(
				`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',updated_at=CURRENT_TIMESTAMP
				 WHERE id=?1 AND job_type='NEXORA_OAUTH_CALLBACK_PROCESS' AND state='RUNNING'`
			).bind(jobId),
			abortOnZero(),
		]);
		return { processed: true, result };
	} catch (error) {
		await c.env.db.batch([
			c.env.db.prepare(
				`UPDATE nexora_oauth_callback_intakes
				 SET state=CASE WHEN julianday(payload_expires_at)<=julianday('now') THEN 'REAUTHORIZATION_REQUIRED' ELSE 'RECOVERY_REQUIRED' END,
				     terminal_reason_code=?4,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP,
				     payload_ciphertext=CASE WHEN julianday(payload_expires_at)<=julianday('now') THEN '' ELSE payload_ciphertext END
				 WHERE id=?1 AND lease_owner=?2 AND fencing_token=?3 AND state='PROCESSING'`
			).bind(row.id, owner, row.fencing_token, String(error?.message || 'CALLBACK_PROCESSING_FAILED').slice(0, 80)),
			abortOnZero(),
			c.env.db.prepare(
				`UPDATE nexora_autonomy_jobs
				 SET state=CASE WHEN julianday(?2)<=julianday('now') THEN 'BLOCKED' ELSE 'RETRYING' END,
				     updated_at=CURRENT_TIMESTAMP
				 WHERE id=?1 AND job_type='NEXORA_OAUTH_CALLBACK_PROCESS' AND state='RUNNING'`
			).bind(jobId, row.payload_expires_at),
			abortOnZero(),
		]);
		throw error;
	}
}

async function processPending(c, processor, { limit = 5 } = {}) {
	const rows = await c.env.db.prepare(
		`SELECT id FROM nexora_oauth_callback_intakes
		 WHERE state='QUEUED' OR (state IN ('PROCESSING','RECOVERY_REQUIRED') AND (lease_expires_at IS NULL OR lease_expires_at<CURRENT_TIMESTAMP))
		 ORDER BY created_at LIMIT ?1`
	).bind(Math.max(1, Math.min(20, Number(limit)))).all().catch(() => ({ results: [] }));
	const outcomes = [];
	for (const row of rows.results || []) outcomes.push(await processIntake(c, row.id, processor).catch((error) => ({ processed: false, reason: String(error?.message || error) })));
	return outcomes;
}

async function purgeExpired(c) {
	const expired = await c.env.db.prepare(
		`SELECT id FROM nexora_oauth_callback_intakes
		 WHERE state IN ('QUEUED','PROCESSING','RECOVERY_REQUIRED')
		   AND (julianday(payload_expires_at) IS NULL OR julianday(payload_expires_at)<=julianday('now'))`
	).all().catch(() => ({ results: [] }));
	if (!(expired.results || []).length) return { meta: { changes: 0 } };
	const ids = expired.results.map((row) => row.id);
	const placeholders = ids.map((_, index) => `?${index + 1}`).join(',');
	const statements = [
		c.env.db.prepare(
			`UPDATE nexora_oauth_callback_intakes
			 SET state='REAUTHORIZATION_REQUIRED',payload_ciphertext='',lease_owner=NULL,lease_expires_at=NULL,
			     terminal_reason_code='CALLBACK_INTAKE_EXPIRED',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
			 WHERE id IN (${placeholders})
			   AND state IN ('QUEUED','PROCESSING','RECOVERY_REQUIRED')`
		).bind(...ids),
		...ids.map((id) => c.env.db.prepare(
			`UPDATE nexora_autonomy_jobs SET state='BLOCKED',updated_at=CURRENT_TIMESTAMP
			 WHERE id=?1 AND job_type='NEXORA_OAUTH_CALLBACK_PROCESS'
			   AND state IN ('QUEUED','RUNNING','RETRYING')`
		).bind(`oauth-callback-job:${id}`)),
	];
	const results = await c.env.db.batch(statements).catch(() => []);
	return results[0] || { meta: { changes: 0 } };
}

export { tableAvailable, sealCallback, openPayload, processIntake, processPending, purgeExpired };
export default { tableAvailable, sealCallback, openPayload, processIntake, processPending, purgeExpired };
