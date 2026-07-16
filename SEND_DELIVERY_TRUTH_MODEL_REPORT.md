# Send Delivery Truth Model Report

Date: 2026-07-06

## Result

PASS

## Allowed States Preserved

- draft
- sending
- provider_accepted
- sent_folder_recorded
- receipt_pending
- received_confirmed
- failed
- retry_scheduled
- dead

## Current Implementation Notes

- iOS model keeps `providerAccepted` separate from `delivered`.
- Sent folder labels provider accepted as `Provider accepted; delivery not confirmed`.
- Compose success text says `Provider accepted. Delivery is not confirmed yet.`
- Backend limits delivered evidence using the internal-recipient boundary.
- Guards fail if provider accepted is treated as delivered.

## Boundary

No Delivered claim is made without recipient mailbox evidence.
