# ADR-009: Production Evidence and Acceptance Boundary

Status: Accepted.

Evidence categories are non-interchangeable:

1. Local fixture proof: Cloudflare/Vitest real-D1 tests using synthetic rows.
2. Production D1 read proof: a deployed adapter reads existing canonical synchronized rows for one allowlisted production scope.
3. Live Provider API proof: a directly observed provider request/response correlation. This adapter intentionally cannot produce it.
4. Synchronization proof: separately correlated ingestion checkpoint and freshness evidence. A search over stored rows is not synchronization proof.
5. Account-linking proof: separately correlated OAuth/connection lifecycle evidence. Search is not linking proof.
6. Production Mission proof: deployed commit/version, server timestamp, Mission/run/action/invocation, authority event, adapter result digest, Evidence, Verification, and outcome identifiers correlate.

Production acceptance must redact tenant, workspace, account, message, query, credential, and mailbox content. Identifiers in the final report are hashed or represented by non-secret fingerprints. The acceptance query must be bounded and non-sensitive. No production PASS is permitted unless the exact reviewed commit is deployed and rollback is observed.
