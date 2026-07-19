//
//  EmailDetailAIWorkspaceView.swift
//  GlassMail
//

import SwiftUI

struct EmailDetailAIWorkspaceView: View {
    @EnvironmentObject private var app: AppState
    let email: EmailMessage
    @Binding var isExpanded: Bool
    let onDraftReply: () -> Void
    let onTranslate: () -> Void
    let onCreateTask: () -> Void

    private var triage: MailTriage? { app.triageCache[email.emailId] }
    private var isRunning: Bool { app.triagingIDs.contains(email.emailId) }
    private var localAIReady: Bool { app.providerReadiness[.foundation] == true || app.providerReadiness[.apple] == true }
    private var preferredReady: Bool { app.providerReadiness[app.preferredProvider] == true }
    private var canRun: Bool {
        guard app.aiConsent.aiEnabled, app.aiConsent.singleMailRead else { return false }
        if app.preferredProvider.isCloud {
            return (app.aiConsent.cloudAIEnabled && preferredReady) || localAIReady
        }
        return preferredReady || localAIReady
    }
    private var state: ExecutionState {
        if isRunning { return .running }
        if !canRun { return .blocked }
        if triage != nil { return .completed }
        return .ready
    }

    var body: some View {
        CMWorkspaceShell(
            title: "Email AI Workspace",
            subtitle: "Summary, draft reply, translate, and task creation for this mailbox-scoped message.",
            state: state
        ) {
            Button {
                withAnimation(VisualSystemV3.Motion.disclosure) { isExpanded.toggle() }
            } label: {
                HStack {
                    Label("Workspace", systemImage: "sparkles")
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                }
                .font(.caption.weight(.semibold))
            }
            .buttonStyle(.plain)

            if isExpanded {
                CMEvidencePanel(rows: [
                    ("Readiness", readinessLine),
                    ("Authorization", authorizationLine),
                    ("Privacy", "Attachments are \(app.aiConsent.attachmentRead ? "allowed" : "not read")."),
                    ("Boundary", "cross_account_access=false")
                ])

                HStack {
                    detailAction("Summary", "text.alignleft") {
                        runSummary()
                    }
                    detailAction("Draft Reply", "arrowshape.turn.up.left") {
                        onDraftReply()
                    }
                }
                HStack {
                    detailAction("Translate", "character.book.closed") {
                        onTranslate()
                    }
                    detailAction("Create Task", "checkmark.circle") {
                        onCreateTask()
                    }
                }

                if let triage {
                    CMOutputPanel(title: "Output", text: triage.summary.isEmpty ? "No summary available." : ProductSafeText.sanitize(triage.summary, context: .ai))
                } else if isRunning {
                    CMOutputPanel(title: "Output", text: "Generating workspace result...")
                }

                ArtifactCenterView(artifacts: artifacts)
                ExecutionTimelineView(history: history)
            }
        }
    }

    private var readinessLine: String {
        if preferredReady { return "\(app.preferredProvider.title) ready" }
        if localAIReady { return "Local AI ready" }
        return "Provider unavailable"
    }

    private var authorizationLine: String {
        if !app.aiConsent.aiEnabled { return "Runtime Disabled" }
        if !app.aiConsent.singleMailRead { return "Single-message read blocked" }
        return "Mailbox-scoped read allowed"
    }

    private var artifacts: [Artifact] {
        guard let triage else { return [] }
        return [Artifact(title: "Email Summary", source: "AI Briefing", state: .ready, summary: ProductSafeText.sanitize(triage.summary, context: .ai))]
    }

    private var history: [HistoryState] {
        [
            HistoryState(title: "Configure", detail: authorizationLine, state: canRun ? .ready : .blocked),
            HistoryState(title: "Run", detail: isRunning ? "Generating" : "Waiting", state: isRunning ? .running : state),
            HistoryState(title: "Output", detail: triage == nil ? "No artifact yet" : "Summary ready", state: triage == nil ? .notStarted : .completed)
        ]
    }

    private func detailAction(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .disabled(!canRun || isRunning)
    }

    private func runSummary() {
        Task { await app.triageLocal(email, force: true) }
    }

}
