# P32C V2 Architecture ADR Report

## Status

`v2_architecture_adrs = CREATED`

## ADRs

- `ADR-P32C-001`: MailProvider abstraction and provider fallback strategy.
- `ADR-P32C-002`: Message lifecycle state machine as the only deletion/purge path.
- `ADR-P32C-003`: Audit hash chain and audit-the-auditor requirement.
- `ADR-P32C-004`: Org/tenant/RBAC foundation before P33.
- `ADR-P32C-005`: Vault threat model placeholder: device-lock vault vs true E2EE vault.
- `ADR-P32C-006`: AI policy by security classification.

## AI Policy

- Standard mail: local AI allowed.
- Confidential mail: explicit consent.
- Secure Vault: AI disabled by default.
- Legal Hold: AI access audited.
