-- Issue #191: opt-in per-App schedules and run origin markers.
ALTER TABLE apps ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '{"enabled":false}';
ALTER TABLE apps ADD COLUMN last_scheduled_at TEXT;
ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
