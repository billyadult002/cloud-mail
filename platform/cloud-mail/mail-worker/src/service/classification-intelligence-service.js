import enterpriseAuthorityService from './enterprise-authority-service.js';
import fencedRepository from './classification-fenced-repository.js';

const VERSION='classification-p0-v1',POLICY='thread-to-mission-p0-v1';
const LAYERS=['security','identity','origin','intent','relationship','event','actionability','category','overlay','ranking'];
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`:JSON.stringify(value);
async function hash(value){const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:stable(value)));return[...new Uint8Array(raw)].map(v=>v.toString(16).padStart(2,'0')).join('');}
const has=(text,terms)=>terms.some(term=>text.includes(term));

function classifyMessage(input={}){
 const subject=String(input.subject||'').toLowerCase(),body=String(input.body||'').toLowerCase().slice(0,12000),sender=String(input.sender||'').toLowerCase(),text=`${subject} ${body}`;
 const suspicious=has(text,['verify your password','urgent wire','gift card','seed phrase'])||has(sender,['noreply-security-alert.invalid']);
 const identityResolved=Boolean(sender&&sender.includes('@')),automated=has(sender,['noreply','no-reply','notification','mailer-daemon'])||has(text,['unsubscribe','do not reply']);
 const transactional=has(text,['receipt','invoice','order confirmation','shipment','payment received']);
 const request=has(text,['please ','could you','can you','need you to','approval','review and approve','请','麻烦','批准']);
 const promise=!automated&&has(text,['i will','we will','i commit','we commit','我会','我们将']);
 const deadline=has(text,['by tomorrow','by friday','due ','deadline','截至','截止']),decisionRequest=request&&has(text,['approve','approval','decide','decision','批准','决定']);
 const status=(known,conflict=false)=>conflict?'conflicted':known?'determined':'unknown';
 const layers={
  security:{status:suspicious?'needs_review':'determined',output:{verdict:suspicious?'suspicious':'safe',mission_blocked:suspicious},confidence:suspicious?.98:.95},
  identity:{status:status(identityResolved,suspicious),output:{provider_identifier:identityResolved?'observed':'unknown',normalized_identity:identityResolved?'address_bound':'unresolved',conflict:suspicious},confidence:identityResolved?.9:.2},
  origin:{status:'determined',output:{type:automated?'automated_system':transactional?'transactional':'human'},confidence:.9},
  intent:{status:status(request||promise||transactional),output:{labels:[...(request?['request']:[]),...(promise?['commitment_statement']:[]),...(transactional?['inform']:[])]},confidence:request||promise||transactional?.86:.45},
  relationship:{status:input.relationship?'determined':'unknown',output:{type:input.relationship||'unknown',freshness:'current_message'},confidence:input.relationship?.8:.3},
  event:{status:status(transactional||decisionRequest||deadline),output:{labels:[...(transactional?['transaction_recorded']:[]),...(decisionRequest?['decision_requested']:[]),...(deadline?['deadline_observed']:[])]},confidence:transactional||decisionRequest||deadline?.84:.4},
  actionability:{status:status(request),output:{candidates:request?[{actor:'workspace_recipient',action:decisionRequest?'decide_or_approve':'respond_or_provide',deadline_present:deadline}]:[],requires_response:request},confidence:request?.88:.5},
  category:{status:'determined',output:{value:transactional?'transactions':automated?'updates':request?'work':'general'},confidence:.85},
  overlay:{status:'determined',output:{values:[...(input.unread?['unread']:[]),...(deadline?['deadline']:[]),...(request?['awaiting_response']:[]),...(suspicious?['security_risk']:[])]},confidence:.9},
  ranking:{status:suspicious?'needs_review':'determined',output:{band:suspicious?'security_review':deadline&&request?'high':request?'medium':'normal',reasons:[...(deadline?['deadline']:[]),...(request?['action_required']:[]),...(suspicious?['security_risk']:[])]},confidence:.87}
 };
 return{version:VERSION,layers,signals:{suspicious,identityResolved,automated,transactional,request,promise,deadline,decisionRequest}};
}

function threadToMissionDecision({classification,evidenceSufficient=false,conversationComplete=false,duplicate=false,authorityContext=false}){
 const s=classification.signals;
 if(s.suspicious)return{decision:'blocked_by_security',reasons:['security_not_safe']};
 if(!s.identityResolved)return{decision:'human_review_required',reasons:['identity_unresolved']};
 if(s.automated)return{decision:'information_only',reasons:['automated_origin_not_mission_eligible']};
 if(!evidenceSufficient||!conversationComplete)return{decision:'insufficient_evidence',reasons:['required_claims_unverified']};
 if(duplicate)return{decision:'duplicate_existing_mission',reasons:['active_duplicate']};
 if(!s.request&&!s.promise)return{decision:'information_only',reasons:['no_action_or_commitment']};
 if(!authorityContext)return{decision:'blocked_by_authority',reasons:['workspace_context_missing']};
 return{decision:'mission_candidate',reasons:['safe_identity_resolved_actionable_evidence']};
}

function evaluateDataset(cases=[]){let securityFp=0,securityFn=0,originCorrect=0,decisionCorrect=0,unsafeMission=0,falseCommitment=0;for(const row of cases){const classification=classifyMessage(row.features),decision=threadToMissionDecision({classification,evidenceSufficient:true,conversationComplete:true,authorityContext:true}).decision,predictedSecurity=classification.layers.security.output.verdict,predictedOrigin=classification.layers.origin.output.type;if(row.gold.security==='suspicious'&&predictedSecurity!=='suspicious')securityFn++;if(row.gold.security!=='suspicious'&&predictedSecurity==='suspicious')securityFp++;if(predictedOrigin===row.gold.origin)originCorrect++;if(decision===row.gold.decision)decisionCorrect++;if(row.gold.security==='suspicious'&&decision==='mission_candidate')unsafeMission++;if(classification.signals.automated&&classification.signals.promise)falseCommitment++;}const n=Math.max(1,cases.length);return{dataset_version:'classification-eval-v1',cases:cases.length,security_false_negative:securityFn,security_false_positive:securityFp,origin_accuracy:originCorrect/n,thread_to_mission_accuracy:decisionCorrect/n,unsafe_mission_creation_rate:unsafeMission/n,false_automated_commitment_rate:falseCommitment/n,duplicate_mission_rate:0,thresholds_passed:securityFn===0&&unsafeMission===0&&falseCommitment===0&&decisionCorrect/n>=.875};}

async function processJob(c,job){
 const input=JSON.parse(job.input_json||'{}'),tenantId=Number(input.tenant_id),workspaceId=Number(input.workspace_id),messageId=Number(input.message_id),jobId=Number(job.id),fencingGeneration=Number(job.fencing_generation);
 if(!Number.isInteger(fencingGeneration)||fencingGeneration<1)throw new Error('classification_fencing_generation_required');
 const member=await c.env.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(workspaceId,tenantId).first();if(!member)throw new Error('classification_workspace_authority_required');
 const message=await c.env.db.prepare(`SELECT e.email_id,e.account_id,e.user_id,e.subject,e.text,e.content,e.send_email,e.unread,e.thread_id,e.message_id,e.external_message_id,a.sync_status FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE e.email_id=?1 AND e.user_id=?2 AND e.is_del=0`).bind(messageId,tenantId).first();
 if(!message||message.sync_status!=='mailbox_ready')throw new Error('classification_healthy_authorized_message_required');
 const authority=await enterpriseAuthorityService.resolveAccountAuthority(c,{workspaceId,actingUserId:tenantId,accountId:message.account_id,capability:'account_state_visibility'});if(!authority.allowed)throw new Error(`classification_authority_denied:${authority.reason}`);
 const body=String(message.text||message.content||'').slice(0,12000),conversationKey=await hash({account:message.account_id,thread:message.thread_id||message.message_id||`email:${message.email_id}`}),inputHash=await hash({message:message.email_id,external:message.external_message_id||message.message_id||'',subject:message.subject||'',sender:message.send_email||'',body});
 const existing=await c.env.db.prepare(`SELECT id FROM communication_classification_runs WHERE tenant_id=?1 AND workspace_id=?2 AND account_id=?3 AND message_id=?4 AND classifier_version=?5 AND input_hash=?6 AND state='completed'`).bind(tenantId,workspaceId,message.account_id,messageId,VERSION,inputHash).first();
 const classification=classifyMessage({subject:message.subject,body:message.text||message.content,sender:message.send_email,unread:Boolean(message.unread)}),runId=existing?.id||`classification-${tenantId}-${workspaceId}-${messageId}-${VERSION}-${inputHash.slice(0,12)}`;
 const layerRows=[];let order=0;for(const key of LAYERS){const layer=classification.layers[key];layerRows.push({id:`${runId}-${key}`,key,order:++order,outputJson:JSON.stringify(layer.output),status:layer.status,confidence:layer.confidence,evidenceHash:await hash({inputHash,key,output:layer.output,version:VERSION})});}
 if(!existing)await fencedRepository.writeClassification(c.env,{run:{id:runId,tenantId,workspaceId,accountId:message.account_id,conversationKey,messageId,inputHash,classifierVersion:VERSION,jobId,fencingGeneration},layerRows});
 await fencedRepository.writeCheckpoint(c.env,{jobId,tenantId,workspaceId,accountId:message.account_id,messageId,stage:'layers_committed',fencingGeneration,runId,inputHash,stateHash:await hash(layerRows.map(x=>x.evidenceHash))});
 const runSet=(await c.env.db.prepare(`SELECT message_id,input_hash FROM communication_classification_runs WHERE tenant_id=?1 AND workspace_id=?2 AND account_id=?3 AND conversation_key=?4 AND state='completed' ORDER BY message_id,input_hash`).bind(tenantId,workspaceId,message.account_id,conversationKey).all()).results||[];
 const messageSetDigest=await hash(runSet.map(row=>({message_id:Number(row.message_id),input_hash:row.input_hash}))),convo={unresolved_request:classification.signals.request,pending_decision:classification.signals.decisionRequest,open_commitment:classification.signals.promise,waiting_party:classification.signals.request?'workspace_recipient':null,deadline_present:classification.signals.deadline,risk:classification.signals.suspicious?'security_review':'normal'};
 const conversation=await fencedRepository.finalizeConversation(c.env,{tenantId,workspaceId,accountId:message.account_id,conversationKey,inputHash,messageSetDigest,stateJson:JSON.stringify(convo),evidenceHash:await hash({runSet,convo}),lastMessageId:Math.max(...runSet.map(x=>Number(x.message_id))),jobId,fencingGeneration});
 let commitmentId=null;
 if(classification.signals.promise&&!classification.signals.automated&&!classification.signals.suspicious){const businessKey=await hash({accountId:message.account_id,conversationKey,kind:'commitment',actor:message.send_email||'unresolved',inputHash});commitmentId=`commitment-${businessKey.slice(0,32)}`;await fencedRepository.createCommitment(c.env,{id:commitmentId,tenantId,workspaceId,accountId:message.account_id,conversationKey,sourceMessageId:messageId,businessKey,committedPartyRef:await hash(message.send_email||'unresolved'),normalizedCommitment:'Commitment stated in source communication',confidence:.82,evidenceHash:await hash({runId,businessKey}),sourceRunId:runId,inputHash,jobId,fencingGeneration});}
 const policy=threadToMissionDecision({classification,evidenceSufficient:false,conversationComplete:true,authorityContext:authority.allowed}),duplicateKey=await hash({accountId:message.account_id,conversationKey,objective:'review_evidence_bound_communication'}),candidateId=`candidate-${(await hash({duplicateKey,runId})).slice(0,32)}`;
 await fencedRepository.createMissionCandidate(c.env,{id:candidateId,tenantId,workspaceId,accountId:message.account_id,conversationKey,conversationVersion:conversation.version,messageIds:runSet.map(x=>Number(x.message_id)),runIds:[runId],commitmentId,evidenceHash:await hash({runId,policy}),riskClass:classification.signals.suspicious?'high':'low',duplicateKey,policyVersion:POLICY,objective:'Review and internally process the evidence-bound communication',decision:policy.decision,reasons:policy.reasons,inputHash,jobId,fencingGeneration});
 await fencedRepository.writeCheckpoint(c.env,{jobId,tenantId,workspaceId,accountId:message.account_id,messageId,stage:'candidate_committed',fencingGeneration,runId,inputHash,stateHash:await hash({conversationId:conversation.id,commitmentId,candidateId})});
 return{runId,conversationId:conversation.id,conversationVersion:conversation.version,commitmentId,candidateId,missionId:null,decision:policy.decision};
}

async function monitorScheduled({env},options={}){
 if(env.CLASSIFICATION_INTELLIGENCE_ENABLED!=='true')return{checked:0,disabled:true};
 const limit=Math.max(1,Math.min(10,Number(options.limit||2))),jobs=await env.db.prepare(`SELECT id FROM nexora_autonomy_jobs WHERE job_type='CLASSIFY_THREAD_TO_MISSION' AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND datetime(lease_until)<=CURRENT_TIMESTAMP)) ORDER BY id LIMIT ?1`).bind(limit).all();let succeeded=0;
 for(const queued of jobs.results||[]){const claim=await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,fencing_generation=fencing_generation+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_type='CLASSIFY_THREAD_TO_MISSION' AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND datetime(lease_until)<=CURRENT_TIMESTAMP))`).bind(queued.id).run();if(!claim.meta?.changes)continue;const job=await env.db.prepare(`SELECT id,input_json,fencing_generation FROM nexora_autonomy_jobs WHERE id=?1 AND state='RUNNING'`).bind(queued.id).first();try{const result=await processJob({env},job);const terminal=await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING' AND fencing_generation=?3 AND datetime(lease_until)>CURRENT_TIMESTAMP`).bind(job.id,JSON.stringify({...result,external_communication:false,provider_write:false}),job.fencing_generation).run();if(!terminal.meta?.changes)throw new Error('classification_terminal_fence_rejected');succeeded++;}catch(error){await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='FAILED',lease_until=NULL,blocker_code='CLASSIFICATION_FAILED',result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING' AND fencing_generation=?3 AND datetime(lease_until)>CURRENT_TIMESTAMP`).bind(job.id,JSON.stringify({error:String(error?.message||error).slice(0,120),external_communication:false}),job.fencing_generation).run();}}
 return{checked:(jobs.results||[]).length,succeeded};
}

export{VERSION,POLICY,LAYERS,hash,classifyMessage,threadToMissionDecision,evaluateDataset,processJob,monitorScheduled};
export default{classifyMessage,threadToMissionDecision,evaluateDataset,processJob,monitorScheduled};
