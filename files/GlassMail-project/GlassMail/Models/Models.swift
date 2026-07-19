//
//  Models.swift
//  GlassMail
//
//  Codable types that mirror the cloud-mail backend (Hono worker) responses,
//  plus a few app-side value types.
//
//  Backend response envelope is always: { code: Int, message: String, data: T? }
//

import Foundation

struct ConversationProjection: Codable, Identifiable, Hashable {
    let id: String
    let conversationId: String
    let projectionVersion: Int
    let aggregateVersion: Int
    let title: String
    let preview: String
    let lastObservedAt: String?
    let messageCount: Int
    let unreadCount: Int
    let hasAttachments: Bool
    let membershipKeys: [String]
    let categoryKeys: [String]
    let facets: [String: [ConversationFacetValue]]
    let activeCommitmentIds: [String]
    let commitmentStates: [String]
    let actionRequired: Bool
    let waitingForMe: Bool
    let waitingForOthers: Bool
    let missionIds: [String]
    let rankingScore: Double
    let riskKey: String
    let canonicalFolderKey: String
    let sourceNavigation: [ConversationSourceNavigation]
    let searchDocument: String
}

struct ConversationFacetValue: Codable, Hashable {
    let value: String
    let confidence: Double
    let explanation: String
}

struct ConversationSourceNavigation: Codable, Hashable {
    let provider: String?
    let accountId: Int?
    let messageId: Int?
}

enum ConversationProjectionSurface: String, Codable, CaseIterable, Hashable {
    case allMail = "all_mail"
    case categories
    case actionRequired = "action_required"
    case waitingForMe = "waiting_for_me"
    case waitingForOthers = "waiting_for_others"
    case missionControl = "mission_control"
}

enum ConversationProjectionAuthority: String, Codable, Hashable {
    case disabled
    case shadow
    case authoritative
}

struct ConversationProjectionRead: Hashable {
    let surface: ConversationProjectionSurface
    let authority: ConversationProjectionAuthority
    let cutoverEpoch: String?
    let projections: [ConversationProjection]
    let nextCursor: String?
}

struct ConversationProjectionPayload: Decodable {
    let authorityMode: ConversationProjectionAuthority
    let cutoverEpoch: String?
    let rows: [ConversationProjection]
    let nextCursor: String?
}

struct ConversationProjectionDetail: Decodable {
    let projection: ConversationProjection
    let messages: [ConversationProjectionMessage]
}

struct ConversationProjectionMessage: Decodable, Identifiable, Hashable {
    var id: Int { messageId }
    let messageId: Int
    let accountId: Int
    let providerKey: String
    let subject: String
    let sender: String
    let recipients: String
    let body: String
    let observedAt: String
    let stateVersion: Int
    let folderKey: String
}

struct SenderBulkDestinationContract: Decodable, Hashable {
    let contractVersion: String
    let normalizedSender: String
    let senderMatching: String
    let accountScope: [Int]
    let affectedConversationCount: Int
    let futureMessageBehavior: String
    let sections: [SenderBulkDestinationSection]
}

struct SenderBulkDestinationSection: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let titleZh: String
    let destinations: [SenderBulkDestination]
}

struct SenderBulkDestination: Decodable, Hashable, Identifiable {
    let id: String
    let type: String
    let key: String
    let icon: String
    let title: String
    let titleZh: String
    let enabled: Bool
    let disabledReason: String?
    let reversible: Bool
    let requiresConfirmation: Bool?
    let providerEffect: String
}

struct SenderBulkPreview: Decodable, Hashable {
    let normalizedSender: String
    let accountScope: [Int]
    let affectedConversationCount: Int
    let futureMessageBehavior: String
    let destination: SenderBulkDestination
    let requiresConfirmation: Bool
    let scopeDiagnostics: SenderBulkScopeDiagnostics?
}

struct SenderBulkScopeDiagnostics: Decodable, Hashable {
    let originalAuthorizedScope: Int
    let currentlyEligibleScope: Int
    let alreadyCorrectlyInDestination: Int
}

struct SenderBulkExecutionResult: Decodable, Hashable {
    let operationId: String
    let missionId: String
    let actionId: String
    let outcomeId: String
    let state: String
    let normalizedSender: String
    let accountScope: [Int]
    let destination: SenderBulkExecutionDestination
    let futureMessageBehavior: String
    let total: Int
    let completed: Int
    let failed: Int
    let projectionIds: [String]
}

struct SenderBulkExecutionDestination: Decodable, Hashable {
    let type: String
    let key: String
}

// MARK: - Generic API envelope

struct APIEnvelope<T: Decodable>: Decodable {
    let code: Int
    let message: String?
    let data: T?

    private enum CodingKeys: String, CodingKey { case code, message, error, data }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let integer = try? container.decode(Int.self, forKey: .code) {
            code = integer
        } else if let string = try? container.decode(String.self, forKey: .code), let integer = Int(string) {
            code = integer
        } else {
            // Preserve an ordinary API failure instead of surfacing it as a
            // misleading "could not read one mail item" decoding failure.
            code = 500
        }
        message = (try? container.decode(String.self, forKey: .message))
            ?? (try? container.decode(String.self, forKey: .error))
        data = try? container.decodeIfPresent(T.self, forKey: .data)
    }
}

/// Thrown when the backend returns a non-200 `code` or a transport problem occurs.
struct APIError: LocalizedError {
    let code: Int
    let message: String
    var errorDescription: String? { message }
    var isCancellation: Bool {
        if code == NSURLErrorCancelled { return true }
        let lowercased = message.lowercased()
        return lowercased.contains("cancellationerror")
            || lowercased.contains("cancelled")
            || lowercased.contains("canceled")
    }
    var userMessage: String {
        if let safe = ProductSafeText.replacement(for: message, context: .general) {
            return safe
        }
        let lowercased = message.lowercased()
        if lowercased.contains("could not read the server response")
            || lowercased.contains("data couldn") {
            return "NEXORA could not read that response. Refresh and try again."
        }
        if lowercased.contains("invalid credentials")
            || lowercased.contains("authentication failed")
            || lowercased.contains("login failed")
            || lowercased.contains("imap command failed")
            || lowercased.contains("gmail app password") {
            return "Gmail authorization failed. Continue with Google and try again."
        }
        if lowercased.contains("account.email") {
            return "This mailbox is already attached to a NEXORA account. Sign in to the account that owns it, ask a workspace admin to disconnect or reassign it, or use a different mailbox."
        }
        if lowercased.contains("unique constraint failed") {
            return "This NEXORA account already exists. Use Sign in instead of creating a new account."
        }
        if lowercased.contains("d1_error") || lowercased.contains("sqlite_constraint") {
            return "NEXORA could not complete that request. Check whether this is a sign-in or new-account action and try again."
        }
        return message
    }

    static func transport(_ underlying: Error) -> APIError {
        if underlying.isCloudMailCancellation {
            return APIError(code: NSURLErrorCancelled, message: "Request cancelled")
        }
        return APIError(code: -1, message: underlying.localizedDescription)
    }
    static let notConfigured = APIError(code: -2, message: "Server is not configured yet.")
    static let unauthorized = APIError(code: 401, message: "Session expired. Please sign in again.")
}

enum ProductSafeText {
    enum Context {
        case general
        case ai
        case preview
        case outbox
        case attachmentStatus
        case compose
    }

    static func replacement(for value: String, context: Context) -> String? {
        let lowercased = value.lowercased()
        if isContextLimitMessage(value) {
            switch context {
            case .preview:
                return "AI summary unavailable for this message."
            case .compose:
                return "This request is too long for local AI. Try again with a shorter prompt."
            default:
                return "This conversation is too long to summarize locally."
            }
        }
        if isModelRefusalMessage(value) {
            switch context {
            case .compose:
                return "AI could not draft from this content. Try a shorter prompt or write the reply manually."
            case .preview:
                return "AI summary unavailable for this message."
            case .ai:
                return "AI could not generate a useful answer for this request. Try again with a narrower prompt."
            default:
                return "AI could not complete that request. Try again with a narrower prompt."
            }
        }
        if lowercased.contains("receiveemail.every is not a function")
            || lowercased.contains("receiveemail") && lowercased.contains("is not a function") {
            switch context {
            case .preview:
                return "Recipient details need review before sending."
            default:
                return "NEXORA could not send this message because an older recipient format was saved. Review recipients and try again."
            }
        }
        if lowercased.contains("attachment sending is not enabled by the backend yet")
            || lowercased.contains("backend attachment sending is not enabled") {
            switch context {
            case .preview:
                return "Attachment send is waiting in Outbox."
            case .outbox, .attachmentStatus:
                return "Attachment send did not complete. The message is saved in Drafts and Outbox."
            default:
                return "Attachment send did not complete. The message is saved safely."
            }
        }
        if lowercased.contains("typeerror:")
            || lowercased.contains("referenceerror:")
            || lowercased.contains("syntaxerror:")
            || lowercased.contains("stack trace")
            || lowercased.contains("undefined is not a function") {
            return "NEXORA could not complete that action. Review the message and try again."
        }
        return nil
    }

    static func isContextLimitMessage(_ value: String) -> Bool {
        let lowercased = value.lowercased()
        return lowercased.contains("the session's transcript exceeded the model's context size")
            || lowercased.contains("transcript exceeded")
            || lowercased.contains("context size")
            || lowercased.contains("context length")
            || lowercased.contains("too many tokens")
            || lowercased.contains("maximum context")
            || lowercased.contains("too long to summarize locally")
    }

    static func isModelRefusalMessage(_ value: String) -> Bool {
        let lowercased = value.lowercased()
        return lowercased.contains("the model refused to answer")
            || lowercased.contains("model refused")
            || lowercased.contains("refused to answer")
            || lowercased.contains("i can't assist with that")
            || lowercased.contains("i cannot assist with that")
            || lowercased.contains("i can’t assist with that")
            || lowercased.contains("i’m sorry, but i can’t")
            || lowercased.contains("i'm sorry, but i can't")
    }

    static func sanitize(_ value: String, context: Context) -> String {
        if let replacement = replacement(for: value, context: context) {
            return replacement
        }
        return value
    }

    static func sanitizeOptional(_ value: String?, context: Context) -> String? {
        guard let value else { return nil }
        return sanitize(value, context: context)
    }
}

extension Error {
    var isCloudMailCancellation: Bool {
        if self is CancellationError { return true }
        if let urlError = self as? URLError, urlError.code == .cancelled { return true }
        if let api = self as? APIError { return api.isCancellation }
        let nsError = self as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return true }
        let lowercased = localizedDescription.lowercased()
        return lowercased.contains("cancellationerror")
            || lowercased.contains("swift.cancellationerror")
    }
}

