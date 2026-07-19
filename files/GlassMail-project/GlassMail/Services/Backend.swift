//
//  Backend.swift
//  GlassMail
//
//  Networking layer for the cloud-mail backend.
//
//  Conventions discovered from the cloud-mail source:
//   • All routes live under  {baseURL}/api/...
//   • Auth header is  "Authorization: <raw token>"   (NO "Bearer " prefix)
//   • Every response is  { code, message, data }      (code 200 == success)
//

import Foundation

actor Backend {

    /// Root origin of the worker, e.g. https://cloud-mail.fastonegroup.workers.dev
    private var baseURL: URL
    private var token: String?

    private let session: URLSession
    private let sendSession: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private var lastSkippedEmailItems: Int = 0

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
        let sendConfig = URLSessionConfiguration.ephemeral
        sendConfig.timeoutIntervalForRequest = 20
        sendConfig.timeoutIntervalForResource = 20
        sendConfig.waitsForConnectivity = false
        self.sendSession = URLSession(configuration: sendConfig)
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func updateBaseURL(_ url: URL) { self.baseURL = url }
    func updateToken(_ token: String?) { self.token = token }

    // MARK: - Public API

    func login(email: String, password: String, challengeReference: String? = nil) async throws -> String {
        struct Body: Encodable {
            let email: String
            let password: String
            let challengeReference: String?
        }
        let body = Body(email: email, password: password, challengeReference: challengeReference)
        let data: TokenData = try await request(
            "/login", method: "POST", json: body, authed: false)
        return data.token
    }

    func register(email: String, password: String, code: String) async throws -> RegisterResponse {
        let body = RegisterPayload(email: email, password: password, code: code)
        return try await request(
            "/register", method: "POST", json: body, authed: false)
    }

    func forgotPassword(email: String) async throws -> ForgotPasswordResponse {
        let body = ForgotPasswordPayload(email: email)
        return try await request(
            "/forgot-password", method: "POST", json: body, authed: false)
    }

    func resetPassword(token: String, newPassword: String) async throws -> ResetPasswordResponse {
        let body = ResetPasswordPayload(token: token, newPassword: newPassword)
        return try await request(
            "/reset-password", method: "POST", json: body, authed: false)
    }

    func loginUserInfo() async throws -> LoginUserInfo {
        try await request("/my/loginUserInfo", method: "GET")
    }

    func accounts() async throws -> [MailAddress] {
        // cloud-mail returns either a bare array or a paged object; handle both.
        do {
            return try await request("/account/list", method: "GET")
        } catch is DecodingError {
            let paged: Paged<MailAddress> = try await request("/account/list", method: "GET")
            return paged.list
        }
    }

    /// Fetch a page of emails.
    /// - allReceive: when true, returns mail across all of the user's addresses.
    /// - cursor: the smallest emailId already seen (for "older" pagination). Pass nil for the first page.
    func emails(accountId: Int?,
                allReceive: Bool,
                cursor: Int?,
                provider: UnifiedMailProvider? = nil,
                size: Int = 30,
                type: Int = 0) async throws -> [EmailMessage] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "allReceive", value: allReceive ? "1" : "0"),
            URLQueryItem(name: "size", value: String(size)),
            URLQueryItem(name: "type", value: String(type)),
            URLQueryItem(name: "timeSort", value: "0")   // 0 => fetch older than cursor
        ]
        if let accountId { items.append(URLQueryItem(name: "accountId", value: String(accountId))) }
        if let cursor { items.append(URLQueryItem(name: "emailId", value: String(cursor))) }
        if let provider { items.append(URLQueryItem(name: "provider", value: provider.rawValue)) }

        let (data, _) = try await perform("/email/list", method: "GET", query: items, json: nil, authed: true)
        if let status = try? decoder.decode(APIStatusEnvelope.self, from: data),
           status.code != 200 {
            if status.code == 401 { throw APIError.unauthorized }
            throw APIError(code: status.code, message: status.message ?? "Request failed")
        }
        if let arrayEnvelope = try? decoder.decode(APIEnvelope<LossyDecodableArray<EmailMessage>>.self, from: data),
           let payload = arrayEnvelope.data {
            lastSkippedEmailItems = payload.skipped
            return payload.values
        }
        let pagedEnvelope = try decoder.decode(APIEnvelope<LossyPaged<EmailMessage>>.self, from: data)
        guard pagedEnvelope.code == 200 else {
            if pagedEnvelope.code == 401 { throw APIError.unauthorized }
            throw APIError(code: pagedEnvelope.code, message: pagedEnvelope.message ?? "Request failed")
        }
        lastSkippedEmailItems = pagedEnvelope.data?.skipped ?? 0
        return pagedEnvelope.data?.list ?? []
    }

    func globalMailLedger(accountId: Int?,
                          cursor: Int?,
                          provider: UnifiedMailProvider? = nil,
                          size: Int = 50) async throws -> [EmailMessage] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "size", value: String(size)),
            URLQueryItem(name: "timeSort", value: "0")
        ]
        if let accountId { items.append(URLQueryItem(name: "accountId", value: String(accountId))) }
        if let cursor { items.append(URLQueryItem(name: "emailId", value: String(cursor))) }
        if let provider { items.append(URLQueryItem(name: "provider", value: provider.rawValue)) }

        let (data, _) = try await perform("/v2/mail/all", method: "GET", query: items, json: nil, authed: true)
        if let status = try? decoder.decode(APIStatusEnvelope.self, from: data),
           status.code != 200 {
            if status.code == 401 { throw APIError.unauthorized }
            throw APIError(code: status.code, message: status.message ?? "Request failed")
        }
        // Older provider adapters may return the global ledger as a bare list
        // rather than a paged object. Keep each malformed row isolated instead
        // of failing the whole Inbox refresh.
        if let arrayEnvelope = try? decoder.decode(APIEnvelope<LossyDecodableArray<EmailMessage>>.self, from: data),
           let payload = arrayEnvelope.data {
            lastSkippedEmailItems = payload.skipped
            return payload.values
        }
        let pagedEnvelope = try decoder.decode(APIEnvelope<LossyPaged<EmailMessage>>.self, from: data)
        guard pagedEnvelope.code == 200 else {
            if pagedEnvelope.code == 401 { throw APIError.unauthorized }
            throw APIError(code: pagedEnvelope.code, message: pagedEnvelope.message ?? "Request failed")
        }
        lastSkippedEmailItems = pagedEnvelope.data?.skipped ?? 0
        return pagedEnvelope.data?.list ?? []
    }

    func conversationProjections(workspaceId: Int,
                                 surface: ConversationProjectionSurface,
                                 category: String? = nil,
                                 query: String? = nil,
                                 cursor: String? = nil,
                                 size: Int = 50) async throws -> ConversationProjectionRead {
        var items = [
            URLQueryItem(name: "workspace_id", value: String(workspaceId)),
            URLQueryItem(name: "surface", value: surface.rawValue),
            URLQueryItem(name: "size", value: String(min(max(size, 1), 500)))
        ]
        if let category, !category.isEmpty { items.append(URLQueryItem(name: "category", value: category)) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "query", value: query)) }
        if let cursor, !cursor.isEmpty { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        let (data, _) = try await perform("/v3/conversation-projections", method: "GET", query: items, json: nil, authed: true)
        let envelope = try decoder.decode(APIEnvelope<ConversationProjectionPayload>.self, from: data)
        guard envelope.code == 200 else {
            if envelope.code == 401 { throw APIError.unauthorized }
            throw APIError(code: envelope.code, message: envelope.message ?? "Conversation projections are unavailable.")
        }
        guard let payload = envelope.data else {
            throw APIError(code: 502, message: "Conversation projection authority is missing.")
        }
        return ConversationProjectionRead(
            surface: surface,
            authority: payload.authorityMode,
            cutoverEpoch: payload.cutoverEpoch,
            projections: payload.rows,
            nextCursor: payload.nextCursor
        )
    }

    func allConversationProjections(workspaceId: Int,
                                    surface: ConversationProjectionSurface,
                                    category: String? = nil,
                                    query: String? = nil) async throws -> ConversationProjectionRead {
        var cursor: String?
        var rows: [ConversationProjection] = []
        var authority: ConversationProjectionAuthority?
        var epoch: String?
        repeat {
            let page = try await conversationProjections(
                workspaceId: workspaceId,
                surface: surface,
                category: category,
                query: query,
                cursor: cursor,
                size: 500
            )
            if let authority, authority != page.authority { throw APIError(code: 409, message: "Conversation projection authority changed during refresh.") }
            if let epoch, epoch != page.cutoverEpoch { throw APIError(code: 409, message: "Conversation projection epoch changed during refresh.") }
            authority = page.authority
            epoch = page.cutoverEpoch
            rows.append(contentsOf: page.projections)
            cursor = page.nextCursor
        } while cursor != nil
        return ConversationProjectionRead(surface: surface, authority: authority ?? .disabled, cutoverEpoch: epoch, projections: rows, nextCursor: nil)
    }

    func conversationProjectionDetail(workspaceId: Int, conversationId: String) async throws -> ConversationProjectionDetail {
        try await request(
            "/v3/conversation-projections/\(conversationId)",
            method: "GET",
            query: [URLQueryItem(name: "workspace_id", value: String(workspaceId))]
        )
    }

    func senderBulkDestinations(workspaceId: Int, normalizedSender: String) async throws -> SenderBulkDestinationContract {
        try await request(
            "/v3/sender-bulk/destinations",
            method: "GET",
            query: [
                URLQueryItem(name: "workspace_id", value: String(workspaceId)),
                URLQueryItem(name: "normalized_sender", value: normalizedSender)
            ]
        )
    }

    func senderBulkPreview(workspaceId: Int, normalizedSender: String, destination: SenderBulkDestination) async throws -> SenderBulkPreview {
        struct Body: Encodable {
            let workspaceId: Int
            let normalizedSender: String
            let destinationType: String
            let destinationKey: String
        }
        return try await request(
            "/v3/sender-bulk/preview",
            method: "POST",
            json: Body(workspaceId: workspaceId, normalizedSender: normalizedSender, destinationType: destination.type, destinationKey: destination.key)
        )
    }

    func executeSenderBulk(workspaceId: Int, normalizedSender: String, destination: SenderBulkDestination, confirmed: Bool) async throws -> SenderBulkExecutionResult {
        struct Body: Encodable {
            let workspaceId: Int
            let normalizedSender: String
            let destinationType: String
            let destinationKey: String
            let confirmed: Bool
            let idempotencyKey: String
        }
        let key = "sender-bulk-\(UUID().uuidString.lowercased())"
        return try await request(
            "/v3/sender-bulk/execute",
            method: "POST",
            json: Body(workspaceId: workspaceId, normalizedSender: normalizedSender, destinationType: destination.type, destinationKey: destination.key, confirmed: confirmed, idempotencyKey: key)
        )
    }

    func mutateCanonicalProjectionMessage(_ message: ConversationProjectionMessage,
                                          conversationId: String,
                                          workspaceId: Int,
                                          action: String,
                                          value: CanonicalMutationValue,
                                          sourceSurface: String,
                                          idempotencyKey: String) async throws -> CanonicalMutationReceipt {
        struct Body: Encodable {
            let workspaceId: Int
            let idempotencyKey: String
            let target: CanonicalMutationTarget
            let action: String
            let value: CanonicalMutationValue
            let scope: String
            let expectedVersion: Int
            let sourceSurface: String
        }
        let body = Body(
            workspaceId: workspaceId,
            idempotencyKey: idempotencyKey,
            target: CanonicalMutationTarget(accountId: message.accountId, messageId: message.messageId, providerMessageId: "", conversationId: conversationId),
            action: action,
            value: value,
            scope: "message",
            expectedVersion: message.stateVersion,
            sourceSurface: sourceSurface
        )
        return try await request("/v3/mail/state", method: "PUT", json: body, strictPayload: true)
    }

    func skippedEmailItemCount() -> Int {
        lastSkippedEmailItems
    }

    func markRead(emailIds: [Int]) async throws {
        struct Body: Encodable { let emailIds: [Int] }
        try await requestVoid("/email/read", method: "PUT", json: Body(emailIds: emailIds))
    }

    func resolveDefaultWorkspace() async throws -> Int {
        try await resolveWorkspaceResolution().defaultWorkspaceId
    }

    func resolveWorkspaceResolution() async throws -> WorkspaceResolution {
        try await request("/v3/workspaces/resolve", method: "GET")
    }

    func mutateCanonicalMail(email: EmailMessage,
                             workspaceId: Int,
                             action: String,
                             value: CanonicalMutationValue,
                             scope: String = "message",
                             sourceSurface: String,
                             idempotencyKey: String) async throws -> CanonicalMutationReceipt {
        struct Body: Encodable {
            let workspaceId: Int
            let idempotencyKey: String
            let target: CanonicalMutationTarget
            let action: String
            let value: CanonicalMutationValue
            let scope: String
            let expectedVersion: Int
            let sourceSurface: String
        }
        guard let accountId = email.accountId else { throw APIError(code: -4, message: "Canonical account target is unavailable.") }
        let body = Body(
            workspaceId: workspaceId,
            idempotencyKey: idempotencyKey,
            target: CanonicalMutationTarget(
                accountId: accountId,
                messageId: email.emailId,
                providerMessageId: email.externalMessageId ?? "",
                conversationId: email.threadId ?? ""
            ),
            action: action,
            value: value,
            scope: scope,
            expectedVersion: email.stateVersion ?? 1,
            sourceSurface: sourceSurface
        )
        return try await request("/v3/mail/state", method: "PUT", json: body, strictPayload: true)
    }

    func canonicalMailState(workspaceId: Int, accountId: Int, messageId: Int) async throws -> CanonicalMailState? {
        // Do not embed a query string in `path`: `appendingPathComponent` would
        // percent-encode it and the Worker route would never receive the
        // canonical target parameters.
        let (data, _) = try await perform(
            "/v3/mail/state",
            method: "GET",
            query: [
                URLQueryItem(name: "workspace_id", value: String(workspaceId)),
                URLQueryItem(name: "account_id", value: String(accountId)),
                URLQueryItem(name: "message_id", value: String(messageId))
            ],
            json: nil,
            authed: true
        )
        let envelope = try decoder.decode(APIEnvelope<CanonicalMailState?>.self, from: data)
        guard envelope.code == 200 else {
            if envelope.code == 401 { throw APIError.unauthorized }
            throw APIError(code: envelope.code, message: envelope.message ?? "Canonical state is unavailable.")
        }
        return envelope.data ?? nil
    }

    func submitLocalMailEvidence(email: EmailMessage,
                                 workspaceId: Int,
                                 evidence: LocalMailSemanticEvidence) async throws -> LocalEvidencePolicyResult {
        struct Body: Encodable {
            let workspaceId: Int
            let accountId: Int
            let messageId: Int
            let evidence: LocalMailSemanticEvidence
        }
        guard let accountId = email.accountId else { throw APIError(code: -4, message: "Local evidence account target is unavailable.") }
        return try await request(
            "/v3/mail/local-evidence",
            method: "POST",
            json: Body(workspaceId: workspaceId, accountId: accountId, messageId: email.emailId, evidence: evidence),
            strictPayload: true
        )
    }

    func star(emailId: Int) async throws {
        struct Body: Encodable { let emailId: Int }
        try await requestVoid("/star/add", method: "POST", json: Body(emailId: emailId))
    }

    func unstar(emailId: Int) async throws {
        try await requestVoid("/star/cancel", method: "DELETE",
                              query: [URLQueryItem(name: "emailId", value: String(emailId))])
    }

    func delete(emailIds: [Int]) async throws {
        let csv = emailIds.map(String.init).joined(separator: ",")
        try await requestVoid("/email/delete", method: "DELETE",
                              query: [URLQueryItem(name: "emailIds", value: csv)])
    }

    func move(emailIds: [Int], folder: LocalMailBoxKind) async throws {
        struct Body: Encodable { let emailIds: [Int]; let folder: String }
        try await requestVoid("/email/move", method: "PUT", json: Body(emailIds: emailIds, folder: folder.rawValue))
    }

    func send(_ form: SendEmailForm) async throws -> SendEmailResult {
        try await request(
            "/email/send",
            method: "POST",
            json: form,
            sessionOverride: sendSession,
            requestTimeout: 20
        )
    }

    func logout() async throws {
        try? await requestVoid("/logout", method: "DELETE")
    }

    func discoverIdentity(email: String) async throws -> EmailDiscoveryResponse {
        try await request(
            "/auth/email-discovery",
            method: "GET",
            query: [URLQueryItem(name: "email", value: email)],
            authed: false
        )
    }

    func assertProductionBackend(domain: String) async throws {
        let normalizedDomain = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedDomain.isEmpty else {
            throw APIError(code: -20, message: "A domain is required to verify the production mail backend.")
        }
        let probe = "probe@\(normalizedDomain)"
        do {
            _ = try await discoverIdentity(email: probe)
        } catch {
            throw APIError(code: -20, message: "NEXORA is not connected to the production mail backend. Sending is disabled until the real mail service is selected.")
        }
    }

    func beginProvisioningAuthHandoff(email: String, domain: String, provider: String, deviceReference: String) async throws -> ProvisioningAuthChallengeResponse {
        struct Body: Encodable { let email: String; let domain: String; let provider: String; let deviceReference: String }
        return try await request(
            "/auth/provisioning-handoff", method: "POST",
            json: Body(email: email, domain: domain, provider: provider, deviceReference: deviceReference), authed: false)
    }

    func createProvisioningContinuation(email: String, domain: String, provider: String, deviceReference: String, challengeReference: String) async throws -> ProvisioningContinuationResponse {
        struct Body: Encodable {
            let email: String
            let domain: String
            let provider: String
            let deviceReference: String
            let challengeReference: String
        }
        return try await request(
            "/auth/provisioning-continuation", method: "POST",
            json: Body(email: email, domain: domain, provider: provider, deviceReference: deviceReference, challengeReference: challengeReference), authed: true)
    }

    func bootstrapIdentity(email: String, continuationToken: String? = nil, provider: String? = nil, deviceReference: String? = nil) async throws -> BootstrapIdentityResponse {
        struct Body: Encodable {
            let email: String
            let continuationToken: String?
            let provider: String?
            let deviceReference: String?
        }
        return try await request(
            "/auth/bootstrap-from-routing", method: "POST",
            json: Body(email: email, continuationToken: continuationToken, provider: provider, deviceReference: deviceReference),
            authed: continuationToken != nil)
    }

    func activateIdentity(token: String, password: String) async throws -> ActivationResponse {
        struct Body: Encodable { let token: String; let password: String }
        return try await request(
            "/auth/activate", method: "POST", json: Body(token: token, password: password), authed: false)
    }

    func aiConsent() async throws -> AIConsent {
        try await request("/v2/ai/consent", method: "GET")
    }

    func updateAIConsent(_ consent: AIConsent) async throws -> AIConsent {
        try await request("/v2/ai/consent", method: "PUT", json: consent)
    }

    func aiProviderReadiness() async throws -> [String: AIProviderReadiness] {
        try await request("/v2/ai/providers", method: "GET")
    }

    func nexoraV3ProviderCapabilities() async throws -> [NexoraV3ProviderCapability] {
        try await request("/v3/providers/capabilities", method: "GET")
    }

    func nexoraV3MaximizeAuthority(provider: String, grantedScopes: [String] = []) async throws -> NexoraV3Authority {
        struct Body: Encodable {
            let provider: String
            let features: [String]
            let grantedScopes: [String]
            enum CodingKeys: String, CodingKey { case provider, features; case grantedScopes = "granted_scopes" }
        }
        return try await request(
            "/v3/authority/maximize", method: "POST",
            json: Body(provider: provider, features: ["domain_autonomy", "mail", "calendar", "organization", "provisioning", "aliases"], grantedScopes: grantedScopes)
        )
    }

    func nexoraV3Onboarding(emailOrDomain: String) async throws -> NexoraV3Onboarding {
        struct Body: Encodable {
            let emailOrDomain: String
            enum CodingKeys: String, CodingKey { case emailOrDomain = "email_or_domain" }
        }
        return try await request("/v3/onboarding", method: "POST", json: Body(emailOrDomain: emailOrDomain))
    }

    func unifiedAccounts() async throws -> [UnifiedMailAccount] {
        try await request("/v2/accounts", method: "GET")
    }

    func authorizeMailbox(email: String, password: String) async throws -> MailboxAuthorizationResponse {
        struct Body: Encodable { let email: String; let password: String }
        return try await request(
            "/v2/mailbox-authorizations",
            method: "POST",
            json: Body(email: email, password: password),
            strictPayload: true
        )
    }

    func removeMailboxAuthorization(id: Int) async throws -> MailboxAuthorizationResponse {
        try await request("/v2/mailbox-authorizations/\(id)", method: "DELETE")
    }

    func geminiOAuthStatus() async throws -> GeminiOAuthStatus {
        try await request("/v2/ai/gemini/status", method: "GET")
    }

    func startGeminiOAuth() async throws -> GeminiOAuthStatus {
        try await request("/v2/ai/gemini/oauth/start", method: "GET")
    }

    func startGoogleMailboxOAuth(email: String, device: String, accountId: Int? = nil) async throws -> GeminiOAuthStatus {
        var query = [
            URLQueryItem(name: "gmail", value: email),
            URLQueryItem(name: "device", value: device)
        ]
        if let accountId, accountId > 0 {
            query.append(URLQueryItem(name: "accountId", value: "\(accountId)"))
        }
        return try await request(
            "/v2/google/mail/oauth/start",
            method: "GET",
            query: query
        )
    }

    func disconnectGeminiOAuth() async throws -> GeminiOAuthStatus {
        try await request("/v2/ai/gemini/disconnect", method: "POST")
    }

    func googleTestUserDashboard() async throws -> GoogleTestUserDashboard {
        try await request("/v2/admin/google-test-user-requests/dashboard", method: "GET")
    }

    func googleTestUserRequests(status: String? = nil) async throws -> [GoogleTestUserRequest] {
        let query = status.map { [URLQueryItem(name: "status", value: $0)] } ?? []
        return try await request("/v2/admin/google-test-user-requests", method: "GET", query: query)
    }

    func approveAllGoogleTestUsers() async throws -> GoogleTestUserBulkResult {
        try await request("/v2/admin/google-test-user-requests/approve-all", method: "POST")
    }

    func updateGoogleTestUserRequests(ids: [Int], status: String, notes: String? = nil) async throws -> GoogleTestUserBulkResult {
        struct Body: Encodable { let ids: [Int]; let status: String; let notes: String? }
        return try await request(
            "/v2/admin/google-test-user-requests/status",
            method: "POST",
            json: Body(ids: ids, status: status, notes: notes)
        )
    }

    func markGoogleTestUsersSynced(ids: [Int], notes: String? = nil) async throws -> GoogleTestUserBulkResult {
        struct Body: Encodable { let ids: [Int]; let googleSyncNotes: String? }
        return try await request(
            "/v2/admin/google-test-user-requests/google-synced",
            method: "POST",
            json: Body(ids: ids, googleSyncNotes: notes)
        )
    }

    func googleTestUserGmailList(status: String = "approved_waiting_google_sync") async throws -> GoogleTestUserGmailList {
        try await request(
            "/v2/admin/google-test-user-requests/gmail-list",
            method: "GET",
            query: [URLQueryItem(name: "status", value: status)]
        )
    }

    func googleTestUserReport(period: String) async throws -> String {
        try await requestText(
            "/v2/admin/google-test-user-requests/report.md",
            method: "GET",
            query: [URLQueryItem(name: "period", value: period)]
        )
    }

    func requestGoogleTestUserAccess(email: String, device: String) async throws -> GoogleTestUserAccessRequestResult {
        struct Body: Encodable {
            let gmail: String
            let device: String
            let notes: String
        }
        return try await request(
            "/v2/google-test-user-requests/request",
            method: "POST",
            json: Body(gmail: email, device: device, notes: "Requested from NEXORA iOS OAuth diagnostics.")
        )
    }

    func forwardingSettings(email: String? = nil) async throws -> ForwardingSettingsResponse {
        let query = email.map { [URLQueryItem(name: "email", value: $0)] } ?? []
        return try await request("/v2/forwarding-settings", method: "GET", query: query)
    }

    func connectGmail(email: String, appPassword: String) async throws -> GmailConnectResponse {
        struct Body: Encodable { let email: String; let appPassword: String }
        return try await request(
            "/gmail/connect",
            method: "POST",
            json: Body(email: email, appPassword: appPassword),
            strictPayload: true
        )
    }

    func syncGmail(accountId: Int, limit: Int = 50) async throws -> GmailSyncResponse {
        struct Body: Encodable { let accountId: Int; let limit: Int }
        return try await request("/gmail/sync", method: "POST", json: Body(accountId: accountId, limit: limit))
    }

    func analyzeSecurity(sender: String, subject: String, body: String, html: String?) async throws -> SecurityAnalysis {
        struct Body: Encodable {
            let sender: String
            let subject: String
            let body: String
            let html: String?
        }
        return try await request(
            "/v2/security/analyze",
            method: "POST",
            json: Body(sender: sender, subject: subject, body: body, html: html)
        )
    }

    func secureSend(body: String, expiresInSeconds: Int) async throws -> SecureSendResponse {
        struct Body: Encodable { let body: String; let expiresInSeconds: Int }
        return try await request(
            "/v2/secure-send",
            method: "POST",
            json: Body(body: body, expiresInSeconds: expiresInSeconds)
        )
    }

    func aiRuntimePreflight(providerID: String,
                            methodID: String,
                            modelAlias: String,
                            syntheticPromptClass: String) async throws -> AIRuntimePreflightResult {
        struct Body: Encodable {
            let providerId: String
            let methodId: String
            let modelAlias: String
            let syntheticPromptClass: String
        }
        return try await request(
            "/v4/ai/runtime/preflight",
            method: "POST",
            json: Body(
                providerId: providerID,
                methodId: methodID,
                modelAlias: modelAlias,
                syntheticPromptClass: syntheticPromptClass
            )
        )
    }

    func aiWorkspaceAction(_ action: AIWorkspaceSyntheticAction, providerID: AIProviderID? = nil) async throws -> AIWorkspaceActionResult {
        struct Body: Encodable {
            let action: String
            let providerId: String?
        }
        return try await request(
            "/v4/ai/workspace/action",
            method: "POST",
            json: Body(action: action.rawValue, providerId: providerID?.backendProviderID)
        )
    }

    // MARK: - Request plumbing

    /// A loosely-typed paged container in case the backend wraps lists.
    private struct Paged<E: Decodable>: Decodable {
        let list: [E]
        enum CodingKeys: String, CodingKey { case list, records, rows }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let l = try? c.decode([E].self, forKey: .list) { list = l }
            else if let l = try? c.decode([E].self, forKey: .records) { list = l }
            else if let l = try? c.decode([E].self, forKey: .rows) { list = l }
            else { list = [] }
        }
    }

    private struct LossyPaged<E: Decodable>: Decodable {
        let list: [E]
        let skipped: Int

        enum CodingKeys: String, CodingKey { case list, records, rows }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let payload = try? c.decode(LossyDecodableArray<E>.self, forKey: .list) {
                list = payload.values
                skipped = payload.skipped
            } else if let payload = try? c.decode(LossyDecodableArray<E>.self, forKey: .records) {
                list = payload.values
                skipped = payload.skipped
            } else if let payload = try? c.decode(LossyDecodableArray<E>.self, forKey: .rows) {
                list = payload.values
                skipped = payload.skipped
            } else {
                list = []
                skipped = 0
            }
        }
    }

    private struct APIStatusEnvelope: Decodable {
        let code: Int
        let message: String?

        enum CodingKeys: String, CodingKey {
            case code
            case message
            case error
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let intCode = try? c.decode(Int.self, forKey: .code) {
                code = intCode
            } else if let stringCode = try? c.decode(String.self, forKey: .code),
                      let parsedCode = Int(stringCode) {
                code = parsedCode
            } else {
                code = 500
            }
            message = (try? c.decode(String.self, forKey: .message))
                ?? (try? c.decode(String.self, forKey: .error))
        }
    }

    private func request<T: Decodable>(_ path: String,
                                       method: String,
                                       query: [URLQueryItem] = [],
                                       json: Encodable? = nil,
                                       authed: Bool = true,
                                       strictPayload: Bool = false,
                                       sessionOverride: URLSession? = nil,
                                       requestTimeout: TimeInterval? = nil) async throws -> T {
        let (data, _) = try await perform(
            path,
            method: method,
            query: query,
            json: json,
            authed: authed,
            sessionOverride: sessionOverride,
            requestTimeout: requestTimeout
        )
        if let status = try? decoder.decode(APIStatusEnvelope.self, from: data),
           status.code != 200 {
            if status.code == 401, authed { throw APIError.unauthorized }
            throw APIError(code: status.code, message: status.message ?? "Request failed")
        }
        let envelope: APIEnvelope<T>
        do {
            envelope = try decoder.decode(APIEnvelope<T>.self, from: data)
        } catch {
            if strictPayload {
                throw APIError(code: -3, message: "NEXORA could not read the server response.")
            }
            throw error
        }
        guard envelope.code == 200 else {
            if envelope.code == 401, authed { throw APIError.unauthorized }
            throw APIError(code: envelope.code, message: envelope.message ?? "Request failed")
        }
        guard let payload = envelope.data else {
            // Some endpoints legitimately return null data; if caller expected a value, surface it.
            if let empty = EmptyDecodable() as? T { return empty }
            throw APIError(code: envelope.code, message: "Empty response")
        }
        return payload
    }

    private func requestVoid(_ path: String,
                             method: String,
                             query: [URLQueryItem] = [],
                             json: Encodable? = nil) async throws {
        let (data, _) = try await perform(path, method: method, query: query, json: json, authed: true)
        // Decode just the code to detect auth failures; ignore data.
        if let env = try? decoder.decode(APIEnvelope<EmptyDecodable>.self, from: data) {
            guard env.code == 200 else {
                if env.code == 401 { throw APIError.unauthorized }
                throw APIError(code: env.code, message: env.message ?? "Request failed")
            }
        }
    }

    private func requestText(_ path: String,
                             method: String,
                             query: [URLQueryItem] = [],
                             json: Encodable? = nil,
                             authed: Bool = true) async throws -> String {
        let (data, _) = try await perform(path, method: method, query: query, json: json, authed: authed)
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func perform(_ path: String,
                         method: String,
                         query: [URLQueryItem],
                         json: Encodable?,
                         authed: Bool,
                         sessionOverride: URLSession? = nil,
                         requestTimeout: TimeInterval? = nil) async throws -> (Data, URLResponse) {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("api").appendingPathComponent(String(path.dropFirst())),
            resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.notConfigured }

        var req = URLRequest(url: url)
        req.httpMethod = method
        if let requestTimeout {
            req.timeoutInterval = requestTimeout
        }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authed {
            guard let token, !token.isEmpty else { throw APIError.unauthorized }
            // cloud-mail expects the raw token, not "Bearer <token>".
            req.setValue(token, forHTTPHeaderField: "Authorization")
        }
        if let json {
            req.httpBody = try encoder.encode(AnyEncodable(json))
        }

        do {
            let activeSession = sessionOverride ?? session
            let (data, response) = try await activeSession.data(for: req)
            if let http = response as? HTTPURLResponse, http.statusCode == 401 {
                throw APIError.unauthorized
            }
            return (data, response)
        } catch let err as APIError {
            throw err
        } catch {
            throw APIError.transport(error)
        }
    }
}

// MARK: - Encodable type-erasure & empty payloads

struct EmptyDecodable: Decodable {}

struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { self.encodeFunc = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFunc(encoder) }
}
