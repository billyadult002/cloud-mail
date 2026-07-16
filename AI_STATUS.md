# AI Status

## Enterprise Productivity Platform V1 Boundary

Date: 2026-07-07

- Enterprise Hub does not enable new external AI providers.
- NLP Search V2 is local-first over loaded CloudMail metadata.
- Existing Apple Intelligence local AI behavior is preserved.
- Gemini status preservation guard: PASS.
- ChatGPT local broker smoke-gated guard: PASS.

---

## Real Use Next Group Email Detail And Safe Mail Actions

Date: 2026-07-06

- Email Detail Draft Reply with AI runs Apple Intelligence locally and displays a result surface.
- Email Detail Ask AI runs Apple Intelligence locally and displays a result surface.
- Reply/Forward use real-device reliable Compose launch paths with original email context.
- Safe Mail Actions are action-first Apple Intelligence local workflows.
- Gemini, ChatGPT, OAuth, and broker execution are not used for this flow.
- Real iPhone manual validation: PASS.
- Cloud provider validation: NOT CLAIMED.

---

## Gemini OAuth Card Eligibility Update

Date: 2026-07-06

- Gemini card no longer displays a hard-coded Gmail test-user address.
- Gemini card displays OAuth Eligible, Google Sync, and Reason.
- P27 Google OAuth tester lifecycle semantics are preserved.
- Current real iPhone validation: PASS through iPhone Mirroring.
- Gemini OAuth live smoke success: NOT CLAIMED.
- Google tester sync success: NOT FABRICATED.
- ChatGPT/OpenAI remains unavailable/not verified/not connected.

---

## Email Detail AI Briefing State Machine

Date: 2026-07-06

- Email Detail AI Briefing/Summarize is Apple-local by default.
- Auto-start, Generate, Refresh, and AI Actions -> Summarize now share one result state.
- Visible states include running, success, failure, timeout, cancelled, unavailable, retry, cancel, refresh, and slow-warning.
- Empty Apple Intelligence summaries are treated as failures with a visible retry message.
- Gemini and ChatGPT Local Broker remain preserved for AI Center optional/status paths.
- Manual real-device Email Detail AI tap-through is not claimed in this loop.

---

## Apple Local Default Update

Date: 2026-07-05

- Default Email Detail AI provider: Apple Intelligence.
- Cloud provider default routing from Email Detail: disabled.
- Gemini status: preserved for AI Center optional cloud provider use.
- ChatGPT Local Broker status: preserved for AI Center optional broker use.
- Apple Intelligence availability UI: shows inline unavailable/disabled reason instead of falling back silently.
- Email Detail action timeout: 20 seconds.
- Manual real-device AI tap-through: not performed due signing/install blocker.

---

Date: 2026-07-05

## Current Behavior

- Default visible AI actions use Apple Intelligence/local fallback.
- AI Summary, Translate, Draft Reply, AI Center chat, and AI Workspace actions have timeout protection to avoid indefinite spinners.
- Cloud provider processing is used only when the user explicitly enables/selects it in AI Center.

## Providers

- Gemini: usable status preserved and smoke-gated.
- Allow Cloud AI processing: ON status preserved where previously enabled.
- ChatGPT: Local Broker Available status preserved.
- ChatGPT is not Cloud OAuth in CloudMail.
- ChatGPT is not browser-session runtime.
- Claude, Grok, and Copilot are not runnable unless future official runtime evidence exists.

## Safety Boundary

CloudMail must not read browser sessions, cookies, OAuth codes, local token files, or refresh tokens.
