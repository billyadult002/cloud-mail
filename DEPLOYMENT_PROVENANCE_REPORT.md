# CloudMail Deployment Provenance Report

Mission: CLOUDMAIL SOURCE-OF-TRUTH REPOSITORY AND DEPLOYMENT PROVENANCE RESTORATION
Date: 2026-07-16
Related standard: `docs/ADR-DEPLOYMENT-PROVENANCE-STANDARD.md`

## Environment / identity (E2)

| Field | Value |
|-------|-------|
| Cloudflare account | `saercpku@gmail.com` (ID `9a13d1cf25750a43faa1d96ebc66920b`) |
| Production Worker | `cloud-mail` — D1 `cloud-mail` (`4c05f52d-5d8c-4fb5-9a6d-888bebf8c596`), KV `78c5a747…`, R2 `cloud-mail-r2`, `UCS_ACTIVATION_ENABLED=true`, crons `* * * * *` + `0 16 * * *` |
| Staging Worker | `cloud-mail-staging` — D1 `cloud-mail-staging` (`acf160ae-4efd-48d0-9d1b-7500f4cd0f41`), KV `7e5a23c8…`, R2 `cloud-mail-staging-r2`, no crons, classification off |
| Domains | `fastonegroup.com`, `hengmao.org` |

## DEPLOYMENT_VERSION ↔ GIT_COMMIT mapping (A4)

| Worker Version | Env | Deployed (UTC) | Git commit | Tag | Notes |
|----------------|-----|----------------|-----------|-----|-------|
| `b3283329-37f4-45ef-ae75-b89186e72e11` | **staging** | 2026-07-16 (14:4x) | `3ab120b60c39957e8d7051284a99efac2b1c7cd3` | `v2026.07-ucs-hwm-v3` | UCS HWM **V3 rematerialization** latch (composite `(created_at,id)`, flag-gated, default off). Staging only. |
| `500395a9-f485-47d4-bf13-952ca33ab93c` | staging | 2026-07-16 14:23:50 | `5a40b0b2bee4919af852da7b03dbb2ccadb5fb91` | `v2026.07-ucs-hwm` | UCS high-watermark **backfill** completion (flag-gated, default off). Staging only; production untouched. Rollback ref `d0396317`. |
| `525681a1-36c5-4b52-be3f-9a6be445a641` | production | 2026-07-16 19:22:20 | `0b5dd1d3583c3d2824d020ee7d6a5eadf1207f49` | `v2026.07-ucs-hwm-v3-enabled` | **HWM ENABLED for W2** (`UCS_HWM_COMPLETION_ENABLED="true"`). Current active. Verdict PRODUCTION_CONVERGENCE_IN_PROGRESS. Rollback → `dbcf4c70`/`d05ffd3e`. |
| `dbcf4c70-7936-4887-902d-7ec4aa868830` | production | 2026-07-16 19:15:59 | `3ab120b60c39957e8d7051284a99efac2b1c7cd3` | `v2026.07-ucs-hwm-v3` | HWM code, flag OFF (behavior-identical). Health 200. Flag-off rollback ref. |
| `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1` | production | 2026-07-16 13:42:22 | `e78ba127b2d0860ad5ec3398152444b744fc2b1e` | `v2026.07-f3-logout` | **F3 fix** (logout session integrity + TTL). Pre-HWM rollback ref. |
| `101308e4-0faf-4ecc-897d-6fd47753a012` | production | 2026-07-16 13:25:50 | `18f7f25b64df81c3aa61248fd711760972de0539` | `v2026.07-baseline` | **F1 fix** (addUser parameterization). Baseline src == deployed src. Rollback ref for F3. |
| `338018fc-7c51-4740-80e4-fc0388357441` | production | 2026-07-16 01:42:08 | — (pre-baseline) | — | Rollback reference only; predates VCS. |
| `d0396317-00f3-4596-8caf-91f8dadda860` | staging | 2026-07-05 04:45:59 | — (pre-baseline) | — | Pre-F1; staging not yet updated. |

## Worker Version ↔ Release Tag mapping (A5)

| Release Tag | Commit | Production Worker Version | Status |
|-------------|--------|---------------------------|--------|
| `v2026.07-ucs-hwm-v3-enabled` | `0b5dd1d3…` | `525681a1-…` | **Active in production** (HWM enabled, convergence in progress) |
| `v2026.07-ucs-hwm-v3` | `3ab120b…` | `dbcf4c70-…` (flag off) | Deployed to prod flag-off; flag-off rollback ref |
| `v2026.07-ucs-hwm` | `5a40b0b2…` | staging `500395a9-…` | Backfill HWM; superseded by -v3 |
| `v2026.07-f3-logout` | `e78ba127…` | `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1` | Pre-HWM rollback ref |
| `v2026.07-baseline` | `18f7f25…` | `101308e4-0faf-4ecc-897d-6fd47753a012` | Superseded (F3 rollback ref) |

## Deployment registration standard (A6 / A7)

Every future production deploy MUST record Commit SHA + Release Tag + Worker Version
(procedure in `docs/ADR-DEPLOYMENT-PROVENANCE-STANDARD.md`) and append rows above.
No untagged production deploy is permitted.

## Audit answers

- **Production version's commit?** `18f7f25…` (tag `v2026.07-baseline`).
- **Production version's tag?** `v2026.07-baseline`.
- **Which deploy shipped F1?** Worker Version `101308e4…`, 2026-07-16 13:25:50 UTC, from `18f7f25…`.
- **Which deploy will ship F3?** A future tag (e.g. `v2026.07-f3-logout`) at the F3 commit → recorded as a new row when deployed.
- **Which commit introduced a fix?** Resolve via `git log --oneline -- <path>` / `git show <sha>` on the fix commit; the F1 fix is contained in baseline `18f7f25…` (its immediate predecessor is pre-VCS, so F1 is anchored at the baseline).
- **How to roll back?** `wrangler rollback 338018fc-7c51-4740-80e4-fc0388357441` (prior production version; code-only, no D1 migration). Future rollbacks target the predecessor row in the A4 table.

## Provenance caveat

F1 (`101308e4…`) was deployed minutes before Git existed; the baseline commit was then
taken from that same working tree with no intervening `src` change, so the mapping is
exact for Worker source. All deploys **after** the baseline will be commit-anchored at
deploy time per ADR-4 — no retroactive mapping needed.

## Boundaries honored

No production redeploy was performed by this Mission; no D1/KV/R2 data, no UCS state,
no business logic changed. Read-only `wrangler deployments list` / `whoami` only.
