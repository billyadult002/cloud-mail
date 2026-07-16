import { resolveCapabilities, CapabilityStatus } from './gmail-capability-engine';

export async function evaluateHealth(c, userId, accountId) {
	let score = 100;
	const deductions = [];
	const timeline = [];

	try {
		const account = await c.env.db.prepare(
			`SELECT * FROM account WHERE user_id = ?1 AND account_id = ?2 AND is_del = 0 LIMIT 1`
		).bind(userId, accountId).first();

		if (!account) {
			return {
				score: 0,
				explanation: 'Account not found.',
				timeline: [{ timestamp: new Date().toISOString(), status: 'error', detail: 'Account does not exist.' }]
			};
		}

		// 1. Evaluate Capability Statuses
		const caps = await resolveCapabilities(c, userId, accountId);
		let capsFailCount = 0;
		for (const key of Object.keys(caps)) {
			if (caps[key] === CapabilityStatus.FAIL) capsFailCount++;
		}
		if (capsFailCount > 0) {
			const deduct = Math.min(capsFailCount * 15, 40);
			score -= deduct;
			deductions.push(`Missing critical capability support (${capsFailCount} failed)`);
		}

		// 2. Evaluate OAuth Connection Health
		const rawStatus = String(account.sync_status || '').toLowerCase();
		if (rawStatus === 'needs_reconnect' || rawStatus === 'legacy_imap_unsupported') {
			score -= 40;
			deductions.push('OAuth re-authentication required');
		}

		// 3. Evaluate Sync Health
		const attempts = Number(account.sync_attempts || 0);
		if (attempts > 0) {
			score -= Math.min(attempts * 5, 20);
			deductions.push(`Failing sync attempts (failed: ${attempts})`);
		}

		// 4. Evaluate Import / Backfill Health
		if (rawStatus === 'first_import_failed') {
			score -= 20;
			deductions.push('Initial mailbox import failed');
		} else if (account.backfill_done !== 1) {
			score -= 10;
			deductions.push('Initial backfill/import pending');
		}

		score = Math.max(0, Math.min(100, score));

		const explanation = deductions.length > 0
			? `Mailbox has warnings: ${deductions.join(', ')}.`
			: 'Mailbox is completely healthy and ready.';

		timeline.push({
			timestamp: new Date().toISOString(),
			status: score >= 90 ? 'healthy' : (score >= 50 ? 'warning' : 'critical'),
			detail: explanation
		});

		return {
			score,
			explanation,
			timeline
		};
	} catch (e) {
		return {
			score: 0,
			explanation: `Health evaluation error: ${e.message}`,
			timeline: [{ timestamp: new Date().toISOString(), status: 'error', detail: e.message }]
		};
	}
}
