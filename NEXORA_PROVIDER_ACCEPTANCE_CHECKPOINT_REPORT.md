# NEXORA Provider Acceptance Checkpoint — 2026-07-18

## Evidence-backed verdict

**LOGIC_COMPLETE_PARTIAL.** Code-level runtime closure is complete and verified with deterministic fixtures
and real D1 persistence; production provider acceptance remains an external, administrator/device-gated
checkpoint. Full external provider acceptance cannot be claimed without registrations, deployment, real
provider evidence, an authenticated desktop journey, and a physical iPhone journey.

## Completed verification

- Canonical repository check passed on `main`; authoritative baseline commit is `179f15c`.
- Baseline suite reproduced: 47 files, 431 tests passed before this checkpoint's code correction.
- The corrected callback path now requires per-provider redirect configuration, builds the authorization URL
  with that value, forwards the returned authorization code and redirect URI to the existing Mission Runtime
  exchange path, and stores only a SHA-256 callback fingerprint rather than a raw code prefix.
- Microsoft defaults to the `/common` authority, matching the documented multitenant-plus-personal account
  registration choice. An explicit tenant hint remains supported and tenant policy validation remains enforced.
- Cloudflare implementation was not changed.

## Runtime closure added at this checkpoint

- The canonical Worker scheduled-event path invokes bounded token refresh, initial sync, and background-sync
  schedulers under independent telemetry steps.
- Background synchronization completion is a separately leased `ZERO_TOUCH_BACKGROUND_SYNC` job. It survives
  an expired-lease restart, records `background_complete` only after an independent adapter observation, and
  retains retryable failure state rather than inferring completion from foreground readiness.
- Microsoft consent-required exchange errors produce a durable `waiting_for_admin_consent` checkpoint with
  `ADMIN_APPROVAL_REQUIRED`, tenant-administrator ownership, and a deterministic Entra admin-consent URL;
  no client secret is included.

## Exact administrator registration contract

| Provider | App type | Production redirect URI | Initial scopes | Incremental scopes | Runtime configuration |
| --- | --- | --- | --- | --- | --- |
| Google | Web, confidential | `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback` | `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly` | `gmail.send`, `calendar.readonly` | `NEXORA_GOOGLE_OAUTH_CLIENT_ID`, `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET`, `NEXORA_GOOGLE_OAUTH_REDIRECT_URI` |
| Microsoft | Web, confidential; multitenant + personal accounts | `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/microsoft/callback` | `openid`, `profile`, `email`, `Mail.Read` | `Mail.Send`, `Calendars.Read` | `NEXORA_MICROSOFT_OAUTH_CLIENT_ID`, `NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET`, `NEXORA_MICROSOFT_OAUTH_REDIRECT_URI` |

No secret, authorization code, access token, refresh token, or PKCE verifier is recorded here.

## Resumable checkpoint

An authorized Google Cloud administrator and Microsoft Entra administrator must create the first-party
registrations and inject the listed values through Cloudflare Workers secrets. Then deploy through the
canonical deployment path and execute the provider-acceptance runbook: production Google and Microsoft
onboarding, refresh and revocation behavior, duplicate/restart/outage evidence, authenticated desktop
acceptance, and real iPhone acceptance. Until those evidence records exist, do not claim `FULL PASS`.

## Production-readiness preflight — 2026-07-18

- Canonical repository check passed on `main`; authoritative committed HEAD remains `179f15c` with the NEXORA
  release-candidate work still uncommitted alongside unrelated UCS-owned changes.
- Full deterministic verification passed: 47 test files, 433 tests. Migration safety passed a clean fresh
  apply twice and reported `MIGRATION_CI_GATE_PASS=true`. Whitespace validation and the configured
  credential-pattern scan were clean.
- Read-only production secret inventory contains legacy `GOOGLE_OAUTH_*` names but **no** required
  `NEXORA_GOOGLE_*` or `NEXORA_MICROSOFT_*` OAuth registration/configuration entries. The deployed runtime
  must therefore remain fail-closed for this Mission.
- Latest observed Worker deployment is `525681a1-36c5-4b52-be3f-9a6be445a641` (2026-07-16T19:22:32Z), which
  predates this uncommitted release candidate. No deployment, secret injection, provider login, or device
  test was attempted.

### Exact external resume order

