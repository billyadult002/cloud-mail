//
//  AccountsView.swift
//  GlassMail
//

import SwiftUI

struct AccountsView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openURL) private var openURL
    @State private var showingConnector = false
    @State private var selectedMailbox: MailboxCardModel?
    @State private var reconnectingAccountId: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 7) {
                    CompactAccountPillView()
                        .padding(.horizontal, 12)
                        .padding(.top, 2)

                    HStack {
                        Text("Accounts")
                            .font(.headline.weight(.bold))
                        Spacer()
                        Button {
                            showingConnector = true
                        } label: {
                            Label("Add", systemImage: "plus.circle.fill")
                                .font(.caption.weight(.semibold))
                        }
                        .tint(Color(red: 10/255, green: 102/255, blue: 194/255))
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel("Add NEXORA address")
                    }
                    .padding(.horizontal, 12)

                    syncStateSummary
                        .padding(.horizontal, 12)

                    VStack(spacing: 6) {
                        CollapsibleList(
                            items: connectedAccounts,
                            itemName: "mailboxes",
                            searchableText: { "\($0.email) \($0.provider.title) \($0.domain) \($0.status)" }
                        ) { account in
                            mailboxDenseRow(for: account)
                        } empty: {
                            VStack(spacing: 16) {
                                Image(systemName: "tray.fill")
                                    .font(.system(size: 48))
                                    .foregroundStyle(.secondary)
                                Text("No mailboxes connected")
                                    .font(.headline)
                                Text("Tap Add Mailbox above to link an email address or custom domain to NEXORA.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                            .glassCard(cornerRadius: 16)
                        }
                    }
                    .padding(.horizontal, 12)
                }
            }
            .background(AmbientBackground())
            .navigationTitle("Accounts")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .sheet(isPresented: $showingConnector) {
                ExistingMailboxConnectionView()
                    .environmentObject(app)
            }
            .sheet(item: $selectedMailbox) { mailbox in
                mailboxDetailSheet(mailbox)
                    .presentationDetents([.medium, .large])
            }
            .task {
                await app.loadV2Configuration()
                await app.refreshIfStale()
            }
        }
    }

    private var connectedAccounts: [MailboxCardModel] {
        var seenEmails = Set<String>()
        var rows: [MailboxCardModel] = []
        
        for account in app.addresses {
            let emailLower = account.email.lowercased()
            guard !seenEmails.contains(emailLower) else { continue }
            seenEmails.insert(emailLower)
            rows.append(MailboxCardModel(
                id: "address-\(account.accountId)",
                email: account.email,
                provider: account.displayProvider,
                domain: account.displayDomain,
                status: account.statusLabel,
                detail: account.syncError?.isEmpty == false ? account.syncError! : syncDetail(for: account),
                accountId: account.accountId,
                authorizationId: nil,
                lastSync: accountHealthText(for: account),
                latestEmail: latestEmailText(latestEmailAt: account.lastMessageReceivedAt ?? account.latestEmailTime),
                syncOutcome: syncOutcomeText(for: account),
                isDelegated: false,
                canSend: app.canSend(from: account),
                sendStatusReason: app.sendCapabilityReason(for: account)
            ))
        }
        
        for account in app.unifiedAccounts {
            let emailLower = account.email.lowercased()
            guard !seenEmails.contains(emailLower) else { continue }
            seenEmails.insert(emailLower)
            rows.append(MailboxCardModel(
                id: "unified-\(account.id)",
                email: account.email,
                provider: account.provider,
                domain: account.email.split(separator: "@").last.map(String.init) ?? app.domain,
                status: (account.status == "authorized" || account.status == "active") ? "Connected" : account.status.capitalized,
                detail: account.isDelegatedMailbox ? (account.canSend ? "Delegated sending identity" : "Delegated mailbox") : "Unified sending identity",
                accountId: account.readableAccountId,
                authorizationId: account.authorizationId,
                lastSync: account.provider == .cloudflareNative ? "Routing active" : "Health check pending",
                latestEmail: "Not available",
                syncOutcome: nil,
                isDelegated: account.isDelegatedMailbox,
                canSend: account.canSend,
                sendStatusReason: account.sendStatusReason
            ))
        }
        
        return rows.sorted { $0.email.localizedCaseInsensitiveCompare($1.email) == .orderedAscending }
    }

    private var syncStateSummary: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sync State")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(overallSyncState)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .leading, spacing: 4) {
                Text("Last Sync")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(overallLastSync)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
        }
        .padding(8)
        .glassCard(cornerRadius: 8)
    }

    @ViewBuilder
    private func mailboxDenseRow(for account: MailboxCardModel) -> some View {
        Button {
            selectedMailbox = account
        } label: {
            HStack(spacing: 8) {
                MailboxHealthDot(account: account, compact: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.email)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text("\(account.provider.title) · \(identityRole(for: account))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text("Last synced: \(account.lastSync) · Latest email: \(account.latestEmail)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let syncOutcome = account.syncOutcome {
                        Text(syncOutcome)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(identityStatus(for: account))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(statusTint(for: account))
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var overallSyncState: String {
        if connectedAccounts.isEmpty { return "No mailboxes connected" }
        if connectedAccounts.contains(where: \.needsReauthorization) { return "Needs attention" }
        return "Connected"
    }

    private var overallLastSync: String {
        connectedAccounts
            .map(\.lastSync)
            .first { !$0.isEmpty && $0 != "Health check pending" && $0 != "Sync pending" } ?? "Routing active"
    }

    @ViewBuilder
    private func mailboxCard(for account: MailboxCardModel) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                MailboxHealthDot(account: account)

                VStack(alignment: .leading, spacing: 3) {
                    Text(account.email)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text("\(account.provider.title) · \(account.domain) · \(identityRole(for: account))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Text(identityStatus(for: account))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(statusTint(for: account))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(statusTint(for: account).opacity(0.11), in: Capsule())
            }

            HStack(spacing: 8) {
                accountMetric("Auth", account.status)
                accountMetric("Send", account.canSend ? "Can send" : account.sendStatusReason)
                accountMetric("Last synced", account.lastSync)
                accountMetric("Latest email", account.latestEmail)
            }

            HStack(spacing: 8) {
                Button {
                    Task { await app.setMailbox(accountId: account.accountId, provider: account.provider) }
                } label: {
                    Label("Open", systemImage: "tray.fill")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Open mailbox")

                if account.needsReauthorization {
                    Button {
                        reconnectMailbox(account)
                    } label: {
                        Label("Reauthorize", systemImage: "person.badge.key.fill")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel(actionTitle(for: account))
                } else {
                    Button {
                        selectedMailbox = account
                    } label: {
                        Label("Details", systemImage: "info.circle")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel(actionTitle(for: account))
                }

                if (account.provider == .gmail || account.provider == .googleWorkspace), let id = account.accountId {
                    Button {
                        Task { _ = await app.syncGmail(accountId: id) }
                    } label: {
                        Label("Sync", systemImage: "arrow.clockwise")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("Sync Gmail")
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .glassCard(cornerRadius: 12)
    }

    private func accountMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption2.weight(.bold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func mailboxDetailSheet(_ mailbox: MailboxCardModel) -> some View {
        NavigationStack {
            VStack(spacing: 10) {
                Capsule(style: .continuous)
                    .fill(Color.secondary.opacity(0.28))
                    .frame(width: 38, height: 4)
                    .padding(.top, 6)

                HStack(spacing: 10) {
                    MailboxHealthDot(account: mailbox)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mailbox.email)
                            .font(.headline.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        Text("\(mailbox.provider.title) · \(identityRole(for: mailbox))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button("Done") {
                        selectedMailbox = nil
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.bordered)
                }

                if mailbox.requiresGoogleOAuthReconnect || mailbox.needsReauthorization {
                    Button {
                        if mailbox.requiresGoogleOAuthReconnect {
                            reconnectMailbox(mailbox)
                        } else {
                            showingConnector = true
                            selectedMailbox = nil
                        }
                    } label: {
                        Label(actionTitle(for: mailbox), systemImage: "person.badge.key.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isReconnectInFlight(for: mailbox))
                }

                VStack(spacing: 0) {
                    compactDetailRow("Address", mailbox.email)
                    compactDetailRow("Provider", mailbox.provider.title)
                    compactDetailRow("Role", identityRole(for: mailbox))
                    compactDetailRow("Send", identityStatus(for: mailbox))
                    compactDetailRow("Status", mailbox.status)
                    compactDetailRow("Sync", mailbox.lastSync)
                    compactDetailRow("Owner", mailbox.isDelegated ? "Delegated" : "Current profile", showsDivider: false)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                HStack(spacing: 8) {
                    Button {
                        Task { await app.setMailbox(accountId: mailbox.accountId, provider: mailbox.provider) }
                        selectedMailbox = nil
                    } label: {
                        Label("Open", systemImage: "tray.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    if mailbox.isGoogleAccount, mailbox.accountId != nil {
                        Button {
                            reconnectMailbox(mailbox)
                        } label: {
                            Label("Google", systemImage: "person.badge.key.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isReconnectInFlight(for: mailbox))
                    } else if !mailbox.requiresGoogleOAuthReconnect && !mailbox.needsReauthorization {
                        Button {
                            showingConnector = true
                            selectedMailbox = nil
                        } label: {
                            Label("Reconnect", systemImage: "person.badge.key.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .font(.caption.weight(.semibold))

                if let id = mailbox.authorizationId {
                    Button(role: .destructive) {
                        Task { _ = await app.removeMailboxAuthorization(id: id) }
                        selectedMailbox = nil
                    } label: {
                        Label("Remove Mailbox", systemImage: "trash")
                            .font(.caption.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .background(AmbientBackground())
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func compactDetailRow(_ title: String, _ value: String, showsDivider: Bool = true) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 58, alignment: .leading)
                Text(value)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .frame(height: 31)
            if showsDivider {
                Divider()
                    .padding(.leading, 68)
            }
        }
    }

    private func actionTitle(for account: MailboxCardModel) -> String {
        account.requiresGoogleOAuthReconnect ? "Reconnect with Google" : (account.needsReauthorization ? "Reauthorize" : "Authorize")
    }

    private func reconnectMailbox(_ account: MailboxCardModel) {
        guard account.requiresGoogleOAuthReconnect else {
            selectedMailbox = account
            return
        }
        reconnectingAccountId = account.accountId
        Task {
            let url = await app.startGoogleMailboxOAuth(email: account.email, accountId: account.accountId)
            await MainActor.run {
                reconnectingAccountId = nil
                if let url {
                    selectedMailbox = nil
                    openURL(url)
                }
            }
        }
    }

    private func isReconnectInFlight(for account: MailboxCardModel) -> Bool {
        reconnectingAccountId != nil && reconnectingAccountId == account.accountId
    }

    private func identityRole(for account: MailboxCardModel) -> String {
        if account.isDelegated { return "Delegated mailbox" }
        if account.provider == .gmail || account.provider == .googleWorkspace { return "Gmail mailbox" }
        if account.provider == .cloudflareNative { return "Sending identity" }
        return "Receiving identity"
    }

    private func identityStatus(for account: MailboxCardModel) -> String {
        if account.needsReauthorization { return "Needs Reauthorization" }
        if account.isGoogleMailboxConnected { return "Connected" }
        return account.canSend ? "Can send" : account.sendStatusReason
    }

    private func statusTint(for account: MailboxCardModel) -> Color {
        if account.needsReauthorization { return .red }
        if account.canSend || account.isGoogleMailboxConnected { return .green }
        return .orange
    }

    private func syncDetail(for account: MailAddress) -> String {
        if let sync = app.gmailSyncStatusByAccountId[account.accountId] { return sync }
        if account.syncStatus == "authorized_identity_mismatch" {
            return "The authorized Google identity does not match this mailbox. Reconnect and select the matching Google identity."
        }
        if account.syncStatus == "provider_mailbox_unavailable" {
            return "Authorized with Google. Gmail service is unavailable for this mailbox; check Gmail service availability or Workspace licensing."
        }
        if let error = account.syncError, !error.isEmpty { return "Needs Reauthorization: \(error)" }
        if account.displayProvider == .cloudflareNative { return "NEXORA Mail · connected" }
        return "Connected"
    }

    private func lastSyncText(lastSyncedAt: String?) -> String {
        let display = app.accountTimestampDisplayLabel(lastSyncedAt)
        return display == "Never synced" ? "Sync pending" : display
    }

    private func latestEmailText(latestEmailAt: String?) -> String {
        let display = app.accountTimestampDisplayLabel(latestEmailAt)
        return display == "Never synced" ? "No email received" : display
    }

    private func syncOutcomeText(for account: MailAddress) -> String? {
        guard account.displayProvider == .gmail || account.displayProvider == .googleWorkspace,
              account.syncError?.isEmpty != false,
              account.syncStatus == "mailbox_ready",
              (account.lastSuccessfulSyncAt ?? account.lastSyncedAt)?.isEmpty == false,
              (account.lastMessageReceivedAt ?? account.latestEmailTime)?.isEmpty == false else { return nil }
        return "No new emails found in the latest completed check"
    }

    private func accountHealthText(for account: MailAddress) -> String {
        if account.syncStatus == "authorized_identity_mismatch" { return "Google identity does not match this mailbox" }
        if account.syncStatus == "provider_mailbox_unavailable" { return "Gmail mailbox unavailable" }
        if account.syncError?.isEmpty == false { return "Sync failed" }
        if account.displayProvider == .cloudflareNative {
            return "Routing active"
        }
        return lastSyncText(lastSyncedAt: account.lastSuccessfulSyncAt ?? account.lastSyncedAt)
    }
}

private struct MailboxCardModel: Identifiable {
    let id: String
    let email: String
    let provider: UnifiedMailProvider
    let domain: String
    let status: String
    let detail: String
    let accountId: Int?
    let authorizationId: Int?
    let lastSync: String
    let latestEmail: String
    let syncOutcome: String?
    let isDelegated: Bool
    let canSend: Bool
    let sendStatusReason: String

    var needsReauthorization: Bool {
        if status.localizedCaseInsensitiveContains("google identity does not match") { return false }
        if status.localizedCaseInsensitiveContains("gmail mailbox unavailable") { return false }
        return status.localizedCaseInsensitiveContains("reauthorization")
        || status.localizedCaseInsensitiveContains("reconnect")
        || status.localizedCaseInsensitiveContains("error")
        || status.localizedCaseInsensitiveContains("blocked")
        || detail.localizedCaseInsensitiveContains("reauthorization")
        || detail.localizedCaseInsensitiveContains("legacy_imap_unsupported")
        || detail.localizedCaseInsensitiveContains("needs_reconnect")
    }

    var isGoogleAccount: Bool {
        provider == .gmail
        || provider == .googleWorkspace
        || email.lowercased().hasSuffix("@gmail.com")
        || email.lowercased().hasSuffix("@googlemail.com")
    }

    var requiresGoogleOAuthReconnect: Bool {
        isGoogleAccount
        && accountId != nil
        && (needsReauthorization || sendStatusReason.localizedCaseInsensitiveContains("reconnect required"))
    }

    var isGoogleMailboxConnected: Bool {
        guard isGoogleAccount, !needsReauthorization, !requiresGoogleOAuthReconnect else { return false }
        if status.localizedCaseInsensitiveContains("connected") { return true }
        if detail.localizedCaseInsensitiveContains("connected") { return true }
        if detail.localizedCaseInsensitiveContains("synced") { return true }
        return lastSync != "Sync pending" && lastSync != "Health check pending" && lastSync != "Sync failed"
    }
}

private struct MailboxHealthDot: View {
    let account: MailboxCardModel
    var compact: Bool = false

    private var tint: Color {
        if account.needsReauthorization { return .red }
        if account.canSend || account.isGoogleMailboxConnected { return .green }
        return .orange
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(account.provider.identityColor.opacity(0.12))
                .frame(width: compact ? 28 : 42, height: compact ? 28 : 42)
            Circle()
                .stroke(account.provider.identityColor.opacity(0.24), lineWidth: 4)
                .frame(width: compact ? 22 : 34, height: compact ? 22 : 34)
            Circle()
                .fill(tint)
                .frame(width: compact ? 8 : 12, height: compact ? 8 : 12)
            Image(systemName: account.provider.symbol)
                .font((compact ? Font.system(size: 8) : .caption2).weight(.bold))
                .foregroundStyle(account.provider.identityColor)
                .offset(x: compact ? 8 : 12, y: compact ? -8 : -12)
        }
        .accessibilityHidden(true)
    }
}
