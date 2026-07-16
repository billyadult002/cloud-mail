import BizError from '../error/biz-error';
import { outboundProviderAdapters, OutboundProviderStatus } from './outbound-provider-adapter';

export const DomainProvisioningState = Object.freeze({
	NO_DOMAIN_SELECTED: 'NO_DOMAIN_SELECTED',
	DISCOVERED: 'DISCOVERED',
	SCANNING: 'SCANNING',
	NEEDS_CONFIGURATION: 'NEEDS_CONFIGURATION',
	CONFIGURING: 'CONFIGURING',
	DNS_PENDING: 'DNS_PENDING',
	ROUTING_PENDING: 'ROUTING_PENDING',
	SENDING_PENDING: 'SENDING_PENDING',
	MAILBOX_PENDING: 'MAILBOX_PENDING',
	SECURITY_PENDING: 'SECURITY_PENDING',
	READY: 'READY',
	PARTIAL_WITH_REAL_BLOCKER: 'PARTIAL_WITH_REAL_BLOCKER',
	FAILED: 'FAILED'
});

export const DomainReadinessState = Object.freeze({
	READY: 'READY',
	MISSING: 'MISSING',
	INVALID: 'INVALID',
	CONFLICTING: 'CONFLICTING',
	PENDING_PROPAGATION: 'PENDING_PROPAGATION',
	UNAUTHORIZED: 'UNAUTHORIZED',
	NOT_SUPPORTED: 'NOT_SUPPORTED',
	UNKNOWN: 'UNKNOWN'
});

export const SecureLinkState = Object.freeze({
	DRAFT: 'DRAFT',
	ACTIVE: 'ACTIVE',
	EXPIRED: 'EXPIRED',
	REVOKED: 'REVOKED',
	LEGAL_HOLD_LOCKED: 'LEGAL_HOLD_LOCKED',
	DISABLED: 'DISABLED'
});

const CLOUDFLARE_MX = new Set([
	'route1.mx.cloudflare.net',
	'route2.mx.cloudflare.net',
	'route3.mx.cloudflare.net'
]);

function normalizeDomain(value) {
	return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/\.$/, '');
}

function safeJson(value = {}) {
	const forbidden = ['token', 'secret', 'password', 'authorization', 'cookie', 'body', 'content', 'private_key'];
	return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.some(word => key.toLowerCase().includes(word))));
}

function safeCloudflareDomainCandidate(zone = {}) {
	const domainName = normalizeDomain(zone.name);
	const ns = Array.isArray(zone.name_servers) ? zone.name_servers.map(dnsHost) : [];
	const riskFlags = [];
	if (zone.status && zone.status !== 'active') riskFlags.push('zone_not_active');
	if (!ns.some(value => value.endsWith('.cloudflare.com'))) riskFlags.push('nameservers_not_confirmed');
	return {
		domain_name: domainName,
		zone_id_ref: zone.id || null,
		account_ref: zone.account?.id || null,
		zone_status: zone.status || 'unknown',
		nameserver_status: ns.some(value => value.endsWith('.cloudflare.com')) ? DomainReadinessState.READY : DomainReadinessState.UNKNOWN,
		eligible_for_cloudmail: Boolean(domainName && zone.id && zone.status === 'active'),
		current_email_state: 'UNKNOWN',
		risk_flags: riskFlags
	};
}

function domainInstance(domain = null, state = DomainProvisioningState.NO_DOMAIN_SELECTED, extra = {}) {
	const normalized = normalizeDomain(domain);
	return {
		domain_name: normalized || null,
		state,
		selected: Boolean(normalized),
		supports_multiple_domains: true,
		can_rescan: Boolean(normalized),
		can_retry_setup: [
			DomainProvisioningState.NEEDS_CONFIGURATION,
			DomainProvisioningState.DNS_PENDING,
			DomainProvisioningState.ROUTING_PENDING,
			DomainProvisioningState.SENDING_PENDING,
			DomainProvisioningState.MAILBOX_PENDING,
			DomainProvisioningState.SECURITY_PENDING,
			DomainProvisioningState.PARTIAL_WITH_REAL_BLOCKER,
			DomainProvisioningState.FAILED
		].includes(state),
		...extra
	};
}

function normalizeReadinessStatus(status) {
	const value = String(status || '').toUpperCase();
	if (value === 'READY') return DomainReadinessState.READY;
	if (value.includes('MISSING')) return DomainReadinessState.MISSING;
	if (value.includes('INVALID')) return DomainReadinessState.INVALID;
	if (value.includes('CONFLICT')) return DomainReadinessState.CONFLICTING;
	if (value.includes('PENDING')) return DomainReadinessState.PENDING_PROPAGATION;
	if (value.includes('UNAUTHORIZED')) return DomainReadinessState.UNAUTHORIZED;
	if (value.includes('NOT_SUPPORTED')) return DomainReadinessState.NOT_SUPPORTED;
	if (value.includes('BLOCKED_NOT_CLOUDFLARE_NS')) return DomainReadinessState.INVALID;
	if (value.includes('BLOCKED_MX_NOT_CLOUDFLARE_ROUTING')) return DomainReadinessState.CONFLICTING;
	return DomainReadinessState.UNKNOWN;
}

