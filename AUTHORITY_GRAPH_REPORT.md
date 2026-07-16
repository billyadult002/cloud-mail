# Authority Graph Report

Status: **PASS (engine and persistence); BLOCKED (live provider graph)**

- `AuthorityGraph` models subject, provider, capabilities, requested/granted scopes, and evidence edges.
- Client-asserted grants and verified capabilities are stripped at API boundaries.
- Evidence redaction is recursive; credentials are references only.
- Production migration `0026` is applied and Worker `8919a7a3-bd7e-40e2-8fcb-3dcb5c1fc4a0` is live.
- Live `nexora_provider_authorizations` count is `0`; therefore [AUTHORITY_GRAPH.json](/Users/billtin/Documents/cloudmail/AUTHORITY_GRAPH.json) truthfully remains `AUTHORIZATION_REQUIRED`.
- Evidence: `nexora-v3.test.mjs`, 21 focused tests; full suite 120/120.