// MARK: - Auth

struct LoginPayload: Encodable {
    let email: String
    let password: String
}

struct TokenData: Decodable {
    let token: String
}

struct LoginUserInfo: Decodable {
    let userId: Int?
    let email: String?
    let username: String?
    let name: String?
    let type: Int?

    var displayName: String {
        name ?? username ?? email ?? "Me"
    }
}

// MARK: - Address (cloud-mail "account" = a receiving address attached to a user)

struct MailAddress: Codable, Identifiable, Hashable {
    let accountId: Int
    let email: String
    let name: String?
    let latestEmailTime: String?
    let allReceive: Int?
    let provider: UnifiedMailProvider?
    let domain: String?
    let syncStatus: String?
    let lastSyncedAt: String?
    let syncError: String?
    let lastSyncAttemptAt: String?
    let lastSuccessfulSyncAt: String?
    let lastMessageReceivedAt: String?
    let lastProviderCheckpointAt: String?
    let lastSyncFailureAt: String?
    let syncFailureReason: String?

    var id: Int { accountId }
    var displayName: String { (name?.isEmpty == false ? name! : email) }
    var displayProvider: UnifiedMailProvider { provider ?? .custom }
    var displayDomain: String { (domain?.isEmpty == false ? domain! : email.split(separator: "@").last.map(String.init) ?? "") }
    var statusLabel: String {
        switch syncStatus ?? "connected" {
        case "connected": return "Connected"
        case "available": return "Available"
        case "blocked": return "Blocked"
        case "not_available": return "Not Available"
        case "error": return "Sync Error"
        case "needs_reconnect", "legacy_imap_unsupported": return "Reconnect Required"
        case "first_import_failed": return "Import Recovery Required"
        case "authorized_identity_mismatch": return "Google Identity Mismatch"
        case "provider_mailbox_unavailable": return "Gmail Mailbox Unavailable"
        case "sync_required": return "Sync Required"
        case "mailbox_ready": return "Connected"
        default: return "Connected"
        }
    }
}

// MARK: - Email message (cloud-mail "email" entity)

struct EmailMessage: Codable, Identifiable, Hashable {
    let emailId: Int
    let sendEmail: String?      // from address
    let name: String?           // from display name
    let subject: String?
    let text: String?           // plaintext body
    let content: String?        // HTML body
    let toEmail: String?
    let toName: String?
    let accountId: Int?
    let type: Int?              // 0 = received, 1 = sent (cloud-mail convention)
    var unread: Int?            // 1 = unread (mutable so the UI can flip read state)
    let createTime: String?
    var isStar: Int?
    let provider: UnifiedMailProvider?
    let accountEmail: String?
    let accountDomain: String?
    let threadId: String?
    let externalMessageId: String?
    let attachmentCount: Int?
    let attachments: [EmailAttachment]?
    let attList: [EmailAttachment]?
    let cc: String?
    let bcc: String?
    var semanticCategory: String? = nil
    var isPriority: Bool? = nil
    var isVip: Bool? = nil
    var junkDisposition: String? = nil
    var stateVersion: Int? = nil
    var canonicalWorkspaceId: Int? = nil
    var canonicalStateMode: String? = nil
    var folderKey: String? = nil

    struct RecipientObj: Codable {
        let address: String
        let name: String?
    }

    var ccRecipients: String {
        guard let cc, !cc.isEmpty, cc != "[]" else { return "" }
        guard let data = cc.data(using: .utf8),
              let list = try? JSONDecoder().decode([RecipientObj].self, from: data) else {
            return ""
        }
        return list.map { $0.address }.joined(separator: ", ")
    }

    var bccRecipients: String {
        guard let bcc, !bcc.isEmpty, bcc != "[]" else { return "" }
        guard let data = bcc.data(using: .utf8),
              let list = try? JSONDecoder().decode([RecipientObj].self, from: data) else {
            return ""
        }
        return list.map { $0.address }.joined(separator: ", ")
    }

    var id: Int { emailId }

    var fromName: String {
        if let n = name, !n.isEmpty { return n }
        return sendEmail ?? "Unknown sender"
    }
    var fromAddress: String { sendEmail ?? "" }
    var displaySubject: String { (subject?.isEmpty == false) ? subject! : "(no subject)" }
    var isUnread: Bool { (unread ?? 0) == 1 }
    var isStarred: Bool { (isStar ?? 0) == 1 }
    var sourceProvider: UnifiedMailProvider { provider ?? .custom }
    var sourceAccount: String { (accountEmail?.isEmpty == false ? accountEmail! : toEmail) ?? "" }
    var sourceDomain: String {
        if let accountDomain, !accountDomain.isEmpty { return accountDomain }
        return sourceAccount.split(separator: "@").last.map(String.init) ?? ""
    }
    var sourceThreadID: String { (threadId?.isEmpty == false ? threadId! : externalMessageId) ?? "" }
    var visibleAttachments: [EmailAttachment] {
        if let attachments, !attachments.isEmpty { return attachments }
        return attList ?? []
    }
    var attachmentSignalCount: Int {
        max(attachmentCount ?? 0, max(attachments?.count ?? 0, attList?.count ?? 0))
    }

    /// Best-effort plaintext for AI processing and previews.
    var plainBody: String {
        if let t = text, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return t
        }
        if let html = content {
            return EmailMessage.stripHTML(html)
        }
        return ""
    }

    func lightweightBodySnippet(maxCharacters: Int = 900) -> String {
        let source: String
        if let t = text, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            source = String(t.prefix(maxCharacters))
        } else if let html = content {
            source = EmailMessage.stripHTML(String(html.prefix(maxCharacters)))
        } else {
            source = ""
        }
        return ProductSafeText.sanitize(source, context: .preview)
    }

    var searchableSnippet: String {
        [displaySubject, lightweightBodySnippet()]
            .joined(separator: " ")
            .lowercased()
    }

    var preview: String {
        let body = lightweightBodySnippet(maxCharacters: 700)
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
        let collapsed = body.split(separator: " ").joined(separator: " ")
        return String(collapsed.prefix(140))
    }

    var date: Date? { EmailMessage.parseDate(createTime) }

    func sanitizedForDisplayStorage() -> EmailMessage {
        EmailMessage(
            emailId: emailId,
            sendEmail: ProductSafeText.sanitizeOptional(sendEmail, context: .preview),
            name: ProductSafeText.sanitizeOptional(name, context: .preview),
            subject: ProductSafeText.sanitizeOptional(subject, context: .preview),
            text: ProductSafeText.sanitizeOptional(text, context: .preview),
            content: ProductSafeText.sanitizeOptional(content, context: .preview),
            toEmail: ProductSafeText.sanitizeOptional(toEmail, context: .compose),
            toName: ProductSafeText.sanitizeOptional(toName, context: .preview),
            accountId: accountId,
            type: type,
            unread: unread,
            createTime: createTime,
            isStar: isStar,
            provider: provider,
            accountEmail: accountEmail,
            accountDomain: accountDomain,
            threadId: threadId,
            externalMessageId: externalMessageId,
            attachmentCount: attachmentCount,
            attachments: attachments,
            attList: attList,
            cc: ProductSafeText.sanitizeOptional(cc, context: .compose),
            bcc: ProductSafeText.sanitizeOptional(bcc, context: .compose)
        )
    }

    // MARK: helpers

    static func stripHTML(_ html: String) -> String {
        var s = decodeHTMLEntities(html)
        for tag in ["head", "style", "script", "svg", "noscript"] {
            s = s.replacingOccurrences(
                of: "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)>",
                with: " ",
                options: [.regularExpression, .caseInsensitive])
        }
        s = s.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        s = removeCSSFragments(s)
        s = markdownLinksToReadableText(s)
        s = s.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "( ?\\n ?)+", with: "\n", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func decodeHTMLEntities(_ value: String) -> String {
        var s = value
        for _ in 0..<2 {
            let before = s
            s = s.replacingOccurrences(of: "&nbsp;", with: " ")
                .replacingOccurrences(of: "&#160;", with: " ")
                .replacingOccurrences(of: "&amp;", with: "&")
                .replacingOccurrences(of: "&lt;", with: "<")
                .replacingOccurrences(of: "&gt;", with: ">")
                .replacingOccurrences(of: "&quot;", with: "\"")
                .replacingOccurrences(of: "&#39;", with: "'")
                .replacingOccurrences(of: "&apos;", with: "'")
            if s == before { break }
        }
        return s
    }

    static func markdownLinksToReadableText(_ value: String) -> String {
        value.replacingOccurrences(
            of: "\\[([^\\]]+)\\]\\((https?://[^\\s)]+)\\)",
            with: "$1 ($2)",
            options: [.regularExpression]
        )
    }

    private static func removeCSSFragments(_ value: String) -> String {
        var s = value
        s = s.replacingOccurrences(of: "@media[\\s\\S]*?\\}", with: " ", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: "[.#]?[A-Za-z0-9_-]+\\s*\\{[^}]*\\}", with: " ", options: [.regularExpression])
        s = s.replacingOccurrences(
            of: "(font-family|font-size|line-height|background|color|margin|padding|border|display|width|height)\\s*:\\s*[^;\\n]+;?",
            with: " ",
            options: [.regularExpression, .caseInsensitive]
        )
        return s
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let sqlFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let d = isoFormatter.date(from: raw) { return clampFutureDate(d) }
        if let d = sqlFormatter.date(from: raw) { return clampFutureDate(d) }
        // try without fractional seconds
        let iso = ISO8601DateFormatter()
        return iso.date(from: raw).map { clampFutureDate($0) }
    }

    static func clampFutureDate(_ date: Date, now: Date = Date(), allowedSkew: TimeInterval = 120) -> Date {
        let maximum = now.addingTimeInterval(allowedSkew)
        return date > maximum ? maximum : date
    }
}

struct WorkspaceSummary: Decodable, Identifiable {
    let id: Int
    let displayName: String
    let role: String
}

struct WorkspaceResolution: Decodable {
    let defaultWorkspaceId: Int
    let workspaces: [WorkspaceSummary]
}

enum CanonicalMutationValue: Encodable {
    case bool(Bool)
    case string(String)
    case strings([String])

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .bool(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .strings(let value): try container.encode(value)
        }
    }
}

struct CanonicalMutationTarget: Encodable {
    let accountId: Int
    let messageId: Int
    let providerMessageId: String
    let conversationId: String

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case messageId = "message_id"
        case providerMessageId = "provider_message_id"
        case conversationId = "conversation_id"
    }
}

