# ADR: NEXORA Evidence-First Hybrid Classification

Date: 2026-07-19

Status: Accepted for successor implementation branch `codex/nexora-evidence-first-classification`.

## Context

Build 358 physical-device evidence showed apparent retail promotions while a VIP surface was active. The canonical Worker commit did not contain server-authoritative mail semantic classification or VIP evidence records. Local UI/profile behavior can therefore project VIP without durable server evidence.

## Decision

NEXORA uses one primary semantic category and independent attributes.

Primary categories:

- `PERSONAL`
- `BUSINESS`
- `TRANSACTIONAL`
- `NOTIFICATION`
- `NEWSLETTER`
- `PROMOTION`
- `SOCIAL`
- `SPAM`
- `SUSPICIOUS`
- `UNCLASSIFIED`

Independent attributes:

- `VIP_RELATIONSHIP`
- `PRIORITY_LEVEL`
- `REQUIRES_ACTION`
- `TIME_SENSITIVE`
- `UNREAD`
- `STARRED`
- `HAS_ATTACHMENT`

VIP requires explicit user/admin authority or a supported automatic authority. Strong bulk or promotional signals disqualify automatic VIP. AI can advise classification but cannot directly establish authoritative VIP, Tenant policy, Workspace policy, Domain authority, user override, or administrator override.

## Comail Provenance

- Authorization reference: user mission authorization for internal NEXORA development.
- Repository: `https://github.com/NextOSP/comail`
- Branch: `master`
- Commit inspected: `38960219de19812bcb8dbd562ee91974e0787737`
- Release tag inspected: `v0.2.22` at `deba788b6386f2f2fc78aa7b6e0dc3a0a961be66`
- Source paths inspected: `LICENSE`, `src-tauri/crates/comail-core/src/models.rs`
- Reuse classification: `COMAIL_GUIDED_IMPLEMENTATION`
- Copied code: none
- Translated code: none
- Adapted code: none
- Dependencies introduced: none
- License observed: AGPL-3.0
- Worker use: pattern guidance only for DTO separation and bodyless model boundaries
- Desktop use: none in this branch
- IPA use: none in this branch
- Production purpose: preserve provider/message model discipline without adding Comail as a dependency

## Consequences

The Worker becomes the durable classification authority for redacted message fingerprints, categories, attributes, corrections, and evidence references. Desktop and iPhone projections must consume this server state in a later Apple-source successor before real-device classification acceptance can pass.
