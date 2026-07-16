# GPT67 P0 Regression Closure

## Closed

- 删除 onboarding email ownership gate。
- Exact mailbox lookup 不再是 onboarding primary path。
- Cloudflare 与 mailbox provider 分离。
- Discovery state、authority state、provisioning decision 和 next action 已进入 V3 onboarding contract。
- 新增跨 profile email 回归测试，证明 `admin@hengmao.org` 可以先 discovery。

## Verification

Worker syntax check、reliability suite 和 dependency audit 应在部署前执行；真机完整 provider authorization 仍依赖外部 domain owner/provider scope。

## Remaining blocker

真实 iPhone 对指定域名的最终 PASS 需要 authenticated session、provider callback 和可验证 authority。缺少这些外部证据时系统必须保持 truthful blocked state。

