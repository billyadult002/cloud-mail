# Final V2.5 Production Baseline Decision

## Decision: **DO NOT FREEZE**

The local production candidate is build-valid and the security/dependency/worker gates are green. The final two GPT65_6R gates are not green:

1. Live DNS has no DMARC record and SPF is `~all`.
2. Live D1 has no `hengmao.org` ownership/readiness/capability state.
3. Live Worker still serves wildcard CORS, proving the local hardening is not deployed.
4. Real iPhone 17 is connected and installation succeeds; launch UI test passes after USB wake, but the mailbox drawer workflow test fails and the full master audit is incomplete.

Therefore `NEXORA_V2_5_PRODUCTION_BASELINE` remains **BLOCKED**. GPT67 must not begin until these runtime and user-visible gates are re-run and pass.
