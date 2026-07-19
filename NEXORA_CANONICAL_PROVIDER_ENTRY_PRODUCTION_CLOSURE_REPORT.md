# NEXORA Canonical Provider Entry And Real-Device Production Closure Report

Assessment date: 2026-07-19

Mission: NEXORA CANONICAL PROVIDER ENTRY AND REAL-DEVICE PRODUCTION CLOSURE

Verdict: LOGIC_COMPLETE_PARTIAL

Evidence report classification:

`EVIDENCE_ONLY_COMMIT_REQUIRED`

Rationale: this report records production evidence and blocker classification, but must not be mixed into an implementation commit while the Mission requires both implementation branches to remain pinned to canonical commit `755a9cd4224e1f9cebabf430b833e1485e25fb0c`. It should be persisted in a separate evidence-only successor commit after the production-provider execution package is ready, or moved to an external evidence store if that becomes the canonical Mission evidence mechanism.

## Scope Boundary

This report is additive evidence for the ongoing NEXORA production-provider and real-device acceptance Mission. It does not alter the completed Callback Mission verdict or reuse Callback Mission evidence as new evidence.

Canonical repository: `/Users/billtin/Documents/cloudmail`

Canonical remote: `https://github.com/billyadult002/cloud-mail.git`

Canonical branch: `main`

Integration branch: `codex/nexora-production-integration-5d7024d`

Canonical commit verified in worktree: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`

## Git State

Repository guard command:

`python3 scripts/repository_check.py cloudmail --task "nexora_canonical_provider_entry_real_device_production_closure"`

Result: passed.

Worktree checked: `/Users/billtin/Documents/cloudmail/.worktrees/nexora-production-integration-5d7024d`

Before this report, the worktree was clean and both `main` and `codex/nexora-production-integration-5d7024d` pointed to `755a9cd4224e1f9cebabf430b833e1485e25fb0c`.

Second closure pass verification:

- `main`: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`
- `codex/nexora-production-integration-5d7024d`: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`
- `HEAD`: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`
- Implementation drift: none observed.
- Staged files: none.
- Only untracked NEXORA file: `NEXORA_CANONICAL_PROVIDER_ENTRY_PRODUCTION_CLOSURE_REPORT.md`.

Migration 0076 file: `mail-worker/migrations/0076_nexora_onboarding_base_authority_tables.sql`

Migration 0076 SHA-256:

`a023d710d76ee21de059f1b03464e20fba2133d6f221a2f19f467421adec55b4`

Second closure pass checksum verification matched the recorded value.

## Migration 0076 Audit

Migration 0076 is forward-only and idempotent:

- Uses `CREATE TABLE IF NOT EXISTS`.
- Uses `CREATE INDEX IF NOT EXISTS`.
- Contains no `DROP TABLE`, `DELETE FROM`, `UPDATE`, or `ALTER TABLE`.
- Creates base onboarding state/authority tables required by Runtime queries before real provider onboarding can start.
- Does not persist raw OAuth codes, token values, PKCE verifiers, cookies, provider payloads, or credential values.

Created object classes verified in production D1:

- `nexora_onboarding_state`
- `nexora_onboarding_authorization_sessions`
- `nexora_onboarding_tokens`
- `nexora_onboarding_capabilities`
- `nexora_initial_sync_intents`
- `nexora_initial_sync_dispatches`
- `nexora_onboarding_notifications`
- `nexora_autonomy_jobs`

Remote D1 migration status after 0076:

`No migrations to apply`

Remote migration ledger contains:

`0076_nexora_onboarding_base_authority_tables.sql`

## Production Worker Correlation

Worker: `cloud-mail`

Production origin: `https://cloud-mail.fastonegroup.workers.dev`

Production D1: `cloud-mail`

Production D1 ID: `4c05f52d-5d8c-4fb5-9a6d-888bebf8c596`

Wrangler version: `4.112.0`

Xcode Beta identity verified separately:

`/Applications/Xcode-beta.app/Contents/Developer`

`Xcode 27.0`, build `27A5194q`

Canonical commit `755a9cd4224e1f9cebabf430b833e1485e25fb0c` was deployed through the approved local Wrangler path with message:

`NEXORA canonical commit 755a9cd migration 0076 compatibility`

Active Worker Version ID after deployment:

`8bfa8937-1d7b-4e22-9606-2ce13559f9cd`

