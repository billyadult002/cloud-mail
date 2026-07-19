import Foundation

struct AnthropicProvider: AIProvider {
    static let keyKey = "anthropic_api_key"
    let displayName = "Claude"

    func isReady() async -> Bool { false }

    func triage(subject: String, from: String, body: String) async throws -> MailTriage {
        let raw = try await complete(
            instructions: AIPrompts.triageInstructions() + "\n" + OpenAIProvider.jsonContract,
            prompt: AIPrompts.emailContext(subject: subject, from: from, body: body)
        )
        return try CloudTriageParser.parse(raw)
    }

    func draftReply(subject: String, from: String, body: String, guidance: String?) async throws -> String {
        var prompt = AIPrompts.emailContext(subject: subject, from: from, body: body)
        if let guidance, !guidance.isEmpty { prompt += "\n\nGuidance: \(guidance)" }
        return try await complete(instructions: AIPrompts.replyInstructions(), prompt: prompt)
    }

    func complete(instructions: String, prompt: String) async throws -> String {
        throw AIError.unavailable("This cloud AI provider is not available in this build.")
    }
}