1. Authorized Google Cloud and Microsoft Entra administrators register both applications using the contract above.
2. An authorized deployer injects the six named `NEXORA_*` values and records a reference without values.
3. Deploy the reviewed, committed release candidate and record deployment/runtime/rollback identities.
4. Complete correlated human-provider, desktop, and physical-iPhone acceptance before declaring `FULL PASS`.

## Deployment gate correction — 2026-07-18

**Verdict: PARTIAL_ZERO_TOUCH_ONBOARDING. Do not deploy.** Current implementation inspection found two
outcome-critical code defects that invalidate the prior logic-complete classification:

1. Provider GET callbacks require `workspace_id` from the callback query, while the registered static Google
   and Microsoft redirect URIs provide only provider parameters such as `code` and `state`. Callback session
   correlation therefore cannot reliably resolve the NEXORA workspace on a real provider redirect.
2. Scheduled refresh selects and updates eligible tokens without a durable claim, lease, fencing token, or
   compare-and-swap commit guard. Duplicate or stale cron workers can therefore race a refresh outcome.

The signed IPA remains valid as packaging/install evidence, but must not be used for final acceptance until
these runtime defects are fixed, regression-tested through the real callback/worker contracts, reviewed, and
deployed as a new release candidate.

## Signed IPA and physical-device checkpoint — 2026-07-18

- A paired physical iPhone was inspected through Xcode device tooling: iPhone 17 Pro Max, iOS 27.0, wired,
  booted, Developer Mode enabled. The device identifier is retained only as `…EC0401C`.
- The target app project resolves Bundle ID `app.wangbei8554.pingguo736`, Team `4GGH43VE67`, Release version
  `3.03 (357)`, manual distribution signing, and production Worker default
  `https://cloud-mail.fastonegroup.workers.dev`.
- The installed distribution profile matches the Bundle ID and Team, expires 2026-09-18T07:27:16Z, contains
  the paired device, and produces release entitlements with `get-task-allow=false`.
- Exported IPA: `artifacts/nexora-zero-touch-ipa-acceptance/export/NEXORA.ipa`; SHA-256
  `d85673d21d76850d1b84e2906c3dad633abbc88db0dcac506f7e22c3f77bcaeb`; 10,007,893 bytes. Signature,
  embedded profile, Bundle ID, Team, version/build, and production-origin string were inspected before install.
- The exact IPA was installed and launched on the paired physical device; post-install inventory reports the
  expected Bundle ID and build 357. This is packaging/device-install evidence only, not provider or iPhone
  Zero-Touch acceptance.

## Production provider and real-device acceptance attempt — 2026-07-18

- Repository guard passed again for this Mission from `/Users/billtin/Documents/cloudmail` on `main`.
  Authoritative committed HEAD remains `179f15ca70a8baf1ce767b2b2303f46ee587f627`; the release-candidate
  OAuth/runtime work is still in the uncommitted working tree and must not be deployed until reviewed and
  committed.
- Owner review found and fixed one code-level Microsoft correlation defect before external acceptance:
  callback consumption now returns the durable session `tenant_hint`; callback exchange passes that tenant to
  Microsoft token exchange; Microsoft administrator-consent checkpoint generation uses the same tenant hint
  before falling back to policy/default values. This preserves `/common` as the default multitenant/personal
  route while keeping tenant-scoped enterprise consent evidence correlated.
- Regression evidence after the fix: `npm run check` passed; focused affected suites passed 46/46;
  full Worker reliability passed 47 files, 435/435 tests. Migration safety passed with
  `MIGRATION_CI_GATE_PASS=true`; `git diff --check` passed; diff-scoped credential-pattern scan passed;
  `npm audit --audit-level=moderate` reported 0 vulnerabilities.
- Bootstrap contract validation: Google production callback remains
  `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback`; Microsoft production
  callback remains `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/microsoft/callback`.
  Microsoft app registration remains Web/confidential, multitenant plus personal accounts, default `/common`,
  with per-tenant exchange/admin-consent when a durable tenant hint exists.
- Read-only Cloudflare secret inventory shows only legacy `GOOGLE_OAUTH_*` OAuth names. The required
  `NEXORA_GOOGLE_OAUTH_CLIENT_ID`, `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET`,
  `NEXORA_GOOGLE_OAUTH_REDIRECT_URI`, `NEXORA_MICROSOFT_OAUTH_CLIENT_ID`,
  `NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET`, and `NEXORA_MICROSOFT_OAUTH_REDIRECT_URI` entries are absent.
