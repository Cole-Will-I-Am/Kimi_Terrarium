CREATE TABLE IF NOT EXISTS cycles (
  cycle             INTEGER PRIMARY KEY,
  thread_id         TEXT,
  started_at        TEXT,
  ended_at          TEXT,
  duration_s        INTEGER,
  status            TEXT,
  exit_code         INTEGER,
  summary           TEXT,
  reasoning         TEXT,
  commands_json     TEXT,
  num_commands      INTEGER,
  files_json        TEXT,
  num_files_changed INTEGER,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  reasoning_tokens  INTEGER,
  chars_out         INTEGER,
  journal_excerpt   TEXT,
  space_files_json  TEXT,
  space_bytes       INTEGER,
  vitality          REAL,
  vitality_delta    REAL,
  cycle_effort      REAL,
  received_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cycles_started ON cycles(started_at);

-- Precomputed site-wide aggregate (single row, id=1), refreshed on each ingest
-- so /api/stats never scans the full cycles table on the hot read path.
CREATE TABLE IF NOT EXISTS stats_cache (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT,
  updated_at TEXT
);

-- "Chronicle": breakthroughs/milestones in Kimi's evolution, written hourly by the chronicler model.
CREATE TABLE IF NOT EXISTS milestones (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT,
  title   TEXT,
  summary TEXT,
  tag     TEXT
);

-- "Chats w/ Cole": transcript of the owner's Telegram conversations with Kimi.
CREATE TABLE IF NOT EXISTS chats (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   TEXT,
  role TEXT,   -- 'cole' or 'kimi'
  text TEXT
);

-- "Kimi's Page": the inhabitant's self-authored public site. One row per page
-- (index.html is home); served sandboxed at /kimi.
CREATE TABLE IF NOT EXISTS pages (
  path       TEXT PRIMARY KEY,
  html       TEXT,
  updated_at TEXT
);
