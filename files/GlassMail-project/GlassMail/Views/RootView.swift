//
//  RootView.swift
//  GlassMail
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.scenePhase) private var scenePhase
    private var resetSheetBinding: Binding<Bool> {
        Binding(
            get: { app.resetPasswordToken != nil },
            set: { if !$0 { app.resetPasswordToken = nil } }
        )
    }
    private var activationSheetBinding: Binding<Bool> {
        Binding(
            get: { app.activationToken?.isEmpty == false },
            set: { if !$0 { app.activationToken = nil } }
        )
    }

    var body: some View {
        ZStack {
            AmbientBackground()
            switch app.phase {
            case .onboarding:
                OnboardingView()
            case .ready:
                MainTabView()
            }
        }
        .animation(VisualSystemV3.Motion.disclosure, value: app.phase)
        .onOpenURL { url in
            app.handleIncomingURL(url)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL else { return }
            app.handleIncomingURL(url)
        }
        .sheet(isPresented: resetSheetBinding) {
            ResetPasswordView(initialToken: app.resetPasswordToken ?? "")
                .environmentObject(app)
        }
        .sheet(isPresented: activationSheetBinding) {
            IdentityActivationView(initialToken: app.activationToken ?? "")
                .environmentObject(app)
        }
        .preferredColorScheme(preferredColorScheme)
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await app.refreshIfStale() }
        }
    }

    private var preferredColorScheme: ColorScheme? {
        switch app.profileTheme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}
