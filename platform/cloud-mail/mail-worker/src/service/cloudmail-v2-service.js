import cryptoUtils from '../utils/crypto-utils';
import userService from './user-service';
import accountService from './account-service';
import roleService from './role-service';
import KvConst from '../const/kv-const';
import BizError from '../error/biz-error';
import settingService from './setting-service';
import geminiOAuthService from './gemini-oauth-service';
import { resolveCapabilities } from './gmail-capability-engine';
import { evaluateHealth } from './gmail-health-engine';
import { readAuthToken } from '../security/token-transport';

const encoder = new TextEncoder();

function ownedAccountCapabilitiesSql() {
	return `CASE
	          WHEN provider IN ('gmail', 'google_workspace') AND sync_status IN ('legacy_imap_unsupported', 'needs_reconnect') THEN '{"contract_version":2,"mailbox_lifecycle_state":"needs_reconnect","mailbox_ready":false,"read":false,"send":false,"attachments":false,"threads":false,"labels":false,"legacy_imap_receive_unsupported":true,"token_reference_present":false,"receive_scope_present":false,"send_scope_present":false,"account_ownership_type":"OWNED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"TOKEN_REFERENCE_MISSING","receive_unavailable_reason":"LEGACY_IMAP_UNSUPPORTED","recovery_action":"RECONNECT_OAUTH"}'
	          WHEN provider IN ('gmail', 'google_workspace') AND sync_status IN ('first_import_pending', 'first_import_failed', 'oauth_connected', 'identity_connected', 'import_in_progress', 'importing', 'not_ready') THEN '{"contract_version":2,"mailbox_lifecycle_state":"importing","mailbox_ready":false,"read":false,"send":false,"attachments":false,"threads":false,"labels":false,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"OWNED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"CAPABILITY_NOT_HYDRATED","receive_unavailable_reason":"FIRST_IMPORT_PENDING","recovery_action":"RUN_IMPORT_RECOVERY"}'
	          WHEN provider IN ('gmail', 'google_workspace') AND sync_status = 'mailbox_ready' THEN '{"contract_version":2,"mailbox_lifecycle_state":"mailbox_ready","mailbox_ready":true,"read":true,"send":true,"attachments":true,"threads":true,"labels":true,"restored_capability_rehydrated":true,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":true,"account_ownership_type":"OWNED","backend_send_eligibility":true,"compose_enabled":true,"send_unavailable_reason":"NONE","receive_unavailable_reason":"NONE","recovery_action":"NONE"}'
	          WHEN provider IN ('gmail', 'google_workspace') THEN '{"contract_version":2,"mailbox_lifecycle_state":"importing","mailbox_ready":false,"read":false,"send":false,"attachments":false,"threads":false,"labels":false,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"OWNED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"CAPABILITY_NOT_HYDRATED","receive_unavailable_reason":"MAILBOX_READY_NOT_VERIFIED","recovery_action":"RUN_IMPORT_RECOVERY"}'
	          WHEN sync_status = 'send_scope_missing' THEN '{"contract_version":2,"read":true,"send":false,"attachments":false,"threads":false,"labels":false,"send_scope_missing":true,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"OWNED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"MISSING_SEND_SCOPE"}'
	          WHEN provider = 'cloudflare_native' THEN '{"contract_version":2,"mailbox_lifecycle_state":"mailbox_ready","mailbox_ready":true,"read":true,"send":true,"attachments":true,"threads":true,"labels":true,"restored_capability_rehydrated":true,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":true,"account_ownership_type":"OWNED","backend_send_eligibility":true,"compose_enabled":true,"send_unavailable_reason":"NONE","receive_unavailable_reason":"NONE","recovery_action":"NONE"}'
	          ELSE '{"contract_version":2,"read":true,"send":false,"attachments":false,"threads":false,"labels":false,"token_reference_present":false,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"UNKNOWN","capability_not_hydrated":true,"backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"CAPABILITY_NOT_HYDRATED"}'
	        END`;
}

async function restoreActiveOwnedAccounts(c, userId) {
	const repaired = await c.env.db.prepare(
		`UPDATE account
		    SET is_del = 0
		  WHERE user_id = ?1
		    AND is_del = 1
		    AND LOWER(email) IN (
		      SELECT normalized_email
		        FROM email_identities
		       WHERE user_id = ?1
		         AND status = 'active'
		    )`
	).bind(userId).run();
	const changed = repaired.meta?.changes || 0;
	if (changed > 0) {
		await audit(c, 'account_send_identity_repaired', 'account', 'success', { repaired_count: changed }, userId, 'system');
	}
	return changed;
}

async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function managedDomains(c) {
	const domains = Array.isArray(c.env.domain) ? c.env.domain : JSON.parse(c.env.domain || '[]');
	return domains.map(domain => domain.toLowerCase());
}

function domainOf(email) {
	return email.split('@')[1] || '';
}

function workerName(c) {
	return c.env.CLOUDFLARE_EMAIL_WORKER || c.env.CLOUDFLARE_WORKER_NAME || 'cloud-mail';
}

export function safeMetadata(value = {}) {
	const forbidden = /(password|passcode|otp|secret|token|authorization|credential|verification.?code|activation.?code|body|content|destination)/i;
	if (Array.isArray(value)) return value.map(item => safeMetadata(item));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value)
		.filter(([key]) => !forbidden.test(key))
		.map(([key, item]) => [key, safeMetadata(item)]));
}

async function audit(c, action, resourceType, outcome, metadata = {}, userId = null, actorRole = 'system') {
	await c.env.db.prepare(
		`INSERT INTO audit_logs (user_id, actor_role, action, resource_type, outcome, metadata_json)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
	).bind(userId, actorRole, action, resourceType, outcome, JSON.stringify(safeMetadata(metadata))).run();
}

async function identityAudit(c, eventType, email, outcome, identityId = null, userId = null, metadata = {}) {
	await c.env.db.prepare(
		`INSERT INTO identity_reconciliation_audit
		 (event_type, normalized_email_hash, identity_id, user_id, outcome, metadata_json)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
	).bind(eventType, await sha256(normalizedEmail(email)), identityId, userId, outcome, JSON.stringify(safeMetadata(metadata))).run();
}

async function rateLimit(c, bucket, limit = 12, ttl = 60) {
	const ip = c.req.header('cf-connecting-ip') || 'unknown';
	const key = `cloudmail:rate:${bucket}:${await sha256(ip)}`;
	const current = Number(await c.env.kv.get(key) || 0);
	if (current >= limit) throw new BizError('Request limit reached. Try again shortly.', 429);
	await c.env.kv.put(key, String(current + 1), { expirationTtl: ttl });
}

function ruleMatchers(rule) {
	return Array.isArray(rule?.matchers) ? rule.matchers : [];
}

function ruleActions(rule) {
	return Array.isArray(rule?.actions) ? rule.actions : [];
}

function isLiteralRuleFor(rule, email) {
	return ruleMatchers(rule).some(matcher =>
		matcher?.type === 'literal' && matcher?.field === 'to' && normalizedEmail(matcher.value) === email
	);
}

function isCatchAllRule(rule) {
	return ruleMatchers(rule).some(matcher => matcher?.type === 'all');
}

function actionValues(action) {
	if (!action) return [];
	if (Array.isArray(action.value)) return action.value;
	if (action.value === undefined || action.value === null) return [];
	return [action.value];
}

function forwardingDestinationsFromRule(rule) {
	return ruleActions(rule)
		.filter(action => action?.type === 'forward')
		.flatMap(actionValues)
		.map(normalizedEmail)
		.filter(Boolean);
}

function isWorkerRule(rule, c) {
	const expected = workerName(c);
	return ruleActions(rule).some(action =>
		action?.type === 'worker' && actionValues(action).some(value => String(value) === expected)
	);
}

