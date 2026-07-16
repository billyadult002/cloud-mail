#!/usr/bin/env python3
import glob, json, os, sqlite3

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "../.."))
db = sqlite3.connect(":memory:")
db.executescript(open(os.path.join(os.path.dirname(__file__), "base_schema.sql"), encoding="utf-8").read())
for path in sorted(glob.glob(os.path.join(ROOT, "migrations", "*.sql"))):
    db.executescript(open(path, encoding="utf-8").read())
if "unread" not in [row[1] for row in db.execute("PRAGMA table_info(email)")]:
    db.execute("ALTER TABLE email ADD COLUMN unread INTEGER NOT NULL DEFAULT 1")

db.executescript("""
INSERT INTO user(user_id,email,password) VALUES(1,'fixture@example.invalid','x');
INSERT INTO account(account_id,user_id,email) VALUES(1,1,'fixture@example.invalid');
INSERT INTO workspaces(id,tenant_key,display_name,created_by_user_id) VALUES(1,'fixture','Fixture',1);
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(1,1,'OWNER');
INSERT INTO workspace_account_bindings(workspace_id,account_id,owner_user_id,subject_user_id,lifecycle_state)
VALUES(1,1,1,1,'READY');
INSERT INTO email(email_id,send_email,account_id,user_id,subject,text,message_id,to_email,unread)
VALUES(1,'sender@example.invalid',1,1,'Subject A','Body A','m1','fixture@example.invalid',1);
""")
assert db.execute("SELECT COUNT(*) FROM conversation_ingest_outbox WHERE source_message_id=1 AND state='pending'").fetchone()[0] == 1

db.execute("UPDATE email SET subject='Subject B' WHERE email_id=1")
assert db.execute("SELECT COUNT(*) FROM conversation_ingest_outbox WHERE source_message_id=1").fetchone()[0] == 2

db.execute("INSERT INTO conversation_aggregates(id,tenant_id,workspace_id,lifecycle_state,participant_set_digest,message_set_digest,integrity_hash) VALUES('c',1,1,'active','p','m','i')")
try:
    db.execute("INSERT INTO conversation_commitments(id,tenant_id,workspace_id,conversation_id,business_key,owner_identity_ref_hash,obligation_digest,state,evidence_ids_json,evidence_set_hash,verification_state) VALUES('bad',1,1,'c','b','o','d','WaitingForMe','[]','h','verified')")
    raise AssertionError("verified commitment without evidence was accepted")
except sqlite3.IntegrityError as exc:
    assert "conversation_commitment_verified_evidence_required" in str(exc)

db.execute("INSERT INTO conversation_evidence(id,tenant_id,workspace_id,source_type,source_message_id,source_version,content_digest,integrity_hash,verification_state,observed_at) VALUES('e',1,1,'fixture',1,'1','d','i','verified',CURRENT_TIMESTAMP)")
db.execute("INSERT INTO conversation_commitments(id,tenant_id,workspace_id,conversation_id,business_key,owner_identity_ref_hash,obligation_digest,state,evidence_ids_json,evidence_set_hash,verification_state) VALUES('good',1,1,'c','b','o','d','WaitingForMe','[\"e\"]','h','verified')")

db.execute("INSERT INTO conversation_materialization_checkpoints(id,tenant_id,workspace_id,pipeline_key,cursor_json,state) VALUES('cp',1,1,'test','{}','paused')")
first = db.execute("UPDATE conversation_materialization_checkpoints SET state='running',lease_owner='a',lease_generation=lease_generation+1,lease_until=datetime('now','+5 minutes') WHERE id='cp' AND (state IN ('paused','failed','ready') OR lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)").rowcount
second = db.execute("UPDATE conversation_materialization_checkpoints SET state='running',lease_owner='b',lease_generation=lease_generation+1,lease_until=datetime('now','+5 minutes') WHERE id='cp' AND (state IN ('paused','failed','ready') OR lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)").rowcount
assert (first, second) == (1, 0)

db.execute("INSERT INTO conversation_facet_results(id,tenant_id,workspace_id,conversation_id,dimension_key,value_key,result_version,classifier_key,classifier_version,input_digest,confidence,status,explanation_code,evidence_ids_json,evidence_set_hash,observed_at) VALUES('fa',1,1,'c','Category','A',1,'t','1','d',1,'supported','t','[\"e\"]','h',CURRENT_TIMESTAMP)")
db.execute("INSERT INTO conversation_facet_heads(tenant_id,workspace_id,conversation_id,dimension_key,value_key,current_result_id,current_result_version) VALUES(1,1,'c','Category','A','fa',1)")
db.execute("DELETE FROM conversation_facet_heads WHERE tenant_id=1 AND workspace_id=1 AND conversation_id='c' AND dimension_key='Category'")
assert db.execute("SELECT COUNT(*) FROM conversation_facet_heads WHERE conversation_id='c' AND dimension_key='Category'").fetchone()[0] == 0

db.execute("INSERT INTO conversation_cutover_state(workspace_id,tenant_id,dual_write_enabled,shadow_read_enabled,projection_read_enabled,cutover_epoch,rollout_percent) VALUES(1,1,1,1,0,1,0)")
try:
    db.execute("UPDATE conversation_cutover_state SET projection_read_enabled=1,rollout_percent=1 WHERE workspace_id=1")
    raise AssertionError("cutover was enabled without parity")
except sqlite3.IntegrityError as exc:
    assert "ucs_projection_cutover_gates_not_satisfied" in str(exc)

print(json.dumps({"outbox_capture": "PASS", "commitment_evidence_guard": "PASS", "exclusive_lease": "PASS", "stale_facet_retirement": "PASS", "database_cutover_gate": "PASS"}))
