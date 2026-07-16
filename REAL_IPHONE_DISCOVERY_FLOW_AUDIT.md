# GPT67A — Real iPhone Discovery Flow Audit

## 设备与构建

- Device: Bill's iPhone 17（USB 连接）
- Bundle: `app.wangbei8554.pingguo736`
- IPA: `artifacts/nexora-v2.5/CloudMail-NEXORA-v2.5-owner-signed.ipa`
- Version: 2.5

## 已验证

- 真机启动成功。
- Mailbox header 唯一入口可点击；Mailbox drawer 打开测试通过：`artifacts/gpt65-6y-mailbox-drawer-final.xcresult`。
- 主界面不再因重复 accessibility target 阻塞 mailbox drawer。

## 未完成/阻塞

尚未在真实 authenticated session 中完成 `bill@hengmao.org` 的完整输入、domain authority 配置、bootstrap、password activation 和收件验证。当前 `hengmao.org` 的 DMARC 记录缺失，Wrangler OAuth 只有 zone:read，不能安全地自动写 DNS；因此不能把真实 iPhone discovery flow 标记为 PASS。下一次验证应在域名 owner 完成 authority 配置后执行，并记录每个状态转移与服务端 request id。

