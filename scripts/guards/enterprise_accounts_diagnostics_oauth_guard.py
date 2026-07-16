#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

checks = [
    (
        "settings diagnostics route",
        ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
        ["Accounts · Advanced", "Diagnostics", "OAuth Approval Center", "OAuth Providers: Google", "Recovery Center", "Provider Health Center"],
    ),
    (
        "diagnostics views",
        ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift",
        [
            "EnterpriseAccountDiagnosticsView",
            "OAuthDiagnosticsCenterView",
            "OAuthApprovalCenterView",
            "GoogleTesterManagementView",
            "AccountRecoveryCenterView",
            "UnifiedProviderHealthCenterView",
            "FriendlyOAuthFailureView",
            "AccessGovernanceCenterView",
            "InvitationManagementView",
            "GovernanceAuditTrailView",
            "Request Access",
            "Google OAuth Tester Restriction",
            "does not claim Google Console tester",
            "Provider Coverage",
            "Outlook",
            "Office365",
            "Exchange",
            "IMAP",
            "SMTP",
            "CloudMail Domain",
            "OAuthProviderCoverageRow",
            "Non-Google providers are retained in the OAuth Center",
            "Create Invite",
            "Batch Invite",
            "Expire Invite",
            "Revoke Invite",
            "Resend Invite",
            "Audit Trail",
            "Show All Current Testers",
            "Show All Tester History",
            "Show All Audit Trail",
            "Show All \\(status.title) Requests",
            "Invitation Status",
            "Approval Status",
        ],
    ),
    (
        "governance models",
        ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift",
        [
            "GovernanceProvider",
            "GovernanceInvitation",
            "GovernanceAuditEvent",
            "GovernanceInviteStatus",
            "GovernanceAuditAction",
        ],
    ),
    (
        "tester state model",
        ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift",
        [
            "TESTER_APPROVED",
            "TESTER_PENDING",
            "TESTER_REJECTED",
            "TESTER_NOT_REGISTERED",
            "PENDING_APPROVAL",
            "ProviderHealthState",
        ],
    ),
    (
        "local approval ledger",
        ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift",
        [
            "localOAuthAccessRequests",
            "requestGoogleOAuthAccess",
            "updateLocalOAuthAccessRequest",
            "googleTesterStatus",
            "cloudmail_local_oauth_access_requests_v1",
            "governanceInvitations",
            "governanceAuditTrail",
            "createGovernanceInvitation",
            "redeemGovernanceInvitation",
            "hashInvitationCode",
        ],
    ),
    (
        "real device acceptance",
        ROOT / "acceptance/CloudMailDeviceAcceptance/Tests/CloudMailDeviceAcceptanceTests.swift",
        [
            "testEnterpriseAccountsDiagnosticsOAuthApprovalRealIPhoneNonDestructive",
            "Account Diagnostics",
            "Pending Approval",
            "OAuth Approval Center",
            "Google Tester Management",
            "Add Tester to CloudMail Ledger",
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
    print("enterprise_accounts_diagnostics_oauth_guard: FAIL")
    for item in missing:
        print(item)
    raise SystemExit(1)

print("enterprise_accounts_diagnostics_oauth_guard: PASS")
