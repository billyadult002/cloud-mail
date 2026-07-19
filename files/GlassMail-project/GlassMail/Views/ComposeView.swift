//
//  ComposeView.swift
//  GlassMail
//

import SwiftUI
import UniformTypeIdentifiers

private struct QueuedUndoSnapshot {
    var from: MailAddress
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var body: String
    var attachments: [LocalAttachmentDraft]
    var draftId: UUID?
}

private enum ComposeRecipientField: Equatable {
    case to
    case cc
    case bcc
}

struct ComposeView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var contactSuggestionProvider = ContactSuggestionProvider()

    var isPresentedAsSheet: Bool = false
    var original: EmailMessage?
    var initialRecipient: String = ""
    var initialBody: String = ""
    var draft: LocalMailDraft?
    var isReplyAll: Bool = false
    var isForward: Bool = false

    @State private var draftId: UUID?
    @State private var fromAddress: MailAddress?
    @State private var recipient: String = ""
    @State private var cc: String = ""
    @State private var bcc: String = ""
    @State private var subject: String = ""
    @State private var messageBody: String = ""
    @State private var guidance: String = ""
    @State private var isSending = false
    @State private var isDrafting = false
    @State private var scheduleDate = Date().addingTimeInterval(3600)
    @State private var attachments: [LocalAttachmentDraft] = []
    @State private var showFileImporter = false
    @State private var localError: String?
    @State private var successMessage: String?
    @State private var sendProgressMessage: String?
    @State private var composeAIExecution: AIExecutionMetadata?
    @State private var aiSuggestion: String?
    @State private var aiSuggestionInstruction: String?
    @State private var isCancelling = false
    @State private var queuedUndoSnapshot: QueuedUndoSnapshot?
    @State private var showCcBcc = false
    @State private var showWritingTools = false
    @State private var showDeliveryOptions = false
#if DEBUG
    @State private var attachmentSmokeApplied = false
    @State private var attachmentSmokeAutoSendStarted = false
    @State private var composeSmokeAutoCancelStarted = false
