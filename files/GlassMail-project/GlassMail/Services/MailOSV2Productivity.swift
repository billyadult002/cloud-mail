//
//  MailOSV2Productivity.swift
//  GlassMail
//
//  Local-first productivity primitives for MailOS V2. These services keep
//  user-facing actions responsive without requiring a production schema change.
//

import Foundation
import SwiftUI

@MainActor
final class MessageSelectionManager: ObservableObject {
    @Published private(set) var selectedIDs: Set<Int> = []

    var isSelecting: Bool { !selectedIDs.isEmpty }
    var selectedCount: Int { selectedIDs.count }

    func toggle(_ email: EmailMessage) {
        if selectedIDs.contains(email.emailId) {
            selectedIDs.remove(email.emailId)
        } else {
            selectedIDs.insert(email.emailId)
        }
    }

    func selectAll(_ emails: [EmailMessage]) {
        selectedIDs = Set(emails.map(\.emailId))
    }

    func clear() {
        selectedIDs.removeAll()
    }
}

enum MessageActionID: String, CaseIterable, Codable {
    case archive
    case delete
    case move
    case star
    case unstar
    case markRead
    case markUnread
    case spam
    case snooze
    case unsubscribe
    case block
    case reply
    case forward
}

enum MessageActionRegistry {
    static let batchActions: [MessageActionID] = [
        .archive, .delete, .move, .star, .unstar, .markRead, .markUnread, .spam
    ]

    static let detailActions: [MessageActionID] = [
        .reply, .forward, .move, .archive, .delete, .snooze, .unsubscribe, .block, .spam
    ]
}

struct BulkActionToolbar: View {
    let selectedCount: Int
    let archive: () -> Void
    let delete: () -> Void
    let move: () -> Void
    let markRead: () -> Void
    let spam: () -> Void
    let star: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Text("\(selectedCount)")
                .font(.caption.monospacedDigit().weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 28, height: 28)
                .background(.regularMaterial, in: Circle())
            toolbarButton("Archive", "archivebox", archive)
            toolbarButton("Delete", "trash", delete, tint: .red)
            toolbarButton("Move", "folder", move)
            toolbarButton("Read", "envelope.open", markRead)
            toolbarButton("Spam", "exclamationmark.octagon", spam, tint: .orange)
            toolbarButton("Star", "star", star, tint: .orange)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .overlay { Capsule().strokeBorder(Color.primary.opacity(0.08), lineWidth: 1) }
        .accessibilityIdentifier("mailos-v2-bulk-action-toolbar")
    }

    private func toolbarButton(_ label: String, _ icon: String, _ action: @escaping () -> Void, tint: Color = .accentColor) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct MoveToMailboxSheet: View {
    let onMove: (LocalMailBoxKind) -> Void
    @Environment(\.dismiss) private var dismiss
    @AppStorage("nexora_recent_move_folders_v1") private var recentFolderValues = ""

    private var folders: [LocalMailBoxKind] {
        LocalMailBoxKind.allCases.filter { ![.drafts, .sent, .outbox, .scheduled].contains($0) }
    }

    private var suggestedFolders: [LocalMailBoxKind] { [.inbox, .done, .followUp, .important] }

    private var recentFolders: [LocalMailBoxKind] {
        recentFolderValues.split(separator: ",").compactMap { LocalMailBoxKind(rawValue: String($0)) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Suggested") {
                    ForEach(suggestedFolders) { folder in folderButton(folder) }
                }
                if !recentFolders.isEmpty {
                    Section("Recent") {
                        ForEach(recentFolders) { folder in folderButton(folder) }
                    }
                }
                Section("All Folders") {
                    ForEach(folders) { folder in folderButton(folder) }
                }
            }
            .navigationTitle("Move to")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("mailos-v2-move-to-mailbox-sheet")
    }

    private func folderButton(_ folder: LocalMailBoxKind) -> some View {
        Button {
            remember(folder)
            onMove(folder)
            dismiss()
        } label: {
            Label(folder.title, systemImage: folder.symbol)
        }
        .accessibilityIdentifier("move-to-mailbox-\(folder.rawValue)")
    }

    private func remember(_ folder: LocalMailBoxKind) {
        let values = [folder] + recentFolders.filter { $0 != folder }
        recentFolderValues = values.prefix(4).map(\.rawValue).joined(separator: ",")
    }
}

struct MailOSV2CategoryBadge: View {
    let category: MailOSV2Category

    var body: some View {
        Label(category.rawValue, systemImage: category.symbol)
            .font(.caption2.weight(.semibold))
            .labelStyle(.iconOnly)
            .foregroundStyle(tint)
            .frame(width: 18, height: 18)
            .accessibilityLabel(category.rawValue)
            .accessibilityIdentifier("mailos-v2-category-\(category.rawValue.lowercased())")
    }

    private var tint: Color {
        switch category {
        case .primary: return .blue
        case .updates: return .cyan
        case .promotions: return .orange
        case .social: return .pink
        case .transactions: return .green
        case .forums: return .indigo
        case .junk: return .red
        }
    }
}

enum MailOSV2Category: String, CaseIterable, Codable, Identifiable {
    case primary = "Primary"
    case updates = "Updates"
    case promotions = "Promotions"
    case social = "Social"
    case transactions = "Transactions"
    case forums = "Forums"
    case junk = "Junk"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .primary: return "tray.fill"
        case .updates: return "bell.badge.fill"
        case .promotions: return "tag.fill"
        case .social: return "person.2.fill"
        case .transactions: return "creditcard.fill"
        case .forums: return "text.bubble.fill"
        case .junk: return "exclamationmark.octagon.fill"
        }
    }
}

/// The single user-facing classification vocabulary for NEXORA All Mail.
/// It deliberately models work intent rather than provider folders.
enum SmartMailCategory: String, CaseIterable, Codable, Identifiable {
    case actionRequired = "Action Required"
    case priority = "Priority"
    case unread = "Unread"
    case people = "People"
    case customers = "Customers"
    case work = "Work"
    case finance = "Finance"
    case orders = "Orders"
    case travel = "Travel"
    case updates = "Updates"
    case notifications = "Notifications"
    case promotions = "Promotions"
    case other = "Other"
    case archived = "Archived"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .actionRequired: return "arrowshape.turn.up.left.fill"
        case .priority: return "exclamationmark.shield.fill"
        case .unread: return "circle.fill"
        case .people: return "person.2.fill"
        case .customers: return "person.crop.circle.badge.checkmark"
        case .work: return "briefcase.fill"
        case .finance: return "creditcard.fill"
        case .orders: return "shippingbox.fill"
        case .travel: return "airplane"
        case .updates: return "arrow.triangle.2.circlepath"
        case .notifications: return "bell.badge.fill"
        case .promotions: return "tag.fill"
        case .other: return "tray"
        case .archived: return "archivebox.fill"
        }
    }

    var tint: Color {
        switch self {
        case .actionRequired: return .orange
        case .priority: return .red
        case .unread: return .blue
        case .people: return .cyan
        case .customers: return .indigo
        case .work: return .blue
        case .finance: return .green
        case .orders: return .orange
        case .travel: return .teal
        case .updates: return .cyan
        case .notifications: return .purple
        case .promotions: return .pink
        case .other: return .secondary
        case .archived: return .secondary
        }
    }

    var mailOSV2Category: MailOSV2Category {
        switch self {
        case .actionRequired, .priority, .unread, .people, .customers, .work: return .primary
        case .finance, .orders, .travel: return .transactions
        case .updates, .notifications: return .updates
        case .promotions: return .promotions
        case .other: return .primary
        case .archived: return .primary
        }
    }
}

