import BizError from '../error/biz-error';
import p31DomainFoundationService from './p31-domain-foundation-service';
import p32cEnterpriseGovernanceService from './p32c-enterprise-governance-service';
import { AddMailboxStatus, resolveEffectiveAuthority } from './effective-authority-resolver';

export const AuthorityState = Object.freeze({ AUTHORIZED: 'AUTHORIZED', PARTIALLY_AUTHORIZED: 'PARTIALLY_AUTHORIZED', AUTHORIZATION_REQUIRED: 'AUTHORIZATION_REQUIRED', UNSUPPORTED: 'UNSUPPORTED' });
export const LifecycleState = Object.freeze({ DISCOVERING: 'DISCOVERING', CONFIGURING: 'CONFIGURING', VALIDATING: 'VALIDATING', REPAIRING: 'REPAIRING', READY: 'READY', NEEDS_ATTENTION: 'NEEDS_ATTENTION', BLOCKED: 'BLOCKED' });

const CAPABILITIES = Object.freeze({
	cloudflare: { title: 'Cloudflare', authorization: 'api_token_or_oauth', scopes: ['Zone:Read', 'DNS:Read', 'DNS:Edit', 'Email Routing:Read', 'Email Routing:Edit'], capabilities: ['domain_discovery', 'dns_read', 'dns_write', 'routing_read', 'routing_write', 'security_repair'], operational: ['domain_discovery', 'dns_read', 'dns_write', 'routing_read', 'routing_write'], limitations: ['mailbox_provisioning_unsupported', 'calendar_unsupported'] },
	google_workspace: { title: 'Google Workspace', authorization: 'oauth2', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/admin.directory.user', 'https://www.googleapis.com/auth/admin.directory.group'], capabilities: ['mail_read_write', 'mail_send', 'calendar_read_write', 'directory_read_write', 'identity_provisioning', 'group_discovery'], operational: ['mail_read_write', 'mail_send'], limitations: ['admin_features_require_workspace_admin_consent', 'dns_requires_separate_provider_authority'] },
	microsoft_365: { title: 'Microsoft 365 / Exchange Online', authorization: 'oauth2_admin_consent', scopes: ['openid', 'profile', 'offline_access', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite', 'User.Read.All', 'Group.ReadWrite.All', 'Directory.ReadWrite.All', 'Domain.ReadWrite.All'], capabilities: ['mail_read_write', 'mail_send', 'calendar_read_write', 'directory_read_write', 'mailbox_provisioning', 'group_discovery'], operational: [], limitations: ['adapter_contract_only_not_live_validated', 'tenant_admin_consent_required', 'dns_may_require_separate_provider'] },
	fastmail: { title: 'Fastmail', authorization: 'oauth2_jmap', scopes: ['urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission', 'urn:ietf:params:jmap:calendars'], capabilities: ['mail_read_write', 'mail_send', 'calendar_read_write', 'alias_management'], operational: [], limitations: ['adapter_contract_only_not_live_validated'] },
	zoho: { title: 'Zoho Mail', authorization: 'oauth2', scopes: ['ZohoMail.accounts.READ', 'ZohoMail.messages.ALL', 'ZohoMail.organization.accounts.ALL', 'ZohoCalendar.calendar.ALL'], capabilities: ['mail_read_write', 'calendar_read_write', 'organization_discovery', 'mailbox_provisioning'], operational: [], limitations: ['adapter_contract_only_not_live_validated'] },
	proton: { title: 'Proton', authorization: 'provider_limited', scopes: [], capabilities: ['provider_detection'], operational: ['provider_detection'], limitations: ['no_supported_public_admin_automation_path_declared'] },
	custom_imap_smtp: { title: 'Custom IMAP / SMTP', authorization: 'user_credentials_or_app_password', scopes: [], capabilities: ['mail_read', 'mail_send', 'provider_detection'], operational: [], limitations: ['no_dns_or_mailbox_admin_authority', 'credential_validation_required'] },
	custom_domain: { title: 'Custom Domain', authorization: 'dns_provider_dependent', scopes: [], capabilities: ['dns_discovery', 'provider_detection'], operational: ['dns_discovery', 'provider_detection'], limitations: ['writes_require_detected_dns_provider_authority'] }
});
const FEATURE_CAPABILITIES = Object.freeze({ domain_autonomy: ['domain_discovery', 'dns_read', 'dns_write', 'routing_read', 'routing_write', 'security_repair'], mail: ['mail_read_write', 'mail_send'], calendar: ['calendar_read_write'], organization: ['directory_read_write', 'group_discovery'], provisioning: ['identity_provisioning', 'mailbox_provisioning'], aliases: ['alias_management'] });
const PROVIDER_FEATURE_CAPABILITIES = Object.freeze({
	custom_domain: { domain_autonomy: ['dns_discovery', 'provider_detection'] },
	custom_imap_smtp: { mail: ['mail_read', 'mail_send'] },
	proton: { mail: ['provider_detection'], domain_autonomy: ['provider_detection'] },
	zoho: { organization: ['organization_discovery'], provisioning: ['mailbox_provisioning'] }
});
const CAPABILITY_SCOPES = Object.freeze({
	cloudflare: {
		domain_discovery: ['Zone:Read'], dns_read: ['DNS:Read'], dns_write: ['DNS:Edit'], routing_read: ['Email Routing:Read'], routing_write: ['Email Routing:Edit'], security_repair: ['DNS:Read', 'DNS:Edit']
	},
	google_workspace: {
		mail_read_write: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify'], mail_send: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
		calendar_read_write: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'], directory_read_write: ['openid', 'email', 'https://www.googleapis.com/auth/admin.directory.user'],
		identity_provisioning: ['openid', 'email', 'https://www.googleapis.com/auth/admin.directory.user'], group_discovery: ['openid', 'email', 'https://www.googleapis.com/auth/admin.directory.group']
	},
	microsoft_365: {
		mail_read_write: ['openid', 'profile', 'offline_access', 'Mail.ReadWrite'], mail_send: ['openid', 'profile', 'offline_access', 'Mail.Send'],
		calendar_read_write: ['openid', 'profile', 'offline_access', 'Calendars.ReadWrite'], directory_read_write: ['openid', 'profile', 'offline_access', 'User.Read.All', 'Directory.ReadWrite.All'],
		mailbox_provisioning: ['openid', 'profile', 'offline_access', 'Directory.ReadWrite.All', 'Domain.ReadWrite.All'], group_discovery: ['openid', 'profile', 'offline_access', 'Group.ReadWrite.All']
	},
	fastmail: { mail_read_write: ['urn:ietf:params:jmap:mail'], mail_send: ['urn:ietf:params:jmap:submission'], calendar_read_write: ['urn:ietf:params:jmap:calendars'], alias_management: ['urn:ietf:params:jmap:mail'] },
	zoho: { mail_read_write: ['ZohoMail.messages.ALL'], calendar_read_write: ['ZohoCalendar.calendar.ALL'], organization_discovery: ['ZohoMail.organization.accounts.ALL'], mailbox_provisioning: ['ZohoMail.organization.accounts.ALL'] }
});

function normalizeProvider(value) {
	const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
	if (['google', 'gmail', 'workspace'].includes(raw)) return 'google_workspace';
	if (['microsoft', 'office365', 'exchange', 'exchange_online'].includes(raw)) return 'microsoft_365';
	if (['imap', 'smtp', 'custom_imap', 'custom_smtp'].includes(raw)) return 'custom_imap_smtp';
	return CAPABILITIES[raw] ? raw : 'custom_domain';
}
function normalizeDomain(value) { return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/\.$/, ''); }
function domainFromEmail(value) { const parts = String(value || '').trim().toLowerCase().split('@'); return parts.length === 2 ? normalizeDomain(parts[1]) : ''; }
function unique(values = []) { return [...new Set(values.map(String).map(value => value.trim()).filter(Boolean))]; }
function redactedEvidence(value) {
	const forbidden = /(token|secret|password|cookie|authorization|credential|content|body|private.?key)/i;
	if (Array.isArray(value)) return value.map(redactedEvidence);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, nested]) => [key, redactedEvidence(nested)]));
}