#endif

    private var localAIReady: Bool {
        app.providerReadiness[.foundation] == true || app.providerReadiness[.apple] == true
    }
    private var composerReadsOriginal: Bool {
        original != nil
    }
    private var allowedAIProviderReady: Bool {
        app.aiConsent.appleLocalEnabled && localAIReady
    }
    private var canUseComposeAI: Bool {
        guard app.aiConsent.aiEnabled else { return false }
        guard !composerReadsOriginal || app.aiConsent.singleMailRead else { return false }
        return allowedAIProviderReady
    }
    private var composeAIUnavailableReason: String? {
        if !app.aiConsent.aiEnabled {
            return "AI is disabled in Consent Center."
        }
        if composerReadsOriginal && !app.aiConsent.singleMailRead {
            return "Reply drafting cannot read the original message until single-message reading is allowed."
        }
        if !app.aiConsent.appleLocalEnabled {
            return "Apple local AI is disabled in Consent Center."
        }
        if !allowedAIProviderReady {
            return "Apple Intelligence is not ready for composer assistance."
        }
        return nil
    }
    private var composeAIReadinessLine: String {
        if localAIReady {
            return "Apple Intelligence is ready."
        }
        return "Apple Intelligence is not ready."
    }
    private var composeAIAuthorizationLine: String {
        if !app.aiConsent.aiEnabled {
            return "AI off by consent."
        }
        if composerReadsOriginal && !app.aiConsent.singleMailRead {
            return "Original-message reading is blocked by consent."
        }
        return composerReadsOriginal ? "Apple Intelligence may read this original message for reply drafting." : "Apple Intelligence uses composer text only."
    }
    private var composeAIPrivacyLine: String {
        let source = composerReadsOriginal ? "the original message and composer text" : "composer text"
        return "Apple Intelligence uses \(source) locally for this request."
    }
    private var recipientSuggestions: [ContactSuggestion] {
        suggestions(for: .to)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let successMessage {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text(successMessage)
                                .font(.subheadline)
                                .bold()
                            Spacer()
                            Button("New") {
                                self.successMessage = nil
                                resetForm()
                            }
                            .buttonStyle(.glass)
                        }
                        .padding(8)
                        .glassCard(cornerRadius: 10)
                        .padding(.bottom, 4)
                    }

                    composeFromRow
                    composeRecipientRow
                    if showCcBcc { ccBccCompactRow }
                    composeSubjectRow
                    composeMessageEditor

                    DisclosureGroup(isExpanded: $showWritingTools) {
                        VStack(alignment: .leading, spacing: 8) {
                            inlineAICommandBar
                            aiDraftButton
                            quickReplyTemplateSection
                            aiSuggestionPreview
                            composeAIInlineStatus
                        }
                        .padding(.top, 6)
                    } label: {
                        compactDisclosureLabel("Writing tools", "sparkles")
                    }
                    .padding(10)
                    .glassCard(cornerRadius: 8)

                    DisclosureGroup(isExpanded: $showDeliveryOptions) {
                        VStack(alignment: .leading, spacing: 8) {
                            attachmentSection
                            readReceiptSection
                            scheduleSection
                        }
                        .padding(.top, 6)
                    } label: {
                        compactDisclosureLabel("Delivery options", "paperplane")
                    }
                    .padding(10)
                    .glassCard(cornerRadius: 8)

                    undoSendBanner

                    if let localError {
                        Text(localError)
                            .font(.caption).foregroundStyle(.red)
                    }
                    if let sendProgressMessage {
                        Label(sendProgressMessage, systemImage: "paperplane.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let execution = composeAIExecution, !messageBody.isEmpty {
                        AIExecutionInlineView(metadata: execution)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(AmbientBackground())
            .navigationTitle(original == nil ? "New message" : (isForward ? "Forward" : "Reply"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                if isPresentedAsSheet {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { cancelCompose() }
                            .disabled(isCancelling)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Clear") { resetForm() }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        saveDraftAction()
                    } label: {
                        Label("Save draft", systemImage: "doc.badge.plus")
                    }
                    .accessibilityLabel("Save draft")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await sendAction() }
                    } label: {
                        if isSending { ProgressView().controlSize(.small) }
                        else { Text("Send") }
                    }
                    .disabled(!canSend || isSending)
                }
            }
            .onAppear(perform: configure)
            .task {
                await contactSuggestionProvider.loadSuggestions(
                    from: app.emails,
                    sendAddresses: app.composeFromAddresses,
                    sendingIdentities: app.sendingIdentities,
                    vip: Set(app.mailClientProfile.vipContactEmails ?? []),
                    starred: Set(app.mailClientProfile.starredContactEmails ?? []),
                    favorites: Set(app.mailClientProfile.favoriteContactEmails ?? []),
                    autocompleteLearning: app.mailClientProfile.autocompleteLearning ?? [:]
                )
            }
            .onAppear {
#if DEBUG
                applyComposeAutoCancelLaunchArgumentIfNeeded()
#endif
            }
            .onChange(of: app.composeFromAddresses.map(\.email)) { _, _ in
                configureDefaultFromIfNeeded()
#if DEBUG
                applyAttachmentSmokeLaunchArgumentsIfNeeded()
#endif
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.item],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    importAttachments(from: urls)
                case .failure(let error):
                    localError = ProductSafeText.sanitize(error.localizedDescription, context: .compose)
                }
            }
        }
    }

    private var composeRecipientRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                Text("To").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 42, alignment: .leading)
                TextField("name@example.com", text: $recipient)
                    .textFieldStyle(.plain)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                    .autocorrectionDisabled()
                Button(showCcBcc ? "Hide" : "CC/BCC") { showCcBcc.toggle() }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(VisualSystemV3.ColorToken.accent)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .glassCard(cornerRadius: 8)
            ComposeRecipientAutocomplete(suggestions: recipientSuggestions) { suggestion in
                applyRecipientSuggestion(suggestion, to: .to)
            }
        }
    }

    private var composeSubjectRow: some View {
        HStack(spacing: 9) {
            Text("Subject").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 50, alignment: .leading)
            TextField("Subject", text: $subject).textFieldStyle(.plain)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 44)
        .glassCard(cornerRadius: 8)
    }

    private var composeMessageEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Text("Message").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button { showFileImporter = true } label: { Image(systemName: "paperclip") }
                    .accessibilityLabel("Add attachment")
                Button { insertSignature() } label: { Image(systemName: "signature") }
                    .accessibilityLabel("Insert signature")
                aiRewriteMenu.labelStyle(.iconOnly)
            }
            .buttonStyle(.plain)
            .foregroundStyle(VisualSystemV3.ColorToken.accent)
            TextEditor(text: $messageBody)
                .frame(minHeight: 170)
                .scrollContentBackground(.hidden)
                .padding(8)
                .accessibilityIdentifier("Compose message body")
                .accessibilityLabel("Message body")
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            if !attachments.isEmpty {
                Label("\(attachments.count) attachment\(attachments.count == 1 ? "" : "s")", systemImage: "paperclip")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .glassCard(cornerRadius: 8)
    }

    private func compactDisclosureLabel(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
    }

    private var aiRewriteMenu: some View {
        Menu {
            Button("Improve") { Task { await runWritingAction("Improve the clarity and flow of this email draft.") } }
            Button("Shorten") { Task { await runWritingAction("Make this email draft concise, shortening it while preserving details.") } }
            Button("Expand") { Task { await runWritingAction("Expand on these points in the email draft, adding necessary detail.") } }
            Button("Translate") { Task { await runWritingAction("Translate this email draft into Chinese.") } }
            Button("Formal") { Task { await runWritingAction("Rewrite this email in a professional, formal tone.") } }
            Button("Friendly") { Task { await runWritingAction("Rewrite this email in a warm, friendly, and conversational tone.") } }
            if original != nil {
                Button("Summarize Thread") { Task { await runWritingAction("Summarize the email thread history concisely.") } }
            }
        } label: {
            Label("AI Helper", systemImage: "sparkles")
                .font(.caption)
        }
        .buttonStyle(.glass)
        .accessibilityIdentifier("AI")
        .accessibilityLabel("AI")
        .disabled(!canUseComposeAI || isDrafting)
        .help(composeAIUnavailableReason ?? "Rewrite with AI")
    }

    private var quickReplyTemplateSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Label("Quick Replies", systemImage: "text.badge.checkmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(app.quickReplyTemplateStore.templates, id: \.self) { template in
                        Button {
                            let separator = messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\n\n"
                            messageBody += "\(separator)\(template)"
                        } label: {
                            Text(template)
                                .font(.caption2.weight(.semibold))
                                .lineLimit(1)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("quick-reply-template")
                    }
                }
            }
        }
        .padding(6)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityIdentifier("quick-reply-template-store")
    }

    private var readReceiptSection: some View {
        Toggle(isOn: Binding(
            get: { app.optionalReadReceiptManager.enabled },
            set: { app.optionalReadReceiptManager.enabled = $0 }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Read receipt request")
                    .font(.caption.weight(.semibold))
                Text("Optional and off by default. This does not prove delivery.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .toggleStyle(.switch)
        .padding(6)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityIdentifier("optional-read-receipt-toggle")
    }

    @ViewBuilder
    private var undoSendBanner: some View {
        if let queuedUndoSnapshot, let pending = app.undoSendQueue.pendingSubject {
            HStack(spacing: 10) {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sending in 5 seconds")
                        .font(.caption.weight(.bold))
                    Text(pending)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Button("Undo") {
                    app.undoSendQueue.undo(
                        app: app,
                        from: queuedUndoSnapshot.from,
                        to: queuedUndoSnapshot.to,
                        cc: queuedUndoSnapshot.cc,
                        bcc: queuedUndoSnapshot.bcc,
                        subject: queuedUndoSnapshot.subject,
                        body: queuedUndoSnapshot.body,
                        attachments: queuedUndoSnapshot.attachments,
                        draftId: queuedUndoSnapshot.draftId
                    )
                    localError = nil
                    app.errorMessage = nil
                    successMessage = "Send cancelled. Draft saved."
                    self.queuedUndoSnapshot = nil
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityIdentifier("undo-send-banner")
        }
    }

    private var inlineAICommandBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "wand.and.stars")
                    .foregroundStyle(canUseComposeAI ? Color.accentColor : Color.secondary)
                    .frame(width: 16)
                TextField("/ai polish, shorten, translate...", text: $guidance)
                    .textFieldStyle(.plain)
                    .disabled(!canUseComposeAI || isDrafting)
                Button {
                    Task {
                        await runWritingAction(guidance.isEmpty ? "Improve this email draft clearly." : guidance)
                    }
                } label: {
                    if isDrafting { ProgressView().controlSize(.small) }
                    else { Image(systemName: "return") }
                }
                .buttonStyle(.glass)
                .disabled(!canUseComposeAI || isDrafting)
                .accessibilityLabel("Run AI command")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    inlineAIChip("Polish", "wand.and.stars", "Improve the clarity and flow of this email draft.")
                    inlineAIChip("Shorten", "text.badge.minus", "Make this email draft concise, shortening it while preserving details.")
                    inlineAIChip("Formal", "briefcase", "Rewrite this email in a professional, formal tone.")
                    inlineAIChip("Friendly", "slider.horizontal.3", "Rewrite this email in a warm, friendly, and conversational tone.")
                    inlineAIChip("Translate", "character.book.closed", "Translate this email draft into Chinese.")
                }
            }
        }
        .padding(6)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func inlineAIChip(_ title: String, _ symbol: String, _ instruction: String) -> some View {
        Button {
            Task { await runWritingAction(instruction) }
        } label: {
            Label(title, systemImage: symbol)
                .font(.caption2.weight(.semibold))
        }
        .buttonStyle(.glass)
        .controlSize(.small)
        .disabled(!canUseComposeAI || isDrafting)
    }

    @ViewBuilder
    private var aiSuggestionPreview: some View {
        if let aiSuggestion {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(aiSuggestionInstruction ?? "AI preview", systemImage: "sparkles")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Button {
                        self.aiSuggestion = nil
                        self.aiSuggestionInstruction = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss AI preview")
                }
                Text(aiSuggestion)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                HStack {
                    Button {
                        messageBody = aiSuggestion
                        self.aiSuggestion = nil
                    } label: {
                        Label("Replace", systemImage: "checkmark.circle.fill")
                    }
                    .buttonStyle(.glassProminent)
                    Button {
                        let separator = messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\n\n"
                        messageBody += "\(separator)\(aiSuggestion)"
                        self.aiSuggestion = nil
                    } label: {
                        Label("Insert", systemImage: "plus.circle.fill")
                    }
                    .buttonStyle(.glass)
                }
                if let composeAIExecution {
                    AIExecutionInlineView(metadata: composeAIExecution)
                }
            }
            .padding(12)
            .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var composeAIInlineStatus: some View {
        HStack(spacing: 8) {
            Image(systemName: canUseComposeAI ? "checkmark.shield.fill" : "lock.fill")
                .foregroundStyle(canUseComposeAI ? Color.green : Color.orange)
            Text(canUseComposeAI ? composeAIReadinessLine : (composeAIUnavailableReason ?? "AI unavailable"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(7)
        .glassCard(cornerRadius: 8)
    }

    private var aiDraftButton: some View {
        Button {
            Task { await draft() }
        } label: {
            if isDrafting { ProgressView().controlSize(.small) }
            else { Label("AI draft", systemImage: "wand.and.stars").font(.caption) }
        }
        .buttonStyle(.glass)
        .disabled(isDrafting || !canUseComposeAI)
        .help(composeAIUnavailableReason ?? "Draft with AI")
    }

    private var scheduleSection: some View {
        HStack(spacing: 8) {
            DatePicker("Schedule", selection: $scheduleDate, displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
            Button {
                scheduleLocally()
            } label: {
                Label("Schedule", systemImage: "clock.badge.checkmark")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.glass)
        }
        .padding(6)
        .glassCard(cornerRadius: 8)
    }

    private var attachmentSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Label("Attachments", systemImage: "paperclip")
                    .font(.caption.weight(.semibold))
                Spacer()
                Button {
                    showFileImporter = true
                } label: {
                    Label("Add files", systemImage: "plus")
                        .font(.caption)
                }
                .buttonStyle(.glass)
#if DEBUG
                Button {
                    addSafeTestAttachment()
                } label: {
                    Label("Safe Test", systemImage: "doc.badge.plus")
                        .font(.caption)
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Add safe test attachment")
#endif
            }
            if attachments.isEmpty {
                Text("No files attached.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(attachments) { attachment in
                    HStack {
                        Image(systemName: "doc.fill")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(attachment.filename)
                                .font(.caption)
                                .lineLimit(1)
                            Text("\(attachment.mimeType) · \(attachment.sizeLabel)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button {
                            attachments.removeAll { $0.id == attachment.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove attachment")
                    }
                    .padding(8)
                    .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                Text("Attachments are saved with this draft and sent through the mailbox send path.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(6)
        .glassCard(cornerRadius: 8)
    }

    @ViewBuilder
    private func field<F: View>(_ title: String, @ViewBuilder content: () -> F) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content()
                .padding(6)
                .glassCard(cornerRadius: 8)
        }
    }

    private var composeFromRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Menu {
                ForEach(app.composeFromAddresses) { address in
                    Button {
                        fromAddress = address
                    } label: {
                        Label {
                            Text("\(address.email) · \(app.canSend(from: address) ? "Can send" : app.sendCapabilityReason(for: address))")
                        } icon: {
                            Image(systemName: fromAddress?.accountId == address.accountId ? "checkmark.circle.fill" : address.displayProvider.symbol)
                        }
                    }
                    .disabled(!app.canSend(from: address))
                }
            } label: {
                HStack(spacing: 9) {
                    Text("From").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 42, alignment: .leading)
                    Image(systemName: fromAddress?.displayProvider.symbol ?? "person.crop.circle")
                        .foregroundStyle(VisualSystemV3.ColorToken.accent)
                    Text(fromAddress?.email ?? "Choose sending identity")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Spacer(minLength: 4)
                    Text(fromAddress.map { app.canSend(from: $0) ? "Can send" : "Unavailable" } ?? "Required")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(fromAddress.map { app.canSend(from: $0) } == true ? VisualSystemV3.ColorToken.success : .orange)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 44)
                .glassCard(cornerRadius: 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .buttonStyle(ClaudePressStyle())
            .accessibilityLabel("From, \(fromAddress?.email ?? "choose identity")")

            if hasReplyIdentityMismatch {
                Label("Received by \(original?.sourceAccount ?? "another mailbox"); verify From before sending.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var ccBccCompactRow: some View {
        HStack(spacing: 6) {
            field("CC") {
                VStack(alignment: .leading, spacing: 4) {
                    TextField("optional", text: $cc)
                        .textFieldStyle(.plain)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()
                    ComposeRecipientAutocomplete(suggestions: suggestions(for: .cc)) { suggestion in
                        applyRecipientSuggestion(suggestion, to: .cc)
                    }
                }
            }
            field("BCC") {
                VStack(alignment: .leading, spacing: 4) {
                    TextField("optional", text: $bcc)
                        .textFieldStyle(.plain)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()
                    ComposeRecipientAutocomplete(suggestions: suggestions(for: .bcc)) { suggestion in
                        applyRecipientSuggestion(suggestion, to: .bcc)
                    }
                }
            }
        }
    }

    private var canSend: Bool {
        guard fromAddress != nil, let fromAddress else { return false }
        return app.canSend(from: fromAddress)
        && !hasReplyIdentityMismatch
        && isValidEmailList(recipient)
        && !messageBody.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var hasReplyIdentityMismatch: Bool {
        guard let original, !original.sourceAccount.isEmpty, let fromAddress else { return false }
        return fromAddress.email.caseInsensitiveCompare(original.sourceAccount) != .orderedSame
    }

    private func sendingIdentityStatus(for address: MailAddress) -> String {
        let capability = app.canSend(from: address) ? "Can send" : app.sendCapabilityReason(for: address)
        if app.defaultSendingIdentity?.email.caseInsensitiveCompare(address.email) == .orderedSame {
            return "Default · \(capability)"
        }
        return capability
    }

    private var aiAssistPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("AI Assist", systemImage: "sparkles")
                .font(.caption.weight(.semibold))
            composeAITruthLayer
            TextField("Enter instruction...", text: $guidance, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.plain)
                .padding(10)
                .glassCard(cornerRadius: 12)
                .disabled(!canUseComposeAI)
            HStack {
                Button("Proofread") {
                    Task { await runWritingAction("Proofread this draft. Correct grammar and spelling without changing meaning.") }
                }
                .disabled(!canUseComposeAI || isDrafting)
                Button("Professional") {
                    Task { await runWritingAction("Rewrite this draft in a professional tone.") }
                }
                .disabled(!canUseComposeAI || isDrafting)
                Button("Draft/Rewrite") {
                    Task {
                        await runWritingAction(guidance.isEmpty ? "Draft or rewrite this email clearly." : guidance)
                    }
                }
                .disabled(!canUseComposeAI || isDrafting)
                if isDrafting { ProgressView().controlSize(.small) }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            if let reason = composeAIUnavailableReason {
                Label(reason, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(12)
        .glassCard(cornerRadius: 14)
    }

    private var composeAITruthLayer: some View {
        VStack(alignment: .leading, spacing: 8) {
            composeAITruthRow(
                icon: localAIReady ? "checkmark.shield.fill" : "exclamationmark.triangle.fill",
                title: "Readiness",
                value: composeAIReadinessLine,
                tint: localAIReady ? .green : .orange
            )
            composeAITruthRow(
                icon: canUseComposeAI ? "lock.open.fill" : "lock.fill",
                title: "Authorization",
                value: composeAIAuthorizationLine,
                tint: canUseComposeAI ? .blue : .red
            )
            composeAITruthRow(
                icon: app.aiConsent.attachmentRead ? "paperclip" : "paperclip.badge.ellipsis",
                title: "Privacy",
                value: composeAIPrivacyLine + " Attachments are \(app.aiConsent.attachmentRead ? "allowed" : "not read by AI").",
                tint: .secondary
            )
            if let execution = composeAIExecution, let reason = execution.fallbackReason {
                composeAITruthRow(
                    icon: "arrow.triangle.2.circlepath",
                    title: "Fallback",
                    value: reason,
                    tint: .orange
                )
            } else if composeAIExecution == nil {
                composeAITruthRow(
                    icon: "doc.text.magnifyingglass",
                    title: "Result",
                    value: "No AI writing result has been generated in this composer yet.",
                    tint: .secondary
                )
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func composeAITruthRow(icon: String, title: String, value: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(value)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func configure() {
        if let draft {
            draftId = draft.id
            recipient = draft.to
            cc = draft.cc
            bcc = draft.bcc
            subject = draft.subject
            messageBody = draft.body
            attachments = draft.effectiveAttachments
        }
        if !initialRecipient.isEmpty, recipient.isEmpty {
            recipient = initialRecipient
        }
        if !initialBody.isEmpty {
            messageBody = initialBody
        }
        if let original {
            if isReplyAll {
                recipient = original.fromAddress
                cc = original.toEmail ?? ""
                let s = original.displaySubject
                subject = s.lowercased().hasPrefix("re:") ? s : "Re: \(s)"
            } else if isForward {
                recipient = ""
                let s = original.displaySubject
                subject = s.lowercased().hasPrefix("fwd:") ? s : "Fwd: \(s)"
                messageBody = "\n\n----- Forwarded Message -----\nFrom: \(original.fromName) <\(original.fromAddress)>\nDate: \(original.date?.formatted() ?? "")\nSubject: \(original.displaySubject)\n\n\(ProductSafeText.sanitize(original.plainBody, context: .preview))"
            } else {
                recipient = original.fromAddress
                let s = original.displaySubject
                subject = s.lowercased().hasPrefix("re:") ? s : "Re: \(s)"
            }
        }
        configureDefaultFromIfNeeded()
        if let from = fromAddress {
            app.setDefaultSendingAddress(from.email)
            if messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                insertSignature()
            }
        }
#if DEBUG
        applyInvalidRecipientSmokeLaunchArgumentsIfNeeded()
        applyAttachmentSmokeLaunchArgumentsIfNeeded()
#endif
    }

    private func configureDefaultFromIfNeeded() {
        guard fromAddress == nil else { return }
        if let draft,
           let match = app.composeFromAddresses.first(where: { $0.email.caseInsensitiveCompare(draft.fromEmail) == .orderedSame }) {
            fromAddress = match
        } else if let to = original?.toEmail,
                  let match = app.composeFromAddresses.first(where: { $0.email.caseInsensitiveCompare(to) == .orderedSame }) {
            fromAddress = match
        } else if let defaultIdentity = app.defaultSendingIdentity,
                  let match = app.composeFromAddresses.first(where: { $0.accountId == defaultIdentity.accountId }) {
            fromAddress = match
        } else {
            fromAddress = app.composeFromAddresses.first(where: { app.canSend(from: $0) })
                ?? app.composeFromAddresses.first
        }
    }

    private func resetForm() {
        draftId = nil
        recipient = ""
        cc = ""
        bcc = ""
        subject = ""
        messageBody = ""
        guidance = ""
        attachments = []
        localError = nil
        composeAIExecution = nil
        aiSuggestion = nil
        aiSuggestionInstruction = nil
        queuedUndoSnapshot = nil
        configure()
    }

    private func cancelCompose() {
        guard !isCancelling else { return }
        isCancelling = true
        let shouldSaveDraft = hasDraftContent
        dismiss()
        guard shouldSaveDraft, let from = fromAddress else { return }
        app.saveDraft(id: draftId, fromEmail: from.email, to: recipient, cc: cc, bcc: bcc, subject: subject, body: messageBody, attachments: attachments)
    }

    private var hasDraftContent: Bool {
        !recipient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !cc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !bcc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !attachments.isEmpty
    }

    private func isValidEmailList(_ value: String) -> Bool {
        let entries = value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !entries.isEmpty else { return false }
        return entries.allSatisfy { item in
            let parts = item.split(separator: "@", maxSplits: 1)
            return parts.count == 2 && parts[1].contains(".") && !parts[0].isEmpty
        }
    }

    private func suggestions(for field: ComposeRecipientField) -> [ContactSuggestion] {
        let token = currentRecipientToken(for: field)
        if field != .to && token.isEmpty { return [] }
        if token.contains("@") { return [] }
        return contactSuggestionProvider.search(query: token)
    }

    private func currentRecipientToken(for field: ComposeRecipientField) -> String {
        recipientValue(for: field)
            .split(separator: ",", omittingEmptySubsequences: false)
            .last
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? recipientValue(for: field)
    }

    private func recipientValue(for field: ComposeRecipientField) -> String {
        switch field {
        case .to: return recipient
        case .cc: return cc
        case .bcc: return bcc
        }
    }

    private func setRecipientValue(_ value: String, for field: ComposeRecipientField) {
        switch field {
        case .to: recipient = value
        case .cc: cc = value
        case .bcc: bcc = value
        }
    }

    private func applyRecipientSuggestion(_ suggestion: ContactSuggestion, to field: ComposeRecipientField) {
        var parts = recipientValue(for: field).split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        if parts.isEmpty {
            parts = [suggestion.email]
        } else {
            parts[parts.count - 1] = " \(suggestion.email)"
        }
        setRecipientValue(parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", "), for: field)
        app.recordAutocompleteSelection(suggestion.email)
    }

    private func draft() async {
        guard canUseComposeAI else {
            localError = composeAIUnavailableReason
            return
        }
        localError = nil
        composeAIExecution = nil
        guard let original else {
            await runWritingAction("Draft a clear email from these notes.")
            return
        }
        isDrafting = true
        defer { isDrafting = false }
        if let text = await app.draftReplyLocal(for: original,
                                           guidance: guidance.isEmpty ? nil : guidance) {
            aiSuggestion = ProductSafeText.sanitize(text, context: .compose)
            aiSuggestionInstruction = "Draft reply"
            composeAIExecution = app.lastTextAIExecution
        }
    }

    private func runWritingAction(_ instruction: String) async {
        guard canUseComposeAI else {
            localError = composeAIUnavailableReason
            return
        }
        localError = nil
        composeAIExecution = nil
        aiSuggestion = nil
        aiSuggestionInstruction = instruction
        isDrafting = true
        defer { isDrafting = false }
        let prompt = messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Subject: \(subject)\nRecipient: \(recipient)"
            : messageBody
        if let result = await app.aiCompleteLocal(instructions: instruction, prompt: prompt) {
            aiSuggestion = ProductSafeText.sanitize(result.text, context: .compose)
            composeAIExecution = result.metadata
        }
    }

    private func sendAction() async {
        guard let from = fromAddress else { return }
        guard !AppState.normalizedRecipients(recipient).isEmpty else {
            localError = "Add at least one valid recipient."
            return
        }
        let snapshot = QueuedUndoSnapshot(
            from: from,
            to: recipient,
            cc: cc,
            bcc: bcc,
            subject: subject,
            body: messageBody,
            attachments: attachments,
            draftId: draftId
        )
        localError = nil
        successMessage = nil
        app.errorMessage = nil
        app.setDefaultSendingAddress(from.email)
        queuedUndoSnapshot = snapshot
        app.undoSendQueue.queue(
            app: app,
            from: snapshot.from,
            to: snapshot.to,
            cc: snapshot.cc,
            bcc: snapshot.bcc,
            subject: snapshot.subject,
            body: snapshot.body,
            attachments: snapshot.attachments,
            draftId: snapshot.draftId
        ) { ok in
            queuedUndoSnapshot = nil
            if ok {
                app.errorMessage = "Provider accepted the message. Delivery remains pending trusted confirmation."
                if isPresentedAsSheet {
                    dismiss()
                } else {
                    resetForm()
                    app.selectedMainTab = 0
                }
            } else {
                localError = app.errorMessage ?? "The message could not be sent. Your draft remains available."
            }
        }
    }

    private func insertSignature() {
        guard let from = fromAddress else { return }
        let signature = app.signature(for: from.email)
        let trimmed = signature.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !messageBody.contains(trimmed) else { return }
        if messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            messageBody = signature.trimmingCharacters(in: .newlines)
        } else {
            messageBody += "\n\(signature)"
        }
    }

    private func saveDraftAction() {
        guard let from = fromAddress else {
            localError = "Choose a From address before saving."
            return
        }
        app.saveDraft(id: draftId, fromEmail: from.email, to: recipient, cc: cc, bcc: bcc, subject: subject, body: messageBody, attachments: attachments)
        if isPresentedAsSheet {
            dismiss()
        } else {
            successMessage = "Draft saved!"
        }
    }

    private func scheduleLocally() {
        guard let from = fromAddress else {
            localError = "Choose a From address before scheduling."
            return
        }
        app.scheduleDraft(
            fromEmail: from.email,
            to: recipient,
            cc: cc,
            bcc: bcc,
            subject: subject,
            body: messageBody,
            attachments: attachments,
            at: scheduleDate
        )
        localError = ProductSafeText.sanitize("Scheduled send saved locally. Automatic delivery is not enabled.", context: .attachmentStatus)
    }

    private func importAttachments(from urls: [URL]) {
        do {
            let loaded = try urls.map(Self.loadAttachment)
            guard attachments.count + loaded.count <= Self.maxAttachmentCount else {
                throw Self.attachmentImportError("Attach up to \(Self.maxAttachmentCount) files.")
            }
            let existingBytes = attachments.reduce(0) { $0 + $1.byteSize }
            let incomingBytes = loaded.reduce(0) { $0 + $1.byteSize }
            guard existingBytes + incomingBytes <= Self.maxTotalAttachmentBytes else {
                throw Self.attachmentImportError("Attachments can total up to \(Self.maxTotalAttachmentBytesLabel).")
            }
            let existingEncodedBytes = attachments.reduce(0) { $0 + Self.encodedPayloadBytes(for: $1.byteSize) }
            let incomingEncodedBytes = loaded.reduce(0) { $0 + Self.encodedPayloadBytes(for: $1.byteSize) }
            guard existingEncodedBytes + incomingEncodedBytes <= Self.maxTotalEncodedAttachmentBytes else {
                throw Self.attachmentImportError("Attachments are too large after mail encoding. Use a smaller file.")
            }
            let existingNames = Set(attachments.map { $0.filename.lowercased() })
            attachments.append(contentsOf: loaded.filter { !existingNames.contains($0.filename.lowercased()) })
            localError = nil
        } catch {
            localError = ProductSafeText.sanitize(error.localizedDescription, context: .compose)
        }
    }

    private static let maxAttachmentCount = 10
    private static let maxAttachmentBytes = 5 * 1024 * 1024
    private static let maxTotalAttachmentBytes = 10 * 1024 * 1024
    private static let maxTotalEncodedAttachmentBytes = 13 * 1024 * 1024
    private static let maxTotalAttachmentBytesLabel = ByteCountFormatter.string(fromByteCount: Int64(maxTotalAttachmentBytes), countStyle: .file)
    private static let blockedAttachmentExtensions: Set<String> = [
        "app", "apk", "bat", "bin", "cmd", "com", "csh", "dmg", "exe", "gadget",
        "inf", "ins", "ipa", "iso", "jar", "js", "jse", "ksh", "lnk", "msi",
        "msp", "pif", "ps1", "scr", "sh", "vb", "vbe", "vbs", "wsf"
    ]

#if DEBUG
    private func applyComposeAutoCancelLaunchArgumentIfNeeded() {
        guard isPresentedAsSheet,
              !composeSmokeAutoCancelStarted,
              ProcessInfo.processInfo.arguments.contains("-CloudMailComposeAutoCancel")
                || ProcessInfo.processInfo.environment["CLOUDMAIL_COMPOSE_AUTO_CANCEL"] == "1" else { return }
        composeSmokeAutoCancelStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            cancelCompose()
        }
    }

    private func applyInvalidRecipientSmokeLaunchArgumentsIfNeeded() {
        guard ProcessInfo.processInfo.arguments.contains("-CloudMailInvalidRecipientSmoke") else { return }
        let timestamp = Self.launchArgumentValue("-CloudMailOutboxTimestamp") ?? Self.safeAttachmentTimestamp()
        if let smokeFrom = Self.launchArgumentValue("-CloudMailOutboxFrom"),
           let match = app.composeFromAddresses.first(where: { $0.email.caseInsensitiveCompare(smokeFrom) == .orderedSame }) {
            fromAddress = match
            app.setDefaultSendingAddress(match.email)
        } else {
            configureDefaultFromIfNeeded()
        }
        recipient = "invalid-recipient"
        subject = "NEXORA outbox invalid recipient test \(timestamp)"
        messageBody = "NEXORA safe invalid recipient test. No private data."
        localError = ProductSafeText.sanitize("Add at least one valid recipient.", context: .compose)
    }

    private func addSafeTestAttachment() {
        addSafeTestAttachment(timestamp: Self.safeAttachmentTimestamp())
    }

    private func addSafeTestAttachment(timestamp: String) {
        let filename = "cloudmail-safe-attachment-test-\(timestamp).txt"
        let body = """
        CloudMail safe attachment test.
        Timestamp: \(timestamp)
        No private data.
        No customer data.
        No personal report content.
        """
        guard let data = body.data(using: .utf8) else {
            localError = ProductSafeText.sanitize("Safe test attachment could not be created.", context: .compose)
            return
        }
        attachments.removeAll { $0.filename == filename }
        attachments.append(
            LocalAttachmentDraft(
                filename: filename,
                mimeType: "text/plain",
                byteSize: data.count,
                contentBase64: data.base64EncodedString()
            )
        )
        localError = nil
    }

    private func applyAttachmentSmokeLaunchArgumentsIfNeeded() {
        guard !attachmentSmokeApplied || !attachmentSmokeAutoSendStarted else { return }
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-CloudMailAttachmentSmoke") else { return }
        let timestamp = Self.launchArgumentValue("-CloudMailAttachmentTimestamp") ?? Self.safeAttachmentTimestamp()
        if let smokeFrom = Self.launchArgumentValue("-CloudMailAttachmentFrom"),
           let match = app.composeFromAddresses.first(where: { $0.email.caseInsensitiveCompare(smokeFrom) == .orderedSame }) {
            fromAddress = match
            app.setDefaultSendingAddress(match.email)
        } else {
            configureDefaultFromIfNeeded()
        }
        recipient = Self.launchArgumentValue("-CloudMailAttachmentTo") ?? ""
        subject = Self.launchArgumentValue("-CloudMailAttachmentSubject") ?? "NEXORA attachment real-use test \(timestamp)"
        messageBody = """
        NEXORA safe attachment send/receive/open test.
        Timestamp: \(timestamp)
        No private data.
        No customer data.
        No personal report content.
        """
        attachments = []
        addSafeTestAttachment(timestamp: timestamp)
        guard canSend else { return }
        attachmentSmokeApplied = true
        if arguments.contains("-CloudMailAttachmentAutoSend"), !attachmentSmokeAutoSendStarted {
            attachmentSmokeAutoSendStarted = true
            Task {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await sendAction()
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

    private static func safeAttachmentTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
#endif

    private static func loadAttachment(from url: URL) throws -> LocalAttachmentDraft {
        let filename = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !filename.isEmpty else {
            throw attachmentImportError("Attachment filename is missing.")
        }
        guard !hasBlockedAttachmentExtension(in: filename) else {
            throw attachmentImportError("\(filename) cannot be attached because executable files are blocked.")
        }

        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }

        let values = try url.resourceValues(forKeys: [.isDirectoryKey])
        guard values.isDirectory != true else {
            throw attachmentImportError("Folders cannot be attached. Choose individual files.")
        }

        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard !data.isEmpty else {
            throw attachmentImportError("\(filename) is empty.")
        }
        guard data.count <= maxAttachmentBytes else {
            let limit = ByteCountFormatter.string(fromByteCount: Int64(maxAttachmentBytes), countStyle: .file)
            throw attachmentImportError("\(filename) is larger than \(limit).")
        }
        guard encodedPayloadBytes(for: data.count) <= maxTotalEncodedAttachmentBytes else {
            throw attachmentImportError("\(filename) is too large after mail encoding.")
        }

        return LocalAttachmentDraft(
            filename: filename,
            mimeType: inferredMimeType(for: url),
            byteSize: data.count,
            contentBase64: data.base64EncodedString()
        )
    }

    private static func inferredMimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension),
           let mimeType = type.preferredMIMEType {
            return mimeType
        }
        return "application/octet-stream"
    }

    private static func encodedPayloadBytes(for byteCount: Int) -> Int {
        ((byteCount + 2) / 3) * 4
    }

    private static func hasBlockedAttachmentExtension(in filename: String) -> Bool {
        let parts = filename
            .lowercased()
            .split(separator: ".")
            .dropFirst()
            .map(String.init)
        return parts.contains { blockedAttachmentExtensions.contains($0) }
    }

    private static func attachmentImportError(_ message: String) -> NSError {
        NSError(domain: "CloudMailAttachmentImport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
