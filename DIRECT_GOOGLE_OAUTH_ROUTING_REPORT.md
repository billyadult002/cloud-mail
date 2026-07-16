# Direct Google OAuth Routing Report

Worker routes now route Gmail add/reconnect directly to Google OAuth:

- `/api/v2/google/mail/oauth/start`
- `/api/v2/google/oauth/start`
- `/api/v2/gmail/oauth/start`
- `/api/v2/gmail/oauth/reconnect`

iOS routes:

- Fresh Gmail: `startGoogleMailboxOAuth(email:)`
- Existing Gmail reconnect: `startGoogleMailboxOAuth(email:accountId:)`

Forbidden routes avoided:

- Reconnect -> Add Mailbox
- Reconnect -> no-op
- Reconnect -> OAuth without accountId
- Add Gmail -> Request Access
- Add Gmail -> Pending Approval
