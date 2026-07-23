# Connection Runtime Rollback Runbook

Rollback is configuration-first and schema-preserving.

1. Set `NEXORA_CONNECTION_RUNTIME_EMERGENCY_DISABLED=true` and `NEXORA_CONNECTION_REFRESH_ENABLED=false`.
2. Set `NEXORA_CONNECTION_RUNTIME_ENABLED=false`.
3. Verify no Connection job becomes RUNNING, no refresh lease is acquired, and no Provider Session generation advances.
4. Keep the current compatibility reader deployed and route reads to the existing canonical surfaces; do not delete or copy credential material. After any v2 provider-token write, do not roll back to an older binary that lacks v2 AAD support.
5. Verify existing `search_email` and non-capability Mission paths, Worker health, and Evidence readability.
6. Leave migration 0081 and its rows inert for forensic reconciliation. Do not down-migrate or drop tables.

The dedicated provider-token secret must remain available during rollback because v2 ciphertext never falls back to JWT signing keys. Success requires zero new provider calls, zero partial verified events, stable canonical behavior, and internally consistent D1 state. Re-enable only from an exact reviewed source/configuration fingerprint.
