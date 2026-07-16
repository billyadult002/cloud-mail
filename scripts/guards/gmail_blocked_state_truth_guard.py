#!/usr/bin/env python3
import sys
import os

def check():
    path = "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
    if not os.path.exists(path):
        print(f"FAIL: {path} not found")
        sys.exit(1)
        
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    expected_reasons = [
        "Google Tester Restriction",
        "OAuth Testing Restriction",
        "Google Project Restriction",
        "Provider Blocked"
    ]
    for reason in expected_reasons:
        if reason not in content:
            print(f"FAIL: Blocked state description '{reason}' is missing in CloudMailV2Views.swift")
            sys.exit(1)

    print("PASS: gmail_blocked_state_truth_guard")
    sys.exit(0)

if __name__ == "__main__":
    check()
