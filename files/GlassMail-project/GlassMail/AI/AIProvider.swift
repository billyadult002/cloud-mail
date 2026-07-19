//
//  AIProvider.swift
//  GlassMail
//
//  A small, pluggable AI layer. The app talks to `AIProvider` and never cares
//  which engine answers. Three engines are shipped:
//
//   1. Apple  – on-device Foundation Models (iOS 26 / macOS 26). Free, private,
//               offline, NO login or key required. This is the default.
//   2. ChatGPT – Owner Mac Local Broker through authenticated Codex CLI.
//   3. Gemini – Google OAuth runtime.
//

import Foundation

// MARK: - The structured result the model produces for an email.

/// Categories the triage model is allowed to choose from.
enum MailCategory: String, CaseIterable, Codable {
    case urgent      = "Urgent"
    case personal    = "Personal"
    case work        = "Work"
    case finance     = "Finance"
    case newsletter  = "Newsletter"
    case promotion   = "Promotion"
    case social      = "Social"
    case spam        = "Spam"
    case other       = "Other"

    var symbol: String {
        switch self {
        case .urgent:     return "exclamationmark.circle.fill"
        case .personal:   return "person.fill"
        case .work:       return "briefcase.fill"
        case .finance:    return "creditcard.fill"
        case .newsletter: return "newspaper.fill"
        case .promotion:  return "tag.fill"
        case .social:     return "bubble.left.and.bubble.right.fill"
        case .spam:       return "xmark.bin.fill"
        case .other:      return "tray.fill"
        }
    }
}

/// What every engine returns after reading an email.
struct MailTriage: Equatable, Codable {
    var summary: String
    var category: MailCategory
    var actionRequired: Bool
    var suggestedReply: String?
    var execution: AIExecutionMetadata?

    static let placeholder = MailTriage(
        summary: "", category: .other, actionRequired: false, suggestedReply: nil, execution: nil)
}

// MARK: - Provider protocol

protocol AIProvider: Sendable {
    /// Human-readable name for UI.
    var displayName: String { get }
    /// Whether the provider is ready to be used right now (signed in / available).
    func isReady() async -> Bool
    /// Read an email and return a structured triage.
    func triage(subject: String, from: String, body: String) async throws -> MailTriage
    /// Draft a reply in the user's voice given optional guidance.
    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> String
    func complete(instructions: String, prompt: String) async throws -> String
}

enum AIProviderID: String, CaseIterable, Identifiable, Codable {
    case gemini
    case chatgpt
    case claude
    case copilot
    case grok

    var id: String { rawValue }
    var backendProviderID: String {
        switch self {
        case .gemini: return "google_gemini"
        case .chatgpt: return "openai"
        case .claude: return "claude"
        case .copilot: return "copilot"
        case .grok: return "grok"
        }
    }
}

enum AIProviderAuthType: String, Codable {
    case oauth = "OAUTH"
    case openAIAPIReference = "OPENAI_API_REFERENCE"
    case future = "FUTURE"
}

enum AIProviderConnectionStatus: String, CaseIterable, Codable {
    case notConnected = "NOT_CONNECTED"
    case connecting = "CONNECTING"
    case connected = "CONNECTED"
    case tokenExpired = "TOKEN_EXPIRED"
    case reconnectRequired = "RECONNECT_REQUIRED"
    case error = "ERROR"
    case disabled = "DISABLED"
    case unavailable = "UNAVAILABLE"
    case unsupported = "UNSUPPORTED"
}

enum AIProviderCapability: String, CaseIterable, Identifiable, Codable {
    case chat
    case mailSummary = "mail_summary"
    case draftReply = "draft_reply"
    case translation
    case mailSearch = "mail_search"
    case safeTest = "safe_test"
    case threadSummary = "thread_summary"
    case toneRewrite = "tone_rewrite"
    case future

