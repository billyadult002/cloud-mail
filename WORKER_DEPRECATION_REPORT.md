
# Worker Deprecation Report

Generated: 2026-07-05 22:11:24

## Findings

- Root `worker/` exists: **False**
- Canonical Worker path exists: **True**
- Classification for root `worker/`: **KEEP_NOT_PRESENT**

## Recommendation

If root `worker/` exists and no active references are found, quarantine in a later cleanup loop as:

`archive/deprecated/worker_2026-07-05/`

No move or deletion was performed in this loop.

## Reference Scan Sample

```text
No active root worker/ references found in bounded scan, or root worker/ is not present.
```
