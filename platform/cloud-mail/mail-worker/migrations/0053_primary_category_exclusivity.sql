-- Primary category is an exclusive conversation dimension.  This is additive:
-- historical results remain append-only; only current heads are constrained.
CREATE TRIGGER IF NOT EXISTS conversation_primary_category_head_exclusive
BEFORE INSERT ON conversation_facet_heads
WHEN NEW.dimension_key='Category' AND EXISTS (
 SELECT 1 FROM conversation_facet_heads h
 WHERE h.tenant_id=NEW.tenant_id
   AND h.workspace_id=NEW.workspace_id
   AND h.conversation_id=NEW.conversation_id
   AND h.dimension_key='Category'
   AND h.value_key<>NEW.value_key
)
BEGIN SELECT RAISE(ABORT,'conversation_primary_category_head_exclusive'); END;
