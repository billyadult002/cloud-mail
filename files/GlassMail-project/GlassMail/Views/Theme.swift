//
//  Theme.swift
//  GlassMail
//
//  Centralized style tokens (Colors, Spacing, Corner Radius, and Fonts)
//  supporting liquid-glass aesthetic across iOS/macOS targets.
//

import SwiftUI

enum VisualSystemV3 {
    enum Spacing {
        static let micro: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
    }
    enum Radius {
        static let compact: CGFloat = 8
        static let control: CGFloat = 12
    }
    enum Type {
        static let caption = Font.caption
        static let body = Font.body
    }
    enum ColorToken {
        static let accent = Color(red: 10/255, green: 102/255, blue: 194/255)
        static let success = Color.green
        static let warning = Color.orange
        static let danger = Color.red
    }
}

struct Theme {
    struct Spacing {
        static let extraSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let extraLarge: CGFloat = 24
    }
    
    struct CornerRadius {
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 18
        static let container: CGFloat = 24
    }
    
    // Core brand color (LinkedIn/CloudMail blue theme)
    static let primaryAccent = Color(red: 10/255, green: 102/255, blue: 194/255)
    static let secondaryAccent = Color.blue
    
    // Glass borders and backgrounds
    static func glassBorder(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? Color.white.opacity(0.20) : Color.black.opacity(0.12)
    }
    
    static func glassBackground(for colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? Color.black.opacity(0.25) : Color.white.opacity(0.40)
    }
    
    // Adaptive gradient colors to protect contrast ratio under various color schemes
    static func adaptiveGradientColors(for colorScheme: ColorScheme) -> [Color] {
        if colorScheme == .dark {
            return [
                primaryAccent.opacity(0.12),
                Color(white: 0.1).opacity(0.92),
                primaryAccent.opacity(0.08)
            ]
        } else {
            return [
                primaryAccent.opacity(0.06),
                Color(white: 0.98).opacity(0.96),
                primaryAccent.opacity(0.04)
            ]
        }
    }
    
    static func adaptiveRadialColors(for colorScheme: ColorScheme) -> [Color] {
        if colorScheme == .dark {
            return [primaryAccent.opacity(0.16), Color.clear]
        } else {
            return [primaryAccent.opacity(0.08), Color.clear]
        }
    }
}
