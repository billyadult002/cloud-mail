#!/usr/bin/env python3
"""
FTS parity + trigger-sync test (WF-7 / WP-C) against real SQLite FTS5.
Applies base email table + 0014 migration, seeds rows, and verifies:
  - FTS returns the same whole-word matches as LIKE (parity)
  - prefix search works ("wor" -> "world")
  - triggers keep the index in sync on INSERT / UPDATE / DELETE
"""
import sqlite3, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.normpath(os.path.join(HERE, "..", "..", "migrations", "0014_email_fts.sql"))

def build_fts_query(term):
    toks = re.findall(r"[A-Za-z0-9]+", term)
    if not toks: return ""
    return " AND ".join(f'"{t}"*' for t in toks[:16])

def fresh():
    c = sqlite3.connect(":memory:")
    c.executescript("""
    CREATE TABLE email (
      email_id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT, name TEXT, send_email TEXT, to_email TEXT, text TEXT
    );
    """)
    with open(MIG) as f:
        c.executescript(f.read())
    return c

def fts_ids(c, term):
    q = build_fts_query(term)
    if not q: return set()
    return {r[0] for r in c.execute("SELECT rowid FROM email_fts WHERE email_fts MATCH ?", (q,)).fetchall()}

def like_ids(c, term):
    like = f"%{term}%"
    return {r[0] for r in c.execute(
        "SELECT email_id FROM email WHERE subject LIKE ? OR name LIKE ? OR send_email LIKE ? OR to_email LIKE ? OR text LIKE ?",
        (like, like, like, like, like)).fetchall()}

fails = 0
def ok(name, cond):
    global fails
    print(("PASS" if cond else "FAIL")+"  "+name)
    if not cond: fails += 1

c = fresh()
rows = [
    ("Quarterly report", "Alice", "alice@x.com", "bob@y.com", "the world economy grew"),
    ("Lunch plans", "Bob", "bob@y.com", "alice@x.com", "meet at noon downtown"),
    ("Invoice 1024", "Billing", "billing@z.com", "carol@y.com", "payment world due soon"),
    ("Hello World", "Carol", "carol@y.com", "dave@y.com", "greetings and salutations"),
]
for r in rows:
    c.execute("INSERT INTO email (subject,name,send_email,to_email,text) VALUES (?,?,?,?,?)", r)
c.commit()

# whole-word parity
for term in ["world", "alice", "invoice", "noon"]:
    ok(f"parity whole-word '{term}'", fts_ids(c, term) == like_ids(c, term))

# prefix search (FTS superset of exact)
ok("prefix 'wor' finds world rows", fts_ids(c, "wor") == {1,3,4})

# UPDATE sync: change row 2 text to include 'world'
c.execute("UPDATE email SET text='now mentions world too' WHERE email_id=2"); c.commit()
ok("trigger sync on UPDATE", 2 in fts_ids(c, "world"))
ok("parity holds after UPDATE", fts_ids(c, "world") == like_ids(c, "world"))

# DELETE sync
c.execute("DELETE FROM email WHERE email_id=4"); c.commit()
ok("trigger sync on DELETE", 4 not in fts_ids(c, "world"))
ok("parity holds after DELETE", fts_ids(c, "world") == like_ids(c, "world"))

# INSERT sync
c.execute("INSERT INTO email (subject,name,send_email,to_email,text) VALUES ('World tour','Eve','eve@x.com','f@y.com','around the world')"); c.commit()
ok("trigger sync on INSERT", fts_ids(c, "world") == like_ids(c, "world"))

print(f"\nFTS_PARITY_SIM: {'PASS' if fails==0 else 'FAIL'} ({fails} failures)")
sys.exit(0 if fails == 0 else 1)
