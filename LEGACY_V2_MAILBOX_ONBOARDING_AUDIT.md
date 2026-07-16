# GPT67A — Legacy V2 Mailbox Onboarding Audit

## Scope

审计对象为 `files/GlassMail-project/GlassMail/` 与 `platform/cloud-mail/mail-worker/src/`。目标是确认 Add Mailbox 不再以 CloudMail 地址注册表作为唯一入口。

## 已定位的 V2 痕迹

| 痕迹 | 位置 | 结论 |
|---|---|---|
| 精确 mailbox 查询 | `src/service/cloudmail-v2-service.js` 的 `accountService.selectByEmailIncludeDel` | 保留为 secondary signal，仅在 routing/domain discovery 之后执行；不再作为失败闸门。 |
| mailbox registry gate | 同一 `discover()` 旧的 `!domainManaged` 早退分支 | 已移除；未知 CloudMail 地址不再直接返回 not found。 |
| CloudMail-only provider 默认 | `GlassMail/Views/CloudMailV2Views.swift` 的 `ExistingMailboxProvider.init` | 自定义域名默认进入 CloudMail discovery，而不是被硬编码 provider 拦截。 |
| legacy not-found 文案 | `CloudMailV2Views.swift` | 已删除 “This exact CloudMail address was not found”；改为 domain/identity/mailbox/authority 状态。 |
| legacy activation endpoint | `POST /auth/bootstrap-from-routing` | 仍是 activation path，但只在 discovery 判定可激活后调用，不再承担 primary lookup。 |

## 当前主路径

`email → routing/domain discovery → authority → identity → mailbox state → activation (if eligible) → ready`。

精确账号查询仍用于识别 active/pending identity、避免重复创建和兼容旧数据；它不能单独把自定义域名判定为失败。

## 残余风险

真实域名没有 authority 时，系统必须停在 `AUTHORITY_REQUIRED`，不能伪造 activation success。后端 provider adapter 尚未为所有第三方厂商实现，未知厂商应返回 `PROVIDER_UNSUPPORTED`，而不是 fallback 到 CloudMail registry。

