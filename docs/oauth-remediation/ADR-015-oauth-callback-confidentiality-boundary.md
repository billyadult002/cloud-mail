# ADR-015 — OAuth Callback Confidentiality Boundary

Status: Accepted for pre-production remediation review

## Decision

The provider callback is a server-only ingestion endpoint. Google web OAuth currently
delivers `code`, `state`, and provider error fields in the query string; this unavoidable
first navigation is accepted only at the Worker boundary. The Worker synchronously
consumes state and PKCE, seals the code/verifier/redirect tuple into a two-minute
AES-GCM callback intake, records a durable processing job, and then returns a `303` to a
fixed provider result path containing no query or fragment. It does not await the provider
token endpoint, JWKS, identity validation, or Connection commits before redirecting.
Success, denial, expiry, malformed input, and exceptions have the same browser response
shape.

The result page is static first-party HTML. It has `Cache-Control: private, no-store`,
`Pragma: no-cache`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
and a CSP of `default-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'`. It contains no scripts, analytics, external resources, account
identity, provider error, state, code, token, credential reference, query rendering, or
fragment processing.

The PKCE cookie is cleared in `finally`, including rejection and exception paths.
Provider callback inputs may be held in request-local memory or inside the bounded
encrypted callback-intake envelope only. The envelope has no plaintext artifact columns,
binds its expiry and authority tuple into AAD, is tombstoned on completion or expiry, and
is processed by the scheduled durable consumer. Same-request `waitUntil` processing is an
optional latency optimization, never the recovery authority. Logs, Evidence, Verification,
support records, tests, screenshots, and PR content may contain only redacted hashes or
opaque result classifications.

Google's web-server flow supports query callbacks and explicitly recommends removing
authorization response parameters with a redirect. `form_post` and fragment response
modes are not assumed and are not part of this contract.

## Consequences

The callback route cannot render diagnostic JSON. Operators diagnose failures from
redacted durable state. Browser tests assert a fixed `Location`, cookie invalidation,
security headers, and a resource-free result page. The redirect minimizes address-bar,
history, screenshot, and referrer exposure; no application-controlled page retains the
provider callback URL.
