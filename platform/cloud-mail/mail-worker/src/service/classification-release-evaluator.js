const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);

async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

// All counters come from D1 at evaluation time.  Callers can select only scope,
// time window and the release policy; they cannot supply or override counters.
async function evaluateClassificationRelease(env,{tenantId,workspaceId,windowStart,windowEnd,classifierVersion='classification-p0-v1',policyVersion='thread-to-mission-p0-v1'}={}){
 if(!Number.isInteger(Number(tenantId))||!Number.isInteger(Number(workspaceId))||!windowStart||!windowEnd)throw new Error('classification_release_scope_required');
 if(Date.parse(windowStart)>=Date.parse(windowEnd))throw new Error('classification_release_window_invalid');
 const queries={
  completedRuns:`SELECT COUNT(*) count FROM communication_classification_runs WHERE tenant_id=?1 AND workspace_id=?2 AND classifier_version=?3 AND state='completed' AND created_at>=?4 AND created_at<?5`,
  failedJobs:`SELECT COUNT(*) count FROM nexora_autonomy_jobs WHERE user_id=?1 AND job_type='CLASSIFY_THREAD_TO_MISSION' AND state='FAILED' AND updated_at>=?4 AND updated_at<?5`,
  staleFences:`SELECT COUNT(*) count FROM communication_fencing_rejections r JOIN nexora_autonomy_jobs j ON j.id=r.job_id WHERE j.user_id=?1 AND r.created_at>=?4 AND r.created_at<?5`,
  unresolvedScopes:`SELECT COUNT(*) count FROM communication_commitments WHERE tenant_id=?1 AND workspace_id=?2 AND legacy_scope_state!='resolved'`,
  unboundCandidates:`SELECT COUNT(*) count FROM communication_mission_candidates WHERE tenant_id=?1 AND workspace_id=?2 AND (account_id IS NULL OR job_id IS NULL OR fencing_generation IS NULL) AND created_at>=?4 AND created_at<?5`
 };
 const parameters=[Number(tenantId),Number(workspaceId),classifierVersion,windowStart,windowEnd];
 const counters={};
 for(const [key,sql] of Object.entries(queries)){const row=await env.db.prepare(sql).bind(...parameters).first();counters[key]=Number(row?.count||0);}
 const unavailable=[];
 if(counters.completedRuns===0)unavailable.push('no_completed_classification_runs');
 const passed=unavailable.length===0&&counters.failedJobs===0&&counters.staleFences===0&&counters.unresolvedScopes===0&&counters.unboundCandidates===0;
 const queryDigest=await digest({queries,parameters,policyVersion});
 const id=`classification-release:${await digest({tenantId,workspaceId,windowStart,windowEnd,classifierVersion,policyVersion,queryDigest})}`;
 await env.db.prepare(`INSERT INTO communication_release_evaluations(id,tenant_id,workspace_id,window_start,window_end,classifier_version,policy_version,counters_json,unavailable_json,passed,query_digest) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(id,Number(tenantId),Number(workspaceId),windowStart,windowEnd,classifierVersion,policyVersion,JSON.stringify(counters),JSON.stringify(unavailable),passed?1:0,queryDigest).run();
 return{id,counters,unavailable,passed,queryDigest};
}

export{evaluateClassificationRelease};
export default{evaluateClassificationRelease};
