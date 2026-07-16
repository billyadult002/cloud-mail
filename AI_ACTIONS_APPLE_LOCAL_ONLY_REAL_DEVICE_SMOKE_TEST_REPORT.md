# AI Actions Apple Local Only Real Device Smoke Test Report

Date: 2026-07-05

Status: `REAL_DEVICE_SMOKE_INSTALL_LAUNCH_PROCESS_PASS_OFFICIAL_OWNER_SIGNED_IPA_STILL_BLOCKED`

Toolchain:
- Xcode beta: `/Applications/Xcode-beta.app/Contents/Developer`
- Xcode version: 27.0 beta, build 27A5194q

Device:
- `Bill’s iPhone 17`
- Identifier: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`
- Model: iPhone 17 Pro Max
- State: connected

Signing boundary:
- Official bundle id `com.fastonegroup.glassmail` is still blocked for this personal team because the target has iCloud capability.
- Xcode reported: personal development teams do not support the iCloud capability.
- For smoke testing only, built and installed with:
  - Temporary bundle id: `com.fastonegroup.glassmail.devicetest`
  - Temporary entitlements file: `GlassMailDeviceSmoke.entitlements`
  - iCloud capability removed for this smoke build only

Results:
- Real-device smoke build: PASS.
- Real-device install: PASS.
- Real-device launch: PASS.
- Process presence: PASS.
- Screenshot evidence: `artifacts/ai-actions-apple-local-only-stabilization/real-device-smoke-launch.png`

Observed screen:
- CloudMail launched to the login screen on the real iPhone.
- No blank screen or immediate crash observed.

Not claimed:
- Official owner-signed IPA install for `com.fastonegroup.glassmail`.
- Manual Email Detail AI tap-through.
- Summarize/Translate/AI Briefing real mailbox result.
- Endurance, thermal, battery, or memory evidence.
