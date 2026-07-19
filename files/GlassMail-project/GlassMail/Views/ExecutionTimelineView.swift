//
//  ExecutionTimelineView.swift
//  GlassMail
//

import SwiftUI

struct ExecutionTimelineView: View {
    let history: [HistoryState]

    var body: some View {
        CMWorkspaceShell(
            title: "Execution Timeline",
            subtitle: "Draft, ready, running, review, completed, failed, and blocked states.",
            state: history.last?.state ?? .notStarted
        ) {
            CMExecutionTimeline(items: history)
        }
    }
}
