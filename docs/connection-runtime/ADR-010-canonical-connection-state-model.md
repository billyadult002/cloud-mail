# ADR-010: Canonical Connection State Model

Status: accepted for Checkpoint 5 local implementation.

`nexora_connections` is the sole Connection Runtime state owner. Mission Runtime may schedule work and hold Evidence, but it does not own connection state. The states and permitted edges are executable in `connection-contract-service.js` and independently enforced by migration 0081.

Every state change requires a current authority generation, exact connection and credential generations, an unexpired single-owner lease, the current fencing token, an immutable transition event, a scoped operation, canonical supported Evidence, and a verified independent Verification row. D1 rejects initial states other than `DISCOVERED`, unknown edges, generation skips, terminal resurrection, mutable history, and direct state writes.

| State | Purpose | Human action | Terminal |
|---|---|---:|---:|
| DISCOVERED | Bound metadata identified | no | no |
| AUTHORIZATION_PENDING | Durable authorization session bound | consent | no |
| CALLBACK_PENDING | Provider callback observed and fenced | no | no |
| CONNECTED | Credential and provider-connection references bound | no | no |
| HEALTHY | Live bounded provider health verified | no | no |
| REFRESH_PENDING | Refresh operation owns a lease | no | no |
| DEGRADED | Non-terminal failure | no | no |
| RETRY_WAIT | Backoff/circuit delay | no | no |
| REAUTHORIZATION_REQUIRED | Credential authority absent/rejected | consent | no |
| SUSPENDED | Operator/policy pause | override | no |
| REVOKED | Confirmed terminal revocation | new connection | yes |
| DISCONNECTED | Explicitly detached | reconnect | no |
| FAILED_TERMINAL | Non-recoverable invariant failure | new connection | yes |

Initiating events are `DISCOVER`, `REAUTHORIZE`, `CALLBACK`, `HEALTH`, `REFRESH`, `SUSPEND`, and `REVOKE`. Retry is eligible only for degraded, retry-wait, and refresh-pending paths. Invalid transitions fail closed.
