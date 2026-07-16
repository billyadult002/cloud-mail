# Outbox Retry Cancel Real iPhone Report

Date: 2026-07-06

## Result

PASS.

## Real iPhone Evidence

- Retry scheduled: `evidence/cloudmail-outbox-retry-state-20260706-162235-v3.png`.
- Cancelled: `evidence/cloudmail-outbox-cancelled-state-20260706-162235.png`.
- Failed: `evidence/cloudmail-outbox-failed-state-20260706-162235.png`.
- Local state summary: `evidence/outbox-state-summary-20260706-162235.json`.

## Observed

- Retry scheduled row stayed visible in Outbox.
- Failed row stayed visible in Outbox.
- Cancelled row stayed visible in Outbox.
- No row claimed Delivered.
- No stuck sending spinner.
- Local stored states confirmed:
  - `failed_permanent`
  - `cancelled`
