# Email Detail AI Briefing State Model Report

Date: 2026-07-06

## Implemented Model

Email Detail AI Briefing now uses an authoritative local state model with these phases:

- `idle`
- `autoStarting`
- `running`
- `success`
- `failure`
- `timeout`
- `cancelled`
- `unavailable`

## Result Fields

The state tracks message id, body hash, provider, start/completion time, result text, category, action-required flag, execution label, error message, expansion state, source action, and slow-warning visibility.

## Code Evidence

- State model: `files/GlassMail-project/GlassMail/Views/EmailDetailView.swift`
- Strict empty-result failure: `files/GlassMail-project/GlassMail/Services/AppState.swift`

