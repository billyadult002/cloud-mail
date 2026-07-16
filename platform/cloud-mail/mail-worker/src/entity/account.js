import { sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const account = sqliteTable('account', {
	accountId: integer('account_id').primaryKey({ autoIncrement: true }),
	email: text('email').notNull(),
	name: text('name').notNull().default(''),
	status: integer('status').default(0).notNull(),
	latestEmailTime: text('latest_email_time'),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	userId: integer('user_id').notNull(),
	allReceive: integer('all_receive').default(0).notNull(),
	sort: integer('sort').default(0).notNull(),
	provider: text('provider').default('cloudflare_native').notNull(),
	domain: text('domain').default('').notNull(),
	externalAccountId: text('external_account_id'),
	syncStatus: text('sync_status').default('connected').notNull(),
	lastSyncedAt: text('last_synced_at'),
	lastSyncAttemptAt: text('last_sync_attempt_at'),
	lastSuccessfulSyncAt: text('last_successful_sync_at'),
	lastMessageReceivedAt: text('last_message_received_at'),
	lastProviderCheckpointAt: text('last_provider_checkpoint_at'),
	lastSyncFailureAt: text('last_sync_failure_at'),
	syncFailureReason: text('sync_failure_reason'),
	syncError: text('sync_error'),
	isDel: integer('is_del').default(0).notNull(),
});
export default account
