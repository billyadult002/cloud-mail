# Profile Sync V2 Report

Date: 2026-07-07

Status: `PASS`

Implemented:
- Extended `MailClientProfile` with profile sync metadata, synced items, device label, restore timestamp, and device list.
- Synced items include favorites, VIP contacts, starred contacts, directory preferences, compose preferences, and autocomplete learning.
- Profile Sync screen exposes enabled status, last sync, CloudKit status, device count, last restore, synced items, and excluded data.
- Current device is upserted into profile metadata during profile reconciliation.

Evidence:
- Source: `files/GlassMail-project/GlassMail/Models/Models.swift`.
- Source: `files/GlassMail-project/GlassMail/Services/AppState.swift`.
- Real iPhone acceptance validated Profile Sync: `artifacts/enterprise-directory-profile-sync/enterprise-directory-profile-sync-real-iphone-xctest-final.log`.

Safety:
- Credentials, OAuth codes, refresh tokens, browser cookies, and token files are excluded from profile sync.
