-- Kira telemetry events table.
-- Raw events expire after 180 days via the daily retention cron;
-- ip_hash is dropped after 24h to bound abuse-only signal lifetime.

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('success','retry','failure')),
  client_id    TEXT NOT NULL,
  kira_version TEXT NOT NULL,
  os           TEXT NOT NULL,
  node_major   INTEGER NOT NULL,
  tier         TEXT NOT NULL,
  note         TEXT,
  context      TEXT,
  ts           TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_skill_ts  ON events (skill_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_client_ts ON events (client_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_received  ON events (received_at);
