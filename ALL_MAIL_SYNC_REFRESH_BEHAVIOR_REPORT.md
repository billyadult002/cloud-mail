# All Mail Sync Refresh Behavior Report

Date: 2026-07-06

## Current Behavior

- iOS All Mail refresh calls the backend email list with `allReceive` when no single account is selected.
- Account list exposes active owned and delegated/authorized identities.
- The backend All Mail query now includes current user mail plus active authorized owner mailbox scopes.

## Boundary

Production Worker was deployed after authorization. The final Global Message Ledger deployment is `06385211-843d-4991-a244-116fcb017809`.

The iOS app now uses `/v2/mail/all` for All Mail. Real iPhone search for `121605` showed the local sent ledger, the inbound `bill@fastonegroup.com` row, and the outbound `saercpku@gmail.com` row. No production migration was run.
