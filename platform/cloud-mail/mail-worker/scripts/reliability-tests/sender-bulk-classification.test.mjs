import {describe,expect,it} from 'vitest';
import {CONTRACT_VERSION,normalizeSender} from '../../src/service/sender-bulk-classification-service.js';
import {computeVirtualReplacementCategorySet,PRIMARY_CATEGORY_DIMENSION,validateClassificationMutationContext,commitAtomicClassificationMutation,interpretAtomicCommit} from '../../src/service/atomic-classification-mutation-service.js';
import {linkedRetryPreflight} from '../../src/service/sender-bulk-reconciliation-service.js';

describe('sender bulk classification contract',()=>{
 it('uses the narrow exact normalized address and never display-name/domain matching',()=>{
  expect(normalizeSender('The Children\'s Place <Offers+west@Example.COM>')).toBe('offers+west@example.com');
  expect(normalizeSender('Offers+east@example.com')).not.toBe(normalizeSender('Offers+west@example.com'));
  expect(normalizeSender('The Children\'s Place')).toBe('the children\'s place');
 });
 it('publishes the versioned atomic one-time sender classification contract',()=>expect(CONTRACT_VERSION).toBe('sender-bulk-classification-v2-atomic'));
 it('replaces every current primary category while preserving independent facets',()=>{
  const virtual=computeVirtualReplacementCategorySet({destinationKey:'work',current:{heads:[
   {dimension_key:PRIMARY_CATEGORY_DIMENSION,value_key:'promotions',current_result_id:'category-1'},
   {dimension_key:'Risk',value_key:'normal',current_result_id:'risk-1'},
   {dimension_key:'Overlay',value_key:'vip',current_result_id:'vip-1'}
  ]}});
  expect(virtual.beforeCategories).toEqual(['promotions']);
  expect(virtual.afterCategories).toEqual(['work']);
  expect(virtual.removedCategories).toEqual(['promotions']);
  expect(virtual.retainedResultIds).toEqual(['risk-1','vip-1']);
 });
 it.each(['general','transactions','work','Primary','Promotions','Social','Updates','Forums','custom_primary'])('uses one exclusive family for %s',destinationKey=>{
  const virtual=computeVirtualReplacementCategorySet({destinationKey,current:{heads:[{dimension_key:PRIMARY_CATEGORY_DIMENSION,value_key:'promotions',current_result_id:'old'}]}});
  expect(virtual.categoryFamily).toBe(PRIMARY_CATEGORY_DIMENSION);
  expect(virtual.afterCategories).toEqual([destinationKey]);
  expect(virtual.beforeCategories).toEqual(['promotions']);
 });
 it('rejects ready or missing checkpoint leases before any classification write can be planned',async()=>{
  const replies=[null];
  const env={db:{prepare:()=>({bind:()=>({first:async()=>replies.shift()})})}};
  await expect(validateClassificationMutationContext(env,{tenantId:1,workspaceId:2,conversationId:'c',sourceMessageId:3,sourceVersion:'v1',checkpointId:'cp',leaseOwner:'owner',leaseGeneration:1,destinationKey:'promotions'})).rejects.toThrow('classification_mutation_checkpoint_fence_invalid');
 });
 it('treats a batch rejection as non-committed and leaves the test state untouched',async()=>{
  const state={currentCategory:'general',projection:'projection-old',completed:false};
  const env={db:{batch:async()=>{throw new Error('injected_snapshot_failure');}}};
  const result=await interpretAtomicCommit(()=>commitAtomicClassificationMutation(env,{statements:[{}]}));
  expect(result.committed).toBe(false);
  expect(String(result.error)).toContain('injected_snapshot_failure');
  expect(state).toEqual({currentCategory:'general',projection:'projection-old',completed:false});
 });
 it('admits only a same-workspace eligible Promotions retry matrix',()=>{
  const original={id:'original',tenant_id:7,workspace_id:2,destination_type:'classification',destination_key:'promotions'};
  const matrix=[{operation_id:'original',tenant_id:7,workspace_id:2,disposition:'retry_atomic_promotions',current_eligibility:'eligible_for_linked_atomic_retry'}];
  expect(linkedRetryPreflight({original,matrix,workspaceId:2,actorUserId:7})).toEqual(matrix);
  expect(()=>linkedRetryPreflight({original:{...original,destination_key:'work'},matrix,workspaceId:2,actorUserId:7})).toThrow('sender_bulk_linked_retry_destination_not_supported');
  expect(()=>linkedRetryPreflight({original,matrix:[{...matrix[0],current_eligibility:'not_eligible_at_current_snapshot'}],workspaceId:2,actorUserId:7})).toThrow('sender_bulk_linked_retry_current_state_not_eligible');
 });
});
