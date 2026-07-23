# NEXORA Admin Actor Transition — Implementation Plan

## Scope and stop conditions

- Target branch: `codex/nexora-admin-activation`, based on `origin/main` at `4bc382b9a93aa1677f93bac7bd5a49cb1c0371de`.
- This mission may change, test, merge, and deploy code, then perform read-only actor/workspace capability validation.
- It must not publish DNS, create ownership/authority/classification/evidence rows, or read browser authentication material.
- Maximum Maker–Checker repair iterations: 5.

## Maker work

1. Make Domain Authority bootstrap semantically idempotent and concurrency-safe.
   - Require a non-empty idempotency key.
   - Preserve the first verified authority identity and generation on replay.
   - Return an explicit idempotent receipt when the same verified authority already exists.
   - Emit bootstrap audit records only for the winning creation.
   - Reject revoked authority and conflicting verified-evidence continuity.
   - Add a migration only if a durable operation receipt/constraint is required by the final design.

2. Make explicit Workspace selection a verified-action boundary.
   - Persist or cryptographically validate a short-lived selection credential bound to actor session, actor-derived tenant, selected workspace, `domain:write`, request identity, deployment, and expiry.
   - Require that credential on challenge creation, challenge verification, and bootstrap; reject omission, workspace swapping, cross-session replay, stale deployment, and expiry.
   - Never accept tenant, role, capability, actor, or session authority from the request body.

3. Add a product-owned Domain Activation workflow to the Web app.
   - Use the existing axios instance so authentication remains internal to the product.
   - Display the server-resolved actor separately from the local profile display.
   - Discover actor-scoped workspaces; never auto-select when more than one exists.
   - Require an explicit Workspace selection and server-side capability validation.
   - Show tenant lineage, membership role, capability, request reference, HMAC key version, and deployment identity only in redacted form.
   - Include later challenge/verify/bootstrap stages behind explicit confirmations, but do not execute them in this mission.
   - Ensure responsive Apple-style hierarchy, clear destructive boundaries, keyboard access, loading/error/fail-closed states, and no credential/raw-token rendering.

4. Expand server responses only with safe actor/workspace authority metadata needed for UI reconciliation; never return auth-session secrets or authorization material.

## Verification

- Unit/contract tests for identical replay, changed idempotency key replay, concurrent first creation, revoked authority, evidence mismatch, audit exactly once, actor-derived tenant scope, selection omission, workspace swap, cross-session replay, expiry, and deployment discontinuity.
- Web tests for server actor mismatch, multiple-workspace no-default behavior, explicit Workspace 1 selection, capability denial, stale deployment, and credential non-rendering.
- Worker syntax, unit, RC/reliability, Web tests, release build, audit, and diff review.
- Independent security review and adversarial Checker review must both pass before merge.

## Merge and deployment

- Create a reviewed PR from the isolated branch; merge only after checks and independent approval.
- Create a fresh post-merge deployment worktree.
- Record read-only production baselines and verify business-row counts remain zero.
- Apply only a tracked pending migration if the approved design adds one.
- Deploy the exact merged SHA; verify `CF_VERSION_METADATA`, required binding presence, UI asset identity, and zero activation business writes.

## Post-deployment read-only acceptance

- Confirm the product UI and server both resolve `admin@fastonegroup.com`.
- Discover workspaces through the authenticated product UI.
- Explicitly select Workspace 1 — NEXORA Runtime Validation.
- Invoke only workspace-selector validation; verify membership, `tenant_key=user:1`, `domain:write`, HMAC/deployment continuity, and Workspace 2 not selected.
- Run final read-only D1 audit with `changed_db=false`; issue Activation Preconditions Report.

---

# Checkpoint 4 Implementation Plan

1. Resolve deployment authority to top-level `mail-worker` and selectively adapt verified Checkpoint 3 behavior to the canonical durable runtime.
2. Reproduce the dependency advisory from a clean install; prove graph and bundle/runtime reachability; test the smallest non-breaking resolution.
3. Add exactly one scheduled `search_email` path with default-off and emergency-disable controls, exact tenant/workspace/capability allowlists, bounded execution, rate/circuit controls, immutable authority, Evidence, Verification, and verified-only Mission progression.
4. Verify with real-D1 focused tests, complete Worker suite, clean install/audit, production dry-run build, coupling/secret/license/migration checks, and an independent adversarial reviewer.
5. After all P0/P1 findings close, commit and push the exact candidate, open a PR, and record review evidence.
6. Deploy only the reviewed immutable commit; keep global execution disabled; configure one redacted tenant/workspace scope; run one authenticated read-only production acceptance, safe negative probes, and rollback verification.

Stop conditions: no deployment of an uncommitted/unreviewed candidate; no provider write, credential access, mailbox mutation, DNS mutation, destructive migration, or claim that a canonical D1 search proves live Provider API, synchronization, or account linking.
