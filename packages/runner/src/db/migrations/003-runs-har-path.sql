-- Issue #87: クロールで取得した HAR (network record) を runs.har_path に紐付ける。
-- 旧 run (HAR 無し) は SELECT 時 NULL になる。
ALTER TABLE runs ADD COLUMN har_path TEXT;
