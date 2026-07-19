# CI Secret Inventory

This document inventory lists all secrets used or referenced in the CloudMail and cloud-mail CI/CD workflows, build pipelines, and deployment scripts. Legacy technical identifiers remain unchanged for compatibility.

| Secret Name | 用途 | 引用位置 | 是否必需 | 是否已有 fallback | 是否阻断 IPA | 是否阻断 DMG | 是否阻断 Worker Deploy | 是否阻断 Pages Deploy | 是否阻断 SES | 是否阻断 TestFlight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Authentication | `deploy-cloudflare.yml` | 是 | 否 | 否 | 否 | **是** | **是** | 否 | 否 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account Identification | `deploy-cloudflare.yml` | 是 | 否 | 否 | 否 | **是** | **是** | 否 | 否 |
| `JWT_SECRET` | Token signing secret for Hono backend | `deploy-cloudflare.yml`, `wrangler.toml` | 是 | **是** (App自动随机生成) | 否 | 否 | 否 | 否 | 否 | 否 |
| `DOMAIN` | Domain names list for Worker | `deploy-cloudflare.yml`, `wrangler.toml` | 是 | **是** (默认 `["fastonegroup.com"]`) | 否 | 否 | 否 | 否 | 否 | 否 |
| `ADMIN` | Administrator email address | `deploy-cloudflare.yml`, `wrangler.toml` | 是 | **是** (默认 `admin@fastonegroup.com`) | 否 | 否 | 否 | 否 | 否 | 否 |
| `D1_DATABASE_ID` | Existing D1 Database ID | `deploy-cloudflare.yml`, `wrangler.toml` | 否 | **是** (未指定时 wrangler 自动创建) | 否 | 否 | 否 | 否 | 否 | 否 |
| `KV_NAMESPACE_ID` | Existing KV Namespace ID | `deploy-cloudflare.yml`, `wrangler.toml` | 否 | **是** (未指定时 wrangler 自动创建) | 否 | 否 | 否 | 否 | 否 | 否 |
| `R2_BUCKET_NAME` | R2 bucket name for attachments | `deploy-cloudflare.yml`, `wrangler.toml` | 否 | **是** (默认 `cloud-mail-r2`) | 否 | 否 | 否 | 否 | 否 | 否 |
| `AWS_ACCESS_KEY_ID` | AWS Credentials for SES email sending | Lambda, Terraform config | 否 | **是** (未配置进入 Mock Mode) | 否 | 否 | 否 | 否 | **是** | 否 |
| `AWS_SECRET_ACCESS_KEY` | AWS Credentials for SES email sending | Lambda, Terraform config | 否 | **是** (未配置进入 Mock Mode) | 否 | 否 | 否 | 否 | **是** | 否 |
| `SES_PROXY_URL` | AWS SES Proxy Gateway Endpoint | `email-service.js` | 否 | **是** (未配置进入 Mock Mode, 打印重置链接) | 否 | 否 | 否 | 否 | **是** | 否 |
| `APP_STORE_CONNECT_API_KEY` | Apple App Store Connect API Key | `build-ios-macos.yml` | 否 | **是** (未配置使用本地签名/开发构建) | 否 | 否 | 否 | 否 | 否 | **是** |
| `P12 Certificate` | iOS/macOS code signing certificate | `BUILD.md`, `build-ios-macos.yml` | 否 | **是** (未配置使用 Ad-hoc/Mock/无签名) | **是** (阻断Release包) | 否 | 否 | 否 | 否 | **是** |
| `MobileProvision` | Provisioning profile for iOS | `BUILD.md`, `build-ios-macos.yml` | 否 | **是** (未配置使用 Xcode 自动签名/开发构建) | **是** (阻断Release包) | 否 | 否 | 否 | 否 | **是** |
