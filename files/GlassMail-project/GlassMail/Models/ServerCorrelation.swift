import Foundation

struct AcceptanceSessionRequest: Encodable, Equatable {
    let accountId: Int
    let platform: String
    let buildId: String?
    let buildVersion: String?
    let idempotencyKey: String?

    init(accountId: Int, buildId: String?, buildVersion: String?, idempotencyKey: String?) {
        self.accountId = accountId
        self.platform = "IOS_PHYSICAL"
        self.buildId = buildId
        self.buildVersion = buildVersion
        self.idempotencyKey = idempotencyKey
    }
}

struct AcceptanceSessionReceipt: Decodable, Equatable {
    let id: String
    let challenge: String?
    let status: String
    let expiresAt: String
    let platform: String
    let buildId: String?
    let buildVersion: String?
    let runtimeDeploymentId: String
    let requestId: String?
    let workspaceId: Int?
    let canonicalAccountId: Int?
    let serverTimestamp: String?
    let correlation: AcceptanceSessionCorrelation?
}

struct AcceptanceSessionCorrelation: Decodable, Equatable {
    let eventId: String
    let classificationId: String
    let classificationEvidenceRef: String
    let messageFingerprint: String
    let occurredAt: String
}

struct AcceptanceSessionConsumeRequest: Encodable, Equatable {
    let challenge: String
    let classificationId: String
}

struct ClassificationRecordReadback: Decodable, Equatable {
    let classification: ClassificationReadbackDecision
    let provenance: ClassificationReadbackProvenance
    let evidence: [ClassificationReadbackEvidence]
}

struct ClassificationReadbackDecision: Decodable, Equatable {
    let id: String
    let messageFingerprint: String?
    let evidenceRef: String
    let primaryCategory: String
    let authoritySource: String
    let classifiedAt: String
}

struct ClassificationReadbackProvenance: Decodable, Equatable {
    let canonicalMessageId: Int
    let canonicalAccountId: Int
    let sourceCreatedAt: String
    let provenanceRef: String
    let bodyPersisted: Bool
}

struct ClassificationReadbackEvidence: Decodable, Equatable {
    let evidenceId: String
    let observedAt: String
    let requestId: String
    let runtimeDeploymentId: String
    let acceptanceCorrelationRef: String
}

enum ServerCorrelationPhase: String, Equatable {
    case checking
    case verified
    case cached
    case offline
    case failed
    case scopeMismatch
}

enum ServerCorrelationEvaluator {
    static func evaluate(
        acceptanceSession: AcceptanceSessionReceipt,
        classification: ClassificationRecordReadback,
        expectedWorkspaceId: Int,
        expectedAccountId: Int,
        now: Date = Date(),
        freshnessWindow: TimeInterval = 60
    ) -> ServerCorrelationPhase {
        guard let sessionWorkspaceId = acceptanceSession.workspaceId,
              let sessionAccountId = acceptanceSession.canonicalAccountId,
              let sessionCorrelation = acceptanceSession.correlation,
              let evidence = classification.evidence.last else {
            return .failed
        }
        guard sessionWorkspaceId == expectedWorkspaceId,
              sessionAccountId == expectedAccountId,
              classification.provenance.canonicalAccountId == expectedAccountId,
              sessionCorrelation.classificationId == classification.classification.id,
              sessionCorrelation.classificationEvidenceRef == evidence.evidenceId,
              sessionCorrelation.messageFingerprint == classification.classification.messageFingerprint else {
            return .scopeMismatch
        }
        guard !acceptanceSession.id.isEmpty,
              acceptanceSession.platform == "IOS_PHYSICAL",
              !["EXPIRED", "REVOKED", "FAILED"].contains(acceptanceSession.status.uppercased()),
              acceptanceSession.requestId?.isEmpty == false,
              !acceptanceSession.runtimeDeploymentId.isEmpty,
              acceptanceSession.status == "CONSUMED",
              !classification.classification.id.isEmpty,
              !sessionCorrelation.messageFingerprint.isEmpty,
              classification.classification.messageFingerprint?.isEmpty == false,
              !classification.classification.evidenceRef.isEmpty,
              !classification.classification.classifiedAt.isEmpty,
              !evidence.evidenceId.isEmpty,
              !evidence.requestId.isEmpty,
              !evidence.runtimeDeploymentId.isEmpty else {
            return .failed
        }
        guard let timestamp = acceptanceSession.serverTimestamp,
              let observedAt = parseServerDate(timestamp),
              let correlationObservedAt = parseServerDate(sessionCorrelation.occurredAt),
              let expiresAt = parseServerDate(acceptanceSession.expiresAt) else { return .failed }
        guard expiresAt >= now,
              abs(now.timeIntervalSince(observedAt)) <= freshnessWindow,
              abs(now.timeIntervalSince(correlationObservedAt)) <= freshnessWindow,
              abs(correlationObservedAt.timeIntervalSince(observedAt)) <= freshnessWindow else {
            return .cached
        }
        return .verified
    }

    static func parseServerDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}

struct ServerCorrelationSnapshot: Equatable {
    var phase: ServerCorrelationPhase
    var acceptanceSession: AcceptanceSessionReceipt?
    var classification: ClassificationRecordReadback?
    var lastVerifiedAt: Date?

    static let idle = ServerCorrelationSnapshot(
        phase: .offline,
        acceptanceSession: nil,
        classification: nil,
        lastVerifiedAt: nil
    )
}
