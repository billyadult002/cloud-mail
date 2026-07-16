# Domain RBAC Report

Status: **PASS (route scope code); BLOCKED for live ownership replay**

`security.js` now checks authenticated identity and domain ownership for P31/P32C and security lifecycle/secure-link routes. Global admin remains the only scope for non-domain governance endpoints. A user cannot operate another tenant’s domain by changing a path segment.

Live D1 role/ownership data and Cloudflare DNS apply authorization still require deployment verification.