- Read-only production deployment state: latest observed Worker deployment is
  `525681a1-36c5-4b52-be3f-9a6be445a641`, created `2026-07-16T19:22:32.674Z`, predating this release
  candidate. Remote D1 migrations pending: `0057_mission_runtime_compensation.sql`,
  `0058_nexora_zero_touch_onboarding_kernel.sql`, `0059_nexora_onboarding_phase_state_machine.sql`,
  `0060_nexora_onboarding_token_storage.sql`, and `0062_nexora_cloudflare_provider_authority.sql`.
- No Google Cloud Console registration, Microsoft Entra registration, secret injection, migration apply,
  Worker deployment, provider login, desktop acceptance, or physical-iPhone acceptance was performed. `FULL
  PASS` remains blocked on external authority and real-device/provider evidence.

### Exact resumable checkpoint after this attempt

1. Review and commit the current release-candidate diff, including the Microsoft tenant-correlation fix and
   the existing NEXORA runtime closure work.
2. Authorized Google Cloud and Microsoft Entra administrators create the app registrations from the contracts
   in `NEXORA_GOOGLE_ADMIN_BOOTSTRAP_PACKAGE.md` and `NEXORA_MICROSOFT_ADMIN_BOOTSTRAP_PACKAGE.md`.
3. Authorized deployer injects the six `NEXORA_*` OAuth secret/config entries through Cloudflare Workers
   secret boundaries; record names/references only, never values.
4. Apply only approved migrations and deploy the reviewed release candidate through the canonical production
   path; record deployment identity, runtime identity, migration identity, timestamp, and rollback reference.
5. Execute the provider-acceptance runbook for real Google, real Microsoft, scheduled refresh, admin-consent
   behavior where required, initial/background sync, duplicate/restart/outage cases, authenticated desktop,
   and physical iPhone evidence correlation.

Strongest current verdict: **LOGIC_COMPLETE_PARTIAL**.

## OAuth correlation and refresh-fencing release-blocker closure — 2026-07-18

- Added migration `0061_nexora_oauth_callback_correlation_and_refresh_fencing.sql`. Every authorization
  session now receives an atomic D1-backed callback-correlation record keyed only by a SHA-256 state hash.
  It binds the exact tenant, workspace, mission, provider, redirect contract, requested scopes, PKCE
  challenge, expiry, single-use claim and resume checkpoint. Provider GET callbacks no longer read or trust
  `workspace_id`, active workspace, or a user assertion; the state record is the sole scope authority.
- Added durable refresh work with a unique `(mission, token-generation)` idempotency key, D1 lease,
  lease-recovery, attempt count, fence generation, and conditional token rotation commit. A stale refresh
  worker cannot overwrite a newer credential rotation; revoked and transient outcomes are also generation-gated.
- Focused D1 verification passed: 3 files, 44 tests. This closes the two code-level release blockers, subject
  to full-regression/checker review. Build 357 is **HISTORICAL_PACKAGING_AND_INSTALLATION_EVIDENCE** only;
  it is not compatible acceptance evidence until this release candidate is reviewed, migrated, and deployed.

## Security-review correction — 2026-07-18

**Verdict remains: `PARTIAL_ZERO_TOUCH_ONBOARDING`. Do not deploy.** Independent review found that the
initial blocker patch did not prove safe callback claim recovery or lease/fence authorization at every refresh
commit. Commit-time refresh lease/fence predicates have now been added and the migration remains safe, but
callback side-effect checkpoints and abandoned-claim recovery still require implementation and persistence-backed
failure-injection coverage. Build 357 remains `HISTORICAL_PACKAGING_AND_INSTALLATION_EVIDENCE`.

## Mandatory Comail reuse assessment — 2026-07-18

The mandatory assessment is recorded in `NEXORA_COMAIL_REUSE_ASSESSMENT.md`. Comail 0.2.22 is
AGPL-3.0-only and a Rust/Tauri desktop client; no direct code, dependency, or test is imported
without authorization to accept its network-copyleft obligations. NEXORA uses documented
`DESIGN_REUSE` for provider grant/error/rotation behavior and retains all tenant/workspace,
Mission, D1 claim/fence, encrypted storage, and evidence authority in the NEXORA kernel.