struct SmartClassificationScore: Hashable {
    let userHistory: Int
    let organizationHistory: Int
    let senderReputation: Int
    let mailMetadata: Int
    let aiSemantic: Int

    static let zero = SmartClassificationScore(userHistory: 0, organizationHistory: 0, senderReputation: 0, mailMetadata: 0, aiSemantic: 0)

    var total: Int {
        Int((Double(userHistory) * 0.40
            + Double(organizationHistory) * 0.20
            + Double(senderReputation) * 0.20
            + Double(mailMetadata) * 0.10
            + Double(aiSemantic) * 0.10).rounded())
    }
}

final class UserClassificationMemory {
    private let key = "nexora_user_classification_memory_v1"
    private var senderRules: [String: SmartMailCategory]
    private var organizationRules: [String: SmartMailCategory]
    private var messageRules: [String: SmartMailCategory]

    private struct Stored: Codable {
        var senderRules: [String: String]
        var organizationRules: [String: String]
        var messageRules: [String: String]?
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            senderRules = stored.senderRules.compactMapValues(SmartMailCategory.init(rawValue:))
            organizationRules = stored.organizationRules.compactMapValues(SmartMailCategory.init(rawValue:))
            messageRules = (stored.messageRules ?? [:]).compactMapValues(SmartMailCategory.init(rawValue:))
        } else {
            senderRules = [:]; organizationRules = [:]; messageRules = [:]
        }
    }

    func override(for email: EmailMessage) -> (category: SmartMailCategory, scope: String)? {
        if let category = messageRules[String(email.emailId)] { return (category, "message") }
        let sender = email.fromAddress.lowercased()
        let domain = email.fromAddress.split(separator: "@").last.map(String.init)?.lowercased() ?? ""
        if let category = senderRules[sender] { return (category, "sender") }
        if let category = organizationRules[domain], !domain.isEmpty { return (category, "organization") }
        return nil
    }

    func learn(_ category: SmartMailCategory, for email: EmailMessage, scope: String = "message") {
        let sender = email.fromAddress.lowercased()
        let domain = email.fromAddress.split(separator: "@").last.map(String.init)?.lowercased() ?? ""
        switch scope {
        case "sender": if !sender.isEmpty { senderRules[sender] = category }
        case "domain": if !domain.isEmpty { organizationRules[domain] = category }
        default: messageRules[String(email.emailId)] = category
        }
        persist()
    }

    private func persist() {
        let stored = Stored(
            senderRules: senderRules.mapValues(\.rawValue),
            organizationRules: organizationRules.mapValues(\.rawValue),
            messageRules: messageRules.mapValues(\.rawValue)
        )
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

final class OrganizationClassificationMemory {
    private let key = "nexora_organization_classification_memory_v1"
    private var rules: [String: SmartMailCategory]

    init() {
        let raw = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
        rules = raw.compactMapValues(SmartMailCategory.init(rawValue:))
    }

    func override(for email: EmailMessage) -> SmartMailCategory? {
        guard let domain = email.fromAddress.split(separator: "@").last.map(String.init)?.lowercased(), !domain.isEmpty else { return nil }
        return rules[domain]
    }

    func learn(_ category: SmartMailCategory, for email: EmailMessage) {
        guard let domain = email.fromAddress.split(separator: "@").last.map(String.init)?.lowercased(), !domain.isEmpty else { return }
        rules[domain] = category
        UserDefaults.standard.set(rules.mapValues(\.rawValue), forKey: key)
    }
}

struct ExternalReputationHint: Hashable {
    let source: String
    let domain: String
}

final class ExternalReputationRegistry {
    private let supportedSources = ["adguard", "easylist", "easyprivacy", "spamhaus"]

    func hint(for email: EmailMessage) -> ExternalReputationHint? {
        let domain = email.sourceDomain.lowercased()
        guard !domain.isEmpty else { return nil }
        for source in supportedSources {
            let domains = Set(UserDefaults.standard.stringArray(forKey: key(for: source)) ?? [])
            if domains.contains(domain) {
                return ExternalReputationHint(source: source, domain: domain)
            }
        }
        return nil
    }

    func setDomains(_ domains: Set<String>, source: String) {
        guard supportedSources.contains(source.lowercased()) else { return }
        UserDefaults.standard.set(Array(domains.map { $0.lowercased() }).sorted(), forKey: key(for: source.lowercased()))
    }

    private func key(for source: String) -> String {
        "nexora_external_reputation_\(source)"
    }
}

struct SmartMailClassification: Hashable {
    let category: SmartMailCategory
    let confidence: Int
    let reason: String
    let actionRequired: Bool
    let waitingReply: Bool
    let priority: Bool
    let score: SmartClassificationScore

    init(category: SmartMailCategory, confidence: Int, reason: String, actionRequired: Bool, waitingReply: Bool, priority: Bool, score: SmartClassificationScore = .zero) {
        self.category = category
        self.confidence = confidence
        self.reason = reason
        self.actionRequired = actionRequired
        self.waitingReply = waitingReply
        self.priority = priority
        self.score = score
    }
}

/// Provider-neutral communication context used by Goal OS. These dimensions
/// describe message meaning and never encode provider-specific behavior.
struct CommunicationIntelligence: Hashable {
    let intent: String
    let action: String
    let context: String
    let relationship: String
    let attention: String
    let trust: String
    let lifecycle: String
    let canonicalCode: String
    let senderType: String
    let businessDomain: String
    let businessEvent: String
    let workflowState: String
    let confidentiality: String
    let entityContext: String
    let policySignals: String
    let timeContext: String
    let openLoop: String
    let explanation: String
    let correctionScope: String
}

final class CommunicationIntelligenceEngine {
    func analyze(email: EmailMessage, classification: SmartMailClassification, relationship: RelationshipIntelligence, trust: NexoraTrustAssessment) -> CommunicationIntelligence {
        let intent: String
        let text = "\(email.displaySubject) \(email.searchableSnippet)".lowercased()
        let sender = email.fromAddress.lowercased()
        let automated = sender.contains("noreply") || sender.contains("no-reply") || text.contains("unsubscribe")
        let financial = ["invoice", "payment", "wire", "付款", "发票", "支付"].contains { text.contains($0) }
        let contract = ["contract", "agreement", "合同", "协议"].contains { text.contains($0) }
        let security = ["password", "sign-in", "credential", "验证码", "密码", "登录"].contains { text.contains($0) }
        let securityControlTriggered = trust.trustLevel == .highRisk || trust.trustLevel == .suspicious || trust.phishingRisk == .high || trust.phishingRisk == .critical || trust.attachments.contains { $0.status == .blocked || $0.status == .suspicious }
        let senderDomain = sender.split(separator: "@").last.map(String.init) ?? "unknown"
        let recipientCount = [email.toEmail ?? "", email.ccRecipients, email.bccRecipients].filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
        let policySignals = CommunicationPolicy.signals(
            senderDomain: senderDomain,
            automated: automated,
            recipientCount: recipientCount,
            hasThread: !email.sourceThreadID.isEmpty,
            hasProviderHeaderEvidence: false
        )
        let timeContext = CommunicationPolicy.timeContext(for: email.date)
        let openLoop = CommunicationPolicy.openLoop(
            securityControlTriggered: securityControlTriggered,
            actionRequired: classification.actionRequired,
            waitingReply: classification.waitingReply
        )
        let canonicalCode = securityControlTriggered ? "SECURITY.ACCOUNT.ANOMALY" : security ? "SECURITY.CREDENTIAL.RISK" : financial && text.contains("fail") ? "FINANCE.PAYMENT.FAILURE" : financial && text.contains("approve") ? "FINANCE.PAYMENT.APPROVAL" : financial && text.contains("invoice") ? "FINANCE.INVOICE.RECEIVED" : contract && text.contains("sign") ? "LEGAL.CONTRACT.SIGNATURE" : contract ? "LEGAL.CONTRACT.REVIEW" : "COMMUNICATION.GENERAL"
        let businessDomain = securityControlTriggered || security ? "Security" : financial ? "Finance" : contract ? "Legal" : "Other"
        let businessEvent = securityControlTriggered ? "Security control triggered" : security ? "Account or credential signal" : financial ? "Financial communication" : contract ? "Contract communication" : "General communication"
        switch classification.category {
        case .actionRequired: intent = "Request"
        case .finance: intent = "Financial"
        case .orders: intent = "Transaction"
        case .travel: intent = "Travel"
        case .promotions: intent = "Promotion"
        case .notifications, .updates: intent = "Inform"
        default: intent = "Conversation"
        }
        return CommunicationIntelligence(
            intent: intent,
            action: classification.actionRequired ? "Reply required" : (classification.waitingReply ? "Follow up" : "No action detected"),
            context: classification.category.rawValue,
            relationship: relationship.established ? "Established" : "Unestablished",
            attention: securityControlTriggered ? "P0 Critical · security control" : (CommunicationPolicy.isLowAttention(category: classification.category, text: text) ? "P4 FYI · bulk or informational" : (classification.priority ? "P1 Action Now" : (classification.actionRequired ? "P2 Action Soon" : (email.isUnread ? "P3 Review" : "P4 FYI")))),
            trust: "\(trust.trustLevel.rawValue) · \(trust.trustScore)/100",
            lifecycle: classification.waitingReply ? "Waiting" : (classification.actionRequired ? "Open" : (email.isUnread ? "New" : "Reviewed")),
            canonicalCode: canonicalCode,
            senderType: automated ? "Automated System" : (relationship.established ? "External Human" : "Unknown Sender"),
            businessDomain: businessDomain,
            businessEvent: businessEvent,
            workflowState: securityControlTriggered ? "Needs Review · security control" : (classification.waitingReply ? "Waiting on Others" : (classification.actionRequired ? "Needs Reply" : (email.isUnread ? "New" : "Needs Review"))),
            confidentiality: securityControlTriggered ? "Security-sensitive · policy review required" : (security ? "Security-sensitive · review policy" : "No verified confidentiality label"),
            entityContext: "Sender domain: \(senderDomain)",
            policySignals: policySignals,
            timeContext: timeContext,
            openLoop: openLoop,
            explanation: CommunicationPolicy.explanation(
                canonicalCode: canonicalCode,
                securityControlTriggered: securityControlTriggered,
                financial: financial,
                contract: contract,
                security: security,
                automated: automated,
                classification: classification
            ),
            correctionScope: "Message-only correction; sender learning requires an explicit user action"
        )
    }
}

/// Deterministic, local policy interpretation. It operates only on message
/// metadata and rendered content NEXORA already has; it does not infer missing
/// transport headers, provider verdicts, or external business records.
private enum CommunicationPolicy {
    static func signals(senderDomain: String, automated: Bool, recipientCount: Int, hasThread: Bool, hasProviderHeaderEvidence: Bool) -> String {
        var signals = ["Sender domain: \(senderDomain)"]
        signals.append(automated ? "Automated-address pattern observed" : "No automated-address pattern observed")
        if recipientCount > 1 { signals.append("Multiple recipient fields observed") }
        if hasThread { signals.append("Thread identifier observed") }
        signals.append(hasProviderHeaderEvidence ? "Provider header evidence observed" : "Transport headers not provided")
        return signals.joined(separator: " · ")
    }

    static func timeContext(for date: Date?) -> String {
        guard let date else { return "Source timestamp unavailable" }
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone.current
        return "Normalized to \(TimeZone.current.identifier): \(formatter.string(from: date))"
    }

    static func openLoop(securityControlTriggered: Bool, actionRequired: Bool, waitingReply: Bool) -> String {
        if securityControlTriggered { return "Security review remains open" }
        if waitingReply { return "Waiting for another party" }
        if actionRequired { return "Reply or decision remains open" }
        return "No deterministic open loop detected"
    }

    static func isLowAttention(category: SmartMailCategory, text: String) -> Bool {
        guard category == .promotions || category == .updates else { return false }
        return true
    }

    static func explanation(canonicalCode: String, securityControlTriggered: Bool, financial: Bool, contract: Bool, security: Bool, automated: Bool, classification: SmartMailClassification) -> String {
        var evidence = ["Canonical policy: \(canonicalCode)"]
        if securityControlTriggered { evidence.append("Trust or attachment control overrides business categorization") }
        else if security { evidence.append("Credential/account language observed") }
        else if financial { evidence.append("Financial vocabulary observed") }
        else if contract { evidence.append("Contract vocabulary observed") }
        if automated { evidence.append("Automated sender pattern observed") }
        evidence.append("Mailbox classification: \(classification.category.rawValue)")
        return evidence.joined(separator: " · ")
    }
}

final class SmartMailClassifier {
    func classify(_ email: EmailMessage, triage: MailTriage?, senderHistoryCount: Int, organizationHistoryCount: Int = 1, externalReputationHint: ExternalReputationHint? = nil, relationshipEstablished: Bool = false) -> SmartMailClassification {
        let senderName = email.fromName.lowercased()
        let text = "\(senderName) \(email.displaySubject) \(email.searchableSnippet)".lowercased()
        let sender = email.fromAddress.lowercased()
        let domain = sender.split(separator: "@").last.map(String.init) ?? ""
        let automated = contains(sender, ["noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon", "notification", "notifications", "alerts", "alert@", "系统通知", "自动回复"])
        let bulk = contains(text, ["unsubscribe", "manage preferences", "email preferences", "view in browser", "mailing list", "weekly digest", "newsletter", "coupon", "discount", "limited time", "sale", "offer", "deal", "campaign", "product launch", "退订", "取消订阅", "邮件偏好", "每周摘要", "促销", "优惠", "限时", "新品", "营销", "广告", "立即购买"]) || automated
        let retailBrand = contains(senderName, ["bloomingdale", "bloomingdales", "burberry", "nike", "apple store", "best buy", "house & garden", "house and garden", "attractivo", "attrativo", "retail", "fashion", "outlet", "store", "shop"])
        let commercialSubject = contains(email.displaySubject.lowercased(), ["summer pants", "bar set", "new collection", "promo", "promotional", "best book", "new arrivals", "jazz age", "sale", "deal", "edit"])
        let marketing = retailBrand || (commercialSubject && senderHistoryCount < 2) || contains(text, ["coupon", "discount", "limited time", "sale", "offer", "deal", "shop now", "new collection", "product launch", "store update", "brand new", "促销", "优惠", "限时", "新品", "营销", "广告", "立即购买"]) || contains(sender, ["marketing", "campaign", "promo", "offers", "newsletter", "营销", "促销"])
        let notification = automated || contains(text, ["security alert", "verification", "password", "sign-in", "login", "account change", "status update", "build failed", "deployment", "incident", "notification", "安全提醒", "验证码", "账户变更", "系统通知", "部署失败", "事故通知"])
        let action = contains(text, ["please reply", "can you", "could you", "would you", "let me know", "approval required", "approve", "review the contract", "meeting request", "customer escalation", "need your answer", "action required", "请回复", "请确认", "请审批", "需要审批", "需要您的回复", "请审核", "会议请求", "客户升级"])
        let waiting = contains(text, ["waiting for your", "waiting on", "checking in", "follow up", "follow-up", "circle back", "reminder", "等待您的", "跟进", "提醒", "催办"])
        let humanConversation = !automated && (senderHistoryCount >= 2 || email.displaySubject.lowercased().hasPrefix("re:") || email.displaySubject.lowercased().hasPrefix("fwd:"))
        let customer = senderHistoryCount >= 2 && !domain.contains("gmail.com") && !domain.contains("icloud.com")
        let financial = contains(text, ["invoice", "receipt", "payment", "tax", "statement", "billing", "refund", "expense", "wire transfer", "发票", "收据", "付款", "支付", "税务", "账单", "退款", "报销", "转账"])
        let order = contains(text, ["order", "shipping", "delivery", "tracking", "package", "dispatch", "return label", "订单", "发货", "配送", "物流", "包裹", "退货"])
        let travel = contains(text, ["flight", "hotel", "reservation", "itinerary", "boarding", "trip", "travel", "航班", "酒店", "预订", "行程", "登机"])
        let workCritical = contains(text, ["customer escalation", "contract", "project deadline", "production issue", "outage", "blocked", "launch checklist", "客户升级", "合同", "项目截止", "生产故障", "服务中断", "被阻塞", "发布清单"])
        let priority = humanConversation && (customer || workCritical || contains(text, ["vip", "executive", "critical", "escalation", "calendar invite", "meeting confirmed"]))
        let score = SmartClassificationScore(
            userHistory: min(100, senderHistoryCount * 20),
            organizationHistory: min(100, organizationHistoryCount * 15),
            senderReputation: automated || marketing ? 10 : (externalReputationHint != nil ? 35 : (customer ? 78 : 58)),
            mailMetadata: email.attachmentSignalCount > 0 ? 72 : ((!email.ccRecipients.isEmpty || !email.bccRecipients.isEmpty) ? 54 : 32),
            aiSemantic: action || priority || financial || order || travel ? 86 : (marketing || notification ? 82 : 58)
        )

        // Bulk and automated signals win before urgency words. An ad containing
        // "urgent" must never pollute the Priority queue. Transactional mail
        // remains eligible for its own operational classification even when it
        // contains a list-management footer.
        if marketing || (bulk && !(financial || order || travel)) {
            return SmartMailClassification(category: .promotions, confidence: 96, reason: "Bulk marketing email detected.", actionRequired: false, waitingReply: false, priority: false, score: score)
        }
        if notification && !action {
            return SmartMailClassification(category: .notifications, confidence: 94, reason: "Automated platform-generated update.", actionRequired: false, waitingReply: false, priority: false, score: score)
        }
        if action && !automated && !marketing {
            return SmartMailClassification(category: .actionRequired, confidence: 92, reason: "Direct human reply expected.", actionRequired: true, waitingReply: false, priority: false, score: score)
        }
        if priority {
            return SmartMailClassification(category: .priority, confidence: 90, reason: "Important active conversation with strong work or customer signals.", actionRequired: false, waitingReply: waiting, priority: true, score: score)
        }
        if financial {
            return SmartMailClassification(category: .finance, confidence: 90, reason: "Financial or billing content detected.", actionRequired: action, waitingReply: waiting, priority: false, score: score)
        }
        if order {
            return SmartMailClassification(category: .orders, confidence: 90, reason: "Order, delivery, or tracking content detected.", actionRequired: false, waitingReply: false, priority: false, score: score)
        }
        if travel {
            return SmartMailClassification(category: .travel, confidence: 90, reason: "Travel reservation or itinerary detected.", actionRequired: false, waitingReply: false, priority: false, score: score)
        }
        if contains(text, ["newsletter", "digest", "release notes", "industry update", "blog summary", "community update", "subscription", "新闻简报", "摘要", "发布说明", "行业动态", "社区更新", "订阅"]) {
            return SmartMailClassification(category: .updates, confidence: 88, reason: "Subscription or informational update detected.", actionRequired: false, waitingReply: false, priority: false, score: score)
        }
        if contains(text, ["meeting", "project", "proposal", "contract", "review", "team", "client", "会议", "项目", "提案", "合同", "审核", "团队", "客户"]) || triage?.category == .work {
            return SmartMailClassification(category: .work, confidence: 78, reason: "Work context detected without strong priority evidence.", actionRequired: action, waitingReply: waiting, priority: false, score: score)
        }
        if customer {
            return SmartMailClassification(category: .customers, confidence: 82, reason: "Recurring external contact detected.", actionRequired: action, waitingReply: waiting, priority: false, score: score)
        }
        if relationshipEstablished {
            return SmartMailClassification(category: .people, confidence: 76, reason: "Human contact without urgent work evidence.", actionRequired: action, waitingReply: waiting, priority: false, score: score)
        }
        return SmartMailClassification(category: .other, confidence: 40, reason: "Insufficient relationship and intent evidence; kept out of elevated categories.", actionRequired: false, waitingReply: false, priority: false, score: score)
    }

    func category(for email: EmailMessage, triage: MailTriage?, senderHistoryCount: Int) -> SmartMailCategory {
        classify(email, triage: triage, senderHistoryCount: senderHistoryCount).category
    }

    private func contains(_ text: String, _ terms: [String]) -> Bool {
        terms.contains { text.contains($0) }
    }
}

// MARK: - Work OS action and retention signals

enum WorkQueueSignal: String, CaseIterable, Codable, Identifiable {
    case needsReply = "Needs Reply"
    case needsApproval = "Needs Approval"
    case needsReview = "Needs Review"
    case needsFollowUp = "Needs Follow Up"
    case waitingResponse = "Waiting Response"
    case needsScheduling = "Needs Scheduling"
    case customerAction = "Customer Action"
    case businessAction = "Business Action"

    var id: String { rawValue }
}

struct FollowUpCandidate: Hashable, Identifiable {
    let emailID: Int
    let subject: String
    let sender: String
    let daysSinceSent: Int
    let suggestedWindowDays: Int
    let reason: String

    var id: Int { emailID }
}

enum RetentionRecommendation: String, Codable, CaseIterable, Identifiable {
    case deleteAfter30Days = "Delete after 30 days"
    case archiveAfter30Days = "Archive after 30 days"
    case archiveAfter60Days = "Archive after 60 days"
    case archiveAfter90Days = "Archive after 90 days"
    case deleteAfter180Days = "Delete after 180 days"
    case retain = "Retain"

    var id: String { rawValue }
}

struct WorkOSRetentionPolicy {
    static func recommendation(for classification: SmartMailClassification) -> RetentionRecommendation {
        switch classification.category {
        case .promotions: return .archiveAfter30Days
        case .notifications: return .archiveAfter60Days
        case .updates: return .archiveAfter90Days
        case .archived: return .deleteAfter180Days
        case .finance, .orders, .customers, .priority, .actionRequired, .people, .work, .travel, .unread, .other:
            return .retain
        }
    }
}

final class WorkOSIntelligenceEngine {
    func signals(for email: EmailMessage, classification: SmartMailClassification, triage: MailTriage?) -> Set<WorkQueueSignal> {
        let text = email.searchableSnippet
        let bulkCampaign = classification.category == .promotions
            || classification.category == .updates
            || contains(text, ["unsubscribe", "newsletter", "mailing list", "manage preferences", "view in browser", "weekly digest"])
        // A campaign can contain action vocabulary, but it is not a user work
        // queue item without a separate, explicit correction or direct signal.
        guard !bulkCampaign else { return [] }
        var result = Set<WorkQueueSignal>()
        if classification.actionRequired || contains(text, ["please reply", "can you", "let me know", "need your answer"]) { result.insert(.needsReply) }
        if contains(text, ["approval required", "approve", "sign off", "authorization needed"]) { result.insert(.needsApproval) }
        if contains(text, ["review", "contract", "proposal", "feedback requested"]) { result.insert(.needsReview) }
        if contains(text, ["follow up", "follow-up", "circle back", "checking in"]) { result.insert(.needsFollowUp) }
        if classification.waitingReply || contains(text, ["waiting for", "pending response", "awaiting reply"]) { result.insert(.waitingResponse) }
        if contains(text, ["schedule", "calendar", "meeting request", "availability"]) { result.insert(.needsScheduling) }
        if classification.category == .customers || contains(text, ["customer", "client", "support issue", "escalation"]) { result.insert(.customerAction) }
        if classification.category == .work || contains(text, ["project", "deadline", "launch", "business action"]) || triage?.category == .work { result.insert(.businessAction) }
        return result
    }

    func followUpCandidate(for email: EmailMessage, now: Date = Date()) -> FollowUpCandidate? {
        guard email.type == 1, let sentDate = email.date else { return nil }
        let age = max(0, Calendar.current.dateComponents([.day], from: sentDate, to: now).day ?? 0)
        guard age >= 3, !contains(email.searchableSnippet, ["reply received", "thanks, received"]) else { return nil }
        let window = age >= 14 ? 14 : (age >= 7 ? 7 : 3)
        return FollowUpCandidate(emailID: email.emailId, subject: email.displaySubject, sender: email.toEmail ?? "Unknown recipient", daysSinceSent: age, suggestedWindowDays: window, reason: "Sent mail has no visible reply after \(age) days.")
    }

    private func contains(_ text: String, _ terms: [String]) -> Bool { terms.contains { text.contains($0) } }
}

// MARK: - NEXORA unified intelligence layer

struct CategoryGovernance: Hashable, Identifiable {
    let category: SmartMailCategory
    let purpose: String
    let entryRule: String
    let exitRule: String
    let learningRule: String
    let automationRule: String
    let retentionRule: String
    let explanationRule: String

    var id: String { category.rawValue }

    static func forCategory(_ category: SmartMailCategory) -> CategoryGovernance {
        switch category {
        case .actionRequired:
            return CategoryGovernance(category: category, purpose: "Work that needs a response or decision.", entryRule: "Direct request, approval, or deadline signal.", exitRule: "User completes or reclassifies the work.", learningRule: "Remember manual corrections and successful replies.", automationRule: "Suggest a next action; never send automatically.", retentionRule: "Keep until the user resolves it.", explanationRule: "Show the request signal and confidence.")
        case .priority:
            return CategoryGovernance(category: category, purpose: "Important active relationships or critical work.", entryRule: "Strong relationship plus work, customer, VIP, or calendar evidence.", exitRule: "Conversation loses active importance or user changes category.", learningRule: "User history outranks reputation and semantics.", automationRule: "Rank near the top; do not auto-delete.", retentionRule: "Keep.", explanationRule: "Show relationship and importance evidence.")
        case .people:
            return CategoryGovernance(category: category, purpose: "People the user has an established relationship with.", entryRule: "Contacts, pinned/VIP/starred status, prior sends, or conversation history.", exitRule: "Relationship evidence disappears or user reclassifies it.", learningRule: "Learn from replies, sends, opens, and manual moves.", automationRule: "Never admit unknown humans from sender type alone.", retentionRule: "Keep.", explanationRule: "Show relationship signals and score.")
        case .promotions:
            return CategoryGovernance(category: category, purpose: "Commercial conversion-oriented mail.", entryRule: "Sell intent, campaign, offer, coupon, retail, or unsubscribe signals.", exitRule: "User correction or message becomes a direct conversation.", learningRule: "Learn sender/domain corrections.", automationRule: "Suggest archive; never delete without approval.", retentionRule: "Archive after 30 days; review deletion after 180 days.", explanationRule: "Show commercial intent signals.")
        case .notifications:
            return CategoryGovernance(category: category, purpose: "Automated system or account updates.", entryRule: "Automated sender or system/status signal.", exitRule: "User correction or direct human response.", learningRule: "Learn platform-specific corrections.", automationRule: "Suggest archive; never delete without approval.", retentionRule: "Archive after 60 days; review deletion after 180 days.", explanationRule: "Show automation or system signal.")
        case .updates:
            return CategoryGovernance(category: category, purpose: "Informational mail sent to inform, not sell.", entryRule: "Release notes, research, industry, security, or professional update.", exitRule: "User correction or action request.", learningRule: "Learn newsletter and sender corrections.", automationRule: "Keep visible but below work queues.", retentionRule: "Archive after 90 days.", explanationRule: "Show informational intent.")
        case .finance, .orders, .travel, .customers, .work, .unread, .other, .archived:
            return CategoryGovernance(category: category, purpose: "Structured mail for a specific work context.", entryRule: "Content metadata and learned user context match.", exitRule: "User correction or context changes.", learningRule: "Learn sender, organization, and user actions.", automationRule: "Offer contextual work actions only.", retentionRule: category == .archived ? "Review deletion after 180 days." : "Keep by default.", explanationRule: "Show the matched context and confidence.")
        }
    }
}

struct RelationshipIntelligence: Hashable {
    let relationshipScore: Int
    let peopleScore: Int
    let customerScore: Int
    let partnerScore: Int
    let vipScore: Int
    let unknownHumanScore: Int
    let established: Bool
    let explanation: String
}

struct SecurityIntelligence: Hashable {
    let senderTrustScore: Int
    let impersonationRiskScore: Int
    let spoofingRiskScore: Int
    let explanation: String
}

enum NexoraTrustLevel: String, CaseIterable, Codable, Identifiable {
    case trusted = "Trusted"
    case known = "Known"
    case unknown = "Unknown"
    case suspicious = "Suspicious"
    case highRisk = "High Risk"

    var id: String { rawValue }
}

enum NexoraRiskLevel: String, CaseIterable, Codable, Identifiable {
    case low = "Low"
    case medium = "Medium"
    case high = "High"
    case critical = "Critical"

    var id: String { rawValue }
}

enum SafeLinkLevel: String, CaseIterable, Codable, Identifiable {
    case trusted = "Trusted Link"
    case unknown = "Unknown Link"
    case suspicious = "Suspicious Link"
    case highRisk = "High Risk Link"

    var id: String { rawValue }
}

enum AttachmentTrustStatus: String, CaseIterable, Codable, Identifiable {
    case safe = "Safe"
    case review = "Review"
    case suspicious = "Suspicious"
    case blocked = "Blocked"

    var id: String { rawValue }
}

struct SafeLinkAssessment: Hashable, Identifiable {
    let url: String
    let level: SafeLinkLevel
    let reason: String

    var id: String { url }
}

struct AttachmentTrustAssessment: Hashable, Identifiable {
    let filename: String
    let status: AttachmentTrustStatus
    let reason: String

    var id: String { filename }
}

struct NexoraTrustAssessment: Hashable {
    let trustLevel: NexoraTrustLevel
    let trustScore: Int
    let securityScore: Int
    let businessRiskScore: Int
    let impersonationRisk: NexoraRiskLevel
    let phishingRisk: NexoraRiskLevel
    let explanation: String
    let warnings: [String]
    let trackingDetected: Bool
    let trackingBlocked: Bool
    let links: [SafeLinkAssessment]
    let attachments: [AttachmentTrustAssessment]
}

final class NexoraTrustEngine {
    func assess(email: EmailMessage, relationship: RelationshipIntelligence, security: SecurityIntelligence, reputationHint: ExternalReputationHint?) -> NexoraTrustAssessment {
        let body = email.plainBody.lowercased()
        let trackingDetected = body.contains("tracking pixel") || body.contains("open tracking") || body.contains("<img") || body.contains("pixel.gif")
        let links = linkAssessments(in: email.plainBody)
        let attachments = email.visibleAttachments.map(attachmentAssessment)
        let phishingSignals = ["verify your password", "confirm your account", "login immediately", "gift card", "wire transfer", "bank details"].filter { body.contains($0) }
        let phishingRisk: NexoraRiskLevel = phishingSignals.count >= 2 || links.contains(where: { $0.level == .highRisk }) ? .high : (phishingSignals.isEmpty ? .low : .medium)
        let impersonationRisk: NexoraRiskLevel = security.impersonationRiskScore >= 70 ? .critical : (security.impersonationRiskScore >= 50 ? .high : (security.impersonationRiskScore >= 25 ? .medium : .low))
        let businessRisk = min(100, max(security.impersonationRiskScore, phishingSignals.count * 22) + (attachments.contains { $0.status == .suspicious || $0.status == .blocked } ? 25 : 0))
        let securityScore = max(0, min(100, 100 - businessRisk - (trackingDetected ? 8 : 0)))
        let trustScore = max(0, min(100, security.senderTrustScore - businessRisk / 2 + (relationship.established ? 12 : 0)))
        let trustLevel: NexoraTrustLevel = trustScore >= 85 ? .trusted : (trustScore >= 65 ? .known : (trustScore >= 40 ? .unknown : (trustScore >= 20 ? .suspicious : .highRisk)))
        var warnings = [String]()
        if impersonationRisk == .high || impersonationRisk == .critical { warnings.append("Possible impersonation detected.") }
        if phishingRisk == .high || phishingRisk == .critical { warnings.append("Credential or payment phishing signals detected.") }
        if trackingDetected { warnings.append("Tracking content detected and blocked locally.") }
        warnings.append(contentsOf: attachments.filter { $0.status == .suspicious || $0.status == .blocked }.map { "Attachment \($0.filename): \($0.status.rawValue)." })
        let explanation = relationship.established ? "Known relationship with trust signals; security checks remain active." : "Unknown relationship; verify the sender before replying, opening links, or sending money."
        return NexoraTrustAssessment(trustLevel: trustLevel, trustScore: trustScore, securityScore: securityScore, businessRiskScore: businessRisk, impersonationRisk: impersonationRisk, phishingRisk: phishingRisk, explanation: explanation, warnings: warnings, trackingDetected: trackingDetected, trackingBlocked: trackingDetected, links: links, attachments: attachments)
    }

    private func linkAssessments(in text: String) -> [SafeLinkAssessment] {
        let pattern = "https?://[^\\s<>]+"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return expression.matches(in: text, range: range).compactMap { match in
            guard let matchRange = Range(match.range, in: text) else { return nil }
            let raw = String(text[matchRange]).trimmingCharacters(in: CharacterSet(charactersIn: ".,);"))
            guard let url = URL(string: raw), let host = url.host?.lowercased(), !host.isEmpty else { return nil }
            let suspicious = host.contains("xn--") || host.contains("login-") || host.contains("secure-") || raw.contains("@")
            return SafeLinkAssessment(url: raw, level: suspicious ? .suspicious : .unknown, reason: suspicious ? "Domain or URL shape needs review." : "Domain is not locally verified.")
        }
    }

    private func attachmentAssessment(_ attachment: EmailAttachment) -> AttachmentTrustAssessment {
        let name = attachment.filename.lowercased()
        let blocked = [".exe", ".scr", ".msi", ".bat", ".cmd", ".js", ".vbs", ".ps1"].contains { name.hasSuffix($0) }
        let suspicious = [".zip", ".rar", ".7z", ".docm", ".xlsm", ".html"].contains { name.hasSuffix($0) }
        let status: AttachmentTrustStatus = blocked ? .blocked : (suspicious ? .suspicious : .review)
        return AttachmentTrustAssessment(filename: attachment.filename, status: status, reason: blocked ? "Executable or script attachment." : (suspicious ? "Archive, macro, or active-content attachment." : "Attachment should be reviewed before opening."))
    }
}

final class NexoraAgentEngine {
    func propose(agent: NexoraAgentType, goal: String, emails: [EmailMessage]) -> AgentExecutionProposal {
        let subjectCount = emails.filter { !$0.displaySubject.isEmpty }.count
        switch agent {
        case .customer:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Group customer conversations", "Identify open requests and unanswered mail", "Rank customer risks", "Review customer output"], expectedOutputs: [.customerBrief, .actionReport], explanation: "Customer signals and unresolved work are grouped before generating an output.", estimatedWork: "\(subjectCount) loaded messages")
        case .followUp:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Find sent threads without a visible reply", "Apply learned timing windows", "Review reminder and escalation suggestions"], expectedOutputs: [.actionReport, .emailDraft], explanation: "Follow-up candidates are based on sent history and learned response timing.", estimatedWork: "Local thread scan")
        case .meeting:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Find meeting and calendar signals", "Collect prior conversation context", "Draft agenda and open actions", "Review meeting brief"], expectedOutputs: [.meetingBrief, .actionReport], explanation: "Meeting context is assembled from authorized local mailbox content.", estimatedWork: "Context and action extraction")
        case .finance:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Find invoices, payments, renewals, and approvals", "Separate outstanding items", "Review finance action list"], expectedOutputs: [.statusReport, .actionReport], explanation: "Financial language and work queues are summarized without sending or approving anything.", estimatedWork: "Finance signal scan")
        case .document:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Collect relevant threads", "Draft the requested document", "Review factual boundaries", "Save deliverable"], expectedOutputs: [.executiveBrief, .statusReport], explanation: "The document is drafted from the selected goal and visible mailbox context.", estimatedWork: "Draft and review")
        case .research:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Collect relevant updates", "Separate evidence from assumptions", "Review research summary"], expectedOutputs: [.executiveBrief, .decisionSummary], explanation: "Research outputs distinguish visible evidence from interpretation.", estimatedWork: "Local evidence synthesis")
        case .workflow:
            return AgentExecutionProposal(agent: agent, goal: goal, steps: ["Review goal", "Prepare workflow steps", "Confirm outputs", "Execute approved workflow"], expectedOutputs: [.actionReport], explanation: "Workflow steps remain reviewable and user-approved.", estimatedWork: "Multi-step local workflow")
        }
    }

    func content(for proposal: AgentExecutionProposal, kind: DeliverableKind) -> String {
        let title = proposal.goal.isEmpty ? proposal.agent.rawValue : proposal.goal
        switch kind {
        case .customerBrief: return "Customer brief\n\nGoal\n\(title)\n\nOpen requests\nReview visible customer conversations and unresolved actions.\n\nRecommended next step\nConfirm ownership and follow-up timing."
        case .meetingBrief: return "Meeting brief\n\nObjective\n\(title)\n\nContext\nPrior authorized conversations are available for review.\n\nOpen actions\nConfirm decisions, owners, and dates."
        case .emailDraft: return "Hello,\n\nFollowing up on \(title.lowercased()). I will review the open items and share the next step shortly.\n\nBest,"
        case .executiveBrief: return "Executive brief\n\nObjective\n\(title)\n\nSignals\nSummarize material risks, decisions, and outcomes from the selected mailbox context.\n\nDecision needed\nReview before sharing."
        case .statusReport: return "Status report\n\nGoal\n\(title)\n\nStatus\nPlan prepared; execution remains user-controlled.\n\nNext steps\nReview the proposed actions and assign owners."
        case .actionReport: return "Action report\n\nGoal\n\(title)\n\nActions\n1. Review the highest-priority item.\n2. Confirm owner and due date.\n3. Send or schedule only after approval."
        case .decisionSummary: return "Decision summary\n\nQuestion\n\(title)\n\nEvidence\nUse the visible, authorized mailbox context.\n\nDecision\nPending user review."
        }
    }
}

final class NexoraIntelligenceEngine {
    private let classifier = SmartMailClassifier()

    func classify(_ email: EmailMessage, triage: MailTriage?, senderHistoryCount: Int, organizationHistoryCount: Int, externalReputationHint: ExternalReputationHint?, relationshipEstablished: Bool) -> SmartMailClassification {
        classifier.classify(email, triage: triage, senderHistoryCount: senderHistoryCount, organizationHistoryCount: organizationHistoryCount, externalReputationHint: externalReputationHint, relationshipEstablished: relationshipEstablished)
    }

    func relationship(for email: EmailMessage, senderHistoryCount: Int, sentToSender: Bool, isContact: Bool, isVIP: Bool, isStarred: Bool) -> RelationshipIntelligence {
        let conversation = min(40, senderHistoryCount * 8)
        let priorSend = sentToSender ? 25 : 0
        let contact = isContact ? 25 : 0
        let vip = isVIP ? 10 : 0
        let starred = isStarred ? 8 : 0
        let score = min(100, conversation + priorSend + contact + vip + starred)
        let established = score >= 25
        let explanation = established ? "Established relationship evidence is present." : "No established relationship evidence; sender remains outside People."
        return RelationshipIntelligence(relationshipScore: score, peopleScore: score, customerScore: email.sourceProvider == .gmail && senderHistoryCount >= 2 ? 65 : 0, partnerScore: isContact ? 55 : 0, vipScore: vip > 0 ? 100 : 0, unknownHumanScore: established ? 0 : 80, established: established, explanation: explanation)
    }

    func security(for email: EmailMessage, relationship: RelationshipIntelligence, externalReputationHint: ExternalReputationHint?) -> SecurityIntelligence {
        let text = email.searchableSnippet
        let urgent = ["verify", "password", "wire", "payment", "gift card", "urgent", "account suspended"].contains { text.contains($0) }
        let automated = ["noreply", "no-reply", "mailer-daemon", "notification"].contains { email.fromAddress.lowercased().contains($0) }
        let impersonation = urgent && !relationship.established ? 65 : (urgent ? 30 : 10)
        let spoofing = externalReputationHint == nil && automated ? 35 : 10
        let trust = max(0, min(100, 70 + (relationship.established ? 20 : 0) - impersonation / 2 - spoofing / 3))
        let explanation = impersonation >= 50 ? "Urgent or sensitive language from an unestablished relationship." : "No strong impersonation signal detected locally."
        return SecurityIntelligence(senderTrustScore: trust, impersonationRiskScore: impersonation, spoofingRiskScore: spoofing, explanation: explanation)
    }

    func governance(for category: SmartMailCategory) -> CategoryGovernance { CategoryGovernance.forCategory(category) }
}

struct SenderCategoryRule: Codable, Hashable {
    var key: String
    var category: MailOSV2Category
    var updatedAt: Date
}

final class SenderRuleEngine {
    // `key` holds legacy sender-wide rules written before correction scope was
    // explicit. They are intentionally retained on-device for compatibility,
    // but are not read as automatic overrides.
    private let key = "mailos_v2_sender_category_rules_v1"
    private let messageKey = "mailos_v2_message_category_rules_v1"
    private var messageRules: [String: SenderCategoryRule] = [:]

    init() {
        messageRules = loadRules(forKey: messageKey)
    }

    func categoryOverride(for email: EmailMessage) -> MailOSV2Category? {
        // Legacy sender and domain entries were created implicitly from a
        // single message. Only message-scoped overrides are safe to apply
        // until an explicit sender/domain scope action exists.
        messageRules[String(email.emailId)]?.category
    }

    func learn(email: EmailMessage, category: MailOSV2Category) {
        let messageID = String(email.emailId)
        messageRules[messageID] = SenderCategoryRule(key: messageID, category: category, updatedAt: Date())
        saveRules(messageRules, forKey: messageKey)
    }

    private func loadRules(forKey key: String) -> [String: SenderCategoryRule] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let rules = try? JSONDecoder().decode([String: SenderCategoryRule].self, from: data) else {
            return [:]
        }
        return rules
    }

    private func saveRules(_ rules: [String: SenderCategoryRule], forKey key: String) {
        if let data = try? JSONEncoder().encode(rules) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

final class MailCategoryEngine {
    func classify(_ email: EmailMessage, ruleEngine: SenderRuleEngine) -> MailOSV2Category {
        if let override = ruleEngine.categoryOverride(for: email) {
            return override
        }
        let text = email.searchableSnippet.lowercased()
        if text.contains("unsubscribe") || text.contains("offer") || text.contains("sale") {
            return .promotions
        }
        if text.contains("receipt") || text.contains("invoice") || text.contains("payment") || text.contains("order") {
            return .transactions
        }
        if text.contains("comment") || text.contains("mentioned you") || text.contains("followed") {
            return .social
        }
        if text.contains("forum") || text.contains("thread") || text.contains("digest") {
            return .forums
        }
        if text.contains("spam") || text.contains("lottery") {
            return .junk
        }
        if email.attachmentSignalCount > 0 || text.contains("update") {
            return .updates
        }
        return .primary
    }
}

struct SnoozeEntry: Codable, Hashable {
    var emailId: Int
    var until: Date
}

final class SnoozeScheduler {
    private let key = "mailos_v2_snooze_entries_v1"

    func snooze(email: EmailMessage, until date: Date) {
        var entries = loadEntries()
        entries[email.emailId] = SnoozeEntry(emailId: email.emailId, until: date)
        saveEntries(entries)
    }

    func snoozeDate(for email: EmailMessage) -> Date? {
        loadEntries()[email.emailId]?.until
    }

    func isSnoozed(_ email: EmailMessage, now: Date = Date()) -> Bool {
        guard let until = snoozeDate(for: email) else { return false }
        return until > now
    }

    private func loadEntries() -> [Int: SnoozeEntry] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let entries = try? JSONDecoder().decode([Int: SnoozeEntry].self, from: data) else {
            return [:]
        }
        return entries
    }

    private func saveEntries(_ entries: [Int: SnoozeEntry]) {
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

final class UnsubscribeDetector {
    func unsubscribeAvailable(in email: EmailMessage) -> Bool {
        email.searchableSnippet.lowercased().contains("unsubscribe")
            || email.plainBody.lowercased().contains("list-unsubscribe")
    }

    func blockSender(_ email: EmailMessage) {
        var blocked = Set(UserDefaults.standard.stringArray(forKey: "mailos_v2_blocked_senders_v1") ?? [])
        blocked.insert(email.fromAddress.lowercased())
        UserDefaults.standard.set(Array(blocked).sorted(), forKey: "mailos_v2_blocked_senders_v1")
    }
}

final class QuickReplyTemplateStore: ObservableObject {
    @Published private(set) var templates: [String] = [
        "Thanks, I received this and will follow up shortly.",
        "Thanks for the update. I will review and reply with next steps.",
        "Could you send the missing details so I can proceed?",
        "Approved. Please continue with the plan.",
        "I am unavailable right now and will reply later today."
    ]
}

struct SenderProfile: Identifiable, Hashable {
    var id: String { email.lowercased() }
    var name: String
    var email: String
    var domain: String
    var messageCount: Int
    var lastSubject: String
}

final class SenderProfileStore {
    func profile(for email: EmailMessage, in messages: [EmailMessage]) -> SenderProfile {
        let sender = email.fromAddress.lowercased()
        let related = messages.filter { $0.fromAddress.lowercased() == sender }
        let domain = sender.split(separator: "@").last.map(String.init) ?? ""
        return SenderProfile(
            name: email.fromName,
            email: email.fromAddress,
            domain: domain,
            messageCount: max(related.count, 1),
            lastSubject: email.displaySubject
        )
    }
}

struct SmartSearchQuery {
    var raw: String
    var sender: String?
    var category: MailOSV2Category?
    var unreadOnly: Bool
    var starredOnly: Bool
}

final class SmartSearchRouter {
    func parse(_ query: String) -> SmartSearchQuery {
        let lower = query.lowercased()
        let category = MailOSV2Category.allCases.first { lower.contains($0.rawValue.lowercased()) }
        let sender: String?
        if let range = lower.range(of: "from:") {
            let tail = lower[range.upperBound...]
            sender = tail.split(separator: " ").first.map(String.init)
        } else {
            sender = nil
        }
        return SmartSearchQuery(
            raw: query,
            sender: sender,
            category: category,
            unreadOnly: lower.contains("unread"),
            starredOnly: lower.contains("starred") || lower.contains("flagged")
        )
    }

    func matches(_ email: EmailMessage, query: String, categoryEngine: MailCategoryEngine, ruleEngine: SenderRuleEngine) -> Bool {
        let parsed = parse(query)
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return true }
        if parsed.unreadOnly && !email.isUnread { return false }
        if parsed.starredOnly && !email.isStarred { return false }
        if let sender = parsed.sender, !email.fromAddress.lowercased().contains(sender) { return false }
        if let category = parsed.category, categoryEngine.classify(email, ruleEngine: ruleEngine) != category { return false }
        let normalized = clean.lowercased()
        return email.searchableSnippet.lowercased().contains(normalized)
            || email.fromAddress.lowercased().contains(normalized)
            || email.fromName.lowercased().contains(normalized)
            || email.displaySubject.lowercased().contains(normalized)
            || parsed.sender != nil
            || parsed.category != nil
            || parsed.unreadOnly
            || parsed.starredOnly
    }
}

final class OptionalReadReceiptManager: ObservableObject {
    private let enabledKey = "mailos_v2_read_receipts_enabled"
    private let noticeKey = "mailos_v2_read_receipts_notice_ack"

    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: enabledKey)
            objectWillChange.send()
        }
    }

    var noticeAcknowledged: Bool {
        get { UserDefaults.standard.bool(forKey: noticeKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: noticeKey)
            objectWillChange.send()
        }
    }
}

