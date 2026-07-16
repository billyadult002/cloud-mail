// Durable outbound send coordinator (WF-4 / WP-A).
// Wraps the provider send with an idempotency claim + delivery state machine so
// a transient provider failure retries (with backoff) instead of losing the
// message, and a client double-submit collapses to a single send.
//
// Persistence: `outbound_messages` (0013). Retry drain: `send_queue` payloads +
// outbound_messages.next_attempt_at, invoked from the scheduler.

import { OutboundStatus, MAX_ATTEMPTS, planAfterFailure, deriveIdempotencyKey } from './outbound-state';
import deliveryLedgerService, { DeliveryLedgerState } from './delivery-ledger-service';
import { createWorkerBudget, boundedNumber } from './worker-budget';

async function sha256Hex(value) {
	const bytes = new TextEncoder().encode(String(value || ''));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

const outboundService = {
	// Resolve/hash the idempotency key for a send request.
	async resolveKey(params, userId) {
		const raw = params.idempotencyKey || deriveIdempotencyKey(params);
		return sha256Hex(`${userId}:${raw}`);
	},

	// Attempt to claim a send. Returns:
	//  { claimed:true, id }                    -> caller should perform the send
	//  { claimed:false, replay:true, row }     -> already sent; return prior result
	//  { claimed:false, inflight:true, row }   -> a concurrent send is in progress
	async claim(c, userId, accountId, key) {
		// Try to insert a fresh claim. UNIQUE(user_id, idempotency_key) makes this
		// the atomic gate.
		const insert = await c.env.db.prepare(
			`INSERT INTO outbound_messages (user_id, account_id, idempotency_key, status, attempts)
			 VALUES (?1, ?2, ?3, 'sending', 1)
			 ON CONFLICT(user_id, idempotency_key) DO NOTHING`
		).bind(userId, accountId, key).run();

		if (insert.meta?.changes > 0) {
			const id = insert.meta.last_row_id;
			await deliveryLedgerService.record(c, {
				outboundId: id,
				userId,
				accountId,
				state: DeliveryLedgerState.CREATED,
				metadata: { idempotency: 'claimed' }
			});
			await deliveryLedgerService.record(c, {
				outboundId: id,
				userId,
				accountId,
				state: DeliveryLedgerState.QUEUED,
				metadata: { status: 'sending' }
			});
			const createdRow = await c.env.db.prepare(
				`SELECT * FROM outbound_messages WHERE id = ?1 LIMIT 1`
			).bind(id).first();
			return { claimed: true, id, row: createdRow || { id, user_id: userId, account_id: accountId, status: 'sending', attempts: 1 } };
		}

		// Conflict: a record already exists. Inspect it.
		const row = await c.env.db.prepare(
			`SELECT * FROM outbound_messages WHERE user_id = ?1 AND idempotency_key = ?2 LIMIT 1`
		).bind(userId, key).first();

		if (!row) return { claimed: true, id: null }; // race lost then vanished; proceed
		if (row.status === OutboundStatus.SENT) return { claimed: false, replay: true, row };
		if (row.status === OutboundStatus.DEAD || Number(row.attempts || 0) >= MAX_ATTEMPTS) {
			await c.env.db.prepare(
				`UPDATE outbound_messages
				    SET status = 'dead', updated_at = CURRENT_TIMESTAMP
				  WHERE id = ?1`
			).bind(row.id).run();
			return { claimed: false, dead: true, row: { ...row, status: OutboundStatus.DEAD } };
		}
		if (row.status === OutboundStatus.SENDING) {
			// A worker can die after claiming but before marking the provider
			// result. Do not leave the idempotency key permanently wedged; reclaim
			// only after a conservative lease window and keep the attempt counter.
			const reclaimed = await c.env.db.prepare(
				`UPDATE outbound_messages
				    SET status = 'sending', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
				  WHERE id = ?1 AND status = 'sending'
				    AND updated_at <= datetime('now', '-10 minutes')`
			).bind(row.id).run();
			if (reclaimed.meta?.changes > 0) {
				const updatedRow = await c.env.db.prepare(`SELECT * FROM outbound_messages WHERE id = ?1 LIMIT 1`).bind(row.id).first();
				return { claimed: true, id: row.id, row: updatedRow || { ...row, attempts: Number(row.attempts || 0) + 1 }, reclaimed: true, leaseExpired: true };
			}
			return { claimed: false, inflight: true, row };
		}
		// retry/queued/dead → re-claim for another attempt (bump attempts).
		await c.env.db.prepare(
			`UPDATE outbound_messages
			    SET status = 'sending', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
			  WHERE id = ?1`
		).bind(row.id).run();
		const updatedRow = await c.env.db.prepare(
			`SELECT * FROM outbound_messages WHERE id = ?1 LIMIT 1`
		).bind(row.id).first();
		return { claimed: true, id: row.id, row: updatedRow || { ...row, attempts: Number(row.attempts || 0) + 1 }, reclaimed: true };
	},

	async markSent(c, id, emailId, externalMessageId, options = {}) {
		if (!id) return;
		await c.env.db.prepare(
			`UPDATE outbound_messages
			    SET status = 'sent', email_id = ?2, external_message_id = ?3,
			        last_error = NULL, updated_at = CURRENT_TIMESTAMP
			  WHERE id = ?1`
		).bind(id, emailId || null, externalMessageId || null).run();
		await deliveryLedgerService.record(c, {
			outboundId: id,
			userId: options.userId,
			accountId: options.accountId,
			state: DeliveryLedgerState.PROVIDER_ACCEPTED,
			provider: options.provider || null,
			providerMessageId: externalMessageId || null,
			attempt: options.attempt || 1,
			metadata: { emailId }
		});
		if (options.delivered) {
			await deliveryLedgerService.record(c, {
				outboundId: id,
				userId: options.userId,
				accountId: options.accountId,
				state: DeliveryLedgerState.DELIVERED,
				provider: options.provider || null,
				providerMessageId: externalMessageId || null,
				attempt: options.attempt || 1,
				metadata: { emailId, deliveryEvidence: options.deliveryEvidence || 'internal_or_provider_confirmed' }
			});
		}
	},

	// Record a failure and schedule retry or mark dead per the state machine.
	async markFailure(c, id, attempts, error, payloadForRetry) {
		if (!id) return { status: OutboundStatus.DEAD };
		const plan = planAfterFailure(attempts, error);
		const nextAt = plan.status === OutboundStatus.RETRY
			? Math.floor(Date.now() / 1000) + Math.ceil(plan.delayMs / 1000)
			: 0;
		await c.env.db.prepare(
			`UPDATE outbound_messages
			    SET status = ?2, last_error = ?3, next_attempt_at = ?4, updated_at = CURRENT_TIMESTAMP
			  WHERE id = ?1`
		).bind(id, plan.status, String(error?.message || error).slice(0, 300), nextAt).run();
		await deliveryLedgerService.record(c, {
			outboundId: id,
			userId: payloadForRetry?.userId,
			accountId: payloadForRetry?.accountId,
			state: plan.status === OutboundStatus.RETRY ? DeliveryLedgerState.RETRY : DeliveryLedgerState.FAILED,
			attempt: attempts,
			errorClass: plan.status,
			errorMessage: String(error?.message || error).slice(0, 300),
			metadata: { retryDelayMs: plan.delayMs }
		});

		// Enqueue the retry payload so the drain has what it needs to resend.
		if (plan.status === OutboundStatus.RETRY && payloadForRetry) {
			await c.env.db.prepare(
				`INSERT INTO send_queue (user_id, account_id, payload_json, scheduled_at, status)
				 VALUES (?1, ?2, ?3, ?4, 'scheduled')`
			).bind(
				payloadForRetry.userId,
				payloadForRetry.accountId,
				JSON.stringify({ ...payloadForRetry, outboundId: id }),
				nextAt,
				'scheduled'
			).run();
		}
		return plan;
	},

	// Drain due retries. `sendFn(c, payload, userId)` performs an actual send.
	// Bounded per invocation so the cron stays within budget.
	async drain(c, sendFn, limitOrOptions = 10) {
		const options = typeof limitOrOptions === 'object' && limitOrOptions !== null ? limitOrOptions : {};
		const limit = boundedNumber(
			typeof limitOrOptions === 'number' ? limitOrOptions : options.limit,
			10,
			1,
			25
		);
		const budget = createWorkerBudget({
			maxItems: limit,
			maxMs: c.env?.OUTBOUND_DRAIN_BUDGET_MS || options.maxMs || 20000
		});
		const now = Math.floor(Date.now() / 1000);
		const due = await c.env.db.prepare(
			`SELECT * FROM send_queue
			  WHERE status = 'scheduled' AND scheduled_at <= ?1
			  ORDER BY scheduled_at ASC LIMIT ?2`
		).bind(now, limit).all();
		const rows = due?.results || [];
		let sent = 0, failed = 0, skippedDueToBudget = 0;
		for (const q of rows) {
			if (!budget.canContinue()) {
				skippedDueToBudget += 1;
				continue;
			}
			budget.consume();
			let payload;
			try { payload = JSON.parse(q.payload_json); } catch { payload = null; }
			if (!payload) {
				await c.env.db.prepare(`UPDATE send_queue SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(q.id).run();
				continue;
			}
			await c.env.db.prepare(`UPDATE send_queue SET status='sending', updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(q.id).run();
			try {
				await sendFn(c, { ...payload, _fromRetry: true }, payload.userId);
				await c.env.db.prepare(`UPDATE send_queue SET status='sent', updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(q.id).run();
				sent += 1;
			} catch (e) {
				failed += 1;
				await c.env.db.prepare(
					`UPDATE send_queue SET status='failed', failure_code=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?1`
				).bind(q.id, String(e?.message || e).slice(0, 120)).run();
			}
		}
		return { drained: rows.length, sent, failed, skippedDueToBudget, budget: budget.snapshot() };
	}
};

export default outboundService;
