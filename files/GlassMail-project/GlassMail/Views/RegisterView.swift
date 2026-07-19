import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let onRegistered: (String) -> Void

    @State private var email: String = ""
    @State private var domain: String = ""
    @State private var password: String = ""
    @State private var code: String = ""
    @State private var name: String = ""
    @State private var isSubmitting = false
    @State private var message: String?

    init(onRegistered: @escaping (String) -> Void = { _ in }) {
        self.onRegistered = onRegistered
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Account Details") {
                    TextField("Name (Optional)", text: $name)
                    
                    HStack {
                        TextField("username", text: $email)
                            .loginTextInputStyle()
                            .autocorrectionDisabled()
                        
                        Text("@")
                            .foregroundStyle(.secondary)
                        
                        TextField("domain.com", text: $domain)
                            .loginTextInputStyle()
                            .autocorrectionDisabled()
                    }
                }
                
                Section("Security") {
                    SecureField("Password", text: $password)
                    TextField("Registration code", text: $code)
                        .loginTextInputStyle()
                        .autocorrectionDisabled()
                }
                
                if let message {
                    Text(message)
                        .foregroundStyle(.secondary)
                }
                
                Button(action: submit) {
                    HStack {
                        if isSubmitting {
                            ProgressView()
                        }
                        Text("Register")
                    }
                }
                .disabled(email.isEmpty || domain.isEmpty || password.isEmpty || isSubmitting)
            }
            .navigationTitle("Create New Account")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func submit() {
        Task { @MainActor in
            isSubmitting = true; message = nil
            do {
                let e = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let d = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let c = code.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await app.backendRegister(email: e, password: password, name: name.isEmpty ? nil : name, domain: d, code: c)
                onRegistered("\(e)@\(d)")
                dismiss()
            } catch {
                guard !error.isCloudMailCancellation else { isSubmitting = false; return }
                message = ProductSafeText.sanitize((error as? APIError)?.userMessage ?? error.localizedDescription, context: .general)
            }
            isSubmitting = false
        }
    }
}

#Preview {
    RegisterView().environmentObject(AppState())
}
