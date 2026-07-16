#!/usr/bin/env python3
import sys
import os

def check():
    path = "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js"
    if not os.path.exists(path):
        print(f"FAIL: {path} not found")
        sys.exit(1)
        
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # The auto-discovery SELECT query must not restrict the provider to gmail/google_workspace
    # Find the SELECT account_id FROM account query block
    idx = content.find("SELECT account_id FROM account")
    if idx != -1:
        query_block = content[idx:idx+600]
        # In this select query block, check that provider IN is not used
        # (Though provider is used in ORDER BY, it should not be in WHERE clause)
        where_clause = query_block.split("ORDER BY")[0]
        if "provider IN" in where_clause:
            print("FAIL: Auto-discovery query in gemini-oauth-service.js restricts existing accounts by provider in WHERE clause")
            sys.exit(1)
    else:
        print("FAIL: SELECT account_id query block not found in gemini-oauth-service.js")
        sys.exit(1)

    print("PASS: gmail_account_matching_legacy_provider_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