Second closure pass confirmed this remains the active Worker Version ID.

Deployment timestamp:

`2026-07-19T02:11:03.354Z`

Bindings reported during deploy:

- KV binding: `kv` / `78c5a7476f2b4a298779ba592eb48cc8`
- D1 binding: `db` / `cloud-mail`
- R2 binding: `r2` / `cloud-mail-r2`
- Assets binding: `assets`

Rollback target recorded:

`0a44bf7c-5dcf-41b8-a0c3-b61059ae7fdc`

No final rollback/restoration was executed in this checkpoint because canonical Google/Microsoft provider cutover and real provider onboarding have not passed yet.

## Callback Fail-Closed Verification

Health:

`GET https://cloud-mail.fastonegroup.workers.dev/`

Result: HTTP 200 HTML.

Second closure pass health result: HTTP 200 HTML.

Google invalid callback:

`GET /v3/onboarding/providers/google/callback?state=missing&code=fake`

Result: HTTP 200 JSON with `ok:false`, `reason:"INVALID_STATE"`, `provider:"google"`.

Microsoft invalid callback:

`GET /v3/onboarding/providers/microsoft/callback?state=missing&code=fake`

Result: HTTP 200 JSON with `ok:false`, `reason:"INVALID_STATE"`, `provider:"microsoft"`.

Second closure pass callback verification:

- Google invalid callback remained HTTP 200 JSON with `ok:false`, `reason:"INVALID_STATE"`, `provider:"google"`.
- Microsoft invalid callback remained HTTP 200 JSON with `ok:false`, `reason:"INVALID_STATE"`, `provider:"microsoft"`.

Pre-test and post-test production fingerprints matched exactly:

- `authorization_sessions`: 0
- `tokens`: 0
- `provider_connections`: 0
- `provider_outcomes`: 0
- `evidence_outbox`: 0
- `verified_results`: 0
- `correlation_consumptions`: 0
- `mission_continuations`: 0
- `sync_intents`: 0
- `sync_dispatches`: 0
- `zero_touch_sync_jobs`: 0

Second closure pass post-callback fingerprint also remained zero for all measured mutation surfaces:

- `authorization_sessions`: 0
- `tokens`: 0
- `provider_connections`: 0
- `provider_outcomes`: 0
- `evidence_outbox`: 0
- `verification_attempts`: 0
- `verified_results`: 0
- `correlation_consumptions`: 0
- `mission_continuations`: 0
- `sync_intents`: 0
- `sync_dispatches`: 0
- `notifications`: 0
- `zero_touch_sync_jobs`: 0

Conclusion: invalid Google and Microsoft callbacks are reachable and fail closed without creating authority, token, provider, evidence, continuation, or sync records.

## GitHub Actions

Workflow inspected: `.github/workflows/deploy-cloudflare.yml`

Minimum required environment inputs observed:

- `JWT_SECRET`
- `DOMAIN`
- `ADMIN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `D1_DATABASE_ID`
- `KV_NAMESPACE_ID`
- optional `R2_BUCKET_NAME`
- Worker name via `NAME`

GitHub Actions run after commit `755a9cd` failed at environment setup because `JWT_SECRET` was empty.

Protected administration attempt:

`gh secret list --repo billyadult002/cloud-mail`

`gh variable list --repo billyadult002/cloud-mail`

Result: HTTP 403, `Resource not accessible by personal access token`.

Classification:

`BLOCKED_GITHUB_ACTIONS_ADMIN_TOKEN_SCOPE`

GitHub Actions is not PASS. The approved local Wrangler path remains the production deployment path until repository Actions secret/variable administration is restored.

Required workflow input classification:

- `JWT_SECRET`: `MISSING`
- `DOMAIN`: `MISSING` in the failed Actions environment; `NON_AUTHORITATIVE_UNDER_WRANGLER_PATH` for the verified local Wrangler deployment.
- `ADMIN`: `MISSING` in the failed Actions environment; `NON_AUTHORITATIVE_UNDER_WRANGLER_PATH` for the verified local Wrangler deployment.
- `CLOUDFLARE_ACCOUNT_ID`: `MISSING` in the failed Actions environment; local Wrangler account context is authoritative for the current approved deployment path.
- `CLOUDFLARE_API_TOKEN`: `MISSING` in the failed Actions environment; local Wrangler authentication is authoritative for the current approved deployment path.
- `D1_DATABASE_ID`: `MISSING` in the failed Actions environment; production D1 identity verified by Wrangler as `4c05f52d-5d8c-4fb5-9a6d-888bebf8c596`.
- `KV_NAMESPACE_ID`: `MISSING` in the failed Actions environment; deployed Worker binding verified as `78c5a7476f2b4a298779ba592eb48cc8`.
- `R2_BUCKET_NAME`: optional in workflow; deployed Worker binding verified as `cloud-mail-r2`.
- Worker identity `NAME`: `PRESENT` by workflow default as `cloud-mail`, but the Actions run is not authoritative until required secrets/vars are restored.

Deployment command under current authoritative path:

`npx --yes wrangler@4.112.0 deploy -c wrangler.toml --message "NEXORA canonical commit 755a9cd migration 0076 compatibility"`

Migration verification command:

`npx --yes wrangler@4.112.0 d1 migrations list cloud-mail --remote`

Health-check command:

`curl -i https://cloud-mail.fastonegroup.workers.dev/`