struct CanonicalMutationReceipt: Decodable {
    let mutationId: String
    let action: String
    let previousVersion: Int
    let stateVersion: Int
    let status: String
    let reasonCode: String
    let auditReference: String
    let cacheInvalidationKey: String
    let idempotent: Bool
}

/// Authoritative, privacy-safe state used only to reconcile a stale local
/// version before one bounded retry of a user-requested action.
struct CanonicalMailState: Decodable {
    let stateVersion: Int
    let folderKey: String
    let semanticCategory: String
    let isRead: Int
    let isPriority: Int
    let isVip: Int
    let junkDisposition: String
    let isStarred: Int

    // State rows created before later canonical columns existed can contain
    // NULL values. Reconciliation must remain readable for those rows and use
    // the same safe defaults as the server's first-write state.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        stateVersion = try container.decodeIfPresent(Int.self, forKey: .stateVersion) ?? 1
        folderKey = try container.decodeIfPresent(String.self, forKey: .folderKey) ?? "inbox"
        semanticCategory = try container.decodeIfPresent(String.self, forKey: .semanticCategory) ?? "general"
        isRead = try container.decodeIfPresent(Int.self, forKey: .isRead) ?? 0
        isPriority = try container.decodeIfPresent(Int.self, forKey: .isPriority) ?? 0
        isVip = try container.decodeIfPresent(Int.self, forKey: .isVip) ?? 0
        junkDisposition = try container.decodeIfPresent(String.self, forKey: .junkDisposition) ?? "not_junk"
        isStarred = try container.decodeIfPresent(Int.self, forKey: .isStarred) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case stateVersion, folderKey, semanticCategory, isRead, isPriority, isVip, junkDisposition, isStarred
    }
}

struct LocalEvidencePolicyResult: Decodable {
    let id: String
    let policyDecisionId: String
    let validationState: String
    let decisionState: String
    let category: String
    let isPriority: Bool
    let validUntil: String
    let contentDigest: String
    let idempotent: Bool
}

// MARK: - Unified mail visibility

struct MailVisibilityTrace: Codable, Equatable {
    var apiCount: Int = 0
    var decodedCount: Int = 0
    var overlayCount: Int = 0
    var scopedCount: Int = 0
    var folderCount: Int = 0
    var filterCount: Int = 0
    var renderedCount: Int = 0
    var firstDrop: String = "Not measured"
    var recordedAt: Date = .distantPast
    static let empty = MailVisibilityTrace()
}

struct MailVisibilitySelection {
    let accountId: Int?
    let provider: UnifiedMailProvider?
    let mailbox: LocalMailBoxKind
    let filterRawValue: String
    let query: String
    let mergedAllMail: Bool
}

struct MailVisibilityResult {
    let emails: [EmailMessage]
    let trace: MailVisibilityTrace
}

enum MailVisibilityEngine {
    static func render(emails: [EmailMessage], selection: MailVisibilitySelection, effectiveFolder: (EmailMessage) -> LocalMailBoxKind, isSnoozed: (EmailMessage) -> Bool, matchesFolder: (EmailMessage) -> Bool, matchesFilter: (EmailMessage, String) -> Bool, matchesSearch: (EmailMessage, String) -> Bool) -> MailVisibilityResult {
        let scoped = emails.filter { email in
            (selection.accountId != nil || selection.provider == nil || email.sourceProvider == selection.provider)
                && (selection.accountId == nil || email.accountId == selection.accountId)
        }
        let folderScoped = scoped.filter { email in
            !(selection.mailbox == .inbox && isSnoozed(email)) && matchesFolder(email)
        }
        let chipScoped = folderScoped.filter { matchesFilter($0, selection.filterRawValue) }
        let searched = selection.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? chipScoped : folderScoped.filter { matchesSearch($0, selection.query) }
        let sorted = searched.sorted {
            let left = $0.date ?? Date(timeIntervalSince1970: TimeInterval($0.emailId))
            let right = $1.date ?? Date(timeIntervalSince1970: TimeInterval($1.emailId))
            return left == right ? $0.emailId > $1.emailId : left > right
        }
        let drop: String
        if emails.isEmpty { drop = "API returned no messages" }
        else if scoped.isEmpty { drop = "Account or provider scope" }
        else if folderScoped.isEmpty { drop = "Folder scope" }
        else if chipScoped.isEmpty { drop = "Dashboard filter" }
        else if sorted.isEmpty { drop = "Search filter" }
        else { drop = "No drop" }
        return MailVisibilityResult(emails: sorted, trace: MailVisibilityTrace(apiCount: emails.count, decodedCount: emails.count, overlayCount: emails.count, scopedCount: scoped.count, folderCount: folderScoped.count, filterCount: chipScoped.count, renderedCount: sorted.count, firstDrop: drop, recordedAt: Date()))
    }
}

struct LossyDecodableArray<Element: Decodable>: Decodable {
    struct Item: Decodable {
        let value: Element?

        init(from decoder: Decoder) throws {
            value = try? Element(from: decoder)
        }
    }

    let values: [Element]
    let skipped: Int

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var decoded: [Element] = []
        var skippedCount = 0
        while !container.isAtEnd {
            let item = try container.decode(Item.self)
            if let value = item.value {
                decoded.append(value)
            } else {
                skippedCount += 1
            }
        }
        values = decoded
        skipped = skippedCount
    }
}

struct EmailAttachment: Codable, Identifiable, Hashable {
    let id: Int
    let filename: String
    let contentType: String
    let byteSize: Int?
    let downloadURL: String?

    enum CodingKeys: String, CodingKey {
        case id
        case attId
        case attachmentId
        case filename
        case fileName
        case name
        case contentType
        case mimeType
        case type
        case byteSize
        case size
        case downloadURL
        case downloadUrl
        case url
    }

    init(id: Int, filename: String, contentType: String, byteSize: Int?, downloadURL: String?) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.byteSize = byteSize
        self.downloadURL = downloadURL
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(Int.self, forKey: .id))
            ?? (try? c.decode(Int.self, forKey: .attId))
            ?? (try? c.decode(Int.self, forKey: .attachmentId))
            ?? abs(((try? c.decode(String.self, forKey: .filename)) ?? UUID().uuidString).hashValue)
        filename = (try? c.decode(String.self, forKey: .filename))
            ?? (try? c.decode(String.self, forKey: .fileName))
            ?? (try? c.decode(String.self, forKey: .name))
            ?? "Attachment"
        contentType = (try? c.decode(String.self, forKey: .contentType))
            ?? (try? c.decode(String.self, forKey: .mimeType))
            ?? (try? c.decode(String.self, forKey: .type))
            ?? "Attachment"
        byteSize = (try? c.decode(Int.self, forKey: .byteSize))
            ?? (try? c.decode(Int.self, forKey: .size))
        downloadURL = (try? c.decode(String.self, forKey: .downloadURL))
            ?? (try? c.decode(String.self, forKey: .downloadUrl))
            ?? (try? c.decode(String.self, forKey: .url))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(filename, forKey: .filename)
        try c.encode(contentType, forKey: .contentType)
        try c.encodeIfPresent(byteSize, forKey: .byteSize)
        try c.encodeIfPresent(downloadURL, forKey: .downloadURL)
    }

    var sizeLabel: String {
        guard let byteSize else { return "Size unavailable" }
        return ByteCountFormatter.string(fromByteCount: Int64(byteSize), countStyle: .file)
    }
}

// MARK: - Send

struct SendEmailForm: Encodable {
    let accountId: Int
    let sendEmail: String      // the "from" address (one of the user's addresses)
    let name: String?          // from display name
    let receiveEmail: [String] // recipients
    let cc: [String]
    let bcc: [String]
    let subject: String
    let content: String        // HTML body
    let text: String           // plaintext body
    let attachments: [SendAttachmentMetadata]
    let scheduledAt: String?
    let draftId: String?
    let replyToEmailId: Int?
    let signatureApplied: Bool
    let sourceProvider: String
    let idempotencyKey: String
}

enum DeliveryState: String, Codable, Hashable {
    case draft
    case queued
    case preparing
    case validating
    case uploadingAttachment = "uploading_attachment"
    case sending
    case providerAccepted = "provider_accepted"
    case providerConfirmed = "provider_confirmed"
    case delivered
    case retryScheduled = "retry_scheduled"
    case sent
    case failed
    case failedPermanent = "failed_permanent"
    case bounced
    case dead
    case cancelled
}

extension DeliveryState {
    var acceptedByProviderForSendUX: Bool {
        switch self {
        case .providerAccepted, .providerConfirmed, .delivered, .sent:
            return true
        case .draft, .queued, .preparing, .validating, .uploadingAttachment, .sending, .retryScheduled, .failed, .failedPermanent, .bounced, .dead, .cancelled:
            return false
        }
    }

    var preservesDeliveryConfirmationBoundary: Bool {
        self == .providerAccepted
    }
}

struct SendEmailResult: Decodable, Hashable {
    let state: DeliveryState
    let providerMessageId: String?
    let outboundId: Int?
    let emailId: Int?
    let queuedForRetry: Bool

    enum CodingKeys: String, CodingKey {
        case status
        case providerMessageId
        case externalMessageId
        case outboundId
        case emailId
        case queuedForRetry
        case resendEmailId
    }

    init(state: DeliveryState,
         providerMessageId: String? = nil,
         outboundId: Int? = nil,
         emailId: Int? = nil,
         queuedForRetry: Bool = false) {
        self.state = state
        self.providerMessageId = providerMessageId
        self.outboundId = outboundId
        self.emailId = emailId
        self.queuedForRetry = queuedForRetry
    }

    init(from decoder: Decoder) throws {
        if var array = try? decoder.unkeyedContainer() {
            if let first = try? array.decode(SendEmailResult.self) {
                self = first
            } else {
                self = SendEmailResult(state: .failedPermanent)
            }
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let retry = (try? c.decode(Bool.self, forKey: .queuedForRetry)) ?? false
        let rawStatus = (try? c.decode(Int.self, forKey: .status)) ?? -1
        let external = (try? c.decodeIfPresent(String.self, forKey: .externalMessageId))
            ?? (try? c.decodeIfPresent(String.self, forKey: .providerMessageId))
            ?? (try? c.decodeIfPresent(String.self, forKey: .resendEmailId))
        let id = (try? c.decodeIfPresent(Int.self, forKey: .emailId)) ?? nil
        let outbound = (try? c.decodeIfPresent(Int.self, forKey: .outboundId)) ?? nil
        let mappedState: DeliveryState
        if retry {
            mappedState = .retryScheduled
        } else if rawStatus == 2 {
            mappedState = .delivered
        } else if rawStatus == 1 {
            mappedState = .providerAccepted
        } else if external?.isEmpty == false || id != nil {
            mappedState = .providerAccepted
        } else {
            mappedState = .failedPermanent
        }
        state = mappedState
        providerMessageId = external
        outboundId = outbound
        emailId = id
        queuedForRetry = retry
    }
}

struct SendAttachmentMetadata: Codable, Hashable {
    let filename: String
    let content: String?
    let contentType: String?
    let type: String?

