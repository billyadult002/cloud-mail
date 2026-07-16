const CONTRACT_VERSION = 'mail-state-p0-v1';
const CATEGORY_VALUES = new Set(['general','other','action_required','priority','unread','people','customers','work','personal','finance','orders','travel','notifications','promotions','transactions','financial_transaction','financial_security','payment_due','transfer_notice','account_anomaly','financial_statement','regulatory_notice','financial_service','financial_marketing','promotion','newsletter','updates']);
const FOLDERS = new Set(['inbox','needsReply','todo','followUp','important','junk','trash','done','snoozed']);
const SCOPES = new Set(['message']);
const ACTIONS = new Set(['set_category','restore_automatic_classification','set_priority','set_vip','set_junk','set_starred','set_read','move_folder','set_tags']);
const stable = value => Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
async function digest(value) { const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:stable(value))); return [...new Uint8Array(data)].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function classifyEvidence(input={}) {
 const subject=String(input.subject||'').toLowerCase(), body=String(input.body||'').toLowerCase().slice(0,12000), headers=input.headers||{}, text=`${subject} ${body}`;
 const evidence=[]; const add=(code,weight)=>evidence.push({code,weight});
 const marketingTerms=['sale','discount','offer','shop now','limited time','promo code','newsletter','unsubscribe'];
 const marketingHeaders=Boolean(headers.listUnsubscribe||headers.listUnsubscribePost||/bulk|list/i.test(String(headers.precedence||''))||headers.campaignId||headers.feedbackId);
 if(marketingHeaders)add('bulk_or_campaign_headers',30); if(marketingTerms.some(x=>text.includes(x)))add('promotional_language_or_cta',35);
 const amount=/[$€£]\s?\d|\d[,.]\d{2}\s?(usd|cad|eur|gbp)/i.test(text), reference=/(transaction|reference|confirmation)\s*(id|number|#)|account\s*(ending|\*{2,})/i.test(text);
 const security=/(unusual|suspicious|new sign[ -]?in|security alert|account locked|fraud)/i.test(text);
 const payment=/(payment due|amount due|past due|minimum payment)/i.test(text), transfer=/(wire|transfer)\s+(sent|received|completed|pending)/i.test(text), statement=/(statement|账单|对账单)(\s+is)?\s+(ready|available|attached)/i.test(text);
 const marketingScore=evidence.reduce((n,e)=>n+(e.weight>0?e.weight:0),0); let category='general';
 if(marketingScore>=55) category=input.bankOrigin?'financial_marketing':marketingHeaders?'newsletter':'promotion';
 else if(security) category='financial_security'; else if(payment) category='payment_due'; else if(transfer) category='transfer_notice'; else if(statement) category='financial_statement'; else if(amount&&reference) category='financial_transaction'; else if(input.bankOrigin) category='financial_service';
 const businessEvent=['financial_security','payment_due','transfer_notice','account_anomaly','financial_transaction'].includes(category);
 const actionRequired=Boolean(input.actionRequired||payment||security); const safe=input.securityVerdict!=='unsafe';
 const isPriority=Boolean(safe&&category!=='financial_marketing'&&category!=='promotion'&&category!=='newsletter'&&input.junk!==true&&(actionRequired||businessEvent||input.replyRequired||input.decisionRequired||input.approvalRequired||input.nearDeadline));
 return {contract_version:CONTRACT_VERSION,category,is_priority:isPriority,evidence,reason_codes:evidence.map(x=>x.code).concat(isPriority?['qualifying_business_event']:['priority_gate_not_met'])};
}
async function mutate(c,{actorUserId,workspaceId,idempotencyKey,target,action,value,scope='message',expectedVersion,sourceSurface='unknown'}) {
 if(!idempotencyKey||!ACTIONS.has(action)||!SCOPES.has(scope)) throw new Error('invalid_mail_action_contract');
 const accountId=Number(target?.account_id),messageId=Number(target?.message_id); if(!Number.isInteger(accountId)||!Number.isInteger(messageId))throw new Error('invalid_canonical_target');
 const member=await c.env.db.prepare(`SELECT wm.role FROM workspace_members wm WHERE wm.workspace_id=?1 AND wm.user_id=?2 AND wm.role IN ('OWNER','ADMIN','MAIL_ADMIN')`).bind(workspaceId,actorUserId).first(); if(!member)throw new Error('workspace_mail_mutation_authority_required');
 // The action boundary is also a compatibility-safe activation point. It makes
 // an owned, already-authorized provider account addressable from the caller's
 // workspace even when an older client cache never opened Workspace resolve.
 await c.env.db.prepare(`INSERT INTO workspace_account_bindings(workspace_id,account_id,owner_user_id,subject_user_id,lifecycle_state)
   SELECT ?1,a.account_id,a.user_id,?3,'READY' FROM account a
    WHERE a.account_id=?2 AND a.is_del=0 AND (a.user_id=?3 OR EXISTS(SELECT 1 FROM mailbox_authorizations ma WHERE ma.grantee_user_id=?3 AND ma.owner_user_id=a.user_id AND ma.owner_account_id=a.account_id AND ma.status='active' AND ma.revoked_at IS NULL))
   ON CONFLICT(workspace_id,account_id) DO UPDATE SET subject_user_id=excluded.subject_user_id,lifecycle_state='READY',updated_at=CURRENT_TIMESTAMP`).bind(workspaceId,accountId,actorUserId).run();
 const message=await c.env.db.prepare(`SELECT e.email_id,e.account_id,e.user_id,e.thread_id,e.message_id,e.external_message_id,e.unread,e.folder_key,e.subject,e.text,e.content FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id JOIN workspace_account_bindings wb ON wb.workspace_id=?1 AND wb.account_id=e.account_id AND wb.subject_user_id=?4 AND wb.lifecycle_state='READY' WHERE e.email_id=?2 AND e.account_id=?3 AND e.is_del=0 AND a.is_del=0 AND (e.user_id=?4 OR EXISTS(SELECT 1 FROM mailbox_authorizations ma WHERE ma.grantee_user_id=?4 AND ma.owner_user_id=e.user_id AND ma.owner_account_id=e.account_id AND ma.status='active' AND ma.revoked_at IS NULL))`).bind(workspaceId,messageId,accountId,actorUserId).first(); if(!message)throw new Error('workspace_bound_canonical_target_not_found');
 const requestHash=await digest({target,action,value,scope,expectedVersion,sourceSurface});
 const prior=await c.env.db.prepare('SELECT request_hash,result_json FROM mail_action_receipts WHERE tenant_id=?1 AND workspace_id=?2 AND idempotency_key=?3').bind(actorUserId,workspaceId,idempotencyKey).first(); if(prior){if(prior.request_hash!==requestHash)throw new Error('idempotency_key_payload_mismatch');return {...JSON.parse(prior.result_json),idempotent:true};}
 const persistedState=await c.env.db.prepare('SELECT * FROM mail_canonical_state WHERE tenant_id=?1 AND workspace_id=?2 AND account_id=?3 AND message_id=?4').bind(actorUserId,workspaceId,accountId,messageId).first();
 const state=persistedState||{state_version:1,is_read:message.unread?0:1,folder_key:message.folder_key||'inbox',semantic_category:'general',is_priority:0,is_vip:0,junk_disposition:'not_junk',is_starred:0,tags_json:'[]'};
 if(Number(expectedVersion)!==Number(state.state_version))throw new Error('mail_state_version_conflict');
 let column,normalized=value,overrideField=null;
 if(action==='set_category'){if(!CATEGORY_VALUES.has(value))throw new Error('invalid_category');column='semantic_category';overrideField='semantic_category';}
 else if(action==='restore_automatic_classification'){const automatic=classifyEvidence({subject:message.subject,body:message.text||message.content,securityVerdict:'safe'});column='semantic_category';normalized=automatic.category;}
 else if(action==='set_priority'){column='is_priority';normalized=value?1:0;overrideField='is_priority';}
 else if(action==='set_vip'){column='is_vip';normalized=value?1:0;}
 else if(action==='set_junk'){column='junk_disposition';normalized=value?'junk':'not_junk';}
 else if(action==='set_starred'){column='is_starred';normalized=value?1:0;}
 else if(action==='set_read'){column='is_read';normalized=value?1:0;}
 else if(action==='move_folder'){
  if(!FOLDERS.has(value))throw new Error('invalid_folder');
  // A user-directed folder move is a durable, message-scoped correction. In
  // particular, Junk is committed with its disposition in this same fence.
  column='folder_key';overrideField='folder_key';
 }
 else {column='tags_json';normalized=JSON.stringify([...new Set(Array.isArray(value)?value.map(String):[])]);}
 const resultVersion=Number(state.state_version)+1;
 const mutationId=`mail-mutation:${await digest({actorUserId,workspaceId,idempotencyKey})}`,auditReference=`mail-audit:${mutationId}`;
 const result={mutation_id:mutationId,contract_version:CONTRACT_VERSION,target:{tenant_id:actorUserId,workspace_id:workspaceId,account_id:accountId,message_id:messageId,provider_message_id:message.external_message_id||message.message_id||'',conversation_id:message.thread_id||'',scope},action,requested_change:value,previous_version:Number(state.state_version),state_version:resultVersion,status:'completed',reason_code:'mutation_committed',audit_reference:auditReference,provider_operation:'none',cache_invalidation_key:`mail:${actorUserId}:${workspaceId}:${accountId}:${messageId}:${resultVersion}`,idempotent:false};
 const statements=[];
 if(!persistedState)statements.push(c.env.db.prepare(`INSERT OR IGNORE INTO mail_canonical_state(tenant_id,workspace_id,account_id,message_id,thread_id,provider_message_id,is_read,folder_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(actorUserId,workspaceId,accountId,messageId,message.thread_id||'',message.external_message_id||message.message_id||'',message.unread?0:1,message.folder_key||'inbox'));
 statements.push(c.env.db.prepare(`INSERT INTO mail_mutation_authorizations(id,tenant_id,workspace_id,account_id,message_id,expected_version,request_hash,expires_at) SELECT ?1,?2,?3,?4,?5,?6,?7,datetime('now','+1 minute') WHERE EXISTS(SELECT 1 FROM mail_canonical_state s WHERE s.tenant_id=?2 AND s.workspace_id=?3 AND s.account_id=?4 AND s.message_id=?5 AND s.state_version=?6)`).bind(mutationId,actorUserId,workspaceId,accountId,messageId,state.state_version,requestHash));
 const fieldsToRevoke=action==='restore_automatic_classification'?['semantic_category']:overrideField?[overrideField]:[];
 for(const field of fieldsToRevoke)statements.push(c.env.db.prepare(`UPDATE mail_manual_overrides SET active=0,revoked_at=CURRENT_TIMESTAMP WHERE tenant_id=?1 AND workspace_id=?2 AND account_id=?3 AND message_id=?4 AND field_key=?5 AND active=1`).bind(actorUserId,workspaceId,accountId,messageId,field));
 if(overrideField)statements.push(c.env.db.prepare(`INSERT INTO mail_manual_overrides(id,tenant_id,workspace_id,account_id,message_id,thread_id,scope,field_key,value_json,generation,reason_code,actor_user_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'explicit_user_override',?2)`).bind(`${mutationId}:override`,actorUserId,workspaceId,accountId,messageId,message.thread_id||'',scope,overrideField,JSON.stringify(normalized),resultVersion));
 const stateUpdate=action==='move_folder'
  ? c.env.db.prepare(`UPDATE mail_canonical_state SET folder_key=?1,junk_disposition=CASE WHEN ?1='junk' THEN 'junk' WHEN junk_disposition='junk' THEN 'not_junk' ELSE junk_disposition END,last_mutation_id=?2,state_version=state_version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?3 AND workspace_id=?4 AND account_id=?5 AND message_id=?6 AND state_version=?7`).bind(normalized,mutationId,actorUserId,workspaceId,accountId,messageId,state.state_version)
  : c.env.db.prepare(`UPDATE mail_canonical_state SET ${column}=?1,last_mutation_id=?2,state_version=state_version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?3 AND workspace_id=?4 AND account_id=?5 AND message_id=?6 AND state_version=?7`).bind(normalized,mutationId,actorUserId,workspaceId,accountId,messageId,state.state_version);
 statements.push(stateUpdate);
 statements.push(c.env.db.prepare(`INSERT INTO mail_action_receipts(id,idempotency_key,tenant_id,workspace_id,account_id,message_id,action,request_version,result_version,request_hash,result_json,actor_user_id,source_surface,provider_operation,status,reason_code,audit_reference) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?3,?12,'none','completed','mutation_committed',?13)`).bind(mutationId,idempotencyKey,actorUserId,workspaceId,accountId,messageId,action,expectedVersion,resultVersion,requestHash,JSON.stringify(result),String(sourceSurface).slice(0,80),auditReference));
 statements.push(c.env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id) VALUES(?1,?2,?3,'mail_canonical_state',?4,?5,?6,?7)`).bind(workspaceId,actorUserId,action,`${accountId}:${messageId}`,JSON.stringify({state_version:state.state_version}),JSON.stringify({state_version:resultVersion,mutation_id:mutationId}),auditReference));
 statements.push(c.env.db.prepare(`UPDATE mail_mutation_authorizations SET consumed_at=CURRENT_TIMESTAMP WHERE id=?1 AND consumed_at IS NULL`).bind(mutationId));
 try{await c.env.db.batch(statements);}catch(error){const raced=await c.env.db.prepare('SELECT request_hash,result_json FROM mail_action_receipts WHERE tenant_id=?1 AND workspace_id=?2 AND idempotency_key=?3').bind(actorUserId,workspaceId,idempotencyKey).first();if(raced&&raced.request_hash===requestHash)return{...JSON.parse(raced.result_json),idempotent:true};throw error;}
 return result;
}
async function canonicalState(c,{actorUserId,workspaceId,accountId,messageId}){
 const member=await c.env.db.prepare(`SELECT 1 FROM workspace_members WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId,actorUserId).first();
 if(!member)throw new Error('workspace_mail_state_authority_required');
 return c.env.db.prepare(`SELECT s.* FROM mail_canonical_state s JOIN workspace_account_bindings wb ON wb.workspace_id=s.workspace_id AND wb.account_id=s.account_id AND wb.subject_user_id=?1 AND wb.lifecycle_state='READY' WHERE s.tenant_id=?1 AND s.workspace_id=?2 AND s.account_id=?3 AND s.message_id=?4`).bind(actorUserId,workspaceId,accountId,messageId).first();
}
export {CONTRACT_VERSION,classifyEvidence,mutate,canonicalState}; export default {classifyEvidence,mutate,canonicalState};
