# Connection Runtime Architecture Inventory

Canonical base: `cafe44eca4359911cfd773f0f262f3b4c37b9720`, the merge commit for Checkpoint 4 PR 9. Worktree: `/Users/billtin/Documents/cloudmail/.worktrees/nexora-checkpoint5-connection-runtime`.

The pre-Checkpoint-5 OAuth surface comprised 10 core modules and about 1,580 lines. Inventory scans found 31 OAuth/callback files, 8 token files, 41 account/mailbox files, 32 workspace/binding files, and 35 credential/crypto files. Existing strengths retained: signed ID-token validation, callback correlations and recovery checkpoints, token-generation fences, provider connections, canonical Evidence, and Mission continuation.

Gaps closed here: no Provider Session boundary; refresh not scheduled; token lookup scoped only by Mission; token binding generation could become stale; callback login/tenant constraints were not reloaded; no live provider health proof; default-success sync adapters could be misread as provider proof; and D1 did not own a canonical Connection state machine.

Checkpoint 5 adds one Connection owner beneath adapters, reuses the existing callback and Evidence Ledger, and does not create another Mission Runtime or authority owner.

Checkpoint 5 Comail provenance: `NextOSP/comail` tag `v0.2.25`, commit `d068e09bc0511213754964f2e0a6ab9481121663`, AGPL-3.0. Classification: concepts only, no source copied. Adapted concepts are refresh single-flight, expiry margin, rotated refresh-token replacement, bounded attempts/backoff, and provider configuration tables. Desktop loopback, process mutexes, OS keyring/plaintext fallback, unsigned token parsing, raw error logging, local schedulers, and optimistic write queues were rejected. Earlier repository documents referring to Comail 0.2.22 are historical records for prior checkpoints; they are not the provenance basis for this Checkpoint 5 implementation.
