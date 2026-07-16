import service from '../src/service/unified-conversation-backfill-service.js';
import { createRemoteD1Adapter } from './local-runtime-d1-adapter.mjs';
import { createD1TransactionalHttpTransport } from './d1-transactional-http-transport.mjs';

const args = new Map(process.argv.slice(2).map(x => { const [k, v = 'true'] = x.split('='); return [k.replace(/^--/, ''), v]; }));
const workspaceId = Number(args.get('workspace-id') || 0);
const limit = Math.max(1, Math.min(100, Number(args.get('limit') || 25)));
if (!workspaceId) throw new Error('workspace_id_required');
const db = args.get('transport') === 'http'
  ? createD1TransactionalHttpTransport({ accountId: args.get('account-id'), databaseId: args.get('database-id'), apiToken: process.env.NEXORA_D1_API_TOKEN })
  : createRemoteD1Adapter({ cwd: process.cwd(), profile: args.get('profile') });
const env = { db, UCS_ACTIVATION_ENABLED: 'true' };
const scope = await env.db.prepare('SELECT tenant_id,workspace_id FROM conversation_cutover_state WHERE workspace_id=?1 AND dual_write_enabled=1').bind(workspaceId).first();
if (!scope) throw new Error('workspace_scope_not_found');
const tenantId = Number(scope.tenant_id);
const membership = await service.refreshProjectionMemberships(env, { tenantId, workspaceId, limit });
const run = await service.runWorkspace(env, { tenantId, workspaceId, limit: 2 });
if (membership.ready && run.ready) run.parity = await service.parityWorkspace(env, { tenantId, workspaceId });
console.log(JSON.stringify({ runtime: 'local-d1-adapter-v1', tenantId, workspaceId, membership, run }));
