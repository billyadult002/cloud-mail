//
//  EmailDetailAICopilotView.swift
//  GlassMail
//

import SwiftUI

struct EmailDetailAICopilotView: View {
    let runtime: AIRuntimeStatusSnapshot
    let identityProvider: UnifiedMailProvider
    let identityLabel: String
    let canUseAI: Bool
    let isWorking: Bool
    let disabledReason: String?
    var summarize: () -> Void
    var draftReply: () -> Void
    var translate: () -> Void
    var createTask: () -> Void
    var createFollowUp: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "sparkles")
                    .foregroundStyle(identityProvider.identityColor)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text("AI Brief")
                        .font(.subheadline.weight(.semibold))
                    Text("\(runtime.title) · \(identityLabel)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if isWorking {
                    ProgressView().controlSize(.small)
                }
            }

            if let disabledReason, !canUseAI {
                Label(disabledReason, systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    copilotButton("Summarize", "text.bubble.fill", summarize)
                    copilotButton("Draft", "wand.and.stars", draftReply)
                    copilotButton("Translate", "character.book.closed.fill", translate)
                    copilotButton("Task", "checklist", createTask)
                    copilotButton("Follow Up", "clock.badge.checkmark.fill", createFollowUp)
                }
                .padding(.vertical, 1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(identityProvider.identityColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(identityProvider.identityColor.opacity(0.16), lineWidth: 1)
        )
    }

    private func copilotButton(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .frame(minWidth: 92)
        }
        .buttonStyle(.glass)
        .disabled(!canUseAI || isWorking)
        .help(disabledReason ?? title)
    }
}
