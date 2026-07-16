#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

checks = [
    (
        "enterprise platform view",
        ROOT / "files/GlassMail-project/GlassMail/Views/EnterpriseProductivityPlatformView.swift",
        [
            "EnterpriseProductivityPlatformView",
            "CloudMail Enterprise Hub",
            "Enterprise Contact Directory",
            "Contact Profile",
            "Domain Directory",
            "Organization Graph",
            "Rules Engine",
            "Automation Center",
            "Tasks Integration",
            "Calendar Integration",
            "Follow-Up Center",
            "Waiting For Reply",
            "Knowledge Graph",
            "NLP Search V2",
            "Message Graph",
            "Contact Graph",
            "Attachment Graph",
            "Thread Graph",
            "Enterprise Admin Audit Center",
            "Compliance Center",
            "Retention Status",
            "Legal Hold Awareness",
            "OAuth Approval Center",
            "Recovery Center",
            "VIP -> Priority",
            "Invoice -> Finance",
            "Attachment -> Workflow",
            "Create Task",
            "Schedule Follow-Up",
            "Convert Email to Calendar Event",
            "Show All Contacts",
            "Show All Domains",
            "Show All Rules",
            "Show All Tasks",
            "Show All Follow-Ups",
            "Show All Knowledge Results",
            "Show All Recent Audit",
            "Collapse Contacts",
            "Collapse Recent Audit",
        ],
    ),
    (
        "settings route",
        ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
        [
            "EnterpriseProductivityPlatformView",
            "Enterprise Hub",
        ],
    ),
    (
        "real device acceptance",
        ROOT / "acceptance/CloudMailDeviceAcceptance/Tests/CloudMailDeviceAcceptanceTests.swift",
        [
            "testEnterpriseProductivityPlatformV1RealIPhoneNonDestructive",
            "Enterprise Contact Directory",
            "Rules Engine",
            "Create VIP Priority Rule",
            "Create Task",
            "Schedule Follow-Up",
            "NLP Search V2",
            "Enterprise Admin Audit Center",
            "Compliance Center",
        ],
    ),
]

missing = []
for label, path, needles in checks:
    text = path.read_text()
    for needle in needles:
        if needle not in text:
            missing.append(f"{label}: missing {needle!r} in {path.relative_to(ROOT)}")

if missing:
    print("enterprise_productivity_platform_v1_guard: FAIL")
    for item in missing:
        print(item)
    raise SystemExit(1)

print("enterprise_productivity_platform_v1_guard: PASS")
