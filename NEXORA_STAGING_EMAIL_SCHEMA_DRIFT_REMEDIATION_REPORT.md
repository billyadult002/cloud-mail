# NEXORA staging email schema-drift remediation

## Source authority

- Base commit: `ce376bb82ca4c2b7ec67ea42a42a9d298c604946`
- Base tree: `42ad6e74b17fe2d0b5f388a185d5377e875d0d7e`
- Branch: `codex/nexora-staging-ucs-trigger-remediation`
- Worktree: `.worktrees/nexora-checkpoint5-connection-runtime`
- Canonical Migration 0082 SHA-256: `1a28c4facc42210ba3d9e2a4bcee7ff80e39c84b8695fe3272008fbda0eed1f3`
- Production already applied canonical 0082; migrations 0076 through 0084 remain immutable.

## Decision

Legacy `email.unread` is a legitimate compatibility field with `0 = unread` and `1 = read`. Staging alone lacks it while retaining the production-identical `ucs_email_updated_outbox` trigger. Authoritative UCS membership continues to use `mail_canonical_state.is_read = 0`; this remediation does not change consumer behavior or trigger semantics.

The selected unit is `nexora-staging-email-unread-compatibility-v1`. It is pinned to staging D1 database `acf160ae-4efd-48d0-9d1b-7500f4cd0f41`, uses Wrangler's transactional D1 migration mechanism, and is durably represented by both its exact migration filename and `nexora_schema_compatibility_remediations`.

## Immutable fingerprints

- Remediation contract SHA-256: `ff7f08a4c78ee94fbfd020080ecbd27dfe0475c943e8623641c8dc52fbbcc7c1`
- Remediation SQL file SHA-256: `f3fa3d6a420f6059f65149b5dde41dfaf2fbafb056b725584e0982db233925d1`
- Trigger before/after SHA-256: `5407da48f92bde0ac391fa3f8be6d4ac8e6f9a4ff63bcfc4b78949ded04de32e`
- Email schema before SHA-256: `403b0f0648f1882047f10d179b122a3fb23c4f3cdbcb2c927b249a6f3d17b517`
- Email schema after SHA-256: `60df64ac19d9919b53dfd71684e52572487c6f4dbfbf51412d150e2e89cfb041`

## Exact predicates

The transaction requires canonical 0081 exactly once; canonical 0082 through 0084 absent; no Connection `_v2` tables; exact email schema and trigger SQL; zero email rows, UCS outbox rows, and READY Account bindings; and no prior remediation record. The reviewed configuration pins the exact staging database UUID. Any mismatch aborts and rolls back.

Only `ucs_email_updated_outbox` is temporarily removed. The transaction adds `unread INTEGER NOT NULL DEFAULT 0`, recreates the byte-identical trigger, verifies the post-schema and trigger, writes one remediation record, and lets Wrangler append the migration ledger entry only after success.

## Verification and execution

Maker verification completed on 2026-07-23:

- Focused drift, rejection, rollback, idempotency, trigger semantics, and combined 0081 through 0084 SQLite fixture: pass.
- OAuth SQLite integrity, Connection coupling, and OAuth sensitive-artifact guards: pass.
- Unit/static suite: pass.
- Cloudflare/Vitest release-candidate suite: 22 files and 282 tests passed.
- Dependency audits, including production-only dependencies: zero vulnerabilities.
- Diff whitespace check and changed-artifact secret-value scan: pass.
- Staging Worker build dry-run: pass; no deploy occurred.
- Isolated adversarial Checker: CLEAN after two P2 fixture-coverage gaps were corrected; no P0, P1, or P2 findings remain.

Pull-request, merge, staging execution, final migration, integrity, idempotency, and OAuth-stop evidence remain pending and will be appended without sensitive values.
