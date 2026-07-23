# ADR-013: Provider Session Boundary

Status: accepted.

When Connection Runtime is enabled, the only credential-bearing live-provider paths are:

`Connection Runtime -> Authorized Provider Session -> Gmail Connection Adapter -> Google`

`Refresh Scheduler -> Authorized Provider Session -> canonical token exchange -> Google`

Provider Session validates exact tenant/workspace/connection/provider state, connection generation, credential generation, provider-connection generation, active lease, current fence, and Gmail read-only scope. It resolves access authority inside a closure, increments a fenced session generation, is short-lived, and throws on serialization. Mission Runtime and capability invocation never receive raw credentials.

The adapter registry implements a provider-agnostic boundary and currently registers only the Gmail adapter. That adapter performs one bounded `GET users/me/profile` request with no-store caching and redirect rejection. It never reads or stores the response body and reports `mailboxMutated=false`. No send, draft, watch, delta, sync, or mailbox-write method exists.
