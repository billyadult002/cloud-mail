# ADR-008: Scheduled Capability Rollout Boundary

Status: Accepted for one read-only capability.

The only scheduled capability is `search_email`. It executes through the existing scheduled Worker entrypoint, canonical Durable Mission Runtime, capability Verified Action Boundary, capability invocation service, Gmail canonical-D1 adapter, canonical Evidence Ledger, and independent canonical Verification write.

Rollout is fail-closed:

- `NEXORA_SCHEDULED_CAPABILITY_ENABLED` defaults false.
- `NEXORA_SCHEDULED_CAPABILITY_EMERGENCY_DISABLED` defaults true.
- tenant and workspace CSV allowlists must each contain the exact requested identifiers.
- the capability allowlist must contain exactly one value: `search_email`.
- one job at most is claimed per scheduled tick; one invocation per tenant/workspace per minute is permitted.
- three failures within five minutes open the circuit.
- the query is at most 200 characters; results are capped at 20; execution timeout is 250–2000 ms; run lease is 30 seconds.
- current membership/account authority, authority generation, active run lease, and fencing token are enforced after the run is claimed.
- unknown schema fields, scopes, capabilities, adapters, generations, leases, or results fail closed.
- Mission completion requires a separate verified Evidence row and Verification row linked into a canonical outcome.

The adapter reads only canonical synchronized Gmail rows in D1. It has no network, credential, legacy-runner, or mailbox mutation dependency. Rollback sets the emergency-disable control true or the enabled control false. Existing non-capability scheduled behavior is unchanged.
