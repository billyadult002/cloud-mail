# AI Briefing Apple Local Auto Summary Report

Date: 2026-07-05

Fix:
- Email Detail open refreshes provider readiness and auto-starts AI Briefing after message/security setup.
- Auto summary uses Apple Intelligence only.
- AI Briefing expands while running and after success.
- Cache key includes message id, body hash, provider `apple_intelligence`, language `auto`, and summary version.
- Redraw reruns are blocked by `briefingAutoRunKey`.
- Timeout/failure surfaces are retryable.

Evidence:
- `ai_briefing_auto_summary_guard.py`: PASS.
- iOS simulator build: PASS.
- iOS generic-device unsigned build: PASS.
