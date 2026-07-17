import{describe,it,expect}from'vitest';
import{DEFAULT_OUTBOX_DRAIN_LIMIT,MAX_OUTBOX_DRAIN_LIMIT,outboxDrainLimit,V3_SCHEDULED_LIMIT}from'../../src/service/unified-conversation-backfill-service.js';
describe('UCS outbox drain limit',()=>{
 it('preserves default 2',()=>expect(outboxDrainLimit({})).toBe(2));
 it('accepts the staging sweep candidates',()=>{for(const value of ['2','10','15','20','25'])expect(outboxDrainLimit({UCS_OUTBOX_DRAIN_LIMIT:value})).toBe(Number(value));});
 it('falls back for invalid values',()=>{for(const value of ['', 'NaN','Infinity','0','-1','2.5'])expect(outboxDrainLimit({UCS_OUTBOX_DRAIN_LIMIT:value})).toBe(DEFAULT_OUTBOX_DRAIN_LIMIT);});
 it('clamps excessive values',()=>expect(outboxDrainLimit({UCS_OUTBOX_DRAIN_LIMIT:'1000'})).toBe(MAX_OUTBOX_DRAIN_LIMIT));
 it('does not change V3 batch size',()=>expect(V3_SCHEDULED_LIMIT).toBe(5));
});
