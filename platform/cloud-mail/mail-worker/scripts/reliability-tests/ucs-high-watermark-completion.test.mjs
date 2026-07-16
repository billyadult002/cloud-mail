// UCS High-Watermark Completion tests (flag-gated).
// Unit: pure scope/freeze helpers. Integration: drive the real runWorkspace /
// parityWorkspace control flow with a capturing D1 stub (empty result sets, so
// processRow is never reached) and assert query shape + commit binds.
import { describe, expect, it } from 'vitest';
import backfill, {
	runWorkspace, parityWorkspace, rematerializeWorkspaceV3, watermarkScope, shouldFreezeWatermark, hwmEnabled
} from '../../src/service/unified-conversation-backfill-service.js';

// ---------- Unit: pure helpers ----------
describe('high-watermark helpers (unit)', () => {
	it('hwmEnabled reflects the flag', () => {
		expect(hwmEnabled({ UCS_HWM_COMPLETION_ENABLED: 'true' })).toBe(true);
		expect(hwmEnabled({ UCS_HWM_COMPLETION_ENABLED: 'false' })).toBe(false);
		expect(hwmEnabled({})).toBe(false);
		expect(hwmEnabled(undefined)).toBe(false);
	});

	it('shouldFreezeWatermark is true only when no watermark is set (write-once)', () => {
		expect(shouldFreezeWatermark({ high_watermark: null })).toBe(true);
		expect(shouldFreezeWatermark({ high_watermark: '' })).toBe(true);
		expect(shouldFreezeWatermark({})).toBe(true);
		expect(shouldFreezeWatermark({ high_watermark: '100' })).toBe(false);
		expect(shouldFreezeWatermark({ high_watermark: 0 })).toBe(false); // 0 is a frozen value
	});

	it('watermarkScope emits <=W predicates only when enabled', () => {
		const on = watermarkScope(100, true);
		expect(on.forward).toBe(' AND e.email_id<=100');
		expect(on.outbox).toBe(' AND source_message_id<=100');
		expect(on.failures).toContain("source_ref NOT LIKE 'email:%'");
		expect(on.failures).toContain('<=100');
		const off = watermarkScope(100, false);
		expect(off).toEqual({ forward: '', outbox: '', failures: '' });
	});

	it('watermarkScope coerces non-numeric W to 0 (injection-safe)', () => {
		expect(watermarkScope("100; DROP TABLE x", true).forward).toBe(' AND e.email_id<=0');
	});
});

// ---------- Integration harness: capturing D1 stub ----------
function makeDb(resolver) {
	const calls = [];
	const prepare = (sql) => {
		let args = [];
		const api = {
			bind(...a) { args = a; return api; },
			async all() { calls.push({ sql, args, m: 'all' }); return resolver(sql, 'all') ?? { results: [] }; },
			async first() { calls.push({ sql, args, m: 'first' }); return resolver(sql, 'first') ?? null; },
			async run() { calls.push({ sql, args, m: 'run' }); return resolver(sql, 'run') ?? { meta: { changes: 1 } }; }
		};
		return api;
	};
	return { db: { prepare }, calls };
}

function backfillResolver(checkpoint) {
	return (sql, m) => {
		if (m === 'run') return { meta: { changes: 1 } };
		if (m === 'first') {
			if (sql.includes('SELECT * FROM conversation_materialization_checkpoints WHERE id=?1 AND lease_owner=?2')) return checkpoint;
			if (sql.includes('COALESCE(MAX(e.email_id),0) hw')) return { hw: 100 };              // freeze snapshot
			if (sql.includes('COALESCE(MAX(e.email_id),0) high_watermark')) return { high_watermark: 100 }; // legacy capture
			return null;
		}
		return { results: [] }; // retry / invalidHistorical / forward => no rows => processRow never called
	};
}

const find = (calls, re) => calls.find(c => re.test(c.sql));

