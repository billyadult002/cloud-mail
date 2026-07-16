# Password Hash Record Format Specification (F4)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN. Date: 2026-07-16. Design-only.

## Storage decision (ADR-3 / A12)

**Single-field, self-describing encoding in the existing `user.password` column. No schema
migration.** Rationale: avoids `ALTER TABLE` on the production `user` table (zero migration risk,
especially while UCS work is in flight), keeps the record atomic (one column update), and is
fully self-describing (algorithm + version + params + salt + derived key travel together). The
`user.salt` column is retained for legacy records; for new records the salt is embedded in the
record and the `salt` column is written as an empty/marker value (or left unchanged — verify never
reads it for new records).

## New record grammar (PHC-like)

```
record      = "$" scheme "$v=" version "$" params "$" salt-b64 "$" dk-b64
scheme      = "pbkdf2-sha256"
version     = 1*DIGIT                     ; format/policy version, starts at 1
params      = "i=" iterations             ; e.g. "i=210000" (may add ",dklen=32" later)
iterations  = 1*DIGIT
salt-b64    = base64url(16..32 random bytes)   ; per-record CSPRNG salt
dk-b64      = base64url(PBKDF2-HMAC-SHA256(pw, salt, iterations, dklen=32))
```

Example (illustrative, not a real hash): `$pbkdf2-sha256$v=1$i=210000$<saltB64>$<dkB64>`.

- Encoding: base64url, no padding, for salt and derived key. `dklen` default 32 bytes.
- The `$`-delimited leading `$pbkdf2-sha256$` prefix is the **new-format marker**.

## Legacy record identification (E7 / V3)

A record is **legacy** iff it does NOT start with `$pbkdf2-sha256$` (equivalently: does not begin
with `$`). Legacy verify uses `user.salt` + `SHA-256(salt+password)` == `user.password`
(the current path). This is unambiguous: the current SHA-256 output is base64 of a 32-byte digest
and never begins with `$`.

## Parsing & fail-closed rules (E8 / V10 / A9)

`parseRecord(password)`:
1. If it starts with `$pbkdf2-sha256$` → parse `version`, `iterations`, `salt`, `dk`.
   - Any structural error, non-numeric params, bad base64, out-of-range iterations, unknown
     `version`, or unknown `scheme` ⇒ **fail closed**: verification returns `false`; emit a
     redacted audit event (no secret material). Never fall back to legacy for a malformed new record.
2. Else → treat as legacy SHA-256 (uses `salt` column).
3. Unknown future scheme prefix (e.g. `$argon2…$`) with no verifier available ⇒ fail closed.

## Verification result contract

`verify(input, {password, salt}) → { ok: boolean, needsRehash: boolean, reason?: string }`

- `ok` = password matches (format-appropriate, constant-time for the new format).
- `needsRehash` = true when `ok` and the record is legacy OR new-format with
  `version < CURRENT_VERSION` or `iterations < CURRENT_ITERATIONS`.
- Callers (login/admin/delegated) use `ok` for the auth decision and `needsRehash` to trigger lazy
  rehash (state machine doc). `needsRehash` is never used to weaken the auth decision.

## Constant-time compare (ADR-7 / V11)

Web Crypto has no `timingSafeEqual`. Implement:
```
function ctEqual(aBytes, bBytes) {
  if (aBytes.length !== bBytes.length) return false; // hash length is not secret
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
```
Compare the raw derived-key bytes (decode `dk-b64` and the freshly derived key), not the base64
strings. Length pre-check is acceptable (dklen is fixed and public).

## Parameter policy & versioning (ADR-8 / V13)

- `CURRENT_VERSION` and `CURRENT_ITERATIONS` are named constants, not scattered literals.
- Each record encodes the params used, so verification is independent of the current target.
- Raising cost = bump `CURRENT_ITERATIONS`/`CURRENT_VERSION`; existing records still verify at their
  encoded params; lazy rehash upgrades on next login. No global re-encode required.
- Initial target: `pbkdf2-sha256`, `v=1`, iterations chosen by the E13 performance-acceptance
  method against the deployed plan (candidate range 100k–210k; final value set at implementation
  after measuring on the target runtime — not asserted here as a production benchmark).