struct ComposeRecipientAutocomplete: View {
    let suggestions: [ContactSuggestion]
    let select: (ContactSuggestion) -> Void

    var body: some View {
        if !suggestions.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions.prefix(8)) { suggestion in
                        Button {
                            select(suggestion)
                        } label: {
                            Label(suggestion.name, systemImage: "person.crop.circle")
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("compose-recipient-autocomplete-\(suggestion.email)")
                    }
                }
                .padding(.vertical, 2)
            }
            .accessibilityIdentifier("compose-recipient-autocomplete")
        }
    }
}

@MainActor
final class UndoSendQueue: ObservableObject {
    @Published private(set) var pendingSubject: String?
    private var task: Task<Void, Never>?

    func queue(
        app: AppState,
        from: MailAddress,
        to: String,
        cc: String,
        bcc: String,
        subject: String,
        body: String,
        attachments: [LocalAttachmentDraft],
        draftId: UUID?,
        completion: @escaping (Bool) -> Void
    ) {
        task?.cancel()
        pendingSubject = subject.isEmpty ? "(No subject)" : subject
        task = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            pendingSubject = nil
            let ok = await app.send(
                from: from,
                to: to,
                cc: cc,
                bcc: bcc,
                subject: subject,
                body: body,
                attachments: attachments,
                draftId: draftId
            )
            completion(ok)
        }
    }

    func undo(app: AppState, from: MailAddress, to: String, cc: String, bcc: String, subject: String, body: String, attachments: [LocalAttachmentDraft], draftId: UUID?) {
        task?.cancel()
        task = nil
        pendingSubject = nil
        app.saveDraft(id: draftId, fromEmail: from.email, to: to, cc: cc, bcc: bcc, subject: subject, body: body, attachments: attachments)
    }
}
