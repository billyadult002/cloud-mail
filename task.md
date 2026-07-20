# NEXORA P0 Authority Hardening and Evidence Ledger Completion

Base: `origin/main` at `9e3e86e41487059fb7df0523fac3246ad9f124cf`

Status: `ACTIVATION_READY_PENDING_PRODUCTION_EXECUTION`

## Objective

Close every P0 in domain ownership, actor-derived classification authority, canonical message
provenance, atomic classification/evidence persistence, reconstructable Evidence Ledger, and
Desktop/iPhone server correlation. Produce a merge candidate only; do not activate production.

## Current verified findings

- Domain verify can leave a losing concurrent challenge incorrectly verified.
- Challenge replay can rewrite proof material after verification.
- Authority bootstrap accepts caller evidence references and is not atomically audited.
- Classification tenant/workspace/source identity is request-body authoritative.
- Classification and evidence use separate writes and can orphan or duplicate rows.
- Existing evidence rows do not form an append-only, integrity-verifiable authority chain.
- Desktop and iPhone normal product paths cannot recover server correlation evidence.

## Boundaries

No DNS TXT changes, domain verification/bootstrap, production classification/evidence creation,
production D1 writes, deployment, acceptance execution, or verdict upgrade.

## Loop

Maximum five Maker–Checker iterations. Each iteration must begin with a failing production-shaped
test or an explicit structural assertion and end with executed tests plus adversarial review.

Completed in three Maker–Checker rounds. Final independent results: `P0=0`, `P1=0`,
`SECURITY_REVIEW_PASS`, `CHECKER_PASS`. This is merge-candidate readiness only.

## Mission: Workspace Authority Resolution and Correlation Configuration Completion

Status: `ACTIVATION_READY_PENDING_PRODUCTION_INPUTS_AND_EXECUTION`

Final local candidate review: Security PASS; Checker PASS; P0 count 0. No production action or
production/device verdict upgrade was performed.

### Read-only discovery

- Candidate domain DNS edit authority: PASS; no DNS mutation performed.
- Workspace 1: `NEXORA Runtime Validation`; tenant `user:1`; creator/member OWNER is actor 1.
- Workspace 2: `admin Workspace`; tenant `user:1`; creator/member OWNER is actor 1.
- The same actor owns both workspaces, so actor/domain/account data cannot select one safely.
- Production Cloud Mail is not authenticated in the browser; FASTONE Hermes login is out of scope.
- `CF_VERSION_METADATA`, dedicated correlation secret, runtime identity and build allowlist are absent.
- iPhone signed Release identity observed locally as build `357`, version `3.03`; `project.yml` still
  says `303` and must be reconciled before allowlisting.
- Desktop release build identity is not currently configured.

### Newly reopened security findings

- P0: Correlation can consume another session's same-account classification.
- P0: Consume does not verify Evidence Ledger/head integrity.
- P0: Auth-session and active Worker-version continuity are not enforced.
- P0: Correlation/Domain references are not dedicated HMACs and may reuse JWT secrets.
- P1: Build label allowlisting is not binary/device attestation.
- P1: Readback does not recompute the complete authority/evidence digest.

### Closed in candidate

- Exact session/run/event/Evidence/head lineage and digest recomputation.
- Credential, deployment, build-policy, HMAC-version, replay and consume continuity.
- DNS Challenge and Classification Run HMAC key-version provenance, including rotation fail-closed tests.
- Dedicated 32-byte-minimum, purpose-separated HMAC with no JWT fallback.
- Independent final Checker PASS with P0 count 0 and no actionable findings.

### Stop conditions

No implementation or Cloudflare configuration mutation before human plan approval and explicit
workspace selection. No production deployment, migration, DNS record/challenge, bootstrap,
classification, evidence generation, direct D1 write, or verdict upgrade in this Mission.
