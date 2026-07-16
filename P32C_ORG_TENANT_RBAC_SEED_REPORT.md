# P32C Organization / Tenant / RBAC Seed Report

## Status

`org_tenant_rbac_seed = READY`

## Models

- organization
- tenant
- domain ownership
- org membership
- role
- permission
- policy scope
- future SSO connection placeholder
- future SCIM provisioning placeholder
- sensitive action review

## Roles

- `OWNER`
- `ADMIN`
- `COMPLIANCE_OFFICER`
- `AUDITOR`
- `USER`

## Sensitive Actions For Future Two-Person Review

- legal hold apply
- legal hold release
- full mailbox export
- domain disconnect
- destructive purge
- provider credential rotation

Current single-user flows are preserved.
