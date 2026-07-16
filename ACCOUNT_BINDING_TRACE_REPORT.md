# Account Binding Trace Report

Date: 2026-07-07

## Trace
- `billyadult006@gmail.com`: account 46 retained as active Gmail mailbox, OAuth credential reference present, `mailbox_ready`.
- `saercpku@gmail.com`: account 44 had OAuth credential reference but was stuck in `needs_reconnect` from the old D1 bind error. It was repaired to `mailbox_ready` only after ledger evidence existed.
- `tianmaofeng@gmail.com`: account 45 had OAuth credential reference and was promoted to `mailbox_ready` by the repaired sync path.
- `billyadult008@gmail.com`: account 47 has no OAuth credential reference; it remains legacy/reconnect-required.

## Conclusion
OAuth success is not treated as closure by itself. Closure is recorded only where OAuth reference plus mailbox ledger evidence exist.