describe('runWorkspace high-watermark (integration, empty scope)', () => {
	const scope = { tenantId: 1, workspaceId: 2, limit: 5 };

	it('flag ON, fresh checkpoint: freezes W once, scopes forward <=W, commits frozen W, latches ready', async () => {
		const cp = { id: 'ucs-checkpoint:1:2', cursor_json: '{"email_id":0}', high_watermark: null, lease_generation: 1, lease_owner: 'o', state: 'running' };
		const { db, calls } = makeDb(backfillResolver(cp));
		const res = await runWorkspace({ UCS_HWM_COMPLETION_ENABLED: 'true', db }, scope);

		// write-once freeze UPDATE issued
		expect(find(calls, /SET high_watermark=\?1,updated_at.*high_watermark IS NULL OR high_watermark=''/)).toBeTruthy();
		// forward query is watermark-scoped
		const fwd = find(calls, /AND e\.email_id>\?3 AND e\.email_id<=100 ORDER BY e\.email_id/);
		expect(fwd).toBeTruthy();
		// commit preserves the FROZEN watermark (not a live max) and latches ready (no rows)
		const commit = find(calls, /SET cursor_json=\?1,high_watermark=\?2/);
		expect(commit.args[1]).toBe('100');   // frozen W
		expect(commit.args[5]).toBe('ready'); // latched
		expect(res.ready).toBe(true);
		expect(res.highWatermark).toBe(100);
	});

	it('flag ON, second run (W already frozen): does NOT re-freeze; forward still <=W; ready holds under live growth', async () => {
		const cp = { id: 'ucs-checkpoint:1:2', cursor_json: '{"email_id":100}', high_watermark: '100', lease_generation: 7, lease_owner: 'o', state: 'ready' };
		const { db, calls } = makeDb(backfillResolver(cp));
		const res = await runWorkspace({ UCS_HWM_COMPLETION_ENABLED: 'true', db }, scope);

		// no freeze snapshot SELECT, no write-once UPDATE (watermark immutable)
		expect(find(calls, /COALESCE\(MAX\(e\.email_id\),0\) hw/)).toBeFalsy();
		expect(find(calls, /SET high_watermark=\?1,updated_at/)).toBeFalsy();
		// forward remains bounded to the frozen W; a live row >100 could never enter scope
		expect(find(calls, /AND e\.email_id>\?3 AND e\.email_id<=100 ORDER BY/)).toBeTruthy();
		const commit = find(calls, /SET cursor_json=\?1,high_watermark=\?2/);
		expect(commit.args[1]).toBe('100'); // watermark unchanged
		expect(res.ready).toBe(true);
	});

	it('flag OFF: legacy behavior — no freeze, unscoped forward, live-max capture', async () => {
		const cp = { id: 'ucs-checkpoint:1:2', cursor_json: '{"email_id":0}', high_watermark: null, lease_generation: 1, lease_owner: 'o', state: 'running' };
		const { db, calls } = makeDb(backfillResolver(cp));
		await runWorkspace({ db }, scope); // flag absent => off

		expect(find(calls, /SET high_watermark=\?1,updated_at.*high_watermark IS NULL/)).toBeFalsy();
		expect(find(calls, /AND e\.email_id<=100 ORDER BY/)).toBeFalsy();      // no <=W scope
		expect(find(calls, /AND e\.email_id>\?3 ORDER BY e\.email_id/)).toBeTruthy(); // unscoped forward
		expect(find(calls, /COALESCE\(MAX\(e\.email_id\),0\) high_watermark/)).toBeTruthy(); // legacy live-max capture
	});
});

describe('parityWorkspace watermark scope (integration)', () => {
	const scope = { tenantId: 1, workspaceId: 2 };
	const parityResolver = (sql, m) => {
		if (m === 'run') return { meta: { changes: 1 } };
		if (m === 'all') return { results: [] };
		if (sql.includes("state='ready'") && sql.includes('SELECT high_watermark FROM conversation_materialization_checkpoints')) return { high_watermark: 100 };
		if (sql.includes('cutover_epoch')) return { cutover_epoch: 0 };
		return { count: 0 };
	};

	it('flag ON: failures and outbox counts are scoped to <=W', async () => {
		const { db, calls } = makeDb(parityResolver);
		const res = await parityWorkspace({ UCS_HWM_COMPLETION_ENABLED: 'true', db }, scope);
		const failures = find(calls, /conversation_pipeline_failures WHERE .* resolved_at IS NULL/);
		const outbox = find(calls, /conversation_ingest_outbox WHERE .* state!='processed'/);
		expect(failures.sql).toContain("source_ref NOT LIKE 'email:%'");
		expect(failures.sql).toContain('<=100');
		expect(outbox.sql).toContain('source_message_id<=100');
		expect(res.passed).toBe(true); // all counts zero
	});

	it('flag OFF: failures and outbox counts are unscoped (legacy)', async () => {
		const { db, calls } = makeDb(parityResolver);
		await parityWorkspace({ db }, scope);
		const failures = find(calls, /conversation_pipeline_failures WHERE .* resolved_at IS NULL/);
		const outbox = find(calls, /conversation_ingest_outbox WHERE .* state!='processed'/);
		expect(failures.sql).not.toContain('source_ref NOT LIKE');
		expect(outbox.sql).not.toContain('source_message_id<=');
	});
});

