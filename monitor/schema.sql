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
  received_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cycles_started ON cycles(started_at);

-- "Kimi's Page": the inhabitant's self-authored public webpage. Single row.
CREATE TABLE IF NOT EXISTS site (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  html       TEXT,
  cycle      INTEGER,
  updated_at TEXT
);
