# P32C Mail Provider Abstraction Hardening Report

## Status

`mail_provider_abstraction = HARDENED`

## Providers

- Cloudflare Email Sending
- Resend
- Amazon SES
- Postmark
- Future CloudMail Relay

## Adapter Contract

- `provisionDomain(domain)`
- `verifyDomain(domain)`
- `getRequiredDnsRecords(domain)`
- `getDomainStatus(domain)`
- `getDkimRecords(domain)`
- `getReturnPathRecords(domain)`
- `sendMessage(message)`
- `classifyProviderAcceptedWithoutDelivered()`
- bounce handling foundation
- complaint / FBL placeholder
- suppression list foundation
- domain warmup state
- provider health state

## Boundary

ProviderAccepted remains separate from Delivered. No send PASS is claimed. Cloudflare Email Sending remains blocked by prior real evidence: Unauthorized code `2036`.