    init(filename: String, content: String? = nil, contentType: String? = nil, type: String? = nil) {
        self.filename = filename
        self.content = content
        self.contentType = contentType
        self.type = type
    }
}

struct LocalAttachmentDraft: Codable, Identifiable, Hashable {
    var id: UUID
    var filename: String
    var mimeType: String
    var byteSize: Int
    var contentBase64: String

    var hasPayload: Bool {
        !contentBase64.isEmpty && byteSize > 0
    }

    var sizeLabel: String {
        ByteCountFormatter.string(fromByteCount: Int64(byteSize), countStyle: .file)
    }

    var sendMetadata: SendAttachmentMetadata {
        SendAttachmentMetadata(
            filename: filename,
            content: contentBase64,
            contentType: mimeType,
            type: mimeType
        )
    }

    init(id: UUID = UUID(), filename: String, mimeType: String, byteSize: Int, contentBase64: String) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.byteSize = byteSize
        self.contentBase64 = contentBase64
    }

    static func legacyFilenameOnly(_ filename: String) -> LocalAttachmentDraft {
        LocalAttachmentDraft(filename: filename, mimeType: "application/octet-stream", byteSize: 0, contentBase64: "")
    }
}

enum LocalMailBoxKind: String, Codable, CaseIterable, Identifiable {
    case inbox
    case needsReply
    case todo
    case followUp
    case important
    case starred
    case junk
    case trash
    case drafts
    case sent
    case outbox
    case scheduled
    case done
    case snoozed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .inbox: return "Inbox"
        case .needsReply: return "Needs Reply"
        case .todo: return "To-do"
        case .followUp: return "Follow-up"
        case .important: return "Important"
        case .starred: return "Starred"
        case .junk: return "Junk"
        case .trash: return "Trash"
        case .drafts: return "Drafts"
        case .sent: return "Sent"
        case .outbox: return "Outbox"
        case .scheduled: return "Scheduled"
        case .done: return "Done"
        case .snoozed: return "Snoozed"
        }
    }

    var symbol: String {
        switch self {
        case .inbox: return "tray.fill"
        case .needsReply: return "arrowshape.turn.up.left.fill"
        case .todo: return "checklist"
        case .followUp: return "arrowshape.turn.up.right.fill"
        case .important: return "exclamationmark.circle.fill"
        case .starred: return "star.fill"
        case .junk: return "exclamationmark.octagon.fill"
        case .trash: return "trash.fill"
        case .drafts: return "doc.text.fill"
        case .sent: return "paperplane.fill"
        case .outbox: return "tray.and.arrow.up.fill"
        case .scheduled: return "clock.badge.checkmark.fill"
        case .done: return "checkmark.circle.fill"
        case .snoozed: return "clock.arrow.circlepath"
        }
    }
}

struct SendingIdentity: Codable, Identifiable, Hashable {
    let accountId: Int
    let email: String
    let provider: UnifiedMailProvider
    let domain: String
    var canSend: Bool
    var sendStatusReason: String
    var defaultSignature: String

    var id: Int { accountId }
    var statusLine: String {
        "\(provider.title) · \(domain) · \(canSend ? "Can send" : sendStatusReason)"
    }
}

struct MailSignature: Codable, Identifiable, Hashable {
    var email: String
    var body: String
    var updatedAt: Date

    var id: String { email.lowercased() }
}

struct LocalMailDraft: Codable, Identifiable, Hashable {
    var id: UUID
    var fromEmail: String
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var body: String
    var attachments: [LocalAttachmentDraft]?
    var attachmentNames: [String]?
    var updatedAt: Date

    var displayAttachmentNames: [String]? {
        if let attachments, !attachments.isEmpty {
            return attachments.map(\.filename)
        }
        return attachmentNames
    }

    var effectiveAttachments: [LocalAttachmentDraft] {
        if let attachments { return attachments }
        return (attachmentNames ?? []).map(LocalAttachmentDraft.legacyFilenameOnly)
    }
}

struct LocalSentMessage: Codable, Identifiable, Hashable {
    var id: UUID
    var fromEmail: String
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var bodyPreview: String
    var attachments: [LocalAttachmentDraft]?
    var attachmentNames: [String]?
    var sentAt: Date
    var backendAccepted: Bool
    var deliveryState: DeliveryState? = nil
    var providerMessageId: String? = nil
    var outboundId: Int? = nil
}

struct LocalOutboxMessage: Codable, Identifiable, Hashable {
    var id: UUID
    var fromEmail: String
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var body: String
    var attachments: [LocalAttachmentDraft]?
    var attachmentNames: [String]?
    var lastError: String
    var updatedAt: Date
    var deliveryState: DeliveryState? = nil
    var outboundId: Int? = nil
}

struct LocalScheduledMessage: Codable, Identifiable, Hashable {
    var id: UUID
    var fromEmail: String
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var body: String
    var attachments: [LocalAttachmentDraft]?
    var attachmentNames: [String]?
    var scheduledAt: Date
    var status: String
}

struct MailStateOverlay: Codable, Equatable {
    var readEmailIds: Set<Int> = []
    var unreadEmailIds: Set<Int> = []
    var starredEmailIds: Set<Int> = []
    var unstarredEmailIds: Set<Int> = []
    var folderByEmailId: [Int: LocalMailBoxKind] = [:]
    var deletedEmailIds: Set<Int> = []

    static let empty = MailStateOverlay()
}

struct MailUndoState: Identifiable, Equatable {
    let id = UUID()
    let email: EmailMessage
    let previousFolder: LocalMailBoxKind
    let currentFolder: LocalMailBoxKind

    var message: String { "Moved to \(currentFolder.title)" }
}

// MARK: - NEXORA Work OS

enum DeliverableKind: String, Codable, CaseIterable, Identifiable {
    case emailDraft = "Email Draft"
    case meetingBrief = "Meeting Brief"
    case customerBrief = "Customer Brief"
    case executiveBrief = "Executive Brief"
    case statusReport = "Status Report"
    case actionReport = "Action Report"
    case decisionSummary = "Decision Summary"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .emailDraft: return "envelope.badge"
        case .meetingBrief: return "calendar.badge.clock"
        case .customerBrief: return "person.text.rectangle"
        case .executiveBrief: return "person.3.fill"
        case .statusReport: return "chart.bar.doc.horizontal"
        case .actionReport: return "checklist.checked"
        case .decisionSummary: return "checkmark.seal"
        }
    }
}

enum MissionProgress: String, Codable, CaseIterable {
    case planning = "Planning"
    case ready = "Ready"
    case running = "Running"
    case waiting = "Waiting"
    case blocked = "Blocked"
    case completed = "Completed"
    case planned = "Planned"
    case active = "In Progress"
    case complete = "Complete"
}

enum NexoraAgentType: String, Codable, CaseIterable, Identifiable {
    case customer = "Customer Agent"
    case followUp = "Follow-Up Agent"
    case meeting = "Meeting Agent"
    case finance = "Finance Agent"
    case document = "Document Agent"
    case research = "Research Agent"
    case workflow = "Workflow Agent"

    var id: String { rawValue }
}

struct AgentExecutionProposal: Codable, Hashable, Identifiable {
    let id: UUID
    let agent: NexoraAgentType
    let goal: String
    let steps: [String]
    let expectedOutputs: [DeliverableKind]
    let explanation: String
    let estimatedWork: String

    init(id: UUID = UUID(), agent: NexoraAgentType, goal: String, steps: [String], expectedOutputs: [DeliverableKind], explanation: String, estimatedWork: String) {
        self.id = id
        self.agent = agent
        self.goal = goal
        self.steps = steps
        self.expectedOutputs = expectedOutputs
        self.explanation = explanation
        self.estimatedWork = estimatedWork
    }
}

struct AgentMission: Codable, Identifiable, Hashable {
    let id: UUID
    var title: String
    var goal: String
    var progress: MissionProgress
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), title: String, goal: String, progress: MissionProgress = .planned, createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.goal = goal
        self.progress = progress
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct ExecutionPlan: Codable, Identifiable, Hashable {
    let id: UUID
    let missionID: UUID
    var title: String
    var steps: [String]
    var completedStepIDs: Set<Int>
    var updatedAt: Date

    init(id: UUID = UUID(), missionID: UUID, title: String, steps: [String], completedStepIDs: Set<Int> = [], updatedAt: Date = Date()) {
        self.id = id
        self.missionID = missionID
        self.title = title
        self.steps = steps
        self.completedStepIDs = completedStepIDs
        self.updatedAt = updatedAt
    }
}

struct Deliverable: Codable, Identifiable, Hashable {
    let id: UUID
    let missionID: UUID
    var kind: DeliverableKind
    var title: String
    var content: String
    var createdAt: Date

    init(id: UUID = UUID(), missionID: UUID, kind: DeliverableKind, title: String, content: String, createdAt: Date = Date()) {
        self.id = id
        self.missionID = missionID
        self.kind = kind
        self.title = title
        self.content = content
        self.createdAt = createdAt
    }
}

// MARK: - NEXORA V3 foundation records

/// These records intentionally live beside the V2 Work OS models. Keeping the
/// foundation additive preserves decoding of missions created by earlier builds.
struct NexoraGoalRecord: Codable, Identifiable, Hashable {
    let id: UUID
    var title: String
    var outcome: String
    var status: MissionProgress
    var missionID: UUID?
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), title: String, outcome: String, status: MissionProgress = .planning, missionID: UUID? = nil, createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.outcome = outcome
        self.status = status
        self.missionID = missionID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

enum NexoraMemoryKind: String, Codable, CaseIterable {
    case goal, mission, deliverable, decision, outcome
}

struct NexoraMemoryRecord: Codable, Identifiable, Hashable {
    let id: UUID
    let kind: NexoraMemoryKind
    let missionID: UUID?
    var summary: String
    var createdAt: Date

    init(id: UUID = UUID(), kind: NexoraMemoryKind, missionID: UUID? = nil, summary: String, createdAt: Date = Date()) {
        self.id = id
        self.kind = kind
        self.missionID = missionID
        self.summary = summary
        self.createdAt = createdAt
    }
}

