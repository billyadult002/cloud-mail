import SwiftUI

struct ForgotPasswordView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email: String
    @State private var isSubmitting = false
    @State private var message: String?
    @State private var showResetPasswordSheet = false
    @State private var mockResetToken: String = ""

    init(initialEmail: String = "") {
        _email = State(initialValue: initialEmail)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Enter your email address") {
                    TextField("you@domain.com", text: $email)
                        .loginTextInputStyle()
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        #endif
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
                        Text("Send Reset Link")
                    }
                }
                .disabled(email.isEmpty || isSubmitting)
                
                if !mockResetToken.isEmpty {
                    Section("Reset code") {
                        Text("Reset code ready:")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(mockResetToken)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                        
                        Button("Open Reset Password") {
                            showResetPasswordSheet = true
                        }
                    }
                }
            }
            .navigationTitle("Forgot Password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showResetPasswordSheet) {
                ResetPasswordView()
                    .environmentObject(app)
            }
        }
    }

    private func submit() {
        Task { @MainActor in
            isSubmitting = true; message = nil; mockResetToken = ""
            do {
                let e = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let response = try await app.backendForgot(email: e)
                if response.mockMode == true {
                    mockResetToken = response.resetToken ?? ""
                    message = "Reset code ready. Copy it below."
                } else {
                    message = response.message ?? "Reset link has been sent to your email."
                }
            } catch {
                guard !error.isCloudMailCancellation else { isSubmitting = false; return }
                message = ProductSafeText.sanitize((error as? APIError)?.message ?? error.localizedDescription, context: .general)
            }
            isSubmitting = false
        }
    }
}

#Preview {
    ForgotPasswordView().environmentObject(AppState())
}
