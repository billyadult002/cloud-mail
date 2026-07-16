//
//  GlassMailApp.swift
//  GlassMail
//
//  A native iOS 26 / macOS 26 mail client for a self-hosted cloud-mail backend,
//  with on-device + cloud AI email triage.
//

import SwiftUI

@main
struct GlassMailApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .tint(.accentColor)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 740)
        .windowToolbarStyle(.unified)
        #endif

        #if os(macOS)
        Settings {
            SettingsView()
                .environmentObject(app)
                .frame(width: 520, height: 560)
        }
        #endif
    }
}