struct NexoraOutcomeRecord: Codable, Identifiable, Hashable {
    let id: UUID
    let missionID: UUID
    var title: String
    var progress: Int
    var blockers: [String]
    var nextActions: [String]
    var summary: String
    var updatedAt: Date

    init(id: UUID = UUID(), missionID: UUID, title: String, progress: Int = 0, blockers: [String] = [], nextActions: [String] = [], summary: String = "", updatedAt: Date = Date()) {
        self.id = id
        self.missionID = missionID
        self.title = title
        self.progress = min(max(progress, 0), 100)
        self.blockers = blockers
        self.nextActions = nextActions
        self.summary = summary
        self.updatedAt = updatedAt
    }
}

struct NexoraCollaborationRun: Codable, Identifiable, Hashable {
    let id: UUID
    let missionID: UUID
    var agents: [NexoraAgentType]
    var handoffSummary: String
    var deliverableIDs: [UUID]
    var status: MissionProgress
    var updatedAt: Date

    init(id: UUID = UUID(), missionID: UUID, agents: [NexoraAgentType], handoffSummary: String, deliverableIDs: [UUID] = [], status: MissionProgress = .completed, updatedAt: Date = Date()) {
        self.id = id
        self.missionID = missionID
        self.agents = agents
        self.handoffSummary = handoffSummary
        self.deliverableIDs = deliverableIDs
        self.status = status
        self.updatedAt = updatedAt
    }
}

enum NexoraGraphKind: String, Codable, CaseIterable {
    case organization, domain, identity, trust, customer, vendor
}

struct NexoraGraphNode: Codable, Identifiable, Hashable {
    let id: UUID
    let kind: NexoraGraphKind
    var label: String
    var metadata: [String: String]

    /// Deterministic local entity identity. Graph refreshes must not invalidate navigation.
    static func stableID(kind: NexoraGraphKind, source: String) -> UUID {
        let normalized = "\(kind.rawValue):\(source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
        var first: UInt64 = 0xcbf29ce484222325
        var second: UInt64 = 0x9e3779b185ebca87
        for byte in normalized.utf8 {
            first = (first ^ UInt64(byte)) &* 0x100000001b3
            second = (second ^ UInt64(byte)) &* 0x9ddfea08eb382d69
        }
        var bytes: [UInt8] = []
        for shift in stride(from: 56, through: 0, by: -8) {
            bytes.append(UInt8((first >> UInt64(shift)) & 0xff))
        }
        for shift in stride(from: 56, through: 0, by: -8) {
            bytes.append(UInt8((second >> UInt64(shift)) & 0xff))
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}

struct NexoraOrganizationGraph: Codable, Equatable {
    var nodes: [NexoraGraphNode] = []
    var updatedAt: Date = Date()
}

struct MailClientProfile: Codable, Equatable {
    var primaryIdentityEmail: String?
    var connectedMailboxEmails: [String]
    var mailboxDisplayOrder: [String]
    var defaultSendingAddress: String?
    var signatures: [String: MailSignature]
    var aiProviderReadiness: [String: String]
    var uiPreferences: [String: String]
    var favoriteContactEmails: [String]?
    var vipContactEmails: [String]?
    var starredContactEmails: [String]?
    var directoryPreferences: [String: String]?
    var composePreferences: [String: String]?
    var autocompleteLearning: [String: Int]?
    var syncedItems: [String]?
    var profileSyncDeviceId: String?
    var profileSyncDeviceLabel: String?
    var profileSyncLastRestoreAt: Date?
    var profileSyncDevices: [ProfileSyncDevice]?
    var updatedAt: Date?

    static let empty = MailClientProfile(
        primaryIdentityEmail: nil,
        connectedMailboxEmails: [],
        mailboxDisplayOrder: [],
        defaultSendingAddress: nil,
        signatures: [:],
        aiProviderReadiness: [:],
        uiPreferences: [:],
        favoriteContactEmails: [],
        vipContactEmails: [],
        starredContactEmails: [],
        directoryPreferences: [:],
        composePreferences: [:],
        autocompleteLearning: [:],
        syncedItems: [],
        profileSyncDeviceId: nil,
        profileSyncDeviceLabel: nil,
        profileSyncLastRestoreAt: nil,
        profileSyncDevices: [],
        updatedAt: nil
    )
}

struct ProfileSyncDevice: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var kind: String
    var lastSeen: Date
    var syncStatus: String
}

// MARK: - Password Reset & Registration DTOs

struct RegisterPayload: Encodable {
    let email: String
    let password: String
    let code: String
}

struct RegisterResponse: Decodable {
    let regVerifyOpen: Bool?
    let routingSetup: RoutingSetupResponse?
    let userCreated: Bool?
    let routingCreated: Bool?
}

struct ForgotPasswordPayload: Encodable {
    let email: String
}

struct ForgotPasswordResponse: Decodable {
    let mockMode: Bool?
    let resetToken: String?
    let resetLink: String?
    let message: String?
}

struct ResetPasswordPayload: Encodable {
    let token: String
    let newPassword: String
}

struct ResetPasswordResponse: Decodable {
    let message: String?
}

// MARK: - NEXORA V3 Autonomy OS

struct NexoraV3ProviderCapability: Codable, Identifiable, Hashable {
    var id: String { provider }
    let provider: String
    let title: String
    let authorization: String
    let scopes: [String]
    let capabilities: [String]
    let operational: [String]
    let limitations: [String]
    let scopeCount: Int
    let implementationState: String
}

struct NexoraV3Authority: Codable, Equatable {
    let provider: String
    let authorityState: String
    let authorizationType: String
    let requestedScopes: [String]
    let grantedScopes: [String]
    let missingScopes: [String]
    let selectedFeatures: [String]
    let supportedCapabilities: [String]
    let unsupportedCapabilities: [String]
    let consentRequired: Bool
    let silentEscalationAllowed: Bool
    let refreshPolicy: String
    let truth: String

    static let awaiting = NexoraV3Authority(
        provider: "unresolved", authorityState: "AUTHORIZATION_REQUIRED", authorizationType: "provider_discovery",
        requestedScopes: [], grantedScopes: [], missingScopes: [], selectedFeatures: [], supportedCapabilities: [],
        unsupportedCapabilities: [], consentRequired: true, silentEscalationAllowed: false,
        refreshPolicy: "provider_supported_refresh_then_explicit_reauthorization_if_required",
        truth: "Authority has not been verified."
    )
}

struct NexoraV3Blocker: Codable, Hashable, Identifiable {
    var id: String { code + (missingScopes ?? []).joined(separator: "|") }
    let code: String
    let missingScopes: [String]?
}

struct NexoraV3ProviderGraph: Codable, Equatable {
    let mailboxProvider: String
    let infrastructureProvider: String
    let dnsProvider: String
    let calendarProvider: String
    let identityProvider: String
}

struct NexoraV3AuthorityBundle: Codable, Equatable {
    let mailbox: NexoraV3Authority
    let infrastructure: NexoraV3Authority
}

struct NexoraV3Onboarding: Codable, Equatable {
    let email: String
    let domain: String
    let provider: String
    let priority: String
    let authority: NexoraV3Authority
    let lifecycleState: String
    let workflow: [String]
    let manualDnsRequired: Bool?
    let blockers: [NexoraV3Blocker]
    let ready: Bool
    let readinessInvariant: String
    let idempotencyKey: String?
    let persisted: Bool?
    let mailboxProvider: String?
    let infrastructureProvider: String?
    let providerGraph: NexoraV3ProviderGraph?
    let authorityBundle: NexoraV3AuthorityBundle?
    let addMailboxStatus: String?
    let domainReused: Bool?
    let uiStatus: NexoraV3OnboardingUIStatus?
    let activation: NexoraV3MailboxActivation?
}

struct NexoraV3OnboardingUIStatus: Codable, Equatable {
    let label: String
    let blocked: Bool
}

struct NexoraV3MailboxActivation: Codable, Equatable {
    let state: String
    let label: String
    let reason: String
    let recommendedAction: String
    let primaryCta: String
    let progress: Int
}

struct NexoraV3StatusSnapshot: Equatable {
    var providers: [NexoraV3ProviderCapability] = []
    var authority: NexoraV3Authority = .awaiting
    var onboarding: NexoraV3Onboarding?
    var isLoading = false
    var lastCheckedAt: Date?
    var error: String?
}

// MARK: - CloudMail V2 Identity

struct EmailDiscoveryResponse: Decodable {
    let existsInGlassMailUsers: Bool
    let existsInEmailIdentities: Bool
    let existsInCloudflareRouting: Bool
    let domainManaged: Bool
    let routingRuleEnabled: Bool
    let catchAllEligible: Bool?
    let forwardingPreserved: Bool?
    let accountStatus: String
    let recommendedAction: String
    let message: String
    let domain: String?
    let provider: String?
    let discoveryState: String?
    let authorityState: String?
    let identityState: String?
    let mailboxState: String?
    let nextAction: String?
}

struct RoutingSetupResponse: Decodable {
    let routingCreated: Bool?
    let action: String?
    let ruleId: String?
    let forwardingPreserved: Bool?
    let forwardingDestinationCount: Int?
}

struct BootstrapIdentityResponse: Decodable {
    let status: String
    let recommendedAction: String?
    let message: String?
    let activationToken: String?
    let routingSetup: RoutingSetupResponse?
    let mailboxReady: Bool?
    let healthState: String?
    let blocker: String?
}

struct ProvisioningAuthChallengeResponse: Decodable {
    let challengeReference: String
    let expiresAt: String?
    let purpose: String
}

struct ProvisioningContinuationResponse: Decodable {
    let continuationToken: String
    let expiresAt: String?
    let purpose: String
}

struct ActivationResponse: Decodable {
    let status: String
    let recommendedAction: String?
    let email: String?
}

struct ForwardingSettingsResponse: Decodable {
    let address: String
    let inCloudMailInbox: Bool
    let routingRuleId: String?
    let routingEnabled: Bool
    let forwardingPreserved: Bool
    let status: String
    let destinations: [ForwardingDestination]
}

struct ForwardingDestination: Decodable, Identifiable {
    var id: String { destinationEmail }
    let sourceEmail: String?
    let destinationEmail: String
    let forwardingEnabled: Int
    let preserveOriginalForwarding: Int
    let lastForwardedAt: String?
    let lastError: String?
}

// MARK: - AI Consent

struct AIConsent: Codable, Equatable {
    var aiEnabled: Bool
    var appleLocalEnabled: Bool
    var cloudAIEnabled: Bool
    var singleMailRead: Bool
    var threadRead: Bool
    var attachmentRead: Bool
    var saveOutputs: Bool
    var searchIndex: Bool
    var autoClassify: Bool
    var cleanupSuggestions: Bool
    var autoSend: Bool
    var autoDelete: Bool
    var autoArchive: Bool
    var autoUnsubscribe: Bool

