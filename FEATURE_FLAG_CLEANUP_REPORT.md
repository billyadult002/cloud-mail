# Feature Flag Cleanup Report

Status: **PARTIAL**

The Worker contains 55 distinct flag/debug tokens in the scanned paths. Security-sensitive flags are now explicit rather than implicit (for example `IDENTITY_E2E_EXPOSE_TOKEN` is required in addition to E2E mode). AI provider flags remain because they govern runtime authorization and mailbox-data consent; they are not dead experiments. Permanent-flag removal requires a production environment inventory before deletion.
