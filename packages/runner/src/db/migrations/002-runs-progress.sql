-- Issue #86: runner が BFS 中の進捗を runs テーブルに書き込めるよう列を追加。
-- 旧 run 行は default 0 / NULL を受け取る (lenient parse 前提で web も壊れない)。
ALTER TABLE runs ADD COLUMN pages_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN queue_size INTEGER;
ALTER TABLE runs ADD COLUMN current_url TEXT;
