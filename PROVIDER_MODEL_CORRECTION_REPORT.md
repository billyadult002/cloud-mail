# GPT67 — Provider Model Correction

Cloudflare 现在被建模为 `infrastructure_provider`，不是 mailbox provider。

示例：

- `mailbox_provider=custom_domain`, `infrastructure_provider=cloudflare`
- `mailbox_provider=google_workspace`, `infrastructure_provider=cloudflare`
- `mailbox_provider=microsoft_365`, `infrastructure_provider=cloudflare`

Provider capability/authority 仍可针对 infrastructure provider 计算 scope，但 mailbox lifecycle 不再把 Cloudflare 当成邮箱服务商。

