#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

checks = [
    (
        "contact graph service",
        ROOT / "files/GlassMail-project/GlassMail/Services/EnterpriseContactGraph.swift",
        [
            "EnterpriseContactGraphNode",
            "EnterpriseContactGraphBuilder",
            "sendCount",
            "receiveCount",
            "replyCount",
            "lastUsed",
            "isVIP",
            "isStarred",
            "frequentContactScore",
            "Domain Directory",
            "Received Senders",
            "Sent Recipients",
            "Reply Targets",
            "Forward Targets",
        ],
    ),
    (
        "profile sync schema",
        ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift",
        [
            "favoriteContactEmails",
            "vipContactEmails",
            "starredContactEmails",
            "directoryPreferences",
            "composePreferences",
            "autocompleteLearning",
            "syncedItems",
            "profileSyncLastRestoreAt",
            "ProfileSyncDevice",
        ],
    ),
    (
        "app state integration",
        ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift",
        [
            "enterpriseContactGraph",
            "enterpriseDomainDirectory",
            "profileSyncSyncedItems",
            "profileSyncSecretSafetyItems",
            "setDeviceContactsEnabledForDirectory",
            "toggleFavoriteContact",
            "toggleVIPContact",
            "toggleStarredContact",
            "recordAutocompleteSelection",
            "markProfileRestoredFromCloud",
            "upsertCurrentDevice",
        ],
    ),
    (
        "directory profile sync UI",
        ROOT / "files/GlassMail-project/GlassMail/Views/EnterpriseDirectoryProfileSyncView.swift",
        [
            "EnterpriseDirectoryProfileSyncView",
            "All Contacts",
            "Recent Contacts",
            "VIP Contacts",
            "Starred Contacts",
            "Domain Contacts",
            "Organization Contacts",
            "Use Device Contacts",
            "Contact Profile",
            "Recent Conversations",
            "Sent Count",
            "Received Count",
            "Reply Count",
            "Profile Sync V2",
            "Synced Items",
            "Excluded Data",
            "Device Restore",
            "Restore Preview",
            "Multi Device View",
            "Profile Sync Health",
            "Apply Restore Preview",
        ],
    ),
    (
        "settings routes",
        ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
        [
            "Section(\"Contacts\")",
            "EnterpriseDirectoryProfileSyncView(startTab: .directory)",
            "EnterpriseDirectoryProfileSyncView(startTab: .domain)",
            "EnterpriseDirectoryProfileSyncView(startTab: .profileSync)",
            "EnterpriseDirectoryProfileSyncView(startTab: .restore)",
        ],
    ),
    (
        "compose autocomplete v2",
        ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift",
        [
            "ComposeRecipientField",
            "suggestions(for: .cc)",
            "suggestions(for: .bcc)",
            "recordAutocompleteSelection",
            "initialRecipient",
        ],
    ),
    (
        "real iphone acceptance",
        ROOT / "acceptance/CloudMailDeviceAcceptance/Tests/CloudMailDeviceAcceptanceTests.swift",
        [
            "testEnterpriseDirectoryProfileSyncDeviceRestoreRealIPhone",
            "validateComposeAutocompleteV2ToCcBcc",
            "tapDirectorySegment",
            "Profile Sync V2",
            "Device Restore",
            "Apply Restore Preview",
            "compose-recipient-autocomplete-",
        ],
    ),
]

missing = []
for label, path, needles in checks:
    text = path.read_text()
    for needle in needles:
        if needle not in text:
            missing.append(f"{label}: missing {needle!r} in {path.relative_to(ROOT)}")

for forbidden in ["OAuth Tokens: synced", "Refresh Tokens: synced", "Passwords: synced", "SMTP Credentials: synced", "IMAP Credentials: synced"]:
    for path in [
        ROOT / "files/GlassMail-project/GlassMail/Views/EnterpriseDirectoryProfileSyncView.swift",
        ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift",
    ]:
        if forbidden in path.read_text():
            missing.append(f"secret safety: forbidden synced secret text {forbidden!r} in {path.relative_to(ROOT)}")

if missing:
    print("enterprise_directory_profile_sync_guard: FAIL")
    for item in missing:
        print(item)
    raise SystemExit(1)

print("enterprise_directory_profile_sync_guard: PASS")
