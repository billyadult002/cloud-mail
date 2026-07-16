//
//  MailboxDetailView.swift
//  GlassMail
//

import SwiftUI

struct MailboxDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var app: AppState

    let row: MailboxHealthSnapshot
    let trust: MailDataTrustSnapshot
    let sync: MailSyncObservabilitySnapshot

    var body: some View {
        NavigationStack {
            List {
                Section {
                    CompactAccountPillView()
                }
                .listRowBackground(Color.clear)

                Section("Mailbox") {
                    detailRow("Name", row.account)
                    detailRow("Provider", row.provider.title)
                    detailRow("Source", row.mailboxSource)
                    detailRow("Domain", row.domain)
                    detailRow("Connected Status", row.state.rawValue)
                    detailRow("Authorization Health", row.authorizationLabel)
                }

                Section("Messages") {
                    detailRow("Visible Messages", "\(row.visibleMessages)")
                    detailRow("Indexed Messages", "\(row.indexedMessages)")
                    detailRow("Current Filter", trust.currentFilter)
                    detailRow("Data Freshness", trust.dataFreshness)
                }

                Section("Sync Health") {
                    detailRow("Current Sync State", sync.currentSyncState)
                    detailRow("Last Successful Sync", sync.lastSuccessfulSync)
                    detailRow("Last Failed Sync", sync.lastFailedSync)
                    detailRow("Retry Countdown", sync.retryCountdown)
                    detailRow("Sync Progress", sync.syncProgress)
                    detailRow("Queue Depth", sync.queueDepth)
                    detailRow("Latency", sync.latency)
                    detailRow("Last Error", sync.lastError)
                }

                Section("Recent Sync Events") {
                    detailRow("Refresh", app.isLoading ? "Running" : "Idle")
                    detailRow("Older Mail Fetch", app.isLoadingMore ? "Running" : "Idle")
                    detailRow("Mailbox Onboarding", app.mailboxOnboardingState.rawValue)
                }

                Section("Audit Summary") {
                    detailRow("Identity", trust.currentIdentity)
                    detailRow("Sources", trust.mailboxSources)
                    detailRow("Cross Account Access", "false")
                    detailRow("Provider Ownership", "user_owned")
                }

                Section {
                    Button {
                        Task { await app.refresh() }
                    } label: {
                        Label("Refresh Mailbox", systemImage: "arrow.clockwise")
                    }
                }
            }
            .navigationTitle("Mailbox Detail")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value.isEmpty ? "None" : value)
                .font(.caption)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(value.isEmpty ? "None" : value)")
    }
}
