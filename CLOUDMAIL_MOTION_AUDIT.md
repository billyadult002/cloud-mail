# CLAUDEMAIL Motion Audit

Audit date: 2026-07-09

Scope: all SwiftUI `withAnimation`, `.animation`, and `.transition` calls under `GlassMail`.

| Before | After | Why |
| --- | --- | --- |
| Spring motion on mailbox, account, and provider disclosures | `VisualSystemV3.Motion.disclosure` (`easeInOut`, 200ms) | Removes bounce from high-frequency enterprise controls while retaining spatial continuity. |
| Unspecified selection-mode animation | `VisualSystemV3.Motion.feedback` (`easeOut`, 140ms) | Keeps direct actions immediate and predictable. |
| Root phase `.smooth` animation | Shared 200ms disclosure motion | Prevents a distinct, unreviewed system curve from appearing during application state changes. |
| Detail AI disclosure custom curve | Shared 200ms disclosure motion | One controlled motion vocabulary across the product. |
| Tab, error banner, mailbox drawer, and composer transitions | Transform plus opacity only | The remaining transitions use movement and opacity, with no layout, color, blur, or spring animation. |

## Findings

- No spring or `easeIn` animation remains in the iOS SwiftUI source.
- Immediate button feedback is 140ms ease-out and honors Reduce Motion.
- Disclosure interactions use a 200ms ease-in-out curve.
- Transitions are limited to transform and opacity. No repeating, decorative, or data-reload animation is present.

## Verdict

**Pass with follow-up:** the implemented transitions meet the calm, premium motion policy. A future pass should extend the existing `ClaudePressStyle` to every custom button surface; this is consistency work, not a transition defect.
