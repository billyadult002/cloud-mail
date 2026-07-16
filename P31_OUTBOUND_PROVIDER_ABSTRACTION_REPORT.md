# P31 Outbound Provider Abstraction Report

Implemented:

- `platform/cloud-mail/mail-worker/src/service/outbound-provider-adapter.js`

## Adapter Interface

The base adapter supports:

- `provisionDomain(domain)`
- `verifyDomain(domain)`
- `getRequiredDnsRecords(domain)`
- `sendMessage(message)`
- `getDkimRecords(domain)`
- `getDomainStatus(domain)`
- `getBounceOrReturnPathStatus(domain)`
- `classifyProviderAcceptedWithoutDelivered()`

## Provider Priority

1. Cloudflare Email Sending
2. Resend
3. Amazon SES
4. Future CloudMail Relay

## Delivery Truth

`ProviderAccepted != Delivered` is preserved. Provider acceptance produces:

- `providerAccepted = true`
- `delivered = false`
- `deliveryTruthState = provider_accepted`

## Real hengmao.org Outbound State

Cloudflare Email Sending returned `Unauthorized [code: 2036]`, so outbound readiness is blocked until Cloudflare Email Sending authorization is fixed or a fallback provider is configured.
