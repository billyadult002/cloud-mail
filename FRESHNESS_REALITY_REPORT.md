# Freshness Reality Report

## Result
PASS.

Freshness in iOS now requires mailbox readiness. A provider timestamp alone is not enough to mark Gmail fresh/receive-ready.

## Rule
If `mailboxReady == false`, freshness is `Unknown` instead of falsely fresh.

## Evidence
- `freshnessTruthStatus(... mailboxReady:)`
- `canReceiveReality` requires `mailboxReady`.

