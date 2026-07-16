//
//  MobileWorkspaceView.swift
//  GlassMail
//

import SwiftUI

struct MobileWorkspaceView: View {
    @EnvironmentObject private var app: AppState
    @State private var selectedTab: CMWorkspaceTab = .briefing
    @State private var selectedMailboxHealth: MailboxHealthSnapshot?
    @State private var showSecurityCenter = false
    @State private var showMoreBriefing = false
    @State private var runningWorkflow: AIWorkspaceRealWorkflow?
    @State private var output = "Choose a workflow to run against the currently loaded mailbox."
    @State private var artifacts: [Artifact] = []
    @State private var history: [HistoryState] = [
        HistoryState(title: "Configure", detail: "Mailbox-scoped workflow surface ready.", state: .ready)
    ]

    private var state: ExecutionState {
        if runningWorkflow != nil { return .running }
        if !app.aiConsent.aiEnabled { return .blocked }
        return artifacts.isEmpty ? .ready : .completed
    }

    var body: some View {
        CMWorkspaceShell(
            title: "AI Workspace",
            subtitle: "Mailbox briefing, health, and controlled AI workflows.",
            state: state
        ) {
            CMWorkspaceTabs(selection: $selectedTab, tabs: [.briefing, .health, .output, .run])
            switch selectedTab {
            case .briefing:
                briefingConsole
                workspaceEvidenceStrip
            case .health:
                healthConsole
            case .run:
                workflowGrid
            case .output:
                CMOutputPanel(title: "Output", text: output)
                ArtifactCenterView(artifacts: artifacts)
                ExecutionTimelineView(history: history)
            default:
                EmptyView()
            }
        }
        .sheet(item: $selectedMailboxHealth) { row in
            MailboxDetailView(row: row, trust: app.dataTrustSnapshot, sync: app.syncObservabilitySnapshot)
                .environmentObject(app)
        }
        .sheet(isPresented: $showSecurityCenter) {
            SecurityCenterView().environmentObject(app)
        }
        .onAppear { applyRequestedTab() }
        .onChange(of: app.aiWorkspaceLaunchTabRaw) { _, _ in applyRequestedTab() }
    }

