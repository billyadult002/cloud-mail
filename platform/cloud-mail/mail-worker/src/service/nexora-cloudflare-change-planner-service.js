// NEXORA Cloudflare deterministic change planner (Required Outputs #14-17, #20, #22).
// Desired/Observed/Verified separation: this module only ever reads the preflight OBSERVATION
// and the DESIRED capability set; it never mutates anything. The plan it produces is persisted
// (Required Output #16) before nexora-cloudflare-authority-service's authorization check gates
// actual execution -- planning and authorization-to-execute are deliberately separate steps.
const CLASSIFICATIONS = Object.freeze(['no_change', 'safe_create', 'safe_update_owned', 'conflict', 'destructive_replacement', 'approval_required', 'unsupported', 'blocked']);

// Never replaces production MX automatically (Required Output #22) -- an existing hard
// conflict always classifies as 'conflict' or 'approval_required', never 'safe_create'/
// 'safe_update_owned', regardless of what the caller requests.
function classifyEmailRoutingDns({ preflight, requestEmailRouting }) {
	if (!requestEmailRouting) return { classification: 'no_change', reason: 'not_requested' };
	if (preflight.existingEmailRoutingEnabled) return { classification: 'no_change', reason: 'already_enabled' };
	if (preflight.hasConflict) return { classification: 'conflict', reason: `existing_mx_provider:${preflight.detectedProvider}` };
	if (!preflight.hasExistingMx) return { classification: 'safe_create', reason: 'no_existing_mail_authority' };
	// MX already points at Cloudflare Email Routing but routing itself is reported disabled --
	// an inconsistent/partial state; treat conservatively as requiring explicit approval
	// rather than guessing which half is authoritative.
	return { classification: 'approval_required', reason: 'partial_existing_cloudflare_state' };
}

function classifyRoutingRule({ action, ownedResource, isNewRule }) {
	if (action === 'drop' && isNewRule) return { classification: 'approval_required', reason: 'drop_action_requires_high_risk_approval' };
	if (!isNewRule && !ownedResource) return { classification: 'conflict', reason: 'rule_not_nexora_owned' };
	if (!isNewRule && ownedResource) return { classification: 'safe_update_owned', reason: 'nexora_owned_rule' };
	return { classification: 'safe_create', reason: 'new_rule_non_destructive_action' };
}

function classifyCatchAll({ tenantPolicyExplicitlyRequestsCatchAll }) {
	// Required Output #33: never enabled by default.
	if (!tenantPolicyExplicitlyRequestsCatchAll) return { classification: 'blocked', reason: 'catch_all_not_explicitly_requested_by_policy' };
	return { classification: 'approval_required', reason: 'catch_all_is_always_high_risk' };
}

function classifyDestinationAddress({ alreadyVerified, alreadyRequested }) {
	if (alreadyVerified) return { classification: 'no_change', reason: 'already_verified' };
	if (alreadyRequested) return { classification: 'no_change', reason: 'verification_pending' };
	return { classification: 'safe_create', reason: 'new_destination_request' };
}

function classifyWorkerDeployment({ workerAlreadyDeployed, bindingOwnedByNexora }) {
	if (workerAlreadyDeployed && !bindingOwnedByNexora) return { classification: 'conflict', reason: 'worker_binding_not_nexora_owned' };
	if (workerAlreadyDeployed && bindingOwnedByNexora) return { classification: 'safe_update_owned', reason: 'redeploy_owned_worker' };
	return { classification: 'safe_create', reason: 'new_worker_deployment' };
}

// The overall plan classification is the MOST conservative of its parts -- a plan containing
// even one 'conflict'/'approval_required'/'blocked' item is never rounded up to 'safe_create'
// just because other items in the same plan are safe.
const SEVERITY_ORDER = ['no_change', 'safe_create', 'safe_update_owned', 'unsupported', 'approval_required', 'blocked', 'conflict', 'destructive_replacement'];
function overallClassification(items) {
	if (!items.length) return 'no_change';
	return items.reduce((worst, item) => (SEVERITY_ORDER.indexOf(item.classification) > SEVERITY_ORDER.indexOf(worst) ? item.classification : worst), 'no_change');
}

async function computeChangePlan(c, scope, { onboardingMissionId, zoneId, observationId, preflight, desiredState }) {
	const items = [];
	if ('emailRouting' in desiredState) items.push({ target: 'email_routing_dns', ...classifyEmailRoutingDns({ preflight, requestEmailRouting: desiredState.emailRouting }) });
	if (desiredState.routingRules) for (const rule of desiredState.routingRules) items.push({ target: `routing_rule:${rule.id || 'new'}`, ...classifyRoutingRule(rule) });
	// Only classify catch-all when it is actually being requested (true) -- catchAll:false or
	// absent means "not part of this desired state," not "requested and blocked," so it must
	// not add a spurious 'blocked' item to an otherwise-unrelated plan.
	if (desiredState.catchAll === true) items.push({ target: 'catch_all', ...classifyCatchAll({ tenantPolicyExplicitlyRequestsCatchAll: true }) });
	if (desiredState.destinationAddresses) for (const dest of desiredState.destinationAddresses) items.push({ target: `destination:${dest.email}`, ...classifyDestinationAddress(dest) });
	if (desiredState.worker) items.push({ target: 'email_worker', ...classifyWorkerDeployment(desiredState.worker) });

	const overall = overallClassification(items);
	const approvalRequired = items.some((item) => item.classification === 'approval_required' || item.classification === 'destructive_replacement');
	const id = crypto.randomUUID();
	await c.env.db
		.prepare(`INSERT INTO nexora_cloudflare_change_plans(id,onboarding_mission_id,tenant_id,workspace_id,zone_id,observation_id,plan_json,overall_classification,approval_required) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
		.bind(id, onboardingMissionId, scope.tenantId, scope.workspaceId, zoneId, observationId, JSON.stringify(items), overall, approvalRequired ? 1 : 0)
		.run();
	return { planId: id, items, overallClassification: overall, approvalRequired };
}

export { CLASSIFICATIONS, classifyEmailRoutingDns, classifyRoutingRule, classifyCatchAll, classifyDestinationAddress, classifyWorkerDeployment, overallClassification };
export default { computeChangePlan };
