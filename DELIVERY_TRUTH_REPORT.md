# Delivery Truth Report

Status: **PASS (state semantics; provider replay required)**

External provider acceptance is persisted as `SENT`/`PROVIDER_ACCEPTED`, never `DELIVERED`. `DELIVERED` is reserved for internal persistence or a verified provider webhook. Stale `sending` claims can be reclaimed after a 10-minute lease. Existing delivery-ledger tests pass (99/99 reliability suite).

Remaining proof: receive signed Resend delivered/bounced events in production and verify the ledger transition.
