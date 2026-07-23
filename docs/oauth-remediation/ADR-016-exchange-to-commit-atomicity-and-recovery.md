# ADR-016 — Exchange-to-Commit Atomicity and Recovery

Status: Accepted for pre-production remediation review

## Decision

The existing callback claim remains the sole exchange owner. Before the provider request,
the runtime creates one `nexora_oauth_exchange_attempts` row keyed by authorization
session and correlation. It binds tenant, workspace, provider, Connection, Connection
generation, authority generation, claim, lease owner, fencing token, idempotency key,
and a digest of the code/verifier/redirect request without persisting those inputs.

Before this exchange stage, the browser-facing callback stores one encrypted, two-minute
callback intake and one `NEXORA_OAUTH_CALLBACK_PROCESS` durable job. A scheduled consumer
claims the intake with a lease and fencing token. Worker eviction returns the job to a
retryable state; completion or expiry tombstones the intake ciphertext and closes the job.

Immediately after a provider response, before identity validation or any other fallible
step, the complete exchange result is serialized and AES-GCM encrypted with AAD containing
the attempt, session, correlation, claim, scope, Connection, generation, fence, and request
digest. D1 receives only ciphertext, a receipt digest, expiry, and an opaque classification.
The sealed receipt and `TOKEN_EXCHANGE_RESPONSE_SEALED` checkpoint are committed in one
D1 batch with zero-row aborts.

The credential insertion and promotion to
`CREDENTIAL_STORED_CONNECTION_PENDING` are also one D1 batch. Recovery at later stages
validates and reuses the exact Credential Reference and Provider Connection generation;
it does not rotate credentials, create another Provider Connection, or call the token
endpoint again. A callback-claim takeover transfers the correlation fence monotonically
before verified consumption. An exchange-attempt insert loser has no provider-call
authority even if the winning row is still `EXCHANGE_IN_PROGRESS`. Current Connection,
Connection generation, authority generation, account, and Domain Authority are repeated
as D1 write predicates; the verified callback result has the same schema-level authority
gate. The session binding additionally freezes Domain Authority generation, current
Account owner, and exact membership/delegation authority references and generations.
Every exchange, credential, Provider outcome, and verified-result write joins a reusable
live-authority relation that requires a non-deleted Account, current Workspace membership,
active/unexpired delegated `account_state_visibility` authority when applicable, and the
same verified/non-revoked Domain Authority generation. Revoking any underlying authority
therefore invalidates commit authority even when the cached Connection row is unchanged.
A durable binding mode keeps rollback behavior explicit: `LEGACY` permits only a wholly
null Connection/authority tuple, while `CONNECTION_RUNTIME` requires the complete live
relation. The final callback Connection transition also binds the exact pending exchange,
verified result, credential generation, and Provider Connection generation; correlation
alone is never sufficient.

Recovery opens the receipt locally and never submits the authorization code again. A
current callback claim and fence are required for each state promotion:

```text
EXCHANGE_IN_PROGRESS
  -> EXCHANGE_FAILED_RETRYABLE | EXCHANGE_FAILED_TERMINAL
  -> EXCHANGE_SUCCEEDED_COMMIT_PENDING
  -> CREDENTIAL_STORED_CONNECTION_PENDING
  -> CONNECTION_COMMITTED_VERIFICATION_PENDING
  -> CALLBACK_VERIFIED
```

`RECOVERY_REQUIRED` and `REAUTHORIZATION_REQUIRED` are fail-closed terminals for
ambiguous or expired receipts. `CALLBACK_VERIFIED` tombstones receipt ciphertext.
Duplicate callbacks may resume from an unexpired sealed receipt but cannot create a
replacement session or call the token endpoint.

An expired `EXCHANGE_IN_PROGRESS` attempt without a sealed receipt is durably moved to
`REAUTHORIZATION_REQUIRED` with `EXCHANGE_OUTCOME_AMBIGUOUS`; it cannot remain indefinitely
in progress or acquire replay authority.

There is no Google API that safely proves whether an authorization code exchange
succeeded without possessing and using credential material. Therefore an attempted
exchange with no sealed response is not guessed as failure or success; it requires
reauthorization. A separate bounded revocation mission is required if incident review
determines that a returned grant may still be live.
