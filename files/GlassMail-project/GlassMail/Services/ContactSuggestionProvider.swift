import Foundation
import Contacts

struct ContactSuggestion: Identifiable, Hashable, Codable {
    let id: UUID
    let name: String
    let email: String

    init(id: UUID = UUID(), name: String, email: String) {
        self.id = id
        self.name = name
        self.email = email
    }
}

@MainActor
class ContactSuggestionProvider: ObservableObject {
    @Published var suggestions: [ContactSuggestion] = []

    func loadSuggestions(
        from emails: [EmailMessage],
        sendAddresses: [MailAddress],
        sendingIdentities: [SendingIdentity] = [],
        vip: Set<String> = [],
        starred: Set<String> = [],
        favorites: Set<String> = [],
        autocompleteLearning: [String: Int] = [:]
    ) async {
        var collected = [String: String]() // email -> name

        // 1. Fetch from local contacts if authorized
        let store = CNContactStore()
        let authorizationStatus = CNContactStore.authorizationStatus(for: .contacts)
        
        let fetchContactsBlock = {
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            try? store.enumerateContacts(with: request) { contact, _ in
                let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
                for emailAddress in contact.emailAddresses {
                    let emailValue = (emailAddress.value as String).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !emailValue.isEmpty {
                        collected[emailValue.lowercased()] = fullName.isEmpty ? emailValue : fullName
                    }
                }
            }
        }

        if authorizationStatus == .authorized {
            fetchContactsBlock()
        }

        // 2. Merge CloudMail contact graph sources without requesting contact permission.
        let graph = EnterpriseContactGraphBuilder.build(
            emails: emails,
            addresses: sendAddresses,
            sendingIdentities: sendingIdentities,
            vip: vip,
            starred: starred,
            favorites: favorites,
            autocompleteLearning: autocompleteLearning
        )
        for node in graph {
            collected[node.email] = node.displayName
        }

        let graphRank = Dictionary(uniqueKeysWithValues: graph.enumerated().map { ($0.element.email, $0.offset) })
        self.suggestions = collected.map { ContactSuggestion(name: $0.value, email: $0.key) }
            .sorted {
                let left = graphRank[$0.email] ?? Int.max
                let right = graphRank[$1.email] ?? Int.max
                if left == right { return $0.name.lowercased() < $1.name.lowercased() }
                return left < right
            }
    }

    func search(query: String) -> [ContactSuggestion] {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !cleanQuery.isEmpty else {
            // If empty, return a subset of all contacts as default suggestion list
            return Array(suggestions.prefix(15))
        }
        return suggestions.filter {
            $0.name.lowercased().contains(cleanQuery) || $0.email.lowercased().contains(cleanQuery)
        }
    }
}
