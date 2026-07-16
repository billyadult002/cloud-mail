# GPT67A — Mailbox State Machine Report

## 状态定义

| 状态 | 含义 | 下一动作 |
|---|---|---|
| `DISCOVERY_IN_PROGRESS` | 正在查询 domain/routing/identity | 等待或重试 |
| `DOMAIN_FOUND` | domain 存在但 authority 尚未确认 | 连接域名 authority |
| `DOMAIN_READY` | routing/authority 已确认 | 继续 identity/mailbox discovery |
| `IDENTITY_FOUND` | identity 已发现 | 评估 mailbox activation |
| `MAILBOX_ACTIVE` | mailbox 已激活 | sign-in/authorize |
| `MAILBOX_ACTIVATABLE` | catch-all/pending 证据允许激活 | bootstrap + set password |
| `AUTHORITY_REQUIRED` | 需要域名所有者配置或授权 | 不调用 activation，展示下一自动动作 |
| `PROVIDER_UNSUPPORTED` | provider 无安全 adapter | 请求受支持配置，不做猜测 fallback |

## 不变量

1. `Not Found` 不能终止 discovery。
2. `MAILBOX_ACTIVE` 只能由服务端 identity/mailbox 证据产生。
3. `MAILBOX_ACTIVATABLE` 不等于已激活，必须经过 bootstrap 结果确认。
4. `AUTHORITY_REQUIRED` 不得显示“activate and link mailbox”按钮。

