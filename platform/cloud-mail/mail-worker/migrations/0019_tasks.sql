-- Loop 4 (Copilot Mail -> Task). Canonical task store. A task always backlinks to
-- the originating mail via source_email_id so the Daily Briefing can surface it and
-- the user can jump back to the source. Idempotent (IF NOT EXISTS); no rename/drop.
-- Aligned with LOOP_RUNBOOK_2 STEP 4.3, plus updated_at + kind + indexes for the
-- list/backlink hot paths, matching the schema conventions in 0016.

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK(priority IN ('critical','high','medium','low')),
  kind TEXT NOT NULL DEFAULT 'task'
    CHECK(kind IN ('task','deadline','meeting','approval','invoice','contract','payment')),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','done','cancelled')),
  source_email_id INTEGER,          -- backlink to the originating mail (email.email_id)
  source_thread_id TEXT,            -- optional: originating thread
  provider TEXT,                    -- AI provider that extracted the task (attribution)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Hot path: list a user's open tasks ordered by due/created.
CREATE INDEX IF NOT EXISTS tasks_user_status_idx
  ON tasks(user_id, status, due_date);

-- Backlink lookup: "tasks for this email".
CREATE INDEX IF NOT EXISTS tasks_source_email_idx
  ON tasks(user_id, source_email_id);
