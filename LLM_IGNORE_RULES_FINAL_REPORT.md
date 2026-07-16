# LLM Ignore Rules Final Report

Date: 2026-07-05

## Reviewed

- `.gitignore`
- `.cursorignore`
- `.codexignore`
- Repository instruction/status files

## Updated

- `.gitignore`: added artifact DerivedData/Build/Logs patterns.
- `.cursorignore`: added artifact DerivedData/Build/Logs patterns.
- `.codexignore`: created to hide bulky generated caches and archives while keeping active source and current status docs visible.

## Noise Boundaries

Ignored:

- `archive/quarantine/`
- `archive/reports/`
- `artifacts/**/DerivedData*`
- `artifacts/**/Build/`
- `artifacts/**/Logs/`
- `build/`
- `DerivedData/`
- `node_modules/`
- `.wrangler/state/`
- `*.ipa`
- `*.xcarchive`
- `*.dSYM`

## Explicitly Not Ignored

- `CURRENT_STATUS.md`
- `REAL_IPHONE_STATUS.md`
- `AI_STATUS.md`
- `ACCOUNT_STATUS.md`
- `DEPLOYMENT_BOUNDARY.md`
- `REPO_CLEANUP_STATUS.md`
- Active source under `files/GlassMail-project/`
- Active Worker source under `platform/cloud-mail/mail-worker/src/`
- Migrations
- `scripts/`
- `scripts/guards/`
- Current final reports and production boundary reports

## Boundary

Latest IPA evidence is ignored for future bulk search noise but remains listed in `REAL_IPHONE_STATUS.md` and must not be deleted.