function providerCapabilityMatrix() {
	return Object.entries(CAPABILITIES).map(([provider, value]) => ({ provider, ...value, scope_count: value.scopes.length, implementation_state: value.operational.length === value.capabilities.length ? 'OPERATIONAL' : value.operational.length ? 'PARTIAL' : 'DECLARED_NOT_VALIDATED' }));
}
function providerAdapter(provider) {
	const normalized = normalizeProvider(provider), descriptor = CAPABILITIES[normalized];
	const implementationState = descriptor.operational.length === descriptor.capabilities.length ? 'OPERATIONAL' : descriptor.operational.length ? 'PARTIAL' : 'DECLARED_NOT_VALIDATED';
	return {
		provider: normalized,
		title: descriptor.title,
		authorization_type: descriptor.authorization,
		implementation_state: implementationState,
		declared_capabilities: descriptor.capabilities,
		operational_capabilities: descriptor.operational,
		limitations: descriptor.limitations
	};
}
function authorityMaximization(input = {}) {
	const provider = normalizeProvider(input.provider), descriptor = CAPABILITIES[provider];
	const features = unique(input.features?.length ? input.features : ['domain_autonomy', 'mail', 'calendar', 'organization', 'provisioning', 'aliases']);
	const providerFeatures = PROVIDER_FEATURE_CAPABILITIES[provider] || {};
	const desired = unique(features.flatMap(feature => providerFeatures[feature] || FEATURE_CAPABILITIES[feature] || []));
	const supported = desired.filter(capability => descriptor.capabilities.includes(capability));
	const scopeMap = CAPABILITY_SCOPES[provider] || {};
	const requested = unique(supported.flatMap(capability => scopeMap[capability] || []));
	const suppliedGrants = unique(input.granted_scopes || input.grantedScopes || []), granted = suppliedGrants.filter(scope => requested.includes(scope)), ignoredScopes = suppliedGrants.filter(scope => !requested.includes(scope)), missing = requested.filter(scope => !granted.includes(scope));
	const unsupported = desired.filter(capability => !descriptor.capabilities.includes(capability));
	const verifiedCapabilities = unique(input.verified_capabilities || input.verifiedCapabilities || []);
	const allSupportedVerified = supported.length > 0 && supported.every(capability => verifiedCapabilities.includes(capability));
	const missingCapabilityVerification = supported.filter(capability => !verifiedCapabilities.includes(capability));
	const scopeState = !supported.length ? AuthorityState.UNSUPPORTED : requested.length === 0 ? AuthorityState.AUTHORIZATION_REQUIRED : missing.length === 0 ? AuthorityState.AUTHORIZED : granted.length ? AuthorityState.PARTIALLY_AUTHORIZED : AuthorityState.AUTHORIZATION_REQUIRED;
	// A returned OAuth scope is not proof that the provider accepted it or that the
	// adapter can exercise it. Only a callback/probe may mark capability evidence.
	const state = scopeState === AuthorityState.AUTHORIZED && !allSupportedVerified ? AuthorityState.AUTHORIZATION_REQUIRED : scopeState;
	return { provider, authority_state: state, authorization_type: descriptor.authorization, requested_scopes: requested, granted_scopes: granted, ignored_unrelated_scopes: ignoredScopes, missing_scopes: missing, verified_capabilities: verifiedCapabilities.filter(capability => supported.includes(capability)), missing_capability_verification: missingCapabilityVerification, capability_verification_required: missingCapabilityVerification.length > 0, selected_features: features, supported_capabilities: supported, unsupported_capabilities: unsupported, consent_required: state === AuthorityState.AUTHORIZATION_REQUIRED || state === AuthorityState.PARTIALLY_AUTHORIZED, silent_escalation_allowed: false, refresh_policy: 'provider_supported_refresh_then_explicit_reauthorization_if_required', truth: 'maximum_safe_relevant_authority_not_unrelated_account_access' };
}
function authorityGraph(input = {}) {
	const max = authorityMaximization(input), subject = String(input.subject_ref || input.subjectRef || input.email || 'unbound');
	return { schema_version: 1, generated_at: input.generated_at || new Date(0).toISOString(), authority_state: max.authority_state,
		nodes: [{ id: `subject:${subject}`, type: 'SUBJECT', label: subject }, { id: `provider:${max.provider}`, type: 'PROVIDER', label: CAPABILITIES[max.provider].title }, ...max.supported_capabilities.map(value => ({ id: `capability:${value}`, type: 'CAPABILITY', label: value })), ...max.requested_scopes.map(value => ({ id: `scope:${value}`, type: 'SCOPE', label: value, granted: max.granted_scopes.includes(value) }))],
		edges: [{ from: `subject:${subject}`, to: `provider:${max.provider}`, relationship: 'AUTHORIZES_WITH' }, ...max.supported_capabilities.map(value => ({ from: `provider:${max.provider}`, to: `capability:${value}`, relationship: 'SUPPORTS' })), ...max.requested_scopes.map(value => ({ from: `provider:${max.provider}`, to: `scope:${value}`, relationship: max.granted_scopes.includes(value) ? 'GRANTED' : 'REQUESTED' }))],
		evidence: redactedEvidence(input.evidence || {}), missing_scopes: max.missing_scopes };
}
function detectProvider(input = {}) {
	const domain = normalizeDomain(input.domain || domainFromEmail(input.email)), mx = (input.mx || []).map(value => String(value).toLowerCase());
	if (domain.endsWith('gmail.com') || mx.some(value => value.includes('google.com'))) return 'google_workspace';
	if (mx.some(value => value.includes('outlook.com') || value.includes('protection.outlook'))) return 'microsoft_365';
	if (mx.some(value => value.includes('fastmail'))) return 'fastmail'; if (mx.some(value => value.includes('zoho'))) return 'zoho'; if (mx.some(value => value.includes('protonmail'))) return 'proton';
	return normalizeProvider(input.provider || 'custom_domain');
}
function customDomainOnboarding(input = {}) {
	const identifier = String(input.email_or_domain || input.emailOrDomain || input.email || input.domain || '').trim().toLowerCase();
	const email = identifier.includes('@') ? identifier : '';
	const domain = normalizeDomain(input.domain || domainFromEmail(email) || identifier);
	if (!domain) throw new BizError('A valid email or domain is required.', 400);
	// Mail and infrastructure are separate provider adapters. A DNS host is not a
	// mailbox host, and a mailbox MX discovery must not be mistaken for DNS authority.
	const legacyProvider = normalizeProvider(input.provider);
	const mailboxProvider = detectProvider({ ...input, email, domain, provider: input.mailbox_provider || input.mailboxProvider || (legacyProvider === 'cloudflare' ? 'custom_domain' : input.provider) });
	const infrastructureProvider = normalizeProvider(input.infrastructure_provider || input.infrastructureProvider || (legacyProvider === 'cloudflare' ? 'cloudflare' : 'custom_domain'));
	const selectedFeatures = unique(input.features?.length ? input.features : ['domain_autonomy', 'mail', 'calendar', 'organization', 'provisioning', 'aliases']);
	const mailboxFeatures = selectedFeatures.filter(feature => feature !== 'domain_autonomy');
	const infrastructureFeatures = selectedFeatures.includes('domain_autonomy') ? ['domain_autonomy'] : [];
	const mailboxAuthority = authorityMaximization({ provider: mailboxProvider, features: mailboxFeatures, granted_scopes: input.granted_scopes, verified_capabilities: input.verified_capabilities });
	const infrastructureAuthority = authorityMaximization({ provider: infrastructureProvider, features: infrastructureFeatures, granted_scopes: input.granted_scopes, verified_capabilities: input.verified_capabilities });
	const authority = infrastructureAuthority; // Compatibility projection for existing clients.
	const mailboxAdapter = providerAdapter(mailboxProvider), infrastructureAdapter = providerAdapter(infrastructureProvider);
	const hasMailboxDiscovery = input.mx?.length > 0;
	const hasInfrastructureDiscovery = hasMailboxDiscovery || Boolean(input.infrastructure_provider || input.infrastructureProvider || legacyProvider !== 'custom_domain');
	const calendarProvider = mailboxAdapter.declared_capabilities.includes('calendar_read_write') ? mailboxProvider : null;
	const identityProvider = mailboxAdapter.declared_capabilities.some(capability => ['directory_read_write', 'identity_provisioning', 'organization_discovery'].includes(capability)) ? mailboxProvider : null;
	const providerGraph = {
		// The original flat keys remain for existing clients. The adapter records are
		// the source of truth for discovery and operational status.
		mailbox_provider: mailboxProvider,
		infrastructure_provider: infrastructureProvider,
		dns_provider: infrastructureProvider,
		calendar_provider: calendarProvider,
		identity_provider: identityProvider,
		adapters: {
			mailbox: { ...mailboxAdapter, discovery_state: hasMailboxDiscovery ? 'DISCOVERED' : 'DISCOVERY_REQUIRED' },
			infrastructure: { ...infrastructureAdapter, discovery_state: hasInfrastructureDiscovery ? 'DISCOVERED' : 'DISCOVERY_REQUIRED' },
			dns: { ...infrastructureAdapter, discovery_state: hasInfrastructureDiscovery ? 'DISCOVERED' : 'DISCOVERY_REQUIRED' },
			calendar: calendarProvider ? { ...mailboxAdapter, provider: calendarProvider, discovery_state: hasMailboxDiscovery ? 'DISCOVERED' : 'DISCOVERY_REQUIRED' } : { provider: null, discovery_state: 'PROVIDER_UNSUPPORTED', reason: 'MAILBOX_ADAPTER_HAS_NO_CALENDAR_CAPABILITY' },
			identity: identityProvider ? { ...mailboxAdapter, provider: identityProvider, discovery_state: hasMailboxDiscovery ? 'DISCOVERED' : 'DISCOVERY_REQUIRED' } : { provider: null, discovery_state: 'PROVIDER_UNSUPPORTED', reason: 'MAILBOX_ADAPTER_HAS_NO_IDENTITY_CAPABILITY' }
		}
	};
	const blockers = [];
	if (mailboxAuthority.authority_state !== AuthorityState.AUTHORIZED) blockers.push({ code: 'MAILBOX_AUTHORIZATION_REQUIRED', provider: mailboxProvider, missing_scopes: mailboxAuthority.missing_scopes });
	if (infrastructureAuthority.authority_state !== AuthorityState.AUTHORIZED) blockers.push({ code: 'INFRASTRUCTURE_AUTHORIZATION_REQUIRED', provider: infrastructureProvider, missing_scopes: infrastructureAuthority.missing_scopes });
	for (const key of ['mx', 'spf', 'dkim', 'dmarc']) if (input.observed?.[key]?.status && input.observed[key].status !== 'READY') blockers.push({ code: `${key.toUpperCase()}_${input.observed[key].status}` });
	const allAuthorityGranted = mailboxAuthority.authority_state === AuthorityState.AUTHORIZED && infrastructureAuthority.authority_state === AuthorityState.AUTHORIZED;
	// Discovery has no authority to classify an unverified grant as a hard block.
	// The authoritative server-side call adds inherited grants; this projection
	// nevertheless uses the identical state vocabulary so UI never receives a
	// generic AUTHORIZATION_REQUIRED → BLOCKED conversion.
	const addMailbox = resolveEffectiveAuthority({
		domain_verified: input.domain_verified === true,
		mailbox_exists: input.mailbox_exists === true,
		policy_blocked: input.workspace_policy?.deny_add_mailbox === true,
		security_blocked: input.security_restriction === true,
		provider_capability: { core_satisfied: allAuthorityGranted }
	});
	const discoveryBlocked = addMailbox.blocked;
	return { email, domain, provider: mailboxProvider, mailbox_provider: mailboxProvider, infrastructure_provider: infrastructureProvider, priority: 'CUSTOM_DOMAIN_FIRST', selected_features: selectedFeatures, discovery_state: input.mx?.length || input.observed ? 'DISCOVERY_COMPLETE' : 'DISCOVERY_IN_PROGRESS', domain_state: input.domain_verified === true ? 'DOMAIN_REUSED' : 'DOMAIN_FOUND', infrastructure_state: input.mx?.length || input.observed ? 'INFRASTRUCTURE_FOUND' : 'DISCOVERY_IN_PROGRESS', identity_state: identityProvider ? 'IDENTITY_PROVIDER_DISCOVERED' : 'IDENTITY_DISCOVERY_REQUIRED', mailbox_state: input.mx?.length ? 'MAILBOX_PROVIDER_DISCOVERED' : 'MAILBOX_DISCOVERY_REQUIRED', authority_state: allAuthorityGranted ? AuthorityState.AUTHORIZED : AuthorityState.AUTHORIZATION_REQUIRED, provisioning_state: allAuthorityGranted ? 'PROVISIONING_READY' : 'AWAITING_AUTHORITY', next_automatic_action: allAuthorityGranted ? 'PLAN_PROVISIONING' : 'REQUEST_PROVIDER_SCOPE', authority, authority_bundle: { mailbox: mailboxAuthority, infrastructure: infrastructureAuthority }, provider_graph: providerGraph, add_mailbox_status: addMailbox.status, effective_authority: addMailbox.effective_authority, domain_reused: addMailbox.domain_reused, ui_status: addMailbox.ui, activation: addMailbox.activation, lifecycle_state: discoveryBlocked ? LifecycleState.BLOCKED : allAuthorityGranted ? LifecycleState.CONFIGURING : LifecycleState.NEEDS_ATTENTION, workflow: ['DISCOVER', 'IDENTITY', 'MAILBOX', 'AUTHORITY', 'PLAN', 'SAFE_APPLY', 'VALIDATE', 'PROVISION', 'MONITOR', 'REPAIR', 'NOTIFY'], manual_dns_required: allAuthorityGranted ? false : null, manual_dns_supported: false, automation_blocked: discoveryBlocked, automation_pending_authorization: !allAuthorityGranted && !discoveryBlocked, blockers: discoveryBlocked ? [{ code: addMailbox.status }] : blockers, ready: false, readiness_invariant: 'routing_identity_sending_security_and_requested_integrations_observed' };
}

