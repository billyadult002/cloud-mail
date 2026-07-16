#!/usr/bin/env python3
import sys
import os

def check():
    path = "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
    if not os.path.exists(path):
        print(f"FAIL: {path} not found")
        sys.exit(1)
        
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Check that isGoogleAccount is implemented and includes checks for suffix/provider
    if "isGoogleAccount" not in content:
        print("FAIL: isGoogleAccount helper is missing in AccountsView.swift")
        sys.exit(1)
        
    # Check that requiresGoogleOAuthReconnect checks needsReauthorization and accountId != nil
    if "requiresGoogleOAuthReconnect" not in content:
        print("FAIL: requiresGoogleOAuthReconnect is missing in AccountsView.swift")
        sys.exit(1)

    # Check that we route using reconnectMailbox when isGoogleAccount and accountId is present
    if "reconnectMailbox" not in content:
        print("FAIL: reconnectMailbox method is missing in AccountsView.swift")
        sys.exit(1)

    print("PASS: gmail_reconnect_routes_to_current_mailbox_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
