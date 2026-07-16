# GPT67 — Legacy V2 Onboarding Audit

## Findings

1. `platform/cloud-mail/mail-worker/src/service/nexora-v3-service.js` 的 `beginOnboarding()` 曾查询 `account` 并拒绝不属于当前 profile 的邮箱，错误信息为 “The email must already belong ...”。该 ownership gate 已删除。
2. `cloudmail-v2-service.js` 仍保留 exact account lookup，但它位于 routing/domain discovery 之后，仅用于 active/pending identity signal，不再是主入口。
3. `CloudMailV2Views.swift` 的 unknown/custom domain 默认进入 discovery；未发现地址不再成为终止条件。
4. Cloudflare 旧模型混淆 mailbox provider 与 infrastructure provider，已通过独立字段修正。

## Allowed gates

仅允许在 discovery 之后基于 authority、security、provider scope 和 provisioning evidence 阻塞。禁止以 mailbox not found、ownership missing 或 credential missing 作为 discovery 前置阻断。

