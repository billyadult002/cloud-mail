# AI Spinner Timeout Root Cause Report

Date: 2026-07-05

## Root Cause

AI Summary, Translate, AI Center chat, and several AI buttons could appear stuck because local Apple Intelligence calls did not have an app-level timeout. If Foundation Models was busy, downloading, unavailable, or slow to respond, UI state waited for the model response before clearing the spinner.

AI Center also showed only the oldest chat message, so completed responses could be hidden from the user. Safe Mail Actions attempted the selected provider route before the local Apple path, which conflicted with the temporary operating rule that AI actions should default to Apple Intelligence unless the user explicitly chooses a provider path in AI Center.

## Fix

- Added a 5-second local AI timeout in AppState.
- Wrapped local triage, draft reply, and completion calls with the timeout.
- Returned local fallback results instead of leaving UI in a loading state.
- Email Detail AI Summary keeps auto-expanding and now receives a bounded local result path.
- Translate uses Apple local completion and now shows a visible fallback result if Apple translation does not finish.
- AI Center chat now has a running state and displays the latest messages.
- AI Center Safe Mail Actions now default to Apple local unless the user explicitly changes provider selection and Cloud AI is enabled.
- AI Workspace multi-message actions now limit Apple model calls per action to avoid serial long waits.

## Boundary

If Apple Intelligence itself cannot translate or summarize, CloudMail cannot synthesize a true model output without a model. The app now ends the spinner, shows a safe fallback/result, and keeps buttons usable.

