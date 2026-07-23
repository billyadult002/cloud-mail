# ADR-018 — OAuth Artifact Retention and Redaction Policy

Status: Accepted for pre-production remediation review

| Artifact | Storage and encryption | Maximum retention | Evidence representation | Invalidation / incident action |
|---|---|---:|---|---|
| Authorization code | Request-local memory, then only inside AAD-bound AES-GCM callback intake | 2 minutes or intake completion | SHA-256-derived request digest only | Tombstone intake; never replay; exposed attempt is excluded |
| OAuth state | Browser/provider transit; hash in D1 | Session expiry | Session/correlation opaque reference | Single-use; expire or consume |
| Nonce | Browser/provider transit; hash in D1 | Session expiry | Presence/verification result only | Consume with session |
| PKCE verifier | HttpOnly secure cookie, request-local memory, then only inside AAD-bound AES-GCM callback intake | Cookie 10 minutes; intake 2 minutes or completion | Hash only | Clear cookie on every callback outcome; tombstone intake |
| Access/refresh token | AES-GCM secret boundary; sealed receipt during commit | Receipt 10 minutes; credential lifecycle thereafter | Opaque Credential Reference | Tombstone receipt after verification; scoped revocation plan for incident |
| Client secret | Worker secret binding only | Registration lifecycle | Configuration-present boolean | Rotate through separate credential procedure |
| Callback error | Request-local only | Callback execution | Opaque bounded reason code | Clean redirect; no provider detail |
| Callback intake | AES-GCM ciphertext; tenant/workspace/session/correlation/claim/provider/expiry in AAD | 2 minutes or completion | Opaque intake/job state only | Empty ciphertext on completion, malformed expiry, or timeout |
| Provider correlation | Opaque/hardened reference if supplied | Operational policy | Redacted fingerprint | Never include provider payload |
| Credential Reference | Canonical D1 metadata | Credential lifecycle | Opaque reference permitted | Revoke/tombstone under Connection Runtime |
| User result code | Fixed clean route; no per-attempt query | Page lifetime | Generic completion only | `no-store` |

All artifacts are prohibited from normal logs, telemetry, analytics, page titles, rendered
errors, referrers, Evidence payloads, Verification metadata, screenshots, support reports,
and PR text. Test fixtures use explicit non-secret sentinel strings so scanners can prove
that persistence and rendering do not contain them.
