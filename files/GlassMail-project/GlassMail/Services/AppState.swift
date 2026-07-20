//
//  AppState.swift
//  GlassMail
//
//  The single source of truth the UI binds to. Owns configuration, the auth
//  session, the loaded mail, the AI router, and a per-email triage cache.
//

import Foundation
import CryptoKit
import SwiftUI
#if os(iOS)
import UIKit
import UserNotifications
#endif

@MainActor
final class AppState: ObservableObject {
    private enum LocalAIActionTimeout: Error {
        case exceeded
    }

    enum AppleLocalActionFailure: Error, Equatable {
        case unavailable(String)
        case timeout
        case cancelled
        case failed(String)

        var message: String {
            switch self {
            case .unavailable(let message): return message
            case .timeout: return "Apple Intelligence summary timed out. Try again."
            case .cancelled: return "Apple Intelligence action was cancelled."
            case .failed(let message): return message
            }
        }
    }

    static let appleLocalActionTimeoutSeconds: UInt64 = 20
    private static let localAIActionTimeoutNanoseconds: UInt64 = appleLocalActionTimeoutSeconds * 1_000_000_000

    enum Phase { case onboarding, ready }
    enum MailboxOnboardingState: String {
        case idle = "Idle"
        case authorizing = "Authorizing"
        case creatingMailbox = "Creating mailbox"
        case syncingMailbox = "Syncing mailbox"
        case loadingMessages = "Loading messages"
        case ready = "Ready"
        case blocked = "Blocked"
        case failed = "Failed"
    }

    enum SecureAuthHandoffState: String {
        case authNotRequired = "AUTH_NOT_REQUIRED"
        case authRequired = "AUTH_REQUIRED"
        case waitingForUserSecureInput = "WAITING_FOR_USER_SECURE_INPUT"
        case authInProgress = "AUTH_IN_PROGRESS"
        case authSuccess = "AUTH_SUCCESS"
        case authFailed = "AUTH_FAILED"
        case authExpired = "AUTH_EXPIRED"
        case provisioningContinued = "PROVISIONING_CONTINUED"
    }

    // MARK: Configuration (persisted)

    @AppStorage("serverURL") var serverURLString: String = "https://cloud-mail.fastonegroup.workers.dev"
    @AppStorage("domain") var domain: String = ""
    @AppStorage("preferredProvider") private var preferredProviderRaw: String = AIProviderKind.apple.rawValue
    @AppStorage("mailDensity") var mailDensityRaw: String = "comfortable"
    @AppStorage("nexora_active_workspace_id") private var persistedActiveWorkspaceId: Int = 0
    @AppStorage("remoteImageTrustedSenders") private var remoteImageTrustedSendersRaw: String = ""
    @AppStorage("remoteImageTrustedDomains") private var remoteImageTrustedDomainsRaw: String = ""

    var preferredProvider: AIProviderKind {
        get { AIProviderKind(rawValue: preferredProviderRaw) ?? .apple }
        set { preferredProviderRaw = newValue.rawValue
              Task { await router.setPreferred(newValue) } }
    }

    var chatGPTIsPaired: Bool {
        Keychain.get(Self.ownerMacBrokerPairIDKey) != nil && Keychain.get(Self.ownerMacBrokerPairSecretKey) != nil
    }

    var mailDensity: MailDensity {
        get { MailDensity(rawValue: mailDensityRaw) ?? .comfortable }
        set { mailDensityRaw = newValue.rawValue }
    }

    func remoteImagesAllowed(sender: String, domain: String) -> Bool {
        let normalizedSender = sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedDomain = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let senders = Set(remoteImageTrustedSendersRaw.split(separator: "\n").map { String($0) })
        let domains = Set(remoteImageTrustedDomainsRaw.split(separator: "\n").map { String($0) })
        return (!normalizedSender.isEmpty && senders.contains(normalizedSender))
            || (!normalizedDomain.isEmpty && domains.contains(normalizedDomain))
    }

    func trustRemoteImagesFromSender(_ sender: String) {
        remoteImageTrustedSendersRaw = updatedRemoteImageTrust(raw: remoteImageTrustedSendersRaw, value: sender)
    }

    func presentGlobalCompose(initialBody: String? = nil) {
        globalComposeInitialBody = initialBody?.trimmingCharacters(in: .whitespacesAndNewlines)
        showGlobalCompose = true
    }

    func clearGlobalComposePrefill() {
        globalComposeInitialBody = nil
    }

    func trustRemoteImagesFromDomain(_ domain: String) {
        remoteImageTrustedDomainsRaw = updatedRemoteImageTrust(raw: remoteImageTrustedDomainsRaw, value: domain)
    }

