# ADR-007: Dependency Resolution and Production Containment

Status: Accepted for the Checkpoint 4 release candidate (2026-07-22).

## Context

A clean `npm ci` on base `066ffb2515187b56ceb9fa2e3015c8ff594aefc1` reproduced GHSA-f88m-g3jw-g9cj through three paths: `@cloudflare/vitest-pool-workers -> miniflare -> sharp`, `wrangler -> miniflare -> sharp`, and the unused production dependency `@cloudflare/vite-plugin -> miniflare -> sharp`. The canonical lock resolved Miniflare 4.20260708.1 and sharp 0.34.5. npm represented the single sharp advisory as five high-severity affected package nodes.

`sharp`, Miniflare, Wrangler, and the Vite plugin were absent from the Wrangler dry-run Worker bundle. They are build/test tooling, not Worker-runtime reachable. The Vite plugin had no source or configuration reference and was incorrectly classified as a production dependency.

## Decision

- Remove unused `@cloudflare/vite-plugin`.
- Add a narrow npm override from Miniflare's vulnerable sharp 0.34.5 pin to sharp 0.35.3.
- Do not downgrade Wrangler or the Vitest pool to npm audit's misleading older suggestions.
- Do not run `npm audit fix --force`.

Clean install resolves Miniflare 4.20260708.1 with sharp 0.35.3. `npm audit --json` reports zero vulnerabilities; focused and complete Worker reliability tests and the production dry-run build pass.

## Compatibility and rollback

The override changes a build/test-only native image dependency across a minor version. Compatibility is proven for the repository's actual Miniflare/Vitest and Wrangler build paths, but not for arbitrary direct Miniflare image-processing use. Rollback is one package/lockfile revert; doing so reopens GHSA-f88m-g3jw-g9cj and blocks production readiness.

The repository has no declared project license, and the inventory helper flags existing license ambiguity, including direct `ua-parser-js`. No new runtime dependency was added. Legal/license ownership remains an explicit non-security follow-up and must not be represented as resolved by this ADR.
