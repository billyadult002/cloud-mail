# Capability Platform Report

## Status

`capability_platform = READY`

## Capability States

- `PASS`
- `WARN`
- `FAIL`
- `UNKNOWN`

## Capabilities

- Can Login
- Can Send
- Can Receive
- Can Sync
- Can Import
- Can Route
- Can AI Process

## Critical Boundary

No inference is allowed:

- Connected does not imply Can Send.
- Connected does not imply Can Receive.
- OAuth success does not imply Mailbox Ready.
