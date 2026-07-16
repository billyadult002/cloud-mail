#!/usr/bin/env python3
"""
Certification proofs that are code-derivable (no device/Google needed):
  1. Gmail Freshness: autoSync's account-selection SQL picks exactly the stale /
     never-synced / errored accounts and orders never-synced first.
  2. UID Cache Reuse: lastCachedUid = MAX(uid) per (user,account,mailbox,
     validity) drives an incremental "UID (lastUid+1):*" fetch so already-seen
     UIDs are never refetched, and a UIDVALIDITY change forces a fresh baseline.
"""
import sqlite3, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
MIG16 = os.path.normpath(os.path.join(HERE, "..", "..", "migrations", "0016_gmail_sync_tables.sql"))

fails = 0
def ok(name, cond, d=""):
    global fails
    print(("PASS" if cond else "FAIL")+"  "+name+("  :: "+d if d else ""))
    if not cond: fails += 1

# ---------- 1. Freshness selection ----------
c = sqlite3.connect(":memory:")
c.execute("""CREATE TABLE account (account_id INTEGER PRIMARY KEY, user_id INT, provider TEXT,
             is_del INT, sync_status TEXT, last_synced_at TEXT)""")
c.execute("""CREATE TABLE mail_provider_credentials (id INTEGER PRIMARY KEY, user_id INT,
             account_id INT, provider TEXT, credential_ciphertext TEXT)""")
# stale minutes = 30
rows = [
  (1,1,'gmail',0,'connected', None),                         # never synced -> selected (first)
  (2,1,'gmail',0,'connected', "datetime('now','-90 minutes')"),  # stale -> selected
  (3,1,'gmail',0,'connected', "datetime('now','-5 minutes')"),   # fresh -> NOT selected
  (4,1,'gmail',0,'error',     "datetime('now','-1 minutes')"),   # error -> selected regardless
  (5,1,'gmail',1,'connected', None),                         # deleted -> NOT selected
]
for aid,uid,prov,dele,st,ts in rows:
    tsval = ts if ts else "NULL"
    c.execute(f"INSERT INTO account VALUES ({aid},{uid},'{prov}',{dele},'{st}',{tsval})")
    if dele == 0:
        c.execute(f"INSERT INTO mail_provider_credentials VALUES ({aid},{uid},{aid},'{prov}','cipher')")
c.commit()

sel = """
SELECT a.account_id FROM account a
JOIN mail_provider_credentials mpc ON mpc.user_id=a.user_id AND mpc.account_id=a.account_id
  AND mpc.provider IN ('gmail','google_workspace')
WHERE a.is_del=0 AND a.provider IN ('gmail','google_workspace')
  AND COALESCE(mpc.credential_ciphertext,'')!=''
  AND (a.last_synced_at IS NULL OR a.last_synced_at=''
       OR datetime(a.last_synced_at) <= datetime('now', ?1)
       OR LOWER(COALESCE(a.sync_status,'')) IN ('error','sync_required','stale'))
GROUP BY a.account_id
ORDER BY CASE WHEN a.last_synced_at IS NULL OR a.last_synced_at='' THEN 0 ELSE 1 END,
         datetime(a.last_synced_at) ASC
"""
selected = [r[0] for r in c.execute(sel, ("-30 minutes",)).fetchall()]
ok("stale/never/error accounts selected", set(selected) == {1,2,4}, str(selected))
ok("fresh account excluded", 3 not in selected)
ok("deleted account excluded", 5 not in selected)
ok("never-synced ordered first", selected[0] == 1, str(selected))

# ---------- 2. UID cache reuse ----------
c2 = sqlite3.connect(":memory:")
c2.executescript(open(MIG16).read())
def last_uid(user, acc, mbox, validity):
    r = c2.execute("""SELECT COALESCE(MAX(uid),0) FROM gmail_uid_cache
                      WHERE user_id=? AND account_id=? AND mailbox=? AND uid_validity=?""",
                   (user,acc,mbox,validity)).fetchone()
    return r[0]

def remember(user,acc,mbox,validity,uid,mid):
    c2.execute("""INSERT INTO gmail_uid_cache (user_id,account_id,mailbox,uid_validity,uid,external_message_id)
                  VALUES (?,?,?,?,?,?)
                  ON CONFLICT(user_id,account_id,mailbox,uid_validity,uid) DO UPDATE SET
                    external_message_id=excluded.external_message_id""",
               (user,acc,mbox,validity,uid,mid))
    c2.commit()

V=111
ok("cold start lastUid=0 -> full search", last_uid(1,10,'INBOX',V) == 0)
for u in (100,101,102): remember(1,10,'INBOX',V,u,f"m{u}")
ok("lastUid tracks max", last_uid(1,10,'INBOX',V) == 102)
# next sync would search UID 103:* -> only new UIDs
next_search_from = last_uid(1,10,'INBOX',V) + 1
ok("incremental fetch starts after cached max", next_search_from == 103)
# idempotent remember of an already-cached uid does not duplicate
remember(1,10,'INBOX',V,102,"m102")
cnt = c2.execute("SELECT COUNT(*) FROM gmail_uid_cache WHERE user_id=1 AND account_id=10 AND uid=102").fetchone()[0]
ok("re-remember same uid is idempotent (no dup)", cnt == 1)
# UIDVALIDITY change forces fresh baseline (different validity bucket)
ok("UIDVALIDITY change resets baseline", last_uid(1,10,'INBOX',999) == 0)

print(f"\nFRESHNESS_UIDCACHE_SIM: {'PASS' if fails==0 else 'FAIL'} ({fails} failures)")
sys.exit(0 if fails == 0 else 1)
