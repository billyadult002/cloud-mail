#!/usr/bin/env python3
"""
Query-optimization proof (WF-8 / WP-D). Builds the email table + email_inbox_idx
(0012) and confirms via EXPLAIN QUERY PLAN that:
  - the inbox list query uses email_inbox_idx (no full SCAN)
  - the count query uses email_inbox_idx (no full SCAN), and does NOT need an
    account join
"""
import sqlite3, sys

def build():
    c = sqlite3.connect(":memory:")
    c.executescript("""
    CREATE TABLE email (
      email_id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER, user_id INTEGER, type INTEGER, is_del INTEGER,
      subject TEXT, provider TEXT
    );
    """)
    # 0012 covering index
    c.executescript("CREATE INDEX IF NOT EXISTS email_inbox_idx ON email(user_id, account_id, type, is_del, email_id);")
    # seed
    for i in range(2000):
        c.execute("INSERT INTO email (account_id,user_id,type,is_del,subject,provider) VALUES (?,?,?,?,?,?)",
                  (i % 5, i % 10, i % 2, 0, f"s{i}", "cloudflare_native"))
    c.commit()
    return c

def plan(c, sql, params=()):
    return [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()]

fails = 0
def ok(name, cond, detail=""):
    global fails
    print(("PASS" if cond else "FAIL")+"  "+name+("  :: "+detail if detail else ""))
    if not cond: fails += 1

c = build()

list_sql = ("SELECT * FROM email WHERE account_id=? AND user_id=? AND type=? AND is_del=? "
            "AND email_id<? ORDER BY email_id DESC LIMIT 20")
lp = plan(c, list_sql, (1,1,0,0,99999))
uses_idx_list = any("email_inbox_idx" in p for p in lp)
no_scan_list = not any(p.startswith("SCAN email") and "USING" not in p for p in lp)
ok("inbox list uses email_inbox_idx", uses_idx_list, " | ".join(lp))
ok("inbox list avoids full table scan", no_scan_list, " | ".join(lp))

count_sql = "SELECT COUNT(*) FROM email WHERE account_id=? AND user_id=? AND type=? AND is_del=?"
cp = plan(c, count_sql, (1,1,0,0))
uses_idx_count = any("email_inbox_idx" in p for p in cp)
no_scan_count = not any(p.startswith("SCAN email") and "USING" not in p for p in cp)
ok("count uses email_inbox_idx", uses_idx_count, " | ".join(cp))
ok("count avoids full table scan", no_scan_count, " | ".join(cp))

print(f"\nQUERY_PLAN_SIM: {'PASS' if fails==0 else 'FAIL'} ({fails} failures)")
sys.exit(0 if fails == 0 else 1)
