# ADR: Repository Authority Restoration

Status: Accepted
Date: 2026-07-16
Mission: CLOUDMAIL SOURCE-OF-TRUTH REPOSITORY AND DEPLOYMENT PROVENANCE RESTORATION
Related: `REPOSITORY_RECOVERY_REPORT.md`, `docs/ADR-DEPLOYMENT-PROVENANCE-STANDARD.md`

## ADR-1 — Why prior Git history is absent

`/Users/billtin/Documents/cloudmail` had no `.git` in this directory, any parent,
or any nested path (`git rev-parse --show-toplevel` failed; `find -name .git`
empty). The project was developed as a plain working tree: every prior artifact,
report, and production deploy (e.g. Worker versions `338018fc…`, `101308e4…`) was
produced without a commit anchor. There is therefore **no recoverable history** —
no reflog, packfiles, or dangling objects exist to restore. History cannot be
reconstructed; it can only be started from here.

## ADR-2 — Why the current working tree is the Genesis Baseline

With no history to recover, the only authoritative artifact is the current working
tree, which is also the code that produced the live production Worker. It is adopted
as the genesis baseline:

- Baseline commit: `18f7f25b64df81c3aa61248fd711760972de0539` on `main`.
- Tag: `v2026.07-baseline`.
- The baseline's Worker source (`platform/cloud-mail/mail-worker/src`) is byte-identical
  to what was deployed as production Version `101308e4-0faf-4ecc-897d-6fd47753a012`
  (the F1 fix); no `src` change was made between that deploy and this commit.

### Baseline scope decision

The baseline captures **authoritative source**, not the full 40 GB tree. Excluded via
`.gitignore` (reproducible or non-source): `artifacts/` (37 GB), `build/`, `platform/build/`,
`archive/`, `evidence/`, `node_modules/`, `DerivedData`, `dist/`, `.wrangler/`,
`*.xcarchive`/`*.xcresult`/`*.dSYM`, packaged apps (`*.ipa`/`*.zip`/`*.tar.gz`), and
binary media (`*.png`/`*.heic`/…, `nexora logo/`).

### Secrets exclusion (hard rule)

The following are **never** committed and are `.gitignore`d: `profile/` (contains
`证书文件.p12` signing key, `描述文件.mobileprovision`, `密码.txt` cert password),
`*.p12`, `*.mobileprovision`, `*.pem`, `*.key`, `.env` / `.env.*` (e.g.
`platform/cloud-mail/mail-vue/.env.release`), `**/.dev.vars`, `signing-work/`,
`*service-account*.json`, `*credentials*.json`. A pre-commit secret guard confirmed
zero secret files were staged (1377 files / 28 MB baseline).

`platform/cloud-mail/mail-worker/wrangler.toml` **is** committed: it holds resource
IDs (D1/KV/R2/zone), not credentials. Real secrets (`jwt_secret`, `admin`, OAuth /
Resend tokens) live in Cloudflare `wrangler secret` storage, never in the file.

## Consequences

- `git status/log/show/diff/blame` are now available for all baselined source.
- Live UCS processes continue writing `implementation_plan.md` and
  `docs/ADR-UCS-WORKSPACE2-FRESHNESS-COMPLETION.md`; those modifications are left
  **uncommitted** to avoid capturing partial UCS state — this Mission did not touch
  UCS checkpoint/cursor/outbox/projection.
- Future work (F3/F4/F5/F6) is auditable and revertible per commit/tag.
