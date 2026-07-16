-- WF-7 / WP-C: full-text search for the email store.
-- Replaces leading-wildcard LIKE full scans with an FTS5 index. External-content
-- FTS keeps the index in sync with `email` via triggers and stores only the
-- tokenized columns (no data duplication of bodies).
-- Idempotent-ish: uses IF NOT EXISTS; triggers are dropped+recreated so re-apply
-- on a fresh DB is clean. No table rename/drop of real data.

-- Contentless-external FTS over the searchable columns of `email`.
CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(
  subject,
  name,
  send_email,
  to_email,
  text,
  content='email',
  content_rowid='email_id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep FTS in sync with the base table.
DROP TRIGGER IF EXISTS email_fts_ai;
DROP TRIGGER IF EXISTS email_fts_ad;
DROP TRIGGER IF EXISTS email_fts_au;

CREATE TRIGGER email_fts_ai AFTER INSERT ON email BEGIN
  INSERT INTO email_fts(rowid, subject, name, send_email, to_email, text)
  VALUES (new.email_id, new.subject, new.name, new.send_email, new.to_email, new.text);
END;

CREATE TRIGGER email_fts_ad AFTER DELETE ON email BEGIN
  INSERT INTO email_fts(email_fts, rowid, subject, name, send_email, to_email, text)
  VALUES ('delete', old.email_id, old.subject, old.name, old.send_email, old.to_email, old.text);
END;

CREATE TRIGGER email_fts_au AFTER UPDATE ON email BEGIN
  INSERT INTO email_fts(email_fts, rowid, subject, name, send_email, to_email, text)
  VALUES ('delete', old.email_id, old.subject, old.name, old.send_email, old.to_email, old.text);
  INSERT INTO email_fts(rowid, subject, name, send_email, to_email, text)
  VALUES (new.email_id, new.subject, new.name, new.send_email, new.to_email, new.text);
END;

-- Backfill existing rows into the FTS index (idempotent rebuild).
INSERT INTO email_fts(email_fts) VALUES ('rebuild');
