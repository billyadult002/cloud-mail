# Email Detail AI Briefing Generate Button Fix Report

Date: 2026-07-06

## Fix

The Email Detail Generate button now calls the authoritative briefing runner with `force: true`.

## Behavior

Generate cancels stale briefing work, starts a fresh Apple Intelligence summary request, shows a running state, and resolves into visible success, failure, timeout, cancellation, or unavailable UI.

## Verification

- `email_detail_ai_briefing_generate_button_guard.py`: PASS
- Xcode beta simulator build: PASS
- Xcode beta real-device smoke build/install/launch: PASS

