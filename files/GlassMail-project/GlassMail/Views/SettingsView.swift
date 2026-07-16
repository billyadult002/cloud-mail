//
//  SettingsView.swift
//  GlassMail
//
//  Configure CloudMail settings. Apple Intelligence is the only user-facing AI path.
//

import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct SettingsView: View {
    var showDoneButton: Bool = true

    @EnvironmentObject private var app: AppState

    private var preferredColorScheme: ColorScheme? {
        switch app.profileTheme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
    @Environment(\.dismiss) private var dismiss
    @State private var settingsPage: SettingsPage = .essential
    @State private var showAccountCenterLaunchDestination = false
    @State private var showOAuthApprovalLaunchDestination = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CompactAccountPillView()
                    Picker("Settings page", selection: $settingsPage) {
                        ForEach(SettingsPage.allCases) { page in
                            Text(page.title).tag(page)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Color.clear)

                switch settingsPage {
                case .essential:
                    aiSummaryToggleSection
                    appearanceSection
                    mailClientSection
                    contactsSection
                    acceptanceNavigationSection
                    notificationsSection
                case .advanced:
                    aiPrivacySection
                    privacySecuritySection
                    advancedAccountDiagnosticsSection
                    accountSection
                    aboutSection
                }
            }
            .formStyle(.grouped)
            .cloudMailCompactMenuSurface()
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .preferredColorScheme(preferredColorScheme)
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if showDoneButton {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .navigationDestination(isPresented: $showAccountCenterLaunchDestination) {
                MailAccountsView()
                    .environmentObject(app)
            }
            .navigationDestination(isPresented: $showOAuthApprovalLaunchDestination) {
                OAuthApprovalCenterView()
                    .environmentObject(app)
            }
            .onAppear {
                applySettingsLaunchDestination()
            }
        }
    }

    private func applySettingsLaunchDestination() {
        guard let destination = app.settingsLaunchDestination else { return }
        app.settingsLaunchDestination = nil
        switch destination {
        case "account-center":
            showAccountCenterLaunchDestination = true
        case "oauth-approval-center", "oauth":
            settingsPage = .advanced
            showOAuthApprovalLaunchDestination = true
        default:
            break
        }
    }

    private enum SettingsPage: String, CaseIterable, Identifiable {
        case essential
        case advanced

        var id: String { rawValue }
        var title: String {
            switch self {
            case .essential: return "Essential"
            case .advanced: return "Advanced"
            }
        }
    }

    private var aiSummaryToggleSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { app.aiConsent.aiEnabled },
                set: { newValue in
                    var consent = app.aiConsent
                    consent.aiEnabled = newValue
                    if !newValue {
                        consent.cloudAIEnabled = false
                    }
                    Task { await app.saveAIConsent(consent) }
                }
            )) {
                Text("AI Mail Summaries")
            }
            if app.aiConsent.aiEnabled {
                LabeledContent("AI architecture", value: "Apple Intelligence only")
                Text("AI features run locally on this device with Apple Intelligence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("AI Features")
        }
    }

    private var acceptanceNavigationSection: some View {
        Section("Account Center") {
            NavigationLink {
                MailAccountsView()
                    .environmentObject(app)
            } label: {
                Label("Account Center", systemImage: "person.2.fill")
            }
            NavigationLink {
                EnterpriseProductivityPlatformView()
                    .environmentObject(app)
            } label: {
                Label("Enterprise Hub", systemImage: "square.grid.2x2")
            }
            Label("AI: Apple Intelligence only", systemImage: "sparkles")
                .foregroundStyle(.secondary)
        }
    }

    private var contactsSection: some View {
        Section("Contacts") {
            NavigationLink {
                EnterpriseDirectoryProfileSyncView(startTab: .directory)
                    .environmentObject(app)
            } label: {
                Label("Directory", systemImage: "person.text.rectangle")
            }
            NavigationLink {
                EnterpriseDirectoryProfileSyncView(startTab: .domain)
                    .environmentObject(app)
            } label: {
                Label("Domain Directory", systemImage: "building.2")
            }
            NavigationLink {
                EnterpriseDirectoryProfileSyncView(startTab: .profileSync)
                    .environmentObject(app)
            } label: {
                Label("Profile Sync", systemImage: "icloud.and.arrow.up")
            }
            NavigationLink {
                EnterpriseDirectoryProfileSyncView(startTab: .restore)
                    .environmentObject(app)
            } label: {
                Label("Device Restore", systemImage: "arrow.clockwise.icloud")
            }
        }
    }

    private var aiPrivacySection: some View {
        Section {
            LabeledContent("Active AI", value: "Apple Intelligence")
            LabeledContent("Mail content", value: "Local only")
            LabeledContent("External runtimes", value: "Disabled")
            Text("NEXORA uses Apple Intelligence locally for supported mail actions.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } header: {
            Text("AI privacy")
        }
    }

    private var appearanceSection: some View {
        Section("General & Appearance") {
            Picker("Theme", selection: Binding(
                get: { app.profileTheme },
                set: { app.setProfileTheme($0) }
            )) {
                Text("System Default").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            .pickerStyle(.segmented)
            Picker("Default From", selection: Binding(
                get: { app.defaultSendingIdentity?.email ?? "" },
                set: { app.setDefaultSendingAddress($0) }
            )) {
                ForEach(app.sendingIdentities) { identity in
                    Text(identity.email).tag(identity.email)
                }
            }
        }
    }

    private var notificationsSection: some View {
        Section("Notifications") {
            Toggle("Mail notifications", isOn: Binding(
                get: { app.profileNotificationsEnabled },
                set: { app.setProfileNotificationsEnabled($0) }
            ))
        }
    }

    private var mailClientSection: some View {
        Section {
            LabeledContent("Primary identity", value: app.primaryIdentityEmail)
            if let defaultIdentity = app.defaultSendingIdentity {
                LabeledContent("Default From", value: defaultIdentity.email)
                LabeledContent("Send capability", value: defaultIdentity.statusLine)
            } else {
                LabeledContent("Default From", value: "No sending address")
            }
            LabeledContent("iCloud profile sync", value: "Non-secret config only")
            LabeledContent("Drafts", value: "\(app.mailboxMetricsTruthSnapshot.drafts) · local draft ledger")
            LabeledContent("Sent", value: "\(app.mailboxMetricsTruthSnapshot.sent) · local sent ledger")
            LabeledContent("Outbox", value: "\(app.mailboxMetricsTruthSnapshot.outbox) · local outbox ledger")
            LabeledContent("Scheduled", value: app.mailboxMetricsTruthSnapshot.scheduled == 0 ? "Not enabled" : "\(app.mailboxMetricsTruthSnapshot.scheduled) · local schedule ledger")
            LabeledContent("Unread", value: "\(app.mailboxMetricsTruthSnapshot.unread) · Global Message Ledger")
            LabeledContent("All Mail", value: "\(app.mailboxMetricsTruthSnapshot.allMail) · unified ledger view")
            NavigationLink {
                SignatureSettingsView().environmentObject(app)
            } label: {
                Label("Signatures", systemImage: "signature")
            }
        } header: { Text("Mail client") }
    }

    private var accountSection: some View {
        Section {
            if let user = app.currentUser {
                LabeledContent("Signed in as", value: user.displayName)
            }
            Button(role: .destructive) {
                app.signOut()
                dismiss()
            } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } header: {
            Text("Account")
        }
    }

    private var advancedAccountDiagnosticsSection: some View {
        Section("Accounts · Advanced") {
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
            NavigationLink {
                OAuthDiagnosticsCenterView()
                    .environmentObject(app)
            } label: {
                Label("OAuth Diagnostics", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        }
    }

    private var privacySecuritySection: some View {
        Section("Privacy & Security") {
            NavigationLink {
                SecurityCenterView().environmentObject(app)
            } label: {
                Label("Security Center", systemImage: "checkmark.shield.fill")
            }
            Label("Privacy controls are managed in NEXORA", systemImage: "hand.raised.fill")
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("App", value: "NEXORA")
            LabeledContent("Version", value: "3.03")
            LabeledContent("Design", value: "NEXORA Workspace OS")
        }
    }
}

struct SignatureSettingsView: View {
    @EnvironmentObject private var app: AppState
    @State private var selectedEmail: String = ""
    @State private var signatureBody: String = ""

    var body: some View {
        Form {
            Section("Sending address") {
                Picker("Address", selection: $selectedEmail) {
                    ForEach(app.sendingIdentities) { identity in
                        Text(identity.email).tag(identity.email)
                    }
                }
                .onChange(of: selectedEmail) { _, newValue in
                    signatureBody = app.signature(for: newValue)
                    app.setDefaultSendingAddress(newValue)
                }
                if let identity = app.sendingIdentities.first(where: { $0.email == selectedEmail }) {
                    LabeledContent("Provider", value: identity.provider.title)
                    LabeledContent("Domain", value: identity.domain)
                    LabeledContent("Status", value: identity.canSend ? "Can send" : identity.sendStatusReason)
                }
            }

            Section("Signature") {
                TextEditor(text: $signatureBody)
                    .frame(minHeight: 140)
                Button {
                    app.updateSignature(for: selectedEmail, body: signatureBody)
                } label: {
                    Label("Save signature", systemImage: "checkmark")
                }
                .disabled(selectedEmail.isEmpty)
            }
        }
        .cloudMailCompactMenuSurface()
        .navigationTitle("Signatures")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            selectedEmail = app.defaultSendingIdentity?.email ?? app.sendingIdentities.first?.email ?? ""
            signatureBody = selectedEmail.isEmpty ? "" : app.signature(for: selectedEmail)
        }
    }
}

private struct CloudMailCompactMenuSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .controlSize(.small)
            .font(.subheadline)
            .environment(\.defaultMinListRowHeight, 44)
            .environment(\.defaultMinListHeaderHeight, 26)
            .listSectionSpacing(12)
    }
}

