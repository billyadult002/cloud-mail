import{describe,it,expect}from'vitest';
import{FACET_DIMENSIONS,COMMITMENT_STATES,projectionSurfaceMatch,deriveProjection,validateObservation}from'../../src/service/unified-conversation-service.js';
import{isReclaimableOutboxLease,isTerminalCanonicalTombstone,V3_SCHEDULED_LIMIT,v3ScheduleForScope}from'../../src/service/unified-conversation-backfill-service.js';

describe('Unified Conversation System contracts',()=>{
 it('schedules fenced V3 rematerialization for every dual-write workspace scope',()=>{
  expect(v3ScheduleForScope({tenant_id:1,workspace_id:1})).toEqual({enabled:true,limit:V3_SCHEDULED_LIMIT});
  expect(v3ScheduleForScope({tenant_id:1,workspace_id:2})).toEqual({enabled:true,limit:V3_SCHEDULED_LIMIT});
 });
 it('declares every required extensible facet dimension',()=>{
  expect(FACET_DIMENSIONS).toEqual(expect.arrayContaining(['Security','Identity','Origin','Intent','Relationship','Event','Actionability','Category','Overlay','Ranking','Risk','Domain']));
 });
 it('declares the product commitment lifecycle without classification states',()=>{
  expect(COMMITMENT_STATES).toEqual(['WaitingForMe','WaitingForOthers','Resolved','Delegated','Scheduled','Blocked','Cancelled']);
 });
 it('keeps one primary category while preserving independent overlays and waiting queues',()=>{
  const aggregate={id:'conversation:1',aggregate_version:4,last_observed_at:'2026-07-13T00:00:00Z'};
  const facets=[
   {dimension_key:'Category',value_key:'Finance',status:'supported',confidence:.9,explanation_code:'invoice'},
   {dimension_key:'Overlay',value_key:'Customer',status:'supported',confidence:.8,explanation_code:'relationship'},
   {dimension_key:'Risk',value_key:'elevated',status:'supported',confidence:.7,explanation_code:'link'}
  ];
  const projection=deriveProjection({aggregate,facets,commitments:[{id:'c1',state:'WaitingForMe'},{id:'c2',state:'WaitingForOthers'}]});
  expect(projection.category_keys).toEqual(['Finance']);expect(projection.facet_summary.Overlay).toEqual([{value:'Customer',confidence:.8,explanation:'relationship'}]);expect(projection.waiting_for_me).toBe(1);expect(projection.waiting_for_others).toBe(1);expect(projection.action_required).toBe(1);expect(projection.risk_key).toBe('elevated');
 });
 it('derives named surfaces only from projection fields',()=>{
  const row={canonical_folder_key:'inbox',action_required:1,waiting_for_me:1,waiting_for_others:0,mission_ids_json:'["m1"]',category_keys_json:'["Finance"]',membership_keys_json:'["vip","unread","starred","attachments"]'};
  expect(projectionSurfaceMatch(row,'all_mail')).toBe(true);expect(projectionSurfaceMatch(row,'categories','Finance')).toBe(true);expect(projectionSurfaceMatch(row,'action_required')).toBe(true);expect(projectionSurfaceMatch(row,'waiting_for_me')).toBe(true);expect(projectionSurfaceMatch(row,'waiting_for_others')).toBe(false);expect(projectionSurfaceMatch(row,'mission_control')).toBe(true);
  for(const membership of ['vip','unread','starred','attachments'])expect(projectionSurfaceMatch(row,'categories',membership)).toBe(true);
 });
 it('keeps state memberships distinct from Facet Category keys',()=>{
  const projection=deriveProjection({aggregate:{id:'conversation:membership',aggregate_version:1},facets:[{dimension_key:'Category',value_key:'priority',status:'supported',confidence:1,explanation_code:'facet'}],display:{membershipKeys:['vip','unread','starred','attachments']}});
  expect(projection.category_keys).toEqual(['priority']);
  expect(projection.membership_keys).toEqual(['attachments','starred','unread','vip']);
 });
 it('rejects incomplete provider observations without failing a page contract',()=>{
  expect(validateObservation({providerKey:'gmail'})).toEqual({valid:false,missing:['accountId','providerConversationRefHash','providerMessageRefHash','observedAt','integrityHash']});
 });
 it('keeps workflow membership in the current evidence-bound commitment state',()=>{
  const projection=deriveProjection({aggregate:{id:'conversation:2',aggregate_version:1},commitments:[{id:'resolved',state:'Resolved'},{id:'open',state:'WaitingForMe'}]});
  expect(projection.active_commitment_ids).toEqual(['open']);
  expect(projection.action_required).toBe(1);
  expect(projection.waiting_for_me).toBe(1);
 });
 it('reclaims only expired processing leases and never an active owner lease',()=>{
  const now=Date.parse('2026-07-13T12:55:00Z');
  expect(isReclaimableOutboxLease({state:'processing',leaseUntil:'2026-07-13T12:54:59Z',now})).toBe(true);
  expect(isReclaimableOutboxLease({state:'processing',leaseUntil:'2026-07-13T12:55:01Z',now})).toBe(false);
  expect(isReclaimableOutboxLease({state:'processed',leaseUntil:null,now})).toBe(false);
  expect(isReclaimableOutboxLease({state:'failed',leaseUntil:null,now})).toBe(true);
 });
 it('settles a deleted canonical event without a conversation as source removed',()=>{
  expect(isTerminalCanonicalTombstone({row:{is_del:1},existing:null})).toBe(true);
  expect(isTerminalCanonicalTombstone({row:{is_del:0},existing:null})).toBe(false);
  expect(isTerminalCanonicalTombstone({row:{is_del:1},existing:{conversation_id:'conversation:1'}})).toBe(false);
 });
});