    var id: String { rawValue }
    var title: String {
        switch self {
        case .chat: return "Chat"
        case .mailSummary: return "Mail summary"
        case .draftReply: return "Draft reply"
        case .translation: return "Translation"
        case .mailSearch: return "Mail search"
        case .safeTest: return "Safe test"
        case .threadSummary: return "Thread summary"
        case .toneRewrite: return "Tone rewrite"
        case .future: return "Future"
        }
    }
}

struct AIProviderHealth: Codable, Hashable {
    var state: String
    var detail: String
}

struct AIProviderSmokeResult: Codable, Hashable {
    var status: String
    var detail: String
    var at: Date?
}

struct AIProviderContract: Identifiable, Codable, Hashable {
    var provider_id: AIProviderID
    var provider_name: String
    var auth_type: AIProviderAuthType
    var status: AIProviderConnectionStatus
    var capabilities: [AIProviderCapability]
    var health: AIProviderHealth
    var last_refresh: Date?
    var display_name: String
    var future_metadata: [String: String]
    var connect_action_available: Bool
    var disconnect_action_available: Bool
    var reconnect_action_available: Bool
    var runtime_available: Bool
    var usable_now: Bool
    var status_reason: String
    var oauth_metadata_available: Bool
    var runtime_metadata_available: Bool
    var last_smoke_result: String?
    var last_smoke_at: Date?
    var safe_user_action_available: Bool
    var runtime_mode: String
    var connectable_now: Bool
    var requires_pairing: Bool
    var requires_owner_mac_online: Bool
    var last_error_code: String?
    var last_error_message_redacted: String?
    var local_only: Bool
    var visible_in_provider_list: Bool
    var visible_in_action_picker: Bool
    var action_picker_enabled: Bool

    var id: String { provider_id.rawValue }
}

struct AIProviderRegistryEntry: Identifiable, Hashable {
    let providerID: AIProviderID
    let providerName: String
    let displayName: String
    let authType: AIProviderAuthType
    let capabilities: [AIProviderCapability]
    let futureMetadata: [String: String]

    var id: String { providerID.rawValue }
}