function workerAction(c) {
	return { type: 'worker', value: [workerName(c)] };
}

function routingRuleBody(c, email, enabled = true, namePrefix = 'CloudMail') {
	return {
		enabled,
		name: `${namePrefix} ${email}`,
		matchers: [{ type: 'literal', field: 'to', value: email }],
		actions: [workerAction(c)],
		priority: 0
	};
}

async function cfRoutingRequest(c, path, options = {}) {
	const token = c.env.CLOUDFLARE_API_TOKEN;
	const zoneId = c.env.CLOUDFLARE_ZONE_ID;
	if (!token || !zoneId) throw new BizError('Cloudflare routing API is not configured.', 503);
	const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing${path}`, {
		...options,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			...(options.headers || {})
		}
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.success === false) {
		throw new BizError(`Cloudflare routing API failed: ${response.status}`, response.status);
	}
	return payload.result ?? payload;
}

async function listRoutingRules(c) {
	const token = c.env.CLOUDFLARE_API_TOKEN;
	const zoneId = c.env.CLOUDFLARE_ZONE_ID;
	if (!token || !zoneId) return { configured: false, rules: [], source: 'd1_cache' };
	try {
		const result = await cfRoutingRequest(c, '/rules');
		return { configured: true, rules: Array.isArray(result) ? result : [], source: 'cloudflare_api' };
	} catch (error) {
		await audit(c, 'routing_sync', 'email_identity', 'api_error', { status: error.code || 500 });
		return { configured: true, rules: [], source: 'd1_cache_error_fallback', error };
	}
}

async function preserveForwardingDestinations(c, sourceEmail, rule) {
	const destinations = forwardingDestinationsFromRule(rule);
	for (const destination of destinations) {
		await c.env.db.prepare(
			`INSERT INTO email_forwarding_destinations
			 (source_email, normalized_source_email, domain, destination_email, destination_verified,
			  forwarding_enabled, preserve_original_forwarding, source_rule_id)
			 VALUES (?1, ?1, ?2, ?3, 1, 1, 1, ?4)
			 ON CONFLICT(normalized_source_email, destination_email) DO UPDATE SET
			   forwarding_enabled = 1,
			   preserve_original_forwarding = 1,
			   source_rule_id = excluded.source_rule_id,
			   updated_at = CURRENT_TIMESTAMP`
		).bind(sourceEmail, domainOf(sourceEmail), destination, rule?.id || null).run();
	}
	return destinations;
}

async function routingLookup(c, email) {
	const cached = await c.env.db.prepare(
		`SELECT * FROM email_identities
		  WHERE normalized_email = ?1 AND source = 'cloudflare_routing'
		  LIMIT 1`
	).bind(email).first();
	const listed = await listRoutingRules(c);
	const explicit = listed.rules.find(rule => isLiteralRuleFor(rule, email)) || null;
	const configuredCatchAll = String(c.env.CLOUDFLARE_CATCH_ALL_ENABLED || '').toLowerCase() === 'true'
		? {
			id: c.env.CLOUDFLARE_CATCH_ALL_RULE_ID || null,
			enabled: true,
			matchers: [{ type: 'all' }],
			actions: [workerAction(c)]
		}
		: null;
	const catchAll = listed.rules.find(rule => rule.enabled && isCatchAllRule(rule)) || configuredCatchAll;
	return {
		cached,
		live: explicit,
		catchAll,
		source: listed.source,
		configured: listed.configured,
		rules: listed.rules
	};
}

async function upsertRoutingIdentity(c, email, rule, status = null) {
	const domain = domainOf(email);
	const ruleId = rule?.id || null;
	const destinations = await preserveForwardingDestinations(c, email, rule);
	const nextStatus = status || (rule?.enabled ? 'routing_only' : 'disabled_routing');
	await c.env.db.prepare(
		`INSERT INTO email_identities
		 (email, normalized_email, domain, source, routing_rule_id, routing_enabled,
		  forwarding_preserved, status, last_synced_at)
		 VALUES (?1, ?1, ?2, 'cloudflare_routing', ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
		 ON CONFLICT(normalized_email) DO UPDATE SET
		   routing_rule_id = excluded.routing_rule_id,
		   routing_enabled = excluded.routing_enabled,
		   forwarding_preserved = excluded.forwarding_preserved,
		   status = CASE WHEN email_identities.status = 'active' THEN 'active' ELSE excluded.status END,
		   last_synced_at = CURRENT_TIMESTAMP,
		   updated_at = CURRENT_TIMESTAMP`
	).bind(email, domain, ruleId, rule?.enabled ? 1 : 0, destinations.length > 0 ? 1 : 0, nextStatus).run();
	return c.env.db.prepare(
		'SELECT * FROM email_identities WHERE normalized_email = ?1'
	).bind(email).first();
}

async function markCatchAllEligible(c, email, catchAllRule) {
	const domain = domainOf(email);
	await c.env.db.prepare(
		`INSERT INTO email_identities
		 (email, normalized_email, domain, source, routing_rule_id, routing_enabled,
		  forwarding_preserved, status, last_synced_at)
		 VALUES (?1, ?1, ?2, 'cloudflare_routing', ?3, 1, 0, 'catch_all_eligible', CURRENT_TIMESTAMP)
		 ON CONFLICT(normalized_email) DO UPDATE SET
		   routing_rule_id = COALESCE(email_identities.routing_rule_id, excluded.routing_rule_id),
		   routing_enabled = CASE WHEN email_identities.status = 'active' THEN email_identities.routing_enabled ELSE 1 END,
		   status = CASE WHEN email_identities.status = 'active' THEN 'active' ELSE 'catch_all_eligible' END,
		   last_synced_at = CURRENT_TIMESTAMP,
		   updated_at = CURRENT_TIMESTAMP`
	).bind(email, domain, catchAllRule?.id || null).run();
	return c.env.db.prepare('SELECT * FROM email_identities WHERE normalized_email = ?1').bind(email).first();
}

async function updateRoutingRuleToWorker(c, rule, email) {
	return cfRoutingRequest(c, `/rules/${rule.id}`, {
		method: 'PUT',
		body: JSON.stringify({
			enabled: true,
			name: rule?.name || `CloudMail ${email}`,
			matchers: [{ type: 'literal', field: 'to', value: email }],
			actions: [workerAction(c)],
			priority: Number.isFinite(rule?.priority) ? rule.priority : 0
		})
	});
}

async function createRoutingRuleToWorker(c, email) {
	return cfRoutingRequest(c, '/rules', {
		method: 'POST',
		body: JSON.stringify(routingRuleBody(c, email, true))
	});
}

async function ensureCloudflareRoutingRule(c, rawEmail, userId = null) {
	const email = normalizedEmail(rawEmail);
	if (!email.includes('@') || !managedDomains(c).includes(domainOf(email))) {
		throw new BizError('Cloudflare Email Routing is only managed for CloudMail domains.', 400);
	}

	const listed = await listRoutingRules(c);
	if (!listed.configured) {
		await audit(c, 'cloudflare_routing_rule_setup_failed', 'email_identity', 'cloudflare_api_not_configured', { emailDomain: domainOf(email) }, userId);
		return { routingCreated: false, action: 'cloudflare_api_not_configured', ruleId: null, forwardingPreserved: false };
	}
	if (listed.error) throw listed.error;

	const explicit = listed.rules.find(rule => isLiteralRuleFor(rule, email)) || null;
	let rule = explicit;
	let action = 'created_worker_rule';
	let destinations = [];

	if (explicit) {
		destinations = await preserveForwardingDestinations(c, email, explicit);
		if (explicit.enabled && isWorkerRule(explicit, c)) {
			action = 'already_exists_enabled';
		} else {
			rule = await updateRoutingRuleToWorker(c, explicit, email);
			action = explicit.enabled ? 'migrated_forward_to_worker' : 'migrated_and_enabled_existing_rule';
		}
	} else {
		rule = await createRoutingRuleToWorker(c, email);
		action = 'created_worker_rule';
	}

	await c.env.db.prepare(
		`INSERT INTO email_identities
		 (email, normalized_email, domain, source, routing_rule_id, routing_enabled,
		  forwarding_preserved, user_id, status, last_synced_at)
		 VALUES (?1, ?1, ?2, 'cloudflare_routing', ?3, 1, ?4, ?5, ?6, CURRENT_TIMESTAMP)
		 ON CONFLICT(normalized_email) DO UPDATE SET
		   routing_rule_id = excluded.routing_rule_id,
		   routing_enabled = 1,
		   forwarding_preserved = excluded.forwarding_preserved,
		   user_id = COALESCE(excluded.user_id, email_identities.user_id),
		   status = CASE WHEN excluded.user_id IS NOT NULL THEN 'active'
		                 WHEN email_identities.status = 'active' THEN 'active'
		                 ELSE 'routing_only' END,
		   last_synced_at = CURRENT_TIMESTAMP,
		   updated_at = CURRENT_TIMESTAMP`
	).bind(email, domainOf(email), rule?.id || explicit?.id || null, destinations.length > 0 ? 1 : 0, userId, userId ? 'active' : 'routing_only').run();

	await identityAudit(c, 'routing_write_back', email, action, null, userId, {
		ruleId: rule?.id || explicit?.id || null,
		forwardingPreserved: destinations.length > 0
	});
	if (destinations.length) {
		await identityAudit(c, 'forwarding_preserved', email, 'preserved', null, userId, {
			ruleId: rule?.id || explicit?.id || null,
			count: destinations.length
		});
	}

	return {
		routingCreated: true,
		action,
		ruleId: rule?.id || explicit?.id || null,
		forwardingPreserved: destinations.length > 0,
		forwardingDestinationCount: destinations.length
	};
}

async function authHandoffAudit(c, eventType, challenge, outcome, userId = null) {
	await audit(c, eventType, 'secure_auth_handoff', outcome, {
		provider: challenge.provider,
		purpose: challenge.purpose
	}, userId, 'system');
}

function normalizedProvider(value) {
	return String(value || 'cloudmail').trim().toLowerCase().slice(0, 80);
}

export function activeContinuationOutcome(discovery = {}) {
	if (discovery.accountStatus !== 'active') return null;
	if (!discovery.routingRuleEnabled || !discovery.accountOwnedByPrincipal || !discovery.identityActive) {
		const blocker = !discovery.accountOwnedByPrincipal
			? 'MAILBOX_ACCOUNT_NOT_OWNED'
			: !discovery.identityActive
				? 'MAILBOX_IDENTITY_NOT_ACTIVE'
				: 'MAILBOX_ROUTING_NOT_READY';
		return {
			status: 'blocked',
			recommendedAction: 'routing_validation_required',
			message: 'Authentication succeeded, but mailbox ownership, identity, and routing health are not all verified.',
			mailboxReady: false,
			healthState: 'BLOCKED',
			blocker
		};
	}
	return {
		status: 'ready',
		recommendedAction: 'mailbox_ready',
		message: 'Mailbox is active and ready.',
		mailboxReady: true,
		healthState: 'HEALTHY',
		blocker: null
	};
}

async function observedMailboxReadiness(c, userId, email) {
	const row = await c.env.db.prepare(
		`SELECT a.account_id, a.provider, e.id AS identity_id, e.status AS identity_status,
		        e.routing_enabled, e.user_id AS identity_user_id
		   FROM account a
		   JOIN email_identities e ON lower(e.normalized_email) = lower(a.email)
		  WHERE a.user_id = ?1 AND a.is_del = 0 AND lower(a.email) = ?2
		  LIMIT 1`
	).bind(userId, email).first();
	return {
		accountOwnedByPrincipal: Boolean(row?.account_id),
		identityActive: row?.identity_status === 'active' && Number(row?.identity_user_id) === Number(userId),
		routingRuleEnabled: Boolean(row?.routing_enabled)
	};
}

function authSessionReference(c, userId) {
	const sessionToken = readAuthToken(c) || '';
	return sha256(`${userId}:${sessionToken.slice(0, 256)}`);
}

async function loadAuthRecord(c, rawReference) {
	if (!rawReference) throw new BizError('Authentication handoff expired. Start again in the app.', 401);
	const referenceHash = await sha256(String(rawReference));
	const row = await c.env.db.prepare(
		`SELECT target_email, domain, provider, purpose, expires_at, nonce, device_reference_hash,
		        state, user_id, session_reference_hash
		   FROM secure_auth_handoffs WHERE reference_hash = ?1 LIMIT 1`
	).bind(referenceHash).first();
	if (!row || !row.nonce || row.purpose !== 'mailbox_provisioning' || Number(row.expires_at) <= Date.now()) {
		throw new BizError('Authentication handoff expired. Start again in the app.', 401);
	}
	const challenge = {
		email: normalizedEmail(row.target_email),
		domain: row.domain,
		provider: row.provider,
		purpose: row.purpose,
		expiresAt: Number(row.expires_at),
		nonce: row.nonce,
		deviceReferenceHash: row.device_reference_hash
	};
	return { challenge, referenceHash, row };
}

async function loadAuthChallenge(c, rawReference) {
	const record = await loadAuthRecord(c, rawReference);
	if (record.row.state !== 'CHALLENGE') throw new BizError('Authentication handoff was already used.', 409);
	return record;
}

export async function beginProvisioningAuthHandoff(c, rawEmail, input = {}) {
	await rateLimit(c, 'provisioning-auth-handoff', 8, 300);
	const email = normalizedEmail(rawEmail);
	const domain = domainOf(email);
	if (!email.includes('@') || !domain) throw new BizError('A valid mailbox email is required.', 400);
	const suppliedDomain = String(input.domain || domain).trim().toLowerCase();
	if (suppliedDomain !== domain) throw new BizError('Mailbox domain does not match the authentication request.', 400);
	const deviceReference = String(input.deviceReference || '').trim();
	if (!deviceReference) throw new BizError('A device reference is required for secure authentication.', 400);
	const challengeReference = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	const referenceHash = await sha256(challengeReference);
	const challenge = {
		email,
		domain,
		provider: normalizedProvider(input.provider),
		purpose: 'mailbox_provisioning',
		expiresAt: Date.now() + 10 * 60 * 1000,
		nonce: crypto.randomUUID().replaceAll('-', ''),
		deviceReferenceHash: await sha256(deviceReference)
	};
	await c.env.db.prepare(
		`INSERT INTO secure_auth_handoffs
		 (reference_hash, target_email, domain, provider, purpose, nonce, device_reference_hash, state, expires_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'CHALLENGE', ?8)`
	).bind(referenceHash, challenge.email, challenge.domain, challenge.provider, challenge.purpose,
		challenge.nonce, challenge.deviceReferenceHash, challenge.expiresAt).run();
	await authHandoffAudit(c, 'auth_required', challenge, 'required');
	return { challengeReference, expiresAt: new Date(challenge.expiresAt).toISOString(), purpose: challenge.purpose };
}

export async function recordProvisioningAuthAttempt(c, rawReference, outcome) {
	if (!rawReference) return;
	try {
		const { challenge } = await loadAuthChallenge(c, rawReference);
		const eventType = outcome === 'started' ? 'auth_started' : 'auth_failed';
		await authHandoffAudit(c, eventType, challenge, outcome === 'started' ? 'started' : 'rejected');
	} catch {
		// Authentication must not be made less safe or reveal challenge state merely
		// because best-effort audit correlation has expired.
	}
}

async function principalMayProvisionTarget(c, user, email) {
	if (normalizedEmail(user.email) === email) return true;
	if (normalizedEmail(c.env.admin) === normalizedEmail(user.email)) return true;
	const owned = await c.env.db.prepare(
		`SELECT 1 FROM account
		  WHERE user_id = ?1 AND is_del = 0 AND lower(email) = ?2
		  LIMIT 1`
	).bind(user.userId, email).first();
	return Boolean(owned);
}

export async function createProvisioningContinuation(c, rawEmail, input = {}) {
	const user = c.get('user');
	if (!user?.userId) throw new BizError('Authenticated session required.', 401);
	const { challenge, referenceHash, row } = await loadAuthRecord(c, input.challengeReference);
	const email = normalizedEmail(rawEmail || challenge.email);
	const domain = domainOf(email);
	const provider = normalizedProvider(input.provider || challenge.provider);
	const deviceReference = String(input.deviceReference || '').trim();
	if (!deviceReference) throw new BizError('A device reference is required for secure authentication.', 400);
	const deviceReferenceHash = await sha256(deviceReference);
	if (email !== challenge.email || domain !== challenge.domain || provider !== challenge.provider || deviceReferenceHash !== challenge.deviceReferenceHash) {
		await authHandoffAudit(c, 'auth_failed', challenge, 'binding_mismatch', user.userId);
		throw new BizError('Authentication handoff does not match this provisioning request.', 403);
	}
	if (!await principalMayProvisionTarget(c, user, email)) {
		await authHandoffAudit(c, 'auth_failed', challenge, 'target_not_authorized', user.userId);
		throw new BizError('Authenticated account cannot provision this mailbox.', 403);
	}
	const sessionReference = await authSessionReference(c, user.userId);
	const isRenewal = row.state === 'CONTINUATION' || row.state === 'CONSUMED';
	if (isRenewal && (Number(row.user_id) !== Number(user.userId) || row.session_reference_hash !== sessionReference)) {
		throw new BizError('Provisioning continuation cannot be resumed from this session.', 403);
	}
	if (!isRenewal && row.state !== 'CHALLENGE') {
		throw new BizError('Authentication handoff cannot be resumed.', 409);
	}
	const purpose = challenge.purpose;
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const continuationToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
	const tokenHash = await sha256(continuationToken);
	const payload = {
		userId: user.userId,
		email,
		domain,
		provider,
		purpose,
		expiresAt: challenge.expiresAt,
		nonce,
		deviceReferenceHash,
		sessionReference
	};
	const claimed = isRenewal
		? await c.env.db.prepare(
			`UPDATE secure_auth_handoffs
			    SET continuation_hash = ?1, state = 'CONTINUATION', consumed_at = NULL, updated_at = CURRENT_TIMESTAMP
			  WHERE reference_hash = ?2 AND state IN ('CONTINUATION','CONSUMED')
			    AND user_id = ?3 AND session_reference_hash = ?4 AND expires_at > ?5`
		).bind(tokenHash, referenceHash, user.userId, sessionReference, Date.now()).run()
		: await c.env.db.prepare(
			`UPDATE secure_auth_handoffs
			    SET continuation_hash = ?1, user_id = ?2, session_reference_hash = ?3,
			        state = 'CONTINUATION', updated_at = CURRENT_TIMESTAMP
			  WHERE reference_hash = ?4 AND state = 'CHALLENGE' AND expires_at > ?5`
		).bind(tokenHash, user.userId, payload.sessionReference, referenceHash, Date.now()).run();
	if (Number(claimed.meta?.changes || claimed.changes || 0) !== 1) {
		throw new BizError('Authentication handoff was already used or expired.', 409);
	}
	if (!isRenewal) await authHandoffAudit(c, 'auth_success', challenge, 'success', user.userId);
	return { continuationToken, expiresAt: new Date(payload.expiresAt).toISOString(), purpose };
}

export async function consumeProvisioningContinuation(c, rawToken, email, input = {}) {
	if (!rawToken) return false;
	const user = c.get('user');
	if (!user?.userId) throw new BizError('Authenticated session required.', 401);
	const tokenHash = await sha256(String(rawToken));
	const row = await c.env.db.prepare(
		`SELECT target_email, domain, provider, purpose, nonce, device_reference_hash,
		        user_id, session_reference_hash, expires_at, state
		   FROM secure_auth_handoffs WHERE continuation_hash = ?1 LIMIT 1`
	).bind(tokenHash).first();
	if (!row || row.state !== 'CONTINUATION') throw new BizError('Provisioning continuation expired. Authenticate again in the app.', 401);
	const payload = {
		userId: row.user_id,
		email: normalizedEmail(row.target_email),
		domain: row.domain,
		provider: row.provider,
		purpose: row.purpose,
		nonce: row.nonce,
		deviceReferenceHash: row.device_reference_hash,
		sessionReference: row.session_reference_hash,
		expiresAt: Number(row.expires_at)
	};
	const deviceReference = String(input.deviceReference || '').trim();
	if (!deviceReference) throw new BizError('A device reference is required for secure authentication.', 400);
	const deviceReferenceHash = await sha256(deviceReference);
	const sessionReference = await authSessionReference(c, user.userId);
	const expectedProvider = normalizedProvider(input.provider || payload.provider);
	if (Number(payload.userId) !== Number(user.userId) ||
		normalizedEmail(payload.email) !== normalizedEmail(email) ||
		payload.domain !== domainOf(normalizedEmail(email)) ||
		payload.provider !== expectedProvider ||
		payload.purpose !== 'mailbox_provisioning' ||
		!payload.nonce ||
		payload.deviceReferenceHash !== deviceReferenceHash ||
		payload.sessionReference !== sessionReference ||
		payload.expiresAt <= Date.now()) {
		throw new BizError('Provisioning continuation is not valid for this session.', 403);
	}
	const consumed = await c.env.db.prepare(
		`UPDATE secure_auth_handoffs
		    SET state = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		  WHERE continuation_hash = ?1 AND state = 'CONTINUATION' AND expires_at > ?2`
	).bind(tokenHash, Date.now()).run();
	if (Number(consumed.meta?.changes || consumed.changes || 0) !== 1) {
		throw new BizError('Provisioning continuation expired or was already used.', 401);
	}
	await audit(c, 'provisioning_resumed', 'secure_auth_handoff', 'resumed', {
		provider: payload.provider,
		purpose: payload.purpose
	}, user.userId, 'system');
	return true;
}

async function sendActivationEmail(c, email, activationToken) {
	let resendToken = c.env.IDENTITY_RESEND_TOKEN;
	let from = c.env.IDENTITY_FROM_EMAIL;
	if (!resendToken) {
		const settings = await settingService.query(c);
		resendToken = settings.resendTokens?.[domainOf(email)];
		from ||= `CloudMail <no-reply@${domainOf(email)}>`;
	}
	if (!resendToken || !from) return { delivered: false, provider: null };
	const origin = new URL(c.req.url).origin;
	const activationLink = `${origin}/activate?token=${encodeURIComponent(activationToken)}`;
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${resendToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to: [email],
			subject: 'Activate your CloudMail account',
			html: `<p>Use this secure link to activate CloudMail:</p><p><a href="${activationLink}">Activate CloudMail</a></p><p>This link expires in 30 minutes.</p>`
		})
	});
	return { delivered: response.ok, provider: 'resend' };
}

const cloudMailV2Service = {
	async discover(c, rawEmail) {
		await rateLimit(c, 'identity-discovery');
		const email = normalizedEmail(rawEmail);
		const domain = domainOf(email);
		const domainManaged = email.includes('@') && managedDomains(c).includes(domain);
		// Discovery is domain-first. Exact user/account lookup is retained only
		// as a secondary identity and mailbox signal after routing/authority
		// discovery has run.
		const routing = await routingLookup(c, email);
		let identity = await c.env.db.prepare(
			'SELECT * FROM email_identities WHERE normalized_email = ?1'
		).bind(email).first();
		const pending = await c.env.db.prepare(
			`SELECT * FROM pending_users WHERE email = ?1 AND status = 'pending' AND expires_at > ?2`
		).bind(email, Date.now()).first();
			if (routing.live) identity = await upsertRoutingIdentity(c, email, routing.live);
			const explicitEnabled = Boolean(routing.live?.enabled);
			const explicitExists = Boolean(routing.live || routing.cached?.routing_rule_id);
			const catchAllEligible = Boolean(!explicitExists && routing.catchAll?.enabled);
			if (!identity && catchAllEligible) identity = await markCatchAllEligible(c, email, routing.catchAll);
			const routingExists = Boolean(explicitExists || catchAllEligible || (routing.cached?.routing_enabled && routing.cached?.status !== 'stale'));
			const forwardingPreserved = Boolean(identity?.forwarding_preserved);

			const user = await userService.selectByEmailIncludeDel(c, email);
			const exactAccount = await accountService.selectByEmailIncludeDel(c, email);
			let accountStatus = 'not_found';
			let recommendedAction = 'not_found';
			let discoveryState = domain ? 'DOMAIN_FOUND' : 'PROVIDER_UNSUPPORTED';
			const provider = domain === 'gmail.com' || domain === 'googlemail.com'
				? 'google_gmail'
				: domainManaged || routingExists ? 'cloudflare_routing' : 'custom_domain';
			const authorityState = domainManaged || routingExists ? 'AUTHORITY_FOUND' : 'AUTHORITY_REQUIRED';
			const identityState = user && !user.isDel
				? 'IDENTITY_FOUND'
				: identity?.status === 'active' || pending ? 'IDENTITY_FOUND' : 'IDENTITY_PENDING';
			if (user && !user.isDel) {
				accountStatus = 'active';
				recommendedAction = 'login';
				discoveryState = 'MAILBOX_ACTIVE';
			} else if (identity?.status === 'active' && identity.user_id) {
				accountStatus = 'active';
				recommendedAction = 'login';
				discoveryState = 'MAILBOX_ACTIVE';
			} else if (pending) {
				accountStatus = 'pending';
				recommendedAction = 'set_password';
				discoveryState = 'MAILBOX_ACTIVATABLE';
			} else if ((routing.live && !routing.live.enabled) || identity?.status === 'disabled_routing') {
				accountStatus = 'disabled_routing';
				recommendedAction = 'contact_admin_enable_routing';
				discoveryState = 'AUTHORITY_REQUIRED';
			} else if (catchAllEligible || identity?.status === 'catch_all_eligible') {
				accountStatus = 'catch_all_eligible';
				recommendedAction = 'activate_from_catch_all';
				discoveryState = 'MAILBOX_ACTIVATABLE';
			} else if (routingExists || identity?.status === 'routing_only') {
				accountStatus = 'routing_only';
				recommendedAction = 'create_pending_user';
				discoveryState = 'DOMAIN_READY';
			} else if (domain) {
				recommendedAction = domainManaged ? 'authority_required' : 'provider_authorization_required';
				discoveryState = domainManaged ? 'AUTHORITY_REQUIRED' : 'DOMAIN_FOUND';
			}
			await identityAudit(c, 'email_discovery', email, accountStatus, identity?.id, user?.userId, {
				lookupSource: routing.source
			});
			let message = 'Domain discovered. Continue with authority and mailbox discovery.';
			if (accountStatus === 'routing_only' || accountStatus === 'pending') {
				message = '该邮箱已存在于你的域名邮箱系统中，请在 NEXORA 中继续激活。';
			} else if (accountStatus === 'disabled_routing') {
				message = '该邮箱的收件路由已被其基础设施提供商停用。NEXORA 将尝试修复；如果提供商要求重新授权，会在 App 内通知你。';
			} else if (accountStatus === 'catch_all_eligible') {
				message = '该邮箱属于已发现的自定义域，并由全收规则覆盖。请继续激活。';
			}
			return {
				existsInGlassMailUsers: Boolean(user && !user.isDel),
				existsInEmailIdentities: Boolean(identity),
				existsInCloudflareRouting: routingExists,
				domainManaged,
				routingRuleEnabled: Boolean(identity?.routing_enabled || explicitEnabled),
				catchAllEligible,
				forwardingPreserved,
				domain,
				provider,
				discoveryState,
				authorityState,
				identityState,
				mailboxState: exactAccount ? (accountStatus === 'active' ? 'MAILBOX_ACTIVE' : 'IDENTITY_FOUND') : discoveryState,
				nextAction: recommendedAction,
				accountStatus,
				recommendedAction,
				message
			};
		},

	async bootstrap(c, rawEmail, continuationToken = null, continuationContext = {}) {
		await rateLimit(c, 'identity-bootstrap', 5, 300);
		const email = normalizedEmail(rawEmail);
		await consumeProvisioningContinuation(c, continuationToken, email, continuationContext);
		const discovery = await this.discover(c, email);
			if (discovery.accountStatus === 'active') {
				if (continuationToken) {
					const observed = await observedMailboxReadiness(c, c.get('user')?.userId, email);
					return activeContinuationOutcome({ ...discovery, ...observed });
				}
				return { status: 'active', recommendedAction: 'login' };
			}
			if (!['routing_only', 'pending', 'disabled_routing', 'catch_all_eligible'].includes(discovery.accountStatus)) {
				return {
					status: 'blocked',
					recommendedAction: 'provider_authorization_required',
					message: 'Provider authorization is required before provisioning can continue.',
					mailboxReady: false,
					healthState: 'BLOCKED',
					blocker: 'PROVIDER_AUTHORIZATION_REQUIRED'
				};
			}
			let identity = await c.env.db.prepare(
				'SELECT * FROM email_identities WHERE normalized_email = ?1'
			).bind(email).first();
			if (!identity) throw new BizError('Activation cannot be confirmed for this address.', 400);
			const routingSetup = await ensureCloudflareRoutingRule(c, email);
			identity = await c.env.db.prepare(
				'SELECT * FROM email_identities WHERE normalized_email = ?1'
			).bind(email).first();

			const activationToken = crypto.randomUUID().replaceAll('-', '');
		const tokenHash = await sha256(activationToken);
		const expiresAt = Date.now() + 30 * 60 * 1000;
		await c.env.db.prepare(
			`INSERT INTO pending_users (email, domain, identity_id, activation_token_hash, expires_at, status)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'pending')
			 ON CONFLICT(email) DO UPDATE SET
			   identity_id = excluded.identity_id,
			   activation_token_hash = excluded.activation_token_hash,
			   expires_at = excluded.expires_at,
			   status = 'pending',
			   created_at = CURRENT_TIMESTAMP`
		).bind(email, domainOf(email), identity.id, tokenHash, expiresAt).run();
		await c.env.kv.put(`cloudmail:activation:${tokenHash}`, email, { expirationTtl: 1800 });
		await c.env.db.prepare(
			`UPDATE email_identities SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
		).bind(identity.id).run();
		const delivery = await sendActivationEmail(c, email, activationToken);
		if (!delivery.delivered && c.env.IDENTITY_E2E_MODE !== 'true') {
			await identityAudit(c, 'pending_user_created', email, 'delivery_failed', identity.id);
			throw new BizError('Activation email could not be delivered. Please try again shortly.', 503);
		}
		await identityAudit(c, 'pending_user_created', email, 'created', identity.id);
		const response = {
			status: continuationToken ? 'blocked' : 'pending',
			recommendedAction: continuationToken ? 'provider_activation_required' : 'set_password',
				message: delivery.delivered
					? 'Mailbox provisioning continued. Provider security requires activation from the secure link sent to this mailbox.'
					: 'Mailbox provisioning continued, but provider activation is still required.',
			mailboxReady: false,
			healthState: continuationToken ? 'BLOCKED' : undefined,
			blocker: continuationToken ? 'PROVIDER_ACTIVATION_REQUIRED' : undefined,
			routingSetup
		};
		// Never return the bearer activation secret in production responses. A
		// test-only escape hatch is explicit, opt-in, and cannot be enabled by
		// merely setting the broad E2E mode flag.
		if (c.env.IDENTITY_E2E_MODE === 'true' && c.env.IDENTITY_E2E_EXPOSE_TOKEN === 'true') {
			response.activationToken = activationToken;
		}
		return response;
		},

	async activate(c, token, password) {
		await rateLimit(c, 'identity-activate', 8, 300);
		if (!token || !password || password.length < 8) throw new BizError('Invalid activation request.', 400);
		const tokenHash = await sha256(token);
		const pending = await c.env.db.prepare(
			`SELECT pending_users.*, email_identities.id AS linked_identity_id
			   FROM pending_users JOIN email_identities ON email_identities.id = pending_users.identity_id
			  WHERE activation_token_hash = ?1 AND pending_users.status = 'pending' AND expires_at > ?2`
		).bind(tokenHash, Date.now()).first();
		if (!pending) throw new BizError('Invalid or expired activation token.', 400);
		const existing = await userService.selectByEmailIncludeDel(c, pending.email);
		let userId = existing?.userId;
		let accountRow;
		if (!userId) {
			const role = await roleService.selectDefaultRole(c);
			const passwordRecord = await cryptoUtils.hashPassword(password);
			userId = await userService.insert(c, {
				email: pending.email,
				password: passwordRecord.hash,
				salt: passwordRecord.salt,
				type: role.roleId
			});
			accountRow = await accountService.insert(c, {
				userId,
				email: pending.email,
				name: pending.email.split('@')[0]
			});
			await userService.updateUserInfo(c, userId, true);
		} else {
			await userService.resetPassword(c, { password }, userId);
			accountRow = await accountService.selectByEmailIncludeDel(c, pending.email);
			if (!accountRow) {
				accountRow = await accountService.insert(c, {
					userId,
					email: pending.email,
					name: pending.email.split('@')[0]
				});
			} else if (accountRow.isDel) {
				await accountService.restoreByIdForUser(c, accountRow.accountId, userId);
				accountRow = await accountService.selectByIdForUser(c, accountRow.accountId, userId);
			}
		}
			const cachedMailFilter =
				`user_id = 0 AND account_id = 0 AND lower(to_email) = lower(?3)`;
			await c.env.db.batch([
				c.env.db.prepare(
					`UPDATE pending_users SET status = 'activated', activated_at = CURRENT_TIMESTAMP WHERE id = ?1`
				).bind(pending.id),
			c.env.db.prepare(
				`UPDATE email_identities SET user_id = ?1, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?2`
			).bind(userId, pending.identity_id),
			c.env.db.prepare(
				`UPDATE attachments SET user_id = ?1, account_id = ?2
				  WHERE email_id IN (SELECT email_id FROM email WHERE ${cachedMailFilter})`
			).bind(userId, accountRow.accountId, pending.email),
			c.env.db.prepare(
				`UPDATE email SET user_id = ?1, account_id = ?2, status = 0
				  WHERE ${cachedMailFilter}`
			).bind(userId, accountRow.accountId, pending.email)
			]);
			await ensureCloudflareRoutingRule(c, pending.email, userId);
			await c.env.kv.delete(`cloudmail:activation:${tokenHash}`);
			await identityAudit(c, 'user_activated', pending.email, 'activated', pending.identity_id, userId);
			return { status: 'active', recommendedAction: 'login', email: pending.email };
		},

	async consent(c, userId) {
		await c.env.db.prepare(
			`INSERT INTO ai_consents (user_id) VALUES (?1) ON CONFLICT(user_id) DO NOTHING`
		).bind(userId).run();
		return c.env.db.prepare('SELECT * FROM ai_consents WHERE user_id = ?1').bind(userId).first();
	},

	async updateConsent(c, userId, params) {
		const allowed = [
			'ai_enabled', 'apple_local_enabled', 'cloud_ai_enabled', 'single_mail_read',
			'thread_read', 'attachment_read', 'save_outputs', 'search_index', 'auto_classify',
			'cleanup_suggestions', 'auto_send', 'auto_delete', 'auto_archive', 'auto_unsubscribe'
		];
		const updates = Object.entries(params).filter(([key]) => allowed.includes(key));
		await this.consent(c, userId);
		for (const [key, value] of updates) {
			await c.env.db.prepare(
				`UPDATE ai_consents SET ${key} = ?1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?2`
			).bind(value ? 1 : 0, userId).run();
		}
		await audit(c, 'ai_consent_updated', 'ai_consent', 'success', { fields: updates.map(([key]) => key) }, userId, 'user');
		return this.consent(c, userId);
	},

	async providerReadiness(c, userId) {
		const consent = await this.consent(c, userId);
		const gemini = await geminiOAuthService.status(c, userId);
		const googleMailbox = gemini.authorized && gemini.accountEmail ? await c.env.db.prepare(
			`SELECT account_id, email, provider
			   FROM account
			  WHERE user_id = ?1
			    AND is_del = 0
			    AND provider IN ('gmail', 'google_workspace')
			    AND LOWER(email) = LOWER(?2)
			  LIMIT 1`
		).bind(userId, gemini.accountEmail).first() : null;
		const geminiAutoAvailable = Boolean(gemini.authorized && googleMailbox);
		return {
			apple_local: { configured: true, local: true, authorized: Boolean(consent.apple_local_enabled) },
			apple_foundation_models: { configured: true, local: true, authorized: Boolean(consent.apple_local_enabled) },
			openai_chatgpt: {
				configured: false,
				local: false,
				authorized: false,
				reason: 'account_authorization_unavailable'
			},
			google_gemini: {
				configured: gemini.configured,
				local: false,
				authorized: Boolean(gemini.authorized),
				available: Boolean(gemini.authorized),
				auto_connected_via_google_mailbox: geminiAutoAvailable,
				second_login_required: !gemini.authorized,
				reason: geminiAutoAvailable ? 'connected_via_google_account' : gemini.reason || gemini.status,
				account_email: gemini.accountEmail || null,
				mailbox_account_id: googleMailbox?.account_id || null,
				cross_account_access: false,
				billing_owner: 'user',
				provider_ownership: 'user_owned',
				shared_platform_api_key: false
			},
			anthropic_claude: { configured: false, local: false, authorized: false, reason: 'not_available' },
			mock_disabled: { configured: false, local: true, authorized: false }
		};
	},

	async accounts(c, userId) {
		await restoreActiveOwnedAccounts(c, userId);
		const rows = await c.env.db.prepare(
			`WITH ranked_accounts AS (
			   SELECT a.*,
			          ROW_NUMBER() OVER (
			            PARTITION BY
			              CASE WHEN provider IN ('gmail','google_workspace') THEN LOWER(email) ELSE CAST(account_id AS TEXT) END
			            ORDER BY
			              CASE WHEN provider IN ('gmail','google_workspace') AND sync_status = 'mailbox_ready' THEN 0 ELSE 1 END,
			              CASE WHEN provider IN ('gmail','google_workspace') AND EXISTS (
			                SELECT 1 FROM mail_provider_credentials mpc
			                 WHERE mpc.user_id = a.user_id
			                   AND mpc.account_id = a.account_id
			                   AND mpc.provider IN ('gmail','google_workspace')
			                   AND COALESCE(mpc.credential_ciphertext, '') LIKE 'oauth-json:%'
			              ) THEN 0 ELSE 1 END,
			              datetime(COALESCE(last_synced_at, create_time, '1970-01-01')) DESC,
			              account_id DESC
			          ) AS canonical_rank
			     FROM account a
			    WHERE user_id = ?1 AND is_del = 0
			 )
			 SELECT account_id AS id,
			        user_id,
			        provider,
			        external_account_id,
			        email,
			        name AS display_name,
			        CASE
			          WHEN sync_status = 'error' THEN 'error'
			          WHEN sync_status = 'blocked' THEN 'blocked'
			          WHEN sync_status IN ('needs_reconnect', 'legacy_imap_unsupported', 'receive_disabled') THEN 'blocked'
			          WHEN sync_status IN ('first_import_pending', 'first_import_failed', 'oauth_connected', 'identity_connected', 'import_in_progress') THEN 'pending'
			          WHEN sync_status = 'mailbox_ready' THEN 'active'
			          WHEN sync_status = 'not_available' THEN 'not_available'
			          WHEN provider IN ('gmail', 'google_workspace') THEN 'pending'
			          ELSE 'active'
			        END AS status,
			        ${ownedAccountCapabilitiesSql()} AS capabilities_json,
			        ${ownedAccountCapabilitiesSql()} AS account_capability_contract_v2,
			        1 AS ai_access_enabled,
			        create_time AS created_at,
			        last_synced_at AS updated_at
			   FROM ranked_accounts
			  WHERE canonical_rank = 1
			  ORDER BY provider, email`
		).bind(userId).all();
		const owned = rows.results || [];
		for (const row of owned) {
			if (row.provider === 'gmail' || row.provider === 'google_workspace') {
				const caps = await resolveCapabilities(c, userId, row.id);
				const health = await evaluateHealth(c, userId, row.id);
				const contract = {
					contract_version: 2,
					mailbox_lifecycle_state: 
						row.status === 'blocked' ? 'LEGACY_IMAP_UNSUPPORTED' :
						row.status === 'pending' ? 'FIRST_IMPORT_PENDING' : 'MAILBOX_READY',
					mailbox_ready: caps.canReceive === 'PASS',
					read: caps.canReceive === 'PASS',
					send: caps.canSend === 'PASS',
					attachments: true,
					threads: true,
					labels: true,
					token_reference_present: caps.canLogin === 'PASS',
					receive_scope_present: caps.canReceive === 'PASS',
					send_scope_present: caps.canSend === 'PASS',
					account_ownership_type: "OWNED",
					backend_send_eligibility: caps.canSend === 'PASS',
					compose_enabled: caps.canSend === 'PASS',
					send_unavailable_reason: caps.canSend === 'PASS' ? "NONE" : "TOKEN_REFERENCE_MISSING",
					receive_unavailable_reason: caps.canReceive === 'PASS' ? "NONE" : "FIRST_IMPORT_PENDING",
					recovery_action: caps.canLogin === 'PASS' ? "NONE" : "RECONNECT_OAUTH",
					health_score: health.score,
					health_explanation: health.explanation,
					health_timeline: health.timeline
				};
				row.capabilities_json = JSON.stringify(contract);
				row.account_capability_contract_v2 = JSON.stringify(contract);
			}
		}
		const delegated = await c.env.db.prepare(
			`SELECT (1000000000 + ma.id) AS id,
			        ma.grantee_user_id AS user_id,
			        ma.provider,
			        CAST(ma.owner_account_id AS TEXT) AS external_account_id,
			        ma.email,
			        a.name AS display_name,
			        'authorized' AS status,
			        CASE
			          WHEN ma.authorization_method = 'owner_password' THEN '{"contract_version":2,"read":true,"send":true,"attachments":true,"threads":true,"labels":false,"delegated":true,"delegated_send_authorized":true,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":true,"account_ownership_type":"DELEGATED","backend_send_eligibility":true,"compose_enabled":true,"send_unavailable_reason":"NONE"}'
			          ELSE '{"contract_version":2,"read":true,"send":false,"attachments":false,"threads":false,"labels":false,"delegated":true,"delegated_send_authorized":false,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"DELEGATED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"DELEGATED_RECEIVE_ONLY"}'
			        END AS capabilities_json,
			        CASE
			          WHEN ma.authorization_method = 'owner_password' THEN '{"contract_version":2,"read":true,"send":true,"attachments":true,"threads":true,"labels":false,"delegated":true,"delegated_send_authorized":true,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":true,"account_ownership_type":"DELEGATED","backend_send_eligibility":true,"compose_enabled":true,"send_unavailable_reason":"NONE"}'
			          ELSE '{"contract_version":2,"read":true,"send":false,"attachments":false,"threads":false,"labels":false,"delegated":true,"delegated_send_authorized":false,"token_reference_present":true,"receive_scope_present":true,"send_scope_present":false,"account_ownership_type":"DELEGATED","backend_send_eligibility":false,"compose_enabled":false,"send_unavailable_reason":"DELEGATED_RECEIVE_ONLY"}'
			        END AS account_capability_contract_v2,
			        1 AS delegated,
			        1 AS ai_access_enabled,
			        ma.created_at,
			        ma.updated_at
			   FROM mailbox_authorizations ma
			   JOIN account a ON a.account_id = ma.owner_account_id
			  WHERE ma.grantee_user_id = ?1
			    AND ma.status = 'active'
			    AND ma.revoked_at IS NULL
			  ORDER BY ma.email`
		).bind(userId).all();
		const delegatedRows = (delegated.results || []).map(row => ({
			...row,
			delegated: true
		}));
		return owned.concat(delegatedRows);
	},

	async ensureNativeAccount(c, userId, email) {
		await c.env.db.prepare(
			`INSERT INTO account
			 (email, name, user_id, provider, domain, sync_status, all_receive, sort, is_del)
			 SELECT ?1, ?1, ?2, 'cloudflare_native', LOWER(SUBSTR(?1, INSTR(?1, '@') + 1)), 'connected', 1, 0, 0
			  WHERE NOT EXISTS (
			    SELECT 1 FROM account
			     WHERE user_id = ?2
			       AND provider = 'cloudflare_native'
			       AND LOWER(email) = LOWER(?1)
			       AND is_del = 0
			  )`
		).bind(String(email || '').trim().toLowerCase(), userId).run();
		return this.accounts(c, userId);
	},

	async unifiedMessages(c, userId, query = '') {
		throw new BizError('Frozen: canonical mail reads use /api/email/list with account/email source metadata.', 404);
	},

	async createSecureSend(c, userId, body, expiresInSeconds = 86400) {
		const token = crypto.randomUUID().replaceAll('-', '');
		const tokenHash = await sha256(token);
		const r2Key = `secure-send/${userId}/${crypto.randomUUID()}.json`;
		await c.env.r2.put(r2Key, JSON.stringify({ body }), {
			httpMetadata: { contentType: 'application/json' },
			customMetadata: { owner: String(userId) }
		});
		await c.env.db.prepare(
			`INSERT INTO secure_send_links (user_id, token_hash, r2_key, expires_at)
			 VALUES (?1, ?2, ?3, ?4)`
		).bind(userId, tokenHash, r2Key, Date.now() + Math.min(expiresInSeconds, 604800) * 1000).run();
		await audit(c, 'secure_send_created', 'secure_send_link', 'success', {}, userId, 'user');
		return { url: `${new URL(c.req.url).origin}/api/secure/${token}`, expiresInSeconds };
	},

	async openSecureSend(c, token) {
		const tokenHash = await sha256(token);
		const link = await c.env.db.prepare(
			`SELECT * FROM secure_send_links
			  WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2`
		).bind(tokenHash, Date.now()).first();
		if (!link) throw new BizError('Secure link is invalid or expired.', 404);
		const object = await c.env.r2.get(link.r2_key);
		if (!object) throw new BizError('Secure content is unavailable.', 404);
		await c.env.db.prepare(
			'UPDATE secure_send_links SET access_count = access_count + 1 WHERE id = ?1'
		).bind(link.id).run();
		await audit(c, 'secure_send_opened', 'secure_send_link', 'success', {}, link.user_id, 'external');
		return object.text();
	},

	async securityAnalyze(c, userId, params) {
		const text = `${params.sender || ''} ${params.subject || ''} ${params.body || ''}`.toLowerCase();
		const suspicious = ['verify your account', 'urgent payment', 'gift card', 'password expires', 'crypto wallet'];
		const phishingSignals = suspicious.filter(signal => text.includes(signal));
		const trackerCount = (params.html || '').match(/<img[^>]+(?:width=["']?1|height=["']?1|pixel|track)/gi)?.length || 0;
		const unsubscribe = (params.listUnsubscribe || '').match(/<([^>]+)>/)?.[1] || null;
		await audit(c, 'mail_security_analyzed', 'mail', 'success', {
			phishingSignalCount: phishingSignals.length,
			trackerCount,
			unsubscribeAvailable: Boolean(unsubscribe)
		}, userId, 'user');
		return {
			phishingWarning: phishingSignals.length > 0,
			phishingSignals,
			trackerBlocking: { blocked: trackerCount > 0, trackerCount },
			oneClickUnsubscribe: { available: Boolean(unsubscribe), method: unsubscribe?.startsWith('mailto:') ? 'mailto' : 'https' }
		};
	},

	async adminSummary(c, userId, email) {
		if (email !== c.env.admin) throw new BizError('Unauthorized', 403);
		const queries = await c.env.db.batch([
			c.env.db.prepare('SELECT COUNT(*) AS value FROM user WHERE is_del = 0'),
			c.env.db.prepare("SELECT COUNT(*) AS value FROM email_identities WHERE status = 'pending'"),
			c.env.db.prepare('SELECT COUNT(*) AS value FROM email'),
			c.env.db.prepare('SELECT COUNT(*) AS value FROM attachments'),
			c.env.db.prepare('SELECT COUNT(*) AS value FROM ai_outputs'),
			c.env.db.prepare('SELECT COUNT(*) AS value FROM audit_logs'),
			c.env.db.prepare("SELECT COUNT(*) AS value FROM audit_logs WHERE action = 'login_failed'"),
			c.env.db.prepare("SELECT COUNT(*) AS value FROM audit_logs WHERE action = 'mail_security_analyzed' AND metadata_json LIKE '%phishingSignalCount%'")
		]);
		return {
			users: queries[0].results?.[0]?.value || 0,
			pendingUsers: queries[1].results?.[0]?.value || 0,
			mails: queries[2].results?.[0]?.value || 0,
			attachments: queries[3].results?.[0]?.value || 0,
			aiOutputs: queries[4].results?.[0]?.value || 0,
			auditEvents: queries[5].results?.[0]?.value || 0,
			loginFailures: queries[6].results?.[0]?.value || 0,
			phishingAnalyses: queries[7].results?.[0]?.value || 0,
			bindings: { d1: true, kv: true, r2: true },
			secretsExposed: false
		};
	},

		async syncRouting(c) {
			const listed = await listRoutingRules(c);
			if (!listed.configured) {
				await audit(c, 'routing_sync', 'email_identity', 'cache_only', { reason: 'cloudflare_api_not_configured' });
				return { source: 'd1_cache', synced: 0, catchAllDetected: false };
			}
			const activeEmails = new Set();
			const disabled = [];
			const forwardingPreserved = [];
			let catchAllDetected = false;
			let catchAllEnabled = false;
			for (const rule of listed.rules) {
				if (isCatchAllRule(rule)) {
					catchAllDetected = true;
					catchAllEnabled = Boolean(rule.enabled);
				}
				for (const matcher of rule.matchers || []) {
					if (matcher.type !== 'literal' || matcher.field !== 'to') continue;
					const email = normalizedEmail(matcher.value);
					if (!managedDomains(c).includes(domainOf(email))) continue;
					activeEmails.add(email);
					const identity = await upsertRoutingIdentity(c, email, rule);
					if (rule.enabled) {
						await c.env.db.prepare(
							`UPDATE email_identities SET routing_enabled = 1,
							 status = CASE WHEN status = 'active' THEN 'active' ELSE 'routing_only' END,
							 updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
						).bind(identity.id).run();
					} else {
						disabled.push(email);
						await c.env.db.prepare(
							`UPDATE email_identities SET routing_enabled = 0,
							 status = CASE WHEN status = 'active' THEN 'active' ELSE 'disabled_routing' END,
							 updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
						).bind(identity.id).run();
					}
					if (forwardingDestinationsFromRule(rule).length) {
						forwardingPreserved.push(email);
					}
				}
			}
		const cached = await c.env.db.prepare(
			"SELECT id, normalized_email, status FROM email_identities WHERE source = 'cloudflare_routing'"
		).all();
		for (const identity of cached.results || []) {
				if (!activeEmails.has(identity.normalized_email) && identity.status !== 'active') {
					await c.env.db.prepare(
						`UPDATE email_identities SET status = 'stale', routing_enabled = 0,
						 updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
					).bind(identity.id).run();
				}
			}
			await audit(c, 'routing_sync', 'email_identity', 'success', {
				synced: activeEmails.size,
				disabled: disabled.length,
				catchAllDetected,
				catchAllEnabled,
				forwardingPreserved: forwardingPreserved.length
			});
			return {
				source: listed.source,
				routingRulesFetched: listed.rules.length,
				synced: activeEmails.size,
				disabledIdentities: disabled.length,
				catchAllDetected,
				catchAllEnabled,
				forwardingDestinationsPreserved: forwardingPreserved.length
			};
		},

		async ensureRoutingRule(c, email, userId = null) {
			return ensureCloudflareRoutingRule(c, email, userId);
		},

		async createProvisioningContinuation(c, email, input = {}) {
			return createProvisioningContinuation(c, email, input);
		},

		async beginProvisioningAuthHandoff(c, email, input = {}) {
			return beginProvisioningAuthHandoff(c, email, input);
		},

		async recordProvisioningAuthAttempt(c, reference, outcome) {
			return recordProvisioningAuthAttempt(c, reference, outcome);
		},

		async forwardingSettings(c, email) {
			const normalized = normalizedEmail(email);
			const rows = await c.env.db.prepare(
				`SELECT source_email, destination_email, forwarding_enabled, preserve_original_forwarding,
				        last_forwarded_at, last_error
				   FROM email_forwarding_destinations
				  WHERE normalized_source_email = ?1
				  ORDER BY destination_email`
			).bind(normalized).all();
			const identity = await c.env.db.prepare(
				`SELECT normalized_email, routing_rule_id, routing_enabled, forwarding_preserved, status
				   FROM email_identities WHERE normalized_email = ?1`
			).bind(normalized).first();
			return {
				address: normalized,
				inCloudMailInbox: Boolean(identity),
				routingRuleId: identity?.routing_rule_id || null,
				routingEnabled: Boolean(identity?.routing_enabled),
				forwardingPreserved: Boolean(identity?.forwarding_preserved),
				status: identity?.status || 'not_found',
				destinations: rows.results || []
			};
		},

		async routingAudit(c, emails = []) {
			const sync = await this.syncRouting(c);
			const discoveries = {};
			for (const email of emails) {
				discoveries[normalizedEmail(email)] = await this.discover(c, email);
			}
			return { sync, discoveries };
		}
	};

export default cloudMailV2Service;
