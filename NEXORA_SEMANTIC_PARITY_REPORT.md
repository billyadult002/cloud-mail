# NEXORA Semantic Parity Report

Date: 2026-07-18

Integration branch: `codex/nexora-production-integration-5d7024d`

Remote-main base: `a7b45d0242dad22c638564bed6589c547b19f807`

Immutable source checkpoint: `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`

## Parity Result

Semantic parity with the immutable NEXORA checkpoint is preserved for the transplanted NEXORA outcome:

- Callback correlation: preserved by `nexora-onboarding-callback-recovery-service.js` and related migrations.
- Token authority: preserved by fenced token storage, token exchange, refresh scheduler, token lifecycle, and binding migrations.
- Provider connection: preserved by provider outcome, connection generation, and token-connection binding logic.
- Evidence delivery: preserved by evidence outbox service and lease/fence migrations.
- Verification: preserved by callback verifier authority, attempts, verified results, and finalization services.
- Finalization: preserved by durable mission runtime and callback finalization tests.
- Reauthorization: preserved by replacement authorization session/correlation work and completion result tables.
- Correlation consumption: preserved by exact-once correlation consumption results.
- Mission continuation: preserved by mission continuation result identity and resume checkpoint behavior.
- Initial Sync: preserved by initial sync intent, dispatch, job, and background sync logic.
- Operational visibility: preserved by mission runtime status API and service.
- Exact-once behavior: preserved by idempotency keys, unique result tables, fences, generations, and retry semantics.
- Restart and takeover safety: preserved by lease expiry, owner, fencing token, and takeover tests.

## Conflict Resolutions

- `mail-worker/src/index.js`: retained remote-main entrypoint to avoid importing unrelated checkpoint-era services. NEXORA API route registration was added through `mail-worker/src/hono/webs.js`.
- `mail-worker/vitest.config.js`: deleted because it referenced missing `wrangler.jsonc`; checkpoint `vitest.config.mjs` is used instead.
- `mail-worker/package.json` and `mail-worker/package-lock.json`: checkpoint baseline adopted to run reviewed test commands and dependency versions.
- `mail-worker/wrangler.toml`: checkpoint baseline adopted for reviewed D1/KV/R2 bindings and Worker identity.
- `mail-worker/src/service/email-service.js`: remote-main service retained; only send-contract hardening was added.

## Verification

- `npm test`: PASS.
- `npm run test:rc`: PASS, 13 files / 141 tests.
- `git diff --check`: PASS.
- `npm ls --omit=dev --depth=0`: PASS.
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities.
- Migration `0075` checksum: `f28c468954d164d13603d233baecc4fd6975505066c980f05e0c71188cc973e1`.

The previous unrelated-history focused 69-test and complete 512-test evidence remains external evidence for immutable checkpoint `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`; this integration branch records its own remote-main-layout gate as 13 files / 141 tests because only the reviewed NEXORA transplant and closure files are present.