enum AIProviderRegistry {
    static let allProviders: [AIProviderRegistryEntry] = [
        AIProviderRegistryEntry(
            providerID: .gemini,
            providerName: "Gemini",
            displayName: "Gemini",
            authType: .oauth,
            capabilities: [.chat, .mailSummary, .draftReply, .translation, .mailSearch, .safeTest, .threadSummary, .toneRewrite, .future],
            futureMetadata: [
                "runtime": "google_gemini",
                "runtime_mode": "google_oauth_cloud_runtime",
                "oauth_framework": "google_oauth_reference",
                "oauth_metadata": "present",
                "runtime_metadata": "present",
                "oauth_retry_enabled": "true",
                "last_error_code": "google_oauth_access_denied_if_google_console_not_ready",
                "last_error_message_redacted": "If Google returns Error 403, confirm this Google account is approved in the OAuth test-user list or complete Google verification.",
                "google_oauth_action_required": "retry_oauth_or_confirm_google_oauth_test_user_or_complete_google_verification",
                "visible_in_provider_list": "true",
                "visible_in_action_picker": "true"
            ]
        ),
        AIProviderRegistryEntry(
            providerID: .chatgpt,
            providerName: "ChatGPT",
            displayName: "ChatGPT Local Broker",
            authType: .openAIAPIReference,
            capabilities: [.chat, .mailSummary, .draftReply, .translation, .safeTest, .threadSummary, .toneRewrite, .future],
            futureMetadata: [
                "runtime": "chatgpt_codex_cli",
                "runtime_mode": "owner_mac_local_broker",
                "credential_reference": "owner_mac_codex_cli_access_token_reference",
                "oauth_framework": "chatgpt_admin_access_token_reference",
                "oauth_metadata": "local_not_applicable",
                "runtime_metadata": "present_local_broker",
                "temporary_freeze": "false",
                "local_only": "true",
                "requires_owner_mac_online": "true",
                "pairing_required": "true",
                "transport_auth_required": "http_local_signed_hmac",
                "browser_session_reuse": "forbidden",
                "token_file_access": "forbidden",
                "owner_mac_broker_url_key": "ownerMacBrokerURL",
                "usable_requires_broker_smoke": "true",
                "last_error_code": "owner_mac_local_broker_unpaired_or_offline",
                "last_error_message_redacted": "Pair Owner Mac and run a safe synthetic broker smoke before ChatGPT actions are available.",
                "visible_in_provider_list": "true",
                "visible_in_action_picker": "true"
            ]
        ),
        AIProviderRegistryEntry(
            providerID: .claude,
            providerName: "Claude",
            displayName: "Claude",
            authType: .oauth,
            capabilities: [.chat, .mailSummary, .draftReply, .translation, .mailSearch, .safeTest, .threadSummary, .toneRewrite, .future],
            futureMetadata: ["runtime": "claude_official_runtime_if_available", "runtime_mode": "adapter_ready_runtime_missing", "oauth_framework": "future_oauth_reference", "oauth_metadata": "missing", "runtime_metadata": "missing", "visible_in_provider_list": "true", "visible_in_action_picker": "false"]
        ),
        AIProviderRegistryEntry(
            providerID: .copilot,
            providerName: "Copilot",
            displayName: "Copilot",
            authType: .oauth,
            capabilities: [.chat, .mailSummary, .draftReply, .translation, .mailSearch, .safeTest, .threadSummary, .toneRewrite, .future],
            futureMetadata: ["runtime": "microsoft_copilot", "runtime_mode": "adapter_ready_runtime_missing", "oauth_framework": "future_oauth_reference", "oauth_metadata": "missing", "runtime_metadata": "missing", "visible_in_provider_list": "true", "visible_in_action_picker": "false"]
        ),
        AIProviderRegistryEntry(
            providerID: .grok,
            providerName: "Grok",
            displayName: "Grok",
            authType: .oauth,
            capabilities: [.chat, .mailSummary, .draftReply, .translation, .mailSearch, .safeTest, .threadSummary, .toneRewrite, .future],
            futureMetadata: ["runtime": "grok_official_runtime_if_available", "runtime_mode": "adapter_ready_runtime_missing", "oauth_framework": "future_oauth_reference", "oauth_metadata": "missing", "runtime_metadata": "missing", "visible_in_provider_list": "true", "visible_in_action_picker": "false"]
        )
    ]

