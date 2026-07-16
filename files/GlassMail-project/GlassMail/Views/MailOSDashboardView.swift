//
//  MailOSDashboardView.swift
//  GlassMail
//

import SwiftUI

struct MiniMailOSHeaderView: View {
    let briefing: MailOSBriefingSnapshot
    let trust: MailDataTrustSnapshot
    let sync: MailSyncObservabilitySnapshot
    let runtime: AIRuntimeStatusSnapshot
    let routingLabel: String
    let selectedBriefingCategory: MailBriefingCategory?
    var refreshAction: () -> Void
    var commandAction: () -> Void
    var briefingAction: (MailBriefingCategory) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Label(sync.lastSuccessfulSync, systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(sync.currentSyncState == "Failed" ? Color.orange : Color.blue)
                Text("· \(trust.visibleMessages) visible")
                    .foregroundStyle(.secondary)
                Text("·")
                    .foregroundStyle(.secondary)
                Label(runtime.syntheticReady ? "AI Ready" : "AI Check", systemImage: runtime.syntheticReady ? "sparkles" : "exclamationmark.triangle.fill")
                    .foregroundStyle(runtime.syntheticReady ? Color.green : Color.orange)
                Spacer(minLength: 4)
                Button(action: commandAction) {
                    Image(systemName: "command")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Open command palette")
                Button(action: refreshAction) {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Refresh mail")
            }
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.white.opacity(0.18), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func miniStatus(_ title: String, _ detail: String, _ symbol: String, _ tint: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2.weight(.bold))
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func triageButton(_ category: MailBriefingCategory, count: Int, symbol: String, tint: Color) -> some View {
        Group {
            if selectedBriefingCategory == category {
                Button {
                    briefingAction(category)
                } label: {
                    triageButtonLabel(category, count: count, symbol: symbol)
                }
                .buttonStyle(.glassProminent)
            } else {
                Button {
                    briefingAction(category)
                } label: {
                    triageButtonLabel(category, count: count, symbol: symbol)
                }
                .buttonStyle(.glass)
            }
        }
        .tint(tint)
        .accessibilityLabel("\(category.title), \(count) messages")
    }

    private func triageButtonLabel(_ category: MailBriefingCategory, count: Int, symbol: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
            Text("\(count)")
                .monospacedDigit()
            Text(category.title)
        }
        .font(.caption2.weight(.bold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

struct MailOSDashboardView: View {
    let briefing: MailOSBriefingSnapshot
    let health: [MailboxHealthSnapshot]
    let trust: MailDataTrustSnapshot
    let sync: MailSyncObservabilitySnapshot
    let runtime: AIRuntimeStatusSnapshot
    let latestAIExecution: AIExecutionMetadata?
    let selectedBriefingCategory: MailBriefingCategory?
    var refreshAction: () -> Void
    var summarizeAction: () -> Void
    var commandAction: () -> Void
    var briefingAction: (MailBriefingCategory) -> Void
    var mailboxAction: (MailboxHealthSnapshot) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            statusRail
            briefingGrid
            healthStrip
            runtimeLine
        }
        .padding(14)
        .glassCard(cornerRadius: 18)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Inbox")
                    .font(.headline.weight(.bold))
                Text("NEXORA Mail control center")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: commandAction) {
                Image(systemName: "command")
                    .accessibilityLabel("Open command palette")
            }
            .buttonStyle(.glass)
            Button(action: refreshAction) {
                Image(systemName: "arrow.clockwise")
                    .accessibilityLabel("Refresh mail")
            }
            .buttonStyle(.glass)
        }
    }

    private var briefingGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("AI Briefing", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button(action: summarizeAction) {
                    Label("Summarize", systemImage: "wand.and.stars")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.glass)
            }
            if let latestAIExecution {
                AIExecutionInlineView(metadata: latestAIExecution)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    briefingTile(.needReply, briefing.needReply, "arrowshape.turn.up.left.fill", .orange)
                    briefingTile(.waiting, briefing.waiting, "clock.fill", .purple)
                    briefingTile(.followUp, briefing.followUp, "arrowshape.turn.up.right.fill", .blue)
                    if briefing.urgent > 0 {
                        briefingTile(.urgent, briefing.urgent, "exclamationmark.shield.fill", .red)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func briefingTile(_ category: MailBriefingCategory, _ count: Int, _ symbol: String, _ tint: Color) -> some View {
        Button {
            briefingAction(category)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: symbol)
                        .foregroundStyle(tint)
                    Spacer(minLength: 4)
                    if selectedBriefingCategory == category {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(tint)
                    }
                }
                Text("\(count)")
                    .font(.headline.monospacedDigit().weight(.bold))
                Text(category.title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 104, alignment: .leading)
            .padding(10)
            .background(tileBackground(category, tint: tint), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(category.title), \(count) messages")
        .accessibilityValue(selectedBriefingCategory == category ? "Selected" : "Not selected")
        .accessibilityHint("Filters the mail list")
    }

    private func tileBackground(_ category: MailBriefingCategory, tint: Color) -> Color {
        selectedBriefingCategory == category ? tint.opacity(0.20) : tint.opacity(0.10)
    }

    private var healthStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Mailbox Health", systemImage: "waveform.path.ecg")
                .font(.subheadline.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(health.prefix(4))) { row in
                        healthCard(row)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var statusRail: some View {
        HStack(spacing: 8) {
            statusTile(
                title: "Sync Status",
                value: sync.currentSyncState,
                detail: sync.lastSuccessfulSync,
                symbol: "arrow.triangle.2.circlepath",
                tint: sync.currentSyncState == "Failed" ? .orange : .blue
            )
            statusTile(
                title: "Data Trust",
                value: "\(trust.visibleMessages) visible",
                detail: trust.dataFreshness,
                symbol: "checkmark.shield.fill",
                tint: .green
            )
        }
    }

    private func statusTile(title: String, value: String, detail: String, symbol: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
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
        .padding(9)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func healthCard(_ row: MailboxHealthSnapshot) -> some View {
        Button {
            mailboxAction(row)
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    SyncPulseRing(state: row.state, color: row.provider.identityColor)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.account)
                            .font(.caption.weight(.bold))
                            .lineLimit(1)
                        Text("\(row.provider.title) · \(row.state.rawValue)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                metricLine("Auth", row.authorizationLabel)
                metricLine("Sync", row.currentSyncState)
                metricLine("Last", row.lastSyncLabel)
                metricLine("Latency", row.latencyLabel)
                metricLine("Visible", "\(row.visibleMessages)")
                metricLine("Indexed", "\(row.indexedMessages)")
                if let progress = row.progressLabel {
                    Text(progress)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(row.provider.identityColor)
                }
            }
            .frame(width: 190, alignment: .leading)
            .padding(10)
            .background(row.provider.identityColor.opacity(0.09), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open mailbox detail for \(row.account)")
    }

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Sync Status", systemImage: "arrow.triangle.2.circlepath")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(sync.currentSyncState)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(sync.currentSyncState == "Failed" ? Color.orange : Color.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                trustMetric("Mailbox", sync.currentMailbox)
                trustMetric("Folder", sync.currentFolder)
                trustMetric("Last Success", sync.lastSuccessfulSync)
                trustMetric("Last Failed", sync.lastFailedSync)
                trustMetric("Retry", sync.retryCountdown)
                trustMetric("Progress", sync.syncProgress)
                trustMetric("Queue", sync.queueDepth)
                trustMetric("Latency", sync.latency)
                trustMetric("Last Error", sync.lastError)
            }
        }
        .padding(10)
        .background(Color.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityLabel("Sync observability")
    }

    private var runtimeCard: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: runtime.syntheticReady ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(runtime.syntheticReady ? Color.green : Color.orange)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(runtime.title)
                    .font(.subheadline.weight(.semibold))
                Text(runtime.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(runtime.providerStates.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var runtimeLine: some View {
        HStack(spacing: 8) {
            Image(systemName: runtime.syntheticReady ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(runtime.syntheticReady ? Color.green : Color.orange)
            Text(runtime.title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(runtime.syntheticReady ? "Ready" : "Needs attention")
                .font(.caption2.weight(.bold))
                .foregroundStyle(runtime.syntheticReady ? Color.green : Color.orange)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.accentColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var trustCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Data Trust", systemImage: "checkmark.shield.fill")
                .font(.subheadline.weight(.semibold))
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                trustMetric("Visible", "\(trust.visibleMessages)")
                trustMetric("Indexed", "\(trust.indexedMessages)")
                trustMetric("Sources", trust.mailboxSources)
                trustMetric("Updated", trust.lastUpdated)
                trustMetric("Filter", trust.currentFilter)
                trustMetric("Identity", trust.currentIdentity)
                trustMetric("Freshness", trust.dataFreshness)
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func metricLine(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value)
                .font(.caption2)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
    }

    private func trustMetric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SyncPulseRing: View {
    let state: MailOSHealthState
    let color: Color

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.22), lineWidth: 4)
                .frame(width: 28, height: 28)
            Circle()
                .trim(from: 0, to: state == .syncing || state == .initialSyncRunning ? 0.67 : 1)
                .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .frame(width: 28, height: 28)
                .rotationEffect(.degrees(-90))
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
        }
    }

    private var statusColor: Color {
        switch state {
        case .ready, .connected: return .green
        case .connectedNoData, .stale: return .orange
        case .initialSyncRunning, .syncing: return color
        case .failed, .attention: return .red
        case .unavailable: return .secondary
        }
    }
}
