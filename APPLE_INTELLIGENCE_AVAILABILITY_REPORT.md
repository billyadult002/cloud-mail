# Apple Intelligence Availability Report

Date: 2026-07-05

Implemented availability handling:
- `AppleFoundationProvider` maps Apple Foundation Models availability for available, device not eligible, Apple Intelligence disabled, model not ready, and unknown states.
- `AppState.appleIntelligenceAvailabilityMessage` provides one clear UI reason.
- Email Detail shows: `Apple Intelligence is unavailable on this device or disabled in Settings.`
- Actions do not silently fall back to Gemini or ChatGPT when Apple Intelligence is unavailable.

Real-device availability result:
- Not observed in this loop because fresh signed install was blocked by missing provisioning/account, and the bundle was not installed on the connected iPhone.
