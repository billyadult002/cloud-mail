// NEXORA Cloudflare domain discovery (Required Outputs #11-12). Determines whether a domain is
// managed by Cloudflare DNS and, if so, which zone -- explicitly NEVER inferring write
// authority merely from Cloudflare-hosted nameservers (Required Output #12): discovery only
// ever produces a candidate zone; nexora-cloudflare-authority-service is the sole source of
// write permission. Operates on caller-supplied nameserver/zone-list data (a real
// implementation calls Cloudflare's zone-list API and a nameserver/SOA DNS lookup); those
// network calls are out of this pass's logic-complete scope.
async function discoverDomain(c, scope, { onboardingMissionId, requestedDomain, cloudflareZones = [], observedNameservers = [] }) {
	const normalizedDomain = String(requestedDomain || '').toLowerCase().trim();
	const matchedZone = cloudflareZones.find((z) => String(z.name || '').toLowerCase() === normalizedDomain || normalizedDomain.endsWith(`.${String(z.name || '').toLowerCase()}`));

	// DNS authority requires BOTH a matching Cloudflare zone AND the domain's own observed
	// nameservers actually pointing at Cloudflare -- a zone existing in the account without the
	// domain's real NS records delegated to Cloudflare is not yet DNS-authoritative (e.g. zone
	// added but nameservers not switched at the registrar yet).
	const cloudflareNsPattern = /\.ns\.cloudflare\.com$/i;
	const nsAuthoritative = observedNameservers.length > 0 && observedNameservers.every((ns) => cloudflareNsPattern.test(String(ns)));
	const dnsAuthoritative = Boolean(matchedZone) && nsAuthoritative;

	const signalSources = [];
	let confidence = 0;
	if (matchedZone) {
		signalSources.push('cloudflare_zone_match');
		confidence += 0.5;
	}
	if (nsAuthoritative) {
		signalSources.push('nameserver_observation');
		confidence += 0.5;
	} else if (observedNameservers.length > 0) {
		signalSources.push('nameserver_observation_non_cloudflare');
	}
	confidence = Math.min(1, confidence);
	const sufficient = dnsAuthoritative; // discovery is "sufficient" only when genuinely DNS-authoritative

	const id = crypto.randomUUID();
	await c.env.db
		.prepare(`INSERT INTO nexora_cloudflare_domain_discoveries(id,onboarding_mission_id,tenant_id,workspace_id,requested_domain,cloudflare_zone_id,nameserver_evidence_json,dns_authoritative,confidence,sufficient,signal_sources_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
		.bind(id, onboardingMissionId, scope.tenantId, scope.workspaceId, normalizedDomain, matchedZone?.id || null, JSON.stringify(observedNameservers), dnsAuthoritative ? 1 : 0, confidence, sufficient ? 1 : 0, JSON.stringify(signalSources))
		.run();

	return { discoveryId: id, zoneId: matchedZone?.id || null, dnsAuthoritative, confidence, sufficient, signalSources, writeAuthorityImplied: false };
}

export default { discoverDomain };
