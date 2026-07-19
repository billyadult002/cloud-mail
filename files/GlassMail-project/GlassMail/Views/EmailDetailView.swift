//
//  EmailDetailView.swift
//  GlassMail
//
//  Full message display plus AI actions (summarize / categorize / draft reply)
//  and a Liquid Glass reply composer.
//

import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
import QuickLook
#endif
import Foundation

private enum TranslationTargetLanguage: String, CaseIterable, Identifiable {
    case auto
    case chinese = "zh"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto: return "Auto / System language"
        case .chinese: return "Chinese"
        }
    }

    var instructionName: String {
        switch self {
        case .auto:
            let locale = Locale.current
            if let languageName = locale.localizedString(forLanguageCode: locale.language.languageCode?.identifier ?? "") {
                return "\(languageName) (\(Locale.current.identifier))"
            }
            return Locale.current.identifier
        default: return title
        }
    }
}

private struct EmailTranslationResult: Equatable {
    let language: TranslationTargetLanguage
    let providerUsed: String
    let translatedText: String
    let originalText: String
    let execution: AIExecutionMetadata?
    var showingOriginal = false
}

private enum EmailAIActionKind: String {
    case summarize
    case translate
    case aiBriefingSummary
    case draftReply
    case askEmail

    var title: String {
        switch self {
        case .summarize: return "Summarize"
        case .translate: return "Translate"
        case .aiBriefingSummary: return "AI Briefing"
        case .draftReply: return "Draft Reply"
        case .askEmail: return "Ask AI"
        }
    }
}

private struct AttachmentShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

private struct EmailDetailComposePresentation: Identifiable {
    let id: String
    let email: EmailMessage
    let initialBody: String
    let isReplyAll: Bool
    let isForward: Bool
}

#if os(iOS)
private struct AttachmentPreviewView: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}

private struct AttachmentActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
#endif

private enum EmailAIActionPhase: Equatable {
    case idle
    case running(EmailAIActionKind)
    case success(EmailAIActionKind, String)
    case failure(EmailAIActionKind, String)
    case timeout(EmailAIActionKind, String)
    case cancelled(EmailAIActionKind)

    var runningKind: EmailAIActionKind? {
        if case .running(let kind) = self { return kind }
        return nil
    }

    var isRunning: Bool { runningKind != nil }
}

private enum EmailBriefingActionSource: String, Equatable {
    case auto
    case generateButton
    case refresh
}

private enum EmailBriefingPhase: Equatable {
    case idle
    case autoStarting
    case running
    case success
    case failure
    case timeout
    case cancelled
    case unavailable
}

private struct EmailBriefingState: Equatable {
    var phase: EmailBriefingPhase
    var messageId: Int
    var bodyHash: Int
    var provider: String
    var startedAt: Date?
    var completedAt: Date?
    var resultText: String?
    var category: MailCategory?
    var actionRequired: Bool
    var execution: AIExecutionMetadata?
    var errorMessage: String?
    var isExpanded: Bool
    var lastActionSource: EmailBriefingActionSource?
    var slowWarningVisible: Bool

    static func idle(messageId: Int, bodyHash: Int) -> EmailBriefingState {
        EmailBriefingState(
            phase: .idle,
            messageId: messageId,
            bodyHash: bodyHash,
            provider: "apple_intelligence",
            startedAt: nil,
            completedAt: nil,
            resultText: nil,
            category: nil,
            actionRequired: false,
            execution: nil,
            errorMessage: nil,
            isExpanded: false,
            lastActionSource: nil,
            slowWarningVisible: false
        )
    }

    var canRetry: Bool {
        switch phase {
        case .failure, .timeout, .cancelled, .unavailable, .idle:
            return true
        case .autoStarting, .running, .success:
            return false
        }
    }

    var canCancel: Bool {
        phase == .autoStarting || phase == .running
    }

    var hasSuccessForCurrentBody: Bool {
        phase == .success && resultText?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var isRunning: Bool {
        phase == .autoStarting || phase == .running
    }
}

struct EmailDetailView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let email: EmailMessage
    /// NavigationStack routes are owned by InboxView. A plain dismiss() can be
    /// a no-op for a binding-driven push, so callers may provide the actual
    /// route-pop operation.
    var onBack: (() -> Void)? = nil
#if DEBUG
    var debugAutoAction: String?
#endif

    @State private var composePresentation: EmailDetailComposePresentation?
    @State private var showMessageDetails = false
    @State private var showMoveSheet = false
    @State private var showSenderBulkSheet = false
    @State private var prefilledReply: String?
    @State private var isDrafting = false
    @State private var composeReplyAll = false
    @State private var composeForward = false
    @State private var localStarred: Bool?
    @State private var localFolder: LocalMailBoxKind?
    @State private var loadRemoteImagesOnce = false
    @State private var showTranslateLanguagePicker = false
    @State private var selectedTranslationLanguage: TranslationTargetLanguage = .auto
    @State private var translationResult: EmailTranslationResult?
    @State private var actionStatusMessage: String?
    @State private var actionErrorMessage: String?
    @State private var categoryResultMessage: String?
    @State private var aiActionPhase: EmailAIActionPhase = .idle
    @State private var currentAIActionTask: Task<Void, Never>?
    @State private var currentBriefingTask: Task<Void, Never>?
    @State private var automaticBriefingStarterTask: Task<Void, Never>?
    @State private var briefingSlowWarningTask: Task<Void, Never>?
    @State private var briefingAutoRunKey: String?
    @State private var briefingState = EmailBriefingState.idle(messageId: -1, bodyHash: 0)
    @State private var downloadingAttachmentIDs: Set<Int> = []
    @State private var attachmentPreviewItem: AttachmentShareItem?
    @State private var attachmentShareItem: AttachmentShareItem?
#if DEBUG
    @State private var debugAttachmentActionStarted = false
    @State private var debugDetailActionStarted = false
#endif

    private var displayedEmail: EmailMessage {
        app.emails.first(where: { $0.emailId == email.emailId }) ?? email
    }
    private var displayedIsStarred: Bool {
        localStarred ?? displayedEmail.isStarred
    }
    private var displayedFolder: LocalMailBoxKind {
        localFolder ?? app.effectiveFolder(for: displayedEmail)
    }

