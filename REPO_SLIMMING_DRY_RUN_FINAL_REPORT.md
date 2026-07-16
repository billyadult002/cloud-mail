
# Repo Slimming Dry Run Final Report

Generated: 2026-07-05 22:11:24

## Final Status

`CLOUDMAIL_REPO_SLIMMING_DRY_RUN_INVENTORY_COMPLETED`

## Summary

- Total repository size: **4.30 GB**
- File count: **57171**
- Estimated safe cleanup size: **1.12 GB**
- Estimated quarantine size: **3.12 GB**
- Estimated risky/no-delete size: **62.64 MB**
- Actual deletion occurred: **NO**
- RISKY deletion occurred: **NO**
- Production deploy/migration occurred: **NO**
- `verify.sh` executed: **NO**

## Largest Directories

|path|size|files|
|---|---|---|
|.|4.28 GB|57151|
|artifacts|2.88 GB|15621|
|platform|1.39 GB|41244|
|platform/cloud-mail|1.38 GB|41230|
|platform/cloud-mail/mail-worker|1.10 GB|13166|
|platform/cloud-mail/mail-worker/node_modules|1.09 GB|12758|
|artifacts/translate-local-fallback-real-device|517.41 MB|5481|
|artifacts/email-detail-action-dedup-translate-result|515.50 MB|5480|
|platform/cloud-mail/mail-worker/node_modules/@cloudflare|423.14 MB|686|
|platform/cloud-mail/mail-worker/node_modules/wrangler|409.82 MB|870|
|platform/cloud-mail/mail-worker/node_modules/wrangler/node_modules|392.40 MB|822|
|artifacts/translate-local-fallback-real-device/DerivedData-sim|307.96 MB|3071|
|artifacts/email-detail-action-dedup-translate-result/DerivedData-sim|306.49 MB|3071|
|platform/cloud-mail/mail-worker/node_modules/@cloudflare/vitest-pool-workers|304.59 MB|575|
|platform/cloud-mail/mail-worker/node_modules/@cloudflare/vitest-pool-workers/node_modules|304.22 MB|517|
|platform/cloud-mail/mail-vue|283.86 MB|28064|
|platform/cloud-mail/mail-vue/node_modules|278.42 MB|27847|
|artifacts/final-acceptance|246.19 MB|420|
|artifacts/full-button-action-audit-translate-flow|208.99 MB|2410|
|artifacts/translate-local-fallback-real-device/DerivedData-sim/Build|163.84 MB|493|

## Recommended Next Cleanup Sequence

1. Delete reviewed SAFE DerivedData/build cache directories only.
2. Re-run repository check and preservation guards.
3. Quarantine old artifacts and old IPAs into a dated archive folder.
4. Re-run guard suite and optional builds.
5. Review historical markdown reports and archive them with an index.
6. Only after a stable quarantine window, consider deletion of quarantined items.

## Must Keep

See `KEEP_LIST.md`.

## Safe To Delete Later

See `SAFE_DELETE_CANDIDATES.md` and `DELETION_PLAN_DRY_RUN.md`.

## Quarantine Later

See `QUARANTINE_CANDIDATES.md` and `QUARANTINE_PLAN_DRY_RUN.md`.

## Never Delete In Cleanup

See `RISKY_DO_NOT_DELETE.md`.

## Next Loop Recommendation

Run `CLOUDMAIL_REPO_SLIMMING_SAFE_CACHE_CLEANUP_ONLY` to remove only reviewed SAFE build cache / DerivedData candidates, then verify guards. Do not touch root Worker, active source, migrations, signing/provisioning, current reports, or latest real-device artifacts in that cleanup loop.
