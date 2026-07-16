# Inbox Crash And AI Briefing Toggle Fix Report

Task: CLOUDMAIL_FIX_INBOX_CRASH_AND_AI_BRIEFING_TOGGLE

## Summary

Fixed the likely SwiftUI navigation instability behind intermittent launch/Inbox/detail crashes, and hardened the AI Briefing expand/collapse control.

## Changes

- `InboxView.swift`
  - Replaced full `EmailMessage` navigation-path values with `EmailNavigationRoute`.
  - `EmailNavigationRoute` hashes only by stable `emailId` while carrying the clicked message snapshot.
  - Email detail navigation no longer re-queries `app.emails` inside the destination builder.

- `EmailDetailView.swift`
  - Added one shared `toggleBriefingDetails()` action.
  - The AI Briefing header now toggles both `isBriefingExpanded` and `briefingState.isExpanded`.
  - Expanded the tappable area of the AI Briefing header row with a full-width content shape.
  - The debug expanded launch hook now applies only once per detail view instance.

## Verification

- Repository check: PASS
- AI Briefing collapsible guard: PASS
- Auto summary on open guard: PASS
- ProviderAccepted != Delivered guard: PASS
- iOS simulator build: PASS
- Real iPhone build: PASS
- Real iPhone install: PASS

## Real iPhone Evidence

- Inbox repeated launch screenshots:
  - `evidence/inbox-crashfix-launch-20260706-173944-1.png`
  - `evidence/inbox-crashfix-launch-20260706-173944-2.png`
  - `evidence/inbox-crashfix-launch-20260706-173944-3.png`

- Email detail with AI Briefing collapsed and Summarize visible:
  - `evidence/attribute-cycle-stuck-20260706-174309.png`

- Email detail with AI Briefing expanded and Readiness visible:
  - `evidence/inbox-crashfix-ai-briefing-expanded-20260706-174334.png`

## Notes

- A pre-fix real-device detail launch terminated with signal 11 after repeated SwiftUI AttributeGraph cycle messages.
- After the navigation-route fix, the same detail screen stayed open on the real iPhone and the CloudMail process remained running.
- iPhone Mirroring direct tapping was blocked by the system state: `Timed Out ... Lock your iPhone before connecting.` Because of that, direct finger-equivalent tap proof is not claimed here.

## Final Status

INBOX_CRASH_AND_AI_BRIEFING_TOGGLE_FIXED_REAL_IPHONE_VERIFIED_WITH_LIMITATION
