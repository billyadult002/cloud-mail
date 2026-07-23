# Provider-Agnostic Connection Contract

Identity tuple: tenant, workspace, verified Domain Authority, provider, account, authority generation, connection generation, credential reference/generation, and provider-connection reference/generation.

Operations are discover, begin authorization, process callback, evaluate health, refresh, acquire Provider Session, suspend, revoke, and require reauthorization. Each contract declares timeout, lease requirement, Evidence requirement, and retry mode in executable code.

Idempotency is `(connection_id, operation_type, idempotency_key)` plus a request digest. Callback session and correlation identifiers are independently unique. A replay with changed authority or generation is rejected. Provider responses are classified without response-body persistence. Unknown providers, states, transitions, outcomes, scopes, generations, and purposes fail closed.

Rollout requires all of: enabled flag, emergency disable off, exactly one provider (`google`), one tenant, one workspace, and one account. The scheduled handler claims at most one selected job. Global defaults are disabled.