Rollback command shape:

`npx --yes wrangler@4.112.0 rollback <version-id> -c wrangler.toml --env="" --yes --message "<reason>"`

## Cloudflare Secret Name Inventory

Cloudflare secret names visible by name only:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_CONSENT_CONFIGURED`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `NEXORA_GOOGLE_OAUTH_REDIRECT_URI`
- `NEXORA_MICROSOFT_OAUTH_REDIRECT_URI`
- `PROVIDER_TOKEN_SECRET`

Still missing by name:

- `NEXORA_GOOGLE_OAUTH_CLIENT_ID`
- `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET`
- `NEXORA_MICROSOFT_OAUTH_CLIENT_ID`
- `NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET`

No secret values were read, printed, inferred, copied, or persisted.

Second closure pass confirmed the same Cloudflare secret name inventory. Canonical Google and Microsoft client ID/secret names remain absent.

## Provider Administration Discovery

Available local/connected tooling was inspected without reading credential or secret values.

Google Cloud:

- `gcloud` is installed at `/opt/homebrew/bin/gcloud`.
- No active `gcloud` account or project is configured.
- `gcloud config configurations list` reports the `default` configuration active, with no account and no project.
- `gcloud projects list` fails because no active account is selected.
- Application Default Credentials can mint an access token locally, but no account/project/authority identity was established from it without exposing credential material; ADC presence alone is not sufficient Google OAuth application administration authority.
- No authoritative Google Cloud OAuth client administration session was available.
- Available `gcloud alpha iap oauth-brands` help is IAP-specific and deprecated; it is not sufficient authority to inspect or create the required Google confidential Web OAuth client for NEXORA.
- Browser-based inspection attempt for `https://console.cloud.google.com/apis/credentials` could not start because the Playwright extension was not installed in the local Chrome profile.

Microsoft Entra:

- `az` CLI was not found.
- PowerShell / `pwsh` was not found.
- No Microsoft Graph or Entra environment variables were present by name.
- No Microsoft Entra application-registration administration tool was available.
- Microsoft Teams connector availability is not Microsoft Entra application-registration authority.
- Browser-based inspection could not be performed through Playwright for the same missing-extension reason.

Google Drive:

- Google Drive profile capability, if connected, is not Google Cloud OAuth client administration authority.

Conclusion:

- Google Provider administration remains blocked on an authoritative Google Cloud admin session.
- Microsoft Provider administration remains blocked on an authoritative Microsoft Entra admin session.
- No Provider application identity, client ID, client secret, redirect configuration, consent screen, test-user list, credential rotation, or revocation capability was fabricated.

Required next protected admin action:

- Open Google Cloud Console in an authenticated browser session with access to the owning project for NEXORA OAuth credentials, then inspect or create the confidential Web client with callback `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback`.
- Open Microsoft Entra Admin Center or Azure Portal in an authenticated browser session with app-registration authority, then inspect or create the confidential Web application with callback `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/microsoft/callback`.

Third closure pass protected-browser action:

- Opened native browser URL `https://console.cloud.google.com/apis/credentials`.
- Opened native browser URL `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`.
- Opened native browser URL `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`.

Result: protected browser surfaces were opened, but their authenticated administrative contents were not inspectable from this Codex environment. Provider authority therefore remains blocked until an authenticated admin session is available in a toolable browser/admin boundary or a Provider CLI login is completed without exposing authorization artifacts in chat.

