# NEXORA Universal Domain Onboarding Security Review

Verdict: `SECURITY_REVIEW_PASS_FOR_LOCAL_CANDIDATE`

P0 count: `0`. No authority, correlation, Evidence, or acceptance code issue remains that blocks
this candidate.

## Verified controls

- Client workspace is selector-only; server actor membership, tenant lineage, and capability decide authority.
- DNS ownership is reusable across providers and does not depend on Cloudflare-specific ownership semantics.
- Dedicated, versioned, purpose-separated HMAC-SHA-256 replaces short security fingerprints.
- JWT secret fallback is prohibited.
- Credential, deployment, allowlist, session, account, workspace, classification run, Evidence and head continuity are fail-closed.
- Build artifact/signing/policy metadata are server-derived.
- Evidence remains BODYLESS and append-only.
- DNS Challenge and Classification Run HMAC key versions are persisted; Classification Evidence
  integrity binds the run version, and rotation fails closed before ownership/classification writes.

## Independent execution evidence

- Evidence Ledger contract: PASS.
- Evidence Ledger SQLite integrity: PASS.
- Classification atomic-writer SQLite: PASS.
- Focused Security suites: 22/22 PASS.

## Explicit non-claim

Build allowlisting does not prove a physical device or binary. Physical-device acceptance requires server-verified attestation or equivalent signed installation evidence. Until then the device verdict cannot become FULL PASS.

## Deferred P1 architecture

Classification ledger stream identity still includes provider/domain snapshots. A later migration should make canonical account/message the primary stream identity and retain provider/domain as digest-bound generation snapshots to avoid history forks during provider/domain metadata migration.

Outstanding DNS challenges intentionally require reissue with a fresh idempotency key after HMAC
rotation. Automating that client recovery is P1 operational hardening, not a P0 authority bypass.
