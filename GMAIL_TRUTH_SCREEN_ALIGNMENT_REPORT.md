# Gmail Truth Screen Alignment Report

## 1. Coherent Truth Architecture
All iOS screens and backend diagnostic routes query the same consolidated truth platform returned by the worker. The platform aligns the following aspects:
1. **Governance**: Managed by `governanceEngine`, evaluating the approval status of the Google Console OAuth test request.
2. **Provider**: Enforces the single V2 REST runtime (`REST_ONLY_ALLOWED_RUNTIME` = `true`) and deprecated legacy IMAP (`LEGACY_IMAP_MODE` = `false`).
3. **Lifecycle**: Dictated by `lifecycleEngine`, computing states from `Archived`, `Pending Approval`, `OAuth Required`, `OAuth Connected`, `Importing`, `Mailbox Ready`, `Reconnect Required`, or `Blocked`.
4. **Capability**: Validated by `capabilityEngine` checks (`canLogin`, `canImport`, `canSend`, `canReceive`, `canSync`).
5. **Health**: Evaluated by `healthEngine` score metrics based on errors and warnings.
6. **Freshness**: Measured by `freshnessEngine` (using last synced timestamp and clamp controls).

## 2. Integrated Screens
The consolidated response confirms that the following views and centers share this aligned data model:
- **Account Center**: For list views and generic mailbox configurations.
- **Accounts**: The core app accounts setting panel.
- **Mailbox Detail**: The detail sheet containing reconnect actions.
- **Diagnostics**: Technical telemetry dashboard.
- **Recovery Center**: Access point for broken sync state remediation.
- **Approval Center**: User request queue for tester user verification.
- **Enterprise Hub**: Organization-level control center.

## 3. Verification
- Alignment verified in `truthPlatform` schema returns.
- Validated via Vitest reliability test coverage.
