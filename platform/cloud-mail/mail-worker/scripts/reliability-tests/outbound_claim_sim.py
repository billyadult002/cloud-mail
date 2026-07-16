#!/usr/bin/env python3
"""
Simulate the outbound_messages idempotency claim semantics (WF-4 / WP-A) against
real SQLite, mirroring outbound-service.claim(). Proves:
  - first claim succeeds (changes=1)
  - concurrent duplicate claim is blocked by UNIQUE(user_id, idempotency_key)
  - replay after 'sent' returns replay (no new send)
  - retry state allows re-claim
"""
import sqlite3, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.normpath(os.path.join(HERE, "..", "..", "migrations", "0013_outbound_durability.sql"))

def fresh():
    c = sqlite3.connect(":memory:")
    with open(MIG) as f:
        c.executescript(f.read())
    return c

def claim(c, user_id, account_id, key):
    cur = c.execute(
        "INSERT INTO outbound_messages (user_id, account_id, idempotency_key, status, attempts) "
        "VALUES (?,?,?,'sending',1) ON CONFLICT(user_id, idempotency_key) DO NOTHING",
        (user_id, account_id, key))
    c.commit()
    if cur.rowcount and cur.rowcount > 0:
        return {"claimed": True, "id": cur.lastrowid}
    row = c.execute("SELECT id,status,attempts FROM outbound_messages WHERE user_id=? AND idempotency_key=?",
                    (user_id, key)).fetchone()
    status = row[1]
    if status == 'sent':
        return {"claimed": False, "replay": True, "id": row[0]}
    if status == 'sending':
        return {"claimed": False, "inflight": True, "id": row[0]}
    c.execute("UPDATE outbound_messages SET status='sending', attempts=attempts+1 WHERE id=?", (row[0],))
    c.commit()
    return {"claimed": True, "id": row[0], "reclaimed": True}

fails = 0
def ok(name, cond):
    global fails
    print(("PASS" if cond else "FAIL") + "  " + name)
    if not cond: fails += 1

c = fresh()
r1 = claim(c, 1, 10, "keyA")
ok("first claim succeeds", r1.get("claimed") is True)

r2 = claim(c, 1, 10, "keyA")
ok("duplicate while sending -> inflight (no dup row)", r2.get("inflight") is True)
ok("still one row for keyA", c.execute("SELECT COUNT(*) FROM outbound_messages WHERE idempotency_key='keyA'").fetchone()[0] == 1)

# mark sent, then replay
c.execute("UPDATE outbound_messages SET status='sent', email_id=555 WHERE id=?", (r1["id"],)); c.commit()
r3 = claim(c, 1, 10, "keyA")
ok("replay after sent", r3.get("replay") is True)

# different user same key -> independent claim
r4 = claim(c, 2, 10, "keyA")
ok("different user same key is independent", r4.get("claimed") is True)

# retry state allows reclaim
c.execute("INSERT INTO outbound_messages (user_id,account_id,idempotency_key,status,attempts) VALUES (3,10,'keyR','retry',1)"); c.commit()
r5 = claim(c, 3, 10, "keyR")
ok("retry state reclaims", r5.get("claimed") is True and r5.get("reclaimed") is True)
ok("reclaim bumped attempts", c.execute("SELECT attempts FROM outbound_messages WHERE user_id=3 AND idempotency_key='keyR'").fetchone()[0] == 2)

print(f"\nOUTBOUND_CLAIM_SIM: {'PASS' if fails==0 else 'FAIL'} ({fails} failures)")
sys.exit(0 if fails == 0 else 1)
