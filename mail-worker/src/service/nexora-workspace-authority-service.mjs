import { deriveCorrelationRef, deriveSessionRef } from './nexora-session-ref-service.mjs';
import BizError from '../error/biz-error.js';

const CREDENTIAL_VERSION = 1;
const DEFAULT_CREDENTIAL_TTL_SECONDS = 300;
const MAX_CREDENTIAL_TTL_SECONDS = 300;
const encoder = new TextEncoder();

const CAPABILITIES = Object.freeze({
	OWNER: Object.freeze(['domain:read', 'domain:write']),
	ADMIN: Object.freeze(['domain:read', 'domain:write']),
	SECURITY_ADMIN: Object.freeze(['domain:read']),
	MAIL_ADMIN: Object.freeze(['domain:read']),
	VIEWER: Object.freeze(['domain:read']),
	SUPPORT: Object.freeze(['domain:read'])
});

function actorId(actor) {
	const id = Number(actor?.userId);
	if (!Number.isInteger(id) || id <= 0) throw new BizError('authenticated user context is required', 401);
	return id;
}

function workspaceId(value) {
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) throw new BizError('workspaceId is required', 400);
	return id;
}

function capabilities(role) {
	return CAPABILITIES[String(role || '').toUpperCase()] || [];
}

function requestHeader(c, name) {
	try { return c.req?.header?.(name) || null; } catch { return null; }
}

function base64UrlEncode(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
	const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function constantTimeEqual(left, right) {
	const a = String(left || '');
	const b = String(right || '');
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return mismatch === 0;
}

function bytesToHex(bytes) {
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function credentialSignature(env, encodedPayload) {
	const secret = String(env?.NEXORA_CORRELATION_HASH_SECRET || '');
	if (!secret) throw new Error('NEXORA correlation HMAC secret is not configured');
	if (encoder.encode(secret).byteLength < 32) throw new Error('NEXORA correlation HMAC secret must be at least 32 bytes');
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const material = `nexora-workspace-selection-credential-v1\n${encodedPayload}`;
	return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(material)));
}

function deploymentId(c) {
	const value = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!value) throw new Error('runtime deployment identity is not configured');
	return value;
}

async function authSessionRef(c) {
	return deriveSessionRef(c.env, requestHeader(c, 'authorization'));
}

function actorEmail(actor) {
	const email = String(actor?.email || '').trim().toLowerCase();
	return email || null;
}

async function resolveActorIdentity(c, actor) {
	const userId = actorId(actor);
	const email = actorEmail(actor);
	const sessionRef = await authSessionRef(c);
	const runtimeDeploymentId = deploymentId(c);
	const actorRef = await deriveCorrelationRef(c.env, 'workspace-selector-actor', [
		userId, email || '', sessionRef, runtimeDeploymentId
	].join('\n'));
	return { userId, email, actorRef };
}

async function issueWorkspaceSelectionCredential(c, actor, actorIdentity, row, capability, options = {}) {
	const now = Number(options.now ?? Date.now());
	const requestedTtl = Number(options.ttlSeconds ?? DEFAULT_CREDENTIAL_TTL_SECONDS);
	const ttlSeconds = Math.min(Math.max(Number.isFinite(requestedTtl) ? requestedTtl : DEFAULT_CREDENTIAL_TTL_SECONDS, 1), MAX_CREDENTIAL_TTL_SECONDS);
	const payload = {
		v: CREDENTIAL_VERSION,
		actorId: actorId(actor),
		authSessionRef: await authSessionRef(c),
		actorRef: actorIdentity.actorRef,
		workspaceId: Number(row.id),
		capability: String(capability),
		deploymentId: deploymentId(c),
		hmacKeyVersion: String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || ''),
		issuedAt: now,
		expiresAt: now + ttlSeconds * 1000
	};
	if (!payload.hmacKeyVersion) throw new Error('NEXORA correlation HMAC key version is not configured');
	const encoded = base64UrlEncode(JSON.stringify(payload));
	const signature = await credentialSignature(c.env, encoded);
	return `${encoded}.${signature}`;
}

