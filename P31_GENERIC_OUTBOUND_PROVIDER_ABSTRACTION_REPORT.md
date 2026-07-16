# P31 Generic Outbound Provider Abstraction Report

## Status

`outbound_provider_abstraction = READY`

## Implemented Interface

`OutboundProviderAdapter` supports:

- `provisionDomain(domain)`
- `verifyDomain(domain)`
- `getRequiredDnsRecords(domain)`
- `getDomainStatus(domain)`
- `getDkimRecords(domain)`
- `getReturnPathRecords(domain)` / return-path status extension
- `sendMessage(message)`
- `classifyProviderAcceptedWithoutDelivered()`

## Provider Priority

- Cloudflare Email Sending
- Resend
- Amazon SES
- CloudMail Relay

## Boundary

No send PASS is claimed. Provider acceptance remains separate from Delivered.
