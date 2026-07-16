# GPT67 — V3 Onboarding State Machine

| 字段 | 状态 |
|---|---|
| Discovery | `DISCOVERY_IN_PROGRESS` |
| Domain | `DOMAIN_FOUND` |
| Infrastructure | `INFRASTRUCTURE_FOUND` 或 `DISCOVERY_IN_PROGRESS` |
| Identity | `IDENTITY_OBSERVED` |
| Mailbox | `MAILBOX_DISCOVERY_REQUIRED`、后续由 adapter 产生 active/activatable |
| Authority | `AUTHORIZED`、`PARTIALLY_AUTHORIZED`、`AUTHORITY_REQUIRED`、`UNSUPPORTED` |
| Provisioning | `PROVISIONING_READY` 或 `AUTHORITY_REQUIRED` |

终止状态只能由 authority/provider/provisioning 证据产生，不能由 `NOT_FOUND` 产生。

