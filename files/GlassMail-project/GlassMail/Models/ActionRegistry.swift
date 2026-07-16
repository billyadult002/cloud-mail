//
//  ActionRegistry.swift
//  GlassMail
//
//  Shared metadata for visible actions. Handlers still live with their screens,
//  but each button can declare why it is enabled and where the result appears.
//

import Foundation

enum CloudMailActionRole: String, Codable, Equatable {
    case primary
    case secondary
    case destructive
    case ai
    case navigation
}

enum CloudMailActionResultDestination: String, Codable, Equatable {
    case inlineCard
    case sheet
    case navigationDestination
    case toast
    case systemShare
    case clipboard
}

struct CloudMailActionDescriptor: Identifiable, Codable, Equatable {
    let actionID: String
    let screen: String
    let label: String
    let icon: String
    let role: CloudMailActionRole
    let enabled: Bool
    let disabledReason: String?
    let requiresNetwork: Bool
    let requiresCloudAI: Bool
    let requiresLocalBroker: Bool
    let requiresSelectedEmail: Bool
    let requiresAttachment: Bool
    let providerCapabilityRequired: String?
    let loadingState: String
    let successState: String
    let errorState: String
    let resultDestination: CloudMailActionResultDestination
    let telemetryEvent: String
    let testID: String

    var id: String { actionID }
}

enum CloudMailActionRegistry {
    static func emailDetailAction(
        actionID: String,
        label: String,
        icon: String,
        role: CloudMailActionRole = .secondary,
        enabled: Bool = true,
        disabledReason: String? = nil,
        requiresNetwork: Bool = false,
        requiresCloudAI: Bool = false,
        requiresLocalBroker: Bool = false,
        requiresSelectedEmail: Bool = true,
        requiresAttachment: Bool = false,
        providerCapabilityRequired: String? = nil,
        loadingState: String = "Idle",
        successState: String = "Ready",
        errorState: String = "Inline error",
        resultDestination: CloudMailActionResultDestination = .inlineCard
    ) -> CloudMailActionDescriptor {
        CloudMailActionDescriptor(
            actionID: actionID,
            screen: "Email Detail",
            label: label,
            icon: icon,
            role: role,
            enabled: enabled,
            disabledReason: enabled ? nil : (disabledReason ?? "This action is not available right now."),
            requiresNetwork: requiresNetwork,
            requiresCloudAI: requiresCloudAI,
            requiresLocalBroker: requiresLocalBroker,
            requiresSelectedEmail: requiresSelectedEmail,
            requiresAttachment: requiresAttachment,
            providerCapabilityRequired: providerCapabilityRequired,
            loadingState: loadingState,
            successState: successState,
            errorState: errorState,
            resultDestination: resultDestination,
            telemetryEvent: "email_detail.\(actionID)",
            testID: "email-detail-\(actionID)"
        )
    }
}