async function auditP31Event(c, domain, action, outcome, metadata = {}) {
	try {
		await c.env.db.prepare(
			`INSERT INTO audit_events (domain, actor_role, action, resource_type, outcome, metadata_json)
			 VALUES (?1, 'system', ?2, 'domain', ?3, ?4)`
		).bind(domain || null, action, outcome, JSON.stringify(safeJson(metadata))).run();
		return 'audit_event_recorded';
	} catch {
		return 'audit_table_unavailable_or_not_migrated';
	}
}

function dnsText(answer) {
	const data = String(answer?.data || '').trim();
	return data.replace(/^"|"$/g, '').replace(/"\s+"/g, '');
}

function dmarcTags(record = '') {
	return Object.fromEntries(String(record).split(';')
		.map(part => part.trim())
		.filter(Boolean)
		.map(part => {
			const index = part.indexOf('=');
			return index === -1 ? [part.toLowerCase(), ''] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
		}));
}

function evaluateDmarcRecords(records = []) {
	const values = records.map(String).map(value => value.trim()).filter(Boolean);
	if (values.length === 0) {
		return { status: DomainReadinessState.MISSING, records: [], reason: 'dmarc_record_missing' };
	}
	if (values.length > 1) {
		return { status: DomainReadinessState.CONFLICTING, records: values, reason: 'multiple_dmarc_records' };
	}
	const tags = dmarcTags(values[0]);
	if (String(tags.v || '').toUpperCase() !== 'DMARC1') {
		return { status: DomainReadinessState.INVALID, records: values, reason: 'missing_v_dmarc1' };
	}
	if (!['none', 'quarantine', 'reject'].includes(String(tags.p || '').toLowerCase())) {
		return { status: DomainReadinessState.INVALID, records: values, reason: 'invalid_or_missing_policy' };
	}
	return {
		status: DomainReadinessState.READY,
		records: values,
		reason: 'valid_dmarc_policy_present',
		policy: String(tags.p).toLowerCase(),
		rua_status: tags.rua ? 'configured' : 'absent_not_blocking'
	};
}

function desiredDmarcState(domain, options = {}) {
	const normalized = normalizeDomain(domain);
	const ruaAddress = normalizeDomain(options.managedRuaDomain)
		? `dmarc@${normalizeDomain(options.managedRuaDomain)}`
		: options.ruaAddress
			? String(options.ruaAddress).trim().replace(/^mailto:/i, '')
			: `dmarc@${normalized}`;
	const rua = ruaAddress ? `; rua=mailto:${ruaAddress}` : '';
	return {
		type: 'TXT',
		name: `_dmarc.${normalized}`,
		content: `v=DMARC1; p=quarantine${rua}; adkim=s; aspf=s`,
		purpose: 'dmarc_policy',
		rua_status: ruaAddress.endsWith(`@${normalized}`) ? 'domain_local_part_unverified' : 'managed_or_explicit'
	};
}

function dnsHost(answer) {
	return String(answer?.data || '').trim().replace(/\.$/, '').toLowerCase();
}

