import { describe, expect, it } from 'vitest';
import gmailPlatformV2Service from '../../src/service/gmail-platform-v2-service.js';

describe('Gmail Platform V2 REST-only decoupled architecture', () => {
	it('maps architecture inventory and migration plan without new IMAP primary runtime', () => {
		const inventory = gmailPlatformV2Service.architectureInventory();
		const plan = gmailPlatformV2Service.restOnlyMigrationPlan();
		expect(inventory.gmail_v2_principles).toContain('REST_ONLY');
		expect(inventory.imap_paths.every(row => row.classification.includes('migration') || row.classification.includes('legacy') || row.classification.includes('not_primary'))).toBe(true);
		expect(plan.primary_runtime).toBe('gmail_rest_api');
		expect(plan.legacy_imap).toBe('migration_only_reconnect_recovery_deprecated');
		expect(plan.no_new_imap_paths_allowed).toBe(true);
		expect(plan.production_deployment_executed).toBe(false);
	});

	it('evaluates capabilities from explicit evidence and forbids connected-to-ready inference', () => {
		const connectedOnly = gmailPlatformV2Service.capabilityEngine({
			account: { email: 'User@Gmail.com', provider: 'gmail' },
			governance: { approval_state: 'auto_approved' },
			evidence: { oauth_connected: true, oauth_scope: 'gmail.send gmail.readonly' }
		});
		expect(connectedOnly.canSend).toBe('send_blocked');
		expect(connectedOnly.canReceive).toBe('receive_blocked');
		expect(connectedOnly.canSync).toBe('blocked');
		expect(connectedOnly.inference_used).toBe(false);

		const proven = gmailPlatformV2Service.capabilityEngine({
			account: { email: 'user@gmail.com', provider: 'gmail' },
			governance: { approval_state: 'auto_approved' },
			evidence: {
				oauth_connected: true,
				rest_profile_ok: true,
				rest_messages_list_ok: true,
				import_checkpoint_written: true,
				oauth_scope: 'gmail.send gmail.readonly',
				provider_accepted: true,
				sent_ledger_written: true
			}
		});
		expect(proven.canLogin).toBe('allowed');
		expect(proven.canSend).toBe('send_allowed');
		expect(proven.canReceive).toBe('receive_allowed');
	});

	it('keeps governance immutable when provider or OAuth errors occur', () => {
		const result = gmailPlatformV2Service.governanceEngine({
			prior: { approval_state: 'manual_approved', lifecycle_state: 'mailbox_ready' },
			event: { type: 'oauth_failure', provider_state: '403' }
		});
		expect(result.approval_state).toBe('manual_approved');
		expect(result.approved_reverted_to_pending).toBe(false);
		expect(result.governance_overwritten_by_provider).toBe(false);
	});

	it('requires evidence before Mailbox Ready and routes reconnect to existing mailbox', () => {
		const capability = gmailPlatformV2Service.capabilityEngine({
			account: { email: 'user@gmail.com', provider: 'gmail' },
			evidence: { oauth_connected: true, oauth_scope: 'gmail.readonly', rest_profile_ok: true }
		});
		const health = gmailPlatformV2Service.healthEngine({ capability, freshness: { status: 'unknown' } });
		const lifecycle = gmailPlatformV2Service.lifecycleEngine({
			governance: { approval_state: 'auto_approved' },
			capability,
			health
		});
		expect(lifecycle).not.toBe('mailbox_ready');
		const truth = gmailPlatformV2Service.truthPlatform({ capability, health, governance: { approval_state: 'auto_approved' } });
		expect(truth.recovery.reconnect_routes_to_add_mailbox).toBe(false);
	});

	it('calculates health and freshness from provider/import/ledger evidence', () => {
		const now = Date.parse('2026-01-01T01:00:00Z');
		const fresh = gmailPlatformV2Service.freshnessEngine({
			now,
			last_provider_sync: now - 60_000,
			last_import: now - 60_000,
			last_ledger_write: now - 60_000,
			newest_provider_message: 10,
			newest_imported_message: 10
		});
		expect(fresh.status).toBe('healthy');
		const stale = gmailPlatformV2Service.freshnessEngine({
			now,
			last_provider_sync: now - 120 * 60_000,
			last_import: now - 120 * 60_000,
			last_ledger_write: now - 120 * 60_000,
			newest_provider_message: 11,
			newest_imported_message: 10
		});
		expect(stale.status).toBe('stale');
		const health = gmailPlatformV2Service.healthEngine({ capability: { canLogin: 'allowed', canSend: 'send_blocked', canReceive: 'receive_allowed', canSync: 'allowed', canImport: 'allowed', canRoute: 'allowed', canAIProcess: 'allowed' }, freshness: fresh });
		expect(health.health_score).toBeGreaterThan(80);
		expect(health.mailbox_ready_evidence).toBe(true);
	});

	it('clamps future timestamps across provider/import/ledger paths', () => {
		const now = Date.parse('2026-01-01T00:00:00Z');
		const clamped = gmailPlatformV2Service.clampFutureTimestamp('2099-01-01T00:00:00Z', now);
		expect(Date.parse(clamped)).toBe(now + 2 * 60 * 1000);
	});

	it('audits send and receive platforms without PASS unless real safe evidence is present', () => {
		const capability = { canSend: 'send_allowed', canReceive: 'receive_allowed', canImport: 'allowed' };
		const send = gmailPlatformV2Service.sendPlatformAudit({
			capability,
			evidence: { provider_accepted: true, sent_ledger_written: true, all_mail_visible: true }
		});
		expect(send.send_pass_claimed).toBe(false);
		const receive = gmailPlatformV2Service.receivePlatformAudit({
			capability,
			freshness: { status: 'healthy' },
			provider_fetch: true,
			ledger_write: true,
			inbox_visible: true,
			all_mail_visible: true,
			checkpoint_recovery: true
		});
		expect(receive.receive_pass_claimed).toBe(false);
	});

	it('detects duplicate Gmail identity and prepares safe repair plan', () => {
		const audit = gmailPlatformV2Service.identityPlatformAudit([
			{ account_id: 1, email: 'dup@gmail.com' },
			{ account_id: 2, email: 'DUP@gmail.com' },
			{ account_id: 3, email: 'other@gmail.com' }
		]);
		expect(audit.duplicate_gmail_identity).toBe(true);
		expect(audit.duplicates[0].count).toBe(2);
		expect(audit.repair_plan).toContain('operator_review');
	});

	it('plans coordinated sync with a per-mailbox durable object coordinator', () => {
		const plan = gmailPlatformV2Service.durableObjectCoordinatorPlan({ mailbox_id: 'mailbox-44' });
		expect(plan.coordinator).toBe('Per Mailbox Durable Object Coordinator');
		expect(plan.single_writer).toBe(true);
		expect(plan.prevents).toContain('Account44-style failures');
		expect(plan.production_deployed).toBe(false);
	});

	it('exposes READY_FOR_REAL_ACCOUNT_REPLAY without PASS claims', () => {
		const readiness = gmailPlatformV2Service.replayReadiness();
		expect(readiness.status).toBe('READY_FOR_REAL_ACCOUNT_REPLAY');
		expect(readiness.pass_claimed).toBe(false);
		expect(readiness.required_accounts).toContain('billyadult01@gmail.com');
		expect(readiness.requires_real_oauth_send_receive_iphone).toBe(true);
	});
});
