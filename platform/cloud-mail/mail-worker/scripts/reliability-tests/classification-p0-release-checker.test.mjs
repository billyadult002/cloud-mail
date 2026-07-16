import {describe,expect,it} from 'vitest';
import {evaluateClassificationRelease} from '../../src/service/classification-release-evaluator.js';

describe('Classification P0 independent release checker',()=>{
 it('rejects invalid scope and windows before it can query or persist release evidence',async()=>{
  const env={db:{prepare(){throw new Error('database must not be queried');}}};
  await expect(evaluateClassificationRelease(env,{tenantId:7,workspaceId:9,windowStart:'2026-07-02T00:00:00.000Z',windowEnd:'2026-07-01T00:00:00.000Z'})).rejects.toThrow('classification_release_window_invalid');
 });

 it('derives release counters exclusively from D1 queries and persists immutable evidence',async()=>{
  const counts=[3,0,0,0,0];let index=0;const calls=[];
  const env={db:{prepare(sql){calls.push(sql);return{bind(){return{first:async()=>({count:counts[index++]}),run:async()=>({meta:{changes:1}})}}}}}};
  const result=await evaluateClassificationRelease(env,{tenantId:7,workspaceId:9,windowStart:'2026-07-01T00:00:00.000Z',windowEnd:'2026-07-02T00:00:00.000Z'});
  expect(result.passed).toBe(true);
  expect(result.counters).toEqual({completedRuns:3,failedJobs:0,staleFences:0,unresolvedScopes:0,unboundCandidates:0});
  expect(calls.at(-1)).toContain('INSERT INTO communication_release_evaluations');
  expect(calls.slice(0,5).every(sql=>sql.includes('SELECT COUNT(*) count'))).toBe(true);
 });

 it('fails a release when authoritative facts show unavailable evidence or a rejected fence',async()=>{
  const counts=[0,0,1,0,0];let index=0;
  const env={db:{prepare(){return{bind(){return{first:async()=>({count:counts[index++]}),run:async()=>({meta:{changes:1}})}}}}}};
  const result=await evaluateClassificationRelease(env,{tenantId:7,workspaceId:9,windowStart:'2026-07-01T00:00:00.000Z',windowEnd:'2026-07-02T00:00:00.000Z'});
  expect(result.passed).toBe(false);
  expect(result.unavailable).toContain('no_completed_classification_runs');
  expect(result.counters.staleFences).toBe(1);
 });
});
