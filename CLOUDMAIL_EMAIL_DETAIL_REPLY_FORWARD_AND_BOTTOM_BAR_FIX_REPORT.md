# CloudMail Email Detail Reply/Forward And Bottom Bar Fix Report

## Problem

Real iPhone Mirroring showed two regressions:

- Tapping Reply or Forward from Email Detail opened the work page, then quickly returned to Email Detail.
- The compact five-icon Email Detail action bar was too close to the main five-item CloudMail tab menu.

## Fix

- Replaced the Email Detail Reply/Forward boolean sheet state with stable item-based presentation:
  - `EmailDetailComposePresentation`
  - `.sheet(item: $composePresentation)`
- Removed the old close-then-reopen behavior:
  - no more `showCompose = false` followed by async reopen for Reply/Forward.
- Added fixed bottom separation below the compact Email Detail action bar:
  - `Color.clear.frame(height: 14)`

## Files Changed

- `files/GlassMail-project/GlassMail/Views/EmailDetailView.swift`
- `scripts/guards/email_detail_direct_compose_navigation_stability_guard.py`
- `scripts/guards/email_detail_reply_compose_context_guard.py`
- `scripts/guards/email_detail_forward_compose_context_guard.py`
- `scripts/guards/reply_send_context_guard.py`

## Verification

Passed:

- Repository check.
- Focused guards:
  - `email_detail_direct_compose_navigation_stability_guard.py`
  - `email_detail_compact_action_bar_guard.py`
  - `email_detail_reply_compose_context_guard.py`
  - `email_detail_forward_compose_context_guard.py`
  - `reply_send_context_guard.py`
  - `forward_send_context_guard.py`
  - `ios_launch_stability_guard.py`
- Xcode beta simulator Debug build.
- Xcode beta iPhoneOS unsigned Debug build.
- Manual codesign verification.
- Real iPhone install for bundle id `app.wangbei8554.pingguo736`.

## Real iPhone Mirroring Result

Device:

- UDID: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`
- Installed app path: `/private/var/containers/Bundle/Application/93AD8769-4442-4995-AA5E-E1DFE7DAE5D9/CloudMail.app/`

Observed:

- Inbox rendered normally.
- Email Detail rendered normally.
- Bottom compact action bar now has visible separation from the main CloudMail tab menu.
- Reply opened Compose and remained on the Reply page.
- Reply Cancel returned to Email Detail.
- Forward opened Compose and remained on the Forward page.
- Forward Cancel returned to Email Detail.
- CloudMail process remained alive after validation.

## Notes

- All iOS build and device commands used Xcode beta via `/Applications/Xcode-beta.app/Contents/Developer`.
- No production deployment or migration was run.
- `verify.sh` was not run.
