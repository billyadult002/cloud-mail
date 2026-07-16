# CloudMail Launch Stability Real-Use Regression Report

## Scope

Continued from `CLOUDMAIL_LAUNCH_STABILITY_AND_UI_HANDOVER.md`.

This run verified that the prior launch-stability fixes were still present and tested repeated real-device launches. It did not attempt production migration, deployment, or `verify.sh`.

## Checks

- Repository check passed for task `handover_resume_launch_stability_regression`.
- Focused guards passed:
  - `ios_launch_stability_guard.py`
  - `email_detail_summarize_body_separation_guard.py`
  - `email_detail_compact_action_bar_guard.py`
  - `email_detail_direct_compose_navigation_stability_guard.py`
  - `email_detail_reply_compose_context_guard.py`
  - `email_detail_forward_compose_context_guard.py`
  - `reply_send_context_guard.py`
  - `forward_send_context_guard.py`
- Xcode beta was used explicitly:
  - Xcode 27.0, build `27A5194q`
  - `GlassMail` Debug simulator build succeeded.

## Real iPhone Result

- Device: `Bill's iPhone 17`
- UDID: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`
- Bundle id: `app.wangbei8554.pingguo736`
- Completed 5 forced terminate/relaunch rounds.
- CloudMail remained alive after each launch.
- Final observed process id: `2112`

## Visual Observation

iPhone Mirroring initially showed CloudMail in Inbox after launch:

- Inbox was visible, not white/blank.
- Bottom row showed `Pull or tap to load more`.
- No automatic bottom pagination was observed during the visible window.

Mirroring disconnected while attempting deeper page-flow regression and remained in a reconnecting state during the first pass. A follow-up session resumed after Mirroring became available again.

Follow-up Mirroring observations:

- Home Screen -> CloudMail launch worked.
- Inbox rendered without white/blank screen.
- Email Detail rendered without white/blank screen.
- AI Briefing/body separation was visible on Email Detail.
- Attachment controls were visible on Email Detail.
- Compact bottom action bar was visible on Email Detail.
- AI Center rendered.
- Compose tab rendered and returning to Inbox did not freeze the app.
- Accounts rendered.
- Settings rendered.
- DEBUG `-CloudMailOpenSubject` successfully opened the target Email Detail.

Limitations:

- The compact Reply icon did not visibly transition to Compose when tapped through Mirroring in this session.
- DEBUG Reply auto-action also did not visibly transition, despite the open-subject DEBUG path working.
- Therefore Reply/Forward direct-compose behavior remains covered by guards/static checks from this run, but not claimed as manually passed through Mirroring.

## Conclusion

The repeated launch crash symptom did not reproduce in this controlled 5-launch real-device run. The visible startup screen and main surfaces matched the intended post-fix behavior. A later direct-device/manual touch pass should specifically re-check compact Reply/Forward icon activation if needed.
