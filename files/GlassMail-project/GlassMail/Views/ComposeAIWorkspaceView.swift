//
//  ComposeAIWorkspaceView.swift
//  GlassMail
//

import SwiftUI

struct ComposeAIWorkspaceView: View {
    let ready: Bool
    let disabledReason: String?
    let isGenerating: Bool
    let lastExecution: AIExecutionMetadata?
    let run: (String) -> Void

    private var state: ExecutionState {
        if isGenerating { return .generating }
        return ready ? .ready : .blocked
    }

    var body: some View {
        CMWorkspaceShell(
            title: "Compose AI Workspace",
            subtitle: "Rewrite, shorten, formalize, translate, and tune tone using composer text only.",
            state: state
        ) {
            if let disabledReason, !ready {
                CMOutputPanel(title: "Runtime", text: disabledReason)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                action("Rewrite", "wand.and.stars", "Rewrite this draft clearly.")
                action("Shorten", "text.badge.minus", "Shorten this draft while preserving details.")
                action("Formalize", "briefcase", "Rewrite this draft in a professional formal tone.")
                action("Translate", "character.book.closed", "Translate this draft into Chinese.")
                action("Tone", "slider.horizontal.3", "Make this draft warm and friendly.")
            }
            if let lastExecution {
                AIExecutionInlineView(metadata: lastExecution)
            }
            CMAuditPanel(audit: .preserved)
        }
    }

    private func action(_ title: String, _ symbol: String, _ instruction: String) -> some View {
        Button {
            run(instruction)
        } label: {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .disabled(!ready || isGenerating)
    }
}
