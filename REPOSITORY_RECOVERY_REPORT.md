# CloudMail Repository Recovery Report

Mission: CLOUDMAIL SOURCE-OF-TRUTH REPOSITORY AND DEPLOYMENT PROVENANCE RESTORATION
Date: 2026-07-16
Priority: CRITICAL

## Summary

Version control has been established for the previously un-versioned CloudMail
working tree. A genesis baseline commit and release tag now anchor the authoritative
source, and full Git operations (`status/log/show/diff/blame`) are available.

## Evidence

### E1 — No prior Git history
`git rev-parse --show-toplevel` → `fatal: not a git repository`; `find -name .git`
(dir/parent/nested) → empty. History was unrecoverable; baseline started fresh.

### E5 — Working tree scope
- Total tree: ~40 GB (dominated by `artifacts/` 37 GB, `build/` 1.1 GB, `archive/` 747 MB,
  `evidence/` 363 MB — all derived/evidence, excluded).
- Baseline committed: **1377 files, ~28 MB** (source, config, migrations, docs, reports).

### E6 — Git initialization
- `git init -b main` → initialized `.git`.
- Identity: `billtin <billtin@users.noreply.local>` (repo-local).
- `.gitignore` hardened (secrets + derived artifacts). Prior 19-line ignore replaced.

### Secret guard (pre-commit)
Staged-file scan for `profile/ | *.p12 | *.mobileprovision | 密码 | .env* | *.pem | *.key |
credentials | service-account` → **CLEAN (0 matches)**. `git check-ignore` confirms
`profile/证书文件.p12` and `platform/cloud-mail/mail-vue/.env.release` are ignored.

## Baseline

| Item | Value |
|------|-------|
| Branch | `main` |
| Baseline commit | `18f7f25b64df81c3aa61248fd711760972de0539` |
| Release tag | `v2026.07-baseline` (annotated; tag object `23a34e3…`) |
| Files / size | 1377 / ~28 MB |
| Contains F1 fix | Yes — `public-service.js` staged blob includes `.bind(email, hash, …)` |
| Contains F1 test | Yes — `platform/cloud-mail/mail-worker/scripts/reliability-tests/public-add-user-parameterization.test.mjs` |

## Verification

| ID | Check | Result |
|----|-------|--------|
| V1 | `git status` works | ✅ (`## main`) |
| V2 | `git log` returns baseline | ✅ `18f7f25 chore: genesis baseline…` |
| V3 | Tag resolves | ✅ `git rev-parse v2026.07-baseline`; `git describe` → `v2026.07-baseline` |
| V4 | New change → trackable commit | ✅ (this report + ADRs committed as a follow-up) |
| A8 | `git diff/log/show/blame` available | ✅ |

## Boundaries honored

No database/user data, no UCS checkpoint/cursor/outbox/projection, no business logic
changed. Live UCS edits to `implementation_plan.md` / UCS ADR left uncommitted.
