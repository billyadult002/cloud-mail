# Build Deploy IPA Report

Precheck:

- Repository check passed.
- Xcode beta confirmed: `/Applications/Xcode-beta.app/Contents/Developer`.

Worker:

- `npm test` passed.
- Deployed Worker version: `2fe4f371-3844-41e7-b3dd-49c665148571`.
- URL: `https://cloud-mail.fastonegroup.workers.dev`
- No production migration was run.

iOS:

- Xcode beta generic iOS build passed.
- Owner-signed IPA generated:
  `artifacts/gmail-auto-approve-direct-oauth-cleanup/CloudMail-Gmail-AutoApprove-DirectOAuth-Cleanup-owner-signed.ipa`

Codesign verification passed.
