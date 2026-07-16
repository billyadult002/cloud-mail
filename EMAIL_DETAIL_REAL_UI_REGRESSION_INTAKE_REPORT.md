# Email Detail Real UI Regression Intake Report

Date: 2026-07-05

## Intake

Real-device Email Detail review identified four issues:

- Translate language picker opened, but the result surface was not reliable enough after language selection.
- Top star action appeared like a no-op because feedback/state was weak.
- Reply and AI Draft existed in more than one action surface.
- Bottom actions did not match the compact glass action language used elsewhere.

## Scope

This loop only changed Email Detail action architecture and related static guards. No production deployment, migration, credential, token, secret, ChatGPT enablement, or OAuth live-smoke claim was made.

