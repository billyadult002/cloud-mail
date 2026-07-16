# Visibility Filter Audit

Mail can be narrowed by account, provider, local folder, snooze state, dashboard chip, and search query. GPT57 routes those inputs through one engine for Inbox and All Mail rendering. The same trace names the narrowing stage so a zero result cannot be mislabeled as successful import.

The `All` chip and merged All Mail view now remain an explicit filter and folder selection, rather than a separate count-only code path.
