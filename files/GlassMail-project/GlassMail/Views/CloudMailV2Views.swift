import SwiftUI

struct IdentityActivationView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var token: String
    @State private var password = ""
    @State private var confirmation = ""
    @State private var submitting = false
    @State private var message: String?

    init(initialToken: String) {
        _token = State(initialValue: initialToken)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Activate NEXORA") {
                    SecureField("Activation token", text: $token)
                    SecureField("New password", text: $password)
                    SecureField("Confirm password", text: $confirmation)
                }
                if let message {
                    Text(message).foregroundStyle(.secondary)
                }
                Button {
                    activate()
                } label: {
                    if submitting { ProgressView() }
                    else { Label("Activate account", systemImage: "checkmark.seal.fill") }
                }
                .disabled(token.isEmpty || password.count < 8 || password != confirmation || submitting)
            }
            .cloudMailCompactMenuSurface()
            .navigationTitle("Account Activation")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func activate() {
        submitting = true
        Task {
            do {
                try await app.activateIdentity(token: token, password: password)
                message = "Account activated."
                dismiss()
            } catch {
                guard !error.isCloudMailCancellation else { submitting = false; return }
                message = ProductSafeText.sanitize(error.localizedDescription, context: .general)
            }
            submitting = false
        }
    }
}

struct AIConsentCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var consent = AIConsent.default
    @State private var saving = false

    var body: some View {
        Form {
            Section("AI") {
                Toggle("Enable AI", isOn: $consent.aiEnabled)
                Toggle("Apple local AI", isOn: $consent.appleLocalEnabled)
                LabeledContent("AI architecture", value: "Apple Intelligence only")
                Text("NEXORA AI uses Apple Intelligence locally for supported mail actions.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Mail access") {
                Toggle("Read one message", isOn: $consent.singleMailRead)
                Toggle("Read threads", isOn: $consent.threadRead)
                Toggle("Read attachments", isOn: $consent.attachmentRead)
                Toggle("Build search index", isOn: $consent.searchIndex)
                Toggle("Save AI outputs", isOn: $consent.saveOutputs)
            }
            Section("Assistance") {
                Toggle("Automatic classification", isOn: $consent.autoClassify)
                Toggle("Cleanup suggestions", isOn: $consent.cleanupSuggestions)
            }
            Section("Actions requiring confirmation") {
                Toggle("Automatic send", isOn: $consent.autoSend)
                Toggle("Automatic archive", isOn: $consent.autoArchive)
                Toggle("Automatic delete", isOn: $consent.autoDelete)
                Toggle("Automatic unsubscribe", isOn: $consent.autoUnsubscribe)
            }
            Button {
                saving = true
                Task {
                    var localOnlyConsent = consent
                    localOnlyConsent.cloudAIEnabled = false
                    await app.saveAIConsent(localOnlyConsent)
                    saving = false
                }
            } label: {
                if saving { ProgressView() }
                else { Label("Save consent", systemImage: "checkmark.shield.fill") }
            }
            .disabled(saving)
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("AI Consent")
        .onAppear {
            consent = app.aiConsent
            consent.cloudAIEnabled = false
        }
    }
}

struct MailAccountsView: View {
    @EnvironmentObject private var app: AppState
    @State private var showingConnector = false
    @State private var showUnavailableProviders = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                CompactAccountPillView()
                accountCenterSummaryStrip
                accountCenterQuickActions
                accountDiagnosticsLaunchPanel
                gmailSummaryPanel
                unavailableProviderDisclosure
                connectedAccountsLedger
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cloudMailCompactMenuSurface()
        .background(AmbientBackground())
        .navigationTitle("Account Center")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            await app.loadV2Configuration()
            await app.refreshIfStale()
        }
        .sheet(isPresented: $showingConnector) {
            ExistingMailboxConnectionView()
                .environmentObject(app)
        }
    }

    private var accountCenterSummaryStrip: some View {
        HStack(spacing: 8) {
            accountCenterMetric("Accounts", "\(connectedRows.count)", .blue)
            accountCenterMetric("Connected", "\(connectedRows.filter { rowStatePriority($0) == 0 }.count)", .green)
            accountCenterMetric("Needs", "\(connectedRows.filter { rowStatePriority($0) == 1 }.count)", .orange)
        }
    }

    private func accountCenterMetric(_ title: String, _ value: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.monospacedDigit().weight(.bold))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var accountCenterQuickActions: some View {
        HStack(spacing: 8) {
            Button {
                showingConnector = true
            } label: {
                Label("Add Mailbox", systemImage: "person.badge.plus")
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                app.selectedMainTab = 1
            } label: {
                Label("AI Center", systemImage: "sparkles")
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var accountDiagnosticsLaunchPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Diagnostics", systemImage: "stethoscope")
                    .font(.caption.weight(.semibold))
                Spacer()
                StatusPill(text: "Restored", tint: .blue)
            }
            HStack(spacing: 8) {
                NavigationLink {
                    EnterpriseAccountDiagnosticsView()
                        .environmentObject(app)
                } label: {
                    Label("Advanced", systemImage: "slider.horizontal.3")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                NavigationLink {
                    AccountRecoveryCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Recovery", systemImage: "lifepreserver")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var gmailSummaryPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            GmailOwnershipSummaryView()
                .environmentObject(app)
            if !app.hasConnectedGmail {
                Button {
                    showingConnector = true
                } label: {
                    Label("Connect Gmail", systemImage: "link.badge.plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var unavailableProviderDisclosure: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(VisualSystemV3.Motion.disclosure) {
                    showUnavailableProviders.toggle()
                }
            } label: {
                HStack {
                    Label("Unavailable providers", systemImage: "slash.circle")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("2")
                        .font(.caption2.monospacedDigit().weight(.bold))
                        .foregroundStyle(.secondary)
                    Image(systemName: showUnavailableProviders ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if showUnavailableProviders {
                ProviderAvailabilityRow(provider: .outlook, state: "Unavailable", detail: "Outlook authorization is not configured.")
                ProviderAvailabilityRow(provider: .imap, state: "Unavailable", detail: "Generic IMAP setup is not enabled.")
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var connectedAccountsLedger: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Connected accounts")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(connectedRows.count)")
                    .font(.caption2.monospacedDigit().weight(.bold))
                    .foregroundStyle(.secondary)
            }
            if connectedRows.isEmpty {
                ContentUnavailableView("No connected mailboxes", systemImage: "tray", description: Text("Add an email address or domain to NEXORA to start receiving mail."))
            } else {
                ForEach(connectedRows) { row in
                    AccountTruthRow(row: row) {
                        Task { await app.setMailbox(accountId: row.accountId, provider: row.provider) }
                    } sync: {
                        if (row.provider == .gmail || row.provider == .googleWorkspace), let id = row.accountId {
                            Task { _ = await app.syncGmail(accountId: id) }
                        }
                    } remove: {
                        if let id = row.authorizationId {
                            Task { _ = await app.removeMailboxAuthorization(id: id) }
                        }
                    }
                }
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var connectedRows: [AccountTruthRow.Model] {
        var rows: [AccountTruthRow.Model] = app.addresses.map { account in
            AccountTruthRow.Model(
                id: "address-\(account.accountId)",
                provider: account.displayProvider,
                email: account.email,
                domain: account.displayDomain,
                state: account.statusLabel,
                detail: account.syncError?.isEmpty == false ? account.syncError! : syncDetail(for: account),
                accountId: account.accountId,
                authorizationId: nil
            )
        }
        let existingEmails = Set(rows.map { $0.email.lowercased() })
        rows.append(contentsOf: app.unifiedAccounts.filter { !existingEmails.contains($0.email.lowercased()) }.map { account in
            AccountTruthRow.Model(
                id: "unified-\(account.id)",
                provider: account.provider,
                email: account.email,
                domain: account.email.split(separator: "@").last.map(String.init) ?? app.domain,
                state: account.status == "active" ? "Connected" : account.status.capitalized,
                detail: account.isDelegatedMailbox ? (account.canSend ? "Delegated sending identity" : "Delegated mailbox") : (account.provider == .gmail || account.provider == .googleWorkspace ? "Connected through Google" : "Unified sending identity"),
                accountId: nil,
                authorizationId: account.authorizationId
            )
        })
        return rows.sorted { lhs, rhs in
            let leftPriority = rowStatePriority(lhs)
            let rightPriority = rowStatePriority(rhs)
            if leftPriority != rightPriority { return leftPriority < rightPriority }
            return lhs.email.localizedCaseInsensitiveCompare(rhs.email) == .orderedAscending
        }
    }

    private func rowStatePriority(_ row: AccountTruthRow.Model) -> Int {
        let state = row.state.lowercased()
        if state == "connected" || state == "active" || state == "available" { return 0 }
        if state.contains("error") || state.contains("blocked") { return 1 }
        return 2
    }

    private func syncDetail(for account: MailAddress) -> String {
        if let sync = app.gmailSyncStatusByAccountId[account.accountId] { return sync }
        let last = app.accountTimestampDisplayLabel(account.lastSyncedAt)
        if last != "Never synced" { return "Last sync: \(last)" }
        if account.displayProvider == .cloudflareNative { return "Routing active for \(account.displayDomain)" }
        return "Sync pending"
    }
}

struct GmailOwnershipSummaryView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        if let gmail = app.primaryGmailAccount {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: UnifiedMailProvider.gmail.symbol)
                        .foregroundStyle(Color.red)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(gmail.email)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text("\(gmail.displayDomain) · \(syncDetail(for: gmail))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    StatusPill(text: gmail.statusLabel, tint: statusTint(for: gmail))
                }
                Button {
                    Task { await app.setMailbox(accountId: gmail.accountId, provider: nil) }
                } label: {
                    Label("Open Gmail Inbox", systemImage: "tray.fill")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Label("Connect Gmail", systemImage: UnifiedMailProvider.gmail.symbol)
                    .font(.caption.weight(.semibold))
                Text("This NEXORA account has not authorized Gmail yet.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let user = app.currentUser?.email {
                    Text("Signed in as \(user)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func syncDetail(for account: MailAddress) -> String {
        if let sync = app.gmailSyncStatusByAccountId[account.accountId] { return sync }
        if let error = account.syncError, !error.isEmpty { return "Sync error: \(error)" }
        let last = app.accountTimestampDisplayLabel(account.lastSyncedAt)
        if last != "Never synced" { return "Last sync: \(last)" }
        return (account.displayProvider == .gmail || account.displayProvider == .googleWorkspace) ? "Connected; sync pending" : "Connected"
    }

    private func statusTint(for account: MailAddress) -> Color {
        if account.statusLabel.localizedCaseInsensitiveContains("error") { return .orange }
        if account.statusLabel.localizedCaseInsensitiveContains("blocked") { return .red }
        return .green
    }
}

struct AccountTruthRow: View {
    struct Model: Identifiable {
        let id: String
        let provider: UnifiedMailProvider
        let email: String
        let domain: String
        let state: String
        let detail: String
        let accountId: Int?
        let authorizationId: Int?
    }

    let row: Model
    var open: () -> Void
    var sync: () -> Void
    var remove: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            Image(systemName: row.provider.symbol)
                .font(.caption.weight(.bold))
                .frame(width: 22)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.email)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(row.provider.title) · \(row.domain)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(row.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            StatusPill(text: row.state, tint: statusTint)
            Menu {
                Button(action: open) {
                    Label("Open mailbox", systemImage: "tray.fill")
                }
                if row.provider == .gmail || row.provider == .googleWorkspace {
                    Button(action: sync) {
                        Label("Sync", systemImage: "arrow.clockwise")
                    }
                }
                if row.authorizationId != nil {
                    Button(role: .destructive, action: remove) {
                        Label("Remove", systemImage: "trash")
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var tint: Color {
        (row.provider == .gmail || row.provider == .googleWorkspace) ? .red : .blue
    }

    private var statusTint: Color {
        row.state.localizedCaseInsensitiveContains("error") ? .orange : .green
    }
}

struct ProviderAvailabilityRow: View {
    let provider: UnifiedMailProvider
    let state: String
    let detail: String

    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            Image(systemName: provider.symbol)
                .font(.caption.weight(.bold))
                .frame(width: 22)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(provider.title)
                    .font(.caption.weight(.semibold))
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            StatusPill(text: state, tint: .secondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct StatusPill: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .foregroundStyle(tint)
            .background(tint.opacity(0.14), in: Capsule())
    }
}

struct ExistingMailboxConnectionView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @FocusState private var focusedField: MailboxConnectionField?
    @State private var email = ""
    @State private var password = ""
    @State private var status: String?
    @State private var isWorking = false
    @State private var showingForgotPassword = false
    @State private var showingActivation = false
    @State private var gmailConnectionIssue: String?
    @State private var cloudMailState: CloudMailAddressState = .unchecked
    @State private var activationToken: String?
    @State private var selectedProvider: ExistingMailboxProvider?
    @State private var showProviderHelp = false
    @State private var showOAuthFailureDiagnostic = false
    @State private var showingSecureAuth = false
    @State private var secureAuthPassword = ""
    @State private var secureAuthPrincipalEmail = ""
    @State private var secureAuthTargetEmail = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Select Provider") {
                    providerGrid
                }

                Section("Email address") {
                    TextField(emailFieldTitle, text: $email)
                        .focused($focusedField, equals: .email)
                        .accessibilityIdentifier("you@example.com")
                        .accessibilityLabel("you@example.com")
                        .textContentType(.emailAddress)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        #endif
                }

                Section("Detected provider") {
                    Label(provider.title, systemImage: provider.symbol)
                    Text(provider.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let status {
                    Section {
                        Text(status)
                            .foregroundStyle(.secondary)
                    }
                }

                if ([.authRequired, .authFailed, .authExpired].contains(app.secureAuthState)
                    || (app.secureAuthState == .provisioningContinued && app.mailboxOnboardingState == .blocked)),
                   app.secureAuthEmail == normalizedEmail {
                    secureAuthRecoverySection
                }

                if app.mailboxOnboardingState != .idle {
                    mailboxOnboardingProgressSection
                }

                if provider == .cloudMail {
                    cloudMailConnectionSection
                } else if provider == .gmail {
                    gmailConnectionSection
        } else {
            unsupportedProviderSection
        }
            }
            .cloudMailCompactMenuSurface()
            .navigationTitle("Add mailbox")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .sheet(isPresented: $showingForgotPassword) {
                ForgotPasswordView(initialEmail: normalizedEmail)
                    .environmentObject(app)
            }
            .sheet(isPresented: $showingActivation) {
                IdentityActivationView(initialToken: activationToken ?? "")
                    .environmentObject(app)
            }
            .sheet(isPresented: $showProviderHelp) {
                NavigationStack {
                    List {
                        Section("Connection help") {
                            Text(provider.guidanceText)
                            Text("Retry with corrected details, choose another provider, or cancel safely. NEXORA will not switch your current profile.")
                        }
                    }
                    .cloudMailCompactMenuSurface()
                    .navigationTitle("Learn More")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showProviderHelp = false }
                        }
                    }
                }
            }
            .sheet(isPresented: $showOAuthFailureDiagnostic) {
                NavigationStack {
                    FriendlyOAuthFailureView(
                        email: normalizedEmail,
                        rawError: gmailConnectionIssue ?? "Google account access approval is required."
                    )
                    .environmentObject(app)
                }
            }
            .sheet(isPresented: $showingSecureAuth) {
                SecureAuthHandoffSheet(
                    principalEmail: $secureAuthPrincipalEmail,
                    targetEmail: secureAuthTargetEmail.isEmpty ? normalizedEmail : secureAuthTargetEmail,
                    providerMessage: app.secureAuthProviderMessage ?? "NEXORA authentication is required to continue mailbox provisioning.",
                    password: $secureAuthPassword,
                    state: app.secureAuthState,
                    onCancel: {
                        secureAuthPassword = ""
                        app.cancelSecureAuthHandoff()
                        showingSecureAuth = false
                    },
                    onContinue: {
                        let secret = secureAuthPassword
                        secureAuthPassword = ""
                        Task {
                            guard await app.authenticateSecurelyAndContinueProvisioning(
                                principalEmail: secureAuthPrincipalEmail,
                                secret: secret
                            ) != nil else { return }
                            showingSecureAuth = false
                            status = app.secureAuthOutcomeMessage
                        }
                    },
                    onExpired: {
                        secureAuthPassword = ""
                        showingSecureAuth = false
                    }
                )
                .environmentObject(app)
            }
            .onChange(of: email) { _, _ in
                gmailConnectionIssue = nil
                cloudMailState = .unchecked
                activationToken = nil
                password = ""
                status = nil
                if !normalizedEmail.isEmpty {
                    focusedField = .email
                }
            }
            .task(id: normalizedEmail) {
                await autoDiscoverCloudMailAddress(normalizedEmail)
            }
            .onAppear {
                focusedField = .email
            }
            .onChange(of: app.mailboxOnboardingState) { _, newValue in
                if provider == .gmail, newValue == .ready {
                    dismiss()
                }
            }
        }
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var secureAuthRecoverySection: some View {
        Section("Authentication required") {
            Label(
                app.secureAuthState == .authExpired
                    ? "Secure authentication expired"
                    : app.secureAuthState == .provisioningContinued
                        ? "Provisioning paused safely"
                        : "Provisioning is paused safely",
                systemImage: "lock.shield"
            )
            Text(app.secureAuthOutcomeMessage ?? "Resume when you are ready. No secret has been saved.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button(app.secureAuthState == .authExpired
                ? "Start secure authentication again"
                : app.secureAuthState == .provisioningContinued
                    ? "Resume provisioning"
                    : "Resume") {
                secureAuthPassword = ""
                if app.secureAuthState == .provisioningContinued {
                    Task {
                        _ = await app.resumeProvisioningAfterAuthentication()
                        status = app.secureAuthOutcomeMessage
                    }
                    return
                }
                if app.resumeSecureAuthHandoff() {
                    secureAuthPrincipalEmail = app.secureAuthPrincipalEmail
                    showingSecureAuth = true
                } else {
                    Task {
                        let target = secureAuthTargetEmail.isEmpty ? normalizedEmail : secureAuthTargetEmail
                        if await app.beginSecureAuthHandoff(
                            email: target,
                            principalEmail: secureAuthPrincipalEmail.isEmpty ? nil : secureAuthPrincipalEmail,
                            provider: provider.title,
                            providerMessage: "Authentication is required before mailbox provisioning can continue."
                        ) {
                            secureAuthPrincipalEmail = app.secureAuthPrincipalEmail
                            showingSecureAuth = true
                        }
                    }
                }
            }
            .accessibilityIdentifier("Resume secure authentication")
        }
    }

    private var provider: ExistingMailboxProvider {
        selectedProvider ?? ExistingMailboxProvider(email: normalizedEmail, managedDomain: app.domain)
    }

    private var emailFieldTitle: String {
        switch provider {
        case .cloudMail: return "NEXORA Address"
        case .gmail: return "Gmail Address"
        case .outlook: return "Outlook Address"
        case .yahoo: return "Yahoo Address"
        case .iCloud, .imap: return "Email Address"
        }
    }

    private var providerGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            ForEach(ExistingMailboxProvider.frozenProviders, id: \.self) { option in
                providerGridButton(option)
            }
        }
    }

    private var mailboxOnboardingProgressSection: some View {
        Section("Connection progress") {
            HStack(spacing: 10) {
                if app.mailboxOnboardingState == .authorizing
                    || app.mailboxOnboardingState == .creatingMailbox
                    || app.mailboxOnboardingState == .syncingMailbox
                    || app.mailboxOnboardingState == .loadingMessages {
                    ProgressView()
                } else {
                    Image(systemName: app.mailboxOnboardingState == .ready ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .foregroundStyle(app.mailboxOnboardingState == .ready ? .green : .orange)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(app.mailboxOnboardingState.rawValue)
                        .font(.subheadline.weight(.semibold))
                    if let message = app.mailboxOnboardingMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .accessibilityIdentifier("Mailbox onboarding progress")
        }
    }

    @ViewBuilder
    private func providerGridButton(_ option: ExistingMailboxProvider) -> some View {
        let button = Button {
            selectedProvider = option
            email = ""
            password = ""
            status = nil
            gmailConnectionIssue = nil
            cloudMailState = .unchecked
        } label: {
            VStack(spacing: 8) {
                Image(systemName: option.symbol)
                    .font(.title3.weight(.semibold))
                Text(option.title)
                    .font(.caption.weight(.semibold))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
        }

        if selectedProvider == option {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private var connectedGmailMailbox: MailAddress? {
        guard provider == .gmail, !normalizedEmail.isEmpty else { return nil }
        return app.addresses.first {
            ($0.displayProvider == .gmail || $0.displayProvider == .googleWorkspace) && $0.email.caseInsensitiveCompare(normalizedEmail) == .orderedSame
        }
    }

    private var connectedCloudMailMailbox: MailAddress? {
        guard provider == .cloudMail, !normalizedEmail.isEmpty else { return nil }
        return app.addresses.first {
            $0.displayProvider == .cloudflareNative && $0.email.caseInsensitiveCompare(normalizedEmail) == .orderedSame
        }
    }

    private var openCurrentCloudMailButton: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                if let mailbox = connectedCloudMailMailbox {
                    openConnectedMailbox(mailbox)
                } else {
                    Task { await app.selectPrimaryCloudMailOrMerged() }
                    dismiss()
                }
            } label: {
                Text("Open this mailbox")
            }
            .accessibilityIdentifier("Open this mailbox")
            .accessibilityLabel("Open this mailbox")
            Text("This active NEXORA identity is already available in the current session.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var cloudMailConnectionSection: some View {
        Section("NEXORA address") {
            if normalizedEmail.isEmpty {
                Label("Enter an email address", systemImage: "person.text.rectangle")
                    .foregroundStyle(.secondary)
                Text("NEXORA discovers the mailbox provider and requests sign-in or activation only when required.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                switch cloudMailState {
                case .unchecked:
                    Label(isWorking ? "Discovering domain and mailbox..." : "Continue with discovery", systemImage: "magnifyingglass")
                    Text("NEXORA discovers domain, authority, identity, and mailbox state before choosing the next action.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        connect()
                    } label: {
                        if isWorking {
                            ProgressView()
                        } else {
                            Label("Continue", systemImage: "arrow.right.circle.fill")
                        }
                    }
                    .disabled(isWorking)
                case .ownedByCurrentAccount:
                    Label("Already in this NEXORA account", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Button {
                        if let mailbox = connectedCloudMailMailbox {
                            openConnectedMailbox(mailbox)
                        } else {
                            Task { await app.selectPrimaryCloudMailOrMerged() }
                            dismiss()
                        }
                    } label: {
                        Text("Open this mailbox")
                    }
                    .accessibilityIdentifier("Open this mailbox")
                    .accessibilityLabel("Open this mailbox")
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Mailbox")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(normalizedEmail)
                            .font(.body.weight(.semibold))
                            .textSelection(.enabled)
                    }
                    Text("This address is available in the current signed-in NEXORA account. Opening it will not change your login session.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                case .active:
                    Label("Secure authentication required", systemImage: "lock.shield.fill")
                        .foregroundStyle(.blue)
                    Text("Authentication is completed only in the secure NEXORA sheet. Provisioning resumes automatically afterward.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Resume secure authentication") {
                        Task { await presentSecureAuthForActiveMailbox(normalizedEmail) }
                    }
                    .accessibilityIdentifier("Resume secure authentication")
                case .activationAvailable:
                    Label("Secure activation required", systemImage: "lock.shield.fill")
                        .foregroundStyle(.blue)
                    Text("Continue in the secure NEXORA sheet. No activation secret is exposed on this screen.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Resume secure authentication") {
                        Task { await presentSecureAuthForActiveMailbox(normalizedEmail) }
                    }
                    .accessibilityIdentifier("Resume secure authentication")
                case .authorityRequired:
                    Label("Domain authority required", systemImage: "shield.lefthalf.filled")
                        .foregroundStyle(.orange)
                    Text(status ?? "The domain was discovered, but its mail authority must be connected before a mailbox can be activated.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                case .unavailable:
                    Label("Not available", systemImage: "xmark.circle")
                        .foregroundStyle(.secondary)
                    Text(status ?? "This address is not available in NEXORA.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var gmailConnectionSection: some View {
        if normalizedEmail.isEmpty {
            Section("Gmail mailbox") {
                Label("Checking Gmail connection...", systemImage: "hourglass")
                    .foregroundStyle(.secondary)
                Text("Enter a Gmail address to see whether it belongs to this NEXORA account.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if let connected = connectedGmailMailbox {
            Section("Gmail mailbox") {
                if connected.syncStatus == "needs_reconnect" || connected.syncStatus == "legacy_imap_unsupported" {
                    Label("Existing Mailbox Found", systemImage: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                    Text("Reconnect Required")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Button {
                        Task {
                            if let url = await app.startGoogleMailboxOAuth(email: connected.email, accountId: connected.accountId) {
                                openURL(url)
                            }
                        }
                    } label: {
                        Label("Reconnect with Google OAuth", systemImage: "link")
                    }
                } else if connected.syncStatus == "mailbox_ready" || connected.syncStatus == "connected" {
                    Label("Already Connected", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Mailbox Ready")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Button {
                        openConnectedMailbox(connected)
                    } label: {
                        Label("Open Gmail Inbox", systemImage: "tray.fill")
                    }
                } else if connected.syncStatus == "blocked" {
                    Label("Provider Blocked", systemImage: "xmark.octagon.fill")
                        .foregroundStyle(.red)
                    Text("This mailbox is blocked by security or project policies.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Label("Google OAuth Required", systemImage: "link.badge.plus")
                        .foregroundStyle(.blue)
                    Text("NEXORA Governance: Auto Approved")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Button {
                        Task {
                            if let url = await app.startGoogleMailboxOAuth(email: connected.email, accountId: connected.accountId) {
                                openURL(url)
                            }
                        }
                    } label: {
                        Label("Continue with Google OAuth", systemImage: "link")
                    }
                }
            }
        } else if let issue = gmailConnectionIssue {
            Section("Gmail mailbox") {
                Label("Google OAuth blocked", systemImage: "exclamationmark.octagon")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Gmail mailbox")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(normalizedEmail)
                        .font(.body.weight(.semibold))
                        .textSelection(.enabled)
                }
                Text(issue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("NEXORA Governance: Auto Approved. Google OAuth: Blocked. Mailbox: Not Ready.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    connect()
                } label: {
                    Label("Retry Google Login", systemImage: "link")
                }
                Button {
                    showOAuthFailureDiagnostic = true
                } label: {
                    Label("Open Diagnostic Page", systemImage: "stethoscope")
                }
                Button {
                    gmailConnectionIssue = nil
                    password = ""
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                Button {
                    Task { await app.selectPrimaryCloudMailOrMerged() }
                    dismiss()
                } label: {
                    Label("Use current NEXORA account", systemImage: "tray.fill")
                }
            }
        } else {
            Section("Gmail mailbox") {
                Button {
                    connect()
                } label: {
                    if isWorking {
                        ProgressView()
                    } else {
                        Label("Connect Gmail with Google", systemImage: "link.badge.plus")
                    }
                }
                .disabled(isWorking)
                if let user = app.currentUser?.email {
                    LabeledContent("NEXORA account", value: user)
                }
                LabeledContent("Gmail mailbox", value: normalizedEmail)
                Text("Google sign-in authorizes Gmail mailbox access only. NEXORA AI remains local through Apple Intelligence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("After Google confirms access, NEXORA returns here, creates the mailbox, syncs Gmail, and opens Inbox automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                NavigationLink {
                    OAuthDiagnosticsCenterView(prefilledEmail: normalizedEmail)
                        .environmentObject(app)
                } label: {
                    Label("Check OAuth eligibility", systemImage: "checkmark.shield")
                }
            }
        }
    }

    @ViewBuilder
    private var unsupportedProviderSection: some View {
        Section("Mailbox provider") {
                Label("\(provider.title) not available", systemImage: provider.symbol)
                .foregroundStyle(.secondary)
            Text(provider.authorizationMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Add an email address or domain; NEXORA will discover the supported connection path.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                password = ""
                status = nil
                gmailConnectionIssue = nil
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
            }
            Button {
                showProviderHelp = true
            } label: {
                Label("Learn More", systemImage: "questionmark.circle")
            }
            Button(role: .cancel) {
                dismiss()
            } label: {
                Label("Cancel", systemImage: "xmark")
            }
        }
    }

    private func gmailSyncDetail(_ mailbox: MailAddress) -> String {
        if let sync = app.gmailSyncStatusByAccountId[mailbox.accountId] { return sync }
        if let error = mailbox.syncError, !error.isEmpty { return "Sync error: \(error)" }
        let last = app.accountTimestampDisplayLabel(mailbox.lastSyncedAt)
        if last != "Never synced" { return "Last sync: \(last)" }
        return "Connected; sync time not reported"
    }

    private func autoDiscoverCloudMailAddress(_ email: String) async {
        guard provider == .cloudMail,
              cloudMailState == .unchecked,
              isCompleteEmail(email),
              !isWorking else { return }
        if connectedCloudMailMailbox != nil {
            cloudMailState = .ownedByCurrentAccount
            status = "This mailbox already belongs to the signed-in NEXORA account."
            return
        }
        try? await Task.sleep(for: .milliseconds(650))
        guard email == normalizedEmail,
              provider == .cloudMail,
              cloudMailState == .unchecked,
              !isWorking else { return }
        if connectedCloudMailMailbox != nil {
            cloudMailState = .ownedByCurrentAccount
            status = "This mailbox already belongs to the signed-in NEXORA account."
            return
        }
        await discoverCloudMailAddress(email)
    }

    private func discoverCloudMailAddress(_ email: String) async {
        isWorking = true
        status = nil
        defer { isWorking = false }
        do {
            let discovery = try await app.discoverIdentity(email: email)
            applyCloudMailDiscovery(discovery, email: email)
        } catch {
            guard !error.isCloudMailCancellation else { return }
            if (error as? APIError)?.code == 401 {
                secureAuthTargetEmail = email
                if await app.beginSecureAuthHandoff(
                    email: email,
                    principalEmail: app.currentUser?.email,
                    provider: provider.title,
                    providerMessage: "Your NEXORA session expired. Authenticate securely in this iPhone sheet to resume provisioning."
                ) {
                    secureAuthPrincipalEmail = app.secureAuthPrincipalEmail
                    showingSecureAuth = true
                }
                return
            }
            cloudMailState = .unchecked
            status = ProductSafeText.sanitize((error as? APIError)?.userMessage ?? error.localizedDescription, context: .general)
        }
    }

    private func applyCloudMailDiscovery(_ discovery: EmailDiscoveryResponse, email: String) {
        switch discovery.discoveryState ?? discovery.recommendedAction {
        case "login":
            cloudMailState = .active
            status = "Authentication required. Continue securely in NEXORA."
            Task { await presentSecureAuthForActiveMailbox(email) }
        case "MAILBOX_ACTIVE":
            cloudMailState = .active
            status = "Authentication required. Continue securely in NEXORA."
            Task { await presentSecureAuthForActiveMailbox(email) }
        case "DOMAIN_READY", "IDENTITY_FOUND", "MAILBOX_ACTIVATABLE", "create_pending_user", "set_password", "activate_from_catch_all":
            cloudMailState = .activationAvailable
            status = "Domain and authority discovered. Secure authentication is required before provisioning continues."
            Task { await presentSecureAuthForActiveMailbox(email) }
        case "AUTHORITY_REQUIRED", "DOMAIN_FOUND":
            cloudMailState = .authorityRequired
            let domain = discovery.domain ?? "found"
            let identity = discovery.identityState ?? "pending"
            let mailbox = discovery.mailboxState ?? "discovery required"
            let authority = discovery.authorityState ?? "required"
            let nextAction = discovery.nextAction ?? "continue domain authority setup"
            status = "Domain Status: \(domain) · Identity Status: \(identity) · Mailbox Status: \(mailbox) · Authority Status: \(authority) · Next Action: \(nextAction)"
        case "IDENTITY_PENDING", "not_found":
            cloudMailState = .authorityRequired
            let domain = discovery.domain ?? "found"
            let identity = discovery.identityState ?? "pending"
            let mailbox = discovery.mailboxState ?? "discovery required"
            let authority = discovery.authorityState ?? "required"
            let nextAction = discovery.nextAction ?? "continue discovery"
            status = "Domain Status: \(domain) · Identity Status: \(identity) · Mailbox Status: \(mailbox) · Authority Status: \(authority) · Next Action: \(nextAction)"
        default:
            cloudMailState = .authorityRequired
            let domain = discovery.domain ?? "unknown"
            let provider = discovery.provider ?? "custom"
            let nextAction = discovery.nextAction ?? discovery.message ?? "continue discovery"
            status = "Domain Status: \(domain) · Provider: \(provider) · Next Action: \(nextAction)"
        }
    }

    @MainActor
    private func presentSecureAuthForActiveMailbox(_ email: String) async {
        guard !showingSecureAuth, app.secureAuthState != .authInProgress else { return }
        secureAuthTargetEmail = email
        if await app.beginSecureAuthHandoff(
            email: email,
            principalEmail: app.currentUser?.email ?? email,
            provider: provider.title,
            providerMessage: "Authenticate this mailbox securely on your iPhone. NEXORA will resume provisioning automatically."
        ) {
            secureAuthPrincipalEmail = app.secureAuthPrincipalEmail
            showingSecureAuth = true
        }
    }

    private func connect() {
        isWorking = true
        status = nil
        Task {
            defer { isWorking = false }
            guard provider == .cloudMail else {
                if provider == .gmail {
                    if let connected = connectedGmailMailbox {
                        await app.setMailbox(accountId: connected.accountId, provider: nil)
                        dismiss()
                        return
                    }
                    if let url = await app.startGoogleMailboxOAuth(email: normalizedEmail) {
                        openURL(url)
                        status = "Continue in Google. NEXORA will reopen and refresh Inbox automatically."
                    } else {
                        gmailConnectionIssue = gmailConnectStatus(app.errorMessage)
                        app.errorMessage = nil
                        status = nil
                    }
                    return
                }
                status = provider.authorizationMessage
                return
            }
            do {
                if let mailbox = connectedCloudMailMailbox {
                    openConnectedMailbox(mailbox)
                    return
                }
                let discovery = try await app.discoverIdentity(email: normalizedEmail)
                applyCloudMailDiscovery(discovery, email: normalizedEmail)
            } catch {
                guard !error.isCloudMailCancellation else { return }
                cloudMailState = .unchecked
                status = ProductSafeText.sanitize((error as? APIError)?.userMessage ?? error.localizedDescription, context: .general)
            }
        }
    }

    private func openConnectedMailbox(_ mailbox: MailAddress) {
        Task {
            await app.setMailbox(accountId: mailbox.accountId, provider: nil)
            dismiss()
        }
    }

    private func gmailConnectStatus(_ message: String?) -> String {
        let text = message ?? "Gmail connection failed."
        if isGmailOwnershipConflict(text) {
            return "This Gmail mailbox is already attached to a NEXORA account. Sign in to the account that owns it, ask a workspace admin to disconnect or reassign it, or use a different Gmail mailbox. NEXORA cannot reassign it from this screen."
        }
        let lower = text.lowercased()
        if lower.contains("tester_restriction") || lower.contains("tester restriction") {
            return "Google Tester Restriction"
        }
        if lower.contains("oauth_testing_restriction") || lower.contains("oauth testing restriction") {
            return "OAuth Testing Restriction"
        }
        if lower.contains("project_restriction") || lower.contains("project restriction") {
            return "Google Project Restriction"
        }
        if lower.contains("provider_blocked") || lower.contains("provider blocked") {
            return "Provider Blocked"
        }
        return text
    }

    private func isGmailOwnershipConflict(_ message: String?) -> Bool {
        let text = message ?? ""
        let lowercased = text.lowercased()
        return lowercased.contains("unique constraint")
            || lowercased.contains("sqlite_constraint")
            || lowercased.contains("already exists")
            || lowercased.contains("account.email")
            || lowercased.contains("already connected")
    }

    private func isCompleteEmail(_ value: String) -> Bool {
        let parts = value.split(separator: "@", maxSplits: 1)
        guard parts.count == 2 else { return false }
        return !parts[0].isEmpty && parts[1].contains(".")
    }

}

private enum MailboxConnectionField {
    case email
    case password
}

private struct SecureAuthHandoffSheet: View {
    @EnvironmentObject private var app: AppState
    @Binding var principalEmail: String
    let targetEmail: String
    let providerMessage: String
    @Binding var password: String
    let state: AppState.SecureAuthHandoffState
    let onCancel: () -> Void
    let onContinue: () -> Void
    let onExpired: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Authentication required") {
                    Label("Secure in-app authentication", systemImage: "lock.shield.fill")
                        .foregroundStyle(.blue)
                    Text(providerMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField("Email", text: $principalEmail)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(app.secureAuthPrincipalLocked)
                        .accessibilityIdentifier("Secure authentication email")
                    LabeledContent("Provisioning", value: targetEmail)
                }
                Section("Password") {
                    SecureField("Enter password securely on iPhone", text: $password)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .privacySensitive()
                        .accessibilityIdentifier("Secure authentication input")
                    Text("Your input stays in this secure iPhone flow. NEXORA does not attach it to logs, analytics, reports, or chat.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button {
                        onContinue()
                    } label: {
                        if state == .authInProgress {
                            ProgressView()
                        } else {
                            Label("Continue securely", systemImage: "arrow.right.circle.fill")
                        }
                    }
                    .disabled(password.isEmpty || principalEmail.isEmpty || state == .authInProgress)
                    Button("Cancel", role: .cancel, action: onCancel)
                }
            }
            .navigationTitle("Secure sign in")
            .cloudMailCompactMenuSurface()
            .interactiveDismissDisabled(state == .authInProgress)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    guard !Task.isCancelled else { return }
                    app.expireSecureAuthIfNeeded()
                    if app.secureAuthState == .authExpired {
                        onExpired()
                        return
                    }
                }
            }
        }
    }
}

private enum CloudMailAddressState {
    case unchecked
    case ownedByCurrentAccount
    case active
    case activationAvailable
    case authorityRequired
    case unavailable
}

private enum ExistingMailboxProvider: Equatable {
    case cloudMail
    case gmail
    case outlook
    case yahoo
    case iCloud
    case imap

    init(email: String, managedDomain: String) {
        let domain = email.split(separator: "@", maxSplits: 1).last.map(String.init) ?? ""
        switch domain.lowercased() {
        case managedDomain.lowercased(): self = .cloudMail
        case "gmail.com", "googlemail.com": self = .gmail
        case "outlook.com", "hotmail.com", "live.com", "microsoft.com": self = .outlook
        case "yahoo.com", "ymail.com", "rocketmail.com": self = .yahoo
        case "icloud.com", "me.com", "mac.com": self = .iCloud
        // Custom domains start with discovery instead of being rejected as
        // an unsupported generic IMAP address.
        default: self = .cloudMail
        }
    }

    static let frozenProviders: [ExistingMailboxProvider] = [.cloudMail, .gmail, .outlook, .yahoo]

    var title: String {
        switch self {
        case .cloudMail: return "NEXORA Mail"
        case .gmail: return "Gmail"
        case .outlook: return "Microsoft Outlook"
        case .yahoo: return "Yahoo Mail"
        case .iCloud: return "iCloud Mail"
        case .imap: return "IMAP mailbox"
        }
    }

    var symbol: String {
        switch self {
        case .cloudMail: return "cloud.fill"
        case .gmail: return "envelope.fill"
        case .outlook: return "building.2.fill"
        case .yahoo: return "y.circle.fill"
        case .iCloud: return "icloud.fill"
        case .imap: return "server.rack"
        }
    }

    var detail: String {
        switch self {
        case .cloudMail: return "Custom domains are discovered first; authority and mailbox activation follow automatically."
        case .gmail: return "Connects with Google sign-in for Gmail mailbox access. NEXORA AI remains local."
        case .outlook: return "Microsoft Outlook is not available in this NEXORA build."
        case .yahoo: return "Yahoo Mail is not available in this NEXORA build."
        case .iCloud: return "iCloud Mail is not available in this NEXORA build."
        case .imap: return "Generic IMAP is not enabled in this build; NEXORA will not ask for an IMAP password or app password here."
        }
    }

    var authorizationMessage: String {
        switch self {
        case .gmail:
            return "Continue with Google to connect Gmail mailbox access."
        case .outlook:
            return "Outlook authorization is not configured. No Microsoft sign-in is offered."
        case .yahoo:
            return "Yahoo authorization is not configured. No Yahoo password is requested."
        case .iCloud:
            return "iCloud authorization is not configured. No app-specific password is requested."
        case .imap:
            return "Generic IMAP discovery is not configured. No IMAP password or app password is requested in this build."
        case .cloudMail:
            return ""
        }
    }

    var guidanceText: String {
        switch self {
        case .cloudMail:
            return "Enter credentials for the target NEXORA address. This grants delegated access without changing your app login session."
        case .gmail:
            return "Google sign-in grants mailbox access and NEXORA keeps only encrypted backend token references."
        case .outlook:
            return "Outlook sign-in is not available in this build."
        case .yahoo:
            return "Yahoo support is planned for a future provider setup and is not enabled in this build."
        case .iCloud:
            return "iCloud Mail provider connection is not enabled in this build."
        case .imap:
            return "Generic IMAP provider discovery is not enabled. If a provider requires an app password, NEXORA will show a dedicated supported flow before requesting it."
        }
    }

    var isAuthorizationAvailable: Bool {
        self == .cloudMail || self == .gmail
    }
}

struct AIMailAssistantView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var request = ""
    @State private var response = ""
    @State private var running = false

    var body: some View {
        Form {
            Section("Request") {
                TextField("Search, summarize, classify, extract tasks, or suggest cleanup", text: $request,
                          axis: .vertical)
                    .lineLimit(3...7)
                Button {
                    run()
                } label: {
                    if running { ProgressView() }
                    else { Label("Run assistant", systemImage: "sparkles") }
                }
                .disabled(request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || running)
            }
            if !response.isEmpty {
                Section("Result") {
                    Text(response).textSelection(.enabled)
                    if let execution = app.lastTextAIExecution {
                        AIExecutionView(metadata: execution)
                    }
                }
            }
            Section("Quick actions") {
                Button("Summarize visible mail") {
                    request = "Summarize the visible inbox and identify the most important messages."
                    run()
                }
                Button("Extract tasks") {
                    request = "Extract concrete tasks, deadlines, owners, and follow-ups from the visible inbox."
                    run()
                }
                Button("Suggest cleanup") {
                    request = "Suggest a conservative inbox cleanup plan. Do not delete, archive, or unsubscribe."
                    run()
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("AI Mail Assistant")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func run() {
        let context = app.emails.prefix(30).map {
            "From: \($0.fromName)\nSubject: \($0.displaySubject)\nBody: \(String($0.lightweightBodySnippet(maxCharacters: 1_200).prefix(1200)))"
        }.joined(separator: "\n\n---\n\n")
        running = true
        Task {
            if let result = await app.aiCompleteLocal(
                instructions: "You are NEXORA's privacy-first mail assistant. Be factual and concise. Never claim an action was performed. Any send, archive, delete, or unsubscribe action requires explicit user confirmation.",
                prompt: "\(request)\n\nVisible inbox:\n\(context)"
            ) {
                response = ProductSafeText.sanitize(result.text, context: .ai)
            } else {
                response = ""
            }
            running = false
        }
    }
}

// MARK: - Enterprise Account Diagnostics

struct EnterpriseAccountDiagnosticsView: View {
    @EnvironmentObject private var app: AppState
    @State private var remoteRequests: [GoogleTestUserRequest] = []
    @State private var loading = false
    @State private var loadMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                diagnosticsHeader
                accountDiagnosticsList
                syncDiagnosticsCard
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(AmbientBackground())
        .navigationTitle("Diagnostics")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    private var diagnosticsHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Account Diagnostics", systemImage: "stethoscope")
                    .font(.headline.weight(.semibold))
                Spacer()
                StatusPill(text: loading ? "Checking" : "Ready", tint: loading ? .orange : .green)
            }
            Text("Provider, health, sync, access governance, capability, and recovery state are shown in one place.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Diagnostics V6 separates Governance Status, Provider Status, Capability Status, Mailbox Status, Sync Status, Freshness, Last Provider Sync, Last Successful Import, Newest Provider Message, Failure Reason, Recovery Guidance, and Truth Source. NEXORA governance status never implies provider enrollment.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let loadMessage {
                DiagnosticNotice(text: loadMessage, tint: .orange)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }



    private var accountDiagnosticsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Accounts")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(diagnosticAccounts.count)")
                    .font(.caption2.monospacedDigit().weight(.bold))
                    .foregroundStyle(.secondary)
            }
            if diagnosticAccounts.isEmpty {
                ContentUnavailableView("No accounts loaded", systemImage: "person.crop.circle.badge.exclamationmark", description: Text("Sign in and refresh Account Center to load account diagnostics."))
            } else {
                ForEach(diagnosticAccounts) { account in
                    AccountDiagnosticRow(model: account)
                }
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var syncDiagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Sync Diagnostics", systemImage: "arrow.triangle.2.circlepath")
                .font(.subheadline.weight(.semibold))
            DiagnosticGrid(items: [
                ("Last Sync", app.syncObservabilitySnapshot.lastSuccessfulSync),
                ("Next Sync", app.syncObservabilitySnapshot.retryCountdown),
                ("Messages Synced", "\(app.emails.count) visible"),
                ("Retry Count", "\(app.duplicateRefreshSkipped) duplicate skips"),
                ("Failure Count", app.syncObservabilitySnapshot.lastFailedSync),
                ("Failure Reason", app.syncObservabilitySnapshot.lastError)
            ])
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var diagnosticAccounts: [AccountDiagnosticModel] {
        var rows = app.addresses.map { AccountDiagnosticModel(address: $0, app: app, remoteRequests: remoteRequests) }
        let existing = Set(rows.map { $0.email.lowercased() })
        rows.append(contentsOf: app.unifiedAccounts.filter { !existing.contains($0.email.lowercased()) }.map {
            AccountDiagnosticModel(unified: $0, app: app, remoteRequests: remoteRequests)
        })
        return rows.sorted { $0.email.localizedCaseInsensitiveCompare($1.email) == .orderedAscending }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        await app.loadV2Configuration()
        do {
            remoteRequests = try await app.backendGoogleTestUserRequests(status: nil)
            loadMessage = nil
        } catch {
            remoteRequests = []
            loadMessage = "Google tester ledger could not be loaded. Local diagnostics remain visible."
        }
    }
}

struct OAuthDiagnosticsCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var email: String
    @State private var remoteRequests: [GoogleTestUserRequest] = []
    @State private var message: String?

    init(prefilledEmail: String = "") {
        _email = State(initialValue: prefilledEmail)
    }

    var body: some View {
        Form {
            Section("Google account") {
                TextField("gmail@example.com", text: $email)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
            }

            Section("Access Status") {
                LabeledContent("Provider", value: "Google")
                LabeledContent("Access Environment", value: "Production")
                LabeledContent("Governance Status", value: "Auto Approved")
                LabeledContent("Login Status", value: providerEvidenceVerified ? "Connected" : "Not started")
            }

            Section("Recovery Guidance") {
                FriendlyOAuthFailureSummary(email: normalizedEmail, testerStatus: .testerApproved)
                NavigationLink {
                    AccountRecoveryCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Open Recovery Center", systemImage: "lifepreserver")
                }
            }

            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("OAuth Diagnostics")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var providerEvidenceVerified: Bool {
        remoteRequests.first { $0.gmail.lowercased() == normalizedEmail }.map {
            $0.oauthSuccessTime?.isEmpty == false || $0.firstSyncCompleted?.isEmpty == false
        } ?? false
    }

    private func load() async {
        do {
            remoteRequests = try await app.backendGoogleTestUserRequests(status: nil)
            message = nil
        } catch {
            remoteRequests = []
            message = "Remote diagnostics data unavailable."
        }
    }
}

struct OAuthApprovalCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var dashboard: GoogleTestUserDashboard?
    @State private var remoteRequests: [GoogleTestUserRequest] = []
    @State private var selectedStatus: ApprovalFilter = .pending
    @State private var search = ""
    @State private var message: String?
    @State private var loading = false
    @State private var expandedCoverage = false
    @State private var expandedAutoApproved = false
    @State private var expandedGoogleOAuthBlocked = false
    @State private var expandedOAuthSuccess = false
    @State private var expandedPending = false
    @State private var expandedApproved = false
    @State private var expandedRejected = false
    @State private var expandedExpired = false

    var body: some View {
        List {
            Section("Overview") {
                if let dashboard {
                    DiagnosticGrid(items: [
                        ("Pending Requests", "\(dashboard.pendingRequests)"),
                        ("Approved Requests", "\(dashboard.approvedRequests)"),
                        ("Rejected Requests", "\(dashboard.rejectedRequests)"),
                        ("New Today", "\(dashboard.newToday)"),
                        ("OAuth Success", "\(dashboard.oauthSuccess)"),
                        ("OAuth Failures", "\(dashboard.oauthFailures)")
                    ])
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                } else {
                    Label(loading ? "Loading approval ledger" : "Approval ledger unavailable", systemImage: loading ? "hourglass" : "exclamationmark.triangle")
                }
                Text("Approval here records NEXORA tester workflow status. It does not claim Google Console tester writeback.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                DisclosureGroup(isExpanded: $expandedCoverage) {
                    ForEach(oauthProviderRows) { row in
                        OAuthProviderCoverageRow(row: row)
                    }
                    Text("Non-Google providers are retained in the OAuth Center as enterprise provider slots. They are not marked usable until their official authorization runtime and smoke evidence exist.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } label: {
                    Label("Provider Coverage", systemImage: "shield.lefthalf.filled")
                }
            }

            Section("Filters") {
                Picker("Request status", selection: $selectedStatus) {
                    ForEach(ApprovalFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                TextField("Search email", text: $search)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
            }

            Section {
                collapsibleRequestRows(title: "Auto Approved Gmail", status: .autoApproved, expanded: $expandedAutoApproved)
            }
            Section {
                collapsibleRequestRows(title: "Google OAuth Blocked", status: .googleOAuthBlocked, expanded: $expandedGoogleOAuthBlocked)
            }
            Section {
                collapsibleRequestRows(title: "OAuth Success", status: .oauthSuccess, expanded: $expandedOAuthSuccess)
            }
            Section {
                collapsibleRequestRows(title: "Enterprise Pending", status: .pendingApproval, expanded: $expandedPending)
            }
            Section {
                collapsibleRequestRows(title: "Approved Requests", status: .approved, expanded: $expandedApproved)
            }
            Section {
                collapsibleRequestRows(title: "Rejected Requests", status: .rejected, expanded: $expandedRejected)
            }
            Section {
                collapsibleRequestRows(title: "Expired Requests", status: .expired, expanded: $expandedExpired)
            }

            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("OAuth Approval Center")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
    }

    @ViewBuilder
    private func collapsibleRequestRows(title: String, status: LocalOAuthAccessRequestStatus, expanded: Binding<Bool>) -> some View {
        DisclosureGroup(isExpanded: expanded) {
            requestRows(status: status)
        } label: {
            HStack {
                Text(title)
                Spacer()
                Text("\(filteredLocalRequests(status: status).count + filteredRemoteRequests(status: status).count)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func requestRows(status: LocalOAuthAccessRequestStatus) -> some View {
        CollapsibleList(items: requestItems(status: status), itemName: "\(status.title.lowercased()) requests") { item in
            switch item {
            case .local(let request):
                LocalOAuthRequestRow(request: request) { newStatus in
                    app.updateLocalOAuthAccessRequest(id: request.id, status: newStatus)
                }
            case .remote(let request):
                RemoteGoogleTestUserRequestRow(request: request) { newStatus in
                    Task { await updateRemote(request: request, status: newStatus) }
                }
            }
        } empty: {
            Text("No \(status.title.lowercased()) requests.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func requestItems(status: LocalOAuthAccessRequestStatus) -> [ApprovalRequestListItem] {
        let locals = filteredLocalRequests(status: status).map(ApprovalRequestListItem.local)
        let remotes = filteredRemoteRequests(status: status).map(ApprovalRequestListItem.remote)
        return locals + remotes
    }

    private func filteredLocalRequests(status: LocalOAuthAccessRequestStatus) -> [LocalOAuthAccessRequest] {
        app.localOAuthAccessRequests.filter {
            $0.status == status
                && (search.isEmpty || $0.email.localizedCaseInsensitiveContains(search))
        }
    }

    private var oauthProviderRows: [OAuthProviderCoverageModel] {
        [
            OAuthProviderCoverageModel(
                provider: "Google",
                symbol: UnifiedMailProvider.gmail.symbol,
                status: "Direct OAuth",
                approval: "NEXORA auto approved",
                runtime: "Google OAuth + Gmail REST API",
                nextAvailabilityStep: "Retry Google Login",
                tint: .green
            ),
            OAuthProviderCoverageModel(
                provider: "Outlook",
                symbol: UnifiedMailProvider.outlook.symbol,
                status: "Not configured",
                approval: "Approval slot retained",
                runtime: "Microsoft OAuth pending",
                nextAvailabilityStep: "Configure provider",
                tint: .blue
            ),
            OAuthProviderCoverageModel(
                provider: "Office365",
                symbol: "building.columns.fill",
                status: "Not configured",
                approval: "Approval slot retained",
                runtime: "Microsoft Graph OAuth pending",
                nextAvailabilityStep: "Configure tenant",
                tint: .blue
            ),
            OAuthProviderCoverageModel(
                provider: "Exchange",
                symbol: "server.rack",
                status: "Adapter pending",
                approval: "Approval slot retained",
                runtime: "Exchange OAuth pending",
                nextAvailabilityStep: "Configure runtime",
                tint: .blue
            ),
            OAuthProviderCoverageModel(
                provider: "IMAP",
                symbol: UnifiedMailProvider.imap.symbol,
                status: "Adapter pending",
                approval: "Approval slot retained",
                runtime: "Provider-specific auth pending",
                nextAvailabilityStep: "Configure adapter",
                tint: .secondary
            ),
            OAuthProviderCoverageModel(
                provider: "SMTP",
                symbol: "paperplane.fill",
                status: "Send boundary",
                approval: "ProviderAccepted only",
                runtime: "Sender identity contract",
                nextAvailabilityStep: "Verify send identity",
                tint: .orange
            ),
            OAuthProviderCoverageModel(
                provider: "NEXORA Domain",
                symbol: UnifiedMailProvider.cloudflareNative.symbol,
                status: "Session based",
                approval: "No provider approval list",
                runtime: "NEXORA account session",
                nextAvailabilityStep: "Run diagnostics",
                tint: .green
            )
        ]
    }

    private func filteredRemoteRequests(status: LocalOAuthAccessRequestStatus) -> [GoogleTestUserRequest] {
        remoteRequests.filter {
            remoteStatus($0) == status
                && (search.isEmpty || $0.gmail.localizedCaseInsensitiveContains(search) || ($0.userEmail ?? "").localizedCaseInsensitiveContains(search))
        }
    }

    private func remoteStatus(_ request: GoogleTestUserRequest) -> LocalOAuthAccessRequestStatus {
        let value = request.status.lowercased()
        let notes = (request.notes ?? "").lowercased()
        if value.contains("reject") { return .rejected }
        if value.contains("expire") { return .expired }
        if value == "oauth_failed" { return .googleOAuthBlocked }
        if value == "oauth_success" || value.contains("google_synced") { return .oauthSuccess }
        if value.contains("pending") && notes.contains("enterprise_policy_requires_approval=true") { return .pendingApproval }
        if value.contains("approved") || notes.contains("cloudmail_governance=auto_approved") { return .autoApproved }
        return .autoApproved
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            async let dashboard = app.backendGoogleTestUserDashboard()
            async let requests = app.backendGoogleTestUserRequests(status: nil)
            self.dashboard = try await dashboard
            self.remoteRequests = try await requests
            message = nil
        } catch {
            self.dashboard = nil
            self.remoteRequests = []
            message = "Remote approval ledger unavailable. Local NEXORA requests remain manageable."
        }
    }

    private func updateRemote(request: GoogleTestUserRequest, status: LocalOAuthAccessRequestStatus) async {
        let remoteStatus: String
        switch status {
        case .pendingApproval: remoteStatus = "pending"
        case .autoApproved: remoteStatus = "approved_waiting_google_sync"
        case .googleOAuthBlocked: remoteStatus = "oauth_failed"
        case .oauthSuccess: remoteStatus = "oauth_success"
        case .approved: remoteStatus = "approved_waiting_google_sync"
        case .rejected: remoteStatus = "rejected"
        case .expired: remoteStatus = "expired"
        }
        do {
            _ = try await app.backendUpdateGoogleTestUserRequests(ids: [request.id], status: remoteStatus, notes: "Updated from NEXORA iOS OAuth Approval Center.")
            message = "Request updated."
            await load()
        } catch {
            message = "Remote request update failed. No Google provider-side status was claimed."
        }
    }
}

struct GoogleTesterManagementView: View {
    @EnvironmentObject private var app: AppState
    @State private var gmail = ""
    @State private var selectedLocalStatus: LocalOAuthAccessRequestStatus = .approved
    @State private var remoteRequests: [GoogleTestUserRequest] = []
    @State private var gmailList: GoogleTestUserGmailList?
    @State private var message: String?

    var body: some View {
        List {
            Section("Google Provider") {
                LabeledContent("Access Environment", value: "Testing")
                LabeledContent("Provider Review", value: "Not Completed")
                LabeledContent("Writeback", value: "Management ledger only")
                Text("NEXORA can track tester workflow. It does not claim Google Console tester creation unless provider-side evidence exists.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Add Tester") {
                TextField("gmail@example.com", text: $gmail)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                Button {
                    addTester()
                } label: {
                    Label("Add Tester to NEXORA Ledger", systemImage: "plus.circle")
                }
                .disabled(normalizedGmail.isEmpty)
            }

            Section("Authorization Status") {
                Picker("Gmail authorization", selection: $selectedLocalStatus) {
                    ForEach(LocalOAuthAccessRequestStatus.allCases) { status in
                        Text(status.title).tag(status)
                    }
                }
                Button {
                    updateAuthorizationStatus()
                } label: {
                    Label("Update Gmail Authorization Status", systemImage: "checkmark.shield")
                }
                .disabled(normalizedGmail.isEmpty)
                Text("This updates NEXORA governance state for the Gmail address. It does not fake Google Console tester enrollment.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Current Testers") {
                CollapsibleList(items: currentTesterItems, itemName: "current testers", searchableText: { $0.searchText }) { item in
                    switch item {
                    case .exported(let email):
                        HStack {
                            Label(email, systemImage: "checkmark.circle")
                            Spacer()
                            Text("Export list")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    case .local(let request):
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(request.email)
                                    .font(.subheadline.weight(.semibold))
                                Text("NEXORA ledger approved")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(role: .destructive) {
                                app.updateLocalOAuthAccessRequest(id: request.id, status: .rejected)
                            } label: {
                                Text("Remove")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                } empty: {
                    Text("No testers are visible in the NEXORA ledger.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Tester History") {
                CollapsibleList(items: testerHistoryItems, itemName: "tester history", searchableText: { $0.searchText }) { item in
                    switch item {
                    case .remote(let request):
                        RemoteGoogleTestUserRequestRow(request: request) { newStatus in
                            Task { await updateRemote(request: request, status: newStatus) }
                        }
                    case .local(let request):
                        LocalOAuthRequestRow(request: request) { newStatus in
                            app.updateLocalOAuthAccessRequest(id: request.id, status: newStatus)
                        }
                    }
                } empty: {
                    Text("No tester history recorded.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Google Testers")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
        .refreshable { await load() }
    }

    private var normalizedGmail: String {
        gmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var currentTesterItems: [GoogleTesterCurrentListItem] {
        let exported = (gmailList?.gmail ?? []).map(GoogleTesterCurrentListItem.exported)
        let approved = app.localOAuthAccessRequests
            .filter { $0.provider == "Google" && $0.status == .approved }
            .sorted { $0.requestedAt > $1.requestedAt }
            .map(GoogleTesterCurrentListItem.local)
        return exported + approved
    }

    private var testerHistoryItems: [GoogleTesterHistoryListItem] {
        let remote = remoteRequests.map(GoogleTesterHistoryListItem.remote)
        let locals = app.localOAuthAccessRequests
            .filter { $0.provider == "Google" }
            .sorted { $0.requestedAt > $1.requestedAt }
            .map(GoogleTesterHistoryListItem.local)
        return remote + locals
    }

    private func addTester() {
        guard let request = app.requestGoogleOAuthAccess(email: normalizedGmail) else {
            message = app.errorMessage
            return
        }
        app.updateLocalOAuthAccessRequest(id: request.id, status: .approved)
        gmail = ""
        message = "Tester added to NEXORA management ledger. Provider-side enrollment is not claimed until verified."
    }

    private func updateAuthorizationStatus() {
        guard app.setGoogleOAuthAccessStatus(email: normalizedGmail, status: selectedLocalStatus) != nil else {
            message = app.errorMessage
            return
        }
        message = "\(normalizedGmail) authorization status updated to \(selectedLocalStatus.title)."
    }

    private func load() async {
        do {
            async let requests = app.backendGoogleTestUserRequests(status: nil)
            async let list = app.backendGoogleTestUserGmailList(status: "approved_waiting_google_sync")
            remoteRequests = try await requests
            gmailList = try await list
            message = nil
        } catch {
            remoteRequests = []
            gmailList = nil
            message = "Remote Google tester ledger unavailable. Local tester management remains available."
        }
    }

    private func updateRemote(request: GoogleTestUserRequest, status: LocalOAuthAccessRequestStatus) async {
        let remoteStatus: String
        switch status {
        case .pendingApproval: remoteStatus = "pending"
        case .autoApproved: remoteStatus = "approved_waiting_google_sync"
        case .googleOAuthBlocked: remoteStatus = "oauth_failed"
        case .oauthSuccess: remoteStatus = "oauth_success"
        case .approved: remoteStatus = "approved_waiting_google_sync"
        case .rejected: remoteStatus = "rejected"
        case .expired: remoteStatus = "expired"
        }
        do {
            _ = try await app.backendUpdateGoogleTestUserRequests(ids: [request.id], status: remoteStatus, notes: "Updated from NEXORA Google Tester Management.")
            message = "Tester ledger updated."
            await load()
        } catch {
            message = "Remote tester update failed. No provider-side tester change was claimed."
        }
    }
}

private enum GoogleTesterCurrentListItem: Identifiable {
    case exported(String)
    case local(LocalOAuthAccessRequest)

    var id: String {
        switch self {
        case .exported(let email): return "exported:\(email.lowercased())"
        case .local(let request): return "local:\(request.id)"
        }
    }

    var searchText: String {
        switch self {
        case .exported(let email): return "\(email) export list"
        case .local(let request): return "\(request.email) \(request.provider) \(request.status.title)"
        }
    }
}

private enum GoogleTesterHistoryListItem: Identifiable {
    case remote(GoogleTestUserRequest)
    case local(LocalOAuthAccessRequest)

    var id: String {
        switch self {
        case .remote(let request): return "remote:\(request.id)"
        case .local(let request): return "local:\(request.id)"
        }
    }

    var searchText: String {
        switch self {
        case .remote(let request): return "\(request.gmail) \(request.userEmail ?? "") \(request.status) \(request.notes ?? "")"
        case .local(let request): return "\(request.email) \(request.provider) \(request.status.title) \(request.notes ?? "")"
        }
    }
}

struct AccountRecoveryCenterView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openURL) private var openURL
    @State private var message: String?
    @State private var invitationCode = ""
    @State private var invitationEmail = ""
    @State private var invitationProvider: GovernanceProvider = .google

    var body: some View {
        List {
            Section("Recovery Actions") {
                Button {
                    Task {
                        await app.loadV2Configuration()
                        await app.refresh()
                        message = "Diagnostics and sync check completed."
                    }
                } label: {
                    Label("Run Diagnostics", systemImage: "stethoscope")
                }
                Button {
                    Task {
                        await app.refresh()
                        message = "Sync check completed."
                    }
                } label: {
                    Label("Check Sync", systemImage: "arrow.clockwise")
                }
                NavigationLink {
                    UnifiedProviderHealthCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Check Health", systemImage: "waveform.path.ecg")
                }
                Button {
                    let ok = app.redeemGovernanceInvitation(code: invitationCode, email: invitationEmail, provider: invitationProvider)
                    message = ok ? "Invitation redeemed in NEXORA governance ledger." : app.errorMessage
                } label: {
                    Label("Redeem Invitation", systemImage: "ticket")
                }
                .disabled(invitationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || invitationEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            Section("Redeem Invitation") {
                Picker("Provider", selection: $invitationProvider) {
                    ForEach(GovernanceProvider.allCases) { provider in
                        Text(provider.rawValue).tag(provider)
                    }
                }
                TextField("CM-GGL-X8KD-7ZPW-Q4LM", text: $invitationCode)
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    #endif
                TextField("account@example.com", text: $invitationEmail)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                Text("Provider-bound invites are enforced. A Google invite cannot activate Outlook.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Accounts") {
                ForEach(app.addresses) { account in
                    VStack(alignment: .leading, spacing: 8) {
                        AccountDiagnosticRow(model: AccountDiagnosticModel(address: account, app: app, remoteRequests: []))
                        HStack(spacing: 8) {
                            if account.displayProvider == .gmail || account.displayProvider == .googleWorkspace {
                                Button {
                                    Task {
                                        if let url = await app.startGoogleMailboxOAuth(email: account.email, accountId: account.accountId) {
                                            openURL(url)
                                            message = "Continue in Google to reconnect this mailbox."
                                        } else {
                                            message = app.errorMessage ?? "Google reauthentication could not start."
                                        }
                                    }
                                } label: {
                                    Label("Reauthenticate", systemImage: "person.crop.circle.badge.checkmark")
                                }
                                .buttonStyle(.bordered)
                                Button {
                                    Task {
                                        _ = await app.syncGmail(accountId: account.accountId)
                                        message = "Gmail sync check completed."
                                    }
                                } label: {
                                    Label("Refresh OAuth", systemImage: "arrow.clockwise")
                                }
                                .buttonStyle(.bordered)
                            } else {
                                Text("Routing health is checked through Provider Health Center.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("Recovery Guidance") {
                Text("If Google returns access_denied, the account must be approved while the provider app remains in Testing mode.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                NavigationLink {
                    OAuthDiagnosticsCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Open Access Diagnostics", systemImage: "person.crop.circle.badge.exclamationmark")
                }
            }

            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Recovery Center")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct AccessGovernanceCenterView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        List {
            Section("Access Governance") {
                DiagnosticGrid(items: [
                    ("Pending Requests", "\(app.localOAuthAccessRequests.filter { $0.status == .pendingApproval }.count)"),
                    ("Approved Requests", "\(app.localOAuthAccessRequests.filter { $0.status == .approved }.count)"),
                    ("Active Invites", "\(app.governanceInvitations.filter { $0.status == .active }.count)"),
                    ("Audit Events", "\(app.governanceAuditTrail.count)")
                ])
                Text("NEXORA governance manages request, approval, invitation, tester, recovery, and diagnostics state. Provider-side enrollment is not claimed without official runtime evidence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Centers") {
                NavigationLink {
                    OAuthApprovalCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Approval Center", systemImage: "person.badge.shield.checkmark")
                }
                NavigationLink {
                    InvitationManagementView()
                        .environmentObject(app)
                } label: {
                    Label("Invitations", systemImage: "ticket")
                }
                NavigationLink {
                    GoogleTesterManagementView()
                        .environmentObject(app)
                } label: {
                    Label("Tester Management", systemImage: "checklist.checked")
                }
                NavigationLink {
                    GovernanceAuditTrailView()
                        .environmentObject(app)
                } label: {
                    Label("Audit Trail", systemImage: "list.bullet.clipboard")
                }
                NavigationLink {
                    EnterpriseAccountDiagnosticsView()
                        .environmentObject(app)
                } label: {
                    Label("Diagnostics", systemImage: "stethoscope")
                }
                NavigationLink {
                    AccountRecoveryCenterView()
                        .environmentObject(app)
                } label: {
                    Label("Recovery Center", systemImage: "lifepreserver")
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Access Governance")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct InvitationManagementView: View {
    @EnvironmentObject private var app: AppState
    @State private var provider: GovernanceProvider = .google
    @State private var emailBinding = ""
    @State private var maxUses = 1
    @State private var validDays = 7
    @State private var message: String?

    var body: some View {
        List {
            Section("Create Invite") {
                Picker("Provider", selection: $provider) {
                    ForEach(GovernanceProvider.allCases) { provider in
                        Text(provider.rawValue).tag(provider)
                    }
                }
                TextField("Optional email binding", text: $emailBinding)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                Stepper("Max uses: \(maxUses)", value: $maxUses, in: 1...20)
                Stepper("Expires in \(validDays) day\(validDays == 1 ? "" : "s")", value: $validDays, in: 1...90)
                Button {
                    let code = app.createGovernanceInvitation(provider: provider, email: emailBinding, maxUses: maxUses, validDays: validDays)
                    message = "Created invite \(code). Only its hash is stored."
                    emailBinding = ""
                    maxUses = 1
                    validDays = 7
                } label: {
                    Label("Create Invite", systemImage: "plus.circle")
                }
                Button {
                    var created = 0
                    for _ in 0..<3 {
                        _ = app.createGovernanceInvitation(provider: provider, email: nil, maxUses: 1, validDays: validDays)
                        created += 1
                    }
                    message = "Batch Invite created \(created) provider-bound one-time invites."
                } label: {
                    Label("Batch Invite", systemImage: "square.stack.3d.up")
                }
                if let code = app.lastGeneratedInvitationCode {
                    LabeledContent("Latest Invite", value: code)
                        .textSelection(.enabled)
                }
                Text("Security: NEXORA stores only the invite hash. Invites are provider-bound, one-time by default, expirable, revocable, and audited.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Invitations") {
                if app.governanceInvitations.isEmpty {
                    Text("No invitations created.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(app.governanceInvitations) { invite in
                        GovernanceInvitationRow(invite: invite) { action in
                            switch action {
                            case .expire: app.expireGovernanceInvitation(id: invite.id)
                            case .revoke: app.revokeGovernanceInvitation(id: invite.id)
                            case .resend:
                                _ = app.resendGovernanceInvitation(id: invite.id)
                                message = "Resend recorded. Original code is not stored."
                            }
                        }
                    }
                }
            }

            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Invitations")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct GovernanceAuditTrailView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        List {
            Section("Audit Trail") {
                CollapsibleList(items: app.governanceAuditTrail, itemName: "governance audit events") { event in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(event.action.rawValue)
                                    .font(.caption.weight(.bold))
                                Spacer()
                                StatusPill(text: event.provider.rawValue, tint: .blue)
                            }
                            if let account = event.account {
                                Text(account)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text(event.detail)
                                .font(.caption)
                            Text("\(event.actor ?? "Unknown actor") · \(event.createdAt.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                } empty: {
                    Text("No governance events recorded.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Audit Trail")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

}

private struct GovernanceInvitationRow: View {
    enum Action { case expire, revoke, resend }
    let invite: GovernanceInvitation
    let action: (Action) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(invite.provider.rawValue, systemImage: "ticket")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusPill(text: invite.status.title, tint: tint)
            }
            DiagnosticGrid(items: [
                ("Email Binding", invite.optionalEmailBinding ?? "Any account"),
                ("Max Uses", "\(invite.maxUses)"),
                ("Used", "\(invite.uses)"),
                ("Expires", invite.expiresAt.formatted(date: .abbreviated, time: .shortened)),
                ("Stored", "Hash only"),
                ("Created By", invite.createdBy ?? "Unknown")
            ])
            HStack(spacing: 8) {
                Button("Expire Invite") { action(.expire) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Revoke Invite") { action(.revoke) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Resend Invite") { action(.resend) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private var tint: Color {
        switch invite.status {
        case .active: return .green
        case .expired: return .secondary
        case .revoked: return .red
        case .used: return .orange
        }
    }
}

struct UnifiedProviderHealthCenterView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                providerHealthHeader
                ForEach(providerRows) { row in
                    ProviderHealthRow(row: row)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(AmbientBackground())
        .navigationTitle("Provider Health")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await app.loadV2Configuration() }
    }

    private var providerHealthHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Unified Provider Health Center", systemImage: "waveform.path.ecg")
                .font(.headline.weight(.semibold))
            Text("OAuth, SMTP, IMAP, Sync, Routing, Identity, and reachability are normalized to PASS, WARN, FAIL, PENDING, or BLOCKED.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var providerRows: [ProviderHealthModel] {
        let googleTruth = app.addresses
            .filter { $0.displayProvider == .gmail || $0.displayProvider == .googleWorkspace }
            .map { app.providerTruthSnapshot(for: $0) }
            .first
        let cloudMailTruth = app.addresses
            .filter { $0.displayProvider == .cloudflareNative }
            .map { app.providerTruthSnapshot(for: $0) }
            .first
        let hasCloudMail = cloudMailTruth != nil
        return [
            ProviderHealthModel(provider: "Google", symbol: UnifiedMailProvider.gmail.symbol, state: googleTruth.map(Self.providerHealthState) ?? .pending, oauth: googleTruth?.providerStatus.rawValue ?? "Not connected", smtp: "Not used", imap: "Not used", sync: googleTruth?.syncStatus.rawValue ?? "Pending", routing: "Provider OAuth", identity: googleTruth?.email ?? "No identity", reachability: googleTruth?.failureReason ?? "No provider evidence"),
            ProviderHealthModel(provider: "Microsoft", symbol: "building.2.fill", state: .pending, oauth: "Not configured", smtp: "Not configured", imap: "Not configured", sync: "Pending", routing: "Unavailable", identity: "No identity", reachability: "Adapter pending"),
            ProviderHealthModel(provider: "Outlook", symbol: UnifiedMailProvider.outlook.symbol, state: .pending, oauth: "Not configured", smtp: "Not configured", imap: "Not configured", sync: "Pending", routing: "Unavailable", identity: "No identity", reachability: "Adapter pending"),
            ProviderHealthModel(provider: "Office365", symbol: "building.columns.fill", state: .pending, oauth: "Not configured", smtp: "Not configured", imap: "Not configured", sync: "Pending", routing: "Unavailable", identity: "No identity", reachability: "Adapter pending"),
            ProviderHealthModel(provider: "Exchange", symbol: "server.rack", state: .pending, oauth: "Not configured", smtp: "Not configured", imap: "Not configured", sync: "Pending", routing: "Unavailable", identity: "No identity", reachability: "Adapter pending"),
            ProviderHealthModel(provider: "IMAP", symbol: UnifiedMailProvider.imap.symbol, state: .pending, oauth: "Not applicable", smtp: "Not configured", imap: "Not configured", sync: "Pending", routing: "Unavailable", identity: "No identity", reachability: "Adapter pending"),
            ProviderHealthModel(provider: "SMTP", symbol: "paperplane.fill", state: app.defaultSendingIdentity?.canSend == true ? .warn : .pending, oauth: "Not applicable", smtp: app.defaultSendingIdentity == nil ? "No verified sender" : app.defaultSendingIdentity!.statusLine, imap: "Not applicable", sync: "Not applicable", routing: "Send provider boundary", identity: app.defaultSendingIdentity?.email ?? app.primaryIdentityEmail, reachability: "ProviderAccepted != Delivered"),
            ProviderHealthModel(provider: "NEXORA Domain", symbol: UnifiedMailProvider.cloudflareNative.symbol, state: cloudMailTruth.map(Self.providerHealthState) ?? .warn, oauth: cloudMailTruth?.providerStatus.rawValue ?? "NEXORA session unknown", smtp: "Worker controlled", imap: "Not used", sync: cloudMailTruth?.syncStatus.rawValue ?? app.syncObservabilitySnapshot.currentSyncState, routing: hasCloudMail ? "Routing active" : "No NEXORA identity", identity: cloudMailTruth?.email ?? app.primaryIdentityEmail, reachability: cloudMailTruth?.failureReason ?? app.serverURLString)
        ]
    }

    private static func providerHealthState(_ truth: ProviderTruthSnapshot) -> ProviderHealthState {
        if truth.providerStatus == .access_blocked { return .blocked }
        if truth.providerStatus == .testing_restricted { return .warn }
        if truth.capabilityStatus == .allowed { return .pass }
        if truth.providerStatus == .not_started { return .pending }
        return .warn
    }
}

struct FriendlyOAuthFailureView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let email: String
    let rawError: String
    @State private var message: String?

    var body: some View {
        Form {
            Section("Google OAuth blocked") {
                LabeledContent("Provider", value: "Google")
                LabeledContent("NEXORA Governance", value: "Auto Approved")
                LabeledContent("Google OAuth", value: "Blocked")
                LabeledContent("Reason", value: googleRestrictionReason(rawError))
                LabeledContent("Mailbox", value: "Not Ready")
                LabeledContent("Error", value: rawError)
            }
            Section("Recovery") {
                FriendlyOAuthFailureSummary(email: email, testerStatus: .testerNotRegistered)
                Button {
                    Task {
                        if let url = await app.startGoogleMailboxOAuth(email: email) {
                            openURL(url)
                        } else {
                            message = app.mailboxOnboardingMessage ?? "Google login could not be opened."
                        }
                    }
                } label: {
                    Label("Retry Google Login", systemImage: "link")
                }
                NavigationLink {
                    OAuthDiagnosticsCenterView(prefilledEmail: email)
                        .environmentObject(app)
                } label: {
                    Label("Open Access Diagnostics", systemImage: "stethoscope")
                }
            }
            if let message {
                Section {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("OAuth Restriction")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func googleRestrictionReason(_ raw: String) -> String {
        let value = raw.lowercased()
        if value.contains("verification") || value.contains("app_not_verified") { return "Verification Required" }
        if value.contains("workspace") || value.contains("admin") { return "Workspace Admin Blocked" }
        if value.contains("scope") { return "Scope Not Approved" }
        if value.contains("cancel") { return "User Cancelled" }
        if value.contains("testing") || value.contains("access_denied") { return "Testing Restricted" }
        return "Unknown Google OAuth Error"
    }
}

@MainActor
private struct AccountDiagnosticModel: Identifiable {
    let id: String
    let provider: UnifiedMailProvider
    let email: String
    let accountType: String
    let health: ProviderHealthState
    let syncStatus: String
    let capability: String
    let authStatus: String
    let oauthStatus: String
    let lastSync: String
    let recoveryAction: String
    let failureReason: String
    let governanceStatus: String
    let providerStatus: String
    let capabilityStatus: String
    let mailboxStatus: String
    let syncTruthStatus: String
    let freshnessStatus: String
    let recoveryPath: String
    let truthSource: String
    let loginCapability: String
    let sendCapability: String
    let receiveCapability: String
    let syncCapability: String
    let routingCapability: String
    let aiCapability: String
    let lastProviderSync: String
    let lastSuccessfulImport: String
    let newestProviderMessage: String
    let newestImportedMessage: String
    let recoveryGuidance: String

    init(address: MailAddress, app: AppState, remoteRequests: [GoogleTestUserRequest]) {
        let truth = app.providerTruthSnapshot(for: address, remoteRequests: remoteRequests)
        let isGoogle = address.displayProvider == .gmail || address.displayProvider == .googleWorkspace
        let error = address.syncError?.trimmingCharacters(in: .whitespacesAndNewlines)
        let syncStatus = app.gmailSyncStatusByAccountId[address.accountId] ?? address.syncStatus ?? "connected"
        self.id = "address-\(address.accountId)"
        self.provider = address.displayProvider
        self.email = address.email
        self.accountType = isGoogle ? "Google Mailbox" : "NEXORA Domain"
        self.health = Self.healthState(truth: truth, error: error, connected: syncStatus.localizedCaseInsensitiveContains("connected"))
        self.syncStatus = syncStatus
        self.capability = truth.capabilityStatus.rawValue
        self.authStatus = truth.canLogin.canProceed ? "Authenticated" : "Not authenticated"
        self.oauthStatus = truth.providerStatus.rawValue
        self.lastSync = app.accountTimestampDisplayLabel(address.lastSyncedAt)
        self.recoveryAction = truth.recoveryStatus.rawValue
        self.failureReason = truth.failureReason
        self.governanceStatus = truth.governanceStatus.rawValue
        self.providerStatus = truth.providerStatus.rawValue
        self.capabilityStatus = truth.capabilityStatus.rawValue
        self.mailboxStatus = truth.mailboxStatus
        self.syncTruthStatus = truth.syncStatus.rawValue
        self.freshnessStatus = truth.freshnessStatus.rawValue
        self.recoveryPath = truth.recoveryStatus.rawValue
        self.truthSource = truth.truthSource
        self.loginCapability = Self.capabilityLine(truth.canLogin)
        self.sendCapability = Self.capabilityLine(truth.canSend)
        self.receiveCapability = Self.capabilityLine(truth.canReceive)
        self.syncCapability = Self.capabilityLine(truth.canSync)
        self.routingCapability = Self.capabilityLine(truth.canRoute)
        self.aiCapability = Self.capabilityLine(truth.canAIProcess)
        self.lastProviderSync = app.accountTimestampDisplayLabel(address.lastSyncedAt)
        self.lastSuccessfulImport = Self.latestImportedMessageLabel(email: address.email, accountId: address.accountId, app: app)
        self.newestProviderMessage = self.lastSuccessfulImport
        self.newestImportedMessage = self.lastSuccessfulImport
        self.recoveryGuidance = Self.recoveryGuidance(truth: truth)
    }

    init(unified: UnifiedMailAccount, app: AppState, remoteRequests: [GoogleTestUserRequest]) {
        let truth = app.providerTruthSnapshot(for: unified, remoteRequests: remoteRequests)
        let isGoogle = unified.provider == .gmail || unified.provider == .googleWorkspace
        self.id = "unified-\(unified.id)"
        self.provider = unified.provider
        self.email = unified.email
        self.accountType = unified.isDelegatedMailbox ? "Delegated" : (isGoogle ? "Google Mailbox" : "Owned")
        self.health = Self.healthState(truth: truth, error: unified.status.localizedCaseInsensitiveContains("error") ? unified.status : nil, connected: unified.status.localizedCaseInsensitiveContains("connected"))
        self.syncStatus = unified.status
        self.capability = truth.capabilityStatus.rawValue
        self.authStatus = truth.canLogin.canProceed ? "Token reference present" : "Token reference missing"
        self.oauthStatus = truth.providerStatus.rawValue
        self.lastSync = "Backend account ledger"
        self.recoveryAction = truth.recoveryStatus.rawValue
        self.failureReason = truth.failureReason
        self.governanceStatus = truth.governanceStatus.rawValue
        self.providerStatus = truth.providerStatus.rawValue
        self.capabilityStatus = truth.capabilityStatus.rawValue
        self.mailboxStatus = truth.mailboxStatus
        self.syncTruthStatus = truth.syncStatus.rawValue
        self.freshnessStatus = truth.freshnessStatus.rawValue
        self.recoveryPath = truth.recoveryStatus.rawValue
        self.truthSource = truth.truthSource
        self.loginCapability = Self.capabilityLine(truth.canLogin)
        self.sendCapability = Self.capabilityLine(truth.canSend)
        self.receiveCapability = Self.capabilityLine(truth.canReceive)
        self.syncCapability = Self.capabilityLine(truth.canSync)
        self.routingCapability = Self.capabilityLine(truth.canRoute)
        self.aiCapability = Self.capabilityLine(truth.canAIProcess)
        self.lastProviderSync = "Backend account ledger"
        self.lastSuccessfulImport = Self.latestImportedMessageLabel(email: unified.email, accountId: unified.readableAccountId ?? 0, app: app)
        self.newestProviderMessage = self.lastSuccessfulImport
        self.newestImportedMessage = self.lastSuccessfulImport
        self.recoveryGuidance = Self.recoveryGuidance(truth: truth)
    }

    private static func healthState(truth: ProviderTruthSnapshot, error: String?, connected: Bool) -> ProviderHealthState {
        if error?.isEmpty == false { return .fail }
        if truth.providerStatus == .access_blocked || truth.providerStatus == .workspace_admin_blocked { return .blocked }
        if truth.providerStatus == .testing_restricted { return connected ? .warn : .pending }
        if truth.capabilityStatus == .allowed { return .pass }
        if truth.capabilityStatus == .needsRefresh { return .warn }
        return connected ? .warn : .pending
    }

    private static func capabilityLine(_ capability: ProviderTruthCapability) -> String {
        "\(capability.status.rawValue) · \(capability.reason)"
    }

    private static func latestImportedMessageLabel(email: String, accountId: Int, app: AppState) -> String {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let latest = app.emails
            .filter { message in
                message.accountId == accountId
                || message.sourceAccount.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalized
            }
            .max { lhs, rhs in (lhs.date ?? .distantPast) < (rhs.date ?? .distantPast) }
        guard let latest else { return "No provider messages visible in loaded ledger" }
        return (latest.date ?? .distantPast).formatted(date: .abbreviated, time: .shortened)
    }

    private static func recoveryGuidance(truth: ProviderTruthSnapshot) -> String {
        if truth.canReceive.canProceed { return "Refresh confirms provider import and ledger visibility" }
        switch truth.freshnessStatus {
        case .stale: return "Run Gmail sync; receive remains stale until a new import reaches the ledger"
        case .unknown: return truth.recoveryStatus.rawValue
        case .healthy: return truth.recoveryStatus.rawValue
        }
    }

    private static func providerTesterTitle(tester: OAuthTesterStatus?, truth: ProviderTruthSnapshot) -> String {
        return truth.providerStatus.rawValue
    }

    private static func recoveryAction(isGoogle: Bool, tester: OAuthTesterStatus?) -> String {
        guard isGoogle else { return "Run Diagnostics" }
        switch tester {
        case .testerApproved:
            return "None"
        case .testerRejected:
            return "Admin can re-approve"
        case .testerPending:
            return "Awaiting admin approval"
        case .testerNotRegistered:
            return "Admin can approve"
        case nil:
            return "Run Diagnostics"
        }
    }

    private static func failureReason(error: String?, tester: OAuthTesterStatus?) -> String {
        if let error, !error.isEmpty { return error }
        switch tester {
        case .testerRejected:
            return "NEXORA workspace admin rejected authorization"
        case .testerPending:
            return "Waiting for NEXORA governance approval"
        case .testerNotRegistered:
            return "Governance approval not registered; mailbox connection remains usable"
        default:
            return "None"
        }
    }
}

private struct AccountDiagnosticRow: View {
    let model: AccountDiagnosticModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: model.provider.symbol)
                    .foregroundStyle(model.provider.identityColor)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.email)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text("\(model.provider.title) · \(model.accountType)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(text: model.health.rawValue, tint: model.health.tint)
            }
            DiagnosticGrid(items: [
                ("Health", model.health.rawValue),
                ("Governance Status", model.governanceStatus),
                ("Provider Status", model.providerStatus),
                ("Capability Status", model.capabilityStatus),
                ("Mailbox Status", model.mailboxStatus),
                ("Sync Status", model.syncTruthStatus),
                ("Freshness", model.freshnessStatus),
                ("Last Provider Sync", model.lastProviderSync),
                ("Last Successful Import", model.lastSuccessfulImport),
                ("Newest Provider Message", model.newestProviderMessage),
                ("Newest Imported Message", model.newestImportedMessage),
                ("Login Capability", model.loginCapability),
                ("Send Capability", model.sendCapability),
                ("Receive Capability", model.receiveCapability),
                ("Sync Capability", model.syncCapability),
                ("Routing Capability", model.routingCapability),
                ("AI Capability", model.aiCapability),
                ("Raw Sync State", model.syncStatus),
                ("OAuth Status", model.oauthStatus),
                ("Last Sync", model.lastSync),
                ("Recovery Path", model.recoveryPath),
                ("Recovery Guidance", model.recoveryGuidance),
                ("Failure Reason", model.failureReason),
                ("Truth Source", model.truthSource)
            ])
        }
        .padding(10)
        .background(model.health.tint.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct DiagnosticGrid: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.0)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                    Text(item.1.isEmpty ? "Not reported" : item.1)
                        .font(.caption.weight(.semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }
}

private struct DiagnosticNotice: View {
    let text: String
    let tint: Color

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(tint)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.11), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

private struct FriendlyOAuthFailureSummary: View {
    let email: String
    let testerStatus: OAuthTesterStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NEXORA has auto approved this Gmail mailbox. Google OAuth is separate and may still block testing, verification, scopes, or Workspace policy.")
                .font(.caption)
                .foregroundStyle(.secondary)
            DiagnosticGrid(items: [
                ("Account", email.isEmpty ? "Not entered" : email),
                ("NEXORA Governance", "Auto Approved"),
                ("Google OAuth", "Blocked"),
                ("Recovery", "Retry Google Login / complete Google verification")
            ])
        }
    }
}

private enum ApprovalRequestListItem: Identifiable {
    case local(LocalOAuthAccessRequest)
    case remote(GoogleTestUserRequest)

    var id: String {
        switch self {
        case .local(let request): return "local:\(request.id)"
        case .remote(let request): return "remote:\(request.id)"
        }
    }
}

private struct LocalOAuthRequestRow: View {
    let request: LocalOAuthAccessRequest
    let update: (LocalOAuthAccessRequestStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(request.email)
                        .font(.subheadline.weight(.semibold))
                    Text("\(request.provider) · \(request.requestedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(text: request.status.title, tint: request.status.tint)
            }
            HStack(spacing: 8) {
                Button("Approve") { update(.approved) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Reject") { update(.rejected) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Expire") { update(.expired) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            Text(request.notes ?? "NEXORA local request ledger.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct RemoteGoogleTestUserRequestRow: View {
    let request: GoogleTestUserRequest
    let update: (LocalOAuthAccessRequestStatus) -> Void

    private static func sanitizeStatus(_ status: String) -> String {
        let lower = status.lowercased()
        if lower.contains("pending_google_test_user") || lower.contains("pending") {
            return "Enterprise Pending"
        }
        if lower.contains("approved_waiting_google_sync") {
            return "Awaiting Sync"
        }
        return status.capitalized
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(request.gmail)
                        .font(.subheadline.weight(.semibold))
                    Text("\(request.userEmail ?? "Unknown user") · \(request.device ?? "Unknown device")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(text: Self.sanitizeStatus(request.status), tint: remoteTint)
            }
            DiagnosticGrid(items: [
                ("Requested", request.requestedAt ?? "Not reported"),
                ("Last Seen", request.lastSeenAt ?? "Not reported"),
                ("Approved By", request.approvedBy ?? "Not approved"),
                ("Provider Sync", request.lastGoogleExport ?? "Not synced")
            ])
            HStack(spacing: 8) {
                Button("Approve") { update(.approved) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Reject") { update(.rejected) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Expire") { update(.expired) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private var remoteTint: Color {
        let status = request.status.lowercased()
        if status.contains("approved") { return .green }
        if status.contains("reject") { return .red }
        if status.contains("expire") { return .secondary }
        return .orange
    }
}

private struct OAuthProviderCoverageModel: Identifiable {
    let id = UUID()
    let provider: String
    let symbol: String
    let status: String
    let approval: String
    let runtime: String
    let nextAvailabilityStep: String
    let tint: Color
}

private struct OAuthProviderCoverageRow: View {
    let row: OAuthProviderCoverageModel

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Label(row.provider, systemImage: row.symbol)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusPill(text: row.status, tint: row.tint)
            }
            DiagnosticGrid(items: [
                ("Approval", row.approval),
                ("Runtime", row.runtime),
                ("Next availability step", row.nextAvailabilityStep),
                ("Claim", providerClaim)
            ])
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var providerClaim: String {
        let status = row.status.lowercased()
        if status.contains("not configured") || status.contains("pending") { return "Not usable" }
        return "Evidence scoped"
    }
}

private struct ProviderHealthModel: Identifiable {
    let id = UUID()
    let provider: String
    let symbol: String
    let state: ProviderHealthState
    let oauth: String
    let smtp: String
    let imap: String
    let sync: String
    let routing: String
    let identity: String
    let reachability: String
}

private struct ProviderHealthRow: View {
    let row: ProviderHealthModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(row.provider, systemImage: row.symbol)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                StatusPill(text: row.state.rawValue, tint: row.state.tint)
            }
            DiagnosticGrid(items: [
                ("OAuth", row.oauth),
                ("SMTP", row.smtp),
                ("IMAP", row.imap),
                ("Sync", row.sync),
                ("Routing", row.routing),
                ("Identity", row.identity),
                ("Provider Reachability", row.reachability)
            ])
        }
        .padding(12)
        .background(row.state.tint.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private enum ApprovalFilter: String, CaseIterable, Identifiable {
    case all
    case pending
    case approved
    case rejected
    case expired

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .pending: return "Pending"
        case .approved: return "Approved"
        case .rejected: return "Rejected"
        case .expired: return "Expired"
        }
    }

    func matches(_ status: LocalOAuthAccessRequestStatus) -> Bool {
        switch self {
        case .all: return true
        case .pending: return status == .pendingApproval
        case .approved: return status == .approved || status == .autoApproved || status == .oauthSuccess
        case .rejected: return status == .rejected
        case .expired: return status == .expired
        }
    }
}

private extension ProviderHealthState {
    var tint: Color {
        switch self {
        case .pass: return .green
        case .warn: return .orange
        case .fail: return .red
        case .pending: return .blue
        case .blocked: return .red
        }
    }
}

private extension LocalOAuthAccessRequestStatus {
    var tint: Color {
        switch self {
        case .autoApproved: return .green
        case .googleOAuthBlocked: return .red
        case .oauthSuccess: return .blue
        case .pendingApproval: return .orange
        case .approved: return .green
        case .rejected: return .red
        case .expired: return .secondary
        }
    }
}
