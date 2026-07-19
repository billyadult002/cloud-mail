//
//  InboxView.swift
//  GlassMail
//

import SwiftUI
#if os(iOS)
import UIKit
#endif

#if os(iOS)
private let inboxFloatingTabContentInset: CGFloat = 124
#else
private let inboxFloatingTabContentInset: CGFloat = 86
#endif

private struct EmailNavigationRoute: Hashable {
    let email: EmailMessage
#if DEBUG
    var debugAutoAction: String? = nil
#endif

    static func == (lhs: EmailNavigationRoute, rhs: EmailNavigationRoute) -> Bool {
#if DEBUG
        return lhs.email.emailId == rhs.email.emailId && lhs.debugAutoAction == rhs.debugAutoAction
#else
        lhs.email.emailId == rhs.email.emailId
#endif
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(email.emailId)
#if DEBUG
        hasher.combine(debugAutoAction)
#endif
    }
}

/// A stable, server-authoritative sender-bulk surface. It deliberately is not
/// attached to a SwiftUI Menu: nested Menu actions are dismissed before their
/// asynchronous state transition can present reliable feedback on iPhone.
struct SenderBulkClassificationSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let email: EmailMessage
    @State private var contract: SenderBulkDestinationContract?
    @State private var selectedDestination: SenderBulkDestination?
    @State private var preview: SenderBulkPreview?
    @State private var loading = false
    @State private var showingPreview = false
    @State private var resultMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let preview, let selectedDestination, showingPreview {
                    Section("Review") {
                        LabeledContent("Destination", value: "\(selectedDestination.title) · \(selectedDestination.titleZh)")
                        LabeledContent("Conversations", value: String(preview.affectedConversationCount))
                        LabeledContent("Accounts", value: String(preview.accountScope.count))
                        LabeledContent("Provider effect", value: selectedDestination.providerEffect)
                        LabeledContent("Reversible", value: selectedDestination.reversible ? "Yes" : "No")
                        Text("This changes only the current NEXORA category facet. It does not create a future sender rule or move provider mailbox messages.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Section {
                        Button("Apply \(selectedDestination.title)") {
                            execute(preview)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(loading)
                        .accessibilityIdentifier("sender-bulk-confirm")
                        Button("Choose another destination") {
                            showingPreview = false
                            self.preview = nil
                        }
                        .disabled(loading)
                    }
                } else if loading && contract == nil {
                    Section { ProgressView("Loading destinations…") }
                } else if let contract {
                    Section("Scope") {
                        LabeledContent("Conversations", value: String(contract.affectedConversationCount))
                        LabeledContent("Accounts", value: String(contract.accountScope.count))
                        Text(contract.futureMessageBehavior).font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(contract.sections) { section in
                        Section("\(section.title) · \(section.titleZh)") {
                            ForEach(section.destinations) { destination in
                                Button { loadPreview(destination) } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Label("\(destination.title) · \(destination.titleZh)", systemImage: destination.icon)
                                        if !destination.enabled, let reason = destination.disabledReason {
                                            Text(reason).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .disabled(!destination.enabled || loading)
                                .accessibilityIdentifier("sender-bulk-\(destination.id)")
                                .accessibilityLabel(destination.enabled
                                    ? "Move all from sender to \(destination.title)"
                                    : "\(destination.title) unavailable: \(destination.disabledReason ?? "not supported")")
                            }
                        }
                    }
                } else {
                    Section { Button("Load destinations") { loadContract() } }
                }
            }
            .navigationTitle("Move All From Sender")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }.disabled(loading)
                }
            }
        }
        .task(id: email.emailId) { loadContract() }
        .alert("Sender bulk classification", isPresented: Binding(
            get: { resultMessage != nil },
            set: { if !$0 { resultMessage = nil } }
        )) {
            Button("OK", role: .cancel) { resultMessage = nil }
        } message: {
            Text(resultMessage ?? "")
        }
    }

    private func loadContract() {
        guard !loading else { return }
        loading = true
        Task {
            defer { loading = false }
            do { contract = try await app.senderBulkDestinations(for: email) }
            catch { app.errorMessage = error.localizedDescription }
        }
    }

    private func loadPreview(_ destination: SenderBulkDestination) {
        guard !loading else { return }
        loading = true
        selectedDestination = destination
        Task {
            defer { loading = false }
            do {
                preview = try await app.previewSenderBulk(for: email, destination: destination)
                // Always show the review surface. The server is authoritative
                // for scope and capability; the user-visible app must still make
                // the resulting production mutation explicit and confirmable.
                showingPreview = preview != nil
            } catch { app.errorMessage = error.localizedDescription }
        }
    }

    private func execute(_ preview: SenderBulkPreview) {
        guard let selectedDestination else { return }
        loading = true
        Task {
            defer { loading = false }
            do {
                let result = try await app.executeSenderBulk(for: email, destination: selectedDestination, confirmed: true)
                if result.completed == 0, result.failed == 0 {
                    let already = preview.scopeDiagnostics?.alreadyCorrectlyInDestination ?? 0
                    resultMessage = already > 0
                        ? "No change: \(already) conversations are already in \(selectedDestination.title). VIP is a separate priority overlay."
                        : "No eligible conversations remain for \(selectedDestination.title)."
                } else {
                    resultMessage = result.failed == 0
                        ? "Moved \(result.completed) conversations to \(selectedDestination.title)."
                        : "Moved \(result.completed) conversations; \(result.failed) need review."
                }
                contract = try await app.senderBulkDestinations(for: email)
                showingPreview = false
            } catch {
                resultMessage = "Could not apply \(selectedDestination.title): \(error.localizedDescription)"
            }
        }
    }
}

private struct SenderBulkConfirmationSheet: View {
    let preview: SenderBulkPreview?
    let destination: SenderBulkDestination?
    let isExecuting: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text("Confirm sender classification")
                    .font(.title2.weight(.semibold))
                if let preview, let destination {
                    LabeledContent("Destination", value: "\(destination.title) · \(destination.titleZh)")
                    LabeledContent("Conversations", value: String(preview.affectedConversationCount))
                    LabeledContent("Accounts", value: String(preview.accountScope.count))
                    Text("This is a one-time NEXORA classification. It does not create a sender rule or assert a provider mailbox move.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Text("The sender scope preview was unavailable. No change can be applied.")
                        .foregroundStyle(.red)
                }
                Spacer()
                Button("Apply \(destination?.title ?? "classification")") { onConfirm() }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                    .disabled(preview == nil || destination == nil || isExecuting)
                    .accessibilityIdentifier("sender-bulk-confirm")
            }
            .padding()
            .navigationTitle("Move All From Sender")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }.disabled(isExecuting)
                }
            }
        }
        .interactiveDismissDisabled(isExecuting)
    }
}

struct ConversationProjectionDetailView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let projection: ConversationProjection
    @State private var detail: ConversationProjectionDetail?
    @State private var errorMessage: String?
    @State private var isMutating = false

    var body: some View {
        Group {
            if let detail {
                List {
                    Section {
                        Text(detail.projection.preview).font(.subheadline).foregroundStyle(.secondary)
                        if !detail.projection.categoryKeys.isEmpty {
                            Text(detail.projection.categoryKeys.joined(separator: " · ")).font(.caption.weight(.semibold))
                        }
                    }
                    ForEach(detail.messages) { message in
                        Section {
                            Text(message.body.isEmpty ? "No text content" : message.body).textSelection(.enabled)
                        } header: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(message.sender.isEmpty ? "Unknown sender" : message.sender)
                                Text(message.observedAt).font(.caption2)
                            }
                        }
                    }
                    if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button("Read") { mutate("set_read", .bool(true)) }.disabled(isMutating || detail.messages.last == nil)
                        Spacer()
                        Button("Archive") { mutate("move_folder", .string("done")) }.disabled(isMutating || detail.messages.last == nil)
                        Spacer()
                        Button("Trash", role: .destructive) { mutate("move_folder", .string("trash")) }.disabled(isMutating || detail.messages.last == nil)
                    }
                }
            } else if let errorMessage {
                ContentUnavailableView("Conversation unavailable", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
            } else {
                ProgressView("Loading conversation…")
            }
        }
        .navigationTitle(projection.title.isEmpty ? "Conversation" : projection.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do { detail = try await app.conversationProjectionDetail(projection); errorMessage = nil }
        catch { errorMessage = (error as? APIError)?.userMessage ?? error.localizedDescription }
    }

    private func mutate(_ action: String, _ value: CanonicalMutationValue) {
        guard let message = detail?.messages.last else { return }
        isMutating = true
        Task {
            do {
                _ = try await app.mutateProjectionMessage(message, conversationId: projection.conversationId, action: action, value: value)
                await app.refresh()
                if action == "move_folder" { dismiss() } else { await load() }
            } catch { errorMessage = (error as? APIError)?.userMessage ?? error.localizedDescription }
            isMutating = false
        }
    }
}

private struct ClassificationUndoState: Identifiable {
    let id = UUID()
    let email: EmailMessage
    let previous: SmartMailCategory
    let current: SmartMailCategory
}

struct InboxView: View {
    @EnvironmentObject private var app: AppState
    @State private var showSettings = false
    @State private var showAssistant = false
    @State private var showMailboxSwitcher = false
    @State private var showCompose = false
    @State private var contextualComposeEmail: EmailMessage?
    @State private var senderBulkEmail: EmailMessage?
    @State private var classificationEmail: EmailMessage?
    @State private var classificationUndo: ClassificationUndoState?
    @State private var selectedMailboxHealth: MailboxHealthSnapshot?
    @State private var selectedConversationProjection: ConversationProjection?
    @State private var query = ""
    @State private var selectedFilter: InboxFilter = .all
    @State private var selectedWaitingSurface: ConversationProjectionSurface = .waitingForOthers
    @State private var isSelectionMode = false
    @State private var selectedEmailIds: Set<Int> = []
    @State private var expandedAllMail = true
    @State private var expandedUnifiedLocalLedger = true
    @State private var expandedAccountIDs: Set<Int> = []
    @State private var expandedIdentitySection = false
    @State private var expandedMoreSection = false
    @State private var sidebarEditing = false
    @State private var lastVisibleCountReconciliationAt: Date?
    @State private var navigationPath: [EmailNavigationRoute] = []
#if DEBUG
    @State private var debugAutoOpenedSubject: String?
    @State private var debugOutboxAppliedKey: String?
#endif
    @AppStorage("cloudmail_sidebar_hidden_item_ids_v1") private var hiddenSidebarItemIDsRaw = ""

    private var isMergedAllMailView: Bool {
        app.selectedLocalMailbox == .inbox && app.selectedAccountId == nil && app.selectedProvider == nil
    }

    private var filteredEmails: [EmailMessage] {
        if let projections = authoritativeConversationProjections {
            // Authoritative membership, ordering, details and actions are all
            // projection-native. The legacy message list is not consulted.
            _ = projections
            return []
        }
        let result = MailVisibilityEngine.render(
            emails: app.emails,
            selection: MailVisibilitySelection(
                accountId: app.selectedAccountId,
                provider: app.selectedProvider,
                mailbox: app.selectedLocalMailbox,
                filterRawValue: selectedFilter.rawValue,
                query: query,
                mergedAllMail: isMergedAllMailView
            ),
            effectiveFolder: app.effectiveFolder(for:),
            isSnoozed: { app.snoozeScheduler.isSnoozed($0) },
            matchesFolder: matchesSelectedFolder,
            matchesFilter: matchesSelectedFilter,
            matchesSearch: matchesSearch
        )
        // State publication during `body` evaluation can invalidate navigation.
        // Record the render result on the next main-loop turn instead.
        DispatchQueue.main.async {
            app.recordRenderedMailTrace(result.trace)
        }
        return result.emails
    }

    private var authoritativeConversationProjections: [ConversationProjection]? {
        guard app.isConversationProjectionAuthoritative,
              isMergedAllMailView,
              app.selectedLocalMailbox == .inbox else { return nil }
        let surface: ConversationProjectionSurface
        switch selectedFilter {
        case .needsReply: surface = .actionRequired
        case .waiting: surface = selectedWaitingSurface
        case .all: surface = .allMail
        default: surface = .categories
        }
        var rows = app.conversationProjections(for: surface)
        if surface == .categories {
            if let membership = selectedFilter.projectionMembershipKey {
                rows = rows.filter { projection in
                    projection.membershipKeys.contains { $0.caseInsensitiveCompare(membership) == .orderedSame }
                }
            } else if let category = selectedFilter.projectionCategoryKey {
                rows = rows.filter { projection in
                    projection.categoryKeys.contains { $0.caseInsensitiveCompare(category) == .orderedSame }
                }
            } else { return [] }
        }
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !normalizedQuery.isEmpty {
            rows = rows.filter {
                $0.title.lowercased().contains(normalizedQuery)
                    || $0.preview.lowercased().contains(normalizedQuery)
                    || $0.searchDocument.lowercased().contains(normalizedQuery)
            }
        }
        return rows
    }

    private var authoritativeProjectionsWithoutSourceAdapter: [ConversationProjection] {
        authoritativeConversationProjections ?? []
    }

    private func matchesSelectedFolder(_ email: EmailMessage) -> Bool {
        let effectiveFolder = app.effectiveFolder(for: email)
        // Folder moves are canonical, exclusive presentation state. A message
        // moved to Junk, Trash, Archive, Follow Up, To-do, or Snoozed must not
        // remain visible in its former AI bucket (Updates, Promotions, etc.).
        // The All Mail default therefore represents the active Inbox; an
        // explicit target filter or mailbox is required to render another
        // canonical folder.
        if isMergedAllMailView {
            switch selectedFilter {
            case .junk:
                return effectiveFolder == .junk
            case .archived, .completed:
                return effectiveFolder == .done
            case .followUp:
                return effectiveFolder == .followUp
            case .scheduled:
                return effectiveFolder == .snoozed
            default:
                return effectiveFolder == .inbox
            }
        }
        switch app.selectedLocalMailbox {
        case .inbox:
            return effectiveFolder == .inbox
        case .needsReply: return smartClassification(for: email).needsReply
        case .todo: return smartClassification(for: email).todo
        case .followUp: return smartClassification(for: email).followUp
        case .important: return smartClassification(for: email).important
        case .starred: return email.isStarred && effectiveFolder != .trash
        case .junk: return effectiveFolder == .junk
        case .trash: return effectiveFolder == .trash
        case .done: return effectiveFolder == .done
        case .snoozed: return app.snoozeScheduler.isSnoozed(email)
        case .drafts, .sent, .outbox, .scheduled: return true
        }
    }

