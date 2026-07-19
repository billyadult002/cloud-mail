//
//  ArtifactCenterView.swift
//  GlassMail
//

import SwiftUI

struct ArtifactCenterView: View {
    let artifacts: [Artifact]

    var body: some View {
        CMWorkspaceShell(
            title: "Artifact Center",
            subtitle: "Results from AI Workspace, AI Briefing, Compose, and Command Palette.",
            state: artifacts.isEmpty ? .notStarted : .ready
        ) {
            CMArtifactCenter(artifacts: artifacts)
            CMAuditPanel(audit: .preserved)
        }
    }
}