    private func updatedRemoteImageTrust(raw: String, value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return raw }
        var values = Set(raw.split(separator: "\n").map { String($0) })
        values.insert(normalized)
        return values.sorted().joined(separator: "\n")
    }

    // MARK: Runtime state

    @Published var phase: Phase = .onboarding
    @Published var currentUser: LoginUserInfo?
    @Published var selectedMainTab: Int = 2
    @Published var mainTabBarHidden: Bool = false
    @Published var settingsLaunchDestination: String?
    @Published var showCommandPalette: Bool = false
    @Published var showGlobalCompose: Bool = false
    @Published var globalComposeInitialBody: String?
    @Published var aiWorkspaceLaunchTabRaw: String?
    @Published var addresses: [MailAddress] = []
    @Published var emails: [EmailMessage] = []
    @Published var conversationProjections: [ConversationProjection] = []
    @Published private(set) var conversationProjectionsBySurface: [ConversationProjectionSurface: [ConversationProjection]] = [:]
    @Published private(set) var conversationProjectionAuthority: ConversationProjectionAuthority = .disabled
    @Published private(set) var conversationProjectionWorkspaceId: Int?
    @Published private(set) var conversationProjectionCutoverEpoch: String?
    @Published private(set) var availableWorkspaces: [WorkspaceSummary] = []
    @Published private(set) var activeWorkspaceId: Int?
    @Published var triageCache: [Int: MailTriage] = [:]
    @Published var triagingIDs: Set<Int> = []
    @Published var providerReadiness: [AIProviderKind: Bool] = [:]
    @Published var aiProviderUsability: [AIProviderID: Bool] = [:]
    @Published var aiProviderSmokeResults: [AIProviderID: AIProviderSmokeResult] = [:]
    @Published var aiConsentStatusMessage: String?
    @Published var lastTextAIExecution: AIExecutionMetadata?
    @Published var aiConsent: AIConsent = .default
    @Published var unifiedAccounts: [UnifiedMailAccount] = []
    @Published var geminiOAuthStatus: GeminiOAuthStatus?
    @Published var securityAnalyses: [Int: SecurityAnalysis] = [:]
    @Published var resetPasswordToken: String?
    @Published var activationToken: String?
    @Published var loginPrefillEmail: String?
    @Published var forwardingSettings: ForwardingSettingsResponse?
    @Published var gmailSyncStatusByAccountId: [Int: String] = [:]
    @Published var localOAuthAccessRequests: [LocalOAuthAccessRequest] = []
    @Published var governanceInvitations: [GovernanceInvitation] = []
    @Published var governanceAuditTrail: [GovernanceAuditEvent] = []
    @Published var lastGeneratedInvitationCode: String?
    @Published var mailClientProfile: MailClientProfile = .empty
    @Published var selectedLocalMailbox: LocalMailBoxKind = .inbox
    @Published var selectedInboxFilterRaw: String = UserDefaults.standard.string(forKey: "cloudmail_selected_inbox_filter_v1") ?? "all" {
        didSet { UserDefaults.standard.set(selectedInboxFilterRaw, forKey: "cloudmail_selected_inbox_filter_v1") }
    }
    @Published var drafts: [LocalMailDraft] = []
    @Published var sentMessages: [LocalSentMessage] = []
    @Published var outboxMessages: [LocalOutboxMessage] = []
    @Published var scheduledMessages: [LocalScheduledMessage] = []
    @Published var mailStateOverlay: MailStateOverlay = .empty
    @Published var mailUndoState: MailUndoState?
    @Published var mailUndoInProgress = false
    @Published var v2ProductivityRefreshTick: Int = 0
    @Published var cachedInboxRestored = false
    @Published var mailboxOnboardingState: MailboxOnboardingState = .idle
    @Published var mailboxOnboardingMessage: String?
    @Published var secureAuthState: SecureAuthHandoffState = .authNotRequired
    @Published var secureAuthEmail: String?
    @Published var secureAuthPrincipalEmail: String = ""
    @Published var secureAuthPrincipalLocked: Bool = false
    @Published var secureAuthProviderMessage: String?
    @Published var secureAuthDeadline: Date?
    @Published var secureAuthOutcomeMessage: String?
    private var secureAuthChallengeReference: String?
    private var secureAuthProvider: String = "cloudmail"
    @Published var syncStartedAt: Date?
    @Published var lastSyncCompletedAt: Date?
    @Published var lastSyncDuration: TimeInterval?
    @Published var refreshCount: Int = 0
    @Published var networkRequestCount: Int = 0
    @Published var duplicateRefreshSkipped: Int = 0
    @Published var malformedMailSkippedCount: Int = 0
    @Published var mailVisibilityTrace: MailVisibilityTrace = .empty
    @Published var missions: [AgentMission] = []
    @Published var executionPlans: [ExecutionPlan] = []
    @Published var deliverables: [Deliverable] = []
    @Published var nexoraGoals: [NexoraGoalRecord] = []
    @Published var nexoraMemory: [NexoraMemoryRecord] = []
    @Published var nexoraOutcomes: [NexoraOutcomeRecord] = []
    @Published var nexoraCollaborations: [NexoraCollaborationRun] = []
    @Published var nexoraOrganizationGraph = NexoraOrganizationGraph()
    @Published var nexoraV3Status = NexoraV3StatusSnapshot()
    @Published var iCloudProfileLastWrittenKey: String?
    @Published var iCloudProfileLastWriteVerified = false
    @Published var iCloudProfileLastChangedKeys: [String] = []
    @Published var iCloudProfileLastReadVerified = false
    @Published var iCloudProfileSyncStatus = "Not checked"

    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var selectedAccountId: Int?
    @Published var selectedProvider: UnifiedMailProvider?
    @Published var errorMessage: String?
    @Published private(set) var serverCorrelation: ServerCorrelationSnapshot = .idle

    private static let tokenKey = "cloudmail_token"
    /// Ephemeral per-process correlation key. It is never persisted and never
    /// participates in authentication or authorization.
    private let clientCorrelationNonce = UUID().uuidString
    private var serverCorrelationAttemptId = UUID()
    private static let secureDeviceReferenceKey = "cloudmail_secure_device_reference_v1"
    private static let profileKeyBase = "cloudmail_mail_client_profile_v1"
    private static let draftsKeyBase = "cloudmail_local_drafts_v1"
    private static let sentKeyBase = "cloudmail_local_sent_v1"
    private static let outboxKeyBase = "cloudmail_local_outbox_v1"
    private static let scheduledKeyBase = "cloudmail_local_scheduled_v1"
    private static let overlayKeyBase = "cloudmail_mail_state_overlay_v1"
    private static let inboxCacheKeyBase = "cloudmail_cached_inbox_v1"
    private static let accountsCacheKeyBase = "cloudmail_cached_accounts_v1"
    private static let lastUserEmailKey = "cloudmail_last_user_email"
    private static let lastRefreshKey = "cloudmail_last_refresh_at"
    static let themePreferenceKey = "cloudmail_theme"
    static let notificationsPreferenceKey = "cloudmail_notifications"
    static let aiEnabledPreferenceKey = "cloudmail_ai_enabled"
    static let cloudAIEnabledPreferenceKey = "cloudmail_cloud_ai_enabled"
    static let deviceContactsPreferenceKey = "cloudmail_directory_device_contacts_enabled"
    static let directoryLayoutPreferenceKey = "cloudmail_directory_layout"
    static let autocompletePreferenceKey = "cloudmail_autocomplete_enabled"
    private static let providerFreshnessWindow: TimeInterval = 60 * 60
    private static let ownerMacBrokerPairIDKey = "cloudmail_owner_mac_broker_pair_id"
    private static let ownerMacBrokerPairSecretKey = "cloudmail_owner_mac_broker_pair_secret"
    private static let ownerMacBrokerURLKey = "ownerMacBrokerURL"
    private static let localOAuthAccessRequestsKey = "cloudmail_local_oauth_access_requests_v1"
    private static let governanceInvitationsKey = "cloudmail_governance_invitations_v1"
    private static let governanceAuditTrailKey = "cloudmail_governance_audit_trail_v1"
    private static let missionsKeyBase = "cloudmail_nexora_missions_v1"
    private static let executionPlansKeyBase = "cloudmail_nexora_plans_v1"
    private static let deliverablesKeyBase = "cloudmail_nexora_deliverables_v1"
    private static let goalsKeyBase = "cloudmail_nexora_goals_v3"
    private static let memoryKeyBase = "cloudmail_nexora_memory_v3"
    private static let outcomesKeyBase = "cloudmail_nexora_outcomes_v3"
    private static let collaborationsKeyBase = "cloudmail_nexora_collaborations_v3"
    private static let organizationGraphKeyBase = "cloudmail_nexora_organization_graph_v3"

    private var backend: Backend
    private let router: AIRouter
    let mailCategoryEngine = MailCategoryEngine()
    let smartMailClassifier = SmartMailClassifier()
    let userClassificationMemory = UserClassificationMemory()
    let organizationClassificationMemory = OrganizationClassificationMemory()
    let externalReputationRegistry = ExternalReputationRegistry()
    let workOSIntelligenceEngine = WorkOSIntelligenceEngine()
    let nexoraIntelligenceEngine = NexoraIntelligenceEngine()
    let nexoraTrustEngine = NexoraTrustEngine()
    let nexoraAgentEngine = NexoraAgentEngine()
    let senderRuleEngine = SenderRuleEngine()
    let snoozeScheduler = SnoozeScheduler()
    let unsubscribeDetector = UnsubscribeDetector()
    let quickReplyTemplateStore = QuickReplyTemplateStore()
    let senderProfileStore = SenderProfileStore()
    let smartSearchRouter = SmartSearchRouter()
    let optionalReadReceiptManager = OptionalReadReceiptManager()
    let undoSendQueue = UndoSendQueue()
    private var mailboxDefaultApplied = false
    private var iCloudProfileSyncObserver: NSObjectProtocol?
    private var lastLoadMoreStartedAt: Date?
    private var refreshTask: Task<Void, Never>?
    private var mailboxSelectionRefreshTask: Task<Void, Never>?
    private var securityAnalysisInFlight: Set<Int> = []
    private var bootstrapTask: Task<Void, Never>?
    private var gmailForegroundSyncTask: Task<Void, Never>?
    private var smartMailClassificationCache: [Int: SmartMailClassification] = [:]
    private var smartMailCategoryCacheNeedsRebuild = true

    private var token: String? {
        didSet { Keychain.set(token, for: Self.tokenKey) }
    }

    @AppStorage("ownerMacBrokerURL") var ownerMacBrokerURL: String = "http://192.168.50.36:8766"

    var connectedGmailAccounts: [MailAddress] {
        addresses.filter { $0.displayProvider == .gmail || $0.displayProvider == .googleWorkspace }
    }

    func refreshNexoraV3(provider: String = "custom_domain") async {
        guard !nexoraV3Status.isLoading else { return }
        nexoraV3Status.isLoading = true
        nexoraV3Status.error = nil
        do {
            async let providers = backend.nexoraV3ProviderCapabilities()
            async let authority = backend.nexoraV3MaximizeAuthority(provider: provider)
            nexoraV3Status.providers = try await providers
            nexoraV3Status.authority = try await authority
            nexoraV3Status.lastCheckedAt = Date()
        } catch {
            nexoraV3Status.error = error.localizedDescription
        }
        nexoraV3Status.isLoading = false
    }

    func beginNexoraV3Onboarding(emailOrDomain: String) async {
        let normalized = emailOrDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let domainCandidate = normalized.split(separator: "@").last.map(String.init) ?? normalized
        guard domainCandidate.contains("."), !normalized.contains(" ") else {
            nexoraV3Status.error = "Enter a complete email address or domain."
            return
        }
        nexoraV3Status.isLoading = true
        nexoraV3Status.error = nil
        do {
            let onboarding = try await backend.nexoraV3Onboarding(emailOrDomain: normalized)
            nexoraV3Status.onboarding = onboarding
            nexoraV3Status.authority = onboarding.authority
            nexoraV3Status.lastCheckedAt = Date()
        } catch {
            nexoraV3Status.error = error.localizedDescription
        }
        nexoraV3Status.isLoading = false
    }

    var hasConnectedGmail: Bool {
        !connectedGmailAccounts.isEmpty
    }

    var primaryGmailAccount: MailAddress? {
        connectedGmailAccounts.sorted { lhs, rhs in
            lhs.email.localizedCaseInsensitiveCompare(rhs.email) == .orderedAscending
        }.first
    }

    var primaryCloudMailAccount: MailAddress? {
        addresses.filter { $0.displayProvider == .cloudflareNative }
            .sorted { lhs, rhs in
                lhs.email.localizedCaseInsensitiveCompare(rhs.email) == .orderedAscending
            }
            .first
    }

    var primaryIdentityEmail: String {
        mailClientProfile.primaryIdentityEmail ?? currentUser?.email ?? "Not signed in"
    }

    var sendingIdentities: [SendingIdentity] {
        composeFromAddresses
            .sorted { lhs, rhs in
                let leftOrder = mailClientProfile.mailboxDisplayOrder.firstIndex(of: lhs.email.lowercased()) ?? Int.max
                let rightOrder = mailClientProfile.mailboxDisplayOrder.firstIndex(of: rhs.email.lowercased()) ?? Int.max
                if leftOrder != rightOrder { return leftOrder < rightOrder }
                return lhs.email.localizedCaseInsensitiveCompare(rhs.email) == .orderedAscending
            }
            .map { account in
                let sendCapability = restoredSendCapability(for: account)
                return SendingIdentity(
                    accountId: account.accountId,
                    email: account.email,
                    provider: account.displayProvider,
                    domain: account.displayDomain,
                    canSend: sendCapability.canSend,
                    sendStatusReason: sendCapability.reason,
                    defaultSignature: signature(for: account.email)
                )
            }
    }

    var composeFromAddresses: [MailAddress] {
        var seenEmails = Set<String>()
        var rows: [MailAddress] = []
        
        for account in addresses {
            let emailLower = account.email.lowercased()
            guard !seenEmails.contains(emailLower) else { continue }
            seenEmails.insert(emailLower)
            rows.append(account)
        }
        
        rows.append(contentsOf: unifiedAccounts.compactMap { account in
            let emailLower = account.email.lowercased()
            guard account.canSend,
                  !seenEmails.contains(emailLower),
                  let readableAccountId = account.readableAccountId else {
                return nil
            }
            seenEmails.insert(emailLower)
            return MailAddress(
                accountId: readableAccountId,
                email: account.email,
                name: account.displayName,
                latestEmailTime: nil,
                allReceive: nil,
                provider: account.provider,
                domain: account.email.split(separator: "@").last.map(String.init),
                syncStatus: account.status,
                lastSyncedAt: nil,
                syncError: nil,
                lastSyncAttemptAt: nil,
                lastSuccessfulSyncAt: nil,
                lastMessageReceivedAt: nil,
                lastProviderCheckpointAt: nil,
                lastSyncFailureAt: nil,
                syncFailureReason: nil
            )
        })
        
        return rows
    }

    var defaultSendingIdentity: SendingIdentity? {
        if let selected = mailClientProfile.defaultSendingAddress?.lowercased(),
           let match = sendingIdentities.first(where: { $0.email.lowercased() == selected && $0.canSend }) {
            return match
        }
        if let primary = currentUser?.email?.lowercased(),
           let match = sendingIdentities.first(where: { $0.email.lowercased() == primary && $0.canSend }) {
            return match
        }
        return sendingIdentities.first(where: \.canSend) ?? sendingIdentities.first
    }

    var mailboxHealthSnapshots: [MailboxHealthSnapshot] {
        let accountRows = addresses.map { account in
            let messageCount = emails.filter { email in
                email.accountId == account.accountId || email.sourceAccount.caseInsensitiveCompare(account.email) == .orderedSame
            }.count
            let state = healthState(for: account)
            return MailboxHealthSnapshot(
                id: "address-\(account.accountId)",
                provider: account.displayProvider,
                account: account.email,
                domain: account.displayDomain,
                state: state,
                messageCount: messageCount,
                visibleMessages: messageCount,
                indexedMessages: emails.count,
                mailboxSource: account.displayProvider.title,
                lastSyncLabel: syncLabel(for: account),
                latencyLabel: syncLatencyLabel,
                queueLabel: syncQueueLabel,
                authorizationLabel: authorizationLabel(for: account),
                currentSyncState: syncStateLabel(for: account),
                progressLabel: state == .syncing || state == .initialSyncRunning ? "67%" : nil
            )
        }
        if !accountRows.isEmpty { return accountRows }
        return [
            MailboxHealthSnapshot(
                id: "cloudmail-primary",
                provider: .cloudflareNative,
                account: primaryIdentityEmail,
                domain: domain,
                state: phase == .ready ? .connected : .unavailable,
                messageCount: emails.count,
                visibleMessages: emails.count,
                indexedMessages: emails.count,
                mailboxSource: mailboxSourcesLabel,
                lastSyncLabel: syncLabel(nil),
                latencyLabel: syncLatencyLabel,
                queueLabel: syncQueueLabel,
                authorizationLabel: phase == .ready ? "Session authorized" : "Sign in required",
                currentSyncState: syncStateLabel,
                progressLabel: isLoading ? "Loading" : nil
            )
        ]
    }

    var dataTrustSnapshot: MailDataTrustSnapshot {
        MailDataTrustSnapshot(
            visibleMessages: emails.count,
            indexedMessages: emails.count,
            mailboxSources: mailboxSourcesLabel,
            lastUpdated: authoritativeSyncLabel,
            currentFilter: selectedLocalMailbox == .inbox ? inboxFilterDisplayLabel : selectedLocalMailbox.title,
            currentIdentity: currentIdentityLabel,
            dataFreshness: dataFreshnessLabel
        )
    }

    var mailboxMetricsTruthSnapshot: MailboxMetricsTruthSnapshot {
        MailboxMetricsTruthSnapshot(
            drafts: drafts.count,
            sent: sentMessages.count,
            outbox: outboxMessages.filter { $0.deliveryState != .cancelled }.count,
            scheduled: scheduledMessages.count,
            unread: emails.filter(\.isUnread).count,
            allMail: emails.count + sentMessages.count + outboxMessages.count + drafts.count + scheduledMessages.count,
            source: "Global Message Ledger + local drafts/sent/outbox/scheduled ledger"
        )
    }

    var syncObservabilitySnapshot: MailSyncObservabilitySnapshot {
        MailSyncObservabilitySnapshot(
            currentMailbox: currentIdentityLabel,
            currentFolder: selectedLocalMailbox.title,
            currentSyncState: syncStateLabel,
            lastSuccessfulSync: authoritativeSyncLabel,
            lastFailedSync: lastSyncFailureLabel,
            retryCountdown: lastSyncFailureLabel == "None" ? "Not scheduled" : "Manual retry available",
            syncProgress: syncProgressLabel,
            queueDepth: syncQueueLabel,
            lastError: currentSyncErrorLabel,
            latency: syncLatencyLabel
        )
    }

    var mailOSBriefingSnapshot: MailOSBriefingSnapshot {
        mailOSBriefingSnapshot(for: emails)
    }

    func mailOSBriefingSnapshot(for sourceEmails: [EmailMessage]) -> MailOSBriefingSnapshot {
        var needReply = 0
        var waiting = 0
        var followUp = 0
        var urgent = 0
        var personal = 0
        var updates = 0
        var newsletter = 0
        var system = 0
        for email in sourceEmails {
            let triage = triageCache[email.emailId]
            let haystack = email.searchableSnippet
            let isBulk = triage?.category == .promotion
                || triage?.category == .newsletter
                || haystack.contains("unsubscribe")
            // Promotional/newsletter/bulk wording must never create an executive
            // action, waiting, follow-up, or urgent count merely by using words
            // such as "reply", "urgent", or "deadline" in campaign copy.
            if !isBulk && (triage?.actionRequired == true || haystack.contains("please reply") || haystack.contains("can you") || haystack.contains("let me know")) { needReply += 1 }
            if !isBulk && (haystack.contains("waiting") || haystack.contains("pending") || haystack.contains("checking in")) { waiting += 1 }
            if !isBulk && (haystack.contains("follow up") || haystack.contains("follow-up") || haystack.contains("circle back")) { followUp += 1 }
            if !isBulk && (triage?.category == .urgent
                || triage?.actionRequired == true || haystack.contains("urgent") || haystack.contains("asap") || haystack.contains("deadline")) {
                urgent += 1
            }
            if triage?.category == .personal { personal += 1 }
            if triage?.category == .promotion || email.attachmentSignalCount > 0 { updates += 1 }
            if triage?.category == .newsletter || haystack.contains("unsubscribe") { newsletter += 1 }
            if haystack.contains("security") || haystack.contains("system") || haystack.contains("alert") { system += 1 }
        }
        return MailOSBriefingSnapshot(
            needReply: needReply,
            waiting: waiting,
            followUp: followUp,
            urgent: urgent,
            personal: personal,
            updates: updates,
            newsletter: newsletter,
            system: system
        )
    }

    var aiRuntimeStatusSnapshot: AIRuntimeStatusSnapshot {
        if !aiConsent.aiEnabled {
            return AIRuntimeStatusSnapshot(
                title: "Runtime Disabled",
                detail: "AI Mail Summaries are off.",
                providerStates: ["Apple Intelligence disabled"],
                syntheticReady: false
            )
        }
        let localReady = providerReadiness[.foundation] == true || providerReadiness[.apple] == true
        return AIRuntimeStatusSnapshot(
            title: localReady ? "Apple Intelligence Active" : "Apple Intelligence Not Ready",
            detail: "NEXORA AI runs locally through Apple Intelligence only.",
            providerStates: [
                localReady ? "Apple Intelligence Active" : "Apple Intelligence Offline"
            ],
            syntheticReady: localReady
        )
    }

    private var currentIdentityLabel: String {
        if let selectedAccountId,
           let account = addresses.first(where: { $0.accountId == selectedAccountId }) {
            return "\(account.email) · \(account.displayProvider.title)"
        }
        if let selectedProvider {
            return "\(selectedProvider.title) · \(primaryIdentityEmail)"
        }
        return "All connected mailboxes"
    }

    private var mailboxSourcesLabel: String {
        let providers = Set(emails.map(\.sourceProvider.title))
        if providers.isEmpty {
            let accountProviders = Set(addresses.map(\.displayProvider.title))
            return accountProviders.isEmpty ? "No sources loaded" : accountProviders.sorted().joined(separator: ", ")
        }
        return providers.sorted().joined(separator: ", ")
    }

    private var inboxFilterDisplayLabel: String {
        switch selectedInboxFilterRaw {
        case "all": return "All"
        case "today": return "Today"
        case "needsReply": return "Needs Reply"
        case "priority": return "Priority"
        case "waiting": return "Waiting"
        case "followUp": return "Follow Up"
        case "urgent": return "Urgent"
        case "personal": return "Personal"
        case "updates": return "Updates"
        case "promotion": return "Promotion"
        case "social": return "Social"
        case "junk": return "Junk"
        case "newsletter": return "Newsletter"
        case "system": return "System"
        case "unread": return "Unread"
        case "starred": return "Starred"
        case "gmail": return "Gmail"
        case "cloudMail": return "NEXORA Mail"
        default: return selectedInboxFilterRaw.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private var syncLatencyLabel: String {
        guard let lastSyncDuration else {
            return syncStartedAt == nil ? "Latency pending" : "Measuring"
        }
        if lastSyncDuration < 1 {
            return "\(Int(lastSyncDuration * 1000))ms"
        }
        return String(format: "%.1fs", lastSyncDuration)
    }

    private var syncQueueLabel: String {
        if isLoading || syncStartedAt != nil { return "Queue running" }
        if isLoadingMore { return "Loading older mail" }
        if mailboxOnboardingState == .syncingMailbox { return "Mailbox onboarding" }
        return "Queue clear"
    }

    private var syncStateLabel: String {
        if let message = mailboxOnboardingMessage, !message.isEmpty {
            return message
        }
        if isLoading { return "Refreshing" }
        if isLoadingMore { return "Fetching older mail" }
        if syncStartedAt != nil { return "Fetching" }
        if mailboxOnboardingState == .syncingMailbox { return "Indexing" }
        if errorMessage?.isEmpty == false { return "Failed" }
        if let account = currentSyncAuthoritativeAccount {
            return providerFreshnessState(for: account)
        }
        if lastSyncCompletedAt != nil { return "Refresh complete" }
        return "Idle"
    }

    private func syncStateLabel(for account: MailAddress) -> String {
        if gmailSyncStatusByAccountId[account.accountId]?.localizedCaseInsensitiveContains("syncing") == true {
            return "Syncing"
        }
        return providerFreshnessState(for: account)
    }

    private var syncProgressLabel: String {
        if isLoading || syncStartedAt != nil { return "Running" }
        if isLoadingMore { return "Paging" }
        if mailboxOnboardingState == .syncingMailbox { return "Indexing" }
        if currentSyncAuthoritativeAccount != nil { return syncStateLabel }
        if lastSyncCompletedAt != nil { return "Refresh complete" }
        return "Pending"
    }

    private var currentSyncErrorLabel: String {
        if let errorMessage, !errorMessage.isEmpty { return errorMessage }
        if let accountError = currentSyncAuthoritativeAccount?.syncError, !accountError.isEmpty {
            return ProductSafeText.sanitize(accountError, context: .general)
        }
        return "None"
    }

    private var lastSyncFailureLabel: String {
        currentSyncErrorLabel == "None" ? "None" : "Latest attempt"
    }

    private var dataFreshnessLabel: String {
        if let account = currentSyncAuthoritativeAccount {
            return providerFreshnessState(for: account)
        }
        return "Sync Required"
    }

    private var currentSyncAuthoritativeAccount: MailAddress? {
        if let selectedAccountId,
           let account = addresses.first(where: { $0.accountId == selectedAccountId }) {
            return account
        }
        if let selectedProvider,
           let account = addresses.first(where: { $0.displayProvider == selectedProvider }) {
            return account
        }
        return connectedGmailAccounts
            .sorted {
                let left = providerSyncedDate($0.lastSyncedAt) ?? .distantPast
                let right = providerSyncedDate($1.lastSyncedAt) ?? .distantPast
                return left > right
            }
            .first
    }

    private var authoritativeSyncLabel: String {
        if let account = currentSyncAuthoritativeAccount {
            return syncLabel(account.lastSyncedAt)
        }
        return syncLabel(nil)
    }

    private func healthState(for account: MailAddress) -> MailOSHealthState {
        let messageCount = emails.filter { email in
            email.accountId == account.accountId || email.sourceAccount.caseInsensitiveCompare(account.email) == .orderedSame
        }.count
        if gmailSyncStatusByAccountId[account.accountId]?.localizedCaseInsensitiveContains("syncing") == true {
            return .initialSyncRunning
        }
        if account.syncError?.isEmpty == false { return .failed }
        let status = (account.syncStatus ?? "connected").lowercased()
        if status.contains("error") || status.contains("blocked") { return .failed }
        if status.contains("sync") { return .initialSyncRunning }
        if status.contains("not_available") { return .unavailable }
        if account.displayProvider == .gmail || account.displayProvider == .googleWorkspace {
            guard let syncedAt = providerSyncedDate(account.lastSyncedAt) else {
                return messageCount == 0 ? .connectedNoData : .stale
            }
            if Date().timeIntervalSince(syncedAt) > Self.providerFreshnessWindow {
                return .stale
            }
            return messageCount == 0 ? .connectedNoData : .ready
        }
        return .connected
    }

    private func authorizationLabel(for account: MailAddress) -> String {
        if account.syncError?.isEmpty == false { return "Authorization needs attention" }
        switch healthState(for: account) {
        case .connected: return "Account link healthy"
        case .connectedNoData: return "Connected; sync required"
        case .initialSyncRunning, .syncing: return "Account link active"
        case .ready: return "Provider data fresh"
        case .stale: return "Provider sync required"
        case .failed: return "Authorization review"
        case .attention: return "Authorization review"
        case .unavailable: return "Provider unavailable"
        }
    }

    private func providerFreshnessState(for account: MailAddress) -> String {
        if account.syncError?.isEmpty == false { return "Sync Failed" }
        let status = (account.syncStatus ?? "").lowercased()
        if status.contains("error") || status.contains("blocked") { return "Sync Failed" }
        if status.contains("sync") { return "Syncing" }
        guard account.displayProvider == .gmail || account.displayProvider == .googleWorkspace else {
            return "Provider sync required"
        }
        guard let syncedAt = providerSyncedDate(account.lastSyncedAt) else {
            return "Sync Required"
        }
        if syncedAt > Date().addingTimeInterval(120) { return "Provider timestamp invalid" }
        return Date().timeIntervalSince(syncedAt) <= Self.providerFreshnessWindow ? "Fresh" : "Stale"
    }

    func canSend(from account: MailAddress) -> Bool {
        restoredSendCapability(for: account).canSend
    }

    func sendCapabilityReason(for account: MailAddress) -> String {
        restoredSendCapability(for: account).reason
    }

    func providerTruthSnapshot(for account: MailAddress, remoteRequests: [GoogleTestUserRequest] = []) -> ProviderTruthSnapshot {
        let unified = unifiedAccounts.first { unified in
            unified.readableAccountId == account.accountId
            || unified.email.caseInsensitiveCompare(account.email) == .orderedSame
        }
        return providerTruthSnapshot(
            provider: account.displayProvider,
            email: account.email,
            syncStatus: account.syncStatus ?? "unknown",
            syncError: account.syncError,
            lastSyncedAt: account.lastSyncedAt,
            unified: unified,
            remoteRequests: remoteRequests,
            source: unified == nil ? "MailAddress + local capability fallback" : "AccountCapabilityContractV2 + MailAddress"
        )
    }

    func providerTruthSnapshot(for unified: UnifiedMailAccount, remoteRequests: [GoogleTestUserRequest] = []) -> ProviderTruthSnapshot {
        providerTruthSnapshot(
            provider: unified.provider,
            email: unified.email,
            syncStatus: unified.status,
            syncError: unified.status.localizedCaseInsensitiveContains("error") ? unified.status : nil,
            lastSyncedAt: nil,
            unified: unified,
            remoteRequests: remoteRequests,
            source: "AccountCapabilityContractV2"
        )
    }

    private func restoredSendCapability(for account: MailAddress) -> (canSend: Bool, reason: String) {
        if let unified = unifiedAccounts.first(where: { unified in
            unified.readableAccountId == account.accountId
            || unified.email.caseInsensitiveCompare(account.email) == .orderedSame
        }) {
            return (unified.canSend, unified.sendStatusReason)
        }
        let normalizedStatus = (account.syncStatus ?? "").lowercased()
        if account.syncError?.isEmpty == false || normalizedStatus.contains("error") || normalizedStatus.contains("blocked") {
            return (false, "Provider authorization unavailable")
        }
        if (account.syncStatus ?? "").localizedCaseInsensitiveContains("scope") {
            return (false, "Reconnect required for send")
        }
        if account.displayProvider == .cloudflareNative {
            return (true, "Can send")
        }
        return (false, "Capability refresh required")
    }

    private func providerTruthSnapshot(
        provider: UnifiedMailProvider,
        email: String,
        syncStatus: String,
        syncError: String?,
        lastSyncedAt: String?,
        unified: UnifiedMailAccount?,
        remoteRequests: [GoogleTestUserRequest],
        source: String
    ) -> ProviderTruthSnapshot {
        let isGoogle = provider == .gmail || provider == .googleWorkspace
        let providerEvidenceVerified = isGoogle ? googleProviderEvidenceVerified(for: email, remoteRequests: remoteRequests, lastSyncedAt: lastSyncedAt) : true
        let governanceStatus = governanceTruthStatus(isGoogle: isGoogle, email: email, remoteRequests: remoteRequests)
        let hasSyncError = syncError?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        let normalizedStatus = syncStatus.lowercased()
        let contract = unified?.accountCapabilityContract
        let lifecycle = (contract?.mailboxLifecycleState ?? syncStatus).lowercased()
        let lifecycleRequiresReconnect = lifecycle.contains("legacy_imap")
            || normalizedStatus == "needs_reconnect"
            || normalizedStatus == "legacy_imap_unsupported"
        let importPending = lifecycle.contains("first_import")
            || lifecycle.contains("oauth_connected")
            || lifecycle.contains("identity_connected")
            || lifecycle.contains("import_in_progress")
            || normalizedStatus == "connected"
        let mailboxReady = contract?.mailboxReady ?? (provider == .cloudflareNative)
        let tokenReady = contract?.tokenReferencePresent ?? (provider == .cloudflareNative)
        let providerStatus: ProviderTruthAuthorizationStatus
        
        if tokenReady || providerEvidenceVerified || mailboxReady || importPending {
            providerStatus = .oauth_success
        } else if lifecycleRequiresReconnect {
            providerStatus = .launch_ready
        } else if hasSyncError || normalizedStatus.contains("blocked") || normalizedStatus.contains("error") {
            let haystack = "\(syncError ?? "") \(syncStatus)".lowercased()
            if haystack.contains("access_denied") {
                providerStatus = .testing_restricted
            } else if haystack.contains("app_not_verified") || haystack.contains("verification") {
                providerStatus = .verification_required
            } else if haystack.contains("admin_policy") || haystack.contains("workspace") || haystack.contains("org_internal") {
                providerStatus = .workspace_admin_blocked
            } else if haystack.contains("scope") || haystack.contains("not approved") {
                providerStatus = .scope_not_approved
            } else if haystack.contains("cancel") {
                providerStatus = .user_cancelled
            } else {
                providerStatus = .access_blocked
            }
        } else {
            providerStatus = .not_started
        }

        let canReceive = contract?.canReceive ?? (provider == .cloudflareNative && !hasSyncError)
        let syncTruth = syncTruthStatus(providerStatus: providerStatus, syncStatus: syncStatus, syncError: syncError, lifecycle: lifecycle, mailboxReady: mailboxReady)
        let freshnessTruth = freshnessTruthStatus(providerStatus: providerStatus, lastSyncedAt: lastSyncedAt, syncError: syncError, mailboxReady: mailboxReady)
        let ledgerVisible = emails.contains { message in
            message.accountId == unified?.readableAccountId || message.sourceAccount.caseInsensitiveCompare(email) == .orderedSame
        }
        let canReceiveReality = canReceive && mailboxReady && providerStatus == .oauth_success && (ledgerVisible || freshnessTruth == .healthy || provider == .cloudflareNative)
        let canSend = contract?.canSend ?? (provider == .cloudflareNative && !hasSyncError && !normalizedStatus.contains("blocked"))
        let canSync = syncTruth == .mailbox_ready || syncTruth == .importing
        let canLogin = providerStatus == .oauth_success && tokenReady
        let canRoute = provider == .cloudflareNative ? canReceive : false
        let canAI = aiConsent.aiEnabled && (provider == .cloudflareNative || providerReadiness[.foundation] == true || providerReadiness[.apple] == true)
        let failureReason = truthFailureReason(
            providerStatus: providerStatus,
            governanceStatus: governanceStatus,
            syncError: syncError,
            contract: contract,
            providerEvidenceVerified: providerEvidenceVerified,
            isGoogle: isGoogle
        )
        let recoveryStatus = truthRecoveryStatus(providerStatus: providerStatus, governanceStatus: governanceStatus, contract: contract)
        return ProviderTruthSnapshot(
            provider: provider,
            email: email,
            governanceStatus: governanceStatus,
            providerStatus: providerStatus,
            recoveryStatus: recoveryStatus,
            syncStatus: syncTruth,
            freshnessStatus: freshnessTruth,
            mailboxStatus: mailboxTruthStatus(providerStatus: providerStatus, canReceive: canReceive, canSync: canSync, syncStatus: syncStatus, lifecycle: lifecycle, mailboxReady: mailboxReady),
            failureReason: failureReason,
            truthSource: source,
            canLogin: truthCapability(canLogin, allowed: "Provider login authorized", blocked: failureReason),
            canSend: truthCapability(canSend, allowed: "Send capability verified", blocked: contract?.uiSendStatus ?? failureReason, allowedStatus: .send_allowed, blockedStatus: .send_blocked),
            canReceive: truthCapability(canReceiveReality, allowed: "Provider reachability, sync, freshness, ledger, and inbox visibility verified", blocked: receiveBlockedReason(providerStatus: providerStatus, syncTruth: syncTruth, freshnessTruth: freshnessTruth, ledgerVisible: ledgerVisible), allowedStatus: .receive_allowed, blockedStatus: .receive_blocked),
            canSync: truthCapability(canSync, allowed: "Sync capability verified", blocked: failureReason),
            canRoute: truthCapability(canRoute, allowed: "Routing capability verified", blocked: provider == .cloudflareNative ? failureReason : "Routing not applicable"),
            canAIProcess: truthCapability(canAI, allowed: "AI processing permitted by current settings", blocked: "AI processing unavailable or disabled")
        )
    }

    private func googleProviderEvidenceVerified(for email: String, remoteRequests: [GoogleTestUserRequest], lastSyncedAt: String?) -> Bool {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let request = remoteRequests.first(where: { $0.gmail.lowercased() == normalized }),
           request.oauthSuccessTime?.isEmpty == false || request.firstSyncCompleted?.isEmpty == false {
            return true
        }
        return providerSyncedDate(lastSyncedAt) != nil
    }

    private func governanceTruthStatus(isGoogle: Bool, email: String, remoteRequests: [GoogleTestUserRequest]) -> ProviderTruthGovernanceStatus {
        guard isGoogle else { return .auto_approved }
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        
        let isEnterpriseApproval = remoteRequests.contains { $0.gmail.lowercased() == normalized && ($0.notes ?? "").contains("enterprise_policy_requires_approval=true") }
            || localOAuthAccessRequests.contains { $0.provider == "Google" && $0.email.lowercased() == normalized && ($0.notes ?? "").contains("enterprise_policy_requires_approval=true") }
        
        if isEnterpriseApproval {
            let request = remoteRequests.first { $0.gmail.lowercased() == normalized }
            let localRequest = localOAuthAccessRequests.first { $0.provider == "Google" && $0.email.lowercased() == normalized }
            let statusStr = request?.status ?? localRequest?.status.rawValue ?? ""
            
            if statusStr.localizedCaseInsensitiveContains("reject") {
                return .manual_rejected
            } else if statusStr.localizedCaseInsensitiveContains("expire") {
                return .enterprise_policy_expired
            } else if statusStr.localizedCaseInsensitiveContains("approved") {
                return .manual_approved
            } else {
                return .enterprise_policy_pending
            }
        }
        return .auto_approved
    }

    private func truthCapability(_ allowed: Bool, allowed allowedReason: String, blocked blockedReason: String, allowedStatus: ProviderTruthCapabilityStatus = .allowed, blockedStatus: ProviderTruthCapabilityStatus = .blocked) -> ProviderTruthCapability {
        allowed
            ? ProviderTruthCapability(status: allowedStatus, reason: allowedReason)
            : ProviderTruthCapability(status: blockedStatus, reason: blockedReason)
    }

    private func truthFailureReason(
        providerStatus: ProviderTruthAuthorizationStatus,
        governanceStatus: ProviderTruthGovernanceStatus,
        syncError: String?,
        contract: AccountCapabilityContract?,
        providerEvidenceVerified: Bool,
        isGoogle: Bool
    ) -> String {
        if let syncError, !syncError.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ProductSafeText.sanitize(syncError, context: .general)
        }
        if let contract, !contract.canSend {
            return contract.uiSendStatus
        }
        if isGoogle && !providerEvidenceVerified {
            return (governanceStatus == .manual_approved || governanceStatus == .auto_approved) ? "Enrollment Not Verified" : "Google Tester Restriction"
        }
        switch providerStatus {
        case .oauth_success: return "None"
        case .testing_restricted: return "Provider testing restriction"
        case .access_blocked: return "Provider access restriction"
        case .workspace_admin_blocked: return "Workspace admin blocked"
        case .scope_not_approved: return "OAuth scope not approved"
        case .user_cancelled: return "User cancelled OAuth"
        case .verification_required: return "OAuth verification required"
        case .launch_ready, .not_started: return "OAuth authorization unavailable"
        }
    }

    private func truthRecoveryStatus(
        providerStatus: ProviderTruthAuthorizationStatus,
        governanceStatus: ProviderTruthGovernanceStatus,
        contract: AccountCapabilityContract?
    ) -> ProviderTruthRecoveryStatus {
        let recoveryAction = contract?.recoveryAction.uppercased() ?? ""
        switch recoveryAction {
        case "RECONNECT_OAUTH": return .reauthenticate
        case "RUN_IMPORT_RECOVERY": return .refreshCapability
        case "REQUEST_ACCESS": return .requestApproval
        case "NONE": return .none
        default: break
        }
        if contract?.sendUnavailableReason == .missingSendScope || contract?.sendUnavailableReason == .tokenExpired || contract?.sendUnavailableReason == .tokenReferenceMissing {
            return .reauthenticate
        }
        switch providerStatus {
        case .oauth_success: return .none
        case .testing_restricted, .scope_not_approved:
            return (governanceStatus == .manual_approved || governanceStatus == .auto_approved) ? .requestEnrollment : .requestApproval
        case .access_blocked, .workspace_admin_blocked: return .contactAdmin
        case .verification_required: return .reauthenticate
        case .user_cancelled, .launch_ready, .not_started: return .reauthenticate
        }
    }

    private func mailboxTruthStatus(providerStatus: ProviderTruthAuthorizationStatus, canReceive: Bool, canSync: Bool, syncStatus: String, lifecycle: String, mailboxReady: Bool) -> String {
        let status = syncTruthStatus(providerStatus: providerStatus, syncStatus: syncStatus, syncError: nil, lifecycle: lifecycle, mailboxReady: mailboxReady)
        return status.rawValue
    }

    private func syncTruthStatus(providerStatus: ProviderTruthAuthorizationStatus, syncStatus: String, syncError: String?, lifecycle: String, mailboxReady: Bool) -> ProviderTruthSyncStatus {
        if providerStatus == .access_blocked || providerStatus == .workspace_admin_blocked { return .blocked }
        if providerStatus == .testing_restricted { return .blocked }
        
        let normalized = syncStatus.lowercased()
        if lifecycle.contains("legacy_imap") || normalized == "needs_reconnect" || normalized == "legacy_imap_unsupported" { return .needs_reconnect }
        if lifecycle.contains("first_import") || lifecycle.contains("import_in_progress") || normalized == "connected" { return .importing }
        if mailboxReady { return .mailbox_ready }
        return .not_ready
    }

    private func freshnessTruthStatus(providerStatus: ProviderTruthAuthorizationStatus, lastSyncedAt: String?, syncError: String?, mailboxReady: Bool) -> ProviderTruthFreshnessStatus {
        if syncError?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false { return .unknown }
        if providerStatus != .oauth_success { return .unknown }
        if !mailboxReady { return .unknown }
        guard let syncedAt = providerSyncedDate(lastSyncedAt) else { return .unknown }
        if syncedAt > Date().addingTimeInterval(120) { return .unknown }
        return Date().timeIntervalSince(syncedAt) <= Self.providerFreshnessWindow ? .healthy : .stale
    }

    private func receiveBlockedReason(providerStatus: ProviderTruthAuthorizationStatus, syncTruth: ProviderTruthSyncStatus, freshnessTruth: ProviderTruthFreshnessStatus, ledgerVisible: Bool) -> String {
        if providerStatus != .oauth_success { return "Provider reachability unavailable" }
        if syncTruth == .blocked || syncTruth == .needs_reconnect { return "Sync unavailable" }
        if freshnessTruth == .stale { return "Mailbox freshness stale" }
        if !ledgerVisible { return "No provider messages visible in Global Message Ledger yet" }
        return "Receive capability unavailable"
    }

    private func providerSyncedDate(_ rawDate: String?) -> Date? {
        guard let rawDate, !rawDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        let trimmed = rawDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: trimmed) {
            return EmailMessage.clampFutureDate(date)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        for format in ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: trimmed) {
                return EmailMessage.clampFutureDate(date)
            }
        }
        return nil
    }

	    func accountTimestampDisplayLabel(_ rawDate: String?) -> String {
	        if let date = providerSyncedDate(rawDate) {
	            let age = Date().timeIntervalSince(date)
	            let localTime = date.formatted(date: .omitted, time: .shortened)
	            if age < 0 { return "\(localTime) local · Just now" }
	            if age < 60 { return "\(localTime) local · \(max(1, Int(age)))s ago" }
	            if age < 3600 { return "\(localTime) local · \(Int(age / 60))m ago" }
	            return "\(date.formatted(date: .abbreviated, time: .shortened)) local"
	        }
	        return "Never synced"
	    }

    private func syncLabel(_ rawDate: String?) -> String {
        accountTimestampDisplayLabel(rawDate)
    }

    private func syncLabel(for account: MailAddress) -> String {
        if account.syncError?.isEmpty == false { return "Sync failed" }
        if account.displayProvider == .cloudflareNative { return "Routing active" }
        return syncLabel(account.lastSyncedAt)
    }

    init() {
        let url = URL(string: UserDefaults.standard.string(forKey: "serverURL")
            ?? "https://cloud-mail.fastonegroup.workers.dev")!
        let storedToken = Keychain.get(Self.tokenKey)
        self.backend = Backend(baseURL: url, token: storedToken)
        self.router = AIRouter(preferred:
            AIProviderKind(rawValue: UserDefaults.standard.string(forKey: "preferredProvider") ?? "apple") ?? .apple)
        self.token = storedToken
        let lastRefresh = UserDefaults.standard.double(forKey: Self.lastRefreshKey)
        if lastRefresh > 0 {
            self.lastSyncCompletedAt = Date(timeIntervalSince1970: lastRefresh)
        }
        restoreLocalOAuthAccessRequests()
        restoreGovernanceLedger()

        if storedToken?.isEmpty == false {
            phase = .ready
            // Do not restore mailbox content from the last email before the
            // server validates the current session identity. The token may
            // belong to a different account after logout/reconnect.
            scheduleBootstrapAfterLaunch()
        }
        #if DEBUG
        Task { await self.consumeTestCredentialBridgeIfPresent() }
        #endif
        startICloudProfileSyncObserver()
    }

    deinit {
        bootstrapTask?.cancel()
        refreshTask?.cancel()
        mailboxSelectionRefreshTask?.cancel()
        gmailForegroundSyncTask?.cancel()
        if let iCloudProfileSyncObserver {
            NotificationCenter.default.removeObserver(iCloudProfileSyncObserver)
        }
    }

    // MARK: Lifecycle

    private func scheduleBootstrapAfterLaunch() {
        guard bootstrapTask == nil else { return }
        bootstrapTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled else { return }
            await self.bootstrapAfterLaunch()
            self.bootstrapTask = nil
        }
    }

    private func bootstrapAfterLaunch() async {
        guard await loadUser(silentExpired: true) else { return }
        await loadV2Configuration()
        await refreshIfStale(maxAge: cachedInboxRestored ? 90 : 0, allowDuringBootstrap: true)
    }

    func refreshProviderReadiness() async {
        providerReadiness = await router.readiness()
    }

    var appleIntelligenceAvailabilityMessage: String? {
        guard aiConsent.aiEnabled else { return "AI is disabled in Consent Center." }
        guard aiConsent.appleLocalEnabled else { return "Apple local AI is disabled in Consent Center." }
        guard aiConsent.singleMailRead else { return "Single-message reading is not allowed in Consent Center." }
        let localReady = providerReadiness[.apple] == true || providerReadiness[.foundation] == true
        return localReady ? nil : "Apple Intelligence is unavailable on this device or disabled in Settings."
    }

    var aiProviderContracts: [AIProviderContract] {
        AIProviderRegistry.contracts(
            readiness: providerReadiness,
            geminiOAuthStatus: geminiOAuthStatus,
            usability: aiProviderUsability,
            smokeResults: aiProviderSmokeResults
        )
    }

    func loadV2Configuration() async {
        if let remote = try? await backend.aiConsent() {
            var merged = remote
            if let localAIEnabled = mailClientProfile.uiPreferences[Self.aiEnabledPreferenceKey] {
                merged.aiEnabled = localAIEnabled != "false"
            }
            merged.cloudAIEnabled = false
            aiConsent = merged
            updateAIConsentProfilePreferences(merged, persist: false)
            await router.setConsent(merged)
        }
        unifiedAccounts = (try? await backend.unifiedAccounts()) ?? []
        geminiOAuthStatus = try? await backend.geminiOAuthStatus()
        await refreshProviderReadiness()
    }

    func saveAIConsent(_ consent: AIConsent) async {
        var localOnlyConsent = consent
        localOnlyConsent.cloudAIEnabled = false
        aiConsent = localOnlyConsent
        aiConsentStatusMessage = nil
        updateAIConsentProfilePreferences(localOnlyConsent, persist: true)
        await router.setConsent(localOnlyConsent)
        await refreshProviderReadiness()
        do {
            var saved = try await backend.updateAIConsent(localOnlyConsent)
            saved.cloudAIEnabled = false
            if saved.aiEnabled == localOnlyConsent.aiEnabled {
                aiConsent = saved
                updateAIConsentProfilePreferences(aiConsent, persist: true)
                aiConsentStatusMessage = nil
            } else {
                aiConsent = localOnlyConsent
                updateAIConsentProfilePreferences(localOnlyConsent, persist: true)
                aiConsentStatusMessage = nil
            }
            await router.setConsent(aiConsent)
            await refreshProviderReadiness()
        } catch {
            aiConsent = localOnlyConsent
            updateAIConsentProfilePreferences(localOnlyConsent, persist: true)
            aiConsentStatusMessage = nil
            await router.setConsent(localOnlyConsent)
            await refreshProviderReadiness()
        }
    }

    // MARK: Configuration

    /// Apply a server URL + domain entered during onboarding/settings.
    func applyServer(urlString: String, domain: String) {
        let cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: cleaned), url.scheme != nil else {
            errorMessage = "That doesn't look like a valid https URL."
            return
        }
        serverURLString = cleaned
        self.domain = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { await backend.updateBaseURL(url) }
    }

    // MARK: Auth

    func login(email: String, password: String) async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            clearMailboxOwnershipContext()
            currentUser = nil
            let newToken = try await backend.login(email: email, password: password)
            self.token = newToken
            await backend.updateToken(newToken)
            mailboxDefaultApplied = false
            selectedAccountId = nil
            selectedProvider = nil
            selectedLocalMailbox = .inbox
            setPrimaryIdentity(email)
            phase = .ready
            await loadUser()
            await loadV2Configuration()
            await refresh()
        } catch {
            guard !error.isCloudMailCancellation else { return }
            errorMessage = Self.productSafeErrorMessage(error, context: .general)
        }
    }

    /// Performs provider authentication inside the native app only, then resumes
    /// provisioning without exposing continuation material to the view layer. The
    /// raw input is request-local and is never persisted, logged, analyzed, or
    /// included in a status/error string.
    func authenticateSecurelyAndContinueProvisioning(principalEmail: String, secret: String) async -> BootstrapIdentityResponse? {
        guard !secureAuthIsExpired,
              let targetEmail = secureAuthEmail,
              let challengeReference = secureAuthChallengeReference else {
            secureAuthState = .authExpired
            secureAuthOutcomeMessage = "Authentication expired. Start again securely on this iPhone."
            return nil
        }
        secureAuthState = .authInProgress
        mailboxOnboardingState = .authorizing
        secureAuthOutcomeMessage = nil
        do {
            let requestedPrincipal = principalEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let canonicalPrincipal = secureAuthPrincipalLocked ? secureAuthPrincipalEmail : requestedPrincipal
            guard !canonicalPrincipal.isEmpty,
                  !secureAuthPrincipalLocked || requestedPrincipal == secureAuthPrincipalEmail else {
                secureAuthState = .authFailed
                secureAuthOutcomeMessage = "Use the signed-in NEXORA account to authorize this mailbox."
                return nil
            }
            let newToken = try await backend.login(
                email: canonicalPrincipal,
                password: secret,
                challengeReference: challengeReference
            )
            token = newToken
            await backend.updateToken(newToken)
            mailboxDefaultApplied = false
            selectedAccountId = nil
            selectedProvider = nil
            selectedLocalMailbox = .inbox
            setPrimaryIdentity(canonicalPrincipal)
            phase = .ready
            await loadUser()
            await loadV2Configuration()
            secureAuthState = .authSuccess
            return await continueProvisioningWithAuthorizedSession(
                targetEmail: targetEmail,
                challengeReference: challengeReference
            )
        } catch {
            if secureAuthIsExpired {
                secureAuthState = .authExpired
                secureAuthOutcomeMessage = "Authentication expired. Start again securely on this iPhone."
            } else {
                secureAuthState = .authFailed
                secureAuthOutcomeMessage = "Authentication was not accepted. Check the account details and retry securely."
            }
            mailboxOnboardingState = .blocked
            errorMessage = secureAuthOutcomeMessage
            return nil
        }
    }

    func resumeProvisioningAfterAuthentication() async -> BootstrapIdentityResponse? {
        guard !secureAuthIsExpired,
              let targetEmail = secureAuthEmail,
              let challengeReference = secureAuthChallengeReference else {
            secureAuthState = .authExpired
            secureAuthOutcomeMessage = "Authentication expired. Start again securely on this iPhone."
            return nil
        }
        return await continueProvisioningWithAuthorizedSession(
            targetEmail: targetEmail,
            challengeReference: challengeReference
        )
    }

    private func continueProvisioningWithAuthorizedSession(targetEmail: String, challengeReference: String) async -> BootstrapIdentityResponse? {
        mailboxOnboardingState = .creatingMailbox
        secureAuthOutcomeMessage = "Authentication succeeded. Resuming provisioning automatically..."
        do {
            let domain = targetEmail.split(separator: "@", maxSplits: 1).last.map(String.init) ?? ""
            let deviceReference = Self.secureDeviceReference()
            let continuation = try await backend.createProvisioningContinuation(
                email: targetEmail,
                domain: domain,
                provider: secureAuthProvider,
                deviceReference: deviceReference,
                challengeReference: challengeReference
            )
            let result = try await backend.bootstrapIdentity(
                email: targetEmail,
                continuationToken: continuation.continuationToken,
                provider: secureAuthProvider,
                deviceReference: deviceReference
            )
            secureAuthState = .provisioningContinued
            await loadV2Configuration()
            await refresh()
            if result.mailboxReady == true || result.status.lowercased() == "ready" {
                mailboxOnboardingState = .ready
                mailboxOnboardingMessage = "Mailbox Ready"
                secureAuthOutcomeMessage = "Mailbox Ready"
                secureAuthChallengeReference = nil
                secureAuthDeadline = nil
                await postMailboxReadyNotification(email: targetEmail)
            } else {
                mailboxOnboardingState = .blocked
                mailboxOnboardingMessage = result.message ?? "Provisioning is blocked by provider security."
                secureAuthOutcomeMessage = mailboxOnboardingMessage
            }
            errorMessage = nil
            return result
        } catch {
            secureAuthState = secureAuthIsExpired ? .authExpired : .provisioningContinued
            mailboxOnboardingState = .blocked
            secureAuthOutcomeMessage = secureAuthIsExpired
                ? "Authentication expired. Start again securely on this iPhone."
                : "Authentication succeeded. Provisioning is paused and can resume without entering your password again."
            mailboxOnboardingMessage = secureAuthOutcomeMessage
            errorMessage = secureAuthOutcomeMessage
            return nil
        }
    }

    func beginSecureAuthHandoff(email: String, principalEmail: String? = nil, provider: String, providerMessage: String) async -> Bool {
        let targetEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let domain = targetEmail.split(separator: "@", maxSplits: 1).last.map(String.init) ?? ""
        secureAuthEmail = targetEmail
        let existingPrincipal = currentUser?.email?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        secureAuthPrincipalLocked = existingPrincipal?.isEmpty == false
        secureAuthPrincipalEmail = existingPrincipal
            ?? principalEmail?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            ?? targetEmail
        secureAuthProviderMessage = providerMessage
        secureAuthProvider = provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        secureAuthState = .authRequired
        secureAuthOutcomeMessage = nil
        let deadline = Date().addingTimeInterval(10 * 60)
        secureAuthDeadline = deadline
        do {
            let challenge = try await backend.beginProvisioningAuthHandoff(
                email: targetEmail,
                domain: domain,
                provider: secureAuthProvider,
                deviceReference: Self.secureDeviceReference()
            )
            secureAuthChallengeReference = challenge.challengeReference
            secureAuthState = .waitingForUserSecureInput
            return true
        } catch {
            secureAuthChallengeReference = nil
            secureAuthState = .authFailed
            secureAuthOutcomeMessage = "Secure authentication could not start. Try again."
            return false
        }
    }

    func cancelSecureAuthHandoff() {
        secureAuthState = secureAuthIsExpired ? .authExpired : .authRequired
    }

    func resumeSecureAuthHandoff() -> Bool {
        guard !secureAuthIsExpired, secureAuthChallengeReference != nil else {
            secureAuthState = .authExpired
            return false
        }
        secureAuthState = .waitingForUserSecureInput
        return true
    }

    func expireSecureAuthIfNeeded(now: Date = Date()) {
        guard let deadline = secureAuthDeadline, now >= deadline else { return }
        secureAuthChallengeReference = nil
        if secureAuthState != .provisioningContinued && secureAuthState != .authSuccess {
            secureAuthState = .authExpired
            secureAuthOutcomeMessage = "Authentication expired. Start again securely on this iPhone."
        }
    }

    var secureAuthIsExpired: Bool {
        guard let deadline = secureAuthDeadline else { return true }
        return Date() >= deadline
    }

    func finishProvisioningContinuation() {
        secureAuthState = .provisioningContinued
        secureAuthChallengeReference = nil
        secureAuthEmail = nil
        secureAuthProviderMessage = nil
        secureAuthDeadline = nil
    }

    private func postMailboxReadyNotification(email: String) async {
        #if os(iOS)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = "Mailbox Ready"
        content.body = "Your mailbox is provisioned and ready in NEXORA."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "mailbox-ready-\(UUID().uuidString)", content: content, trigger: nil)
        try? await center.add(request)
        #endif
    }

    private static func secureDeviceReference() -> String {
        #if os(iOS)
        if let identifier = UIDevice.current.identifierForVendor?.uuidString, !identifier.isEmpty {
            return identifier
        }
        if let installedReference = Keychain.get(secureDeviceReferenceKey), !installedReference.isEmpty {
            return installedReference
        }
        let installedReference = UUID().uuidString
        Keychain.set(installedReference, for: secureDeviceReferenceKey)
        return installedReference
        #else
        return "owner-device"
        #endif
    }

    func backendRegister(email: String, password: String, name: String?, domain: String, code: String) async throws -> RegisterResponse {
        errorMessage = nil
        let fullEmail = "\(email)@\(domain)"
        let response = try await backend.register(email: fullEmail, password: password, code: code)
        loginPrefillEmail = fullEmail
        self.domain = domain
        return response
    }

    func backendForgot(email: String) async throws -> ForgotPasswordResponse {
        errorMessage = nil
        return try await backend.forgotPassword(email: email)
    }

    func backendReset(token: String, newPassword: String) async throws {
        errorMessage = nil
        _ = try await backend.resetPassword(token: token, newPassword: newPassword)
    }

    func discoverIdentity(email: String) async throws -> EmailDiscoveryResponse {
        try await backend.discoverIdentity(email: email)
    }

    func bootstrapIdentity(email: String, continuationToken: String? = nil) async throws -> BootstrapIdentityResponse {
        try await backend.bootstrapIdentity(email: email, continuationToken: continuationToken)
    }

    func activateIdentity(token: String, password: String) async throws {
        let response = try await backend.activateIdentity(token: token, password: password)
        loginPrefillEmail = response.email
        activationToken = nil
        errorMessage = nil
        phase = .onboarding
    }

    func backendForwardingSettings(email: String) async throws -> ForwardingSettingsResponse {
        try await backend.forwardingSettings(email: email)
    }

    func backendGoogleTestUserDashboard() async throws -> GoogleTestUserDashboard {
        try await backend.googleTestUserDashboard()
    }

    func backendGoogleTestUserRequests(status: String? = nil) async throws -> [GoogleTestUserRequest] {
        try await backend.googleTestUserRequests(status: status)
    }

    func backendApproveAllGoogleTestUsers() async throws -> GoogleTestUserBulkResult {
        try await backend.approveAllGoogleTestUsers()
    }

    func backendUpdateGoogleTestUserRequests(ids: [Int], status: String, notes: String? = nil) async throws -> GoogleTestUserBulkResult {
        try await backend.updateGoogleTestUserRequests(ids: ids, status: status, notes: notes)
    }

    func backendMarkGoogleTestUsersSynced(ids: [Int], notes: String? = nil) async throws -> GoogleTestUserBulkResult {
        try await backend.markGoogleTestUsersSynced(ids: ids, notes: notes)
    }

    func backendGoogleTestUserGmailList(status: String) async throws -> GoogleTestUserGmailList {
        try await backend.googleTestUserGmailList(status: status)
    }

    func backendGoogleTestUserReport(period: String) async throws -> String {
        try await backend.googleTestUserReport(period: period)
    }

    func backendRequestGoogleTestUserAccess(email: String) async throws -> GoogleTestUserAccessRequestResult {
        try await backend.requestGoogleTestUserAccess(email: email, device: deviceLabelForGovernance)
    }

    @discardableResult
    func requestGoogleOAuthAccess(email: String) -> LocalOAuthAccessRequest? {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.contains("@") else {
            errorMessage = "Enter a Gmail address before requesting Google OAuth tester access."
            return nil
        }
        if let existingIndex = localOAuthAccessRequests.firstIndex(where: {
            $0.provider == "Google"
                && $0.email.caseInsensitiveCompare(normalized) == .orderedSame
                && $0.status == .pendingApproval
        }) {
            localOAuthAccessRequests[existingIndex].notes = "Request refreshed from NEXORA OAuth diagnostics."
            persistLocalOAuthAccessRequests()
            submitGoogleOAuthAccessRequestToBackend(email: normalized)
            return localOAuthAccessRequests[existingIndex]
        }
        let request = LocalOAuthAccessRequest.google(email: normalized, userId: currentUser?.userId)
        localOAuthAccessRequests.insert(request, at: 0)
        appendGovernanceAudit(
            action: .requestCreated,
            provider: .google,
            account: normalized,
            detail: "Access request created with PENDING_APPROVAL status."
        )
        persistLocalOAuthAccessRequests()
        submitGoogleOAuthAccessRequestToBackend(email: normalized)
        return request
    }

    func updateLocalOAuthAccessRequest(id: String, status: LocalOAuthAccessRequestStatus) {
        guard let index = localOAuthAccessRequests.firstIndex(where: { $0.id == id }) else { return }
        localOAuthAccessRequests[index].status = status
        appendGovernanceAudit(
            action: status == .approved ? .requestApproved : .requestRejected,
            provider: GovernanceProvider(rawValue: localOAuthAccessRequests[index].provider) ?? .google,
            account: localOAuthAccessRequests[index].email,
            detail: "Access request moved to \(status.rawValue)."
        )
        persistLocalOAuthAccessRequests()
    }

    @discardableResult
    func setGoogleOAuthAccessStatus(email: String, status: LocalOAuthAccessRequestStatus) -> LocalOAuthAccessRequest? {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.contains("@") else {
            errorMessage = "Enter a Gmail address before changing Google authorization status."
            return nil
        }
        if let existingIndex = localOAuthAccessRequests.firstIndex(where: {
            $0.provider == "Google" && $0.email.caseInsensitiveCompare(normalized) == .orderedSame
        }) {
            localOAuthAccessRequests[existingIndex].status = status
            localOAuthAccessRequests[existingIndex].notes = "Status manually updated by NEXORA workspace governance."
            appendGovernanceAudit(
                action: status == .approved ? .requestApproved : .requestRejected,
                provider: .google,
                account: normalized,
                detail: "Google authorization status manually set to \(status.rawValue)."
            )
            persistLocalOAuthAccessRequests()
            return localOAuthAccessRequests[existingIndex]
        }

        var request = LocalOAuthAccessRequest.google(email: normalized, userId: currentUser?.userId)
        request.status = status
        request.notes = "Status manually created by NEXORA workspace governance."
        localOAuthAccessRequests.insert(request, at: 0)
        appendGovernanceAudit(
            action: status == .approved ? .requestApproved : .requestRejected,
            provider: .google,
            account: normalized,
            detail: "Google authorization record created with \(status.rawValue)."
        )
        persistLocalOAuthAccessRequests()
        return request
    }

    func createGovernanceInvitation(provider: GovernanceProvider, email: String?, maxUses: Int, validDays: Int = 7) -> String {
        let code = Self.generateInvitationCode(provider: provider)
        let normalizedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let invite = GovernanceInvitation(
            id: UUID().uuidString,
            provider: provider,
            optionalEmailBinding: normalizedEmail?.isEmpty == false ? normalizedEmail : nil,
            codeHash: Self.hashInvitationCode(code),
            maxUses: max(1, maxUses),
            expiresAt: Calendar.current.date(byAdding: .day, value: max(1, validDays), to: Date()) ?? Date().addingTimeInterval(7 * 24 * 3600),
            status: .active,
            uses: 0,
            createdAt: Date(),
            createdBy: currentUser?.email
        )
        governanceInvitations.insert(invite, at: 0)
        lastGeneratedInvitationCode = code
        appendGovernanceAudit(action: .inviteCreated, provider: provider, account: invite.optionalEmailBinding, detail: "Invitation created. Only a hash is stored.")
        persistGovernanceLedger()
        return code
    }

    func revokeGovernanceInvitation(id: String) {
        guard let index = governanceInvitations.firstIndex(where: { $0.id == id }) else { return }
        governanceInvitations[index].status = .revoked
        appendGovernanceAudit(action: .inviteRevoked, provider: governanceInvitations[index].provider, account: governanceInvitations[index].optionalEmailBinding, detail: "Invitation revoked.")
        persistGovernanceLedger()
    }

    func expireGovernanceInvitation(id: String) {
        guard let index = governanceInvitations.firstIndex(where: { $0.id == id }) else { return }
        governanceInvitations[index].status = .expired
        appendGovernanceAudit(action: .inviteExpired, provider: governanceInvitations[index].provider, account: governanceInvitations[index].optionalEmailBinding, detail: "Invitation expired by admin.")
        persistGovernanceLedger()
    }

    @discardableResult
    func resendGovernanceInvitation(id: String) -> Bool {
        guard let invite = governanceInvitations.first(where: { $0.id == id }) else { return false }
        appendGovernanceAudit(action: .inviteResent, provider: invite.provider, account: invite.optionalEmailBinding, detail: "Invitation resend recorded. Original code is not stored.")
        persistGovernanceLedger()
        return true
    }

    @discardableResult
    func redeemGovernanceInvitation(code: String, email: String, provider: GovernanceProvider) -> Bool {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hash = Self.hashInvitationCode(code)
        guard let index = governanceInvitations.firstIndex(where: { $0.codeHash == hash }) else {
            errorMessage = "Invitation code was not found."
            return false
        }
        guard governanceInvitations[index].provider == provider else {
            errorMessage = "\(provider.rawValue) invite required. This code belongs to \(governanceInvitations[index].provider.rawValue)."
            return false
        }
        guard governanceInvitations[index].isUsable else {
            errorMessage = "Invitation is expired, revoked, used, or over its usage limit."
            return false
        }
        if let bound = governanceInvitations[index].optionalEmailBinding,
           bound.caseInsensitiveCompare(normalizedEmail) != .orderedSame {
            errorMessage = "Invitation is bound to a different account."
            return false
        }
        governanceInvitations[index].uses += 1
        if governanceInvitations[index].uses >= governanceInvitations[index].maxUses {
            governanceInvitations[index].status = .used
        }
        appendGovernanceAudit(action: .inviteUsed, provider: provider, account: normalizedEmail, detail: "Invitation redeemed in NEXORA governance ledger.")
        persistGovernanceLedger()
        errorMessage = nil
        return true
    }

    func googleTesterStatus(for email: String, remoteRequests: [GoogleTestUserRequest] = []) -> OAuthTesterStatus {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        
        let isEnterpriseApproval = remoteRequests.contains { $0.gmail.lowercased() == normalized && ($0.notes ?? "").contains("enterprise_policy_requires_approval=true") }
            || localOAuthAccessRequests.contains { $0.provider == "Google" && $0.email.lowercased() == normalized && ($0.notes ?? "").contains("enterprise_policy_requires_approval=true") }
        
        if isEnterpriseApproval {
            if remoteRequests.contains(where: { $0.gmail.caseInsensitiveCompare(normalized) == .orderedSame && $0.status.localizedCaseInsensitiveContains("approved") }) {
                return .testerApproved
            }
            if remoteRequests.contains(where: { $0.gmail.caseInsensitiveCompare(normalized) == .orderedSame && $0.status.localizedCaseInsensitiveContains("reject") }) {
                return .testerRejected
            }
            if remoteRequests.contains(where: { $0.gmail.caseInsensitiveCompare(normalized) == .orderedSame }) {
                return .testerPending
            }
            if localOAuthAccessRequests.contains(where: { $0.provider == "Google" && $0.email.caseInsensitiveCompare(normalized) == .orderedSame && $0.status == .approved }) {
                return .testerPending
            }
            if localOAuthAccessRequests.contains(where: { $0.provider == "Google" && $0.email.caseInsensitiveCompare(normalized) == .orderedSame && $0.status == .rejected }) {
                return .testerRejected
            }
            if localOAuthAccessRequests.contains(where: { $0.provider == "Google" && $0.email.caseInsensitiveCompare(normalized) == .orderedSame && $0.status == .pendingApproval }) {
                return .testerPending
            }
            return .testerNotRegistered
        }
        return .testerApproved
    }

    private var deviceLabelForGovernance: String {
        #if os(iOS)
        return UIDevice.current.name
        #else
        return "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
        #endif
    }

    private func submitGoogleOAuthAccessRequestToBackend(email: String) {
        Task { @MainActor in
            do {
                _ = try await backendRequestGoogleTestUserAccess(email: email)
                if let index = localOAuthAccessRequests.firstIndex(where: {
                    $0.provider == "Google" && $0.email.caseInsensitiveCompare(email) == .orderedSame
                }) {
                    localOAuthAccessRequests[index].notes = "Submitted to NEXORA backend verification queue."
                    persistLocalOAuthAccessRequests()
                }
            } catch {
                if let index = localOAuthAccessRequests.firstIndex(where: {
                    $0.provider == "Google" && $0.email.caseInsensitiveCompare(email) == .orderedSame
                }) {
                    localOAuthAccessRequests[index].notes = "Local request saved; backend verification queue submission needs retry."
                    persistLocalOAuthAccessRequests()
                }
            }
        }
    }

    func handleIncomingURL(_ url: URL) {
        if url.path.contains("activate") || url.host == "activate" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            activationToken = components?.queryItems?.first(where: { $0.name == "token" })?.value
                ?? url.pathComponents.last
            phase = .onboarding
            return
        }
        if isOAuthCallback(url) {
            Task { await handleOAuthCallbackURL(url) }
            return
        }
        guard let token = Self.resetToken(from: url) else { return }
        resetPasswordToken = token
        phase = .onboarding
    }

    func signOut() {
        clearLocalSession()
        Task {
            try? await backend.logout()
            guard self.token == nil else { return }
            await backend.updateToken(nil)
        }
    }

    private func clearLocalSession() {
        invalidateServerCorrelation()
        token = nil
        currentUser = nil
        clearMailboxOwnershipContext()
        providerReadiness = [:]
        aiConsent = .default
        forwardingSettings = nil
        phase = .onboarding
    }

    private func clearMailboxOwnershipContext() {
        addresses = []
        emails = []
        triageCache = [:]
        invalidateSmartMailCategoryCache()
        unifiedAccounts = []
        gmailSyncStatusByAccountId = [:]
        securityAnalyses = [:]
        selectedAccountId = nil
        selectedProvider = nil
        selectedLocalMailbox = .inbox
        mailboxDefaultApplied = false
        mailClientProfile = .empty
        drafts = []
        sentMessages = []
        outboxMessages = []
        scheduledMessages = []
        mailStateOverlay = .empty
        cachedInboxRestored = false
        syncStartedAt = nil
        lastSyncCompletedAt = nil
        lastSyncDuration = nil
    }

    private func restoreLocalOAuthAccessRequests() {
        guard let data = UserDefaults.standard.data(forKey: Self.localOAuthAccessRequestsKey),
              let decoded = try? JSONDecoder().decode([LocalOAuthAccessRequest].self, from: data) else {
            localOAuthAccessRequests = []
            return
        }
        localOAuthAccessRequests = decoded
    }

    private func persistLocalOAuthAccessRequests() {
        guard let encoded = try? JSONEncoder().encode(localOAuthAccessRequests) else { return }
        UserDefaults.standard.set(encoded, forKey: Self.localOAuthAccessRequestsKey)
    }

    private func restoreGovernanceLedger() {
        let decoder = JSONDecoder()
        if let data = UserDefaults.standard.data(forKey: Self.governanceInvitationsKey),
           let decoded = try? decoder.decode([GovernanceInvitation].self, from: data) {
            governanceInvitations = decoded
        }
        if let data = UserDefaults.standard.data(forKey: Self.governanceAuditTrailKey),
           let decoded = try? decoder.decode([GovernanceAuditEvent].self, from: data) {
            governanceAuditTrail = decoded
        }
    }

    private func persistGovernanceLedger() {
        let encoder = JSONEncoder()
        if let encoded = try? encoder.encode(governanceInvitations) {
            UserDefaults.standard.set(encoded, forKey: Self.governanceInvitationsKey)
        }
        if let encoded = try? encoder.encode(governanceAuditTrail) {
            UserDefaults.standard.set(encoded, forKey: Self.governanceAuditTrailKey)
        }
    }

    private func appendGovernanceAudit(action: GovernanceAuditAction, provider: GovernanceProvider, account: String?, detail: String) {
        governanceAuditTrail.insert(GovernanceAuditEvent(
            id: UUID().uuidString,
            action: action,
            provider: provider,
            account: account,
            actor: currentUser?.email,
            createdAt: Date(),
            detail: detail
        ), at: 0)
        if governanceAuditTrail.count > 200 {
            governanceAuditTrail = Array(governanceAuditTrail.prefix(200))
        }
    }

    private static func generateInvitationCode(provider: GovernanceProvider) -> String {
        let prefix: String
        switch provider {
        case .google: prefix = "GGL"
        case .outlook: prefix = "OUT"
        case .office365: prefix = "O365"
        case .exchange: prefix = "EXC"
        case .imap: prefix = "IMP"
        case .smtp: prefix = "SMTP"
        case .cloudMailDomain: prefix = "CMD"
        }
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        func group(_ count: Int) -> String {
            String((0..<count).compactMap { _ in alphabet.randomElement() })
        }
        return "CM-\(prefix)-\(group(4))-\(group(4))-\(group(4))"
    }

    private static func hashInvitationCode(_ code: String) -> String {
        let normalized = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let digest = SHA256.hash(data: Data(normalized.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    #if DEBUG
    private struct TestCredentialBridgePayload: Decodable {
        let email: String
        let password: String
        let serverURL: String?
    }

    private func consumeTestCredentialBridgeIfPresent() async {
        let environment = ProcessInfo.processInfo.environment
        guard environment["CLOUDMAIL_ACCEPTANCE_TEST_MODE"] == "1",
              let rawURL = environment["CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL"],
              let url = URL(string: rawURL),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            return
        }

        do {
            clearLocalSession()
            await backend.updateToken(nil)
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                errorMessage = "Test credential bridge was not reachable."
                return
            }
            let payload = try JSONDecoder().decode(TestCredentialBridgePayload.self, from: data)
            if let serverURL = payload.serverURL, !serverURL.isEmpty {
                applyServer(urlString: serverURL, domain: domain)
            }
            await login(email: payload.email, password: payload.password)
        } catch {
            errorMessage = "Test credential bridge login failed."
        }
    }
    #endif

    @discardableResult
    private func loadUser(silentExpired: Bool = false) async -> Bool {
        do {
            currentUser = try await backend.loginUserInfo()
            if let email = currentUser?.email {
                restoreMailClientState(for: email)
                setPrimaryIdentity(email)
                restoreCachedInbox(for: email)
                forwardingSettings = try? await backend.forwardingSettings(email: email)
            }
            return true
        } catch {
            if silentExpired, let api = error as? APIError, api.code == 401 {
                clearLocalSession()
                await backend.updateToken(nil)
                errorMessage = nil
                return false
            }
            handle(error)
            return false
        }
    }

    // MARK: Mail

    func refresh() async {
        guard phase == .ready else { return }
        if let refreshTask {
            duplicateRefreshSkipped += 1
            await refreshTask.value
            return
        }
        let task = Task { @MainActor in
            await performRefresh()
        }
        refreshTask = task
        await task.value
        refreshTask = nil
    }

    private func scheduleMailboxSelectionRefresh() {
        mailboxSelectionRefreshTask?.cancel()
        mailboxSelectionRefreshTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self.refresh()
        }
    }

    private func performRefresh() async {
        isLoading = true
        errorMessage = nil
        refreshCount += 1
        let syncStart = Date()
        syncStartedAt = syncStart
        defer { isLoading = false }
        do {
            networkRequestCount += 1
            let loadedAddresses = try await backend.accounts()
            self.addresses = loadedAddresses
            persistCachedAccounts()
            reconcileMailClientProfile(with: loadedAddresses)
            normalizeMailboxSelection(afterLoading: loadedAddresses)
            applyDefaultMailboxIfNeeded(from: loadedAddresses)
            networkRequestCount += 1
            let mail = try await loadMailPage(cursor: nil)
            let skipped = await backend.skippedEmailItemCount()
            malformedMailSkippedCount = skipped
            let decoded = mail.map { $0.sanitizedForDisplayStorage() }
            self.emails = applyMailStateOverlay(to: decoded)
            await refreshConversationProjectionCutoverState()
            await refreshServerCorrelation(for: self.emails)
            invalidateSmartMailCategoryCache()
            recordMailLoadTrace(apiCount: mail.count, decodedCount: decoded.count, overlayCount: self.emails.count)
            persistCachedInbox()
            let unscopedEmails = self.emails
            Task { [weak self] in
                await self?.triageVisible(unscopedEmails)
            }
            Task { [weak self] in
                await self?.submitHybridEvidence(for: Array(unscopedEmails.prefix(12)))
            }
            let completed = Date()
            lastSyncCompletedAt = completed
            lastSyncDuration = completed.timeIntervalSince(syncStart)
            syncStartedAt = nil
            UserDefaults.standard.set(completed.timeIntervalSince1970, forKey: Self.lastRefreshKey)
            if skipped > 0 {
                errorMessage = "NEXORA skipped \(skipped) malformed mail item\(skipped == 1 ? "" : "s"). Your inbox remains usable."
            }
            scheduleForegroundGmailSync(addresses: loadedAddresses)
        } catch {
            syncStartedAt = nil
            handle(error)
        }
    }

    private func refreshConversationProjectionCutoverState() async {
        do {
            let resolution = try await backend.resolveWorkspaceResolution()
            availableWorkspaces = resolution.workspaces
            let workspaceId = resolution.workspaces.contains(where: { $0.id == persistedActiveWorkspaceId })
                ? persistedActiveWorkspaceId
                : resolution.defaultWorkspaceId
            activeWorkspaceId = workspaceId
            async let allMail = backend.allConversationProjections(workspaceId: workspaceId, surface: .allMail)
            async let categories = backend.allConversationProjections(workspaceId: workspaceId, surface: .categories)
            async let actionRequired = backend.allConversationProjections(workspaceId: workspaceId, surface: .actionRequired)
            async let waitingForMe = backend.allConversationProjections(workspaceId: workspaceId, surface: .waitingForMe)
            async let waitingForOthers = backend.allConversationProjections(workspaceId: workspaceId, surface: .waitingForOthers)
            async let missionControl = backend.allConversationProjections(workspaceId: workspaceId, surface: .missionControl)
            let reads = try await [allMail, categories, actionRequired, waitingForMe, waitingForOthers, missionControl]
            let epochs = Set(reads.compactMap(\.cutoverEpoch))
            let authority: ConversationProjectionAuthority = reads.allSatisfy { $0.authority == .authoritative }
                && epochs.count == 1
                ? .authoritative
                : .shadow
            conversationProjectionWorkspaceId = workspaceId
            conversationProjectionCutoverEpoch = authority == .authoritative ? epochs.first : nil
            conversationProjectionAuthority = authority
            conversationProjectionsBySurface = Dictionary(uniqueKeysWithValues: reads.map { ($0.surface, $0.projections) })
            conversationProjections = reads.first(where: { $0.surface == .allMail })?.projections ?? []
            applyProjectionClassificationAdapter(conversationProjections)
        } catch {
            // Never retain an authoritative read model after a failed refresh.
            conversationProjectionAuthority = .disabled
            conversationProjectionWorkspaceId = nil
            conversationProjectionCutoverEpoch = nil
            conversationProjectionsBySurface = [:]
            conversationProjections = []
        }
    }

    func selectActiveWorkspace(_ workspaceId: Int) {
        guard availableWorkspaces.contains(where: { $0.id == workspaceId }) else { return }
        invalidateServerCorrelation()
        persistedActiveWorkspaceId = workspaceId
        activeWorkspaceId = workspaceId
        Task {
            await refreshConversationProjectionCutoverState()
            await refreshServerCorrelation(for: emails)
        }
    }

    private func resolvedActiveWorkspaceId() async throws -> Int {
        if let activeWorkspaceId { return activeWorkspaceId }
        let resolution = try await backend.resolveWorkspaceResolution()
        availableWorkspaces = resolution.workspaces
        let workspaceId = resolution.workspaces.contains(where: { $0.id == persistedActiveWorkspaceId })
            ? persistedActiveWorkspaceId
            : resolution.defaultWorkspaceId
        activeWorkspaceId = workspaceId
        return workspaceId
    }

    func retryServerCorrelation() async {
        await refreshServerCorrelation(for: emails)
    }

    private func invalidateServerCorrelation() {
        serverCorrelationAttemptId = UUID()
        serverCorrelation = .idle
    }

    private func refreshServerCorrelation(for sourceEmails: [EmailMessage]) async {
        guard phase == .ready else {
            invalidateServerCorrelation()
            return
        }
        let target: EmailMessage?
        if let selectedAccountId {
            target = sourceEmails.first { $0.accountId == selectedAccountId }
        } else {
            target = sourceEmails.first { $0.accountId != nil }
        }
        guard let target, let accountId = target.accountId, let workspaceId = activeWorkspaceId else {
            serverCorrelation = ServerCorrelationSnapshot(
                phase: .failed,
                acceptanceSession: nil,
                classification: nil,
                lastVerifiedAt: nil
            )
            return
        }

        let attemptId = UUID()
        serverCorrelationAttemptId = attemptId
        serverCorrelation = ServerCorrelationSnapshot(
            phase: .checking,
            acceptanceSession: nil,
            classification: nil,
            lastVerifiedAt: nil
        )
        do {
            let acceptanceSession = try await backend.createAcceptanceSession(
                accountId: accountId,
                idempotencyKey: clientCorrelationNonce
            )
            guard serverCorrelationAttemptId == attemptId else { return }
            guard let challenge = acceptanceSession.challenge, !challenge.isEmpty else {
                serverCorrelation = ServerCorrelationSnapshot(
                    phase: .failed,
                    acceptanceSession: acceptanceSession,
                    classification: nil,
                    lastVerifiedAt: nil
                )
                return
            }
            let classification = try await backend.classificationRecord(
                canonicalMessageId: String(target.emailId),
                acceptanceSessionId: acceptanceSession.id
            )
            guard serverCorrelationAttemptId == attemptId else { return }
            try await backend.consumeAcceptanceSession(
                id: acceptanceSession.id,
                challenge: challenge,
                classificationId: classification.classification.id
            )
            guard serverCorrelationAttemptId == attemptId else { return }
            let confirmedSession = try await backend.acceptanceSession(id: acceptanceSession.id)
            guard serverCorrelationAttemptId == attemptId else { return }
            let phase = ServerCorrelationEvaluator.evaluate(
                acceptanceSession: confirmedSession,
                classification: classification,
                expectedWorkspaceId: workspaceId,
                expectedAccountId: accountId
            )
            serverCorrelation = ServerCorrelationSnapshot(
                phase: phase,
                acceptanceSession: confirmedSession,
                classification: classification,
                lastVerifiedAt: phase == .verified
                    ? confirmedSession.serverTimestamp.flatMap(ServerCorrelationEvaluator.parseServerDate)
                    : nil
            )
        } catch {
            guard serverCorrelationAttemptId == attemptId else { return }
            let offline = (error as? APIError)?.code == -1
            serverCorrelation = ServerCorrelationSnapshot(
                phase: offline ? .offline : .failed,
                acceptanceSession: nil,
                classification: nil,
                lastVerifiedAt: nil
            )
        }
    }

    var isConversationProjectionAuthoritative: Bool {
        conversationProjectionAuthority == .authoritative
    }

    func conversationProjections(for surface: ConversationProjectionSurface) -> [ConversationProjection] {
        guard isConversationProjectionAuthoritative else { return [] }
        return conversationProjectionsBySurface[surface] ?? []
    }

    func sourceEmail(for projection: ConversationProjection) -> EmailMessage? {
        for source in projection.sourceNavigation {
            guard let messageId = source.messageId else { continue }
            if let email = emails.first(where: {
                $0.emailId == messageId && (source.accountId == nil || $0.accountId == source.accountId)
            }) { return email }
        }
        return nil
    }

    // Shadow reads still reconcile the legacy row adapter with the portable
    // Conversation Projection. This keeps the temporary source-row renderer
    // truthful while rollout is guarded, and becomes a no-op for the native
    // projection renderer once its reads are authoritative.
    private func applyProjectionClassificationAdapter(_ projections: [ConversationProjection]) {
        var categoriesBySource: [String: (category: String, version: Int)] = [:]
        for projection in projections {
            guard let category = projection.categoryKeys.first(where: { !$0.isEmpty })?.lowercased() else { continue }
            for source in projection.sourceNavigation {
                guard let messageId = source.messageId else { continue }
                let key = "\(source.accountId ?? -1):\(messageId)"
                // Historical repair can temporarily retain superseded
                // conversation rows for one source message. The newest
                // projection version is the authoritative source adapter;
                // never let an older AI classification overwrite it.
                if let existing = categoriesBySource[key], existing.version > projection.projectionVersion { continue }
                categoriesBySource[key] = (category, projection.projectionVersion)
            }
        }
        guard !categoriesBySource.isEmpty else { return }
        var changed = false
        for index in emails.indices {
            let exactKey = "\(emails[index].accountId):\(emails[index].emailId)"
            let unscopedKey = "-1:\(emails[index].emailId)"
            guard let source = categoriesBySource[exactKey] ?? categoriesBySource[unscopedKey], emails[index].semanticCategory?.lowercased() != source.category else { continue }
            emails[index].semanticCategory = source.category
            changed = true
        }
        if changed { invalidateSmartMailCategoryCache() }
    }

    func conversationProjectionDetail(_ projection: ConversationProjection) async throws -> ConversationProjectionDetail {
        guard isConversationProjectionAuthoritative, let workspaceId = conversationProjectionWorkspaceId else {
            throw APIError(code: 409, message: "Conversation Projection is not authoritative.")
        }
        return try await backend.conversationProjectionDetail(workspaceId: workspaceId, conversationId: projection.conversationId)
    }

    func mutateProjectionMessage(_ message: ConversationProjectionMessage,
                                 conversationId: String,
                                 action: String,
                                 value: CanonicalMutationValue) async throws -> CanonicalMutationReceipt {
        guard isConversationProjectionAuthoritative, let workspaceId = conversationProjectionWorkspaceId else {
            throw APIError(code: 409, message: "Conversation Projection is not authoritative.")
        }
        return try await backend.mutateCanonicalProjectionMessage(
            message,
            conversationId: conversationId,
            workspaceId: workspaceId,
            action: action,
            value: value,
            sourceSurface: "conversation_projection_detail",
            idempotencyKey: UUID().uuidString
        )
    }

    func refreshIfStale(maxAge: TimeInterval = 3600, allowDuringBootstrap: Bool = false) async {
        guard phase == .ready else { return }
        guard allowDuringBootstrap || bootstrapTask == nil else { return }
        if refreshTask != nil { return }
        let last = UserDefaults.standard.double(forKey: Self.lastRefreshKey)
        guard last == 0 || Date().timeIntervalSince1970 - last > maxAge else { return }
        await refresh()
    }

    private func scheduleForegroundGmailSync(addresses loadedAddresses: [MailAddress]) {
        let gmailAccounts = loadedAddresses.filter(isForegroundSyncEligibleGmailAccount)
        guard !gmailAccounts.isEmpty, gmailForegroundSyncTask == nil else { return }
        gmailForegroundSyncTask = Task { @MainActor in
            await self.syncProviderMailboxesInBackground(addresses: loadedAddresses)
            self.gmailForegroundSyncTask = nil
        }
    }

    private func syncProviderMailboxesInBackground(addresses loadedAddresses: [MailAddress]) async {
        let gmailAccounts = loadedAddresses.filter(isForegroundSyncEligibleGmailAccount)
        let selected = selectedAccountId.flatMap { selectedId in
            gmailAccounts.first { $0.accountId == selectedId }
        }
        let targets: [MailAddress]
        if let selected {
            targets = [selected] + gmailAccounts.filter { $0.accountId != selected.accountId }
        } else {
            targets = gmailAccounts
        }
        guard !targets.isEmpty else { return }
        let batchSize = 4
        for start in stride(from: 0, to: targets.count, by: batchSize) {
            let batch = Array(targets[start..<min(start + batchSize, targets.count)])
            await withTaskGroup(of: (Int, Result<GmailSyncResponse, Error>).self) { group in
                for account in batch {
                    gmailSyncStatusByAccountId[account.accountId] = "Provider sync requested"
                    group.addTask { [backend] in
                        do {
                            let result = try await backend.syncGmail(accountId: account.accountId, limit: 50)
                            return (account.accountId, .success(result))
                        } catch {
                            return (account.accountId, .failure(error))
                        }
                    }
                }

                for await (accountId, result) in group {
                    networkRequestCount += 1
                    switch result {
                    case .success(let response):
                        let fetched = response.fetched ?? 0
                        let cached = response.cacheReused ?? 0
                        gmailSyncStatusByAccountId[accountId] = "Provider sync completed: \(response.synced) imported · \(fetched) fetched · \(cached) cached"
                    case .failure:
                        gmailSyncStatusByAccountId[accountId] = "Provider sync failed"
                    }
                }
            }
        }
        await reloadMailAfterProviderSync()
    }

    private func reloadMailAfterProviderSync() async {
        guard phase == .ready else { return }
        do {
            networkRequestCount += 1
            let mail = try await loadMailPage(cursor: nil)
            let skipped = await backend.skippedEmailItemCount()
            malformedMailSkippedCount = skipped
            let decoded = mail.map { $0.sanitizedForDisplayStorage() }
            emails = applyMailStateOverlay(to: decoded)
            invalidateSmartMailCategoryCache()
            recordMailLoadTrace(apiCount: mail.count, decodedCount: decoded.count, overlayCount: emails.count)
            persistCachedInbox()
            let completed = Date()
            lastSyncCompletedAt = completed
            UserDefaults.standard.set(completed.timeIntervalSince1970, forKey: Self.lastRefreshKey)
        } catch {
            gmailSyncStatusByAccountId = gmailSyncStatusByAccountId.mapValues { status in
                status == "Provider sync requested" ? "Provider sync delayed" : status
            }
        }
    }

    private func isForegroundSyncEligibleGmailAccount(_ account: MailAddress) -> Bool {
        guard account.displayProvider == .gmail || account.displayProvider == .googleWorkspace else {
            return false
        }
        let status = (account.syncStatus ?? "").lowercased()
        let error = (account.syncError ?? "").lowercased()
        if status == "needs_reconnect"
            || status == "legacy_imap_unsupported"
            || status == "blocked"
            || status == "removed"
            || status == "archived"
            || error.contains("legacy_imap_unsupported") {
            return false
        }
        return true
    }

    func loadMore() async {
        guard !isLoadingMore, let last = emails.last?.emailId else { return }
        if let lastLoadMoreStartedAt, Date().timeIntervalSince(lastLoadMoreStartedAt) < 2 {
            return
        }
        lastLoadMoreStartedAt = Date()
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            networkRequestCount += 1
            let more = try await loadMailPage(cursor: last)
            let skipped = await backend.skippedEmailItemCount()
            malformedMailSkippedCount += skipped
            let existing = Set(emails.map(\.emailId))
            emails.append(contentsOf: applyMailStateOverlay(to: more.map { $0.sanitizedForDisplayStorage() }).filter { !existing.contains($0.emailId) })
            Task { [weak self] in
                await self?.submitHybridEvidence(for: Array(more.prefix(12)))
            }
            invalidateSmartMailCategoryCache()
            persistCachedInbox()
            if skipped > 0 {
                errorMessage = "NEXORA skipped \(skipped) malformed older mail item\(skipped == 1 ? "" : "s")."
            }
        } catch { handle(error) }
    }

    private func loadMailPage(cursor: Int?) async throws -> [EmailMessage] {
        if selectedAccountId == nil {
            return try await backend.globalMailLedger(
                accountId: nil,
                cursor: cursor,
                provider: selectedProvider,
                size: 50
            )
        }
        return try await backend.emails(
            accountId: selectedAccountId,
            allReceive: false,
            cursor: cursor,
            provider: nil,
            size: 50
        )
    }

    private func submitHybridEvidence(for messages: [EmailMessage]) async {
        guard !messages.isEmpty else { return }
        let adapter = AppleMailModelCapabilityAdapter()
        let availability = await adapter.availabilityState()
        let language = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        for email in messages {
            guard !Task.isCancelled, email.accountId != nil else { continue }
            let body = (email.text?.isEmpty == false ? email.text : email.content) ?? ""
            let version = email.stateVersion ?? 1
            let evidence: LocalMailSemanticEvidence
            do {
                if availability == "available" {
                    evidence = try await adapter.infer(
                        subject: email.subject ?? "", sender: email.sendEmail ?? "",
                        minimalBody: body, language: language, messageVersion: version,
                        contentDigest: AppleMailModelCapabilityAdapter.digest(
                            subject: email.subject ?? "", sender: email.sendEmail ?? "", minimalBody: body)
                    )
                } else {
                    evidence = AppleMailModelCapabilityAdapter.unavailableEvidence(
                        subject: email.subject ?? "", sender: email.sendEmail ?? "",
                        minimalBody: body, language: language, messageVersion: version,
                        availabilityState: availability
                    )
                }
                let workspaceId: Int
                if let canonicalWorkspaceId = email.canonicalWorkspaceId {
                    workspaceId = canonicalWorkspaceId
                } else {
                    workspaceId = try await resolvedActiveWorkspaceId()
                }
                let policy = try await backend.submitLocalMailEvidence(email: email, workspaceId: workspaceId, evidence: evidence)
                if policy.validationState == "accepted",
                   policy.contentDigest == evidence.contentDigest,
                   let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) {
                    emails[idx].semanticCategory = policy.category
                    emails[idx].isPriority = policy.isPriority
                    emails[idx].canonicalStateMode = "policy_authoritative"
                }
            } catch {
                // Evidence is advisory. Mail loading and user actions remain available;
                // the server retains no partial evidence on validation failure.
                continue
            }
        }
    }

    func recordRenderedMailTrace(_ rendered: MailVisibilityTrace) {
        var trace = rendered
        trace.apiCount = max(trace.apiCount, mailVisibilityTrace.apiCount)
        trace.decodedCount = max(trace.decodedCount, mailVisibilityTrace.decodedCount)
        trace.overlayCount = max(trace.overlayCount, mailVisibilityTrace.overlayCount)
        guard trace.apiCount != mailVisibilityTrace.apiCount
            || trace.decodedCount != mailVisibilityTrace.decodedCount
            || trace.overlayCount != mailVisibilityTrace.overlayCount
            || trace.scopedCount != mailVisibilityTrace.scopedCount
            || trace.folderCount != mailVisibilityTrace.folderCount
            || trace.filterCount != mailVisibilityTrace.filterCount
            || trace.renderedCount != mailVisibilityTrace.renderedCount
            || trace.firstDrop != mailVisibilityTrace.firstDrop else {
            return
        }
        mailVisibilityTrace = trace
    }

    private func recordMailLoadTrace(apiCount: Int, decodedCount: Int, overlayCount: Int) {
        mailVisibilityTrace = MailVisibilityTrace(
            apiCount: apiCount,
            decodedCount: decodedCount,
            overlayCount: overlayCount,
            scopedCount: 0,
            folderCount: 0,
            filterCount: 0,
            renderedCount: 0,
            firstDrop: apiCount == 0 ? "API returned no messages" : "Awaiting visible selection",
            recordedAt: Date()
        )
    }

    private func canonicalMutation(_ email: EmailMessage,
                                   action: String,
                                   value: CanonicalMutationValue,
                                   sourceSurface: String = "ios_mail") async throws -> CanonicalMutationReceipt {
        // SwiftUI rows are value snapshots. Always begin with the newest
        // in-memory canonical version rather than the snapshot that rendered
        // a menu or swipe action.
        let currentEmail = emails.first(where: { $0.emailId == email.emailId }) ?? email
        let workspaceId: Int
        if let canonicalWorkspaceId = currentEmail.canonicalWorkspaceId {
            workspaceId = canonicalWorkspaceId
        } else {
            workspaceId = try await resolvedActiveWorkspaceId()
        }
        let valueRef: String
        switch value {
        case .bool(let value): valueRef = value ? "true" : "false"
        case .string(let value): valueRef = value
        case .strings(let values): valueRef = values.sorted().joined(separator: "-")
        }
        func submit(_ mutationEmail: EmailMessage) async throws -> CanonicalMutationReceipt {
            let operationRef = "canonical.mail.pending.\(workspaceId).\(mutationEmail.accountId ?? 0).\(mutationEmail.emailId).\(mutationEmail.stateVersion ?? 1).\(action).\(valueRef).\(sourceSurface)"
            let defaults = UserDefaults.standard
            let idempotencyKey = defaults.string(forKey: operationRef)
                ?? "ios:\(workspaceId):\(mutationEmail.accountId ?? 0):\(mutationEmail.emailId):\(mutationEmail.stateVersion ?? 1):\(action):\(UUID().uuidString)"
            defaults.set(idempotencyKey, forKey: operationRef)
            let receipt = try await backend.mutateCanonicalMail(
                email: mutationEmail,
                workspaceId: workspaceId,
                action: action,
                value: value,
                sourceSurface: sourceSurface,
                idempotencyKey: idempotencyKey
            )
            guard receipt.status == "completed" else {
                throw APIError(code: -5, message: "Mail action did not produce a completed durable receipt.")
            }
            defaults.removeObject(forKey: operationRef)
            return receipt
        }
        do {
            return try await submit(currentEmail)
        } catch let error as APIError where error.message.localizedCaseInsensitiveContains("mail_state_version_conflict") {
            guard let accountId = currentEmail.accountId,
                  let authoritative = try await backend.canonicalMailState(workspaceId: workspaceId, accountId: accountId, messageId: currentEmail.emailId) else {
                throw error
            }
            reconcileCanonicalState(authoritative, to: currentEmail.emailId)
            var retryEmail = emails.first(where: { $0.emailId == currentEmail.emailId }) ?? currentEmail
            retryEmail.stateVersion = authoritative.stateVersion
            // Exactly one retry: a second conflict is truthful concurrent work,
            // not a condition to overwrite or hide from the user.
            return try await submit(retryEmail)
        }
    }

    private func reconcileCanonicalState(_ state: CanonicalMailState, to emailId: Int) {
        guard let index = emails.firstIndex(where: { $0.emailId == emailId }) else { return }
        emails[index].stateVersion = state.stateVersion
        emails[index].folderKey = state.folderKey
        emails[index].semanticCategory = state.semanticCategory
        emails[index].unread = state.isRead == 1 ? 0 : 1
        emails[index].isPriority = state.isPriority == 1
        emails[index].isVip = state.isVip == 1
        emails[index].junkDisposition = state.junkDisposition
        emails[index].isStar = state.isStarred
        emails[index].canonicalStateMode = "authoritative"
        if let folder = LocalMailBoxKind(rawValue: state.folderKey) {
            mailStateOverlay.folderByEmailId[emailId] = folder
        }
        persistMailStateOverlay()
        persistCachedInbox()
    }

    private func applyCanonicalReceipt(_ receipt: CanonicalMutationReceipt, to emailId: Int) {
        if let idx = emails.firstIndex(where: { $0.emailId == emailId }) {
            emails[idx].stateVersion = receipt.stateVersion
            emails[idx].canonicalStateMode = "authoritative"
        }
    }

    func markRead(_ email: EmailMessage) async {
        guard email.isUnread else { return }
        do {
            let receipt = try await canonicalMutation(email, action: "set_read", value: .bool(true))
            mailStateOverlay.readEmailIds.insert(email.emailId)
            mailStateOverlay.unreadEmailIds.remove(email.emailId)
            if let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) { emails[idx].unread = 0 }
            applyCanonicalReceipt(receipt, to: email.emailId)
            persistMailStateOverlay()
            persistCachedInbox()
            invalidateSmartMailCategoryCache()
        } catch { handle(error) }
    }

    func markUnread(_ email: EmailMessage) {
        Task { @MainActor in
            do {
                let receipt = try await canonicalMutation(email, action: "set_read", value: .bool(false))
                mailStateOverlay.unreadEmailIds.insert(email.emailId)
                mailStateOverlay.readEmailIds.remove(email.emailId)
                if let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) { emails[idx].unread = 1 }
                applyCanonicalReceipt(receipt, to: email.emailId)
                persistMailStateOverlay()
                persistCachedInbox()
                invalidateSmartMailCategoryCache()
            } catch { handle(error) }
        }
    }

    @discardableResult
    func delete(_ email: EmailMessage) async -> Bool {
        guard await move(email, to: .trash) else { return false }
        if mailStateOverlay.folderByEmailId[email.emailId] == .trash {
            mailStateOverlay.deletedEmailIds.insert(email.emailId)
            triageCache[email.emailId] = nil
            invalidateSmartMailCategoryCache()
            persistMailStateOverlay()
            persistCachedInbox()
        }
        return true
    }

    func toggleStar(_ email: EmailMessage) async {
        await setStar(email, starred: !email.isStarred)
    }

    @discardableResult
    func setStar(_ email: EmailMessage, starred shouldStar: Bool) async -> Bool {
        do {
            let receipt = try await canonicalMutation(email, action: "set_starred", value: .bool(shouldStar))
            if let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) { emails[idx].isStar = shouldStar ? 1 : 0 }
            if shouldStar {
                mailStateOverlay.starredEmailIds.insert(email.emailId)
                mailStateOverlay.unstarredEmailIds.remove(email.emailId)
            } else {
                mailStateOverlay.unstarredEmailIds.insert(email.emailId)
                mailStateOverlay.starredEmailIds.remove(email.emailId)
            }
            applyCanonicalReceipt(receipt, to: email.emailId)
            persistMailStateOverlay()
            persistCachedInbox()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    @discardableResult
    func archive(_ email: EmailMessage) async -> Bool {
        await move(email, to: .done)
    }

    /// Junk is a durable canonical move, not a local heuristic label.
    @discardableResult
    func moveToJunk(_ email: EmailMessage, recordsUndo: Bool = true) async -> Bool {
        await move(email, to: .junk, recordsUndo: recordsUndo)
    }

    @discardableResult
    func move(_ email: EmailMessage, to folder: LocalMailBoxKind, recordsUndo: Bool = true) async -> Bool {
        let previousFolder = effectiveFolder(for: email)
        do {
            let receipt = try await canonicalMutation(email, action: "move_folder", value: .string(folder.rawValue))
            mailStateOverlay.folderByEmailId[email.emailId] = folder
            if let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) { emails[idx].folderKey = folder.rawValue }
            applyCanonicalReceipt(receipt, to: email.emailId)
            persistMailStateOverlay()
            persistCachedInbox()
            v2ProductivityRefreshTick += 1
            if recordsUndo && previousFolder != folder {
                presentMailUndo(email: email, previous: previousFolder, current: folder)
            }
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func undoLastMailAction() async {
        guard let undo = mailUndoState, !mailUndoInProgress else { return }
        mailUndoInProgress = true
        defer { mailUndoInProgress = false }
        // The initial mutation advances the canonical state version. Undo must
        // operate on that current version rather than the pre-move snapshot or
        // a legitimate optimistic-concurrency fence will reject recovery.
        let currentEmail = emails.first(where: { $0.emailId == undo.email.emailId }) ?? undo.email
        guard await move(currentEmail, to: undo.previousFolder, recordsUndo: false) else {
            // Keep the recovery affordance available after a truthful failure.
            // The user can retry after connectivity or concurrent state settles.
            return
        }
        if mailUndoState?.id == undo.id { mailUndoState = nil }
        if undo.previousFolder != .trash {
            mailStateOverlay.deletedEmailIds.remove(undo.email.emailId)
            persistMailStateOverlay()
            persistCachedInbox()
        }
    }

    private func presentMailUndo(email: EmailMessage, previous: LocalMailBoxKind, current: LocalMailBoxKind) {
        let state = MailUndoState(email: email, previousFolder: previous, currentFolder: current)
        mailUndoState = state
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(6))
            if mailUndoState?.id == state.id { mailUndoState = nil }
        }
    }

    @discardableResult
    func restoreToInbox(_ email: EmailMessage) async -> Bool {
        guard await move(email, to: .inbox) else { return false }
        if mailStateOverlay.folderByEmailId[email.emailId] == .inbox {
            mailStateOverlay.deletedEmailIds.remove(email.emailId)
            persistMailStateOverlay()
            persistCachedInbox()
        }
        return true
    }

    struct SenderBatchMoveResult: Equatable {
        let total: Int
        let moved: Int
        let failed: Int
    }

    func senderBulkDestinations(for email: EmailMessage) async throws -> SenderBulkDestinationContract {
        let sender = normalizedSenderIdentity(email.fromAddress)
        guard !sender.isEmpty else { throw APIError(code: -30, message: "This sender does not have a usable exact address.") }
        return try await backend.senderBulkDestinations(workspaceId: try await resolvedActiveWorkspaceId(), normalizedSender: sender)
    }

    func previewSenderBulk(for email: EmailMessage, destination: SenderBulkDestination) async throws -> SenderBulkPreview {
        try await backend.senderBulkPreview(workspaceId: try await resolvedActiveWorkspaceId(), normalizedSender: normalizedSenderIdentity(email.fromAddress), destination: destination)
    }

    func executeSenderBulk(for email: EmailMessage, destination: SenderBulkDestination, confirmed: Bool) async throws -> SenderBulkExecutionResult {
        let workspaceId = try await resolvedActiveWorkspaceId()
        // Projection materialization has a single writer fence. A short
        // overlap with live ingestion is ordinary, so retry it here rather
        // than requiring the person to repeat the same intentional action.
        for attempt in 0..<4 {
            do {
                let result = try await backend.executeSenderBulk(workspaceId: workspaceId, normalizedSender: normalizedSenderIdentity(email.fromAddress), destination: destination, confirmed: confirmed)
                await refreshConversationProjectionCutoverState()
                return result
            } catch {
                let retryableFence = error.localizedDescription.contains("sender_bulk_materialization_busy_retryable")
                guard retryableFence, attempt < 3 else { throw error }
                try await Task.sleep(nanoseconds: UInt64((attempt + 1) * 500_000_000))
            }
        }
        throw APIError(code: -31, message: "NEXORA is finishing a mailbox update. Please try again shortly.")
    }

    private func normalizedSenderIdentity(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let start = trimmed.lastIndex(of: "<"), let end = trimmed.lastIndex(of: ">"), start < end else { return trimmed }
        return String(trimmed[trimmed.index(after: start)..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Explicit sender-scoped bulk move. A single-row gesture never silently
    /// expands to sibling mail; each sibling uses the canonical mutation path.
    func moveAllFromSender(_ email: EmailMessage, to folder: LocalMailBoxKind) async -> SenderBatchMoveResult {
        let sender = email.fromAddress.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !sender.isEmpty else { return SenderBatchMoveResult(total: 0, moved: 0, failed: 0) }
        let siblings = emails.filter {
            $0.fromAddress.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sender
                && effectiveFolder(for: $0) != folder
        }
        var moved = 0
        var failed = 0
        for sibling in siblings {
            if await move(sibling, to: folder, recordsUndo: false) { moved += 1 }
            else { failed += 1 }
        }
        return SenderBatchMoveResult(total: siblings.count, moved: moved, failed: failed)
    }

    func effectiveFolder(for email: EmailMessage) -> LocalMailBoxKind {
        mailStateOverlay.folderByEmailId[email.emailId]
            ?? email.folderKey.flatMap(LocalMailBoxKind.init(rawValue:))
            ?? .inbox
    }

    func v2Category(for email: EmailMessage) -> MailOSV2Category {
        mailCategoryEngine.classify(email, ruleEngine: senderRuleEngine)
    }

    func smartMailCategory(for email: EmailMessage) -> SmartMailCategory {
        smartMailClassification(for: email).category
    }

    func smartMailClassification(for email: EmailMessage) -> SmartMailClassification {
        rebuildSmartMailCategoryCacheIfNeeded()
        return smartMailClassificationCache[email.emailId] ?? SmartMailClassification(
            category: .other,
            confidence: 0,
            reason: "Classification is still being prepared.",
            actionRequired: false,
            waitingReply: false,
            priority: false,
            score: .zero
        )
    }

    private func invalidateSmartMailCategoryCache() {
        smartMailClassificationCache.removeAll(keepingCapacity: true)
        smartMailCategoryCacheNeedsRebuild = true
    }

    private func relationshipEstablished(for email: EmailMessage, senderHistoryCount: Int) -> Bool {
        let sender = email.fromAddress.lowercased()
        let profileContacts = profileEmailSet(mailClientProfile.favoriteContactEmails)
            .union(profileEmailSet(mailClientProfile.vipContactEmails))
            .union(profileEmailSet(mailClientProfile.starredContactEmails))
        if profileContacts.contains(sender) { return true }
        if (mailClientProfile.autocompleteLearning?[sender] ?? 0) > 0 { return true }
        if senderHistoryCount >= 2 { return true }
        if sentMessages.contains(where: { sent in
            let recipients = "\(sent.to),\(sent.cc),\(sent.bcc)".lowercased()
            return recipients.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == " " }).contains { token in
                String(token).trimmingCharacters(in: .whitespacesAndNewlines) == sender
            }
        }) { return true }
        return false
    }

    private func rebuildSmartMailCategoryCacheIfNeeded() {
        guard smartMailCategoryCacheNeedsRebuild else { return }

        let senderCounts = Dictionary(grouping: emails, by: { $0.fromAddress.lowercased() })
            .mapValues(\.count)
        let organizationCounts = Dictionary(grouping: emails, by: { $0.fromAddress.split(separator: "@").last.map(String.init)?.lowercased() ?? "" })
            .mapValues(\.count)
        smartMailClassificationCache = Dictionary(uniqueKeysWithValues: emails.map { email in
            let classification: SmartMailClassification
            let relationshipEstablished = relationshipEstablished(for: email, senderHistoryCount: senderCounts[email.fromAddress.lowercased(), default: 1])
            let base = nexoraIntelligenceEngine.classify(
                email,
                triage: triageCache[email.emailId],
                senderHistoryCount: senderCounts[email.fromAddress.lowercased(), default: 1],
                organizationHistoryCount: organizationCounts[email.fromAddress.split(separator: "@").last.map(String.init)?.lowercased() ?? "", default: 1],
                externalReputationHint: externalReputationRegistry.hint(for: email),
                relationshipEstablished: relationshipEstablished
            )
            let trust = trustAssessment(for: email)
            let securityRestricted = trust.trustLevel == .highRisk || trust.trustLevel == .suspicious || trust.phishingRisk == .high || trust.phishingRisk == .critical
            let canonicalCategory = canonicalSmartCategory(for: email)
            if let canonicalCategory {
                // Facet Classification is the communication classification
                // authority. AI can explain a category, but it cannot leave a
                // promotion in a priority bucket after a durable recategorize.
                classification = SmartMailClassification(
                    category: canonicalCategory,
                    confidence: 100,
                    reason: "Canonical Conversation Projection classification.",
                    actionRequired: canonicalCategory == .actionRequired,
                    waitingReply: false,
                    priority: canonicalCategory == .priority,
                    score: base.score
                )
            } else if securityRestricted {
                classification = SmartMailClassification(
                    category: base.category == .people || base.category == .priority || base.category == .customers ? .notifications : base.category,
                    confidence: base.confidence,
                    reason: "Security controls take precedence over relationship and correction-based elevation.",
                    actionRequired: false,
                    waitingReply: false,
                    priority: false,
                    score: base.score
                )
            } else if let learned = userClassificationMemory.override(for: email) {
                classification = SmartMailClassification(
                    category: learned.category,
                    confidence: 100,
                    reason: "User classification remembered for this \(learned.scope).",
                    actionRequired: learned.category == .actionRequired,
                    waitingReply: false,
                    priority: learned.category == .priority,
                    score: SmartClassificationScore(userHistory: 100, organizationHistory: 100, senderReputation: 100, mailMetadata: 100, aiSemantic: 100)
                )
            } else {
                classification = base
            }
            return (email.emailId, classification)
        })
        smartMailCategoryCacheNeedsRebuild = false
    }

    private func canonicalSmartCategory(for email: EmailMessage) -> SmartMailCategory? {
        switch (email.semanticCategory ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "action_required": return .actionRequired
        case "priority": return .priority
        case "unread": return .unread
        case "people": return .people
        case "customers": return .customers
        case "work": return .work
        case "finance", "transactions": return .finance
        case "orders": return .orders
        case "travel": return .travel
        case "updates", "forums": return .updates
        case "notifications": return .notifications
        case "promotions": return .promotions
        case "archived": return .archived
        case "other", "primary", "general": return .other
        default: return nil
        }
    }

    @discardableResult
    func applyV2Category(_ category: MailOSV2Category, for email: EmailMessage) async -> Bool {
        if category == .junk {
            return await moveToJunk(email)
        }
        // The legacy V2 menu is still a supported entry point, but it must
        // never report a local sender-rule write as a completed category move.
        // Persist the portable primary facet through the same canonical action
        // contract used by every other client surface.
        do {
            let receipt = try await canonicalMutation(
                email,
                action: "set_category",
                value: .string(category.rawValue.lowercased()),
                sourceSurface: "ios_mail_v2_category"
            )
            if let index = emails.firstIndex(where: { $0.emailId == email.emailId }) {
                emails[index].semanticCategory = category.rawValue.lowercased()
            }
            applyCanonicalReceipt(receipt, to: email.emailId)
            invalidateSmartMailCategoryCache()
            v2ProductivityRefreshTick += 1
            persistCachedInbox()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func learnV2Category(_ category: MailOSV2Category, for email: EmailMessage) {
        Task { _ = await applyV2Category(category, for: email) }
    }

    @discardableResult
    func applySmartMailCategory(_ category: SmartMailCategory, for email: EmailMessage) async -> Bool {
        // A row-level recategorization is strictly message-scoped. Sender,
        // domain, and workspace rules require an explicit scope-specific action.
        if category == .archived { return await move(email, to: .done) }
        do {
            let canonicalCategory: String
            switch category {
            case .actionRequired: canonicalCategory = "action_required"
            default: canonicalCategory = category.rawValue.lowercased()
            }
            let receipt = try await canonicalMutation(email, action: "set_category", value: .string(canonicalCategory))
            userClassificationMemory.learn(category, for: email, scope: "message")
            if let idx = emails.firstIndex(where: { $0.emailId == email.emailId }) { emails[idx].semanticCategory = canonicalCategory }
            applyCanonicalReceipt(receipt, to: email.emailId)
            invalidateSmartMailCategoryCache()
            v2ProductivityRefreshTick += 1
            persistCachedInbox()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func learnSmartMailCategory(_ category: SmartMailCategory, for email: EmailMessage) {
        Task { _ = await applySmartMailCategory(category, for: email) }
    }

    var workQueueSignalCounts: [WorkQueueSignal: Int] {
        emails.reduce(into: [:]) { counts, email in
            let classification = smartMailClassification(for: email)
            let signals = workOSIntelligenceEngine.signals(for: email, classification: classification, triage: triageCache[email.emailId])
            for signal in signals { counts[signal, default: 0] += 1 }
        }
    }

    var followUpCandidates: [FollowUpCandidate] {
        emails.compactMap { workOSIntelligenceEngine.followUpCandidate(for: $0) }
            .sorted { $0.daysSinceSent > $1.daysSinceSent }
    }

    func retentionRecommendation(for email: EmailMessage) -> RetentionRecommendation {
        WorkOSRetentionPolicy.recommendation(for: smartMailClassification(for: email))
    }

    func relationshipIntelligence(for email: EmailMessage) -> RelationshipIntelligence {
        let sender = email.fromAddress.lowercased()
        let senderCount = emails.filter { $0.fromAddress.lowercased() == sender }.count
        let vip = profileEmailSet(mailClientProfile.vipContactEmails)
        let starred = profileEmailSet(mailClientProfile.starredContactEmails)
        let contacts = profileEmailSet(mailClientProfile.favoriteContactEmails).union(vip).union(starred)
        let sentToSender = sentMessages.contains { "\($0.to),\($0.cc),\($0.bcc)".lowercased().contains(sender) }
        return nexoraIntelligenceEngine.relationship(for: email, senderHistoryCount: senderCount, sentToSender: sentToSender, isContact: contacts.contains(sender), isVIP: vip.contains(sender), isStarred: starred.contains(sender))
    }

    func securityIntelligence(for email: EmailMessage) -> SecurityIntelligence {
        nexoraIntelligenceEngine.security(for: email, relationship: relationshipIntelligence(for: email), externalReputationHint: externalReputationRegistry.hint(for: email))
    }

    func trustAssessment(for email: EmailMessage) -> NexoraTrustAssessment {
        let relationship = relationshipIntelligence(for: email)
        let security = securityIntelligence(for: email)
        return nexoraTrustEngine.assess(email: email, relationship: relationship, security: security, reputationHint: externalReputationRegistry.hint(for: email))
    }

    func communicationIntelligence(for email: EmailMessage) -> CommunicationIntelligence {
        CommunicationIntelligenceEngine().analyze(
            email: email,
            classification: smartMailClassification(for: email),
            relationship: relationshipIntelligence(for: email),
            trust: trustAssessment(for: email)
        )
    }

    func categoryGovernance(for category: SmartMailCategory) -> CategoryGovernance {
        nexoraIntelligenceEngine.governance(for: category)
    }

    var inboxHealthScore: Int {
        guard !emails.isEmpty else { return 100 }
        let unreadRatio = Double(emails.filter(\.isUnread).count) / Double(emails.count)
        let actionCount = workQueueSignalCounts[.needsReply, default: 0] + workQueueSignalCounts[.needsApproval, default: 0]
        let actionRatio = Double(actionCount) / Double(emails.count)
        let staleRatio = Double(followUpCandidates.count) / Double(emails.count)
        return max(0, min(100, Int((100 - unreadRatio * 35 - actionRatio * 20 - staleRatio * 20).rounded())))
    }

    func smartSearchMatches(_ email: EmailMessage, query: String) -> Bool {
        smartSearchRouter.matches(email, query: query, categoryEngine: mailCategoryEngine, ruleEngine: senderRuleEngine)
    }

    func snooze(_ email: EmailMessage, until date: Date) {
        snoozeScheduler.snooze(email: email, until: date)
        Task { await move(email, to: .snoozed) }
        v2ProductivityRefreshTick += 1
    }

    func blockSender(_ email: EmailMessage) {
        unsubscribeDetector.blockSender(email)
        Task { await moveToJunk(email) }
        v2ProductivityRefreshTick += 1
    }

    /// Applies the local sender block and reports whether the required
    /// canonical Junk move also completed. Detail UI must not claim both
    /// effects when only the local block succeeded.
    @discardableResult
    func blockSenderAndMoveToJunk(_ email: EmailMessage) async -> Bool {
        unsubscribeDetector.blockSender(email)
        v2ProductivityRefreshTick += 1
        return await moveToJunk(email)
    }

    func unsubscribeLocally(_ email: EmailMessage) {
        Task { await move(email, to: .done) }
        errorMessage = "Unsubscribe noted locally. Open the sender unsubscribe link to complete provider-side removal."
        v2ProductivityRefreshTick += 1
    }

    func senderProfile(for email: EmailMessage) -> SenderProfile {
        senderProfileStore.profile(for: email, in: emails)
    }

    // MARK: AI

    @discardableResult
    func triage(_ email: EmailMessage, force: Bool = false) async -> MailTriage? {
        if !force, let cached = triageCache[email.emailId] { return cached }
        guard !triagingIDs.contains(email.emailId) else {
            return triageCache[email.emailId] ?? Self.partialTriageFallback(
                for: email,
                reason: "Apple Intelligence is already reading this message; used local fallback summary"
            )
        }
        triagingIDs.insert(email.emailId)
        defer { triagingIDs.remove(email.emailId) }
        do {
            let result = try await router.triage(
                subject: email.displaySubject, from: email.fromName, body: email.plainBody)
            let safeResult = Self.sanitizedTriage(result)
            triageCache[email.emailId] = safeResult
            invalidateSmartMailCategoryCache()
            return safeResult
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            if Self.isContextLimitError(error) {
                let fallback = Self.partialTriageFallback(
                    for: email,
                    reason: "Local context limit; used recent-message subset"
                )
                triageCache[email.emailId] = fallback
                invalidateSmartMailCategoryCache()
                errorMessage = nil
                return fallback
            }
            let fallback = Self.partialTriageFallback(
                for: email,
                reason: "Apple Intelligence could not generate structured output; used local fallback summary"
            )
            triageCache[email.emailId] = fallback
            invalidateSmartMailCategoryCache()
            errorMessage = nil
            return fallback
        }
    }

    @discardableResult
    func triageLocal(_ email: EmailMessage, force: Bool = false) async -> MailTriage? {
        if !force, let cached = triageCache[email.emailId] { return cached }
        guard aiConsent.aiEnabled, aiConsent.appleLocalEnabled, aiConsent.singleMailRead else {
            errorMessage = "Enable AI Mail Summaries, Apple local AI, and single-message reading to generate this briefing."
            return nil
        }
        guard !triagingIDs.contains(email.emailId) else {
            return triageCache[email.emailId] ?? Self.partialTriageFallback(
                for: email,
                reason: "Apple Intelligence is already reading this message; used local fallback summary"
            )
        }
        triagingIDs.insert(email.emailId)
        defer { triagingIDs.remove(email.emailId) }
        let subject = email.displaySubject
        let from = email.fromName
        let body = email.plainBody
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.triageLocal(subject: subject, from: from, body: body)
            }
            let safeResult = Self.sanitizedTriage(result)
            triageCache[email.emailId] = safeResult
            invalidateSmartMailCategoryCache()
            errorMessage = nil
            return safeResult
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            let fallback = Self.partialTriageFallback(
                for: email,
                reason: "Apple Intelligence local briefing fallback summary"
            )
            triageCache[email.emailId] = fallback
            invalidateSmartMailCategoryCache()
            errorMessage = nil
            return fallback
        }
    }

    func triageLocalStrict(_ email: EmailMessage, force: Bool = false) async -> Result<MailTriage, AppleLocalActionFailure> {
        if !force, let cached = triageCache[email.emailId] { return .success(cached) }
        if let availability = appleIntelligenceAvailabilityMessage {
            return .failure(.unavailable(availability))
        }
        guard !triagingIDs.contains(email.emailId) else {
            return .failure(.failed("Apple Intelligence is already reading this message."))
        }
        triagingIDs.insert(email.emailId)
        defer { triagingIDs.remove(email.emailId) }
        let subject = email.displaySubject
        let from = email.fromName
        let body = email.plainBody
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.triageLocal(subject: subject, from: from, body: body)
            }
            let safeResult = Self.sanitizedTriage(result)
            guard !safeResult.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .failure(.failed("Apple Intelligence returned an empty summary. Try again."))
            }
            triageCache[email.emailId] = safeResult
            invalidateSmartMailCategoryCache()
            errorMessage = nil
            return .success(safeResult)
        } catch {
            if error.isCloudMailCancellation { return .failure(.cancelled) }
            if error is LocalAIActionTimeout { return .failure(.timeout) }
            return .failure(.failed(Self.productSafeErrorMessage(error, context: .ai)))
        }
    }

    func draftReply(for email: EmailMessage, guidance: String?) async -> String? {
        do {
            let result = try await router.draftReply(
                subject: email.displaySubject, from: email.fromName,
                body: email.plainBody, guidance: guidance)
            lastTextAIExecution = result.metadata
            return ProductSafeText.sanitize(result.text, context: .compose)
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            if Self.isContextLimitError(error) {
                errorMessage = nil
                return Self.partialDraftFallback(for: email, guidance: guidance)
            }
            errorMessage = Self.productSafeErrorMessage(error, context: .ai)
            return nil
        }
    }

    func draftReplyLocal(for email: EmailMessage, guidance: String?) async -> String? {
        guard aiConsent.aiEnabled, aiConsent.appleLocalEnabled, aiConsent.singleMailRead else {
            errorMessage = "Enable AI Mail Summaries, Apple local AI, and single-message reading to draft with Apple Intelligence."
            return nil
        }
        let subject = email.displaySubject
        let from = email.fromName
        let body = email.plainBody
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.draftReplyLocal(
                    subject: subject,
                    from: from,
                    body: body,
                    guidance: guidance
                )
            }
            lastTextAIExecution = result.metadata
            errorMessage = nil
            return ProductSafeText.sanitize(result.text, context: .compose)
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            if Self.isContextLimitError(error) {
                errorMessage = nil
                return Self.partialDraftFallback(for: email, guidance: guidance)
            }
            errorMessage = nil
            return Self.partialDraftFallback(for: email, guidance: guidance)
        }
    }

    func draftReplyLocalStrict(for email: EmailMessage, guidance: String?) async -> Result<String, AppleLocalActionFailure> {
        if let availability = appleIntelligenceAvailabilityMessage {
            return .failure(.unavailable(availability))
        }
        let subject = email.displaySubject
        let from = email.fromName
        let body = email.plainBody
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.draftReplyLocal(
                    subject: subject,
                    from: from,
                    body: body,
                    guidance: guidance
                )
            }
            lastTextAIExecution = result.metadata
            errorMessage = nil
            return .success(ProductSafeText.sanitize(result.text, context: .compose))
        } catch {
            if error.isCloudMailCancellation { return .failure(.cancelled) }
            if error is LocalAIActionTimeout { return .failure(.timeout) }
            return .failure(.failed(Self.productSafeErrorMessage(error, context: .compose)))
        }
    }

    func aiComplete(instructions: String, prompt: String) async -> AITextResult? {
        do {
            let result = try await router.complete(instructions: instructions, prompt: prompt)
            lastTextAIExecution = result.metadata
            return result
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            if Self.isContextLimitError(error) {
                errorMessage = nil
                return AITextResult(
                    text: Self.partialCompletionFallback(prompt: prompt),
                    metadata: AIExecutionMetadata(
                        requestedProvider: preferredProvider,
                        executedProvider: .apple,
                        provider: AIProviderKind.apple.title,
                        model: AIProviderKind.apple.modelName,
                        localOrCloud: AIProviderKind.apple.locality,
                        generatedAt: Date(),
                        fallbackReason: "Local context limit; generated partial summary from recent content"
                    )
                )
            }
            errorMessage = Self.productSafeErrorMessage(error, context: .compose)
            return nil
        }
    }

    func aiCompleteLocal(instructions: String, prompt: String) async -> AITextResult? {
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.completeLocal(instructions: instructions, prompt: prompt)
            }
            lastTextAIExecution = result.metadata
            return result
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            errorMessage = nil
            let result = AITextResult(
                text: Self.partialCompletionFallback(prompt: prompt, instructions: instructions),
                metadata: AIExecutionMetadata(
                    requestedProvider: .apple,
                    executedProvider: .apple,
                    provider: AIProviderKind.apple.title,
                    model: AIProviderKind.apple.modelName,
                    localOrCloud: AIProviderKind.apple.locality,
                    generatedAt: Date(),
                    fallbackReason: error is LocalAIActionTimeout
                        ? "Apple Intelligence timed out; used local fallback result"
                        : "Apple Intelligence unavailable; used local fallback result"
                )
            )
            lastTextAIExecution = result.metadata
            return result
        }
    }

    func aiCompleteLocalStrict(instructions: String, prompt: String) async -> Result<AITextResult, AppleLocalActionFailure> {
        if let availability = appleIntelligenceAvailabilityMessage {
            return .failure(.unavailable(availability))
        }
        let router = self.router
        do {
            let result = try await Self.withLocalAITimeout {
                try await router.completeLocal(instructions: instructions, prompt: prompt)
            }
            lastTextAIExecution = result.metadata
            errorMessage = nil
            return .success(result)
        } catch {
            if error.isCloudMailCancellation { return .failure(.cancelled) }
            if error is LocalAIActionTimeout { return .failure(.timeout) }
            return .failure(.failed(Self.productSafeErrorMessage(error, context: .ai)))
        }
    }

    func runLocalSafeProviderAction(_ action: AIWorkspaceSyntheticAction) async -> AIWorkspaceActionResult {
        let requestID = UUID().uuidString
        let started = Date()
        let prompt = Self.localSyntheticPrompt(for: action)
        let result = await aiCompleteLocal(instructions: prompt.instructions, prompt: prompt.body)
        let passed = result != nil
        let latency = Int(Date().timeIntervalSince(started) * 1000)
        return AIWorkspaceActionResult(
            providerReachable: passed,
            modelReachable: passed,
            sanitizedOutputPreview: result?.text,
            latencyMs: latency,
            requestId: requestID,
            auditId: "local_apple_safe_action",
            status: passed ? "PASS" : "FAIL",
            reason: passed ? nil : (errorMessage ?? "Apple Intelligence local safe action failed."),
            providerId: "apple_intelligence",
            methodId: "local_foundation_models",
            workspaceAction: action.rawValue,
            userInitiated: true,
            mailboxDataSent: false,
            customerDataSent: false,
            contactsSent: false,
            calendarDataSent: false,
            attachmentsSent: false,
            crossAccountAccess: false,
            runtimeAuthSource: "on_device_local_ai",
            billingOwner: "device_owner",
            providerOwnership: "local_device",
            sharedPlatformApiKey: false,
            error: nil
        )
    }

    func aiRuntimeSyntheticPreflight(providerID: String,
                                     methodID: String,
                                     modelAlias: String,
                                     promptClass: String = "ping") async -> AIRuntimePreflightResult? {
        do {
            return try await backend.aiRuntimePreflight(
                providerID: providerID,
                methodID: methodID,
                modelAlias: modelAlias,
                syntheticPromptClass: promptClass
            )
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            errorMessage = Self.productSafeErrorMessage(error, context: .ai)
            return nil
        }
    }

    func aiWorkspaceSyntheticAction(_ action: AIWorkspaceSyntheticAction, providerID: AIProviderID = .gemini) async -> AIWorkspaceActionResult? {
        if providerID == .chatgpt {
            guard aiConsent.aiEnabled else {
                errorMessage = "Enable AI summaries first."
                return nil
            }
            return await chatGPTLocalBrokerSafeAction(action)
        }
        guard aiConsent.aiEnabled, aiConsent.cloudAIEnabled else {
            errorMessage = "Enable AI summaries and cloud processing first."
            return nil
        }
        if providerID == .gemini, geminiOAuthStatus?.authorized != true {
            errorMessage = "Gemini is blocked by Google OAuth Error 403 until the account is approved for testing or the app completes Google verification."
            return nil
        }
        do {
            return try await backend.aiWorkspaceAction(action, providerID: providerID)
        } catch {
            guard !error.isCloudMailCancellation else { return nil }
            errorMessage = Self.productSafeErrorMessage(error, context: .ai)
            return nil
        }
    }

    func runGeminiSafeProviderTest() async -> AIWorkspaceActionResult? {
        await runSafeProviderAction(providerID: .gemini, action: .summarize)
    }

    func runSafeProviderAction(providerID: AIProviderID, action: AIWorkspaceSyntheticAction) async -> AIWorkspaceActionResult? {
        if providerID == .chatgpt {
            aiProviderSmokeResults[providerID] = AIProviderSmokeResult(
                status: "RUNNING",
                detail: "ChatGPT Owner Mac Local Broker safe synthetic \(action.rawValue) action is running.",
                at: Date()
            )
            let result = await chatGPTLocalBrokerSafeAction(action)
            let passed = result?.providerReachable == true
                && result?.modelReachable == true
                && result?.mailboxDataSent == false
                && result?.customerDataSent == false
            aiProviderUsability[providerID] = passed
            aiProviderSmokeResults[providerID] = AIProviderSmokeResult(
                status: passed ? "PASS" : "FAIL",
                detail: passed ? "ChatGPT Owner Mac Local Broker safe synthetic \(action.rawValue) action passed." : (result?.reason ?? "Owner Mac Local Broker safe action did not pass."),
                at: Date()
            )
            return result
        }
        guard providerID == .gemini else {
            aiProviderSmokeResults[providerID] = AIProviderSmokeResult(
                status: "BLOCKED",
                detail: "Provider OAuth/runtime metadata is unavailable.",
                at: Date()
            )
            return nil
        }
        let result = await aiWorkspaceSyntheticAction(action, providerID: providerID)
        let passed = result?.providerReachable == true
            && result?.modelReachable == true
            && result?.mailboxDataSent == false
            && result?.customerDataSent == false
        aiProviderUsability[providerID] = passed
        aiProviderSmokeResults[providerID] = AIProviderSmokeResult(
            status: passed ? "PASS" : "FAIL",
            detail: passed ? "Safe synthetic \(action.rawValue) action passed." : (result?.reason ?? "Safe synthetic action did not pass."),
            at: Date()
        )
        return result
    }

    private struct OwnerMacPairStartResponse: Decodable {
        let ok: Bool
        let pairing_state: String?
        let pairing_code: String?
        let expires_at: Int?
    }

    private struct OwnerMacPairConfirmResponse: Decodable {
        let ok: Bool
        let pairing_state: String?
        let pairing_id: String?
        let pairing_secret: String?
        let local_only: Bool?
    }

    private struct OwnerMacSmokeResponse: Decodable {
        let ok: Bool
        let provider_id: String?
        let adapterID: String?
        let runtime_mode: String?
        let redacted_result: String?
        let secret_exposure: Bool?
        let reason: String?
        let last_codex_error_redacted: String?

        enum CodingKeys: String, CodingKey {
            case ok
            case provider_id
            case adapterID = "adapter_id"
            case runtime_mode
            case redacted_result
            case secret_exposure
            case reason
            case last_codex_error_redacted
        }
    }

    private struct OwnerMacSmokeRequest: Encodable {
        let provider_id: String
        let action: String
        let synthetic_prompt: String
        let request_id: String
    }

    private struct OwnerMacCodexHealthRequest: Encodable {
        let provider_id: String
        let action: String
        let request_id: String
    }

    private struct OwnerMacCodexHealthResponse: Decodable {
        let ok: Bool
        let provider_id: String?
        let adapterID: String?
        let codex_auth_status: String?
        let codex_authenticated: Bool?
        let codex_exec_ready: Bool?
        let status_reason: String?
        let last_codex_error_redacted: String?
        let runtime_mode: String?
        let secret_exposure: Bool?

        enum CodingKeys: String, CodingKey {
            case ok
            case provider_id
            case adapterID = "adapter_id"
            case codex_auth_status
            case codex_authenticated
            case codex_exec_ready
            case status_reason
            case last_codex_error_redacted
            case runtime_mode
            case secret_exposure
        }
    }

    func pairOwnerMacLocalBroker() async -> Bool {
        do {
            let start: OwnerMacPairStartResponse = try await ownerMacBrokerRequest(path: "/pair/start", body: EmptyBody())
            guard start.ok, let pairingCode = start.pairing_code else {
                errorMessage = "Pair Owner Mac failed: broker did not return a pairing code."
                return false
            }
            let confirm: OwnerMacPairConfirmResponse = try await ownerMacBrokerRequest(
                path: "/pair/confirm",
                body: PairConfirmBody(pairing_code: pairingCode, device_label: "NEXORA iPhone")
            )
            guard confirm.ok, let pairID = confirm.pairing_id, let pairSecret = confirm.pairing_secret else {
                errorMessage = "Pair Owner Mac failed: broker pairing was not confirmed."
                return false
            }
            Keychain.set(pairID, for: Self.ownerMacBrokerPairIDKey)
            Keychain.set(pairSecret, for: Self.ownerMacBrokerPairSecretKey)
            errorMessage = nil
            aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
                status: "PAIRED",
                detail: "Owner Mac Local Broker paired with signed transport reference.",
                at: Date()
            )
            return true
        } catch {
            errorMessage = "Pair Owner Mac failed. Confirm the Owner Mac broker is online on the local network."
            return false
        }
    }

    private struct EmptyBody: Encodable {}
    private struct PairConfirmBody: Encodable {
        let pairing_code: String
        let device_label: String
    }

    func checkChatGPTCodexLogin() async -> Bool {
        aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
            status: "RUNNING",
            detail: "Checking Codex login and broker execution context on the Owner Mac.",
            at: Date()
        )
        if Keychain.get(Self.ownerMacBrokerPairIDKey) == nil || Keychain.get(Self.ownerMacBrokerPairSecretKey) == nil {
            guard await pairOwnerMacLocalBroker() else { return false }
        }
        guard let pairID = Keychain.get(Self.ownerMacBrokerPairIDKey),
              let pairSecret = Keychain.get(Self.ownerMacBrokerPairSecretKey) else {
            errorMessage = "Requires paired Owner Mac before Codex login can be checked."
            return false
        }
        do {
            let requestID = UUID().uuidString
            let health: OwnerMacCodexHealthResponse = try await ownerMacBrokerSignedRequest(
                path: "/auth/check",
                body: OwnerMacCodexHealthRequest(
                    provider_id: "chatgpt",
                    action: "codex_health_check",
                    request_id: requestID
                ),
                pairID: pairID,
                pairSecret: pairSecret
            )
            let ready = health.ok
                && health.provider_id == "chatgpt"
                && health.adapterID == "chatgpt_codex_cli"
                && health.codex_auth_status == "pass"
                && health.codex_authenticated == true
                && health.codex_exec_ready == true
                && health.runtime_mode == "owner_mac_local_broker"
                && health.secret_exposure == false
            aiProviderUsability[.chatgpt] = false
            aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
                status: ready ? "CODEX_READY" : "FAIL",
                detail: ready
                    ? "Codex authenticated and executable in the Owner Mac broker context. Run Safe Test to verify ChatGPT Local Broker."
                    : (health.last_codex_error_redacted?.isEmpty == false ? health.last_codex_error_redacted! : (health.status_reason ?? "Codex broker health check failed.")),
                at: Date()
            )
            errorMessage = ready ? nil : (health.status_reason ?? "Codex broker health check failed.")
            return ready
        } catch {
            Keychain.delete(Self.ownerMacBrokerPairIDKey)
            Keychain.delete(Self.ownerMacBrokerPairSecretKey)
            errorMessage = "Mac Broker Offline or pairing expired. Pair Owner Mac and try again."
            aiProviderUsability[.chatgpt] = false
            aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
                status: "FAIL",
                detail: "Mac Broker Offline",
                at: Date()
            )
            return false
        }
    }

    private func chatGPTLocalBrokerSafeAction(_ action: AIWorkspaceSyntheticAction) async -> AIWorkspaceActionResult? {
        let owner_mac_local_broker_signed_transport_pass = "owner_mac_local_broker_signed_transport_pass"
        guard action == .summarize else {
            errorMessage = "ChatGPT Local Broker currently allows only the safe synthetic summarize action."
            return nil
        }
        aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
            status: "RUNNING",
            detail: "ChatGPT Owner Mac Local Broker signed smoke is running.",
            at: Date()
        )
        if Keychain.get(Self.ownerMacBrokerPairIDKey) == nil || Keychain.get(Self.ownerMacBrokerPairSecretKey) == nil {
            guard await pairOwnerMacLocalBroker() else { return nil }
        }
        guard let pairID = Keychain.get(Self.ownerMacBrokerPairIDKey),
              let pairSecret = Keychain.get(Self.ownerMacBrokerPairSecretKey) else {
            errorMessage = "Requires paired Owner Mac before ChatGPT Local Broker can run."
            return nil
        }
        do {
            let requestID = UUID().uuidString
            let body = OwnerMacSmokeRequest(
                provider_id: "chatgpt",
                action: "summarize_synthetic_email",
                synthetic_prompt: "Summarize this synthetic email: Project Alpha meeting moved from 2 PM to 4 PM. Please reply with a one sentence summary.",
                request_id: requestID
            )
            let smoke: OwnerMacSmokeResponse = try await ownerMacBrokerSignedRequest(
                path: "/ai/smoke",
                body: body,
                pairID: pairID,
                pairSecret: pairSecret
            )
            let passed = smoke.ok
                && smoke.provider_id == "chatgpt"
                && smoke.adapterID == "chatgpt_codex_cli"
                && smoke.runtime_mode == "owner_mac_local_broker"
                && smoke.secret_exposure == false
            aiProviderUsability[.chatgpt] = passed
            aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
                status: passed ? "PASS" : "FAIL",
                detail: passed
                    ? "ChatGPT Owner Mac Local Broker app-compatible signed smoke passed."
                    : (smoke.last_codex_error_redacted?.isEmpty == false ? smoke.last_codex_error_redacted! : (smoke.reason ?? "Owner Mac Local Broker smoke failed.")),
                at: Date()
            )
            return AIWorkspaceActionResult(
                providerReachable: passed,
                modelReachable: passed,
                sanitizedOutputPreview: smoke.redacted_result,
                latencyMs: nil,
                requestId: requestID,
                auditId: owner_mac_local_broker_signed_transport_pass,
                status: passed ? "PASS" : "FAIL",
                reason: passed ? nil : (smoke.last_codex_error_redacted?.isEmpty == false ? smoke.last_codex_error_redacted! : (smoke.reason ?? "Owner Mac Local Broker smoke failed.")),
                providerId: "chatgpt",
                methodId: smoke.adapterID,
                workspaceAction: action.rawValue,
                userInitiated: true,
                mailboxDataSent: false,
                customerDataSent: false,
                contactsSent: false,
                calendarDataSent: false,
                attachmentsSent: false,
                crossAccountAccess: false,
                runtimeAuthSource: "owner_mac_local_broker_signed_transport",
                billingOwner: "owner_chatgpt_business_workspace",
                providerOwnership: "owner_mac_codex_cli",
                sharedPlatformApiKey: false,
                error: nil
            )
        } catch {
            Keychain.delete(Self.ownerMacBrokerPairIDKey)
            Keychain.delete(Self.ownerMacBrokerPairSecretKey)
            errorMessage = "Mac Broker Offline or pairing expired. Pair Owner Mac and try again."
            aiProviderUsability[.chatgpt] = false
            aiProviderSmokeResults[.chatgpt] = AIProviderSmokeResult(
                status: "FAIL",
                detail: "Mac Broker Offline",
                at: Date()
            )
            return AIWorkspaceActionResult(
                providerReachable: false,
                modelReachable: false,
                sanitizedOutputPreview: nil,
                latencyMs: nil,
                requestId: UUID().uuidString,
                auditId: "owner_mac_local_broker_signed_transport_failed",
                status: "FAIL",
                reason: "Mac Broker Offline",
                providerId: "chatgpt",
                methodId: "chatgpt_codex_cli",
                workspaceAction: action.rawValue,
                userInitiated: true,
                mailboxDataSent: false,
                customerDataSent: false,
                contactsSent: false,
                calendarDataSent: false,
                attachmentsSent: false,
                crossAccountAccess: false,
                runtimeAuthSource: "owner_mac_local_broker_signed_transport",
                billingOwner: "owner_chatgpt_business_workspace",
                providerOwnership: "owner_mac_codex_cli",
                sharedPlatformApiKey: false,
                error: nil
            )
        }
    }

    private func ownerMacBrokerRequest<Response: Decodable, Body: Encodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: try ownerMacBrokerEndpoint(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        request.httpBody = try encoder.encode(body)
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func ownerMacBrokerSignedRequest<Response: Decodable, Body: Encodable>(
        path: String,
        body: Body,
        pairID: String,
        pairSecret: String
    ) async throws -> Response {
        var request = URLRequest(url: try ownerMacBrokerEndpoint(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(body)
        request.httpBody = data
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let nonce = UUID().uuidString
        request.setValue(pairID, forHTTPHeaderField: "x-cloudmail-pairing-id")
        request.setValue(timestamp, forHTTPHeaderField: "x-cloudmail-timestamp")
        request.setValue(nonce, forHTTPHeaderField: "x-cloudmail-nonce")
        request.setValue(hmacSHA256Hex(data: data, secret: pairSecret), forHTTPHeaderField: "x-cloudmail-signature")
        let (responseData, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(Response.self, from: responseData)
    }

    private func ownerMacBrokerEndpoint(_ path: String) throws -> URL {
        let trimmedBase = ownerMacBrokerURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmedBase + path) else {
            throw URLError(.badURL)
        }
        return url
    }

    private func hmacSHA256Hex(data: Data, secret: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let signature = HMAC<SHA256>.authenticationCode(for: data, using: key)
        return signature.map { String(format: "%02x", $0) }.joined()
    }

    private static func localSyntheticPrompt(for action: AIWorkspaceSyntheticAction) -> (instructions: String, body: String) {
        switch action {
        case .summarize:
            return (
                "Summarize the synthetic NEXORA message in one concise sentence. Return only the summary.",
                "Synthetic email: Project Alpha meeting moved from 2 PM to 4 PM. No customer mailbox data is included."
            )
        case .draft:
            return (
                "Draft a concise synthetic confirmation reply. Return only the reply body.",
                "Synthetic message: Thank you for the NEXORA setup update. Please confirm receipt."
            )
        case .translate:
            return (
                "Translate the synthetic NEXORA sentence to Chinese. Return only the translation.",
                "The mock NEXORA translate action completed successfully. No mailbox data is included."
            )
        case .replySuggestion:
            return (
                "Suggest a short synthetic reply. Return only the reply body.",
                "Synthetic message: Thank you for the setup update."
            )
        case .threadAnalysis:
            return (
                "Analyze this synthetic NEXORA thread in one sentence. Return only the analysis.",
                "Synthetic thread: one setup update, one acknowledgement, no action required."
            )
        }
    }

    func aiWorkspaceWorkflow(_ workflow: AIWorkspaceRealWorkflow) async -> AIWorkspaceWorkflowResult {
        guard aiConsent.aiEnabled else {
            return AIWorkspaceWorkflowResult(
                workflow: workflow,
                text: "AI is disabled. Enable AI Mail Summaries to use mailbox workflows.",
                messageCount: 0,
                sourceAccount: workspaceSourceAccountLabel(),
                runtimeStatus: nil,
                runtimeBoundary: "No mailbox data was sent."
            )
        }

        let source = workspaceSourceAccountLabel()
        let scoped = workspaceScopedEmails()
        let runtime = await workspaceRuntimeBoundary(for: workflow)
        guard !scoped.isEmpty else {
            return AIWorkspaceWorkflowResult(
                workflow: workflow,
                text: "No loaded messages are available for \(workspaceMailboxLabel()). Refresh Inbox or choose a mailbox with messages.",
                messageCount: 0,
                sourceAccount: source,
                runtimeStatus: runtime?.status,
                runtimeBoundary: workspaceRuntimeBoundaryLine(runtime)
            )
        }

        let text: String
        switch workflow {
        case .inboxSummary:
            text = await workspaceInboxSummary(from: scoped)
        case .suggestedReply:
            text = await workspaceSuggestedReply(from: scoped)
        case .threadDigest:
            text = await workspaceThreadDigest(from: scoped)
        case .draftGeneration:
            text = await workspaceDraftGeneration(from: scoped)
        case .multiEmailAnalysis:
            text = await workspaceMultiEmailAnalysis(from: scoped)
        }

        return AIWorkspaceWorkflowResult(
            workflow: workflow,
            text: text,
            messageCount: scoped.count,
            sourceAccount: source,
            runtimeStatus: runtime?.status,
            runtimeBoundary: workspaceRuntimeBoundaryLine(runtime)
        )
    }

    func analyzeSecurity(_ email: EmailMessage) async {
        guard securityAnalyses[email.emailId] == nil else { return }
        guard !securityAnalysisInFlight.contains(email.emailId) else { return }
        securityAnalysisInFlight.insert(email.emailId)
        defer { securityAnalysisInFlight.remove(email.emailId) }
        do {
            securityAnalyses[email.emailId] = try await backend.analyzeSecurity(
                sender: email.fromAddress,
                subject: email.displaySubject,
                body: email.lightweightBodySnippet(maxCharacters: 2_000),
                html: email.content
            )
        } catch {
            guard !error.isCloudMailCancellation else { return }
            errorMessage = Self.productSafeErrorMessage(error, context: .ai)
        }
    }

    private func workspaceRuntimeBoundary(for workflow: AIWorkspaceRealWorkflow) async -> AIWorkspaceActionResult? {
        guard aiConsent.cloudAIEnabled, geminiOAuthStatus?.authorized == true else { return nil }
        do {
            return try await backend.aiWorkspaceAction(workflow.runtimeAction)
        } catch {
            return nil
        }
    }

    private func workspaceRuntimeBoundaryLine(_ runtime: AIWorkspaceActionResult?) -> String {
        guard let runtime else {
            return "Cloud runtime not used; no mailbox data was sent."
        }
        let crossAccount = runtime.crossAccountAccess == true ? "true" : "false"
        let billingOwner = runtime.billingOwner ?? "user"
        let providerOwnership = runtime.providerOwnership ?? "user_owned"
        let sharedKey = runtime.sharedPlatformApiKey == true ? "true" : "false"
        return "Runtime \(runtime.status); mailbox_data_sent=false; cross_account_access=\(crossAccount); billing_owner=\(billingOwner); provider_ownership=\(providerOwnership); shared_platform_api_key=\(sharedKey)."
    }

    private func workspaceScopedEmails(limit: Int = 30) -> [EmailMessage] {
        let scoped = emails.filter { email in
            let providerOK = selectedAccountId != nil || selectedProvider == nil || email.sourceProvider == selectedProvider
            let accountOK = selectedAccountId == nil || email.accountId == selectedAccountId
            guard providerOK && accountOK else { return false }
            let folder = effectiveFolder(for: email)
            switch selectedLocalMailbox {
            case .inbox:
                return folder == .inbox
            case .needsReply, .todo:
                return workspaceLooksActionable(email)
            case .followUp:
                return workspaceContainsAny(email, terms: ["follow up", "follow-up", "circle back", "checking in"])
            case .important:
                return workspaceContainsAny(email, terms: ["urgent", "important", "asap", "deadline"])
            case .starred:
                return email.isStarred && folder != .trash
            case .junk:
                return folder == .junk
            case .trash:
                return folder == .trash
            case .done:
                return folder == .done
            case .drafts, .sent, .outbox, .scheduled, .snoozed:
                return false
            }
        }
        return scoped
            .sorted { lhs, rhs in
                let left = lhs.date ?? Date(timeIntervalSince1970: TimeInterval(lhs.emailId))
                let right = rhs.date ?? Date(timeIntervalSince1970: TimeInterval(rhs.emailId))
                return left > right
            }
            .prefix(limit)
            .map { $0 }
    }

    private func workspaceInboxSummary(from emails: [EmailMessage]) async -> String {
        var lines = [
            "\(workspaceMailboxLabel()) has \(emails.count) loaded messages.",
            "\(emails.filter { $0.isUnread }.count) unread; \(emails.filter { workspaceLooksActionable($0) }.count) likely need attention."
        ]
        for email in emails.prefix(2) {
            let triage = await triageLocal(email) ?? workspaceHeuristicTriage(email)
            lines.append("- \(email.fromName): \(email.displaySubject) - \(ProductSafeText.sanitize(triage.summary, context: .preview))")
        }
        return lines.joined(separator: "\n")
    }

    private func workspaceSuggestedReply(from emails: [EmailMessage]) async -> String {
        let target = emails.first(where: { workspaceLooksActionable($0) }) ?? emails.first!
        if let draft = await draftReplyLocal(for: target, guidance: "Suggest a concise reply for this mailbox workflow.") {
            return """
            Suggested reply for \(target.fromName), "\(target.displaySubject)":

            \(ProductSafeText.sanitize(draft, context: .compose))
            """
        }
        return """
        Suggested reply for \(target.fromName), "\(target.displaySubject)":

        Thanks for the note. I will review this and get back to you shortly.
        """
    }

    private func workspaceThreadDigest(from emails: [EmailMessage]) async -> String {
        let grouped = Dictionary(grouping: emails) { email in
            email.sourceThreadID.isEmpty ? "email:\(email.emailId)" : email.sourceThreadID
        }
        let thread = grouped.values
            .sorted { lhs, rhs in
                if lhs.count != rhs.count { return lhs.count > rhs.count }
                return (lhs.first?.emailId ?? 0) > (rhs.first?.emailId ?? 0)
            }
            .first ?? []
        guard let first = thread.sorted(by: { $0.emailId < $1.emailId }).first else {
            return "No thread messages are available."
        }
        var lines = ["Thread digest: \(first.displaySubject)", "\(thread.count) loaded messages in this thread."]
        for email in thread.sorted(by: { $0.emailId < $1.emailId }).prefix(2) {
            let triage = await triageLocal(email) ?? workspaceHeuristicTriage(email)
            lines.append("- \(email.fromName): \(ProductSafeText.sanitize(triage.summary, context: .preview))")
        }
        return lines.joined(separator: "\n")
    }

    private func workspaceDraftGeneration(from emails: [EmailMessage]) async -> String {
        let target = emails.first(where: { workspaceLooksActionable($0) }) ?? emails.first!
        if let draft = await draftReplyLocal(for: target, guidance: "Draft a production-ready response. Keep it editable and do not invent commitments.") {
            return """
            Draft generated from "\(target.displaySubject)":

            \(ProductSafeText.sanitize(draft, context: .compose))
            """
        }
        return """
        Draft generated from "\(target.displaySubject)":

        Hi \(target.fromName),

        Thanks for reaching out. I have this on my radar and will follow up with a clear answer soon.
        """
    }

    private func workspaceMultiEmailAnalysis(from emails: [EmailMessage]) async -> String {
        var categories: [MailCategory: Int] = [:]
        for email in emails.prefix(4) {
            let triage = await triageLocal(email) ?? workspaceHeuristicTriage(email)
            categories[triage.category, default: 0] += 1
        }
        let grouped = Dictionary(grouping: emails.prefix(20), by: { $0.fromName })
        let mapped = grouped.map { ($0.key, $0.value.count) }
        let sorted = mapped.sorted { (lhs: (String, Int), rhs: (String, Int)) -> Bool in
            if lhs.1 == rhs.1 {
                return lhs.0 < rhs.0
            }
            return lhs.1 > rhs.1
        }
        let topSenders = sorted.prefix(3)
            .map { "\($0.0) (\($0.1))" }
            .joined(separator: ", ")
        let categoryLine = categories
            .sorted { lhs, rhs in lhs.value == rhs.value ? lhs.key.rawValue < rhs.key.rawValue : lhs.value > rhs.value }
            .map { "\($0.key.rawValue): \($0.value)" }
            .joined(separator: ", ")
        return """
        Multi-email analysis for \(workspaceMailboxLabel()):
        - Loaded messages reviewed: \(emails.count)
        - Likely attention needed: \(emails.filter { workspaceLooksActionable($0) }.count)
        - Top senders: \(topSenders.isEmpty ? "None" : topSenders)
        - Category mix: \(categoryLine.isEmpty ? "Other: \(emails.count)" : categoryLine)
        """
    }

    private func workspaceHeuristicTriage(_ email: EmailMessage) -> MailTriage {
        let summary = email.preview.isEmpty ? "No readable body preview is available." : email.preview
        let category: MailCategory
        if workspaceContainsAny(email, terms: ["invoice", "payment", "receipt", "bank"]) {
            category = .finance
        } else if workspaceContainsAny(email, terms: ["unsubscribe", "newsletter"]) {
            category = .newsletter
        } else if workspaceContainsAny(email, terms: ["urgent", "asap", "deadline"]) {
            category = .urgent
        } else if workspaceContainsAny(email, terms: ["meeting", "project", "review"]) {
            category = .work
        } else {
            category = .other
        }
        return MailTriage(
            summary: String(summary.prefix(220)),
            category: category,
            actionRequired: workspaceLooksActionable(email),
            suggestedReply: nil,
            execution: nil
        )
    }

    private static func isContextLimitError(_ error: Error) -> Bool {
        if let api = error as? APIError {
            return ProductSafeText.isContextLimitMessage(api.message)
        }
        return ProductSafeText.isContextLimitMessage(error.localizedDescription)
    }

    private static func withLocalAITimeout<T>(
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: localAIActionTimeoutNanoseconds)
                throw LocalAIActionTimeout.exceeded
            }
            guard let value = try await group.next() else {
                group.cancelAll()
                throw LocalAIActionTimeout.exceeded
            }
            group.cancelAll()
            return value
        }
    }

    private static func partialTriageFallback(for email: EmailMessage, reason: String) -> MailTriage {
        let source = email.preview.isEmpty ? email.plainBody : email.preview
        let excerpt = String(source.prefix(420)).trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = excerpt.isEmpty
            ? "Partial summary: this conversation is large, and no readable recent text is available yet."
            : "Partial summary from recent content: \(excerpt)"
        return MailTriage(
            summary: summary,
            category: .other,
            actionRequired: false,
            suggestedReply: nil,
            execution: AIExecutionMetadata(
                requestedProvider: .apple,
                executedProvider: .apple,
                provider: AIProviderKind.apple.title,
                model: AIProviderKind.apple.modelName,
                localOrCloud: AIProviderKind.apple.locality,
                generatedAt: Date(),
                fallbackReason: reason
            )
        )
    }

    private static func partialDraftFallback(for email: EmailMessage, guidance: String?) -> String {
        let note = guidance?.trimmingCharacters(in: .whitespacesAndNewlines)
        return """
        Partial draft fallback:

        Thanks for the detailed thread. I am reviewing the recent messages and will follow up with a clear response shortly.
        \(note?.isEmpty == false ? "\nNote considered: \(note!)" : "")
        """
    }

    private static func partialCompletionFallback(prompt: String) -> String {
        partialCompletionFallback(prompt: prompt, instructions: "")
    }

    private static func partialCompletionFallback(prompt: String, instructions: String) -> String {
        let excerpt = String(prompt.prefix(700)).trimmingCharacters(in: .whitespacesAndNewlines)
        let lowerInstruction = instructions.lowercased()
        if lowerInstruction.contains("translate") {
            if excerpt.isEmpty {
                return "Apple Intelligence translation did not finish yet. There is no readable message text available for a local fallback."
            }
            return """
            Apple Intelligence translation did not finish in time.

            Original text preserved for retry:
            \(excerpt)
            """
        }
        if excerpt.isEmpty {
            return "Partial summary fallback: this conversation is too large for local summarization, and no recent excerpt is available."
        }
        return """
        Partial summary fallback:
        This conversation is too large for the local summarizer, so NEXORA used a recent-content subset instead of stopping.

        Recent content:
        \(excerpt)
        """
    }

    private func workspaceLooksActionable(_ email: EmailMessage) -> Bool {
        triageCache[email.emailId]?.actionRequired == true
            || workspaceContainsAny(email, terms: ["please reply", "can you", "could you", "let me know", "please review", "need you to", "action item"])
    }

    private func workspaceContainsAny(_ email: EmailMessage, terms: [String]) -> Bool {
        let haystack = email.searchableSnippet
        return terms.contains { haystack.contains($0) }
    }

    private func workspaceMailboxLabel() -> String {
        selectedLocalMailbox == .inbox ? "Inbox" : selectedLocalMailbox.title
    }

    private func workspaceSourceAccountLabel() -> String {
        if let selectedAccountId,
           let account = addresses.first(where: { $0.accountId == selectedAccountId }) {
            return account.email
        }
        if let selectedProvider {
            return selectedProvider.title
        }
        return primaryIdentityEmail
    }

    /// Triage everything currently loaded that hasn't been triaged yet.
    func triageVisible(_ sourceEmails: [EmailMessage]? = nil) async {
        let visibleEmails = sourceEmails ?? emails
        guard !visibleEmails.isEmpty else {
            errorMessage = "No visible mail to summarize."
            return
        }
        // Smart Mail supplies immediate deterministic categories. Keep expensive
        // local AI enrichment deliberately small so first render stays responsive.
        let visibleBatch = Array(visibleEmails.prefix(6))
        for email in visibleBatch where triageCache[email.emailId]?.execution == nil {
            triageCache[email.emailId] = Self.partialTriageFallback(
                for: email,
                reason: "Local visible-mail summary used to keep inbox feedback immediate"
            )
            invalidateSmartMailCategoryCache()
        }
        for email in visibleBatch {
            let cachedTriage = triageCache[email.emailId]
            guard cachedTriage == nil || cachedTriage?.execution == nil else { continue }
            _ = await triage(email, force: cachedTriage?.execution == nil)
        }
    }

    func triageCurrentMailbox() async {
        await triageVisible(workspaceScopedEmails(limit: Int.max))
    }

    func setMailbox(accountId: Int?, provider: UnifiedMailProvider?) async {
        if selectedAccountId == accountId && selectedProvider == provider {
            return
        }
        mailboxDefaultApplied = true
        invalidateServerCorrelation()
        selectedAccountId = accountId
        if let accountId,
           let account = addresses.first(where: { $0.accountId == accountId }) {
            selectedProvider = provider ?? account.displayProvider
        } else {
            selectedProvider = provider
        }
        scheduleMailboxSelectionRefresh()
    }

    private func applyDefaultMailboxIfNeeded(from addresses: [MailAddress]) {
        guard !mailboxDefaultApplied, selectedAccountId == nil, selectedProvider == nil else { return }
        // Loop 6A: the signed-in CloudMail account is the default context.
        // Mailbox selection is explicit so a Gmail address never appears to
        // leak into the wrong login just because it exists in this account.
        mailboxDefaultApplied = true
    }

    private func normalizeMailboxSelection(afterLoading addresses: [MailAddress]) {
        if let selectedAccountId,
           !addresses.contains(where: { $0.accountId == selectedAccountId }),
           !unifiedAccounts.contains(where: { $0.readableAccountId == selectedAccountId }) {
            self.selectedAccountId = nil
            selectedProvider = nil
            mailboxDefaultApplied = false
            return
        }
        guard selectedAccountId == nil, let selectedProvider else { return }
        let providerIsOwnedByCurrentUser = addresses.contains { $0.displayProvider == selectedProvider }
        if !providerIsOwnedByCurrentUser {
            self.selectedProvider = nil
            mailboxDefaultApplied = false
        }
    }

    func selectPrimaryCloudMailOrMerged() async {
        if let account = primaryCloudMailAccount {
            await setMailbox(accountId: account.accountId, provider: nil)
        } else {
            await setMailbox(accountId: nil, provider: nil)
        }
    }

    func connectGmail(email: String, appPassword: String) async -> Bool {
        do {
            let result = try await backend.connectGmail(email: email, appPassword: appPassword)
            gmailSyncStatusByAccountId[result.accountId] = "Last sync: \(result.synced ?? 0) new messages"
            await loadV2Configuration()
            await refresh()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func authorizeCloudMailMailbox(email: String, password: String) async -> Bool {
        do {
            _ = try await backend.authorizeMailbox(email: email, password: password)
            await loadV2Configuration()
            await refresh()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func removeMailboxAuthorization(id: Int) async -> Bool {
        do {
            _ = try await backend.removeMailboxAuthorization(id: id)
            await loadV2Configuration()
            await refresh()
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func startGeminiOAuth() async -> URL? {
        do {
            let status = try await backend.startGeminiOAuth()
            geminiOAuthStatus = status
            if let value = status.authorizationUrl { return URL(string: value) }
            return nil
        } catch {
            handle(error)
            return nil
        }
    }

    func startGoogleMailboxOAuth(email: String = "", accountId: Int? = nil) async -> URL? {
        do {
            mailboxOnboardingState = .authorizing
            mailboxOnboardingMessage = "Opening Google sign-in..."
            let status = try await backend.startGoogleMailboxOAuth(email: email, device: Self.oauthDeviceLabel(), accountId: accountId)
            geminiOAuthStatus = status
            if let value = status.authorizationUrl { return URL(string: value) }
            mailboxOnboardingState = .failed
            mailboxOnboardingMessage = "Google sign-in is not available for this build."
            return nil
        } catch {
            mailboxOnboardingState = .failed
            mailboxOnboardingMessage = Self.productSafeErrorMessage(error, context: .general)
            handle(error)
            return nil
        }
    }

    private static func oauthDeviceLabel() -> String {
        #if os(iOS)
        return "\(UIDevice.current.model) \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        #else
        return "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
        #endif
    }

    private static func googleOAuthRestrictionReason(_ raw: String?) -> String {
        let value = (raw ?? "").lowercased()
        if value.contains("verification_required") || value.contains("app_not_verified") {
            return "Verification Required"
        }
        if value.contains("workspace_admin_blocked") || value.contains("admin_policy") || value.contains("org_internal") {
            return "Workspace Admin Blocked"
        }
        if value.contains("scope_not_approved") || value.contains("scope") {
            return "Scope Not Approved"
        }
        if value.contains("user_cancelled") || value.contains("cancel") {
            return "User Cancelled"
        }
        if value.contains("testing_restricted") || value.contains("access_denied") {
            return "Testing Restricted"
        }
        return "Unknown Google OAuth Error"
    }

    func disconnectGeminiOAuth() async {
        do {
            geminiOAuthStatus = try await backend.disconnectGeminiOAuth()
            await refreshProviderReadiness()
        } catch { handle(error) }
    }

    func syncGmail(accountId: Int) async -> Bool {
        do {
            gmailSyncStatusByAccountId[accountId] = "Syncing mailbox..."
            let syncStart = Date()
            syncStartedAt = syncStart
            networkRequestCount += 1
            let result = try await backend.syncGmail(accountId: accountId, limit: 100)
            let fetched = result.fetched ?? 0
            let cached = result.cacheReused ?? 0
            gmailSyncStatusByAccountId[accountId] = "Last sync: \(result.synced) imported · \(fetched) fetched · \(cached) cached"
            await refresh()
            lastSyncDuration = Date().timeIntervalSince(syncStart)
            syncStartedAt = nil
            return true
        } catch {
            syncStartedAt = nil
            gmailSyncStatusByAccountId[accountId] = "Sync needs attention"
            handle(error)
            return false
        }
    }

    private func isOAuthCallback(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        let path = url.path.lowercased()
        return host == "oauth-callback"
            || path.contains("oauth-callback")
            || path.contains("/oauth/gemini/callback")
            || path.contains("/ai/oauth/gemini/callback")
    }

    private func handleOAuthCallbackURL(_ url: URL) async {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        let status = items.first(where: { $0.name == "status" })?.value?.lowercased()
        let error = items.first(where: { $0.name == "error" })?.value
        let cloudmailGovernance = items.first(where: { $0.name == "cloudmailGovernance" })?.value
        let googleOAuthState = items.first(where: { $0.name == "googleOAuthState" })?.value
        let mailboxState = items.first(where: { $0.name == "mailboxState" })?.value
        let accountEmail = items.first(where: { $0.name == "accountEmail" })?.value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if status == "failed" || error?.isEmpty == false {
            mailboxOnboardingState = .failed
            let reason = Self.googleOAuthRestrictionReason(googleOAuthState ?? error)
            let governance = cloudmailGovernance == "auto_approved" ? "Auto Approved" : "Auto Approved"
            let mailbox = mailboxState == "mailbox_ready" ? "Mailbox Ready" : "Not Ready"
            mailboxOnboardingMessage = """
            Google OAuth blocked
            NEXORA Governance: \(governance)
            Google OAuth: Blocked
            Reason: \(reason)
            Mailbox: \(mailbox)
            """
            errorMessage = mailboxOnboardingMessage
            return
        }

        mailboxOnboardingState = .creatingMailbox
        mailboxOnboardingMessage = "Creating Gmail mailbox..."
        phase = .ready
        if currentUser == nil {
            guard await loadUser(silentExpired: true) else {
                mailboxOnboardingState = .failed
                mailboxOnboardingMessage = "Sign in to NEXORA, then connect Gmail again."
                return
            }
        }

        mailboxOnboardingState = .syncingMailbox
        mailboxOnboardingMessage = "Syncing Gmail..."
        await loadV2Configuration()

        let gmailAccount = accountEmail.flatMap { email in
            connectedGmailAccounts.first { $0.email.caseInsensitiveCompare(email) == .orderedSame }
        } ?? primaryGmailAccount
        if let gmailAccount {
            selectedLocalMailbox = .inbox
            mailboxDefaultApplied = true
            selectedAccountId = gmailAccount.accountId
            selectedProvider = gmailAccount.displayProvider
            _ = await syncGmail(accountId: gmailAccount.accountId)
        }

        mailboxOnboardingState = .loadingMessages
        mailboxOnboardingMessage = "Loading messages..."
        if gmailAccount == nil {
            await refresh()
        }

        mailboxOnboardingState = .ready
        mailboxOnboardingMessage = gmailAccount == nil
            ? "Google authorization finished. Gmail may take a moment to appear."
            : "Gmail is connected and ready."
        selectedMainTab = 0
    }

    // MARK: Mail client profile

    func signature(for email: String) -> String {
        if let existing = mailClientProfile.signatures[email.lowercased()]?.body {
            return existing
        }
        let name = currentUser?.displayName ?? email
        return "\n--\n\(name)"
    }

    func updateSignature(for email: String, body: String) {
        mergeLatestCloudProfileIfNewer()
        let key = email.lowercased()
        mailClientProfile.signatures[key] = MailSignature(email: email, body: body, updatedAt: Date())
        persistMailClientProfile(markUpdated: true)
    }

    func setDefaultSendingAddress(_ email: String) {
        mergeLatestCloudProfileIfNewer()
        mailClientProfile.defaultSendingAddress = email
        persistMailClientProfile(markUpdated: true)
    }

    var profileTheme: String {
        profilePreference(Self.themePreferenceKey, defaultValue: "system")
    }

    var profileNotificationsEnabled: Bool {
        profilePreference(Self.notificationsPreferenceKey, defaultValue: "true") != "false"
    }

    func setProfileTheme(_ value: String) {
        setProfilePreference(Self.themePreferenceKey, value: value)
    }

    /// A local directory privacy preference. This deliberately does not claim
    /// to block provider delivery or alter a remote mailbox without authority.
    func isContactHiddenFromDirectory(_ email: String) -> Bool {
        profilePreference("blocked_contact_\(email.lowercased())", defaultValue: "false") == "true"
    }

    func setContactHiddenFromDirectory(_ email: String, hidden: Bool) {
        setProfilePreference("blocked_contact_\(email.lowercased())", value: hidden ? "true" : "false")
    }

    func isContactRemovedLocally(_ email: String) -> Bool {
        profilePreference("removed_contact_\(email.lowercased())", defaultValue: "false") == "true"
    }

    /// Removes only NEXORA's locally observed directory record. It never claims a provider contact deletion.
    func setContactRemovedLocally(_ email: String, removed: Bool) {
        setProfilePreference("removed_contact_\(email.lowercased())", value: removed ? "true" : "false")
        refreshOrganizationGraph()
    }

    func setProfileNotificationsEnabled(_ value: Bool) {
        setProfilePreference(Self.notificationsPreferenceKey, value: value ? "true" : "false")
    }

    func profilePreference(_ key: String, defaultValue: String) -> String {
        if let value = mailClientProfile.uiPreferences[key], !value.isEmpty {
            return value
        }
        if let local = UserDefaults.standard.string(forKey: key), !local.isEmpty {
            return local
        }
        return defaultValue
    }

    func setProfilePreference(_ key: String, value: String) {
        UserDefaults.standard.set(value, forKey: key)
        mergeLatestCloudProfileIfNewer()
        if mailClientProfile.uiPreferences[key] == value { return }
        var profile = mailClientProfile
        profile.uiPreferences[key] = value
        mailClientProfile = profile
        persistMailClientProfile(markUpdated: true)
    }

    var enterpriseContactGraph: [EnterpriseContactGraphNode] {
        EnterpriseContactGraphBuilder.build(
            emails: emails,
            addresses: addresses,
            sendingIdentities: sendingIdentities,
            vip: profileEmailSet(mailClientProfile.vipContactEmails),
            starred: profileEmailSet(mailClientProfile.starredContactEmails),
            favorites: profileEmailSet(mailClientProfile.favoriteContactEmails),
            autocompleteLearning: mailClientProfile.autocompleteLearning ?? [:]
        )
    }

    var enterpriseDomainDirectory: [EnterpriseDomainDirectoryNode] {
        EnterpriseContactGraphBuilder.domains(from: enterpriseContactGraph)
    }

    var profileSyncDeviceLabel: String {
        #if os(iOS)
        return UIDevice.current.name
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    var profileSyncDeviceKind: String {
        #if os(iOS)
        return UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
        return "Mac"
        #endif
    }

    var profileSyncSyncedItems: [String] {
        [
            "Theme",
            "Default From",
            "Signatures",
            "Favorites",
            "VIP Contacts",
            "Starred Contacts",
            "Directory Preferences",
            "Compose Preferences",
            "Autocomplete Preferences",
            "NEXORA Layout Preferences",
            "Enterprise Hub Preferences",
            "Automation Preferences",
            "Search Preferences",
            "Approval Center Preferences",
            "Diagnostics Preferences"
        ]
    }

    var profileSyncDevices: [ProfileSyncDevice] {
        let current = currentProfileSyncDevice()
        var devices = mailClientProfile.profileSyncDevices ?? []
        devices.removeAll { $0.id == current.id }
        return ([current] + devices).sorted { $0.lastSeen > $1.lastSeen }
    }

    var profileSyncRestorePreview: [String] {
        [
            "Theme: \(profileTheme)",
            "Default From: \(defaultSendingIdentity?.email ?? "No sending address")",
            "Signatures: \(mailClientProfile.signatures.count)",
            "Favorites: \(profileEmailSet(mailClientProfile.favoriteContactEmails).count)",
            "VIP: \(profileEmailSet(mailClientProfile.vipContactEmails).count)",
            "Starred: \(profileEmailSet(mailClientProfile.starredContactEmails).count)",
            "Directory Settings: \(mailClientProfile.directoryPreferences?.count ?? 0)",
            "Automation Rules: preference-ready"
        ]
    }

    var profileSyncSecretSafetyItems: [String] {
        [
            "OAuth tokens: excluded",
            "Refresh tokens: excluded",
            "Passwords: excluded",
            "SMTP/IMAP credentials: excluded",
            "Session cookies: excluded",
            "AI secrets: excluded",
            "Private keys: excluded"
        ]
    }

    var deviceContactsEnabledForDirectory: Bool {
        profilePreference(Self.deviceContactsPreferenceKey, defaultValue: "false") == "true"
    }

    func setDeviceContactsEnabledForDirectory(_ enabled: Bool) {
        setProfilePreference(Self.deviceContactsPreferenceKey, value: enabled ? "true" : "false")
    }

    func isFavoriteContact(_ email: String) -> Bool {
        profileEmailSet(mailClientProfile.favoriteContactEmails).contains(normalizedProfileEmail(email))
    }

    func isVIPContact(_ email: String) -> Bool {
        profileEmailSet(mailClientProfile.vipContactEmails).contains(normalizedProfileEmail(email))
    }

    func isStarredContact(_ email: String) -> Bool {
        profileEmailSet(mailClientProfile.starredContactEmails).contains(normalizedProfileEmail(email))
    }

    func toggleFavoriteContact(_ email: String) {
        toggleProfileEmail(email, keyPath: \.favoriteContactEmails)
    }

    func toggleVIPContact(_ email: String) {
        toggleProfileEmail(email, keyPath: \.vipContactEmails)
    }

    func toggleStarredContact(_ email: String) {
        toggleProfileEmail(email, keyPath: \.starredContactEmails)
    }

    func recordAutocompleteSelection(_ email: String) {
        let cleaned = normalizedProfileEmail(email)
        guard cleaned.contains("@") else { return }
        mergeLatestCloudProfileIfNewer()
        var profile = mailClientProfile
        var learning = profile.autocompleteLearning ?? [:]
        learning[cleaned, default: 0] += 1
        profile.autocompleteLearning = learning
        profile.composePreferences = merging(profile.composePreferences, key: Self.autocompletePreferenceKey, value: "true")
        profile.syncedItems = profileSyncSyncedItems
        mailClientProfile = profile
        persistMailClientProfile(markUpdated: true)
    }

    func markProfileRestoredFromCloud() {
        mergeLatestCloudProfileIfNewer()
        var profile = mailClientProfile
        profile.profileSyncLastRestoreAt = Date()
        profile.syncedItems = profileSyncSyncedItems
        upsertCurrentDevice(into: &profile)
        mailClientProfile = profile
        persistMailClientProfile(markUpdated: true)
        iCloudProfileSyncStatus = "Profile Sync V2 restore preview applied; secrets excluded"
    }

    private func profileEmailSet(_ values: [String]?) -> Set<String> {
        Set((values ?? []).map(normalizedProfileEmail).filter { $0.contains("@") })
    }

    private func normalizedProfileEmail(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func toggleProfileEmail(_ email: String, keyPath: WritableKeyPath<MailClientProfile, [String]?>) {
        let cleaned = normalizedProfileEmail(email)
        guard cleaned.contains("@") else { return }
        mergeLatestCloudProfileIfNewer()
        var profile = mailClientProfile
        var values = profileEmailSet(profile[keyPath: keyPath])
        if values.contains(cleaned) {
            values.remove(cleaned)
        } else {
            values.insert(cleaned)
        }
        profile[keyPath: keyPath] = values.sorted()
        profile.directoryPreferences = merging(profile.directoryPreferences, key: "directory_favorites_sync", value: "true")
        profile.syncedItems = profileSyncSyncedItems
        upsertCurrentDevice(into: &profile)
        mailClientProfile = profile
        persistMailClientProfile(markUpdated: true)
    }

    private func merging(_ source: [String: String]?, key: String, value: String) -> [String: String] {
        var copy = source ?? [:]
        copy[key] = value
        return copy
    }

    private func currentProfileSyncDevice() -> ProfileSyncDevice {
        let id = mailClientProfile.profileSyncDeviceId ?? Self.storageSuffix(for: profileSyncDeviceLabel)
        return ProfileSyncDevice(
            id: id,
            label: profileSyncDeviceLabel,
            kind: profileSyncDeviceKind,
            lastSeen: Date(),
            syncStatus: iCloudProfileLastWriteVerified || iCloudProfileLastReadVerified ? "Healthy" : "Queued"
        )
    }

    private func upsertCurrentDevice(into profile: inout MailClientProfile) {
        let current = currentProfileSyncDevice()
        var devices = profile.profileSyncDevices ?? []
        devices.removeAll { $0.id == current.id }
        devices.insert(current, at: 0)
        profile.profileSyncDevices = Array(devices.prefix(10))
        profile.profileSyncDeviceId = current.id
        profile.profileSyncDeviceLabel = current.label
    }

    func saveDraft(id: UUID? = nil, fromEmail: String, to: String, cc: String, bcc: String, subject: String, body: String, attachments: [LocalAttachmentDraft] = [], attachmentNames: [String] = []) {
        let displayNames = attachments.isEmpty ? attachmentNames : attachments.map(\.filename)
        let draft = LocalMailDraft(
            id: id ?? UUID(),
            fromEmail: fromEmail,
            to: to,
            cc: cc,
            bcc: bcc,
            subject: subject,
            body: body,
            attachments: attachments.isEmpty ? nil : attachments,
            attachmentNames: displayNames,
            updatedAt: Date()
        )
        drafts.removeAll { $0.id == draft.id }
        drafts.insert(draft, at: 0)
        persistCodableForCurrentUser(drafts, keyBase: Self.draftsKeyBase)
    }

    func deleteDraft(_ draft: LocalMailDraft) {
        drafts.removeAll { $0.id == draft.id }
        persistCodableForCurrentUser(drafts, keyBase: Self.draftsKeyBase)
    }

    // MARK: NEXORA Work OS

    func createMission(title: String, goal: String) {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        let mission = AgentMission(title: cleanTitle, goal: goal.trimmingCharacters(in: .whitespacesAndNewlines))
        missions.insert(mission, at: 0)
        nexoraGoals.insert(NexoraGoalRecord(title: cleanTitle, outcome: mission.goal, status: .ready, missionID: mission.id), at: 0)
        remember(.goal, missionID: mission.id, summary: "Goal created: \(cleanTitle)")
        remember(.mission, missionID: mission.id, summary: "Mission created with a user-controlled execution plan.")
        executionPlans.insert(
            ExecutionPlan(missionID: mission.id, title: "Execution plan", steps: ["Clarify outcome", "Prepare deliverable", "Review and share"]),
            at: 0
        )
        nexoraOutcomes.insert(NexoraOutcomeRecord(missionID: mission.id, title: cleanTitle, nextActions: ["Review plan", "Choose an agent workflow"]), at: 0)
        persistWorkOS()
    }

    func togglePlanStep(planID: UUID, step: Int) {
        guard let index = executionPlans.firstIndex(where: { $0.id == planID }) else { return }
        if executionPlans[index].completedStepIDs.contains(step) {
            executionPlans[index].completedStepIDs.remove(step)
        } else {
            executionPlans[index].completedStepIDs.insert(step)
        }
        executionPlans[index].updatedAt = Date()
        let missionID = executionPlans[index].missionID
        if let missionIndex = missions.firstIndex(where: { $0.id == missionID }) {
            missions[missionIndex].progress = executionPlans[index].completedStepIDs.count == executionPlans[index].steps.count ? .complete : .active
            missions[missionIndex].updatedAt = Date()
        }
        persistWorkOS()
    }

    func createDeliverable(for mission: AgentMission, kind: DeliverableKind) {
        let title: String
        let content: String
        switch kind {
        case .emailDraft:
            title = "Email draft: \(mission.title)"
            content = "Hello,\n\n\(mission.goal.isEmpty ? "Here is the latest update." : mission.goal)\n\nBest,"
        case .meetingBrief:
            title = "Meeting brief: \(mission.title)"
            content = "Objective\n\(mission.goal)\n\nAgenda\n1. Context\n2. Decision needed\n3. Next steps"
        case .customerBrief:
            title = "Customer brief: \(mission.title)"
            content = "Customer objective\n\(mission.goal)\n\nCurrent context\n\nRecommended next step"
        case .executiveBrief:
            title = "Executive brief: \(mission.title)"
            content = "Executive objective\n\(mission.goal)\n\nKey signals\n\nDecision needed\nReview before sharing."
        case .statusReport:
            title = "Status report: \(mission.title)"
            content = "Status objective\n\(mission.goal)\n\nCurrent status\nPlan prepared; execution remains user-controlled."
        case .actionReport:
            title = "Action report: \(mission.title)"
            content = "Action objective\n\(mission.goal)\n\nNext actions\n1. Review.\n2. Confirm owner.\n3. Execute after approval."
        case .decisionSummary:
            title = "Decision summary: \(mission.title)"
            content = "Decision question\n\(mission.goal)\n\nEvidence\nVisible authorized mailbox context.\n\nDecision\nPending review."
        }
        let deliverable = Deliverable(missionID: mission.id, kind: kind, title: title, content: content)
        deliverables.insert(deliverable, at: 0)
        if kind == .emailDraft {
            saveDraft(fromEmail: defaultSendingIdentity?.email ?? currentUser?.email ?? "", to: "", cc: "", bcc: "", subject: mission.title, body: content)
        }
        persistWorkOS()
    }

    func agentProposal(for mission: AgentMission, agent: NexoraAgentType) -> AgentExecutionProposal {
        nexoraAgentEngine.propose(agent: agent, goal: mission.goal.isEmpty ? mission.title : mission.goal, emails: emails)
    }

    func runAgent(for mission: AgentMission, agent: NexoraAgentType) {
        let proposal = agentProposal(for: mission, agent: agent)
        if let missionIndex = missions.firstIndex(where: { $0.id == mission.id }) {
            missions[missionIndex].progress = .running
            missions[missionIndex].updatedAt = Date()
        }
        if let planIndex = executionPlans.firstIndex(where: { $0.missionID == mission.id }) {
            executionPlans[planIndex].title = "\(proposal.agent.rawValue) plan"
            executionPlans[planIndex].steps = proposal.steps
            executionPlans[planIndex].completedStepIDs = Set(proposal.steps.indices)
            executionPlans[planIndex].updatedAt = Date()
        }
        for kind in proposal.expectedOutputs {
            let deliverable = Deliverable(missionID: mission.id, kind: kind, title: "\(kind.rawValue): \(mission.title)", content: nexoraAgentEngine.content(for: proposal, kind: kind))
            deliverables.insert(deliverable, at: 0)
        }
        remember(.deliverable, missionID: mission.id, summary: "\(agent.rawValue) produced reviewable outputs.")
        if let missionIndex = missions.firstIndex(where: { $0.id == mission.id }) {
            missions[missionIndex].progress = .completed
            missions[missionIndex].updatedAt = Date()
        }
        updateOutcome(for: mission.id, progress: 100, blockers: [], nextActions: ["Review outputs", "Share only after approval"], summary: "Agent workflow completed with reviewable outputs.")
        persistWorkOS()
    }

    /// Runs a bounded local handoff. It never sends mail or performs an unreviewed external action.
    func runCollaborativeWorkflow(for mission: AgentMission) {
        let chain: [NexoraAgentType] = [.customer, .meeting, .document]
        var outputIDs: [UUID] = []
        for agent in chain {
            let proposal = agentProposal(for: mission, agent: agent)
            for kind in proposal.expectedOutputs {
                let output = Deliverable(missionID: mission.id, kind: kind, title: "\(kind.rawValue): \(mission.title)", content: nexoraAgentEngine.content(for: proposal, kind: kind))
                deliverables.insert(output, at: 0)
                outputIDs.append(output.id)
            }
            remember(.deliverable, missionID: mission.id, summary: "\(agent.rawValue) handed context to the next agent.")
        }
        nexoraCollaborations.insert(NexoraCollaborationRun(missionID: mission.id, agents: chain, handoffSummary: "Customer context → meeting context → document output. Review remains required.", deliverableIDs: outputIDs), at: 0)
        updateOutcome(for: mission.id, progress: 100, blockers: [], nextActions: ["Review the collaboration outputs"], summary: "Multi-agent handoff completed locally.")
        if let index = missions.firstIndex(where: { $0.id == mission.id }) {
            missions[index].progress = .completed
            missions[index].updatedAt = Date()
        }
        persistWorkOS()
    }

    func remember(_ kind: NexoraMemoryKind, missionID: UUID?, summary: String) {
        nexoraMemory.insert(NexoraMemoryRecord(kind: kind, missionID: missionID, summary: summary), at: 0)
        nexoraMemory = Array(nexoraMemory.prefix(200))
    }

    func updateOutcome(for missionID: UUID, progress: Int, blockers: [String], nextActions: [String], summary: String) {
        guard let index = nexoraOutcomes.firstIndex(where: { $0.missionID == missionID }) else { return }
        nexoraOutcomes[index].progress = progress
        nexoraOutcomes[index].blockers = blockers
        nexoraOutcomes[index].nextActions = nextActions
        nexoraOutcomes[index].summary = summary
        nexoraOutcomes[index].updatedAt = Date()
        remember(.outcome, missionID: missionID, summary: summary)
    }

    func refreshOrganizationGraph() {
        let domains = Set(addresses.map(\.displayDomain).filter { !$0.isEmpty })
        let identities = Set(addresses.map(\.email).filter { !$0.isEmpty })
        let organizationSource = currentUser?.email ?? currentUser?.displayName ?? "current organization"
        var nodes: [NexoraGraphNode] = [NexoraGraphNode(id: NexoraGraphNode.stableID(kind: .organization, source: organizationSource), kind: .organization, label: currentUser?.displayName ?? "Current organization", metadata: ["source": "local account context"])]
        nodes.append(contentsOf: domains.map { NexoraGraphNode(id: NexoraGraphNode.stableID(kind: .domain, source: $0), kind: .domain, label: $0, metadata: ["source": "connected mailbox"]) })
        nodes.append(contentsOf: identities.map { NexoraGraphNode(id: NexoraGraphNode.stableID(kind: .identity, source: $0), kind: .identity, label: $0, metadata: ["source": "connected identity"]) })
        let senderCounts = Dictionary(grouping: emails.filter { !$0.fromAddress.isEmpty }, by: { $0.fromAddress.lowercased() })
        let establishedCorrespondents = senderCounts
            .filter { address, messages in
                !identities.contains(address) && !isContactRemovedLocally(address) && messages.count >= 2
            }
            .map { address, messages in
                NexoraGraphNode(
                    id: NexoraGraphNode.stableID(kind: .customer, source: address),
                    kind: .customer,
                    label: messages.first?.fromName ?? address,
                    metadata: [
                        "email": address,
                        "source": "observed communication",
                        "interaction_count": "\(messages.count)",
                        "status": messages.contains(where: \.isUnread) ? "active" : "observed"
                    ]
                )
            }
        nodes.append(contentsOf: establishedCorrespondents)
        nexoraOrganizationGraph = NexoraOrganizationGraph(nodes: nodes, updatedAt: Date())
        persistWorkOS()
    }

    private func persistWorkOS() {
        persistCodableForCurrentUser(missions, keyBase: Self.missionsKeyBase)
        persistCodableForCurrentUser(executionPlans, keyBase: Self.executionPlansKeyBase)
        persistCodableForCurrentUser(deliverables, keyBase: Self.deliverablesKeyBase)
        persistCodableForCurrentUser(nexoraGoals, keyBase: Self.goalsKeyBase)
        persistCodableForCurrentUser(nexoraMemory, keyBase: Self.memoryKeyBase)
        persistCodableForCurrentUser(nexoraOutcomes, keyBase: Self.outcomesKeyBase)
        persistCodableForCurrentUser(nexoraCollaborations, keyBase: Self.collaborationsKeyBase)
        persistCodableForCurrentUser(nexoraOrganizationGraph, keyBase: Self.organizationGraphKeyBase)
    }

    func deleteSentMessage(_ message: LocalSentMessage) {
        sentMessages.removeAll { $0.id == message.id }
        persistCodableForCurrentUser(sentMessages, keyBase: Self.sentKeyBase)
    }

    func deleteOutboxMessage(_ message: LocalOutboxMessage) {
        outboxMessages.removeAll { $0.id == message.id }
        persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
    }

    func cancelOutboxMessage(_ message: LocalOutboxMessage) {
        if let index = outboxMessages.firstIndex(where: { $0.id == message.id }) {
            outboxMessages[index].lastError = "Cancelled by user. Delivery was not attempted or confirmed."
            outboxMessages[index].deliveryState = .cancelled
            outboxMessages[index].updatedAt = Date()
        } else {
            outboxMessages.insert(
                LocalOutboxMessage(
                    id: message.id,
                    fromEmail: message.fromEmail,
                    to: message.to,
                    cc: message.cc,
                    bcc: message.bcc,
                    subject: message.subject,
                    body: message.body,
                    attachments: message.attachments,
                    attachmentNames: message.attachmentNames,
                    lastError: "Cancelled by user. Delivery was not attempted or confirmed.",
                    updatedAt: Date(),
                    deliveryState: .cancelled,
                    outboundId: message.outboundId
                ),
                at: 0
            )
        }
        persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
    }

    func deleteScheduledMessage(_ message: LocalScheduledMessage) {
        scheduledMessages.removeAll { $0.id == message.id }
        persistCodableForCurrentUser(scheduledMessages, keyBase: Self.scheduledKeyBase)
    }

#if DEBUG
    func debugSeedOutboxSmoke(subject: String, state: DeliveryState, fromEmail: String, to: String) {
        outboxMessages.removeAll { $0.subject == subject }
        let message: String
        switch state {
        case .retryScheduled:
            message = "Retry scheduled. Provider has not accepted delivery; this is not Delivered."
        case .cancelled:
            message = "Cancelled by user. Delivery was not attempted or confirmed."
        case .failed, .failedPermanent, .dead, .bounced:
            message = "Send failed. Correct the recipient or cancel; this is not Delivered."
        default:
            message = "Outbox state \(state.rawValue). Delivery is not confirmed."
        }
        outboxMessages.insert(
            LocalOutboxMessage(
                id: UUID(),
                fromEmail: fromEmail,
                to: to,
                cc: "",
                bcc: "",
                subject: subject,
                body: "NEXORA safe outbox failure state-machine test. No private data.",
                attachments: nil,
                attachmentNames: [],
                lastError: message,
                updatedAt: Date(),
                deliveryState: state
            ),
            at: 0
        )
        persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
    }

    func debugCancelOutboxSmoke(subject: String) {
        guard let message = outboxMessages.first(where: { $0.subject == subject }) else { return }
        cancelOutboxMessage(message)
    }
#endif

    func scheduleDraft(fromEmail: String, to: String, cc: String = "", bcc: String = "", subject: String, body: String = "", attachments: [LocalAttachmentDraft] = [], attachmentNames: [String] = [], at date: Date) {
        let displayNames = attachments.isEmpty ? attachmentNames : attachments.map(\.filename)
        scheduledMessages.insert(
            LocalScheduledMessage(
                id: UUID(),
                fromEmail: fromEmail,
                to: to,
                cc: cc,
                bcc: bcc,
                subject: subject,
                body: body,
                attachments: attachments.isEmpty ? nil : attachments,
                attachmentNames: displayNames,
                scheduledAt: date,
                status: "Saved locally; automatic delivery is not enabled"
            ),
            at: 0
        )
        persistCodableForCurrentUser(scheduledMessages, keyBase: Self.scheduledKeyBase)
    }

    // MARK: Sending

    func send(from address: MailAddress, to recipient: String, cc: String = "", bcc: String = "",
              subject: String, body: String, attachments: [LocalAttachmentDraft] = [], attachmentNames: [String] = [], draftId: UUID? = nil) async -> Bool {
        let signature = signature(for: address.email)
        let signedBody = body.contains(signature.trimmingCharacters(in: .whitespacesAndNewlines))
            ? body
            : body + (signature.isEmpty ? "" : "\n\(signature)")
        let sendAttachments = attachments.isEmpty ? attachmentNames.map(LocalAttachmentDraft.legacyFilenameOnly) : attachments
        let displayAttachmentNames = sendAttachments.map(\.filename)
        let toList = Self.normalizedRecipients(recipient)
        let ccList = Self.normalizedRecipients(cc)
        let bccList = Self.normalizedRecipients(bcc)
        errorMessage = sendAttachments.isEmpty ? "Validating message..." : "Preparing attachments..."
        guard !toList.isEmpty else {
            errorMessage = "Add at least one valid recipient."
            return false
        }
        if sendAttachments.contains(where: { !$0.hasPayload }) {
            outboxMessages.insert(
                LocalOutboxMessage(
                    id: UUID(),
                    fromEmail: address.email,
                    to: recipient,
                    cc: cc,
                    bcc: bcc,
                    subject: subject,
                    body: signedBody,
                    attachments: sendAttachments,
                    attachmentNames: displayAttachmentNames,
                    lastError: "One or more attachments need to be reattached before sending.",
                    updatedAt: Date(),
                    deliveryState: .failedPermanent
                ),
                at: 0
            )
            saveDraft(id: draftId, fromEmail: address.email, to: recipient, cc: cc, bcc: bcc, subject: subject, body: body, attachments: sendAttachments)
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
            errorMessage = "Reattach files before sending. This draft only has attachment names from an older local save."
            return false
        }
        do {
            networkRequestCount += 1
            try await backend.assertProductionBackend(domain: domain)
        } catch {
            outboxMessages.insert(
                LocalOutboxMessage(
                    id: UUID(),
                    fromEmail: address.email,
                    to: recipient,
                    cc: cc,
                    bcc: bcc,
                    subject: subject,
                    body: signedBody,
                    attachments: sendAttachments.isEmpty ? nil : sendAttachments,
                    attachmentNames: displayAttachmentNames,
                    lastError: Self.productSafeErrorMessage(error, context: .outbox),
                    updatedAt: Date(),
                    deliveryState: .failedPermanent
                ),
                at: 0
            )
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
            handle(error)
            return false
        }
        let outboxId = UUID()
        let initialState: DeliveryState = sendAttachments.isEmpty ? .validating : .uploadingAttachment
        let initialError = sendAttachments.isEmpty ? "Validating message..." : "Uploading attachments..."
        outboxMessages.insert(
            LocalOutboxMessage(
                id: outboxId,
                fromEmail: address.email,
                to: recipient,
                cc: cc,
                bcc: bcc,
                subject: subject,
                body: signedBody,
                attachments: sendAttachments.isEmpty ? nil : sendAttachments,
                attachmentNames: displayAttachmentNames,
                lastError: initialError,
                updatedAt: Date(),
                deliveryState: initialState
            ),
            at: 0
        )
        persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
        if let index = outboxMessages.firstIndex(where: { $0.id == outboxId }) {
            outboxMessages[index].lastError = "Sending message..."
            outboxMessages[index].deliveryState = .sending
            outboxMessages[index].updatedAt = Date()
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
        }
        errorMessage = "Sending message..."
        let form = SendEmailForm(
            accountId: address.accountId,
            sendEmail: address.email,
            name: currentUser?.displayName,
            receiveEmail: toList,
            cc: ccList,
            bcc: bccList,
            subject: subject,
            content: signedBody.replacingOccurrences(of: "\n", with: "<br>"),
            text: signedBody,
            attachments: sendAttachments.map(\.sendMetadata),
            scheduledAt: nil,
            draftId: draftId?.uuidString,
            replyToEmailId: nil,
            signatureApplied: !signature.isEmpty,
            sourceProvider: address.displayProvider.rawValue,
            idempotencyKey: "ios-\(outboxId.uuidString)")
        do {
            networkRequestCount += 1
            let result = try await backend.send(form)
            switch result.state {
            case .providerAccepted, .providerConfirmed, .delivered, .sent:
                if !result.state.acceptedByProviderForSendUX {
                    assertionFailure("Accepted provider send state classification drifted.")
                }
                outboxMessages.removeAll { $0.id == outboxId }
            case .retryScheduled:
                if let index = outboxMessages.firstIndex(where: { $0.id == outboxId }) {
                    outboxMessages[index].lastError = "Provider did not accept final delivery yet. NEXORA will retry."
                    outboxMessages[index].deliveryState = .retryScheduled
                    outboxMessages[index].outboundId = result.outboundId
                    outboxMessages[index].updatedAt = Date()
                }
                persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
                errorMessage = "Message remains in Outbox and will retry."
                return false
            case .queued, .failed, .failedPermanent, .bounced, .dead, .cancelled, .draft, .preparing, .validating, .uploadingAttachment, .sending:
                if let index = outboxMessages.firstIndex(where: { $0.id == outboxId }) {
                    outboxMessages[index].lastError = "Provider did not accept this message."
                    outboxMessages[index].deliveryState = .failedPermanent
                    outboxMessages[index].outboundId = result.outboundId
                    outboxMessages[index].updatedAt = Date()
                }
                persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
                errorMessage = "Provider did not accept this message. It remains in Outbox."
                return false
            }
            sentMessages.insert(
                LocalSentMessage(
                    id: UUID(),
                    fromEmail: address.email,
                    to: recipient,
                    cc: cc,
                    bcc: bcc,
                    subject: subject,
                    bodyPreview: String(signedBody.prefix(180)),
                    attachments: sendAttachments.isEmpty ? nil : sendAttachments,
                    attachmentNames: displayAttachmentNames,
                    sentAt: Date(),
                    backendAccepted: true,
                    deliveryState: result.state,
                    providerMessageId: result.providerMessageId,
                    outboundId: result.outboundId
                ),
                at: 0
            )
            if let draftId { drafts.removeAll { $0.id == draftId } }
            persistCodableForCurrentUser(sentMessages, keyBase: Self.sentKeyBase)
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
            persistCodableForCurrentUser(drafts, keyBase: Self.draftsKeyBase)
            errorMessage = result.state == .delivered ? nil : "Provider accepted. Delivery is not confirmed until the recipient mailbox shows the message."
            return true
        } catch {
            if let index = outboxMessages.firstIndex(where: { $0.id == outboxId }) {
                outboxMessages[index].lastError = Self.productSafeErrorMessage(error, context: .outbox)
                outboxMessages[index].deliveryState = .failedPermanent
                outboxMessages[index].updatedAt = Date()
            }
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
            handle(error)
            return false
        }
    }

    // MARK: Helpers

    private func setPrimaryIdentity(_ email: String) {
        mergeLatestCloudProfileIfNewer()
        let cleaned = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !cleaned.isEmpty else { return }
        if mailClientProfile.primaryIdentityEmail?.lowercased() != cleaned {
            mailClientProfile.primaryIdentityEmail = email
        }
        if mailClientProfile.defaultSendingAddress == nil {
            mailClientProfile.defaultSendingAddress = email
        }
        persistMailClientProfile(markUpdated: true)
    }

    private func reconcileMailClientProfile(with addresses: [MailAddress]) {
        mergeLatestCloudProfileIfNewer()
        let addressEmails = addresses.map { $0.email.lowercased() }
        var profile = mailClientProfile
        let previous = profile
        profile.connectedMailboxEmails = addressEmails
        let existingOrder = profile.mailboxDisplayOrder.filter { addressEmails.contains($0) }
        let additions = addressEmails.filter { !existingOrder.contains($0) }
        profile.mailboxDisplayOrder = existingOrder + additions
        if let defaultAddress = profile.defaultSendingAddress?.lowercased(),
           !addressEmails.contains(defaultAddress) {
            profile.defaultSendingAddress = currentUser?.email ?? addresses.first?.email
        }
        profile.aiProviderReadiness = providerReadiness.reduce(into: [:]) { partial, item in
            partial[item.key.rawValue] = item.value ? "Authorized" : "Not available"
        }
        profile.syncedItems = profileSyncSyncedItems
        upsertCurrentDevice(into: &profile)
        mailClientProfile = profile
        if profile != previous {
            persistMailClientProfile(markUpdated: true)
        }
    }

    private func restoreMailClientState(for email: String) {
        let cloudStore = NSUbiquitousKeyValueStore.default
        let synchronized = cloudStore.synchronize()
        iCloudProfileSyncStatus = synchronized ? "iCloud KVS synchronized before profile restore" : "iCloud KVS synchronize returned false before profile restore"
        let profileKey = Self.ownerScopedKey(Self.profileKeyBase, email: email)
        if let cloudData = cloudStore.data(forKey: profileKey),
           let cloudProfile = try? JSONDecoder().decode(MailClientProfile.self, from: cloudData) {
            mailClientProfile = cloudProfile
            iCloudProfileLastReadVerified = true
            iCloudProfileLastWrittenKey = profileKey
        } else if let profile: MailClientProfile = loadCodable(key: profileKey) {
            mailClientProfile = profile
            iCloudProfileLastReadVerified = false
        } else {
            mailClientProfile = .empty
            iCloudProfileLastReadVerified = false
        }
        applyProfilePreferencesToLocalDefaults()
        drafts = loadCodable(key: Self.ownerScopedKey(Self.draftsKeyBase, email: email)) ?? []
        sentMessages = loadCodable(key: Self.ownerScopedKey(Self.sentKeyBase, email: email)) ?? []
        outboxMessages = loadCodable(key: Self.ownerScopedKey(Self.outboxKeyBase, email: email)) ?? []
        scheduledMessages = loadCodable(key: Self.ownerScopedKey(Self.scheduledKeyBase, email: email)) ?? []
        mailStateOverlay = loadCodable(key: Self.ownerScopedKey(Self.overlayKeyBase, email: email)) ?? .empty
        missions = loadCodable(key: Self.ownerScopedKey(Self.missionsKeyBase, email: email)) ?? []
        executionPlans = loadCodable(key: Self.ownerScopedKey(Self.executionPlansKeyBase, email: email)) ?? []
        deliverables = loadCodable(key: Self.ownerScopedKey(Self.deliverablesKeyBase, email: email)) ?? []
        nexoraGoals = loadCodable(key: Self.ownerScopedKey(Self.goalsKeyBase, email: email)) ?? []
        nexoraMemory = loadCodable(key: Self.ownerScopedKey(Self.memoryKeyBase, email: email)) ?? []
        nexoraOutcomes = loadCodable(key: Self.ownerScopedKey(Self.outcomesKeyBase, email: email)) ?? []
        nexoraCollaborations = loadCodable(key: Self.ownerScopedKey(Self.collaborationsKeyBase, email: email)) ?? []
        nexoraOrganizationGraph = loadCodable(key: Self.ownerScopedKey(Self.organizationGraphKeyBase, email: email)) ?? NexoraOrganizationGraph()
        addresses = loadCodable(key: Self.ownerScopedKey(Self.accountsCacheKeyBase, email: email)) ?? addresses
        sanitizeLocalMailStateForCurrentUser()
    }

    private func startICloudProfileSyncObserver() {
        iCloudProfileSyncObserver = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: NSUbiquitousKeyValueStore.default,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor [weak self] in
                self?.handleICloudProfileSyncChange(notification)
            }
        }
        let synchronized = NSUbiquitousKeyValueStore.default.synchronize()
        iCloudProfileSyncStatus = synchronized ? "iCloud KVS observer active" : "iCloud KVS observer active; synchronize returned false"
    }

    private func handleICloudProfileSyncChange(_ notification: Notification) {
        guard let key = currentUserScopedKey(Self.profileKeyBase) else { return }
        let changedKeys = notification.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String]
        iCloudProfileLastChangedKeys = changedKeys ?? []
        if let changedKeys, !changedKeys.contains(key) { return }
        let synchronized = NSUbiquitousKeyValueStore.default.synchronize()
        guard let cloudData = NSUbiquitousKeyValueStore.default.data(forKey: key),
              let cloudProfile = try? JSONDecoder().decode(MailClientProfile.self, from: cloudData),
              cloudProfile != mailClientProfile else {
            iCloudProfileLastReadVerified = false
            iCloudProfileSyncStatus = synchronized ? "iCloud profile callback received; no newer profile" : "iCloud profile callback received; synchronize returned false"
            return
        }
        mailClientProfile = cloudProfile
        iCloudProfileLastReadVerified = true
        iCloudProfileSyncStatus = "iCloud profile update applied"
        applyProfilePreferencesToLocalDefaults()
        persistCodable(mailClientProfile, key: key)
    }

    private func persistMailClientProfile(markUpdated: Bool) {
        guard let key = currentUserScopedKey(Self.profileKeyBase) else { return }
        if markUpdated {
            mailClientProfile.updatedAt = Date()
        }
        persistCodable(mailClientProfile, key: key)
        if let data = try? JSONEncoder().encode(mailClientProfile) {
            let cloudStore = NSUbiquitousKeyValueStore.default
            cloudStore.set(data, forKey: key)
            let synchronized = cloudStore.synchronize()
            let writtenProfile = cloudStore.data(forKey: key)
                .flatMap { try? JSONDecoder().decode(MailClientProfile.self, from: $0) }
            iCloudProfileLastWrittenKey = key
            iCloudProfileLastWriteVerified = writtenProfile == mailClientProfile
            iCloudProfileSyncStatus = synchronized
                ? "iCloud profile write synchronized"
                : "iCloud profile write queued; synchronize returned false"
        }
    }

    private func mergeLatestCloudProfileIfNewer() {
        guard let key = currentUserScopedKey(Self.profileKeyBase) else { return }
        let cloudStore = NSUbiquitousKeyValueStore.default
        _ = cloudStore.synchronize()
        guard let cloudData = cloudStore.data(forKey: key),
              let cloudProfile = try? JSONDecoder().decode(MailClientProfile.self, from: cloudData),
              cloudProfile != mailClientProfile,
              shouldPreferCloudProfile(cloudProfile, over: mailClientProfile) else {
            return
        }
        mailClientProfile = cloudProfile
        applyProfilePreferencesToLocalDefaults()
        persistCodable(mailClientProfile, key: key)
        iCloudProfileLastReadVerified = true
        iCloudProfileSyncStatus = "Merged newer iCloud profile before local write"
    }

    private func shouldPreferCloudProfile(_ cloudProfile: MailClientProfile, over localProfile: MailClientProfile) -> Bool {
        switch (cloudProfile.updatedAt, localProfile.updatedAt) {
        case let (cloud?, local?):
            return cloud > local
        case (.some, nil):
            return true
        case (nil, .some):
            return false
        case (nil, nil):
            return cloudProfile != localProfile
        }
    }

    private func applyProfilePreferencesToLocalDefaults() {
        for (key, value) in mailClientProfile.uiPreferences {
            UserDefaults.standard.set(value, forKey: key)
        }
        if let aiEnabled = mailClientProfile.uiPreferences[Self.aiEnabledPreferenceKey] {
            aiConsent.aiEnabled = aiEnabled != "false"
        }
        aiConsent.cloudAIEnabled = false
    }

    private func updateAIConsentProfilePreferences(_ consent: AIConsent, persist: Bool) {
        if persist {
            mergeLatestCloudProfileIfNewer()
        }
        var profile = mailClientProfile
        profile.uiPreferences[Self.aiEnabledPreferenceKey] = consent.aiEnabled ? "true" : "false"
        profile.uiPreferences[Self.cloudAIEnabledPreferenceKey] = "false"
        mailClientProfile = profile
        if persist {
            persistMailClientProfile(markUpdated: true)
        }
    }

    private func persistCodableForCurrentUser<T: Encodable>(_ value: T, keyBase: String) {
        guard let key = currentUserScopedKey(keyBase) else { return }
        persistCodable(value, key: key)
    }

    private func persistMailStateOverlay() {
        persistCodableForCurrentUser(mailStateOverlay, keyBase: Self.overlayKeyBase)
    }

    private func persistCachedInbox() {
        persistCodableForCurrentUser(emails, keyBase: Self.inboxCacheKeyBase)
    }

    private func persistCachedAccounts() {
        persistCodableForCurrentUser(addresses, keyBase: Self.accountsCacheKeyBase)
    }

    private func restoreCachedInbox(for email: String) {
        UserDefaults.standard.set(email, forKey: Self.lastUserEmailKey)
        let key = Self.ownerScopedKey(Self.inboxCacheKeyBase, email: email)
        if let cached: [EmailMessage] = loadCodable(key: key), !cached.isEmpty {
            emails = applyMailStateOverlay(to: cached.map { $0.sanitizedForDisplayStorage() })
            invalidateSmartMailCategoryCache()
            cachedInboxRestored = true
            persistCachedInbox()
        }
    }

    private func applyMailStateOverlay(to messages: [EmailMessage]) -> [EmailMessage] {
        messages.map { original in
            var message = original
            if mailStateOverlay.readEmailIds.contains(message.emailId) {
                message.unread = 0
            } else if mailStateOverlay.unreadEmailIds.contains(message.emailId) {
                message.unread = 1
            }
            if mailStateOverlay.starredEmailIds.contains(message.emailId) {
                message.isStar = 1
            } else if mailStateOverlay.unstarredEmailIds.contains(message.emailId) {
                message.isStar = 0
            }
            return message
        }
    }

    static func normalizedRecipients(_ value: String) -> [String] {
        value
            .split { $0 == "," || $0 == ";" || $0 == "\n" || $0 == "\t" }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { candidate in
                let parts = candidate.split(separator: "@", maxSplits: 1)
                return parts.count == 2 && parts[1].contains(".") && !parts[0].isEmpty
            }
    }

    private func currentUserScopedKey(_ base: String) -> String? {
        guard let email = currentUser?.email?.trimmingCharacters(in: .whitespacesAndNewlines),
              !email.isEmpty else { return nil }
        return Self.ownerScopedKey(base, email: email)
    }

    private static func ownerScopedKey(_ base: String, email: String) -> String {
        "\(base)_\(storageSuffix(for: email))"
    }

    private static func storageSuffix(for email: String) -> String {
        let allowed = CharacterSet.alphanumerics
        let cleaned = email.lowercased().unicodeScalars.map { scalar -> String in
            allowed.contains(scalar) ? String(scalar) : "_"
        }.joined()
        let suffix = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return suffix.isEmpty ? "unknown" : suffix
    }

    private func persistCodable<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private func loadCodable<T: Decodable>(key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func handle(_ error: Error) {
        guard !error.isCloudMailCancellation else { return }
        if let api = error as? APIError {
            if api.code == 401 {
                let wasReady = phase == .ready
                clearLocalSession()
                errorMessage = wasReady ? "Session expired. Please sign in again." : nil
                Task {
                    guard self.token == nil else { return }
                    await backend.updateToken(nil)
                }
            }
            else { errorMessage = ProductSafeText.sanitize(api.userMessage, context: .general) }
        } else {
            let text = error.localizedDescription
            if text.lowercased().contains("correct format") || text.lowercased().contains("decoding") {
                errorMessage = "NEXORA could not read one mail item. Your cached inbox remains available while sync catches up."
            } else {
                errorMessage = ProductSafeText.sanitize(text, context: .general)
            }
        }
    }

    private static func productSafeErrorMessage(_ error: Error, context: ProductSafeText.Context) -> String {
        let raw: String
        if let api = error as? APIError {
            raw = api.userMessage
        } else if let ai = error as? AIError, let description = ai.errorDescription {
            raw = description
        } else {
            raw = error.localizedDescription
        }
        return ProductSafeText.sanitize(raw, context: context)
    }

    private static func sanitizedTriage(_ triage: MailTriage) -> MailTriage {
        MailTriage(
            summary: ProductSafeText.sanitize(triage.summary, context: .preview),
            category: triage.category,
            actionRequired: triage.actionRequired,
            suggestedReply: ProductSafeText.sanitizeOptional(triage.suggestedReply, context: .compose),
            execution: triage.execution
        )
    }

    private func sanitizeLocalMailStateForCurrentUser() {
        var changed = false
        let safeDrafts = drafts.map { draft in
            var copy = draft
            copy.to = ProductSafeText.sanitize(copy.to, context: .compose)
            copy.cc = ProductSafeText.sanitize(copy.cc, context: .compose)
            copy.bcc = ProductSafeText.sanitize(copy.bcc, context: .compose)
            copy.body = ProductSafeText.sanitize(copy.body, context: .compose)
            return copy
        }
        if safeDrafts != drafts {
            drafts = safeDrafts
            changed = true
            persistCodableForCurrentUser(drafts, keyBase: Self.draftsKeyBase)
        }
        let safeSent = sentMessages.map { message in
            var copy = message
            copy.to = ProductSafeText.sanitize(copy.to, context: .compose)
            copy.cc = ProductSafeText.sanitize(copy.cc, context: .compose)
            copy.bcc = ProductSafeText.sanitize(copy.bcc, context: .compose)
            copy.bodyPreview = ProductSafeText.sanitize(copy.bodyPreview, context: .preview)
            return copy
        }
        if safeSent != sentMessages {
            sentMessages = safeSent
            changed = true
            persistCodableForCurrentUser(sentMessages, keyBase: Self.sentKeyBase)
        }
        let safeOutbox = outboxMessages.map { message in
            var copy = message
            copy.to = ProductSafeText.sanitize(copy.to, context: .compose)
            copy.cc = ProductSafeText.sanitize(copy.cc, context: .compose)
            copy.bcc = ProductSafeText.sanitize(copy.bcc, context: .compose)
            copy.body = ProductSafeText.sanitize(copy.body, context: .compose)
            copy.lastError = ProductSafeText.sanitize(copy.lastError, context: .outbox)
            return copy
        }
        if safeOutbox != outboxMessages {
            outboxMessages = safeOutbox
            changed = true
            persistCodableForCurrentUser(outboxMessages, keyBase: Self.outboxKeyBase)
        }
        let safeScheduled = scheduledMessages.map { message in
            var copy = message
            copy.to = ProductSafeText.sanitize(copy.to, context: .compose)
            copy.cc = ProductSafeText.sanitize(copy.cc, context: .compose)
            copy.bcc = ProductSafeText.sanitize(copy.bcc, context: .compose)
            copy.body = ProductSafeText.sanitize(copy.body, context: .compose)
            copy.status = ProductSafeText.sanitize(copy.status, context: .attachmentStatus)
            return copy
        }
        if safeScheduled != scheduledMessages {
            scheduledMessages = safeScheduled
            changed = true
            persistCodableForCurrentUser(scheduledMessages, keyBase: Self.scheduledKeyBase)
        }
        if changed {
            errorMessage = nil
        }
    }

    private static func resetToken(from url: URL) -> String? {
        guard url.path.contains("reset-password") || url.host == "reset-password" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let token = components?.queryItems?.first(where: { $0.name == "token" })?.value,
           !token.isEmpty {
            return token
        }
        let lastPath = url.pathComponents.last
        return (lastPath?.isEmpty == false && lastPath != "reset-password") ? lastPath : nil
    }
}
