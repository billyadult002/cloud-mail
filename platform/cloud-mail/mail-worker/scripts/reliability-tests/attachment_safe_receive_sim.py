#!/usr/bin/env python3
"""
Model the attachment-safe receive invariant (WF-5 / WP-B).

Scenario: an inbound message with an attachment. First delivery: attachment
persist FAILS. Second delivery (provider retry): succeeds.

Proves:
  - after the failed attempt: NO finalized email row remains (rolled back),
    and the dedupe record is NOT stored (stored=0) so the retry is not suppressed
  - after the retry: exactly ONE finalized email row + attachment, dedupe stored=1
Compare to OLD behaviour (swallow + finalize) which would leave a row without
its attachment and suppress the retry.
"""
import sqlite3, sys

def fresh():
    c = sqlite3.connect(":memory:")
    c.executescript("""
    CREATE TABLE email (email_id INTEGER PRIMARY KEY AUTOINCREMENT, status INTEGER, is_del INTEGER);
    CREATE TABLE attachments (att_id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER);
    CREATE TABLE dedupe (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, stored INTEGER DEFAULT 0, forwarded INTEGER DEFAULT 0);
    """)
    return c

SAVING, RECEIVE, DEL, NORMAL = 4, 0, 1, 0

def deliver(c, key, attachment_ok):
    # dedupe pre-check (suppress only if stored OR forwarded)
    row = c.execute("SELECT id,stored,forwarded FROM dedupe WHERE key=?", (key,)).fetchone()
    if row and (row[1] or row[2]):
        return "suppressed"
    dedupe_id = row[0] if row else c.execute("INSERT INTO dedupe (key) VALUES (?)", (key,)).lastrowid
    # insert hidden email row (status SAVING, is_del=DELETE)
    email_id = c.execute("INSERT INTO email (status,is_del) VALUES (?,?)", (SAVING, DEL)).lastrowid
    c.commit()
    # attempt attachment persist
    if not attachment_ok:
        # NEW behaviour: rollback the hidden row, do NOT finalize dedupe, rethrow
        c.execute("DELETE FROM attachments WHERE email_id=?", (email_id,))
        c.execute("DELETE FROM email WHERE email_id=?", (email_id,))
        c.commit()
        return "rolled_back"
    c.execute("INSERT INTO attachments (email_id) VALUES (?)", (email_id,))
    # finalize
    c.execute("UPDATE email SET status=?, is_del=? WHERE email_id=?", (RECEIVE, NORMAL, email_id))
    c.execute("UPDATE dedupe SET stored=1 WHERE id=?", (dedupe_id,))
    c.commit()
    return "stored"

fails = 0
def ok(name, cond):
    global fails
    print(("PASS" if cond else "FAIL")+"  "+name)
    if not cond: fails += 1

c = fresh()
r1 = deliver(c, "msg1", attachment_ok=False)
ok("attempt#1 rolled back", r1 == "rolled_back")
ok("no finalized email row after failure",
   c.execute("SELECT COUNT(*) FROM email WHERE is_del=0").fetchone()[0] == 0)
ok("no orphan email row at all after rollback",
   c.execute("SELECT COUNT(*) FROM email").fetchone()[0] == 0)
ok("dedupe NOT stored (retry allowed)",
   c.execute("SELECT stored FROM dedupe WHERE key='msg1'").fetchone()[0] == 0)

r2 = deliver(c, "msg1", attachment_ok=True)
ok("attempt#2 (retry) not suppressed, stored", r2 == "stored")
ok("exactly one finalized email row", c.execute("SELECT COUNT(*) FROM email WHERE is_del=0").fetchone()[0] == 1)
ok("attachment present", c.execute("SELECT COUNT(*) FROM attachments").fetchone()[0] == 1)
ok("dedupe now stored=1", c.execute("SELECT stored FROM dedupe WHERE key='msg1'").fetchone()[0] == 1)

r3 = deliver(c, "msg1", attachment_ok=True)
ok("subsequent duplicate suppressed", r3 == "suppressed")
ok("still exactly one email row", c.execute("SELECT COUNT(*) FROM email WHERE is_del=0").fetchone()[0] == 1)

print(f"\nATTACHMENT_SAFE_RECEIVE_SIM: {'PASS' if fails==0 else 'FAIL'} ({fails} failures)")
sys.exit(0 if fails == 0 else 1)
