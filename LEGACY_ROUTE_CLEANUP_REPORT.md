# Legacy Route Cleanup Report

Status: **PARTIAL**

The Worker exposes 172 route declarations. Protected P31/P32C/security routes now enforce authentication and domain scope. Public discovery and activation routes remain intentionally reachable. No route was deleted solely from textual suspicion; route deletion requires client call-site and deployed traffic evidence. The live Worker currently predates the restricted-CORS change and must be redeployed.
