import Foundation

struct EnterpriseContactGraphNode: Identifiable, Hashable, Codable {
    var id: String { email }
    var email: String
    var displayName: String
    var organization: String
    var domain: String
    var sources: [String]
    var sendCount: Int
    var receiveCount: Int
    var replyCount: Int
    var lastUsed: Date?
    var isVIP: Bool
    var isStarred: Bool
    var isFavorite: Bool
    var frequentContactScore: Int

    var relationship: String {
        if isVIP { return "VIP" }
        if isStarred { return "Starred" }
        if isFavorite { return "Favorite" }
        if sources.contains("NEXORA Directory") || sources.contains("CloudMail Directory") { return "Directory" }
        return "Recent"
    }

    var autocompleteLabel: String {
        displayName.caseInsensitiveCompare(email) == .orderedSame ? email : "\(displayName) <\(email)>"
    }
}

struct EnterpriseDomainDirectoryNode: Identifiable, Hashable {
    var id: String { domain }
    let domain: String
    let contactCount: Int
    let providerStatus: String
}

struct EnterpriseContactGraphBuilder {
    static func build(
        emails: [EmailMessage],
        addresses: [MailAddress],
        sendingIdentities: [SendingIdentity],
        vip: Set<String>,
        starred: Set<String>,
        favorites: Set<String>,
        autocompleteLearning: [String: Int] = [:]
    ) -> [EnterpriseContactGraphNode] {
        var map: [String: EnterpriseContactGraphNode] = [:]

        func normalized(_ value: String?) -> String {
            value?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased() ?? ""
        }

        func add(
            email rawEmail: String?,
            name rawName: String?,
            source: String,
            sendDelta: Int = 0,
            receiveDelta: Int = 0,
            replyDelta: Int = 0,
            scoreDelta: Int = 0,
            lastUsed: Date? = nil
        ) {
            let email = normalized(rawEmail)
            guard email.contains("@") else { return }
            let name = rawName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let domain = email.split(separator: "@").last.map(String.init) ?? "unknown"
            let existing = map[email]
            var node = existing ?? EnterpriseContactGraphNode(
                email: email,
                displayName: name?.isEmpty == false ? name! : email,
                organization: domain,
                domain: domain,
                sources: [],
                sendCount: 0,
                receiveCount: 0,
                replyCount: 0,
                lastUsed: nil,
                isVIP: false,
                isStarred: false,
                isFavorite: false,
                frequentContactScore: 0
            )
            if let name, !name.isEmpty, node.displayName == email {
                node.displayName = name
            }
            if !node.sources.contains(source) {
                node.sources.append(source)
            }
            node.sendCount += sendDelta
            node.receiveCount += receiveDelta
            node.replyCount += replyDelta
            node.frequentContactScore += scoreDelta + (autocompleteLearning[email] ?? 0)
            if let lastUsed {
                if let existingDate = node.lastUsed {
                    node.lastUsed = max(existingDate, lastUsed)
                } else {
                    node.lastUsed = lastUsed
                }
            }
            node.isVIP = vip.contains(email)
            node.isStarred = starred.contains(email)
            node.isFavorite = favorites.contains(email)
            if node.isVIP { node.frequentContactScore += 100 }
            if node.isStarred { node.frequentContactScore += 55 }
            if node.isFavorite { node.frequentContactScore += 40 }
            map[email] = node
        }

        for address in addresses {
            add(email: address.email, name: address.name, source: "NEXORA Directory", scoreDelta: 24)
        }
        for identity in sendingIdentities {
            add(email: identity.email, name: identity.email, source: "Domain Directory", scoreDelta: 18)
        }
        for email in emails {
            add(
                email: email.fromAddress,
                name: email.fromName,
                source: "Received Senders",
                receiveDelta: 1,
                scoreDelta: email.isUnread ? 8 : 5,
                lastUsed: email.date
            )
            add(
                email: email.toEmail,
                name: email.toName,
                source: email.type == 1 ? "Sent Recipients" : "Reply Targets",
                sendDelta: email.type == 1 ? 1 : 0,
                replyDelta: email.type == 1 ? 1 : 0,
                scoreDelta: email.type == 1 ? 10 : 4,
                lastUsed: email.date
            )
            if !email.ccRecipients.isEmpty {
                for cc in splitRecipients(email.ccRecipients) {
                    add(email: cc, name: nil, source: "Forward Targets", scoreDelta: 3, lastUsed: email.date)
                }
            }
            if email.isStarred {
                add(email: email.fromAddress, name: email.fromName, source: "Starred Contacts", scoreDelta: 35, lastUsed: email.date)
            }
        }

        return map.values.sorted {
            if $0.frequentContactScore == $1.frequentContactScore {
                return $0.email < $1.email
            }
            return $0.frequentContactScore > $1.frequentContactScore
        }
    }

    static func domains(from graph: [EnterpriseContactGraphNode]) -> [EnterpriseDomainDirectoryNode] {
        let grouped = Dictionary(grouping: graph, by: \.domain)
        return grouped.map {
            EnterpriseDomainDirectoryNode(domain: $0.key, contactCount: $0.value.count, providerStatus: "Directory metadata only")
        }
        .sorted { $0.contactCount == $1.contactCount ? $0.domain < $1.domain : $0.contactCount > $1.contactCount }
    }

    static func search(_ graph: [EnterpriseContactGraphNode], query: String) -> [EnterpriseContactGraphNode] {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !clean.isEmpty else { return graph }
        return graph.filter {
            $0.displayName.lowercased().contains(clean)
                || $0.email.contains(clean)
                || $0.organization.lowercased().contains(clean)
                || $0.domain.contains(clean)
                || $0.sources.joined(separator: " ").lowercased().contains(clean)
        }
    }

    private static func splitRecipients(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0 == "," || $0 == ";" || $0 == " " || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.contains("@") }
    }
}