    static func contract(
        for entry: AIProviderRegistryEntry,
        status: AIProviderConnectionStatus = .notConnected,
        health: AIProviderHealth? = nil,
        lastRefresh: Date? = nil,
        usableNow: Bool = false,
        smokeResult: AIProviderSmokeResult? = nil
    ) -> AIProviderContract {
        let canConnect = entry.providerID == .gemini && (status == .notConnected || status == .reconnectRequired || status == .tokenExpired || status == .error)
        let canDisconnect = entry.providerID == .gemini && status == .connected
        let oauthMetadataAvailable = entry.futureMetadata["oauth_metadata"] == "present"
            || entry.futureMetadata["oauth_metadata"] == "future_not_connected"
            || entry.futureMetadata["oauth_metadata"] == "local_not_applicable"
        let runtimeMetadataAvailable = entry.futureMetadata["runtime_metadata"] == "present"
            || entry.futureMetadata["runtime_metadata"] == "present_cloud_scaffold"
            || entry.futureMetadata["runtime_metadata"] == "present_local_broker"
        let pairingRequired = entry.futureMetadata["pairing_required"] == "true"
        let ownerMacRequired = entry.futureMetadata["requires_owner_mac_online"] == "true"
        let localOnly = entry.futureMetadata["local_only"] == "true"
        let visibleInPicker = entry.futureMetadata["visible_in_action_picker"] == "true"
        let runtimeMode = entry.futureMetadata["runtime_mode"] ?? entry.futureMetadata["runtime"] ?? "unknown"
        let isTemporarilyFrozen = entry.futureMetadata["temporary_freeze"] == "true"
        let hasBrokerSmokeEvidence = entry.providerID == .chatgpt && smokeResult?.status == "PASS"
        let statusReason = smokeResult.map { "\($0.status): \($0.detail)" } ?? (health?.detail ?? defaultHealthDetail(for: status))
        let actionPickerEnabled = visibleInPicker && (
            (usableNow && status == .connected && smokeResult?.status == "PASS")
            || hasBrokerSmokeEvidence
        )
        return AIProviderContract(
            provider_id: entry.providerID,
            provider_name: entry.providerName,
            auth_type: entry.authType,
            status: status,
            capabilities: entry.capabilities,
            health: health ?? AIProviderHealth(state: status.rawValue, detail: defaultHealthDetail(for: status)),
            last_refresh: lastRefresh,
            display_name: entry.displayName,
            future_metadata: entry.futureMetadata,
            connect_action_available: isTemporarilyFrozen ? false : canConnect,
            disconnect_action_available: canDisconnect,
            reconnect_action_available: canConnect && status != .notConnected,
            runtime_available: isTemporarilyFrozen ? false : status == .connected || hasBrokerSmokeEvidence,
            usable_now: isTemporarilyFrozen ? false : (usableNow && status == .connected) || hasBrokerSmokeEvidence,
            status_reason: statusReason,
            oauth_metadata_available: oauthMetadataAvailable,
            runtime_metadata_available: runtimeMetadataAvailable,
            last_smoke_result: smokeResult?.status,
            last_smoke_at: smokeResult?.at,
            safe_user_action_available: (usableNow && status == .connected && smokeResult?.status == "PASS") || hasBrokerSmokeEvidence,
            runtime_mode: runtimeMode,
            connectable_now: isTemporarilyFrozen ? false : canConnect || entry.providerID == .chatgpt,
            requires_pairing: pairingRequired,
            requires_owner_mac_online: ownerMacRequired,
            last_error_code: entry.futureMetadata["last_error_code"],
            last_error_message_redacted: smokeResult?.status == "FAIL" ? smokeResult?.detail : entry.futureMetadata["last_error_message_redacted"],
            local_only: localOnly,
            visible_in_provider_list: entry.futureMetadata["visible_in_provider_list"] != "false",
            visible_in_action_picker: visibleInPicker,
            action_picker_enabled: actionPickerEnabled
        )
    }

    static func contracts(
        readiness: [AIProviderKind: Bool],
        geminiOAuthStatus: GeminiOAuthStatus?,
        usability: [AIProviderID: Bool] = [:],
        smokeResults: [AIProviderID: AIProviderSmokeResult] = [:]
    ) -> [AIProviderContract] {
        allProviders.map { entry in
            let status = statusFor(entry.providerID, readiness: readiness, geminiOAuthStatus: geminiOAuthStatus)
            let health = AIProviderHealth(state: status.rawValue, detail: healthDetail(for: entry.providerID, status: status, geminiOAuthStatus: geminiOAuthStatus))
            return contract(for: entry, status: status, health: health, lastRefresh: nil, usableNow: usability[entry.providerID] == true, smokeResult: smokeResults[entry.providerID])
        }
    }

    private static func statusFor(
        _ providerID: AIProviderID,
        readiness: [AIProviderKind: Bool],
        geminiOAuthStatus: GeminiOAuthStatus?
    ) -> AIProviderConnectionStatus {
        switch providerID {
        case .gemini:
            if geminiOAuthStatus?.authorized == true || readiness[.gemini] == true {
                return .connected
            }
            if geminiOAuthStatus?.configured == false {
                return .disabled
            }
            if geminiOAuthStatus?.status.localizedCaseInsensitiveContains("expired") == true {
                return .tokenExpired
            }
            if geminiOAuthStatus?.status.localizedCaseInsensitiveContains("error") == true {
                return .error
            }
            if geminiOAuthStatus?.configured == true {
                return .reconnectRequired
            }
            return .notConnected
        case .chatgpt:
            return .connected
        case .claude, .copilot, .grok:
            return .unavailable
        }
    }