    enum CodingKeys: String, CodingKey {
        case aiEnabled = "ai_enabled"
        case appleLocalEnabled = "apple_local_enabled"
        case cloudAIEnabled = "cloud_ai_enabled"
        case singleMailRead = "single_mail_read"
        case threadRead = "thread_read"
        case attachmentRead = "attachment_read"
        case saveOutputs = "save_outputs"
        case searchIndex = "search_index"
        case autoClassify = "auto_classify"
        case cleanupSuggestions = "cleanup_suggestions"
        case autoSend = "auto_send"
        case autoDelete = "auto_delete"
        case autoArchive = "auto_archive"
        case autoUnsubscribe = "auto_unsubscribe"
    }

    static let `default` = AIConsent(
        aiEnabled: true,
        appleLocalEnabled: true,
        cloudAIEnabled: false,
        singleMailRead: true,
        threadRead: false,
        attachmentRead: false,
        saveOutputs: false,
        searchIndex: false,
        autoClassify: false,
        cleanupSuggestions: false,
        autoSend: false,
        autoDelete: false,
        autoArchive: false,
        autoUnsubscribe: false
    )
}

struct AIProviderReadiness: Decodable {
    let configured: Bool
    let local: Bool
    let authorized: Bool
    let reason: String?
}

struct GeminiOAuthStatus: Decodable {
    let provider: String
    let configured: Bool
    let authorized: Bool
    let status: String
    let reason: String?
    let accountEmail: String?
    let scope: String?
    let authorizationUrl: String?
}

struct GoogleTestUserDashboard: Decodable {
    let pendingRequests: Int
    let approvedRequests: Int
    let rejectedRequests: Int
    let newToday: Int
    let newThisWeek: Int
    let oauthSuccessRate: Double
    let averageApprovalMinutes: Double?
    let oauthSuccess: Int
    let oauthFailures: Int
    let repeatRequests: Int
}

struct GoogleTestUserRequest: Identifiable, Decodable {
    let id: Int
    let gmail: String
    let status: String
    let userEmail: String?
    let device: String?
    let requestedAt: String?
    let lastSeenAt: String?
    let approvedAt: String?
    let approvedBy: String?
    let lastGoogleExport: String?
    let lastGoogleSyncOperator: String?
    let googleSyncBatchId: String?
    let oauthSuccessTime: String?
    let firstSyncCompleted: String?
    let requestCount: Int?
    let notes: String?
}

struct GoogleTestUserBulkResult: Decodable {
    let updated: Int
    let status: String?
    let googleSyncBatchId: String?
}

struct GoogleTestUserAccessRequestResult: Decodable {
    let recorded: Bool
    let gmail: String?
    let status: String?
}

struct GoogleTestUserGmailList: Decodable {
    let gmail: [String]
    let text: String
}

enum OAuthTesterStatus: String, Codable, CaseIterable, Identifiable {
    case testerApproved = "TESTER_APPROVED"
    case testerPending = "TESTER_PENDING"
    case testerRejected = "TESTER_REJECTED"
    case testerNotRegistered = "TESTER_NOT_REGISTERED"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .testerApproved: return "Auto Approved"
        case .testerPending: return "Enterprise Pending"
        case .testerRejected: return "Rejected"
        case .testerNotRegistered: return "Not Registered"
        }
    }
}

enum ProviderHealthState: String, Codable, CaseIterable, Identifiable {
    case pass = "PASS"
    case warn = "WARN"
    case fail = "FAIL"
    case pending = "PENDING"
    case blocked = "BLOCKED"

    var id: String { rawValue }
}

enum LocalOAuthAccessRequestStatus: String, Codable, CaseIterable, Identifiable {
    case autoApproved = "AUTO_APPROVED"
    case googleOAuthBlocked = "GOOGLE_OAUTH_BLOCKED"
    case oauthSuccess = "OAUTH_SUCCESS"
    case pendingApproval = "PENDING_APPROVAL"
    case approved = "APPROVED"
    case rejected = "REJECTED"
    case expired = "EXPIRED"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .autoApproved: return "Auto Approved"
        case .googleOAuthBlocked: return "Google OAuth Blocked"
        case .oauthSuccess: return "OAuth Success"
        case .pendingApproval: return "Enterprise Pending"
        case .approved: return "Approved"
        case .rejected: return "Rejected"
        case .expired: return "Expired"
        }
    }
}

enum ProviderTruthGovernanceStatus: String, Codable, CaseIterable, Identifiable {
    case auto_approved = "auto_approved"
    case manual_approved = "manual_approved"
    case manual_rejected = "manual_rejected"
    case enterprise_policy_pending = "enterprise_policy_pending"
    case enterprise_policy_expired = "enterprise_policy_expired"

    var id: String { rawValue }
}

enum ProviderTruthAuthorizationStatus: String, Codable, CaseIterable, Identifiable {
    case not_started = "not_started"
    case launch_ready = "launch_ready"
    case oauth_success = "oauth_success"
    case access_blocked = "access_blocked"
    case testing_restricted = "testing_restricted"
    case verification_required = "verification_required"
    case workspace_admin_blocked = "workspace_admin_blocked"
    case scope_not_approved = "scope_not_approved"
    case user_cancelled = "user_cancelled"

    var id: String { rawValue }
}

enum ProviderTruthCapabilityStatus: String, Codable, CaseIterable, Identifiable {
    case allowed = "allowed"
    case blocked = "blocked"
    case send_allowed = "send_allowed"
    case send_blocked = "send_blocked"
    case receive_allowed = "receive_allowed"
    case receive_blocked = "receive_blocked"
    case needsRefresh = "needs_refresh"
    case notConfigured = "not_configured"
    case unavailable = "unavailable"
    case unknown = "unknown"

    var id: String { rawValue }
}

enum ProviderTruthRecoveryStatus: String, Codable, CaseIterable, Identifiable {
    case none = "none"
    case requestApproval = "request_approval"
    case requestEnrollment = "request_enrollment"
    case reauthenticate = "reauthenticate"
    case configureProvider = "configure_provider"
    case refreshCapability = "refresh_capability"
    case contactAdmin = "contact_admin"
    case unknown = "unknown"

    var id: String { rawValue }
}

enum ProviderTruthSyncStatus: String, Codable, CaseIterable, Identifiable {
    case not_ready = "not_ready"
    case importing = "importing"
    case mailbox_ready = "mailbox_ready"
    case needs_reconnect = "needs_reconnect"
    case blocked = "blocked"

    var id: String { rawValue }
}

enum ProviderTruthFreshnessStatus: String, Codable, CaseIterable, Identifiable {
    case healthy = "healthy"
    case stale = "stale"
    case unknown = "unknown"

    var id: String { rawValue }
}

struct ProviderTruthCapability: Codable, Hashable {
    let status: ProviderTruthCapabilityStatus
    let reason: String

    var canProceed: Bool {
        status == .allowed || status == .send_allowed || status == .receive_allowed
    }
}

struct ProviderTruthSnapshot: Codable, Hashable {
    let provider: UnifiedMailProvider
    let email: String
    let governanceStatus: ProviderTruthGovernanceStatus
    let providerStatus: ProviderTruthAuthorizationStatus
    let recoveryStatus: ProviderTruthRecoveryStatus
    let syncStatus: ProviderTruthSyncStatus
    let freshnessStatus: ProviderTruthFreshnessStatus
    let mailboxStatus: String
    let failureReason: String
    let truthSource: String
    let canLogin: ProviderTruthCapability
    let canSend: ProviderTruthCapability
    let canReceive: ProviderTruthCapability
    let canSync: ProviderTruthCapability
    let canRoute: ProviderTruthCapability
    let canAIProcess: ProviderTruthCapability

    var capabilityStatus: ProviderTruthCapabilityStatus {
        let capabilities = [canLogin, canSend, canReceive, canSync, canRoute, canAIProcess]
        if capabilities.allSatisfy(\.canProceed) { return .allowed }
        if capabilities.contains(where: { $0.status == .blocked || $0.status == .send_blocked || $0.status == .receive_blocked }) { return .blocked }
        if capabilities.contains(where: { $0.status == .needsRefresh }) { return .needsRefresh }
        if capabilities.contains(where: { $0.status == .notConfigured }) { return .notConfigured }
        return .unavailable
    }

    var hasContradiction: Bool {
        providerStatus != .oauth_success && (canLogin.canProceed || canSend.canProceed || canSync.canProceed)
    }
}

struct MailboxMetricsTruthSnapshot: Hashable {
    let drafts: Int
    let sent: Int
    let outbox: Int
    let scheduled: Int
    let unread: Int
    let allMail: Int
    let source: String
}

struct LocalOAuthAccessRequest: Codable, Identifiable, Hashable {
    let id: String
    let provider: String
    let email: String
    let requestedAt: Date
    let userId: Int?
    var status: LocalOAuthAccessRequestStatus
    var notes: String?

    static func google(email: String, userId: Int?) -> LocalOAuthAccessRequest {
        LocalOAuthAccessRequest(
            id: UUID().uuidString,
            provider: "Google",
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            requestedAt: Date(),
            userId: userId,
            status: .pendingApproval,
            notes: "Created from NEXORA OAuth diagnostics. Provider-side Google tester writeback is not claimed."
        )
    }
}

enum GovernanceProvider: String, Codable, CaseIterable, Identifiable {
    case google = "Google"
    case outlook = "Outlook"
    case office365 = "Office365"
    case exchange = "Exchange"
    case imap = "IMAP"
    case smtp = "SMTP"
    case cloudMailDomain = "NEXORA Domain"

    var id: String { rawValue }
}

enum GovernanceInviteStatus: String, Codable, CaseIterable, Identifiable {
    case active = "ACTIVE"
    case expired = "EXPIRED"
    case revoked = "REVOKED"
    case used = "USED"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .active: return "Active"
        case .expired: return "Expired"
        case .revoked: return "Revoked"
        case .used: return "Used"
        }
    }
}

struct GovernanceInvitation: Codable, Identifiable, Hashable {
    let id: String
    let provider: GovernanceProvider
    let optionalEmailBinding: String?
    let codeHash: String
    let maxUses: Int
    let expiresAt: Date
    var status: GovernanceInviteStatus
    var uses: Int
    let createdAt: Date
    let createdBy: String?

    var isUsable: Bool {
        status == .active && uses < maxUses && expiresAt > Date()
    }
}

