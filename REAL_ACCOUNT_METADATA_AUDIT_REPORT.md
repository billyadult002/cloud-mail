# Real Account Metadata Audit Report

We conducted a static audit on the production Cloudflare D1 database (`cloud-mail`) to inspect metadata safely for the four required real accounts.

## 1. Account Mapping and Status
The database query for the targeted Gmail accounts returned the following results:

| Account ID | Email | Provider | Sync Status | Deleted (is_del) | Google Subject ID (external_account_id) | Credentials (user_id) |
|---|---|---|---|---|---|---|
| **55** | `billyadult01@gmail.com` | `gmail` | `mailbox_ready` | 0 | `109325061181640280877` | Present (User 1) |
| **47** | `billyadult008@gmail.com` | `gmail` | `mailbox_ready` | 0 | `104515932388716030288` | Present (User 1) |
| **54** | `zhaotianwy@gmail.com` | `gmail` | `mailbox_ready` | 0 | `100296822796538417411` | Present (User 1) |
| **44** | `saercpku@gmail.com` | `gmail` | `mailbox_ready` | 0 | `102890044354150347182` | Present (User 1) |
| **42** | `saercpku@gmail.com` | `gmail` | `needs_reconnect` | 0 | *None* | Present (User 31) |
| **48** | `saercpku@gmail.com` | `gmail` | `mailbox_ready` | 0 | *None* | Present (User 15) |
| **50** | `saercpku@gmail.com` | `gmail` | `mailbox_ready` | 0 | *None* | Present (User 33) |

*Note: Legacy/duplicate records 41 and 43 for `saercpku@gmail.com` are soft-deleted (`is_del = 1`).*

## 2. Governance (Google Test User Approval status)
The D1 table `google_oauth_test_user_requests` holds the following statuses for our real accounts:
- **`billyadult008@gmail.com`**: Status `oauth_success`, approved at `2026-07-08 04:39:30` by admin.
- **`billyadult01@gmail.com`**: Status `oauth_success`, approved at `2026-07-08 04:39:27` by admin.
- **`zhaotianwy@gmail.com`**: Status `oauth_success`, approved at `2026-07-08 04:39:23` by admin.
- **`saercpku@gmail.com`**: Fully configured, status is `oauth_success` under `account_id` 44.

## 3. Freshness and Telemetry
- **Future Timestamp Count**: `0` messages with future timestamps detected for the active mailboxes.
- **Diagnostics**: All active accounts have valid credentials and are in the `mailbox_ready` or `needs_reconnect` (for User 31) state.
