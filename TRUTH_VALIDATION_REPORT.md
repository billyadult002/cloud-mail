# Truth Validation Report

| Truth claim | Runtime evidence | Status |
|---|---|---|
| Provider accepted != delivered | No live delivery rows; local code enforces distinction | BLOCKED for live replay |
| OAuth disconnect cleanup | Local code changed; no authenticated live disconnect replay | BLOCKED |
| Cross-account isolation | Local authorization code changed; no two-account device replay | BLOCKED |
| Attachment authorization | Local `/oss` ownership checks; no live signed-session replay | BLOCKED |
| Webhook validation | Local Svix verification/dedupe; no signed production event replay | BLOCKED |
| Activation protection | Local response token suppression; no production activation replay | BLOCKED |
