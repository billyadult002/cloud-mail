//
//  OpenAIProvider.swift
//  GlassMail
//
//  ChatGPT/OpenAI cloud execution is intentionally disabled in the client.
//  CloudMail only allows provider execution through the backend-held runtime
//  credential reference path after synthetic preflight.
//

import Foundation

// MARK: - Provider

struct OpenAIProvider: AIProvider {
    var displayName: String { "ChatGPT" }

    func isReady() async -> Bool {
        false
    }

    func triage(subject: String, from: String, body: String) async throws -> MailTriage {
        throw unavailable()
    }

    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> String {
        throw unavailable()
    }

    func complete(instructions: String, prompt: String) async throws -> String {
        throw unavailable()
    }

    static let jsonContract = """
    Respond with ONLY a JSON object, no markdown, of the exact shape:
    {"summary": string, "category": one of \
    ["Urgent","Personal","Work","Finance","Newsletter","Promotion","Social","Spam","Other"], \
    "actionRequired": boolean}
    """

    private func unavailable() -> AIError {
        AIError.unavailable("ChatGPT Cloud requires backend OpenAI credential reference setup and a safe synthetic smoke PASS before execution is enabled.")
    }
}

// MARK: - Shared JSON triage parser for cloud providers

enum CloudTriageParser {
    static func parse(_ raw: String) throws -> MailTriage {
        // Strip code fences if a model added them despite instructions.
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("```") {
            s = s.replacingOccurrences(of: "```json", with: "")
                 .replacingOccurrences(of: "```", with: "")
                 .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let data = s.data(using: .utf8),
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // Fall back: treat the whole thing as a summary.
            return MailTriage(summary: String(raw.prefix(280)),
                              category: .other, actionRequired: false, suggestedReply: nil)
        }
        let summary = (obj["summary"] as? String) ?? ""
        let catRaw = (obj["category"] as? String) ?? "Other"
        let action = (obj["actionRequired"] as? Bool) ?? false
        return MailTriage(summary: summary,
                          category: MailCategory(rawValue: catRaw) ?? .other,
                          actionRequired: action,
                          suggestedReply: nil)
    }
}
