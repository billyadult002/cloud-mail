# Gmail OAuth 403 Governance Future-Time Validation Report

Date: 2026-07-07

## Production Evidence

- Google test-user governance rows exist for:
  - `billyadult008@gmail.com`: `google_synced`
  - `billyadult01@gmail.com`: `google_synced`
  - `zhaotianwy@gmail.com`: `google_synced`
- Google Console test-user list was updated in project `clawfeed-490710`.
- Production Worker deployment containing the fix: `a3388226-868d-409b-954a-d167ba638f10`.
- Future Gmail rows query returned `0` for provider rows newer than Worker time plus two minutes.

## Current Account Reality

- `billyadult008@gmail.com` remains `needs_reconnect` with `legacy_imap_unsupported`; this is correct until the real iPhone OAuth reconnect succeeds.
- `saercpku@gmail.com` has OAuth-backed `mailbox_ready` rows and no future-time rows at validation time.
- `billyadult01@gmail.com` and `zhaotianwy@gmail.com` are now eligible for Google OAuth but are not claimed connected until the real iPhone add-account flow completes.

## Verification

- Mandatory repository precheck: PASS.
- Gmail realtime/reconnect/lifecycle/freshness/ordering guard: PASS.
- Mailbox lifecycle truth guard: PASS.
- Provider truth receive reality guard: PASS.
- Worker unit/check suite: PASS.
- iOS generic-device Release build with Xcode beta: PASS.
- Owner-signed IPA install to USB iPhone: PASS.
- Real iPhone launch command: PASS.

## Real iPhone Flow Status

The app was installed and launched on the USB iPhone. Mac-side iPhone Mirroring reported `iPhone in Use` and would not expose the screen for automated clicking. Therefore the true user-flow additions for `billyadult01@gmail.com` and `zhaotianwy@gmail.com` are intentionally not marked complete in this report.
