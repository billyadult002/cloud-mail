# NEXORA Capability Convergence Remediation — PR #10

## Authority and frozen-root record

- Canonical worktree: `/Users/billtin/Documents/cloudmail/.worktrees/nexora-checkpoint5-connection-runtime`
- Repository: `/Users/billtin/Documents/cloudmail`
- Branch/upstream: `codex/nexora-checkpoint5-connection-runtime` / `origin/codex/nexora-checkpoint5-connection-runtime`
- PR: `https://github.com/billyadult002/cloud-mail/pull/10` (open; head branch matches)
- Base/merge-base: `cafe44eca4359911cfd773f0f262f3b4c37b9720`
- Initial HEAD: `61f04874b661f2c4cd72204c7ed5fc5a7a1af2af`
- Initial tree: `a7fe5c01f68165a01078f6c4c860f237492cddab`
- Remote: `https://github.com/billyadult002/cloud-mail.git`
- Initial PR worktree state: clean; 571 tracked files. No new worktree was created.
- Frozen root: `/Users/billtin/Documents/cloudmail`, branch `mission-runtime-pilot`, HEAD `cae0c23fb43f8bdee0ab3afd7d967cace5679103`; it remained dirty and was not used for implementation.
- Root `repository_check.log`: committed blob `5bdf8f358346aa116295a6b6fbb93e51cdd1142e`, committed SHA-256 `c13796b7194d494469a84e6b0ff89c24bd9503c5f591b22d8301c3f20a24017a`; observed final blob `be052aa3f420c1365b62d16a5b79d9c411d9a7c4`, SHA-256 `03b58a1465a0d2ce222d2e467439bd4f8aae2b138da7a9214e223ef4c297ae23`.
- Mission-related append: lines 2346–2348 at `2026-07-23 16:20:03`, `16:20:51`, and `16:21:14`; commands were the mandatory repository checks for root authority, rejected candidate authority, and PR #10 authority. The isolated Checker then ran its mandatory check, appending line 2349 at `16:36:23` for `capability_convergence_checker`. The lines contain no secrets and alter no executable behavior. They were not reset, restored, staged, committed, or copied.

`FROZEN_ROOT_PRESERVED_WITH_RECORDED_CHECK_APPEND`

## Source reconciliation and salvage matrix

| Reference | Classification | Resolution in PR #10 |
|---|---|---|
| `2a8f7c9:nexora-email-capability-contract.js` | conflicting five-verb contract | Reject as canonical contract; retain only the mapping concept: connect → Connection Runtime, sync_delta → `get_delta`, list → canonical reads, watch → `watch_mailbox`, send → `send_email`. |
| `2a8f7c9:nexora-capability-invocation.js` | unsafe | Reject best-effort authority-event Evidence, fabricated IDs, self-declared verification, mode contract, and caller injection. |
| `2a8f7c9:nexora-google-email-capability-adapter.js` | test-only mapping value; production-unsafe | Reject direct OAuth/sync/email-service dependencies and default dependency injection. Reuse no code. |
| `2a8f7c9:nexora-email-capability.test.mjs` | test-only value | Reimplement negative intent against canonical Cloudflare/D1 construction; do not retain fake production construction. |
| `cae0c23` report files | report-only; claims conflict with canonical boundaries | Do not copy. Historical 674 count and staging claims are scoped, not accepted as PR #10 evidence. |
| PR #10 ADR-008/009 and capability services | canonical equivalent exists | Retain and harden the accepted `search_email` execution path. |
| `d258bfa` | unrelated cancellation fix | Not imported; not required by this read-only ancestry. |

No new ADR was required. No reference commit was merged or cherry-picked.

## Canonical contract and execution map

Canonical identifiers remain `search_email`, `read_thread`, `fetch_message`, `send_email`, `draft_reply`, `classify_email`, `watch_mailbox`, and `get_delta`. Only `search_email` is enabled in this slice.

The one integrated caller is the existing scheduled read-only caller:

`scheduled-capability-runtime-service` → `mintCapabilityAuthorityContext` → Verified Action Boundary (`READ_MAIL`) → immutable production `invokeCapability` construction → canonical Registry → synchronized-D1 Gmail adapter → canonical Evidence writer → separate canonical verifier → verified outcome → caller result.

Non-migrated callers are unchanged. No delta, watch, send, OAuth, Provider Connection, live Gmail API, credential, or mailbox-mutation path was added.

