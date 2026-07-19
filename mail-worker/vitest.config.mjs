// Vitest config for the RC / reliability suites (RC-1 routing, RC-2 classify, RC-5 backfill,
// outbound state). Uses @cloudflare/vitest-pool-workers (already a devDependency) so the
// tests execute inside the Workers runtime, which is required because the service module
// imports `cloudflare:sockets`.
//
// RUN ON YOUR MAC — not the Linux analysis sandbox: pool-workers needs a platform-matched
// workerd binary. Authored + syntax-checked 2026-07-03; not executed in-sandbox.
//   npm run test:rc     (== vitest run scripts/reliability-tests)
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.toml' },
		}),
	],
	test: {
		include: ['scripts/reliability-tests/**/*.test.mjs'],
	},
});
