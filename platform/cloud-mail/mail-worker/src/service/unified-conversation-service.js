const MATERIALIZER_VERSION='ucs-materializer-v3';
const FACET_DIMENSIONS=Object.freeze(['Security','Identity','Origin','Intent','Relationship','Event','Actionability','Category','Overlay','Ranking','Risk','Domain']);
const COMMITMENT_STATES=Object.freeze(['WaitingForMe','WaitingForOthers','Resolved','Delegated','Scheduled','Blocked','Cancelled']);
const SURFACES=Object.freeze(['all_mail','categories','action_required','waiting_for_me','waiting_for_others','mission_control']);

async function digest(value){
 const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
 const raw=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(raw)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function unique(values=[]){return [...new Set(values.filter(v=>v!=null&&String(v).length).map(String))].sort();}
function safeJson(value,fallback){try{return JSON.parse(value??'');}catch{return fallback;}}
function projectionSurfaceMatch(row,surface,category){
 if(surface==='all_mail')return row.canonical_folder_key!=='trash';
 if(surface==='action_required')return Number(row.action_required)===1;
 if(surface==='waiting_for_me')return Number(row.waiting_for_me)===1;
 if(surface==='waiting_for_others')return Number(row.waiting_for_others)===1;
 if(surface==='mission_control')return safeJson(row.mission_ids_json,[]).length>0;
 if(surface==='categories')return !category||safeJson(row.category_keys_json,[]).includes(category)||safeJson(row.membership_keys_json,[]).includes(category);
 return false;
}
function deriveProjection({aggregate,facets=[],commitments=[],missions=[],display={}}){
 const supported=facets.filter(x=>x.status==='supported');
 const categories=unique(supported.filter(x=>x.dimension_key==='Category').map(x=>x.value_key));
 const facetSummary={};for(const facet of supported)(facetSummary[facet.dimension_key]??=[]).push({value:facet.value_key,confidence:Number(facet.confidence),explanation:facet.explanation_code});
 const active=commitments.filter(x=>!['Resolved','Cancelled'].includes(x.state));
 const states=unique(active.map(x=>x.state));
 const waitingForMe=states.includes('WaitingForMe'),waitingForOthers=states.includes('WaitingForOthers');
 const risk=supported.filter(x=>x.dimension_key==='Risk').sort((a,b)=>Number(b.confidence)-Number(a.confidence))[0]?.value_key||'unknown';
 return{
  conversation_id:aggregate.id,aggregate_version:Number(aggregate.aggregate_version),materializer_version:MATERIALIZER_VERSION,
  title:String(display.title||'Conversation'),preview:String(display.preview||''),last_observed_at:aggregate.last_observed_at||null,
  message_count:Number(display.messageCount??0),unread_count:Number(display.unreadCount??0),has_attachments:display.hasAttachments?1:0,
  membership_keys:unique(display.membershipKeys||[]),
  category_keys:categories,facet_summary:facetSummary,active_commitment_ids:active.map(x=>x.id),commitment_states:states,
  action_required:(waitingForMe||states.includes('Blocked'))?1:0,waiting_for_me:waitingForMe?1:0,waiting_for_others:waitingForOthers?1:0,
  mission_ids:unique(missions.map(x=>x.id)),ranking_score:Number(display.rankingScore??0),risk_key:risk,
  canonical_folder_key:String(display.canonicalFolderKey||'inbox'),source_navigation:display.sourceNavigation||[],
  search_document:String(display.searchDocument||[display.title,display.preview,categories.join(' ')].filter(Boolean).join(' ')).toLowerCase()
 };
}
function validateObservation(input){
 const required=['providerKey','accountId','providerConversationRefHash','providerMessageRefHash','observedAt','integrityHash'];
 const missing=required.filter(k=>input?.[k]==null||String(input[k]).length===0);
 return{valid:missing.length===0,missing};
}
async function assertWorkspace(c,workspaceId,tenantId){
 const row=await c.env.db.prepare(`SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=?1 AND m.user_id=?2 LIMIT 1`).bind(workspaceId,tenantId).first();
 if(!row)throw new Error('conversation_workspace_scope_denied');
}
async function resolveConversation(c,input){
 const check=validateObservation(input);if(!check.valid)throw new Error(`conversation_observation_missing:${check.missing.join(',')}`);
 await assertWorkspace(c,input.workspaceId,input.tenantId);
 const existing=await c.env.db.prepare(`SELECT conversation_id FROM conversation_source_bindings WHERE tenant_id=?1 AND workspace_id=?2 AND provider_key=?3 AND account_id=?4 AND provider_conversation_ref_hash=?5 AND binding_state='active'`).bind(input.tenantId,input.workspaceId,input.providerKey,input.accountId,input.providerConversationRefHash).first();
 if(existing)return{conversationId:existing.conversation_id,created:false};
 const id=`conversation:${crypto.randomUUID()}`,bindingId=`binding:${await digest({tenantId:input.tenantId,workspaceId:input.workspaceId,providerKey:input.providerKey,accountId:input.accountId,ref:input.providerConversationRefHash})}`;
 const emptyDigest=await digest([]),integrity=await digest({id,workspaceId:input.workspaceId,providerIndependent:true});
 try{await c.env.db.batch([
  c.env.db.prepare(`INSERT INTO conversation_aggregates(id,tenant_id,workspace_id,lifecycle_state,participant_set_digest,message_set_digest,last_observed_at,integrity_hash) VALUES(?1,?2,?3,'active',?4,?5,?6,?7)`).bind(id,input.tenantId,input.workspaceId,emptyDigest,emptyDigest,input.observedAt,integrity),
  c.env.db.prepare(`INSERT INTO conversation_source_bindings(id,tenant_id,workspace_id,conversation_id,provider_key,account_id,provider_conversation_ref_hash,binding_state,observed_at,evidence_id) VALUES(?1,?2,?3,?4,?5,?6,?7,'active',?8,?9)`).bind(bindingId,input.tenantId,input.workspaceId,id,input.providerKey,input.accountId,input.providerConversationRefHash,input.observedAt,input.evidenceId||null)
 ]);}catch(error){
  const raced=await c.env.db.prepare(`SELECT conversation_id FROM conversation_source_bindings WHERE tenant_id=?1 AND workspace_id=?2 AND provider_key=?3 AND account_id=?4 AND provider_conversation_ref_hash=?5 AND binding_state='active'`).bind(input.tenantId,input.workspaceId,input.providerKey,input.accountId,input.providerConversationRefHash).first();
  if(raced)return{conversationId:raced.conversation_id,created:false};throw error;
 }
 return{conversationId:id,created:true};
}
async function observeMessage(c,input){
 const resolved=await resolveConversation(c,input),sourceVersion=String(input.sourceVersion||'1');
 const messageId=`message:${await digest({tenantId:input.tenantId,workspaceId:input.workspaceId,providerKey:input.providerKey,accountId:input.accountId,ref:input.providerMessageRefHash,sourceVersion})}`;
 try{await c.env.db.prepare(`INSERT INTO conversation_messages(id,tenant_id,workspace_id,conversation_id,provider_key,account_id,source_message_id,provider_message_ref_hash,direction,observed_at,source_version,evidence_id,integrity_hash,lifecycle_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'observed')`).bind(messageId,input.tenantId,input.workspaceId,resolved.conversationId,input.providerKey,input.accountId,input.sourceMessageId||null,input.providerMessageRefHash,input.direction||'unknown',input.observedAt,sourceVersion,input.evidenceId||null,input.integrityHash).run();}catch(error){if(!String(error?.message||error).includes('UNIQUE'))throw error;const existing=await c.env.db.prepare(`SELECT id,conversation_id,source_message_id,lifecycle_state FROM conversation_messages WHERE tenant_id=?1 AND workspace_id=?2 AND provider_key=?3 AND account_id=?4 AND provider_message_ref_hash=?5 AND source_version=?6`).bind(input.tenantId,input.workspaceId,input.providerKey,input.accountId,input.providerMessageRefHash,sourceVersion).first();if(existing&&Number(existing.source_message_id)===Number(input.sourceMessageId)&&existing.lifecycle_state!=='quarantined')return{conversationId:existing.conversation_id,messageId:existing.id,idempotent:true};throw new Error('conversation_observation_uniqueness_conflict');}
 const set=(await c.env.db.prepare(`SELECT id,integrity_hash FROM conversation_messages WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND lifecycle_state!='quarantined' ORDER BY id`).bind(input.tenantId,input.workspaceId,resolved.conversationId).all()).results||[],messageSetDigest=await digest(set);
 await c.env.db.prepare(`UPDATE conversation_aggregates SET aggregate_version=aggregate_version+1,message_set_digest=?1,last_observed_at=CASE WHEN last_observed_at IS NULL OR last_observed_at<?2 THEN ?2 ELSE last_observed_at END,integrity_hash=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?4 AND tenant_id=?5 AND workspace_id=?6`).bind(messageSetDigest,input.observedAt,await digest({conversationId:resolved.conversationId,messageSetDigest}),resolved.conversationId,input.tenantId,input.workspaceId).run();
 return{conversationId:resolved.conversationId,messageId,idempotent:false};
}
async function listProjections(c,{tenantId,workspaceId,surface='all_mail',category=null,query='',cursor=null,size=50}){
 if(!SURFACES.includes(surface))throw new Error('conversation_projection_surface_invalid');await assertWorkspace(c,workspaceId,tenantId);
 const cutover=await c.env.db.prepare(`SELECT dual_write_enabled,shadow_read_enabled,projection_read_enabled,cutover_epoch,rollout_percent FROM conversation_cutover_state WHERE workspace_id=?1 AND tenant_id=?2`).bind(workspaceId,tenantId).first();
 let authoritative=false;
 if(cutover?.projection_read_enabled){
  const gate=await c.env.db.prepare(`SELECT cp.state checkpoint_state,cp.high_watermark,
   (SELECT COUNT(DISTINCT p.surface_key) FROM conversation_projection_parity p WHERE p.tenant_id=?1 AND p.workspace_id=?2 AND p.cutover_epoch=?3 AND p.materializer_version=?4 AND p.high_watermark=cp.high_watermark AND p.passed=1 AND p.audit_run_id=(SELECT audit_run_id FROM conversation_projection_parity WHERE tenant_id=?1 AND workspace_id=?2 AND cutover_epoch=?3 AND high_watermark=cp.high_watermark ORDER BY observed_at DESC LIMIT 1)) passed_surfaces,
   (SELECT COUNT(*) FROM conversation_pipeline_failures WHERE tenant_id=?1 AND workspace_id=?2 AND resolved_at IS NULL) unresolved_failures,
   (SELECT COUNT(*) FROM conversation_ingest_outbox WHERE tenant_id=?1 AND workspace_id=?2 AND state!='processed') pending_ingest
   FROM conversation_materialization_checkpoints cp WHERE cp.tenant_id=?1 AND cp.workspace_id=?2 AND cp.pipeline_key='ucs-backfill-v1' LIMIT 1`).bind(tenantId,workspaceId,Number(cutover.cutover_epoch),MATERIALIZER_VERSION).first();
  authoritative=gate?.checkpoint_state==='ready'&&Number(gate?.passed_surfaces)===SURFACES.length&&Number(gate?.unresolved_failures)===0&&Number(gate?.pending_ingest)===0;
 }
 const cohortDigest=await digest({tenantId,workspaceId,epoch:Number(cutover?.cutover_epoch||0)}),cohortBucket=parseInt(cohortDigest.slice(0,8),16)%100,rolloutPercent=Math.min(100,Math.max(0,Number(cutover?.rollout_percent||0))),internal=rolloutPercent===1?await c.env.db.prepare(`SELECT 1 eligible FROM conversation_rollout_cohorts WHERE tenant_id=?1 AND workspace_id=?2 AND subject_user_id=?1 AND stage_key='internal' AND enabled=1`).bind(tenantId,workspaceId).first():null,cohortEligible=rolloutPercent===100||Boolean(internal)||cohortBucket<rolloutPercent;
 const mode=authoritative&&cohortEligible?'authoritative':cutover?.shadow_read_enabled?'shadow':'disabled';
 if(mode==='disabled')return{authority_mode:mode,cutover_epoch:String(cutover?.cutover_epoch||0),rows:[],next_cursor:null};
 const limit=Math.min(Math.max(Number(size||50),1),500),values=[tenantId,workspaceId];let where=`tenant_id=?1 AND workspace_id=?2 AND state='current'`;
 if(surface==='all_mail')where+=` AND canonical_folder_key!='trash'`;
 if(surface==='action_required')where+=` AND action_required=1`;
 if(surface==='waiting_for_me')where+=` AND waiting_for_me=1`;
 if(surface==='waiting_for_others')where+=` AND waiting_for_others=1`;
 if(surface==='mission_control')where+=` AND json_array_length(mission_ids_json)>0`;
 if(surface==='categories'&&category){values.push(category);where+=` AND (EXISTS(SELECT 1 FROM json_each(conversation_projections.category_keys_json) WHERE value=?${values.length}) OR EXISTS(SELECT 1 FROM json_each(conversation_projections.membership_keys_json) WHERE value=?${values.length}))`;}
 if(cursor){const split=String(cursor).split('|'),ts=split.shift()||'',id=split.join('|');values.push(ts,id);where+=` AND (COALESCE(last_observed_at,'')<?${values.length-1} OR (COALESCE(last_observed_at,'')=?${values.length-1} AND id<?${values.length}))`;}
 if(query){values.push(`%${String(query).toLowerCase()}%`);where+=` AND search_document LIKE ?${values.length}`;}
 const raw=(await c.env.db.prepare(`SELECT * FROM conversation_projections WHERE ${where} ORDER BY last_observed_at DESC,id DESC LIMIT ${limit+1}`).bind(...values).all()).results||[],hasMore=raw.length>limit,rows=raw.slice(0,limit).map(row=>({
  id:row.id,conversation_id:row.conversation_id,projection_version:Number(row.projection_version),aggregate_version:Number(row.aggregate_version),title:row.title,preview:row.preview,last_observed_at:row.last_observed_at,message_count:Number(row.message_count),unread_count:Number(row.unread_count),has_attachments:Boolean(row.has_attachments),membership_keys:safeJson(row.membership_keys_json,[]),category_keys:safeJson(row.category_keys_json,[]),facets:safeJson(row.facet_summary_json,{}),active_commitment_ids:safeJson(row.active_commitment_ids_json,[]),commitment_states:safeJson(row.commitment_states_json,[]),action_required:Boolean(row.action_required),waiting_for_me:Boolean(row.waiting_for_me),waiting_for_others:Boolean(row.waiting_for_others),mission_ids:safeJson(row.mission_ids_json,[]),ranking_score:Number(row.ranking_score),risk_key:row.risk_key,canonical_folder_key:row.canonical_folder_key,source_navigation:safeJson(row.source_navigation_json,[]),search_document:row.search_document||''
 })),last=rows.at(-1),lastRaw=last?raw[Math.min(raw.length,limit)-1]:null;
 return{authority_mode:mode,cutover_epoch:String(cutover?.cutover_epoch||0),rows,next_cursor:hasMore&&lastRaw?`${lastRaw.last_observed_at||''}|${lastRaw.id}`:null};
}
async function projectionDetail(c,{tenantId,workspaceId,conversationId}){await assertWorkspace(c,workspaceId,tenantId);const projection=await c.env.db.prepare(`SELECT * FROM conversation_projections WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND state='current'`).bind(tenantId,workspaceId,conversationId).first();if(!projection)throw new Error('conversation_projection_not_found');const messages=(await c.env.db.prepare(`SELECT m.source_message_id message_id,m.account_id,m.provider_key,e.subject,e.send_email,e.to_email,e.text,e.content,e.create_time,s.state_version,s.folder_key FROM conversation_messages m JOIN email e ON e.email_id=m.source_message_id LEFT JOIN mail_canonical_state s ON s.tenant_id=m.tenant_id AND s.workspace_id=m.workspace_id AND s.account_id=m.account_id AND s.message_id=m.source_message_id WHERE m.tenant_id=?1 AND m.workspace_id=?2 AND m.conversation_id=?3 AND m.lifecycle_state!='quarantined' ORDER BY e.create_time,e.email_id`).bind(tenantId,workspaceId,conversationId).all()).results||[];return{projection:{id:projection.id,conversation_id:projection.conversation_id,projection_version:Number(projection.projection_version),aggregate_version:Number(projection.aggregate_version),title:projection.title,preview:projection.preview,last_observed_at:projection.last_observed_at,message_count:Number(projection.message_count),unread_count:Number(projection.unread_count),has_attachments:Boolean(projection.has_attachments),membership_keys:safeJson(projection.membership_keys_json,[]),category_keys:safeJson(projection.category_keys_json,[]),facets:safeJson(projection.facet_summary_json,{}),active_commitment_ids:safeJson(projection.active_commitment_ids_json,[]),commitment_states:safeJson(projection.commitment_states_json,[]),action_required:Boolean(projection.action_required),waiting_for_me:Boolean(projection.waiting_for_me),waiting_for_others:Boolean(projection.waiting_for_others),mission_ids:safeJson(projection.mission_ids_json,[]),ranking_score:Number(projection.ranking_score),risk_key:projection.risk_key,canonical_folder_key:projection.canonical_folder_key,source_navigation:safeJson(projection.source_navigation_json,[])},messages:messages.map(x=>({message_id:Number(x.message_id),account_id:Number(x.account_id),provider_key:x.provider_key,subject:x.subject||'',sender:x.send_email||'',recipients:x.to_email||'',body:x.text||x.content||'',observed_at:x.create_time,state_version:Number(x.state_version||1),folder_key:x.folder_key||'inbox'}))};}

export{MATERIALIZER_VERSION,FACET_DIMENSIONS,COMMITMENT_STATES,SURFACES,digest,projectionSurfaceMatch,deriveProjection,validateObservation,resolveConversation,observeMessage,listProjections,projectionDetail};
export default{resolveConversation,observeMessage,listProjections,projectionDetail,deriveProjection};