Authority enforcement binds positive Tenant, Workspace, actor, Account, authority generation, active Mission lease, fencing generation, membership/account readiness through `resolveAccountAuthority`, and a checked Authority Audit insert. `workspace_authority_events` remains audit-only.

Evidence identity is minted only inside the canonical writer. The write must affect exactly one row. The integrity payload binds invocation, capability, Tenant, Workspace, actor, Account, Mission/run/step/action, generations, replay key, adapter, request, adapter result, execution result, safety flags, and timestamp.

Independent Verification lives in `capability-verification-service.js`. It rereads durable Evidence, recomputes integrity and request/result digests, validates canonical synchronized-state source, exact scope, safety flags, adapter binding, and Evidence binding, then requires exactly one Verification write. Adapters never return final Verification.

Production invocation accepts raw authority input, traverses `mintCapabilityAuthorityContext` internally, and then constructs the canonical Registry, writer, verifier, and Gmail adapter. Caller-frozen contexts and dependency/time overrides are rejected. Injection remains only behind the explicitly named `invokeCapabilityForTest`.

The Gmail adapter rejects malformed D1 envelopes, non-array/oversized results, invalid row identities, cross-Account or cross-actor rows, substituted sources, and malformed scopes. It returns opaque digested message references and explicit canonical-source/scope/safety metadata.

## Test-scope reconciliation

| Reported scope | Classification |
|---|---|
| 674/674 | Historical `mission-runtime-pilot` Worker reliability claim at the rejected five-verb seam; its own report says the seam added 10 tests. It is not PR #10 and does not include this canonical remediation. |
| 949/949 | Conditional requested target in the predecessor Mission text. No repository command output, report, or test-discovery artifact proving a 949-test run was found. It is unsubstantiated and obsolete as a canonical gate. |
| PR #10 canonical gate | `mail-worker`, this exact worktree/source: Cloudflare/Vitest real local D1, 22 discovered reliability files, 282/282 tests; focused capability file 25/25. |

## Verification evidence

- Focused: `npx vitest run scripts/reliability-tests/scheduled-capability-runtime.test.mjs` — 1 file, 25/25.
- Full Worker: `npm run test:rc` — 22 files, 282/282.
- Unit/syntax/D1 integrity: `npm run test:unit` — pass, including Evidence Ledger and Connection Runtime SQLite checks.
- Coupling: `npm run test:provider-coupling` — `PASS migrated_files=7 adapter_files=1`; `npm run test:connection-coupling` — pass.
- OAuth artifact and migration integrity: `npm run test:oauth-artifacts`; `npm run test:oauth-sqlite` — pass.
- Dependency audit: `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high` — zero vulnerabilities.
- Secret scan: changed-code high-confidence key/token/private-key patterns — no matches. Keyword-only matches were expected policy/error text in the caller and Mission state files, not credential values.
- Dry-run bundle: immutable local build identity plus `npx wrangler deploy --dry-run --env=""` — pass; 308 assets, Worker upload 2445.62 KiB / gzip 522.61 KiB; `--dry-run: exiting now`. No deploy occurred.
- `git diff --check` — pass.
- Migration changes: none. Existing migration/SQLite integrity gates pass.
- Staging OAuth, Google/Provider calls, mailbox operations, remote D1 writes, migration apply, and deployment: zero.

## Coverage delta and staging gate

The focused file grew from 9 to 25 tests. Added coverage includes writer exception/zero-row/malformed Evidence, Evidence-only residue, persisted Evidence metadata substitution, integrity and verifier failure, forged production context/injection override, malformed and cross-scope adapter data, read-Authority failures, replay scope substitution, checked caller completion/outcome transitions, and exact same-job recovery from a verified-outcome/completion-failure residue.

The first isolated Checker verdict was BLOCK: one P0 forged-context Authority bypass and two P1s covering completion retry residue and persisted Evidence reconstruction. The Maker remediated all three and reran the focused, full, unit, syntax, D1, and coupling gates.

The same isolated Checker then re-ran focused tests, the coupling guard, `git diff --check`, and a manual forged-context probe. Final verdict: `CLEAN`; P0: none, P1: none, P2: none. The probe rejected with `capability_authority_input_required` before DB access. The Checker observed no staging or Provider mutation.

Implementation commit, final HEAD, and PR push evidence are recorded after publication.
