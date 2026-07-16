# Safe Cache Cleanup Review Report

Date: 2026-07-05T22:31:26

## Decision

Proceed with a conservative first cleanup batch: reviewed SAFE Xcode DerivedData directories only.

## Reviewed Candidates

|path|exists|size_before|files|dirs|decision|reason|
|---|---:|---:|---:|---:|---|---|
|artifacts/translate-local-fallback-real-device/DerivedData-device|TRUE|148.87 MB|2386|1021|DELETE_SAFE|Reviewed SAFE Xcode DerivedData cache from previous real-device/simulator loop; regenerable by rebuilding.|
|artifacts/translate-local-fallback-real-device/DerivedData-sim|TRUE|307.96 MB|3071|1050|DELETE_SAFE|Reviewed SAFE Xcode DerivedData cache from previous real-device/simulator loop; regenerable by rebuilding.|
|artifacts/email-detail-action-dedup-translate-result/DerivedData-device|TRUE|147.68 MB|2385|1021|DELETE_SAFE|Reviewed SAFE Xcode DerivedData cache from previous real-device/simulator loop; regenerable by rebuilding.|
|artifacts/email-detail-action-dedup-translate-result/DerivedData-sim|TRUE|306.49 MB|3071|1049|DELETE_SAFE|Reviewed SAFE Xcode DerivedData cache from previous real-device/simulator loop; regenerable by rebuilding.|
|artifacts/full-button-action-audit-translate-flow/DerivedData-device|TRUE|147.66 MB|2385|1021|DELETE_SAFE|Reviewed SAFE Xcode DerivedData cache from previous real-device/simulator loop; regenerable by rebuilding.|

## Exclusions

- No source code.
- No Worker source, migrations, scripts, or guard scripts.
- No IPA, Payload evidence, screenshots, signing/provisioning files, or production evidence.
- No RISKY_DO_NOT_DELETE entries.
- No QUARANTINE_CANDIDATES entries.
- No latest all-AI real-device artifacts.
