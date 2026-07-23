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

## Review and merge

- Pull request: `https://github.com/billyadult002/cloud-mail/pull/11`
- Reviewed head: `2df7c7d8f866301541e354689120b95c4336630f`
- Canonical merge commit: `bbc7ee73fda1e6d046c052daf13682af3e84ed6a`
- Changed inventory: this report, the staging-pinned config, one remediation SQL unit, one schema-only fixture, one focused test, and one package script.

## Staging execution

Immediately before execution, staging D1 `acf160ae-4efd-48d0-9d1b-7500f4cd0f41` still matched every reviewed predicate: exact 0081 once; exact 0082 through 0084 absent; no `_v2` tables; zero email, outbox, READY-binding, and OAuth-session rows; exact pre-schema and trigger; and an empty foreign-key check. Worker version `e1fa8ae1-3403-4cb7-bc90-e9aab98777da` and the sole secret name `jwt_secret` were unchanged. The original recovery bookmark `0000002a-00000000-000050b1-3bd594f6d6d5631cd057481579a3ce2a` remains retained; the immediate pre-execution bookmark was `0000002f-00000000-000050b1-b3dc392ca57a85c8b11a9d278a8be9f9`.

The remediation applied once at `2026-07-23 22:04:26` and recorded:

- identifier `nexora-staging-email-unread-compatibility-v1`
- the reviewed contract, database, before/after schema, and before/after trigger hashes
- zero pre-existing email, outbox, and READY-binding rows

Post-remediation verification found `unread INTEGER NOT NULL DEFAULT 0`, the byte-identical trigger, zero scoped rows, an empty foreign-key check, and no remaining remediation migration. A second remediation apply returned `No migrations to apply`.

Canonical application then completed in strict order:

- 0082, SHA-256 `1a28c4facc42210ba3d9e2a4bcee7ff80e39c84b8695fe3272008fbda0eed1f3`, succeeded on its single authorized retry at `2026-07-23 22:05:20`.
- 0083, SHA-256 `1f8d4bc099b1198fba687df550a2f565b5cc87e74d2478d8f87b174f2fd32b3c`, applied once at `2026-07-23 22:05:54`.
- 0084, SHA-256 `890d88f27b9103fb4a6bee428df3cf75f439ea2fc471173177af6a4991bbd794`, applied once at `2026-07-23 22:06:10`.

## Final verification

- Exact canonical filenames 0076 through 0084: each count one; no canonical migration remains pending.
- Remediation filename and durable record: each count one.
- Temporary `_v2` tables: none.
- Email, outbox, READY-binding, and OAuth-session rows: all zero.
- Foreign-key check: empty after every step and at closure.
- Native D1 table-scoped `quick_check`: `ok` for email, outbox, both ledgers, every Connection table, and every 0084 OAuth recovery table. D1 rejected unrestricted `integrity_check` as unauthorized and the unrestricted `quick_check` exceeded its remote memory limit; no integrity error was returned.
- Raw OAuth credential/artifact columns: absent.
- Final trigger and schema hashes: exact reviewed after-state hashes.
- Final Time Travel bookmark: `0000002f-0000000c-000050b1-ccbb09afb7d946801dcbc42bc5906a8e`.
- Staging Worker and secret inventory: unchanged.
- Production remained read-only and unchanged: canonical 0082/0083 state, `email.unread`, and Worker version `4fa31aae-6918-4e68-9d5e-a57d0e40a7e0` match the pre-mission snapshot.
- No Worker deploy, secret mutation, OAuth session, Provider/Google/Gmail call, mailbox operation, or production write occurred.

## Verdict

`STAGING_MIGRATION_CHAIN_PASS — OAUTH_CONFIGURATION_NOT_STARTED`
