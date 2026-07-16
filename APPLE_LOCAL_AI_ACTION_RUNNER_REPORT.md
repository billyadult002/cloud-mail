# Apple Local AI Action Runner Report

Date: 2026-07-05

Implemented strict local runner paths:
- `summarize_email`: `AppState.triageLocalStrict`.
- `translate_email`: `AppState.aiCompleteLocalStrict`.
- `ai_briefing_summary`: `AppState.triageLocalStrict` with auto-run guard key.
- `draft_reply`: `AppState.draftReplyLocalStrict`.
- `ask_email`: `AppState.aiCompleteLocalStrict`.

Runner behavior:
- Uses Apple Intelligence only.
- Uses a 20-second timeout.
- Supports cancel through `currentAIActionTask?.cancel()`.
- Supports retry through `retryAIAction`.
- Clears task state on success/failure/timeout.
- Writes SwiftUI state on `MainActor`.
- Avoids repeated AI Briefing execution on redraw through `briefingAutoRunKey`.
