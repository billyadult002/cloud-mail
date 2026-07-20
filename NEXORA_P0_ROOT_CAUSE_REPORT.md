# NEXORA P0 Root Cause Report
Date: 2026-07-19

Mission: `NEXORA P0 AUTHORITY HARDENING AND EVIDENCE LEDGER COMPLETION`

## Root causes

1. Domain ownership used a read-then-write boundary. Challenge verification was committed before
   global domain ownership, evidence, and audit, so a concurrent loser could retain a false verified
   challenge even when it could not bind the domain.
2. Classification treated an authenticated administrator as globally scoped and accepted tenant,
   workspace, account, provider, domain, fingerprint, and message signals from the request body.
3. Classification projection and evidence used separate writes. Failure of the evidence insert could
   leave an orphan projection; replay could append duplicate evidence without a generation lineage.
4. The 0077 evidence table was a BODYLESS record store, not an append-only, integrity-linked ledger
   that could reconstruct ownership, authority, runtime, account, classification, and retrieval.
5. Desktop and iPhone rendered local/cached classification without a server-issued, single-use
   acceptance correlation bound to authenticated actor, workspace, account, runtime, build, message,
   classification, evidence, and server time.

## Corrective boundary

- Domain verification now requires an exact challenge ID/generation and commits challenge consume,
  immutable owner binding, verification event, workspace state, and audits as one D1 batch.
- Authority bootstrap derives its evidence reference from the server ledger, rejects caller evidence,
  fences revoked generations, and batches authority plus audits.
- Classification accepts only an acceptance session and canonical message ID; all scope and source
  identity are resolved from authenticated actor and canonical server records.
- Migration 0079 adds immutable runs/events/evidence, ledger heads, ownership events, acceptance
  sessions, correlation events, ownership immutability, linkage constraints, and append-only triggers.
- Classification projection and v2 Evidence Ledger are committed atomically and replay idempotently.
- Desktop and iPhone use a server-issued challenge kept only in memory and require a consumed server
  correlation receipt before showing Verified.

No production activation or production data mutation occurred in this Mission.