    private var triage: MailTriage? {
        if briefingState.hasSuccessForCurrentBody {
            return MailTriage(
                summary: briefingState.resultText ?? "",
                category: briefingState.category ?? .other,
                actionRequired: briefingState.actionRequired,
                suggestedReply: nil,
                execution: briefingState.execution
            )
        }
        return app.triageCache[displayedEmail.emailId]
    }
    private var smartClassification: SmartMailClassification {
        app.smartMailClassification(for: displayedEmail)
    }
    private var isBriefingRunning: Bool { briefingState.isRunning }
    private var localAIReady: Bool {
        app.providerReadiness[.foundation] == true || app.providerReadiness[.apple] == true
    }
    private var localAIAllowed: Bool {
        app.aiConsent.aiEnabled && app.aiConsent.appleLocalEnabled && app.aiConsent.singleMailRead
    }
    private var canGenerateBriefing: Bool {
        localAIAllowed && localAIReady
    }
    private var canAutoStartBriefing: Bool {
        app.aiConsent.aiEnabled && app.aiConsent.appleLocalEnabled && app.aiConsent.singleMailRead
    }
    private var aiBriefingUnavailableReason: String? {
        app.appleIntelligenceAvailabilityMessage
    }
    private var openingSummaryText: String {
        let subject = ProductSafeText.sanitize(displayedEmail.displaySubject, context: .preview)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let body = ProductSafeText.sanitize(displayedEmail.plainBody, context: .preview)
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
            .split(separator: " ")
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty {
            return subject.isEmpty ? "No readable summary is available for this message." : subject
        }
        let sentenceSeparators = CharacterSet(charactersIn: ".!?。！？")
        let sentences = body
            .components(separatedBy: sentenceSeparators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let summary = sentences.prefix(2).joined(separator: ". ")
        return summary.isEmpty ? body : summary
    }

    private var registeredEmailDetailActions: [CloudMailActionDescriptor] {
        [
            CloudMailActionRegistry.emailDetailAction(actionID: "back", label: "Back", icon: "chevron.left", role: .navigation, resultDestination: .navigationDestination),
            CloudMailActionRegistry.emailDetailAction(actionID: "archive", label: "Archive", icon: "archivebox", resultDestination: .toast),
            CloudMailActionRegistry.emailDetailAction(actionID: "delete", label: "Delete", icon: "trash", role: .destructive, resultDestination: .toast),
            CloudMailActionRegistry.emailDetailAction(actionID: "reply", label: "Reply", icon: "arrowshape.turn.up.left", resultDestination: .sheet),
            CloudMailActionRegistry.emailDetailAction(actionID: "reply_all", label: "Reply All", icon: "arrowshape.turn.up.left.2", resultDestination: .sheet),
            CloudMailActionRegistry.emailDetailAction(actionID: "forward", label: "Forward", icon: "arrowshape.turn.up.right", resultDestination: .sheet),
            CloudMailActionRegistry.emailDetailAction(actionID: "mark_read_unread", label: "Mark read/unread", icon: "envelope.badge", resultDestination: .toast),
            CloudMailActionRegistry.emailDetailAction(actionID: "star_unstar", label: "Star / Unstar", icon: "star", resultDestination: .toast),
            CloudMailActionRegistry.emailDetailAction(actionID: "move", label: "Move", icon: "folder", resultDestination: .toast),
            CloudMailActionRegistry.emailDetailAction(actionID: "more", label: "More", icon: "ellipsis.circle", resultDestination: .inlineCard),
            CloudMailActionRegistry.emailDetailAction(actionID: "ai_actions", label: "AI Actions", icon: "sparkles.rectangle.stack", role: .ai, enabled: canGenerateBriefing, disabledReason: aiBriefingUnavailableReason, resultDestination: .inlineCard),
            CloudMailActionRegistry.emailDetailAction(actionID: "ai_summary", label: "AI Summary", icon: "sparkles", role: .ai, enabled: canGenerateBriefing, disabledReason: aiBriefingUnavailableReason, requiresNetwork: false, requiresCloudAI: false, providerCapabilityRequired: "mail_summary", loadingState: "Generating", successState: "Summary shown", resultDestination: .inlineCard),
            CloudMailActionRegistry.emailDetailAction(actionID: "translate", label: "Translate", icon: "character.book.closed", role: .ai, enabled: canGenerateBriefing, disabledReason: translateDisabledReason, requiresNetwork: false, requiresCloudAI: false, providerCapabilityRequired: "translation", loadingState: "Translating", successState: "Translation shown", resultDestination: .sheet),
            CloudMailActionRegistry.emailDetailAction(actionID: "draft_reply", label: "Draft Reply", icon: "wand.and.stars", role: .ai, enabled: canGenerateBriefing, disabledReason: aiBriefingUnavailableReason, requiresNetwork: false, requiresCloudAI: false, providerCapabilityRequired: "draft_reply", loadingState: "Drafting", successState: "Composer opened", resultDestination: .sheet),
            CloudMailActionRegistry.emailDetailAction(actionID: "ask_ai", label: "Ask AI", icon: "sparkles.rectangle.stack", role: .ai, enabled: canGenerateBriefing, disabledReason: aiBriefingUnavailableReason, providerCapabilityRequired: "chat", resultDestination: .inlineCard),
            CloudMailActionRegistry.emailDetailAction(actionID: "copy", label: "Copy", icon: "doc.on.doc", resultDestination: .clipboard),
            CloudMailActionRegistry.emailDetailAction(actionID: "share", label: "Share", icon: "square.and.arrow.up", resultDestination: .systemShare),
            CloudMailActionRegistry.emailDetailAction(actionID: "open_attachment", label: "Open attachment", icon: "paperclip", enabled: displayedEmail.attachmentSignalCount > 0, disabledReason: "No attachment is available on this message.", requiresAttachment: true, resultDestination: .navigationDestination),
            CloudMailActionRegistry.emailDetailAction(actionID: "open_sender", label: "Open sender/contact", icon: "person.crop.circle", enabled: !displayedEmail.fromAddress.isEmpty, disabledReason: "Sender address is not available.", resultDestination: .inlineCard)
        ]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                CompactAccountPillView()
                header
                aiCard
                attachmentCard
                communicationIntelligenceCard
                securityCard
                actionResultCard
                Divider()
                    .opacity(0.58)
                    .padding(.top, 4)
                bodyContent
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(AmbientBackground())
        .navigationTitle(ProductSafeText.sanitize(displayedEmail.displaySubject, context: .preview))
        .navigationBarBackButtonHidden(true)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    if let onBack {
                        onBack()
                    } else {
                        dismiss()
                    }
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .accessibilityIdentifier("email-detail-back-button")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    toggleStarAction()
                } label: {
                    Image(systemName: displayedIsStarred ? "star.fill" : "star")
                        .accessibilityLabel(displayedIsStarred ? "Unstar message" : "Star message")
                }
                .tint(.orange)


                Button {
                    toggleReadStateAction()
                } label: {
                    Image(systemName: displayedEmail.isUnread ? "envelope.open" : "envelope.badge")
                        .accessibilityLabel(displayedEmail.isUnread ? "Mark Read" : "Mark Unread")
                }

                Button {
                    copyMessageAction()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .accessibilityLabel("Copy message")
                }

                Menu {
                    Button { archiveAction() } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                    Button(role: .destructive) { trashAction() } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button { startReplyAll() } label: {
                        Label("Reply All", systemImage: "arrowshape.turn.up.left.2")
                    }
                    Button { toggleReadStateAction() } label: {
                        Label(displayedEmail.isUnread ? "Mark Read" : "Mark Unread", systemImage: displayedEmail.isUnread ? "envelope.open" : "envelope.badge")
                    }
                    Button { copyMessageAction() } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    ShareLink(item: shareText) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    Button { showMessageDetails = true } label: {
                        Label("Message details", systemImage: "info.circle")
                    }
                    Button { openSenderAction() } label: {
                        Label("Sender", systemImage: "person.crop.circle")
                    }
                    Button { createTaskAction() } label: {
                        Label("Create Task", systemImage: "checkmark.circle")
                    }
                    Button { moveAction(.followUp, dismissAfterMove: false) } label: {
                        Label("Follow Up", systemImage: "clock.badge.checkmark")
                    }
                    Menu {
                        Button { snoozeAction(hours: 3) } label: {
                            Label("Later Today", systemImage: "clock")
                        }
                        Button { snoozeAction(hours: 24) } label: {
                            Label("Tomorrow", systemImage: "sun.max")
                        }
                        Button { snoozeAction(hours: 24 * 7) } label: {
                            Label("Next Week", systemImage: "calendar")
                        }
                    } label: {
                        Label("Snooze", systemImage: "clock.arrow.circlepath")
                    }
                    Menu {
                        ForEach(MailOSV2Category.allCases) { category in
                            Button { learnCategoryAction(category) } label: {
                                Label(category.rawValue, systemImage: category.symbol)
                            }
                        }
                    } label: {
                        Label("Move to Category", systemImage: "tag")
                    }
                    if app.unsubscribeDetector.unsubscribeAvailable(in: displayedEmail) {
                        Button { unsubscribeAction() } label: {
                            Label("Unsubscribe", systemImage: "person.crop.circle.badge.minus")
                        }
                    }
                    Button { blockSenderAction() } label: {
                        Label("Block Sender", systemImage: "hand.raised.fill")
                    }
                    Button { showSenderBulkSheet = true } label: {
                        Label("Move All From Sender", systemImage: "person.crop.circle.badge.arrow.forward")
                    }
                    .accessibilityIdentifier("move-all-from-sender")
                    Button { showSenderProfileAction() } label: {
                        Label("Sender Profile", systemImage: "person.text.rectangle")
                    }
                    if displayedFolder != .inbox {
                        Button { restoreToInboxAction() } label: {
                            Label("Move to Inbox", systemImage: "tray.and.arrow.down")
                        }
                    }
                    Button { moveAction(.junk, dismissAfterMove: true) } label: {
                        Label("Move to Junk", systemImage: "exclamationmark.octagon")
                    }
                    Button(role: .destructive) { trashAction() } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .accessibilityLabel("Message actions")
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                replyBar
                Color.clear
                    .frame(height: 14)
                    .accessibilityHidden(true)
            }
        }
        .fullScreenCover(item: $composePresentation) { presentation in
            ComposeView(
                isPresentedAsSheet: true,
                original: presentation.email,
                initialBody: presentation.initialBody,
                isReplyAll: presentation.isReplyAll,
                isForward: presentation.isForward
            )
            .environmentObject(app)
        }
        .sheet(isPresented: $showMessageDetails) {
            NavigationStack {
                sourceTruthCard
                    .padding()
                    .navigationTitle("Message details")
                    #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                    #endif
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showMessageDetails = false }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showMoveSheet) {
            MoveToMailboxSheet { folder in
                moveAction(folder, dismissAfterMove: false)
            }
            .environmentObject(app)
        }
        .sheet(isPresented: $showSenderBulkSheet) {
            SenderBulkClassificationSheet(email: displayedEmail)
                .environmentObject(app)
        }
        .sheet(isPresented: $showTranslateLanguagePicker) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Translate To")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(TranslationTargetLanguage.allCases) { language in
                        Button {
                            queueTranslation(language)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: language == .chinese ? "character.book.closed.fill" : "globe")
                                    .frame(width: 24)
                                Text(language.title)
                                    .font(.callout.weight(.semibold))
                                Spacer()
                                if selectedTranslationLanguage == language {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                            .padding(.horizontal, 12)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                            .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("translate-language-\(language.rawValue)")
                    }
                    Text(translateDisabledReason ?? "NEXORA translates only this selected email after you choose a language.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding()
                .navigationTitle("Translate")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showTranslateLanguagePicker = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $attachmentShareItem) { item in
            AttachmentActivityView(activityItems: [item.url])
        }
        .sheet(item: $attachmentPreviewItem) { item in
            AttachmentPreviewView(url: item.url)
        }
        .alert("Category updated", isPresented: Binding(
            get: { categoryResultMessage != nil },
            set: { if !$0 { categoryResultMessage = nil } }
        )) {
            Button("OK", role: .cancel) { categoryResultMessage = nil }
        } message: {
            Text(categoryResultMessage ?? "")
        }
        .task {
            _ = registeredEmailDetailActions
            resetBriefingStateIfNeeded()
            localStarred = displayedEmail.isStarred
            localFolder = app.effectiveFolder(for: displayedEmail)
            await app.markRead(displayedEmail)
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            await app.refreshProviderReadiness()
            startAutomaticBriefingIfReady()
            scheduleAutomaticBriefingStart()
            await app.analyzeSecurity(displayedEmail)
#if DEBUG
            scheduleDebugAttachmentActionIfNeeded()
            scheduleDebugDetailActionIfNeeded()
#endif
        }
        .onAppear {
            localStarred = displayedEmail.isStarred
            scheduleAutomaticBriefingStart()
#if DEBUG
            scheduleDebugAttachmentActionIfNeeded()
            scheduleDebugDetailActionIfNeeded()
#endif
        }
        .onChange(of: localAIReady) { ready in
            guard ready else { return }
            scheduleAutomaticBriefingStart()
        }
        .onChange(of: displayedEmail.emailId) { _ in
            scheduleAutomaticBriefingStart()
        }
        .onDisappear {
            cancelCurrentAIAction()
            automaticBriefingStarterTask?.cancel()
            automaticBriefingStarterTask = nil
            cancelBriefingSlowWarning()
            currentBriefingTask?.cancel()
            currentBriefingTask = nil
        }
    }

    private var shareText: String {
        """
        \(ProductSafeText.sanitize(displayedEmail.displaySubject, context: .preview))

        From: \(ProductSafeText.sanitize(displayedEmail.fromName, context: .preview)) <\(displayedEmail.fromAddress)>

        \(ProductSafeText.sanitize(displayedEmail.plainBody, context: .preview))
        """
    }

    private var translateDisabledReason: String? {
        canGenerateBriefing ? nil : (aiBriefingUnavailableReason ?? "Apple Intelligence is not ready for translation.")
    }

    @ViewBuilder
    private var actionResultCard: some View {
        if case .running(let kind) = aiActionPhase {
            emailActionStatusCard(
                title: "\(kind.title) running",
                message: "\(kind.title) is using Apple Intelligence. This will time out after \(AppState.appleLocalActionTimeoutSeconds) seconds if the local model does not answer.",
                icon: "sparkles",
                tint: .blue,
                progress: true
            )
        } else if let translationResult {
            translationResultCard(translationResult)
        } else if case .success(let kind, let message) = aiActionPhase {
            emailActionStatusCard(
                title: "\(kind.title) complete",
                message: message,
                icon: "checkmark.circle.fill",
                tint: .green,
                progress: false
            )
        } else if case .timeout(let kind, let message) = aiActionPhase {
            emailActionStatusCard(
                title: "\(kind.title) timed out",
                message: message,
                icon: "clock.badge.exclamationmark",
                tint: .orange,
                progress: false,
                retryKind: kind
            )
        } else if case .failure(let kind, let message) = aiActionPhase {
            emailActionStatusCard(
                title: "\(kind.title) needs attention",
                message: message,
                icon: "exclamationmark.triangle.fill",
                tint: .orange,
                progress: false,
                retryKind: kind
            )
        } else if case .cancelled(let kind) = aiActionPhase {
            emailActionStatusCard(
                title: "\(kind.title) cancelled",
                message: "The Apple Intelligence action was cancelled.",
                icon: "xmark.circle.fill",
                tint: .secondary,
                progress: false,
                retryKind: kind
            )
        } else if let actionErrorMessage {
            emailActionStatusCard(
                title: "Action needs attention",
                message: actionErrorMessage,
                icon: "exclamationmark.triangle.fill",
                tint: .orange,
                progress: false,
                retryKind: nil
            )
        } else if let actionStatusMessage {
            emailActionStatusCard(
                title: "Done",
                message: actionStatusMessage,
                icon: "checkmark.circle.fill",
                tint: .green,
                progress: false,
                retryKind: nil
            )
        }
    }

    private func emailActionStatusCard(title: String, message: String, icon: String, tint: Color, progress: Bool, retryKind: EmailAIActionKind? = nil) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if progress {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 22)
            } else {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                    .frame(width: 22)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            if progress {
                Button {
                    cancelCurrentAIAction()
                } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel AI action")
            }
            if let retryKind {
                Button {
                    retryAIAction(retryKind)
                } label: {
                    Image(systemName: "arrow.clockwise.circle")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Retry \(retryKind.title)")
            }
            Button {
                actionStatusMessage = nil
                actionErrorMessage = nil
                translationResult = nil
                aiActionPhase = .idle
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss action result")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 10)
    }

    private func translationResultCard(_ result: EmailTranslationResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Translation · \(result.language.title)", systemImage: "character.book.closed.fill")
                    .font(.caption.weight(.semibold))
                Spacer()
                Text("Success")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.green)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.green.opacity(0.12), in: Capsule())
                Button {
                    translationResult?.showingOriginal.toggle()
                } label: {
                    Text(result.showingOriginal ? "Show Translation" : "Show Original")
                }
                .font(.caption.weight(.semibold))
            }
            Text(result.showingOriginal ? result.originalText : result.translatedText)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Label("AI route: Apple Intelligence", systemImage: "cpu")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button {
                    showTranslateLanguagePicker = true
                } label: {
                    Label("Change Language", systemImage: "globe")
                }
                .buttonStyle(.glass)
                Button {
                    copyText(result.showingOriginal ? result.originalText : result.translatedText)
                    actionStatusMessage = "Copied translation text."
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .buttonStyle(.glass)
            }
            if let execution = result.execution {
                AIExecutionInlineView(metadata: execution)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 10)
    }

    private var communicationIntelligenceCard: some View {
        let intelligence = app.communicationIntelligence(for: email)
        return VStack(alignment: .leading, spacing: 10) {
            Label("Communication Intelligence", systemImage: "point.3.connected.trianglepath.dotted")
                .font(.subheadline.weight(.semibold))
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 10) {
                intelligenceDimension("Intent", intelligence.intent)
                intelligenceDimension("Action", intelligence.action)
                intelligenceDimension("Context", intelligence.context)
                intelligenceDimension("Relationship", intelligence.relationship)
                intelligenceDimension("Attention", intelligence.attention)
                intelligenceDimension("Trust", intelligence.trust)
                intelligenceDimension("Lifecycle", intelligence.lifecycle)
                intelligenceDimension("Canonical", intelligence.canonicalCode)
                intelligenceDimension("Sender type", intelligence.senderType)
                intelligenceDimension("Business domain", intelligence.businessDomain)
                intelligenceDimension("Business event", intelligence.businessEvent)
                intelligenceDimension("Workflow", intelligence.workflowState)
                intelligenceDimension("Confidentiality", intelligence.confidentiality)
                intelligenceDimension("Entity context", intelligence.entityContext)
                intelligenceDimension("Policy signals", intelligence.policySignals)
                intelligenceDimension("Time context", intelligence.timeContext)
                intelligenceDimension("Open loop", intelligence.openLoop)
                intelligenceDimension("Explanation", intelligence.explanation)
                intelligenceDimension("Correction scope", intelligence.correctionScope)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 10)
    }

    private func intelligenceDimension(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("communication-intelligence-\(title.lowercased())")
            Text(value).font(.caption.weight(.semibold)).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var securityCard: some View {
        let trust = app.trustAssessment(for: email)
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Security & Trust", systemImage: "checkmark.shield.fill")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(trust.trustLevel.rawValue)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(trust.trustScore < 40 ? .red : (trust.trustScore < 70 ? .orange : .green))
            }
            HStack(spacing: 12) {
                trustMetric("Trust", trust.trustScore)
                trustMetric("Security", trust.securityScore)
                trustMetric("Business risk", trust.businessRiskScore)
            }
            Text(trust.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(trust.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if let link = trust.links.first {
                Label("\(link.level.rawValue): \(link.reason)", systemImage: "link")
                    .font(.caption)
                    .foregroundStyle(link.level == .highRisk || link.level == .suspicious ? .orange : .secondary)
                    .lineLimit(2)
            }
            if trust.trackingDetected {
                Label("Tracking detected · blocked locally", systemImage: "eye.slash.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if let analysis = app.securityAnalyses[email.emailId],
               analysis.phishingWarning || analysis.trackerBlocking.blocked || analysis.oneClickUnsubscribe.available {
                if analysis.phishingWarning {
                    Label("Phishing warning", systemImage: "exclamationmark.shield.fill")
                        .foregroundStyle(.red)
                    Text(analysis.phishingSignals.joined(separator: ", "))
                        .font(.caption)
                }
                if analysis.trackerBlocking.blocked {
                    Label("\(analysis.trackerBlocking.trackerCount) tracking image(s) blocked",
                          systemImage: "eye.slash.fill")
                        .foregroundStyle(.orange)
                }
                if analysis.oneClickUnsubscribe.available {
                    Label("One-click unsubscribe available", systemImage: "person.crop.circle.badge.minus")
                }
            }
        }
        .font(.callout)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 10)
    }

    private func trustMetric(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(value)/100")
                .font(.caption.weight(.bold))
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(email.displaySubject)
                .font(.title3.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)

            receivingIdentityStrip

            HStack(spacing: 9) {
                SenderAvatar(name: email.fromName, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(email.fromName)
                        .font(.subheadline.weight(.semibold))
                    if !email.fromAddress.isEmpty {
                        Text(email.fromAddress)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    SourceBadge(
                        provider: email.sourceProvider,
                        account: email.sourceAccount,
                        domain: email.sourceDomain
                    )
                    .padding(.top, 2)
                    if let to = email.toEmail, !to.isEmpty {
                        Text("To: \(to)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !email.ccRecipients.isEmpty {
                        Text("Cc: \(email.ccRecipients)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !email.bccRecipients.isEmpty {
                        Text("Bcc: \(email.bccRecipients)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let date = email.date {
                    Text(date.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(11)
        .glassCard(cornerRadius: 10)
    }

    private var receivingIdentityStrip: some View {
        HStack(spacing: 7) {
            Image(systemName: email.sourceProvider.symbol)
                .font(.caption2.weight(.bold))
                .foregroundStyle(email.sourceProvider.identityColor)
                .frame(width: 18, height: 18)
                .background(email.sourceProvider.identityColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(email.sourceAccount.isEmpty ? email.sourceProvider.title : email.sourceAccount)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text("\(email.sourceProvider.title) · \(email.sourceDomain.isEmpty ? "Mailbox" : email.sourceDomain)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("Received by")
                .font(.caption2.weight(.bold))
                .foregroundStyle(email.sourceProvider.identityColor)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(email.sourceProvider.identityColor.opacity(0.10), in: Capsule())
        }
        .padding(7)
        .background(email.sourceProvider.identityColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var sourceTruthCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Receiving identity", systemImage: email.sourceProvider.symbol)
                .font(.subheadline.weight(.semibold))
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                truthRow("Provider", email.sourceProvider.title)
                truthRow("Account", email.sourceAccount.isEmpty ? "Unknown account" : email.sourceAccount)
                truthRow("Domain", email.sourceDomain.isEmpty ? "Unknown domain" : email.sourceDomain)
                truthRow("Source truth", "Message content is shown under this receiving mailbox.")
                if !email.sourceThreadID.isEmpty {
                    truthRow("Thread", email.sourceThreadID)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 10)
    }

    private func truthRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout)
                .lineLimit(label == "Thread" ? 1 : 2)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private var attachmentCard: some View {
        if email.attachmentSignalCount > 0 {
            VStack(alignment: .leading, spacing: 10) {
                Label("Attachments", systemImage: "paperclip")
                    .font(.subheadline.weight(.semibold))
                if email.visibleAttachments.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(email.attachmentSignalCount) attachment\(email.attachmentSignalCount == 1 ? "" : "s")")
                            .font(.callout.weight(.semibold))
                        Text("The backend reports attachment presence, but filename, size, and type were not included in this message response.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                } else {
                    ForEach(email.visibleAttachments) { attachment in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "doc.fill")
                                .foregroundStyle(.secondary)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(attachment.filename)
                                    .font(.callout.weight(.semibold))
                                Text("\(attachment.contentType) · \(attachment.sizeLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let raw = attachment.downloadURL, let url = URL(string: raw) {
                                HStack(spacing: 10) {
                                    Button {
                                        prepareAttachment(attachment, from: url, mode: .preview)
                                    } label: {
                                        Label("Open", systemImage: "doc.text.magnifyingglass")
                                            .labelStyle(.iconOnly)
                                            .accessibilityLabel("Open attachment")
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(downloadingAttachmentIDs.contains(attachment.id))

                                    Button {
                                        prepareAttachment(attachment, from: url, mode: .share)
                                    } label: {
                                        Label("Download", systemImage: "arrow.down.circle")
                                            .labelStyle(.iconOnly)
                                            .accessibilityLabel("Download attachment")
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(downloadingAttachmentIDs.contains(attachment.id))
                                }
                            } else {
                                Text("Download unavailable")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(10)
                        .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(cornerRadius: 10)
        }
    }

    private enum AttachmentActionMode {
        case preview
        case share
    }

#if DEBUG
    private func scheduleDebugAttachmentActionIfNeeded() {
        guard !debugAttachmentActionStarted,
              let action = Self.launchArgumentValue("-CloudMailAttachmentAutoAction")?.lowercased(),
              let attachment = displayedEmail.visibleAttachments.first,
              let rawURL = attachment.downloadURL,
              let url = URL(string: rawURL) else { return }
        let mode: AttachmentActionMode
        switch action {
        case "preview", "open":
            mode = .preview
        case "share", "download":
            mode = .share
        default:
            return
        }
        debugAttachmentActionStarted = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run {
                prepareAttachment(attachment, from: url, mode: mode)
            }
        }
    }

    private func scheduleDebugDetailActionIfNeeded() {
        guard !debugDetailActionStarted,
              let action = (debugAutoAction ?? Self.launchArgumentValue("-CloudMailDetailAction") ?? ProcessInfo.processInfo.environment["CLOUDMAIL_DETAIL_ACTION"])?.lowercased(),
              action == "reply" || action == "forward" else { return }
        debugDetailActionStarted = true
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await MainActor.run {
                if action == "forward" {
                    startForward()
                } else {
                    startReply(withDraft: false)
                }
            }
        }
    }

    private static func launchArgumentValue(_ key: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: key),
              arguments.indices.contains(index + 1) else { return nil }
        let value = arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
#endif

    private func prepareAttachment(_ attachment: EmailAttachment, from remoteURL: URL, mode: AttachmentActionMode) {
        downloadingAttachmentIDs.insert(attachment.id)
        actionStatusMessage = mode == .preview ? "Opening attachment..." : "Preparing download..."
        actionErrorMessage = nil
        Task {
            do {
                let localURL = try await downloadAttachmentFile(attachment, from: remoteURL)
                await MainActor.run {
                    downloadingAttachmentIDs.remove(attachment.id)
                    actionStatusMessage = nil
                    switch mode {
                    case .preview:
                        attachmentPreviewItem = AttachmentShareItem(url: localURL)
                    case .share:
                        attachmentShareItem = AttachmentShareItem(url: localURL)
                    }
                }
            } catch {
                await MainActor.run {
                    downloadingAttachmentIDs.remove(attachment.id)
                    actionStatusMessage = nil
                    actionErrorMessage = ProductSafeText.sanitize(error.localizedDescription, context: .attachmentStatus)
                }
            }
        }
    }

    private func downloadAttachmentFile(_ attachment: EmailAttachment, from remoteURL: URL) async throws -> URL {
        let (data, response) = try await URLSession.shared.data(from: remoteURL)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw NSError(
                domain: "CloudMailAttachmentDownload",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Attachment download failed with status \(http.statusCode)."]
            )
        }
        guard !data.isEmpty else {
            throw NSError(
                domain: "CloudMailAttachmentDownload",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Attachment download returned an empty file."]
            )
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("CloudMailAttachments", isDirectory: true)
            .appendingPathComponent(String(displayedEmail.emailId), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(Self.safeAttachmentFilename(attachment.filename))
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try data.write(to: destination, options: [.atomic])
        return destination
    }

    private static func safeAttachmentFilename(_ filename: String) -> String {
        let cleaned = filename
            .split(separator: "/")
            .joined(separator: "_")
            .split(separator: ":")
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "NEXORA Attachment" : cleaned
    }

    // MARK: AI card

    private var aiCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            automaticBriefingKickView
            HStack(spacing: 8) {
                Label("AI Briefing", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                if let triage, triage.actionRequired {
                    Text("· Action Needed")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                }
                Spacer()
                if isBriefingRunning {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("AI Briefing")

            briefingSummarySurface
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .task(id: appleBriefingCacheKey) {
            let delays: [UInt64] = [
                250_000_000,
                1_000_000_000,
                2_000_000_000
            ]
            for delay in delays {
                try? await Task.sleep(nanoseconds: delay)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    startAutomaticBriefingIfReady()
                }
                if await MainActor.run(body: { briefingState.isRunning || briefingState.hasSuccessForCurrentBody }) {
                    return
                }
            }
        }
    }

    @ViewBuilder
    private var briefingSummarySurface: some View {
        VStack(alignment: .leading, spacing: 8) {
            SmartClassificationExplanation(classification: smartClassification)
            HStack(spacing: 8) {
                Label("Summarize", systemImage: "text.bubble")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("AI summary")
                Spacer()
                if briefingState.phase == .success || triage != nil {
                    Text("Ready")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.green)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(.green.opacity(0.12), in: Capsule())
                }
            }
            if briefingState.phase == .success, let resultText = briefingState.resultText {
                summaryBadges(category: briefingState.category ?? .other, actionRequired: briefingState.actionRequired)
                Text(ProductSafeText.sanitize(resultText, context: .ai))
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityLabel("AI summary \(ProductSafeText.sanitize(resultText, context: .ai))")
            } else if let triage, !triage.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                summaryBadges(category: triage.category, actionRequired: triage.actionRequired)
                Text(ProductSafeText.sanitize(triage.summary, context: .ai))
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityLabel("AI summary \(ProductSafeText.sanitize(triage.summary, context: .ai))")
            } else if briefingState.isRunning {
                Label(briefingState.slowWarningVisible ? "Still generating briefing..." : "Generating briefing...", systemImage: "hourglass")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text(openingSummaryText)
                    .font(.callout)
                    .foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityLabel("AI summary \(openingSummaryText)")
                    .onAppear {
                        scheduleAutomaticBriefingStart()
                    }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .strokeBorder(Color.gray.opacity(0.18), lineWidth: 1)
        }
    }

    @ViewBuilder
    private func summaryBadges(category: MailCategory, actionRequired: Bool) -> some View {
        HStack(spacing: 8) {
            CategoryBadge(category: category)
            if actionRequired {
                Label("Action needed", systemImage: "bell.badge.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
        }
    }

    private var aiBriefingInlineActions: some View {
        HStack(spacing: 8) {
            NavigationLink {
                EmailTranslationLiveView(email: displayedEmail, language: .chinese)
                    .environmentObject(app)
            } label: {
                Label("Chinese", systemImage: "character.book.closed.fill")
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.borderedProminent)

            NavigationLink {
                EmailTranslationLiveView(email: displayedEmail, language: .auto)
                    .environmentObject(app)
            } label: {
                Label("System", systemImage: "globe")
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.glass)
        }
        .font(.caption.weight(.semibold))
    }

    @ViewBuilder
    private var translateInlineState: some View {
        if case .running(.translate) = aiActionPhase {
            inlineTranslateStatus(
                title: "Translating to \(selectedTranslationLanguage.title)",
                message: "Apple Intelligence is working locally.",
                icon: "character.book.closed.fill",
                tint: .blue,
                progress: true
            )
        } else if let translationResult {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Translation · \(translationResult.language.title)", systemImage: "character.book.closed.fill")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("Ready")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.green)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(.green.opacity(0.12), in: Capsule())
                }
                Text(translationResult.showingOriginal ? translationResult.originalText : translationResult.translatedText)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityLabel("Translation result \(translationResult.translatedText)")
                HStack(spacing: 8) {
                    Button {
                        self.translationResult?.showingOriginal.toggle()
                    } label: {
                        Label(translationResult.showingOriginal ? "Show Translation" : "Show Original", systemImage: "arrow.left.arrow.right")
                    }
                    .buttonStyle(.glass)
                    Button {
                        copyText(translationResult.showingOriginal ? translationResult.originalText : translationResult.translatedText)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(.glass)
                }
                if let execution = translationResult.execution {
                    AIExecutionInlineView(metadata: execution)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else if case .failure(.translate, let message) = aiActionPhase {
            inlineTranslateStatus(
                title: "Translate needs attention",
                message: message,
                icon: "exclamationmark.triangle.fill",
                tint: .orange,
                progress: false
            )
        } else if case .timeout(.translate, let message) = aiActionPhase {
            inlineTranslateStatus(
                title: "Translate timed out",
                message: message,
                icon: "clock.badge.exclamationmark",
                tint: .orange,
                progress: false
            )
        }
    }

    private func inlineTranslateStatus(title: String, message: String, icon: String, tint: Color, progress: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if progress {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 22)
            } else {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                    .frame(width: 22)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var automaticBriefingKickView: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onAppear {
                kickAutomaticBriefingFromVisibleCard()
            }
    }

    // MARK: Body

    private var bodyContent: some View {
        EmailBodyContentView(
            message: displayedEmail,
            loadRemoteImages: remoteImagesAllowed,
            loadRemoteImagesOnce: { loadRemoteImagesOnce = true },
            trustSender: {
                app.trustRemoteImagesFromSender(remoteImageSender)
                loadRemoteImagesOnce = true
            },
            trustDomain: {
                app.trustRemoteImagesFromDomain(remoteImageDomain)
                loadRemoteImagesOnce = true
            }
        )
    }

    private var remoteImageSender: String {
        displayedEmail.fromAddress.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var remoteImageDomain: String {
        remoteImageSender.split(separator: "@").last.map(String.init) ?? ""
    }

    private var remoteImagesAllowed: Bool {
        loadRemoteImagesOnce || app.remoteImagesAllowed(sender: remoteImageSender, domain: remoteImageDomain)
    }

    // MARK: Reply bar

    private var replyBar: some View {
        HStack(spacing: 18) {
            compactReplyBarButton(
                title: "Reply",
                icon: "arrowshape.turn.up.left.fill",
                tint: .blue,
                accessibilityID: "email-detail-reply-icon"
            ) {
                startReply(withDraft: false)
            }

            Menu {
                Button { runBriefing(source: .generateButton, force: true) } label: { Label("Summarize", systemImage: "text.alignleft") }
                Button { askAIAction() } label: { Label("Ask AI", systemImage: "sparkles.rectangle.stack") }
                Button { runTranslation(selectedTranslationLanguage) } label: { Label("Translate", systemImage: "character.book.closed") }
                Button { startReply(withDraft: true) } label: { Label("Draft Reply", systemImage: "wand.and.stars") }
            } label: {
                compactReplyBarIcon(title: "AI", icon: "sparkles", tint: .purple, disabled: !canGenerateBriefing)
            }
            .disabled(!canGenerateBriefing)
            .accessibilityLabel("AI actions")
            .accessibilityIdentifier("email-detail-ai-icon")

            Button {
                showMoveSheet = true
            } label: {
                compactReplyBarIcon(title: "Move", icon: "folder.fill", tint: .blue, disabled: false)
            }
            .accessibilityLabel("Move")
            .accessibilityIdentifier("email-detail-move-icon")
            .help("Move to category")

            Menu {
                Button { startForward() } label: { Label("Forward", systemImage: "arrowshape.turn.up.right") }
                Button { archiveAction() } label: { Label("Archive", systemImage: "archivebox") }
                Button { toggleStarAction() } label: { Label(displayedIsStarred ? "Unflag" : "Flag", systemImage: "flag") }
                Button { showSenderBulkSheet = true } label: {
                    Label("Move All From Sender", systemImage: "person.crop.circle.badge.arrow.forward")
                }
                .accessibilityIdentifier("move-all-from-sender")
                ShareLink(item: shareText) { Label("Export", systemImage: "square.and.arrow.up") }
                Button { blockSenderAction() } label: { Label("Spam", systemImage: "exclamationmark.octagon") }
                Button(role: .destructive) { trashAction() } label: { Label("Delete", systemImage: "trash") }
            } label: {
                compactReplyBarIcon(title: "More", icon: "ellipsis.circle.fill", tint: .secondary, disabled: false)
            }
            .accessibilityLabel("More actions")
            .accessibilityIdentifier("email-detail-more-icon")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(.ultraThinMaterial)
    }

    private func compactReplyBarButton(
        title: String,
        icon: String,
        tint: Color,
        accessibilityID: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            compactReplyBarIcon(title: title, icon: icon, tint: tint, disabled: disabled)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(accessibilityID)
        .help(title)
    }

    private func compactReplyBarLink<Destination: View>(
        title: String,
        icon: String,
        tint: Color,
        accessibilityID: String,
        disabled: Bool = false,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            compactReplyBarIcon(title: title, icon: icon, tint: tint, disabled: disabled)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(accessibilityID)
        .help(title)
    }

    private func compactReplyBarIcon(title: String, icon: String, tint: Color, disabled: Bool) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(disabled ? Color.secondary : tint)
            .frame(width: 38, height: 34)
            .background(.regularMaterial, in: Circle())
            .overlay {
                Circle()
                    .strokeBorder((disabled ? Color.secondary : tint).opacity(0.22), lineWidth: 1)
            }
            .contentShape(Circle())
    }

    // MARK: Actions

    private var currentBriefingBodyHash: Int {
        displayedEmail.plainBody.hashValue
    }

    private func resetBriefingStateIfNeeded() {
        if briefingState.messageId != displayedEmail.emailId || briefingState.bodyHash != currentBriefingBodyHash {
            currentBriefingTask?.cancel()
            currentBriefingTask = nil
            cancelBriefingSlowWarning()
            briefingState = EmailBriefingState.idle(messageId: displayedEmail.emailId, bodyHash: currentBriefingBodyHash)
            if let cached = app.triageCache[displayedEmail.emailId],
               !cached.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                writeBriefingSuccess(cached, source: nil)
            }
        }
    }

    private func startAutomaticBriefingIfReady() {
        resetBriefingStateIfNeeded()
        guard canGenerateBriefing || canAutoStartBriefing else { return }
        guard !briefingState.isRunning else { return }
        guard !briefingState.hasSuccessForCurrentBody else { return }
        runBriefing(source: .auto, force: false)
    }

    private func scheduleAutomaticBriefingStart() {
        automaticBriefingStarterTask?.cancel()
        automaticBriefingStarterTask = Task {
            let delays: [UInt64] = [
                100_000_000,
                800_000_000,
                1_600_000_000,
                3_000_000_000
            ]
            for delay in delays {
                try? await Task.sleep(nanoseconds: delay)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    startAutomaticBriefingIfReady()
                }
                guard !Task.isCancelled else { return }
                if await MainActor.run(body: { briefingState.isRunning || briefingState.hasSuccessForCurrentBody }) {
                    return
                }
            }
        }
    }

    private func kickAutomaticBriefingFromVisibleCard() {
        let delays: [Double] = [0.15, 0.75, 1.5, 3.0]
        for delay in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                startAutomaticBriefingIfReady()
            }
        }
    }

    private func runBriefing(source: EmailBriefingActionSource, force: Bool) {
        resetBriefingStateIfNeeded()
        let automaticStartAllowed = source == .auto && canAutoStartBriefing
        guard canGenerateBriefing || automaticStartAllowed else {
            if source == .auto {
                return
            }
            let reason = aiBriefingUnavailableReason ?? "Apple Intelligence is unavailable on this device or disabled in Settings."
            actionErrorMessage = reason
            briefingState.phase = .unavailable
            briefingState.errorMessage = reason
            briefingState.completedAt = Date()
            briefingState.lastActionSource = source
            return
        }
        let autoRunKey = appleBriefingCacheKey
        if !force, briefingState.hasSuccessForCurrentBody { return }
        if !force, let cached = app.triageCache[displayedEmail.emailId],
           !cached.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            writeBriefingSuccess(cached, source: source)
            return
        }
        if !force { briefingAutoRunKey = autoRunKey }
        if currentBriefingTask != nil {
            currentBriefingTask?.cancel()
            currentBriefingTask = nil
        }
        let startedAt = Date()
        briefingState = EmailBriefingState(
            phase: source == .auto ? .autoStarting : .running,
            messageId: displayedEmail.emailId,
            bodyHash: currentBriefingBodyHash,
            provider: "apple_intelligence",
            startedAt: startedAt,
            completedAt: nil,
            resultText: nil,
            category: nil,
            actionRequired: false,
            execution: nil,
            errorMessage: nil,
            isExpanded: false,
            lastActionSource: source,
            slowWarningVisible: false
        )
        actionStatusMessage = "Generating briefing with Apple Intelligence..."
        actionErrorMessage = nil
        startBriefingSlowWarning(for: displayedEmail.emailId, bodyHash: currentBriefingBodyHash)
        currentBriefingTask = Task {
            let result = await app.triageLocalStrict(displayedEmail, force: force)
            await MainActor.run {
                cancelBriefingSlowWarning()
                switch result {
                case .success(let triage):
                    writeBriefingSuccess(triage, source: source)
                    actionStatusMessage = "AI summary ready."
                    actionErrorMessage = nil
                case .failure(let failure):
                    actionStatusMessage = nil
                    actionErrorMessage = failure.message
                    briefingState.phase = failure == .timeout ? .timeout : (failure == .cancelled ? .cancelled : .failure)
                    briefingState.errorMessage = failure.message
                    briefingState.completedAt = Date()
                    briefingState.lastActionSource = source
                }
                currentBriefingTask = nil
            }
        }
    }

    private func writeBriefingSuccess(_ triage: MailTriage, source: EmailBriefingActionSource?) {
        let summary = ProductSafeText.sanitize(triage.summary, context: .ai)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !summary.isEmpty else {
            briefingState.phase = .failure
            briefingState.errorMessage = "Apple Intelligence returned an empty summary. Try again."
            briefingState.completedAt = Date()
            return
        }
        briefingState.phase = .success
        briefingState.resultText = summary
        briefingState.category = triage.category
        briefingState.actionRequired = triage.actionRequired
        briefingState.execution = triage.execution ?? AIExecutionMetadata(
            requestedProvider: .apple,
            executedProvider: .apple,
            provider: AIProviderKind.apple.title,
            model: AIProviderKind.apple.modelName,
            localOrCloud: AIProviderKind.apple.locality,
            generatedAt: Date(),
            fallbackReason: nil
        )
        briefingState.completedAt = Date()
        briefingState.errorMessage = nil
        briefingState.slowWarningVisible = false
        if let source { briefingState.lastActionSource = source }
        briefingAutoRunKey = appleBriefingCacheKey
        briefingState.isExpanded = false
    }

    private func startBriefingSlowWarning(for messageId: Int, bodyHash: Int) {
        cancelBriefingSlowWarning()
        briefingSlowWarningTask = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard briefingState.messageId == messageId,
                      briefingState.bodyHash == bodyHash,
                      briefingState.isRunning else { return }
                briefingState.slowWarningVisible = true
                actionStatusMessage = "Still generating briefing..."
            }
        }
    }

    private func cancelBriefingSlowWarning() {
        briefingSlowWarningTask?.cancel()
        briefingSlowWarningTask = nil
    }

    private func cancelBriefingAction() {
        currentBriefingTask?.cancel()
        currentBriefingTask = nil
        cancelBriefingSlowWarning()
        briefingState.phase = .cancelled
        briefingState.errorMessage = "Apple Intelligence briefing was cancelled."
        briefingState.completedAt = Date()
        actionStatusMessage = nil
        actionErrorMessage = briefingState.errorMessage
    }

    private func startReply(withDraft: Bool) {
        composeReplyAll = false
        composeForward = false
        if !withDraft {
            prefilledReply = ""
            actionStatusMessage = "Opening reply composer."
            actionErrorMessage = nil
            presentCompose(
                initialBody: "",
                isReplyAll: false,
                isForward: false
            )
            return
        }
        guard !aiActionPhase.isRunning else { return }
        isDrafting = true
        aiActionPhase = .running(.draftReply)
        actionStatusMessage = "Drafting reply with Apple Intelligence..."
        actionErrorMessage = nil
        currentAIActionTask?.cancel()
        currentAIActionTask = Task {
            let draft = await app.draftReplyLocalStrict(for: displayedEmail, guidance: nil)
            await MainActor.run {
                isDrafting = false
                switch draft {
                case .success(let text):
                    prefilledReply = text
                    actionStatusMessage = "AI draft ready."
                    actionErrorMessage = nil
                    aiActionPhase = .success(.draftReply, "Draft ready. AI route: Apple Intelligence.")
                    presentCompose(
                        initialBody: text,
                        isReplyAll: false,
                        isForward: false
                    )
                case .failure(let failure):
                    prefilledReply = ""
                    actionStatusMessage = nil
                    actionErrorMessage = failure.message
                    aiActionPhase = failure == .timeout
                        ? .timeout(.draftReply, failure.message)
                        : .failure(.draftReply, failure.message)
                }
                currentAIActionTask = nil
            }
        }
    }

    private func startReplyAll() {
        composeReplyAll = true
        composeForward = false
        prefilledReply = ""
        actionStatusMessage = "Opening Reply All composer."
        actionErrorMessage = nil
        presentCompose(
            initialBody: "",
            isReplyAll: true,
            isForward: false
        )
    }

    private func startForward() {
        composeReplyAll = false
        composeForward = true
        prefilledReply = ""
        actionStatusMessage = "Opening Forward composer."
        actionErrorMessage = nil
        presentCompose(
            initialBody: "",
            isReplyAll: false,
            isForward: true
        )
    }

    private func presentCompose(initialBody: String, isReplyAll: Bool, isForward: Bool) {
        prefilledReply = initialBody
        composeReplyAll = isReplyAll
        composeForward = isForward
        let mode = isForward ? "forward" : (isReplyAll ? "reply-all" : "reply")
        let bodyKey = initialBody.isEmpty ? "manual" : String(abs(initialBody.hashValue))
        composePresentation = EmailDetailComposePresentation(
            id: "\(displayedEmail.emailId)-\(mode)-\(bodyKey)",
            email: displayedEmail,
            initialBody: initialBody,
            isReplyAll: isReplyAll,
            isForward: isForward
        )
    }

    private func beginTranslateFlow() {
        runTranslation(selectedTranslationLanguage)
    }

    private func queueTranslation(_ language: TranslationTargetLanguage) {
        selectedTranslationLanguage = language
        translationResult = nil
        aiActionPhase = .running(.translate)
        actionErrorMessage = nil
        actionStatusMessage = "Starting \(language.title) translation..."
        showTranslateLanguagePicker = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            runTranslation(language)
        }
    }

    private var translationSourceText: String {
        let body = displayedEmail.plainBody.trimmingCharacters(in: .whitespacesAndNewlines)
        if !body.isEmpty { return body }
        return shareText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func runTranslation(_ language: TranslationTargetLanguage) {
        guard canGenerateBriefing || canAutoStartBriefing else {
            actionErrorMessage = translateDisabledReason ?? "Apple Intelligence is unavailable on this device or disabled in Settings."
            aiActionPhase = .failure(.translate, actionErrorMessage ?? "Apple Intelligence unavailable.")
            return
        }
        let sourceText = translationSourceText
        guard !sourceText.isEmpty else {
            actionErrorMessage = "This message does not have readable text for NEXORA translation."
            actionStatusMessage = nil
            aiActionPhase = .failure(.translate, actionErrorMessage ?? "No readable message text.")
            return
        }
        aiActionPhase = .running(.translate)
        actionErrorMessage = nil
        actionStatusMessage = "Translating to \(language.title)..."
        translationResult = nil
        currentAIActionTask?.cancel()
        currentAIActionTask = Task {
            let result = await app.aiCompleteLocal(
                instructions: "Translate this selected email into \(language.instructionName). Preserve names, dates, amounts, links, and requested actions. Return only the translation.",
                prompt: sourceText
            )
            await MainActor.run {
                if let result {
                    translationResult = EmailTranslationResult(
                        language: language,
                        providerUsed: result.metadata.provider,
                        translatedText: ProductSafeText.sanitize(result.text, context: .ai),
                        originalText: ProductSafeText.sanitize(sourceText, context: .preview),
                        execution: result.metadata
                    )
                    actionStatusMessage = nil
                    actionErrorMessage = nil
                    aiActionPhase = .success(.translate, "Translation ready. AI route: Apple Intelligence.")
                } else {
                    let message = "Apple Intelligence translation was cancelled."
                    actionErrorMessage = message
                    actionStatusMessage = nil
                    aiActionPhase = .cancelled(.translate)
                }
                currentAIActionTask = nil
            }
        }
    }

    private func toggleStarAction() {
        let next = !displayedIsStarred
        Task { @MainActor in
            guard await app.setStar(displayedEmail, starred: next) else {
                actionStatusMessage = nil
                actionErrorMessage = "Could not update the flag. The message state was not changed."
                return
            }
            localStarred = next
            actionStatusMessage = next ? "Message starred." : "Message unstarred."
            actionErrorMessage = nil
        }
    }

    private func archiveAction() {
        moveAction(.done, dismissAfterMove: true)
    }

    private func trashAction() {
        Task { @MainActor in
            guard await app.delete(displayedEmail) else {
                actionStatusMessage = nil
                actionErrorMessage = "Could not move this message to Trash. It remains in \(localFolder?.title ?? "its current folder")."
                return
            }
            actionStatusMessage = "Message moved to Trash."
            actionErrorMessage = nil
            dismiss()
        }
    }

    private func restoreToInboxAction() {
        Task { @MainActor in
            guard await app.restoreToInbox(displayedEmail) else {
                actionStatusMessage = nil
                actionErrorMessage = "Could not move this message back to Inbox."
                return
            }
            localFolder = .inbox
            actionStatusMessage = "Message moved back to Inbox."
            actionErrorMessage = nil
        }
    }

    private func toggleReadStateAction() {
        if displayedEmail.isUnread {
            Task { await app.markRead(displayedEmail) }
            actionStatusMessage = "Message marked read."
        } else {
            app.markUnread(displayedEmail)
            actionStatusMessage = "Message marked unread."
        }
        actionErrorMessage = nil
    }

    private func copyMessageAction() {
        copyText(shareText)
        actionStatusMessage = "Message copied."
        actionErrorMessage = nil
    }

    private func openSenderAction() {
        actionStatusMessage = displayedEmail.fromAddress.isEmpty
            ? "Sender address is not available on this message."
            : "Sender: \(displayedEmail.fromAddress)"
        actionErrorMessage = nil
    }

    private func createTaskAction() {
        moveAction(.todo, dismissAfterMove: false)
    }

    private func askAIAction() {
        guard canGenerateBriefing else {
            actionErrorMessage = aiBriefingUnavailableReason ?? "Apple Intelligence is unavailable on this device or disabled in Settings."
            aiActionPhase = .failure(.askEmail, actionErrorMessage ?? "Apple Intelligence unavailable.")
            return
        }
        actionStatusMessage = "Asking Apple Intelligence to read this email..."
        actionErrorMessage = nil
        runAskAI()
    }

    private var appleBriefingCacheKey: String {
        let bodyHash = displayedEmail.plainBody.hashValue
        return "\(displayedEmail.emailId)-\(bodyHash)-apple_intelligence-auto-summary_v1"
    }

    private func runAskAI() {
        guard !aiActionPhase.isRunning else { return }
        aiActionPhase = .running(.askEmail)
        currentAIActionTask?.cancel()
        currentAIActionTask = Task {
            let prompt = """
            Subject: \(displayedEmail.displaySubject)
            From: \(displayedEmail.fromName)

            \(translationSourceText)
            """
            let result = await app.aiCompleteLocalStrict(
                instructions: "Answer the user's likely question about this selected email in a concise, factual way. If no question is provided, explain the key points and next action.",
                prompt: prompt
            )
            await MainActor.run {
                switch result {
                case .success(let answer):
                    actionStatusMessage = ProductSafeText.sanitize(answer.text, context: .ai)
                    actionErrorMessage = nil
                    aiActionPhase = .success(.askEmail, "Answer ready. AI route: Apple Intelligence.\n\n\(ProductSafeText.sanitize(answer.text, context: .ai))")
                case .failure(let failure):
                    actionStatusMessage = nil
                    actionErrorMessage = failure.message
                    aiActionPhase = failure == .timeout
                        ? .timeout(.askEmail, failure.message)
                        : .failure(.askEmail, failure.message)
                }
                currentAIActionTask = nil
            }
        }
    }

    private func cancelCurrentAIAction() {
        guard let kind = aiActionPhase.runningKind else { return }
        currentAIActionTask?.cancel()
        currentAIActionTask = nil
        isDrafting = false
        actionStatusMessage = nil
        actionErrorMessage = "Cancelled."
        aiActionPhase = .cancelled(kind)
    }

    private func retryAIAction(_ kind: EmailAIActionKind) {
        actionStatusMessage = nil
        actionErrorMessage = nil
        aiActionPhase = .idle
        switch kind {
        case .summarize, .aiBriefingSummary:
            runBriefing(source: .generateButton, force: true)
        case .translate:
            runTranslation(selectedTranslationLanguage)
        case .draftReply:
            startReply(withDraft: true)
        case .askEmail:
            runAskAI()
        }
    }

    private func moveAction(_ folder: LocalMailBoxKind, dismissAfterMove: Bool) {
        Task { @MainActor in
            let moved = folder == .junk
                ? await app.moveToJunk(displayedEmail)
                : await app.move(displayedEmail, to: folder)
            guard moved else {
                actionStatusMessage = nil
                let retainedFolder = localFolder?.title ?? "its current folder"
                actionErrorMessage = "Could not move this message. It remains in \(retainedFolder)."
                return
            }
            localFolder = folder
            actionStatusMessage = "Moved to \(folder.title)."
            actionErrorMessage = nil
            if dismissAfterMove { dismiss() }
        }
    }

    private func snoozeAction(hours: Int) {
        let date = Date().addingTimeInterval(TimeInterval(hours * 3600))
        localFolder = .snoozed
        app.snooze(displayedEmail, until: date)
        actionStatusMessage = "Snoozed until \(date.formatted(date: .abbreviated, time: .shortened))."
        actionErrorMessage = nil
    }

    private func learnCategoryAction(_ category: MailOSV2Category) {
        Task { @MainActor in
            guard await app.applyV2Category(category, for: displayedEmail) else {
                actionStatusMessage = nil
                actionErrorMessage = "Could not move this message to \(category.rawValue)."
                return
            }
            if category == .junk { localFolder = .junk }
            actionStatusMessage = "\(displayedEmail.fromName) filed as \(category.rawValue)."
            actionErrorMessage = nil
            categoryResultMessage = "\(displayedEmail.fromName) is now in \(category.rawValue). This change was saved to the authoritative conversation state."
        }
    }

    private func unsubscribeAction() {
        app.unsubscribeLocally(displayedEmail)
        actionStatusMessage = "Unsubscribe noted locally. Use the sender link to complete unsubscribe."
        actionErrorMessage = nil
    }

    private func blockSenderAction() {
        Task { @MainActor in
            guard await app.blockSenderAndMoveToJunk(displayedEmail) else {
                actionStatusMessage = nil
                actionErrorMessage = "Sender was blocked locally, but the message could not be moved to Junk."
                return
            }
            localFolder = .junk
            actionStatusMessage = "Sender blocked and message moved to Junk."
            actionErrorMessage = nil
        }
    }

    private func moveAllFromSenderAction(to folder: LocalMailBoxKind) {
        Task { @MainActor in
            let result = await app.moveAllFromSender(displayedEmail, to: folder)
            guard result.total > 0 else {
                actionStatusMessage = "All available messages from this sender are already in \(folder.title)."
                actionErrorMessage = nil
                return
            }
            if result.failed == 0 {
                actionStatusMessage = "Moved \(result.moved) messages from this sender to \(folder.title)."
                actionErrorMessage = nil
            } else {
                actionStatusMessage = nil
                actionErrorMessage = "Moved \(result.moved) messages; \(result.failed) could not be moved to \(folder.title)."
            }
        }
    }

    private func showSenderProfileAction() {
        let profile = app.senderProfile(for: displayedEmail)
        actionStatusMessage = "\(profile.name) · \(profile.email) · \(profile.messageCount) message\(profile.messageCount == 1 ? "" : "s") · \(profile.domain)"
        actionErrorMessage = nil
    }

    private func copyText(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #endif
    }
}

// MARK: - Safe body rendering

private struct EmailBodyContentView: View {
    let message: EmailMessage
    let loadRemoteImages: Bool
    let loadRemoteImagesOnce: () -> Void
    let trustSender: () -> Void
    let trustDomain: () -> Void
    private let document: RenderedEmailBody

    init(
        message: EmailMessage,
        loadRemoteImages: Bool,
        loadRemoteImagesOnce: @escaping () -> Void,
        trustSender: @escaping () -> Void,
        trustDomain: @escaping () -> Void
    ) {
        self.message = message
        self.loadRemoteImages = loadRemoteImages
        self.loadRemoteImagesOnce = loadRemoteImagesOnce
        self.trustSender = trustSender
        self.trustDomain = trustDomain
        self.document = EmailBodyRenderer.render(message, loadRemoteImages: loadRemoteImages)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if document.remoteImagesBlocked {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Remote images blocked for privacy", systemImage: "eye.slash.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                    HStack(spacing: 8) {
                        Button("Load Images") { loadRemoteImagesOnce() }
                        Button("Trust Sender") { trustSender() }
                        Button("Trust Domain") { trustDomain() }
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                }
                .padding(9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if let attributed = document.attributedBody {
                Text(attributed)
                    .font(.body)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Label("This message could not be fully rendered.", systemImage: "exclamationmark.triangle")
                        .font(.callout.weight(.semibold))
                    Text(document.plainFallback.isEmpty ? "View plain text." : document.plainFallback)
                        .font(.body)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 2)
    }
}

private struct EmailTranslationLiveView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let email: EmailMessage
    let language: TranslationTargetLanguage

    @State private var isRunning = true
    @State private var translatedText: String?
    @State private var errorMessage: String?
    @State private var execution: AIExecutionMetadata?

    private var sourceText: String {
        let body = email.plainBody.trimmingCharacters(in: .whitespacesAndNewlines)
        if !body.isEmpty { return body }
        return email.displaySubject
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Label("Translation · \(language.title)", systemImage: "character.book.closed.fill")
                    .font(.headline)
                if isRunning {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Translating with Apple Intelligence...")
                            .font(.callout)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                } else if let translatedText {
                    Text(ProductSafeText.sanitize(translatedText, context: .ai))
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    if let execution {
                        AIExecutionInlineView(metadata: execution)
                    }
                } else {
                    Label(errorMessage ?? "Translation did not finish.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding()
        }
        .background(AmbientBackground())
        .navigationTitle("Translate")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") { dismiss() }
                    .accessibilityIdentifier("email-translate-back")
            }
        }
        .task(id: "\(email.emailId)-\(language.id)") {
            await run()
        }
    }

    @MainActor
    private func finish(text: String?, error: String?, execution: AIExecutionMetadata?) {
        translatedText = text
        errorMessage = error
        self.execution = execution
        isRunning = false
    }

    private func run() async {
        let source = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            await finish(text: nil, error: "This message does not have readable text for translation.", execution: nil)
            return
        }
        let result = await app.aiCompleteLocal(
            instructions: "Translate this selected email into \(language.instructionName). Preserve names, dates, amounts, links, and requested actions. Return only the translation.",
            prompt: source
        )
        if let result {
            await finish(text: result.text, error: nil, execution: result.metadata)
        } else {
            await finish(text: nil, error: "Apple Intelligence translation was cancelled.", execution: nil)
        }
    }
}

private struct EmailAIActionHubView: View {
    @EnvironmentObject private var app: AppState
    let email: EmailMessage

    var body: some View {
        List {
            Section("AI Actions") {
                NavigationLink {
                    EmailDraftReplyLiveView(email: email)
                        .environmentObject(app)
                } label: {
                    Label("Draft Reply with AI", systemImage: "wand.and.stars")
                }
                NavigationLink {
                    EmailAskAILiveView(email: email)
                        .environmentObject(app)
                } label: {
                    Label("Ask AI", systemImage: "sparkles.rectangle.stack")
                }
            }
            Section {
                Text("Email Detail AI actions use Apple Intelligence locally by default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("AI Actions")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct EmailDraftReplyLiveView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let email: EmailMessage

    @State private var isRunning = true
    @State private var draftText = ""
    @State private var errorMessage: String?
    @State private var runID = UUID()
    @State private var showCompose = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Label("Draft Reply with AI", systemImage: "wand.and.stars")
                    .font(.headline)
                LabeledContent("AI route", value: "Apple Intelligence")
                    .font(.caption.weight(.semibold))
                LabeledContent("To", value: email.fromAddress.isEmpty ? "Original sender unavailable" : email.fromAddress)
                    .font(.caption)
                LabeledContent("Subject", value: email.displaySubject.lowercased().hasPrefix("re:") ? email.displaySubject : "Re: \(email.displaySubject)")
                    .font(.caption)

                if isRunning {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Drafting locally with Apple Intelligence...")
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                } else if !draftText.isEmpty {
                    Text(ProductSafeText.sanitize(draftText, context: .ai))
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    HStack(spacing: 10) {
                        Button {
                            showCompose = true
                        } label: {
                            Label("Insert into Compose", systemImage: "square.and.pencil")
                        }
                        .buttonStyle(.borderedProminent)
                        Button {
                            copyText(draftText)
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        .buttonStyle(.bordered)
                    }
                    Button {
                        runID = UUID()
                    } label: {
                        Label("Regenerate", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                } else {
                    Label(errorMessage ?? "Draft reply did not finish.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        runID = UUID()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
        }
        .background(AmbientBackground())
        .navigationTitle("Draft Reply")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") { dismiss() }
                    .accessibilityIdentifier("email-draft-reply-back")
            }
        }
        .task(id: runID) {
            await run()
        }
        .sheet(isPresented: $showCompose) {
            ComposeView(
                isPresentedAsSheet: true,
                original: email,
                initialBody: draftText,
                isReplyAll: false,
                isForward: false
            )
            .environmentObject(app)
        }
    }

    private func run() async {
        await MainActor.run {
            isRunning = true
            draftText = ""
            errorMessage = nil
        }
        let result = await app.draftReplyLocalStrict(for: email, guidance: nil)
        await MainActor.run {
            isRunning = false
            switch result {
            case .success(let text):
                draftText = text
            case .failure(let failure):
                errorMessage = failure.message
            }
        }
    }

    private func copyText(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #endif
    }
}

private struct EmailAskAILiveView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let email: EmailMessage

    @State private var question = "What is this email about?"
    @State private var answer = ""
    @State private var isRunning = true
    @State private var errorMessage: String?
    @State private var runID = UUID()

    private let suggestions = [
        "What is this email about?",
        "What should I do next?",
        "Is this urgent?",
        "Draft a short reply."
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Label("Ask AI", systemImage: "sparkles.rectangle.stack")
                    .font(.headline)
                LabeledContent("AI route", value: "Apple Intelligence")
                    .font(.caption.weight(.semibold))
                TextField("Ask about this email", text: $question, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
                    ForEach(suggestions, id: \.self) { prompt in
                        Button(prompt) {
                            question = prompt
                            runID = UUID()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Button {
                    runID = UUID()
                } label: {
                    Label("Ask", systemImage: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRunning || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if isRunning {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Reading this email locally...")
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                } else if !answer.isEmpty {
                    Text(ProductSafeText.sanitize(answer, context: .ai))
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Button {
                        copyText(answer)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(.bordered)
                } else {
                    Label(errorMessage ?? "Ask AI did not finish.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Button {
                        runID = UUID()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
        }
        .background(AmbientBackground())
        .navigationTitle("Ask AI")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") { dismiss() }
                    .accessibilityIdentifier("email-ask-ai-back")
            }
        }
        .task(id: runID) {
            await run()
        }
    }

    private func run() async {
        let currentQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !currentQuestion.isEmpty else { return }
        await MainActor.run {
            isRunning = true
            answer = ""
            errorMessage = nil
        }
        let prompt = """
        Question: \(currentQuestion)

        Subject: \(email.displaySubject)
        From: \(email.fromName)

        \(email.plainBody)
        """
        let result = await app.aiCompleteLocal(
            instructions: "Answer the user's question about this single email. Keep the answer concise. Do not claim to send or deliver messages.",
            prompt: prompt
        )
        await MainActor.run {
            isRunning = false
            if let result {
                answer = result.text
            } else {
                errorMessage = "Apple Intelligence did not return an answer."
            }
        }
    }

    private func copyText(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #endif
    }
}

private struct EmailStarToggleLiveView: View {
    @EnvironmentObject private var app: AppState
    let email: EmailMessage
    let starred: Bool

    @State private var completed = false

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: starred ? "star.fill" : "star")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.orange)
            Text(starred ? "Message starred" : "Message unstarred")
                .font(.headline)
            Text("Saved locally and synced when the mail service accepts the change.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if !completed {
                ProgressView()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AmbientBackground())
        .navigationTitle(starred ? "Starred" : "Unstarred")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: "\(email.emailId)-\(starred)") {
            await app.setStar(email, starred: starred)
            await MainActor.run {
                completed = true
            }
        }
    }
}

private struct RenderedEmailBody {
    let attributedBody: AttributedString?
    let plainFallback: String
    let remoteImagesBlocked: Bool
}

private enum EmailBodyRenderer {
    static func render(_ message: EmailMessage, loadRemoteImages: Bool) -> RenderedEmailBody {
        if let html = message.content?.trimmingCharacters(in: .whitespacesAndNewlines),
           !html.isEmpty {
            let sanitized = sanitizeHTML(String(html.prefix(120_000)), loadRemoteImages: loadRemoteImages)
            if let attributed = attributedHTML(sanitized.html) {
                return RenderedEmailBody(
                    attributedBody: attributed,
                    plainFallback: ProductSafeText.sanitize(
                        EmailMessage.markdownLinksToReadableText(message.lightweightBodySnippet(maxCharacters: 4_000)),
                        context: .preview
                    ),
                    remoteImagesBlocked: sanitized.remoteImagesBlocked
                )
            }
        }

        let plain = ProductSafeText.sanitize(EmailMessage.markdownLinksToReadableText(message.lightweightBodySnippet(maxCharacters: 12_000)), context: .preview)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if plain.isEmpty {
            return RenderedEmailBody(
                attributedBody: nil,
                plainFallback: "",
                remoteImagesBlocked: false
            )
        }

        return RenderedEmailBody(
            attributedBody: attributedPlainText(plain),
            plainFallback: plain,
            remoteImagesBlocked: false
        )
    }

    private static func sanitizeHTML(_ html: String, loadRemoteImages: Bool) -> (html: String, remoteImagesBlocked: Bool) {
        var cleaned = EmailMessage.decodeHTMLEntities(html)
        var remoteImagesBlocked = false

        for tag in ["head", "script", "style", "iframe", "object", "embed", "form", "meta", "link", "noscript", "svg"] {
            cleaned = cleaned.replacingOccurrences(
                of: "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)>",
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
            cleaned = cleaned.replacingOccurrences(
                of: "<\(tag)\\b[^>]*>",
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        let imagePattern = "<img\\b[^>]*src=[\"']?https?://[^>]*>"
        if cleaned.range(of: imagePattern, options: [.regularExpression, .caseInsensitive]) != nil {
            remoteImagesBlocked = !loadRemoteImages
        }
        if !loadRemoteImages {
            cleaned = cleaned.replacingOccurrences(
                of: imagePattern,
                with: "<span>[Remote image blocked]</span>",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        cleaned = cleaned.replacingOccurrences(
            of: "\\s(on[a-z]+)\\s*=\\s*([\"']).*?\\2",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        cleaned = cleaned.replacingOccurrences(
            of: "(href|src)\\s*=\\s*([\"'])\\s*javascript:[^\"']*\\2",
            with: "$1=\"#\"",
            options: [.regularExpression, .caseInsensitive]
        )

        cleaned = cleaned.replacingOccurrences(
            of: "(?is)^.*?<body\\b[^>]*>",
            with: "",
            options: [.regularExpression]
        )
        cleaned = cleaned.replacingOccurrences(
            of: "(?is)</body>.*$",
            with: "",
            options: [.regularExpression]
        )
        cleaned = EmailMessage.markdownLinksToReadableText(cleaned)

        return (wrapHTML(cleaned), remoteImagesBlocked)
    }

    private static func attributedHTML(_ html: String) -> AttributedString? {
        guard let data = html.data(using: .utf8) else { return nil }
        do {
            let ns = try NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue
                ],
                documentAttributes: nil
            )
            var attributed = AttributedString(ns)
            attributed.foregroundColor = .primary
            return attributed
        } catch {
            return nil
        }
    }

    private static func attributedPlainText(_ text: String) -> AttributedString {
        if let markdown = try? AttributedString(
            markdown: convertMarkdownLinksToInlineLinks(text),
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return markdown
        }
        return AttributedString(text)
    }

    private static func convertMarkdownLinksToInlineLinks(_ text: String) -> String {
        EmailMessage.markdownLinksToReadableText(text)
    }

    private static func wrapHTML(_ html: String) -> String {
        """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
        body { font: -apple-system-body; color: #111; line-height: 1.45; }
        a { color: #315efb; text-decoration: underline; }
        table { max-width: 100%; }
        img { max-width: 100%; height: auto; }
        </style>
        </head>
        <body>\(html)</body>
        </html>
        """
    }
}