extension View {
    func cloudMailCompactMenuSurface() -> some View {
        modifier(CloudMailCompactMenuSurface())
    }
}

struct SecurityCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var selectedMetric: SecurityCenterMetric?
    @State private var showMoreMetrics = false

    private var allAssessments: [(EmailMessage, NexoraTrustAssessment)] {
        app.emails.map { ($0, app.trustAssessment(for: $0)) }
    }

    private var assessments: [(EmailMessage, NexoraTrustAssessment)] {
        app.emails.compactMap { email in
            let assessment = app.trustAssessment(for: email)
            return assessment.warnings.isEmpty && assessment.trustLevel != .suspicious && assessment.trustLevel != .highRisk ? nil : (email, assessment)
        }
        .sorted { $0.1.businessRiskScore > $1.1.businessRiskScore }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        metric(.highRisk)
                        metric(.suspicious)
                    }
                    DisclosureGroup(isExpanded: $showMoreMetrics) {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(SecurityCenterMetric.allCases.filter { ![.highRisk, .suspicious].contains($0) }) { metric in
                                self.metric(metric)
                            }
                        }
                        .padding(.top, 6)
                    } label: {
                        Text("More security metrics").font(.caption.weight(.semibold))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Alerts", systemImage: "exclamationmark.shield.fill").font(.subheadline.weight(.semibold))
                        if assessments.isEmpty {
                            Text("No local trust alerts in the loaded mailbox.").font(.caption).foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(assessments.prefix(8)), id: \.0.emailId) { email, assessment in
                                NavigationLink {
                                    EmailDetailView(email: email).environmentObject(app)
                                } label: {
                                    HStack(alignment: .top, spacing: 8) {
                                        Image(systemName: assessment.trustLevel == .highRisk ? "xmark.shield.fill" : "exclamationmark.shield.fill")
                                            .foregroundStyle(assessment.trustLevel == .highRisk ? .red : .orange)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(email.displaySubject).font(.caption.weight(.semibold)).lineLimit(1)
                                            Text(assessment.warnings.first ?? assessment.explanation).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                                        }
                                        Spacer()
                                        Text("\(assessment.trustScore)").font(.caption.weight(.bold))
                                    }
                                    .padding(8)
                                    .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(12)
                    .glassCard(cornerRadius: 10)
                    VStack(alignment: .leading, spacing: 7) {
                        Label("Protection", systemImage: "eye.slash.fill").font(.subheadline.weight(.semibold))
                        LabeledContent("Tracking", value: "Detected and blocked locally")
                        LabeledContent("Links", value: "Classified before opening")
                        LabeledContent("Attachments", value: "Active content requires review")
                        Text("Local signals are advisory. NEXORA does not claim provider authentication or threat-intelligence verification here.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .glassCard(cornerRadius: 10)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .background(AmbientBackground())
            .navigationTitle("Security Center")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .sheet(item: $selectedMetric) { metric in
                SecurityMetricDetailView(metric: metric, rows: rows(for: metric))
                    .environmentObject(app)
            }
        }
    }

    private func metric(_ metric: SecurityCenterMetric) -> some View {
        Button { selectedMetric = metric } label: {
            VStack(alignment: .leading, spacing: 3) {
                Image(systemName: metric.symbol).foregroundStyle(metric.tint)
                Text("\(rows(for: metric).count)").font(.title3.weight(.bold)).foregroundStyle(.primary)
                HStack {
                    Text(metric.title).font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .glassCard(cornerRadius: 10)
        }
        .buttonStyle(.plain)
        .buttonStyle(ClaudePressStyle())
        .accessibilityHint("Opens \(metric.title) details and remediation")
    }

    private func rows(for metric: SecurityCenterMetric) -> [(EmailMessage, NexoraTrustAssessment)] {
        allAssessments.filter { metric.matches($0.1) }
    }
}

private enum SecurityCenterMetric: String, CaseIterable, Identifiable {
    case highRisk, suspicious, trusted, unknown, tracking, phishing, impersonation
    var id: String { rawValue }
    var title: String {
        switch self {
        case .highRisk: return "High Risk"
        case .suspicious: return "Suspicious"
        case .trusted: return "Trusted"
        case .unknown: return "Unknown"
        case .tracking: return "Tracking"
        case .phishing: return "Phishing"
        case .impersonation: return "Impersonation"
        }
    }
    var symbol: String {
        switch self {
        case .highRisk: return "xmark.shield.fill"
        case .suspicious: return "exclamationmark.shield.fill"
        case .trusted: return "checkmark.shield.fill"
        case .unknown: return "questionmark.diamond.fill"
        case .tracking: return "eye.slash.fill"
        case .phishing: return "link.badge.plus"
        case .impersonation: return "person.crop.circle.badge.exclamationmark"
        }
    }
    var tint: Color {
        switch self {
        case .highRisk, .phishing: return .red
        case .suspicious, .impersonation: return .orange
        case .trusted: return VisualSystemV3.ColorToken.accent
        case .unknown, .tracking: return .secondary
        }
    }
    func matches(_ assessment: NexoraTrustAssessment) -> Bool {
        switch self {
        case .highRisk: return assessment.trustLevel == .highRisk
        case .suspicious: return assessment.trustLevel == .suspicious
        case .trusted: return assessment.trustLevel == .trusted || assessment.trustLevel == .known
        case .unknown: return assessment.trustLevel == .unknown
        case .tracking: return assessment.trackingDetected
        case .phishing: return assessment.phishingRisk == .high || assessment.phishingRisk == .critical
        case .impersonation: return assessment.impersonationRisk == .high || assessment.impersonationRisk == .critical
        }
    }
}

private struct SecurityMetricDetailView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let metric: SecurityCenterMetric
    let rows: [(EmailMessage, NexoraTrustAssessment)]

    var body: some View {
        NavigationStack {
            List {
                Section("What this means") {
                    Text("Review the matching messages, verify the sender and use the message-level trust actions before opening links or attachments.")
                        .font(.callout)
                }
                Section("Messages") {
                    if rows.isEmpty {
                        ContentUnavailableView("No \(metric.title) messages", systemImage: metric.symbol)
                    } else {
                        ForEach(rows, id: \.0.emailId) { email, assessment in
                            VStack(alignment: .leading, spacing: 8) {
                                NavigationLink {
                                    EmailDetailView(email: email).environmentObject(app)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(email.displaySubject).font(.subheadline.weight(.semibold)).lineLimit(1)
                                        Text(assessment.warnings.first ?? assessment.explanation).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                                if metric == .unknown || metric == .suspicious || metric == .highRisk {
                                    HStack(spacing: 8) {
                                        Button("Approve") {
                                            if !app.isFavoriteContact(email.fromAddress) { app.toggleFavoriteContact(email.fromAddress) }
                                        }
                                        .buttonStyle(.borderedProminent)
                                        Button("Ignore") { app.learnSmartMailCategory(.updates, for: email) }
                                            .buttonStyle(.bordered)
                                        Button("Block", role: .destructive) { app.blockSender(email) }
                                            .buttonStyle(.bordered)
                                    }
                                    .controlSize(.small)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(metric.title)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
