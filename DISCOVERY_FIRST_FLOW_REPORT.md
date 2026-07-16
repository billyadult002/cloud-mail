# GPT67 — Discovery-First Flow Report

当前 `/v3/onboarding` 输出并持久化 discovery-first 状态：

`email → domain → infrastructure → identity → mailbox → authority → provisioning decision → next automatic action`

`beginOnboarding()` 不再读取 account registry 判断所有权；它只验证 authenticated caller 具备提交 onboarding 请求的权限，并将 provider authority 作为后续 blocker。`admin@hengmao.org` 等外部 profile 地址可以进入 `DISCOVERY_IN_PROGRESS`。

