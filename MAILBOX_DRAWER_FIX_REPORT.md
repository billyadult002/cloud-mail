# Mailbox Drawer Fix Report

Status: **FIXED**

Root causes:

1. Sheet state was changed inside the same animated transaction as the header/menu dismissal.
2. Toolbar Menu and compact header shared the same `Current mailbox` accessibility label, so UI automation selected the wrong control.

Fixes in `files/GlassMail-project/GlassMail/Views/InboxView.swift`:

- Defer sheet presentation to the next main-loop turn.
- Remove the competing animation transaction.
- Give toolbar Menu the distinct `Mailbox menu` label; keep the compact header as the sole `Current mailbox` target.

Evidence: USB iPhone 17 XCUITest `testLoop5JMailboxFirstScreenHidesDebugFiltersWithExistingSession` passed; result bundle: `artifacts/gpt65-6y-mailbox-drawer-final.xcresult`.
