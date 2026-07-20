# ADR: Universal Domain Onboarding and Correlation Authority

Status: Accepted for local merge candidate; production execution prohibited in this Mission.

## Workspace selection model

The client may submit a workspace identifier only as a selector. The server derives the actor from the authenticated session, loads only that actor's memberships, validates personal tenant lineage, and requires a server-defined capability. Domain create, verify, bootstrap, and revoke repeat `domain:write` validation instead of trusting an earlier UI decision. Discovery uses pure `SELECT` paths and never invokes default-workspace creation.

## Actor authority model

Tenant is always `actor.userId`. Workspace authority is a current server membership plus role-derived capability. Account and message identifiers are selectors that must resolve to canonical server records under the actor, workspace, verified domain authority, and account binding. Provider, domain, source, actor, runtime, request, and evidence identity are server-derived.

## Correlation identity model

All sensitive references use an independent `NEXORA_CORRELATION_HASH_SECRET`, a mandatory `NEXORA_CORRELATION_HMAC_KEY_VERSION`, WebCrypto HMAC-SHA-256, and purpose-specific domains. JWT signing secrets are never fallback material. Secrets shorter than 32 bytes fail closed. DNS challenges, domain verification events, acceptance sessions, classification runs, and runtime correlation events persist the HMAC key version. Classification Evidence integrity binds the run key version. Rotation invalidates outstanding challenges and sessions fail-closed; clients must reissue/restart under the active version.

Session creation records the authenticated credential reference and immutable Worker version from `CF_VERSION_METADATA.id`. Classification persist/read, acceptance consume/readback, and evidence linkage require the current credential, Worker version, active reviewed build manifest, actor, account, workspace, and acceptance session to remain identical.

## Evidence and replay model

Consume requires an exact chain:

`acceptance session → classification run → current event → current Evidence row → ledger head`.

The run must name the same acceptance session. The Evidence verifier recomputes payload, entry, previous-entry, generation, and head digests. Consume is a single atomic state transition plus append-only correlation event. Receipt readback re-verifies the chain and recomputes canonical tuple/event digests. Cross-session, cross-token, deployment rollover, replay, tamper, and head mismatch fail closed.

## Deployment metadata model

The only authoritative runtime deployment identity is Cloudflare `CF_VERSION_METADATA.id`. Manually supplied deployment/release strings are not accepted as equivalent evidence.

## Build identity model

Desktop release builds must embed the full reviewed 40-character Git commit as both build ID and source commit. Release builds fail when identity fields are absent or inconsistent. The iPhone project and generated Xcode project use build `357`, version `3.03`.

The server allowlist is the authority for artifact SHA-256, source commit, signing identity, signing-key version, policy version, validity window, and revocation status. Client-supplied artifact/signing/policy authority fields are rejected. A label match proves only that a client claimed an allowed tuple; it does not prove that a physical device runs the reviewed binary. Physical-device COMPLETE requires server-verified platform attestation or equivalent signed installation evidence bound to the server challenge.

## Universal domain onboarding model

The authority model is provider-agnostic. It depends on a normalized domain, a DNS TXT proof observed through resolvers, authenticated actor/workspace capability, and append-only evidence. Cloudflare is one compatible DNS host and runtime, not the source of domain ownership semantics. Future DNS providers use the same challenge, proof, verification, binding, authority, and audit contracts.

## Consequences

- Missing HMAC key/version, build manifest, immutable Worker metadata, membership, verified ledger head, or continuity evidence stops the flow.
- Screenshots and client state remain auxiliary evidence.
- Production migration, deployment, DNS verification, bootstrap, classification, and evidence population require later explicit authorization.
