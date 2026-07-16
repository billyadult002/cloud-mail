# Gmail Truth Trace

Real-device observation before the GPT57 IPA was installed: All Mail displayed `Indexed Count 50` and `Visible Count 0`. That is a user-visible failure regardless of backend health.

The prior client reported a reconciled indexed count when the rendered list was empty. This masked the first drop. GPT57 replaces that path with `MailVisibilityEngine`:

`API -> decode -> overlay -> account/provider scope -> folder -> dashboard filter -> search -> render`

`MailVisibilityTrace` records all counts. The empty state reports the first actual drop instead of treating an index count as visible mail.

After the All Mail folder rule was corrected, real iPhone Mirroring showed `50 visible` and Google messages in the rendered All Mail list. Evidence: `artifacts/gpt56-cloudmail-visibility-visual-system-v3/real-iphone-all-mail-gmail-visible.png`.
