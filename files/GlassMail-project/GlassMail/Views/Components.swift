//
//  Components.swift
//  GlassMail
//
//  Shared SwiftUI building blocks, styled with the iOS 26 / macOS 26 Liquid
//  Glass system (`glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass)`).
//

import SwiftUI

enum VisualSystemV3 {
    enum Spacing { static let micro: CGFloat = 4; static let small: CGFloat = 8; static let medium: CGFloat = 12; static let large: CGFloat = 16 }
    enum Radius { static let compact: CGFloat = 8; static let control: CGFloat = 12 }
    enum Typography { static let caption = Font.caption; static let body = Font.body }
    enum ColorToken {
        static let canvas = Color(red: 8/255, green: 13/255, blue: 22/255)
        static let surface = Color(red: 16/255, green: 24/255, blue: 36/255)
        static let elevatedSurface = Color(red: 24/255, green: 35/255, blue: 50/255)
        static let accent = Color(red: 87/255, green: 151/255, blue: 206/255)
        static let success = Color(red: 76/255, green: 175/255, blue: 136/255)
        static let warning = Color(red: 205/255, green: 154/255, blue: 80/255)
        static let danger = Color(red: 204/255, green: 91/255, blue: 91/255)
        static let hairline = Color.white.opacity(0.09)

        static func canvas(for scheme: ColorScheme) -> Color {
            scheme == .dark
                ? Color(red: 8/255, green: 13/255, blue: 22/255)
                : Color(red: 241/255, green: 245/255, blue: 250/255)
        }

        static func surface(for scheme: ColorScheme) -> Color {
            scheme == .dark
                ? Color(red: 16/255, green: 24/255, blue: 36/255)
                : Color(red: 1, green: 1, blue: 1)
        }

        static func hairline(for scheme: ColorScheme) -> Color {
            scheme == .dark ? Color.white.opacity(0.09) : Color.black.opacity(0.09)
        }

        static func primaryText(for scheme: ColorScheme) -> Color {
            scheme == .dark ? Color.white.opacity(0.96) : Color(red: 15/255, green: 23/255, blue: 35/255)
        }

        static func secondaryText(for scheme: ColorScheme) -> Color {
            scheme == .dark ? Color.white.opacity(0.80) : Color(red: 45/255, green: 57/255, blue: 72/255)
        }

        static func tertiaryText(for scheme: ColorScheme) -> Color {
            scheme == .dark ? Color.white.opacity(0.66) : Color(red: 83/255, green: 96/255, blue: 112/255)
        }
    }
    enum Motion { static let feedback = Animation.easeOut(duration: 0.14); static let disclosure = Animation.easeInOut(duration: 0.20) }
}

struct Theme {
    struct Spacing { static let extraSmall: CGFloat = 4; static let small: CGFloat = 8; static let medium: CGFloat = 12; static let large: CGFloat = 16; static let extraLarge: CGFloat = 24 }
    struct CornerRadius { static let small: CGFloat = 8; static let medium: CGFloat = 12; static let large: CGFloat = 18; static let container: CGFloat = 24 }
    static let primaryAccent = VisualSystemV3.ColorToken.accent
    static let secondaryAccent = Color(red: 69/255, green: 128/255, blue: 184/255)
    static func glassBorder(for scheme: ColorScheme) -> Color { scheme == .dark ? Color.white.opacity(0.20) : Color.black.opacity(0.12) }
    static func glassBackground(for scheme: ColorScheme) -> Color { scheme == .dark ? Color.black.opacity(0.25) : Color.white.opacity(0.40) }
    static func adaptiveGradientColors(for scheme: ColorScheme) -> [Color] { scheme == .dark ? [primaryAccent.opacity(0.12), Color(white: 0.1).opacity(0.92), primaryAccent.opacity(0.08)] : [primaryAccent.opacity(0.06), Color(white: 0.98).opacity(0.96), primaryAccent.opacity(0.04)] }
    static func adaptiveRadialColors(for scheme: ColorScheme) -> [Color] { scheme == .dark ? [primaryAccent.opacity(0.16), .clear] : [primaryAccent.opacity(0.08), .clear] }
}

// MARK: - Mail Density

enum MailDensity: String, CaseIterable, Identifiable {
    case compact, comfortable, expanded
    var id: String { rawValue }
    var title: String {
        switch self {
        case .compact: return "Compact"
        case .comfortable: return "Comfortable"
        case .expanded: return "Expanded"
        }
    }
}

