# Gmail REST-Only Primary Path Report

Primary Gmail path remains OAuth + Gmail REST API.

Validated by guard:

- `REST_ONLY_ALLOWED_RUNTIME = 'gmail_rest_api'`
- Gmail IMAP is classified as migration/recovery deprecated.
- Gmail sync uses Gmail REST API message endpoints.

Non-Gmail IMAP/SMTP behavior was not removed.
