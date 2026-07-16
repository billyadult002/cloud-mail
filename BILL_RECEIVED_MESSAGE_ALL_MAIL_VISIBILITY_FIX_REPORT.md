# Bill Received Message All Mail Visibility Fix Report

Date: 2026-07-06

## Target Message

- Subject: `CloudMail real-use send test 20260706-121605`
- Expected source mailbox: `bill@fastonegroup.com`
- Expected direction: inbound
- Expected status: `received` or `received_confirmed` when backed by mailbox evidence

## Fix

The backend All Mail query now includes active authorized identity scopes from `mailbox_authorizations`, including owner user/account pairs. This is the code path required for the bill mailbox message to be eligible for All Mail.

## Production Evidence After Deploy

- Production Worker deployed: `bb46b9bf-070f-4846-96d8-951f6cf42e71`.
- Final production Worker deployed after Global Message Ledger fix: `06385211-843d-4991-a244-116fcb017809`.
- Production D1 metadata confirms the received row exists:
  - `email_id=1388`
  - `account_id=39`
  - `user_id=31`
  - `provider=cloudflare_native`
  - `account_email=bill@fastonegroup.com`
  - `type=0`
  - `is_del=0`
- Production D1 metadata confirms active authorization:
  - `grantee_user_id=1`
  - `owner_user_id=31`
  - `owner_account_id=39`
  - `email=bill@fastonegroup.com`
  - `status=active`

## Boundary

No unrelated mailbox content inspected.

Real iPhone visibility was re-tested after the Global Message Ledger fix. Search for `121605` showed the inbound row with source `bill@fastonegroup.com`, so the named bill received message visibility fix is PASS.
