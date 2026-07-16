# P32D Inbound Security Verdict Validation Report

## Status

`inbound_security_verdict_validation = PASS`

## Verdict Cases Validated

- `PASS`
- `WARN`
- `SUSPICIOUS`
- `QUARANTINE_RECOMMENDED`
- `BLOCKED`
- `UNKNOWN`

## Fields Validated

- SPF / DKIM / DMARC / ARC result fields.
- From-domain alignment.
- Reply-to mismatch.
- Display-name spoof flag.
- Attachment and URL risk.
- Spam and phishing score.
- Security verdict.
- Security classification.
- Quarantine recommendation.

No real mailbox content was exposed. Malware scanning was not claimed.