## Provider And Authority Gates

Google Provider application authority: blocked. No authoritative Google Cloud admin surface was available in this environment.

Microsoft Provider application authority: blocked. No authoritative Microsoft Entra admin surface was available in this environment.

Domain/Tenant/Workspace authority: blocked. No authorized server-side administrative or onboarding path was available to bind a verified customer Domain to an explicit Tenant and Workspace without inference.

Real Google onboarding: not executed.

Real Microsoft onboarding: not executed.

Production exact-once provider chain: not executed beyond invalid-callback no-mutation checks.

Cross-Domain isolation: not executed because no verified Domain/Tenant/Workspace authority was established.

## Desktop And Physical iPhone Gates

Xcode Beta verified:

`DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`

`Xcode 27.0`, build `27A5194q`

Xcode MCP session defaults:

- project: not configured
- workspace: not configured
- scheme: not configured
- simulator: not configured
- device: not configured

Xcode Beta project metadata from command-scoped `xcodebuild`:

- Workspace: `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail.xcworkspace`
- Scheme: `GlassMail`
- Configuration inspected: `Release`
- Product name: `NEXORA`
- Bundle ID: `app.wangbei8554.pingguo736`
- Marketing version: `3.03`
- Current build: `357`
- Development Team: `4GGH43VE67`
- Code signing identity: `Apple Distribution`
- Provisioning profile specifier: `0855a35a-f46c-4ddf-95ca-a841a9c27bc1`
- iOS deployment target: `26.0`
- Targeted device family: `1,2`
- Supported platforms: `iphoneos iphonesimulator macosx`
- App icon: `AppIcon`

Xcode Beta physical-device discovery:

- `xcrun xctrace list devices` listed `Bill's iPhone 17 (27.0)` as offline with redacted evidence suffix `...EC0401C`.
- `xcrun xctrace list devices` also listed `CA HOME (27.0)` as offline with redacted evidence suffix `...22401E`.
- No physical-device acceptance was executed because the devices were offline and real Provider onboarding is not complete.

The initial integration-worktree-only scan found no `.xcodeproj`, `.xcworkspace`, `.ipa`, `project.pbxproj`, or Swift source file within max depth 5.

Canonical-workspace-wide Apple discovery later found the authoritative local Apple project and acceptance project under `/Users/billtin/Documents/cloudmail`:

- Main app workspace: `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail.xcworkspace`
- Main app project: `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail.xcodeproj`
- Main app project file: `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail.xcodeproj/project.pbxproj`
- Acceptance project: `/Users/billtin/Documents/cloudmail/acceptance/CloudMailDeviceAcceptance/CloudMailDeviceAcceptance.xcodeproj`
- Acceptance host: `/Users/billtin/Documents/cloudmail/acceptance/CloudMailDeviceAcceptance/Host/AcceptanceHostApp.swift`
- Acceptance tests: `/Users/billtin/Documents/cloudmail/acceptance/CloudMailDeviceAcceptance/Tests/CloudMailDeviceAcceptanceTests.swift`

Relevant IPA evidence artifacts discovered:

- `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260718b/export/NEXORA.ipa`
- `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260718b/IPA_EVIDENCE_MANIFEST.md`
- `/Users/billtin/Documents/cloudmail/artifacts/nexora-zero-touch-ipa-acceptance/export/NEXORA.ipa`
- `/Users/billtin/Documents/cloudmail/artifacts/nexora-zero-touch-ipa-acceptance/IPA_EVIDENCE_MANIFEST.md`

Strongest current Xcode Beta candidate artifact:

- IPA: `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260718b/export/NEXORA.ipa`
- SHA-256: `f537737aa7bc08bf6b23077e942809ca6825015f71a47dd4dc00e03ad65f207f`
- Size: `10007903` bytes
- Bundle ID: `app.wangbei8554.pingguo736`
- Version/build: `3.03 (357)`
- Source commit recorded in manifest: `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`
- Production backend default: `https://cloud-mail.fastonegroup.workers.dev`
- Xcode Beta: `27.0`, build `27A5194q`
- Signing team: `4GGH43VE67`
- Provisioning profile UUID: `0855a35a-f46c-4ddf-95ca-a841a9c27bc1`
- Prior classification: `XCODE_BETA_ARCHIVE_EXPORT_PASS`, `PHYSICAL_DEVICE_INSTALL_PASS`, `PHYSICAL_DEVICE_LAUNCH_PASS`, `NOT_PRODUCTION_AND_REAL_DEVICE_PASS`