// MARK: - Liquid Glass card

struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat = Theme.CornerRadius.medium
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        content
            .padding(Theme.Spacing.medium)
            .background(VisualSystemV3.ColorToken.surface(for: colorScheme), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(VisualSystemV3.ColorToken.hairline(for: colorScheme), lineWidth: 0.7))
    }
}

extension View {
    /// Applies a continuous-corner Liquid Glass background to any view.
    func glassCard(cornerRadius: CGFloat = Theme.CornerRadius.medium) -> some View {
        modifier(CloudMailSurfaceCard(cornerRadius: cornerRadius))
    }

    @ViewBuilder
    func loginTextInputStyle() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }
}

// MARK: - App background

struct AmbientBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VisualSystemV3.ColorToken.canvas(for: colorScheme).ignoresSafeArea()
    }
}

private struct CloudMailSurfaceCard: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background(VisualSystemV3.ColorToken.surface(for: colorScheme), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(VisualSystemV3.ColorToken.hairline(for: colorScheme), lineWidth: 0.7))
    }
}

struct ClaudePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(reduceMotion ? nil : VisualSystemV3.Motion.feedback, value: configuration.isPressed)
    }
}

struct SmartClassificationTag: View {
    let classification: SmartMailClassification

    var body: some View {
        Label(classification.category.rawValue, systemImage: classification.category.symbol)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(classification.category.tint)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(classification.category.tint.opacity(0.12), in: Capsule())
            .help(classification.reason)
            .accessibilityLabel("\(classification.category.rawValue). \(classification.reason). Confidence \(classification.confidence) percent")
    }
}

struct SmartClassificationExplanation: View {
    let classification: SmartMailClassification

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: classification.category.symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(classification.category.tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(classification.category.rawValue)
                    .font(.caption.weight(.semibold))
                Text(classification.reason)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text("\(classification.score.total)%")
                .font(.caption2.monospacedDigit().weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(classification.category.tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Classification: \(classification.category.rawValue). \(classification.reason). Confidence \(classification.confidence) percent")
    }
}

// MARK: - Category badge

struct CategoryBadge: View {
    let category: MailCategory
    var compact = false

    var body: some View {
        badge
            .padding(.horizontal, compact ? 6 : 9)
            .padding(.vertical, compact ? 6 : 5)
            .foregroundStyle(tint)
            .background(tint.opacity(0.14), in: Capsule())
    }

    @ViewBuilder
    private var badge: some View {
        if compact {
            Image(systemName: category.symbol)
                .font(.caption2.weight(.bold))
        } else {
            Label {
                Text(category.rawValue).font(.caption.weight(.semibold))
            } icon: {
                Image(systemName: category.symbol).font(.caption2.weight(.bold))
            }
        }
    }

    private var tint: Color {
        switch category {
        case .urgent:     return .red
        case .personal:   return .pink
        case .work:       return .blue
        case .finance:    return .green
        case .newsletter: return .indigo
        case .promotion:  return .orange
        case .social:     return .teal
        case .spam:       return .gray
        case .other:      return .secondary
        }
    }
}

// MARK: - Source truth

struct SourceBadge: View {
    let provider: UnifiedMailProvider
    let account: String
    let domain: String
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 5 : 8) {
            Label(provider.title, systemImage: provider.symbol)
            if !compact {
                if !account.isEmpty {
                    Text(account)
                }
                if !domain.isEmpty {
                    Text(domain)
                }
            }
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, compact ? 7 : 9)
        .padding(.vertical, compact ? 4 : 5)
        .foregroundStyle(tint)
        .background(tint.opacity(0.14), in: Capsule())
    }

    private var tint: Color {
        provider.identityColor
    }
}

