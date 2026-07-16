import {classifyEvidence} from './mail-action-integrity-service';
const CONTRACT='local-mail-semantic-evidence-v1', POLICY='hybrid-mail-policy-p0-v1', PROMPT='apple-mail-evidence-p0-v1';
const allowedModes=new Set(['apple_on_device','deterministic_only','server_semantic_fallback','manual_review']);
const allowedIntent=new Set(['inform','request','decision_request','approval_request','marketing','security_notice','transaction_notice','unknown']);
const allowedFinancial=new Set(['none','financial_transaction','financial_security','payment_due','transfer_notice','account_anomaly','financial_statement','regulatory_notice','financial_service','financial_marketing','unknown']);
const allowedMarketing=new Set(['none','promotion','newsletter','financial_marketing','generic_marketing','unknown']);
const iso=value=>Number.isFinite(Date.parse(value));
const EVIDENCE_KEYS=new Set(['contractVersion','promptVersion','inferenceMode','modelFamily','osVersion','language','generatedAt','messageVersion','contentDigest','intentCandidate','eventCandidate','financialSubtypeCandidate','marketingSubtypeCandidate','actionabilityCandidate','ambiguous','conflicting','certainty','availabilityState']);
const shortCode=value=>typeof value==='string'&&/^[a-z0-9_ -]{1,80}$/i.test(value);
const stableInput=message=>`${String(message.subject||'').slice(0,500)}\u001f${String(message.send_email||'').slice(0,320)}\u001f${String(message.text||message.content||'').slice(0,6000)}`;
async function sha256(value){const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(raw)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function evidenceIdentity({actorUserId,workspaceId,accountId,messageId,evidence}){return`local-evidence:${await sha256(`${actorUserId}:${workspaceId}:${accountId}:${messageId}:${evidence.messageVersion}:${evidence.contentDigest}:${evidence.modelFamily}:${evidence.promptVersion}:${evidence.generatedAt}`)}`;}
async function decisionIdentity(evidenceId){return`mail-policy:${await sha256(`${evidenceId}:${POLICY}`)}`;}
function validateLocalEvidence(body,now=Date.now()){
 const errors=[]; if(!body||typeof body!=='object'||Array.isArray(body))return{valid:false,errors:['evidence_object_required']}; if(Object.keys(body).some(key=>!EVIDENCE_KEYS.has(key)))errors.push('unknown_field_rejected'); if(body?.contractVersion!==CONTRACT)errors.push('contract_version_invalid'); if(body?.promptVersion!==PROMPT)errors.push('prompt_version_invalid');
 if(!allowedModes.has(body?.inferenceMode))errors.push('inference_mode_invalid'); if(body?.inferenceMode==='apple_on_device'&&body?.modelFamily!=='apple-system-language-model')errors.push('model_family_invalid');
 if(!String(body?.osVersion||'').slice(0,80))errors.push('os_version_missing'); if(!/^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?/.test(String(body?.language||'')))errors.push('language_invalid');
 if(!iso(body?.generatedAt)||Math.abs(now-Date.parse(body.generatedAt))>15*60*1000)errors.push('generated_time_invalid');
 if(!Number.isInteger(body?.messageVersion)||body.messageVersion<1)errors.push('message_version_invalid'); if(!/^[a-f0-9]{64}$/.test(String(body?.contentDigest||'')))errors.push('content_digest_invalid');
 if(!allowedIntent.has(body?.intentCandidate))errors.push('intent_invalid'); if(!allowedFinancial.has(body?.financialSubtypeCandidate))errors.push('financial_subtype_invalid'); if(!allowedMarketing.has(body?.marketingSubtypeCandidate))errors.push('marketing_subtype_invalid');
 if(!shortCode(body?.eventCandidate)||!shortCode(body?.actionabilityCandidate)||!shortCode(body?.availabilityState))errors.push('candidate_code_invalid'); if(typeof body?.ambiguous!=='boolean'||typeof body?.conflicting!=='boolean')errors.push('conflict_flags_invalid');
 if(!Number.isInteger(body?.certainty)||body.certainty<0||body.certainty>100)errors.push('certainty_invalid');
 return {valid:errors.length===0,errors};
}
function finalizePolicy({deterministic={},local=null,manualOverride=null}){
 const hardMarketing=Boolean(deterministic.marketingHardGate), unsafe=deterministic.securityVerdict!=='safe', junk=Boolean(deterministic.junk);
 if(manualOverride){const prioritySuppressed=unsafe||junk||hardMarketing;return{category:manualOverride.category,is_priority:Boolean(manualOverride.is_priority&&!prioritySuppressed),decision_state:unsafe?'needs_review':'verified_manual_override',reason_codes:['explicit_user_override',...(prioritySuppressed?['non_bypassable_priority_hard_gate']:[])],policy_version:POLICY};}
 const localConflict=Boolean(local&&(local.conflicting||((hardMarketing&&local.marketingSubtypeCandidate==='none')||(deterministic.financialSubtype&&local.financialSubtypeCandidate!=='unknown'&&local.financialSubtypeCandidate!=='none'&&local.financialSubtypeCandidate!==deterministic.financialSubtype))));
 if(unsafe)return{category:deterministic.category||'general',is_priority:false,decision_state:'needs_review',reason_codes:['security_unresolved'],policy_version:POLICY};
 let category=deterministic.category||'general'; if(!hardMarketing&&!localConflict&&local&&local.certainty>=70&&!local.ambiguous){if(local.financialSubtypeCandidate!=='none'&&local.financialSubtypeCandidate!=='unknown')category=local.financialSubtypeCandidate;else if(local.marketingSubtypeCandidate!=='none'&&local.marketingSubtypeCandidate!=='unknown')category=local.marketingSubtypeCandidate;}
 if(hardMarketing)category=deterministic.marketingCategory||'promotion';
 const suppress=hardMarketing||junk||['promotion','newsletter','financial_marketing','generic_marketing'].includes(category);
 const qualifies=Boolean(deterministic.actionRequired||deterministic.moneyMovement||deterministic.financialSecurity||deterministic.nearDeadline||deterministic.replyRequired||deterministic.decisionRequired||deterministic.approvalRequired);
 return{category,is_priority:Boolean(!suppress&&qualifies),decision_state:localConflict?'conflicted':'verified_automated',reason_codes:[...(hardMarketing?['marketing_hard_gate']:[]),...(localConflict?['semantic_evidence_conflict']:[]),...(qualifies?['qualifying_business_event']:['priority_gate_not_met'])],policy_version:POLICY};
}
async function submit(c,{actorUserId,workspaceId,accountId,messageId,evidence}){
 const validation=validateLocalEvidence(evidence); if(!validation.valid)throw new Error(`local_evidence_rejected:${validation.errors.join(',')}`);
 const target=await c.env.db.prepare(`SELECT e.email_id,e.account_id,e.user_id,e.subject,e.send_email,e.text,e.content,COALESCE(s.state_version,1) state_version FROM email e JOIN workspace_account_bindings wb ON wb.account_id=e.account_id AND wb.workspace_id=?1 AND wb.subject_user_id=?2 AND wb.lifecycle_state='READY' JOIN workspace_members m ON m.workspace_id=wb.workspace_id AND m.user_id=?2 LEFT JOIN mail_canonical_state s ON s.tenant_id=?2 AND s.workspace_id=wb.workspace_id AND s.account_id=e.account_id AND s.message_id=e.email_id WHERE e.email_id=?3 AND e.account_id=?4 AND (e.user_id=?2 OR EXISTS(SELECT 1 FROM mailbox_authorizations ma WHERE ma.grantee_user_id=?2 AND ma.owner_user_id=e.user_id AND ma.owner_account_id=e.account_id AND ma.status='active' AND ma.revoked_at IS NULL))`).bind(workspaceId,actorUserId,messageId,accountId).first();
 if(!target)throw new Error('local_evidence_authority_or_target_denied'); if(Number(target.state_version)!==Number(evidence.messageVersion))throw new Error('local_evidence_stale_message_version'); if(await sha256(stableInput(target))!==evidence.contentDigest)throw new Error('local_evidence_content_digest_mismatch');
 const id=await evidenceIdentity({actorUserId,workspaceId,accountId,messageId,evidence}),expires=new Date(Date.now()+24*60*60*1000).toISOString();
 const projected=Object.fromEntries([...EVIDENCE_KEYS].map(key=>[key,evidence[key]]));
 // The legacy inbound assessment table is not content/version/tenant bound, so it
 // cannot authorize an automated decision for this evidence contract.
 const securityVerdict='unknown';
 const deterministicCandidate=classifyEvidence({subject:target.subject,body:target.text||target.content,securityVerdict});
 const policy=finalizePolicy({deterministic:{category:deterministicCandidate.category,securityVerdict},local:evidence});
 const decisionId=await decisionIdentity(id);
 const evidenceInsert=c.env.db.prepare(`INSERT OR IGNORE INTO mail_local_inference_evidence(id,tenant_id,workspace_id,account_id,message_id,message_version,content_digest,contract_version,prompt_version,model_family,os_version,language,inference_mode,evidence_json,certainty,validation_state,reason_codes_json,generated_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'accepted','["schema_scope_version_digest_valid"]',?16,?17)`).bind(id,actorUserId,workspaceId,accountId,messageId,evidence.messageVersion,evidence.contentDigest,evidence.contractVersion,evidence.promptVersion,evidence.modelFamily,evidence.osVersion,evidence.language,evidence.inferenceMode,JSON.stringify(projected),evidence.certainty,evidence.generatedAt,expires);
 const decisionInsert=c.env.db.prepare(`INSERT OR IGNORE INTO mail_policy_decisions(id,tenant_id,workspace_id,account_id,message_id,state_version,policy_version,evidence_ids_json,content_digest,valid_until,category,is_priority,decision_state,reason_codes_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`).bind(decisionId,actorUserId,workspaceId,accountId,messageId,evidence.messageVersion,POLICY,JSON.stringify([id]),evidence.contentDigest,expires,policy.category,policy.is_priority?1:0,policy.decision_state,JSON.stringify(policy.reason_codes));
 await c.env.db.batch([evidenceInsert,decisionInsert]);
 const authoritative=await c.env.db.prepare(`SELECT id,category,is_priority,decision_state,evidence_ids_json,content_digest,valid_until FROM mail_policy_decisions WHERE id=?1 AND datetime(valid_until)>CURRENT_TIMESTAMP`).bind(decisionId).first();
 return{id,policy_decision_id:authoritative.id,validation_state:'accepted',contract_version:CONTRACT,direct_final_state_write:false,decision_state:authoritative.decision_state,category:authoritative.category,is_priority:Boolean(authoritative.is_priority),valid_until:authoritative.valid_until,content_digest:authoritative.content_digest,idempotent:JSON.parse(authoritative.evidence_ids_json)[0]!==id};
}
export {CONTRACT,POLICY,PROMPT,validateLocalEvidence,finalizePolicy,evidenceIdentity,decisionIdentity,submit}; export default {validateLocalEvidence,finalizePolicy,submit};
