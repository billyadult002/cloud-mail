//
//  GeminiProvider.swift
//  GlassMail
//
//  Gemini cloud execution is intentionally disabled in the client. CloudMail
//  only allows provider execution through the backend-held runtime credential
//  reference path after synthetic preflight.
//

import Foundation

struct GeminiProvider: AIProvider {
    var displayName: String { "Gemini" }

    static let model = "gemini-2.5-flash"

    func isReady() async -> Bool { false }

    func triage(subject: String, from: String, body: String) async throws -> MailTriage {
        throw unavailable()
    }

    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> String {
        throw unavailable()
    }

    func complete(instructions: String, prompt: String) async throws -> String {
        throw unavailable()
    }

    private func unavailable() -> AIError {
        AIError.unavailable("Gemini account authorization is not available in this build. Cloud provider execution requires backend-held runtime authorization.")
    }
}
