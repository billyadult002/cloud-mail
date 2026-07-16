import SwiftUI

struct ResetPasswordView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var token: String = ""
    @State private var newPassword: String = ""
    @State private var isSubmitting = false
    @State private var message: String?

    init(initialToken: String = "") {
        _token = State(initialValue: initialToken)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Reset code") {
                    TextField("paste reset code", text: $token)
                        .loginTextInputStyle()
                        .autocorrectionDisabled()
                }
                Section("New password") {
                    SecureField("••••••••", text: $newPassword)
                }
                if let message { Text(message).foregroundStyle(.secondary) }
                Button(action: submit) {
                    HStack { if isSubmitting { ProgressView() }; Text("Update password") }
                }
                .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || newPassword.isEmpty || isSubmitting)
            }
            .navigationTitle("Reset password")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func submit() {
        Task { @MainActor in
            isSubmitting = true; message = nil
            do {
                try await app.backendReset(token: token.trimmingCharacters(in: .whitespacesAndNewlines), newPassword: newPassword)
                message = "Password updated. Please sign in."
                try? await Task.sleep(for: .seconds(0.8))
                dismiss()
            } catch {
                guard !error.isCloudMailCancellation else { isSubmitting = false; return }
                message = ProductSafeText.sanitize((error as? APIError)?.message ?? error.localizedDescription, context: .general)
            }
            isSubmitting = false
        }
    }
}

#Preview {
    ResetPasswordView().environmentObject(AppState())
}
