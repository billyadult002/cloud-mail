import {describe,expect,it} from 'vitest';
import evaluationCases from '../fixtures/classification-eval-v1.json';
import {LAYERS,VERSION,classifyMessage,threadToMissionDecision,evaluateDataset} from '../../src/service/classification-intelligence-service.js';

describe('classification commitment and thread-to-mission intelligence',()=>{
	it('keeps the ten contracts ordered and independent',()=>{
		expect(LAYERS).toEqual(['security','identity','origin','intent','relationship','event','actionability','category','overlay','ranking']);
		const result=classifyMessage({sender:'person@example.com',subject:'Please review by Friday',body:'Can you approve this proposal?'});
		expect(Object.keys(result.layers)).toEqual(LAYERS);
		expect(result.layers.intent.output.labels).toContain('request');
		expect(result.layers.event.output.labels).toContain('deadline_observed');
		expect(result.layers.actionability.output.candidates[0].deadline_present).toBe(true);
		expect(result.layers.category.output.value).toBe('work');
		expect(result.layers.overlay.output.values).toContain('deadline');
		expect(VERSION).toBe('classification-p0-v1');
	});
	it('blocks suspicious mail before priority or actionability can create a mission',()=>{
		const classification=classifyMessage({sender:'attacker@example.com',subject:'Urgent wire',body:'Please verify your password and send a gift card'});
		expect(classification.layers.ranking.output.band).toBe('security_review');
		expect(threadToMissionDecision({classification}).decision).toBe('blocked_by_security');
	});
	it('does not assign an unresolved identity or automate notifications into commitments',()=>{
		const unknown=classifyMessage({subject:'Please approve',body:'Need you to decide'});
		expect(unknown.layers.identity.status).toBe('unknown');
		expect(threadToMissionDecision({classification:unknown}).decision).toBe('human_review_required');
		const automated=classifyMessage({sender:'noreply@example.com',subject:'Order confirmation',body:'Do not reply. Receipt attached.'});
		expect(automated.signals.automated).toBe(true);
		expect(automated.signals.promise).toBe(false);
		expect(threadToMissionDecision({classification:automated,evidenceSufficient:true,conversationComplete:true,authorityContext:true}).decision).toBe('information_only');
		const noisyAutomated=classifyMessage({sender:'notification@example.com',subject:'Please review your account update',body:'Please review this automated notification. Do not reply.'});
		expect(noisyAutomated.signals.request).toBe(true);
		expect(threadToMissionDecision({classification:noisyAutomated,evidenceSufficient:true,conversationComplete:true,authorityContext:true}).decision).toBe('information_only');
	});
	it('abstains on insufficient evidence and suppresses duplicate missions',()=>{
		const classification=classifyMessage({sender:'person@example.com',subject:'Approval needed',body:'Could you review and approve by tomorrow?'});
		expect(threadToMissionDecision({classification,evidenceSufficient:false}).decision).toBe('insufficient_evidence');
		expect(threadToMissionDecision({classification,evidenceSufficient:true,conversationComplete:true,duplicate:true,authorityContext:true}).decision).toBe('duplicate_existing_mission');
		expect(threadToMissionDecision({classification,evidenceSufficient:true,conversationComplete:true,authorityContext:false}).decision).toBe('blocked_by_authority');
	});
	it('separates commitment candidate from a request and never grants provider action',()=>{
		const promise=classifyMessage({sender:'person@example.com',subject:'Delivery',body:'We will provide the report by Friday.'});
		expect(promise.signals.promise).toBe(true);
		expect(promise.signals.request).toBe(false);
		expect(threadToMissionDecision({classification:promise,evidenceSufficient:true,conversationComplete:true,authorityContext:true}).decision).toBe('mission_candidate');
		expect(promise.layers.ranking.output).not.toHaveProperty('authority');
	});
	it('meets the versioned safety evaluation release gates',()=>{
		const metrics=evaluateDataset(evaluationCases);
		expect(metrics).toMatchObject({dataset_version:'classification-eval-v1',cases:8,security_false_negative:0,security_false_positive:0,unsafe_mission_creation_rate:0,false_automated_commitment_rate:0,duplicate_mission_rate:0,thresholds_passed:true});
		expect(metrics.origin_accuracy).toBeGreaterThanOrEqual(.875);
		expect(metrics.thread_to_mission_accuracy).toBeGreaterThanOrEqual(.875);
	});
});
