# ADR-011: Credential Reference and Secret Boundary

Status: accepted.

Connections persist only an opaque token-row identifier and its exact rotation generation. Provider-connection identity and generation are separate, exact predicates. Raw access or refresh tokens are absent from Mission data, connection records, operations, events, Evidence, Verification, telemetry, errors, and reports.

The only decryption entry point is token storage, and its plaintext result is consumed only inside Provider Session. It requires tenant, workspace, provider, onboarding mission, credential reference, token generation, provider-connection reference, provider-connection generation, and a declared purpose. `provider_health` resolves access authority only; `refresh` resolves refresh authority only. Returned objects reject serialization and never cross the Provider Session boundary.

Provider-token encryption always requires `AI_PROVIDER_TOKEN_SECRET` or `PROVIDER_TOKEN_SECRET`, independent of rollout flags. AES-GCM ciphertext is versioned and authenticated with tenant/workspace/provider/mission, credential reference, exact generation, and token kind (`access` or `refresh`) as additional data. JWT signing keys and legacy unbound ciphertext are rejected; legacy rows require reauthorization. This is intentional fail-closed migration behavior.
