# ADR-012: OAuth Refresh and Recovery State Machine

Status: accepted for Google implementation; Microsoft live acceptance is out of scope.

The canonical callback validates server-persisted state, PKCE, nonce, provider, tenant/workspace correlation, durable login-hint hash, and Microsoft tenant hint before authority can be stored. Missing code or redirect data does not consume a session. Callback ownership is leased, renewed before and after token/JWKS network work, and fenced.

Refresh work is durable and single-owner. Eligibility is restricted to the one configured tenant/workspace/provider/account cohort and driven by expiry metadata; claims require an unexpired lease, exact token generation, active provider-connection binding, and canonical Connection reference. Rotation advances token, binding, and Connection credential generations in one abort-on-zero D1 batch. `invalid_grant`/confirmed revocation becomes revoked or reauthorization-required; 429/5xx outcomes use capped exponential backoff plus jitter and a five-attempt cap.

Every provider refresh attempt is durably marked before the network call. An expired lease with a started attempt is never automatically replayed: an unknown response/commit boundary is classified for reauthorization instead of risking reuse of a possibly rotated refresh token. A response observed before a crash is never evidence that a commit occurred. A stale worker cannot commit after lease expiry, generation rotation, provider mismatch, or fence loss. Safe cancellation and suspension never revoke provider consent. Production revocation testing is prohibited unless separately authorized.
