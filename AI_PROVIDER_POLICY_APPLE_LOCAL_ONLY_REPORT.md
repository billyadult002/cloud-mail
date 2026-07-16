# AI Provider Policy Apple Local Only Report

Date: 2026-07-05

Implemented policy:
- Email Detail Summarize, Translate, AI Briefing, Draft Reply, and Ask AI now gate on `localAIAllowed && localAIReady`.
- Email Detail action descriptors now set `requiresNetwork=false` and `requiresCloudAI=false` for Summarize, Translate, and Draft Reply.
- Email Detail strict paths call `triageLocalStrict`, `aiCompleteLocalStrict`, and `draftReplyLocalStrict`.
- Email Detail no longer calls generic provider completion, draft, triage, or safe-provider routes.
- No silent fallback to Gemini, ChatGPT, Claude, Grok, or Copilot was added.

Preserved:
- Gemini remains visible and usable in AI Center when its safe test/authorization state passes.
- ChatGPT Local Broker remains visible in AI Center as an optional local broker provider.
