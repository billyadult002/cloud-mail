import settingService from './setting-service';

const OPERATION_ID = 'nexora-secure-staging-bootstrap-v1';
const encoder = new TextEncoder();

function enabled(env) {
	return String(env.NEXORA_STAGING_SECURE_BOOTSTRAP_ENABLED || 'false').toLowerCase() === 'true';
}

function staging(env) {
	return env.CLOUDFLARE_EMAIL_WORKER === 'cloud-mail-staging';
}

function sameOriginRequest(c) {
	if ((c.req.header('sec-fetch-site') || '').toLowerCase() === 'cross-site') return false;
	const origin = c.req.header('origin');
	if (!origin) return true;
	try {
		return new URL(origin).origin === new URL(c.req.url).origin;
	} catch {
		return false;
	}
}

async function sha256(value) {
	const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
	return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function matchesSecret(provided, expected) {
	if (!provided || !expected) return false;
	const [providedDigest, expectedDigest] = await Promise.all([sha256(provided), sha256(expected)]);
	let difference = 0;
	for (let index = 0; index < providedDigest.length; index += 1) {
		difference |= providedDigest.charCodeAt(index) ^ expectedDigest.charCodeAt(index);
	}
	return difference === 0;
}

function receipt(row) {
	return {
		operationId: row.operation_id,
		state: row.state,
		workerVersion: row.worker_version || '',
		completedAt: row.completed_at || null,
	};
}

async function refreshAndComplete(c, row) {
	const refreshOwner = crypto.randomUUID();
	const claim = await c.env.db.prepare(`
		UPDATE nexora_staging_bootstrap_operations
		SET state='KV_REFRESHING',refresh_owner=?1,
		    refresh_lease_expires_at=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP
		WHERE singleton_id=1
		  AND (state='DB_COMMITTED' OR (state='KV_REFRESHING' AND refresh_lease_expires_at<=CURRENT_TIMESTAMP))
	`).bind(refreshOwner).run();
	if (Number(claim.meta?.changes || 0) !== 1) {
		return { status: 409, body: { operationId: row.operation_id, state: 'KV_REFRESHING', error: 'SETTING_CACHE_REFRESH_IN_PROGRESS' } };
	}
	try {
		await settingService.refresh(c);
		await c.env.db.prepare(`
			UPDATE nexora_staging_bootstrap_operations
			SET state='READY_FOR_FIRST_AUTHORITY',refresh_owner=NULL,refresh_lease_expires_at=NULL,
			    updated_at=CURRENT_TIMESTAMP
			WHERE singleton_id=1 AND state='KV_REFRESHING' AND refresh_owner=?1
		`).bind(refreshOwner).run();
		const completed = await c.env.db.prepare(`
			SELECT operation_id,state,worker_version,completed_at
			FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
		`).first();
		return { status: completed?.state === 'READY_FOR_FIRST_AUTHORITY' ? 200 : 409, body: receipt(completed || row) };
	} catch {
		await c.env.db.prepare(`
			UPDATE nexora_staging_bootstrap_operations
			SET state='DB_COMMITTED',refresh_owner=NULL,refresh_lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
			WHERE singleton_id=1 AND state='KV_REFRESHING' AND refresh_owner=?1
		`).bind(refreshOwner).run().catch(() => {});
		return {
			status: 503,
			body: {
				operationId: row.operation_id,
				state: 'DB_COMMITTED',
				retryable: true,
				error: 'SETTING_CACHE_REFRESH_REQUIRED',
			},
		};
	}
}

const secureStagingBootstrapService = {
	isStaging: staging,

	async execute(c, providedSecret) {
		if (!staging(c.env)) return { status: 404, body: { error: 'NOT_FOUND' } };
		if (!enabled(c.env)) return { status: 403, body: { error: 'SECURE_BOOTSTRAP_DISABLED' } };
		if (!sameOriginRequest(c)) return { status: 403, body: { error: 'CROSS_SITE_REQUEST_DENIED' } };
		if (String(c.env.NEXORA_STAGING_BOOTSTRAP_SECRET || '').length < 32) {
			return { status: 503, body: { error: 'SECURE_BOOTSTRAP_SECRET_TOO_WEAK' } };
		}
		if (!await matchesSecret(providedSecret, c.env.NEXORA_STAGING_BOOTSTRAP_SECRET)) {
			return { status: 401, body: { error: 'UNAUTHORIZED' } };
		}

		const existing = await c.env.db.prepare(`
			SELECT operation_id,state,worker_version,completed_at
			FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
		`).first();
		if (existing?.state === 'COMPLETE') {
			return { status: 409, body: { ...receipt(existing), error: 'SECURE_BOOTSTRAP_ALREADY_COMPLETE' } };
		}
		if (existing?.state === 'READY_FOR_FIRST_AUTHORITY') {
			return { status: 409, body: { ...receipt(existing), error: 'SECURE_BOOTSTRAP_ALREADY_COMMITTED' } };
		}
		if (existing?.state === 'DB_COMMITTED' || existing?.state === 'KV_REFRESHING') return refreshAndComplete(c, existing);

		const requestDigest = await sha256(OPERATION_ID);
		const workerVersion = String(c.env.CF_VERSION_METADATA?.id || '');
		try {
			await c.env.db.batch([
				c.env.db.prepare(`
					INSERT INTO nexora_staging_bootstrap_operations(
					 singleton_id,operation_id,request_digest,state,worker_version
					) VALUES(1,?1,?2,'DB_COMMITTED',?3)
				`).bind(OPERATION_ID, requestDigest, workerVersion),
				c.env.db.prepare(`INSERT INTO setting DEFAULT VALUES`),
			]);
		} catch {
			const winner = await c.env.db.prepare(`
				SELECT operation_id,state,worker_version,completed_at
				FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
			`).first();
			if (winner?.state === 'DB_COMMITTED' || winner?.state === 'KV_REFRESHING') return refreshAndComplete(c, winner);
			if (winner?.state === 'COMPLETE') {
				return { status: 409, body: { ...receipt(winner), error: 'SECURE_BOOTSTRAP_ALREADY_COMPLETE' } };
			}
			return { status: 409, body: { error: 'SECURE_BOOTSTRAP_PRECONDITION_FAILED' } };
		}

		const committed = await c.env.db.prepare(`
			SELECT operation_id,state,worker_version,completed_at
			FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
		`).first();
		return refreshAndComplete(c, committed);
	},

	async authorizeFirstAuthority(c, code) {
		if (!staging(c.env) || !enabled(c.env)) return false;
		if (String(c.env.NEXORA_STAGING_BOOTSTRAP_SECRET || '').length < 32) return false;
		if (!await matchesSecret(code, c.env.NEXORA_STAGING_BOOTSTRAP_SECRET)) return false;
		const ready = await c.env.db.prepare(`
			SELECT 1 ready
			FROM nexora_staging_bootstrap_operations
			WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY'
			  AND NOT EXISTS(SELECT 1 FROM user)
		`).first();
		return ready?.ready === 1;
	},

	async requiresFirstAuthority(c) {
		if (!staging(c.env) || !enabled(c.env)) return false;
		const row = await c.env.db.prepare(`
			SELECT 1 required
			FROM nexora_staging_bootstrap_operations
			WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY'
		`).first();
		return row?.required === 1;
	},

	async completeFirstAuthority(c, providedSecret) {
		if (!staging(c.env) || !enabled(c.env) || !sameOriginRequest(c)) {
			return { status: 403, body: { error: 'FIRST_AUTHORITY_COMPLETION_DENIED' } };
		}
		if (String(c.env.NEXORA_STAGING_BOOTSTRAP_SECRET || '').length < 32
			|| !await matchesSecret(providedSecret, c.env.NEXORA_STAGING_BOOTSTRAP_SECRET)) {
			return { status: 401, body: { error: 'UNAUTHORIZED' } };
		}
		const checkpoint = await c.env.db.prepare(`
			SELECT state FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
		`).first();
		if (checkpoint?.state !== 'FIRST_USER_CREATED') {
			return { status: 409, body: { error: 'CANONICAL_FIRST_AUTHORITY_TUPLE_NOT_READY' } };
		}
		try {
			const results = await c.env.db.batch([
				c.env.db.prepare(`
					INSERT INTO workspaces(tenant_key,display_name,created_by_user_id)
					SELECT 'user:'||u.user_id,'NEXORA Staging',u.user_id
					FROM user u
					JOIN nexora_staging_bootstrap_operations op ON op.singleton_id=1
					WHERE op.state='FIRST_USER_CREATED'
					  AND (SELECT COUNT(*) FROM user)=1
					  AND NOT EXISTS(SELECT 1 FROM workspaces)
				`),
				c.env.db.prepare(`
					INSERT INTO workspace_members(workspace_id,user_id,role)
					SELECT w.id,u.user_id,'OWNER'
					FROM user u JOIN workspaces w ON w.created_by_user_id=u.user_id
					WHERE (SELECT COUNT(*) FROM user)=1
					  AND NOT EXISTS(SELECT 1 FROM workspace_members)
				`),
				c.env.db.prepare(`
					UPDATE nexora_staging_bootstrap_operations
					SET state='COMPLETE',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
					WHERE singleton_id=1 AND state='FIRST_USER_CREATED'
				`),
			]);
			if (Number(results[2]?.meta?.changes || 0) !== 1) {
				return { status: 409, body: { error: 'CANONICAL_FIRST_AUTHORITY_TUPLE_NOT_READY' } };
			}
		} catch {
			return { status: 409, body: { error: 'CANONICAL_FIRST_AUTHORITY_TUPLE_NOT_READY' } };
		}
		const completed = await c.env.db.prepare(`
			SELECT operation_id,state,worker_version,completed_at
			FROM nexora_staging_bootstrap_operations WHERE singleton_id=1
		`).first();
		if (completed?.state !== 'COMPLETE') {
			return { status: 409, body: { error: 'CANONICAL_FIRST_AUTHORITY_TUPLE_NOT_READY' } };
		}
		return { status: 200, body: receipt(completed) };
	},
};

export default secureStagingBootstrapService;
