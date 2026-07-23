# Provider Coupling Delta Report

Before Checkpoint 5, OAuth/provider literals were distributed across nine core onboarding files and executable credential access returned both access and refresh tokens by Mission identifier. Refresh selected the endpoint from work metadata without an exact provider-connection read boundary.

After Checkpoint 5, live Gmail health access is concentrated in `gmail-connection-adapter.js`; credential resolution is concentrated in token storage and consumed only through `provider-session-service.js`; lifecycle orchestration uses a provider-agnostic contract and adapter registry while the only registered production adapter is Gmail. The coupling guard rejects ciphertext access, direct Verification insertion, token-storage imports from the adapter/runtime, and raw provider fetches from the runtime; it requires invocation of the canonical Mission verifier.

Remaining intentional coupling: Google/Microsoft OAuth protocol configuration and token exchange remain in the existing canonical callback runtime. Checkpoint 5 does not replace that runtime. Gmail is the only allowlisted live Connection adapter.