    private func matchesSelectedFilter(_ email: EmailMessage, rawValue: String) -> Bool {
        guard let filter = InboxFilter(rawValue: rawValue) else { return true }
        switch filter {
            case .today: return queueSemantics(for: email).today
            case .yesterday:
                guard let date = email.date else { return false }
                return Calendar.current.isDateInYesterday(date)
            case .lastSevenDays:
                guard let date = email.date else { return false }
                return date >= Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? .distantPast
            case .all: return true
            case .needsReply: return queueSemantics(for: email).needsReply
            case .priority: return queueSemantics(for: email).priority
            case .waiting: return queueSemantics(for: email).waiting
            case .followUp: return queueSemantics(for: email).followUp
            case .people: return app.smartMailCategory(for: email) == .people
            case .customers: return app.smartMailCategory(for: email) == .customers
            case .work: return app.smartMailCategory(for: email) == .work
            case .finance: return app.smartMailCategory(for: email) == .finance
            case .orders: return app.smartMailCategory(for: email) == .orders
            case .travel: return app.smartMailCategory(for: email) == .travel
            case .notifications: return app.smartMailCategory(for: email) == .notifications
            case .archived, .completed: return app.effectiveFolder(for: email) == .done
            case .scheduled: return app.snoozeScheduler.isSnoozed(email)
            case .urgent: return matchesBriefingCategory(.urgent, email: email)
            case .personal: return app.triageCache[email.emailId]?.category == .personal
            case .updates: return app.smartMailCategory(for: email) == .updates
            case .promotion: return app.smartMailCategory(for: email) == .promotions
            case .social: return app.triageCache[email.emailId]?.category == .social || email.searchableSnippet.contains("social") || email.searchableSnippet.contains("commented")
            case .junk: return app.effectiveFolder(for: email) == .junk
            case .newsletter: return matchesBriefingCategory(.newsletter, email: email)
            case .system: return matchesBriefingCategory(.system, email: email)
            case .unread: return email.isUnread
            case .starred: return email.isStarred
            case .vip: return app.isVIPContact(email.fromAddress)
            case .attachments: return email.attachmentSignalCount > 0
            case .calendar:
                let text = email.searchableSnippet
                return text.contains("calendar") || text.contains("meeting") || text.contains("invite") || text.contains(".ics")
            case .gmail: return email.sourceProvider == .gmail || email.sourceProvider == .googleWorkspace
            case .cloudMail: return email.sourceProvider == .cloudflareNative
        }
    }

    private func matchesSearch(_ email: EmailMessage, query: String) -> Bool {
        let q = query.lowercased()
        let textMatch = email.fromAddress.lowercased().contains(q)
            || email.fromName.lowercased().contains(q)
            || email.displaySubject.lowercased().contains(q)
            || email.searchableSnippet.contains(q)
        let providerMatch = (q == "gmail" && email.sourceProvider == .gmail)
            || (q == "cloudmail" && email.sourceProvider == .cloudflareNative)
            || (q == "cloudflare" && email.sourceProvider == .cloudflareNative)
            || email.sourceProvider.title.lowercased().contains(q)
        let attachmentMatch = (q == "attachment" || q == "attachments" || q == "file" || q == "files")
            && email.attachmentSignalCount > 0
        return textMatch || providerMatch || attachmentMatch || app.smartSearchMatches(email, query: query)
    }

    private func sortEmailsByReceivedTime(_ emails: [EmailMessage]) -> [EmailMessage] {
        emails.sorted { lhs, rhs in
            let left = lhs.date ?? Date(timeIntervalSince1970: TimeInterval(lhs.emailId))
            let right = rhs.date ?? Date(timeIntervalSince1970: TimeInterval(rhs.emailId))
            if left == right {
                return lhs.emailId > rhs.emailId
            }
            return left > right
        }
    }

    private var usesLocalMailboxContent: Bool {
        switch app.selectedLocalMailbox {
        case .drafts, .sent, .outbox, .scheduled: return true
        default: return false
        }
    }

