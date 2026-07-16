# Account Status - Gmail Reconnect Routing & Duplicate Prevention

Date: 2026-07-09

## Production Metadata Snapshot
Read-only D1 metadata query; no mailbox body/content and no credentials read.

| Account | Account ID | Owner | Credential | Status | Imported Rows | Latest Imported Message | Notes |
|---|---|---|---|---|---|---|---|
| billyadult01@gmail.com | 55 | admin@fastonegroup.com | oauth | mailbox_ready | 45 | 2026-07-07T20:15:33.000Z | Ready for replay. |
| saercpku@gmail.com | 44 | admin@fastonegroup.com | oauth | mailbox_ready | 201 | 2026-07-07T22:03:32.000Z | Ready for replay. |
| billyadult008@gmail.com | 47 | admin@fastonegroup.com | oauth | mailbox_ready | 5 | 2026-07-07T00:39:36.000Z | Legacy credentials cleared; ready for OAuth reconnect. |
| zhaotianwy@gmail.com | 54 | admin@fastonegroup.com | oauth | mailbox_ready | 165 | 2026-07-07T22:02:51.000Z | Ready for replay. |

## Policy
- OAuth/identity connected does not imply Mailbox Ready.
- Gmail read/send requires `mailbox_ready`.
- Reconnecting existing accounts preserves `accountId`, updates provider in-place, and archives other duplicates.
2026-07-08:
- Existing Gmail accounts observed in Accounts as Connected on real iPhone.
- Default Add Gmail branch no longer shows Request Access or Pending Approval before Google OAuth.
- Full fresh Gmail OAuth replay still requires user-provided Gmail login interaction.