async function requireWorkspaceSelectionCredential(c, actor, requestedWorkspaceId, capability, credential, options = {}) {
	if (!credential) throw new BizError('workspace selection credential is required', 403);
	if (String(credential).length > 4096) throw new BizError('workspace selection credential integrity denied', 403);
	const [encoded, signature, extra] = String(credential).split('.');
	if (!encoded || !signature || extra !== undefined) throw new BizError('workspace selection credential integrity denied', 403);
	const expectedSignature = await credentialSignature(c.env, encoded);
	if (!constantTimeEqual(signature, expectedSignature)) throw new BizError('workspace selection credential integrity denied', 403);
	let payload;
	try { payload = JSON.parse(base64UrlDecode(encoded)); } catch { throw new BizError('workspace selection credential payload is invalid', 403); }
	if (Number(payload.v) !== CREDENTIAL_VERSION) throw new BizError('workspace selection credential version denied', 403);
	if (Number(payload.actorId) !== actorId(actor)) throw new BizError('workspace selection credential actor substitution denied', 403);
	if (Number(payload.workspaceId) !== workspaceId(requestedWorkspaceId)) throw new BizError('workspace selection credential workspace substitution denied', 403);
	if (String(payload.capability) !== String(capability)) throw new BizError('workspace selection credential capability substitution denied', 403);
	if (String(payload.deploymentId) !== deploymentId(c)) throw new BizError('workspace selection credential deployment continuity denied', 409);
	if (String(payload.hmacKeyVersion) !== String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || '')) throw new BizError('workspace selection credential key version continuity denied', 409);
	if (!constantTimeEqual(payload.authSessionRef, await authSessionRef(c))) throw new BizError('workspace selection credential session substitution denied', 403);
	const currentActorIdentity = await resolveActorIdentity(c, actor);
	if (!constantTimeEqual(payload.actorRef, currentActorIdentity.actorRef)) throw new BizError('workspace selection credential actor reference mismatch', 403);
	const now = Number(options.now ?? Date.now());
	if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt) || payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > MAX_CREDENTIAL_TTL_SECONDS * 1000) {
		throw new BizError('workspace selection credential expired', 409);
	}
	return payload;
}

async function selectionEvidence(c, actorIdentity, row, capability) {
	const requestId = requestHeader(c, 'cf-ray') || globalThis.crypto?.randomUUID?.();
	const runtimeDeploymentId = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!requestId) throw new Error('server request identity is unavailable');
	if (!runtimeDeploymentId) throw new Error('runtime deployment identity is not configured');
	const workspaceSelectionRef = await deriveCorrelationRef(c.env, 'workspace-selection', [
		actorIdentity.userId, actorIdentity.actorRef, row.id, row.tenant_key, row.role, capability, requestId, runtimeDeploymentId
	].join('\n'));
	return {
		workspaceSelectionRef,
		actorRef: actorIdentity.actorRef,
		hmacKeyVersion: String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION),
		requestId,
		runtimeDeploymentId,
		validatedAt: new Date().toISOString(),
		redactionLevel: 'BODYLESS'
	};
}

async function listActorWorkspaces(c, actorInput) {
	const id = actorId(actorInput);
	const rows = await c.env.db.prepare(
		`SELECT w.id,w.display_name,w.tenant_key,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE m.user_id=?1
		 ORDER BY w.id`
	).bind(id).all();
	return (rows.results || []).map((row) => ({
		workspaceId: Number(row.id),
		displayName: row.display_name,
		role: row.role,
		capabilities: capabilities(row.role),
		canActivateDomain: capabilities(row.role).includes('domain:write')
	}));
}

async function assertWorkspaceCapability(c, actorInput, requestedWorkspaceId, capability = 'domain:write', options = {}) {
	const id = actorId(actorInput);
	const actorIdentity = await resolveActorIdentity(c, actorInput);
	const selectedWorkspaceId = workspaceId(requestedWorkspaceId);
	const row = await c.env.db.prepare(
		`SELECT w.id,w.display_name,w.tenant_key,w.created_by_user_id,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE w.id=?1 AND m.user_id=?2
		 LIMIT 1`
	).bind(selectedWorkspaceId, id).first();
	if (!row) throw new BizError('workspace authority is required', 403);
	if (row.tenant_key !== `user:${id}`) throw new BizError('workspace tenant lineage does not match authenticated actor', 403);
	if (!capabilities(row.role).includes(capability)) throw new BizError(`workspace ${capability} capability is required`, 403);
	const result = {
		actor: actorIdentity,
		workspace: {
			id: Number(row.id),
			displayName: row.display_name,
			role: row.role,
			capabilities: capabilities(row.role),
			canActivateDomain: capabilities(row.role).includes('domain:write')
		},
		selectionEvidence: await selectionEvidence(c, actorIdentity, row, capability)
	};
	if (options.issueCredential === true) {
		result.workspaceSelectionCredential = await issueWorkspaceSelectionCredential(c, actorInput, actorIdentity, row, capability, options);
	}
	return result;
}

export { CAPABILITIES, listActorWorkspaces, resolveActorIdentity, assertWorkspaceCapability, requireWorkspaceSelectionCredential };
export default { listActorWorkspaces, resolveActorIdentity, assertWorkspaceCapability, requireWorkspaceSelectionCredential };
