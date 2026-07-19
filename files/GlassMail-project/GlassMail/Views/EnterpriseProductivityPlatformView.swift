//
//  EnterpriseProductivityPlatformView.swift
//  GlassMail
//
//  Local-first enterprise productivity surfaces. V1 intentionally derives
//  signals from the current CloudMail runtime and local governance ledger.
//

import SwiftUI

struct EnterpriseProductivityPlatformView: View {
    @EnvironmentObject private var app: AppState
    @State private var selectedArea: EnterprisePlatformArea = .hub
    @State private var query = ""
    @State private var selectedContactEmail: String?
    @State private var vipContacts: Set<String> = []
    @State private var starredContacts: Set<String> = []
    @State private var automationRules: [EnterpriseAutomationRule] = EnterpriseAutomationRule.seed
    @State private var productivityTasks: [EnterpriseProductivityTask] = []
    @State private var scheduledFollowUps: [EnterpriseProductivityTask] = []
    @State private var localAuditEvents: [String] = []
    @State private var actionFeedback: String?
    @State private var didBootstrap = false

    var body: some View {
        List {
            Section {
                Picker("Platform area", selection: $selectedArea) {
                    ForEach(EnterprisePlatformArea.allCases) { area in
                        Text(area.shortTitle).tag(area)
                    }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)

            switch selectedArea {
            case .hub:
                enterpriseHub
            case .directory:
                contactDirectory
            case .automation:
                automationCenter
            case .work:
                tasksCalendarCenter
            case .knowledge:
                knowledgeSearchCenter
            case .governance:
                auditComplianceCenter
            }
        }
        .searchable(text: $query, prompt: "Search enterprise graph")
        .cloudMailCompactMenuSurface()
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .navigationTitle("Enterprise Hub")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear(perform: bootstrapLocalState)
    }

    private var enterpriseHub: some View {
        Group {
            Section("NEXORA Enterprise Hub") {
                EnterpriseMetricGrid(items: [
                    ("Mail", "\(app.emails.count) loaded"),
                    ("Contacts", "\(contactGraph.count) ranked"),
                    ("Directory", "\(domainDirectory.count) domains"),
                    ("Tasks", "\(productivityTasks.count) local"),
                    ("Calendar", "\(scheduledFollowUps.count) follow-ups"),
                    ("Automation", "\(automationRules.count) rules"),
                    ("Governance", "\(app.localOAuthAccessRequests.count) requests"),
                    ("Audit", "\(totalAuditCount) events")
                ])
                Text("Mail, directory, automation, knowledge, tasks, calendar, governance, diagnostics, audit, and search are available from this unified surface.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Platform Navigation") {
                ForEach(EnterprisePlatformArea.allCases.filter { $0 != .hub }) { area in
                    Button {
                        selectedArea = area
                    } label: {
                        Label(area.title, systemImage: area.symbol)
                    }
                }
            }
        }
    }

    private var contactDirectory: some View {
        Group {
            Section("Enterprise Contact Directory") {
                CollapsibleList(items: filteredContacts, itemName: "contacts") { contact in
                    EnterpriseContactRow(
                        contact: contact,
                        isVIP: vipContacts.contains(contact.email),
                        isStarred: starredContacts.contains(contact.email),
                        toggleVIP: {
                            if vipContacts.contains(contact.email) {
                                vipContacts.remove(contact.email)
                            } else {
                                vipContacts.insert(contact.email)
                                selectedContactEmail = contact.email
                            }
                            app.toggleVIPContact(contact.email)
                            localAuditEvents.insert("VIP contact toggled: \(contact.email)", at: 0)
                        },
                        toggleStar: {
                            if starredContacts.contains(contact.email) {
                                starredContacts.remove(contact.email)
                            } else {
                                starredContacts.insert(contact.email)
                                selectedContactEmail = contact.email
                            }
                            app.toggleStarredContact(contact.email)
                            localAuditEvents.insert("Starred contact toggled: \(contact.email)", at: 0)
                        }
                    )
                } empty: { EmptyView() }
                if filteredContacts.isEmpty {
                    ContentUnavailableView("No contacts found", systemImage: "person.crop.circle.badge.questionmark", description: Text("Contacts are generated from loaded mail, domain users, recent senders, reply history, starred mail, and sending identities."))
                }
            }

            Section("Contact Profile") {
                if let contact = selectedContact {
                    LabeledContent("Display name", value: contact.name)
                    LabeledContent("Email", value: contact.email)
                    LabeledContent("Domain", value: contact.domain)
                    LabeledContent("Source", value: contact.sources.joined(separator: ", "))
                    LabeledContent("Ranking", value: "\(contact.score)")
                    LabeledContent("Relationship", value: contact.relationship)
                } else {
                    Text("Select a contact row to inspect profile, ranking, VIP, and starred state.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Domain Directory") {
                CollapsibleList(items: domainDirectory, itemName: "domains") { domain in
                    LabeledContent(domain.domain, value: "\(domain.count) contacts")
                } empty: { EmptyView() }
            }

            Section("Organization Graph") {
                ForEach(orgGraphRows) { row in
                    LabeledContent(row.title, value: row.value)
                        .accessibilityIdentifier("organization-graph-\(row.title.lowercased().replacingOccurrences(of: " ", with: "-"))")
                        .accessibilityLabel("\(row.title): \(row.value)")
                }
                Text("Organization graph shows only observed contacts, domains, and connected shared mailboxes. Department, manager, and assistant relationships remain unavailable until a provider directory verifies them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var automationCenter: some View {
        Group {
            Section("Rules Engine") {
                CollapsibleList(items: automationRules, itemName: "rules") { rule in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(rule.name, systemImage: rule.symbol)
                            .font(.subheadline.weight(.semibold))
                        Text(rule.whenThen)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 3)
                } empty: { EmptyView() }
            }

            Section("Automation Center") {
                Button {
                    ensureAutomationRule(.vipPriority)
                } label: {
                    Label("Ensure VIP Priority Rule", systemImage: "bolt.badge.checkmark")
                }
                Button {
                    ensureAutomationRule(.invoiceFinance)
                } label: {
                    Label("Ensure Invoice Finance Rule", systemImage: "doc.text.magnifyingglass")
                }
                Button {
                    ensureAutomationRule(.attachmentWorkflow)
                } label: {
                    Label("Ensure Attachment Workflow Rule", systemImage: "paperclip.badge.ellipsis")
                }
                actionFeedbackView
            }

            Section("Supported Actions") {
                EnterpriseMetricGrid(items: [
                    ("Move", "Ready"),
                    ("Label", "Ready"),
                    ("Star", "Ready"),
                    ("Archive", "Ready"),
                    ("Forward", "Manual"),
                    ("Assign", "Local"),
                    ("Create Task", "Ready"),
                    ("Governance", "Audited")
                ])
            }
        }
    }

    private var tasksCalendarCenter: some View {
        Group {
            Section("Tasks Integration") {
                Button {
                    createTask("Review priority mailbox", source: "Enterprise Hub")
                } label: {
                    Label("Create Task", systemImage: "checklist")
                }
                Button {
                    createTask("Convert latest email to task", source: latestEmailSubject)
                } label: {
                    Label("Convert Email to Task", systemImage: "envelope.badge")
                }
                CollapsibleList(items: productivityTasks, itemName: "tasks") { task in
                    EnterpriseTaskRow(task: task)
                } empty: { EmptyView() }
            }

            Section("Calendar Integration") {
                Button {
                    scheduleFollowUp("Follow up on latest thread")
                } label: {
                    Label("Create Local Calendar Follow-Up", systemImage: "calendar.badge.clock")
                }
                Button {
                    scheduleFollowUp("Convert email to calendar event")
                } label: {
                    Label("Create Local Follow-Up from Email", systemImage: "calendar.badge.plus")
                }
                CollapsibleList(items: scheduledFollowUps, itemName: "follow-ups") { task in
                    EnterpriseTaskRow(task: task)
                } empty: { EmptyView() }
                Text("Local follow-ups remain in NEXORA until a connected calendar with write authority is available.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                actionFeedbackView
            }

            Section("Follow-Up Center") {
                EnterpriseMetricGrid(items: [
                    ("Waiting For Reply", "\(waitingForReplyCount)"),
                    ("Follow-Up Queue", "\(followUpCount)"),
                    ("Reminders", "\(scheduledFollowUps.count)"),
                    ("Tasks", "\(productivityTasks.count)")
                ])
            }
        }
    }

    private var knowledgeSearchCenter: some View {
        Group {
            Section("NLP Search V2") {
                TextField("emails from bill last month", text: $query)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                EnterpriseMetricGrid(items: [
                    ("Message Graph", "\(app.emails.count) nodes"),
                    ("Contact Graph", "\(contactGraph.count) nodes"),
                    ("Attachment Graph", "\(attachmentGraphCount) nodes"),
                    ("Thread Graph", "\(threadGraphCount) nodes")
                ])
            }

            Section("Search Examples") {
                ForEach(nlpExamples, id: \.self) { example in
                    Button {
                        query = example
                        localAuditEvents.insert("NLP Search V2 query: \(example)", at: 0)
                    } label: {
                        Label(example, systemImage: "magnifyingglass")
                    }
                }
            }

            Section("Knowledge Results") {
                CollapsibleList(items: knowledgeResults, itemName: "knowledge results") { result in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(result.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                } empty: { EmptyView() }
            }
        }
    }

    private var auditComplianceCenter: some View {
        Group {
            Section("Enterprise Admin Audit Center") {
                EnterpriseMetricGrid(items: [
                    ("Audit Logs", "\(totalAuditCount)"),
                    ("Approval Logs", "\(app.localOAuthAccessRequests.count)"),
                    ("Invitation Logs", "\(app.governanceInvitations.count)"),
                    ("Access Logs", "\(app.localOAuthAccessRequests.count)"),
                    ("Retention", "Visible"),
                    ("Legal Hold", "Aware"),
                    ("Exports", "Prepared"),
                    ("Governance", "Integrated")
                ])
            }

            Section("Compliance Center") {
                LabeledContent("Retention Status", value: "Policy-visible")
                LabeledContent("Legal Hold Awareness", value: "Non-destructive")
                LabeledContent("Export Readiness", value: "Metadata only")
                LabeledContent("OAuth Approval Center", value: "Integrated")
                LabeledContent("Recovery Center", value: "Integrated")
                Text("Compliance V1 is a visibility layer. It does not delete mail, run migrations, expose secrets, or export mailbox content.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Recent Audit") {
                CollapsibleList(items: recentAuditLines.enumerated().map { EnterpriseAuditRow(id: "\($0.offset):\($0.element)", line: $0.element) }, itemName: "audit events") { audit in
                    let line = audit.line
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } empty: { EmptyView() }
            }
        }
    }

    private var contactGraph: [EnterpriseContactNode] {
        var map: [String: EnterpriseContactNode] = [:]

        func add(email rawEmail: String, name rawName: String?, source: String, score: Int) {
            let email = rawEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard email.contains("@") else { return }
            let name = rawName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let domain = email.split(separator: "@").last.map(String.init) ?? "unknown"
            var node = map[email] ?? EnterpriseContactNode(
                email: email,
                name: name?.isEmpty == false ? name! : email,
                domain: domain,
                sources: [],
                score: 0,
                relationship: "Recent"
            )
            if !node.sources.contains(source) { node.sources.append(source) }
            node.score += score
            if vipContacts.contains(email) { node.relationship = "VIP" }
            else if starredContacts.contains(email) { node.relationship = "Starred" }
            else if app.sendingIdentities.contains(where: { $0.email.caseInsensitiveCompare(email) == .orderedSame }) { node.relationship = "Owned" }
            map[email] = node
        }

        for address in app.addresses {
            add(email: address.email, name: address.name, source: "NEXORA Directory", score: 20)
        }
        for identity in app.sendingIdentities {
            add(email: identity.email, name: identity.email, source: "Domain Users", score: 18)
        }
        for email in app.emails {
            add(email: email.fromAddress, name: email.fromName, source: "Received Mail", score: email.isUnread ? 5 : 3)
            if let to = email.toEmail { add(email: to, name: email.toName, source: "Sent Mail", score: 3) }
            if email.isStarred {
                add(email: email.fromAddress, name: email.fromName, source: "Starred Contacts", score: 12)
            }
            if email.type == 1 {
                add(email: email.toEmail ?? "", name: email.toName, source: "Reply History", score: 9)
            }
        }

        return map.values.sorted {
            if $0.score == $1.score { return $0.email < $1.email }
            return $0.score > $1.score
        }
    }

    private var filteredContacts: [EnterpriseContactNode] {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !clean.isEmpty else { return contactGraph }
        return contactGraph.filter {
            $0.email.contains(clean)
                || $0.name.lowercased().contains(clean)
                || $0.domain.contains(clean)
                || $0.sources.joined(separator: " ").lowercased().contains(clean)
        }
    }

    private var selectedContact: EnterpriseContactNode? {
        if let selectedContactEmail {
            return contactGraph.first { $0.email == selectedContactEmail }
        }
        return filteredContacts.first
    }

    private var domainDirectory: [EnterpriseDomainNode] {
        let grouped = Dictionary(grouping: contactGraph, by: \.domain)
        return grouped.map { EnterpriseDomainNode(domain: $0.key, count: $0.value.count) }
            .sorted { $0.count == $1.count ? $0.domain < $1.domain : $0.count > $1.count }
    }

    private var orgGraphRows: [EnterpriseKeyValue] {
        [
            EnterpriseKeyValue(title: "Company Directory", value: "\(contactGraph.count) contacts"),
            EnterpriseKeyValue(title: "Observed Domains", value: "\(domainDirectory.count) domains"),
            EnterpriseKeyValue(title: "Department Directory", value: "Provider metadata not observed"),
            EnterpriseKeyValue(title: "Shared Mailboxes", value: sharedMailboxCount == 0 ? "None visible" : "\(sharedMailboxCount) visible"),
            EnterpriseKeyValue(title: "Manager Relationships", value: "Not observed"),
            EnterpriseKeyValue(title: "Assistant Relationships", value: "Not observed")
        ]
    }

    private var knowledgeResults: [EnterpriseKnowledgeResult] {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let source = app.emails.filter { email in
            guard !clean.isEmpty else { return true }
            if clean.contains("attachment") { return email.attachmentSignalCount > 0 }
            if clean.contains("unread") { return email.isUnread }
            if clean.contains("waiting") { return email.searchableSnippet.contains("waiting") || email.searchableSnippet.contains("reply") }
            if clean.contains("invoice") { return email.searchableSnippet.contains("invoice") || email.searchableSnippet.contains("payment") }
            if clean.contains("bill") { return email.searchableSnippet.contains("bill") || email.fromAddress.contains("bill") }
            return email.searchableSnippet.contains(clean) || email.fromAddress.lowercased().contains(clean)
        }
        return source.map {
            EnterpriseKnowledgeResult(
                title: $0.displaySubject,
                detail: "\($0.fromAddress) · \($0.preview.isEmpty ? "No preview" : $0.preview)"
            )
        }
    }

    private var recentAuditLines: [String] {
        let governance = app.governanceAuditTrail.map { "\($0.action.rawValue) · \($0.provider.rawValue)" }
        return localAuditEvents + governance
    }

    private var totalAuditCount: Int { app.governanceAuditTrail.count + localAuditEvents.count }
    private var sharedMailboxCount: Int { app.unifiedAccounts.filter(\.isDelegatedMailbox).count }
    private var attachmentGraphCount: Int { app.emails.reduce(0) { $0 + $1.attachmentSignalCount } }
    private var threadGraphCount: Int { Set(app.emails.map(\.sourceThreadID).filter { !$0.isEmpty }).count }
    private var waitingForReplyCount: Int { app.emails.filter { $0.searchableSnippet.contains("waiting") || $0.searchableSnippet.contains("reply") }.count }
    private var followUpCount: Int { app.emails.filter { $0.searchableSnippet.contains("follow up") || $0.searchableSnippet.contains("follow-up") }.count }
    private var latestEmailSubject: String { app.emails.first?.displaySubject ?? "No loaded email" }
    private let nlpExamples = ["emails from bill last month", "attachments from admin", "contracts from legal", "unread invoices", "emails waiting for reply"]

    private func bootstrapLocalState() {
        guard !didBootstrap else { return }
        didBootstrap = true
        vipContacts = Set(app.mailClientProfile.vipContactEmails ?? [])
        starredContacts = Set(app.mailClientProfile.starredContactEmails ?? [])
        if let storedRules = readLocalWorkflow([EnterpriseAutomationRule].self, key: Self.automationRulesStorageKey) {
            automationRules = storedRules
        }
        if let storedTasks = readLocalWorkflow([EnterpriseProductivityTask].self, key: Self.productivityTasksStorageKey) {
            productivityTasks = storedTasks
        } else if productivityTasks.isEmpty {
            productivityTasks = [
                EnterpriseProductivityTask(title: "Review priority queue", source: "NEXORA", kind: "Task"),
                EnterpriseProductivityTask(title: "Confirm waiting replies", source: "Follow-Up Center", kind: "Reminder")
            ]
            persistLocalWorkflow(productivityTasks, key: Self.productivityTasksStorageKey)
        }
        if let storedFollowUps = readLocalWorkflow([EnterpriseProductivityTask].self, key: Self.followUpsStorageKey) {
            scheduledFollowUps = storedFollowUps
        } else if scheduledFollowUps.isEmpty {
            scheduledFollowUps = [
                EnterpriseProductivityTask(title: "Morning mailbox review", source: "Calendar", kind: "Calendar")
            ]
            persistLocalWorkflow(scheduledFollowUps, key: Self.followUpsStorageKey)
        }
    }

    private func createTask(_ title: String, source: String) {
        productivityTasks.insert(EnterpriseProductivityTask(title: title, source: source, kind: "Task"), at: 0)
        persistLocalWorkflow(productivityTasks, key: Self.productivityTasksStorageKey)
        localAuditEvents.insert("Local task created: \(title)", at: 0)
        actionFeedback = "Local task created: \(title)"
    }

    private func scheduleFollowUp(_ title: String) {
        scheduledFollowUps.insert(EnterpriseProductivityTask(title: title, source: "Follow-Up Center", kind: "Calendar"), at: 0)
        persistLocalWorkflow(scheduledFollowUps, key: Self.followUpsStorageKey)
        localAuditEvents.insert("Local follow-up created: \(title)", at: 0)
        actionFeedback = "Local follow-up created: \(title)"
    }

    private func ensureAutomationRule(_ rule: EnterpriseAutomationRule) {
        if automationRules.contains(where: { $0.name == rule.name }) {
            actionFeedback = "Rule already active: \(rule.name)"
            return
        }
        automationRules.insert(rule, at: 0)
        persistLocalWorkflow(automationRules, key: Self.automationRulesStorageKey)
        localAuditEvents.insert("Automation rule added: \(rule.name)", at: 0)
        actionFeedback = "Rule active: \(rule.name)"
    }

    @ViewBuilder
    private var actionFeedbackView: some View {
        if let actionFeedback {
            Label(actionFeedback, systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
                .accessibilityIdentifier("enterprise-action-feedback")
        }
    }

    private static let automationRulesStorageKey = "nexora.enterprise.automation-rules.v1"
    private static let productivityTasksStorageKey = "nexora.enterprise.productivity-tasks.v1"
    private static let followUpsStorageKey = "nexora.enterprise.follow-ups.v1"

    private func readLocalWorkflow<Value: Decodable>(_ type: Value.Type, key: String) -> Value? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    private func persistLocalWorkflow<Value: Encodable>(_ value: Value, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

}

private enum EnterprisePlatformArea: String, CaseIterable, Identifiable {
    case hub
    case directory
    case automation
    case work
    case knowledge
    case governance

    var id: String { rawValue }
    var shortTitle: String {
        switch self {
        case .hub: return "Hub"
        case .directory: return "Directory"
        case .automation: return "Rules"
        case .work: return "Work"
        case .knowledge: return "Search"
        case .governance: return "Audit"
        }
    }
    var title: String {
        switch self {
        case .hub: return "Enterprise Hub"
        case .directory: return "Contacts & Org Graph"
        case .automation: return "Rules & Automation"
        case .work: return "Tasks & Calendar"
        case .knowledge: return "Knowledge Graph & NLP Search"
        case .governance: return "Audit & Compliance"
        }
    }
    var symbol: String {
        switch self {
        case .hub: return "square.grid.2x2"
        case .directory: return "person.text.rectangle"
        case .automation: return "slider.horizontal.3"
        case .work: return "calendar.badge.clock"
        case .knowledge: return "point.3.connected.trianglepath.dotted"
        case .governance: return "checkmark.shield"
        }
    }
}

private struct EnterpriseContactNode: Identifiable, Hashable {
    var id: String { email }
    var email: String
    var name: String
    var domain: String
    var sources: [String]
    var score: Int
    var relationship: String
}

private struct EnterpriseDomainNode: Identifiable {
    var id: String { domain }
    let domain: String
    let count: Int
}

private struct EnterpriseKeyValue: Identifiable {
    var id: String { title }
    let title: String
    let value: String
}

private struct EnterpriseKnowledgeResult: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
}

private struct EnterpriseAuditRow: Identifiable {
    let id: String
    let line: String
}

private struct EnterpriseProductivityTask: Identifiable, Codable {
    let id = UUID()
    let title: String
    let source: String
    let kind: String
    let createdAt = Date()
}

private struct EnterpriseAutomationRule: Identifiable, Hashable, Codable {
    let id = UUID()
    let name: String
    let whenThen: String
    let symbol: String

    static let seed: [EnterpriseAutomationRule] = [
        EnterpriseAutomationRule(name: "Sender -> Category", whenThen: "Known sender maps to learned category.", symbol: "person.crop.circle.badge.checkmark"),
        EnterpriseAutomationRule(name: "Sender -> Folder", whenThen: "Domain sender can route to mailbox folder.", symbol: "folder.badge.person.crop")
    ]

    static let vipPriority = EnterpriseAutomationRule(name: "VIP -> Priority", whenThen: "VIP sender marks mail as priority.", symbol: "star.circle.fill")
    static let invoiceFinance = EnterpriseAutomationRule(name: "Invoice -> Finance", whenThen: "Invoice mail creates finance task.", symbol: "doc.text.magnifyingglass")
    static let attachmentWorkflow = EnterpriseAutomationRule(name: "Attachment -> Workflow", whenThen: "Attachment mail creates review workflow.", symbol: "paperclip.badge.ellipsis")
}

private struct EnterpriseContactRow: View {
    let contact: EnterpriseContactNode
    let isVIP: Bool
    let isStarred: Bool
    let toggleVIP: () -> Void
    let toggleStar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "person.crop.circle.fill")
                    .foregroundStyle(.blue)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(contact.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(contact.email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                Text("\(contact.score)")
                    .font(.caption.monospacedDigit().weight(.bold))
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text(contact.relationship)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: toggleStar) {
                    Image(systemName: isStarred ? "star.fill" : "star")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(isStarred ? "Unstar Contact" : "Star Contact")
                Button(action: toggleVIP) {
                    Image(systemName: isVIP ? "crown.fill" : "crown")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(isVIP ? "Remove VIP Contact" : "Make VIP Contact")
            }
        }
        .padding(.vertical, 3)
    }
}

private struct EnterpriseTaskRow: View {
    let task: EnterpriseProductivityTask

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(task.title, systemImage: task.kind == "Calendar" ? "calendar" : "checkmark.circle")
                .font(.subheadline.weight(.semibold))
            Text("\(task.kind) · \(task.source)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }
}

private struct EnterpriseMetricGrid: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.0)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(item.1)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
    }
}
