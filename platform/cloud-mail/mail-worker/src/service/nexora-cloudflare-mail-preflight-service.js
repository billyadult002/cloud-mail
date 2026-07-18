// NEXORA Cloudflare mail-authority preflight (Required Output #13) and existing-provider
// conflict detection (Required Outputs #21-#23). Deterministic -- operates on DNS/routing data
// the caller supplies (a real implementation gets this from Cloudflare's DNS-record list API
// and Email Routing API; those HTTP calls are out of this pass's scope, same distinction as
// the OAuth token exchange before a real client_secret exists). This is what a desired-state
// plan is calculated against -- MX/SPF/DMARC records already present are OBSERVED state, never
// silently overwritten.
const KNOWN_MX_PROVIDERS = [
	{ pattern: /aspmx\.l\.google\.com|googlemail\.com$/i, provider: 'google_workspace' },
	{ pattern: /mail\.protection\.outlook\.com$/i, provider: 'microsoft_365' },
	{ pattern: /mx\.zoho\.com$/i, provider: 'zoho' },
	{ pattern: /mx\.yandex\.net$/i, provider: 'yandex' },
];

function detectExistingProvider(mxRecords) {
	if (!mxRecords || mxRecords.length === 0) return null;
	for (const record of mxRecords) {
		for (const known of KNOWN_MX_PROVIDERS) {
			if (known.pattern.test(String(record.value || record))) return known.provider;
		}
	}
	// Cloudflare Email Routing's own MX targets are a distinguishable, non-conflicting case --
	// a real implementation checks for `*.mx.cloudflare.net`; treated here as "cloudflare_email_routing".
	if (mxRecords.some((r) => /\.mx\.cloudflare\.net$/i.test(String(r.value || r)))) return 'cloudflare_email_routing';
	return 'unknown_provider';
}

async function runPreflight(c, scope, { onboardingMissionId, zoneId, mxRecords = [], spfRecord = null, dmarcRecord = null, dkimSelectors = [], existingEmailRoutingEnabled = false, existingRoutingRules = [], existingWorkers = [], existingDestinationAddresses = [], catchAllState = 'unknown' }) {
	const detectedProvider = detectExistingProvider(mxRecords);
	const id = crypto.randomUUID();
	await c.env.db
		.prepare(`INSERT INTO nexora_cloudflare_mail_authority_observations(id,onboarding_mission_id,tenant_id,workspace_id,zone_id,mx_records_json,spf_state,dmarc_state,dkim_selectors_json,existing_email_routing_enabled,existing_routing_rules_json,existing_workers_json,existing_destination_addresses_json,detected_existing_provider,catch_all_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
		.bind(id, onboardingMissionId, scope.tenantId, scope.workspaceId, zoneId, JSON.stringify(mxRecords), spfRecord, dmarcRecord, JSON.stringify(dkimSelectors), existingEmailRoutingEnabled ? 1 : 0, JSON.stringify(existingRoutingRules), JSON.stringify(existingWorkers), JSON.stringify(existingDestinationAddresses), detectedProvider, catchAllState)
		.run();
	return {
		observationId: id,
		detectedProvider,
		hasExistingMx: mxRecords.length > 0,
		// A conflict exists whenever MX already points somewhere NEXORA doesn't control --
		// "no MX at all" and "MX already Cloudflare Email Routing" are both non-conflicting.
		hasConflict: detectedProvider !== null && detectedProvider !== 'cloudflare_email_routing',
		existingEmailRoutingEnabled,
		spfPresent: Boolean(spfRecord),
		dmarcPresent: Boolean(dmarcRecord),
	};
}

// Non-destructive integration strategies (Required Output #23) available when a hard MX
// conflict exists -- returned as ranked options, never auto-selected without policy input.
function nonDestructiveIntegrationOptions({ hasConflict, tenantPolicyAllowsSubdomain = true, tenantPolicyAllowsWorkerIngestion = true }) {
	if (!hasConflict) return [];
	const options = [];
	if (tenantPolicyAllowsSubdomain) options.push({ strategy: 'dedicated_inbound_subdomain', destructive: false, reason: 'Routes a new subdomain (e.g. mail-in.example.com) through NEXORA without touching the root domain MX.' });
	if (tenantPolicyAllowsWorkerIngestion) options.push({ strategy: 'worker_based_parallel_ingestion', destructive: false, reason: 'A NEXORA Email Worker observes copies via provider-side forwarding/BCC without taking over primary delivery.' });
	options.push({ strategy: 'provider_side_forwarding', destructive: false, reason: 'Existing provider forwards or journals to a NEXORA destination address; root MX untouched.' });
	return options;
}

export { detectExistingProvider, nonDestructiveIntegrationOptions, KNOWN_MX_PROVIDERS };
export default { runPreflight };
