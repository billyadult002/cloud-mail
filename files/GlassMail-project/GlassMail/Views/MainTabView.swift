//
//  MainTabView.swift
//  GlassMail
//

import EventKit
import SwiftUI

enum CalendarEventAuthorization {
    private static let legacyAuthorizedRawValue = 3

    static func canReadEvents(_ status: EKAuthorizationStatus) -> Bool {
        if #available(iOS 17.0, macOS 14.0, *) {
            return status == .fullAccess
        }
        return status.rawValue == legacyAuthorizedRawValue
    }

    static func isWriteOnly(_ status: EKAuthorizationStatus) -> Bool {
        if #available(iOS 17.0, macOS 14.0, *) {
            return status == .writeOnly
        }
        return false
    }
}

struct MainTabView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.colorScheme) private var systemColorScheme

    private var preferredColorScheme: ColorScheme? {
        switch app.profileTheme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    private var activeColorScheme: ColorScheme {
        preferredColorScheme ?? systemColorScheme
    }

    var body: some View {
        tabContainer
            .preferredColorScheme(preferredColorScheme)
            .tint(VisualSystemV3.ColorToken.accent)
            .environment(\.defaultMinListRowHeight, 44)
            .environment(\.defaultMinListHeaderHeight, 26)
            .onAppear {
                applyInitialTabLaunchArgument()
            }
            .sheet(isPresented: $app.showCommandPalette) {
                CommandPaletteView()
                    .environmentObject(app)
            }
            .fullScreenCover(isPresented: $app.showGlobalCompose) {
                ComposeView(isPresentedAsSheet: true, initialBody: app.globalComposeInitialBody ?? "")
                    .environmentObject(app)
                    .onDisappear { app.clearGlobalComposePrefill() }
            }
            .onChange(of: app.selectedMainTab) { _, _ in
                app.mainTabBarHidden = false
            }
            .keyboardShortcut("k", modifiers: .command)
    }

    @ViewBuilder
    private var tabContainer: some View {
        #if os(iOS)
        ZStack(alignment: .top) {
            AmbientBackground()
            // Use the platform tab container for the primary workspace
            // navigation. The former safe-area HStack looked like a tab bar,
            // but did not inherit UIKit's tab hit-testing or accessibility
            // semantics on a physical iPhone.
            TabView(selection: $app.selectedMainTab) {
                InboxView()
                    .tabItem { Label("Email", systemImage: "tray.fill") }
                    .tag(0)

                AIView()
                    .tabItem {
                        Label("Intel", systemImage: "sparkles")
                            .accessibilityLabel("Intelligence")
                    }
                    .tag(1)

                WorkCenterView()
                    .tabItem { Label("Goals", systemImage: "target") }
                    .tag(2)

                SecurityCenterView()
                    .tabItem { Label("Trust", systemImage: "checkmark.shield.fill") }
                    .tag(4)

                OrganizationCenterView()
                    .tabItem {
                        Label("Org", systemImage: "building.2.fill")
                            .accessibilityLabel("Organization")
                    }
                    .tag(5)
            }
            .toolbar(app.mainTabBarHidden ? .hidden : .visible, for: .tabBar)
            if let undo = app.mailUndoState {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(VisualSystemV3.ColorToken.success)
                    Text(undo.message)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Button("Undo") { Task { await app.undoLastMailAction() } }
                        .font(.caption.weight(.bold))
                        .accessibilityIdentifier("mail-action-undo")
                        .disabled(app.mailUndoInProgress)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .padding(.horizontal)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(10)
            }
        }
        .animation(VisualSystemV3.Motion.feedback, value: app.mailUndoState?.id)
        .animation(VisualSystemV3.Motion.feedback, value: app.mainTabBarHidden)
        #else
        TabView(selection: $app.selectedMainTab) {
            InboxView()
                .tabItem {
                    Label("Email", systemImage: "tray.fill")
                }
                .tag(0)

            AIView()
                .tabItem {
                    Label("Intelligence", systemImage: "sparkles")
                }
                .tag(1)

            WorkCenterView()
                .tabItem {
                    Label("Goals", systemImage: "target")
                }
                .tag(2)

            #if !os(iOS)
            CalendarView()
                .tabItem {
                    Label("Calendar", systemImage: "calendar")
                }
                .tag(3)
            #endif

            SecurityCenterView()
                .tabItem {
                    Label("Trust", systemImage: "checkmark.shield.fill")
                }
                .tag(4)

            OrganizationCenterView()
                .tabItem {
                    Label("Organization", systemImage: "building.2.fill")
                }
                .tag(5)
        }
        #endif
    }

    private func applyInitialTabLaunchArgument() {
        let arguments = ProcessInfo.processInfo.arguments
        if let destinationIndex = arguments.firstIndex(of: "-CloudMailSettingsDestination"),
           arguments.indices.contains(destinationIndex + 1) {
            app.settingsLaunchDestination = arguments[destinationIndex + 1].lowercased()
            app.selectedMainTab = 5
        }
        guard let index = arguments.firstIndex(of: "-CloudMailInitialTab"),
              arguments.indices.contains(index + 1) else { return }
        switch arguments[index + 1].lowercased() {
        case "ai", "ai-center", "workspace":
            app.selectedMainTab = 1
        case "compose":
            app.showGlobalCompose = true
        case "work", "calendar":
            app.selectedMainTab = 2
        case "trust", "security":
            app.selectedMainTab = 4
        case "accounts":
            app.selectedMainTab = 5
        case "settings":
            app.selectedMainTab = 5
        default:
            app.selectedMainTab = 0
        }
    }
}

private enum GoalOSSection: String, CaseIterable, Identifiable {
    case goals = "Goals"
    case today = "Today"
    case execute = "Execute"
    case spaces = "Spaces"
    case people = "People"
    case briefing = "Briefing"

