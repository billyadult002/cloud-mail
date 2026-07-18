# NEXORA callback recovery behavioral specification

This is an independently written clean-room contract. It is based on NEXORA authority requirements and OAuth
authorization-code security properties; it contains no third-party source fragments.

1. A callback begins by hashing the returned opaque state and resolving exactly one non-secret D1 correlation
   record. No URL, browser, active-workspace, or default-workspace value can supply scope.
2. The runtime atomically leases a callback claim. The lease has an owner, expiry, monotonically increasing
   fencing token, and an attempt number. Every material write checks all four plus correlation/session/Mission
   validity.
3. Each external or local effect is represented by a monotonic checkpoint. A terminal checkpoint cannot be
   reset by a retry; retries begin at the first incomplete safe checkpoint.
4. Before a token request, persist an exchange intent with a non-secret operation reference. After a provider
   response, persist only normalized/redacted outcome information. Never persist a code, verifier, or token.
5. If an interrupted exchange has no durable token authority, classify it `RECONCILIATION_REQUIRED`; never
   redeem the code again by assumption. If the provider outcome cannot be reconciled, create a reauthorization
   checkpoint retaining the exact correlation/Mission/provider/scope lineage.
6. If a matching durable token authority exists, resume subsequent idempotent validation, binding, discovery,
   synchronization, and Mission continuation without another exchange.
7. A lease-expired callback may be taken over only after proving correlation validity, Mission resumability,
   absence of a completed outcome, and safe recovery classification. Stale workers may record only redacted
   observations and cannot mutate authority or completion state.
8. An independent verifier, not the callback executor, marks an outcome verified after it confirms exactly one
   expected token generation, workspace/tenant/provider/session agreement, sufficient scopes, one sync dispatch,
   Mission continuation, consumed correlation, and complete evidence lineage.