Compatibility conclusion:

Build `357` is useful historical Apple evidence, but it is bound to source commit `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`, not canonical production-provider commit `755a9cd4224e1f9cebabf430b833e1485e25fb0c`. It also predates final canonical Google/Microsoft credential binding and real provider onboarding. Therefore it cannot prove authenticated physical-iPhone production acceptance for the current Mission. A successor Xcode Beta archive/export/install/acceptance pass remains required after Provider credential and Domain/Tenant/Workspace authority are established.

Desktop discovery:

- Found macOS artifact: `/Users/billtin/Documents/cloudmail/artifacts/macos/CloudMail.dmg`
- SHA-256: `23897e18cd5669fad781da7a4063f087ce6c31d55d95cffab763915e2eacaa32`
- Size: `3873813` bytes
- Timestamp: `2026-06-20 23:30:10`
- The main `GlassMail` scheme reports `macosx` as a supported platform in addition to iOS targets.

Desktop applicability conclusion:

Desktop is not `NOT_APPLICABLE_WITH_ARCHITECTURE_EVIDENCE` at this time. A Desktop-capable artifact and macOS-supported scheme exist, but no current authenticated Desktop acceptance has been run against Worker Version `8bfa8937-1d7b-4e22-9606-2ce13559f9cd`, canonical commit `755a9cd4224e1f9cebabf430b833e1485e25fb0c`, or canonical Provider cutover.

Authenticated Desktop acceptance: not executed.

Authenticated physical-iPhone acceptance: blocked by absence of completed real provider onboarding and absence of a current IPA proven compatible with commit `755a9cd`, Worker Version `8bfa8937-1d7b-4e22-9606-2ce13559f9cd`, Migration 0076, and canonical Provider credential cutover.

## Comail Applicability

Comail authority remains available:

- Repository: `https://github.com/NextOSP/comail`
- Branch: `master`
- Commit: `38960219de19812bcb8dbd562ee91974e0787737`
- Version: `0.2.22`

No overlapping Provider/OAuth/token/sync implementation was changed in this checkpoint. The only implementation action was production Worker redeployment and evidence capture. Therefore no Comail direct use, source reuse, translation, adaptation, or guided implementation was introduced.

Decision for this checkpoint: `NOT_APPLICABLE`.

## Current Result

Schema authority and Worker/D1 compatibility are materially advanced:

- Migration 0076 is committed.
- Migration 0076 checksum is recorded.
- Production D1 reports 0076 applied.
- Required base onboarding tables exist.
- Canonical commit `755a9cd` was deployed via local Wrangler.
- Active Worker Version ID is `8bfa8937-1d7b-4e22-9606-2ce13559f9cd`.
- Google and Microsoft invalid callbacks fail closed without mutation.

Final production-provider and real-device acceptance cannot pass yet because the following remain unresolved:

- `BLOCKED_GITHUB_ACTIONS_ADMIN_TOKEN_SCOPE`
- missing canonical Google client ID/secret bindings
- missing canonical Microsoft client ID/secret bindings
- no authoritative Google Cloud Provider application access
- no authoritative Microsoft Entra Provider application access
- no verified Domain/Tenant/Workspace authority binding
- no real Google onboarding
- no real Microsoft onboarding
- no authenticated Desktop acceptance
- no authenticated physical-iPhone acceptance
- no production-safe negative matrix beyond invalid callbacks
- no final rollback/restoration after provider cutover

Final verdict remains:

`LOGIC_COMPLETE_PARTIAL`

## 2026-07-19 Xcode Beta Build 358 And Physical-Device Session Recovery Evidence

This checkpoint is additive evidence only. It does not modify implementation files, Provider configuration, Cloudflare secrets, production data, Mission Runtime state, or the preserved Callback Mission verdict.

Canonical implementation branch bindings were rechecked before this evidence update:

- `origin/main`: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`
- `origin/codex/nexora-production-integration-5d7024d`: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`
- Evidence branch parent remains the canonical implementation commit.

Xcode Beta environment:

