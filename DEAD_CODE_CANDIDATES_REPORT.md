
# Dead Code Candidates Report

Generated: 2026-07-05 22:11:24

## Conservative Rule

No source code is safe to delete solely because a grep/reference scan is inconclusive. OAuth, token, Worker routing, account capability, migrations, ChatGPT broker, Gemini, P28, and P29A code is RISKY unless proven otherwise.

|path|risk|recommendation|reason|
|---|---|---|---|
|files/GlassMail-project/GlassMail/Views/EmailDetailAIWorkspaceView.swift|CAREFUL|DO_NOT_TOUCH|Possible legacy/adapter code but active architecture may still reference it.|
|files/GlassMail-project/GlassMail/Views/EmailDetailAICopilotView.swift|CAREFUL|DO_NOT_TOUCH|Possible legacy/adapter code but active architecture may still reference it.|
|files/GlassMail-project/GlassMail/AI/OpenAIProvider.swift|RISKY|DO_NOT_TOUCH|Possible legacy/adapter code but active architecture may still reference it.|
|files/GlassMail-project/GlassMail/AI/AnthropicProvider.swift|RISKY|DO_NOT_TOUCH|Possible legacy/adapter code but active architecture may still reference it.|

## Recommendation

Run compiler-driven and runtime-driven reachability checks in a separate code cleanup loop. No code deletion is recommended in this repo slimming dry-run.
