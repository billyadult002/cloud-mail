# NEXORA Comail authorized internal-use policy

## Authorization status

`USER_CONFIRMED_PENDING_ARTIFACT`, confirmed by TinBill on 2026-07-18, permits internal
development and production-readiness reuse of Comail 0.2.22. Each reuse must record source
path/version/fingerprint, destination path, classification, modifications, dependencies,
notices, tests, and runtime use. The prior clean-room rules remain historical controls for
work completed before this authorization.

No directly reused Comail code may enter commercial release, public distribution, external
binary distribution, or externally accessible deployment until a formal authorization artifact
is attached and reviewed. This policy does not authorize unrelated third-party dependencies.

## Historical clean-room policy

Comail 0.2.22 is external research material, not a CloudMail source dependency. Its source directory
`/Users/billtin/Downloads/comail-0.2.22` is prohibited from canonical-repository copying, imports,
vendoring, generated output, fixtures, Worker bundles, deployment artifacts, and IPA resources.

NEXORA implementation work may use public OAuth/OIDC standards, official provider documentation, NEXORA
contracts, and independently written behavioral specifications. Comail-derived research must be recorded only
as `DESIGN_REUSE`; it may not provide identifiers, comments, control flow, tests, or source fragments to the
implementation author. Any apparent meaningful similarity requires manual legal review before release.

The build-input inspection on 2026-07-18 found no `comail` or `/Users/billtin/Downloads` reference in the
Worker package manifest, Wrangler configuration, or repository source search. The source is outside this Git
repository and is not tracked.
