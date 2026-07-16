//
//  AIView.swift
//  GlassMail
//

import EventKit
import SwiftUI

struct AIView: View {
    @EnvironmentObject private var app: AppState
    @State private var localError: String?
    @State private var showPrivacyInfo = false
    @State private var showCompose = false
    @State private var chatInput = ""
    @State private var runningChat = false
    @State private var runningWorkspaceAction: AIWorkspaceRealWorkflow?
    @State private var safeActionResult: AIWorkspaceActionResult?
    @State private var messages: [AIWorkspaceMessage] = [
        AIWorkspaceMessage(role: .assistant, text: "Hi, I can summarize your loaded inbox, suggest replies, digest threads, generate drafts, and analyze multiple authorized messages.")
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    CompactAccountPillView()
                        .padding(.horizontal)
                        .padding(.top, 4)

                    HStack {
                        Text("AI Workspace")
                            .font(.title.bold())
                        Spacer()
                        NavigationLink {
                            MissionCenterView().environmentObject(app)
                        } label: {
                            Image(systemName: "target")
                        }
                        .accessibilityLabel("Mission Center")
                        Button {
                            showPrivacyInfo = true
                        } label: {
                            Image(systemName: "info.circle")
                        }
                        .accessibilityLabel("AI privacy information")
                    }
                    .padding(.horizontal)

                    MobileWorkspaceView()
                        .environmentObject(app)
                        .padding(.horizontal)

                    consentCard
                        .padding(.horizontal)

                    appleCard
                        .padding(.horizontal)

                    if let localError {
                        Text(localError)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.horizontal)
                    }
                }
            }
            .background(AmbientBackground())
            .navigationTitle("AI")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .sheet(isPresented: $showPrivacyInfo) {
                NavigationStack {
                    List {
                        Section("Privacy") {
                            Text("Apple Intelligence runs locally on this device. NEXORA AI stays on-device for supported mail actions.")
                        }
                    }
                    .navigationTitle("AI Privacy")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showPrivacyInfo = false }
                        }
                    }
                }
            }
            .sheet(isPresented: $showCompose) {
                ComposeView(isPresentedAsSheet: true)
                    .environmentObject(app)
            }
            .onAppear {
                Task {
                    await app.loadV2Configuration()
                    await app.refreshProviderReadiness()
                }
            }
        }
    }

    private var safeActionPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("AI Actions", systemImage: "checkmark.shield")
                    .font(.subheadline.weight(.semibold))
                Spacer()
            }

            VStack(spacing: 7) {
                ForEach(AIWorkspaceRealWorkflow.allCases) { workflow in
                    NavigationLink {
                        SafeMailActionLiveView(workflow: workflow)
                            .environmentObject(app)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: workflow.symbol)
                                .frame(width: 24)
                            Text(workflow.title)
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 8)
                        .padding(.horizontal, 10)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!app.aiConsent.aiEnabled)
                }
            }

            AIActionResultView(result: safeActionResult, error: localError)
        }
        .padding(10)
        .glassCard(cornerRadius: 8)
    }

    private var workspaceChat: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Assistant")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button {
                    messages = [AIWorkspaceMessage(role: .assistant, text: "Ready.")]
                    chatInput = ""
                } label: {
                    Label("Clear", systemImage: "xmark.circle")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
            ForEach(Array(messages.suffix(3))) { message in
                HStack {
                    if message.role == .user { Spacer(minLength: 24) }
                    Text(ProductSafeText.sanitize(message.text, context: .ai))
                        .font(.caption)
                        .lineLimit(2)
                        .padding(8)
                        .background(message.role == .user ? Color.accentColor.opacity(0.16) : Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    if message.role == .assistant { Spacer(minLength: 24) }
                }
            }
            HStack {
                TextField("Ask me anything...", text: $chatInput, axis: .vertical)
                    .lineLimit(1...2)
                    .textFieldStyle(.plain)
                    .padding(8)
                    .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button {
                    sendChat()
                } label: {
                    if runningChat {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(runningChat || chatInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            quickActions
        }
        .padding(10)
        .glassCard(cornerRadius: 8)
    }

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick actions")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 7)], spacing: 7) {
                quickActionButton("Compose a new email", "square.and.pencil") {
                    messages.append(.init(role: .assistant, text: "Opening Compose."))
                    showCompose = true
                }
                quickActionButton("Search my email history", "magnifyingglass") {
                    messages.append(.init(role: .assistant, text: "Open Inbox and use the search field. Mail search is local to loaded and cached messages in this build."))
                }
                quickActionButton("Perform tasks for my mailbox", "checklist") {
                    messages.append(.init(role: .assistant, text: "Supported mailbox workflows: Inbox Summary, Suggested Reply, Thread Digest, Draft Generation, and Multi-email Analysis. These use loaded messages from your current mailbox view."))
                }
                quickActionButton("Show my availability", "calendar") {
                    messages.append(.init(role: .assistant, text: calendarAvailabilityMessage()))
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 7)], spacing: 7) {
                ForEach(AIWorkspaceRealWorkflow.allCases) { action in
                    Button {
                        runWorkspaceAction(action)
                    } label: {
                        Label(action.title, systemImage: action.symbol)
                            .font(.caption.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(runningWorkspaceAction != nil || !app.aiConsent.aiEnabled)
                }
            }
        }
    }

    private func quickActionButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    private func sendChat() {
        let prompt = chatInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !runningChat else { return }
        runningChat = true
        messages.append(.init(role: .user, text: prompt))
        chatInput = ""
        Task {
            if let result = await app.aiCompleteLocal(
                instructions: "Answer as NEXORA's mailbox assistant. Do not claim unsupported actions. Keep the answer concise.",
                prompt: prompt
            ) {
                messages.append(.init(role: .assistant, text: ProductSafeText.sanitize(result.text, context: .ai)))
            } else {
                messages.append(.init(role: .assistant, text: "I could not run AI for that request. Local quick actions are still available."))
            }
            runningChat = false
        }
    }

    private func runWorkspaceAction(_ action: AIWorkspaceRealWorkflow) {
        guard runningWorkspaceAction == nil else { return }
        runningWorkspaceAction = action
        messages.append(.init(role: .user, text: action.title))
        Task {
            let result = await app.aiWorkspaceWorkflow(action)
            await MainActor.run {
                runningWorkspaceAction = nil
                let response = """
                \(ProductSafeText.sanitize(result.text, context: .ai))

                Source: \(result.sourceAccount) · Messages: \(result.messageCount)
                \(result.runtimeBoundary)
                """
                messages.append(.init(role: .assistant, text: response))
            }
        }
    }

    private func calendarAvailabilityMessage() -> String {
        let status = EKEventStore.authorizationStatus(for: .event)
        if CalendarEventAuthorization.canReadEvents(status) {
            return "Calendar access is granted. Open the Calendar tab to view today's real events and availability."
        }
        if status == .notDetermined {
            return "Calendar permission has not been requested yet. Open the Calendar tab to grant access and show availability."
        }
        return "Calendar access is not available. Open the Calendar tab for the current permission state."
    }

    private var consentCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("AI Mail Summaries", isOn: Binding(
                get: { app.aiConsent.aiEnabled },
                set: { value in
                    var consent = app.aiConsent
                    consent.aiEnabled = value
                    consent.cloudAIEnabled = false
                    Task { await app.saveAIConsent(consent) }
                }
            ))
            LabeledContent("Status", value: app.aiConsent.aiEnabled ? "Active (Local)" : "Disabled")
                .font(.caption.weight(.semibold))
            Text("NEXORA AI uses Apple Intelligence locally for supported mail actions.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .glassCard(cornerRadius: 10)
    }

    private var appleCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "apple.logo")
                    .font(.title2)
                    .foregroundStyle(.primary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Apple Intelligence")
                        .font(.headline)
                    Text("Zero-setup local AI")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(app.aiConsent.aiEnabled ? "Active (Local)" : "Disabled")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(app.aiConsent.aiEnabled ? .green : .secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background((app.aiConsent.aiEnabled ? Color.green : Color.secondary).opacity(0.12), in: Capsule())
            }
            Text("Inbox Summary, Thread Digest, Suggested Reply, Draft Generation, Translation, Email Analysis, and AI Actions run through Apple Intelligence locally.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .glassCard(cornerRadius: 10)
    }

}

/// Shared compact-list behavior for content that grows over time. Callers pass
/// a relevance-ranked collection, so the first two are the current defaults,
/// never storage-order accidents. Exact metadata search intentionally remains
/// explicit until a verified semantic index is available.
struct ProgressiveDisclosureSection<Item: Identifiable, Row: View>: View {
    let title: String
    let itemName: String
    let items: [Item]
    let searchableText: (Item) -> String
    let row: (Item) -> Row

    init(
        _ title: String,
        itemName: String,
        items: [Item],
        searchableText: @escaping (Item) -> String,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.title = title
        self.itemName = itemName
        self.items = items
        self.searchableText = searchableText
        self.row = row
    }

    var body: some View {
        Section(title) {
            CollapsibleList(
                items: items,
                itemName: itemName,
                searchableText: searchableText
            ) { item in
                row(item)
            } empty: {
                ContentUnavailableView("No \(itemName) yet", systemImage: "tray", description: Text("NEXORA will show verified \(itemName) here when they exist."))
            }
        }
    }
}

struct MissionCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var showNewMission = false
    @State private var selectedMission: AgentMission?

    private var relevanceRankedMissions: [AgentMission] {
        app.missions.sorted { lhs, rhs in
            func rank(_ mission: AgentMission) -> Int {
                switch mission.progress {
                case .blocked: return 0
                case .active, .running: return 1
                case .waiting: return 2
                case .planning, .planned, .ready: return 3
                case .complete, .completed: return 4
                }
            }
            let lhsRank = rank(lhs), rhsRank = rank(rhs)
            return lhsRank == rhsRank ? lhs.updatedAt > rhs.updatedAt : lhsRank < rhsRank
        }
    }

    var body: some View {
        List {
            if app.isConversationProjectionAuthoritative {
                ProgressiveDisclosureSection(
                    "Communication Mission Control",
                    itemName: "mission conversations",
                    items: app.conversationProjections(for: .missionControl),
                    searchableText: { "\($0.title) \($0.preview) \($0.commitmentStates.joined(separator: " "))" }
                ) { projection in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(projection.title).font(.subheadline.weight(.semibold))
                        if !projection.preview.isEmpty {
                            Text(projection.preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Text(projection.commitmentStates.joined(separator: " "))
                            .font(.caption2.weight(.medium)).foregroundStyle(VisualSystemV3.ColorToken.accent)
                    }
                    .padding(.vertical, 3)
                    .accessibilityIdentifier("ucs-mission-conversation-\(projection.conversationId)")
                }
            }
            Section {
                HStack(spacing: VisualSystemV3.Spacing.medium) {
                    metric("Goals", max(app.missions.count, app.nexoraGoals.count), "target")
                    metric("Active", app.missions.filter { $0.progress == .active }.count, "arrow.triangle.branch")
                    metric("Outputs", app.deliverables.count, "shippingbox")
                }
                .padding(.vertical, 2)
            }
            ProgressiveDisclosureSection("Goals", itemName: "goals", items: relevanceRankedMissions, searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }) { mission in
                Button { selectedMission = mission } label: {
                    HStack(spacing: VisualSystemV3.Spacing.small) {
                        Image(systemName: mission.progress == .complete ? "checkmark.circle.fill" : "target")
                            .foregroundStyle(mission.progress == .complete ? VisualSystemV3.ColorToken.success : VisualSystemV3.ColorToken.accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(mission.title).font(.subheadline.weight(.semibold))
                            if !mission.goal.isEmpty { Text(mission.goal).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        Spacer()
                        Text(mission.progress.rawValue).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            ProgressiveDisclosureSection("Outcomes", itemName: "outcomes", items: app.nexoraOutcomes, searchableText: { "\($0.title) \($0.summary) \($0.nextActions.joined(separator: " "))" }) { outcome in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(outcome.title).font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(milestoneEvidence(for: outcome)).font(.caption.weight(.semibold)).foregroundStyle(VisualSystemV3.ColorToken.accent)
                    }
                    if !outcome.summary.isEmpty { Text(outcome.summary).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    if !outcome.nextActions.isEmpty { Text("Next: \(outcome.nextActions.joined(separator: " · "))").font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }.padding(.vertical, 3)
            }
            Section("Collaboration") {
                Label("\(app.nexoraCollaborations.count) bounded handoff\(app.nexoraCollaborations.count == 1 ? "" : "s")", systemImage: "arrow.triangle.branch")
                    .font(.caption)
                Text("Customer, meeting and document agents share context locally. Every output remains reviewable.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Organization foundation") {
                HStack {
                    Label("\(app.nexoraOrganizationGraph.nodes.count) graph nodes", systemImage: "circle.hexagongrid")
                    Spacer()
                    Button("Refresh") { app.refreshOrganizationGraph() }
                        .font(.caption.weight(.semibold))
                }
                Text("Organization, domain and identity relationships are prepared locally for NEXORA 3.0. No domain onboarding is performed.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if !app.deliverables.isEmpty {
                ProgressiveDisclosureSection("Recent outputs", itemName: "outputs", items: app.deliverables, searchableText: { "\($0.title) \($0.kind.rawValue) \($0.content)" }) { deliverable in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(deliverable.kind.rawValue, systemImage: deliverable.kind.symbol).font(VisualSystemV3.Typography.caption.weight(.semibold)).foregroundStyle(VisualSystemV3.ColorToken.accent)
                        Text(deliverable.title).font(.subheadline.weight(.semibold))
                        Text(deliverable.content).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }.padding(.vertical, 3)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .navigationTitle("Goal Center")
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { showNewMission = true } label: { Image(systemName: "plus") }.accessibilityLabel("Create goal") } }
        .sheet(isPresented: $showNewMission) { NewMissionView().environmentObject(app) }
        .sheet(item: $selectedMission) { MissionDetailView(mission: $0).environmentObject(app) }
    }

    private func milestoneEvidence(for outcome: NexoraOutcomeRecord) -> String {
        guard let plan = app.executionPlans.first(where: { $0.missionID == outcome.missionID }) else {
            return "Plan pending"
        }
        return "\(plan.completedStepIDs.count) of \(plan.steps.count) milestones"
    }

    private func metric(_ title: String, _ value: Int, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: icon).foregroundStyle(VisualSystemV3.ColorToken.accent)
            Text("\(value)").font(.title3.weight(.bold))
            Text(title).font(VisualSystemV3.Typography.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(VisualSystemV3.Spacing.small)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: VisualSystemV3.Radius.compact, style: .continuous))
    }
}

private struct NewMissionView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var goal = ""
    var body: some View {
        NavigationStack {
            Form { TextField("Goal", text: $title); TextField("Desired outcome", text: $goal, axis: .vertical).lineLimit(2...4) }
                .navigationTitle("New Goal")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Create") { app.createMission(title: title, goal: goal); dismiss() }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
        }
    }
}

struct MissionDetailView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let mission: AgentMission
    @State private var createdOutputKind: DeliverableKind?
    var plan: ExecutionPlan? { app.executionPlans.first { $0.missionID == mission.id } }
    var body: some View {
        NavigationStack {
            List {
                Section("Goal") { Text(mission.goal.isEmpty ? "No outcome added." : mission.goal) }
                if let plan {
                    Section("Plan") {
                        CollapsibleList(
                            items: planStepItems(for: plan),
                            itemName: "goal actions",
                            searchableText: { $0.title }
                        ) { step in
                            Button { app.togglePlanStep(planID: plan.id, step: step.index) } label: {
                                Label(step.title, systemImage: plan.completedStepIDs.contains(step.index) ? "checkmark.circle.fill" : "circle")
                            }
                            .foregroundStyle(plan.completedStepIDs.contains(step.index) ? VisualSystemV3.ColorToken.success : .primary)
                        } empty: {
                            Text("No plan actions yet.").foregroundStyle(.secondary)
                        }
                    }
                }
                ProgressiveDisclosureSection("Agent workflows", itemName: "workflows", items: NexoraAgentType.allCases, searchableText: { $0.rawValue }) { agent in
                        let proposal = app.agentProposal(for: mission, agent: agent)
                        DisclosureGroup {
                            Text(proposal.explanation)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ForEach(proposal.steps, id: \.self) { step in
                                Label(step, systemImage: "circle")
                                    .font(.caption)
                            }
                            Text("Expected: \(proposal.expectedOutputs.map(\.rawValue).joined(separator: ", ")) · \(proposal.estimatedWork)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Button {
                                app.runAgent(for: mission, agent: agent)
                            } label: {
                                Label("Review and execute", systemImage: "play.fill")
                            }
                            .buttonStyle(.borderedProminent)
                        } label: {
                            Label(agent.rawValue, systemImage: "sparkles.rectangle.stack")
                        }
                }
                Section("Collaboration") {
                    Button {
                        app.runCollaborativeWorkflow(for: mission)
                    } label: {
                        Label("Run bounded collaboration", systemImage: "arrow.triangle.branch")
                    }
                    .buttonStyle(.borderedProminent)
                }
                Section("Create output") {
                    if let createdOutputKind {
                        Label("Created output: \(createdOutputKind.rawValue)", systemImage: "checkmark.circle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VisualSystemV3.ColorToken.success)
                            .accessibilityIdentifier("Created output")
                    }
                    ForEach(DeliverableKind.allCases) { kind in
                        Button {
                            app.createDeliverable(for: mission, kind: kind)
                            createdOutputKind = kind
                        } label: { Label(kind.rawValue, systemImage: kind.symbol) }
                    }
                }
            }
            .navigationTitle(mission.title)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func planStepItems(for plan: ExecutionPlan) -> [MissionPlanStepItem] {
        plan.steps.enumerated().map { MissionPlanStepItem(id: "\(plan.id):\($0.offset)", index: $0.offset, title: $0.element) }
    }
}

private struct MissionPlanStepItem: Identifiable {
    let id: String
    let index: Int
    let title: String
}

private struct AIWorkspaceMessage: Identifiable, Hashable {
    enum Role { case assistant, user }
    let id = UUID()
    let role: Role
    let text: String
}

struct AIActionResultView: View {
    let result: AIWorkspaceActionResult?
    var workflowResult: AIWorkspaceWorkflowResult? = nil
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let workflowResult {
                LabeledContent("AI route", value: "Apple Intelligence")
                LabeledContent("Action", value: workflowResult.workflow.title)
                LabeledContent("Messages", value: "\(workflowResult.messageCount)")
                Text(ProductSafeText.sanitize(workflowResult.text, context: .ai))
                    .font(.callout)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text(workflowResult.runtimeBoundary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else if let result {
                LabeledContent("AI route", value: "Apple Intelligence")
                LabeledContent("Status", value: result.status)
                LabeledContent("Mailbox data", value: result.mailboxDataSent == true ? "Sent" : "Not sent")
                if let preview = result.sanitizedOutputPreview, !preview.isEmpty {
                    Text(ProductSafeText.sanitize(preview, context: .ai))
                        .font(.callout)
                        .padding(10)
                        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            } else if let error, !error.isEmpty {
                Text(ProductSafeText.sanitize(error, context: .ai))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("No mailbox data is sent by default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct SafeMailActionLiveView: View {
    @EnvironmentObject private var app: AppState
    let workflow: AIWorkspaceRealWorkflow

    @State private var isRunning = true
    @State private var result: AIWorkspaceWorkflowResult?
    @State private var errorMessage: String?
    @State private var runID = UUID()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Label(workflow.title, systemImage: workflow.symbol)
                    .font(.headline)
                LabeledContent("AI route", value: "Apple Intelligence")
                    .font(.caption.weight(.semibold))

                if isRunning {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Running locally with Apple Intelligence...")
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                } else if let result, !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    AIActionResultView(result: nil, workflowResult: result, error: nil)
                } else {
                    Label(errorMessage ?? "This mail action did not finish.", systemImage: "exclamationmark.triangle.fill")
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
        .navigationTitle(workflow.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: runID) {
            await run()
        }
    }

    private func run() async {
        await MainActor.run {
            isRunning = true
            result = nil
            errorMessage = nil
        }
        guard app.aiConsent.aiEnabled else {
            await MainActor.run {
                isRunning = false
                errorMessage = "Enable AI Mail Summaries first."
            }
            return
        }

        let workflowResult = await app.aiWorkspaceWorkflow(workflow)
        await MainActor.run {
            isRunning = false
            result = workflowResult
            errorMessage = workflowResult.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Apple Intelligence local action returned no result."
                : nil
        }
    }
}
