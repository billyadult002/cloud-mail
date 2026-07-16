# P30 Source Of Truth Lock

Date: 2026-07-06

## Source Of Truth

- Repository: `/Users/billtin/Documents/cloudmail`.
- Repository check: PASS.
- `git_root`: `N/A`.
- Branch: `N/A`.

## Installed Build Identity

- Device: real iPhone `70CD0BB3-0832-5A94-BA91-82A634A54CF8`.
- Bundle id: `app.wangbei8554.pingguo736`.
- Version: `1.0`.
- Build: `1`.
- App bundle: `/Users/billtin/Library/Developer/Xcode/DerivedData/GlassMail-gaazacfeppndkhbkhtzlslltnkrb/Build/Products/Debug-iphoneos/CloudMail.app`.
- App bundle timestamp: `2026-07-06 16:25:49`.
- Key source timestamps before app bundle:
  - `InboxView.swift`: `2026-07-06 16:25:30`.
  - `AppState.swift`: `2026-07-06 16:19:41`.
  - `Models.swift`: `2026-07-06 16:17:17`.
  - `ComposeView.swift`: `2026-07-06 16:17:17`.
  - `EmailDetailView.swift`: `2026-07-06 15:19:11`.

## Lock Statement

The P30 real-device acceptance evidence was collected from the latest repaired build available in the local source-of-truth workspace and installed on the real iPhone.

## Non-Execution Boundaries

- No production deploy.
- No production migration.
- No `verify.sh`.
- No Production Closure reopen.
- No status-file mutation of `IPA_READY`, `PASS_PRODUCTION_READY`, or `STATUS=CLOSED`.
