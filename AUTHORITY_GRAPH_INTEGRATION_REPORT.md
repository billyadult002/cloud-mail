# GPT67 — Authority Graph Integration

Onboarding plan 继续消费 `authorityMaximization()`，并通过 `authority` 对象暴露 requested/granted/missing scopes。Domain、identity、organization graph 由 V3 graph contracts 提供；本次修复将 graph/authority 评估放在 mailbox ownership gate 之后，而不是之前。

未授予 scope 时的合法结果是 `AUTHORITY_REQUIRED` / `PROVIDER_SCOPE_MISSING`，不是 email not found。

