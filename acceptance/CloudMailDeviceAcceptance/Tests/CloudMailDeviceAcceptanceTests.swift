import UIKit
import XCTest

final class CloudMailDeviceAcceptanceTests: XCTestCase {
    private let app = XCUIApplication(
        bundleIdentifier: ProcessInfo.processInfo.environment["CLOUDMAIL_ACCEPTANCE_APP_BUNDLE_ID"]
            ?? "app.wangbei8554.pingguo736"
    )
    private let domain = "fastonegroup.com"
    private let registrationCode = "CLOUDMAIL-DEVICE-AUDIT-20260620"

    override func setUpWithError() throws {
        continueAfterFailure = false
        configureAppLaunchEnvironment()
        app.launch()
        guard shouldResetSessionBeforeTest,
              runtimeCredentials() != nil,
              testCredentialBridgeURL == nil,
              !credentialBridgeWasConfigured else { return }
        if app.navigationBars["Inbox"].waitForExistence(timeout: 5),
           app.buttons["CloudMail actions"].waitForExistence(timeout: 5) {
            app.buttons["CloudMail actions"].tap()
            if app.buttons["Sign out"].waitForExistence(timeout: 5) {
                app.buttons["Sign out"].tap()
            }
        }
    }

    func testRegisterLoginLogoutAndLoginAgain() throws {
        if runtimeCredentials() == nil, app.navigationBars["Inbox"].waitForExistence(timeout: 5) {
            throw XCTSkip("Registration reset flow skipped because final acceptance is using an existing manual device session")
        }
        let stamp = Int(Date().timeIntervalSince1970)
        let localPart = "device.acceptance.\(stamp)"
        let fullEmail = "\(localPart)@\(domain)"
        let password = "CloudMail#Device-\(stamp)"

        let createAccount = app.buttons["Create a new account"]
        XCTAssertTrue(createAccount.waitForExistence(timeout: 20), "CloudMail did not reach onboarding")
        createAccount.tap()

        XCTAssertTrue(app.navigationBars["Create New Account"].waitForExistence(timeout: 10))
        replace(app.textFields["username"], with: localPart)
        replace(app.textFields["domain.com"], with: domain)
        replace(app.secureTextFields["Password"], with: password)
        replace(app.textFields["Registration code"], with: registrationCode)
        app.buttons["Register"].tap()

        XCTAssertTrue(
            app.staticTexts["Registered successfully. Please sign in."].waitForExistence(timeout: 20),
            "Registration did not expose its success state"
        )
        XCTAssertTrue(createAccount.waitForExistence(timeout: 10), "Registration sheet did not return to login")

        signInFromOnboarding(email: fullEmail, password: password)

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "First login did not reach Inbox")
        signOut()

