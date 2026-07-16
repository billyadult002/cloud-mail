# GPT67A — Custom Domain Onboarding Report

## 支持策略

Cloudflare Email Routing、Google Workspace/Gmail、Microsoft 365/Exchange、Fastmail、Proton、Zoho 以及 custom IMAP/SMTP 均以 domain-first 识别。当前实现对已知能力返回 routing/authority 证据；没有安全 adapter 的 provider 必须显式返回 `PROVIDER_UNSUPPORTED`，不能冒充 CloudMail 地址注册表。

## UI 行为

自定义域名在 `ExistingMailboxProvider.init` 中默认进入 discovery。状态卡显示 Domain Status、Identity Status、Mailbox Status、Authority Status、Next Automatic Action。未知地址不再显示 exact-address not-found。

## 环境限制

本地/生产环境当前仅能证明 Cloudflare routing 及已有 OAuth/provider 路径；Microsoft/Fastmail/Proton/Zoho 的真正凭据交换仍需各自 adapter、secret 和端到端测试后才能宣称 fully supported。

