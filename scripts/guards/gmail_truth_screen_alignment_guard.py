#!/usr/bin/env python3
import sys
import os

def check():
    path = "platform/cloud-mail/mail-worker/src/service/gmail-platform-v2-service.js"
    if not os.path.exists(path):
        print(f"FAIL: {path} not found")
        sys.exit(1)
        
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # The truthPlatform response must define the consolidated list of screens
    required_screens = [
        "Account Center",
        "Accounts",
        "Mailbox Detail",
        "Diagnostics",
        "Recovery Center",
        "Approval Center"
    ]
    
    # Check for truthPlatform definition and the presence of these screen names
    idx = content.find("function truthPlatform")
    if idx == -1:
        print("FAIL: truthPlatform function is missing in gmail-platform-v2-service.js")
        sys.exit(1)
        
    body = content[idx:idx+1500]
    for screen in required_screens:
        if screen not in body:
            print(f"FAIL: Screen name '{screen}' is missing in truthPlatform configuration")
            sys.exit(1)

    print("PASS: gmail_truth_screen_alignment_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