async function dnsQuery(domain, type) {
	const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`, {
		headers: { accept: 'application/dns-json' }
	});
	const payload = await response.json().catch(() => ({}));
	return Array.isArray(payload.Answer) ? payload.Answer : [];
}

function managedDomains(c) {
	try {
		const domains = Array.isArray(c.env.domain) ? c.env.domain : JSON.parse(c.env.domain || '[]');
		return domains.map(normalizeDomain).filter(Boolean);
	} catch {
		return [];
	}
}

function zoneMap(c) {
	try {
		return JSON.parse(c.env.CLOUDMAIL_DOMAIN_ZONE_MAP || '{}');
	} catch {
		return {};
	}
}

async function cloudflareRequest(c, path, options = {}) {
	const token = c.env.CLOUDFLARE_API_TOKEN;
	if (!token) {
		return { ok: false, status: 503, error: 'cloudflare_api_token_not_configured' };
	}
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...options,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			...(options.headers || {})
		}
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.success === false) {
		return {
			ok: false,
			status: response.status,
			error: payload?.errors?.[0]?.message || `cloudflare_api_${response.status}`,
			code: payload?.errors?.[0]?.code || null
		};
	}
	return { ok: true, status: response.status, result: payload.result ?? payload };
}

async function resolveZone(c, domain) {
	const mapped = zoneMap(c)[domain];
	if (mapped) return { zoneId: mapped, source: 'domain_zone_map' };
	const configured = c.env.CLOUDFLARE_ZONE_ID;
	if (configured && normalizeDomain(c.env.CLOUDMAIL_PRIMARY_DOMAIN || c.env.CLOUDFLARE_ZONE_DOMAIN) === domain) {
		return { zoneId: configured, source: 'configured_primary_zone' };
	}
	const listed = await cloudflareRequest(c, `/zones?name=${encodeURIComponent(domain)}&status=active&per_page=1`);
	if (!listed.ok) return { zoneId: null, source: 'cloudflare_api', error: listed.error, status: listed.status, code: listed.code };
	const zone = Array.isArray(listed.result) ? listed.result[0] : null;
	return {
		zoneId: zone?.id || null,
		zoneStatus: zone?.status || null,
		nameServers: zone?.name_servers || [],
		accountReference: zone?.account?.id || null,
		source: 'cloudflare_api'
	};
}

function scanDnsState(domain, answers) {
	const mxHosts = answers.mx.map(dnsHost);
	const txtValues = answers.txt.map(dnsText);
	const dmarcValues = answers.dmarc.map(dnsText);
	const dkimValues = answers.dkim.map(dnsText);
	const nsHosts = answers.ns.map(dnsHost);
	return {
		ns: {
			status: nsHosts.some(ns => ns.endsWith('.cloudflare.com')) ? 'READY' : 'BLOCKED_NOT_CLOUDFLARE_NS',
			records: nsHosts
		},
		mx: {
			status: CLOUDFLARE_MX.size === mxHosts.filter(host => CLOUDFLARE_MX.has(host)).length ? 'READY' : 'BLOCKED_MX_NOT_CLOUDFLARE_ROUTING',
			records: mxHosts
		},
		spf: {
			status: txtValues.some(value => value.toLowerCase().includes('v=spf1') && value.toLowerCase().includes('_spf.mx.cloudflare.net')) ? 'READY' : 'MISSING',
			records: txtValues.filter(value => value.toLowerCase().includes('v=spf1'))
		},
		dkim: {
			status: dkimValues.some(value => value.toLowerCase().includes('v=dkim1')) ? 'READY' : 'UNKNOWN_OR_MISSING_SELECTOR',
			records: dkimValues
		},
		dmarc: evaluateDmarcRecords(dmarcValues)
	};
}

function currentRecordKey(record) {
	return [
		String(record.type || '').toUpperCase(),
		normalizeDomain(record.name || ''),
		String(record.content || '').trim().toLowerCase(),
		String(record.priority || '')
	].join('|');
}

function desiredRecordKey(record) {
	return [
		String(record.type || '').toUpperCase(),
		normalizeDomain(record.name || ''),
		String(record.content || '').trim().toLowerCase(),
		String(record.priority || '')
	].join('|');
}

function desiredDnsState(domain) {
	return [
		{ type: 'MX', name: domain, content: 'route3.mx.cloudflare.net', priority: 60, purpose: 'inbound_email_routing' },
		{ type: 'MX', name: domain, content: 'route1.mx.cloudflare.net', priority: 82, purpose: 'inbound_email_routing' },
		{ type: 'MX', name: domain, content: 'route2.mx.cloudflare.net', priority: 96, purpose: 'inbound_email_routing' },
		{ type: 'TXT', name: domain, content: 'v=spf1 include:_spf.mx.cloudflare.net ~all', purpose: 'spf' },
		desiredDmarcState(domain)
	];
}

function compareDesiredDnsState(desiredRecords = [], currentRecords = []) {
	const currentKeys = new Set(currentRecords.map(currentRecordKey));
	return desiredRecords.map(desired => {
		const exactMatch = currentKeys.has(desiredRecordKey(desired));
		const sameNameType = currentRecords.filter(record =>
			String(record.type || '').toUpperCase() === String(desired.type || '').toUpperCase()
			&& normalizeDomain(record.name || '') === normalizeDomain(desired.name || '')
		);
		if (desired.purpose === 'dmarc_policy') {
			const dmarc = evaluateDmarcRecords(sameNameType.map(record => record.content));
			if (dmarc.status === DomainReadinessState.READY) {
				return { desired, current_count: sameNameType.length, status: DomainReadinessState.READY, action: 'preserve_existing_valid_dmarc', destructive: false };
			}
			if (dmarc.status === DomainReadinessState.INVALID || dmarc.status === DomainReadinessState.CONFLICTING) {
				return { desired, current_count: sameNameType.length, status: dmarc.status, action: 'report_conflict', destructive: false, reason: dmarc.reason };
			}
		}
		const conflict = sameNameType.some(record => String(record.content || '').trim().toLowerCase() !== String(desired.content || '').trim().toLowerCase());
		return {
			desired,
			current_count: sameNameType.length,
			status: exactMatch ? DomainReadinessState.READY : conflict ? DomainReadinessState.CONFLICTING : DomainReadinessState.MISSING,
			action: exactMatch ? 'reuse_existing' : conflict ? 'report_conflict' : 'create_if_safe',
			destructive: false
		};
	});
}

function readinessFrom(discovery) {
	const dns = discovery.dns;
	const routingReady = discovery.cloudflare.emailRouting?.status === 'ready' || discovery.cloudflare.emailRouting?.enabled === true;
	const sendingReady = discovery.outboundProvider?.status === OutboundProviderStatus.READY;
	const blockers = [];
	if (dns.ns.status !== 'READY') blockers.push({ field: 'nameservers', reason: dns.ns.status });
	if (dns.mx.status !== 'READY') blockers.push({ field: 'mx', reason: dns.mx.status });
	if (dns.spf.status !== 'READY') blockers.push({ field: 'spf', reason: dns.spf.status });
	if (dns.dkim.status !== 'READY') blockers.push({ field: 'dkim', reason: dns.dkim.status });
	if (dns.dmarc.status !== 'READY') blockers.push({ field: 'dmarc', reason: dns.dmarc.status });
	if (!routingReady) blockers.push({ field: 'inbound_email_worker_status', reason: discovery.cloudflare.emailRouting?.error || 'routing_not_ready' });
	if (!sendingReady) blockers.push({ field: 'outbound_provider_status', reason: discovery.outboundProvider?.reason || discovery.outboundProvider?.status || 'not_ready' });

	return {
		domain_discovery: 'PASS',
		domain_registry: 'READY',
		readiness_engine: 'READY',
		dns_scan: 'READY',
		mx_status: dns.mx.status === 'READY' ? 'READY' : dns.mx.status,
		spf_status: dns.spf.status === 'READY' ? 'READY' : dns.spf.status,
		dkim_status: dns.dkim.status === 'READY' ? 'READY' : dns.dkim.status,
		dmarc_status: dns.dmarc.status === 'READY' ? 'READY' : dns.dmarc.status,
		inbound_email_worker_status: routingReady ? 'READY' : 'BLOCKED_ROUTING_NOT_READY',
		outbound_provider_status: sendingReady ? 'READY' : `BLOCKED_${String(discovery.outboundProvider?.reason || 'OUTBOUND_NOT_READY').toUpperCase()}`,
		mailbox_status: routingReady ? 'READY' : 'READY_PENDING_ROUTING',
		identity_status: routingReady ? 'READY' : 'READY_PENDING_ROUTING',
		capability_status: routingReady ? 'READY' : 'PARTIAL_PENDING_ROUTING',
		security_foundation: 'READY',
		lifecycle_worker_foundation: 'READY',
		provisioning_state: blockers.length === 0 ? DomainProvisioningState.READY : DomainProvisioningState.NEEDS_CONFIGURATION,
		real_domain_state: blockers.length === 0 ? 'READY' : 'PARTIAL_WITH_REAL_BLOCKER',
		blockers
	};
}

async function selectOutboundProvider(domain, cloudflare, c) {
	const settingsResendTokens = {};
	try {
		const setting = await c.env.db?.prepare?.('SELECT resend_tokens FROM setting LIMIT 1')?.first?.();
		Object.assign(settingsResendTokens, JSON.parse(setting?.resend_tokens || '{}'));
	} catch {
		// Optional discovery only.
	}
	const state = {
		emailSending: cloudflare.emailSending,
		resendConfigured: Boolean(settingsResendTokens[domain] || c.env.IDENTITY_RESEND_TOKEN)
	};
	for (const adapter of outboundProviderAdapters()) {
		const status = await adapter.verifyDomain(domain, state);
		if (status.status === OutboundProviderStatus.READY) return status;
		if (adapter.kind === 'cloudflare_email_sending') {
			cloudflare.emailSendingProvider = status;
		}
	}
	return cloudflare.emailSendingProvider || { provider: 'none', status: 'blocked', reason: 'no_outbound_provider_ready' };
}

async function discoverZones(c) {
	const response = await cloudflareRequest(c, '/zones?per_page=50');
	if (!response.ok) {
		return {
			cloudflare_connected: false,
			candidates: [],
			blocker: response.error,
			status: response.status,
			code: response.code || null
		};
	}
	const zones = Array.isArray(response.result) ? response.result : [];
	return {
		cloudflare_connected: true,
		candidates: zones.map(safeCloudflareDomainCandidate).filter(candidate => candidate.domain_name),
		metadata: {
			count: zones.length,
			secret_exposure: false
		}
	};
}

function selectDomain(rawDomain, candidates = []) {
	const domain = normalizeDomain(rawDomain);
	if (!domain) return domainInstance(null, DomainProvisioningState.NO_DOMAIN_SELECTED);
	const match = candidates.find(candidate => normalizeDomain(candidate.domain_name) === domain);
	return domainInstance(domain, match ? DomainProvisioningState.DISCOVERED : DomainProvisioningState.DISCOVERED, {
		zone_id_ref: match?.zone_id_ref || null,
		account_ref: match?.account_ref || null,
		eligible_for_cloudmail: match?.eligible_for_cloudmail ?? null,
		risk_flags: match?.risk_flags || []
	});
}

async function discover(c, rawDomain) {
	const domain = normalizeDomain(rawDomain);
	if (!domain || !domain.includes('.')) throw new BizError('Invalid domain.', 400);
	const answers = {
		ns: await dnsQuery(domain, 'NS'),
		mx: await dnsQuery(domain, 'MX'),
		txt: await dnsQuery(domain, 'TXT'),
		dmarc: await dnsQuery(`_dmarc.${domain}`, 'TXT'),
		dkim: await dnsQuery(`cf2024-1._domainkey.${domain}`, 'TXT')
	};
	const dns = scanDnsState(domain, answers);
	const zone = await resolveZone(c, domain);
	const cloudflare = {
		accountReference: zone.accountReference || null,
		zoneId: zone.zoneId || null,
		zoneStatus: zone.zoneStatus || null,
		nameServers: zone.nameServers || [],
		zoneSource: zone.source,
		zoneError: zone.error || null,
		dnsRecords: [],
		emailRouting: { configured: false, status: 'unknown' },
		emailWorkerRoute: { status: 'unknown' },
		emailSending: { authorized: null, status: 'unknown' },
		catchAll: { status: 'unknown' }
	};
	if (zone.zoneId) {
		const [records, routing, rules, sending] = await Promise.all([
			cloudflareRequest(c, `/zones/${zone.zoneId}/dns_records?per_page=100`),
			cloudflareRequest(c, `/zones/${zone.zoneId}/email/routing`),
			cloudflareRequest(c, `/zones/${zone.zoneId}/email/routing/rules`),
			cloudflareRequest(c, `/zones/${zone.zoneId}/email/sending/subdomains`)
		]);
		if (records.ok) {
			cloudflare.dnsRecords = (records.result || []).map(record => ({
				id: record.id,
				type: record.type,
				name: record.name,
				content: record.content,
				priority: record.priority || null,
				proxied: record.proxied || false
			}));
		}
		cloudflare.emailRouting = routing.ok ? {
			configured: true,
			enabled: Boolean(routing.result?.enabled),
			status: routing.result?.status || (routing.result?.enabled ? 'ready' : 'disabled'),
			tag: routing.result?.tag || null
		} : { configured: false, status: 'unknown', error: routing.error, code: routing.code || null };
		const routingRules = rules.ok && Array.isArray(rules.result) ? rules.result : [];
		cloudflare.emailWorkerRoute = {
			status: routingRules.some(rule => (rule.actions || []).some(action => action.type === 'worker')) ? 'READY' : 'UNKNOWN_OR_MISSING_EXPLICIT_RULE',
			ruleCount: routingRules.length
		};
		const catchAll = routingRules.find(rule => (rule.matchers || []).some(matcher => matcher.type === 'all'));
		cloudflare.catchAll = catchAll ? {
			status: catchAll.enabled ? 'READY' : 'DISABLED',
			actionTypes: (catchAll.actions || []).map(action => action.type)
		} : { status: 'UNKNOWN_OR_MISSING' };
		cloudflare.emailSending = sending.ok
			? { authorized: true, status: Array.isArray(sending.result) && sending.result.length ? 'ready' : 'not_configured' }
			: { authorized: false, status: 'blocked', error: sending.error, code: sending.code || null };
	}
	const outboundProvider = await selectOutboundProvider(domain, cloudflare, c);
	const discovery = {
		domain,
		managedByCloudMailConfig: managedDomains(c).includes(domain),
		dns,
		desiredDnsRecords: desiredDnsState(domain),
		cloudflare,
		outboundProvider,
		securityFoundation: {
			retention_policies: 'modeled',
			expiration_policies: 'modeled',
			legal_holds: 'modeled',
			audit_events: 'modeled',
			secure_link_metadata: 'modeled',
			rulePrecedence: 'Legal Hold > Retention > Expiration > User Delete'
		}
	};
	return { ...discovery, readiness: readinessFrom(discovery) };
}

async function scanDomain(c, rawDomain) {
	const discovery = await discover(c, rawDomain);
	const readiness = discovery.readiness;
	const scanner = {
		domain_name: discovery.domain,
		instance: domainInstance(discovery.domain, readiness.provisioning_state),
		checks: {
			MX: normalizeReadinessStatus(readiness.mx_status),
			SPF: normalizeReadinessStatus(readiness.spf_status),
			DKIM: normalizeReadinessStatus(readiness.dkim_status),
			DMARC: normalizeReadinessStatus(readiness.dmarc_status),
			Email_Routing: normalizeReadinessStatus(readiness.inbound_email_worker_status),
			Catch_all: normalizeReadinessStatus(discovery.cloudflare.catchAll?.status),
			Email_Worker_route: normalizeReadinessStatus(discovery.cloudflare.emailWorkerRoute?.status),
			Email_Sending_readiness: normalizeReadinessStatus(readiness.outbound_provider_status),
			outbound_provider_readiness: normalizeReadinessStatus(readiness.outbound_provider_status),
			mailbox_readiness: normalizeReadinessStatus(readiness.mailbox_status),
			identity_readiness: normalizeReadinessStatus(readiness.identity_status),
			security_foundation_readiness: normalizeReadinessStatus(readiness.security_foundation)
		},
		readiness,
		blockers: readiness.blockers
	};
	return scanner;
}

async function autoconfigure(c, rawDomain, options = {}) {
	const domain = normalizeDomain(rawDomain);
	const mode = options.mode === 'apply' ? 'apply' : 'dry-run';
	const discovery = await discover(c, domain);
	const plan = compareDesiredDnsState(discovery.desiredDnsRecords, discovery.cloudflare.dnsRecords);
	const auditState = await auditP31Event(c, domain, 'p31_safe_autoconfig_attempted', mode, {
		mode,
		plannedChanges: plan.filter(row => row.action === 'create_if_safe').length,
		conflicts: plan.filter(row => row.action === 'report_conflict').length
	});
	if (mode !== 'apply') {
		return { mode: 'dry-run', applied: false, audit: auditState, plan, readiness: discovery.readiness };
	}
	if (String(c.env.CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED || '').toLowerCase() !== 'true') {
		return { mode: 'apply', applied: false, audit: auditState, blocker: 'CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED_not_true', plan, readiness: discovery.readiness };
	}
	if (!discovery.cloudflare.zoneId) {
		return { mode: 'apply', applied: false, audit: auditState, blocker: 'cloudflare_zone_not_resolved', plan, readiness: discovery.readiness };
	}
	const applied = [];
	for (const item of plan.filter(row => row.action === 'create_if_safe')) {
		if (!['dmarc_policy'].includes(item.desired.purpose)) continue;
		const response = await cloudflareRequest(c, `/zones/${discovery.cloudflare.zoneId}/dns_records`, {
			method: 'POST',
			body: JSON.stringify({
				type: item.desired.type,
				name: item.desired.name,
				content: item.desired.content,
				ttl: 1
			})
		});
		applied.push({ purpose: item.desired.purpose, ok: response.ok, status: response.status, error: response.error || null });
	}
	return { mode: 'apply', audit: auditState, applied: applied.length > 0, appliedRecords: applied, plan, readiness: (await discover(c, domain)).readiness };
}

function lifecycleDryRun(input = {}) {
	const now = Number(input.now || Date.now());
	const legalHold = Boolean(input.legal_hold || input.legalHold);
	const retentionUntil = Number(input.retention_until || input.retentionUntil || 0);
	const expiresAt = Number(input.expires_at || input.expiresAt || 0);
	const userDeleteRequested = Boolean(input.user_delete_requested || input.userDeleteRequested);
	if (legalHold) {
		return { action: 'preserve', reason: 'legal_hold_overrides_retention_expiration_and_user_delete', destructive: false, audit_event: 'lifecycle_legal_hold_preserved' };
	}
	if (retentionUntil && retentionUntil > now) {
		return { action: 'preserve', reason: 'retention_policy_active', destructive: false, audit_event: 'lifecycle_retention_preserved' };
	}
	if (expiresAt && expiresAt <= now) {
		return { action: 'eligible_for_expiration_queue', reason: 'expired_without_legal_hold_or_retention', destructive: false, audit_event: 'lifecycle_expiration_planned' };
	}
	if (userDeleteRequested) {
		return { action: 'eligible_for_user_delete_queue', reason: 'user_delete_allowed_after_legal_hold_and_retention_checks', destructive: false, audit_event: 'lifecycle_user_delete_planned' };
	}
	return { action: 'preserve', reason: 'not_expired', destructive: false, audit_event: 'lifecycle_preserved_not_expired' };
}

function retentionPolicyFoundation(domain, input = {}) {
	const retentionDays = Number(input.retention_days || input.retentionDays || 365);
	return {
		domain_name: normalizeDomain(domain),
		model: 'retention_policies',
		default_retention_days: retentionDays,
		applies_to: input.applies_to || 'mail',
		enabled: input.enabled !== false,
		destructive: false,
		audit_event: 'retention_policy_evaluated'
	};
}

function expirationPolicyFoundation(domain, input = {}) {
	const expireAfterDays = Number(input.expire_after_days || input.expireAfterDays || 730);
	return {
		domain_name: normalizeDomain(domain),
		model: 'expiration_policies',
		expire_after_days: expireAfterDays,
		destructive_enabled: false,
		planner_action: 'queue_candidate_only',
		destructive: false,
		audit_event: 'expiration_policy_evaluated'
	};
}

function legalHoldFoundation(domain, input = {}) {
	const active = Boolean(input.legal_hold || input.legalHold);
	return {
		domain_name: normalizeDomain(domain),
		model: 'legal_holds',
		active,
		precedence: 'Legal Hold > Retention > Expiration > User Delete',
		override_enforced: true,
		destructive: false,
		audit_event: active ? 'legal_hold_override_applied' : 'legal_hold_checked'
	};
}

function secureLinkStateFrom(input = {}) {
	const now = Number(input.now || Date.now());
	if (input.disabled) return SecureLinkState.DISABLED;
	if (input.legal_hold || input.legalHold) return SecureLinkState.LEGAL_HOLD_LOCKED;
	if (input.revoked_at || input.revokedAt) return SecureLinkState.REVOKED;
	const expiresAt = Number(input.expires_at || input.expiresAt || 0);
	if (expiresAt && expiresAt <= now) return SecureLinkState.EXPIRED;
	if (input.active === false) return SecureLinkState.DRAFT;
	return SecureLinkState.ACTIVE;
}

function secureLinkMetadataFoundation(domain, input = {}) {
	const status = secureLinkStateFrom(input);
	return {
		domain_name: normalizeDomain(domain),
		model: 'secure_link_metadata',
		status,
		allowed_states: Object.values(SecureLinkState),
		expires_at: input.expires_at || input.expiresAt || null,
		revoked_at: input.revoked_at || input.revokedAt || null,
		view_limit: Number(input.view_limit || input.viewLimit || 0) || null,
		attachment_download_policy: input.attachment_download_policy || input.attachmentDownloadPolicy || 'metadata_only_until_secure_send_enabled',
		destructive: false,
		audit_events: ['secure_link_open_planned', 'secure_link_download_planned', 'secure_link_revoke_planned', 'secure_link_expire_planned']
	};
}

function secureLifecyclePlan(domain, input = {}) {
	const lifecycle = lifecycleDryRun(input);
	const legalHold = legalHoldFoundation(domain, input);
	const retention = retentionPolicyFoundation(domain, input);
	const expiration = expirationPolicyFoundation(domain, input);
	const secureLink = secureLinkMetadataFoundation(domain, input);
	return {
		domain_name: normalizeDomain(domain),
		mode: 'dry-run',
		destructive: false,
		precedence: 'Legal Hold > Retention > Expiration > User Delete',
		message_security_state: {
			action: lifecycle.action,
			reason: lifecycle.reason,
			destructive: false
		},
		attachment_security_state: {
			action: legalHold.active ? 'preserve' : 'evaluate_only',
			reason: legalHold.active ? 'legal_hold_prevents_attachment_pruning' : 'attachment_pruning_not_enabled',
			destructive: false
		},
		retention_policy: retention,
		expiration_policy: expiration,
		legal_hold: legalHold,
		secure_link: secureLink,
		audit_events: [
			lifecycle.audit_event,
			retention.audit_event,
			expiration.audit_event,
			legalHold.audit_event,
			...secureLink.audit_events
		].filter(Boolean)
	};
}

function inboundFoundation(domain) {
	return {
		domain_name: normalizeDomain(domain),
		architecture: [
			'Cloudflare Email Worker',
			'CloudMail Ingest',
			'Domain resolve',
			'Mailbox resolve',
			'MIME parse',
			'Bad message isolation',
			'Security classification',
			'Retention / expiration tagging',
			'Audit event',
			'Ledger write',
			'D1 metadata',
			'R2 attachment storage if applicable'
		],
		preserves: ['P28 bad message tolerance', 'ProviderAccepted != Delivered', 'attachment ledger behavior', 'All Mail ledger behavior'],
		status: 'FOUNDATION_READY'
	};
}

function mailboxIdentityCapabilityFoundation(domain) {
	const normalized = normalizeDomain(domain);
	return {
		domain_name: normalized,
		namespace: normalized ? `${normalized}:mailboxes` : null,
		mailbox_creation_model: 'domain_scoped_local_part',
		identity_creation_model: 'domain_scoped_identity',
		routing_association: 'domain_to_mailbox_to_worker_route',
		capability_matrix: {
			receive: 'pending_domain_readiness',
			send: 'pending_outbound_provider',
			attachments: 'ready',
			ai: 'local_only'
		},
		admin_owner_linkage: 'modeled',
		account_health_state: 'modeled'
	};
}

function securityFoundation(domain) {
	return {
		domain_name: normalizeDomain(domain),
		models: [
			'retention_policies',
			'expiration_policies',
			'legal_holds',
			'security_classifications',
			'secure_link_metadata',
			'audit_events',
			'message_security_state',
			'attachment_security_state',
			'domain_security_policy'
		],
		rule_precedence: 'Legal Hold > Retention > Expiration > User Delete',
		destructive_defaults: false,
		status: 'FOUNDATION_READY'
	};
}

function lifecycleDryRunFoundation(domain, input = {}) {
	const plan = secureLifecyclePlan(domain, input);
	return {
		domain_name: normalizeDomain(domain),
		expiration_scan: plan.message_security_state,
		retention_policy_dry_run: { action: 'evaluate_only', destructive: false, model: 'retention_policies' },
		legal_hold_override_guard: { enforced: true, destructive: false, precedence: plan.precedence },
		secure_link_expiration_dry_run: { action: 'evaluate_only', destructive: false, status: plan.secure_link.status },
		audit_rollup_dry_run: { action: 'summarize_only', destructive: false },
		domain_revalidation_dry_run: { action: 'scan_only', destructive: false },
		secure_lifecycle_plan: plan
	};
}

function secureLinkApiContract(domain = null) {
	return {
		domain_name: normalizeDomain(domain),
		statuses: Object.values(SecureLinkState),
		metadata_fields: [
			'token_hash',
			'target_type',
			'target_id',
			'expires_at',
			'revoked_at',
			'view_limit',
			'attachment_download_policy',
			'access_count',
			'legal_hold_id',
			'metadata_json'
		],
		audit_events: ['open', 'download', 'revoke', 'expire'].map(action => `secure_link_${action}`),
		endpoints: [
			'POST /api/v2/security/secure-links/dry-run',
			'POST /api/v2/security/secure-links/:id/revoke/dry-run',
			'GET /api/v2/security/secure-links/contract'
		],
		secure_send_usability: 'FOUNDATION_ONLY_NOT_CLAIMED',
		destructive: false
	};
}

function uiApiContract() {
	return {
		states: [
			'No Cloudflare connected',
			'Cloudflare connected but no domain selected',
			'Domain selected',
			'Scan running',
			'Needs configuration',
			'Configuring',
			'DNS pending',
			'Ready',
			'Partial with blocker',
			'Failed'
		],
		endpoints: [
			'GET /api/v2/p31/cloudflare/zones',
			'POST /api/v2/p31/domains/select',
			'GET /api/v2/p31/domains/:domain/scan',
			'POST /api/v2/p31/domains/:domain/enable',
			'GET /api/v2/p31/ui-contract'
		],
		user_flow: ['Connect Cloudflare', 'List domains', 'Select domain', 'Scan', 'Enable CloudMail', 'Show readiness', 'Show exact blockers', 'Create mailbox', 'Show security foundation status']
	};
}

async function enableCloudMail(c, rawDomain, options = {}) {
	const scan = await scanDomain(c, rawDomain);
	const autoconfig = await autoconfigure(c, rawDomain, { mode: options.apply === true ? 'apply' : 'dry-run' });
	return {
		zero_touch_engine: 'READY',
		domain_instance_status: scan.readiness.real_domain_state,
		production_execution: 'NOT_AUTHORIZED',
		apply_authorized: options.apply === true && String(c.env.CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED || '').toLowerCase() === 'true',
		scan,
		autoconfig,
		inbound: inboundFoundation(rawDomain),
		outbound: outboundProviderAdapters().map(adapter => ({ provider: adapter.kind, interface: 'OutboundProviderAdapter' })),
		mailbox_identity_capability: mailboxIdentityCapabilityFoundation(rawDomain),
		security: securityFoundation(rawDomain),
		lifecycle: lifecycleDryRunFoundation(rawDomain)
	};
}

async function provisionFoundation(c, rawDomain) {
	const domain = normalizeDomain(rawDomain);
	const discovery = await discover(c, domain);
	const statements = [
		'cloudmail_domains',
		'domain_readiness_snapshots',
		'mailboxes',
		'domain_identities',
		'domain_capabilities',
		'retention_policies',
		'expiration_policies',
		'legal_holds',
		'security_classifications',
		'secure_link_metadata',
		'message_security_state',
		'attachment_security_state',
		'domain_security_policy',
		'audit_events'
	];
	let databaseWrite = 'not_attempted';
	try {
		await c.env.db.prepare(
			`INSERT INTO audit_logs (actor_role, action, resource_type, outcome, metadata_json)
			 VALUES ('system', 'p31_domain_foundation_validated', 'domain', ?1, ?2)`
		).bind(discovery.readiness.real_domain_state, JSON.stringify(safeJson({
			domain,
			blockerCount: discovery.readiness.blockers.length,
			provisioningState: discovery.readiness.provisioning_state
		}))).run();
		databaseWrite = 'audit_event_recorded';
	} catch {
		databaseWrite = 'audit_table_unavailable_or_not_migrated';
	}
	return {
		domain,
		databaseWrite,
		requiredTables: statements,
		migration: '0023_p31_domain_security_foundation.sql',
		readiness: discovery.readiness,
		lifecycleDryRun: lifecycleDryRun({})
	};
}

const p31DomainFoundationService = {
	discoverZones,
	selectDomain,
	discover,
	scanDomain,
	autoconfigure,
	enableCloudMail,
	provisionFoundation,
	lifecycleDryRun,
	lifecycleDryRunFoundation,
	secureLifecyclePlan,
	secureLinkMetadataFoundation,
	secureLinkApiContract,
	inboundFoundation,
	mailboxIdentityCapabilityFoundation,
	securityFoundation,
	uiApiContract,
	desiredDnsState,
	desiredDmarcState,
	evaluateDmarcRecords,
	compareDesiredDnsState,
	readinessFrom
};

export default p31DomainFoundationService;
