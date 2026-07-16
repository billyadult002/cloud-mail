# Autonomous Provisioning Report

Status: **PARTIAL**

- Persistence, capability gates, idempotency keys, ownership proof, scope checks, and readiness invariants are deployed.
- Provisioning targets mailbox, alias, identity, routing, trust, security, calendar, and workflows.
- No ready state is emitted without observed routing, identity, sending, security, and requested integrations.
- Live provisioning is BLOCKED because production has no V3 provider authorization/domain rows.
- Microsoft, Fastmail, Zoho, and custom-provider mutation adapters remain `DECLARED_NOT_VALIDATED`.