    private var unifiedLocalLedgerItems: [UnifiedLocalLedgerItem] {
        guard !app.isConversationProjectionAuthoritative else { return [] }
        guard isMergedAllMailView, selectedFilter == .all || !query.isEmpty else { return [] }
        let sentItems = app.sentMessages.map { message in
            UnifiedLocalLedgerItem(
                id: "sent-\(message.id.uuidString)",
                title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                subtitle: "Sent · To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                detail: localMessageDetail(
                    base: "\(sentDeliveryBoundaryLabel(for: message)) · From \(message.fromEmail) · \(message.sentAt.formatted(date: .abbreviated, time: .shortened))",
                    attachmentNames: message.attachmentNames
                ),
                icon: LocalMailBoxKind.sent.symbol,
                sortDate: message.sentAt,
                action: .sent(message)
            )
        }
        let outboxItems = app.outboxMessages.map { message in
            UnifiedLocalLedgerItem(
                id: "outbox-\(message.id.uuidString)",
                title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                subtitle: "Outbox · To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                detail: localMessageDetail(base: message.lastError, attachmentNames: message.attachmentNames),
                icon: LocalMailBoxKind.outbox.symbol,
                sortDate: message.updatedAt,
                action: .outbox(message)
            )
        }
        let draftItems = app.drafts.map { draft in
            UnifiedLocalLedgerItem(
                id: "draft-\(draft.id.uuidString)",
                title: ProductSafeText.sanitize(draft.subject.isEmpty ? "(no subject)" : draft.subject, context: .preview),
                subtitle: "Draft · To: \(ProductSafeText.sanitize(draft.to.isEmpty ? "No recipient" : draft.to, context: .compose))",
                detail: localMessageDetail(
                    base: "From \(draft.fromEmail) · \(draft.updatedAt.formatted(date: .abbreviated, time: .shortened))",
                    attachmentNames: draft.displayAttachmentNames
                ),
                icon: LocalMailBoxKind.drafts.symbol,
                sortDate: draft.updatedAt,
                action: .draft(draft)
            )
        }
        let scheduledItems = app.scheduledMessages.map { message in
            UnifiedLocalLedgerItem(
                id: "scheduled-\(message.id.uuidString)",
                title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                subtitle: "Scheduled · To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                detail: "\(ProductSafeText.sanitize(message.status, context: .attachmentStatus)) · \(message.scheduledAt.formatted(date: .abbreviated, time: .shortened))",
                icon: LocalMailBoxKind.scheduled.symbol,
                sortDate: message.scheduledAt,
                action: .scheduled(message)
            )
        }
        let items = (sentItems + outboxItems + draftItems + scheduledItems)
            .sorted { $0.sortDate > $1.sortDate }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return items }
        let normalizedQuery = normalizedLocalLedgerSearchText(q)
        return items.filter { item in
            item.searchText.contains(q) || item.normalizedSearchText.contains(normalizedQuery)
        }
    }

    private func allMailVisibleCount(visibleEmails: [EmailMessage], localLedgerItems: [UnifiedLocalLedgerItem]) -> Int {
        if let projections = authoritativeConversationProjections { return projections.count }
        return isMergedAllMailView ? visibleEmails.count + localLedgerItems.count : visibleEmails.count
    }

    private func normalizedLocalLedgerSearchText(_ value: String) -> String {
        value
            .lowercased()
            .map { $0.isLetter || $0.isNumber ? String($0) : " " }
            .joined()
            .split(separator: " ")
            .joined(separator: " ")
    }

    private func smartClassification(for email: EmailMessage) -> SmartFolderClassification {
        let smart = app.smartMailClassification(for: email)
        let triage = app.triageCache[email.emailId]
        let haystack = email.searchableSnippet
        let marketingOrAutomated = smart.category == .promotions || smart.category == .notifications
        let eligibleForWorkQueue = !marketingOrAutomated
        let needsReply = smart.actionRequired
            || (eligibleForWorkQueue && triage?.actionRequired == true)
            || (eligibleForWorkQueue && (haystack.contains("please reply")
                || haystack.contains("can you")
                || haystack.contains("could you")
                || haystack.contains("let me know")
                || haystack.contains("waiting for your")))
        let todo = eligibleForWorkQueue && (triage?.actionRequired == true
            || haystack.contains("todo")
            || haystack.contains("to-do")
            || haystack.contains("action item")
            || haystack.contains("please review")
            || haystack.contains("need you to"))
        let followUp = eligibleForWorkQueue && (haystack.contains("follow up")
            || haystack.contains("follow-up")
            || haystack.contains("circle back"))
        let waiting = smart.waitingReply || (eligibleForWorkQueue && (haystack.contains("waiting on")
            || haystack.contains("waiting for")
            || haystack.contains("waiting until")
            || haystack.contains("pending")
            || haystack.contains("checking in")
            || haystack.contains("reminder")))
        let important = smart.priority
        let junk = smart.category == .promotions && triage?.category == .spam
            || haystack.contains("unsubscribe")
            || haystack.contains("limited time offer")
            || haystack.contains("you won")
        return SmartFolderClassification(
            needsReply: needsReply,
            todo: todo,
            followUp: followUp,
            waiting: waiting,
            important: important,
            junk: junk
        )
    }

    private func queueSemantics(for email: EmailMessage) -> MailQueueSemantics {
        let classification = smartClassification(for: email)
        return MailQueueSemantics(
            today: classification.important || classification.needsReply || classification.followUp || classification.waiting,
            needsReply: classification.needsReply,
            followUp: classification.followUp,
            waiting: classification.waiting,
            priority: classification.important
        )
    }

    private var selectedBriefingCategory: MailBriefingCategory? {
        MailBriefingCategory.allCases.first { $0.filterRawValue == selectedFilter.rawValue }
    }

    private func matchesBriefingCategory(_ category: MailBriefingCategory, email: EmailMessage) -> Bool {
        let triage = app.triageCache[email.emailId]
        let haystack = email.searchableSnippet
        switch category {
        case .needReply:
            return queueSemantics(for: email).needsReply
        case .waiting:
            return queueSemantics(for: email).waiting
        case .followUp:
            return queueSemantics(for: email).followUp
        case .urgent:
            return triage?.category == .urgent
                || haystack.contains("urgent")
                || haystack.contains("asap")
                || haystack.contains("deadline")
                || haystack.contains("important")
        case .personal:
            return triage?.category == .personal
        case .updates:
            return triage?.category == .promotion || email.attachmentSignalCount > 0
        case .newsletter:
            return triage?.category == .newsletter
                || haystack.contains("newsletter")
                || haystack.contains("unsubscribe")
        case .system:
            return haystack.contains("security")
                || haystack.contains("system")
                || haystack.contains("alert")
                || haystack.contains("verification")
        }
    }

    private var activeAccount: MailAddress? {
        guard let id = app.selectedAccountId else { return nil }
        return app.addresses.first { $0.accountId == id }
    }

    private var activeUnifiedAccount: UnifiedMailAccount? {
        guard let id = app.selectedAccountId else { return nil }
        return app.unifiedAccounts.first { $0.readableAccountId == id }
    }

    private var selectedProviderAccount: MailAddress? {
        guard let provider = app.selectedProvider else { return nil }
        return app.addresses.first { $0.displayProvider == provider }
    }

    private var selectedUnifiedProviderAccount: UnifiedMailAccount? {
        guard let provider = app.selectedProvider else { return nil }
        return app.unifiedAccounts.first { $0.provider == provider }
    }

    private var providerAccountEmail: String {
        selectedProviderAccount?.email ?? selectedUnifiedProviderAccount?.email ?? ""
    }

    private var providerAccountDomain: String {
        if let account = selectedProviderAccount { return account.displayDomain }
        if let email = selectedUnifiedProviderAccount?.email {
            return email.split(separator: "@").last.map(String.init) ?? ""
        }
        return ""
    }

    private var mailboxScopeLabel: String {
        if let activeAccount { return activeAccount.email }
        if let activeUnifiedAccount { return activeUnifiedAccount.email }
        if app.selectedProvider != nil, !providerAccountEmail.isEmpty { return providerAccountEmail }
        return "All Mail"
    }

    private var mailboxSubtitle: String {
        if let activeAccount {
            return "\(activeAccount.displayProvider.title) · \(activeAccount.displayDomain)"
        }
        if let activeUnifiedAccount {
            let domain = activeUnifiedAccount.email.split(separator: "@").last.map(String.init) ?? ""
            let ownership = activeUnifiedAccount.isDelegatedMailbox ? "Delegated mailbox" : "Unified mailbox"
            return "\(activeUnifiedAccount.provider.title) · \(domain) · \(ownership)"
        }
        if let provider = app.selectedProvider {
            if !providerAccountEmail.isEmpty {
                return "\(provider.title) · \(providerAccountDomain)"
            }
            if provider == .gmail {
                return "No Gmail connected to this NEXORA account"
            }
            return "No connected \(provider.title) account for this login"
        }
        return "All connected mail in NEXORA"
    }

    private var compactMailboxHeaderText: String {
        if let activeAccount {
            return "\(activeAccount.email) · \(activeAccount.displayProvider.title)"
        }
        if app.selectedLocalMailbox != .inbox {
            return "\(app.selectedLocalMailbox.title) · \(app.primaryIdentityEmail)"
        }
        if let provider = app.selectedProvider {
            if !providerAccountEmail.isEmpty {
                return "\(providerAccountEmail) · \(provider.title)"
            }
            return "All mail"
        }
        return "All Mail"
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                #if os(iOS)
                ZStack(alignment: .top) {
                    AmbientBackground()
                    content
                        .contentShape(Rectangle())
                        .simultaneousGesture(edgeOpenGesture)
                    if let error = app.errorMessage {
                        ErrorBanner(message: error) { app.errorMessage = nil }
                            .padding(.top, 6)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    if let undo = classificationUndo {
                        classificationUndoBanner(undo)
                            .padding(.top, app.errorMessage == nil ? 6 : 82)
                            .transition(.opacity)
                    }
                }
                #else
                HStack(spacing: 0) {
                    if showMailboxSwitcher {
                        mailboxDrawer
                            .frame(width: 330)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                        Divider()
                    }
                    ZStack(alignment: .top) {
                        AmbientBackground()
                        content
                            .contentShape(Rectangle())
                        if let error = app.errorMessage {
                            ErrorBanner(message: error) { app.errorMessage = nil }
                                .padding(.top, 6)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                }
                .animation(VisualSystemV3.Motion.disclosure, value: showMailboxSwitcher)
                .frame(minWidth: 860, minHeight: 620)
                #endif
            }
            .navigationTitle("Inbox")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { toolbarContent }
            #if !os(iOS)
            .searchable(text: $query, prompt: "Search mail")
            #endif
            .sheet(isPresented: $showSettings) {
                SettingsView().environmentObject(app)
            }
            .sheet(isPresented: $showAssistant) {
                NavigationStack {
                    AIMailAssistantView().environmentObject(app)
                }
            }
            .sheet(isPresented: $showCompose) {
                ComposeView(isPresentedAsSheet: true)
                    .environmentObject(app)
            }
            .fullScreenCover(item: $contextualComposeEmail) { email in
                ComposeView(isPresentedAsSheet: true, original: email)
                    .environmentObject(app)
            }
            .sheet(item: $senderBulkEmail) { email in
                SenderBulkClassificationSheet(email: email)
                    .environmentObject(app)
            }
            .confirmationDialog("Classify message", isPresented: Binding(
                get: { classificationEmail != nil },
                set: { if !$0 { classificationEmail = nil } }
            )) {
                ForEach(SmartMailCategory.allCases.filter { $0 != .unread && $0 != .archived }) { category in
                    Button(category.rawValue) {
                        if let email = classificationEmail { applyClassification(category, to: email) }
                        classificationEmail = nil
                    }
                }
                Button("Cancel", role: .cancel) { classificationEmail = nil }
            } message: {
                Text("The category updates immediately and your correction becomes the strongest future signal.")
            }
            #if os(iOS)
            .sheet(isPresented: $showMailboxSwitcher) {
                mailboxSwitcherSheet
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            #endif
            .sheet(item: $selectedMailboxHealth) { row in
                MailboxDetailView(row: row, trust: app.dataTrustSnapshot, sync: app.syncObservabilitySnapshot)
                    .environmentObject(app)
            }
            .sheet(item: $selectedConversationProjection) { projection in
                NavigationStack { ConversationProjectionDetailView(projection: projection).environmentObject(app) }
            }
            .refreshable { await app.refresh() }
            .onAppear {
                applyAppInboxFilterCommand()
                reconcileVisibleCountIfNeeded()
                app.mainTabBarHidden = !navigationPath.isEmpty
            }
            .onChange(of: app.selectedInboxFilterRaw) { _, _ in
                applyAppInboxFilterCommand()
                reconcileVisibleCountIfNeeded()
            }
            .onChange(of: app.emails.count) { _, _ in
                reconcileVisibleCountIfNeeded()
            }
            .onChange(of: navigationPath) { _, path in
                app.mainTabBarHidden = !path.isEmpty
            }
            .onChange(of: isSelectionMode) { _, selecting in
                app.mainTabBarHidden = selecting || !navigationPath.isEmpty
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        let visibleEmails = filteredEmails
        let localLedgerItems = unifiedLocalLedgerItems
        let visibleCount = allMailVisibleCount(visibleEmails: visibleEmails, localLedgerItems: localLedgerItems)
        if usesLocalMailboxContent {
            localMailboxContent
        } else
        if app.emails.isEmpty && localLedgerItems.isEmpty {
            VStack(spacing: 16) {
                mailboxHeader(visibleCount: visibleCount)
                    .padding(.horizontal)
                    .padding(.top, 6)
                miniMailOSHeader(visibleEmails: visibleEmails)
                    .padding(.horizontal)
                if app.isLoading {
                    ProgressView("Loading your mail…")
                        .padding(.top, 60)
                } else {
                    inboxSearchField
                        .padding(.horizontal)
                    inboxFilterBar
                        .padding(.horizontal)
                    emptyState
                }
            }
        } else {
            List {
                Section {
                    mailboxHeader(visibleCount: visibleCount)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                    miniMailOSHeader(visibleEmails: visibleEmails)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                    inboxSearchField
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                    inboxFilterBar
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 2, trailing: 16))
                }
                if !localLedgerItems.isEmpty {
                    unifiedLocalLedgerSection(localLedgerItems)
                }
                ForEach(authoritativeProjectionsWithoutSourceAdapter) { projection in
                    Button { selectedConversationProjection = projection } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(projection.title.isEmpty ? "(no subject)" : projection.title).font(.headline).lineLimit(1)
                            Text(projection.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            HStack {
                                Text("\(projection.messageCount) message\(projection.messageCount == 1 ? "" : "s")")
                                if projection.actionRequired { Label("Action required", systemImage: "bolt.fill") }
                            }.font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("conversation-projection-row-\(projection.conversationId)")
                    .accessibilityLabel("\(projection.title). \(projection.messageCount) messages.")
                }
                if visibleEmails.isEmpty && localLedgerItems.isEmpty && authoritativeProjectionsWithoutSourceAdapter.isEmpty {
                    emptyState
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else if shouldGroupInbox(visibleEmails) {
                    ForEach(inboxSmartGroups(for: visibleEmails)) { group in
                        Section {
                            ForEach(group.emails) { email in
                                inboxEmailRow(email)
                            }
                        } header: {
                            smartGroupHeader(group)
                                .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 0, trailing: 0))
                        }
                    }
                    loadMoreRow
                } else {
                    ForEach(visibleEmails) { email in
                        inboxEmailRow(email)
                    }
                    loadMoreRow
                }
            }
            .listStyle(.plain)
            .listRowSpacing(3)
            .scrollContentBackground(.hidden)
            .safeAreaInset(edge: .bottom) {
                if isSelectionMode {
                    selectionBottomBar(visibleEmails: visibleEmails)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    Color.clear.frame(height: inboxFloatingTabContentInset)
                }
            }
            .navigationDestination(for: EmailNavigationRoute.self) { route in
#if DEBUG
                EmailDetailView(
                    email: route.email,
                    debugAutoAction: route.debugAutoAction,
                    onBack: { if !navigationPath.isEmpty { navigationPath.removeLast() } }
                )
                .environmentObject(app)
#else
                EmailDetailView(
                    email: route.email,
                    onBack: { if !navigationPath.isEmpty { navigationPath.removeLast() } }
                )
                    .environmentObject(app)
#endif
            }
#if DEBUG
            .onAppear(perform: applyDebugOpenSubjectLaunchArgumentIfNeeded)
            .onChange(of: app.emails.map(\.emailId)) { _, _ in
                applyDebugOpenSubjectLaunchArgumentIfNeeded()
            }
            .onChange(of: app.currentUser?.email) { _, _ in
                debugOutboxAppliedKey = nil
                applyDebugOutboxLaunchArgumentsIfNeeded()
            }
            .task {
                applyDebugOutboxLaunchArgumentsIfNeeded()
                applyDebugInboxQueryLaunchArgumentIfNeeded()
            }
#endif
        }
    }

#if DEBUG
    private func applyDebugOpenSubjectLaunchArgumentIfNeeded() {
        guard let subject = Self.launchArgumentValue("-CloudMailOpenSubject") ?? ProcessInfo.processInfo.environment["CLOUDMAIL_OPEN_SUBJECT"],
              debugAutoOpenedSubject != subject else { return }
        guard let email = app.emails.first(where: { $0.displaySubject == subject }) else { return }
        selectedFilter = .all
        query = ""
        debugAutoOpenedSubject = subject
#if DEBUG
        navigationPath = [
            EmailNavigationRoute(
                email: email,
                debugAutoAction: ProcessInfo.processInfo.environment["CLOUDMAIL_DETAIL_ACTION"]
            )
        ]
#else
        navigationPath = [EmailNavigationRoute(email: email)]
#endif
    }

    private static func launchArgumentValue(_ key: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: key),
              arguments.indices.contains(index + 1) else { return nil }
        let value = arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func applyDebugOutboxLaunchArgumentsIfNeeded() {
        if let mailbox = Self.launchArgumentValue("-CloudMailInitialMailbox")?.lowercased(),
           mailbox == "outbox" {
            app.selectedLocalMailbox = .outbox
            app.selectedAccountId = nil
            app.selectedProvider = nil
            selectedFilter = .all
            query = Self.launchArgumentValue("-CloudMailOutboxQuery") ?? ""
        }
        guard let subject = Self.launchArgumentValue("-CloudMailOutboxSubject") else { return }
        let rawState = Self.launchArgumentValue("-CloudMailOutboxState") ?? "failed"
        let applyKey = "\(app.currentUser?.email ?? "pending")|\(subject)|\(rawState)|\(ProcessInfo.processInfo.arguments.contains("-CloudMailOutboxCancel"))"
        guard debugOutboxAppliedKey != applyKey else { return }
        debugOutboxAppliedKey = applyKey
        let from = Self.launchArgumentValue("-CloudMailOutboxFrom") ?? app.defaultSendingIdentity?.email ?? "saercpku@gmail.com"
        let to = Self.launchArgumentValue("-CloudMailOutboxTo") ?? "invalid-recipient"
        if ProcessInfo.processInfo.arguments.contains("-CloudMailOutboxCancel") {
            app.debugCancelOutboxSmoke(subject: subject)
            return
        }
        let state: DeliveryState
        switch rawState.lowercased() {
        case "retry", "retry_scheduled":
            state = .retryScheduled
        case "cancelled", "canceled":
            state = .cancelled
        case "dead":
            state = .dead
        default:
            state = .failedPermanent
        }
        app.debugSeedOutboxSmoke(subject: subject, state: state, fromEmail: from, to: to)
    }

    private func applyDebugInboxQueryLaunchArgumentIfNeeded() {
        guard let search = Self.launchArgumentValue("-CloudMailInboxQuery") else { return }
        app.selectedLocalMailbox = .inbox
        app.selectedAccountId = nil
        app.selectedProvider = nil
        selectedFilter = .all
        query = search
    }
#endif

    @ViewBuilder
    private var localMailboxContent: some View {
        let visibleEmails = filteredEmails
        List {
            Section {
                mailboxHeader(visibleCount: visibleEmails.count)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                miniMailOSHeader(visibleEmails: visibleEmails)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            switch app.selectedLocalMailbox {
            case .drafts:
                if app.drafts.isEmpty { localEmptyRow("No drafts", "Save a message draft from Compose.") }
                ForEach(app.drafts) { draft in
                    LocalMessageRow(
                        title: ProductSafeText.sanitize(draft.subject.isEmpty ? "(no subject)" : draft.subject, context: .preview),
                        subtitle: "To: \(ProductSafeText.sanitize(draft.to.isEmpty ? "No recipient" : draft.to, context: .compose))",
                        detail: localMessageDetail(
                            base: "From \(draft.fromEmail) · \(draft.updatedAt.formatted(date: .abbreviated, time: .shortened))",
                            attachmentNames: draft.attachmentNames
                        ),
                        icon: LocalMailBoxKind.drafts.symbol
                    )
                    .listRowBackground(Color.clear)
                    .swipeActions {
                        Button(role: .destructive) { app.deleteDraft(draft) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            case .sent:
                if app.sentMessages.isEmpty { localEmptyRow("No sent mail yet", "Messages sent from NEXORA appear here after the provider accepts them.") }
                ForEach(app.sentMessages) { message in
                    LocalMessageRow(
                        title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                        subtitle: "To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                        detail: localMessageDetail(
                            base: "\(sentDeliveryBoundaryLabel(for: message)) · From \(message.fromEmail) · \(message.sentAt.formatted(date: .abbreviated, time: .shortened))",
                            attachmentNames: message.attachmentNames
                        ),
                        icon: LocalMailBoxKind.sent.symbol
                    )
                    .listRowBackground(Color.clear)
                    .swipeActions {
                        Button(role: .destructive) { app.deleteSentMessage(message) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            case .outbox:
                if app.outboxMessages.isEmpty { localEmptyRow("Outbox is clear", "Failed sends will stay here with the real error.") }
                ForEach(app.outboxMessages) { message in
                    LocalMessageRow(
                        title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                        subtitle: "To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                        detail: localMessageDetail(base: message.lastError, attachmentNames: message.attachmentNames),
                        icon: LocalMailBoxKind.outbox.symbol
                    )
                    .listRowBackground(Color.clear)
                    .swipeActions {
                        Button { app.cancelOutboxMessage(message) } label: {
                            Label("Cancel", systemImage: "xmark.circle")
                        }
                        .tint(.orange)
                        Button(role: .destructive) { app.deleteOutboxMessage(message) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            case .scheduled:
                if app.scheduledMessages.isEmpty { localEmptyRow("No scheduled sends", "Schedule Send is visible but automatic delivery is not enabled in this build.") }
                ForEach(app.scheduledMessages) { message in
                    LocalMessageRow(
                        title: ProductSafeText.sanitize(message.subject.isEmpty ? "(no subject)" : message.subject, context: .preview),
                        subtitle: "To: \(ProductSafeText.sanitize(message.to, context: .compose))",
                        detail: "\(ProductSafeText.sanitize(message.status, context: .attachmentStatus)) · \(message.scheduledAt.formatted(date: .abbreviated, time: .shortened))",
                        icon: LocalMailBoxKind.scheduled.symbol
                    )
                    .listRowBackground(Color.clear)
                    .swipeActions {
                        Button(role: .destructive) { app.deleteScheduledMessage(message) } label: {
                            Label("Cancel", systemImage: "xmark.circle")
                        }
                    }
                }
            case .inbox, .needsReply, .todo, .followUp, .important, .starred, .junk, .trash, .done, .snoozed:
                EmptyView()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: inboxFloatingTabContentInset)
        }
#if DEBUG
        .onAppear(perform: applyDebugOutboxLaunchArgumentsIfNeeded)
        .onChange(of: app.currentUser?.email) { _, _ in
            debugOutboxAppliedKey = nil
            applyDebugOutboxLaunchArgumentsIfNeeded()
        }
        .task {
            applyDebugOutboxLaunchArgumentsIfNeeded()
        }
#endif
    }

    private func localEmptyRow(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 16)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private func localMessageDetail(base: String, attachmentNames: [String]?) -> String {
        let safeBase = ProductSafeText.sanitize(base, context: .outbox)
        guard let attachmentNames, !attachmentNames.isEmpty else { return safeBase }
        return "\(safeBase) · \(attachmentNames.count) attachment\(attachmentNames.count == 1 ? "" : "s")"
    }

    private func unifiedLocalLedgerSection(_ items: [UnifiedLocalLedgerItem]) -> some View {
        let isSearching = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let shouldShowItems = expandedUnifiedLocalLedger || isSearching
        return Section {
            if shouldShowItems {
                ForEach(items) { item in
                    LocalMessageRow(
                        title: item.title,
                        subtitle: item.subtitle,
                        detail: item.detail,
                        icon: item.icon
                    )
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                    .accessibilityIdentifier("All Mail local ledger \(item.id)")
                    .swipeActions(edge: .trailing) {
                        localLedgerDeleteButton(for: item)
                    }
                }
            }
        } header: {
            Button {
                withAnimation(VisualSystemV3.Motion.disclosure) {
                    expandedUnifiedLocalLedger.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: shouldShowItems ? "chevron.down.circle.fill" : "chevron.right.circle.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                    Text("Unified local mail")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.primary)
                    Text("\(items.count)")
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if isSearching {
                        Text("Search results")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Latest first")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("All Mail unified local ledger disclosure")
            .accessibilityLabel(shouldShowItems ? "Collapse unified local mail" : "Expand unified local mail")
            .textCase(nil)
        }
    }

    @ViewBuilder
    private func localLedgerDeleteButton(for item: UnifiedLocalLedgerItem) -> some View {
        switch item.action {
        case .sent(let message):
            Button(role: .destructive) { app.deleteSentMessage(message) } label: {
                Label("Delete", systemImage: "trash")
            }
        case .outbox(let message):
            Button(role: .destructive) { app.deleteOutboxMessage(message) } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }
        case .draft(let draft):
            Button(role: .destructive) { app.deleteDraft(draft) } label: {
                Label("Delete", systemImage: "trash")
            }
        case .scheduled(let message):
            Button(role: .destructive) { app.deleteScheduledMessage(message) } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }
        }
    }

    private func sentDeliveryBoundaryLabel(for message: LocalSentMessage) -> String {
        guard let deliveryState = message.deliveryState else {
            return message.backendAccepted ? "Provider accepted; delivery not confirmed" : "Delivery status unavailable"
        }
        switch deliveryState {
        case .delivered:
            return "Received confirmed by backend"
        case .providerAccepted, .providerConfirmed, .sent:
            return "Provider accepted; delivery not confirmed"
        default:
            return ProductSafeText.sanitize(deliveryState.rawValue, context: .outbox)
        }
    }

    private func shouldGroupInbox(_ emails: [EmailMessage]) -> Bool {
        app.selectedLocalMailbox == .inbox
            && selectedFilter == .all
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && emails.count > 3
    }

    private func inboxSmartGroups(for emails: [EmailMessage]) -> [InboxSmartGroup] {
        let buckets = Dictionary(grouping: emails, by: smartBucket(for:))
        let presentation: [(InboxSmartBucket, String, String)] = [
            (.critical, "VIP & Priority", "bolt.shield.fill"),
            (.people, "People", "person.2.fill"),
            (.operations, "Operations", "building.2.fill"),
            (.updates, "Updates", "bell.fill"),
            (.promotions, "Promotions", "tag.fill")
        ]
        // Filtering only compacts empty presentation groups. It never changes
        // the underlying semantic category or removes a message from All Mail.
        return presentation.compactMap { bucket, title, symbol in
            guard let items = buckets[bucket], !items.isEmpty else { return nil }
            return InboxSmartGroup(id: bucket, title: title, symbol: symbol, emails: sortEmailsByReceivedTime(items))
        }
    }

    private func smartBucket(for email: EmailMessage) -> InboxSmartBucket {
        let smart = app.smartMailClassification(for: email)
        if smart.category != .promotions && app.isVIPContact(email.fromAddress) { return .critical }
        if smart.priority || smart.category == .priority || smart.category == .actionRequired { return .critical }
        switch smart.category {
        case .people, .customers, .work: return .people
        case .finance, .orders, .travel, .notifications: return .operations
        case .updates: return .updates
        case .promotions: return .promotions
        case .unread, .other, .archived: return .updates
        case .priority, .actionRequired: return .critical
        }
    }

    @ViewBuilder
    private func smartGroupHeader(_ group: InboxSmartGroup) -> some View {
        HStack(spacing: 6) {
            Image(systemName: group.symbol)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 16)
            Text(group.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("\(group.emails.count)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func inboxEmailRow(_ email: EmailMessage) -> some View {
        if isSelectionMode {
            Button {
                if selectedEmailIds.contains(email.emailId) {
                    selectedEmailIds.remove(email.emailId)
                } else {
                    selectedEmailIds.insert(email.emailId)
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: selectedEmailIds.contains(email.emailId) ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(selectedEmailIds.contains(email.emailId) ? Color.accentColor : Color.secondary)
                    EmailRow(email: email)
                }
            }
            .buttonStyle(.plain)
            .mailRowActions(
                email: email,
                accessibilityLabel: emailRowAccessibilityLabel(email),
                selectionMode: true,
                moveToJunk: { _ in },
                restoreToInbox: { _ in },
                triage: { _ in },
                classify: { _ in }
            )
        } else {
            // The old composition nested EmailRow's star Button inside this
            // navigation Button. UIKit can then route the entire row tap to
            // the nested control host, leaving visible rows non-interactive.
            // Keep the two intentional controls as siblings.
            HStack(spacing: 0) {
                Button {
                    navigationPath.append(EmailNavigationRoute(email: email))
                } label: {
                    EmailRow(email: email, showsInlineStarControl: false)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                EmailRowStarControl(email: email)
            }
            .contextMenu { contextualActions(for: email) }
            .mailRowActions(
                email: email,
                accessibilityLabel: emailRowAccessibilityLabel(email),
                selectionMode: false,
                moveToJunk: { row in Task { _ = await app.moveToJunk(row) } },
                restoreToInbox: { row in Task { _ = await app.restoreToInbox(row) } },
                triage: { row in
                    Task {
                        guard await app.triageLocal(row, force: true) != nil else { return }
                        app.errorMessage = "Message briefing is ready."
                    }
                },
                classify: { row in classificationEmail = row }
            )
        }
    }

    @ViewBuilder
    private func contextualActions(for email: EmailMessage) -> some View {
        Button { summarizeAndOpen(email) } label: { Label("Summarize Thread", systemImage: "text.alignleft") }
        Button { Task { await app.move(email, to: .followUp) } } label: { Label("Create Follow Up", systemImage: "arrowshape.turn.up.right.fill") }
        Button { createMission(for: email, deliverable: nil) } label: { Label("Create Mission", systemImage: "target") }
        Button { contextualComposeEmail = email } label: { Label("Draft Reply With AI", systemImage: "wand.and.stars") }
        Button { createMission(for: email, deliverable: .customerBrief) } label: { Label("Create Customer Brief", systemImage: "person.text.rectangle") }
        Button { createMission(for: email, deliverable: .meetingBrief) } label: { Label("Create Meeting Brief", systemImage: "calendar.badge.clock") }
        Button { Task { await app.move(email, to: .todo) } } label: { Label("Move To Queue", systemImage: "checklist") }
        Button { senderBulkEmail = email } label: {
            Label("Move All From Sender", systemImage: "person.crop.circle.badge.arrow.forward")
        }
        .accessibilityIdentifier("move-all-from-sender")
        Button { navigationPath.append(EmailNavigationRoute(email: email)) } label: { Label("Trust Analysis", systemImage: "checkmark.shield") }
    }

    private func summarizeAndOpen(_ email: EmailMessage) {
        Task {
            await app.triageLocal(email, force: true)
            navigationPath.append(EmailNavigationRoute(email: email))
        }
    }

    private func moveAllFromSender(_ email: EmailMessage, to folder: LocalMailBoxKind) {
        Task {
            let result = await app.moveAllFromSender(email, to: folder)
            guard result.total > 0 else {
                app.errorMessage = "All available messages from this sender are already in \(folder.title)."
                return
            }
            app.errorMessage = result.failed == 0
                ? "Moved \(result.moved) messages from this sender to \(folder.title)."
                : "Moved \(result.moved) messages; \(result.failed) could not be moved to \(folder.title)."
        }
    }

    private func createMission(for email: EmailMessage, deliverable: DeliverableKind?) {
        app.createMission(title: email.displaySubject, goal: "Complete the next action for \(email.fromName).")
        if let deliverable, let mission = app.missions.first {
            app.createDeliverable(for: mission, kind: deliverable)
        }
        app.errorMessage = deliverable.map { "\($0.rawValue) created in Work." } ?? "Mission created in Work."
    }

    private func applyClassification(_ category: SmartMailCategory, to email: EmailMessage) {
        let previous = app.smartMailClassification(for: email).category
        Task {
            guard await app.applySmartMailCategory(category, for: email) else { return }
            classificationUndo = ClassificationUndoState(email: email, previous: previous, current: category)
            try? await Task.sleep(for: .seconds(5))
            if classificationUndo?.email.emailId == email.emailId { classificationUndo = nil }
        }
    }

    private func classificationUndoBanner(_ state: ClassificationUndoState) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(VisualSystemV3.ColorToken.success)
            Text("Moved to \(state.current.rawValue)").font(.caption.weight(.semibold))
            Spacer()
            Button("Undo") {
                Task {
                    guard await app.applySmartMailCategory(state.previous, for: state.email) else { return }
                    classificationUndo = nil
                }
            }
            .font(.caption.weight(.bold))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: .black.opacity(0.10), radius: 8, y: 3)
        .padding(.horizontal)
    }

    private func mailboxHeader(visibleCount: Int) -> some View {
        Button {
            // Sheet presentation from a toolbar/header button must not share
            // an animated state transaction; on device that transaction can
            // be coalesced with navigation updates and drop the presentation.
            DispatchQueue.main.async {
                showMailboxSwitcher = true
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: activeAccount?.displayProvider.symbol ?? app.selectedProvider?.symbol ?? "tray.2.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(activeAccount?.displayProvider.identityColor ?? app.selectedProvider?.identityColor ?? Color.accentColor)
                Text(compactMailboxHeaderText)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(visibleCount)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .glassCard(cornerRadius: 14)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Current mailbox: \(compactMailboxHeaderText)")
    }

    private func mailOSDashboard(visibleEmails: [EmailMessage]) -> some View {
        MailOSDashboardView(
            briefing: app.mailOSBriefingSnapshot(for: visibleEmails),
            health: dashboardHealthSnapshots(visibleEmails: visibleEmails),
            trust: dashboardTrustSnapshot(visibleEmails: visibleEmails),
            sync: app.syncObservabilitySnapshot,
            runtime: app.aiRuntimeStatusSnapshot,
            latestAIExecution: latestAIExecution(for: visibleEmails),
            selectedBriefingCategory: selectedBriefingCategory
        ) {
            Task { await app.refresh() }
        } summarizeAction: {
            Task { await app.triageVisible(visibleEmails) }
        } commandAction: {
            app.showCommandPalette = true
        } briefingAction: { category in
            applyBriefingCategory(category)
        } mailboxAction: { row in
            selectedMailboxHealth = row
        }
    }

    private func miniMailOSHeader(visibleEmails: [EmailMessage]) -> some View {
        MiniMailOSHeaderView(
            briefing: app.mailOSBriefingSnapshot(for: visibleEmails),
            trust: dashboardTrustSnapshot(visibleEmails: visibleEmails),
            sync: app.syncObservabilitySnapshot,
            runtime: app.aiRuntimeStatusSnapshot,
            routingLabel: dashboardHealthSnapshots(visibleEmails: visibleEmails).first?.lastSyncLabel ?? "Routing active",
            selectedBriefingCategory: selectedBriefingCategory
        ) {
            Task { await app.refresh() }
        } commandAction: {
            app.showCommandPalette = true
        } briefingAction: { category in
            applyBriefingCategory(category)
        }
    }

    private func latestAIExecution(for visibleEmails: [EmailMessage]) -> AIExecutionMetadata? {
        visibleEmails
            .compactMap { app.triageCache[$0.emailId]?.execution }
            .max { $0.generatedAt < $1.generatedAt }
    }

    private func dashboardTrustSnapshot(visibleEmails: [EmailMessage]) -> MailDataTrustSnapshot {
        let base = app.dataTrustSnapshot
        let filterLabel = app.selectedLocalMailbox == .inbox ? selectedFilter.title : app.selectedLocalMailbox.title
        let visibleCount = reconciledVisibleCount(visibleEmails: visibleEmails, indexedMessages: base.indexedMessages)
        return MailDataTrustSnapshot(
            visibleMessages: visibleCount,
            indexedMessages: base.indexedMessages,
            mailboxSources: base.mailboxSources,
            lastUpdated: base.lastUpdated,
            currentFilter: query.isEmpty ? filterLabel : "\(filterLabel) + Search",
            currentIdentity: base.currentIdentity,
            dataFreshness: base.dataFreshness
        )
    }

    private func reconciledVisibleCount(visibleEmails: [EmailMessage], indexedMessages: Int) -> Int {
        // Indexed mail is not user-visible mail. Never substitute a backend
        // count for a rendered list count.
        visibleEmails.count
    }

    private func reconcileVisibleCountIfNeeded() {
        let base = app.dataTrustSnapshot
        guard shouldReconcileVisibleCount(visibleEmails: filteredEmails, indexedMessages: base.indexedMessages) else { return }
        if let lastVisibleCountReconciliationAt,
           Date().timeIntervalSince(lastVisibleCountReconciliationAt) < 60 {
            return
        }
        lastVisibleCountReconciliationAt = Date()
        Task { await app.refresh() }
    }

    private func shouldReconcileVisibleCount(visibleEmails: [EmailMessage], indexedMessages: Int) -> Bool {
        indexedMessages > 0
            && visibleEmails.isEmpty
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && app.selectedLocalMailbox == .inbox
            && selectedFilter == .all
    }

    private func dashboardHealthSnapshots(visibleEmails: [EmailMessage]) -> [MailboxHealthSnapshot] {
        app.mailboxHealthSnapshots.map { row in
            let visible: Int
            if row.id.hasPrefix("address-") {
                visible = visibleEmails.filter { email in
                    email.accountId.map { "address-\($0)" } == row.id
                        || email.sourceAccount.caseInsensitiveCompare(row.account) == .orderedSame
                }.count
            } else {
                visible = visibleEmails.count
            }
            return MailboxHealthSnapshot(
                id: row.id,
                provider: row.provider,
                account: row.account,
                domain: row.domain,
                state: row.state,
                messageCount: row.messageCount,
                visibleMessages: visible,
                indexedMessages: row.indexedMessages,
                mailboxSource: row.mailboxSource,
                lastSyncLabel: row.lastSyncLabel,
                latencyLabel: row.latencyLabel,
                queueLabel: row.queueLabel,
                authorizationLabel: row.authorizationLabel,
                currentSyncState: row.currentSyncState,
                progressLabel: row.progressLabel
            )
        }
    }

    @ViewBuilder
    private func mailboxChip(title: String, icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        if selected {
            Button(action: action) {
                Label(title, systemImage: icon)
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .accessibilityLabel("\(title) mailbox")
        } else {
            Button(action: action) {
                Label(title, systemImage: icon)
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .accessibilityLabel("\(title) mailbox")
        }
    }

    private var edgeOpenGesture: some Gesture {
        DragGesture(minimumDistance: 20, coordinateSpace: .global)
            .onEnded { value in
                guard value.startLocation.x < 15, value.translation.width > 55 else { return }
                showMailboxSwitcher = true
            }
    }

    #if os(iOS)
    private var mailboxSwitcherSheet: some View {
        NavigationStack {
            mailboxDrawer
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 18)
                .navigationTitle("Mailboxes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            showMailboxSwitcher = false
                        }
                    }
                }
        }
    }
    #endif

    @ViewBuilder
    private var mailboxSwitcherOverlay: some View {
        if showMailboxSwitcher {
            ZStack(alignment: .leading) {
                Color.black.opacity(0.22)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(VisualSystemV3.Motion.disclosure) {
                            showMailboxSwitcher = false
                        }
                    }

                mailboxDrawer
                    .frame(maxWidth: 330)
                    .padding(.top, 10)
                    .padding(.leading, 10)
                    .padding(.bottom, 16)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                    .gesture(
                        DragGesture(minimumDistance: 18)
                            .onEnded { value in
                                guard value.translation.width < -45 else { return }
                                withAnimation(VisualSystemV3.Motion.disclosure) {
                                    showMailboxSwitcher = false
                                }
                            }
                    )
            }
            .zIndex(5)
        }
    }

    private var mailboxDrawer: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("NEXORA Mail")
                        .font(.title3.weight(.bold))
                    Spacer()
                    Button(sidebarEditing ? "Done" : "Edit") {
                        withAnimation(VisualSystemV3.Motion.disclosure) {
                            sidebarEditing.toggle()
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(sidebarEditing ? "sidebar-edit-done" : "sidebar-edit-customize")
                    .accessibilityLabel(sidebarEditing ? "Done customizing sidebar" : "Edit Sidebar")
                    Button {
                        withAnimation(VisualSystemV3.Motion.disclosure) {
                            showMailboxSwitcher = false
                        }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close mailbox switcher")
                }

                if app.availableWorkspaces.count > 1 {
                    drawerSectionTitle("Workspace")
                    VStack(spacing: 6) {
                        ForEach(app.availableWorkspaces) { workspace in
                            Button {
                                app.selectActiveWorkspace(workspace.id)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: app.activeWorkspaceId == workspace.id ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(app.activeWorkspaceId == workspace.id ? Color.accentColor : Color.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(workspace.displayName).font(.subheadline.weight(.semibold))
                                        Text(workspace.role.replacingOccurrences(of: "_", with: " ").capitalized)
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(app.activeWorkspaceId == workspace.id ? Color.accentColor.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("active-workspace-\(workspace.id)")
                            .accessibilityLabel("Workspace: \(workspace.displayName)")
                        }
                    }
                }

                drawerMailOSSection
                drawerIdentitySection
                drawerMoreSection

                if app.addresses.isEmpty {
                    Text("No connected mailbox for this NEXORA account yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
            }
            .padding(16)
        }
        .frame(maxWidth: 330, maxHeight: .infinity)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.22), radius: 24, y: 10)
    }

    private func drawerSectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.top, 4)
    }

    private var drawerMailOSSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            drawerSectionTitle("NEXORA Mail")
            VStack(spacing: 6) {
                mailboxDrawerRow(
                    id: "today",
                    title: "Today",
                    subtitle: "Local priority, replies, and waiting work",
                    icon: "sun.max.fill",
                    count: workQueueCount(.today),
                    selected: app.selectedLocalMailbox == .inbox && selectedFilter == .today && app.selectedAccountId == nil
                ) {
                    setInboxFilter(.today)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                mailboxDrawerRow(
                    id: "all-mail",
                    title: "All Mail",
                    subtitle: allMailSubtitle,
                    icon: LocalMailBoxKind.inbox.symbol,
                    count: unreadCount(folder: .inbox, accountId: nil, unreadOnly: true),
                    selected: app.selectedLocalMailbox == .inbox && app.selectedProvider == nil && app.selectedAccountId == nil && selectedFilter == .all
                ) {
                    expandedAllMail = true
                    setInboxFilter(.all)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                drawerSelectableFolderRow(
                    id: "drafts-primary",
                    title: "Drafts",
                    subtitle: localFolderSubtitle(.drafts),
                    icon: LocalMailBoxKind.drafts.symbol,
                    folder: .drafts,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .drafts
                ) { selectLocalMailbox(.drafts) }
                drawerSelectableFolderRow(
                    id: "needs-reply",
                    title: "Needs Reply",
                    subtitle: "Local reply/action signals",
                    icon: LocalMailBoxKind.needsReply.symbol,
                    folder: .needsReply,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .needsReply
                ) { selectLocalMailbox(.needsReply) }
                drawerSelectableFolderRow(
                    id: "todo",
                    title: "To-do",
                    subtitle: "Local to-do/action signals",
                    icon: LocalMailBoxKind.todo.symbol,
                    folder: .todo,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .todo
                ) { selectLocalMailbox(.todo) }
                drawerSelectableFolderRow(
                    id: "follow-up",
                    title: "Follow-up",
                    subtitle: "Local follow-up/reminder signals",
                    icon: LocalMailBoxKind.followUp.symbol,
                    folder: .followUp,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .followUp
                ) { selectLocalMailbox(.followUp) }
                drawerSelectableFolderRow(
                    id: "junk-primary",
                    title: "Junk",
                    subtitle: "Persistent local junk state",
                    icon: LocalMailBoxKind.junk.symbol,
                    folder: .junk,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .junk
                ) { selectLocalMailbox(.junk) }
                mailboxDrawerRow(
                    id: "promotion-category",
                    title: "Promotion",
                    subtitle: "Offers and promotional mail",
                    icon: InboxFilter.promotion.symbol,
                    count: workQueueCount(.promotion),
                    selected: app.selectedLocalMailbox == .inbox && selectedFilter == .promotion && app.selectedAccountId == nil
                ) {
                    setInboxFilter(.promotion)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                mailboxDrawerRow(
                    id: "social-category",
                    title: "Social",
                    subtitle: "Social and community notifications",
                    icon: InboxFilter.social.symbol,
                    count: workQueueCount(.social),
                    selected: app.selectedLocalMailbox == .inbox && selectedFilter == .social && app.selectedAccountId == nil
                ) {
                    setInboxFilter(.social)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                mailboxDrawerRow(
                    id: "waiting-for-me",
                    title: "Waiting For Me",
                    subtitle: "Commitments awaiting my response",
                    icon: InboxFilter.waiting.symbol,
                    count: projectionCount(.waitingForMe, legacyFilter: .waiting),
                    selected: app.selectedLocalMailbox == .inbox && selectedFilter == .waiting && selectedWaitingSurface == .waitingForMe && app.selectedAccountId == nil
                ) {
                    selectedWaitingSurface = .waitingForMe
                    setInboxFilter(.waiting)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                mailboxDrawerRow(
                    id: "waiting-for-others",
                    title: "Waiting For Others",
                    subtitle: "Commitments awaiting someone else",
                    icon: "person.crop.circle.badge.clock",
                    count: projectionCount(.waitingForOthers, legacyFilter: .waiting),
                    selected: app.selectedLocalMailbox == .inbox && selectedFilter == .waiting && selectedWaitingSurface == .waitingForOthers && app.selectedAccountId == nil
                ) {
                    selectedWaitingSurface = .waitingForOthers
                    setInboxFilter(.waiting)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: nil, provider: nil)
                }
                drawerSelectableFolderRow(
                    id: "important",
                    title: "Important",
                    subtitle: "Local priority and deadline signals",
                    icon: LocalMailBoxKind.important.symbol,
                    folder: .important,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .important
                ) { selectLocalMailbox(.important) }
                drawerUnavailableFolderRow(
                    id: "ai-classification-unavailable",
                    "AI classification folder is not enabled",
                    "Enable mailbox AI classification before using generated category folders.",
                    "sparkles"
                )
                drawerSelectableFolderRow(
                    id: "done",
                    title: "Done",
                    subtitle: localFolderSubtitle(.done),
                    icon: LocalMailBoxKind.done.symbol,
                    folder: .done,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .done
                ) { selectLocalMailbox(.done) }
            }
        }
    }

    private var drawerIdentitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            drawerSectionTitle("Identity")
            VStack(spacing: 6) {
                disclosureDrawerRow(
                    id: "current-identity",
                    title: "Reading: \(mailboxScopeLabel)",
                    subtitle: mailboxSubtitle,
                    icon: activeAccount?.displayProvider.symbol ?? activeUnifiedAccount?.provider.symbol ?? app.selectedProvider?.symbol ?? "person.crop.circle.fill",
                    expanded: expandedIdentitySection
                ) {
                    withAnimation(VisualSystemV3.Motion.disclosure) {
                        expandedIdentitySection.toggle()
                    }
                }

                if expandedIdentitySection {
                    if let identity = app.defaultSendingIdentity {
                        IdentityTruthBadge(
                            title: "Send as \(identity.email)",
                            subtitle: "\(identity.provider.title) · \(identity.domain) · Default sending identity",
                            provider: identity.provider,
                            status: identity.canSend ? "Can send" : identity.sendStatusReason,
                            compact: true
                        )
                    }
                    mailboxDrawerRow(
                        id: "identity-all-accounts",
                        title: "All Accounts",
                        subtitle: "All connected mail in NEXORA",
                        icon: "tray.2.fill",
                        count: unreadCount(folder: .inbox, accountId: nil, unreadOnly: true),
                        selected: app.selectedLocalMailbox == .inbox && app.selectedProvider == nil && app.selectedAccountId == nil && selectedFilter == .all
                    ) {
                        setInboxFilter(.all)
                        app.selectedLocalMailbox = .inbox
                        selectMailbox(accountId: nil, provider: nil)
                    }
                    drawerAccountRows
                }
            }
        }
    }

    private var drawerMoreSection: AnyView {
        AnyView(
            VStack(alignment: .leading, spacing: 8) {
                drawerSectionTitle("More")
                VStack(spacing: 6) {
                    disclosureDrawerRow(
                        id: "more-folders",
                        title: expandedMoreSection ? "Hide Folders" : "Show Folders",
                        subtitle: "Local folders and cleanup tools",
                        icon: "ellipsis.circle.fill",
                        expanded: expandedMoreSection
                    ) {
                        withAnimation(VisualSystemV3.Motion.disclosure) {
                            expandedMoreSection.toggle()
                        }
                    }

                    if expandedMoreSection {
                        drawerMoreFolderRows
                    }
                }
            }
        )
    }

    @ViewBuilder
    private var drawerAccountRows: some View {
        ForEach(app.addresses.sorted(by: mailboxSort)) { account in
            let rowId = "account-\(account.accountId)"
            if isSidebarItemVisible(rowId) {
                mailboxDrawerRow(
                    id: rowId,
                    title: account.email,
                    subtitle: "\(account.displayProvider.title) · \(account.displayDomain)",
                    icon: account.displayProvider.symbol,
                    count: unreadCount(folder: .inbox, accountId: account.accountId, unreadOnly: true),
                    selected: app.selectedLocalMailbox == .inbox && app.selectedAccountId == account.accountId
                ) {
                    expandedAccountIDs.insert(account.accountId)
                    setInboxFilter(.all)
                    app.selectedLocalMailbox = .inbox
                    selectMailbox(accountId: account.accountId, provider: account.displayProvider)
                }
            }
        }

        ForEach(app.unifiedAccounts.filter { $0.isDelegatedMailbox && $0.readableAccountId != nil }) { account in
            if let readableId = account.readableAccountId {
                let rowId = "delegated-\(readableId)"
                if isSidebarItemVisible(rowId) {
                    mailboxDrawerRow(
                        id: rowId,
                        title: account.email,
                        subtitle: "Delegated NEXORA mailbox · Receive only",
                        icon: account.provider.symbol,
                        count: unreadCount(folder: .inbox, accountId: readableId, unreadOnly: true),
                        selected: app.selectedLocalMailbox == .inbox && app.selectedAccountId == readableId
                    ) {
                        expandedAccountIDs.insert(readableId)
                        setInboxFilter(.all)
                        app.selectedLocalMailbox = .inbox
                        selectMailbox(accountId: readableId, provider: account.provider)
                    }
                }
            }
        }
    }

    private var drawerMoreFolderRows: AnyView {
        AnyView(
            VStack(spacing: 6) {
                drawerSmartUnreadRow(accountId: nil)
                drawerSelectableFolderRow(
                    id: "starred",
                    title: "Starred",
                    subtitle: localFolderSubtitle(.starred),
                    icon: LocalMailBoxKind.starred.symbol,
                    folder: .starred,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .starred
                ) { selectLocalMailbox(.starred) }
                drawerSelectableFolderRow(
                    id: "drafts",
                    title: "Drafts",
                    subtitle: localFolderSubtitle(.drafts),
                    icon: LocalMailBoxKind.drafts.symbol,
                    folder: .drafts,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .drafts
                ) { selectLocalMailbox(.drafts) }
                drawerSelectableFolderRow(
                    id: "sent",
                    title: "Sent",
                    subtitle: localFolderSubtitle(.sent),
                    icon: LocalMailBoxKind.sent.symbol,
                    folder: .sent,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .sent
                ) { selectLocalMailbox(.sent) }
                drawerSelectableFolderRow(
                    id: "outbox",
                    title: "Outbox",
                    subtitle: localFolderSubtitle(.outbox),
                    icon: LocalMailBoxKind.outbox.symbol,
                    folder: .outbox,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .outbox
                ) { selectLocalMailbox(.outbox) }
                drawerSelectableFolderRow(
                    id: "send-later",
                    title: "Scheduled",
                    subtitle: localFolderSubtitle(.scheduled),
                    icon: LocalMailBoxKind.scheduled.symbol,
                    folder: .scheduled,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .scheduled
                ) { selectLocalMailbox(.scheduled) }
                drawerSelectableFolderRow(
                    id: "snoozed",
                    title: "Snoozed",
                    subtitle: localFolderSubtitle(.snoozed),
                    icon: LocalMailBoxKind.snoozed.symbol,
                    folder: .snoozed,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .snoozed
                ) { selectLocalMailbox(.snoozed) }
                drawerSelectableFolderRow(
                    id: "junk",
                    title: "Junk",
                    subtitle: localFolderSubtitle(.junk),
                    icon: LocalMailBoxKind.junk.symbol,
                    folder: .junk,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .junk
                ) { selectLocalMailbox(.junk) }
                drawerSelectableFolderRow(
                    id: "trash",
                    title: "Trash",
                    subtitle: localFolderSubtitle(.trash),
                    icon: LocalMailBoxKind.trash.symbol,
                    folder: .trash,
                    accountId: nil,
                    selected: app.selectedLocalMailbox == .trash
                ) { selectLocalMailbox(.trash) }
            }
        )
    }

    private func disclosureDrawerRow(id: String, title: String, subtitle: String, icon: String, expanded: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .frame(width: 24)
                    .foregroundStyle(Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(10)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sidebar-row-\(id)")
        .accessibilityLabel("\(title), \(subtitle), \(expanded ? "expanded" : "collapsed")")
    }

    private var allMailSubtitle: String {
        if let user = app.currentUser?.email {
            return "All connected mailboxes · \(user)"
        }
        return "All connected mailboxes"
    }

    private func workQueueCount(_ filter: InboxFilter) -> Int {
        if app.isConversationProjectionAuthoritative {
            switch filter {
            case .needsReply: return app.conversationProjections(for: .actionRequired).count
            case .waiting: return app.conversationProjections(for: selectedWaitingSurface).count
            default:
                if let key = filter.projectionMembershipKey {
                    return app.conversationProjections(for: .categories).filter {
                        $0.membershipKeys.contains { $0.caseInsensitiveCompare(key) == .orderedSame }
                    }.count
                }
                if let key = filter.projectionCategoryKey {
                    return app.conversationProjections(for: .categories).filter {
                        $0.categoryKeys.contains { $0.caseInsensitiveCompare(key) == .orderedSame }
                    }.count
                }
            }
        }
        return app.emails.filter { email in
            app.effectiveFolder(for: email) == .inbox && matchesWorkQueue(filter, email: email)
        }.count
    }

    private func projectionCount(_ surface: ConversationProjectionSurface, legacyFilter: InboxFilter) -> Int {
        guard app.isConversationProjectionAuthoritative else { return workQueueCount(legacyFilter) }
        return app.conversationProjections(for: surface).count
    }

    private func matchesWorkQueue(_ filter: InboxFilter, email: EmailMessage) -> Bool {
        let semantics = queueSemantics(for: email)
        switch filter {
        case .today:
            return semantics.today
        case .yesterday, .lastSevenDays, .vip, .attachments, .calendar:
            return matchesSelectedFilter(email, rawValue: filter.rawValue)
        case .waiting:
            return semantics.waiting
        case .followUp:
            return semantics.followUp
        case .needsReply:
            return semantics.needsReply
        case .priority:
            return semantics.priority
        case .people, .customers, .work, .finance, .orders, .travel, .notifications, .archived, .scheduled, .completed:
            return matchesSelectedFilter(email, rawValue: filter.rawValue)
        case .urgent:
            return matchesBriefingCategory(.urgent, email: email)
        case .unread:
            return email.isUnread
        case .starred:
            return email.isStarred
        case .personal:
            return app.triageCache[email.emailId]?.category == .personal
        case .updates:
            return app.triageCache[email.emailId]?.category == .newsletter || app.triageCache[email.emailId]?.category == .promotion || email.attachmentSignalCount > 0
        case .promotion:
            return app.triageCache[email.emailId]?.category == .promotion || email.searchableSnippet.contains("promotion") || email.searchableSnippet.contains("offer")
        case .social:
            return app.triageCache[email.emailId]?.category == .social || email.searchableSnippet.contains("social") || email.searchableSnippet.contains("commented")
        case .junk:
            return app.effectiveFolder(for: email) == .junk
        case .newsletter:
            return matchesBriefingCategory(.newsletter, email: email)
        case .system:
            return matchesBriefingCategory(.system, email: email)
        case .gmail:
            return email.sourceProvider == .gmail || email.sourceProvider == .googleWorkspace
        case .cloudMail:
            return email.sourceProvider == .cloudflareNative
        case .all:
            return true
        }
    }

    private var hiddenSidebarItemIDs: Set<String> {
        Set(hiddenSidebarItemIDsRaw.split(separator: ",").map(String.init))
    }

    private func canHideSidebarItem(_ id: String) -> Bool {
        !["all-mail", "inbox", "needs-reply", "todo", "follow-up", "important", "done", "add-label", "add-smart-view"].contains(id)
    }

    private func isSidebarItemVisible(_ id: String) -> Bool {
        sidebarEditing || !hiddenSidebarItemIDs.contains(id)
    }

    private func toggleSidebarItemVisibility(_ id: String) {
        guard canHideSidebarItem(id) else { return }
        var hidden = hiddenSidebarItemIDs
        if hidden.contains(id) {
            hidden.remove(id)
        } else {
            hidden.insert(id)
        }
        hiddenSidebarItemIDsRaw = hidden.sorted().joined(separator: ",")
    }

    private func resetMailboxView() {
        setInboxFilter(.all)
        app.selectedLocalMailbox = .inbox
        selectMailbox(accountId: nil, provider: nil)
    }

    private func emailRowAccessibilityLabel(_ email: EmailMessage) -> String {
        let source = email.sourceAccount.isEmpty ? email.sourceProvider.title : email.sourceAccount
        let category = app.smartMailClassification(for: email).category.rawValue
        let triage = app.triageCache[email.emailId]
        let aiAttribution = triage?.execution.map { metadata in
            if metadata.requestedProvider == metadata.executedProvider {
                return "AI: \(metadata.executedProvider.title) · \(metadata.localOrCloud.capitalized)"
            }
            return "AI: \(metadata.executedProvider.title) · \(metadata.localOrCloud.capitalized) · requested \(metadata.requestedProvider.title)"
        }
        return [
            "Email row \(email.emailId)",
            email.fromName,
            email.displaySubject,
            "Folder: \(app.effectiveFolder(for: email).title)",
            "Category: \(category)",
            source,
            email.preview,
            aiAttribution
        ]
        .compactMap { $0 }
        .joined(separator: ". ")
    }

    private func scopedEmails(accountId: Int?) -> [EmailMessage] {
        app.emails.filter { email in
            accountId == nil || email.accountId == accountId
        }
    }

    private func emails(folder: LocalMailBoxKind, accountId: Int?) -> [EmailMessage] {
        scopedEmails(accountId: accountId).filter { email in
            let effectiveFolder = app.effectiveFolder(for: email)
            switch folder {
            case .inbox: return effectiveFolder == .inbox
            case .needsReply: return smartClassification(for: email).needsReply
            case .todo: return smartClassification(for: email).todo
            case .followUp: return smartClassification(for: email).followUp
            case .important: return smartClassification(for: email).important
            case .starred: return email.isStarred && effectiveFolder != .trash
            case .junk: return effectiveFolder == .junk
            case .trash: return effectiveFolder == .trash
            case .done: return effectiveFolder == .done
            case .snoozed, .drafts, .sent, .outbox, .scheduled: return false
            }
        }
    }

    private func unreadCount(folder: LocalMailBoxKind, accountId: Int?, unreadOnly: Bool) -> Int {
        if unreadOnly {
            return emails(folder: folder, accountId: accountId).filter(\.isUnread).count
        }
        return emails(folder: folder, accountId: accountId).count
    }

    private func markSidebarFolderRead(folder: LocalMailBoxKind, accountId: Int?) async {
        for email in emails(folder: folder, accountId: accountId).filter(\.isUnread) {
            await app.markRead(email)
        }
    }

    private func mailboxDrawerRow(id: String, title: String, subtitle: String, icon: String, count: Int? = nil, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            if sidebarEditing && canHideSidebarItem(id) {
                toggleSidebarItemVisibility(id)
            } else {
                action()
            }
        } label: {
            HStack(spacing: 11) {
                if sidebarEditing && canHideSidebarItem(id) {
                    Image(systemName: hiddenSidebarItemIDs.contains(id) ? "eye.slash" : "eye")
                        .font(.callout.weight(.semibold))
                        .frame(width: 20)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .frame(width: 24)
                    .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .padding(10)
            .background(selected ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sidebar-row-\(id)")
        .accessibilityLabel(sidebarEditing && canHideSidebarItem(id) ? "\(hiddenSidebarItemIDs.contains(id) ? "Show" : "Hide") \(title)" : "\(title), \(subtitle)")
        .contextMenu {
            Button {
                resetMailboxView()
            } label: {
                Label("Reset view", systemImage: "arrow.counterclockwise")
            }
        }
    }

    @ViewBuilder
    private func drawerFolderRows(account: MailAddress?) -> some View {
        drawerFolderRows(accountId: account?.accountId, title: account?.email)
    }

    @ViewBuilder
    private func drawerFolderRows(accountId: Int?, title: String?) -> some View {
        VStack(spacing: 6) {
            drawerSelectableFolderRow(
                id: "inbox",
                title: "Inbox",
                subtitle: title ?? "All connected mailboxes",
                icon: LocalMailBoxKind.inbox.symbol,
                folder: .inbox,
                accountId: accountId,
                selected: app.selectedLocalMailbox == .inbox && app.selectedAccountId == accountId
            ) {
                setInboxFilter(.all)
                app.selectedLocalMailbox = .inbox
                selectMailbox(accountId: accountId, provider: nil)
            }
            drawerSelectableFolderRow(
                id: "sent",
                title: "Sent",
                subtitle: localFolderSubtitle(.sent, scopedToAccount: accountId != nil),
                icon: LocalMailBoxKind.sent.symbol,
                folder: .sent,
                accountId: accountId,
                selected: accountId == nil && app.selectedLocalMailbox == .sent
            ) { selectLocalMailbox(.sent) }
            drawerSelectableFolderRow(
                id: "snoozed",
                title: "Snoozed",
                subtitle: "No snooze actions yet",
                icon: LocalMailBoxKind.snoozed.symbol,
                folder: .snoozed,
                accountId: accountId,
                selected: app.selectedLocalMailbox == .snoozed
            ) { selectLocalMailbox(.snoozed) }
            drawerSelectableFolderRow(
                id: "drafts",
                title: "Drafts",
                subtitle: localFolderSubtitle(.drafts, scopedToAccount: accountId != nil),
                icon: LocalMailBoxKind.drafts.symbol,
                folder: .drafts,
                accountId: accountId,
                selected: accountId == nil && app.selectedLocalMailbox == .drafts
            ) { selectLocalMailbox(.drafts) }
            drawerSelectableFolderRow(
                id: "outbox",
                title: "Outbox",
                subtitle: localFolderSubtitle(.outbox, scopedToAccount: accountId != nil),
                icon: LocalMailBoxKind.outbox.symbol,
                folder: .outbox,
                accountId: accountId,
                selected: accountId == nil && app.selectedLocalMailbox == .outbox
            ) { selectLocalMailbox(.outbox) }
            drawerSelectableFolderRow(
                id: "send-later",
                title: "Send Later",
                subtitle: localFolderSubtitle(.scheduled, scopedToAccount: accountId != nil),
                icon: LocalMailBoxKind.scheduled.symbol,
                folder: .scheduled,
                accountId: accountId,
                selected: accountId == nil && app.selectedLocalMailbox == .scheduled
            ) { selectLocalMailbox(.scheduled) }
            drawerSelectableFolderRow(
                id: "junk",
                title: "Junk",
                subtitle: "Persistent local junk state",
                icon: LocalMailBoxKind.junk.symbol,
                folder: .junk,
                accountId: accountId,
                selected: app.selectedLocalMailbox == .junk
            ) { selectLocalMailbox(.junk) }
            drawerSelectableFolderRow(
                id: "trash",
                title: "Trash",
                subtitle: "Messages moved locally; restore to Inbox when needed",
                icon: LocalMailBoxKind.trash.symbol,
                folder: .trash,
                accountId: accountId,
                selected: app.selectedLocalMailbox == .trash
            ) { selectLocalMailbox(.trash) }
            drawerSelectableFolderRow(
                id: "done",
                title: "Done",
                subtitle: "Archived locally",
                icon: LocalMailBoxKind.done.symbol,
                folder: .done,
                accountId: accountId,
                selected: app.selectedLocalMailbox == .done
            ) { selectLocalMailbox(.done) }
        }
        .padding(.leading, 18)
    }

    @ViewBuilder
    private func drawerSmartUnreadRow(accountId: Int?) -> some View {
        if isSidebarItemVisible("unread") {
            mailboxDrawerRow(
                id: "unread",
                title: "Unread",
                subtitle: "Messages still marked unread",
                icon: "envelope.badge.fill",
                count: unreadCount(folder: .inbox, accountId: accountId, unreadOnly: true),
                selected: app.selectedLocalMailbox == .inbox && selectedFilter == .unread && app.selectedAccountId == accountId
            ) {
                setInboxFilter(.unread)
                app.selectedLocalMailbox = .inbox
                selectMailbox(accountId: accountId, provider: nil)
            }
            .contextMenu {
                Button {
                    Task { await markSidebarFolderRead(folder: .inbox, accountId: accountId) }
                } label: {
                    Label("Mark all as read", systemImage: "envelope.open")
                }
                Button {
                    resetMailboxView()
                } label: {
                    Label("Reset view", systemImage: "arrow.counterclockwise")
                }
            }
        }
    }

    @ViewBuilder
    private func drawerSelectableFolderRow(id: String, title: String, subtitle: String, icon: String, folder: LocalMailBoxKind, accountId: Int?, selected: Bool, action: @escaping () -> Void) -> some View {
        if isSidebarItemVisible(id) {
            mailboxDrawerRow(
                id: id,
                title: title,
                subtitle: subtitle,
                icon: icon,
                count: unreadCount(folder: folder, accountId: accountId, unreadOnly: true),
                selected: selected,
                action: {
                    setInboxFilter(.all)
                    action()
                }
            )
            .contextMenu {
                Button {
                    Task { await markSidebarFolderRead(folder: folder, accountId: accountId) }
                } label: {
                    Label("Mark all as read", systemImage: "envelope.open")
                }
                Button {
                    resetMailboxView()
                } label: {
                    Label("Reset view", systemImage: "arrow.counterclockwise")
                }
            }
        }
    }

    private func drawerUnavailableFolderRow(id: String, _ title: String, _ subtitle: String, _ icon: String) -> some View {
        HStack(spacing: 11) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .frame(width: 24)
                .foregroundStyle(Color.secondary.opacity(0.55))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            Text("Not available")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(Color.secondary.opacity(0.12), in: Capsule())
        }
        .padding(10)
        .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("sidebar-row-\(id)")
        .accessibilityLabel("\(title), \(subtitle), Disabled")
    }

    private func toggleAccountExpansion(_ accountId: Int) {
        if expandedAccountIDs.contains(accountId) {
            expandedAccountIDs.remove(accountId)
        } else {
            expandedAccountIDs.insert(accountId)
        }
    }

    private func mailboxSort(_ lhs: MailAddress, _ rhs: MailAddress) -> Bool {
        let leftPriority = mailboxStatePriority(lhs)
        let rightPriority = mailboxStatePriority(rhs)
        if leftPriority != rightPriority { return leftPriority < rightPriority }
        return lhs.email.localizedCaseInsensitiveCompare(rhs.email) == .orderedAscending
    }

    private func mailboxStatePriority(_ account: MailAddress) -> Int {
        switch account.statusLabel.lowercased() {
        case "connected", "available":
            return 0
        case let value where value.contains("error") || value.contains("blocked"):
            return 1
        default:
            return 2
        }
    }

    private func selectMailbox(accountId: Int?, provider: UnifiedMailProvider?) {
        withAnimation(VisualSystemV3.Motion.disclosure) {
            showMailboxSwitcher = false
        }
        setInboxFilter(.all)
        app.selectedLocalMailbox = .inbox
        Task { await app.setMailbox(accountId: accountId, provider: provider) }
    }

    private func selectLocalMailbox(_ folder: LocalMailBoxKind) {
        setInboxFilter(.all)
        app.selectedLocalMailbox = folder
        app.selectedAccountId = nil
        app.selectedProvider = nil
        withAnimation(VisualSystemV3.Motion.disclosure) {
            showMailboxSwitcher = false
        }
    }

    private func setInboxFilter(_ filter: InboxFilter) {
        selectedFilter = filter
        if app.selectedInboxFilterRaw != filter.rawValue {
            app.selectedInboxFilterRaw = filter.rawValue
        }
    }

    private func applyBriefingCategory(_ category: MailBriefingCategory) {
        app.selectedLocalMailbox = .inbox
        app.selectedProvider = nil
        app.selectedAccountId = nil
        query = ""
        if let filter = InboxFilter(rawValue: category.filterRawValue) {
            setInboxFilter(filter)
        }
    }

    private func applyAppInboxFilterCommand() {
        guard let filter = InboxFilter(rawValue: app.selectedInboxFilterRaw) else { return }
        if selectedFilter != filter {
            selectedFilter = filter
        }
    }

    private func localFolderSubtitle(_ folder: LocalMailBoxKind, scopedToAccount: Bool = false) -> String {
        if scopedToAccount {
            switch folder {
            case .inbox:
                return "Live mail for this address"
            case .needsReply:
                return "Reply classification for this address"
            case .todo:
                return "Action classification for this address"
            case .followUp:
                return "Follow-up classification for this address"
            case .important:
                return "Important classification for this address"
            case .starred:
                return "Starred mail for this address"
            case .junk:
                return "Persistent local junk state"
            case .trash:
                return "Local trash state"
            case .drafts:
                return "All-account local drafts"
            case .sent:
                return "All-account backend accepted mail"
            case .outbox:
                return "All-account failed sends"
            case .scheduled:
                return "All-account local schedule state"
            case .done:
                return "Archived locally"
            case .snoozed:
                return "No snooze actions yet"
            }
        }
        switch folder {
        case .inbox: return "Live mail"
        case .needsReply: return "Messages that likely need a reply"
        case .todo: return "Messages with local action signals"
        case .followUp: return "Messages with follow-up signals"
        case .important: return "Urgent and deadline mail"
        case .starred: return "Starred messages"
        case .junk: return "Persistent local junk state"
        case .trash: return "Local trash state"
        case .drafts: return "\(app.drafts.count) saved"
        case .sent: return "\(app.sentMessages.count) accepted by backend"
        case .outbox: return "\(app.outboxMessages.count) failed send\(app.outboxMessages.count == 1 ? "" : "s")"
        case .scheduled: return app.scheduledMessages.isEmpty ? "Not enabled for automatic delivery" : "\(app.scheduledMessages.count) saved locally"
        case .done: return "Archived locally"
        case .snoozed: return "No snooze actions yet"
        }
    }

    private var loadMoreRow: some View {
        HStack { Spacer()
            if app.isLoadingMore { ProgressView().controlSize(.small) }
            else { Text("Pull or tap to load more").font(.footnote).foregroundStyle(.secondary) }
            Spacer() }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .contentShape(Rectangle())
        .onTapGesture { Task { await app.loadMore() } }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "envelope.open.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No Messages Visible")
                .font(.title3.weight(.semibold))
            Text(app.emails.isEmpty ? "NEXORA has no loaded messages for this mailbox yet." : "The current dashboard filter hides all loaded messages.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            VStack(alignment: .leading, spacing: 8) {
                trustStateRow("Mailbox", app.syncObservabilitySnapshot.currentMailbox)
                trustStateRow("Folder", app.syncObservabilitySnapshot.currentFolder)
                trustStateRow("Last Sync", app.syncObservabilitySnapshot.lastSuccessfulSync)
                trustStateRow("Sync", app.syncObservabilitySnapshot.currentSyncState)
                trustStateRow("Mailbox Health", app.mailboxHealthSnapshots.first?.state.rawValue ?? "Unavailable")
                trustStateRow("Visible Count", "\(filteredEmails.count)")
                trustStateRow("Indexed Count", "\(app.dataTrustSnapshot.indexedMessages)")
                trustStateRow("First Count Drop", app.mailVisibilityTrace.firstDrop)
                trustStateRow("API / Decode / Overlay", "\(app.mailVisibilityTrace.apiCount) / \(app.mailVisibilityTrace.decodedCount) / \(app.mailVisibilityTrace.overlayCount)")
                trustStateRow("Scope / Folder / Filter / Render", "\(app.mailVisibilityTrace.scopedCount) / \(app.mailVisibilityTrace.folderCount) / \(app.mailVisibilityTrace.filterCount) / \(app.mailVisibilityTrace.renderedCount)")
                trustStateRow("Sources", app.dataTrustSnapshot.mailboxSources)
                trustStateRow("Freshness", app.dataTrustSnapshot.dataFreshness)
                trustStateRow("Diagnostics", app.syncObservabilitySnapshot.lastError)
            }
            .padding(12)
            .frame(maxWidth: 360, alignment: .leading)
            .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 28) {
                if !app.emails.isEmpty {
                    VStack(spacing: 8) {
                        Button { resetMailboxView() } label: {
                            Image(systemName: "tray.2")
                                .font(.title3.weight(.semibold))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.glass)
                        
                        Text("All Mail")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                
                VStack(spacing: 8) {
                    Button { Task { await app.refresh() } } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.title3.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.glass)
                    
                    Text("Refresh")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                
                VStack(spacing: 8) {
                    Button { selectedMailboxHealth = app.mailboxHealthSnapshots.first } label: {
                        Image(systemName: "stethoscope")
                            .font(.title3.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.glass)
                    .disabled(app.mailboxHealthSnapshots.isEmpty)
                    
                    Text("Diagnostics")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(40)
        .frame(maxWidth: 420)
        .padding(.top, 60)
    }

    private func trustStateRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(.caption)
                .multilineTextAlignment(.trailing)
        }
    }

    private var inboxFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(visibleInboxFilters) { filter in
                    inboxFilterButton(filter)
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityLabel("Inbox filters")
    }

    private var visibleInboxFilters: [InboxFilter] {
        var filters: [InboxFilter] = [
            // Importance First: lead with the queues that deserve immediate
            // attention. This changes presentation order only; the filters,
            // counts, and their classification semantics remain unchanged.
            .vip, .priority, .needsReply, .unread, .starred, .attachments,
            .notifications, .newsletter,
            .calendar, .today, .yesterday, .lastSevenDays,
            .waiting, .followUp, .scheduled,
            .people, .customers, .work, .finance, .orders, .travel,
            .updates, .promotion, .social, .junk, .archived
        ]
        if app.hasConnectedGmail {
            filters.append(.gmail)
        }
        if app.addresses.contains(where: { $0.displayProvider == .cloudflareNative })
            || app.unifiedAccounts.contains(where: { $0.provider == .cloudflareNative }) {
            filters.append(.cloudMail)
        }
        if !filters.contains(selectedFilter) {
            filters.append(selectedFilter)
        }
        // All Mail is an archive entry, never a leading navigation item. Keep
        // it last even for dynamically available provider filters or a filter
        // restored from persisted selection state.
        filters.removeAll { $0 == .all }
        filters.append(.all)
        return filters
    }

    private var inboxSearchField: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search mail", text: $query)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("Search mail")
                    .accessibilityLabel("Search mail")
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Clear search")
                    }
                    .buttonStyle(.plain)
                }
            }
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(searchModeDescription)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(searchModeDescription)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var searchModeDescription: String {
        let lower = query.lowercased()
        if lower.contains("from:") || lower.contains("unread") || lower.contains("starred") || lower.contains("flagged") {
            return "Structured local search · sender, status, and visible metadata"
        }
        return "Exact local search · sender, subject, body preview, provider, and attachments"
    }

    @ViewBuilder
    private func inboxFilterButton(_ filter: InboxFilter) -> some View {
        let button = Button {
            setInboxFilter(filter)
        } label: {
            Label(filter.title, systemImage: filter.symbol)
                .font(.caption2.weight(.bold))
                .lineLimit(1)
        }
        .controlSize(.small)
        .tint(filter.tint)

        if selectedFilter == filter {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if isSelectionMode {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(selectionHasAllVisible(in: filteredEmails) ? "Deselect All Visible" : "Select All Visible") {
                    toggleSelectAllVisible(in: filteredEmails)
                }
            }
            ToolbarItem(placement: .principal) {
                Text("\(selectedEmailIds.count) Selected")
                    .font(.headline)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Cancel") {
                    isSelectionMode = false
                    selectedEmailIds.removeAll()
                }
            }
        } else {
            #if os(iOS)
            ToolbarItem(placement: .navigationBarLeading) {
                mailboxToolbarButton
            }
            #else
            ToolbarItem(placement: .navigation) {
                mailboxToolbarButton
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button { showCompose = true } label: {
                    Image(systemName: "square.and.pencil")
                        .accessibilityLabel("Compose")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    withAnimation(VisualSystemV3.Motion.feedback) {
                        isSelectionMode = true
                    }
                } label: {
                    Image(systemName: "checkmark.circle")
                        .accessibilityLabel("Select messages")
                }
                .accessibilityIdentifier("inbox-enter-selection-mode")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Section("Active AI") {
                        Label {
                            HStack {
                                textLabelForAppleIntelligenceActive
                            }
                        } icon: {
                            Image(systemName: "sparkles")
                        }
                    }
                    Button { Task { await app.triageVisible(filteredEmails) } } label: {
                        Label("Summarize all visible", systemImage: "sparkles")
                    }
                    Button { showAssistant = true } label: {
                        Label("AI Mail Assistant", systemImage: "sparkles.rectangle.stack")
                    }
                    Button { showSettings = true } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .accessibilityIdentifier("cloudmail-actions-settings")
                    Divider()
                    Button(role: .destructive) { app.signOut() } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "sparkles")
                        .accessibilityLabel("NEXORA actions")
                }
            }
        }
    }

    private var textLabelForAppleIntelligenceActive: some View {
        HStack {
            Text("Apple Intelligence")
            Text("· Active · Local")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var mailboxToolbarButton: some View {
        Menu {
            Button {
                // A Menu dismisses asynchronously. Presenting the sheet in
                // the same transaction races that dismissal on iOS and can
                // leave the mailbox drawer closed. Defer one main-loop turn.
                DispatchQueue.main.async {
                    showMailboxSwitcher = true
                }
            } label: {
                Label("Open Mailboxes", systemImage: "sidebar.leading")
            }
            Button {
                selectMailbox(accountId: nil, provider: nil)
            } label: {
                Label("All Mail", systemImage: LocalMailBoxKind.inbox.symbol)
            }
            Divider()
            Button { selectLocalMailbox(.drafts) } label: {
                Label("Drafts", systemImage: LocalMailBoxKind.drafts.symbol)
            }
            Button { selectLocalMailbox(.needsReply) } label: {
                Label("Needs Reply", systemImage: LocalMailBoxKind.needsReply.symbol)
            }
            Button { selectLocalMailbox(.todo) } label: {
                Label("To-do", systemImage: LocalMailBoxKind.todo.symbol)
            }
            Button { selectLocalMailbox(.sent) } label: {
                Label("Sent", systemImage: LocalMailBoxKind.sent.symbol)
            }
            Divider()
            Button {
                app.selectedMainTab = 5
            } label: {
                Label("Accounts", systemImage: "person.2.fill")
            }
            Button {
                app.selectedMainTab = 5
            } label: {
                Label("Settings", systemImage: "gearshape.fill")
            }
        } label: {
            Label("Mailboxes", systemImage: activeAccount?.displayProvider.symbol ?? app.selectedProvider?.symbol ?? "tray.2.fill")
                .labelStyle(.iconOnly)
        }
        // Keep the compact header as the single "Current mailbox" target.
        // The toolbar Menu is a separate control; sharing the label makes
        // UI automation (and VoiceOver rotor order) select the wrong target.
        .accessibilityLabel("Mailbox menu")
        .accessibilityIdentifier("inbox-mailbox-menu-button")
    }

    private func selectionBottomBar(visibleEmails: [EmailMessage]) -> some View {
        HStack(spacing: 18) {
            Button {
                let selected = selectedEmails(in: visibleEmails)
                let anyUnread = selected.contains { $0.isUnread }
                Task {
                    for email in selected {
                        if anyUnread { await app.markRead(email) } else { app.markUnread(email) }
                    }
                }
                finishSelection()
            } label: {
                Image(systemName: "checkmark.circle").font(.title3)
            }
            .accessibilityLabel("Toggle Read State")
            .accessibilityIdentifier("selection-toggle-read")

            Button {
                let selected = selectedEmails(in: visibleEmails)
                Task { for email in selected { await app.archive(email) } }
                finishSelection()
            } label: {
                Image(systemName: "archivebox").font(.title3)
            }
            .accessibilityLabel("Archive selected messages")
            .accessibilityIdentifier("selection-archive")

            Button {
                Task { for email in selectedEmails(in: visibleEmails) { await app.delete(email) } }
                finishSelection()
            } label: {
                Image(systemName: "trash").font(.title3).foregroundStyle(.red)
            }
            .accessibilityLabel("Move selected messages to Trash")
            .accessibilityIdentifier("selection-trash")

            Menu {
                ForEach(LocalMailBoxKind.allCases.filter { ![.outbox, .scheduled, .drafts, .sent].contains($0) }) { folder in
                    Button {
                        let selected = selectedEmails(in: visibleEmails)
                        Task { for email in selected { await app.move(email, to: folder) }; finishSelection() }
                    } label: {
                        Label(folder.title, systemImage: folder.symbol)
                    }
                }
            } label: {
                Image(systemName: "folder").font(.title3)
            }
            .accessibilityLabel("Move selected messages")
            .accessibilityIdentifier("selection-move")

            Menu {
                Section("Work") {
                    Button {
                        markSelected(visibleEmails, unread: false)
                    } label: { Label("Mark Read", systemImage: "envelope.open") }
                    Button {
                        markSelected(visibleEmails, unread: true)
                    } label: { Label("Mark Unread", systemImage: "envelope.badge") }
                    Button {
                        let selected = selectedEmails(in: visibleEmails)
                        Task { for email in selected { await app.move(email, to: .followUp) }; finishSelection() }
                    } label: {
                        Label("Add Follow Up", systemImage: "arrowshape.turn.up.right.fill")
                    }
                    Button {
                        let selected = selectedEmails(in: visibleEmails)
                        Task { for email in selected { await app.move(email, to: .done) }; finishSelection() }
                    } label: {
                        Label("Mark Completed", systemImage: "checkmark.circle.fill")
                    }
                    Button { createBulkWork(from: visibleEmails, title: "Selected Mail Mission", kind: nil) } label: { Label("Create Mission", systemImage: "target") }
                    Button { createBulkWork(from: visibleEmails, title: "Selected Mail Brief", kind: .executiveBrief) } label: { Label("Create Brief", systemImage: "doc.text") }
                    Button { createBulkWork(from: visibleEmails, title: "Selected Mail Report", kind: .statusReport) } label: { Label("Create Report", systemImage: "chart.bar.doc.horizontal") }
                    Button { createBulkWork(from: visibleEmails, title: "Selected Mail Deliverable", kind: .actionReport) } label: { Label("Create Deliverable", systemImage: "shippingbox") }
                    Button { createFollowUpCampaign(from: visibleEmails) } label: { Label("Follow-Up Campaign", systemImage: "arrow.triangle.branch") }
                }
                Section("AI") {
                    Button {
                        let selected = selectedEmails(in: visibleEmails)
                        finishSelection()
                        Task { await app.triageVisible(selected) }
                    } label: {
                        Label("Bulk Summary", systemImage: "sparkles")
                    }
                    Menu("Bulk Classification") {
                        ForEach(SmartMailCategory.allCases.filter { $0 != .unread && $0 != .archived }) { category in
                            Button {
                                for email in selectedEmails(in: visibleEmails) {
                                    app.learnSmartMailCategory(category, for: email)
                                }
                                finishSelection()
                            } label: {
                                Label(category.rawValue, systemImage: category.symbol)
                            }
                        }
                    }
                    Button { assignCategory(.priority, to: visibleEmails) } label: { Label("Assign Priority", systemImage: "bolt.fill") }
                    Button { assignCategory(.customers, to: visibleEmails) } label: { Label("Assign Customer", systemImage: "person.crop.rectangle.stack") }
                }
                Section("Mail") {
                    Button(role: .destructive) {
                        let selected = selectedEmails(in: visibleEmails)
                        Task {
                            var failures = 0
                            for email in selected {
                                if !(await app.moveToJunk(email)) { failures += 1 }
                            }
                            if failures == 0 { finishSelection() }
                            else {
                                let noun = failures == 1 ? "message" : "messages"
                                app.errorMessage = "\(failures) selected \(noun) could not be moved to Junk."
                            }
                        }
                    } label: {
                        Label("Mark Junk", systemImage: "exclamationmark.octagon")
                    }
                    .accessibilityIdentifier("selection-junk")
                    Button {
                        let selected = selectedEmails(in: visibleEmails)
                        let anyUnstarred = selected.contains { !$0.isStarred }
                        Task { for email in selected { await app.setStar(email, starred: anyUnstarred) } }
                        finishSelection()
                    } label: {
                        Label("Toggle Star", systemImage: "star")
                    }
                    .accessibilityIdentifier("selection-star")
                }
            } label: {
                Image(systemName: "ellipsis.circle").font(.title3)
            }
            .accessibilityLabel("More bulk actions")
            .accessibilityIdentifier("selection-more")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .background(.regularMaterial, in: Capsule())
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
    }

    private func selectedEmails(in visibleEmails: [EmailMessage]) -> [EmailMessage] {
        visibleEmails.filter { selectedEmailIds.contains($0.emailId) }
    }

    private func markSelected(_ visibleEmails: [EmailMessage], unread: Bool) {
        let selected = selectedEmails(in: visibleEmails)
        Task {
            for email in selected {
                if unread { app.markUnread(email) } else { await app.markRead(email) }
            }
        }
        finishSelection()
    }

    private func assignCategory(_ category: SmartMailCategory, to visibleEmails: [EmailMessage]) {
        for email in selectedEmails(in: visibleEmails) { app.learnSmartMailCategory(category, for: email) }
        app.errorMessage = "Selected messages assigned to \(category.rawValue)."
        finishSelection()
    }

    private func createBulkWork(from visibleEmails: [EmailMessage], title: String, kind: DeliverableKind?) {
        let selected = selectedEmails(in: visibleEmails)
        guard !selected.isEmpty else { return }
        app.createMission(title: "\(title) · \(selected.count)", goal: "Review and complete the selected mailbox work.")
        if let kind, let mission = app.missions.first { app.createDeliverable(for: mission, kind: kind) }
        app.errorMessage = kind == nil ? "Mission created in Work." : "\(kind!.rawValue) created in Work."
        finishSelection()
    }

    private func createFollowUpCampaign(from visibleEmails: [EmailMessage]) {
        let selected = selectedEmails(in: visibleEmails)
        Task { for email in selected { await app.move(email, to: .followUp) } }
        app.createMission(title: "Follow-Up Campaign · \(selected.count)", goal: "Review, sequence and complete follow-ups for the selected messages.")
        app.errorMessage = "Follow-up campaign created in Work."
        finishSelection()
    }

    private func selectionHasAllVisible(in visibleEmails: [EmailMessage]) -> Bool {
        let visibleIDs = Set(visibleEmails.map(\.emailId))
        return !visibleIDs.isEmpty && visibleIDs.isSubset(of: selectedEmailIds)
    }

    private func toggleSelectAllVisible(in visibleEmails: [EmailMessage]) {
        let visibleIDs = Set(visibleEmails.map(\.emailId))
        if selectionHasAllVisible(in: visibleEmails) {
            selectedEmailIds.subtract(visibleIDs)
        } else {
            selectedEmailIds.formUnion(visibleIDs)
        }
    }

    private func finishSelection() {
        isSelectionMode = false
        selectedEmailIds.removeAll()
    }
}

private enum InboxFilter: String, CaseIterable, Identifiable {
    case today
    case yesterday
    case lastSevenDays
    case all
    case needsReply
    case priority
    case waiting
    case followUp
    case people
    case customers
    case work
    case finance
    case orders
    case travel
    case notifications
    case archived
    case scheduled
    case completed
    case urgent
    case personal
    case updates
    case promotion
    case social
    case junk
    case newsletter
    case system
    case unread
    case starred
    case vip
    case attachments
    case calendar
    case gmail
    case cloudMail

    var id: String { rawValue }

    var projectionCategoryKey: String? {
        switch self {
        case .people: return "people"
        case .customers: return "customers"
        case .work: return "work"
        case .finance: return "finance"
        case .orders: return "orders"
        case .travel: return "travel"
        case .notifications: return "notifications"
        case .urgent: return "urgent"
        case .personal: return "personal"
        case .updates: return "updates"
        case .promotion: return "promotions"
        case .social: return "social"
        case .newsletter: return "newsletter"
        case .system: return "system"
        case .priority: return "priority"
        default: return nil
        }
    }

    /// Explicit UCS read-model membership. This intentionally remains separate
    /// from Category facets: state facts come only from the projection contract.
    var projectionMembershipKey: String? {
        switch self {
        case .vip: return "vip"
        case .unread: return "unread"
        case .starred: return "starred"
        case .attachments: return "attachments"
        default: return nil
        }
    }

    var title: String {
        switch self {
        case .today: return "Today"
        case .yesterday: return "Yesterday"
        case .lastSevenDays: return "Last 7 Days"
        case .all: return "All Mail"
        case .needsReply: return "Action"
        case .people: return "People"
        case .customers: return "Customers"
        case .work: return "Work"
        case .finance: return "Finance"
        case .orders: return "Orders"
        case .travel: return "Travel"
        case .notifications: return "Notifications"
        case .archived: return "Archived"
        case .scheduled: return "Scheduled"
        case .completed: return "Completed"
        case .priority: return "Priority"
        case .waiting: return "Waiting Reply"
        case .followUp: return "Following Up"
        case .urgent: return "Urgent"
        case .personal: return "Personal"
        case .updates: return "Updates"
        case .promotion: return "Promotions"
        case .social: return "Social"
        case .junk: return "Junk"
        case .newsletter: return "Newsletters"
        case .system: return "System"
        case .unread: return "Unread"
        case .starred: return "Starred"
        case .vip: return "VIP"
        case .attachments: return "Attachments"
        case .calendar: return "Calendar"
        case .gmail: return "Gmail"
        case .cloudMail: return "NEXORA Mail"
        }
    }

    var symbol: String {
        switch self {
        case .today: return "sun.max.fill"
        case .yesterday: return "clock.arrow.circlepath"
        case .lastSevenDays: return "calendar.badge.clock"
        case .all: return "tray.2.fill"
        case .needsReply: return "arrowshape.turn.up.left.fill"
        case .people: return "person.2.fill"
        case .customers: return "person.crop.circle.badge.checkmark"
        case .work: return "briefcase.fill"
        case .finance: return "creditcard.fill"
        case .orders: return "shippingbox.fill"
        case .travel: return "airplane"
        case .notifications: return "bell.badge.fill"
        case .archived: return "archivebox.fill"
        case .scheduled: return "calendar"
        case .completed: return "checkmark.circle.fill"
        case .priority: return "exclamationmark.shield.fill"
        case .waiting: return "clock.fill"
        case .followUp: return "arrowshape.turn.up.right.fill"
        case .urgent: return "exclamationmark.shield.fill"
        case .personal: return "person.fill"
        case .updates: return "bell.fill"
        case .promotion: return "tag.fill"
        case .social: return "bubble.left.and.bubble.right.fill"
        case .junk: return "exclamationmark.octagon.fill"
        case .newsletter: return "newspaper.fill"
        case .system: return "gearshape.fill"
        case .unread: return "circle.fill"
        case .starred: return "star.fill"
        case .vip: return "person.crop.circle.badge.checkmark"
        case .attachments: return "paperclip"
        case .calendar: return "calendar"
        case .gmail: return UnifiedMailProvider.gmail.symbol
        case .cloudMail: return UnifiedMailProvider.cloudflareNative.symbol
        }
    }

    var tint: Color {
        switch self {
        case .today: return .orange
        case .yesterday, .lastSevenDays: return .secondary
        case .needsReply: return .orange
        case .people, .customers, .work: return VisualSystemV3.ColorToken.accent
        case .finance: return .secondary
        case .orders: return .orange
        case .travel, .notifications: return VisualSystemV3.ColorToken.accent
        case .archived, .completed: return .secondary
        case .scheduled: return VisualSystemV3.ColorToken.accent
        case .priority: return .red
        case .waiting: return .secondary
        case .followUp: return VisualSystemV3.ColorToken.accent
        case .urgent: return .red
        case .personal, .updates: return VisualSystemV3.ColorToken.accent
        case .promotion: return .orange
        case .social: return VisualSystemV3.ColorToken.accent
        case .junk: return .orange
        case .newsletter: return .secondary
        case .system: return .secondary
        case .gmail: return .red
        case .cloudMail: return VisualSystemV3.ColorToken.accent
        case .starred: return .orange
        default: return .accentColor
        }
    }
}


private struct SmartFolderClassification {
    let needsReply: Bool
    let todo: Bool
    let followUp: Bool
    let waiting: Bool
    let important: Bool
    let junk: Bool
}

private struct MailQueueSemantics {
    let today: Bool
    let needsReply: Bool
    let followUp: Bool
    let waiting: Bool
    let priority: Bool
}

// MARK: - Row

private struct UnifiedLocalLedgerItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let detail: String
    let icon: String
    let sortDate: Date
    let action: UnifiedLocalLedgerAction

    var searchText: String {
        "\(title) \(subtitle) \(detail)".lowercased()
    }

    var normalizedSearchText: String {
        searchText
            .map { $0.isLetter || $0.isNumber ? String($0) : " " }
            .joined()
            .split(separator: " ")
            .joined(separator: " ")
    }
}

private enum UnifiedLocalLedgerAction {
    case sent(LocalSentMessage)
    case outbox(LocalOutboxMessage)
    case draft(LocalMailDraft)
    case scheduled(LocalScheduledMessage)
}

struct LocalMessageRow: View {
    let title: String
    let subtitle: String
    let detail: String
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .frame(width: 34, height: 34)
                .foregroundStyle(Color.accentColor)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
        }
        .padding(12)
        .glassCard(cornerRadius: 16)
        .padding(.vertical, 4)
    }
}

private enum InboxSmartBucket: String, Identifiable {
    case critical
    case people
    case operations
    case updates
    case promotions

    var id: String { rawValue }
}

private struct InboxSmartGroup: Identifiable {
    let id: InboxSmartBucket
    let title: String
    let symbol: String
    let emails: [EmailMessage]
}

struct EmailRow: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.colorScheme) private var colorScheme
    let email: EmailMessage
    let showsInlineStarControl: Bool

    init(email: EmailMessage, showsInlineStarControl: Bool = true) {
        self.email = email
        self.showsInlineStarControl = showsInlineStarControl
    }

    private var triage: MailTriage? { app.triageCache[email.emailId] }
    private var isTriaging: Bool { app.triagingIDs.contains(email.emailId) }

    private var densityPadding: CGFloat {
        switch app.mailDensity {
        case .compact: return 5
        case .comfortable: return 7
        case .expanded: return 10
        }
    }

    private var previewLineLimit: Int {
        1
    }

    private var primaryText: Color { VisualSystemV3.ColorToken.primaryText(for: colorScheme) }
    private var secondaryText: Color { VisualSystemV3.ColorToken.secondaryText(for: colorScheme) }
    private var tertiaryText: Color { VisualSystemV3.ColorToken.tertiaryText(for: colorScheme) }

    var body: some View {
        let bodyPreview = email.preview
        let classification = app.smartMailClassification(for: email)
        HStack(alignment: .top, spacing: 9) {
            Circle()
                .fill(email.isUnread ? Color.accentColor : Color.clear)
                .frame(width: 5, height: 5)
                .padding(.top, 8)
                .accessibilityHidden(true)

            SenderAvatar(name: email.fromName, size: 28)
                .saturation(0.45)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(email.fromName)
                        .font(.subheadline.weight(email.isUnread ? .bold : .semibold))
                        .foregroundStyle(primaryText)
                        .lineLimit(1)
                    Spacer()
                    if let date = email.date {
                        Text(date.mailListLabel)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(tertiaryText)
                    }
                }

                Text(email.displaySubject)
                    .font(.subheadline.weight(email.isUnread ? .semibold : .medium))
                    .foregroundStyle(email.isUnread ? primaryText : secondaryText)
                    .lineLimit(1)

                if let triage {
                    HStack(spacing: 6) {
                        compactClassificationLabel(classification)
                        Text(ProductSafeText.sanitize(triage.summary, context: .preview))
                            .font(.caption)
                            .foregroundStyle(secondaryText)
                            .lineLimit(previewLineLimit)
                    }
                } else {
                    HStack(spacing: 6) {
                        compactClassificationLabel(classification)
                        Text(bodyPreview)
                            .font(.caption)
                            .foregroundStyle(secondaryText)
                            .lineLimit(previewLineLimit)
                    }
                }
            }

            if isTriaging {
                ProgressView().controlSize(.small)
            }
            if showsInlineStarControl {
                EmailRowStarControl(email: email)
            }
        }
        .padding(densityPadding)
        .glassCard(cornerRadius: 8)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("Email row content \(email.emailId)")
        .accessibilityLabel(emailRowAccessibilityLabel)
        .padding(.vertical, 0)
    }

    @ViewBuilder
    private func compactClassificationLabel(_ classification: SmartMailClassification) -> some View {
        Label(classification.category.rawValue, systemImage: classification.category.symbol)
            .font(.caption2.weight(.medium))
            .foregroundStyle(tertiaryText)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .help(classification.reason)
            .accessibilityLabel("\(classification.category.rawValue). \(classification.reason). Confidence \(classification.confidence) percent")
    }

    private var emailRowAccessibilityLabel: String {
        let source = email.sourceAccount.isEmpty ? email.sourceProvider.title : email.sourceAccount
        let aiAttribution = triage?.execution.map { metadata in
            if metadata.requestedProvider == metadata.executedProvider {
                return "AI: \(metadata.executedProvider.title) · \(metadata.localOrCloud.capitalized)"
            }
            return "AI: \(metadata.executedProvider.title) · \(metadata.localOrCloud.capitalized) · requested \(metadata.requestedProvider.title)"
        }
        return [
            "Email row \(email.emailId)",
            email.fromName,
            email.displaySubject,
            source,
            email.preview,
            aiAttribution
        ]
        .compactMap { $0 }
        .joined(separator: ". ")
    }
}

private struct EmailRowStarControl: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.colorScheme) private var colorScheme
    let email: EmailMessage

    var body: some View {
        Button {
            Task { await app.setStar(email, starred: !email.isStarred) }
        } label: {
            Image(systemName: email.isStarred ? "star.fill" : "star")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(email.isStarred ? Color.orange : VisualSystemV3.ColorToken.tertiaryText(for: colorScheme).opacity(0.82))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(email.isStarred ? "Unstar message" : "Star message")
        .accessibilityIdentifier("inline-star-toggle-\(email.emailId)")
    }
}

private struct MailboxIdentityChip: View {
    @Environment(\.colorScheme) private var colorScheme
    let email: EmailMessage

    private var label: String {
        let account = email.sourceAccount.isEmpty ? email.sourceProvider.title : email.sourceAccount
        return "Received by \(account)"
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(email.sourceProvider.identityColor)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
        }
        .foregroundStyle(VisualSystemV3.ColorToken.secondaryText(for: colorScheme))
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(email.sourceProvider.identityColor.opacity(0.10), in: Capsule())
        .accessibilityLabel(label)
    }
}

private struct MailRowActions: ViewModifier {
    @EnvironmentObject private var app: AppState
    let email: EmailMessage
    let accessibilityLabel: String
    let selectionMode: Bool
    let moveToJunk: (EmailMessage) -> Void
    let restoreToInbox: (EmailMessage) -> Void
    let triage: (EmailMessage) -> Void
    let classify: (EmailMessage) -> Void

    func body(content: Content) -> some View {
        Group {
            if selectionMode {
                content
            } else {
                content
                    // Keep destructive mail operations explicit. A full trailing
                    // swipe must never delete a message without a deliberate tap.
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Task { _ = await app.delete(email) }
                        } label: {
                            Label("Trash", systemImage: "trash")
                        }
                        .accessibilityIdentifier("email-swipe-trash-\(email.emailId)")

                        Button {
                            moveToJunk(email)
                        } label: {
                            Label("Junk", systemImage: "exclamationmark.octagon")
                        }
                        .tint(.orange)
                        .accessibilityIdentifier("email-swipe-junk-\(email.emailId)")
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        if app.effectiveFolder(for: email) != .inbox {
                            Button {
                                restoreToInbox(email)
                            } label: {
                                Label("Inbox", systemImage: "tray")
                            }
                            .tint(.green)
                            .accessibilityIdentifier("email-swipe-inbox-\(email.emailId)")
                        }

                        Button {
                            triage(email)
                        } label: {
                            Label("AI", systemImage: "sparkles")
                        }
                        .tint(VisualSystemV3.ColorToken.accent)
                        .accessibilityIdentifier("email-swipe-ai-\(email.emailId)")

                        Button {
                            classify(email)
                        } label: {
                            Label("Classify", systemImage: "tag")
                        }
                        .tint(.gray)
                        .accessibilityIdentifier("email-swipe-classify-\(email.emailId)")
                    }
            }
        }
        .accessibilityIdentifier("Email row \(email.emailId)")
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(selectionMode ? "Selects message" : "Opens message detail. Swipe for mailbox actions.")
        .accessibilityAddTraits(.isButton)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
    }
}

private extension View {
    func mailRowActions(
        email: EmailMessage,
        accessibilityLabel: String,
        selectionMode: Bool,
        moveToJunk: @escaping (EmailMessage) -> Void,
        restoreToInbox: @escaping (EmailMessage) -> Void,
        triage: @escaping (EmailMessage) -> Void,
        classify: @escaping (EmailMessage) -> Void
    ) -> some View {
        modifier(MailRowActions(
            email: email,
            accessibilityLabel: accessibilityLabel,
            selectionMode: selectionMode,
            moveToJunk: moveToJunk,
            restoreToInbox: restoreToInbox,
            triage: triage,
            classify: classify
        ))
    }
}