    private var briefingConsole: some View {
        let briefing = app.mailOSBriefingSnapshot
        let runtime = app.aiRuntimeStatusSnapshot

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Label("Briefing", systemImage: "sparkles.rectangle.stack")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                runtimeBadge(runtime.syntheticReady ? "Ready" : "Needs Check", runtime.syntheticReady ? .green : .orange)
                Button {
                    Task { await app.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Refresh AI workspace briefing and mailbox health")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 7)], spacing: 7) {
                briefingButton("Reply", briefing.needReply, "arrowshape.turn.up.left.fill", .orange, filter: "needsReply")
                briefingButton("Wait", briefing.waiting, "clock.fill", .gray, filter: "waiting")
                briefingButton("Follow Up", briefing.followUp, "arrowshape.turn.up.right.fill", .blue, filter: "followUp")
                briefingButton("Urgent", briefing.urgent, "exclamationmark.shield.fill", .red, filter: "urgent")
            }
            DisclosureGroup(isExpanded: $showMoreBriefing) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 7)], spacing: 7) {
                    briefingButton("People", briefing.personal, "person.fill", .blue, filter: "people")
                    briefingButton("Updates", briefing.updates, "bell.fill", .gray, filter: "updates")
                }
            } label: {
                Text("More briefing queues").font(.caption.weight(.semibold))
            }
        }
        .padding(12)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var healthConsole: some View {
        let health = app.mailboxHealthSnapshots
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button { selectedMailboxHealth = health.first } label: {
                    workspaceStatusTile("Sync", app.syncObservabilitySnapshot.currentSyncState, app.syncObservabilitySnapshot.lastSuccessfulSync, "arrow.triangle.2.circlepath", .blue)
                }
                .buttonStyle(.plain)
                .disabled(health.isEmpty)
                Button { showSecurityCenter = true } label: {
                    workspaceStatusTile("Trust", "\(app.dataTrustSnapshot.visibleMessages) visible", app.dataTrustSnapshot.dataFreshness, "checkmark.shield.fill", .green)
                }
                .buttonStyle(.plain)
            }
            Label("Mailbox Health", systemImage: "waveform.path.ecg").font(.subheadline.weight(.semibold))
            CollapsibleList(
                items: health,
                itemName: "mailbox health records",
                searchableText: { "\($0.account) \($0.provider.title) \($0.domain) \($0.state.rawValue) \($0.currentSyncState) \($0.authorizationLabel)" }
            ) { row in
                Button { selectedMailboxHealth = row } label: { workspaceHealthRow(row) }
                    .buttonStyle(.plain)
            } empty: {
                ContentUnavailableView("No health data", systemImage: "waveform.path.ecg")
            }
        }
        .padding(12)
        .background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var workspaceEvidenceStrip: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
            compactEvidence("Mailbox", app.currentUser?.email ?? "Not signed in")
            compactEvidence("Messages", "\(app.emails.count) loaded")
            compactEvidence("Runtime", app.aiConsent.aiEnabled ? "Ready" : "Disabled")
            compactEvidence("Boundary", "Mailbox-scoped")
        }
    }

    private var workflowGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 8)], spacing: 8) {
            ForEach(AIWorkspaceRealWorkflow.allCases) { workflow in
                Button {
                    run(workflow)
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: workflow.symbol)
                            .font(.headline)
                        Text(workflow.title)
                            .font(.caption.weight(.semibold))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .disabled(runningWorkflow != nil || !app.aiConsent.aiEnabled)
            }
        }
    }

    private func workspaceStatusTile(_ title: String, _ value: String, _ detail: String, _ symbol: String, _ tint: Color) -> some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2.weight(.bold))
                Text(value)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(tint.opacity(0.09), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func briefingButton(_ title: String, _ count: Int, _ symbol: String, _ tint: Color, filter: String) -> some View {
        Button {
            app.selectedInboxFilterRaw = filter
            app.selectedMainTab = 0
        } label: {
            HStack(spacing: 6) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 17)
            Text("\(count)")
                .font(.caption.monospacedDigit().weight(.bold))
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .buttonStyle(ClaudePressStyle())
        .accessibilityLabel("\(title), \(count)")
        .accessibilityHint("Opens the \(title) queue")
    }

    private func workspaceHealthRow(_ row: MailboxHealthSnapshot) -> some View {
        HStack(alignment: .center, spacing: 9) {
            Circle()
                .fill(workspaceHealthColor(row.state))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.account)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text("\(row.currentSyncState) · \(row.lastSyncLabel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(row.state.rawValue)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(workspaceHealthColor(row.state))
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func compactEvidence(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func runtimeBadge(_ title: String, _ color: Color) -> some View {
        Text(title)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }

    private func workspaceHealthColor(_ state: MailOSHealthState) -> Color {
        switch state {
        case .connected, .ready:
            return .green
        case .syncing, .initialSyncRunning:
            return .blue
        case .stale, .attention:
            return .orange
        case .failed, .unavailable, .connectedNoData:
            return .red
        }
    }

    private func run(_ workflow: AIWorkspaceRealWorkflow) {
        runningWorkflow = workflow
        selectedTab = .output
        history.append(HistoryState(title: workflow.title, detail: "Running mailbox-scoped workflow.", state: .running))
        Task {
            let result = await app.aiWorkspaceWorkflow(workflow)
            await MainActor.run {
                runningWorkflow = nil
                let safeText = ProductSafeText.sanitize(result.text, context: .ai)
                output = "\(safeText)\n\nSource: \(result.sourceAccount) · Messages: \(result.messageCount)\n\(result.runtimeBoundary)"
                artifacts.insert(Artifact(title: workflow.title, source: "AI Workspace", state: .ready, summary: safeText), at: 0)
                history.append(HistoryState(title: workflow.title, detail: result.runtimeStatus ?? "Completed", state: .completed))
            }
        }
    }

    private func applyRequestedTab() {
        guard let raw = app.aiWorkspaceLaunchTabRaw,
              let tab = CMWorkspaceTab(rawValue: raw) else { return }
        selectedTab = tab
        app.aiWorkspaceLaunchTabRaw = nil
    }
}
