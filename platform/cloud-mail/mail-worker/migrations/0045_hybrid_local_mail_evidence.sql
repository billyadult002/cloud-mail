CREATE TABLE IF NOT EXISTS mail_local_inference_evidence (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, message_id INTEGER NOT NULL, message_version INTEGER NOT NULL,
 content_digest TEXT NOT NULL, contract_version TEXT NOT NULL, prompt_version TEXT NOT NULL,
 model_family TEXT NOT NULL, os_version TEXT NOT NULL, language TEXT NOT NULL,
 inference_mode TEXT NOT NULL CHECK(inference_mode IN ('apple_on_device','deterministic_only','server_semantic_fallback','manual_review')),
 evidence_json TEXT NOT NULL, certainty INTEGER NOT NULL CHECK(certainty BETWEEN 0 AND 100),
 validation_state TEXT NOT NULL CHECK(validation_state IN ('accepted','rejected','conflicted','stale')),
 reason_codes_json TEXT NOT NULL, generated_at TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL, UNIQUE(tenant_id,workspace_id,account_id,message_id,message_version,content_digest,model_family,prompt_version,generated_at)
);
CREATE TABLE IF NOT EXISTS mail_policy_decisions (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, message_id INTEGER NOT NULL, state_version INTEGER NOT NULL,
 policy_version TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, content_digest TEXT NOT NULL,
 valid_until TEXT NOT NULL, category TEXT NOT NULL,
 overlays_json TEXT NOT NULL DEFAULT '[]', ranking_band TEXT NOT NULL DEFAULT 'normal',
 is_priority INTEGER NOT NULL DEFAULT 0, decision_state TEXT NOT NULL,
 reason_codes_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,account_id,message_id,content_digest,policy_version,evidence_ids_json)
);
CREATE INDEX IF NOT EXISTS idx_local_evidence_target ON mail_local_inference_evidence(tenant_id,workspace_id,account_id,message_id,message_version,received_at);
CREATE INDEX IF NOT EXISTS idx_mail_policy_target ON mail_policy_decisions(tenant_id,workspace_id,account_id,message_id,state_version);
CREATE TRIGGER IF NOT EXISTS local_evidence_no_update BEFORE UPDATE ON mail_local_inference_evidence BEGIN SELECT RAISE(ABORT,'local_inference_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS local_evidence_no_delete BEFORE DELETE ON mail_local_inference_evidence BEGIN SELECT RAISE(ABORT,'local_inference_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mail_policy_no_update BEFORE UPDATE ON mail_policy_decisions BEGIN SELECT RAISE(ABORT,'mail_policy_decision_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mail_policy_no_delete BEFORE DELETE ON mail_policy_decisions BEGIN SELECT RAISE(ABORT,'mail_policy_decision_append_only'); END;
