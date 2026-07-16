-- Base schema fixture for migration-safety tests.
-- Mirrors the runtime tables created by mail-worker/src/init/init.js that the
-- SQL migration chain (0002+) ALTERs or references. Kept intentionally minimal:
-- only the columns/constraints the migrations depend on. Update this fixture
-- when init.js base tables change.

CREATE TABLE IF NOT EXISTS user (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  type INTEGER DEFAULT 1 NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  status INTEGER DEFAULT 0 NOT NULL,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  active_time DATETIME,
  is_del INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  account_id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT DEFAULT '',
  status INTEGER DEFAULT 0 NOT NULL,
  latest_email_time DATETIME,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL,
  is_del INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS email (
  email_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  send_email TEXT,
  name TEXT,
  account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  subject TEXT,
  content TEXT,
  text TEXT,
  message_id TEXT DEFAULT '',
  in_reply_to TEXT DEFAULT '',
  to_email TEXT DEFAULT '',
  status INTEGER DEFAULT 0 NOT NULL,
  type INTEGER DEFAULT 0 NOT NULL,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  is_del INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS star (
  star_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email_id INTEGER NOT NULL,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  att_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  size INTEGER,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
