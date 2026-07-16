# P32D MailProvider Boundary Validation Report

## Status

`mail_provider_boundary_validation = PASS`

## Providers Validated

- Cloudflare Email Sending.
- Resend.
- Amazon SES.
- Postmark.
- Future CloudMail Relay.

## Validated

- Required DNS record shape.
- Return-path metadata.
- ProviderAccepted classification.
- Bounce foundation.
- Complaint/FBL placeholder.
- Suppression list foundation.
- Warmup state.
- Provider health state.

## Boundary

Cloudflare Email Sending Unauthorized code `2036` remains preserved. Send PASS was not claimed.
