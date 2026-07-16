import {describe,expect,it} from 'vitest';
import {classifyEvidence,CONTRACT_VERSION} from '../../src/service/mail-action-integrity-service.js';
describe('mail classification and action integrity',()=>{
 it('keeps bank origin separate from category and priority',()=>{const r=classifyEvidence({bankOrigin:true,subject:'Welcome to our bank'});expect(r.category).toBe('financial_service');expect(r.is_priority).toBe(false);});
 it('suppresses bank marketing from priority with multiple evidence signals',()=>{const r=classifyEvidence({bankOrigin:true,subject:'Limited time offer - save 20%',body:'Shop now. Unsubscribe',headers:{listUnsubscribe:'x',precedence:'bulk'},actionRequired:true});expect(r.category).toBe('financial_marketing');expect(r.is_priority).toBe(false);expect(r.evidence.length).toBeGreaterThanOrEqual(2);});
 it('recognizes financial events and independently gates priority',()=>{expect(classifyEvidence({subject:'Security alert: unusual sign-in'})).toMatchObject({category:'financial_security',is_priority:true});expect(classifyEvidence({subject:'Your monthly statement is ready'})).toMatchObject({category:'financial_statement',is_priority:false});expect(classifyEvidence({subject:'Transfer completed',body:'Wire transfer received'})).toMatchObject({category:'transfer_notice',is_priority:true});});
 it('publishes a versioned provider-neutral contract',()=>expect(CONTRACT_VERSION).toBe('mail-state-p0-v1'));
});