struct IdentityTruthBadge: View {
    let title: String
    let subtitle: String
    let provider: UnifiedMailProvider
    let status: String
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            Image(systemName: provider.symbol)
                .font(.caption.weight(.bold))
                .frame(width: compact ? 18 : 24, height: compact ? 18 : 24)
                .foregroundStyle(tint)
                .background(tint.opacity(0.13), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font((compact ? Font.caption : Font.subheadline).weight(.semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(status)
                .font(.caption2.weight(.bold))
                .foregroundStyle(statusTint)
                .padding(.horizontal, compact ? 5 : 7)
                .padding(.vertical, compact ? 2 : 4)
                .background(statusTint.opacity(0.12), in: Capsule())
        }
        .padding(compact ? 6 : 9)
        .background(tint.opacity(0.07), in: RoundedRectangle(cornerRadius: compact ? 8 : 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        provider.identityColor
    }

    private var statusTint: Color {
        if status.localizedCaseInsensitiveContains("receive") ||
            status.localizedCaseInsensitiveContains("delegated") {
            return .orange
        }
        if status.localizedCaseInsensitiveContains("need") ||
            status.localizedCaseInsensitiveContains("blocked") ||
            status.localizedCaseInsensitiveContains("error") {
            return .red
        }
        return .green
    }
}

struct CompactAccountPillView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Menu {
            Menu {
                Button {
                    Task { await app.setMailbox(accountId: nil, provider: nil) }
                    app.selectedMainTab = 0
                } label: {
                    Label("All Mail", systemImage: "tray.full.fill")
                }
                ForEach(app.addresses) { account in
                    Button {
                        Task { await app.setMailbox(accountId: account.accountId, provider: account.displayProvider) }
                        app.selectedMainTab = 0
                    } label: {
                        Label(account.displayProvider.title, systemImage: account.displayProvider.symbol)
                    }
                }
            } label: {
                Label("Switch Account", systemImage: "arrow.triangle.2.circlepath")
            }

            Button {
                app.selectedMainTab = 5
            } label: {
                Label("Account Health", systemImage: "waveform.path.ecg")
            }

            Button {
                Task { await app.refresh() }
            } label: {
                Label("Sync Status", systemImage: "arrow.clockwise")
            }

            Button {
                app.selectedMainTab = 5
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: activeProvider.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(activeProvider.identityColor)
                Text(activeProvider.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .fixedSize(horizontal: false, vertical: true)
            .glassCard(cornerRadius: 14)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(activeProvider.title) account menu")
        .accessibilityHint("Switch account, inspect health, refresh sync status, or open settings")
    }

    private var activeProvider: UnifiedMailProvider {
        if let selectedAccountId = app.selectedAccountId,
           let account = app.addresses.first(where: { $0.accountId == selectedAccountId }) {
            return account.displayProvider
        }
        if let selectedProvider = app.selectedProvider {
            return selectedProvider
        }
        if let primary = app.primaryCloudMailAccount {
            return primary.displayProvider
        }
        if let first = app.addresses.first {
            return first.displayProvider
        }
        return .custom
    }
}

extension UnifiedMailProvider {
    var identityColor: Color {
        switch self {
        case .gmail, .googleWorkspace: return .red
        case .cloudflareNative: return .blue
        case .outlook: return Color(red: 0.0, green: 0.47, blue: 0.84)
        case .imap: return .purple
        case .custom: return .indigo
        }
    }

    var identityName: String {
        switch self {
        case .gmail, .googleWorkspace: return "Gmail red"
        case .cloudflareNative: return "NEXORA blue"
        case .outlook: return "Outlook azure"
        case .imap: return "Proton purple"
        case .custom: return "Custom indigo"
        }
    }
}


struct AIExecutionView: View {
    let metadata: AIExecutionMetadata

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(metadata.displayLine, systemImage: metadata.executedProvider.symbol)
                .font(.caption.weight(.semibold))
            if let reason = metadata.fallbackReason {
                Text("Reason: \(reason)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(metadata.generatedAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct AIExecutionInlineView: View {
    let metadata: AIExecutionMetadata

    private var locality: String {
        metadata.localOrCloud.capitalized
    }

    private var title: String {
        if metadata.requestedProvider == metadata.executedProvider {
            return "AI: \(metadata.executedProvider.title) · \(locality)"
        }
        return "AI: \(metadata.executedProvider.title) · \(locality) · requested \(metadata.requestedProvider.title)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: metadata.executedProvider.symbol)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(metadata.localOrCloud == "cloud" ? Color.indigo : Color.green)
                .lineLimit(1)
                .accessibilityIdentifier("AI execution attribution")
                .accessibilityLabel(title)
            if let reason = metadata.fallbackReason {
                Text("Fallback: \(reason)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Avatar

struct SenderAvatar: View {
    let name: String
    var size: CGFloat = 40

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let chars = parts.compactMap { $0.first }.map(String.init)
        return chars.joined().uppercased().isEmpty ? "?" : chars.joined().uppercased()
    }

    private var color: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .green, .teal, .indigo, .red]
        let idx = abs(name.hashValue) % palette.count
        return palette[idx]
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [color, color.opacity(0.7)],
                               startPoint: .top, endPoint: .bottom),
                in: Circle())
    }
}

// MARK: - Date formatting

extension Date {
    var mailListLabel: String {
        let cal = Calendar.current
        if cal.isDateInToday(self) {
            return formatted(date: .omitted, time: .shortened)
        }
        if cal.isDateInYesterday(self) { return "Yesterday" }
        if let days = cal.dateComponents([.day], from: self, to: .now).day, days < 7 {
            return formatted(.dateTime.weekday(.abbreviated))
        }
        return formatted(.dateTime.month(.abbreviated).day())
    }
}

// MARK: - Inline error banner

struct ErrorBanner: View {
    let message: String
    var onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button { onDismiss() } label: {
                Image(systemName: "xmark").font(.caption.weight(.bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .glassCard(cornerRadius: 14)
        .padding(.horizontal)
    }
}

// MARK: - Reusable progressive list

/// Shared compact-list behavior for Enterprise Hub and future operating
/// surfaces. Data remains fully present; the component only controls the
/// initial visual disclosure and restores the compact state when its source
/// shrinks below the configured threshold.
struct CollapsibleList<Item: Identifiable, Row: View, Empty: View>: View {
    let items: [Item]
    let defaultVisibleCount: Int
    let itemName: String
    let searchableText: ((Item) -> String)?
    let row: (Item) -> Row
    let empty: () -> Empty
    @State private var isExpanded = false
    @State private var query = ""

    init(
        items: [Item],
        defaultVisibleCount: Int = 2,
        itemName: String = "items",
        searchableText: ((Item) -> String)? = nil,
        @ViewBuilder row: @escaping (Item) -> Row,
        @ViewBuilder empty: @escaping () -> Empty
    ) {
        self.items = items
        self.defaultVisibleCount = max(1, defaultVisibleCount)
        self.itemName = itemName
        self.searchableText = searchableText
        self.row = row
        self.empty = empty
    }

    private var canCollapse: Bool { items.count > defaultVisibleCount }
    private var normalizedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var filteredItems: [Item] {
        guard let searchableText, !normalizedQuery.isEmpty else { return items }
        return items.filter { searchableText($0).lowercased().contains(normalizedQuery) }
    }
    private var visibleItems: [Item] {
        normalizedQuery.isEmpty && !isExpanded && canCollapse ? Array(filteredItems.prefix(defaultVisibleCount)) : filteredItems
    }

    var body: some View {
        Group {
            if items.isEmpty {
                empty()
            } else {
                if searchableText != nil && canCollapse {
                    HStack(spacing: 8) {
                        TextField("Search \(itemName)", text: $query)
                            .textInputAutocapitalization(.never)
                            .accessibilityLabel("Search \(itemName)")
                        if !query.isEmpty {
                            Button("Clear") { query = "" }
                                .font(.caption.weight(.semibold))
                                .accessibilityLabel("Clear \(itemName) search")
                        }
                    }
                    Text("\(filteredItems.count) result\(filteredItems.count == 1 ? "" : "s") · Exact local filter")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if !normalizedQuery.isEmpty && filteredItems.isEmpty {
                    ContentUnavailableView(
                        "No matching \(itemName)",
                        systemImage: "magnifyingglass",
                        description: Text("Try visible metadata or clear the local filter.")
                    )
                } else {
                    ForEach(visibleItems) { item in row(item) }
                }
                if canCollapse && normalizedQuery.isEmpty {
                    Button(isExpanded ? "Show Less" : "Show More") { isExpanded.toggle() }
                        .accessibilityLabel(isExpanded ? "Show less \(itemName)" : "Show more \(itemName)")
                        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
                        .accessibilityHint("\(items.count) \(itemName) available")
                }
            }
        }
        .onChange(of: items.count) { _, count in
            if count <= defaultVisibleCount {
                isExpanded = false
                query = ""
            }
        }
    }
}

/// Lightweight text item for data-only sections that still need the shared
/// disclosure, dynamic-state, and accessibility behavior of `CollapsibleList`.
struct CollapsibleListTextItem: Identifiable {
    let id: String
    let text: String
}
