# Reconnect Required Removal Report

Date: 2026-07-07

## Removed
- Account 44 `saercpku@gmail.com`: false reconnect/error state removed after OAuth and ledger evidence were verified.
- Account 45 `tianmaofeng@gmail.com`: false reconnect/error state removed by repaired scheduled sync.

## Retained
- Account 47 `billyadult008@gmail.com`: reconnect requirement retained because it has a legacy credential, not an OAuth mailbox credential.
- Account 42 `saercpku@gmail.com`: legacy owner row retained as reconnect-required; a separate OAuth-ready row exists for the relevant owner contexts.
