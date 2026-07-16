//
//  CommandPaletteView.swift
//  GlassMail
//

import SwiftUI

struct CommandPaletteItem: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let symbol: String
    var isEnabled = true
    var disabledReason: String?
    let action: @MainActor (AppState) async -> Void
}

struct CommandPaletteView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var allItems: [CommandPaletteItem] {
        let staticItems = [
            CommandPaletteItem(title: "Compose New Email", subtitle: "Open draft composer", symbol: "square.and.pencil") { app in
                app.showGlobalCompose = true
            },
            CommandPaletteItem(title: "Go to Today", subtitle: "Local priority, replies, and waiting work", symbol: "sun.max.fill") { app in
                await jumpToInbox(app, filter: "today")
            },
            CommandPaletteItem(title: "Go to Inbox", subtitle: "View primary inbox feed", symbol: "tray.fill") { app in
                await jumpToInbox(app, filter: "all")
            },
            CommandPaletteItem(title: "Go to Needs Reply", subtitle: "Show local reply/action signals", symbol: "arrowshape.turn.up.left.fill") { app in
                jumpToFolder(app, .needsReply)
            },
            CommandPaletteItem(title: "Go to Follow Up", subtitle: "Show local follow-up/reminder signals", symbol: "arrowshape.turn.up.right.fill") { app in
                jumpToFolder(app, .followUp)
            },
            CommandPaletteItem(title: "Go to Waiting", subtitle: "Show local waiting/pending signals", symbol: "clock.fill") { app in
                await jumpToInbox(app, filter: "waiting")
            },
            CommandPaletteItem(title: "Go to Done", subtitle: "Show locally archived mail", symbol: "checkmark.circle.fill") { app in
                jumpToFolder(app, .done)
            },
            CommandPaletteItem(title: "Go to Drafts", subtitle: "Open saved local drafts", symbol: "doc.text.fill") { app in
                jumpToFolder(app, .drafts)
            },
            CommandPaletteItem(title: "Go to Sent", subtitle: "Open backend accepted mail", symbol: "paperplane.fill") { app in
                jumpToFolder(app, .sent)
            },
            CommandPaletteItem(title: "Go to Outbox", subtitle: "Review failed sends and preserved messages", symbol: "tray.and.arrow.up.fill") { app in
                jumpToFolder(app, .outbox)
            },
            CommandPaletteItem(title: "Go to Scheduled", subtitle: "Open locally saved scheduled sends", symbol: "clock.badge.checkmark.fill") { app in
                jumpToFolder(app, .scheduled)
            },
            CommandPaletteItem(title: "Go to Snoozed", subtitle: "Open messages deferred with Remind Me Later", symbol: "clock.arrow.circlepath") { app in
                jumpToFolder(app, .snoozed)
            },
            CommandPaletteItem(title: "Go to Starred", subtitle: "Show starred messages", symbol: "star.fill") { app in
                jumpToFolder(app, .starred)
            },
            CommandPaletteItem(title: "Go to Trash", subtitle: "Open local trash", symbol: "trash.fill") { app in
                jumpToFolder(app, .trash)
            },
            CommandPaletteItem(
                title: "Go to Calendar",
                subtitle: calendarSubtitle,
                symbol: "calendar",
                isEnabled: calendarCommandEnabled,
                disabledReason: calendarDisabledReason
            ) { app in
                app.selectedMainTab = 2
            },
            CommandPaletteItem(title: "Go to Accounts", subtitle: "Manage mailbox accounts", symbol: "person.2.fill") { app in
                app.selectedMainTab = 5
            },
            CommandPaletteItem(title: "Go to AI Center", subtitle: "Apple Intelligence local actions", symbol: "sparkles") { app in
                app.selectedMainTab = 1
            },
            CommandPaletteItem(
                title: "Open AI Workspace",
                subtitle: aiWorkspaceSubtitle,
                symbol: "sparkles.rectangle.stack",
                isEnabled: aiWorkspaceCommandEnabled,
                disabledReason: aiWorkspaceDisabledReason
            ) { app in
                app.aiWorkspaceLaunchTabRaw = CMWorkspaceTab.briefing.rawValue
                app.selectedMainTab = 1
            },
            CommandPaletteItem(
                title: "Draft Reply with AI",
                subtitle: replyDraftSubtitle,
                symbol: "arrowshape.turn.up.left.fill",
                isEnabled: replyDraftCommandEnabled,
                disabledReason: replyDraftDisabledReason
            ) { app in
                app.aiWorkspaceLaunchTabRaw = CMWorkspaceTab.run.rawValue
                app.selectedMainTab = 1
            },
            CommandPaletteItem(
                title: "Translate with AI",
                subtitle: aiWorkspaceSubtitle,
                symbol: "character.book.closed",
                isEnabled: aiWorkspaceCommandEnabled,
                disabledReason: aiWorkspaceDisabledReason
            ) { app in
                app.aiWorkspaceLaunchTabRaw = CMWorkspaceTab.run.rawValue
                app.selectedMainTab = 1
            },
            CommandPaletteItem(
                title: "Rewrite in Compose",
                subtitle: composeAISubtitle,
                symbol: "wand.and.stars",
                isEnabled: app.aiConsent.aiEnabled,
                disabledReason: app.aiConsent.aiEnabled ? nil : "Runtime Disabled: AI is off in Consent Center."
            ) { app in
                app.showGlobalCompose = true
            },
            CommandPaletteItem(
                title: "Open Artifact Center",
                subtitle: "Review AI Workspace outputs",
                symbol: "shippingbox",
                isEnabled: aiWorkspaceCommandEnabled,
                disabledReason: aiWorkspaceDisabledReason
            ) { app in
                app.aiWorkspaceLaunchTabRaw = CMWorkspaceTab.output.rawValue
                app.selectedMainTab = 1
            },
            CommandPaletteItem(
                title: "Summarize Visible Mail",
                subtitle: summarizeSubtitle,
                symbol: "wand.and.stars",
                isEnabled: summarizeCommandEnabled,
                disabledReason: summarizeDisabledReason
            ) { app in
                await app.triageCurrentMailbox()
            },
            CommandPaletteItem(title: "Refresh Mail", subtitle: "Check for new messages", symbol: "arrow.clockwise") { app in
                await app.refresh()
            }
        ]
        return staticItems + mailboxSwitchCommands
    }

    private var mailboxSwitchCommands: [CommandPaletteItem] {
        app.addresses.map { account in
            CommandPaletteItem(
                title: "Switch to \(account.displayProvider.title)",
                subtitle: "\(account.email) · \(account.displayProvider.identityName)",
                symbol: account.displayProvider.symbol
            ) { app in
                app.selectedMainTab = 0
                app.selectedLocalMailbox = .inbox
                app.selectedInboxFilterRaw = "all"
                await app.setMailbox(accountId: account.accountId, provider: account.displayProvider)
            }
        }
    }

    private var calendarCommandEnabled: Bool {
        return true
    }

    private var calendarSubtitle: String {
        "Open Work Calendar Center"
    }

    private var calendarDisabledReason: String? {
        nil
    }

    private var summarizeCommandEnabled: Bool {
        !app.emails.isEmpty && app.providerReadiness[.foundation] == true
    }

    private var summarizeSubtitle: String {
        if app.emails.isEmpty { return "Unavailable until mail is loaded" }
        if app.providerReadiness[.foundation] != true { return "Unavailable until local AI is ready" }
        return "Run local/allowed AI summary on visible mail"
    }

    private var summarizeDisabledReason: String? {
        if app.emails.isEmpty { return "Unavailable: there is no loaded mail to summarize." }
        if app.providerReadiness[.foundation] != true { return "Unavailable: local AI readiness is not active." }
        return nil
    }

    private var aiWorkspaceCommandEnabled: Bool {
        app.aiConsent.aiEnabled
    }

    private var aiWorkspaceSubtitle: String {
        app.aiConsent.aiEnabled ? "Open mailbox-scoped AI workspace" : "Runtime Disabled"
    }

    private var aiWorkspaceDisabledReason: String? {
        app.aiConsent.aiEnabled ? nil : "Runtime Disabled: AI is off in Consent Center."
    }

    private var replyDraftCommandEnabled: Bool {
        app.aiConsent.aiEnabled && !app.emails.isEmpty
    }

    private var replyDraftSubtitle: String {
        if app.emails.isEmpty { return "Provider Offline: load mailbox first" }
        return app.aiConsent.aiEnabled ? "Use loaded mailbox context" : "Runtime Disabled"
    }

    private var replyDraftDisabledReason: String? {
        if !app.aiConsent.aiEnabled { return "Runtime Disabled: AI is off in Consent Center." }
        if app.emails.isEmpty { return "Provider Offline: no loaded mail." }
        return nil
    }

    private var composeAISubtitle: String {
        app.aiConsent.aiEnabled ? "Open Compose for rewrite, shorten, formalize, translate, and tone" : "Runtime Disabled"
    }

    @MainActor
    private func jumpToInbox(_ app: AppState, filter: String) async {
        app.selectedMainTab = 0
        app.selectedLocalMailbox = .inbox
        app.selectedInboxFilterRaw = filter
        await app.setMailbox(accountId: nil, provider: nil)
    }

    @MainActor
    private func jumpToFolder(_ app: AppState, _ folder: LocalMailBoxKind) {
        app.selectedMainTab = 0
        app.selectedInboxFilterRaw = "all"
        app.selectedLocalMailbox = folder
        app.selectedAccountId = nil
        app.selectedProvider = nil
    }

    private var filteredItems: [CommandPaletteItem] {
        guard !search.isEmpty else { return allItems }
        let q = search.lowercased()
        return allItems.filter { $0.title.lowercased().contains(q) || $0.subtitle.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search actions or jump to...", text: $search)
                        .textFieldStyle(.plain)
                        .font(.body)
                    if !search.isEmpty {
                        Button { search = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .background(.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding()

                List(filteredItems) { item in
                    Button {
                        Task {
                            guard item.isEnabled else { return }
                            await item.action(app)
                            app.showCommandPalette = false
                            dismiss()
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.symbol)
                                .font(.title3)
                                .foregroundStyle(item.isEnabled ? Color.accentColor : Color.secondary)
                                .frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(item.isEnabled ? .primary : .secondary)
                                Text(item.disabledReason ?? item.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if item.isEnabled {
                                Image(systemName: "return")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            } else {
                                Text("Unavailable")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 4)
                                    .background(Color.secondary.opacity(0.12), in: Capsule())
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .disabled(!item.isEnabled)
                }
                .listStyle(.plain)
            }
            .background(AmbientBackground())
            .navigationTitle("Command Palette")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        app.showCommandPalette = false
                        dismiss()
                    }
                }
            }
        }
    }
}
