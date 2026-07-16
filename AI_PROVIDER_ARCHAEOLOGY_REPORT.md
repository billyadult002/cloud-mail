# AI Provider Archaeology Report

## Findings

- `NexoraAgentEngine` exists in `MailOSV2Productivity.swift` and is instantiated by `AppState`.
- `AIRouter` and `AIProviderRegistry` remain active in `AIProvider.swift`; they are not dead code.
- Gemini OAuth is an active mailbox authorization path in `Backend.swift` and Worker services.
- ChatGPT/Claude/Copilot/Grok entries remain as unavailable/future metadata; they are visible in registry contracts even when not executable.
- Worker `provider-runtime-config-loader.js` retains provider feature flags and runtime metadata.

Decision: **no blind deletion**. Active Gemini mailbox OAuth and the user-visible provider truth contract must be preserved. Future provider metadata should be migrated behind one `NexoraAgentEngine` contract in a separate approved change.