    var id: String { rawValue }
}

private enum NexoraBriefingScope: String, Identifiable {
    case changed
    case matters
    case waiting
    case completed
    case next

    var id: String { rawValue }
}

struct WorkCenterView: View {
    private struct TemplateChoice: Identifiable {
        let id: String
        let title: String
    }
    @EnvironmentObject private var app: AppState
    @State private var showCalendar = false
    @State private var showMissionCenter = false
    @State private var selectedDeliverable: Deliverable?
    @State private var goalPrompt = ""
    @State private var selectedSection: GoalOSSection = .goals

    private var activeGoals: [AgentMission] {
        app.missions.filter { ![.completed, .complete].contains($0.progress) }
    }

    private var blockedGoals: [AgentMission] {
        app.missions.filter { $0.progress == .blocked }
    }

    private var waitingGoals: [AgentMission] {
        app.missions.filter { $0.progress == .waiting }
    }

    private var completedGoals: [AgentMission] {
        app.missions.filter { [.completed, .complete].contains($0.progress) }
    }

    private func relevanceRankedNodes(_ nodes: [NexoraGraphNode]) -> [NexoraGraphNode] {
        nodes.sorted { lhs, rhs in
            func score(_ node: NexoraGraphNode) -> Int {
                let metadata = node.metadata.values.joined(separator: " ").lowercased()
                let kindScore: Int
                switch node.kind {
                case .customer: kindScore = 60
                case .vendor: kindScore = 45
                case .identity: kindScore = 40
                case .organization: kindScore = 35
                case .domain: kindScore = 30
                case .trust: kindScore = 20
                }
                let urgency = metadata.contains("blocked") ? 100 : (metadata.contains("risk") || metadata.contains("waiting") ? 70 : 0)
                let activity = metadata.contains("active") || metadata.contains("open") ? 20 : 0
                return kindScore + urgency + activity
            }
            let lhsScore = score(lhs), rhsScore = score(rhs)
            return lhsScore == rhsScore ? lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending : lhsScore > rhsScore
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(GoalOSSection.allCases) { section in
                                goalOSSectionButton(section)
                            }
                        }
                    }
                    .accessibilityIdentifier("Goal OS navigation")
                }

                if selectedSection == .goals {
                    Section {
                    Text("What do you want NEXORA to accomplish?")
                        .font(.headline)
                    TextField("Describe the outcome", text: $goalPrompt, axis: .vertical)
                        .lineLimit(2...5)
                        .accessibilityIdentifier("goal-home-input")
                    Button {
                        createGoalFromPrompt()
                    } label: {
                        Label("Create Goal", systemImage: "arrow.up.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(goalPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("goal-home-create")
                    }

                    ProgressiveDisclosureSection(
                        "Active Goals",
                        itemName: "active goals",
                        items: activeGoals,
                        searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }
                    ) { mission in
                        NavigationLink {
                            MissionDetailView(mission: mission)
                                .environmentObject(app)
                        } label: {
                            goalRow(mission)
                        }
                        .accessibilityLabel("Open goal \(mission.title)")
                    }

                    if !blockedGoals.isEmpty {
                        Section("Blocked") {
                            CollapsibleList(
                                items: blockedGoals,
                                itemName: "blocked goals",
                                searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }
                            ) { mission in
                                NavigationLink {
                                    MissionDetailView(mission: mission)
                                        .environmentObject(app)
                                } label: { goalRow(mission) }
                                .accessibilityLabel("Open blocked goal \(mission.title)")
                            } empty: { EmptyView() }
                        }
                    }

                    if !waitingGoals.isEmpty {
                        Section("Waiting") {
                            CollapsibleList(
                                items: waitingGoals,
                                itemName: "waiting goals",
                                searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }
                            ) { mission in
                                NavigationLink {
                                    MissionDetailView(mission: mission)
                                        .environmentObject(app)
                                } label: { goalRow(mission) }
                                .accessibilityLabel("Open waiting goal \(mission.title)")
                            } empty: { EmptyView() }
                        }
                    }
                    if !completedGoals.isEmpty {
                        Section("Recently Completed") {
                            CollapsibleList(
                                items: completedGoals,
                                itemName: "completed goals",
                                searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }
                            ) { mission in
                                NavigationLink {
                                    MissionDetailView(mission: mission)
                                        .environmentObject(app)
                                } label: { goalRow(mission) }
                                .accessibilityLabel("Open completed goal \(mission.title)")
                            } empty: { EmptyView() }
                        }
                    }
                } else if selectedSection == .today {
                    Section("What matters now") {
                    workQueue("Needs Reply", app.mailOSBriefingSnapshot.needReply, "needsReply", "arrowshape.turn.up.left.fill")
                    workQueue("Waiting", app.mailOSBriefingSnapshot.waiting, "waiting", "clock.fill")
                    workQueue("Follow Up", app.mailOSBriefingSnapshot.followUp, "followUp", "arrowshape.turn.up.right.fill")
                    workQueue("Urgent", app.mailOSBriefingSnapshot.urgent, "urgent", "exclamationmark.shield.fill")
                    }
                    Section("Why now") {
                        Text("Items appear here only when NEXORA detects a required action, waiting dependency, follow-up signal, or non-promotional risk.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else if selectedSection == .execute {
                    Section("Queues") {
                    Button { showMissionCenter = true } label: { ownerRow("Goal Center", "\(app.missions.count) goals · \(app.deliverables.count) verified outputs", "target") }
                    Button { showCalendar = true } label: { ownerRow("Calendar Center", "Today, agenda and upcoming events", "calendar") }
                    Button { openMailbox("scheduled") } label: { ownerRow("Scheduling", "\(app.scheduledMessages.count) scheduled messages", "clock.badge.checkmark") }
                    }
                    ProgressiveDisclosureSection("Prepare", itemName: "templates", items: app.quickReplyTemplateStore.templates.map { TemplateChoice(id: $0, title: $0) }, searchableText: { $0.title }) { template in
                        Button { app.presentGlobalCompose(initialBody: template.title) } label: { ownerRow(template.title, "Open a message with this template inserted", "text.badge.checkmark") }
                    }
                    ProgressiveDisclosureSection("Completion Evidence", itemName: "evidence", items: app.deliverables.sorted { $0.createdAt > $1.createdAt }, searchableText: { "\($0.title) \($0.kind.rawValue) \($0.content)" }) { deliverable in
                        Button { selectedDeliverable = deliverable } label: { ownerRow(deliverable.title, deliverable.kind.rawValue, deliverable.kind.symbol) }
                    }
                } else if selectedSection == .spaces {
                    ProgressiveDisclosureSection("Context Spaces", itemName: "spaces", items: relevanceRankedNodes(app.nexoraOrganizationGraph.nodes), searchableText: { "\($0.label) \($0.kind.rawValue) \($0.metadata.values.joined(separator: " "))" }) { node in
                        NavigationLink {
                            NexoraOrganizationNodeDetailView(node: node)
                                .environmentObject(app)
                        } label: {
                            ownerRow(node.label, node.kind.rawValue.capitalized, "square.grid.2x2")
                        }
                        .accessibilityLabel("Open context space \(node.label)")
                    }
                    Section { Button("Refresh Context Graph") { app.refreshOrganizationGraph() } }
                } else if selectedSection == .people {
                    ProgressiveDisclosureSection("Goal-Relevant People", itemName: "people", items: relevanceRankedNodes(app.nexoraOrganizationGraph.nodes.filter { [.identity, .customer, .vendor].contains($0.kind) }), searchableText: { "\($0.label) \($0.kind.rawValue) \($0.metadata.values.joined(separator: " "))" }) { node in
                        NavigationLink {
                            NexoraOrganizationNodeDetailView(node: node)
                                .environmentObject(app)
                        } label: {
                            ownerRow(node.label, node.kind.rawValue.capitalized, "person.crop.circle")
                        }
                        .accessibilityLabel("Open person \(node.label)")
                    }
                } else {
                    Section("Chief of Staff Briefing") {
                        briefingLink(.changed, "What changed", "\(app.isConversationProjectionAuthoritative ? app.conversationProjections(for: .allMail).filter { $0.unreadCount > 0 }.count : app.emails.filter(\.isUnread).count) unread communications", "arrow.triangle.2.circlepath")
                        briefingLink(.matters, "What matters", "\(app.isConversationProjectionAuthoritative ? app.conversationProjections(for: .actionRequired).count : app.mailOSBriefingSnapshot.needReply) need reply · \(app.mailOSBriefingSnapshot.urgent) non-bulk risk signals", "scope")
                        briefingLink(.waiting, "What is waiting", "\(app.isConversationProjectionAuthoritative ? app.conversationProjections(for: .waitingForOthers).count : app.mailOSBriefingSnapshot.waiting) waiting · \(waitingGoals.count) waiting goals", "clock")
                        briefingLink(.completed, "What NEXORA completed", "\(completedGoals.count) goals · \(app.deliverables.count) evidence outputs", "checkmark.seal")
                        briefingLink(.next, "What happens next", activeGoals.first?.goal ?? "Create a goal to generate a governed next action.", "arrow.right.circle")
                    }
                    Section("Evidence") {
                        Button { openMailbox("all") } label: { ownerRow("Open All Communications", "Inspect the underlying communication record", "tray.full") }
                        Button { showMissionCenter = true } label: { ownerRow("Open Goal Evidence", "Inspect milestones, plans and outputs", "doc.text.magnifyingglass") }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("Goals")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { app.showGlobalCompose = true } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("Compose")
                }
            }
            .sheet(isPresented: $showCalendar) { CalendarView() }
            .sheet(isPresented: $showMissionCenter) { NavigationStack { MissionCenterView().environmentObject(app) } }
            .sheet(item: $selectedDeliverable) { deliverable in
                NavigationStack {
                    ScrollView { Text(deliverable.content).frame(maxWidth: .infinity, alignment: .leading).padding() }
                        .navigationTitle(deliverable.title)
                        .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
    }

    @ViewBuilder
    private func goalOSSectionButton(_ section: GoalOSSection) -> some View {
        let button = Button(section.rawValue) { selectedSection = section }
            .controlSize(.small)
            .accessibilityIdentifier("goal-os-\(section.rawValue.lowercased())")
        if selectedSection == section {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private func briefingRow(_ title: String, _ detail: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func briefingLink(_ scope: NexoraBriefingScope, _ title: String, _ detail: String, _ symbol: String) -> some View {
        NavigationLink {
            NexoraBriefingDetailView(scope: scope, title: title, summary: detail, symbol: symbol)
                .environmentObject(app)
        } label: {
            briefingRow(title, detail, symbol)
        }
        .accessibilityLabel("Open briefing: \(title)")
    }

    private func createGoalFromPrompt() {
        let outcome = goalPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !outcome.isEmpty else { return }
        let title = outcome.split(separator: " ").prefix(8).joined(separator: " ")
        app.createMission(title: title, goal: outcome)
        goalPrompt = ""
        showMissionCenter = true
    }

    private func goalRow(_ mission: AgentMission) -> some View {
        HStack(spacing: 10) {
            Image(systemName: mission.progress == .blocked ? "exclamationmark.octagon.fill" : mission.progress == .waiting ? "clock.fill" : [.completed, .complete].contains(mission.progress) ? "checkmark.circle.fill" : "target")
                .foregroundStyle(mission.progress == .blocked ? Color.red : mission.progress == .waiting ? Color.orange : [.completed, .complete].contains(mission.progress) ? VisualSystemV3.ColorToken.success : VisualSystemV3.ColorToken.accent)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(mission.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(mission.goal).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                Text(mission.progress.rawValue).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func workQueue(_ title: String, _ count: Int, _ filter: String, _ symbol: String) -> some View {
        Button { openMailbox(filter) } label: {
            HStack { Label(title, systemImage: symbol); Spacer(); Text("\(count)").monospacedDigit(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func openMailbox(_ filter: String) {
        app.selectedInboxFilterRaw = filter
        app.selectedMainTab = 0
    }

    private func ownerRow(_ title: String, _ detail: String, _ symbol: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(VisualSystemV3.ColorToken.accent).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) { Text(title).font(.subheadline.weight(.semibold)); Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 2)
    }
}

private struct NexoraBriefingDetailView: View {
    @EnvironmentObject private var app: AppState
    let scope: NexoraBriefingScope
    let title: String
    let summary: String
    let symbol: String

    private var relatedEmails: [EmailMessage] {
        guard !app.isConversationProjectionAuthoritative else { return [] }
        let base: [EmailMessage]
        switch scope {
        case .changed, .matters:
            base = app.emails.filter(\.isUnread)
        case .waiting:
            base = app.emails.filter { $0.isUnread && app.effectiveFolder(for: $0) != .junk }
        case .completed, .next:
            base = []
        }
        return base.sorted { ($0.createTime ?? "") > ($1.createTime ?? "") }
    }

    private var relatedProjections: [ConversationProjection] {
        guard app.isConversationProjectionAuthoritative else { return [] }
        switch scope {
        case .changed: return app.conversationProjections(for: .allMail).filter { $0.unreadCount > 0 }
        case .matters: return app.conversationProjections(for: .actionRequired)
        case .waiting: return app.conversationProjections(for: .waitingForOthers)
        case .completed, .next: return []
        }
    }

    private var relatedGoals: [AgentMission] {
        switch scope {
        case .waiting:
            return app.missions.filter { $0.progress == .waiting }
        case .completed:
            return app.missions.filter { [.completed, .complete].contains($0.progress) }
        case .next:
            return app.missions.filter { ![.completed, .complete].contains($0.progress) }
        case .changed, .matters:
            return []
        }
    }

    var body: some View {
        List {
            Section("Identity") {
                Label(title, systemImage: symbol)
                    .font(.headline)
                LabeledContent("Briefing ID", value: scope.id)
                LabeledContent("Generated", value: Date.now.formatted(date: .abbreviated, time: .shortened))
            }
            Section("Current state") {
                Text(summary)
            }
            Section("Why it matters") {
                Text("This is a local NEXORA briefing derived from the currently loaded workspace state. It does not claim provider-side completeness beyond the available evidence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !relatedGoals.isEmpty {
                Section("Related goals") {
                    CollapsibleList(
                        items: relatedGoals,
                        itemName: "goals",
                        searchableText: { "\($0.title) \($0.goal) \($0.progress.rawValue)" }
                    ) { mission in
                        NavigationLink {
                            MissionDetailView(mission: mission)
                                .environmentObject(app)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(mission.title).font(.subheadline.weight(.semibold))
                                Text(mission.progress.rawValue).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityLabel("Open related goal \(mission.title)")
                    } empty: {
                        EmptyView()
                    }
                }
            }
            Section("Source evidence") {
                if app.isConversationProjectionAuthoritative, !relatedProjections.isEmpty {
                    CollapsibleList(items: relatedProjections, itemName: "conversations", searchableText: { "\($0.title) \($0.preview)" }) { projection in
                        NavigationLink { ConversationProjectionDetailView(projection: projection).environmentObject(app) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(projection.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(projection.preview).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    } empty: { EmptyView() }
                } else if relatedEmails.isEmpty {
                    Text("No loaded communication is directly attached to this briefing state.")
                        .foregroundStyle(.secondary)
                } else {
                    CollapsibleList(
                        items: relatedEmails,
                        itemName: "communications",
                        searchableText: { "\($0.fromName) \($0.fromAddress) \($0.displaySubject)" }
                    ) { email in
                        NavigationLink {
                            EmailDetailView(email: email)
                                .environmentObject(app)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(email.displaySubject).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(email.fromName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .accessibilityLabel("Open source email \(email.displaySubject)")
                    } empty: {
                        EmptyView()
                    }
                }
            }
        }
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct OrganizationCenterView: View {
    @EnvironmentObject private var app: AppState
    @State private var showAccounts = false
    @State private var showSettings = false
    @State private var showNexoraV3 = false

    var body: some View {
        NavigationStack {
            List {
                Section("Organization") {
                    Button { showNexoraV3 = true } label: { row("NEXORA V3", "Authority, domains, identity, privacy and calendar", "command") }
                        .accessibilityIdentifier("NEXORA V3")
                    Button { showAccounts = true } label: { row("Accounts", "\(app.addresses.count) connected identities", "person.2.fill") }
                    NavigationLink {
                        NexoraOrganizationGraphDetailView()
                            .environmentObject(app)
                    } label: {
                        row("Organization Graph", "\(app.nexoraOrganizationGraph.nodes.count) observed local nodes", "circle.hexagongrid")
                    }
                    row("Domains Foundation", "Architecture ready; no onboarding claim", "globe", actionable: false)
                    row("Teams Foundation", "Shared inbox and queue architecture", "person.3.fill", actionable: false)
                    row("Services Hub", "Calendar, contacts and future integrations", "square.grid.2x2", actionable: false)
                }
                Section("Governance") {
                    Button { showSettings = true } label: { row("Settings", "Privacy, preferences and diagnostics", "gearshape.fill") }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("Organization")
            .sheet(isPresented: $showAccounts) { AccountsView().environmentObject(app) }
            .sheet(isPresented: $showSettings) { SettingsView().environmentObject(app) }
            .sheet(isPresented: $showNexoraV3) { NexoraV3CommandCenterView().environmentObject(app) }
        }
    }

    private func row(_ title: String, _ detail: String, _ symbol: String, actionable: Bool = true) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(VisualSystemV3.ColorToken.accent).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) { Text(title).font(.subheadline.weight(.semibold)); Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            Spacer()
            if actionable { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 2)
    }
}

struct NexoraV3CommandCenterView: View {
    private struct HealthStatusRow: Identifiable {
        let title: String
        let state: String
        let symbol: String
        var id: String { title }
    }
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var showCalendar = false

    var body: some View {
        NavigationStack {
            List {
                onboardingSection
                authoritySection
                healthSection
                centersSection
                providerSection
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("NEXORA V3")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await app.refreshNexoraV3(provider: app.nexoraV3Status.onboarding?.provider ?? "custom_domain") } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(app.nexoraV3Status.isLoading)
                        .accessibilityLabel("Refresh NEXORA status")
                }
            }
            .sheet(isPresented: $showCalendar) { CalendarView() }
            .task {
                if email.isEmpty { email = app.currentUser?.email ?? "" }
                if app.nexoraV3Status.providers.isEmpty { await app.refreshNexoraV3() }
            }
        }
    }

    private var onboardingSection: some View {
        Section {
            #if os(iOS)
            TextField("name@company.com or company.com", text: $email)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .accessibilityLabel("Email or domain to add")
            #else
            TextField("name@company.com or company.com", text: $email)
                .textContentType(.emailAddress)
                .accessibilityLabel("Email or domain to add")
            #endif
            Button {
                Task { await app.beginNexoraV3Onboarding(emailOrDomain: email) }
            } label: {
                Label(app.nexoraV3Status.isLoading ? "Discovering and preparing…" : "Add to NEXORA", systemImage: "plus.circle.fill")
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .disabled(app.nexoraV3Status.isLoading || !email.contains("."))
            if let onboarding = app.nexoraV3Status.onboarding {
                if let activation = onboarding.activation {
                    statusLine(activation.label, detail: activation.reason)
                    ProgressView(value: Double(activation.progress), total: 100) {
                        Text("Setup progress")
                    } currentValueLabel: {
                        Text("\(activation.progress)%")
                    }
                    Text(activation.recommendedAction)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Next: \(activation.primaryCta)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(VisualSystemV3.ColorToken.accent)
                        .accessibilityLabel("Recommended next action: \(activation.primaryCta)")
                } else {
                    statusLine("Discovering mailbox", detail: "NEXORA is preparing a provider-neutral mailbox connection.")
                }
            }
            if let error = app.nexoraV3Status.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.caption)
            }
        } header: { Text("Add Email · Authorize Once · Leave") }
          footer: { Text("NEXORA requests the maximum safe provider-supported authority for this experience. Provider consent and revocation rules always apply.") }
    }

    private var authoritySection: some View {
        Section("Authority Center") {
            statusLine(app.nexoraV3Status.authority.authorityState, detail: authorityDetail)
            LabeledContent("Silent escalation", value: app.nexoraV3Status.authority.silentEscalationAllowed ? "Allowed" : "Never")
            if !app.nexoraV3Status.authority.missingScopes.isEmpty {
                DisclosureGroup("Missing provider permissions (\(app.nexoraV3Status.authority.missingScopes.count))") {
                    ForEach(app.nexoraV3Status.authority.missingScopes, id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
                }
            }
        }
    }

    private var healthSection: some View {
        ProgressiveDisclosureSection("Health", itemName: "health checks", items: healthRows, searchableText: { "\($0.title) \($0.state)" }) { row in
            healthRow(row.title, state: row.state, symbol: row.symbol)
        }
    }

    private var healthRows: [HealthStatusRow] {
        [
            HealthStatusRow(title: "Domain", state: state(for: "domain_discovery"), symbol: "globe"),
            HealthStatusRow(title: "Trust & Security", state: "Needs validation", symbol: "checkmark.shield"),
            HealthStatusRow(title: "Identity", state: app.addresses.isEmpty ? "Needs attention" : "Observed", symbol: "person.text.rectangle"),
            HealthStatusRow(title: "Mail", state: app.phase == .ready ? "Observed" : "Blocked", symbol: "envelope"),
            HealthStatusRow(title: "Calendar", state: "Permission dependent", symbol: "calendar"),
            HealthStatusRow(title: "Provisioning & Repair", state: app.nexoraV3Status.onboarding?.lifecycleState ?? "Not started", symbol: "wrench.and.screwdriver")
        ]
    }

    private var centersSection: some View {
        Section("Operating System Centers") {
            NavigationLink { NexoraV3CenterDetail(title: "Identity Workspaces", rows: ["CEO Workspace", "Personal Workspace", "Sales Workspace", "Legal Workspace", "Investor Workspace"], footer: "Inbox, rules, signatures, AI context, memory, calendar, aliases and preferences remain isolated.") } label: { centerRow("Identity Workspace", "person.crop.rectangle.stack") }
            NavigationLink { NexoraV3CenterDetail(title: "Privacy & Aliases", rows: ["Remote images blocked by default", "Tracking pixels and URLs inspected", "Alias lifecycle: create, rotate, disable, archive, audit", "Malware scanning is not claimed without evidence"], footer: "Per-sender remote-image exceptions remain under your control.") } label: { centerRow("Privacy & Alias Center", "hand.raised") }
            Button { showCalendar = true } label: { centerRow("Calendar & Meeting Center", "calendar.badge.clock") }
            NavigationLink { NexoraV3CenterDetail(title: "Organization Graph", rows: ["People", "Teams", "Departments", "Shared mailboxes", "Functional mailboxes", "Groups"], footer: "Only provider-observed, tenant-scoped relationships are materialized.") } label: { centerRow("Organization Center", "circle.hexagongrid") }
            NavigationLink { NexoraV3CenterDetail(title: "Provisioning & Repair", rows: ["Mailbox", "Alias", "Identity", "Routing", "Trust", "Security", "Calendar", "Workflows"], footer: "Repair order: automatic, alternative, fallback, then owner notification. Destructive ambiguity stops automation.") } label: { centerRow("Provisioning & Repair", "wrench.and.screwdriver") }
            NavigationLink { NexoraV3CenterDetail(title: "Executive Agenda", rows: ["Today", "Meetings", "Waiting", "Urgent", "Follow-Ups", "Deadlines", "Commitments"], footer: "Mail-derived items remain suggestions until a provider write is authorized and confirmed.") } label: { centerRow("Executive Agenda", "list.bullet.rectangle") }
        }
    }

    @ViewBuilder private var providerSection: some View {
        if app.nexoraV3Status.providers.isEmpty {
            Section("Provider Capability Matrix") { Text("No provider evidence loaded").foregroundStyle(.secondary) }
        } else {
            ProgressiveDisclosureSection("Provider Capability Matrix", itemName: "providers", items: app.nexoraV3Status.providers, searchableText: { "\($0.title) \($0.provider) \($0.implementationState) \($0.capabilities.joined(separator: " "))" }) { row in
                NavigationLink { NexoraV3CenterDetail(title: row.title, rows: row.capabilities, footer: ([row.implementationState] + row.limitations).joined(separator: " · ")) } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.title).font(.subheadline.weight(.semibold))
                        Text(row.implementationState.replacingOccurrences(of: "_", with: " ").capitalized).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var authorityDetail: String {
        let authority = app.nexoraV3Status.authority
        if authority.authorityState == "AUTHORIZED" { return "Verified provider authority" }
        if authority.missingScopes.isEmpty { return "Provider does not expose all requested automation authority" }
        return "\(authority.missingScopes.count) permissions require consent"
    }
    private func state(for capability: String) -> String { app.nexoraV3Status.authority.supportedCapabilities.contains(capability) ? "Supported" : "Needs authority" }
    private func statusLine(_ status: String, detail: String) -> some View { VStack(alignment: .leading, spacing: 3) { Text(status.replacingOccurrences(of: "_", with: " ").capitalized).font(.subheadline.weight(.semibold)); Text(detail).font(.caption).foregroundStyle(.secondary) } }
    private func healthRow(_ title: String, state: String, symbol: String) -> some View { HStack { Label(title, systemImage: symbol); Spacer(); Text(state).font(.caption).foregroundStyle(.secondary) } }
    private func centerRow(_ title: String, _ symbol: String) -> some View { Label(title, systemImage: symbol).foregroundStyle(.primary) }
}

private struct NexoraV3CenterDetail: View {
    let title: String
    let rows: [String]
    let footer: String

    private var listRows: [CollapsibleListTextItem] {
        rows.enumerated().map { CollapsibleListTextItem(id: "\($0.offset):\($0.element)", text: $0.element) }
    }

    var body: some View {
        List {
            Section {
                CollapsibleList(items: listRows, itemName: "\(title) items") { row in
                    Label(row.text.replacingOccurrences(of: "_", with: " "), systemImage: "circle.fill")
                        .font(.callout)
                } empty: {
                    ContentUnavailableView("No items yet", systemImage: "tray", description: Text("NEXORA will show verified items here when they exist."))
                }
            }
            Section("Truth Boundary") { Text(footer).font(.callout).foregroundStyle(.secondary) }
        }
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// App-native, stable-ID navigation for observed organization entities. This
/// intentionally exposes no provider mutation: graph data is local evidence
/// until a provider adapter reports a verified write capability.
struct NexoraOrganizationGraphDetailView: View {
    @EnvironmentObject private var app: AppState

    private var rankedNodes: [NexoraGraphNode] {
        app.nexoraOrganizationGraph.nodes.sorted {
            $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }

    var body: some View {
        List {
            Section {
                Text("Observed organization, domain, identity, trust, customer, and vendor records. This graph stays tenant-scoped and does not invent a provider directory.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            CollapsibleList(
                items: rankedNodes,
                itemName: "organization entities",
                searchableText: { "\($0.label) \($0.kind.rawValue) \($0.metadata.values.joined(separator: " "))" }
            ) { node in
                NavigationLink(value: node.id) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(node.label).font(.subheadline.weight(.semibold))
                        Text(node.kind.rawValue.capitalized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityLabel("Open \(node.kind.rawValue) \(node.label)")
            } empty: {
                ContentUnavailableView("No observed entities", systemImage: "circle.hexagongrid", description: Text("Refresh to derive tenant-scoped entities from connected identities and loaded mail."))
            }
        }
        .navigationTitle("Organization Graph")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { app.refreshOrganizationGraph() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh organization graph")
            }
        }
        .navigationDestination(for: UUID.self) { id in
            if let node = app.nexoraOrganizationGraph.nodes.first(where: { $0.id == id }) {
                NexoraOrganizationNodeDetailView(node: node)
            } else {
                ContentUnavailableView("Entity no longer available", systemImage: "questionmark.folder", description: Text("This observed record was removed or is unavailable in the current workspace."))
            }
        }
    }
}

struct NexoraOrganizationNodeDetailView: View {
    private enum PendingSourceAction: Identifiable {
        case moveToJunk
        case blockLocally

        var id: String {
            switch self {
            case .moveToJunk: return "moveToJunk"
            case .blockLocally: return "blockLocally"
            }
        }
    }

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let node: NexoraGraphNode
    @State private var actionStatus: String?
    @State private var showRemovalConfirmation = false
    @State private var pendingSourceAction: PendingSourceAction?
    @State private var showSourceActionConfirmation = false

    private var sourceAddresses: Set<String> {
        let values = [node.label, node.metadata["email"]]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { $0.contains("@") }
        return Set(values)
    }

    private var sourceDomains: Set<String> {
        var domains = Set(sourceAddresses.compactMap { $0.split(separator: "@").last.map(String.init) })
        if node.kind == .domain {
            let candidate = node.label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !candidate.isEmpty { domains.insert(candidate) }
        }
        return domains
    }

    private var relatedEmails: [EmailMessage] {
        guard !sourceAddresses.isEmpty || !sourceDomains.isEmpty else { return [] }
        return app.emails
            .filter {
                sourceAddresses.contains($0.fromAddress.lowercased())
                    || sourceDomains.contains($0.fromAddress.split(separator: "@").last.map(String.init) ?? "")
            }
            .sorted { ($0.createTime ?? "") > ($1.createTime ?? "") }
    }

    private var actionSourceEmails: [EmailMessage] {
        var seen = Set<String>()
        return relatedEmails.filter { email in
            let address = email.fromAddress.lowercased()
            return !address.isEmpty && seen.insert(address).inserted
        }
    }

    private var primarySourceAddress: String? {
        sourceAddresses.sorted().first
    }

    private var isHiddenFromDirectory: Bool {
        primarySourceAddress.map(app.isContactHiddenFromDirectory) ?? false
    }

    private var sourceActionTitle: String {
        switch pendingSourceAction {
        case .moveToJunk: return "Move related messages to Junk?"
        case .blockLocally: return "Block observed sources locally?"
        case nil: return "Confirm source action"
        }
    }

    private var sourceActionMessage: String {
        switch pendingSourceAction {
        case .moveToJunk:
            return "Move \(relatedEmails.count) loaded message\(relatedEmails.count == 1 ? "" : "s") associated with \(node.label) into NEXORA's local Junk folder. This does not change provider-side mail until an authorized provider operation is available."
        case .blockLocally:
            return "Block \(actionSourceEmails.count) observed sender\(actionSourceEmails.count == 1 ? "" : "s") associated with \(node.label) in NEXORA and move loaded messages to local Junk. This does not claim provider delivery blocking."
        case nil:
            return ""
        }
    }

    var body: some View {
        List {
            Section("Identity") {
                LabeledContent("Name", value: node.label)
                LabeledContent("Type", value: node.kind.rawValue.capitalized)
                LabeledContent("Record ID", value: node.id.uuidString)
            }
            Section("Current state") {
                Text("Observed locally")
                Text("Provider directory writes are unavailable until an authorized provider adapter verifies that capability.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Evidence") {
                if node.metadata.isEmpty {
                    Text("No additional observed metadata.").foregroundStyle(.secondary)
                } else {
                    ForEach(node.metadata.keys.sorted(), id: \.self) { key in
                        LabeledContent(key.replacingOccurrences(of: "_", with: " ").capitalized, value: node.metadata[key] ?? "")
                    }
                }
            }
            if !sourceAddresses.isEmpty || !sourceDomains.isEmpty {
                Section("Related communications") {
                    if relatedEmails.isEmpty {
                        Text("No loaded communications from this source.")
                            .foregroundStyle(.secondary)
                    } else {
                        CollapsibleList(
                            items: relatedEmails,
                            itemName: "communications",
                            searchableText: { "\($0.fromName) \($0.fromAddress) \($0.displaySubject)" }
                        ) { email in
                            NavigationLink {
                                EmailDetailView(email: email)
                                    .environmentObject(app)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(email.displaySubject).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text(email.fromAddress).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .accessibilityLabel("Open email \(email.displaySubject) from \(email.fromName)")
                        } empty: {
                            EmptyView()
                        }
                    }
                }
                Section("Source actions") {
                    Button {
                        pendingSourceAction = .moveToJunk
                        showSourceActionConfirmation = true
                    } label: {
                        Label("Move Related Messages to Junk", systemImage: "exclamationmark.octagon")
                    }
                    .disabled(relatedEmails.isEmpty)
                    Button(role: .destructive) {
                        pendingSourceAction = .blockLocally
                        showSourceActionConfirmation = true
                    } label: {
                        Label(actionSourceEmails.count > 1 ? "Block Observed Sources Locally" : "Block Source Locally", systemImage: "hand.raised.fill")
                    }
                    .disabled(actionSourceEmails.isEmpty)
                    if let primarySourceAddress {
                        Button(role: isHiddenFromDirectory ? nil : .destructive) {
                            app.setContactHiddenFromDirectory(primarySourceAddress, hidden: !isHiddenFromDirectory)
                            actionStatus = isHiddenFromDirectory ? "Restored to the local directory." : "Hidden from the local directory."
                        } label: {
                            Label(isHiddenFromDirectory ? "Unhide from Directory" : "Hide from Directory", systemImage: isHiddenFromDirectory ? "eye" : "eye.slash")
                        }
                        Button(role: .destructive) {
                            showRemovalConfirmation = true
                        } label: {
                            Label("Remove Local Contact", systemImage: "person.crop.circle.badge.minus")
                        }
                    }
                    if let actionStatus {
                        Text(actionStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text("Directory removal and blocking are local NEXORA actions. They do not claim to delete a provider contact or change provider delivery rules.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Available operations") {
                Text("This evidence record is read-only. NEXORA has not performed a provider-directory change.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(node.label)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .confirmationDialog("Remove \(node.label) from the local directory?", isPresented: $showRemovalConfirmation, titleVisibility: .visible) {
            Button("Remove Local Contact", role: .destructive) {
                if let primarySourceAddress {
                    app.setContactRemovedLocally(primarySourceAddress, removed: true)
                    dismiss()
                }
            }
        } message: {
            Text("NEXORA will stop showing this observed contact in its local directory. Related mail and any provider contact remain unchanged; this does not delete remote data.")
        }
        .confirmationDialog(sourceActionTitle, isPresented: $showSourceActionConfirmation, titleVisibility: .visible) {
            switch pendingSourceAction {
            case .moveToJunk:
                Button("Move \(relatedEmails.count) Related Messages to Junk", role: .destructive) {
                    Task {
                        var failures = 0
                        for email in relatedEmails {
                            if !(await app.moveToJunk(email)) { failures += 1 }
                        }
                        actionStatus = failures == 0
                            ? "Moved \(relatedEmails.count) loaded message\(relatedEmails.count == 1 ? "" : "s") to Junk."
                            : "\(failures) message\(failures == 1 ? "" : "s") could not be moved to Junk."
                    }
                }
            case .blockLocally:
                Button("Block \(actionSourceEmails.count) Observed Source\(actionSourceEmails.count == 1 ? "" : "s") Locally", role: .destructive) {
                    guard let firstEmail = actionSourceEmails.first else { return }
                    app.blockSender(firstEmail)
                    for email in actionSourceEmails.dropFirst() {
                        app.blockSender(email)
                    }
                    actionStatus = "Blocked \(actionSourceEmails.count) observed source\(actionSourceEmails.count == 1 ? "" : "s") locally and moved loaded messages to Junk."
                }
            case nil:
                EmptyView()
            }
        } message: {
            Text(sourceActionMessage)
        }
    }
}

struct CalendarView: View {
    @State private var store = EKEventStore()
    @State private var authorizationStatus = EKEventStore.authorizationStatus(for: .event)
    @State private var events: [EKEvent] = []
    @State private var isLoading = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    permissionContent
                }
                if CalendarEventAuthorization.canReadEvents(authorizationStatus) {
                    Section("Today") {
                        if isLoading {
                            ProgressView("Loading calendar…")
                        } else if events.isEmpty {
                            ContentUnavailableView("No events today", systemImage: "calendar", description: Text("NEXORA reads your Apple Calendar only after permission is granted."))
                        } else {
                            ForEach(events, id: \.eventIdentifier) { event in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(event.title.isEmpty ? "(untitled event)" : event.title)
                                        .font(.subheadline.weight(.semibold))
                                    Text(eventTimeLine(event))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                    Section("Availability") {
                        Text(availabilityLine)
                            .font(.callout)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AmbientBackground())
            .navigationTitle("Calendar")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await loadEvents() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(!CalendarEventAuthorization.canReadEvents(authorizationStatus))
                }
            }
            .task {
                await loadEvents()
            }
        }
    }

    @ViewBuilder
    private var permissionContent: some View {
        switch authorizationStatus {
        case .notDetermined:
            VStack(alignment: .leading, spacing: 8) {
                Text("Apple Calendar permission is required to show real events and availability.")
                    .font(.callout)
                Button {
                    Task { await requestAccess() }
                } label: {
                    Label("Allow Calendar Access", systemImage: "calendar.badge.checkmark")
                }
            }
        case .restricted, .denied:
            Label("Calendar access is denied or restricted. Enable Calendar permission in Settings to show availability.", systemImage: "lock")
                .foregroundStyle(.secondary)
        case _ where CalendarEventAuthorization.canReadEvents(authorizationStatus):
            Label("Calendar access granted", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case _ where CalendarEventAuthorization.isWriteOnly(authorizationStatus):
            Label("Calendar write-only access cannot show events. Grant full access to show availability.", systemImage: "exclamationmark.triangle")
                .foregroundStyle(.orange)
        default:
            Label("Calendar permission state is unavailable.", systemImage: "questionmark.circle")
                .foregroundStyle(.secondary)
        }
        if let message {
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var availabilityLine: String {
        let busy = events.filter { !$0.isAllDay }.count
        if busy == 0 { return "You appear available today based on visible timed events." }
        return "You have \(busy) timed event\(busy == 1 ? "" : "s") today."
    }

    private func requestAccess() async {
        do {
            let granted: Bool
            if #available(iOS 17.0, macOS 14.0, *) {
                granted = try await store.requestFullAccessToEvents()
            } else {
                granted = try await store.requestAccess(to: .event)
            }
            authorizationStatus = EKEventStore.authorizationStatus(for: .event)
            message = granted ? nil : "Calendar permission was not granted."
            await loadEvents()
        } catch {
            message = "Calendar permission could not be requested."
        }
    }

    private func loadEvents() async {
        authorizationStatus = EKEventStore.authorizationStatus(for: .event)
        guard CalendarEventAuthorization.canReadEvents(authorizationStatus) else { return }
        isLoading = true
        defer { isLoading = false }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? Date()
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
    }

    private func eventTimeLine(_ event: EKEvent) -> String {
        if event.isAllDay { return "All day" }
        return "\(event.startDate.formatted(date: .omitted, time: .shortened)) - \(event.endDate.formatted(date: .omitted, time: .shortened))"
    }
}
