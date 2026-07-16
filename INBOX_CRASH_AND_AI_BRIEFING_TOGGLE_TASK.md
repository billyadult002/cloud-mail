# Inbox Crash And AI Briefing Toggle Task

Task: Fix intermittent CloudMail launch/Inbox crash and make AI Briefing expansion reliable.

Plan:
- [x] Stabilize Inbox navigation by routing with immutable email IDs instead of full message models.
- [x] Keep AI Briefing expansion state synchronized through one toggle action.
- [x] Increase the AI Briefing header tap target so the whole row expands/collapses.
- [x] Build, run focused guards, install on the real iPhone, and capture evidence.

Boundaries:
- No production deploy.
- No production migration.
- Do not run verify.sh.
- Do not change IPA_READY, PASS_PRODUCTION_READY, or STATUS=CLOSED.
