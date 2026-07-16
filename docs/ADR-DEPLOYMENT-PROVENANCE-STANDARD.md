# ADR: Deployment Provenance Standard

Status: Accepted
Date: 2026-07-16
Mission: CLOUDMAIL SOURCE-OF-TRUTH REPOSITORY AND DEPLOYMENT PROVENANCE RESTORATION
Related: `DEPLOYMENT_PROVENANCE_REPORT.md`, `docs/ADR-REPOSITORY-AUTHORITY-RESTORATION.md`

## ADR-3 — Deployment ↔ Release Tag binding rule

Every production or staging deployment MUST correspond to a resolvable Git ref:

- A production release is cut from an annotated tag `vYYYY.MM[-patchN]` pointing at
  the exact commit deployed.
- The tag message MUST record the resulting Cloudflare Worker Version ID(s).
- Hotfixes still tag (e.g. `v2026.07-f3-logout`) — no untagged production deploy.

## ADR-4 — Production deploy must reference Commit + Tag + Worker Version

A production `wrangler deploy` is only auditable if all three are captured **at deploy
time** and recorded in `DEPLOYMENT_PROVENANCE_REPORT.md`:

1. **Commit SHA** — `git rev-parse HEAD` (tree must be clean; no uncommitted src).
2. **Release Tag** — the annotated tag at that commit.
3. **Worker Version ID** — from `wrangler deploy` output / `wrangler deployments list`.

### Deploy registration procedure (A6)

Before deploy:
- `git status` clean for `platform/cloud-mail/mail-worker/**` (UCS doc churn excepted).
- Create/confirm the release tag at HEAD.
- Record prior active Worker Version as the rollback reference.

After deploy:
- Append a row to the DEPLOYMENT_VERSION ↔ GIT_COMMIT and Worker Version ↔ Tag tables.
- Record UTC deploy timestamp, deployer identity, and a post-deploy health result.

### Rollback rule

Roll back with `wrangler rollback <priorVersionId>` (code-only; these fixes carry no
D1 migration). The prior Worker Version and its commit/tag MUST be discoverable from
the mapping tables so any release can be reverted to its predecessor.

### Pre-baseline deploys

Worker versions created before `v2026.07-baseline` (e.g. `338018fc…`) predate version
control and have **no commit**. They are retained only as rollback references and are
explicitly marked `pre-baseline / unmapped`.

## Consequences

Audit questions ("which commit/tag is in production?", "which deploy shipped F1?",
"which commit introduced a fix?", "how to roll back?") are answerable from the mapping
tables plus `git log`/`git show`. A deploy lacking any of the three identifiers is
non-compliant and must be re-registered.
