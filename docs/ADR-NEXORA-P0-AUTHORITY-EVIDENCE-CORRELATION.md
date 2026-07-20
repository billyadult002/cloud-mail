# ADR: NEXORA P0 Authority, Evidence, and Acceptance Correlation

Date: 2026-07-19

Status: Accepted for merge-candidate review; production activation remains prohibited.

## Workspace isolation model

Tenant identity is the authenticated actor ID. Workspace authority is a server query over
`workspace_members`; account authority is a server query over `workspace_account_bindings` and the
actor-owned account. Client tenant/workspace values are rejected. Acceptance-session creation uses
actor plus account to derive exactly one workspace; zero or ambiguous matches fail closed.

Domain activation uses a pure-read, actor-scoped workspace selector. The client may present and
submit a workspace choice, but it cannot grant authority: the server re-reads membership, requires
the selected workspace tenant lineage to match the authenticated actor, and requires the role's
`domain:write` capability. DNS challenge, verification, bootstrap, and revoke repeat this check.
Multiple eligible workspaces require an explicit actor choice; account counts and domain hints are
never selection authority. The validation response records a BODYLESS request/runtime correlation
reference, while durable activation evidence remains attached to the later verified write path.

## Authority ownership model

A normalized domain has an immutable workspace owner. Verification names an exact pending challenge
and generation. Challenge consumption, workspace-domain binding, ownership verification event, and
audits commit together. Bootstrap reads the canonical verification event and cannot accept a client
evidence reference or revive a revoked authority implicitly.

## Classification identity model

The persist boundary accepts only `acceptanceSessionId` and `canonicalMessageId`. Provider, account,
domain, message identity, fingerprints, source timestamp, and classification signals are derived from
canonical `email`, `account`, workspace binding, membership, and verified Domain Authority rows.
Free-form evaluate remains explicitly non-durable and marked `UNVERIFIED_CLIENT_INPUT`.

## Atomic persistence model

One D1 batch advances the ledger head with CAS and inserts the run, classification event, Evidence
entry, and current projection. Constraint failure rolls back the batch. A scoped idempotency key plus
canonical input digest returns the existing complete chain on exact replay and rejects changed input.

## Evidence Ledger model

The mutable classification table is a projection. The system of record is the append-only 0079 run,
event, and evidence chain with generation lineage, SHA-256 canonical payload and entry digests,
authority generation snapshot, actor/session/request/runtime/account correlation, BODYLESS policy,
foreign-key/linkage guards, and UPDATE/DELETE abort triggers. Legacy 0077 evidence is not promoted to
v2 completeness.

## Runtime correlation model

The server issues a 10-minute, build-allowlisted acceptance session. Its tenant, workspace, account,
authentication reference, request ID, runtime deployment, and timestamps are server-derived. A random
challenge is returned once, stored only as a secret-bound digest, and consumed once with a scoped
classification. Replay, expiry, wrong actor/account/workspace/build/platform, or ambiguous workspace
fails closed.

## Acceptance correlation model

Desktop executes create session → canonical persist → consume → readback. iPhone executes create
session → canonical readback → consume → final session receipt. Both display Verified only when the
consumed receipt and classification/Evidence tuple match. Screenshots remain auxiliary viewport
artifacts. Apple Design requires immediate status, explicit completion/warning/error, accessible
semantics, Dynamic Type, reduced motion/transparency, safe-area layout, and no secret display.

## Consequences

Activation requires migration 0079, reviewed runtime configuration for deployment identity, build
allowlist and correlation hash secret, merged/deployed code, and a later production acceptance Mission.
This ADR does not authorize DNS, authority, classification, evidence, Desktop, or iPhone production
activation.