    private static func healthDetail(
        for providerID: AIProviderID,
        status: AIProviderConnectionStatus,
        geminiOAuthStatus: GeminiOAuthStatus?
    ) -> String {
        if providerID == .gemini, let reason = geminiOAuthStatus?.reason, !reason.isEmpty {
            return reason
        }
        if providerID == .gemini {
            return "Google OAuth authorization is required. If Google returns Error 403, confirm this Google account is approved in the OAuth test-user list or complete Google verification."
        }
        if providerID == .chatgpt {
            return "Owner Mac Local Broker. Requires paired Owner Mac, authenticated Codex CLI, HMAC signed transport, and PASS synthetic smoke. NEXORA never reads browser sessions, cookies, token files, OAuth codes, or refresh tokens."
        }
        return defaultHealthDetail(for: status)
    }

    private static func defaultHealthDetail(for status: AIProviderConnectionStatus) -> String {
        switch status {
        case .notConnected: return "OAuth reference is not connected."
        case .connecting: return "OAuth connection is in progress."
        case .connected: return "OAuth reference is connected."
        case .tokenExpired: return "OAuth reference needs refresh."
        case .reconnectRequired: return "OAuth reference must be reconnected."
        case .error: return "Provider needs attention."
        case .disabled: return "Provider is disabled in this build."
        case .unavailable: return "Provider OAuth is unavailable in this build."
        case .unsupported: return "Provider is not supported in this build."
        }
    }
}

enum AIProviderKind: String, CaseIterable, Identifiable, Codable {
    case apple = "apple_local"
    case foundation = "apple_foundation_models"
    case chatgpt = "openai_chatgpt"
    case gemini = "google_gemini"
    case claude = "anthropic_claude"
    case disabled = "mock_disabled"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .apple:   return "Apple Intelligence"
        case .foundation: return "Apple Foundation Models"
        case .chatgpt: return "ChatGPT"
        case .gemini:  return "Gemini"
        case .claude: return "Claude"
        case .disabled: return "AI Disabled"
        }
    }
    var subtitle: String {
        switch self {
        case .apple:   return "Local · Private · No sign-in"
        case .foundation: return "On-device structured generation"
        case .chatgpt: return "Cloud ChatGPT provider"
        case .gemini:  return "Account authorization unavailable"
        case .claude: return "Unavailable in this build"
        case .disabled: return "No model calls"
        }
    }
    var symbol: String {
        switch self {
        case .apple:   return "apple.logo"
        case .foundation: return "cpu"
        case .chatgpt: return "bubble.left.fill"
        case .gemini:  return "sparkles"
        case .claude: return "brain.head.profile"
        case .disabled: return "nosign"
        }
    }
    var modelName: String {
        switch self {
        case .apple, .foundation: return "Apple Foundation Models"
        case .chatgpt: return "ChatGPT"
        case .gemini: return "Gemini"
        case .claude: return "Claude"
        case .disabled: return "Disabled"
        }
    }
    var locality: String { isCloud ? "cloud" : "local" }
}

enum AIError: LocalizedError {
    case unavailable(String)
    case notSignedIn(String)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .unavailable(let m): return m
        case .notSignedIn(let m): return m
        case .failed(let m):      return m
        }
    }
}

// MARK: - Router