enum GovernanceAuditAction: String, Codable, CaseIterable, Identifiable {
    case requestCreated = "REQUEST_CREATED"
    case requestApproved = "REQUEST_APPROVED"
    case requestRejected = "REQUEST_REJECTED"
    case inviteCreated = "INVITE_CREATED"
    case inviteRevoked = "INVITE_REVOKED"
    case inviteExpired = "INVITE_EXPIRED"
    case inviteResent = "INVITE_RESENT"
    case inviteUsed = "INVITE_USED"

    var id: String { rawValue }
}

struct GovernanceAuditEvent: Codable, Identifiable, Hashable {
    let id: String
    let action: GovernanceAuditAction
    let provider: GovernanceProvider
    let account: String?
    let actor: String?
    let createdAt: Date
    let detail: String
}

struct MailboxAuthorizationResponse: Decodable {
    let id: Int?
    let email: String
    let provider: String
    let status: String
    let currentUserChanged: Bool
    let ownerUserId: Int?
    let ownerAccountId: Int?
}

struct AIExecutionMetadata: Codable, Equatable, Hashable {
    let requestedProvider: AIProviderKind
    let executedProvider: AIProviderKind
    let provider: String
    let model: String
    let localOrCloud: String
    let generatedAt: Date
    let fallbackReason: String?

    var displayLine: String {
        var text = "Executed: \(executedProvider.title) · \(model) · \(localOrCloud)"
        if requestedProvider != executedProvider {
            text = "Requested: \(requestedProvider.title) · \(text)"
        }
        return text
    }
}

struct AITextResult: Equatable {
    let text: String
    let metadata: AIExecutionMetadata
}

struct AIRuntimePreflightError: Decodable, Equatable {
    let code: String?
    let message: String?
}

struct AIRuntimePreflightResult: Decodable, Equatable {
    let providerReachable: Bool
    let modelReachable: Bool
    let sanitizedOutputPreview: String?
    let latencyMs: Int?
    let requestId: String
    let auditId: String?
    let status: String
    let reason: String?
    let providerId: String?
    let methodId: String?
    let error: AIRuntimePreflightError?
    let runtimeAuthSource: String?
    let billingOwner: String?
    let providerOwnership: String?
    let sharedPlatformApiKey: Bool?
}

enum AIWorkspaceSyntheticAction: String, CaseIterable, Identifiable, Encodable {
    case summarize
    case draft
    case translate
    case replySuggestion = "reply_suggestion"
    case threadAnalysis = "thread_analysis"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .summarize: return "Summarize"
        case .draft: return "Draft"
        case .translate: return "Translate"
        case .replySuggestion: return "Reply"
        case .threadAnalysis: return "Thread"
        }
    }

    var symbol: String {
        switch self {
        case .summarize: return "text.alignleft"
        case .draft: return "square.and.pencil"
        case .translate: return "character.book.closed"
        case .replySuggestion: return "arrowshape.turn.up.left"
        case .threadAnalysis: return "rectangle.stack"
        }
    }
}

enum AIWorkspaceRealWorkflow: String, CaseIterable, Identifiable {
    case inboxSummary
    case suggestedReply
    case threadDigest
    case draftGeneration
    case multiEmailAnalysis

    var id: String { rawValue }

    var title: String {
        switch self {
        case .inboxSummary: return "Inbox Summary"
        case .suggestedReply: return "Suggested Reply"
        case .threadDigest: return "Thread Digest"
        case .draftGeneration: return "Draft Generation"
        case .multiEmailAnalysis: return "Multi-email Analysis"
        }
    }

    var symbol: String {
        switch self {
        case .inboxSummary: return "tray.full"
        case .suggestedReply: return "arrowshape.turn.up.left.fill"
        case .threadDigest: return "rectangle.stack.fill"
        case .draftGeneration: return "square.and.pencil"
        case .multiEmailAnalysis: return "chart.bar.doc.horizontal"
        }
    }

    var runtimeAction: AIWorkspaceSyntheticAction {
        switch self {
        case .inboxSummary: return .summarize
        case .suggestedReply: return .replySuggestion
        case .threadDigest: return .threadAnalysis
        case .draftGeneration: return .draft
        case .multiEmailAnalysis: return .summarize
        }
    }
}

struct AIWorkspaceWorkflowResult: Equatable {
    let workflow: AIWorkspaceRealWorkflow
    let text: String
    let messageCount: Int
    let sourceAccount: String
    let runtimeStatus: String?
    let runtimeBoundary: String
}

struct AIWorkspaceActionResult: Decodable, Equatable {
    let providerReachable: Bool
    let modelReachable: Bool
    let sanitizedOutputPreview: String?
    let latencyMs: Int?
    let requestId: String
    let auditId: String?
    let status: String
    let reason: String?
    let providerId: String?
    let methodId: String?
    let workspaceAction: String?
    let userInitiated: Bool?
    let mailboxDataSent: Bool?
    let customerDataSent: Bool?
    let contactsSent: Bool?
    let calendarDataSent: Bool?
    let attachmentsSent: Bool?
    let crossAccountAccess: Bool?
    let runtimeAuthSource: String?
    let billingOwner: String?
    let providerOwnership: String?
    let sharedPlatformApiKey: Bool?
    let error: AIRuntimePreflightError?
}

enum ExecutionState: String, Codable, CaseIterable, Identifiable {
    case notStarted
    case draft
    case ready
    case running
    case generating
    case review
    case completed
    case failed
    case blocked
    case exported

    var id: String { rawValue }

    var title: String {
        switch self {
        case .notStarted: return "Not Started"
        case .draft: return "Draft"
        case .ready: return "Ready"
        case .running: return "Running"
        case .generating: return "Generating"
        case .review: return "Review"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .blocked: return "Blocked"
        case .exported: return "Exported"
        }
    }

    var symbol: String {
        switch self {
        case .notStarted: return "circle"
        case .draft: return "pencil"
        case .ready: return "checkmark.circle"
        case .running, .generating: return "hourglass"
        case .review: return "eye"
        case .completed: return "checkmark.seal.fill"
        case .failed: return "xmark.octagon.fill"
        case .blocked: return "lock.fill"
        case .exported: return "square.and.arrow.up"
        }
    }
}

struct Artifact: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String
    var source: String
    var state: ExecutionState
    var createdAt: Date = Date()
    var summary: String
}

struct HistoryState: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String
    var detail: String
    var state: ExecutionState
    var timestamp: Date = Date()
}

struct AuditState: Codable, Hashable {
    var runtimeBoundary: String
    var accountScope: String
    var providerScope: String
    var crossAccountAccess: Bool
    var sharedPlatformApiKey: Bool

    static let preserved = AuditState(
        runtimeBoundary: "Mailbox-scoped execution",
        accountScope: "selectedAccountId honored",
        providerScope: "selectedProvider honored",
        crossAccountAccess: false,
        sharedPlatformApiKey: false
    )
}

// MARK: - Unified Mail Layer

enum UnifiedMailProvider: String, Codable, CaseIterable, Identifiable {
    case cloudflareNative = "cloudflare_native"
    case gmail
    case googleWorkspace = "google_workspace"
    case outlook
    case imap
    case custom
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = UnifiedMailProvider(rawValue: raw) ?? .custom
    }

    var title: String {
        switch self {
        case .cloudflareNative: return "NEXORA Mail"
        case .gmail: return "Gmail"
        case .googleWorkspace: return "Google Workspace"
        case .outlook: return "Outlook"
        case .imap: return "IMAP"
        case .custom: return "Custom"
        }
    }
    var symbol: String {
        switch self {
        case .cloudflareNative: return "cloud.fill"
        case .gmail, .googleWorkspace: return "envelope.fill"
        case .outlook: return "building.2.fill"
        case .imap: return "server.rack"
        case .custom: return "tray.2.fill"
        }
    }
}

struct UnifiedMailAccount: Decodable, Identifiable {
    static let delegatedIDOffset = 1_000_000_000

