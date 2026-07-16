# Email Detail AI Briefing State Machine Discovery Report

Date: 2026-07-06

## Discovery

Email Detail had multiple state surfaces involved in AI Briefing rendering: local AI action phase, triage cache, auto-run key, and triaging/loading flags. A successful Apple-local summary could be cached while the visible card and spinner were not controlled by one authoritative state machine.

## Impact

- The card could show readiness but not show the generated result.
- Generate/Summarize could rerun inconsistently.
- The bottom AI action area could remain in a running-looking state after the briefing path finished or failed.

## Files Reviewed

- `files/GlassMail-project/GlassMail/Views/EmailDetailView.swift`
- `files/GlassMail-project/GlassMail/Services/AppState.swift`