- `DEVELOPER_DIR`: `/Applications/Xcode-beta.app/Contents/Developer`
- `xcodebuild -version`: `Xcode 27.0`, build `27A5194q`
- Workspace: `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail.xcworkspace`
- Scheme: `GlassMail`
- Configuration: `Release`
- Destination: `generic/platform=iOS`
- Signing mode: manual
- Team: `4GGH43VE67`
- Provisioning profile specifier: `0855a35a-f46c-4ddf-95ca-a841a9c27bc1`
- Build number override: `CURRENT_PROJECT_VERSION=358`

Build 358 archive and export:

- Archive: `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260719-build358-223025/NEXORA.xcarchive`
- IPA: `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260719-build358-223025/export/NEXORA.ipa`
- IPA SHA-256: `8d2bbe7f483f3caeac9765d21ea3bf5c44277c098d9042f4767f9311fb2798e9`
- IPA size: `10007898` bytes
- IPA timestamp from local filesystem: `Jul 18 22:33:10 2026`
- Export result: `** EXPORT SUCCEEDED **`

Archive identity:

- App bundle exists at archive path.
- `CFBundleIdentifier`: `app.wangbei8554.pingguo736`
- `CFBundleName`: `NEXORA`
- `CFBundleShortVersionString`: `3.03`
- `CFBundleVersion`: `358`
- Code signature format: app bundle with Mach-O thin `arm64`
- Signing authority: `Apple Distribution: jian sun (4GGH43VE67)`
- Team identifier: `4GGH43VE67`
- Entitlements observed: `application-identifier`, `com.apple.developer.team-identifier`, `get-task-allow=false`

Production backend binding in the Apple source remains:

- `/Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Services/AppState.swift`
- Default `serverURL`: `https://cloud-mail.fastonegroup.workers.dev`
- Fallback `serverURL`: `https://cloud-mail.fastonegroup.workers.dev`

Physical-device session recovery:

- `devicectl list devices` reported the target iPhone as available, paired, physical, booted, and running iOS 27.0.
- Raw device identifiers are intentionally not recorded in this evidence report.
- `devicectl device install app` installed bundle `app.wangbei8554.pingguo736` successfully.
- `devicectl device process launch` launched bundle `app.wangbei8554.pingguo736` successfully.

Viewport evidence:

- Screenshot 1: `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260719-build358-223025/iphone17-launch-screenshot.png`
- Screenshot 1 SHA-256: `2ba61f99f42eb13a0a795a8b2162317cd23b4fd2212d7a88e2377adac3249dd7`
- Screenshot 2: `/Users/billtin/Documents/cloudmail/artifacts/nexora-xcode-beta-candidate-20260719-build358-223025/iphone17-launch-screenshot-2.png`
- Screenshot 2 SHA-256: `2ba61f99f42eb13a0a795a8b2162317cd23b4fd2212d7a88e2377adac3249dd7`
- Dimensions: `1320x2868`
- Both screenshots were fully black. This is not accepted as functional viewport evidence.

Provider-admin session status:

- `gcloud` is installed, but no active Google account or project was returned by local status commands.
- Azure CLI was not found.
- PowerShell was not found.
- Provider-admin console inspection remains blocked without an inspectable authenticated admin session.
- No OAuth client, redirect URI, Provider registration, or Cloudflare secret mutation was performed in this checkpoint.

Physical-device acceptance conclusion:

- `XCODE_BETA_ARCHIVE_EXPORT_PASS`: build 358 archive and IPA export succeeded.
- `PHYSICAL_DEVICE_INSTALL_PASS`: build 358 installed on a paired physical iPhone.
- `PHYSICAL_DEVICE_LAUNCH_COMMAND_PASS`: build 358 launch command succeeded.
- `FUNCTIONAL_VIEWPORT_ACCEPTANCE_BLOCKED`: screenshots are black and cannot prove visible UI readiness.
- `AUTHENTICATED_PROVIDER_ACCEPTANCE_BLOCKED`: canonical Google/Microsoft Provider credentials and admin confirmation remain unresolved.
- `REAL_ONBOARDING_ACCEPTANCE_BLOCKED`: no real Google or Microsoft onboarding was completed.

This checkpoint improves Apple real-device evidence from "offline" to "install and launch command succeeded", but it still does not satisfy authenticated real-device production acceptance.

Final verdict remains:

`LOGIC_COMPLETE_PARTIAL`
