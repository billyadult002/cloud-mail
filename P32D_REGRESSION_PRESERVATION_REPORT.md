# P32D Regression Preservation Report

## Status

`regression_detected = FALSE`

## Verification

- `npm run test:unit`: PASS.
- `npm run test:rc`: PASS, 10 files / 88 tests.
- P31 guard: PASS.
- P32C guard: PASS.
- P32D guard: PASS.
- P27 outbound send state guard: PASS.
- P27 account timestamp guard: PASS.
- P28 reliability closure guard: PASS.
- ProviderAccepted != Delivered guard: PASS.
- Unified All Mail contract guard: PASS.
- Unified All Mail previous PASS preservation guard: PASS.
- Attachment previous PASS preservation guard: PASS.
- Attachment All Mail ledger guard: PASS.
- Attachment open/preview guard: PASS.
- Outbox retry/failure state guard: PASS.
- P29A Gemini OAuth lifecycle guard: PASS.
- P30 Apple Intelligence-only AI guard: PASS.
- Xcode beta no-sign iOS build: PASS.

## iOS Note

P30 guard required cleanup of user-facing legacy Google authorization wording in `CloudMailV2Views.swift`. The iOS target builds successfully with Xcode beta.
