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

    # Reconnect actions for Google accounts must NOT show connector
    # We expect that reconnectMailbox calls app.startGoogleMailboxOAuth and openURL
    if "reconnectMailbox" in content:
        # Check that we don't do showingConnector = true inside reconnectMailbox
        # We can find the definition of reconnectMailbox
        idx = content.find("func reconnectMailbox")
        if idx != -1:
            body = content[idx:idx+500]
            if "showingConnector = true" in body:
                print("FAIL: reconnectMailbox sets showingConnector = true instead of initiating OAuth flow")
                sys.exit(1)
    else:
        print("FAIL: reconnectMailbox function not found in AccountsView.swift")
        sys.exit(1)

    if 'sendStatusReason.localizedCaseInsensitiveContains("reconnect required")' not in content:
        print("FAIL: Gmail send-scope reconnect state is not routed to Google OAuth")
        sys.exit(1)

    print("PASS: gmail_reconnect_never_add_mailbox_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
