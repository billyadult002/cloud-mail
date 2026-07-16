# LLM Ignore Rules Update Report

Date: 2026-07-05

## Updated

- Added `.gitignore`.
- Updated `.cursorignore`.
- `.codexignore` was not present, so no `.codexignore` update was performed.

## Added Ignore Coverage

- `DerivedData/`
- `build/`
- `*.xcarchive`
- `*.dSYM`
- `node_modules/`
- `.wrangler/state/`
- `archive/quarantine/`
- `archive/reports/`
- `artifacts/old/`
- `*.ipa`

## Boundary

The update does not ignore root status docs, active source, scripts, guard scripts, migrations, or current final reports.