const WORKSPACE_FIELDS = Object.freeze(['inbox', 'rules', 'signatures', 'ai_context', 'memory', 'calendar', 'aliases', 'preferences']);
function identityWorkspace(input = {}) { const key = String(input.key || input.name || 'personal').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); return { workspace_key: key, display_name: input.name || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), isolated_resources: WORKSPACE_FIELDS, cross_workspace_memory: false, tenant_key: input.tenant_key || 'current_user' }; }
function aliasTransition(alias = {}, action = '') {
	const current = String(alias.lifecycle_state || 'ACTIVE').toUpperCase(), next = { rotate: 'ROTATED', disable: 'DISABLED', archive: 'ARCHIVED', enable: 'ACTIVE', create: 'ACTIVE' }[action];
	if (!next) throw new BizError('Unsupported alias lifecycle action.', 400); if (current === 'ARCHIVED' && action !== 'create') throw new BizError('Archived aliases cannot be mutated; create a replacement.', 409);
	return { ...alias, from: current, lifecycle_state: next, action, reversible: action !== 'archive', audit_required: true, provider_confirmation_required: true };
}
function privacyAnalysis(input = {}) {
	const html = String(input.html || ''), urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map(match => match[0]);
	const pixels = [...html.matchAll(/<img\b[^>]*(?:width=["']?1|height=["']?1)[^>]*>/gi)], remoteImages = [...html.matchAll(/<img\b[^>]*src=["']https?:\/\/[^"']+/gi)];
	const trackingUrls = urls.filter(url => /(utm_|pixel|track|open|click|analytics|beacon)/i.test(url)), unsafeLinks = urls.filter(url => /^http:\/\//i.test(url) || /(?:xn--|@)/i.test(url));
	const risk = Math.min(100, pixels.length * 25 + trackingUrls.length * 12 + unsafeLinks.length * 20 + remoteImages.length * 3), allow = input.allow_remote_content === true;
	return { trackers_found: pixels.length + trackingUrls.length, trackers_blocked: allow ? 0 : pixels.length + trackingUrls.length, remote_images_found: remoteImages.length, remote_images_blocked: allow ? 0 : remoteImages.length, unsafe_links_found: unsafeLinks.length, privacy_score: Math.max(0, 100 - risk), tracking_risk: risk >= 60 ? 'HIGH' : risk >= 25 ? 'MEDIUM' : 'LOW', remote_content_default: allow ? 'ALLOWED_BY_USER' : 'BLOCKED', malware_scanning_claimed: false, evidence: { pixel_count: pixels.length, tracking_url_count: trackingUrls.length, unsafe_link_count: unsafeLinks.length } };
}
function calendarIntelligence(input = {}) {
	const items = (input.events || []).map(event => ({ source_type: 'calendar', source_ref: String(event.id), item_type: 'MEETING', title: event.title || 'Meeting', starts_at: event.start || null, confidence: 1, write_state: 'OBSERVED' }));
	const patterns = [['RENEWAL', /renew(?:al|s|ing)?/i], ['DEADLINE', /deadline|due\s+(?:by|on)/i], ['FOLLOW_UP', /follow[ -]?up/i], ['COMMITMENT', /(?:i|we)\s+(?:will|commit|promise)/i], ['REVIEW', /review/i], ['MILESTONE', /milestone/i], ['ESCALATION', /escalat/i]];
	for (const message of input.messages || []) for (const [type, regex] of patterns) if (regex.test(`${message.subject || ''} ${message.snippet || ''}`)) items.push({ source_type: 'mail', source_ref: String(message.id), item_type: type, title: message.subject || type.replace(/_/g, ' '), confidence: 0.72, write_state: 'SUGGESTED' });
	return { items, sections: ['TODAY', 'MEETINGS', 'WAITING', 'URGENT', 'FOLLOW_UPS', 'DEADLINES', 'COMMITMENTS'], provider_write_performed: false };
}
function meetingBrief(input = {}) { const event = input.event || {}, people = unique(event.participants || input.participants || []); return { title: event.title || 'Meeting Brief', starts_at: event.start || null, participant_context: people.map(identity => ({ identity, relationship: input.relationships?.[identity] || 'UNKNOWN' })), past_conversations: (input.messages || []).filter(message => people.some(person => String(message.participants || '').includes(person))).slice(0, 10), open_risks: input.risks || [], action_items: input.action_items || [], next_steps: input.next_steps || [], source_bound: true }; }
function organizationGraph(input = {}) { return { graph_type: 'ORGANIZATION', tenant_key: input.tenant_key || 'current_user', nodes: [...(input.people || []).map(person => ({ key: `person:${person.id || person.email}`, type: 'PERSON', label: person.name || person.email, source: person.source || 'provider' })), ...(input.teams || []).map(team => ({ key: `team:${team.id || team.name}`, type: 'TEAM', label: team.name, source: team.source || 'provider' }))], edges: (input.memberships || []).map(value => ({ from: `person:${value.person}`, to: `team:${value.team}`, relationship: 'MEMBER_OF', source: value.source || 'provider' })), cross_tenant_traversal_allowed: false, isolation_evidence: input.isolation_evidence || 'MODEL_ONLY_NOT_PERSISTED' }; }
function identityGraph(input = {}) { return { graph_type: 'IDENTITY', tenant_key: input.tenant_key || 'current_user', nodes: (input.identities || []).map(value => ({ key: `identity:${value.id || value.email}`, type: value.type || 'MAILBOX', label: value.email, source: value.source || 'provider' })), edges: (input.relationships || []).map(value => ({ from: `identity:${value.from}`, to: `identity:${value.to}`, relationship: value.relationship, source: value.source || 'provider' })), display_name_merge_allowed: false, cross_tenant_traversal_allowed: false, isolation_evidence: input.isolation_evidence || 'MODEL_ONLY_NOT_PERSISTED' }; }
function repairPlan(input = {}) { const drifts = (input.drifts || []).filter(value => value.state && value.state !== 'READY'); return { domain: normalizeDomain(input.domain), state: drifts.length ? LifecycleState.REPAIRING : LifecycleState.READY, actions: drifts.map(value => ({ dimension: value.dimension, state: value.state, action: value.authorized ? 'AUTO_REPAIR' : value.alternative ? 'ALTERNATIVE_REPAIR' : value.fallback ? 'FALLBACK_REPAIR' : 'OWNER_NOTIFICATION', destructive: false })), owner_notification_last_resort: true, bounded_retries: true, idempotency_required: true }; }
const HEALTH_DIMENSIONS = Object.freeze(['trust', 'security', 'dns', 'mail', 'identity', 'calendar', 'provisioning', 'repair']);
function domainHealth(input = {}) {
	const dimensions = input.dimensions || {}, missing_dimensions = HEALTH_DIMENSIONS.filter(key => dimensions[key] === undefined), values = Object.values(dimensions).map(value => String(value).toUpperCase());
	const overall = values.includes('BLOCKED') ? 'BLOCKED' : values.includes('REPAIRING') ? 'REPAIRING' : missing_dimensions.length || values.some(value => !['HEALTHY', 'READY', 'PASS'].includes(value)) ? 'NEEDS_ATTENTION' : 'HEALTHY';
	return { overall_state: overall, dimensions, missing_dimensions, ready: overall === 'HEALTHY' && missing_dimensions.length === 0, blockers: Object.entries(dimensions).filter(([, value]) => String(value).toUpperCase() === 'BLOCKED').map(([key]) => key) };
}
function executiveCommandCenter(input = {}) { const health = domainHealth(input.health || {}), authority = input.authority || AuthorityState.AUTHORIZATION_REQUIRED; return { health, sections: ['DOMAINS', 'ORGANIZATIONS', 'IDENTITIES', 'MAILBOXES', 'TRUST', 'SECURITY', 'CALENDAR', 'PROVISIONING', 'REPAIR', 'DRIFT', 'PRIVACY', 'ALIASES'], authority, truthful_ready: authority === AuthorityState.AUTHORIZED && health.ready && input.readiness_invariants_observed === true }; }

async function beginOnboarding(c, input = {}) {
	const user = c.get('user'); if (!user?.userId) throw new BizError('Authenticated user required.', 401);
	// Grants in requests are never trusted. We start with discovery, then merge only
	// server-side domain/workspace/provider records through EffectiveAuthorityResolver.
	const model = customDomainOnboarding({ ...input, granted_scopes: [], verified_capabilities: [] });
	const key = `onboard:${user.userId}:${model.domain}`;
	const first = async (sql, bindings) => {
		try { return await c.env.db.prepare(sql).bind(...bindings).first(); } catch { return null; }
	};
	const domainConnection = await first(`SELECT provider,ownership_state,authority_state FROM nexora_domain_connections WHERE user_id=?1 AND lower(domain)=lower(?2) LIMIT 1`, [user.userId, model.domain]);
	const providerGrant = await first(`SELECT authority_state,revoked_at FROM nexora_provider_authorizations WHERE user_id=?1 AND provider=?2 AND lower(subject_ref)=lower(?3) LIMIT 1`, [user.userId, model.infrastructure_provider, model.domain]);
	const workspaceGrant = await first(`SELECT wpg.authority_state FROM workspace_domains wd JOIN workspace_provider_grants wpg ON wpg.workspace_id=wd.workspace_id AND wpg.provider=?3 WHERE lower(wd.domain)=lower(?1) AND wd.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=?2) LIMIT 1`, [model.domain, user.userId, model.mailbox_provider]);
	const effective = resolveEffectiveAuthority({
		domain_verified: domainConnection?.ownership_state === 'VERIFIED',
		domain_grant: providerGrant || (domainConnection ? { authority_state: domainConnection.authority_state } : null),
		organization_grant: workspaceGrant,
		provider_capability: {
			// Existing mailbox-specific authority is the only route to READY. A
			// reusable domain without mailbox proof becomes consent-required, not blocked.
			core_satisfied: false,
			admin_consent_required: model.mailbox_provider === 'microsoft_365' && Boolean(workspaceGrant),
			optional_missing: [], enterprise_required: [], enterprise_available: []
		}
	});
	const terminalBlock = effective.blocked;
	const requestState = terminalBlock ? 'BLOCKED' : effective.status === AddMailboxStatus.READY_TO_ADD ? 'READY' : 'AWAITING_CONSENT';
	await c.env.db.prepare(`INSERT INTO nexora_add_mailbox_requests (user_id,email,domain,mailbox_provider,infrastructure_provider,status,effective_authority_json,idempotency_key) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(idempotency_key) DO UPDATE SET status=excluded.status,effective_authority_json=excluded.effective_authority_json,updated_at=CURRENT_TIMESTAMP`).bind(user.userId, model.email, model.domain, model.mailbox_provider, model.infrastructure_provider, requestState, JSON.stringify(effective.effective_authority), key).run();
	await c.env.db.prepare(`INSERT INTO nexora_audit_events (user_id,domain,action,object_type,object_ref,outcome,metadata_json) VALUES (?1,?2,'mailbox_authority_resolved','mailbox',?3,?4,?5)`).bind(user.userId, model.domain, model.email || model.domain, effective.status, JSON.stringify({ domain_reused: effective.domain_reused, inherited_from: effective.effective_authority.inherited_from, silent_escalation_allowed: false })).run();
	return {
		...model,
		idempotency_key: key,
		persisted: true,
		add_mailbox_status: effective.status,
		effective_authority: effective.effective_authority,
		domain_reused: effective.domain_reused,
		ui_status: effective.ui,
		activation: effective.activation,
		lifecycle_state: terminalBlock ? LifecycleState.BLOCKED : effective.status === AddMailboxStatus.READY_TO_ADD ? LifecycleState.CONFIGURING : LifecycleState.NEEDS_ATTENTION,
		provisioning_state: requestState,
		automation_blocked: terminalBlock,
		blockers: terminalBlock ? [{ code: effective.status }] : []
	};
}
async function monitorScheduled({ env }, options = {}) {
	if (!env?.db) return { checked: 0, reason: 'db_unavailable' }; const limit = Math.max(1, Math.min(25, Number(options.limit || 10)));
	const verified = await env.db.prepare(`SELECT dc.user_id,dc.domain,dc.provider,pa.credential_ref FROM nexora_domain_connections dc JOIN nexora_provider_authorizations pa ON pa.user_id=dc.user_id AND pa.provider=dc.provider AND lower(pa.subject_ref)=lower(dc.domain) WHERE dc.ownership_state='VERIFIED' AND dc.authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND pa.authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND pa.revoked_at IS NULL AND (pa.expires_at IS NULL OR pa.expires_at>CURRENT_TIMESTAMP) ORDER BY COALESCE(dc.last_monitor_attempt_at,dc.last_validated_at,'') ASC,dc.id ASC LIMIT ?1`).bind(limit).all();
	for (const connection of verified.results || []) {
		await env.db.prepare(`INSERT INTO nexora_autonomy_jobs (user_id,domain,job_type,idempotency_key,state,input_json) VALUES (?1,?2,'MONITOR_DOMAIN',?3,'QUEUED',?4) ON CONFLICT(idempotency_key) DO UPDATE SET state='QUEUED',attempt_count=0,blocker_code=NULL,next_attempt_at=NULL,input_json=excluded.input_json,updated_at=CURRENT_TIMESTAMP WHERE nexora_autonomy_jobs.state='SUCCEEDED' AND nexora_autonomy_jobs.updated_at<=datetime('now','-30 minutes')`).bind(connection.user_id, connection.domain, `monitor:${connection.user_id}:${connection.domain}`, JSON.stringify({ provider: connection.provider, credential_ref: connection.credential_ref })).run();
		await env.db.prepare(`UPDATE nexora_domain_connections SET last_monitor_attempt_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND domain=?2 AND ownership_state='VERIFIED'`).bind(connection.user_id, connection.domain).run();
	}
	const due = await env.db.prepare(`SELECT id,user_id,domain,job_type,attempt_count FROM nexora_autonomy_jobs WHERE job_type NOT LIKE 'MISSION_RUNTIME_%' AND job_type!='CLASSIFY_THREAD_TO_MISSION' AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY id LIMIT ?1`).bind(limit).all(); let claimed = 0, blocked = 0, succeeded = 0, retried = 0;
	for (const job of due.results || []) {
		const response = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`).bind(job.id).run();
		if (!response.meta?.changes) continue; claimed += 1;
		if (job.job_type !== 'MONITOR_DOMAIN') { await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='BLOCKED',lease_until=NULL,blocker_code=?2,result_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, job.job_type === 'ONBOARD_DOMAIN' ? 'VERIFIED_PROVIDER_AUTHORITY_REQUIRED' : 'UNSUPPORTED_JOB_TYPE', JSON.stringify({ executed: false, destructive: false })).run(); blocked += 1; continue; }
		try {
			const current = await env.db.prepare(`SELECT dc.provider,dc.authority_state,dc.ownership_state,pa.credential_ref FROM nexora_domain_connections dc JOIN nexora_provider_authorizations pa ON pa.user_id=dc.user_id AND pa.provider=dc.provider AND lower(pa.subject_ref)=lower(dc.domain) WHERE dc.user_id=?1 AND lower(dc.domain)=lower(?2) AND dc.ownership_state='VERIFIED' AND dc.authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND pa.authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND pa.revoked_at IS NULL AND (pa.expires_at IS NULL OR pa.expires_at>CURRENT_TIMESTAMP) LIMIT 1`).bind(job.user_id, job.domain).first();
			if (!current) throw new BizError('AUTHORITY_REVOKED_OR_UNVERIFIED', 403);
			if (current.provider !== 'cloudflare' || current.credential_ref !== 'env:CLOUDFLARE_API_TOKEN' || !env.CLOUDFLARE_API_TOKEN) throw new BizError('SUPPORTED_MONITOR_CREDENTIAL_REQUIRED', 409);
			const discovery = await p31DomainFoundationService.discover({ env }, job.domain);
			if (!discovery.cloudflare?.zoneId || discovery.cloudflare?.zoneError || discovery.cloudflare?.emailRouting?.error) throw new BizError('PROVIDER_MONITOR_NOT_VERIFIED', 503);
			const observation = await env.db.prepare(`UPDATE nexora_domain_connections SET observed_state_json=?3,last_validated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND domain=?2 AND ownership_state='VERIFIED' AND authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND EXISTS (SELECT 1 FROM nexora_provider_authorizations pa WHERE pa.user_id=nexora_domain_connections.user_id AND pa.provider=nexora_domain_connections.provider AND lower(pa.subject_ref)=lower(nexora_domain_connections.domain) AND pa.authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED') AND pa.revoked_at IS NULL AND (pa.expires_at IS NULL OR pa.expires_at>CURRENT_TIMESTAMP))`).bind(job.user_id, job.domain, JSON.stringify(redactedEvidence(discovery))).run();
			if (!observation.meta?.changes) throw new BizError('AUTHORITY_CHANGED_DURING_MONITOR', 409);
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,blocker_code=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ monitored: true, destructive: false })).run(); succeeded += 1;
		} catch (error) {
			const terminal = Number(job.attempt_count || 0) + 1 >= 5;
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state=?2,lease_until=NULL,blocker_code=?3,next_attempt_at=CASE WHEN ?2='RETRYING' THEN datetime('now','+15 minutes') ELSE NULL END,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(job.id, terminal ? 'FAILED' : 'RETRYING', terminal ? 'MONITOR_RETRY_EXHAUSTED' : 'MONITOR_RETRY_SCHEDULED', JSON.stringify({ error: String(error?.message || error).slice(0, 160), destructive: false })).run(); retried += terminal ? 0 : 1;
			if (terminal) {
				await env.db.prepare(`INSERT INTO nexora_audit_events (user_id,domain,action,object_type,object_ref,outcome,metadata_json) VALUES (?1,?2,'domain_monitor_retry_exhausted','domain',?2,'NEEDS_ATTENTION',?3)`).bind(job.user_id, job.domain, JSON.stringify({ job_id: job.id, owner_notification_required: true, secret_exposure: false })).run();
				await env.db.prepare(`INSERT INTO nexora_notification_events (user_id,domain,notification_type,state,message,metadata_json) VALUES (?1,?2,'OWNER_ATTENTION_REQUIRED','PENDING','NEXORA could not verify this domain after bounded retries.',?3)`).bind(job.user_id, job.domain, JSON.stringify({ job_id: job.id, blocker_code: 'MONITOR_RETRY_EXHAUSTED' })).run();
			}
		}
	}
	return { verified_connections: (verified.results || []).length, checked: (due.results || []).length, claimed, succeeded, blocked, retried, bounded: true };
}

async function verifyCloudflareDomain(c, rawDomain) {
	const user = c.get('user'), admin = String(c.env.admin || '').trim().toLowerCase();
	if (!user?.userId || !admin || String(user.email || '').trim().toLowerCase() !== admin) throw new BizError('Administrator authorization required.', 403);
	if (!c.env.CLOUDFLARE_API_TOKEN) throw new BizError('Cloudflare provider credential is unavailable.', 503);
	const domain = normalizeDomain(rawDomain), discovery = await p31DomainFoundationService.discover(c, domain);
	if (!discovery.cloudflare?.zoneId || discovery.cloudflare?.zoneError || discovery.cloudflare?.emailRouting?.error) throw new BizError('Cloudflare read authority could not be verified.', 403);
	const granted = ['Zone:Read', 'DNS:Read', 'Email Routing:Read'];
	await c.env.db.prepare(`INSERT INTO nexora_provider_authorizations (user_id,provider,subject_ref,credential_ref,requested_scopes_json,granted_scopes_json,authority_state,consented_at,last_verified_at) VALUES (?1,'cloudflare',?2,'env:CLOUDFLARE_API_TOKEN',?3,?4,'PARTIALLY_AUTHORIZED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(user_id,provider,subject_ref) DO UPDATE SET credential_ref=excluded.credential_ref,granted_scopes_json=excluded.granted_scopes_json,authority_state='PARTIALLY_AUTHORIZED',revoked_at=NULL,expires_at=NULL,last_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(user.userId, domain, JSON.stringify(CAPABILITIES.cloudflare.scopes), JSON.stringify(granted)).run();
	await c.env.db.prepare(`INSERT INTO nexora_domain_connections (user_id,email,domain,provider,ownership_state,lifecycle_state,authority_state,observed_state_json,last_validated_at) VALUES (?1,?2,?3,'cloudflare','VERIFIED','NEEDS_ATTENTION','PARTIALLY_AUTHORIZED',?4,CURRENT_TIMESTAMP) ON CONFLICT(user_id,domain) DO UPDATE SET provider='cloudflare',ownership_state='VERIFIED',lifecycle_state='NEEDS_ATTENTION',authority_state='PARTIALLY_AUTHORIZED',observed_state_json=excluded.observed_state_json,last_validated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(user.userId, String(user.email || '').toLowerCase(), domain, JSON.stringify(redactedEvidence(discovery))).run();
	await c.env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',blocker_code=NULL,result_json=?3,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND domain=?2 AND job_type='ONBOARD_DOMAIN' AND state='BLOCKED'`).bind(user.userId, domain, JSON.stringify({ ownership_verified: true, authority_state: 'PARTIALLY_AUTHORIZED', ready: false })).run();
	await c.env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='QUEUED',attempt_count=0,blocker_code=NULL,next_attempt_at=NULL,lease_until=NULL,result_json='{}',updated_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND domain=?2 AND job_type='MONITOR_DOMAIN' AND state='FAILED'`).bind(user.userId, domain).run();
	await c.env.db.prepare(`UPDATE nexora_notification_events SET state='RESOLVED',updated_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND domain=?2 AND notification_type='OWNER_ATTENTION_REQUIRED' AND state='PENDING'`).bind(user.userId, domain).run();
	await c.env.db.prepare(`INSERT INTO nexora_audit_events (user_id,domain,action,object_type,object_ref,outcome,metadata_json) VALUES (?1,?2,'cloudflare_domain_authority_verified','domain',?2,'PARTIALLY_AUTHORIZED',?3)`).bind(user.userId, domain, JSON.stringify({ credential_ref: 'env:CLOUDFLARE_API_TOKEN', ownership_state: 'VERIFIED', granted_scopes: granted, secret_exposure: false })).run();
	return { domain, provider: 'cloudflare', ownership_state: 'VERIFIED', authority_state: 'PARTIALLY_AUTHORIZED', granted_scopes: granted, missing_scopes: ['DNS:Edit', 'Email Routing:Edit'], ready: false, discovery: redactedEvidence(discovery.readiness) };
}

export default { providerCapabilityMatrix, providerAdapter, authorityMaximization, authorityGraph, detectProvider, customDomainOnboarding, identityWorkspace, aliasTransition, privacyAnalysis, calendarIntelligence, meetingBrief, organizationGraph, identityGraph, repairPlan, domainHealth, executiveCommandCenter, beginOnboarding, monitorScheduled, verifyCloudflareDomain, resolveEffectiveAuthority, AddMailboxStatus, trustAssessment: p32cEnterpriseGovernanceService.inboundSecurityAssessment, desiredDomainState: p31DomainFoundationService.desiredDnsState };