/// Resolves the user's chosen provider and forwards calls. Falls back to the
/// on-device model when a cloud provider isn't ready, so the app always works.
actor AIRouter {
    private var apple: AppleFoundationProvider
    private var openAI: OpenAIProvider
    private var gemini: GeminiProvider
    private var claude: AnthropicProvider
    private(set) var preferred: AIProviderKind
    private var consent: AIConsent = .default

    init(preferred: AIProviderKind) {
        self.preferred = preferred
        self.apple = AppleFoundationProvider()
        self.openAI = OpenAIProvider()
        self.gemini = GeminiProvider()
        self.claude = AnthropicProvider()
    }

    func setPreferred(_ kind: AIProviderKind) { preferred = kind }
    func setConsent(_ consent: AIConsent) { self.consent = consent }

    private func provider(_ kind: AIProviderKind) -> AIProvider {
        switch kind {
        case .apple, .foundation: return apple
        case .chatgpt: return openAI
        case .gemini:  return gemini
        case .claude: return claude
        case .disabled: return DisabledAIProvider()
        }
    }

    private struct Resolution {
        let requested: AIProviderKind
        let executed: AIProviderKind
        let provider: AIProvider
        let reason: String?
    }

    /// Returns the exact engine used, including fallback reason for UI truth.
    private func activeProvider() async -> Resolution {
        guard consent.aiEnabled else {
            return Resolution(requested: preferred, executed: .disabled, provider: DisabledAIProvider(), reason: "AI disabled by consent")
        }
        if preferred.isCloud && !consent.cloudAIEnabled {
            return Resolution(requested: preferred, executed: .apple, provider: apple, reason: "Cloud AI consent is disabled")
        }
        let p = provider(preferred)
        if await p.isReady() {
            return Resolution(requested: preferred, executed: preferred, provider: p, reason: nil)
        }
        return Resolution(requested: preferred, executed: .apple, provider: apple, reason: "Provider unavailable")
    }

    private func metadata(for resolution: Resolution) -> AIExecutionMetadata {
        AIExecutionMetadata(
            requestedProvider: resolution.requested,
            executedProvider: resolution.executed,
            provider: resolution.executed.title,
            model: resolution.executed.modelName,
            localOrCloud: resolution.executed.locality,
            generatedAt: Date(),
            fallbackReason: resolution.reason
        )
    }

    func triage(subject: String, from: String, body: String) async throws -> MailTriage {
        let resolution = await activeProvider()
        var result = try await resolution.provider.triage(subject: subject, from: from, body: body)
        result.execution = metadata(for: resolution)
        return result
    }

    func triageLocal(subject: String, from: String, body: String) async throws -> MailTriage {
        var result = try await apple.triage(subject: subject, from: from, body: body)
        result.execution = AIExecutionMetadata(
            requestedProvider: .apple,
            executedProvider: .apple,
            provider: AIProviderKind.apple.title,
            model: AIProviderKind.apple.modelName,
            localOrCloud: AIProviderKind.apple.locality,
            generatedAt: Date(),
            fallbackReason: "Local Apple Intelligence briefing path"
        )
        return result
    }

    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> AITextResult {
        let resolution = await activeProvider()
        let text = try await resolution.provider.draftReply(subject: subject, from: from, body: body, guidance: guidance)
        return AITextResult(text: text, metadata: metadata(for: resolution))
    }

    func draftReplyLocal(subject: String, from: String, body: String, guidance: String?) async throws -> AITextResult {
        let text = try await apple.draftReply(subject: subject, from: from, body: body, guidance: guidance)
        return AITextResult(
            text: text,
            metadata: AIExecutionMetadata(
                requestedProvider: .apple,
                executedProvider: .apple,
                provider: AIProviderKind.apple.title,
                model: AIProviderKind.apple.modelName,
                localOrCloud: AIProviderKind.apple.locality,
                generatedAt: Date(),
                fallbackReason: "Local Apple Intelligence draft path"
            )
        )
    }

    func readiness() async -> [AIProviderKind: Bool] {
        var out: [AIProviderKind: Bool] = [:]
        out[.apple]   = await apple.isReady()
        out[.foundation] = await apple.isReady()
        out[.chatgpt] = await openAI.isReady()
        out[.gemini]  = await gemini.isReady()
        out[.claude] = await claude.isReady()
        out[.disabled] = true
        return out
    }

    func complete(instructions: String, prompt: String) async throws -> AITextResult {
        let resolution = await activeProvider()
        let text = try await resolution.provider.complete(instructions: instructions, prompt: prompt)
        return AITextResult(text: text, metadata: metadata(for: resolution))
    }

    func completeLocal(instructions: String, prompt: String) async throws -> AITextResult {
        let text = try await apple.complete(instructions: instructions, prompt: prompt)
        return AITextResult(
            text: text,
            metadata: AIExecutionMetadata(
                requestedProvider: .apple,
                executedProvider: .apple,
                provider: AIProviderKind.apple.title,
                model: AIProviderKind.apple.modelName,
                localOrCloud: AIProviderKind.apple.locality,
                generatedAt: Date(),
                fallbackReason: "Local Apple Intelligence path"
            )
        )
    }

    // MARK: - Loop 4 Copilot verbs (rewrite / briefing / extractActions)
    // All are built on `complete()`, so each result carries the same provider
    // attribution (AIExecutionMetadata) as triage/draftReply — no black box.

    /// Rewrite the user's draft in a given tone. Preserves meaning and facts.
    func rewrite(_ text: String, style: String) async throws -> AITextResult {
        try await complete(
            instructions: "Rewrite the user's draft in a \(style) tone. Preserve meaning and "
                + "facts. Output only the rewritten text, no preamble.",
            prompt: text)
    }

    /// Produce a morning briefing from a set of email bodies.
    func briefing(_ emails: [String]) async throws -> AITextResult {
        try await complete(
            instructions: "You produce a morning briefing from a mailbox. Sections: Pending "
                + "replies, Open risks, Deadlines, Invoices/Contracts, Meetings. Be factual; "
                + "never invent items that are not present in the emails.",
            prompt: emails.joined(separator: "\n\n---\n\n"))
    }

    /// Extract concrete, structured actions from one email. Returns the parsed
    /// actions plus the provider metadata for the badge.
    func extractActions(subject: String, body: String) async throws -> AIActionsResult {
        let result = try await complete(
            instructions: "Extract concrete actions from this email. Return ONLY a JSON array "
                + "of {\"title\":string,\"due\":string|null,\"kind\":one of "
                + "[task,deadline,meeting,approval,invoice,contract,payment]}. No prose.",
            prompt: "Subject: \(subject)\n\n\(body)")
        let actions = (try? JSONDecoder().decode([ExtractedAction].self,
                                                 from: Data(result.text.utf8))) ?? []
        return AIActionsResult(actions: actions, metadata: result.metadata)
    }
}

