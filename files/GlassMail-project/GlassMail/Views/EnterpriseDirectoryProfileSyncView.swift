import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct EnterpriseDirectoryProfileSyncView: View {
    enum StartTab: String {
        case directory
        case domain
        case profileSync
        case restore
    }

    @EnvironmentObject private var app: AppState
    @State private var tab: DirectoryPlatformTab
    @State private var query = ""
    @State private var selectedContact: EnterpriseContactGraphNode?
    @State private var composeContact: EnterpriseContactGraphNode?
    @State private var localStatus: String?

    init(startTab: StartTab = .directory) {
        switch startTab {
        case .directory:
            _tab = State(initialValue: .directory)
        case .domain:
            _tab = State(initialValue: .domain)
        case .profileSync:
            _tab = State(initialValue: .profileSync)
        case .restore:
            _tab = State(initialValue: .restore)
        }
    }

    var body: some View {
        Form {
            Section {
                Picker("Contacts", selection: $tab) {
                    ForEach(DirectoryPlatformTab.allCases) { item in
                        Text(item.shortTitle).tag(item)
                    }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)

            switch tab {
            case .directory:
                directorySections
            case .domain:
                domainDirectorySections
            case .profileSync:
                profileSyncSections
            case .restore:
                deviceRestoreSections
            case .devices:
                multiDeviceSections
            }
        }
        .cloudMailCompactMenuSurface()
        .scrollContentBackground(.hidden)
        .background(AmbientBackground())
        .navigationTitle(tab.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(item: $selectedContact) { contact in
            EnterpriseContactProfileView(contact: contact, composeContact: $composeContact)
                .environmentObject(app)
        }
        .sheet(item: $composeContact) { contact in
            ComposeView(isPresentedAsSheet: true, initialRecipient: contact.email)
                .environmentObject(app)
        }
    }

    private var directorySections: some View {
        Group {
            Section("Search") {
                TextField("Search name, email, organization, domain", text: $query)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif
                Toggle("Use Device Contacts", isOn: Binding(
                    get: { app.deviceContactsEnabledForDirectory },
                    set: { app.setDeviceContactsEnabledForDirectory($0) }
                ))
                Text("Device Contacts are never requested at launch. Enable this only when you want NEXORA to ask iOS for contact access.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("All Contacts") {
                CollapsibleList(items: filteredContacts, itemName: "contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No contacts found.").foregroundStyle(.secondary)
                }
            }

            Section("Recent Contacts") {
                CollapsibleList(items: recentContacts, itemName: "recent contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No recent contacts yet.").foregroundStyle(.secondary)
                }
            }

            Section("VIP Contacts") {
                CollapsibleList(items: vipContacts, itemName: "VIP contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No VIP contacts yet.").foregroundStyle(.secondary)
                }
            }

            Section("Starred Contacts") {
                CollapsibleList(items: starredContacts, itemName: "starred contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No starred contacts yet.").foregroundStyle(.secondary)
                }
            }

            Section("Domain Contacts") {
                CollapsibleList(items: domainContacts, itemName: "domain contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No domain contacts found.").foregroundStyle(.secondary)
                }
            }

            Section("Organization Contacts") {
                CollapsibleList(items: organizationContacts, itemName: "organization contacts") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No organization contacts found.").foregroundStyle(.secondary)
                }
            }
        }
    }

    private var domainDirectorySections: some View {
        Group {
            Section("Domain Directory") {
                CollapsibleList(items: domains, itemName: "domains") { domain in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Label(domain.domain, systemImage: "building.2")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(domain.contactCount)")
                                .font(.caption.monospacedDigit().weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        Text(domain.providerStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 3)
                } empty: {
                    Text("No domains found.").foregroundStyle(.secondary)
                }
            }

            Section("NEXORA Domain Users") {
                CollapsibleList(items: domainContacts, itemName: "NEXORA domain users") { contact in
                    directoryRow(contact)
                } empty: {
                    Text("No provider-verified domain users found.").foregroundStyle(.secondary)
                }
                Text("Provider status remains metadata-only; NEXORA does not invent users.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var profileSyncSections: some View {
        Group {
            Section("Profile Sync V2") {
                LabeledContent("Enabled", value: "Yes")
                LabeledContent("Last Sync", value: app.mailClientProfile.updatedAt?.formatted(date: .abbreviated, time: .shortened) ?? "Queued")
                LabeledContent("CloudKit Status", value: app.iCloudProfileSyncStatus)
                LabeledContent("Device Count", value: "\(app.profileSyncDevices.count)")
                LabeledContent("Last Restore", value: app.mailClientProfile.profileSyncLastRestoreAt?.formatted(date: .abbreviated, time: .shortened) ?? "None")
            }

            Section("Synced Items") {
                CollapsibleList(items: listValues(app.profileSyncSyncedItems), itemName: "synced items") { item in
                    Label(item.value, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } empty: {
                    Text("No synced items reported.").foregroundStyle(.secondary)
                }
            }

            Section("Excluded Data") {
                CollapsibleList(items: listValues(app.profileSyncSecretSafetyItems), itemName: "excluded data items") { item in
                    Label(item.value, systemImage: "lock.shield")
                        .foregroundStyle(.secondary)
                } empty: {
                    Text("No excluded data items reported.").foregroundStyle(.secondary)
                }
            }
        }
    }

    private var deviceRestoreSections: some View {
        Group {
            Section("Device Restore") {
                LabeledContent("Last Backup", value: app.mailClientProfile.updatedAt?.formatted(date: .abbreviated, time: .shortened) ?? "Queued")
                LabeledContent("Last Restore", value: app.mailClientProfile.profileSyncLastRestoreAt?.formatted(date: .abbreviated, time: .shortened) ?? "Never")
                Button {
                    app.markProfileRestoredFromCloud()
                    localStatus = "Restore preview applied. Credentials remain excluded."
                } label: {
                    Label("Apply Restore Preview", systemImage: "arrow.clockwise.icloud")
                }
                if let localStatus {
                    Text(localStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Restore Preview") {
                CollapsibleList(items: listValues(app.profileSyncRestorePreview), itemName: "restore preview items") { line in
                    Text(line.value)
                        .font(.subheadline)
                } empty: {
                    Text("No restore preview available.").foregroundStyle(.secondary)
                }
            }

            Section("Restore Actions") {
                Text("New devices recover theme, default From, signatures, favorites, VIP contacts, starred contacts, directory settings, hub settings, and automation preferences without recovering credentials.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var multiDeviceSections: some View {
        Group {
            Section("Multi Device View") {
                CollapsibleList(items: app.profileSyncDevices, itemName: "devices") { device in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Label(device.label, systemImage: symbol(for: device.kind))
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(device.kind)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        LabeledContent("Last Seen", value: device.lastSeen.formatted(date: .abbreviated, time: .shortened))
                        LabeledContent("Sync Status", value: device.syncStatus)
                    }
                    .padding(.vertical, 3)
                } empty: {
                    Text("No synced devices reported.").foregroundStyle(.secondary)
                }
            }

            Section("Profile Sync Health") {
                LabeledContent("Current Device", value: app.profileSyncDeviceLabel)
                LabeledContent("Sync Status", value: app.iCloudProfileSyncStatus)
                LabeledContent("Write Verified", value: app.iCloudProfileLastWriteVerified ? "Yes" : "Queued")
                LabeledContent("Read Verified", value: app.iCloudProfileLastReadVerified ? "Yes" : "Pending")
            }
        }
    }

    private var filteredContacts: [EnterpriseContactGraphNode] {
        EnterpriseContactGraphBuilder.search(app.enterpriseContactGraph, query: query)
            .filter { !app.isContactHiddenFromDirectory($0.email) }
    }

    private var recentContacts: [EnterpriseContactGraphNode] {
        filteredContacts.sorted {
            switch ($0.lastUsed, $1.lastUsed) {
            case let (left?, right?):
                return left > right
            case (.some, nil):
                return true
            case (nil, .some):
                return false
            case (nil, nil):
                return $0.frequentContactScore > $1.frequentContactScore
            }
        }
    }

    private var vipContacts: [EnterpriseContactGraphNode] {
        filteredContacts.filter(\.isVIP)
    }

    private var starredContacts: [EnterpriseContactGraphNode] {
        filteredContacts.filter(\.isStarred)
    }

    private var domainContacts: [EnterpriseContactGraphNode] {
        filteredContacts.filter { $0.sources.contains("Domain Directory") }
    }

    private var organizationContacts: [EnterpriseContactGraphNode] {
        filteredContacts.filter {
            $0.sources.contains("NEXORA Directory")
                || $0.sources.contains("CloudMail Directory")
                || $0.sources.contains("Domain Directory")
        }
    }

    private var domains: [EnterpriseDomainDirectoryNode] {
        app.enterpriseDomainDirectory
    }

    private func directoryRow(_ contact: EnterpriseContactGraphNode) -> some View {
        Button {
            selectedContact = contact
        } label: {
            HStack(spacing: 10) {
                Image(systemName: contact.isVIP ? "crown.fill" : "person.crop.circle.fill")
                    .foregroundStyle(contact.isVIP ? .purple : .blue)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(contact.displayName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if contact.isStarred {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        }
                    }
                    Text(contact.email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text("\(contact.relationship) · \(contact.domain) · score \(contact.frequentContactScore)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 3)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("enterprise-directory-contact-\(contact.email)")
    }

    private func listValues(_ values: [String]) -> [EnterpriseListValue] {
        values.enumerated().map { EnterpriseListValue(id: "\($0.offset):\($0.element)", value: $0.element) }
    }

    private func symbol(for kind: String) -> String {
        switch kind.lowercased() {
        case "iphone": return "iphone"
        case "ipad": return "ipad"
        default: return "desktopcomputer"
        }
    }
}

private struct EnterpriseListValue: Identifiable {
    let id: String
    let value: String
}

private enum DirectoryPlatformTab: String, CaseIterable, Identifiable {
    case directory
    case domain
    case profileSync
    case restore
    case devices

    var id: String { rawValue }
    var shortTitle: String {
        switch self {
        case .directory: return "Directory"
        case .domain: return "Domain"
        case .profileSync: return "Sync"
        case .restore: return "Restore"
        case .devices: return "Devices"
        }
    }
    var title: String {
        switch self {
        case .directory: return "Directory"
        case .domain: return "Domain Directory"
        case .profileSync: return "Profile Sync"
        case .restore: return "Device Restore"
        case .devices: return "Devices"
        }
    }
}

private struct EnterpriseContactProfileView: View {
    @EnvironmentObject private var app: AppState
    let contact: EnterpriseContactGraphNode
    @Binding var composeContact: EnterpriseContactGraphNode?
    @Environment(\.dismiss) private var dismiss

    private var isHiddenFromDirectory: Bool {
        app.isContactHiddenFromDirectory(contact.email)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    LabeledContent("Name", value: contact.displayName)
                    LabeledContent("Email", value: contact.email)
                    LabeledContent("Organization", value: contact.organization)
                    LabeledContent("Relationship", value: contact.relationship)
                    LabeledContent("Last Interaction", value: contact.lastUsed?.formatted(date: .abbreviated, time: .shortened) ?? "Not observed")
                    LabeledContent("Directory visibility", value: isHiddenFromDirectory ? "Hidden locally" : "Visible")
                }

                Section("Activity") {
                    LabeledContent("Sent Count", value: "\(contact.sendCount)")
                    LabeledContent("Received Count", value: "\(contact.receiveCount)")
                    LabeledContent("Reply Count", value: "\(contact.replyCount)")
                    LabeledContent("Frequent Contact Score", value: "\(contact.frequentContactScore)")
                }

                Section("Actions") {
                    Button {
                        composeContact = contact
                        dismiss()
                    } label: {
                        Label("Compose", systemImage: "square.and.pencil")
                    }
                    Button {
                        app.toggleStarredContact(contact.email)
                    } label: {
                        Label(app.isStarredContact(contact.email) ? "Unstar Contact" : "Star Contact", systemImage: app.isStarredContact(contact.email) ? "star.fill" : "star")
                    }
                    Button {
                        app.toggleVIPContact(contact.email)
                    } label: {
                        Label(app.isVIPContact(contact.email) ? "Remove VIP" : "Make VIP", systemImage: app.isVIPContact(contact.email) ? "crown.fill" : "crown")
                    }
                    Button {
                        app.toggleFavoriteContact(contact.email)
                    } label: {
                        Label(app.isFavoriteContact(contact.email) ? "Remove Favorite" : "Favorite", systemImage: app.isFavoriteContact(contact.email) ? "heart.fill" : "heart")
                    }
                    Button {
                        copyEmail(contact.email)
                    } label: {
                        Label("Copy Address", systemImage: "doc.on.doc")
                    }
                    Button(role: isHiddenFromDirectory ? nil : .destructive) {
                        app.setContactHiddenFromDirectory(contact.email, hidden: !isHiddenFromDirectory)
                    } label: {
                        Label(
                            isHiddenFromDirectory ? "Unhide from Directory" : "Hide from Directory",
                            systemImage: isHiddenFromDirectory ? "eye" : "eye.slash"
                        )
                    }
                    Text("This controls NEXORA's local directory only. It does not claim to block mail delivery at a provider.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Recent Conversations") {
                    let related = app.emails.filter {
                        $0.fromAddress.caseInsensitiveCompare(contact.email) == .orderedSame
                            || ($0.toEmail?.caseInsensitiveCompare(contact.email) == .orderedSame)
                    }
                    CollapsibleList(items: related, itemName: "recent conversations") { email in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(email.displaySubject)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text(email.preview.isEmpty ? email.fromAddress : email.preview)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    } empty: {
                        Text("No related loaded messages.").foregroundStyle(.secondary)
                    }
                }
            }
            .cloudMailCompactMenuSurface()
            .navigationTitle("Contact Profile")
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

    private func copyEmail(_ email: String) {
        #if os(iOS)
        UIPasteboard.general.string = email
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(email, forType: .string)
        #endif
    }
}
