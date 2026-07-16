# Dead Code Registry

| Symbol/path | Classification | Evidence/action |
|---|---|---|
| `security.js:permKeyToPaths` | Safe Remove | Definition-only; removed in this iteration. |
| `login-service.js:registerVerify()` | Safe Remove | Empty method; removed. The `registerVerify` setting field remains active and was preserved. |
| `AppState.restoreCachedInboxForLastUser()` | Safe Remove | No remaining callers; removed previously during cache isolation. |
| `AIProviderRegistry` | Active | Used by AppState/provider settings; retain. |
| `AIRouter` | Active | Used by AppState AI actions; retain pending NexoraAgentEngine convergence. |
| Legacy IMAP reconnect code | Migration Required | Runtime explicitly marks legacy accounts `needs_reconnect`; remove only after account migration evidence. |
| Future provider metadata | Future Planned | Not executable, but contract-visible; remove only with UI/API compatibility proof. |
