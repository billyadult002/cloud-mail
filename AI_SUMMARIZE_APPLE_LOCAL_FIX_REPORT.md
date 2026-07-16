# AI Summarize Apple Local Fix Report

Date: 2026-07-05

Fix:
- Summarize now routes through strict Apple Intelligence local triage in Email Detail.
- Success expands AI Briefing and shows the summary card.
- Failure/timeout shows inline retryable state.
- Duplicate taps are disabled while an action is running.

Evidence:
- `apple_local_summarize_result_guard.py`: PASS.
- iOS simulator build: PASS.
- iOS generic-device unsigned build: PASS.

Manual tap-through:
- Not performed; fresh real-device install was blocked by signing/provisioning.
