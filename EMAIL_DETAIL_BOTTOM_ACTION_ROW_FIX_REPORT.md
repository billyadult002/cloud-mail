# Email Detail Bottom Action Row Fix Report

Date: 2026-07-05

## Fix

The bottom row now has one compact reading-flow action set:

- Reply
- Forward
- AI Actions

Reply uses prominent glass styling. Forward and AI Actions use secondary glass styling. The row is mounted through the safe-area inset and shows progress while AI actions are running.

## Verification

`scripts/guards/email_detail_bottom_action_design_guard.py`: PASS

