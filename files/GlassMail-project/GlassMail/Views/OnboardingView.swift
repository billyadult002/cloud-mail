//
//  OnboardingView.swift
//  GlassMail
//
//  The only screen that asks the user for input: their domain + server, then a
//  sign-in. Everything after this is automatic.
//

import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var app: AppState

    @State private var serverURL: String = ""
    @State private var domain: String = ""
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var showAdvanced = false
    @FocusState private var focus: Field?

    @State private var showRegister = false
    @State private var showForgotPassword = false
    @State private var identityMessage: String?
    @State private var identityCanActivate = false
    @State private var identityLoading = false

    enum Field { case email, password, server, domain }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                header

                GlassCard(cornerRadius: 26) {
                    VStack(spacing: 16) {
                        labeledField("Your domain", system: "globe") {
                            TextField("example.com", text: $domain)
                                .textContentType(.URL)
                                .focused($focus, equals: .domain)
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                #endif
                        }

                        Divider().opacity(0.3)

                        labeledField("Email address", system: "envelope") {
                            TextField("you@\(domain.isEmpty ? "example.com" : domain)", text: $email)
                                .textContentType(.username)
                                .focused($focus, equals: .email)
                                #if os(iOS)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                #endif
                        }

                        Divider().opacity(0.3)

                        labeledField("Password", system: "lock") {
                            SecureField("••••••••", text: $password)
                                .textContentType(.password)
                                .focused($focus, equals: .password)
                                .onSubmit(connect)
                        }
                    }
                }
                .frame(maxWidth: 460)

                DisclosureGroup(isExpanded: $showAdvanced) {
                    GlassCard(cornerRadius: 18) {
                        labeledField("NEXORA Service URL", system: "server.rack") {
                            TextField("https://your-worker.workers.dev", text: $serverURL)
                                .focused($focus, equals: .server)
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                #endif
                        }
                    }
                    .frame(maxWidth: 460)
                } label: {
                    Label("Advanced — server endpoint", systemImage: "gearshape")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: 460)
                .tint(.secondary)

                if let error = app.errorMessage {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 460)
                }
                if let identityMessage {
                    VStack(spacing: 10) {
                        Text(identityMessage)
                            .font(.callout)
                            .multilineTextAlignment(.center)
                        if identityCanActivate {
                            Button {
                                requestActivation()
                            } label: {
                                Label("Activate NEXORA account", systemImage: "checkmark.seal")
                            }
                            .buttonStyle(.glass)
                            .disabled(identityLoading)
                        }
                    }
                    .frame(maxWidth: 460)
                }

                Button(action: connect) {
                    HStack {
                        if app.isLoading { ProgressView().controlSize(.small) }
                        Text(app.isLoading ? "Signing in…" : "Sign in")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: 460)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!canConnect || app.isLoading)

                Text("On-device AI is on by default — no account or key needed.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)

                HStack(spacing: 20) {
                    Button("Create a new account") {
                        showRegister = true
                    }
                    .font(.footnote)
                    
                    Text("•").foregroundStyle(.secondary)
                    
                    Button("Forgot Password?") {
                        showForgotPassword = true
                    }
                    .font(.footnote)
                }
                .padding(.top, 8)
                .sheet(isPresented: $showRegister) {
                    RegisterView { registeredEmail in
                        showRegister = false
                        applyRegisteredEmail(registeredEmail)
                    }
                    .environmentObject(app)
                }
                .sheet(isPresented: $showForgotPassword) {
                    ForgotPasswordView().environmentObject(app)
                }
            }
            .padding()
            .frame(maxWidth: .infinity)
        }
        .onAppear {
            serverURL = app.serverURLString
            domain = app.domain
            applyLoginPrefill()
            focus = .email
        }
        .onChange(of: app.loginPrefillEmail) { _, _ in
            applyLoginPrefill()
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image("CloudMailLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 86, height: 86)
                .accessibilityLabel("NEXORA")
            Text("NEXORA")
                .font(.largeTitle.weight(.bold))
            Text("Your self-hosted mail, with AI that reads it for you.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 12)
    }

    @ViewBuilder
    private func labeledField<F: View>(_ title: String, system: String,
                                       @ViewBuilder field: () -> F) -> some View {
        HStack(spacing: 12) {
            Image(systemName: system)
                .frame(width: 22)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                field().textFieldStyle(.plain)
            }
        }
    }

    private var canConnect: Bool {
        !email.isEmpty && !password.isEmpty && !domain.isEmpty
    }

    private var fullEmail: String {
        email.contains("@") ? email : "\(email)@\(domain)"
    }

    private func connect() {
        guard canConnect else { return }
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = trimmed.isEmpty ? app.serverURLString : trimmed
        app.applyServer(urlString: url, domain: domain)
        Task {
            await app.login(email: fullEmail, password: password)
            guard app.phase == .onboarding else { return }
            identityLoading = true
            defer { identityLoading = false }
            if let discovery = try? await app.discoverIdentity(email: fullEmail) {
                identityMessage = discovery.message
                identityCanActivate = ["create_pending_user", "set_password", "activate_from_catch_all"].contains(discovery.recommendedAction)
            }
        }
    }

    private func applyLoginPrefill() {
        guard let prefill = app.loginPrefillEmail, prefill.contains("@") else { return }
        applyRegisteredEmail(prefill)
    }

    private func applyRegisteredEmail(_ registeredEmail: String) {
        guard registeredEmail.contains("@") else { return }
        let parts = registeredEmail.split(separator: "@", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return }
        email = registeredEmail
        domain = parts[1]
        password = ""
        identityMessage = "Registered successfully. Please sign in."
        identityCanActivate = false
        app.errorMessage = nil
    }

    private func requestActivation() {
        identityLoading = true
        Task {
            defer { identityLoading = false }
            do {
                let result = try await app.bootstrapIdentity(email: fullEmail)
                if let token = result.activationToken {
                    try await app.activateIdentity(token: token, password: password)
                    identityMessage = "Activated successfully. Signing in..."
                    await app.login(email: fullEmail, password: password)
                } else {
                    identityMessage = result.message ?? "Check your mailbox for an activation link."
                }
            } catch {
                guard !error.isCloudMailCancellation else { return }
                identityMessage = ProductSafeText.sanitize(error.localizedDescription, context: .general)
            }
        }
    }
}