function v3Resolver(checkpoint) {
	return (sql, m) => {
		if (m === 'run') return { meta: { changes: 1 } };
		if (m === 'first') {
			if (sql.includes('SELECT * FROM conversation_materialization_checkpoints WHERE id=?1 AND lease_owner=?2')) return checkpoint;
			if (sql.includes('SELECT state FROM conversation_materialization_checkpoints WHERE id=?1')) return { state: 'paused' };
			if (sql.includes('created_at,id FROM conversation_aggregates') && sql.includes('ORDER BY created_at DESC')) return { created_at: '2026-07-16 13:00:00', id: 'conversation:zzz' };
			return null;
		}
		return { results: [] }; // vrows / legacy rows => empty => materialize never called
	};
}

describe('rematerializeWorkspaceV3 high-watermark (integration)', () => {
	const scope = { tenantId: 1, workspaceId: 2, limit: 5 };

	it('flag ON, fresh: freezes composite (created_at,id) W, resets cursor, scopes by composite, latches ready', async () => {
		const cp = { id: 'ucs-projection-rematerialize-v3:1:2', cursor_json: '{"conversation_id":""}', high_watermark: null, lease_generation: 97, lease_owner: 'o', state: 'running' };
		const { db, calls } = makeDb(v3Resolver(cp));
		const res = await rematerializeWorkspaceV3({ UCS_HWM_COMPLETION_ENABLED: 'true', db }, scope);

		// freeze snapshot query + write-once UPDATE that also RESETS the cursor to composite start
		expect(find(calls, /created_at,id FROM conversation_aggregates.*ORDER BY created_at DESC,id DESC LIMIT 1/)).toBeTruthy();
		const freeze = find(calls, /SET high_watermark=\?1,cursor_json=\?2.*high_watermark IS NULL OR high_watermark=''/);
		expect(freeze).toBeTruthy();
		expect(freeze.args[0]).toBe('2026-07-16 13:00:00|conversation:zzz'); // W = (ts|id)
		expect(freeze.args[1]).toBe(JSON.stringify({ cts: '', cid: '' }));   // cursor reset for full re-materialization
		// composite scope on the fetch
		const fetch = find(calls, /SELECT id,created_at FROM conversation_aggregates/);
		expect(fetch.sql).toMatch(/created_at>\?3 OR \(created_at=\?3 AND id>\?4\)/);
		expect(fetch.sql).toMatch(/created_at<\?5 OR \(created_at=\?5 AND id<=\?6\)/);
		expect(res.ready).toBe(true);
		expect(res.highWatermark).toContain('|');
	});

	it('flag ON, second run (W frozen): no re-freeze; composite scope preserved; ready holds', async () => {
		const cp = { id: 'ucs-projection-rematerialize-v3:1:2', cursor_json: '{"cts":"2026-07-16 12:00:00","cid":"conversation:mmm"}', high_watermark: '2026-07-16 13:00:00|conversation:zzz', lease_generation: 98, lease_owner: 'o', state: 'running' };
		const { db, calls } = makeDb(v3Resolver(cp));
		const res = await rematerializeWorkspaceV3({ UCS_HWM_COMPLETION_ENABLED: 'true', db }, scope);

		expect(find(calls, /ORDER BY created_at DESC,id DESC LIMIT 1/)).toBeFalsy();       // no freeze snapshot
		expect(find(calls, /SET high_watermark=\?1,cursor_json=\?2/)).toBeFalsy();          // no re-freeze
		const fetch = find(calls, /SELECT id,created_at FROM conversation_aggregates/);
		expect(fetch.args[2]).toBe('2026-07-16 12:00:00'); // cursor cts bound
		expect(fetch.args[3]).toBe('conversation:mmm');    // cursor cid bound
		expect(res.ready).toBe(true);
	});

	it('flag OFF: legacy id-ordered path unchanged (no composite scope, no freeze)', async () => {
		const cp = { id: 'ucs-projection-rematerialize-v3:1:2', cursor_json: '{"conversation_id":"conversation:aaa"}', high_watermark: null, lease_generation: 97, lease_owner: 'o', state: 'running' };
		const { db, calls } = makeDb(v3Resolver(cp));
		await rematerializeWorkspaceV3({ db }, scope); // flag off

		expect(find(calls, /SET high_watermark=\?1,cursor_json=\?2/)).toBeFalsy();
		expect(find(calls, /SELECT id,created_at FROM conversation_aggregates/)).toBeFalsy(); // no composite fetch
		expect(find(calls, /SELECT id FROM conversation_aggregates WHERE .* id>\?3 ORDER BY id LIMIT/)).toBeTruthy(); // legacy fetch
	});
});
