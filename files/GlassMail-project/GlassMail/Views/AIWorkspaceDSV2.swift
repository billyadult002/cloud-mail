//
//  AIWorkspaceDSV2.swift
//  GlassMail
//

import SwiftUI

enum CMWorkspaceTab: String, CaseIterable, Identifiable {
    case briefing
    case health
    case run
    case output
    case artifacts
    case history
    case audit

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

struct CMWorkspaceShell<Content: View>: View {
    let title: String
    let subtitle: String
    let state: ExecutionState
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                CMStatusBar(state: state)
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 16)
    }
}

struct CMWorkspaceTabs: View {
    @Binding var selection: CMWorkspaceTab
    var tabs: [CMWorkspaceTab] = [.briefing, .health, .output, .run]

    var body: some View {
        Picker("Workspace section", selection: $selection) {
            ForEach(tabs) { tab in
                Text(tab.title).tag(tab)
            }
        }
        .pickerStyle(.segmented)
    }
}

struct CMEvidencePanel: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Evidence", systemImage: "checklist.checked")
                .font(.caption.weight(.semibold))
            ForEach(rows, id: \.0) { row in
                HStack(alignment: .top) {
                    Text(row.0)
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text(row.1)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct CMExecutionTimeline: View {
    let items: [HistoryState]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Timeline", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                .font(.caption.weight(.semibold))
            ForEach(items) { item in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: item.state.symbol)
                        .foregroundStyle(tint(for: item.state))
                        .frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.caption.weight(.semibold))
                        Text(item.detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
    }

    private func tint(for state: ExecutionState) -> Color {
        switch state {
        case .completed, .ready, .exported: return .green
        case .failed: return .red
        case .blocked: return .orange
        case .running, .generating: return Color(hex: 0x0A66C2)
        default: return .secondary
        }
    }
}

struct CMOutputPanel: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "doc.text")
                .font(.caption.weight(.semibold))
            Text(ProductSafeText.sanitize(text, context: .ai))
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct CMArtifactCenter: View {
    let artifacts: [Artifact]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Artifacts", systemImage: "shippingbox")
                .font(.caption.weight(.semibold))
            if artifacts.isEmpty {
                Text("No artifacts generated yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(artifacts) { artifact in
                    HStack {
                        Image(systemName: artifact.state.symbol)
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(artifact.title)
                                .font(.caption.weight(.semibold))
                            Text("\(artifact.source) · \(artifact.state.title)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            }
        }
    }
}

struct CMHistoryRail: View {
    let history: [HistoryState]

    var body: some View {
        CMExecutionTimeline(items: history)
    }
}

struct CMAuditPanel: View {
    let audit: AuditState

    var body: some View {
        CMEvidencePanel(rows: [
            ("Runtime", audit.runtimeBoundary),
            ("Account", audit.accountScope),
            ("Provider", audit.providerScope),
            ("Cross-account", audit.crossAccountAccess ? "true" : "false"),
            ("Shared key", audit.sharedPlatformApiKey ? "true" : "false")
        ])
    }
}

struct CMStatusBar: View {
    let state: ExecutionState

    var body: some View {
        Label(state.title, systemImage: state.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private var tint: Color {
        switch state {
        case .completed, .ready, .exported: return .green
        case .failed: return .red
        case .blocked: return .orange
        case .running, .generating: return Color(hex: 0x0A66C2)
        default: return .secondary
        }
    }
}

extension Color {
    init(hex: UInt) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}
