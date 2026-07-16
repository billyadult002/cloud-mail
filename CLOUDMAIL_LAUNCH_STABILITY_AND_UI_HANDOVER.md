# CloudMail Launch Stability And UI Handover

## Target

Fix CloudMail iPhone launch instability after real-device testing:

- App sometimes crashes 3-4 times after task completion before becoming stable.
- App sometimes shows a white/blank screen before Inbox appears.
- Preserve recent Email Detail UI fixes:
  - compact bottom actions
  - direct Reply/Forward compose
  - stable Cancel behavior
  - AI Briefing Summarize/body visual separation

## Progress

Completed:

- Removed iOS auto-pagination from Inbox bottom `loadMoreRow`.
  - Before: older mail loaded automatically when the bottom row appeared.
  - After: older mail loads only when user taps `Pull or tap to load more`.
- Reduced startup refresh races.
  - AppState now schedules a single delayed bootstrap task after cached UI restore.
  - Startup provider readiness refresh is no longer launched as a separate init-time race.
  - `refreshIfStale` avoids competing with startup bootstrap unless explicitly allowed.
- Added task cancellation cleanup in `AppState.deinit`.
- Preserved Email Detail recent fixes:
  - Reply/Forward open Compose directly.
  - Old `EmailComposeLaunchView` intermediate page removed.
  - Compose Cancel guarded against duplicate taps and dismisses before draft save.
  - Email Detail header/action area remains compact.
  - Summarize panel has visible light gray background and subtle border.

## Verification

Passed:

- Repository check:
  - `python3 scripts/repository_check.py cloudmail --task "CLOUDMAIL_POST_TEST_LAUNCH_CRASH_WHITE_SCREEN_ROOT_CAUSE_FIX"`
- Guards:
  - `scripts/guards/ios_launch_stability_guard.py`
  - `scripts/guards/email_detail_summarize_body_separation_guard.py`
  - `scripts/guards/email_detail_compact_action_bar_guard.py`
  - `scripts/guards/email_detail_direct_compose_navigation_stability_guard.py`
  - Reply/Forward compose context guards
- Real iPhone build and install with Xcode beta:
  - bundle id: `app.wangbei8554.pingguo736`
  - device UDID: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`
- Real iPhone launch stability:
  - 4 consecutive forced launches completed.
  - CloudMail process remained alive after each launch.
  - iPhone Mirroring showed Inbox visible and usable after launch.
  - Bottom row now displays `Pull or tap to load more` and no longer auto-fetches.

Observed note:

- USB screenshot capture returned black frames while iPhone Mirroring showed the real UI. This appears to be device screenshot/lock/privacy behavior, not an app white screen.

## Key Files

iOS:

- `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Services/AppState.swift`
- `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/InboxView.swift`
- `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/EmailDetailView.swift`
- `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/ComposeView.swift`

Guards:

- `/Users/billtin/Documents/cloudmail/scripts/guards/ios_launch_stability_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/email_detail_summarize_body_separation_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/email_detail_compact_action_bar_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/email_detail_direct_compose_navigation_stability_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/email_detail_reply_compose_context_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/email_detail_forward_compose_context_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/reply_send_context_guard.py`
- `/Users/billtin/Documents/cloudmail/scripts/guards/forward_send_context_guard.py`

Evidence:

- `/Users/billtin/Documents/cloudmail/evidence/launch-stability-after-fix-20260706-212445.png`
  - Captured black due device screenshot behavior; use iPhone Mirroring observation as visual source for this run.

## Todo

- Continue real-use regression with iPhone Mirroring available:
  - Launch from home screen manually several times after locking/unlocking.
  - Open Inbox, All Mail, Email Detail, Reply, Forward, Attachments.
  - Confirm no recurring white screen after cold start.
- Optional hardening:
  - Add lightweight in-app launch diagnostics label under debug builds showing startup phase/refresh count.
  - Add a user-visible tiny status line if cached inbox is shown while refresh happens in background.

## Constraints

- Always run repository check before work:
  - `python3 scripts/repository_check.py cloudmail --task "<task_name>"`
- Do not run:
  - `verify.sh`
  - production migration
  - production deployment unless explicitly requested
  - production closure reopen
- Do not modify:
  - `IPA_READY`
  - `PASS_PRODUCTION_READY`
  - `STATUS=CLOSED`
- iOS build uses Xcode beta.
- Do not claim:
  - Delivered
  - OAuth live smoke
  - Gemini usable
  - ChatGPT cloud usable
  - endurance / thermal / battery / memory evidence
  unless directly observed.
- Do not expose:
  - tokens
  - secrets
  - mailbox sensitive body content

## New Session Start Prompt

Continue from `CLOUDMAIL_LAUNCH_STABILITY_AND_UI_HANDOVER.md`. Launch instability root cause was addressed by removing auto pagination and serializing delayed bootstrap. Next work should verify longer real-iPhone manual launch/use cycles through iPhone Mirroring, not rework the already-fixed Reply/Forward or Summarize UI unless regression is observed.
