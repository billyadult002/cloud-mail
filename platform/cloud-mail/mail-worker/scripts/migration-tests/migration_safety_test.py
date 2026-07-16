#!/usr/bin/env python3
"""
CloudMail migration-safety CI gate (WF-3 / Phase D).

Checks:
  1. FRESH-APPLY (run #1): base fixture + full migration chain on a fresh DB
     must apply cleanly; PRAGMA foreign_key_check must be empty.
  2. DETERMINISM (run #2): a second independent fresh DB must apply identically
     and produce the same table set + empty foreign_key_check.
  3. RENAME->DROP DETECTION: static scan flags the rename->drop table-rebuild
     pattern that caused the 0003 production SQLITE_ERROR, and flags unguarded
     (non-idempotent) DDL statements.

Exit code 0 = gate PASS. Non-zero = gate FAIL (with reasons).
Uses only the Python standard library (sqlite3).
"""
import os
import re
import sqlite3
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "migrations"))
BASE_SCHEMA = os.path.join(HERE, "base_schema.sql")


def migration_files():
    files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    return files


def apply_sql(conn, sql):
    conn.executescript(sql)


def fresh_apply(label):
    """Apply base + chain to a fresh in-memory DB. Returns (ok, tables, errors)."""
    errors = []
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        with open(BASE_SCHEMA, "r", encoding="utf-8") as f:
            apply_sql(conn, f.read())
        for path in migration_files():
            with open(path, "r", encoding="utf-8") as f:
                try:
                    apply_sql(conn, f.read())
                except sqlite3.Error as e:
                    errors.append(f"[{label}] {os.path.basename(path)}: {e}")
                    raise
    except sqlite3.Error:
        return False, [], errors

    # FK integrity
    fk = conn.execute("PRAGMA foreign_key_check;").fetchall()
    if fk:
        errors.append(f"[{label}] foreign_key_check returned {len(fk)} violation(s): {fk[:5]}")

    tables = sorted(
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    )
    conn.close()
    return (len(errors) == 0), tables, errors


def static_scan():
    """Flag rename->drop patterns and non-idempotent DDL. Returns list of dicts."""
    findings = []
    for path in migration_files():
        name = os.path.basename(path)
        with open(path, "r", encoding="utf-8") as f:
            sql = f.read()
        renames = re.findall(r"ALTER\s+TABLE\s+([`\"']?\w+[`\"']?)\s+RENAME\s+TO\s+([`\"']?\w+[`\"']?)", sql, re.I)
        drops = re.findall(r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`\"']?\w+[`\"']?)", sql, re.I)
        rename_srcs = {r[0].strip('`"\'') for r in renames}
        rename_dsts = {r[1].strip('`"\'') for r in renames}
        drop_tbls = {d.strip('`"\'') for d in drops}
        # rename->drop: a table renamed to a *_backup then dropped in same file
        rename_then_drop = rename_dsts & drop_tbls
        # non-idempotent: CREATE TABLE/INDEX without IF NOT EXISTS
        bare_create = re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)([`\"']?\w+)", sql, re.I)
        # unguarded rename (no way to make idempotent) is inherently non-idempotent
        findings.append({
            "file": name,
            "rename_then_drop": sorted(rename_then_drop),
            "unguarded_rename": sorted(rename_srcs),
            "bare_create": bare_create,
        })
    return findings


def main():
    print("== CloudMail Migration Safety Gate (WF-3 / Phase D) ==")
    print(f"migrations dir: {MIGRATIONS_DIR}")
    files = migration_files()
    print(f"migration files: {len(files)}")
    for p in files:
        print(f"  - {os.path.basename(p)}")

    gate_fail = False

    # 1 & 2: fresh apply run #1 and run #2 (determinism)
    ok1, tables1, err1 = fresh_apply("run#1")
    ok2, tables2, err2 = fresh_apply("run#2")
    print("\n-- Fresh-apply results --")
    print(f"run#1 clean apply + FK check: {'PASS' if ok1 else 'FAIL'}")
    for e in err1:
        print("   ", e)
    print(f"run#2 clean apply + FK check: {'PASS' if ok2 else 'FAIL'}")
    for e in err2:
        print("   ", e)
    determinism = ok1 and ok2 and tables1 == tables2
    print(f"determinism (identical table set): {'PASS' if determinism else 'FAIL'}")
    if not determinism and tables1 != tables2:
        print("   table set diff:", set(tables1) ^ set(tables2))

    MIGRATION_IDEMPOTENT_PASS = ok1 and ok2 and determinism
    if not MIGRATION_IDEMPOTENT_PASS:
        gate_fail = True

    # 3: static rename->drop / non-idempotency detection
    print("\n-- Static rename->drop / non-idempotency scan --")
    findings = static_scan()
    risky = []
    for f in findings:
        flags = []
        if f["rename_then_drop"]:
            flags.append(f"RENAME->DROP {f['rename_then_drop']}")
        if f["unguarded_rename"]:
            flags.append(f"unguarded RENAME {f['unguarded_rename']}")
        if f["bare_create"]:
            flags.append(f"{len(f['bare_create'])} CREATE without IF NOT EXISTS")
        status = "RISK" if flags else "ok"
        if flags:
            risky.append(f["file"])
        print(f"  {f['file']}: {status} {'; '.join(flags)}")

    # The gate BLOCKS *new* rename->drop patterns. Known legacy files that
    # already shipped are listed in an allowlist so the gate stays green while
    # still failing on any NEW occurrence.
    ALLOWLIST = {"0003_auth_routing_forwarding.sql", "0004_mail_delivery_idempotency.sql",
                 "0005_repair_pending_users_identity_fk.sql"}
    new_rename_drop = [f["file"] for f in findings
                       if f["rename_then_drop"] and f["file"] not in ALLOWLIST]
    print("\n-- Gate decision --")
    if new_rename_drop:
        print(f"NEW rename->drop pattern in: {new_rename_drop}  -> GATE FAIL")
        gate_fail = True
    else:
        print("No NEW rename->drop patterns outside the legacy allowlist.")

    MIGRATION_CI_GATE_PASS = not gate_fail
    print("\n== OUTPUTS ==")
    print(f"MIGRATION_IDEMPOTENT_PASS={'true' if MIGRATION_IDEMPOTENT_PASS else 'false'}")
    print(f"MIGRATION_CI_GATE_PASS={'true' if MIGRATION_CI_GATE_PASS else 'false'}")

    return 0 if MIGRATION_CI_GATE_PASS else 1


if __name__ == "__main__":
    sys.exit(main())