/// A single structured action extracted from an email (Loop 4 Mail -> Task).
struct ExtractedAction: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var due: String?
    var kind: String

    private enum CodingKeys: String, CodingKey { case title, due, kind }
}

/// Result of `extractActions`, carrying provider attribution for the UI badge.
struct AIActionsResult {
    let actions: [ExtractedAction]
    let metadata: AIExecutionMetadata
}

extension AIProviderKind {
    var isCloud: Bool {
        switch self {
        case .chatgpt, .gemini, .claude: return true
        default: return false
        }
    }
}

struct DisabledAIProvider: AIProvider {
    let displayName = "AI Disabled"
    func isReady() async -> Bool { true }
    func triage(subject: String, from: String, body: String) async throws -> MailTriage {
        throw AIError.unavailable("AI is disabled in NEXORA Consent Center.")
    }
    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> String {
        throw AIError.unavailable("AI is disabled in NEXORA Consent Center.")
    }
    func complete(instructions: String, prompt: String) async throws -> String {
        throw AIError.unavailable("AI is disabled in NEXORA Consent Center.")
    }
}

// MARK: - Prompt building (shared)

enum AIPrompts {
    static func triageInstructions() -> String {
        """
        You are an email triage assistant inside a mail app. You read one email and \
        produce a tight, factual summary plus a single best-fit category. Be concise. \
        Never invent facts that are not in the email. The summary must be at most two \
        sentences. Mark actionRequired true only when the email clearly asks the \
        recipient to do or decide something.
        """
    }

    static func emailContext(subject: String, from: String, body: String) -> String {
        let trimmed = String(body.prefix(6000)) // keep within on-device context budget
        return """
        From: \(from)
        Subject: \(subject)

        Body:
        \(trimmed)
        """
    }

    static func replyInstructions() -> String {
        """
        You draft email replies. Match a clear, friendly, professional tone. Keep it \
        short unless the email requires detail. Do not include a subject line. Do not \
        invent commitments. Output only the reply body text.
        """
    }
}