    let id: Int
    let userId: Int
    let provider: UnifiedMailProvider
    let externalAccountId: String?
    let email: String
    let displayName: String?
    let status: String
    let capabilitiesJson: String
    let accountCapabilityContractV2Json: String?
    let aiAccessEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case provider
        case externalAccountId
        case email
        case displayName
        case status
        case capabilitiesJson
        case accountCapabilityContractV2Json = "accountCapabilityContractV2"
        case aiAccessEnabled
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        userId = try c.decode(Int.self, forKey: .userId)
        provider = try c.decode(UnifiedMailProvider.self, forKey: .provider)
        externalAccountId = try c.decodeIfPresent(String.self, forKey: .externalAccountId)
        email = try c.decode(String.self, forKey: .email)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        status = try c.decode(String.self, forKey: .status)
        capabilitiesJson = try c.decode(String.self, forKey: .capabilitiesJson)
        accountCapabilityContractV2Json = try c.decodeIfPresent(String.self, forKey: .accountCapabilityContractV2Json)
        if let bool = try? c.decode(Bool.self, forKey: .aiAccessEnabled) {
            aiAccessEnabled = bool
        } else {
            aiAccessEnabled = ((try? c.decode(Int.self, forKey: .aiAccessEnabled)) ?? 0) != 0
        }
    }

    var isDelegatedMailbox: Bool {
        accountCapabilityContract.delegatedAuthorization
    }

    var canSend: Bool {
        accountCapabilityContract.canSend
    }

    var sendStatusReason: String {
        accountCapabilityContract.uiSendStatus
    }

    var accountCapabilityContract: AccountCapabilityContract {
        let capability = decodedCapabilities
        let v2Reason = SendUnavailableReason(rawValue: capability.string("send_unavailable_reason") ?? "")
        let delegated = id >= UnifiedMailAccount.delegatedIDOffset || capability.bool("delegated")
        let providerSendSupported = provider == .gmail || provider == .googleWorkspace || provider == .cloudflareNative
        let providerReceiveSupported = capability.optionalBool("read") ?? true
        let sendScopePresent = capability.optionalBool("send_scope_present")
            ?? (capability.bool("send") || capability.bool("restored_capability_rehydrated"))
        let receiveScopePresent = capability.optionalBool("receive_scope_present") ?? providerReceiveSupported
        let mailboxLifecycleState = capability.string("mailbox_lifecycle_state") ?? status.uppercased()
        let mailboxReady = capability.optionalBool("mailbox_ready")
            ?? (provider == .cloudflareNative || mailboxLifecycleState == "MAILBOX_READY")
        let hasExternalReference = externalAccountId?.isEmpty == false
        let tokenReferencePresent = capability.optionalBool("token_reference_present")
            ?? (provider == .cloudflareNative || capability.bool("restored_capability_rehydrated") || hasExternalReference)
        let ownership: AccountOwnershipType = delegated ? .delegated : .owned
        let canReceive = providerReceiveSupported && receiveScopePresent && mailboxReady
        let unavailableReason: SendUnavailableReason
        if delegated && !capability.bool("delegated_send_authorized") {
            unavailableReason = .delegatedReceiveOnly
        } else if capability.bool("send_scope_missing") {
            unavailableReason = .missingSendScope
        } else if let v2Reason, v2Reason != .none {
            unavailableReason = v2Reason
        } else if !tokenReferencePresent {
            unavailableReason = .tokenReferenceMissing
        } else if !providerSendSupported {
            unavailableReason = .providerSendUnsupported
        } else if capability.optionalBool("send") == nil {
            unavailableReason = .capabilityNotHydrated
        } else if capability.bool("send") {
            unavailableReason = .none
        } else {
            unavailableReason = .unknown
        }
        let computedCanSend = ownership == .owned
            || (ownership == .delegated && capability.bool("delegated_send_authorized"))
        let finalCanSend = computedCanSend
            && providerSendSupported
            && tokenReferencePresent
            && (capability.optionalBool("backend_send_eligibility") ?? capability.optionalBool("send") ?? false)
            && (capability.optionalBool("compose_enabled") ?? capability.optionalBool("send") ?? false)
            && unavailableReason == .none
        return AccountCapabilityContract(
            contractVersion: capability.int("contract_version") ?? 1,
            accountID: id,
            providerType: provider.rawValue,
            accountOwnershipType: ownership,
            authType: provider == .cloudflareNative ? "cloudmail_session" : "provider_oauth_or_app_password",
            tokenReferencePresent: tokenReferencePresent,
            sendScopePresent: sendScopePresent,
            receiveScopePresent: receiveScopePresent,
            providerSendSupported: providerSendSupported,
            providerReceiveSupported: providerReceiveSupported,
            delegatedAuthorization: delegated,
            restoredFromAuthorization: capability.bool("restored_capability_rehydrated"),
            capabilityHydratedAt: nil,
            mailboxLifecycleState: mailboxLifecycleState,
            mailboxReady: mailboxReady,
            canReceive: canReceive,
            canSend: finalCanSend,
            sendUnavailableReason: unavailableReason,
            receiveUnavailableReason: capability.string("receive_unavailable_reason") ?? (canReceive ? "NONE" : "PROVIDER_RECEIVE_UNSUPPORTED"),
            accountHealth: status,
            uiSendStatus: AccountCapabilityContract.statusText(canSend: finalCanSend, reason: unavailableReason),
            backendSendEligibility: finalCanSend,
            composeEnabled: finalCanSend,
            recoveryAction: capability.string("recovery_action") ?? "REFRESH_CAPABILITY"
        )
    }

    var authorizationId: Int? {
        isDelegatedMailbox ? id - UnifiedMailAccount.delegatedIDOffset : nil
    }

    var readableAccountId: Int? {
        if let externalAccountId, let value = Int(externalAccountId) { return value }
        return isDelegatedMailbox ? nil : id
    }

    private var decodedCapabilities: AccountCapabilityFlags {
        AccountCapabilityFlags(json: accountCapabilityContractV2Json ?? capabilitiesJson)
    }
}

enum AccountOwnershipType: String, Codable, Hashable {
    case owned = "OWNED"
    case delegated = "DELEGATED"
    case unknown = "UNKNOWN"
}

enum SendUnavailableReason: String, Codable, Hashable {
    case none = "NONE"
    case missingSendScope = "MISSING_SEND_SCOPE"
    case delegatedReceiveOnly = "DELEGATED_RECEIVE_ONLY"
    case tokenExpired = "TOKEN_EXPIRED"
    case tokenReferenceMissing = "TOKEN_REFERENCE_MISSING"
    case providerSendUnsupported = "PROVIDER_SEND_UNSUPPORTED"
    case capabilityNotHydrated = "CAPABILITY_NOT_HYDRATED"
    case accountHealthStale = "ACCOUNT_HEALTH_STALE"
    case unknown = "UNKNOWN"
}

struct AccountCapabilityContract: Codable, Hashable {
    let contractVersion: Int
    let accountID: Int
    let providerType: String
    let accountOwnershipType: AccountOwnershipType
    let authType: String
    let tokenReferencePresent: Bool
    let sendScopePresent: Bool
    let receiveScopePresent: Bool
    let providerSendSupported: Bool
    let providerReceiveSupported: Bool
    let delegatedAuthorization: Bool
    let restoredFromAuthorization: Bool
    let capabilityHydratedAt: Date?
    let mailboxLifecycleState: String
    let mailboxReady: Bool
    let canReceive: Bool
    let canSend: Bool
    let sendUnavailableReason: SendUnavailableReason
    let receiveUnavailableReason: String
    let accountHealth: String
    let uiSendStatus: String
    let backendSendEligibility: Bool
    let composeEnabled: Bool
    let recoveryAction: String

    static func statusText(canSend: Bool, reason: SendUnavailableReason) -> String {
        if canSend { return "Can send" }
        switch reason {
        case .missingSendScope: return "Reconnect required for send"
        case .delegatedReceiveOnly: return "Delegated receive-only"
        case .tokenExpired: return "Reconnect required for send"
        case .tokenReferenceMissing: return "Reconnect required for send"
        case .providerSendUnsupported: return "Provider send unsupported"
        case .capabilityNotHydrated: return "Capability refresh required"
        case .accountHealthStale: return "Account health stale"
        case .unknown: return "Send status needs refresh"
        case .none: return "Can send"
        }
    }
}

private struct AccountCapabilityFlags {
    private let values: [String: Any]

    init(json: String) {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            values = [:]
            return
        }
        values = dictionary
    }

    func bool(_ key: String) -> Bool {
        optionalBool(key) == true
    }

    func optionalBool(_ key: String) -> Bool? {
        if let value = values[key] as? Bool { return value }
        if let value = values[key] as? Int { return value != 0 }
        if let value = values[key] as? String {
            return value.caseInsensitiveCompare("true") == .orderedSame || value == "1"
        }
        return nil
    }

    func int(_ key: String) -> Int? {
        if let value = values[key] as? Int { return value }
        if let value = values[key] as? Double { return Int(value) }
        if let value = values[key] as? String { return Int(value) }
        return nil
    }

    func string(_ key: String) -> String? {
        values[key] as? String
    }
}

struct UnifiedThread: Codable, Identifiable, Hashable {
    let id: Int
    let subject: String
    let messageIDs: [Int]
}

struct UnifiedFolder: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
}

struct UnifiedLabel: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
    let color: String?
}

struct UnifiedAttachment: Codable, Identifiable, Hashable {
    let id: Int
    let filename: String
    let contentType: String
    let byteSize: Int
}

enum UnifiedMailAction: String, Codable, CaseIterable {
    case archive
    case markRead = "mark_read"
    case unsubscribe
    case pin
    case followUp = "follow_up"
    case snooze
    case blockSender = "block_sender"
}

struct SecurityAnalysis: Decodable {
    struct TrackerResult: Decodable {
        let blocked: Bool
        let trackerCount: Int
    }
    struct UnsubscribeResult: Decodable {
        let available: Bool
        let method: String?
    }
    let phishingWarning: Bool
    let phishingSignals: [String]
    let trackerBlocking: TrackerResult
    let oneClickUnsubscribe: UnsubscribeResult
}

struct SecureSendResponse: Decodable {
    let url: String
    let expiresInSeconds: Int
}

struct GmailConnectResponse: Decodable {
    let accountId: Int
    let email: String
    let provider: String
    let status: String
    let synced: Int?
}

struct GmailSyncResponse: Decodable {
    let accountId: Int
    let provider: String
    let synced: Int
    let skipped: Int?
    let fetched: Int?
    let cacheReused: Int?
}

// MARK: - Mail OS V5

enum MailOSHealthState: String, Codable, Hashable {
    case connected = "Connected"
    case connectedNoData = "Connected_No_Data"
    case initialSyncRunning = "Initial_Sync_Running"
    case ready = "Ready"
    case stale = "Stale"
    case failed = "Failed"
    case syncing = "Syncing"
    case attention = "Needs Attention"
    case unavailable = "Unavailable"
}

struct MailboxHealthSnapshot: Identifiable, Hashable {
    let id: String
    let provider: UnifiedMailProvider
    let account: String
    let domain: String
    let state: MailOSHealthState
    let messageCount: Int
    let visibleMessages: Int
    let indexedMessages: Int
    let mailboxSource: String
    let lastSyncLabel: String
    let latencyLabel: String
    let queueLabel: String
    let authorizationLabel: String
    let currentSyncState: String
    let progressLabel: String?
}

struct MailDataTrustSnapshot: Hashable {
    let visibleMessages: Int
    let indexedMessages: Int
    let mailboxSources: String
    let lastUpdated: String
    let currentFilter: String
    let currentIdentity: String
    let dataFreshness: String
}

struct MailOSBriefingSnapshot: Hashable {
    let needReply: Int
    let waiting: Int
    let followUp: Int
    let urgent: Int
    let personal: Int
    let updates: Int
    let newsletter: Int
    let system: Int
}

enum MailBriefingCategory: String, CaseIterable, Identifiable, Hashable {
    case needReply = "need_reply"
    case waiting
    case followUp = "follow_up"
    case urgent
    case personal
    case updates
    case newsletter
    case system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .needReply: return "Need Reply"
        case .waiting: return "Waiting"
        case .followUp: return "Follow Up"
        case .urgent: return "Urgent"
        case .personal: return "Personal"
        case .updates: return "Updates"
        case .newsletter: return "Newsletter"
        case .system: return "System"
        }
    }

    var filterRawValue: String {
        switch self {
        case .needReply: return "needsReply"
        case .waiting: return "waiting"
        case .followUp: return "followUp"
        case .urgent: return "urgent"
        case .personal: return "personal"
        case .updates: return "updates"
        case .newsletter: return "newsletter"
        case .system: return "system"
        }
    }
}

struct MailSyncObservabilitySnapshot: Hashable {
    let currentMailbox: String
    let currentFolder: String
    let currentSyncState: String
    let lastSuccessfulSync: String
    let lastFailedSync: String
    let retryCountdown: String
    let syncProgress: String
    let queueDepth: String
    let lastError: String
    let latency: String
}

struct AIRuntimeStatusSnapshot: Hashable {
    let title: String
    let detail: String
    let providerStates: [String]
    let syntheticReady: Bool
}
