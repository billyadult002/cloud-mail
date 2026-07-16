# Outbox Failure Scenario Plan

Date: 2026-07-06

## Safe Scenarios Used

- Invalid recipient format: `invalid-recipient`.
- Retry scheduled local outbox state with synthetic subject.
- Cancelled local outbox state with synthetic subject.
- Failed local outbox state with synthetic subject.

## Not Used

- No private content.
- No customer attachments.
- No large-file generation.
- No production migration.
- No provider Delivered claim.

## Expected Outcome

- Invalid recipient keeps Send disabled and shows a local validation error.
- Retry scheduled remains visible in Outbox and states provider has not accepted delivery.
- Cancelled remains visible and states delivery was not attempted or confirmed.
- Failed remains visible and states the message is not Delivered.
- All Mail can find the unified local ledger rows.
