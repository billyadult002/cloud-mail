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

    # In archiveDuplicateGoogleMailboxes, there must not be restriction on provider
    # E.g. we removed "AND provider IN ('gmail', 'google_workspace')"
    if "archiveDuplicateGoogleMailboxes" in content:
        idx = content.find("function archiveDuplicateGoogleMailboxes")
        if idx != -1:
            body = content[idx:idx+600]
            if "provider IN" in body:
                print("FAIL: archiveDuplicateGoogleMailboxes still restricts duplicates to specific providers")
                sys.exit(1)
    else:
        print("FAIL: archiveDuplicateGoogleMailboxes not found in gemini-oauth-service.js")
        sys.exit(1)

    print("PASS: gmail_duplicate_identity_prevention_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
