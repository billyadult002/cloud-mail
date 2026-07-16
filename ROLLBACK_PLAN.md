
# Rollback Plan

Generated: 2026-07-05 22:11:24

## For Future Cleanup Loop

1. Use quarantine-first for CAREFUL candidates.
2. Preserve exact original relative path in quarantine manifest.
3. After cleanup, run repository check and preservation guards.
4. If a regression occurs, restore quarantined path from `archive/quarantine/<date>/<original-path>`.
5. Regenerate build caches and DerivedData by rebuilding; do not restore caches unless needed for evidence.

## This Loop

No cleanup was performed, so rollback is not required.

---

# Archive / Quarantine Rollback Update

Date: 2026-07-05

## Restore Archived Reports

Archived reports are mapped in `REPORT_INDEX.md` and `archive/index/REPORT_INDEX_2026-07-05.md`.

Restore a single report:

```bash
mv archive/reports/2026-07-05/<report-name>.md <report-name>.md
```

Restore all archived reports from this loop:

```bash
for file in archive/reports/2026-07-05/*.md; do mv "$file" .; done
```

## Restore Quarantined Artifacts

Quarantined artifact mappings are listed in `QUARANTINE_LOG.md`.

Restore a single quarantined artifact:

```bash
mv archive/quarantine/2026-07-05/<original-relative-path> <original-relative-path>
```

Example:

```bash
mv archive/quarantine/2026-07-05/artifacts/final-acceptance artifacts/final-acceptance
```

## Revert Ignore Changes

To revert this loop's ignore changes, remove the archive/cache/package entries added to `.gitignore` and `.cursorignore`:

```bash
python3 scripts/repository_check.py cloudmail --task "ROLLBACK_IGNORE_RULES_REVIEW"
```

Then edit `.gitignore` and `.cursorignore` so active source, scripts, guards, migrations, and current reports remain visible to agents.

## Verify After Rollback

Run:

```bash
python3 scripts/repository_check.py cloudmail --task "ARCHIVE_QUARANTINE_ROLLBACK_VERIFY"
python3 scripts/guards/p28_reliability_closure_regression.py
python3 scripts/guards/p29a_information_density_regression.py
python3 scripts/guards/gemini_status_preservation_guard.py
python3 scripts/guards/chatgpt_local_broker_status_guard.py
python3 scripts/guards/email_detail_translate_result_guard.py
python3 scripts/guards/restored_account_fix_preservation_guard.py
python3 scripts/guards/all_ai_actions_apple_local_guard.py
python3 scripts/guards/ai_secret_safety_guard.py
```

Do not run `verify.sh`, production deploy, or production migration as part of this rollback.
