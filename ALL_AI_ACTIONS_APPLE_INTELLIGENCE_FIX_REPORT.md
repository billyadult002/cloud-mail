# All AI Actions Apple Intelligence Fix Report

Date: 2026-07-05

## Implemented

- Email Detail AI Summary: local triage and auto-expand.
- Email Detail Ask AI: invokes local briefing generation.
- Email Detail Translate: remains local Apple Intelligence completion.
- Email Detail AI Draft: local Apple Intelligence draft reply.
- Compose AI Assist: local Apple Intelligence completion/draft path.
- AI Center chat: local Apple Intelligence completion.
- AI Center Safe Mail Actions: local fallback remains synthetic and local-safe.
- Inbox swipe AI: local triage.
- Legacy Email Detail AI Workspace summary: local triage.

## Guard

Added `scripts/guards/all_ai_actions_apple_local_guard.py`.

The guard verifies:

- Local triage exists.
- Local draft reply exists.
- Local completion exists.
- Visible views do not directly call generic provider triage, draft, or completion.
- Email Detail AI Summary routes through briefing action.
- Email Detail briefing auto-expands.

## Preservation

Gemini remains evidence-gated. ChatGPT Local Broker remains pairing/smoke-gated. Production deployment, migrations, `verify.sh`, readiness markers, and provider connectivity claims were not changed.

