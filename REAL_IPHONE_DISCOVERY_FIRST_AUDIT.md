# GPT67 — Real iPhone Discovery-First Audit

- Device: Bill's iPhone 17
- Bundle: `app.wangbei8554.pingguo736`
- IPA: `artifacts/nexora-v2.5/CloudMail-NEXORA-v2.5-owner-signed.ipa`

已验证真机启动与 mailbox drawer。当前尚未在 authenticated session 中输入并完成 `admin@fastonegroup.com`、`admin@hengmao.org` 的 provider callback、authority grant 和 provisioning，因此完整 discovery-first 真机验证仍为 `BLOCKED`，不是 PASS。

最新运行时证据：iPhone Mirroring 返回 “Lock your iPhone to connect”；当前 USB 镜像无法操作设备。DNS 复核显示 `fastonegroup.com` 已有 DMARC `p=none`，但 `hengmao.org` 的 `_dmarc` 仍为空；该域名仍缺少可验证的完整 authority 前置条件。

后续复核已完成：`hengmao.org` 的 Email Routing DNS 已解锁，权威 DNS 返回 `_dmarc.hengmao.org TXT v=DMARC1; p=none`；生产 discovery API 返回 `domainManaged=true`、`discoveryState=MAILBOX_ACTIVATABLE`、`authorityState=AUTHORITY_FOUND`、`nextAction=activate_from_catch_all`。剩余阻塞仅为真机镜像仍处于 `Timed Out / Lock your iPhone`，以及需要已登录 CloudMail session 执行 bootstrap/password activation。

本轮真机复验：已安装并启动 IPA 2.5（bundle `app.wangbei8554.pingguo736`），在 Accounts → Add mailbox 中输入 `bill@hengmao.org`，界面显示 `Continue with discovery`；提交后得到真实错误 `Authentication has expired. Please sign in again`。因此 discovery-first UI 通过，provider/domain authority 通过，最终 provisioning 仍等待 CloudMail 主账号重新登录。