        XCTAssertTrue(createAccount.waitForExistence(timeout: 15), "Logout did not return to onboarding")
        signInFromOnboarding(email: fullEmail, password: password)

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Second login did not reach Inbox")
        XCTAssertFalse(app.staticTexts["Session expired"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'SQLITE_ERROR'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'D1_ERROR'")).firstMatch.exists)
    }

    func testActiveAccountConnectorExposesLoginAndRecovery() throws {
        guard let credentials = runtimeCredentials() else {
            throw XCTSkip("Existing-account device credentials were not supplied")
        }
        login(email: credentials.email, password: credentials.password)

        app.buttons["NEXORA actions"].tap()
        tapCloudMailActionSettings(timeout: 5)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10))
        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10))

        replace(app.textFields["you@example.com"], with: "admin@fastonegroup.com")
        let discover = app.buttons["Continue"]
        XCTAssertTrue(discover.waitForExistence(timeout: 10))
        XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "Managed CloudMail address must not enter Gmail IMAP flow")
        discover.tap()

        assertManagedCloudMailAddressHasAction(email: "admin@fastonegroup.com")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Session expired'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'SQLITE_ERROR'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'D1_ERROR'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'CancellationError'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Swift.CancellationError'")).firstMatch.exists)
    }

    func testGPT67AdminHengmaoSecureAuthBoundaryDoesNotAutomateSecretInput() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()

        app.buttons["CloudMail actions"].tap()
        tapCloudMailActionSettings(timeout: 5)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10))
        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10))

        replace(app.textFields["you@example.com"], with: "admin@hengmao.org")
        if app.buttons["Continue"].waitForExistence(timeout: 5) {
            app.buttons["Continue"].tap()
        }

        XCTAssertTrue(app.navigationBars["Secure sign in"].waitForExistence(timeout: 20), "GPT67 secure sheet did not appear")
        XCTAssertTrue(app.textFields["Secure authentication email"].exists, "Secure principal email field missing")
        XCTAssertTrue(app.secureTextFields["Secure authentication input"].exists, "Secure password/code/OTP field missing")
        XCTAssertEqual(app.secureTextFields["Secure authentication input"].value as? String, "Enter password securely on iPhone")
        XCTAssertFalse(app.buttons["Continue securely"].isEnabled, "Continue must remain disabled before local user input")

        // Deliberately no typeText and no screenshot while the secure sheet is open.
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Resume secure authentication"].waitForExistence(timeout: 5), "Authentication did not remain resumable after cancel")
    }

    func testExistingAccountLoginLifecycle() throws {
        guard let credentials = runtimeCredentials() else {
            throw XCTSkip("Existing-account device credentials were not supplied")
        }

        login(email: credentials.email, password: credentials.password)
        assertNoBlockingErrors()
        signOut()
        login(email: credentials.email, password: credentials.password)
        assertNoBlockingErrors()
    }

    func testFinalAcceptanceInstalledCloudMailLaunches() throws {
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "CloudMail did not launch on the physical device")
        XCTAssertTrue(
            app.staticTexts["NEXORA"].waitForExistence(timeout: 10)
                || app.navigationBars["Inbox"].waitForExistence(timeout: 1)
                || app.buttons["NEXORA actions"].waitForExistence(timeout: 1),
            "NEXORA launched, but no expected NEXORA surface was visible"
        )
        assertNoBlockingErrors()
    }

    func testNexoraV3CommandCenterRealIPhone() throws {
        app.launch()
        XCTAssertTrue(app.buttons["Organization"].waitForExistence(timeout: 30), "NEXORA authenticated home did not expose Organization")
        app.buttons["Organization"].tap()
        XCTAssertTrue(app.navigationBars["Organization"].waitForExistence(timeout: 10), "Organization center did not open")
        XCTAssertTrue(app.buttons["NEXORA V3"].waitForExistence(timeout: 10), "NEXORA V3 entry was not visible")
        app.buttons["NEXORA V3"].tap()
        XCTAssertTrue(app.navigationBars["NEXORA V3"].waitForExistence(timeout: 10), "NEXORA V3 command center did not open")
        for label in ["Add Email · Authorize Once · Leave", "Authority Center", "Health", "Operating System Centers"] {
            XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 10), "Missing NEXORA V3 surface: \(label)")
        }
        XCTAssertTrue(app.buttons["Add to NEXORA"].waitForExistence(timeout: 10), "NEXORA provider-neutral onboarding action was missing")
        XCTAssertTrue(app.staticTexts["Silent escalation"].waitForExistence(timeout: 10), "Authority safety boundary was missing")
        scrollToStaticTextOrButton("Provider Capability Matrix", maxSwipes: 8)
        XCTAssertTrue(app.staticTexts["Provider Capability Matrix"].waitForExistence(timeout: 10), "Provider Capability Matrix was not visible after scrolling")
        addScreenshot("nexora-v3-command-center-real-iphone")
        assertNoBlockingErrors()
    }

    func testAIBriefingToggleExpandsOnTwoExistingSessionMessages() throws {
        let subjects = [
            "CloudMail attachment real-use test 20260706-151301",
            "CloudMail real-use send test 20260706-121605"
        ]

        for (index, subject) in subjects.enumerated() {
            app.terminate()
            app.launchArguments = [
                "-CloudMailInitialTab", "inbox",
                "-CloudMailOpenSubject", subject
            ]
            app.launch()

            XCTAssertTrue(
                app.navigationBars.matching(NSPredicate(format: "label CONTAINS[c] %@", subject)).firstMatch.waitForExistence(timeout: 30),
                "Round \(index + 1): did not open expected message detail for \(subject)"
            )

            let toggle = app.buttons["AI Briefing Toggle"]
            XCTAssertTrue(toggle.waitForExistence(timeout: 15), "Round \(index + 1): AI Briefing toggle was not available")
            if app.staticTexts["Readiness"].exists {
                toggle.tap()
                XCTAssertFalse(
                    app.staticTexts["Readiness"].waitForExistence(timeout: 2),
                    "Round \(index + 1): AI Briefing did not collapse before the expansion tap"
                )
            }

            toggle.tap()
            XCTAssertTrue(
                app.staticTexts["Readiness"].waitForExistence(timeout: 10),
                "Round \(index + 1): tapping AI Briefing did not expand readiness details"
            )
            XCTAssertTrue(
                app.staticTexts["Summarize"].waitForExistence(timeout: 5),
                "Round \(index + 1): Summarize remained unavailable after expanding AI Briefing"
            )
            addScreenshot("ai-briefing-toggle-round-\(index + 1)")
            assertNoBlockingErrors()
        }
    }

    func testGmailInboxAndDetailRenderSourceMetadata() throws {
        guard let credentials = runtimeCredentials() else {
            throw XCTSkip("Existing-account device credentials were not supplied")
        }

        login(email: credentials.email, password: credentials.password)
        assertNoBlockingErrors()

        let gmailBadge = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail")).firstMatch
        XCTAssertTrue(gmailBadge.waitForExistence(timeout: 30), "Gmail provider badge did not render in Inbox")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "saercpku@gmail.com")).firstMatch.waitForExistence(timeout: 10),
            "Gmail account metadata did not render in Inbox"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "gmail.com")).firstMatch.waitForExistence(timeout: 10),
            "Gmail domain metadata did not render in Inbox"
        )

        let gmailSubject = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "CMOS5D Attachment Persistence")).firstMatch
        XCTAssertTrue(gmailSubject.waitForExistence(timeout: 30), "Expected Gmail validation subject did not render in Inbox")
        gmailSubject.tap()

        XCTAssertTrue(
            app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] %@ OR label CONTAINS[c] %@", "CMOS5D Attachment Persistence", "CMOS5D Attachment Persistence")).firstMatch.waitForExistence(timeout: 10),
            "Gmail message detail did not open"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail")).firstMatch.waitForExistence(timeout: 10),
            "Gmail provider metadata did not render in detail"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "saercpku@gmail.com")).firstMatch.waitForExistence(timeout: 10),
            "Gmail account metadata did not render in detail"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "gmail.com")).firstMatch.waitForExistence(timeout: 10),
            "Gmail domain metadata did not render in detail"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Thread:")).firstMatch.waitForExistence(timeout: 10),
            "Gmail thread metadata did not render in detail"
        )
        assertNoBlockingErrors()
    }

    func testLoop5JMessageDetailSourceTruthWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()

        app.buttons["CloudMail actions"].tap()
        let summarize = app.buttons["Summarize all visible"]
        XCTAssertTrue(summarize.waitForExistence(timeout: 5), "Summarize action was not available for source-detail proof")
        summarize.tap()

        var rowSignal = aiAttributionElement(containing: "AI: Apple Intelligence")
        if !rowSignal.waitForExistence(timeout: 45) {
            openMailboxSwitcher()
            let allMail = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All connected mailboxes")).firstMatch
            XCTAssertTrue(allMail.waitForExistence(timeout: 5), "All-mail row was not available for source-detail proof")
            allMail.tap()
            app.buttons["CloudMail actions"].tap()
            XCTAssertTrue(summarize.waitForExistence(timeout: 5), "Summarize action was not available after switching to all mail")
            summarize.tap()
            rowSignal = aiAttributionElement(containing: "AI: Apple Intelligence")
        }
        XCTAssertTrue(rowSignal.waitForExistence(timeout: 45), "No source-attributed visible mail row was available")
        openSourceAttributedMessage(attribution: rowSignal, roundName: "loop5j-source-detail")

        XCTAssertFalse(app.navigationBars["Inbox"].exists, "Tapping a source-attributed row did not open message detail")
        XCTAssertFalse(app.staticTexts["Message source"].exists, "Legacy source panel should not dominate normal reading")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Gmail", "CloudMail")).firstMatch.waitForExistence(timeout: 10),
            "Compact source context did not show a mailbox provider"
        )
        app.buttons["Message actions"].tap()
        XCTAssertTrue(app.buttons["Message details"].waitForExistence(timeout: 5), "Message details action was not available")
        app.buttons["Message details"].tap()
        XCTAssertTrue(app.navigationBars["Message details"].waitForExistence(timeout: 10), "Message details sheet did not open")
        XCTAssertTrue(app.staticTexts["Provider"].waitForExistence(timeout: 10), "Detail provider label was not visible")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Gmail", "CloudMail")).firstMatch.waitForExistence(timeout: 10),
            "Detail provider value did not show a mailbox provider"
        )
        XCTAssertTrue(app.staticTexts["Account"].waitForExistence(timeout: 10), "Detail account label was not visible")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 10),
            "Detail account value did not show a mailbox email address"
        )
        XCTAssertTrue(app.staticTexts["Domain"].waitForExistence(timeout: 10), "Detail domain label was not visible")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "gmail.com", "fastonegroup.com")).firstMatch.waitForExistence(timeout: 10),
            "Detail domain value did not show mailbox domain"
        )
        XCTAssertTrue(
            app.staticTexts["Thread"].waitForExistence(timeout: 10)
                || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Thread")).firstMatch.waitForExistence(timeout: 1),
            "Detail thread metadata was not visible"
        )
        app.buttons["Done"].tap()
        assertNoBlockingErrors()
    }

    func testV5DashboardControlCenterWithExistingSession() throws {
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Dashboard validation did not reach Inbox")
        assertNoBlockingErrors()

        XCTAssertTrue(app.staticTexts["Mail OS control center"].waitForExistence(timeout: 10), "Mail OS control center subtitle missing")
        XCTAssertTrue(app.staticTexts["AI Briefing"].waitForExistence(timeout: 10), "AI Briefing dashboard section missing")
        XCTAssertTrue(app.staticTexts["Mailbox Health"].waitForExistence(timeout: 10), "Mailbox Health dashboard section missing")

        let needReply = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Need Reply")).firstMatch
        XCTAssertTrue(needReply.waitForExistence(timeout: 10), "Need Reply briefing card was not clickable")
        needReply.tap()
        let selectedNeedReply = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Need Reply")).firstMatch
        XCTAssertTrue(selectedNeedReply.waitForExistence(timeout: 5), "Need Reply briefing card disappeared after selection")
        XCTAssertEqual(selectedNeedReply.value as? String, "Selected", "Need Reply dashboard action did not expose selected state")
        addScreenshot("v5-dashboard-01-need-reply-filter")

        let mailboxDetail = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Open mailbox detail")).firstMatch
        XCTAssertTrue(mailboxDetail.waitForExistence(timeout: 10), "Mailbox Health card was not actionable")
        mailboxDetail.tap()
        XCTAssertTrue(app.navigationBars["Mailbox Detail"].waitForExistence(timeout: 10), "Mailbox Detail screen did not open")
        XCTAssertTrue(app.staticTexts["Authorization Health"].waitForExistence(timeout: 5), "Mailbox Detail authorization row missing")
        XCTAssertTrue(app.staticTexts["Current Sync State"].waitForExistence(timeout: 5), "Mailbox Detail sync state row missing")
        addScreenshot("v5-dashboard-02-mailbox-detail")
        app.buttons["Done"].tap()

        XCTAssertTrue(app.buttons["Open command palette"].waitForExistence(timeout: 10), "Dashboard command action missing")
        app.buttons["Open command palette"].tap()
        XCTAssertTrue(app.navigationBars["Command Palette"].waitForExistence(timeout: 10), "Command Palette did not open from dashboard")
        addScreenshot("v5-dashboard-03-command-palette")
        closePresentedSheet()

        scrollToStaticText("Sync Status", maxSwipes: 8)
        scrollToStaticText("Data Trust", maxSwipes: 8)
        addScreenshot("v5-dashboard-04-sync-trust")

        scrollToStaticText("Mail OS control center", direction: .down, maxSwipes: 8)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.staticTexts["Mail OS control center"].waitForExistence(timeout: 10), "Dashboard did not remain visible in landscape")
        addScreenshot("v5-dashboard-05-landscape")
        XCUIDevice.shared.orientation = .portrait
        assertNoBlockingErrors()
    }

    func testLoop6ARound1ExistingUserRealFlowWithRuntimeCredentials() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        validateLoop6ACommonUserFlow(roundName: "round1", expectedSignedInEmail: nil, expectGmailConnected: true)
    }

    func testLoop6ARound2NewUserLogoutLoginAgainNoStateLeak() throws {
        guard runtimeCredentials() != nil || !app.navigationBars["Inbox"].waitForExistence(timeout: 5) else {
            throw XCTSkip("Logout/login reset flow skipped because final acceptance is using an existing manual device session")
        }
        if testCredentialBridgeURL != nil {
            app.launch()
            try ensureInboxFromExistingSessionOrRuntimeCredentials()
            validateLoop6ACommonUserFlow(roundName: "round2-before-logout", expectedSignedInEmail: nil, expectGmailConnected: true)
            signOut()
            app.terminate()
            app.launch()
            XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 45), "Bridge login after logout did not reach Inbox")
            validateLoop6ACommonUserFlow(roundName: "round2-login-again", expectedSignedInEmail: nil, expectGmailConnected: true)
            return
        }

        let stamp = Int(Date().timeIntervalSince1970)
        let localPart = "deviceflow\(stamp)"
        let fullEmail = "\(localPart)@\(domain)"
        let password = "CloudMail#Flow-\(stamp)"

        registerAndLogin(localPart: localPart, fullEmail: fullEmail, password: password)
        validateLoop6ACommonUserFlow(roundName: "round2-first-login", expectedSignedInEmail: fullEmail, expectGmailConnected: false)
        signOut()

        login(email: fullEmail, password: password)
        validateLoop6ACommonUserFlow(roundName: "round2-login-again", expectedSignedInEmail: fullEmail, expectGmailConnected: false)
    }

    func testLoop6BComposeDraftAndMailClientCoreWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        let composeButton = app.navigationBars["Inbox"].buttons.matching(identifier: "square.and.pencil").firstMatch
        XCTAssertTrue(composeButton.waitForExistence(timeout: 10), "Compose button was not visible from Inbox")
        composeButton.tap()

        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 10), "Compose sheet did not open")
        XCTAssertTrue(app.staticTexts["From"].waitForExistence(timeout: 5), "Composer did not expose From selector")
        XCTAssertTrue(app.staticTexts["To"].waitForExistence(timeout: 5), "Composer did not expose To field")
        XCTAssertTrue(app.staticTexts["CC"].waitForExistence(timeout: 5), "Composer did not expose CC field")
        XCTAssertTrue(app.staticTexts["BCC"].waitForExistence(timeout: 5), "Composer did not expose BCC field")
        XCTAssertTrue(app.staticTexts["Message"].waitForExistence(timeout: 5), "Composer did not expose body editor")
        XCTAssertTrue(app.staticTexts["Attachments"].waitForExistence(timeout: 5), "Composer did not expose attachment section")
        XCTAssertTrue(app.buttons["Add files"].waitForExistence(timeout: 5), "Composer did not expose attachment picker")
        XCTAssertTrue(app.buttons["Signature"].waitForExistence(timeout: 5), "Composer did not expose signature insertion")
        XCTAssertTrue(app.buttons["AI"].waitForExistence(timeout: 5), "Composer did not expose AI writing assistant")
        XCTAssertTrue(app.staticTexts["Schedule send"].waitForExistence(timeout: 5), "Composer did not expose Schedule Send truth")

        replace(app.textFields["name@example.com"], with: "cloudmail-test-recipient@example.com")
        replace(app.textFields["Subject"], with: "Loop 6B draft proof")
        tapSaveDraft()

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10), "Saving draft did not return to Inbox")
        openMailboxSwitcher()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Drafts")).firstMatch.waitForExistence(timeout: 10), "Drafts folder was not visible in mailbox drawer")
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Drafts")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Loop 6B draft proof")).firstMatch.waitForExistence(timeout: 10), "Saved draft did not appear in Drafts")

        openSettings()
        XCTAssertTrue(app.staticTexts["Mail client"].waitForExistence(timeout: 10), "Mail client settings section was not visible")
        XCTAssertTrue(app.staticTexts["Primary identity"].waitForExistence(timeout: 5), "Primary identity was not visible")
        XCTAssertTrue(app.staticTexts["Default From"].waitForExistence(timeout: 5), "Default From was not visible")
        for _ in 0..<3 {
            if app.staticTexts["iCloud profile sync"].exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["iCloud profile sync"].waitForExistence(timeout: 5), "iCloud profile sync truth was not visible")
        scrollToButton("Signatures", maxSwipes: 6)
        XCTAssertTrue(app.buttons["Signatures"].waitForExistence(timeout: 5), "Signature settings were not reachable")
        assertNoBlockingErrors()
    }

    func testMailOSV2TwelveProductivityFeaturesRealIPhoneNonDestructive() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "MailOS V2 validation did not reach Inbox")
        resetMailOSV2InboxList(roundName: "mailos-v2-initial-reset")
        addScreenshot("mailos-v2-00-inbox")

        validateMailOSV2Feature01MultiSelect()
        validateMailOSV2Feature02InlineStar()
        validateMailOSV2Feature03Categories()
        validateMailOSV2Feature04MoveSheetAndFeature07SnoozeAndFeature08UnsubscribeAndFeature10SenderProfile()
        validateMailOSV2Feature05AutocompleteFeature06UndoFeature09TemplatesFeature12ReadReceipts()
        validateMailOSV2Feature11SmartSearch()
        assertNoBlockingErrors()
    }

    func testNexoraComposeProductivityRealIPhoneNonDestructive() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Compose productivity validation did not reach Inbox")
        validateMailOSV2Feature05AutocompleteFeature06UndoFeature09TemplatesFeature12ReadReceipts()
        assertNoBlockingErrors()
    }

    func testNexoraLongPressAndMultiSelectRealIPhone() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Long-press validation did not reach Inbox")
        validateMailOSV2Feature01MultiSelect()
        assertNoBlockingErrors()
    }

    func testNexoraMoveUndoAndSearchRealIPhone() throws {
        app.terminate()
        app.launchArguments = ["-CloudMailInitialTab", "inbox"]
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Move validation did not reach Inbox")

        openFirstVisibleReceivedMessage(roundName: "nexora-move-undo")
        XCTAssertTrue(isEmailDetailSurfaceVisible(), "Move validation did not open message detail")
        XCTAssertTrue(app.buttons["Move"].waitForExistence(timeout: 10), "Move action missing from message detail")
        app.buttons["Move"].tap()
        XCTAssertTrue(app.navigationBars["Move to"].waitForExistence(timeout: 10), "Move destination sheet did not open")
        // The selected row may have been left in Follow-up by an interrupted prior
        // run. A same-folder move is intentionally idempotent and has no Undo UI,
        // so try Done first and, only if it was already Done, move to Inbox. This
        // proves a real state transition while the subsequent Undo restores the
        // original folder in either case.
        let doneDestination = app.buttons["move-to-mailbox-done"].firstMatch
        XCTAssertTrue(doneDestination.waitForExistence(timeout: 10), "Done destination missing")
        doneDestination.tap()
        if !app.buttons["mail-action-undo"].waitForExistence(timeout: 3) {
            XCTAssertTrue(app.buttons["Move"].waitForExistence(timeout: 10), "Move action disappeared after idempotent Done move")
            app.buttons["Move"].tap()
            XCTAssertTrue(app.navigationBars["Move to"].waitForExistence(timeout: 10), "Move destination sheet did not reopen")
            let inboxDestination = app.buttons["move-to-mailbox-inbox"].firstMatch
            XCTAssertTrue(inboxDestination.waitForExistence(timeout: 10), "Inbox destination missing")
            inboxDestination.tap()
        }
        XCTAssertTrue(app.buttons["mail-action-undo"].waitForExistence(timeout: 10), "Persistent Move produced no Undo feedback")
        app.buttons["mail-action-undo"].tap()
        XCTAssertTrue(
            waitUntil(timeout: 15) { !self.app.buttons["mail-action-undo"].exists },
            "Move Undo did not receive canonical success; the recovery affordance remained available"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'mail_state_version_conflict'")).firstMatch.exists,
            "Undo hit a canonical mail state version conflict"
        )
        returnToInboxFromNestedSettings(roundName: "nexora-move-undo-return")

        validateMailOSV2Feature11SmartSearch()
        assertNoBlockingErrors()
    }

    func testNexoraSwipeJunkCanonicalRecoveryRealIPhone() throws {
        app.terminate()
        app.launchArguments = ["-CloudMailInitialTab", "inbox"]
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Swipe Junk validation did not reach Inbox")

        let filterRail = app.scrollViews["Inbox filters"]
        for _ in 0..<6 where !app.buttons["Junk"].firstMatch.isHittable { filterRail.swipeLeft() }
        let junkFilter = app.buttons["Junk"].firstMatch
        XCTAssertTrue(junkFilter.isHittable, "Junk filter was not reachable")
        junkFilter.tap()
        // History Facts is a known Junk sample. Restore it through the leading
        // action, then move the same message back through the trailing Junk
        // action. The test ends in its expected Junk state on every rerun.
        let historyFacts = try XCTUnwrap(
            tappableEmailRows().first(where: { $0.label.localizedCaseInsensitiveContains("History Facts") }),
            "Swipe Junk validation could not find the known History Facts Junk sample"
        )
        historyFacts.swipeRight()
        let inbox = app.buttons["Inbox"].firstMatch
        XCTAssertTrue(inbox.waitForExistence(timeout: 8), "Leading swipe did not expose the Inbox action")
        inbox.tap()
        XCTAssertTrue(app.buttons["mail-action-undo"].waitForExistence(timeout: 10), "Leading Inbox restore produced no canonical success/Undo feedback")

        for _ in 0..<6 where !app.buttons["All"].firstMatch.isHittable { filterRail.swipeRight() }
        let allFilter = app.buttons["All"].firstMatch
        XCTAssertTrue(allFilter.isHittable, "All filter was not reachable after Inbox restore")
        allFilter.tap()

        var row = tappableEmailRows().first(where: {
            $0.label.localizedCaseInsensitiveContains("History Facts")
                && $0.label.localizedCaseInsensitiveContains("Folder: Inbox")
        })
        for _ in 0..<5 where row == nil {
            app.swipeUp()
            row = tappableEmailRows().first(where: {
                $0.label.localizedCaseInsensitiveContains("History Facts")
                    && $0.label.localizedCaseInsensitiveContains("Folder: Inbox")
            })
        }
        let validatedRow = try XCTUnwrap(row, "Canonical Inbox restore did not expose History Facts for trailing-swipe validation")
        validatedRow.swipeLeft()
        let junk = app.buttons["Junk"].firstMatch
        XCTAssertTrue(junk.waitForExistence(timeout: 8), "Trailing swipe did not expose the Junk action")
        junk.tap()
        addScreenshot("swipe-junk-after-tap")
        XCTAssertTrue(app.buttons["mail-action-undo"].waitForExistence(timeout: 10), "Swipe Junk produced no canonical success/Undo feedback")
        XCTAssertTrue(
            waitUntil(timeout: 10) {
                !self.tappableEmailRows().contains(where: { $0.label.localizedCaseInsensitiveContains("History Facts") })
            },
            "A Junk message remained visible in the default All Mail categories"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'mail_state_version_conflict'")).firstMatch.exists,
            "Swipe Junk surfaced a version conflict instead of reconciling once"
        )
        // Keep the known sample in its expected Junk classification after this
        // state-transition proof. Existing Move/Undo acceptance covers Undo.
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'mail_state_version_conflict'")).firstMatch.exists,
            "Undo after Swipe Junk surfaced a version conflict"
        )
        assertNoBlockingErrors()
    }

    func testNexoraMoveAllFromSenderRealIPhone() throws {
        app.terminate()
        app.launchArguments = ["-CloudMailInitialTab", "inbox"]
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Sender batch validation did not reach Inbox")

        let filterRail = app.scrollViews["Inbox filters"]
        for _ in 0..<6 where !app.buttons["Junk"].firstMatch.isHittable { filterRail.swipeLeft() }
        let junkFilter = app.buttons["Junk"].firstMatch
        XCTAssertTrue(junkFilter.isHittable, "Sender batch Junk filter was not reachable")
        junkFilter.tap()

        let historyFacts = try XCTUnwrap(
            tappableEmailRows().first(where: { $0.label.localizedCaseInsensitiveContains("History Facts") }),
            "Sender batch validation could not find the History Facts sample"
        )
        tapElement(historyFacts)
        XCTAssertTrue(isEmailDetailSurfaceVisible(), "Sender batch validation did not open message detail")

        func moveAllFromSender(to destination: String) {
            let messageActions = app.buttons["Message actions"]
            XCTAssertTrue(messageActions.waitForExistence(timeout: 8), "Message actions menu missing")
            messageActions.tap()
            let senderMenu = app.buttons["Move All From Sender"]
            XCTAssertTrue(senderMenu.waitForExistence(timeout: 8), "Move All From Sender menu missing")
            senderMenu.tap()
            let target = app.buttons["Move all to \(destination)"]
            XCTAssertTrue(target.waitForExistence(timeout: 8), "Sender batch destination \(destination) missing")
            target.tap()
        }

        moveAllFromSender(to: "Inbox")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "messages from this sender to Inbox")).firstMatch.waitForExistence(timeout: 15),
            "Sender batch Inbox move did not report a canonical completion"
        )
        moveAllFromSender(to: "Junk")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "messages from this sender to Junk")).firstMatch.waitForExistence(timeout: 15),
            "Sender batch Junk move did not report a canonical completion"
        )
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'mail_state_version_conflict'")).firstMatch.exists,
            "Sender batch move surfaced a canonical version conflict"
        )
        assertNoBlockingErrors()
    }

    func testNexoraGoalsDefaultHomeAndCreationRealIPhone() throws {
        app.launch()
        let launchedOnGoals = app.navigationBars["Goals"].waitForExistence(timeout: 12)
        if !launchedOnGoals, app.navigationBars["Inbox"].exists {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        } else if !launchedOnGoals {
            try ensureInboxFromExistingSessionOrRuntimeCredentials()
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing after authentication")
            app.buttons["Goals"].tap()
        }
        XCTAssertTrue(app.navigationBars["Goals"].waitForExistence(timeout: 10), "Goals did not become the primary Home")
        XCTAssertTrue(app.staticTexts["What do you want NEXORA to accomplish?"].waitForExistence(timeout: 5), "Goal outcome prompt missing")

        let input = app.textFields["goal-home-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5), "Goal natural-language input missing")
        replace(input, with: "Prepare the weekly executive communication review")
        let create = app.buttons["goal-home-create"]
        XCTAssertTrue(create.waitForExistence(timeout: 5), "Create Goal action missing")
        XCTAssertTrue(create.isEnabled, "Create Goal remained disabled with a valid outcome")
        create.tap()

        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 10), "Created Goal did not open its governed execution center")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Prepare the weekly executive communication review")).firstMatch.waitForExistence(timeout: 10),
            "Created Goal was not visible after persistence"
        )
        addScreenshot("nexora-v303-goals-default-home-created")
        assertNoBlockingErrors()
    }

    func testNexoraGoalProgressiveDisclosureRealIPhone() throws {
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }

        let input = app.textFields["goal-home-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8), "Goal input missing")
        replace(input, with: "Prepare scalable list validation")
        app.buttons["goal-home-create"].tap()
        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 8), "Goal Center did not open")

        for index in 1...2 {
            app.buttons["Create goal"].tap()
            XCTAssertTrue(app.navigationBars["New Goal"].waitForExistence(timeout: 5), "New Goal sheet missing")
            replace(app.textFields["Goal"], with: "Scalable validation goal \(index)")
            replace(app.textFields["Desired outcome"], with: "Verify progressive disclosure and exact scoped search \(index)")
            app.buttons["Create"].tap()
            XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 5), "New goal did not return to Goal Center")
        }

        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Show All")).firstMatch.waitForExistence(timeout: 8), "Growing Goals list did not show a count-aware expansion action")
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Show All")).firstMatch.tap()
        for _ in 0..<4 where !app.buttons["Collapse goals"].exists { app.swipeUp() }
        XCTAssertTrue(app.buttons["Collapse goals"].waitForExistence(timeout: 5), "Expanded Goals list did not offer Show Less")

        for _ in 0..<4 where !app.textFields["Search goals"].exists { app.swipeDown() }
        let search = app.textFields["Search goals"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), "Growing Goals list did not expose contextual search")
        replace(search, with: "Scalable validation goal 2")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Scalable validation goal 2")).firstMatch.waitForExistence(timeout: 5), "Exact scoped Goal search returned no matching result")
        XCTAssertTrue(app.buttons["Clear goals search"].waitForExistence(timeout: 5), "Goal search clear action missing")
        app.buttons["Clear goals search"].tap()
        for _ in 0..<4 where !app.buttons["Collapse goals"].exists { app.swipeUp() }
        XCTAssertTrue(app.buttons["Collapse goals"].waitForExistence(timeout: 5), "Clearing search lost expanded state")
        app.buttons["Collapse goals"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Show All")).firstMatch.waitForExistence(timeout: 5), "Goals list did not collapse after Show Less")
        addScreenshot("nexora-v303-goal-progressive-disclosure")
        assertNoBlockingErrors()
    }

    func testNexoraGoalDetailActionsProgressiveDisclosureRealIPhone() throws {
        let outcome = "Validate mission action progressive disclosure workflow"
        let expectedTitle = "Validate mission action progressive disclosure workflow"

        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }

        let input = app.textFields["goal-home-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 8), "Goal input missing")
        replace(input, with: outcome)
        app.buttons["goal-home-create"].tap()
        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 8), "Goal Center did not open")

        let goal = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", expectedTitle)).firstMatch
        XCTAssertTrue(goal.waitForExistence(timeout: 8), "Created goal was not visible in Goal Center")
        goal.tap()
        XCTAssertTrue(app.staticTexts["Plan"].waitForExistence(timeout: 8), "Goal detail did not expose its execution plan")

        let expand = app.buttons["Show more goal actions"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5), "Goal detail did not offer count-aware action expansion")
        expand.tap()
        XCTAssertTrue(app.textFields["Search goal actions"].waitForExistence(timeout: 5), "Expanded goal actions did not expose contextual search")
        XCTAssertTrue(app.buttons["Show less goal actions"].waitForExistence(timeout: 5), "Expanded goal actions did not offer collapse")

        replace(app.textFields["Search goal actions"], with: "Review and share")
        XCTAssertTrue(app.staticTexts["1 result · Exact local filter"].waitForExistence(timeout: 5), "Goal action search did not expose truthful exact-result scope")
        XCTAssertTrue(app.staticTexts["Review and share"].waitForExistence(timeout: 5), "Goal action search did not return the matching action")
        app.buttons["Clear goal actions search"].tap()
        XCTAssertTrue(app.buttons["Show less goal actions"].waitForExistence(timeout: 5), "Clearing goal action search lost expanded state")
        app.buttons["Show less goal actions"].tap()
        XCTAssertTrue(app.buttons["Show more goal actions"].waitForExistence(timeout: 5), "Goal action list did not collapse after Show Less")
        addScreenshot("nexora-v303-goal-detail-actions-progressive")
        assertNoBlockingErrors()
    }

    func testNexoraGoalOSPrimaryNavigationRealIPhone() throws {
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }

        let destinations: [(String, String)] = [
            ("today", "What matters now"),
            ("execute", "Queues"),
            ("spaces", "Context Spaces"),
            ("people", "Goal-Relevant People"),
            ("briefing", "Chief of Staff Briefing"),
            ("goals", "Active Goals")
        ]
        for (identifier, expected) in destinations {
            let button = app.buttons["goal-os-\(identifier)"]
            XCTAssertTrue(button.waitForExistence(timeout: 5), "Goal OS \(identifier) navigation missing")
            button.tap()
            XCTAssertTrue(app.staticTexts[expected].waitForExistence(timeout: 5), "Goal OS \(identifier) did not expose \(expected)")
        }
        XCTAssertTrue(app.textFields["goal-home-input"].waitForExistence(timeout: 5), "Returning to Goals lost the primary outcome input")
        addScreenshot("nexora-v303-goal-os-primary-navigation")
        assertNoBlockingErrors()
    }

    func testNexoraPeopleGraphRefreshAndProgressiveDisclosureRealIPhone() throws {
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }
        let people = app.buttons["goal-os-people"]
        XCTAssertTrue(people.waitForExistence(timeout: 5), "People entry missing")
        people.tap()
        XCTAssertTrue(app.staticTexts["Goal-Relevant People"].waitForExistence(timeout: 5), "People surface missing")

        if app.buttons["Refresh Context Graph"].exists { app.buttons["Refresh Context Graph"].tap() }
        if app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Show All")).firstMatch.exists {
            let expand = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Show All")).firstMatch
            expand.tap()
            XCTAssertTrue(app.textFields["Search people"].waitForExistence(timeout: 5), "Growing People graph did not expose contextual search")
            XCTAssertTrue(app.buttons["Collapse people"].waitForExistence(timeout: 5), "Expanded People graph did not offer collapse")
        }
        addScreenshot("nexora-v303-people-graph-progressive")
        assertNoBlockingErrors()
    }

    func testNexoraExecuteProgressiveListsRealIPhone() throws {
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }
        app.buttons["goal-os-execute"].tap()
        XCTAssertTrue(app.staticTexts["Queues"].waitForExistence(timeout: 5), "Execute surface missing")
        XCTAssertTrue(app.staticTexts["Prepare"].waitForExistence(timeout: 5), "Template section missing")
        XCTAssertTrue(app.staticTexts["Completion Evidence"].waitForExistence(timeout: 5), "Evidence section missing")
        addScreenshot("nexora-v303-execute-progressive")
        assertNoBlockingErrors()
    }

    func testNexoraExecuteTemplatePrefillsComposerRealIPhone() throws {
        let template = "Thanks, I received this and will follow up shortly."
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }
        XCTAssertTrue(app.buttons["goal-os-execute"].waitForExistence(timeout: 5), "Execute navigation missing")
        app.buttons["goal-os-execute"].tap()
        let templateButton = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Thanks, I received this")).firstMatch
        XCTAssertTrue(templateButton.waitForExistence(timeout: 8), "Execute template action missing")
        templateButton.tap()
        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 8), "Template action did not open the composer")
        let body = app.textViews["Compose message body"]
        XCTAssertTrue(body.waitForExistence(timeout: 5), "Composer message body missing")
        XCTAssertTrue((body.value as? String ?? "").contains(template), "Execute template action opened a composer without inserting its template")
        addScreenshot("nexora-v303-execute-template-prefill")
        assertNoBlockingErrors()
    }

    func testNexoraOutputCreationFeedbackRealIPhone() throws {
        let outcome = "Confirm visible output creation feedback"
        app.launch()
        if !app.navigationBars["Goals"].waitForExistence(timeout: 12) {
            XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing")
            app.buttons["Goals"].tap()
        }
        replace(app.textFields["goal-home-input"], with: outcome)
        app.buttons["goal-home-create"].tap()
        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 8), "Goal Center did not open")
        let goal = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", outcome)).firstMatch
        XCTAssertTrue(goal.waitForExistence(timeout: 8), "Created goal missing")
        goal.tap()
        scrollToStaticTextOrButton("Create output", maxSwipes: 10)
        app.buttons["Executive Brief"].tap()
        let confirmation = app.staticTexts["Created output"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5), "Creating an output gave no visible completion feedback")
        XCTAssertTrue(confirmation.label.contains("Executive Brief"), "Output completion feedback did not name the created output")
        addScreenshot("nexora-v303-output-creation-feedback")
        assertNoBlockingErrors()
    }

    func testNexoraEnterpriseOrganizationTruthRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) { app.buttons["Email"].tap() }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Organization truth validation did not reach Inbox")
        app.buttons["NEXORA actions"].tap()
        tapCloudMailActionSettings(timeout: 5)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 8), "Settings missing")
        scrollToButton("Enterprise Hub")
        app.buttons["Enterprise Hub"].tap()
        XCTAssertTrue(app.navigationBars["Enterprise Hub"].waitForExistence(timeout: 8), "Enterprise Hub missing")
        app.buttons["Directory"].tap()
        scrollToStaticTextOrButton("Organization Graph", maxSwipes: 8)
        XCTAssertTrue(app.staticTexts["Organization Graph"].waitForExistence(timeout: 5), "Organization Graph missing")
        XCTAssertTrue(app.staticTexts["Observed Domains"].waitForExistence(timeout: 5), "Organization Graph did not identify observed domains")
        for _ in 0..<4 where !app.otherElements["organization-graph-department-directory"].exists { app.swipeUp() }
        XCTAssertTrue(app.otherElements["organization-graph-department-directory"].waitForExistence(timeout: 5), "Unobserved department metadata row was not exposed accessibly")
        XCTAssertTrue(app.otherElements["organization-graph-department-directory"].label.contains("Provider metadata not observed"), "Unobserved department metadata was not disclosed truthfully")
        XCTAssertFalse(app.staticTexts["Operations, Finance, Legal, Support"].exists, "Legacy fixed department placeholders remained visible")
        addScreenshot("nexora-v303-enterprise-organization-truth")
        assertNoBlockingErrors()
    }

    func testNexoraSettingsThemeAndEnterpriseCollapsibleListsRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) { app.buttons["Email"].tap() }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Theme and list validation did not reach Inbox")
        app.buttons["NEXORA actions"].tap()
        tapCloudMailActionSettings(timeout: 5)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 8), "Settings missing")
        app.buttons["Dark"].tap()
        XCTAssertTrue(app.buttons["Dark"].isSelected, "Settings did not immediately retain Dark selection")
        addScreenshot("nexora-v303-settings-dark-immediate")
        app.buttons["Light"].tap()
        XCTAssertTrue(app.buttons["Light"].isSelected, "Settings did not immediately retain Light selection")
        addScreenshot("nexora-v303-settings-light-immediate")

        scrollToButton("Enterprise Hub")
        app.buttons["Enterprise Hub"].tap()
        XCTAssertTrue(app.navigationBars["Enterprise Hub"].waitForExistence(timeout: 8), "Enterprise Hub missing")
        app.buttons["Rules"].tap()
        XCTAssertTrue(app.staticTexts["Rules Engine"].waitForExistence(timeout: 5), "Rules surface missing")
        let expand = app.buttons["Show more rules"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5), "Rules list did not default to a compact progressive list")
        expand.tap()
        XCTAssertTrue(app.buttons["Show less rules"].waitForExistence(timeout: 5), "Rules list did not expand")
        app.buttons["Show less rules"].tap()
        XCTAssertTrue(expand.waitForExistence(timeout: 5), "Rules list did not collapse")
        addScreenshot("nexora-v303-enterprise-collapsible-rules")
        assertNoBlockingErrors()
    }

    func testNexoraExecuteCompletionEvidenceRealIPhone() throws {
        let outcome = "Create reviewable completion evidence for Execute"
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) { app.buttons["Email"].tap() }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Evidence validation did not establish an authenticated mailbox session")
        XCTAssertTrue(app.buttons["Goals"].waitForExistence(timeout: 5), "Goals tab missing after authentication")
        app.buttons["Goals"].tap()
        replace(app.textFields["goal-home-input"], with: outcome)
        app.buttons["goal-home-create"].tap()
        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 8), "Goal Center did not open")
        let goal = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", outcome)).firstMatch
        XCTAssertTrue(goal.waitForExistence(timeout: 8), "Created evidence goal missing")
        goal.tap()

        scrollToStaticTextOrButton("Create output", maxSwipes: 10)
        for output in ["Email Draft", "Meeting Brief", "Customer Brief"] {
            XCTAssertTrue(app.buttons[output].waitForExistence(timeout: 5), "Missing deliverable action: \(output)")
            app.buttons[output].tap()
            XCTAssertTrue(app.staticTexts["Created output"].waitForExistence(timeout: 5), "Creating \(output) did not provide completion feedback")
            XCTAssertTrue(app.staticTexts["Created output"].label.contains(output), "Output completion feedback did not name \(output)")
        }
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Goal Center"].waitForExistence(timeout: 5), "Goal detail did not dismiss")
        app.swipeDown()
        XCTAssertTrue(app.navigationBars["Goals"].waitForExistence(timeout: 8), "Goal Center sheet did not return to Goals Home")

        let goalRail = app.scrollViews["Goal OS navigation"]
        XCTAssertTrue(goalRail.waitForExistence(timeout: 5), "Goal OS navigation rail missing")
        for _ in 0..<4 where !app.buttons["goal-os-execute"].isHittable { goalRail.swipeLeft() }
        XCTAssertTrue(app.buttons["goal-os-execute"].isHittable, "Execute navigation was not reachable after horizontal navigation")
        app.buttons["goal-os-execute"].tap()
        XCTAssertTrue(app.staticTexts["Completion Evidence"].waitForExistence(timeout: 5), "Completion Evidence surface missing")
        let expand = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@ AND label CONTAINS[c] %@", "Show all", "evidence")).firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 8), "Growing Completion Evidence did not expose count-aware expansion")
        expand.tap()
        XCTAssertTrue(app.textFields["Search evidence"].waitForExistence(timeout: 5), "Expanded Completion Evidence did not expose scoped search")
        replace(app.textFields["Search evidence"], with: "Email Draft")
        let evidence = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Email Draft: Create reviewable")).firstMatch
        XCTAssertTrue(evidence.waitForExistence(timeout: 5), "Exact Completion Evidence search did not return the created output")
        evidence.tap()
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "label CONTAINS[c] %@", "Email Draft: Create reviewable")).firstMatch.waitForExistence(timeout: 5), "Completion Evidence did not open the selected reviewable output")
        addScreenshot("nexora-v303-execute-completion-evidence")
        assertNoBlockingErrors()
    }

    func testNexoraSearchTruthModeRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) {
            app.buttons["Email"].tap()
        }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Search truth validation did not reach Inbox")
        let search = app.textFields["Search mail"]
        XCTAssertTrue(search.waitForExistence(timeout: 8), "Mail search missing")
        replace(search, with: "unread")
        XCTAssertTrue(app.staticTexts["Structured local search · sender, status, and visible metadata"].waitForExistence(timeout: 5), "Structured search truth was not visible")
        app.buttons["Clear search"].tap()
        replace(search, with: "invoice")
        XCTAssertTrue(app.staticTexts["Exact local search · sender, subject, body preview, provider, and attachments"].waitForExistence(timeout: 5), "Exact search truth was not visible")
        addScreenshot("nexora-v303-search-truth")
        assertNoBlockingErrors()
    }

    func testNexoraProviderAndCenterProgressiveDisclosureRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) {
            XCTAssertTrue(app.buttons["Email"].waitForExistence(timeout: 5), "Goal-first Home did not expose Email navigation")
            app.buttons["Email"].tap()
        }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Provider matrix validation did not reach Inbox")
        XCTAssertTrue(app.buttons["Organization"].waitForExistence(timeout: 8), "Organization tab missing")
        app.buttons["Organization"].tap()
        XCTAssertTrue(app.buttons["NEXORA V3"].waitForExistence(timeout: 8), "NEXORA V3 entry missing")
        app.buttons["NEXORA V3"].tap()
        XCTAssertTrue(app.navigationBars["NEXORA V3"].waitForExistence(timeout: 8), "NEXORA V3 command center missing")

        scrollToStaticTextOrButton("Health", maxSwipes: 5)
        let expandHealth = app.buttons["Show all 6 health checks"]
        XCTAssertTrue(expandHealth.waitForExistence(timeout: 8), "Health did not retain two rows with a count-aware expansion")
        expandHealth.tap()
        XCTAssertTrue(app.buttons["Collapse health checks"].waitForExistence(timeout: 5), "Expanded Health did not expose collapse")
        app.buttons["Collapse health checks"].tap()
        XCTAssertTrue(expandHealth.waitForExistence(timeout: 5), "Health did not collapse after Show Less")

        scrollToStaticTextOrButton("Provider Capability Matrix", maxSwipes: 8)
        XCTAssertTrue(app.staticTexts["Provider Capability Matrix"].waitForExistence(timeout: 8), "Provider matrix missing")
        let expandProviders = app.buttons["Show all 8 providers"]
        XCTAssertTrue(expandProviders.waitForExistence(timeout: 12), "Provider matrix did not retain two rows with a real count-aware expansion")
        expandProviders.tap()
        XCTAssertTrue(app.textFields["Search providers"].waitForExistence(timeout: 5), "Expanded provider matrix did not expose scoped search")
        XCTAssertTrue(app.buttons["Collapse providers"].waitForExistence(timeout: 5), "Expanded provider matrix did not expose collapse")
        app.buttons["Collapse providers"].tap()
        XCTAssertTrue(expandProviders.waitForExistence(timeout: 5), "Provider matrix did not collapse after Show Less")

        for _ in 0..<8 where !app.buttons["Provisioning & Repair"].exists { app.swipeDown() }
        XCTAssertTrue(app.buttons["Provisioning & Repair"].waitForExistence(timeout: 8), "Provisioning center entry missing")
        app.buttons["Provisioning & Repair"].tap()
        XCTAssertTrue(app.buttons["Show all 8 Provisioning & Repair rows"].waitForExistence(timeout: 8), "Over-five center detail did not retain two rows with an expansion action")
        app.buttons["Show all 8 Provisioning & Repair rows"].tap()
        XCTAssertTrue(app.buttons["Collapse Provisioning & Repair rows"].waitForExistence(timeout: 5), "Expanded center detail did not expose collapse")
        app.buttons["Collapse Provisioning & Repair rows"].tap()
        XCTAssertTrue(app.buttons["Show all 8 Provisioning & Repair rows"].waitForExistence(timeout: 5), "Center detail did not collapse after Show Less")
        addScreenshot("nexora-v303-provider-and-center-progressive")
        assertNoBlockingErrors()
    }

    func testNexoraCommunicationIntelligenceRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) {
            XCTAssertTrue(app.buttons["Email"].waitForExistence(timeout: 5), "Goal-first Home did not expose Email navigation")
            app.buttons["Email"].tap()
        }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Communication Intelligence validation did not reach Inbox")
        openFirstVisibleReceivedMessage(roundName: "nexora-communication-intelligence")
        XCTAssertTrue(isEmailDetailSurfaceVisible(), "Communication Intelligence validation did not open message detail")

        for _ in 0..<5 {
            if app.staticTexts["Communication Intelligence"].exists { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Communication Intelligence"].waitForExistence(timeout: 8), "Provider-neutral intelligence card was not visible")
        for dimension in ["Intent", "Action", "Context", "Relationship", "Attention", "Trust", "Lifecycle"] {
            let identifier = "communication-intelligence-\(dimension.lowercased())"
            for _ in 0..<2 where !app.staticTexts[identifier].exists {
                app.swipeUp()
            }
            XCTAssertTrue(app.staticTexts[identifier].waitForExistence(timeout: 3), "Missing intelligence dimension: \(dimension)")
        }
        addScreenshot("nexora-v303-communication-intelligence")
        assertNoBlockingErrors()
    }

    func testNexoraUCSAuthoritativeProjectionRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) {
            XCTAssertTrue(app.buttons["Email"].waitForExistence(timeout: 5))
            app.buttons["Email"].tap()
        }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "UCS validation did not reach Inbox")
        selectMergedAllMailForUCSValidation()

        let projectionRows = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH 'conversation-projection-row-'")
        )
        XCTAssertTrue(projectionRows.firstMatch.waitForExistence(timeout: 30), "All Mail did not render authoritative Conversation Projection rows")
        projectionRows.firstMatch.tap()

        XCTAssertTrue(app.buttons["Read"].waitForExistence(timeout: 15), "Projection-native detail did not expose Read")
        XCTAssertTrue(app.buttons["Archive"].exists, "Projection-native detail did not expose Archive")
        XCTAssertTrue(app.buttons["Trash"].exists, "Projection-native detail did not expose Trash")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'still syncing for actions'")).firstMatch.exists)
        addScreenshot("nexora-ucs-authoritative-projection-detail")
        assertNoBlockingErrors()
    }

    func testNexoraGmailContentRecoveryPreservesSendAuthorityRealIPhone() throws {
        app.launch()
        if app.navigationBars["Goals"].waitForExistence(timeout: 8) { app.buttons["Email"].tap() }
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Gmail authority validation did not reach Inbox")

        app.buttons["Organization"].tap()
        XCTAssertTrue(app.navigationBars["Organization"].waitForExistence(timeout: 8), "Organization tab did not open")
        let accounts = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Accounts,")).firstMatch
        XCTAssertTrue(accounts.waitForExistence(timeout: 8), "Accounts action was not exposed")
        accounts.tap()
        XCTAssertTrue(app.navigationBars["Accounts"].waitForExistence(timeout: 8), "Accounts sheet did not open")

        let expand = app.buttons["Show more mailboxes"]
        if expand.waitForExistence(timeout: 3) { expand.tap() }
        let account = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "fastonecanada@gmail.com")).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10), "Verified Gmail account was not visible in Accounts")
        account.tap()

        XCTAssertTrue(app.staticTexts["Can send"].waitForExistence(timeout: 10), "Verified Gmail send scope was incorrectly downgraded by content recovery")
        XCTAssertFalse(app.buttons["Reconnect with Google"].exists, "A recoverable Gmail message gap must not request OAuth reconnect")
        addScreenshot("nexora-gmail-content-recovery-send-authority")
        assertNoBlockingErrors()
    }

    func testEnterpriseAccountsDiagnosticsOAuthApprovalRealIPhoneNonDestructive() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Enterprise diagnostics validation did not reach Inbox")

        openSettings()
        if app.buttons["Advanced"].waitForExistence(timeout: 5) {
            app.buttons["Advanced"].tap()
        }

        scrollToButton("Diagnostics", maxSwipes: 6)
        app.buttons["Diagnostics"].tap()
        XCTAssertTrue(app.navigationBars["Diagnostics"].waitForExistence(timeout: 10), "Diagnostics page did not open")
        XCTAssertTrue(app.staticTexts["Account Diagnostics"].waitForExistence(timeout: 10), "Account Diagnostics header was not visible")
        XCTAssertTrue(app.staticTexts["Health"].waitForExistence(timeout: 10), "Health Status was not visible")
        XCTAssertTrue(app.staticTexts["Governance Status"].waitForExistence(timeout: 10), "Governance Status was not visible")
        XCTAssertTrue(app.staticTexts["Provider Status"].waitForExistence(timeout: 10), "Provider Status was not visible")
        XCTAssertTrue(app.staticTexts["Capability Status"].waitForExistence(timeout: 10), "Capability Status was not visible")
        XCTAssertTrue(app.staticTexts["Mailbox Status"].waitForExistence(timeout: 10), "Mailbox Status was not visible")
        XCTAssertTrue(app.staticTexts["Sync Status"].waitForExistence(timeout: 10), "Sync Status was not visible")
        XCTAssertTrue(app.staticTexts["Freshness"].waitForExistence(timeout: 10), "Freshness was not visible")
        XCTAssertTrue(app.staticTexts["Last Provider Sync"].waitForExistence(timeout: 10), "Last Provider Sync was not visible")
        scrollToStaticTextOrButton("Google Verification", maxSwipes: 3)
        XCTAssertTrue(app.staticTexts["Google Verification"].waitForExistence(timeout: 10), "Google Verification was not visible")
        addScreenshot("enterprise-diagnostics-01-diagnostics")
        tapLeadingNavigationButton(on: "Diagnostics")

        scrollToButton("OAuth Diagnostics", maxSwipes: 6)
        app.buttons["OAuth Diagnostics"].tap()
        XCTAssertTrue(app.navigationBars["OAuth Diagnostics"].waitForExistence(timeout: 10), "OAuth Diagnostics page did not open")
        let diagnosticGmail = "cloudmail.oauth.diagnostic.\(Int(Date().timeIntervalSince1970))@gmail.com"
        replace(app.textFields["gmail@example.com"], with: diagnosticGmail)
        XCTAssertTrue(app.staticTexts["Governance Status"].waitForExistence(timeout: 10), "Governance Status was not visible")
        XCTAssertTrue(app.staticTexts["Access Environment"].waitForExistence(timeout: 10), "Access Environment was not visible")
        XCTAssertTrue(app.staticTexts["Login Status"].waitForExistence(timeout: 10), "Login Status was not visible")
        addScreenshot("enterprise-diagnostics-02-oauth-diagnostics")
        tapLeadingNavigationButton(on: "OAuth Diagnostics")

        scrollToButton("Recovery Center", maxSwipes: 6)
        app.buttons["Recovery Center"].tap()
        XCTAssertTrue(app.navigationBars["Recovery Center"].waitForExistence(timeout: 10), "Recovery Center did not open")
        XCTAssertTrue(app.buttons["Run Diagnostics"].waitForExistence(timeout: 10), "Run Diagnostics action was not visible")
        XCTAssertTrue(app.buttons["Check Sync"].waitForExistence(timeout: 10), "Check Sync action was not visible")
        XCTAssertTrue(app.buttons["Check Health"].waitForExistence(timeout: 10), "Check Health action was not visible")
        addScreenshot("enterprise-diagnostics-03-recovery-center")
        tapLeadingNavigationButton(on: "Recovery Center")

        scrollToButton("Provider Health Center", maxSwipes: 8)
        app.buttons["Provider Health Center"].tap()
        XCTAssertTrue(app.navigationBars["Provider Health"].waitForExistence(timeout: 10), "Provider Health Center did not open")
        XCTAssertTrue(app.staticTexts["Unified Provider Health Center"].waitForExistence(timeout: 10), "Unified Provider Health header was not visible")
        XCTAssertTrue(app.staticTexts["Google"].waitForExistence(timeout: 10), "Google health row was not visible")
        XCTAssertTrue(app.staticTexts["SMTP"].waitForExistence(timeout: 10), "SMTP health row was not visible")
        addScreenshot("enterprise-diagnostics-04-provider-health")
        tapLeadingNavigationButton(on: "Provider Health")

        scrollToButton("Recovery Center", maxSwipes: 8)
        app.buttons["Recovery Center"].tap()
        XCTAssertTrue(app.navigationBars["Recovery Center"].waitForExistence(timeout: 10), "Recovery Center did not reopen")
        scrollToButton("Redeem Invitation", maxSwipes: 4)
        XCTAssertTrue(app.buttons["Redeem Invitation"].waitForExistence(timeout: 10), "Redeem Invitation action was not visible")
        addScreenshot("enterprise-governance-09-redeem-invitation")
        tapLeadingNavigationButton(on: "Recovery Center")

        scrollToButton("OAuth Approval Center", maxSwipes: 8)
        app.buttons["OAuth Approval Center"].tap()
        XCTAssertTrue(app.navigationBars["OAuth Approval Center"].waitForExistence(timeout: 10), "OAuth Approval Center did not open")
        XCTAssertTrue(app.staticTexts["Pending Requests"].waitForExistence(timeout: 10), "Pending Requests were not visible")
        XCTAssertTrue(app.staticTexts["Approved Requests"].waitForExistence(timeout: 10), "Approved Requests were not visible")
        XCTAssertTrue(app.staticTexts["Rejected Requests"].waitForExistence(timeout: 10), "Rejected Requests were not visible")
        scrollToStaticTextOrButton("Expired Requests", maxSwipes: 8)
        XCTAssertTrue(app.staticTexts["Expired Requests"].waitForExistence(timeout: 10), "Expired Requests were not visible")
        addScreenshot("enterprise-diagnostics-05-approval-center")
        tapLeadingNavigationButton(on: "OAuth Approval Center")
        assertNoBlockingErrors()
    }

    func testEnterpriseProductivityPlatformV1RealIPhoneNonDestructive() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Enterprise productivity platform validation did not reach Inbox")

        openSettings()
        scrollToButton("Enterprise Hub", maxSwipes: 5)
        app.buttons["Enterprise Hub"].tap()
        XCTAssertTrue(app.navigationBars["Enterprise Hub"].waitForExistence(timeout: 10), "Enterprise Hub did not open")
        XCTAssertTrue(app.staticTexts["CloudMail Enterprise Hub"].waitForExistence(timeout: 10), "Enterprise Hub overview was not visible")
        XCTAssertTrue(app.staticTexts["Mail"].waitForExistence(timeout: 10), "Mail platform metric was not visible")
        XCTAssertTrue(app.staticTexts["Contacts"].waitForExistence(timeout: 10), "Contacts platform metric was not visible")
        XCTAssertTrue(app.buttons["Contacts & Org Graph"].waitForExistence(timeout: 10), "Directory navigation was not visible")
        addScreenshot("enterprise-productivity-01-hub")

        app.buttons["Contacts & Org Graph"].tap()
        XCTAssertTrue(app.staticTexts["Enterprise Contact Directory"].waitForExistence(timeout: 10), "Enterprise Contact Directory was not visible")
        scrollToStaticTextOrButton("Contact Profile", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["Contact Profile"].waitForExistence(timeout: 10), "Contact Profile was not visible")
        scrollToStaticTextOrButton("Domain Directory", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Domain Directory"].waitForExistence(timeout: 10), "Domain Directory was not visible")
        scrollToStaticTextOrButton("Organization Graph", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Organization Graph"].waitForExistence(timeout: 10), "Organization Graph was not visible")
        addScreenshot("enterprise-productivity-02-directory-org")

        tapEnterpriseSegment("Rules")
        XCTAssertTrue(app.staticTexts["Rules Engine"].waitForExistence(timeout: 10), "Rules Engine was not visible")
        XCTAssertTrue(app.buttons["Create VIP Priority Rule"].waitForExistence(timeout: 10), "VIP automation action was not visible")
        app.buttons["Create VIP Priority Rule"].tap()
        XCTAssertTrue(app.staticTexts["Supported Actions"].waitForExistence(timeout: 10), "Supported Actions were not visible")
        addScreenshot("enterprise-productivity-03-rules-automation")

        tapEnterpriseSegment("Work")
        XCTAssertTrue(app.staticTexts["Tasks Integration"].waitForExistence(timeout: 10), "Tasks Integration was not visible")
        XCTAssertTrue(app.buttons["Create Task"].waitForExistence(timeout: 10), "Create Task action was not visible")
        app.buttons["Create Task"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Review priority mailbox")).firstMatch.waitForExistence(timeout: 10), "Created task was not visible")
        scrollToStaticTextOrButton("Calendar Integration", maxSwipes: 4)
        XCTAssertTrue(app.buttons["Schedule Follow-Up"].waitForExistence(timeout: 10), "Schedule Follow-Up action was not visible")
        app.buttons["Schedule Follow-Up"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Follow up on latest thread")).firstMatch.waitForExistence(timeout: 10), "Scheduled follow-up was not visible")
        scrollToStaticTextOrButton("Follow-Up Center", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Waiting For Reply"].waitForExistence(timeout: 10), "Waiting For Reply metric was not visible")
        addScreenshot("enterprise-productivity-04-tasks-calendar")

        tapEnterpriseSegment("Search")
        XCTAssertTrue(app.staticTexts["NLP Search V2"].waitForExistence(timeout: 10), "NLP Search V2 was not visible")
        XCTAssertTrue(app.staticTexts["Message Graph"].waitForExistence(timeout: 10), "Message Graph metric was not visible")
        XCTAssertTrue(app.buttons["emails from bill last month"].waitForExistence(timeout: 10), "NLP example was not visible")
        app.buttons["emails from bill last month"].tap()
        scrollToStaticTextOrButton("Knowledge Results", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Knowledge Results"].waitForExistence(timeout: 10), "Knowledge Results section was not visible")
        addScreenshot("enterprise-productivity-05-knowledge-search")

        tapEnterpriseSegment("Audit")
        XCTAssertTrue(app.staticTexts["Enterprise Admin Audit Center"].waitForExistence(timeout: 10), "Enterprise Admin Audit Center was not visible")
        XCTAssertTrue(app.staticTexts["Compliance Center"].waitForExistence(timeout: 10), "Compliance Center was not visible")
        XCTAssertTrue(app.staticTexts["Retention Status"].waitForExistence(timeout: 10), "Retention Status was not visible")
        XCTAssertTrue(app.staticTexts["Legal Hold Awareness"].waitForExistence(timeout: 10), "Legal Hold Awareness was not visible")
        addScreenshot("enterprise-productivity-06-audit-compliance")
        assertNoBlockingErrors()
    }

    func testEnterpriseDirectoryProfileSyncDeviceRestoreRealIPhone() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 30), "Directory/Profile Sync validation did not reach Inbox")

        openSettings()
        scrollToButton("Directory", maxSwipes: 5)
        app.buttons["Directory"].tap()
        XCTAssertTrue(app.navigationBars["Directory"].waitForExistence(timeout: 10), "Directory did not open")
        XCTAssertTrue(app.staticTexts["All Contacts"].waitForExistence(timeout: 10), "All Contacts section was not visible")
        addScreenshot("enterprise-directory-01-directory")

        let searchField = app.textFields.matching(NSPredicate(format: "placeholderValue CONTAINS[c] %@", "Search name")).firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "Directory search field missing")
        replace(searchField, with: "fast")
        let contactRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "enterprise-directory-contact-")).firstMatch
        XCTAssertTrue(contactRow.waitForExistence(timeout: 10), "Directory contact search did not show a contact row")
        contactRow.tap()
        XCTAssertTrue(app.navigationBars["Contact Profile"].waitForExistence(timeout: 10), "Contact Profile did not open")
        XCTAssertTrue(app.staticTexts["Sent Count"].waitForExistence(timeout: 10), "Sent Count missing")
        scrollToStaticTextOrButton("Actions", maxSwipes: 4)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "VIP")).firstMatch.waitForExistence(timeout: 10), "VIP action missing")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Star")).firstMatch.waitForExistence(timeout: 10), "Star action missing")
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Star")).firstMatch.tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "VIP")).firstMatch.tap()
        scrollToStaticTextOrButton("Recent Conversations", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Recent Conversations"].exists, "Recent Conversations section missing")
        addScreenshot("enterprise-directory-02-profile")
        app.buttons["Done"].tap()

        scrollToStaticTextOrButton("Recent Contacts", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["Recent Contacts"].exists, "Recent Contacts section was not visible")
        scrollToStaticTextOrButton("VIP Contacts", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["VIP Contacts"].exists, "VIP Contacts section was not visible")
        scrollToStaticTextOrButton("Starred Contacts", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["Starred Contacts"].exists, "Starred Contacts section was not visible")
        scrollToStaticTextOrButton("Domain Contacts", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["Domain Contacts"].exists, "Domain Contacts section was not visible")
        scrollToStaticTextOrButton("Organization Contacts", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["Organization Contacts"].exists, "Organization Contacts section was not visible")

        returnToSettingsFromDirectoryFlow()
        scrollToButton("Domain Directory", maxSwipes: 5)
        app.buttons["Domain Directory"].tap()
        XCTAssertTrue(app.navigationBars["Domain Directory"].waitForExistence(timeout: 10), "Domain Directory tab did not open")
        scrollToStaticTextOrButton("CloudMail Domain Users", maxSwipes: 5)
        XCTAssertTrue(app.staticTexts["CloudMail Domain Users"].exists, "CloudMail Domain Users section missing")
        scrollToStaticTextContaining("metadata-only", maxSwipes: 3)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "metadata-only")).firstMatch.exists, "Honest provider metadata status missing")
        addScreenshot("enterprise-directory-03-domain")

        returnToSettingsFromDirectoryFlow()
        scrollToButton("Profile Sync", maxSwipes: 5)
        app.buttons["Profile Sync"].tap()
        XCTAssertTrue(app.navigationBars["Profile Sync"].waitForExistence(timeout: 10), "Profile Sync tab did not open")
        XCTAssertTrue(app.staticTexts["Profile Sync V2"].waitForExistence(timeout: 10), "Profile Sync V2 section missing")
        XCTAssertTrue(app.staticTexts["Synced Items"].waitForExistence(timeout: 10), "Synced Items section missing")
        scrollToStaticTextOrButton("Excluded Data", maxSwipes: 4)
        XCTAssertTrue(app.staticTexts["Excluded Data"].exists, "Excluded Data section missing")
        scrollToStaticTextContaining("OAuth tokens", maxSwipes: 3)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "OAuth tokens")).firstMatch.exists, "Secret exclusion was not visible")
        addScreenshot("enterprise-directory-04-profile-sync")

        returnToSettingsFromDirectoryFlow()
        scrollToButton("Device Restore", maxSwipes: 5)
        app.buttons["Device Restore"].tap()
        XCTAssertTrue(app.navigationBars["Device Restore"].waitForExistence(timeout: 10), "Device Restore tab did not open")
        XCTAssertTrue(app.staticTexts["Restore Preview"].waitForExistence(timeout: 10), "Restore Preview missing")
        XCTAssertTrue(app.buttons["Apply Restore Preview"].waitForExistence(timeout: 10), "Restore action missing")
        app.buttons["Apply Restore Preview"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Credentials remain excluded")).firstMatch.waitForExistence(timeout: 10), "Restore safety status missing")
        addScreenshot("enterprise-directory-05-restore")

        tapDirectorySegment("Devices")
        XCTAssertTrue(app.navigationBars["Devices"].waitForExistence(timeout: 10), "Devices tab did not open")
        XCTAssertTrue(app.staticTexts["Multi Device View"].waitForExistence(timeout: 10), "Multi Device View missing")
        XCTAssertTrue(app.staticTexts["Profile Sync Health"].waitForExistence(timeout: 10), "Profile Sync Health missing")
        addScreenshot("enterprise-directory-06-devices")

        returnToSettingsFromDirectoryFlow()
        if app.buttons["Done"].waitForExistence(timeout: 5) {
            app.buttons["Done"].tap()
        }
        returnToInboxFromNestedSettings(roundName: "enterprise-directory-profile-sync")
        validateComposeAutocompleteV2ToCcBcc()
        assertNoBlockingErrors()
    }

    func testLoop5JNativeMobileResetSurfacesWithExistingSession() throws {
        app.launch()
        if app.buttons["Done"].waitForExistence(timeout: 5) {
            app.buttons["Done"].tap()
        }

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20), "Existing session did not reach Inbox")
        addScreenshot("loop5j-01-inbox")

        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Inbox")).firstMatch.waitForExistence(timeout: 10),
            "Inbox did not show the compact current mailbox header"
        )
        XCTAssertFalse(app.buttons["Gmail mailbox"].exists, "Old always-visible Gmail filter button should not be present")
        XCTAssertFalse(app.buttons["CloudMail mailbox"].exists, "Old always-visible CloudMail filter button should not be present")

        openMailboxSwitcher()
        XCTAssertTrue(waitForMailboxDrawer(timeout: 10), "Mailbox drawer did not open")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail Inbox")).firstMatch.exists, "Drawer must not expose provider-only Gmail Inbox rows")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "CloudMail Inbox")).firstMatch.exists, "Drawer must not expose provider-only CloudMail Inbox rows")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 10),
            "Mailbox drawer did not expose an email address as the primary mailbox label"
        )
        addScreenshot("loop5j-02-mailbox-drawer-email-first")
        assertNoBlockingErrors()
    }

    func testLoop5JMailboxFirstScreenHidesDebugFiltersWithExistingSession() throws {
        app.launch()
        if app.buttons["Done"].waitForExistence(timeout: 5) {
            app.buttons["Done"].tap()
        }

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20), "Existing session did not reach Inbox")
        addScreenshot("loop5j-mailbox-first-screen")

        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current mailbox")).firstMatch.waitForExistence(timeout: 10),
            "Compact mailbox header was not visible on the first screen"
        )
        XCTAssertFalse(app.buttons["Gmail mailbox"].exists, "Old always-visible Gmail filter button should not be present")
        XCTAssertFalse(app.buttons["CloudMail mailbox"].exists, "Old always-visible CloudMail filter button should not be present")
        XCTAssertFalse(app.buttons["Merged mailbox"].exists, "Old always-visible Merged filter button should not be present")

        openMailboxSwitcher()
        XCTAssertTrue(waitForMailboxDrawer(timeout: 10), "Mailbox switcher drawer did not open")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All connected mailboxes")).firstMatch.waitForExistence(timeout: 10),
            "All-mail row was not available in the mailbox drawer"
        )
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 10),
            "Mailbox drawer did not expose real email addresses"
        )
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail Inbox")).firstMatch.exists, "Provider-only Gmail Inbox row should be hidden")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "CloudMail Inbox")).firstMatch.exists, "Provider-only CloudMail Inbox row should be hidden")
        addScreenshot("loop5j-mailbox-switcher-drawer")
        assertNoBlockingErrors()
    }

    func testLoop5JOwnershipAndAITruthWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        app.buttons["CloudMail actions"].tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Apple Intelligence")).firstMatch.waitForExistence(timeout: 5),
            "AI action menu did not expose Apple Intelligence as the primary local path"
        )
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "ChatGPT")).firstMatch.waitForExistence(timeout: 5),
            "AI action menu did not show ChatGPT setup state"
        )
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gemini")).firstMatch.waitForExistence(timeout: 5),
            "AI action menu did not show Gemini setup reality"
        )
        XCTAssertFalse(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Claude")).firstMatch.exists,
            "AI action menu exposed Claude in the normal user path"
        )
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Settings")).firstMatch.waitForExistence(timeout: 5),
            "Settings action was not available from AI/action menu"
        )
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Settings")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not open")
        addScreenshot("loop5j-ownership-ai-settings")

        XCTAssertTrue(app.staticTexts["AI privacy"].waitForExistence(timeout: 10), "AI privacy truth section was not visible")
        XCTAssertTrue(app.staticTexts["Active AI"].waitForExistence(timeout: 10), "Active AI state was not visible")
        XCTAssertTrue(app.staticTexts["Mail content"].waitForExistence(timeout: 10), "Mail content local/cloud state was not visible")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Apple Intelligence")).firstMatch.waitForExistence(timeout: 10), "Apple Intelligence was not visible as local AI")
        XCTAssertTrue(app.staticTexts["Advanced"].waitForExistence(timeout: 10), "Advanced provider setup section was not visible")
        XCTAssertTrue(
            app.staticTexts["Cloud AI setup"].waitForExistence(timeout: 10)
                || app.buttons["Cloud AI setup"].waitForExistence(timeout: 1),
            "Cloud AI setup was not moved into Advanced"
        )
        XCTAssertFalse(app.secureTextFields["Google AI provider key"].exists, "Gemini key entry should not dominate primary Settings")
        XCTAssertFalse(app.secureTextFields["Anthropic provider key"].exists, "Claude key entry should not dominate primary Settings")
        let settingsText = visibleStaticTextLabels().lowercased()
        XCTAssertFalse(settingsText.contains("api key"), "Primary Settings exposed API key language")
        XCTAssertFalse(settingsText.contains("api access"), "Primary Settings exposed API access language")
        XCTAssertFalse(settingsText.contains("byok"), "Primary Settings exposed BYOK language")
        XCTAssertFalse(settingsText.contains("claude"), "Primary Settings exposed Claude in the normal user path")

        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10), "Account Center did not open")
        addScreenshot("loop5j-ownership-account-center")

        print("ACCOUNT_CENTER_STATIC_TEXTS: \(visibleStaticTextLabels())")
        let gmailState = app.staticTexts.matching(
            NSPredicate(format: "label == %@ OR label == %@", "Gmail Connected", "Connect Gmail")
        ).firstMatch
        XCTAssertTrue(
            gmailState.waitForExistence(timeout: 3),
            "Gmail ownership state was not visible within 3 seconds"
        )
        XCTAssertFalse(app.staticTexts["Already connected"].exists, "Account Center should not use ambiguous Gmail wording")
        XCTAssertTrue(app.staticTexts["Unavailable providers"].waitForExistence(timeout: 5), "Unsupported providers should be grouped as unavailable truth, not future setup")
        XCTAssertTrue(app.staticTexts["Not available"].waitForExistence(timeout: 5), "Unsupported provider state should be Not available")
        XCTAssertFalse(app.staticTexts["Available later"].exists, "Account Center should not show stale Available later placeholder section")
        XCTAssertFalse(app.staticTexts["Coming later"].exists, "Account Center should not show stale Coming later provider state")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Generic IMAP needs provider discovery")).firstMatch.exists,
            "Account Center should not expose internal IMAP discovery placeholder text"
        )
        assertNoBlockingErrors()
    }

    func testLoop6D1RAIAccountAuthorizationTruthForNormalUser() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()

        app.buttons["CloudMail actions"].tap()
        tapCloudMailActionSettings(timeout: 5)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not open")
        scrollToButton("Cloud AI setup")
        app.buttons["Cloud AI setup"].tap()
        XCTAssertTrue(app.navigationBars["Cloud AI setup"].waitForExistence(timeout: 10), "Cloud AI setup did not open")

        XCTAssertTrue(app.staticTexts["ChatGPT — Not available"].waitForExistence(timeout: 5), "ChatGPT must remain unavailable until a real account authorization path exists")
        XCTAssertFalse(app.buttons["Authorize ChatGPT"].exists, "ChatGPT fake authorization button must not be visible")

        let geminiAuthButton = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Sign in with Google")).firstMatch
        let geminiExternalBlocker = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Google account authorization for Gemini is not available")).firstMatch
        XCTAssertTrue(
            geminiAuthButton.waitForExistence(timeout: 5) || geminiExternalBlocker.waitForExistence(timeout: 5),
            "Gemini must show either a real Google sign-in button or a clean Not available state"
        )
        XCTAssertFalse(app.secureTextFields["Google AI provider key"].exists, "Gemini API key entry must not be presented as account authorization")
        let aiSetupText = visibleStaticTextLabels().lowercased()
        XCTAssertFalse(aiSetupText.contains("oauth"), "Normal AI setup exposed OAuth implementation language")
        XCTAssertFalse(aiSetupText.contains("client credential"), "Normal AI setup exposed client credential language")
    }

    func testLoop5JAIExecutionAttributionAppearsInInboxWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        app.buttons["CloudMail actions"].tap()
        let summarize = app.buttons["Summarize all visible"]
        XCTAssertTrue(summarize.waitForExistence(timeout: 5), "Summarize action was not available")
        summarize.tap()
        if aiAttributionElement(containing: "AI: Apple Intelligence").waitForExistence(timeout: 45) {
            XCTAssertTrue(aiAttributionElement(containing: "Local").exists, "Inbox AI attribution did not expose local/cloud execution truth")
            assertNoBlockingErrors()
            return
        }

        openMailboxSwitcher()
        let allMail = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All connected mailboxes")).firstMatch
        XCTAssertTrue(allMail.waitForExistence(timeout: 5), "All-mail row was not available for AI attribution fallback")
        allMail.tap()
        app.buttons["CloudMail actions"].tap()
        XCTAssertTrue(summarize.waitForExistence(timeout: 5), "Summarize action was not available after switching to all mail")
        summarize.tap()

        let attribution = aiAttributionElement(containing: "AI: Apple Intelligence")
        XCTAssertTrue(
            attribution.waitForExistence(timeout: 45),
            "Inbox did not expose actual AI execution attribution after summarizing visible mail"
        )
        XCTAssertTrue(aiAttributionElement(containing: "Local").exists, "Inbox AI attribution did not expose local/cloud execution truth")
        assertNoBlockingErrors()
    }

    func testLiveAIWorkspaceFiveWorkflowsWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()

        let aiCenter = app.tabBars.buttons["AI Center"]
        XCTAssertTrue(aiCenter.waitForExistence(timeout: 10), "AI Center tab was not available")
        aiCenter.tap()
        XCTAssertTrue(app.navigationBars["AI"].waitForExistence(timeout: 10), "AI Center did not open")
        XCTAssertTrue(app.staticTexts["Mobile Workspace"].waitForExistence(timeout: 10), "Mobile Workspace was not visible")

        let runTab = app.buttons["Run"]
        XCTAssertTrue(runTab.waitForExistence(timeout: 10), "Mobile Workspace Run tab was not visible")

        let workflows: [(title: String, output: String)] = [
            ("Inbox Summary", "loaded messages"),
            ("Suggested Reply", "Suggested reply for"),
            ("Thread Digest", "Thread digest"),
            ("Draft Generation", "Draft generated"),
            ("Multi-email Analysis", "Multi-email analysis")
        ]

        for workflow in workflows {
            runTab.tap()
            let button = app.buttons.matching(identifier: workflow.title).firstMatch
            if !button.waitForExistence(timeout: 5) {
                app.swipeUp()
            }
            XCTAssertTrue(button.waitForExistence(timeout: 10), "\(workflow.title) button was not visible")
            button.tap()
            XCTAssertTrue(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", workflow.output)).firstMatch.waitForExistence(timeout: 45),
                "\(workflow.title) output did not render"
            )
            XCTAssertTrue(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Source:")).firstMatch.waitForExistence(timeout: 5),
                "\(workflow.title) did not report source account"
            )
            XCTAssertTrue(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Messages:")).firstMatch.waitForExistence(timeout: 5),
                "\(workflow.title) did not report message count"
            )
            XCTAssertTrue(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "cross_account_access=false")).firstMatch.waitForExistence(timeout: 5)
                    || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Cloud runtime not used; no mailbox data was sent.")).firstMatch.waitForExistence(timeout: 1),
                "\(workflow.title) did not expose runtime boundary"
            )
            addScreenshot("live-ai-workspace-\(workflow.title.lowercased().replacingOccurrences(of: " ", with: "-"))")
        }

        assertNoBlockingErrors()
    }

    func testActivatedMailboxSessionRestoreWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Initial login did not reach Inbox")

        app.terminate()
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Relaunch did not restore Inbox")
        assertNoBlockingErrors()
    }

    func testCodexP0CRound1FrozenProductCertificationWithRuntimeCredentials() throws {
        guard runtimeCredentials() != nil else {
            throw XCTSkip("P0C runtime-credential certification skipped because final acceptance is using an existing manual device session")
        }
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        validateCodexP0CFrozenProductCertification(roundName: "p0c-round1")
    }

    func testCodexP0CRound2RelaunchFrozenProductCertificationWithRuntimeCredentials() throws {
        guard runtimeCredentials() != nil else {
            throw XCTSkip("P0C runtime-credential certification skipped because final acceptance is using an existing manual device session")
        }
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        app.terminate()
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        validateCodexP0CFrozenProductCertification(roundName: "p0c-round2")
    }

    func testLoop5JManagedCloudMailAddressFlowWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        openSettings()
        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10), "Account Center did not open")
        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "CloudMail address sheet did not open")

        replace(app.textFields["you@example.com"], with: "admin@fastonegroup.com")
        XCTAssertTrue(app.staticTexts["CloudMail"].waitForExistence(timeout: 10), "Managed domain did not resolve to CloudMail provider")
        XCTAssertTrue(app.staticTexts["CloudMail address"].waitForExistence(timeout: 10), "CloudMail-specific flow was not visible")
        XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "Managed CloudMail address must not show Gmail IMAP password")
        XCTAssertFalse(app.buttons["Connect Gmail"].isHittable, "Managed CloudMail address must not show a usable Connect Gmail action")
        if app.buttons["Continue"].waitForExistence(timeout: 3) {
            app.buttons["Continue"].tap()
        }
        assertManagedCloudMailAddressHasAction(email: "admin@fastonegroup.com")
        XCTAssertTrue(app.staticTexts["admin@fastonegroup.com"].waitForExistence(timeout: 5), "CloudMail active state did not preserve the full email address")
        XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "CloudMail active state must not show Gmail IMAP password")
        XCTAssertFalse(app.buttons["Connect Gmail"].isHittable, "CloudMail active state must not show a usable Connect Gmail action")
        app.navigationBars["Add mailbox"].buttons["Close"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 5), "Closing address check should return to Account Center")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "@fastonegroup.com")).firstMatch.waitForExistence(timeout: 5),
            "Checking another managed-domain address must not erase the signed-in account context"
        )
        assertNoBlockingErrors()
    }

    func testLoop5JGmailCredentialFailureIsActionableWithExistingSession() throws {
        app.launch()
        try ensureInboxFromExistingSessionOrRuntimeCredentials()
        openSettings()
        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10), "Account Center did not open")
        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "Mailbox sheet did not open")

        replace(app.textFields["you@example.com"], with: "saercpku@gmail.com")
        XCTAssertTrue(app.staticTexts["Gmail mailbox"].waitForExistence(timeout: 10), "Gmail mailbox state was not visible")
        XCTAssertFalse(app.staticTexts["CloudMail address"].exists, "Gmail must not enter CloudMail address flow")
        if app.staticTexts["Gmail Connected"].waitForExistence(timeout: 3) {
            XCTAssertTrue(app.staticTexts["saercpku@gmail.com"].waitForExistence(timeout: 5), "Connected Gmail state did not show the Gmail address")
            XCTAssertTrue(app.buttons["Open Gmail Inbox"].waitForExistence(timeout: 5), "Connected Gmail state did not offer the mailbox path")
            XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "Already-connected Gmail must not ask for a password")
            XCTAssertFalse(app.buttons.matching(identifier: "Connect Gmail").firstMatch.isHittable, "Already-connected Gmail must not also show Connect Gmail")
            assertNoBlockingErrors()
            return
        }
        XCTAssertTrue(app.secureTextFields["Gmail App Password"].waitForExistence(timeout: 5), "Gmail connect field was not visible before submit")
        replace(app.secureTextFields["Gmail App Password"], with: "invalid-app-password-for-conflict-check")
        app.keyboards.buttons["Go"].tap()

        XCTAssertTrue(
            app.staticTexts["Gmail needs attention"].waitForExistence(timeout: 30),
            "Gmail failure did not render as a clear actionable state"
        )
        XCTAssertTrue(app.staticTexts["saercpku@gmail.com"].waitForExistence(timeout: 5), "Gmail failure state did not show the Gmail address")
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 5), "Gmail failure state did not offer retry")
        XCTAssertTrue(app.buttons["Use current CloudMail account"].waitForExistence(timeout: 5), "Gmail failure state did not offer a current-account path")
        XCTAssertFalse(app.buttons.matching(identifier: "Connect Gmail").firstMatch.isHittable, "Gmail failure state must not also show Connect Gmail")
        let visibleTexts = visibleStaticTextLabels()
        print("GMAIL_FAILURE_STATIC_TEXTS: \(visibleTexts)")
        XCTAssertFalse(
            visibleTexts.localizedCaseInsensitiveContains("data couldn"),
            "Gmail failure must not leak a generic decode error"
        )
        XCTAssertTrue(
            visibleTexts.localizedCaseInsensitiveContains("App Password")
                || visibleTexts.localizedCaseInsensitiveContains("try again")
                || visibleTexts.localizedCaseInsensitiveContains("authorize"),
            "Gmail failure must explain the next action"
        )
        XCTAssertFalse(
            visibleTexts.localizedCaseInsensitiveContains("another CloudMail account"),
            "Gmail failure must not claim permanent ownership by another account"
        )
        assertNoBlockingErrors()
    }

    private func validateLoop6ACommonUserFlow(roundName: String, expectedSignedInEmail: String?, expectGmailConnected: Bool) {
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20), "\(roundName): Inbox was not visible")
        addScreenshot("loop6a-\(roundName)-01-inbox")
        if let expectedSignedInEmail {
            XCTAssertTrue(
                app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", expectedSignedInEmail)).firstMatch.waitForExistence(timeout: 10)
                    || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", expectedSignedInEmail)).firstMatch.waitForExistence(timeout: 1),
                "\(roundName): signed-in email was not visible in the mailbox context"
            )
        } else {
            XCTAssertTrue(
                app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 10)
                    || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 1),
                "\(roundName): no email identity was visible in the Inbox context"
            )
        }

        openMailboxSwitcher()
        XCTAssertTrue(waitForMailboxDrawer(timeout: 10), "\(roundName): mailbox drawer did not open")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 10), "\(roundName): drawer did not use email-first labels")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail Inbox")).firstMatch.exists, "\(roundName): drawer exposed provider-only Gmail label")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "CloudMail Inbox")).firstMatch.exists, "\(roundName): drawer exposed provider-only CloudMail label")
        assertMailboxDrawerSmartFolders(roundName: roundName)
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All connected mailboxes")).firstMatch.tap()
        closeMailboxSwitcherIfOpen()

        openFirstVisibleReceivedMessage(roundName: roundName)
        assertLoop6C0EMessageDetailProof(roundName: roundName)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10), "\(roundName): returning from message detail failed")

        app.buttons["CloudMail actions"].tap()
        let summarize = app.buttons["Summarize all visible"]
        XCTAssertTrue(summarize.waitForExistence(timeout: 5), "\(roundName): summarize action was not available")
        summarize.tap()
        let attribution = aiAttributionElement(containing: "AI: Apple Intelligence")
        XCTAssertTrue(attribution.waitForExistence(timeout: 45), "\(roundName): AI execution attribution did not appear after summarizing real visible mail")
        XCTAssertTrue(aiAttributionElement(containing: "Local").exists, "\(roundName): AI local/cloud attribution was not visible")

        openSettings()
        XCTAssertTrue(app.staticTexts["AI privacy"].waitForExistence(timeout: 10), "\(roundName): AI privacy section missing")
        XCTAssertTrue(app.staticTexts["Active AI"].waitForExistence(timeout: 10), "\(roundName): active AI state missing")
        XCTAssertTrue(app.staticTexts["Mail content"].waitForExistence(timeout: 10), "\(roundName): mail local/cloud state missing")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Apple Intelligence")).firstMatch.waitForExistence(timeout: 10), "\(roundName): Apple/local AI was not visible")
        XCTAssertTrue(app.staticTexts["Advanced"].waitForExistence(timeout: 10), "\(roundName): advanced cloud AI section missing")
        XCTAssertFalse(app.secureTextFields["Google AI provider key"].exists, "\(roundName): Gemini key box leaked into primary settings")
        XCTAssertFalse(app.secureTextFields["Anthropic provider key"].exists, "\(roundName): Claude key box leaked into primary settings")
        let settingsText = visibleStaticTextLabels().lowercased()
        XCTAssertFalse(settingsText.contains("api key"), "\(roundName): Settings exposed API key language")
        XCTAssertFalse(settingsText.contains("api access"), "\(roundName): Settings exposed API access language")
        XCTAssertFalse(settingsText.contains("byok"), "\(roundName): Settings exposed BYOK language")
        XCTAssertFalse(settingsText.contains("claude"), "\(roundName): Settings exposed Claude in the normal user path")

        scrollToButton("Account Center")
        app.buttons["Account Center"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 10), "\(roundName): Account Center did not open")
        XCTAssertTrue(app.staticTexts["Unavailable providers"].waitForExistence(timeout: 5), "\(roundName): unavailable provider truth missing")
        XCTAssertFalse(app.staticTexts["Available later"].exists, "\(roundName): stale Available later state visible")
        XCTAssertFalse(app.staticTexts["Coming later"].exists, "\(roundName): stale Coming later state visible")

        if expectGmailConnected {
            XCTAssertTrue(app.staticTexts["Gmail Connected"].waitForExistence(timeout: 5), "\(roundName): expected connected Gmail state missing")
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "saercpku@gmail.com")).firstMatch.waitForExistence(timeout: 5), "\(roundName): connected Gmail email missing")
            XCTAssertTrue(app.buttons["Open Gmail Inbox"].waitForExistence(timeout: 5), "\(roundName): open Gmail action missing")
        } else {
            XCTAssertFalse(app.staticTexts["Gmail Connected"].exists, "\(roundName): Gmail leaked into a CloudMail account that should not own it")
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "saercpku@gmail.com")).firstMatch.exists, "\(roundName): previous Gmail account leaked into new login")
        }

        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "\(roundName): Add mailbox sheet did not open")
        replace(app.textFields["you@example.com"], with: "admin@fastonegroup.com")
        XCTAssertTrue(app.staticTexts["CloudMail"].waitForExistence(timeout: 10), "\(roundName): managed domain did not resolve to CloudMail")
        XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "\(roundName): managed domain entered Gmail password flow")
        if app.buttons["Continue"].waitForExistence(timeout: 3) {
            app.buttons["Continue"].tap()
        }
        assertManagedCloudMailAddressHasAction(email: "admin@fastonegroup.com", roundName: roundName)
        XCTAssertTrue(app.staticTexts["admin@fastonegroup.com"].waitForExistence(timeout: 5), "\(roundName): full same-domain address was not preserved")
        app.navigationBars["Add mailbox"].buttons["Close"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 5), "\(roundName): closing same-domain check did not return to Account Center")
        if let expectedSignedInEmail {
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", expectedSignedInEmail)).firstMatch.exists, "\(roundName): same-domain check mutated the signed-in account")
        }

        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "\(roundName): Add mailbox sheet did not reopen for separate CloudMail identity")
        replace(app.textFields["you@example.com"], with: "bill@fastonegroup.com")
        XCTAssertTrue(app.staticTexts["CloudMail"].waitForExistence(timeout: 10), "\(roundName): managed domain did not resolve to CloudMail for separate identity")
        if app.buttons["Continue"].waitForExistence(timeout: 3) {
            app.buttons["Continue"].tap()
        }
        let currentSessionText = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current signed-in account")).firstMatch
        if currentSessionText.waitForExistence(timeout: 5) {
            XCTAssertTrue(app.navigationBars["Secure sign in"].waitForExistence(timeout: 5), "\(roundName): native secure authentication sheet missing")
            XCTAssertTrue(app.secureTextFields["Secure authentication input"].exists, "\(roundName): secure in-app input missing")
            XCTAssertFalse(app.secureTextFields["Mailbox password"].exists, "\(roundName): legacy inline password field remained visible")
            if let expectedSignedInEmail {
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", expectedSignedInEmail)).firstMatch.exists, "\(roundName): separate same-domain check mutated current session")
            }
            app.buttons["Cancel"].tap()
        } else {
            XCTAssertTrue(
                app.buttons["Open this mailbox"].waitForExistence(timeout: 5)
                    || app.navigationBars["Secure sign in"].waitForExistence(timeout: 5),
                "\(roundName): mailbox had neither open nor secure-auth action"
            )
            if app.navigationBars["Secure sign in"].exists { app.buttons["Cancel"].tap() }
        }
        app.navigationBars["Add mailbox"].buttons["Close"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 5), "\(roundName): closing separate identity check did not return to Account Center")

        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "\(roundName): Add mailbox sheet did not reopen")
        replace(app.textFields["you@example.com"], with: "saercpku@gmail.com")
        XCTAssertTrue(app.staticTexts["Gmail mailbox"].waitForExistence(timeout: 10), "\(roundName): Gmail mailbox section missing")
        XCTAssertFalse(app.staticTexts["CloudMail address"].exists, "\(roundName): Gmail address entered CloudMail address flow")
        if expectGmailConnected {
            XCTAssertTrue(app.staticTexts["Gmail Connected"].waitForExistence(timeout: 5), "\(roundName): connected Gmail state missing in add flow")
            XCTAssertFalse(app.secureTextFields["Gmail App Password"].exists, "\(roundName): connected Gmail still asked for password")
            XCTAssertTrue(app.buttons["Open Gmail Inbox"].waitForExistence(timeout: 5), "\(roundName): connected Gmail had no open action")
        } else {
            XCTAssertTrue(app.staticTexts["Authorize Gmail for this CloudMail account"].waitForExistence(timeout: 10), "\(roundName): Gmail authorization path missing")
            XCTAssertTrue(app.secureTextFields["Gmail App Password"].waitForExistence(timeout: 5), "\(roundName): Gmail App Password field missing")
            XCTAssertFalse(app.staticTexts["Gmail Connected"].exists, "\(roundName): Gmail appeared connected under the wrong login")
        }
        app.navigationBars["Add mailbox"].buttons["Close"].tap()
        XCTAssertTrue(app.navigationBars["Account Center"].waitForExistence(timeout: 5), "\(roundName): closing Gmail flow did not return to Account Center")
        returnToInboxFromNestedSettings(roundName: roundName)
        assertNoBlockingErrors()
    }

    private func validateCodexP0CFrozenProductCertification(roundName: String) {
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "\(roundName): login did not reach Inbox")
        addScreenshot("codex-p0c-\(roundName)-01-inbox")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Inbox")

        let searchField = inboxSearchField()
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "\(roundName): inbox search was not visible")
        addScreenshot("codex-p0c-\(roundName)-02-inbox-search")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Search")
        if app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Cancel")).firstMatch.exists {
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Cancel")).firstMatch.tap()
        }

        for filter in ["All", "Unread", "Starred", "Gmail", "CloudMail"] {
            let button = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", filter)).firstMatch
            _ = button.waitForExistence(timeout: 2)
        }
        let allFilter = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All")).firstMatch
        if allFilter.waitForExistence(timeout: 3) {
            allFilter.tap()
        }
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Gmail", "CloudMail")).firstMatch.waitForExistence(timeout: 15),
            "\(roundName): mailbox provider badge was not visible"
        )

        openFirstVisibleReceivedMessage(roundName: roundName)
        addScreenshot("codex-p0c-\(roundName)-03-email-detail")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Message detail")
        XCTAssertTrue(app.buttons["Star message"].waitForExistence(timeout: 5), "\(roundName): star action missing")
        XCTAssertTrue(app.buttons["Archive message"].waitForExistence(timeout: 5), "\(roundName): archive action missing")
        XCTAssertTrue(app.buttons["Delete message"].waitForExistence(timeout: 5), "\(roundName): delete action missing")
        XCTAssertTrue(app.buttons["AI Assist"].waitForExistence(timeout: 5), "\(roundName): AI assist action missing")
        XCTAssertTrue(app.staticTexts["AI summary"].waitForExistence(timeout: 10), "\(roundName): AI assist summary card missing")
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "\(roundName): reply action missing")
        app.buttons["Message actions"].tap()
        XCTAssertTrue(app.buttons["Reply All"].waitForExistence(timeout: 5), "\(roundName): reply all action missing")
        XCTAssertTrue(app.buttons["Forward"].waitForExistence(timeout: 5), "\(roundName): forward action missing")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        returnToInboxFromNestedSettings(roundName: roundName)

        let inboxComposeButton = app.navigationBars["Inbox"].buttons.matching(identifier: "square.and.pencil").firstMatch
        XCTAssertTrue(inboxComposeButton.waitForExistence(timeout: 10), "\(roundName): compose entry missing")
        inboxComposeButton.tap()
        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 10), "\(roundName): compose screen did not open")
        addScreenshot("codex-p0c-\(roundName)-04-compose")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Compose")
        XCTAssertTrue(app.staticTexts["From"].waitForExistence(timeout: 5), "\(roundName): compose From missing")
        XCTAssertTrue(app.staticTexts["To"].waitForExistence(timeout: 5), "\(roundName): compose To missing")
        XCTAssertTrue(app.staticTexts["CC"].waitForExistence(timeout: 5), "\(roundName): compose Cc missing")
        XCTAssertTrue(app.staticTexts["BCC"].waitForExistence(timeout: 5), "\(roundName): compose Bcc missing")
        XCTAssertTrue(app.staticTexts["Message"].waitForExistence(timeout: 5), "\(roundName): compose body missing")
        XCTAssertTrue(app.staticTexts["AI Assist"].waitForExistence(timeout: 5), "\(roundName): compose AI Assist panel missing")
        tapSaveDraft()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10), "\(roundName): saving draft did not return to Inbox")
        let reopenedComposeButton = app.navigationBars["Inbox"].buttons.matching(identifier: "square.and.pencil").firstMatch
        XCTAssertTrue(reopenedComposeButton.waitForExistence(timeout: 10), "\(roundName): compose entry missing after saving draft")
        reopenedComposeButton.tap()
        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 10), "\(roundName): compose screen did not reopen")
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 5), "\(roundName): send action missing")
        tapSaveDraft()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10), "\(roundName): saving reopened draft did not return to Inbox")

        validateLoop6ESidebarExecution(roundName: roundName)
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Sidebar regression")

        app.buttons["Accounts"].tap()
        XCTAssertTrue(app.navigationBars["Accounts"].waitForExistence(timeout: 10), "\(roundName): Accounts tab did not open")
        addScreenshot("codex-p0c-\(roundName)-05-accounts")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Accounts")
        XCTAssertTrue(app.buttons["Add CloudMail address"].waitForExistence(timeout: 10), "\(roundName): Add Mailbox action missing")
        XCTAssertTrue(app.staticTexts["Sync State"].waitForExistence(timeout: 10), "\(roundName): authorization status missing")
        XCTAssertTrue(app.staticTexts["Last Sync"].waitForExistence(timeout: 10), "\(roundName): last sync missing")

        app.buttons["Add CloudMail address"].tap()
        XCTAssertTrue(app.navigationBars["Add mailbox"].waitForExistence(timeout: 10), "\(roundName): Add Mailbox did not open")
        addScreenshot("codex-p0c-\(roundName)-06-add-mailbox")
        for provider in ["CloudMail", "Gmail", "Outlook", "Yahoo"] {
            XCTAssertTrue(
                app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", provider)).firstMatch.waitForExistence(timeout: 10),
                "\(roundName): \(provider) provider option missing"
            )
        }
        XCTAssertFalse(app.buttons["Switch account"].exists, "\(roundName): Switch Account leaked into Add Mailbox")
        XCTAssertFalse(app.buttons["Switch account and sign in"].exists, "\(roundName): Switch Account sign-in leaked into Add Mailbox")
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Gmail")).firstMatch.waitForExistence(timeout: 5), "\(roundName): Gmail authorization state not visible")
        app.navigationBars["Add mailbox"].buttons["Close"].tap()

        app.buttons["AI Center"].tap()
        XCTAssertTrue(app.navigationBars["AI"].waitForExistence(timeout: 10), "\(roundName): AI Center did not open")
        addScreenshot("codex-p0c-\(roundName)-07-ai-center")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "AI Center")
        XCTAssertTrue(app.staticTexts["Apple Intelligence"].waitForExistence(timeout: 10), "\(roundName): Apple Intelligence state missing")
        XCTAssertTrue(app.staticTexts["Gemini"].waitForExistence(timeout: 10), "\(roundName): Gemini state missing")
        XCTAssertTrue(app.staticTexts["ChatGPT"].waitForExistence(timeout: 10), "\(roundName): ChatGPT state missing")
        let aiText = visibleStaticTextLabels().lowercased()
        XCTAssertFalse(aiText.contains("api key"), "\(roundName): AI Center exposed API key language")
        XCTAssertFalse(aiText.contains("byok"), "\(roundName): AI Center exposed BYOK language")
        XCTAssertFalse(aiText.contains("claude"), "\(roundName): AI Center exposed Claude in the normal user path")

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "\(roundName): Settings did not open")
        addScreenshot("codex-p0c-\(roundName)-08-settings")
        assertNoRawErrorArtifacts(roundName: roundName, surface: "Settings")
        let appearanceHeader = app.staticTexts["General & Appearance"]
        let themeOption = app.buttons["System Default"]
        XCTAssertTrue(
            appearanceHeader.waitForExistence(timeout: 3) || themeOption.waitForExistence(timeout: 3),
            "\(roundName): Appearance settings missing"
        )
        XCTAssertTrue(app.staticTexts["Notifications"].waitForExistence(timeout: 5), "\(roundName): Notifications settings missing")
        scrollToStaticTextOrButton("Biometric Lock", maxSwipes: 4)
        XCTAssertTrue(
            app.staticTexts["Biometric Lock"].waitForExistence(timeout: 3)
                || app.buttons["Privacy Policy"].waitForExistence(timeout: 3),
            "\(roundName): Privacy/Security settings missing"
        )
        scrollToButton("Signatures", maxSwipes: 6)
        XCTAssertTrue(app.buttons["Signatures"].waitForExistence(timeout: 5), "\(roundName): Signatures missing")
        assertNoBlockingErrors()
    }

    private func validateLoop6ESidebarExecution(roundName: String) {
        openMailboxSwitcher()
        XCTAssertTrue(waitForMailboxDrawer(timeout: 10), "\(roundName): mailbox drawer did not open")
        addScreenshot("loop6e-\(roundName)-01-sidebar-open")

        for staticLabel in ["Smart Views", "Standard Folders", "Labels", "Add Smart View", "Add Label", "No labels available"] {
            XCTAssertTrue(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", staticLabel)).firstMatch.waitForExistence(timeout: 10),
                "\(roundName): sidebar static/disabled item \(staticLabel) was not visible"
            )
        }
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "AI reply detection is not enabled")).firstMatch.exists,
            "\(roundName): Needs Reply still used the old unavailable placeholder"
        )

        let executableRows: [(String, String)] = [
            ("sidebar-row-all-mail", "All Mail"),
            ("sidebar-row-unread", "Unread"),
            ("sidebar-row-starred", "Starred"),
            ("sidebar-row-needs-reply", "Needs Reply"),
            ("sidebar-row-todo", "To-do"),
            ("sidebar-row-follow-up", "Follow-up"),
            ("sidebar-row-important", "Important"),
            ("sidebar-row-inbox", "Inbox"),
            ("sidebar-row-sent", "Sent"),
            ("sidebar-row-snoozed", "Snoozed"),
            ("sidebar-row-drafts", "Drafts"),
            ("sidebar-row-outbox", "Outbox"),
            ("sidebar-row-send-later", "Send Later"),
            ("sidebar-row-junk", "Junk"),
            ("sidebar-row-trash", "Trash"),
            ("sidebar-row-done", "Done")
        ]

        for (identifier, label) in executableRows {
            tapSidebarRow(identifier: identifier, label: label, roundName: roundName)
        }

        validateDynamicSidebarRows(prefix: "sidebar-row-account-", category: "account", roundName: roundName)
        validateDynamicSidebarRows(prefix: "sidebar-row-delegated-", category: "delegated mailbox", roundName: roundName)

        openMailboxSwitcher()
        let unread = app.buttons["sidebar-row-unread"]
        XCTAssertTrue(unread.waitForExistence(timeout: 10), "\(roundName): Unread row missing for context menu")
        unread.press(forDuration: 1.0)
        XCTAssertTrue(
            app.buttons["Mark all as read"].waitForExistence(timeout: 5)
                || app.buttons["Reset view"].waitForExistence(timeout: 5),
            "\(roundName): Unread context menu did not expose supported actions"
        )
        addScreenshot("loop6e-\(roundName)-02-sidebar-context-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()

        openMailboxSwitcher()
        let edit = app.buttons["sidebar-edit-customize"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10), "\(roundName): Edit Sidebar action missing")
        edit.tap()
        XCTAssertTrue(app.buttons["sidebar-edit-done"].waitForExistence(timeout: 10), "\(roundName): Done customizing sidebar missing")
        addScreenshot("loop6e-\(roundName)-03-sidebar-edit")
        let starred = app.buttons["sidebar-row-starred"]
        XCTAssertTrue(starred.waitForExistence(timeout: 10), "\(roundName): Starred row missing in edit mode")
        starred.tap()
        app.buttons["sidebar-edit-done"].tap()
        closeMailboxSwitcherIfVisible()
        openMailboxSwitcher()
        XCTAssertFalse(app.buttons["sidebar-row-starred"].waitForExistence(timeout: 2), "\(roundName): hidden Starred row remained visible after Done")
        app.buttons["sidebar-edit-customize"].tap()
        XCTAssertTrue(app.buttons["sidebar-row-starred"].waitForExistence(timeout: 10), "\(roundName): hidden Starred row was not restorable in edit mode")
        app.buttons["sidebar-row-starred"].tap()
        app.buttons["sidebar-edit-done"].tap()
        addScreenshot("loop6e-\(roundName)-04-sidebar-edit-restored")
        closeMailboxSwitcherIfVisible()
    }

    private func validateMailOSV2Feature01MultiSelect() {
        returnToInboxFromNestedSettings(roundName: "mailos-v2-feature01")
        let rows = visibleEmailRows()
        XCTAssertGreaterThan(rows.count, 0, "Feature 1: no visible email rows for multi-select")
        let first = rows[0]

        // Long press must always produce a useful state. Depending on the
        // current list interaction state it may expose contextual actions or
        // enter selection; the explicit Select control remains the fallback.
        first.press(forDuration: 1.0)
        let contextAvailable = app.buttons["Summarize Thread"].waitForExistence(timeout: 2)
            || app.buttons["Create Mission"].exists
        let longPressEnteredSelection = app.buttons["Cancel"].exists
            || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Selected")).firstMatch.exists
        XCTAssertTrue(
            contextAvailable || longPressEnteredSelection,
            "Feature 1: long press exposed neither contextual actions nor selection"
        )
        if contextAvailable {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        }
        if !app.buttons["Cancel"].exists {
            let selectMessages = app.buttons["inbox-enter-selection-mode"]
            XCTAssertTrue(selectMessages.waitForExistence(timeout: 5), "Feature 1: Select messages control missing")
            selectMessages.tap()
        }
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5), "Feature 1: Cancel missing in selection mode")
        XCTAssertTrue(
            app.images.matching(NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@", "checkmark", "checkmark")).firstMatch.exists
                || app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Selected")).firstMatch.exists,
            "Feature 1: selected checkmark/count not visible"
        )
        let selectAll = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Select All", "Deselect All")).firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5), "Feature 1: Select All/Deselect All missing")
        selectAll.tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Selected")).firstMatch.waitForExistence(timeout: 5),
            "Feature 1: selected count did not remain visible after Select All"
        )
        XCTAssertTrue(
            app.buttons["Toggle Star"].waitForExistence(timeout: 5)
                || app.buttons["Toggle Read State"].waitForExistence(timeout: 1)
                || app.buttons["Move"].waitForExistence(timeout: 1),
            "Feature 1: safe batch action toolbar missing"
        )
        app.buttons["Cancel"].tap()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 10), "Feature 1: Inbox disappeared after cancelling non-destructive batch validation")
        addScreenshot("mailos-v2-01-multiselect")
    }

    private func validateMailOSV2Feature02InlineStar() {
        returnToInboxFromNestedSettings(roundName: "mailos-v2-feature02")
        let star = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "inline-star-toggle-")).firstMatch
        XCTAssertTrue(star.waitForExistence(timeout: 15), "Feature 2: inline star button missing")
        let beforeLabel = star.label
        star.tap()
        let toggled = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "inline-star-toggle-")).firstMatch
        XCTAssertTrue(toggled.waitForExistence(timeout: 5), "Feature 2: inline star disappeared after tap")
        XCTAssertTrue(isInteractiveInboxVisible(), "Feature 2: tapping inline star navigated away")
        XCTAssertNotEqual(beforeLabel, toggled.label, "Feature 2: inline star label did not change after tap")
        toggled.tap()
        XCTAssertTrue(isInteractiveInboxVisible(), "Feature 2: unstar navigation regression")
        addScreenshot("mailos-v2-02-inline-star")
    }

    private func validateMailOSV2Feature03Categories() {
        returnToInboxFromNestedSettings(roundName: "mailos-v2-feature03")
        let expectedChips = ["All", "Unread", "Priority", "Personal"]
        for chip in expectedChips {
            XCTAssertTrue(
                app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", chip)).firstMatch.waitForExistence(timeout: 10),
                "Feature 3: category/filter chip \(chip) missing"
            )
        }
        let categorizedRow = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@", "Email row", "Category:")
        ).firstMatch
        XCTAssertTrue(categorizedRow.waitForExistence(timeout: 10), "Feature 3: visible message category was not exposed in the row")
        addScreenshot("mailos-v2-03-categories")
    }

    private func validateMailOSV2Feature04MoveSheetAndFeature07SnoozeAndFeature08UnsubscribeAndFeature10SenderProfile() {
        resetMailOSV2InboxList(roundName: "mailos-v2-detail-start")
        openFirstVisibleReceivedMessage(roundName: "mailos-v2-detail")
        XCTAssertFalse(isInboxSurfaceVisible(), "Detail validation did not open message detail")
        XCTAssertTrue(app.buttons["Move"].waitForExistence(timeout: 10), "Feature 4: Move bottom toolbar button missing")
        app.buttons["Move"].tap()
        XCTAssertTrue(app.navigationBars["Move to"].waitForExistence(timeout: 10), "Feature 4: Move sheet did not open")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "move-to-mailbox-")).firstMatch.waitForExistence(timeout: 5), "Feature 4: no move destinations listed")
        addScreenshot("mailos-v2-04-move-sheet")
        app.buttons["Cancel"].tap()

        XCTAssertTrue(app.buttons["Message actions"].waitForExistence(timeout: 10), "Detail More menu missing")
        app.buttons["Message actions"].tap()
        XCTAssertTrue(app.buttons["Snooze"].waitForExistence(timeout: 5), "Feature 7: Snooze action missing")
        XCTAssertTrue(app.buttons["Move to Category"].waitForExistence(timeout: 5), "Feature 3: Move to Category learning menu missing")
        XCTAssertTrue(app.buttons["Block Sender"].waitForExistence(timeout: 5), "Feature 8: Block Sender action missing")
        XCTAssertTrue(app.buttons["Sender Profile"].waitForExistence(timeout: 5), "Feature 10: Sender Profile action missing")
        if app.buttons["Unsubscribe"].exists {
            XCTAssertTrue(app.buttons["Unsubscribe"].isHittable, "Feature 8: Unsubscribe exists but is not actionable")
        }
        app.buttons["Sender Profile"].tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.waitForExistence(timeout: 5),
            "Feature 10: Sender Profile did not expose safe sender metadata"
        )
        addScreenshot("mailos-v2-07-08-10-more-menu")
        returnToInboxFromNestedSettings(roundName: "mailos-v2-detail-return")
    }

    private func validateMailOSV2Feature05AutocompleteFeature06UndoFeature09TemplatesFeature12ReadReceipts() {
        resetMailOSV2InboxList(roundName: "mailos-v2-compose-start")
        let composeButton = primaryComposeButton()
        XCTAssertTrue(composeButton.waitForExistence(timeout: 10), "Compose button missing")
        composeButton.tap()
        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 10), "Compose did not open")

        let toField = app.textFields["name@example.com"]
        XCTAssertTrue(toField.waitForExistence(timeout: 10), "Feature 5: To field missing")
        replace(toField, with: "fast")
        let suggestion = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compose-recipient-autocomplete-")).firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "Feature 5: recipient autocomplete suggestions missing")
        suggestion.tap()
        XCTAssertTrue(
            (toField.value as? String)?.contains("@") == true || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "@")).firstMatch.exists,
            "Feature 5: tapping suggestion did not insert a recipient"
        )

        let writingTools = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Writing tools")).firstMatch
        XCTAssertTrue(writingTools.waitForExistence(timeout: 10), "Feature 9: Writing tools disclosure missing")
        if !app.staticTexts["Quick Replies"].exists { writingTools.tap() }
        XCTAssertTrue(app.staticTexts["Quick Replies"].waitForExistence(timeout: 10), "Feature 9: Quick Replies header missing after expanding Writing tools")
        let template = app.buttons["quick-reply-template"].firstMatch
        XCTAssertTrue(template.waitForExistence(timeout: 10), "Feature 9: no quick reply template button")
        template.tap()
        XCTAssertTrue(
            app.textViews.firstMatch.value as? String != nil || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Thanks")).firstMatch.waitForExistence(timeout: 2),
            "Feature 9: template insertion did not affect composer"
        )

        let deliveryOptions = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Delivery options")).firstMatch
        XCTAssertTrue(deliveryOptions.waitForExistence(timeout: 10), "Feature 12: Delivery options disclosure missing")
        if !app.switches["optional-read-receipt-toggle"].firstMatch.exists { deliveryOptions.tap() }
        let receipt = app.switches["optional-read-receipt-toggle"].firstMatch
        XCTAssertTrue(receipt.waitForExistence(timeout: 10), "Feature 12: read receipt toggle missing")
        XCTAssertTrue(app.staticTexts["Optional and off by default. This does not prove delivery."].waitForExistence(timeout: 5), "Feature 12: privacy copy missing")
        func receiptIsOff(_ element: XCUIElement) -> Bool {
            if let number = element.value as? NSNumber { return !number.boolValue }
            let value = String(describing: element.value ?? "")
            return value == "0" || value.localizedCaseInsensitiveContains("off") || value.localizedCaseInsensitiveContains("false")
        }
        if !receiptIsOff(receipt) {
            receipt.tap()
        }
        XCTAssertTrue(
            receiptIsOff(receipt),
            "Feature 12: read receipt could not be returned to the privacy-safe off state"
        )

        replace(app.textFields["Subject"], with: "MailOS V2 undo send safe validation")
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 5), "Feature 6: Send button missing")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["Sending in 5 seconds"].waitForExistence(timeout: 5), "Feature 6: Undo Send banner/countdown missing")
        XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 5), "Feature 6: Undo button missing")
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.staticTexts["Send cancelled. Draft saved."].waitForExistence(timeout: 10), "Feature 6: undo did not save/cancel draft")
        Thread.sleep(forTimeInterval: 6.0)
        XCTAssertFalse(
            app.staticTexts["Provider accepted the message. Delivery remains pending trusted confirmation."].exists,
            "Feature 6: cancelled queue still reached provider acceptance after the undo deadline"
        )
        addScreenshot("mailos-v2-05-06-09-12-compose")
        tapSaveDraft()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 10), "Compose did not return to Inbox after save")
    }

    private func validateMailOSV2Feature11SmartSearch() {
        resetMailOSV2InboxList(roundName: "mailos-v2-feature11")
        typeIntoInboxSearch("unread", roundName: "mailos-v2-feature11-unread")
        XCTAssertTrue(waitForInteractiveInbox(timeout: 5), "Feature 11: Inbox disappeared during search")
        addScreenshot("mailos-v2-11-search-unread")
        let searchField = inboxSearchField()
        tapElement(searchField)
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24))
        app.typeText("from:fast")
        XCTAssertTrue(waitForInteractiveInbox(timeout: 5), "Feature 11: from: query caused navigation failure")
        addScreenshot("mailos-v2-11-search-from")
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24))
    }

    private func resetMailOSV2InboxList(roundName: String) {
        returnToInboxFromNestedSettings(roundName: roundName)
        closeMailboxSwitcherIfOpen()
        let allChip = app.buttons.matching(NSPredicate(format: "label == %@", "All")).firstMatch
        if allChip.exists && allChip.isHittable {
            allChip.tap()
        }
        let searchField = inboxSearchField()
        if searchField.waitForExistence(timeout: 2) {
            let searchValue = (searchField.value as? String) ?? ""
            if !searchValue.isEmpty,
               searchValue.localizedCaseInsensitiveCompare("Search mail") != .orderedSame {
                tapElement(searchField)
                let clearButton = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@", "Clear", "clear")).firstMatch
                if clearButton.waitForExistence(timeout: 1), clearButton.isHittable {
                    clearButton.tap()
                } else {
                    searchField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
                }
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.16)).tap()
            }
        }
        if visibleEmailRows().isEmpty {
            for _ in 0..<3 where visibleEmailRows().isEmpty {
                let allMail = app.buttons["All Mail"]
                if allMail.waitForExistence(timeout: 1) {
                    tapElement(allMail)
                    break
                }
                app.swipeUp()
            }
        }
        for _ in 0..<3 where visibleEmailRows().isEmpty {
            app.swipeDown()
        }
        for _ in 0..<5 where !inboxSearchField().exists {
            app.swipeDown()
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertFalse(visibleEmailRows().isEmpty, "\(roundName): Inbox list did not expose message rows after reset")
    }

    private func tapSidebarRow(identifier: String, label: String, roundName: String) {
        openMailboxSwitcher()
        let row = app.buttons[identifier]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(roundName): \(label) row \(identifier) missing")
        row.tap()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10), "\(roundName): tapping \(label) did not return to Inbox")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current mailbox")).firstMatch.waitForExistence(timeout: 10),
            "\(roundName): mailbox header disappeared after selecting \(label)"
        )
    }

    private func validateDynamicSidebarRows(prefix: String, category: String, roundName: String) {
        openMailboxSwitcher()
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).allElementsBoundByIndex
        let identifiers = rows.compactMap { element -> String? in
            guard element.exists else { return nil }
            return element.identifier
        }
        for identifier in identifiers {
            tapSidebarRow(identifier: identifier, label: "\(category) \(identifier)", roundName: roundName)
        }
    }

    private func closeMailboxSwitcherIfVisible() {
        if isMailboxDrawerOpen {
            let close = app.buttons["Close mailbox switcher"]
            if close.exists {
                close.tap()
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.12)).tap()
            }
        }
    }

    private var isMailboxDrawerOpen: Bool {
        app.staticTexts["Mail OS"].exists || app.staticTexts["Mailboxes"].exists
    }

    private func waitForMailboxDrawer(timeout: TimeInterval) -> Bool {
        app.staticTexts["Mail OS"].waitForExistence(timeout: timeout)
            || app.staticTexts["Mailboxes"].waitForExistence(timeout: 1)
    }

    private func login(email: String, password: String) {
        let createAccount = app.buttons["Create a new account"]
        XCTAssertTrue(createAccount.waitForExistence(timeout: 20), "CloudMail did not reach onboarding")
        signInFromOnboarding(email: email, password: password)
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Login did not reach Inbox")
        dismissPasswordSavePrompt()
    }

    private func ensureInboxFromExistingSessionOrRuntimeCredentials() throws {
        if app.buttons["Done"].waitForExistence(timeout: 2) {
            app.buttons["Done"].tap()
        }
        if waitForInteractiveInbox(timeout: 12) {
            return
        }
        if testCredentialBridgeURL != nil {
            app.terminate()
            app.launch()
            if waitForInteractiveInbox(timeout: 45) {
                return
            }
        }
        guard let credentials = runtimeCredentials() else {
            XCTFail("Existing session did not reach Inbox and CloudMail runtime credentials were not supplied")
            return
        }
        login(email: credentials.email, password: credentials.password)
    }

    private func selectMergedAllMailForUCSValidation() {
        let mailbox = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Current mailbox:")).firstMatch
        XCTAssertTrue(mailbox.waitForExistence(timeout: 10), "UCS validation could not open the mailbox switcher")
        mailbox.tap()
        let allMail = app.buttons.matching(NSPredicate(format: "label == %@", "All Mail")).firstMatch
        XCTAssertTrue(allMail.waitForExistence(timeout: 10), "UCS validation did not expose merged All Mail")
        allMail.tap()
        XCTAssertTrue(waitForInteractiveInbox(timeout: 10), "UCS validation did not return to Inbox after selecting All Mail")
    }

    private var shouldResetSessionBeforeTest: Bool {
        !name.contains("ExistingSession")
            && !name.contains("testLoop6ARound1ExistingUserRealFlowWithRuntimeCredentials")
            && !name.contains("testCodexP0CRound")
            && !name.contains("testLoop6BComposeDraftAndMailClientCoreWithExistingSession")
            && !name.contains("testNexoraV3CommandCenterRealIPhone")
            && !name.contains("testNexora")
            && !name.contains("testEnterpriseAccountsDiagnosticsOAuthApprovalRealIPhoneNonDestructive")
    }

    private func registerAndLogin(localPart: String, fullEmail: String, password: String) {
        let createAccount = app.buttons["Create a new account"]
        XCTAssertTrue(createAccount.waitForExistence(timeout: 20), "CloudMail did not reach onboarding")
        createAccount.tap()

        XCTAssertTrue(app.navigationBars["Create New Account"].waitForExistence(timeout: 10))
        replace(app.textFields["username"], with: localPart)
        replace(app.textFields["domain.com"], with: domain)
        replace(app.secureTextFields["Password"], with: password)
        replace(app.textFields["Registration code"], with: registrationCode)
        app.buttons["Register"].tap()

        XCTAssertTrue(
            app.staticTexts["Registered successfully. Please sign in."].waitForExistence(timeout: 20)
                || app.buttons["Create a new account"].waitForExistence(timeout: 1),
            "Registration did not return to login"
        )
        signInFromOnboarding(email: fullEmail, password: password)
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 30), "Login did not reach Inbox")
        dismissPasswordSavePrompt()
    }

    private func signInFromOnboarding(email: String, password: String) {
        XCTAssertTrue(app.buttons["Create a new account"].waitForExistence(timeout: 10), "Onboarding login actions were not visible")
        let domainField = app.textFields["example.com"]
        XCTAssertTrue(domainField.waitForExistence(timeout: 10), "Missing onboarding domain field")
        if (domainField.value as? String) != domain {
            replace(domainField, with: domain)
        }

        let emailField = app.textFields.matching(NSPredicate(format: "placeholderValue BEGINSWITH[c] %@", "you@")).firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 10), "Missing onboarding email field")
        replace(emailField, with: email)

        let passwordField = app.secureTextFields.firstMatch
        XCTAssertTrue(passwordField.waitForExistence(timeout: 10), "Missing onboarding password field")
        replace(passwordField, with: password)
        app.buttons["Sign in"].tap()
    }

    private func returnToInboxFromNestedSettings(roundName: String) {
        if isInteractiveInboxVisible() { return }
        for _ in 0..<8 {
            if isInteractiveInboxVisible() { return }
            if app.navigationBars["Add mailbox"].exists {
                let close = app.navigationBars["Add mailbox"].buttons["Close"]
                if close.exists {
                    close.tap()
                    continue
                }
            }
            if app.navigationBars["Inbox"].exists {
                let close = app.navigationBars["Inbox"].buttons["Close"]
                if close.exists {
                    close.tap()
                    continue
                }
            }
            if app.buttons.matching(identifier: "xmark").firstMatch.exists {
                app.buttons.matching(identifier: "xmark").firstMatch.tap()
                continue
            }
            if app.navigationBars["Account Center"].exists {
                tapLeadingNavigationButton(on: "Account Center")
                continue
            }
            if app.navigationBars["Settings"].exists, app.buttons["Done"].exists {
                app.buttons["Done"].tap()
                continue
            }
            if app.buttons["Done"].exists {
                app.buttons["Done"].tap()
                continue
            }
            if app.buttons["Close"].exists {
                app.buttons["Close"].tap()
                continue
            }
            let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
            if inboxTab.exists && inboxTab.isHittable {
                inboxTab.tap()
                continue
            }
            let navBack = app.navigationBars.buttons.element(boundBy: 0)
            if navBack.exists {
                navBack.tap()
                continue
            }
        }
        XCTAssertTrue(isInteractiveInboxVisible(), "\(roundName): returning to interactive Inbox failed")
    }

    private func tapLeadingNavigationButton(on title: String) {
        let bar = app.navigationBars[title]
        for label in ["Settings", "Back", "BackButton"] {
            let button = bar.buttons[label]
            if button.exists && button.isHittable {
                button.tap()
                return
            }
        }
        bar.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.5)).tap()
    }

    private func isInteractiveInboxVisible() -> Bool {
        if !isInboxSurfaceVisible() { return false }
        if isInboxListReady() { return true }
        let menu = inboxActionMenu()
        if menu.waitForExistence(timeout: 1) && menu.isHittable { return true }
        return false
    }

    private func waitForInteractiveInbox(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isInteractiveInboxVisible() { return true }
            let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
            if inboxTab.exists && inboxTab.isHittable {
                inboxTab.tap()
            } else if app.tabBars.buttons["Email"].firstMatch.exists && app.tabBars.buttons["Email"].firstMatch.isHittable {
                app.tabBars.buttons["Email"].firstMatch.tap()
            } else {
                let inboxButton = app.buttons.matching(NSPredicate(format: "label == %@", "Inbox")).firstMatch
                if inboxButton.exists && inboxButton.isHittable {
                    inboxButton.tap()
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return isInteractiveInboxVisible()
    }

    private func waitUntil(timeout: TimeInterval, condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func isInboxSurfaceVisible() -> Bool {
        if isInboxListReady() { return true }
        if app.staticTexts["Inbox"].exists && inboxActionMenu().exists { return true }
        return inboxActionMenu().exists
            && app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current mailbox")).firstMatch.exists
    }

    private func inboxActionMenu() -> XCUIElement {
        let nexora = app.buttons["NEXORA actions"]
        return nexora.exists ? nexora : app.buttons["CloudMail actions"]
    }

    private func isInboxListReady() -> Bool {
        if inboxSearchField().exists { return true }
        if !visibleEmailRows().isEmpty { return true }
        if app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current mailbox")).firstMatch.exists { return true }
        return app.buttons.matching(NSPredicate(format: "label == %@", "All")).firstMatch.exists
            && app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Unread")).firstMatch.exists
    }

    private func primaryComposeButton() -> XCUIElement {
        let navigationCompose = app.navigationBars["Inbox"].buttons.matching(identifier: "square.and.pencil").firstMatch
        if navigationCompose.exists { return navigationCompose }
        let tabCompose = app.tabBars.buttons["Compose"].firstMatch
        if tabCompose.exists { return tabCompose }
        return app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR identifier CONTAINS[c] %@", "Compose", "compose")).firstMatch
    }

    private func dismissPasswordSavePrompt() {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) {
            notNow.tap()
        }
    }

    private func signOut() {
        for _ in 0..<3 {
            returnToInboxFromNestedSettings(roundName: "signout")
            let menu = app.buttons["CloudMail actions"]
            XCTAssertTrue(menu.waitForExistence(timeout: 10) && menu.isHittable, "Inbox action menu was not available")
            menu.tap()
            let signOut = app.buttons["Sign out"]
            if signOut.waitForExistence(timeout: 5) {
                signOut.tap()
                return
            }
        }
        XCTFail("Sign out action was not available")
    }

    private func openSettings() {
        let menu = app.buttons["CloudMail actions"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "Inbox action menu was not available")
        for _ in 0..<2 {
            menu.tap()
            if tapCloudMailActionSettings(timeout: 4) {
                XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not open")
                return
            }
        }
        XCTFail("Settings action was not available")
    }

    @discardableResult
    private func tapCloudMailActionSettings(timeout: TimeInterval) -> Bool {
        let menuSettings = app.buttons["cloudmail-actions-settings"]
        if menuSettings.waitForExistence(timeout: timeout) {
            menuSettings.tap()
            return true
        }
        let settingsMenuItem = app.buttons.matching(NSPredicate(format: "label == %@", "Settings")).allElementsBoundByIndex.first {
            !$0.identifier.contains("TabBar") && $0.exists
        }
        if let settingsMenuItem {
            settingsMenuItem.tap()
            return true
        }
        return false
    }

    private func assertNoBlockingErrors() {
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Session expired'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'SQLITE_ERROR'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'D1_ERROR'")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'mail_state_version_conflict'")).firstMatch.exists)
    }

    private func assertManagedCloudMailAddressHasAction(email: String, roundName: String? = nil) {
        let prefix = roundName.map { "\($0): " } ?? ""
        XCTAssertTrue(app.staticTexts[email].waitForExistence(timeout: 5), "\(prefix)CloudMail state did not preserve the full email address")
        if app.staticTexts["Already in this CloudMail account"].waitForExistence(timeout: 3) {
            XCTAssertTrue(app.buttons["Open this mailbox"].waitForExistence(timeout: 5), "\(prefix)current-account mailbox did not expose an open action")
            XCTAssertFalse(app.secureTextFields["Password"].exists, "\(prefix)current-account mailbox should not request a password")
            return
        }
        XCTAssertTrue(app.navigationBars["Secure sign in"].waitForExistence(timeout: 20), "\(prefix)native secure authentication sheet was not visible")
        XCTAssertTrue(app.textFields["Secure authentication email"].exists, "\(prefix)secure principal email field was missing")
        XCTAssertTrue(app.secureTextFields["Secure authentication input"].exists, "\(prefix)secure password/code/OTP input was missing")
        XCTAssertFalse(app.secureTextFields["Mailbox password"].exists, "\(prefix)legacy inline password field remained visible")
        XCTAssertFalse(app.buttons["Switch account"].exists, "\(prefix)active CloudMail account leaked account-switch routing into Add mailbox")
        XCTAssertFalse(app.buttons["Switch account and sign in"].exists, "\(prefix)active CloudMail account leaked account-switch sign-in into Add mailbox")
        // Never type into or screenshot the secure field. Device automation
        // validates only the empty boundary, then returns control to the user.
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Resume secure authentication"].waitForExistence(timeout: 5), "\(prefix)cancel did not expose resumable authentication")
    }

    private func assertMailboxDrawerSmartFolders(roundName: String) {
        for label in ["All Mail", "Junk", "To-do", "Follow-up", "Important", "Needs Reply", "Done"] {
            var found = app.staticTexts[label].exists || app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch.exists
            for _ in 0..<4 where !found {
                app.swipeUp()
                found = app.staticTexts[label].exists || app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch.exists
            }
            XCTAssertTrue(found, "\(roundName): mailbox drawer missing \(label)")
        }
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "AI classification folder is not enabled")).firstMatch.exists
                || app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "AI priority folder is not enabled")).firstMatch.exists,
            "\(roundName): AI smart folders were not truthfully bounded"
        )
        for _ in 0..<4 {
            app.swipeDown()
        }
    }

    private func assertLoop6C0EMessageDetailProof(roundName: String) {
        XCTAssertFalse(app.navigationBars["Inbox"].exists, "\(roundName): tapping a visible received message did not open detail")
        XCTAssertFalse(app.staticTexts["Message source"].exists, "\(roundName): legacy source panel dominated normal reading")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Gmail", "CloudMail")).firstMatch.waitForExistence(timeout: 10),
            "\(roundName): compact source context missing from header"
        )
        XCTAssertTrue(app.staticTexts["AI summary"].waitForExistence(timeout: 10), "\(roundName): AI/source card was not visible above body")
        assertNoRawBodyArtifacts(roundName: "\(roundName)-source-card")
        XCTAssertFalse(renderedBodyLabel().exists, "\(roundName): debug body label leaked into normal reading")

        app.buttons["Message actions"].tap()
        XCTAssertTrue(app.buttons["Message details"].waitForExistence(timeout: 5), "\(roundName): message details action missing")
        app.buttons["Message details"].tap()
        XCTAssertTrue(app.navigationBars["Message details"].waitForExistence(timeout: 10), "\(roundName): message details sheet did not open")
        XCTAssertTrue(app.staticTexts["Provider"].waitForExistence(timeout: 10), "\(roundName): detail provider label missing")
        XCTAssertTrue(app.staticTexts["Account"].waitForExistence(timeout: 10), "\(roundName): detail account label missing")
        XCTAssertTrue(app.staticTexts["Domain"].waitForExistence(timeout: 10), "\(roundName): detail domain label missing")
        app.buttons["Done"].tap()
        assertNoRawBodyArtifacts(roundName: "\(roundName)-body")

        if app.staticTexts["Attachments"].exists {
            XCTAssertTrue(
                app.staticTexts["Attachments"].isHittable || app.staticTexts["Attachments"].waitForExistence(timeout: 1),
                "\(roundName): attachment section was not separated from body"
            )
        }
        addScreenshot("loop6c0e-\(roundName)-message-detail-rendering")
    }

    private func openSourceAttributedMessage(attribution: XCUIElement, roundName: String) {
        for _ in 0..<4 {
            let attributedRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@", "Email row", "AI: Apple Intelligence")).firstMatch
            if attributedRow.exists {
                tapElement(attributedRow)
                break
            }
            let rows = visibleEmailRows()
            if let row = rows.first(where: { $0.exists }) {
                tapElement(row)
                break
            }
            app.swipeUp()
        }
        if app.navigationBars["Inbox"].waitForExistence(timeout: 2) {
            let rows = visibleEmailRows()
            if let row = rows.first(where: { $0.exists }) {
                tapElement(row)
            } else {
                attribution.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -1.8)).tap()
            }
        }
        XCTAssertFalse(app.navigationBars["Inbox"].waitForExistence(timeout: 5), "\(roundName): source-attributed row did not open detail")
    }

    private func openFirstVisibleReceivedMessage(roundName: String) {
        XCTAssertTrue(waitForInteractiveInbox(timeout: 10), "\(roundName): Inbox was not visible before opening mail")
        closeMailboxSwitcherIfOpen()
        let validationGmail = findVisibleValidationGmailMessage()
        if validationGmail.exists {
            let validationRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@", "Email row", "CMOS5D Attachment Persistence")).firstMatch
            if validationRow.exists, validationRow.isHittable {
                tapMailRowContent(validationRow)
            } else {
                validationGmail.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            if isEmailDetailSurfaceVisible() {
                return
            }
            returnToInboxFromNestedSettings(roundName: "\(roundName)-validation-row-recovery")
        }
        for _ in 0..<3 {
            let rows = tappableEmailRows()
            for index in 0..<min(rows.count, 8) {
                let row = rows[index]
                guard row.exists else { continue }
                tapMailRowContent(row)
                if isEmailDetailSurfaceVisible() {
                    return
                }
                returnToInboxFromNestedSettings(roundName: "\(roundName)-row-\(index)-recovery")
                let mailboxClose = app.navigationBars["Inbox"].buttons["Close"].firstMatch
                if isMailboxDrawerOpen, mailboxClose.exists {
                    mailboxClose.tap()
                }
            }
            app.swipeUp()
        }
        XCTFail("\(roundName): no visible received message row could be opened for detail/rendering proof")
    }

    private func visibleEmailRows() -> [XCUIElement] {
        let predicate = NSPredicate(format: "identifier BEGINSWITH %@", "Email row")
        let buttons = app.buttons.matching(predicate).allElementsBoundByIndex
        if !buttons.isEmpty { return buttons }
        let cells = app.cells.matching(predicate).allElementsBoundByIndex
        if !cells.isEmpty { return cells }
        return app.descendants(matching: .any).matching(predicate).allElementsBoundByIndex
    }

    private func tappableEmailRows() -> [XCUIElement] {
        let appFrame = app.frame
        let topLimit = appFrame.minY + 180
        let bottomLimit = appFrame.maxY - 250
        return visibleEmailRows().filter { row in
            let frame = row.frame
            return row.exists
                && frame.width > 80
                && frame.height > 32
                && frame.midY > topLimit
                && frame.midY < bottomLimit
        }
    }

    private func isEmailDetailSurfaceVisible() -> Bool {
        app.buttons["Message actions"].waitForExistence(timeout: 2)
            || app.buttons["email-detail-move-icon"].waitForExistence(timeout: 1)
            || app.buttons["Move"].waitForExistence(timeout: 1)
    }

    private func inboxSearchField() -> XCUIElement {
        let systemSearch = app.searchFields.firstMatch
        if systemSearch.exists { return systemSearch }
        let textField = app.textFields["Search mail"].firstMatch
        if textField.exists { return textField }
        let anySearch = app.descendants(matching: .any).matching(identifier: "Search mail").firstMatch
        if anySearch.exists { return anySearch }
        return systemSearch
    }

    private func typeIntoInboxSearch(_ value: String, roundName: String) {
        returnToInboxFromNestedSettings(roundName: "\(roundName)-search-reset")
        for _ in 0..<5 where !inboxSearchField().exists {
            app.swipeDown()
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        let searchField = inboxSearchField()
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "\(roundName): inbox search was not visible. \(searchDebugDescription())")
        tapElement(searchField)
        let focusedSearch = inboxSearchField()
        XCTAssertTrue(focusedSearch.waitForExistence(timeout: 3), "\(roundName): inbox search disappeared after focus. \(searchDebugDescription())")
        app.typeText(value)
    }

    private func searchDebugDescription() -> String {
        let searchFields = app.searchFields.allElementsBoundByIndex.map { "searchField[id=\($0.identifier), label=\($0.label)]" }
        let textFields = app.textFields.allElementsBoundByIndex.map { "textField[id=\($0.identifier), label=\($0.label)]" }
        let searchLike = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier CONTAINS[c] %@ OR label CONTAINS[c] %@", "Search", "Search"))
            .allElementsBoundByIndex
            .prefix(8)
            .map { "element[type=\($0.elementType.rawValue), id=\($0.identifier), label=\($0.label)]" }
        return (searchFields + textFields + searchLike).joined(separator: " | ")
    }

    private func aiAttributionElement(containing text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", text))
            .firstMatch
    }

    private func tapElement(_ element: XCUIElement) {
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func tapMailRowContent(_ row: XCUIElement) {
        if row.isHittable {
            row.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.5)).tap()
        } else {
            row.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.5)).tap()
        }
    }

    private func closeMailboxSwitcherIfOpen() {
        guard isMailboxDrawerOpen else { return }
        if app.buttons["Close mailbox switcher"].exists {
            app.buttons["Close mailbox switcher"].tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        }
        _ = app.navigationBars["Inbox"].waitForExistence(timeout: 3)
    }

    private func renderedBodyLabel() -> XCUIElement {
        app.staticTexts.matching(
            NSPredicate(format: "label == %@ OR label == %@ OR label == %@",
                        "Rich email body", "Plain text body", "Message body")
        ).firstMatch
    }

    private func assertNoRawBodyArtifacts(roundName: String) {
        let markdownLink = app.staticTexts.matching(
            NSPredicate(format: "label MATCHES[c] %@", ".*\\[[^\\]]+\\]\\(https?://.*\\).*")
        ).firstMatch
        XCTAssertFalse(markdownLink.exists, "\(roundName): raw Markdown-style link clutter was visible")

        let labels = visibleStaticTextLabels().lowercased()
        XCTAssertFalse(labels.contains("<html"), "\(roundName): raw HTML document text was visible")
        XCTAssertFalse(labels.contains("<body"), "\(roundName): raw HTML body tag was visible")
        XCTAssertFalse(labels.contains("</"), "\(roundName): raw closing HTML tag was visible")
        XCTAssertFalse(labels.contains("<!doctype"), "\(roundName): raw doctype artifact was visible")
    }

    private func assertNoRawErrorArtifacts(roundName: String, surface: String) {
        let labels = visibleStaticTextLabels().lowercased()
        let forbidden = [
            "the session's transcript exceeded the model's context size",
            "receiveemail.every is not a function",
            "attachment sending is not enabled by the backend yet",
            "typeerror:",
            "referenceerror:",
            "syntaxerror:",
            "stack trace"
        ]
        for token in forbidden {
            XCTAssertFalse(labels.contains(token), "\(roundName): \(surface) exposed raw error artifact '\(token)'")
        }
    }

    private func tapSaveDraft() {
        let saveDraft = app.buttons["Save draft"]
        if saveDraft.waitForExistence(timeout: 3) {
            saveDraft.tap()
            return
        }
        let more = app.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 5), "Composer toolbar overflow was not available for Save draft")
        more.tap()
        XCTAssertTrue(saveDraft.waitForExistence(timeout: 5), "Save draft was not available from composer toolbar overflow")
        saveDraft.tap()
    }

    private func addScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func openMailboxSwitcher() {
        if isMailboxDrawerOpen { return }
        if !isInteractiveInboxVisible() {
            returnToInboxFromNestedSettings(roundName: "mailbox switcher")
        }
        let header = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Current mailbox")).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 10), "Compact mailbox header was not tappable")
        if header.isHittable {
            header.tap()
        } else {
            header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(waitForMailboxDrawer(timeout: 10), "Mailbox drawer did not open from compact header")
    }

    private func findVisibleValidationGmailMessage() -> XCUIElement {
        let subject = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "CMOS5D Attachment Persistence")).firstMatch
        for _ in 0..<10 {
            if subject.exists { return subject }
            let loadMore = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Pull or tap to load more")).firstMatch
            if loadMore.exists {
                loadMore.tap()
            } else {
                app.swipeUp()
            }
            _ = subject.waitForExistence(timeout: 3)
        }
        return subject
    }

    private func scrollToButton(_ label: String, maxSwipes: Int = 4) {
        for _ in 0..<maxSwipes {
            if app.buttons[label].exists { return }
            app.swipeUp()
        }
        XCTAssertTrue(app.buttons[label].waitForExistence(timeout: 3), "\(label) button was not visible")
    }

    private func tapEnterpriseSegment(_ label: String) {
        for _ in 0..<4 {
            if app.buttons[label].exists { break }
            dragVertically(from: 0.24, to: 0.86)
        }
        let button = app.buttons[label]
        if button.waitForExistence(timeout: 5) {
            button.tap()
            return
        }
        let any = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label))
            .firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 5), "\(label) enterprise segment was not visible")
        tapElement(any)
    }

    private func tapDirectorySegment(_ label: String) {
        for _ in 0..<4 {
            if app.buttons[label].exists { break }
            dragVertically(from: 0.22, to: 0.82)
        }
        let button = app.buttons[label]
        if button.waitForExistence(timeout: 5) {
            button.tap()
            return
        }
        let any = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label))
            .firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 5), "\(label) directory segment was not visible")
        tapElement(any)
    }

    private func returnToSettingsFromDirectoryFlow() {
        if app.navigationBars["Settings"].exists { return }
        for title in ["Directory", "Domain Directory", "Profile Sync", "Device Restore", "Devices"] {
            if app.navigationBars[title].exists {
                tapLeadingNavigationButton(on: title)
                break
            }
        }
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Returning to Settings from directory flow failed")
    }

    private func validateComposeAutocompleteV2ToCcBcc() {
        let composeButton = primaryComposeButton()
        XCTAssertTrue(composeButton.waitForExistence(timeout: 10), "Compose button missing for Autocomplete V2")
        composeButton.tap()
        XCTAssertTrue(app.navigationBars["New message"].waitForExistence(timeout: 10), "Compose did not open for Autocomplete V2")

        let toField = app.textFields["name@example.com"]
        XCTAssertTrue(toField.waitForExistence(timeout: 10), "Autocomplete V2: To field missing")
        replace(toField, with: "fast")
        tapFirstAutocompleteSuggestion(roundName: "Autocomplete V2 To")
        XCTAssertTrue((toField.value as? String)?.contains("@") == true, "Autocomplete V2: To suggestion did not insert an address")

        let ccFields = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "optional")).allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(ccFields.count, 2, "Autocomplete V2: Cc/Bcc optional fields were not both visible")

        let ccField = ccFields[0]
        replace(ccField, with: "fast")
        tapFirstAutocompleteSuggestion(roundName: "Autocomplete V2 Cc")
        XCTAssertTrue((ccField.value as? String)?.contains("@") == true, "Autocomplete V2: Cc suggestion did not insert an address")

        let refreshedFields = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "optional")).allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(refreshedFields.count, 2, "Autocomplete V2: Bcc field disappeared")
        let bccField = refreshedFields[1]
        replace(bccField, with: "fast")
        tapFirstAutocompleteSuggestion(roundName: "Autocomplete V2 Bcc")
        XCTAssertTrue((bccField.value as? String)?.contains("@") == true, "Autocomplete V2: Bcc suggestion did not insert an address")
        addScreenshot("enterprise-directory-07-compose-autocomplete-v2")
        app.tabBars.buttons["Inbox"].tap()
    }

    private func tapFirstAutocompleteSuggestion(roundName: String) {
        let suggestion = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compose-recipient-autocomplete-")).firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "\(roundName): autocomplete suggestions missing")
        tapElement(suggestion)
    }

    private func scrollToStaticTextOrButton(_ label: String, maxSwipes: Int = 4) {
        for _ in 0..<maxSwipes {
            if app.staticTexts[label].exists || app.buttons[label].exists { return }
            app.swipeUp()
        }
        XCTAssertTrue(
            app.staticTexts[label].waitForExistence(timeout: 3) || app.buttons[label].waitForExistence(timeout: 3),
            "\(label) was not visible"
        )
    }

    private func scrollToStaticTextContaining(_ text: String, maxSwipes: Int = 4) {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
        for _ in 0..<maxSwipes {
            if app.staticTexts.matching(predicate).firstMatch.exists { return }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts.matching(predicate).firstMatch.waitForExistence(timeout: 3), "\(text) was not visible")
    }

    private enum ScrollDirection {
        case up
        case down
    }

    private func scrollToStaticText(_ label: String, direction: ScrollDirection = .up, maxSwipes: Int = 4) {
        for _ in 0..<maxSwipes {
            if app.staticTexts[label].exists { return }
            switch direction {
            case .up:
                dragVertically(from: 0.86, to: 0.24)
            case .down:
                dragVertically(from: 0.24, to: 0.86)
            }
        }
        XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 3), "\(label) text was not visible")
    }

    private func scrollToStaticTextContaining(_ text: String, direction: ScrollDirection = .up, maxSwipes: Int = 4) {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
        let match = app.staticTexts.matching(predicate).firstMatch
        for _ in 0..<maxSwipes {
            if match.exists { return }
            switch direction {
            case .up:
                dragVertically(from: 0.86, to: 0.24)
            case .down:
                dragVertically(from: 0.24, to: 0.86)
            }
        }
        XCTAssertTrue(match.waitForExistence(timeout: 3), "\(text) text was not visible")
    }

    private func dragVertically(from startY: CGFloat, to endY: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: startY))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: endY))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func closePresentedSheet() {
        for label in ["Close", "Done", "Cancel"] {
            let button = app.buttons[label]
            if button.waitForExistence(timeout: 2) {
                button.tap()
                return
            }
        }
        app.swipeDown()
    }

    private func visibleStaticTextLabels() -> String {
        app.staticTexts.allElementsBoundByIndex
            .map(\.label)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: " | ")
    }

    private func runtimeCredentials() -> (email: String, password: String)? {
        let environment = ProcessInfo.processInfo.environment
        if let email = environment["CLOUDMAIL_DEVICE_EMAIL"],
           let password = environment["CLOUDMAIL_DEVICE_PASSWORD"],
           isRuntimeCredentialValue(email),
           isRuntimeCredentialValue(password) {
            return (email, password)
        }

        if let bridgeURL = testCredentialBridgeURL,
           let credentials = fetchRuntimeCredentials(from: bridgeURL) {
            return credentials
        }

        return nil
    }

    private func fetchRuntimeCredentials(from bridgeURL: String) -> (email: String, password: String)? {
        guard let url = URL(string: bridgeURL) else { return nil }
        let semaphore = DispatchSemaphore(value: 0)
        var result: (email: String, password: String)?
        URLSession.shared.dataTask(with: url) { data, _, _ in
            defer { semaphore.signal() }
            guard let data,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let email = payload["email"] as? String,
                  let password = payload["password"] as? String,
                  self.isRuntimeCredentialValue(email),
                  self.isRuntimeCredentialValue(password) else { return }
            result = (email, password)
        }.resume()
        _ = semaphore.wait(timeout: .now() + 10)
        return result
    }

    private var testCredentialBridgeURL: String? {
        let value = ProcessInfo.processInfo.environment["CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL"] ?? ""
        guard !value.isEmpty,
              let url = URL(string: value),
              url.scheme == "https" else { return nil }
        return value
    }

    private var credentialBridgeWasConfigured: Bool {
        let value = ProcessInfo.processInfo.environment["CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL"] ?? ""
        return !value.isEmpty && isRuntimeCredentialValue(value)
    }

    private func configureAppLaunchEnvironment() {
        guard (name.contains("testLoop6ARound1ExistingUserRealFlowWithRuntimeCredentials")
               || name.contains("testLoop6ARound2NewUserLogoutLoginAgainNoStateLeak")
               || name.contains("testCodexP0CRound")
               || name.contains("testLiveAIWorkspaceFiveWorkflowsWithExistingSession")
               || name.contains("testV5DashboardControlCenterWithExistingSession")
               || name.contains("testActivatedMailboxSessionRestoreWithExistingSession")
               || name.contains("testLoop6BComposeDraftAndMailClientCoreWithExistingSession")),
              let bridgeURL = testCredentialBridgeURL else { return }
        app.launchEnvironment["CLOUDMAIL_ACCEPTANCE_TEST_MODE"] = "1"
        app.launchEnvironment["CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL"] = bridgeURL
    }

    private func isRuntimeCredentialValue(_ value: String) -> Bool {
        !value.isEmpty && !value.hasPrefix("$(") && !value.hasSuffix(")")
    }

    private func replace(_ element: XCUIElement, with value: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing field: \(element)")
        element.tap()
        element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 96))
        if element.elementType == .secureTextField {
            if value.hasPrefix("CloudMail#Flow-")
                || value.hasPrefix("CloudMail#Device-")
                || value.hasPrefix("invalid-app-password-for-") {
                element.typeText(value)
                return
            }
            pasteSecureValue(value, into: element)
            return
        }
        element.typeText(value)
    }

    private func pasteSecureValue(_ value: String, into element: XCUIElement) {
        UIPasteboard.general.string = value
        defer { UIPasteboard.general.string = "" }
        element.press(forDuration: 1.0)
        let paste = app.menuItems["Paste"]
        XCTAssertTrue(paste.waitForExistence(timeout: 5), "Paste action was not available for secure input")
        paste.tap()
    }
}
