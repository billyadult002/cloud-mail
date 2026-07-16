# GPT67 — Custom Domain Discovery Report

已覆盖 discovery-first 输入模型：`admin@fastonegroup.com`、`admin@hengmao.org`、`support@domain.com`、`legal@domain.com`、`ceo@company.com`。

MX/provider 证据可识别 Google Workspace、Microsoft 365/Exchange、Fastmail、Zoho、Proton；无 adapter 的 provider 必须返回 `PROVIDER_UNSUPPORTED`，不能 fallback 到 CloudMail registry。Cloudflare 只作为 infrastructure evidence。

