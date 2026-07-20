import XCTest

final class ServerCorrelationTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testVerifiedRequiresMatchingServerAuthorityTuple() {
        let receipt = interaction()
        let record = classification()

        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: receipt,
            classification: record,
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .verified)
    }

    func testWorkspaceMismatchFailsClosed() {
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: interaction(),
            classification: classification(),
            expectedWorkspaceId: 8,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .scopeMismatch)
    }

    func testAccountMismatchFailsClosed() {
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: interaction(),
            classification: classification(accountId: 99),
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .scopeMismatch)
    }

    func testHistoricalEvidenceCorrelationRefDoesNotNeedToMatchFreshSession() {
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: interaction(),
            classification: classification(acceptanceSessionId: "other-session"),
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .verified)
    }

    func testCorrelationFingerprintMismatchFailsClosed() {
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: interaction(),
            classification: classification(messageFingerprint: "different-fingerprint"),
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .scopeMismatch)
    }

    func testMissingEvidenceCannotVerify() {
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: interaction(),
            classification: classification(evidenceRef: ""),
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now
        )

        XCTAssertEqual(result, .failed)
    }

    func testPendingServerAuthorityFieldsCannotVerify() {
        let pending = AcceptanceSessionReceipt(
            id: "acceptance-1",
            challenge: "memory-only-challenge",
            status: "ISSUED",
            expiresAt: "2027-01-15T08:05:00Z",
            platform: "IOS_PHYSICAL",
            buildId: "303",
            buildVersion: "3.03",
            runtimeDeploymentId: "worker-1",
            requestId: nil,
            workspaceId: nil,
            canonicalAccountId: nil,
            serverTimestamp: nil,
            correlation: nil
        )

        XCTAssertEqual(
            ServerCorrelationEvaluator.evaluate(
                acceptanceSession: pending,
                classification: classification(),
                expectedWorkspaceId: 7,
                expectedAccountId: 42,
                now: now
            ),
            .failed
        )
    }

    func testExpiredReceiptIsCachedNotVerified() {
        let stale = interaction(serverTimestamp: "2026-01-01T00:00:00Z")
        let result = ServerCorrelationEvaluator.evaluate(
            acceptanceSession: stale,
            classification: classification(),
            expectedWorkspaceId: 7,
            expectedAccountId: 42,
            now: now,
            freshnessWindow: 60
        )

        XCTAssertEqual(result, .cached)
    }

    func testRequestContainsOnlyApprovedBodylessFields() throws {
        let request = AcceptanceSessionRequest(accountId: 42, buildId: "303", buildVersion: "3.03", idempotencyKey: "nonce")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])

        XCTAssertEqual(Set(object.keys), ["accountId", "platform", "buildId", "buildVersion", "idempotencyKey"])
        XCTAssertNil(object["workspaceId"])
        XCTAssertNil(object["tenantId"])
        XCTAssertNil(object["provider"])
        XCTAssertNil(object["domain"])
        XCTAssertNil(object["message"])
    }

    func testConsumeRequestContainsOnlyChallengeAndClassificationId() throws {
        let request = AcceptanceSessionConsumeRequest(
            challenge: "memory-only-challenge",
            classificationId: "classification-redacted"
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])

        XCTAssertEqual(Set(object.keys), ["challenge", "classificationId"])
    }

    func testDecodesConsumedSessionWorkerShapeWithoutChallenge() throws {
        let json = #"{"id":"acceptance-1","tenantId":7,"workspaceId":7,"actorUserId":7,"canonicalAccountId":42,"platform":"IOS_PHYSICAL","buildId":"303","buildVersion":"3.03","runtimeDeploymentId":"worker-1","status":"CONSUMED","requestId":"request-1","serverTimestamp":"2027-01-15T08:00:00Z","issuedAt":"2027-01-15T07:59:30Z","expiresAt":"2027-01-15T08:05:00Z","consumedAt":"2027-01-15T08:00:00Z","correlation":{"eventId":"event-1","classificationId":"classification-redacted","classificationEvidenceRef":"evidence-id-redacted","messageFingerprint":"fingerprint-redacted","authorityTupleDigest":"digest","eventDigest":"event-digest","occurredAt":"2027-01-15T08:00:00Z"}}"#
        let receipt = try workerDecoder.decode(AcceptanceSessionReceipt.self, from: Data(json.utf8))

        XCTAssertNil(receipt.challenge)
        XCTAssertEqual(receipt.status, "CONSUMED")
        XCTAssertEqual(receipt.correlation?.classificationId, "classification-redacted")
    }

    func testDecodesClassificationReadbackWorkerShape() throws {
        let json = #"{"classification":{"id":"classification-redacted","messageFingerprint":"fingerprint-redacted","evidenceRef":"entry-digest","primaryCategory":"BUSINESS","authoritySource":"DETERMINISTIC_RULES","classifiedAt":"2027-01-14T08:00:00Z"},"provenance":{"canonicalMessageId":1001,"canonicalAccountId":42,"sourceCreatedAt":"2027-01-14T07:59:00Z","provenanceRef":"provenance-redacted","bodyPersisted":false},"evidence":[{"evidenceId":"evidence-id-redacted","observedAt":"2027-01-14T08:00:00Z","requestId":"old-request","runtimeDeploymentId":"old-worker","acceptanceCorrelationRef":"historical-session"}]}"#
        let record = try workerDecoder.decode(ClassificationRecordReadback.self, from: Data(json.utf8))

        XCTAssertEqual(record.classification.id, "classification-redacted")
        XCTAssertEqual(record.classification.messageFingerprint, "fingerprint-redacted")
        XCTAssertEqual(record.evidence.last?.acceptanceCorrelationRef, "historical-session")
    }

    func testCurrentWorkerShapeWithoutMessageFingerprintFailsClosed() throws {
        let json = #"{"classification":{"id":"classification-redacted","evidenceRef":"entry-digest","primaryCategory":"BUSINESS","authoritySource":"DETERMINISTIC_RULES","classifiedAt":"2027-01-14T08:00:00Z"},"provenance":{"canonicalMessageId":1001,"canonicalAccountId":42,"sourceCreatedAt":"2027-01-14T07:59:00Z","provenanceRef":"provenance-redacted","bodyPersisted":false},"evidence":[{"evidenceId":"evidence-id-redacted","observedAt":"2027-01-14T08:00:00Z","requestId":"old-request","runtimeDeploymentId":"old-worker","acceptanceCorrelationRef":"historical-session"}]}"#
        let record = try workerDecoder.decode(ClassificationRecordReadback.self, from: Data(json.utf8))

        XCTAssertNil(record.classification.messageFingerprint)
        XCTAssertEqual(
            ServerCorrelationEvaluator.evaluate(
                acceptanceSession: interaction(),
                classification: record,
                expectedWorkspaceId: 7,
                expectedAccountId: 42,
                now: now
            ),
            .scopeMismatch
        )
    }

    private var workerDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    private func interaction(serverTimestamp: String = "2027-01-15T08:00:00Z") -> AcceptanceSessionReceipt {
        AcceptanceSessionReceipt(
            id: "acceptance-1",
            challenge: "memory-only-challenge",
            status: "CONSUMED",
            expiresAt: "2027-01-15T08:05:00Z",
            platform: "IOS_PHYSICAL",
            buildId: "303",
            buildVersion: "3.03",
            runtimeDeploymentId: "worker-1",
            requestId: "request-1",
            workspaceId: 7,
            canonicalAccountId: 42,
            serverTimestamp: serverTimestamp,
            correlation: AcceptanceSessionCorrelation(
                eventId: "event-1",
                classificationId: "classification-redacted",
                classificationEvidenceRef: "evidence-id-redacted",
                messageFingerprint: "fingerprint-redacted",
                occurredAt: "2027-01-15T08:00:00Z"
            )
        )
    }

    private func classification(
        acceptanceSessionId: String = "acceptance-1",
        accountId: Int = 42,
        evidenceRef: String = "evidence-redacted",
        messageFingerprint: String? = "fingerprint-redacted"
    ) -> ClassificationRecordReadback {
        ClassificationRecordReadback(
            classification: ClassificationReadbackDecision(
                id: "classification-redacted",
                messageFingerprint: messageFingerprint,
                evidenceRef: evidenceRef,
                primaryCategory: "BUSINESS",
                authoritySource: "DETERMINISTIC_RULES",
                classifiedAt: "2027-01-15T08:00:00Z"
            ),
            provenance: ClassificationReadbackProvenance(
                canonicalMessageId: 1001,
                canonicalAccountId: accountId,
                sourceCreatedAt: "2027-01-15T07:59:00Z",
                provenanceRef: "provenance-redacted",
                bodyPersisted: false
            ),
            evidence: [ClassificationReadbackEvidence(
                evidenceId: "evidence-id-redacted",
                observedAt: "2027-01-15T08:00:00Z",
                requestId: "classification-request",
                runtimeDeploymentId: "worker-1",
                acceptanceCorrelationRef: acceptanceSessionId
            )]
        )
    }
}
