# Password KDF Callsite Inventory (F4, read-only)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN. Date: 2026-07-16.
Read-only source inspection. No real password/salt/hash was read, logged, or exported (E9/V16/V17).

## Current primitive (`src/utils/crypto-utils.js`)

- `generateSalt(len=16)` → 16 random bytes, base64.
- `hashPassword(pw)` → `{ salt, hash }` where `hash = base64(SHA-256(salt + pw))` — **single-round SHA-256**.
- `genHashPassword(pw, salt)` → the single-round digest (used by hashPassword and legacy verify).
- `verifyPassword(input, salt, storedHash)` → `genHashPassword(input,salt) === storedHash` — **non-constant-time** string compare.
- `genRandomPwd(len=8)` → plaintext temp password (then hashed via hashPassword).

## Hash-WRITE callsites (E1) — must switch to new-format writer

| # | Location | Path | Notes |
|---|----------|------|-------|
| W1 | `login-service.js:131` | `/register` | self-service registration |
| W2 | `public-service.js:111` | `/public/addUser` | admin bulk create (also F1-parameterized) |
| W3 | `user-service.js:64` | `resetPassword()` | used by `/my/resetPassword`, `/forgot-password`→`/reset-password`, `setPwd` |
| W4 | `user-service.js:333` | second hash-write path (admin/restore/create) | confirm exact caller at impl time |
| W5 | `cloudmail-v2-service.js:827` | provisioning (`/auth/provisioning-*`) | mailbox provisioning |

## Password-VERIFY callsites (E2) — must call format-aware verify + trigger lazy rehash

| # | Location | Path | Notes |
|---|----------|------|-------|
| V1 | `login-service.js:253` | `/login` | primary login; **lazy-rehash trigger point** |
| V2 | `public-service.js:195` | `/public/genToken` (admin verify) | admin auth for public token |
| V3 | `mailbox-authorization-service.js:40` | delegated send (`owner_password`) | owner-password delegated authorization |

## Entrypoints touching password material (E3)

`/register` (login-api:26), `/user/setPwd` (user-api:13), `/my/resetPassword` (my-api:12),
`/forgot-password` + `/reset-password` (password-reset-api) → `userService.resetPassword`,
`/public/addUser` + `/public/genToken` (public-api), `/auth/provisioning-handoff`/`-continuation`
(cloudmail-v2-api) → provisioning hash-write.

## Schema (E4/E5)

`src/entity/user.js`: `password TEXT NOT NULL`, `salt TEXT NOT NULL`. **No** algorithm/version/params
column exists. The user table originates in the `0002_cloudmail_v2` era migration. Options:
self-describing encoding in `password` (no migration) — **selected** — or an additive nullable
`pwd_algo`/`pwd_params` column (migration). See format spec + ADR-3.

## Runtime capability (E6)

`wrangler.toml`: `compatibility_date=2025-09-01`, no `nodejs_compat`. Web Crypto **PBKDF2**
(`crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,bits)`) is available.
**scrypt/Argon2 are not** in Web Crypto (would require a WASM/JS dependency). No `timingSafeEqual`
primitive — constant-time compare must be implemented (threat model + ADR-7).

## Impact summary

All authentication (login, admin, delegated) and all password creation/reset/provisioning paths
depend on the current format. A direct algorithm swap would lock out every existing user →
migration MUST be verify-compatible + lazy (design in the state-machine + rollout docs).
