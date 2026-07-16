# Recovery Action Engine Report

## Result
PASS.

Recovery is now state-driven:
- Legacy IMAP: `RECONNECT_OAUTH`
- First import pending / not verified: `RUN_IMPORT_RECOVERY`
- Mailbox ready: `NONE`

iOS maps these to concrete recovery states instead of generic connected/blocker text.

