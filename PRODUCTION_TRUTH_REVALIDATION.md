# Production Truth Revalidation

- Provider accepted != delivered: FIXED in local code; no live delivery rows exist for a runtime transition replay.
- OAuth cleanup: FIXED in local code; live disconnect replay requires an authenticated account session.
- Attachment ownership: FIXED in local code; live cross-user replay requires two authenticated users.
- Webhook security: FIXED in local code; signed provider event replay was not available.
- Activation security: FIXED in local code; production activation replay was not performed.
- Cross-account isolation: FIXED in local cache/route code; two-account device replay remains unexecuted.

Classification: code gates FIXED; live replay gates PROVEN_BLOCKED where credentials/events were unavailable.
