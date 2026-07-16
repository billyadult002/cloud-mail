# Cloudflare Gmail Direct OAuth Route Cleanup Report

Changed Worker behavior:

- OAuth start records CloudMail auto approval.
- OAuth start does not require an existing pending request.
- OAuth callback records OAuth success separately.
- Access denied callback records Google OAuth blocked state without creating pending approval.
- Reconnect preserves `accountId` through OAuth state and updates the original mailbox.

Deployment:

- Worker URL: `https://cloud-mail.fastonegroup.workers.dev`
- Worker version: `2fe4f371-3844-41e7-b3dd-49c665148571`
- Rollback note: rollback to previous Worker version if direct OAuth start/callback behavior regresses.
