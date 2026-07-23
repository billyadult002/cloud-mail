# Checkpoint 4 Dependency Inventory

Generated: 2026-07-22
Package manager: npm 10.9.8
Runtime: Node 22.22.3, Darwin arm64

## Security-relevant graph

Before:

```text
@cloudflare/vite-plugin@1.44.0 -> miniflare@4.20260708.1 -> sharp@0.34.5
@cloudflare/vitest-pool-workers@0.18.4 -> miniflare@4.20260708.1 -> sharp@0.34.5
wrangler@4.110.0 -> miniflare@4.20260708.1 -> sharp@0.34.5
```

After:

```text
@cloudflare/vitest-pool-workers@0.18.4 -> miniflare@4.20260708.1 -> sharp@0.35.3 (override)
wrangler@4.110.0 -> miniflare@4.20260708.1 -> sharp@0.35.3 (override)
@cloudflare/vite-plugin: removed (no repository use)
```

Clean `npm ci` installs 155 packages and audits 156. Final npm audit metadata: production 76, development 181, optional 110, total graph 256; vulnerabilities 0.

## Production reachability

Wrangler dry-run bundle size: 2257.02 KiB upload / 487.71 KiB gzip, including static assets. Bundle marker scan found no sharp, libvips, Miniflare, or Wrangler package dependency. These packages remain local build/test tooling and are not Worker-runtime reachable.

## License review

No dependency is added. Removing the unused Vite plugin reduces dependency surface. Existing direct `ua-parser-js` licensing and the repository's absent declared project license remain legal-review items; this mission does not suppress or resolve them. Comail is AGPL-3.0 and no Comail code or dependency is incorporated.
