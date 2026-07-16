# Diagnostics V6 Report

Date: 2026-07-07

## Result
Diagnostics V6 separates governance, provider, capability, mailbox, sync, freshness, recovery, and truth source.

## Fix
- Gmail `connected` no longer means receive capability is assumed.
- Legacy IMAP Gmail shows recovery guidance instead of false `Can send and receive`.
- OAuth Gmail keeps connected status when Gmail API evidence exists.

## Guard
`scripts/guards/provider_truth_receive_reality_guard.py`: PASS.
